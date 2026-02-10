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
    minSwapValue: 0.10,
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
    minSwapValue: 0.10,
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
      }
    },
  },

  // Avalanche C-Chain
  43114: {
    name: "Avalanche",
    nativeCurrency: {
      name: "Avalanche",
      symbol: "AVAX",
      decimals: 18
    },
    rpcUrls: ["https://avax-mainnet.g.alchemy.com/v2"],
    blockExplorerUrls: ["https://snowtrace.io"],
    executorAddress: "0x0",
    minDeploymentForGas: 10,
    minSwapValue: 0.10,
    transactionDeadlineMinutes: 5,
    platformAddresses: {
      traderjoeV2_1: {
        lbFactoryAddress: "0x8e42f2F4101563bF679975178e880FD87d3eFd4e",
        lbRouterAddress: "0xb4315e873dBcf96Ffd0acd8EA43f689D8c20fB30",
        lbQuoterAddress: "0xd76019A16606FDa4651f636D9751f500Ed776250",
        positionManagerAddress: "",  // Populated after deployment
      },
    },
  },

  // Local Hardhat Fork - Avalanche
  1338: {
    name: "Forked Avalanche",
    nativeCurrency: {
      name: "Avalanche",
      symbol: "AVAX",
      decimals: 18
    },
    rpcUrls: ["http://localhost:8546"],
    blockExplorerUrls: ["https://snowtrace.io"], // Use Avalanche explorer since it's a fork
    executorAddress: "0xabA472B2EA519490EE10E643A422D578a507197A", // Same test account as 1337
    minDeploymentForGas: 10,
    minSwapValue: 0.10,
    transactionDeadlineMinutes: 5,
    platformAddresses: {
      traderjoeV2_1: {
        // Same as Avalanche since it's a fork
        lbFactoryAddress: "0x8e42f2F4101563bF679975178e880FD87d3eFd4e",
        lbRouterAddress: "0xb4315e873dBcf96Ffd0acd8EA43f689D8c20fB30",
        lbQuoterAddress: "0xd76019A16606FDa4651f636D9751f500Ed776250",
        positionManagerAddress: "",  // Populated per test run after TJPositionManager deployment
      },
    },
  },
};

export default chains;
