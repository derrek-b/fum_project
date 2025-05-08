# F.U.M. Project Changelog

## v0.3.0 (Current Development)

### Added
- New frontend logging system with human-readable log formatting
- Real-time log filtering by action type, source, and result
- "Newest-first" log display for better usability
- Enhanced position monitoring with percentage-in-range calculation
- Demo mode feature for simulating transactions without execution (configurable via --demoMode flag)
- Command line flag support for all configuration options
- Enhanced Telegram notifications with detailed transaction information
- Integration with refactored VaultDataService for improved data management
- Enhanced multi-platform support with platform-specific strategy implementations
- Centralized event management system for improved monitoring

### Improved
- Significantly reduced log verbosity with intelligent filtering
- More robust error handling and reporting
- Enhanced visualization of position states and actions
- Optimized price event handling to reduce unnecessary processing
- Better token pair detection and display in logs
- Refactored strategy base classes for better code organization
- Enhanced caching system for optimized RPC usage
- Comprehensive documentation for setup and configuration
- Optimized fee collection and position management logic

## v0.2.1

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
