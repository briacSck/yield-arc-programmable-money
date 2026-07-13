import { z } from 'zod';
import { Bytes32Hex, IsoDateTime, UsdcBaseUnits } from './primitives.js';

/**
 * What the agent decided to do this cycle.
 * - `DEPLOY`      — move surplus from the company wallet into the yield venue (escrow).
 * - `WITHDRAW`    — pull funds back toward the company wallet ahead of a projected floor breach.
 * - `HOLD`        — do nothing this cycle (the fail-safe default on any degraded input).
 * - `FLOOR_RAISE` — raise the safe floor because input-cost exposure spiked (SPICE leg).
 */
export const DecisionKind = z.enum(['DEPLOY', 'WITHDRAW', 'HOLD', 'FLOOR_RAISE']);
export type DecisionKind = z.infer<typeof DecisionKind>;

/**
 * Input-cost exposure snapshot behind a `FLOOR_RAISE` (the SPICE leg). Optional: only present
 * when exposure drove the decision. `floorUpliftUsdc` is the amount added to the safe floor.
 */
export const Exposure = z.object({
  inputName: z.string().min(1),
  weightPct: z.number().min(0).max(100),
  shockPct: z.number(),
  floorUpliftUsdc: UsdcBaseUnits,
});
export type Exposure = z.infer<typeof Exposure>;

/**
 * `Decision` — plan §16.2. The single object the decision engine emits and the `ChainExecutor`
 * consumes. Pure and deterministic: identical inputs must yield an identical `Decision`
 * (property-tested, plan §16.3).
 *
 * `forecastInputsHash` is copied from the `ForecastResult.inputsHash` the agent acted on; it
 * becomes the on-chain **decision receipt** (`forecastHash` in `DecisionExecuted`, §17.2), so
 * anyone can replay *why* the agent moved money. `id` is the app-level decision id; the chain
 * layer derives the on-chain `decisionId = keccak(inputsHash ‖ window)` for idempotency (§17.2).
 */
export const Decision = z.object({
  id: z.string().min(1),
  ts: IsoDateTime,
  kind: DecisionKind,
  amountUsdc: UsdcBaseUnits,
  floorUsdc: UsdcBaseUnits,
  reason: z.string().min(1),
  forecastInputsHash: Bytes32Hex,
  exposure: Exposure.optional(),
});
export type Decision = z.infer<typeof Decision>;

/**
 * Decision-rule configuration — plan §16.3. Config, not code: the rule is fixed, these knobs are
 * per-deployment. All monetary knobs are USDC base-unit strings, consistent with `Decision`.
 */
export const DecisionConfig = z.object({
  userMinUsdc: UsdcBaseUnits,
  minTicketUsdc: UsdcBaseUnits,
  horizonDays: z.number().int().positive().default(30),
});
export type DecisionConfig = z.infer<typeof DecisionConfig>;
