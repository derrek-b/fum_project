# Chain Helpers API

Chain configuration utilities for managing blockchain network settings and platform integrations.

## Overview

The Chain Helpers module provides comprehensive utilities for working with blockchain networks in the FUM Library. It manages chain configurations, RPC endpoints, platform addresses, and executor contracts across multiple blockchain networks.

## Functions

---

## getChainConfig

Get complete chain configuration by chain ID.

### Signature
```javascript
getChainConfig(chainId: number): Object | null
```

### Parameters

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| chainId | `number` | Yes | - | The blockchain network ID |

### Returns

`Object | null` - Chain configuration object containing name, rpcUrl, executorAddress, and platformAddresses - null if not found

### Return Object Structure
```javascript
{
  name: string,              // Human-readable chain name
  rpcUrl: string,           // RPC endpoint URL
  executorAddress: string,  // Executor contract address
  platformAddresses: {      // Platform-specific addresses
    [platformId]: {
      enabled: boolean,
      factoryAddress: string,
      positionManagerAddress: string
    }
  }
}
```

### Examples

```javascript
// Get Ethereum mainnet configuration
const config = getChainConfig(1);
// Returns: { 
//   name: "Ethereum", 
//   rpcUrl: "https://...", 
//   executorAddress: "0x...", 
//   platformAddresses: {...} 
// }

// Handle unknown chain
const config = getChainConfig(999999);
// Returns: null
```

### Side Effects
None - Pure function

---

## getChainName

Get human-readable chain name by chain ID.

### Signature
```javascript
getChainName(chainId: number): string
```

### Parameters

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| chainId | `number` | Yes | - | The blockchain network ID |

### Returns

`string` - Human-readable chain name or "Unknown Chain" if not found

### Examples

```javascript
// Get known chain names
getChainName(1);     // "Ethereum"
getChainName(137);   // "Polygon"
getChainName(42161); // "Arbitrum"

// Handle unknown chain
getChainName(999999); // "Unknown Chain"
```

### Side Effects
None - Pure function

---

## getChainRpcUrl

Get RPC URL for a specific chain.

### Signature
```javascript
getChainRpcUrl(chainId: number): string | null
```

### Parameters

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| chainId | `number` | Yes | - | The blockchain network ID |

### Returns

`string | null` - RPC endpoint URL for blockchain interactions - null if chain not found

### Examples

```javascript
// Get RPC URL for Ethereum mainnet
const rpcUrl = getChainRpcUrl(1);
// Use with ethers.js
const provider = new ethers.JsonRpcProvider(rpcUrl);

// Handle missing RPC URL
const rpcUrl = getChainRpcUrl(999999);
if (!rpcUrl) {
  console.error('Chain not supported');
}
```

### Use Cases
- Creating blockchain providers
- Configuring Web3 connections
- Multi-chain dApp initialization

### Side Effects
None - Pure function

---

## getExecutorAddress

Get the executor contract address for the specified chain.

### Signature
```javascript
getExecutorAddress(chainId: number): string | null
```

### Parameters

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| chainId | `number` | Yes | - | The blockchain network ID |

### Returns

`string | null` - The executor contract address (0x-prefixed) - null if not configured

### Examples

```javascript
// Get executor for Ethereum mainnet
const executor = getExecutorAddress(1);
// Returns: "0x742d35Cc6634C0532925a3b844Bc9e7595f7E2e1"

// Use in contract interaction
const executorAddress = getExecutorAddress(chainId);
if (executorAddress) {
  const contract = new ethers.Contract(executorAddress, executorABI, provider);
}
```

### Important Notes

⚠️ **WARNING**: The executor address is critical for vault operations. Always verify the address exists before attempting to interact with it.

### Side Effects
None - Pure function

---

## isChainSupported

Check if a chain is supported by the FUM Library.

### Signature
```javascript
isChainSupported(chainId: number): boolean
```

### Parameters

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| chainId | `number` | Yes | - | The blockchain network ID to check |

### Returns

`boolean` - True if the chain is supported, false otherwise

### Examples

```javascript
// Check before proceeding with chain-specific operations
if (!isChainSupported(chainId)) {
  throw new Error(`Chain ${chainId} is not supported`);
}

// Filter supported chains
const supportedNetworks = [1, 137, 42161, 10].filter(isChainSupported);

// Validate user's network
const userChainId = await provider.getNetwork().then(n => n.chainId);
if (!isChainSupported(userChainId)) {
  alert('Please switch to a supported network');
}
```

### Side Effects
None - Pure function

---

## getSupportedChainIds

Get all supported chain IDs.

### Signature
```javascript
getSupportedChainIds(): Array<number>
```

### Parameters

None

### Returns

`Array<number>` - Array of supported chain IDs as integers

### Examples

```javascript
// Get all supported chains
const chainIds = getSupportedChainIds();
// Returns: [1, 137, 42161, 10, ...]

// Create chain selector dropdown
const chains = getSupportedChainIds().map(id => ({
  id,
  name: getChainName(id),
  rpcUrl: getChainRpcUrl(id)
}));

// Check if any chains are supported
if (getSupportedChainIds().length === 0) {
  console.error('No chains configured');
}
```

### Side Effects
None - Pure function

---

## getPlatformAddresses

Get platform-specific contract addresses for a chain.

### Signature
```javascript
getPlatformAddresses(chainId: number, platformId: string): Object | null
```

### Parameters

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| chainId | `number` | Yes | - | The blockchain network ID |
| platformId | `string` | Yes | - | The platform identifier (e.g., 'uniswapV3', 'aaveV3') |

### Returns

`Object | null` - Platform addresses object with factoryAddress and positionManagerAddress - null if not found or disabled

### Return Object Structure
```javascript
{
  enabled: boolean,                 // Whether platform is active
  factoryAddress: string,          // Factory contract address
  positionManagerAddress: string   // Position manager address
}
```

### Examples

```javascript
// Get Uniswap V3 addresses on Ethereum
const addresses = getPlatformAddresses(1, 'uniswapV3');
// Returns: { 
//   enabled: true,
//   factoryAddress: "0x1F984...",
//   positionManagerAddress: "0xC3650..."
// }

// Check if platform is available before using
const platformConfig = getPlatformAddresses(chainId, platformId);
if (!platformConfig) {
  console.error(`Platform ${platformId} not available on chain ${chainId}`);
}

// Initialize platform contracts
const config = getPlatformAddresses(chainId, 'uniswapV3');
if (config && config.enabled) {
  const factory = new ethers.Contract(config.factoryAddress, factoryABI, provider);
  const positionManager = new ethers.Contract(config.positionManagerAddress, pmABI, provider);
}
```

### Side Effects
None - Pure function

---

## getChainPlatformIds

Get all platform IDs available on a specific chain.

### Signature
```javascript
getChainPlatformIds(chainId: number): Array<string>
```

### Parameters

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| chainId | `number` | Yes | - | The blockchain network ID |

### Returns

`Array<string>` - Array of enabled platform IDs for the chain

### Examples

```javascript
// Get all platforms on Ethereum mainnet
const platforms = getChainPlatformIds(1);
// Returns: ['uniswapV3', 'aaveV3', ...]

// Build platform selector for a specific chain
const availablePlatforms = getChainPlatformIds(chainId)
  .map(platformId => ({
    id: platformId,
    name: getPlatformName(platformId),
    addresses: getPlatformAddresses(chainId, platformId)
  }));

// Check if any platforms are available
const chainPlatforms = getChainPlatformIds(chainId);
if (chainPlatforms.length === 0) {
  console.warn(`No platforms enabled for chain ${chainId}`);
}
```

### Side Effects
None - Pure function

---

## Type Definitions

```typescript
// For TypeScript users
interface ChainConfig {
  name: string;
  rpcUrl: string;
  executorAddress: string;
  platformAddresses: Record<string, PlatformConfig>;
}

interface PlatformConfig {
  enabled: boolean;
  factoryAddress: string;
  positionManagerAddress: string;
}

type ChainId = number;
type PlatformId = string;
```

## Common Patterns

### Multi-Chain Initialization
```javascript
// Initialize providers for all supported chains
const providers = {};
getSupportedChainIds().forEach(chainId => {
  const rpcUrl = getChainRpcUrl(chainId);
  if (rpcUrl) {
    providers[chainId] = new ethers.JsonRpcProvider(rpcUrl);
  }
});
```

### Platform Availability Check
```javascript
// Check which platforms are available across chains
function getPlatformAvailability(platformId) {
  return getSupportedChainIds()
    .filter(chainId => {
      const config = getPlatformAddresses(chainId, platformId);
      return config && config.enabled;
    })
    .map(chainId => ({
      chainId,
      chainName: getChainName(chainId),
      addresses: getPlatformAddresses(chainId, platformId)
    }));
}
```

## See Also

- [`platformHelpers`](./platform-helpers.md) - Platform-specific utilities
- [`tokenHelpers`](./token-helpers.md) - Token configuration utilities
- [Ethereum Chain List](https://chainlist.org/) - Comprehensive chain ID reference
- [ethers.js Documentation](https://docs.ethers.io/) - Blockchain interaction library