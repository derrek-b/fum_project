# Adapter Pattern for DeFi Platform Support

## Overview

This project uses the **Adapter Pattern** to support multiple DeFi liquidity platforms (Uniswap V3, SushiSwap, etc.) through a unified interface. This architectural approach allows the application to:

1. Query multiple platforms in parallel
2. Display positions from all platforms in a single dashboard
3. Use platform-specific logic for operations like fee calculations
4. Maintain a consistent UI regardless of the underlying platform

## Architecture

![Adapter Pattern Diagram](https://miro.medium.com/max/720/1*dH1P-3QwA4Wu8RWcXTkNdg.webp)

### Key Components

#### 1. PlatformAdapter (Base Class)

The `PlatformAdapter` is an abstract base class that defines the common interface all platform adapters must implement:

```javascript
export default class PlatformAdapter {
  // Platform identification
  platformId = ""; // Must be defined in subclasses
  platformName = ""; // Must be defined in subclasses

  // Core operations
  async getPositions(address, chainId) { /* ... */ }
  async calculateFees(position, poolData, token0Data, token1Data) { /* ... */ }
  async claimFees(params) { /* ... */ }
  isPositionInRange(position, poolData) { /* ... */ }
  calculatePrice(position, poolData, token0Data, token1Data, invert) { /* ... */ }
}
```

#### 2. Platform-Specific Adapters

Each supported platform has its own adapter that extends the base class and implements the required methods with platform-specific logic:

- `UniswapV3Adapter`: Handles Uniswap V3 concentrated liquidity positions
- Additional adapters can be added for other platforms

#### 3. AdapterFactory

The `AdapterFactory` is responsible for creating and managing adapter instances:

```javascript
export default class AdapterFactory {
  static getAdaptersForChain(chainId, provider) { /* ... */ }
  static getAdapter(platformId, provider) { /* ... */ }
}
```

#### 4. Redux Integration

The application uses Redux to manage state:

- `positionsSlice`: Stores all positions from all platforms
- `poolSlice`: Stores pool data for all platforms
- `tokensSlice`: Stores token data for all platforms
- `platformsSlice`: Manages platform-specific state (supported platforms, active platforms, filtering)

## Data Flow

### Position Loading Process

1. The `PositionContainer` component loads when a wallet is connected
2. It retrieves all platform adapters for the current chain using `AdapterFactory`
3. It calls `getPositions()` on each adapter in parallel
4. Results from all adapters are merged and stored in Redux
5. The UI displays positions from all platforms, with platform-specific badges

### Platform-Specific Operations

When a user interacts with a position (e.g., claiming fees):

1. The `PositionCard` component gets the appropriate adapter for the position
2. It calls the platform-specific method (e.g., `claimFees()`)
3. The adapter handles the operation using platform-specific logic
4. Results are consistent regardless of the underlying platform

## Benefits of This Approach

1. **Scalability**: New platforms can be added by creating new adapters without modifying existing code
2. **Separation of Concerns**: Platform-specific logic is encapsulated in adapters
3. **Unified UI**: Users see a consistent interface regardless of platform
4. **Parallel Operations**: Positions can be loaded from multiple platforms simultaneously
5. **Consistent Error Handling**: Errors are handled consistently across platforms

## Adding New Platforms

See the [Adding New Platforms](./adding-new-platforms.md) guide for detailed instructions on implementing adapters for additional platforms.

## Implementation Considerations

### Performance

- Adapters use Promise.all for parallel loading of positions
- Platform-specific data is cached in Redux to minimize redundant API calls

### Error Handling

- Each adapter handles its own errors and returns empty results on failure
- The application continues to function even if one platform fails

### Testing

- Each adapter should be tested independently with its own test suite
- Integration tests should verify that multiple adapters work together correctly

## Future Enhancements

1. Implement lazy loading for position details
2. Add cross-platform position comparison
3. Implement batch operations across multiple platforms

## Code Organization

### Adapter Implementation

Each platform adapter encapsulates all platform-specific logic:

- **Platform-specific calculations**: Functions like `tickToPrice` (Uniswap V3) are implemented directly in the adapter
- **Fee calculations**: Each adapter implements its own fee calculation logic
- **Price representation**: Adapters handle platform-specific price formats and conversions

### Shared Utilities

Generic utilities that are platform-agnostic are kept in shared utility files:

- **formatHelpers.js**: Contains generic formatting functions like `formatPrice` and `formatUnits`
- **config.js**: Contains platform and chain configuration

This separation ensures that platform-specific code remains properly encapsulated within the adapter, while still allowing for code reuse where appropriate.
