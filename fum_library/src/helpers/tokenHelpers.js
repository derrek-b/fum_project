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
 * Check if a token symbol is a wrapped native token (WETH, WAVAX, etc.)
 * @memberof module:helpers/tokenHelpers
 * @param {string} symbol - Token symbol (case-sensitive)
 * @returns {boolean} True if the symbol is a wrapped native token
 * @example
 * // Check if WETH is a wrapped native token
 * const isWrapped = isWrappedNativeToken('WETH');
 * // Returns: true
 *
 * @example
 * // Check if WAVAX is a wrapped native token
 * const isWrapped = isWrappedNativeToken('WAVAX');
 * // Returns: true
 *
 * @example
 * // Check if USDC is a wrapped native token
 * const isWrapped = isWrappedNativeToken('USDC');
 * // Returns: false
 * @since 1.1.0
 */
export function isWrappedNativeToken(symbol) {
  validateTokenSymbol(symbol);

  for (const token of Object.values(tokens)) {
    if (token.isNative && token.wrappedSymbol === symbol) {
      return true;
    }
  }

  return false;
}

/**
 * Get wrapped native token address for a specific chain (WETH on Arbitrum, WAVAX on Avalanche, etc.)
 * @memberof module:helpers/tokenHelpers
 * @param {number} chainId - Chain ID where the wrapped native address is needed
 * @returns {string} Wrapped native token contract address (0x-prefixed)
 * @throws {Error} If chainId is invalid or no wrapped native token configured for chain
 * @example
 * // Get WETH address on Arbitrum
 * const wrappedAddress = getWrappedNativeAddress(42161);
 * // Returns: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1"
 *
 * @example
 * // Get WAVAX address on Avalanche
 * const wrappedAddress = getWrappedNativeAddress(43114);
 * // Returns: "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7"
 * @since 1.1.0
 */
export function getWrappedNativeAddress(chainId) {
  validateChainId(chainId);

  // Find native token configured for this chain
  for (const token of Object.values(tokens)) {
    if (token.isNative && token.wrappedAddresses?.[chainId]) {
      return token.wrappedAddresses[chainId];
    }
  }

  throw new Error(`No wrapped native token configured for chain ${chainId}`);
}

/**
 * Get wrapped native token symbol for a specific chain (WETH, WAVAX, etc.)
 * @memberof module:helpers/tokenHelpers
 * @param {number} chainId - Chain ID to get wrapped symbol for
 * @returns {string} Wrapped native token symbol (e.g., 'WETH', 'WAVAX')
 * @throws {Error} If chainId is invalid or no wrapped native token configured for chain
 * @example
 * // Get wrapped symbol on Arbitrum
 * const symbol = getWrappedNativeSymbol(42161);
 * // Returns: "WETH"
 *
 * @example
 * // Get wrapped symbol on Avalanche
 * const symbol = getWrappedNativeSymbol(43114);
 * // Returns: "WAVAX"
 * @since 1.1.0
 */
export function getWrappedNativeSymbol(chainId) {
  validateChainId(chainId);

  for (const token of Object.values(tokens)) {
    if (token.isNative && token.wrappedAddresses?.[chainId]) {
      return token.wrappedSymbol;
    }
  }

  throw new Error(`No wrapped native token configured for chain ${chainId}`);
}

/**
 * Get native token symbol for a specific chain (ETH, AVAX, etc.)
 * @memberof module:helpers/tokenHelpers
 * @param {number} chainId - Chain ID to get native symbol for
 * @returns {string} Native token symbol (e.g., 'ETH', 'AVAX')
 * @throws {Error} If chainId is invalid or no native token configured for chain
 * @example
 * // Get native symbol on Arbitrum
 * const symbol = getNativeSymbol(42161);
 * // Returns: "ETH"
 *
 * @example
 * // Get native symbol on Avalanche
 * const symbol = getNativeSymbol(43114);
 * // Returns: "AVAX"
 * @since 1.1.0
 */
export function getNativeSymbol(chainId) {
  validateChainId(chainId);

  for (const token of Object.values(tokens)) {
    if (token.isNative && token.wrappedAddresses?.[chainId]) {
      return token.symbol;
    }
  }

  throw new Error(`No native token configured for chain ${chainId}`);
}

/**
 * Get native token configuration for a specific chain
 * @memberof module:helpers/tokenHelpers
 * @param {number} chainId - Chain ID to get native token for
 * @returns {Object} Native token configuration object
 * @throws {Error} If chainId is invalid or no native token configured for chain
 * @example
 * // Get native token on Arbitrum
 * const nativeToken = getNativeTokenForChain(42161);
 * // Returns: { symbol: "ETH", wrappedSymbol: "WETH", ... }
 *
 * @example
 * // Get native token on Avalanche
 * const nativeToken = getNativeTokenForChain(43114);
 * // Returns: { symbol: "AVAX", wrappedSymbol: "WAVAX", ... }
 * @since 1.1.0
 */
export function getNativeTokenForChain(chainId) {
  validateChainId(chainId);

  for (const token of Object.values(tokens)) {
    if (token.isNative && token.wrappedAddresses?.[chainId]) {
      return token;
    }
  }

  throw new Error(`No native token configured for chain ${chainId}`);
}

/**
 * Get all token symbols
 * @memberof module:helpers/tokenHelpers
 * @returns {Array<string>} Array of all configured token symbols
 * @example
 * // Get all token symbols
 * const symbols = getAllTokenSymbols();
 * // Returns: ['ETH', 'USDC', 'USDT', 'DAI', 'WBTC', 'WETH', 'WAVAX', ...]
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
  // Include wrapped native token symbols in addition to the base token symbols
  // Wrapped native tokens are derived from native token's wrappedAddresses but are needed for position tracking
  // (DEX positions use wrapped tokens like WETH/WAVAX, not native ETH/AVAX)
  const baseSymbols = Object.keys(tokens);
  const wrappedSymbols = Object.values(tokens)
    .filter(token => token.isNative && token.wrappedSymbol)
    .map(token => token.wrappedSymbol);

  return [...baseSymbols, ...wrappedSymbols];
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
  // Dynamically create wrapped token entries for all native tokens
  // This makes getAllTokens() consistent with getAllTokenSymbols() which includes all wrapped symbols
  const wrappedTokenEntries = {};

  for (const token of Object.values(tokens)) {
    if (token.isNative && token.wrappedSymbol && token.wrappedAddresses) {
      wrappedTokenEntries[token.wrappedSymbol] = {
        ...token,
        symbol: token.wrappedSymbol,
        name: `Wrapped ${token.name}`,
        isNative: false,
        addresses: token.wrappedAddresses
      };
    }
  }

  return {
    ...tokens,
    ...wrappedTokenEntries
  };
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
 * Get all tokens available on a specific chain
 * @memberof module:helpers/tokenHelpers
 * @param {number} chainId - Chain ID to filter tokens by
 * @returns {Array<Object>} Array of token objects that have addresses on the specified chain
 * @throws {Error} If chainId is invalid or token is missing addresses property
 * @example
 * // Get all tokens on Arbitrum
 * const arbitrumTokens = getTokensByChain(42161);
 * // Returns array of tokens with Arbitrum addresses
 *
 * @example
 * // Build token selector for current chain
 * const availableTokens = getTokensByChain(chainId).map(token => ({
 *   value: token.symbol,
 *   label: token.name,
 *   address: token.addresses[chainId],
 *   decimals: token.decimals
 * }));
 * @since 1.0.0
 */
export function getTokensByChain(chainId) {
  validateChainId(chainId);

  return Object.values(tokens).filter(token => {
    if (!token.addresses) {
      throw new Error(`Token ${token.symbol || 'unknown'} is missing addresses property`);
    }

    // For native tokens, check wrappedAddresses instead
    if (token.isNative) {
      return token.wrappedAddresses && token.wrappedAddresses[chainId];
    }

    return token.addresses[chainId];
  });
}

/**
 * Check if a token is a stablecoin
 * @memberof module:helpers/tokenHelpers
 * @param {string} symbol - Token symbol (case-sensitive)
 * @returns {boolean} True if the token is a stablecoin, false otherwise
 * @throws {Error} If symbol parameter is invalid or token is not found
 * @example
 * // Check if USDC is a stablecoin
 * const isStable = isStablecoin('USDC');
 * // Returns: true
 *
 * @example
 * // Check if WETH is a stablecoin
 * const isStable = isStablecoin('WETH');
 * // Returns: false
 *
 * @example
 * // Use in strategy logic
 * if (isStablecoin(tokenSymbol)) {
 *   // Apply tighter slippage for stablecoins
 *   slippage = 0.1;
 * } else {
 *   // Use higher slippage for volatile assets
 *   slippage = 0.5;
 * }
 * @since 1.0.0
 */
export function isStablecoin(symbol) {
  validateTokenSymbol(symbol);

  const token = tokens[symbol];
  if (!token) {
    throw new Error(`Token ${symbol} not found`);
  }

  return token.isStablecoin;
}

/**
 * Detect if a token pair is a stable pair (both tokens are stablecoins)
 * @memberof module:helpers/tokenHelpers
 * @param {string} tokenAddressA - First token address
 * @param {string} tokenAddressB - Second token address
 * @param {number} chainId - Chain ID where the tokens exist
 * @returns {boolean} True if both tokens are stablecoins, false otherwise
 * @example
 * // Check if USDC-USDT is a stable pair
 * const isStable = detectStablePair(
 *   '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
 *   '0xdAC17F958D2ee523a2206206994597C13D831ec7', // USDT
 *   1 // Ethereum mainnet
 * );
 * // Returns: true
 *
 * @example
 * // Check if WETH-USDC is a stable pair
 * const isStable = detectStablePair(
 *   '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
 *   '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
 *   1
 * );
 * // Returns: false (mixed pair)
 *
 * @example
 * // Unknown tokens return false
 * const isStable = detectStablePair(
 *   '0x1234567890123456789012345678901234567890',
 *   '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
 *   1
 * );
 * // Returns: false
 * @since 1.0.0
 */
export function detectStablePair(tokenAddressA, tokenAddressB, chainId) {
  validateEthereumAddress(tokenAddressA);
  validateEthereumAddress(tokenAddressB);
  validateChainId(chainId);

  try {
    // Look up both tokens by their addresses
    const tokenA = getTokenByAddress(tokenAddressA, chainId);
    const tokenB = getTokenByAddress(tokenAddressB, chainId);

    // Check if both are stablecoins
    return isStablecoin(tokenA.symbol) && isStablecoin(tokenB.symbol);
  } catch (error) {
    // If we can't identify one or both tokens, treat as non-stable pair
    return false;
  }
}

/**
 * Get token by symbol
 * @memberof module:helpers/tokenHelpers
 * @param {string} symbol - Token symbol (case-sensitive)
 * @returns {Object} Token object containing all token metadata
 * @throws {Error} If symbol parameter is invalid or token is not found
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
 * // Handle unknown token (throws error)
 * try {
 *   const token = getTokenBySymbol('UNKNOWN');
 * } catch (error) {
 *   console.error('Token not found:', error.message);
 * }
 * @since 1.0.0
 */
export function getTokenBySymbol(symbol) {
  validateTokenSymbol(symbol);

  const token = tokens[symbol];
  if (token) {
    return token;
  }

  // Check wrappedSymbol fields (e.g., 'WETH' → ETH token with wrappedSymbol: 'WETH')
  for (const t of Object.values(tokens)) {
    if (t.wrappedSymbol === symbol) {
      return {
        ...t,
        symbol: t.wrappedSymbol,
        name: `Wrapped ${t.name}`,
        isNative: false,
        addresses: { ...t.wrappedAddresses },
        logoURI: t.wrappedLogoURI
      };
    }
  }

  throw new Error(`Token ${symbol} not found`);
}

/**
 * Get tokens by symbols (batch operation)
 * @memberof module:helpers/tokenHelpers
 * @param {string[]} symbols - Array of token symbols
 * @returns {Object} Object mapping symbol to token metadata
 * @throws {Error} If symbols parameter is invalid or any token not found
 * @example
 * // Get multiple tokens at once
 * const tokens = getTokensBySymbol(['USDC', 'WETH']);
 * // Returns: {
 * //   USDC: { name: "USD Coin", decimals: 6, ... },
 * //   WETH: { name: "Wrapped Ether", decimals: 18, ... }
 * // }
 *
 * @example
 * // Fails fast if any token is not found
 * try {
 *   const tokens = getTokensBySymbol(['USDC', 'UNKNOWN']);
 * } catch (error) {
 *   console.error('Failed to get all tokens:', error.message);
 * }
 * @since 1.0.0
 */
export function getTokensBySymbol(symbols) {
  validateTokenSymbols(symbols);

  const tokenMap = {};
  symbols.forEach(symbol => {
    tokenMap[symbol] = getTokenBySymbol(symbol);
  });

  return tokenMap;
}

/**
 * Get token by address on a specific chain
 * @memberof module:helpers/tokenHelpers
 * @param {string} address - Token contract address (0x-prefixed)
 * @param {number} chainId - Chain ID where the address exists
 * @returns {Object} Token object with all metadata
 * @throws {Error} If parameters are invalid or token not found at address
 * @example
 * // Look up token by its contract address
 * const token = getTokenByAddress('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', 1);
 * // Returns: { symbol: "USDC", name: "USD Coin", ... }
 *
 * @example
 * // Look up WETH token by its contract address
 * const token = getTokenByAddress('0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', 1);
 * // Returns: { symbol: "WETH", name: "Wrapped Ether", isNative: false, ... }
 *
 * @example
 * // Identify token from transaction
 * try {
 *   const token = getTokenByAddress(event.args.token, chainId);
 *   console.log(`Received ${token.symbol}`);
 * } catch (error) {
 *   console.error('Unknown token:', error.message);
 * }
 * @since 1.0.0
 */
export function getTokenByAddress(address, chainId) {
  validateEthereumAddress(address);
  validateChainId(chainId);

  // Normalize the address for comparison
  const normalizedAddress = address.toLowerCase();

  for (const token of Object.values(tokens)) {
    // Check standard addresses
    if (token.addresses[chainId] &&
        token.addresses[chainId].toLowerCase() === normalizedAddress) {
      return token;
    }

    // Also check wrappedAddresses for native tokens
    // When looking up a wrapped native token address (e.g., WETH, WAVAX), return a modified token
    // This allows position tracking to distinguish between native tokens and their wrapped versions
    if (token.wrappedAddresses &&
        token.wrappedAddresses[chainId] &&
        token.wrappedAddresses[chainId].toLowerCase() === normalizedAddress) {
      // Return a modified copy with wrapped symbol and the wrapped address
      return {
        ...token,
        symbol: token.wrappedSymbol,
        name: `Wrapped ${token.name}`,
        isNative: false,
        addresses: { [chainId]: token.wrappedAddresses[chainId] }
      };
    }
  }

  throw new Error(`No token found at address ${address} on chain ${chainId}`);
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

  return Object.values(getAllTokens()).filter(token =>
    token.isStablecoin === isStablecoin
  );
}

/**
 * Get token address for a specific chain
 * @memberof module:helpers/tokenHelpers
 * @param {string} symbol - Token symbol (case-sensitive)
 * @param {number} chainId - Chain ID where the token address is needed
 * @returns {string|null} Token contract address (0x-prefixed), or null for native tokens like ETH
 * @throws {Error} If parameters are invalid, token not found, or token not available on chain
 * @example
 * // Get USDC address on Ethereum mainnet
 * const usdcAddress = getTokenAddress('USDC', 1);
 * // Returns: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
 *
 * @example
 * // Get ETH address (returns null for native token)
 * const ethAddress = getTokenAddress('ETH', 1);
 * // Returns: AddressZero (use getWrappedNativeAddress() for wrapped token contract address)
 *
 * @example
 * // Handle native vs ERC20 tokens
 * const address = getTokenAddress(symbol, chainId);
 * if (address === null) {
 *   // Native token - use provider.getBalance() or getWrappedNativeAddress()
 * } else {
 *   const contract = new ethers.Contract(address, ERC20ABI, provider);
 * }
 * @since 1.0.0
 */
export function getTokenAddress(symbol, chainId) {
  validateTokenSymbol(symbol);
  validateChainId(chainId);

  const token = tokens[symbol];
  if (!token) {
    throw new Error(`Token ${symbol} not found`);
  }

  // For native tokens, verify chain support via wrappedAddresses
  if (token.isNative) {
    if (!token.wrappedAddresses || !token.wrappedAddresses[chainId]) {
      throw new Error(`Token ${symbol} not available on chain ${chainId}`);
    }
    // Native ETH returns AddressZero (set in config)
  }

  const address = token.addresses[chainId];
  if (!address) {
    throw new Error(`Token ${symbol} not available on chain ${chainId}`);
  }

  return address;
}

/**
 * Get token addresses for multiple symbols on a specific chain (batch operation)
 * @memberof module:helpers/tokenHelpers
 * @param {string[]} symbols - Array of token symbols
 * @param {number} chainId - Chain ID where addresses are needed
 * @returns {Object} Object mapping symbol to address (null for native tokens like ETH)
 * @throws {Error} If parameters are invalid, any token not found, or any token not available on chain
 * @example
 * // Get multiple token addresses at once
 * const addresses = getTokenAddresses(['USDC', 'ETH'], 1);
 * // Returns: { USDC: "0xA0b8...", ETH: null }
 *
 * @example
 * // Fails fast if any token is not available
 * try {
 *   const addresses = getTokenAddresses(['USDC', 'UNKNOWN'], 1);
 * } catch (error) {
 *   console.error('Failed to get all addresses:', error.message);
 * }
 * @since 1.0.0
 */
export function getTokenAddresses(symbols, chainId) {
  validateTokenSymbols(symbols);
  validateChainId(chainId);

  const addresses = {};
  symbols.forEach(symbol => {
    // getTokenAddress returns AddressZero for native tokens
    addresses[symbol] = getTokenAddress(symbol, chainId);
  });

  return addresses;
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
 * const tokensAvailable = areTokensSupportedOnChain(['USDC', 'ETH'], 42161);
 * if (!tokensAvailable) {
 *   console.error('Not all tokens available on this chain');
 * }
 *
 * @example
 * // Validate token selection for a specific chain
 * const selectedTokens = ['USDC', 'ETH', 'WBTC'];
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
    if (!token) return false;

    // For native tokens, check wrappedAddresses
    if (token.isNative) {
      return token.wrappedAddresses && token.wrappedAddresses[chainId];
    }

    return token.addresses[chainId];
  });
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

  const allTokens = getAllTokens();
  return symbols.every(symbol => allTokens[symbol] !== undefined);
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
 *   const geckoId = getCoingeckoId('ETH');
 *   const price = await fetchPriceFromCoingecko(geckoId);
 * } catch (error) {
 *   console.error('Token not supported for price fetching');
 * }
 * @since 1.0.0
 */
export function getCoingeckoId(symbol) {
  validateTokenSymbol(symbol);

  // Wrapped native tokens (WETH, WAVAX, etc.) use the same price as their native counterpart
  for (const token of Object.values(tokens)) {
    if (token.isNative && token.wrappedSymbol === symbol) {
      return token.coingeckoId;
    }
  }

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
 * Check if a token is a native token (like ETH)
 * @memberof module:helpers/tokenHelpers
 * @param {string} symbol - Token symbol (case-sensitive)
 * @returns {boolean} True if the token is native, false otherwise
 * @throws {Error} If symbol parameter is invalid or token is not found
 * @example
 * // Check if ETH is native
 * const native = isNativeToken('ETH');
 * // Returns: true
 *
 * @example
 * // Check if USDC is native
 * const native = isNativeToken('USDC');
 * // Returns: false
 *
 * @example
 * // Use in balance fetching logic
 * if (isNativeToken(symbol)) {
 *   balance = await provider.getBalance(address);
 * } else {
 *   balance = await tokenContract.balanceOf(address);
 * }
 * @since 1.0.0
 */
export function isNativeToken(symbol) {
  validateTokenSymbol(symbol);

  // Wrapped native tokens (WETH, WAVAX, etc.) are not native - they're ERC20 wrapped versions
  if (isWrappedNativeToken(symbol)) {
    return false;
  }

  const token = tokens[symbol];
  if (!token) {
    throw new Error(`Token ${symbol} not found`);
  }

  return token.isNative === true;
}

