/**
 * @module strategies/base/StrategyBase
 * @description Abstract base class for all vault management strategies
 */

/**
 * Abstract base class that defines the interface for vault management strategies.
 * All strategy implementations must extend this class and implement the abstract methods.
 */
export default class StrategyBase {
  /**
   * Create a new strategy instance
   * @param {Object} dependencies - Strategy dependencies
   * @param {Object} dependencies.vaultDataService - Service for vault data access
   * @param {Object} dependencies.eventManager - Event management service
   * @param {Object} dependencies.provider - Ethers provider
   * @param {Map} dependencies.adapters - Platform adapters map
   * @param {number} dependencies.chainId - Chain ID
   * @param {boolean} dependencies.debug - Debug mode flag
   * @param {Object} dependencies.vaultLocks - Vault locking mechanism
   * @param {Object} dependencies.poolData - Pool data cache
   * @param {Function} dependencies.sendTelegramMessage - Notification function
   * @param {Object} dependencies.automationService - Reference to AutomationService
   * @param {Object} dependencies.tokens - Token configurations
   * @param {Object} dependencies.serviceConfig - Service configuration
   */
  constructor(dependencies) {
    this.vaultDataService = dependencies.vaultDataService;
    this.eventManager = dependencies.eventManager;
    this.provider = dependencies.provider;
    this.adapters = dependencies.adapters;
    this.chainId = dependencies.chainId;
    this.debug = dependencies.debug ?? false;
    this.vaultLocks = dependencies.vaultLocks;
    this.poolData = dependencies.poolData;
    this.sendTelegramMessage = dependencies.sendTelegramMessage;
    this.automationService = dependencies.automationService;
    this.tokens = dependencies.tokens;
    this.serviceConfig = dependencies.serviceConfig;

    // Track registered listeners per vault for cleanup
    this.registeredListenerKeys = {};
  }

  // ============================================================
  // Abstract Methods - Must be implemented by subclasses
  // ============================================================

  /**
   * Initialize a vault for this strategy
   * @param {Object} vault - The vault to initialize
   * @returns {Promise<boolean>} True if initialization succeeded
   * @abstract
   */
  async initializeVaultStrategy(vault) {
    throw new Error('StrategyBase.initializeVaultStrategy must be implemented by subclass');
  }

  /**
   * Handle a swap event from a monitored pool
   * @param {Object} vault - The vault affected by the swap
   * @param {string} poolAddress - Address of the pool
   * @param {string} platform - Platform identifier (e.g., 'uniswapV3')
   * @param {Object} log - The event log
   * @returns {Promise<void>}
   * @abstract
   */
  async handleSwapEvent(vault, poolAddress, platform, log) {
    throw new Error('StrategyBase.handleSwapEvent must be implemented by subclass');
  }

  /**
   * Clean up all listeners and state for a vault
   * @param {string} vaultAddress - Address of the vault to clean up
   * @returns {Promise<void>}
   * @abstract
   */
  async cleanup(vaultAddress) {
    throw new Error('StrategyBase.cleanup must be implemented by subclass');
  }

  /**
   * Check if a vault needs recovery from a failed state
   * @param {Object} vault - The vault to check
   * @returns {Promise<boolean>} True if recovery is needed
   * @abstract
   */
  async needsRecovery(vault) {
    throw new Error('StrategyBase.needsRecovery must be implemented by subclass');
  }

  /**
   * Attempt to recover a vault from a failed state
   * @param {Object} vault - The vault to recover
   * @returns {Promise<boolean>} True if recovery succeeded
   * @abstract
   */
  async attemptRecovery(vault) {
    throw new Error('StrategyBase.attemptRecovery must be implemented by subclass');
  }

  // ============================================================
  // Helper Methods - Available to all subclasses
  // ============================================================

  /**
   * Register an event filter listener
   * @param {Object} options - Filter options
   * @param {string} options.vaultAddress - Vault address
   * @param {string} options.filterType - Type of filter
   * @param {string} options.address - Contract address to filter
   * @param {Function} options.handler - Event handler function
   * @returns {string} The listener key
   */
  registerEventFilter(options) {
    const { vaultAddress, filterType, address, handler } = options;

    const listenerKey = this.eventManager.registerFilterListener({
      filterType,
      address,
      chainId: this.chainId,
      handler
    });

    // Track for cleanup
    if (!this.registeredListenerKeys[vaultAddress]) {
      this.registeredListenerKeys[vaultAddress] = [];
    }
    this.registeredListenerKeys[vaultAddress].push(listenerKey);

    return listenerKey;
  }

  /**
   * Register a contract event listener
   * @param {Object} options - Listener options
   * @param {string} options.vaultAddress - Vault address
   * @param {Object} options.contract - Contract instance
   * @param {string} options.eventName - Event name to listen for
   * @param {Function} options.handler - Event handler function
   * @returns {string} The listener key
   */
  registerContractEvent(options) {
    const { vaultAddress, contract, eventName, handler } = options;

    const listenerKey = this.eventManager.registerContractListener({
      contract,
      eventName,
      handler
    });

    // Track for cleanup
    if (!this.registeredListenerKeys[vaultAddress]) {
      this.registeredListenerKeys[vaultAddress] = [];
    }
    this.registeredListenerKeys[vaultAddress].push(listenerKey);

    return listenerKey;
  }

  /**
   * Get vault data, optionally forcing a refresh
   * @param {Object} vault - The vault object (or address string)
   * @param {boolean} forceRefresh - Force refresh from chain
   * @returns {Promise<Object>} The vault data
   */
  async getVaultData(vault, forceRefresh = false) {
    const address = typeof vault === 'string' ? vault : vault.address;
    return this.vaultDataService.getVault(address, forceRefresh);
  }

  /**
   * Refresh vault positions from chain
   * @param {Object} vault - The vault to refresh
   * @returns {Promise<Object>} Updated positions
   */
  async refreshVaultPositions(vault) {
    const address = typeof vault === 'string' ? vault : vault.address;
    await this.vaultDataService.refreshVault(address);
    const updated = await this.vaultDataService.getVault(address);
    return updated?.positions || {};
  }

  /**
   * Unregister all listeners for a vault
   * @param {string} vaultAddress - The vault address
   */
  unregisterAllListeners(vaultAddress) {
    const keys = this.registeredListenerKeys[vaultAddress] || [];
    for (const key of keys) {
      this.eventManager.removeListener(key);
    }
    delete this.registeredListenerKeys[vaultAddress];
  }

  /**
   * Log a message with strategy prefix
   * @param {string} message - Message to log
   * @param {...any} args - Additional arguments
   */
  log(message, ...args) {
    if (this.debug) {
      console.log(`[${this.constructor.name}] ${message}`, ...args);
    }
  }
}
