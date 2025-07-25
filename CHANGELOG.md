# Changelog

All notable changes to the F.U.M. library will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.10.0] - 2025-01-25

### BREAKING CHANGES - API Encapsulation

#### **Main Export Changes**
- **Removed direct config exports**: Configs are now internal implementation details
  - `export * from './configs/index.js'` removed from main entry point
  - Prevents direct access to raw configuration objects
  - Forces usage of validated helper functions instead
  
- **Added helper exports to main entry**: Helpers are now available from root import
  - `export * from './helpers/index.js'` added to main entry point
  - Cleaner imports: `import { getTokenBySymbol } from 'fum_library'`
  - No longer need subpath imports for common utilities

#### **Benefits**
- **Better encapsulation**: Library internals are properly hidden
- **Safer API**: All data access goes through validated helper functions
- **Future flexibility**: Can change internal configs without breaking consumers
- **Cleaner imports**: Single import point for most common functions

#### **Migration Guide**
```javascript
// Before (0.9.x) - Direct config access
import { CHAINS, TOKENS } from 'fum_library/configs';
const chain = CHAINS[42161]; // Direct access, no validation

// After (0.10.0) - Helper function access
import { getChainConfig, getTokenBySymbol } from 'fum_library';
const chain = getChainConfig(42161); // Validated, safe access
const token = getTokenBySymbol('USDC'); // Returns null if not found

// Subpath imports still work for organization
import { getChainConfig } from 'fum_library/helpers/chainHelpers';
```

## [0.9.0] - 2025-01-25

### Major Library Refactor - Cleaner Architecture & Better Separation of Concerns

#### **BREAKING CHANGES**
- **Removed `vaults.js` module**: Moved to fum_automation as `vaultDataHelpers.js`
  - Vault data orchestration is project-specific, not a shared library concern
  - Each project (fum, fum_automation) now owns its data orchestration logic
  - Library now only contains truly shared primitives (contracts, adapters, helpers)

- **Moved `mapStrategyParameters()` function**: Now in `strategyHelpers.js`
  - Added comprehensive validation for strategyId and params
  - Added parameter count validation per strategy
  - Added type validation for boolean/numeric parameters
  - Better error messages for all failure cases

#### **New Features**
- **Added `getContractInfoByAddress()` in contracts.js**: Simple contract address lookup
  - Returns `{ contractName, chainId }` for any deployed contract address
  - Replaces complex address mapping logic in removed vault functions
  - Throws descriptive errors for invalid or unknown addresses

- **Enhanced parameter validation**: New validators in strategyHelpers
  - `validateAddress()` - Validates Ethereum addresses using ethers.getAddress()
  - `validateChainId()` - Validates positive integer chain IDs
  - `validateProvider()` - Validates ethers provider instances

#### **Improvements**
- **Cleaner module exports**: Removed vaults.js from blockchain/index.js
- **Better error handling**: All functions now throw errors instead of returning null
- **Improved imports**: Cleaned up unused imports across the library
- **Test coverage**: Added comprehensive tests for mapStrategyParameters

#### **Architecture Benefits**
- **Clear ownership**: Each project owns its specific orchestration logic
- **Smaller library**: Removed ~900 lines of project-specific code
- **Better maintainability**: No confusion about which project uses what
- **Independent evolution**: Projects can optimize for their specific needs

#### **Migration Guide**
```javascript
// If using vaults.js functions, they're now in fum_automation:
import { getVaultData } from 'fum_automation/src/helpers/vaultDataHelpers';

// mapStrategyParameters moved to strategyHelpers:
import { mapStrategyParameters } from 'fum_library/helpers/strategyHelpers';

// New contract lookup function:
import { getContractInfoByAddress } from 'fum_library/blockchain/contracts';
const { contractName, chainId } = getContractInfoByAddress('0x...');
```

## [0.8.0] - 2025-01-16

### Major AdapterFactory Refactor & Breaking Changes

#### **BREAKING CHANGES**
- **`getAdaptersForChain()` return type changed**: Now returns `{adapters: [], failures: []}` object instead of array
  - Provides transparency about adapter creation failures
  - Allows partial success scenarios where some adapters work and others fail
  - Consumers can implement custom error handling and retry logic
  
- **`getAdapter()` error behavior changed**: Now throws errors instead of returning `null`
  - Missing platform → throws `"No adapter available for platform: {platformId}"`
  - Adapter creation failure → throws `"Failed to create {platformId} adapter for chain {chainId}: {error}"`
  - Consistent fail-fast behavior throughout the API

- **`registerAdapter()` renamed**: Now called `registerAdapterForTestingOnly()`
  - Makes it explicit that this is for testing/plugin scenarios only
  - Not intended for production adapter registration
  - Registered adapters are not persistent across application restarts

#### **Enhanced Error Handling**
- **Consistent parameter validation**: Uses established patterns for chainId and platformId validation
- **Descriptive error messages**: All errors include context about what operation failed and why
- **Graceful failure tracking**: `getAdaptersForChain()` captures individual adapter failures without breaking the entire operation

#### **API Improvements**
- **Better separation of concerns**: Uses `chainHelpers` instead of direct config access
- **Robust failure handling**: No silent failures - all errors are either thrown or tracked
- **Clear documentation**: All methods have explicit error handling documentation

#### **Test Coverage**
- **Comprehensive test suite**: 40+ test cases covering all methods and edge cases
- **Real-world testing**: Uses actual chain configurations and adapters
- **Minimal mocking**: Only mocks what's absolutely necessary for specific test scenarios

#### **Migration Guide**
```javascript
// Before (0.7.x)
const adapters = AdapterFactory.getAdaptersForChain(42161);
console.log(`Found ${adapters.length} adapters`);

// After (0.8.x)
const result = AdapterFactory.getAdaptersForChain(42161);
console.log(`Found ${result.adapters.length} adapters`);
if (result.failures.length > 0) {
  console.warn('Some adapters failed:', result.failures);
}

// Before (0.7.x)
const adapter = AdapterFactory.getAdapter('platform', 42161);
if (adapter) {
  // use adapter
} else {
  // handle null case
}

// After (0.8.x)
try {
  const adapter = AdapterFactory.getAdapter('platform', 42161);
  // use adapter
} catch (error) {
  // handle error
}
```

## [0.7.0] - 2025-01-16

### Major UniswapV3Adapter Refactor & Architectural Improvements

#### **BREAKING CHANGES**
- **Removed transaction execution functions**: `claimFees()`, `addLiquidity()`, `createPosition()`, `decreaseLiquidity()`, and `closePosition()` have been removed from UniswapV3Adapter
  - These functions mixed platform-specific logic with generic transaction execution
  - Calling code now handles transaction execution, UI callbacks, and state management
  - Adapter focuses solely on generating platform-specific transaction data

#### **New Features**
- **Added `getAddLiquidityQuote()` function**: Centralized V3 liquidity calculations
  - Extracts position calculation logic from `generateAddLiquidityData()`
  - Uses Uniswap SDK's `Position.fromAmounts()`, `Position.fromAmount0()`, `Position.fromAmount1()` methods
  - Handles token sorting, tick validation, and SDK optimization
  - Returns comprehensive quote object with position data and metadata

#### **Enhanced Functions**
- **`generateAddLiquidityData()` improvements**:
  - Refactored to use `getAddLiquidityQuote()` for calculations
  - Removed `walletAddress` parameter (not needed for data generation)
  - Now returns full quote object in addition to transaction data
  - Simplified parameter validation and error handling

- **`generateCreatePositionData()` complete rewrite**:
  - Now uses same logic as `generateAddLiquidityData()` via `getAddLiquidityQuote()`
  - Added `walletAddress` parameter for recipient address
  - Unified architecture between creating and adding to positions
  - Improved parameter validation and error handling

#### **Test Suite Enhancements**
- **Comprehensive test coverage**: Added 40+ new tests across all functions
- **Real position data**: Tests now use `env.testPosition` instead of hardcoded values
- **Token sorting fixes**: Properly handle WETH/USDC token order in tests
- **SDK rounding tolerance**: Account for Uniswap SDK optimization differences
- **Edge case testing**: Out-of-range positions, single token inputs, scaling scenarios
- **Error validation**: Comprehensive parameter validation testing

#### **Architecture Improvements**
- **Better separation of concerns**: Adapter generates data, calling code handles execution
- **Improved testability**: Data generation functions are pure and easier to test
- **Cleaner abstraction**: Removed UI-specific callbacks and state management
- **Enhanced flexibility**: Calling code can customize transaction flow and error handling

#### **Migration Guide**
```javascript
// Before (0.6.x) - Adapter handled everything
await adapter.addLiquidity({
  position, token0Amount, token1Amount, provider, address, chainId,
  poolData, token0Data, token1Data, slippageTolerance, deadlineMinutes,
  onStart, onSuccess, onError, onFinish
});

// After (0.7.x) - Adapter generates data, you handle execution
const txData = await adapter.generateAddLiquidityData({
  position, token0Amount, token1Amount, provider,
  poolData, token0Data, token1Data, slippageTolerance, deadlineMinutes
});

// Your code handles transaction execution and UI callbacks
const signer = await provider.getSigner();
const tx = await signer.sendTransaction(txData);
const receipt = await tx.wait();
```

#### **Benefits**
- **Cleaner code**: Platform-specific logic separated from generic blockchain operations
- **Better testing**: Pure functions without side effects are easier to test
- **More flexible**: Applications can customize transaction flow and error handling
- **Future-proof**: Architecture supports additional platforms and transaction types

## [0.3.0] - 2025-06-17

### Security & Reliability Improvements
- **BREAKING**: `fetchTokenPrices()` now requires explicit cache strategy parameter
  - Added mandatory `cacheStrategy` parameter: '0-SECONDS', '5-SECONDS', '30-SECONDS', '1-MINUTE', '2-MINUTES', '10-MINUTES'
  - Forces developers to make conscious decisions about data freshness vs performance
  - Prevents accidental use of stale price data in financial calculations
- **BREAKING**: `getCoingeckoId()` now throws errors instead of returning fallback values
  - No longer returns `symbol.toLowerCase()` for unknown tokens
  - Prevents wrong price data from being used for unmapped tokens
  - Forces explicit token mapping registration for new tokens
- **BREAKING**: `getContract()` fails fast on network detection issues
  - No longer defaults to localhost chainId (1337) when provider network is unavailable
  - Throws error: "Provider network not available. Cannot determine which contracts to use."
  - Prevents cross-chain transaction disasters and wrong contract deployments
- **BREAKING**: `getConnectedAccounts()` throws errors instead of silent failures
  - No longer returns empty array `[]` when wallet connection fails
  - Throws error: "Failed to get connected accounts: {error details}"
  - Prevents wallet connection state confusion in applications

### Configuration Security
- **Environment Variable Migration**: Removed hardcoded RPC URLs and API keys
  - Created `.env.example` template for secure configuration
  - Updated `src/configs/chains.js` to use environment variables for private keys
  - Eliminated placeholder API keys and localhost fallbacks
  - Developers must provide their own RPC endpoints when creating providers

### API Failures & Error Handling
- **Price Service Reliability**: `fetchTokenPrices()` now fails fast on API errors
  - No longer returns stale cached data when CoinGecko API fails
  - Throws error: "Failed to fetch current token prices: {details}. Cannot proceed with stale data."
  - Prevents catastrophic trading decisions based on outdated price information

### Documentation Updates
- **Complete Documentation Sync**: Updated all documentation to reflect breaking changes
  - Fixed `fetchTokenPrices()` examples throughout documentation to include required cache strategy
  - Added comprehensive error handling examples for new failure modes
  - Updated architecture diagrams and sequence flows
  - Marked broken functions (`calculateUsdValue`, `prefetchTokenPrices`) in documentation

### Broken Functions (Will be fixed in next release)
- `calculateUsdValue()` - Calls `fetchTokenPrices()` without required cache strategy
- `prefetchTokenPrices()` - Calls `fetchTokenPrices()` without required cache strategy

### Migration Guide
```javascript
// Before (0.2.x)
const prices = await fetchTokenPrices(['ETH', 'USDC']);

// After (0.3.x)
const prices = await fetchTokenPrices(['ETH', 'USDC'], '30-SECONDS');

// Register unknown tokens instead of relying on fallbacks
registerTokenMapping('MYTOKEN', 'my-token-coingecko-id');

// Handle network validation errors
try {
  const contract = getContract('VaultFactory', provider, signer);
} catch (error) {
  if (error.message.includes('Provider network not available')) {
    // Handle network connection issues
  }
}
```

## [0.2.0] - 2025-06-17

### Added
- **Pool Discovery System**: New `discoverAvailablePools` method added to PlatformAdapter base class
  - Abstract method that all adapters must implement for standardized pool discovery
  - Returns array of pool information objects with address, fee, liquidity, sqrtPriceX96, and tick data
  - Enables dynamic fee tier evaluation across all DeFi platforms
- **UniswapV3 Pool Discovery Implementation**: Complete implementation in UniswapV3Adapter
  - `discoverAvailablePools` method that checks all fee tiers (100, 500, 3000, 10000 basis points)
  - `getPoolAddressFromFactory` helper method for factory contract interactions
  - Only returns pools with active liquidity to ensure viable trading options
  - Comprehensive error handling for non-existent or inactive pools

### Changed
- **BREAKING**: PlatformAdapter now requires `discoverAvailablePools` implementation
  - All future adapters must implement this method for pool discovery
  - Provides consistent interface for fee tier evaluation across platforms
  - Enables platform-agnostic pool optimization in strategies

### Architecture
- **Enhanced Adapter Pattern**: Pool discovery logic now centralized in adapters where it belongs
  - Removes platform-specific logic from strategies
  - Enables consistent pool discovery across all DeFi platforms
  - Supports future adapter implementations (PancakeSwap, SushiSwap, etc.)

### Developer Experience
- **Standardized Pool Interface**: All adapters return consistent pool data format
  - Simplifies strategy development by providing uniform pool information
  - Enables cross-platform fee tier optimization
  - Reduces code duplication in strategy implementations

## [0.1.9] - 2025-06-13

### Added
- **Comprehensive API Documentation**: Complete function-level documentation system
  - Created detailed API reference documentation for all modules in `/docs/api-reference/`
  - Added comprehensive parameter tables, return values, and examples for all functions
  - Included error handling documentation and usage patterns
  - Added TypeScript-style type definitions for better development experience

### Changed
- **Enhanced JSDoc Comments**: Upgraded all JSDoc comments to professional standard
  - Added `@module` declarations for all source files
  - Implemented `@memberof` tags for proper function association
  - Added `@example` blocks with practical use cases for all functions
  - Added `@throws` documentation for error conditions
  - Added `@since` version tags for API stability tracking
  - Fixed `@returns` format to use single-line object syntax for better IntelliSense support

### Documentation
- **New API Reference Structure**:
  - `/docs/api-reference/adapters/` - Platform adapter documentation
  - `/docs/api-reference/blockchain/` - Wallet and contract utilities
  - `/docs/api-reference/helpers/` - All helper function documentation
  - `/docs/api-reference/services/` - CoinGecko service documentation
- **Function Documentation Includes**:
  - Function signatures with TypeScript-style types
  - Detailed parameter descriptions with types and requirements
  - Return value specifications with object property breakdowns
  - Practical code examples for each function
  - Error handling scenarios and best practices
  - Common usage patterns and workflows
- **Improved Developer Experience**:
  - Better IDE IntelliSense support with enhanced JSDoc
  - Comprehensive cross-references between related functions
  - Clear documentation hierarchy and navigation

## [0.1.9] - 2025-06-13

### Changed
- Improved JSDoc documentation throughout the codebase
  - Added detailed object property descriptions for all object parameters
  - Added comprehensive file-level documentation to core modules
  - Standardized return type documentation format
- Code cleanup and maintenance
  - Removed unused imports from source files
  - Removed unused imports from test files

### Documentation
- Enhanced IntelliSense support with detailed parameter property descriptions
- Added module-level documentation for better code navigation
- Improved consistency in documentation format across all files

## [0.1.8] - 2025-06-09

### Fixed
- Fixed decimal precision errors in all parseUnits calls across UniswapV3Adapter
  - Round token amounts to token decimals before calling parseUnits in generateAddLiquidityData
  - Round token amounts to token decimals before calling parseUnits in generateRemoveLiquidityData  
  - Round token amounts to token decimals before calling parseUnits in generateMintData
  - Round token amounts to token decimals before calling parseUnits in generateCollectFeesData
  - Resolves "too many decimals for format" errors when processing high-precision amounts

## [0.1.7] - 2025-06-09

### Fixed
- Added missing Uniswap V3 router addresses to chain configurations
  - Added routerAddress to Ethereum mainnet (0xE592427A0AEce92De3Edee1F18E0157C05861564)
  - Added routerAddress to Arbitrum One (0xE592427A0AEce92De3Edee1F18E0157C05861564)  
  - Added routerAddress to local fork (1337) using same address as Arbitrum
  - Resolves "No Uniswap V3 router configuration found for chainId" errors

## [0.1.6] - 2025-06-09

### Added
- New swap functionality in UniswapV3Adapter:
  - `generateSwapData` method for creating Uniswap V3 swap transaction data
  - Support for exactInputSingle swaps with configurable parameters
  - Proper ETH value handling for ETH swaps
  - Comprehensive parameter validation and error handling
- Abstract `generateSwapData` method added to PlatformAdapter base class
- Unit tests for swap functionality with multiple test scenarios:
  - Normal ERC20 token swaps
  - ETH swap scenarios with proper value setting
  - Error handling for missing parameters
  - Error handling for unsupported chains

### Fixed
- Import statements updated to include SwapRouter ABI for swap functionality

## [0.1.5] - 2025-05-11

### Added
- Comprehensive unit testing suite:
  - Implemented testing infrastructure using Vitest
  - Created tests for formatHelpers.js functions for data formatting utilities
  - Added tests for tokenHelpers.js functions for token management
  - Added tests for chainHelpers.js functions for chain management
  - Added tests for platformHelpers.js functions for platform interaction
  - Added tests for strategyHelpers.js functions for strategy configuration
  - Created tests for UniswapV3Adapter core price calculation methods
  - Added tests for vaultHelpers.js functions for vault management
- Added testing documentation and guidelines in TESTING.md
- Fixed decimal adjustment in UniswapV3Adapter price calculations

### Changed
- Updated module imports to use explicit file extensions for better compatibility
- Removed redundant code in adapters/index.js exports

## [0.1.4] - 2025-05-06

### Added
- New vaultHelpers.js module with comprehensive vault management functionality:
  - `mapStrategyParameters` for converting raw strategy parameters to named objects
  - `fetchStrategyParameters` to retrieve parameter values from strategy contracts
  - `getVaultStrategies` for loading all strategy configurations for a chain
  - `getVaultBasicInfo` and `getVaultTokenBalances` for vault inspection
  - `getVaultPositions` and `calculatePositionsTVL` for liquidity position management
  - `getVaultData` and `getAllUserVaultData` for complete vault analysis
- Improved vault data gathering with token price calculations
- Enhanced strategy parameter mapping for multiple strategy types

### Fixed
- Minor bug fixes and code refinements

## [0.1.3] - 2025-04-30

### Added
- New helper functionality in strategyHelpers.js
  - Added `validateTokensForStrategy` function to compare vault tokens against strategy token selections
  - Provides validation messages for mismatched tokens that will need to be swapped
- Fine-tuned strategy configuration parameters
- Improved documentation for strategy parameter validations

### Fixed
- Minor bug fixes and code refinements

## [0.1.2] - 2025-04-25

### Added
- Baby Steps strategy implementation
  - Simplified parameter set for beginner users
  - Streamlined UI interactions for position management
- Enhanced ABI handling for contract interactions

### Fixed
- Various refactoring bug fixes
- Stability improvements in adapter functionality

## [0.1.1] - 2025-04-21

### Added
- ABI returning functionality in platform adapters
  - Added `getPoolABI()` method to retrieve pool contract ABI
  - Added `getPositionManagerABI()` method to retrieve position manager ABI
- Improved type documentation throughout codebase
- Additional JSDoc comments for better code clarity

### Fixed
- Export paths in package.json for better module resolution
- Minor bug fixes in contract interaction utilities

## [0.1.0] - 2025-04-10

### Added
- Initial library structure migration from original project
- Core modules:
  - Adapters for DeFi platforms (Uniswap V3)
  - Blockchain utilities for contract interactions and wallet connections
  - Configuration for chains, platforms, strategies, and tokens
  - Helper functions for chains, platforms, tokens, and formatting
  - CoinGecko service for token price data
  - Contract artifacts with ABIs and deployment addresses

### Changed
- Refactored codebase for modular exports
- Restructured project to support NPM package format
- Improved error handling across all modules

[0.1.5]: https://github.com/D-fied/fum_library/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/D-fied/fum_library/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/D-fied/fum_library/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/D-fied/fum_library/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/D-fied/fum_library/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/D-fied/fum_library/releases/tag/v0.1.0
