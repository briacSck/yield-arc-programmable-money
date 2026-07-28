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
/**
 * Constant-time compare, so a passphrase cannot be recovered by timing the 401s.
 */
function secretsMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

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

  /**
   * THE CALLER'S OWN GATE — this is the important one.
   *
   * `OWNER_ACTION_SECRET` protects the WORKER from direct callers. It does nothing to protect THIS
   * route from the internet, because the route attaches that secret server-side for whoever asks.
   * Without the check below, `curl -X POST <public-url>/api/owner -d '{"action":"pause"}'` pauses a
   * live agent, from a URL printed in a public README.
   *
   * So the caller must present the owner passphrase too. It is typed once by the owner and kept in
   * their browser; it never appears in the page source, because it is compared here on the server.
   * Fails CLOSED: no passphrase configured means owner writes are disabled entirely, which is the
   * right default for a public demo.
   */
  const uiPass = (process.env.OWNER_UI_PASSPHRASE ?? '').trim();
  if (!uiPass || uiPass.length < 8) {
    return NextResponse.json(
      {
        ok: false,
        error:
          'Owner controls are disabled on this deployment: no owner passphrase is configured. Nothing was sent.',
      },
      { status: 503 },
    );
  }
  const presented = (request.headers.get('x-owner-pass') ?? '').trim();
  if (!secretsMatch(presented, uiPass)) {
    return NextResponse.json(
      { ok: false, error: 'That owner passphrase is not right. Nothing was sent, and nothing changed.' },
      { status: 401 },
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
