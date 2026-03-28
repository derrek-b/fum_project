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
    executorXpub: "",  // Populated when production mnemonic is generated
    minExecutorBalance: 0.002,  // ETH — ~12 worst-case rebalance cycles (at 200 gwei spike)
    maxExecutorBalance: 0.004,  // ETH — ~24 worst-case rebalance cycles
    maxPriorityFeePerGas: "0",  // wei/gas — Arbitrum sequencer is FCFS, ignores tips entirely
    minDeploymentForGas: 50,
    minSwapValue: 10,
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
    merklDistributorAddress: "0x3Ef3D8bA38EBe18DB133cEc108f4D14CE00Dd9Ae",
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
    executorXpub: "xpub6F8xskVEWJTqZB69U3UmjGe8zwoXUefq5YCBgpyS2xf4CFEzNX4zUbxYBqZLdC96gEayShKc9f9rhgnNhSMtzADf8x4HX8Wia4AjBmqAPir",
    minExecutorBalance: 0.002,
    maxExecutorBalance: 0.004,
    maxPriorityFeePerGas: "0",  // wei/gas — Arbitrum fork, same as mainnet
    minDeploymentForGas: 50,
    minSwapValue: 10,
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
    merklDistributorAddress: "0x3Ef3D8bA38EBe18DB133cEc108f4D14CE00Dd9Ae",
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
    executorXpub: "",  // Not configured yet
    minExecutorBalance: 0.04,   // AVAX — ~13 worst-case rebalance cycles (at 565 nAVAX spike)
    maxExecutorBalance: 0.08,   // AVAX — ~26 worst-case rebalance cycles
    maxPriorityFeePerGas: "1000",  // wei/gas — Avalanche uses tips for ordering, but near-zero (~0.000001 gwei)
    minDeploymentForGas: 10,
    minSwapValue: 0.10,
    transactionDeadlineMinutes: 5,
    platformAddresses: {
      traderjoeV2_2: {
        lbFactoryAddress: "0xb43120c4745967fa9b93E79C149E66B0f2D6Fe0c",
        lbRouterAddress: "0x18556DA13313f3532c54711497A8FedAC273220E",
        lbQuoterAddress: "0x9A550a522BBaDFB69019b0432800Ed17855A51C3",
        positionManagerAddress: "0xb782f215aB9C9B40287998Ce9cC0a127Ecd7B78C",  // Populated after deployment
        liquidityHelperAddress: "0xA5c68C9E55Dde3505e60c4B5eAe411e2977dfB35",
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
    executorXpub: "xpub6F8xskVEWJTqZB69U3UmjGe8zwoXUefq5YCBgpyS2xf4CFEzNX4zUbxYBqZLdC96gEayShKc9f9rhgnNhSMtzADf8x4HX8Wia4AjBmqAPir",
    minExecutorBalance: 0.04,
    maxExecutorBalance: 0.08,
    maxPriorityFeePerGas: "1000",  // wei/gas — Avalanche fork, same as mainnet
    minDeploymentForGas: 10,
    minSwapValue: 0.10,
    transactionDeadlineMinutes: 5,
    platformAddresses: {
      traderjoeV2_2: {
        // V2.2 addresses (same as Avalanche mainnet since it's a fork)
        lbFactoryAddress: "0xb43120c4745967fa9b93E79C149E66B0f2D6Fe0c",
        lbRouterAddress: "0x18556DA13313f3532c54711497A8FedAC273220E",
        lbQuoterAddress: "0x9A550a522BBaDFB69019b0432800Ed17855A51C3",
        positionManagerAddress: "0xCBd482597a26c0255a5F38B3360bE2015D628187",  // Populated per test run after TJPositionManager deployment
        liquidityHelperAddress: "0xA5c68C9E55Dde3505e60c4B5eAe411e2977dfB35",
      },
    },
  },
};

export default chains;
