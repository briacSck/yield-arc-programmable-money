import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Decision } from '@yield/shared';
import {
  CircleChainExecutor,
  idempotencyKeyFor,
  onChainDecisionId,
  type CircleWalletsSdk,
} from './circle-chain-executor.js';

const HASH = `0x${'ab'.repeat(32)}` as const;
const TX_HASH = `0x${'cd'.repeat(32)}`;

function decision(overrides: Partial<Decision> = {}): Decision {
  return {
    id: 'd-1',
    ts: '2026-07-14T12:00:00Z',
    kind: 'DEPLOY',
    amountUsdc: '2500000000',
    floorUsdc: '18000000000',
    reason: 'surplus above P10-safe floor',
    forecastInputsHash: HASH,
    ...overrides,
  };
}

interface FakeOpts {
  states?: string[];
  errorReason?: string;
}

function fakeSdk(opts: FakeOpts = {}) {
  const states = [...(opts.states ?? ['COMPLETE'])];
  const calls: { submit: unknown[]; sign: unknown[]; polls: number } = { submit: [], sign: [], polls: 0 };
  const sdk: CircleWalletsSdk = {
    async createContractExecutionTransaction(input) {
      calls.submit.push(input);
      return { data: { id: 'circle-tx-1', state: 'INITIATED' } };
    },
    async getTransaction() {
      calls.polls += 1;
      const state = states.length > 1 ? states.shift()! : states[0];
      return { data: { transaction: { state, txHash: TX_HASH, errorReason: opts.errorReason } } };
    },
    async signMessage() {
      calls.sign.push(true);
      return { data: { signature: `0x${'11'.repeat(65)}` } };
    },
  };
  return { sdk, calls };
}

function executor(sdk: CircleWalletsSdk) {
  return new CircleChainExecutor(sdk, {
    walletId: 'w-1',
    mandateAddress: '0x000000000000000000000000000000000000dEaD',
    pollIntervalMs: 1,
    timeoutMs: 500,
  });
}

describe('CircleChainExecutor', () => {
  it('maps DEPLOY onto AgentMandate.deposit with amount, decisionId, forecastHash', async () => {
    const { sdk, calls } = fakeSdk();
    const d = decision();
    const result = await executor(sdk).execute(d);

    const submit = calls.submit[0] as Record<string, unknown>;
    assert.equal(submit.abiFunctionSignature, 'deposit(uint256,bytes32,bytes32)');
    assert.deepEqual(submit.abiParameters, [d.amountUsdc, onChainDecisionId(d), d.forecastInputsHash]);
    assert.equal(submit.contractAddress, '0x000000000000000000000000000000000000dEaD');
    assert.equal(submit.idempotencyKey, idempotencyKeyFor(d.id));
    assert.equal(result.txHash, TX_HASH);
    assert.equal(result.explorerUrl, `https://testnet.arcscan.app/tx/${TX_HASH}`);
    assert.equal(result.receiptHash, d.forecastInputsHash);
    assert.equal(calls.sign.length, 1);
  });

  it('maps WITHDRAW onto AgentMandate.withdrawToCompany', async () => {
    const { sdk, calls } = fakeSdk();
    await executor(sdk).execute(decision({ kind: 'WITHDRAW' }));
    const submit = calls.submit[0] as Record<string, unknown>;
    assert.equal(submit.abiFunctionSignature, 'withdrawToCompany(uint256,bytes32,bytes32)');
  });

  it('refuses HOLD and FLOOR_RAISE — they move no money', async () => {
    const { sdk, calls } = fakeSdk();
    const ex = executor(sdk);
    await assert.rejects(() => ex.execute(decision({ kind: 'HOLD' })), /moves no money/);
    await assert.rejects(() => ex.execute(decision({ kind: 'FLOOR_RAISE' })), /moves no money/);
    assert.equal(calls.submit.length, 0);
  });

  it('rejects a reused decision id (idempotency, §17.2)', async () => {
    const { sdk } = fakeSdk();
    const ex = executor(sdk);
    await ex.execute(decision());
    await assert.rejects(() => ex.execute(decision()), /duplicate decision id/);
  });

  it('polls through intermediate states to CONFIRMED', async () => {
    const { sdk, calls } = fakeSdk({ states: ['QUEUED', 'SENT', 'CONFIRMED'] });
    const result = await executor(sdk).execute(decision());
    assert.equal(result.txHash, TX_HASH);
    assert.ok(calls.polls >= 3);
  });

  it('throws on a FAILED terminal state instead of retrying (§17.6)', async () => {
    const { sdk } = fakeSdk({ states: ['FAILED'], errorReason: 'insufficient funds' });
    await assert.rejects(() => executor(sdk).execute(decision()), /FAILED.*insufficient funds/s);
  });

  it('enforces strictly serial execution — one in-flight tx max (§17.6)', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { sdk } = fakeSdk();
    const slowSdk: CircleWalletsSdk = {
      ...sdk,
      async getTransaction(input) {
        await gate;
        return sdk.getTransaction(input);
      },
    };
    const ex = executor(slowSdk);
    const first = ex.execute(decision({ id: 'd-slow' }));
    await new Promise((r) => setTimeout(r, 10)); // let the first execute reach the poll
    await assert.rejects(() => ex.execute(decision({ id: 'd-second' })), /already in flight/);
    release();
    await first;
  });

  it('derives a deterministic, RFC-shaped idempotency key from the decision id', () => {
    const k1 = idempotencyKeyFor('d-1');
    assert.equal(k1, idempotencyKeyFor('d-1'));
    assert.notEqual(k1, idempotencyKeyFor('d-2'));
    assert.match(k1, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});
