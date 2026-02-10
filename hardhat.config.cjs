// hardhat.config.cjs
// Must be .cjs because package.json has "type": "module"
require('dotenv').config({ path: '.env.local' });

// Determine fork chain from environment variable
const forkChain = process.env.FORK_CHAIN || 'arbitrum';
const isAvalanche = forkChain === 'avalanche';

// Dynamic fork configuration based on FORK_CHAIN
const forkConfig = isAvalanche
  ? {
      chainId: 1338,
      url: `https://avax-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
    }
  : {
      chainId: 1337,
      url: `https://arb-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
    };

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
      chainId: forkConfig.chainId,
      forking: {
        url: forkConfig.url,
        // Optionally pin to a block for consistent testing:
        // blockNumber: 280000000
      },
      // Cancun is the default in Hardhat 2.22+, but being explicit
      hardfork: "cancun",
      // Original test mnemonic (same as previous Ganache config) for deterministic addresses
      accounts: {
        mnemonic: "debris coral coral sleep shed prison nation mountain fatigue prosper dose portion",
        count: 10,
        accountsBalance: "10000000000000000000000" // 10000 ETH/AVAX
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
    },
    // Avalanche Hardhat Fork (uses port 8546 to avoid conflict with Arbitrum on 8545)
    avalanche: {
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
