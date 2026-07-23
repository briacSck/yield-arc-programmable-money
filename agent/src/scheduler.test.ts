import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ChainExecutor, ForecastResult } from '@yield/shared';
import { MockChainExecutor } from './chain/mock-chain-executor.js';
import { EventLog } from './event-log.js';
import { ForecastStore } from './forecast-store.js';
import { runCycle, startScheduler, type CycleDeps, type CycleInputs } from './scheduler.js';

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

function tmpDir(): string {
  return mkdtempSync(path.join(tmpdir(), 'yield-'));
}

/** Inputs that produce a DEPLOY of 5k against the fixture forecast (see engine tests). */
const deployInputs = (): CycleInputs => ({
  companyBalanceUsdc: U(100_000),
  deployedUsdc: U(50_000),
  trailing30dMinUsdc: U(100_000),
  config: { userMinUsdc: '0', minTicketUsdc: U(1), horizonDays: 30 },
  gasOk: true,
});

function deps(overrides: Partial<CycleDeps> = {}): CycleDeps {
  return {
    gather: deployInputs,
    forecast: () => ({ forecast: forecastFixture() }),
    executor: null,
    log: new EventLog(path.join(tmpDir(), 'event-log.jsonl')),
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
  assert.equal(pinged, 1);
});

test('trade mode: DEPLOY executes through the ChainExecutor and logs CONFIRMED', async () => {
  const record = await runCycle(deps({ executor: new MockChainExecutor() }));
  assert.equal(record.status, 'CONFIRMED');
  assert.ok(record.execution?.txHash.startsWith('0x'));
});

test('gas guard: gasOk=false forces HOLD, fires the FAIL ping, never touches the executor', async () => {
  let failPings = 0;
  let okPings = 0;
  let executed = 0;
  const failing: ChainExecutor = {
    async execute() {
      executed += 1;
      throw new Error('should not run');
    },
  };
  const record = await runCycle(
    deps({
      gather: () => ({ ...deployInputs(), gasOk: false }),
      executor: failing,
      ping: async () => void (okPings += 1),
      pingFail: async () => void (failPings += 1),
    }),
  );
  assert.equal(record.decision.kind, 'HOLD');
  assert.match(record.decision.reason, /gas below threshold/);
  assert.equal(executed, 0);
  assert.equal(failPings, 1);
  assert.equal(okPings, 0);
});

test('FAILED storm: 3 consecutive cycle-input failures fire the FAIL ping (RPC-death blind spot)', async () => {
  // Regression for the 759-cycle silent outage (2026-07-15→07-23): a dead RPC writes a fresh
  // FAILED record every tick, and the old success-ping kept the monitor green over a dead loop.
  const log = new EventLog(path.join(tmpDir(), 'event-log.jsonl'));
  let failPings = 0;
  let okPings = 0;
  const d = (): CycleDeps =>
    deps({
      log,
      gather: () => {
        throw new Error('RPC Request failed. request limit reached');
      },
      ping: async () => void (okPings += 1),
      pingFail: async () => void (failPings += 1),
    });

  const r1 = await runCycle(d());
  const r2 = await runCycle(d());
  assert.equal(r1.status, 'FAILED');
  // First two FAILED cycles are within tolerance (transient) — success ping, monitor rides the grace period.
  assert.equal(failPings, 0);
  assert.equal(okPings, 2);

  const r3 = await runCycle(d());
  assert.equal(r3.status, 'FAILED');
  // Third consecutive FAILED = a storm: the monitor must go RED now, not stay green.
  assert.equal(failPings, 1);
  assert.equal(okPings, 2);
});

test('recovery: a healthy cycle after a storm returns to the success ping', async () => {
  const log = new EventLog(path.join(tmpDir(), 'event-log.jsonl'));
  let failPings = 0;
  let okPings = 0;
  const failing = (): CycleDeps =>
    deps({
      log,
      gather: () => {
        throw new Error('RPC Request failed.');
      },
      ping: async () => void (okPings += 1),
      pingFail: async () => void (failPings += 1),
    });
  for (let i = 0; i < 3; i++) await runCycle(failing());
  assert.equal(failPings, 1);

  // A recovered cycle (gather succeeds) breaks the 3-FAILED tail ⇒ success ping resumes.
  // okPings so far = 2 (cycles 1–2, within tolerance); the storm cycle 3 pinged FAIL, not OK.
  await runCycle(deps({ log, ping: async () => void (okPings += 1), pingFail: async () => void (failPings += 1) }));
  assert.equal(failPings, 1); // no new FAIL ping — the storm is broken
  assert.equal(okPings, 3); // 2 pre-storm + 1 recovery
});

test('cooldown: a second money move inside the window is SKIPPED, not executed', async () => {
  const log = new EventLog(path.join(tmpDir(), 'event-log.jsonl'));
  const mock = new MockChainExecutor();
  let n = 0;
  const d = deps({
    log,
    executor: mock,
    cooldownMs: 60 * 60 * 1000, // 1h
    forecast: () => ({ forecast: forecastFixture({ inputsHash: `0x${(++n).toString(16).padStart(2, '0').repeat(32)}` }) }),
  });
  const first = await runCycle({ ...d, now: () => '2026-07-14T12:00:00Z' });
  assert.equal(first.status, 'CONFIRMED');
  const second = await runCycle({ ...d, now: () => '2026-07-14T12:30:00Z' }); // 30min later
  assert.equal(second.status, 'SKIPPED');
  assert.match(second.error ?? '', /cooldown/);
  const third = await runCycle({ ...d, now: () => '2026-07-14T13:30:00Z' }); // past cooldown
  assert.equal(third.status, 'CONFIRMED');
});

test('forecast snapshots land in the ForecastStore keyed by decision id', async () => {
  const store = new ForecastStore(path.join(tmpDir(), 'forecasts.jsonl'));
  const record = await runCycle(deps({ forecastStore: store }));
  const latest = store.latest();
  assert.ok(latest);
  assert.equal(latest!.decisionId, record.decision.id);
  assert.equal(store.byDecisionId(record.decision.id)?.decisionId, record.decision.id);
});

test('executor failure logs FAILED and does not throw (§17.6: no blind retry)', async () => {
  const failing: ChainExecutor = {
    async execute() {
      throw new Error('tx FAILED (insufficient funds)');
    },
  };
  const record = await runCycle(deps({ executor: failing }));
  assert.equal(record.status, 'FAILED');
  assert.match(record.error ?? '', /insufficient funds/);
});

test('gather failure logs a FAILED HOLD-shaped record (degraded input, invariant #4)', async () => {
  const record = await runCycle(
    deps({
      gather: () => {
        throw new Error('rpc down');
      },
    }),
  );
  assert.equal(record.status, 'FAILED');
  assert.equal(record.decision.kind, 'HOLD');
  assert.match(record.decision.reason, /degraded input/);
});

test('seq resumes from the JSONL tail across restarts; torn lines are skipped', async () => {
  const dir = tmpDir();
  const file = path.join(dir, 'event-log.jsonl');
  const first = new EventLog(file);
  await runCycle(deps({ log: first }));
  await runCycle(deps({ log: first, forecast: () => ({ forecast: forecastFixture({ inputsHash: `0x${'22'.repeat(32)}` }) }) }));
  // Simulate a torn append (container killed mid-write) then "restart".
  const { appendFileSync } = await import('node:fs');
  appendFileSync(file, '{"seq":99,"logg', 'utf8');
  const reopened = new EventLog(file);
  const record = await runCycle(
    deps({ log: reopened, forecast: () => ({ forecast: forecastFixture({ inputsHash: `0x${'33'.repeat(32)}` }) }) }),
  );
  assert.equal(record.seq, 2); // torn line ignored, seq continues from last VALID record
  const valid = reopened.readAll();
  assert.equal(valid.length, 3);
  assert.deepEqual(valid.map((r) => r.seq), [0, 1, 2]);
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
  let n = 0;
  const stop = startScheduler(
    deps({
      executor: slowExecutor,
      cooldownMs: 0,
      forecast: () => ({ forecast: forecastFixture({ inputsHash: `0x${(n++).toString(16).padStart(2, '0').repeat(32)}` }) }),
      now: undefined, // real clock so cooldown anchoring doesn't interfere
    }),
    { intervalMs: 10 },
  );
  await new Promise((r) => setTimeout(r, 150));
  stop();
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(maxConcurrent, 1, 'two cycles overlapped — the in-flight guard failed');
  assert.ok(cycles >= 2, `expected multiple completed cycles, got ${cycles}`);
});
