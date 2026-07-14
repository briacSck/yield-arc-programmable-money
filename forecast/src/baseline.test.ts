import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ForecastResult } from '@yield/shared';
import { baselineForecast, canonicalInputsJson, isqrt, type BaselineInputs } from './baseline.js';

const U = (n: number) => (BigInt(n) * 1_000_000n).toString(); // whole USDC → 6-dec base units
const NEG = (n: number) => (-BigInt(n) * 1_000_000n).toString();

/**
 * "Boulangerie Chartier" fixture (§16.5 persona), chosen deliberately so the horizon crosses
 * THREE month boundaries (Aug 1, Sep 1, Oct 1) with a mid-month asOf after URSSAF day — the
 * calendar walk is where the bug lives (eng review #19).
 */
function fixture(overrides: Partial<BaselineInputs> = {}): BaselineInputs {
  return {
    asOf: '2026-07-14T08:00:00Z',
    horizonDays: 90,
    openingBalanceUsdc: U(38_000),
    recurring: [
      { label: 'payroll', dayOfMonth: 28, amountUsdc: NEG(12_000) },
      { label: 'urssaf', dayOfMonth: 5, amountUsdc: NEG(3_000) },
      { label: 'rent', dayOfMonth: 1, amountUsdc: NEG(1_500) },
    ],
    datedFlows: [{ date: '2026-08-15', amountUsdc: U(20_000) }],
    dailyDeltaSigmaUsdc: '0',
    kNum: '3',
    kDen: '2',
    ...overrides,
  };
}

function p50At(result: ForecastResult, date: string): string {
  const point = result.series.find((p) => p.date === date);
  assert.ok(point, `no forecast point for ${date}`);
  return point.p50;
}

test('calendar walk hits payroll/URSSAF/rent across three month boundaries (σ=0)', () => {
  const r = baselineForecast(fixture());
  assert.equal(r.series.length, 90);
  assert.equal(r.series[0]!.date, '2026-07-15');
  assert.equal(r.series[89]!.date, '2026-10-12');
  assert.equal(p50At(r, '2026-07-27'), U(38_000)); // untouched until first payroll
  assert.equal(p50At(r, '2026-07-28'), U(26_000)); // payroll
  assert.equal(p50At(r, '2026-08-01'), U(24_500)); // rent, first boundary
  assert.equal(p50At(r, '2026-08-05'), U(21_500)); // urssaf
  assert.equal(p50At(r, '2026-08-15'), U(41_500)); // dated AR lands
  assert.equal(p50At(r, '2026-08-28'), U(29_500)); // payroll again
  assert.equal(p50At(r, '2026-09-01'), U(28_000)); // second boundary
  assert.equal(p50At(r, '2026-10-05'), U(8_500)); // third boundary + urssaf
});

test('band math: p10/p90 = p50 ∓ (kNum/kDen)·σ·√t, exact at t=4', () => {
  const r = baselineForecast(fixture({ dailyDeltaSigmaUsdc: U(1_000) }));
  const t4 = r.series[3]!; // t=4 → √t=2 exactly → dev = 1.5 × 1000 × 2 = 3000 USDC
  assert.equal(t4.date, '2026-07-18');
  assert.equal(t4.p50, U(38_000));
  assert.equal(t4.p10, U(35_000));
  assert.equal(t4.p90, U(41_000));
});

test('p10 ≤ p50 ≤ p90 at every point, σ > 0', () => {
  const r = baselineForecast(fixture({ dailyDeltaSigmaUsdc: U(2_500) }));
  for (const p of r.series) {
    assert.ok(BigInt(p.p10) <= BigInt(p.p50), `${p.date}: p10 > p50`);
    assert.ok(BigInt(p.p50) <= BigInt(p.p90), `${p.date}: p50 > p90`);
  }
});

test('negative projections clamp to 0 (insolvency dip stays representable, conservatively)', () => {
  const r = baselineForecast(
    fixture({
      openingBalanceUsdc: U(1_000),
      recurring: [],
      datedFlows: [{ date: '2026-07-16', amountUsdc: NEG(5_000) }],
      dailyDeltaSigmaUsdc: '0',
    }),
  );
  assert.equal(p50At(r, '2026-07-15'), U(1_000));
  assert.equal(p50At(r, '2026-07-16'), '0'); // 1000 − 5000 clamped
  assert.equal(p50At(r, '2026-07-17'), '0');
});

test('bit-identical determinism + reorder-invariant inputsHash', () => {
  const a = baselineForecast(fixture());
  const b = baselineForecast(fixture());
  assert.deepEqual(a, b);

  const reordered = fixture();
  reordered.recurring = [reordered.recurring[2]!, reordered.recurring[0]!, reordered.recurring[1]!];
  reordered.datedFlows = [...reordered.datedFlows].reverse();
  const c = baselineForecast(reordered);
  assert.equal(c.inputsHash, a.inputsHash);
  assert.deepEqual(c.series, a.series);
  assert.equal(canonicalInputsJson(reordered), canonicalInputsJson(fixture()));
});

test('output parses against the pinned shared ForecastResult schema', () => {
  ForecastResult.parse(baselineForecast(fixture({ dailyDeltaSigmaUsdc: U(1_234) })));
});

test('input validation: bad dayOfMonth, bad horizon, bad kDen all throw', () => {
  assert.throws(() => baselineForecast(fixture({ horizonDays: 0 })), /horizonDays/);
  assert.throws(() => baselineForecast(fixture({ kDen: '0' })), /kDen/);
  assert.throws(
    () => baselineForecast(fixture({ recurring: [{ label: 'x', dayOfMonth: 31, amountUsdc: '1' }] })),
    /dayOfMonth/,
  );
});

test('isqrt: exact squares and floors', () => {
  assert.equal(isqrt(0n), 0n);
  assert.equal(isqrt(1n), 1n);
  assert.equal(isqrt(4n), 2n);
  assert.equal(isqrt(8n), 2n);
  assert.equal(isqrt(10n ** 12n), 10n ** 6n);
});
