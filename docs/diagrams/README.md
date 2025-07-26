# FUM Automation Architecture Diagrams

This directory contains comprehensive architectural diagrams for the FUM Automation system, accurately reflecting the current codebase structure.

## Directory Structure

```
docs/diagrams/
├── ascii/                    # Text-based diagrams for terminal viewing
│   ├── system-architecture.txt   # Overall system architecture
│   └── event-flow.txt            # Event processing flow
├── mermaid/                  # Mermaid diagrams for documentation
│   ├── system-architecture.md    # System components and interactions
│   ├── event-management.md       # Event handling and coordination
│   └── data-flow.md             # Data management and caching
└── README.md                # This file
```

## Architecture Overview

The FUM Automation system follows a modular, event-driven architecture with the following key components:

### Core Components

1. **AutomationService** - Main orchestrator that coordinates vault monitoring and strategy execution
2. **EventManager** - Centralized event handling for blockchain events with proper cleanup
3. **VaultRegistry** - Manages vault discovery, authorization tracking, and configuration events
4. **VaultDataService** - Handles vault data caching, refresh cycles, and state management
5. **Logger** - Comprehensive logging for debugging and monitoring

### Strategy Framework

- **StrategyBase** - Abstract base class defining the strategy interface
- **BabyStepsStrategy** - Conservative trading strategy implementation
- **ParrisIslandStrategy** - Aggressive trading strategy implementation
- **Platform-Specific Implementations** - Uniswap V3 strategy implementations

### Key Patterns

1. **Strategy Pattern** - Pluggable trading strategies with platform-specific implementations
2. **Event-Driven Architecture** - Reactive system responding to blockchain events
3. **Service Layer** - Clear separation of concerns between data, business logic, and coordination
4. **Adapter Pattern** - Platform-specific adapters for different DeFi protocols

## Viewing the Diagrams

### ASCII Diagrams
Best viewed in a terminal with a monospace font:
```bash
cat docs/diagrams/ascii/system-architecture.txt
cat docs/diagrams/ascii/event-flow.txt
```

### Mermaid Diagrams
Can be viewed in:
- GitHub (native Mermaid support)
- VS Code with Mermaid extension
- Mermaid Live Editor (https://mermaid.live/)
- Any Markdown renderer with Mermaid support

## Key Architectural Decisions

### Event Management
- Centralized EventManager tracks all listeners for proper cleanup
- Vault locking prevents concurrent strategy execution
- Event filtering and wrapping for controlled processing

### Data Management
- VaultDataService maintains cached vault state
- Automatic cache invalidation on transactions
- Background refresh for stale data

### Strategy Framework
- Abstract base class ensures consistent interface
- Platform-specific implementations for different DeFi protocols
- Strategy-specific event handling and evaluation logic

### Concurrency Control
- Vault-level locking prevents race conditions
- Event processing can be globally enabled/disabled
- Graceful shutdown with proper resource cleanup

## Integration Points

### Blockchain Integration
- WebSocket providers for real-time events (preferred)
- HTTP providers as fallback
- Event filters for specific vault/pool monitoring

### DeFi Protocol Integration
- Uniswap V3 pool monitoring
- Position manager integration
- Liquidity and fee tracking

### FUM Library Integration
- Contract artifacts and ABIs
- Chain configuration helpers
- Platform adapter framework

## Monitoring and Observability

### Logging
- Structured logging with action tracking
- Debug mode for development
- Frontend log server for real-time monitoring

### Event Tracking
- All blockchain events logged and tracked
- Strategy execution metrics
- Error handling and recovery

### Health Monitoring
- Vault authorization status
- Event listener health
- Cache hit rates and refresh cycles