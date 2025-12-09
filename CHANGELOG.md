# F.U.M. Project Changelog

## [1.0.0] Production Release - 2025-12-09

### Production Release

First production release of fum_automation with complete Baby Steps strategy implementation and comprehensive testing.

#### **Repository Cleanup & Documentation**
- **ADDED**: LICENSE.md with proprietary license terms
- **ADDED**: TESTING.md with comprehensive testing documentation
- **UPDATED**: README.md with GitHub repository links and production configuration notes
- **UPDATED**: API documentation for AutomationService, EventManager, utilities

#### **Test Infrastructure**
- **ADDED**: Comprehensive utilities.test.js for retryWithBackoff function
- **ADDED**: BS-1vault-1020.test.js swap event workflow test
- **UPDATED**: Workflow tests for improved reliability
- **UPDATED**: Ganache setup and test configuration
- **UPDATED**: Scenario configurations (0202, 1111, 2020, default)

#### **Helper Refactoring**
- **ADDED**: Permit2Helpers.js for permit2 signature utilities
- **REFACTORED**: helpers.js improvements for production reliability
- **UPDATED**: UniswapV3BabyStepsStrategy for improved swap handling

#### **Configuration Updates**
- **UPDATED**: Environment example with production recommendations
- **UPDATED**: Dependency to fum_library v1.0.0

**Status**: ✅ Production Ready
**Breaking Changes**: None from v0.17.0
**Dependency**: Requires fum_library v1.0.0
**Impact**: Ready for mainnet deployment

## [0.17.0] Buffer Swap Threshold & Config Cleanup - 2025-12-01

### Minimum Buffer Swap Value Threshold

Integrated library's new `minBufferSwapValue` config to prevent economically irrational dust swaps.

#### **BabyStepsStrategy.js**
- **NEW**: Import `getMinBufferSwapValue` from fum_library
- **NEW**: Filter in `swapRemainingTokens5050()` skips tokens below USD threshold
- **IMPACT**: Prevents gas waste on dust swaps (e.g., 1 wei swap costing $2.65 in gas)

#### **VaultDataService.js**
- **REMOVED**: `enabled` property check in `inferPlatformFromReceipt()` (adapting to library v0.24.0)

**Status**: ✅ Integration complete
**Breaking Changes**: None
**Dependency**: Requires fum_library v0.24.0+

## [0.16.0] Transaction History & Demo Support - 2025-01-28

### Vault REST API & Transaction Logging

Added REST API endpoints for vault data access and transaction history logging to support frontend demo and analytics features.

#### **New REST API Endpoints**
- **NEW**: `GET /vault/:address/metadata` - Returns vault tracker metadata (baseline, snapshots, aggregates)
- **NEW**: `GET /vault/:address/transactions` - Returns paginated transaction history with filtering options
- **FEATURE**: Query parameters for filtering: `?limit=N&offset=N&type=swap|fee|rebalance`

#### **SSE Events**
- **NEW**: `TransactionLogged` event - Broadcasts when new transactions are logged for vault activity feeds

#### **Tracker Enhancements**
- **NEW**: `AssetValuesFetched` event listener - Updates vault snapshots with current values for APY calculation
- **NEW**: Fee tracking split: `cumulativeFeesReinvestedUSD` and `cumulativeFeesWithdrawnUSD` aggregates
- **FIXED**: Token decimals lookup using `getTokenBySymbol()` for accurate swap value calculations

#### **Logging Cleanup**
- **REDUCED**: Removed verbose `Filter details:` object dump from EventManager registration
- **REDUCED**: Moved `vaultLoaded` and `positionsRefreshed` VDS events to debug-only logging
- **REDUCED**: Set `includeData: false` on `VaultAuthGranted` event emission

**Status**: ✅ Demo support complete
**Breaking Changes**: None
**Impact**: Frontend can now display transaction history and calculate APY metrics

## [0.15.0] Security Refactor - Constrained Vault Operations - 2025-01-26

### Automation Service Security Alignment

Updated automation service to use new constrained PositionVault functions, eliminating arbitrary contract call capabilities.

#### **Transaction Execution Security**
- **UPDATED**: `executeBatchTransactions()` now dispatches to constrained vault functions based on type parameter
- **NEW**: Type parameter validation: `swap`, `approval`, `mint`, `addliq`, `subliq`, `collect`, `burn`
- **SECURITY**: All token swaps route through `vault.swap()` with Universal Router validation
- **SECURITY**: All approvals route through `vault.approve()` with spender whitelist validation
- **SECURITY**: All position operations route through dedicated vault functions with selector validation

#### **Vault Initialization Fix**
- **FIXED**: Race condition between vault initialization and recovery mechanism
- **NEW**: `lockVault()` called at start of `initializeVaultForStrategy()`
- **NEW**: `unlockVault()` in finally block ensures proper cleanup on success or failure
- **IMPACT**: Prevents parallel position creation attempts during initial setup

#### **Code Changes**
- **UPDATED**: All `executeBatchTransactions()` calls now include explicit type parameter
- **REMOVED**: Direct `execute()` calls for automation operations
- **MAINTAINED**: `executePermit2Approval()` uses `vault.approve()` directly (still constrained)

**Status**: ✅ Security alignment complete
**Breaking Changes**: Requires PositionVault v0.5.0 with constrained functions
**Impact**: Automation service can no longer execute arbitrary contract calls

## [0.14.1] SSE Event Refinements - 2025-01-24

### SSE Broadcast Event Optimization

Refined the SSE event broadcasting system to reduce redundancy and improve clarity of event purposes.

#### **Added Events**
- **NEW**: `VaultBlacklisted` - Explicit blacklist event for time-based failures
- **NEW**: `VaultUnblacklisted` - Explicit unblacklist event for vault recovery

#### **Removed Events**
- **REMOVED**: `VaultAuthGranted` - Redundant with frontend transaction handling
- **REMOVED**: `VaultAuthRevoked` - State clearing now handled locally in frontend
- **REMOVED**: `VaultOnboarded` - Covered by asset change events (NewPositionCreated, TokensSwapped)
- **REMOVED**: `VaultOffboarded` - No on-chain changes, handled locally in frontend
- **REMOVED**: `VaultRecovered` - Redundant with NewPositionCreated + PositionRebalanced

#### **Impact**
- **EVENT COUNT**: Reduced from 20 to 15 broadcast events
- **CLARITY**: Each event now represents unique backend-driven state changes
- **EFFICIENCY**: Frontend handles user-initiated actions locally without SSE round-trip
- **COVERAGE**: All recovery scenarios still emit appropriate events

**Status**: ✅ SSE event system optimized
**Breaking Changes**: None (frontend updated in sync)
**Impact**: Cleaner event architecture with reduced network traffic

## [0.14.0] Fail-Together Architecture & Configuration Improvements - 2025-01-23

### Service Reliability & Configuration

This release implements a fail-together architecture between SSE and automation services, adds required configuration for failure handling, and improves service resilience.

#### **Fail-Together Architecture**
- **NEW**: SSE runtime crashes now terminate the entire service (`onCrash` callback)
- **NEW**: Automation crashes now cleanly shutdown SSE before terminating
- **NEW**: `uncaughtException` and `unhandledRejection` handlers ensure clean shutdowns
- **NEW**: `isShuttingDown` flag prevents new SSE connections during shutdown
- **BEHAVIOR**: 503 responses during shutdown prevent reconnection attempts from blocking exit
- **IMPACT**: SSE connection state now reliably indicates automation service status

#### **Required Configuration Parameters**
- **BREAKING**: `MAX_FAILURE_DURATION_MS` is now required (no default fallback)
- **BREAKING**: `RETRY_INTERVAL_MS` already required (from v0.13.0)
- **NEW**: Comprehensive unit tests for all configuration validation
- **VALUES**:
  - Testing: `MAX_FAILURE_DURATION_MS=60000` (1 minute)
  - Production: `MAX_FAILURE_DURATION_MS=3600000` (1 hour)

#### **Environment Configuration**
- **UPDATED**: `.env.example` with `MAX_FAILURE_DURATION_MS` documentation
- **UPDATED**: `.env.local` with production defaults (1 hour)
- **UPDATED**: `test/.env.test` with testing defaults (1 minute)
- **ADDED**: `test/unit/AutomationService.config.test.js` - 75 tests for config validation

#### **SSE Broadcaster Enhancements**
- **NEW**: Runtime error handler distinguishes startup vs runtime failures
- **NEW**: `onCrash` callback parameter for fatal error propagation
- **NEW**: Graceful shutdown rejects new connections during cleanup
- **FIXED**: Server shutdown sequence now prevents reconnection-blocking

#### **Startup Script Updates**
- **ADDED**: `MAX_FAILURE_DURATION_MS` to required environment variables
- **ADDED**: Startup logging for max failure duration (displays in hours)
- **UPDATED**: Config validation to enforce new required parameter

**Status**: ✅ Production-ready fail-together architecture
**Breaking Changes**: `MAX_FAILURE_DURATION_MS` must be set in environment
**Impact**: Reliable service health monitoring via SSE connection status

## [0.13.0] SSE Broadcasting & VaultDataService Fixes - 2025-11-23

### Real-Time Event Broadcasting

This release adds Server-Sent Events (SSE) broadcasting for real-time UI updates and fixes critical issues with position tracking in VaultDataService.

#### **SSE Broadcasting System**
- **NEW**: SSEBroadcaster class for real-time event streaming to connected clients
- **NEW**: HTTP server on configurable port (default 3001) for SSE connections
- **NEW**: CORS support for cross-origin requests from frontend applications
- **NEW**: Automatic event broadcasting for all AutomationService events
- **NEW**: Client connection management with automatic cleanup on disconnect
- **INTEGRATION**: AutomationService now accepts optional SSEBroadcaster instance

#### **VaultDataService Fixes**
- **CRITICAL FIX**: Removed dependency on `vault.getPositionIds()` which was unreliable
- **ROOT CAUSE**: Uniswap V3's NonfungiblePositionManager uses `_mint()` not `_safeMint()`, so vault's `onERC721Received` callback is never triggered
- **SOLUTION**: VDS now always queries platform adapters directly for positions
- **REMOVED**: `getPositionIds()` call from `loadVault()` - positions fetched via adapters
- **REMOVED**: `getPositionIds()` call from `refreshPositionsAndTokens()` - same approach
- **SIMPLIFIED**: `fetchPositions()` method no longer takes positionIds parameter

#### **Startup Script**
- **NEW**: `scripts/start-automation.js` - Production-ready startup script
- **FEATURE**: Accepts optional env file path as argument (default: `.env`)
- **FEATURE**: Automatic SSE server startup with configurable port
- **FEATURE**: Graceful shutdown handling (SIGINT, SIGTERM)

#### **Library Upgrade**
- **UPDATED**: fum_library v0.22.1 → v0.22.2
- **INCLUDES**: Runtime API key resolution fix for Arbitrum RPC

**Status**: ✅ Complete SSE integration with real-time event streaming
**Breaking Changes**: None - SSE is opt-in via constructor parameter
**Impact**: Enables real-time UI updates for vault monitoring dashboards

## [0.12.1] Emergency Exit Position Closure Bug Fix - 2025-10-07

### Bug Fixes

This patch release fixes a critical bug in the emergency exit workflow where closed positions were not being properly tracked and logged.

#### **Emergency Exit Position Tracking**
- **FIXED**: Emergency exit position closure now properly tracks and logs closed positions
- **ROOT CAUSE**: `executeEmergencyExit()` passed reference to `vault.positions` instead of shallow copy
- **ISSUE**: When `closePositions()` deleted keys from `vault.positions`, it also deleted from the same object being used to build the `PositionsClosed` event
- **RESULT**: Event showed `closedCount: 0` and `closedPositions: []` despite position being successfully closed
- **SOLUTION**: Changed line 3657 in BabyStepsStrategy.js to create shallow copy: `const allPositions = { ...(vault.positions) }`
- **CONSISTENCY**: Fix matches pattern used in other call sites (rebalance, initialization)

#### **Test Coverage**
- **UPDATED**: BS-0000.test.js emergency exit test now validates proper position closure tracking
- **VERIFIED**: All 6 swap event detection tests passing with fix in place
- **VALIDATED**: Emergency exit properly logs closed position count and details

**Status**: ✅ All tests passing - emergency exit tracking now working correctly
**Impact**: Emergency exit events now accurately reflect positions closed during safety threshold triggers

## [0.12.0] Complete Data Tracking & Performance Analytics - 2025-10-05

### Comprehensive Event Tracking and Data Persistence

This release completes the data tracking refactor, implementing comprehensive event tracking and data persistence for all vault operations. The system now tracks quoted vs. actual amounts, gas costs, slippage, and performance metrics for positions, swaps, and fee collections.

#### **Phase 1: Gas Tracking Infrastructure**
- **ADDED**: Gas cost tracking (ETH and USD) for all transaction types
- **ADDED**: `calculateGasUSD()` method in Tracker.js using real-time ETH price
- **UPDATED**: All event handlers to calculate and store gas costs
- **TRACKING**: Gas estimates, actual gas used, and USD conversion per transaction

#### **Phase 2: Swap Event Tracking**
- **ADDED**: `handleTokensSwapped()` event handler in Tracker.js
- **ENHANCED**: Swap tracking with per-swap USD enrichment and slippage calculation
- **TRACKING**: Quoted vs. actual amounts, price impact, USD values for all swaps
- **METADATA**: Cumulative swap counts and gas costs in metadata.json

#### **Phase 3: Position Creation & Liquidity Addition Events**
- **ADDED**: `extractPositionAmountsFromReceipt()` method in BabyStepsStrategy.js
- **PARSING**: IncreaseLiquidity and Mint events from transaction receipts
- **ADDED**: `handleNewPositionCreated()` event handler in Tracker.js
- **ADDED**: `handleLiquidityAddedToPosition()` event handler in Tracker.js
- **TRACKING**: Quoted vs. actual token amounts from Uniswap quotes and receipts
- **CALCULATION**: Position creation slippage and USD variance tracking
- **ENHANCED**: Event emissions include both expected (quoted) and consumed (actual) amounts

#### **Data Structure Enhancements**
- **transactions.jsonl**: Append-only log with enriched transaction data
  - Quoted and actual amounts for all position operations
  - USD values for all token amounts using real-time prices
  - Slippage/difference calculations (USD and percentage)
  - Gas costs in ETH and USD per transaction
  - Complete swap details with price impact analysis
- **metadata.json**: Aggregated performance metrics
  - Cumulative gas costs (ETH and USD)
  - Transaction, swap, rebalance, and fee collection counters
  - Baseline and snapshot tracking for ROI calculation

#### **Test Coverage**
- **UPDATED**: BS-1vault-1111.test.js - Liquidity addition scenario validation
- **UPDATED**: BS-1vault-0202.test.js - New position creation scenario validation
- **UPDATED**: BS-1vault-2020.test.js - Existing position liquidity validation
- **VERIFIED**: All tracking data matches transaction logs with mathematical precision

**Status**: ✅ Complete data tracking for gas, swaps, positions, and fees
**Impact**: Comprehensive performance analytics and ROI tracking for all vault operations
**Breaking Changes**: Event structure changes (internal only - renamed fields for clarity)

## [0.11.1] Library Upgrade - EXACT_OUTPUT Quoting Support - 2025-10-02

### Dependency Update: fum_library v0.20.0 → v0.21.0

This patch release updates the automation to be compatible with fum_library v0.21.0, which introduces BREAKING API changes for swap quoting methods.

#### **Library API Changes (BREAKING)**
- **REFACTORED**: `getBestSwapQuote()` now uses `amount` + `isAmountIn` boolean instead of `amountIn`
- **REFACTORED**: `getSwapRoute()` now uses `amount` + `isAmountIn` boolean instead of `amountIn`
- **ADDED**: Support for EXACT_OUTPUT quoting (isAmountIn: false) - specify desired output, get required input
- **MAINTAINED**: EXACT_INPUT quoting (isAmountIn: true) - specify input amount, get expected output

#### **Automation Code Updates**
- **UPDATED**: `BabyStepsStrategy.handleTokenSwap()` - Now uses EXACT_OUTPUT quoting for deficit calculation
- **UPDATED**: `UniswapV3BabyStepsStrategy.generateSwapTransaction()` - Accepts `isAmountIn` parameter
- **UPDATED**: `UniswapV3BabyStepsStrategy.generateBufferSwapTransactions()` - Passes `isAmountIn: true` for buffer swaps

#### **Performance Improvements (from library)**
- **OPTIMIZATION**: Reduced AlphaRouter calls from 3 to 2 per deficit swap (or 1 in best case)
- **LOGIC**: Uses EXACT_OUTPUT to directly determine required input for target deficit
- **ELIMINATED**: Redundant proportional calculation and re-quote when sufficient tokens available

**Status**: ✅ All swap operations updated for library compatibility
**Breaking Changes**: Internal only - no changes to automation behavior or external API
**Impact**: Better swap efficiency through library optimizations

## [0.11.0] Complete Permit2 Swap Integration - 2025-02-02

### Gasless Swaps via Permit2 + UniversalRouter

This release completes the Permit2 integration by implementing signature-based gasless swaps for all swap operations in the BabySteps strategy. Both deficit covering swaps and 50/50 buffer swaps now use Permit2 signatures with UniversalRouter, eliminating the need for separate approval transactions.

#### **Swap Operations Refactored**
- **REFACTORED**: `prepareTokensForPosition()` - Deficit swaps now use Permit2 + UniversalRouter
- **REFACTORED**: `swapRemainingTokens5050()` - Buffer swaps now use Permit2 + UniversalRouter (already implemented)
- **ADDED**: `generateSwapTransaction()` method in UniswapV3BabyStepsStrategy for generic Permit2 swaps
- **UPDATED**: `handleTokenSwap()` to use platform handler's `generateSwapTransaction()` with Permit2
- **REMOVED**: Approval transaction generation from `prepareTokensForPosition()` (no longer needed)
- **ENHANCED**: Per-token nonce tracking to prevent nonce collisions in batch swaps

#### **Nonce Management**
- **LOGIC**: Local nonce cache per token address to handle multiple swaps of same token in one batch
- **FETCH**: Base nonce fetched once per token from Permit2 contract's `allowance()` function
- **INCREMENT**: Nonce incremented locally after each swap for same token
- **ISOLATION**: Different tokens have independent nonce counters (as per Permit2 spec)

#### **Helper Updates**
- **ENHANCED**: `generatePermit2Signature()` in helpers.js now accepts optional `nonce` parameter
- **FALLBACK**: Helper fetches nonce from chain if not provided (backwards compatible)
- **SIGNATURE**: EIP-712 signatures include nonce for replay protection

#### **Test Updates**
- **UPDATED**: BS-1vault-1111.test.js - Expects UniversalRouter, no approval transactions for deficit swaps
- **UPDATED**: BS-1vault-2020.test.js - Expects UniversalRouter, no approval transactions for deficit swaps
- **VERIFIED**: BS-1vault-0202.test.js - No changes needed, passes with Permit2 swaps
- **REMOVED**: Approval batch event assertions from all tests (Permit2 doesn't need separate approvals)

#### **Gas Savings**
- **BEFORE**: Deficit swaps required 2 transactions per token (1 approval + 1 swap)
- **AFTER**: Deficit swaps require 1 transaction per swap (approval via signature)
- **IMPACT**: ~50% reduction in transactions for token preparation operations
- **EXAMPLE**: 2 deficit swaps now use 2 transactions instead of 4

**Status**: ✅ All tests passing - Complete Permit2 swap integration functional
**Breaking Changes**: None - all swaps now gasless via Permit2
**Impact**: Significant gas cost reduction, faster vault operations, better UX
**Dependencies**: Requires vaults to have Permit2 approvals set up (from v0.10.0)

## [0.10.0] Permit2 Integration - 2025-09-30

### Permit2 Universal Approval System

This release integrates Uniswap's Permit2 approval system to enable gasless operations and reduce transaction costs for vault operations. All vaults now automatically set up Permit2 approvals for all tokens during initialization.

#### **Permit2 Integration**
- **ADDED**: Permit2 approval setup during vault initialization
- **ADDED**: `setupPermit2Approvals()` method to manage universal approvals for all vault tokens
- **ADDED**: `checkPermit2Approval()` method to verify existing Permit2 allowances
- **ADDED**: `executePermit2Approval()` method to execute approval transactions via vault.execute()
- **ENHANCED**: Token approval detection to include vault balance tokens, target tokens, and position tokens
- **DEPENDENCY**: Added `@uniswap/permit2-sdk` (^1.4.0) for Permit2 constants and utilities
- **DEPENDENCY**: Added `@uniswap/universal-router-sdk` (^4.19.7) for future gasless swap integration
- **DEPENDENCY**: Added `tslib` (^2.8.1) as required peer dependency for Permit2 SDK

#### **Approval Management**
- **ENHANCED**: Automatically extracts tokens from vault positions via poolData for comprehensive approval coverage
- **LOGIC**: Approvals set to MaxUint256 for one-time universal approval per token
- **VALIDATION**: Checks existing allowances before executing approval transactions (≥ MaxUint256/2 threshold)
- **FAILURE**: Vault setup now fails if Permit2 approvals cannot be established
- **ORDER**: Permit2 approvals execute BEFORE vault strategy initialization (before any swaps/liquidity adds)

#### **Test Coverage**
- **ADDED**: Permit2 approval assertions to service-init 1111 test (USDC, WBTC, WETH)
- **ADDED**: Permit2 approval assertions to service-init 2020 test (USDC, WETH)
- **ADDED**: Permit2 approval assertions to service-init 0202 test (WBTC, USD₮0, WETH)
- **ADDED**: Permit2 approval assertions to vault-auth 1111 test (USDC, WBTC, WETH)
- **VERIFIED**: All tests validate Permit2 approvals for ALL tokens vault starts with (not just target tokens)

#### **Architecture Updates**
- **REFACTORED**: `setupVault()` method to include Permit2 setup as Step 2 (before Step 3: vault initialization)
- **RETURNS**: `setupPermit2Approvals()` returns boolean for success/failure validation
- **ERROR HANDLING**: Permit2 setup failures now throw errors and prevent vault initialization
- **POSITION TOKENS**: Approval logic now accounts for tokens locked in vault positions via `poolData` metadata

**Status**: ✅ All tests passing - Permit2 integration complete and ready for gasless operations
**Breaking Changes**: None - backwards compatible, all vaults now use Permit2
**Impact**: Enables future gasless swap operations, reduces gas costs from 2 transactions to 1 per swap
**Future Work**: Implement EIP-712 signature-based swaps using Permit2 approvals via Universal Router

## [0.9.0] Ethers v5 Migration - 2025-09-30

### Complete Migration from Ethers v6 to v5

This release completes the migration from ethers v6 to v5 to match fum_library v0.19.1, ensuring compatibility and resolving all breaking changes in event handling, BigNumber operations, and contract interactions.

#### **Core Library Updates**
- **MIGRATED**: All ethers v6 imports changed to ethers v5 syntax
- **UPDATED**: Event listener registration using ethers v5 filter patterns
- **FIXED**: BigNumber operations - removed `.toBigInt()` calls (v5 BigNumber doesn't have this method)
- **FIXED**: Contract interface instantiation using `new ethers.utils.Interface()`
- **UPDATED**: Event parsing using v5 `parseLog()` method

#### **Event Handling Refactor**
- **FIXED**: Swap event detection in EventManager using proper v5 filter syntax
- **FIXED**: Fee collection event parsing from transaction receipts
- **ENHANCED**: Pool Collect event parsing with proper recipient and tick range validation
- **UPDATED**: All event listeners to use v5-compatible filter registration

#### **Test Suite Updates**
- **FIXED**: All swap event detection tests updated for v5 compatibility
- **ENHANCED**: Tighter position ranges (25 bps) for more reliable rebalance testing
- **FIXED**: Emergency exit trigger reduced to 60 bps to match actual price movements
- **ADDED**: Proper event listener setup for VaultLocked/VaultUnlocked events
- **VERIFIED**: Complete test suite passing (6/6 tests)

#### **Strategy Parameter Updates**
- **ADJUSTED**: Target range parameters from 50 bps to 25 bps for tighter rebalancing
- **TUNED**: Emergency exit trigger from 70 bps to 60 bps for test reliability
- **MAINTAINED**: All other strategy parameters at production defaults

#### **Bug Fixes**
- **FIXED**: Fee tier pool selection - ensure consistent 500 bps pool usage across tests
- **FIXED**: TVL mocking to return different values per fee tier for proper pool selection
- **FIXED**: Pool data fetching to use correct fee tier in reverse rebalance test
- **REMOVED**: All temporary debug logs added during migration

**Status**: ✅ All tests passing - migration complete and production ready
**Breaking Changes**: Requires ethers v5 and fum_library v0.19.1+
**Impact**: Full compatibility with updated library, all automation features working

## [0.8.1] Price Event Workflow Refactor - Fee Distribution & Collection - 2025-09-24

### Complete Price Event Workflow Implementation

This release delivers a comprehensive refactor of the BabySteps strategy swap event handling, implementing proper fee collection with distribution, respecting reinvestment ratios during rebalances, and ensuring consistent fee handling across all operations.

#### **Fee Collection Implementation**
- **IMPLEMENTED**: Actual fee collection via Uniswap V3 Position Manager's collect function
- **ADDED**: Transaction execution through vault's execute function for proper authorization
- **ENHANCED**: Transfer event parsing to track collected amounts accurately
- **FIXED**: Multiple import and reference errors in fee collection logic

#### **Fee Distribution System**
- **NEW**: `distributeFeesToOwner` helper method for consistent fee distribution
- **RESPECTS**: ReinvestmentRatio parameter - owner receives their percentage (0-100%)
- **UNIFIED**: Same distribution logic for explicit collection and rebalance scenarios
- **IMPROVED**: Proper basis points calculation accounting for percentage vs basis points storage

#### **Rebalance Fee Handling**
- **MAJOR FIX**: Rebalances now properly distribute fees to owner based on reinvestmentRatio
- **ADDED**: `extractFeesFromClosureEvents` method to parse fees from position closure
- **ENHANCED**: `closePositions` returns receipt and metadata for fee extraction
- **REFACTORED**: `rebalancePosition` to handle fee distribution during position closure

#### **Event Architecture**
- **STREAMLINED**: Single `FeesCollected` event contains all fee distribution information
- **REMOVED**: Redundant `TokensDisbursed` event (info already in FeesCollected)
- **ENHANCED**: Events include source tracking ('explicit_collection' vs 'rebalance')
- **IMPROVED**: Comprehensive event data including reinvested and distributed amounts

#### **Test Improvements**
- **UPDATED**: Tests use one-way swaps (ETH→USDC) for more predictable behavior
- **ADDED**: Break condition when fee collection triggers to prevent unnecessary swaps
- **ENHANCED**: Safety limits and pre-approvals for efficient test execution
- **VERIFIED**: All swap event detection tests passing with new implementation

#### **Technical Fixes**
- **FIXED**: Dynamic import replaced with static imports for coingecko service
- **FIXED**: Missing provider parameter in generateClaimFeesData calls
- **FIXED**: Non-existent getVaultSigner method - creates signer directly
- **FIXED**: "Not approved" error by executing through vault's execute function
- **FIXED**: fetchPrices typo corrected to fetchTokenPrices

**Status**: ✅ All tests passing - complete implementation ready for production
**Impact**: Critical feature addition for automated fee management in liquidity positions

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
