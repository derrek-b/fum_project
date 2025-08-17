// src/configs/tokens.js
/**
 * Token configuration with addresses on multiple chains
 */
const tokens = {
  // USDC
  "USDC": {
    name: "USD Coin",
    symbol: "USDC",
    displaySymbol: "USDC",
    decimals: 6,
    coingeckoId: "usd-coin",
    addresses: {
      1: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", // Ethereum
      42161: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", // Arbitrum
      1337: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831"  // Local (same as Arbitrum)
    },
    logoURI: "/Token_Logos/USDC.svg",
    isStablecoin: true
  },

  // USDT
  "USD₮0": {
    name: "Tether USD",
    symbol: "USD₮0",
    displaySymbol: "USDT",
    decimals: 6,
    coingeckoId: "tether",
    addresses: {
      1: "0xdAC17F958D2ee523a2206206994597C13D831ec7", // Ethereum
      42161: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", // Arbitrum
      1337: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9"  // Local (same as Arbitrum)
    },
    logoURI: "/Token_Logos/USDT.svg",
    isStablecoin: true
  },

  // WETH
  "WETH": {
    name: "Wrapped Ether",
    symbol: "WETH",
    displaySymbol: "WETH",
    decimals: 18,
    coingeckoId: "ethereum",
    addresses: {
      1: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", // Ethereum
      42161: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", // Arbitrum
      1337: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1"  // Local (same as Arbitrum)
    },
    logoURI: "/Token_Logos/ETH.svg",
    isStablecoin: false
  },

  // WBTC
  "WBTC": {
    name: "Wrapped BTC",
    symbol: "WBTC",
    displaySymbol: "WBTC",
    decimals: 8,
    coingeckoId: "wrapped-bitcoin",
    addresses: {
      1: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", // Ethereum
      42161: "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f", // Arbitrum
      1337: "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f"  // Local (same as Arbitrum)
    },
    logoURI: "/Token_Logos/WBTC.svg",
    isStablecoin: false
  },

  // LINK
  "LINK": {
    name: "Chainlink",
    symbol: "LINK",
    displaySymbol: "LINK",
    decimals: 18,
    coingeckoId: "chainlink",
    addresses: {
      1: "0x514910771AF9Ca656af840dff83E8264EcF986CA", // Ethereum
      42161: "0xf97f4df75117a78c1A5a0DBb814Af92458539FB4", // Arbitrum
      1337: "0xf97f4df75117a78c1A5a0DBb814Af92458539FB4"  // Local (same as Arbitrum)
    },
    logoURI: "/Token_Logos/LINK.svg",
    isStablecoin: false
  }
};

export default tokens;
