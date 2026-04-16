# FUM Automation Documentation

## Architecture
- [Overview](./architecture/overview.md) — System design, layers, extension points
- [Automation Flow](./architecture/automation-flow.md) — Startup, event handling, reconnection, shutdown
- [Strategy System](./architecture/strategy-system.md) — StrategyBase → BabyStepsStrategy
- [Event Management](./architecture/event-management.md) — Pub/sub, listener lifecycle, pool-to-vault mapping
- [Cache Structures](./architecture/cache-structures.md) — Reference for all cached data
- [Executor Gas Management](./architecture/executor-gas-management.md) — VaultHealth holdback system

## API Reference
- [AutomationService](./api-reference/automation-service/automation-service.md) — Orchestration
- [VaultHealth](./api-reference/core/vault-health.md) — Executor gas monitoring and top-ups
- [ServiceHealth](./api-reference/core/service-health.md) — WebSocket health monitoring
- [VaultDataService](./api-reference/vault-management/vault-data-service.md) — Vault state and positions
- [StrategyBase](./api-reference/strategies/strategy-base.md) — Abstract strategy interface
- [BabyStepsStrategy](./api-reference/strategies/baby-steps-strategy.md) — Conservative range strategy
- [EventManager](./api-reference/utilities/event-manager.md) — Event system
- [Tracker](./api-reference/utilities/tracker.md) — Transaction history and ROI
- [SSEBroadcaster](./api-reference/utilities/sse-broadcaster.md) — Real-time frontend updates
- [RetryHelper](./api-reference/utilities/retry-helper.md) — Retry with backoff
- [Error Utilities](./api-reference/utilities/errors.md) — UnrecoverableError, InsufficientGasError
- [patchProviderFeeData](./api-reference/utilities/patch-provider-fee-data.md) — Chain-specific gas fee overrides

## Other
- [Backtesting](../../backtest/README.md) — Historical data collection and strategy replay
