import type { ChainExecutor, DecisionConfig, EventLogRecord, Exposure, ForecastResult } from '@yield/shared';
import { decide } from './decision/engine.js';
import type { EventLog } from './event-log.js';

/**
 * The unattended run loop — plan Tier 1 (§7): the agent runs continuously, on a schedule,
 * accumulating a multi-week track record. "It's been running since July 14 — here's the history"
 * is the Demo Day money line, and its value compounds with start date.
 *
 * One cycle: gather balances → forecast → decide (pure, §16.3) → act (or log why not) →
 * append EventLogRecord → heartbeat. Strictly serial: at most one in-flight cycle; a tick that
 * fires mid-cycle is skipped, never queued (§17.6 — never stack money movements).
 *
 * SAFETY MODEL (eng review #12/#14): `executor: null` = OBSERVE mode — decisions are computed
 * and logged but never executed. Money can only move when the caller explicitly wires a real
 * executor AND live balance reads (see run.ts). A static fixture can never drive live funds.
 */
export interface CycleDeps {
  /** Fresh forecast for this cycle (fresh `asOf` ⇒ fresh on-chain decisionId space). */
  forecast: () => Promise<ForecastResult> | ForecastResult;
  /** Live (or fixture, in observe mode) balances for this cycle — post-trade state each time. */
  balances: () =>
    | Promise<{ companyBalanceUsdc: string; deployedUsdc: string; trailing30dMinUsdc: string }>
    | { companyBalanceUsdc: string; deployedUsdc: string; trailing30dMinUsdc: string };
  config: DecisionConfig;
  /** null = OBSERVE mode: log decisions, move no money. */
  executor: ChainExecutor | null;
  log: EventLog;
  /** Cycle clock (injected for tests; defaults to the real clock). */
  now?: () => string;
  /** Optional exposure feed (SPICE leg). */
  exposure?: () => Exposure | undefined;
  /** Heartbeat (injected for tests; defaults to ./heartbeat.ping). */
  ping?: () => Promise<void>;
}

export interface SchedulerOptions {
  /** Cycle interval in ms. */
  intervalMs: number;
}

/** Runs ONE forecast→decide→act→log→heartbeat cycle. Never throws: failures become FAILED records. */
export async function runCycle(deps: CycleDeps): Promise<EventLogRecord> {
  const now = deps.now?.() ?? new Date().toISOString();
  let record: Omit<EventLogRecord, 'seq'>;
  try {
    const [forecast, balances] = await Promise.all([deps.forecast(), deps.balances()]);
    const decision = decide({
      forecast,
      ...balances,
      config: deps.config,
      now,
      ...(deps.exposure?.() ? { exposure: deps.exposure!()! } : {}),
    });

    if (decision.kind !== 'DEPLOY' && decision.kind !== 'WITHDRAW') {
      record = { loggedAt: now, status: 'SKIPPED', decision, execution: null };
    } else if (deps.executor === null) {
      record = {
        loggedAt: now,
        status: 'SKIPPED',
        decision,
        execution: null,
        error: 'observe mode: decision computed but not executed (no executor wired)',
      };
    } else {
      try {
        const execution = await deps.executor.execute(decision);
        record = { loggedAt: now, status: 'CONFIRMED', decision, execution };
      } catch (err) {
        // §17.6: a failed/stuck money movement is never blind-retried — log, alert via the
        // missed-expectation in the dashboard, and let the NEXT cycle re-decide on fresh state.
        record = {
          loggedAt: now,
          status: 'FAILED',
          decision,
          execution: null,
          error: (err as Error).message,
        };
      }
    }
  } catch (err) {
    // Degraded inputs upstream of decide() (forecast/balance read failure) — HOLD-shaped record.
    record = {
      loggedAt: now,
      status: 'FAILED',
      decision: {
        id: `cycle-error-${now}`,
        ts: now,
        kind: 'HOLD',
        amountUsdc: '0',
        floorUsdc: '0',
        reason: `HOLD: cycle inputs failed (${(err as Error).message}) — refusing to act on degraded input.`,
        forecastInputsHash: `0x${'0'.repeat(64)}`,
      },
      execution: null,
      error: (err as Error).message,
    };
  }

  const written = deps.log.append(record);
  await (deps.ping ? deps.ping() : (await import('./heartbeat.js')).ping());
  return written;
}

/**
 * setInterval wrapper with the single-in-flight guard: a tick that fires while a cycle is still
 * running is dropped (logged to console), never queued. Returns a stop function.
 */
export function startScheduler(deps: CycleDeps, opts: SchedulerOptions): () => void {
  let inFlight = false;
  const tick = async () => {
    if (inFlight) {
      console.warn('[scheduler] previous cycle still in flight — skipping this tick (§17.6).');
      return;
    }
    inFlight = true;
    try {
      const record = await runCycle(deps);
      console.log(`[scheduler] cycle #${record.seq}: ${record.status} ${record.decision.kind} — ${record.decision.reason}`);
    } finally {
      inFlight = false;
    }
  };
  void tick(); // first cycle immediately — the uptime clock starts now, not one interval from now.
  const timer = setInterval(() => void tick(), opts.intervalMs);
  return () => clearInterval(timer);
}
