import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Yield appetite — the owner's OFF-CHAIN preference for how hard the agent works the cash.
 *
 * THE semantic (stated once, same everywhere — dashboard `lib/owner.ts` mirrors it):
 *
 *   Appetite scales the budget the agent may commit per cycle: conservative = 50% of the
 *   mandate's remaining daily budget, balanced = 75%, opportunistic = 100%. The floor and the
 *   forecast guard are untouched — appetite can only make the agent MORE cautious than the
 *   mandate allows, never less.
 *
 * This is deliberately NOT an on-chain bound: the mandate's caps stay authoritative and the
 * contract still enforces them. Appetite only shrinks what the engine is TOLD it may spend
 * (`dailyCapRemainingUsdc` in the per-cycle config — the sanctioned "config, not code" layer,
 * §16.3). The scheduler, decision engine and executor are untouched.
 *
 * Persistence is one tiny JSON file on the worker's volume, written atomically (temp + rename)
 * so a container kill mid-write can never leave a torn file. CRITICAL DEFAULT: no file present
 * ⇒ 'opportunistic' ⇒ ×1.0 ⇒ byte-identical to the behaviour before this feature existed. The
 * live agent changes behaviour only when the owner explicitly applies a choice.
 */

export type Appetite = 'conservative' | 'balanced' | 'opportunistic';

export const APPETITE_VALUES: readonly Appetite[] = ['conservative', 'balanced', 'opportunistic'];

export function isAppetite(value: unknown): value is Appetite {
  return typeof value === 'string' && (APPETITE_VALUES as readonly string[]).includes(value);
}

/** Percent of the remaining daily budget the agent may commit, per appetite. Integer, exact. */
export const APPETITE_BUDGET_PCT: Record<Appetite, bigint> = {
  conservative: 50n,
  balanced: 75n,
  opportunistic: 100n,
};

/**
 * Scale a budget by the appetite. Pure BigInt maths; division truncates toward zero on
 * non-negative values, i.e. rounds DOWN — rounding up would commit more than the appetite allows.
 * `opportunistic` is exact identity (×100n/100n), so the default path is bit-for-bit today's.
 */
export function scaleByAppetite(remainingUsdc: bigint, appetite: Appetite): bigint {
  return (remainingUsdc * APPETITE_BUDGET_PCT[appetite]) / 100n;
}

/** Where the appetite file lives: `APPETITE_PATH`, defaulting to alongside `EVENT_LOG_PATH`. */
export function appetitePath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.APPETITE_PATH) return path.resolve(env.APPETITE_PATH);
  const eventLog = path.resolve(env.EVENT_LOG_PATH || path.resolve('event-log.jsonl'));
  return path.join(path.dirname(eventLog), 'appetite.json');
}

export class AppetiteStore {
  constructor(private readonly filePath: string) {}

  /**
   * The persisted appetite, re-read on every call (a cycle is hourly; a stale cache would make
   * an applied choice take effect a cycle late for no benefit).
   *
   *   - No file        ⇒ 'opportunistic' — today's behaviour EXACTLY; nothing changes at deploy.
   *   - Unreadable file ⇒ 'conservative' — the owner set SOMETHING and we lost it; failing
   *     cautious is the only direction this preference is ever allowed to fail in.
   */
  read(): Appetite {
    if (!existsSync(this.filePath)) return 'opportunistic';
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as { appetite?: unknown };
      if (isAppetite(parsed?.appetite)) return parsed.appetite;
    } catch {
      /* fall through to the cautious default */
    }
    console.warn(`[appetite] ${this.filePath} exists but is unreadable — failing cautious (conservative)`);
    return 'conservative';
  }

  /** Atomic write: temp file + rename, so a kill mid-write leaves the old value, never a torn one. */
  write(appetite: Appetite): void {
    if (!isAppetite(appetite)) throw new Error(`not an appetite: ${JSON.stringify(appetite)}`);
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp-${process.pid}`;
    writeFileSync(tmp, `${JSON.stringify({ appetite, updatedAt: new Date().toISOString() })}\n`, 'utf8');
    renameSync(tmp, this.filePath);
  }
}

/**
 * The exact composition `liveGather` (run.ts) applies each cycle: read the persisted preference,
 * scale the mandate's remaining daily budget. Kept here as one named function so the tests test
 * the thing the loop runs, not a re-derivation of it.
 */
export function budgetUnderAppetite(
  remainingUsdc: bigint,
  store: AppetiteStore,
): { appetite: Appetite; budgetUsdc: bigint } {
  const appetite = store.read();
  return { appetite, budgetUsdc: scaleByAppetite(remainingUsdc, appetite) };
}
