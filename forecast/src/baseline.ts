import type { ForecastResult } from '@yield/shared';

/** A recurring cash event (payroll, URSSAF, rent, …). Amounts are signed USDC base-unit strings. */
export interface RecurringEvent {
  label: string;
  /** Day of month it hits, 1–28. */
  dayOfMonth: number;
  /** Signed amount, USDC base units (negative = outflow). */
  amountUsdc: string;
}

/** A known dated receivable/payable (AR positive, AP negative). */
export interface DatedFlow {
  date: string; // ISO date
  amountUsdc: string; // signed, USDC base units
}

export interface BaselineInputs {
  asOf: string; // ISO datetime
  horizonDays: number; // 30 | 60 | 90
  openingBalanceUsdc: string; // USDC base units
  recurring: RecurringEvent[];
  datedFlows: DatedFlow[];
  /** Std-dev of trailing 60d daily balance deltas, USDC base units — drives the P10/P90 band. */
  dailyDeltaSigmaUsdc: string;
  /** Band width multiplier k in `p10/p90 = p50 ∓ k·σ·√t`. */
  k: number;
}

/**
 * Deterministic baseline forecast — plan §16.4. The fallback that makes W2 unblockable: honest,
 * explainable, one function.
 *
 *   p50(t) = openingBalance + Σ known AR/AP due by day t + Σ detected recurring events by day t
 *   p10/p90(t) = p50(t) ∓ k · σ(trailing 60d daily deltas) · √t
 *
 * The t0 model service (yield-forecasting) later upgrades `modelId` without touching any consumer —
 * that is the entire point of the `ForecastResult` contract. All math on BigInt base units.
 *
 * TODO(Briac): implement. Must be pure/deterministic and set `inputsHash` = keccak of the
 * canonicalized inputs (so the decision receipt commits exactly what was forecast).
 */
export function baselineForecast(_inputs: BaselineInputs): ForecastResult {
  throw new Error('TODO(Briac): implement the §16.4 deterministic baseline forecast.');
}
