/**
 * @module init
 * @description Unified initialization for fum_library configuration
 */

import { configureCoingecko } from './services/coingecko.js';
import { configureChainHelpers } from './helpers/chainHelpers.js';

/**
 * Initialize fum_library with configuration
 *
 * Call this function at application startup before using any library functions
 * that require API keys (e.g., fetchTokenPrices, getChainRpcUrls for Arbitrum).
 *
 * @param {Object} config - Configuration options
 * @param {string} [config.coingeckoApiKey] - CoinGecko API key for price data
 * @param {string} [config.alchemyApiKey] - Alchemy API key for Arbitrum RPC URLs
 *
 * @example
 * // In a Next.js app (_app.js)
 * import { initFumLibrary } from 'fum_library';
 *
 * initFumLibrary({
 *   coingeckoApiKey: process.env.NEXT_PUBLIC_COINGECKO_API_KEY,
 *   alchemyApiKey: process.env.NEXT_PUBLIC_ALCHEMY_API_KEY,
 * });
 *
 * @example
 * // In a Node.js automation service
 * import { initFumLibrary } from 'fum_library';
 *
 * initFumLibrary({
 *   coingeckoApiKey: process.env.COINGECKO_API_KEY,
 * });
 */
export function initFumLibrary({ coingeckoApiKey, alchemyApiKey } = {}) {
  if (coingeckoApiKey) {
    configureCoingecko({ apiKey: coingeckoApiKey });
  }
  if (alchemyApiKey) {
    configureChainHelpers({ alchemyApiKey });
  }
}
