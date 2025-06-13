# Changelog

All notable changes to the F.U.M. library will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
