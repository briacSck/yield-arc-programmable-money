import type { ChainExecutor } from '@yield/shared';
import { MockChainExecutor } from './mock-chain-executor.js';

export { defineArcChain } from './arc-chain.js';
export { MockChainExecutor } from './mock-chain-executor.js';

/**
 * Selects the ChainExecutor from env. INVARIANT #3: `mock` must be chosen explicitly; there is no
 * silent default to the mock. An unset/unknown value throws rather than guessing — money movement
 * never runs against an unintended backend.
 */
export function selectChainExecutor(env: NodeJS.ProcessEnv = process.env): ChainExecutor {
  switch (env.CHAIN_EXECUTOR) {
    case 'mock':
      return new MockChainExecutor();
    case 'circle':
      // TODO(Vadim): real Circle-backed executor (agent wallet + AgentMandate on Arc, §17.3).
      throw new Error('CHAIN_EXECUTOR=circle not implemented yet (TODO Vadim).');
    default:
      throw new Error(
        `CHAIN_EXECUTOR must be set explicitly ('circle' | 'mock'); got ${JSON.stringify(env.CHAIN_EXECUTOR)}.`,
      );
  }
}
