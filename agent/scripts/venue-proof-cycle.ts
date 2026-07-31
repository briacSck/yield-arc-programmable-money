/**
 * The USYC proof cycle on AgentMandateV2 — the two transactions the video and README cite:
 *
 *   fund (if needed) → deposit → VenueSubscribed (USDC → USYC shares)
 *                    → withdrawToCompany(full basis) → VenueRedeemed (shares → USDC) → yield delta
 *
 *   Preflight (default, READ-ONLY, moves nothing):  npx tsx agent/scripts/venue-proof-cycle.ts
 *   Run for real (spends testnet USDC):             npx tsx agent/scripts/venue-proof-cycle.ts --execute
 *   Optional:                                       --amount 1.5   (USDC to deploy; default 1)
 *
 * Written by Vadim's lane per docs/HANDOFF-VADIM.md §3; BRIAC RUNS IT (Circle creds live only in
 * his .env / Railway). Runs AFTER setVenue (done 2026-07-31) — the deposit leg routes USDC into
 * USYC and the withdrawal leg redeems it back, all inside the mandate's gates. The worker and the
 * nightly audit still point at v1: this touches only the v2 mandate, whose history is additive.
 *
 * Receipts are REAL: forecastHash commits a canonical proof-inputs JSON (printed, reproducible)
 * and decisionId re-derives as keccak(utf8("<forecastHash>|<KIND>")) — so the venue-aware verifier
 * (`npx tsx verifier/src/cli.ts --address <v2> --deploy-block <n>`) verifies this cycle 5/5 with
 * the venue leg reconstructed, which is what upgrades "the surplus earns yield" from a claim to a
 * machine-verified statement.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createPublicClient, http, parseAbi, parseEventLogs, keccak256, toBytes, formatUnits, getAddress } from 'viem';
import { initiateDeveloperControlledWalletsClient } from '@circle-fin/developer-controlled-wallets';

const RPC = 'https://rpc.drpc.testnet.arc.io'; // the only endpoint that serves concurrent reads
const MANDATE_V2_DEFAULT = '0xd41d3648c71641fb2801415726787d5728492f70' as const;
const V2_DEPLOY_BLOCK_DEFAULT = '54088009';
const EXPLORER_TX = 'https://testnet.arcscan.app/tx/';

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

function required(env: Map<string, string>, key: string): string {
  const v = env.get(key);
  if (!v) throw new Error(`.env: ${key} missing`);
  return v;
}

const MANDATE_ABI = parseAbi([
  'function owner() view returns (address)',
  'function agent() view returns (address)',
  'function revoked() view returns (bool)',
  'function venue() view returns (address)',
  'function venueShare() view returns (address)',
  'function deployedShares() view returns (uint256)',
  'function companyBalance() view returns (uint256)',
  'function deployedBalance() view returns (uint256)',
  'function floorUsdc() view returns (uint256)',
  'function maxTicketUsdc() view returns (uint256)',
  'function dailyCapUsdc() view returns (uint256)',
  'event VenueSubscribed(bytes32 indexed decisionId, uint256 assetsIn, uint256 sharesMinted)',
  'event VenueRedeemed(bytes32 indexed decisionId, uint256 sharesBurned, uint256 assetsOut, uint256 assetsRequested)',
  'event DecisionExecuted(bytes32 indexed decisionId, uint8 kind, uint256 amount, bytes32 forecastHash)',
]);
const TELLER_ABI = parseAbi(['function previewDeposit(uint256 assets) view returns (uint256)']);

const fmt6 = (n: bigint) => formatUnits(n, 6);

/**
 * The receipt preimage — canonical form: sorted keys, no whitespace (the same discipline as the
 * worker's canonicalInputsJson). Reproduce the hash: keccak256(utf8 of the printed JSON).
 */
function proofInputs(kind: 'DEPLOY' | 'WITHDRAW', amountUsdc: bigint, mandate: string): { json: string; forecastHash: `0x${string}`; decisionId: `0x${string}` } {
  const obj = {
    amountUsdc: amountUsdc.toString(),
    asOf: new Date().toISOString(),
    kind,
    mandate: mandate.toLowerCase(),
    scenario: 'usyc-proof-cycle',
  };
  const json = JSON.stringify(obj, Object.keys(obj).sort());
  const forecastHash = keccak256(toBytes(json));
  const decisionId = keccak256(toBytes(`${forecastHash}|${kind}`));
  return { json, forecastHash, decisionId };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const execute = args.includes('--execute');
  const amountArg = args.includes('--amount') ? args[args.indexOf('--amount') + 1] : '1';
  const amount = BigInt(Math.round(Number(amountArg) * 1_000_000));
  if (amount <= 0n) throw new Error(`--amount must be positive, got ${amountArg}`);

  const env = readEnv();
  const companyAddress = getAddress(required(env, 'COMPANY_ADDRESS'));
  const agentAddress = getAddress(required(env, 'AGENT_ADDRESS'));
  const mandate = getAddress(env.get('AGENT_MANDATE_V2_ADDRESS') ?? MANDATE_V2_DEFAULT);
  const deployBlock = env.get('AGENT_MANDATE_V2_DEPLOY_BLOCK') ?? V2_DEPLOY_BLOCK_DEFAULT;

  const pub = createPublicClient({ transport: http(RPC, { retryCount: 3 }) });

  console.log('USYC proof cycle — AgentMandateV2, Arc testnet\n');
  console.log(`  mandate v2   : ${mandate}`);
  console.log(`  deploy amount: ${fmt6(amount)} USDC`);

  // ── Preflight: every reason this could revert, checked BEFORE any money moves ──
  const [ownerOnChain, agentOnChain, revoked, venue, venueShare, sharesHeld, companyBalance, deployedBalance, floor, maxTicket, dailyCap] =
    await Promise.all([
      pub.readContract({ address: mandate, abi: MANDATE_ABI, functionName: 'owner' }),
      pub.readContract({ address: mandate, abi: MANDATE_ABI, functionName: 'agent' }),
      pub.readContract({ address: mandate, abi: MANDATE_ABI, functionName: 'revoked' }),
      pub.readContract({ address: mandate, abi: MANDATE_ABI, functionName: 'venue' }),
      pub.readContract({ address: mandate, abi: MANDATE_ABI, functionName: 'venueShare' }),
      pub.readContract({ address: mandate, abi: MANDATE_ABI, functionName: 'deployedShares' }),
      pub.readContract({ address: mandate, abi: MANDATE_ABI, functionName: 'companyBalance' }),
      pub.readContract({ address: mandate, abi: MANDATE_ABI, functionName: 'deployedBalance' }),
      pub.readContract({ address: mandate, abi: MANDATE_ABI, functionName: 'floorUsdc' }),
      pub.readContract({ address: mandate, abi: MANDATE_ABI, functionName: 'maxTicketUsdc' }),
      pub.readContract({ address: mandate, abi: MANDATE_ABI, functionName: 'dailyCapUsdc' }),
    ]);

  console.log(`  owner        : ${ownerOnChain}${ownerOnChain.toLowerCase() === companyAddress.toLowerCase() ? ' (= COMPANY_ADDRESS)' : '  ⚠️ ≠ COMPANY_ADDRESS'}`);
  console.log(`  agent        : ${agentOnChain}${agentOnChain.toLowerCase() === agentAddress.toLowerCase() ? ' (= AGENT_ADDRESS)' : '  ⚠️ ≠ AGENT_ADDRESS'}`);
  console.log(`  revoked      : ${revoked}`);
  console.log(`  venue        : ${venue}`);
  console.log(`  venueShare   : ${venueShare}`);
  console.log(`  position     : ${sharesHeld} share(s), basis ${fmt6(deployedBalance)} USDC`);
  console.log(`  company pool : ${fmt6(companyBalance)} USDC · floor ${fmt6(floor)} · ticket ${fmt6(maxTicket)} · daily ${fmt6(dailyCap)}`);

  if (agentOnChain.toLowerCase() !== agentAddress.toLowerCase()) throw new Error('agent mismatch — refusing');
  if (revoked) throw new Error('mandate is REVOKED — deposit would revert; reinstate first');
  if (venue === '0x0000000000000000000000000000000000000000') throw new Error('venue unset — run set-venue.ts first');
  if (amount > maxTicket) throw new Error(`amount ${fmt6(amount)} exceeds the ticket cap ${fmt6(maxTicket)} — the mandate would revert (that is the product)`);

  const expectedShares = await pub.readContract({ address: venue, abi: TELLER_ABI, functionName: 'previewDeposit', args: [amount] });
  console.log(`  previewDeposit(${fmt6(amount)}) : ${expectedShares} share(s) expected`);

  const fundNeeded = companyBalance < amount + floor ? amount + floor - companyBalance : 0n;
  if (fundNeeded > 0n) {
    if (fundNeeded % 1_000_000n !== 0n) {
      // fundCompany takes whole native units in the Circle `amount` field — round up to whole USDC.
      console.log(`  fund needed  : ${fmt6(fundNeeded)} USDC → rounding up to whole USDC`);
    }
    console.log(`  fund needed  : ${fmt6(fundNeeded)} USDC (companyBalance < amount + floor) — will fundCompany first`);
  } else {
    console.log('  fund needed  : none (pool clears amount + floor)');
  }

  const wd = { json: '', forecastHash: '' as `0x${string}`, decisionId: '' as `0x${string}` };
  const dp = proofInputs('DEPLOY', amount, mandate);
  console.log(`\n  DEPLOY receipt preimage : ${dp.json}`);
  console.log(`  forecastHash            : ${dp.forecastHash}`);
  console.log(`  decisionId              : ${dp.decisionId}`);

  if (!execute) {
    console.log('\n  (preflight only — nothing sent. Re-run with --execute to run the cycle.)');
    return;
  }

  const client = initiateDeveloperControlledWalletsClient({
    apiKey: required(env, 'CIRCLE_API_KEY'),
    entitySecret: required(env, 'CIRCLE_ENTITY_SECRET'),
  });
  const agentWalletId = required(env, 'CIRCLE_AGENT_WALLET_ID');
  const companyWalletId = required(env, 'CIRCLE_COMPANY_WALLET_ID');

  const waitCircle = async (txId: string, label: string) => {
    const started = Date.now();
    for (;;) {
      const res = await client.getTransaction({ id: txId });
      const state = res.data?.transaction?.state ?? 'UNKNOWN';
      if (TERMINAL_OK.has(state)) return res.data!.transaction!;
      if (TERMINAL_BAD.has(state)) throw new Error(`${label}: ${state} (${res.data?.transaction?.errorReason ?? 'no reason'})`);
      if (Date.now() - started > 180_000) throw new Error(`${label}: timeout (${state})`);
      await new Promise((r) => setTimeout(r, 2_000));
    }
  };

  const runTx = async (walletId: string, fn: string, params: string[], label: string, amountField?: string) => {
    const res = await client.createContractExecutionTransaction({
      walletId,
      contractAddress: mandate,
      abiFunctionSignature: fn,
      abiParameters: params,
      ...(amountField ? { amount: amountField } : {}),
      fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
    });
    const txId = res.data?.id;
    if (!txId) throw new Error(`${label}: createContractExecutionTransaction returned no id`);
    const tx = await waitCircle(txId, label);
    const receipt = await pub.waitForTransactionReceipt({ hash: tx.txHash as `0x${string}`, timeout: 180_000 });
    if (receipt.status !== 'success') throw new Error(`${label}: reverted (${tx.txHash})`);
    console.log(`  ${label} COMPLETE: ${EXPLORER_TX}${tx.txHash}`);
    return receipt;
  };

  // ── [1] Fund if the pool would not clear amount + floor ──
  if (fundNeeded > 0n) {
    const wholeUsdc = ((fundNeeded + 999_999n) / 1_000_000n).toString();
    console.log(`\n[1] fundCompany({ value: ${wholeUsdc} USDC }) from the company wallet…`);
    await runTx(companyWalletId, 'fundCompany()', [], 'fundCompany', wholeUsdc);
  } else {
    console.log('\n[1] fund step skipped — pool already clears amount + floor');
  }

  // ── [2] DEPLOY from the AGENT wallet: the mandate subscribes the venue ──
  console.log(`\n[2] deposit(${fmt6(amount)}, …) from the agent wallet…`);
  const depReceipt = await runTx(agentWalletId, 'deposit(uint256,bytes32,bytes32)', [amount.toString(), dp.decisionId, dp.forecastHash], 'deposit');
  const depLogs = parseEventLogs({ abi: MANDATE_ABI, logs: depReceipt.logs, strict: false });
  const sub = depLogs.find((l) => l.eventName === 'VenueSubscribed');
  if (!sub) throw new Error('deposit succeeded but no VenueSubscribed — venue did not engage?');
  const subArgs = sub.args as { assetsIn: bigint; sharesMinted: bigint };
  console.log(`  VenueSubscribed: ${fmt6(subArgs.assetsIn)} USDC → ${subArgs.sharesMinted} USYC share(s)`);

  // ── [3] WITHDRAW the full basis from the AGENT wallet: full unwind, gain realised ──
  const basisNow = await pub.readContract({ address: mandate, abi: MANDATE_ABI, functionName: 'deployedBalance' });
  const w = proofInputs('WITHDRAW', basisNow, mandate);
  Object.assign(wd, w);
  console.log(`\n[3] withdrawToCompany(${fmt6(basisNow)}, …) — full unwind…`);
  console.log(`  WITHDRAW receipt preimage : ${w.json}`);
  const wdReceipt = await runTx(agentWalletId, 'withdrawToCompany(uint256,bytes32,bytes32)', [basisNow.toString(), w.decisionId, w.forecastHash], 'withdraw');
  const wdLogs = parseEventLogs({ abi: MANDATE_ABI, logs: wdReceipt.logs, strict: false });
  const red = wdLogs.find((l) => l.eventName === 'VenueRedeemed');
  if (!red) throw new Error('withdraw succeeded but no VenueRedeemed — venue did not engage?');
  const redArgs = red.args as { sharesBurned: bigint; assetsOut: bigint; assetsRequested: bigint };
  console.log(`  VenueRedeemed: ${redArgs.sharesBurned} share(s) → ${fmt6(redArgs.assetsOut)} USDC (requested ${fmt6(redArgs.assetsRequested)})`);

  // ── [4] The number the video cites ──
  const delta = redArgs.assetsOut - subArgs.assetsIn;
  const sign = delta >= 0n ? '+' : '';
  console.log(`\nPROOF CYCLE COMPLETE`);
  console.log(`  in  : ${fmt6(subArgs.assetsIn)} USDC → ${subArgs.sharesMinted} USYC share(s)`);
  console.log(`  out : ${redArgs.sharesBurned} share(s) → ${fmt6(redArgs.assetsOut)} USDC`);
  console.log(`  delta vs subscribed: ${sign}${fmt6(delta)} USDC (NAV round-trip — honest number, sign and all)`);
  console.log(`\n  Machine-verify it (venue leg reconstructed):`);
  console.log(`    npx tsx verifier/src/cli.ts --address ${mandate} --deploy-block ${deployBlock}`);
}

main().catch((err) => {
  console.error('venue-proof-cycle failed:', err?.response?.data ?? err);
  process.exit(1);
});
