import { createHash } from 'node:crypto';
import { keccak256, toBytes } from 'viem';
import type { ChainExecutor, Decision, ExecutionResult } from '@yield/shared';

/**
 * CircleChainExecutor — the REAL ChainExecutor (§17.3 S1, proven by the 2026-07-14 gating spike:
 * a Circle developer-controlled wallet signed an arbitrary contract call on ARC-TESTNET,
 * tx 0xdada7f8a…0e094c, COMPLETE in ~2.3s).
 *
 * Maps a `Decision` onto the `AgentMandate` contract (§17.2):
 *   DEPLOY   → deposit(uint256 amount, bytes32 decisionId, bytes32 forecastHash)
 *   WITHDRAW → withdrawToCompany(uint256 amount, bytes32 decisionId, bytes32 forecastHash)
 *   HOLD / FLOOR_RAISE → rejected: they move no money, so they must never reach the executor.
 *
 * Lifecycle (§17.6): strictly serial — max one in-flight tx; poll to a terminal state; a FAILED /
 * DENIED / CANCELLED terminal throws (callers translate that into HOLD + alert, never blind-retry).
 * Retries of the SUBMIT call itself are safe because the idempotency key is derived
 * deterministically from the decision id — Circle dedupes server-side.
 */

/** The three SDK calls we use, extracted as an interface so tests can inject a fake. */
export interface CircleWalletsSdk {
  createContractExecutionTransaction(input: {
    walletId: string;
    contractAddress: string;
    abiFunctionSignature: string;
    abiParameters: unknown[];
    fee: { type: 'level'; config: { feeLevel: 'LOW' | 'MEDIUM' | 'HIGH' } };
    idempotencyKey?: string;
    refId?: string;
  }): Promise<{ data?: { id: string; state: string } }>;
  getTransaction(input: {
    id: string;
  }): Promise<{ data?: { transaction?: { state?: string; txHash?: string; errorReason?: string } } }>;
  signMessage(input: { walletId: string; message: string }): Promise<{ data?: { signature: string } }>;
}

export interface CircleChainExecutorConfig {
  walletId: string;
  mandateAddress: string;
  explorerTxBase?: string;
  pollIntervalMs?: number;
  timeoutMs?: number;
}

const TERMINAL_OK = new Set(['CONFIRMED', 'COMPLETE']);
const TERMINAL_BAD = new Set(['FAILED', 'DENIED', 'CANCELLED']);

/**
 * api.circle.com intermittently resets the FIRST connection from a fresh process. One retry after
 * a short pause is safe on every call we make: submits carry a deterministic idempotency key
 * (Circle dedupes server-side) and the rest are reads/signatures with no on-chain effect.
 */
async function withConnectRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const msg = (err as { code?: string; message?: string });
    const transient = msg.code === 'ECONNRESET' || /socket hang up|ECONNRESET/i.test(msg.message ?? '');
    if (!transient) throw err;
    await new Promise((r) => setTimeout(r, 750));
    return fn();
  }
}
const ABI_BY_KIND: Record<'DEPLOY' | 'WITHDRAW', string> = {
  DEPLOY: 'deposit(uint256,bytes32,bytes32)',
  WITHDRAW: 'withdrawToCompany(uint256,bytes32,bytes32)',
};

/** Deterministic UUID from the decision id, so a network retry of the submit cannot double-spend. */
export function idempotencyKeyFor(decisionId: string): string {
  const h = createHash('sha256').update(`yield-decision:${decisionId}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

/**
 * On-chain decisionId (§17.2): bytes32 the contract uses for replay rejection.
 *
 * Derivation is `keccak(forecastInputsHash ‖ kind)` — deliberately INDEPENDENT of wall-clock time
 * and of the app-level `decision.id` (which includes `now`). The forecast's `asOf` is already
 * committed inside `inputsHash`, so: same forecast snapshot + same action ⇒ same on-chain id ⇒
 * a retried or re-polled decision COLLIDES on the contract's `DuplicateDecision` guard instead of
 * double-spending. A new cycle produces a new forecast (new asOf ⇒ new inputsHash) ⇒ new id.
 */
export function onChainDecisionId(decision: Decision): `0x${string}` {
  return keccak256(toBytes(`${decision.forecastInputsHash}|${decision.kind}`));
}

export class CircleChainExecutor implements ChainExecutor {
  private readonly sdk: CircleWalletsSdk;
  private readonly cfg: Required<CircleChainExecutorConfig>;
  private readonly seen = new Set<string>();
  private inFlight = false;

  constructor(sdk: CircleWalletsSdk, config: CircleChainExecutorConfig) {
    this.sdk = sdk;
    this.cfg = {
      explorerTxBase: 'https://testnet.arcscan.app/tx/',
      pollIntervalMs: 2_000,
      timeoutMs: 120_000,
      ...config,
    };
  }

  async execute(decision: Decision): Promise<ExecutionResult> {
    if (decision.kind !== 'DEPLOY' && decision.kind !== 'WITHDRAW') {
      throw new Error(`CircleChainExecutor: ${decision.kind} moves no money and must not be executed on-chain.`);
    }
    if (this.seen.has(decision.id)) {
      throw new Error(`CircleChainExecutor: duplicate decision id ${decision.id}`);
    }
    if (this.inFlight) {
      throw new Error('CircleChainExecutor: a transaction is already in flight (§17.6: strictly serial).');
    }
    this.inFlight = true;
    try {
      const decisionId = onChainDecisionId(decision);

      // The agent's ERC-8004-verifiable signature over what it is about to do and why.
      const signed = await withConnectRetry(() =>
        this.sdk.signMessage({
          walletId: this.cfg.walletId,
          message: `${decisionId}:${decision.forecastInputsHash}`,
        }),
      );
      const identitySig = signed.data?.signature;
      if (!identitySig) throw new Error('CircleChainExecutor: signMessage returned no signature');

      const abiFunctionSignature = ABI_BY_KIND[decision.kind as 'DEPLOY' | 'WITHDRAW'];
      const submitted = await withConnectRetry(() =>
        this.sdk.createContractExecutionTransaction({
          walletId: this.cfg.walletId,
          contractAddress: this.cfg.mandateAddress,
          abiFunctionSignature,
          abiParameters: [decision.amountUsdc, decisionId, decision.forecastInputsHash],
          fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
          idempotencyKey: idempotencyKeyFor(decision.id),
          refId: decision.id,
        }),
      );
      const txId = submitted.data?.id;
      if (!txId) throw new Error('CircleChainExecutor: submit returned no transaction id');

      const txHash = await this.pollToTerminal(txId, decision.id);
      this.seen.add(decision.id); // only after success: a failed submit may be retried by a NEW decision cycle
      return {
        txHash,
        explorerUrl: `${this.cfg.explorerTxBase}${txHash}`,
        identitySig: identitySig.startsWith('0x') ? (identitySig as `0x${string}`) : `0x${identitySig}`,
        receiptHash: decision.forecastInputsHash,
      };
    } finally {
      this.inFlight = false;
    }
  }

  private async pollToTerminal(txId: string, decisionId: string): Promise<`0x${string}`> {
    const startedAt = Date.now();
    let finalRecheck = false;
    for (;;) {
      const res = await this.sdk.getTransaction({ id: txId });
      const tx = res.data?.transaction;
      const state = tx?.state ?? 'UNKNOWN';
      if (TERMINAL_OK.has(state)) {
        if (!tx?.txHash) throw new Error(`CircleChainExecutor: ${state} but no txHash (decision ${decisionId})`);
        return tx.txHash as `0x${string}`;
      }
      if (TERMINAL_BAD.has(state)) {
        throw new Error(
          `CircleChainExecutor: tx ${txId} for decision ${decisionId} ended ${state} (${tx?.errorReason ?? 'no reason'}) — caller must HOLD + alert, never blind-retry (§17.6).`,
        );
      }
      if (Date.now() - startedAt > this.cfg.timeoutMs) {
        // One final re-query before declaring the tx stuck: a slow-but-successful tx must be
        // recovered here, not re-submitted by a later cycle (eng review #15). The on-chain
        // decisionId collision is the backstop if it lands even later.
        if (finalRecheck) {
          throw new Error(`CircleChainExecutor: tx ${txId} stuck (last state ${state}) — HOLD + alert (§17.6).`);
        }
        finalRecheck = true;
      }
      await new Promise((r) => setTimeout(r, this.cfg.pollIntervalMs));
    }
  }
}
