import { writeFileSync } from 'node:fs';
import { network } from 'hardhat';

/**
 * Deploys {AgentMandateV2} — the venue-aware mandate — **alongside** the live v1. It never
 * replaces it: v1 keeps its history, the verifier already takes `--address`, and two verifiable
 * mandates on one chain is a demo, not a cost.
 *
 * Network is selected by DEPLOY_NETWORK, matching `deploy.ts`:
 *   - unset        → in-process Hardhat network (a smoke test, nothing more)
 *   - 'localhost'  → a running `hardhat node` at 127.0.0.1:8545
 *   - 'arcTestnet' → real Arc testnet (needs ARC_RPC_URL + ARC_DEPLOYER_PRIVATE_KEY)
 *
 * NOTE ON ARC. This path signs with a raw private key. The mandate that is actually live was
 * deployed from the **Circle developer-controlled company wallet**, because the owner of a mandate
 * must be the company treasury wallet — the one that can `revoke`, `setMandate` and exit. Circle
 * does not expose that wallet's private key, and `/developer/sign/transaction` returned
 * "blockchain not supported" for ARC-TESTNET (verdict recorded 2026-07-14), so the proven route is
 * the Smart Contract Platform deploy in `agent/scripts/deploy-mandate-v2.ts`. Use THIS script when
 * you hold the key (local, CI, a fresh EOA owner); use that one to reproduce the live setup.
 *
 * Env (all optional except AGENT_ADDRESS on a real network):
 *   AGENT_ADDRESS       the agent signer — MUST differ from the deployer, or the constructor reverts
 *   USDC_ADDRESS        6-dec USDC ERC-20 interface; defaults to Arc's `0x3600…0000`
 *   MANDATE_FLOOR_USDC / MANDATE_MAX_TICKET_USDC / MANDATE_DAILY_CAP_USDC   6-dec base units
 *   VENUE_ADDRESS       if set, the script wires the venue after deploy (see the WARNING below)
 *
 * The address AND the deploy block are printed and written to contracts/deployed-mandate-v2.txt.
 * The verifier needs both: `--address <addr> --deploy-block <block>`.
 */

/** Arc's native-USDC ERC-20 interface. 6 decimals, same balance as the 18-dec native view. */
const ARC_USDC_ERC20 = '0x3600000000000000000000000000000000000000';

// Defaults mirror the live v1 mandate: floor 5 USDC, ticket 2 USDC, 24h budget 5 USDC. Small real
// amounts — testnet USDC is faucet-rationed at 20 per address per 2h behind a human click.
const DEFAULT_FLOOR = 5_000_000n;
const DEFAULT_MAX_TICKET = 2_000_000n;
const DEFAULT_DAILY_CAP = 5_000_000n;

function envBigint(key: string, fallback: bigint): bigint {
  const raw = process.env[key];
  return raw && raw.trim() !== '' ? BigInt(raw.trim()) : fallback;
}

async function main() {
  const networkName = process.env.DEPLOY_NETWORK;
  const { ethers } = networkName ? await network.connect(networkName) : await network.connect();

  const [deployer] = await ethers.getSigners();
  const agentAddress = process.env.AGENT_ADDRESS ?? (await ethers.getSigners())[1]?.address;
  if (!agentAddress) throw new Error('AGENT_ADDRESS is required (no second signer to fall back to).');
  if (agentAddress.toLowerCase() === deployer.address.toLowerCase()) {
    throw new Error('AGENT_ADDRESS equals the deployer: the constructor rejects an owner-equal agent.');
  }

  const usdc = process.env.USDC_ADDRESS ?? ARC_USDC_ERC20;
  const floor = envBigint('MANDATE_FLOOR_USDC', DEFAULT_FLOOR);
  const maxTicket = envBigint('MANDATE_MAX_TICKET_USDC', DEFAULT_MAX_TICKET);
  const dailyCap = envBigint('MANDATE_DAILY_CAP_USDC', DEFAULT_DAILY_CAP);

  console.log(`deployer (owner): ${deployer.address}`);
  console.log(`agent           : ${agentAddress}`);
  console.log(`usdc            : ${usdc}`);
  console.log(`mandate         : floor ${floor} · ticket ${maxTicket} · daily ${dailyCap} (6-dec base units)`);

  const AgentMandateV2 = await ethers.getContractFactory('AgentMandateV2');
  const mandate = await AgentMandateV2.deploy(agentAddress, floor, maxTicket, dailyCap, usdc);
  await mandate.waitForDeployment();

  const address = await mandate.getAddress();
  const deployBlock = (await mandate.deploymentTransaction()?.wait())?.blockNumber ?? 0;

  // The venue starts UNSET on purpose. Wiring it is a separate, deliberate act because on Arc the
  // USYC Teller gates every caller AND every share recipient through Circle's RolesAuthority — a
  // brand-new contract address holds no role and every `deposit` reverts `NotPermissioned()` until
  // the issuer grants it one. Deploy, verify, get permissioned, THEN setVenue.
  const venue = process.env.VENUE_ADDRESS;
  if (venue) {
    console.log(`wiring venue ${venue} …`);
    await (await mandate.setVenue(venue)).wait();
    console.log(`venue set; share token: ${await mandate.venueShare()}`);
  } else {
    console.log('venue: UNSET (escrow-only until setVenue). This is the intended initial state.');
  }

  writeFileSync('deployed-mandate-v2.txt', `${address}\n${deployBlock}\n`);
  console.log(`\nAgentMandateV2 deployed to: ${address} (block ${deployBlock})`);
  console.log(`  https://testnet.arcscan.app/address/${address}`);
  console.log('  Wrote contracts/deployed-mandate-v2.txt (address on line 1, deploy block on line 2).');
  console.log(`\nVerify it:\n  npx tsx verifier/src/cli.ts --address ${address} --deploy-block ${deployBlock}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
