# Adapter Factory API

Factory class for creating platform-specific adapter instances.

## Overview

The `AdapterFactory` class implements the factory pattern to create appropriate adapter instances based on platform type. It manages the instantiation of platform adapters and ensures proper configuration and validation.

## Class: AdapterFactory

### createAdapter

Creates a platform adapter instance based on the specified type.

#### Signature
```javascript
static createAdapter(platformType: string, chainId: number): PlatformAdapter
```

#### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| platformType | `string` | Yes | Platform identifier (e.g., 'UNISWAP_V3') |
| chainId | `number` | Yes | Chain ID for the adapter |

#### Returns

`PlatformAdapter` - Instance of the appropriate platform adapter

#### Throws

| Error | Condition |
|-------|-----------|
| `Error` | Unknown platform type |
| `Error` | Missing required configuration |

#### Supported Platform Types

| Platform Type | Adapter Class | Description |
|--------------|---------------|-------------|
| `UNISWAP_V3` | UniswapV3Adapter | Uniswap V3 DEX |

#### Example

```javascript
import AdapterFactory from './adapters/AdapterFactory.js';
import { ethers } from 'ethers';

// Create adapter for Arbitrum
const adapter = AdapterFactory.createAdapter('UNISWAP_V3', 42161);

// Create provider when needed for blockchain calls
const provider = new ethers.JsonRpcProvider(RPC_URL);

// Use adapter methods (provider passed to methods that need it)
const poolInfo = await adapter.fetchPoolData(token0, token1, 3000, 42161, provider);
```

## Adding New Platform Support

To add support for a new platform:

1. Create a new adapter class extending `PlatformAdapter`
2. Implement all abstract methods
3. Add the platform type to the factory

```javascript
// In AdapterFactory.js
import MyNewAdapter from './MyNewAdapter.js';

static createAdapter(platformType, chainId) {
  switch (platformType) {
    case 'UNISWAP_V3':
      return new UniswapV3Adapter(chainId);
    case 'MY_NEW_PLATFORM':
      return new MyNewAdapter(chainId);
    default:
      throw new Error(`Unknown platform type: ${platformType}`);
  }
}
```

## Adapter Configuration

Adapters automatically load their configuration from the library's internal config system based on the chainId. The configuration includes:

- Platform contract addresses (factory, router, position manager, etc.)
- Supported fee tiers
- Token definitions for the chain
- Chain-specific metadata

This eliminates the need to manually pass configuration objects to adapters.

## Error Handling

```javascript
try {
  const adapter = AdapterFactory.createAdapter(platformType, chainId);
} catch (error) {
  if (error.message.includes('Unknown platform type')) {
    console.error('Platform not supported:', platformType);
  } else if (error.message.includes('not available on chain')) {
    console.error('Platform not supported on chain:', chainId);
  } else {
    console.error('Failed to create adapter:', error);
  }
}
```

## Best Practices

1. **Validation**: Always validate platform type and chainId before creation
2. **Chain Support**: Verify the platform is available on the target chain
3. **Provider Management**: Create providers as needed for blockchain calls
4. **Error Handling**: Implement proper error handling for factory failures
5. **Adapter Reuse**: Cache adapter instances when possible since they're stateless

## Future Enhancements

- Dynamic adapter loading
- Platform capability detection
- Adapter versioning support
- Configuration validation helpers

## See Also

- [`PlatformAdapter`](./platform-adapter.md) - Base adapter class
- [`UniswapV3Adapter`](./uniswap-v3-adapter.md) - Uniswap V3 implementation
- [Platform Configuration](../configs/platforms.md) - Platform configuration structure