import type { EventLogRecord, ForecastResult } from '@yield/shared';

/**
 * The dashboard reads exactly ONE API route (plan §16.2): `/api/events`, which proxies the
 * worker's internal surface. v2 (team-agreed 2026-07-15): server-computed stats + the LATEST
 * forecast snapshot (out-of-line — a 90-point series per record would explode the payload) +
 * a bounded tail of records + a soft-failing mandate snapshot.
 */

export interface ForecastSnapshotDto {
  decisionId: string;
  loggedAt: string;
  forecast: ForecastResult;
  inputs?: unknown;
}

export interface MandateSnapshotDto {
  companyBalanceUsdc: string;
  deployedUsdc: string;
  floorUsdc: string;
  maxTicketUsdc: string;
  dailyCapUsdc: string;
  windowDeployedUsdc: string;
  revoked: boolean;
  agentGasWei: string;
}

/**
 * The nightly machine-audit block (plan §18.2). Produced by the verifier (`@yield-cfo/mandate-verify
 * --json`) in CI, published to the `audit-log` git ref, and spliced into `/api/events` by the proxy
 * (server-side, short revalidate). The dashboard NEVER computes it (that would couple the camera
 * surface to RPC health); it only renders what the verifier already decided. Absent when the audit
 * feed is unreachable — the page falls back to its static hero copy, never blank, never red.
 */
export type InvariantStatus = 'PASS' | 'VIOLATION' | 'PENDING' | 'UNVERIFIED';

export interface InvariantChipDto {
  key: 'floor' | 'ticket' | 'window' | 'asymmetry' | 'receipt';
  status: InvariantStatus;
  checks: number;
  detail: string;
}

/** Per-move verdict, joined to a LogRow on `txHash` (the dashboard has no keccak dependency). */
export interface MoveVerdictDto {
  txHash: string | null;
  kind: 'DEPLOY' | 'WITHDRAW';
  floorHeadroomUsdc: string | null;
  windowUtilization: number | null;
  receipt: 'match' | 'mismatch';
  perInvariant: Record<string, InvariantStatus>;
}

export interface AuditBlock {
  /** When the nightly verifier run produced this verdict (ISO). */
  runAt: string;
  /** Last block the verifier scanned — rows past this render PENDING, not suspicious. */
  scannedThroughBlock: string | null;
  compliant: boolean;
  totalMoves: number;
  invariants: InvariantChipDto[];
  closestApproachToFloorUsdc: string | null;
  /** Keyed by lowercased txHash. */
  verdictsByTxHash: Record<string, MoveVerdictDto>;
  /** verifier version + commit, for the provenance line. */
  version?: string;
}

/** GET /api/events → everything the page renders. `mandate` is null when the RPC read failed (soft state). */
export interface EventsResponse {
  agentAddress: string;
  identityRegistry: string;
  mandateAddress: string;
  agentIdentityId: string;
  schedulerMode: 'observe' | 'trade';
  stats: {
    cycles: number;
    decisions: number;
    onChainMoves: number;
    firstOnChainMoveAt: string | null;
    lastOnChainMoveAt: string | null;
    lastCycleAt: string | null;
    floorBreaches: number;
  };
  mandate: MandateSnapshotDto | null;
  latestForecast: ForecastSnapshotDto | null;
  events: EventLogRecord[];
  /** Nightly machine-audit verdict (spliced by the proxy from the audit-log ref); absent if unreachable. */
  audit?: AuditBlock | null;
}

/** GET /health → CONTENT-based liveness for the canary/uptime monitor (§15.4). */
export interface HealthResponse {
  status: 'ok' | 'degraded';
  lastCycleAt: string | null;
  agentAlive: boolean;
  reason: string;
}
