require("@nomicfoundation/hardhat-toolbox");
require("@nomicfoundation/hardhat-verify");
require("dotenv").config();

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      },
      viaIR: true
    },
  },
  networks: {
    hardhat: {
      chainId: 1337
    },
    arbitrumOne: {
      url: "https://arb1.arbitrum.io/rpc",
      chainId: 42161
    }
  },
  etherscan: {
    // Single-string form targets the Etherscan V2 unified API (one key works
    // across all supported chains, including Arbiscan). The per-network keyed
    // form is V1 and was deprecated 2025-05-31.
    apiKey: process.env.BLOCK_EXPLORER_API_KEY
  },
  sourcify: { enabled: false }
};
