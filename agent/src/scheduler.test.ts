import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ChainExecutor, ForecastResult } from '@yield/shared';
import { MockChainExecutor } from './chain/mock-chain-executor.js';
import { EventLog } from './event-log.js';
import { runCycle, startScheduler, type CycleDeps } from './scheduler.js';

const NOW = '2026-07-14T12:00:00Z';
const U = (n: number) => (BigInt(n) * 1_000_000n).toString();

function forecastFixture(overrides: Partial<ForecastResult> = {}): ForecastResult {
  return {
    asOf: '2026-07-14T11:00:00Z',
    horizonDays: 90,
    series: [{ date: '2026-07-20', p10: U(95_000), p50: U(100_000), p90: U(110_000) }],
    modelId: 'deterministic-baseline@0.1.0',
    inputsHash: `0x${'11'.repeat(32)}`,
    ...overrides,
  };
}

function tmpLog(): EventLog {
  return new EventLog(path.join(mkdtempSync(path.join(tmpdir(), 'yield-log-')), 'event-log.jsonl'));
}

/** Balances that produce a DEPLOY of 5k against the fixture forecast (see engine tests). */
const deployBalances = () => ({
  companyBalanceUsdc: U(100_000),
  deployedUsdc: U(50_000),
  trailing30dMinUsdc: U(100_000),
});

function deps(overrides: Partial<CycleDeps> = {}): CycleDeps {
  return {
    forecast: () => forecastFixture(),
    balances: deployBalances,
    config: { userMinUsdc: '0', minTicketUsdc: U(1), horizonDays: 30 },
    executor: null,
    log: tmpLog(),
    now: () => NOW,
    ping: async () => {},
    ...overrides,
  };
}

test('observe mode: a money-moving decision is logged SKIPPED, never executed', async () => {
  let pinged = 0;
  const record = await runCycle(deps({ ping: async () => void (pinged += 1) }));
  assert.equal(record.seq, 0);
  assert.equal(record.decision.kind, 'DEPLOY');
  assert.equal(record.status, 'SKIPPED');
  assert.match(record.error ?? '', /observe mode/);
  assert.equal(record.execution, null);
  assert.equal(pinged, 1);
});

test('trade mode: DEPLOY executes through the ChainExecutor and logs CONFIRMED', async () => {
  const record = await runCycle(deps({ executor: new MockChainExecutor() }));
  assert.equal(record.status, 'CONFIRMED');
  assert.ok(record.execution?.txHash.startsWith('0x'));
  assert.equal(record.execution?.receiptHash, record.decision.forecastInputsHash);
});

test('HOLD cycles log SKIPPED with the legible reason (the uptime clock ticks on HOLDs too)', async () => {
  const record = await runCycle(
    deps({
      executor: new MockChainExecutor(),
      balances: () => ({ companyBalanceUsdc: U(90_000), deployedUsdc: '0', trailing30dMinUsdc: U(100_000) }),
      config: { userMinUsdc: '0', minTicketUsdc: U(50_000), horizonDays: 30 },
    }),
  );
  assert.equal(record.decision.kind, 'HOLD');
  assert.equal(record.status, 'SKIPPED');
});

test('executor failure logs FAILED and does not throw out of the cycle (§17.6: no blind retry)', async () => {
  const failing: ChainExecutor = {
    async execute() {
      throw new Error('tx FAILED (insufficient funds)');
    },
  };
  const record = await runCycle(deps({ executor: failing }));
  assert.equal(record.status, 'FAILED');
  assert.match(record.error ?? '', /insufficient funds/);
});

test('forecast failure logs a FAILED HOLD-shaped record (degraded input, invariant #4)', async () => {
  const record = await runCycle(
    deps({
      forecast: () => {
        throw new Error('signal source down');
      },
    }),
  );
  assert.equal(record.status, 'FAILED');
  assert.equal(record.decision.kind, 'HOLD');
  assert.match(record.decision.reason, /degraded input/);
});

test('seq resumes from the JSONL tail across restarts', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'yield-log-'));
  const file = path.join(dir, 'event-log.jsonl');
  const first = new EventLog(file);
  await runCycle(deps({ log: first }));
  await runCycle(deps({ log: first, forecast: () => forecastFixture({ inputsHash: `0x${'22'.repeat(32)}` }) }));
  // "restart": a brand-new EventLog on the same file must continue, not rewind.
  const reopened = new EventLog(file);
  const record = await runCycle(
    deps({ log: reopened, forecast: () => forecastFixture({ inputsHash: `0x${'33'.repeat(32)}` }) }),
  );
  assert.equal(record.seq, 2);
  const lines = readFileSync(file, 'utf8').trim().split('\n');
  assert.equal(lines.length, 3);
  assert.deepEqual(lines.map((l) => JSON.parse(l).seq), [0, 1, 2]);
});

test('single in-flight guard: a tick during a running cycle is dropped, not queued', async () => {
  let concurrent = 0;
  let maxConcurrent = 0;
  let cycles = 0;
  const slowExecutor: ChainExecutor = {
    async execute(decision) {
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise((r) => setTimeout(r, 40));
      concurrent -= 1;
      cycles += 1;
      return new MockChainExecutor().execute(decision);
    },
  };
  // Fresh inputsHash per cycle so the mock's duplicate guard doesn't fire.
  let n = 0;
  const stop = startScheduler(
    deps({
      executor: slowExecutor,
      forecast: () => forecastFixture({ inputsHash: `0x${(n++).toString(16).padStart(2, '0').repeat(32)}` }),
    }),
    { intervalMs: 10 },
  );
  await new Promise((r) => setTimeout(r, 150));
  stop();
  await new Promise((r) => setTimeout(r, 60)); // drain the last cycle
  assert.equal(maxConcurrent, 1, 'two cycles overlapped — the in-flight guard failed');
  assert.ok(cycles >= 2, `expected multiple completed cycles, got ${cycles}`);
});
