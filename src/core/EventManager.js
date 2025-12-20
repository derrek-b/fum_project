/**
 * @module core/EventManager
 * @description Core pub/sub event system for the automation service.
 * Handles event emission and subscription with optional per-event logging.
 * Blockchain listener management is handled by AutomationService.
 * @since 2.0.0
 */

import { ethers } from 'ethers';

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
  }

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
    const key = this.generateListenerKey({ address: vaultAddress, eventType, chainId, additionalId });

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
      const key = this.generateListenerKey({ address, eventType, chainId, additionalId });
      return key;
    }

    const key = this.generateListenerKey({ address, eventType, chainId, additionalId });

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
    const key = this.generateListenerKey({ address: vaultAddress, eventType, chainId, additionalId });

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
    for (const [poolAddress, vaults] of Object.entries(this.poolToVaults)) {
      const index = vaults.indexOf(vaultAddress);
      if (index > -1) {
        vaults.splice(index, 1);
        this.log(`Removed vault ${vaultAddress} from pool ${poolAddress} mapping`);

        if (vaults.length === 0) {
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
   * @returns {string} Unique listener key
   */
  generateListenerKey({ address, eventType, chainId, additionalId = '' }) {
    return `${address.toLowerCase()}-${eventType}-${chainId}${additionalId ? `-${additionalId}` : ''}`;
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
   * @returns {Array<string>} Array of pool addresses
   */
  getMonitoredPools() {
    return Object.keys(this.poolToVaults);
  }

  /**
   * Get all vaults monitoring a specific pool
   * @param {string} poolAddress - Pool address
   * @returns {Array<string>} Array of vault addresses
   */
  getVaultsForPool(poolAddress) {
    return this.poolToVaults[poolAddress] || [];
  }

  /**
   * Check if a pool is being monitored
   * @param {string} poolAddress - Pool address
   * @returns {boolean} Whether the pool is being monitored
   */
  isPoolMonitored(poolAddress) {
    return !!this.poolToVaults[poolAddress] && this.poolToVaults[poolAddress].length > 0;
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
   * @param {string} poolAddress - Pool address
   * @param {string} vaultAddress - Vault address
   */
  addVaultToPool(poolAddress, vaultAddress) {
    if (!this.poolToVaults[poolAddress]) {
      this.poolToVaults[poolAddress] = [];
    }

    if (!this.poolToVaults[poolAddress].includes(vaultAddress)) {
      this.poolToVaults[poolAddress].push(vaultAddress);
      this.log(`Added vault ${vaultAddress} to pool ${poolAddress} monitoring`);
    }
  }

  //#endregion
}

export default EventManager;
