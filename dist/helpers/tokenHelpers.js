/**
 * @module helpers/tokenHelpers
 * @description Token management utilities for querying, filtering, and managing token configurations across multiple chains.
 * Provides functions to work with token metadata, addresses, and type classifications.
 * @since 1.0.0
 */

import tokens from '../configs/tokens.js';

/**
 * Get all tokens
 * @memberof module:helpers/tokenHelpers
 * @returns {Object} Token object with token symbols as keys, each containing name, symbol, decimals, addresses, and metadata
 * @example
 * // Get all configured tokens
 * const tokens = getAllTokens();
 * // Returns: { 
 * //   ETH: { symbol: "ETH", name: "Ethereum", decimals: 18, addresses: {...} },
 * //   USDC: { symbol: "USDC", name: "USD Coin", decimals: 6, addresses: {...} },
 * //   ...
 * // }
 * 
 * @example
 * // Iterate through all tokens
 * Object.values(getAllTokens()).forEach(token => {
 *   console.log(`${token.name} (${token.symbol})`);
 * });
 * @since 1.0.0
 */
export function getAllTokens() {
  return tokens;
}

/**
 * Get token by symbol
 * @memberof module:helpers/tokenHelpers
 * @param {string} symbol - Token symbol (case-sensitive)
 * @returns {Object|null} Token object containing all token metadata - null if not found
 * @example
 * // Get USDC token information
 * const usdc = getTokenBySymbol('USDC');
 * // Returns: { 
 * //   symbol: "USDC", 
 * //   name: "USD Coin", 
 * //   decimals: 6,
 * //   isStablecoin: true,
 * //   addresses: { 1: "0xA0b8...", 137: "0x2791..." }
 * // }
 * 
 * @example
 * // Handle unknown token
 * const token = getTokenBySymbol('UNKNOWN');
 * if (!token) {
 *   console.error('Token not found');
 * }
 * @since 1.0.0
 */
export function getTokenBySymbol(symbol) {
  return tokens[symbol] || null;
}

/**
 * Get token address for a specific chain
 * @memberof module:helpers/tokenHelpers
 * @param {string} symbol - Token symbol (case-sensitive)
 * @param {number} chainId - Chain ID where the token address is needed
 * @returns {string|null} Token contract address (0x-prefixed) - null if not available on the chain
 * @example
 * // Get USDC address on Ethereum mainnet
 * const usdcAddress = getTokenAddress('USDC', 1);
 * // Returns: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
 * 
 * @example
 * // Check if token exists on chain before using
 * const tokenAddress = getTokenAddress('DAI', chainId);
 * if (tokenAddress) {
 *   const contract = new ethers.Contract(tokenAddress, ERC20ABI, provider);
 * }
 * @since 1.0.0
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
 * @memberof module:helpers/tokenHelpers
 * @returns {Array<Object>} Array of token objects that are classified as stablecoins
 * @example
 * // Get all stablecoin tokens
 * const stablecoins = getStablecoins();
 * // Returns: [
 * //   { symbol: "USDC", name: "USD Coin", isStablecoin: true, ... },
 * //   { symbol: "USDT", name: "Tether", isStablecoin: true, ... },
 * //   { symbol: "DAI", name: "Dai", isStablecoin: true, ... }
 * // ]
 * 
 * @example
 * // Get stablecoin symbols for a selector
 * const stablecoinOptions = getStablecoins().map(token => ({
 *   value: token.symbol,
 *   label: `${token.name} (${token.symbol})`
 * }));
 * @since 1.0.0
 */
export function getStablecoins() {
  return Object.values(tokens).filter(token => token.isStablecoin);
}

/**
 * Check if tokens are supported on the specified chain
 * @memberof module:helpers/tokenHelpers
 * @param {string[]} symbols - Array of token symbols to check
 * @param {number} chainId - Chain ID to check against
 * @returns {boolean} True if ALL tokens are supported on the chain, false if any are missing
 * @example
 * // Check if token pair is available on Polygon
 * const tokensAvailable = areTokensSupportedOnChain(['USDC', 'ETH'], 137);
 * if (!tokensAvailable) {
 *   console.error('Not all tokens available on this chain');
 * }
 * 
 * @example
 * // Validate token selection for a specific chain
 * const selectedTokens = ['DAI', 'USDC', 'WBTC'];
 * if (areTokensSupportedOnChain(selectedTokens, chainId)) {
 *   proceedWithStrategy(selectedTokens);
 * }
 * @since 1.0.0
 */
export function areTokensSupportedOnChain(symbols, chainId) {
  return symbols.every(symbol => {
    const token = tokens[symbol];
    return token && token.addresses[chainId];
  });
}

/**
 * Get token by address on a specific chain
 * @memberof module:helpers/tokenHelpers
 * @param {string} address - Token contract address (0x-prefixed)
 * @param {number} chainId - Chain ID where the address exists
 * @returns {Object|null} Token object with all metadata - null if not found
 * @throws {TypeError} If address is not a valid Ethereum address format
 * @example
 * // Look up token by its contract address
 * const token = getTokenByAddress('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', 1);
 * // Returns: { symbol: "USDC", name: "USD Coin", ... }
 * 
 * @example
 * // Identify unknown token from transaction
 * const unknownToken = getTokenByAddress(event.args.token, chainId);
 * if (unknownToken) {
 *   console.log(`Received ${unknownToken.symbol}`);
 * } else {
 *   console.log('Unknown token');
 * }
 * @since 1.0.0
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
 * @memberof module:helpers/tokenHelpers
 * @param {Object} token - Token configuration object
 * @param {string} token.symbol - Token symbol (required, will be used as key)
 * @param {string} token.name - Human-readable token name
 * @param {number} token.decimals - Number of decimals for the token
 * @param {Object} token.addresses - Chain ID to address mapping
 * @param {boolean} [token.isStablecoin=false] - Whether the token is a stablecoin
 * @param {string} [token.logoURI] - URL to token logo image
 * @returns {boolean} True if registration successful, false if invalid input
 * @example
 * // Register a new token
 * registerToken({
 *   symbol: 'NEWTOKEN',
 *   name: 'New Token',
 *   decimals: 18,
 *   addresses: {
 *     1: '0x1234...5678',
 *     137: '0x8765...4321'
 *   },
 *   isStablecoin: false,
 *   logoURI: 'https://example.com/logo.png'
 * });
 * 
 * @example
 * // Update existing token with new chain
 * const weth = getTokenBySymbol('WETH');
 * registerToken({
 *   ...weth,
 *   addresses: {
 *     ...weth.addresses,
 *     42161: '0xNewArbitrumAddress'
 *   }
 * });
 * @since 1.0.0
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
 * @memberof module:helpers/tokenHelpers
 * @param {number} chainId - Chain ID to filter tokens by
 * @returns {Array<Object>} Array of token objects that have addresses on the specified chain
 * @example
 * // Get all tokens on Polygon
 * const polygonTokens = getTokensForChain(137);
 * // Returns array of tokens with Polygon addresses
 * 
 * @example
 * // Build token selector for current chain
 * const availableTokens = getTokensForChain(chainId).map(token => ({
 *   value: token.symbol,
 *   label: token.name,
 *   address: token.addresses[chainId],
 *   decimals: token.decimals
 * }));
 * @since 1.0.0
 */
export function getTokensForChain(chainId) {
  if (!chainId) return [];

  return Object.values(tokens).filter(token =>
    token.addresses && token.addresses[chainId]
  );
}

/**
 * Get all token symbols
 * @memberof module:helpers/tokenHelpers
 * @returns {Array<string>} Array of all configured token symbols
 * @example
 * // Get all token symbols
 * const symbols = getAllTokenSymbols();
 * // Returns: ['ETH', 'USDC', 'USDT', 'DAI', 'WBTC', ...]
 * 
 * @example
 * // Check if a symbol exists
 * const supportedSymbols = getAllTokenSymbols();
 * if (supportedSymbols.includes(userInput.toUpperCase())) {
 *   processToken(userInput);
 * }
 * @since 1.0.0
 */
export function getAllTokenSymbols() {
  return Object.keys(tokens);
}

/**
 * Get tokens by type (stablecoin or not)
 * @memberof module:helpers/tokenHelpers
 * @param {boolean} isStablecoin - True to get stablecoins, false to get non-stablecoins
 * @returns {Array<Object>} Array of token objects matching the type criteria
 * @example
 * // Get all non-stablecoin tokens
 * const volatileTokens = getTokensByType(false);
 * // Returns tokens like ETH, WBTC, etc.
 * 
 * @example
 * // Separate tokens by type for different strategies
 * const stables = getTokensByType(true);
 * const volatile = getTokensByType(false);
 * 
 * console.log(`${stables.length} stablecoins available`);
 * console.log(`${volatile.length} volatile tokens available`);
 * @since 1.0.0
 */
export function getTokensByType(isStablecoin) {
  return Object.values(tokens).filter(token =>
    token.isStablecoin === isStablecoin
  );
}
