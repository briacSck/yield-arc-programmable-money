import { z } from 'zod';

/**
 * Shared primitive schemas. Version-agnostic regex validators are used deliberately (rather
 * than zod's `.datetime()` / `.date()` helpers, whose names moved between zod 3 and 4) so this
 * package pins the *contract*, not a zod minor version.
 */

/** ISO-8601 date, `YYYY-MM-DD`. */
export const IsoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected an ISO date, YYYY-MM-DD');

/** ISO-8601 datetime with timezone, e.g. `2026-07-14T09:30:00Z`. */
export const IsoDateTime = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/,
    'expected an ISO datetime with timezone',
  );

/** 20-byte EVM address, lowercase or checksummed. */
export const HexAddress = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, 'expected a 0x-prefixed 20-byte address');

/** 32-byte hex value (keccak hash, txHash, decisionId, forecastHash). */
export const Bytes32Hex = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, 'expected a 0x-prefixed 32-byte hex value');

/** Arbitrary-length hex blob (e.g. an ECDSA signature). */
export const HexBytes = z
  .string()
  .regex(/^0x[0-9a-fA-F]*$/, 'expected 0x-prefixed hex bytes');

/**
 * A USDC amount expressed in **integer base units, as a decimal string** — never a JS number.
 *
 * The single basis is **6-decimal USDC base units** (Arc's USDC ERC-20 canonical decimals) across
 * the entire seam: forecasts, decisions, the executor, and `AgentMandate`'s pools all use it, and
 * it maps 1:1 onto the contract's `uint256`. Arc's 18-dec NATIVE accounting is converted at the
 * contract's native-value boundaries only (`SCALE = 1e12`), never in decision math. Strings of
 * integer base units avoid float error entirely — non-negotiable for a system whose core
 * invariant is "the floor is never breached." Convert at the display edge only.
 */
export const UsdcBaseUnits = z
  .string()
  .regex(/^\d+$/, 'USDC amount must be a non-negative integer in base units, as a string');

export type IsoDate = z.infer<typeof IsoDate>;
export type IsoDateTime = z.infer<typeof IsoDateTime>;
export type HexAddress = z.infer<typeof HexAddress>;
export type Bytes32Hex = z.infer<typeof Bytes32Hex>;
export type HexBytes = z.infer<typeof HexBytes>;
export type UsdcBaseUnits = z.infer<typeof UsdcBaseUnits>;
