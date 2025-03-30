// src/utils/tokenConfig.js
/**
 * Token configuration with addresses on multiple chains
 */
const tokens = {
  // USDC
  "USDC": {
    name: "USD Coin",
    symbol: "USDC",
    decimals: 6,
    addresses: {
      1: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", // Ethereum
      42161: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", // Arbitrum
      1337: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831"  // Local (same as Arbitrum)
    },
    logoURI: "/Token_Logos/USDC.svg",
    isStablecoin: true
  },

  // USDT
  "USDT": {
    name: "Tether USD",
    symbol: "USDT",
    decimals: 6,
    addresses: {
      1: "0xdAC17F958D2ee523a2206206994597C13D831ec7", // Ethereum
      42161: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", // Arbitrum
      1337: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9"  // Local (same as Arbitrum)
    },
    logoURI: "/Token_Logos/USDT.svg",
    isStablecoin: true
  },

  // DAI
  "DAI": {
    name: "Dai Stablecoin",
    symbol: "DAI",
    decimals: 18,
    addresses: {
      1: "0x6B175474E89094C44Da98b954EedeAC495271d0F", // Ethereum
      42161: "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1", // Arbitrum
      1337: "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1"  // Local (same as Arbitrum)
    },
    logoURI: "/Token_Logos/DAI.svg",
    isStablecoin: true
  },

  // FRAX
  "FRAX": {
    name: "Frax",
    symbol: "FRAX",
    decimals: 18,
    addresses: {
      1: "0x853d955aCEf822Db058eb8505911ED77F175b99e", // Ethereum
      42161: "0x17FC002b466eEc40DaE837Fc4bE5c67993ddBd6F", // Arbitrum
      1337: "0x17FC002b466eEc40DaE837Fc4bE5c67993ddBd6F"  // Local (same as Arbitrum)
    },
    logoURI: "/Token_Logos/FRAX.svg",
    isStablecoin: true
  },

  // BUSD
  "BUSD": {
    name: "Binance USD",
    symbol: "BUSD",
    decimals: 18,
    addresses: {
      1: "0x4Fabb145d64652a948d72533023f6E7A623C7C53", // Ethereum
      42161: "0x31190254504622cEFdFA55a7d3d272e6462629a2", // Arbitrum
      1337: "0x31190254504622cEFdFA55a7d3d272e6462629a2"  // Local (same as Arbitrum)
    },
    logoURI: "/Token_Logos/BUSD.svg",
    isStablecoin: true
  },

  // WETH (for non-stablecoin pairs)
  "WETH": {
    name: "Wrapped Ether",
    symbol: "WETH",
    decimals: 18,
    addresses: {
      1: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", // Ethereum
      42161: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", // Arbitrum
      1337: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1"  // Local (same as Arbitrum)
    },
    logoURI: "/Token_Logos/ETH.svg",
    isStablecoin: false
  }
};

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

export default tokens;
