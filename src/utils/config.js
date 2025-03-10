const config = {
  chains: {
    42161: {
      rpcUrl: process.env.NEXT_PUBLIC_ARBITRUM_RPC || "https://arb1.arbitrum.io/rpc",
      name: "Arbitrum One",
      platforms: {
        uniswapV3: {
          name: "Uniswap V3",
          factoryAddress: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
          positionManagerAddress: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88",
        },
      },
    },
    1337: {
      rpcUrl: "http://localhost:8545",
      name: "Hardhat Forked Arbitrum",
      platforms: {
        uniswapV3: {
          name: "Uniswap V3",
          factoryAddress: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
          positionManagerAddress: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88", // Same as Arbitrum since it's a fork
        },
      },
    },
    // Example for Ethereum (uncomment and adjust as needed)
    // 1: {
    //   rpcUrl: "https://mainnet.infura.io/v3/YOUR_INFURA_KEY",
    //   name: "Ethereum",
    //   platforms: {
    //     uniswapV3: {
    //       name: "Uniswap V3",
    //       factoryAddress: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
    //       positionManagerAddress: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88",
    //     },
    //   },
    // },
  },
};

export default config;
