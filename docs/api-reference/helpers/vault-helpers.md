# Vault Helpers API

Vault data management utilities for fetching vault information, calculating TVL, and managing strategy parameters.

## Overview

The Vault Helpers module provides comprehensive vault management functionality including position tracking, balance calculations, and strategy integration. It handles complex operations like TVL calculations, strategy parameter mapping, and multi-protocol position aggregation.

## Functions

---

## mapStrategyParameters

Map raw strategy parameters from contract to human-readable format.

### Signature
```javascript
mapStrategyParameters(strategyId: string, params: Array): Object
```

### Parameters

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| strategyId | `string` | Yes | - | Strategy ID (e.g., 'bob', 'parris', 'fed') |
| params | `Array` | Yes | - | Raw parameters array from contract getAllParameters call |

### Returns

`Object` - Named parameters with human-readable values

### Strategy-Specific Mappings

#### Bob Strategy
```javascript
{
  targetRangeUpper: number,        // Basis points to percent
  targetRangeLower: number,        // Basis points to percent
  rebalanceThresholdUpper: number, // Basis points to percent
  rebalanceThresholdLower: number, // Basis points to percent
  feeReinvestment: boolean,        
  reinvestmentTrigger: string,     // Formatted to 2 decimals
  reinvestmentRatio: number,       // Basis points to percent
  maxSlippage: number,             // Basis points to percent
  emergencyExitTrigger: number,    // Basis points to percent
  maxUtilization: number           // Basis points to percent
}
```

#### Parris Strategy
Includes all Bob parameters plus:
```javascript
{
  // ... Bob parameters ...
  adaptiveRanges: boolean,
  rebalanceCountThresholdHigh: number,
  rebalanceCountThresholdLow: number,
  adaptiveTimeframeHigh: number,
  adaptiveTimeframeLow: number,
  rangeAdjustmentPercentHigh: number,
  thresholdAdjustmentPercentHigh: number,
  rangeAdjustmentPercentLow: number,
  thresholdAdjustmentPercentLow: number,
  oracleSource: number,
  priceDeviationTolerance: number,
  maxPositionSizePercent: number,
  minPositionSize: string,
  targetUtilization: number,
  platformSelectionCriteria: number,
  minPoolLiquidity: string
}
```

### Examples

```javascript
// Map Bob strategy parameters from contract
const rawParams = [10200, 9800, 200, 200, true, 10000, 8000, 50, 100, 9500];
const mapped = mapStrategyParameters('bob', rawParams);
// Returns: {
//   targetRangeUpper: 102,
//   targetRangeLower: 98,
//   rebalanceThresholdUpper: 2,
//   rebalanceThresholdLower: 2,
//   feeReinvestment: true,
//   reinvestmentTrigger: "100.00",
//   reinvestmentRatio: 80,
//   maxSlippage: 0.5,
//   emergencyExitTrigger: 1,
//   maxUtilization: 95
// }
```

### Side Effects
None - Pure function

### Error Handling
Returns empty object `{}` if strategy is unknown or if mapping fails

---

## fetchStrategyParameters

Fetch and map parameter values from a strategy contract.

### Signature
```javascript
fetchStrategyParameters(strategyAddress: string, strategyId: string, vaultAddress: string, provider: Object): Promise<Object | null>
```

### Parameters

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| strategyAddress | `string` | Yes | - | The strategy contract address |
| strategyId | `string` | Yes | - | Strategy ID (e.g., "parris", "fed") |
| vaultAddress | `string` | Yes | - | The vault address |
| provider | `Object` | Yes | - | Ethers provider instance |

### Returns

`Promise<Object | null>` - Strategy parameters and metadata including selectedTemplate, parameters - null on error

### Return Object Structure
```javascript
{
  selectedTemplate: string,      // Template ID (e.g., 'conservative', 'custom')
  templateEnum: string,          // Contract enum value
  customizationBitmap: string,   // Bitmap indicating customized parameters
  parameters: Object             // Mapped parameter values
}
```

### Examples

```javascript
// Fetch strategy parameters for a vault
const params = await fetchStrategyParameters(
  '0xStrategyAddress',
  'bob',
  '0xVaultAddress',
  provider
);
// Returns: {
//   selectedTemplate: 'conservative',
//   templateEnum: '0',
//   customizationBitmap: '0',
//   parameters: { targetRangeUpper: 105, ... }
// }
```

### Side Effects
- Makes RPC calls to strategy contract

### Error Handling
- Returns null if contract ABI not found
- Logs warnings for missing template mappings
- Logs errors for contract interaction failures

---

## getVaultStrategies

Get available strategy configurations for a chain.

### Signature
```javascript
getVaultStrategies(provider: Object, chainId: number): Promise<Object>
```

### Parameters

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| provider | `Object` | Yes | - | Ethers provider instance |
| chainId | `number` | Yes | - | Chain ID to get strategies for |

### Returns

`Promise<Object>` - Result object with success flag, strategies array, and address mapping

### Return Object Structure
```javascript
{
  success: boolean,
  strategies: Array<{
    id: string,
    name: string,
    subtitle: string,
    description: string,
    contractKey: string,
    addresses: Object,           // Chain ID to address mapping
    supportsTemplates: boolean,
    templateEnumMap: Object,
    hasGetAllParameters: boolean,
    parameters: Array
  }>,
  addressToStrategyMap: Object   // Lowercase address to strategy info mapping
}
```

### Examples

```javascript
// Load strategies for Ethereum mainnet
const result = await getVaultStrategies(provider, 1);
if (result.success) {
  console.log('Available strategies:', result.strategies);
  // Use addressToStrategyMap to identify strategies by contract address
  const strategyInfo = result.addressToStrategyMap['0xstrategy...'.toLowerCase()];
}
```

### Side Effects
None - Reads from configuration

---

## getVaultBasicInfo

Load basic vault information and contract details.

### Signature
```javascript
getVaultBasicInfo(vaultAddress: string, provider: Object, addressToStrategyMap?: Object): Promise<Object>
```

### Parameters

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| vaultAddress | `string` | Yes | - | The vault address to query |
| provider | `Object` | Yes | - | Ethers provider instance |
| addressToStrategyMap | `Object` | No | `{}` | Map of strategy addresses to strategy IDs |

### Returns

`Promise<Object>` - Result object with success flag and vault data

### Return Object Structure
```javascript
{
  success: boolean,
  vaultData: {
    address: string,
    name: string,
    symbol: string,
    executor: string | null,
    strategyAddress: string | null,
    hasActiveStrategy: boolean,
    strategy: {                    // Only if strategy is active
      strategyId: string,
      strategyAddress: string,
      isActive: boolean,
      selectedTokens: Array<string>,
      selectedPlatforms: Array<string>,
      parameters: Object,
      activeTemplate: string,
      lastUpdated: number
    } | null,
    positions: Array               // Initialize empty
  }
}
```

### Examples

```javascript
// Get basic vault information
const result = await getVaultBasicInfo('0xVaultAddress', provider);
if (result.success) {
  console.log('Vault name:', result.vaultData.name);
  console.log('Has strategy:', result.vaultData.hasActiveStrategy);
  
  if (result.vaultData.strategy) {
    console.log('Strategy ID:', result.vaultData.strategy.strategyId);
    console.log('Active template:', result.vaultData.strategy.activeTemplate);
  }
}
```

### Side Effects
- Makes RPC calls to vault and strategy contracts

---

## getVaultTokenBalances

Load token balances for a vault.

### Signature
```javascript
getVaultTokenBalances(vaultAddress: string, provider: Object, chainId: number): Promise<Object>
```

### Parameters

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| vaultAddress | `string` | Yes | - | The vault address to check balances for |
| provider | `Object` | Yes | - | Ethers provider instance |
| chainId | `number` | Yes | - | Chain ID for token lookups |

### Returns

`Promise<Object>` - Result object with token balances and total value

### Return Object Structure
```javascript
{
  success: boolean,
  vaultTokens: Array<{
    symbol: string,
    name: string,
    address: string,
    balance: string,            // Formatted balance
    numericalBalance: number,   // Parsed balance
    valueUsd: number,          // USD value
    decimals: number,
    logoURI: string
  }>,
  totalTokenValue: number,      // Sum of all token USD values
  tokenPricesLoaded: boolean,
  tokenBalancesMap: Object      // Token data keyed by symbol
}
```

### Examples

```javascript
// Get vault token balances
const result = await getVaultTokenBalances('0xVault', provider, 1);
if (result.success) {
  console.log('Total value:', result.totalTokenValue);
  console.log('Tokens:', result.vaultTokens);
  // Each token has: symbol, balance, numericalBalance, valueUsd
  
  // Access specific token
  const usdcBalance = result.tokenBalancesMap['USDC'];
}
```

### Side Effects
- Makes RPC calls for token balances
- Prefetches token prices from CoinGecko

### Important Notes

⚠️ **Note**: Only returns tokens with non-zero balances

---

## getVaultPositions

Load positions for a vault from all adapters.

### Signature
```javascript
getVaultPositions(vaultAddress: string, provider: Object, chainId: number): Promise<Object>
```

### Parameters

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| vaultAddress | `string` | Yes | - | The vault address to get positions for |
| provider | `Object` | Yes | - | Ethers provider instance |
| chainId | `number` | Yes | - | Chain ID to query positions on |

### Returns

`Promise<Object>` - Result object with positions array and related data

### Return Object Structure
```javascript
{
  success: boolean,
  positions: Array<{
    id: string,
    platform: string,
    poolAddress: string,
    inVault: boolean,           // Always true for vault positions
    vaultAddress: string,
    // ... position-specific fields
  }>,
  positionIds: Array<string>,   // Just the IDs
  poolData: Object,             // Pool information keyed by address
  tokenData: Object             // Token information keyed by address
}
```

### Examples

```javascript
// Get all positions held by a vault
const result = await getVaultPositions('0xVault', provider, 1);
if (result.success) {
  console.log('Position count:', result.positions.length);
  console.log('Position IDs:', result.positionIds);
  
  // Process positions by platform
  const byPlatform = result.positions.reduce((acc, pos) => {
    if (!acc[pos.platform]) acc[pos.platform] = [];
    acc[pos.platform].push(pos);
    return acc;
  }, {});
}
```

### Side Effects
- Makes RPC calls through platform adapters

---

## calculatePositionsTVL

Calculate Total Value Locked (TVL) for positions.

### Signature
```javascript
calculatePositionsTVL(positions: Array<Object>, poolData: Object, tokenData: Object, provider: Object, chainId: number): Promise<Object>
```

### Parameters

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| positions | `Array<Object>` | Yes | - | Array of position objects from adapters |
| poolData | `Object` | Yes | - | Pool data keyed by pool address |
| tokenData | `Object` | Yes | - | Token data keyed by token address |
| provider | `Object` | Yes | - | Ethers provider instance |
| chainId | `number` | Yes | - | Chain ID for calculations |

### Returns

`Promise<{positionTVL: number, hasPartialData: boolean}>` - TVL in USD and data completeness flag

### Examples

```javascript
// Calculate TVL for vault positions
const { positionTVL, hasPartialData } = await calculatePositionsTVL(
  positions,
  poolData,
  tokenData,
  provider,
  1
);

console.log(`TVL: $${positionTVL.toFixed(2)}`);
if (hasPartialData) {
  console.warn('Some price data was unavailable');
}
```

### Process Flow

1. Validates position data and pool/token information
2. Prefetches all required token prices
3. Uses platform adapters to calculate token amounts
4. Converts token amounts to USD values
5. Sums all position values

### Side Effects
- Prefetches token prices from CoinGecko
- Uses platform adapters for position calculations

---

## getVaultData

Main function to get complete vault data including positions and balances.

### Signature
```javascript
getVaultData(vaultAddress: string, provider: Object, chainId: number): Promise<Object>
```

### Parameters

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| vaultAddress | `string` | Yes | - | The vault address to query |
| provider | `Object` | Yes | - | Ethers provider instance |
| chainId | `number` | Yes | - | Chain ID for the vault |

### Returns

`Promise<Object>` - Complete vault data including info, positions, tokens, and TVL

### Return Object Structure
```javascript
{
  success: boolean,
  vault: {
    // ... all vault basic info fields ...
    metrics: {
      tvl: number,               // Position TVL
      tokenTVL: number,          // Token balance TVL
      hasPartialData: boolean,   // Data quality flag
      positionCount: number,
      lastTVLUpdate: number      // Timestamp
    }
  },
  positions: Array,              // Full position objects
  vaultTokens: Array,            // Token balances
  totalTokenValue: number,       // Token TVL
  poolData: Object,              // Pool metadata
  tokenData: Object              // Token metadata
}
```

### Examples

```javascript
// Get complete vault data
const vaultData = await getVaultData('0xVault', provider, 1);
if (vaultData.success) {
  console.log('Vault name:', vaultData.vault.name);
  console.log('Position TVL:', vaultData.vault.metrics.tvl);
  console.log('Token TVL:', vaultData.vault.metrics.tokenTVL);
  console.log('Total TVL:', vaultData.vault.metrics.tvl + vaultData.vault.metrics.tokenTVL);
  
  // Process positions
  vaultData.positions.forEach(position => {
    console.log(`Position ${position.id} on ${position.platform}`);
  });
}
```

### Process Flow

1. Loads available strategies
2. Fetches basic vault info and strategy configuration
3. Loads token balances with prices
4. Loads all positions from adapters
5. Calculates position TVL
6. Aggregates all metrics

### Side Effects
- Multiple RPC calls for vault, strategy, token, and position data
- Price data fetching from external APIs

---

## getAllUserVaultData

Get all user vaults with full data and aggregate positions.

### Signature
```javascript
getAllUserVaultData(userAddress: string, provider: Object, chainId: number): Promise<Object>
```

### Parameters

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| userAddress | `string` | Yes | - | The user's wallet address |
| provider | `Object` | Yes | - | Ethers provider instance |
| chainId | `number` | Yes | - | Chain ID to query |

### Returns

`Promise<Object>` - All user vaults and positions (both in vaults and direct)

### Return Object Structure
```javascript
{
  success: boolean,
  vaults: Array<VaultData>,      // Full vault objects with metrics
  positions: {
    vaultPositions: Array,       // Positions held by vaults
    nonVaultPositions: Array     // Direct user positions
  },
  poolData: Object,              // Aggregated pool data
  tokenData: Object              // Aggregated token data
}
```

### Examples

```javascript
// Get all user vault data
const userData = await getAllUserVaultData('0xUser', provider, 1);
if (userData.success) {
  // Process vaults
  userData.vaults.forEach(vault => {
    console.log(`Vault ${vault.name}: $${vault.metrics.tvl}`);
  });
  
  // Count positions
  const vaultPosCount = userData.positions.vaultPositions.length;
  const directPosCount = userData.positions.nonVaultPositions.length;
  console.log(`Total positions: ${vaultPosCount + directPosCount}`);
  
  // Calculate total TVL
  const totalTVL = userData.vaults.reduce((sum, vault) => 
    sum + vault.metrics.tvl + vault.metrics.tokenTVL, 0
  );
}
```

### Process Flow

1. Gets all user vault addresses
2. Loads complete data for each vault
3. Aggregates all vault positions
4. Finds user positions not in vaults
5. Combines all data

### Side Effects
- Multiple vault data fetches
- Position queries across all adapters

---

## Type Definitions

```typescript
// For TypeScript users
interface VaultData {
  address: string;
  name: string;
  symbol: string;
  executor: string | null;
  strategyAddress: string | null;
  hasActiveStrategy: boolean;
  strategy: StrategyInfo | null;
  positions: string[];
  metrics: VaultMetrics;
}

interface StrategyInfo {
  strategyId: string;
  strategyAddress: string;
  isActive: boolean;
  selectedTokens: string[];
  selectedPlatforms: string[];
  parameters: Record<string, any>;
  activeTemplate: string;
  lastUpdated: number;
}

interface VaultMetrics {
  tvl: number;
  tokenTVL: number;
  hasPartialData: boolean;
  positionCount: number;
  lastTVLUpdate: number;
}

interface Position {
  id: string;
  platform: string;
  poolAddress: string;
  inVault: boolean;
  vaultAddress: string | null;
  [key: string]: any;
}

interface TokenBalance {
  symbol: string;
  name: string;
  address: string;
  balance: string;
  numericalBalance: number;
  valueUsd: number;
  decimals: number;
  logoURI?: string;
}
```

## Common Patterns

### Complete Vault Analysis
```javascript
async function analyzeVault(vaultAddress, provider, chainId) {
  const vaultData = await getVaultData(vaultAddress, provider, chainId);
  if (!vaultData.success) return null;
  
  return {
    summary: {
      name: vaultData.vault.name,
      totalValue: vaultData.vault.metrics.tvl + vaultData.vault.metrics.tokenTVL,
      positionCount: vaultData.positions.length,
      tokenCount: vaultData.vaultTokens.length
    },
    strategy: vaultData.vault.strategy ? {
      id: vaultData.vault.strategy.strategyId,
      template: vaultData.vault.strategy.activeTemplate,
      tokens: vaultData.vault.strategy.selectedTokens,
      platforms: vaultData.vault.strategy.selectedPlatforms
    } : null,
    breakdown: {
      positionValue: vaultData.vault.metrics.tvl,
      tokenValue: vaultData.vault.metrics.tokenTVL,
      positions: vaultData.positions.map(p => ({
        platform: p.platform,
        pool: p.poolAddress
      })),
      tokens: vaultData.vaultTokens.map(t => ({
        symbol: t.symbol,
        value: t.valueUsd
      }))
    }
  };
}
```

### Portfolio Overview
```javascript
async function getUserPortfolio(userAddress, provider, chainId) {
  const userData = await getAllUserVaultData(userAddress, provider, chainId);
  if (!userData.success) return null;
  
  // Calculate totals
  const vaultTVL = userData.vaults.reduce((sum, vault) => 
    sum + vault.metrics.tvl + vault.metrics.tokenTVL, 0
  );
  
  // Would need to calculate non-vault position TVL separately
  const directPositions = userData.positions.nonVaultPositions;
  
  return {
    vaultCount: userData.vaults.length,
    vaultTVL,
    totalPositions: userData.positions.vaultPositions.length + directPositions.length,
    vaultPositions: userData.positions.vaultPositions.length,
    directPositions: directPositions.length,
    platforms: [...new Set([
      ...userData.positions.vaultPositions.map(p => p.platform),
      ...directPositions.map(p => p.platform)
    ])]
  };
}
```

## See Also

- [`strategyHelpers`](./strategy-helpers.md) - Strategy configuration utilities
- [`chainHelpers`](./chain-helpers.md) - Chain configuration utilities
- [`tokenHelpers`](./token-helpers.md) - Token management utilities
- [Vault Contracts](../../contracts/) - Vault smart contract documentation