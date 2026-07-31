# contracts — the on-chain mandates

Hardhat 3 workspace for the contracts behind the live demo:

| Contract | Status | What |
|---|---|---|
| `AgentMandate.sol` | **LIVE** — [`0x856bec6f…c782b4`](https://testnet.arcscan.app/address/0x856bec6faadd61b583430e0cd22ec2e211c782b4) | The owner-granted, owner-revocable employment contract the agent provably cannot exceed: safe floor, per-ticket cap, lazy tumbling 24h budget window, post-revocation asymmetry (deposits refused, withdrawals open), decision receipts (`decisionId = keccak(forecastHash | kind)`). The verifier replays its full history nightly. |
| `AgentMandateV2.sol` | **DEPLOYED** — [`0xd41d3648…492f70`](https://testnet.arcscan.app/address/0xd41d3648c71641fb2801415726787d5728492f70) | v1 + the venue seam (`IYieldVenue`): the deployed leg subscribes into an ERC-4626 yield venue (USYC on Arc). Deployed *alongside* v1 so v1's audited record is untouched. Venue set to the USYC Teller on 2026-07-31 after Circle granted both allowlist roles. |
| `SweepEscrow.sol` | vendored, superseded | The pre-mandate minimum-balance covenant from the June spike. Kept for the trail (see `VENDORED.md`); not deployed, not part of the demo. |

68 Hardhat tests cover both mandates, including the tumbling-window edge cases the verifier's
replay core mirrors exactly.

## Setup

```bash
npm install
npm run compile
npm test        # 68 tests
```

## ⚠️ Known environment limitation (compile/test runs in CI, not on win32-arm64)

Two native deps Hardhat 3 needs — `@nomicfoundation/solidity-analyzer` (0.1.2 required;
ARM64 builds stop at 0.1.1) and `@nomicfoundation/edr` (its in-process EVM, no win32-arm64
build at all) — have **no Windows ARM64 binaries**, so `compile`/`test` cannot run on a
Windows ARM64 machine. The contracts are **compiled and tested on x64 in CI**
(`.github/workflows/arc-verify.yml`, ubuntu-latest). Treat green CI as the proof; on an
x64/Linux/macOS machine the commands above run normally.

## Deploying

The mandates are deployed through **Circle's Smart Contract Platform** from the company's
developer-controlled wallet — see `../agent/scripts/deploy-mandate-v2.ts` (preflight → deploy →
sanity reads → USYC role check). The venue is then armed with
`../agent/scripts/set-venue.ts` once Circle grants the contract its USYC allowlist roles.

RPC details: https://docs.arc.io/arc/references/connect-to-arc.md ·
Testnet faucet: https://faucet.circle.com
