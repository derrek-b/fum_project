# Changelog

All notable changes to the F.U.M. project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]
### Added
- Completing automation pipeline with transaction execution
- Performance metrics for strategy execution
- Strategy history tracking

## [0.4.2] - 2025-01-24
### SSE Event Handler Refinements

Updated automation event handling to align with backend event optimization and improve local state management.

#### **New Event Handlers**
- **NEW**: `VaultBlacklisted` handler - Sets blacklist state, clears retry state
- **NEW**: `VaultUnblacklisted` handler - Clears blacklist state
- **FIXED**: `VaultLoadRecovered` now clears blacklist state (was missing)

#### **Local State Management**
- **UPDATED**: `removeExecutor` transaction handler clears all automation states locally
  - Clears executor address
  - Clears `isBlacklisted` and `blacklistReason`
  - Clears `isRetrying` and `retryError`
- **REMOVED**: `VaultAuthRevoked` event handler (state clearing moved to transaction handler)

#### **Event Listener Updates**
- **REMOVED**: Listeners for `VaultAuthGranted`, `VaultAuthRevoked`, `VaultOnboarded`, `VaultOffboarded`, `VaultRecovered`
- **ADDED**: `LiquidityAddedToPosition` to refresh trigger events (was missing)
- **UPDATED**: Refresh trigger events list reduced from 9 to 7 events

#### **Impact**
- **CLARITY**: User actions handled locally, backend events for system-driven changes only
- **PERFORMANCE**: Reduced SSE event traffic and faster state updates for user actions
- **RELIABILITY**: All automation states properly cleared when user disables automation

**Status**: ✅ Event handling optimized
**Breaking Changes**: None (synchronized with automation service v0.14.1)
**Impact**: Cleaner event handling with improved responsiveness

## [0.4.1] - 2025-01-23
### Automation Service Connection Monitoring

Real-time automation service status monitoring with UI alerts for service availability.

#### **Service Connection Status UI**
- **NEW**: Global red alert banners on vault pages when automation service is disconnected
- **NEW**: Vault detail page disconnection alerts with clear messaging
- **NEW**: Automation toggle disabled when service is unavailable
- **BEHAVIOR**: Green pulsing dot only shows when vault is actively managed (enabled + connected + not blacklisted + not retrying)
- **IMPACT**: Users now have clear visibility into automation service availability

#### **SSE Event Integration**
- **UPDATED**: `useAutomationEvents` hook handles `VaultLoadFailed` and `VaultLoadRecovered` events
- **NEW**: Yellow retry warning banners when vaults are having temporary issues
- **NEW**: Retry warnings only show when service is connected (not during disconnections)
- **FIXED**: Retry and blacklist state cleared when automation is revoked

#### **Redux State Management**
- **UPDATED**: `vaultsSlice` includes `isRetrying` and `retryError` fields
- **BEHAVIOR**: Vault state accurately reflects automation service health
- **INTEGRATION**: Connection status from `automationSlice` drives all UI states

#### **UI Components Updated**
- **UPDATED**: `VaultCard` - Green dot checks all 4 conditions (enabled, not blacklisted, not retrying, connected)
- **UPDATED**: `vaults.js` - Global service disconnection banner
- **UPDATED**: `vault/[address].js` - Disconnection alerts, retry condition updates, toggle disable logic
- **CONSISTENCY**: All automation-related UI responds to service connection state

**Status**: ✅ Complete automation service monitoring
**Breaking Changes**: None
**Impact**: Clear user visibility into automation service health and vault management status

## [0.4.0] - 2025-11-23
### Major Architecture Refactor

Complete application refactor for library integration and ethers.js v5 compatibility.

#### **Ethers.js Migration (v6 → v5)**
- Migrated entire application from ethers.js v6 to v5 for library compatibility
- Moved ethers provider from Redux store to React Context for proper lifecycle management
- Updated all contract interactions for v5 API compatibility

#### **Library Integration Refactor**
- Complete vault pages and components refactor to use library functions directly
- Complete position pages and components refactor for library architecture
- Removed duplicate helper wrappers - now using library functions directly
- Implemented global data refresh system replacing per-component refresh logic
- Standardized error handling patterns across all vault and position modals

#### **UI/UX Improvements**
- Improved vault UI with better automation indicators and status feedback
- Improved position and vault card layouts with consistent styling
- Enhanced wallet connection UX with better loading states and error feedback
- Optimized vault detail page with React performance best practices (memoization, callbacks)
- Standardized input validation and number input UX across all modals
- Added strategy validation with structured warnings in modal UI

#### **New Features**
- AutomationStatus component for real-time SSE event streaming display
- Redux automationSlice for centralized automation state management
- useAutomationSSE hook for managing SSE connection lifecycle
- Token withdrawal functionality with improved modal UI
- Position transfer functionality between wallets and vaults

#### **Script Improvements**
- Consolidated vault setup in create-test-vault.js (target tokens, platforms, strategy, executor)
- Simplified seed.js to read addresses from deployment files instead of hardcoding

#### **Bug Fixes**
- Fixed vault configuration and strategy parameter saving bugs
- Fixed TokenDepositModal error handling and stale data issues
- Fixed position modal bugs during transfer operations
- Fixed data loading issues after wallet connection

#### **Code Cleanup**
- Removed unused vault components
- Removed price helper wrappers (using library directly)

### Deprecated
- PositionVault.getPositionIds() - unreliable for Uniswap V3 (uses _mint() not _safeMint())
  - Added deprecation notice in contract comments
  - Use platform adapters to query NFT contract directly instead

### Dependencies
- Updated fum_library to v0.22.3

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
