// hardhat.avalanche.config.cjs
// Avalanche-specific Hardhat config - used when FORK_CHAIN=avalanche
require('dotenv').config({ path: 'test/.env.test' });

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
      chainId: 1338,
      forking: {
        url: `https://avax-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
      },
      hardfork: "cancun",
      accounts: {
        mnemonic: "debris coral coral sleep shed prison nation mountain fatigue prosper dose portion",
        count: 10,
        accountsBalance: "10000000000000000000000" // 10000 AVAX
      },
      mining: {
        auto: true,
        interval: 0
      }
    }
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts"
  }
};
