/**
 * Trader Joe V2.1 Test Environment Setup
 *
 * Setup for TraderJoeV2_1Adapter tests:
 * - Starts Hardhat node with Arbitrum fork
 * - Optionally deploys FUM contracts (VaultFactory, validators)
 * - Creates adapter instance with forked provider
 *
 * When to deploy contracts:
 * - Read-only tests (selectBestPool, getPoolData): deployContracts: false
 * - Gas estimation tests: deployContracts: true
 * - Transaction execution tests: deployContracts: true
 */

import { setupCoreEnvironment } from '../test-env.js';
import TraderJoeV2_1Adapter from '../../src/adapters/TraderJoeV2_1Adapter.js';

/**
 * Setup Trader Joe V2.1 test environment
 * Uses Hardhat fork of Arbitrum for on-chain queries
 *
 * @param {Object} options - Configuration options
 * @param {number} options.port - Hardhat node port (default: 8548)
 * @param {boolean} options.deployContracts - Deploy FUM contracts (default: false)
 * @param {boolean} options.quiet - Suppress verbose output (default: true)
 * @returns {Object} Test environment with provider and adapter
 */
export async function setupTraderJoeTestEnvironment(options = {}) {
  const {
    port = 8548, // Different port to avoid conflicts with V3/V4 tests
    deployContracts = false, // Not needed for read-only tests
    quiet = true,
  } = options;

  console.log('🦎 Setting up Trader Joe V2.1 test environment...');

  // Setup core environment with Hardhat fork
  const coreEnv = await setupCoreEnvironment({
    port,
    deployContracts,
    updateContractsFile: deployContracts,
    quiet,
  });

  const { provider, signers, contracts } = coreEnv;

  // Create adapter instance (uses chainId 1337 for local fork)
  const adapter = new TraderJoeV2_1Adapter(1337, provider);

  // If contracts were deployed, inject TJPositionManager address into adapter
  // (chains.js on disk is updated by deployFUMContracts, but the in-memory
  //  config was already loaded at import time, so we set it directly)
  if (deployContracts && contracts?.tjPositionManager) {
    adapter.addresses.positionManagerAddress = contracts.tjPositionManager.address;
    console.log(`  ✅ TJPositionManager address injected: ${contracts.tjPositionManager.address}`);
  }

  console.log('  ✅ Trader Joe V2.1 test environment ready!');

  return {
    provider,
    signers,
    adapter,
    contracts, // VaultFactory etc. if deployContracts: true
    chainId: 1337, // Local fork chainId
    // Core environment utilities
    snapshot: coreEnv.snapshot,
    revert: coreEnv.revert,
    teardown: coreEnv.teardown,
  };
}
