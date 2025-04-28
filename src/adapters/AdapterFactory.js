// fum_library/adapters/AdapterFactory.js
import UniswapV3Adapter from "./UniswapV3Adapter.js";
import chains from "../configs/chains.js";

/**
 * Factory class for creating and managing platform adapters
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
   * Get all available adapters for a chain
   * @param {number} chainId - Chain ID
   * @param {Object} provider - Ethers provider
   * @returns {Array} - Array of platform adapters
   */
  static getAdaptersForChain(chainId, provider) {
    const adapters = [];

    if (!chainId || !provider || !chains?.[chainId]) {
      return adapters;
    }

    const chainConfig = chains[chainId];

    // Create an adapter for each supported platform on the chain
    Object.keys(chainConfig.platformAddresses || {}).forEach(platformId => {
      const AdapterClass = this.#PLATFORM_ADAPTERS[platformId];

      if (AdapterClass) {
        adapters.push(new AdapterClass(chains, provider));
      }
    });

    return adapters;
  }

  /**
   * Get an adapter for a specific platform
   * @param {string} platformId - Platform ID
   * @param {Object} provider - Ethers provider
   * @returns {Object|null} - Platform adapter or null if not found
   */
  static getAdapter(platformId, provider) {
    if (!platformId || !provider) {
      throw new Error("Platform ID and provider are required");
    }

    const AdapterClass = this.#PLATFORM_ADAPTERS[platformId];

    if (!AdapterClass) {
      console.error(`No adapter available for platform: ${platformId}`);
      return null;
    }

    return new AdapterClass(chains, provider);
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
