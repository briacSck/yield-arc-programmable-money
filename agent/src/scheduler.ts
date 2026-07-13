/**
 * The unattended run loop — plan Tier 1 (§7): the agent runs continuously, on a schedule, from
 * week 2, accumulating a multi-week on-chain track record. "It's been running since July 20 —
 * here's the explorer history" is the Demo Day money line.
 *
 * One cycle (TODO — wire the real pieces):
 *   1. fetch signals + forecast (forecast/)         → ForecastResult
 *   2. decide(input)                                 → Decision   (pure, §16.3)
 *   3. if it moves money: chainExecutor.execute(d)   → ExecutionResult   (serial, one in-flight)
 *   4. append EventLogRecord to the JSONL log
 *   5. ping the heartbeat (§15.4)
 *
 * Strictly serial execution: at most one in-flight tx (§17.6). A stuck tx → alert + HOLD; never
 * blind-retry a money movement.
 */
export interface SchedulerOptions {
  /** Cycle interval in ms. */
  intervalMs: number;
}

export async function runCycle(): Promise<void> {
  // TODO(Briac/Vadim): implement one forecast→decide→act→log→heartbeat cycle.
  throw new Error('TODO: implement runCycle().');
}

export function startScheduler(_opts: SchedulerOptions): void {
  // TODO: setInterval/cron around runCycle with the single-in-flight guard.
  throw new Error('TODO: implement startScheduler().');
}
