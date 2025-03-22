# Changelog

All notable changes to the F.U.M. project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]
- Future changes that are not yet released will be added here

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
