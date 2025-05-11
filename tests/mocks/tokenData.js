// Mock data for token helpers tests

export const mockTokens = {
  "USDC": {
    name: "USD Coin",
    symbol: "USDC",
    decimals: 6,
    addresses: {
      1: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", // Ethereum
      42161: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", // Arbitrum
    },
    logoURI: "/Token_Logos/USDC.svg",
    isStablecoin: true
  },
  "WETH": {
    name: "Wrapped Ether",
    symbol: "WETH",
    decimals: 18,
    addresses: {
      1: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", // Ethereum
      42161: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", // Arbitrum
    },
    logoURI: "/Token_Logos/ETH.svg",
    isStablecoin: false
  },
  "DAI": {
    name: "Dai Stablecoin",
    symbol: "DAI",
    decimals: 18,
    addresses: {
      1: "0x6B175474E89094C44Da98b954EedeAC495271d0F", // Ethereum
      42161: "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1", // Arbitrum
    },
    logoURI: "/Token_Logos/DAI.svg",
    isStablecoin: true
  },
  "USDT": {
    name: "Tether USD",
    symbol: "USDT",
    decimals: 6,
    addresses: {
      1: "0xdAC17F958D2ee523a2206206994597C13D831ec7", // Ethereum
    },
    logoURI: "/Token_Logos/USDT.svg",
    isStablecoin: true
  }
};

export const newToken = {
  name: "Arbitrum",
  symbol: "ARB",
  decimals: 18,
  addresses: {
    42161: "0x912CE59144191C1204E64559FE8253a0e49E6548", // Arbitrum
  },
  logoURI: "/Token_Logos/ARB.svg",
  isStablecoin: false
};