import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Decision as DecisionSchema } from '@yield/shared';
import { defaultSimConfig, simulate, type SimBeat } from './sim.js';
import { replayDigest } from './run.js';

/**
 * The scenario's contract. Two things must hold, or the demo is not a demo:
 *   (1) It replays BIT-IDENTICALLY. The video is cut from this; a run that drifts between takes
 *       is worthless, and so is an "offline fallback" that answers differently each time.
 *   (2) All four §11 beats actually occur. Ledger constants get retuned; a silently missing beat
 *       would only be discovered on camera.
 */

test('DETERMINISM: two runs of the same config are byte-identical', () => {
  const a = simulate(defaultSimConfig());
  const b = simulate(defaultSimConfig());
  assert.deepEqual(a, b);
  assert.equal(replayDigest(a), replayDigest(b));
});

test('DETERMINISM: a different seed gives a different history (the seed is real)', () => {
  const a = simulate(defaultSimConfig());
  const b = simulate(defaultSimConfig({ seed: 999 }));
  assert.notEqual(replayDigest(a), replayDigest(b));
});

test('all four §11 beats occur, in narrative order', () => {
  const ticks = simulate(defaultSimConfig());
  const beats = ticks.filter((t) => t.beat).map((t) => t.beat as SimBeat);
  for (const beat of ['deploy', 'pullback', 'exposure', 'kicker'] as const) {
    assert.ok(beats.includes(beat), `beat "${beat}" never fired — the demo lost a scene`);
  }
  // Beat 1 opens the story and the kicker closes it.
  assert.equal(beats[0], 'deploy');
  assert.equal(beats[beats.length - 1], 'kicker');
  // Each beat is claimed exactly once.
  assert.equal(new Set(beats).size, beats.length);
});

test('the kicker is a real refusal: a revoked mandate blocks the deposit the agent wanted', () => {
  const ticks = simulate(defaultSimConfig());
  const kicker = ticks.find((t) => t.beat === 'kicker')!;
  assert.equal(kicker.decision.kind, 'DEPLOY', 'the agent must genuinely have wanted to deploy');
  assert.equal(kicker.status, 'BLOCKED');
  assert.ok(kicker.revoked);
  assert.match(kicker.note ?? '', /revoked/);
  // …and the money did not move.
  const before = ticks[ticks.indexOf(kicker) - 1]!;
  assert.equal(kicker.deployedUsdc, before.deployedUsdc);
});

test('asymmetry holds while revoked: withdrawals are never blocked', () => {
  const ticks = simulate(defaultSimConfig());
  const blockedWithdrawals = ticks.filter((t) => t.status === 'BLOCKED' && t.decision.kind === 'WITHDRAW');
  assert.equal(blockedWithdrawals.length, 0, 'a revoked mandate must still let funds come home');
});

test('INVARIANT: no agent action ever leaves the balance below the floor', () => {
  const config = defaultSimConfig();
  const floor = BigInt(config.mandate.floorUsdc);
  for (const tick of simulate(config)) {
    if (tick.status === 'CONFIRMED' && tick.decision.kind === 'DEPLOY') {
      assert.ok(
        BigInt(tick.companyBalanceUsdc) >= floor,
        `day ${tick.day}: a DEPLOY left the balance below the floor`,
      );
    }
  }
});

test('INVARIANT: every deploy respects the per-ticket cap and the 24h window', () => {
  const config = defaultSimConfig();
  const maxTicket = BigInt(config.mandate.maxTicketUsdc);
  for (const tick of simulate(config)) {
    if (tick.status === 'CONFIRMED' && tick.decision.kind === 'DEPLOY') {
      assert.ok(BigInt(tick.decision.amountUsdc) <= maxTicket, `day ${tick.day}: ticket cap exceeded`);
    }
  }
});

test('every emitted decision satisfies the shared schema', () => {
  for (const tick of simulate(defaultSimConfig({ days: 30 }))) {
    assert.doesNotThrow(() => DecisionSchema.parse(tick.decision), `day ${tick.day}`);
  }
});

test('the exposure uplift only exists while the wheat pulse is live', () => {
  const config = defaultSimConfig();
  for (const tick of simulate(config)) {
    const inPulse = tick.day >= config.script.wheatShockDay && tick.day < config.script.wheatNormalDay;
    assert.equal(Boolean(tick.exposure), inPulse, `day ${tick.day}: exposure presence should track the pulse`);
  }
});
