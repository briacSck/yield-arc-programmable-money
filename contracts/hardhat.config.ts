import { defineConfig } from 'hardhat/config';
import hardhatToolboxMochaEthers from '@nomicfoundation/hardhat-toolbox-mocha-ethers';
import 'dotenv/config';

// Arc testnet connection details per docs.arc.io (Connect to Arc reference) — confirm
// the exact RPC URL/chain ID against https://docs.arc.io/arc/references/connect-to-arc.md
// before deploying; nothing hardcoded into the repo, both come from env vars.
const ARC_TESTNET_RPC_URL = process.env.ARC_RPC_URL ?? '';
const DEPLOYER_PRIVATE_KEY = process.env.ARC_DEPLOYER_PRIVATE_KEY ?? '';

export default defineConfig({
  plugins: [hardhatToolboxMochaEthers],
  solidity: '0.8.24',
  networks: {
    // A running `hardhat node` at 127.0.0.1:8545 — used by the CI integration job to deploy
    // SweepEscrow into a node the backend test can then talk to over HTTP. Accounts are
    // "remote" (the node's own unlocked accounts), so the deployer is the node's account #0.
    localhost: {
      type: 'http' as const,
      url: 'http://127.0.0.1:8545',
    },
    // Only registered once ARC_RPC_URL is actually set — running `compile`/`test` locally
    // (no .env, no real RPC yet) must not fail just because the testnet isn't configured.
    ...(ARC_TESTNET_RPC_URL
      ? {
          arcTestnet: {
            type: 'http' as const,
            url: ARC_TESTNET_RPC_URL,
            accounts: DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : [],
          },
        }
      : {}),
  },
});
