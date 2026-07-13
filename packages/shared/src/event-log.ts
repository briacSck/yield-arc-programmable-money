import { z } from 'zod';
import { IsoDateTime } from './primitives.js';
import { Decision } from './decision.js';
import { ExecutionResult } from './chain.js';

/**
 * Lifecycle of a single decision as it settles (mirrors the on-chain tx state machine, §17.6).
 * `SKIPPED` = a HOLD or a below-min-ticket decision that intentionally moved no money.
 */
export const ExecutionStatus = z.enum(['SUBMITTED', 'CONFIRMED', 'FAILED', 'SKIPPED']);
export type ExecutionStatus = z.infer<typeof ExecutionStatus>;

/**
 * One append-only event-log record. The log is a JSONL file mirrored by the on-chain events; the
 * dashboard reads exactly ONE API route backed by this log and nothing else (plan §16.2). Keeping
 * the shape here means the agent (writer) and dashboard (reader) can never drift.
 */
export const EventLogRecord = z.object({
  seq: z.number().int().nonnegative(),
  loggedAt: IsoDateTime,
  status: ExecutionStatus,
  decision: Decision,
  execution: ExecutionResult.nullable(),
  error: z.string().optional(),
});
export type EventLogRecord = z.infer<typeof EventLogRecord>;
