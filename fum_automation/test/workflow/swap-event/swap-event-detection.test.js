/**
 * @fileoverview Test swap event detection and concurrent processing prevention
 *
 * Tests:
 * 1. Swap listeners registered after service initialization
 * 2. Sequential swap events process correctly with balanced lock/unlock
 * 3. Concurrent swap events - second event skipped when vault already locked
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import AutomationService from '../../../src/core/AutomationService.js';
import { setupTestBlockchain, cleanupTestBlockchain } from '../../helpers/hardhat-setup.js';
import { setupTestVault } from '../../helpers/test-vault-setup.js';
import { setupSwapWallet, executeSwap, configureStrategyParameters } from '../../helpers/swap-utils.js';
import { waitForCondition } from '../../helpers/wait-utils.js';
import { ethers } from 'ethers';

// Mock getPoolTVLAverage to ensure 500 bps pool is always selected
vi.mock('fum_library', async () => {
  const actual = await vi.importActual('fum_library');
  return {
    ...actual,
    getPoolTVLAverage: vi.fn().mockImplementation((poolAddress) => {
      const address = poolAddress.toLowerCase();
      // WETH/USDC 500 bps pool on Arbitrum - highest TVL
      if (address === '0xc6962004f452be9203591991d15f6b388e09e8d0') {
        return Promise.resolve(100000000); // $100M
      }
      // Other pools get lower TVL
      return Promise.resolve(10000000); // $10M
    })
  };
});

describe('Swap Event Detection', () => {
  let testEnv;
  let service;
  let testVault;
  let swapWallet;

  beforeAll(async () => {
    // Setup blockchain
    testEnv = await setupTestBlockchain();
    console.log('Test blockchain connected');

    // Setup swap wallet for market manipulation
    console.log('Setting up swap wallet...');
    const swapSetup = await setupSwapWallet(testEnv, {
      ethAmount: '100',
      wethAmount: '50',
      usdcAmount: '0' // Don't need USDC for this test
    });
    swapWallet = swapSetup;

    // Create test vault with one aligned position
    console.log('Creating test vault...');
    testVault = await setupTestVault(
      testEnv.hardhatServer,
      testEnv.contracts,
      testEnv.deployedContracts,
      {
        vaultName: 'Swap Detection Test Vault',
        wrapEthAmount: '10',
        swapTokens: [{ from: 'WETH', to: 'USDC', amount: '5' }],
        positions: [{
          token0: 'USDC',
          token1: 'WETH',
          fee: 500,
          percentOfAssets: 100,
          tickRange: { type: 'centered', spacing: 10 }
        }],
        targetTokens: ['USDC', 'WETH'],
        targetPlatforms: ['uniswapV3']
      }
    );
    console.log(`Test vault created: ${testVault.vaultAddress}`);

    // Configure strategy parameters
    await configureStrategyParameters(testEnv, testVault.vaultAddress, testVault.vault, {
      targetRangeUpper: 100,  // 1% range (wider to avoid accidental rebalance)
      targetRangeLower: 100,
      emergencyExitTrigger: 200 // 2% (high to avoid triggering)
    });

    // Initialize and start automation service
    service = new AutomationService(testEnv.testConfig);
    await service.start();
    console.log('Automation service started');

    // Wait for service to discover vault
    await waitForCondition(
      () => service.vaultDataService.hasVault(testVault.vaultAddress),
      30000,
      500
    );
    console.log('Vault discovered by service');
  });

  afterAll(async () => {
    if (service) {
      try {
        await service.stop(true);
      } catch (error) {
        console.warn('Error stopping service:', error.message);
      }
    }
    await cleanupTestBlockchain(testEnv);
  });

  it('should have registered swap event listeners for the vault', async () => {
    // Verify vault is initialized
    const vaultInitialized = service.vaultDataService.hasVault(testVault.vaultAddress);
    expect(vaultInitialized).toBe(true);

    // Get vault data
    const vaultData = await service.vaultDataService.getVault(testVault.vaultAddress);
    expect(vaultData).toBeDefined();

    // Verify position exists
    const positions = Object.values(vaultData.positions);
    expect(positions.length).toBeGreaterThan(0);

    const position = positions[0];
    const poolAddress = position.pool;

    // Verify swap listener registered
    const swapListenerKey = `${poolAddress.toLowerCase()}-swap-1337-uniswapV3`;
    expect(service.eventManager.listeners[swapListenerKey]).toBeDefined();

    // Verify vault is in pool mapping
    expect(service.eventManager.poolToVaults[poolAddress]).toContain(testVault.vaultAddress);

    // Verify config event listeners registered
    const tokenListenerKey = `${testVault.vaultAddress.toLowerCase()}-config-tokens-1337`;
    const platformListenerKey = `${testVault.vaultAddress.toLowerCase()}-config-platforms-1337`;

    expect(service.eventManager.listeners[tokenListenerKey]).toBeDefined();
    expect(service.eventManager.listeners[platformListenerKey]).toBeDefined();

    console.log(`All event listeners registered for vault ${testVault.vaultAddress}`);
  });

  it('should detect swap events and prevent concurrent processing', async () => {
    // Track lock/unlock events
    const vaultLockEvents = [];
    const vaultUnlockEvents = [];

    service.eventManager.subscribe('VaultLocked', (data) => {
      if (data.vaultAddress === testVault.vaultAddress) {
        vaultLockEvents.push(data);
        console.log(`VaultLocked: ${data.vaultAddress}`);
      }
    });

    service.eventManager.subscribe('VaultUnlocked', (data) => {
      if (data.vaultAddress === testVault.vaultAddress) {
        vaultUnlockEvents.push(data);
        console.log(`VaultUnlocked: ${data.vaultAddress}`);
      }
    });

    // Get token addresses from service cache
    const wethData = service.tokens['WETH'];
    const usdcData = service.tokens['USDC'];

    // Execute two swaps in quick succession
    // Note: We don't pass explicit nonces because executeSwap does an approval first
    // which consumes a nonce before the actual swap transaction
    console.log('Executing two swaps in quick succession...');

    const swapAmount1 = ethers.utils.parseUnits('0.1', wethData.decimals);
    const swapAmount2 = ethers.utils.parseUnits('0.15', wethData.decimals);

    // Execute first swap
    await executeSwap(testEnv, {
      tokenIn: wethData.address,
      tokenOut: usdcData.address,
      amountIn: swapAmount1,
      fee: 500,
      wallet: swapWallet.wallet
    });
    console.log('Swap 1 completed');

    // Execute second swap immediately after first completes
    await executeSwap(testEnv, {
      tokenIn: wethData.address,
      tokenOut: usdcData.address,
      amountIn: swapAmount2,
      fee: 500,
      wallet: swapWallet.wallet
    });
    console.log('Swap 2 completed');

    // Wait for events to be processed
    await waitForCondition(
      () => vaultUnlockEvents.length >= 1,
      30000,
      500
    );

    // Verify concurrency protection
    // Lock and unlock events should be balanced
    expect(vaultLockEvents.length).toBe(vaultUnlockEvents.length);

    // Vault should be unlocked at the end
    const normalizedAddress = ethers.utils.getAddress(testVault.vaultAddress);
    const vaultLocked = service.vaultLocks[normalizedAddress];
    expect(vaultLocked).toBeFalsy();

    console.log(`Concurrency test passed: ${vaultLockEvents.length} lock/unlock cycles`);
  });

  it('should skip second swap event when vault is locked by first', async () => {
    // This test verifies that when a vault is already locked (being processed),
    // a second swap event for the same vault is skipped rather than queued or processed

    const normalizedAddress = ethers.utils.getAddress(testVault.vaultAddress);

    // Track events
    const swapEventsReceived = [];
    const skippedLogs = [];

    // Spy on service.log to capture "locked, skipping" messages
    const originalLog = service.log.bind(service);
    vi.spyOn(service, 'log').mockImplementation((msg) => {
      if (msg.includes('locked, skipping')) {
        skippedLogs.push(msg);
      }
      originalLog(msg);
    });

    service.eventManager.subscribe('SwapEventDetected', (data) => {
      if (data.vaultAddress === testVault.vaultAddress) {
        swapEventsReceived.push(data);
      }
    });

    // Get vault data for pool info
    const vaultData = await service.vaultDataService.getVault(testVault.vaultAddress);
    const position = Object.values(vaultData.positions)[0];
    const poolAddress = position.pool;

    // Step 1: Manually lock the vault (simulating first event being processed)
    console.log('Manually locking vault to simulate in-progress processing...');
    const lockAcquired = service.lockVault(normalizedAddress);
    expect(lockAcquired).toBe(true);
    expect(service.vaultLocks[normalizedAddress]).toBeDefined();

    // Step 2: Emit a SwapEventDetected event while vault is locked
    console.log('Emitting SwapEventDetected while vault is locked...');
    service.eventManager.emit('SwapEventDetected', {
      vaultAddress: testVault.vaultAddress,
      poolAddress: poolAddress,
      poolId: poolAddress,
      platform: 'uniswapV3',
      log: { blockNumber: 12345, transactionHash: '0xtest' }
    });

    // Give time for the event to be processed (or skipped)
    await new Promise(resolve => setTimeout(resolve, 500));

    // Step 3: Verify the event was skipped
    expect(skippedLogs.length).toBe(1);
    expect(skippedLogs[0]).toContain(testVault.vaultAddress);
    expect(skippedLogs[0]).toContain('locked, skipping');
    console.log(`Verified: swap event was skipped - "${skippedLogs[0]}"`);

    // Step 4: Unlock the vault
    service.unlockVault(normalizedAddress);
    expect(service.vaultLocks[normalizedAddress]).toBeUndefined();

    // Step 5: Emit another event - this one should process (acquire lock)
    console.log('Emitting SwapEventDetected after vault is unlocked...');
    const lockEventsAfterUnlock = [];
    service.eventManager.subscribe('VaultLocked', (data) => {
      if (data.vaultAddress === normalizedAddress) {
        lockEventsAfterUnlock.push(data);
      }
    });

    service.eventManager.emit('SwapEventDetected', {
      vaultAddress: testVault.vaultAddress,
      poolAddress: poolAddress,
      poolId: poolAddress,
      platform: 'uniswapV3',
      log: { blockNumber: 12346, transactionHash: '0xtest2' }
    });

    // Wait for processing to complete
    await waitForCondition(
      () => lockEventsAfterUnlock.length > 0,
      10000,
      100
    );

    // This event should have acquired the lock (not skipped)
    expect(lockEventsAfterUnlock.length).toBe(1);
    console.log('Verified: swap event processed after unlock');

    // Wait for unlock
    await waitForCondition(
      () => !service.vaultLocks[normalizedAddress],
      10000,
      100
    );

    // Restore mock
    vi.restoreAllMocks();

    console.log('Concurrent lock test passed');
  });
});
