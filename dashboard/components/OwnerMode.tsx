'use client';

import { useMemo, useState } from 'react';
import type { ForecastResult } from '@yield/shared';
import type { EventsResponse, MoveVerdictDto } from '../src/api-contract';
import {
  agentActivity,
  allocation,
  coverage,
  dayMonth,
  deployableUnder,
  whatIf,
  type AgentAction,
  type YieldAppetite,
} from '../lib/owner';
import { DEMO_CLIENT, DEMO_SCALE, eur, eurFrom, toEur } from '../lib/scale';
import { ARCSCAN, shortHash, usdc, when } from '../lib/format';

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
export function OwnerMode({ data, onJumpToEvidence }: { data: EventsResponse; onJumpToEvidence: () => void }) {
  const { mandate, events, latestForecast, audit } = data;
  const forecast = latestForecast?.forecast ?? null;
  const revoked = mandate?.revoked ?? false;

  // The brief is local until applied: moving a slider must never move money.
  const [floorEur, setFloorEur] = useState<number | null>(null);
  const [appetite, setAppetite] = useState<YieldAppetite>('balanced');

  const mandateFloorEur = mandate ? Math.round(toEur(mandate.floorUsdc)) : 0;
  const effectiveFloorEur = floorEur ?? mandateFloorEur;
  const effectiveFloorUnits = String(Math.round((effectiveFloorEur / DEMO_SCALE) * 1_000_000));
  const briefDirty = floorEur !== null && floorEur !== mandateFloorEur;

  const cover = useMemo(() => coverage(forecast, effectiveFloorUnits), [forecast, effectiveFloorUnits]);
  const alloc = mandate ? allocation(mandate.companyBalanceUsdc, mandate.deployedUsdc, effectiveFloorUnits) : null;
  const actions = agentActivity(events);

  const projectedLow = cover.tightest
    ? BigInt(effectiveFloorUnits) + cover.tightest.marginBaseUnits
    : null;
  const wouldDeploy = mandate
    ? deployableUnder(mandate.companyBalanceUsdc, effectiveFloorUnits, projectedLow, appetite)
    : 0n;

  return (
    <>
      {/* ── The answer ────────────────────────────────────────────────── */}
      <section className="owner-hero">
        <div>
          <div className="eyebrow">
            Position as of {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
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
                <strong>{eurFrom(cover.tightest.marginBaseUnits)}</strong> above your safety floor,
                even if things go badly.
              </>
            ) : cover.tightest ? (
              <>
                Around {dayMonth(cover.tightest.date)} your cash could dip{' '}
                <strong>{eurFrom(-cover.tightest.marginBaseUnits)}</strong> below your safety floor.
                Your agent is holding money back rather than putting it to work.
              </>
            ) : (
              <>Your agent is building its first forecast.</>
            )}
          </p>
        </div>

        <div className="owner-total">
          <div className="label">Total cash</div>
          <div className="owner-total__num">{alloc ? eurFrom(alloc.total) : '—'}</div>
          <div className="owner-total__note">
            {alloc && alloc.working > 0n
              ? `${eurFrom(alloc.working)} of it is working for you`
              : 'none of it is working for you right now'}
          </div>
        </div>
      </section>

      {alloc && (
        <section className="card owner-alloc">
          <AllocationBar alloc={alloc} />
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
                  onClick={() => setAppetite(a)}
                  aria-pressed={appetite === a}
                >
                  {a}
                </button>
              ))}
            </div>
            <p className="owner-card__note">
              A preference, never a licence: this can only make your agent more cautious than your
              floor already requires.
            </p>
          </div>

          <div className="brief-outcome">
            <div className="label">Under this brief, right now</div>
            <div className="brief-outcome__num">{eurFrom(wouldDeploy)}</div>
            <div className="owner-card__note">
              would be put to work, keeping {eur(effectiveFloorEur)} untouchable and respecting the
              worst case your forecast allows for.
            </div>
            {briefDirty && (
              <div className="brief-apply">
                <button className="btn btn--primary" disabled title="Sign-in required">
                  Apply — set my floor to {eur(effectiveFloorEur)}
                </button>
                <button className="linklike" onClick={() => setFloorEur(null)}>
                  reset
                </button>
                <div className="owner-controls__note">
                  Previewing only. Applying writes a real transaction to your mandate on-chain.
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ── The question an owner actually asks ───────────────────────── */}
      <WhatIf forecast={forecast} floorUnits={effectiveFloorUnits} />

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
          <button className="btn" disabled title="Sign-in required">
            {revoked ? 'Restart my agent' : 'Pause my agent'}
          </button>
          <div className="owner-controls__note">
            Sign-in required — this runs as a real on-chain transaction from your wallet.
          </div>
        </div>
      </section>

      <p className="owner-trust">
        Every move your agent makes is recorded publicly and can be checked by anyone, including your
        accountant.{' '}
        <button className="linklike" onClick={onJumpToEvidence}>
          See the full record →
        </button>
      </p>
    </>
  );
}

/** "Can I afford this?" — the question no SME tool answers with a plan behind it. */
function WhatIf({ forecast, floorUnits }: { forecast: ForecastResult | null; floorUnits: string }) {
  const [monthlyEur, setMonthlyEur] = useState(0);
  const monthlyUnits = BigInt(Math.round((monthlyEur / DEMO_SCALE) * 1_000_000));
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
              <> — with {eurFrom(result.tightest.marginBaseUnits)} to spare at the tightest point.</>
            ) : (
              '.'
            )}
          </>
        ) : result.tightest ? (
          <>
            <strong>Not yet.</strong> At {eur(monthlyEur)}/month you&apos;d go{' '}
            {eurFrom(-result.tightest.marginBaseUnits)} below your safety floor around{' '}
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
function ActivityRow({ action, verdict }: { action: AgentAction; verdict: MoveVerdictDto | null }) {
  const [open, setOpen] = useState(false);
  return (
    <li className={`owner-action ${open ? 'owner-action--open' : ''}`}>
      <button className="owner-action__trigger" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="owner-action__head">
          <span className="owner-action__what">
            <span className="owner-action__caret">{open ? '▾' : '▸'}</span> {action.headline}
          </span>
          <span className="owner-action__amt">{eurFrom(action.amountBaseUnits)}</span>
        </span>
        <span className="owner-action__meta">{when(action.at)}</span>
      </button>

      {open && (
        <div className="drill">
          <p className="drill__reason">{action.reason}</p>
          <dl className="drill__facts">
            <dt>On-chain amount</dt>
            <dd>{usdc(action.amountBaseUnits)}</dd>
            <dt>Action</dt>
            <dd>{action.kind}</dd>
            {action.txHash && (
              <>
                <dt>Transaction</dt>
                <dd>
                  <a href={`${ARCSCAN}/tx/${action.txHash}`} target="_blank" rel="noreferrer">
                    {shortHash(action.txHash)} ↗
                  </a>
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
                <span className="owner-card__note">awaiting the next nightly audit</span>
              )}
            </dd>
          </dl>
          <p className="drill__verify">
            Check it yourself, against the chain, not against us:{' '}
            <code>npx -y @yield-cfo/mandate-verify</code>
          </p>
        </div>
      )}
    </li>
  );
}

function AllocationBar({ alloc }: { alloc: ReturnType<typeof allocation> }) {
  const total = Number(alloc.total);
  const pct = (v: bigint) => (total === 0 ? 0 : (Number(v) / total) * 100);
  const segments = [
    { key: 'reserved', label: 'Safety floor', value: alloc.reserved, cls: 'seg--reserved' },
    { key: 'spare', label: 'Spare', value: alloc.spare, cls: 'seg--spare' },
    { key: 'working', label: 'Working', value: alloc.working, cls: 'seg--working' },
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
            {s.label} <strong>{eurFrom(s.value)}</strong>
          </span>
        ))}
      </div>
    </>
  );
}
