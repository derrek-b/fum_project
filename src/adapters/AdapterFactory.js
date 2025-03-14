// src/adapters/AdapterFactory.js
import config from "../utils/config";
import UniswapV3Adapter from "./UniswapV3Adapter";

// Map of platform IDs to adapter classes
const PLATFORM_ADAPTERS = {
  uniswapV3: UniswapV3Adapter,
  // Add more adapters here as they are implemented
  // Example: sushiswap: SushiswapAdapter
};

export default class AdapterFactory {
  /**
   * Get all available adapters for a chain
   * @param {number} chainId - Chain ID
   * @param {Object} provider - Ethers provider
   * @returns {Array} - Array of platform adapters
   */
  static getAdaptersForChain(chainId, provider) {
    const adapters = [];

    if (!chainId || !provider || !config.chains[chainId]) {
      return adapters;
    }

    const chainConfig = config.chains[chainId];

    // Create an adapter for each supported platform on the chain
    Object.keys(chainConfig.platforms || {}).forEach(platformId => {
      const AdapterClass = PLATFORM_ADAPTERS[platformId];

      if (AdapterClass) {
        adapters.push(new AdapterClass(config, provider));
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
    const AdapterClass = PLATFORM_ADAPTERS[platformId];

    if (!AdapterClass) {
      console.error(`No adapter available for platform: ${platformId}`);
      return null;
    }

    return new AdapterClass(config, provider);
  }
}
