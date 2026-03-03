/**
 * @fileoverview Integration tests for vault setup error scenarios
 * Tests failure modes during setupVault step 3 (strategy initialization)
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
        // Always force stop to clean up all resources
        await service.stop(true);
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

      // Create a vault with an unknown strategy ID
      const testVault = await setupTestVault(
        testEnv.hardhatServer,
        testEnv.contracts,
        testEnv.deployedContracts,
        {
          vaultName: 'Unknown Strategy Test',
          wrapEthAmount: '1',
          swapTokens: [],
          positions: [],
          tokenTransfers: {},
          targetTokens: ['ETH'],
          targetPlatforms: ['uniswapV3'],
          strategy: 'bob' // Valid strategy ID
        }
      );

      service = new AutomationService({
        chainId: 1337,
        wsUrl: testConfig.wsUrl,
        dataDir: dir,
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
});
