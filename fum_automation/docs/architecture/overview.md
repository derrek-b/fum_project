<!-- Source: src/core/AutomationService.js, src/core/VaultDataService.js, src/core/EventManager.js, src/core/Tracker.js, src/core/SSEBroadcaster.js, src/strategies/*, src/utils/* -->
# Automation Service Architecture

## Overview

24/7 Node.js service that monitors user vaults and executes automated liquidity management. Event-driven architecture with three layers: orchestration, data management, and strategy execution.

## Component Architecture

```
┌─ Orchestration ─────────────────────────────────────────────────┐
│  AutomationService (src/core/AutomationService.js)              │
│  - Vault discovery, strategy allocation, processing loop        │
│  - Vault locking, failed vault retry, blacklisting              │
│  - Provider management, reconnection, crash handling            │
└─────────────────────────────────────────────────────────────────┘
        │ creates & coordinates
        ▼
┌─ Data Layer ────────────────┐  ┌─ Event System ─────────────────┐
│  VaultDataService           │  │  EventManager                   │
│  - #vaults (private Map)    │  │  - Pub/sub (subscribe/emit)     │
│  - Position & token loading │  │  - Blockchain listener mgmt     │
│  - Asset value calculation  │  │  - Pool-to-vault shared listen  │
└─────────────────────────────┘  └─────────────────────────────────┘
        │                                │
        ▼                                ▼
┌─ Strategy Execution ────────┐  ┌─ Supporting Services ───────────┐
│  StrategyBase (abstract)    │  │  Tracker - tx history, ROI      │
│  └── BabyStepsStrategy      │  │  SSEBroadcaster - frontend SSE  │
│      (type: 'bob')          │  │  RetryHelper - backoff utilities │
└─────────────────────────────┘  └─────────────────────────────────┘
```

## Source Files

```
src/
├── index.js                           # Re-exports all modules
├── core/
│   ├── AutomationService.js          # Main orchestrator (2100+ lines)
│   ├── VaultDataService.js           # Vault data management
│   ├── EventManager.js               # Pub/sub + blockchain listeners
│   ├── Tracker.js                    # Transaction history & performance
│   └── SSEBroadcaster.js            # SSE streaming to frontend
├── strategies/
│   ├── base/StrategyBase.js          # Abstract base class
│   └── babySteps/BabyStepsStrategy.js # Concrete strategy
└── utils/
    ├── RetryHelper.js                # Retry with exponential backoff
    └── errors.js                     # UnrecoverableError
```

## Dependency Injection

AutomationService creates all components in its constructor:

1. **EventManager** — created first, receives dependencies via setters (`setPoolData`, `setAdapters`, `setVaultDataService`) after `initialize()`
2. **VaultDataService** — receives EventManager in constructor, gets provider/chainId/tokens/adapters/poolData via setters during `initialize()`
3. **Tracker** — receives `{ vaultDataDir, trackingFailuresFilePath, eventManager, chainId, debug }`, subscribes to events automatically
4. **SSEBroadcaster** — receives EventManager + callback functions for data access
5. **BabyStepsStrategy** — receives full dependencies object (see [Strategy System](./strategy-system.md))

Strategies receive shared references to AutomationService caches (vaultLocks, poolData, tokens, adapters) — not copies. This ensures all components see the same data.

## Service Lifecycle

1. **Constructor** — Validate config, create all components, instantiate BabyStepsStrategy as `'bob'`, set up event subscriptions and crash handlers
2. **start()** — Initialize provider, load adapters/tokens/contracts, inject dependencies into EventManager/VaultDataService, load blacklist, discover authorized vaults, setup each vault
3. **Running** — Event-driven: blockchain events trigger strategy evaluation and execution
4. **stop()** — Set shutdown flag, disable EventManager, clean up all vaults, remove all listeners, stop SSE/Tracker, close provider

## Extension Points

**Adding a new strategy:** Extend StrategyBase, implement 4 methods (`initializeVault`, `handleSwapEvent`, `cleanup`, `setupAdditionalMonitoring`), instantiate in AutomationService constructor, register in `this.strategies` Map.

**Adding a new platform:** Create adapter in fum_library extending PlatformAdapter. The automation service picks up all adapters automatically via `getAdaptersForChain()`.

## Detailed Documentation

- [Cache Structures](./cache-structures.md) — All cached data shapes (critical reference)
- [Strategy System](./strategy-system.md) — StrategyBase interface, BabyStepsStrategy
- [Automation Flow](./automation-flow.md) — Event handling, vault processing flows
- [Event Management](./event-management.md) — Pub/sub, listener lifecycle, cleanup
