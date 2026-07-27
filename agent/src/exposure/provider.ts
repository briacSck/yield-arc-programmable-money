import { readFileSync } from 'node:fs';
import type { Exposure } from '@yield/shared';
import { assessExposure, type CostLine, type ExposureConfig, type PriceSignal } from './engine.js';

/**
 * The I/O half of the SPICE leg: env + a signal file in, an `ExposureAssessment` out. The pure
 * engine (`./engine.ts`) does all the judgement; this file only reads.
 *
 * **The leg is OFF unless `EXPOSURE_SIGNAL_PATH` is set.** No path ⇒ `null` ⇒ the scheduler passes
 * no exposure and the loop behaves exactly as it did before this file existed. That is deliberate:
 * the live worker is a money path, and a new input to it ships dark and gets switched on
 * explicitly, not by merge.
 *
 * A FILE rather than an env var for the price itself, because it is the seam the scenario driver
 * writes to (§11 beat 3: "wheat +20% → the floor rises → partial withdrawal") and the seam a real
 * feed would later write to, without either one touching this code.
 *
 * **Provenance is not optional.** The signal file must declare its `source`, and that string is
 * carried into every log line the leg produces — a seeded scenario feed must never be able to read
 * as a market oracle (AGENTS.md invariant 3).
 */

export interface ExposureReading {
  exposure?: Exposure;
  /** Signal was configured but cannot be trusted → the caller suppresses risk-ADDING moves. */
  degraded: boolean;
  note: string;
}

const num = (raw: string | undefined, fallback: number): number => {
  const n = Number(raw);
  return raw !== undefined && Number.isFinite(n) ? n : fallback;
};

/**
 * Build the per-cycle exposure reader, or `null` when the leg is disabled.
 *
 * Env:
 *   EXPOSURE_SIGNAL_PATH            enables the leg; JSON `PriceSignal` re-read every cycle
 *   EXPOSURE_INPUT_NAME             default 'wheat'
 *   EXPOSURE_WEIGHT_PCT             default 14   (§16.5: flour ≈14% of the bakery's costs)
 *   EXPOSURE_MONTHLY_COST_BASE_USDC required when enabled — base units
 *   EXPOSURE_SHOCK_THRESHOLD_PCT    default 10   (deadband)
 *   EXPOSURE_COVERAGE_MONTHS        default 1
 *   EXPOSURE_MAX_UPLIFT_USDC        default 2 USDC — hard cap on the uplift
 *   EXPOSURE_STALE_AFTER_MS         default 24h
 */
export function buildExposureProvider(
  env: NodeJS.ProcessEnv = process.env,
): ((now: string) => ExposureReading) | null {
  const signalPath = env.EXPOSURE_SIGNAL_PATH;
  if (!signalPath) return null;

  const line: CostLine = {
    inputName: env.EXPOSURE_INPUT_NAME || 'wheat',
    weightPct: num(env.EXPOSURE_WEIGHT_PCT, 14),
    monthlyCostBaseUsdc: env.EXPOSURE_MONTHLY_COST_BASE_USDC || '0',
  };

  const config: ExposureConfig = {
    shockThresholdPct: num(env.EXPOSURE_SHOCK_THRESHOLD_PCT, 10),
    coverageMonths: num(env.EXPOSURE_COVERAGE_MONTHS, 1),
    maxUpliftUsdc: env.EXPOSURE_MAX_UPLIFT_USDC || '2000000',
    staleAfterMs: num(env.EXPOSURE_STALE_AFTER_MS, 24 * 60 * 60 * 1000),
  };

  return (now: string): ExposureReading => {
    let signal: PriceSignal;
    try {
      const raw = JSON.parse(readFileSync(signalPath, 'utf8')) as Partial<PriceSignal>;
      if (!raw.source) {
        // Refusing an undeclared feed is the point: an unlabelled number could be anything.
        return { degraded: true, note: `exposure: signal at ${signalPath} declares no "source" — refusing to act on an unattributed price.` };
      }
      signal = {
        indexName: raw.indexName || 'input-cost index',
        baselineIndex: Number(raw.baselineIndex),
        currentIndex: Number(raw.currentIndex),
        asOf: String(raw.asOf ?? ''),
        source: raw.source,
      };
    } catch (err) {
      // Configured but unreadable is DEGRADED, never "no shock" — somebody meant to feed this.
      return { degraded: true, note: `exposure: cannot read the signal at ${signalPath} (${(err as Error).message}) — treating the exposure picture as unknown.` };
    }

    const assessment = assessExposure(line, signal, config, now);
    return {
      ...(assessment.exposure ? { exposure: assessment.exposure } : {}),
      degraded: assessment.status === 'DEGRADED',
      note: assessment.note,
    };
  };
}
