/**
 * @module helpers/tokenHelpers
 * @description Token management utilities for querying, filtering, and managing token configurations across multiple chains.
 * Provides functions to work with token metadata, addresses, and type classifications with comprehensive input validation.
 * 
 * All functions now include fail-fast validation and throw descriptive errors for invalid inputs.
 * The `registerToken` function has been removed to maintain config immutability.
 * 
 * @since 1.0.0
 */

import tokens from '../configs/tokens.js';

/**
 * Validate token symbol parameter using established validation pattern
 * @param {any} symbol - The value to validate as a token symbol
 * @throws {Error} If symbol is not a valid string
 */
function validateTokenSymbol(symbol) {
  if (symbol === null || symbol === undefined) {
    throw new Error('Token symbol parameter is required');
  }

  if (typeof symbol !== 'string') {
    throw new Error('Token symbol must be a string');
  }

  if (symbol === '') {
    throw new Error('Token symbol cannot be empty');
  }
}

/**
 * Validate chain ID parameter using established validation pattern
 * @param {any} chainId - The value to validate as a chain ID
 * @throws {Error} If chainId is not a valid positive integer
 */
function validateChainId(chainId) {
  if (chainId === null || chainId === undefined) {
    throw new Error('Chain ID parameter is required');
  }

  const numChainId = Number(chainId);
  if (!Number.isInteger(numChainId) || numChainId <= 0) {
    throw new Error('Chain ID must be a positive integer');
  }
}

/**
 * Validate Ethereum address format
 * @param {any} address - The value to validate as an Ethereum address
 * @throws {Error} If address is not a valid Ethereum address format
 */
function validateEthereumAddress(address) {
  if (address === null || address === undefined) {
    throw new Error('Address parameter is required');
  }

  if (typeof address !== 'string') {
    throw new Error('Address must be a string');
  }

  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    throw new Error('Address must be a valid Ethereum address (0x followed by 40 hex characters)');
  }
}

/**
 * Validate token symbols array parameter
 * @param {any} symbols - The value to validate as an array of token symbols
 * @throws {Error} If symbols is not a valid array of strings
 */
function validateTokenSymbols(symbols) {
  if (symbols === null || symbols === undefined) {
    throw new Error('Token symbols parameter is required');
  }

  if (!Array.isArray(symbols)) {
    throw new Error('Token symbols must be an array');
  }

  if (symbols.length === 0) {
    throw new Error('Token symbols array cannot be empty');
  }

  symbols.forEach((symbol, index) => {
    try {
      validateTokenSymbol(symbol);
    } catch (error) {
      throw new Error(`Token symbols[${index}]: ${error.message}`);
    }
  });
}

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
 * @throws {Error} If symbol parameter is invalid
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
  validateTokenSymbol(symbol);
  return tokens[symbol] || null;
}

/**
 * Get token address for a specific chain
 * @memberof module:helpers/tokenHelpers
 * @param {string} symbol - Token symbol (case-sensitive)
 * @param {number} chainId - Chain ID where the token address is needed
 * @returns {string|null} Token contract address (0x-prefixed) - null if not available on the chain
 * @throws {Error} If parameters are invalid
 * @example
 * // Get USDC address on Ethereum mainnet
 * const usdcAddress = getTokenAddress('USDC', 1);
 * // Returns: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
 * 
 * @example
 * // Check if token exists on chain before using
 * const tokenAddress = getTokenAddress('USDC', chainId);
 * if (tokenAddress) {
 *   const contract = new ethers.Contract(tokenAddress, ERC20ABI, provider);
 * }
 * @since 1.0.0
 */
export function getTokenAddress(symbol, chainId) {
  validateTokenSymbol(symbol);
  validateChainId(chainId);
  
  const token = tokens[symbol];
  if (!token || !token.addresses[chainId]) {
    return null;
  }
  return token.addresses[chainId];
}

/**
 * Get all stablecoin tokens
 * @memberof module:helpers/tokenHelpers
 * @returns {Object} Object of stablecoin tokens keyed by symbol (same format as getAllTokens)
 * @example
 * // Get all stablecoin tokens
 * const stablecoins = getStablecoins();
 * // Returns: { 
 * //   USDC: { symbol: "USDC", name: "USD Coin", isStablecoin: true, ... },
 * //   USDT: { symbol: "USDT", name: "Tether", isStablecoin: true, ... },
 * //   DAI: { symbol: "DAI", name: "Dai", isStablecoin: true, ... }
 * // }
 * 
 * @example
 * // Use in strategy configuration
 * supportedTokens: getStablecoins()
 * 
 * @example
 * // Get stablecoin symbols for a selector
 * const stablecoinOptions = Object.values(getStablecoins()).map(token => ({
 *   value: token.symbol,
 *   label: `${token.name} (${token.symbol})`
 * }));
 * @since 1.0.0
 */
export function getStablecoins() {
  return Object.fromEntries(
    Object.entries(tokens).filter(([_, token]) => token.isStablecoin)
  );
}

/**
 * Check if tokens are supported on the specified chain
 * @memberof module:helpers/tokenHelpers
 * @param {string[]} symbols - Array of token symbols to check
 * @param {number} chainId - Chain ID to check against
 * @returns {boolean} True if ALL tokens are supported on the chain, false if any are missing
 * @throws {Error} If parameters are invalid
 * @example
 * // Check if token pair is available on Arbitrum
 * const tokensAvailable = areTokensSupportedOnChain(['USDC', 'WETH'], 42161);
 * if (!tokensAvailable) {
 *   console.error('Not all tokens available on this chain');
 * }
 * 
 * @example
 * // Validate token selection for a specific chain
 * const selectedTokens = ['USDC', 'WETH', 'WBTC'];
 * if (areTokensSupportedOnChain(selectedTokens, chainId)) {
 *   proceedWithStrategy(selectedTokens);
 * }
 * @since 1.0.0
 */
export function areTokensSupportedOnChain(symbols, chainId) {
  validateTokenSymbols(symbols);
  validateChainId(chainId);
  
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
 * @throws {Error} If parameters are invalid
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
  validateEthereumAddress(address);
  validateChainId(chainId);

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
 * Get all tokens available on a specific chain
 * @memberof module:helpers/tokenHelpers
 * @param {number} chainId - Chain ID to filter tokens by
 * @returns {Array<Object>} Array of token objects that have addresses on the specified chain
 * @throws {Error} If chainId is invalid
 * @example
 * // Get all tokens on Arbitrum
 * const arbitrumTokens = getTokensForChain(42161);
 * // Returns array of tokens with Arbitrum addresses
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
  validateChainId(chainId);

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
 * @throws {Error} If isStablecoin parameter is invalid
 * @example
 * // Get all non-stablecoin tokens
 * const volatileTokens = getTokensByType(false);
 * // Returns tokens like WETH, WBTC, etc.
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
  if (typeof isStablecoin !== 'boolean') {
    throw new Error('isStablecoin parameter must be a boolean');
  }
  
  return Object.values(tokens).filter(token =>
    token.isStablecoin === isStablecoin
  );
}

/**
 * Get CoinGecko ID for a token symbol
 * @memberof module:helpers/tokenHelpers
 * @param {string} symbol - Token symbol (case-sensitive)
 * @returns {string} CoinGecko ID for the token
 * @throws {Error} If token symbol is not found or doesn't have a CoinGecko ID
 * @example
 * // Get CoinGecko ID for USDC
 * const geckoId = getCoingeckoId('USDC');
 * // Returns: "usd-coin"
 * 
 * @example
 * // Use in price fetching
 * try {
 *   const geckoId = getCoingeckoId('WETH');
 *   const price = await fetchPriceFromCoingecko(geckoId);
 * } catch (error) {
 *   console.error('Token not supported for price fetching');
 * }
 * @since 1.0.0
 */
export function getCoingeckoId(symbol) {
  validateTokenSymbol(symbol);

  const token = tokens[symbol];
  if (!token) {
    throw new Error(`Unknown token symbol: ${symbol}. Token not found in configuration.`);
  }

  if (!token.coingeckoId) {
    throw new Error(`Token ${symbol} does not have a CoinGecko ID configured.`);
  }

  return token.coingeckoId;
}

/**
 * Get token addresses for multiple symbols on a specific chain (batch operation)
 * @memberof module:helpers/tokenHelpers
 * @param {string[]} symbols - Array of token symbols
 * @param {number} chainId - Chain ID where addresses are needed
 * @returns {Object} Object mapping symbol to address (only includes tokens available on chain)
 * @throws {Error} If parameters are invalid
 * @example
 * // Get multiple token addresses at once
 * const addresses = getTokenAddresses(['USDC', 'WETH'], 42161);
 * // Returns: { USDC: "0xaf88...", WETH: "0x82af..." }
 * @since 1.0.0
 */
export function getTokenAddresses(symbols, chainId) {
  validateTokenSymbols(symbols);
  validateChainId(chainId);
  
  const addresses = {};
  symbols.forEach(symbol => {
    const address = getTokenAddress(symbol, chainId);
    if (address) {
      addresses[symbol] = address;
    }
  });
  
  return addresses;
}

/**
 * Validate that multiple token symbols exist in configuration (batch validation)
 * @memberof module:helpers/tokenHelpers
 * @param {string[]} symbols - Array of token symbols to validate
 * @returns {boolean} True if all tokens exist, false otherwise
 * @throws {Error} If symbols parameter is invalid
 * @example
 * // Check if all selected tokens are valid
 * const isValid = validateTokensExist(['USDC', 'WETH', 'WBTC']);
 * if (!isValid) {
 *   console.error('Some tokens not found');
 * }
 * @since 1.0.0
 */
export function validateTokensExist(symbols) {
  validateTokenSymbols(symbols);
  
  return symbols.every(symbol => tokens[symbol] !== undefined);
}

/**
 * Get metadata for multiple tokens (batch operation)
 * @memberof module:helpers/tokenHelpers
 * @param {string[]} symbols - Array of token symbols
 * @returns {Object} Object mapping symbol to token metadata (only includes existing tokens)
 * @throws {Error} If symbols parameter is invalid
 * @example
 * // Get metadata for multiple tokens
 * const metadata = getTokensMetadata(['USDC', 'WETH']);
 * // Returns: { 
 * //   USDC: { name: "USD Coin", decimals: 6, ... },
 * //   WETH: { name: "Wrapped Ether", decimals: 18, ... }
 * // }
 * @since 1.0.0
 */
export function getTokensMetadata(symbols) {
  validateTokenSymbols(symbols);
  
  const metadata = {};
  symbols.forEach(symbol => {
    const token = tokens[symbol];
    if (token) {
      metadata[symbol] = token;
    }
  });
  
  return metadata;
}
