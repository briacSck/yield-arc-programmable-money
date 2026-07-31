import { DASHBOARD_URL, EXPLORER_ADDRESS_BASE } from './config.js';
import type { InvariantVerdict, Verdict } from './types.js';

/**
 * Terminal output — same discipline as the dashboard (§18.2c):
 *   - Vocabulary VERBATIM: PASS / VIOLATION / PENDING / UNVERIFIED — never "FAIL(ED)".
 *   - Magnitude, not grade: "floor · PASS — 4/4 deposits, closest approach $1.00 above floor".
 *   - Screenshot-able verdict footer with the live dashboard + contract URLs.
 * No color codes by default (screenshots + CI logs stay clean); a TTY check could add them later.
 */

const LABEL: Record<string, string> = {
  floor: 'floor    ',
  ticket: 'ticket   ',
  window: 'window   ',
  asymmetry: 'asymmetry',
  receipt: 'receipt  ',
};

export function fmtUsdc(baseUnits: bigint | null): string {
  if (baseUnits === null) return '—';
  const neg = baseUnits < 0n;
  const abs = neg ? -baseUnits : baseUnits;
  const whole = abs / 1_000_000n;
  const frac = (abs % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  return `${neg ? '-' : ''}$${whole}${frac ? '.' + frac : ''}`;
}

function line(iv: InvariantVerdict): string {
  return `  ${LABEL[iv.key]} · ${iv.status.padEnd(9)} — ${iv.detail}`;
}

export function renderVerdict(v: Verdict, versionLine?: string): string {
  const out: string[] = [];
  const src = v.source === 'fixture' ? 'FIXTURE' : 'LIVE CHAIN';
  out.push('');
  out.push(`  Mandate ${v.mandateAddress}  (Arc testnet ${v.chainId})  ·  ${src}`);
  if (v.source === 'chain') {
    out.push(`  Deploy block ${v.deployBlock} → scanned through ${v.scannedThroughBlock}`);
  }
  out.push(`  ${v.totalMoves} on-chain move(s) replayed against 5 invariants`);
  out.push('');
  for (const iv of v.invariants) out.push(line(iv));
  // Venue-leg reconstruction (AgentMandateV2) — magnitude, not grade; shortfalls on the record.
  if (v.venue) {
    const vn = v.venue;
    const shares = (n: bigint) => `${fmtUsdc(n).slice(1)} share(s)`; // 6-dec like USDC, no $ sign
    const position =
      vn.sharesHeld !== 0n
        ? `holding ${shares(vn.sharesHeld)}, basis ${fmtUsdc(vn.costBasisUsdc)}`
        : vn.subscriptions > 0
          ? `position closed, basis ${fmtUsdc(vn.costBasisUsdc)}`
          : 'no position opened yet';
    out.push(
      `  venue     · ${vn.subscriptions} subscription(s) ${fmtUsdc(vn.subscribedUsdc)} in · ` +
        `${vn.redemptions} redemption(s) ${fmtUsdc(vn.redeemedUsdc)} out — ${position}`,
    );
    if (vn.shortfallRedemptions > 0) {
      out.push(`              ${vn.shortfallRedemptions} redemption(s) settled below request — NAV loss/partial redeem, on the record`);
    }
    if (vn.strandedShares > 0n) {
      out.push(`              ${shares(vn.strandedShares)} stranded by a failed venue exit — recoverable via rescueToken`);
    }
  }
  out.push('');

  // Enumerate violations loudly (this is the whole product when it fires).
  const violations = v.invariants.flatMap((iv) => iv.violations);
  if (violations.length > 0) {
    out.push(`  ${violations.length} VIOLATION(S):`);
    for (const x of violations) out.push(`    ✗ [${x.invariant}] block ${x.blockNumber}: ${x.message}`);
    out.push('');
  }
  for (const n of v.notes) out.push(`  note: ${n}`);
  if (v.notes.length) out.push('');

  // Screenshot-able footer.
  if (v.compliant) {
    out.push(`  VERDICT: COMPLIANT — ${v.totalMoves} moves × 5 invariants, 0 violations.`);
  } else {
    out.push(`  VERDICT: VIOLATION FOUND — ${violations.length} across ${v.totalMoves} moves.`);
  }
  if (v.source === 'chain') {
    out.push(`  Live audit: ${DASHBOARD_URL}  ·  Contract: ${EXPLORER_ADDRESS_BASE}${v.mandateAddress}`);
  }
  // Part of the screenshot-able footer (X5): a verdict you can't tie to a verifier version isn't
  // reproducible.
  if (versionLine) out.push(`  ${versionLine}`);
  out.push('');
  return out.join('\n');
}

/** The pinned `--json` verdict record shape (dashboard joins on txHash; it has no keccak dep). */
export function toJson(v: Verdict): string {
  return JSON.stringify(
    {
      schemaVersion: v.schemaVersion,
      mandateAddress: v.mandateAddress,
      chainId: v.chainId,
      deployBlock: v.deployBlock.toString(),
      scannedThroughBlock: v.scannedThroughBlock?.toString() ?? null,
      compliant: v.compliant,
      totalMoves: v.totalMoves,
      source: v.source,
      closestApproachToFloorUsdc: v.closestApproachToFloorUsdc?.toString() ?? null,
      invariants: v.invariants.map((iv) => ({ key: iv.key, status: iv.status, checks: iv.checks, detail: iv.detail })),
      moves: v.moves.map((m) => ({
        decisionId: m.decisionId,
        txHash: m.txHash ?? null,
        kind: m.kind,
        blockNumber: m.blockNumber.toString(),
        amountUsdc: m.amountUsdc.toString(),
        floorHeadroomUsdc: m.floorHeadroomUsdc?.toString() ?? null,
        windowUtilization: m.windowUtilization,
        receipt: m.receipt,
        perInvariant: m.perInvariant,
      })),
      venue: v.venue
        ? {
            venueAddress: v.venue.venueAddress,
            sharesHeld: v.venue.sharesHeld.toString(),
            costBasisUsdc: v.venue.costBasisUsdc.toString(),
            subscriptions: v.venue.subscriptions,
            redemptions: v.venue.redemptions,
            subscribedUsdc: v.venue.subscribedUsdc.toString(),
            redeemedUsdc: v.venue.redeemedUsdc.toString(),
            shortfallRedemptions: v.venue.shortfallRedemptions,
            strandedShares: v.venue.strandedShares.toString(),
          }
        : null,
      notes: v.notes,
    },
    null,
    2,
  );
}
