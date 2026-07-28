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

/** yyyy-mm-dd → "28 July". The owner reads dates, not timestamps. */
export function dayMonth(isoDate: string): string {
  const t = Date.parse(`${isoDate}T00:00:00Z`);
  if (!Number.isFinite(t)) return isoDate;
  return new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' });
}
