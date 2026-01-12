/**
 * @fileoverview Integration tests for config update failure handling
 *
 * Tests failure scenarios when vault/strategy config changes fail to process.
 *
 * New Architecture (lock-aware config updates):
 * - EventManager emits raw TargetTokensUpdated/TargetPlatformsUpdated/StrategyParameterUpdated events
 * - AutomationService handles these via handleConfigUpdate() → applyConfigUpdate()
 * - applyConfigUpdate() calls VDS.updateTargetTokens(), VDS.updateTargetPlatforms(), or VDS.updateStrategyParameters()
 *
 * Failure scenarios tested:
 *
 * 1. VDS Update Failures
 *    - updateTargetTokens() fails → trackFailedVault → vault added to retry queue
 *    - updateTargetPlatforms() fails → trackFailedVault → vault added to retry queue
 *    - updateStrategyParameters() fails → trackFailedVault → vault added to retry queue
 *
 * 2. Cascade Failures (trackFailedVault itself fails)
 *    - Config update fails AND trackFailedVault fails → emergencyVaultCleanup → vault blacklisted
 *    - StrategyParameterUpdateFailed handler itself fails → emergencyVaultCleanup → vault blacklisted
 *
 * Note: Uses EVM snapshots to reset vault state between tests for isolation.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import AutomationService from '../../../src/core/AutomationService.js';
import { setupTestBlockchain, cleanupTestBlockchain } from '../../helpers/hardhat-setup.js';
import { setupTestVault } from '../../helpers/test-vault-setup.js';
import { waitForCondition } from '../../helpers/wait-utils.js';
import { ethers } from 'ethers';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';

describe('Config Update Failures', () => {
  let testEnv;
  let testConfig;
  let tempDir;
  let service;
  let testVault;
  let vaultSnapshot;

  beforeAll(async () => {
    testEnv = await setupTestBlockchain();
    testConfig = testEnv.testConfig;

    // Create ONE vault for all tests
    console.log('Creating test vault...');
    testVault = await setupTestVault(
      testEnv.hardhatServer,
      testEnv.contracts,
      testEnv.deployedContracts,
      {
        vaultName: 'Config Update Test Vault',
        automationServiceAddress: testConfig.automationServiceAddress,
        wrapEthAmount: '5',
        swapTokens: [
          { from: 'WETH', to: 'USDC', amount: '1' }
        ],
        positions: [
          {
            token0: 'USDC',
            token1: 'WETH',
            fee: 500,
            percentOfAssets: 50,
            tickRange: {
              type: 'centered',
              spacing: 10
            }
          }
        ],
        targetTokens: ['USDC', 'WETH'],
        targetPlatforms: ['uniswapV3'],
        strategy: 'bob'
      }
    );
    console.log(`Test vault created at: ${testVault.vaultAddress}`);

    // Take snapshot AFTER vault creation - this is our clean state
    vaultSnapshot = await testEnv.hardhatServer.provider.send('evm_snapshot', []);
    console.log(`Vault snapshot taken: ${vaultSnapshot}`);
  }, 180000);

  afterAll(async () => {
    await cleanupTestBlockchain(testEnv);
  });

  beforeEach(async () => {
    // Revert to clean vault state before each test
    await testEnv.hardhatServer.provider.send('evm_revert', [vaultSnapshot]);
    // Re-take snapshot (evm_revert consumes it)
    vaultSnapshot = await testEnv.hardhatServer.provider.send('evm_snapshot', []);
  });

  afterEach(async () => {
    vi.restoreAllMocks();

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

    if (tempDir) {
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch (e) {
        // Ignore cleanup errors
      }
      tempDir = null;
    }
  });

  /**
   * Helper to create temp directory for test isolation
   */
  const createTempDir = async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'config-test-'));
    return tempDir;
  };

  /**
   * Helper to create a service with standard test config
   */
  const createTestService = async (ssePort) => {
    const dir = await createTempDir();
    const blacklistPath = path.join(dir, 'blacklist.json');
    const trackingDir = path.join(dir, 'vaults');

    service = new AutomationService({
      automationServiceAddress: testConfig.automationServiceAddress,
      chainId: 1337,
      wsUrl: testConfig.wsUrl,
      blacklistFilePath: blacklistPath,
      trackingDataDir: trackingDir,
      ssePort,
      debug: true,
      retryIntervalMs: 999999999  // Effectively disabled
    });

    return { service, dir, blacklistPath, trackingDir };
  };

  /**
   * Helper to set up event tracking
   */
  const setupEventTracking = (service) => {
    const events = {
      targetTokensUpdated: [],
      targetPlatformsUpdated: [],
      strategyParameterUpdated: [],
      strategyParamUpdateFailed: [],
      vaultFailed: [],
      vaultBlacklisted: []
    };

    service.eventManager.subscribe('TargetTokensUpdated', (data) => {
      console.log(`  [EVENT] TargetTokensUpdated: ${data.vaultAddress?.slice(0, 10)}...`);
      events.targetTokensUpdated.push(data);
    });

    service.eventManager.subscribe('TargetPlatformsUpdated', (data) => {
      console.log(`  [EVENT] TargetPlatformsUpdated: ${data.vaultAddress?.slice(0, 10)}...`);
      events.targetPlatformsUpdated.push(data);
    });

    service.eventManager.subscribe('StrategyParameterUpdated', (data) => {
      console.log(`  [EVENT] StrategyParameterUpdated: ${data.vaultAddress?.slice(0, 10)}... paramName=${data.paramName}`);
      events.strategyParameterUpdated.push(data);
    });

    service.eventManager.subscribe('StrategyParameterUpdateFailed', (data) => {
      console.log(`  [EVENT] StrategyParameterUpdateFailed: ${data.vaultAddress?.slice(0, 10)}...`);
      events.strategyParamUpdateFailed.push(data);
    });

    service.eventManager.subscribe('VaultFailed', (data) => {
      console.log(`  [EVENT] VaultFailed: ${data.vaultAddress?.slice(0, 10)}... - ${data.source}`);
      events.vaultFailed.push(data);
    });

    service.eventManager.subscribe('VaultBlacklisted', (data) => {
      console.log(`  [EVENT] VaultBlacklisted: ${data.vaultAddress?.slice(0, 10)}...`);
      events.vaultBlacklisted.push(data);
    });

    return events;
  };

  // ============================================================================
  // VDS Update Failures
  // ============================================================================
  describe('VDS Update Failures', () => {
    it('should track vault for retry when updateTargetTokens fails', async () => {
      await createTestService(3401);
      const events = setupEventTracking(service);

      // Start service and wait for vault to load
      await service.start();
      await waitForCondition(
        () => service.vaultDataService.hasVault(testVault.vaultAddress),
        30000,
        500
      );
      console.log('Service started and vault loaded');

      // Mock updateTargetTokens to fail (simulating VDS cache update failure)
      vi.spyOn(service.vaultDataService, 'updateTargetTokens').mockImplementation(async (addr, tokens) => {
        console.log(`  [MOCK] updateTargetTokens for ${addr?.slice(0, 10)}... - FAILING`);
        throw new Error('CACHE_ERROR: Failed to update target tokens in cache');
      });

      // Trigger real TargetTokensUpdated event by changing target tokens
      console.log('Triggering TargetTokensUpdated event...');
      const newTargetTokens = ['WETH']; // Change from ['USDC', 'WETH'] to just ['WETH']
      const setTokensTx = await testVault.vault.setTargetTokens(newTargetTokens);
      await setTokensTx.wait();
      console.log('setTargetTokens transaction confirmed');

      // Wait for TargetTokensUpdated event (shows event was received)
      await waitForCondition(
        () => events.targetTokensUpdated.length > 0,
        15000,
        500
      );

      // Wait for VaultFailed event (from trackFailedVault in applyConfigUpdate catch block)
      await waitForCondition(
        () => events.vaultFailed.length > 0,
        10000,
        500
      );
      expect(events.vaultFailed.length).toBe(1);
      expect(events.vaultFailed[0].source).toBe('config_update');

      // Verify vault is in failedVaults
      const normalizedAddress = ethers.utils.getAddress(testVault.vaultAddress);
      expect(service.failedVaults.has(normalizedAddress)).toBe(true);

      // Verify vault is NOT blacklisted (recoverable error - just goes to retry queue)
      expect(service.isVaultBlacklisted(testVault.vaultAddress)).toBe(false);

      console.log('updateTargetTokens failure test passed');
    }, 90000);

    it('should track vault for retry when updateTargetPlatforms fails', async () => {
      await createTestService(3402);
      const events = setupEventTracking(service);

      // Start service and wait for vault to load
      await service.start();
      await waitForCondition(
        () => service.vaultDataService.hasVault(testVault.vaultAddress),
        30000,
        500
      );
      console.log('Service started and vault loaded');

      // Mock updateTargetPlatforms to fail
      vi.spyOn(service.vaultDataService, 'updateTargetPlatforms').mockImplementation(async (addr, platforms) => {
        console.log(`  [MOCK] updateTargetPlatforms for ${addr?.slice(0, 10)}... - FAILING`);
        throw new Error('CACHE_ERROR: Failed to update target platforms in cache');
      });

      // Trigger real TargetPlatformsUpdated event
      console.log('Triggering TargetPlatformsUpdated event...');
      const setTx = await testVault.vault.setTargetPlatforms([]);
      await setTx.wait();
      console.log('setTargetPlatforms transaction confirmed');

      // Wait for TargetPlatformsUpdated event
      await waitForCondition(
        () => events.targetPlatformsUpdated.length > 0,
        15000,
        500
      );

      // Wait for VaultFailed event
      await waitForCondition(
        () => events.vaultFailed.length > 0,
        10000,
        500
      );
      expect(events.vaultFailed[0].source).toBe('config_update');

      // Verify vault is in failedVaults
      const normalizedAddress = ethers.utils.getAddress(testVault.vaultAddress);
      expect(service.failedVaults.has(normalizedAddress)).toBe(true);

      console.log('updateTargetPlatforms failure test passed');
    }, 90000);
  });

  // ============================================================================
  // Strategy Parameter Failures
  // ============================================================================
  describe('Strategy Parameter Failures', () => {
    it('should track vault for retry when updateStrategyParameters fails', async () => {
      await createTestService(3403);
      const events = setupEventTracking(service);

      // Start service and wait for vault to be FULLY set up
      await service.start();

      const normalizedAddress = ethers.utils.getAddress(testVault.vaultAddress);
      await waitForCondition(
        () => service.vaultDataService.hasVault(testVault.vaultAddress) &&
              !service.failedVaults.has(normalizedAddress),
        45000,
        500
      );
      console.log('Service started and vault fully loaded');

      // Mock updateStrategyParameters to fail (simulating VDS cache update failure)
      vi.spyOn(service.vaultDataService, 'updateStrategyParameters').mockImplementation(async (addr) => {
        console.log(`  [MOCK] updateStrategyParameters for ${addr?.slice(0, 10)}... - FAILING`);
        throw new Error('CACHE_ERROR: Failed to update strategy parameters in cache');
      });

      // Trigger real ParameterUpdated event by changing strategy parameters on vault
      // Strategy methods must be called via vault.execute() due to onlyAuthorizedVault modifier
      console.log('Triggering ParameterUpdated event via setRangeParameters...');

      // Authorize vault on strategy contract (required for setRangeParameters)
      const babyStepsStrategyAddress = testEnv.deployedContracts.BabyStepsStrategy;
      const strategyContract = new ethers.Contract(
        babyStepsStrategyAddress,
        ['function authorizeVault(address vault) external'],
        testEnv.hardhatServer.signers[0]
      );
      const authTx = await strategyContract.authorizeVault(testVault.vaultAddress);
      await authTx.wait();
      console.log('Vault authorized on strategy contract');

      // Encode the strategy call and execute through vault
      const strategyInterface = new ethers.utils.Interface([
        'function setRangeParameters(uint16 upperRange, uint16 lowerRange) external'
      ]);
      const setRangeData = strategyInterface.encodeFunctionData('setRangeParameters', [50, 50]);
      const setParamsTx = await testVault.vault.execute(
        [babyStepsStrategyAddress],
        [setRangeData]
      );
      await setParamsTx.wait();
      console.log('setRangeParameters transaction confirmed');

      // Wait for VaultFailed event (from applyConfigUpdate catch block)
      await waitForCondition(
        () => events.vaultFailed.length > 0,
        15000,
        500
      );
      expect(events.vaultFailed[0].source).toBe('config_update');

      // Verify vault is in failedVaults
      expect(service.failedVaults.has(normalizedAddress)).toBe(true);

      // Verify vault is NOT blacklisted (recoverable error - just goes to retry queue)
      expect(service.isVaultBlacklisted(testVault.vaultAddress)).toBe(false);

      console.log('updateStrategyParameters failure test passed');
    }, 90000);
  });

  // ============================================================================
  // Cascade Failures (trackFailedVault also fails)
  // ============================================================================
  describe('Cascade Failures', () => {
    it('should emergency blacklist when config update fails AND trackFailedVault fails', async () => {
      await createTestService(3404);

      // Start service and wait for vault to be FULLY set up
      await service.start();

      const normalizedAddress = ethers.utils.getAddress(testVault.vaultAddress);
      await waitForCondition(
        () => service.vaultDataService.hasVault(testVault.vaultAddress) &&
              !service.failedVaults.has(normalizedAddress),
        45000,
        500
      );
      console.log('Service started and vault fully loaded');

      // Set up event tracking AFTER initial setup complete
      const events = setupEventTracking(service);

      // DON'T lock the vault - we want the config update to be applied (not queued)
      // so we can test the cascade failure scenario
      expect(service.vaultLocks[normalizedAddress]).toBeUndefined();
      console.log('Vault is NOT locked (config update will be applied immediately)');

      // Mock updateTargetTokens to fail (first failure)
      vi.spyOn(service.vaultDataService, 'updateTargetTokens').mockImplementation(async () => {
        // Lock the vault INSIDE the mock to test lock release during emergency cleanup
        // This simulates a scenario where a lock was acquired by another operation
        console.log('  [MOCK] updateTargetTokens - acquiring lock before failing...');
        service.lockVault(normalizedAddress);
        console.log('  [MOCK] updateTargetTokens - FAILING');
        throw new Error('CACHE_ERROR: Failed to update target tokens');
      });

      // Mock trackFailedVault to also fail (cascade failure)
      vi.spyOn(service, 'trackFailedVault').mockImplementation(async () => {
        console.log('  [MOCK] trackFailedVault - THROWING (cascade failure)');
        throw new Error('Database write failed');
      });

      // Spy on emergencyVaultCleanup
      const emergencyCleanupSpy = vi.spyOn(service, 'emergencyVaultCleanup');

      // Trigger real TargetTokensUpdated event
      console.log('Triggering TargetTokensUpdated event...');
      const setTokensTx = await testVault.vault.setTargetTokens(['WETH']);
      await setTokensTx.wait();
      console.log('setTargetTokens transaction confirmed');

      // Wait for emergencyVaultCleanup to be called
      await waitForCondition(
        () => emergencyCleanupSpy.mock.calls.length > 0,
        15000,
        500
      );

      // Verify emergencyVaultCleanup was called
      expect(emergencyCleanupSpy).toHaveBeenCalledWith(
        normalizedAddress,
        expect.stringContaining('[config_update] trackFailedVault failed')
      );

      // Wait for VaultBlacklisted event
      await waitForCondition(
        () => events.vaultBlacklisted.length > 0,
        5000,
        500
      );

      // Verify vault is blacklisted
      expect(events.vaultBlacklisted.length).toBe(1);
      expect(events.vaultBlacklisted[0].emergency).toBe(true);
      expect(events.vaultBlacklisted[0].cleanupResults.lockReleased).toBe(true);
      expect(service.isVaultBlacklisted(testVault.vaultAddress)).toBe(true);

      // Verify lock was released by emergency cleanup
      expect(service.vaultLocks[normalizedAddress]).toBeUndefined();
      console.log('Lock was released during emergency cleanup');

      console.log('Config update cascade failure test passed');
    }, 90000);

    it('should emergency blacklist when StrategyParameterUpdateFailed handler itself fails', async () => {
      // Use a synthetic vault address for this test (doesn't need real vault)
      const syntheticVaultAddress = '0x1234567890123456789012345678901234567890';

      await createTestService(3405);
      const events = setupEventTracking(service);

      // Start service (don't need to wait for specific vault since we're using synthetic address)
      await service.start();
      console.log('Service started');

      // Mock trackFailedVault to throw
      vi.spyOn(service, 'trackFailedVault').mockImplementation(async () => {
        console.log('  [MOCK] trackFailedVault - THROWING');
        throw new Error('Filesystem error');
      });

      // Spy on emergencyVaultCleanup
      const emergencyCleanupSpy = vi.spyOn(service, 'emergencyVaultCleanup');

      // Emit StrategyParameterUpdateFailed directly
      console.log('Emitting StrategyParameterUpdateFailed event...');
      service.eventManager.emit('StrategyParameterUpdateFailed', {
        vaultAddress: syntheticVaultAddress,
        paramName: 'targetRangeUpper',
        error: 'Simulated cache refresh failure'
      });

      // Wait for emergencyVaultCleanup to be called
      await waitForCondition(
        () => emergencyCleanupSpy.mock.calls.length > 0,
        10000,
        500
      );

      // Verify emergencyVaultCleanup was called with correct reason
      expect(emergencyCleanupSpy).toHaveBeenCalledWith(
        syntheticVaultAddress,
        expect.stringContaining('StrategyParameterUpdateFailed handler error')
      );

      // Wait for VaultBlacklisted event
      await waitForCondition(
        () => events.vaultBlacklisted.length > 0,
        5000,
        500
      );

      // Verify vault is blacklisted with emergency flag
      expect(events.vaultBlacklisted.length).toBe(1);
      expect(events.vaultBlacklisted[0].emergency).toBe(true);

      console.log('StrategyParameterUpdateFailed cascade failure test passed');
    }, 60000);
  });
});
