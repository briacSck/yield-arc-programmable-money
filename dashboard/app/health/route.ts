import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/** Canary/uptime target (§15.4) — proxies the worker's content-based health. */
export async function GET() {
  const worker = process.env.WORKER_URL || 'http://localhost:8787';
  try {
    const upstream = await fetch(`${worker}/health`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(8_000),
    });
    const body = await upstream.text();
    return new NextResponse(body, {
      status: upstream.status,
      headers: { 'content-type': 'application/json' },
    });
  } catch (err) {
    return NextResponse.json(
      { status: 'degraded', lastCycleAt: null, agentAlive: false, reason: `worker unreachable: ${(err as Error).message}` },
      { status: 503 },
    );
  }
}
