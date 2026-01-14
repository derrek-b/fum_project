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
        id: "FbCGRftH4a3yZugY7TnbYgPJVEv2LvMT6oF1fxPe9aJM",
        queryType: "uniswap"
      },   // Arbitrum One (Uniswap - supports native USDC)
      1337: {
        id: "FbCGRftH4a3yZugY7TnbYgPJVEv2LvMT6oF1fxPe9aJM",
        queryType: "uniswap"
      }    // Local fork (Uniswap - supports native USDC)
    },
  },
  uniswapV4: {
    id: "uniswapV4",
    name: "Uniswap V4",
    logo: "/Platform_Logos/uniswap.svg",
    color: "#FF007A", // Uniswap pink (same brand)
    description: "Uniswap V4 concentrated liquidity with hooks",
    // Platform-specific features
    features: {
      concentratedLiquidity: true,
      multipleFeeTiers: true,
      hooks: true,              // V4 hooks system
      nativeETH: true,          // Native ETH support without wrapping
      flashAccounting: true,    // Gas-efficient batching
      dynamicFees: true,        // Fees can be modified by hooks
    },
    // Supported fee tiers with tick spacing (same as V3)
    // Note: V4 allows custom fee tiers via hooks, but these are the standard ones
    feeTiers: {
      100: { spacing: 1 },    // 0.01% fee = 1 tick spacing
      500: { spacing: 10 },   // 0.05% fee = 10 tick spacing
      3000: { spacing: 60 },  // 0.3% fee = 60 tick spacing
      10000: { spacing: 200 } // 1% fee = 200 tick spacing
    },
    // Same tick bounds as V3 (concentrated liquidity math unchanged)
    minTick: -887272,
    maxTick: 887272,
    // The Graph subgraph IDs - TODO: Add when V4 subgraphs are available
    subgraphs: {
      // 1: { id: "...", queryType: "uniswapV4" },
      // 42161: { id: "...", queryType: "uniswapV4" },
    },
  },
  // Add other platforms here as needed
};

export { platforms };
export default platforms;
