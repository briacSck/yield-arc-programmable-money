/**
 * Registers the agent's ERC-8004 identity on Arc testnet — the "who is acting" leg of the trust
 * stack (§4.6). The IdentityRegistry (0x8004A818…) is an ERC-721: `register(string agentURI)`
 * mints the agent identity NFT to msg.sender (the agent's Circle wallet, via
 * createContractExecutionTransaction — the S1 surface proven in the day-1 spike).
 *
 * Idempotent: `balanceOf(agent) > 0` means already registered — skip (eng review #24).
 * Run: npx tsx agent/scripts/register-identity.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createPublicClient, decodeEventLog, http, parseAbi } from 'viem';
import { initiateDeveloperControlledWalletsClient } from '@circle-fin/developer-controlled-wallets';

const REGISTRY = '0x8004A818BFB912233c491871b3d84c89A494BD9e' as const; // Arc testnet, verified via arc-docs
const AGENT_URI = 'https://github.com/briacSck/yield-arc-programmable-money';

const REGISTRY_ABI = parseAbi([
  'function balanceOf(address owner) view returns (uint256)',
  'function register(string agentURI) returns (uint256)',
  'function getAgentWallet(uint256 agentId) view returns (address)',
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
]);

const ENV_PATH = path.resolve(process.cwd(), '.env');

function readEnv(): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of readFileSync(ENV_PATH, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (m) map.set(m[1], m[2].trim());
  }
  return map;
}

function upsertEnv(key: string, value: string): void {
  const raw = readFileSync(ENV_PATH, 'utf8');
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, 'm');
  writeFileSync(ENV_PATH, re.test(raw) ? raw.replace(re, line) : raw.replace(/\n?$/, `\n${line}\n`), 'utf8');
}

async function main(): Promise<void> {
  const env = readEnv();
  const agentAddress = env.get('AGENT_ADDRESS') as `0x${string}`;
  const rpcUrl = env.get('ARC_RPC_URL')!;
  if (!agentAddress || !rpcUrl) throw new Error('.env: AGENT_ADDRESS / ARC_RPC_URL missing');

  const pub = createPublicClient({ transport: http(rpcUrl) });

  const already = await pub.readContract({
    address: REGISTRY,
    abi: REGISTRY_ABI,
    functionName: 'balanceOf',
    args: [agentAddress],
  });
  if (already > 0n) {
    console.log(`agent ${agentAddress} already holds ${already} identity token(s) — skipping registration.`);
    upsertEnv('IDENTITY_REGISTRY_ADDRESS', REGISTRY);
    return;
  }

  const client = initiateDeveloperControlledWalletsClient({
    apiKey: env.get('CIRCLE_API_KEY')!,
    entitySecret: env.get('CIRCLE_ENTITY_SECRET')!,
  });
  console.log(`registering ERC-8004 identity for ${agentAddress}…`);
  const submitted = await client.createContractExecutionTransaction({
    walletId: env.get('CIRCLE_AGENT_WALLET_ID')!,
    contractAddress: REGISTRY,
    abiFunctionSignature: 'register(string)',
    abiParameters: [AGENT_URI],
    fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
  });

  const started = Date.now();
  let txHash: string | undefined;
  for (;;) {
    const res = await client.getTransaction({ id: submitted.data!.id });
    const state = res.data?.transaction?.state ?? 'UNKNOWN';
    if (state === 'CONFIRMED' || state === 'COMPLETE') {
      txHash = res.data!.transaction!.txHash!;
      break;
    }
    if (['FAILED', 'DENIED', 'CANCELLED'].includes(state)) {
      throw new Error(`registration ${state}: ${res.data?.transaction?.errorReason ?? 'no reason'}`);
    }
    if (Date.now() - started > 120_000) throw new Error(`registration timeout (${state})`);
    await new Promise((r) => setTimeout(r, 2_000));
  }

  // Recover the minted agentId from the ERC-721 Transfer(0x0 → agent, tokenId) in the receipt.
  const receipt = await pub.waitForTransactionReceipt({ hash: txHash as `0x${string}`, timeout: 60_000 });
  let agentId: bigint | undefined;
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== REGISTRY.toLowerCase()) continue;
    try {
      const parsed = decodeEventLog({ abi: REGISTRY_ABI, data: log.data, topics: log.topics });
      if (parsed.eventName === 'Transfer') agentId = (parsed.args as { tokenId: bigint }).tokenId;
    } catch {
      /* other registry events — ignore */
    }
  }

  console.log(`ERC-8004 identity REGISTERED: agentId=${agentId ?? '(see explorer)'}`);
  console.log(`  tx: https://testnet.arcscan.app/tx/${txHash}`);
  console.log(`  registry: https://testnet.arcscan.app/address/${REGISTRY}`);
  upsertEnv('IDENTITY_REGISTRY_ADDRESS', REGISTRY);
  if (agentId !== undefined) upsertEnv('AGENT_IDENTITY_ID', agentId.toString());
}

main().catch((err) => {
  console.error('register-identity failed:', err?.response?.data ?? err);
  process.exit(1);
});
