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
    rpcUrls: ["https://arb-mainnet.g.alchemy.com/v2"],  // Base URL - API key appended by getChainRpcUrls()
    blockExplorerUrls: ["https://arbiscan.io"],
    executorAddress: "0x42d9df99e78ba0573b2990d6177d6eef7145c8e6",
    minDeploymentForGas: 10,
    minBufferSwapValue: 0.10,
    transactionDeadlineMinutes: 5,
    platformAddresses: {
      uniswapV3: {
        factoryAddress: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
        positionManagerAddress: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88",
        routerAddress: "0xE592427A0AEce92De3Edee1F18E0157C05861564",
        universalRouterAddress: "0xa51afafe0263b40edaef0df8781ea9aa03e381a3", // V2.0 (V4 support)
        quoterAddress: "0x61fFE014bA17989E743c5F6cB21bF9697530B21e",
      },
      uniswapV4: {
        poolManagerAddress: "0x360e68faccca8ca495c1b759fd9eee466db9fb32",
        positionManagerAddress: "0xd88f38f930b7952f2db2432cb002e7abbf3dd869",
        stateViewAddress: "0x76fd297e2d437cd7f76d50f01afe6160f86e9990",
        quoterAddress: "0x3972c00f7ed4885e145823eb7c655375d275a1c5",
        // V4 uses UniversalRouter for swaps (shared with V3)
        universalRouterAddress: "0xa51afafe0263b40edaef0df8781ea9aa03e381a3",
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
    executorAddress: "0xabA472B2EA519490EE10E643A422D578a507197A",
    minDeploymentForGas: 10,
    minBufferSwapValue: 0.10,
    transactionDeadlineMinutes: 5,
    platformAddresses: {
      uniswapV3: {
        factoryAddress: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
        positionManagerAddress: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88", // Same as Arbitrum since it's a fork
        routerAddress: "0xE592427A0AEce92De3Edee1F18E0157C05861564", // Same as Arbitrum since it's a fork
        universalRouterAddress: "0xa51afafe0263b40edaef0df8781ea9aa03e381a3", // V2.0 (V4 support) - Same as Arbitrum
        quoterAddress: "0x61fFE014bA17989E743c5F6cB21bF9697530B21e", // Same as Arbitrum since it's a fork
      },
      uniswapV4: {
        // Same as Arbitrum since it's a fork
        poolManagerAddress: "0x360e68faccca8ca495c1b759fd9eee466db9fb32",
        positionManagerAddress: "0xd88f38f930b7952f2db2432cb002e7abbf3dd869",
        stateViewAddress: "0x76fd297e2d437cd7f76d50f01afe6160f86e9990",
        quoterAddress: "0x3972c00f7ed4885e145823eb7c655375d275a1c5",
        universalRouterAddress: "0xa51afafe0263b40edaef0df8781ea9aa03e381a3",
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
    executorAddress: "0x0",
    minDeploymentForGas: 100,
    minBufferSwapValue: 1.00,
    transactionDeadlineMinutes: 20,
    platformAddresses: {
      uniswapV3: {
        factoryAddress: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
        positionManagerAddress: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88",
        routerAddress: "0xE592427A0AEce92De3Edee1F18E0157C05861564",
        universalRouterAddress: "0x66a9893cc07d91d95644aedd05d03f95e1dba8af", // V2.0 (V4 support)
        quoterAddress: "0x61fFE014bA17989E743c5F6cB21bF9697530B21e",
      },
      uniswapV4: {
        poolManagerAddress: "0x000000000004444c5dc75cB358380D2e3dE08A90",
        positionManagerAddress: "0xbd216513d74c8cf14cf4747e6aaa6420ff64ee9e",
        stateViewAddress: "0x7ffe42c4a5deea5b0fec41c94c136cf115597227",
        quoterAddress: "0x52f0e24d1c21c8a0cb1e5a5dd6198556bd9e1203",
        universalRouterAddress: "0x66a9893cc07d91d95644aedd05d03f95e1dba8af",
      },
    },
  },
};

export default chains;
