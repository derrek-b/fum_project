/**
 * @module core/AutomationService
 * @description Main service orchestrating vault automation with multi-strategy, multi-platform support.
 * @since 2.0.0
 */

import path from 'path';
import { ethers } from 'ethers';
import { getAdaptersForChain, getAllTokens, getContract, getActiveVaults, getVaultExecutorIndex, getVaultContract } from 'fum_library';
import { getChainConfig } from 'fum_library/helpers/chainHelpers';
import { retryRpcCall, retryWithBackoff } from '../utils/RetryHelper.js';
import { UnrecoverableError, InsufficientGasError } from '../utils/errors.js';
import { patchProviderFeeData } from '../utils/patchProviderFeeData.js';

import EventManager from './EventManager.js';
import VaultDataService from './VaultDataService.js';
import SSEBroadcaster from './SSEBroadcaster.js';
import Tracker from './Tracker.js';
import VaultHealth from './VaultHealth.js';
import { BabyStepsStrategy } from '../strategies/index.js';

/**
 * Main automation service class
 * @class AutomationService
 */
class AutomationService {
  /**
   * Creates a new AutomationService instance
   * @param {Object} config - Service configuration
   * @param {number} config.chainId - Chain ID for the network
   * @param {string} config.wsUrl - WebSocket RPC URL
   * @param {boolean} [config.debug=false] - Enable debug logging
   * @param {number} [config.retryIntervalMs=300000] - Retry interval for failed vaults (5 minutes)
   * @param {number} [config.maxFailureDurationMs=3600000] - Max failure duration before blacklist (1 hour)
   * @param {number} [config.ssePort=3001] - SSE server port
   * @param {string} [config.dataDir='./data'] - Base directory for all data files (blacklist, vault tracking, tracking failures)
   * @param {number} [config.vaultHealthIntervalMs=300000] - VaultHealth balance check interval (0 disables)
   */
  constructor(config) {
    // Validate required config
    this.validateConfig(config);

    // Cache HDNode from mnemonic (single PBKDF2, ~10-50ms)
    const mnemonic = process.env.AUTOMATION_MNEMONIC;
    if (!mnemonic) {
      throw new Error('AUTOMATION_MNEMONIC environment variable is required');
    }
    try {
      this.hdNode = ethers.utils.HDNode.fromMnemonic(mnemonic);
    } catch (error) {
      throw new Error(`Invalid AUTOMATION_MNEMONIC: ${error.message}`);
    }

    // Store configuration
    this.chainId = config.chainId;
    this.wsUrl = config.wsUrl;
    this.debug = config.debug || false;
    this.retryIntervalMs = config.retryIntervalMs || 300000;
    this.maxFailureDurationMs = config.maxFailureDurationMs || 3600000;
    this.ssePort = config.ssePort || 3001;
    this.dataDir = path.resolve(config.dataDir || './data');
    this.blacklistFilePath = path.join(this.dataDir, 'blacklist.json');
    this.trackingDataDir = path.join(this.dataDir, 'vaults');
    this.trackingFailuresFilePath = path.join(this.dataDir, 'trackingFailures.json');

    // Service state
    this.isRunning = false;
    this.isShuttingDown = false;
    this.provider = null;

    // Reconnection state
    this.isReconnecting = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectBaseDelay = 1000; // 1 second
    this.heartbeatInterval = null;
    this.heartbeatIntervalMs = 30000; // 30 seconds

    // Caches
    this.contracts = {};
    this.adapters = new Map();
    this.tokens = {};
    this.poolData = {};

    // Vault management
    this.vaultLocks = {};
    this.failedVaults = new Map();
    this.blacklistedVaults = new Map();
    this.vaultTripHistory = new Map(); // Track retry trips: { trips: [{timestamp, source}], firstTripAt }
    this.pendingConfigUpdates = new Map(); // vaultAddress -> [{type, data, timestamp}]

    // Core dependencies
    this.eventManager = new EventManager();
    this.eventManager.setDebug(this.debug);

    this.vaultDataService = new VaultDataService(this.eventManager);

    this.tracker = new Tracker({
      vaultDataDir: this.trackingDataDir,
      trackingFailuresFilePath: this.trackingFailuresFilePath,
      eventManager: this.eventManager,
      chainId: this.chainId,
      debug: this.debug
    });

    this.vaultHealth = new VaultHealth({
      eventManager: this.eventManager,
      chainId: this.chainId,
      debug: this.debug,
      balanceCheckIntervalMs: config.vaultHealthIntervalMs ?? 300000
    });

    this.sseBroadcaster = new SSEBroadcaster(this.eventManager, {
      port: this.ssePort,
      debug: this.debug,
      getBlacklist: () => this.getBlacklistData(),
      getFailedVaults: () => this.getFailedVaultsData(),
      getFailedRemovals: () => this.eventManager.getFailedRemovals(),
      getTrackingFailures: () => this.tracker.getTrackingFailuresData(),
      getVaultMetadata: (addr) => this.tracker.getMetadata(addr),
      getVaultTransactions: (addr, start, end) => this.tracker.getTransactions(addr, start, end),
      getFundingRequired: () => this.vaultHealth.getFundingRequiredData(),
      onCrash: (error) => this.handleFatalError(error)
    });

    // Strategy instances
    this.strategies = new Map();

    // Create strategy dependencies (provider/adapters/tokens set during initialize)
    const strategyDependencies = {
      vaultDataService: this.vaultDataService,
      eventManager: this.eventManager,
      provider: null,  // Set during initialize()
      adapters: null,  // Set during initialize()
      tokens: null,    // Set during initialize()
      chainId: this.chainId,
      debug: this.debug,
      vaultLocks: this.vaultLocks,
      poolData: this.poolData,
      automationService: this,
      serviceConfig: null,  // Set during initialize()
      sendTelegramMessage: (msg) => this.sendTelegramMessage(msg)
    };

    // Instantiate BabyStepsStrategy
    const bobStrategy = new BabyStepsStrategy(strategyDependencies);
    this.strategies.set('bob', bobStrategy);

    // Set up internal event subscriptions
    this.setupInternalEventSubscriptions();

    // Set up crash handlers
    this.setupCrashHandlers();

    this.log('AutomationService instance created');
  }

  //#region Configuration Validation

  /**
   * Validate required configuration parameters
   * @private
   */
  validateConfig(config) {
    if (!config.chainId) {
      throw new Error('chainId is required');
    }
    if (typeof config.chainId !== 'number' || config.chainId <= 0) {
      throw new Error('chainId must be a positive number');
    }
    if (!config.wsUrl) {
      throw new Error('wsUrl is required');
    }
    if (!config.wsUrl.startsWith('wss://') && !config.wsUrl.startsWith('ws://')) {
      throw new Error('wsUrl must be a valid WebSocket URL (wss:// or ws://)');
    }
  }

  //#endregion

  //#region Service Lifecycle

  /**
   * Start the automation service
   * @returns {Promise<void>}
   */
  async start() {
    if (this.isRunning) {
      this.log('Service is already running');
      return;
    }

    this.log('Starting AutomationService...');

    try {
      // Phase 1: Core service initialization
      await this.initialize();

      // Phase 2: Load blacklist from disk
      await this.loadBlacklist();

      // Phase 3: Initialize tracker (before vault loading so it can track events)
      await this.tracker.initialize();

      // Phase 4: Start SSE broadcaster (before vault loading so it can broadcast events)
      await this.sseBroadcaster.start();

      // Phase 5: Discover and load authorized vaults (tracker/broadcaster ready)
      await this.loadAuthorizedVaults();

      // Phase 5.5: Start VaultHealth monitoring (initial balance check, begin interval)
      await this.vaultHealth.start();

      // Phase 6: Subscribe to global blockchain events (after vault loading to avoid race conditions)
      // If we subscribed before loading, a user could disable a vault mid-setup causing races
      this.eventManager.subscribeToAuthorizationEvents(
        this.provider,
        this.hdNode,
        this.chainId
      );

      const strategyAddresses = [];
      if (this.contracts.bobStrategy) {
        strategyAddresses.push(this.contracts.bobStrategy.address);
      }
      this.eventManager.subscribeToStrategyParameterEvents(
        strategyAddresses,
        this.provider,
        this.chainId
      );

      // Phase 7: Start failed vault retry timer
      this.startFailedVaultRetryTimer();

      this.isRunning = true;

      this.eventManager.emit('ServiceStarted', {
        chainId: this.chainId,
        adaptersLoaded: this.adapters.size,
        tokensLoaded: Object.keys(this.tokens).length,
        timestamp: Date.now(),
        log: {
          level: 'info',
          message: `AutomationService started on chain ${this.chainId}`
        }
      });

      this.log('AutomationService started successfully');

    } catch (error) {
      console.error('Failed to start AutomationService:', error);

      this.eventManager.emit('ServiceStartFailed', {
        error: error.message,
        timestamp: Date.now(),
        log: {
          level: 'error',
          message: `Failed to start AutomationService: ${error.message}`
        }
      });

      // Force cleanup of any resources allocated during partial initialization
      await this.stop(true);

      throw error;
    }
  }

  /**
   * Stop the automation service
   * @param {boolean} [force=false] - Force cleanup even if service isn't fully running (for initialization failures)
   * @returns {Promise<boolean>} True on successful stop
   */
  async stop(force = false) {
    if (!this.isRunning && !force) {
      this.log('Service is not running');
      return true;
    }

    this.log(force ? 'Force stopping AutomationService...' : 'Stopping AutomationService...');
    this.isRunning = false;
    this.isShuttingDown = true;

    // 1. Stop failed vault retry timer
    if (this.failedVaultRetryTimer) {
      clearInterval(this.failedVaultRetryTimer);
      this.failedVaultRetryTimer = null;
    }

    // 1.5. Stop VaultHealth monitoring
    this.vaultHealth.stop();

    // 2. Stop heartbeat monitoring
    this.stopHeartbeat();

    // 3. Clean up all monitored vaults (strategy cleanup, listeners, locks)
    const vaults = this.vaultDataService.getAllVaults();
    if (vaults.length > 0) {
      this.log(`Cleaning up ${vaults.length} vault(s)...`);
      await Promise.allSettled(
        vaults.map(vault =>
          this.cleanupVault(vault.address, vault.strategy?.strategyId)
        )
      );
    }

    // 4. Disable event processing and remove remaining listeners
    this.eventManager.setEnabled(false);
    await this.eventManager.removeAllListeners();

    // 5. Stop SSE broadcaster
    await this.sseBroadcaster.stop();

    // 6. Shutdown tracker (persists data)
    await this.tracker.shutdown();

    // 7. Save blacklist - log error but don't block shutdown
    try {
      await this.saveBlacklist();
    } catch (error) {
      console.error('Failed to save blacklist during shutdown:', error);
    }

    // 8. Close provider connection
    if (this.provider) {
      this.provider.removeAllListeners();
      // Destroy WebSocket connection
      if (typeof this.provider.destroy === 'function') {
        await this.provider.destroy();
      }
      this.provider = null;
    }

    // 9. Clear service state
    this.vaultDataService.clearCache();
    this.vaultLocks = {};
    this.pendingConfigUpdates.clear();

    // Note: isShuttingDown stays TRUE after stop
    this.log('AutomationService stopped');
    return true;
  }

  //#endregion

  //#region Service Initialization

  /**
   * Initialize the service (provider, adapters, tokens)
   * @returns {Promise<void>}
   */
  async initialize() {
    if (this.provider) {
      this.log('Service already initialized');
      return;
    }

    this.log('Initializing AutomationService...');

    try {
      // 1. Set up WebSocket provider
      await this.initializeProvider();

      // 2. Initialize VaultDataService
      this.vaultDataService.initialize(this.provider, this.chainId);

      // 3. Initialize platform adapters
      await this.initializeAdapters();

      // 4. Initialize token configurations
      await this.initializeTokens();

      // 5. Pass dependencies to VaultDataService
      this.vaultDataService.setAdapters(this.adapters);
      this.vaultDataService.setPoolData(this.poolData);
      this.vaultDataService.setTokens(this.tokens);

      // 5b. Pass dependencies to EventManager
      this.eventManager.setPoolData(this.poolData);
      this.eventManager.setAdapters(this.adapters);
      this.eventManager.setVaultDataService(this.vaultDataService);

      // 6. Set up VaultDataService logging
      this.setupVaultDataServiceLogging();

      // 7. Pre-initialize strategy contracts
      await this.initializeStrategyContracts();

      // 8. Update strategy dependencies with runtime values
      this.updateStrategyDependencies();

      // 9. Wire VaultHealth dependencies (provider, HDNode, data service, adapters, locks)
      this.vaultHealth.setProvider(this.provider);
      this.vaultHealth.setHdNode(this.hdNode);
      this.vaultHealth.setVaultDataService(this.vaultDataService);
      this.vaultHealth.setTokens(this.tokens);
      this.vaultHealth.setAdapters(this.adapters);
      this.vaultHealth.setLockFunctions(
        (addr) => this.lockVault(addr),
        (addr) => this.unlockVault(addr)
      );

      this.log('AutomationService initialized successfully');

    } catch (error) {
      console.error('Failed to initialize AutomationService:', error);
      throw error;
    }
  }

  /**
   * Initialize WebSocket provider
   * @private
   */
  async initializeProvider() {
    this.log(`Connecting to WebSocket: ${this.wsUrl}`);

    this.provider = new ethers.providers.WebSocketProvider(this.wsUrl);
    patchProviderFeeData(this.provider, this.chainId);

    // Attach WebSocket event handlers for disconnect detection
    this.attachProviderEventHandlers();

    // Test connection with retry logic for transient network failures
    const network = await retryRpcCall(
      () => this.provider.getNetwork(),
      'getNetwork',
      { log: (msg) => this.log(msg) }
    );

    if (network.chainId !== this.chainId) {
      throw new Error(`Provider chain ID (${network.chainId}) does not match config (${this.chainId})`);
    }

    let chainName = network.name;
    try {
      const chainConfig = getChainConfig(network.chainId);
      chainName = chainConfig.name;
    } catch {
      // Chain not in our config — fall back to ethers' network name
    }
    this.log(`Connected to chain ${network.chainId} (${chainName})`);

    // Start heartbeat monitoring
    this.startHeartbeat();

    // Diagnostic: WebSocket subscription debugging
    // Enable with DEBUG_WS_EVENTS=true environment variable
    if (process.env.DEBUG_WS_EVENTS === 'true') {
      this.attachSubscriptionDiagnostics();
    }
  }

  /**
   * Attach diagnostic logging for WebSocket subscriptions.
   * Logs eth_subscribe requests/responses and raw subscription events.
   * Enable with DEBUG_WS_EVENTS=true environment variable.
   * @private
   */
  attachSubscriptionDiagnostics() {
    this.log('🔬 [WS-DIAG] WebSocket subscription diagnostics ENABLED');

    // 1. Log eth_subscribe requests and confirmations via provider debug event
    this.provider.on('debug', (info) => {
      if (info.action === 'request' && info.request?.method === 'eth_subscribe') {
        console.log(`🔬 [WS-DIAG] eth_subscribe SENT: ${JSON.stringify(info.request.params)}`);
      }
      if (info.action === 'response' && info.request?.method === 'eth_subscribe') {
        console.log(`🔬 [WS-DIAG] eth_subscribe CONFIRMED — subId: ${info.response}`);
      }
    });

    // 2. Log raw subscription events arriving over the WebSocket
    if (this.provider._websocket) {
      const originalOnMessage = this.provider._websocket.onmessage;
      this.provider._websocket.onmessage = (messageEvent) => {
        try {
          const msg = JSON.parse(messageEvent.data);
          if (msg.method === 'eth_subscription') {
            const topicHash = msg.params?.result?.topics?.[0] || 'no-topics';
            console.log(`🔬 [WS-DIAG] RAW subscription event received — subId: ${msg.params.subscription}, topic: ${topicHash.slice(0, 10)}..., address: ${msg.params?.result?.address || 'none'}`);
          }
        } catch {
          // Ignore parse errors on non-JSON messages
        }
        // Call the original handler so ethers.js processes the message
        if (originalOnMessage) {
          originalOnMessage(messageEvent);
        }
      };
      this.log('🔬 [WS-DIAG] Raw WebSocket message interceptor attached');
    }

    // 3. Log subscription state after a short delay (let async eth_subscribe complete)
    setTimeout(() => {
      const subCount = Object.keys(this.provider._subs || {}).length;
      const subIdCount = Object.keys(this.provider._subIds || {}).length;
      console.log(`🔬 [WS-DIAG] Subscription state: ${subCount} active subs, ${subIdCount} sub IDs`);
      for (const [subId, sub] of Object.entries(this.provider._subs || {})) {
        console.log(`🔬 [WS-DIAG]   subId=${subId} → tag=${sub.tag}`);
      }
    }, 3000);
  }

  /**
   * Attach WebSocket event handlers for disconnect detection
   * @private
   */
  attachProviderEventHandlers() {
    if (!this.provider?._websocket) {
      this.log('Warning: Cannot attach WebSocket handlers - no underlying WebSocket');
      return;
    }

    const ws = this.provider._websocket;

    ws.on('close', (code, reason) => {
      this.log(`WebSocket closed: code=${code}, reason=${reason || 'none'}`);
      this.handleProviderDisconnect(code, reason);
    });

    ws.on('error', (error) => {
      this.log(`WebSocket error: ${error.message}`);
      // Error is usually followed by close event, so we don't reconnect here
      this.eventManager.emit('ProviderError', {
        error: error.message,
        log: { level: 'error', message: `WebSocket error: ${error.message}` }
      });
    });

    this.log('WebSocket event handlers attached');
  }

  /**
   * Handle WebSocket provider disconnection
   * @param {number} code - WebSocket close code
   * @param {string} reason - Close reason
   * @private
   */
  async handleProviderDisconnect(code, reason) {
    // Ignore if already shutting down or reconnecting
    if (this.isShuttingDown || this.isReconnecting) {
      return;
    }

    // Ignore normal closure during stop()
    if (code === 1000) {
      return;
    }

    this.log(`Provider disconnected (code: ${code}). Attempting reconnection...`);

    this.eventManager.emit('ProviderDisconnected', {
      code,
      reason,
      log: { level: 'warn', message: `WebSocket disconnected (code: ${code})` }
    });

    await this.attemptReconnection();
  }

  /**
   * Attempt to reconnect the WebSocket provider with exponential backoff
   * @private
   */
  async attemptReconnection() {
    if (this.isReconnecting) {
      return;
    }

    this.isReconnecting = true;
    this.reconnectAttempts = 0;

    // Stop heartbeat during reconnection
    this.stopHeartbeat();

    while (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = this.reconnectBaseDelay * Math.pow(2, this.reconnectAttempts - 1);

      this.log(`Reconnection attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay}ms...`);

      this.eventManager.emit('ProviderReconnecting', {
        attempt: this.reconnectAttempts,
        maxAttempts: this.maxReconnectAttempts,
        delayMs: delay,
        log: { level: 'info', message: `Reconnecting (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})` }
      });

      await new Promise(resolve => setTimeout(resolve, delay));

      try {
        // Clean up old provider
        if (this.provider) {
          this.provider.removeAllListeners();
          if (this.provider._websocket) {
            this.provider._websocket.removeAllListeners();
          }
        }

        // Remove all EventManager listeners (they reference old provider)
        await this.eventManager.removeAllListeners();

        // Create new provider
        this.provider = new ethers.providers.WebSocketProvider(this.wsUrl);
        patchProviderFeeData(this.provider, this.chainId);
        this.attachProviderEventHandlers();

        // Verify connection
        const network = await this.provider.getNetwork();
        if (network.chainId !== this.chainId) {
          throw new Error(`Chain ID mismatch: ${network.chainId} vs ${this.chainId}`);
        }

        this.log(`Reconnected to chain ${network.chainId}`);

        // Update VaultHealth provider reference
        this.vaultHealth.setProvider(this.provider);

        // Re-establish all event listeners
        await this.reestablishEventListeners();

        // Update all dependency provider references (strategies + VaultDataService)
        this.vaultDataService.provider = this.provider;
        this.updateStrategyDependencies();

        // Restart heartbeat
        this.startHeartbeat();

        this.isReconnecting = false;

        this.eventManager.emit('ProviderReconnected', {
          attempts: this.reconnectAttempts,
          log: { level: 'info', message: 'WebSocket reconnected successfully' }
        });

        this.reconnectAttempts = 0;
        return; // Success
      } catch (error) {
        this.log(`Reconnection attempt ${this.reconnectAttempts} failed: ${error.message}`);
      }
    }

    // All attempts exhausted
    this.log('Max reconnection attempts reached. Triggering fatal error handler.');
    this.isReconnecting = false;

    this.eventManager.emit('ProviderFailed', {
      attempts: this.reconnectAttempts,
      log: { level: 'error', message: `Provider reconnection failed after ${this.reconnectAttempts} attempts` }
    });

    this.handleFatalError(new Error('WebSocket provider reconnection failed'));
  }

  /**
   * Re-establish all event listeners after provider reconnection
   * @private
   */
  async reestablishEventListeners() {
    this.log('Re-establishing event listeners...');

    // 1. Re-subscribe to authorization events (global)
    this.eventManager.subscribeToAuthorizationEvents(
      this.provider,
      this.hdNode,
      this.chainId
    );

    // 2. Re-subscribe to strategy parameter events (global)
    const strategyAddresses = [];
    if (this.contracts.bobStrategy) {
      strategyAddresses.push(this.contracts.bobStrategy.address);
    }
    this.eventManager.subscribeToStrategyParameterEvents(
      strategyAddresses,
      this.provider,
      this.chainId
    );

    // 3. Re-subscribe to events for each monitored vault
    const vaults = this.vaultDataService.getAllVaults();
    for (const vault of vaults) {
      // Re-subscribe to vault config events
      this.eventManager.subscribeToVaultConfigEvents(
        vault,
        this.provider,
        this.chainId
      );

      // Re-subscribe to swap events for vault's positions
      await this.eventManager.subscribeToSwapEvents(
        vault,
        this.provider,
        this.chainId
      );
    }

    this.log(`Re-established listeners for ${vaults.length} vault(s)`);
  }

  /**
   * Start periodic heartbeat to detect silent disconnects
   * @private
   */
  startHeartbeat() {
    if (this.heartbeatInterval) {
      return; // Already running
    }

    this.heartbeatInterval = setInterval(async () => {
      if (this.isShuttingDown || this.isReconnecting) {
        return;
      }

      try {
        await this.provider.getBlockNumber();
      } catch (error) {
        this.log(`Heartbeat failed: ${error.message}`);
        // Trigger reconnection
        this.handleProviderDisconnect(1006, 'Heartbeat failed');
      }
    }, this.heartbeatIntervalMs);

    this.log('Heartbeat monitoring started');
  }

  /**
   * Stop heartbeat monitoring
   * @private
   */
  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
      this.log('Heartbeat monitoring stopped');
    }
  }

  /**
   * Initialize platform adapters
   * @private
   */
  async initializeAdapters() {
    this.log('Initializing platform adapters...');

    const result = getAdaptersForChain(this.chainId);

    if (!result.adapters || result.adapters.length === 0) {
      throw new Error(`No adapters available for chain ID ${this.chainId}`);
    }

    // Log any adapter creation failures
    if (result.failures && result.failures.length > 0) {
      for (const failure of result.failures) {
        console.warn(`Failed to create adapter ${failure.platformId}: ${failure.error}`);
      }
    }

    for (const adapter of result.adapters) {
      this.adapters.set(adapter.platformId, adapter);
      this.log(`Registered adapter: ${adapter.platformId}`);
    }

    this.log(`Initialized ${this.adapters.size} adapter(s)`);
  }

  /**
   * Initialize token configurations
   * @private
   */
  async initializeTokens() {
    this.log('Initializing token configurations...');

    const allTokens = getAllTokens(); // Returns object keyed by symbol

    // Filter tokens available on this chain and index by symbol
    // Note: Native ETH has address: null, so check for key existence, not truthiness
    for (const [symbol, token] of Object.entries(allTokens)) {
      if (token.addresses && this.chainId in token.addresses) {
        this.tokens[symbol] = {
          ...token,
          address: token.addresses[this.chainId]  // null for native ETH
        };
      }
    }

    this.log(`Loaded ${Object.keys(this.tokens).length} token(s) for chain ${this.chainId}`);
  }

  /**
   * Initialize strategy contracts
   * @private
   * @throws {Error} If strategy contracts cannot be loaded after retries
   */
  async initializeStrategyContracts() {
    this.log('Pre-initializing strategy contracts...');

    // Load BabySteps (bob) strategy contract with retry logic
    // Failure is fatal - service cannot operate without strategy contracts
    this.contracts.bobStrategy = await retryRpcCall(
      () => getContract('bob', this.provider),
      'getContract(bob)',
      { log: (msg) => this.log(msg) }
    );
    this.log('Loaded bob strategy contract');

    // Future: Load other strategy contracts as needed
    // this.contracts.parrisStrategy = await getContract('parris', this.provider);
    // this.contracts.fedStrategy = await getContract('fed', this.provider);
  }

  /**
   * Set up VaultDataService event logging
   * @private
   */
  setupVaultDataServiceLogging() {
    // Subscribe to pool data fetched events to update our cache
    this.vaultDataService.subscribe('PoolDataFetched', (data) => {
      Object.assign(this.poolData, data.poolData);
      this.log(`Cached pool data from ${data.source}: ${Object.keys(data.poolData).length} pool(s)`);
    });

    // Log vault load events
    this.vaultDataService.subscribe('vaultLoaded', (data) => {
      this.log(`Vault loaded: ${data.vaultAddress} (${data.positionCount} positions)`);
    });

    this.vaultDataService.subscribe('vaultLoadError', (address, message) => {
      console.error(`Vault load error: ${address} - ${message}`);
    });
  }

  /**
   * Update all strategies with runtime dependencies
   * @private
   */
  updateStrategyDependencies() {
    const serviceConfig = {
      chainId: this.chainId,
      wsUrl: this.wsUrl,
      debug: this.debug
    };

    for (const [strategyId, strategy] of this.strategies) {
      strategy.provider = this.provider;
      strategy.adapters = this.adapters;
      strategy.tokens = this.tokens;
      strategy.hdNode = this.hdNode;
      strategy.vaultHealth = this.vaultHealth;
      strategy.serviceConfig = serviceConfig;
      this.log(`Updated dependencies for strategy: ${strategyId}`);
    }
  }

  //#endregion

  //#region Event Subscriptions

  /**
   * Set up internal event subscriptions
   * @private
   */
  setupInternalEventSubscriptions() {
    // Handle pool data fetched events from VaultDataService
    this.eventManager.subscribe('PoolDataFetched', (data) => {
      Object.assign(this.poolData, data.poolData);
    });

    // Handle swap events from monitored pools
    this.eventManager.subscribe('SwapEventDetected', async (data) => {
      await this.handleSwapEvent(data);
    });

    // Handle config update failures from EventManager
    this.eventManager.subscribe('ConfigUpdateFailed', async (data) => {
      try {
        this.log(`Config update failed for vault ${data.vaultAddress}: ${data.configType}`);
        await this.trackFailedVault(data.vaultAddress, data.error, 'config_update');
      } catch (handlerError) {
        // Handler failure means vault isn't in retry queue but has stale config
        // Blacklist to stop operating on outdated data - re-auth will clear it
        console.error(`ConfigUpdateFailed handler error for ${data.vaultAddress}:`, handlerError.message);
        await this.emergencyVaultCleanup(data.vaultAddress, `ConfigUpdateFailed handler error: ${handlerError.message}`);
      }
    });

    // Handle strategy parameter update failures from EventManager
    this.eventManager.subscribe('StrategyParameterUpdateFailed', async (data) => {
      try {
        this.log(`Strategy parameter update failed for vault ${data.vaultAddress}`);
        await this.trackFailedVault(data.vaultAddress, data.error, 'strategy_param_update');
      } catch (handlerError) {
        // Handler failure means vault isn't in retry queue but has stale parameters
        // Blacklist to stop operating on outdated data - re-auth will clear it
        console.error(`StrategyParameterUpdateFailed handler error for ${data.vaultAddress}:`, handlerError.message);
        await this.emergencyVaultCleanup(data.vaultAddress, `StrategyParameterUpdateFailed handler error: ${handlerError.message}`);
      }
    });

    // Handle target tokens update - lock-aware cache update
    this.eventManager.subscribe('TargetTokensUpdated', async (data) => {
      await this.handleConfigUpdate(data.vaultAddress, 'tokens', data.tokens);
    });

    // Handle target platforms update - lock-aware cache update
    this.eventManager.subscribe('TargetPlatformsUpdated', async (data) => {
      await this.handleConfigUpdate(data.vaultAddress, 'platforms', data.platforms);
    });

    // Handle strategy parameter update - lock-aware cache update
    this.eventManager.subscribe('StrategyParameterUpdated', async (data) => {
      await this.handleConfigUpdate(data.vaultAddress, 'params', data.paramName);
    });

    // Process pending config updates when vault unlocks
    this.eventManager.subscribe('VaultUnlocked', async ({ vaultAddress }) => {
      await this.processPendingConfigUpdates(vaultAddress);
    });

    // Handle new vault authorization - setup the vault for monitoring
    this.eventManager.subscribe('VaultAuthGranted', async (data) => {
      const { vaultAddress } = data;

      if (this.isShuttingDown) {
        this.log('Ignoring VaultAuthGranted - service is shutting down');
        return;
      }

      this.log(`New vault authorized: ${vaultAddress}`);

      // Auto-unblacklist if re-authorizing (treat as intent to retry)
      if (this.isVaultBlacklisted(vaultAddress)) {
        this.log(`Vault ${vaultAddress} was blacklisted - removing for fresh authorization attempt`);
        await this.unblacklistVault(vaultAddress);
      }

      // Clear from retry queue if present (fresh authorization attempt)
      // Note: failedVaults uses checksummed addresses as keys
      const normalizedVaultAddress = ethers.utils.getAddress(vaultAddress);
      if (this.failedVaults.has(normalizedVaultAddress)) {
        this.failedVaults.delete(normalizedVaultAddress);
        this.log(`Cleared ${vaultAddress} from retry queue for fresh authorization`);
      }

      try {
        const result = await this.setupVault(vaultAddress, { forceRefresh: true });

        this.eventManager.emit('VaultOnboarded', {
          vaultAddress,
          strategyId: result.vault.strategy.strategyId,
          positionCount: Object.keys(result.vault.positions).length,
          log: {
            level: 'info',
            message: `Vault onboarded: ${vaultAddress} (${result.vault.strategy.strategyId})`
          }
        });

        this.sendTelegramMessage(
          `🆕 New vault authorized: ${vaultAddress.slice(0, 6)}...${vaultAddress.slice(-4)}`
        ).catch(err => console.error('Telegram notification error:', err));

      } catch (error) {
        // InsufficientGasError: executor needs funding, not a retry/blacklist case
        if (error.name === 'InsufficientGasError') {
          this.vaultHealth.enterFundingRequired(vaultAddress);
        } else {
          // trackFailedVault emits VaultFailed which is already broadcast via SSE
          try {
            await this.trackFailedVault(vaultAddress, error.message, 'auth_event');
          } catch (handlerError) {
            console.error(`[auth_event] trackFailedVault error for ${vaultAddress}:`, handlerError.message);
            await this.emergencyVaultCleanup(vaultAddress, `[auth_event] trackFailedVault failed: ${handlerError.message}`);
          }
        }
      }
    });

    // Handle vault deauthorization - cleanup monitoring
    this.eventManager.subscribe('VaultAuthRevoked', async (data) => {
      const { vaultAddress } = data;

      if (this.isShuttingDown) {
        this.log('Ignoring VaultAuthRevoked - service is shutting down');
        return;
      }

      this.log(`Vault authorization revoked: ${vaultAddress}`);

      const results = {
        offboardResults: null,
        removedFromBlacklist: false,
        errors: []
      };

      // Remove from blacklist if present (revocation = clean slate)
      if (this.isVaultBlacklisted(vaultAddress)) {
        await this.unblacklistVault(vaultAddress);
        results.removedFromBlacklist = true;
        this.log(`Removed revoked vault from blacklist: ${vaultAddress}`);
      }

      // Full cleanup: strategy state, listeners, locks, caches
      try {
        results.offboardResults = await this.offboardVault(vaultAddress);
      } catch (error) {
        results.errors.push(`Offboard failed: ${error.message}`);
      }

      // Emit VaultOffboarded event
      this.eventManager.emit('VaultOffboarded', {
        vaultAddress,
        ...results.offboardResults,
        removedFromBlacklist: results.removedFromBlacklist,
        success: results.errors.length === 0,
        log: {
          level: results.errors.length === 0 ? 'info' : 'warn',
          message: `Vault offboarded: ${vaultAddress} - ${results.errors.length === 0 ? 'success' : `${results.errors.length} error(s)`}`
        }
      });

      this.sendTelegramMessage(
        `Vault authorization revoked: ${vaultAddress.slice(0, 6)}...${vaultAddress.slice(-4)}`
      ).catch(err => console.error('Telegram notification error:', err));
    });

    // Handle ExecutorChanged event processing failures
    this.eventManager.subscribe('VaultAuthEventFailed', async (data) => {
      try {
        const { vaultAddress, error } = data;
        const isManaged = this.vaultDataService.hasVault(vaultAddress);

        if (isManaged) {
          // User was trying to DISABLE automation but event processing failed
          // Blacklist to ensure we don't act on a vault that may have revoked us
          // Note: blacklistVault() handles listener cleanup internally
          this.log(`VaultAuthEventFailed for managed vault ${vaultAddress} - blacklisting for safety`);
          await this.blacklistVault(vaultAddress, `ExecutorChanged event processing failed: ${error}`);
        } else {
          // User was trying to ENABLE automation but event processing failed
          // Track for retry - the retry system will attempt to set up the vault
          this.log(`VaultAuthEventFailed for unmanaged vault ${vaultAddress} - tracking for retry`);
          await this.trackFailedVault(vaultAddress, `ExecutorChanged event processing failed: ${error}`, 'auth_event');
        }
      } catch (handlerError) {
        // Handler failure means we couldn't blacklist or track the vault
        // Emergency cleanup to prevent acting on a vault with unknown auth state
        console.error(`VaultAuthEventFailed handler error for ${data.vaultAddress}:`, handlerError.message);
        await this.emergencyVaultCleanup(data.vaultAddress, `VaultAuthEventFailed handler error: ${handlerError.message}`);
      }
    });

    // Handle position rebalanced - refresh swap listeners for new pool
    // After rebalance, the new position might be in a different pool (different fee tier)
    this.eventManager.subscribe('PositionRebalanced', async (data) => {
      try {
        await retryWithBackoff(
          () => this.eventManager.refreshSwapListeners(
            data.vaultAddress,
            this.provider,
            this.chainId
          ),
          {
            maxRetries: 2,
            baseDelay: 1000,
            exponential: true,
            context: `Refresh swap listeners after rebalance for ${data.vaultAddress}`,
            logger: console
          }
        );
        this.log(`Refreshed swap listeners for ${data.vaultAddress} after rebalance`);
      } catch (error) {
        console.error(`Failed to refresh swap listeners for ${data.vaultAddress}:`, error);
        try {
          await this.trackFailedVault(data.vaultAddress, error.message, 'listener_refresh');
        } catch (handlerError) {
          console.error(`[listener_refresh] trackFailedVault error for ${data.vaultAddress}:`, handlerError.message);
          await this.emergencyVaultCleanup(data.vaultAddress, `[listener_refresh] trackFailedVault failed: ${handlerError.message}`);
        }
      }
    });

  }

  //#endregion

  //#region Failed Vault Management

  /**
   * Start the failed vault retry timer
   * @private
   */
  startFailedVaultRetryTimer() {
    this.failedVaultRetryTimer = setInterval(async () => {
      await this.retryFailedVaults();

      // Retry failed listener removals from EventManager
      const failedRemovals = this.eventManager.getFailedRemovals();
      if (failedRemovals.size > 0) {
        this.log(`Retrying ${failedRemovals.size} failed listener removals`);
        const results = await this.eventManager.retryFailedRemovals();
        this.log(`Failed listener retry: ${results.succeeded} succeeded, ${results.stillFailing} still failing`);
      }
    }, this.retryIntervalMs);

    this.log(`Failed vault retry timer started (interval: ${this.retryIntervalMs}ms)`);
  }

  /**
   * Retry failed vaults
   * @private
   */
  async retryFailedVaults() {
    if (this.failedVaults.size === 0) return;

    this.log(`Retrying ${this.failedVaults.size} failed vault(s)...`);

    const now = Date.now();

    for (const [vaultAddress, failureData] of this.failedVaults.entries()) {
      // Check if max failure duration exceeded
      const failureDuration = now - failureData.firstFailedAt;
      if (failureDuration > this.maxFailureDurationMs) {
        this.log(`Vault ${vaultAddress} exceeded max failure duration, blacklisting`);
        await this.blacklistVault(vaultAddress, failureData.lastError);
        this.failedVaults.delete(vaultAddress);
        this.vaultTripHistory.delete(vaultAddress); // Clean up trip history
        continue;
      }

      // Acquire vault lock - skip if already locked (concurrent retry or swap processing)
      if (!this.lockVault(vaultAddress)) {
        this.log(`Vault ${vaultAddress} locked, skipping retry this cycle`);
        continue;
      }

      // Attempt to re-setup the vault
      try {
        await this.setupVault(vaultAddress);
        this.failedVaults.delete(vaultAddress);
        this.log(`Vault ${vaultAddress} retry successful`);
        this.eventManager.emit('VaultRecovered', {
          vaultAddress,
          timestamp: Date.now(),
          log: { level: 'info', message: `Vault ${vaultAddress} recovered from retry queue` }
        });
      } catch (error) {
        // InsufficientGasError: executor needs funding, remove from retry queue
        if (error.name === 'InsufficientGasError') {
          this.failedVaults.delete(vaultAddress);
          this.vaultHealth.enterFundingRequired(vaultAddress);
        } else if (this.isRecoverableError(error)) {
          // Recoverable: trackFailedVault updates attempt count and lastError
          try {
            await this.trackFailedVault(vaultAddress, error.message, 'retry_attempt');
          } catch (handlerError) {
            console.error(`[retry_attempt] trackFailedVault error for ${vaultAddress}:`, handlerError.message);
            await this.emergencyVaultCleanup(vaultAddress, `[retry_attempt] trackFailedVault failed: ${handlerError.message}`);
          }
        } else {
          // Unrecoverable: blacklist immediately and remove from retry queue
          this.failedVaults.delete(vaultAddress);
          this.vaultTripHistory.delete(vaultAddress);
          await this.blacklistVault(vaultAddress, error.message);
          this.log(`Vault ${vaultAddress} blacklisted during retry due to unrecoverable error: ${error.message}`);
        }
      } finally {
        this.unlockVault(vaultAddress);
      }
    }
  }

  /**
   * Clean up a single vault during shutdown
   * @param {string} vaultAddress - Vault address
   * @param {string} strategyId - Strategy ID
   * @returns {Promise<Object>} Cleanup results
   */
  async cleanupVault(vaultAddress, strategyId) {
    const results = {
      listenersRemoved: 0,
      strategyCleanedUp: false,
      errors: []
    };

    // 0. Remove from VaultHealth monitoring
    this.vaultHealth.removeVault(vaultAddress);

    // 1. Strategy-specific cleanup (clears emergencyExitBaseline, position checks, etc.)
    try {
      const strategy = this.strategies.get(strategyId);
      if (strategy?.cleanup) {
        strategy.cleanup(vaultAddress);
        results.strategyCleanedUp = true;
      }
    } catch (error) {
      results.errors.push(`Strategy cleanup failed: ${error.message}`);
    }

    // 2. Remove all vault-specific listeners
    try {
      results.listenersRemoved = await this.eventManager.removeAllVaultListeners(vaultAddress);
    } catch (error) {
      results.errors.push(`Listener removal failed: ${error.message}`);
    }

    // 3. Unlock vault if locked
    if (this.vaultLocks[ethers.utils.getAddress(vaultAddress)]) {
      this.unlockVault(vaultAddress);
    }

    // 4. Clear any pending config updates
    this.clearPendingConfigUpdates(vaultAddress);

    // 5. Emit VaultMonitoringStopped event
    this.eventManager.emit('VaultMonitoringStopped', {
      vaultAddress,
      strategyId,
      listenersRemoved: results.listenersRemoved,
      success: results.errors.length === 0,
      strategyFound: !!this.strategies.get(strategyId),
      log: {
        level: results.errors.length === 0 ? 'info' : 'warn',
        message: `Stopped monitoring vault ${vaultAddress} (${results.listenersRemoved} listeners removed)`
      }
    });

    return results;
  }

  /**
   * Emergency cleanup when event handlers fail - last resort to stop operating on a vault
   * Attempts each cleanup step independently, continuing even if individual steps fail.
   * Used when normal error handling (trackFailedVault/blacklistVault) has already failed.
   * @param {string} vaultAddress - Vault address
   * @param {string} reason - Reason for emergency cleanup
   */
  async emergencyVaultCleanup(vaultAddress, reason) {
    console.error(`🚨 Emergency vault cleanup for ${vaultAddress}: ${reason}`);

    const results = {
      listenersRemoved: false,
      removedFromCache: false,
      blacklisted: false,
      lockReleased: false,
      errors: []
    };

    // Step 1: Remove listeners to stop receiving events
    try {
      await this.eventManager.removeAllVaultListeners(vaultAddress);
      results.listenersRemoved = true;
    } catch (error) {
      results.errors.push(`Listener removal failed: ${error.message}`);
    }

    // Step 2: Remove from cache to prevent stale data operations
    try {
      this.vaultDataService.removeVault(vaultAddress);
      results.removedFromCache = true;
    } catch (error) {
      results.errors.push(`Cache removal failed: ${error.message}`);
    }

    // Step 3: Blacklist to prevent future operations (re-auth will clear it)
    try {
      // Direct blacklist without full offboard (we already did cleanup above)
      const normalizedAddress = ethers.utils.getAddress(vaultAddress);
      this.blacklistedVaults.set(normalizedAddress, {
        vaultAddress: normalizedAddress,
        blacklistedAt: Date.now(),
        reason: `EMERGENCY: ${reason}`
      });
      await this.saveBlacklist();
      results.blacklisted = true;
    } catch (error) {
      results.errors.push(`Blacklist failed: ${error.message}`);
    }

    // Step 4: Release any lock (defensive - in case vault was locked during concurrent operation)
    try {
      const normalizedAddress = ethers.utils.getAddress(vaultAddress);
      if (this.vaultLocks[normalizedAddress]) {
        this.unlockVault(normalizedAddress);
        results.lockReleased = true;
      }
    } catch (error) {
      results.errors.push(`Lock release failed: ${error.message}`);
    }

    // Step 5: Clear any pending config updates
    this.clearPendingConfigUpdates(vaultAddress);

    // Log final status
    if (results.errors.length === 0) {
      console.error(`🚨 Emergency cleanup complete for ${vaultAddress}: all steps succeeded`);
    } else {
      console.error(`🚨 Emergency cleanup partial for ${vaultAddress}: ${results.errors.join('; ')}`);
    }

    // Emit event for visibility (SSE broadcast, tracking)
    this.eventManager.emit('VaultBlacklisted', {
      vaultAddress,
      reason: `EMERGENCY: ${reason}`,
      emergency: true,
      cleanupResults: results,
      timestamp: Date.now(),
      log: {
        level: 'error',
        message: `Emergency blacklist: ${vaultAddress} - ${reason}`
      }
    });

    return results;
  }

  /**
   * Fully remove a vault from the service (cleanup + cache removal)
   * Use for permanent removal scenarios: blacklisting, authorization revoked
   * @param {string} vaultAddress - Vault address
   * @returns {Promise<Object>} Results of offboarding operations
   */
  async offboardVault(vaultAddress) {
    const normalizedAddress = ethers.utils.getAddress(vaultAddress);
    const results = {
      cleanupResults: null,
      removedFromRetryQueue: false,
      removedFromCache: false
    };

    // 1. Get strategyId before any cleanup (while vault may still be in cache)
    const strategyId = this.vaultDataService.getVaultStrategyId(normalizedAddress);

    // 2. Core cleanup: strategy state, listeners, locks
    if (strategyId) {
      results.cleanupResults = await this.cleanupVault(normalizedAddress, strategyId);
    } else {
      // Vault not in cache (failed during initial setup) - just remove listeners
      await this.eventManager.removeAllVaultListeners(normalizedAddress);
      results.cleanupResults = { listenersRemoved: 'unknown', strategyCleanedUp: false, errors: [] };
    }

    // 3. Remove from retry queue if present
    // Note: failedVaults uses checksummed addresses as keys (via trackFailedVault)
    if (this.failedVaults.has(normalizedAddress)) {
      this.failedVaults.delete(normalizedAddress);
      results.removedFromRetryQueue = true;
    }

    // 4. Remove from VaultDataService cache
    results.removedFromCache = this.vaultDataService.removeVault(normalizedAddress);

    return results;
  }

  /**
   * Track a failed vault
   * @param {string} vaultAddress - Vault address
   * @param {string} error - Error message
   * @param {string} [source='unknown'] - Source of failure (initial_setup, config_update, strategy_param_update, auth_event, retry_attempt, swap_event)
   */
  async trackFailedVault(vaultAddress, error, source = 'unknown') {
    // Skip if vault is already blacklisted (prevents re-adding to retry queue after emergency exit)
    if (this.isVaultBlacklisted(vaultAddress)) {
      this.log(`Skipping trackFailedVault for blacklisted vault ${vaultAddress}`);
      return;
    }

    const existing = this.failedVaults.get(vaultAddress);

    if (existing) {
      existing.attempts += 1;
      existing.lastError = error;
      existing.lastAttemptAt = Date.now();
      existing.source = source;
    } else {
      // Record trip and check for excessive trips (yo-yo detection)
      const shouldBlacklist = this.recordRetryTrip(vaultAddress, source);
      if (shouldBlacklist) {
        await this.blacklistVault(
          vaultAddress,
          `Exceeded retry trip limit: ${this.vaultTripHistory.get(vaultAddress)?.trips.length || 0} trips in 24 hours`
        );
        this.vaultTripHistory.delete(vaultAddress);
        return; // Don't emit VaultFailed, we're blacklisting
      }

      this.failedVaults.set(vaultAddress, {
        vaultAddress,
        firstFailedAt: Date.now(),
        lastAttemptAt: Date.now(),
        lastError: error,
        attempts: 1,
        source
      });

      // Only remove listeners on first failure (not on subsequent retry failures)
      await this.eventManager.removeAllVaultListeners(vaultAddress);
    }

    this.eventManager.emit('VaultFailed', {
      vaultAddress,
      error,
      source,
      attempts: this.failedVaults.get(vaultAddress).attempts,
      timestamp: Date.now(),
      log: {
        level: 'warn',
        message: `Vault ${vaultAddress} failed (${source}): ${error}`
      }
    });
  }

  /**
   * Record a trip to the retry queue and check for excessive trips
   * @param {string} vaultAddress - Vault address
   * @param {string} source - Failure source
   * @returns {boolean} True if vault should be blacklisted due to excessive trips
   */
  recordRetryTrip(vaultAddress, source) {
    const TRIP_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours
    const MAX_TRIPS_IN_WINDOW = 5;

    const now = Date.now();

    // Get or create trip history
    let history = this.vaultTripHistory.get(vaultAddress);
    if (!history) {
      history = { trips: [], firstTripAt: now };
      this.vaultTripHistory.set(vaultAddress, history);
    }

    // Prune trips older than 24h (lazy decay - happens when vault fails again)
    const windowStart = now - TRIP_WINDOW_MS;
    history.trips = history.trips.filter(trip => trip.timestamp > windowStart);

    // If all old trips were pruned, this is effectively a fresh start
    if (history.trips.length === 0) {
      history.firstTripAt = now;
    }

    // Add this trip
    history.trips.push({ timestamp: now, source });

    // Emit monitoring event
    this.eventManager.emit('VaultRetryTrip', {
      vaultAddress,
      source,
      tripCount: history.trips.length,
      tripsInWindow: history.trips.length,
      timestamp: now,
      log: {
        level: history.trips.length >= 3 ? 'warn' : 'info',
        message: `🔄 Vault ${vaultAddress} trip #${history.trips.length} (source: ${source})`
      }
    });

    // Check if exceeds threshold
    if (history.trips.length >= MAX_TRIPS_IN_WINDOW) {
      this.log(`🔄 Vault ${vaultAddress} exceeded ${MAX_TRIPS_IN_WINDOW} retry trips in 24h - blacklisting`);
      return true; // Should blacklist
    }

    return false;
  }

  //#endregion

  //#region Blacklist Management

  /**
   * Blacklist a vault
   * @param {string} vaultAddress - Vault address
   * @param {string} reason - Reason for blacklisting
   */
  async blacklistVault(vaultAddress, reason) {
    const normalizedAddress = ethers.utils.getAddress(vaultAddress);

    // Full cleanup: strategy state, listeners, locks, caches
    const offboardResults = await this.offboardVault(normalizedAddress);

    // Add to blacklist
    this.blacklistedVaults.set(normalizedAddress, {
      vaultAddress: normalizedAddress,
      blacklistedAt: Date.now(),
      reason
    });

    this.eventManager.emit('VaultBlacklisted', {
      vaultAddress: normalizedAddress,
      reason,
      offboardResults,
      timestamp: Date.now(),
      log: {
        level: 'warn',
        message: `Vault ${normalizedAddress} blacklisted: ${reason}`
      }
    });

    // Persist blacklist - fatal if save fails
    try {
      await this.saveBlacklist();
    } catch (error) {
      this.handleFatalError(error);
    }
  }

  /**
   * Remove vault from blacklist
   * @param {string} vaultAddress - Vault address
   */
  async unblacklistVault(vaultAddress) {
    const normalizedAddress = ethers.utils.getAddress(vaultAddress);

    if (this.blacklistedVaults.delete(normalizedAddress)) {
      this.eventManager.emit('VaultUnblacklisted', {
        vaultAddress: normalizedAddress,
        log: {
          level: 'info',
          message: `Vault ${normalizedAddress} removed from blacklist`
        }
      });

      // Persist blacklist - fatal if save fails
      try {
        await this.saveBlacklist();
      } catch (error) {
        this.handleFatalError(error);
      }
    }
  }

  /**
   * Check if a vault is blacklisted
   * @param {string} vaultAddress - Vault address
   * @returns {boolean} True if blacklisted
   */
  isVaultBlacklisted(vaultAddress) {
    const normalizedAddress = ethers.utils.getAddress(vaultAddress);
    return this.blacklistedVaults.has(normalizedAddress);
  }

  /**
   * Get blacklist data for API
   * @returns {Object} Blacklist data
   */
  getBlacklistData() {
    const data = {};
    for (const [address, info] of this.blacklistedVaults.entries()) {
      data[address] = info;
    }
    return data;
  }

  /**
   * Get failed vaults data for API
   * @returns {Object} Failed vaults data
   */
  getFailedVaultsData() {
    const data = {};
    for (const [address, info] of this.failedVaults.entries()) {
      data[address] = info;
    }
    return data;
  }

  /**
   * Load blacklist from disk
   * @private
   * @throws {Error} If directory doesn't exist or file is invalid/unreadable
   */
  async loadBlacklist() {
    const fs = await import('fs/promises');
    const path = await import('path');

    // Verify directory exists (deployment requirement)
    const dir = path.dirname(this.blacklistFilePath);
    await fs.access(dir); // Throws if directory doesn't exist

    try {
      const data = await fs.readFile(this.blacklistFilePath, 'utf-8');
      const blacklist = JSON.parse(data);

      for (const [address, info] of Object.entries(blacklist)) {
        this.blacklistedVaults.set(address, info);
      }

      this.log(`Loaded ${this.blacklistedVaults.size} blacklisted vault(s)`);
    } catch (error) {
      if (error.code === 'ENOENT') {
        // First run - directory exists but file doesn't, create empty blacklist
        this.log('No blacklist file found, creating empty blacklist');
        await this.saveBlacklist();
        return;
      }
      // All other errors (permissions, parse errors) - fail hard
      throw error;
    }
  }

  /**
   * Save blacklist to disk
   * @private
   * @throws {Error} If write fails (directory must exist via deployment)
   */
  async saveBlacklist() {
    const fs = await import('fs/promises');
    const data = JSON.stringify(this.getBlacklistData(), null, 2);
    await fs.writeFile(this.blacklistFilePath, data, 'utf-8');
    this.log('Blacklist saved');
  }

  //#endregion

  //#region Vault Discovery

  /**
   * Discover and load all vaults authorized to this service
   * @private
   * @returns {Promise<Object>} Results summary
   */
  async loadAuthorizedVaults() {
    this.log('Discovering active vaults...');

    // Get all vaults with an active executor (Phase 1 active vault registry)
    const activeVaultAddresses = await retryRpcCall(
      () => getActiveVaults(this.provider),
      'getActiveVaults',
      { log: (msg) => this.log(msg) }
    );

    this.log(`Found ${activeVaultAddresses.length} active vault(s), verifying ownership...`);

    const results = {
      total: activeVaultAddresses.length,
      successful: [],
      failed: [],
      skippedBlacklisted: [],
      skippedNotOurs: []
    };

    for (const vaultAddress of activeVaultAddresses) {
      // Skip blacklisted vaults
      if (this.isVaultBlacklisted(vaultAddress)) {
        this.log(`Skipping blacklisted vault: ${vaultAddress}`);
        results.skippedBlacklisted.push(vaultAddress);
        continue;
      }

      // Verify this vault's executor belongs to our HD tree
      try {
        const [executorIndex, onChainExecutor] = await Promise.all([
          retryRpcCall(
            () => getVaultExecutorIndex(vaultAddress, this.provider),
            'getVaultExecutorIndex'
          ),
          retryRpcCall(
            () => getVaultContract(vaultAddress, this.provider).executor(),
            'vault.executor'
          )
        ]);

        const derivedAddress = this.hdNode.derivePath(
          "m/44'/60'/0'/0/" + executorIndex
        ).address;

        if (derivedAddress.toLowerCase() !== onChainExecutor.toLowerCase()) {
          this.log(
            `Vault ${vaultAddress} executor ${onChainExecutor} ` +
            `does not match derived ${derivedAddress} (index ${executorIndex}) — skipping`
          );
          results.skippedNotOurs.push(vaultAddress);
          continue;
        }

        this.log(`Vault ${vaultAddress} verified: executor index ${executorIndex}`);
      } catch (error) {
        console.error(`Failed to verify vault ${vaultAddress} ownership:`, error.message);
        results.failed.push({ vaultAddress, error: `ownership verification: ${error.message}` });
        continue;
      }

      // Vault is ours — set it up
      try {
        await this.setupVault(vaultAddress);
        results.successful.push(vaultAddress);
      } catch (error) {
        console.error(`Failed to setup vault ${vaultAddress}:`, error.message);
        results.failed.push({ vaultAddress, error: error.message });

        // InsufficientGasError: executor needs funding, not a retry/blacklist case
        if (error.name === 'InsufficientGasError') {
          this.vaultHealth.enterFundingRequired(vaultAddress);
          continue;
        }

        // Check if error is recoverable - blacklist immediately for unrecoverable errors
        if (this.isRecoverableError(error)) {
          try {
            await this.trackFailedVault(vaultAddress, error.message, 'initial_setup');
          } catch (handlerError) {
            console.error(`[initial_setup] trackFailedVault error for ${vaultAddress}:`, handlerError.message);
            await this.emergencyVaultCleanup(vaultAddress, `[initial_setup] trackFailedVault failed: ${handlerError.message}`);
          }
        } else {
          this.log(`Unrecoverable error during initial setup - blacklisting ${vaultAddress}`);
          await this.blacklistVault(vaultAddress, error.message);
        }
      }
    }

    this.eventManager.emit('VaultsLoaded', {
      total: results.total,
      successful: results.successful.length,
      failed: results.failed.length,
      skippedBlacklisted: results.skippedBlacklisted.length,
      skippedNotOurs: results.skippedNotOurs.length,
      timestamp: Date.now(),
      log: {
        level: results.failed.length > 0 ? 'warn' : 'info',
        message: `Loaded ${results.successful.length}/${results.total} vaults ` +
          `(${results.failed.length} failed, ${results.skippedBlacklisted.length} blacklisted, ` +
          `${results.skippedNotOurs.length} not ours)`
      }
    });

    return results;
  }

  /**
   * Set up a vault for automation
   * @param {string} vaultAddress - Vault address
   * @param {Object} [options] - Setup options
   * @param {boolean} [options.forceRefresh=true] - Force refresh vault data
   * @returns {Promise<Object>} Setup result
   */
  async setupVault(vaultAddress, options = {}) {
    const { forceRefresh = true } = options;
    const normalizedAddress = ethers.utils.getAddress(vaultAddress);

    this.log(`Setting up vault ${normalizedAddress}...`);

    let vault = null;
    let step = 'vault_loading';
    let baselineCaptured = false;

    try {
      // Step 1: Load vault data
      this.log(`Step 1: Loading vault data for ${normalizedAddress}`);
      vault = await this.vaultDataService.getVault(normalizedAddress, forceRefresh);

      if (!vault) {
        throw new Error(`Failed to get vault data for ${normalizedAddress}`);
      }

      this.log(`Loaded vault ${normalizedAddress} with ${Object.keys(vault.positions).length} position(s)`);

      // Step 2: Capture baseline asset values (if not already tracked)
      step = 'baseline_capture';
      if (!this.tracker.getMetadata(normalizedAddress)) {
        this.log(`Step 2: Capturing baseline for ${normalizedAddress}`);
        const baselineAssets = await this.vaultDataService.fetchAssetValues(vault);

        this.eventManager.emit('VaultBaselineCaptured', {
          vaultAddress: normalizedAddress,
          totalVaultValue: baselineAssets.totalVaultValue,
          tokenValue: baselineAssets.totalTokenValue,
          positionValue: baselineAssets.totalPositionValue,
          tokens: baselineAssets.tokens,
          positions: baselineAssets.positions,
          timestamp: Date.now(),
          capturePoint: 'pre_initialization',
          strategyId: vault.strategy.strategyId,
          log: {
            level: 'info',
            message: `Captured baseline for vault ${normalizedAddress}: $${baselineAssets.totalVaultValue.toFixed(2)}`
          }
        });

        baselineCaptured = true;
      } else {
        this.log(`Step 2: Skipped baseline capture (already tracked) for ${normalizedAddress}`);
      }

      // Step 3: Strategy initialization (approvals, wrapping, etc.)
      step = 'strategy_initialization';
      this.log(`Step 3: Initializing strategy for ${normalizedAddress}`);

      const strategy = this.strategies.get(vault.strategy.strategyId);
      if (!strategy) {
        throw new UnrecoverableError(`Strategy ${vault.strategy.strategyId} not found`);
      }

      const initSuccess = await strategy.initializeVault(vault);
      if (!initSuccess) {
        throw new Error('Strategy initialization failed');
      }

      // Step 4: Start monitoring (swap events, config changes)
      step = 'monitoring_setup';
      this.log(`Step 4: Starting monitoring for ${normalizedAddress}`);
      await this.startMonitoringVault(vault);

      // Step 5: Register with VaultHealth for executor monitoring
      this.vaultHealth.addVault(normalizedAddress);

      this.eventManager.emit('VaultSetupComplete', {
        vaultAddress: normalizedAddress,
        strategyId: vault.strategy?.strategyId,
        positionCount: Object.keys(vault.positions).length,
        tokenCount: Object.keys(vault.tokens).length,
        baselineCaptured,
        strategyInitialized: true,
        monitoringStarted: true,
        timestamp: Date.now(),
        log: {
          level: 'info',
          message: `Vault ${normalizedAddress} setup complete (steps 1-4)`
        }
      });

      return {
        success: true,
        vault,
        vaultLoaded: true,
        baselineCaptured,
        strategyInitialized: true,
        monitoringStarted: true
      };

    } catch (error) {
      this.eventManager.emit('VaultSetupFailed', {
        vaultAddress: normalizedAddress,
        error: error.message,
        step,
        timestamp: Date.now(),
        log: {
          level: 'error',
          message: `Vault ${normalizedAddress} setup failed: ${error.message}`
        }
      });

      throw error;
    }
  }

  //#endregion

  //#region Monitoring Setup

  /**
   * Start monitoring for a vault (swap events + config events)
   * @param {Object} vault - Vault object
   * @private
   */
  async startMonitoringVault(vault) {
    this.log(`Starting monitoring for vault ${vault.address}`);

    // Validate vault has strategy
    if (!vault.strategy?.strategyId) {
      throw new UnrecoverableError(`Vault ${vault.address} missing strategy data`);
    }

    const strategy = this.strategies.get(vault.strategy.strategyId);
    if (!strategy) {
      throw new UnrecoverableError(`Strategy ${vault.strategy.strategyId} not found`);
    }

    // Set up swap event monitoring for all position pools (delegated to EventManager)
    await retryWithBackoff(
      () => this.eventManager.subscribeToSwapEvents(vault, this.provider, this.chainId),
      {
        maxRetries: 2,
        baseDelay: 1000,
        exponential: true,
        context: `Setting up swap monitoring for vault ${vault.address}`,
        logger: console
      }
    );

    // Set up vault config change monitoring (delegated to EventManager)
    await retryWithBackoff(
      () => this.eventManager.subscribeToVaultConfigEvents(vault, this.provider, this.chainId),
      {
        maxRetries: 2,
        baseDelay: 1000,
        exponential: true,
        context: `Setting up config monitoring for vault ${vault.address}`,
        logger: console
      }
    );

    // Strategy-specific additional monitoring (required interface method)
    await retryWithBackoff(
      () => strategy.setupAdditionalMonitoring(vault),
      {
        maxRetries: 2,
        baseDelay: 1000,
        exponential: true,
        context: `Setting up additional monitoring for vault ${vault.address}`,
        logger: console
      }
    );

    this.eventManager.emit('MonitoringStarted', {
      vaultAddress: vault.address,
      strategyId: vault.strategy.strategyId,
      positionCount: Object.keys(vault.positions).length,
      chainId: this.chainId,
      timestamp: Date.now(),
      log: {
        level: 'info',
        message: `Monitoring started for vault ${vault.address}`
      }
    });
  }

  //#endregion

  //#region Swap Event Handling

  /**
   * Handle swap events from monitored pools
   * @param {Object} data - Swap event data
   * @param {string} data.vaultAddress - Vault address
   * @param {string} data.poolId - Pool where swap occurred
   * @param {string} data.platform - Platform identifier
   * @param {Object} data.log - Raw log from blockchain
   */
  async handleSwapEvent(data) {
    const { vaultAddress, poolId, platform, log } = data;

    // Skip if shutting down
    if (this.isShuttingDown) {
      this.log(`Swap event for vault ${vaultAddress} ignored - service is shutting down`);
      return;
    }

    // Skip if vault is in retry queue (will be re-setup on next retry cycle)
    if (this.failedVaults.has(vaultAddress)) {
      this.log(`Swap event for vault ${vaultAddress} ignored - vault in retry queue`);
      return;
    }

    // Acquire vault lock
    if (!this.lockVault(vaultAddress)) {
      this.log(`Vault ${vaultAddress} locked, skipping swap event`);
      return;
    }

    try {
      // Get vault data
      const vault = await this.vaultDataService.getVault(vaultAddress);
      if (!vault) {
        throw new UnrecoverableError(`Vault ${vaultAddress} not found in VaultDataService`);
      }

      // Get strategy
      const strategy = this.strategies.get(vault.strategy.strategyId);
      if (!strategy) {
        throw new UnrecoverableError(`Strategy ${vault.strategy.strategyId} not found`);
      }

      // Delegate to strategy
      await strategy.handleSwapEvent(vault, poolId, platform, log);

    } catch (error) {
      console.error(`Error processing swap event for vault ${vaultAddress}:`, error);

      // InsufficientGasError: executor needs funding, skip vault without retry/blacklist
      if (error.name === 'InsufficientGasError') {
        this.vaultHealth.enterFundingRequired(vaultAddress);
      } else if (this.isRecoverableError(error)) {
        // Recoverable: add to retry queue for re-setup
        try {
          await this.trackFailedVault(vaultAddress, error.message, 'swap_event');
          this.log(`Vault ${vaultAddress} added to retry queue: ${error.message}`);
        } catch (handlerError) {
          console.error(`[swap_event] trackFailedVault error for ${vaultAddress}:`, handlerError.message);
          await this.emergencyVaultCleanup(vaultAddress, `[swap_event] trackFailedVault failed: ${handlerError.message}`);
        }
      } else {
        // Unrecoverable: blacklist immediately
        await this.blacklistVault(vaultAddress, error.message);
        this.log(`Vault ${vaultAddress} blacklisted due to unrecoverable error: ${error.message}`);
      }

      this.eventManager.emit('SwapEventFailed', {
        vaultAddress,
        poolId,
        error: error.message,
        recoverable: this.isRecoverableError(error),
        timestamp: Date.now(),
        log: {
          level: 'error',
          message: `Swap event processing failed for vault ${vaultAddress}: ${error.message}`
        }
      });
    } finally {
      this.unlockVault(vaultAddress);
    }
  }

  /**
   * Check if an error is recoverable via retry
   *
   * Uses prefix convention: errors starting with "UNRECOVERABLE ERROR:" are
   * permanent failures that should blacklist the vault. All other errors
   * are considered recoverable and will be retried.
   *
   * @param {Error} error - The error that occurred
   * @returns {boolean} True if error is recoverable (vault should retry)
   */
  isRecoverableError(error) {
    return !(error instanceof UnrecoverableError || error.isUnrecoverable);
  }

  /**
   * Attempt to acquire lock on a vault
   * @param {string} vaultAddress - Vault address to lock
   * @returns {boolean} True if lock acquired, false if already locked
   */
  lockVault(vaultAddress) {
    const normalized = ethers.utils.getAddress(vaultAddress);
    if (this.vaultLocks[normalized]) {
      return false;
    }
    this.vaultLocks[normalized] = Date.now();
    this.log(`Locked vault ${vaultAddress} for exclusive processing`);

    this.eventManager.emit('VaultLocked', {
      vaultAddress: normalized,
      timestamp: Date.now()
    });

    return true;
  }

  /**
   * Release lock on a vault
   * @param {string} vaultAddress - Vault address to unlock
   */
  unlockVault(vaultAddress) {
    const normalized = ethers.utils.getAddress(vaultAddress);
    delete this.vaultLocks[normalized];
    this.log(`Unlocked vault ${vaultAddress} after processing`);

    this.eventManager.emit('VaultUnlocked', {
      vaultAddress: normalized,
      timestamp: Date.now()
    });
  }

  //#endregion

  //#region Config Update Handling

  /**
   * Handle config update with lock awareness
   * If vault is locked (operation in progress), queue the update for later.
   * If not locked, apply immediately.
   * @param {string} vaultAddress - Vault address
   * @param {string} type - 'tokens' or 'platforms'
   * @param {Array} data - New config data (token symbols or platform IDs)
   */
  async handleConfigUpdate(vaultAddress, type, data) {
    const normalized = ethers.utils.getAddress(vaultAddress);

    if (this.isShuttingDown) {
      this.log(`Ignoring ${type} config update - service shutting down`);
      return;
    }

    // Check if vault is locked (operation in progress)
    if (this.vaultLocks[normalized]) {
      this.log(`Vault ${vaultAddress} locked - queueing ${type} update`);
      this.queueConfigUpdate(normalized, type, data);
      return;
    }

    // Not locked - apply immediately
    await this.applyConfigUpdate(normalized, type, data);
  }

  /**
   * Queue a config update for later processing when vault unlocks
   * If an update of the same type is already queued, replace it (latest wins)
   * @param {string} vaultAddress - Normalized vault address
   * @param {string} type - 'tokens' or 'platforms'
   * @param {Array} data - New config data
   */
  queueConfigUpdate(vaultAddress, type, data) {
    if (!this.pendingConfigUpdates.has(vaultAddress)) {
      this.pendingConfigUpdates.set(vaultAddress, []);
    }

    const queue = this.pendingConfigUpdates.get(vaultAddress);

    // Replace existing update of same type (latest wins)
    const existingIndex = queue.findIndex(u => u.type === type);
    if (existingIndex >= 0) {
      queue[existingIndex] = { type, data, timestamp: Date.now() };
      this.log(`Replaced queued ${type} update for ${vaultAddress}`);
    } else {
      queue.push({ type, data, timestamp: Date.now() });
      this.log(`Queued ${type} update for ${vaultAddress}`);
    }
  }

  /**
   * Apply a config update to VDS cache
   * @param {string} vaultAddress - Normalized vault address
   * @param {string} type - 'tokens', 'platforms', or 'params'
   * @param {Array|string} data - New config data (array for tokens/platforms, string paramName for params)
   */
  async applyConfigUpdate(vaultAddress, type, data) {
    try {
      let updated;
      if (type === 'tokens') {
        updated = await this.vaultDataService.updateTargetTokens(vaultAddress, data);
      } else if (type === 'platforms') {
        updated = await this.vaultDataService.updateTargetPlatforms(vaultAddress, data);
      } else if (type === 'params') {
        updated = await this.vaultDataService.updateStrategyParameters(vaultAddress);
      } else {
        throw new Error(`Unknown config update type: ${type}`);
      }

      if (!updated) {
        throw new Error(`Failed to update ${type} in cache`);
      }

      // Log and notify based on type
      if (type === 'params') {
        this.log(`Applied ${type} update for ${vaultAddress}: ${data}`);
        this.sendTelegramMessage(
          `⚙️ Strategy parameters updated for vault ${vaultAddress.slice(0, 6)}...${vaultAddress.slice(-4)}: ${data}`
        ).catch(err => console.error('Telegram notification error:', err));
      } else {
        this.log(`Applied ${type} update for ${vaultAddress}: ${data.join(', ')}`);
        this.sendTelegramMessage(
          `🔄 Target ${type} updated for vault ${vaultAddress.slice(0, 6)}...${vaultAddress.slice(-4)}: ${data.join(', ')}`
        ).catch(err => console.error('Telegram notification error:', err));
      }

    } catch (error) {
      console.error(`Error applying ${type} update for ${vaultAddress}:`, error);
      // Track as failed vault for retry
      try {
        await this.trackFailedVault(vaultAddress, error.message, 'config_update');
      } catch (handlerError) {
        console.error(`[config_update] trackFailedVault error for ${vaultAddress}:`, handlerError.message);
        await this.emergencyVaultCleanup(vaultAddress, `[config_update] trackFailedVault failed: ${handlerError.message}`);
      }
    }
  }

  /**
   * Process any pending config updates for a vault after it unlocks
   * @param {string} vaultAddress - Vault address (will be normalized)
   */
  async processPendingConfigUpdates(vaultAddress) {
    const normalized = ethers.utils.getAddress(vaultAddress);
    const pending = this.pendingConfigUpdates.get(normalized);

    if (!pending || pending.length === 0) {
      return;
    }

    this.log(`Processing ${pending.length} pending config update(s) for ${vaultAddress}`);

    for (const update of pending) {
      await this.applyConfigUpdate(normalized, update.type, update.data);
    }

    this.pendingConfigUpdates.delete(normalized);
  }

  /**
   * Clear pending config updates for a vault (used during cleanup/blacklist)
   * @param {string} vaultAddress - Vault address (will be normalized)
   */
  clearPendingConfigUpdates(vaultAddress) {
    const normalized = ethers.utils.getAddress(vaultAddress);
    if (this.pendingConfigUpdates.has(normalized)) {
      this.pendingConfigUpdates.delete(normalized);
      this.log(`Cleared pending config updates for ${vaultAddress}`);
    }
  }

  //#endregion

  //#region Crash Handlers

  /**
   * Set up process crash handlers
   * @private
   */
  setupCrashHandlers() {
    // Skip in test environment to prevent interference with test runner
    if (process.env.NODE_ENV === 'test') {
      return;
    }

    this._sigintHandler = async () => {
      console.log('\nReceived SIGINT, shutting down gracefully...');
      await this.stop();
      process.exit(0);
    };

    this._sigtermHandler = async () => {
      console.log('\nReceived SIGTERM, shutting down gracefully...');
      await this.stop();
      process.exit(0);
    };

    this._uncaughtExceptionHandler = (error) => {
      console.error('Uncaught Exception:', error);
      this.handleFatalError(error);
    };

    this._unhandledRejectionHandler = (reason, promise) => {
      console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    };

    process.on('SIGINT', this._sigintHandler);
    process.on('SIGTERM', this._sigtermHandler);
    process.on('uncaughtException', this._uncaughtExceptionHandler);
    process.on('unhandledRejection', this._unhandledRejectionHandler);
  }

  /**
   * Handle fatal error
   * @private
   */
  handleFatalError(error) {
    console.error('FATAL ERROR:', error);
    this.stop().finally(() => {
      process.exit(1);
    });
  }

  //#endregion

  //#region Helpers

  /**
   * Log message if debug enabled
   * @private
   */
  log(message) {
    if (this.debug) {
      console.log(`[AutomationService] ${message}`);
    }
  }

  /**
   * Send Telegram notification (placeholder)
   * @param {string} message - Message to send
   */
  sendTelegramMessage(message) {
    // TODO: Implement Telegram integration
    this.log(`[Telegram] ${message}`);
    return Promise.resolve();
  }

  /**
   * Get service status
   * @returns {Object} Service status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      chainId: this.chainId,
      adaptersLoaded: this.adapters.size,
      tokensLoaded: Object.keys(this.tokens).length,
      poolsCached: Object.keys(this.poolData).length,
      vaultsCached: this.vaultDataService.getAllVaults().length,
      failedVaults: this.failedVaults.size,
      blacklistedVaults: this.blacklistedVaults.size,
      sse: this.sseBroadcaster.getStatus(),
      vaultHealth: this.vaultHealth.getStatus()
    };
  }

  //#endregion
}

export default AutomationService;
