// Bundle the CLI. A script (not inline esbuild flags) so the commit hash can be embedded without
// shell substitution — `$(git rev-parse …)` inside an npm script breaks on Windows (see the
// handoff's PowerShell gotcha). The commit lands in the human footer and the --json record (X5).
import { execSync } from 'node:child_process';
import { build } from 'esbuild';

let commit = 'unreleased';
try {
  commit = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || 'unreleased';
} catch {
  // Building outside a git checkout (e.g. from the npm tarball) — 'unreleased' is honest.
}

await build({
  entryPoints: ['src/cli.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: 'dist/cli.js',
  banner: { js: '#!/usr/bin/env node' },
  define: { __VERIFIER_COMMIT__: JSON.stringify(commit) },
});
