/**
 * @module init
 * @description Unified initialization for fum_library configuration
 */

import { configureCoingecko } from './services/coingecko.js';
import { configureBlockExplorer } from './services/blockExplorer.js';
import { configureChainHelpers } from './helpers/chainHelpers.js';
import { configureTheGraph } from './services/theGraph.js';

/**
 * Initialize fum_library with configuration
 *
 * Call this function at application startup before using any library functions
 * that require API keys (e.g., fetchTokenPrices, getChainRpcUrls for Arbitrum).
 *
 * @param {Object} config - Configuration options
 * @param {string} [config.coingeckoApiKey] - CoinGecko API key for price data
 * @param {string} [config.alchemyApiKey] - Alchemy API key for RPC URLs
 * @param {string} [config.blockExplorerApiKey] - Block explorer API key for internal transaction data
 * @param {string} [config.theGraphApiKey] - The Graph API key for subgraph queries
 *
 * @example
 * // In a Next.js app (_app.js)
 * import { initFumLibrary } from 'fum_library';
 *
 * initFumLibrary({
 *   coingeckoApiKey: process.env.NEXT_PUBLIC_COINGECKO_API_KEY,
 *   alchemyApiKey: process.env.NEXT_PUBLIC_ALCHEMY_API_KEY,
 *   blockExplorerApiKey: process.env.NEXT_PUBLIC_BLOCK_EXPLORER_API_KEY,
 *   theGraphApiKey: process.env.NEXT_PUBLIC_THE_GRAPH_API_KEY,
 * });
 *
 * @example
 * // In a Node.js automation service
 * import { initFumLibrary } from 'fum_library';
 *
 * initFumLibrary({
 *   coingeckoApiKey: process.env.COINGECKO_API_KEY,
 *   blockExplorerApiKey: process.env.BLOCK_EXPLORER_API_KEY,
 *   theGraphApiKey: process.env.THE_GRAPH_API_KEY,
 * });
 */
export function initFumLibrary({ coingeckoApiKey, alchemyApiKey, blockExplorerApiKey, theGraphApiKey } = {}) {
  if (coingeckoApiKey) {
    configureCoingecko({ apiKey: coingeckoApiKey });
  }
  if (alchemyApiKey) {
    configureChainHelpers({ alchemyApiKey });
  }
  if (blockExplorerApiKey) {
    configureBlockExplorer({ blockExplorerApiKey });
  }
  if (theGraphApiKey) {
    configureTheGraph({ apiKey: theGraphApiKey });
  }
}
