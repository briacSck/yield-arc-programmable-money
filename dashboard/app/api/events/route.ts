import { NextResponse } from 'next/server';
import type { AuditBlock } from '../../../src/api-contract';

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

    const verdictsByTxHash: AuditBlock['verdictsByTxHash'] = {};
    for (const m of v.moves as Array<Record<string, unknown>>) {
      const tx = typeof m.txHash === 'string' ? m.txHash.toLowerCase() : null;
      if (!tx) continue;
      verdictsByTxHash[tx] = {
        txHash: tx,
        kind: m.kind === 'WITHDRAW' ? 'WITHDRAW' : 'DEPLOY',
        floorHeadroomUsdc: (m.floorHeadroomUsdc as string | null) ?? null,
        windowUtilization: (m.windowUtilization as number | null) ?? null,
        receipt: m.receipt === 'mismatch' ? 'mismatch' : 'match',
        perInvariant: (m.perInvariant as Record<string, AuditBlock['invariants'][number]['status']>) ?? {},
      };
    }

    return {
      runAt: typeof v.runAt === 'string' ? v.runAt : new Date(0).toISOString(),
      scannedThroughBlock: (v.scannedThroughBlock as string | null) ?? null,
      compliant: v.compliant === true,
      totalMoves: typeof v.totalMoves === 'number' ? v.totalMoves : 0,
      invariants: v.invariants as AuditBlock['invariants'],
      closestApproachToFloorUsdc: (v.closestApproachToFloorUsdc as string | null) ?? null,
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
