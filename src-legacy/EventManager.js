/**
 * @module src/EventManager
 * @description Centralized event management system to track and clean up event listeners across the automation service.
 * Manages blockchain event subscriptions with proper cleanup and debugging capabilities.
 * @since 1.0.0
 */

import { ethers } from 'ethers';
import { getVaultContract } from 'fum_library/blockchain';

/**
 * Centralized event management system to track and clean up event listeners
 * @memberof module:src/EventManager
 * @since 1.0.0
 */
class EventManager {
  constructor() {
    this.listeners = {};
    this.eventHandlers = {}; // Added for event emission
    this.debug = false;
    this.enabled = true; // Flag to control event processing
    this.failedRemovals = new Map(); // Track failed listener removals for retry
    this.isCleaningUp = false; // Flag to prevent concurrent cleanup

    // Dependencies
    this.poolData = null;
    this.adapters = null;
    this.vaultDataService = null;

    // Pool-based listener management
    this.poolToVaults = {}; // poolAddress => [vaultAddress1, vaultAddress2, ...]
  }

  /**
   * Set pool data cache for platform lookups
   * @memberof module:src/EventManager
   * @param {Object} poolData - Pool data cache
   * @since 1.0.0
   */
  setPoolData(poolData) {
    this.poolData = poolData;
  }

  /**
   * Set platform adapters for event handling
   * @memberof module:src/EventManager
   * @param {Map} adapters - Adapter instances by platform
   * @since 1.0.0
   */
  setAdapters(adapters) {
    this.adapters = adapters;
  }

  /**
   * Set vault data service for vault operations
   * @memberof module:src/EventManager
   * @param {VaultDataService} vaultDataService - VaultDataService instance
   * @since 1.0.0
   */
  setVaultDataService(vaultDataService) {
    this.vaultDataService = vaultDataService;
  }

  //#region Listener Registration Functions
  /**
   * Register a contract event listener
   * @memberof module:src/EventManager
   * @param {Object} options - Registration options
   * @param {ethers.Contract} options.contract - Contract instance
   * @param {string} options.eventName - Event name to listen for
   * @param {Function} options.handler - Event handler function
   * @param {string} options.vaultAddress - Associated vault address
   * @param {string} options.eventType - Type of event
   * @param {number} options.chainId - Chain ID
   * @param {string} [options.additionalId] - Optional identifier
   * @returns {string} Listener key for future reference
   * @since 1.0.0
   */
  registerContractListener({ contract, eventName, handler, vaultAddress, eventType, chainId, additionalId }) {
    // Generate unique key for this listener
    const key = this.generateListenerKey({ address: vaultAddress, eventType, chainId, additionalId });

    // Check for existing zombie listener (marked as removed but still present)
    const existingListener = this.listeners[key];
    if (existingListener && existingListener.isRemoved) {
      // Reactivate the zombie listener instead of creating a duplicate
      delete existingListener.isRemoved;
      this.log(`Reactivated zombie contract listener: ${key}`);

      // Clear from failed removals tracking if present
      this.clearFailedRemoval(key);

      return key; // Don't register a new handler
    }

    console.log(`EventManager: Registering contract listener for ${eventName} on ${vaultAddress}`);

    // Create a wrapper handler that checks removal state before calling the original handler
    const wrappedHandler = (...args) => {
      // Check if this listener has been marked for removal
      const listener = this.listeners[key];
      if (listener && listener.isRemoved) {
        this.log(`Contract event handling skipped (listener marked for removal) for ${key}`);
        return;
      }

      return handler(...args);
    };

    // Register the event listener with our wrapped handler
    contract.on(eventName, wrappedHandler);

    // Store the listener details for cleanup
    this.listeners[key] = {
      type: 'contract',
      contract,
      eventName,
      handler: wrappedHandler,
      originalHandler: handler,
      vaultAddress,
      chainId
    };

    console.log(`EventManager: Listener registered with key ${key}`);
    this.log(`Registered contract listener: ${key} for event ${eventName}`);
    return key;
  }

  /**
   * Register a provider event filter listener
   * @memberof module:src/EventManager
   * @param {Object} options - Registration options
   * @param {ethers.Provider} options.provider - Provider instance
   * @param {ethers.EventFilter} options.filter - Event filter
   * @param {Function} options.handler - Event handler function
   * @param {string} options.address - Address for key generation (poolAddress for pools, 'global' for global listeners)
   * @param {string} options.eventType - Type of event
   * @param {number} options.chainId - Chain ID
   * @param {string} [options.additionalId] - Optional identifier
   * @returns {string} Listener key for future reference
   * @since 1.0.0
   */
  registerFilterListener({ provider, filter, handler, address, eventType, chainId, additionalId }) {
    // Skip registration if system is disabled
    if (!this.enabled) {
      this.log(`Filter listener registration skipped (disabled) for address ${address}`);

      // Generate key anyway for consistent return value
      const key = this.generateListenerKey({ address, eventType, chainId, additionalId });
      return key;
    }

    // Generate unique key for this listener
    const key = this.generateListenerKey({ address, eventType, chainId, additionalId });

    // Check for existing zombie listener (marked as removed but still present)
    const existingListener = this.listeners[key];
    if (existingListener && existingListener.isRemoved) {
      // Reactivate the zombie listener instead of creating a duplicate
      delete existingListener.isRemoved;
      this.log(`Reactivated zombie filter listener: ${key}`);

      // Clear from failed removals tracking if present
      this.clearFailedRemoval(key);

      return key; // Don't register a new handler
    }

    // Log filter details for debugging
    console.log(`[EventManager] Registering filter for: ${eventType} on address ${address}`);

    // Create a wrapper handler that checks enabled status and removal state at execution time
    const wrappedHandler = (...args) => {
      console.log(`[EventManager] Filter event detected for ${key}`);

      if (!this.enabled) {
        this.log(`Filter event handling skipped (disabled) for ${key}`);
        return;
      }

      // Check if this listener has been marked for removal (including failed removals)
      const listener = this.listeners[key];
      if (listener && listener.isRemoved) {
        this.log(`Filter event handling skipped (listener marked for removal) for ${key}`);
        return;
      }

      // Execute the original handler if enabled and not marked for removal
      return handler(...args);
    };

    try {
      // Register the event listener with the wrapped handler
      provider.on(filter, wrappedHandler);
      console.log(`[EventManager] Successfully attached filter listener to provider`);

      // Store the listener details for cleanup
      this.listeners[key] = {
        type: 'filter',
        provider,
        filter,
        handler: wrappedHandler, // Store the wrapped handler
        originalHandler: handler, // Also store the original for reference
        address,
        chainId
      };

      this.log(`Registered filter listener: ${key}`);
      return key;
    } catch (error) {
      console.error(`[EventManager] Error registering filter listener: ${error.message}`, error);
      throw error;
    }
  }

  /**
   * Register an interval for periodic execution
   * @memberof module:src/EventManager
   * @param {Object} options - Registration options
   * @param {Function} options.callback - Function to execute on interval
   * @param {number} options.intervalMs - Interval in milliseconds
   * @param {string} options.vaultAddress - Associated vault address
   * @param {string} options.eventType - Type of event
   * @param {number} options.chainId - Chain ID
   * @param {string} [options.additionalId] - Optional identifier
   * @returns {string} Interval key for future reference
   * @since 1.0.0
   */
  registerInterval({ callback, intervalMs, vaultAddress, eventType, chainId, additionalId }) {
    // Generate unique key for this interval
    const key = this.generateListenerKey({ address: vaultAddress, eventType, chainId, additionalId });

    // Check for existing zombie listener (marked as removed but still present)
    const existingListener = this.listeners[key];
    if (existingListener && existingListener.isRemoved) {
      // Reactivate the zombie listener instead of creating a duplicate
      delete existingListener.isRemoved;
      this.log(`Reactivated zombie interval listener: ${key}`);

      // Clear from failed removals tracking if present
      this.clearFailedRemoval(key);

      return key; // Don't register a new interval
    }

    // Create the interval
    const intervalId = setInterval(callback, intervalMs);

    // Store the interval details for cleanup
    this.listeners[key] = {
      type: 'interval',
      intervalId,
      vaultAddress,
      chainId
    };

    this.log(`Registered interval: ${key} with ${intervalMs}ms`);
    return key;
  }
  //#endregion

  //#region Listener Removal Functions
  /**
   * Remove a specific listener by key
   * @memberof module:src/EventManager
   * @param {string} key - Listener key to remove
   * @returns {Promise<boolean>} Whether removal was successful
   * @since 1.0.0
   */
  async removeListener(key) {
    const listener = this.listeners[key];

    if (!listener) {
      this.log(`Warning: No listener found with key ${key}`);
      return false;
    }

    // Check if this listener has already been removed
    if (listener.isRemoved) {
      this.log(`Warning: Listener ${key} already removed, skipping provider.off() call`);
      return false;
    }

    try {
      // Mark as being removed to prevent duplicate cleanup
      listener.isRemoved = true;

      // Cleanup based on listener type
      if (listener.type === 'contract') {
        listener.contract.off(listener.eventName, listener.handler);
        this.log(`Removed contract listener: ${key} for event ${listener.eventName}`);
      } else if (listener.type === 'filter') {
        // Provider.off may not complete synchronously, adding small delay
        await new Promise(resolve => {
          listener.provider.off(listener.filter, listener.handler);
          setTimeout(resolve, 10); // Small delay for cleanup
        });
        this.log(`Removed filter listener: ${key}`);
      } else if (listener.type === 'interval') {
        clearInterval(listener.intervalId);
        this.log(`Removed interval: ${key}`);
      } else {
        throw new Error(`Unknown listener type: ${listener.type}`);
      }

      // Only remove from storage on successful cleanup
      delete this.listeners[key];

      // Clear any failed removal tracking for this listener
      this.clearFailedRemoval(key);

      return true;
    } catch (error) {
      console.error(`Error removing listener ${key} (type: ${listener.type}):`, error);

      // Don't reset isRemoved flag - keep it marked to prevent event processing
      // Track the failed removal for periodic retry
      this.trackFailedListenerRemoval(key, listener, error);

      return false;
    }
  }

  /**
   * Remove all listeners for a specific vault
   * @memberof module:src/EventManager
   * @param {string} vaultAddress - Vault address
   * @returns {Promise<number>} Number of listeners removed
   * @since 1.0.0
   */
  async removeAllVaultListeners(vaultAddress) {
    if (!vaultAddress) {
      this.log('Warning: No vault address provided for listener removal');
      return 0;
    }

    const normalizedVaultAddress = vaultAddress.toLowerCase();
    let removedCount = 0;

    // Step 1: Remove vault from pool mappings and clean up empty pool listeners
    for (const [poolAddress, vaults] of Object.entries(this.poolToVaults)) {
      const index = vaults.indexOf(vaultAddress);
      if (index > -1) {
        vaults.splice(index, 1);
        this.log(`Removed vault ${vaultAddress} from pool ${poolAddress} mapping`);

        // If no more vaults use this pool, remove the pool listener
        if (vaults.length === 0) {
          // Find the actual listener key for this pool
          const poolListenerKey = Object.keys(this.listeners).find(key =>
            key.startsWith(poolAddress.toLowerCase()) && key.includes('swap')
          );

          if (poolListenerKey && await this.removeListener(poolListenerKey)) {
            removedCount++;
            delete this.poolToVaults[poolAddress];
            this.log(`Removed pool listener for ${poolAddress} (no more vaults)`);
          }
        }
      }
    }

    // Step 2: Remove vault-specific contract listeners (config listeners)
    const vaultSpecificKeys = Object.keys(this.listeners).filter(
      key => this.listeners[key].vaultAddress && this.listeners[key].vaultAddress.toLowerCase() === normalizedVaultAddress
    );

    for (const key of vaultSpecificKeys) {
      if (await this.removeListener(key)) {
        removedCount++;
      }
    }

    this.log(`Removed ${removedCount} listeners for vault ${vaultAddress}`);

    // Emit event for vault cleanup completion
    this.emit('AllVaultListenersRemoved', {
      vaultAddress,
      removedCount,
      log: {
        message: `Removed ${removedCount} listeners for vault ${vaultAddress}`,
        level: 'info'
      }
    });

    return removedCount;
  }

  /**
   * Remove all listeners
   * @memberof module:src/EventManager
   * @returns {Promise<number>} Number of listeners removed
   * @since 1.0.0
   */
  async removeAllListeners() {
    // Prevent concurrent cleanup
    if (this.isCleaningUp) {
      this.log(`Cleanup already in progress, skipping duplicate removeAllListeners call`);
      return 0;
    }

    this.isCleaningUp = true;

    try {
      const listenerKeys = Object.keys(this.listeners);
      let removedCount = 0;

      // Remove each listener and wait for completion
      for (const key of listenerKeys) {
        if (await this.removeListener(key)) {
          removedCount++;
        }
      }

      // Clear pool mappings
      this.poolToVaults = {};

      this.log(`Removed all ${removedCount} listeners and cleared pool mappings`);
      return removedCount;
    } finally {
      this.isCleaningUp = false;
    }
  }
  //#endregion

  //#region Listener Subscription Functions
  /**
   * Subscribe to ExecutorChanged events to track vault authorization changes.
   * Monitors when vaults grant or revoke authorization to the automation service.
   * @memberof module:src/EventManager
   * @param {number} chainId - Chain ID for the network
   * @param {string} automationServiceAddress - Address of the automation service
   * @param {Object} provider - Ethereum provider for the network
   * @example
   * eventManager.subscribeToAuthorizationEvents(1, '0x123...', provider);
   * // Now the event manager will detect when vaults authorize/deauthorize the service
   * @since 1.0.0
   */
  subscribeToAuthorizationEvents(chainId, automationServiceAddress, provider) {
    // Create filter for ExecutorChanged events
    const filter = {
      topics: [
        ethers.utils.id("ExecutorChanged(address,bool)")
      ]
    };

    // Handler for executor change events
    const handleExecutorChanged = async (log) => {
      try {// Parse event data directly from topics (more efficient than parseLog)
        // topics[0] = event signature, topics[1] = executor address, topics[2] = isAuthorized boolean
        const executorAddress = '0x' + log.topics[1].slice(26); // Remove padding to get address
        const isAuthorized = log.topics[2].endsWith('1'); // Check if boolean is true
        const vaultAddress = log.address;


        // Early exit: only process events for our automation service
        if (executorAddress.toLowerCase() !== automationServiceAddress.toLowerCase()) {
          console.log(`❌ [EM Authorization Event Handler] ExecutorChanged event for different executor (${executorAddress}) - ignoring`);
          return;
        }

        if (isAuthorized) {
          // Emit event for new authorization
          this.emit('VaultAuthGranted', {
            vaultAddress,
            executorAddress,
            log: {
              level: 'info',
              message: `✅ [EM Authorization Event Handler] New vault authorization detected: ${vaultAddress}`,
              includeData: false
            }
          });
        } else {
          // Emit event for revocation
          this.emit('VaultAuthRevoked', {
            vaultAddress,
            executorAddress,
            log: {
              level: 'warn',
              message: `❌ [EM Authorization Event Handler] Vault authorization revoked: ${vaultAddress}`,
              includeData: true
            }
          });
        }
      } catch (error) {
        console.error("❌ [EM Authorization Event Handler] Error handling executor change event:", error);
      }
    };


    // Register with EventManager
    this.registerFilterListener({
      provider,
      filter,
      handler: handleExecutorChanged,
      address: 'global', // Global listener, not tied to a specific vault
      eventType: 'authorization',
      chainId: Number(chainId),
      additionalId: 'executor-changed'
    });
  }

  /**
   * Subscribe to configuration change events for a specific vault.
   * Monitors TargetTokensUpdated and TargetPlatformsUpdated events.
   * @memberof module:src/EventManager
   * @param {Object} vault - The vault to monitor for events
   * @param {string} vault.address - Vault contract address
   * @param {number} vault.chainId - Chain ID where vault exists
   * @param {Object} provider - Ethereum provider for the network
   * @throws {Error} If vault is invalid or provider is not available
   * @example
   * const vault = { address: '0x123...', chainId: 1 };
   * eventManager.subscribeToVaultConfigEvents(vault, provider);
   * @since 1.0.0
   */
  subscribeToVaultConfigEvents(vault, provider) {
    if (!vault || !vault.address) {
      console.error('Invalid vault provided for event subscription');
      return;
    }

    if (!provider) {
      console.error('No provider available');
      return;
    }

    try {
      // Create contract interface using library helper
      const vaultContract = getVaultContract(vault.address, provider);

      // Set up event listener for TargetTokensUpdated
      const handleTokensUpdate = async (tokens) => {
        console.log(`Target tokens updated for vault ${vault.address}: ${tokens.join(', ')}`);

        // Update vault data through VaultDataService
        const updated = await this.vaultDataService.updateTargetTokens(vault.address, tokens);
        if (!updated) {
          console.error(`Failed to update target tokens for vault ${vault.address}`);
          return;
        }

        // Get fresh vault data
        const updatedVault = await this.vaultDataService.getVault(vault.address, true);

        // Emit event instead of calling callback
        this.emit('TargetTokensUpdated', {
          vault: updatedVault,
          tokens,
          log: {
            level: 'info',
            message: `✅ [EM Config Event Handler] Target tokens updated for vault ${vault.address}: ${tokens.join(', ')}`,
            includeData: true
          }
        });
      };

      // Set up event listener for TargetPlatformsUpdated
      const handlePlatformsUpdate = async (platforms) => {
        console.log(`Target platforms updated for vault ${vault.address}: ${platforms.join(', ')}`);

        // Update vault data through VaultDataService
        const updated = await this.vaultDataService.updateTargetPlatforms(vault.address, platforms);
        if (!updated) {
          console.error(`Failed to update target platforms for vault ${vault.address}`);
          return;
        }

        // Get fresh vault data
        const updatedVault = await this.vaultDataService.getVault(vault.address, true);

        // Emit event instead of calling callback
        this.emit('TargetPlatformsUpdated', {
          vault: updatedVault,
          platforms,
          log: {
            level: 'info',
            message: `✅ [EM Config Event Handler] Target platforms updated for vault ${vault.address}: ${platforms.join(', ')}`,
            includeData: true
          }
        });
      };

      // Register event listeners with EventManager
      this.registerContractListener({
        contract: vaultContract,
        eventName: "TargetTokensUpdated",
        handler: handleTokensUpdate,
        vaultAddress: vault.address,
        eventType: 'config-tokens',
        chainId: vault.chainId
      });

      this.registerContractListener({
        contract: vaultContract,
        eventName: "TargetPlatformsUpdated",
        handler: handlePlatformsUpdate,
        vaultAddress: vault.address,
        eventType: 'config-platforms',
        chainId: vault.chainId
      });

      // Emit config monitoring setup event
      this.emit('ConfigMonitoringRegistered', {
        vaultAddress: vault.address,
        chainId: vault.chainId,
        listenersRegistered: ['TargetTokensUpdated', 'TargetPlatformsUpdated'],
        timestamp: Date.now(),
        log: {
          level: 'info',
          message: `Monitoring for target tokens and platforms changes on vault ${vault.address}`,
          includeData: false
        }
      });

      console.log(`Subscribed to configuration events for vault: ${vault.address}`);
    } catch (error) {
      console.error(`Error subscribing to config events for vault ${vault.address}:`, error);
      throw error;
    }
  }

  /**
   * Subscribe to ParameterUpdated events from strategy contracts.
   * Monitors when vaults update their strategy parameters.
   * @memberof module:src/EventManager
   * @param {number} chainId - Chain ID for the network
   * @param {Array<string>} strategyAddresses - Array of strategy contract addresses to monitor
   * @param {Object} provider - Ethereum provider for the network
   * @throws {Error} If strategyAddresses is invalid or empty
   * @example
   * const strategyAddresses = ['0x123...', '0x456...'];
   * eventManager.subscribeToStrategyParameterEvents(1, strategyAddresses, provider);
   * @since 1.0.0
   */
  subscribeToStrategyParameterEvents(chainId, strategyAddresses, provider) {
    // Validate input - fail fast if addresses are missing
    if (!Array.isArray(strategyAddresses) || strategyAddresses.length === 0) {
      throw new Error('Strategy addresses are required for parameter monitoring');
    }

    // Handler for parameter update events (shared by all listeners)
    const handleParameterUpdate = async (log) => {
      try {
        // Decode the event data
        const iface = new ethers.utils.Interface([
          "event ParameterUpdated(address indexed vault, string paramName)"
        ]);
        const parsed = iface.parseLog(log);
        const vaultAddress = parsed.args[0];
        const paramName = parsed.args[1];

        // Skip if vault is not being monitored (automation not enabled)
        // When automation is re-enabled, params will be loaded fresh from chain via setupVault
        if (!this.vaultDataService.hasVault(vaultAddress)) {
          return;
        }

        console.log(`Strategy parameters updated for vault ${vaultAddress}: ${paramName}`);

        // Refresh the entire vault data to get latest parameters
        const refreshed = await this.vaultDataService.getVault(vaultAddress, true);

        if (refreshed) {
          // Emit event instead of calling callback
          this.emit('StrategyParameterUpdated', {
            vaultAddress,
            paramName,
            log: {
              level: 'info',
              message: `✅ [EM Parameter Event Handler] Strategy parameters updated for vault ${vaultAddress}: ${paramName}`,
              includeData: true
            }
          });
        }
      } catch (error) {
        console.error("❌ [EM Parameter Event Handler] Error handling parameter update event:", error);
      }
    };

    // Create separate listener for each strategy address to avoid ethers v5 ENS bug
    const listenerKeys = [];
    for (let i = 0; i < strategyAddresses.length; i++) {
      const strategyAddress = strategyAddresses[i];

      // Create filter for this specific strategy contract
      const filter = {
        address: strategyAddress, // Single address avoids ENS concatenation bug
        topics: [
          ethers.utils.id("ParameterUpdated(address,string)")
        ]
      };

      // Register listener for this strategy
      const key = this.registerFilterListener({
        provider,
        filter,
        handler: handleParameterUpdate,
        address: strategyAddress,
        eventType: 'parameter-update',
        chainId: Number(chainId),
        additionalId: `strategy-${i}`
      });

      listenerKeys.push(key);
    }

    // Emit parameter monitoring setup event (single event for all listeners)
    this.emit('ParameterMonitoringRegistered', {
      chainId: Number(chainId),
      strategyAddresses,
      listenersRegistered: ['ParameterUpdated'],
      timestamp: Date.now(),
      log: {
        level: 'info',
        message: `Monitoring for strategy parameter updates from ${strategyAddresses.length} strategy contracts`,
        includeData: false
      }
    });

    console.log(`Monitoring for strategy parameter updates from ${strategyAddresses.length} strategy contracts: ${strategyAddresses.join(', ')}`);
  }

  /**
   * Subscribe to swap events for vault monitoring
   * @memberof module:src/EventManager
   * @param {Object} vault - Vault object with positions and strategy
   * @param {Object} provider - Ethers provider instance
   * @since 1.0.0
   */
  async subscribeToSwapEvents(vault, provider) {
    // For each position in the vault, ensure pool monitoring is set up
    for (const position of Object.values(vault.positions)) {
      const poolAddress = position.pool;
      const platform = this.poolData[poolAddress].platform;

      // Create deterministic listener key for this pool
      const listenerKey = `${poolAddress.toLowerCase()}-swap-${vault.chainId}`;

      // Check if we already have a listener for this pool
      if (!this.listeners[listenerKey]) {
        // Create NEW listener for this pool
        const adapter = this.adapters.get(platform);
        if (!adapter) {
          this.log(`No adapter for platform ${platform}`);
          continue;
        }

        // Create handler that emits events for ALL vaults using this pool
        const handleSwapEvent = async (log) => {
          const vaultAddresses = this.poolToVaults[poolAddress] || [];

          // Emit individual event for each vault monitoring this pool
          for (const vaultAddress of vaultAddresses) {
            this.emit('SwapEventDetected', {
              vaultAddress,
              poolAddress,
              platform,
              log
            });
          }
        };

        // Create filter with platform-specific signature
        const filter = {
          address: poolAddress,
          topics: [ethers.utils.id(adapter.getSwapEventSignature())]
        };

        // Register the listener (only once per pool!)
        this.registerFilterListener({
          provider,
          filter,
          handler: handleSwapEvent,
          address: poolAddress,
          eventType: 'swap',
          chainId: vault.chainId,
          additionalId: platform
        });

        // Initialize pool mapping
        this.poolToVaults[poolAddress] = [];

        this.log(`Created pool listener for ${platform} pool ${poolAddress}`);
      }

      // Add vault to the pool's vault list (whether new or existing)
      if (!this.poolToVaults[poolAddress]) {
        this.poolToVaults[poolAddress] = [];
      }

      if (!this.poolToVaults[poolAddress].includes(vault.address)) {
        this.poolToVaults[poolAddress].push(vault.address);

        this.emit('SwapMonitoringRegistered', {
          vaultAddress: vault.address,
          poolAddress: poolAddress,
          platformId: platform,
          chainId: vault.chainId,
          timestamp: Date.now()
        });

        this.log(`Added vault ${vault.address} to pool ${poolAddress} monitoring`);
      }
    }
  }
  //#endregion

  //#region Failed Listener Removal Functions
  /**
   * Clear a failed listener removal (after successful retry)
   * @memberof module:src/EventManager
   * @param {string} key - Listener key to clear
   * @since 1.0.0
   */
  clearFailedRemoval(key) {
    const wasTracked = this.failedRemovals.delete(key);
    if (wasTracked) {
      this.log(`✅ Cleared failed listener removal tracking: ${key}`);
    }
  }

  /**
   * Retry all failed listener removals
   * @memberof module:src/EventManager
   * @returns {Promise<Object>} Results of retry attempts
   * @since 1.0.0
   */
  async retryFailedRemovals() {
    const failures = Array.from(this.failedRemovals.keys());
    let successCount = 0;
    let stillFailingCount = 0;

    this.log(`Retrying ${failures.length} failed listener removals`);

    for (const key of failures) {
      try {
        // Attempt to remove the listener again
        const success = await this.removeListener(key);
        if (success) {
          successCount++;
          // removeListener will have called clearFailedRemoval on success
        } else {
          stillFailingCount++;
        }
      } catch (error) {
        stillFailingCount++;
        // trackFailedListenerRemoval will have been called again
      }
    }

    const results = {
      attempted: failures.length,
      succeeded: successCount,
      stillFailing: stillFailingCount
    };

    this.log(`Failed removal retry complete: ${successCount} succeeded, ${stillFailingCount} still failing`);

    return results;
  }

  /**
   * Track a failed listener removal for periodic retry
   * @memberof module:src/EventManager
   * @param {string} key - Listener key that failed to remove
   * @param {Object} listener - Listener object
   * @param {Error} error - Error that occurred during removal
   * @since 1.0.0
   */
  trackFailedListenerRemoval(key, listener, error) {
    this.failedRemovals.set(key, {
      listener,
      failedAt: Date.now(),
      attempts: (this.failedRemovals.get(key)?.attempts || 0) + 1,
      lastError: error.message,
      vaultAddress: listener.vaultAddress
    });

    this.log(`⚠️  Tracked failed listener removal: ${key} (${this.failedRemovals.get(key).attempts} attempts)`);
  }

  /**
   * Get all failed listener removals for monitoring
   * @memberof module:src/EventManager
   * @returns {Map} Map of failed listener removals
   * @since 1.0.0
   */
  getFailedRemovals() {
    return new Map(this.failedRemovals);
  }
  //#endregion

  //#region Helpers
  /**
   * Refresh swap event listeners for a vault after position changes
   * @memberof module:src/EventManager
   * @param {string} vaultAddress - Vault address
   * @param {Object} provider - Ethers provider instance
   * @returns {Promise<void>}
   * @since 1.0.0
   */
  async refreshSwapListeners(vaultAddress, provider) {
    this.log(`Refreshing swap listeners for vault ${vaultAddress}`);

    // Step 1: Remove vault from all pool mappings and clean up unused pool listeners
    for (const [poolAddress, vaults] of Object.entries(this.poolToVaults)) {
      const index = vaults.indexOf(vaultAddress);
      if (index > -1) {
        vaults.splice(index, 1);
        this.log(`Removed vault ${vaultAddress} from pool ${poolAddress} mapping`);

        // Clean up empty pool listeners
        if (vaults.length === 0) {
          const poolListenerKey = Object.keys(this.listeners).find(key =>
            key.startsWith(poolAddress.toLowerCase()) && key.includes('swap')
          );

          if (poolListenerKey && await this.removeListener(poolListenerKey)) {
            delete this.poolToVaults[poolAddress];
            this.log(`Removed pool listener for ${poolAddress} (no more vaults)`);
          }
        }
      }
    }

    // Step 2: Get fresh vault data and re-setup all listeners
    const vault = await this.vaultDataService.getVault(vaultAddress);
    if (vault && Object.keys(vault.positions || {}).length > 0) {
      await this.subscribeToSwapEvents(vault, provider);
      this.log(`Successfully refreshed swap listeners for vault ${vaultAddress}`);
    } else {
      this.log(`No positions found for vault ${vaultAddress} - no listeners to add`);
    }
  }

  /**
   * Enable or disable debug logging
   * @memberof module:src/EventManager
   * @param {boolean} enabled - Whether debug logging is enabled
   * @since 1.0.0
   */
  setDebug(enabled) {
    this.debug = enabled;
  }

  /**
   * Enable or disable event processing
   * @memberof module:src/EventManager
   * @param {boolean} enabled - Whether event processing is enabled
   * @returns {boolean} Current enabled state
   * @since 1.0.0
   */
  setEnabled(enabled) {
    this.enabled = !!enabled;
    this.log(`Event processing ${this.enabled ? 'enabled' : 'disabled'}`);
    return this.enabled;
  }

  /**
   * Subscribe to an event
   * @memberof module:src/EventManager
   * @param {string} event - Event name
   * @param {Function} callback - Callback function
   * @returns {Function} Unsubscribe function
   * @since 1.0.0
   */
  subscribe(event, callback) {
    if (!this.eventHandlers[event]) {
      this.eventHandlers[event] = [];
    }

    this.eventHandlers[event].push(callback);

    // Return unsubscribe function
    return () => {
      this.eventHandlers[event] = this.eventHandlers[event].filter(cb => cb !== callback);
    };
  }

  /**
   * Emit an event
   * @memberof module:src/EventManager
   * @param {string} event - Event name
   * @param {...any} args - Arguments to pass to handlers
   * @since 1.0.0
   */
  emit(event, ...args) {
    // Skip event processing if system is disabled
    if (!this.enabled) {
      this.log(`Event emission skipped (disabled): ${event}`);
      return;
    }

    // Handle per-event logging if configured
    const data = args[0];
    if (data && data.log && data.log.message) {
      const level = data.log.level || 'info';
      const logMethod = console[level] || console.log;
      const logData = data.log.includeData ? data : {};
      logMethod(`[${event}] ${data.log.message}`, logData);
    }

    if (!this.eventHandlers[event]) {
      return;
    }

    // Just call handlers - let them handle their own errors
    for (const handler of this.eventHandlers[event]) {
      handler(...args);
    }
  }

  /**
   * Generate a consistent key for storing listeners
   * @memberof module:src/EventManager
   * @param {Object} options - Key generation options
   * @param {string} options.address - Address for key generation (poolAddress for pools, 'global' for global listeners)
   * @param {string} options.eventType - Type of event (e.g., 'strategy', 'token', 'platform', 'price')
   * @param {number} options.chainId - Chain ID
   * @param {string} [options.additionalId] - Optional identifier for further disambiguation
   * @returns {string} Unique listener key
   * @since 1.0.0
   */
  generateListenerKey({ address, eventType, chainId, additionalId = '' }) {
    return `${address.toLowerCase()}-${eventType}-${chainId}${additionalId ? `-${additionalId}` : ''}`;
  }

  /**
   * Get all listener keys for a vault
   * @memberof module:src/EventManager
   * @param {string} vaultAddress - Vault address
   * @returns {Array<string>} Array of listener keys
   * @since 1.0.0
   */
  getVaultListenerKeys(vaultAddress) {
    const normalizedAddress = vaultAddress.toLowerCase();
    return Object.keys(this.listeners).filter(
      key => this.listeners[key].vaultAddress.toLowerCase() === normalizedAddress
    );
  }

  /**
   * Check if a specific listener exists
   * @memberof module:src/EventManager
   * @param {string} key - Listener key
   * @returns {boolean} Whether the listener exists
   * @since 1.0.0
   */
  hasListener(key) {
    return !!this.listeners[key];
  }

  /**
   * Get count of registered listeners
   * @memberof module:src/EventManager
   * @returns {number} Total number of registered listeners
   * @since 1.0.0
   */
  getListenerCount() {
    return Object.keys(this.listeners).length;
  }

  /**
   * Log a message if debug is enabled
   * @memberof module:src/EventManager
   * @param {string} message - Message to log
   * @since 1.0.0
   */
  log(message) {
    if (this.debug) {
      console.log(`[EventManager] ${message}`);
    }
  }

  /**
   * Get all pools being monitored
   * @memberof module:src/EventManager
   * @returns {Array<string>} Array of pool addresses
   * @since 1.0.0
   */
  getMonitoredPools() {
    return Object.keys(this.poolToVaults);
  }

  /**
   * Get all vaults monitoring a specific pool
   * @memberof module:src/EventManager
   * @param {string} poolAddress - Pool address
   * @returns {Array<string>} Array of vault addresses
   * @since 1.0.0
   */
  getVaultsForPool(poolAddress) {
    return this.poolToVaults[poolAddress] || [];
  }

  /**
   * Check if a pool is being monitored
   * @memberof module:src/EventManager
   * @param {string} poolAddress - Pool address
   * @returns {boolean} Whether the pool is being monitored
   * @since 1.0.0
   */
  isPoolMonitored(poolAddress) {
    return !!this.poolToVaults[poolAddress] && this.poolToVaults[poolAddress].length > 0;
  }

  /**
   * Get count of pool listeners (for debugging/monitoring)
   * @memberof module:src/EventManager
   * @returns {number} Number of active pool listeners
   * @since 1.0.0
   */
  getPoolListenerCount() {
    return Object.keys(this.poolToVaults).length;
  }
  //#endregion

  //#region Unused Code
  /**
   * Remove all listeners for a specific chain
   * @memberof module:src/EventManager
   * @param {number} chainId - Chain ID
   * @returns {number} Number of listeners removed
   * @since 1.0.0
   */
  removeChainListeners(chainId) {
    const listenerKeys = Object.keys(this.listeners).filter(
      key => this.listeners[key].chainId === chainId
    );

    let removedCount = 0;

    // Remove each listener
    for (const key of listenerKeys) {
      if (this.removeListener(key)) {
        removedCount++;
      }
    }

    this.log(`Removed ${removedCount} listeners for chain ${chainId}`);
    return removedCount;
  }
  //#endregion
}

export default EventManager;
