/**
 * @module adapters/AdapterFactory
 * @description Factory class for creating platform-specific adapter instances
 */

// fum_library/adapters/AdapterFactory.js
import UniswapV3Adapter from "./UniswapV3Adapter.js";
import { getChainConfig, lookupChainPlatformIds } from "../helpers/chainHelpers.js";

/**
 * Factory class for creating and managing platform adapters
 *
 * @class AdapterFactory
 * @memberof module:adapters/AdapterFactory
 */
export default class AdapterFactory {
  /**
   * Map of platform IDs to adapter classes
   * @private
   */
  static #PLATFORM_ADAPTERS = {
    uniswapV3: UniswapV3Adapter,
    // Add more adapters here as they are implemented
    // Example: sushiswap: SushiswapAdapter,
  };

  /**
   * Gets all available adapters for a specific chain
   *
   * @function getAdaptersForChain
   * @memberof module:adapters/AdapterFactory
   * @static
   *
   * @param {number} chainId - Chain ID
   * @param {Object} provider - Ethers provider instance
   *
   * @returns {Object} Result object containing adapters and failures
   * @returns {Array} result.adapters - Array of successfully created platform adapter instances
   * @returns {Array} result.failures - Array of failure objects with platformId and error details
   *
   * @example
   * const result = AdapterFactory.getAdaptersForChain(42161, provider);
   * console.log(`Found ${result.adapters.length} adapters for Arbitrum`);
   * if (result.failures.length > 0) {
   *   console.warn('Failed to create some adapters:', result.failures);
   * }
   *
   * @since 1.0.0
   */
  static getAdaptersForChain(chainId, provider) {
    const adapters = [];
    const failures = [];

    // Validate chainId using established pattern
    if (!chainId || typeof chainId !== 'number') {
      throw new Error("chainId must be a valid number");
    }

    // Check if chain is supported
    const chainConfig = getChainConfig(chainId);
    if (!chainConfig) {
      return { adapters, failures };
    }

    // Get all enabled platform IDs for this chain
    const platformIds = lookupChainPlatformIds(chainId);

    // Create an adapter for each supported platform on the chain
    platformIds.forEach(platformId => {
      const AdapterClass = this.#PLATFORM_ADAPTERS[platformId];

      if (AdapterClass) {
        try {
          adapters.push(new AdapterClass(chainId, provider));
        } catch (error) {
          // Track failures so consumer can handle them appropriately
          failures.push({
            platformId,
            error: error.message,
            errorDetails: error
          });
        }
      }
    });

    return { adapters, failures };
  }

  /**
   * Gets an adapter for a specific platform
   *
   * @function getAdapter
   * @memberof module:adapters/AdapterFactory
   * @static
   *
   * @param {string} platformId - Platform ID (e.g., 'uniswapV3')
   * @param {number} chainId - Chain ID
   * @param {Object} provider - Ethers provider instance
   *
   * @returns {Object} Platform adapter instance
   *
   * @throws {Error} If platform ID or chainId are invalid, platform not found, or adapter creation fails
   *
   * @example
   * const adapter = AdapterFactory.getAdapter('uniswapV3', 42161, provider);
   * const poolInfo = await adapter.fetchPoolData(token0, token1, 3000, 42161, provider);
   *
   * @since 1.0.0
   */
  static getAdapter(platformId, chainId, provider) {
    // Validate platformId
    if (!platformId || typeof platformId !== 'string') {
      throw new Error("Platform ID must be a valid string");
    }

    // Validate chainId using established pattern
    if (!chainId || typeof chainId !== 'number') {
      throw new Error("chainId must be a valid number");
    }

    const AdapterClass = this.#PLATFORM_ADAPTERS[platformId];

    if (!AdapterClass) {
      throw new Error(`No adapter available for platform: ${platformId}`);
    }

    try {
      return new AdapterClass(chainId, provider);
    } catch (error) {
      throw new Error(`Failed to create ${platformId} adapter for chain ${chainId}: ${error.message}`);
    }
  }

  /**
   * Returns a list of all supported platform IDs
   * @returns {Array<string>} - Array of platform IDs
   */
  static getSupportedPlatforms() {
    return Object.keys(this.#PLATFORM_ADAPTERS);
  }

  /**
   * Check if an adapter is available for a platform
   * @param {string} platformId - Platform ID
   * @returns {boolean} - Whether the adapter is available
   */
  static hasAdapter(platformId) {
    return platformId in this.#PLATFORM_ADAPTERS;
  }

  /**
   * Register a new adapter class
   *
   * NOTE: This is intended ONLY for testing and plugin scenarios. Registered adapters
   * are not persistent and will be lost when the application restarts. For production
   * adapters, add them directly to the PLATFORM_ADAPTERS object in this file.
   *
   * @param {string} platformId - Platform ID
   * @param {class} AdapterClass - Adapter class
   * @throws {Error} If platform ID or adapter class are invalid
   */
  static registerAdapterForTestingOnly(platformId, AdapterClass) {
    if (!platformId || !AdapterClass) {
      throw new Error("Platform ID and Adapter class are required for registration");
    }

    this.#PLATFORM_ADAPTERS[platformId] = AdapterClass;
  }
}
