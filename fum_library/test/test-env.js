/**
 * Test Environment - Core Infrastructure
 *
 * Provides the core test environment setup:
 * - Start Hardhat node with Arbitrum fork
 * - Deploy FUM contracts (VaultFactory, validators)
 * - Fund test accounts with ETH
 * - Snapshot/revert utilities
 * - Time manipulation
 *
 * Platform-specific setup (V3, V4, etc.) is in separate files:
 * - test/setup/v3-setup.js
 * - test/setup/v4-setup.js
 */

import { ethers } from 'ethers';
import { startHardhat, TEST_ACCOUNTS } from './setup/hardhat-config.js';
import { deployFUMContracts, deployTestVault } from './setup/test-contracts.js';

/**
 * Core test environment setup
 * Sets up Hardhat node, deploys FUM contracts, and funds test accounts.
 * Does NOT include platform-specific setup (use v3-setup.js or v4-setup.js for that).
 *
 * @param {Object} options - Configuration options
 * @param {number} options.port - Hardhat node port (default: 8545)
 * @param {boolean} options.deployContracts - Whether to deploy FUM contracts (default: true)
 * @param {boolean} options.updateContractsFile - Whether to update contracts.js (default: true)
 * @param {boolean} options.quiet - Suppress verbose output (default: true)
 * @returns {Object} Core test environment
 */
export async function setupCoreEnvironment(options = {}) {
  const {
    port = 8545,
    deployContracts = true,
    updateContractsFile = true,
    quiet = true,
  } = options;

  console.log('🚀 Starting test environment...');

  // Start Hardhat node
  console.log('🔧 Starting Hardhat node with Arbitrum fork...');
  const hardhat = await startHardhat({ port, quiet });

  let contracts = {};
  let contractAddresses = {};

  // Deploy FUM contracts if requested
  if (deployContracts) {
    console.log('📄 Deploying FUM contracts...');
    const deployment = await deployFUMContracts(
      hardhat.signers[0],
      { updateContractsFile }
    );
    contracts = deployment.contracts;
    contractAddresses = deployment.addresses;
  }

  // Fund additional test accounts
  console.log('💰 Funding test accounts...');
  for (let i = 1; i < Math.min(5, hardhat.signers.length); i++) {
    const tx = await hardhat.signers[0].sendTransaction({
      to: hardhat.signers[i].address,
      value: ethers.utils.parseEther('10')
    });
    await tx.wait();
    console.log(`  - Funded account ${i} (${hardhat.signers[i].address}) with 10 ETH`);
  }
  console.log('  ✅ Test accounts funded!');

  // Create core environment object
  const env = {
    // Hardhat utilities
    provider: hardhat.provider,
    wsProvider: hardhat.wsProvider,
    signers: hardhat.signers,
    accounts: TEST_ACCOUNTS,

    // Contract instances
    contracts,
    contractAddresses,

    // Helper functions
    async createVault(params = {}) {
      if (!contracts.vaultFactory) {
        throw new Error('VaultFactory not deployed');
      }

      const vaultConfig = {
        name: 'Test Vault',
        symbol: 'TEST-V',
        depositor: hardhat.signers[0].address,
        executor: hardhat.signers[1].address,
        strategist: hardhat.signers[2].address,
        feeRecipient: hardhat.signers[3].address,
        performanceFee: 1000,
        managementFee: 200,
        ...params,
      };

      return deployTestVault(contracts.vaultFactory, vaultConfig);
    },

    async fundAccount(address, amountETH = '10') {
      const funder = hardhat.signers[0];
      const tx = await funder.sendTransaction({
        to: address,
        value: ethers.utils.parseEther(amountETH),
      });
      await tx.wait();
      return tx;
    },

    async getTokenBalance(tokenAddress, accountAddress) {
      const ERC20_ABI = [
        'function balanceOf(address account) view returns (uint256)',
      ];
      const token = new ethers.Contract(tokenAddress, ERC20_ABI, hardhat.provider);
      return await token.balanceOf(accountAddress);
    },

    // Snapshot management
    async snapshot() {
      return await hardhat.provider.send('evm_snapshot', []);
    },

    async revert(snapshotId) {
      await hardhat.provider.send('evm_revert', [snapshotId]);
    },

    // Time manipulation
    async increaseTime(seconds) {
      await hardhat.provider.send('evm_increaseTime', [seconds]);
      await hardhat.provider.send('evm_mine', []);
    },

    async mineBlocks(count = 1) {
      for (let i = 0; i < count; i++) {
        await hardhat.provider.send('evm_mine', []);
      }
    },

    // Cleanup function
    async teardown() {
      console.log('🧹 Cleaning up test environment...');
      await hardhat.stop();
    },
  };

  console.log('✅ Core test environment ready!');

  if (!quiet) {
    console.log('\n📊 Test Environment Summary:');
    console.log(`- RPC URL: http://localhost:${port}`);
    console.log(`- WebSocket URL: ws://localhost:${port}`);
    console.log(`- Test accounts: ${hardhat.signers.length}`);
    console.log(`- Contracts deployed: ${Object.keys(contracts).length}`);
    console.log('\n');
  }

  return env;
}

/**
 * Complete test environment setup (V3) - BACKWARDS COMPATIBLE
 *
 * This is the original setupTestEnvironment that includes V3-specific setup.
 * New code should use setupV3TestEnvironment from './setup/v3-setup.js' directly.
 *
 * @param {Object} options - Configuration options
 * @returns {Object} Test environment with V3 utilities
 */
export async function setupTestEnvironment(options = {}) {
  // Import dynamically to avoid circular dependency
  const { setupV3TestEnvironment } = await import('./setup/v3-setup.js');
  return setupV3TestEnvironment(options);
}

/**
 * Quick setup for unit tests that don't need full environment
 * @param {Object} options - Configuration options
 * @returns {Object} Minimal test environment
 */
export async function quickTestSetup(options = {}) {
  return setupCoreEnvironment({
    deployContracts: false,
    quiet: true,
    ...options,
  });
}

// Export all test utilities
export * from './setup/hardhat-config.js';
export * from './setup/test-contracts.js';
