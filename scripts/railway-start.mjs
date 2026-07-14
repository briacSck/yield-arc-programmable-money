// Railway start dispatcher — one monorepo, two services. Railpack requires a root start command;
// Railway injects RAILWAY_SERVICE_NAME, so the same repo starts as either service.
import { spawnSync } from 'node:child_process';

const service = process.env.RAILWAY_SERVICE_NAME || process.env.SERVICE_ROLE;
const workspaceByService = { worker: 'agent', dashboard: 'dashboard' };
const workspace = workspaceByService[service];

if (!workspace) {
  console.error(
    `railway-start: unknown service "${service}" — set RAILWAY_SERVICE_NAME/SERVICE_ROLE to one of: ${Object.keys(workspaceByService).join(', ')}`,
  );
  process.exit(1);
}

console.log(`[railway-start] service=${service} → npm start --workspace ${workspace}`);
const result = spawnSync('npm', ['start', '--workspace', workspace], { stdio: 'inherit', shell: true });
process.exit(result.status ?? 1);
