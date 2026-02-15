# Adding Support for New DeFi Platforms

This document explains how to add support for new DeFi platforms (like SushiSwap, PancakeSwap, etc.) to the Liquidity Dashboard using the Adapter Pattern.

## Overview

The application uses the Adapter Pattern to support multiple liquidity providers through a consistent interface. Adding a new platform involves:

1. Creating a new adapter class that implements the platform-specific logic
2. Registering the adapter in the factory
3. Adding the platform to the configuration

## Step-by-Step Guide

### 1. Create a New Adapter

Create a new file in `src/adapters` named after your platform (e.g., `SushiswapAdapter.js`):

```javascript
// src/adapters/SushiswapAdapter.js
import PlatformAdapter from "./PlatformAdapter";
import { ethers } from "ethers";
// Import any platform-specific ABIs and SDKs here

export default class SushiswapAdapter extends PlatformAdapter {
  // Define platform-specific properties
  platformId = "sushiswap";
  platformName = "SushiSwap";

  constructor(config, provider) {
    super(config, provider);
  }

  async getPositions(address, chainId) {
    // Implement the logic to fetch positions from SushiSwap
    // Return the same shape of data as other adapters:
    // { positions: [], poolData: {}, tokenData: {} }
  }

  async calculateFees(position, poolData, token0Data, token1Data) {
    // Implement fee calculation logic for SushiSwap positions
  }

  async claimFees(params) {
    // Implement fee claiming logic for SushiSwap positions
  }

  isPositionInRange(position, poolData) {
    // Implement range checking logic for SushiSwap positions
  }

  calculatePrice(position, poolData, token0Data, token1Data, invert = false) {
    // Implement price calculation logic for SushiSwap positions
  }
}
```

### 2. Register the Adapter in the Factory

Update `src/adapters/AdapterFactory.js` to include your new adapter:

```javascript
import SushiswapAdapter from "./SushiswapAdapter";

// Map of platform IDs to adapter classes
const PLATFORM_ADAPTERS = {
  uniswapV3: UniswapV3Adapter,
  sushiswap: SushiswapAdapter, // Add your new adapter here
};
```

### 3. Update the Configuration

Update `src/utils/config.js` to include the new platform for each supported chain:

```javascript
const config = {
  chains: {
    42161: {
      // ...existing config
      platforms: {
        uniswapV3: {
          // ...existing Uniswap config
        },
        sushiswap: {
          id: "sushiswap",
          name: "SushiSwap",
          factoryAddress: "0xc35DADB65012eC5796536bD9864eD8773aBc74C4", // Address for Arbitrum
          positionManagerAddress: "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f", // Router address
          enabled: true,
        },
      },
    },
    // Update other chains as needed
  },

  // Add platform metadata
  platformMetadata: {
    // ...existing platforms
    sushiswap: {
      id: "sushiswap",
      name: "SushiSwap",
      logo: "/logos/sushiswap.svg", // Add logo if available
      color: "#0E0F23", // SushiSwap color
      description: "SushiSwap liquidity positions",
    },
  }
};
```

### 4. Add Platform-Specific Assets

If your platform has a logo, add it to the `/public/logos/` directory.

### 5. Test Your Implementation

Test your implementation by:

1. Connecting to a chain where your platform is supported
2. Ensuring positions from your platform are displayed correctly
3. Verifying that platform-specific operations (fee calculation, claiming, etc.) work correctly

## Platform-Specific Considerations

Different platforms may have different ways of handling:

- Position structure and identification
- Fee calculations
- Price representation
- Pool structures

Your adapter should abstract these differences away and provide a consistent interface to the application.

## Example: Differences Between Platforms

| Feature | Uniswap V3 | SushiSwap |
|---------|------------|-----------|
| Position Representation | NFT positions with ticks | Traditional liquidity pool shares |
| Fee Structure | Per-position fee tier | Pool-wide fee percentage |
| Price Calculation | Based on sqrt price and ticks | Based on reserves |

Your adapter needs to handle these differences while providing a consistent API to the application.
