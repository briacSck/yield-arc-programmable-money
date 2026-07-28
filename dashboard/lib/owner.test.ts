import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { EventLogRecord, ForecastResult } from '@yield/shared';
import { agentActivity, allocation, coverage, dayMonth, deployableUnder, whatIf } from './owner.js';
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
  assert.equal(a.heldForForecast, 0n, 'no forecast guard given, so nothing is held beyond the floor');
  assert.equal(a.working, 1_530_000n);
  assert.equal(a.total, 9_990_000n);
});

test('allocation: money held for a projected dip is NOT reported as spare', () => {
  // The live case that made the screen contradict itself: balance 8.46, floor 5, but the forecast
  // low is 8.4 — so only 0.06 is genuinely free, not the 3.46 above the floor.
  const a = allocation(U(8.46), U(1.53), U(5), BigInt(U(8.4)));
  assert.equal(a.reserved, 5_000_000n);
  assert.equal(a.heldForForecast, 3_400_000n, 'the gap between floor and the projected low');
  assert.equal(a.spare, 60_000n);
  assert.equal(
    a.reserved + a.heldForForecast + a.spare,
    8_460_000n,
    'the three liquid segments must always sum to the account balance',
  );
});

test('allocation: spare agrees with what the brief says would be deployed', () => {
  // These two numbers sit next to each other on screen. If they can disagree, the page lies.
  const company = U(8.46);
  const floor = U(5);
  const low = BigInt(U(8.4));
  const a = allocation(company, U(1.53), floor, low);
  const deployable = deployableUnder(company, floor, low, 'opportunistic');
  assert.ok(deployable <= a.spare, 'the brief can never propose more than the bar calls spare');
});

test('allocation: a projected low BELOW the floor holds nothing extra — the floor already covers it', () => {
  const a = allocation(U(8.46), U(1.53), U(5), BigInt(U(3)));
  assert.equal(a.heldForForecast, 0n);
  assert.equal(a.spare, 3_460_000n);
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

// ── what-if ───────────────────────────────────────────────────────────────

test('whatIf: a hire the business can absorb still leaves it covered', () => {
  const f = forecast([['2026-07-29', 10], ['2026-08-15', 10], ['2026-08-28', 10]]);
  const c = whatIf(f, U(5), BigInt(U(1))); // 1 USDC/month against 5 of headroom
  assert.equal(c.coveredWholeHorizon, true);
});

test('whatIf: a hire it cannot absorb names the date the floor breaks', () => {
  const f = forecast([['2026-07-29', 10], ['2026-08-15', 10], ['2026-08-28', 10]]);
  const c = whatIf(f, U(5), BigInt(U(9))); // 9 USDC/month is far too much
  assert.equal(c.coveredWholeHorizon, false);
  assert.ok(c.tightest!.marginBaseUnits < 0n, 'the tightest point goes below the floor');
});

test('whatIf: the commitment accrues over time, it does not hit on day one', () => {
  const f = forecast([['2026-07-29', 10], ['2026-08-28', 10]]);
  const early = whatIf(f, U(5), BigInt(U(3)));
  // Day 1 of a 3 USDC/month cost should barely bite; day 30 should take the full amount.
  const points = early.tightest!;
  assert.ok(points.date === '2026-08-28', 'the worst point is the far end, not the near one');
});

test('whatIf: new income (a negative commitment) improves coverage', () => {
  const f = forecast([['2026-07-29', 6], ['2026-08-28', 4]]);
  const worse = whatIf(f, U(5), 0n);
  const better = whatIf(f, U(5), -BigInt(U(4)));
  assert.ok(
    better.tightest!.marginBaseUnits > worse.tightest!.marginBaseUnits,
    'adding income must raise the tightest margin',
  );
});

test('whatIf: no forecast yields no answer rather than a guess', () => {
  assert.deepEqual(whatIf(null, U(5), 100n), { coveredThrough: null, coveredWholeHorizon: false, tightest: null });
});

// ── the brief ─────────────────────────────────────────────────────────────

test('brief: appetite changes how much is committed, never the floor itself', () => {
  const low = deployableUnder(U(10), U(5), null, 'conservative');
  const mid = deployableUnder(U(10), U(5), null, 'balanced');
  const high = deployableUnder(U(10), U(5), null, 'opportunistic');
  assert.ok(low < mid && mid < high, 'appetite is monotonic');
  // 5 USDC of headroom; even the most aggressive setting leaves the floor untouched.
  assert.ok(high <= 5_000_000n, 'never commits more than the headroom above the floor');
});

test('brief: the projected low binds when it is above the floor', () => {
  // Balance 10, floor 5, but the forecast says it dips to 8 — only 2 is truly spare.
  const d = deployableUnder(U(10), U(5), BigInt(U(8)), 'opportunistic');
  assert.ok(d <= 2_000_000n, 'guards against the projected low, not just the floor');
});

test('brief: a balance at or below the floor commits nothing, ever', () => {
  assert.equal(deployableUnder(U(5), U(5), null, 'opportunistic'), 0n);
  assert.equal(deployableUnder(U(3), U(5), null, 'opportunistic'), 0n);
});

test('dayMonth: renders a readable date and passes junk through', () => {
  assert.equal(dayMonth('2026-09-12'), '12 September');
  assert.equal(dayMonth('nope'), 'nope');
});
