/**
 * Refresh the `live-snapshot` fixture from the live chain.
 *
 *   npm run snapshot -w verifier
 *
 * The offline fixture is the judge's fallback path (`--fixture live-snapshot`) — it must not drift
 * far behind the dashboard, or the no-network run reports fewer moves than the screen shows. This
 * script is the repeatable way to refresh it (TODOS: "expand the golden snapshot as live history
 * grows"): it fetches the same history the CLI does, writes a dated fixture with string-encoded
 * bigints, and prints the counts to paste into `golden.test.ts`.
 *
 * It writes ONLY the fixture file. Wiring the new file into `fixtures.ts` and bumping the golden
 * expectations stays a deliberate human edit — a snapshot that silently redefines the golden test's
 * expected values would make that test unable to fail.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchHistory } from '../src/fetch.js';
import { replay } from '../src/core/replay.js';
import {
  ARC_CHAIN_ID,
  DEFAULT_DEPLOY_BLOCK as MANDATE_DEPLOY_BLOCK,
  DEFAULT_MANDATE_ADDRESS as MANDATE_ADDRESS,
} from '../src/config.js';

const FIXTURE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

/** JSON.stringify replacer: bigints are string-encoded, exactly as `hydrate()` expects. */
const encode = (_k: string, v: unknown) => (typeof v === 'bigint' ? v.toString() : v);

async function main() {
  process.stderr.write(`  Scanning ${MANDATE_ADDRESS} from deploy block ${MANDATE_DEPLOY_BLOCK} …\n`);
  const { events, scannedThroughBlock, chainId, unknownLogCount } = await fetchHistory(
    MANDATE_ADDRESS,
    MANDATE_DEPLOY_BLOCK,
    { onProgress: (done, total) => process.stderr.write(`\r  … ${done}/${total} ranges`) },
  );
  process.stderr.write('\n');

  // A snapshot of a history that does not verify is not a golden fixture — it is a bug report.
  const verdict = replay(events, { mandateAddress: MANDATE_ADDRESS, chainId, deployBlock: MANDATE_DEPLOY_BLOCK, source: 'fixture' });
  if (!verdict.compliant) {
    console.error('\n  REFUSING to write: live history did not verify COMPLIANT.');
    for (const iv of verdict.invariants.filter((i) => i.violations.length)) {
      console.error(`    ${iv.key}: ${iv.violations.length} violation(s) — ${iv.detail}`);
    }
    process.exit(1);
  }

  // Named by CAPTURE date (not last-event date): the fixture's claim is "history as of when we
  // looked", and `toBlock` is what pins it. A file named for the last move would look stale the
  // moment the agent goes a few days without moving money.
  const capturedAt = new Date().toISOString().slice(0, 10);
  const file = `live-history-${capturedAt}.json`;
  writeFileSync(
    path.join(FIXTURE_DIR, file),
    JSON.stringify(
      { _name: 'live-snapshot', mandateAddress: MANDATE_ADDRESS, chainId: ARC_CHAIN_ID, deployBlock: MANDATE_DEPLOY_BLOCK, toBlock: scannedThroughBlock, capturedAt, events },
      encode,
      2,
    ) + '\n',
  );

  console.log(`\n  wrote fixtures/${file}`);
  console.log(`    ${events.length} events · ${unknownLogCount} unknown log(s) skipped · through block ${scannedThroughBlock}`);
  console.log(`\n  Golden expectations for this snapshot:`);
  console.log(`    totalMoves                 ${verdict.totalMoves}`);
  console.log(`    closestApproachToFloorUsdc ${verdict.closestApproachToFloorUsdc}n`);
  console.log(`\n  Next: point FIXTURE_FILE['live-snapshot'] at the new file and bump golden.test.ts.`);
}

main().catch((err) => {
  console.error(`\n  snapshot failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(2);
});
