/**
 * Read-only: who is actually permitted to subscribe to USYC?
 *
 *   npx tsx agent/scripts/check-usyc-permission.ts [0xaddress ...]
 *
 * Exists because the previous allowlist check was a false positive for every address on the chain
 * (the Teller hands out the same daily limit to anyone, including 0x…deadbeef). This asks the
 * Teller's own RolesAuthority instead, which is what its deposit path actually asserts against.
 */
import { createPublicClient, http } from 'viem';
import { USYCVenue, USYC_TELLER } from '../src/chain/usyc-venue.js';

const RPC = process.env.ARC_RPC_URL || 'https://rpc.drpc.testnet.arc.io';

const KNOWN: Array<[string, `0x${string}`]> = [
  ['agent EOA', '0x93d9c11c8e9e23e1e97e855668a27a14accaab7c'],
  ['company/owner EOA', '0x4704fb05a6e87c482090cf5534e86c9ab44bbfda'],
  ['mandate v1 (contract)', '0x856bec6faadd61b583430e0cd22ec2e211c782b4'],
  ['a nobody (control)', '0x00000000000000000000000000000000deadbeef'],
];

async function main() {
  const client = createPublicClient({ transport: http(RPC) });
  const venue = new USYCVenue(client);

  const extra = process.argv.slice(2).filter((a) => /^0x[0-9a-fA-F]{40}$/.test(a));
  const targets: Array<[string, `0x${string}`]> = [
    ...KNOWN,
    ...extra.map((a) => ['(argument)', a as `0x${string}`] as [string, `0x${string}`]),
  ];

  console.log(`\n  USYC subscription permission — Teller ${USYC_TELLER}`);
  console.log('  asked of the Teller\'s own RolesAuthority, not its daily limits\n');

  for (const [label, addr] of targets) {
    let verdict: string;
    try {
      verdict = (await venue.isAllowlisted(addr)) ? 'PERMITTED' : 'not permitted';
    } catch (err) {
      verdict = `unreadable (${(err as Error).message.slice(0, 60)})`;
    }
    console.log(`  ${label.padEnd(24)} ${addr}  ${verdict}`);
  }

  console.log(
    '\n  A newly deployed mandate holds no role until Circle/Hashnote grants one.\n' +
      '  That is a support ticket, not a code change.\n',
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
