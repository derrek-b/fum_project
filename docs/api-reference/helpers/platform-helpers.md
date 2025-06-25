# Platform Helpers API

Platform configuration utilities for managing DeFi protocol integrations and metadata.

## Overview

The Platform Helpers module provides comprehensive utilities for working with DeFi platforms (DEXs, lending protocols, etc.) in the FUM Library. It manages platform metadata, visual branding, chain-specific addresses, and feature configurations.

## Functions

---

## getPlatformMetadata

Get platform metadata by ID.

### Signature
```javascript
getPlatformMetadata(platformId: string): Object | null
```

### Parameters

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| platformId | `string` | Yes | - | The platform ID to look up (e.g., 'uniswapV3', 'aaveV3') |

### Returns

`Object | null` - Platform metadata object containing name, logo, color, features - null if not found

### Return Object Structure
```javascript
{
  name: string,          // Human-readable platform name
  logo: string,          // URL to platform logo
  color: string,         // Primary brand color (hex)
  description: string,   // Platform description
  features: {            // Platform capabilities
    concentrated?: boolean,
    lending?: boolean,
    // ... other features
  },
  feeTiers?: number[]    // Available fee tiers (for DEXs)
}
```

### Examples

```javascript
// Get Uniswap V3 metadata
const metadata = getPlatformMetadata('uniswapV3');
// Returns: {
//   name: "Uniswap V3",
//   logo: "https://...",
//   color: "#FF007A",
//   description: "...",
//   features: {...}
// }

// Handle unknown platform
const platform = getPlatformMetadata('unknown');
if (!platform) {
  console.error('Platform not found');
}
```

### Side Effects
None - Pure function

---

## getPlatformName

Get human-readable platform name by ID.

### Signature
```javascript
getPlatformName(platformId: string): string
```

### Parameters

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| platformId | `string` | Yes | - | The platform ID to look up |

### Returns

`string` - Human-readable platform name or the ID itself if not found

### Examples

```javascript
// Get known platform names
getPlatformName('uniswapV3');    // "Uniswap V3"
getPlatformName('aaveV3');       // "Aave V3"
getPlatformName('compoundV3');   // "Compound V3"

// Fallback for unknown platform
getPlatformName('unknownPlatform'); // "unknownPlatform"
```

### Side Effects
None - Pure function

---

## getPlatformColor

Get the primary brand color for a platform.

### Signature
```javascript
getPlatformColor(platformId: string): string
```

### Parameters

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| platformId | `string` | Yes | - | The platform ID |

### Returns

`string` - Color hex code for UI theming - defaults to gray (#6c757d) if not defined

### Examples

```javascript
// Get platform brand color
const uniswapColor = getPlatformColor('uniswapV3'); // "#FF007A"

// Use in component styling
const platformStyle = {
  backgroundColor: getPlatformColor(platformId),
  borderColor: getPlatformColor(platformId)
};

// Default color for unknown platforms
getPlatformColor('unknown'); // "#6c757d"
```

### Side Effects
None - Pure function

---

## getPlatformFeeTiers

Get fee tiers supported by a platform.

### Signature
```javascript
getPlatformFeeTiers(platformId: string): Array<number>
```

### Parameters

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| platformId | `string` | Yes | - | The platform ID to get fee tiers for |

### Returns

`Array<number>` - Array of supported fee tiers in basis points - empty array if platform not found

### Examples

```javascript
// Get Uniswap V3 fee tiers
const feeTiers = getPlatformFeeTiers('uniswapV3');
// Returns: [100, 500, 3000, 10000]

// Build fee tier dropdown options
const feeOptions = getPlatformFeeTiers(platformId).map(tier => ({
  value: tier,
  label: `${tier / 100}%`,
  description: tier === 500 ? 'Most common' : tier === 3000 ? 'Standard' : ''
}));

// Automation service checking available pools
const supportedFeeTiers = getPlatformFeeTiers('uniswapV3');
for (const feeTier of supportedFeeTiers) {
  const poolExists = await checkPoolExists(token0, token1, feeTier);
  // Process pool...
}

// Handle unknown platform
const feeTiers = getPlatformFeeTiers('unknownPlatform');
// Returns: [] (empty array)
```

### Use Cases

- **Frontend**: Building fee tier dropdown menus for user strategy configuration
- **Automation**: Discovering which fee tier pools exist for token pairs
- **Analytics**: Understanding platform fee structure variations
- **Validation**: Checking if user-selected fee tier is supported

### Important Notes

⚠️ **Fee Tier Format**: All fee tiers are returned in basis points (e.g., 500 = 0.05%, 3000 = 0.30%)

### Side Effects
None - Pure function

---

## getPlatformLogo

Get platform logo URL.

### Signature
```javascript
getPlatformLogo(platformId: string): string | null
```

### Parameters

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| platformId | `string` | Yes | - | The platform ID |

### Returns

`string | null` - URL to platform logo image - null if not found

### Examples

```javascript
// Get platform logo for display
const logoUrl = getPlatformLogo('uniswapV3');
if (logoUrl) {
  return <img src={logoUrl} alt="Uniswap V3" />;
}

// Fallback to default logo
const logo = getPlatformLogo(platformId) || '/images/default-platform.png';
```

### Side Effects
None - Pure function

---

## getAvailablePlatforms

Get all platforms available on a specific chain.

### Signature
```javascript
getAvailablePlatforms(chainId: number): Array<Object>
```

### Parameters

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| chainId | `number` | Yes | - | The current chain ID |

### Returns

`Array<Object>` - Array of platform objects with complete configuration for the chain

### Return Array Item Structure
```javascript
{
  id: string,                      // Platform identifier
  name: string,                    // Human-readable name
  factoryAddress: string,          // Factory contract address
  positionManagerAddress: string,  // Position manager address
  logo: string,                    // Logo URL
  color: string,                   // Brand color (hex)
  description: string              // Platform description
}
```

### Examples

```javascript
// Get all platforms on Ethereum mainnet
const platforms = getAvailablePlatforms(1);
// Returns: [
//   {
//     id: "uniswapV3",
//     name: "Uniswap V3",
//     factoryAddress: "0x1F98...",
//     positionManagerAddress: "0xC365...",
//     logo: "https://...",
//     color: "#FF007A",
//     description: "..."
//   },
//   ...
// ]

// Build platform selector
const platformOptions = getAvailablePlatforms(chainId).map(platform => ({
  value: platform.id,
  label: platform.name,
  icon: platform.logo
}));
```

### Important Notes

⚠️ **WARNING**: This function only returns platforms that are enabled on the specified chain. Disabled platforms are filtered out.

### Side Effects
None - Pure function

---

## getPlatformById

Get complete platform configuration for a specific chain.

### Signature
```javascript
getPlatformById(platformId: string, chainId: number): Object | null
```

### Parameters

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| platformId | `string` | Yes | - | The platform ID to look up |
| chainId | `number` | Yes | - | The current chain ID |

### Returns

`Object | null` - Combined platform configuration with metadata and addresses - null if not found or not enabled

### Return Object Structure
```javascript
{
  id: string,                      // Platform identifier
  name: string,                    // Human-readable name
  factoryAddress: string,          // Factory contract address
  positionManagerAddress: string,  // Position manager address
  logo: string,                    // Logo URL
  color: string,                   // Brand color (hex)
  description: string,             // Platform description
  features: Object,                // Feature flags
  feeTiers: number[]              // Available fee tiers
}
```

### Examples

```javascript
// Get complete Uniswap V3 config for Ethereum
const uniswap = getPlatformById('uniswapV3', 1);
// Returns: {
//   id: "uniswapV3",
//   name: "Uniswap V3",
//   factoryAddress: "0x1F98...",
//   positionManagerAddress: "0xC365...",
//   logo: "https://...",
//   color: "#FF007A",
//   description: "...",
//   features: { concentrated: true, ... },
//   feeTiers: [500, 3000, 10000]
// }

// Check platform availability before using
const platform = getPlatformById(platformId, chainId);
if (!platform) {
  throw new Error(`Platform ${platformId} not available on chain ${chainId}`);
}
```

### Side Effects
None - Pure function

---

## platformSupportsTokens

Check if a platform supports specific tokens.

### Signature
```javascript
platformSupportsTokens(platformId: string, tokenSymbols: string[], chainId: number): boolean
```

### Parameters

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| platformId | `string` | Yes | - | The platform ID to check |
| tokenSymbols | `string[]` | Yes | - | Array of token symbols to check |
| chainId | `number` | Yes | - | The current chain ID |

### Returns

`boolean` - Whether the platform supports all specified tokens

### Examples

```javascript
// Check if Uniswap V3 supports token pair
const canTrade = platformSupportsTokens('uniswapV3', ['ETH', 'USDC'], 1);
if (!canTrade) {
  console.warn('Platform does not support this token pair');
}

// Filter platforms by token support
const supportedPlatforms = getAvailablePlatforms(chainId)
  .filter(platform => 
    platformSupportsTokens(platform.id, selectedTokens, chainId)
  );
```

### Important Notes

⚠️ **TODO**: This is currently a placeholder implementation that always returns true. Platform-specific token support logic needs to be implemented.

### Side Effects
None - Pure function

---

## getSupportedPlatformIds

Get all configured platform IDs.

### Signature
```javascript
getSupportedPlatformIds(): Array<string>
```

### Parameters

None

### Returns

`Array<string>` - Array of all configured platform IDs

### Examples

```javascript
// Get all platform IDs
const platformIds = getSupportedPlatformIds();
// Returns: ['uniswapV3', 'aaveV3', 'compoundV3', ...]

// Check if a platform is supported
const supportedPlatforms = getSupportedPlatformIds();
if (!supportedPlatforms.includes(userPlatform)) {
  throw new Error('Unsupported platform');
}
```

### Side Effects
None - Pure function

---

## Type Definitions

```typescript
// For TypeScript users
interface PlatformMetadata {
  name: string;
  logo?: string;
  color?: string;
  description?: string;
  features?: PlatformFeatures;
  feeTiers?: number[];
}

interface PlatformFeatures {
  concentrated?: boolean;
  lending?: boolean;
  staking?: boolean;
  [key: string]: boolean | undefined;
}

interface PlatformConfig {
  id: string;
  name: string;
  factoryAddress: string;
  positionManagerAddress: string;
  logo?: string;
  color: string;
  description: string;
  features: PlatformFeatures;
  feeTiers: number[];
}

type PlatformId = string;
```

## Common Patterns

### Multi-Chain Platform Discovery
```javascript
// Find which chains support a specific platform
function getPlatformChains(platformId) {
  return getSupportedChainIds()
    .filter(chainId => {
      const platform = getPlatformById(platformId, chainId);
      return platform !== null;
    })
    .map(chainId => ({
      chainId,
      chainName: getChainName(chainId),
      platform: getPlatformById(platformId, chainId)
    }));
}
```

### Platform Feature Detection
```javascript
// Check platform capabilities
function getPlatformCapabilities(platformId, chainId) {
  const platform = getPlatformById(platformId, chainId);
  if (!platform) return null;
  
  return {
    hasConcentratedLiquidity: platform.features?.concentrated || false,
    hasLending: platform.features?.lending || false,
    hasMultipleFees: (platform.feeTiers?.length || 0) > 1,
    supportedFeeTiers: platform.feeTiers || []
  };
}
```

### Platform Selector Component Data
```javascript
// Prepare data for platform selector UI
function getPlatformSelectorData(chainId, selectedTokens) {
  return getAvailablePlatforms(chainId)
    .filter(platform => 
      platformSupportsTokens(platform.id, selectedTokens, chainId)
    )
    .map(platform => ({
      value: platform.id,
      label: platform.name,
      icon: platform.logo,
      color: platform.color,
      disabled: false
    }));
}
```

## See Also

- [`chainHelpers`](./chain-helpers.md) - Chain configuration utilities
- [`tokenHelpers`](./token-helpers.md) - Token management utilities
- [DeFi Protocols](https://defillama.com/protocols) - Overview of DeFi platforms
- [Uniswap V3 Docs](https://docs.uniswap.org/) - Example platform documentation