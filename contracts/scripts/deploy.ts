import { writeFileSync } from 'node:fs';
import { network } from 'hardhat';

/**
 * Deploys SweepEscrow. Network is selected by DEPLOY_NETWORK:
 *   - unset            → in-process Hardhat network (rarely useful for deploy)
 *   - 'localhost'      → a running `hardhat node` at 127.0.0.1:8545 (CI integration job)
 *   - 'arcTestnet'     → real Arc testnet (needs ARC_RPC_URL + ARC_DEPLOYER_PRIVATE_KEY)
 *
 * For Arc testnet: get RPC details from https://docs.arc.io/arc/references/connect-to-arc.md
 * and testnet funds from https://faucet.circle.com.
 *
 * The deployed address is printed AND written to contracts/deployed-address.txt so CI (and the
 * testnet runbook) can read it without parsing stdout. Record it as ARC_ESCROW_CONTRACT_ADDRESS
 * in yield-backend's .env so ArcEscrowService/ArcRpcClient read from it.
 */
async function main() {
  const networkName = process.env.DEPLOY_NETWORK;
  const { ethers } = networkName ? await network.connect(networkName) : await network.connect();

  const SweepEscrow = await ethers.getContractFactory('SweepEscrow');
  const escrow = await SweepEscrow.deploy();
  await escrow.waitForDeployment();

  const address = await escrow.getAddress();
  writeFileSync('deployed-address.txt', address);
  console.log(`SweepEscrow deployed to: ${address}`);
  console.log('Wrote contracts/deployed-address.txt. Set ARC_ESCROW_CONTRACT_ADDRESS to this in yield-backend/.env.');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
