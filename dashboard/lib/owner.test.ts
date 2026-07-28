import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { EventLogRecord, ForecastResult } from '@yield/shared';
import { agentActivity, allocation, coverage, dayMonth } from './owner.js';
import { DEMO_SCALE, eur, eurFrom, toEur } from './scale.js';

const U = (n: number) => (BigInt(Math.round(n * 1_000_000)) ).toString();

function forecast(points: Array<[string, number]>): ForecastResult {
  return {
    asOf: '2026-07-28T09:00:00Z',
    horizonDays: points.length,
    series: points.map(([date, p10]) => ({ date, p10: U(p10), p50: U(p10 + 1), p90: U(p10 + 2) })),
    modelId: 'test',
    inputsHash: `0x${'11'.repeat(32)}`,
  };
}

// ── coverage ──────────────────────────────────────────────────────────────

test('coverage: reports the last date the bad case stays above the floor', () => {
  const c = coverage(forecast([['2026-07-29', 9], ['2026-07-30', 7], ['2026-07-31', 4]]), U(5));
  assert.equal(c.coveredThrough, '2026-07-30');
  assert.equal(c.coveredWholeHorizon, false);
});

test('coverage: a horizon that never dips is reported as fully covered', () => {
  const c = coverage(forecast([['2026-07-29', 9], ['2026-07-30', 8]]), U(5));
  assert.equal(c.coveredWholeHorizon, true);
  assert.equal(c.coveredThrough, '2026-07-30');
});

test('coverage: the tightest point is the WORST margin, not the last one', () => {
  const c = coverage(forecast([['2026-07-29', 9], ['2026-07-30', 5.5], ['2026-07-31', 8]]), U(5));
  assert.equal(c.tightest?.date, '2026-07-30');
  assert.equal(c.tightest?.marginBaseUnits, 500_000n, '0.50 above the floor');
});

test('coverage: a breach on day one reports covered-through null, not a fabricated date', () => {
  const c = coverage(forecast([['2026-07-29', 2]]), U(5));
  assert.equal(c.coveredThrough, null);
  assert.equal(c.coveredWholeHorizon, false);
  assert.ok(c.tightest!.marginBaseUnits < 0n, 'a breach shows a negative margin, not zero');
});

test('coverage: degrades to empty rather than guessing when inputs are missing', () => {
  assert.deepEqual(coverage(null, U(5)), { coveredThrough: null, coveredWholeHorizon: false, tightest: null });
  assert.deepEqual(coverage(forecast([['2026-07-29', 9]]), null), { coveredThrough: null, coveredWholeHorizon: false, tightest: null });
});

// ── allocation ────────────────────────────────────────────────────────────

test('allocation: splits liquid cash into reserved floor and spare', () => {
  const a = allocation(U(8.46), U(1.53), U(5));
  assert.equal(a.reserved, 5_000_000n);
  assert.equal(a.spare, 3_460_000n);
  assert.equal(a.working, 1_530_000n);
  assert.equal(a.total, 9_990_000n);
});

test('allocation: a lean week never renders a negative segment or invented reserve', () => {
  const a = allocation(U(3), U(1), U(5)); // balance below the floor
  assert.equal(a.reserved, 3_000_000n, 'reserved is clamped to what actually exists');
  assert.equal(a.spare, 0n);
});

// ── activity ──────────────────────────────────────────────────────────────

const move = (seq: number, kind: 'DEPLOY' | 'WITHDRAW', status: EventLogRecord['status']): EventLogRecord => ({
  seq,
  loggedAt: `2026-07-2${seq}T09:00:00Z`,
  status,
  decision: {
    id: `d${seq}`,
    ts: `2026-07-2${seq}T09:00:00Z`,
    kind,
    amountUsdc: U(2),
    floorUsdc: U(5),
    reason: `${kind} because reasons`,
    forecastInputsHash: `0x${'11'.repeat(32)}`,
  },
  execution: status === 'CONFIRMED' ? { txHash: `0xabc${seq}`, explorerUrl: 'x', identitySig: '0x1', receiptHash: `0x${'11'.repeat(32)}` } : null,
} as EventLogRecord);

test('activity: only confirmed money moves appear, newest first', () => {
  const acts = agentActivity([
    move(1, 'DEPLOY', 'CONFIRMED'),
    move(2, 'WITHDRAW', 'SKIPPED'),
    move(3, 'WITHDRAW', 'CONFIRMED'),
  ]);
  assert.equal(acts.length, 2);
  assert.equal(acts[0]!.seq, 3, 'newest first');
  assert.equal(acts[1]!.seq, 1);
});

test('activity: HOLDs never appear — 199 of them would bury the one row that matters', () => {
  const holds = Array.from({ length: 50 }, (_, i) => {
    const r = move(i, 'DEPLOY', 'SKIPPED');
    (r.decision as { kind: string }).kind = 'HOLD';
    return r;
  });
  assert.equal(agentActivity(holds).length, 0);
});

test('activity: headlines are derived from the kind, never authored per event', () => {
  const acts = agentActivity([move(1, 'DEPLOY', 'CONFIRMED'), move(2, 'WITHDRAW', 'CONFIRMED')]);
  const withdraw = acts.find((a) => a.kind === 'WITHDRAW')!;
  const deploy = acts.find((a) => a.kind === 'DEPLOY')!;
  assert.match(withdraw.headline, /back to your account/);
  assert.match(deploy.headline, /to work/);
  // the machine reason survives as the evidence underneath
  assert.match(deploy.reason, /DEPLOY because reasons/);
});

test('activity: respects its limit', () => {
  const many = Array.from({ length: 20 }, (_, i) => move(i, 'DEPLOY', 'CONFIRMED'));
  assert.equal(agentActivity(many, 5).length, 5);
});

// ── scale ─────────────────────────────────────────────────────────────────

test('scale: the persona position maps exactly — 10 USDC is the bakery\'s €38,000', () => {
  assert.equal(toEur(U(10)), 38_000);
  assert.equal(toEur(U(5)), 19_000, 'the 5 USDC floor is a €19,000 safety floor');
  assert.equal(DEMO_SCALE, 3800);
});

test('scale: formats whole euros by default and cents on request', () => {
  assert.equal(eur(38_000), '€38,000');
  assert.equal(eur(38_000.5, { cents: true }), '€38,000.50');
  assert.equal(eurFrom(U(8.469381)), '€32,184');
});

test('scale: zero and empty are zero, never NaN on the front page', () => {
  assert.equal(toEur('0'), 0);
  assert.equal(toEur(''), 0);
  assert.equal(eurFrom(''), '€0');
});

test('dayMonth: renders a readable date and passes junk through', () => {
  assert.equal(dayMonth('2026-09-12'), '12 September');
  assert.equal(dayMonth('nope'), 'nope');
});
