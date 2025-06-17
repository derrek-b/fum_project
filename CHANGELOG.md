# F.U.M. Project Changelog

## v0.4.0

### Security & Production Readiness
- **BREAKING**: Removed all hardcoded fallback values in production financial application
- **BREAKING**: AutomationService now requires explicit configuration for all timing parameters
  - `pollInterval` must be explicitly configured (no default polling allowed)
  - `debug` flag must be explicitly set to true or false
  - `dataRefreshInterval` must be explicitly configured for VaultDataService
- **BREAKING**: Removed magic number heuristic for token balance format detection
  - Token balances are now guaranteed to be consistently formatted by vault helpers
  - Eliminated unreliable 1e6 threshold that could cause double-formatting in edge cases

### Added
- Intelligent fee tier selection for Uniswap V3 swaps and position creation
- `discoverAvailablePools` method added to PlatformAdapter base class (abstract method)
- `discoverAvailablePools` implementation in UniswapV3Adapter for all fee tiers (100, 500, 3000, 10000 bp)
- Multi-factor scoring system for optimal swap routing based on:
  - Output amount optimization
  - Price impact minimization
  - Pool liquidity depth
- Position creation pool optimization for long-term fee generation potential
- `findBestSwapRoute` and `findBestPositionPool` methods in UniswapV3BabyStepsStrategy

### Changed
- **BREAKING**: All timing configurations must be explicitly provided - no production defaults
- **BREAKING**: VaultDataService refresh interval must be explicitly set during initialization
- Fee tier selection now uses dynamic pool discovery instead of hardcoded 3000 basis points
- Swap routing now evaluates all available fee tiers for optimal execution
- Position creation now selects optimal fee tier based on liquidity and fee generation potential

### Removed
- **BREAKING**: Hardcoded fee tier (3000) from UniswapV3BabyStepsStrategy
- **BREAKING**: Magic number balance threshold detection (1e6 heuristic)
- **BREAKING**: Default polling intervals and refresh rates
- All hardcoded gas estimates and timing constants in production paths

### Improved
- Production safety through explicit configuration requirements
- Swap efficiency through intelligent fee tier selection
- Position profitability through optimal pool selection
- Code maintainability by centralizing pool discovery in adapters
- Data integrity by eliminating balance format guessing

### Fixed
- Token balance processing now uses guaranteed formatted values from vault helpers
- Eliminated potential double-formatting of token balances in edge cases
- Removed unreliable heuristics that could cause data integrity issues

## v0.3.0

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
- Platform delegation in base strategies for true platform-agnostic architecture

### Changed
- **BREAKING**: Removed position.adapter assignments - adapters are now stateless utilities
- Platform-specific strategies now manage their own adapter instances via getAdapter() method
- VaultDataService uses position.platform directly without fallbacks

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
- VaultDataService converted from singleton to instance pattern for proper per-chain isolation

### Fixed
- BabyStepsStrategy now properly delegates to platform-specific implementations
- Fixed "calculateOptimalAllocation must be implemented" error during price event handling
- Fixed CommonJS/ESM module compatibility by converting require() to dynamic import()
- Fixed platform name case sensitivity issues (uniswapv3 vs uniswapV3)

## v0.2.2

### Added
- Comprehensive TESTING.md documentation for test procedures
- Automated bytecode synchronization for testing
- Integration tests for the vault authorization flow

### Improved
- Refactored test environment for consistency with main project
- Enhanced spy functions for more reliable event testing
- Fixed WebSocket provider cleanup in the AutomationService
- Optimized testability with better dependency structure
- Deterministic deployment addresses between automation and main project

### Fixed
- Integration tests now properly detect event callbacks
- Cleaned up WebSocket provider event handling
- Fixed race conditions in the test environment setup
- Eliminated unnecessary code duplication in test scripts

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
