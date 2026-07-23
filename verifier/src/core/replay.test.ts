import { test } from 'node:test';
import assert from 'node:assert/strict';
import { replay, expectedDecisionId } from './replay.js';
import { KIND_DEPLOY, KIND_WITHDRAW, type InvariantKey, type NormalizedEvent } from '../types.js';

/**
 * Fixtures are hand-written NormalizedEvent[] fed to the PURE core — they model histories the
 * frozen contract can no longer emit (that's the point: a floor breach, a post-revoke deposit).
 * Two directions, both required:
 *   - VIOLATING: one per invariant, the verifier must CATCH (also the negative demo).
 *   - COMPLIANT-ADVERSARIAL: legal histories a NAIVE verifier would falsely flag — the dominant
 *     failure mode, since real history is compliant by construction.
 */

const U = (n: number) => BigInt(Math.round(n * 1_000_000));
let BLK = 100n;
const nextBlk = () => ++BLK;

/** Build a DecisionExecuted with a CORRECT receipt (decisionId derived from forecastHash+kind). */
function move(
  kind: number,
  amount: bigint,
  timestamp: bigint,
  opts: { forecastHash?: `0x${string}`; decisionId?: `0x${string}`; blockNumber?: bigint; logIndex?: number } = {},
): NormalizedEvent {
  const forecastHash = opts.forecastHash ?? (`0x${(BLK).toString(16).padStart(64, '0')}` as `0x${string}`);
  const decisionId = opts.decisionId ?? expectedDecisionId(forecastHash, kind)!;
  return {
    name: 'DecisionExecuted',
    blockNumber: opts.blockNumber ?? nextBlk(),
    logIndex: opts.logIndex ?? 0,
    timestamp,
    args: { decisionId, kind, amount, forecastHash },
  };
}
function mandate(floor: number, ticket: number, cap: number, timestamp: bigint): NormalizedEvent {
  return { name: 'MandateChanged', blockNumber: nextBlk(), logIndex: 0, timestamp, args: { floor: U(floor), maxTicket: U(ticket), dailyCap: U(cap) } };
}
function fund(amount: number, running: number, timestamp: bigint): NormalizedEvent {
  return { name: 'CompanyFunded', blockNumber: nextBlk(), logIndex: 0, timestamp, args: { amount: U(amount), newCompanyBalance: U(running) } };
}
function revoke(timestamp: bigint): NormalizedEvent {
  return { name: 'Revoked', blockNumber: nextBlk(), logIndex: 0, timestamp, args: { by: '0xowner000000000000000000000000000000owner' as `0x${string}` } };
}
function reinstate(timestamp: bigint): NormalizedEvent {
  return { name: 'Reinstated', blockNumber: nextBlk(), logIndex: 0, timestamp, args: { by: '0xowner000000000000000000000000000000owner' as `0x${string}` } };
}
function emergencyWithdraw(timestamp: bigint): NormalizedEvent {
  return { name: 'EmergencyWithdrawal', blockNumber: nextBlk(), logIndex: 0, timestamp, args: { to: '0xowner000000000000000000000000000000owner' as `0x${string}`, amount: 0n } };
}

const DAY = 86_400n;
const T0 = 1_000_000n;

function statusOf(v: ReturnType<typeof replay>, key: InvariantKey) {
  return v.invariants.find((iv) => iv.key === key)!.status;
}

// ─────────────────────── VIOLATING FIXTURES (must CATCH) ───────────────────────

test('VIOLATION · floor: a deposit that draws below the floor is caught', () => {
  const ev = [mandate(5, 2, 5, T0), fund(6, 6, T0), move(KIND_DEPLOY, U(2), T0 + 10n)];
  // company 6, floor 5, deposit 2 → would leave 4 < 5. Contract would revert; fixture forces it.
  const v = replay(ev);
  assert.equal(statusOf(v, 'floor'), 'VIOLATION');
  assert.equal(v.compliant, false);
  assert.match(v.invariants.find((i) => i.key === 'floor')!.violations[0]!.message, /below floor/);
});

test('VIOLATION · ticket: a deposit above the per-ticket cap is caught', () => {
  const ev = [mandate(5, 2, 10, T0), fund(20, 20, T0), move(KIND_DEPLOY, U(3), T0 + 10n)];
  const v = replay(ev);
  assert.equal(statusOf(v, 'ticket'), 'VIOLATION');
});

test('VIOLATION · window: a third deposit inside 24h that breaks the daily cap is caught', () => {
  const ev = [
    mandate(0, 2, 4, T0),
    fund(100, 100, T0),
    move(KIND_DEPLOY, U(2), T0 + 10n),
    move(KIND_DEPLOY, U(2), T0 + 20n),
    move(KIND_DEPLOY, U(2), T0 + 30n), // window now 6 > cap 4
  ];
  const v = replay(ev);
  assert.equal(statusOf(v, 'window'), 'VIOLATION');
});

test('VIOLATION · asymmetry: a deposit while revoked is caught', () => {
  const ev = [mandate(0, 5, 10, T0), fund(100, 100, T0), revoke(T0 + 5n), move(KIND_DEPLOY, U(2), T0 + 10n)];
  const v = replay(ev);
  assert.equal(statusOf(v, 'asymmetry'), 'VIOLATION');
});

test('VIOLATION · receipt: a decisionId that does not derive from (forecastHash,kind) is caught', () => {
  const ev = [
    mandate(0, 5, 10, T0),
    fund(100, 100, T0),
    move(KIND_DEPLOY, U(2), T0 + 10n, { decisionId: `0x${'de'.repeat(32)}` as `0x${string}` }),
  ];
  const v = replay(ev);
  assert.equal(statusOf(v, 'receipt'), 'VIOLATION');
  assert.equal(v.moves[0]!.receipt, 'mismatch');
});

// ─────────────── COMPLIANT-ADVERSARIAL FIXTURES (must NOT flag) ───────────────

test('OK · balance exactly at floor after deposit is legal (contract allows equality)', () => {
  // company 7, floor 5, deposit 2 → leaves exactly 5 == floor. Contract: reverts only if < amount+floor.
  const ev = [mandate(5, 2, 5, T0), fund(7, 7, T0), move(KIND_DEPLOY, U(2), T0 + 10n)];
  const v = replay(ev);
  assert.equal(v.compliant, true, JSON.stringify(v.invariants.filter((i) => i.status === 'VIOLATION')));
  assert.equal(statusOf(v, 'floor'), 'PASS');
});

test('OK · cap exactly filled is legal (windowDeployed + amount == dailyCap)', () => {
  const ev = [mandate(0, 5, 4, T0), fund(100, 100, T0), move(KIND_DEPLOY, U(2), T0 + 10n), move(KIND_DEPLOY, U(2), T0 + 20n)];
  const v = replay(ev);
  assert.equal(statusOf(v, 'window'), 'PASS');
});

test('OK · the legal 2× burst straddling a window boundary is NOT flagged (naive rolling sum would)', () => {
  // Tumbling window: deposits at T0+10 (opens window) and at T0+DAY+20 (>= windowStart+86400 → RESET).
  // A naive "sum of deposits within any 24h" would see 4+4=8 > cap 5 and FALSELY flag. The exact
  // lazy reset makes each a fresh window of 4 ≤ 5. This is THE dominant false-positive test.
  const ev = [
    mandate(0, 4, 5, T0),
    fund(100, 100, T0),
    move(KIND_DEPLOY, U(4), T0 + 10n),
    move(KIND_DEPLOY, U(4), T0 + DAY + 20n),
  ];
  const v = replay(ev);
  assert.equal(statusOf(v, 'window'), 'PASS', 'naive rolling-sum false positive');
  assert.equal(v.compliant, true);
});

test('OK · window does NOT reset exactly one second before the boundary', () => {
  // Second deposit at windowStart + 86399 (< +86400) → same window; 3+3=6 > cap 5 → real VIOLATION.
  const ev = [
    mandate(0, 3, 5, T0),
    fund(100, 100, T0),
    move(KIND_DEPLOY, U(3), T0 + 10n),
    move(KIND_DEPLOY, U(3), T0 + 10n + DAY - 1n),
  ];
  const v = replay(ev);
  assert.equal(statusOf(v, 'window'), 'VIOLATION', 'boundary is >=, one second early must NOT reset');
});

test('OK · setMandate mid-history re-versions caps without resetting the window', () => {
  // Deposit 2 (window=2), then cap RAISED to 10 (setMandate does NOT reset window), then deposit 3
  // in the same window → window 5 ≤ 10 legal. If we wrongly reset on MandateChanged this still
  // passes, so also assert a LOWERING catches: cap→3, deposit 2 → window 4 > 3 VIOLATION.
  const raised = [mandate(0, 5, 5, T0), fund(100, 100, T0), move(KIND_DEPLOY, U(2), T0 + 10n), mandate(0, 5, 10, T0 + 20n), move(KIND_DEPLOY, U(3), T0 + 30n)];
  assert.equal(statusOf(replay(raised), 'window'), 'PASS');
  const lowered = [mandate(0, 5, 5, T0), fund(100, 100, T0), move(KIND_DEPLOY, U(2), T0 + 10n), mandate(0, 5, 3, T0 + 20n), move(KIND_DEPLOY, U(2), T0 + 30n)];
  assert.equal(statusOf(replay(lowered), 'window'), 'VIOLATION');
});

test('OK · revoke → withdraw → reinstate → deposit is fully legal', () => {
  const ev = [
    mandate(0, 5, 10, T0),
    fund(100, 100, T0),
    move(KIND_DEPLOY, U(3), T0 + 10n),
    revoke(T0 + 20n),
    move(KIND_WITHDRAW, U(3), T0 + 30n), // withdraw allowed even revoked
    reinstate(T0 + 40n),
    move(KIND_DEPLOY, U(2), T0 + 50n), // deposit after reinstate
  ];
  const v = replay(ev);
  assert.equal(v.compliant, true, JSON.stringify(v.invariants.filter((i) => i.status === 'VIOLATION')));
});

test('OK · emergencyWithdrawAll mid-history → re-fund → deploy carries window state', () => {
  const ev = [
    mandate(0, 5, 5, T0),
    fund(100, 100, T0),
    move(KIND_DEPLOY, U(3), T0 + 10n), // window = 3
    emergencyWithdraw(T0 + 20n), // pools zeroed, window untouched
    fund(100, 100, T0 + 30n),
    move(KIND_DEPLOY, U(2), T0 + 40n), // same window (< 24h): 3+2=5 ≤ 5 legal
  ];
  const v = replay(ev);
  assert.equal(statusOf(v, 'window'), 'PASS');
  assert.equal(v.compliant, true);
});

test('OK · multiple deposits in one block (distinct logIndex) are ordered and legal', () => {
  const m = mandate(0, 3, 6, T0);
  const f = fund(100, 100, T0);
  const b = nextBlk(); // strictly after the mandate/fund blocks
  const ev = [
    m,
    f,
    move(KIND_DEPLOY, U(3), T0 + 10n, { blockNumber: b, logIndex: 1 }),
    move(KIND_DEPLOY, U(3), T0 + 10n, { blockNumber: b, logIndex: 2 }),
  ];
  const v = replay(ev);
  assert.equal(statusOf(v, 'window'), 'PASS'); // 3+3=6 == cap
});

test('replay throws on mis-sorted input (guards against a fetch-layer ordering bug)', () => {
  const ev: NormalizedEvent[] = [
    { name: 'Revoked', blockNumber: 200n, logIndex: 0, timestamp: T0, args: { by: '0x0' as `0x${string}` } },
    { name: 'Reinstated', blockNumber: 100n, logIndex: 0, timestamp: T0, args: { by: '0x0' as `0x${string}` } },
  ];
  assert.throws(() => replay(ev), /must be sorted/);
});

test('empty history is vacuously compliant', () => {
  const v = replay([]);
  assert.equal(v.compliant, true);
  assert.equal(v.totalMoves, 0);
});
