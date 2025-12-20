/**
 * @fileoverview Integration test for AutomationService initialization with 0 pre-existing vaults
 * Tests the complete service lifecycle: constructor → start → running state → stop
 *
 * This test is for the NEW architecture (multi-strategy, platform-agnostic).
 * Legacy BS-0vaults.test.js remains for the legacy src code.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import AutomationService from '../../../../src/core/AutomationService.js';
import { setupTestBlockchain, cleanupTestBlockchain } from '../../../helpers/hardhat-setup.js';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('AutomationService Initialization - 0 Pre-Existing Vaults (New Architecture)', () => {
  let testEnv;
  const testBlacklistPath = path.join(__dirname, '../../../data/.test-0vaults-blacklist.json');

  beforeAll(async () => {
    testEnv = await setupTestBlockchain();
    // Clean up test blacklist file
    try {
      await fs.unlink(testBlacklistPath);
    } catch (e) {
      // File doesn't exist, that's fine
    }
  });

  afterAll(async () => {
    await cleanupTestBlockchain(testEnv);
    // Clean up test blacklist file
    try {
      await fs.unlink(testBlacklistPath);
    } catch (e) {
      // File doesn't exist, that's fine
    }
  });

  describe('Constructor Validation', () => {
    it('should throw error for missing automationServiceAddress', () => {
      expect(() => new AutomationService({
        chainId: 1337,
        wsUrl: 'ws://localhost:8545'
      })).toThrow('automationServiceAddress is required');
    });

    it('should throw error for invalid automationServiceAddress', () => {
      expect(() => new AutomationService({
        automationServiceAddress: 'not-an-address',
        chainId: 1337,
        wsUrl: 'ws://localhost:8545'
      })).toThrow('automationServiceAddress must be a valid Ethereum address');
    });

    it('should throw error for missing chainId', () => {
      expect(() => new AutomationService({
        automationServiceAddress: '0xabA472B2EA519490EE10E643A422D578a507197A',
        wsUrl: 'ws://localhost:8545'
      })).toThrow('chainId is required');
    });

    it('should throw error for invalid chainId', () => {
      expect(() => new AutomationService({
        automationServiceAddress: '0xabA472B2EA519490EE10E643A422D578a507197A',
        chainId: -1,
        wsUrl: 'ws://localhost:8545'
      })).toThrow('chainId must be a positive number');
    });

    it('should throw error for missing wsUrl', () => {
      expect(() => new AutomationService({
        automationServiceAddress: '0xabA472B2EA519490EE10E643A422D578a507197A',
        chainId: 1337
      })).toThrow('wsUrl is required');
    });

    it('should throw error for invalid wsUrl', () => {
      expect(() => new AutomationService({
        automationServiceAddress: '0xabA472B2EA519490EE10E643A422D578a507197A',
        chainId: 1337,
        wsUrl: 'http://localhost:8545'
      })).toThrow('wsUrl must be a valid WebSocket URL');
    });

    it('should use default values for optional config', () => {
      const service = new AutomationService({
        automationServiceAddress: '0xabA472B2EA519490EE10E643A422D578a507197A',
        chainId: 1337,
        wsUrl: 'ws://localhost:8545'
      });

      expect(service.debug).toBe(false);
      expect(service.ssePort).toBe(3001);
      expect(service.retryIntervalMs).toBe(300000);
      expect(service.maxFailureDurationMs).toBe(3600000);
    });

    it('should update poolData when PoolDataFetched event is emitted', () => {
      const service = new AutomationService({
        automationServiceAddress: '0xabA472B2EA519490EE10E643A422D578a507197A',
        chainId: 1337,
        wsUrl: 'ws://localhost:8545'
      });

      const testPoolData = {
        '0x1234567890123456789012345678901234567890': {
          token0Symbol: 'USDC',
          token1Symbol: 'WETH',
          fee: 500
        }
      };

      service.eventManager.emit('PoolDataFetched', { poolData: testPoolData });

      expect(service.poolData['0x1234567890123456789012345678901234567890']).toBeDefined();
      expect(service.poolData['0x1234567890123456789012345678901234567890'].token0Symbol).toBe('USDC');
    });
  });

  describe('Success Case - Complete Service Initialization (0 Vaults)', () => {
    it('should successfully initialize service and all components', async () => {
      // Use test-specific blacklist path
      const testConfig = {
        ...testEnv.testConfig,
        blacklistFilePath: testBlacklistPath
      };

      // ========================================
      // PHASE 1: Constructor and Pre-Start State
      // ========================================

      const service = new AutomationService(testConfig);

      // Test 1: Configuration validation and property assignment
      expect(service.automationServiceAddress).toBe(testConfig.automationServiceAddress);
      expect(service.chainId).toBe(testConfig.chainId);
      expect(service.wsUrl).toBe(testConfig.wsUrl);
      expect(service.debug).toBe(testConfig.debug);

      // Test 2: Basic service state initialization (before start)
      expect(service.isRunning).toBe(false);
      expect(service.provider).toBe(null);
      expect(service.contracts).toEqual({});

      // Test 3: Data structure initialization
      expect(service.vaultLocks).toEqual({});
      expect(service.adapters).toBeInstanceOf(Map);
      expect(service.adapters.size).toBe(0);
      expect(service.tokens).toEqual({});
      expect(service.poolData).toEqual({});

      // Test 4: EventManager initialization
      expect(service.eventManager).toBeDefined();
      expect(typeof service.eventManager.setDebug).toBe('function');
      expect(typeof service.eventManager.registerContractListener).toBe('function');
      expect(service.eventManager.listeners).toEqual({});
      expect(service.eventManager.debug).toBe(testConfig.debug);
      expect(service.eventManager.enabled).toBe(true);

      // Test 5: VaultDataService constructor initialization
      expect(service.vaultDataService).toBeDefined();
      expect(service.vaultDataService.vaults).toBeInstanceOf(Map);
      expect(service.vaultDataService.vaults.size).toBe(0);
      expect(service.vaultDataService.eventManager).toBe(service.eventManager);
      expect(service.vaultDataService.provider).toBe(null);
      expect(service.vaultDataService.chainId).toBe(null);

      // Test 6: Tracker constructor initialization
      expect(service.tracker).toBeDefined();
      expect(service.tracker.vaultMetadata).toBeInstanceOf(Map);
      expect(service.tracker.vaultMetadata.size).toBe(0);
      expect(service.tracker.eventManager).toBe(service.eventManager);
      expect(service.tracker.dataDir).toContain('vaults');
      expect(service.tracker.debug).toBe(testConfig.debug);

      // Test 7: SSEBroadcaster constructor initialization
      expect(service.sseBroadcaster).toBeDefined();
      expect(service.sseBroadcaster.eventManager).toBe(service.eventManager);
      expect(service.sseBroadcaster.port).toBe(testConfig.ssePort);
      expect(service.sseBroadcaster.debug).toBe(testConfig.debug);
      expect(service.sseBroadcaster.isRunning).toBe(false);
      expect(service.sseBroadcaster.clients).toBeInstanceOf(Set);
      expect(service.sseBroadcaster.clients.size).toBe(0);
      expect(service.sseBroadcaster.server).toBe(null);
      expect(Array.isArray(service.sseBroadcaster.broadcastEvents)).toBe(true);
      expect(service.sseBroadcaster.broadcastEvents.length).toBeGreaterThan(10);

      // Test 8: Strategies initialized in constructor
      expect(service.strategies).toBeInstanceOf(Map);
      expect(service.strategies.size).toBe(1);
      expect(service.strategies.has('bob')).toBe(true);

      const bobStrategy = service.strategies.get('bob');
      expect(bobStrategy.type).toBe('bob');
      expect(bobStrategy.name).toBe('Baby Steps Strategy');

      // Test dependency injection (before start)
      expect(bobStrategy.vaultDataService).toBe(service.vaultDataService);
      expect(bobStrategy.eventManager).toBe(service.eventManager);
      expect(bobStrategy.provider).toBe(null);
      expect(bobStrategy.adapters).toBe(null);
      expect(bobStrategy.tokens).toBe(null);
      expect(bobStrategy.chainId).toBe(testConfig.chainId);
      expect(bobStrategy.debug).toBe(testConfig.debug);
      expect(bobStrategy.vaultLocks).toBe(service.vaultLocks);
      expect(bobStrategy.poolData).toBe(service.poolData);

      // Test strategy config loaded
      expect(bobStrategy.config).toBeDefined();
      expect(bobStrategy.config.id).toBe('bob');

      // Test strategy-specific caches initialized
      expect(bobStrategy.lastPositionCheck).toEqual({});
      expect(bobStrategy.registeredListenerKeys).toEqual({});

      // Set up event listeners before start
      let serviceStartedEvent = null;
      service.eventManager.subscribe('ServiceStarted', (data) => {
        serviceStartedEvent = data;
      });

      let initializedEvent = null;
      service.eventManager.subscribe('initialized', (data) => {
        initializedEvent = data;
      });

      let poolDataFetchedEvent = null;
      service.eventManager.subscribe('PoolDataFetched', (data) => {
        poolDataFetchedEvent = data;
      });

      // ========================================
      // PHASE 2: Service Start
      // ========================================

      await service.start();

      // Test 9: Service is now running
      expect(service.isRunning).toBe(true);
      expect(serviceStartedEvent).toBeDefined();
      expect(serviceStartedEvent.chainId).toBe(testConfig.chainId);
      expect(serviceStartedEvent.automationServiceAddress).toBe(testConfig.automationServiceAddress);
      expect(serviceStartedEvent.adaptersLoaded).toBeGreaterThan(0);
      expect(serviceStartedEvent.tokensLoaded).toBeGreaterThan(0);
      expect(serviceStartedEvent.timestamp).toBeGreaterThan(0);

      // Test 10: Provider initialization
      expect(service.provider).toBeDefined();
      expect(service.provider.constructor.name).toBe('WebSocketProvider');

      // Test 11: VaultDataService initialization event
      expect(initializedEvent).toBeDefined();
      expect(initializedEvent.chainId).toBe(testConfig.chainId);
      expect(service.vaultDataService.provider).toBe(service.provider);
      expect(service.vaultDataService.chainId).toBe(testConfig.chainId);

      // Test 12: Platform adapter initialization
      expect(service.adapters).toBeInstanceOf(Map);
      expect(service.adapters.size).toBeGreaterThan(0);
      expect(service.adapters.has('uniswapV3')).toBe(true);

      const uniswapAdapter = service.adapters.get('uniswapV3');
      expect(uniswapAdapter).toBeDefined();
      expect(uniswapAdapter.platformId).toBe('uniswapV3');
      expect(typeof uniswapAdapter.getPositions).toBe('function');

      // Test 13: VaultDataService has adapters reference
      expect(service.vaultDataService.adapters).toBe(service.adapters);
      expect(service.vaultDataService.adapters.has('uniswapV3')).toBe(true);

      // Test 14: Token configuration initialization
      expect(Object.keys(service.tokens).length).toBeGreaterThan(0);
      expect(service.tokens.USDC).toBeDefined();
      expect(service.tokens.USDC.symbol).toBe('USDC');
      expect(service.tokens.USDC.decimals).toBe(6);
      expect(service.tokens.WETH).toBeDefined();
      expect(service.tokens.WETH.decimals).toBe(18);

      // Test 15: VaultDataService has tokens reference
      expect(service.vaultDataService.tokens).toBe(service.tokens);

      // Test 16: VaultDataService has poolData reference
      expect(service.vaultDataService.poolData).toBe(service.poolData);

      // Test 17: Strategy contract initialization
      expect(service.contracts.bobStrategy).toBeDefined();
      expect(typeof service.contracts.bobStrategy.getVersion).toBe('function');
      expect(typeof service.contracts.bobStrategy.getAllParameters).toBe('function');

      // Test 17a: Strategy dependencies updated after start
      const bobStrategyAfterStart = service.strategies.get('bob');
      expect(bobStrategyAfterStart.provider).toBe(service.provider);
      expect(bobStrategyAfterStart.adapters).toBe(service.adapters);
      expect(bobStrategyAfterStart.tokens).toBe(service.tokens);
      expect(bobStrategyAfterStart.serviceConfig).toBeDefined();
      expect(bobStrategyAfterStart.serviceConfig.chainId).toBe(service.chainId);
      expect(bobStrategyAfterStart.serviceConfig.automationServiceAddress).toBe(service.automationServiceAddress);

      // Test 18: Tracker event handlers registered
      const trackerEvents = ['VaultBaselineCaptured', 'FeesCollected', 'PositionRebalanced'];
      trackerEvents.forEach(eventName => {
        expect(service.eventManager.eventHandlers[eventName]).toBeDefined();
        expect(service.eventManager.eventHandlers[eventName].length).toBeGreaterThan(0);
      });

      // Test 19: SSEBroadcaster started
      expect(service.sseBroadcaster.isRunning).toBe(true);
      expect(service.sseBroadcaster.server).not.toBe(null);
      service.sseBroadcaster.broadcastEvents.forEach(eventName => {
        expect(service.eventManager.eventHandlers[eventName]).toBeDefined();
      });

      // Test 20: Authorization event listener registered
      const authListeners = Object.keys(service.eventManager.listeners).filter(key =>
        key.includes('authorization')
      );
      expect(authListeners.length).toBeGreaterThan(0);

      const authListener = service.eventManager.listeners[authListeners[0]];
      expect(authListener.type).toBe('filter');
      expect(authListener.address).toBe('global');

      // Test 21: Strategy parameter event listener registered
      const paramListeners = Object.keys(service.eventManager.listeners).filter(key =>
        key.includes('parameter-update')
      );
      expect(paramListeners.length).toBeGreaterThan(0);

      // Test 22: Failed vault retry timer started
      expect(service.failedVaultRetryTimer).toBeDefined();

      // Test 23: Start is idempotent
      await service.start();
      expect(service.isRunning).toBe(true);

      // ========================================
      // PHASE 3: 0-Vault State Verification
      // ========================================

      // Test 24: No vaults in VaultDataService
      const allVaults = service.vaultDataService.getAllVaults();
      expect(Array.isArray(allVaults)).toBe(true);
      expect(allVaults.length).toBe(0);

      // Test 25: Empty poolData (no vaults = no pools fetched)
      expect(Object.keys(service.poolData).length).toBe(0);

      // Test 26: PoolDataFetched never emitted with 0 vaults
      expect(poolDataFetchedEvent).toBe(null);

      // Test 27: Only system listeners registered (no vault-specific)
      const listeners = service.eventManager.listeners;
      const listenerKeys = Object.keys(listeners);

      const authListenerKeys = listenerKeys.filter(k => k.includes('authorization'));
      const paramListenerKeys = listenerKeys.filter(k => k.includes('parameter-update'));

      expect(authListenerKeys.length).toBe(1);
      expect(paramListenerKeys.length).toBeGreaterThanOrEqual(1);

      // No vault-specific listeners
      const vaultListeners = listenerKeys.filter(k =>
        !k.includes('authorization') &&
        !k.includes('parameter-update') &&
        !k.includes('global')
      );
      expect(vaultListeners.length).toBe(0);

      // Test 28: Service status reflects 0-vault state
      const status = service.getStatus();
      expect(status.isRunning).toBe(true);
      expect(status.adaptersLoaded).toBeGreaterThan(0);
      expect(status.tokensLoaded).toBeGreaterThan(0);
      expect(status.poolsCached).toBe(0);
      expect(status.vaultsCached).toBe(0);
      expect(status.failedVaults).toBe(0);
      expect(status.blacklistedVaults).toBe(0);
      expect(status.sse.isRunning).toBe(true);

      // ========================================
      // PHASE 4: Blacklist and Failed Vault Management
      // ========================================

      // Test 29: Track failed vault
      const failedVaultAddress = '0x1234567890123456789012345678901234567890';
      let failedEvent = null;
      service.eventManager.subscribe('VaultLoadFailed', (data) => {
        failedEvent = data;
      });

      service.trackFailedVault(failedVaultAddress, 'Test error message');

      expect(service.failedVaults.has(failedVaultAddress)).toBe(true);
      const failedData = service.failedVaults.get(failedVaultAddress);
      expect(failedData.vaultAddress).toBe(failedVaultAddress);
      expect(failedData.lastError).toBe('Test error message');
      expect(failedData.attempts).toBe(1);
      expect(failedEvent.vaultAddress).toBe(failedVaultAddress);

      // Test 30: Increment attempts on subsequent failures
      service.trackFailedVault(failedVaultAddress, 'Error 2');
      service.trackFailedVault(failedVaultAddress, 'Error 3');
      expect(service.failedVaults.get(failedVaultAddress).attempts).toBe(3);

      // Test 31: Blacklist vault
      const blacklistAddress = '0x2222222222222222222222222222222222222222';
      let blacklistEvent = null;
      service.eventManager.subscribe('VaultBlacklisted', (data) => {
        blacklistEvent = data;
      });

      service.blacklistVault(blacklistAddress, 'Test blacklist reason');

      expect(service.isVaultBlacklisted(blacklistAddress)).toBe(true);
      expect(blacklistEvent).toBeDefined();
      expect(blacklistEvent.reason).toBe('Test blacklist reason');

      // Test 32: Unblacklist vault
      let unblacklistEvent = null;
      service.eventManager.subscribe('VaultUnblacklisted', (data) => {
        unblacklistEvent = data;
      });

      service.unblacklistVault(blacklistAddress);

      expect(service.isVaultBlacklisted(blacklistAddress)).toBe(false);
      expect(unblacklistEvent).toBeDefined();

      // Test 33: Get blacklist data
      service.blacklistVault('0x3333333333333333333333333333333333333333', 'Reason 1');
      service.blacklistVault('0x4444444444444444444444444444444444444444', 'Reason 2');
      const blacklistData = service.getBlacklistData();
      expect(Object.keys(blacklistData).length).toBe(2);

      // Test 34: Blacklist persists to disk
      await new Promise(resolve => setTimeout(resolve, 100));
      const fileContents = await fs.readFile(testBlacklistPath, 'utf-8');
      const savedBlacklist = JSON.parse(fileContents);
      expect(Object.keys(savedBlacklist).length).toBe(2);

      // ========================================
      // PHASE 5: Service Stop
      // ========================================

      // Test 35: Stop cleanly
      await service.stop();

      expect(service.isRunning).toBe(false);
      expect(service.provider).toBe(null);

      // Test 36: SSEBroadcaster stopped
      expect(service.sseBroadcaster.isRunning).toBe(false);

      // Test 37: Failed vault retry timer cleared
      expect(service.failedVaultRetryTimer).toBe(null);

      // Test 38: EventManager disabled
      expect(service.eventManager.enabled).toBe(false);

      // Test 39: Stop is idempotent
      await service.stop();
      expect(service.isRunning).toBe(false);
    });
  });
});
