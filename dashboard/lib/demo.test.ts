import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultSimConfig, simulate } from '@yield/scenario';
import { demoEventsAt, isDemoRequested } from './demo.js';
import { SIM_SCALE, eurFrom, eurToUnits, toEur } from './scale.js';

/**
 * The ?demo=90d adapter's contract. The honesty rules are load-bearing: a fabricated audit verdict
 * or an explorer link on a simulated move would be machine-attested-looking evidence for history
 * that never touched a chain — worse than having no demo at all.
 */

const config = defaultSimConfig();
const ticks = simulate(config);

// ── URL gate ──────────────────────────────────────────────────────────────

test('isDemoRequested: only ?demo=90d turns the demo on', () => {
  assert.equal(isDemoRequested('?demo=90d'), true);
  assert.equal(isDemoRequested('?foo=1&demo=90d'), true);
  assert.equal(isDemoRequested(''), false);
  assert.equal(isDemoRequested('?demo=1'), false);
  assert.equal(isDemoRequested('?demo='), false);
});

// ── Day-N mapping ─────────────────────────────────────────────────────────

test('day N: events run 1..N and the snapshot is day N’s tick', () => {
  const day = 37;
  const res = demoEventsAt(config, ticks, day);
  const tick = ticks[day - 1]!;

  assert.equal(res.events.length, day);
  assert.equal(res.events[0]!.seq, 1);
  assert.equal(res.events[day - 1]!.seq, day);
  assert.equal(res.stats.cycles, day);
  assert.equal(res.stats.decisions, day);
  assert.equal(res.stats.lastCycleAt, tick.decision.ts);
  assert.equal(res.mandate?.companyBalanceUsdc, tick.companyBalanceUsdc);
  assert.equal(res.mandate?.deployedUsdc, tick.deployedUsdc);
  assert.equal(res.mandate?.floorUsdc, config.mandate.floorUsdc);
  assert.equal(res.latestForecast?.forecast, tick.forecast);
  assert.equal(res.latestForecast?.decisionId, tick.decision.id);
});

test('stats: onChainMoves equals the confirmed count up to that day, with first/last move times', () => {
  const day = 60;
  const res = demoEventsAt(config, ticks, day);
  const confirmed = ticks.slice(0, day).filter((t) => t.status === 'CONFIRMED');
  assert.ok(confirmed.length > 0, 'the scenario should have moved money by day 60');
  assert.equal(res.stats.onChainMoves, confirmed.length);
  assert.equal(res.stats.firstOnChainMoveAt, confirmed[0]!.decision.ts);
  assert.equal(res.stats.lastOnChainMoveAt, confirmed[confirmed.length - 1]!.decision.ts);
  assert.equal(res.stats.floorBreaches, 0);
});

test('day is clamped: 0 and beyond-the-end still map to real days', () => {
  assert.equal(demoEventsAt(config, ticks, 0).stats.cycles, 1);
  assert.equal(demoEventsAt(config, ticks, -5).stats.cycles, 1);
  assert.equal(demoEventsAt(config, ticks, 9999).stats.cycles, ticks.length);
});

// ── The kicker renders honestly ───────────────────────────────────────────

test('a revoked day renders revoked, and the kicker is a mandate-enforced refusal', () => {
  const kickerIdx = ticks.findIndex((t) => t.beat === 'kicker');
  assert.ok(kickerIdx >= 0, 'the scenario must contain the kicker');
  const day = kickerIdx + 1;
  const res = demoEventsAt(config, ticks, day);

  assert.equal(res.mandate?.revoked, true);
  const kickerEvent = res.events[day - 1]!;
  assert.equal(kickerEvent.status, 'FAILED');
  assert.match(kickerEvent.error ?? '', /revoked/i);
  assert.equal(kickerEvent.execution, null, 'a blocked move must not carry an execution');
});

test('after reinstatement the snapshot is active again', () => {
  const lastRevoked = ticks.map((t) => t.revoked).lastIndexOf(true);
  assert.ok(lastRevoked >= 0 && lastRevoked + 1 < ticks.length, 'the sim must reinstate before it ends');
  assert.equal(demoEventsAt(config, ticks, lastRevoked + 2).mandate?.revoked, false);
});

// ── Honesty rules ─────────────────────────────────────────────────────────

test('HONESTY: audit is null on every single day', () => {
  for (let day = 1; day <= ticks.length; day++) {
    assert.strictEqual(demoEventsAt(config, ticks, day).audit, null, `day ${day} leaked an audit block`);
  }
});

test('HONESTY: no explorer URL, no arcscan, no http anywhere in the payload', () => {
  const res = demoEventsAt(config, ticks, ticks.length);
  for (const e of res.events) {
    if (e.execution) {
      assert.equal(e.execution.explorerUrl, '', `seq ${e.seq}: a sim move carried an explorer URL`);
      assert.ok(e.execution.txHash.startsWith('sim:'), `seq ${e.seq}: txHash must be the obvious sim id`);
    }
  }
  const raw = JSON.stringify(res);
  assert.ok(!/arcscan/i.test(raw), 'payload mentions arcscan');
  assert.ok(!/https?:\/\//i.test(raw), 'payload contains a URL');
});

test('HONESTY: chain identifiers are empty — nothing to link, nothing to imply', () => {
  const res = demoEventsAt(config, ticks, 10);
  assert.equal(res.agentAddress, '');
  assert.equal(res.mandateAddress, '');
  assert.equal(res.identityRegistry, '');
  assert.equal(res.agentIdentityId, '');
});

// ── The euro lens ─────────────────────────────────────────────────────────

test('SIM_SCALE renders the full-scale sim 1:1 — a 22,000 USDC floor is €22,000, never €83.6M', () => {
  const floorUnits = config.mandate.floorUsdc; // 22,000 USDC in base units
  assert.equal(toEur(floorUnits, SIM_SCALE), 22_000);
  assert.equal(eurToUnits(22_000, SIM_SCALE), floorUnits);
  assert.match(eurFrom(floorUnits, { scale: SIM_SCALE }), /22,000/);
  // …and the default lens is UNCHANGED: the live product still speaks 1:3800.
  assert.equal(toEur('10000000'), 38_000);
});

// ── Determinism ───────────────────────────────────────────────────────────

test('the adapter is pure: same inputs, byte-identical payload', () => {
  const a = demoEventsAt(config, ticks, 45);
  const b = demoEventsAt(config, ticks, 45);
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test('confirmed moves carry the sim tx id and the committed forecast hash as their receipt', () => {
  const res = demoEventsAt(config, ticks, ticks.length);
  const moves = res.events.filter((e) => e.status === 'CONFIRMED');
  assert.ok(moves.length > 0);
  for (const m of moves) {
    assert.ok(m.execution, `seq ${m.seq}: confirmed move without execution`);
    assert.equal(m.execution!.receiptHash, m.decision.forecastInputsHash);
  }
});
