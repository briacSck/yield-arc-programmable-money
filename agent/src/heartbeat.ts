/**
 * Heartbeat ping — plan §15.4. Every agent cycle pings a monitor (healthchecks.io or equivalent);
 * a missed ping alerts the team within 15 min. Tier 1 is a promise — instrument it. A dead agent
 * on Demo Day is worse than none.
 */
export async function ping(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const url = env.HEARTBEAT_URL;
  if (!url) return; // no monitor configured (e.g. local dev) — silently skip.
  try {
    // Hard 5s timeout: the liveness probe must never hang the loop it exists to protect.
    await fetch(url, { method: 'POST', signal: AbortSignal.timeout(5_000) });
  } catch {
    // Never let a monitoring failure crash a cycle; the missed-ping alert is the signal.
  }
}
