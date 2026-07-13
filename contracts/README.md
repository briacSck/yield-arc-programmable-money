# yield-contracts

Hardhat 3 workspace for `SweepEscrow.sol` — the on-chain minimum-balance covenant behind
the Arc demo (see `/plan-ceo-review` and `/plan-eng-review` sessions, 2026-06-18, and
`../docs/architecture.md`).

## Setup

```bash
npm install
npx hardhat compile
npx hardhat test
```

## ⚠️ Known environment limitation (compile/test runs in CI, not on win32-arm64)

Two native deps Hardhat 3 needs — `@nomicfoundation/solidity-analyzer` (0.1.2 required;
ARM64 builds stop at 0.1.1) and `@nomicfoundation/edr` (its in-process EVM, no win32-arm64
build at all) — have **no Windows ARM64 binaries**. So `npx hardhat compile`/`test` cannot
run on a Windows ARM64 machine.

This is an environment limitation, not a code issue, and it is covered: the contract is
**compiled and tested on x64 in CI** (`.github/workflows/arc-verify.yml`, ubuntu-latest),
which runs all of `test/SweepEscrow.test.ts` including the P0 covenant-revert test, plus a
backend↔real-EVM integration test (`../src/arc/arc-rpc.integration.spec.ts`). Treat green CI
as the proof that this contract works — do not merge on the strength of the win32-arm64 local
run, which skips the chain tests entirely. On an x64/Linux/macOS machine the commands above
run normally.

## Deploying to Arc testnet

```bash
# .env: ARC_RPC_URL, ARC_DEPLOYER_PRIVATE_KEY (see hardhat.config.ts)
npm run deploy:arc-testnet
```

RPC details: https://docs.arc.io/arc/references/connect-to-arc.md
Testnet faucet: https://faucet.circle.com

After deploying, set `ARC_ESCROW_CONTRACT_ADDRESS` in `../.env` (yield-backend) to the
printed contract address.
