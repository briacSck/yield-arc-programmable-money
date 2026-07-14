import path from 'node:path';
import { createPublicClient, http, parseAbi } from 'viem';
import type { ForecastResult } from '@yield/shared';
import { baselineForecast } from '@yield/forecast';
import { defineArcChain } from './chain/arc-chain.js';
import { selectChainExecutor } from './chain/index.js';
import { EventLog } from './event-log.js';
import { startScheduler, type CycleDeps } from './scheduler.js';

/**
 * Agent entrypoint — wires the real dependencies into the scheduler and starts the Tier-1 loop.
 *
 *   SCHEDULER_MODE=observe (DEFAULT) — forecast → decide → log → heartbeat. No executor is even
 *     constructed; money cannot move. This is the safe uptime-clock mode.
 *   SCHEDULER_MODE=trade — additionally requires CHAIN_EXECUTOR=circle and
 *     AGENT_MANDATE_ADDRESS; balances are read LIVE from the mandate every cycle so decisions
 *     always see post-trade state (a static fixture can never drive live funds).
 *
 * Demo ledger: the §16.5 "Boulangerie Chartier" persona seeds the forecast; each cycle re-runs
 * it with a fresh `asOf`, which also keys the on-chain decisionId space per cycle.
 */

const MANDATE_ABI = parseAbi([
  'function companyBalance() view returns (uint256)',
  'function deployedBalance() view returns (uint256)',
]);

const U = (n: number) => (BigInt(n) * 1_000_000n).toString();

/** §16.5 Boulangerie Chartier — fixed seed; only `asOf` moves between cycles. */
export function boulangerieForecast(nowIso: string): ForecastResult {
  return baselineForecast({
    asOf: nowIso,
    horizonDays: 90,
    openingBalanceUsdc: U(38_000),
    recurring: [
      { label: 'payroll', dayOfMonth: 28, amountUsdc: `-${U(12_000)}` },
      { label: 'urssaf', dayOfMonth: 5, amountUsdc: `-${U(3_000)}` },
      { label: 'rent', dayOfMonth: 1, amountUsdc: `-${U(1_500)}` },
    ],
    datedFlows: [],
    dailyDeltaSigmaUsdc: U(2_500),
    kNum: '3',
    kDen: '2',
  });
}

export function buildDeps(env: NodeJS.ProcessEnv = process.env): CycleDeps {
  const mode = env.SCHEDULER_MODE === 'trade' ? 'trade' : 'observe';
  const mandateAddress = env.AGENT_MANDATE_ADDRESS as `0x${string}` | undefined;

  const config = {
    userMinUsdc: env.USER_MIN_USDC || '0',
    minTicketUsdc: env.MIN_TICKET_USDC || '0',
    horizonDays: Number(env.HORIZON_DAYS || '30'),
  };

  const liveBalances = () => {
    if (!mandateAddress) throw new Error('live balances require AGENT_MANDATE_ADDRESS');
    const client = createPublicClient({ chain: defineArcChain(env), transport: http() });
    return (async () => {
      const [company, deployed] = await Promise.all([
        client.readContract({ address: mandateAddress, abi: MANDATE_ABI, functionName: 'companyBalance' }),
        client.readContract({ address: mandateAddress, abi: MANDATE_ABI, functionName: 'deployedBalance' }),
      ]);
      return {
        companyBalanceUsdc: company.toString(),
        deployedUsdc: deployed.toString(),
        // Bootstrap until real history accumulates: trailing min = current balance (floor = 90%).
        trailing30dMinUsdc: env.TRAILING_30D_MIN_USDC || company.toString(),
      };
    })();
  };

  const fixtureBalances = () => ({
    companyBalanceUsdc: U(38_000),
    deployedUsdc: '0',
    trailing30dMinUsdc: U(34_000),
  });

  if (mode === 'trade') {
    if (!mandateAddress) throw new Error('SCHEDULER_MODE=trade requires AGENT_MANDATE_ADDRESS.');
    return {
      forecast: () => boulangerieForecast(new Date().toISOString()),
      balances: liveBalances,
      config,
      executor: selectChainExecutor(env), // throws unless CHAIN_EXECUTOR is set explicitly
      log: new EventLog(env.EVENT_LOG_PATH || path.resolve('event-log.jsonl')),
    };
  }
  return {
    forecast: () => boulangerieForecast(new Date().toISOString()),
    balances: mandateAddress ? liveBalances : fixtureBalances,
    config,
    executor: null, // OBSERVE: money cannot move, by construction
    log: new EventLog(env.EVENT_LOG_PATH || path.resolve('event-log.jsonl')),
  };
}

// Entrypoint: `npm start --workspace agent` (Railway later).
if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const intervalMs = Number(process.env.CYCLE_INTERVAL_MS || 60 * 60 * 1000);
  const mode = process.env.SCHEDULER_MODE === 'trade' ? 'trade' : 'observe';
  console.log(`[agent] starting scheduler: mode=${mode}, interval=${intervalMs}ms`);
  startScheduler(buildDeps(), { intervalMs });
}
