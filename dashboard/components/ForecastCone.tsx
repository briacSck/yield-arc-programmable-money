'use client';

import type { EventLogRecord, ForecastResult } from '@yield/shared';
import type { BalancePointDto } from '../src/api-contract';

/**
 * The signature element: the forecast cone as a LEDGER HORIZON. P10/P90 fan in sage, the safe
 * floor as a labeled ledger rule, and the agent's executed decisions sitting ON the horizon as
 * mono-labeled tick markers with drop-lines. With `history` (the ?demo=90d replay), the realized
 * balance draws as a solid ink line LEFT of asOf with the moves sitting on it — the chart grows
 * day by day on camera. Hand-rolled SVG — video-grade weights (strokes ≥2px, fill ≥0.15 opacity,
 * markers ≥8px) so it survives a projector and a compressed 3-min video.
 */
export function ForecastCone({
  forecast,
  floorUsdc,
  moves,
  revoked,
  revokedAt,
  history,
}: {
  forecast: ForecastResult | null;
  floorUsdc: string | null;
  moves: EventLogRecord[];
  /** Is the mandate revoked right now? Drives the dimmed styling. */
  revoked: boolean;
  /** WHEN it was revoked — null when that record has scrolled out of the window. Drives only the
   *  marker, so an unknown timestamp dims the cone without drawing the rule at a fabricated date. */
  revokedAt: string | null;
  /** Realized balance per day left of asOf (demo replay); absent live ⇒ forward-only cone. */
  history?: BalancePointDto[] | null;
}) {
  if (!forecast || forecast.series.length < 2) {
    return (
      <div className="empty">
        Building the first projection — the cone appears after the next agent cycle.
      </div>
    );
  }

  const W = 920;
  const H = 300;
  const PAD = { l: 64, r: 16, t: 18, b: 30 };
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;

  const series = forecast.series;
  const floor = floorUsdc ? BigInt(floorUsdc) : null;
  // The realized path, oldest → newest, clipped to strictly before the forecast's own span so a
  // duplicated boundary day never draws twice.
  const realized = (history ?? []).map((h) => ({
    ms: Date.parse(`${h.date}T00:00:00Z`),
    v: BigInt(h.companyBalanceUsdc),
  }));
  const values = series.flatMap((p) => [BigInt(p.p10), BigInt(p.p90)]);
  for (const r of realized) values.push(r.v);
  if (floor !== null) values.push(floor);
  let lo = values.reduce((a, b) => (b < a ? b : a));
  let hi = values.reduce((a, b) => (b > a ? b : a));
  const span = hi - lo || 1n;
  lo -= span / 8n;
  hi += span / 12n;

  const t0 = Date.parse(forecast.asOf);
  const t1 = Date.parse(`${series[series.length - 1]!.date}T00:00:00Z`);
  // With history the x-domain opens at the first realized day — the chart grows as the replay
  // advances. Without it (live mode) the domain starts at asOf, exactly as before.
  const tStart = realized.length > 0 ? Math.min(realized[0]!.ms, t0) : t0;
  const x = (ms: number) => PAD.l + Math.min(Math.max(((ms - tStart) / (t1 - tStart)) * iw, 0), iw);
  const y = (v: bigint) => PAD.t + ih - Number(((v - lo) * 10_000n) / (hi - lo)) / 10_000 * ih;

  const pts = series.map((p) => ({
    px: x(Date.parse(`${p.date}T00:00:00Z`)),
    p10: y(BigInt(p.p10)),
    p50: y(BigInt(p.p50)),
    p90: y(BigInt(p.p90)),
  }));
  const line = (key: 'p10' | 'p50' | 'p90') => pts.map((p) => `${p.px},${p[key]}`).join(' ');
  const band = [...pts.map((p) => `${p.px},${p.p90}`), ...[...pts].reverse().map((p) => `${p.px},${p.p10}`)].join(' ');

  const realizedPts = realized.map((r) => ({ px: x(r.ms), py: y(r.v), ms: r.ms }));
  const realizedLine = realizedPts.map((p) => `${p.px},${p.py}`).join(' ');

  // "$38,000", not "38000.00" — locale separators and an explicit unit; decimals only when the
  // scale is small enough for them to mean anything (the v2 mandate lives in single dollars).
  const fmtAxis = (v: bigint) => {
    const n = Number(v) / 1e6;
    return `$${Math.abs(n) >= 1000 ? Math.round(n).toLocaleString('en-US') : n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  };
  const gridVals = [lo + span / 4n, lo + span / 2n, lo + (3n * span) / 4n];

  /** y of the realized line at a move's day — the marker sits ON the line it belongs to. */
  const realizedYAt = (ms: number): number | null => {
    let best: { px: number; py: number; ms: number } | null = null;
    for (const p of realizedPts) {
      if (p.ms <= ms && (best === null || p.ms > best.ms)) best = p;
    }
    return best?.py ?? null;
  };

  const markers = moves
    .filter((m) => m.status === 'CONFIRMED')
    .map((m) => {
      const ms = Date.parse(m.loggedAt);
      if (!Number.isFinite(ms) || ms < tStart - 86_400_000) return null;
      return {
        px: Math.max(PAD.l, Math.min(x(ms), W - PAD.r)),
        onLineY: ms < t0 ? realizedYAt(ms) : null,
        kind: m.decision.kind,
        amount: m.decision.amountUsdc,
      };
    })
    .filter((m): m is NonNullable<typeof m> => m !== null);

  const revokedX = revokedAt ? x(Date.parse(revokedAt)) : null;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="Cash forecast cone (P10–P90) with safe floor and executed decisions"
      style={{ width: '100%', height: 'auto', display: 'block' }}
    >
      {/* grid */}
      {gridVals.map((v, i) => (
        <g key={i}>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="var(--line-2)" strokeWidth="1" />
          <text x={PAD.l - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill="var(--mute-2)" fontFamily="Geist Mono, monospace">
            {fmtAxis(v)}
          </text>
        </g>
      ))}

      {/* cone */}
      <polygon points={band} fill="var(--accent)" opacity={revoked ? 0.08 : 0.16} />
      <polyline points={line('p10')} fill="none" stroke="var(--accent)" strokeWidth="2" opacity={revoked ? 0.35 : 0.8} />
      <polyline points={line('p90')} fill="none" stroke="var(--accent)" strokeWidth="2" opacity={revoked ? 0.35 : 0.8} />
      <polyline
        points={line('p50')}
        fill="none"
        stroke={revoked ? 'var(--mute-2)' : 'var(--ink)'}
        strokeWidth="2.5"
      />

      {/* realized history — what actually happened, solid, left of today */}
      {realizedPts.length > 1 && (
        <polyline points={realizedLine} fill="none" stroke="var(--ink)" strokeWidth="2.5" opacity={revoked ? 0.5 : 1} />
      )}
      {realizedPts.length > 0 && x(t0) > PAD.l + 4 && (
        <g>
          <line x1={x(t0)} x2={x(t0)} y1={PAD.t} y2={H - PAD.b} stroke="var(--line-2)" strokeWidth="1.5" strokeDasharray="3 4" />
          <text x={x(t0) + 5} y={PAD.t + 11} fontSize="11" fill="var(--mute-2)" fontFamily="Geist Mono, monospace">
            today
          </text>
        </g>
      )}

      {/* safe floor — the ledger rule the agent may never breach */}
      {floor !== null && (
        <g>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(floor)} y2={y(floor)} stroke="var(--neg)" strokeWidth="2" strokeDasharray="7 5" />
          <text x={W - PAD.r} y={y(floor) - 7} textAnchor="end" fontSize="11" fill="var(--neg)" fontFamily="Geist Mono, monospace">
            SAFE FLOOR — {fmtAxis(floor)}
          </text>
        </g>
      )}

      {/* executed decisions — ON the realized line when it covers their day, on the horizon rail otherwise */}
      {markers.map((m, i) => {
        const isDeploy = m.kind === 'DEPLOY';
        if (m.onLineY !== null) {
          return (
            <circle
              key={i}
              cx={m.px}
              cy={m.onLineY}
              r="5"
              fill={isDeploy ? 'var(--accent)' : 'var(--warn)'}
              stroke="var(--paper, #fff)"
              strokeWidth="1.5"
            />
          );
        }
        const my = PAD.t + 14;
        return (
          <g key={i}>
            <line x1={m.px} x2={m.px} y1={my + 8} y2={H - PAD.b} stroke={isDeploy ? 'var(--accent)' : 'var(--warn)'} strokeWidth="1.5" strokeDasharray="2 4" />
            <path
              d={isDeploy ? `M ${m.px - 6} ${my + 10} L ${m.px + 6} ${my + 10} L ${m.px} ${my} Z` : `M ${m.px - 6} ${my} L ${m.px + 6} ${my} L ${m.px} ${my + 10} Z`}
              fill={isDeploy ? 'var(--accent)' : 'var(--warn)'}
            />
          </g>
        );
      })}

      {/* revoked: the moment the owner fired the agent */}
      {revokedX !== null && revokedX >= PAD.l && (
        <g>
          <line x1={revokedX} x2={revokedX} y1={PAD.t} y2={H - PAD.b} stroke="var(--neg)" strokeWidth="2" />
          <text x={revokedX + 6} y={PAD.t + 12} fontSize="11" fill="var(--neg)" fontFamily="Geist Mono, monospace">
            MANDATE REVOKED
          </text>
        </g>
      )}

      {/* x axis — history mode spans start / today / horizon; live mode keeps first / mid / last */}
      {(realizedPts.length > 0 && history
        ? [
            { px: x(tStart), label: history[0]!.date.slice(5) },
            { px: x(t0), label: forecast.asOf.slice(5, 10) },
            { px: x(t1), label: series[series.length - 1]!.date.slice(5) },
          ]
        : [0, Math.floor(series.length / 2), series.length - 1].map((idx) => ({
            px: pts[idx]!.px,
            label: series[idx]!.date.slice(5),
          }))
      ).map((tick, i) => (
        <text key={i} x={tick.px} y={H - 8} textAnchor="middle" fontSize="11" fill="var(--mute-2)" fontFamily="Geist Mono, monospace">
          {tick.label}
        </text>
      ))}
    </svg>
  );
}
