import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseOwnerRequest } from './owner-action.js';

describe('parseOwnerRequest', () => {
  it('accepts the three owner actions and maps each to its worker path', () => {
    for (const [action, path] of [
      ['pause', '/owner/pause'],
      ['resume', '/owner/resume'],
    ] as const) {
      const r = parseOwnerRequest({ action });
      assert.equal(r.ok, true);
      assert.equal(r.ok && r.path, path);
      assert.deepEqual(r.ok && r.payload, {});
    }
    const floor = parseOwnerRequest({ action: 'floor', floorUsdc: '6000000' });
    assert.equal(floor.ok, true);
    assert.equal(floor.ok && floor.path, '/owner/floor');
    assert.deepEqual(floor.ok && floor.payload, { floorUsdc: '6000000' });
  });

  it('refuses any action that is not one of the three — nothing else is proxied', () => {
    for (const action of ['revoke', 'emergencyWithdrawAll', 'deposit', '', 'PAUSE', 42, null, undefined]) {
      const r = parseOwnerRequest({ action });
      assert.equal(r.ok, false, `should refuse action=${JSON.stringify(action)}`);
    }
    assert.equal(parseOwnerRequest(null).ok, false);
    assert.equal(parseOwnerRequest('pause').ok, false);
    assert.equal(parseOwnerRequest(['pause']).ok, false);
  });

  it('refuses a floor that is not a canonical positive integer string of base units', () => {
    for (const floorUsdc of [6_000_000, '0', '-1', '6.5', '06', ' 6', '', '1e6', '0x10', null, undefined, {}]) {
      const r = parseOwnerRequest({ action: 'floor', floorUsdc });
      assert.equal(r.ok, false, `should refuse floorUsdc=${JSON.stringify(floorUsdc)}`);
      assert.match(r.ok === false ? r.error : '', /floorUsdc/);
    }
  });

  it('ignores a floor sent with pause/resume — the payload carries only what the action needs', () => {
    const r = parseOwnerRequest({ action: 'pause', floorUsdc: '999' });
    assert.equal(r.ok, true);
    assert.deepEqual(r.ok && r.payload, {});
  });

  it('passes a well-formed requestId through and refuses a malformed one', () => {
    const ok = parseOwnerRequest({ action: 'pause', requestId: 'click-0000001' });
    assert.deepEqual(ok.ok && ok.payload, { requestId: 'click-0000001' });
    assert.equal(parseOwnerRequest({ action: 'pause', requestId: 'short' }).ok, false);
    assert.equal(parseOwnerRequest({ action: 'pause', requestId: 'has spaces in it' }).ok, false);
    assert.equal(parseOwnerRequest({ action: 'pause', requestId: 7 }).ok, false);
    assert.deepEqual(parseOwnerRequest({ action: 'pause', requestId: '' }).ok && { skipped: true }, { skipped: true });
  });
});
