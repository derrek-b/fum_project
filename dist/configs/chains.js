// src/configs/chains.js
/**
 * Chain configuration for F.U.M. project
 * Contains network-specific information for supported blockchains
 */

const chains = {
  // Arbitrum One
  42161: {
    rpcUrl: process.env.NEXT_PUBLIC_ARBITRUM_RPC || "https://arb1.arbitrum.io/rpc",
    name: "Arbitrum One",
    envPK: "NEXT_PUBLIC_ARBITRUM_DEPLOYER_PK", // Private key env variable name for deployment
    executorEnvPK: "NEXT_PUBLIC_ARBITRUM_EXECUTOR_PK",
    executorAddress: "0x0",
    platformAddresses: {
      uniswapV3: {
        factoryAddress: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
        positionManagerAddress: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88",
        routerAddress: "0xE592427A0AEce92De3Edee1F18E0157C05861564",
        enabled: true,
      },
    },
  },

  // Local Hardhat Fork
  1337: {
    rpcUrl: "http://localhost:8545",
    wsUrl: 'ws://localhost:8545',
    name: "Forked Arbitrum",
    envPK: "NEXT_PUBLIC_LOCALHOST_DEPLOYER_PK", // Optional, script uses hardcoded value for localhost
    executorEnvPK: "NEXT_PUBLIC_LOCALHOST_EXECUTOR_PK",
    executorAddress: "0x70997970c51812dc3a010c7d01b50e0d17dc79c8",
    platformAddresses: {
      uniswapV3: {
        factoryAddress: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
        positionManagerAddress: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88", // Same as Arbitrum since it's a fork
        routerAddress: "0xE592427A0AEce92De3Edee1F18E0157C05861564", // Same as Arbitrum since it's a fork
        enabled: true,
      },
    },
  },

  // Ethereum Mainnet
  1: {
    rpcUrl: process.env.NEXT_PUBLIC_ETHEREUM_RPC || "https://mainnet.infura.io/v3/YOUR_INFURA_KEY",
    name: "Ethereum",
    envPK: "NEXT_PUBLIC_ETHEREUM_DEPLOYER_PK", // Private key env variable name for deployment
    executorEnvPK: "NEXT_PUBLIC_ETHEREUM_EXECUTOR_PK",
    executorAddress: "0x0",
    platformAddresses: {
      uniswapV3: {
        factoryAddress: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
        positionManagerAddress: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88",
        routerAddress: "0xE592427A0AEce92De3Edee1F18E0157C05861564",
        enabled: true,
      },
    },
  },
};

export default chains;
