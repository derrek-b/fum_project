/**
 * @fileoverview Integration tests for vault setup error scenarios
 * Tests failure modes during setupVault step 3 (strategy initialization, approvals, etc.)
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import AutomationService from '../../../src/core/AutomationService.js';
import { setupTestBlockchain, cleanupTestBlockchain } from '../../helpers/hardhat-setup.js';
import { setupTestVault } from '../../helpers/test-vault-setup.js';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Vault Setup Errors - Step 3 (Strategy Initialization)', () => {
  let testEnv;
  let testConfig;
  let tempDir;
  let service;

  beforeAll(async () => {
    testEnv = await setupTestBlockchain();
    testConfig = testEnv.testConfig;
  }, 120000);

  afterAll(async () => {
    await cleanupTestBlockchain(testEnv);
  });

  afterEach(async () => {
    // Clean up service
    if (service) {
      try {
        if (service.isRunning) {
          await service.stop();
        } else if (service.provider) {
          await service.stop(true);
        }
      } catch (e) {
        // Ignore cleanup errors
      }
      service = null;
    }

    // Clean up temp directory
    if (tempDir) {
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch (e) {
        // Ignore cleanup errors
      }
      tempDir = null;
    }
  });

  const createTempDir = async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vault-setup-errors-'));
    return tempDir;
  };

  describe('Strategy Initialization Errors', () => {
    it('should fail when strategy is not registered', async () => {
      const dir = await createTempDir();
      const blacklistPath = path.join(dir, 'blacklist.json');

      // Create a vault with an unknown strategy ID
      const testVault = await setupTestVault(
        testEnv.hardhatServer,
        testEnv.contracts,
        testEnv.deployedContracts,
        {
          vaultName: 'Unknown Strategy Test',
          automationServiceAddress: testConfig.automationServiceAddress,
          wrapEthAmount: '1',
          swapTokens: [],
          positions: [],
          tokenTransfers: {},
          targetTokens: ['WETH'],
          targetPlatforms: ['uniswapV3'],
          strategy: 'bob' // Valid strategy ID
        }
      );

      service = new AutomationService({
        automationServiceAddress: testConfig.automationServiceAddress,
        chainId: 1337,
        wsUrl: testConfig.wsUrl,
        blacklistFilePath: blacklistPath,
        trackingDataDir: path.join(dir, 'vaults'),
        ssePort: 3100,
        debug: true
      });

      // Remove the bob strategy to simulate unknown strategy
      // Note: This requires the service to be initialized first
      await service.start();

      // Manually remove strategy to simulate the error
      service.strategies.delete('bob');

      // Now try to setup another vault - it should fail
      const vaultSetupFailedEvents = [];
      service.eventManager.subscribe('VaultSetupFailed', (data) => {
        vaultSetupFailedEvents.push(data);
      });

      // Manually trigger setupVault (simulating a new vault discovery)
      try {
        await service.setupVault(testVault.vaultAddress);
      } catch (error) {
        expect(error.message).toMatch(/Strategy.*not found/);
      }

      // Verify failure was tracked
      expect(vaultSetupFailedEvents.length).toBe(1);
      expect(vaultSetupFailedEvents[0].step).toBe('strategy_initialization');
    });
  });

  describe('Approval Errors', () => {
    let testVault;

    beforeAll(async () => {
      // Create a test vault for approval error tests
      testVault = await setupTestVault(
        testEnv.hardhatServer,
        testEnv.contracts,
        testEnv.deployedContracts,
        {
          vaultName: 'Approval Error Test Vault',
          automationServiceAddress: testConfig.automationServiceAddress,
          wrapEthAmount: '1',
          swapTokens: [],
          positions: [],
          tokenTransfers: {},
          targetTokens: ['WETH', 'USDC'],
          targetPlatforms: ['uniswapV3'],
          strategy: 'bob'
        }
      );
    });

    it.skip('should fail when AUTOMATION_PRIVATE_KEY is missing', async () => {
      // TODO: Enable when step 3 approval logic is implemented
      // This test requires ensureApprovals to be called from initializeVault

      const dir = await createTempDir();
      const blacklistPath = path.join(dir, 'blacklist.json');

      // Store original key
      const originalKey = process.env.AUTOMATION_PRIVATE_KEY;

      try {
        // Remove the private key
        delete process.env.AUTOMATION_PRIVATE_KEY;

        service = new AutomationService({
          automationServiceAddress: testConfig.automationServiceAddress,
          chainId: 1337,
          wsUrl: testConfig.wsUrl,
          blacklistFilePath: blacklistPath,
          trackingDataDir: path.join(dir, 'vaults'),
          ssePort: 3101,
          debug: true
        });

        const vaultSetupFailedEvents = [];
        service.eventManager.subscribe('VaultSetupFailed', (data) => {
          vaultSetupFailedEvents.push(data);
        });

        await service.start();

        // Should have failed during step 3
        expect(vaultSetupFailedEvents.length).toBeGreaterThan(0);
        expect(vaultSetupFailedEvents[0].step).toBe('strategy_initialization');
      } finally {
        // Restore original key
        if (originalKey) {
          process.env.AUTOMATION_PRIVATE_KEY = originalKey;
        }
      }
    });

    it.skip('should fail when vault rejects approval (unauthorized caller)', async () => {
      // TODO: Enable when step 3 approval logic is implemented
      // This test requires:
      // 1. ensureApprovals to be called from initializeVault
      // 2. A way to simulate vault rejecting the approval (wrong signer)

      const dir = await createTempDir();
      const blacklistPath = path.join(dir, 'blacklist.json');

      service = new AutomationService({
        automationServiceAddress: testConfig.automationServiceAddress,
        chainId: 1337,
        wsUrl: testConfig.wsUrl,
        blacklistFilePath: blacklistPath,
        trackingDataDir: path.join(dir, 'vaults'),
        ssePort: 3102,
        debug: true
      });

      // Would need to:
      // 1. Create vault with a different automation service address
      // 2. Try to setup vault - approval should fail because caller isn't authorized

      const vaultSetupFailedEvents = [];
      service.eventManager.subscribe('VaultSetupFailed', (data) => {
        vaultSetupFailedEvents.push(data);
      });

      await service.start();

      // Expect failure during approval
      // expect(vaultSetupFailedEvents[0].step).toBe('strategy_initialization');
      // expect(vaultSetupFailedEvents[0].error).toMatch(/not authorized|revert/i);
    });

    it.skip('should fail when token address is invalid', async () => {
      // TODO: Enable when step 3 approval logic is implemented
      // This test requires ensureApprovals to be called with an invalid token address

      const dir = await createTempDir();
      const blacklistPath = path.join(dir, 'blacklist.json');

      service = new AutomationService({
        automationServiceAddress: testConfig.automationServiceAddress,
        chainId: 1337,
        wsUrl: testConfig.wsUrl,
        blacklistFilePath: blacklistPath,
        trackingDataDir: path.join(dir, 'vaults'),
        ssePort: 3103,
        debug: true
      });

      const vaultSetupFailedEvents = [];
      service.eventManager.subscribe('VaultSetupFailed', (data) => {
        vaultSetupFailedEvents.push(data);
      });

      // Would need to configure vault with invalid token address in targetTokens

      await service.start();

      // Expect failure during approval check
      // expect(vaultSetupFailedEvents[0].error).toMatch(/revert|invalid/i);
    });
  });

  describe('ETH Wrapping Errors', () => {
    it.skip('should fail when vault has no ETH to wrap', async () => {
      // TODO: Enable when step 3.2 ETH wrapping is implemented
      // This test requires wrapETH helper and its integration in initializeVault

      const dir = await createTempDir();
      const blacklistPath = path.join(dir, 'blacklist.json');

      // Create vault with no ETH
      const emptyVault = await setupTestVault(
        testEnv.hardhatServer,
        testEnv.contracts,
        testEnv.deployedContracts,
        {
          vaultName: 'Empty ETH Vault',
          automationServiceAddress: testConfig.automationServiceAddress,
          wrapEthAmount: '0', // No ETH
          swapTokens: [],
          positions: [],
          tokenTransfers: {},
          targetTokens: ['WETH'],
          targetPlatforms: ['uniswapV3'],
          strategy: 'bob'
        }
      );

      service = new AutomationService({
        automationServiceAddress: testConfig.automationServiceAddress,
        chainId: 1337,
        wsUrl: testConfig.wsUrl,
        blacklistFilePath: blacklistPath,
        trackingDataDir: path.join(dir, 'vaults'),
        ssePort: 3104,
        debug: true
      });

      await service.start();

      // If wrapping is required but no ETH available, should handle gracefully
      // (might not be an error - depends on implementation)
    });
  });
});
