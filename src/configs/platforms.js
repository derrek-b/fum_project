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
  },
  // Add other platforms here as needed
};

export default platforms;
