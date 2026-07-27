import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { Exposure as ExposureSchema } from '@yield/shared';
import { assessExposure, type CostLine, type ExposureConfig, type PriceSignal } from './engine.js';
import { decide, type DecideInput } from '../decision/engine.js';

/**
 * Tests on the SPICE leg. The properties that matter:
 *   (1) A price DROP never lowers the floor (asymmetry — cheap wheat ≠ licence to take risk).
 *   (2) The uplift is monotone in the shock and hard-capped (a runaway feed cannot strand cash).
 *   (3) A degraded signal is never silently read as "no shock".
 *   (4) The uplift, fed through the decision rule, only ever RAISES the floor — never breaches it.
 */

const NOW = '2026-07-27T12:00:00Z';
const FRESH = '2026-07-27T09:00:00Z';
const U = (n: number) => (BigInt(n) * 1_000_000n).toString();

/** Boulangerie Chartier at demo scale: flour ≈14% of a 10 USDC monthly cost base. */
const FLOUR: CostLine = { inputName: 'wheat', weightPct: 14, monthlyCostBaseUsdc: U(10) };

const CONFIG: ExposureConfig = {
  shockThresholdPct: 10,
  coverageMonths: 1,
  maxUpliftUsdc: U(2),
  staleAfterMs: 24 * 60 * 60 * 1000,
};

const signal = (over: Partial<PriceSignal> = {}): PriceSignal => ({
  indexName: 'MATIF milling wheat',
  baselineIndex: 200,
  currentIndex: 240, // +20%
  asOf: FRESH,
  source: 'seeded scenario feed (disclosed stub — not an oracle)',
  ...over,
});

test('the demo beat: wheat +20% on a 14% cost line raises the floor', () => {
  const a = assessExposure(FLOUR, signal(), CONFIG, NOW);
  assert.equal(a.status, 'ACTIVE');
  // 10 USDC base × 14% = 1.4 USDC of flour a month; +20% of that = 0.28 USDC, × 1 month.
  assert.equal(a.exposure!.floorUpliftUsdc, '280000');
  assert.equal(a.exposure!.shockPct, 20);
  assert.equal(a.exposure!.inputName, 'wheat');
  assert.doesNotThrow(() => ExposureSchema.parse(a.exposure));
  assert.match(a.note, /source seeded scenario feed/);
});

test('ASYMMETRY: a price drop never produces an uplift', () => {
  for (const currentIndex of [199, 150, 100, 0]) {
    const a = assessExposure(FLOUR, signal({ currentIndex }), CONFIG, NOW);
    assert.equal(a.status, 'NONE', `a drop to ${currentIndex} must not move the floor`);
    assert.equal(a.exposure, undefined);
  }
});

test('DEADBAND: shocks inside the threshold are noise, not signal', () => {
  const justUnder = assessExposure(FLOUR, signal({ currentIndex: 219 }), CONFIG, NOW); // +9.5%
  assert.equal(justUnder.status, 'NONE');
  const justOver = assessExposure(FLOUR, signal({ currentIndex: 220 }), CONFIG, NOW); // +10%
  assert.equal(justOver.status, 'ACTIVE');
});

test('CAP: a runaway feed cannot strand the treasury behind an absurd floor', () => {
  const a = assessExposure(FLOUR, signal({ currentIndex: 200_000 }), CONFIG, NOW);
  assert.equal(a.status, 'ACTIVE');
  assert.equal(a.exposure!.floorUpliftUsdc, CONFIG.maxUpliftUsdc);
  assert.match(a.note, /capped/);
});

test('DEGRADED: a stale signal is not read as "no shock"', () => {
  const a = assessExposure(FLOUR, signal({ asOf: '2026-07-20T09:00:00Z' }), CONFIG, NOW);
  assert.equal(a.status, 'DEGRADED');
  assert.equal(a.exposure, undefined);
  assert.match(a.note, /stale/);
});

test('DEGRADED: unusable index levels, timestamps, weights and cost bases', () => {
  const cases: Array<[string, () => ReturnType<typeof assessExposure>]> = [
    ['zero baseline', () => assessExposure(FLOUR, signal({ baselineIndex: 0 }), CONFIG, NOW)],
    ['NaN baseline', () => assessExposure(FLOUR, signal({ baselineIndex: Number.NaN }), CONFIG, NOW)],
    ['negative current', () => assessExposure(FLOUR, signal({ currentIndex: -1 }), CONFIG, NOW)],
    ['unreadable asOf', () => assessExposure(FLOUR, signal({ asOf: 'not-a-date' }), CONFIG, NOW)],
    ['weight > 100', () => assessExposure({ ...FLOUR, weightPct: 101 }, signal(), CONFIG, NOW)],
    ['non-integer base', () => assessExposure({ ...FLOUR, monthlyCostBaseUsdc: '1.5' }, signal(), CONFIG, NOW)],
    ['negative base', () => assessExposure({ ...FLOUR, monthlyCostBaseUsdc: '-1' }, signal(), CONFIG, NOW)],
  ];
  for (const [name, run] of cases) {
    const a = run();
    assert.equal(a.status, 'DEGRADED', `${name} must degrade`);
    assert.equal(a.exposure, undefined, `${name} must not emit an exposure`);
  }
});

test('PURE: identical inputs always produce an identical assessment', () => {
  const a = assessExposure(FLOUR, signal(), CONFIG, NOW);
  const b = assessExposure(FLOUR, signal(), CONFIG, NOW);
  assert.deepEqual(a, b);
});

test('PROPERTY: uplift is monotone in the shock and never exceeds the cap', () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 200, max: 5_000 }),
      fc.integer({ min: 0, max: 5_000 }),
      (lowIndex, delta) => {
        const low = assessExposure(FLOUR, signal({ currentIndex: lowIndex }), CONFIG, NOW);
        const high = assessExposure(FLOUR, signal({ currentIndex: lowIndex + delta }), CONFIG, NOW);
        const upliftOf = (a: ReturnType<typeof assessExposure>) =>
          a.exposure ? BigInt(a.exposure.floorUpliftUsdc) : 0n;
        return (
          upliftOf(high) >= upliftOf(low) &&
          upliftOf(high) <= BigInt(CONFIG.maxUpliftUsdc) &&
          low.status !== 'DEGRADED' &&
          high.status !== 'DEGRADED'
        );
      },
    ),
  );
});

// ── The leg, end to end through the decision rule ──

const HASH = ('0x' + '11'.repeat(32)) as `0x${string}`;

function baseDecideInput(over: Partial<DecideInput> = {}): DecideInput {
  return {
    forecast: {
      asOf: FRESH,
      horizonDays: 30,
      series: [{ date: '2026-08-01', p10: U(9), p50: U(10), p90: U(11) }],
      modelId: 'deterministic-baseline@0.1.0',
      inputsHash: HASH,
    },
    companyBalanceUsdc: U(10),
    deployedUsdc: U(3),
    trailing30dMinUsdc: '0',
    config: { userMinUsdc: U(5), minTicketUsdc: U(1), horizonDays: 30 },
    now: NOW,
    ...over,
  };
}

test('END TO END: the uplift raises the floor the decision rule guards with', () => {
  const withoutExposure = decide(baseDecideInput());
  const { exposure } = assessExposure(FLOUR, signal(), CONFIG, NOW);
  const withExposure = decide(baseDecideInput({ exposure }));

  assert.ok(
    BigInt(withExposure.floorUsdc) > BigInt(withoutExposure.floorUsdc),
    'a live shock must raise the floor the agent protects',
  );
  assert.equal(
    BigInt(withExposure.floorUsdc) - BigInt(withoutExposure.floorUsdc),
    BigInt(exposure!.floorUpliftUsdc),
  );
});

test('END TO END: a big enough shock pulls funds back (video beat 3)', () => {
  // A 200 USDC monthly cost base makes the flour line material next to a 10 USDC pool (14% of it
  // is 28 USDC of flour a month; +20% ⇒ 5.6 USDC of uplift, enough to lift the 5 USDC floor past
  // the 9 USDC P10 tail). The cap is widened to match — it bounds a runaway feed, not a real shock.
  const wide: ExposureConfig = { ...CONFIG, maxUpliftUsdc: U(50) };
  const sized = assessExposure({ ...FLOUR, monthlyCostBaseUsdc: U(200) }, signal(), wide, NOW);
  assert.equal(sized.status, 'ACTIVE');
  assert.equal(sized.exposure!.floorUpliftUsdc, '5600000', '200 × 14% × 20% = 5.6 USDC');

  const d = decide(baseDecideInput({ exposure: sized.exposure }));
  assert.equal(d.kind, 'WITHDRAW', 'the raised floor should recall deployed funds');
  assert.ok(BigInt(d.amountUsdc) > 0n);
  assert.ok(BigInt(d.amountUsdc) <= BigInt(U(3)), 'never recalls more than is deployed');
});

test('END TO END: a degraded signal holds DEPLOY but leaves WITHDRAW available', () => {
  // Risk-ADDING: surplus exists, but the exposure picture is unknown → HOLD, not DEPLOY.
  const deployable = decide(baseDecideInput({ deployedUsdc: '0' }));
  assert.equal(deployable.kind, 'DEPLOY', 'precondition: this input deploys when exposure is fine');
  const held = decide(baseDecideInput({ deployedUsdc: '0', exposureDegraded: true }));
  assert.equal(held.kind, 'HOLD');
  assert.match(held.reason, /exposure signal is degraded/);

  // Risk-REDUCING: a projected breach still recalls funds even with the signal down.
  const breach = baseDecideInput({
    forecast: {
      asOf: FRESH,
      horizonDays: 30,
      series: [{ date: '2026-08-01', p10: U(2), p50: U(3), p90: U(4) }],
      modelId: 'deterministic-baseline@0.1.0',
      inputsHash: HASH,
    },
    exposureDegraded: true,
  });
  assert.equal(decide(breach).kind, 'WITHDRAW', 'a degraded exposure feed must never strand funds');
});
