/**
 * @yield-cfo/mandate-verify — programmatic surface. The CLI (`cli.ts`) is the judge path; this
 * barrel lets other tooling (the underwriter agent, tests, a second implementer) call the same
 * pure core and fetch layer.
 */
export { replay, expectedDecisionId, type ReplayOptions } from './core/replay.js';
export { fetchHistory, makeClient, assertChainId, MANDATE_EVENT_ABI, type FetchResult } from './fetch.js';
export * from './types.js';
export {
  DEFAULT_MANDATE_ADDRESS,
  DEFAULT_DEPLOY_BLOCK,
  ARC_CHAIN_ID,
  ARC_TESTNET_RPC_URLS,
  DASHBOARD_URL,
  EXPLORER_TX_BASE,
  EXPLORER_ADDRESS_BASE,
} from './config.js';
