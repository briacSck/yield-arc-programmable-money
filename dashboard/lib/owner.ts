import type { EventLogRecord, ForecastResult } from '@yield/shared';

/**
 * Owner-mode derivations — pure, so the sentences a business owner reads are testable.
 *
 * The rule that governs this file: **every sentence is derived from the record, never written by
 * hand per event.** Three independent reviewers flagged hand-authored captions as a lie surface —
 * a human sentence sitting above a machine-derived one, on a screen whose credibility is that it
 * reports rather than narrates. If a fact cannot be derived, it is not stated.
 */

/** How far the forecast says the company is safe, and how close it comes to the floor. */
export interface Coverage {
  /** Last date (ISO yyyy-mm-dd) the P10 line stays at or above the floor. Null if it never does. */
  coveredThrough: string | null;
  /** True when P10 never dips below the floor across the whole horizon. */
  coveredWholeHorizon: boolean;
  /** The worst projected point: its date and how far above (positive) or below (negative) the floor. */
  tightest: { date: string; marginBaseUnits: bigint } | null;
}

/**
 * Walk the P10 (bad-case) line against the floor.
 *
 * P10 is the conservative line — "if things go badly". Reading coverage off P50 would tell the
 * owner she is fine on average, which is not the question anyone asks about payroll.
 */
export function coverage(forecast: ForecastResult | null, floorBaseUnits: string | null): Coverage {
  const empty: Coverage = { coveredThrough: null, coveredWholeHorizon: false, tightest: null };
  if (!forecast || forecast.series.length === 0 || floorBaseUnits === null) return empty;

  const floor = BigInt(floorBaseUnits);
  let coveredThrough: string | null = null;
  let breached = false;
  let tightest: { date: string; marginBaseUnits: bigint } | null = null;

  for (const point of forecast.series) {
    const p10 = BigInt(point.p10);
    const margin = p10 - floor;
    if (tightest === null || margin < tightest.marginBaseUnits) {
      tightest = { date: point.date, marginBaseUnits: margin };
    }
    if (!breached) {
      if (margin >= 0n) coveredThrough = point.date;
      else breached = true;
    }
  }

  return { coveredThrough, coveredWholeHorizon: !breached, tightest };
}

/** One thing the agent did, in the owner's terms. */
export interface AgentAction {
  seq: number;
  /** ISO datetime it was logged. */
  at: string;
  /** Past-tense sentence, derived — never hand-written per event. */
  headline: string;
  /** The agent's own machine reason, kept as the evidence underneath. */
  reason: string;
  amountBaseUnits: string;
  kind: 'DEPLOY' | 'WITHDRAW';
  txHash: string | null;
}

/**
 * The confirmed money moves, newest first, phrased for a business owner.
 *
 * Cycles where nothing happened do not appear: "the agent looked and decided not to act" is true,
 * important, and belongs in advanced mode. On the owner's screen it is noise, and 199 rows of it
 * buries the one row that matters.
 */
export function agentActivity(events: EventLogRecord[], limit = 8): AgentAction[] {
  const out: AgentAction[] = [];
  for (let i = events.length - 1; i >= 0 && out.length < limit; i--) {
    const rec = events[i]!;
    if (rec.status !== 'CONFIRMED') continue;
    const kind = rec.decision.kind;
    if (kind !== 'DEPLOY' && kind !== 'WITHDRAW') continue;
    out.push({
      seq: rec.seq,
      at: rec.loggedAt,
      headline: kind === 'DEPLOY' ? 'Put spare cash to work' : 'Brought cash back to your account',
      reason: rec.decision.reason,
      amountBaseUnits: rec.decision.amountUsdc,
      kind,
      txHash: rec.execution?.txHash ?? null,
    });
  }
  return out;
}

/** Where the money is right now, for the allocation bar. All in USDC base units. */
export interface Allocation {
  /** Liquid, in the company account. */
  inAccount: bigint;
  /** Held back as the safety floor — a slice OF inAccount, not additional to it. */
  reserved: bigint;
  /** Deployed into the yield venue. */
  working: bigint;
  /** Liquid above the floor: what the agent could still put to work. */
  spare: bigint;
  total: bigint;
}

export function allocation(companyBaseUnits: string, deployedBaseUnits: string, floorBaseUnits: string): Allocation {
  const inAccount = BigInt(companyBaseUnits);
  const working = BigInt(deployedBaseUnits);
  const floor = BigInt(floorBaseUnits);
  // The floor can exceed the liquid balance (the business had a lean week). Clamp, so the bar never
  // renders a negative segment and never implies the agent stashed money it does not have.
  const reserved = inAccount < floor ? inAccount : floor;
  const spare = inAccount > floor ? inAccount - floor : 0n;
  return { inAccount, reserved, working, spare, total: inAccount + working };
}

/**
 * What-if: re-run coverage with a recurring monthly commitment added.
 *
 * This is the question an owner actually asks — *"can I afford to hire someone at €3,000 a month?"*
 * — and the one no SME tool answers with a plan behind it. The commitment is pro-rated across the
 * horizon (a monthly cost accrues daily), applied to the P10 line, and coverage is recomputed.
 *
 * `monthlyBaseUnits` is in USDC base units, positive for a cost, negative for new income.
 */
export function whatIf(
  forecast: ForecastResult | null,
  floorBaseUnits: string | null,
  monthlyBaseUnits: bigint,
): Coverage {
  if (!forecast) return { coveredThrough: null, coveredWholeHorizon: false, tightest: null };
  const startMs = Date.parse(`${forecast.asOf.slice(0, 10)}T00:00:00Z`);
  const shifted: ForecastResult = {
    ...forecast,
    series: forecast.series.map((p) => {
      const dayIndex = Math.max(0, Math.round((Date.parse(`${p.date}T00:00:00Z`) - startMs) / 86_400_000));
      // Pro-rate by elapsed days over a 30-day month. Integer maths: no float drift into money.
      const accrued = (monthlyBaseUnits * BigInt(dayIndex)) / 30n;
      const p10 = BigInt(p.p10) - accrued;
      return { ...p, p10: (p10 < 0n ? 0n : p10).toString() };
    }),
  };
  return coverage(shifted, floorBaseUnits);
}

/**
 * The brief: what the owner tells the agent, in the agent's own units.
 *
 * `floorBaseUnits` is the hard bound the agent may never cross. `yieldAppetite` shifts how much of
 * the headroom above the floor the agent is willing to commit — it is a preference, never a licence
 * to go below the floor, so it can only ever make the agent MORE conservative than its mandate.
 */
export type YieldAppetite = 'conservative' | 'balanced' | 'opportunistic';

export const APPETITE_RETAINED_PCT: Record<YieldAppetite, number> = {
  conservative: 50,
  balanced: 25,
  opportunistic: 10,
};

/**
 * How much the agent would put to work right now under this brief, given the projected low point.
 * Never returns more than the headroom above the floor, and never a negative number.
 */
export function deployableUnder(
  companyBaseUnits: string,
  floorBaseUnits: string,
  projectedLowBaseUnits: bigint | null,
  appetite: YieldAppetite,
): bigint {
  const balance = BigInt(companyBaseUnits);
  const floor = BigInt(floorBaseUnits);
  // Guard against BOTH the floor and the projected low — the same rule the agent itself applies.
  const guard = projectedLowBaseUnits !== null && projectedLowBaseUnits > floor ? projectedLowBaseUnits : floor;
  const headroom = balance > guard ? balance - guard : 0n;
  const retained = (headroom * BigInt(APPETITE_RETAINED_PCT[appetite])) / 100n;
  return headroom - retained;
}

/** yyyy-mm-dd → "28 July". The owner reads dates, not timestamps. */
export function dayMonth(isoDate: string): string {
  const t = Date.parse(`${isoDate}T00:00:00Z`);
  if (!Number.isFinite(t)) return isoDate;
  return new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' });
}
