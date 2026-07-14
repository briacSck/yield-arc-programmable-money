import { createServer } from 'node:http';
import type { EventLogRecord } from '@yield/shared';
import type { EventLog } from './event-log.js';
import type { ForecastStore } from './forecast-store.js';

/**
 * The worker's internal HTTP surface — consumed ONLY by the dashboard service over Railway
 * private networking. The worker owns the volume; the dashboard proxies. Dashboard redeploys
 * never touch the loop.
 *
 *   GET /events?limit=N  → stats + latest forecast snapshot + last N records (default 200)
 *   GET /health          → CONTENT-based status (freshness alone lies: a FAILED storm or a
 *                          gas-dead agent still writes fresh records — eng review #12)
 */
export interface MandateSnapshot {
  companyBalanceUsdc: string;
  deployedUsdc: string;
  floorUsdc: string;
  maxTicketUsdc: string;
  dailyCapUsdc: string;
  windowDeployedUsdc: string;
  revoked: boolean;
  agentGasWei: string;
}

export interface WorkerServerContext {
  env: NodeJS.ProcessEnv;
  log: EventLog;
  forecastStore: ForecastStore;
  cycleIntervalMs: number;
  /** Live mandate reads (cached by the caller); null when no mandate is configured. */
  readMandate?: () => Promise<MandateSnapshot | null>;
}

export function computeStats(records: EventLogRecord[]) {
  const confirmed = records.filter((r) => r.status === 'CONFIRMED');
  return {
    cycles: records.length,
    decisions: records.length,
    onChainMoves: confirmed.length,
    firstOnChainMoveAt: confirmed[0]?.loggedAt ?? null,
    lastOnChainMoveAt: confirmed[confirmed.length - 1]?.loggedAt ?? null,
    lastCycleAt: records[records.length - 1]?.loggedAt ?? null,
    floorBreaches: 0, // enforced impossible by contract + engine; stated, not computed
  };
}

export function computeHealth(records: EventLogRecord[], cycleIntervalMs: number, nowMs = Date.now()) {
  const last = records[records.length - 1];
  if (!last) return { status: 'degraded' as const, lastCycleAt: null, agentAlive: false, reason: 'never ran' };
  const fresh = nowMs - Date.parse(last.loggedAt) < 2 * cycleIntervalMs;
  const tail = records.slice(-3);
  const failStorm = tail.length === 3 && tail.every((r) => r.status === 'FAILED');
  const gasDead = last.error?.includes('gas below threshold') ?? false;
  const status = fresh && !failStorm && !gasDead ? ('ok' as const) : ('degraded' as const);
  return {
    status,
    lastCycleAt: last.loggedAt,
    agentAlive: fresh,
    reason: !fresh ? 'stale' : failStorm ? '3 consecutive FAILED cycles' : gasDead ? 'gas exhausted' : 'ok',
  };
}

export function startWorkerServer(port: number, ctx: WorkerServerContext): () => void {
  const server = createServer((req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://worker');
      if (url.pathname === '/events') {
        const limit = Math.min(Number(url.searchParams.get('limit') || 200), 1000);
        const records = ctx.log.readAll();
        void (async () => {
          let mandate: MandateSnapshot | null = null;
          try {
            mandate = ctx.readMandate ? await ctx.readMandate() : null;
          } catch {
            mandate = null; // soft-fail: RPC flakiness must never break the feed (design spec #4)
          }
          const body = {
            agentAddress: ctx.env.AGENT_ADDRESS ?? '',
            identityRegistry: ctx.env.IDENTITY_REGISTRY_ADDRESS ?? '',
            mandateAddress: ctx.env.AGENT_MANDATE_ADDRESS ?? '',
            agentIdentityId: ctx.env.AGENT_IDENTITY_ID ?? '',
            schedulerMode: ctx.env.SCHEDULER_MODE === 'trade' ? 'trade' : 'observe',
            stats: computeStats(records),
            mandate,
            latestForecast: ctx.forecastStore.latest(),
            events: records.slice(-limit),
          };
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify(body));
        })();
        return;
      }
      if (url.pathname === '/health') {
        const health = computeHealth(ctx.log.readAll(), ctx.cycleIntervalMs);
        res.writeHead(health.status === 'ok' ? 200 : 503, { 'content-type': 'application/json' });
        res.end(JSON.stringify(health));
        return;
      }
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
    } catch (err) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: (err as Error).message }));
    }
  });
  server.listen(port, () => console.log(`[worker] internal surface on :${port} (/events, /health)`));
  return () => server.close();
}
