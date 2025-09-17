// src/configs/platforms.js
/**
 * Platform configuration for F.U.M. project
 * Contains metadata and information about supported DeFi platforms
 */

const platforms = {
  uniswapV3: {
    id: "uniswapV3",
    name: "Uniswap V3",
    logo: "/Platform_Logos/uniswap.svg",
    color: "#FF007A", // Uniswap pink
    description: "Uniswap V3 concentrated liquidity positions",
    minLiquidityAmount: 10,
    // Platform-specific features
    features: {
      concentratedLiquidity: true,
      multipleFeeTiers: true,
    },
    // Supported fee tiers with tick spacing (in basis points)
    feeTiers: {
      100: { spacing: 1 },    // 0.01% fee = 1 tick spacing
      500: { spacing: 10 },   // 0.05% fee = 10 tick spacing
      3000: { spacing: 60 },  // 0.3% fee = 60 tick spacing
      10000: { spacing: 200 } // 1% fee = 200 tick spacing
    },
    // Uniswap V3 tick bounds
    minTick: -887272,
    maxTick: 887272,
    // The Graph subgraph IDs and query types for different chains
    subgraphs: {
      1: {
        id: "5zvR82QoaXYFyDEKLZ9t6v9adgnptxYpKpSbxtgVENFV",
        queryType: "uniswap"
      },      // Ethereum mainnet (Official Uniswap V3)
      42161: {
        id: "FQ6JYszEKApsBpAmiHesRsd9Ygc6mzmpNRANeVQFYoVX",
        queryType: "messari"
      },   // Arbitrum One (Messari)
      1337: {
        id: "FQ6JYszEKApsBpAmiHesRsd9Ygc6mzmpNRANeVQFYoVX",
        queryType: "messari"
      }    // Local fork (Messari)
    },
  },
  // Add other platforms here as needed
};

export default platforms;
