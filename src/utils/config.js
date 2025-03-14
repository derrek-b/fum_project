const config = {
  chains: {
    42161: {
      rpcUrl: process.env.NEXT_PUBLIC_ARBITRUM_RPC || "https://arb1.arbitrum.io/rpc",
      name: "Arbitrum One",
      platforms: {
        uniswapV3: {
          id: "uniswapV3",
          name: "Uniswap V3",
          factoryAddress: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
          positionManagerAddress: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88",
          enabled: true,
        },
        // Example for another platform (commented out until implemented)
        // sushiswap: {
        //   id: "sushiswap",
        //   name: "SushiSwap",
        //   factoryAddress: "0xc35DADB65012eC5796536bD9864eD8773aBc74C4",
        //   positionManagerAddress: "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f",
        //   enabled: true,
        // },
      },
    },
    1337: {
      rpcUrl: "http://localhost:8545",
      name: "Hardhat Forked Arbitrum",
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
    // Example for Ethereum (uncomment and adjust as needed)
    // 1: {
    //   rpcUrl: "https://mainnet.infura.io/v3/YOUR_INFURA_KEY",
    //   name: "Ethereum",
    //   platforms: {
    //     uniswapV3: {
    //       id: "uniswapV3",
    //       name: "Uniswap V3",
    //       factoryAddress: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
    //       positionManagerAddress: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88",
    //       enabled: true,
    //     },
    //     // Uncomment when you add the Sushiswap adapter
    //     // sushiswap: {
    //     //   id: "sushiswap",
    //     //   name: "SushiSwap",
    //     //   factoryAddress: "0xC0AEe478e3658e2610c5F7A4A2E1777cE9e4f2Ac",
    //     //   positionManagerAddress: "0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F",
    //     //   enabled: true,
    //     // },
    //   },
    // },
  },

  // Define platform metadata for consistent display
  platformMetadata: {
    uniswapV3: {
      id: "uniswapV3",
      name: "Uniswap V3",
      logo: "/logos/uniswap.svg", // Add logo path if you have it
      color: "#FF007A", // Uniswap pink
      description: "Uniswap V3 concentrated liquidity positions",
    },
    // Add more platform metadata as you implement new adapters
    // sushiswap: {
    //   id: "sushiswap",
    //   name: "SushiSwap",
    //   logo: "/logos/sushiswap.svg",
    //   color: "#0E0F23",
    //   description: "SushiSwap liquidity positions",
    // },
  }
};

export default config;
