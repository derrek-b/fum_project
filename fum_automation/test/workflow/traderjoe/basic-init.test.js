/**
 * @fileoverview Integration test for AutomationService initialization on Avalanche fork (Trader Joe)
 * Tests the complete service lifecycle: constructor -> start -> running state -> stop
 *
 * Mirrors test/workflow/service-init/basic-init.test.js but targets Avalanche chain (1338)
 * with Trader Joe V2.2 adapter instead of Uniswap V3/V4.
 *
 * Run with: FORK_CHAIN=avalanche npm test -- test/workflow/traderjoe/basic-init.test.js
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import AutomationService from '../../../src/core/AutomationService.js';
import { setupTestBlockchain, cleanupTestBlockchain } from '../../helpers/hardhat-setup.js';
import fs from 'fs/promises';

describe('AutomationService Initialization - Trader Joe V2.2 / Avalanche (0 Vaults)', () => {
  let testEnv;
  let testConfig;
  let service;

  // Event capture
  let serviceStartedEvent = null;
  let initializedEvent = null;
  let poolDataFetchedEvent = null;

  beforeAll(async () => {
    testEnv = await setupTestBlockchain();
    testConfig = testEnv.testConfig;
  });

  afterAll(async () => {
    if (service && service.isRunning) {
      await service.stop();
    }
    await cleanupTestBlockchain(testEnv);
  });

  describe('Constructor Validation', () => {
    it('should throw error for missing automationServiceAddress', () => {
      expect(() => new AutomationService({
        chainId: 1338,
        wsUrl: 'ws://localhost:8546'
      })).toThrow('automationServiceAddress is required');
    });

    it('should throw error for invalid automationServiceAddress', () => {
      expect(() => new AutomationService({
        automationServiceAddress: 'not-an-address',
        chainId: 1338,
        wsUrl: 'ws://localhost:8546'
      })).toThrow('automationServiceAddress must be a valid Ethereum address');
    });

    it('should throw error for missing chainId', () => {
      expect(() => new AutomationService({
        automationServiceAddress: '0xabA472B2EA519490EE10E643A422D578a507197A',
        wsUrl: 'ws://localhost:8546'
      })).toThrow('chainId is required');
    });

    it('should throw error for invalid chainId', () => {
      expect(() => new AutomationService({
        automationServiceAddress: '0xabA472B2EA519490EE10E643A422D578a507197A',
        chainId: -1,
        wsUrl: 'ws://localhost:8546'
      })).toThrow('chainId must be a positive number');
    });

    it('should throw error for missing wsUrl', () => {
      expect(() => new AutomationService({
        automationServiceAddress: '0xabA472B2EA519490EE10E643A422D578a507197A',
        chainId: 1338
      })).toThrow('wsUrl is required');
    });

    it('should throw error for invalid wsUrl', () => {
      expect(() => new AutomationService({
        automationServiceAddress: '0xabA472B2EA519490EE10E643A422D578a507197A',
        chainId: 1338,
        wsUrl: 'http://localhost:8546'
      })).toThrow('wsUrl must be a valid WebSocket URL');
    });

    it('should use default values for optional config', () => {
      const svc = new AutomationService({
        automationServiceAddress: '0xabA472B2EA519490EE10E643A422D578a507197A',
        chainId: 1338,
        wsUrl: 'ws://localhost:8546'
      });

      expect(svc.debug).toBe(false);
      expect(svc.ssePort).toBe(3001);
      expect(svc.retryIntervalMs).toBe(300000);
      expect(svc.maxFailureDurationMs).toBe(3600000);
    });

    it('should update poolData when PoolDataFetched event is emitted', () => {
      const svc = new AutomationService({
        automationServiceAddress: '0xabA472B2EA519490EE10E643A422D578a507197A',
        chainId: 1338,
        wsUrl: 'ws://localhost:8546'
      });

      const testPoolData = {
        '0x864d4e5ee7318e97483db7eb0912e09f161516ea': {
          tokenXSymbol: 'WAVAX',
          tokenYSymbol: 'USDC',
          binStep: 10
        }
      };

      svc.eventManager.emit('PoolDataFetched', { poolData: testPoolData });

      expect(svc.poolData['0x864d4e5ee7318e97483db7eb0912e09f161516ea']).toBeDefined();
      expect(svc.poolData['0x864d4e5ee7318e97483db7eb0912e09f161516ea'].tokenXSymbol).toBe('WAVAX');
    });
  });

  describe('Phase 1: Pre-Start State', () => {
    it('should create service with correct configuration', () => {
      service = new AutomationService(testConfig);

      expect(service.automationServiceAddress).toBe(testConfig.automationServiceAddress);
      expect(service.chainId).toBe(testConfig.chainId);
      expect(service.wsUrl).toBe(testConfig.wsUrl);
      expect(service.debug).toBe(testConfig.debug);
    });

    it('should have correct initial service state', () => {
      expect(service.isRunning).toBe(false);
      expect(service.provider).toBe(null);
      expect(service.contracts).toEqual({});
    });

    it('should initialize data structures correctly', () => {
      expect(service.vaultLocks).toEqual({});
      expect(service.adapters).toBeInstanceOf(Map);
      expect(service.adapters.size).toBe(0);
      expect(service.tokens).toEqual({});
      expect(service.poolData).toEqual({});
    });

    it('should initialize EventManager correctly', () => {
      expect(service.eventManager).toBeDefined();
      expect(typeof service.eventManager.setDebug).toBe('function');
      expect(typeof service.eventManager.registerContractListener).toBe('function');
      expect(service.eventManager.listeners).toEqual({});
      expect(service.eventManager.debug).toBe(testConfig.debug);
      expect(service.eventManager.enabled).toBe(true);
    });

    it('should initialize VaultDataService correctly', () => {
      expect(service.vaultDataService).toBeDefined();
      // vaults is private (#vaults), verify via public methods
      expect(service.vaultDataService._getCacheSizeForTesting()).toBe(0);
      expect(service.vaultDataService.getAllVaults()).toEqual([]);
      expect(service.vaultDataService.eventManager).toBe(service.eventManager);
      expect(service.vaultDataService.provider).toBe(null);
      expect(service.vaultDataService.chainId).toBe(null);
    });

    it('should initialize Tracker correctly', () => {
      expect(service.tracker).toBeDefined();
      expect(service.tracker.vaultMetadata).toBeInstanceOf(Map);
      expect(service.tracker.vaultMetadata.size).toBe(0);
      expect(service.tracker.eventManager).toBe(service.eventManager);
      expect(service.tracker.vaultDataDir).toContain('vaults');
      expect(service.tracker.debug).toBe(testConfig.debug);
    });

    it('should initialize SSEBroadcaster correctly', () => {
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
    });

    it('should initialize strategies with correct dependencies', () => {
      expect(service.strategies).toBeInstanceOf(Map);
      expect(service.strategies.size).toBe(1);
      expect(service.strategies.has('bob')).toBe(true);

      const bobStrategy = service.strategies.get('bob');
      expect(bobStrategy.type).toBe('bob');
      expect(bobStrategy.name).toBe('Baby Steps Strategy');

      // Dependency injection (before start)
      expect(bobStrategy.vaultDataService).toBe(service.vaultDataService);
      expect(bobStrategy.eventManager).toBe(service.eventManager);
      expect(bobStrategy.provider).toBe(null);
      expect(bobStrategy.adapters).toBe(null);
      expect(bobStrategy.tokens).toBe(null);
      expect(bobStrategy.chainId).toBe(testConfig.chainId);
      expect(bobStrategy.debug).toBe(testConfig.debug);
      expect(bobStrategy.vaultLocks).toBe(service.vaultLocks);
      expect(bobStrategy.poolData).toBe(service.poolData);

      // Strategy config loaded
      expect(bobStrategy.config).toBeDefined();
      expect(bobStrategy.config.id).toBe('bob');

      // Strategy-specific caches initialized
      expect(bobStrategy.registeredListenerKeys).toEqual({});
    });
  });

  describe('Phase 2: Service Start', () => {
    it('should start service successfully', async () => {
      // Set up event listeners before start
      service.eventManager.subscribe('ServiceStarted', (data) => {
        serviceStartedEvent = data;
      });
      service.eventManager.subscribe('initialized', (data) => {
        initializedEvent = data;
      });
      service.eventManager.subscribe('PoolDataFetched', (data) => {
        poolDataFetchedEvent = data;
      });

      await service.start();

      expect(service.isRunning).toBe(true);
      expect(serviceStartedEvent).toBeDefined();
      expect(serviceStartedEvent.chainId).toBe(testConfig.chainId);
      expect(serviceStartedEvent.automationServiceAddress).toBe(testConfig.automationServiceAddress);
      expect(serviceStartedEvent.adaptersLoaded).toBeGreaterThan(0);
      expect(serviceStartedEvent.tokensLoaded).toBeGreaterThan(0);
      expect(serviceStartedEvent.timestamp).toBeGreaterThan(0);
    });

    it('should initialize provider correctly', () => {
      expect(service.provider).toBeDefined();
      expect(service.provider.constructor.name).toBe('WebSocketProvider');
    });

    it('should emit VaultDataService initialized event', () => {
      expect(initializedEvent).toBeDefined();
      expect(initializedEvent.chainId).toBe(testConfig.chainId);
      expect(service.vaultDataService.provider).toBe(service.provider);
      expect(service.vaultDataService.chainId).toBe(testConfig.chainId);
    });

    it('should initialize Trader Joe V2.2 adapter', () => {
      expect(service.adapters).toBeInstanceOf(Map);
      expect(service.adapters.size).toBe(1); // Only TJ on Avalanche
      expect(service.adapters.has('traderjoeV2_2')).toBe(true);

      const tjAdapter = service.adapters.get('traderjoeV2_2');
      expect(tjAdapter).toBeDefined();
      expect(tjAdapter.platformId).toBe('traderjoeV2_2');
      expect(typeof tjAdapter.getPositionsForVDS).toBe('function');
    });

    it('should share adapters with VaultDataService', () => {
      expect(service.vaultDataService.adapters).toBe(service.adapters);
      expect(service.vaultDataService.adapters.has('traderjoeV2_2')).toBe(true);
    });

    it('should initialize token configuration', () => {
      expect(Object.keys(service.tokens).length).toBeGreaterThan(0);
      expect(service.tokens.USDC).toBeDefined();
      expect(service.tokens.USDC.symbol).toBe('USDC');
      expect(service.tokens.USDC.decimals).toBe(6);
      expect(service.tokens.AVAX).toBeDefined();
      expect(service.tokens.AVAX.decimals).toBe(18);
    });

    it('should share tokens with VaultDataService', () => {
      expect(service.vaultDataService.tokens).toBe(service.tokens);
    });

    it('should share poolData with VaultDataService', () => {
      expect(service.vaultDataService.poolData).toBe(service.poolData);
    });

    it('should inject dependencies into EventManager after start', () => {
      // Verify EventManager dependency injection
      expect(service.eventManager.poolData).toBeDefined();
      expect(typeof service.eventManager.poolData).toBe('object');
      expect(service.eventManager.poolData).toBe(service.poolData); // Same reference

      expect(service.eventManager.adapters).toBeDefined();
      expect(service.eventManager.adapters).toBeInstanceOf(Map);
      expect(service.eventManager.adapters).toBe(service.adapters); // Same reference
      expect(service.eventManager.adapters.size).toBe(1); // Only TJ
      expect(service.eventManager.adapters.has('traderjoeV2_2')).toBe(true);

      expect(service.eventManager.vaultDataService).toBeDefined();
      expect(service.eventManager.vaultDataService).toBe(service.vaultDataService); // Same reference
    });

    it('should initialize strategy contracts', () => {
      expect(service.contracts.bobStrategy).toBeDefined();
      expect(typeof service.contracts.bobStrategy.getVersion).toBe('function');
      expect(typeof service.contracts.bobStrategy.getAllParameters).toBe('function');
    });

    it('should update strategy dependencies after start', () => {
      const bobStrategy = service.strategies.get('bob');
      expect(bobStrategy.provider).toBe(service.provider);
      expect(bobStrategy.adapters).toBe(service.adapters);
      expect(bobStrategy.tokens).toBe(service.tokens);
      expect(bobStrategy.serviceConfig).toBeDefined();
      expect(bobStrategy.serviceConfig.chainId).toBe(service.chainId);
      expect(bobStrategy.serviceConfig.automationServiceAddress).toBe(service.automationServiceAddress);
    });

    it('should register Tracker event handlers', () => {
      const trackerEvents = ['VaultBaselineCaptured', 'FeesCollected', 'PositionRebalanced'];
      trackerEvents.forEach(eventName => {
        expect(service.eventManager.eventHandlers[eventName]).toBeDefined();
        expect(service.eventManager.eventHandlers[eventName].length).toBeGreaterThan(0);
      });
    });

    it('should start SSEBroadcaster', () => {
      expect(service.sseBroadcaster.isRunning).toBe(true);
      expect(service.sseBroadcaster.server).not.toBe(null);
      service.sseBroadcaster.broadcastEvents.forEach(eventName => {
        expect(service.eventManager.eventHandlers[eventName]).toBeDefined();
      });
    });

    it('should register authorization event listener', () => {
      const authListeners = Object.keys(service.eventManager.listeners).filter(key =>
        key.includes('authorization')
      );
      expect(authListeners.length).toBeGreaterThan(0);

      const authListener = service.eventManager.listeners[authListeners[0]];
      expect(authListener.type).toBe('filter');
      expect(authListener.address).toBe('global');
    });

    it('should register strategy parameter event listener', () => {
      const paramListeners = Object.keys(service.eventManager.listeners).filter(key =>
        key.includes('parameter-update')
      );
      expect(paramListeners.length).toBeGreaterThan(0);
    });

    it('should start failed vault retry timer', () => {
      expect(service.failedVaultRetryTimer).toBeDefined();
    });

    it('should be idempotent (start twice is safe)', async () => {
      await service.start();
      expect(service.isRunning).toBe(true);
    });
  });

  describe('Phase 3: 0-Vault State Verification', () => {
    it('should have no vaults in VaultDataService', () => {
      const allVaults = service.vaultDataService.getAllVaults();
      expect(Array.isArray(allVaults)).toBe(true);
      expect(allVaults.length).toBe(0);
    });

    it('should have empty poolData (no vaults = no pools)', () => {
      expect(Object.keys(service.poolData).length).toBe(0);
    });

    it('should not emit PoolDataFetched with 0 vaults', () => {
      expect(poolDataFetchedEvent).toBe(null);
    });

    it('should only have system listeners registered', () => {
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
        !k.includes('template-selected') &&
        !k.includes('global')
      );
      expect(vaultListeners.length).toBe(0);
    });

    it('should report correct status for 0-vault state', () => {
      const status = service.getStatus();
      expect(status.isRunning).toBe(true);
      expect(status.adaptersLoaded).toBeGreaterThan(0);
      expect(status.tokensLoaded).toBeGreaterThan(0);
      expect(status.poolsCached).toBe(0);
      expect(status.vaultsCached).toBe(0);
      expect(status.failedVaults).toBe(0);
      expect(status.blacklistedVaults).toBe(0);
      expect(status.sse.isRunning).toBe(true);
    });
  });

  describe('Phase 4: Blacklist and Failed Vault Management', () => {
    it('should track failed vault and emit event', async () => {
      const failedVaultAddress = '0x1234567890123456789012345678901234567890';
      let failedEvent = null;
      service.eventManager.subscribe('VaultFailed', (data) => {
        failedEvent = data;
      });

      await service.trackFailedVault(failedVaultAddress, 'Test error message');

      expect(service.failedVaults.has(failedVaultAddress)).toBe(true);
      const failedData = service.failedVaults.get(failedVaultAddress);
      expect(failedData.vaultAddress).toBe(failedVaultAddress);
      expect(failedData.lastError).toBe('Test error message');
      expect(failedData.attempts).toBe(1);
      expect(failedEvent.vaultAddress).toBe(failedVaultAddress);
    });

    it('should increment attempts on subsequent failures', async () => {
      const failedVaultAddress = '0x1234567890123456789012345678901234567890';
      await service.trackFailedVault(failedVaultAddress, 'Error 2');
      await service.trackFailedVault(failedVaultAddress, 'Error 3');
      expect(service.failedVaults.get(failedVaultAddress).attempts).toBe(3);
    });

    it('should blacklist vault and emit event', async () => {
      const blacklistAddress = '0x2222222222222222222222222222222222222222';
      let blacklistEvent = null;
      service.eventManager.subscribe('VaultBlacklisted', (data) => {
        blacklistEvent = data;
      });

      await service.blacklistVault(blacklistAddress, 'Test blacklist reason');

      expect(service.isVaultBlacklisted(blacklistAddress)).toBe(true);
      expect(blacklistEvent).toBeDefined();
      expect(blacklistEvent.reason).toBe('Test blacklist reason');
    });

    it('should unblacklist vault and emit event', async () => {
      const blacklistAddress = '0x2222222222222222222222222222222222222222';
      let unblacklistEvent = null;
      service.eventManager.subscribe('VaultUnblacklisted', (data) => {
        unblacklistEvent = data;
      });

      await service.unblacklistVault(blacklistAddress);

      expect(service.isVaultBlacklisted(blacklistAddress)).toBe(false);
      expect(unblacklistEvent).toBeDefined();
    });

    it('should return blacklist data', async () => {
      await service.blacklistVault('0x3333333333333333333333333333333333333333', 'Reason 1');
      await service.blacklistVault('0x4444444444444444444444444444444444444444', 'Reason 2');
      const blacklistData = service.getBlacklistData();
      expect(Object.keys(blacklistData).length).toBe(2);
    });

    it('should persist blacklist to disk', async () => {
      const fileContents = await fs.readFile(service.blacklistFilePath, 'utf-8');
      const savedBlacklist = JSON.parse(fileContents);
      expect(Object.keys(savedBlacklist).length).toBe(2);
    });
  });

  describe('Phase 5: Service Stop', () => {
    it('should stop service cleanly', async () => {
      await service.stop();

      expect(service.isRunning).toBe(false);
      expect(service.provider).toBe(null);
    });

    it('should stop SSEBroadcaster', () => {
      expect(service.sseBroadcaster.isRunning).toBe(false);
    });

    it('should clear failed vault retry timer', () => {
      expect(service.failedVaultRetryTimer).toBe(null);
    });

    it('should disable EventManager', () => {
      expect(service.eventManager.enabled).toBe(false);
    });

    it('should be idempotent (stop twice is safe)', async () => {
      await service.stop();
      expect(service.isRunning).toBe(false);
    });
  });
});
