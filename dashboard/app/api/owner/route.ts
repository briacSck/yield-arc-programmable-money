import { NextResponse } from 'next/server';
import { parseOwnerRequest } from '../../../lib/owner-action';

export const dynamic = 'force-dynamic';

/**
 * The owner-controls proxy — the ONLY write path the dashboard exposes.
 *
 * It holds no Circle credentials (rule #5): the API key, the entity secret and the company wallet
 * id live in the worker process on Railway's private network. This route's whole job is to attach
 * `OWNER_ACTION_SECRET` **server-side** and forward, so the shared secret never reaches a browser
 * and never appears in a response body (rule #6).
 *
 * Fails closed: with no secret configured, it refuses here rather than sending an unauthenticated
 * write into the worker — the worker would refuse anyway, but an internet-facing service should not
 * be the thing that discovers that.
 */
export async function POST(request: Request) {
  const secret = (process.env.OWNER_ACTION_SECRET ?? '').trim();
  if (!secret) {
    return NextResponse.json(
      {
        ok: false,
        error:
          'Owner controls are not configured on this deployment (OWNER_ACTION_SECRET is unset). Nothing was sent.',
      },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'expected a JSON body' }, { status: 400 });
  }

  const parsed = parseOwnerRequest(body);
  if (!parsed.ok) {
    return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
  }

  const worker = process.env.WORKER_URL || 'http://localhost:8787';
  let res: Response;
  try {
    res = await fetch(`${worker}${parsed.path}`, {
      method: 'POST',
      cache: 'no-store',
      headers: { 'content-type': 'application/json', 'x-owner-secret': secret },
      body: JSON.stringify(parsed.payload),
      // Generous: an owner action is submitted to Circle and polled to a TERMINAL state before the
      // worker answers, so the response IS the on-chain outcome. Timing out early would leave the
      // owner unsure whether their money moved — the one thing this screen must never do.
      signal: AbortSignal.timeout(150_000),
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: `the agent worker did not answer (${(err as Error).message}). Check the mandate on arcscan before retrying.`,
      },
      { status: 502 },
    );
  }

  // Pass the worker's own status and JSON through unchanged — including its refusals. The owner is
  // told exactly what happened; a failure is never dressed up as a success.
  try {
    const payload = (await res.json()) as Record<string, unknown>;
    return NextResponse.json(payload, { status: res.status });
  } catch {
    return NextResponse.json(
      { ok: false, error: `unreadable worker response (HTTP ${res.status})` },
      { status: 502 },
    );
  }
}
