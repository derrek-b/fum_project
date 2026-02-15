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
      hooks: true,              // V4 hooks system
      nativeETH: true,          // Native ETH support without wrapping
      flashAccounting: true,    // Gas-efficient batching
      dynamicFees: true,        // Fees can be modified by hooks
      flexibleFees: true,       // Fee is an independent PoolKey parameter (not fixed tiers)
      flexibleTickSpacing: true // tickSpacing is an independent PoolKey parameter
    },
    // V4 Note: Unlike V3, fee and tickSpacing are independent PoolKey parameters.
    // Pools can have any fee (up to 1,000,000 = 100%) and any tickSpacing.
    // Dynamic fees use fee = 0x800000 with actual fee set by hooks.
    // Same tick bounds as V3 (concentrated liquidity math unchanged)
    minTick: -887272,
    maxTick: 887272,
    // The Graph subgraph IDs for V4
    subgraphs: {
      42161: {
        id: "G5TsTKNi8yhPSV7kycaE23oWbqv9zzNqR49FoEQjzq1r",
        queryType: "uniswapV4"
      },   // Arbitrum One
      1337: {
        id: "G5TsTKNi8yhPSV7kycaE23oWbqv9zzNqR49FoEQjzq1r",
        queryType: "uniswapV4"
      }    // Local fork (uses Arbitrum subgraph)
    },
  },
  traderjoeV2_2: {
    id: "traderjoeV2_2",
    name: "Trader Joe V2.2",
    logo: "/Platform_Logos/traderjoe.svg",
    color: "#E53E3E",
    description: "Trader Joe V2.2 Liquidity Book positions",
    features: {
      concentratedLiquidity: true,
      binBasedLiquidity: true,
    },
    // Note: Bin step is a per-pool parameter (like V4's flexible fees/tickSpacing),
    // not a fixed set of tiers. We get it from pool data, not config.
    // Pool discovery uses LBFactory.getAllLBPairs() on-chain queries
    // (more reliable than subgraph - no migration/availability issues)
  },
};

export { platforms };
export default platforms;
