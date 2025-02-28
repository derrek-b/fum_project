const config = {
  chains: {
    arbitrum: {
      chainId: 42161,
      rpcUrl: process.env.NEXT_PUBLIC_ARBITRUM_RPC || "https://arb1.arbitrum.io/rpc",
      name: "Arbitrum One",
      platforms: {
        uniswapV3: {
          name: "Uniswap V3",
          factoryAddress: "0x1F98431c8aD98523631AE4a59f267346ea31F984", // Arbitrum Uniswap V3 factory
          positionManagerAddress: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88", // Arbitrum Uniswap V3 NonfungiblePositionManager
        },
        // Add more platforms for Arbitrum here later (e.g., SushiSwap)
      },
    },
    // Add more chains here later (e.g., Ethereum, Polygon)
    // Example:
    // ethereum: {
    //   chainId: 1,
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
