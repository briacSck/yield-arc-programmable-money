import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CircleOwnerActions,
  MIN_OWNER_SECRET_LENGTH,
  OwnerActionInputError,
  checkOwnerSecret,
  ownerIdempotencyKey,
  parseFloorUnits,
  parseRequestId,
  parseUnits,
  type OwnerActionsSdk,
} from './owner-actions.js';

const TX_HASH = `0x${'ab'.repeat(32)}`;
const SECRET = 'a'.repeat(MIN_OWNER_SECRET_LENGTH);

function fakeSdk(opts: { states?: string[]; errorReason?: string } = {}) {
  const states = [...(opts.states ?? ['COMPLETE'])];
  const calls: { submit: Record<string, unknown>[]; polls: number } = { submit: [], polls: 0 };
  const sdk: OwnerActionsSdk = {
    async createContractExecutionTransaction(input) {
      calls.submit.push(input as unknown as Record<string, unknown>);
      return { data: { id: 'circle-owner-tx-1', state: 'INITIATED' } };
    },
    async getTransaction() {
      calls.polls += 1;
      const state = states.length > 1 ? states.shift()! : states[0];
      return { data: { transaction: { state, txHash: TX_HASH, errorReason: opts.errorReason } } };
    },
  };
  return { sdk, calls };
}

function actions(sdk: OwnerActionsSdk) {
  return new CircleOwnerActions(sdk, {
    walletId: 'company-wallet-1',
    mandateAddress: '0x000000000000000000000000000000000000dEaD',
    pollIntervalMs: 1,
    timeoutMs: 500,
  });
}

describe('owner action input validation', () => {
  it('accepts a positive integer string of USDC base units', () => {
    assert.equal(parseFloorUnits('5000000'), '5000000');
    assert.equal(parseFloorUnits('1'), '1');
    assert.equal(parseFloorUnits('999999999999999999'), '999999999999999999'); // 18 digits, the cap
  });

  it('refuses everything that is not a canonical positive integer string', () => {
    const bad: [unknown, string][] = [
      [5_000_000, 'a JSON number (6-dec base units exceed float precision)'],
      ['0', 'zero — a zero floor is no floor at all'],
      ['-5000000', 'negative'],
      ['5.0', 'decimal point'],
      ['5e6', 'exponent'],
      ['0500000', 'leading zero'],
      [' 5000000', 'leading whitespace'],
      ['5000000 ', 'trailing whitespace'],
      ['5_000_000', 'separators'],
      ['', 'empty'],
      ['1234567890123456789', '19 digits — over the cap'],
      ['0x4c4b40', 'hex'],
      [null, 'null'],
      [undefined, 'undefined'],
      [{ toString: () => '5000000' }, 'an object that stringifies'],
      [['5000000'], 'an array'],
      [true, 'a boolean'],
    ];
    for (const [value, why] of bad) {
      assert.throws(() => parseFloorUnits(value), OwnerActionInputError, `should refuse ${why}`);
    }
  });

  it('names the offending field in the error the owner will read', () => {
    assert.throws(() => parseUnits('nope', 'dailyCapUsdc'), /dailyCapUsdc/);
  });

  it('refuses a floor above the ticket/daily-cap invariant the constructor enforces', async () => {
    const { sdk, calls } = fakeSdk();
    await assert.rejects(
      () =>
        actions(sdk).setFloor({
          floorUsdc: '5000000',
          maxTicketUsdc: '9000000',
          dailyCapUsdc: '5000000',
          requestId: 'req-00000001',
        }),
      OwnerActionInputError,
    );
    assert.equal(calls.submit.length, 0, 'nothing may be submitted after a validation failure');
  });

  it('validates request ids and falls back to a generated one', () => {
    assert.equal(parseRequestId('abc12345', () => 'generated'), 'abc12345');
    assert.equal(parseRequestId(undefined, () => 'generated'), 'generated');
    assert.equal(parseRequestId('', () => 'generated'), 'generated');
    assert.throws(() => parseRequestId('short', () => 'generated'), OwnerActionInputError);
    assert.throws(() => parseRequestId('has spaces here', () => 'generated'), OwnerActionInputError);
    assert.throws(() => parseRequestId(42, () => 'generated'), OwnerActionInputError);
  });
});

describe('owner action auth (rule #6 — never run open)', () => {
  it('REFUSES when the secret is unset — it must not fall back to no auth', () => {
    for (const unset of [undefined, '', '   ']) {
      const r = checkOwnerSecret(unset, 'anything');
      assert.equal(r.ok, false);
      assert.equal(r.ok === false && r.status, 503);
      assert.match(r.ok === false ? r.error : '', /OWNER_ACTION_SECRET is not set/);
    }
  });

  it('refuses a trivially short secret rather than pretending it protects anything', () => {
    const r = checkOwnerSecret('short', 'short');
    assert.equal(r.ok, false);
    assert.equal(r.ok === false && r.status, 503);
    assert.match(r.ok === false ? r.error : '', /at least 16 characters/);
  });

  it('rejects a missing or wrong secret with 401', () => {
    for (const provided of [undefined, null, '', 'wrong', SECRET + 'x', SECRET.slice(0, -1)]) {
      const r = checkOwnerSecret(SECRET, provided);
      assert.equal(r.ok, false, `should reject ${JSON.stringify(provided)}`);
      assert.equal(r.ok === false && r.status, 401);
    }
  });

  it('accepts the exact secret', () => {
    assert.deepEqual(checkOwnerSecret(SECRET, SECRET), { ok: true });
    assert.deepEqual(checkOwnerSecret(`  ${SECRET}  `, SECRET), { ok: true }); // env values get trimmed
  });
});

describe('CircleOwnerActions', () => {
  it('maps pause onto revoke() with no parameters, from the company wallet', async () => {
    const { sdk, calls } = fakeSdk();
    const result = await actions(sdk).pause('req-00000001');
    assert.equal(calls.submit[0]!.abiFunctionSignature, 'revoke()');
    assert.deepEqual(calls.submit[0]!.abiParameters, []);
    assert.equal(calls.submit[0]!.walletId, 'company-wallet-1');
    assert.equal(result.txHash, TX_HASH);
    assert.equal(result.explorerUrl, `https://testnet.arcscan.app/tx/${TX_HASH}`);
    assert.equal(result.action, 'PAUSE');
  });

  it('maps resume onto reinstate()', async () => {
    const { sdk, calls } = fakeSdk();
    await actions(sdk).resume('req-00000001');
    assert.equal(calls.submit[0]!.abiFunctionSignature, 'reinstate()');
  });

  it('maps setFloor onto setMandate, re-sending the CURRENT ticket and daily caps', async () => {
    const { sdk, calls } = fakeSdk();
    await actions(sdk).setFloor({
      floorUsdc: '6000000',
      maxTicketUsdc: '2000000',
      dailyCapUsdc: '5000000',
      requestId: 'req-00000001',
    });
    assert.equal(calls.submit[0]!.abiFunctionSignature, 'setMandate(uint256,uint256,uint256)');
    assert.deepEqual(calls.submit[0]!.abiParameters, ['6000000', '2000000', '5000000']);
  });

  it('derives a deterministic idempotency key per click — one click is one transaction', async () => {
    const { sdk, calls } = fakeSdk();
    const ex = actions(sdk);
    await ex.pause('req-00000001');
    await ex.pause('req-00000001'); // the same click, retried
    await ex.pause('req-00000002'); // a different click
    const keys = calls.submit.map((s) => String(s.idempotencyKey));
    assert.equal(keys[0], keys[1]);
    assert.notEqual(keys[0], keys[2]);
    assert.match(String(keys[0]), /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
    // ...and a different action with the same click id is still a different key.
    assert.notEqual(ownerIdempotencyKey('PAUSE', [], 'x'), ownerIdempotencyKey('RESUME', [], 'x'));
    assert.notEqual(
      ownerIdempotencyKey('SET_FLOOR', ['5000000', '2', '5'], 'x'),
      ownerIdempotencyKey('SET_FLOOR', ['6000000', '2', '5'], 'x'),
    );
  });

  it('polls through intermediate states to a terminal COMPLETE', async () => {
    const { sdk, calls } = fakeSdk({ states: ['QUEUED', 'SENT', 'CONFIRMED'] });
    const result = await actions(sdk).pause('req-00000001');
    assert.equal(result.txHash, TX_HASH);
    assert.ok(calls.polls >= 3);
  });

  it('throws on a FAILED terminal instead of retrying (§17.6)', async () => {
    const { sdk } = fakeSdk({ states: ['FAILED'], errorReason: 'NotOwner()' });
    await assert.rejects(() => actions(sdk).pause('req-00000001'), /FAILED.*NotOwner/s);
  });

  it('is strictly serial — one owner transaction in flight at a time', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { sdk } = fakeSdk();
    const slow: OwnerActionsSdk = {
      ...sdk,
      async getTransaction(input) {
        await gate;
        return sdk.getTransaction(input);
      },
    };
    const ex = actions(slow);
    const first = ex.pause('req-00000001');
    await new Promise((r) => setTimeout(r, 10));
    await assert.rejects(() => ex.resume('req-00000002'), /already in flight/);
    release();
    await first;
  });
});
