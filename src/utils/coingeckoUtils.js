// src/utils/coingeckoUtils.js

const apiKey = process.env.NEXT_PUBLIC_COINGECKO_API_KEY;
const urlBase = `https://api.coingecko.com/api/v3/simple/price?x_cg_api_key=${apiKey}`;

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
  if (!symbol) return '';

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
 * @returns {Promise<Object>} - Token prices object
 */
export const fetchTokenPrices = async (tokenSymbols, currency = 'usd') => {
  try {
    // Map symbols to CoinGecko IDs
    const tokenIds = tokenSymbols.map(getCoingeckoId).join(',');

    // Build API URL
    const apiUrl = urlBase + `&ids=${tokenIds}&vs_currencies=${currency}`;

    // Fetch data
    const response = await fetch(apiUrl);
    if (!response.ok) {
      throw new Error(`CoinGecko API returned ${response.status}`);
    }

    const data = await response.json();

    // Construct result object
    const result = {};
    tokenSymbols.forEach(symbol => {
      const id = getCoingeckoId(symbol);
      result[symbol] = data[id]?.[currency] || null;
    });

    return result;
  } catch (error) {
    console.error("Error fetching token prices:", error);
    return {};
  }
};

/**
 * Calculate USD value of a token amount
 * @param {string|number} amount - Token amount
 * @param {number} price - Token price in USD
 * @returns {number|null} - USD value or null if price not available
 */
export const calculateUsdValue = (amount, price) => {
  if (!amount || !price) return null;

  // Convert amount to number if it's a string
  const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount;

  // Safely return result or null if invalid values
  return !isNaN(numAmount) && price > 0 ? numAmount * price : null;
};
