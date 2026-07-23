import { keccak256, toBytes } from 'viem';
import {
  KIND_DEPLOY,
  KIND_WITHDRAW,
  type InvariantKey,
  type InvariantVerdict,
  type MoveVerdict,
  type NormalizedEvent,
  type Status,
  type Verdict,
  type Violation,
} from '../types.js';

/**
 * The PURE replay/check core — the entire trust surface of the verifier, no I/O.
 *
 * It reconstructs mandate state event-by-event and re-derives, at each agent move, the EXACT
 * predicate the contract enforced (AgentMandate.sol), then reports a per-invariant verdict over
 * the whole history. Everything a judge relies on lives here; `fetch.ts` only feeds it and `cli.ts`
 * only formats it. Deterministic: identical `NormalizedEvent[]` ⇒ identical `Verdict`.
 *
 * The five invariants (history-level properties, not row properties):
 *   1. floor      — after every DEPLOY, companyBalance ≥ floor (contract: reverts if
 *                   companyBalance < amount + floor). Reconstructed, never trusted from an event.
 *   2. ticket     — every DEPLOY amount ≤ maxTicket *current at that move*.
 *   3. window     — EXACT lazy tumbling 24h budget (AgentMandate.sol:152-160): at a deposit, reset
 *                   iff `ts ≥ windowStart + 86400` (windowStart = that deposit's ts, NOT a fixed
 *                   stride); then windowDeployed + amount ≤ dailyCap. A naive rolling-24h sum is
 *                   NOT this invariant and produces false VIOLATIONs on legal history — the
 *                   dominant failure mode, since live history is compliant by construction.
 *   4. asymmetry  — no DEPLOY while revoked; WITHDRAW always allowed (even revoked). Risk-reducing
 *                   moves are ungated by design; risk-adding moves are blocked.
 *   5. receipt    — decisionId == keccak(utf8(`${forecastHash}|${DEPLOY|WITHDRAW}`)). PURE-CHAIN:
 *                   the on-chain `forecastHash` arg IS the `forecastInputsHash` that seeds the id
 *                   (circle-chain-executor.ts:135), so receipt integrity needs NO preimage API.
 *                   Verified against all four live events 2026-07-23.
 *
 * Ordering: caller MUST pass events sorted by (blockNumber, logIndex). Timestamps order nothing —
 * Arc's sub-second blocks share timestamps (arc-docs).
 */

const WINDOW_SECONDS = 86_400n;
const KIND_NAME: Record<number, 'DEPLOY' | 'WITHDRAW'> = { [KIND_DEPLOY]: 'DEPLOY', [KIND_WITHDRAW]: 'WITHDRAW' };

/** The contract's replay guard: decisionId derived off-chain, re-derivable purely from the event. */
export function expectedDecisionId(forecastHash: `0x${string}`, kind: number): `0x${string}` | null {
  const name = KIND_NAME[kind];
  if (!name) return null;
  return keccak256(toBytes(`${forecastHash}|${name}`));
}

export interface ReplayOptions {
  mandateAddress?: `0x${string}`;
  chainId?: number;
  deployBlock?: bigint;
  scannedThroughBlock?: bigint | null;
  source?: 'chain' | 'fixture';
}

interface MandateState {
  floor: bigint;
  maxTicket: bigint;
  dailyCap: bigint;
  companyBalance: bigint;
  deployedBalance: bigint;
  windowStart: bigint;
  windowDeployed: bigint;
  revoked: boolean;
  seededMandate: boolean;
}

export function replay(events: NormalizedEvent[], opts: ReplayOptions = {}): Verdict {
  const notes: string[] = [];
  const st: MandateState = {
    floor: 0n,
    maxTicket: 0n,
    dailyCap: 0n,
    companyBalance: 0n,
    deployedBalance: 0n,
    windowStart: 0n,
    windowDeployed: 0n,
    revoked: false,
    seededMandate: false,
  };

  const vio: Record<InvariantKey, Violation[]> = { floor: [], ticket: [], window: [], asymmetry: [], receipt: [] };
  const moves: MoveVerdict[] = [];
  let deposits = 0;
  let withdrawals = 0;
  let closest: bigint | null = null;
  let closestAt: { blockNumber: bigint; decisionId: `0x${string}` } | null = null;
  const seenDecisionIds = new Set<string>();

  // Fail fast on ordering bugs in the caller — a mis-sorted stream silently corrupts every verdict.
  for (let i = 1; i < events.length; i++) {
    const a = events[i - 1]!;
    const b = events[i]!;
    if (b.blockNumber < a.blockNumber || (b.blockNumber === a.blockNumber && b.logIndex < a.logIndex)) {
      throw new Error(
        `replay: events must be sorted by (blockNumber, logIndex); index ${i} (${b.blockNumber}:${b.logIndex}) precedes ${a.blockNumber}:${a.logIndex}`,
      );
    }
  }

  for (const ev of events) {
    switch (ev.name) {
      case 'MandateChanged': {
        // The constructor emits the first one at the deploy block; setMandate emits later ones.
        // setMandate does NOT reset the window (contract) — we only re-version the params.
        st.floor = ev.args.floor;
        st.maxTicket = ev.args.maxTicket;
        st.dailyCap = ev.args.dailyCap;
        st.seededMandate = true;
        break;
      }
      case 'CompanyFunded': {
        st.companyBalance += ev.args.amount;
        // CompanyFunded carries the contract's own post-state — a free reconstruction checksum.
        if (ev.args.newCompanyBalance !== st.companyBalance) {
          notes.push(
            `reconstruction drift at ${ev.blockNumber}:${ev.logIndex}: CompanyFunded.newCompanyBalance=${ev.args.newCompanyBalance} but replay=${st.companyBalance} — event stream may be incomplete.`,
          );
          // Trust the contract's authoritative post-state; keep going.
          st.companyBalance = ev.args.newCompanyBalance;
        }
        break;
      }
      case 'EmergencyWithdrawal': {
        // Owner exit sweeps both pools; window state is deliberately untouched (contract).
        st.companyBalance = 0n;
        st.deployedBalance = 0n;
        break;
      }
      case 'Revoked': {
        st.revoked = true;
        break;
      }
      case 'Reinstated': {
        st.revoked = false;
        break;
      }
      case 'DecisionExecuted': {
        const { decisionId, kind, amount, forecastHash } = ev.args;
        const per: Record<InvariantKey, Status> = {
          floor: 'PASS',
          ticket: 'PASS',
          window: 'PASS',
          asymmetry: 'PASS',
          receipt: 'PASS',
        };

        // ── Invariant 5: receipt (both kinds carry a forecastHash) ──────────────
        const expId = expectedDecisionId(forecastHash, kind);
        const receiptOk = expId !== null && expId.toLowerCase() === decisionId.toLowerCase();
        if (!receiptOk) {
          per.receipt = 'VIOLATION';
          vio.receipt.push({
            invariant: 'receipt',
            decisionId,
            txHash: ev.txHash,
            blockNumber: ev.blockNumber,
            message:
              expId === null
                ? `unknown kind ${kind} — cannot derive decisionId`
                : `decisionId ${decisionId} ≠ keccak("${forecastHash}|${KIND_NAME[kind]}")=${expId}`,
          });
        }
        // Replay-guard cross-check: the contract rejects a reused decisionId, so a duplicate in
        // history would itself be a contract-level impossibility worth surfacing.
        if (seenDecisionIds.has(decisionId.toLowerCase())) {
          per.receipt = 'VIOLATION';
          vio.receipt.push({
            invariant: 'receipt',
            decisionId,
            txHash: ev.txHash,
            blockNumber: ev.blockNumber,
            message: `duplicate decisionId ${decisionId} — the contract's replay guard should have reverted this`,
          });
        }
        seenDecisionIds.add(decisionId.toLowerCase());

        if (kind === KIND_DEPLOY) {
          deposits += 1;

          // ── Invariant 4: asymmetry (deposit blocked when revoked) ─────────────
          if (st.revoked) {
            per.asymmetry = 'VIOLATION';
            vio.asymmetry.push({
              invariant: 'asymmetry',
              decisionId,
              txHash: ev.txHash,
              blockNumber: ev.blockNumber,
              message: `DEPLOY ${fmt(amount)} while mandate REVOKED — deposits must be blocked (contract: whenNotRevoked)`,
            });
          }

          // ── Invariant 1: floor (contract: revert if companyBalance < amount + floor) ──
          if (st.companyBalance < amount + st.floor) {
            per.floor = 'VIOLATION';
            vio.floor.push({
              invariant: 'floor',
              decisionId,
              txHash: ev.txHash,
              blockNumber: ev.blockNumber,
              message: `DEPLOY ${fmt(amount)} would leave company ${fmt(st.companyBalance - amount)} below floor ${fmt(st.floor)}`,
            });
          }

          // ── Invariant 2: ticket ───────────────────────────────────────────────
          if (amount > st.maxTicket) {
            per.ticket = 'VIOLATION';
            vio.ticket.push({
              invariant: 'ticket',
              decisionId,
              txHash: ev.txHash,
              blockNumber: ev.blockNumber,
              message: `DEPLOY ${fmt(amount)} exceeds per-ticket cap ${fmt(st.maxTicket)}`,
            });
          }

          // ── Invariant 3: EXACT lazy tumbling window (AgentMandate.sol:152-160) ─
          if (ev.timestamp >= st.windowStart + WINDOW_SECONDS) {
            st.windowStart = ev.timestamp;
            st.windowDeployed = 0n;
          }
          if (st.windowDeployed + amount > st.dailyCap) {
            per.window = 'VIOLATION';
            vio.window.push({
              invariant: 'window',
              decisionId,
              txHash: ev.txHash,
              blockNumber: ev.blockNumber,
              message: `DEPLOY ${fmt(amount)} + window ${fmt(st.windowDeployed)} exceeds 24h cap ${fmt(st.dailyCap)}`,
            });
          }

          // Apply the move to reconstructed state (mirror the contract's mutation order).
          st.windowDeployed += amount;
          st.companyBalance -= amount;
          st.deployedBalance += amount;

          const headroom = st.companyBalance - st.floor;
          if (closest === null || headroom < closest) {
            closest = headroom;
            closestAt = { blockNumber: ev.blockNumber, decisionId };
          }
          moves.push({
            decisionId,
            txHash: ev.txHash,
            kind: 'DEPLOY',
            blockNumber: ev.blockNumber,
            amountUsdc: amount,
            floorHeadroomUsdc: headroom,
            windowUtilization: st.dailyCap === 0n ? null : Number(st.windowDeployed) / Number(st.dailyCap),
            receipt: receiptOk ? 'match' : 'mismatch',
            perInvariant: per,
          });
        } else if (kind === KIND_WITHDRAW) {
          withdrawals += 1;
          // Withdraw is ungated by design (fail-safe) — it can never violate floor/ticket/window/
          // asymmetry. The only check that applies is the receipt (done above). Reconstruct pools.
          st.deployedBalance = st.deployedBalance >= amount ? st.deployedBalance - amount : 0n;
          st.companyBalance += amount;
          moves.push({
            decisionId,
            txHash: ev.txHash,
            kind: 'WITHDRAW',
            blockNumber: ev.blockNumber,
            amountUsdc: amount,
            floorHeadroomUsdc: null,
            windowUtilization: null,
            receipt: receiptOk ? 'match' : 'mismatch',
            perInvariant: per,
          });
        }
        break;
      }
    }
  }

  if (!st.seededMandate) {
    notes.push('no MandateChanged seen — history does not start at the mandate deploy block; verdict may be incomplete.');
  }

  // Count MOVES that failed each check (not raw violations — receipt can log >1 per move, e.g. a
  // duplicate decisionId, which would drive a naive "clean = total − violations" negative).
  const receiptCleanMoves = moves.filter((m) => m.receipt === 'match').length;
  const totalMoves = deposits + withdrawals;

  const invariants = ([
    ['floor', deposits, `${deposits - vio.floor.length}/${deposits} deposits kept the company balance above floor`],
    ['ticket', deposits, `${deposits - vio.ticket.length}/${deposits} deposits within the per-ticket cap`],
    ['window', deposits, `${deposits - vio.window.length}/${deposits} deposits within the 24h budget window`],
    ['asymmetry', totalMoves, `${vio.asymmetry.length === 0 ? 'no' : vio.asymmetry.length} deposit(s) while revoked; ${withdrawals} withdraw(s) always allowed`],
    ['receipt', totalMoves, `${receiptCleanMoves}/${totalMoves} moves' receipts re-derive on-chain`],
  ] as const).map(([key, checks, detail]): InvariantVerdict => {
    const violations = vio[key];
    let extra: string = detail;
    if (key === 'floor' && closest !== null && violations.length === 0) {
      extra = `${detail}; closest approach ${fmt(closest)} above floor`;
    }
    return {
      key,
      status: checks === 0 ? 'PASS' : violations.length > 0 ? 'VIOLATION' : 'PASS',
      checks,
      detail: extra,
      violations,
    };
  });

  const compliant = invariants.every((iv) => iv.status !== 'VIOLATION');

  return {
    schemaVersion: 1,
    mandateAddress: opts.mandateAddress ?? '0x0000000000000000000000000000000000000000',
    chainId: opts.chainId ?? 0,
    deployBlock: opts.deployBlock ?? (events[0]?.blockNumber ?? 0n),
    scannedThroughBlock: opts.scannedThroughBlock ?? null,
    compliant,
    totalMoves: deposits + withdrawals,
    invariants,
    moves,
    closestApproachToFloorUsdc: closest,
    closestApproachAt: closestAt,
    source: opts.source ?? 'fixture',
    notes,
  };
}

/** 6-dec base units → human "$X.XX" for verdict messages. Display edge only. */
function fmt(baseUnits: bigint): string {
  const neg = baseUnits < 0n;
  const abs = neg ? -baseUnits : baseUnits;
  const whole = abs / 1_000_000n;
  const frac = (abs % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  return `${neg ? '-' : ''}$${whole}${frac ? '.' + frac : ''}`;
}
