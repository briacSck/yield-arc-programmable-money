import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { Decision as DecisionSchema } from '@yield/shared';
import { decide, type DecideInput } from './engine.js';

/**
 * Property + unit tests on the decision rule (plan §16.3) — the repo's contract.
 *
 * The two invariants above all:
 *   (1) An agent DEPLOY can never drop the company balance below the safe floor.
 *   (2) Any degraded input (stale forecast, horizon mismatch, empty series) yields HOLD.
 *
 * Arbitraries are CONSTRAINED to be meaningful (eng review #20): p10≤p50≤p90 by construction,
 * series dates actually span the horizon, exposure is generated, and amounts sit in a range where
 * DEPLOY/WITHDRAW genuinely fire (a deterministic unit test proves non-vacuity besides).
 */

const HASH = '0x' + '11'.repeat(32);
const NOW = '2026-07-14T12:00:00Z';
const FRESH_ASOF = '2026-07-14T11:00:00Z';
const STALE_ASOF = '2026-07-12T00:00:00Z';

function dateAtOffset(days: number): string {
  const d = new Date(Date.parse('2026-07-14T00:00:00Z') + days * 86_400_000);
  return d.toISOString().slice(0, 10);
}

const usdc = (max: bigint) => fc.bigInt({ min: 0n, max }).map((n) => n.toString());

function inputArb(nowIso: string, asOfIso: string): fc.Arbitrary<DecideInput> {
  const point = fc
    .tuple(fc.integer({ min: 0, max: 89 }), fc.array(fc.bigInt({ min: 0n, max: 10n ** 13n }), { minLength: 3, maxLength: 3 }))
    .map(([offset, vals]) => {
      const sorted = [...vals].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      return {
        date: dateAtOffset(offset),
        p10: sorted[0]!.toString(),
        p50: sorted[1]!.toString(),
        p90: sorted[2]!.toString(),
      };
    });
  const exposureArb = fc.option(
    fc.record({
      inputName: fc.constantFrom('wheat', 'butter', 'energy'),
      weightPct: fc.integer({ min: 1, max: 60 }),
      shockPct: fc.integer({ min: -30, max: 60 }),
      floorUpliftUsdc: usdc(10n ** 10n),
    }),
    { nil: undefined },
  );
  return fc.record({
    forecast: fc.record({
      asOf: fc.constant(asOfIso),
      horizonDays: fc.constant(90),
      series: fc.array(point, { minLength: 1, maxLength: 6 }),
      modelId: fc.constant('deterministic-baseline@0.1.0'),
      inputsHash: fc.constant(HASH),
    }),
    companyBalanceUsdc: usdc(10n ** 13n),
    deployedUsdc: usdc(10n ** 13n),
    trailing30dMinUsdc: usdc(10n ** 13n),
    config: fc.record({
      userMinUsdc: usdc(10n ** 12n),
      minTicketUsdc: usdc(10n ** 9n),
      horizonDays: fc.constantFrom(30, 60, 90),
    }),
    now: fc.constant(nowIso),
    exposure: exposureArb,
  });
}

test('INVARIANT: a DEPLOY never breaches the safe floor', () => {
  fc.assert(
    fc.property(inputArb(NOW, FRESH_ASOF), (input) => {
      const d = decide(input);
      if (d.kind !== 'DEPLOY') return true;
      const after = BigInt(input.companyBalanceUsdc) - BigInt(d.amountUsdc);
      return after >= BigInt(d.floorUsdc);
    }),
    { numRuns: 500 },
  );
});

test('INVARIANT: stale forecast (>24h) forces HOLD', () => {
  fc.assert(
    fc.property(inputArb(NOW, STALE_ASOF), (input) => {
      assert.equal(decide(input).kind, 'HOLD');
    }),
  );
});

test('INVARIANT: WITHDRAW never exceeds what is deployed', () => {
  fc.assert(
    fc.property(inputArb(NOW, FRESH_ASOF), (input) => {
      const d = decide(input);
      if (d.kind !== 'WITHDRAW') return true;
      return BigInt(d.amountUsdc) <= BigInt(input.deployedUsdc) && BigInt(d.amountUsdc) > 0n;
    }),
    { numRuns: 500 },
  );
});

test('INVARIANT: identical input ⇒ identical Decision (pure + deterministic)', () => {
  fc.assert(
    fc.property(inputArb(NOW, FRESH_ASOF), (input) => {
      assert.deepEqual(decide(input), decide(structuredClone(input)));
    }),
    { numRuns: 200 },
  );
});

test('INVARIANT: every Decision parses against the pinned shared schema', () => {
  fc.assert(
    fc.property(inputArb(NOW, FRESH_ASOF), (input) => {
      DecisionSchema.parse(decide(input));
    }),
    { numRuns: 200 },
  );
});

// ── Deterministic unit cases (prove the properties are not vacuous) ──

const U = (n: number) => (BigInt(n) * 1_000_000n).toString(); // whole USDC → 6-dec base units

function baseInput(overrides: Partial<DecideInput> = {}): DecideInput {
  return {
    forecast: {
      asOf: FRESH_ASOF,
      horizonDays: 90,
      series: [{ date: dateAtOffset(10), p10: U(95_000), p50: U(100_000), p90: U(110_000) }],
      modelId: 'deterministic-baseline@0.1.0',
      inputsHash: HASH,
    },
    companyBalanceUsdc: U(100_000),
    deployedUsdc: U(50_000),
    trailing30dMinUsdc: U(100_000),
    config: { userMinUsdc: '0', minTicketUsdc: U(1), horizonDays: 30 },
    now: NOW,
    ...overrides,
  };
}

test('DEPLOY fires with the exact surplus above max(floor, P10 low)', () => {
  const d = decide(baseInput());
  // floor = ceil(0.9 × 100k) = 90k; guard = max(90k, p10 95k) = 95k; surplus = 5k.
  assert.equal(d.kind, 'DEPLOY');
  assert.equal(d.amountUsdc, U(5_000));
  assert.equal(d.floorUsdc, U(90_000));
  assert.match(d.reason, /DEPLOY 5000 USDC/);
});

test('WITHDRAW wins over DEPLOY when P10 projects a breach', () => {
  const d = decide(
    baseInput({
      forecast: {
        ...baseInput().forecast,
        series: [
          { date: dateAtOffset(5), p10: U(80_000), p50: U(95_000), p90: U(105_000) },
          { date: dateAtOffset(20), p10: U(120_000), p50: U(130_000), p90: U(140_000) },
        ],
      },
    }),
  );
  // floor 90k; min p10 80k < floor → shortfall 10k; deployed 50k → WITHDRAW 10k.
  assert.equal(d.kind, 'WITHDRAW');
  assert.equal(d.amountUsdc, U(10_000));
  assert.match(d.reason, /pulling funds back/);
});

test('projected breach with nothing deployed → HOLD, never WITHDRAW "0"', () => {
  const d = decide(
    baseInput({
      deployedUsdc: '0',
      forecast: {
        ...baseInput().forecast,
        series: [{ date: dateAtOffset(5), p10: U(80_000), p50: U(95_000), p90: U(105_000) }],
      },
    }),
  );
  assert.equal(d.kind, 'HOLD');
  assert.match(d.reason, /nothing is deployed to recover/);
});

test('surplus below min ticket → HOLD', () => {
  const d = decide(baseInput({ config: { userMinUsdc: '0', minTicketUsdc: U(10_000), horizonDays: 30 } }));
  assert.equal(d.kind, 'HOLD');
});

test('config horizon beyond forecast horizon → HOLD (no silent truncation)', () => {
  const d = decide(
    baseInput({
      forecast: { ...baseInput().forecast, horizonDays: 30 },
      config: { userMinUsdc: '0', minTicketUsdc: U(1), horizonDays: 90 },
    }),
  );
  assert.equal(d.kind, 'HOLD');
  assert.match(d.reason, /exceeds forecast horizon/);
});

test('empty series (defensive, bypasses zod) → HOLD', () => {
  const d = decide(baseInput({ forecast: { ...baseInput().forecast, series: [] } }));
  assert.equal(d.kind, 'HOLD');
});

test('FLOOR_RAISE when exposure uplifts the floor and no money moves', () => {
  const d = decide(
    baseInput({
      companyBalanceUsdc: U(90_000),
      trailing30dMinUsdc: U(90_000), // floor = 81k + 15k uplift = 96k > balance → no surplus
      forecast: {
        ...baseInput().forecast,
        series: [{ date: dateAtOffset(10), p10: U(98_000), p50: U(100_000), p90: U(110_000) }],
      },
      deployedUsdc: '0',
      exposure: { inputName: 'wheat', weightPct: 14, shockPct: 20, floorUpliftUsdc: U(15_000) },
    }),
  );
  assert.equal(d.kind, 'FLOOR_RAISE');
  assert.equal(d.amountUsdc, U(15_000));
  assert.match(d.reason, /wheat exposure/);
});

test('floor multiplication rounds UP (protective)', () => {
  const d = decide(baseInput({ companyBalanceUsdc: '1', trailing30dMinUsdc: '1', deployedUsdc: '0' }));
  // ceil(0.9 × 1) = 1, not 0.
  assert.equal(d.floorUsdc, '1');
});
