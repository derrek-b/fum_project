<!-- Source: src/core/AutomationService.js, src/core/VaultDataService.js, src/core/EventManager.js, src/core/SSEBroadcaster.js, src/core/VaultHealth.js -->
# Automation Flow

## Overview

The automation service operates through event-driven flows: startup initializes the service and discovers vaults, blockchain events trigger strategy evaluation, and the strategy decides on actions (rebalance, collect fees, or no-op).

## Service Startup Flow

```
new AutomationService(config)
│
├── validateConfig()
├── Create EventManager, VaultDataService, Tracker, SSEBroadcaster
├── Create BabyStepsStrategy('bob') with dependencies
├── setupInternalEventSubscriptions()
└── setupCrashHandlers()

.start()
│
├── initialize()
│   ├── initializeProvider() → WebSocket provider + reconnection handlers
│   ├── getAdaptersForChain(chainId) → populate this.adapters Map
│   ├── getAllTokens(chainId) → populate this.tokens
│   ├── getContract('VaultFactory') + getContract('BabySteps') → this.contracts
│   ├── Inject deps into EventManager (setPoolData, setAdapters, setVaultDataService)
│   ├── Inject deps into VaultDataService (initialize, setTokens, setAdapters, setPoolData)
│   └── Update strategy dependencies (provider, adapters, tokens, serviceConfig)
│
├── loadBlacklist()
├── subscribeToAuthorizationEvents() → monitor ExecutorChanged events
├── subscribeToStrategyParameterEvents() → monitor ParameterUpdated events
├── Start failed vault retry timer (retryIntervalMs interval)
│
├── loadAuthorizedVaults() → getActiveVaults() with retry
│   └── For each vault (skip if blacklisted):
│       └── setupVault(vaultAddress)
│
├── vaultHealth.start() — initial balance check, begin monitoring interval
├── tracker.initialize()
├── sseBroadcaster.start()
└── Emit ServiceStarted
```

## Provider Reconnection Flow

```
Provider disconnect/error detected (or heartbeat failure)
│
├── If already reconnecting → skip (isReconnecting guard)
├── isReconnecting = true
├── Exponential backoff delay (reconnectBaseDelay × 2^attempt)
│   └── 1s → 2s → 4s → 8s → 16s
│
├── Create new WebSocket provider
├── Stop heartbeat interval
├── eventManager.setEnabled(false) — suppress events during transition
│
├── Inject new provider into VaultDataService, strategies
├── reestablishEventListeners()
│   ├── Re-subscribe to authorization events (ExecutorChanged)
│   ├── Re-subscribe to strategy parameter events (ParameterUpdated)
│   └── For each vault: re-subscribe to swap + config events
│
├── Restart heartbeat, eventManager.setEnabled(true)
├── reconnectAttempts = 0, isReconnecting = false
├── Emit ProviderReconnected
│
└── If attempt >= maxReconnectAttempts (5):
    └── Emit ProviderFailed → fatal error handler
```

## Vault Setup Flow

```
setupVault(vaultAddress)
│
├── vaultDataService.loadVaultData(vaultAddress)
│   ├── Fetch vault info from VaultFactory
│   ├── Read strategy address + parameters from contract
│   ├── Fetch token balances
│   ├── Fetch positions (via adapters)
│   └── Cache in VaultDataService.#vaults
│
├── Capture asset value baseline → Emit VaultBaselineCaptured
│
├── strategy.initializeVault(vault) → pool selection, position creation
│
├── startMonitoringVault(vault)
│   ├── eventManager.subscribeToSwapEvents(vault, provider, chainId)
│   ├── eventManager.subscribeToVaultConfigEvents(vault, provider, chainId)
│   ├── strategy.setupAdditionalMonitoring(vault)
│   └── Emit MonitoringStarted
│
└── Emit VaultSetupComplete
```

## Swap Event Processing Flow

```
Pool Swap event detected (blockchain)
│
├── EventManager filter handler fires
│   ├── Check enabled flag, check isRemoved flag
│   └── Identify all vaults monitoring this pool (poolToVaults mapping)
│
├── For each affected vault:
│   └── Emit SwapEventDetected → AutomationService.handleSwapEvent(data)
│
handleSwapEvent(data)
│
├── lockVault(vaultAddress) — skip if already locked
├── Get vault data from VaultDataService
├── Identify strategy via vault.strategy.strategyId
├── Get strategy instance from this.strategies Map
│
├── strategy.handleSwapEvent(vault, poolId, platform, log)
│   └── BabyStepsStrategy:
│       ├── Get adapter: this.adapters.get(platform) — no platform subclasses
│       ├── Parse: adapter.parseSwapEvent(log) — platform-specific parsing
│       └── Evaluates:
│       ├── Emergency exit check (price deviation from baseline)
│       ├── Rebalance check (position out of range?)
│       └── Fee collection check (accrued fees above threshold?)
│
├── Check pendingOffboards (auth revoked while locked?) → offboard if pending
├── Apply any pending config updates (processPendingConfigUpdates)
└── unlockVault(vaultAddress)
```

## Auth Revocation Flow

When a vault's executor is removed on-chain, the service offboards the vault. If the vault is locked (operation in progress), offboarding is deferred to prevent concurrent state mutation:

```
VaultAuthRevoked event
│
├── If vault is locked (operation in progress):
│   └── Add to pendingOffboards Set, return immediately
│       (offboard runs when VaultUnlocked fires — see unlock flow above)
│
├── If vault is unlocked:
│   └── offboardVault() immediately:
│       ├── Strategy cleanup (emergencyExitBaseline, position checks)
│       ├── Remove all vault listeners
│       ├── Remove from failedVaults and tripHistory
│       └── Remove from VaultDataService cache
│
└── Emit VaultOffboarded (deferred: true/false)
```

## Config Update Flow

Vault configuration changes (target tokens, target platforms, strategy parameters) arrive as blockchain events:

```
TargetTokensUpdated / TargetPlatformsUpdated / ParameterUpdated event
│
├── EventManager listener detects event
├── Emit internal event → AutomationService.handleConfigUpdate()
│
├── If vault is locked:
│   └── Queue update in pendingConfigUpdates Map
│       (applied after current processing completes)
│
├── If vault is unlocked:
│   └── Apply immediately:
│       ├── TargetTokensUpdated → vaultDataService.updateTargetTokens()
│       ├── TargetPlatformsUpdated → vaultDataService.updateTargetPlatforms()
│       └── ParameterUpdated → vaultDataService.updateStrategyParameters()
```

## Vault Failure & Recovery

```
Vault fails during processing
│
├── trackFailedVault(vaultAddress, error, source)
│   ├── Add to failedVaults Map with timestamp, error, source, attempts
│   ├── recordRetryTrip(vaultAddress, source) — track trip history
│   │   ├── If ≥5 trips in 24 hours → blacklistVault()
│   │   └── Otherwise → wait for retry timer
│   └── Emit VaultFailed
│
├── retryFailedVaults() (runs on timer interval)
│   ├── For each vault in failedVaults:
│   │   ├── If exceeded maxFailureDurationMs → blacklistVault()
│   │   └── Otherwise → attempt setupVault() again
│   │       ├── Success → remove from failedVaults, Emit VaultRecovered
│   │       └── Failure → increment attempts, update timestamps
│
├── blacklistVault(vaultAddress, reason)
│   ├── Add to blacklistedVaults Map
│   ├── Remove from failedVaults
│   ├── Save to disk (blacklist.json)
│   └── Emit VaultBlacklisted
```

## Manual Retry Flow (Blacklisted Vaults)

When a vault is blacklisted, the user can trigger a retry via the frontend Retry button (or directly via `POST /vault/:address/retry`). This bypasses the normal auth revoke/re-grant cycle:

```
POST /vault/:address/retry → SSEBroadcaster → retryBlacklistedVault(address)
│
├── Guard: isRunning? isVaultBlacklisted?
├── Verify executor on-chain:
│   ├── getVaultContract().executor() → must not be zero address
│   └── Derive from hdNode + executorIndex → must match on-chain executor
│
├── unblacklistVault() → Emit VaultUnblacklisted
├── Clear from failedVaults (retry queue)
├── Clear from vaultTripHistory (reset yo-yo detection)
│
├── setupVault(address, { forceRefresh: true })
│   ├── Success → Emit VaultOnboarded
│   └── Failure:
│       ├── InsufficientGasError → enterFundingRequired()
│       └── Other error → trackFailedVault(source: 'manual_retry')
│
└── Return { success: true, vaultAddress } (or throw on failure)
```

The `VaultAuthGranted` handler follows the same unblacklist → setupVault pattern but is triggered by an on-chain event instead of an HTTP request.

## Service Shutdown Flow

```
stop(force)
│
├── isShuttingDown = true
├── eventManager.setEnabled(false) — suppress new event processing
├── vaultHealth.stop() — stop monitoring interval, clear state
├── Stop heartbeat, stop retry timer
│
├── For each vault in VaultDataService:
│   ├── strategy.cleanup(vaultAddress) — strategy-specific cleanup
│   └── eventManager.removeAllVaultListeners(vaultAddress)
│
├── eventManager.removeAllListeners() — catch any remaining
├── sseBroadcaster.stop()
├── tracker.shutdown()
├── Close WebSocket provider
└── isRunning = false
```

## Key Event Names (PascalCase)

**Service:** ServiceStarted, ServiceStartFailed, ProviderError, ProviderDisconnected, ProviderReconnecting, ProviderReconnected, ProviderFailed

**Vaults:** VaultOnboarded, VaultOffboarded, VaultSetupComplete, VaultSetupFailed, VaultFailed, VaultRecovered, VaultBlacklisted, VaultUnblacklisted, VaultMonitoringStopped, VaultLocked, VaultUnlocked, VaultRetryTrip, VaultsLoaded, VaultBaselineCaptured, MonitoringStarted

**Config:** TargetTokensUpdated, TargetPlatformsUpdated, StrategyParameterUpdated, ConfigUpdateFailed

**Operations:** SwapEventDetected, SwapEventFailed, BatchTransactionExecuted, NativeWrapped, NativeUnwrapped

## See Also

- [Cache Structures](./cache-structures.md) — Data shapes for all caches referenced above
- [Event Management](./event-management.md) — Listener registration and cleanup details
- [Strategy System](./strategy-system.md) — What strategies do when invoked
