/**
 * @module AutomationService
 * @description Core service for managing automated vault operations and strategy execution.
 * Handles vault monitoring, event processing, and strategy delegation for DeFi vaults.
 * @since 1.0.0
 */

// src/AutomationService.js
import { ethers } from 'ethers';
import BabyStepsStrategy from './strategies/BabyStepsStrategy.js';
import EventManager from './EventManager.js';
import VaultDataService from './VaultDataService.js';
import Tracker from './Tracker.js';
import SSEBroadcaster from './SSEBroadcaster.js';
import { retryWithBackoff, retryBatchOperations } from './RetryHelper.js';
import { getChainConfig, AdapterFactory, getTokensByChain } from 'fum_library';
import { getContract, getVaultFactory, getAuthorizedVaults } from 'fum_library/blockchain/contracts';
// Permit2 canonical address - same on all chains
// See: https://github.com/Uniswap/permit2#deployments
const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
import ERC20ARTIFACT from '@openzeppelin/contracts/build/contracts/ERC20.json' with { type: 'json' };
import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';

const ERC20_ABI = ERC20ARTIFACT.abi;

/**
 * Core automation service that manages vault monitoring and strategy execution
 * @class AutomationService
 * @memberof module:AutomationService
 * @description Orchestrates automated operations for DeFi vaults including position monitoring,
 * rebalancing, and strategy execution. Integrates with various strategies and manages event-driven workflows.
 * @since 1.0.0
 */
class AutomationService {
  /**
   * Creates an instance of AutomationService
   * @memberof module:AutomationService~AutomationService
   * @param {Object} config - Service configuration options
   * @param {string} config.automationServiceAddress - Required automation service executor's address
   * @param {number} config.chainId - Blockchain chain ID
   * @param {string} config.wsUrl - WebSocket RPC URL (required for real-time event streaming)
   * @param {boolean} [config.debug=false] - Enable debug logging
   * @param {number} config.retryIntervalMs - Interval between retry cycles for failed vaults (in milliseconds)
   * @throws {Error} If required configuration is missing
   * @since 1.0.0
   */
  constructor(config = {}) {
    // Validate configuration object
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      throw new Error('Configuration must be a valid object');
    }

    // Validate required parameters with proper type and value checking
    this._validateAddress(config.automationServiceAddress, 'automationServiceAddress');
    this._validateChainId(config.chainId);
    this._validateWebSocketUrl(config.wsUrl);
    this._validateBoolean(config.debug);

    // Validate blacklistFilePath (optional, defaults to './data/.vault-blacklist.json')
    const blacklistFilePath = config.blacklistFilePath || './data/.vault-blacklist.json';
    if (typeof blacklistFilePath !== 'string') {
      throw new Error('blacklistFilePath must be a string path');
    }

    // Validate trackingDataDir (optional, defaults to './data/vaults')
    const trackingDataDir = config.trackingDataDir || './data/vaults';
    if (typeof trackingDataDir !== 'string') {
      throw new Error('trackingDataDir must be a string path');
    }

    // Validate retryIntervalMs is required and must be a positive integer
    if (!config.retryIntervalMs || typeof config.retryIntervalMs !== 'number' || !Number.isInteger(config.retryIntervalMs) || config.retryIntervalMs <= 0) {
      throw new Error('retryIntervalMs is required in configuration and must be a positive integer (milliseconds)');
    }

    // Validate maxFailureDurationMs is required and must be a positive integer
    if (!config.maxFailureDurationMs || typeof config.maxFailureDurationMs !== 'number' || !Number.isInteger(config.maxFailureDurationMs) || config.maxFailureDurationMs <= 0) {
      throw new Error('maxFailureDurationMs is required in configuration and must be a positive integer (milliseconds)');
    }

    // Store configuration values as individual properties
    this.automationServiceAddress = config.automationServiceAddress;
    this.chainId = config.chainId;
    this.wsUrl = config.wsUrl;
    this.debug = config.debug;
    this.trackingDataDir = trackingDataDir;
    this.retryIntervalMs = config.retryIntervalMs;

    this.isRunning = false;
    this.isShuttingDown = false;
    this.provider = null; // Single provider instead of chainId-keyed object
    this.contracts = {}; // Pre-initialized contract instances for optimal performance

    // Vault locking system to prevent race conditions
    this.vaultLocks = {};

    // Platform adapters (initialized during service startup)
    this.adapters = new Map();

    // Token configurations (initialized during service startup)
    this.tokens = {}; // symbol → token config

    // Pool data cache (poolAddress → metadata including multi-period TVL data with day-based freshness)
    this.poolData = {}; // poolAddress → {token0Symbol, token1Symbol, fee, platform, averageTVL?}

    // Failed vaults tracking for retry and external communication
    this.failedVaults = new Map(); // vaultAddress → { error, attempts, lastAttempt, firstFailure }

    // Blacklisted vaults (persistent failures) - prevents infinite retry loops
    this.blacklistedVaults = new Map(); // vaultAddress → { reason, blacklistedAt, firstFailure, lastError, attempts }
    this.blacklistFilePath = blacklistFilePath;
    this.maxFailureDuration = config.maxFailureDurationMs;

    // Initialize centralized event manager
    this.eventManager = new EventManager();
    this.eventManager.setDebug(this.debug);

    // Initialize VaultDataService instance with our event manager
    this.vaultDataService = new VaultDataService(this.eventManager);

    // Initialize Tracker for vault performance monitoring
    this.tracker = new Tracker({
      dataDir: this.trackingDataDir,
      eventManager: this.eventManager,
      debug: this.debug
    });

    // Validate ssePort is required
    if (!config.ssePort || typeof config.ssePort !== 'number') {
      throw new Error('ssePort is required in configuration and must be a number');
    }

    // Initialize SSE broadcaster for real-time event streaming to frontend
    this.sseBroadcaster = new SSEBroadcaster(this.eventManager, {
      port: config.ssePort,
      debug: this.debug,
      getBlacklist: () => Object.fromEntries(this.blacklistedVaults),
      getVaultMetadata: (vaultAddress) => this.tracker.getMetadata(vaultAddress),
      getVaultTransactions: (vaultAddress, startTime, endTime) => this.tracker.getTransactions(vaultAddress, startTime, endTime),
      onCrash: (error) => {
        console.error('[AutomationService] SSE broadcaster crashed - shutting down entire service');
        process.exit(1);
      }
    });

    // Initialize strategy instances with dependency injection
    const strategyDependencies = {
      vaultDataService: this.vaultDataService,
      eventManager: this.eventManager,
      provider: null, // Will be set during initialization
      debug: this.debug,
      chainId: this.chainId,
      vaultLocks: this.vaultLocks,
      poolData: this.poolData,
      adapters: null, // Will be set during initialization
      tokens: null, // Will be set during initialization
      serviceConfig: null, // Will be set during initialization
      automationService: this, // Reference to AutomationService for new flow
      sendTelegramMessage: this.sendTelegramMessage.bind(this),
    };

    this.strategies = {
      bob: new BabyStepsStrategy(strategyDependencies),
      // Additional strategies will be added here
    };


    // Listen for vault authorization events (new event-driven approach)
    this.eventManager.subscribe('VaultAuthGranted', ({ vaultAddress }) => {
      this.handleVaultAuthorization(vaultAddress);
    });

    this.eventManager.subscribe('VaultAuthRevoked', ({ vaultAddress }) => {
      this.handleVaultRevocation(vaultAddress);
    });

    // Listen for unrecoverable vault events
    this.eventManager.subscribe('VaultUnrecoverable', async (data) => {
      try {
        await this.addToBlacklist(
          data.vaultAddress,
          data.reason,
          JSON.stringify(data.details),
          data.attempts
        );
        console.log(`Blacklisted unrecoverable vault ${data.vaultAddress}: ${data.reason}`);
      } catch (error) {
        console.error(`Failed to blacklist unrecoverable vault ${data.vaultAddress}:`, error);
      }
    });

    // Listen for position rebalanced events to refresh swap listeners
    this.eventManager.subscribe('PositionRebalanced', async (data) => {
      try {
        await retryWithBackoff(
          () => this.eventManager.refreshSwapListeners(
            data.vaultAddress,
            this.provider
          ),
          {
            maxRetries: 2,
            baseDelay: 1000,
            exponential: true,
            context: `Refreshing swap listeners for vault ${data.vaultAddress} after ${data.reason} rebalance`,
            logger: console,
            onRetry: (attempt, error) => {
              console.warn(`Retry ${attempt}/2 for refreshing swap listeners for vault ${data.vaultAddress}: ${error.message}`);
            }
          }
        );
        this.log(`Successfully refreshed swap listeners for vault ${data.vaultAddress} after ${data.reason} rebalance`);
      } catch (error) {
        console.error(`Failed to refresh swap listeners for vault ${data.vaultAddress} after all retries:`, error);

        // Add to failed vault retry system - critical monitoring failure
        this.trackFailedVault(data.vaultAddress, error);

        this.log(`Vault ${data.vaultAddress} added to failed vault retry system due to listener refresh failure`);
      }
    });

    // Listen for vault configuration change events
    this.eventManager.subscribe('TargetTokensUpdated', ({ vault, tokens }) => {
      this.handleTargetTokensUpdate(vault, tokens);
    });

    this.eventManager.subscribe('TargetPlatformsUpdated', ({ vault, platforms }) => {
      this.handleTargetPlatformsUpdate(vault, platforms);
    });

    // Listen for strategy parameter update events
    this.eventManager.subscribe('StrategyParameterUpdated', ({ vaultAddress, paramName }) => {
      this.handleParameterUpdate(vaultAddress, paramName);
    });

    // Listen for swap events from monitored pools
    this.eventManager.subscribe('SwapEventDetected', async ({ vaultAddress, poolAddress, platform, log }) => {
      await this.handleSwapEvent(vaultAddress, poolAddress, platform, log);
    });

    // Setup process-level error handlers for fail-together behavior
    this.setupCrashHandlers();
  }

  /**
   * Setup process-level error handlers to ensure service crashes cleanly
   * @memberof module:AutomationService~AutomationService
   * @private
   * @returns {void}
   * @since 1.0.0
   */
  setupCrashHandlers() {
    // Handle uncaught exceptions
    process.on('uncaughtException', async (error) => {
      console.error('[AutomationService] FATAL: Uncaught exception:', error);
      try {
        await this.sseBroadcaster.stop();
      } catch (stopError) {
        console.error('[AutomationService] Error stopping SSE during crash cleanup:', stopError);
      }
      process.exit(1);
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', async (reason, promise) => {
      console.error('[AutomationService] FATAL: Unhandled promise rejection:', reason);
      try {
        await this.sseBroadcaster.stop();
      } catch (stopError) {
        console.error('[AutomationService] Error stopping SSE during crash cleanup:', stopError);
      }
      process.exit(1);
    });
  }

  //#region Service Initialization
  /**
   * Start the automation service and begin monitoring authorized vaults
   * @memberof module:AutomationService~AutomationService
   * @returns {Promise<boolean>} True if service started successfully
   * @throws {Error} If service fails to start
   * @since 1.0.0
   * @example
   * const service = new AutomationService(config);
   * await service.start();
   */
  async start() {
    if (this.isRunning) return;

    if (this.isShuttingDown) {
      this.log('Service is shutting down - please wait to restart');
      return;
    }

    // Phase 1: Core service setup - must succeed for service to function
    try {
      await this.initialize();
      this.isRunning = true;
      this.log('Starting Automation Service...');

      // Load blacklist - critical for proper vault filtering
      await this.loadBlacklist();

      // Initialize tracker - load existing vault metadata
      await this.tracker.initialize();
      this.log('Vault tracking initialized');

      // Start SSE broadcaster for real-time event streaming
      await this.sseBroadcaster.start();
      this.log('SSE broadcaster started');

      // Subscribe to vault authorization changes - core functionality
      this.eventManager.subscribeToAuthorizationEvents(this.chainId, this.automationServiceAddress, this.provider);

      // Subscribe to strategy parameter updates from our known strategy contracts
      const strategyAddresses = [
        this.contracts.bobStrategy.address
      ];

      this.eventManager.subscribeToStrategyParameterEvents(this.chainId, strategyAddresses, this.provider);

      // Start the periodic retry mechanism for failed vaults - core infrastructure
      this.startFailedVaultRetryTimer();

      this.log('Core service initialization complete');
    } catch (error) {
      // Core service failure - service cannot function
      this.isRunning = false;
      console.error('Error during core service initialization:', error);

      // Emit ServiceStartFailed event
      this.eventManager.emit('ServiceStartFailed', {
        error: error.message,
        log: {
          message: `❌ Automation Service failed to start: ${error.message}`,
          level: 'error'
        }
      });

      return {
        success: false,
        error: error.message
      };
    }

    // Phase 2: Vault loading - failures are handled gracefully
    // Get all authorized vault addresses from library with retry
    const authorizedVaultAddresses = await retryWithBackoff(
      async () => await getAuthorizedVaults(this.automationServiceAddress, this.provider),
      {
        maxRetries: 3,
        baseDelay: 1000,
        exponential: true,
        context: 'Loading authorized vaults'
      }
    );
    this.log(`Found ${authorizedVaultAddresses.length} authorized vaults to set up`);

    const successfullySetUp = [];
    const failedSetups = [];
    const skippedBlacklisted = [];

    for (const vaultAddress of authorizedVaultAddresses) {
      // Skip blacklisted vaults
      if (this.isBlacklisted(vaultAddress)) {
        const details = this.getBlacklistDetails(vaultAddress);
        this.log(`Skipping blacklisted vault: ${vaultAddress} (${details.reason})`);
        skippedBlacklisted.push(vaultAddress);
        continue;
      }

      const result = await this.setupVault(vaultAddress, { forceRefresh: true });
      if (result.success) {
        successfullySetUp.push(vaultAddress);
      } else {
        failedSetups.push(vaultAddress);
      }
    }

    this.log(`Vault setup completed: ${successfullySetUp.length} successful, ${failedSetups.length} failed, ${skippedBlacklisted.length} blacklisted`);

    if (failedSetups.length > 0) {
      this.log(`Failed vaults will be retried periodically`);
    }

    if (skippedBlacklisted.length > 0) {
      this.log(`Blacklisted vaults skipped: ${skippedBlacklisted.join(', ')}`);
    }

    // Emit ServiceStarted event - service is running regardless of vault loading results
    this.eventManager.emit('ServiceStarted', {
      initializedVaults: successfullySetUp,
      failedVaults: failedSetups,
      blacklistedVaults: skippedBlacklisted,
      log: {
        message: `✅ Automation Service started successfully: ${successfullySetUp.length} vaults initialized, ${failedSetups.length} failed, ${skippedBlacklisted.length} blacklisted`,
        level: 'info'
      }
    });

    this.log('Automation Service started successfully');
    return {
      success: true,
      initializedVaults: successfullySetUp,
      failedVaults: failedSetups,
      blacklistedVaults: skippedBlacklisted
    };
  }

  /**
   * Initialize the automation service and its dependencies
   * @memberof module:AutomationService~AutomationService
   * @param {string} factoryAddress - VaultFactory contract address
   * @returns {Promise<boolean>} True if initialization successful
   * @throws {Error} If initialization fails or required configuration is missing
   * @since 1.0.0
   * @example
   * const service = new AutomationService(config);
   * await service.initialize(factoryAddress);
   */
  async initialize() {
    // Idempotency check - don't re-initialize if already done
    if (this.provider) {
      this.log('Automation Service already initialized, skipping...');
      return;
    }

    try {

      this.log('Initializing Automation Service...');

      // Set up WebSocket provider for real-time event streaming
      this.log(`Connecting to WebSocket provider for real-time events on chain ${this.chainId}`);
      this.provider = new ethers.providers.WebSocketProvider(this.wsUrl);

      // Share provider with the registry

      // Update strategy dependencies with the initialized provider and other services
      for (const strategy of Object.values(this.strategies)) {
        strategy.provider = this.provider;
        strategy.adapters = this.adapters;
        strategy.tokens = this.tokens;
        strategy.serviceConfig = {
          chainId: this.chainId,
          automationServiceAddress: this.automationServiceAddress,
          wsUrl: this.wsUrl,
          debug: this.debug
        };
      }

      // Initialize the VaultDataService with our provider and chain ID
      this.log(`Initializing VaultDataService for chain ${this.chainId}`);

      this.vaultDataService.initialize(
        this.provider,
        Number(this.chainId)
      );

      // Register event listener for pool data from VDS adapters
      this.eventManager.subscribe('PoolDataFetched', (data) => {
        const { poolData, source, vaultAddress } = data;

        // Merge pool data into our cache - only add if doesn't exist
        for (const [poolAddress, pool] of Object.entries(poolData)) {
          if (!this.poolData[poolAddress]) {
            // Initialize the averageTVL cache for this pool
            this.poolData[poolAddress] = {
              ...pool,
              averageTVL: {}
            };
            this.log(`Cached pool data for ${poolAddress} from ${source} (vault: ${vaultAddress})`);
          }
        }
      });

      // Initialize platform adapters for this chain
      await this._initializeAdapters();

      // Initialize token configurations for this chain
      await this._initializeTokens();

      // Pass tokens configuration to VaultDataService
      this.vaultDataService.setTokens(this.tokens);

      // Subscribe to VaultDataService events for comprehensive monitoring and logging
      this._setupVaultDataServiceLogging();

      // Pre-initialize all contracts for optimal performance
      console.log('Initializing contracts...');

      this.contracts = {
        factory: await getVaultFactory(this.provider),
        bobStrategy: await getContract('bob', this.provider)
      };

      // Log initialized contract addresses
      this.log(`Using VaultFactory address: ${this.contracts.factory.address}`);
      this.log(`Using BabySteps strategy address: ${this.contracts.bobStrategy.address}`);

      // Share factory contract with registry

      this.log('Automation Service initialized successfully');
      return true;
    } catch (error) {
      console.error('Failed to initialize Automation Service:', error);
      throw error;
    }
  }

  /**
   * Initialize platform adapters for the configured chain
   * @memberof module:AutomationService~AutomationService
   * @private
   * @returns {Promise<void>}
   * @throws {Error} If adapter initialization fails
   * @since 1.0.0
   */
  async _initializeAdapters() {
    try {
      this.log(`Initializing platform adapters for chain ${this.chainId}...`);

      const result = AdapterFactory.getAdaptersForChain(this.chainId, this.provider);

      for (const adapter of result.adapters) {
        this.adapters.set(adapter.platformId, adapter);
        this.log(`Initialized ${adapter.platformId} adapter`);
      }

      if (result.failures.length > 0) {
        this.log(`Initial adapter creation failed for ${result.failures.length} platforms, attempting retries...`);

        // Retry failed adapter creation with exponential backoff
        const retryResults = await retryBatchOperations(
          result.failures,
          async (failure) => {
            const adapter = AdapterFactory.getAdapter(failure.platformId, this.chainId, this.provider);
            this.adapters.set(adapter.platformId, adapter);
            return adapter;
          },
          {
            maxRetries: 3,
            baseDelay: 1000,
            exponential: true,
            logger: this
          }
        );

        if (retryResults.finalFailures.length > 0) {
          const failureDetails = retryResults.finalFailures.map(f =>
            `${f.platformId}: ${f.lastError.message} (after ${f.retriesAttempted} retries)`
          ).join(', ');
          throw new Error(`Critical adapter initialization failed - all adapters are required: ${failureDetails}`);
        }

        this.log(`Successfully recovered ${retryResults.successes.length} adapters after retries`);
      }

      // Pass dependencies to VaultDataService
      this.vaultDataService.setAdapters(this.adapters);
      this.vaultDataService.setPoolData(this.poolData);

      // Pass dependencies to EventManager
      this.eventManager.setPoolData(this.poolData);
      this.eventManager.setAdapters(this.adapters);
      this.eventManager.setVaultDataService(this.vaultDataService);

      this.log(`Successfully initialized ${this.adapters.size} platform adapters`);
    } catch (error) {
      console.error('Failed to initialize adapters:', error);
      throw new Error(`Adapter initialization failed: ${error.message}`);
    }
  }

  /**
   * Initialize token configurations for the configured chain
   * @memberof module:AutomationService~AutomationService
   * @private
   * @returns {Promise<void>}
   * @throws {Error} If token initialization fails
   * @since 1.0.0
   */
  async _initializeTokens() {
    try {
      this.log(`Initializing token configurations for chain ${this.chainId}...`);

      const chainTokens = getTokensByChain(this.chainId);

      for (const config of chainTokens) {
        this.tokens[config.symbol] = {
          symbol: config.symbol,
          address: config.addresses[this.chainId],
          decimals: config.decimals,
          name: config.name
        };
      }

      this.log(`Successfully initialized ${chainTokens.length} token configurations`);
    } catch (error) {
      console.error('Failed to initialize tokens:', error);
      throw new Error(`Token initialization failed: ${error.message}`);
    }
  }

  /**
   * Set up comprehensive VaultDataService event logging
   * @memberof module:AutomationService~AutomationService
   * @private
   * @since 1.0.0
   */
  _setupVaultDataServiceLogging() {
    const events = this.vaultDataService.getAvailableEvents();
    events.forEach(eventName => {
      this.vaultDataService.subscribe(eventName, (...args) => {
        if (eventName.includes('Error')) {
          // Errors always log (production visible)
          console.error(`VDS Error [${eventName}]:`, ...args);
        } else if (['vaultRebalanceUpdated', 'targetTokensUpdated', 'targetPlatformsUpdated'].includes(eventName)) {
          // Key operations - always log for production visibility
          console.log(`VDS [${eventName}]:`, ...args);
        } else {
          // Everything else - debug only
          this.log(`VDS [${eventName}]:`, ...args);
        }
      });
    });
  }

  /**
   * Set up a vault with the complete 1-2-3 flow: load data, initialize strategy, start monitoring
   * @memberof module:AutomationService~AutomationService
   * @param {string} vaultAddress - Address of the vault to set up
   * @param {Object} [options={}] - Setup options
   * @param {boolean} [options.forceRefresh=true] - Whether to force refresh vault data
   * @returns {Promise<Object>} Setup result with success/failure details and vault data
   * @since 1.0.0
   */
  async setupVault(vaultAddress, options = {}) {
    if (this.isShuttingDown) {
      this.log('Skipping vault setup - service is shutting down');
      return { success: false, reason: 'Service shutting down' };
    }

    const { forceRefresh = true } = options;

    if (!vaultAddress) {
      throw new Error('Invalid vault address provided for setup');
    }

    let vault = null;
    let initSuccess = false;
    let monitoringStarted = false;

    // Lock vault at the START of setup to prevent recovery mechanism from running in parallel
    // This must happen before any async operations (Permit2 approvals, initialization, etc.)
    this.lockVault(vaultAddress);

    try {
      // Step 1: Load vault data
      vault = await this.vaultDataService.getVault(vaultAddress, forceRefresh);
      if (!vault) {
        throw new Error(`Failed to get vault data for ${vaultAddress}`);
      }

      // Step 1.5: Capture baseline BEFORE any modifications (if not already tracked)
      if (!this.tracker.getMetadata(vaultAddress)) {
        const baselineAssets = await this.vaultDataService.fetchAssetValues(vault);

        this.eventManager.emit('VaultBaselineCaptured', {
          vaultAddress: vault.address,
          totalVaultValue: baselineAssets.totalVaultValue,
          tokenValue: baselineAssets.totalTokenValue,
          positionValue: baselineAssets.totalPositionValue,
          tokens: baselineAssets.tokens,
          positions: baselineAssets.positions,
          timestamp: Date.now(),
          capturePoint: 'pre_initialization',
          strategyId: vault.strategy?.strategyId
        });

        this.log(`📊 Captured baseline for vault ${vaultAddress}: $${baselineAssets.totalVaultValue.toFixed(2)}`);
      }

      // Step 2: Setup Permit2 approvals for gasless operations (BEFORE initialization)
      const permit2Success = await this.setupPermit2Approvals(vault);
      if (!permit2Success) {
        throw new Error('Permit2 approval setup failed');
      }

      // Step 3: Initialize the vault for its strategy (may execute swaps/adds liquidity)
      initSuccess = await this.initializeVaultForStrategy(vault);
      if (!initSuccess) {
        throw new Error('Vault initialization failed');
      }

      // Step 4: Start regular monitoring
      await this.startMonitoringVault(vault);
      monitoringStarted = true;

      // Success - vault setup complete
      this.unlockVault(vaultAddress);

      return {
        success: true,
        vault,
        vaultLoaded: true,
        initSuccess: true,
        monitoringStarted: true
      };

    } catch (error) {
      console.error(`Error setting up vault ${vaultAddress}:`, error);
      this.unlockVault(vaultAddress);

      // Clean up any partial setup if vault data was loaded
      if (vault) {
        try {
          await this.cleanupVault(vaultAddress, vault.strategy.strategyId);
        } catch (cleanupError) {
          console.error(`Error during failed vault cleanup for ${vaultAddress}:`, cleanupError);
        }
        // Track this vault as failed for retry and external monitoring
        this.trackFailedVault(vaultAddress, error);

        return {
          success: false,
          vault,
          vaultLoaded: !!vault,
          initSuccess,
          monitoringStarted,
          error: error.message
        };
      }
    }
  }

  /**
   * Setup Permit2 approvals for all tokens in a vault (both vault tokens and target tokens)
   * @memberof module:AutomationService~AutomationService
   * @param {Object} vault - Vault object with tokens and strategy
   * @returns {Promise<boolean>} True if setup succeeded, false otherwise
   * @since 1.0.0
   */
  async setupPermit2Approvals(vault) {
    // Get all unique tokens: vault tokens + target tokens + position tokens
    const vaultTokenSymbols = Object.keys(vault.tokens);
    const targetTokenSymbols = vault.targetTokens;

    // Extract tokens from positions via pool data
    const positionTokenSymbols = [];
    for (const position of Object.values(vault.positions)) {
      const poolMetadata = this.poolData[position.pool];
      positionTokenSymbols.push(poolMetadata.token0Symbol);
      positionTokenSymbols.push(poolMetadata.token1Symbol);
    }

    // Combine and deduplicate all token sources
    const allTokenSymbols = [...new Set([...vaultTokenSymbols, ...targetTokenSymbols, ...positionTokenSymbols])];

    if (allTokenSymbols.length === 0) {
      this.log(`No tokens found for vault ${vault.address}, skipping Permit2 setup`);
      throw new Error('Vault has no target tokens set');
    }

    this.log(`Setting up Permit2 approvals for ${allTokenSymbols.length} tokens in vault ${vault.address}`);

    const approvalsNeeded = [];

    // Check each token
    for (const tokenSymbol of allTokenSymbols) {
      const tokenData = this.tokens[tokenSymbol];
      if (!tokenData) {
        this.log(`Token ${tokenSymbol} not found in token registry, skipping`);
        continue;
      }

      // Check if Permit2 approval already exists
      const needsApproval = await this.checkPermit2Approval(
        vault.address,
        tokenData.address,
        tokenSymbol
      );

      if (needsApproval) {
        approvalsNeeded.push({ tokenAddress: tokenData.address, tokenSymbol });
      }
    }

    // Execute approvals if needed
    if (approvalsNeeded.length > 0) {
      this.log(`Executing ${approvalsNeeded.length} Permit2 approvals for vault ${vault.address}`);

      for (const { tokenAddress, tokenSymbol } of approvalsNeeded) {
        await this.executePermit2Approval(vault.address, tokenAddress, tokenSymbol);
      }

      this.log(`✅ Permit2 approvals complete for vault ${vault.address}`);
    } else {
      this.log(`✅ All Permit2 approvals already in place for vault ${vault.address}`);
    }

    return true;
  }

  /**
   * Check if a token has Permit2 approval from vault
   * @memberof module:AutomationService~AutomationService
   * @param {string} vaultAddress - Vault address
   * @param {string} tokenAddress - Token address
   * @param {string} tokenSymbol - Token symbol for logging
   * @returns {Promise<boolean>} True if approval needed, false if already approved
   * @since 1.0.0
   */
  async checkPermit2Approval(vaultAddress, tokenAddress, tokenSymbol) {
    try {
      const tokenContract = new ethers.Contract(
        tokenAddress,
        ERC20_ABI,
        this.provider
      );

      const currentAllowance = await tokenContract.allowance(vaultAddress, PERMIT2_ADDRESS);

      // Check if allowance is at least half of max (to handle decreasing allowances)
      const needsApproval = currentAllowance.lt(ethers.constants.MaxUint256.div(2));

      this.log(`${tokenSymbol} Permit2 approval for vault ${vaultAddress}: ${needsApproval ? 'NEEDED' : 'EXISTS'} (current: ${currentAllowance.toString()})`);

      return needsApproval;
    } catch (error) {
      this.log(`Error checking Permit2 approval for ${tokenSymbol}: ${error.message}`);
      return true; // Assume approval needed if check fails
    }
  }

  /**
   * Execute Permit2 approval transaction for a token
   * @memberof module:AutomationService~AutomationService
   * @param {string} vaultAddress - Vault address
   * @param {string} tokenAddress - Token address to approve
   * @param {string} tokenSymbol - Token symbol for logging
   * @returns {Promise<void>}
   * @since 1.0.0
   */
  async executePermit2Approval(vaultAddress, tokenAddress, tokenSymbol) {
    try {
      this.log(`Executing Permit2 approval for ${tokenSymbol} in vault ${vaultAddress}`);

      // Get vault contract with signer
      const { getVaultContract } = await import('fum_library');
      const vaultContract = getVaultContract(vaultAddress, this.provider);

      const automationPrivateKey = process.env.AUTOMATION_PRIVATE_KEY;
      if (!automationPrivateKey) {
        throw new Error('AUTOMATION_PRIVATE_KEY not found');
      }

      const signer = new ethers.Wallet(automationPrivateKey, this.provider);
      const vaultContractWithSigner = vaultContract.connect(signer);

      // Generate approval transaction data
      const tokenContract = new ethers.Contract(
        tokenAddress,
        ERC20_ABI,
        this.provider
      );

      const approvalData = tokenContract.interface.encodeFunctionData('approve', [
        PERMIT2_ADDRESS,
        ethers.constants.MaxUint256
      ]);

      // Execute through vault using approve() for security
      const tx = await vaultContractWithSigner.approve([tokenAddress], [approvalData]);
      const receipt = await tx.wait();

      this.log(`✅ Permit2 approval successful for ${tokenSymbol} in vault ${vaultAddress}, tx: ${receipt.transactionHash}`);

      // Emit event for tracking
      this.eventManager.emit('Permit2ApprovalExecuted', {
        vaultAddress,
        tokenAddress,
        tokenSymbol,
        transactionHash: receipt.transactionHash,
        log: {
          level: 'info',
          message: `Permit2 approval granted for ${tokenSymbol} in vault ${vaultAddress}`,
          includeData: false
        }
      });

    } catch (error) {
      this.log(`❌ Error executing Permit2 approval for ${tokenSymbol}: ${error.message}`);
      throw error; // Re-throw to be handled by caller
    }
  }

  /**
   * Initialize a vault's assets according to its strategy
   * @memberof module:AutomationService~AutomationService
   * @param {Object} vault - Vault object with details
   * @param {string} vault.address - Vault contract address
   * @param {string} [vault.name] - Vault name
   * @returns {Promise<boolean>} Success status
   * @since 1.0.0
   * @example
   * const success = await service.initializeVaultForStrategy(vault);
   * if (success) {
   *   console.log('Vault initialized successfully');
   * }
   */
  async initializeVaultForStrategy(vault) {
    if (this.isShuttingDown) {
      this.log('Skipping vault initialization - service is shutting down');
      return false;
    }

    if (!vault.strategy || !vault.strategy.strategyId) {
      this.log(`No strategy set for vault ${vault.address}, skipping initialization`);
      return false;
    }

    // Note: Vault should already be locked by setupVault() before this is called
    try {
      const strategyType = vault.strategy.strategyId;

      this.log(`Initializing vault ${vault.address} for '${strategyType}' strategy with parameters:`, vault.strategy.parameters);

      // Get the strategy implementation
      const strategy = this.strategies[strategyType];

      // Verify strategy implements required initialization method
      if (typeof strategy.initializeVaultStrategy !== 'function') {
        throw new Error(`Strategy ${strategyType} does not implement required initializeVaultStrategy method`);
      }

      // Call the strategy-specific initialization with retry logic
      await retryWithBackoff(
        () => strategy.initializeVaultStrategy(vault),
        {
          maxRetries: 2,
          baseDelay: 2000,
          exponential: true,
          context: `Initializing vault ${vault.address} for ${strategyType} strategy`,
          logger: console,
          onRetry: (attempt, error) => {
            console.warn(`Retry ${attempt}/2 for vault ${vault.address} initialization: ${error.message}`);
          }
        }
      );

      this.log(`Successfully initialized vault ${vault.address} for ${strategyType} strategy`);

      // Send notification about successful initialization
      await this.sendTelegramMessage(`✅ Vault initialized: ${vault.name || 'Unnamed'} (${vault.address.slice(0, 6)}...${vault.address.slice(-4)}) with ${strategyType} strategy`);

      return true;
    } catch (error) {
      console.error(`Error initializing vault ${vault.address} for strategy:`, error);

      // Send notification about failed initialization
      await this.sendTelegramMessage(`❌ Failed to initialize vault: ${vault.name || 'Unnamed'} (${vault.address.slice(0, 6)}...${vault.address.slice(-4)})\nError: ${error.message}`);

      return false;
    }
  }

  /**
   * Start monitoring a specific vault for events and strategy execution
   * @memberof module:AutomationService~AutomationService
   * @param {Object} vault - Vault object to monitor
   * @param {string} vault.address - Vault contract address
   * @param {string} vault.strategyAddress - Strategy contract address
   * @returns {Promise<void>}
   * @throws {Error} If vault data is invalid or monitoring setup fails
   * @since 1.0.0
   */
  async startMonitoringVault(vault) {
    try {
      this.log(`Starting to monitor vault: ${vault.address}`);

      // Strategy is guaranteed to exist by loadVaultData
      if (!vault.strategy || !vault.strategy.strategyId) {
        throw new Error(`Invalid vault state: vault ${vault.address} missing strategy data despite passing validation`);
      }

      const strategy = this.strategies[vault.strategy.strategyId];
      if (!strategy) {
        throw new Error(`Strategy ${vault.strategy.strategyId} not implemented`);
      }

      // EventManager handles all standard Swap event monitoring with retry logic
      await retryWithBackoff(
        () => this.eventManager.subscribeToSwapEvents(vault, this.provider),
        {
          maxRetries: 2,
          baseDelay: 1000,
          exponential: true,
          context: `Setting up swap event monitoring for vault ${vault.address}`,
          logger: console,
          onRetry: (attempt, error) => {
            console.warn(`Retry ${attempt}/2 for vault ${vault.address} swap monitoring setup: ${error.message}`);
          }
        }
      );

      // Allow strategies to add supplementary monitoring if needed
      if (strategy.setupAdditionalMonitoring) {
        await retryWithBackoff(
          () => strategy.setupAdditionalMonitoring(vault),
          {
            maxRetries: 2,
            baseDelay: 1000,
            exponential: true,
            context: `Setting up additional monitoring for vault ${vault.address}`,
            logger: console,
            onRetry: (attempt, error) => {
              console.warn(`Retry ${attempt}/2 for vault ${vault.address} additional monitoring setup: ${error.message}`);
            }
          }
        );
      }

      // Set up monitoring for target tokens and platforms changes with retry logic
      await retryWithBackoff(
        () => this.eventManager.subscribeToVaultConfigEvents(vault, this.provider),
        {
          maxRetries: 2,
          baseDelay: 1000,
          exponential: true,
          context: `Setting up config event monitoring for vault ${vault.address}`,
          logger: console,
          onRetry: (attempt, error) => {
            console.warn(`Retry ${attempt}/2 for vault ${vault.address} config monitoring setup: ${error.message}`);
          }
        }
      );

      // Emit monitoring completion event
      this.eventManager.emit('MonitoringStarted', {
        vaultAddress: vault.address,
        strategyId: vault.strategy.strategyId,
        positionCount: Object.keys(vault.positions).length,
        chainId: this.chainId,
        timestamp: Date.now(),
        log: {
          level: 'info',
          message: `Successfully set up monitoring for vault ${vault.address} with strategy ${vault.strategy.strategyId}`,
          includeData: false
        }
      });
    } catch (error) {
      console.error(`Error monitoring vault ${vault.address}:`, error);
      throw error;
    }
  }
  //#endregion

  //#region Service Shutdown
  /**
   * Stop the automation service and clean up resources
   * @memberof module:AutomationService~AutomationService
   * @returns {Promise<boolean>} True if service stopped successfully
   * @since 1.0.0
   * @example
   * await service.stop();
   */
  async stop() {
    if (!this.isRunning) return true;

    this.log('Stopping Automation Service...');
    this.isRunning = false;
    this.isShuttingDown = true;

    try {
      // Stop the periodic retry mechanism
      this.stopFailedVaultRetryTimer();

      // Clean up all vaults using existing cleanupVault infrastructure
      const vaults = this.vaultDataService.getAllVaults();
      if (vaults.length > 0) {
        this.log(`Cleaning up ${vaults.length} vaults...`);
        const cleanupResults = await Promise.allSettled(
          vaults.map(vault =>
            this.cleanupVault(vault.address, vault.strategy.strategyId)
          )
        );

        // Log any cleanup failures
        const failures = cleanupResults.filter(result => result.status === 'rejected');
        if (failures.length > 0) {
          this.log(`${failures.length} vault cleanup operations had errors (continuing shutdown)`);
        }
      }

      // Clean up all remaining listeners via EventManager
      const removedCount = await this.eventManager.removeAllListeners().catch(error => {
        this.log(`Error removing event listeners: ${error.message}`);
        return 0;
      });
      this.log(`Removed ${removedCount} remaining event listeners`);

      // Shutdown tracker - persist all pending data
      if (this.tracker) {
        await this.tracker.shutdown().catch(error =>
          this.log(`Error shutting down tracker: ${error.message}`)
        );
        this.log('Tracker shutdown complete');
      }

      // Stop SSE broadcaster
      if (this.sseBroadcaster) {
        await this.sseBroadcaster.stop().catch(error =>
          this.log(`Error stopping SSE broadcaster: ${error.message}`)
        );
        this.log('SSE broadcaster stopped');
      }

      // Clean up provider connection
      if (this.provider?.destroy) {
        await this.provider.destroy().catch(error =>
          this.log(`Error destroying provider: ${error.message}`)
        );
      } else if (this.provider?.removeAllListeners) {
        this.provider.removeAllListeners();
      } else if (this.provider) {
        this.log(`Provider type ${this.provider.constructor?.name} has no cleanup method available`);
      }

      // Clear the VaultDataService cache and reset state
      this.vaultDataService.clearCache();
      this.vaultLocks = {};

      this.log('Automation Service stopped successfully');
      return true;
    } catch (error) {
      this.log(`Error during service shutdown: ${error.message}`);
      return false;
    }
  }

  /**
   * Stop monitoring a specific vault
   * @memberof module:AutomationService~AutomationService
   * @param {string} vaultAddress - Vault address to stop monitoring
   * @param {string} strategyId - Strategy ID for the vault
   * @returns {Promise<void>}
   * @since 1.0.0
   */
  async stopMonitoringVault(vaultAddress, strategyId) {
    if (!vaultAddress) {
      this.log('Error: No vault address provided for stopping monitoring');
      return;
    }

    this.log(`Stopping monitoring for vault: ${vaultAddress} (strategy: ${strategyId})`);

    try {
      // Clean up strategy-specific monitoring for the specific strategy only
      let strategyFound = false;
      if (strategyId) {
        const strategy = this.strategies[strategyId];

        if (strategy) {
          strategy.cleanup(vaultAddress);
          strategyFound = true;
        } else {
          this.log(`Warning: Strategy ${strategyId} not found for vault ${vaultAddress}`);
        }
      }

      // Remove any remaining vault-specific listeners (VaultRegistry listeners, orphaned listeners, etc.)
      const removedCount = await this.eventManager.removeAllVaultListeners(vaultAddress);

      this.log(`Successfully stopped monitoring for vault ${vaultAddress}, removed ${removedCount} remaining listeners`);

      // Emit event for vault monitoring stopped
      this.eventManager.emit('VaultMonitoringStopped', {
        vaultAddress,
        strategyId,
        listenersRemoved: removedCount,
        strategyFound,
        success: true,
        log: {
          message: `Stopped monitoring vault ${vaultAddress} (strategy: ${strategyId}, listeners removed: ${removedCount})`,
          level: 'info'
        }
      });
    } catch (error) {
      console.error(`Error stopping monitoring for vault ${vaultAddress}:`, error);

      // Emit failure event
      this.eventManager.emit('VaultMonitoringStopped', {
        vaultAddress,
        strategyId,
        success: false,
        error: error.message,
        log: {
          message: `Failed to stop monitoring vault ${vaultAddress}: ${error.message}`,
          level: 'error'
        }
      });
    }
  }

  /**
   * Clean up a vault that failed during setup (shared cleanup logic for failed setups)
   * @memberof module:AutomationService~AutomationService
   * @param {string} vaultAddress - Address of the vault to clean up
   * @param {Object} [vault] - Vault object if available (for getting strategyId)
   * @returns {Promise<void>}
   * @private
   * @since 1.0.0
   */
  async cleanupVault(vaultAddress, strategyId) {
    if (!vaultAddress) {
      this.log('Error: No vault address provided for cleanup');
      return;
    }

    this.log(`Cleaning up failed vault setup: ${vaultAddress}`);

    // Track cleanup results for logging
    const results = {
      monitoringStoppedSuccessfully: false,
      vaultUnlocked: false,
      vaultRemovedFromCache: false,
      errors: []
    };

    // 1. Stop any monitoring that may have been set up
    try {
      if (!strategyId) {
        this.log(`Warning: No strategy found for vault cleanup ${vaultAddress}`);
      }

      await retryWithBackoff(
        () => this.stopMonitoringVault(vaultAddress, strategyId),
        3, // maxRetries
        'stopMonitoringVault'
      );
      results.monitoringStoppedSuccessfully = true;
      this.log(`✅ Stopped monitoring for vault ${vaultAddress}`);
    } catch (error) {
      results.errors.push(`Failed to stop monitoring: ${error.message}`);
      console.error(`Error stopping monitoring for vault ${vaultAddress}:`, error);
      // Continue with other cleanup
    }

    // 2. Clear any vault locks (cannot fail)
    if (this.vaultLocks[vaultAddress.toLowerCase()]) {
      this.unlockVault(vaultAddress);
      results.vaultUnlocked = true;
      this.log(`✅ Unlocked failed vault ${vaultAddress}`);
    }

    // 3. Remove vault from cache (cannot fail)
    const vaultRemoved = this.vaultDataService.removeVault(vaultAddress);
    results.vaultRemovedFromCache = vaultRemoved;
    this.log(`${vaultRemoved ? '✅ Removed' : 'ℹ️  No cache entry found for'} failed vault ${vaultAddress} from data cache`);

    // Log final cleanup summary
    if (results.errors.length > 0) {
      this.log(`⚠️  Vault cleanup completed with ${results.errors.length} error(s): ${results.errors.join('; ')}`);
    } else {
      this.log(`✅ Vault cleanup completed successfully for ${vaultAddress}`);
    }

    // Return results for caller to use in event emission
    return results;
  }
  //#endregion

  //#region Event Handlers
  /**
   * Handle a new vault authorization event
   * @memberof module:AutomationService~AutomationService
   * @param {string} vaultAddress - Address of the newly authorized vault
   * @returns {void}
   * @since 1.0.0
   */
  async handleVaultAuthorization(vaultAddress) {
    if (this.isShuttingDown) {
      this.log('Ignoring vault authorization event - service is shutting down');
      return;
    }

    if (!vaultAddress) {
      this.log('Error: Invalid vault address received for new authorization');
      return;
    }

    this.log(`New vault authorized: ${vaultAddress}`);

    // Use the shared setupVault method
    const result = await this.setupVault(vaultAddress, { forceRefresh: true });

    // Handle the result and emit appropriate events for new authorization
    if (result.success) {
      // Emit VaultOnboarded event
      this.eventManager.emit('VaultOnboarded', {
        vaultAddress,
        strategyId: result.vault.strategy.strategyId,
        log: {
          message: `✅ Vault successfully onboarded: ${vaultAddress} (strategy: ${result.vault.strategy.strategyId})`,
          level: 'info'
        }
      });

      // Send success notification
      this.sendTelegramMessage(
        `🆕 New vault authorized: ${vaultAddress.slice(0, 6)}...${vaultAddress.slice(-4)} (${result.vault.strategy.strategyId})`
      ).catch(error => console.error('Error sending authorization notification:', error));
    } else {
      // Emit VaultAuthorizationFailed event
      this.eventManager.emit('VaultAuthorizationFailed', {
        vaultAddress,
        strategyId: result.vault?.strategy?.strategyId,
        vaultLoaded: result.vaultLoaded,
        initSuccess: result.initSuccess,
        monitoringStarted: result.monitoringStarted,
        error: result.error,
        log: {
          message: `❌ Vault authorization failed: ${vaultAddress} - ${result.error}`,
          level: 'error'
        }
      });
    }
  }

  /**
   * Handle a vault authorization revocation event
   * @memberof module:AutomationService~AutomationService
   * @param {string} vaultAddress - Address of the revoked vault
   * @returns {Promise<void>}
   * @since 1.0.0
   */
  async handleVaultRevocation(vaultAddress) {
    if (this.isShuttingDown) {
      this.log('Ignoring vault revocation event - service is shutting down');
      return;
    }

    if (!vaultAddress) {
      this.log('Error: No vault address provided for revocation');
      return;
    }

    this.log(`Vault authorization revoked: ${vaultAddress}`);

    // Get the strategy ID for this vault from cache
    const strategyId = this.vaultDataService.getVaultStrategyId(vaultAddress);

    // Use cleanupVault for consistent cleanup with retry logic
    const results = await this.cleanupVault(vaultAddress, strategyId);

    // Remove from blacklist if present (allows clean retry after user fixes issues)
    if (this.isBlacklisted(vaultAddress)) {
      await this.removeFromBlacklist(vaultAddress);
      this.log(`Removed revoked vault from blacklist: ${vaultAddress}`);
    }

    // 4. Emit vault offboarded event with comprehensive results
    this.eventManager.emit('VaultOffboarded', {
      vaultAddress,
      strategyId,
      vaultRemoved: results.vaultRemovedFromCache,
      monitoringStoppedSuccessfully: results.monitoringStoppedSuccessfully,
      vaultUnlocked: results.vaultUnlocked,
      errors: results.errors,
      success: results.errors.length === 0,
      log: {
        message: `Vault authorization revoked and cleaned up: ${vaultAddress}${strategyId ? ` (strategy: ${strategyId})` : ''} - ${results.errors.length === 0 ? 'Complete success' : `${results.errors.length} error(s) occurred`}`,
        level: results.errors.length === 0 ? 'info' : 'warn'
      }
    });

    // 5. Send notification if configured (fire and forget - errors already caught)
    this.sendTelegramMessage(`⛔ Vault authorization revoked: ${vaultAddress.slice(0, 6)}...${vaultAddress.slice(-4)}`)
      .catch(error => console.error('Error sending revocation notification:', error));

    // Log final summary
    if (results.errors.length > 0) {
      this.log(`⚠️  Vault revocation completed with ${results.errors.length} error(s): ${results.errors.join('; ')}`);
    } else {
      this.log(`✅ Vault revocation completed successfully for ${vaultAddress}`);
    }
  }

  /**
   * Process a price event from a Swap
   * @memberof module:AutomationService~AutomationService
   * @param {string} vaultAddress - Address of vault to process
   * @param {string} poolAddress - Pool address where the swap occurred
   * @param {string} platform - Platform where the swap occurred
   * @param {Object} log - Raw swap event log
   * @returns {Promise<void>}
   * @since 1.0.0
   */
  async handleSwapEvent(vaultAddress, poolAddress, platform, log) {
    // Do not process event if service is shutting down
    if (this.isShuttingDown) {
      this.log(`Swap event for vault ${vaultAddress} ignored - service is shutting down`);
      return;
    }

    // Check and acquire vault lock
    if (!this.lockVault(vaultAddress)) {
      return; // Already processing, skip this event
    }

    try {
      // Get vault data
      const vault = await this.vaultDataService.getVault(vaultAddress);
      if (!vault) {
        console.error(`Vault ${vaultAddress} not found in VaultDataService`);
        return;
      }

      const strategy = this.strategies[vault.strategy.strategyId];

      // Delegate to strategy's handler - let strategy decide what to do with the event
      await strategy.handleSwapEvent(vault, poolAddress, platform, log);

    } catch (error) {
      console.error(`Error processing swap event for vault ${vaultAddress}:`, error);
      this.sendTelegramMessage(
        `⚠️ Error processing swap event for vault ${vaultAddress.slice(0,6)}...${vaultAddress.slice(-4)}: ${error.message}`
      ).catch(console.error);
    } finally {
      this.unlockVault(vaultAddress);
    }
  }
  //#endregion

  //#region Loggers
  /**
   * Send a message to the configured Telegram chat
   * @memberof module:AutomationService~AutomationService
   * @param {string} message - Message to send
   * @returns {Promise<boolean>} Success status
   * @since 1.0.0
   * @example
   * await service.sendTelegramMessage('Vault rebalanced successfully');
   */
  async sendTelegramMessage(message) {
    try {
      if (!process.env.TELEGRAM_BOT_API_KEY || !process.env.TELEGRAM_CHAT_ID) {
        this.log('Error: Telegram API key or chat ID not found in environment variables');
        return false;
      }

      // Send the message as is, no demo mode modifications
      const response = await axios.post(
        `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_API_KEY}/sendMessage`,
        {
          chat_id: process.env.TELEGRAM_CHAT_ID,
          text: message
        }
      );

      if (response.data && response.data.ok) {
        this.log('Telegram message sent successfully');
        return true;
      } else {
        this.log(`Error sending Telegram message: ${JSON.stringify(response.data)}`);
        return false;
      }
    } catch (error) {
      console.error('Error sending Telegram message:', error.message);
      return false;
    }
  }

  /**
   * Log a message with optional data and action tracking
   * @memberof module:AutomationService~AutomationService
   * @param {string} message - Log message
   * @param {Object} [data={}] - Additional data to log
   * @param {string} [actionType=null] - Type of action being logged
   * @param {string} [actionResult=null] - Result of the action
   * @returns {void}
   * @since 1.0.0
   */
  log(message, data = {}, actionType = null, actionResult = null) {
    if (this.debug) {
      const sourceName = 'AutomationService';

      // Use the new Logger for both console and frontend logging
      try {
        // Dynamic import to avoid circular dependencies
        import('./Logger.js').then(({ default: Logger }) => {
          Logger.info(sourceName, message, data, actionType, actionResult);
        }).catch(() => {
          // Fallback if Logger import fails
          console.log(`[${sourceName}] ${message}`);
        });
      } catch (error) {
        // Fallback for any import errors
        console.log(`[${sourceName}] ${message}`);
      }
    }
  }
  //#endregion

  //#region Vault (Un)Lockers
  /**
   * Attempt to lock a vault for exclusive processing
   * @memberof module:AutomationService~AutomationService
   * @param {string} vaultAddress - Address of the vault to lock
   * @returns {boolean} true if the vault was successfully locked, false if already locked
   * @since 1.0.0
   */
  lockVault(vaultAddress) {
    // Normalize the vault address using ethers for proper checksumming
    const normalizedAddress = ethers.utils.getAddress(vaultAddress);

    // If vault has no lock entry yet, initialize it
    if (!this.vaultLocks[normalizedAddress]) {
      this.vaultLocks[normalizedAddress] = false;
    }

    // Check if vault is already locked
    if (this.vaultLocks[normalizedAddress]) {
      return false;
    }

    // Lock the vault
    this.vaultLocks[normalizedAddress] = true;
    this.log(`Locked vault ${vaultAddress} for exclusive processing`);

    // Emit VaultLocked event
    this.eventManager.emit('VaultLocked', {
      vaultAddress: normalizedAddress,
      timestamp: Date.now()
    });

    return true;
  }

  /**
   * Release the lock on a vault
   * @memberof module:AutomationService~AutomationService
   * @param {string} vaultAddress - Address of the vault to unlock
   * @param {string} [positionId=null] - Optional position ID for better logging
   * @returns {void}
   * @since 1.0.0
   */
  unlockVault(vaultAddress) {
    // Normalize the vault address using ethers for proper checksumming
    const normalizedAddress = ethers.utils.getAddress(vaultAddress);

    // Release the lock
    this.vaultLocks[normalizedAddress] = false;

    this.log(`Unlocked vault ${vaultAddress} after processing`);

    // Emit VaultUnlocked event
    this.eventManager.emit('VaultUnlocked', {
      vaultAddress: normalizedAddress,
      timestamp: Date.now()
    });
  }
  //#endregion

  //#region 'Helpers'
  /**
   * Get a platform adapter instance
   * @memberof module:AutomationService~AutomationService
   * @param {string} platformId - Platform identifier (e.g., 'uniswapv3')
   * @returns {Object} Platform adapter instance
   * @throws {Error} If adapter is not available
   * @since 1.0.0
   * @example
   * const adapter = automationService.getAdapter('uniswapv3');
   */
  getAdapter(platformId) {
    const adapter = this.adapters.get(platformId);
    if (!adapter) {
      throw new Error(`No adapter available for platform: ${platformId}`);
    }
    return adapter;
  }

  //#endregion

  //#region 'Param Validators'
  /**
   * Validate chainId parameter using established library pattern
   * @private
   * @param {any} chainId - The chainId to validate
   * @throws {Error} If chainId is invalid
   */
  _validateChainId(chainId) {
    if (chainId === null || chainId === undefined) {
      throw new Error('chainId is required in configuration');
    }

    if (typeof chainId !== 'number') {
      throw new Error('chainId must be a number');
    }

    if (!Number.isFinite(chainId)) {
      throw new Error('chainId must be a finite number');
    }

    if (!Number.isInteger(chainId)) {
      throw new Error('chainId must be an integer');
    }

    if (chainId <= 0) {
      throw new Error('chainId must be greater than 0');
    }
  }

  /**
   * Validate WebSocket URL parameter
   * @private
   * @param {any} wsUrl - The WebSocket URL to validate
   * @throws {Error} If wsUrl is invalid
   */
  _validateWebSocketUrl(wsUrl) {
    if (wsUrl === null || wsUrl === undefined) {
      throw new Error('wsUrl is required in configuration');
    }

    if (typeof wsUrl !== 'string') {
      throw new Error('wsUrl must be a string');
    }

    if (wsUrl.trim().length === 0) {
      throw new Error('wsUrl cannot be empty');
    }

    // Validate WebSocket URL format
    try {
      const url = new URL(wsUrl);
      if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
        throw new Error('wsUrl must use ws:// or wss:// protocol');
      }
    } catch (error) {
      if (error.message.includes('protocol')) {
        throw error; // Re-throw our protocol error
      }
      throw new Error(`wsUrl is not a valid URL: ${error.message}`);
    }
  }

  /**
   * Validate debug flag parameter
   * @private
   * @param {any} debug - The debug flag to validate
   * @throws {Error} If debug flag is invalid
   */
  _validateBoolean(debug) {
    if (debug === undefined) {
      throw new Error('debug flag must be explicitly set to true or false');
    }

    if (typeof debug !== 'boolean') {
      throw new Error('debug flag must be a boolean (true or false)');
    }
  }

  /**
   * Validate Ethereum address parameter
   * @private
   * @param {any} address - The address to validate
   * @param {string} paramName - The parameter name for error messages
   * @throws {Error} If address is invalid
   */
  _validateAddress(address, paramName) {
    if (address === null || address === undefined) {
      throw new Error(`${paramName} is required in configuration`);
    }

    if (typeof address !== 'string') {
      throw new Error(`${paramName} must be a string`);
    }

    if (address.trim().length === 0) {
      throw new Error(`${paramName} cannot be empty`);
    }

    try {
      // Use ethers.getAddress for validation and checksumming
      ethers.utils.getAddress(address);
    } catch (error) {
      throw new Error(`${paramName} is not a valid Ethereum address: ${error.message}`);
    }
  }
  //#endregion

  //#region Vault Loading Failure Re-loading Methods
  /**
   * Track a failed vault for retry and external monitoring
   * @memberof module:AutomationService~AutomationService
   * @param {string} vaultAddress - Vault address that failed to load
   * @param {Error} error - Error that occurred
   * @since 1.0.0
   */
  trackFailedVault(vaultAddress, error) {
    const normalizedAddress = ethers.utils.getAddress(vaultAddress);
    const now = Date.now();

    const existingFailure = this.failedVaults.get(normalizedAddress);
    const attempts = existingFailure ? existingFailure.attempts + 1 : 1;

    this.failedVaults.set(normalizedAddress, {
      error: error.message,
      attempts,
      lastAttempt: now,
      firstFailure: existingFailure ? existingFailure.firstFailure : now
    });

    // Emit event for external monitoring
    this.eventManager.emit('VaultLoadFailed', {
      vaultAddress: normalizedAddress,
      error: error.message,
      attempts,
      firstFailure: existingFailure ? existingFailure.firstFailure : now,
      lastAttempt: now,
      log: {
        level: 'error',
        message: `Vault ${normalizedAddress} failed to load (attempt ${attempts}): ${error.message}`,
        includeData: true
      }
    });
  }

  /**
   * Remove a vault from failed tracking (when successfully recovered)
   * @memberof module:AutomationService~AutomationService
   * @param {string} vaultAddress - Vault address that recovered
   * @since 1.0.0
   */
  clearFailedVault(vaultAddress) {
    const normalizedAddress = ethers.utils.getAddress(vaultAddress);
    const existed = this.failedVaults.delete(normalizedAddress);

    // Also remove from blacklist if present (vault successfully recovered)
    if (this.isBlacklisted(normalizedAddress)) {
      this.removeFromBlacklist(normalizedAddress)
        .then(() => {
          this.log(`Removed recovered vault from blacklist: ${normalizedAddress}`);
        })
        .catch(error => {
          console.error(`Error removing recovered vault from blacklist:`, error);
        });
    }

    if (existed) {
      this.eventManager.emit('VaultLoadRecovered', {
        vaultAddress: normalizedAddress,
        log: {
          level: 'info',
          message: `Vault ${normalizedAddress} successfully recovered and loaded`,
          includeData: false
        }
      });
    }

    return existed;
  }

  /**
   * Get current failed vaults for external monitoring
   * @memberof module:AutomationService~AutomationService
   * @returns {Array<Object>} Array of failed vault objects
   * @since 1.0.0
   */
  getFailedVaults() {
    return Array.from(this.failedVaults.entries()).map(([vaultAddress, failure]) => ({
      vaultAddress,
      ...failure
    }));
  }

  /**
   * Retry loading failed vaults
   * @memberof module:AutomationService~AutomationService
   * @returns {Promise<void>}
   * @since 1.0.0
   */
  async retryLoadingFailedVaults() {
    if (this.isShuttingDown) {
      return; // Don't retry if shutting down
    }

    if (this.failedVaults.size === 0) {
      return; // No failed vaults to retry
    }

    const currentTime = Date.now();
    const retryableVaults = [];

    // Check which failures should be retried vs blacklisted
    for (const [vaultAddress, failure] of this.failedVaults.entries()) {
      const timeSinceFirstFailure = currentTime - failure.firstFailure;

      if (timeSinceFirstFailure > this.maxFailureDuration) {
        // Blacklist after configured duration (default 24 hours)
        try {
          await this.addToBlacklist(
            vaultAddress,
            `Persistent failure after ${this.maxFailureDuration / (1000 * 60 * 60)} hours`,
            failure.error,
            failure.attempts
          );

          // Remove from failed tracking since it's now blacklisted
          this.failedVaults.delete(vaultAddress);

          console.log(`Vault ${vaultAddress} blacklisted after ${failure.attempts} attempts over ${timeSinceFirstFailure / (1000 * 60 * 60)} hours`);
        } catch (blacklistError) {
          console.error(`Error blacklisting vault ${vaultAddress}:`, blacklistError);
          // Keep in failed tracking if blacklisting fails
        }
      } else {
        retryableVaults.push(vaultAddress);
      }
    }

    // Retry the retryable vaults
    if (retryableVaults.length > 0) {
      console.log(`Retrying ${retryableVaults.length} failed vaults...`);

      for (const vaultAddress of retryableVaults) {
        // Use setupVault which has proper error handling, cleanup, and failure tracking
        const result = await this.setupVault(vaultAddress, { forceRefresh: true });

        if (result.success) {
          // Remove from failed tracking (also emits VaultLoadRecovered event)
          this.clearFailedVault(vaultAddress);

          console.log(`Successfully recovered vault: ${vaultAddress}`);

          // Send recovery notification
          this.sendTelegramMessage(
            `🔄 Vault recovered: ${vaultAddress.slice(0, 6)}...${vaultAddress.slice(-4)} (${result.vault.strategy.strategyId})`
          ).catch(error => console.error('Error sending recovery notification:', error));
        } else {
          // setupVault already handles cleanup and tracking failures
          console.log(`Vault ${vaultAddress} still failing on retry: ${result.error}`);
        }
      }
    }
  }

  /**
   * Start the periodic retry mechanism for failed vaults
   * @memberof module:AutomationService~AutomationService
   * @private
   * @since 1.0.0
   */
  startFailedVaultRetryTimer() {
    // Retry failed vaults at configured interval
    this.retryTimerInterval = setInterval(async () => {
      try {
        await this.retryLoadingFailedVaults();

        // Also retry failed listener removals from EventManager
        const failedRemovals = this.eventManager.getFailedRemovals();
        if (failedRemovals.size > 0) {
          this.log(`Retrying ${failedRemovals.size} failed listener removals`);
          const results = await this.eventManager.retryFailedRemovals();
          this.log(`Failed listener retry complete: ${results.succeeded} succeeded, ${results.stillFailing} still failing`);
        }

        // Also check for vault recovery
        await this.checkVaultRecovery();
      } catch (error) {
        console.error('Error during failed vault/listener retry:', error);
      }
    }, this.retryIntervalMs);

    console.log(`Started periodic retry mechanism for failed vaults loading and listeners cleanup (every ${this.retryIntervalMs / 1000}s)`);
  }

  /**
   * Stop the periodic retry mechanism
   * @memberof module:AutomationService~AutomationService
   * @private
   * @since 1.0.0
   */
  stopFailedVaultRetryTimer() {
    if (this.retryTimerInterval) {
      clearInterval(this.retryTimerInterval);
      this.retryTimerInterval = null;
      console.log('Stopped periodic retry mechanism for failed vaults');
    }
  }

  /**
   * Check for vaults that need recovery and attempt to recover them
   * @memberof module:AutomationService~AutomationService
   * @private
   * @since 1.0.0
   */
  async checkVaultRecovery() {
    try {
      const vaults = await this.vaultDataService.getAllVaults();

      for (const vault of vaults) {
        if (this.vaultLocks[vault.address]) continue;

        const strategy = this.strategies[vault.strategy.strategyId];

        // Let strategy decide if it needs recovery
        if (await strategy.needsRecovery(vault)) {
          this.lockVault(vault.address);
          try {
            const recovered = await strategy.attemptRecovery(vault);
            if (recovered) {
              this.log(`Successfully recovered vault ${vault.address}`);
            }
          } catch (error) {
            console.error(`Recovery failed for vault ${vault.address}:`, error);
          } finally {
            this.unlockVault(vault.address);
          }
        }
      }
    } catch (error) {
      console.error('Error during vault recovery check:', error);
    }
  }
//#endregion

  //#region Blacklist Methods
  /**
   * Load blacklisted vaults from file - fails hard on any error
   * @memberof module:AutomationService~AutomationService
   * @private
   * @returns {Promise<void>}
   * @throws {Error} If file cannot be read or parsed
   * @since 1.0.0
   */
  async loadBlacklist() {
    const blacklistPath = path.resolve(this.blacklistFilePath);

    try {
      const data = await fs.readFile(blacklistPath, 'utf8');
      const parsed = JSON.parse(data);

      if (parsed.version !== '1.0') {
        throw new Error(`Invalid blacklist version: ${parsed.version}, expected 1.0`);
      }

      if (!parsed.blacklisted || typeof parsed.blacklisted !== 'object') {
        throw new Error('Invalid blacklist format: missing or invalid blacklisted object');
      }

      this.blacklistedVaults.clear();
      for (const [vaultAddress, details] of Object.entries(parsed.blacklisted)) {
        this.blacklistedVaults.set(vaultAddress, details);
      }

      console.log(`Loaded ${this.blacklistedVaults.size} blacklisted vaults from ${blacklistPath}`);
    } catch (error) {
      // If file doesn't exist, create an empty blacklist
      if (error.code === 'ENOENT') {
        console.log(`Blacklist file not found at ${blacklistPath}, creating empty blacklist`);
        this.blacklistedVaults.clear();
        await this.saveBlacklist();
        return;
      }
      console.error('Failed to load blacklist file:', error.message);
      throw new Error(`Blacklist loading failed: ${error.message}`);
    }
  }

  /**
   * Save blacklisted vaults to file (atomic write)
   * @memberof module:AutomationService~AutomationService
   * @private
   * @returns {Promise<void>}
   * @since 1.0.0
   */
  async saveBlacklist() {
    try {
      const blacklistPath = path.resolve(this.blacklistFilePath);
      const tempPath = `${blacklistPath}.tmp`;

      // Ensure directory exists
      await fs.mkdir(path.dirname(blacklistPath), { recursive: true });

      const data = {
        version: '1.0',
        blacklisted: Object.fromEntries(this.blacklistedVaults)
      };

      // Atomic write: write to temp file, then rename
      await fs.writeFile(tempPath, JSON.stringify(data, null, 2), 'utf8');
      await fs.rename(tempPath, blacklistPath);

      this.log(`Saved blacklist with ${this.blacklistedVaults.size} vaults to ${blacklistPath}`);
    } catch (error) {
      console.error('Error saving blacklist file:', error.message);
      // Don't throw - blacklist still works in memory
    }
  }

  /**
   * Add a vault to the blacklist
   * @memberof module:AutomationService~AutomationService
   * @param {string} vaultAddress - Vault address to blacklist
   * @param {string} reason - Reason for blacklisting
   * @param {string} lastError - Last error message
   * @param {number} attempts - Number of failed attempts
   * @returns {Promise<void>}
   * @since 1.0.0
   */
  async addToBlacklist(vaultAddress, reason, lastError, attempts) {
    const normalizedAddress = ethers.utils.getAddress(vaultAddress);
    const now = new Date().toISOString();

    const blacklistEntry = {
      reason,
      blacklistedAt: now,
      firstFailure: this.failedVaults.get(normalizedAddress)?.firstFailure || Date.now(),
      lastError,
      attempts
    };

    this.blacklistedVaults.set(normalizedAddress, blacklistEntry);

    // Clean up vault resources (listeners, locks, cache) before saving
    try {
      // Get strategy ID from vault data if available
      const strategyId = this.vaultDataService.getVaultStrategyId(normalizedAddress);
      await this.cleanupVault(normalizedAddress, strategyId);
      console.log(`Cleaned up resources for blacklisted vault ${normalizedAddress}`);
    } catch (cleanupError) {
      console.error(`Failed to cleanup blacklisted vault ${normalizedAddress}:`, cleanupError);
      // Continue with blacklisting even if cleanup fails
    }

    await this.saveBlacklist();

    // Emit event for monitoring
    this.eventManager.emit('VaultBlacklisted', {
      vaultAddress: normalizedAddress,
      reason,
      lastError,
      attempts,
      blacklistedAt: now,
      log: {
        level: 'error',
        message: `Vault ${normalizedAddress} blacklisted after ${attempts} failed attempts: ${reason}`,
        includeData: true
      }
    });

    console.log(`Blacklisted vault ${normalizedAddress}: ${reason} (${attempts} attempts)`);
  }

  /**
   * Remove a vault from the blacklist
   * @memberof module:AutomationService~AutomationService
   * @param {string} vaultAddress - Vault address to remove from blacklist
   * @returns {Promise<boolean>} Whether the vault was removed (true) or wasn't blacklisted (false)
   * @since 1.0.0
   */
  async removeFromBlacklist(vaultAddress) {
    const normalizedAddress = ethers.utils.getAddress(vaultAddress);
    const existed = this.blacklistedVaults.delete(normalizedAddress);

    if (existed) {
      await this.saveBlacklist();

      // Emit event for monitoring
      this.eventManager.emit('VaultUnblacklisted', {
        vaultAddress: normalizedAddress,
        log: {
          level: 'info',
          message: `Vault ${normalizedAddress} removed from blacklist`,
          includeData: false
        }
      });

      console.log(`Removed vault ${normalizedAddress} from blacklist`);
    }

    return existed;
  }

  /**
   * Check if a vault is blacklisted
   * @memberof module:AutomationService~AutomationService
   * @param {string} vaultAddress - Vault address to check
   * @returns {boolean} Whether the vault is blacklisted
   * @since 1.0.0
   */
  isBlacklisted(vaultAddress) {
    const normalizedAddress = ethers.utils.getAddress(vaultAddress);
    return this.blacklistedVaults.has(normalizedAddress);
  }

  /**
   * Get blacklist details for a vault
   * @memberof module:AutomationService~AutomationService
   * @param {string} vaultAddress - Vault address to get details for
   * @returns {Object|null} Blacklist details or null if not blacklisted
   * @since 1.0.0
   */
  getBlacklistDetails(vaultAddress) {
    const normalizedAddress = ethers.utils.getAddress(vaultAddress);
    return this.blacklistedVaults.get(normalizedAddress) || null;
  }

  /**
   * Reset blacklist file to empty state (for testing)
   * @memberof module:AutomationService~AutomationService
   * @param {string} [filePath] - Optional file path, defaults to instance blacklistFilePath
   * @returns {Promise<void>}
   * @since 1.0.0
   */
  async resetBlacklistFile(filePath = null) {
    const targetPath = filePath || this.blacklistFilePath;
    const emptyBlacklist = {
      version: '1.0',
      blacklisted: {}
    };

    await fs.writeFile(path.resolve(targetPath), JSON.stringify(emptyBlacklist, null, 2), 'utf8');
    this.blacklistedVaults.clear();
    console.log(`Reset blacklist file: ${targetPath}`);
  }
  //#endregion

  //#region Temporarily Unused Handlers
  /**
   * Handle strategy parameter update event
   * @memberof module:AutomationService~AutomationService
   * @param {string} vaultAddress - Address of the vault whose parameters were updated
   * @param {string} paramName - Name of the parameter group that was updated
   * @returns {void}
   * @since 1.0.0
   */
  handleParameterUpdate(vaultAddress, paramName) {
    this.log(`Strategy parameters updated for vault ${vaultAddress}: ${paramName}`);

    // Send notification if configured
    this.sendTelegramMessage(`⚙️ Strategy parameters updated for vault ${vaultAddress.slice(0, 6)}...${vaultAddress.slice(-4)}: ${paramName}`)
      .catch(error => console.error('Error sending parameter update notification:', error));
  }

  /**
   * Handle target tokens update event
   * @memberof module:AutomationService~AutomationService
   * @param {Object} vault - Vault that had its target tokens updated
   * @param {string} vault.address - Vault contract address
   * @param {string[]} newTokens - New target token symbols
   * @returns {Promise<void>}
   * @since 1.0.0
   */
  async handleTargetTokensUpdate(vault, newTokens) {
    if (this.isShuttingDown) {
      this.log('Ignoring target tokens update event - service is shutting down');
      return;
    }

    if (!vault || !vault.address) {
      this.log('Error: Invalid vault data received for token update');
      return;
    }

    this.log(`Target tokens updated for vault ${vault.address}: ${newTokens.join(', ')}`);

    // Get fresh vault data first
    const vaultData = await this.vaultDataService.getVault(vault.address);
    if (!vaultData) {
      this.log(`Failed to get vault data for ${vault.address}`);
      return;
    }

    // Clean up existing monitoring for this vault
    if (vaultData.strategy && vaultData.strategy.strategyId) {
      const currentStrategyType = vaultData.strategy.strategyId;
      if (this.strategies[currentStrategyType]) {
        this.strategies[currentStrategyType].cleanup(vaultData.address);
      }
    }

    // Update vault data in VaultDataService
    const updated = await this.vaultDataService.updateTargetTokens(vault.address, newTokens);
    if (!updated) {
      this.log(`Failed to update target tokens for vault ${vault.address}`);
      return;
    }

    // Get the updated vault data for monitoring
    const updatedVault = await this.vaultDataService.getVault(vault.address, true);

    // Restart monitoring using existing function
    await this.startMonitoringVault(updatedVault);

    // Send notification if configured
    this.sendTelegramMessage(`🔄 Target tokens updated for vault: ${updatedVault.name || 'Unnamed'} (${updatedVault.address.slice(0, 6)}...${updatedVault.address.slice(-4)})\nNew tokens: ${newTokens.join(', ')}`)
      .catch(error => console.error('Error sending token update notification:', error));
  }

  /**
   * Handle target platforms update event
   * @memberof module:AutomationService~AutomationService
   * @param {Object} vault - Vault that had its target platforms updated
   * @param {string} vault.address - Vault contract address
   * @param {string[]} newPlatforms - New target platform IDs
   * @returns {Promise<void>}
   * @since 1.0.0
   */
  async handleTargetPlatformsUpdate(vault, newPlatforms) {
    if (this.isShuttingDown) {
      this.log('Ignoring target platforms update event - service is shutting down');
      return;
    }

    if (!vault || !vault.address) {
      this.log('Error: Invalid vault data received for platform update');
      return;
    }

    this.log(`Target platforms updated for vault ${vault.address}: ${newPlatforms.join(', ')}`);

    // Get fresh vault data first
    const vaultData = await this.vaultDataService.getVault(vault.address);
    if (!vaultData) {
      this.log(`Failed to get vault data for ${vault.address}`);
      return;
    }

    // Clean up existing monitoring for this vault
    if (vaultData.strategy && vaultData.strategy.strategyId) {
      const currentStrategyType = vaultData.strategy.strategyId;
      if (this.strategies[currentStrategyType]) {
        this.strategies[currentStrategyType].cleanup(vaultData.address);
      }
    }

    // Update vault data in VaultDataService
    const updated = await this.vaultDataService.updateTargetPlatforms(vault.address, newPlatforms);
    if (!updated) {
      this.log(`Failed to update target platforms for vault ${vault.address}`);
      return;
    }

    // Get the updated vault data for monitoring
    const updatedVault = await this.vaultDataService.getVault(vault.address, true);

    // Restart monitoring using existing function
    await this.startMonitoringVault(updatedVault);

    // Send notification if configured
    this.sendTelegramMessage(`🔄 Target platforms updated for vault: ${updatedVault.name || 'Unnamed'} (${updatedVault.address.slice(0, 6)}...${updatedVault.address.slice(-4)})\nNew platforms: ${newPlatforms.join(', ')}`)
      .catch(error => console.error('Error sending platform update notification:', error));
  }
  //#endregion

  // //#region Unused Code
  // /**
  //  * Handle a vault strategy change event
  //  * @memberof module:AutomationService~AutomationService
  //  * @param {Object} vault - The vault object with updated strategy
  //  * @param {string} vault.address - Vault contract address
  //  * @param {string} strategyAddress - The new strategy address
  //  * @returns {Promise<void>}
  //  * @since 1.0.0
  //  */
  // async handleStrategyChange(vault, strategyAddress) {
  //   if (this.isShuttingDown) {
  //     this.log('Ignoring strategy change event - service is shutting down');
  //     return;
  //   }

  //   if (!vault || !vault.address) {
  //     this.log('Error: Invalid vault data received for strategy change');
  //     return;
  //   }

  //   this.log(`Strategy changed for vault ${vault.address}: ${strategyAddress}`);

  //   // Get the updated vault from VaultDataService
  //   const updatedVault = await this.vaultDataService.getVault(vault.address);

  //   if (updatedVault) {
  //     // Start monitoring with the new strategy
  //     await this.startMonitoringVault(updatedVault);
  //   } else {
  //     this.log(`Warning: Vault ${vault.address} not found in VaultDataService during strategy change`);
  //   }
  // }

  // /**
  //  * Handle fee collection events for vault positions
  //  * @memberof module:AutomationService~AutomationService
  //  * @param {Object} vault - Vault receiving fees
  //  * @param {Object} pool - Pool contract where fees were collected
  //  * @param {BigInt} amount0 - Amount of token0 collected
  //  * @param {BigInt} amount1 - Amount of token1 collected
  //  * @param {string} strategyType - Strategy type identifier
  //  * @param {Object} params - Strategy parameters
  //  * @returns {Promise<Object>} Processing result with success status
  //  * @throws {Error} If required parameters are missing or processing fails
  //  * @since 1.0.0
  //  */
  // async handleFeeEvent(vault, pool, amount0, amount1, strategyType, params) {
  //   if (this.isShuttingDown) {
  //     this.log('Ignoring fee event - service is shutting down');
  //     return { success: false, reason: 'Service shutting down' };
  //   }

  //   if (!vault || !pool || !strategyType || !params) {
  //     throw new Error("Missing required parameters for fee event handling");
  //   }

  //   // Try to acquire the vault lock - return immediately if already locked
  //   if (!this.lockVault(vault.address)) {
  //     // Vault is already being processed - skip this fee event
  //     this.log(`Vault ${vault.address} is busy, skipping fee event handling`);
  //     return;
  //   }

  //   // We've acquired the lock - ensure it gets released even if processing fails
  //   try {
  //     this.log(`Fee event received for vault ${vault.address} on pool ${pool.address}`);

  //     // Get the strategy
  //     const strategy = this.strategies[strategyType];
  //     if (!strategy) {
  //       throw new Error(`Strategy ${strategyType} not implemented`);
  //     }

  //     // Use VaultDataService to get fresh vault data
  //     const vaultData = await this.vaultDataService.getVault(vault.address);
  //     if (!vaultData) {
  //       throw new Error(`Failed to get vault data for ${vault.address}`);
  //     }

  //     // Delegate to strategy-specific fee handling with fresh vault data
  //     await strategy.handleFeeEvent(vaultData, pool, amount0, amount1, params);

  //     return { success: true };
  //   } catch (error) {
  //     console.error(`Error handling fee event for vault ${vault.address}:`, error);
  //     throw error;
  //   } finally {
  //     // Always release the vault lock when done, even if there's an error
  //     // For fee events, we don't have a specific position ID, so use a generic identifier
  //     this.unlockVault(vault.address, `fees-${pool.address}`);
  //   }
  // }

  // /**
  //  * Update vault data after a rebalance transaction completes
  //  * @memberof module:AutomationService~AutomationService
  //  * @param {Object} vault - Vault that was rebalanced
  //  * @param {Object} transactionReceipt - Ethereum transaction receipt
  //  * @returns {Promise<void>}
  //  * @since 1.0.0
  //  */
  // async updateVaultAfterRebalance(vault, transactionReceipt) {
  //   try {
  //     this.log(`Updating vault data after rebalance: ${vault.address}`);

  //     // Use VaultDataService to update vault data after rebalance
  //     const success = await this.vaultDataService.updateVaultAfterRebalance(vault.address, transactionReceipt);

  //     if (success) {
  //       this.log(`Successfully updated vault data after rebalance: ${vault.address}`);
  //     } else {
  //       this.log(`Failed to update vault data after rebalance: ${vault.address}`);
  //     }
  //   } catch (error) {
  //     console.error(`Error updating vault after rebalance:`, error);
  //     // Don't throw - we should continue monitoring even if update fails
  //   }
  // }

  // /**
  //  * Add a new position to a vault
  //  * @memberof module:AutomationService~AutomationService
  //  * @param {Object} vault - Vault to add position to
  //  * @param {string} tokenId - NFT token ID of the position
  //  * @param {Object} [positionManager] - Position manager contract instance
  //  * @returns {Promise<void>}
  //  * @throws {Error} If position cannot be added
  //  * @since 1.0.0
  //  */
  // async addNewPosition(vault, tokenId, positionManager) {
  //   try {
  //     this.log(`Adding new position ${tokenId} to vault ${vault.address}`);

  //     // Use the single provider
  //     const provider = this.provider;

  //     // Validate that we have a target platform - required for position management
  //     if (!vault.targetPlatforms || vault.targetPlatforms.length === 0) {
  //       throw new Error(`No target platforms configured for vault ${vault.address} - cannot add position without platform specification`);
  //     }
  //     const protocol = vault.targetPlatforms[0].toLowerCase();

  //     // Get adapter to calculate pool address properly
  //     const adapter = vault.adapters[protocol] //|| AdapterFactory.getAdapter(protocol, provider);

  //     // Create position manager contract if not provided
  //     if (!positionManager) {
  //       // Find a position manager from the positions for this vault
  //       const vaultPositions = this.vaultDataService.getVaultPositions(vault.address);
  //       const positionManagerAddress = vaultPositions
  //         .find(p => p.contracts?.positionManager)?.contracts?.positionManager?.address;

  //       if (!positionManagerAddress) {
  //         throw new Error(`No position manager found for vault ${vault.address}`);
  //       }

  //       // const positionManagerABI = [
  //       //   'function positions(uint256 tokenId) external view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)'
  //       // ];

  //       const positionManagerABI = adapter.getPositionManagerABI();

  //       positionManager = new ethers.Contract(
  //         positionManagerAddress,
  //         positionManagerABI,
  //         provider
  //       );
  //     }

  //     // Get position details
  //     const positionData = await positionManager.positions(tokenId);
  //     const { token0, token1, fee, tickLower, tickUpper, liquidity,
  //             feeGrowthInside0LastX128, feeGrowthInside1LastX128 } = positionData;

  //     // Pool ABI with minimal required methods
  //     // const poolABI = [
  //     //   'function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
  //     //   'function feeGrowthGlobal0X128() external view returns (uint256)',
  //     //   'function feeGrowthGlobal1X128() external view returns (uint256)',
  //     //   'function ticks(int24 tick) external view returns (uint128 liquidityGross, int128 liquidityNet, uint256 feeGrowthOutside0X128, uint256 feeGrowthOutside1X128, int56 tickCumulativeOutside, uint160 secondsPerLiquidityOutsideX128, uint32 secondsOutside, bool initialized)'
  //     // ];

  //     const poolABI = adapter.getPoolABI();

  //     if (!adapter) {
  //       throw new Error(`No adapter found for protocol ${protocol}`);
  //     }

  //     // Get pool address
  //     //const poolAddress = await this.calculatePoolAddress(token0, token1, fee, protocol, vault.chainId, adapter);
  //     const poolAddress = adapter.getPoolAddress(token0, token1, fee)

  //     // Create pool contract
  //     const poolContract = new ethers.Contract(
  //       poolAddress,
  //       poolABI,
  //       provider
  //     );

  //     // Get pool data
  //     try {
  //       const [slot0, feeGrowthGlobal0X128, feeGrowthGlobal1X128, liquidity, fee] = await Promise.all([
  //         poolContract.slot0(),
  //         poolContract.feeGrowthGlobal0X128(),
  //         poolContract.feeGrowthGlobal1X128(),
  //         poolContract.liquidity(),
  //         poolContract.fee()
  //       ]);

  //       // Get tick data
  //       const [lowerTickData, upperTickData] = await Promise.all([
  //         poolContract.ticks(tickLower),
  //         poolContract.ticks(tickUpper)
  //       ]);

  //       // Store pool data in cache
  //       vault.dataCache.poolData[poolAddress] = {
  //         sqrtPriceX96: slot0.sqrtPriceX96.toString(),
  //         tick: Number(slot0.tick),
  //         liquidity: liquidity.toString(),
  //         fee: fee,
  //         feeGrowthGlobal0X128: feeGrowthGlobal0X128.toString(),
  //         feeGrowthGlobal1X128: feeGrowthGlobal1X128.toString(),
  //         lastUpdated: Date.now(),
  //         ticks: {
  //           [tickLower.toString()]: {
  //             feeGrowthOutside0X128: lowerTickData.feeGrowthOutside0X128.toString(),
  //             feeGrowthOutside1X128: lowerTickData.feeGrowthOutside1X128.toString(),
  //             initialized: lowerTickData.initialized
  //           },
  //           [tickUpper.toString()]: {
  //             feeGrowthOutside0X128: upperTickData.feeGrowthOutside0X128.toString(),
  //             feeGrowthOutside1X128: upperTickData.feeGrowthOutside1X128.toString(),
  //             initialized: upperTickData.initialized
  //           }
  //         }
  //       };

  //       // Add tokens to vault.tokens if not already there
  //       if (!vault.tokens[token0.toLowerCase()]) {
  //         await this.addToken(vault, token0);
  //       }

  //       if (!vault.tokens[token1.toLowerCase()]) {
  //         await this.addToken(vault, token1);
  //       }

  //       // Create position object
  //       const position = {
  //         id: tokenId,
  //         vaultAddress: vault.address,
  //         pool: poolAddress, // Use pool instead of poolAddress for consistency
  //         token0,
  //         token1,
  //         tickLower: Number(tickLower),
  //         tickUpper: Number(tickUpper),
  //         liquidity: liquidity.toString(),
  //         fee: Number(fee),
  //         feeGrowthInside0LastX128: feeGrowthInside0LastX128.toString(),
  //         feeGrowthInside1LastX128: feeGrowthInside1LastX128.toString(),
  //         protocol,
  //         chainId: vault.chainId,
  //         contracts: {
  //           pool: poolContract,
  //           positionManager
  //         },
  //         adapter
  //       };

  //       // Add position to VaultDataService positions map
  //       this.vaultDataService.positions.set(tokenId, position);

  //       // Add position ID to vault.positions array (keep track of IDs only)
  //       if (!vault.positions) {
  //         vault.positions = [];
  //       }
  //       vault.positions.push(tokenId);

  //       this.log(`Successfully added position ${tokenId} to vault ${vault.address}`);
  //     } catch (poolError) {
  //       console.error(`Error fetching pool data for position ${tokenId}:`, poolError);
  //       throw new Error(`Failed to add position ${tokenId} to vault ${vault.address}: ${poolError.message}`);
  //     }
  //   } catch (error) {
  //     console.error(`Error adding new position ${tokenId}:`, error);
  //   }
  // }

  // /**
  //  * Refresh position data from the blockchain
  //  * @memberof module:AutomationService~AutomationService
  //  * @param {Object} vault - Vault containing the position
  //  * @param {string} positionId - Position ID to refresh
  //  * @param {Object} [positionManager] - Position manager contract instance
  //  * @returns {Promise<void>}
  //  * @since 1.0.0
  //  */
  // async refreshPositionData(vault, positionId, positionManager) {
  //   // TODO: loadPoolData() call has been deprecated and removed as part of cache refactoring
  //   // This method will be updated in the position refresh workflow refactoring phase
  //   try {
  //     this.log(`Refreshing data for position ${positionId}`);

  //     // Find position in VaultDataService positions map
  //     const position = this.vaultDataService.getPosition(positionId);
  //     if (!position) {
  //       this.log(`Position ${positionId} not found in VaultDataService for vault ${vault.address}`);
  //       return;
  //     }

  //     // Use provided position manager or get from position
  //     if (!positionManager) {
  //       positionManager = position.contracts?.positionManager;

  //       if (!positionManager) {
  //         throw new Error(`No position manager found for position ${positionId}`);
  //       }
  //     }

  //     // Get updated position data
  //     const positionData = await positionManager.positions(positionId);

  //     // Update position with new data
  //     position.tickLower = Number(positionData.tickLower);
  //     position.tickUpper = Number(positionData.tickUpper);
  //     position.liquidity = positionData.liquidity.toString();
  //     position.feeGrowthInside0LastX128 = positionData.feeGrowthInside0LastX128.toString();
  //     position.feeGrowthInside1LastX128 = positionData.feeGrowthInside1LastX128.toString();

  //     this.log(`Refreshed data for position ${positionId}`);

  //     // TODO: Pool data updates will be handled via events in the position refresh workflow refactoring
  //   } catch (error) {
  //     console.error(`Error refreshing position ${positionId}:`, error);
  //   }
  // }

  // /**
  //  * Add token information to vault's token registry
  //  * @memberof module:AutomationService~AutomationService
  //  * @param {Object} vault - Vault to add token to
  //  * @param {string} tokenAddress - Token contract address
  //  * @returns {Promise<void>}
  //  * @since 1.0.0
  //  */
  // async addToken(vault, tokenAddress) {
  //   try {
  //     // Use the single provider
  //     const provider = this.provider;

  //     // Token ABI with minimal required methods
  //     const tokenABI = [
  //       'function decimals() view returns (uint8)',
  //       'function symbol() view returns (string)',
  //       'function name() view returns (string)',
  //       'function balanceOf(address owner) view returns (uint256)'
  //     ];

  //     const tokenContract = new ethers.Contract(
  //       tokenAddress,
  //       tokenABI,
  //       provider
  //     );

  //     // Get token details
  //     const [decimals, symbol, name, balance] = await Promise.all([
  //       tokenContract.decimals(),
  //       tokenContract.symbol(),
  //       tokenContract.name(),
  //       tokenContract.balanceOf(vault.address)
  //     ]);

  //     // Store token data
  //     vault.tokens[tokenAddress.toLowerCase()] = {
  //       address: tokenAddress,
  //       decimals: Number(decimals),
  //       symbol,
  //       name,
  //       balance: balance.toString(),
  //       contract: tokenContract
  //     };

  //     this.log(`Added token ${symbol} (${tokenAddress}) to vault ${vault.address}`);
  //   } catch (error) {
  //     console.error(`Error adding token ${tokenAddress}:`, error);

  //     // Add minimal token data on error
  //     vault.tokens[tokenAddress.toLowerCase()] = {
  //       address: tokenAddress,
  //       error: error.message
  //     };
  //   }
  // }

  // /**
  //  * Calculate pool address for a token pair
  //  * @memberof module:AutomationService~AutomationService
  //  * @param {string} token0 - First token address
  //  * @param {string} token1 - Second token address
  //  * @param {number} fee - Pool fee tier
  //  * @param {string} platform - DeFi platform identifier
  //  * @param {number} chainId - Blockchain chain ID
  //  * @param {Object} adapter - Platform adapter instance
  //  * @returns {Promise<string>} Calculated pool address
  //  * @throws {Error} If pool address cannot be calculated
  //  * @since 1.0.0
  //  */
  // async calculatePoolAddress(token0, token1, fee, platform, chainId, adapter) {
  //   // Require adapter for all pool address calculations - no dangerous fallbacks allowed
  //   if (!adapter) {
  //     throw new Error(`No adapter available for platform ${platform} on chain ${chainId} - pool address calculation requires proper platform adapter`);
  //   }

  //   try {
  //     // Get actual token decimals from contracts - no fallbacks allowed for financial data
  //     const tokenABI = ['function decimals() view returns (uint8)'];
  //     const token0Contract = new ethers.Contract(token0, tokenABI, this.provider);
  //     const token1Contract = new ethers.Contract(token1, tokenABI, this.provider);

  //     const [decimals0, decimals1] = await Promise.all([
  //       token0Contract.decimals(),
  //       token1Contract.decimals()
  //     ]);

  //     const token0Data = { address: token0, decimals: Number(decimals0) };
  //     const token1Data = { address: token1, decimals: Number(decimals1) };

  //     const result = await adapter.getPoolAddress(token0Data, token1Data, Number(fee));

  //     if (!result || !result.poolAddress) {
  //       throw new Error(`Adapter returned invalid pool address result for ${token0}/${token1} on ${platform}`);
  //     }

  //     return result.poolAddress;
  //   } catch (error) {
  //     console.error(`Pool address calculation failed for ${token0}/${token1} on ${platform}:`, error);
  //     throw new Error(`Failed to calculate pool address for ${token0}/${token1} on ${platform} (chain ${chainId}): ${error.message}`);
  //   }
  // }

  // /**
  //  * Infer DeFi platform from transaction receipt
  //  * @memberof module:AutomationService~AutomationService
  //  * @param {Object} receipt - Ethereum transaction receipt
  //  * @returns {string|null} Platform identifier or null if unknown
  //  * @since 1.0.0
  //  */
  // inferPlatformFromReceipt(receipt) {
  //   try {
  //     // Look for known addresses in the receipt that can help determine the platform
  //     for (const log of receipt.logs) {
  //       // Check if this is a supported chain
  //       const chainId = this.chainId;
  //       const chainConfig = getChainConfig(chainId);

  //       if (!chainConfig || !chainConfig.platformAddresses) {
  //         continue;
  //       }

  //       // Check all platforms in the chain config
  //       for (const [platformId, platformConfig] of Object.entries(chainConfig.platformAddresses)) {
  //         // Skip disabled platforms
  //         if (!platformConfig || !platformConfig.enabled) {
  //           continue;
  //         }

  //         // Check if the log address matches the position manager address
  //         if (platformConfig.positionManagerAddress &&
  //             log.address.toLowerCase() === platformConfig.positionManagerAddress.toLowerCase()) {
  //           return platformId;
  //         }
  //       }
  //     }

  //     return null;
  //   } catch (error) {
  //     console.error("Error inferring platform from receipt:", error);
  //     return null;
  //   }
  // }
  // //#endregion

}

export default AutomationService;
