// hardhat.config.cjs
// Must be .cjs because package.json has "type": "module"
require('dotenv').config({ path: '.env.local' });

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      }
    }
  },
  networks: {
    hardhat: {
      chainId: 1337,
      forking: {
        url: `https://arb-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
      },
      // Cancun is the default in Hardhat 2.22+, but being explicit
      hardfork: "cancun",
      // Original test mnemonic (same as fum_library) for deterministic addresses
      accounts: {
        mnemonic: "debris coral coral sleep shed prison nation mountain fatigue prosper dose portion",
        count: 10,
        accountsBalance: "10000000000000000000000" // 10000 ETH
      },
      mining: {
        auto: true,
        interval: 0
      }
    },
    // For deploying to actual Arbitrum
    arbitrum: {
      url: `https://arb-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
      chainId: 42161,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : []
    }
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts"
  }
};
