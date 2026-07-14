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
}

/** GET /health → CONTENT-based liveness for the canary/uptime monitor (§15.4). */
export interface HealthResponse {
  status: 'ok' | 'degraded';
  lastCycleAt: string | null;
  agentAlive: boolean;
  reason: string;
}
