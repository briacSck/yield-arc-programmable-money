import { test } from 'node:test';
import assert from 'node:assert/strict';
import { replay, expectedDecisionId } from './replay.js';
import { KIND_DEPLOY, KIND_WITHDRAW, type NormalizedEvent } from '../types.js';

/**
 * Venue-leg fixtures (AgentMandateV2) — event streams modeled on the v2 Hardhat suite's venue
 * scenarios: subscription/redemption pairing, NAV gain and loss, the full-unwind basis-zeroing
 * rule, shortfall honesty, stranded-share recovery. The contract emits VenueSubscribed /
 * VenueRedeemed BEFORE the DecisionExecuted receipt of the same call (same block, lower logIndex).
 *
 * Two directions, same doctrine as replay.test.ts:
 *   - CONFORMING: legal venue histories that must stay 5/5 COMPLIANT with an exact reconstruction.
 *   - NONCONFORMING: contract-impossible venue streams the replay must surface in notes — loudly,
 *     but without flipping the five-invariant verdict (the CompanyFunded-drift precedent).
 */

const U = (n: number) => BigInt(Math.round(n * 1_000_000));
const DAY = 86_400n;
const T0 = 1_000_000n;
let BLK = 1000n;
const nextBlk = () => ++BLK;

const VENUE = '0x9fdF14c5B14173D74C08Af27AebFf39240dC105A' as `0x${string}`;
const SHARE = '0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C' as `0x${string}`;
const ZERO = '0x0000000000000000000000000000000000000000' as `0x${string}`;

function mandate(floor: number, ticket: number, cap: number, timestamp: bigint): NormalizedEvent {
  return { name: 'MandateChanged', blockNumber: nextBlk(), logIndex: 0, timestamp, args: { floor: U(floor), maxTicket: U(ticket), dailyCap: U(cap) } };
}
function fund(amount: number, running: number, timestamp: bigint): NormalizedEvent {
  return { name: 'CompanyFunded', blockNumber: nextBlk(), logIndex: 0, timestamp, args: { amount: U(amount), newCompanyBalance: U(running) } };
}
function venueChanged(venue: `0x${string}`, share: `0x${string}`, timestamp: bigint): NormalizedEvent {
  return { name: 'VenueChanged', blockNumber: nextBlk(), logIndex: 0, timestamp, args: { venue, share } };
}

/** A venue DEPLOY: [VenueSubscribed, DecisionExecuted] in one tx (same block, ordered logIndex). */
function venueDeploy(amount: bigint, minted: bigint, timestamp: bigint, opts: { assetsIn?: bigint } = {}): NormalizedEvent[] {
  const blockNumber = nextBlk();
  const forecastHash = `0x${blockNumber.toString(16).padStart(64, '0')}` as `0x${string}`;
  const decisionId = expectedDecisionId(forecastHash, KIND_DEPLOY)!;
  return [
    { name: 'VenueSubscribed', blockNumber, logIndex: 0, timestamp, args: { decisionId, assetsIn: opts.assetsIn ?? amount, sharesMinted: minted } },
    { name: 'DecisionExecuted', blockNumber, logIndex: 1, timestamp, args: { decisionId, kind: KIND_DEPLOY, amount, forecastHash } },
  ];
}

/** A venue WITHDRAW: [VenueRedeemed, DecisionExecuted(credited = assetsOut)] in one tx. */
function venueWithdraw(
  burned: bigint,
  assetsOut: bigint,
  assetsRequested: bigint,
  timestamp: bigint,
  opts: { credited?: bigint } = {},
): NormalizedEvent[] {
  const blockNumber = nextBlk();
  const forecastHash = `0x${blockNumber.toString(16).padStart(64, '0')}` as `0x${string}`;
  const decisionId = expectedDecisionId(forecastHash, KIND_WITHDRAW)!;
  return [
    { name: 'VenueRedeemed', blockNumber, logIndex: 0, timestamp, args: { decisionId, sharesBurned: burned, assetsOut, assetsRequested } },
    { name: 'DecisionExecuted', blockNumber, logIndex: 1, timestamp, args: { decisionId, kind: KIND_WITHDRAW, amount: opts.credited ?? assetsOut, forecastHash } },
  ];
}

/** An escrow-style DEPLOY (no venue event) — v1, or v2 before setVenue. */
function escrowDeploy(amount: bigint, timestamp: bigint): NormalizedEvent {
  const blockNumber = nextBlk();
  const forecastHash = `0x${blockNumber.toString(16).padStart(64, '0')}` as `0x${string}`;
  return {
    name: 'DecisionExecuted',
    blockNumber,
    logIndex: 0,
    timestamp,
    args: { decisionId: expectedDecisionId(forecastHash, KIND_DEPLOY)!, kind: KIND_DEPLOY, amount, forecastHash },
  };
}

const nonconformanceNotes = (v: ReturnType<typeof replay>) =>
  v.notes.filter((n) => /nonconforming|contract-impossible|drift/.test(n));

// ─────────────────────────── CONFORMING (must stay green, exact) ───────────────────────────

test('venue · v1 history carries no venue events → venue verdict is null', () => {
  const ev = [mandate(5, 2, 5, T0), fund(10, 10, T0), escrowDeploy(U(1), T0 + 10n)];
  const v = replay(ev);
  assert.equal(v.venue, null);
  assert.equal(v.compliant, true);
});

test('venue · subscribe → NAV-gain full unwind: exact reconstruction, basis zeroed, 5/5 COMPLIANT', () => {
  // Measured USYC economics: 1 USDC → 0.883092 shares; full unwind pays basis + accrual.
  const ev = [
    mandate(5, 2, 5, T0),
    fund(10, 10, T0),
    venueChanged(VENUE, SHARE, T0 + 5n),
    ...venueDeploy(U(2), 1_766_184n, T0 + 10n), // 2 USDC → 1.766184 shares
    ...venueWithdraw(1_766_184n, U(2.13), U(2), T0 + 20n), // full unwind, NAV gain: 2.13 back
  ];
  const v = replay(ev);
  assert.equal(v.compliant, true, 'a legal venue cycle must not be flagged');
  assert.equal(nonconformanceNotes(v).length, 0, `no nonconformance notes expected, got: ${v.notes.join(' | ')}`);
  assert.ok(v.venue, 'venue verdict must be present');
  assert.equal(v.venue!.venueAddress, VENUE);
  assert.equal(v.venue!.sharesHeld, 0n, 'position closed');
  assert.equal(v.venue!.costBasisUsdc, 0n, 'full unwind retires the basis');
  assert.equal(v.venue!.subscriptions, 1);
  assert.equal(v.venue!.redemptions, 1);
  assert.equal(v.venue!.subscribedUsdc, U(2));
  assert.equal(v.venue!.redeemedUsdc, U(2.13));
  assert.equal(v.venue!.shortfallRedemptions, 0, 'a gain is not a shortfall');
});

test('venue · full unwind after a LOSS zeroes the basis where the clamp would strand a residual claim', () => {
  // Subscribe 2.00, redeem everything for 1.80 (realised loss). Contract: positionClosed → basis 0.
  // The amount-clamp approximation would leave basis 0.20 — a claim on money that does not exist.
  const ev = [
    mandate(5, 2, 5, T0),
    fund(10, 10, T0),
    venueChanged(VENUE, SHARE, T0 + 5n),
    ...venueDeploy(U(2), 1_766_184n, T0 + 10n),
    ...venueWithdraw(1_766_184n, U(1.8), U(2), T0 + 20n), // shortfall: asked 2, got 1.80
  ];
  const v = replay(ev);
  assert.equal(v.compliant, true, 'a realised loss is honest accounting, not a violation');
  assert.equal(v.venue!.costBasisUsdc, 0n, 'position closed ⇒ basis retired (NOT the 0.20 clamp residue)');
  assert.equal(v.venue!.sharesHeld, 0n);
  assert.equal(v.venue!.shortfallRedemptions, 1, 'the shortfall is counted, never hidden');
});

test('venue · partial redeem leaves the remainder invested with the clamped basis', () => {
  const ev = [
    mandate(0, 2, 5, T0),
    fund(10, 10, T0),
    venueChanged(VENUE, SHARE, T0 + 5n),
    ...venueDeploy(U(2), 1_766_184n, T0 + 10n),
    ...venueDeploy(U(2), 1_766_000n, T0 + DAY + 20n), // second window, basis now 4
    ...venueWithdraw(884_000n, U(1), U(1), T0 + DAY + 40n), // partial: 1 USDC out of basis 4
  ];
  const v = replay(ev);
  assert.equal(v.compliant, true);
  assert.equal(v.venue!.costBasisUsdc, U(3), 'partial redeem subtracts the settled amount');
  assert.equal(v.venue!.sharesHeld, 1_766_184n + 1_766_000n - 884_000n);
  assert.equal(v.venue!.subscriptions, 2);
});

test('venue · escrow mode after venue cleared to 0x0 raises no notes', () => {
  const ev = [
    mandate(0, 2, 5, T0),
    fund(10, 10, T0),
    venueChanged(VENUE, SHARE, T0 + 5n),
    venueChanged(ZERO, ZERO, T0 + 6n), // owner unsets before any position
    escrowDeploy(U(1), T0 + 10n),
  ];
  const v = replay(ev);
  assert.equal(v.compliant, true);
  assert.equal(nonconformanceNotes(v).length, 0, 'escrow deposit under an UNSET venue is v1 behaviour');
  assert.equal(v.venue!.venueAddress, null);
});

test('venue · emergency exit failure strands shares; rescueToken recovers them', () => {
  const blockEmergency = () => {
    const blockNumber = nextBlk();
    return [
      { name: 'VenueExitFailed', blockNumber, logIndex: 0, timestamp: T0 + 30n, args: { sharesStranded: 1_766_184n } },
      { name: 'EmergencyWithdrawal', blockNumber, logIndex: 1, timestamp: T0 + 30n, args: { to: ZERO, amount: U(8) } },
    ] as NormalizedEvent[];
  };
  const ev = [
    mandate(0, 2, 5, T0),
    fund(10, 10, T0),
    venueChanged(VENUE, SHARE, T0 + 5n),
    ...venueDeploy(U(2), 1_766_184n, T0 + 10n),
    ...blockEmergency(),
    { name: 'TokenRescued', blockNumber: nextBlk(), logIndex: 0, timestamp: T0 + 40n, args: { token: SHARE, to: ZERO, amount: 1_766_184n } } as NormalizedEvent,
  ];
  const v = replay(ev);
  assert.equal(v.venue!.strandedShares, 0n, 'rescue clears the stranded position');
  assert.equal(v.venue!.sharesHeld, 0n);
  assert.ok(v.notes.some((n) => /venue exit FAILED/.test(n)), 'the failed exit is on the record');
});

test('venue · a clean emergency exit unwinds the position (no VenueExitFailed in the block)', () => {
  const ev = [
    mandate(0, 2, 5, T0),
    fund(10, 10, T0),
    venueChanged(VENUE, SHARE, T0 + 5n),
    ...venueDeploy(U(2), 1_766_184n, T0 + 10n),
    { name: 'EmergencyWithdrawal', blockNumber: nextBlk(), logIndex: 0, timestamp: T0 + 30n, args: { to: ZERO, amount: U(10) } } as NormalizedEvent,
  ];
  const v = replay(ev);
  assert.equal(v.venue!.sharesHeld, 0n, 'try-redeem succeeded — position unwound with the sweep');
  assert.equal(v.venue!.strandedShares, 0n);
});

// ──────────────────── NONCONFORMING (contract-impossible — must be surfaced) ────────────────────

test('venue · VenueChanged over an open position is surfaced (contract: VenueBusy)', () => {
  const ev = [
    mandate(0, 2, 5, T0),
    fund(10, 10, T0),
    venueChanged(VENUE, SHARE, T0 + 5n),
    ...venueDeploy(U(2), 1_766_184n, T0 + 10n),
    venueChanged(ZERO, ZERO, T0 + 20n), // re-point with shares held — the contract forbids this
  ];
  const v = replay(ev);
  assert.ok(v.notes.some((n) => /VenueBusy/.test(n)), `expected a VenueBusy note, got: ${v.notes.join(' | ')}`);
});

test('venue · a DEPLOY under an active venue with no VenueSubscribed is surfaced', () => {
  const ev = [
    mandate(0, 2, 5, T0),
    fund(10, 10, T0),
    venueChanged(VENUE, SHARE, T0 + 5n),
    escrowDeploy(U(1), T0 + 10n), // venue is SET but no subscription happened
  ];
  const v = replay(ev);
  assert.ok(v.notes.some((n) => /no VenueSubscribed/.test(n)), `expected a missing-subscription note, got: ${v.notes.join(' | ')}`);
});

test('venue · VenueSubscribed.assetsIn diverging from the DEPLOY receipt is surfaced', () => {
  const ev = [
    mandate(0, 2, 5, T0),
    fund(10, 10, T0),
    venueChanged(VENUE, SHARE, T0 + 5n),
    ...venueDeploy(U(2), 1_766_184n, T0 + 10n, { assetsIn: U(1.5) }), // subscribed ≠ deposited
  ];
  const v = replay(ev);
  assert.ok(v.notes.some((n) => /assetsIn/.test(n)), `expected an assetsIn mismatch note, got: ${v.notes.join(' | ')}`);
});

test('venue · VenueRedeemed.assetsOut diverging from the WITHDRAW receipt is surfaced', () => {
  const ev = [
    mandate(0, 2, 5, T0),
    fund(10, 10, T0),
    venueChanged(VENUE, SHARE, T0 + 5n),
    ...venueDeploy(U(2), 1_766_184n, T0 + 10n),
    ...venueWithdraw(1_766_184n, U(2.13), U(2), T0 + 20n, { credited: U(2) }), // receipt lies: 2 ≠ 2.13
  ];
  const v = replay(ev);
  assert.ok(v.notes.some((n) => /assetsOut/.test(n)), `expected an assetsOut mismatch note, got: ${v.notes.join(' | ')}`);
});

test('venue · a zero-share mint is surfaced (contract: VenueMintedNothing)', () => {
  const ev = [
    mandate(0, 2, 5, T0),
    fund(10, 10, T0),
    venueChanged(VENUE, SHARE, T0 + 5n),
    ...venueDeploy(U(2), 0n, T0 + 10n),
  ];
  const v = replay(ev);
  assert.ok(v.notes.some((n) => /VenueMintedNothing/.test(n)), `expected a zero-mint note, got: ${v.notes.join(' | ')}`);
});
