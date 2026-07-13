import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ForecastResult,
  Decision,
  ExecutionResult,
  EventLogRecord,
  UsdcBaseUnits,
} from './index.js';

const ZERO_HASH = '0x' + '00'.repeat(32);
const ONE_HASH = '0x' + '11'.repeat(32);

const forecastFixture = {
  asOf: '2026-07-14T09:30:00Z',
  horizonDays: 90,
  series: [
    { date: '2026-07-14', p10: '30000000000000000000000', p50: '38000000000000000000000', p90: '46000000000000000000000' },
    { date: '2026-08-13', p10: '18000000000000000000000', p50: '31000000000000000000000', p90: '44000000000000000000000' },
  ],
  modelId: 'deterministic-baseline@0.1.0',
  inputsHash: ONE_HASH,
};

const decisionFixture = {
  id: 'boulangerie-chartier:2026-07-14:DEPLOY',
  ts: '2026-07-14T09:30:05Z',
  kind: 'DEPLOY',
  amountUsdc: '12000000000000000000000',
  floorUsdc: '20000000000000000000000',
  reason: 'Surplus above safe floor and projected 30d P10 min; deploying to yield.',
  forecastInputsHash: ONE_HASH,
};

const executionFixture = {
  txHash: ZERO_HASH,
  explorerUrl: 'https://explorer.arc.network/tx/0x0000000000000000000000000000000000000000000000000000000000000000',
  identitySig: '0xabcdef',
  receiptHash: ONE_HASH,
};

test('ForecastResult accepts a valid fixture', () => {
  assert.doesNotThrow(() => ForecastResult.parse(forecastFixture));
});

test('Decision accepts a valid fixture with a FLOOR_RAISE + exposure', () => {
  assert.doesNotThrow(() => Decision.parse(decisionFixture));
  assert.doesNotThrow(() =>
    Decision.parse({
      ...decisionFixture,
      kind: 'FLOOR_RAISE',
      exposure: { inputName: 'wheat', weightPct: 14, shockPct: 20, floorUpliftUsdc: '3000000000000000000000' },
    }),
  );
});

test('ExecutionResult and EventLogRecord round-trip', () => {
  assert.doesNotThrow(() => ExecutionResult.parse(executionFixture));
  assert.doesNotThrow(() =>
    EventLogRecord.parse({
      seq: 0,
      loggedAt: '2026-07-14T09:30:06Z',
      status: 'CONFIRMED',
      decision: decisionFixture,
      execution: executionFixture,
    }),
  );
});

test('UsdcBaseUnits rejects floats and negatives (no float money, ever)', () => {
  assert.throws(() => UsdcBaseUnits.parse('12000.50'));
  assert.throws(() => UsdcBaseUnits.parse('-1'));
  assert.doesNotThrow(() => UsdcBaseUnits.parse('0'));
});

test('Decision rejects an unknown kind', () => {
  assert.throws(() => Decision.parse({ ...decisionFixture, kind: 'YOLO' }));
});
