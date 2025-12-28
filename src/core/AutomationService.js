/**
 * @module core/AutomationService
 * @description Main service orchestrating vault automation with multi-strategy, multi-platform support.
 * @since 2.0.0
 */

import { ethers } from 'ethers';
import { getAdaptersForChain, getAllTokens, getContract, getAuthorizedVaults } from 'fum_library';
import { retryRpcCall } from '../utils/RetryHelper.js';

import EventManager from './EventManager.js';
import VaultDataService from './VaultDataService.js';
import SSEBroadcaster from './SSEBroadcaster.js';
import Tracker from './Tracker.js';
import { BabyStepsStrategy } from '../strategies/index.js';

/**
 * Main automation service class
 * @class AutomationService
 */
class AutomationService {
  /**
   * Creates a new AutomationService instance
   * @param {Object} config - Service configuration
   * @param {string} config.automationServiceAddress - Address of the automation service wallet
   * @param {number} config.chainId - Chain ID for the network
   * @param {string} config.wsUrl - WebSocket RPC URL
   * @param {boolean} [config.debug=false] - Enable debug logging
   * @param {number} [config.retryIntervalMs=300000] - Retry interval for failed vaults (5 minutes)
   * @param {number} [config.maxFailureDurationMs=3600000] - Max failure duration before blacklist (1 hour)
   * @param {number} [config.ssePort=3001] - SSE server port
   * @param {string} [config.blacklistFilePath='./data/blacklist.json'] - Path to blacklist file
   * @param {string} [config.trackingDataDir='./data/vaults'] - Directory for vault tracking data
   */
  constructor(config) {
    // Validate required config
    this.validateConfig(config);

    // Store configuration
    this.automationServiceAddress = config.automationServiceAddress;
    this.chainId = config.chainId;
    this.wsUrl = config.wsUrl;
    this.debug = config.debug || false;
    this.retryIntervalMs = config.retryIntervalMs || 300000;
    this.maxFailureDurationMs = config.maxFailureDurationMs || 3600000;
    this.ssePort = config.ssePort || 3001;
    this.blacklistFilePath = config.blacklistFilePath || './data/blacklist.json';
    this.trackingDataDir = config.trackingDataDir || './data/vaults';

    // Service state
    this.isRunning = false;
    this.isShuttingDown = false;
    this.provider = null;

    // Caches
    this.contracts = {};
    this.adapters = new Map();
    this.tokens = {};
    this.poolData = {};

    // Vault management
    this.vaultLocks = {};
    this.failedVaults = new Map();
    this.blacklistedVaults = new Map();

    // Core dependencies
    this.eventManager = new EventManager();
    this.eventManager.setDebug(this.debug);

    this.vaultDataService = new VaultDataService(this.eventManager);

    this.tracker = new Tracker({
      dataDir: this.trackingDataDir,
      eventManager: this.eventManager,
      debug: this.debug
    });

    this.sseBroadcaster = new SSEBroadcaster(this.eventManager, {
      port: this.ssePort,
      debug: this.debug,
      getBlacklist: () => this.getBlacklistData(),
      getVaultMetadata: (addr) => this.tracker.getMetadata(addr),
      getVaultTransactions: (addr, start, end) => this.tracker.getTransactions(addr, start, end),
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
    if (!config.automationServiceAddress) {
      throw new Error('automationServiceAddress is required');
    }
    if (!ethers.utils.isAddress(config.automationServiceAddress)) {
      throw new Error('automationServiceAddress must be a valid Ethereum address');
    }
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

      // Phase 3: Discover and load authorized vaults
      await this.loadAuthorizedVaults();

      // Phase 4: Initialize tracker
      await this.tracker.initialize();

      // Phase 5: Start SSE broadcaster
      await this.sseBroadcaster.start();

      // Phase 6: Subscribe to global blockchain events
      this.subscribeToAuthorizationEvents();
      this.subscribeToStrategyParameterEvents();

      // Phase 7: Start failed vault retry timer
      this.startFailedVaultRetryTimer();

      this.isRunning = true;

      this.eventManager.emit('ServiceStarted', {
        chainId: this.chainId,
        automationServiceAddress: this.automationServiceAddress,
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
   * @returns {Promise<void>}
   */
  async stop(force = false) {
    if (!this.isRunning && !force) {
      this.log('Service is not running');
      return;
    }

    this.log(force ? 'Force stopping AutomationService...' : 'Stopping AutomationService...');
    this.isShuttingDown = true;

    // Disable event processing
    this.eventManager.setEnabled(false);

    // Stop failed vault retry timer
    if (this.failedVaultRetryTimer) {
      clearInterval(this.failedVaultRetryTimer);
      this.failedVaultRetryTimer = null;
    }

    // Remove all event listeners
    await this.eventManager.removeAllListeners();

    // Stop SSE broadcaster
    await this.sseBroadcaster.stop();

    // Shutdown tracker (persists data)
    await this.tracker.shutdown();

    // Save blacklist - log error but don't block shutdown
    try {
      await this.saveBlacklist();
    } catch (error) {
      console.error('Failed to save blacklist during shutdown:', error);
    }

    // Close provider connection
    if (this.provider) {
      this.provider.removeAllListeners();
      // Destroy WebSocket connection
      if (typeof this.provider.destroy === 'function') {
        await this.provider.destroy();
      }
      this.provider = null;
    }

    this.isRunning = false;
    this.isShuttingDown = false;

    this.log('AutomationService stopped');
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

      // 6. Set up VaultDataService logging
      this.setupVaultDataServiceLogging();

      // 7. Pre-initialize strategy contracts
      await this.initializeStrategyContracts();

      // 8. Update strategy dependencies with runtime values
      this.updateStrategyDependencies();

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

    // Test connection with retry logic for transient network failures
    const network = await retryRpcCall(
      () => this.provider.getNetwork(),
      'getNetwork',
      { log: (msg) => this.log(msg) }
    );

    if (network.chainId !== this.chainId) {
      throw new Error(`Provider chain ID (${network.chainId}) does not match config (${this.chainId})`);
    }

    this.log(`Connected to chain ${network.chainId} (${network.name})`);
  }

  /**
   * Initialize platform adapters
   * @private
   */
  async initializeAdapters() {
    this.log('Initializing platform adapters...');

    const result = getAdaptersForChain(this.chainId, this.provider);

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
    for (const [symbol, token] of Object.entries(allTokens)) {
      if (token.addresses && token.addresses[this.chainId]) {
        this.tokens[symbol] = {
          ...token,
          address: token.addresses[this.chainId]
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
      automationServiceAddress: this.automationServiceAddress,
      wsUrl: this.wsUrl,
      debug: this.debug
    };

    for (const [strategyId, strategy] of this.strategies) {
      strategy.provider = this.provider;
      strategy.adapters = this.adapters;
      strategy.tokens = this.tokens;
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
  }

  /**
   * Subscribe to authorization events (ExecutorChanged)
   * @private
   */
  subscribeToAuthorizationEvents() {
    this.log('Subscribing to authorization events...');

    const filter = {
      topics: [ethers.utils.id('ExecutorChanged(address,bool)')]
    };

    const handleExecutorChanged = async (log) => {
      try {
        const executorAddress = '0x' + log.topics[1].slice(26);
        const isAuthorized = log.topics[2].endsWith('1');
        const vaultAddress = log.address;

        // Only process events for our automation service
        if (executorAddress.toLowerCase() !== this.automationServiceAddress.toLowerCase()) {
          return;
        }

        if (isAuthorized) {
          this.eventManager.emit('VaultAuthGranted', {
            vaultAddress,
            executorAddress,
            log: {
              level: 'info',
              message: `New vault authorization detected: ${vaultAddress}`
            }
          });
        } else {
          this.eventManager.emit('VaultAuthRevoked', {
            vaultAddress,
            executorAddress,
            log: {
              level: 'warn',
              message: `Vault authorization revoked: ${vaultAddress}`
            }
          });
        }
      } catch (error) {
        console.error('Error handling executor change event:', error);
      }
    };

    this.eventManager.registerFilterListener({
      provider: this.provider,
      filter,
      handler: handleExecutorChanged,
      address: 'global',
      eventType: 'authorization',
      chainId: this.chainId,
      additionalId: 'executor-changed'
    });

    this.log('Subscribed to authorization events');
  }

  /**
   * Subscribe to strategy parameter update events
   * @private
   */
  subscribeToStrategyParameterEvents() {
    this.log('Subscribing to strategy parameter events...');

    // Get strategy contract addresses
    const strategyAddresses = [];
    if (this.contracts.bobStrategy) {
      strategyAddresses.push(this.contracts.bobStrategy.address);
    }
    // Future: Add other strategy addresses

    if (strategyAddresses.length === 0) {
      this.log('No strategy contracts loaded, skipping parameter event subscription');
      return;
    }

    const handleParameterUpdate = async (log) => {
      try {
        const iface = new ethers.utils.Interface([
          'event ParameterUpdated(address indexed vault, string paramName)'
        ]);
        const parsed = iface.parseLog(log);
        const vaultAddress = parsed.args[0];
        const paramName = parsed.args[1];

        // Skip if vault is not being monitored
        if (!this.vaultDataService.hasVault(vaultAddress)) {
          return;
        }

        this.log(`Strategy parameter updated for vault ${vaultAddress}: ${paramName}`);

        // Refresh vault data
        await this.vaultDataService.getVault(vaultAddress, true);

        this.eventManager.emit('StrategyParameterUpdated', {
          vaultAddress,
          paramName,
          log: {
            level: 'info',
            message: `Strategy parameters updated for vault ${vaultAddress}: ${paramName}`
          }
        });
      } catch (error) {
        console.error('Error handling parameter update event:', error);
      }
    };

    // Create separate listener for each strategy address
    for (let i = 0; i < strategyAddresses.length; i++) {
      const strategyAddress = strategyAddresses[i];
      const filter = {
        address: strategyAddress,
        topics: [ethers.utils.id('ParameterUpdated(address,string)')]
      };

      this.eventManager.registerFilterListener({
        provider: this.provider,
        filter,
        handler: handleParameterUpdate,
        address: strategyAddress,
        eventType: 'parameter-update',
        chainId: this.chainId,
        additionalId: `strategy-${i}`
      });
    }

    this.log(`Subscribed to parameter events for ${strategyAddresses.length} strategy contract(s)`);
  }

  //#endregion

  //#region Failed Vault Management

  /**
   * Start the failed vault retry timer
   * @private
   */
  startFailedVaultRetryTimer() {
    this.failedVaultRetryTimer = setInterval(() => {
      this.retryFailedVaults();
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
        this.blacklistVault(vaultAddress, failureData.lastError);
        this.failedVaults.delete(vaultAddress);
        continue;
      }

      // TODO: Implement retry logic for failed vaults
      // This will be implemented when we add vault initialization logic
    }
  }

  /**
   * Track a failed vault
   * @param {string} vaultAddress - Vault address
   * @param {string} error - Error message
   */
  trackFailedVault(vaultAddress, error) {
    const existing = this.failedVaults.get(vaultAddress);

    if (existing) {
      existing.attempts += 1;
      existing.lastError = error;
      existing.lastAttemptAt = Date.now();
    } else {
      this.failedVaults.set(vaultAddress, {
        vaultAddress,
        firstFailedAt: Date.now(),
        lastAttemptAt: Date.now(),
        lastError: error,
        attempts: 1
      });
    }

    this.eventManager.emit('VaultLoadFailed', {
      vaultAddress,
      error,
      attempts: this.failedVaults.get(vaultAddress).attempts,
      log: {
        level: 'warn',
        message: `Vault ${vaultAddress} failed: ${error}`
      }
    });
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

    this.blacklistedVaults.set(normalizedAddress, {
      vaultAddress: normalizedAddress,
      blacklistedAt: Date.now(),
      reason
    });

    this.eventManager.emit('VaultBlacklisted', {
      vaultAddress: normalizedAddress,
      reason,
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
    this.log('Discovering authorized vaults...');

    // Get all vaults that have authorized this executor
    const authorizedVaultAddresses = await retryRpcCall(
      () => getAuthorizedVaults(this.automationServiceAddress, this.provider),
      'getAuthorizedVaults',
      { log: (msg) => this.log(msg) }
    );

    this.log(`Found ${authorizedVaultAddresses.length} authorized vault(s)`);

    const results = {
      total: authorizedVaultAddresses.length,
      successful: [],
      failed: [],
      skippedBlacklisted: []
    };

    for (const vaultAddress of authorizedVaultAddresses) {
      // Skip blacklisted vaults
      if (this.isVaultBlacklisted(vaultAddress)) {
        this.log(`Skipping blacklisted vault: ${vaultAddress}`);
        results.skippedBlacklisted.push(vaultAddress);
        continue;
      }

      try {
        await this.setupVault(vaultAddress);
        results.successful.push(vaultAddress);
      } catch (error) {
        console.error(`Failed to setup vault ${vaultAddress}:`, error.message);
        results.failed.push({ vaultAddress, error: error.message });
        this.trackFailedVault(vaultAddress, error.message);
      }
    }

    this.eventManager.emit('VaultsLoaded', {
      total: results.total,
      successful: results.successful.length,
      failed: results.failed.length,
      skippedBlacklisted: results.skippedBlacklisted.length,
      timestamp: Date.now(),
      log: {
        level: results.failed.length > 0 ? 'warn' : 'info',
        message: `Loaded ${results.successful.length}/${results.total} vaults (${results.failed.length} failed, ${results.skippedBlacklisted.length} blacklisted)`
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
        throw new Error(`Strategy ${vault.strategy.strategyId} not found`);
      }

      const initSuccess = await strategy.initializeVault(vault);
      if (!initSuccess) {
        throw new Error('Strategy initialization failed');
      }

      // TODO: Step 4 - Monitoring setup (future)
      step = 'monitoring_setup';

      this.eventManager.emit('VaultSetupComplete', {
        vaultAddress: normalizedAddress,
        strategyId: vault.strategy?.strategyId,
        positionCount: Object.keys(vault.positions).length,
        tokenCount: Object.keys(vault.tokens).length,
        baselineCaptured,
        strategyInitialized: true,
        timestamp: Date.now(),
        log: {
          level: 'info',
          message: `Vault ${normalizedAddress} setup complete (steps 1-3)`
        }
      });

      return {
        success: true,
        vault,
        vaultLoaded: true,
        baselineCaptured,
        strategyInitialized: true
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
  }

  /**
   * Get service status
   * @returns {Object} Service status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      chainId: this.chainId,
      automationServiceAddress: this.automationServiceAddress,
      adaptersLoaded: this.adapters.size,
      tokensLoaded: Object.keys(this.tokens).length,
      poolsCached: Object.keys(this.poolData).length,
      vaultsCached: this.vaultDataService.getAllVaults().length,
      failedVaults: this.failedVaults.size,
      blacklistedVaults: this.blacklistedVaults.size,
      sse: this.sseBroadcaster.getStatus()
    };
  }

  //#endregion
}

export default AutomationService;
