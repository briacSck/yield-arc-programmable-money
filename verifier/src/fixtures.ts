import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { NormalizedEvent } from './types.js';

/**
 * `--fixture <name>` — a compiled-in WHITELIST (never an arbitrary path: AGENTS.md invariant 3,
 * and a dashboard hazard if user input picked files). Fixtures load from JSON with string-encoded
 * bigints and are re-hydrated here. This one flag is: the negative demo, the "verify the verifier"
 * proof, the testnet-flakiness fallback for judging week, and the works-behind-any-firewall path.
 */
export const FIXTURE_NAMES = ['naive-agent', 'live-snapshot'] as const;
export type FixtureName = (typeof FIXTURE_NAMES)[number];

const FIXTURE_FILE: Record<FixtureName, string> = {
  'naive-agent': 'naive-agent.json',
  'live-snapshot': 'live-history-2026-07-23.json',
};

export interface LoadedFixture {
  events: NormalizedEvent[];
  mandateAddress: `0x${string}`;
  chainId: number;
  deployBlock: bigint;
  provenance: string;
}

const FIXTURE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

function hydrate(raw: any): NormalizedEvent[] {
  return (raw.events as any[]).map((e) => {
    const base = {
      blockNumber: BigInt(e.blockNumber),
      logIndex: Number(e.logIndex),
      timestamp: BigInt(e.timestamp),
      ...(e.txHash ? { txHash: e.txHash as `0x${string}` } : {}),
    };
    const a = e.args;
    switch (e.name) {
      case 'MandateChanged':
        return { ...base, name: 'MandateChanged', args: { floor: BigInt(a.floor), maxTicket: BigInt(a.maxTicket), dailyCap: BigInt(a.dailyCap) } };
      case 'CompanyFunded':
        return { ...base, name: 'CompanyFunded', args: { amount: BigInt(a.amount), newCompanyBalance: BigInt(a.newCompanyBalance) } };
      case 'DecisionExecuted':
        return { ...base, name: 'DecisionExecuted', args: { decisionId: a.decisionId, kind: Number(a.kind), amount: BigInt(a.amount), forecastHash: a.forecastHash } };
      case 'Revoked':
        return { ...base, name: 'Revoked', args: { by: a.by } };
      case 'Reinstated':
        return { ...base, name: 'Reinstated', args: { by: a.by } };
      case 'EmergencyWithdrawal':
        return { ...base, name: 'EmergencyWithdrawal', args: { to: a.to, amount: BigInt(a.amount) } };
      default:
        throw new Error(`fixture ${raw._name}: unknown event ${e.name}`);
    }
  });
}

export function loadFixture(name: FixtureName): LoadedFixture {
  const file = FIXTURE_FILE[name];
  if (!file) throw new Error(`unknown fixture "${name}" — choose one of: ${FIXTURE_NAMES.join(', ')}`);
  const raw = JSON.parse(readFileSync(path.join(FIXTURE_DIR, file), 'utf8'));
  const events = hydrate(raw);
  return {
    events,
    mandateAddress: (raw.mandateAddress ?? '0x0000000000000000000000000000000000000000') as `0x${string}`,
    chainId: raw.chainId ?? 5042002,
    deployBlock: BigInt(raw.deployBlock ?? events[0]?.blockNumber ?? 0),
    provenance:
      name === 'naive-agent'
        ? 'SYNTHETIC FIXTURE — a naive unbounded agent, for contrast. NOT YIELD\'s history.'
        : 'OFFLINE SNAPSHOT of YIELD\'s live on-chain history at block ' + (raw.toBlock ?? '?') + ' (2026-07-23). Re-run without --fixture to verify live.',
  };
}
