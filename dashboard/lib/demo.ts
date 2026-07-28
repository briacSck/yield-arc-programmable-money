import type { EventLogRecord } from '@yield/shared';
import type { SimConfig, SimTick } from '@yield/scenario';
import type { EventsResponse } from '../src/api-contract';

/**
 * ?demo=90d adapter — maps the pure scenario simulation (`@yield/scenario`) onto the exact
 * `EventsResponse` shape the page renders, so the 90-day replay flows through the SAME components
 * as the live agent. Pure and deterministic: same ticks + day in, byte-identical response out.
 *
 * HONESTY CONTRACT (violating any line here is worse than not shipping the demo):
 *   - `audit` is ALWAYS null. The nightly verifier never checked these moves; a PASS chip or a
 *     scoreboard over simulated history would be fabricated machine-attested evidence.
 *   - No explorer URL is ever emitted. `simTxId` is not a transaction; `explorerUrl` stays '' and
 *     the demo-aware UI renders the id as plain text labelled "simulated", never a link.
 *   - The chain identifiers (`agentAddress`, `mandateAddress`, …) are empty strings, so nothing in
 *     demo mode can even construct a link that implies this history touched Arc.
 */

/** True when the URL's query string asks for the 90-day demo replay. */
export function isDemoRequested(search: string): boolean {
  return new URLSearchParams(search).get('demo') === '90d';
}

/** Fixed, sane agent gas for the snapshot (0.25 — comfortably above the 0.05 low-gas warning). */
const DEMO_AGENT_GAS_WEI = '250000000000000000';

function toEventRecord(tick: SimTick): EventLogRecord {
  const record: EventLogRecord = {
    seq: tick.day,
    loggedAt: tick.decision.ts,
    // BLOCKED (the mandate refused a move) maps to FAILED + an error naming the mandate — the page
    // renders that as "BLOCKED — mandate enforced", sage not red, exactly like the live kicker.
    status: tick.status === 'CONFIRMED' ? 'CONFIRMED' : tick.status === 'BLOCKED' ? 'FAILED' : 'SKIPPED',
    decision: tick.decision,
    execution:
      tick.status === 'CONFIRMED' && tick.simTxId
        ? {
            // The sim's own move id ("sim:012:…") — an obvious simulation artefact, rendered as
            // plain mono text. explorerUrl is DELIBERATELY empty: there is nothing to link to.
            txHash: tick.simTxId,
            explorerUrl: '',
            identitySig: '0x00',
            receiptHash: tick.decision.forecastInputsHash,
          }
        : null,
  };
  if (tick.note) record.error = tick.note;
  return record;
}

/**
 * The full page payload as of simulated day `day` (1-based, clamped to the run's length):
 * mandate snapshot from that day's tick, the event log up to and including it, that day's forecast,
 * and stats derived from the replayed history. `audit` is null — see the contract above.
 */
export function demoEventsAt(config: SimConfig, ticks: SimTick[], day: number): EventsResponse {
  if (ticks.length === 0) throw new Error('demoEventsAt: empty simulation');
  const clamped = Math.min(Math.max(Math.trunc(day), 1), ticks.length);
  const tick = ticks[clamped - 1]!;
  const upToToday = ticks.slice(0, clamped);
  const confirmed = upToToday.filter((t) => t.status === 'CONFIRMED');

  return {
    agentAddress: '',
    identityRegistry: '',
    mandateAddress: '',
    agentIdentityId: '',
    schedulerMode: 'trade',
    // The sim runs the engine with the full mandate budget — exactly the 'opportunistic' semantic
    // (100% of the remaining daily window). Stated explicitly so the brief's radio reflects what
    // the simulated agent actually does.
    appetite: 'opportunistic',
    stats: {
      cycles: clamped,
      decisions: clamped,
      onChainMoves: confirmed.length,
      firstOnChainMoveAt: confirmed[0]?.decision.ts ?? null,
      lastOnChainMoveAt: confirmed[confirmed.length - 1]?.decision.ts ?? null,
      lastCycleAt: tick.decision.ts,
      floorBreaches: 0,
    },
    mandate: {
      companyBalanceUsdc: tick.companyBalanceUsdc,
      deployedUsdc: tick.deployedUsdc,
      floorUsdc: config.mandate.floorUsdc,
      maxTicketUsdc: config.mandate.maxTicketUsdc,
      dailyCapUsdc: config.mandate.dailyCapUsdc,
      // One tick per day, so today's confirmed DEPLOY is exactly what the 24h window holds.
      windowDeployedUsdc:
        tick.status === 'CONFIRMED' && tick.decision.kind === 'DEPLOY' ? tick.decision.amountUsdc : '0',
      revoked: tick.revoked,
      agentGasWei: DEMO_AGENT_GAS_WEI,
    },
    latestForecast: {
      decisionId: tick.decision.id,
      loggedAt: tick.decision.ts,
      forecast: tick.forecast,
    },
    events: upToToday.map(toEventRecord),
    // NEVER an audit block in demo mode: the verifier did not check these moves, so the page must
    // render its honest fallbacks ("awaiting the next nightly audit", no scoreboard).
    audit: null,
  };
}
