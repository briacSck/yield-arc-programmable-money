import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { EventLogRecord } from '@yield/shared';
import {
  OwnerActionInputError,
  checkOwnerSecret,
  parseFloorUnits,
  parseRequestId,
  type OwnerActionResult,
  type OwnerActionsPort,
} from './chain/owner-actions.js';
import type { EventLog } from './event-log.js';
import type { ForecastStore } from './forecast-store.js';

/**
 * The worker's internal HTTP surface — consumed ONLY by the dashboard service over Railway
 * private networking. The worker owns the volume; the dashboard proxies. Dashboard redeploys
 * never touch the loop.
 *
 *   GET  /events?limit=N  → stats + latest forecast snapshot + last N records (default 200)
 *   GET  /health          → CONTENT-based status (freshness alone lies: a FAILED storm or a
 *                           gas-dead agent still writes fresh records — eng review #12)
 *   POST /owner/pause     → AgentMandate.revoke()      ┐ owner-only, shared-secret authed,
 *   POST /owner/resume    → AgentMandate.reinstate()   │ signed by the COMPANY wallet.
 *   POST /owner/floor     → AgentMandate.setMandate()  ┘ See chain/owner-actions.ts.
 *
 * Why the owner writes live HERE and not in the dashboard (rules #5/#6): the Circle API key and
 * entity secret exist only in this process. The dashboard is internet-facing; it gets a thin proxy
 * that attaches the shared secret server-side, so neither the Circle credentials nor the shared
 * secret ever reach a browser.
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
  /** Owner controls. Absent/null ⇒ /owner/* answers 503 with a reason (never runs open). */
  ownerActions?: OwnerActionsPort | null;
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

// ─── Owner controls ────────────────────────────────────────────────────────────────────────────

/** Owner bodies are three short fields. A larger payload is refused rather than buffered. */
const MAX_OWNER_BODY_BYTES = 4_096;

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > MAX_OWNER_BODY_BYTES) throw new OwnerActionInputError('request body too large');
    chunks.push(buf);
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (raw === '') return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new OwnerActionInputError('request body must be JSON');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new OwnerActionInputError('request body must be a JSON object');
  }
  return parsed as Record<string, unknown>;
}

function header(req: IncomingMessage, name: string): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
}

/**
 * POST /owner/{pause|resume|floor}.
 *
 * Order matters: auth is checked BEFORE anything is parsed or read from chain, so an unauthorized
 * caller can neither probe the mandate nor make the worker do work.
 */
async function handleOwnerAction(
  action: string,
  req: IncomingMessage,
  res: ServerResponse,
  ctx: WorkerServerContext,
): Promise<void> {
  if (req.method !== 'POST') {
    json(res, 405, { ok: false, error: `use POST for /owner/${action}` });
    return;
  }

  const auth = checkOwnerSecret(ctx.env.OWNER_ACTION_SECRET, header(req, 'x-owner-secret'));
  if (!auth.ok) {
    json(res, auth.status, { ok: false, error: auth.error });
    return;
  }

  if (!ctx.ownerActions) {
    json(res, 503, {
      ok: false,
      error:
        'owner actions are not configured on this worker (needs CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET, CIRCLE_COMPANY_WALLET_ID, AGENT_MANDATE_ADDRESS)',
    });
    return;
  }

  try {
    const body = await readJsonBody(req);
    const requestId = parseRequestId(body.requestId, () => randomUUID().replace(/-/g, ''));

    let result: OwnerActionResult;
    if (action === 'pause') {
      result = await ctx.ownerActions.pause(requestId);
    } else if (action === 'resume') {
      result = await ctx.ownerActions.resume(requestId);
    } else if (action === 'floor') {
      const floorUsdc = parseFloorUnits(body.floorUsdc);
      // `setMandate` writes all three bounds at once. Re-send the CURRENT ticket/daily caps so
      // adjusting the floor cannot silently reset them — and if the chain read is unavailable,
      // refuse: writing bounds we cannot see would be guessing with the owner's mandate.
      const snapshot = ctx.readMandate ? await ctx.readMandate().catch(() => null) : null;
      if (!snapshot) {
        json(res, 503, {
          ok: false,
          error: 'cannot read the current mandate right now — refusing to write bounds it cannot see. Try again shortly.',
        });
        return;
      }
      // Sanity clamp against the live position. `parseFloorUnits` only proves the STRING is a
      // canonical amount — "999999999999999999" passes it. A floor far above the treasury is not a
      // cautious owner, it is a mistake or an attack: the agent could never deploy again, and every
      // invariant would still read COMPLIANT while the product sat dead. Ceilinged at 2x total
      // liquidity, which leaves room to genuinely park everything and then some.
      const totalLiquidity = BigInt(snapshot.companyBalanceUsdc) + BigInt(snapshot.deployedUsdc);
      const ceiling = totalLiquidity * 2n;
      if (BigInt(floorUsdc) > ceiling) {
        json(res, 400, {
          ok: false,
          error:
            `a floor of ${floorUsdc} is more than twice the ${totalLiquidity} currently under management — ` +
            'refusing, because it would permanently stop the agent from working. Nothing changed.',
        });
        return;
      }
      result = await ctx.ownerActions.setFloor({
        floorUsdc,
        maxTicketUsdc: snapshot.maxTicketUsdc,
        dailyCapUsdc: snapshot.dailyCapUsdc,
        requestId,
      });
    } else {
      json(res, 404, { ok: false, error: `unknown owner action ${JSON.stringify(action)}` });
      return;
    }

    console.log(`[owner] ${result.action} ${result.abiFunctionSignature} → ${result.txHash}`);
    json(res, 200, { ok: true, ...result });
  } catch (err) {
    if (err instanceof OwnerActionInputError) {
      json(res, 400, { ok: false, error: err.message });
      return;
    }
    // Execution failures are surfaced verbatim and never retried here (§17.6) — the owner sees the
    // truth ("it did not happen, here is why"), which is the whole point of the control.
    console.error(`[owner] ${action} FAILED: ${(err as Error).message}`);
    json(res, 502, { ok: false, error: (err as Error).message });
  }
}

// ─── Server ────────────────────────────────────────────────────────────────────────────────────

/** Exported so tests can drive the surface over a real socket without binding a fixed port. */
export function createWorkerRequestListener(ctx: WorkerServerContext) {
  return (req: IncomingMessage, res: ServerResponse): void => {
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
      if (url.pathname.startsWith('/owner/')) {
        void handleOwnerAction(url.pathname.slice('/owner/'.length), req, res, ctx).catch((err: Error) => {
          json(res, 500, { ok: false, error: err.message });
        });
        return;
      }
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
    } catch (err) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: (err as Error).message }));
    }
  };
}

export function startWorkerServer(port: number, ctx: WorkerServerContext): () => void {
  const server = createServer(createWorkerRequestListener(ctx));
  // A probe with no secret: 503 ⇒ the endpoint is disabled by config; 401 ⇒ it is armed.
  const probe = checkOwnerSecret(ctx.env.OWNER_ACTION_SECRET, undefined);
  const ownerState = !ctx.ownerActions
    ? 'no Circle owner creds'
    : !probe.ok && probe.status === 503
      ? 'DISABLED (OWNER_ACTION_SECRET unset or too short)'
      : 'enabled';
  server.listen(port, () =>
    console.log(`[worker] internal surface on :${port} (/events, /health, /owner/* — ${ownerState})`),
  );
  return () => server.close();
}
