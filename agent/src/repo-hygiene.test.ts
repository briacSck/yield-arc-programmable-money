import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Two regression guards for bugs that were invisible precisely BECAUSE nothing tested them.
 * Both are cheap; both would have saved real time.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const WORKSPACES_WITH_TESTS = ['agent', 'verifier', 'forecast', 'scenario', 'packages/shared'];

/**
 * GUARD 1 — the test glob must stay QUOTED.
 *
 * `node --test src/**​/*.test.ts` unquoted is expanded by the SHELL. sh has no globstar, so it
 * expands to `src/*​/*.test.ts` and every test file sitting at a workspace `src/` root is silently
 * dropped — on Linux CI only, because cmd.exe on Windows passes the pattern through to node, which
 * implements `**` properly. That divergence is what hid it: green locally, incomplete in CI.
 *
 * It cost us the trade-gate sims (the gates that authorised real money movement), the scheduler
 * tests, and the verifier's golden test — 26 agent tests and 2 verifier tests that nobody knew
 * weren't running. Quoting hands expansion to node on both platforms.
 */
test('GUARD: every workspace test script quotes its glob (else sh silently drops root-level tests)', () => {
  for (const ws of WORKSPACES_WITH_TESTS) {
    const pkg = JSON.parse(readFileSync(path.join(REPO_ROOT, ws, 'package.json'), 'utf8'));
    const script: string | undefined = pkg.scripts?.test;
    assert.ok(script, `${ws} has no test script`);
    if (!script!.includes('*')) continue; // not glob-based; nothing to protect
    assert.match(
      script!,
      /--test\s+"[^"]*\*\*[^"]*"/,
      `${ws}: the test glob must be quoted — unquoted, sh expands ** as * and root-level test files never run in CI`,
    );
  }
});

/**
 * GUARD 2 — importing the agent package must not start a scheduler.
 *
 * The entrypoint guard in `run.ts` used to ask "does my module URL END WITH the basename of
 * argv[1]?", which is true for ANY entry script called `run.ts`. Importing `@yield/agent` from
 * `scenario/src/run.ts` therefore started a real scheduler as a side effect of the import.
 *
 * In observe mode that was only noise. From a trade-configured environment it would have been a
 * SECOND money loop running beside the live one — and "one owner at a time" is what keeps the
 * on-chain history coherent. The test reproduces the exact shape: an entry script named `run.ts`
 * that imports the package and does nothing else.
 */
test('GUARD: importing @yield/agent from a script named run.ts starts no scheduler', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'yield-entrypoint-'));
  const script = path.join(dir, 'run.ts');
  writeFileSync(
    script,
    // Import for its side effects only — if the module self-starts, the scheduler banner appears.
    `import '${pathToImportSpecifier(path.join(REPO_ROOT, 'agent', 'src', 'index.ts'))}';\nconsole.log('IMPORT_OK');\n`,
  );

  const out = execFileSync(process.execPath, ['--import', 'tsx', script], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, SCHEDULER_MODE: 'observe', AGENT_MANDATE_ADDRESS: '', WORKER_PORT: '0' },
    timeout: 60_000,
  });

  assert.match(out, /IMPORT_OK/, 'the import itself must succeed');
  assert.doesNotMatch(
    out,
    /starting scheduler/,
    'importing the agent package started a scheduler — the entrypoint guard is comparing basenames again',
  );
});

/** Absolute path → a POSIX-style import specifier usable inside generated source. */
function pathToImportSpecifier(p: string): string {
  return p.replace(/\\/g, '/');
}
