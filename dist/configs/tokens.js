// src/configs/tokens.js
/**
 * Token configuration with addresses on multiple chains
 */

// Native ETH uses AddressZero as its canonical address
// This allows consistent address-based logic instead of null checks
const ADDRESS_ZERO = "0x0000000000000000000000000000000000000000";

const tokens = {
  // USDC
  "USDC": {
    name: "USD Coin",
    symbol: "USDC",
    displaySymbol: "USDC",
    decimals: 6,
    coingeckoId: "usd-coin",
    addresses: {
      42161: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", // Arbitrum
      43114: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E", // Avalanche (native Circle USDC)
      1337: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",  // Local Arbitrum fork
      1338: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E"   // Local Avalanche fork (same as Avalanche)
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
      42161: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", // Arbitrum
      43114: "0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7", // Avalanche (native Tether USDT)
      1337: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",  // Local Arbitrum fork
      1338: "0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7"   // Local Avalanche fork (same as Avalanche)
    },
    logoURI: "/Token_Logos/USDT.svg",
    isStablecoin: true
  },

  // ETH (Native Ether with WETH wrapper addresses for V3 compatibility)
  "ETH": {
    name: "Ether",
    symbol: "ETH",
    displaySymbol: "ETH",
    decimals: 18,
    coingeckoId: "ethereum",
    isNative: true,
    addresses: {
      42161: ADDRESS_ZERO,
      1337: ADDRESS_ZERO
    },
    wethAddresses: {
      42161: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",  // Arbitrum
      1337: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1"    // Local Arbitrum fork
    },
    logoURI: "/Token_Logos/ETH.svg",
    wethLogoURI: "/Token_Logos/WETH.svg",
    isStablecoin: false
  },

  // AVAX (Native Avalanche token with WAVAX wrapper addresses)
  "AVAX": {
    name: "Avalanche",
    symbol: "AVAX",
    displaySymbol: "AVAX",
    decimals: 18,
    coingeckoId: "avalanche-2",
    isNative: true,
    addresses: {
      43114: ADDRESS_ZERO,
      1338: ADDRESS_ZERO
    },
    wethAddresses: {
      43114: "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7",  // WAVAX on Avalanche
      1338: "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7"    // Local Avalanche fork (same as Avalanche)
    },
    logoURI: "/Token_Logos/AVAX.svg",
    wethLogoURI: "/Token_Logos/WAVAX.svg",
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
      42161: "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f", // Arbitrum
      1337: "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f"   // Local (same as Arbitrum)
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
      42161: "0xf97f4df75117a78c1A5a0DBb814Af92458539FB4", // Arbitrum
      1337: "0xf97f4df75117a78c1A5a0DBb814Af92458539FB4"  // Local (same as Arbitrum)
    },
    logoURI: "/Token_Logos/LINK.svg",
    isStablecoin: false
  }
};

export default tokens;
