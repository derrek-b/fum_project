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

export default config;
