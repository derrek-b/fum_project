/**
 * @module services/coingecko
 * @description CoinGecko API service for token price data with caching and conversion utilities
 */

// src/services/coingecko.js
import { getCoingeckoId } from '../helpers/tokenHelpers.js';

// Module-level configuration (set via configureCoingecko)
let _config = {
  apiKey: null,
};

/**
 * Configure the CoinGecko service
 * @param {Object} options - Configuration options
 * @param {string} [options.apiKey] - CoinGecko API key for authenticated requests
 * @example
 * import { configureCoingecko } from 'fum_library/services/coingecko';
 * configureCoingecko({ apiKey: process.env.COINGECKO_API_KEY });
 */
export function configureCoingecko({ apiKey } = {}) {
  if (apiKey !== undefined) {
    _config.apiKey = apiKey;
  }
}

// API configuration constants
const API_BASE_URL = 'https://api.coingecko.com/api/v3';

// CoinGecko API endpoints
export const ENDPOINTS = {
  SIMPLE_PRICE: '/simple/price',           // Current token prices
  COIN_DETAILS: '/coins/{id}',            // Detailed coin information
  COIN_HISTORY: '/coins/{id}/history',    // Historical price data
  EXCHANGES: '/exchanges',                // List of exchanges
  EXCHANGE_RATES: '/exchange_rates',      // Fiat exchange rates
  GLOBAL_DATA: '/global'                  // Global crypto market data
};

// Cache durations - how long data stays fresh for different use cases
export const CACHE_DURATIONS = {
  '0-SECONDS': 0,                    // No cache - always fresh (critical transactions)
  '1-SECOND': 1 * 1000,             // 1 second (high-frequency trading)
  '2-SECONDS': 2 * 1000,            // 2 seconds (ultra-fast execution)
  '5-SECONDS': 5 * 1000,            // 5 seconds (active liquidity management)
  '10-SECONDS': 10 * 1000,          // 10 seconds (rapid decision making)
  '15-SECONDS': 15 * 1000,          // 15 seconds (quick updates)
  '30-SECONDS': 30 * 1000,          // 30 seconds (trading decisions)
  '1-MINUTE': 60 * 1000,            // 1 minute (background automation)
  '2-MINUTES': 2 * 60 * 1000,       // 2 minutes (dashboard/portfolio view)
  '5-MINUTES': 5 * 60 * 1000,       // 5 minutes (periodic monitoring)
  '10-MINUTES': 10 * 60 * 1000      // 10 minutes (error fallback only)
};

// In-memory cache for token prices with per-token TTL
export const priceCache = {};


/**
 * Build the CoinGecko API URL with authentication
 * @param {string} endpoint - API endpoint (must be one of ENDPOINTS values)
 * @param {Object} params - Query parameters (key-value pairs)
 * @returns {string} - Full API URL
 * @throws {Error} If endpoint is not in approved ENDPOINTS list
 */
export function buildApiUrl(endpoint, params = {}) {
  if (!endpoint) {
    throw new Error('Endpoint is required');
  }

  // Validate endpoint is in our approved list (including template substitutions)
  const validEndpoints = Object.values(ENDPOINTS);
  const isValidEndpoint = validEndpoints.some(validEndpoint => {
    if (validEndpoint === endpoint) {
      return true; // Exact match
    }

    // Check template endpoints with {id} substitution
    if (validEndpoint.includes('{id}')) {
      const pattern = validEndpoint.replace('{id}', '[^/]+'); // Replace {id} with regex for any non-slash characters
      const regex = new RegExp(`^${pattern}$`);
      return regex.test(endpoint);
    }

    return false;
  });

  if (!isValidEndpoint) {
    throw new Error(`Invalid endpoint: ${endpoint}. Must match one of: ${validEndpoints.join(', ')}`);
  }

  const apiKey = _config.apiKey;
  const url = new URL(`${API_BASE_URL}${endpoint}`);

  // Add API key if available
  if (apiKey) {
    url.searchParams.append('x_cg_demo_api_key', apiKey);
  }

  // Add other query parameters
  Object.entries(params).forEach(([key, value]) => {
    if (value === null || value === undefined) {
      throw new Error(`Parameter '${key}' cannot be null or undefined`);
    }
    if (typeof value === 'object' && value !== null) {
      throw new Error(`Parameter '${key}' cannot be an object. Use string or number.`);
    }
    url.searchParams.append(key, value);
  });

  return url.toString();
}

/**
 * Fetches current token prices from CoinGecko with explicit cache duration
 *
 * @function fetchTokenPrices
 * @memberof module:services/coingecko
 *
 * @param {string[]} tokenSymbols - Array of token symbols (must be strings)
 * @param {number} cacheDurationMs - Cache duration in milliseconds (0 = no cache, always fresh)
 *
 * @returns {Promise<Object>} Token prices keyed by uppercase symbol in USD
 *
 * @throws {Error} If cacheDurationMs not provided or invalid
 * @throws {Error} If tokenSymbols contains non-string values
 *
 * @example
 * // For critical transactions - always fresh
 * const prices = await fetchTokenPrices(['WETH', 'USDC'], CACHE_DURATIONS['0-SECONDS']);
 *
 * @example
 * // For liquidity management - 5 second tolerance
 * const prices = await fetchTokenPrices(['WETH', 'USDC'], CACHE_DURATIONS['5-SECONDS']);
 *
 * @example
 * // For dashboard display - 2 minute tolerance
 * const prices = await fetchTokenPrices(['WETH', 'USDC'], CACHE_DURATIONS['2-MINUTES']);
 *
 * @example
 * // Custom 1.5 second cache
 * const prices = await fetchTokenPrices(['WETH', 'USDC'], 1500);
 *
 * @since 1.0.0
 */
export async function fetchTokenPrices(tokenSymbols, cacheDurationMs) {
  // Validate tokenSymbols parameter
  if (tokenSymbols === null || tokenSymbols === undefined) {
    throw new Error('tokenSymbols parameter is required');
  }

  if (!Array.isArray(tokenSymbols)) {
    throw new Error('tokenSymbols must be an array');
  }

  if (tokenSymbols.length === 0) {
    return {};
  }

  // Validate each symbol in the array
  for (const symbol of tokenSymbols) {
    if (symbol === null || symbol === undefined) {
      throw new Error('Token symbols cannot be null or undefined');
    }
    if (typeof symbol !== 'string') {
      throw new Error(`All token symbols must be strings. Found: ${typeof symbol}`);
    }
    if (symbol === '') {
      throw new Error('All token symbols must be non-empty strings');
    }
  }

  // Validate cacheDurationMs parameter
  if (cacheDurationMs === null || cacheDurationMs === undefined) {
    throw new Error('cacheDurationMs parameter is required');
  }

  if (typeof cacheDurationMs !== 'number' || !Number.isFinite(cacheDurationMs)) {
    throw new Error('cacheDurationMs must be a valid number');
  }

  if (cacheDurationMs < 0) {
    throw new Error(`cacheDurationMs must be >= 0. Got: ${cacheDurationMs}`);
  }

  try {
    const now = Date.now();

    // If cache is valid based on the requested duration, use cached data
    if (cacheDurationMs > 0) {
      // Check if we have all requested tokens in cache and they're fresh
      const allInCache = tokenSymbols.every(symbol => {
        const upperSymbol = symbol.toUpperCase();
        const cachedToken = priceCache[upperSymbol];
        return cachedToken && (now - cachedToken.timestamp) < cacheDurationMs;
      });

      if (allInCache) {
        const result = {};
        tokenSymbols.forEach(symbol => {
          const upperSymbol = symbol.toUpperCase();
          result[upperSymbol] = priceCache[upperSymbol].price;
        });
        return result;
      }
    }

    // Create unique set of symbols
    const uniqueSymbols = [...new Set(tokenSymbols)];

    // Map symbols to CoinGecko IDs
    let tokenIds;
    try {
      tokenIds = uniqueSymbols.map(getCoingeckoId);
    } catch (error) {
      throw new Error(`Unsupported token in request. All tokens must be configured for price fetching.`);
    }
    const tokenIdsCSV = tokenIds.join(',');

    // Build API URL (always USD)
    const apiUrl = buildApiUrl(ENDPOINTS.SIMPLE_PRICE, {
      ids: tokenIdsCSV,
      vs_currencies: 'usd'
    });

    // Fetch data
    const response = await fetch(apiUrl);

    if (!response.ok) {
      throw new Error(`CoinGecko API returned ${response.status}`);
    }

    const data = await response.json();

    // Construct result object and update cache
    const result = {};
    uniqueSymbols.forEach((symbol, index) => {
      const id = tokenIds[index];
      const price = data[id]?.usd;

      if (price === undefined) {
        throw new Error(`No price data returned for token ${symbol}`);
      }
      
      if (typeof price !== 'number' || price < 0 || !Number.isFinite(price)) {
        throw new Error(`Invalid price data for token ${symbol}: ${price}`);
      }

      const upperSymbol = symbol.toUpperCase();
      result[upperSymbol] = price;

      // Update cache with per-token timestamp
      priceCache[upperSymbol] = {
        price: price,
        timestamp: now
      };
    });

    return result;
  } catch (error) {
    console.error("Error fetching token prices:", error);

    // In a financial application, if we can't get fresh data, we must fail fast
    // Returning stale cached data could lead to catastrophic trading decisions
    throw new Error(`Failed to fetch current token prices: ${error.message}. Cannot proceed with stale data.`);
  }
}

/**
 * Clear ALL cached prices
 */
export function clearPriceCache() {
  Object.keys(priceCache).forEach(key => delete priceCache[key]);
}

