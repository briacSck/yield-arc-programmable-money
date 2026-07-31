import { test } from 'node:test';
import assert from 'node:assert/strict';
import { replay } from './core/replay.js';
import { FIXTURE_NAMES, loadFixture } from './fixtures.js';

/**
 * GUARD: every whitelisted fixture must actually load.
 *
 * Refreshing the golden snapshot renames the fixture file. Miss the mapping in `fixtures.ts` — or
 * ship a `dist/` built before the rename — and `--fixture live-snapshot` dies with a raw ENOENT
 * stack. That path is the judge's firewall-proof, testnet-wobble-proof fallback: the one command
 * that still works when Arc is rate-limiting on demo day. It broke exactly this way on 2026-07-27
 * and nothing caught it, because every test loaded fixtures through the source, never the bundle.
 */
test('GUARD: every whitelisted fixture resolves to a file that loads', () => {
  for (const name of FIXTURE_NAMES) {
    assert.doesNotThrow(() => loadFixture(name), `fixture "${name}" does not load`);
  }
});

/**
 * Golden test — YIELD's real on-chain history at a fixed snapshot (block 54645259, 2026-07-31)
 * must verify COMPLIANT with the exact move/invariant counts. This is the one test that catches
 * Arc-RPC decode surprises and a regression in the replay core against REAL data, not synthetic
 * fixtures. When the live history grows, refresh the snapshot (`npm run snapshot -w verifier`)
 * and bump the expected counts below to the numbers that script prints.
 */

test('golden · YIELD live snapshot verifies 5/5 COMPLIANT', () => {
  const fx = loadFixture('live-snapshot');
  const v = replay(fx.events, { mandateAddress: fx.mandateAddress, chainId: fx.chainId, deployBlock: fx.deployBlock, source: 'fixture' });

  assert.equal(v.compliant, true, 'live history must be compliant by construction');
  assert.equal(v.totalMoves, 8, '4 DEPLOY + 4 WITHDRAW at this snapshot');
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
