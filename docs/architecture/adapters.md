# Adapters Architecture

## Overview

The adapter module implements the **Adapter Pattern** to provide a unified interface for interacting with different DeFi protocols. Each protocol has its own adapter that translates the common interface into protocol-specific calls.

## Design Pattern

### Abstract Base Class Pattern

```javascript
// Abstract base class defines the contract
export default class PlatformAdapter {
  // Common interface methods that all adapters must implement
  async getPositions(address, chainId) { throw new Error("Must implement"); }
  async calculateFees(position, poolData) { throw new Error("Must implement"); }
  // ... more methods
}

// Concrete implementation for specific protocol
export default class UniswapV3Adapter extends PlatformAdapter {
  async getPositions(address, chainId) {
    // Uniswap V3 specific implementation
  }
}
```

### Factory Pattern

```javascript
class AdapterFactory {
  static #PLATFORM_ADAPTERS = {
    uniswapV3: UniswapV3Adapter,
    // sushiswap: SushiswapAdapter,  // Future
    // aave: AaveAdapter,            // Future
  };
  
  static getAdapter(platformId, provider) {
    const AdapterClass = this.#PLATFORM_ADAPTERS[platformId];
    return new AdapterClass(config, provider);
  }
}
```

## Adapter Interface

### Required Methods

Every adapter must implement these core methods:

#### Pool and Position Discovery
```javascript
// Get pool address for token pair
async getPoolAddress(token0, token1, fee)

// Check if pool exists and get basic info
async checkPoolExists(token0, token1, fee)

// Get all user positions for the protocol
async getPositions(address, chainId)
```

#### Position Analysis
```javascript
// Check if position is currently in range
isPositionInRange(position, poolData)

// Calculate current price information
calculatePrice(position, poolData, token0Data, token1Data, invert)

// Calculate token amounts if position were closed
async calculateTokenAmounts(position, poolData, token0Data, token1Data, chainId)

// Calculate uncollected fees
async calculateFees(position, poolData, token0Data, token1Data)
```

#### Transaction Generation
```javascript
// Generate transaction data for claiming fees
async generateClaimFeesData(params)

// Generate transaction data for removing liquidity
async generateRemoveLiquidityData(params)

// Generate transaction data for adding liquidity
async generateAddLiquidityData(params)

// Generate transaction data for creating new position
async generateCreatePositionData(params)

// Generate transaction data for token swaps
async generateSwapData(params)
```

#### Transaction Execution
```javascript
// Execute fee claim transaction
async claimFees(params)

// Execute liquidity removal transaction
async decreaseLiquidity(params)

// Execute position closure transaction
async closePosition(params)

// Execute liquidity addition transaction
async addLiquidity(params)

// Execute position creation transaction
async createPosition(params)
```

### Data Structures

#### Standard Position Object
```javascript
{
  id: "12345",                    // Position NFT ID
  poolAddress: "0x...",          // Pool contract address
  token0: "0x...",               // Token0 address
  token1: "0x...",               // Token1 address
  fee: 3000,                     // Fee tier in basis points
  tickLower: -276324,            // Lower tick
  tickUpper: -276200,            // Upper tick
  liquidity: "1234567890",       // Position liquidity
  tokensOwed0: "0",              // Owed token0 amount
  tokensOwed1: "0",              // Owed token1 amount
  feeGrowthInside0LastX128: "0", // Fee growth tracking
  feeGrowthInside1LastX128: "0"  // Fee growth tracking
}
```

#### Standard Pool Data Object
```javascript
{
  address: "0x...",              // Pool address
  token0: "0x...",               // Token0 address
  token1: "0x...",               // Token1 address
  fee: 3000,                     // Fee tier
  tick: -276250,                 // Current tick
  sqrtPriceX96: "1234567890",    // Current price
  liquidity: "9876543210",       // Total liquidity
  feeGrowthGlobal0X128: "0",     // Global fee growth token0
  feeGrowthGlobal1X128: "0",     // Global fee growth token1
  ticks: {                       // Tick data for fee calculations
    "-276324": { /* tick data */ },
    "-276200": { /* tick data */ }
  }
}
```

## Uniswap V3 Adapter Implementation

### Architecture Decisions

#### Price Calculation Strategy
**Challenge**: Uniswap V3 uses `sqrtPriceX96` format which is complex to work with
**Solution**: Private helper methods for price conversions
```javascript
_calculatePriceFromSqrtPrice(sqrtPriceX96, decimals0, decimals1, invert)
_tickToPrice(tick, decimals0, decimals1, invert)
```

#### Fee Calculation Strategy
**Challenge**: Uncollected fees require complex calculations involving tick data
**Solution**: Separate calculation method with detailed parameter passing
```javascript
_calculateUncollectedFees({
  position, currentTick, feeGrowthGlobal0X128, feeGrowthGlobal1X128,
  tickLower, tickUpper, token0, token1
})
```

#### Transaction Data Strategy
**Challenge**: Different operations require different contract interactions
**Solution**: Separate methods for each operation type with consistent parameter patterns
```javascript
// Pattern: generate* methods return transaction data
// Pattern: execute* methods send transactions
async generateClaimFeesData(params) { /* returns { to, data, value } */ }
async claimFees(params) { /* executes transaction */ }
```

### External Dependencies

#### Uniswap SDK Integration
```javascript
// Uses official Uniswap SDK for accuracy
import { Position, Pool, NonfungiblePositionManager } from '@uniswap/v3-sdk';
import { Percent, Token, CurrencyAmount } from '@uniswap/sdk-core';

// Benefits:
// - Accurate calculations matching Uniswap frontend
// - Maintained by Uniswap team
// - Well-tested in production
```

#### Contract ABI Management
```javascript
// Imports ABIs from official packages
import NonfungiblePositionManagerARTIFACT from '@uniswap/v3-periphery/artifacts/...';
import IUniswapV3PoolARTIFACT from '@uniswap/v3-core/artifacts/...';

// Benefits:
// - Always up-to-date with protocol changes
// - No need to maintain ABI files separately
// - Type safety for contract calls
```

## Adding New Protocol Adapters

### Step-by-Step Process

#### 1. Create Adapter Class
```javascript
// src/adapters/SushiswapAdapter.js
import PlatformAdapter from './PlatformAdapter.js';

export default class SushiswapAdapter extends PlatformAdapter {
  constructor(config, provider) {
    super(config, provider, "sushiswap", "Sushiswap");
  }
  
  // Implement all required methods...
}
```

#### 2. Register with Factory
```javascript
// src/adapters/AdapterFactory.js
import SushiswapAdapter from './SushiswapAdapter.js';

static #PLATFORM_ADAPTERS = {
  uniswapV3: UniswapV3Adapter,
  sushiswap: SushiswapAdapter,  // Add new adapter
};
```

#### 3. Add Platform Configuration
```javascript
// src/configs/platforms.js
export const platforms = {
  sushiswap: {
    name: "Sushiswap",
    color: "#0993EC",
    logo: "/logos/sushiswap.svg",
    // ... other metadata
  }
};
```

#### 4. Add Chain Configurations
```javascript
// src/configs/chains.js
export const chains = {
  1: { // Ethereum
    platformAddresses: {
      uniswapV3: { /* existing */ },
      sushiswap: {
        factoryAddress: "0x...",
        routerAddress: "0x...",
        // ... protocol addresses
      }
    }
  }
};
```

### Testing New Adapters

#### Unit Tests
```javascript
// tests/adapters/SushiswapAdapter.test.js
describe('SushiswapAdapter', () => {
  it('should implement all required methods', () => {
    const adapter = new SushiswapAdapter(mockConfig, mockProvider);
    
    // Verify all abstract methods are implemented
    expect(typeof adapter.getPositions).toBe('function');
    expect(typeof adapter.calculateFees).toBe('function');
    // ... test all methods
  });
});
```

#### Integration Tests
```javascript
it('should fetch real positions from testnet', async () => {
  const adapter = new SushiswapAdapter(testConfig, testProvider);
  const positions = await adapter.getPositions(testAddress, testChainId);
  
  expect(positions).toHaveProperty('positions');
  expect(positions).toHaveProperty('poolData');
  expect(positions).toHaveProperty('tokenData');
});
```

## Error Handling Patterns

### Graceful Degradation
```javascript
async getPositions(address, chainId) {
  try {
    const positions = await this.fetchPositions(address);
    const poolData = await this.fetchPoolData(positions);
    return { positions, poolData, hasPartialData: false };
  } catch (error) {
    console.error('Error fetching positions:', error);
    return { positions: [], poolData: {}, hasPartialData: true };
  }
}
```

### Error Context Preservation
```javascript
catch (error) {
  throw new Error(`Failed to calculate fees for position ${position.id}: ${error.message}`);
}
```

### Validation Patterns
```javascript
async generateSwapData(params) {
  // Input validation
  if (!params.tokenIn || !params.tokenOut) {
    throw new Error("Token addresses required");
  }
  
  if (params.amountIn <= 0) {
    throw new Error("Amount must be positive");
  }
  
  // ... continue with implementation
}
```

## Performance Optimization

### Parallel Data Fetching
```javascript
async getPositions(address, chainId) {
  // Fetch position IDs first
  const positionIds = await this.getPositionIds(address);
  
  // Fetch all position details in parallel
  const positionPromises = positionIds.map(id => 
    this.getPositionDetails(id)
  );
  const positions = await Promise.all(positionPromises);
  
  // Process results...
}
```

### Caching Strategies
```javascript
// Cache expensive calculations at adapter level
const poolDataCache = new Map();

async getPoolData(poolAddress) {
  if (poolDataCache.has(poolAddress)) {
    return poolDataCache.get(poolAddress);
  }
  
  const poolData = await this.fetchPoolData(poolAddress);
  poolDataCache.set(poolAddress, poolData);
  return poolData;
}
```

### Memory Management
```javascript
// Clean up large objects after processing
async processPositions(positions) {
  const results = [];
  
  for (const position of positions) {
    const processed = await this.processPosition(position);
    results.push(processed);
    
    // Clear intermediate data to free memory
    delete position.rawData;
  }
  
  return results;
}
```

## Future Extensibility

### Plugin Architecture
Future consideration for dynamic adapter loading:
```javascript
// Potential future enhancement
class AdapterRegistry {
  static async loadAdapter(platformId) {
    const module = await import(`./adapters/${platformId}Adapter.js`);
    return module.default;
  }
}
```

### Cross-Protocol Operations
Adapters designed to support future cross-protocol features:
```javascript
// Future: Cross-protocol arbitrage
async generateArbitrageData(fromProtocol, toProtocol, token, amount) {
  const fromAdapter = AdapterFactory.getAdapter(fromProtocol, provider);
  const toAdapter = AdapterFactory.getAdapter(toProtocol, provider);
  
  // Coordinate between adapters for complex operations
}
```