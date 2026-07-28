import { test } from 'node:test';
import assert from 'node:assert/strict';
import { daysSince, shortHash, usdc, when } from './format.js';

/**
 * The dashboard had NO tests and no `test` script, so the root `npm test --workspaces` skipped it
 * entirely — the same silent-skip class as the CI glob bug. These cover the display edge, which is
 * where a formatting slip turns into a wrong number on the product's front page.
 */

test('usdc: ordinary amounts render at 2dp with thousands separators', () => {
  assert.equal(usdc('8469381'), '8.46 USDC');
  assert.equal(usdc('1530619'), '1.53 USDC');
  assert.equal(usdc('38000000000'), '38,000.00 USDC');
  assert.equal(usdc('0'), '0.00 USDC');
});

test('usdc: sub-cent amounts widen to 6dp so tiny tickets stay legible', () => {
  // The threshold is 0.01 (10_000 base units) — below it, 2dp would render a real amount as 0.00.
  assert.equal(usdc('4521'), '0.004521 USDC');
  assert.equal(usdc('1'), '0.000001 USDC');
  // …and at the boundary it goes back to 2dp.
  assert.equal(usdc('10000'), '0.01 USDC');
});

test('usdc: negatives use a true minus sign, not a hyphen', () => {
  assert.equal(usdc(-1_530_619n), '−1.53 USDC');
});

test('usdc: accepts bigint and string alike, and treats empty as zero', () => {
  assert.equal(usdc(8_469_381n), usdc('8469381'));
  assert.equal(usdc(''), '0.00 USDC');
});

test('when: null renders an em dash, never "Invalid Date"', () => {
  assert.equal(when(null), '—');
});

test('when: unparseable input passes through rather than fabricating a date', () => {
  assert.equal(when('not-a-date'), 'not-a-date');
});

test('when: relative recency crosses its units correctly', () => {
  const base = Date.parse('2026-07-28T12:00:00Z');
  assert.match(when('2026-07-28T11:30:00Z', base), /30m ago$/);
  assert.match(when('2026-07-28T06:00:00Z', base), /6h ago$/);
  assert.match(when('2026-07-24T12:00:00Z', base), /4d ago$/);
});

test('daysSince: floors, never goes negative, and tolerates junk', () => {
  const base = Date.parse('2026-07-28T12:00:00Z');
  assert.equal(daysSince('2026-07-14T08:21:00Z', base), 14);
  assert.equal(daysSince('2026-07-29T12:00:00Z', base), 0, 'a future date must not read as negative');
  assert.equal(daysSince(null), null);
  assert.equal(daysSince('nonsense'), null);
});

test('shortHash: elides long hashes and leaves short strings alone', () => {
  const h = '0x9b9d5ee2c1a4b7f3d8e6a2c5b1f4e7d0a3c6b9f2e5d8a1c4b7f0e3d6a9c2b54ffde7';
  assert.match(shortHash(h), /^0x9b9d5e…/);
  assert.equal(shortHash('0xabc'), '0xabc');
});
