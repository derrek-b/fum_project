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
        },
        // Add more platforms for Arbitrum here later (e.g., SushiSwap)
      },
    },
    // Add more chains here later (e.g., Ethereum, Polygon) with their own platforms
    // Example:
    // ethereum: {
    //   chainId: 1,
    //   rpcUrl: "https://mainnet.infura.io/v3/YOUR_INFURA_KEY",
    //   name: "Ethereum",
    //   platforms: {
    //     uniswapV3: {
    //       name: "Uniswap V3",
    //       factoryAddress: "0x1F98431c8aD98523631AE4a59f267346ea31F984", // Ethereum Uniswap V3 factory
    //     },
    //   },
    // },
  },
};

export default config;
