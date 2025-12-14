/**
 * @fileoverview Shared Hardhat blockchain setup for automation service tests
 * Provides standardized test blockchain environment with deployed contracts
 */

import { ethers } from 'ethers';
import { startHardhat, TEST_ACCOUNTS } from 'fum_library/test/setup/hardhat-config';
import { deployFUMContracts } from 'fum_library/test/setup/test-contracts';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Set up a complete test blockchain environment with deployed contracts
 * @param {Object} options - Configuration options
 * @param {number} options.port - Port for Hardhat server (default: 8545)
 * @returns {Promise<Object>} Test environment with server, contracts, signers, and config
 */
export async function setupTestBlockchain(options = {}) {
  const { port = 8545 } = options;

  // Clean tracking data directory before starting test
  const trackingDataDir = path.join(__dirname, '../../data/vaults');
  try {
    await fs.rm(trackingDataDir, { recursive: true, force: true });
    await fs.mkdir(trackingDataDir, { recursive: true });
  } catch (error) {
    // Directory might not exist, that's OK
  }

  // Start Hardhat with fork on specified port
  const hardhatServer = await startHardhat({ port });
  const { signers } = hardhatServer;
  const deployer = signers[0];

  // Deploy FUM contracts and update library with addresses
  const deployment = await deployFUMContracts(deployer, {
    updateContractsFile: true
  });
  const deployedContracts = deployment.addresses;
  const contracts = deployment.contracts;

  // Derive SSE port from Hardhat port to ensure uniqueness when running tests in parallel
  // Port 8545 -> SSE 3090, Port 8546 -> SSE 3091, etc.
  const ssePort = 3090 + (port - 8545);

  // Use account #4 from standard Hardhat test accounts as automation service
  const automationServiceAddress = TEST_ACCOUNTS[4].address; // 0xabA472B2EA519490EE10E643A422D578a507197A

  // Standard test configuration for AutomationService
  const testConfig = {
    automationServiceAddress,
    chainId: 1337,
    wsUrl: `ws://localhost:${port}`,
    debug: true,
    envPath: path.join(__dirname, '../.env.test'),
    blacklistFilePath: path.join(__dirname, '../../data/.vault-blacklist.json'),
    trackingDataDir: path.join(__dirname, '../../data/vaults'),
    ssePort, // Derived from Hardhat port to avoid conflicts in parallel tests
    retryIntervalMs: 5000, // 5 seconds between retries
    maxFailureDurationMs: 60000 // 1 minute max failure duration
  };

  // Fund the automation service account with ETH for gas costs
  const fundingTx = await deployer.sendTransaction({
    to: automationServiceAddress,
    value: ethers.utils.parseEther("100") // Send 100 ETH for gas costs
  });
  await fundingTx.wait();
  console.log(`Funded automation service account ${automationServiceAddress} with 100 ETH`);

  return {
    hardhatServer,
    deployedContracts,
    contracts, // Add this for vault setup
    signers,
    deployer,
    testConfig
  };
}

/**
 * Clean up test blockchain environment
 * @param {Object} testEnv - Test environment from setupTestBlockchain()
 */
export async function cleanupTestBlockchain(testEnv) {
  if (testEnv?.hardhatServer?.stop) {
    await testEnv.hardhatServer.stop();
  }
}
