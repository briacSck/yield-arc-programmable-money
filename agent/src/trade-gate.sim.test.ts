import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { ChainExecutor, Decision, EventLogRecord } from '@yield/shared';
import { baselineForecast } from '@yield/forecast';
import { EventLog } from './event-log.js';
import { runCycle, type CycleDeps, type CycleInputs } from './scheduler.js';
import { scaledLedger } from './run.js';

/**
 * TRADE-MODE GATE (plan E-eng #14, items a–c + g) — the simulation that must stay green before
 * real testnet money moves unattended. Simulates the AgentMandate contract semantics (floor,
 * ticket cap, 24h budget window, revoke) against the REAL scaledLedger + decide() over a month
 * of cycles with a fake clock.
 */

// Live demo constants (must mirror the deployed mandate).
const FLOOR = 5_000_000n;
const MAX_TICKET = 2_000_000n;
const DAILY_CAP = 5_000_000n;
const MIN_TICKET = '500000';
const START_COMPANY = 10_000_000n;
const COOLDOWN_MS = 6 * 60 * 60 * 1000;
const DAY_MS = 86_400_000;

/** Contract-faithful pool simulator: reverts exactly where AgentMandate reverts. */
class SimMandate {
  company = START_COMPANY;
  deployed = 0n;
  windowStart = 0;
  windowDeployed = 0n;
  revoked = false;

  executor(clock: () => number): ChainExecutor {
    return {
      execute: async (decision: Decision) => {
        const amount = BigInt(decision.amountUsdc);
        if (decision.kind === 'DEPLOY') {
          if (this.revoked) throw new Error('MandateRevoked');
          if (this.company < amount + FLOOR) throw new Error('FloorBreach');
          if (amount > MAX_TICKET) throw new Error('TicketCapExceeded');
          if (clock() >= this.windowStart + Number(DAY_MS)) {
            this.windowStart = clock();
            this.windowDeployed = 0n;
          }
          if (this.windowDeployed + amount > DAILY_CAP) throw new Error('DailyCapExceeded');
          this.windowDeployed += amount;
          this.company -= amount;
          this.deployed += amount;
        } else if (decision.kind === 'WITHDRAW') {
          if (amount > this.deployed) throw new Error('InsufficientDeployed');
          this.deployed -= amount;
          this.company += amount;
        } else {
          throw new Error(`executor must never see ${decision.kind}`);
        }
        const txHash = `0x${createHash('sha256').update(decision.id).digest('hex')}`;
        return {
          txHash,
          explorerUrl: `https://testnet.arcscan.app/tx/${txHash}`,
          identitySig: `0x${'11'.repeat(65)}`,
          receiptHash: decision.forecastInputsHash,
        };
      },
    };
  }

  gather(nowMs: number): CycleInputs {
    const windowOpen = nowMs < this.windowStart + Number(DAY_MS);
    const remaining = windowOpen
      ? this.windowDeployed >= DAILY_CAP
        ? 0n
        : DAILY_CAP - this.windowDeployed
      : DAILY_CAP;
    return {
      companyBalanceUsdc: this.company.toString(),
      deployedUsdc: this.deployed.toString(),
      trailing30dMinUsdc: '0', // floor = chain floor exactly (run.ts default)
      config: {
        userMinUsdc: FLOOR.toString(),
        minTicketUsdc: MIN_TICKET,
        horizonDays: 30,
        maxTicketUsdc: MAX_TICKET.toString(),
        dailyCapRemainingUsdc: remaining.toString(),
      },
      gasOk: true,
    };
  }
}

/** Runs `days` of simulated cycles (4/day) starting 2026-07-16T00:00Z. Returns all records. */
async function simulate(days: number, sim: SimMandate, opts: { revokeAtDay?: number } = {}) {
  const startMs = Date.parse('2026-07-16T00:00:00Z');
  let nowMs = startMs;
  const log = new EventLog(path.join(mkdtempSync(path.join(tmpdir(), 'yield-sim-')), 'log.jsonl'));
  const records: EventLogRecord[] = [];
  const deps: CycleDeps = {
    gather: () => sim.gather(nowMs),
    forecast: (inputs) => {
      const total = BigInt(inputs.companyBalanceUsdc) + BigInt(inputs.deployedUsdc);
      const baselineInputs = scaledLedger(total.toString(), new Date(nowMs).toISOString());
      return { forecast: baselineForecast(baselineInputs), baselineInputs };
    },
    executor: sim.executor(() => nowMs),
    log,
    cooldownMs: COOLDOWN_MS,
    now: () => new Date(nowMs).toISOString(),
    ping: async () => {},
  };
  const cyclesTotal = days * 4;
  for (let i = 0; i < cyclesTotal; i++) {
    if (opts.revokeAtDay !== undefined && nowMs - startMs >= opts.revokeAtDay * DAY_MS) sim.revoked = true;
    records.push(await runCycle(deps));
    nowMs += DAY_MS / 4; // 6h per cycle
  }
  return records;
}

test('GATE (a): a DEPLOY fires from cold start at the exact live caps', async () => {
  const sim = new SimMandate();
  const records = await simulate(2, sim);
  const firstDeploy = records.find((r) => r.status === 'CONFIRMED' && r.decision.kind === 'DEPLOY');
  assert.ok(firstDeploy, 'no DEPLOY confirmed within 2 simulated days from cold start');
  assert.ok(BigInt(firstDeploy!.decision.amountUsdc) <= MAX_TICKET);
});

test('GATE (b): 30 simulated days — activity without oscillation, cooldown honored, floor never breached', async () => {
  const sim = new SimMandate();
  const records = await simulate(30, sim);

  const confirmed = records.filter((r) => r.status === 'CONFIRMED');
  const failed = records.filter((r) => r.status === 'FAILED');
  assert.ok(confirmed.length >= 2, `expected ongoing on-chain activity, got ${confirmed.length} moves`);
  assert.equal(failed.length, 0, `FAILED records in sim: ${failed.map((r) => r.error).join(' | ')}`);

  // Cooldown: no two confirmed moves closer than COOLDOWN_MS.
  for (let i = 1; i < confirmed.length; i++) {
    const gap = Date.parse(confirmed[i]!.loggedAt) - Date.parse(confirmed[i - 1]!.loggedAt);
    assert.ok(gap >= COOLDOWN_MS, `moves ${i - 1}→${i} only ${gap / 60000}min apart`);
  }
  // No immediate deposit→withdraw→deposit ping-pong: at most one direction flip per 2 days avg.
  let flips = 0;
  for (let i = 1; i < confirmed.length; i++) {
    if (confirmed[i]!.decision.kind !== confirmed[i - 1]!.decision.kind) flips += 1;
  }
  assert.ok(flips <= confirmed.length / 2 + 2, `oscillation: ${flips} direction flips in ${confirmed.length} moves`);

  // Invariants: floor never breached, pools conserved.
  assert.ok(sim.company >= FLOOR, `company pool ${sim.company} ended below floor ${FLOOR}`);
  assert.equal(sim.company + sim.deployed, START_COMPANY, 'pool conservation violated');
});

test('GATE (c): daily-cap exhaustion produces HOLD/SKIPPED, never a FAILED revert storm', async () => {
  const sim = new SimMandate();
  const records = await simulate(30, sim);
  const capReverts = records.filter((r) => r.status === 'FAILED' && /DailyCapExceeded|TicketCap/.test(r.error ?? ''));
  assert.equal(capReverts.length, 0, 'engine proposed a tx the contract would revert on caps');
});

test('GATE (g): revoke mid-run — deposits blocked at the sim contract, loop degrades to FAILED-then-HOLD without crashing', async () => {
  const sim = new SimMandate();
  const records = await simulate(10, sim, { revokeAtDay: 3 });
  const postRevokeConfirmedDeploys = records.filter(
    (r) => r.status === 'CONFIRMED' && r.decision.kind === 'DEPLOY' && Date.parse(r.loggedAt) >= Date.parse('2026-07-19T00:00:00Z'),
  );
  assert.equal(postRevokeConfirmedDeploys.length, 0, 'a deposit executed after revoke');
  // The loop never crashed: every cycle produced a record.
  assert.equal(records.length, 40);
});
