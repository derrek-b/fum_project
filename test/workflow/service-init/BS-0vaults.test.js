/**
 * @fileoverview Integration test for AutomationService initialization with 0 pre-existing vaults
 * Tests constructor validation, property assignment, and service component setup up to poolData initialization
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import AutomationService from '../../../src/AutomationService.js';
import { setupTestBlockchain, cleanupTestBlockchain } from '../../helpers/ganache-setup.js';

describe('AutomationService Initialization - 0 Pre-Existing Vaults', () => {
  let testEnv;

  beforeAll(async () => {
    testEnv = await setupTestBlockchain({ port: 8545 });
  });

  afterAll(async () => {
    await cleanupTestBlockchain(testEnv);
  });

  describe('Success Case - Complete Constructor Flow (0 Pre-Existing Vaults)', () => {
    it('should successfully validate config and initialize all service components', async () => {
      // Create AutomationService instance (tests 1-8)
      const service = new AutomationService(testEnv.testConfig);

      // Test 1: Configuration validation and property assignment
      expect(service.automationServiceAddress).toBe(testEnv.testConfig.automationServiceAddress);
      expect(service.chainId).toBe(testEnv.testConfig.chainId);
      expect(service.wsUrl).toBe(testEnv.testConfig.wsUrl);
      expect(service.debug).toBe(testEnv.testConfig.debug);

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

      // Test 5: EventManager data structure initialization
      expect(service.eventManager.listeners).toEqual({});

      // Verify event handlers are registered during construction (new event-driven architecture)
      expect(Object.keys(service.eventManager.eventHandlers)).toEqual([
        "NewPositionCreated",
        "InitialPositionsEvaluated",
        "VaultAuthGranted",
        "VaultAuthRevoked",
        "VaultUnrecoverable",
        "PositionRebalanced",
        "TargetTokensUpdated",
        "TargetPlatformsUpdated",
        "StrategyParameterUpdated",
        "SwapEventDetected",
      ]);
      expect(service.eventManager.eventHandlers['VaultAuthGranted']).toHaveLength(1);
      expect(service.eventManager.eventHandlers['VaultAuthRevoked']).toHaveLength(1);
      expect(service.eventManager.eventHandlers['TargetTokensUpdated']).toHaveLength(1);
      expect(service.eventManager.eventHandlers['TargetPlatformsUpdated']).toHaveLength(1);
      expect(service.eventManager.eventHandlers['StrategyParameterUpdated']).toHaveLength(1);

      expect(service.eventManager.debug).toBe(true); // Should match config.debug
      expect(service.eventManager.enabled).toBe(true);
      expect(service.eventManager.isCleaningUp).toBe(false);

      // Test 6: VaultDataService constructor and initialization
      expect(service.vaultDataService).toBeDefined();
      expect(service.vaultDataService.vaults).toBeInstanceOf(Map);
      expect(service.vaultDataService.vaults.size).toBe(0);
      expect(service.vaultDataService.eventManager).toBe(service.eventManager); // Same reference
      expect(service.vaultDataService.provider).toBe(null);
      expect(service.vaultDataService.chainId).toBe(null);
      expect(service.vaultDataService.lastRefreshTime).toBe(null);

      // Test 6a: Tracker constructor and initialization
      expect(service.tracker).toBeDefined();
      expect(service.tracker.vaultMetadata).toBeInstanceOf(Map);
      expect(service.tracker.vaultMetadata.size).toBe(0);
      expect(service.tracker.eventManager).toBe(service.eventManager); // Same reference
      expect(typeof service.tracker.dataDir).toBe('string');
      expect(service.tracker.dataDir).toContain('vaults'); // Should contain 'vaults' directory
      expect(service.tracker.debug).toBe(testEnv.testConfig.debug);

      // Test 6b: SSEBroadcaster constructor and initialization
      expect(service.sseBroadcaster).toBeDefined();
      expect(service.sseBroadcaster.eventManager).toBe(service.eventManager); // Same reference
      expect(service.sseBroadcaster.port).toBe(testEnv.testConfig.ssePort); // Port from config
      expect(service.sseBroadcaster.debug).toBe(testEnv.testConfig.debug);
      expect(service.sseBroadcaster.isRunning).toBe(false); // Not started yet
      expect(service.sseBroadcaster.clients).toBeInstanceOf(Set);
      expect(service.sseBroadcaster.clients.size).toBe(0);
      expect(service.sseBroadcaster.server).toBe(null); // Not started yet
      expect(Array.isArray(service.sseBroadcaster.broadcastEvents)).toBe(true);
      expect(service.sseBroadcaster.broadcastEvents.length).toBeGreaterThan(10); // Should have 15+ events

      // Test 7: Strategy constructor and initialization with dependency injection
      expect(service.strategies).toBeDefined();
      expect(service.strategies.bob).toBeDefined();
      expect(service.strategies.bob.name).toBe('Baby Steps Strategy');
      expect(service.strategies.bob.type).toBe('bob');

      // Test dependency injection - strategy should have individual dependencies
      expect(service.strategies.bob.vaultDataService).toBe(service.vaultDataService);
      expect(service.strategies.bob.eventManager).toBe(service.eventManager);
      expect(service.strategies.bob.provider).toBe(null); // Will be set during initialization
      expect(service.strategies.bob.debug).toBe(true);
      expect(service.strategies.bob.chainId).toBe(testEnv.testConfig.chainId);
      expect(service.strategies.bob.vaultLocks).toBe(service.vaultLocks);
      expect(service.strategies.bob.poolData).toBe(service.poolData);
      expect(service.strategies.bob.adapters).toBe(null); // Will be set during initialization
      expect(service.strategies.bob.tokens).toBe(null); // Will be set during initialization
      expect(typeof service.strategies.bob.sendTelegramMessage).toBe('function');

      // Test strategy-specific initialization (strategy's own config from getStrategyDetails)
      expect(service.strategies.bob.config).toBeDefined(); // This is BSS's own strategy config
      expect(service.strategies.bob.lastPositionCheck).toEqual({});
      expect(service.strategies.bob.registeredListenerKeys).toEqual({});
      expect(service.strategies.bob.config.id).toBe('bob');
      expect(service.strategies.bob.config.name).toBe('Baby Steps');
      expect(service.strategies.bob.config.maxTokens).toBe(2);
      expect(service.strategies.bob.config.maxPlatforms).toBe(1);
      expect(service.strategies.bob.config.parameters.targetRangeUpper.defaultValue).toBe(5.0);
      expect(service.strategies.bob.config.parameters.feeReinvestment.defaultValue).toBe(true);

      // Test 8: VaultRegistry has been removed (functionality moved to EventManager)



      // Set up event listener to test VaultDataService 'initialized' event emission
      let initializedEventData = null;
      service.eventManager.subscribe('initialized', (data) => {
        initializedEventData = data;
      });

      // Set up event listener to test that PoolDataFetched is never emitted with 0 vaults
      let poolDataFetchedEventData = null;
      service.eventManager.subscribe('PoolDataFetched', (data) => {
        poolDataFetchedEventData = data;
      });

      // Set up event listener to test ParameterMonitoringRegistered event
      let parameterMonitoringEventData = null;
      service.eventManager.subscribe('ParameterMonitoringRegistered', (data) => {
        parameterMonitoringEventData = data;
      });

      // Call start - uses library configuration for contract addresses (tests 9-?)
      await service.start();

      // Test 9: Provider sharing after initialization
      expect(service.provider).toBeDefined();
      expect(service.provider.constructor.name).toBe('WebSocketProvider');

      // Test provider sharing with strategies
      expect(service.strategies.bob.provider).toBe(service.provider);

      // Test other dependency sharing with strategies after initialization
      expect(service.strategies.bob.adapters).toBe(service.adapters);
      expect(service.strategies.bob.tokens).toBe(service.tokens);
      expect(service.strategies.bob.serviceConfig).toBeDefined();
      expect(service.strategies.bob.serviceConfig.chainId).toBe(service.chainId);
      expect(service.strategies.bob.serviceConfig.automationServiceAddress).toBe(service.automationServiceAddress);
      expect(service.strategies.bob.serviceConfig.wsUrl).toBe(service.wsUrl);
      expect(service.strategies.bob.serviceConfig.debug).toBe(service.debug);

      // Test 10: ParameterMonitoringRegistered event
      expect(parameterMonitoringEventData).toBeDefined();
      expect(parameterMonitoringEventData.chainId).toBe(service.chainId);
      expect(parameterMonitoringEventData.strategyAddresses).toHaveLength(1);
      expect(parameterMonitoringEventData.strategyAddresses).toContain(service.contracts.bobStrategy.address);
      expect(parameterMonitoringEventData.listenersRegistered).toEqual(['ParameterUpdated']);
      expect(parameterMonitoringEventData.timestamp).toBeGreaterThan(0);

      // Test 11: VaultDataService initialization state and event emission
      expect(service.vaultDataService.provider).toBe(service.provider);
      expect(service.vaultDataService.chainId).toBe(testEnv.testConfig.chainId);

      // Test that 'initialized' event was emitted with correct data
      expect(initializedEventData).toBeDefined();
      expect(initializedEventData.chainId).toBe(testEnv.testConfig.chainId);

      // Test 11a: Tracker initialization state after service.start()
      // Tracker should have been initialized and loaded existing vault metadata (0 vaults in this test)
      expect(service.tracker.vaultMetadata).toBeInstanceOf(Map);
      expect(service.tracker.vaultMetadata.size).toBe(0); // No existing vaults on startup
      expect(service.tracker.eventManager).toBe(service.eventManager); // Same reference maintained
      expect(service.tracker.debug).toBe(testEnv.testConfig.debug);

      // Test 11b: Verify Tracker event handler registration
      // Tracker should have subscribed to tracking-related events
      const trackerEvents = ['VaultBaselineCaptured', 'FeesCollected', 'PositionRebalanced', 'TokensSwapped', 'PositionsClosed', 'NewPositionCreated', 'LiquidityAddedToPosition'];
      trackerEvents.forEach(eventName => {
        expect(service.eventManager.eventHandlers[eventName]).toBeDefined();
        expect(Array.isArray(service.eventManager.eventHandlers[eventName])).toBe(true);
        expect(service.eventManager.eventHandlers[eventName].length).toBeGreaterThan(0);
        expect(typeof service.eventManager.eventHandlers[eventName][0]).toBe('function');
      });

      // Test 11c: SSEBroadcaster post-start state
      expect(service.sseBroadcaster.isRunning).toBe(true);
      expect(service.sseBroadcaster.server).not.toBe(null);
      expect(service.sseBroadcaster.clients.size).toBe(0); // No clients connected yet

      // Verify SSEBroadcaster subscribed to broadcast events
      const sseBroadcastEvents = service.sseBroadcaster.broadcastEvents;
      expect(sseBroadcastEvents).toContain('ServiceStarted');
      expect(sseBroadcastEvents).toContain('NewPositionCreated');
      expect(sseBroadcastEvents).toContain('PositionRebalanced');
      expect(sseBroadcastEvents).toContain('FeesCollected');
      expect(sseBroadcastEvents).toContain('VaultUnrecoverable');
      expect(sseBroadcastEvents).toContain('MonitoringStarted');

      // Verify SSEBroadcaster registered event handlers for all broadcast events
      sseBroadcastEvents.forEach(eventName => {
        expect(service.eventManager.eventHandlers[eventName]).toBeDefined();
        expect(Array.isArray(service.eventManager.eventHandlers[eventName])).toBe(true);
        expect(service.eventManager.eventHandlers[eventName].length).toBeGreaterThan(0);
      });

      // Verify SSEBroadcaster has unsubscribe functions stored for cleanup
      expect(Array.isArray(service.sseBroadcaster.unsubscribeFunctions)).toBe(true);
      expect(service.sseBroadcaster.unsubscribeFunctions.length).toBe(sseBroadcastEvents.length);

      // Test 10a: Verify PoolDataFetched event handling (0 vaults scenario)
      // First verify AutomationService is properly subscribed to the event
      expect(service.eventManager.eventHandlers['PoolDataFetched']).toBeDefined();
      expect(Array.isArray(service.eventManager.eventHandlers['PoolDataFetched'])).toBe(true);
      expect(service.eventManager.eventHandlers['PoolDataFetched'].length).toBeGreaterThan(0);
      expect(typeof service.eventManager.eventHandlers['PoolDataFetched'][0]).toBe('function');

      // With no authorized vaults discovered, no position data is loaded, so PoolDataFetched should never be triggered
      expect(poolDataFetchedEventData).toBe(null);

      // Test 11: Platform adapter initialization
      expect(service.adapters).toBeInstanceOf(Map);
      expect(service.adapters.size).toBe(1);
      expect(service.adapters.has('uniswapV3')).toBe(true); // Should have UniswapV3 adapter

      const uniswapAdapter = service.adapters.get('uniswapV3');
      expect(uniswapAdapter).toBeDefined();
      expect(uniswapAdapter.platformId).toBe('uniswapV3');
      expect(typeof uniswapAdapter.getPositions).toBe('function');
      expect(uniswapAdapter.alphaRouter).toBeDefined(); // Should have AlphaRouter initialized

      // Test adapter provider and AlphaRouter configuration based on chainId
      if (service.chainId === 1337) {
        // Test chain: adapter uses local provider, AlphaRouter uses real Arbitrum
        expect(uniswapAdapter.alphaRouter.chainId).toBe(42161); // AlphaRouter uses Arbitrum chainId
        expect(uniswapAdapter.alphaRouter.provider).not.toBe(service.provider); // AlphaRouter uses different provider
      } else {
        // Real chain: both adapter and AlphaRouter use same provider and chainId
        expect(uniswapAdapter.alphaRouter.chainId).toBe(service.chainId); // AlphaRouter uses same chainId
        expect(uniswapAdapter.alphaRouter.provider).toBe(service.provider); // AlphaRouter uses same provider
      }

      expect(uniswapAdapter.provider).toBe(service.provider); // Adapter uses service provider

      // Test 11a: Verify adapter cache was passed to VaultDataService
      expect(service.vaultDataService.adapters).toBeDefined();
      expect(service.vaultDataService.adapters).toBeInstanceOf(Map);
      expect(service.vaultDataService.adapters).toBe(service.adapters); // Same reference
      expect(service.vaultDataService.adapters.size).toBe(1);
      expect(service.vaultDataService.adapters.has('uniswapV3')).toBe(true);

      // Verify VDS has access to the same adapter instance
      const vdsUniswapAdapter = service.vaultDataService.adapters.get('uniswapV3');
      expect(vdsUniswapAdapter).toBe(uniswapAdapter); // Same instance reference
      expect(typeof vdsUniswapAdapter.getPositionsForVDS).toBe('function');

      // Test 11b: Verify pool data cache was passed to VaultDataService
      expect(service.vaultDataService.poolData).toBeDefined();
      expect(typeof service.vaultDataService.poolData).toBe('object');
      expect(service.vaultDataService.poolData).toBe(service.poolData); // Same reference
      expect(Object.keys(service.vaultDataService.poolData)).toEqual([]);

      // Test 11c: Verify tokens configuration was passed to VaultDataService
      expect(service.vaultDataService.tokens).toBeDefined();
      expect(typeof service.vaultDataService.tokens).toBe('object');
      expect(service.vaultDataService.tokens).toBe(service.tokens); // Same reference
      expect(Object.keys(service.vaultDataService.tokens).length).toBe(5); // Should have all 5 tokens

      // Test 11d: Verify EventManager dependency injection (same pattern as VaultDataService)
      expect(service.eventManager.poolData).toBeDefined();
      expect(typeof service.eventManager.poolData).toBe('object');
      expect(service.eventManager.poolData).toBe(service.poolData); // Same reference
      expect(Object.keys(service.eventManager.poolData)).toEqual([]);

      expect(service.eventManager.adapters).toBeDefined();
      expect(service.eventManager.adapters).toBeInstanceOf(Map);
      expect(service.eventManager.adapters).toBe(service.adapters); // Same reference
      expect(service.eventManager.adapters.size).toBe(1);
      expect(service.eventManager.adapters.has('uniswapV3')).toBe(true);

      expect(service.eventManager.vaultDataService).toBeDefined();
      expect(service.eventManager.vaultDataService).toBe(service.vaultDataService); // Same reference

      // Test 12: Token configuration initialization
      expect(typeof service.tokens).toBe('object');
      expect(Object.keys(service.tokens).length).toBe(5); // Should have all 5 tokens for chain 1337

      // Test that all expected tokens exist
      expect(service.tokens.USDC).toBeDefined();
      expect(service.tokens['USD₮0']).toBeDefined();
      expect(service.tokens.WETH).toBeDefined();
      expect(service.tokens.WBTC).toBeDefined();
      expect(service.tokens.LINK).toBeDefined();

      // Test USDC token structure and specific data
      const usdcToken = service.tokens.USDC;
      expect(usdcToken.symbol).toBe('USDC');
      expect(usdcToken.name).toBe('USD Coin');
      expect(usdcToken.decimals).toBe(6);
      expect(typeof usdcToken.address).toBe('string');
      expect(usdcToken.address).toMatch(/^0x[a-fA-F0-9]{40}$/); // Valid Ethereum address format

      // Test WETH token has different decimals (18)
      expect(service.tokens.WETH.decimals).toBe(18);
      expect(service.tokens.WETH.name).toBe('Wrapped Ether');

      // Test WBTC token (8 decimals)
      expect(service.tokens.WBTC.decimals).toBe(8);
      expect(service.tokens.WBTC.name).toBe('Wrapped BTC');

      // Test 13: VDS Event Subscriptions Setup
      // Verify that comprehensive event logging was set up for all VDS events
      const vdsEvents = service.vaultDataService.getAvailableEvents();
      expect(vdsEvents.length).toBeGreaterThan(20); // Should have 26+ events

      // Test that EventManager has handlers for VDS events
      const eventHandlers = service.eventManager.eventHandlers;

      // Check that key events have subscribers
      const keyEvents = ['vaultLoaded', 'vaultLoadError', 'positionsRefreshed'];
      keyEvents.forEach(eventName => {
        expect(eventHandlers[eventName]).toBeDefined();
        expect(Array.isArray(eventHandlers[eventName])).toBe(true);
        expect(eventHandlers[eventName].length).toBeGreaterThan(0);
      });

      // Test that error events have subscribers
      const errorEvents = vdsEvents.filter(event => event.includes('Error'));
      expect(errorEvents.length).toBeGreaterThan(5); // Should have multiple error events
      errorEvents.forEach(eventName => {
        expect(eventHandlers[eventName]).toBeDefined();
        expect(eventHandlers[eventName].length).toBeGreaterThan(0);
      });

      // Test total number of event subscriptions matches available events
      const subscribedEvents = Object.keys(eventHandlers).filter(event =>
        vdsEvents.includes(event) && eventHandlers[event].length > 0
      );
      expect(subscribedEvents.length).toBe(vdsEvents.length);

      // Test 14: Comprehensive Contract Initialization
      // Test contracts object structure
      expect(service.contracts).toBeDefined();
      expect(typeof service.contracts).toBe('object');
      expect(Object.keys(service.contracts).length).toBe(2); // factory + bobStrategy

      // Test VaultFactory contract
      expect(service.contracts.factory).toBeDefined();
      expect(service.contracts.factory.address).toBe(testEnv.deployedContracts.VaultFactory);
      expect(typeof service.contracts.factory.createVault).toBe('function');
      expect(typeof service.contracts.factory.getVaults).toBe('function');
      expect(typeof service.contracts.factory.getVaultInfo).toBe('function');
      expect(typeof service.contracts.factory.getVaultCount).toBe('function');
      expect(typeof service.contracts.factory.getTotalVaultCount).toBe('function');
      expect(typeof service.contracts.factory.isVault).toBe('function');

      // Verify factory functionality
      const totalVaultCount = await service.contracts.factory.getTotalVaultCount();
      expect(totalVaultCount.toNumber()).toBe(0);

      // Test BabyStepsStrategy contract
      expect(service.contracts.bobStrategy).toBeDefined();
      expect(service.contracts.bobStrategy.address).toBe(testEnv.deployedContracts.BabyStepsStrategy);
      expect(typeof service.contracts.bobStrategy.getVersion).toBe('function');
      expect(typeof service.contracts.bobStrategy.authorizeVault).toBe('function');
      expect(typeof service.contracts.bobStrategy.getAllParameters).toBe('function');

      // Test special case: Registry has been removed (functionality moved to EventManager)

      // Test 15: Authorization Event Listener Creation
      // Verify that authorization event listeners were properly registered during init
      const eventListeners = service.eventManager.listeners;

      // Should have authorization event listeners for the factory contract
      const authListenerKeys = Object.keys(eventListeners).filter(key =>
        key.includes('authorization') && eventListeners[key].type === 'filter'
      );
      expect(authListenerKeys.length).toBeGreaterThan(0);

      // Test specific properties of an authorization listener
      const authListener = eventListeners[authListenerKeys[0]];
      expect(authListener).toBeDefined();
      expect(authListener.type).toBe('filter');
      expect(authListener.address).toBe('global');
      expect(typeof authListener.handler).toBe('function');
      expect(typeof authListener.originalHandler).toBe('function');
      expect(authListener.chainId).toBe(1337);

      // Test that the listener key contains expected components
      const authKey = authListenerKeys[0];
      expect(authKey).toContain('authorization');
      expect(authKey).toContain('1337');
      expect(authKey).toContain('global');

      // Test 16: Strategy Parameter Event Listener Creation
      // Verify that strategy parameter event listeners were properly registered during init
      const paramListenerKeys = Object.keys(eventListeners).filter(key =>
        key.includes('parameter-update') && eventListeners[key].type === 'filter'
      );
      // Should have 1 listener for BabyStepsStrategy
      expect(paramListenerKeys.length).toBe(1);

      // Test parameter listener for BabyStepsStrategy
      const bobStrategyAddress = service.contracts.bobStrategy.address;

      // Find listener for strategy
      const bobListener = Object.entries(eventListeners).find(([key, listener]) =>
        key.includes('parameter-update') && listener.filter?.address === bobStrategyAddress
      );

      // Verify listener exists
      expect(bobListener).toBeDefined();

      // Test properties of listener
      const [bobKey, bobListenerObj] = bobListener;
      expect(bobListenerObj.type).toBe('filter');
      expect(bobListenerObj.address).toBe(bobStrategyAddress);
      expect(typeof bobListenerObj.handler).toBe('function');
      expect(typeof bobListenerObj.originalHandler).toBe('function');
      expect(bobListenerObj.chainId).toBe(1337);
      expect(bobListenerObj.filter.address).toBe(bobStrategyAddress);

      // Test that listener key contains expected components
      expect(bobKey).toContain('parameter-update');
      expect(bobKey).toContain('1337');
      expect(bobKey).toContain('strategy-0');

      // Test 17: Verify Complete 0-Vault State After Initialization
      // Confirm that with no authorized vaults, the service is in proper empty state

      // Test VaultDataService has no vaults
      const allVaults = service.vaultDataService.getAllVaults();
      expect(Array.isArray(allVaults)).toBe(true);
      expect(allVaults.length).toBe(0);

      // Test poolData is empty
      expect(service.poolData).toBeDefined();
      expect(typeof service.poolData).toBe('object');
      expect(Object.keys(service.poolData).length).toBe(0);

      // Test no vault-specific event listeners are registered
      // Only system listeners (global, factory, strategy) should exist
      const vaultSpecificListeners = Object.keys(eventListeners).filter(key => {
        const listener = eventListeners[key];
        const isSystemAddress =
          listener.address === 'global' ||
          listener.address === service.contracts.factory.address.toLowerCase() ||
          listener.address === service.contracts.bobStrategy.address;
        return !isSystemAddress;
      });
      expect(vaultSpecificListeners.length).toBe(0);

      // Test that expected system listeners exist
      const globalListeners = Object.keys(eventListeners).filter(key => {
        const listener = eventListeners[key];
        return listener.address === 'global' || listener.address === service.contracts.factory.address.toLowerCase();
      });
      const strategyListeners = Object.keys(eventListeners).filter(key => {
        const listener = eventListeners[key];
        return listener.address === service.contracts.bobStrategy.address;
      });
      expect(globalListeners.length).toBe(1); // authorization listener only
      expect(strategyListeners.length).toBe(1); // 1 strategy parameter listener (BabyStepsStrategy)

      // Test service is ready but managing nothing
      expect(service.isRunning).toBe(true);
      expect(service.vaultDataService.getAllVaults().length).toBe(0);

      // Clean up
      await service.stop();
    });
  });
});
