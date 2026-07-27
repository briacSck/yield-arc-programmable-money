import type { Exposure } from '@yield/shared';

/**
 * The exposure engine — plan §6 "planned #2", the SPICE leg. Deterministic and PURE: it turns an
 * input-cost price signal into the `floorUpliftUsdc` the decision rule adds to the safe floor
 * (§16.3: `safe_floor = max(USER_MIN, 0.90 × min(balance, trailing 30d)) + exposure_uplift`).
 *
 * The claim it makes concrete: "the bakery's flour line IS wheat." When wheat spikes, next
 * month's flour bill is bigger than the budget assumed, so the balance the company must keep
 * liquid is bigger too — and the agent should be holding back MORE cash, not sweeping it into
 * yield. That is a floor change, never a trade: `FLOOR_RAISE` is advisory/off-chain (§17.3), the
 * agent cannot alter its own on-chain mandate.
 *
 * Doctrine carried over from the decision rule:
 *   - **Asymmetric.** A price SPIKE raises the floor; a price DROP never lowers it below the
 *     mandate's floor. Cheap wheat is not a reason to take more risk.
 *   - **Deadbanded.** Shocks below the threshold are noise and produce no uplift, so ordinary
 *     index chatter cannot oscillate the floor (and with it, deploy/withdraw).
 *   - **Capped.** The uplift is hard-capped: a runaway or corrupted feed must never be able to
 *     strand the entire treasury behind an absurd floor.
 *   - **Degraded input is not zero.** A stale or unreadable signal returns `DEGRADED`, NOT "no
 *     shock" — the caller suppresses risk-ADDING moves while it holds (invariant #4), and
 *     withdrawals stay available. Silence about a shock is not evidence there isn't one.
 *
 * PROVENANCE: `PriceSignal.source` is carried and logged so a stub feed is never mistaken for an
 * oracle (AGENTS.md invariant 3 — never simulate a real input in a default code path).
 */

/** The company's exposure to one input-cost line. */
export interface CostLine {
  /** Human name of the line — surfaces verbatim in the decision `reason` and on the dashboard. */
  inputName: string;
  /** Share of the monthly cost base this line represents, 0–100. */
  weightPct: number;
  /** Total monthly cost base, USDC base units. */
  monthlyCostBaseUsdc: string;
}

/** A price observation for the input behind a `CostLine`. */
export interface PriceSignal {
  indexName: string;
  /** Index level the cost base was budgeted at. */
  baselineIndex: number;
  /** Index level observed now. */
  currentIndex: number;
  asOf: string;
  /** Where this came from. Disclosed, never dressed up as an oracle. */
  source: string;
}

export interface ExposureConfig {
  /** Deadband: shocks strictly below this produce no uplift. */
  shockThresholdPct: number;
  /** Months of the shocked input spend the floor should cover. */
  coverageMonths: number;
  /** Hard cap on the uplift, USDC base units. */
  maxUpliftUsdc: string;
  /** A signal older than this is not evidence of anything. */
  staleAfterMs: number;
}

/**
 * - `NONE`     — no material shock (or the leg is not fed). Floor unchanged, loop unaffected.
 * - `ACTIVE`   — a real shock; `exposure` carries the uplift.
 * - `DEGRADED` — the signal cannot be trusted. No uplift, and the caller must suppress deploys.
 */
export type ExposureStatus = 'NONE' | 'ACTIVE' | 'DEGRADED';

export interface ExposureAssessment {
  status: ExposureStatus;
  exposure?: Exposure;
  /** One judge-legible sentence: what the engine saw and what it did about it. */
  note: string;
}

/** basis points, so every money step below is exact BigInt arithmetic. */
const BP = 10_000n;
/** Round UP: a truncated uplift is less protective than intended (cf. floorNinetyPctCeil). */
const ceilDiv = (n: bigint, d: bigint): bigint => (n + d - 1n) / d;

const isFiniteNumber = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/**
 * Assess one cost line against one price signal. Pure — `now` is the only notion of time, and
 * identical inputs always produce an identical assessment (property-tested).
 */
export function assessExposure(
  line: CostLine,
  signal: PriceSignal,
  config: ExposureConfig,
  now: string,
): ExposureAssessment {
  // ── Guards: anything we cannot read is DEGRADED, never a silent zero ──
  if (!isFiniteNumber(signal.baselineIndex) || signal.baselineIndex <= 0) {
    return { status: 'DEGRADED', note: `exposure: ${signal.indexName} baseline index is unusable (${signal.baselineIndex}) — cannot size a shock.` };
  }
  if (!isFiniteNumber(signal.currentIndex) || signal.currentIndex < 0) {
    return { status: 'DEGRADED', note: `exposure: ${signal.indexName} current index is unusable (${signal.currentIndex}) — cannot size a shock.` };
  }
  if (!isFiniteNumber(line.weightPct) || line.weightPct < 0 || line.weightPct > 100) {
    return { status: 'DEGRADED', note: `exposure: ${line.inputName} cost weight ${line.weightPct}% is out of range (0–100).` };
  }

  let monthlyCostBase: bigint;
  try {
    monthlyCostBase = BigInt(line.monthlyCostBaseUsdc);
  } catch {
    return { status: 'DEGRADED', note: `exposure: monthly cost base "${line.monthlyCostBaseUsdc}" is not an integer amount.` };
  }
  if (monthlyCostBase < 0n) {
    return { status: 'DEGRADED', note: 'exposure: monthly cost base is negative.' };
  }

  const asOfMs = Date.parse(signal.asOf);
  const nowMs = Date.parse(now);
  if (!Number.isFinite(asOfMs) || !Number.isFinite(nowMs)) {
    return { status: 'DEGRADED', note: `exposure: unreadable timestamp on the ${signal.indexName} signal.` };
  }
  const ageMs = nowMs - asOfMs;
  if (ageMs > config.staleAfterMs) {
    const hours = Math.floor(ageMs / 3_600_000);
    return {
      status: 'DEGRADED',
      note: `exposure: ${signal.indexName} signal is stale (${hours}h old, limit ${Math.floor(config.staleAfterMs / 3_600_000)}h, source ${signal.source}) — treating the exposure picture as unknown.`,
    };
  }

  // ── Shock, in basis points of the baseline ──
  const shockBp = BigInt(Math.round(((signal.currentIndex - signal.baselineIndex) / signal.baselineIndex) * 10_000));
  const shockPct = Number(shockBp) / 100;
  const thresholdBp = BigInt(Math.round(config.shockThresholdPct * 100));

  // Asymmetric + deadbanded: only a spike past the deadband moves the floor.
  if (shockBp < thresholdBp) {
    return {
      status: 'NONE',
      note: `exposure: ${signal.indexName} at ${shockPct >= 0 ? '+' : ''}${shockPct}% vs baseline — inside the ±${config.shockThresholdPct}% deadband, floor unchanged.`,
    };
  }

  // uplift = monthly cost base × line weight × shock × coverage months, each step exact.
  const weightBp = BigInt(Math.round(line.weightPct * 100));
  const monthlyInputSpend = ceilDiv(monthlyCostBase * weightBp, BP);
  const monthlyIncrease = ceilDiv(monthlyInputSpend * shockBp, BP);
  const raw = monthlyIncrease * BigInt(Math.max(0, Math.trunc(config.coverageMonths)));

  const cap = BigInt(config.maxUpliftUsdc);
  const uplift = raw > cap ? cap : raw;
  const cappedNote = raw > cap ? ` (capped from ${raw} by EXPOSURE_MAX_UPLIFT_USDC)` : '';

  if (uplift === 0n) {
    return {
      status: 'NONE',
      note: `exposure: ${signal.indexName} ${shockPct >= 0 ? '+' : ''}${shockPct}% shock sizes to a zero uplift on a ${line.weightPct}% cost line — floor unchanged.`,
    };
  }

  return {
    status: 'ACTIVE',
    exposure: {
      inputName: line.inputName,
      weightPct: line.weightPct,
      shockPct,
      floorUpliftUsdc: uplift.toString(),
    },
    note: `exposure: ${signal.indexName} ${shockPct >= 0 ? '+' : ''}${shockPct}% vs baseline on a ${line.weightPct}% cost line ⇒ +${uplift} floor uplift for ${config.coverageMonths} month(s)${cappedNote} [source ${signal.source}].`,
  };
}
