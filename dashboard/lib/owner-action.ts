/**
 * The owner-controls request contract, shared by the browser and the `/api/owner` proxy.
 *
 * The WORKER is authoritative: it re-validates everything and holds the only Circle credentials
 * (rule #5). This is the outer layer of a defence in depth — a malformed or hostile request is
 * refused at the edge, so the internet-facing service never forwards junk into the private network
 * carrying the shared secret. The two validators agree by construction on the grammar below;
 * if they ever disagree, the worker's answer is the one that counts.
 */

export type OwnerActionName = 'pause' | 'resume' | 'floor';

/** Worker path for each action. Keys are the ONLY accepted action names — nothing else is proxied. */
export const OWNER_ACTION_PATHS: Record<OwnerActionName, string> = {
  pause: '/owner/pause',
  resume: '/owner/resume',
  floor: '/owner/floor',
};

/**
 * A mandate bound in 6-decimal USDC base units: positive, canonical, ≤ 18 digits.
 * Mirrors `parseUnits` in agent/src/chain/owner-actions.ts.
 */
const UNITS_RE = /^[1-9][0-9]{0,17}$/;

export type ParsedOwnerRequest =
  | { ok: true; action: OwnerActionName; path: string; payload: Record<string, string> }
  | { ok: false; error: string };

export function parseOwnerRequest(body: unknown): ParsedOwnerRequest {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'expected a JSON object' };
  }
  const { action, floorUsdc, requestId } = body as Record<string, unknown>;
  if (typeof action !== 'string' || !(action in OWNER_ACTION_PATHS)) {
    return { ok: false, error: `action must be one of: ${Object.keys(OWNER_ACTION_PATHS).join(', ')}` };
  }
  const name = action as OwnerActionName;

  const payload: Record<string, string> = {};
  if (requestId !== undefined && requestId !== null && requestId !== '') {
    if (typeof requestId !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(requestId)) {
      return { ok: false, error: 'requestId must be 8–64 chars of [A-Za-z0-9_-]' };
    }
    payload.requestId = requestId;
  }

  if (name === 'floor') {
    if (typeof floorUsdc !== 'string' || !UNITS_RE.test(floorUsdc)) {
      return {
        ok: false,
        error: 'floorUsdc must be a positive integer STRING of USDC base units (6-dec), e.g. "5000000"',
      };
    }
    payload.floorUsdc = floorUsdc;
  }

  return { ok: true, action: name, path: OWNER_ACTION_PATHS[name], payload };
}

/** Result of an owner action, as the browser sees it. `txHash` is present only on success. */
export interface OwnerActionResponse {
  ok: boolean;
  action?: string;
  txHash?: string;
  explorerUrl?: string;
  error?: string;
}
