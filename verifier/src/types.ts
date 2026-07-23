/**
 * Shared types for the mandate verifier — the seam between the two layers.
 *
 * Layer 1 (fetch, `fetch.ts`) turns Arc chain logs into a `NormalizedEvent[]`.
 * Layer 2 (core, `core/replay.ts`) is PURE: `NormalizedEvent[] → Verdict`, no I/O.
 * Fixtures are hand-written `NormalizedEvent[]` fed straight to layer 2 — that split is what
 * lets us test histories the frozen contract can no longer emit (a floor breach, a post-revoke
 * deposit) without an anvil that couldn't reproduce Arc semantics anyway (§17.7).
 */

/** The six mandate events, normalized. `args` is per-event; see the discriminated union below. */
export type EventName =
  | 'MandateChanged'
  | 'CompanyFunded'
  | 'DecisionExecuted'
  | 'Revoked'
  | 'Reinstated'
  | 'EmergencyWithdrawal';

/** Ordering key. Arc has sub-second blocks that can share a timestamp — order by (block, logIndex),
 *  NEVER by timestamp (arc-docs: "use block number as your ordering key"). */
export interface EventPosition {
  blockNumber: bigint;
  logIndex: number;
  /** Unix seconds of the containing block. Used ONLY for the 24h window math, never for ordering. */
  timestamp: bigint;
  /** Present on real chain events; absent in synthetic fixtures. */
  txHash?: `0x${string}`;
}

export type NormalizedEvent = EventPosition &
  (
    | { name: 'MandateChanged'; args: { floor: bigint; maxTicket: bigint; dailyCap: bigint } }
    | { name: 'CompanyFunded'; args: { amount: bigint; newCompanyBalance: bigint } }
    | {
        name: 'DecisionExecuted';
        args: { decisionId: `0x${string}`; kind: number; amount: bigint; forecastHash: `0x${string}` };
      }
    | { name: 'Revoked'; args: { by: `0x${string}` } }
    | { name: 'Reinstated'; args: { by: `0x${string}` } }
    | { name: 'EmergencyWithdrawal'; args: { to: `0x${string}`; amount: bigint } }
  );

/** DecisionExecuted.kind mirrors the app-layer DecisionKind (AgentMandate.sol). */
export const KIND_DEPLOY = 0;
export const KIND_WITHDRAW = 1;

export type InvariantKey = 'floor' | 'ticket' | 'window' | 'asymmetry' | 'receipt';

export type Status = 'PASS' | 'VIOLATION' | 'PENDING' | 'UNVERIFIED';

/** One invariant's headline verdict across the whole history. */
export interface InvariantVerdict {
  key: InvariantKey;
  status: Status;
  /** deposits/moves checked for this invariant. */
  checks: number;
  /** Human, magnitude-first: "214/214 deposits, closest approach $412 above floor". */
  detail: string;
  /** Per-move violations (empty when PASS). */
  violations: Violation[];
}

export interface Violation {
  invariant: InvariantKey;
  decisionId?: `0x${string}`;
  txHash?: `0x${string}`;
  blockNumber: bigint;
  message: string;
}

/** Per-move facts the dashboard folds into each LogRow (joined on txHash — the dashboard has no keccak dep). */
export interface MoveVerdict {
  decisionId: `0x${string}`;
  txHash?: `0x${string}`;
  kind: 'DEPLOY' | 'WITHDRAW';
  blockNumber: bigint;
  amountUsdc: bigint;
  /** Company balance minus floor immediately AFTER this move (deposits only; null for withdraws). */
  floorHeadroomUsdc: bigint | null;
  /** windowDeployed / dailyCap at this move, 0–1 (deposits only). */
  windowUtilization: number | null;
  receipt: 'match' | 'mismatch';
  perInvariant: Record<InvariantKey, Status>;
}

/** The whole-history verdict — what the CLI prints and `--json` emits. */
export interface Verdict {
  schemaVersion: 1;
  mandateAddress: `0x${string}`;
  chainId: number;
  deployBlock: bigint;
  /** toBlock actually scanned (real run) or null (fixture run). */
  scannedThroughBlock: bigint | null;
  compliant: boolean;
  totalMoves: number;
  invariants: InvariantVerdict[];
  moves: MoveVerdict[];
  /** Free reconstruction stat that makes all-green read as live, not hardcoded. */
  closestApproachToFloorUsdc: bigint | null;
  closestApproachAt: { blockNumber: bigint; decisionId: `0x${string}` } | null;
  source: 'chain' | 'fixture';
  notes: string[];
}
