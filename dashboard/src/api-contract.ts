import type { EventLogRecord } from '@yield/shared';

/**
 * The dashboard reads exactly ONE API route and nothing else (plan §16.2). That route returns the
 * append-only event log the agent writes; the UI renders the decision list, identity badge,
 * receipt links, and explorer links from it. Pinning the shape here keeps writer (agent) and
 * reader (dashboard) from drifting.
 */

/** GET /api/events → the decision/settlement history, newest-last (append order). */
export interface EventsResponse {
  agentAddress: string;
  identityRegistry: string;
  mandateAddress: string;
  events: EventLogRecord[];
}

/** GET /health → liveness for the canary/uptime monitor (§15.4). */
export interface HealthResponse {
  status: 'ok' | 'degraded';
  lastCycleAt: string | null; // ISO datetime of the last completed agent cycle
  agentAlive: boolean;
}
