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
    // Platform-specific features
    features: {
      concentratedLiquidity: true,
      multipleFeeTiers: true,
    },
    // Supported fee tiers (in basis points)
    feeTiers: [100, 500, 3000, 10000],
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
