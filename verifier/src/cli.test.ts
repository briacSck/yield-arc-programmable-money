import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { runPool } from './fetch.js';

/**
 * Regression tests for the judge-surface DX defects (issue #22):
 *   X2 — RPC failure must exit 2 (the documented contract the nightly CI keys off), never crash.
 *   X3 — the error doctrine line prints BEFORE the cause, and the cause is one line, not viem's
 *        wall of status/URL/body.
 *   X5 — the version is single-sourced from package.json and printed in the footer a judge
 *        screenshots.
 */

const VERIFIER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PKG_VERSION = (JSON.parse(readFileSync(path.join(VERIFIER_ROOT, 'package.json'), 'utf8')) as { version: string }).version;

function runCli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      ['--import', 'tsx', 'src/cli.ts', ...args],
      { cwd: VERIFIER_ROOT, timeout: 60_000 },
      (err, stdout, stderr) => {
        const code = err && typeof (err as { code?: unknown }).code === 'number' ? ((err as { code: number }).code) : 0;
        resolve({ code, stdout, stderr });
      },
    );
  });
}

test('X2 · runPool settles every worker and rejects with the first error (no unhandled rejections)', async () => {
  let unhandled = 0;
  const onUnhandled = () => { unhandled++; };
  process.on('unhandledRejection', onUnhandled);
  try {
    const settled: number[] = [];
    // 6 items, concurrency 3: items 1 and 3 fail at staggered delays. This pins the pool's
    // CONTRACT (settle everything, then reject with the first error) — it is not a regression pin
    // for the X2 exit-127 crash, whose exact escape path below viem's retries was never pinned;
    // the process-level handlers in cli.ts are what guarantee exit 2 there.
    await assert.rejects(
      runPool([0, 1, 2, 3, 4, 5], 3, async (i) => {
        await new Promise((r) => setTimeout(r, i * 10));
        settled.push(i);
        if (i === 1 || i === 3) throw new Error(`boom ${i}`);
      }),
      /boom 1/,
      'must reject with the FIRST error',
    );
    // Give any stray rejection a macrotask to surface before we assert.
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(unhandled, 0, 'no rejection may escape the pool');
  } finally {
    process.removeListener('unhandledRejection', onUnhandled);
  }
});

test('X2/X3 · an unreachable RPC exits 2 with the doctrine line before a one-line cause', async () => {
  const { code, stderr } = await runCli(['--rpc', 'http://127.0.0.1:9']);
  assert.equal(code, 2, `RPC failure must exit 2 (operational), got ${code}\nstderr: ${stderr}`);

  const doctrineAt = stderr.indexOf('infrastructure, not a violation');
  const causeAt = stderr.indexOf('cause:');
  assert.ok(doctrineAt >= 0, `doctrine line missing from stderr:\n${stderr}`);
  assert.ok(causeAt >= 0, `cause line missing from stderr:\n${stderr}`);
  assert.ok(doctrineAt < causeAt, 'the doctrine must print BEFORE the cause — never a wall of red first');

  const causeLine = stderr.slice(causeAt).split('\n')[0]!;
  assert.ok(causeLine.length <= 220, `cause must be one trimmed line, got ${causeLine.length} chars`);
  assert.ok(!stderr.includes('Request body:'), 'viem\'s request-body dump must not reach the judge');
});

test('X5 · the screenshot footer carries the package.json version', async () => {
  const { code, stdout } = await runCli(['--fixture', 'live-snapshot']);
  assert.equal(code, 0);
  assert.match(stdout, new RegExp(`mandate-verify v${PKG_VERSION.replace(/\./g, '\\.')} \\(`), 'footer must print the single-sourced version + commit');
  assert.ok(stdout.includes('VERDICT: COMPLIANT'), 'footer sits under the verdict');
});
