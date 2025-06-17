/**
 * @module services/coingecko
 * @description CoinGecko API service for token price data with caching and conversion utilities
 */

// src/services/coingecko.js

// Default configuration (can be overridden)
const DEFAULT_CONFIG = {
  apiBaseUrl: 'https://api.coingecko.com/api/v3',
  apiKey: null,              // No default API key
  useFreeTier: true          // Default to free tier if no API key provided
};

// Cache strategies - explicit timeout values in seconds for clarity
const CACHE_STRATEGIES = {
  '0-SECONDS': 0,                    // No cache - always fresh (critical transactions)
  '5-SECONDS': 5 * 1000,            // 5 seconds (active liquidity management)
  '30-SECONDS': 30 * 1000,          // 30 seconds (trading decisions)
  '2-MINUTES': 2 * 60 * 1000,       // 2 minutes (dashboard/portfolio view)
  '1-MINUTE': 60 * 1000,            // 1 minute (background automation)
  '10-MINUTES': 10 * 60 * 1000      // 10 minutes (error fallback only)
};

// In-memory cache for token prices
const priceCache = {
  data: {},
  timestamp: 0
};

// Service configuration
let serviceConfig = { ...DEFAULT_CONFIG };

/**
 * Map common token symbols to their CoinGecko IDs
 * Extended from common ERC20 tokens
 */
const symbolToIdMap = {
  'WETH': 'ethereum',  // Wrapped ETH uses same price as ETH
  'ETH': 'ethereum',
  'USDC': 'usd-coin',
  'USDT': 'tether',
  'DAI': 'dai',
  'WBTC': 'wrapped-bitcoin',
  'BTC': 'bitcoin',
  'MATIC': 'matic-network',
  'LINK': 'chainlink',
  'UNI': 'uniswap',
  'AAVE': 'aave',
  'COMP': 'compound-governance-token',
  'SNX': 'havven',
  'MKR': 'maker',
  'BAL': 'balancer',
  'SUSHI': 'sushi',
  'ARB': 'arbitrum',
  'GRT': 'the-graph',
  'CRV': 'curve-dao-token',
  'LDO': 'lido-dao',
  'RPL': 'rocket-pool',
  'FXS': 'frax-share',
};

/**
 * Configures the CoinGecko service with custom settings
 * 
 * @function configureCoingecko
 * @memberof module:services/coingecko
 * 
 * @param {Object} [config={}] - Configuration options
 * @param {string} [config.apiBaseUrl='https://api.coingecko.com/api/v3'] - Base URL for CoinGecko API
 * @param {number} [config.cacheExpiryTime=300000] - Cache expiry time in milliseconds
 * @param {string} [config.apiKey] - Direct API key for CoinGecko
 * @param {boolean} [config.useFreeTier=true] - Whether to use free tier if no API key
 * 
 * @example
 * // Configure with API key
 * configureCoingecko({
 *   apiKey: 'your-api-key',
 *   cacheExpiryTime: 10 * 60 * 1000
 * });
 * 
 * @since 1.0.0
 */
export function configureCoingecko(config = {}) {
  serviceConfig = { ...DEFAULT_CONFIG, ...config };
  priceCache.expiryTime = serviceConfig.cacheExpiryTime;
}

/**
 * Get the API key
 * @returns {string|null} - API key or null if not available
 */
function getApiKey() {
  return serviceConfig.apiKey;
}

/**
 * Build the CoinGecko API URL with authentication
 * @param {string} endpoint - API endpoint
 * @param {Object} params - Query parameters (key-value pairs)
 * @returns {string} - Full API URL
 */
function buildApiUrl(endpoint, params = {}) {
  const apiKey = getApiKey();
  const url = new URL(`${serviceConfig.apiBaseUrl}${endpoint}`);

  // Add API key if available
  if (apiKey) {
    url.searchParams.append('x_cg_api_key', apiKey);
  } else if (!serviceConfig.useFreeTier) {
    // If not configured for free tier and no API key, warn once
    if (typeof window !== 'undefined' && !window._coinGeckoApiWarningShown) {
      console.warn('CoinGecko API key not configured and useFreeTier is false. API calls will likely fail.');
      window._coinGeckoApiWarningShown = true;
    }
  }

  // Add other query parameters
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.append(key, value);
  });

  return url.toString();
}

/**
 * Map a token symbol to its CoinGecko ID
 * @param {string} symbol - Token symbol (e.g., "USDC")
 * @returns {string} CoinGecko ID for the token
 * @throws {Error} If token symbol is not mapped - prevents wrong price data
 */
export function getCoingeckoId(symbol) {
  if (!symbol || symbol === '') {
    throw new Error('Token symbol is required and cannot be empty');
  }

  // Check if we have a direct mapping
  const normalizedSymbol = symbol.toUpperCase();
  if (symbolToIdMap[normalizedSymbol]) {
    return symbolToIdMap[normalizedSymbol];
  }

  // Fail fast - don't guess token IDs to prevent wrong price data
  throw new Error(`Unknown token symbol: ${symbol}. Add mapping to symbolToIdMap or verify token symbol is correct.`);
}

/**
 * Register a custom token symbol to CoinGecko ID mapping
 * @param {string} symbol - Token symbol
 * @param {string} coingeckoId - CoinGecko ID
 */
export function registerTokenMapping(symbol, coingeckoId) {
  if (!symbol || !coingeckoId) return;
  symbolToIdMap[symbol.toUpperCase()] = coingeckoId.toLowerCase();
}

/**
 * Fetches current token prices from CoinGecko with explicit cache strategy
 * 
 * @function fetchTokenPrices
 * @memberof module:services/coingecko
 * 
 * @param {string[]} tokenSymbols - Array of token symbols
 * @param {string} cacheStrategy - Required cache strategy: '0-SECONDS', '5-SECONDS', '30-SECONDS', '2-MINUTES', '1-MINUTE', '10-MINUTES'
 * @param {string} [currency='usd'] - Currency to get prices in
 * 
 * @returns {Promise<Object>} Token prices keyed by uppercase symbol
 * 
 * @throws {Error} If cacheStrategy not provided or invalid
 * @throws {Error} If API key not configured and free tier disabled
 * 
 * @example
 * // For critical transactions - always fresh
 * const prices = await fetchTokenPrices(['ETH', 'USDC'], '0-SECONDS');
 * 
 * @example
 * // For liquidity management - 5 second tolerance
 * const prices = await fetchTokenPrices(['ETH', 'USDC'], '5-SECONDS');
 * 
 * @example
 * // For dashboard display - 2 minute tolerance
 * const prices = await fetchTokenPrices(['ETH', 'USDC'], '2-MINUTES');
 * 
 * @since 1.0.0
 */
export async function fetchTokenPrices(tokenSymbols, cacheStrategy, currency = 'usd') {
  if (!tokenSymbols || tokenSymbols.length === 0) {
    return {};
  }

  // Validate required cacheStrategy parameter
  if (!cacheStrategy) {
    throw new Error('cacheStrategy is required. Must be one of: 0-SECONDS, 5-SECONDS, 30-SECONDS, 2-MINUTES, 1-MINUTE, 10-MINUTES');
  }
  
  // Validate it's a known strategy
  if (!CACHE_STRATEGIES[cacheStrategy]) {
    throw new Error(`Invalid cacheStrategy: ${cacheStrategy}. Must be one of: ${Object.keys(CACHE_STRATEGIES).join(', ')}`);
  }
  
  const maxCacheAge = CACHE_STRATEGIES[cacheStrategy];

  // Check if API access is possible
  if (!getApiKey() && !serviceConfig.useFreeTier) {
    throw new Error('CoinGecko API key not configured and free tier access is disabled');
  }

  try {
    const now = Date.now();

    // If cache is valid based on the requested strategy, use cached data
    if (maxCacheAge > 0 && now - priceCache.timestamp < maxCacheAge) {
      // Check if we have all requested tokens in cache
      const allInCache = tokenSymbols.every(symbol =>
        symbol && priceCache.data[symbol.toUpperCase()] !== undefined
      );

      if (allInCache) {
        return { ...priceCache.data };
      }
    }

    // Filter out empty symbols and create a unique set
    const validSymbols = [...new Set(tokenSymbols.filter(s => s && s.trim() !== ''))];
    if (validSymbols.length === 0) return {};

    // Map symbols to CoinGecko IDs
    const tokenIds = validSymbols.map(getCoingeckoId).join(',');

    // Build API URL
    const apiUrl = buildApiUrl('/simple/price', {
      ids: tokenIds,
      vs_currencies: currency
    });

    // Fetch data
    const response = await fetch(apiUrl);

    if (!response.ok) {
      throw new Error(`CoinGecko API returned ${response.status}`);
    }

    const data = await response.json();

    // Construct result object and update cache
    const result = {};
    validSymbols.forEach(symbol => {
      const id = getCoingeckoId(symbol);
      const price = data[id]?.[currency] || null;
      const upperSymbol = symbol.toUpperCase();

      result[upperSymbol] = price;
      // Update cache
      priceCache.data[upperSymbol] = price;
    });

    // Update cache timestamp
    priceCache.timestamp = now;

    return result;
  } catch (error) {
    console.error("Error fetching token prices:", error);
    
    // In a financial application, if we can't get fresh data, we must fail fast
    // Returning stale cached data could lead to catastrophic trading decisions
    throw new Error(`Failed to fetch current token prices: ${error.message}. Cannot proceed with stale data.`);
  }
}

/**
 * Calculate USD value of a token amount
 * @param {string|number} amount - Token amount
 * @param {string} symbol - Token symbol
 * @returns {Promise<number|null>} - USD value or null if price not available
 */
export async function calculateUsdValue(amount, symbol) {
  if (!amount || !symbol) return null;

  // Convert amount to number if it's a string
  const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (isNaN(numAmount)) return null;

  try {
    // Normalize symbol
    const normalizedSymbol = symbol.toUpperCase();

    // Check if we already have the price in cache
    if (priceCache.data[normalizedSymbol] !== undefined &&
        Date.now() - priceCache.timestamp < priceCache.expiryTime) {
      return numAmount * priceCache.data[normalizedSymbol];
    }

    // Fetch price if not in cache
    const prices = await fetchTokenPrices([symbol]);
    const price = prices[normalizedSymbol];

    // Calculate and return USD value
    return price && !isNaN(price) ? numAmount * price : null;
  } catch (error) {
    console.error(`Error calculating USD value for ${symbol}:`, error);
    return null;
  }
}

/**
 * Calculate USD value of a token amount synchronously using cached prices
 * @param {string|number} amount - Token amount
 * @param {string} symbol - Token symbol
 * @returns {number|null} - USD value or null if price not available
 */
export function calculateUsdValueSync(amount, symbol) {
  if (!amount || !symbol) return null;

  // Convert amount to number if it's a string
  const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (isNaN(numAmount)) return null;

  try {
    // Normalize symbol
    const normalizedSymbol = symbol.toUpperCase();

    // Check if we have the price in cache
    if (priceCache.data[normalizedSymbol] !== undefined) {
      return numAmount * priceCache.data[normalizedSymbol];
    }

    // No cached price available
    return null;
  } catch (error) {
    console.error(`Error calculating USD value for ${symbol}:`, error);
    return null;
  }
}

/**
 * Prefetch and cache prices for a list of tokens
 * @param {string[]} symbols - Array of token symbols to prefetch
 * @returns {Promise<void>}
 */
export async function prefetchTokenPrices(symbols) {
  if (!symbols || symbols.length === 0) return;

  try {
    await fetchTokenPrices(symbols);
  } catch (error) {
    console.error("Error prefetching token prices:", error);
  }
}

/**
 * Get current price cache
 * @returns {Object} - The current price cache with cache age in seconds
 */
export function getPriceCache() {
  return {
    ...priceCache.data,
    _cacheAge: Math.round((Date.now() - priceCache.timestamp) / 1000)
  };
}

/**
 * Clear the price cache
 */
export function clearPriceCache() {
  priceCache.data = {};
  priceCache.timestamp = 0;
}

/**
 * Check if the CoinGecko service is properly configured
 * @returns {boolean} - Whether the service is ready to use
 */
export function isConfigured() {
  return !!getApiKey() || serviceConfig.useFreeTier;
}

/**
 * Set the API key directly
 * @param {string} apiKey - The CoinGecko API key
 */
export function setApiKey(apiKey) {
  if (!apiKey) return;
  serviceConfig.apiKey = apiKey;
}
