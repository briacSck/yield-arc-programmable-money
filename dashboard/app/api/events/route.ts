import { NextResponse } from 'next/server';
import type { AuditBlock, InvariantStatus } from '../../../src/api-contract';

export const dynamic = 'force-dynamic';

/**
 * The verdicts feed (plan §18.2 [DECIDED — CI push]): the nightly Action writes `verdicts.json` to
 * a dedicated `audit-log` git ref; we fetch the RAW githubusercontent URL server-side (NOT
 * api.github.com — its unauthenticated rate limit would intermittently kill the audit block) with a
 * hard timeout + short cache. The git history of that ref is itself a tamper-evident audit trail.
 */
const AUDIT_URL =
  process.env.AUDIT_VERDICTS_URL ||
  'https://raw.githubusercontent.com/briacSck/yield-arc-programmable-money/audit-log/verdicts.json';

/**
 * Fetch + normalize the audit block. Every failure path returns `null` — an unreachable or
 * malformed feed must NEVER surface as an error on the camera surface; the page degrades to its
 * static hero. Absolute rule (§18.2): no data-plumbing failure ever renders red.
 */
async function fetchAudit(): Promise<AuditBlock | null> {
  try {
    const res = await fetch(AUDIT_URL, {
      signal: AbortSignal.timeout(4_000),
      // Short revalidate: the verdict changes at most nightly, and a stale-by-minutes audit is fine.
      next: { revalidate: 300 },
    });
    if (!res.ok) return null;
    const v = (await res.json()) as Record<string, unknown>;
    if (!Array.isArray(v.invariants) || !Array.isArray(v.moves)) return null;

    // Validate EVERY invariant element — a blind cast would (a) crash the page on a malformed
    // element (`iv.status.toLowerCase()` on undefined) and (b) let a degenerate feed spoof a green
    // "machine-verified" verdict. A feed with zero *valid* invariants is unusable → return null so
    // the page falls back to its honest static hero, never a fabricated all-clear.
    const STATUSES = new Set<InvariantStatus>(['PASS', 'VIOLATION', 'PENDING', 'UNVERIFIED']);
    const KEYS = new Set(['floor', 'ticket', 'window', 'asymmetry', 'receipt']);
    const invariants: AuditBlock['invariants'] = [];
    for (const raw of v.invariants as Array<Record<string, unknown>>) {
      if (!raw || typeof raw !== 'object') return null;
      if (typeof raw.key !== 'string' || !KEYS.has(raw.key)) return null;
      if (typeof raw.status !== 'string' || !STATUSES.has(raw.status as InvariantStatus)) return null;
      invariants.push({
        key: raw.key as AuditBlock['invariants'][number]['key'],
        status: raw.status as InvariantStatus,
        checks: typeof raw.checks === 'number' ? raw.checks : 0,
        detail: typeof raw.detail === 'string' ? raw.detail : '',
      });
    }
    if (invariants.length === 0) return null; // nothing actually verified → no audit block

    const verdictsByTxHash: AuditBlock['verdictsByTxHash'] = {};
    for (const m of v.moves as Array<Record<string, unknown>>) {
      const tx = typeof m.txHash === 'string' ? m.txHash.toLowerCase() : null;
      if (!tx) continue;
      // Keep only real per-invariant statuses — an empty/garbage map must render UNVERIFIED,
      // never a green PASS (page.tsx treats "no VIOLATION" as PASS otherwise).
      const per: Record<string, InvariantStatus> = {};
      if (m.perInvariant && typeof m.perInvariant === 'object') {
        for (const [k, s] of Object.entries(m.perInvariant as Record<string, unknown>)) {
          if (typeof s === 'string' && STATUSES.has(s as InvariantStatus)) per[k] = s as InvariantStatus;
        }
      }
      verdictsByTxHash[tx] = {
        txHash: tx,
        kind: m.kind === 'WITHDRAW' ? 'WITHDRAW' : 'DEPLOY',
        floorHeadroomUsdc: typeof m.floorHeadroomUsdc === 'string' ? m.floorHeadroomUsdc : null,
        windowUtilization: typeof m.windowUtilization === 'number' ? m.windowUtilization : null,
        receipt: m.receipt === 'mismatch' ? 'mismatch' : 'match',
        perInvariant: per,
      };
    }

    return {
      runAt: typeof v.runAt === 'string' ? v.runAt : new Date(0).toISOString(),
      scannedThroughBlock: typeof v.scannedThroughBlock === 'string' ? v.scannedThroughBlock : null,
      compliant: v.compliant === true,
      totalMoves: typeof v.totalMoves === 'number' ? v.totalMoves : 0,
      invariants,
      closestApproachToFloorUsdc: typeof v.closestApproachToFloorUsdc === 'string' ? v.closestApproachToFloorUsdc : null,
      verdictsByTxHash,
      version: typeof v.version === 'string' ? v.version : undefined,
    };
  } catch {
    return null;
  }
}

/** The ONE data route (plan §16.2) — proxies the worker's internal surface + splices the audit block. */
export async function GET(request: Request) {
  const worker = process.env.WORKER_URL || 'http://localhost:8787';
  const limit = new URL(request.url).searchParams.get('limit') || '200';

  // Fetch worker + audit in parallel; the audit fetch can never fail the response.
  const [workerRes, audit] = await Promise.all([
    fetch(`${worker}/events?limit=${encodeURIComponent(limit)}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(8_000),
    }).catch((err: Error) => err),
    fetchAudit(),
  ]);

  if (workerRes instanceof Error) {
    return NextResponse.json({ error: `worker unreachable: ${workerRes.message}` }, { status: 502 });
  }

  try {
    const body = (await workerRes.json()) as Record<string, unknown>;
    body.audit = audit; // null when the feed is unreachable — the page handles that
    return NextResponse.json(body, { status: workerRes.status });
  } catch (err) {
    return NextResponse.json({ error: `bad worker payload: ${(err as Error).message}` }, { status: 502 });
  }
}
