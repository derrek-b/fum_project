/**
 * @fileoverview Shared Ganache blockchain setup for automation service tests
 * Provides standardized test blockchain environment with deployed contracts
 */

import { ethers } from 'ethers';
import { startGanache } from 'fum_library/test/setup/ganache-config';
import { deployFUMContracts } from 'fum_library/test/setup/test-contracts';
import path from 'path';
import fs from 'fs/promises';

/**
 * Set up a complete test blockchain environment with deployed contracts
 * @param {Object} options - Configuration options
 * @param {number} options.port - Port for Ganache server (default: 8545)
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

  // Start Ganache with fork on specified port
  const ganacheServer = await startGanache({ port });
  const { signers } = ganacheServer;
  const deployer = signers[0];

  // Deploy FUM contracts and update library with addresses
  const deployment = await deployFUMContracts(deployer, {
    updateContractsFile: true
  });
  const deployedContracts = deployment.addresses;
  const contracts = deployment.contracts;

  // Derive SSE port from Ganache port to ensure uniqueness when running tests in parallel
  // Port 8545 -> SSE 3090, Port 8546 -> SSE 3091, etc.
  const ssePort = 3090 + (port - 8545);

  // Standard test configuration for AutomationService
  const testConfig = {
    automationServiceAddress: "0xabA472B2EA519490EE10E643A422D578a507197A", // Custom test address (account #4)
    chainId: 1337,
    wsUrl: `ws://localhost:${port}`,
    debug: true,
    envPath: path.join(__dirname, '../.env.test'),
    blacklistFilePath: path.join(__dirname, '../../data/.vault-blacklist.json'),
    trackingDataDir: path.join(__dirname, '../../data/vaults'),
    ssePort, // Derived from Ganache port to avoid conflicts in parallel tests
    retryIntervalMs: 5000, // 5 seconds between retries
    maxFailureDurationMs: 60000 // 1 minute max failure duration
  };

  // Fund the automation service account with ETH for gas costs
  // Account #4 might not be automatically funded by Ganache, so send ETH from account #0
  const automationServiceAddress = testConfig.automationServiceAddress;
  const fundingTx = await deployer.sendTransaction({
    to: automationServiceAddress,
    value: ethers.utils.parseEther("100") // Send 100 ETH for gas costs
  });
  await fundingTx.wait();
  console.log(`Funded automation service account ${automationServiceAddress} with 100 ETH`);

  return {
    ganacheServer,
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
  if (testEnv?.ganacheServer?.stop) {
    await testEnv.ganacheServer.stop();
  }
}