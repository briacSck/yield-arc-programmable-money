import { assessExposure, decide, type CostLine, type ExposureConfig, type PriceSignal } from '@yield/agent';
import { baselineForecast, type BaselineInputs } from '@yield/forecast';
import type { Decision, Exposure } from '@yield/shared';
import { BOULANGERIE_CHARTIER } from './persona.js';

/**
 * The scenario simulation — plan §11 / §16.5. **Pure and deterministic**: `simulate(config)`
 * reads no clock, no filesystem and no network, and returns a bit-identical transcript for
 * identical config. That is the requirement, not a nicety — the video is recorded from this, and
 * a demo that drifts between takes is not a demo.
 *
 * It drives the REAL forecast and the REAL decision rule (`@yield/forecast`, `@yield/agent`) over
 * a seeded ledger. The only simulated part is the world: the ledger, the wheat index, and a model
 * of `AgentMandate`'s accounting so the kicker (owner revokes → the next deposit is blocked) can
 * play out off-chain.
 *
 * ⚠️ SIMULATION — no chain, no money, no real prices. Every consumer must say so in its output
 * (AGENTS.md invariant 3). YIELD's actual on-chain history lives on the live dashboard and is
 * machine-checked by `npx -y @yield-cfo/mandate-verify`; this file proves nothing about it.
 */

const DAY_MS = 86_400_000;
/** Fixed simulation epoch — a wall-clock start date would make replays differ by run date. */
export const SIM_START_DATE = '2026-05-01';

// ── Seeded PRNG (mulberry32): same seed ⇒ same stream, forever, on every platform ──
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SimMandateParams {
  floorUsdc: string;
  maxTicketUsdc: string;
  dailyCapUsdc: string;
}

export interface SimConfig {
  seed: number;
  days: number;
  openingBalanceUsdc: string;
  mandate: SimMandateParams;
  /** Day indices (1-based) for the scripted beats. */
  script: {
    /** The wheat spike is a PULSE, not a step: it lands, the floor rises, then it normalises. */
    wheatShockDay: number;
    wheatNormalDay: number;
    /** Seasonal revenue slump — the known summer emptiness that creates the projected crunch. */
    slumpFromDay: number;
    slumpToDay: number;
    /** Fraction of normal revenue during the slump, in percent. */
    slumpRevenuePct: number;
    /**
     * The kicker fires on the first day from here on where the agent actually wants to DEPLOY —
     * the owner revokes exactly as the agent reaches for the money, and the move is refused. Tied
     * to the agent's own behaviour rather than a hand-picked date, so retuning the ledger can
     * never silently delete the beat.
     */
    revokeAfterDay: number;
    /** Days the mandate stays revoked before the owner reinstates it. */
    revokedForDays: number;
  };
  minTicketUsdc: string;
  horizonDays: number;
  exposure: { line: CostLine; config: ExposureConfig; baselineIndex: number; shockedIndex: number };
}

export type SimStatus = 'CONFIRMED' | 'SKIPPED' | 'BLOCKED';
export type SimBeat = 'deploy' | 'pullback' | 'exposure' | 'kicker';

export interface SimTick {
  day: number;
  date: string;
  companyBalanceUsdc: string;
  deployedUsdc: string;
  decision: Decision;
  status: SimStatus;
  /** Deterministic pseudo-tx id — an obvious simulation artefact, never an explorer link. */
  simTxId?: string;
  exposure?: Exposure;
  revoked: boolean;
  /** Which §11 beat this tick is, if any (first occurrence only). */
  beat?: SimBeat;
  note?: string;
}

/**
 * A model of `AgentMandate`'s accounting — the same predicates the deployed contract enforces
 * (contracts/contracts/AgentMandate.sol): deposits are triple-gated on floor, per-ticket cap and
 * a 24h TUMBLING budget window; withdrawals are ungated; a revoked mandate blocks deposits and
 * still allows withdrawals. That asymmetry IS the mandate thesis, so the sim must not soften it.
 */
class SimMandate {
  company: bigint;
  deployed = 0n;
  revoked = false;
  private windowStart = 0n;
  private windowDeployed = 0n;

  constructor(
    opening: bigint,
    private readonly floor: bigint,
    private readonly maxTicket: bigint,
    private readonly dailyCap: bigint,
  ) {
    this.company = opening;
  }

  /** @returns null on success, or the reason the contract would have reverted. */
  deposit(amount: bigint, tsSec: bigint): string | null {
    if (this.revoked) return 'mandate revoked — deposits blocked';
    if (amount === 0n) return 'zero amount';
    if (amount > this.maxTicket) return 'exceeds per-ticket cap';
    if (this.company - amount < this.floor) return 'would breach the floor';
    // Lazy tumbling window: resets iff a full day has elapsed since it opened (AgentMandate.sol).
    let windowDeployed = this.windowDeployed;
    if (tsSec >= this.windowStart + 86_400n) {
      this.windowStart = tsSec;
      windowDeployed = 0n;
    }
    if (windowDeployed + amount > this.dailyCap) return 'exceeds the 24h budget window';
    this.windowDeployed = windowDeployed + amount;
    this.company -= amount;
    this.deployed += amount;
    return null;
  }

  /** Risk-REDUCING: ungated, and allowed even while revoked. */
  withdraw(amount: bigint): string | null {
    if (amount === 0n) return 'zero amount';
    const moved = amount > this.deployed ? this.deployed : amount;
    if (moved === 0n) return 'nothing deployed to recall';
    this.deployed -= moved;
    this.company += moved;
    return null;
  }

  dailyCapRemaining(tsSec: bigint): bigint {
    if (tsSec >= this.windowStart + 86_400n) return this.dailyCap;
    return this.dailyCap > this.windowDeployed ? this.dailyCap - this.windowDeployed : 0n;
  }
}

const usdc = (eur: number): string => (BigInt(Math.round(eur)) * 1_000_000n).toString();

/** Boulangerie Chartier at full persona scale — §16.5, EUR figures read 1:1 as USDC for the sim. */
export function defaultSimConfig(overrides: Partial<SimConfig> = {}): SimConfig {
  return {
    seed: BOULANGERIE_CHARTIER.seed,
    days: 90,
    openingBalanceUsdc: usdc(BOULANGERIE_CHARTIER.averageBalanceEur),
    mandate: { floorUsdc: usdc(22_000), maxTicketUsdc: usdc(8_000), dailyCapUsdc: usdc(15_000) },
    script: {
      wheatShockDay: 30,
      wheatNormalDay: 52,
      slumpFromDay: 38,
      slumpToDay: 66,
      // A French bakery's August: the quarter empties out and the shutters come down for weeks.
      // Deep enough that the projected floor breach is real — which is what beat 2 needs.
      slumpRevenuePct: 10,
      revokeAfterDay: 70,
      revokedForDays: 4,
    },
    minTicketUsdc: usdc(500),
    horizonDays: 30,
    exposure: {
      line: {
        inputName: 'wheat',
        weightPct: BOULANGERIE_CHARTIER.flourCostSharePct,
        monthlyCostBaseUsdc: usdc(30_000),
      },
      config: {
        shockThresholdPct: 10,
        coverageMonths: 2,
        maxUpliftUsdc: usdc(12_000),
        staleAfterMs: 24 * 60 * 60 * 1000,
      },
      baselineIndex: 200,
      shockedIndex: 240, // +20% — the §11 beat-3 shock
    },
    ...overrides,
  };
}

/**
 * The bakery's PLANNED calendar for one day — the single source of truth for both the world and
 * the forecast. The simulated ledger walks it (plus seeded daily-takings noise); the forecast is
 * handed the same calendar as dated flows over its horizon. So the agent is not being fed a
 * forecast that secretly disagrees with reality — the only thing it genuinely cannot see is the
 * noise, which is exactly what the P10/P90 band is for.
 *
 * `seasonRevenueScale` is the summer slump the persona implies (`seasonalRevenue: true`): a French
 * bakery's August, when the quarter empties out. It is what turns a comfortable balance into a
 * projected floor breach — and it is a KNOWN seasonal pattern, so the agent sees it coming. That
 * is the entire point of beat 2: the agent pulls funds back *ahead of* the crunch.
 */
function plannedFlow(dateIso: string, seasonRevenueScale: (d: string) => number): bigint {
  const dayOfMonth = Number(dateIso.slice(8, 10));
  let flow = 0n;
  if (dayOfMonth === BOULANGERIE_CHARTIER.rentDayOfMonth) flow -= BigInt(usdc(3_000));
  if (dayOfMonth === BOULANGERIE_CHARTIER.urssafDayOfMonth) flow -= BigInt(usdc(6_000));
  if (dayOfMonth === BOULANGERIE_CHARTIER.payrollDayOfMonth) flow -= BigInt(usdc(BOULANGERIE_CHARTIER.payrollEur));
  if (dayOfMonth === 10 || dayOfMonth === 20) {
    flow += (BigInt(usdc(9_000)) * BigInt(Math.round(seasonRevenueScale(dateIso) * 100))) / 100n;
  }
  return flow;
}

/** Counter takings, seeded and bounded — never a surprise big enough to be the story. */
function dailyTakings(dateIso: string, rand: () => number, seasonRevenueScale: (d: string) => number): bigint {
  const base = 250 + rand() * 250;
  return BigInt(Math.round(base * seasonRevenueScale(dateIso) * 100)) * 10_000n;
}

/** The forecast's view: the same planned calendar, as dated flows across the horizon. */
function datedFlowsFor(
  fromMs: number,
  horizonDays: number,
  seasonRevenueScale: (d: string) => number,
): BaselineInputs['datedFlows'] {
  const flows: BaselineInputs['datedFlows'] = [];
  for (let t = 1; t <= horizonDays; t++) {
    const date = new Date(fromMs + t * DAY_MS).toISOString().slice(0, 10);
    const amount = plannedFlow(date, seasonRevenueScale);
    if (amount !== 0n) flows.push({ date, amountUsdc: amount.toString() });
  }
  return flows;
}

/** Deterministic simulation-only move id. Never formatted as an explorer link. */
function simTxId(day: number, decisionId: string): string {
  return `sim:${String(day).padStart(3, '0')}:${decisionId.slice(2, 14)}`;
}

/**
 * Run the scenario. Pure: identical `config` ⇒ identical `SimTick[]`, byte for byte.
 */
export function simulate(config: SimConfig = defaultSimConfig()): SimTick[] {
  const rand = mulberry32(config.seed);
  const startMs = Date.parse(`${SIM_START_DATE}T00:00:00Z`);
  const mandate = new SimMandate(
    BigInt(config.openingBalanceUsdc),
    BigInt(config.mandate.floorUsdc),
    BigInt(config.mandate.maxTicketUsdc),
    BigInt(config.mandate.dailyCapUsdc),
  );

  /** Date → revenue multiplier. The slump is a KNOWN season, so the forecast may use it too. */
  const dayOf = (dateIso: string) => Math.round((Date.parse(`${dateIso}T00:00:00Z`) - startMs) / DAY_MS);
  const seasonRevenueScale = (dateIso: string): number => {
    const d = dayOf(dateIso);
    return d >= config.script.slumpFromDay && d <= config.script.slumpToDay
      ? config.script.slumpRevenuePct / 100
      : 1;
  };

  const ticks: SimTick[] = [];
  const beatsSeen = new Set<SimBeat>();
  /** Set when the owner revokes; the mandate is reinstated on this day. */
  let reinstateOnDay: number | null = null;
  const claimBeat = (beat: SimBeat): SimBeat | undefined => {
    if (beatsSeen.has(beat)) return undefined;
    beatsSeen.add(beat);
    return beat;
  };

  for (let day = 1; day <= config.days; day++) {
    const dayMs = startMs + day * DAY_MS;
    const dateIso = new Date(dayMs).toISOString().slice(0, 10);
    const nowIso = `${dateIso}T09:00:00Z`;
    const tsSec = BigInt(Math.floor(Date.parse(nowIso) / 1000));

    // ── The world moves first ──
    mandate.company += plannedFlow(dateIso, seasonRevenueScale) + dailyTakings(dateIso, rand, seasonRevenueScale);
    if (reinstateOnDay !== null && day >= reinstateOnDay) {
      mandate.revoked = false;
      reinstateOnDay = null;
    }

    // ── The wheat index: a pulse — spike, hold, normalise ──
    const shocked = day >= config.script.wheatShockDay && day < config.script.wheatNormalDay;
    const signal: PriceSignal = {
      indexName: 'MATIF milling wheat',
      baselineIndex: config.exposure.baselineIndex,
      currentIndex: shocked ? config.exposure.shockedIndex : config.exposure.baselineIndex,
      asOf: nowIso,
      source: 'seeded scenario feed (SIMULATION — not a market oracle)',
    };
    const assessment = assessExposure(config.exposure.line, signal, config.exposure.config, nowIso);

    // ── The agent's own inputs, assembled exactly as the worker assembles them ──
    const total = mandate.company + mandate.deployed;
    const baselineInputs: BaselineInputs = {
      asOf: nowIso,
      horizonDays: 30,
      // Anchored on TOTAL liquidity (company + deployed), exactly as the live worker does: deployed
      // funds are recallable, so the position a dip is measured against is the total.
      openingBalanceUsdc: total.toString(),
      recurring: [],
      datedFlows: datedFlowsFor(dayMs, 30, seasonRevenueScale),
      dailyDeltaSigmaUsdc: usdc(400),
      kNum: '1',
      kDen: '1',
    };
    const forecast = baselineForecast(baselineInputs);

    const decision = decide({
      forecast,
      companyBalanceUsdc: mandate.company.toString(),
      deployedUsdc: mandate.deployed.toString(),
      trailing30dMinUsdc: '0',
      config: {
        userMinUsdc: config.mandate.floorUsdc,
        minTicketUsdc: config.minTicketUsdc,
        horizonDays: config.horizonDays,
        maxTicketUsdc: config.mandate.maxTicketUsdc,
        dailyCapRemainingUsdc: mandate.dailyCapRemaining(tsSec).toString(),
      },
      now: nowIso,
      ...(assessment.exposure ? { exposure: assessment.exposure } : {}),
      ...(assessment.status === 'DEGRADED' ? { exposureDegraded: true } : {}),
    });

    // ── Settle it against the mandate model ──
    const amount = BigInt(decision.amountUsdc);
    let status: SimStatus = 'SKIPPED';
    let note: string | undefined;
    let txId: string | undefined;
    let beat: SimBeat | undefined;

    // ── The kicker (§11): the owner revokes exactly as the agent reaches for the money ──
    if (
      !beatsSeen.has('kicker') &&
      !mandate.revoked &&
      day >= config.script.revokeAfterDay &&
      decision.kind === 'DEPLOY'
    ) {
      mandate.revoked = true;
      reinstateOnDay = day + config.script.revokedForDays;
    }

    if (decision.kind === 'DEPLOY') {
      const reverted = mandate.deposit(amount, tsSec);
      if (reverted) {
        status = 'BLOCKED';
        note = `mandate enforced: ${reverted}`;
        // The kicker (§11): the owner revoked, and the agent's next move is provably refused.
        if (mandate.revoked) beat = claimBeat('kicker');
      } else {
        status = 'CONFIRMED';
        txId = simTxId(day, decision.id);
        beat = claimBeat('deploy');
      }
    } else if (decision.kind === 'WITHDRAW') {
      const reverted = mandate.withdraw(amount);
      if (reverted) {
        status = 'SKIPPED';
        note = reverted;
      } else {
        status = 'CONFIRMED';
        txId = simTxId(day, decision.id);
        // Beat 3 is a pull-back the exposure uplift caused; beat 2 is the ordinary pre-crunch one.
        beat = assessment.exposure ? claimBeat('exposure') ?? claimBeat('pullback') : claimBeat('pullback');
      }
    } else if (decision.kind === 'FLOOR_RAISE') {
      note = 'floor raised — advisory, no money moved';
      beat = claimBeat('exposure');
    }

    ticks.push({
      day,
      date: dateIso,
      companyBalanceUsdc: mandate.company.toString(),
      deployedUsdc: mandate.deployed.toString(),
      decision,
      status,
      revoked: mandate.revoked,
      ...(txId ? { simTxId: txId } : {}),
      ...(assessment.exposure ? { exposure: assessment.exposure } : {}),
      ...(beat ? { beat } : {}),
      ...(note ? { note } : {}),
    });
  }

  return ticks;
}
