# F.U.M. Project Changelog

## v0.2.1 (Current Development)

### Added
- Baby Steps strategy implementation with simplified parameter set
- Platform-specific implementation for BabyStepsStrategy (Uniswap V3)
- Dynamic contract ABI selection based on strategy type

## v0.2.0

### Added
- Dynamic range calculation based on current price and strategy parameters
- Support for Uniswap V3 position management through specialized adapters
- Event-driven monitoring system for Uniswap pools
- Telegram notification integration for price events and strategy actions
- Enhanced error handling and position state tracking

### Improved
- Modular strategy architecture allowing for platform-specific implementations
- Chain and platform-agnostic design allowing for multi-chain support
- Dynamic adapter loading system for different DEX platforms
- Enhanced caching system for on-chain data to reduce RPC calls
- Position tracking with detailed fee and range information

### Fixed
- Proper handling of fee tiers and tick spacing across different pools
- Accurate calculation of position ranges and fee collection criteria
- Position boundary detection for optimal rebalancing timing

## v0.1.0 (Initial Release)
- Migration from original FUM project into a standalone project
- Code refactoring to use the FUM library for core functionality
