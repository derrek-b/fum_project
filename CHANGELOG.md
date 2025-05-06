# Changelog

All notable changes to the F.U.M. library will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.1.4]: https://github.com/D-fied/fum_library/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/D-fied/fum_library/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/D-fied/fum_library/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/D-fied/fum_library/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/D-fied/fum_library/releases/tag/v0.1.0
