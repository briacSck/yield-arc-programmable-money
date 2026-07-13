import { defineChain, type Chain } from 'viem';

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
  const rpcUrl = env.ARC_RPC_URL ?? '';
  const chainId = Number(env.ARC_CHAIN_ID ?? '31337');
  const decimals = Number(env.ARC_NATIVE_DECIMALS ?? '6');
  return defineChain({
    id: chainId,
    name: 'Arc Testnet',
    nativeCurrency: { name: 'USD Coin', symbol: 'USDC', decimals },
    rpcUrls: { default: { http: rpcUrl ? [rpcUrl] : [] } },
  });
}
