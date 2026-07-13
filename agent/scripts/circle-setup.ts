/**
 * One-time Circle account setup for the Arc gating spike (plan §9.1 / §17.3 S1).
 *
 * Idempotent: each step is skipped if its output already exists in `.env`. Run from repo root:
 *   npx tsx agent/scripts/circle-setup.ts
 *
 * Steps:
 *   1. Generate + register the entity secret (recovery file saved OUTSIDE the repo).
 *   2. Create the wallet set.
 *   3. Create two ARC-TESTNET EOA wallets: `agent` (the CFO agent's signer) and `company`
 *      (the company treasury the agent serves — also the spike's transfer destination).
 *   4. Faucet-fund the agent wallet (programmatic; fallback: https://faucet.circle.com).
 *
 * SECURITY: never logs the API key or entity secret. Registration is NON-idempotent on Circle's
 * side — if `CIRCLE_ENTITY_SECRET` is set in .env we never attempt to re-register.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import {
  initiateDeveloperControlledWalletsClient,
  registerEntitySecretCiphertext,
} from '@circle-fin/developer-controlled-wallets';

const ENV_PATH = path.resolve(process.cwd(), '.env');
const RECOVERY_DIR = path.join(homedir(), 'circle-recovery'); // outside the repo, plan §15.5

function readEnv(): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of readFileSync(ENV_PATH, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (m) map.set(m[1], m[2].trim());
  }
  return map;
}

/** Replace `KEY=...` in place if the line exists (even empty), else append. Preserves comments. */
function upsertEnv(key: string, value: string): void {
  const raw = readFileSync(ENV_PATH, 'utf8');
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, 'm');
  const next = re.test(raw) ? raw.replace(re, line) : raw.replace(/\n?$/, `\n${line}\n`);
  writeFileSync(ENV_PATH, next, 'utf8');
}

async function main(): Promise<void> {
  const env = readEnv();
  const apiKey = env.get('CIRCLE_API_KEY');
  if (!apiKey) throw new Error('.env: CIRCLE_API_KEY is empty — paste the testnet key first.');

  // 1. Entity secret — generate + register once, store recovery file outside the repo.
  let entitySecret = env.get('CIRCLE_ENTITY_SECRET');
  if (!entitySecret) {
    entitySecret = randomBytes(32).toString('hex');
    if (!existsSync(RECOVERY_DIR)) mkdirSync(RECOVERY_DIR, { recursive: true });
    // Persist BEFORE registering: registration is non-idempotent on Circle's side, so losing the
    // secret to a post-register crash (e.g. recovery-file write failure) must be impossible.
    upsertEnv('CIRCLE_ENTITY_SECRET', entitySecret);
    // NOTE: the SDK treats recoveryFileDownloadPath as a DIRECTORY and appends its own filename.
    await registerEntitySecretCiphertext({
      apiKey,
      entitySecret,
      recoveryFileDownloadPath: RECOVERY_DIR,
    });
    console.log(`[1/4] entity secret registered; recovery file saved in: ${RECOVERY_DIR}`);
  } else {
    console.log('[1/4] entity secret already present — skipping registration');
  }

  const client = initiateDeveloperControlledWalletsClient({ apiKey, entitySecret });

  // 2. Wallet set.
  let walletSetId = env.get('CIRCLE_WALLET_SET_ID');
  if (!walletSetId) {
    const res = await client.createWalletSet({ name: 'yield-agentic-cfo' });
    walletSetId = res.data?.walletSet?.id;
    if (!walletSetId) throw new Error('createWalletSet returned no id');
    upsertEnv('CIRCLE_WALLET_SET_ID', walletSetId);
    console.log(`[2/4] wallet set created: ${walletSetId}`);
  } else {
    console.log(`[2/4] wallet set already present: ${walletSetId}`);
  }

  // 3. Agent + company wallets (ARC-TESTNET, EOA — Circle's blessed Arc quickstart path).
  if (!env.get('AGENT_ADDRESS') || !env.get('COMPANY_ADDRESS')) {
    const res = await client.createWallets({
      walletSetId,
      blockchains: ['ARC-TESTNET'],
      count: 2,
      accountType: 'EOA',
      metadata: [
        { name: 'yield-cfo-agent', refId: 'agent' },
        { name: 'yield-company-treasury', refId: 'company' },
      ],
    });
    const wallets = res.data?.wallets ?? [];
    if (wallets.length < 2) throw new Error(`expected 2 wallets, got ${wallets.length}`);
    const agent = wallets.find((w) => w.refId === 'agent') ?? wallets[0];
    const company = wallets.find((w) => w.refId === 'company') ?? wallets[1];
    upsertEnv('CIRCLE_AGENT_WALLET_ID', agent.id);
    upsertEnv('AGENT_ADDRESS', agent.address);
    upsertEnv('CIRCLE_COMPANY_WALLET_ID', company.id);
    upsertEnv('COMPANY_ADDRESS', company.address);
    console.log(`[3/4] agent wallet:   ${agent.address} (${agent.id})`);
    console.log(`      company wallet: ${company.address} (${company.id})`);
  } else {
    console.log(`[3/4] wallets already present: agent=${env.get('AGENT_ADDRESS')}`);
  }

  // 4. Faucet-fund the agent wallet (USDC doubles as gas on Arc).
  const agentAddress = readEnv().get('AGENT_ADDRESS')!;
  try {
    await client.requestTestnetTokens({
      address: agentAddress,
      blockchain: 'ARC-TESTNET',
      usdc: true,
      native: true,
    });
    console.log(`[4/4] faucet requested for ${agentAddress} (USDC + native)`);
  } catch (err) {
    console.log(
      `[4/4] programmatic faucet failed (${(err as Error).message}) — fund manually at https://faucet.circle.com (Arc Testnet → ${agentAddress})`,
    );
  }

  console.log('setup complete.');
}

main().catch((err) => {
  console.error('circle-setup failed:', err?.response?.data ?? err);
  process.exit(1);
});
