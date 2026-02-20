/**
 * @fileoverview Shared Hardhat blockchain setup for V4 automation service tests
 *
 * Connects to the shared Hardhat instance started by global-setup.js.
 * Each test file reverts to the base snapshot (contracts deployed, no vaults)
 * to ensure clean isolation between test files.
 */

import { ethers } from 'ethers';
import { TEST_ACCOUNTS } from 'fum_library/test/setup/hardhat-config';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { loadSharedState, saveSharedState } from '../shared-state.js';
import { clearTestData } from './hardhat-setup.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Empty blacklist template for cleanup.
 * Must match the flat { address: info } format that AutomationService.saveBlacklist() writes.
 */
const EMPTY_BLACKLIST = {};

/**
 * Connect to the shared Hardhat instance and revert to base snapshot
 * @returns {Promise<Object>} Shared Hardhat connection with helpers
 */
async function connectToV4SharedHardhat() {
  const state = loadSharedState();

  // Create providers connecting to shared Hardhat
  const provider = new ethers.providers.JsonRpcProvider(`http://localhost:${state.port}`);
  const wsProvider = new ethers.providers.WebSocketProvider(`ws://localhost:${state.port}`);

  // Revert to base snapshot (clean state with only contracts deployed)
  await provider.send('evm_revert', [state.baseSnapshotId]);

  // Sync blockchain timestamp with real time
  const currentBlock = await provider.getBlock('latest');
  const currentBlockTime = currentBlock.timestamp;
  const currentRealTime = Math.floor(Date.now() / 1000);
  const nextTimestamp = Math.max(currentRealTime, currentBlockTime) + 1;
  await provider.send('evm_setNextBlockTimestamp', [nextTimestamp]);
  await provider.send('evm_mine', []);

  // Re-take snapshot so subsequent test files can also revert to base
  const newBaseSnapshot = await provider.send('evm_snapshot', []);

  // Update the shared state with new base snapshot ID
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
        if (provider) {
          provider.polling = false;
          if (provider._poller) {
            clearTimeout(provider._poller);
            provider._poller = null;
          }
          provider.removeAllListeners();
        }

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
     */
    async stop() {
      await this.cleanup();
    }
  };
}

/**
 * Set up a complete V4 test blockchain environment with deployed contracts
 * Connects to the shared V4 Hardhat instance and prepares test config.
 *
 * @param {Object} options - Configuration options (port is ignored - uses V4 shared instance)
 * @returns {Promise<Object>} Test environment with server, contracts, signers, and config
 */
export async function setupV4TestBlockchain(options = {}) {
  // Clean stale data from prior runs (crash recovery)
  await clearTestData();
  await clearBlacklist();

  // Connect to shared V4 Hardhat instance (ignores port option)
  const shared = await connectToV4SharedHardhat();

  // Load contract ABIs directly from fum_library artifacts
  const contractsModule = await import('fum_library/artifacts/contracts');
  const contractArtifacts = contractsModule.default;
  const VaultFactoryAbi = contractArtifacts.VaultFactory.abi;
  const BabyStepsStrategyAbi = contractArtifacts.bob.abi;

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
  const automationServiceAddress = TEST_ACCOUNTS[4].address;

  // V4 test configuration for AutomationService
  const testConfig = {
    automationServiceAddress,
    chainId: 1337,
    wsUrl: `ws://localhost:${shared.port}`,
    debug: true,
    envPath: path.join(__dirname, '../.env.test'),
    blacklistFilePath: path.join(__dirname, '../../data/.vault-blacklist.json'),
    trackingDataDir: path.join(__dirname, '../../data/vaults'),
    ssePort: 3091,  // Different from V3 (3090) to avoid conflicts
    retryIntervalMs: 5000,
    maxFailureDurationMs: 60000
  };

  // Fund the automation service account with ETH for gas costs
  const fundingTx = await shared.deployer.sendTransaction({
    to: automationServiceAddress,
    value: ethers.utils.parseEther("100")
  });
  await fundingTx.wait();
  console.log(`Funded automation service account ${automationServiceAddress} with 100 ETH`);

  return {
    hardhatServer: shared,
    deployedContracts: shared.deployedContracts,
    contracts,
    signers: shared.signers,
    deployer: shared.deployer,
    testConfig
  };
}

/**
 * Clear blacklist files to ensure clean state for next test
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
 * Clean up V4 test blockchain environment
 */
export async function cleanupV4TestBlockchain(testEnv) {
  if (testEnv?.hardhatServer?.cleanup) {
    await testEnv.hardhatServer.cleanup();
  }

  await clearBlacklist();
  await clearTestData();
}
