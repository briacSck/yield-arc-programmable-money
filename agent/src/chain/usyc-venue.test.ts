import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPublicClient, http } from 'viem';
import {
  USYCVenue,
  USDC_ERC20,
  USYC_TELLER,
  USYC_TOKEN,
  type IVenue,
} from './usyc-venue.js';

/**
 * Two layers:
 *  1. Call-spec construction is PURE — no network. Asserts the executor gets the exact ABI shape.
 *  2. A live-read smoke test (opt-in via ARC_RPC_TEST=1) hits the real Teller — proves the venue
 *     reads and the agent wallet's allowlist, without moving a cent. Kept opt-in so CI without an
 *     Arc RPC stays green; the money-move round-trip is proven by `scripts/usyc-mint-test.ts`.
 */

const AGENT = '0x93d9c11c8e9e23e1e97e855668a27a14accaab7c' as const;

// A client is only needed for the live reads; the call-spec tests never touch it.
function venue(): USYCVenue {
  return new USYCVenue(createPublicClient({ transport: http('https://rpc.drpc.testnet.arc.io') }));
}

test('mintCall targets the Teller with deposit(assets, receiver)', () => {
  const call = venue().mintCall(1_000_000n, AGENT);
  assert.equal(call.contractAddress, USYC_TELLER);
  assert.equal(call.abiFunctionSignature, 'deposit(uint256,address)');
  assert.deepEqual(call.abiParameters, ['1000000', AGENT]);
});

test('approveCall targets USDC and approves the Teller as spender', () => {
  const call = venue().approveCall(1_000_000n);
  assert.equal(call.contractAddress, USDC_ERC20);
  assert.equal(call.abiFunctionSignature, 'approve(address,uint256)');
  assert.deepEqual(call.abiParameters, [USYC_TELLER, '1000000']);
});

test('redeemCall targets the Teller with redeem(shares, receiver, account)', () => {
  const call = venue().redeemCall(883_398n, AGENT, AGENT);
  assert.equal(call.contractAddress, USYC_TELLER);
  assert.equal(call.abiFunctionSignature, 'redeem(uint256,address,address)');
  assert.deepEqual(call.abiParameters, ['883398', AGENT, AGENT]);
});

test('the adapter satisfies the IVenue seam (structural)', () => {
  const v: IVenue = venue(); // compile-time: USYCVenue is assignable to IVenue
  assert.equal(typeof v.previewDeposit, 'function');
  assert.equal(typeof v.previewRedeem, 'function');
  assert.equal(typeof v.isAllowlisted, 'function');
});

test('USYC token address is the ERC-4626 share token', () => {
  // Guards against a copy-paste swap of the token/teller/asset addresses.
  assert.notEqual(USYC_TOKEN, USYC_TELLER);
  assert.notEqual(USYC_TOKEN, USDC_ERC20);
});

// Opt-in live smoke test — proves the venue reads the real Teller + allowlist.
test('live: agent wallet is allowlisted and previews are sane', { skip: process.env.ARC_RPC_TEST !== '1' }, async () => {
  const v = venue();
  assert.equal(await v.isAllowlisted(AGENT), true);
  const shares = await v.previewDeposit(1_000_000n); // 1 USDC
  assert.ok(shares > 0n && shares <= 1_100_000n, `unexpected shares for 1 USDC: ${shares}`);
  const usdc = await v.previewRedeem(shares);
  assert.ok(usdc > 900_000n, `redeem preview too low: ${usdc}`);
});
