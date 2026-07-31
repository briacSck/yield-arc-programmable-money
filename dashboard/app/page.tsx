'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import type { EventLogRecord } from '@yield/shared';
import { defaultSimConfig, simulate } from '@yield/scenario';
import type { AuditBlock, MoveVerdictDto } from '../src/api-contract';
import type { EventsResponse } from '../src/api-contract';
import { ForecastCone } from '../components/ForecastCone';
import { OwnerMode } from '../components/OwnerMode';
import { demoEventsAt, isDemoRequested } from '../lib/demo';
import { ARCSCAN, REPO_URL, daysSince, shortHash, usdc, when } from '../lib/format';
import { dayMonth } from '../lib/owner';

const POLL_MS = 30_000;

/**
 * ONE screen, two feeds. The live path polls `/api/events`; `?demo=90d` replays the deterministic
 * 90-day scenario simulation CLIENT-SIDE through the SAME `Screen` — same OwnerMode, same cone,
 * same decision log. The demo is the product, not a mockup; what differs is loudly labelled
 * (amber banner, no audit verdicts, no explorer links, owner writes disabled).
 *
 * There was briefly a mode toggle here. It was the wrong shape: a toggle shows a reader two
 * products, when the argument of this one is that the plain sentence and the machine-checkable
 * record are the SAME object at two depths. An accountant does not want a different screen, they
 * want the same number with its provenance attached.
 */
export default function Page() {
  // The demo flag lives in the URL, and the URL lives in the browser — so it resolves after mount.
  // Until it does, render the same skeleton both paths start with: no flash of the wrong mode, and
  // the prerendered HTML stays mode-neutral.
  const [demo, setDemo] = useState<boolean | null>(null);
  useEffect(() => {
    setDemo(isDemoRequested(window.location.search));
  }, []);

  if (demo === null) return <main className="wrap"><div className="skeleton">loading the agent&apos;s record…</div></main>;
  return demo ? <DemoApp /> : <LiveApp />;
}

/** The live product: polls the one API route and renders the worker's record. */
function LiveApp() {
  const [data, setData] = useState<EventsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Hoisted out of the effect so an owner action can force an immediate re-read the moment its
  // transaction lands, instead of leaving the screen stale for up to a poll interval.
  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/events?limit=200', { cache: 'no-store' });
      if (!res.ok) throw new Error(`upstream ${res.status}`);
      const body = (await res.json()) as EventsResponse;
      setData(body);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  if (!data && !error) return <main className="wrap"><div className="skeleton">loading the agent&apos;s record…</div></main>;
  if (!data) {
    return (
      <main className="wrap">
        <Header revoked={false} agentId="" mode={null} demo={false} />
        <div className="empty">
          The agent&apos;s feed is unreachable right now ({error}). The on-chain record is unaffected —
          retrying automatically. Meanwhile,{' '}
          <a href="/?demo=90d">watch a full simulated quarter →</a> (client-side, needs no feed).
        </div>
      </main>
    );
  }

  return <Screen data={data} demo={false} onRefresh={() => void load()} />;
}

/** ~1 simulated day per second at 1×. */
const DEMO_TICK_MS = 1000;

/**
 * `?demo=90d`: the deterministic 90-day scenario, replayed inside the deployed product. The sim is
 * pure TypeScript (`@yield/scenario`) — it runs right here in the browser, no API route, no worker.
 * Honesty is structural: `demoEventsAt` never emits an audit block, an explorer URL or a chain
 * address, and the demo-aware components refuse owner writes and tx links.
 */
/** Camera-facing chapter names for the §11 beats, in scripted order. */
const BEAT_LABEL: Record<'deploy' | 'pullback' | 'exposure' | 'kicker', string> = {
  deploy: 'deploy',
  pullback: 'pull-back',
  exposure: 'exposure',
  kicker: 'kicker',
};

function DemoApp() {
  // Computed once per mount; deterministic, so every visitor watches the exact same quarter.
  const sim = useMemo(() => {
    const config = defaultSimConfig();
    return { config, ticks: simulate(config) };
  }, []);
  const total = sim.ticks.length;
  // The four scripted beats over the FULL run — the scrubber shows the whole quarter's chapters
  // up front (they are scripted, not spoilers; the labels are what makes 90s a guided tour).
  const beats = useMemo(
    () => sim.ticks.filter((t) => t.beat).map((t) => ({ day: t.day, beat: t.beat! })),
    [sim],
  );

  const [day, setDay] = useState(1);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState<1 | 8>(1);

  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => setDay((d) => (d < total ? d + 1 : d)), DEMO_TICK_MS / speed);
    return () => clearInterval(timer);
  }, [playing, speed, total]);

  // The replay ends HOLDING on the final day — the camera gets a stable closing frame.
  useEffect(() => {
    if (day >= total && playing) setPlaying(false);
  }, [day, total, playing]);

  const data = useMemo(() => demoEventsAt(sim.config, sim.ticks, day), [sim, day]);
  const restart = () => {
    setDay(1);
    setPlaying(true);
  };
  const atEnd = day >= total;
  const nextBeat = beats.find((b) => b.day > day) ?? null;

  /** Click-to-seek on the scrubber track (beats stopPropagation so their jump wins). */
  const seek = (e: ReactMouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1);
    setDay(Math.min(Math.max(Math.round(frac * (total - 1)) + 1, 1), total));
  };

  return (
    <Screen
      data={data}
      demo
      chrome={
        <div className="demo-chrome">
          {/* Persistent and unmissable, by design: sticky, full-width, amber, no dismissal. Any
              screenshot of this replay carries the disclosure with it. */}
          <div className="banner-demo" role="alert">
            {/* Same disclosure at two lengths: the full sentence on desktop, one line on phones —
                where the sticky chrome was eating half the viewport. The short form still names
                the simulation; the disclosure NEVER disappears. */}
            <span className="banner-demo__full">
              <strong>SYNTHETIC 90-DAY SIMULATION</strong> — seeded ledger, modelled mandate, simulated
              wheat index. Not YIELD&apos;s live history. <a href="/">watch the live agent →</a>
            </span>
            <span className="banner-demo__short">
              <strong>SYNTHETIC SIMULATION</strong> — not live history. <a href="/">live agent →</a>
            </span>
          </div>
          <div className="playbar" role="group" aria-label="Simulation playback controls">
            <button className="btn playbar__btn" onClick={() => (atEnd ? restart() : setPlaying(!playing))}>
              {playing ? 'Pause' : atEnd ? 'Replay' : 'Play'}
            </button>
            <button
              className="btn playbar__btn"
              onClick={() => setSpeed(speed === 1 ? 8 : 1)}
              title="playback speed"
            >
              {speed}×
            </button>
            <button className="btn playbar__btn" onClick={restart}>
              Restart
            </button>
            {/* The 90 seconds as a guided tour: the quarter's four scripted chapters are clickable
                tick-marks on the timeline, plus a next-beat skip. Chapters, not spoilers. */}
            <div className="scrub" onClick={seek} role="group" aria-label="Timeline — 90 simulated days with 4 chapter marks">
              <div className="scrub__track">
                <div className="scrub__fill" style={{ width: `${((day - 1) / (total - 1)) * 100}%` }} />
                {beats.map((b, i) => (
                  <button
                    key={b.beat}
                    className={`scrub__beat${day >= b.day ? ' scrub__beat--past' : ''}${sim.ticks[day - 1]!.beat === b.beat ? ' scrub__beat--now' : ''}`}
                    style={{ left: `${((b.day - 1) / (total - 1)) * 100}%` }}
                    title={`day ${b.day} — ${BEAT_LABEL[b.beat]}`}
                    aria-label={`jump to ${BEAT_LABEL[b.beat]}, day ${b.day}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setDay(b.day);
                    }}
                  >
                    {/* Alternate label rows so adjacent chapters (exposure → pull-back are days
                        apart) never overlap. */}
                    <span className={`scrub__beatlabel${i % 2 === 1 ? ' scrub__beatlabel--alt' : ''}`}>{BEAT_LABEL[b.beat]}</span>
                  </button>
                ))}
              </div>
            </div>
            <button
              className="btn playbar__btn"
              onClick={() => nextBeat && setDay(nextBeat.day)}
              disabled={!nextBeat}
              title={nextBeat ? `skip to ${BEAT_LABEL[nextBeat.beat]} (day ${nextBeat.day})` : 'no beats ahead'}
            >
              next beat ⏭
            </button>
            <span className="playbar__day mono">
              day {day}/{total}
            </span>
            {/* Restored by review: the pace hint was silently dropped with the scrubber's arrival.
                Phone CSS already hides it; on desktop it still answers "how fast is this?". */}
            <span className="playbar__hint">1 second ≈ {speed} simulated day{speed > 1 ? 's' : ''}</span>
          </div>
        </div>
      }
    />
  );
}

/**
 * The one screen both feeds render through. `demo` switches ONLY what honesty demands: labels that
 * would claim the chain ("on-chain decisions", arcscan links), wall-clock-relative timestamps, and
 * the audit fallbacks. The layout, components and derivations are identical — that is the point.
 */
function Screen({
  data,
  demo,
  onRefresh,
  chrome,
}: {
  data: EventsResponse;
  demo: boolean;
  onRefresh?: () => void;
  /** Demo-only sticky strip (banner + playback), rendered above everything. */
  chrome?: ReactNode;
}) {
  const revoked = data.mandate?.revoked ?? false;
  const revokedAt = useMemo(() => {
    if (!revoked) return null;
    // The revocation record may have scrolled out of the fetched window. Falling back to `now`
    // would state a time we do not know — the banner would read "revoked just now" forever, and
    // the cone would draw the marker at today. An unknown timestamp is reported as unknown.
    // (Matches the live worker's 'MandateRevoked' error and the sim's 'mandate revoked' note.)
    const rec = data.events.find((e) => e.error && /MandateRevoked|mandate revoked/.test(e.error));
    return rec?.loggedAt ?? null;
  }, [revoked, data]);

  const { stats, mandate, events, audit } = data;
  const moves = events.filter((e) => e.status === 'CONFIRMED');
  const running = daysSince(stats.firstOnChainMoveAt);
  const gasLow = mandate ? BigInt(mandate.agentGasWei) < 5n * 10n ** 16n : false;
  const auditViolations = audit ? audit.invariants.reduce((n, iv) => n + (iv.status === 'VIOLATION' ? 1 : 0), 0) : null;

  // The kicker flash (demo only): the moment the BLOCKED row enters the log, scroll it into view
  // and pulse it once — the thesis's punchline is currently the quietest pixel on screen. Fires
  // once per pass; a restart (day drops below the kicker) re-arms it.
  const kickerSeq = demo ? data.beats?.find((b) => b.beat === 'kicker')?.seq ?? null : null;
  const kickerVisible = kickerSeq !== null && stats.cycles >= kickerSeq;
  const [flashSeq, setFlashSeq] = useState<number | null>(null);
  const kickerArmed = useRef(true);
  useEffect(() => {
    if (!kickerVisible) {
      kickerArmed.current = true;
      setFlashSeq(null);
      return;
    }
    if (!kickerArmed.current) return;
    kickerArmed.current = false;
    setFlashSeq(kickerSeq);
    document.getElementById(`sim-row-${kickerSeq}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [kickerVisible, kickerSeq]);

  return (
    <main className="wrap">
      {chrome}
      <Header revoked={revoked} agentId={data.agentIdentityId} mode={data.schedulerMode} demo={demo} />

      {/* The 10-second answer for a cold visitor, above the owner surface: what this is, what
          bounds it, where the proof lives. The owner never needed it; a judge does. */}
      <p className="tagline">
        An autonomous CFO for a small business — it forecasts the cash, keeps the owner&apos;s
        safety floor, puts the surplus to work and pulls it back before payroll, bounded by an
        on-chain mandate it provably cannot exceed (Circle Wallets · Arc · machine-audited nightly).
        <span className="tagline__links">
          <a href={REPO_URL} target="_blank" rel="noreferrer">repo</a>
          {!demo && (
            <>
              {' · '}
              <a href={`${ARCSCAN}/address/${data.mandateAddress}`} target="_blank" rel="noreferrer">mandate contract</a>
              {' · '}
              <a href={`${REPO_URL}/tree/main/verifier`} target="_blank" rel="noreferrer">verifier</a>
              {' · '}
              <a href="/?demo=90d">90-day simulation</a>
            </>
          )}
          {demo && (
            <>
              {' · '}
              <a href="/">the live agent</a>
            </>
          )}
        </span>
      </p>

      {revoked && (
        <div className="banner-revoked">
          {demo ? (
            <>
              The owner pulled the plug mid-quarter — and the mandate enforced it: the agent&apos;s
              next deposit was refused (the BLOCKED line in the log below). Money already set aside
              can still come back; the pause belongs to the owner, not the agent.
            </>
          ) : (
            <>
              You paused your agent. It cannot move money out of your account; anything already
              working for you can still come back. You can restart it whenever you like.
            </>
          )}
        </div>
      )}

      {/* ── The product: the owner's screen ───────────────────────────── */}
      <OwnerMode
        data={data}
        demo={demo}
        onJumpToEvidence={() => document.getElementById('evidence')?.scrollIntoView({ behavior: 'smooth' })}
        onRefresh={onRefresh}
      />

      {/*
        ── The evidence, on the SAME page ──────────────────────────────
        Not a separate mode. An accountant does not want a different screen, they want the same
        numbers with their provenance attached — so the record lives below the product, reachable
        by scrolling or by drilling into any single move above.
      */}
      <div id="evidence" className="evidence-divider">
        <h2>The full record</h2>
        <p className="owner-card__note">
          Everything above, in the units the chain actually settled and checked against the mandate
          the owner signed. This is what an accountant, an auditor or a judge reads.
        </p>
      </div>

      {/* Claim strip */}
      <section className="claim">
        <h1>
          {demo
            ? 'An autonomous CFO — a full simulated quarter, replayed through the real product.'
            : 'An autonomous CFO, running unattended on Arc.'}
        </h1>
        <div className="claim__stats">
          <div className="stat">
            {demo ? (
              <>
                <div className="stat__num">{stats.cycles}d</div>
                <div className="stat__label">simulated days replayed</div>
              </>
            ) : (
              <>
                <div className="stat__num">{running !== null ? `${running}d` : '—'}</div>
                <div className="stat__label">{stats.firstOnChainMoveAt ? 'on-chain since ' + stats.firstOnChainMoveAt.slice(0, 10) : 'awaiting first move'}</div>
              </>
            )}
          </div>
          <div className="stat">
            {/* Chain truth beats worker state. `stats.onChainMoves` is a counter on the worker's
                volume; it under-reported (5) against the chain (8) after the Jul 23 redeploy. On a
                page whose whole claim is "the chain is the record", the two must never disagree —
                so when the verifier has spoken, its count wins. */}
            <div className="stat__num">{audit ? audit.totalMoves : stats.onChainMoves}</div>
            <div className="stat__label">{demo ? 'simulated moves' : 'on-chain decisions'}</div>
          </div>
          <div className="stat">
            {demo ? (
              <>
                {/* Not a duplicate of "days replayed" (one cycle per sim day): the demo's third
                    number is the differentiator — how often the mandate refused the agent. */}
                <div className="stat__num">{events.filter((e) => e.status === 'FAILED' && /revok|mandate enforced/i.test(e.error ?? '')).length}</div>
                <div className="stat__label">deposits blocked by the mandate</div>
              </>
            ) : (
              <>
                <div className="stat__num">{stats.cycles}</div>
                <div className="stat__label">forecast cycles</div>
              </>
            )}
          </div>
          <div className="stat">
            {/* Hero wiring (§18.2): the page's first number is machine-attested when the nightly
                audit is reachable, and falls back to the honest static claim when it isn't. In demo
                mode there is NEVER an audit block — these moves were not verified by anything. */}
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
                <div className="stat__label">
                  {demo ? 'floor breaches (simulated mandate)' : 'floor breaches (enforced on-chain)'}
                </div>
              </>
            )}
          </div>
        </div>
      </section>

      {/* The ledger horizon */}
      <section className="section">
        <div className="section__head">
          {/* The header must state exactly what the chart shows in THIS mode: the demo replay now
              draws the full realized quarter + the horizon; live mode is still forward-looking
              with only recent markers. One wrong word here lands on camera. */}
          <h2>
            {demo
              ? 'The quarter so far, then the 30-day horizon — realized cash, P10–P90, safe floor, every move'
              : "30-day cash horizon — P10–P90, safe floor, and the agent's recent moves"}
          </h2>
          <span className="eyebrow">
            {demo
              ? data.latestForecast
                ? `simulated forecast — day ${stats.cycles}`
                : 'no forecast yet'
              : data.latestForecast
                ? `forecast ${when(data.latestForecast.loggedAt)}`
                : 'no forecast yet'}
          </span>
        </div>
        <ForecastCone
          forecast={data.latestForecast?.forecast ?? null}
          floorUsdc={mandate?.floorUsdc ?? null}
          moves={moves}
          revoked={revoked}
          revokedAt={revokedAt}
          history={data.history ?? null}
        />
      </section>

      {/* Machine-audit scoreboard (§18.2) — the 10-second camera surface. Renders only when the
          nightly verifier feed is reachable; its absence is silent, never red. Demo mode never has
          one: rendering PASS chips over simulated history would fabricate attested evidence. */}
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
              demo={demo}
              verdict={e.execution ? audit?.verdictsByTxHash[e.execution.txHash.toLowerCase()] ?? null : null}
              auditRunAt={audit?.runAt ?? null}
              id={demo ? `sim-row-${e.seq}` : undefined}
              flash={demo && flashSeq === e.seq}
            />
          ))
        )}
      </section>

      {/* Mandate + uptime */}
      <section className="section bottom">
        <div>
          <div className="section__head">
            <h2>{demo ? 'The mandate — modelled at contract fidelity (simulation)' : 'The mandate — an employment contract, on-chain'}</h2>
          </div>
          {mandate ? (
            <div className={`contract${revoked ? ' contract--revoked' : ''}`}>
              <dl>
                <dt>Company pool</dt>
                <dd>{usdc(mandate.companyBalanceUsdc)}</dd>
                {/* "Set aside", not "in yield": v1 escrows this pool, it does not earn. The
                    venue-aware v2 (0xd41d…2f70) has its USYC roles granted and venue set
                    (2026-07-31) but holds no position and is not this page's feed — this page
                    renders v1, so the vocabulary stays escrow. */}
                <dt>Set aside (escrow)</dt>
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
            <span className="eyebrow">
              {demo ? `sim day ${stats.cycles}` : `last cycle ${when(stats.lastCycleAt)}`}
            </span>
          </div>
          <UptimeStrip events={events} />
          <p className="empty" style={{ paddingTop: 12 }}>
            Each bar is one unattended cycle: sage moved money, grey held or observed, red failed
            loudly. A silent agent would show gaps — there are none.
          </p>
        </div>
      </section>

      <Footer data={data} demo={demo} />
    </main>
  );
}

/**
 * Shared by both modes. The scale note lives here and is stated ONCE: owner mode speaks euros at
 * the business's real scale, advanced mode speaks the USDC actually settled on-chain, and this line
 * is the stated relationship between them. In demo mode NOTHING here may link to a chain: the
 * replayed history settled nowhere, so the footer says so instead.
 */
function Footer({ data, demo }: { data: EventsResponse; demo: boolean }) {
  if (demo) {
    return (
      <footer className="footer">
        <span className="chip chip--warn">
          SYNTHETIC SIMULATION — Boulangerie Chartier&apos;s quarter, replayed from a seeded ledger
          at full business scale (€1 reads as 1 USDC). Nothing on this page settled on any chain.
        </span>
        <a href="/">watch the live agent →</a>
      </footer>
    );
  }
  return (
    <footer className="footer">
      <span className="chip">
        testnet demo · Boulangerie Chartier is a modelled client — real French-SME cash profile,
        settled on Arc at 1:3800. Every rule enforced at full fidelity; only the amounts are small.
      </span>
      <a href={`${ARCSCAN}/address/${data.mandateAddress}`} target="_blank" rel="noreferrer">
        mandate {shortHash(data.mandateAddress)}
      </a>
      <a href={`${ARCSCAN}/address/${data.agentAddress}`} target="_blank" rel="noreferrer">
        agent {shortHash(data.agentAddress)}
      </a>
      <a href={`${ARCSCAN}/address/${data.identityRegistry}`} target="_blank" rel="noreferrer">
        ERC-8004 registry
      </a>
      <a href="/?demo=90d">watch a simulated quarter →</a>
    </footer>
  );
}

function Header({
  revoked,
  agentId,
  mode,
  demo,
}: {
  revoked: boolean;
  agentId: string;
  mode: 'observe' | 'trade' | null;
  demo: boolean;
}) {
  return (
    <header className="header">
      <span className="brand">
        <span className="brand__mark" />
        YIELD
      </span>
      <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {demo && <span className="chip chip--warn">simulation</span>}
        <span className={`chip ${revoked ? 'chip--revoked' : 'chip--active'}`}>
          {revoked ? 'agent paused' : 'agent working'}
        </span>
        {agentId && <span className="chip">ERC-8004 agent #{agentId}</span>}
        {/* "trade mode" is worker vocabulary; on the sim replay it is hardcoded and meaningless,
            so the chip is live-only. */}
        {mode && !demo && <span className={`chip ${mode === 'trade' ? 'chip--active' : ''}`}>{mode} mode</span>}
        {!demo && (
          <a className="chip chip--link" href="/?demo=90d" title="the same product replaying a deterministic 90-day scenario, client-side">
            ▶ 90-day simulation
          </a>
        )}
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
            {/* Not the npm command: it is unpublished and 404s for anyone outside this repo. */}
            verify it yourself: <code>git clone {REPO_URL} && cd yield-arc-programmable-money && npm install && npx tsx verifier/src/cli.ts</code>
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
  demo,
  verdict,
  auditRunAt,
  id,
  flash,
}: {
  record: EventLogRecord;
  /** Demo replay: timestamps are sim dates, and a "move" has a sim id, never a tx link. */
  demo: boolean;
  verdict?: MoveVerdictDto | null;
  /** When the last nightly audit ran. Distinguishes "not yet audited" from "audited, no verdict". */
  auditRunAt?: string | null;
  /** Demo-only DOM anchor (`sim-row-<seq>`) so the kicker beat can auto-scroll to its row. */
  id?: string;
  /** One-shot pulse when this row is the kicker's BLOCKED move — sage, never red. */
  flash?: boolean;
}) {
  const { decision, status, execution } = record;
  const isMove = status === 'CONFIRMED';
  // A deposit refused because the owner revoked is NOT an ops failure — it is the mandate doing
  // exactly what it exists to do, and it is the demo's punchline. Red is reserved for verifier
  // VIOLATIONs and genuine failures (PLAN §18.2); this renders sage as "BLOCKED — mandate enforced".
  const isBlockedByMandate = status === 'FAILED' && /revok|mandate enforced/i.test(record.error ?? '');
  const isFailed = status === 'FAILED' && !isBlockedByMandate;
  const kindClass =
    isBlockedByMandate ? 'kind--blocked'
    : isFailed ? 'kind--failed'
    : decision.kind === 'DEPLOY' ? 'kind--deploy'
    : decision.kind === 'WITHDRAW' ? 'kind--withdraw'
    : decision.kind === 'FLOOR_RAISE' ? 'kind--floor'
    : 'kind--hold';
  // The verifier verdict SUPERSEDES the client-side receipt badge (two sources of truth must never
  // disagree on screen). The client check renders only past the coverage boundary, styled provisional.
  const receiptOk = execution ? execution.receiptHash === decision.forecastInputsHash : null;
  // PENDING vs UNVERIFIED must be distinguishable, and a block number cannot do it: `ExecutionResult`
  // carries none, so the old `auditThroughBlock && !verdict` test was truthiness only — it called
  // every unverdicted move PENDING, including ones the audit HAD scanned and simply not covered.
  // Compare against when the audit ran instead: executed after it ⇒ genuinely not yet audited.
  const pastCoverage = isMove && !verdict && !!auditRunAt && Date.parse(record.loggedAt) > Date.parse(auditRunAt);

  return (
    <div id={id} className={`log-row${isMove ? ' log-row--move' : ' log-row--quiet'}${flash ? ' log-row--flash' : ''}`}>
      {/* Sim rows read "14 May" like the owner surface, not raw ISO — one date language per page. */}
      <span className="log-row__ts">{demo ? dayMonth(record.loggedAt.slice(0, 10)) : when(record.loggedAt)}</span>
      <span className={`kind ${kindClass}`}>
        {isBlockedByMandate ? 'BLOCKED' : isFailed ? 'FAILED' : decision.kind}
        {isMove ? ` ${usdc(decision.amountUsdc)}` : ''}
      </span>
      <span className="log-row__reason">
        {isFailed && record.error ? `${decision.reason} — ${record.error}` : decision.reason}
        {decision.exposure && decision.kind === 'FLOOR_RAISE' && (
          <> ({decision.exposure.inputName} {decision.exposure.shockPct > 0 ? '+' : ''}{decision.exposure.shockPct}%)</>
        )}
      </span>
      <span className="log-row__links">
        {execution && demo ? (
          // The sim's move id is not a transaction. Plain text, labelled, never an explorer href —
          // and no receipt badge either: nothing checked this move, so nothing gets a checkmark.
          <span className="mono demo-simtx" title="simulated move — no on-chain transaction exists">
            {execution.txHash} · simulated
          </span>
        ) : execution ? (
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
        ) : null}
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
