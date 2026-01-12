/**
 * @fileoverview Integration tests for lock-aware config update handling
 *
 * Tests the new architecture where:
 * - EventManager emits raw TargetTokensUpdated/TargetPlatformsUpdated/StrategyParameterUpdated events
 * - AutomationService handles lock-aware cache updates via handleConfigUpdate()
 * - Updates are queued when vault is locked, applied when unlocked
 *
 * Success scenarios tested:
 * 1. Immediate Apply (vault unlocked)
 *    - TargetTokensUpdated → VDS updated immediately
 *    - TargetPlatformsUpdated → VDS updated immediately
 *    - StrategyParameterUpdated → VDS updated immediately
 *
 * 2. Lock-Aware Queueing (vault locked)
 *    - Config update while locked → queued, not applied
 *    - VaultUnlocked → queued updates processed
 *    - Multiple same-type updates → latest wins
 *    - Different types queued independently
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

describe('Config Update Success Cases', () => {
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
        vaultName: 'Config Update Success Test Vault',
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
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'config-success-test-'));
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
      vaultLocked: [],
      vaultUnlocked: []
    };

    service.eventManager.subscribe('TargetTokensUpdated', (data) => {
      console.log(`  [EVENT] TargetTokensUpdated: ${data.vaultAddress?.slice(0, 10)}... tokens=${data.tokens?.join(',')}`);
      events.targetTokensUpdated.push(data);
    });

    service.eventManager.subscribe('TargetPlatformsUpdated', (data) => {
      console.log(`  [EVENT] TargetPlatformsUpdated: ${data.vaultAddress?.slice(0, 10)}... platforms=${data.platforms?.join(',')}`);
      events.targetPlatformsUpdated.push(data);
    });

    service.eventManager.subscribe('StrategyParameterUpdated', (data) => {
      console.log(`  [EVENT] StrategyParameterUpdated: ${data.vaultAddress?.slice(0, 10)}... paramName=${data.paramName}`);
      events.strategyParameterUpdated.push(data);
    });

    service.eventManager.subscribe('VaultLocked', (data) => {
      console.log(`  [EVENT] VaultLocked: ${data.vaultAddress?.slice(0, 10)}...`);
      events.vaultLocked.push(data);
    });

    service.eventManager.subscribe('VaultUnlocked', (data) => {
      console.log(`  [EVENT] VaultUnlocked: ${data.vaultAddress?.slice(0, 10)}...`);
      events.vaultUnlocked.push(data);
    });

    return events;
  };

  // ============================================================================
  // Immediate Apply (Vault Unlocked)
  // ============================================================================
  describe('Immediate Apply - Vault Unlocked', () => {
    it('should update VDS immediately when TargetTokensUpdated and vault is unlocked', async () => {
      await createTestService(3501);
      const events = setupEventTracking(service);

      // Start service and wait for vault to load
      await service.start();
      await waitForCondition(
        () => service.vaultDataService.hasVault(testVault.vaultAddress),
        30000,
        500
      );
      console.log('Service started and vault loaded');

      const normalizedAddress = ethers.utils.getAddress(testVault.vaultAddress);

      // Verify vault is NOT locked
      expect(service.vaultLocks[normalizedAddress]).toBeUndefined();

      // Get initial target tokens
      const vaultBefore = await service.vaultDataService.getVault(testVault.vaultAddress);
      expect(vaultBefore.targetTokens).toEqual(['USDC', 'WETH']);
      console.log(`Initial targetTokens: ${vaultBefore.targetTokens.join(', ')}`);

      // Trigger real TargetTokensUpdated event by changing target tokens on-chain
      console.log('Triggering TargetTokensUpdated event...');
      const newTargetTokens = ['WETH'];
      const setTokensTx = await testVault.vault.setTargetTokens(newTargetTokens);
      await setTokensTx.wait();
      console.log('setTargetTokens transaction confirmed');

      // Wait for event to be processed
      await waitForCondition(
        () => events.targetTokensUpdated.length > 0,
        15000,
        500
      );

      // Verify VDS was updated immediately (no queueing)
      const vaultAfter = await service.vaultDataService.getVault(testVault.vaultAddress);
      expect(vaultAfter.targetTokens).toEqual(['WETH']);
      console.log(`Updated targetTokens: ${vaultAfter.targetTokens.join(', ')}`);

      // Verify no pending updates (was applied immediately)
      expect(service.pendingConfigUpdates.has(normalizedAddress)).toBe(false);

      console.log('Immediate token update test passed');
    }, 90000);

    it('should update VDS immediately when TargetPlatformsUpdated and vault is unlocked', async () => {
      await createTestService(3502);
      const events = setupEventTracking(service);

      // Start service and wait for vault to load
      await service.start();
      await waitForCondition(
        () => service.vaultDataService.hasVault(testVault.vaultAddress),
        30000,
        500
      );
      console.log('Service started and vault loaded');

      const normalizedAddress = ethers.utils.getAddress(testVault.vaultAddress);

      // Verify vault is NOT locked
      expect(service.vaultLocks[normalizedAddress]).toBeUndefined();

      // Get initial target platforms
      const vaultBefore = await service.vaultDataService.getVault(testVault.vaultAddress);
      expect(vaultBefore.targetPlatforms).toEqual(['uniswapV3']);
      console.log(`Initial targetPlatforms: ${vaultBefore.targetPlatforms.join(', ')}`);

      // Trigger real TargetPlatformsUpdated event
      console.log('Triggering TargetPlatformsUpdated event...');
      const newTargetPlatforms = []; // Empty array to change platforms
      const setPlatformsTx = await testVault.vault.setTargetPlatforms(newTargetPlatforms);
      await setPlatformsTx.wait();
      console.log('setTargetPlatforms transaction confirmed');

      // Wait for event to be processed
      await waitForCondition(
        () => events.targetPlatformsUpdated.length > 0,
        15000,
        500
      );

      // Verify VDS was updated immediately
      const vaultAfter = await service.vaultDataService.getVault(testVault.vaultAddress);
      expect(vaultAfter.targetPlatforms).toEqual([]);
      console.log(`Updated targetPlatforms: ${vaultAfter.targetPlatforms.join(', ') || '(empty)'}`);

      // Verify no pending updates
      expect(service.pendingConfigUpdates.has(normalizedAddress)).toBe(false);

      console.log('Immediate platform update test passed');
    }, 90000);
  });

  // ============================================================================
  // Lock-Aware Queueing (Vault Locked)
  // ============================================================================
  describe('Lock-Aware Queueing - Vault Locked', () => {
    it('should queue config update when vault is locked', async () => {
      await createTestService(3503);
      const events = setupEventTracking(service);

      // Start service and wait for vault to load
      await service.start();
      await waitForCondition(
        () => service.vaultDataService.hasVault(testVault.vaultAddress),
        30000,
        500
      );
      console.log('Service started and vault loaded');

      const normalizedAddress = ethers.utils.getAddress(testVault.vaultAddress);

      // Lock the vault (simulating operation in progress)
      console.log('Locking vault...');
      const lockAcquired = service.lockVault(normalizedAddress);
      expect(lockAcquired).toBe(true);
      expect(service.vaultLocks[normalizedAddress]).toBeDefined();

      // Get initial target tokens
      const vaultBefore = await service.vaultDataService.getVault(testVault.vaultAddress);
      expect(vaultBefore.targetTokens).toEqual(['USDC', 'WETH']);

      // Trigger TargetTokensUpdated event while locked
      console.log('Triggering TargetTokensUpdated event while vault is locked...');
      const setTokensTx = await testVault.vault.setTargetTokens(['WETH']);
      await setTokensTx.wait();
      console.log('setTargetTokens transaction confirmed');

      // Wait for event to be received
      await waitForCondition(
        () => events.targetTokensUpdated.length > 0,
        15000,
        500
      );

      // Verify VDS was NOT updated (still has old value)
      const vaultStillOld = await service.vaultDataService.getVault(testVault.vaultAddress);
      expect(vaultStillOld.targetTokens).toEqual(['USDC', 'WETH']);
      console.log('VDS NOT updated while locked (correct)');

      // Verify update was queued
      expect(service.pendingConfigUpdates.has(normalizedAddress)).toBe(true);
      const queue = service.pendingConfigUpdates.get(normalizedAddress);
      expect(queue.length).toBe(1);
      expect(queue[0].type).toBe('tokens');
      expect(queue[0].data).toEqual(['WETH']);
      console.log('Update correctly queued');

      // Clean up - unlock vault
      service.unlockVault(normalizedAddress);

      console.log('Queue when locked test passed');
    }, 90000);

    it('should process queued updates when vault unlocks', async () => {
      await createTestService(3504);
      const events = setupEventTracking(service);

      // Start service and wait for vault to load
      await service.start();
      await waitForCondition(
        () => service.vaultDataService.hasVault(testVault.vaultAddress),
        30000,
        500
      );
      console.log('Service started and vault loaded');

      const normalizedAddress = ethers.utils.getAddress(testVault.vaultAddress);

      // Lock the vault
      console.log('Locking vault...');
      service.lockVault(normalizedAddress);

      // Trigger update while locked
      console.log('Triggering update while locked...');
      const setTokensTx = await testVault.vault.setTargetTokens(['WETH']);
      await setTokensTx.wait();

      // Wait for event and verify queued
      await waitForCondition(
        () => service.pendingConfigUpdates.has(normalizedAddress),
        15000,
        500
      );
      console.log('Update queued');

      // Verify old value still in VDS
      const vaultBefore = await service.vaultDataService.getVault(testVault.vaultAddress);
      expect(vaultBefore.targetTokens).toEqual(['USDC', 'WETH']);

      // Unlock the vault
      console.log('Unlocking vault...');
      service.unlockVault(normalizedAddress);

      // Wait for queued update to be processed
      await waitForCondition(
        () => !service.pendingConfigUpdates.has(normalizedAddress),
        10000,
        500
      );
      console.log('Queue processed');

      // Verify VDS now has new value
      const vaultAfter = await service.vaultDataService.getVault(testVault.vaultAddress);
      expect(vaultAfter.targetTokens).toEqual(['WETH']);
      console.log(`Updated targetTokens: ${vaultAfter.targetTokens.join(', ')}`);

      console.log('Process on unlock test passed');
    }, 90000);

    it('should apply only latest update when multiple same-type updates queued', async () => {
      await createTestService(3505);
      const events = setupEventTracking(service);

      // Start service and wait for vault to load
      await service.start();
      await waitForCondition(
        () => service.vaultDataService.hasVault(testVault.vaultAddress),
        30000,
        500
      );
      console.log('Service started and vault loaded');

      const normalizedAddress = ethers.utils.getAddress(testVault.vaultAddress);

      // Lock the vault
      console.log('Locking vault...');
      service.lockVault(normalizedAddress);

      // Trigger first update
      console.log('Triggering first token update...');
      const setTokensTx1 = await testVault.vault.setTargetTokens(['WETH']);
      await setTokensTx1.wait();

      await waitForCondition(
        () => service.pendingConfigUpdates.has(normalizedAddress),
        15000,
        500
      );

      // Trigger second update (should replace first)
      console.log('Triggering second token update...');
      const setTokensTx2 = await testVault.vault.setTargetTokens(['USDC']);
      await setTokensTx2.wait();

      // Wait for second event
      await waitForCondition(
        () => events.targetTokensUpdated.length >= 2,
        15000,
        500
      );

      // Verify queue has only 1 entry (latest wins)
      const queue = service.pendingConfigUpdates.get(normalizedAddress);
      expect(queue.length).toBe(1);
      expect(queue[0].type).toBe('tokens');
      expect(queue[0].data).toEqual(['USDC']); // Latest value
      console.log('Queue correctly has only latest value');

      // Unlock and verify final value
      console.log('Unlocking vault...');
      service.unlockVault(normalizedAddress);

      await waitForCondition(
        () => !service.pendingConfigUpdates.has(normalizedAddress),
        10000,
        500
      );

      const vaultAfter = await service.vaultDataService.getVault(testVault.vaultAddress);
      expect(vaultAfter.targetTokens).toEqual(['USDC']);
      console.log(`Final targetTokens: ${vaultAfter.targetTokens.join(', ')}`);

      console.log('Latest wins test passed');
    }, 90000);

    it('should queue tokens and platforms independently', async () => {
      await createTestService(3506);
      const events = setupEventTracking(service);

      // Start service and wait for vault to load
      await service.start();
      await waitForCondition(
        () => service.vaultDataService.hasVault(testVault.vaultAddress),
        30000,
        500
      );
      console.log('Service started and vault loaded');

      const normalizedAddress = ethers.utils.getAddress(testVault.vaultAddress);

      // Lock the vault
      console.log('Locking vault...');
      service.lockVault(normalizedAddress);

      // Trigger tokens update
      console.log('Triggering tokens update...');
      const setTokensTx = await testVault.vault.setTargetTokens(['WETH']);
      await setTokensTx.wait();

      // Trigger platforms update
      console.log('Triggering platforms update...');
      const setPlatformsTx = await testVault.vault.setTargetPlatforms([]);
      await setPlatformsTx.wait();

      // Wait for both events
      await waitForCondition(
        () => events.targetTokensUpdated.length > 0 && events.targetPlatformsUpdated.length > 0,
        15000,
        500
      );

      // Verify queue has 2 entries (both types)
      const queue = service.pendingConfigUpdates.get(normalizedAddress);
      expect(queue.length).toBe(2);

      const tokensUpdate = queue.find(u => u.type === 'tokens');
      const platformsUpdate = queue.find(u => u.type === 'platforms');

      expect(tokensUpdate).toBeDefined();
      expect(tokensUpdate.data).toEqual(['WETH']);
      expect(platformsUpdate).toBeDefined();
      expect(platformsUpdate.data).toEqual([]);
      console.log('Both update types queued independently');

      // Unlock and verify both applied
      console.log('Unlocking vault...');
      service.unlockVault(normalizedAddress);

      await waitForCondition(
        () => !service.pendingConfigUpdates.has(normalizedAddress),
        10000,
        500
      );

      const vaultAfter = await service.vaultDataService.getVault(testVault.vaultAddress);
      expect(vaultAfter.targetTokens).toEqual(['WETH']);
      expect(vaultAfter.targetPlatforms).toEqual([]);
      console.log(`Final targetTokens: ${vaultAfter.targetTokens.join(', ')}`);
      console.log(`Final targetPlatforms: ${vaultAfter.targetPlatforms.join(', ') || '(empty)'}`);

      console.log('Independent queue test passed');
    }, 90000);
  });

  // ============================================================================
  // Strategy Parameter Updates
  // ============================================================================
  describe('Strategy Parameter Updates', () => {
    it('should update VDS immediately when StrategyParameterUpdated and vault is unlocked', async () => {
      await createTestService(3507);
      const events = setupEventTracking(service);

      // Start service and wait for vault to load
      await service.start();
      await waitForCondition(
        () => service.vaultDataService.hasVault(testVault.vaultAddress),
        30000,
        500
      );
      console.log('Service started and vault loaded');

      const normalizedAddress = ethers.utils.getAddress(testVault.vaultAddress);

      // Verify vault is NOT locked
      expect(service.vaultLocks[normalizedAddress]).toBeUndefined();

      // Get initial strategy parameters
      const vaultBefore = await service.vaultDataService.getVault(testVault.vaultAddress);
      const initialRangeUpper = vaultBefore.strategy.parameters.targetRangeUpper;
      console.log(`Initial targetRangeUpper: ${initialRangeUpper}`);

      // Trigger StrategyParameterUpdated event by changing range parameters on-chain
      // Strategy methods must be called via vault.execute() due to onlyAuthorizedVault modifier
      console.log('Triggering StrategyParameterUpdated event via setRangeParameters...');
      const newUpperRange = 800; // 8.00% in basis points (will be mapped to 8 in cache)
      const newLowerRange = 800;
      const expectedCacheValue = 8; // mapStrategyParameters divides by 100

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
      const setRangeData = strategyInterface.encodeFunctionData('setRangeParameters', [
        newUpperRange,
        newLowerRange
      ]);
      const setParamsTx = await testVault.vault.execute(
        [babyStepsStrategyAddress],
        [setRangeData]
      );
      await setParamsTx.wait();
      console.log('setRangeParameters transaction confirmed');

      // Wait for event to be processed
      await waitForCondition(
        () => events.strategyParameterUpdated.length > 0,
        15000,
        500
      );

      // Verify VDS was updated immediately
      const vaultAfter = await service.vaultDataService.getVault(testVault.vaultAddress);
      expect(vaultAfter.strategy.parameters.targetRangeUpper).toBe(expectedCacheValue);
      expect(vaultAfter.strategy.parameters.targetRangeLower).toBe(expectedCacheValue);
      console.log(`Updated targetRangeUpper: ${vaultAfter.strategy.parameters.targetRangeUpper}`);

      // Verify no pending updates (was applied immediately)
      expect(service.pendingConfigUpdates.has(normalizedAddress)).toBe(false);

      console.log('Immediate strategy param update test passed');
    }, 90000);

    it('should queue strategy param update when vault is locked', async () => {
      await createTestService(3508);
      const events = setupEventTracking(service);

      // Start service and wait for vault to load
      await service.start();
      await waitForCondition(
        () => service.vaultDataService.hasVault(testVault.vaultAddress),
        30000,
        500
      );
      console.log('Service started and vault loaded');

      const normalizedAddress = ethers.utils.getAddress(testVault.vaultAddress);

      // Get initial strategy parameters
      const vaultBefore = await service.vaultDataService.getVault(testVault.vaultAddress);
      const initialRangeUpper = vaultBefore.strategy.parameters.targetRangeUpper;
      console.log(`Initial targetRangeUpper: ${initialRangeUpper}`);

      // Lock the vault
      console.log('Locking vault...');
      service.lockVault(normalizedAddress);
      expect(service.vaultLocks[normalizedAddress]).toBeDefined();

      // Trigger StrategyParameterUpdated event while locked
      // Strategy methods must be called via vault.execute() due to onlyAuthorizedVault modifier
      console.log('Triggering StrategyParameterUpdated event while vault is locked...');
      const newUpperRange = 900; // 9.00% in basis points (will be mapped to 9 in cache)
      const newLowerRange = 900;
      const expectedCacheValue = 9; // mapStrategyParameters divides by 100

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
      const setRangeData = strategyInterface.encodeFunctionData('setRangeParameters', [
        newUpperRange,
        newLowerRange
      ]);
      const setParamsTx = await testVault.vault.execute(
        [babyStepsStrategyAddress],
        [setRangeData]
      );
      await setParamsTx.wait();
      console.log('setRangeParameters transaction confirmed');

      // Wait for event to be received
      await waitForCondition(
        () => events.strategyParameterUpdated.length > 0,
        15000,
        500
      );

      // Verify VDS was NOT updated (still has old value)
      const vaultStillOld = await service.vaultDataService.getVault(testVault.vaultAddress);
      expect(vaultStillOld.strategy.parameters.targetRangeUpper).toBe(initialRangeUpper);
      console.log('VDS NOT updated while locked (correct)');

      // Verify update was queued
      expect(service.pendingConfigUpdates.has(normalizedAddress)).toBe(true);
      const queue = service.pendingConfigUpdates.get(normalizedAddress);
      expect(queue.length).toBe(1);
      expect(queue[0].type).toBe('params');
      console.log('Strategy param update correctly queued');

      // Unlock and verify update is applied
      console.log('Unlocking vault...');
      service.unlockVault(normalizedAddress);

      await waitForCondition(
        () => !service.pendingConfigUpdates.has(normalizedAddress),
        10000,
        500
      );

      const vaultAfter = await service.vaultDataService.getVault(testVault.vaultAddress);
      expect(vaultAfter.strategy.parameters.targetRangeUpper).toBe(expectedCacheValue);
      console.log(`Updated targetRangeUpper after unlock: ${vaultAfter.strategy.parameters.targetRangeUpper}`);

      console.log('Queue strategy param when locked test passed');
    }, 90000);
  });
});
