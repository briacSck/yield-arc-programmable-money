'use client';

import { useMemo, useState } from 'react';
import type { ForecastResult } from '@yield/shared';
import type { EventsResponse, MoveVerdictDto } from '../src/api-contract';
import {
  agentActivity,
  allocation,
  APPETITE_BUDGET_PCT,
  coverage,
  dayMonth,
  deployableUnder,
  whatIf,
  type AgentAction,
  type YieldAppetite,
} from '../lib/owner';
import type { OwnerActionName, OwnerActionResponse } from '../lib/owner-action';
import { DEMO_CLIENT, DEMO_SCALE, SIM_SCALE, eur, eurFrom, eurToUnits, toEur } from '../lib/scale';
import { ARCSCAN, REPO_URL, shortHash, usdc, when } from '../lib/format';

/**
 * One id per CLICK. The worker turns it into the Circle idempotency key, so a retried click is one
 * transaction and two clicks are two — the browser decides which of those it is, not the network.
 */
function newRequestId(): string {
  const c = globalThis.crypto;
  return typeof c?.randomUUID === 'function'
    ? c.randomUUID().replace(/-/g, '')
    : `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

/** The mandate snapshot is read from chain with a ~15s cache — a refresh right after a write can still show the old state. */
const CHAIN_CATCHUP_MS = 16_000;

/** Where the owner's passphrase lives in THIS browser. Never sent anywhere but /api/owner. */
const OWNER_PASS_KEY = 'yield.ownerPass';

/**
 * The owner's screen — one screen, not a mode.
 *
 * A CEO does not "pause" his CFO. He gives him a brief and constraints, and the CFO turns that into
 * a plan and executes it. So the surface is: the answer, the brief that shapes it, the question an
 * owner actually asks ("can I afford this?"), and what the agent did — where every line drills, in
 * place, down to the hash and the transaction that prove it.
 *
 * Progressive disclosure, not a toggle: an accountant does not want a different screen, they want
 * the same number with its provenance attached.
 */
export function OwnerMode({
  data,
  demo = false,
  onJumpToEvidence,
  onRefresh,
}: {
  data: EventsResponse;
  /**
   * ?demo=90d replay. Owner ACTIONS are disabled — they POST to the real worker and would move
   * real on-chain state from inside a synthetic replay. The brief slider and the what-if stay
   * interactive: they are pure previews over the sim's current-day data, and that interactivity
   * is exactly what makes the demo the product rather than a slideshow.
   */
  demo?: boolean;
  onJumpToEvidence: () => void;
  /** Re-read the feed after an owner action lands. */
  onRefresh?: () => void;
}) {
  const { mandate, events, latestForecast, audit, stats } = data;
  const forecast = latestForecast?.forecast ?? null;
  const revoked = mandate?.revoked ?? false;

  // The euro lens. Live: testnet USDC at 1:3800 (the stated demo-ledger ratio). ?demo=90d: the sim
  // runs the persona at FULL business scale (€1 reads 1:1 as USDC — scenario/src/sim.ts), so the
  // live ratio would print an €83M floor for a bakery. One scale, chosen once, used everywhere.
  const scale = demo ? SIM_SCALE : DEMO_SCALE;
  const eurAt = (v: string | bigint, o: { cents?: boolean } = {}) => eurFrom(v, { ...o, scale });

  // The brief is local until applied: moving a slider must never move money.
  const [floorEur, setFloorEur] = useState<number | null>(null);
  // Same pattern as the floor: null until touched, so the radio always reflects what the AGENT
  // is actually running (from /events) until the owner picks something new — then "Apply" sends it.
  const [appetiteChoice, setAppetiteChoice] = useState<YieldAppetite | null>(null);
  const appliedAppetite: YieldAppetite = data.appetite ?? 'opportunistic';
  const appetite = appetiteChoice ?? appliedAppetite;
  const appetiteDirty = appetiteChoice !== null && appetiteChoice !== appliedAppetite;

  // ── Owner controls ────────────────────────────────────────────────────────────────────────
  // These write to the mandate for real, through /api/owner → the worker → the company wallet.
  // Three states are visible at all times: pending (nothing else can be clicked), the transaction
  // when it lands, and the failure IN FULL when it does not. A silent failure on this screen would
  // tell an owner their agent is paused when it is not — the one lie this product cannot afford.
  const [pending, setPending] = useState<OwnerActionName | null>(null);
  const [confirmingPause, setConfirmingPause] = useState(false);
  // Both are tagged with the action they belong to, so a failed pause can never render as a red
  // line under the floor slider (or the reverse).
  const [actionError, setActionError] = useState<{ action: OwnerActionName; message: string } | null>(null);
  const [lastAction, setLastAction] = useState<{ action: OwnerActionName; txHash: string; explorerUrl: string } | null>(
    null,
  );

  async function runOwnerAction(action: OwnerActionName, extra: Record<string, string> = {}) {
    // ?demo=90d replays a synthetic history — an owner action fired from inside it would still hit
    // the REAL worker (and, for appetite, rewrite the live agent's brief). Refuse at the choke
    // point every action funnels through, whatever the buttons render.
    if (demo || pending) return;
    setPending(action);
    setActionError(null);
    setLastAction(null);
    try {
      // The owner proves it is them. Held in this browser only; compared on the server, so it is
      // never in the page source. Without this the proxy would attach the worker secret for ANY
      // caller — a public URL that pauses a live agent.
      let pass = window.localStorage.getItem(OWNER_PASS_KEY) ?? '';
      if (!pass) {
        pass = (
          window.prompt(
            action === 'appetite'
              ? 'Owner passphrase — this changes how your agent works your cash.'
              : 'Owner passphrase — this action moves real money on-chain.',
          ) ?? ''
        ).trim();
        if (!pass) {
          setPending(null);
          return;
        }
        window.localStorage.setItem(OWNER_PASS_KEY, pass);
      }

      const res = await fetch('/api/owner', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-owner-pass': pass },
        body: JSON.stringify({ action, requestId: newRequestId(), ...extra }),
      });
      // A rejected passphrase must not stay cached, or every later click fails silently.
      if (res.status === 401) window.localStorage.removeItem(OWNER_PASS_KEY);
      const body = (await res.json().catch(() => ({}))) as OwnerActionResponse;
      if (!res.ok || !body.ok) {
        throw new Error(body.error || `the request failed (HTTP ${res.status})`);
      }
      setLastAction({
        action,
        txHash: body.txHash ?? '',
        explorerUrl: body.explorerUrl ?? (body.txHash ? `${ARCSCAN}/tx/${body.txHash}` : ''),
      });
      // The slider deliberately stays where the owner put it. Snapping it back to the chain value
      // would show them the OLD floor for the ~15s the read is cached, right under the words "your
      // floor is set". Instead the "Apply" affordance disappears by itself once the chain agrees.
      onRefresh?.();
      // The mandate read is cached ~15s upstream; one more refresh so the screen ends up truthful
      // without the owner having to reload. (Appetite is a worker-side file, not a chain read —
      // the first refresh already sees it.)
      if (action !== 'appetite') setTimeout(() => onRefresh?.(), CHAIN_CATCHUP_MS);
    } catch (err) {
      setActionError({ action, message: (err as Error).message });
    } finally {
      setPending(null);
      setConfirmingPause(false);
    }
  }

  const mandateFloorEur = mandate ? Math.round(toEur(mandate.floorUsdc, scale)) : 0;
  const effectiveFloorEur = floorEur ?? mandateFloorEur;
  const effectiveFloorUnits = eurToUnits(effectiveFloorEur, scale);
  const briefDirty = floorEur !== null && floorEur !== mandateFloorEur;

  const cover = useMemo(() => coverage(forecast, effectiveFloorUnits), [forecast, effectiveFloorUnits]);
  const actions = agentActivity(events);

  // The worst point the forecast reaches. The agent guards against this as well as the floor, so
  // the allocation bar must too — otherwise it shows money as "spare" that the brief refuses to
  // deploy, and the two numbers sit side by side contradicting each other.
  const projectedLow = cover.tightest
    ? BigInt(effectiveFloorUnits) + cover.tightest.marginBaseUnits
    : null;

  const alloc = mandate
    ? allocation(mandate.companyBalanceUsdc, mandate.deployedUsdc, effectiveFloorUnits, projectedLow)
    : null;
  // The REAL semantic, previewed: min(headroom above the guard, appetite% of the remaining daily
  // budget, per-ticket cap) — the same arithmetic the worker feeds its engine, so this number is
  // the one the agent would actually use.
  const wouldDeploy = mandate
    ? deployableUnder(mandate.companyBalanceUsdc, effectiveFloorUnits, projectedLow, appetite, mandate)
    : 0n;

  return (
    <>
      {/* ── The answer ────────────────────────────────────────────────── */}
      <section className="owner-hero">
        <div>
          <div className="eyebrow">
            {/* In the replay "as of" is the SIMULATED day, never the wall clock — today's date over
                a seeded ledger would claim a history that did not happen today. */}
            Position as of{' '}
            {(demo && stats.lastCycleAt ? new Date(stats.lastCycleAt) : new Date()).toLocaleDateString('en-GB', {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
              ...(demo ? { timeZone: 'UTC' } : {}),
            })}
            {demo && ' (simulated)'}
            {' · '}
            {DEMO_CLIENT} <span className="owner-modelled">modelled client</span>
          </div>

          <h1 className="owner-answer">
            {revoked ? (
              <>Your agent is paused.</>
            ) : cover.coveredThrough ? (
              <>You&apos;re covered through {dayMonth(cover.coveredThrough)}.</>
            ) : (
              <>Watching your cash.</>
            )}
          </h1>

          <p className="owner-sub">
            {revoked ? (
              <>
                It will not move any money. Anything already working for you can still come back to
                your account. Restart it whenever you like.
              </>
            ) : cover.tightest && cover.tightest.marginBaseUnits >= 0n ? (
              <>
                At the tightest point ({dayMonth(cover.tightest.date)}) you&apos;d still have{' '}
                <strong>{eurAt(cover.tightest.marginBaseUnits)}</strong> above your safety floor,
                even if things go badly.
              </>
            ) : cover.tightest ? (
              <>
                Around {dayMonth(cover.tightest.date)} your cash could dip{' '}
                <strong>{eurAt(-cover.tightest.marginBaseUnits)}</strong> below your safety floor.
                Your agent is holding money back rather than putting it to work.
              </>
            ) : (
              <>Your agent is building its first forecast.</>
            )}
          </p>
        </div>

        <div className="owner-total">
          <div className="label">Total cash</div>
          <div className="owner-total__num">{alloc ? eurAt(alloc.total) : '—'}</div>
          <div className="owner-total__note">
            {alloc && alloc.working > 0n
              ? `${eurAt(alloc.working)} of it is set aside with your agent`
              : 'none of it is set aside right now'}
          </div>
        </div>
      </section>

      {alloc && (
        <section className="card owner-alloc">
          <AllocationBar alloc={alloc} scale={scale} />
        </section>
      )}

      {/* ── The brief: what the owner tells the agent ─────────────────── */}
      <section className="card owner-brief">
        <div className="section__head">
          <h2>Your brief</h2>
          <span className="eyebrow">what you tell your agent — it does the rest</span>
        </div>

        <div className="brief-grid">
          <div>
            <label className="label" htmlFor="floor">Never go below</label>
            <div className="brief-floor">
              <input
                id="floor"
                type="range"
                min={Math.max(1000, Math.round(mandateFloorEur * 0.2))}
                max={Math.round(mandateFloorEur * 2.5) || 50000}
                step={500}
                value={effectiveFloorEur}
                onChange={(e) => setFloorEur(Number(e.target.value))}
              />
              <div className="brief-floor__num">{eur(effectiveFloorEur)}</div>
            </div>
            <p className="owner-card__note">
              The hard limit your agent can never cross. Enforced by the contract itself, not by us.
            </p>
          </div>

          <div>
            <span className="label">How hard should it work your cash?</span>
            <div className="appetite">
              {(['conservative', 'balanced', 'opportunistic'] as const).map((a) => (
                <button
                  key={a}
                  className={`appetite__btn ${appetite === a ? 'appetite__btn--on' : ''}`}
                  onClick={() => setAppetiteChoice(a)}
                  disabled={pending !== null}
                  aria-pressed={appetite === a}
                >
                  {a}
                </button>
              ))}
            </div>
            <p className="owner-card__note">
              A preference, never a licence: this can only make your agent more cautious than your
              floor already requires — it caps each cycle at{' '}
              {APPETITE_BUDGET_PCT[appetite]}% of the daily budget your mandate allows.
            </p>
            {appetiteDirty && (
              <div className="brief-apply">
                <button
                  className="btn btn--primary"
                  disabled={demo || pending !== null}
                  title={demo ? 'Not available in the simulation — this button changes the real agent' : undefined}
                  onClick={() => void runOwnerAction('appetite', { appetite: appetiteChoice! })}
                >
                  {pending === 'appetite' ? 'Telling your agent…' : `Apply — tell my agent to be ${appetiteChoice}`}
                </button>
                <button className="linklike" onClick={() => setAppetiteChoice(null)} disabled={pending !== null}>
                  reset
                </button>
                <div className="owner-controls__note owner-controls__note--wide">
                  {demo
                    ? 'Preview only in the simulation — Apply is disabled because it would send a brief to the REAL live agent.'
                    : 'Previewing only. Applying sends this brief to your agent — no transaction, nothing moves now; it shapes how much your agent may commit from its next cycle on.'}
                </div>
              </div>
            )}
            <ActionFeedback
              error={actionError?.action === 'appetite' ? actionError.message : null}
              result={lastAction?.action === 'appetite' ? lastAction : null}
              successCopy={`Your agent has the brief. From its next cycle it commits at most ${APPETITE_BUDGET_PCT[appetite]}% of its daily budget — your floor is untouched.`}
              failureCopy="Your agent's appetite is UNCHANGED."
            />
          </div>

          <div className="brief-outcome">
            <div className="label">Under this brief, right now</div>
            <div className="brief-outcome__num">{eurAt(wouldDeploy)}</div>
            <div className="owner-card__note">
              would be put to work, keeping {eur(effectiveFloorEur)} untouchable and respecting the
              worst case your forecast allows for.
            </div>
            {briefDirty && (
              <div className="brief-apply">
                <button
                  className="btn btn--primary"
                  disabled={demo || !mandate || pending !== null}
                  title={demo ? 'Not available in the simulation — this button moves real money' : undefined}
                  onClick={() => void runOwnerAction('floor', { floorUsdc: effectiveFloorUnits })}
                >
                  {pending === 'floor' ? 'Setting your floor…' : `Apply — set my floor to ${eur(effectiveFloorEur)}`}
                </button>
                <button className="linklike" onClick={() => setFloorEur(null)} disabled={pending !== null}>
                  reset
                </button>
                <div className="owner-controls__note owner-controls__note--wide">
                  {demo
                    ? 'Preview only in the simulation — Apply is disabled because it would write to the REAL mandate on-chain.'
                    : 'Previewing only. Applying writes a real transaction to your mandate on-chain — from then on the contract itself refuses anything that would cross it.'}
                </div>
              </div>
            )}
            <ActionFeedback
              error={actionError?.action === 'floor' ? actionError.message : null}
              result={lastAction?.action === 'floor' ? lastAction : null}
              successCopy="Your floor is set. Your agent cannot go below it — the contract refuses it."
              failureCopy="Your floor was NOT changed. Nothing moved."
            />
          </div>
        </div>
      </section>

      {/* ── The question an owner actually asks ───────────────────────── */}
      <WhatIf forecast={forecast} floorUnits={effectiveFloorUnits} scale={scale} />

      {/* ── What the agent did, drillable in place ────────────────────── */}
      <section className="owner-activity">
        <div className="section__head">
          <h2>What your agent did</h2>
          <span className="eyebrow">click any line for the proof</span>
        </div>
        {actions.length === 0 ? (
          <p className="owner-empty">
            Nothing needed doing yet. Your agent checks your position every cycle and only moves
            money when it changes what you can safely set aside.
          </p>
        ) : (
          <ul className="owner-actions">
            {actions.map((a) => (
              <ActivityRow
                key={a.seq}
                action={a}
                demo={demo}
                scale={scale}
                verdict={a.txHash ? audit?.verdictsByTxHash[a.txHash.toLowerCase()] ?? null : null}
              />
            ))}
          </ul>
        )}
      </section>

      {/* ── Controls ──────────────────────────────────────────────────── */}
      <section className="owner-controls card">
        <div>
          <div className="label">You are always in control</div>
          <div className="owner-controls__floor">{revoked ? 'Paused' : 'Working'}</div>
          <div className="owner-card__note">
            Stopping is free and instant. Anything already working for you can still come home — your
            agent can never block that, even while paused.
          </div>
        </div>
        <div className="owner-controls__actions">
          {confirmingPause ? (
            <div className="owner-confirm">
              <div className="owner-confirm__q">Pause your agent?</div>
              <p className="owner-confirm__body">
                It stops moving your money straight away. Anything already working for you can still
                come back to your account — pausing can never block that. You can restart it whenever
                you like.
              </p>
              <div className="owner-confirm__row">
                <button className="btn btn--primary" onClick={() => void runOwnerAction('pause')} disabled={pending !== null}>
                  {pending === 'pause' ? 'Pausing…' : 'Yes, pause it'}
                </button>
                <button className="linklike" onClick={() => setConfirmingPause(false)} disabled={pending !== null}>
                  not now
                </button>
              </div>
            </div>
          ) : (
            <button
              className="btn"
              disabled={demo || pending !== null}
              title={demo ? 'Not available in the simulation — this button moves real money' : undefined}
              onClick={() => (revoked ? void runOwnerAction('resume') : setConfirmingPause(true))}
            >
              {pending === 'resume' ? 'Restarting…' : revoked ? 'Restart my agent' : 'Pause my agent'}
            </button>
          )}
          <div className="owner-controls__note">
            {demo
              ? 'Disabled in the simulation: this button pauses the REAL agent with a real on-chain transaction. In the replay, watch the owner do it — the mandate blocks the agent on the day it happens.'
              : 'Runs as a real transaction on your mandate, signed by your company wallet. In this demo it is protected by a shared secret rather than a wallet sign-in.'}
          </div>
          <ActionFeedback
            error={
              actionError && (actionError.action === 'pause' || actionError.action === 'resume')
                ? actionError.message
                : null
            }
            result={
              lastAction && (lastAction.action === 'pause' || lastAction.action === 'resume') ? lastAction : null
            }
            successCopy={
              lastAction?.action === 'pause'
                ? 'Paused on-chain. Your agent can no longer put money to work; what is already working can still come home.'
                : 'Restarted on-chain. Your agent is working for you again.'
            }
            failureCopy="Your agent's status is UNCHANGED. Check the mandate on arcscan before trying again."
          />
        </div>
      </section>

      <p className="owner-trust">
        {demo ? (
          <>
            In the live product every move is recorded publicly and can be checked by anyone — these
            simulated moves are not.{' '}
          </>
        ) : (
          <>
            Every move your agent makes is recorded publicly and can be checked by anyone, including
            your accountant.{' '}
          </>
        )}
        <button className="linklike" onClick={onJumpToEvidence}>
          See the full record →
        </button>
      </p>
    </>
  );
}

/**
 * What happened, in the owner's words, with the proof attached.
 *
 * A failure is stated as a FACT about their money ("your agent's status is unchanged"), not as a
 * UI apology, and the machine's own error text is shown verbatim underneath rather than smoothed
 * over — on a screen whose entire claim is that it reports rather than reassures, a swallowed
 * error is the worst possible bug.
 */
function ActionFeedback({
  error,
  result,
  successCopy,
  failureCopy,
}: {
  error: string | null;
  result: { txHash: string; explorerUrl: string } | null;
  successCopy: string;
  failureCopy: string;
}) {
  if (error) {
    return (
      <div className="owner-actionmsg owner-actionmsg--fail" role="alert">
        <strong>{failureCopy}</strong>
        <span className="owner-actionmsg__detail">{error}</span>
      </div>
    );
  }
  if (!result) return null;
  return (
    <div className="owner-actionmsg owner-actionmsg--ok" role="status">
      <strong>{successCopy}</strong>
      {result.txHash && (
        <span className="owner-actionmsg__detail">
          <a href={result.explorerUrl} target="_blank" rel="noreferrer">
            {shortHash(result.txHash)} ↗
          </a>{' '}
          — the screen catches up within about 15 seconds.
        </span>
      )}
    </div>
  );
}

/** "Can I afford this?" — the question no SME tool answers with a plan behind it. */
function WhatIf({
  forecast,
  floorUnits,
  scale,
}: {
  forecast: ForecastResult | null;
  floorUnits: string;
  /** Euro↔USDC lens — the live 1:3800 ratio, or 1:1 in the full-scale demo replay. */
  scale: number;
}) {
  const [monthlyEur, setMonthlyEur] = useState(0);
  const monthlyUnits = BigInt(eurToUnits(monthlyEur, scale));
  const result = useMemo(() => whatIf(forecast, floorUnits, monthlyUnits), [forecast, floorUnits, monthlyUnits]);
  const presets = [1500, 3000, 5000];

  return (
    <section className="card owner-whatif">
      <div className="section__head">
        <h2>Can I afford it?</h2>
        <span className="eyebrow">a new hire, a machine, a rent increase</span>
      </div>
      <div className="whatif-controls">
        {presets.map((p) => (
          <button
            key={p}
            className={`appetite__btn ${monthlyEur === p ? 'appetite__btn--on' : ''}`}
            onClick={() => setMonthlyEur(monthlyEur === p ? 0 : p)}
          >
            {eur(p)}/month
          </button>
        ))}
        {monthlyEur > 0 && (
          <button className="linklike" onClick={() => setMonthlyEur(0)}>
            clear
          </button>
        )}
      </div>
      <p className="whatif-answer">
        {monthlyEur === 0 ? (
          <span className="owner-card__note">
            Pick a commitment and your agent will tell you what it does to your runway — using the
            same forecast it makes its own decisions on.
          </span>
        ) : result.coveredWholeHorizon ? (
          <>
            <strong>Yes.</strong> Taking on {eur(monthlyEur)}/month, you stay above your safety floor
            for the whole forecast
            {result.tightest ? (
              <> — with {eurFrom(result.tightest.marginBaseUnits, { scale })} to spare at the tightest point.</>
            ) : (
              '.'
            )}
          </>
        ) : result.tightest ? (
          <>
            <strong>Not yet.</strong> At {eur(monthlyEur)}/month you&apos;d go{' '}
            {eurFrom(-result.tightest.marginBaseUnits, { scale })} below your safety floor around{' '}
            {dayMonth(result.tightest.date)}
            {result.coveredThrough ? <> — you&apos;re fine until {dayMonth(result.coveredThrough)}.</> : '.'}
          </>
        ) : (
          <span className="owner-card__note">Not enough forecast to answer that yet.</span>
        )}
      </p>
    </section>
  );
}

/**
 * One thing the agent did. Collapsed it is a sentence a baker reads; expanded it is the decision
 * record, the committed forecast hash, the machine verdict and the transaction. Same object, two
 * depths — which is the whole argument of this product in one interaction.
 */
function ActivityRow({
  action,
  demo,
  scale,
  verdict,
}: {
  action: AgentAction;
  /** ?demo=90d: the "transaction" is a sim id — plain text, labelled, never an arcscan href. */
  demo: boolean;
  /** Euro↔USDC lens — the live 1:3800 ratio, or 1:1 in the full-scale demo replay. */
  scale: number;
  verdict: MoveVerdictDto | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <li className={`owner-action ${open ? 'owner-action--open' : ''}`}>
      <button className="owner-action__trigger" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="owner-action__head">
          <span className="owner-action__what">
            <span className="owner-action__caret">{open ? '▾' : '▸'}</span> {action.headline}
          </span>
          <span className="owner-action__amt">{eurFrom(action.amountBaseUnits, { scale })}</span>
        </span>
        <span className="owner-action__meta">{demo ? dayMonth(action.at.slice(0, 10)) : when(action.at)}</span>
      </button>

      {open && (
        <div className="drill">
          <p className="drill__reason">{action.reason}</p>
          <dl className="drill__facts">
            <dt>{demo ? 'Simulated amount' : 'On-chain amount'}</dt>
            <dd>{usdc(action.amountBaseUnits)}</dd>
            <dt>Action</dt>
            <dd>{action.kind}</dd>
            {action.txHash && (
              <>
                <dt>{demo ? 'Simulated move id' : 'Transaction'}</dt>
                <dd>
                  {demo ? (
                    // Never an explorer href: this id exists only inside the seeded replay.
                    <span className="mono demo-simtx" title="simulated move — no on-chain transaction exists">
                      {action.txHash} · simulated
                    </span>
                  ) : (
                    <a href={`${ARCSCAN}/tx/${action.txHash}`} target="_blank" rel="noreferrer">
                      {shortHash(action.txHash)} ↗
                    </a>
                  )}
                </dd>
              </>
            )}
            <dt>Checked against the mandate</dt>
            <dd>
              {verdict ? (
                Object.entries(verdict.perInvariant).map(([k, v]) => (
                  <span key={k} className={`drill__chip ${v === 'PASS' ? 'drill__chip--pass' : 'drill__chip--flag'}`}>
                    {k} {v}
                  </span>
                ))
              ) : (
                <span className="owner-card__note">
                  {demo
                    ? 'simulated — the nightly audit only ever checks the live agent'
                    : 'awaiting the next nightly audit'}
                </span>
              )}
            </dd>
          </dl>
          {/* The command printed here MUST be one that runs on a machine that has never seen this
              repo. `npx -y @yield-cfo/mandate-verify` does not: the package is not published yet,
              so it 404s for everyone. It reads as working from inside the repo only because npx
              resolves the workspace symlink first. Swap it back the moment publish lands. */}
          <p className="drill__verify">
            {demo ? (
              <>Nothing to verify here: this move settled nowhere. The live agent&apos;s record is the one the verifier checks.</>
            ) : (
              <>
                Check it yourself, against the chain, not against us:{' '}
                <code>git clone {REPO_URL} && cd yield-arc-programmable-money && npm install && npx tsx verifier/src/cli.ts</code>
              </>
            )}
          </p>
        </div>
      )}
    </li>
  );
}

function AllocationBar({
  alloc,
  scale,
}: {
  alloc: ReturnType<typeof allocation>;
  /** Euro↔USDC lens — the live 1:3800 ratio, or 1:1 in the full-scale demo replay. */
  scale: number;
}) {
  const total = Number(alloc.total);
  const pct = (v: bigint) => (total === 0 ? 0 : (Number(v) / total) * 100);
  const segments = [
    { key: 'reserved', label: 'Safety floor', value: alloc.reserved, cls: 'seg--reserved' },
    { key: 'held', label: 'Held for what’s coming', value: alloc.heldForForecast, cls: 'seg--held' },
    { key: 'spare', label: 'Spare', value: alloc.spare, cls: 'seg--spare' },
    // "Set aside", not "working": until the yield venue is wired (v2 awaits its allowlist role),
    // this pool is escrowed and earns nothing. The word must not claim what the money does not do.
    { key: 'working', label: 'Set aside', value: alloc.working, cls: 'seg--working' },
  ];
  return (
    <>
      <div className="allocbar">
        {segments.map((s) =>
          s.value > 0n ? (
            <div key={s.key} className={`allocbar__seg ${s.cls}`} style={{ width: `${pct(s.value)}%` }} />
          ) : null,
        )}
      </div>
      <div className="alloclegend">
        {segments.map((s) => (
          <span key={s.key} className="alloclegend__item">
            <span className={`alloclegend__dot ${s.cls}`} />
            {s.label} <strong>{eurFrom(s.value, { scale })}</strong>
          </span>
        ))}
      </div>
    </>
  );
}
