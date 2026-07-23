import { parseAbi, type PublicClient } from 'viem';

/**
 * USYC venue adapter (plan §17.4) — the real tokenized-MMF yield venue on Arc testnet, behind the
 * `IVenue` seam so it can slot in front of `AgentMandate` WITHOUT changing the frozen contract or
 * the money-moving executor path (that wiring is gated — §17.2, needs the team nod).
 *
 * The USYC Teller is an ERC-4626 vault: `deposit(assets, receiver)` takes USDC and mints USYC
 * shares (subscription); `redeem(shares, receiver, account)` unwinds shares back to USDC. Access is
 * allowlist-gated and the allowlist is READABLE.
 *
 * PROVEN on Arc testnet 2026-07-23 with the agent wallet (`agent/scripts/usyc-mint-test.ts`):
 *   subscribe 1 USDC → 0.883398 USYC (tx 0x46b1dba7…), redeem back → 0.999903 USDC (tx 0xfd6e3a65…).
 *
 * INVARIANT #1 (all money movement through `ChainExecutor`): this adapter NEVER submits a
 * transaction. Read methods are safe to call anywhere; the two money moves are exposed as *call
 * specs* (`mintCall` / `redeemCall` / `approveCall`) that the executor signs. A venue that could
 * move money on its own would be a second money path — exactly what the invariant forbids.
 */

export const USYC_TOKEN = '0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C' as const; // 6-dec shares
export const USYC_TELLER = '0x9fdF14c5B14173D74C08Af27AebFf39240dC105A' as const; // ERC-4626 vault
export const USDC_ERC20 = '0x3600000000000000000000000000000000000000' as const; // Arc native USDC, 6-dec

const TELLER_ABI = parseAbi([
  'function asset() view returns (address)',
  'function share() view returns (address)',
  'function maxDeposit(address) view returns (uint256)',
  'function maxRedeem(address) view returns (uint256)',
  'function subscriptionLimitRemaining(address account, uint256 date) view returns (uint256)',
  'function todayTimestamp() view returns (uint256)',
  'function previewDeposit(uint256 assets) view returns (uint256)',
  'function previewRedeem(uint256 shares) view returns (uint256)',
]);

/** A contract call the `ChainExecutor` can sign — mirrors the Circle SDK's execution shape. */
export interface VenueCall {
  contractAddress: `0x${string}`;
  abiFunctionSignature: string;
  abiParameters: string[];
}

/** The seam. A future rebalancer / mandate integration depends on THIS, not on USYC directly. */
export interface IVenue {
  /** USDC (6-dec) → expected vault shares (6-dec). */
  previewDeposit(assetsUsdc: bigint): Promise<bigint>;
  /** Vault shares (6-dec) → expected USDC (6-dec). */
  previewRedeem(shares: bigint): Promise<bigint>;
  /** Is `account` allowlisted to subscribe (0 limit ⇒ not enabled)? */
  isAllowlisted(account: `0x${string}`): Promise<boolean>;
}

export class USYCVenue implements IVenue {
  constructor(private readonly client: PublicClient) {}

  private read<T>(fn: string, args: unknown[] = []): Promise<T> {
    return this.client.readContract({
      address: USYC_TELLER,
      abi: TELLER_ABI,
      functionName: fn as never,
      args: args as never,
    }) as Promise<T>;
  }

  previewDeposit(assetsUsdc: bigint): Promise<bigint> {
    return this.read<bigint>('previewDeposit', [assetsUsdc]);
  }
  previewRedeem(shares: bigint): Promise<bigint> {
    return this.read<bigint>('previewRedeem', [shares]);
  }
  maxDeposit(account: `0x${string}`): Promise<bigint> {
    return this.read<bigint>('maxDeposit', [account]);
  }
  maxRedeem(account: `0x${string}`): Promise<bigint> {
    return this.read<bigint>('maxRedeem', [account]);
  }

  /** Allowlist proof (read-only): a non-allowlisted wallet reads 0 on both limits. */
  async isAllowlisted(account: `0x${string}`): Promise<boolean> {
    const today = await this.read<bigint>('todayTimestamp');
    const [subRemaining, maxDep] = await Promise.all([
      this.read<bigint>('subscriptionLimitRemaining', [account, today]),
      this.read<bigint>('maxDeposit', [account]),
    ]);
    return subRemaining > 0n || maxDep > 0n;
  }

  // ── Money-move call specs (executed ONLY by the ChainExecutor) ──────────────

  /** USDC ERC-20 approval the Teller needs before a deposit. */
  approveCall(assetsUsdc: bigint): VenueCall {
    return {
      contractAddress: USDC_ERC20,
      abiFunctionSignature: 'approve(address,uint256)',
      abiParameters: [USYC_TELLER, assetsUsdc.toString()],
    };
  }
  /** Subscribe: deploy `assetsUsdc` USDC into USYC, shares minted to `receiver`. */
  mintCall(assetsUsdc: bigint, receiver: `0x${string}`): VenueCall {
    return {
      contractAddress: USYC_TELLER,
      abiFunctionSignature: 'deposit(uint256,address)',
      abiParameters: [assetsUsdc.toString(), receiver],
    };
  }
  /** Redeem: unwind `shares` USYC back to USDC to `receiver` (caller == account). */
  redeemCall(shares: bigint, receiver: `0x${string}`, account: `0x${string}`): VenueCall {
    return {
      contractAddress: USYC_TELLER,
      abiFunctionSignature: 'redeem(uint256,address,address)',
      abiParameters: [shares.toString(), receiver, account],
    };
  }
}
