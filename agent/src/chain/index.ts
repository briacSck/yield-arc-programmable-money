import * as circleSdkModule from '@circle-fin/developer-controlled-wallets';
import type { ChainExecutor } from '@yield/shared';
import { CircleChainExecutor } from './circle-chain-executor.js';
import { MockChainExecutor } from './mock-chain-executor.js';
import { CircleOwnerActions } from './owner-actions.js';

/**
 * ESM/CJS interop: on some Node versions the Circle SDK resolves to its CJS bundle, whose named
 * exports aren't statically analyzable — a bare named import crashes at module load ("does not
 * provide an export named…"). The namespace + default fallback works on every resolution.
 */
type CircleSdkShape = {
  initiateDeveloperControlledWalletsClient: typeof circleSdkModule.initiateDeveloperControlledWalletsClient;
};
const sdkNamespace = circleSdkModule as unknown as CircleSdkShape & { default?: CircleSdkShape };
const initiateDeveloperControlledWalletsClient =
  sdkNamespace.initiateDeveloperControlledWalletsClient ??
  sdkNamespace.default?.initiateDeveloperControlledWalletsClient;
if (!initiateDeveloperControlledWalletsClient) {
  throw new Error('Circle SDK loaded without initiateDeveloperControlledWalletsClient (ESM/CJS interop)');
}

export { defineArcChain } from './arc-chain.js';
export { CircleChainExecutor, idempotencyKeyFor, onChainDecisionId } from './circle-chain-executor.js';
export type { CircleWalletsSdk, CircleChainExecutorConfig } from './circle-chain-executor.js';
export { MockChainExecutor } from './mock-chain-executor.js';
export {
  CircleOwnerActions,
  OwnerActionInputError,
  checkOwnerSecret,
  ownerIdempotencyKey,
  parseFloorUnits,
  parseRequestId,
  parseUnits,
} from './owner-actions.js';
export type { OwnerActionKind, OwnerActionResult, OwnerActionsPort } from './owner-actions.js';

function requireEnv(env: NodeJS.ProcessEnv, key: string): string {
  const v = env[key];
  if (!v) throw new Error(`CHAIN_EXECUTOR=circle requires ${key} in the environment.`);
  return v;
}

/**
 * Selects the ChainExecutor from env. INVARIANT #3: `mock` must be chosen explicitly; there is no
 * silent default to the mock. An unset/unknown value throws rather than guessing — money movement
 * never runs against an unintended backend.
 */
export function selectChainExecutor(env: NodeJS.ProcessEnv = process.env): ChainExecutor {
  switch (env.CHAIN_EXECUTOR) {
    case 'mock':
      return new MockChainExecutor();
    case 'circle': {
      // S1 signer model (§17.3), proven on ARC-TESTNET 2026-07-14 (see agent/scripts/circle-spike.ts).
      const sdk = initiateDeveloperControlledWalletsClient({
        apiKey: requireEnv(env, 'CIRCLE_API_KEY'),
        entitySecret: requireEnv(env, 'CIRCLE_ENTITY_SECRET'),
      });
      return new CircleChainExecutor(sdk, {
        walletId: requireEnv(env, 'CIRCLE_AGENT_WALLET_ID'),
        mandateAddress: requireEnv(env, 'AGENT_MANDATE_ADDRESS'),
      });
    }
    default:
      throw new Error(
        `CHAIN_EXECUTOR must be set explicitly ('circle' | 'mock'); got ${JSON.stringify(env.CHAIN_EXECUTOR)}.`,
      );
  }
}

/**
 * Builds the OWNER's controls (pause / restart / adjust floor) — signed by the COMPANY wallet.
 *
 * Deliberately independent of `CHAIN_EXECUTOR` and of `SCHEDULER_MODE`: revoking a mandate is an
 * owner right, not an agent capability, so it stays available even while the agent is merely
 * observing. Returns `null` (never throws) when the credentials are absent — a worker without
 * Circle owner creds must still boot and serve `/events`; the endpoint then answers 503 with a
 * reason instead of the process dying at startup.
 */
export function selectOwnerActions(env: NodeJS.ProcessEnv = process.env): CircleOwnerActions | null {
  const { CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET, CIRCLE_COMPANY_WALLET_ID, AGENT_MANDATE_ADDRESS } = env;
  if (!CIRCLE_API_KEY || !CIRCLE_ENTITY_SECRET || !CIRCLE_COMPANY_WALLET_ID || !AGENT_MANDATE_ADDRESS) {
    return null;
  }
  try {
    const sdk = initiateDeveloperControlledWalletsClient({
      apiKey: CIRCLE_API_KEY,
      entitySecret: CIRCLE_ENTITY_SECRET,
    });
    return new CircleOwnerActions(sdk, {
      walletId: CIRCLE_COMPANY_WALLET_ID,
      mandateAddress: AGENT_MANDATE_ADDRESS,
    });
  } catch (err) {
    // A malformed entity secret must not take the whole loop down at boot in observe mode, where
    // nothing else builds an SDK client. Owner controls degrade to 503; the agent keeps running.
    console.error(`[owner] Circle client unavailable — owner controls disabled: ${(err as Error).message}`);
    return null;
  }
}
