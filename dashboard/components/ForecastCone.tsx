'use client';

import type { EventLogRecord, ForecastResult } from '@yield/shared';

/**
 * The signature element: the forecast cone as a LEDGER HORIZON. P10/P90 fan in sage, the safe
 * floor as a labeled ledger rule, and the agent's executed decisions sitting ON the horizon as
 * mono-labeled tick markers with drop-lines. Hand-rolled SVG — video-grade weights (strokes ≥2px,
 * fill ≥0.15 opacity, markers ≥8px) so it survives a projector and a compressed 3-min video.
 */
export function ForecastCone({
  forecast,
  floorUsdc,
  moves,
  revokedAt,
}: {
  forecast: ForecastResult | null;
  floorUsdc: string | null;
  moves: EventLogRecord[];
  revokedAt: string | null;
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
  const values = series.flatMap((p) => [BigInt(p.p10), BigInt(p.p90)]);
  if (floor !== null) values.push(floor);
  let lo = values.reduce((a, b) => (b < a ? b : a));
  let hi = values.reduce((a, b) => (b > a ? b : a));
  const span = hi - lo || 1n;
  lo -= span / 8n;
  hi += span / 12n;

  const t0 = Date.parse(forecast.asOf);
  const t1 = Date.parse(`${series[series.length - 1]!.date}T00:00:00Z`);
  const x = (ms: number) => PAD.l + Math.min(Math.max(((ms - t0) / (t1 - t0)) * iw, 0), iw);
  const y = (v: bigint) => PAD.t + ih - Number(((v - lo) * 10_000n) / (hi - lo)) / 10_000 * ih;

  const pts = series.map((p) => ({
    px: x(Date.parse(`${p.date}T00:00:00Z`)),
    p10: y(BigInt(p.p10)),
    p50: y(BigInt(p.p50)),
    p90: y(BigInt(p.p90)),
  }));
  const line = (key: 'p10' | 'p50' | 'p90') => pts.map((p) => `${p.px},${p[key]}`).join(' ');
  const band = [...pts.map((p) => `${p.px},${p.p90}`), ...[...pts].reverse().map((p) => `${p.px},${p.p10}`)].join(' ');

  const fmtAxis = (v: bigint) => `${(Number(v / 1000n) / 1000).toFixed(2)}`;
  const gridVals = [lo + span / 4n, lo + span / 2n, lo + (3n * span) / 4n];

  const markers = moves
    .filter((m) => m.status === 'CONFIRMED')
    .map((m) => {
      const ms = Date.parse(m.loggedAt);
      if (!Number.isFinite(ms) || ms < t0 - 86_400_000) return null;
      return {
        px: Math.max(PAD.l, Math.min(x(ms), W - PAD.r)),
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
      <polygon points={band} fill="var(--accent)" opacity={revokedAt ? 0.08 : 0.16} />
      <polyline points={line('p10')} fill="none" stroke="var(--accent)" strokeWidth="2" opacity={revokedAt ? 0.35 : 0.8} />
      <polyline points={line('p90')} fill="none" stroke="var(--accent)" strokeWidth="2" opacity={revokedAt ? 0.35 : 0.8} />
      <polyline
        points={line('p50')}
        fill="none"
        stroke={revokedAt ? 'var(--mute-2)' : 'var(--ink)'}
        strokeWidth="2.5"
      />

      {/* safe floor — the ledger rule the agent may never breach */}
      {floor !== null && (
        <g>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(floor)} y2={y(floor)} stroke="var(--neg)" strokeWidth="2" strokeDasharray="7 5" />
          <text x={W - PAD.r} y={y(floor) - 7} textAnchor="end" fontSize="11" fill="var(--neg)" fontFamily="Geist Mono, monospace">
            SAFE FLOOR — {fmtAxis(floor)}
          </text>
        </g>
      )}

      {/* executed decisions on the horizon */}
      {markers.map((m, i) => {
        const isDeploy = m.kind === 'DEPLOY';
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

      {/* x axis: first / mid / last date */}
      {[0, Math.floor(series.length / 2), series.length - 1].map((idx) => (
        <text key={idx} x={pts[idx]!.px} y={H - 8} textAnchor="middle" fontSize="11" fill="var(--mute-2)" fontFamily="Geist Mono, monospace">
          {series[idx]!.date.slice(5)}
        </text>
      ))}
    </svg>
  );
}
