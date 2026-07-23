import {
  createPublicClient,
  fallback,
  http,
  parseAbi,
  parseEventLogs,
  type Log,
  type PublicClient,
} from 'viem';
import { ARC_CHAIN_ID, ARC_TESTNET_RPC_URLS, GETLOGS_MAX_RANGE } from './config.js';
import type { NormalizedEvent } from './types.js';

/**
 * Layer 1 — chain → NormalizedEvent[]. The ONLY I/O in the verifier. Everything below the
 * `parseEventLogs` line is deterministic and belongs (conceptually) to the pure core.
 *
 * Design choices pinned by §18.1.2b:
 *   - ONE address-only getLogs per chunk (no topic filter) + parseEventLogs({strict:false}), so
 *     unknown topics (Arc's EIP-7708 native-Transfer logs) are tolerated, not fatal.
 *   - Order by (blockNumber, logIndex) — NEVER timestamp (Arc sub-second blocks share timestamps).
 *   - Batched getBlock for the deposit timestamps the window math needs.
 *   - toBlock pinned once at scan start (latest − lag); report scannedThroughBlock in the verdict.
 */

/** Max simultaneous RPC calls — bounds BOTH getLogs and getBlock (most public Arc endpoints
 *  rate-limit ~1 req/s; dRPC, the pool's first entry, serves concurrency). */
const CONCURRENCY = 10;

/** Run `fn` over `items` with at most `concurrency` in flight. Rejects if any task rejects. */
async function runPool<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      for (;;) {
        const item = queue.shift();
        if (item === undefined) return;
        await fn(item);
      }
    }),
  );
}

export const MANDATE_EVENT_ABI = parseAbi([
  'event DecisionExecuted(bytes32 indexed decisionId, uint8 kind, uint256 amount, bytes32 forecastHash)',
  'event MandateChanged(uint256 floor, uint256 maxTicket, uint256 dailyCap)',
  'event Revoked(address by)',
  'event Reinstated(address by)',
  'event CompanyFunded(uint256 amount, uint256 newCompanyBalance)',
  'event EmergencyWithdrawal(address to, uint256 amount)',
]);

export interface FetchOptions {
  rpcUrls?: readonly string[];
  chainId?: number;
  /** Blocks behind head to pin toBlock (deterministic re-runs, avoids reorg tips — Arc has none but be safe). */
  headLag?: bigint;
  /** Progress callback for streamed CLI output (chunks done / total). */
  onProgress?: (done: number, total: number) => void;
}

export interface FetchResult {
  events: NormalizedEvent[];
  scannedThroughBlock: bigint;
  chainId: number;
  unknownLogCount: number;
}

export function makeClient(rpcUrls: readonly string[] = ARC_TESTNET_RPC_URLS): PublicClient {
  return createPublicClient({
    transport: fallback(
      rpcUrls.map((url) => http(url, { retryCount: 3, retryDelay: 500, timeout: 30_000 })),
      { rank: false, retryCount: 1 },
    ),
  });
}

/**
 * chainId preflight — a wrong `--rpc` must NEVER produce an empty-history "vacuously compliant"
 * verdict (a wrong verdict is the one thing an audit tool cannot emit). Throws with both chains named.
 */
export async function assertChainId(client: PublicClient, expected: number): Promise<void> {
  const actual = await client.getChainId();
  if (actual !== expected) {
    throw new Error(
      `chainId mismatch: RPC reports ${actual}, expected Arc testnet ${expected}. ` +
        `A wrong endpoint would make an empty scan look "compliant" — refusing. Fix: drop --rpc to use the built-in pool.`,
    );
  }
}

export async function fetchHistory(
  mandateAddress: `0x${string}`,
  deployBlock: bigint,
  opts: FetchOptions = {},
): Promise<FetchResult> {
  const chainId = opts.chainId ?? ARC_CHAIN_ID;
  const client = makeClient(opts.rpcUrls);
  await assertChainId(client, chainId);

  const head = await client.getBlockNumber();
  const scannedThroughBlock = head - (opts.headLag ?? 0n);
  if (scannedThroughBlock < deployBlock) {
    throw new Error(`head ${scannedThroughBlock} is before deploy block ${deployBlock} — wrong chain or wrong deploy block.`);
  }

  // Chunk the range at the provider's getLogs cap; run with bounded concurrency.
  const ranges: Array<[bigint, bigint]> = [];
  for (let from = deployBlock; from <= scannedThroughBlock; from += GETLOGS_MAX_RANGE) {
    const to = from + GETLOGS_MAX_RANGE - 1n > scannedThroughBlock ? scannedThroughBlock : from + GETLOGS_MAX_RANGE - 1n;
    ranges.push([from, to]);
  }

  const total = ranges.length;
  let done = 0;
  const raw: Log[] = [];
  await runPool(ranges, CONCURRENCY, async (r) => {
    const logs = await client.getLogs({ address: mandateAddress, fromBlock: r[0], toBlock: r[1] });
    raw.push(...logs);
    opts.onProgress?.(++done, total);
  });

  // Order by (blockNumber, logIndex) BEFORE decoding — the sole ordering key.
  raw.sort((a, b) => {
    const bn = Number((a.blockNumber ?? 0n) - (b.blockNumber ?? 0n));
    return bn !== 0 ? bn : (a.logIndex ?? 0) - (b.logIndex ?? 0);
  });

  const decoded = parseEventLogs({ abi: MANDATE_EVENT_ABI, logs: raw, strict: false }) as DecodedMandateLog[];
  const unknownLogCount = raw.length - decoded.length;

  // Timestamps for every block that carries a decoded event (window math needs deposit ts).
  // Bounded concurrency — same cap as getLogs. An UNBOUNDED Promise.all here would burst hundreds
  // of simultaneous getBlock calls at endpoints that rate-limit ~1 req/s, failing the whole scan.
  const blockNumbers = [...new Set(decoded.map((d) => d.blockNumber))];
  const tsByBlock = new Map<bigint, bigint>();
  await runPool(blockNumbers, CONCURRENCY, async (bn) => {
    const block = await client.getBlock({ blockNumber: bn });
    tsByBlock.set(bn, block.timestamp);
  });

  const events: NormalizedEvent[] = decoded.map((d) => normalize(d, tsByBlock.get(d.blockNumber)!));

  return { events, scannedThroughBlock, chainId, unknownLogCount };
}

/** The subset of a decoded viem log the normalizer reads. */
interface DecodedMandateLog {
  eventName: string;
  args: Record<string, unknown>;
  blockNumber: bigint;
  logIndex: number;
  transactionHash: `0x${string}` | null;
}

/** Decoded viem log → NormalizedEvent. Narrowed per event name. */
function normalize(d: DecodedMandateLog, timestamp: bigint): NormalizedEvent {
  const base = {
    blockNumber: d.blockNumber,
    logIndex: d.logIndex,
    timestamp,
    txHash: d.transactionHash ?? undefined,
  };
  const a = d.args;
  switch (d.eventName) {
    case 'MandateChanged':
      return { ...base, name: 'MandateChanged', args: { floor: a.floor as bigint, maxTicket: a.maxTicket as bigint, dailyCap: a.dailyCap as bigint } };
    case 'CompanyFunded':
      return { ...base, name: 'CompanyFunded', args: { amount: a.amount as bigint, newCompanyBalance: a.newCompanyBalance as bigint } };
    case 'DecisionExecuted':
      return {
        ...base,
        name: 'DecisionExecuted',
        args: { decisionId: a.decisionId as `0x${string}`, kind: Number(a.kind), amount: a.amount as bigint, forecastHash: a.forecastHash as `0x${string}` },
      };
    case 'Revoked':
      return { ...base, name: 'Revoked', args: { by: a.by as `0x${string}` } };
    case 'Reinstated':
      return { ...base, name: 'Reinstated', args: { by: a.by as `0x${string}` } };
    case 'EmergencyWithdrawal':
      return { ...base, name: 'EmergencyWithdrawal', args: { to: a.to as `0x${string}`, amount: a.amount as bigint } };
    default:
      throw new Error(`unexpected decoded event ${d.eventName}`);
  }
}
