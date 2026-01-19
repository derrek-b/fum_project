/**
 * V4 Global Test Setup - Shared Hardhat Instance for V4 Tests
 *
 * This file runs ONCE before all V4 tests to:
 * 1. Start a single Hardhat instance on port 8547
 * 2. Deploy FUM contracts
 * 3. Take a base snapshot
 * 4. Save state for V4 tests to connect
 *
 * Uses port 8547 to avoid conflicts with V3 tests (port 8545).
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { initFumLibrary } from 'fum_library';
import { startHardhat } from 'fum_library/test/setup/hardhat-config';
import { deployFUMContracts } from 'fum_library/test/setup/test-contracts';
import { saveV4SharedState, clearV4SharedState } from './v4-shared-state.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// V4 tests use port 8547 to avoid conflicts with V3 tests
const V4_PORT = 8547;

export default async function v4GlobalSetup() {
  console.log('\n========================================');
  console.log('  V4 GLOBAL TEST SETUP - Port 8547');
  console.log('========================================\n');

  // Load environment variables (needed for Alchemy API key)
  dotenv.config({ path: path.join(__dirname, '../.env.local') });

  // Initialize fum_library with TheGraph API key for V4 pool discovery
  initFumLibrary({
    alchemyApiKey: process.env.ALCHEMY_API_KEY,
    coingeckoApiKey: process.env.COINGECKO_API_KEY,
    theGraphApiKey: process.env.THEGRAPH_API_KEY,
    arbiscanApiKey: process.env.ARBISCAN_API_KEY,
  });

  // Clear any stale state from previous runs
  clearV4SharedState();

  // Start Hardhat instance on port 8547 for V4 tests
  console.log(`Starting V4 Hardhat instance on port ${V4_PORT}...`);
  const hardhat = await startHardhat({ port: V4_PORT, quiet: true });
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

  // Save state for V4 tests to use
  saveV4SharedState({
    pid: hardhat.process.pid,
    port: V4_PORT,
    baseSnapshotId,
    deployedContracts: deployment.addresses
  });

  console.log('\n========================================');
  console.log('  V4 Hardhat ready for tests (port 8547)');
  console.log('========================================\n');

  // Return teardown function (vitest calls this after all tests)
  return async () => {
    console.log('\n========================================');
    console.log('  V4 GLOBAL TEST TEARDOWN');
    console.log('========================================\n');

    try {
      await hardhat.stop();
      console.log('V4 Hardhat stopped');
    } catch (error) {
      console.error('Error stopping V4 Hardhat:', error.message);
    }

    clearV4SharedState();
    console.log('V4 state cleaned up\n');
  };
}
