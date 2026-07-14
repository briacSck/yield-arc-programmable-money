/** Display formatters — USDC base units (6-dec strings) → human text. Display edge ONLY. */

export function usdc(baseUnits: string | bigint, opts: { dp?: number } = {}): string {
  const v = typeof baseUnits === 'bigint' ? baseUnits : BigInt(baseUnits || '0');
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const whole = abs / 1_000_000n;
  const frac = abs % 1_000_000n;
  // 2dp normally; 6dp (trimmed) for sub-0.01 amounts so tiny ticket sizes stay legible.
  const dp = opts.dp ?? (abs > 0n && abs < 10_000n ? 6 : 2);
  const fracStr = (frac + 1_000_000n).toString().slice(1, 1 + dp).replace(/0+$/, '').padEnd(Math.min(dp, 2), '0');
  const wholeStr = whole.toLocaleString('en-US');
  return `${neg ? '−' : ''}${wholeStr}${fracStr ? `.${fracStr}` : ''} USDC`;
}

export function shortHash(hash: string, chars = 6): string {
  if (!hash || hash.length < 2 * chars + 2) return hash;
  return `${hash.slice(0, chars + 2)}…${hash.slice(-4)}`;
}

/** UTC-labeled absolute + relative recency ("Jul 15, 09:12 UTC · 3h ago"). */
export function when(iso: string | null, nowMs = Date.now()): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  const abs = new Date(t).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  });
  const mins = Math.max(0, Math.round((nowMs - t) / 60_000));
  const rel = mins < 60 ? `${mins}m ago` : mins < 60 * 48 ? `${Math.round(mins / 60)}h ago` : `${Math.round(mins / 1440)}d ago`;
  return `${abs} UTC · ${rel}`;
}

export function daysSince(iso: string | null, nowMs = Date.now()): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((nowMs - t) / 86_400_000));
}

export const ARCSCAN = 'https://testnet.arcscan.app';
