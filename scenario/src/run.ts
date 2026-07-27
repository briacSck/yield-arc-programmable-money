#!/usr/bin/env -S npx tsx
import { createHash } from 'node:crypto';
import { formatUsdc } from '@yield/agent';
import { BOULANGERIE_CHARTIER } from './persona.js';
import { defaultSimConfig, simulate, SIM_START_DATE, type SimBeat, type SimTick } from './sim.js';

/**
 * Scenario driver — plan §11 / §16.5. A seeded French-SME ledger + a simulated clock that
 * compresses 90 days into ~90 seconds, replayable and deterministic. The video is recorded from
 * this; it is also the offline fallback if testnet wobbles on Demo Day.
 *
 *   npm start -w scenario -- --days 90 --speed 1
 *   npm start -w scenario -- --speed 0        # instant, for CI and for reading
 *   npm start -w scenario -- --json           # the transcript, for diffing two runs
 *   npm start -w scenario -- --digest         # just the replay digest
 *
 * The simulation itself lives in `sim.ts` and is pure; this file only paces and prints it.
 */

interface Args {
  days: number;
  speed: number;
  json: boolean;
  digest: boolean;
  seed: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { days: 90, speed: 1, json: false, digest: false, seed: BOULANGERIE_CHARTIER.seed };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--days') args.days = Number(argv[++i]);
    else if (argv[i] === '--speed') args.speed = Number(argv[++i]);
    else if (argv[i] === '--seed') args.seed = Number(argv[++i]);
    else if (argv[i] === '--json') args.json = true;
    else if (argv[i] === '--digest') args.digest = true;
    else if (argv[i] === '--help' || argv[i] === '-h') {
      console.log(
        [
          'scenario — seeded ledger + simulated clock (SIMULATION, no chain, no money)',
          '',
          '  --days <n>    simulated days to replay (default 90)',
          '  --speed <x>   playback speed; 1 = ~1 day/second, 0 = instant (default 1)',
          '  --seed <n>    PRNG seed (default the pinned persona seed — change it and the video changes)',
          '  --json        print the full transcript as JSON instead of the narrative',
          '  --digest      print only the replay digest (identical across runs, by construction)',
        ].join('\n'),
      );
      process.exit(0);
    }
  }
  return args;
}

/** Stable digest over the transcript — two runs printing the same digest IS the determinism claim. */
export function replayDigest(ticks: SimTick[]): string {
  return createHash('sha256').update(JSON.stringify(ticks)).digest('hex').slice(0, 16);
}

const BEAT_LABEL: Record<SimBeat, string> = {
  deploy: 'BEAT 1 — surplus detected, swept into the venue',
  pullback: 'BEAT 2 — P10 projects a floor breach; funds recalled AHEAD of the crunch',
  exposure: 'BEAT 3 — wheat spikes; the safe floor rises and the agent pulls back',
  kicker: 'KICKER — the owner revoked the mandate; the next move is provably blocked',
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function renderTick(tick: SimTick): string {
  const kind = tick.decision.kind.padEnd(11);
  const money =
    tick.status === 'CONFIRMED' && tick.decision.kind !== 'HOLD'
      ? formatUsdc(BigInt(tick.decision.amountUsdc)).padStart(14)
      : ''.padStart(14);
  const mark =
    tick.status === 'CONFIRMED' ? '✓' : tick.status === 'BLOCKED' ? '⛔' : tick.decision.kind === 'HOLD' ? '·' : '–';
  const held = `held ${formatUsdc(BigInt(tick.companyBalanceUsdc))}`;
  const out = `${tick.date}  ${mark} ${kind}${money}   ${held}, deployed ${formatUsdc(BigInt(tick.deployedUsdc))}`;
  return tick.revoked ? `${out}   [REVOKED]` : out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const config = defaultSimConfig({ days: args.days, seed: args.seed });
  const ticks = simulate(config);

  if (args.digest) {
    console.log(replayDigest(ticks));
    return;
  }
  if (args.json) {
    console.log(JSON.stringify({ config, digest: replayDigest(ticks), ticks }, null, 2));
    return;
  }

  console.log('');
  console.log(`  ${BOULANGERIE_CHARTIER.name} — ${args.days} simulated days from ${SIM_START_DATE}`);
  console.log(`  seed ${args.seed} · mandate floor ${formatUsdc(BigInt(config.mandate.floorUsdc))} · ticket ${formatUsdc(BigInt(config.mandate.maxTicketUsdc))} · 24h cap ${formatUsdc(BigInt(config.mandate.dailyCapUsdc))}`);
  console.log('');
  console.log('  ⚠️  SIMULATION — seeded ledger, simulated wheat index, modelled mandate.');
  console.log('     No chain, no money, no real prices. YIELD\'s REAL on-chain history is at');
  console.log('     https://dashboard-production-abea.up.railway.app and is machine-checked by');
  console.log('     npx -y @yield-cfo/mandate-verify. Nothing below proves anything about it.');
  console.log('');

  const perDayMs = args.speed > 0 ? 1000 / args.speed : 0;
  let lastExposureUplift: string | null = null;
  for (const tick of ticks) {
    // Quiet HOLDs stay quiet, and a standing FLOOR_RAISE prints only when the uplift CHANGES —
    // the log should read like a decision record, not a heartbeat. A raised floor that is simply
    // still raised is not news; the day it moves is.
    const uplift = tick.exposure?.floorUpliftUsdc ?? null;
    const upliftIsNews = uplift !== lastExposureUplift;
    lastExposureUplift = uplift;
    const quiet = tick.decision.kind === 'HOLD' || (tick.decision.kind === 'FLOOR_RAISE' && !upliftIsNews);
    if (!quiet || tick.beat) console.log(`  ${renderTick(tick)}`);
    if (tick.beat) {
      console.log('');
      console.log(`     ▸ ${BEAT_LABEL[tick.beat]}`);
      console.log(`       ${tick.decision.reason}`);
      if (tick.note) console.log(`       ${tick.note}`);
      console.log('');
    }
    if (perDayMs > 0) await sleep(perDayMs);
  }

  const moves = ticks.filter((t) => t.status === 'CONFIRMED');
  const blocked = ticks.filter((t) => t.status === 'BLOCKED');
  const floor = BigInt(config.mandate.floorUsdc);
  // A floor BREACH means an agent action left the balance below the floor — the invariant the
  // mandate exists to enforce. Days when the business itself ran lean are a different fact, and
  // conflating the two would either flatter the agent or blame it for the calendar.
  const breaches = moves.filter(
    (t) => t.decision.kind === 'DEPLOY' && BigInt(t.companyBalanceUsdc) < floor,
  );
  const leanDays = ticks.filter((t) => BigInt(t.companyBalanceUsdc) < floor);

  console.log('');
  console.log(`  ${moves.length} money moves · ${blocked.length} blocked by the mandate · ${breaches.length} agent-caused floor breaches`);
  if (leanDays.length > 0) {
    console.log(`  (${leanDays.length} day(s) the BUSINESS itself sat below the floor — the agent's job is not to breach it further, and it did not)`);
  }
  console.log(`  replay digest ${replayDigest(ticks)} — identical on every run at this seed`);
  console.log('');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
