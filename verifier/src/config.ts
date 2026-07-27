/**
 * Compiled-in zero-config defaults — a judge runs `npx -y @yield-cfo/mandate-verify` with NO args,
 * NO env, NO prompts and it verifies YIELD's live mandate. Every value here is an override, never
 * a requirement (§18.2c DX spec).
 */

/** The live AgentMandate on Arc testnet (docs/NOW.md). */
export const DEFAULT_MANDATE_ADDRESS = '0x856bec6faadd61b583430e0cd22ec2e211c782b4' as const;

/** Constructor block (binary-searched on-chain 2026-07-23) — the first MandateChanged is here. */
export const DEFAULT_DEPLOY_BLOCK = 51_743_317n;

export const ARC_CHAIN_ID = 5042002;

/**
 * Arc testnet public endpoints in MEASURED preference order (2026-07-23, same request back-to-back
 * against the live mandate): only dRPC served concurrent `eth_getLogs`; the others rate-limit at
 * ~1 req/s or (Blockdaemon) prune historical logs. viem `fallback` advances on error. This is the
 * same pool the worker now uses (agent/src/chain/arc-chain.ts) — kept in sync by hand since the
 * verifier ships standalone on npm and cannot import the workspace.
 */
export const ARC_TESTNET_RPC_URLS = [
  'https://rpc.drpc.testnet.arc.io',
  'https://rpc.testnet.arc.io',
  'https://rpc.quicknode.testnet.arc.io',
  'https://rpc.testnet.arc.network',
] as const;

/** getLogs range cap measured on Arc testnet: 10,000 blocks per call. */
export const GETLOGS_MAX_RANGE = 10_000n;

/** Explorer bases for screenshot-able verdict footers. */
export const EXPLORER_TX_BASE = 'https://testnet.arcscan.app/tx/';
export const EXPLORER_ADDRESS_BASE = 'https://testnet.arcscan.app/address/';
export const DASHBOARD_URL = 'https://dashboard-production-abea.up.railway.app';
