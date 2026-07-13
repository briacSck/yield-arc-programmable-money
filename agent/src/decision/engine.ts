import type { Decision, DecisionConfig, Exposure, ForecastResult } from '@yield/shared';

/** Everything the pure decision rule needs for one cycle. */
export interface DecideInput {
  /** The forecast the agent is acting on. */
  forecast: ForecastResult;
  /** Current company (liquid) balance, USDC base units. */
  companyBalanceUsdc: string;
  /** Currently deployed surplus, USDC base units. */
  deployedUsdc: string;
  /** Trailing 30-day minimum company balance, USDC base units (for the floor formula). */
  trailing30dMinUsdc: string;
  config: DecisionConfig;
  /** Wall clock for this cycle (ISO datetime). Used for the stale-input fail-safe. */
  now: string;
  /** Optional input-cost exposure driving a FLOOR_RAISE (SPICE leg). */
  exposure?: Exposure;
}

/**
 * The decision rule — plan §16.3. **Pure and deterministic**: identical `DecideInput` must always
 * produce an identical `Decision` (property-tested in engine.property.test.ts). This is the repo's
 * contract, exactly like `safeToInvest` is in production.
 *
 *   safe_floor = max(USER_MIN, 0.90 × min(balance, trailing 30d)) + exposure_uplift
 *   deploy     = balance − max(safe_floor, min(p10, next 30d))   execute if ≥ MIN_TICKET
 *   withdraw   = if min(p10, next HORIZON) < safe_floor → withdraw the projected shortfall
 *   FAIL-SAFE  = stale inputs (>24h) or forecast error → HOLD + alert
 *
 * Fail-safe philosophy (stated in the video): **being wrong must cost opportunity, never
 * solvency.** Any degraded input returns `HOLD`; the floor is never breached by an agent action.
 *
 * TODO(Briac): implement. All money math on BigInt over USDC base-unit strings — never floats.
 */
export function decide(_input: DecideInput): Decision {
  throw new Error('TODO(Briac): implement the §16.3 decision rule.');
}
