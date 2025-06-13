# Adapter Factory API

Factory class for creating platform-specific adapter instances.

## Overview

The `AdapterFactory` class implements the factory pattern to create appropriate adapter instances based on platform type. It manages the instantiation of platform adapters and ensures proper configuration and validation.

## Class: AdapterFactory

### createAdapter

Creates a platform adapter instance based on the specified type.

#### Signature
```javascript
static createAdapter(platformType: string, config: Object, provider: Object): PlatformAdapter
```

#### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| platformType | `string` | Yes | Platform identifier (e.g., 'UNISWAP_V3') |
| config | `Object` | Yes | Chain and platform configuration |
| provider | `Object` | Yes | Ethers provider instance |

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

// Create provider
const provider = new ethers.JsonRpcProvider(RPC_URL);

// Platform configuration
const config = {
  1: { // mainnet
    platformAddresses: {
      factory: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
      positionManager: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88'
    },
    tokenAddresses: {
      WETH: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
    }
  }
};

// Create adapter
const adapter = AdapterFactory.createAdapter('UNISWAP_V3', config, provider);

// Use adapter methods
const poolInfo = await adapter.getPoolAddress(token0, token1, 3000);
```

## Adding New Platform Support

To add support for a new platform:

1. Create a new adapter class extending `PlatformAdapter`
2. Implement all abstract methods
3. Add the platform type to the factory

```javascript
// In AdapterFactory.js
import MyNewAdapter from './MyNewAdapter.js';

static createAdapter(platformType, config, provider) {
  switch (platformType) {
    case 'UNISWAP_V3':
      return new UniswapV3Adapter(config, provider);
    case 'MY_NEW_PLATFORM':
      return new MyNewAdapter(config, provider);
    default:
      throw new Error(`Unknown platform type: ${platformType}`);
  }
}
```

## Configuration Structure

The configuration object should follow this structure:

```javascript
{
  [chainId]: {
    platformAddresses: {
      // Platform-specific contract addresses
      factory: '0x...',
      router: '0x...',
      positionManager: '0x...',
      // ... other contracts
    },
    tokenAddresses: {
      // Common token addresses
      WETH: '0x...',
      USDC: '0x...',
      // ... other tokens
    }
  }
}
```

## Error Handling

```javascript
try {
  const adapter = AdapterFactory.createAdapter(platformType, config, provider);
} catch (error) {
  if (error.message.includes('Unknown platform type')) {
    console.error('Platform not supported:', platformType);
  } else {
    console.error('Failed to create adapter:', error);
  }
}
```

## Best Practices

1. **Validation**: Always validate platform type before creation
2. **Configuration**: Ensure complete configuration for target chains
3. **Provider**: Use appropriate provider for target network
4. **Error Handling**: Implement proper error handling for factory failures

## Future Enhancements

- Dynamic adapter loading
- Platform capability detection
- Adapter versioning support
- Configuration validation helpers

## See Also

- [`PlatformAdapter`](./platform-adapter.md) - Base adapter class
- [`UniswapV3Adapter`](./uniswap-v3-adapter.md) - Uniswap V3 implementation
- [Platform Configuration](../configs/platforms.md) - Platform configuration structure