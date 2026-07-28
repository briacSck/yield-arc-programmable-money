import type { EventsResponse } from '../src/api-contract';
import { agentActivity, allocation, coverage, dayMonth } from '../lib/owner';
import { DEMO_CLIENT, eurFrom } from '../lib/scale';
import { when } from '../lib/format';

/**
 * Owner mode — the screen for the person whose money this is.
 *
 * She has never heard of a mandate, a receipt hash or an invariant, and she should not need to.
 * The questions, in the order she asks them: do I make payroll · what is my cash doing · what did
 * my agent do · can I stop it.
 *
 * Everything here is DERIVED (see lib/owner.ts). Nothing is authored per event. Where a fact is not
 * available — earned-to-date, until the venue is wired — the screen says so rather than inventing a
 * number. On a product whose whole proposition is that its claims are checkable, a placeholder that
 * looks like data is the one unaffordable bug.
 */
export function OwnerMode({ data, onShowAdvanced }: { data: EventsResponse; onShowAdvanced: () => void }) {
  const { mandate, events, latestForecast } = data;
  const forecast = latestForecast?.forecast ?? null;
  const cover = coverage(forecast, mandate?.floorUsdc ?? null);
  const alloc = mandate
    ? allocation(mandate.companyBalanceUsdc, mandate.deployedUsdc, mandate.floorUsdc)
    : null;
  const actions = agentActivity(events);
  const revoked = mandate?.revoked ?? false;

  return (
    <>
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
            ) : cover.coveredWholeHorizon && cover.coveredThrough ? (
              <>You&apos;re covered through {dayMonth(cover.coveredThrough)}.</>
            ) : cover.coveredThrough ? (
              <>You&apos;re covered through {dayMonth(cover.coveredThrough)}.</>
            ) : (
              <>Watching your cash.</>
            )}
          </h1>

          <p className="owner-sub">
            {revoked ? (
              <>
                You paused it, so it will not move any money. Anything already working for you can
                still come back to your account. Restart it whenever you like.
              </>
            ) : cover.tightest && cover.tightest.marginBaseUnits >= 0n ? (
              <>
                At the tightest point ({dayMonth(cover.tightest.date)}) you&apos;d still have{' '}
                <strong>{eurFrom(cover.tightest.marginBaseUnits)}</strong> above your safety floor,
                even if things go badly.
              </>
            ) : cover.tightest ? (
              <>
                Careful: around {dayMonth(cover.tightest.date)} your cash could dip{' '}
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
          <div className="owner-total__num">
            {alloc ? eurFrom(alloc.total) : '—'}
          </div>
          {/* Earned-to-date is deliberately absent until the venue actually earns. See §6 of the
              product plan: `deployed` is an accounting entry today, so any number here would be a
              claim we cannot back. */}
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

      <section className="owner-cards">
        <div className="card owner-card">
          <div className="label">Your account</div>
          <div className="owner-card__num">{alloc ? eurFrom(alloc.inAccount) : '—'}</div>
          <div className="owner-card__note">
            {alloc ? (
              <>
                of which <strong>{eurFrom(alloc.reserved)}</strong> is your safety floor — your agent
                can never go below it
              </>
            ) : (
              'balance unavailable'
            )}
          </div>
        </div>

        <div className="card-ink owner-card">
          <div className="label owner-card__label-ink">Working for you</div>
          <div className="owner-card__num">{alloc ? eurFrom(alloc.working) : '—'}</div>
          <div className="owner-card__note owner-card__note-ink">
            Short-term US Treasury fund (USYC), settled on Arc.{' '}
            {alloc && alloc.spare > 0n
              ? `${eurFrom(alloc.spare)} more could be put to work.`
              : 'Nothing spare to put to work today.'}
          </div>
        </div>
      </section>

      <section className="owner-activity">
        <h2 className="section-title">What your agent did</h2>
        {actions.length === 0 ? (
          <p className="owner-empty">
            Nothing needed doing yet. Your agent checks your position every cycle and only moves money
            when it changes what you can safely set aside.
          </p>
        ) : (
          <ul className="owner-actions">
            {actions.map((a) => (
              <li key={a.seq} className="owner-action">
                <div className="owner-action__head">
                  <span className="owner-action__what">{a.headline}</span>
                  <span className="owner-action__amt">{eurFrom(a.amountBaseUnits)}</span>
                </div>
                <div className="owner-action__meta">{when(a.at)}</div>
                <div className="owner-action__why">{a.reason}</div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="owner-controls card">
        <div>
          <div className="label">Your safety floor</div>
          <div className="owner-controls__floor">{mandate ? eurFrom(mandate.floorUsdc) : '—'}</div>
          <div className="owner-card__note">
            Your agent can never take your account below this. You set it, and only you can change it.
          </div>
        </div>
        <div className="owner-controls__actions">
          <button className="btn" disabled title="Available once sign-in is enabled">
            Adjust my floor
          </button>
          <button className="btn" disabled title="Available once sign-in is enabled">
            {revoked ? 'Restart my agent' : 'Pause my agent'}
          </button>
          <div className="owner-controls__note">
            Sign-in required — these run as real on-chain transactions from your wallet.
          </div>
        </div>
      </section>

      <p className="owner-trust">
        Every move your agent makes is recorded publicly and can be checked by anyone — including
        your accountant.{' '}
        <button className="linklike" onClick={onShowAdvanced}>
          See the evidence →
        </button>
      </p>
    </>
  );
}

/** Where the money sits, as one bar. Reserved is a slice OF the account, not additional to it. */
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
