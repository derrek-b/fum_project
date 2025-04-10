# Changelog

All notable changes to the F.U.M. project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]
### Added
- Strategy configuration UI with templates and customizable parameters
- Strategy implementation for stablecoin optimization ("The Fed")
- Strategy execution through vault contracts
- Performance metrics for strategy execution
- Strategy history tracking
- Mobile responsive design improvements
- Multi-chain support for additional networks
- Bulk position management tools

## [0.3.0] - 2025-04-04
### Added
- Multi-vault management system for managing multiple liquidity positions
- Vault creation and configuration UI
- Position transfer functionality between wallet and vaults
- Position creation directly within vaults
- Token deposit and withdrawal functionality for vaults
- TVL calculation and metrics for vaults and positions
- Comprehensive vault details page with positions and tokens tabs
- Redux state management for vaults and positions
- Helper utilities for vault contract interactions
- Token price fetching and USD value calculation

### Changed
- Upgraded PositionVault contract to version 0.3.0
- Upgraded VaultFactory contract to version 0.3.0
- Enhanced UI for position and vault management
- Improved token balance tracking for vaults
- Optimized data loading with batch fetching and caching

### Fixed
- Position display issues with multiple platforms
- Token price calculation edge cases

## [0.2.1] - 2025-03-22
### Changed
- Enhanced error handling across the application
- Improved input validation with detailed error messages
- Added better transaction error reporting for UI

### Added
- Comprehensive error callbacks for all transaction methods
- User-friendly error messages for common blockchain errors
- Consistent error handling pattern across adapters

## [0.2.0] - 2025-03-21
### Changed
- Complete architecture redesign: moved from on-chain adapters to off-chain strategy execution
- Implemented vault-based position management system
- Added support for multiple vaults per user

### Added
- VaultFactory contract for creating and managing user vaults
- PositionVault contract for secure transaction execution
- Event system for tracking position lifecycle and history
- Whitelisting mechanism for trusted strategies

### Removed
- On-chain strategy registry
- Platform-specific adapter contracts on-chain

## [0.1.0] - 2025-03-15
### Added
- Initial project setup
- LiquidityManager contract implementation
- UniswapV3Adapter contract for platform-specific operations
- Smart contract testing framework
- Basic integration with ethers.js
- Initial Next.js frontend structure
