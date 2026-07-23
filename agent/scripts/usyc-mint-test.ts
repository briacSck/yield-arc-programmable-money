/**
 * USYC venue test (plan §17.4) — is the deployed surplus's yield venue REAL on Arc testnet?
 *
 * The USYC Teller (`0x9fdF…C105A`) is an ERC-4626 vault: `deposit(assets, receiver)` takes USDC and
 * mints USYC shares; `redeem(shares, receiver, account)` unwinds. Access is allowlist-gated, and
 * the allowlist is READABLE — `maxDeposit(account)` and `subscriptionLimitRemaining(account, day)`
 * return 0 for a non-allowlisted wallet. So the definitive "are we actually enabled?" check needs
 * no transaction at all (default mode). `--execute` then proves an end-to-end USDC→USYC mint lands.
 *
 *   Preflight (default, READ-ONLY, moves nothing):
 *     npx tsx agent/scripts/usyc-mint-test.ts
 *   Execute a real mint (MOVES real testnet USDC from the agent wallet via Circle):
 *     npx tsx agent/scripts/usyc-mint-test.ts --execute --amount 1
 *
 * Confirmed 2026-07-23: the agent wallet IS allowlisted (subscriptionLimitRemaining = 1,000,000
 * USDC/day) despite Circle's confirmation email wording "USDC allowlist". This script is how we
 * flip the venue from disclosed stub to real, one arcscan tx at a time.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createPublicClient, http, parseAbi, formatUnits, parseUnits, getAddress } from 'viem';
import { initiateDeveloperControlledWalletsClient } from '@circle-fin/developer-controlled-wallets';

const USDC_ERC20 = '0x3600000000000000000000000000000000000000' as const; // Arc testnet, 6-dec
const USYC = '0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C' as const;
const TELLER = '0x9fdF14c5B14173D74C08Af27AebFf39240dC105A' as const;
const RPC = 'https://rpc.drpc.testnet.arc.io'; // the endpoint that serves concurrent reads (see arc-chain.ts)
const EXPLORER_TX = 'https://testnet.arcscan.app/tx/';
const TERMINAL = new Set(['CONFIRMED', 'COMPLETE', 'FAILED', 'DENIED', 'CANCELLED']);

/** Keep at least this much native USDC on the agent wallet for gas — never deposit it all. */
const GAS_RESERVE_USDC = 1_000_000n; // 1 USDC

function readEnv(): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of readFileSync(path.resolve(process.cwd(), '.env'), 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (m) map.set(m[1], m[2].trim());
  }
  return map;
}
function required(env: Map<string, string>, key: string): string {
  const v = env.get(key);
  if (!v) throw new Error(`.env: ${key} is missing.`);
  return v;
}

const TELLER_ABI = parseAbi([
  'function asset() view returns (address)',
  'function share() view returns (address)',
  'function maxDeposit(address) view returns (uint256)',
  'function maxRedeem(address) view returns (uint256)',
  'function subscriptionLimitRemaining(address account, uint256 date) view returns (uint256)',
  'function todayTimestamp() view returns (uint256)',
  'function previewDeposit(uint256 assets) view returns (uint256)',
  'function previewRedeem(uint256 shares) view returns (uint256)',
  'function deposit(uint256 assets, address receiver) returns (uint256)',
  'function redeem(uint256 shares, address receiver, address account) returns (uint256)',
]);
const ERC20_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
]);

type Client = ReturnType<typeof initiateDeveloperControlledWalletsClient>;
async function waitForTerminal(client: Client, id: string, label: string) {
  const started = Date.now();
  for (;;) {
    const tx = (await client.getTransaction({ id })).data?.transaction;
    const state = tx?.state ?? 'UNKNOWN';
    if (tx && TERMINAL.has(state)) {
      if (['FAILED', 'DENIED', 'CANCELLED'].includes(state)) {
        throw new Error(`${label}: ${state} (${tx.errorReason ?? 'no reason'})`);
      }
      console.log(`  ${label}: ${state} in ${Date.now() - started}ms — ${EXPLORER_TX}${tx.txHash}`);
      return tx;
    }
    if (Date.now() - started > 120_000) throw new Error(`${label}: timeout (last ${state})`);
    await new Promise((r) => setTimeout(r, 2_000));
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const execute = args.includes('--execute');
  const redeemMode = args.includes('--redeem'); // redeem ALL current USYC back to USDC
  const amountArg = args[args.indexOf('--amount') + 1];

  const env = readEnv();
  const agent = getAddress(required(env, 'AGENT_ADDRESS'));
  const pub = createPublicClient({ transport: http(RPC, { retryCount: 3 }) });

  const tRead = <T>(fn: string, a: unknown[] = []) =>
    pub.readContract({ address: TELLER, abi: TELLER_ABI, functionName: fn as never, args: a as never }) as Promise<T>;
  const eRead = <T>(token: `0x${string}`, fn: string, a: unknown[] = []) =>
    pub.readContract({ address: token, abi: ERC20_ABI, functionName: fn as never, args: a as never }) as Promise<T>;

  // ── Preflight (read-only) ──────────────────────────────────────────────────
  console.log('USYC VENUE PREFLIGHT (read-only)');
  console.log('  Teller :', TELLER);
  const asset = await tRead<`0x${string}`>('asset');
  const share = await tRead<`0x${string}`>('share');
  console.log('  asset  :', asset, getAddress(asset) === getAddress(USDC_ERC20) ? '= USDC ✓' : '⚠ unexpected');
  console.log('  share  :', share, getAddress(share) === getAddress(USYC) ? '= USYC ✓' : '⚠ unexpected');

  const today = await tRead<bigint>('todayTimestamp');
  const maxDeposit = await tRead<bigint>('maxDeposit', [agent]);
  const subRemaining = await tRead<bigint>('subscriptionLimitRemaining', [agent, today]);
  const usdcBal = await eRead<bigint>(USDC_ERC20, 'balanceOf', [agent]);
  const usycBal = await eRead<bigint>(USYC, 'balanceOf', [agent]);

  const allowlisted = subRemaining > 0n || maxDeposit > 0n;
  console.log(`\n  agent wallet: ${agent}`);
  console.log(`  USDC balance            : ${formatUnits(usdcBal, 6)} USDC`);
  console.log(`  USYC balance            : ${formatUnits(usycBal, 6)} USYC`);
  console.log(`  Teller.maxDeposit       : ${formatUnits(maxDeposit, 6)} USDC`);
  console.log(`  subscriptionLimitRemain : ${formatUnits(subRemaining, 6)} USDC/day`);
  console.log(`  >>> ALLOWLISTED FOR USYC: ${allowlisted ? 'YES ✓' : 'NO ✗'}`);

  if (!execute) {
    console.log('\n  (preflight only — `--execute --amount <USDC>` mints; `--execute --redeem` unwinds)');
    return;
  }

  const client = initiateDeveloperControlledWalletsClient({
    apiKey: required(env, 'CIRCLE_API_KEY'),
    entitySecret: required(env, 'CIRCLE_ENTITY_SECRET'),
  });
  const walletId = required(env, 'CIRCLE_AGENT_WALLET_ID');

  // ── Redeem path: USYC → USDC (proves the withdraw leg / round-trip) ─────────
  if (redeemMode) {
    if (usycBal <= 0n) throw new Error('nothing to redeem: USYC balance is 0.');
    const expectUsdc = await tRead<bigint>('previewRedeem', [usycBal]);
    console.log(`\n  REDEEMING: ${formatUnits(usycBal, 6)} USYC → expect ~${formatUnits(expectUsdc, 6)} USDC`);
    // caller == receiver == account (agent redeems its own shares) — no allowance needed.
    const rd = await client.createContractExecutionTransaction({
      walletId,
      contractAddress: TELLER,
      abiFunctionSignature: 'redeem(uint256,address,address)',
      abiParameters: [usycBal.toString(), agent, agent],
      fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
    });
    await waitForTerminal(client, rd.data!.id, 'redeem');
    const usycAfter = await eRead<bigint>(USYC, 'balanceOf', [agent]);
    const usdcAfter = await eRead<bigint>(USDC_ERC20, 'balanceOf', [agent]);
    console.log(`  USYC ${formatUnits(usycBal, 6)} → ${formatUnits(usycAfter, 6)} · USDC ${formatUnits(usdcBal, 6)} → ${formatUnits(usdcAfter, 6)}`);
    console.log('  USYC REDEEM LANDED ✓ — USYC→USDC round-trip proven on Arc testnet.');
    return;
  }

  // ── Mint path: USDC → USYC ──────────────────────────────────────────────────
  if (!allowlisted) throw new Error('refusing --execute: wallet is not allowlisted for USYC.');
  if (!amountArg) throw new Error('--execute requires --amount <USDC> (e.g. --amount 1).');
  const amount = parseUnits(amountArg, 6);
  if (amount <= 0n) throw new Error('--amount must be positive.');
  if (amount > maxDeposit) throw new Error(`--amount ${amountArg} exceeds maxDeposit ${formatUnits(maxDeposit, 6)}.`);
  if (usdcBal - amount < GAS_RESERVE_USDC) {
    throw new Error(
      `refusing: depositing ${amountArg} would leave ${formatUnits(usdcBal - amount, 6)} USDC, below the ${formatUnits(GAS_RESERVE_USDC, 6)} USDC gas reserve. Use a smaller --amount.`,
    );
  }
  const expectedShares = await tRead<bigint>('previewDeposit', [amount]);
  console.log(`\n  EXECUTING: deposit ${amountArg} USDC → expect ~${formatUnits(expectedShares, 6)} USYC`);

  // 1) approve(Teller, amount) on USDC — only if the existing allowance is short.
  const allowance = await eRead<bigint>(USDC_ERC20, 'allowance', [agent, TELLER]);
  if (allowance < amount) {
    const ap = await client.createContractExecutionTransaction({
      walletId,
      contractAddress: USDC_ERC20,
      abiFunctionSignature: 'approve(address,uint256)',
      abiParameters: [TELLER, amount.toString()],
      fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
    });
    await waitForTerminal(client, ap.data!.id, 'approve');
  } else {
    console.log('  approve: allowance already sufficient, skipping');
  }

  // 2) deposit(amount, agent) on the Teller — mints USYC to the agent wallet.
  const dep = await client.createContractExecutionTransaction({
    walletId,
    contractAddress: TELLER,
    abiFunctionSignature: 'deposit(uint256,address)',
    abiParameters: [amount.toString(), agent],
    fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
  });
  await waitForTerminal(client, dep.data!.id, 'deposit');

  // 3) Verify the USYC balance actually increased — the whole point of the test.
  const usycAfter = await eRead<bigint>(USYC, 'balanceOf', [agent]);
  const minted = usycAfter - usycBal;
  console.log(`\n  USYC before: ${formatUnits(usycBal, 6)} → after: ${formatUnits(usycAfter, 6)} (minted ${formatUnits(minted, 6)})`);
  if (minted <= 0n) throw new Error('deposit tx confirmed but USYC balance did not increase — investigate.');
  console.log('  USYC VENUE IS REAL ✓ — USDC→USYC mint landed on Arc testnet.');
}

main().catch((err) => {
  console.error('usyc-mint-test failed:', err?.response?.data ?? err?.message ?? err);
  process.exit(1);
});
