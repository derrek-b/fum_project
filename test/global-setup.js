/**
 * Global Test Setup - Shared Hardhat Instance
 *
 * This file runs ONCE before all tests to:
 * 1. Start a single Hardhat instance
 * 2. Deploy FUM contracts
 * 3. Take a base snapshot
 * 4. Save state for tests to connect
 *
 * Tests connect to this shared instance instead of starting their own,
 * eliminating address drift and race conditions on contracts.js
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { initFumLibrary } from 'fum_library';
import { startHardhat } from 'fum_library/test/setup/hardhat-config';
import { deployFUMContracts } from 'fum_library/test/setup/test-contracts';
import { saveSharedState, clearSharedState } from './shared-state.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default async function globalSetup() {
  console.log('\n========================================');
  console.log('  GLOBAL TEST SETUP - Shared Hardhat');
  console.log('========================================\n');

  // Load environment variables (needed for Alchemy API key)
  dotenv.config({ path: path.join(__dirname, '../.env.local') });

  // Initialize fum_library with all API keys (V3 and V4 both need these)
  initFumLibrary({
    alchemyApiKey: process.env.ALCHEMY_API_KEY,
    coingeckoApiKey: process.env.COINGECKO_API_KEY,
    theGraphApiKey: process.env.THEGRAPH_API_KEY,
    arbiscanApiKey: process.env.ARBISCAN_API_KEY,
  });

  // Clear any stale state from previous runs
  clearSharedState();

  // Start single Hardhat instance on port 8545
  // quiet: true suppresses transaction logging from Hardhat
  console.log('Starting shared Hardhat instance on port 8545...');
  const hardhat = await startHardhat({ port: 8545, quiet: true });
  console.log('Hardhat started successfully');

  // Deploy FUM contracts once
  console.log('\nDeploying FUM contracts...');
  const deployer = hardhat.signers[0];
  const deployment = await deployFUMContracts(deployer, {
    updateContractsFile: true
  });
  console.log('Contracts deployed:');
  console.log(`  VaultFactory: ${deployment.addresses.VaultFactory}`);
  console.log(`  BabyStepsStrategy: ${deployment.addresses.BabyStepsStrategy}`);

  // Take base snapshot (clean state with contracts deployed, no vaults)
  const baseSnapshotId = await hardhat.provider.send('evm_snapshot', []);
  console.log(`\nBase snapshot taken: ${baseSnapshotId}`);

  // Save state for tests to use
  // Keep original casing for compatibility with existing tests
  saveSharedState({
    pid: hardhat.process.pid,
    port: 8545,
    baseSnapshotId,
    deployedContracts: deployment.addresses
  });

  console.log('\n========================================');
  console.log('  Shared Hardhat ready for tests');
  console.log('========================================\n');

  // Return teardown function (vitest calls this after all tests)
  return async () => {
    console.log('\n========================================');
    console.log('  GLOBAL TEST TEARDOWN');
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
