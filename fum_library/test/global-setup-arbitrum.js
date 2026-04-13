/**
 * Global Setup for Arbitrum-forked tests.
 *
 * Starts a single Hardhat node on port 8545, deploys FUM contracts,
 * takes a base snapshot, and saves the state for test files to connect to.
 * Runs once before all Arbitrum project tests.
 */

import { startHardhat } from './setup/hardhat-config.js';
import { deployFUMContracts } from './setup/test-contracts.js';
import { saveSharedState, clearSharedState } from './shared-state.js';

const PORT = 8545;

export default async function globalSetup() {
  console.log('\n========================================');
  console.log('  ARBITRUM GLOBAL SETUP');
  console.log('========================================\n');

  clearSharedState();

  // Start Hardhat node with Arbitrum fork
  console.log(`Starting Hardhat on port ${PORT} (Arbitrum fork)...`);
  const hardhat = await startHardhat({ port: PORT, quiet: true });
  console.log('Hardhat started');

  // Deploy FUM contracts
  console.log('Deploying FUM contracts...');
  const deployment = await deployFUMContracts(
    hardhat.signers[0],
    { updateContractsFile: true }
  );
  console.log('Contracts deployed');

  // Fund test accounts
  for (let i = 1; i < Math.min(5, hardhat.signers.length); i++) {
    const tx = await hardhat.signers[0].sendTransaction({
      to: hardhat.signers[i].address,
      value: (await import('ethers')).ethers.utils.parseEther('10')
    });
    await tx.wait();
  }
  console.log('Test accounts funded');

  // Take base snapshot (clean state with contracts deployed + accounts funded)
  const baseSnapshotId = await hardhat.provider.send('evm_snapshot', []);
  console.log(`Base snapshot: ${baseSnapshotId}`);

  // Save state for test files
  saveSharedState({
    port: PORT,
    chainId: 1337,
    baseSnapshotId,
    addresses: deployment.addresses,
  });

  console.log('Shared state saved');
  console.log('========================================\n');

  // Return teardown function
  return async () => {
    console.log('\n========================================');
    console.log('  ARBITRUM GLOBAL TEARDOWN');
    console.log('========================================\n');

    try {
      await hardhat.stop();
      console.log('Hardhat stopped');
    } catch (error) {
      console.error('Error stopping Hardhat:', error.message);
    }

    clearSharedState();
    console.log('State cleaned up\n');
  };
}
