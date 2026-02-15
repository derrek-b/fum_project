# Platform Adapter API

Abstract base class for DeFi platform adapters that provides a standardized interface for interacting with various decentralized exchanges.

## Overview

The `PlatformAdapter` class serves as the foundation for all platform-specific implementations in the FUM Library. Each DeFi platform (Uniswap V3, Sushiswap, etc.) extends this class and implements the required abstract methods to provide platform-specific functionality.

## Class Hierarchy

```
PlatformAdapter (abstract)
└── UniswapV3Adapter
└── [Future adapters...]
```

## Constructor

### Signature
```javascript
constructor(chainId: number, platformId: string, platformName: string)
```

### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| chainId | `number` | Yes | Chain ID for the adapter |
| platformId | `string` | Yes | Unique platform identifier |
| platformName | `string` | Yes | Human-readable platform name |

### Throws

| Error | Condition |
|-------|-----------|
| `Error` | When trying to instantiate the abstract class directly |
| `Error` | When chainId is not a valid number |
| `Error` | When platformId is not defined |
| `Error` | When platformName is not defined |

### Example

```javascript
// Cannot instantiate directly - this will throw
const adapter = new PlatformAdapter(42161, "uniswap", "Uniswap V3"); // ❌

// Must use a concrete implementation
import UniswapV3Adapter from './UniswapV3Adapter.js';
const adapter = new UniswapV3Adapter(42161); // ✅ Arbitrum
```

## Abstract Methods

All methods below must be implemented by subclasses.

---

### getPoolAddress

Retrieves the pool address for a given token pair and fee tier.

#### Signature
```javascript
async getPoolAddress(token0: Object, token1: Object, fee: number): Promise<{poolAddress: string, token0: Object, token1: Object}>
```

#### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| token0 | `Object` | Yes | First token details |
| token0.address | `string` | Yes | Token contract address |
| token0.decimals | `number` | Yes | Token decimals |
| token0.symbol | `string` | Yes | Token symbol |
| token0.name | `string` | Yes | Token name |
| token1 | `Object` | Yes | Second token details |
| token1.address | `string` | Yes | Token contract address |
| token1.decimals | `number` | Yes | Token decimals |
| token1.symbol | `string` | Yes | Token symbol |
| token1.name | `string` | Yes | Token name |
| fee | `number` | Yes | Fee tier (e.g., 3000 for 0.3%) |

#### Returns

`Promise<Object>` - Pool information with sorted tokens:

| Field | Type | Description |
|-------|------|-------------|
| poolAddress | `string` | The pool contract address |
| token0 | `Object` | The lower-addressed token (sorted) |
| token1 | `Object` | The higher-addressed token (sorted) |

---

### getPoolABI

Returns the ABI for pool contracts on this platform.

#### Signature
```javascript
async getPoolABI(): Promise<Array>
```

#### Returns

`Promise<Array>` - The pool contract ABI

---

### getPositionManagerABI

Returns the ABI for the position manager contract.

#### Signature
```javascript
getPositionManagerABI(): Array
```

#### Returns

`Array` - The position manager contract ABI

---

### checkPoolExists

Verifies if a pool exists for the given token pair and fee tier.

#### Signature
```javascript
async checkPoolExists(token0: Object, token1: Object, fee: number): Promise<{exists: boolean, poolAddress: string|null, slot0: Object|null}>
```

#### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| token0 | `Object` | Yes | First token details |
| token0.address | `string` | Yes | Token contract address |
| token0.decimals | `number` | Yes | Token decimals |
| token1 | `Object` | Yes | Second token details |
| token1.address | `string` | Yes | Token contract address |
| token1.decimals | `number` | Yes | Token decimals |
| fee | `number` | Yes | Fee tier |

#### Returns

`Promise<Object>` - Pool existence check result:

| Field | Type | Description |
|-------|------|-------------|
| exists | `boolean` | Whether the pool exists |
| poolAddress | `string\|null` | Pool address if exists |
| slot0 | `Object\|null` | Current pool state if exists |

---

### getPositions

Retrieves all positions for a specific user address.

#### Signature
```javascript
async getPositions(address: string, chainId: number): Promise<{positions: Array, poolData: Object, tokenData: Object}>
```

#### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| address | `string` | Yes | User's wallet address |
| chainId | `number` | Yes | Chain ID |

#### Returns

`Promise<Object>` - Position data:

| Field | Type | Description |
|-------|------|-------------|
| positions | `Array` | Array of position objects |
| poolData | `Object` | Pool information keyed by pool address |
| tokenData | `Object` | Token information keyed by token address |

---

### calculateUnclaimedFees

Calculates uncollected fees for a specific position.

#### Signature
```javascript
async calculateUnclaimedFees(position: Object): Promise<{token0Fees: BigInt, token1Fees: BigInt}>
```

#### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| position | `Object` | Yes | Position object with tokenId and pool information |

#### Returns

`Promise<Object>` - Unclaimed fee amounts:

| Field | Type | Description |
|-------|------|-------------|
| token0Fees | `BigInt` | Unclaimed fees in token0 |
| token1Fees | `BigInt` | Unclaimed fees in token1 |

---

### getPoolData

Retrieves current state and information for a specific pool.

#### Signature
```javascript
async getPoolData(poolAddress: string): Promise<Object>
```

#### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| poolAddress | `string` | Yes | Pool contract address |

#### Returns

`Promise<Object>` - Current pool data including liquidity, price, and state

---

### calculatePositionValue

Calculates the current value of a liquidity position.

#### Signature
```javascript
async calculatePositionValue(position: Object, poolData: Object, tokenPrices: Object): Promise<{totalValue: number, token0Value: BigInt, token1Value: BigInt, token0USD: number, token1USD: number}>
```

#### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| position | `Object` | Yes | Position object |
| poolData | `Object` | Yes | Current pool data |
| tokenPrices | `Object` | Yes | Token prices in USD |

#### Returns

`Promise<Object>` - Position value breakdown:

| Field | Type | Description |
|-------|------|-------------|
| totalValue | `number` | Total USD value |
| token0Value | `BigInt` | Token0 amount |
| token1Value | `BigInt` | Token1 amount |
| token0USD | `number` | Token0 value in USD |
| token1USD | `number` | Token1 value in USD |

---

### prepareAddLiquidityTx

Prepares a transaction for adding liquidity to a pool.

#### Signature
```javascript
async prepareAddLiquidityTx(params: Object): Promise<Object>
```

#### Parameters

Complex parameter object - see implementation for details.

#### Returns

`Promise<Object>` - Prepared transaction object

---

### prepareRemoveLiquidityTx

Prepares a transaction for removing liquidity from a pool.

#### Signature
```javascript
async prepareRemoveLiquidityTx(params: Object): Promise<Object>
```

#### Parameters

Complex parameter object - see implementation for details.

#### Returns

`Promise<Object>` - Prepared transaction object

---

### prepareCollectFeesTx

Prepares a transaction for collecting fees from a position.

#### Signature
```javascript
async prepareCollectFeesTx(params: Object): Promise<Object>
```

#### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| params | `Object` | Yes | Collection parameters |
| params.tokenId | `number` | Yes | NFT position token ID |
| params.recipient | `string` | Yes | Address to receive fees |

#### Returns

`Promise<Object>` - Prepared transaction object

---

### prepareSwapTx

Prepares a transaction for token swapping.

#### Signature
```javascript
async prepareSwapTx(params: Object): Promise<Object>
```

#### Parameters

Complex parameter object - see implementation for details.

#### Returns

`Promise<Object>` - Prepared transaction object

---

### getQuote

Gets a price quote for a token swap.

#### Signature
```javascript
async getQuote(params: Object): Promise<Object>
```

#### Parameters

Complex parameter object - see implementation for details.

#### Returns

`Promise<Object>` - Quote information including expected output and price impact

## Implementation Example

```javascript
import PlatformAdapter from './PlatformAdapter.js';

class MyDEXAdapter extends PlatformAdapter {
  constructor(chainId) {
    super(chainId, 'mydex', 'My DEX');
    // Cache platform configuration data
    this.addresses = getPlatformAddresses(chainId, 'mydex');
    // Additional initialization
  }

  async getPoolAddress(token0, token1, fee) {
    // Implementation specific to My DEX
    // Must handle token sorting
    return {
      poolAddress: computedAddress,
      token0: sortedToken0,
      token1: sortedToken1
    };
  }

  // Implement all other abstract methods...
}
```

## Best Practices

1. **Token Sorting**: Always ensure tokens are properly sorted by address
2. **Error Handling**: Implement comprehensive error handling for network failures
3. **Gas Estimation**: Provide accurate gas estimates for transactions
4. **State Validation**: Validate pool and position states before operations

## See Also

- [`UniswapV3Adapter`](./uniswap-v3-adapter.md) - Concrete implementation for Uniswap V3
- [`AdapterFactory`](./adapter-factory.md) - Factory for creating platform adapters
- [Platform Helpers](../helpers/platform-helpers.md) - Utility functions for platform operations