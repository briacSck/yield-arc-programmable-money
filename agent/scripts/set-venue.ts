/**
 * Owner call: point AgentMandateV2's deployed leg at the USYC Teller.
 *
 *   Preflight (read-only):  npx tsx agent/scripts/set-venue.ts
 *   Execute the owner call: npx tsx agent/scripts/set-venue.ts --execute
 *
 * Runs AFTER Circle/Hashnote granted the mandate CONTRACT both USYC roles (Teller.deposit +
 * hold-share) — verified on-chain 2026-07-31 via the Teller's own RolesAuthority. Until this call
 * the mandate is escrow-only (v1 behaviour); after it, DEPLOY moves route USDC into USYC shares.
 *
 * The contract defends itself: setVenue reverts while a position is open (VenueBusy), and rejects
 * any venue whose asset() is not this mandate's USDC (VenueAssetMismatch). The worker and the
 * nightly audit still point at v1 — this changes no live system's behaviour.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createPublicClient, http, parseAbi, formatUnits, getAddress, toFunctionSelector } from 'viem';
import { initiateDeveloperControlledWalletsClient } from '@circle-fin/developer-controlled-wallets';

const RPC = 'https://rpc.drpc.testnet.arc.io'; // the only endpoint that serves concurrent reads
const USYC_TELLER = '0x9fdF14c5B14173D74C08Af27AebFf39240dC105A' as const;
const MANDATE_V2_DEFAULT = '0xd41d3648c71641fb2801415726787d5728492f70' as const;

const TERMINAL_OK = new Set(['CONFIRMED', 'COMPLETE']);
const TERMINAL_BAD = new Set(['FAILED', 'DENIED', 'CANCELLED']);

const ENV_PATH = path.resolve(process.cwd(), '.env');

function readEnv(): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of readFileSync(ENV_PATH, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (m) map.set(m[1]!, m[2]!.trim());
  }
  return map;
}

function required(env: Map<string, string>, key: string): string {
  const v = env.get(key);
  if (!v) throw new Error(`.env: ${key} missing`);
  return v;
}

const MANDATE_ABI = parseAbi([
  'function owner() view returns (address)',
  'function venue() view returns (address)',
  'function venueShare() view returns (address)',
  'function deployedShares() view returns (uint256)',
]);
const TELLER_ABI = parseAbi([
  'function authority() view returns (address)',
  'function share() view returns (address)',
]);
const AUTH_ABI = parseAbi(['function canCall(address user, address target, bytes4 sig) view returns (bool)']);
const DEPOSIT_SIG = toFunctionSelector('deposit(uint256,address)');
const SHARE_TRANSFER_SIG = toFunctionSelector('transfer(address,uint256)');

async function main(): Promise<void> {
  const execute = process.argv.includes('--execute');

  const env = readEnv();
  const companyAddress = getAddress(required(env, 'COMPANY_ADDRESS'));
  const companyWalletId = required(env, 'CIRCLE_COMPANY_WALLET_ID');
  const mandate = getAddress(env.get('AGENT_MANDATE_V2_ADDRESS') ?? MANDATE_V2_DEFAULT);

  const pub = createPublicClient({ transport: http(RPC, { retryCount: 3 }) });

  console.log('AgentMandateV2 setVenue — Arc testnet\n');
  console.log(`  mandate v2      : ${mandate}`);
  console.log(`  venue (teller)  : ${USYC_TELLER}`);

  // ── Preflight: owner, current venue, roles, gas ──
  const [ownerOnChain, venueBefore, sharesHeld] = await Promise.all([
    pub.readContract({ address: mandate, abi: MANDATE_ABI, functionName: 'owner' }),
    pub.readContract({ address: mandate, abi: MANDATE_ABI, functionName: 'venue' }),
    pub.readContract({ address: mandate, abi: MANDATE_ABI, functionName: 'deployedShares' }),
  ]);
  console.log(`  owner on-chain  : ${ownerOnChain}${ownerOnChain.toLowerCase() === companyAddress.toLowerCase() ? ' (matches COMPANY_ADDRESS)' : '  ⚠️ DOES NOT MATCH COMPANY_ADDRESS'}`);
  console.log(`  venue before    : ${venueBefore}`);
  console.log(`  deployedShares  : ${sharesHeld}`);
  if (ownerOnChain.toLowerCase() !== companyAddress.toLowerCase()) throw new Error('owner mismatch — refusing');
  if (venueBefore.toLowerCase() === USYC_TELLER.toLowerCase()) {
    console.log('\n  Venue is ALREADY set to the USYC Teller. Nothing to do.');
    return;
  }
  if (sharesHeld !== 0n) throw new Error(`position open (${sharesHeld} shares) — setVenue would revert VenueBusy`);

  const authority = await pub.readContract({ address: USYC_TELLER, abi: TELLER_ABI, functionName: 'authority' });
  const shareToken = await pub.readContract({ address: USYC_TELLER, abi: TELLER_ABI, functionName: 'share' });
  const canCall = (user: `0x${string}`, target: `0x${string}`, sig: `0x${string}`) =>
    pub.readContract({ address: authority, abi: AUTH_ABI, functionName: 'canCall', args: [user, target, sig] });
  const [mayDeposit, mayHold] = await Promise.all([
    canCall(mandate, USYC_TELLER, DEPOSIT_SIG),
    canCall(mandate, shareToken, SHARE_TRANSFER_SIG),
  ]);
  console.log(`  Teller.deposit  : ${mayDeposit ? 'GRANTED' : 'NOT GRANTED'}`);
  console.log(`  hold USYC share : ${mayHold ? 'GRANTED' : 'NOT GRANTED'}`);
  if (!mayDeposit || !mayHold) throw new Error('mandate lacks a USYC role — setVenue now would arm a deploy path that reverts NotPermissioned(). Get the grant first.');

  const companyNative = await pub.getBalance({ address: companyAddress });
  console.log(`  company balance : ${formatUnits(companyNative, 18)} USDC (gas)`);

  if (!execute) {
    console.log('\n  (preflight only — nothing sent. Re-run with --execute to make the owner call.)');
    return;
  }

  // ── The owner call, through the company's Circle developer-controlled wallet ──
  const client = initiateDeveloperControlledWalletsClient({
    apiKey: required(env, 'CIRCLE_API_KEY'),
    entitySecret: required(env, 'CIRCLE_ENTITY_SECRET'),
  });

  console.log('\n[1] setVenue(teller) from the company wallet…');
  const res = await client.createContractExecutionTransaction({
    walletId: companyWalletId,
    contractAddress: mandate,
    abiFunctionSignature: 'setVenue(address)',
    abiParameters: [USYC_TELLER],
    fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
  });
  const txId = res.data?.id;
  if (!txId) throw new Error(`createContractExecutionTransaction returned no id: ${JSON.stringify(res.data)}`);

  const started = Date.now();
  let txHash: string | undefined;
  for (;;) {
    const t = await client.getTransaction({ id: txId });
    const state = t.data?.transaction?.state ?? 'UNKNOWN';
    if (TERMINAL_OK.has(state)) {
      txHash = t.data!.transaction!.txHash!;
      break;
    }
    if (TERMINAL_BAD.has(state)) throw new Error(`setVenue: ${state} (${t.data?.transaction?.errorReason ?? 'no reason'})`);
    if (Date.now() - started > 180_000) throw new Error(`setVenue: timeout (${state})`);
    await new Promise((r) => setTimeout(r, 2_000));
  }
  console.log(`[1] setVenue COMPLETE: https://testnet.arcscan.app/tx/${txHash}`);

  // ── Verify by reading back — the tx succeeding is not the claim; the state is ──
  const [venueAfter, shareAfter] = await Promise.all([
    pub.readContract({ address: mandate, abi: MANDATE_ABI, functionName: 'venue' }),
    pub.readContract({ address: mandate, abi: MANDATE_ABI, functionName: 'venueShare' }),
  ]);
  console.log(`[2] venue on-chain      : ${venueAfter}`);
  console.log(`[2] venueShare on-chain : ${shareAfter}`);
  if (venueAfter.toLowerCase() !== USYC_TELLER.toLowerCase()) throw new Error('read-back mismatch — venue not set?');
  console.log('\n  DONE. The mandate\'s deployed leg now routes to USYC. The worker still points at v1;');
  console.log('  nothing live changes until the v1→v2 switch decision (see docs/HANDOFF-VADIM.md).');
}

main().catch((err) => {
  console.error('set-venue failed:', err?.response?.data ?? err);
  process.exit(1);
});
