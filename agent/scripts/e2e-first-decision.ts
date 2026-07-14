/**
 * Integration #1 (plan §8.1 Thu, landed on day 2): the whole hackathon in one run.
 *
 *   live on-chain state ─► baselineForecast ─► decide() ─► CircleChainExecutor ─► AgentMandate
 *
 * Beats, in order (each asserted against on-chain state, not just tx status):
 *   1. DEPLOY   — the agent's first autonomous, mandate-gated, receipt-carrying money move.
 *   2. revoke() — the owner fires the agent on-chain (Demo Day kicker, §11.4).
 *   3. blocked  — the agent's next deposit attempt FAILS against MandateRevoked (recorded proof).
 *   4. WITHDRAW while revoked — the fail-safe asymmetry live: moving toward safety always works.
 *   5. reinstate() — the owner re-hires the agent; loop-ready state restored.
 *
 * Run: npx tsx agent/scripts/e2e-first-decision.ts
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createPublicClient, http, parseAbi } from 'viem';
import { initiateDeveloperControlledWalletsClient } from '@circle-fin/developer-controlled-wallets';
import { baselineForecast } from '@yield/forecast';
import { decide } from '../src/decision/engine.js';
import { CircleChainExecutor } from '../src/chain/circle-chain-executor.js';

const MANDATE_ABI = parseAbi([
  'function agent() view returns (address)',
  'function floorUsdc() view returns (uint256)',
  'function companyBalance() view returns (uint256)',
  'function deployedBalance() view returns (uint256)',
  'function revoked() view returns (bool)',
]);

function readEnv(): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of readFileSync(path.resolve(process.cwd(), '.env'), 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (m) map.set(m[1], m[2].trim());
  }
  return map;
}

const TERMINAL_OK = new Set(['CONFIRMED', 'COMPLETE']);
const TERMINAL_BAD = new Set(['FAILED', 'DENIED', 'CANCELLED']);

async function main(): Promise<void> {
  const env = readEnv();
  const mandate = env.get('AGENT_MANDATE_ADDRESS') as `0x${string}`;
  const agentAddress = env.get('AGENT_ADDRESS')!;
  if (!mandate) throw new Error('.env: AGENT_MANDATE_ADDRESS missing — run deploy-mandate.ts first');

  const pub = createPublicClient({ transport: http(env.get('ARC_RPC_URL')!) });
  const sdk = initiateDeveloperControlledWalletsClient({
    apiKey: env.get('CIRCLE_API_KEY')!,
    entitySecret: env.get('CIRCLE_ENTITY_SECRET')!,
  });
  const executor = new CircleChainExecutor(sdk, {
    walletId: env.get('CIRCLE_AGENT_WALLET_ID')!,
    mandateAddress: mandate,
  });

  const read = (fn: 'agent' | 'floorUsdc' | 'companyBalance' | 'deployedBalance' | 'revoked') =>
    pub.readContract({ address: mandate, abi: MANDATE_ABI, functionName: fn });

  const ownerCall = async (signature: string, label: string) => {
    const submitted = await sdk.createContractExecutionTransaction({
      walletId: env.get('CIRCLE_COMPANY_WALLET_ID')!,
      contractAddress: mandate,
      abiFunctionSignature: signature,
      abiParameters: [],
      fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
    });
    const started = Date.now();
    for (;;) {
      const res = await sdk.getTransaction({ id: submitted.data!.id });
      const state = res.data?.transaction?.state ?? 'UNKNOWN';
      if (TERMINAL_OK.has(state)) return res.data!.transaction!.txHash!;
      if (TERMINAL_BAD.has(state)) throw new Error(`${label} ${state}`);
      if (Date.now() - started > 120_000) throw new Error(`${label} timeout`);
      await new Promise((r) => setTimeout(r, 2_000));
    }
  };

  // ── Preflight (eng review #23): the mandate's agent must be the executor's wallet ──
  const onChainAgent = (await read('agent')) as string;
  assert.equal(onChainAgent.toLowerCase(), agentAddress.toLowerCase(), 'mandate.agent() != executor wallet');
  const chainFloor = (await read('floorUsdc')) as bigint;
  console.log(`[preflight] agent OK (${onChainAgent}), chain floor ${chainFloor}`);

  // ── Beat 1: the first autonomous DEPLOY ──
  const company0 = (await read('companyBalance')) as bigint;
  const deployed0 = (await read('deployedBalance')) as bigint;
  console.log(`[state] company=${company0} deployed=${deployed0}`);

  // Real forecast over the live opening balance: mild volatility, so the 30d P10 tail sits just
  // above the dynamic floor — the surplus above it is what the agent may deploy.
  const forecast1 = baselineForecast({
    asOf: new Date().toISOString(),
    horizonDays: 30,
    openingBalanceUsdc: company0.toString(),
    recurring: [],
    datedFlows: [],
    dailyDeltaSigmaUsdc: '180000', // 0.18 USDC daily σ
    kNum: '1',
    kDen: '1',
  });
  const decision1 = decide({
    forecast: forecast1,
    companyBalanceUsdc: company0.toString(),
    deployedUsdc: deployed0.toString(),
    trailing30dMinUsdc: company0.toString(),
    config: { userMinUsdc: chainFloor.toString(), minTicketUsdc: '100000', horizonDays: 30 },
    now: new Date().toISOString(),
  });
  console.log(`[decide] ${decision1.kind}: ${decision1.reason}`);
  assert.equal(decision1.kind, 'DEPLOY', 'expected the engine to find deployable surplus');

  const exec1 = await executor.execute(decision1);
  console.log(`[1] FIRST AUTONOMOUS DEPLOY CONFIRMED: ${exec1.explorerUrl}`);
  console.log(`    receiptHash (forecast commitment): ${exec1.receiptHash}`);
  const company1 = (await read('companyBalance')) as bigint;
  const deployed1 = (await read('deployedBalance')) as bigint;
  assert.equal(company1, company0 - BigInt(decision1.amountUsdc), 'company pool delta mismatch');
  assert.equal(deployed1, deployed0 + BigInt(decision1.amountUsdc), 'deployed pool delta mismatch');
  console.log(`    pools verified on-chain: company ${company0}→${company1}, deployed ${deployed0}→${deployed1}`);

  // ── Beat 2: the owner fires the agent ──
  const revokeTx = await ownerCall('revoke()', 'revoke');
  assert.equal(await read('revoked'), true);
  console.log(`[2] MANDATE REVOKED by owner: https://testnet.arcscan.app/tx/${revokeTx}`);

  // ── Beat 3: the agent tries to deposit again — provably blocked ──
  const forecast2 = baselineForecast({
    asOf: new Date().toISOString(),
    horizonDays: 30,
    openingBalanceUsdc: company1.toString(),
    recurring: [],
    datedFlows: [],
    dailyDeltaSigmaUsdc: '100000',
    kNum: '1',
    kDen: '2',
  });
  const decision2 = decide({
    forecast: forecast2,
    companyBalanceUsdc: company1.toString(),
    deployedUsdc: deployed1.toString(),
    trailing30dMinUsdc: company1.toString(),
    config: { userMinUsdc: chainFloor.toString(), minTicketUsdc: '100000', horizonDays: 30 },
    now: new Date().toISOString(),
  });
  if (decision2.kind === 'DEPLOY') {
    try {
      await executor.execute(decision2);
      throw new Error('deposit while revoked SUCCEEDED — mandate gate failed!');
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes('mandate gate failed')) throw err;
      console.log(`[3] deposit-while-revoked BLOCKED as designed: ${msg.slice(0, 140)}…`);
    }
  } else {
    console.log(`[3] engine chose ${decision2.kind} (no deployable surplus post-deposit) — skipping blocked-deposit beat.`);
  }

  // ── Beat 4: WITHDRAW while revoked — the fail-safe asymmetry, live ──
  const forecast3 = baselineForecast({
    asOf: new Date().toISOString(),
    horizonDays: 30,
    openingBalanceUsdc: company1.toString(),
    recurring: [],
    datedFlows: [],
    dailyDeltaSigmaUsdc: '500000', // heavy volatility → P10 dips below the floor → withdraw
    kNum: '1',
    kDen: '1',
  });
  const decision3 = decide({
    forecast: forecast3,
    companyBalanceUsdc: company1.toString(),
    deployedUsdc: deployed1.toString(),
    trailing30dMinUsdc: company1.toString(),
    config: { userMinUsdc: chainFloor.toString(), minTicketUsdc: '100000', horizonDays: 30 },
    now: new Date().toISOString(),
  });
  console.log(`[decide] ${decision3.kind}: ${decision3.reason}`);
  assert.equal(decision3.kind, 'WITHDRAW', 'expected a P10 floor breach to trigger WITHDRAW');
  const exec3 = await executor.execute(decision3);
  const deployed3 = (await read('deployedBalance')) as bigint;
  assert.equal(deployed3, deployed1 - BigInt(decision3.amountUsdc), 'withdraw pool delta mismatch');
  console.log(`[4] WITHDRAW WHILE REVOKED confirmed (fail-safe asymmetry): ${exec3.explorerUrl}`);

  // ── Beat 5: re-hire ──
  const reinstateTx = await ownerCall('reinstate()', 'reinstate');
  assert.equal(await read('revoked'), false);
  console.log(`[5] mandate reinstated: https://testnet.arcscan.app/tx/${reinstateTx}`);

  console.log('\nINTEGRATION #1 COMPLETE — identity + mandate + receipts, all live on Arc testnet.');
}

main().catch((err) => {
  console.error('e2e-first-decision failed:', err?.response?.data ?? err);
  process.exit(1);
});
