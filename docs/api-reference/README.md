# API Reference

This directory contains detailed API documentation for the FUM Automation Service.

## Documentation Structure

- **[Module Reference](./modules.md)** - Complete list of all modules, classes, and exports
- **[Core Services](./automation-service/)** - Main automation orchestration
- **[Vault Management](./vault-management/)** - Vault discovery and data management
- **[Strategy System](./strategies/)** - Automation strategy implementations
- **[Utilities](./utilities/)** - Supporting utilities and helpers

## Quick Links

### Core Services

- **[AutomationService](./automation-service/automation-service.md)** - Main orchestration service
  - Vault discovery and lifecycle management
  - Strategy allocation and execution coordination
  - Event-driven automation workflows

### Vault Management

- **[VaultRegistry](./vault-management/vault-registry.md)** - Vault discovery and authorization tracking
  - Real-time authorization monitoring
  - Multi-chain vault discovery
  - Vault state caching and updates

- **[VaultDataService](./vault-management/vault-data-service.md)** - Enhanced data loading and caching
  - Position data with automation metadata
  - Token balance tracking and conversion
  - Efficient batch operations

### Strategy System

- **[StrategyBase](./strategies/strategy-base.md)** - Abstract foundation for all strategies
  - Common utilities and patterns
  - Event registration helpers
  - Standardized interfaces

- **[BabyStepsStrategy](./strategies/baby-steps-strategy.md)** - Simple range-based automation
  - Conservative parameter set
  - Predictable rebalancing behavior
  - Easy configuration and monitoring

- **[ParrisIslandStrategy](./strategies/parris-island-strategy.md)** - Advanced adaptive automation
  - Dynamic range adjustment
  - Machine learning integration points
  - Advanced risk management

#### Platform Implementations

- **[UniswapV3BabyStepsStrategy](./strategies/uniswap-v3-baby-steps.md)** - UniswapV3-specific Baby Steps
- **[UniswapV3ParrisIslandStrategy](./strategies/uniswap-v3-parris-island.md)** - UniswapV3-specific Parris Island

### Utilities

- **[EventManager](./utilities/event-manager.md)** - Centralized event management
  - Blockchain event subscriptions
  - Automatic cleanup and lifecycle management
  - Debug and monitoring support

- **[Logger](./utilities/logger.md)** - Structured logging system
  - Automation-specific context
  - Performance and operation tracking
  - Debug mode support

## Key Functions

### Automation Management
- `AutomationService.start()` - Initialize and start automation
- `AutomationService.stop()` - Graceful shutdown with cleanup
- `AutomationService.processVault()` - Process single vault
- `AutomationService.getHealthStatus()` - Service health monitoring

### Vault Operations
- `VaultRegistry.discoverAuthorizedVaults()` - Find authorized vaults
- `VaultDataService.loadVault()` - Load enhanced vault data
- `VaultDataService.loadUserVaults()` - Load all user vaults
- `VaultDataService.subscribe()` - Real-time vault updates

### Strategy Evaluation
- `Strategy.evaluateRebalance()` - Assess rebalancing needs
- `Strategy.evaluateInitialAssets()` - Check initial asset requirements
- `Strategy.initializeVaultStrategy()` - Set up vault monitoring
- `Strategy.createForPlatform()` - Factory method for platform-specific instances

### Event Management
- `EventManager.registerContractListener()` - Subscribe to contract events
- `EventManager.registerFilterListener()` - Subscribe to filtered events
- `EventManager.registerInterval()` - Schedule periodic tasks
- `EventManager.removeAllListeners()` - Complete cleanup

## Data Types and Interfaces

### Core Types

```typescript
// Service configuration
interface AutomationConfig {
  chains: number[]
  strategies: string[]
  maxConcurrentVaults: number
  pollingIntervalMs: number
  defaultStrategy: string
  logLevel: 'debug' | 'info' | 'warn' | 'error'
  debugMode: boolean
}

// Vault data structure
interface VaultData {
  address: string
  name: string
  symbol: string
  chainId: number
  executor: string | null
  strategyAddress: string | null
  hasActiveStrategy: boolean
  strategy: StrategyInfo | null
  positions: Position[]
  metrics: VaultMetrics
}

// Strategy evaluation results
interface RebalanceEvaluation {
  shouldRebalance: boolean
  reason: string
  actions: Action[]
  metadata?: {
    currentRange?: PriceRange
    targetRange?: PriceRange
    pricePosition?: number
    utilization?: number
  }
}

// Position data with automation context
interface Position {
  id: string
  platform: string
  poolAddress: string
  vaultAddress: string
  inVault: boolean
  // ... platform-specific fields
  // ... automation metadata
}
```

### Strategy Parameters

```typescript
// Baby Steps strategy parameters
interface BabyStepsParameters {
  targetRangeUpper: number        // Target upper range (%)
  targetRangeLower: number        // Target lower range (%)
  rebalanceThresholdUpper: number // Upper rebalance threshold (%)
  rebalanceThresholdLower: number // Lower rebalance threshold (%)
  maxSlippage: number            // Maximum slippage (%)
  emergencyExitTrigger: number   // Emergency exit threshold (%)
  maxUtilization: number         // Maximum vault utilization (%)
  feeReinvestment: boolean       // Enable fee reinvestment
  reinvestmentTrigger: number    // Minimum USD for reinvestment
  reinvestmentRatio: number      // Percentage of fees to reinvest
}

// Parris Island strategy parameters (extends Baby Steps)
interface ParrisIslandParameters extends BabyStepsParameters {
  adaptiveRanges: boolean                  // Enable adaptive range adjustment
  rebalanceCountThresholdHigh: number      // High frequency threshold
  rebalanceCountThresholdLow: number       // Low frequency threshold
  adaptiveTimeframeHigh: number           // High frequency analysis window (seconds)
  adaptiveTimeframeLow: number            // Low frequency analysis window (seconds)
  rangeAdjustmentPercentHigh: number      // Range expansion percentage
  thresholdAdjustmentPercentHigh: number  // Threshold relaxation percentage
  rangeAdjustmentPercentLow: number       // Range contraction percentage
  thresholdAdjustmentPercentLow: number   // Threshold tightening percentage
  oracleSource: number                    // Oracle source selection
  priceDeviationTolerance: number         // Maximum oracle deviation (%)
  maxPositionSizePercent: number          // Maximum single position size (%)
  minPositionSize: string                 // Minimum position size (USD)
  targetUtilization: number               // Target vault utilization (%)
  platformSelectionCriteria: number       // Platform selection criteria
  minPoolLiquidity: string                // Minimum pool liquidity (USD)
}
```

### Event Types

```typescript
// Internal automation events
type AutomationEvent = 
  | 'vault_discovered'
  | 'vault_authorized'
  | 'vault_deauthorized' 
  | 'vault_processed'
  | 'rebalance_started'
  | 'rebalance_completed'
  | 'fee_collection_started'
  | 'fee_collection_completed'
  | 'strategy_parameters_updated'
  | 'emergency_stop_triggered'
  | 'periodic_evaluation_completed'
  | 'service_degraded'
  | 'service_restored'

// Event data structures
interface RebalanceEvent {
  vaultAddress: string
  positionId: string
  strategyType: string
  reason: string
  actionCount: number
  success: boolean
  gasUsed?: number
  slippage?: number
}

interface VaultProcessedEvent {
  vaultAddress: string
  chainId: number
  positionResults: PositionResult[]
  processingTime: number
}
```

## Usage Patterns

### Basic Service Setup

```javascript
import AutomationService from './src/AutomationService.js';

// Initialize with configuration
const automationService = new AutomationService({
  chains: [1, 42161],              // Ethereum, Arbitrum
  strategies: ['bob', 'parris'],   // Available strategies
  maxConcurrentVaults: 10,         // Concurrent processing limit
  pollingIntervalMs: 60000,        // 1-minute evaluation cycle
  defaultStrategy: 'bob',          // Default strategy for new vaults
  logLevel: 'info',               // Logging level
  debugMode: false                // Debug mode
});

// Start automation
await automationService.start();

// Monitor events
automationService.eventManager.subscribe('rebalance_completed', (data) => {
  console.log(`Rebalance completed for ${data.vaultAddress}`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  await automationService.stop();
  process.exit(0);
});
```

### Vault Data Loading

```javascript
// Load single vault
const vaultData = await automationService.vaultDataService.loadVault(
  '0xVaultAddress',
  42161 // Arbitrum
);

// Load all user vaults
const userVaults = await automationService.vaultDataService.loadUserVaults(
  '0xUserAddress',
  [1, 42161] // Ethereum and Arbitrum
);

// Subscribe to real-time updates
const unsubscribe = automationService.vaultDataService.subscribe(
  '0xVaultAddress',
  42161,
  (updatedData) => {
    console.log('Vault data updated:', updatedData);
  }
);
```

### Strategy Evaluation

```javascript
// Get strategy for vault
const strategy = automationService.getStrategyForVault(vault);

// Evaluate rebalancing
const evaluation = await strategy.evaluateRebalance(position);

if (evaluation.shouldRebalance) {
  console.log('Rebalancing recommended:', evaluation.reason);
  console.log('Proposed actions:', evaluation.actions);
}

// Evaluate initial assets
const initialAssets = await strategy.evaluateInitialAssets(vault, positions);

if (initialAssets.needsInitialAssets) {
  console.log('Initial assets needed:', initialAssets.reason);
}
```

### Event Management

```javascript
// Register blockchain event listener
const key = await eventManager.registerContractListener({
  contract: vaultContract,
  eventName: 'ParametersUpdated',
  handler: (vaultAddress, newParams) => {
    console.log(`Parameters updated for ${vaultAddress}`);
  },
  vaultAddress: vault.address,
  eventType: 'strategy',
  chainId: vault.chainId,
  additionalId: 'parameters'
});

// Register periodic evaluation
const intervalKey = await eventManager.registerInterval({
  callback: () => performEvaluation(vault),
  intervalMs: 300000, // 5 minutes
  vaultAddress: vault.address,
  eventType: 'evaluation',
  chainId: vault.chainId
});

// Cleanup when done
await eventManager.removeListener(key);
await eventManager.removeListener(intervalKey);
```

## Error Handling

### Common Error Types

```typescript
// Configuration errors
class ConfigurationError extends Error {
  constructor(message: string, config?: any) {
    super(message);
    this.name = 'ConfigurationError';
    this.config = config;
  }
}

// Strategy evaluation errors
class StrategyEvaluationError extends Error {
  constructor(message: string, position?: Position, strategy?: string) {
    super(message);
    this.name = 'StrategyEvaluationError';
    this.position = position;
    this.strategy = strategy;
  }
}

// Event management errors
class EventManagementError extends Error {
  constructor(message: string, listenerKey?: string) {
    super(message);
    this.name = 'EventManagementError';
    this.listenerKey = listenerKey;
  }
}
```

### Error Handling Patterns

```javascript
// Graceful error handling in automation service
try {
  const result = await automationService.processVault(vault);
  console.log('Vault processed successfully:', result);
} catch (error) {
  if (error instanceof StrategyEvaluationError) {
    console.error('Strategy evaluation failed:', error.message);
    // Handle strategy-specific errors
  } else if (error instanceof EventManagementError) {
    console.error('Event management error:', error.message);
    // Handle event-related errors
  } else {
    console.error('Unexpected error:', error.message);
    // Handle other errors
  }
}

// Retry with exponential backoff
async function retryOperation(operation, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (attempt === maxRetries) throw error;
      
      const delayMs = Math.pow(2, attempt) * 1000;
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
}
```

## Performance Considerations

### Optimization Guidelines

1. **Batch Operations**: Use batch processing for multiple vaults
2. **Concurrent Limits**: Respect rate limits and connection pools
3. **Caching**: Leverage caching for expensive operations
4. **Event Debouncing**: Debounce high-frequency events
5. **Resource Cleanup**: Always clean up event listeners and connections

### Memory Management

```javascript
// Proper cleanup in long-running operations
async function processVaultsWithCleanup(vaults) {
  const results = [];
  
  try {
    for (const vault of vaults) {
      const result = await processVault(vault);
      results.push(result);
    }
  } finally {
    // Ensure cleanup happens even if errors occur
    await cleanupResources();
  }
  
  return results;
}

// Monitor memory usage
function logMemoryUsage() {
  const usage = process.memoryUsage();
  console.log('Memory usage:', {
    rss: `${Math.round(usage.rss / 1024 / 1024)} MB`,
    heapTotal: `${Math.round(usage.heapTotal / 1024 / 1024)} MB`,
    heapUsed: `${Math.round(usage.heapUsed / 1024 / 1024)} MB`,
    external: `${Math.round(usage.external / 1024 / 1024)} MB`
  });
}
```

---

For detailed information about specific components, see the individual API documentation files in their respective directories.