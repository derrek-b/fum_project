/**
 * Trader Joe V2.2 Test Environment Setup
 *
 * Setup for TraderJoeV2_2Adapter tests:
 * - Starts Hardhat node with Avalanche fork
 * - Optionally deploys FUM contracts (VaultFactory, validators)
 * - Creates adapter instance with forked provider
 *
 * When to deploy contracts:
 * - Read-only tests (selectBestPool, getPoolData): deployContracts: false
 * - Gas estimation tests: deployContracts: true
 * - Transaction execution tests: deployContracts: true
 */

import { setupCoreEnvironment } from '../test-env.js';
import TraderJoeV2_2Adapter from '../../src/adapters/TraderJoeV2_2Adapter.js';

/**
 * Setup Trader Joe V2.2 test environment
 * Uses Hardhat fork of Avalanche for on-chain queries
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

  console.log('🦎 Setting up Trader Joe V2.2 test environment...');

  // Set fork chain to Avalanche for Trader Joe tests
  process.env.FORK_CHAIN = 'avalanche';

  // Setup core environment with Hardhat fork
  const coreEnv = await setupCoreEnvironment({
    port,
    deployContracts,
    updateContractsFile: deployContracts,
    quiet,
  });

  const { provider, signers, contracts } = coreEnv;

  // Create adapter instance (uses chainId 1338 for local Avalanche fork)
  const adapter = new TraderJoeV2_2Adapter(1338, provider);

  // If contracts were deployed, inject TJPositionManager address into adapter
  // (chains.js on disk is updated by deployFUMContracts, but the in-memory
  //  config was already loaded at import time, so we set it directly)
  if (deployContracts && contracts?.tjPositionManager) {
    adapter.addresses.positionManagerAddress = contracts.tjPositionManager.address;
    console.log(`  ✅ TJPositionManager address injected: ${contracts.tjPositionManager.address}`);
  }

  console.log('  ✅ Trader Joe V2.2 test environment ready!');

  return {
    provider,
    signers,
    adapter,
    contracts, // VaultFactory etc. if deployContracts: true
    chainId: 1338, // Local Avalanche fork chainId
    // Core environment utilities
    snapshot: coreEnv.snapshot,
    revert: coreEnv.revert,
    teardown: coreEnv.teardown,
  };
}
