/**
 * @module adapters/AdapterFactory
 * @description Factory class for creating platform-specific adapter instances
 */

// fum_library/adapters/AdapterFactory.js
import UniswapV3Adapter from "./UniswapV3Adapter.js";
import chains from "../configs/chains.js";

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
   * 
   * @returns {Array} Array of platform adapter instances
   * 
   * @example
   * const adapters = AdapterFactory.getAdaptersForChain(42161);
   * console.log(`Found ${adapters.length} adapters for Arbitrum`);
   * 
   * @since 1.0.0
   */
  static getAdaptersForChain(chainId) {
    const adapters = [];

    if (!chainId || !chains?.[chainId]) {
      return adapters;
    }

    const chainConfig = chains[chainId];

    // Create an adapter for each supported platform on the chain
    Object.keys(chainConfig.platformAddresses || {}).forEach(platformId => {
      const AdapterClass = this.#PLATFORM_ADAPTERS[platformId];

      if (AdapterClass) {
        try {
          adapters.push(new AdapterClass(chainId));
        } catch (error) {
          // Skip adapters that can't be created for this chain
          console.warn(`Failed to create ${platformId} adapter for chain ${chainId}:`, error.message);
        }
      }
    });

    return adapters;
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
   * 
   * @returns {Object|null} Platform adapter instance or null if not found
   * 
   * @throws {Error} If platform ID or chainId not provided
   * 
   * @example
   * const adapter = AdapterFactory.getAdapter('uniswapV3', 42161);
   * if (adapter) {
   *   const poolInfo = await adapter.fetchPoolData(token0, token1, 3000, 42161, provider);
   * }
   * 
   * @since 1.0.0
   */
  static getAdapter(platformId, chainId) {
    if (!platformId || !chainId) {
      throw new Error("Platform ID and chainId are required");
    }

    const AdapterClass = this.#PLATFORM_ADAPTERS[platformId];

    if (!AdapterClass) {
      console.error(`No adapter available for platform: ${platformId}`);
      return null;
    }

    return new AdapterClass(chainId);
  }

  /**
   * Register a new adapter class
   * @param {string} platformId - Platform ID
   * @param {class} AdapterClass - Adapter class
   */
  static registerAdapter(platformId, AdapterClass) {
    if (!platformId || !AdapterClass) {
      throw new Error("Platform ID and Adapter class are required for registration");
    }

    this.#PLATFORM_ADAPTERS[platformId] = AdapterClass;
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
}
