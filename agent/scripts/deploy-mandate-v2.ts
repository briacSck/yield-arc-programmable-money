/**
 * Deploys {AgentMandateV2} to Arc testnet FROM THE COMPANY CIRCLE WALLET, **alongside** the live
 * v1 mandate. v1 is never touched: it keeps its address, its history and its verdict. The verifier
 * takes `--address`, so a second mandate costs nothing and demonstrates the tool on two contracts.
 *
 * WHY THIS SCRIPT AND NOT `contracts/scripts/deploy-mandate-v2.ts`. The owner of a mandate must be
 * the company treasury wallet — the address that can `revoke`, `setMandate` and exit. That wallet
 * is a Circle developer-controlled wallet whose private key is not exposed, so Hardhat cannot sign
 * for it, and Circle's raw `/developer/sign/transaction` answers 156027 "blockchain not supported"
 * on ARC-TESTNET (verdict 2026-07-14). The Smart Contract Platform deploy below is the route that
 * actually put v1 on chain. The Hardhat script is the key-holding equivalent for local/CI.
 *
 *   Preflight (default, READ-ONLY, moves nothing, deploys nothing):
 *     npx tsx agent/scripts/deploy-mandate-v2.ts
 *   Deploy for real (spends testnet USDC for gas):
 *     npx tsx agent/scripts/deploy-mandate-v2.ts --execute
 *   Deploy and seed the company pool with 5 USDC:
 *     npx tsx agent/scripts/deploy-mandate-v2.ts --execute --fund 5
 *
 * The venue is left UNSET on purpose. See the permissioning note printed by the preflight: on Arc
 * the USYC Teller routes every caller AND every share recipient through Circle's RolesAuthority,
 * and a freshly deployed contract address holds no role, so `deposit` reverts `NotPermissioned()`
 * until the issuer grants one. Deploy → verify → get the address permissioned → `setVenue`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createPublicClient, http, parseAbi, formatUnits, getAddress, toFunctionSelector } from 'viem';
import { initiateDeveloperControlledWalletsClient } from '@circle-fin/developer-controlled-wallets';
import { compileMandateV2 } from './compile-mandate-v2.js';

// Mandate bounds (6-dec USDC base units) — same shape as the live v1: floor ≥ agent's own
// dynamic safe_floor by configuration (two-floor doctrine).
const FLOOR = 5_000_000n; // 5 USDC
const MAX_TICKET = 2_000_000n; // 2 USDC
const DAILY_CAP = 5_000_000n; // 5 USDC

const USDC_ERC20 = '0x3600000000000000000000000000000000000000' as const; // Arc native USDC, 6-dec view
const USYC_TELLER = '0x9fdF14c5B14173D74C08Af27AebFf39240dC105A' as const;
const RPC = 'https://rpc.drpc.testnet.arc.io'; // the only endpoint that serves concurrent reads
// Gas headroom for a ~7.2 kB contract deploy. At Arc's 25 gwei and ~1.5M gas that is ~0.04 USDC,
// so 1 USDC is ample — deliberately not the 12 USDC v1's script demanded, which also funded the
// pool. Testnet USDC is faucet-rationed (20/address/2h, human click), so this must not over-ask.
const MIN_COMPANY_NATIVE = 1n * 10n ** 18n;

const TERMINAL_OK = new Set(['CONFIRMED', 'COMPLETE']);
const TERMINAL_BAD = new Set(['FAILED', 'DENIED', 'CANCELLED']);

const ENV_PATH = path.resolve(process.cwd(), '.env');

function readEnv(): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of readFileSync(ENV_PATH, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (m) map.set(m[1]!, m[2]!.trim());
  }
  return map;
}

function upsertEnv(key: string, value: string): void {
  const raw = readFileSync(ENV_PATH, 'utf8');
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, 'm');
  writeFileSync(ENV_PATH, re.test(raw) ? raw.replace(re, line) : raw.replace(/\n?$/, `\n${line}\n`), 'utf8');
}

function required(env: Map<string, string>, key: string): string {
  const v = env.get(key);
  if (!v) throw new Error(`.env: ${key} missing`);
  return v;
}

const TELLER_ABI = parseAbi([
  'function authority() view returns (address)',
  'function share() view returns (address)',
]);
const AUTH_ABI = parseAbi(['function canCall(address user, address target, bytes4 sig) view returns (bool)']);
const DEPOSIT_SIG = toFunctionSelector('deposit(uint256,address)');
const SHARE_TRANSFER_SIG = toFunctionSelector('transfer(address,uint256)');

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const execute = args.includes('--execute');
  const fundArg = args.includes('--fund') ? args[args.indexOf('--fund') + 1] : undefined;

  const env = readEnv();
  const companyAddress = getAddress(required(env, 'COMPANY_ADDRESS'));
  const agentAddress = getAddress(required(env, 'AGENT_ADDRESS'));
  const companyWalletId = required(env, 'CIRCLE_COMPANY_WALLET_ID');

  const pub = createPublicClient({ transport: http(RPC, { retryCount: 3 }) });

  console.log('AgentMandateV2 DEPLOY — Arc testnet, alongside v1\n');
  console.log(`  owner (company) : ${companyAddress}`);
  console.log(`  agent           : ${agentAddress}`);
  console.log(`  usdc (6-dec)    : ${USDC_ERC20}`);
  console.log(`  bounds          : floor ${FLOOR} · ticket ${MAX_TICKET} · daily ${DAILY_CAP}`);
  console.log(`  existing v1     : ${env.get('AGENT_MANDATE_ADDRESS') ?? '(none in .env)'}  — NOT modified`);

  const { abi, bytecode } = compileMandateV2();
  console.log(`  bytecode        : ${(bytecode.length - 2) / 2} bytes`);

  const companyNative = await pub.getBalance({ address: companyAddress });
  console.log(`  company balance : ${formatUnits(companyNative, 18)} USDC (need ≥ ${formatUnits(MIN_COMPANY_NATIVE, 18)} for gas)`);

  // Venue permissioning preflight — the thing that actually gates "the surplus earns yield".
  const authority = await pub.readContract({ address: USYC_TELLER, abi: TELLER_ABI, functionName: 'authority' });
  const shareToken = await pub.readContract({ address: USYC_TELLER, abi: TELLER_ABI, functionName: 'share' });
  const canCall = (user: `0x${string}`, target: `0x${string}`, sig: `0x${string}`) =>
    pub.readContract({ address: authority as `0x${string}`, abi: AUTH_ABI, functionName: 'canCall', args: [user, target, sig] });
  const agentMayDeposit = await canCall(agentAddress, USYC_TELLER, DEPOSIT_SIG);
  console.log(`\n  USYC RolesAuthority : ${authority}`);
  console.log(`  agent EOA may Teller.deposit : ${agentMayDeposit ? 'YES' : 'NO'}`);
  console.log('  A NEW contract address holds no role: Teller.deposit reverts NotPermissioned() until');
  console.log('  the issuer grants it one. Deploy first, then request the role, then setVenue.');

  if (!execute) {
    console.log('\n  (preflight only — nothing deployed. Re-run with --execute to deploy.)');
    return;
  }

  if (companyNative < MIN_COMPANY_NATIVE) {
    throw new Error(`company wallet has ${formatUnits(companyNative, 18)} USDC, below the ${formatUnits(MIN_COMPANY_NATIVE, 18)} gas floor. Top it up first.`);
  }

  const client = initiateDeveloperControlledWalletsClient({
    apiKey: required(env, 'CIRCLE_API_KEY'),
    entitySecret: required(env, 'CIRCLE_ENTITY_SECRET'),
  });

  const waitCircle = async (txId: string, label: string) => {
    const started = Date.now();
    for (;;) {
      const res = await client.getTransaction({ id: txId });
      const state = res.data?.transaction?.state ?? 'UNKNOWN';
      if (TERMINAL_OK.has(state)) return res.data!.transaction!;
      if (TERMINAL_BAD.has(state)) {
        throw new Error(`${label}: ${state} (${res.data?.transaction?.errorReason ?? 'no reason'})`);
      }
      if (Date.now() - started > 180_000) throw new Error(`${label}: timeout (${state})`);
      await new Promise((r) => setTimeout(r, 2_000));
    }
  };

  // ── Deploy via Circle's Smart Contract Platform (the route that put v1 on chain) ──
  const { initiateSmartContractPlatformClient } = await import('@circle-fin/smart-contract-platform');
  const scp = initiateSmartContractPlatformClient({
    apiKey: required(env, 'CIRCLE_API_KEY'),
    entitySecret: required(env, 'CIRCLE_ENTITY_SECRET'),
  });
  console.log('\n[1] SCP deployContract on ARC-TESTNET from the company wallet…');
  const deployed = await scp.deployContract({
    name: 'AgentMandateV2',
    walletId: companyWalletId,
    blockchain: 'ARC-TESTNET' as never,
    abiJson: JSON.stringify(abi),
    bytecode,
    // NOTE: Circle's `description` validator is strictly alphanumeric — hyphens/punctuation 400.
    constructorParameters: [
      agentAddress,
      FLOOR.toString(),
      MAX_TICKET.toString(),
      DAILY_CAP.toString(),
      USDC_ERC20,
    ],
    fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
  });
  const circleTxId = deployed.data?.transactionId;
  if (!circleTxId) throw new Error(`SCP deployContract returned no transactionId: ${JSON.stringify(deployed.data)}`);
  const tx = await waitCircle(circleTxId, 'SCP deploy');
  const receipt = await pub.waitForTransactionReceipt({ hash: tx.txHash as `0x${string}`, timeout: 180_000 });
  if (receipt.status !== 'success' || !receipt.contractAddress) {
    throw new Error(`SCP deploy reverted or returned no contract address (status ${receipt.status})`);
  }
  const mandate = receipt.contractAddress;
  const deployBlock = receipt.blockNumber;
  console.log(`[1] AgentMandateV2 DEPLOYED: ${mandate} (block ${deployBlock})`);
  console.log(`    https://testnet.arcscan.app/address/${mandate}`);

  // ── Sanity reads — a mandate wired to the wrong owner/agent is worse than no mandate ──
  const read = (fn: string) => pub.readContract({ address: mandate, abi: abi as never, functionName: fn });
  const [ownerOnChain, agentOnChain, usdcOnChain] = await Promise.all([read('owner'), read('agent'), read('usdc')]);
  console.log(`[2] owner=${ownerOnChain} agent=${agentOnChain} usdc=${usdcOnChain}`);
  if ((ownerOnChain as string).toLowerCase() !== companyAddress.toLowerCase()) throw new Error('owner mismatch!');
  if ((agentOnChain as string).toLowerCase() !== agentAddress.toLowerCase()) throw new Error('agent mismatch!');

  // v2 goes in NEW env keys — AGENT_MANDATE_ADDRESS keeps pointing at v1, which stays live.
  upsertEnv('AGENT_MANDATE_V2_ADDRESS', mandate);
  upsertEnv('AGENT_MANDATE_V2_DEPLOY_BLOCK', deployBlock.toString());

  // ── Optional: seed the company pool (native value in, proven path) ──
  if (fundArg) {
    console.log(`[3] fundCompany({ value: ${fundArg} USDC })…`);
    const fund = await client.createContractExecutionTransaction({
      walletId: companyWalletId,
      contractAddress: mandate,
      abiFunctionSignature: 'fundCompany()',
      abiParameters: [],
      amount: fundArg,
      fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
    });
    const fundTx = await waitCircle(fund.data!.id, 'fundCompany');
    console.log(`[3] fundCompany COMPLETE: https://testnet.arcscan.app/tx/${fundTx.txHash}`);
    console.log(`[3] companyBalance = ${await read('companyBalance')}`);
  }

  // ── What is still needed before the deployed surplus actually earns ──
  const mandateMayDeposit = await canCall(mandate, USYC_TELLER, DEPOSIT_SIG);
  const mandateMayHoldShares = await canCall(mandate, shareToken as `0x${string}`, SHARE_TRANSFER_SIG);
  console.log('\nNEXT STEPS');
  console.log(`  verify   : npx tsx verifier/src/cli.ts --address ${mandate} --deploy-block ${deployBlock}`);
  console.log(`  USYC permission for ${mandate}:`);
  console.log(`    Teller.deposit  : ${mandateMayDeposit ? 'GRANTED' : 'NOT GRANTED'}`);
  console.log(`    hold USYC share : ${mandateMayHoldShares ? 'GRANTED' : 'NOT GRANTED'}`);
  if (!mandateMayDeposit || !mandateMayHoldShares) {
    console.log('    → ask Circle/Hashnote support to add this CONTRACT address to the USYC allowlist.');
    console.log('      Both roles are required: the caller subscribes, the receiver holds the share.');
  }
  console.log(`  then     : owner calls setVenue(${USYC_TELLER}) from the company wallet.`);
  console.log('  until then the mandate is escrow-only — identical to v1, and honestly so.');
}

main().catch((err) => {
  console.error('deploy-mandate-v2 failed:', err?.response?.data ?? err);
  process.exit(1);
});
