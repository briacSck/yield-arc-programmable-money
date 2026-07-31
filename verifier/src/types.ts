/**
 * Shared types for the mandate verifier — the seam between the two layers.
 *
 * Layer 1 (fetch, `fetch.ts`) turns Arc chain logs into a `NormalizedEvent[]`.
 * Layer 2 (core, `core/replay.ts`) is PURE: `NormalizedEvent[] → Verdict`, no I/O.
 * Fixtures are hand-written `NormalizedEvent[]` fed straight to layer 2 — that split is what
 * lets us test histories the frozen contract can no longer emit (a floor breach, a post-revoke
 * deposit) without an anvil that couldn't reproduce Arc semantics anyway (§17.7).
 */

/**
 * The mandate events, normalized. The first six are v1's fixed ABI; the rest are AgentMandateV2's
 * venue additions — additive: a v1 history simply never contains them, and every invariant verdict
 * is computed identically with or without them. `args` is per-event; see the union below.
 */
export type EventName =
  | 'MandateChanged'
  | 'CompanyFunded'
  | 'DecisionExecuted'
  | 'Revoked'
  | 'Reinstated'
  | 'EmergencyWithdrawal'
  | 'VenueChanged'
  | 'VenueSubscribed'
  | 'VenueRedeemed'
  | 'VenueExitFailed'
  | 'TokenRescued';

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
    | { name: 'VenueChanged'; args: { venue: `0x${string}`; share: `0x${string}` } }
    | { name: 'VenueSubscribed'; args: { decisionId: `0x${string}`; assetsIn: bigint; sharesMinted: bigint } }
    | {
        name: 'VenueRedeemed';
        args: { decisionId: `0x${string}`; sharesBurned: bigint; assetsOut: bigint; assetsRequested: bigint };
      }
    | { name: 'VenueExitFailed'; args: { sharesStranded: bigint } }
    | { name: 'TokenRescued'; args: { token: `0x${string}`; to: `0x${string}`; amount: bigint } }
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

/**
 * Venue-leg reconstruction (AgentMandateV2) — deployed-leg = COST BASIS + SHARES, replayed with
 * the contract's exact rules (including basis-zeroing on a full unwind, which the amount-clamp
 * approximation cannot see). `null` on a history with no venue events (v1, or v2 pre-setVenue).
 *
 * This section REPORTS the venue economics and cross-checks them against the receipts; it never
 * flips `compliant` — the five invariants stay the standard. Contract-impossible inconsistencies
 * (a VenueSubscribed that doesn't match its DEPLOY receipt, a venue re-point over an open
 * position) surface loudly in `notes`, same precedent as the CompanyFunded reconstruction checksum.
 */
export interface VenueVerdict {
  /** Venue in force at the end of the replay (last VenueChanged), or null if unset/cleared. */
  venueAddress: `0x${string}` | null;
  /** Reconstructed share position at the end of the replay. */
  sharesHeld: bigint;
  /** Reconstructed USDC cost basis of the venue position (the contract's `deployedBalance`). */
  costBasisUsdc: bigint;
  subscriptions: number;
  redemptions: number;
  /** Σ VenueSubscribed.assetsIn — USDC that actually entered the venue. */
  subscribedUsdc: bigint;
  /** Σ VenueRedeemed.assetsOut — USDC that actually came back. */
  redeemedUsdc: bigint;
  /** Redemptions that settled BELOW what was requested (NAV loss / partial redeem) — reported, never hidden. */
  shortfallRedemptions: number;
  /** Shares stranded by a failed emergency venue exit (VenueExitFailed), net of rescues. */
  strandedShares: bigint;
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
  /**
   * Whether the constructor's `MandateChanged` was seen — i.e. the scan actually started at a real
   * mandate. FALSE means a wrong `--address` or a `--deploy-block` set past the constructor: the
   * history reconstructs against a zero-mandate and any verdict is meaningless. A verifier must
   * never emit a wrong verdict, so the CLI treats `!mandateSeeded` on a live scan as OPERATIONAL
   * (exit 2), never as COMPLIANT.
   */
  mandateSeeded: boolean;
  totalMoves: number;
  invariants: InvariantVerdict[];
  moves: MoveVerdict[];
  /** Free reconstruction stat that makes all-green read as live, not hardcoded. */
  closestApproachToFloorUsdc: bigint | null;
  closestApproachAt: { blockNumber: bigint; decisionId: `0x${string}` } | null;
  /** Venue-leg reconstruction (AgentMandateV2); null when the history carries no venue events. */
  venue: VenueVerdict | null;
  source: 'chain' | 'fixture';
  notes: string[];
}
