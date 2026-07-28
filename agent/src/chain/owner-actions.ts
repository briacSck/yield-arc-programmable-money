import { createHash, timingSafeEqual } from 'node:crypto';
import type { CircleWalletsSdk } from './circle-chain-executor.js';

/**
 * Owner actions — the human principal's controls on the mandate, executed from the COMPANY wallet.
 *
 *   PAUSE     → revoke()                            "fire the CFO agent"
 *   RESUME    → reinstate()                         "re-hire it"
 *   SET_FLOOR → setMandate(uint256,uint256,uint256) "retune the brief"
 *
 * This is deliberately NOT the agent's money path. `AgentMandate` gates these behind `onlyOwner`,
 * so they are signed by `CIRCLE_COMPANY_WALLET_ID` (the deployer/owner), never by the agent wallet.
 * The scheduler, decision engine and {CircleChainExecutor} are untouched by this module — an owner
 * pressing "pause" must not be able to perturb a cycle that is mid-flight beyond what the contract
 * itself enforces (a revoked mandate reverts `deposit`, and `withdrawToCompany` stays open by
 * design, which is exactly the promise the UI makes to the owner).
 *
 * Discipline mirrored from {CircleChainExecutor} (§17.6), because the failure modes are identical:
 *   - strictly serial: one owner tx in flight at a time;
 *   - poll to a TERMINAL state, and a FAILED/DENIED/CANCELLED terminal throws — the caller reports
 *     it honestly and never blind-retries;
 *   - the submit carries a DETERMINISTIC idempotency key derived from (action, params, requestId),
 *     so a transport-level retry of the submit dedupes server-side at Circle instead of sending a
 *     second transaction. Unlike a decision, an owner action is legitimately repeatable
 *     (pause → resume → pause), so the key is scoped by a per-CLICK requestId rather than by the
 *     action alone: two distinct clicks are two distinct transactions, one click retried is one.
 */

/** Only the two SDK calls owner actions need — no signMessage: there is no ERC-8004 receipt here. */
export type OwnerActionsSdk = Pick<CircleWalletsSdk, 'createContractExecutionTransaction' | 'getTransaction'>;

export type OwnerActionKind = 'PAUSE' | 'RESUME' | 'SET_FLOOR';

const ABI_BY_ACTION: Record<OwnerActionKind, string> = {
  PAUSE: 'revoke()',
  RESUME: 'reinstate()',
  SET_FLOOR: 'setMandate(uint256,uint256,uint256)',
};

const TERMINAL_OK = new Set(['CONFIRMED', 'COMPLETE']);
const TERMINAL_BAD = new Set(['FAILED', 'DENIED', 'CANCELLED']);

/** Bad input from the caller (⇒ HTTP 400), as opposed to an execution failure (⇒ 502). */
export class OwnerActionInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OwnerActionInputError';
  }
}

/**
 * A mandate bound, in **6-decimal USDC base units, as a decimal string** (the one basis across the
 * whole system — see `UsdcBaseUnits` in @yield/shared).
 *
 * Stricter than the shared schema on purpose, because this value is written to the contract by an
 * unattended endpoint: it must be POSITIVE (a zero floor is not "cautious", it is no floor at all
 * — and the disabled-button copy promised the owner a floor), canonical (no leading zeros, no
 * whitespace, no sign, no decimal point, no exponent), and bounded to 18 digits (1e12 USDC) so a
 * fat-fingered or hostile value cannot silently become an unrepresentable bound.
 *
 * A JSON *number* is refused outright: 6-dec base units exceed float precision, and accepting one
 * would be the exact class of bug this system exists to make impossible.
 */
const UNITS_RE = /^[1-9][0-9]{0,17}$/;

export function parseUnits(raw: unknown, field: string): string {
  if (typeof raw !== 'string') {
    throw new OwnerActionInputError(
      `${field} must be a STRING of USDC base units (6-dec), e.g. "5000000" for 5 USDC — got ${typeof raw}`,
    );
  }
  if (!UNITS_RE.test(raw)) {
    throw new OwnerActionInputError(
      `${field} must be a positive integer in USDC base units with no leading zeros, no sign, no decimal point and at most 18 digits — got ${JSON.stringify(raw.slice(0, 40))}`,
    );
  }
  return raw;
}

/** The floor the owner is setting. Same grammar, named for the error message the owner sees. */
export function parseFloorUnits(raw: unknown): string {
  return parseUnits(raw, 'floorUsdc');
}

/**
 * Opaque per-click id used to scope the idempotency key. Constrained so it cannot smuggle anything
 * into the key material or the Circle `refId`.
 */
const REQUEST_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

export function parseRequestId(raw: unknown, fallback: () => string): string {
  if (raw === undefined || raw === null || raw === '') return fallback();
  if (typeof raw !== 'string' || !REQUEST_ID_RE.test(raw)) {
    throw new OwnerActionInputError('requestId must be 8–64 chars of [A-Za-z0-9_-]');
  }
  return raw;
}

/** Deterministic, RFC-shaped idempotency key: one click ⇒ one transaction, however many retries. */
export function ownerIdempotencyKey(action: OwnerActionKind, params: readonly string[], requestId: string): string {
  const h = createHash('sha256')
    .update(`yield-owner-action:${action}:${params.join(',')}:${requestId}`)
    .digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

// ─── Auth ──────────────────────────────────────────────────────────────────────────────────────

/**
 * The dashboard is internet-facing and these endpoints move a real mandate. Rule #6: a public
 * surface with an unauthenticated write button is a griefing target — anyone could pause the agent
 * mid-demo. So the worker requires a shared secret, and **refuses to run open**: an unset (or
 * trivially short) `OWNER_ACTION_SECRET` disables the endpoint entirely rather than defaulting to
 * "no auth required". Fail closed, and say why.
 *
 * The secret is held ONLY by the worker and by the dashboard's server-side proxy (rule #5). It is
 * never sent to the browser and never appears in a response body.
 */
export const MIN_OWNER_SECRET_LENGTH = 16;

export type OwnerAuthResult =
  | { ok: true }
  | { ok: false; status: 401 | 503; error: string };

export function checkOwnerSecret(expected: string | undefined, provided: string | undefined | null): OwnerAuthResult {
  const want = (expected ?? '').trim();
  if (want.length === 0) {
    return {
      ok: false,
      status: 503,
      error: 'owner actions are disabled: OWNER_ACTION_SECRET is not set on the worker',
    };
  }
  if (want.length < MIN_OWNER_SECRET_LENGTH) {
    return {
      ok: false,
      status: 503,
      error: `owner actions are disabled: OWNER_ACTION_SECRET must be at least ${MIN_OWNER_SECRET_LENGTH} characters`,
    };
  }
  const got = typeof provided === 'string' ? provided : '';
  // Compare fixed-width digests: timingSafeEqual throws on length mismatch, and a raw length
  // comparison would leak the secret's length.
  const a = createHash('sha256').update(want).digest();
  const b = createHash('sha256').update(got).digest();
  if (!timingSafeEqual(a, b)) {
    return { ok: false, status: 401, error: 'unauthorized' };
  }
  return { ok: true };
}

// ─── Execution ─────────────────────────────────────────────────────────────────────────────────

export interface OwnerActionResult {
  action: OwnerActionKind;
  txHash: `0x${string}`;
  explorerUrl: string;
  circleTxId: string;
  /** Echoed so the caller can log/render exactly what was sent on-chain. */
  abiFunctionSignature: string;
  abiParameters: string[];
  requestId: string;
}

/** The port the worker's HTTP surface depends on — tests inject a fake, prod injects Circle. */
export interface OwnerActionsPort {
  pause(requestId: string): Promise<OwnerActionResult>;
  resume(requestId: string): Promise<OwnerActionResult>;
  setFloor(input: {
    floorUsdc: string;
    maxTicketUsdc: string;
    dailyCapUsdc: string;
    requestId: string;
  }): Promise<OwnerActionResult>;
}

export interface CircleOwnerActionsConfig {
  /** MUST be the owner/company wallet (`CIRCLE_COMPANY_WALLET_ID`) — the agent wallet is not owner. */
  walletId: string;
  mandateAddress: string;
  explorerTxBase?: string;
  pollIntervalMs?: number;
  timeoutMs?: number;
}

/** Same transient-reset tolerance as the executor; safe because every submit carries the key above. */
async function withConnectRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const e = err as { code?: string; message?: string };
    const transient = e.code === 'ECONNRESET' || /socket hang up|ECONNRESET/i.test(e.message ?? '');
    if (!transient) throw err;
    await new Promise((r) => setTimeout(r, 750));
    return fn();
  }
}

export class CircleOwnerActions implements OwnerActionsPort {
  private readonly sdk: OwnerActionsSdk;
  private readonly cfg: Required<CircleOwnerActionsConfig>;
  private inFlight = false;

  constructor(sdk: OwnerActionsSdk, config: CircleOwnerActionsConfig) {
    this.sdk = sdk;
    this.cfg = {
      explorerTxBase: 'https://testnet.arcscan.app/tx/',
      pollIntervalMs: 2_000,
      timeoutMs: 120_000,
      ...config,
    };
  }

  pause(requestId: string): Promise<OwnerActionResult> {
    return this.run('PAUSE', [], requestId);
  }

  resume(requestId: string): Promise<OwnerActionResult> {
    return this.run('RESUME', [], requestId);
  }

  /**
   * Adjust the floor. `setMandate` writes all three bounds at once, so the CURRENT ticket cap and
   * daily cap must be passed through explicitly — reading them from chain and re-sending them is
   * the only way to change one bound without silently resetting the other two.
   */
  async setFloor(input: {
    floorUsdc: string;
    maxTicketUsdc: string;
    dailyCapUsdc: string;
    requestId: string;
  }): Promise<OwnerActionResult> {
    // `async` on purpose: a validation failure must REJECT like every other failure here, never
    // throw synchronously out of a Promise-returning method.
    const floor = parseFloorUnits(input.floorUsdc);
    const maxTicket = parseUnits(input.maxTicketUsdc, 'maxTicketUsdc');
    const dailyCap = parseUnits(input.dailyCapUsdc, 'dailyCapUsdc');
    // The constructor's invariant (`maxTicket != 0 && maxTicket <= dailyCap`) is NOT re-checked by
    // `setMandate`. Preserve it here rather than let an owner action leave the mandate in a shape
    // the contract would have refused at construction.
    if (BigInt(maxTicket) > BigInt(dailyCap)) {
      throw new OwnerActionInputError(
        `maxTicketUsdc (${maxTicket}) must not exceed dailyCapUsdc (${dailyCap}) — refusing to write a mandate the constructor would have rejected`,
      );
    }
    return this.run('SET_FLOOR', [floor, maxTicket, dailyCap], input.requestId);
  }

  private async run(action: OwnerActionKind, params: string[], requestId: string): Promise<OwnerActionResult> {
    if (this.inFlight) {
      throw new Error('owner actions: a transaction is already in flight (strictly serial, §17.6).');
    }
    this.inFlight = true;
    try {
      const abiFunctionSignature = ABI_BY_ACTION[action];
      const submitted = await withConnectRetry(() =>
        this.sdk.createContractExecutionTransaction({
          walletId: this.cfg.walletId,
          contractAddress: this.cfg.mandateAddress,
          abiFunctionSignature,
          abiParameters: params,
          fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
          idempotencyKey: ownerIdempotencyKey(action, params, requestId),
          refId: `owner-${action.toLowerCase()}-${requestId}`,
        }),
      );
      const circleTxId = submitted.data?.id;
      if (!circleTxId) throw new Error('owner actions: submit returned no transaction id');

      const txHash = await this.pollToTerminal(circleTxId, action);
      return {
        action,
        txHash,
        explorerUrl: `${this.cfg.explorerTxBase}${txHash}`,
        circleTxId,
        abiFunctionSignature,
        abiParameters: params,
        requestId,
      };
    } finally {
      this.inFlight = false;
    }
  }

  private async pollToTerminal(txId: string, action: OwnerActionKind): Promise<`0x${string}`> {
    const startedAt = Date.now();
    let finalRecheck = false;
    for (;;) {
      const res = await withConnectRetry(() => this.sdk.getTransaction({ id: txId }));
      const tx = res.data?.transaction;
      const state = tx?.state ?? 'UNKNOWN';
      if (TERMINAL_OK.has(state)) {
        if (!tx?.txHash) throw new Error(`owner actions: ${action} reached ${state} but no txHash`);
        return tx.txHash as `0x${string}`;
      }
      if (TERMINAL_BAD.has(state)) {
        throw new Error(
          `owner actions: ${action} tx ${txId} ended ${state} (${tx?.errorReason ?? 'no reason'}) — reported, never blind-retried (§17.6).`,
        );
      }
      if (Date.now() - startedAt > this.cfg.timeoutMs) {
        // One final re-query before declaring it stuck: a slow-but-successful tx must be recovered
        // here, not re-submitted. The idempotency key is the backstop if it lands even later.
        if (finalRecheck) {
          throw new Error(`owner actions: ${action} tx ${txId} stuck (last state ${state}) — reported, not retried.`);
        }
        finalRecheck = true;
      }
      await new Promise((r) => setTimeout(r, this.cfg.pollIntervalMs));
    }
  }
}
