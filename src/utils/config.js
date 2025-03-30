// src/utils/config.js
const config = {
  chains: {
    // Arbitrum One
    42161: {
      rpcUrl: process.env.NEXT_PUBLIC_ARBITRUM_RPC || "https://arb1.arbitrum.io/rpc",
      name: "Arbitrum One",
      envPK: "NEXT_PUBLIC_ARBITRUM_DEPLOYER_PK", // Private key env variable name for deployment
      platforms: {
        uniswapV3: {
          id: "uniswapV3",
          name: "Uniswap V3",
          factoryAddress: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
          positionManagerAddress: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88",
          enabled: true,
        },
      },
    },

    // Local Hardhat Fork
    1337: {
      rpcUrl: "http://localhost:8545",
      name: "Hardhat Forked Arbitrum",
      envPK: "NEXT_PUBLIC_LOCALHOST_DEPLOYER_PK", // Optional, script uses hardcoded value for localhost
      platforms: {
        uniswapV3: {
          id: "uniswapV3",
          name: "Uniswap V3",
          factoryAddress: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
          positionManagerAddress: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88", // Same as Arbitrum since it's a fork
          enabled: true,
        },
      },
    },

    // Ethereum Mainnet
    1: {
      rpcUrl: process.env.NEXT_PUBLIC_ETHEREUM_RPC || "https://mainnet.infura.io/v3/YOUR_INFURA_KEY",
      name: "Ethereum",
      envPK: "NEXT_PUBLIC_ETHEREUM_DEPLOYER_PK", // Private key env variable name for deployment
      platforms: {
        uniswapV3: {
          id: "uniswapV3",
          name: "Uniswap V3",
          factoryAddress: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
          positionManagerAddress: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88",
          enabled: true,
        },
      },
    },
  },

  // Define platform metadata for consistent display
  platformMetadata: {
    uniswapV3: {
      id: "uniswapV3",
      name: "Uniswap V3",
      logo: "/Platform_Logos/uniswap.svg", // Updated path reference from public directory
      color: "#FF007A", // Uniswap pink
      description: "Uniswap V3 concentrated liquidity positions",
    },
  }
};

/**
 * Get all available platforms for the current chain
 * @param {number} chainId - The current chain ID
 * @returns {Array} Array of platform objects with id, name, and metadata
 */
export function getAvailablePlatforms(chainId) {
  if (!chainId || !config.chains[chainId]) return [];

  const chainConfig = config.chains[chainId];
  const platforms = [];

  // Get enabled platforms from chain config
  Object.values(chainConfig.platforms).forEach(platform => {
    if (platform.enabled) {
      // Merge platform info with metadata
      const metadata = config.platformMetadata[platform.id] || {};

      platforms.push({
        id: platform.id,
        name: platform.name || metadata.name || platform.id,
        factoryAddress: platform.factoryAddress,
        positionManagerAddress: platform.positionManagerAddress,
        logo: metadata.logo,
        color: metadata.color || "#6c757d", // Default gray if no color specified
        description: metadata.description || ""
      });
    }
  });

  return platforms;
}

/**
 * Get platform details by ID
 * @param {string} platformId - The platform ID to look up
 * @param {number} chainId - The current chain ID
 * @returns {Object|null} Platform object or null if not found
 */
export function getPlatformById(platformId, chainId) {
  if (!platformId || !chainId || !config.chains[chainId]) return null;

  const chainConfig = config.chains[chainId];
  const platformConfig = chainConfig.platforms[platformId];

  if (!platformConfig || !platformConfig.enabled) return null;

  const metadata = config.platformMetadata[platformId] || {};

  return {
    id: platformId,
    name: platformConfig.name || metadata.name || platformId,
    factoryAddress: platformConfig.factoryAddress,
    positionManagerAddress: platformConfig.positionManagerAddress,
    logo: metadata.logo,
    color: metadata.color || "#6c757d",
    description: metadata.description || ""
  };
}

/**
 * Check if a platform supports specific tokens
 * @param {string} platformId - The platform ID to check
 * @param {Array} tokenSymbols - Array of token symbols to check
 * @param {number} chainId - The current chain ID
 * @returns {boolean} Whether the platform supports all tokens
 */
export function platformSupportsTokens(platformId, tokenSymbols, chainId) {
  // Default implementation - you can customize based on specific platform requirements
  return true;
}

/**
 * Get the primary color for a platform
 * @param {string} platformId - The platform ID
 * @returns {string} Color hex code
 */
export function getPlatformColor(platformId) {
  const metadata = config.platformMetadata[platformId] || {};
  return metadata.color || "#6c757d"; // Default gray
}

export default config;
