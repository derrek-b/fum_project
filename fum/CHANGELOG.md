# Changelog

All notable changes to the F.U.M. project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] - 2026-04-17

Major release spanning multi-platform support (Uniswap V4, Trader Joe V2.2), executor funding flows, and frontend architecture refresh. Package versions across the monorepo aligned at 2.0.0 to match Solidity contract versions.

### Multi-Platform Support

- **Uniswap V4** support: `UniswapV4PositionValidator` for V4 PositionManager ops (via nested action parsing inside `modifyLiquidities`), V4 command parsing inside `UniversalRouterValidator`, V4 seed/generate-fees/price-manipulation scripts.
- **Trader Joe V2.2** support: `TJPositionManager` wraps LB (ERC1155) positions with auto-incrementing IDs, deploying a `TJPositionProxy` (EIP-1167 minimal proxy) per position for per-position fee attribution. `TJSwapValidator` and `TJPositionValidator` secure LBRouter swaps and position-manager ops respectively. Avalanche chain (1338 local, 43114 production) supported via `npm run hardhat:av`.
- **TJPositionManager ownership model**: Position struct field renamed `vault → owner`; `getPositionsByVault → getPositionsByOwner`; added `safeTransferFrom(from, to, tokenId)` + `PositionTransferred` event for ERC721-like position transfers.

### Incentive Validator Layer

- New `IIncentiveValidator` interface; new incentive-validator registry on VaultFactory (`setIncentiveValidator`, `validateIncentive`).
- `MerklIncentiveValidator` validates Merkl Distributor `claim(user, tokens, amounts, proofs)` calls, requiring `user == vault`.
- New `PositionVault.incentive(targets, data, values)` function routes incentive claims through the validator chain.

### Per-Vault Signer & Executor Funding

- **VaultFactory v2.0.0**: `VaultInfo` struct gains `executorIndex` (monotonic counter assigned at `createVault`) for deterministic per-vault executor wallet derivation from an xpub/mnemonic. Added `getVersion()` returning `"2.0.0"`.
- **Active Vault Registry**: VaultFactory now tracks the working set of vaults that have executors set. `registerActiveVault`/`deregisterActiveVault` (vault-callable only), `activeVaults[]`, `activeVaultIndex` mapping (1-indexed), `getActiveVaults()`, `getActiveVaultCount()`.
- **PositionVault**: `setExecutor(address)` is now `payable` — `msg.value` is forwarded to the executor for initial gas funding. On first activation (executor `0x0` → non-zero) the vault registers with the factory's active-vault registry; `removeExecutor` deregisters.
- **PositionVault**: new `fundExecutor(uint256 amount) payable onlyAuthorized` for on-demand/automated top-ups; emits new `ExecutorFunded` event.

### BabyStepsStrategy v2.0.0 / ParrisIslandStrategy v0.4.0

- BabyStepsStrategy bumped to 2.0.0 (source: `BabyStepsStrategy.sol`).
- ParrisIslandStrategy advanced to v0.4.0 (still in development).

### Frontend — Automation UX

- `FundExecutorModal.js` shows when `isFundingRequired=true` on a vault.
- New vault state: `isFundingRequired`, `fundingRequiredAt`. Cleared by `ExecutorFunded` or explicit admin flows.
- SSE event additions/renames: `VaultFailed`/`VaultRecovered` replace `VaultLoadFailed`/`VaultLoadRecovered`; added `ExecutorFundingRequired`, `ExecutorFundingCleared`, `FeesDistributed`, `ExecutorFunded`, `NativeWrapped`, `NativeUnwrapped`.
- Retry button on blacklisted vaults allows manual unblock without requiring vault auth re-grant.
- Warn when saving strategy config for a token pair with no active pools on the selected platform.

### Frontend — Data Flow

- **Redux freshness strategy**: pages check per-domain freshness timestamps (`positionsLastFetched`, `vaultsLastFetched`, per-vault `lastUpdated`) before re-fetching. Stale >30s triggers re-fetch; fresh hits skip RPC.
- **Targeted SSE updates**: `sseEventHandlers.js` dispatches directly to Redux for known events (e.g. `TokensSwapped` → `refreshTokenBalances`, `NewPositionCreated` → `refreshSinglePosition`), bypassing freshness gate.
- **Adapter-level `getPositionsForDisplay`** interface; removed Redux pool/token cache — pool/token data now embedded in position objects and vault `tokenBalances`.
- **`useModalData` hook** wraps per-platform adapter calls for the action modals, making them platform-agnostic.
- Dual-provider refinement: `readProvider` race condition fix; stale-token ref cleanup; added `NEXT_PUBLIC_COINGECKO_API_KEY`.
- Detail pages (`vault/[address]`, `position/[id]`) wire their own refresh intervals since they don't watch the global freshness timestamps. Manual refresh via `RefreshControls` also invalidates the global timestamps so list pages re-fetch on next navigation.
- Context-aware navigation: post-close position redirect, back-link behavior.

### Frontend — Validator-Aware UI

- Close position flow now burns V3 NFT (burn allowed in V3 multicall) via `ClosePositionModal`.
- Token filtering by chain in deposit modals.

### Scripts & Tooling

- Seed scripts combined per-platform (`seed.js`, `seed-v4.js`, `seed-avalanche.js`) with opt-in `ENABLE_STRATEGY` and `ENABLE_AUTOMATION` flags. Old `create-test-vault.js` + `seed.js` two-step flow deprecated (files retained for manual invocation).
- V3/V4/TJ price-manipulation and fee-generation scripts rewritten for multi-platform support. Uses `hardhat_setStorageAt` to mint tokens directly rather than pool swaps.
- `npm run hardhat:av` spins up an Avalanche fork (chain 1338, port 8546) with TJ contracts deployed.
- API query filtering: `/blacklist` and `/funding-required` endpoints accept `?vaults=addr1,addr2` to scope to a user's vaults.

### Monorepo Migration

- `fum`, `fum_library`, `fum_automation`, `fum_testing` consolidated into the `fum_project` monorepo (git subtree). Full history preserved. Single git repo, no external remotes.
- CLAUDE.md files at root and per-subproject; architecture docs under `docs/` at each level; `/commit` and `/update-brain` workflow skills.

## [1.0.6] - 2025-12-18

### Platform-Agnostic Approval Model

Removes the spender whitelist from PositionVault to enable platform-agnostic token approvals. This change supports the broader goal of making the automation service work with multiple DEX platforms beyond Uniswap.

#### **Smart Contract Changes**
- **PositionVault** v1.2.0 → v1.3.0
  - **REMOVED**: Spender whitelist validation in `approve()` function
  - **REMOVED**: Restriction to only Permit2 and NonfungiblePositionManager as spenders
  - **MAINTAINED**: ERC20 approve selector validation (only `approve(address,uint256)` calls allowed)

#### **Security Note**
The spender whitelist was originally defense-in-depth. It is now safe to remove because:
- The `execute()` function is owner-only - executors cannot make arbitrary calls
- All executor-accessible functions (`swap`, `mint`, `collect`, etc.) validate recipients must be the vault
- All withdrawal functions (`withdrawTokens`, `withdrawETH`, `withdrawPosition`) hardcode the recipient to the vault owner
- The executor cannot redirect assets anywhere except back to the vault or the vault owner

#### **Impact**
- Enables standard ERC20 approvals to Universal Router (no longer requires Permit2 signatures)
- Supports future integration with other DEX platforms (Camelot, PancakeSwap, etc.)
- Simplifies automation service approval flow

**Status**: Production Ready
**Breaking Changes**: None (loosens restrictions, doesn't add new requirements)
**Dependency**: Enables fum_automation Permit2 removal refactor

---

## [1.0.5] - 2025-12-17

### Native ETH Wrap/Unwrap for Automation

Adds in-vault ETH wrapping and unwrapping functions for automation service operations.

#### **Smart Contract Changes**
- **PositionVault** v1.1.0 → v1.2.0
  - **ADDED**: `wrapETH(address weth, uint256 amount)` - Wrap native ETH to WETH (stays in vault)
  - **ADDED**: `unwrapETH(address weth, uint256 amount)` - Unwrap WETH to native ETH (stays in vault)
  - **ADDED**: `deposit()` to IWETH interface for wrapping support
  - Both functions use `onlyAuthorized` modifier (owner or executor can call)
  - Both functions emit `TransactionExecuted` event for tracking

#### **Use Cases**
- Automation service wraps native ETH before adding liquidity to Uniswap V3 positions
- Automation service unwraps WETH to native ETH after fee collection when vault targets ETH

**Status**: Production Ready
**Breaking Changes**: None
**Dependency**: Used by fum_automation v1.0.4+

---

## [1.0.4] - 2025-12-16

### Native ETH Vault Withdrawals

Adds native ETH withdrawal support and WETH unwrap option for vault token withdrawals.

#### **Smart Contract Changes**
- **PositionVault** v1.0.0 → v1.1.0
  - **ADDED**: `withdrawETH(uint256 amount)` - Withdraw native ETH from vault to owner
  - **ADDED**: `unwrapAndWithdrawETH(address weth, uint256 amount)` - Unwrap WETH to ETH and withdraw to owner
  - **ADDED**: `IWETH` interface for WETH contract interaction
  - Both functions use `onlyAuthorized` modifier (owner or executor can call)
  - Both functions emit `TokensWithdrawn` event with `address(0)` for native ETH

#### **Frontend Changes**
- **TokenWithdrawModal**: Added toggle to withdraw WETH as native ETH
- **TokenDepositModal**: Support for native ETH deposits
- **vaultsHelpers**: Added `isWeth` flag to identify WETH tokens for withdrawal options

#### **Documentation**
- **README**: Updated contract version table format with version column

**Status**: Production Ready
**Breaking Changes**: None

---

## [1.0.3] - 2025-12-10

### Demo Page Chain Configuration

Added configurable chain ID for demo page to support both local testing and production.

#### **Demo Page**
- **ADDED**: `NEXT_PUBLIC_DEMO_CHAIN_ID` environment variable
- **FIXED**: Demo page no longer hardcoded to localhost (chain 1337)
- **UPDATED**: All env files with new variable (`.env.local`, `.env.example`, `.env.vercel.arbitrum`)

#### **Documentation**
- **UPDATED**: README.md with new environment variable
- **UPDATED**: TESTING.md with new environment variable

**Status**: ✅ Production Ready
**Breaking Changes**: None (new env var required for demo page)

---

## [1.0.2] - 2025-12-10

### Strategy Authorization Fix

Fixed authorization model for strategy contracts - vault owners can now authorize their own vaults.

#### **Smart Contract Changes**
- **FIXED**: `BabyStepsStrategy` v1.0.0 → v1.1.0
  - `authorizeVault()` and `deauthorizeVault()` now check vault owner via staticcall
  - Removed `onlyOwner` restriction - only vault owners can authorize/deauthorize their own vaults
  - This fixes the `OwnableUnauthorizedAccount` error when configuring strategies
- **FIXED**: `ParrisIslandStrategy` v0.1.0 → v0.2.0
  - Same authorization fix applied

#### **Build System**
- **FIXED**: `sync-contracts-to-ecosystem.js` - Changed `npm run script` to `node` (script command was removed with tsx dependency)
- **ADDED**: `ParrisIslandStrategy` to sync script's testing-only contracts list

#### **Tests**
- **REFACTORED**: `BabyStepsStrategy.test.js` - Now uses real vault contracts via `vault.execute()` instead of signers
- **REFACTORED**: `ParrisIslandStrategy.test.js` - Same refactor applied
- **UPDATED**: Version tests to expect new contract versions

#### **Deployment**
- **DEPLOYED**: BabyStepsStrategy v1.1.0 to Arbitrum: `0xeAdA21fc37F548d4813b74C9f0a2eA66ff9fef27`

**Status**: ✅ Production Ready
**Breaking Changes**: Strategy contracts redeployed (authorization model changed)

---

## [1.0.1] - 2025-12-09

### Node.js 22+ & Deployment Preparation

Updates for Vercel deployment compatibility and bug fixes.

#### **Node.js Compatibility**
- **UPDATED**: Minimum Node.js version to 22+ (required for ES module JSON import syntax)
- **ADDED**: `.nvmrc` file for nvm auto-switching
- **ADDED**: `engines.node: ">=22.0.0"` in package.json

#### **Bug Fixes**
- **FIXED**: Strategy icon "Steps" → "Footprints" (Steps doesn't exist in lucide-react)
- **FIXED**: Added `skipLibCheck` and `types: []` to jsconfig.json for type definition compatibility

#### **Documentation**
- **UPDATED**: TESTING.md with sync/unsync workflow for fum_library
- **UPDATED**: README.md with Node 22+ requirement and updated setup instructions

#### **Arbitrum Mainnet Deployment**
- **DEPLOYED**: VaultFactory to `0x31709a06fB0B7DAe79B35f94cDc9D74FB348103B`
- **DEPLOYED**: BabyStepsStrategy to `0x27eC094D03436d0401A18D57cC1Ae66f1108f70B`

**Status**: ✅ Production Ready
**Breaking Changes**: None
**Dependency**: Requires fum_library v1.0.1

---

## [1.0.0] - 2025-12-09
### Production Release

First production release of F.U.M. with all core smart contracts and frontend ready for mainnet deployment.

#### **Smart Contracts (v1.0.0)**
- **PositionVault**: Production-ready vault contract for managing tokens and LP positions
- **VaultFactory**: Factory contract for creating and tracking user vaults
- **BabyStepsStrategy**: Template-based automation strategy with configurable parameters
- **Note**: ParrisIslandStrategy remains in development (v0.1.0)

#### **Repository Cleanup**
- **ADDED**: LICENSE file with proprietary license terms
- **ADDED**: TESTING.md with comprehensive local testing documentation
- **REMOVED**: Mock contracts moved to fum_testing repository
  - MockERC20, MockNonfungiblePositionManager, MockPositionNFT, MockUniversalRouter
- **REMOVED**: BatchExecutor contract (functionality consolidated)
- **REMOVED**: .solhint.json, remappings.txt (using fum_testing for linting)
- **REMOVED**: docs/SC_Dev_Plan.pdf (outdated)
- **REMOVED**: sync-contracts.sh (replaced by npm scripts)

#### **Scripts Reorganization**
- **MOVED**: Test scripts from scripts/ to test/scripts/
  - create-test-vault.js, seed.js, start-ganache.js
- **ADDED**: generate-fees.js for testing fee generation
- **ADDED**: manipulate-price.js for testing price movements
- **FIXED**: deploy.js RPC URL construction for Arbitrum mainnet
  - Now properly uses `rpcUrls[0]` from chain config
  - Appends Alchemy API key for Arbitrum deployments

#### **Unit Tests Migration**
- All contract unit tests moved to fum_testing repository
- Tests run via `npm run contracts:test` which syncs and executes in fum_testing

#### **Frontend Updates**
- **ADDED**: Strategy icons utility (strategyIcons.js)
- **UPDATED**: StrategyConfigPanel and StrategyDetailsSection improvements
- **UPDATED**: VaultCard display enhancements
- **UPDATED**: Demo page refinements
- **UPDATED**: Position and vault detail page improvements
- **UPDATED**: Error page styling

#### **Documentation**
- **UPDATED**: README.md with GitHub repository links
- **UPDATED**: Related Repositories table with proper URLs
- **ADDED**: Links to fum_testing repository

**Status**: ✅ Production Ready
**Breaking Changes**: Contract tests now require fum_testing repository
**Impact**: Ready for mainnet deployment on Arbitrum

## [0.8.0] - 2025-12-01
### PositionVault Contract Update

Added empty batch validation to all batch functions to prevent accidental no-op calls.

#### **PositionVault.sol (v0.4.3)**
- **NEW**: `require(targets.length > 0, "PositionVault: empty batch")` added to all 8 batch functions:
  - `execute()`, `swap()`, `approve()`, `mint()`
  - `increaseLiquidity()`, `decreaseLiquidity()`, `collect()`, `burn()`
- **IMPACT**: Prevents gas waste on empty transaction batches

#### **Tests**
- **NEW**: "Empty Batch Validation" test suite with 8 tests (one per function)
- **UPDATED**: Version test expects v0.4.3

**Status**: ✅ Contract ready for deployment
**Breaking Changes**: Empty arrays now revert instead of silently succeeding

## [0.7.0] - 2025-01-29
### Dual Provider Architecture

Separates read operations (dedicated RPC) from write operations (wallet provider) for improved performance and real-time data updates.

#### **New Provider Hooks**
- **NEW**: `useReadProvider` hook - For read-only blockchain operations using dedicated RPC
- **NEW**: `useWriteProvider` hook - For write operations requiring wallet signing
- **NEW**: `useProviders` hook - Combined access to both read and write providers

#### **ProviderContext Refactor**
- **NEW**: `readProvider` state - Dedicated JsonRpcProvider from chain RPC config
- **NEW**: `chainId` exposed in context value
- **NEW**: `createReadProvider()` function - Creates RPC provider using `getChainRpcUrls()`
- **FEATURE**: Automatic read provider creation when wallet connects
- **FEATURE**: Fallback to wallet provider if dedicated RPC unavailable

#### **Component Migration**
- **UPDATED**: Read-only components use `useReadProvider` (PositionContainer, PositionCard, position/[id])
- **UPDATED**: Write-only components use `useWriteProvider` (CreateVaultModal)
- **UPDATED**: Mixed components use `useProviders` (VaultsContainer, vault/[address], all modals)
- **UPDATED**: Demo page uses `getChainRpcUrls()` from chain config

#### **SSE Refresh Events**
- **UPDATED**: Individual action events trigger refreshes (NewPositionCreated, TokensSwapped, etc.)
- **REMOVED**: Redundant checkpoint events (MonitoringStarted, PositionRebalanced)
- **RESULT**: Real-time UI updates as automation actions complete

#### **Landing Page**
- **NEW**: Static landing page with navigation links (Vaults, Positions, Demo)
- **REMOVED**: Auto-redirect logic that caused race conditions with wallet reconnection

#### **Error Handling**
- **NEW**: Custom `_error.js` page for 404 and 500 errors
- **FEATURE**: Branded error page with retry button (preserves URL params)
- **FEATURE**: Different messaging for "Page Not Found" vs "Something Went Wrong"

#### **Impact**
- **PERFORMANCE**: Read operations use dedicated RPC without MetaMask HTTP lag
- **REAL-TIME**: UI updates immediately after each automation action
- **RELIABILITY**: Fallback to wallet provider if RPC unavailable
- **UX**: Clean landing page, professional error handling

**Status**: ✅ Dual provider architecture complete
**Breaking Changes**: None (internal refactor)
**Impact**: Significant improvement in data freshness and real-time updates

## [0.6.0] - 2025-01-28
### Demo Page & Transaction History

New demo page showcasing vault functionality with real-time transaction history and performance metrics.

#### **Demo Page**
- **NEW**: `/demo` page - Showcases vault automation with configurable demo address
- **NEW**: Live transaction feed with real-time updates via SSE
- **NEW**: APY calculation and performance metrics display
- **NEW**: Navbar link for demo page access

#### **Transaction Components**
- **NEW**: `TransactionList` component - Scrollable transaction feed with filtering
- **NEW**: `TransactionItem` component - Detailed transaction display with type icons

#### **Vault Helpers**
- **NEW**: `fetchVaultTrackerData()` - Fetches metadata and transactions from automation service
- **NEW**: `calculateVaultAPY()` - Calculates APY from tracker metadata (baseline, snapshots, aggregates)
- **FEATURE**: Handles fee split tracking (reinvested vs withdrawn)

#### **Redux State**
- **NEW**: `trackerMetadata` field in vault state
- **NEW**: `transactionHistory` field in vault state
- **NEW**: `updateVaultTrackerData` action

**Status**: ✅ Demo support complete
**Breaking Changes**: None
**Impact**: Enables showcasing vault automation with real performance data

## [0.5.0] - 2025-01-26
### Security Refactor - PositionVault Attack Surface Reduction

Major security hardening of the PositionVault smart contract to eliminate potential attack vectors through the automation executor role.

#### **Contract Security Hardening**
- **NEW**: `swap()` function - Validates Universal Router target and swap function selectors
- **NEW**: `approve()` function - Validates ERC20 targets and restricts spenders to whitelisted addresses (Permit2, NonfungiblePositionManager)
- **NEW**: `mint()` function - Validates NonfungiblePositionManager target and mint selector, enforces 356-byte minimum calldata
- **NEW**: `increaseLiquidity()` function - Validates target and selector for adding liquidity
- **NEW**: `decreaseLiquidity()` function - Validates target and selector for removing liquidity
- **NEW**: `collect()` function - Validates target and selector for fee collection
- **NEW**: `burn()` function - Validates target and selector for position NFT burning
- **SECURITY**: Hardcoded vault address as recipient in all position manager operations
- **SECURITY**: `execute()` function now restricted to `onlyOwner` (was `onlyAuthorized`)
- **SECURITY**: `executeBatchTransactions()` removed - replaced by constrained functions above

#### **Test Coverage**
- **NEW**: MockNonfungiblePositionManager for comprehensive position operation testing
- **UPDATED**: Full test coverage for all new constrained functions
- **UPDATED**: Security validation tests for target addresses and function selectors

#### **Impact**
- **ELIMINATED**: Arbitrary contract call vulnerability through automation executor
- **ELIMINATED**: Token theft via malicious approve() calls
- **ELIMINATED**: Fund redirection via manipulated position operations
- **MAINTAINED**: Full functionality for legitimate automation operations

**Status**: ✅ Security hardening complete
**Breaking Changes**: Automation service must use new constrained functions
**Impact**: Significant reduction in smart contract attack surface

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
