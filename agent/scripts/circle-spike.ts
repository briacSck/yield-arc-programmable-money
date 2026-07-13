/**
 * The §9.1 gating spike, run AFTER circle-setup.ts + faucet funding:
 *
 *   Tx A — `createTransaction`: agent wallet sends 1 USDC → company wallet (wallet works on Arc).
 *   Tx B — `createContractExecutionTransaction`: agent wallet calls `approve(address,uint256)`
 *          on the USDC ERC-20 interface (0x3600…0000). Zero-risk call that proves the S1 signing
 *          surface: a Circle dev-controlled wallet CAN sign arbitrary contract calls on Arc —
 *          the exact surface `AgentMandate.deposit/withdrawToCompany` needs (§17.3).
 *
 * Run from repo root: npx tsx agent/scripts/circle-spike.ts
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { initiateDeveloperControlledWalletsClient } from '@circle-fin/developer-controlled-wallets';

const USDC_ERC20 = '0x3600000000000000000000000000000000000000'; // Arc testnet, 6 decimals
const EXPLORER_TX = 'https://testnet.arcscan.app/tx/';
const TERMINAL = new Set(['CONFIRMED', 'COMPLETE', 'FAILED', 'DENIED', 'CANCELLED']);

function readEnv(): Map<string, string> {
  const map = new Map<string, string>();
  const envPath = path.resolve(process.cwd(), '.env');
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (m) map.set(m[1], m[2].trim());
  }
  return map;
}

function required(env: Map<string, string>, key: string): string {
  const v = env.get(key);
  if (!v) throw new Error(`.env: ${key} is missing — run circle-setup.ts first.`);
  return v;
}

type Client = ReturnType<typeof initiateDeveloperControlledWalletsClient>;

async function waitForTerminal(client: Client, id: string, label: string) {
  const startedAt = Date.now();
  for (;;) {
    const res = await client.getTransaction({ id });
    const tx = res.data?.transaction;
    const state = tx?.state ?? 'UNKNOWN';
    if (tx && TERMINAL.has(state)) {
      const ms = Date.now() - startedAt;
      if (state === 'FAILED' || state === 'DENIED' || state === 'CANCELLED') {
        throw new Error(`${label}: terminal state ${state} (${tx.errorReason ?? 'no reason'})`);
      }
      console.log(`${label}: ${state} in ${ms}ms`);
      console.log(`${label}: txHash ${tx.txHash}`);
      console.log(`${label}: ${EXPLORER_TX}${tx.txHash}`);
      return tx;
    }
    if (Date.now() - startedAt > 120_000) throw new Error(`${label}: timeout (last state ${state})`);
    await new Promise((r) => setTimeout(r, 2_000));
  }
}

async function main(): Promise<void> {
  const env = readEnv();
  const client = initiateDeveloperControlledWalletsClient({
    apiKey: required(env, 'CIRCLE_API_KEY'),
    entitySecret: required(env, 'CIRCLE_ENTITY_SECRET'),
  });
  const agentWalletId = required(env, 'CIRCLE_AGENT_WALLET_ID');
  const companyAddress = required(env, 'COMPANY_ADDRESS');

  // Resolve the USDC token id from the agent wallet's balances (faucet must have landed).
  const balances = await client.getWalletTokenBalance({ id: agentWalletId, includeAll: true });
  const usdc = (balances.data?.tokenBalances ?? []).find((b) => b.token?.symbol?.startsWith('USDC'));
  if (!usdc?.token?.id) {
    throw new Error(
      `no USDC balance on agent wallet — faucet not landed? balances: ${JSON.stringify(balances.data?.tokenBalances?.map((b) => ({ sym: b.token?.symbol, amt: b.amount })))}`,
    );
  }
  console.log(`agent USDC balance: ${usdc.amount} (tokenId ${usdc.token.id})`);

  // ── Tx A: 1 USDC transfer, agent → company ──
  const a = await client.createTransaction({
    walletId: agentWalletId,
    tokenId: usdc.token.id,
    destinationAddress: companyAddress,
    amount: ['1'],
    fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
  });
  console.log(`Tx A submitted: id=${a.data?.id} state=${a.data?.state}`);
  await waitForTerminal(client, a.data!.id, 'Tx A (USDC transfer)');

  // ── Tx B: arbitrary contract call — approve(company, 1 USDC) on the USDC ERC-20 ──
  const b = await client.createContractExecutionTransaction({
    walletId: agentWalletId,
    contractAddress: USDC_ERC20,
    abiFunctionSignature: 'approve(address,uint256)',
    abiParameters: [companyAddress, '1000000'],
    fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
  });
  console.log(`Tx B submitted: id=${b.data?.id} state=${b.data?.state}`);
  await waitForTerminal(client, b.data!.id, 'Tx B (contract execution)');

  console.log('SPIKE COMPLETE: S1 signer model proven on ARC-TESTNET.');
}

main().catch((err) => {
  console.error('circle-spike failed:', err?.response?.data ?? err);
  process.exit(1);
});
