# Changelog

All notable changes to the F.U.M. project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]
### Added
- Completing automation pipeline with transaction execution
- Performance metrics for strategy execution
- Strategy history tracking

## [0.3.3] - 2025-09-30
### Added
- EIP-1271 signature validation support in PositionVault contract
  - Implements `isValidSignature(bytes32 hash, bytes calldata signature)` function
  - Validates signatures from vault owner or authorized executor
  - Returns EIP-1271 magic value `0x1626ba7e` for valid signatures
  - Enables gasless approvals via Permit2 and other signature-based protocols
- Comprehensive test suite for EIP-1271 functionality
  - Owner and executor signature validation
  - Unauthorized signer rejection
  - Invalid signature handling
  - EIP-712 typed data signature support (Permit2 simulation)
  - Executor removal edge case testing

### Changed
- PositionVault contract version updated from 0.3.2 to 0.3.3
- Added IERC1271 interface and ECDSA library imports

## [0.3.2] - 2025-08-27
### Changed
- Enhanced ExecutorChanged event in PositionVault contract
  - Added boolean parameter to indicate authorization (true) vs revocation (false)
  - Event now emits `ExecutorChanged(address indexed executor, bool indexed isAuthorized)`
  - Enables more efficient vault authorization workflow by eliminating need for additional contract calls
- Updated removeExecutor function to emit the current executor address before clearing it
  - Ensures authorization service can identify if revocation affects their service

### Added
- Comprehensive test suite for executor management functionality
  - Tests for setExecutor and removeExecutor functions
  - Event emission validation with new boolean parameter
  - Authorization and access control testing

## [0.3.1] - 2025-04-16
### Added
- Event monitoring system for automated strategies
  - Event-driven architecture for real-time position monitoring
  - Strategy-based monitoring with modular design pattern
  - Service Registry for vault discovery and monitoring
  - Price event detection for strategy evaluation
- Framework for strategy-specific implementation:
  - Configurable monitoring for Parris Island strategy
  - Support for future strategy implementations
- Preparatory components for automated position management:
  - Configurable pool monitoring
  - Strategy parameter evaluation

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
