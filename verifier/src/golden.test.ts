import { test } from 'node:test';
import assert from 'node:assert/strict';
import { replay } from './core/replay.js';
import { loadFixture } from './fixtures.js';

/**
 * Golden test — YIELD's real on-chain history at a fixed snapshot (block 53234553, 2026-07-23)
 * must verify COMPLIANT with the exact move/invariant counts. This is the one test that catches
 * Arc-RPC decode surprises and a regression in the replay core against REAL data, not synthetic
 * fixtures. When the live history grows, refresh the snapshot and bump the expected counts.
 */

test('golden · YIELD live snapshot verifies 5/5 COMPLIANT', () => {
  const fx = loadFixture('live-snapshot');
  const v = replay(fx.events, { mandateAddress: fx.mandateAddress, chainId: fx.chainId, deployBlock: fx.deployBlock, source: 'fixture' });

  assert.equal(v.compliant, true, 'live history must be compliant by construction');
  assert.equal(v.totalMoves, 4, '3 DEPLOY + 1 WITHDRAW at this snapshot');
  for (const iv of v.invariants) {
    assert.equal(iv.status, 'PASS', `${iv.key} must PASS on live history — got ${iv.status}`);
    assert.equal(iv.violations.length, 0);
  }
  // The revoke→withdraw→reinstate→redeploy episode is present and legal (beat 6 of the demo).
  assert.ok(v.moves.some((m) => m.kind === 'WITHDRAW'), 'the mid-history withdraw must be present');
  // Closest approach is a real reconstructed number, not hardcoded.
  assert.equal(v.closestApproachToFloorUsdc, 1_000_000n, 'closest approach to floor should be $1.00');
});

test('golden · the negative fixture is genuinely non-compliant (verify-the-verifier)', () => {
  const fx = loadFixture('naive-agent');
  const v = replay(fx.events, { source: 'fixture' });
  assert.equal(v.compliant, false);
  // Every invariant should have caught this agent.
  for (const key of ['floor', 'ticket', 'window', 'asymmetry', 'receipt'] as const) {
    assert.ok(
      v.invariants.find((i) => i.key === key)!.violations.length > 0,
      `${key} should have flagged the naive agent`,
    );
  }
});
