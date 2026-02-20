/**
 * @fileoverview Integration tests for WebSocket provider reconnection
 *
 * Tests:
 * 1. Successful reconnection after WebSocket disconnect
 *    - Vault state preserved (cache, failedVaults, blacklist)
 *    - Listeners re-established
 *    - Events flow correctly post-reconnection
 *
 * 2. Fatal error after max reconnection attempts
 *    - ProviderFailed event emitted
 *    - handleFatalError called
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import AutomationService from '../../../src/core/AutomationService.js';
import { setupTestBlockchain, cleanupTestBlockchain } from '../../helpers/hardhat-setup.js';
import { setupTestVault } from '../../helpers/test-vault-setup.js';
import { setupSwapWallet, executeSwap, getTokenAddressForTest } from '../../helpers/swap-utils.js';
import { waitForCondition } from '../../helpers/wait-utils.js';
import { ethers } from 'ethers';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';

describe('Provider Reconnection', () => {
  let testEnv;
  let testConfig;
  let tempDir;
  let service;
  let testVault;
  let swapWallet;

  beforeAll(async () => {
    testEnv = await setupTestBlockchain();
    testConfig = testEnv.testConfig;

    // Setup swap wallet for post-reconnection testing
    swapWallet = await setupSwapWallet(testEnv, {
      ethAmount: '100',
      wethAmount: '50',
      usdcAmount: '0'
    });

    // Create test vault
    testVault = await setupTestVault(
      testEnv.hardhatServer,
      testEnv.contracts,
      testEnv.deployedContracts,
      {
        vaultName: 'Reconnection Test Vault',
        automationServiceAddress: testConfig.automationServiceAddress,
        wrapEthAmount: '5',
        swapTokens: [{ from: 'WETH', to: 'USDC', amount: '1' }],
        positions: [{
          token0: 'USDC',
          token1: 'WETH',
          fee: 500,
          percentOfAssets: 50,
          tickRange: { type: 'centered', spacing: 20 }
        }],
        targetTokens: ['USDC', 'WETH'],
        targetPlatforms: ['uniswapV3']
      }
    );

    console.log(`Test vault created: ${testVault.vaultAddress}`);
  }, 180000);

  afterAll(async () => {
    await cleanupTestBlockchain(testEnv);
  });

  afterEach(async () => {
    vi.restoreAllMocks();

    if (service) {
      try {
        // Always force stop to clean up SSEBroadcaster, EventManager, etc.
        // even when isRunning=false and provider=null (e.g., after failed reconnection)
        await service.stop(true);
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
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'reconnect-test-'));
    return tempDir;
  };

  /**
   * Helper to create a service with test config
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
      trackingFailuresFilePath: path.join(dir, 'trackingFailures.json'),
      ssePort,
      debug: true,
      retryIntervalMs: 999999999  // Disabled automatic retry
    });

    return { service, dir, blacklistPath, trackingDir };
  };

  // ============================================================================
  // Successful Reconnection
  // ============================================================================
  describe('Successful Reconnection', () => {
    it('should reconnect and preserve vault state when WebSocket disconnects', async () => {
      await createTestService(3501);

      // Track reconnection events
      const events = {
        providerDisconnected: [],
        providerReconnecting: [],
        providerReconnected: [],
        providerFailed: [],
        swapDetected: []
      };

      service.eventManager.subscribe('ProviderDisconnected', (data) => {
        console.log(`  [EVENT] ProviderDisconnected: code=${data.code}`);
        events.providerDisconnected.push(data);
      });

      service.eventManager.subscribe('ProviderReconnecting', (data) => {
        console.log(`  [EVENT] ProviderReconnecting: attempt ${data.attempt}/${data.maxAttempts}`);
        events.providerReconnecting.push(data);
      });

      service.eventManager.subscribe('ProviderReconnected', (data) => {
        console.log(`  [EVENT] ProviderReconnected: after ${data.attempts} attempt(s)`);
        events.providerReconnected.push(data);
      });

      service.eventManager.subscribe('ProviderFailed', (data) => {
        console.log(`  [EVENT] ProviderFailed: after ${data.attempts} attempts`);
        events.providerFailed.push(data);
      });

      service.eventManager.subscribe('SwapEventDetected', (data) => {
        console.log(`  [EVENT] SwapEventDetected: pool ${data.poolAddress?.slice(0, 10)}...`);
        events.swapDetected.push(data);
      });

      // Start service
      console.log('Starting service...');
      await service.start();

      // Verify vault is loaded
      expect(service.vaultDataService.hasVault(testVault.vaultAddress)).toBe(true);
      console.log(`Vault loaded: ${testVault.vaultAddress}`);

      // Record initial state
      const initialVaultData = await service.vaultDataService.getVault(testVault.vaultAddress);
      const initialListenerCount = service.eventManager.getListenerCount();
      console.log(`Initial state: ${Object.keys(initialVaultData.positions).length} position(s), ${initialListenerCount} listener(s)`);

      // Get reference to WebSocket before disconnect
      const ws = service.provider._websocket;
      expect(ws).toBeDefined();

      // Simulate WebSocket disconnect by emitting 'close' event with abnormal code
      console.log('Simulating WebSocket disconnect (code 1006)...');
      ws.emit('close', 1006, 'Connection lost');

      // Wait for reconnection to complete
      await waitForCondition(
        () => events.providerReconnected.length > 0,
        30000,  // 30 second timeout (reconnection has exponential backoff)
        500
      );

      console.log('Reconnection complete');

      // Verify reconnection events
      expect(events.providerDisconnected.length).toBe(1);
      expect(events.providerDisconnected[0].code).toBe(1006);
      expect(events.providerReconnecting.length).toBeGreaterThan(0);
      expect(events.providerReconnected.length).toBe(1);
      expect(events.providerFailed.length).toBe(0);

      // Verify vault state preserved
      expect(service.vaultDataService.hasVault(testVault.vaultAddress)).toBe(true);
      const postReconnectVault = await service.vaultDataService.getVault(testVault.vaultAddress);
      expect(Object.keys(postReconnectVault.positions).length).toBe(Object.keys(initialVaultData.positions).length);
      console.log('Vault state preserved after reconnection');

      // Verify listeners re-established
      const postReconnectListenerCount = service.eventManager.getListenerCount();
      console.log(`Post-reconnect listeners: ${postReconnectListenerCount} (was ${initialListenerCount})`);
      expect(postReconnectListenerCount).toBeGreaterThan(0);

      // Verify swap events are processed post-reconnection
      console.log('Executing swap to verify listeners work...');
      const wethAddress = getTokenAddressForTest('WETH', 1337);
      const usdcAddress = getTokenAddressForTest('USDC', 1337);

      const swapAmount = ethers.utils.parseUnits('1', 18);
      await executeSwap(testEnv, {
        tokenIn: wethAddress,
        tokenOut: usdcAddress,
        amountIn: swapAmount,
        fee: 500,
        wallet: swapWallet.wallet,
        slippage: 5
      });

      // Wait for swap event to be detected
      await waitForCondition(
        () => events.swapDetected.length > 0,
        10000,
        500
      );

      expect(events.swapDetected.length).toBeGreaterThan(0);
      console.log('Swap event detected post-reconnection - listeners working');

      console.log('Successful reconnection test passed');
    }, 120000);

    it('should preserve failedVaults queue across reconnection', async () => {
      await createTestService(3502);

      // Track events
      const events = {
        providerReconnected: [],
        vaultFailed: []
      };

      service.eventManager.subscribe('ProviderReconnected', (data) => {
        events.providerReconnected.push(data);
      });

      service.eventManager.subscribe('VaultFailed', (data) => {
        events.vaultFailed.push(data);
      });

      // Mock getVault to fail for our test vault (to put it in retry queue)
      const originalInitialize = service.initialize.bind(service);
      let initCallCount = 0;
      service.initialize = async function() {
        await originalInitialize();

        // After initialization, mock getVault to fail once
        const realGetVault = service.vaultDataService.getVault.bind(service.vaultDataService);
        vi.spyOn(service.vaultDataService, 'getVault').mockImplementation(async (addr, forceRefresh) => {
          if (addr === testVault.vaultAddress) {
            initCallCount++;
            if (initCallCount === 1) {
              throw new Error('NETWORK_ERROR: Initial load failed');
            }
          }
          return realGetVault(addr, forceRefresh);
        });
      };

      // Start service - vault should fail and enter retry queue
      console.log('Starting service (expecting vault to fail)...');
      await service.start();

      // Verify vault is in retry queue
      expect(service.failedVaults.has(testVault.vaultAddress)).toBe(true);
      console.log(`Vault in retry queue: ${service.failedVaults.has(testVault.vaultAddress)}`);

      // Record failedVaults state
      const failedVaultData = service.failedVaults.get(testVault.vaultAddress);
      expect(failedVaultData).toBeDefined();
      console.log(`Failed vault data: attempts=${failedVaultData.attempts}, error=${failedVaultData.lastError}`);

      // Simulate disconnect
      console.log('Simulating WebSocket disconnect...');
      const ws = service.provider._websocket;
      ws.emit('close', 1006, 'Connection lost');

      // Wait for reconnection
      await waitForCondition(
        () => events.providerReconnected.length > 0,
        30000,
        500
      );

      // Verify failedVaults preserved
      expect(service.failedVaults.has(testVault.vaultAddress)).toBe(true);
      const postReconnectFailedData = service.failedVaults.get(testVault.vaultAddress);
      expect(postReconnectFailedData.attempts).toBe(failedVaultData.attempts);
      expect(postReconnectFailedData.lastError).toBe(failedVaultData.lastError);
      console.log('failedVaults queue preserved across reconnection');

      console.log('Failed vaults preservation test passed');
    }, 120000);
  });

  // ============================================================================
  // Failed Reconnection
  // ============================================================================
  describe('Failed Reconnection', () => {
    it('should emit ProviderFailed and call handleFatalError after max attempts', async () => {
      await createTestService(3503);

      // Track events
      const events = {
        providerReconnecting: [],
        providerFailed: []
      };

      service.eventManager.subscribe('ProviderReconnecting', (data) => {
        console.log(`  [EVENT] ProviderReconnecting: attempt ${data.attempt}/${data.maxAttempts}`);
        events.providerReconnecting.push(data);
      });

      service.eventManager.subscribe('ProviderFailed', (data) => {
        console.log(`  [EVENT] ProviderFailed: after ${data.attempts} attempts`);
        events.providerFailed.push(data);
      });

      // Track handleFatalError calls
      let fatalErrorCalled = false;
      let fatalError = null;
      vi.spyOn(service, 'handleFatalError').mockImplementation(async (error) => {
        console.log(`  [MOCK] handleFatalError called: ${error.message}`);
        fatalErrorCalled = true;
        fatalError = error;
        // Do the cleanup that handleFatalError does, but skip process.exit(1)
        // which vitest intercepts and throws an error for
        await service.stop();
      });

      // Start service
      console.log('Starting service...');
      await service.start();

      // Reduce max attempts for faster test
      service.maxReconnectAttempts = 2;
      service.reconnectBaseDelay = 100;  // 100ms base delay

      // Mock provider creation to always fail
      const wsProviderSpy = vi.spyOn(ethers.providers, 'WebSocketProvider').mockImplementation(() => {
        throw new Error('Connection refused');
      });

      // Simulate disconnect
      console.log('Simulating WebSocket disconnect (reconnection will fail)...');
      const ws = service.provider._websocket;
      ws.emit('close', 1006, 'Connection lost');

      // Wait for ProviderFailed event
      await waitForCondition(
        () => events.providerFailed.length > 0 || fatalErrorCalled,
        30000,
        500
      );

      // Verify ProviderFailed was emitted
      expect(events.providerFailed.length).toBe(1);
      expect(events.providerFailed[0].attempts).toBe(2);

      // Verify handleFatalError was called
      expect(fatalErrorCalled).toBe(true);
      expect(fatalError.message).toContain('reconnection failed');

      // Verify reconnection attempts were made
      expect(events.providerReconnecting.length).toBe(2);

      console.log('Failed reconnection test passed');

      // Restore WebSocketProvider mock before afterEach cleanup
      wsProviderSpy.mockRestore();
    }, 60000);
  });
});
