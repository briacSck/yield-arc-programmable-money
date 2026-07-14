/**
 * Deploys AgentMandate to Arc testnet FROM THE COMPANY CIRCLE WALLET (owner = msg.sender), then
 * funds the company pool. Runs the plan's 20-minute SPIKE GATE: the raw-signed deploy path
 * (Circle SDK `signTransaction` on a to:null EIP-1559 tx → `eth_sendRawTransaction`) is unproven;
 * if it fights back, this script STOPS and reports — fallbacks are the SCP SDK or Vadim's
 * Hardhat path. Never grinds.
 *
 * Run: npx tsx agent/scripts/deploy-mandate.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createPublicClient, encodeDeployData, http, parseGwei } from 'viem';
import { initiateDeveloperControlledWalletsClient } from '@circle-fin/developer-controlled-wallets';
import { compileMandate } from './compile-mandate.js';

// Demo mandate constants (6-dec USDC base units) — small real amounts, agent floor ≥ chain floor
// by construction (two-floor doctrine).
const FLOOR = 5_000_000n; // 5 USDC
const MAX_TICKET = 2_000_000n; // 2 USDC
const DAILY_CAP = 5_000_000n; // 5 USDC
const FUND_USDC = '10'; // fundCompany native value, decimal USDC (→ 10_000_000 pool units)
const MIN_COMPANY_NATIVE = 12n * 10n ** 18n; // gas + funding headroom

const ENV_PATH = path.resolve(process.cwd(), '.env');

function readEnv(): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of readFileSync(ENV_PATH, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (m) map.set(m[1], m[2].trim());
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

const TERMINAL_OK = new Set(['CONFIRMED', 'COMPLETE']);
const TERMINAL_BAD = new Set(['FAILED', 'DENIED', 'CANCELLED']);

async function main(): Promise<void> {
  const env = readEnv();
  const client = initiateDeveloperControlledWalletsClient({
    apiKey: required(env, 'CIRCLE_API_KEY'),
    entitySecret: required(env, 'CIRCLE_ENTITY_SECRET'),
  });
  const companyWalletId = required(env, 'CIRCLE_COMPANY_WALLET_ID');
  const companyAddress = required(env, 'COMPANY_ADDRESS') as `0x${string}`;
  const agentWalletId = required(env, 'CIRCLE_AGENT_WALLET_ID');
  const agentAddress = required(env, 'AGENT_ADDRESS') as `0x${string}`;
  const rpcUrl = required(env, 'ARC_RPC_URL');
  const chainId = Number(required(env, 'ARC_CHAIN_ID').split(/\s/)[0]);

  const pub = createPublicClient({ transport: http(rpcUrl) });

  const waitCircle = async (txId: string, label: string) => {
    const started = Date.now();
    for (;;) {
      const res = await client.getTransaction({ id: txId });
      const state = res.data?.transaction?.state ?? 'UNKNOWN';
      if (TERMINAL_OK.has(state)) return res.data!.transaction!;
      if (TERMINAL_BAD.has(state)) {
        throw new Error(`${label}: ${state} (${res.data?.transaction?.errorReason ?? 'no reason'})`);
      }
      if (Date.now() - started > 120_000) throw new Error(`${label}: timeout (${state})`);
      await new Promise((r) => setTimeout(r, 2_000));
    }
  };

  // ── 0. Pre-fund the company wallet (eng review #22: a gasless deploy fails misleadingly) ──
  const companyNative = await pub.getBalance({ address: companyAddress });
  console.log(`[0] company native balance: ${companyNative} (need ≥ ${MIN_COMPANY_NATIVE})`);
  if (companyNative < MIN_COMPANY_NATIVE) {
    console.log('[0] transferring 12 USDC agent → company for gas + funding…');
    const balances = await client.getWalletTokenBalance({ id: agentWalletId, includeAll: true });
    const usdc = (balances.data?.tokenBalances ?? []).find((b) => b.token?.symbol?.startsWith('USDC'));
    if (!usdc?.token?.id) throw new Error('agent wallet has no USDC balance to transfer from');
    const t = await client.createTransaction({
      walletId: agentWalletId,
      tokenId: usdc.token.id,
      destinationAddress: companyAddress,
      amount: ['12'],
      fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
    });
    await waitCircle(t.data!.id, 'prefund transfer');
    console.log('[0] prefund COMPLETE');
  }

  // ── 1. SPIKE GATE: raw-signed contract deployment from the Circle company wallet ──
  const { abi, bytecode } = compileMandate();
  const deployData = encodeDeployData({
    abi: abi as never,
    bytecode,
    args: [agentAddress, FLOOR, MAX_TICKET, DAILY_CAP],
  });
  const nonce = await pub.getTransactionCount({ address: companyAddress });
  const gas = await pub.estimateGas({ account: companyAddress, data: deployData });
  const txJson = {
    chainId,
    nonce,
    type: 2,
    maxFeePerGas: `0x${parseGwei('25').toString(16)}`,
    maxPriorityFeePerGas: `0x${parseGwei('1').toString(16)}`,
    gas: `0x${((gas * 12n) / 10n).toString(16)}`,
    value: '0x0',
    data: deployData,
  };
  console.log(`[1] spike: signTransaction for a to:null deploy (nonce ${nonce}, gas ~${gas})…`);

  let mandate: `0x${string}` | undefined;

  // Path A (spike): raw-signed deploy. VERDICT 2026-07-14: Circle returns 156027 "blockchain not
  // supported" for /developer/sign/transaction on ARC-TESTNET — raw signing is not enabled for
  // Arc yet. Kept as the first try so the gate re-opens automatically if Circle enables it.
  try {
    const signed = await client.signTransaction({
      walletId: companyWalletId,
      transaction: JSON.stringify(txJson),
      memo: 'Deploy AgentMandate (YIELD day-2 spike gate)',
    });
    const signedTx = signed.data?.signedTransaction;
    if (signedTx) {
      const txHash = await pub.request({ method: 'eth_sendRawTransaction', params: [signedTx as `0x${string}`] });
      console.log(`[1] raw-sign path broadcast: ${txHash}`);
      const receipt = await pub.waitForTransactionReceipt({ hash: txHash as `0x${string}`, timeout: 120_000 });
      if (receipt.status === 'success' && receipt.contractAddress) mandate = receipt.contractAddress;
    }
  } catch (err) {
    const detail = (err as { response?: { data?: unknown } })?.response?.data ?? (err as Error).message;
    console.log(`[1] raw-sign path unavailable (${JSON.stringify(detail)}) → falling back to SCP deployContract.`);
  }

  // Path B (fallback 1): Circle Smart Contract Platform deploy — the tutorial-blessed Arc path.
  if (!mandate) {
    const { initiateSmartContractPlatformClient } = await import('@circle-fin/smart-contract-platform');
    const scp = initiateSmartContractPlatformClient({
      apiKey: required(env, 'CIRCLE_API_KEY'),
      entitySecret: required(env, 'CIRCLE_ENTITY_SECRET'),
    });
    console.log('[1] SCP deployContract on ARC-TESTNET from the company wallet…');
    let deployed;
    try {
      deployed = await scp.deployContract({
        name: 'AgentMandate',
        // NOTE: Circle's `description` validator is strictly alphanumeric — hyphens/punctuation 400.
        walletId: companyWalletId,
        blockchain: 'ARC-TESTNET' as never,
        abiJson: JSON.stringify(abi),
        bytecode,
        constructorParameters: [agentAddress, FLOOR.toString(), MAX_TICKET.toString(), DAILY_CAP.toString()],
        fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
      });
    } catch (err) {
      const resp = (err as { response?: { data?: unknown; status?: number } }).response;
      console.error('[1] SCP deployContract error detail:', JSON.stringify(resp?.data ?? (err as Error).message, null, 2));
      throw err;
    }
    const circleTxId = deployed.data?.transactionId;
    if (!circleTxId) throw new Error(`SCP deployContract returned no transactionId: ${JSON.stringify(deployed.data)}`);
    const tx = await waitCircle(circleTxId, 'SCP deploy');
    const receipt = await pub.waitForTransactionReceipt({ hash: tx.txHash as `0x${string}`, timeout: 120_000 });
    if (receipt.status !== 'success' || !receipt.contractAddress) {
      throw new Error(`SCP deploy reverted or no contract address (status ${receipt.status})`);
    }
    mandate = receipt.contractAddress;
  }
  console.log(`[1] AgentMandate DEPLOYED: ${mandate}`);
  console.log(`    https://testnet.arcscan.app/address/${mandate}`);
  upsertEnv('AGENT_MANDATE_ADDRESS', mandate);
  upsertEnv('OWNER_ADDRESS', companyAddress);

  // ── 2. Sanity reads: owner/agent wiring (eng review #23 preflight) ──
  const [ownerOnChain, agentOnChain] = await Promise.all([
    pub.readContract({ address: mandate, abi: abi as never, functionName: 'owner' }),
    pub.readContract({ address: mandate, abi: abi as never, functionName: 'agent' }),
  ]);
  console.log(`[2] owner=${ownerOnChain} (company ${companyAddress}), agent=${agentOnChain} (agent ${agentAddress})`);
  if ((ownerOnChain as string).toLowerCase() !== companyAddress.toLowerCase()) throw new Error('owner mismatch!');
  if ((agentOnChain as string).toLowerCase() !== agentAddress.toLowerCase()) throw new Error('agent mismatch!');

  // ── 3. fundCompany with native value (proven createContractExecutionTransaction path) ──
  console.log(`[3] fundCompany({ value: ${FUND_USDC} USDC }) from the company wallet…`);
  const fund = await client.createContractExecutionTransaction({
    walletId: companyWalletId,
    contractAddress: mandate,
    abiFunctionSignature: 'fundCompany()',
    abiParameters: [],
    amount: FUND_USDC,
    fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
  });
  const fundTx = await waitCircle(fund.data!.id, 'fundCompany');
  console.log(`[3] fundCompany COMPLETE: https://testnet.arcscan.app/tx/${fundTx.txHash}`);

  const pool = await pub.readContract({ address: mandate, abi: abi as never, functionName: 'companyBalance' });
  console.log(`[3] companyBalance = ${pool} (expected ${BigInt(FUND_USDC) * 1_000_000n})`);
  console.log('DEPLOY + FUND COMPLETE.');
}

main().catch((err) => {
  console.error('deploy-mandate failed:', err?.response?.data ?? err);
  process.exit(1);
});
