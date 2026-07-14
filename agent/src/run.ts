import path from 'node:path';
import { createPublicClient, http, parseAbi, type PublicClient } from 'viem';
import { baselineForecast, type BaselineInputs } from '@yield/forecast';
import { defineArcChain } from './chain/arc-chain.js';
import { selectChainExecutor } from './chain/index.js';
import { EventLog } from './event-log.js';
import { ForecastStore } from './forecast-store.js';
import { startWorkerServer } from './server.js';
import { startScheduler, type CycleDeps, type CycleInputs } from './scheduler.js';

/**
 * Agent worker entrypoint — wires real dependencies into the scheduler and (optionally) serves
 * the internal worker HTTP surface the dashboard proxies.
 *
 *   SCHEDULER_MODE=observe (DEFAULT) — decisions computed + logged, money cannot move.
 *   SCHEDULER_MODE=trade — requires CHAIN_EXECUTOR=circle + AGENT_MANDATE_ADDRESS. Mandate params
 *     (floor/ticket/dailyCap/window) are READ FROM CHAIN each cycle and folded into the engine's
 *     config, so the engine can never propose a tx the contract reverts. Cooldown + gas guard
 *     apply (see scheduler.ts). Flip to trade only behind the (a)–(g) test gate.
 *
 * Demo economics ("demo ledger, real settlement"): the §16.5 Boulangerie persona at 1:3800 scale,
 * ANCHORED each cycle on the live companyBalance — monthly payroll/URSSAF/rent outflows and
 * mid-month revenue inflows shape the P10 tail so the agent deploys early-month and pulls back
 * ahead of the 28th, every move a real bounded tx on arcscan.
 */

export const MANDATE_ABI = parseAbi([
  'function companyBalance() view returns (uint256)',
  'function deployedBalance() view returns (uint256)',
  'function floorUsdc() view returns (uint256)',
  'function maxTicketUsdc() view returns (uint256)',
  'function dailyCapUsdc() view returns (uint256)',
  'function windowStart() view returns (uint256)',
  'function windowDeployed() view returns (uint256)',
  'function revoked() view returns (bool)',
]);

const U = (n: number) => (BigInt(n) * 1_000_000n).toString();
/** Agent wallet must hold at least this much native gas (0.05 USDC ≈ several txs). */
const GAS_MIN_WEI = 5n * 10n ** 16n;

let sharedClient: PublicClient | null = null;
export function arcClient(env: NodeJS.ProcessEnv = process.env): PublicClient {
  if (!sharedClient) {
    sharedClient = createPublicClient({
      chain: defineArcChain(env),
      transport: http(env.ARC_RPC_URL),
    });
  }
  return sharedClient;
}

/**
 * Boulangerie Chartier at demo scale — ANCHORED each cycle on TOTAL liquidity
 * (company + deployed): deployed funds are recallable, so the true position a dip is measured
 * against is the total; anchoring on the company pool alone would make every deposit look like a
 * crash and every recall like a windfall (oscillation). The calendar shape is tuned so, on a
 * ~10 USDC pool with a 5 USDC floor, the P10 tail crosses the floor in the pre-payroll window
 * (risk-off → recall) and clears it after the late-month revenue (risk-on → deploy): a monthly
 * rhythm of small, cap-bounded, real on-chain moves.
 */
export function scaledLedger(totalLiquidityUsdc: string, nowIso: string): BaselineInputs {
  return {
    asOf: nowIso,
    horizonDays: 30,
    openingBalanceUsdc: totalLiquidityUsdc,
    recurring: [
      { label: 'payroll', dayOfMonth: 28, amountUsdc: '-5263157' }, // 20 000 / 3800
      { label: 'urssaf', dayOfMonth: 5, amountUsdc: '-789473' },
      { label: 'rent', dayOfMonth: 1, amountUsdc: '-394736' },
      { label: 'revenue-mid', dayOfMonth: 10, amountUsdc: '2631578' }, // 10 000 / 3800
      { label: 'revenue-late', dayOfMonth: 20, amountUsdc: '2631578' },
    ],
    datedFlows: [],
    dailyDeltaSigmaUsdc: '100000', // 0.10 USDC daily σ
    kNum: '1',
    kDen: '1',
  };
}

export function buildDeps(env: NodeJS.ProcessEnv = process.env): CycleDeps {
  const mode = env.SCHEDULER_MODE === 'trade' ? 'trade' : 'observe';
  const mandateAddress = env.AGENT_MANDATE_ADDRESS as `0x${string}` | undefined;
  const agentAddress = env.AGENT_ADDRESS as `0x${string}` | undefined;

  const minTicket = env.MIN_TICKET_USDC && env.MIN_TICKET_USDC !== '0' ? env.MIN_TICKET_USDC : '500000'; // 0.5 USDC default — no dust moves
  const horizonDays = Number(env.HORIZON_DAYS || '30');

  const liveGather = async (): Promise<CycleInputs> => {
    if (!mandateAddress) throw new Error('live gather requires AGENT_MANDATE_ADDRESS');
    const client = arcClient(env);
    const read = <T>(functionName: string) =>
      client.readContract({ address: mandateAddress, abi: MANDATE_ABI, functionName: functionName as never }) as Promise<T>;
    const [company, deployed, chainFloor, maxTicket, dailyCap, windowStart, windowDeployed, gasWei] =
      await Promise.all([
        read<bigint>('companyBalance'),
        read<bigint>('deployedBalance'),
        read<bigint>('floorUsdc'),
        read<bigint>('maxTicketUsdc'),
        read<bigint>('dailyCapUsdc'),
        read<bigint>('windowStart'),
        read<bigint>('windowDeployed'),
        agentAddress ? client.getBalance({ address: agentAddress }) : Promise.resolve(GAS_MIN_WEI),
      ]);

    const nowSec = BigInt(Math.floor(Date.now() / 1000));
    const windowOpen = nowSec < windowStart + 86_400n;
    const remaining = windowOpen ? (dailyCap > windowDeployed ? dailyCap - windowDeployed : 0n) : dailyCap;
    const envUserMin = BigInt(env.USER_MIN_USDC || '0');

    return {
      companyBalanceUsdc: company.toString(),
      deployedUsdc: deployed.toString(),
      // Default trailing 0 ⇒ 0.9×min(...) term vanishes ⇒ safe_floor = chain floor exactly.
      trailing30dMinUsdc: env.TRAILING_30D_MIN_USDC || '0',
      config: {
        userMinUsdc: (envUserMin > chainFloor ? envUserMin : chainFloor).toString(),
        minTicketUsdc: minTicket,
        horizonDays,
        maxTicketUsdc: maxTicket.toString(),
        dailyCapRemainingUsdc: remaining.toString(),
      },
      gasOk: gasWei >= GAS_MIN_WEI,
    };
  };

  const fixtureGather = (): CycleInputs => ({
    companyBalanceUsdc: U(10),
    deployedUsdc: '0',
    trailing30dMinUsdc: '0',
    config: { userMinUsdc: U(5), minTicketUsdc: minTicket, horizonDays },
    gasOk: true,
  });

  const log = new EventLog(env.EVENT_LOG_PATH || path.resolve('event-log.jsonl'));
  const forecastStore = new ForecastStore(env.FORECASTS_PATH || path.resolve('forecasts.jsonl'));

  return {
    gather: mandateAddress ? liveGather : fixtureGather,
    forecast: (inputs) => {
      const total = BigInt(inputs.companyBalanceUsdc) + BigInt(inputs.deployedUsdc);
      const baselineInputs = scaledLedger(total.toString(), new Date().toISOString());
      return { forecast: baselineForecast(baselineInputs), baselineInputs };
    },
    executor: mode === 'trade' ? selectChainExecutor(env) : null,
    log,
    forecastStore,
    cooldownMs: Number(env.ACTION_COOLDOWN_MS || 6 * 60 * 60 * 1000),
  };
}

/** Cached (15 s) mandate snapshot reader for the worker HTTP surface — one shared client, soft-fail. */
export function makeMandateReader(env: NodeJS.ProcessEnv = process.env) {
  const mandateAddress = env.AGENT_MANDATE_ADDRESS as `0x${string}` | undefined;
  const agentAddress = env.AGENT_ADDRESS as `0x${string}` | undefined;
  if (!mandateAddress) return async () => null;
  let cache: { at: number; value: Awaited<ReturnType<typeof readOnce>> } | null = null;
  const readOnce = async () => {
    const client = arcClient(env);
    const read = <T>(functionName: string) =>
      client.readContract({ address: mandateAddress, abi: MANDATE_ABI, functionName: functionName as never }) as Promise<T>;
    const [company, deployed, floor, ticket, cap, windowDeployed, revoked, gas] = await Promise.all([
      read<bigint>('companyBalance'),
      read<bigint>('deployedBalance'),
      read<bigint>('floorUsdc'),
      read<bigint>('maxTicketUsdc'),
      read<bigint>('dailyCapUsdc'),
      read<bigint>('windowDeployed'),
      read<boolean>('revoked'),
      agentAddress ? client.getBalance({ address: agentAddress }) : Promise.resolve(0n),
    ]);
    return {
      companyBalanceUsdc: company.toString(),
      deployedUsdc: deployed.toString(),
      floorUsdc: floor.toString(),
      maxTicketUsdc: ticket.toString(),
      dailyCapUsdc: cap.toString(),
      windowDeployedUsdc: windowDeployed.toString(),
      revoked,
      agentGasWei: gas.toString(),
    };
  };
  return async () => {
    if (cache && Date.now() - cache.at < 15_000) return cache.value;
    const value = await readOnce();
    cache = { at: Date.now(), value };
    return value;
  };
}

// Entrypoint: `npm start --workspace agent` (Railway worker service).
if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  // Local runs load the repo-root .env; Railway injects vars directly (no file — both fine).
  for (const candidate of ['.env', '../.env']) {
    try {
      process.loadEnvFile(path.resolve(process.cwd(), candidate));
      break;
    } catch {
      /* not found — try next / rely on platform env */
    }
  }
  const intervalMs = Number(process.env.CYCLE_INTERVAL_MS || 60 * 60 * 1000);
  const mode = process.env.SCHEDULER_MODE === 'trade' ? 'trade' : 'observe';
  console.log(`[agent] starting scheduler: mode=${mode}, interval=${intervalMs}ms`);
  const deps = buildDeps();
  startScheduler(deps, { intervalMs });
  const port = Number(process.env.WORKER_PORT || 0);
  if (port > 0) {
    startWorkerServer(port, {
      env: process.env,
      log: deps.log,
      forecastStore: deps.forecastStore!,
      cycleIntervalMs: intervalMs,
      readMandate: makeMandateReader(process.env),
    });
  }
}
