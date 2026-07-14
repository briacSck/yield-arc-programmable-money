import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/** The ONE data route (plan §16.2) — proxies the worker's internal surface over private networking. */
export async function GET(request: Request) {
  const worker = process.env.WORKER_URL || 'http://localhost:8787';
  const limit = new URL(request.url).searchParams.get('limit') || '200';
  try {
    const upstream = await fetch(`${worker}/events?limit=${encodeURIComponent(limit)}`, {
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
      { error: `worker unreachable: ${(err as Error).message}` },
      { status: 502 },
    );
  }
}
