import { z } from 'zod';
import { Bytes32Hex, HexBytes } from './primitives.js';
import type { Decision } from './decision.js';

/**
 * The result of settling one `Decision` on-chain:
 * - `txHash`      — the settlement transaction.
 * - `explorerUrl` — a click-through link for judges / the dashboard.
 * - `identitySig` — the agent's signature, tying the action to its ERC-8004 identity.
 * - `receiptHash` — the `forecastHash` committed on-chain (the auditable decision receipt).
 */
export const ExecutionResult = z.object({
  txHash: Bytes32Hex,
  explorerUrl: z.string().url(),
  identitySig: HexBytes,
  receiptHash: Bytes32Hex,
});
export type ExecutionResult = z.infer<typeof ExecutionResult>;

/**
 * `ChainExecutor` — plan §16.2 / §17. The ONE seam through which money moves. Every DEPLOY /
 * WITHDRAW goes through `execute`; no transaction is ever constructed anywhere else (invariant #1).
 *
 * Two implementations share this interface:
 *  - the real Circle-backed executor (agent wallet + `AgentMandate` on Arc), and
 *  - `MockChainExecutor`, selected ONLY behind an explicit env flag (`CHAIN_EXECUTOR=mock`),
 *    never by default (invariant #3) — so a demo never silently fakes an on-chain result.
 *
 * Execution is strictly serial: at most one in-flight tx (§17.6). Implementations must reject a
 * reused on-chain `decisionId` (idempotency, §17.2).
 */
export interface ChainExecutor {
  execute(decision: Decision): Promise<ExecutionResult>;
}
