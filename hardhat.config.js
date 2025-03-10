require("@nomiclabs/hardhat-waffle");
require("dotenv").config({ path: ".env.local" });

module.exports = {
  solidity: "0.8.4",
  networks: {
    hardhat: {
      chainId: 1337,
      forking: {
        url: `https://arb-mainnet.g.alchemy.com/v2/${process.env.NEXT_PUBLIC_ALCHEMY_API_KEY}`,
      },
    },
  },
};
