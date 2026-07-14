import { keccak256, toBytes } from 'viem';
import type { Decision, DecisionConfig, DecisionKind, Exposure, ForecastResult } from '@yield/shared';

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

const DAY_MS = 86_400_000;
const STALE_MS = 24 * 60 * 60 * 1000;
/** Deploy decisions guard against the P10 tail over at most this window (§16.3). */
const DEPLOY_GUARD_DAYS = 30;

const bmax = (a: bigint, b: bigint): bigint => (a > b ? a : b);
const bmin = (a: bigint, b: bigint): bigint => (a < b ? a : b);
/** 0.90 × x, rounded UP — a truncated floor is less protective than intended. */
const floorNinetyPctCeil = (x: bigint): bigint => (x * 90n + 99n) / 100n;

/** Base units (6-dec) → human string for judge-legible `reason` sentences. Display edge only. */
export function formatUsdc(baseUnits: bigint): string {
  const sign = baseUnits < 0n ? '-' : '';
  const abs = baseUnits < 0n ? -baseUnits : baseUnits;
  const whole = abs / 1_000_000n;
  const frac = abs % 1_000_000n;
  const fracStr = frac === 0n ? '' : `.${frac.toString().padStart(6, '0').replace(/0+$/, '')}`;
  return `${sign}${whole}${fracStr} USDC`;
}

/**
 * The decision rule — plan §16.3. **Pure and deterministic**: identical `DecideInput` always
 * produces an identical `Decision` (property-tested). No wall-clock reads — `input.now` is the
 * only notion of time. All money math is BigInt over 6-dec USDC base-unit strings; never floats.
 *
 *   safe_floor = max(USER_MIN, ceil(0.90 × min(balance, trailing 30d))) + exposure_uplift
 *   WITHDRAW (wins over deploy — safety first):
 *     if min(p10, withdraw horizon) < safe_floor → withdraw the projected shortfall,
 *     capped at deployedUsdc; a 0-capped withdraw is a HOLD, never `WITHDRAW "0"`.
 *   DEPLOY:
 *     surplus = balance − max(safe_floor, min(p10, next ≤30d)), clamped at 0;
 *     execute only when surplus ≥ MIN_TICKET and > 0.
 *   FLOOR_RAISE: exposure uplift present and no money moved — advisory/off-chain only (§17.3).
 *   FAIL-SAFE: stale inputs (>24h), empty/short series, or horizon mismatch → HOLD.
 *
 * Fail-safe philosophy (stated in the video): being wrong must cost opportunity, never solvency.
 */
export function decide(input: DecideInput): Decision {
  const { forecast, config } = input;

  const balance = BigInt(input.companyBalanceUsdc);
  const deployed = BigInt(input.deployedUsdc);
  const trailingMin = BigInt(input.trailing30dMinUsdc);
  const uplift = input.exposure ? BigInt(input.exposure.floorUpliftUsdc) : 0n;

  const safeFloor =
    bmax(BigInt(config.userMinUsdc), floorNinetyPctCeil(bmin(balance, trailingMin))) + uplift;

  const finish = (kind: DecisionKind, amount: bigint, reason: string): Decision => ({
    id: decisionAppId(input, kind, amount, safeFloor),
    ts: input.now,
    kind,
    amountUsdc: amount.toString(),
    floorUsdc: safeFloor.toString(),
    reason,
    forecastInputsHash: forecast.inputsHash,
    ...(input.exposure ? { exposure: input.exposure } : {}),
  });

  // ── Fail-safes first: any degraded input HOLDs (invariant #4) ──
  const asOfMs = Date.parse(forecast.asOf);
  const nowMs = Date.parse(input.now);
  if (!Number.isFinite(asOfMs) || !Number.isFinite(nowMs)) {
    return finish('HOLD', 0n, 'HOLD: unreadable timestamps on forecast or clock — refusing to act on degraded input.');
  }
  if (nowMs - asOfMs > STALE_MS) {
    const hours = Math.floor((nowMs - asOfMs) / 3_600_000);
    return finish('HOLD', 0n, `HOLD: forecast is stale (${hours}h old, limit 24h) — refusing to move money on outdated signals.`);
  }
  if (forecast.series.length === 0) {
    return finish('HOLD', 0n, 'HOLD: forecast series is empty — nothing to act on.');
  }
  if (config.horizonDays > forecast.horizonDays) {
    return finish(
      'HOLD',
      0n,
      `HOLD: configured horizon (${config.horizonDays}d) exceeds forecast horizon (${forecast.horizonDays}d) — refusing silent truncation of the safety guard.`,
    );
  }

  // ── P10 tail minima over the two guard windows ──
  const withdrawWindowDays = config.horizonDays;
  const deployWindowDays = Math.min(DEPLOY_GUARD_DAYS, config.horizonDays);
  const minP10Withdraw = minP10Within(forecast, asOfMs, withdrawWindowDays);
  const minP10Deploy = minP10Within(forecast, asOfMs, deployWindowDays);
  if (minP10Withdraw === null || minP10Deploy === null) {
    return finish('HOLD', 0n, 'HOLD: no forecast points fall inside the guard window — cannot assess the P10 tail.');
  }

  // ── WITHDRAW wins over DEPLOY: moving toward safety has priority ──
  if (minP10Withdraw < safeFloor) {
    const shortfall = safeFloor - minP10Withdraw;
    const amount = bmin(shortfall, deployed);
    if (amount === 0n) {
      return finish(
        'HOLD',
        0n,
        `HOLD: P10 projects a floor breach of ${formatUsdc(shortfall)} within ${withdrawWindowDays}d but nothing is deployed to recover.`,
      );
    }
    return finish(
      'WITHDRAW',
      amount,
      `WITHDRAW ${formatUsdc(amount)}: P10 projects the balance ${formatUsdc(shortfall)} below the safe floor of ${formatUsdc(safeFloor)} within ${withdrawWindowDays}d — pulling funds back ahead of the crunch.`,
    );
  }

  // ── DEPLOY: only the surplus above both the floor and the P10 tail ──
  const guard = bmax(safeFloor, minP10Deploy);
  const surplus = balance > guard ? balance - guard : 0n;
  if (surplus > 0n && surplus >= BigInt(config.minTicketUsdc)) {
    return finish(
      'DEPLOY',
      surplus,
      `DEPLOY ${formatUsdc(surplus)}: balance ${formatUsdc(balance)} exceeds max(safe floor ${formatUsdc(safeFloor)}, ${deployWindowDays}d P10 low ${formatUsdc(minP10Deploy)}) — sweeping surplus into yield.`,
    );
  }

  // ── FLOOR_RAISE: exposure moved the floor but no money moves this cycle ──
  if (uplift > 0n) {
    return finish(
      'FLOOR_RAISE',
      uplift,
      `FLOOR_RAISE ${formatUsdc(uplift)}: ${input.exposure!.inputName} exposure (+${input.exposure!.shockPct}% shock on a ${input.exposure!.weightPct}% cost line) raises the safe floor to ${formatUsdc(safeFloor)}.`,
    );
  }

  return finish(
    'HOLD',
    0n,
    `HOLD: no actionable surplus (${formatUsdc(surplus)} < min ticket) and no projected floor breach within ${withdrawWindowDays}d.`,
  );
}

/** Min P10 over series points dated within [asOf, asOf + days]. Null when no point qualifies. */
function minP10Within(forecast: ForecastResult, asOfMs: number, days: number): bigint | null {
  const cutoff = asOfMs + days * DAY_MS;
  let min: bigint | null = null;
  for (const point of forecast.series) {
    const t = Date.parse(`${point.date}T00:00:00Z`);
    if (!Number.isFinite(t) || t > cutoff) continue;
    const p10 = BigInt(point.p10);
    if (min === null || p10 < min) min = p10;
  }
  return min;
}

/**
 * App-level decision id: deterministic over the full input (including `input.now`, which is an
 * explicit input — never a wall-clock read). The ON-CHAIN decisionId is derived separately and
 * excludes `now` (see `onChainDecisionId` in the chain layer) so retries collide on-chain.
 */
function decisionAppId(input: DecideInput, kind: DecisionKind, amount: bigint, floor: bigint): string {
  return keccak256(
    toBytes(
      `${input.forecast.inputsHash}|${input.now}|${kind}|${amount}|${floor}|${input.companyBalanceUsdc}|${input.deployedUsdc}`,
    ),
  );
}
