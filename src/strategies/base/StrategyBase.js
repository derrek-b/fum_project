/**
 * @module strategies/base/StrategyBase
 * @description Abstract base class for all vault management strategies
 */

/**
 * Abstract base class that defines the interface for vault management strategies.
 * All strategy implementations must extend this class.
 *
 * Phase 1: Basic initialization with dependency injection.
 * Methods and interface TBD during Phase 2 design.
 */
export default class StrategyBase {
  /**
   * Create a new strategy instance
   * @param {Object} dependencies - Strategy dependencies
   * @param {Object} dependencies.vaultDataService - Service for vault data access
   * @param {Object} dependencies.eventManager - Event management service
   * @param {Object} dependencies.provider - Ethers provider (null until initialize)
   * @param {Map} dependencies.adapters - Platform adapters map (null until initialize)
   * @param {number} dependencies.chainId - Chain ID
   * @param {boolean} dependencies.debug - Debug mode flag
   * @param {Object} dependencies.vaultLocks - Vault locking mechanism
   * @param {Object} dependencies.poolData - Pool data cache
   * @param {Function} dependencies.sendTelegramMessage - Notification function
   * @param {Object} dependencies.automationService - Reference to AutomationService
   * @param {Object} dependencies.tokens - Token configurations (null until initialize)
   * @param {Object} dependencies.serviceConfig - Service configuration (null until initialize)
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
