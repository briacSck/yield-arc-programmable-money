import { defineChain, fallback, http, type Chain, type Transport } from 'viem';

/**
 * Single source of truth for the Arc chain viem config.
 *
 * Extracted from `yield-backend` (`feat/arc-sprint-identity`, `src/arc/arc-chain.ts`) with the
 * NestJS `ConfigService` dependency removed — reads plain env instead (plan §5: "extract logic,
 * drop framework"). Every client (escrow, identity) must build from this one definition so the
 * chainId and native-currency decimals can never drift between signers.
 *
 * Confirmed values (yield-backend .env.example): real Arc testnet chainId=5042002, native USDC=18
 * decimals; local Hardhat=31337; CI sets ARC_NATIVE_DECIMALS=6 explicitly. Defaults here match the
 * local-Hardhat case so `compile`/`test` work with no `.env`.
 */
export function defineArcChain(env: NodeJS.ProcessEnv = process.env): Chain {
  const urls = arcRpcUrls(env);
  const chainId = Number(env.ARC_CHAIN_ID ?? '31337');
  const decimals = Number(env.ARC_NATIVE_DECIMALS ?? '6');
  return defineChain({
    id: chainId,
    name: 'Arc Testnet',
    nativeCurrency: { name: 'USD Coin', symbol: 'USDC', decimals },
    rpcUrls: { default: { http: urls } },
  });
}

/**
 * Arc testnet public endpoints, in measured preference order — the fallback pool.
 *
 * MEASURED 2026-07-23 against the live mandate (same request, same machine, back to back):
 *   - `rpc.drpc.testnet.arc.io`        10/10 concurrent `eth_getLogs` in 273 ms  ← only viable pool
 *   - `rpc.testnet.arc.io`             1/10  — `request limit reached`
 *   - `rpc.quicknode.testnet.arc.io`   0/10  — `request limit reached`
 *   - `rpc.testnet.arc.network`        0/10  — `request limit reached`; ~1 req/s sustained
 *   - `rpc.blockdaemon.testnet.arc.io` `pruned history unavailable` (no historical logs) — EXCLUDED
 *
 * Why this exists: the worker ran `ARC_RPC_URL=https://rpc.testnet.arc.network` alone and that
 * endpoint's rate limit killed 759 consecutive cycles (2026-07-15 → 2026-07-23) — every one a
 * `HOLD: cycle inputs failed` on degraded input. The agent behaved CORRECTLY (invariant #4: any
 * degraded input → HOLD); the single point of failure was the transport. A one-endpoint treasury
 * agent is one rate limit away from silence, so liveness now depends on a pool, not a host.
 *
 * All entries are public, unauthenticated, chainId 5042002. Order matters: viem's `fallback`
 * tries them in sequence and only advances on error.
 */
export const ARC_TESTNET_RPC_URLS = [
  'https://rpc.drpc.testnet.arc.io',
  'https://rpc.testnet.arc.io',
  'https://rpc.quicknode.testnet.arc.io',
  'https://rpc.testnet.arc.network',
] as const;

/**
 * Resolved endpoint list. `ARC_RPC_URLS` (comma-separated) replaces the pool outright;
 * `ARC_RPC_URL` (single, back-compat) is PREPENDED as the preferred endpoint rather than
 * replacing the pool — an operator's override should add a preference, never re-create the
 * single point of failure this pool exists to remove. Deduped, order-preserving.
 */
export function arcRpcUrls(env: NodeJS.ProcessEnv = process.env): string[] {
  const explicit = (env.ARC_RPC_URLS ?? '')
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean);
  if (explicit.length > 0) return [...new Set(explicit)];
  const primary = (env.ARC_RPC_URL ?? '').trim();
  // A local/CI chain (Hardhat) is a deliberate single endpoint — never pad it with public Arc hosts.
  if (primary && Number(env.ARC_CHAIN_ID ?? '31337') !== 5042002) return [primary];
  return [...new Set([...(primary ? [primary] : []), ...ARC_TESTNET_RPC_URLS])];
}

/**
 * The transport every read client should use: ordered fallback across {@link arcRpcUrls} with
 * per-endpoint retry. `rank: false` keeps the measured order fixed — latency ranking would happily
 * promote a fast-but-rate-limited host over the one that actually answers.
 */
export function arcTransport(env: NodeJS.ProcessEnv = process.env): Transport {
  const urls = arcRpcUrls(env);
  return fallback(
    urls.map((url) => http(url, { retryCount: 2, retryDelay: 400, timeout: 20_000 })),
    { rank: false, retryCount: 1 },
  );
}
