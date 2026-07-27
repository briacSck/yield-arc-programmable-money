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

export function renderVerdict(v: Verdict): string {
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
      notes: v.notes,
    },
    null,
    2,
  );
}
