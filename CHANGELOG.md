# Changelog

All notable changes to the F.U.M. library will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.1.1]: https://github.com/yourusername/fum_library/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/yourusername/fum_library/releases/tag/v0.1.0
