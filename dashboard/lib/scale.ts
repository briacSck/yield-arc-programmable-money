/**
 * Demo scale — the ONE place the 1:3800 ratio lives.
 *
 * "Demo ledger, real settlement": Boulangerie Chartier is a modelled client whose cash profile is
 * real French-SME data, settled on Arc testnet at 1:3800 so the amounts stay inside what a testnet
 * faucet can supply. Every rule — floor, per-ticket cap, 24h budget, revocation — is enforced at
 * full fidelity on-chain; only the amounts are small.
 *
 * RULE: owner mode speaks the business's units (€ at real scale). Advanced mode speaks the chain's
 * units (USDC, as settled). They live in different modes with a stated relationship, and the two
 * are NEVER mixed in one glance — a euro figure beside an attested on-chain figure invites the
 * reader to think the chain attested the euro figure. It did not.
 *
 * The machine verdict is never converted. `closestApproachToFloorUsdc` and everything else the
 * verifier checked stays in the units the verifier checked.
 */

/** USDC base units (6-dec) per euro of the modelled business. */
export const DEMO_SCALE = 3800;

/** The modelled client. Named on screen so nobody mistakes it for a real customer's books. */
export const DEMO_CLIENT = 'Boulangerie Chartier';

/** USDC base units → euros of the modelled business. */
export function toEur(baseUnits: string | bigint): number {
  const v = typeof baseUnits === 'bigint' ? baseUnits : BigInt(baseUnits || '0');
  // Cents first, so the rounding happens once and in integer space.
  const cents = (v * BigInt(DEMO_SCALE) * 100n) / 1_000_000n;
  return Number(cents) / 100;
}

/** Euros → display string. Whole euros: treasury figures are not read to the cent. */
export function eur(value: number, opts: { cents?: boolean } = {}): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: opts.cents ? 2 : 0,
    maximumFractionDigits: opts.cents ? 2 : 0,
  }).format(value);
}

/** USDC base units → euro display string, in one step. */
export function eurFrom(baseUnits: string | bigint, opts: { cents?: boolean } = {}): string {
  return eur(toEur(baseUnits), opts);
}
