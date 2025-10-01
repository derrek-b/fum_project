// src/configs/chains.js
/**
 * Chain configuration for F.U.M. project
 * Contains network-specific information for supported blockchains
 */

const chains = {
  // Arbitrum One
  42161: {
    name: "Arbitrum One",
    nativeCurrency: {
      name: "Ether",
      symbol: "ETH",
      decimals: 18
    },
    rpcUrls: [`https://arb-mainnet.g.alchemy.com/v2/${process.env.NEXT_PUBLIC_ALCHEMY_API_KEY}`],
    blockExplorerUrls: ["https://arbiscan.io"],
    envPK: process.env.ARBITRUM_DEPLOYER_PK,
    executorEnvPK: process.env.ARBITRUM_EXECUTOR_PK,
    executorAddress: "0x0",
    minDeploymentForGas: 10,
    platformAddresses: {
      uniswapV3: {
        factoryAddress: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
        positionManagerAddress: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88",
        routerAddress: "0xE592427A0AEce92De3Edee1F18E0157C05861564",
        universalRouterAddress: "0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD",
        quoterAddress: "0x61fFE014bA17989E743c5F6cB21bF9697530B21e",
        enabled: true,
      },
    },
  },

  // Local Hardhat Fork
  1337: {
    name: "Forked Arbitrum",
    nativeCurrency: {
      name: "Ether",
      symbol: "ETH",
      decimals: 18
    },
    rpcUrls: ["http://localhost:8545"],
    blockExplorerUrls: ["https://arbiscan.io"], // Use Arbitrum explorer since it's a fork
    envPK: process.env.LOCAL_DEPLOYER_PK,
    executorEnvPK: process.env.LOCAL_EXECUTOR_PK,
    executorAddress: "0xabA472B2EA519490EE10E643A422D578a507197A",
    minDeploymentForGas: 10,
    platformAddresses: {
      uniswapV3: {
        factoryAddress: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
        positionManagerAddress: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88", // Same as Arbitrum since it's a fork
        routerAddress: "0xE592427A0AEce92De3Edee1F18E0157C05861564", // Same as Arbitrum since it's a fork
        universalRouterAddress: "0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD", // Same as Arbitrum since it's a fork
        quoterAddress: "0x61fFE014bA17989E743c5F6cB21bF9697530B21e", // Same as Arbitrum since it's a fork
        enabled: true,
      },
    },
  },

  // Ethereum Mainnet
  1: {
    name: "Ethereum",
    nativeCurrency: {
      name: "Ether",
      symbol: "ETH",
      decimals: 18
    },
    rpcUrls: ["https://cloudflare-eth.com"],
    blockExplorerUrls: ["https://etherscan.io"],
    envPK: process.env.ETHEREUM_DEPLOYER_PK,
    executorEnvPK: process.env.ETHEREUM_EXECUTOR_PK,
    executorAddress: "0x0",
    minDeploymentForGas: 100,
    platformAddresses: {
      uniswapV3: {
        factoryAddress: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
        positionManagerAddress: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88",
        routerAddress: "0xE592427A0AEce92De3Edee1F18E0157C05861564",
        universalRouterAddress: "0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD",
        quoterAddress: "0x61fFE014bA17989E743c5F6cB21bF9697530B21e",
        enabled: true,
      },
    },
  },
};

export default chains;
