// src/helpers/tokenHelpers.js
import tokens from '../configs/tokens.js';

/**
 * Get all tokens
 * @returns {Object} Token object with token symbols as keys
 */
export function getAllTokens() {
  return tokens;
}

/**
 * Get token by symbol
 * @param {string} symbol Token symbol
 * @returns {Object|null} Token object or null if not found
 */
export function getTokenBySymbol(symbol) {
  return tokens[symbol] || null;
}

/**
 * Get token address for a specific chain
 * @param {string} symbol Token symbol
 * @param {number} chainId Chain ID
 * @returns {string|null} Token address or null if not available
 */
export function getTokenAddress(symbol, chainId) {
  const token = tokens[symbol];
  if (!token || !token.addresses[chainId]) {
    return null;
  }
  return token.addresses[chainId];
}

/**
 * Get all stablecoins
 * @returns {Object} Stablecoin tokens
 */
export function getStablecoins() {
  return Object.values(tokens).filter(token => token.isStablecoin);
}

/**
 * Check if tokens are supported on the specified chain
 * @param {string[]} symbols Array of token symbols
 * @param {number} chainId Chain ID
 * @returns {boolean} True if all tokens are supported on the chain
 */
export function areTokensSupportedOnChain(symbols, chainId) {
  return symbols.every(symbol => {
    const token = tokens[symbol];
    return token && token.addresses[chainId];
  });
}

/**
 * Get token by address on a specific chain
 * @param {string} address Token address
 * @param {number} chainId Chain ID
 * @returns {Object|null} Token object or null if not found
 */
export function getTokenByAddress(address, chainId) {
  if (!address || !chainId) return null;

  // Normalize the address for comparison
  const normalizedAddress = address.toLowerCase();

  for (const token of Object.values(tokens)) {
    if (token.addresses[chainId] &&
        token.addresses[chainId].toLowerCase() === normalizedAddress) {
      return token;
    }
  }

  return null;
}

/**
 * Register a new token or update an existing one
 * @param {Object} token - Token object
 * @param {string} token.symbol - Token symbol (required)
 * @param {string} token.name - Token name
 * @param {Object} token.addresses - Chain-specific addresses
 * @returns {boolean} True if successful
 */
export function registerToken(token) {
  if (!token || !token.symbol) return false;

  tokens[token.symbol] = {
    ...token
  };

  return true;
}

/**
 * Get all tokens available on a specific chain
 * @param {number} chainId Chain ID
 * @returns {Array} Array of tokens available on the chain
 */
export function getTokensForChain(chainId) {
  if (!chainId) return [];

  return Object.values(tokens).filter(token =>
    token.addresses && token.addresses[chainId]
  );
}

/**
 * Get all token symbols
 * @returns {Array} Array of token symbols
 */
export function getAllTokenSymbols() {
  return Object.keys(tokens);
}

/**
 * Get tokens by type (stablecoin or not)
 * @param {boolean} isStablecoin Whether to get stablecoins or non-stablecoins
 * @returns {Array} Array of token objects
 */
export function getTokensByType(isStablecoin) {
  return Object.values(tokens).filter(token =>
    token.isStablecoin === isStablecoin
  );
}
