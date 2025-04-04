// src/utils/coingeckoUtils.js

const apiKey = process.env.NEXT_PUBLIC_COINGECKO_API_KEY;
const urlBase = `https://api.coingecko.com/api/v3/simple/price?x_cg_api_key=${apiKey}`;

// In-memory cache for token prices to reduce API calls
const priceCache = {
  data: {},
  timestamp: 0,
  expiryTime: 5 * 60 * 1000 // 5 minutes cache expiry
};

/**
 * Utility functions for interacting with the CoinGecko API
 */

// Map common token symbols to their CoinGecko IDs
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
  // Add more mappings as needed
};

/**
 * Map a token symbol to its CoinGecko ID
 * @param {string} symbol - Token symbol (e.g., "USDC")
 * @returns {string} CoinGecko ID or lowercase symbol as fallback
 */
export const getCoingeckoId = (symbol) => {
  if (!symbol || symbol === '') return '';

  // Check if we have a direct mapping
  const normalizedSymbol = symbol.toUpperCase();
  if (symbolToIdMap[normalizedSymbol]) {
    return symbolToIdMap[normalizedSymbol];
  }

  // Fallback to lowercase symbol
  return symbol.toLowerCase();
};

/**
 * Fetch token prices from CoinGecko
 * @param {string[]} tokenSymbols - Array of token symbols
 * @param {string} currency - Currency to get prices in (default: "usd")
 * @param {boolean} bypassCache - Whether to bypass the cache (default: false)
 * @returns {Promise<Object>} - Token prices object
 */
export const fetchTokenPrices = async (tokenSymbols, currency = 'usd', bypassCache = false) => {
  if (!tokenSymbols || tokenSymbols.length === 0) {
    return {};
  }

  try {
    const now = Date.now();

    // If cache is valid and we're not bypassing it, use cached data
    if (!bypassCache && now - priceCache.timestamp < priceCache.expiryTime) {
      // Check if we have all requested tokens in cache
      const allInCache = tokenSymbols.every(symbol =>
        symbol && priceCache.data[symbol.toUpperCase()] !== undefined
      );

      if (allInCache) {
        console.log("Using cached token prices");
        return priceCache.data;
      }
    }

    // Filter out empty symbols and create a unique set
    const validSymbols = [...new Set(tokenSymbols.filter(s => s && s.trim() !== ''))];
    if (validSymbols.length === 0) return {};

    // Map symbols to CoinGecko IDs
    const tokenIds = validSymbols.map(getCoingeckoId).join(',');

    // Build API URL
    const apiUrl = urlBase + `&ids=${tokenIds}&vs_currencies=${currency}`;

    // Fetch data
    console.log(`Fetching prices for: ${validSymbols.join(', ')}`);
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

    // On error, return what we have in cache if it exists
    if (Object.keys(priceCache.data).length > 0) {
      console.log("Using cached prices due to API error");
      return priceCache.data;
    }

    return {};
  }
};

/**
 * Calculate USD value of a token amount
 * @param {string|number} amount - Token amount
 * @param {string} symbol - Token symbol
 * @returns {Promise<number|null>} - USD value or null if price not available
 */
export const calculateUsdValue = async (amount, symbol) => {
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
};

/**
 * Calculate USD value of a token amount synchronously using cached prices
 * @param {string|number} amount - Token amount
 * @param {string} symbol - Token symbol
 * @returns {number|null} - USD value or null if price not available
 */
export const calculateUsdValueSync = (amount, symbol) => {
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
};

/**
 * Prefetch and cache prices for a list of tokens
 * @param {string[]} symbols - Array of token symbols to prefetch
 * @returns {Promise<void>}
 */
export const prefetchTokenPrices = async (symbols) => {
  if (!symbols || symbols.length === 0) return;

  try {
    await fetchTokenPrices(symbols);
    console.log(`Prefetched prices for ${symbols.length} tokens`);
  } catch (error) {
    console.error("Error prefetching token prices:", error);
  }
};

/**
 * Get current price cache
 * @returns {Object} - The current price cache
 */
export const getPriceCache = () => {
  return {
    ...priceCache.data,
    _cacheAge: Math.round((Date.now() - priceCache.timestamp) / 1000)
  };
};
