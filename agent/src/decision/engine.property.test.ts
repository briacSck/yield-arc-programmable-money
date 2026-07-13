import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { decide, type DecideInput } from './engine.js';

/**
 * Property tests on the decision rule (plan §16.3) — the repo's contract. These are the FIRST
 * thing to be green when `decide` is implemented. They are `skip`-ped until then (the rule throws).
 * Un-skip by removing `{ skip: true }` once engine.ts is real.
 *
 * Two invariants matter above all:
 *   (1) An agent DEPLOY can never drop the company balance below the safe floor.
 *   (2) Any degraded input (stale forecast, etc.) yields HOLD — never a money move.
 */

const HASH = '0x' + '11'.repeat(32);

function inputArb(nowIso: string, asOfIso: string): fc.Arbitrary<DecideInput> {
  const amount = fc.bigInt({ min: 0n, max: 10n ** 24n }).map((n) => n.toString());
  return fc.record({
    forecast: fc.record({
      asOf: fc.constant(asOfIso),
      horizonDays: fc.constantFrom(30, 60, 90),
      series: fc.array(
        fc.record({ date: fc.constant('2026-07-14'), p10: amount, p50: amount, p90: amount }),
        { minLength: 1, maxLength: 4 },
      ),
      modelId: fc.constant('deterministic-baseline@0.1.0'),
      inputsHash: fc.constant(HASH),
    }),
    companyBalanceUsdc: amount,
    deployedUsdc: amount,
    trailing30dMinUsdc: amount,
    config: fc.record({
      userMinUsdc: amount,
      minTicketUsdc: amount,
      horizonDays: fc.constantFrom(30, 60, 90),
    }),
    now: fc.constant(nowIso),
  });
}

test('INVARIANT: a DEPLOY never breaches the safe floor', { skip: true }, () => {
  fc.assert(
    fc.property(inputArb('2026-07-14T12:00:00Z', '2026-07-14T11:00:00Z'), (input) => {
      const d = decide(input);
      if (d.kind !== 'DEPLOY') return true;
      const after = BigInt(input.companyBalanceUsdc) - BigInt(d.amountUsdc);
      return after >= BigInt(d.floorUsdc);
    }),
  );
});

test('INVARIANT: stale forecast (>24h) forces HOLD', { skip: true }, () => {
  fc.assert(
    fc.property(inputArb('2026-07-14T12:00:00Z', '2026-07-12T00:00:00Z'), (input) => {
      assert.equal(decide(input).kind, 'HOLD');
    }),
  );
});
