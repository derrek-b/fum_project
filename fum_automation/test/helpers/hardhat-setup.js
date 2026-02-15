/**
 * @fileoverview Shared Hardhat blockchain setup for automation service tests
 *
 * Connects to the shared Hardhat instance started by globalSetup.
 * Each test file reverts to the base snapshot (contracts deployed, no vaults)
 * to ensure clean isolation between test files.
 */

import { ethers } from 'ethers';
import { TEST_ACCOUNTS } from 'fum_library/test/setup/hardhat-config';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { loadSharedState } from '../shared-state.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Empty blacklist template for cleanup
 */
const EMPTY_BLACKLIST = {
  version: "1.0",
  blacklisted: {}
};

/**
 * Connect to the shared Hardhat instance and revert to base snapshot
 * @returns {Promise<Object>} Shared Hardhat connection with helpers
 */
async function connectToSharedHardhat() {
  const state = loadSharedState();

  // Create providers connecting to shared Hardhat
  const provider = new ethers.providers.JsonRpcProvider(`http://localhost:${state.port}`);
  const wsProvider = new ethers.providers.WebSocketProvider(`ws://localhost:${state.port}`);

  // Revert to base snapshot (clean state with only contracts deployed)
  // This ensures each test file starts with the same state
  await provider.send('evm_revert', [state.baseSnapshotId]);

  // Sync blockchain timestamp with real time
  // After reverting to snapshot, the blockchain time may be in the past OR equal to current time.
  // Swap transactions use Date.now() for deadlines, which would fail with "Transaction too old"
  // if the blockchain timestamp is behind real time.
  // Also, Hardhat requires the next block timestamp to be STRICTLY GREATER than the previous block.
  // So we get the current block timestamp and ensure we set a timestamp that's greater.
  const currentBlock = await provider.getBlock('latest');
  const currentBlockTime = currentBlock.timestamp;
  const currentRealTime = Math.floor(Date.now() / 1000);
  // Use whichever is larger, plus 1 second to guarantee it's strictly greater
  const nextTimestamp = Math.max(currentRealTime, currentBlockTime) + 1;
  await provider.send('evm_setNextBlockTimestamp', [nextTimestamp]);
  await provider.send('evm_mine', []);

  // Re-take snapshot so subsequent test files can also revert to base
  // (evm_revert consumes the snapshot, so we need to re-create it)
  const newBaseSnapshot = await provider.send('evm_snapshot', []);

  // Update the shared state with new base snapshot ID
  // (This is safe because tests run sequentially)
  const { saveSharedState } = await import('../shared-state.js');
  saveSharedState({
    ...state,
    baseSnapshotId: newBaseSnapshot
  });

  // Create signers from test accounts
  const signers = TEST_ACCOUNTS.map(
    account => new ethers.Wallet(account.privateKey, provider)
  );

  return {
    provider,
    wsProvider,
    signers,
    deployer: signers[0],
    deployedContracts: state.deployedContracts,
    port: state.port,
    chainId: state.chainId,

    /**
     * Take a snapshot (for test-specific isolation within a file)
     */
    async takeSnapshot() {
      return await provider.send('evm_snapshot', []);
    },

    /**
     * Revert to a snapshot
     */
    async revertToSnapshot(snapshotId) {
      await provider.send('evm_revert', [snapshotId]);
    },

    /**
     * Cleanup providers (don't stop Hardhat - it's shared)
     */
    async cleanup() {
      try {
        // Cleanup JsonRpcProvider - stop polling and clear any pending timers
        if (provider) {
          // Stop polling first
          provider.polling = false;

          // Clear any pending poll timer (internal ethers v5 property)
          // This prevents orphaned setTimeout callbacks from firing after cleanup
          if (provider._poller) {
            clearTimeout(provider._poller);
            provider._poller = null;
          }

          // Remove all event listeners
          provider.removeAllListeners();
        }

        // Cleanup WebSocketProvider
        if (wsProvider) {
          wsProvider.removeAllListeners();
          await wsProvider.destroy();
        }
      } catch (error) {
        // Ignore cleanup errors
      }
    },

    /**
     * Dummy stop function for compatibility with existing test patterns
     * Does NOT actually stop Hardhat since it's shared
     */
    async stop() {
      await this.cleanup();
    }
  };
}

/**
 * Set up a complete test blockchain environment with deployed contracts
 * Connects to the shared Hardhat instance and prepares test config.
 *
 * @param {Object} options - Configuration options (port is ignored - uses shared instance)
 * @returns {Promise<Object>} Test environment with server, contracts, signers, and config
 */
export async function setupTestBlockchain(options = {}) {
  // Connect to shared Hardhat instance (ignores port option)
  const shared = await connectToSharedHardhat();

  // Clean tracking data directory before starting test
  const trackingDataDir = path.join(__dirname, '../../data/vaults');
  try {
    await fs.rm(trackingDataDir, { recursive: true, force: true });
    await fs.mkdir(trackingDataDir, { recursive: true });
  } catch (error) {
    // Directory might not exist, that's OK
  }

  // Load contract ABIs directly from fum_library artifacts (bypasses test mocks)
  const contractsModule = await import('fum_library/artifacts/contracts');
  const contractArtifacts = contractsModule.default;
  const VaultFactoryAbi = contractArtifacts.VaultFactory.abi;
  const BabyStepsStrategyAbi = contractArtifacts.bob.abi; // 'bob' is the artifact key for BabyStepsStrategy

  const vaultFactory = new ethers.Contract(
    shared.deployedContracts.VaultFactory,
    VaultFactoryAbi,
    shared.deployer
  );

  const babyStepsStrategy = new ethers.Contract(
    shared.deployedContracts.BabyStepsStrategy,
    BabyStepsStrategyAbi,
    shared.deployer
  );

  const contracts = {
    vaultFactory,
    babyStepsStrategy
  };

  // Use account #4 from standard Hardhat test accounts as automation service
  const automationServiceAddress = TEST_ACCOUNTS[4].address; // 0xabA472B2EA519490EE10E643A422D578a507197A

  // Get chainId from shared state (1337 for Arbitrum, 1338 for Avalanche)
  const chainId = shared.chainId || 1337;

  // Standard test configuration for AutomationService
  const testConfig = {
    automationServiceAddress,
    chainId,
    wsUrl: `ws://localhost:${shared.port}`,
    debug: true,
    envPath: path.join(__dirname, '../.env.test'),
    blacklistFilePath: path.join(__dirname, '../../data/.vault-blacklist.json'),
    trackingDataDir: path.join(__dirname, '../../data/vaults'),
    ssePort: 3090, // Fixed port since shared instance
    retryIntervalMs: 5000, // 5 seconds between retries
    maxFailureDurationMs: 60000 // 1 minute max failure duration
  };

  // Fund the automation service account with ETH for gas costs
  const fundingTx = await shared.deployer.sendTransaction({
    to: automationServiceAddress,
    value: ethers.utils.parseEther("100") // Send 100 ETH for gas costs
  });
  await fundingTx.wait();
  console.log(`Funded automation service account ${automationServiceAddress} with 100 ETH`);

  return {
    hardhatServer: shared, // For compatibility - has stop(), takeSnapshot(), etc.
    deployedContracts: shared.deployedContracts,
    contracts,
    signers: shared.signers,
    deployer: shared.deployer,
    testConfig
  };
}

/**
 * Clear blacklist files to ensure clean state for next test
 * Resets both data/ and test/data/ blacklist files
 */
export async function clearBlacklist() {
  const blacklistPaths = [
    path.join(__dirname, '../../data/.vault-blacklist.json'),
    path.join(__dirname, '../data/.vault-blacklist.json')
  ];

  for (const blacklistPath of blacklistPaths) {
    try {
      await fs.writeFile(blacklistPath, JSON.stringify(EMPTY_BLACKLIST, null, 2));
    } catch (err) {
      // File might not exist or directory missing, that's OK
    }
  }
}

/**
 * Clean up test blockchain environment
 * Cleans up WebSocket and resets blacklist files
 * Does NOT stop Hardhat (it's shared)
 *
 * @param {Object} testEnv - Test environment from setupTestBlockchain()
 */
export async function cleanupTestBlockchain(testEnv) {
  if (testEnv?.hardhatServer?.cleanup) {
    await testEnv.hardhatServer.cleanup();
  }

  // Clear blacklist files for next test run
  await clearBlacklist();
}
