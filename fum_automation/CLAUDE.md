# CLAUDE.md — fum_automation (Automation Service)

## What This Project Is

24/7 Node.js service that monitors user vaults and executes automated liquidity management: rebalancing positions when price moves out of range, collecting fees when thresholds are met, and creating new positions when vaults are funded. Event-driven architecture with platform adapters from fum_library.

## Commands

```bash
npm run start              # Start automation service
npm test                   # All tests (unit + workflow)
npm run test:v3            # Uniswap V3 workflow tests (FORK_CHAIN=arbitrum)
npm run test:v4            # Uniswap V4 workflow tests (FORK_CHAIN=arbitrum)
npm run test:tj            # Trader Joe V2.2 workflow tests (FORK_CHAIN=avalanche)
npm run test:watch         # Vitest watch mode
npm run test:coverage      # Coverage report
```

**Backtesting:**
```bash
npm run backtest:setup     # Deploy contracts on forked chain for backtesting
npm run backtest:run       # Run full backtest simulation
npm run collect:events:weth-usdc  # Collect on-chain swap events for replay
npm run collect:prices:eth        # Collect historical price data
```

## Project Structure

```
src/
├── core/
│   ├── AutomationService.js   # Orchestration: vault discovery, strategy allocation, processing loop
│   ├── VaultDataService.js    # Data layer: vault state, positions, token balances
│   ├── EventManager.js        # Pub/sub for system events (FeesCollected, PositionRebalanced, etc.)
│   ├── Tracker.js             # Transaction history and performance tracking
│   └── SSEBroadcaster.js      # Real-time updates to frontend via Server-Sent Events
├── strategies/
│   ├── base/StrategyBase.js   # Abstract base: evaluation, lifecycle, fee handling
│   └── babySteps/BabyStepsStrategy.js  # Conservative range-based automation
└── utils/
    ├── RetryHelper.js         # RPC call retry with exponential backoff
    └── errors.js              # Custom error types

test/
├── helpers/                   # Test setup utilities per platform (hardhat-setup, swap-utils, vault-setup)
├── unit/                      # Unit tests (EventManager, VaultDataService, RetryHelper, BlacklistManager)
└── workflow/                  # Integration tests organized by scenario
    ├── service-init/          # Vault discovery → position creation flows
    ├── swap-event/            # Fee collection triggered by swap events
    ├── config-update/         # Strategy parameter changes
    ├── error-handling/        # Recovery and failure scenarios
    ├── vault-setup/           # Vault initialization edge cases
    ├── service-stop/          # Graceful shutdown
    ├── v4/                    # Uniswap V4-specific workflows
    └── traderjoe/             # Trader Joe V2.2-specific workflows

backtest/                      # Historical replay engine for strategy evaluation
├── collectors/                # On-chain event and price data collection
├── encoders/                  # Calldata encoding for replay
├── runners/                   # Backtest execution and setup
├── analyzers/                 # Results analysis
└── data/                      # Collected data (gitignored)
```

## Architecture

Detailed docs in `docs/architecture/`:
- **overview.md** — System design, core principles, extension points
- **cache-structures.md** — Reference for all cached data in AutomationService and VaultDataService
- **strategy-system.md** — Strategy pattern, evaluation logic, platform-specific adaptations
- **automation-flow.md** — Event handling and orchestration flows
- **event-management.md** — Event subscription, lifecycle, and cleanup

### Processing Loop

1. **Vault discovery** — AutomationService polls VaultFactory for authorized vaults
2. **Strategy allocation** — Each vault gets a strategy instance based on its config
3. **Evaluation** — Strategy checks: are positions in range? Are fees above threshold?
4. **Execution** — Rebalance, collect fees, or create new positions as needed
5. **Event emission** — EventManager broadcasts what happened (PositionRebalanced, FeesCollected, etc.)
6. **SSE broadcast** — Frontend clients get real-time updates

### Test Infrastructure

- Tests start their own Hardhat node via `global-setup.js` (shared across all test files)
- `FORK_CHAIN` env var controls which chain to fork (arbitrum or avalanche)
- Tests run sequentially (`fileParallelism: false`) — workflow tests are resource-intensive
- Each platform has dedicated helpers: `hardhat-setup.js`, `swap-utils.js`, `vault-setup.js` (and TJ/V4 variants)

## Important Rules

- **Look up before you use** — Do NOT assume what is or is not part of the data structures, contracts, or library modules. Always read the code first.
- **Cache structures** — Reference `docs/architecture/cache-structures.md` before modifying any cached data.
- **Debugging logs** — Mark with a special emoji so they are easy to find and remove.
- **Strategy pattern** — When adding new strategies, extend StrategyBase following BabyStepsStrategy's pattern.
- **fum_library changes** — Run `cd ../fum_library && npm run pack` to pick up library updates.
