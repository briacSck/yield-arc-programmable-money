import type { DecisionConfig, EventLogRecord, Exposure, ForecastResult } from '@yield/shared';
import type { ChainExecutor } from '@yield/shared';
import { decide } from './decision/engine.js';
import type { EventLog } from './event-log.js';
import type { ForecastStore } from './forecast-store.js';

/**
 * The unattended run loop — plan Tier 1 (§7): the agent runs continuously, on a schedule,
 * accumulating a multi-week track record whose value compounds with start date.
 *
 * One cycle: gather (live balances + mandate caps + gas check) → forecast (anchored on those
 * balances) → decide (pure, §16.3) → act (cooldown- and cap-guarded) → append EventLogRecord +
 * forecast snapshot → heartbeat. Strictly serial: a tick that fires mid-cycle is dropped (§17.6).
 *
 * SAFETY MODEL: `executor: null` = OBSERVE (decisions logged, money never moves). Trade mode
 * additionally passes through: the engine's cap clamps (no reverting txs), the cooldown (no
 * ping-pong), and the gas guard (no silent gas-drain death — heartbeat FAILs instead).
 */

/** Everything one cycle needs, produced fresh each tick — post-trade state, never a stale fixture. */
export interface CycleInputs {
  companyBalanceUsdc: string;
  deployedUsdc: string;
  trailing30dMinUsdc: string;
  /** Chain-derived caps folded in by the provider (maxTicket, dailyCapRemaining, chain floor). */
  config: DecisionConfig;
  /** Agent wallet holds enough native gas for at least one transaction. */
  gasOk: boolean;
  exposure?: Exposure;
}

export interface CycleDeps {
  /** Live reads (or fixture, in observe mode): balances + mandate params + gas state. */
  gather: () => Promise<CycleInputs> | CycleInputs;
  /** Forecast anchored on THIS cycle's inputs (fresh asOf ⇒ fresh on-chain decisionId space). */
  forecast: (
    inputs: CycleInputs,
  ) =>
    | Promise<{ forecast: ForecastResult; baselineInputs?: unknown }>
    | { forecast: ForecastResult; baselineInputs?: unknown };
  /** null = OBSERVE mode: log decisions, move no money. */
  executor: ChainExecutor | null;
  log: EventLog;
  /** Out-of-line forecast snapshots for the dashboard cone (optional in tests). */
  forecastStore?: ForecastStore;
  /** Minimum ms between executed money moves (anti-ping-pong). Default 6h. */
  cooldownMs?: number;
  now?: () => string;
  /** Heartbeat success ping (defaults to ./heartbeat.ping). */
  ping?: () => Promise<void>;
  /** Heartbeat FAILURE ping — fired on gas exhaustion so the monitor alerts distinctly. */
  pingFail?: () => Promise<void>;
}

export interface SchedulerOptions {
  intervalMs: number;
}

const DEFAULT_COOLDOWN_MS = 6 * 60 * 60 * 1000;

/** Runs ONE cycle. Never throws: failures become FAILED/SKIPPED records. */
export async function runCycle(deps: CycleDeps): Promise<EventLogRecord> {
  const now = deps.now?.() ?? new Date().toISOString();
  const holdRecord = (reason: string, error: string): Omit<EventLogRecord, 'seq'> => ({
    loggedAt: now,
    status: 'FAILED',
    decision: {
      id: `cycle-error-${now}`,
      ts: now,
      kind: 'HOLD',
      amountUsdc: '0',
      floorUsdc: '0',
      reason,
      forecastInputsHash: `0x${'0'.repeat(64)}`,
    },
    execution: null,
    error,
  });

  let record: Omit<EventLogRecord, 'seq'>;
  let gasExhausted = false;
  try {
    const inputs = await deps.gather();

    if (!inputs.gasOk) {
      // Gas guard (§ trade-mode gate d): never attempt a tx the wallet can't pay for, and make
      // the monitor scream — a green heartbeat over a gas-dead agent is the overnight failure.
      gasExhausted = true;
      record = holdRecord(
        'HOLD: agent wallet native gas below threshold — refusing to act until refueled.',
        'gas below threshold',
      );
    } else {
      const { forecast, baselineInputs } = await deps.forecast(inputs);
      const decision = decide({
        forecast,
        companyBalanceUsdc: inputs.companyBalanceUsdc,
        deployedUsdc: inputs.deployedUsdc,
        trailing30dMinUsdc: inputs.trailing30dMinUsdc,
        config: inputs.config,
        now,
        ...(inputs.exposure ? { exposure: inputs.exposure } : {}),
      });

      deps.forecastStore?.append({ decisionId: decision.id, loggedAt: now, forecast, inputs: baselineInputs });

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
        const lastMoveAt = deps.log.lastConfirmedMoveAt();
        const cooldownMs = deps.cooldownMs ?? DEFAULT_COOLDOWN_MS;
        if (lastMoveAt !== null && Date.parse(now) - Date.parse(lastMoveAt) < cooldownMs) {
          record = {
            loggedAt: now,
            status: 'SKIPPED',
            decision,
            execution: null,
            error: `cooldown: last move at ${lastMoveAt}, minimum ${Math.round(cooldownMs / 60000)}min between moves (anti-oscillation)`,
          };
        } else {
          try {
            const execution = await deps.executor.execute(decision);
            record = { loggedAt: now, status: 'CONFIRMED', decision, execution };
          } catch (err) {
            // §17.6: never blind-retry a money movement — log, let the NEXT cycle re-decide on
            // fresh chain state.
            record = { loggedAt: now, status: 'FAILED', decision, execution: null, error: (err as Error).message };
          }
        }
      }
    }
  } catch (err) {
    record = holdRecord(
      `HOLD: cycle inputs failed (${(err as Error).message}) — refusing to act on degraded input.`,
      (err as Error).message,
    );
  }

  const written = deps.log.append(record);
  if (gasExhausted && deps.pingFail) {
    await deps.pingFail();
  } else {
    await (deps.ping ? deps.ping() : (await import('./heartbeat.js')).ping());
  }
  return written;
}

/** setInterval wrapper with the single-in-flight guard. Returns a stop function. */
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
  void tick(); // first cycle immediately — the clock starts now, not one interval from now.
  const timer = setInterval(() => void tick(), opts.intervalMs);
  return () => clearInterval(timer);
}
