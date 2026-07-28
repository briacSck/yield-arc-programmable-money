import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { after, describe, it } from 'node:test';
import type { EventLog } from './event-log.js';
import type { ForecastStore } from './forecast-store.js';
import { createWorkerRequestListener, type MandateSnapshot, type WorkerServerContext } from './server.js';
import type { OwnerActionResult, OwnerActionsPort } from './chain/owner-actions.js';

const SECRET = 'test-owner-secret-0123456789';
const TX_HASH = `0x${'ab'.repeat(32)}` as const;

const MANDATE: MandateSnapshot = {
  companyBalanceUsdc: '10000000',
  deployedUsdc: '0',
  floorUsdc: '5000000',
  maxTicketUsdc: '2000000',
  dailyCapUsdc: '5000000',
  windowDeployedUsdc: '0',
  revoked: false,
  agentGasWei: '100000000000000000',
};

/** Records every owner call so a test can assert that NOTHING was executed on a refusal path. */
function fakeOwnerActions() {
  const calls: { action: string; input: unknown }[] = [];
  const result = (action: OwnerActionResult['action'], abi: string, params: string[], requestId: string) => ({
    action,
    txHash: TX_HASH,
    explorerUrl: `https://testnet.arcscan.app/tx/${TX_HASH}`,
    circleTxId: 'circle-tx-1',
    abiFunctionSignature: abi,
    abiParameters: params,
    requestId,
  });
  const port: OwnerActionsPort = {
    async pause(requestId) {
      calls.push({ action: 'pause', input: requestId });
      return result('PAUSE', 'revoke()', [], requestId);
    },
    async resume(requestId) {
      calls.push({ action: 'resume', input: requestId });
      return result('RESUME', 'reinstate()', [], requestId);
    },
    async setFloor(input) {
      calls.push({ action: 'setFloor', input });
      return result('SET_FLOOR', 'setMandate(uint256,uint256,uint256)', [
        input.floorUsdc,
        input.maxTicketUsdc,
        input.dailyCapUsdc,
      ], input.requestId);
    },
  };
  return { port, calls };
}

const servers: Server[] = [];
after(() => servers.forEach((s) => s.close()));

async function withServer(overrides: Partial<WorkerServerContext>) {
  const ctx: WorkerServerContext = {
    env: { OWNER_ACTION_SECRET: SECRET },
    log: { readAll: () => [] } as unknown as EventLog,
    forecastStore: { latest: () => null } as unknown as ForecastStore,
    cycleIntervalMs: 60_000,
    readMandate: async () => MANDATE,
    ...overrides,
  };
  const server = createServer(createWorkerRequestListener(ctx));
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as { port: number };
  const post = async (path: string, body: unknown, secret?: string | null) => {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(secret === null || secret === undefined ? {} : { 'x-owner-secret': secret }),
      },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
  return { port, post };
}

describe('worker /owner/* — auth', () => {
  it('REFUSES rather than running open when OWNER_ACTION_SECRET is unset', async () => {
    const owner = fakeOwnerActions();
    const { post } = await withServer({ env: {}, ownerActions: owner.port });
    const res = await post('/owner/pause', {});
    assert.equal(res.status, 503);
    assert.match(String(res.body.error), /OWNER_ACTION_SECRET is not set/);
    assert.deepEqual(owner.calls, [], 'an unauthenticated request must never reach the chain');
  });

  it('rejects a missing secret with 401 and executes nothing', async () => {
    const owner = fakeOwnerActions();
    const { post } = await withServer({ ownerActions: owner.port });
    const res = await post('/owner/pause', {}, null);
    assert.equal(res.status, 401);
    assert.deepEqual(owner.calls, []);
  });

  it('rejects a wrong secret with 401 and executes nothing', async () => {
    const owner = fakeOwnerActions();
    const { post } = await withServer({ ownerActions: owner.port });
    const res = await post('/owner/pause', {}, `${SECRET}x`);
    assert.equal(res.status, 401);
    assert.deepEqual(owner.calls, []);
  });

  it('never echoes the secret back in any response', async () => {
    const { post } = await withServer({ ownerActions: fakeOwnerActions().port });
    for (const [path, body, secret] of [
      ['/owner/pause', {}, undefined],
      ['/owner/pause', {}, 'wrong-but-long-enough-secret'],
      ['/owner/pause', {}, SECRET],
      ['/owner/floor', { floorUsdc: 'bogus' }, SECRET],
    ] as const) {
      const res = await post(path, body, secret ?? null);
      assert.ok(!JSON.stringify(res.body).includes(SECRET), `${path} leaked the secret`);
    }
  });

  it('refuses when the worker has no Circle owner credentials', async () => {
    const { post } = await withServer({ ownerActions: null });
    const res = await post('/owner/pause', {}, SECRET);
    assert.equal(res.status, 503);
    assert.match(String(res.body.error), /CIRCLE_COMPANY_WALLET_ID/);
  });

  it('rejects GET on a write endpoint', async () => {
    const { port } = await withServer({ ownerActions: fakeOwnerActions().port });
    const res = await fetch(`http://127.0.0.1:${port}/owner/pause`, { headers: { 'x-owner-secret': SECRET } });
    assert.equal(res.status, 405);
  });
});

describe('worker /owner/* — actions', () => {
  it('pauses: calls revoke() and returns the tx hash', async () => {
    const owner = fakeOwnerActions();
    const { post } = await withServer({ ownerActions: owner.port });
    const res = await post('/owner/pause', { requestId: 'click-000000001' }, SECRET);
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.action, 'PAUSE');
    assert.equal(res.body.txHash, TX_HASH);
    assert.equal(res.body.abiFunctionSignature, 'revoke()');
    assert.deepEqual(owner.calls, [{ action: 'pause', input: 'click-000000001' }]);
  });

  it('resumes: calls reinstate()', async () => {
    const owner = fakeOwnerActions();
    const { post } = await withServer({ ownerActions: owner.port });
    const res = await post('/owner/resume', {}, SECRET);
    assert.equal(res.status, 200);
    assert.equal(res.body.action, 'RESUME');
    assert.equal(owner.calls.at(0)?.action, 'resume');
  });

  it('generates a requestId when the caller omits one', async () => {
    const owner = fakeOwnerActions();
    const { post } = await withServer({ ownerActions: owner.port });
    await post('/owner/pause', {}, SECRET);
    assert.match(String(owner.calls.at(0)?.input), /^[a-f0-9]{32}$/);
  });

  it('sets the floor, carrying the CURRENT ticket and daily caps through unchanged', async () => {
    const owner = fakeOwnerActions();
    const { post } = await withServer({ ownerActions: owner.port });
    const res = await post('/owner/floor', { floorUsdc: '6000000' }, SECRET);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.abiParameters, ['6000000', '2000000', '5000000']);
    const sent = owner.calls.at(0)?.input as Record<string, unknown>;
    assert.equal(sent.maxTicketUsdc, MANDATE.maxTicketUsdc);
    assert.equal(sent.dailyCapUsdc, MANDATE.dailyCapUsdc);
  });

  it('rejects every malformed floor with 400 and executes nothing', async () => {
    const owner = fakeOwnerActions();
    const { post } = await withServer({ ownerActions: owner.port });
    for (const floorUsdc of [6_000_000, '0', '-1', '6.5', '06', ' 6', '', null, '99999999999999999999']) {
      const res = await post('/owner/floor', { floorUsdc }, SECRET);
      assert.equal(res.status, 400, `floorUsdc=${JSON.stringify(floorUsdc)} should be a 400`);
      assert.equal(res.body.ok, false);
    }
    const missing = await post('/owner/floor', {}, SECRET);
    assert.equal(missing.status, 400);
    assert.deepEqual(owner.calls, []);
  });

  it('refuses to write bounds it cannot read (mandate read unavailable)', async () => {
    const owner = fakeOwnerActions();
    const { post } = await withServer({
      ownerActions: owner.port,
      readMandate: async () => {
        throw new Error('rpc down');
      },
    });
    const res = await post('/owner/floor', { floorUsdc: '6000000' }, SECRET);
    assert.equal(res.status, 503);
    assert.match(String(res.body.error), /cannot read the current mandate/);
    assert.deepEqual(owner.calls, []);
  });

  it('rejects a malformed requestId with 400', async () => {
    const owner = fakeOwnerActions();
    const { post } = await withServer({ ownerActions: owner.port });
    const res = await post('/owner/pause', { requestId: 'no' }, SECRET);
    assert.equal(res.status, 400);
    assert.deepEqual(owner.calls, []);
  });

  it('surfaces an execution failure honestly as 502 — never a silent success', async () => {
    const { post } = await withServer({
      ownerActions: {
        async pause(): Promise<never> {
          throw new Error('owner actions: PAUSE tx ended FAILED (NotOwner())');
        },
        async resume(): Promise<never> {
          throw new Error('unused');
        },
        async setFloor(): Promise<never> {
          throw new Error('unused');
        },
      },
    });
    const res = await post('/owner/pause', {}, SECRET);
    assert.equal(res.status, 502);
    assert.equal(res.body.ok, false);
    assert.match(String(res.body.error), /FAILED.*NotOwner/);
  });

  it('404s an unknown owner action', async () => {
    const { post } = await withServer({ ownerActions: fakeOwnerActions().port });
    const res = await post('/owner/self-destruct', {}, SECRET);
    assert.equal(res.status, 404);
  });

  it('leaves the read surface working', async () => {
    const { port } = await withServer({ ownerActions: fakeOwnerActions().port });
    const res = await fetch(`http://127.0.0.1:${port}/events`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as Record<string, unknown>;
    assert.deepEqual(body.events, []);
  });
});
