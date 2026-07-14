// Railway build dispatcher — dashboard needs `next build`; the worker runs tsx directly and
// needs no build. Locally (no RAILWAY_SERVICE_NAME) falls back to building every workspace.
import { spawnSync } from 'node:child_process';

const service = process.env.RAILWAY_SERVICE_NAME || process.env.SERVICE_ROLE;

const run = (args) => {
  console.log(`[railway-build] npm ${args.join(' ')}`);
  const result = spawnSync('npm', args, { stdio: 'inherit', shell: true });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

if (service === 'dashboard') {
  run(['run', 'build', '--workspace', 'dashboard']);
} else if (service === 'worker') {
  console.log('[railway-build] worker needs no build step (tsx runtime).');
} else {
  run(['run', 'build', '--workspaces', '--if-present']);
}
