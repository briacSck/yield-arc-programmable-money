#!/usr/bin/env node
import { replay } from './core/replay.js';
import { fetchHistory } from './fetch.js';
import { loadFixture, FIXTURE_NAMES, type FixtureName } from './fixtures.js';
import { renderVerdict, toJson } from './format.js';
import {
  ARC_CHAIN_ID,
  DASHBOARD_URL,
  DEFAULT_DEPLOY_BLOCK,
  DEFAULT_MANDATE_ADDRESS,
} from './config.js';
import type { Verdict } from './types.js';

/** Bumped with releases; printed in verdicts + the terminal footer for reproducibility. */
const VERIFIER_VERSION = '0.1.0';

/**
 * The judge's first touch (§18.2c). Zero-config: `npx -y @yield-cfo/mandate-verify` verifies
 * YIELD's live mandate with compiled-in defaults — no prompts, no env. Exit codes:
 *   0 = COMPLIANT (incl. a flagged degrade)   — the product working
 *   1 = VIOLATION found                        — the product working (it caught something)
 *   2 = OPERATIONAL error                      — nothing proven either way
 */

interface Args {
  rpc?: string;
  address?: `0x${string}`;
  deployBlock?: bigint;
  fixture?: FixtureName;
  json: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { json: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i]!;
    const val = () => {
      const v = argv[++i];
      if (v === undefined) fail2(`${t} requires a value.`);
      return v;
    };
    switch (t) {
      case '--rpc': a.rpc = val(); break;
      case '--address': a.address = requireHex(val(), '--address'); break;
      case '--deploy-block': a.deployBlock = BigInt(val()); break;
      case '--fixture': {
        const name = val();
        if (!(FIXTURE_NAMES as readonly string[]).includes(name)) {
          fail2(`unknown fixture "${name}". Available: ${FIXTURE_NAMES.join(', ')}`);
        }
        a.fixture = name as FixtureName;
        break;
      }
      case '--json': a.json = true; break;
      case '-h': case '--help': a.help = true; break;
      default: fail2(`unknown flag "${t}". Try --help.`);
    }
  }
  return a;
}

function requireHex(v: string, flag: string): `0x${string}` {
  if (!/^0x[0-9a-fA-F]{40}$/.test(v)) fail2(`${flag} must be a 20-byte hex address, got "${v}"`);
  return v as `0x${string}`;
}

function fail2(msg: string): never {
  process.stderr.write(`\n  error: ${msg}\n\n`);
  process.exit(2);
}

const HELP = `
  mandate-verify — replay a YIELD AgentMandate's full on-chain history and machine-check
  every move against its five invariants (floor / ticket / 24h window / asymmetry / receipts).

  USAGE
    npx -y @yield-cfo/mandate-verify [options]

  With no options it verifies YIELD's live mandate on Arc testnet (zero config).

  OPTIONS
    --fixture <name>     verify a compiled-in fixture instead of the live chain (no network):
                           naive-agent    a naive unbounded agent — the negative demo (exits 1)
                           live-snapshot  YIELD's history snapshotted 2026-07-23 (offline, exits 0)
    --address <0x..>     verify a different mandate (any conforming deployment)
    --deploy-block <n>   the mandate's constructor block (required with a custom --address)
    --rpc <url>          override the RPC endpoint (default: built-in Arc endpoint pool)
    --json               emit the machine-readable verdict record and nothing else
    -h, --help           this text

  EXIT CODES
    0  COMPLIANT (the agent stayed within its mandate)
    1  VIOLATION found (the verifier caught an out-of-bounds move)
    2  operational error (RPC/args — nothing proven either way)

  Live dashboard: ${DASHBOARD_URL}
  See a violating agent fail this audit:  npx -y @yield-cfo/mandate-verify --fixture naive-agent
`;

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(HELP);
    return 0;
  }
  if (args.address && args.deployBlock === undefined && !args.fixture) {
    fail2('--address requires --deploy-block (the mandate\'s constructor block).');
  }

  let verdict: Verdict;

  if (args.fixture) {
    const fx = loadFixture(args.fixture);
    if (!args.json) process.stderr.write(`\n  ${fx.provenance}\n`);
    verdict = replay(fx.events, {
      mandateAddress: fx.mandateAddress,
      chainId: fx.chainId,
      deployBlock: fx.deployBlock,
      source: 'fixture',
    });
  } else {
    const address = args.address ?? DEFAULT_MANDATE_ADDRESS;
    const deployBlock = args.deployBlock ?? DEFAULT_DEPLOY_BLOCK;
    if (!args.json) {
      process.stderr.write(`\n  Verifying ${address} on Arc testnet ${ARC_CHAIN_ID}\n`);
      process.stderr.write(`  Scanning from deploy block ${deployBlock} …\n`);
    }
    let fetched;
    try {
      fetched = await fetchHistory(address, deployBlock, {
        ...(args.rpc ? { rpcUrls: [args.rpc] } : {}),
        onProgress: (done, total) => {
          if (!args.json && (done === total || done % 25 === 0)) {
            process.stderr.write(`  … scanned ${done}/${total} block ranges\n`);
          }
        },
      });
    } catch (err) {
      // RPC/chain failure = operational, NOT a violation. Nothing was proven either way.
      process.stderr.write(
        `\n  error: ${(err as Error).message}\n` +
          `  Nothing was proven or disproven — this is infrastructure, not a violation.\n` +
          `  Fix: retry, pass --rpc <url>, or run offline: npx -y @yield-cfo/mandate-verify --fixture live-snapshot\n` +
          `  Live nightly audit: ${DASHBOARD_URL}\n\n`,
      );
      return 2;
    }
    if (!args.json && fetched.unknownLogCount > 0) {
      process.stderr.write(`  (${fetched.unknownLogCount} non-mandate log(s) tolerated — e.g. Arc EIP-7708 native transfers)\n`);
    }
    verdict = replay(fetched.events, {
      mandateAddress: address,
      chainId: fetched.chainId,
      deployBlock,
      scannedThroughBlock: fetched.scannedThroughBlock,
      source: 'chain',
    });

    // A live scan that never saw the constructor's MandateChanged reconstructed against a
    // zero-mandate — a wrong --address or a --deploy-block past the constructor. Any verdict here
    // is meaningless, and a verifier must never emit a wrong verdict (same doctrine as the chainId
    // preflight). Operational error, not COMPLIANT.
    if (!verdict.mandateSeeded) {
      process.stderr.write(
        `\n  error: no MandateChanged event found from block ${deployBlock} — this is not a mandate's\n` +
          `  constructor block, or ${address} is not an AgentMandate. Nothing was proven either way.\n` +
          `  Fix: pass the mandate's real --deploy-block, or drop --address/--deploy-block for the\n` +
          `  built-in YIELD defaults.\n\n`,
      );
      return 2;
    }
  }

  if (args.json) {
    // Stamp run metadata here (the I/O layer) — the pure core stays clock-free. This is what the
    // nightly CI publishes to the audit-log ref and the dashboard reads for its freshness eyebrow.
    const record = JSON.parse(toJson(verdict)) as Record<string, unknown>;
    record.runAt = new Date().toISOString();
    record.version = `mandate-verify@${VERIFIER_VERSION}`;
    process.stdout.write(JSON.stringify(record, null, 2) + '\n');
  } else {
    process.stdout.write(renderVerdict(verdict));
  }
  return verdict.compliant ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`\n  fatal: ${(err as Error).stack ?? err}\n\n`);
    process.exit(2);
  },
);
