/**
 * One-time (idempotent) registration of the YIELD placement agent on the official, canonical Arc
 * ERC-8004 Identity Registry (0x8004A818…). Run explicitly — registration is a real on-chain tx,
 * never auto-fired on boot.
 *
 *   ARC_RPC_URL=… ARC_CHAIN_ID=… ARC_DEPLOYER_PRIVATE_KEY=… \
 *   ARC_IDENTITY_REGISTRY_ADDRESS=… PUBLIC_BASE_URL=… \
 *   npx ts-node scripts/register-arc-agent.ts
 *
 * Idempotent: a second run with a CONFIRMED/PENDING record is a no-op. The agent card at
 * ${PUBLIC_BASE_URL}/.well-known/agent-registration.json MUST be reachable first (the script
 * refuses otherwise, so the agent is never minted pointing at a dead URL).
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { ArcIdentityService } from '../src/arc/arc-identity.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['log', 'warn', 'error'] });
  try {
    const identity = app.get(ArcIdentityService);
    const record = await identity.registerPlacementAgent();
    console.log('Placement agent registration:', {
      status: record.status,
      registrationTx: record.registrationTx,
      agentId: record.agentId,
      agentURI: record.agentURI,
    });
    console.log('Poll GET /arc/identity until status=CONFIRMED (the confirmation cron extracts the agentId).');
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error('Registration failed:', err);
  process.exitCode = 1;
});
