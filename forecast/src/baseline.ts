import { keccak256, toBytes } from 'viem';
import type { ForecastResult } from '@yield/shared';

/** A recurring cash event (payroll, URSSAF, rent, …). Amounts are signed USDC base-unit strings. */
export interface RecurringEvent {
  label: string;
  /** Day of month it hits, 1–28 (no month-length edge cases by construction). */
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
  /**
   * Band width multiplier k in `p10/p90 = p50 ∓ k·σ·√t`, as a RATIONAL (kNum/kDen, decimal
   * strings) — floats never enter the money path or the hashed payload (determinism is what the
   * on-chain receipt commits to).
   */
  kNum: string;
  kDen: string;
}

const DAY_MS = 86_400_000;
/** √t is computed as isqrt(t·SQRT_SCALE²)/SQRT_SCALE — 6 fractional digits of precision. */
const SQRT_SCALE = 1_000_000n;

/** Floor integer square root (Newton's method) on non-negative bigints. */
export function isqrt(n: bigint): bigint {
  if (n < 0n) throw new Error('isqrt of negative');
  if (n < 2n) return n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
}

/**
 * Canonical serialization for hashing: object keys sorted, arrays sorted by stable composite
 * keys (recurring by dayOfMonth+label, flows by date+amount) — two economically identical input
 * sets always hash identically, regardless of the order the caller assembled them in.
 */
export function canonicalInputsJson(inputs: BaselineInputs): string {
  const recurring = [...inputs.recurring].sort(
    (a, b) => a.dayOfMonth - b.dayOfMonth || a.label.localeCompare(b.label),
  );
  const datedFlows = [...inputs.datedFlows].sort(
    (a, b) => a.date.localeCompare(b.date) || a.amountUsdc.localeCompare(b.amountUsdc),
  );
  // Keys listed alphabetically — the canonical order is explicit, not host-dependent.
  return JSON.stringify({
    asOf: inputs.asOf,
    dailyDeltaSigmaUsdc: inputs.dailyDeltaSigmaUsdc,
    datedFlows: datedFlows.map((f) => ({ amountUsdc: f.amountUsdc, date: f.date })),
    horizonDays: inputs.horizonDays,
    kDen: inputs.kDen,
    kNum: inputs.kNum,
    openingBalanceUsdc: inputs.openingBalanceUsdc,
    recurring: recurring.map((r) => ({ amountUsdc: r.amountUsdc, dayOfMonth: r.dayOfMonth, label: r.label })),
  });
}

/**
 * Deterministic baseline forecast — plan §16.4. The fallback that makes W2 unblockable: honest,
 * explainable, one function. Pure: no wall-clock reads, bit-identical output for identical input.
 *
 *   p50(t) = openingBalance + Σ dated flows due by day t + Σ recurring events by day t
 *   p10/p90(t) = p50(t) ∓ (kNum/kDen) · σ · √t     (all BigInt; √t via scaled integer sqrt)
 *
 * Negative projections are CLAMPED to 0 in the published series (the shared schema is
 * non-negative). Clamping is conservative for the agent: a 0 floor-side value sizes withdrawals
 * larger, i.e. toward safety, never away from it.
 *
 * The t0 model service (yield-forecasting) later upgrades `modelId` without touching any
 * consumer — that is the entire point of the `ForecastResult` contract.
 */
export function baselineForecast(inputs: BaselineInputs): ForecastResult {
  if (!Number.isInteger(inputs.horizonDays) || inputs.horizonDays < 1) {
    throw new Error(`baselineForecast: horizonDays must be a positive integer, got ${inputs.horizonDays}`);
  }
  const startMs = Date.parse(inputs.asOf);
  if (!Number.isFinite(startMs)) throw new Error(`baselineForecast: unreadable asOf ${inputs.asOf}`);
  for (const r of inputs.recurring) {
    if (!Number.isInteger(r.dayOfMonth) || r.dayOfMonth < 1 || r.dayOfMonth > 28) {
      throw new Error(`baselineForecast: recurring "${r.label}" dayOfMonth must be 1–28, got ${r.dayOfMonth}`);
    }
  }

  const sigma = BigInt(inputs.dailyDeltaSigmaUsdc);
  const kNum = BigInt(inputs.kNum);
  const kDen = BigInt(inputs.kDen);
  if (kDen <= 0n) throw new Error('baselineForecast: kDen must be positive');

  const startDateMs = Date.parse(`${inputs.asOf.slice(0, 10)}T00:00:00Z`);
  const clamp0 = (x: bigint): bigint => (x < 0n ? 0n : x);

  let running = BigInt(inputs.openingBalanceUsdc); // signed internal walk — clamp at publish only
  const series = [];
  for (let t = 1; t <= inputs.horizonDays; t++) {
    const dateIso = new Date(startDateMs + t * DAY_MS).toISOString().slice(0, 10);
    const dayOfMonth = Number(dateIso.slice(8, 10));
    for (const flow of inputs.datedFlows) {
      if (flow.date === dateIso) running += BigInt(flow.amountUsdc);
    }
    for (const event of inputs.recurring) {
      if (event.dayOfMonth === dayOfMonth) running += BigInt(event.amountUsdc);
    }
    // deviation(t) = (kNum/kDen)·σ·√t, √t as isqrt(t·SCALE²)/SCALE.
    const sqrtT = isqrt(BigInt(t) * SQRT_SCALE * SQRT_SCALE);
    const dev = (kNum * sigma * sqrtT) / (kDen * SQRT_SCALE);
    series.push({
      date: dateIso,
      p10: clamp0(running - dev).toString(),
      p50: clamp0(running).toString(),
      p90: clamp0(running + dev).toString(),
    });
  }

  return {
    asOf: inputs.asOf,
    horizonDays: inputs.horizonDays,
    series,
    modelId: 'deterministic-baseline@0.1.0',
    inputsHash: keccak256(toBytes(canonicalInputsJson(inputs))),
  };
}
