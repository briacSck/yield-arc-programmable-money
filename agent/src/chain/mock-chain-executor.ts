import { createHash } from 'node:crypto';
import type { ChainExecutor, Decision, ExecutionResult } from '@yield/shared';

/**
 * MockChainExecutor — a deterministic, in-memory ChainExecutor for parallel development and tests.
 *
 * INVARIANT #3: this is selected ONLY behind an explicit env flag (`CHAIN_EXECUTOR=mock`), never
 * by default. A demo must never silently fake an on-chain result. It exists so the product track
 * (decision engine, dashboard, scenario driver) can be built and tested before the real
 * Circle-backed executor lands — the two share the `ChainExecutor` interface exactly.
 *
 * It enforces the same idempotency contract as the real chain (§17.2): a reused decision id throws.
 */
export class MockChainExecutor implements ChainExecutor {
  private readonly seen = new Set<string>();

  async execute(decision: Decision): Promise<ExecutionResult> {
    if (this.seen.has(decision.id)) {
      throw new Error(`MockChainExecutor: duplicate decision id ${decision.id}`);
    }
    this.seen.add(decision.id);

    const txHash = '0x' + createHash('sha256').update(`tx:${decision.id}`).digest('hex');
    const identitySig = '0x' + createHash('sha256').update(`sig:${decision.id}`).digest('hex');
    return {
      txHash,
      explorerUrl: `https://testnet.arcscan.app/tx/${txHash}`,
      identitySig,
      receiptHash: decision.forecastInputsHash,
    };
  }
}
