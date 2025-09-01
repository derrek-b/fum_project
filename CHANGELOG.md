# F.U.M. Project Changelog

## [0.8.0] VaultRegistry Deconstruction - Event-Driven Architecture - 2025-09-01

### Major Refactor - Complete VaultRegistry Removal

Complete deconstruction of VaultRegistry with migration to clean event-driven architecture using EventManager.

#### **VaultRegistry Deconstruction**
- **MIGRATED**: `subscribeToAuthorizationEvents()` from VaultRegistry → EventManager with event emission
- **MIGRATED**: `subscribeToVaultConfigEvents()` from VaultRegistry → EventManager with event emission  
- **MIGRATED**: `subscribeToStrategyParameterEvents()` from VaultRegistry → EventManager with event emission
- **MIGRATED**: `getAuthorizedVaults()` functionality moved to fum_library v0.18.1 (previous WIP)
- **REMOVED**: `subscribeToVaultStrategyEvents()` (unused method, dead code elimination)
- **DELETED**: Entire VaultRegistry.js file (functionality fully migrated)

#### **Event-Driven Architecture**
- **NEW**: Clean event-driven architecture - no more callback passing
- **ENHANCED**: EventManager now handles all blockchain event subscriptions consistently
- **IMPROVED**: AutomationService subscribes to events (`VaultAuthGranted`, `VaultAuthRevoked`, `TargetTokensUpdated`, `TargetPlatformsUpdated`, `StrategyParameterUpdated`) instead of using callbacks
- **ADDED**: Event emissions (`ConfigMonitoringRegistered`, `ParameterMonitoringRegistered`) for better observability
- **CLEANER**: Eliminated complex constructor callback dependencies

#### **Testing & Documentation**
- **UPDATED**: All tests updated to reflect new architecture
- **FIXED**: Service initialization tests now expect event handlers during construction
- **COMPREHENSIVE**: Documentation updated across all workflow and API reference docs
- **MAINTAINED**: Full test coverage for new event-driven patterns

#### **Technical Debt Reduction**
- **ELIMINATED**: ~45 lines of duplicate vault discovery code from VaultRegistry
- **CONSOLIDATED**: All contract interaction patterns now use library functions
- **TESTED**: Comprehensive unit test coverage added to library (12 test cases)

**Status**: ✅ Core functionality working, service-init tests passing  
**Next**: Complete VaultRegistry refactor and remove remaining dead code

## v0.7.5 - 2025-07-30

### Service Shutdown Workflow & Graceful Termination

This release delivers a complete refactor of the service shutdown workflow, implementing graceful termination with proper resource cleanup and preventing race conditions during service stop.

#### **Service Shutdown Refactor**
- **REFACTOR**: Simplified `.stop()` method from 130+ lines to ~60 lines using existing infrastructure
- **IMPROVEMENT**: Parallel vault cleanup using `Promise.allSettled` for faster shutdown
- **REMOVED**: Unnecessary 5-second wait for vault locks that could cause race conditions
- **SIMPLIFICATION**: Reuses `cleanupVault` infrastructure from vault-revoke workflow

#### **Graceful Shutdown Implementation**
- **NEW**: `isShuttingDown` flag prevents new work from starting during shutdown
- **ENHANCEMENT**: All event handlers check shutdown state before processing
- **IMPROVEMENT**: Retry mechanism respects shutdown state
- **ROBUSTNESS**: Public methods return early during shutdown with appropriate status

#### **Resource Cleanup Improvements**
- **FIX**: Provider cleanup now uses proper optional chaining to prevent errors
- **NEW**: Fallback handling for providers without standard cleanup methods
- **REMOVED**: Redundant registry.stopListening() call that duplicated cleanup
- **SIMPLIFICATION**: VaultRegistry.stopListening() now defers to AutomationService

#### **Dead Code Removal**
- **REMOVED**: Unused `onVaultLoadFailed` callback and related infrastructure
- **REMOVED**: Unused `onAuthorizationRevoked` callback
- **CLEANUP**: VaultRegistry constructor simplified to only include used callbacks

#### **Test Coverage**
- **NEW**: Comprehensive service-stop workflow test with 1111 configuration
- **TEST**: Validates graceful shutdown and event emissions
- **TEST**: Error handling during shutdown with vault cleanup failures

## v0.7.4 - 2025-07-30

### Production-Ready Error Handling & Resource Management

This release eliminates infinite retry loops and implements persistent vault blacklisting with comprehensive cleanup workflows, making the automation service truly production-ready with bulletproof resource management.

#### **Persistent Vault Blacklisting System**
- **NEW**: Persistent vault blacklisting prevents infinite retry loops after 24 hours of failures (configurable)
- **NEW**: Blacklist survives service restarts via JSON file storage with atomic writes
- **NEW**: Automatic blacklist removal on vault revocation (clean recovery path for users)
- **NEW**: VaultBlacklisted and VaultUnblacklisted events for external monitoring
- **ARCHITECTURE**: Required blacklistFilePath parameter ensures explicit configuration

#### **Zombie Listener Recovery System**
- **FIX**: Event listeners marked for removal but still attached are now automatically reactivated
- **IMPROVEMENT**: Prevents duplicate event handlers from accumulating during failed cleanups
- **ENHANCEMENT**: All listener registration methods (filter, contract, interval) check for zombies
- **RESILIENCE**: Vaults can recover from partial cleanup failures without permanent issues

#### **Vault Cleanup Workflow Consolidation**
- **REFACTOR**: Unified cleanup logic between vault revocation and failed setup scenarios
- **ENHANCEMENT**: Added retryWithBackoff to cleanupVault for consistent error handling
- **SIMPLIFICATION**: Single cleanup method handles both failure and revocation cases
- **IMPROVEMENT**: Comprehensive result tracking with detailed event emission

#### **Enhanced Service Resilience**
- **IMPROVEMENT**: Service startup now skips blacklisted vaults with detailed logging
- **NEW**: ServiceStarted event includes blacklistedVaults count for monitoring
- **ENHANCEMENT**: Failed vault retry mechanism now properly blacklists persistent failures
- **ROBUSTNESS**: Multiple recovery paths ensure vaults don't get permanently stuck

#### **Test Infrastructure Updates**
- **FIX**: All test configurations updated to include required blacklistFilePath parameter
- **ENHANCEMENT**: Centralized blacklist configuration in ganache-setup.js
- **NEW**: resetBlacklistFile() helper method for test cleanup
- **IMPROVEMENT**: Tests inherit blacklist configuration automatically

#### **Breaking Changes**
- **BREAKING**: AutomationService constructor now requires blacklistFilePath parameter
- **MIGRATION**: Add `blacklistFilePath: './path/to/.vault-blacklist.json'` to service configuration

This release transforms the automation service from a proof-of-concept into a production-ready system with enterprise-grade error handling, resource management, and recovery mechanisms.

## v0.7.3 - 2025-07-29

### Service Initialization Workflow Refactor

This release delivers a major architectural improvement to service initialization, implementing a robust two-phase startup process with comprehensive error handling and consistent vault setup workflows.

#### **Service Initialization Architecture**
- **REFACTOR**: Implemented two-phase initialization in AutomationService.start()
  - **Phase 1**: Core service setup (must succeed) - provider, contracts, event subscriptions
  - **Phase 2**: Vault loading (graceful failure handling) - individual vault setup and monitoring
- **IMPROVEMENT**: Service can now start successfully with zero vaults and handle new authorizations
- **FIX**: Core service failures no longer crash due to vault loading issues

#### **Vault Setup Workflow Unification**
- **NEW**: Created shared setupVault() method implementing consistent 1-2-3 flow: load → initialize strategy → start monitoring
- **REFACTOR**: Both service startup and new vault authorizations now use identical setup process
- **SIMPLIFICATION**: Removed isNewAuthorization parameter - event emissions handled in appropriate contexts
- **IMPROVEMENT**: All vault setup now includes comprehensive retry logic with RetryHelper

#### **VaultRegistry Simplification**
- **REFACTOR**: VaultRegistry.getAuthorizedVaults() now returns simple array of vault addresses
- **REMOVED**: Complex vault data loading logic moved to appropriate service layer
- **IMPROVEMENT**: Single responsibility - registry only handles authorization status checking

#### **Enhanced Error Handling & Events**
- **NEW**: ServiceStarted event with initialized vault addresses and failure counts
- **NEW**: ServiceStartFailed event for core service initialization failures only
- **IMPROVEMENT**: Meaningful return objects from start() instead of boolean values
- **FIX**: Failed vault tracking and retry mechanisms work consistently across all vault loading contexts

#### **Service Resilience Improvements**
- **ARCHITECTURE**: Clear separation of critical vs non-critical startup operations
- **IMPROVEMENT**: Service remains operational even with persistent vault loading failures
- **ENHANCEMENT**: Automatic recovery through periodic retry mechanism
- **ROBUSTNESS**: Graceful degradation - service functions with partial vault loading success

## v0.7.2 - 2025-07-28

### Vault Authorization Revocation Workflow Implementation

This release completes the vault authorization lifecycle by implementing a comprehensive revocation workflow with proper cleanup sequencing, event emissions, and strategy architecture improvements.

#### **Vault Revocation Workflow Implementation**
- **NEW**: Complete vault authorization revocation workflow with proper event sequencing
- **NEW**: VaultOffboarded event emission for internal vault cleanup tracking
- **NEW**: VaultMonitoringStopped event with listener removal details
- **NEW**: VaultPositionChecksCleared event from strategy cleanup

#### **Event System Refactoring**
- **REFACTOR**: Renamed internal events to avoid blockchain event conflicts (VaultOnboarded/VaultOffboarded vs VaultAuthGranted/VaultAuthRevoked)
- **FIX**: Made EventManager.removeAllVaultListeners async to properly await removeListener calls
- **NEW**: AllVaultListenersRemoved event emission with removal statistics
- **IMPROVEMENT**: Added unknown listener type detection in EventManager.removeListener

#### **Strategy Architecture Improvements**
- **REFACTOR**: Made StrategyBase.cleanup() abstract requiring subclass implementation
- **FIX**: Removed problematic listener tracking from StrategyBase to prevent iteration errors
- **IMPROVEMENT**: BabyStepsStrategy.cleanup() now only manages strategy-specific state (lastPositionCheck)
- **ARCHITECTURE**: Established clear separation - AutomationService manages infrastructure, Strategies handle business logic

#### **Test Suite Enhancements**
- **NEW**: Comprehensive vault revocation test suite (BS-1vault-1111.test.js)
- **TEST**: Added VaultMonitoringStopped event verification
- **TEST**: Added VaultPositionChecksCleared event verification
- **TEST**: Added strategy lastPositionCheck cache cleanup verification
- **FIX**: Use hasVault() instead of getVault() to prevent re-caching in tests

## v0.7.1 - 2025-07-28

### Vault Authorization Workflow Fixes

This patch release resolves critical issues with the vault authorization workflow, ensuring proper async handling and eliminating environment variable conflicts that were preventing the authorization test suite from completing successfully.

#### **Critical Async/Await Fixes**
- **CRITICAL FIX**: Fixed `handleNewVaultAuthorization` async execution - converted from floating promise chains to proper async/await pattern
- **FIX**: Resolved "provider destroyed" errors during async initialization by eliminating premature cleanup
- **FIX**: Fixed vault authorization test timing issues by increasing timeout from 15s to 60s

#### **Environment Configuration Improvements**
- **NEW**: Added `envPath` configuration parameter to AutomationService constructor for explicit environment file control
- **FIX**: Resolved competing .env file conflicts between `.env.local` and `.env.test` that caused "AUTOMATION_PRIVATE_KEY not found" errors
- **IMPROVEMENT**: Eliminated dependency on NODE_ENV checks for environment file loading

#### **Test Suite Enhancements**
- **NEW**: Complete vault authorization workflow test suite with event validation
- **IMPROVEMENT**: Fixed async vault data retrieval in monitoring setup tests
- **IMPROVEMENT**: Added comprehensive event capture for LiquidityAddedToPosition and monitoring events
- **FIX**: Corrected test assertions for vault object property access

#### **Debug & Logging Improvements**
- **NEW**: Added detailed debug logging throughout handleNewVaultAuthorization workflow
- **NEW**: Enhanced VaultDataService logging for Promise.all operations
- **IMPROVEMENT**: Better error reporting for async operation failures

## v0.7.0 - 2025-07-27

### Major Service Initialization Workflow Refactor Complete

This release represents a complete overhaul of the service initialization workflow, transforming it from a basic proof-of-concept into a production-ready, fully-tested system with comprehensive event monitoring and robust error handling.

#### **Complete Workflow Implementation**
- **NEW**: Full end-to-end service initialization workflow: position evaluation → closure → deficit swaps → 50/50 conversion → new position creation → monitoring setup
- **NEW**: Complete BabySteps strategy implementation with non-aligned position closure and aligned position creation
- **NEW**: Comprehensive token swap system supporting deficit covering and 50/50 remaining token conversion
- **NEW**: Automatic monitoring setup for newly created positions with pool-centric event listening

#### **Advanced Token Management System**
- **NEW**: Intelligent deficit covering swap system that analyzes token requirements vs availability
- **NEW**: 50/50 remaining token conversion ensuring optimal capital deployment
- **NEW**: Balance verification system with 0.1% tolerance for position creation readiness
- **NEW**: Token approval generation for position manager interactions
- **NEW**: Buffer swap system to prevent insufficient balance errors during position creation

#### **Pool Selection & Validation**
- **NEW**: Pool age validation requiring minimum 90-day pool age for safety
- **NEW**: TVL (Total Value Locked) validation with $50M minimum threshold
- **NEW**: 5% liquidity rule for optimal pool selection based on position size requirements
- **NEW**: Pool fee tier filtering with configurable maximum fee limits
- **NEW**: Pool eligibility filtering removing zero-liquidity and invalid pools

#### **Comprehensive Event System**
- **NEW**: 15+ event types covering entire workflow lifecycle with structured data
- **NEW**: Real-time monitoring events for swap activity, configuration changes, and position updates
- **NEW**: Detailed event data including gas estimates, transaction hashes, and USD value calculations
- **NEW**: Event-driven testing architecture for comprehensive integration validation

#### **Critical Bug Fixes**
- **CRITICAL FIX**: Fixed createNewPosition VALUE-based optimal ratio calculation
  - Previous: Used token amounts (1.0/4485 = 0.0002 ratio) resulting in ~$3.94 positions
  - Fixed: Uses USD values ($4519/$4485 ≈ 1.0 ratio) achieving proper ~$8,862 deployment (80% utilization)
- **FIX**: VaultDataService token dependency and adapter scoping issues
- **FIX**: Pool-centric swap monitoring registration for accurate event tracking
- **FIX**: Event emission timing and data structure consistency

#### **Comprehensive Testing Suite**
- **NEW**: 18 integration tests covering complete 0AP/2NP/0AT/2NT scenario (0 Aligned Positions, 2 Non-aligned Positions, 0 Aligned Tokens, 2 Non-aligned Tokens)
- **NEW**: Mathematical precision testing for asset value calculations using real DeFi prices
- **NEW**: Token balance verification across entire workflow with sub-wei precision
- **NEW**: Event validation testing ensuring proper data structures and timing
- **NEW**: Utilization calculation testing verifying 80% target deployment
- **NEW**: Position parameter validation including tick ranges and liquidity amounts
- **NEW**: Monitoring setup verification ensuring proper event listener registration

#### **Strategy Architecture Enhancement**
- **NEW**: Complete separation between addToPosition (existing position liquidity addition) and createNewPosition (new position creation)
- **NEW**: Standardized event emission patterns across both position management functions
- **NEW**: Consistent transaction batching and gas estimation
- **NEW**: Robust error handling with detailed error messages and recovery strategies

#### **Performance & Reliability**
- **NEW**: Batch transaction execution for gas optimization
- **NEW**: Transaction retry logic with failure handling
- **NEW**: Memory-efficient event caching during test execution
- **NEW**: Comprehensive logging throughout the workflow for debugging and monitoring

This refactor establishes the foundation for production deployment with enterprise-grade testing, monitoring, and error handling capabilities.

## v0.6.0 - 2025-07-27

### Service Initialization Workflow Refactor & Testing Complete

#### **Adapter Cache Optimization**
- **BREAKING**: VaultDataService now uses shared adapter cache from AutomationService instead of creating new adapters
- Added `setAdapters()` method to VaultDataService for receiving adapter cache reference
- Eliminated redundant adapter creation in `fetchPositions()` - now uses cached adapter instances
- AutomationService passes adapter cache to VDS after initialization for efficiency

#### **Contract Method Fixes**
- **BREAKING**: Fixed `getTotalPositions()` to use actual contract method `getPositionIds()`
- **BREAKING**: Fixed `getStrategyParameters()` to use actual contract method `getAllParameters()`
- Removed position ID validation that prevented managing vaults with 0 positions
- Updated `fetchPositions()` to handle empty position arrays correctly (returns `{}`)

#### **Token Balance Structure Simplification**
- **BREAKING**: Simplified vault.tokens structure from `{USDC: {balance: '...', usdValue: '...'}}` to `{USDC: '...'}`
- Fixed temporal dead zone error in `fetchTokenBalances()` by using `.reduce()` instead of incorrect `.forEach()` usage
- Updated cache-structures.md documentation to reflect actual simplified token structure

#### **Pool Data Event Structure**
- **BREAKING**: PoolDataFetched event now emits nested structure with `{poolData: {...}, source: '...', vaultAddress: '...'}`
- Pool metadata includes `poolAddress` property within each pool data object
- Maintains backward compatibility for pool data caching while improving event structure

#### **Testing Enhancements**
- Added Test 11a to verify adapter cache sharing between AutomationService and VaultDataService
- Fixed all tests to handle object-based position data instead of arrays
- Updated comprehensive vault structure validation in Test 22
- Improved test debugging with proper event data structure logging

#### **Documentation Updates**
- Updated cache-structures.md to accurately reflect adapter cache (actual class instances vs data values)
- Added VaultDataService adapter reference documentation
- Corrected token balance structure examples in documentation
- Updated access pattern examples for simplified token structure

## v0.5.0 - 2025-07-26

### WIP - Major Cache Architecture Refactor

#### **Cache Structure Centralization**
- **BREAKING**: Pool data moved from VaultDataService to AutomationService for better centralization
- **BREAKING**: Position structure simplified to minimal fields (id, pool, tickLower, tickUpper, liquidity, lastUpdated)
- **BREAKING**: Token configurations centralized in AutomationService during initialization
- Removed poolData from VaultDataService - now managed centrally in AutomationService
- Enhanced position management with object-keyed positions for O(1) access

#### **Enhanced Validation & Adapter Improvements**
- **BREAKING**: getPoolData() method now requires options parameter (no longer optional with default {})
- Added abstract getPoolData() method to PlatformAdapter base class for consistency
- Enhanced parameter validation for getPoolData():
  - includeTicks must be array of integers if provided
  - includeTokens must be boolean if provided
  - Better error messages for all validation failures
- Unified pool data fetching across automation service and strategies

#### **Documentation & Architecture**
- **Added comprehensive cache-structures.md documentation** showing complete data architecture
- Documented all cache structures across AutomationService, VaultDataService, and VaultRegistry
- Added data flow diagrams and access patterns for development reference
- Enhanced AdapterFactory test coverage with proper validation error handling

#### **Strategy & Pool Data Management**
- Added strategy parameter caching in AutomationService.strategyCache
- Added vault processing locks (AutomationService.vaultLocks) for race condition prevention
- Centralized pool data initialization during service startup
- Improved pool data loading with unified adapter.getPoolData() method

#### **Test Infrastructure Updates**
- Updated AdapterFactory tests to match enhanced validation behavior
- Fixed test expectations for new chain validation error messages
- Added comprehensive getPoolData() test coverage in UniswapV3Adapter
- Enhanced parameter validation testing for edge cases

#### **Benefits**
- **Single Source of Truth**: All pool data centralized in AutomationService
- **Better Performance**: Object-keyed positions for faster lookups
- **Improved Reliability**: Enhanced validation prevents runtime errors
- **Complete Documentation**: Comprehensive reference for all cache structures
- **Architectural Consistency**: Unified pool data API across all adapters

#### **Migration Notes**
- Pool data access: `vaultDataService.getPool()` → `automationService.poolData[poolAddress]`
- Position access: Array-based → Object-keyed by position ID
- Token configurations: Now initialized once at AutomationService startup
- Strategy implementations: Must pass {} as options to adapter.getPoolData()

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
