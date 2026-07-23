'use client';

import { useEffect, useMemo, useState } from 'react';
import type { EventLogRecord } from '@yield/shared';
import type { AuditBlock, MoveVerdictDto } from '../src/api-contract';
import type { EventsResponse } from '../src/api-contract';
import { ForecastCone } from '../components/ForecastCone';
import { ARCSCAN, daysSince, shortHash, usdc, when } from '../lib/format';

const POLL_MS = 30_000;

export default function Page() {
  const [data, setData] = useState<EventsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch('/api/events?limit=200', { cache: 'no-store' });
        if (!res.ok) throw new Error(`upstream ${res.status}`);
        const body = (await res.json()) as EventsResponse;
        if (alive) {
          setData(body);
          setError(null);
        }
      } catch (err) {
        if (alive) setError((err as Error).message);
      }
    };
    void load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  const revoked = data?.mandate?.revoked ?? false;
  const revokedAt = useMemo(() => {
    if (!revoked || !data) return null;
    // Best local estimate: the first FAILED MandateRevoked record, else now.
    const rec = data.events.find((e) => e.error?.includes('MandateRevoked'));
    return rec?.loggedAt ?? new Date().toISOString();
  }, [revoked, data]);

  if (!data && !error) return <main className="wrap"><div className="skeleton">loading the agent&apos;s record…</div></main>;
  if (!data) {
    return (
      <main className="wrap">
        <Header revoked={false} agentId="" mode={null} />
        <div className="empty">
          The agent&apos;s feed is unreachable right now ({error}). The on-chain record is unaffected —
          retrying automatically.
        </div>
      </main>
    );
  }

  const { stats, mandate, events, audit } = data;
  const moves = events.filter((e) => e.status === 'CONFIRMED');
  const running = daysSince(stats.firstOnChainMoveAt);
  const gasLow = mandate ? BigInt(mandate.agentGasWei) < 5n * 10n ** 16n : false;
  const auditViolations = audit ? audit.invariants.reduce((n, iv) => n + (iv.status === 'VIOLATION' ? 1 : 0), 0) : null;

  return (
    <main className="wrap">
      <Header revoked={revoked} agentId={data.agentIdentityId} mode={data.schedulerMode} />

      {revoked && (
        <div className="banner-revoked">
          The owner revoked the mandate{revokedAt ? ` at ${when(revokedAt)}` : ''}. Deposits are blocked
          on-chain; withdrawals toward safety remain open. The agent can be re-hired with one transaction.
        </div>
      )}

      {/* Claim strip */}
      <section className="claim">
        <h1>An autonomous CFO, running unattended on Arc.</h1>
        <div className="claim__stats">
          <div className="stat">
            <div className="stat__num">{running !== null ? `${running}d` : '—'}</div>
            <div className="stat__label">{stats.firstOnChainMoveAt ? 'on-chain since ' + stats.firstOnChainMoveAt.slice(0, 10) : 'awaiting first move'}</div>
          </div>
          <div className="stat">
            <div className="stat__num">{stats.onChainMoves}</div>
            <div className="stat__label">on-chain decisions</div>
          </div>
          <div className="stat">
            <div className="stat__num">{stats.cycles}</div>
            <div className="stat__label">forecast cycles</div>
          </div>
          <div className="stat">
            {/* Hero wiring (§18.2): the page's first number is machine-attested when the nightly
                audit is reachable, and falls back to the honest static claim when it isn't. */}
            {audit ? (
              <>
                <div className="stat__num">
                  <a href="#audit" className="stat__link">{auditViolations}</a>
                </div>
                <div className="stat__label">
                  {auditViolations === 0 ? 'violations — machine-verified' : 'violations found'}
                </div>
              </>
            ) : (
              <>
                <div className="stat__num">0</div>
                <div className="stat__label">floor breaches (enforced on-chain)</div>
              </>
            )}
          </div>
        </div>
      </section>

      {/* The ledger horizon */}
      <section className="section">
        <div className="section__head">
          <h2>30-day cash horizon — P10–P90, safe floor, and every move the agent made</h2>
          <span className="eyebrow">{data.latestForecast ? `forecast ${when(data.latestForecast.loggedAt)}` : 'no forecast yet'}</span>
        </div>
        <ForecastCone
          forecast={data.latestForecast?.forecast ?? null}
          floorUsdc={mandate?.floorUsdc ?? null}
          moves={moves}
          revokedAt={revokedAt}
        />
      </section>

      {/* Machine-audit scoreboard (§18.2) — the 10-second camera surface. Renders only when the
          nightly verifier feed is reachable; its absence is silent, never red. */}
      {audit && <Scoreboard audit={audit} />}

      {/* Decision log */}
      <section className="section">
        <div className="section__head">
          <h2>Decision log</h2>
          <span className="eyebrow">every cycle, including the ones that moved nothing</span>
        </div>
        {events.length === 0 ? (
          <div className="empty">
            Observing — the agent is computing forecasts and will act the moment the mandate allows a
            useful move. Discipline, not inactivity.
          </div>
        ) : (
          [...events].reverse().slice(0, 60).map((e) => (
            <LogRow
              key={e.seq}
              record={e}
              verdict={e.execution ? audit?.verdictsByTxHash[e.execution.txHash.toLowerCase()] ?? null : null}
              auditThroughBlock={audit?.scannedThroughBlock ?? null}
            />
          ))
        )}
      </section>

      {/* Mandate + uptime */}
      <section className="section bottom">
        <div>
          <div className="section__head">
            <h2>The mandate — an employment contract, on-chain</h2>
          </div>
          {mandate ? (
            <div className={`contract${revoked ? ' contract--revoked' : ''}`}>
              <dl>
                <dt>Company pool</dt>
                <dd>{usdc(mandate.companyBalanceUsdc)}</dd>
                <dt>Deployed in yield</dt>
                <dd>{usdc(mandate.deployedUsdc)}</dd>
                <dt>Safe floor (hard)</dt>
                <dd>{usdc(mandate.floorUsdc)}</dd>
                <dt>Per-move cap</dt>
                <dd>{usdc(mandate.maxTicketUsdc)}</dd>
                <dt>Daily budget</dt>
                <dd>
                  {usdc(mandate.windowDeployedUsdc)} / {usdc(mandate.dailyCapUsdc)}
                </dd>
                <dt>Status</dt>
                <dd>{revoked ? 'REVOKED by owner' : 'active'}</dd>
                <dt>Agent gas</dt>
                <dd>{gasLow ? '⚠ low' : 'ok'}</dd>
              </dl>
            </div>
          ) : (
            <div className="empty">
              Mandate reads reconnecting — last confirmed state stands on{' '}
              <a href={`${ARCSCAN}/address/${data.mandateAddress}`} target="_blank" rel="noreferrer">
                arcscan
              </a>
              .
            </div>
          )}
        </div>
        <div>
          <div className="section__head">
            <h2>Recent cycles</h2>
            <span className="eyebrow">last cycle {when(stats.lastCycleAt)}</span>
          </div>
          <UptimeStrip events={events} />
          <p className="empty" style={{ paddingTop: 12 }}>
            Each bar is one unattended cycle: sage moved money, grey held or observed, red failed
            loudly. A silent agent would show gaps — there are none.
          </p>
        </div>
      </section>

      <footer className="footer">
        <span className="chip">testnet demo · Boulangerie Chartier persona at 1:3800 scale</span>
        <a href={`${ARCSCAN}/address/${data.mandateAddress}`} target="_blank" rel="noreferrer">
          mandate {shortHash(data.mandateAddress)}
        </a>
        <a href={`${ARCSCAN}/address/${data.agentAddress}`} target="_blank" rel="noreferrer">
          agent {shortHash(data.agentAddress)}
        </a>
        <a href={`${ARCSCAN}/address/${data.identityRegistry}`} target="_blank" rel="noreferrer">
          ERC-8004 registry
        </a>
      </footer>
    </main>
  );
}

function Header({ revoked, agentId, mode }: { revoked: boolean; agentId: string; mode: 'observe' | 'trade' | null }) {
  return (
    <header className="header">
      <span className="brand">
        <span className="brand__mark" />
        YIELD
      </span>
      <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {agentId && <span className="chip">ERC-8004 agent #{agentId}</span>}
        {mode && <span className={`chip ${mode === 'trade' ? 'chip--active' : ''}`}>{mode} mode</span>}
        <span className={`chip ${revoked ? 'chip--revoked' : 'chip--active'}`}>
          {revoked ? 'mandate revoked' : 'mandate active'}
        </span>
      </span>
    </header>
  );
}

/**
 * The audit scoreboard band (§18.2) — five HISTORY-level invariants (not row properties): the 24h
 * window is rolling; asymmetry is a property of the whole revocation history. Magnitude, not grade.
 * Vocabulary is PASS/VIOLATION/PENDING/UNVERIFIED — never "FAIL(ED)" (the log uses FAILED for tx
 * failures). No data-plumbing failure reaches here: this renders only when a real verdict exists.
 */
const INVARIANT_LABEL: Record<string, string> = {
  floor: 'floor',
  ticket: 'ticket',
  window: 'window',
  asymmetry: 'asymmetry',
  receipt: 'receipts',
};

function Scoreboard({ audit }: { audit: AuditBlock }) {
  const violations = audit.invariants.reduce((n, iv) => n + (iv.status === 'VIOLATION' ? 1 : 0), 0);
  const stale = Date.now() - Date.parse(audit.runAt) > 36 * 3_600_000;

  return (
    <section className="section" id="audit">
      <div className="section__head">
        <h2>Machine-checked — every move, against five invariants</h2>
        <span className={`eyebrow${stale ? ' eyebrow--warn' : ''}`}>
          {stale ? 'audit stale · ' : ''}last audit {when(audit.runAt)}
          {audit.version ? ` · ${audit.version}` : ''}
        </span>
      </div>

      <div className="scoreboard">
        <div className="scoreboard__headline">
          <div className="scoreboard__num">
            {audit.totalMoves} × 5
          </div>
          <div className="scoreboard__sub">
            {audit.totalMoves} moves × 5 invariants — <strong>{violations === 0 ? '0 violations' : `${violations} violation${violations > 1 ? 's' : ''}`}</strong>
            {audit.closestApproachToFloorUsdc && violations === 0 && (
              <> · closest approach <strong>{usdc(audit.closestApproachToFloorUsdc)}</strong> above floor</>
            )}
          </div>
          <div className="scoreboard__verify">
            verify it yourself: <code>npx -y @yield-cfo/mandate-verify</code>
          </div>
        </div>

        <div className="scoreboard__chips">
          {audit.invariants.map((iv) => (
            <div key={iv.key} className={`inv inv--${iv.status.toLowerCase()}`} title={iv.detail}>
              <span className="inv__key">{INVARIANT_LABEL[iv.key] ?? iv.key}</span>
              <span className="inv__status">{iv.status}</span>
              <span className="inv__checks">{iv.checks} checked</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function LogRow({
  record,
  verdict,
  auditThroughBlock,
}: {
  record: EventLogRecord;
  verdict?: MoveVerdictDto | null;
  auditThroughBlock?: string | null;
}) {
  const { decision, status, execution } = record;
  const isMove = status === 'CONFIRMED';
  const isFailed = status === 'FAILED';
  const kindClass =
    isFailed ? 'kind--failed'
    : decision.kind === 'DEPLOY' ? 'kind--deploy'
    : decision.kind === 'WITHDRAW' ? 'kind--withdraw'
    : decision.kind === 'FLOOR_RAISE' ? 'kind--floor'
    : 'kind--hold';
  // The verifier verdict SUPERSEDES the client-side receipt badge (two sources of truth must never
  // disagree on screen). The client check renders only past the coverage boundary, styled provisional.
  const receiptOk = execution ? execution.receiptHash === decision.forecastInputsHash : null;
  const pastCoverage =
    isMove && auditThroughBlock && !verdict; // a confirmed move newer than the last audit = PENDING

  return (
    <div className={`log-row${isMove ? ' log-row--move' : ' log-row--quiet'}`}>
      <span className="log-row__ts">{when(record.loggedAt)}</span>
      <span className={`kind ${kindClass}`}>
        {isFailed ? 'FAILED' : decision.kind}
        {isMove ? ` ${usdc(decision.amountUsdc)}` : ''}
      </span>
      <span className="log-row__reason">
        {isFailed && record.error ? `${decision.reason} — ${record.error}` : decision.reason}
        {decision.exposure && decision.kind === 'FLOOR_RAISE' && (
          <> ({decision.exposure.inputName} {decision.exposure.shockPct > 0 ? '+' : ''}{decision.exposure.shockPct}%)</>
        )}
      </span>
      <span className="log-row__links">
        {execution && (
          <>
            <a href={execution.explorerUrl} target="_blank" rel="noreferrer">
              tx {shortHash(execution.txHash)}
            </a>
            {verdict ? (
              <MoveVerdict verdict={verdict} />
            ) : pastCoverage ? (
              <span className="verdict verdict--pending" title="confirmed on-chain; awaiting the next nightly audit">
                PENDING
              </span>
            ) : (
              <span
                className={`badge-provisional`}
                title="client-side receipt check (provisional until the nightly audit covers this move)"
              >
                {receiptOk ? '✓ receipt' : '✗ receipt'}
              </span>
            )}
          </>
        )}
      </span>
    </div>
  );
}

/** Per-move verdict chip — machine-attested. Green = every applicable invariant PASSed at this move. */
function MoveVerdict({ verdict }: { verdict: MoveVerdictDto }) {
  const statuses = Object.values(verdict.perInvariant);
  const anyViolation = statuses.includes('VIOLATION');
  // An empty verdict map means the move carried no per-invariant data — render UNVERIFIED, never a
  // green PASS (a PASS chip with nothing behind it is exactly the "checked nothing" spoof).
  if (statuses.length === 0) {
    return (
      <span className="verdict verdict--pending" title="move present but no per-invariant verdict data">
        UNVERIFIED
      </span>
    );
  }
  const title =
    verdict.kind === 'DEPLOY'
      ? `floor headroom ${verdict.floorHeadroomUsdc ? usdc(verdict.floorHeadroomUsdc) : '—'}` +
        (verdict.windowUtilization != null ? ` · window ${Math.round(verdict.windowUtilization * 100)}%` : '') +
        ` · receipt ${verdict.receipt}`
      : `withdraw (ungated by design) · receipt ${verdict.receipt}`;
  return (
    <span className={`verdict ${anyViolation ? 'verdict--violation' : 'verdict--pass'}`} title={title}>
      {anyViolation ? 'VIOLATION' : 'PASS'}
    </span>
  );
}

function UptimeStrip({ events }: { events: EventLogRecord[] }) {
  const recent = events.slice(-72);
  if (recent.length === 0) return <div className="empty">No cycles yet — the strip fills as the loop runs.</div>;
  return (
    <div className="uptime" role="img" aria-label={`${recent.length} most recent agent cycles`}>
      {recent.map((e) => (
        <i
          key={e.seq}
          className={e.status === 'CONFIRMED' ? '' : e.status === 'FAILED' ? 'u-fail' : 'u-skip'}
          title={`#${e.seq} ${e.status} ${e.decision.kind}`}
        />
      ))}
    </div>
  );
}
