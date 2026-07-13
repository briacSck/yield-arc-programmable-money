#!/usr/bin/env -S npx tsx
import { BOULANGERIE_CHARTIER } from './persona.js';

/**
 * Scenario driver — plan §11 / §16.5. A seeded, realistic French-SME ledger + a simulated clock
 * that compresses 90 days into ~90 seconds, replayable and deterministic. The video is recorded
 * from this; it is also the offline fallback if testnet wobbles on Demo Day.
 *
 *   scenario/run.ts --days 90 --speed <x>
 *
 * Three beats to drive (§11):
 *   1. Surplus detected → agent DEPLOYs to the yield venue (explorer link appears live).
 *   2. Forecast turns: P10 projects a floor breach in 12 days → agent WITHDRAWs ahead of the crunch.
 *   3. Wheat +20% → exposure engine raises the floor → partial withdrawal.
 *   Kicker: owner adjusts the mandate on-chain → the agent's next move is provably blocked.
 *
 * TODO(Briac/Sara): wire the case generator (yield-forecasting `bcbdeca`), the simulated clock,
 * and the decide→execute loop. Must replay bit-identically at a fixed seed.
 */
interface Args {
  days: number;
  speed: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { days: 90, speed: 1 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--days') args.days = Number(argv[++i]);
    else if (argv[i] === '--speed') args.speed = Number(argv[++i]);
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  console.log(
    `[scenario] ${BOULANGERIE_CHARTIER.name} — ${args.days} days @ ${args.speed}x (seed ${BOULANGERIE_CHARTIER.seed})`,
  );
  // TODO: run the simulated clock over the seeded ledger, driving the agent loop each tick.
  throw new Error('TODO: implement the scenario driver.');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
