/**
 * @module core/EventManager
 * @description Core pub/sub event system for the automation service.
 * Handles event emission and subscription with optional per-event logging.
 * Blockchain listener management is handled by AutomationService.
 * @since 2.0.0
 */

import { ethers } from 'ethers';
import { getVaultContract } from 'fum_library';

/**
 * Core event management system for pub/sub pattern
 * @memberof module:core/EventManager
 * @since 2.0.0
 */
class EventManager {
  constructor() {
    // Event handlers for pub/sub pattern
    this.eventHandlers = {};

    // Blockchain listener storage
    this.listeners = {};

    // Pool-to-vault mappings for shared listeners
    this.poolToVaults = {};

    // Control flags
    this.debug = false;
    this.enabled = true;

    // Failed listener removal tracking for retry
    this.failedRemovals = new Map();
    this.isCleaningUp = false;

    // Dependencies (injected after AutomationService.initialize())
    this.poolData = null;
    this.adapters = null;
    this.vaultDataService = null;
  }

  //#region Dependency Injection

  /**
   * Set pool data reference
   * @param {Object} poolData - Pool data cache from AutomationService
   */
  setPoolData(poolData) {
    this.poolData = poolData;
  }

  /**
   * Set adapters reference
   * @param {Map} adapters - Platform adapters map from AutomationService
   */
  setAdapters(adapters) {
    this.adapters = adapters;
  }

  /**
   * Set VaultDataService reference
   * @param {Object} vaultDataService - VaultDataService instance
   */
  setVaultDataService(vaultDataService) {
    this.vaultDataService = vaultDataService;
  }

  //#endregion

  //#region Pub/Sub Methods

  /**
   * Subscribe to an event
   * @param {string} event - Event name
   * @param {Function} callback - Callback function
   * @returns {Function} Unsubscribe function
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
   * Emit an event to all subscribers
   * @param {string} event - Event name
   * @param {...any} args - Arguments to pass to handlers
   */
  emit(event, ...args) {
    // Skip event processing if system is disabled (only during shutdown)
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

    // Call handlers - let them handle their own errors
    for (const handler of this.eventHandlers[event]) {
      handler(...args);
    }
  }

  //#endregion

  //#region Listener Registration

  /**
   * Register a contract event listener
   * @param {Object} options - Registration options
   * @returns {string} Listener key for future reference
   */
  registerContractListener({ contract, eventName, handler, vaultAddress, eventType, chainId, additionalId }) {
    const key = this.generateListenerKey({ id: vaultAddress, eventType, chainId, additionalId });

    // Check for existing zombie listener
    const existingListener = this.listeners[key];
    if (existingListener && existingListener.isRemoved) {
      delete existingListener.isRemoved;
      this.log(`Reactivated zombie contract listener: ${key}`);
      this.clearFailedRemoval(key);
      return key;
    }

    console.log(`EventManager: Registering contract listener for ${eventName} on ${vaultAddress}`);

    // Wrapper handler that checks removal state
    const wrappedHandler = (...args) => {
      const listener = this.listeners[key];
      if (listener && listener.isRemoved) {
        this.log(`Contract event handling skipped (listener marked for removal) for ${key}`);
        return;
      }
      return handler(...args);
    };

    contract.on(eventName, wrappedHandler);

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
   * @param {Object} options - Registration options
   * @returns {string} Listener key for future reference
   */
  registerFilterListener({ provider, filter, handler, address, eventType, chainId, additionalId }) {
    if (!this.enabled) {
      this.log(`Filter listener registration skipped (disabled) for address ${address}`);
      const key = this.generateListenerKey({ id: address, eventType, chainId, additionalId });
      return key;
    }

    const key = this.generateListenerKey({ id: address, eventType, chainId, additionalId });

    // Check for existing zombie listener
    const existingListener = this.listeners[key];
    if (existingListener && existingListener.isRemoved) {
      delete existingListener.isRemoved;
      this.log(`Reactivated zombie filter listener: ${key}`);
      this.clearFailedRemoval(key);
      return key;
    }

    console.log(`[EventManager] Registering filter for: ${eventType} on address ${address}`);

    // Wrapper handler that checks enabled status and removal state
    const wrappedHandler = (...args) => {
      console.log(`[EventManager] Filter event detected for ${key}`);

      if (!this.enabled) {
        this.log(`Filter event handling skipped (disabled) for ${key}`);
        return;
      }

      const listener = this.listeners[key];
      if (listener && listener.isRemoved) {
        this.log(`Filter event handling skipped (listener marked for removal) for ${key}`);
        return;
      }

      return handler(...args);
    };

    try {
      provider.on(filter, wrappedHandler);
      console.log(`[EventManager] Successfully attached filter listener to provider`);

      this.listeners[key] = {
        type: 'filter',
        provider,
        filter,
        handler: wrappedHandler,
        originalHandler: handler,
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
   * @param {Object} options - Registration options
   * @returns {string} Interval key for future reference
   */
  registerInterval({ callback, intervalMs, vaultAddress, eventType, chainId, additionalId }) {
    const key = this.generateListenerKey({ id: vaultAddress, eventType, chainId, additionalId });

    const existingListener = this.listeners[key];
    if (existingListener && existingListener.isRemoved) {
      delete existingListener.isRemoved;
      this.log(`Reactivated zombie interval listener: ${key}`);
      this.clearFailedRemoval(key);
      return key;
    }

    const intervalId = setInterval(callback, intervalMs);

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

  //#region Listener Removal

  /**
   * Remove a specific listener by key
   * @param {string} key - Listener key to remove
   * @returns {Promise<boolean>} Whether removal was successful
   */
  async removeListener(key) {
    const listener = this.listeners[key];

    if (!listener) {
      this.log(`Warning: No listener found with key ${key}`);
      return false;
    }

    if (listener.isRemoved) {
      this.log(`Warning: Listener ${key} already removed, skipping`);
      return false;
    }

    try {
      listener.isRemoved = true;

      if (listener.type === 'contract') {
        listener.contract.off(listener.eventName, listener.handler);
        this.log(`Removed contract listener: ${key} for event ${listener.eventName}`);
      } else if (listener.type === 'filter') {
        await new Promise(resolve => {
          listener.provider.off(listener.filter, listener.handler);
          setTimeout(resolve, 10);
        });
        this.log(`Removed filter listener: ${key}`);
      } else if (listener.type === 'interval') {
        clearInterval(listener.intervalId);
        this.log(`Removed interval: ${key}`);
      } else {
        throw new Error(`Unknown listener type: ${listener.type}`);
      }

      delete this.listeners[key];
      this.clearFailedRemoval(key);
      return true;
    } catch (error) {
      console.error(`Error removing listener ${key} (type: ${listener.type}):`, error);
      this.trackFailedListenerRemoval(key, listener, error);
      return false;
    }
  }

  /**
   * Remove all listeners for a specific vault
   * @param {string} vaultAddress - Vault address
   * @returns {Promise<number>} Number of listeners removed
   */
  async removeAllVaultListeners(vaultAddress) {
    if (!vaultAddress) {
      this.log('Warning: No vault address provided for listener removal');
      return 0;
    }

    const normalizedVaultAddress = vaultAddress.toLowerCase();
    let removedCount = 0;

    // Step 1: Remove vault from pool mappings and clean up empty pool listeners
    for (const [poolId, vaults] of Object.entries(this.poolToVaults)) {
      const index = vaults.indexOf(vaultAddress);
      if (index > -1) {
        vaults.splice(index, 1);
        this.log(`Removed vault ${vaultAddress} from pool ${poolId} mapping`);

        if (vaults.length === 0) {
          const poolListenerKey = Object.keys(this.listeners).find(key =>
            key.startsWith(poolId.toLowerCase()) && key.includes('swap')
          );

          if (poolListenerKey && await this.removeListener(poolListenerKey)) {
            removedCount++;
            delete this.poolToVaults[poolId];
            this.log(`Removed pool listener for ${poolId} (no more vaults)`);
          }
        }
      }
    }

    // Step 2: Remove vault-specific contract listeners
    const vaultSpecificKeys = Object.keys(this.listeners).filter(
      key => this.listeners[key].vaultAddress && this.listeners[key].vaultAddress.toLowerCase() === normalizedVaultAddress
    );

    for (const key of vaultSpecificKeys) {
      if (await this.removeListener(key)) {
        removedCount++;
      }
    }

    this.log(`Removed ${removedCount} listeners for vault ${vaultAddress}`);

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
   * @returns {Promise<number>} Number of listeners removed
   */
  async removeAllListeners() {
    if (this.isCleaningUp) {
      this.log(`Cleanup already in progress, skipping duplicate removeAllListeners call`);
      return 0;
    }

    this.isCleaningUp = true;

    try {
      const listenerKeys = Object.keys(this.listeners);
      let removedCount = 0;

      for (const key of listenerKeys) {
        if (await this.removeListener(key)) {
          removedCount++;
        }
      }

      this.poolToVaults = {};
      this.log(`Removed all ${removedCount} listeners and cleared pool mappings`);
      return removedCount;
    } finally {
      this.isCleaningUp = false;
    }
  }

  //#endregion

  //#region Failed Removal Tracking

  /**
   * Clear a failed listener removal
   * @param {string} key - Listener key to clear
   */
  clearFailedRemoval(key) {
    const wasTracked = this.failedRemovals.delete(key);
    if (wasTracked) {
      this.log(`Cleared failed listener removal tracking: ${key}`);
    }
  }

  /**
   * Track a failed listener removal for periodic retry
   * @param {string} key - Listener key
   * @param {Object} listener - Listener object
   * @param {Error} error - Error that occurred
   */
  trackFailedListenerRemoval(key, listener, error) {
    this.failedRemovals.set(key, {
      listener,
      failedAt: Date.now(),
      attempts: (this.failedRemovals.get(key)?.attempts || 0) + 1,
      lastError: error.message,
      vaultAddress: listener.vaultAddress
    });

    this.log(`Tracked failed listener removal: ${key} (${this.failedRemovals.get(key).attempts} attempts)`);
  }

  /**
   * Retry all failed listener removals
   * @returns {Promise<Object>} Results of retry attempts
   */
  async retryFailedRemovals() {
    const failures = Array.from(this.failedRemovals.keys());
    let successCount = 0;
    let stillFailingCount = 0;

    this.log(`Retrying ${failures.length} failed listener removals`);

    for (const key of failures) {
      try {
        const success = await this.removeListener(key);
        if (success) {
          successCount++;
        } else {
          stillFailingCount++;
        }
      } catch (error) {
        stillFailingCount++;
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
   * Get all failed listener removals for monitoring
   * @returns {Map} Map of failed listener removals
   */
  getFailedRemovals() {
    return new Map(this.failedRemovals);
  }

  //#endregion

  //#region Helpers

  /**
   * Generate a consistent key for storing listeners
   * @param {Object} options - Key generation options
   * @param {string} options.id - Unique identifier (vault address, pool id, etc)
   * @param {string} options.eventType - Type of event being listened for
   * @param {number} options.chainId - Chain ID
   * @param {string} [options.additionalId] - Optional additional identifier
   * @returns {string} Unique listener key
   */
  generateListenerKey({ id, eventType, chainId, additionalId = '' }) {
    return `${id.toLowerCase()}-${eventType}-${chainId}${additionalId ? `-${additionalId}` : ''}`;
  }

  /**
   * Enable or disable debug logging
   * @param {boolean} enabled - Whether debug logging is enabled
   */
  setDebug(enabled) {
    this.debug = enabled;
  }

  /**
   * Enable or disable event processing
   * @param {boolean} enabled - Whether event processing is enabled
   * @returns {boolean} Current enabled state
   */
  setEnabled(enabled) {
    this.enabled = !!enabled;
    this.log(`Event processing ${this.enabled ? 'enabled' : 'disabled'}`);
    return this.enabled;
  }

  /**
   * Log a message if debug is enabled
   * @param {string} message - Message to log
   */
  log(message) {
    if (this.debug) {
      console.log(`[EventManager] ${message}`);
    }
  }

  /**
   * Check if a specific listener exists
   * @param {string} key - Listener key
   * @returns {boolean} Whether the listener exists
   */
  hasListener(key) {
    return !!this.listeners[key];
  }

  /**
   * Get count of registered listeners
   * @returns {number} Total number of registered listeners
   */
  getListenerCount() {
    return Object.keys(this.listeners).length;
  }

  /**
   * Get all pools being monitored
   * @returns {Array<string>} Array of pool identifiers
   */
  getMonitoredPools() {
    return Object.keys(this.poolToVaults);
  }

  /**
   * Get all vaults monitoring a specific pool
   * @param {string} poolId - Pool identifier
   * @returns {Array<string>} Array of vault addresses
   */
  getVaultsForPool(poolId) {
    return this.poolToVaults[poolId] || [];
  }

  /**
   * Check if a pool is being monitored
   * @param {string} poolId - Pool identifier
   * @returns {boolean} Whether the pool is being monitored
   */
  isPoolMonitored(poolId) {
    return !!this.poolToVaults[poolId] && this.poolToVaults[poolId].length > 0;
  }

  /**
   * Get count of pool listeners
   * @returns {number} Number of active pool listeners
   */
  getPoolListenerCount() {
    return Object.keys(this.poolToVaults).length;
  }

  /**
   * Add a vault to a pool's monitoring list
   * @param {string} poolId - Pool identifier
   * @param {string} vaultAddress - Vault address
   */
  addVaultToPool(poolId, vaultAddress) {
    if (!this.poolToVaults[poolId]) {
      this.poolToVaults[poolId] = [];
    }

    if (!this.poolToVaults[poolId].includes(vaultAddress)) {
      this.poolToVaults[poolId].push(vaultAddress);
      this.log(`Added vault ${vaultAddress} to pool ${poolId} monitoring`);
    }
  }

  //#endregion

  //#region Vault Monitoring

  /**
   * Subscribe to swap events for all pools associated with vault positions
   * @param {Object} vault - Vault object with positions
   * @param {Object} provider - Ethers provider
   * @param {number} chainId - Chain ID
   */
  async subscribeToSwapEvents(vault, provider, chainId) {
    for (const position of Object.values(vault.positions)) {
      const poolId = position.pool;
      const poolInfo = this.poolData[poolId];

      if (!poolInfo) {
        this.log(`No pool data for ${poolId}, skipping swap monitoring`);
        continue;
      }

      const platform = poolInfo.platform;
      const adapter = this.adapters.get(platform);

      if (!adapter) {
        this.log(`No adapter for platform ${platform}, skipping swap monitoring for pool ${poolId}`);
        continue;
      }

      // Check if we already have a listener for this pool
      const listenerKey = this.generateListenerKey({
        id: poolId,
        eventType: 'swap',
        chainId,
        additionalId: platform
      });

      if (!this.hasListener(listenerKey)) {
        // Create handler that emits events for ALL vaults using this pool
        const handleSwapEvent = async (log) => {
          const vaultAddresses = this.getVaultsForPool(poolId);

          for (const vaultAddress of vaultAddresses) {
            this.emit('SwapEventDetected', {
              vaultAddress,
              poolId,
              platform,
              log
            });
          }
        };

        // Create filter via platform adapter (platform-agnostic)
        const filter = adapter.getSwapEventFilter(poolId);

        // Register the listener (only once per pool!)
        this.registerFilterListener({
          provider,
          filter,
          handler: handleSwapEvent,
          address: poolId,
          eventType: 'swap',
          chainId,
          additionalId: platform
        });

        this.log(`Created swap listener for ${platform} pool ${poolId}`);
      }

      // Add vault to pool mapping (whether new or existing listener)
      this.addVaultToPool(poolId, vault.address);

      this.emit('SwapMonitoringRegistered', {
        vaultAddress: vault.address,
        poolId,
        platformId: platform,
        chainId,
        timestamp: Date.now(),
        log: {
          level: 'debug',
          message: `Swap monitoring registered for vault ${vault.address} on pool ${poolId}`
        }
      });
    }
  }

  /**
   * Refresh swap event listeners for a vault after position changes
   *
   * Called after rebalance to ensure the vault is listening to the correct pool.
   * The new position might be in a different pool (e.g., different fee tier).
   *
   * @param {string} vaultAddress - Vault address
   * @param {Object} provider - Ethers provider
   * @param {number} chainId - Chain ID
   */
  async refreshSwapListeners(vaultAddress, provider, chainId) {
    this.log(`Refreshing swap listeners for vault ${vaultAddress}`);

    // Step 1: Remove vault from all pool mappings and clean up unused listeners
    for (const [poolAddress, vaults] of Object.entries(this.poolToVaults)) {
      const index = vaults.indexOf(vaultAddress);
      if (index > -1) {
        vaults.splice(index, 1);
        this.log(`Removed vault ${vaultAddress} from pool ${poolAddress}`);

        // Clean up empty pool listeners
        if (vaults.length === 0) {
          const platform = this.poolData[poolAddress]?.platform;
          const listenerKey = this.generateListenerKey({
            id: poolAddress,
            eventType: 'swap',
            chainId,
            additionalId: platform
          });

          if (this.hasListener(listenerKey)) {
            await this.removeListener(listenerKey);
            delete this.poolToVaults[poolAddress];
            this.log(`Removed pool listener for ${poolAddress} (no vaults remain)`);
          }
        }
      }
    }

    // Step 2: Get fresh vault data and re-subscribe to swap events
    const vault = await this.vaultDataService.getVault(vaultAddress);
    if (vault && Object.keys(vault.positions || {}).length > 0) {
      await this.subscribeToSwapEvents(vault, provider, chainId);
      this.log(`Refreshed swap listeners for vault ${vaultAddress}`);
    } else {
      this.log(`No positions for vault ${vaultAddress} - no swap listeners added`);
    }
  }

  /**
   * Subscribe to vault configuration change events
   * @param {Object} vault - Vault object
   * @param {Object} provider - Ethers provider
   * @param {number} chainId - Chain ID
   */
  subscribeToVaultConfigEvents(vault, provider, chainId) {
    const vaultContract = getVaultContract(vault.address, provider);

    // Handler for target tokens update
    const handleTokensUpdate = async (tokens) => {
      try {
        this.log(`Target tokens updated for vault ${vault.address}: ${tokens.join(', ')}`);

        const updated = await this.vaultDataService.updateTargetTokens(vault.address, tokens);
        if (!updated) {
          throw new Error('Failed to update target tokens in cache');
        }

        const updatedVault = await this.vaultDataService.getVault(vault.address, true);

        this.emit('TargetTokensUpdated', {
          vault: updatedVault,
          tokens,
          log: {
            level: 'info',
            message: `Target tokens updated for vault ${vault.address}: ${tokens.join(', ')}`
          }
        });
      } catch (error) {
        console.error(`Error handling target tokens update for vault ${vault.address}:`, error);
        this.emit('ConfigUpdateFailed', {
          vaultAddress: vault.address,
          configType: 'targetTokens',
          error: error.message,
          log: {
            level: 'error',
            message: `Config update failed for vault ${vault.address}: ${error.message}`
          }
        });
      }
    };

    // Handler for target platforms update
    const handlePlatformsUpdate = async (platforms) => {
      try {
        this.log(`Target platforms updated for vault ${vault.address}: ${platforms.join(', ')}`);

        const updated = await this.vaultDataService.updateTargetPlatforms(vault.address, platforms);
        if (!updated) {
          throw new Error('Failed to update target platforms in cache');
        }

        const updatedVault = await this.vaultDataService.getVault(vault.address, true);

        this.emit('TargetPlatformsUpdated', {
          vault: updatedVault,
          platforms,
          log: {
            level: 'info',
            message: `Target platforms updated for vault ${vault.address}: ${platforms.join(', ')}`
          }
        });
      } catch (error) {
        console.error(`Error handling target platforms update for vault ${vault.address}:`, error);
        this.emit('ConfigUpdateFailed', {
          vaultAddress: vault.address,
          configType: 'targetPlatforms',
          error: error.message,
          log: {
            level: 'error',
            message: `Config update failed for vault ${vault.address}: ${error.message}`
          }
        });
      }
    };

    // Register listeners
    this.registerContractListener({
      contract: vaultContract,
      eventName: 'TargetTokensUpdated',
      handler: handleTokensUpdate,
      vaultAddress: vault.address,
      eventType: 'config-tokens',
      chainId
    });

    this.registerContractListener({
      contract: vaultContract,
      eventName: 'TargetPlatformsUpdated',
      handler: handlePlatformsUpdate,
      vaultAddress: vault.address,
      eventType: 'config-platforms',
      chainId
    });

    this.log(`Config monitoring registered for vault ${vault.address}`);
  }

  /**
   * Subscribe to authorization events (ExecutorChanged)
   * @param {Object} provider - Ethers provider
   * @param {string} automationServiceAddress - Address of the automation service
   * @param {number} chainId - Chain ID
   */
  subscribeToAuthorizationEvents(provider, automationServiceAddress, chainId) {
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
        if (executorAddress.toLowerCase() !== automationServiceAddress.toLowerCase()) {
          return;
        }

        if (isAuthorized) {
          this.emit('VaultAuthGranted', {
            vaultAddress,
            executorAddress,
            log: {
              level: 'info',
              message: `New vault authorization detected: ${vaultAddress}`
            }
          });
        } else {
          this.emit('VaultAuthRevoked', {
            vaultAddress,
            executorAddress,
            log: {
              level: 'warn',
              message: `Vault authorization revoked: ${vaultAddress}`
            }
          });
        }
      } catch (error) {
        console.error('🔴 Error handling executor change event:', error);
        this.emit('VaultAuthEventFailed', {
          vaultAddress: log.address,
          rawLog: log,
          error: error.message,
          log: {
            level: 'error',
            message: `Failed to process ExecutorChanged event for vault: ${log.address}`
          }
        });
      }
    };

    this.registerFilterListener({
      provider,
      filter,
      handler: handleExecutorChanged,
      address: 'global',
      eventType: 'authorization',
      chainId,
      additionalId: 'executor-changed'
    });

    this.log('Subscribed to authorization events');
  }

  /**
   * Subscribe to strategy parameter update events
   * @param {string[]} strategyAddresses - Array of strategy contract addresses
   * @param {Object} provider - Ethers provider
   * @param {number} chainId - Chain ID
   */
  subscribeToStrategyParameterEvents(strategyAddresses, provider, chainId) {
    this.log('Subscribing to strategy parameter events...');

    if (!strategyAddresses || strategyAddresses.length === 0) {
      this.log('No strategy contracts provided, skipping parameter event subscription');
      return;
    }

    const handleParameterUpdate = async (log) => {
      let vaultAddress;
      try {
        const iface = new ethers.utils.Interface([
          'event ParameterUpdated(address indexed vault, string paramName)'
        ]);
        const parsed = iface.parseLog(log);
        vaultAddress = parsed.args[0];
        const paramName = parsed.args[1];

        // Skip if vault is not being monitored
        if (!this.vaultDataService.hasVault(vaultAddress)) {
          return;
        }

        this.log(`Strategy parameter updated for vault ${vaultAddress}: ${paramName}`);

        // Refresh vault data
        await this.vaultDataService.getVault(vaultAddress, true);

        this.emit('StrategyParameterUpdated', {
          vaultAddress,
          paramName,
          log: {
            level: 'info',
            message: `Strategy parameters updated for vault ${vaultAddress}: ${paramName}`
          }
        });
      } catch (error) {
        console.error('Error handling parameter update event:', error);
        this.emit('StrategyParameterUpdateFailed', {
          vaultAddress,
          error: error.message,
          log: {
            level: 'error',
            message: `Strategy parameter update failed for vault ${vaultAddress}: ${error.message}`
          }
        });
      }
    };

    const handleTemplateSelected = async (log) => {
      let vaultAddress;
      try {
        const iface = new ethers.utils.Interface([
          'event TemplateSelected(address indexed vault, uint8 template)'
        ]);
        const parsed = iface.parseLog(log);
        vaultAddress = parsed.args[0];
        const templateId = parsed.args[1];

        // Skip if vault is not being monitored
        if (!this.vaultDataService.hasVault(vaultAddress)) {
          return;
        }

        this.log(`Strategy template changed for vault ${vaultAddress}: template ${templateId}`);

        // Refresh vault data (template change affects effective parameters)
        await this.vaultDataService.getVault(vaultAddress, true);

        this.emit('StrategyParameterUpdated', {
          vaultAddress,
          paramName: 'template',
          templateId,
          log: {
            level: 'info',
            message: `Strategy template changed for vault ${vaultAddress}: template ${templateId}`
          }
        });
      } catch (error) {
        console.error('Error handling template selected event:', error);
        this.emit('StrategyParameterUpdateFailed', {
          vaultAddress,
          error: error.message,
          log: {
            level: 'error',
            message: `Strategy template update failed for vault ${vaultAddress}: ${error.message}`
          }
        });
      }
    };

    // Create listeners for each strategy address
    for (let i = 0; i < strategyAddresses.length; i++) {
      const strategyAddress = strategyAddresses[i];

      // ParameterUpdated listener
      const paramFilter = {
        address: strategyAddress,
        topics: [ethers.utils.id('ParameterUpdated(address,string)')]
      };

      this.registerFilterListener({
        provider,
        filter: paramFilter,
        handler: handleParameterUpdate,
        address: strategyAddress,
        eventType: 'parameter-update',
        chainId,
        additionalId: `strategy-${i}`
      });

      // TemplateSelected listener
      const templateFilter = {
        address: strategyAddress,
        topics: [ethers.utils.id('TemplateSelected(address,uint8)')]
      };

      this.registerFilterListener({
        provider,
        filter: templateFilter,
        handler: handleTemplateSelected,
        address: strategyAddress,
        eventType: 'template-selected',
        chainId,
        additionalId: `strategy-${i}`
      });
    }

    this.log(`Subscribed to parameter and template events for ${strategyAddresses.length} strategy contract(s)`);
  }

  //#endregion
}

export default EventManager;
