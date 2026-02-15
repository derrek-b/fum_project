# Getting Started with FUM Automation

The FUM Automation Service provides automated liquidity management for DeFi vaults using intelligent rebalancing strategies.

## Quick Start

### Prerequisites

- Node.js 18+ 
- npm or yarn
- Access to blockchain RPC endpoints
- Vault contracts deployed on supported chains

### Installation

```bash
# Clone and install dependencies
git clone <repository>
cd fum_automation
npm install
```

### Environment Configuration

Create a `.env.local` file with your configuration:

```bash
# Blockchain Configuration
RPC_URL_1=https://your-ethereum-rpc-url
RPC_URL_42161=https://your-arbitrum-rpc-url
AUTOMATION_SERVICE_ADDRESS=0xYourAutomationServiceAddress

# API Keys (optional)
COINGECKO_API_KEY=your-coingecko-api-key

# Logging Configuration
LOG_LEVEL=info
DEBUG_MODE=false

# Service Configuration
POLLING_INTERVAL_MS=60000
MAX_CONCURRENT_VAULTS=10
```

### Basic Usage

#### Start the Automation Service

```bash
# Run with default configuration
npm run start

# Run with log server for debugging
npm run start:logs

# Run with custom log port
npm run script scripts/test-automation.js --logs --log-port 8080
```

#### Monitor Vault Activity

```javascript
import AutomationService from './src/AutomationService.js';

// Initialize automation service
const automationService = new AutomationService({
  chains: [1, 42161], // Ethereum and Arbitrum
  strategies: ['bob', 'parris'],
  maxConcurrentVaults: 5
});

// Start monitoring
await automationService.start();

// Subscribe to events
automationService.eventManager.subscribe('rebalance_completed', (data) => {
  console.log(`Rebalance completed for vault ${data.vaultAddress}`);
  console.log(`Strategy: ${data.strategyType}, Result: ${data.result}`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  await automationService.stop();
  process.exit(0);
});
```

## Core Concepts

### 1. Automation Service
The central orchestrator that manages vault discovery, strategy execution, and event handling.

**Key Features:**
- Automated vault discovery and authorization tracking
- Multi-strategy support with pluggable architecture
- Event-driven rebalancing and fee collection
- Comprehensive logging and monitoring

### 2. Vault Registry
Tracks vaults that have authorized the automation service to manage their positions.

**Capabilities:**
- Real-time authorization monitoring
- Vault state caching and updates
- Multi-chain vault discovery
- Authorization revocation detection

### 3. Strategy System
Pluggable strategy implementations for different automation approaches.

**Available Strategies:**
- **Baby Steps (bob)**: Simple range-based rebalancing with conservative parameters
- **Parris Island (parris)**: Advanced adaptive strategy with dynamic range adjustment

### 4. Event Management
Centralized event handling system for blockchain events and automation triggers.

**Event Types:**
- Strategy parameter changes
- Position updates
- Fee collection opportunities
- Price movements and rebalancing triggers

## Common Workflows

### Manual Vault Management

```javascript
// Load specific vault data
const vaultData = await automationService.vaultDataService.loadVault(
  '0xVaultAddress',
  42161 // Arbitrum
);

console.log('Vault Info:', vaultData.vault);
console.log('Positions:', vaultData.positions);
console.log('Strategy:', vaultData.strategy);

// Check if rebalancing is needed
const strategy = automationService.getStrategyForVault(vaultData.vault);
const evaluation = await strategy.evaluateRebalance(vaultData.positions[0]);

if (evaluation.shouldRebalance) {
  console.log('Rebalancing recommended:', evaluation.reason);
  console.log('Proposed actions:', evaluation.actions);
}
```

### Custom Strategy Development

```javascript
import StrategyBase from './src/strategies/StrategyBase.js';

class CustomStrategy extends StrategyBase {
  constructor(service) {
    super(service);
    this.type = "custom";
  }

  async evaluateRebalance(position) {
    // Custom rebalancing logic
    return {
      shouldRebalance: false,
      reason: "Custom evaluation",
      actions: []
    };
  }

  async evaluateInitialAssets(vault, positions) {
    // Custom initial asset evaluation
    return {
      needsInitialAssets: false,
      actions: []
    };
  }
}

// Register custom strategy
automationService.registerStrategy('custom', CustomStrategy);
```

### Event Monitoring

```javascript
// Subscribe to all automation events
const events = [
  'vault_discovered',
  'vault_authorized', 
  'vault_deauthorized',
  'rebalance_started',
  'rebalance_completed',
  'fee_collection_started',
  'fee_collection_completed',
  'strategy_parameters_updated'
];

events.forEach(event => {
  automationService.eventManager.subscribe(event, (data) => {
    console.log(`Event: ${event}`, data);
  });
});
```

## Configuration Options

### Automation Service Configuration

```javascript
const config = {
  // Chain configuration
  chains: [1, 42161, 137], // Ethereum, Arbitrum, Polygon
  
  // Strategy configuration
  strategies: ['bob', 'parris'],
  defaultStrategy: 'bob',
  
  // Performance tuning
  maxConcurrentVaults: 10,
  pollingIntervalMs: 60000,
  batchSize: 5,
  
  // Risk management
  maxSlippageBps: 100, // 1%
  emergencyStopEnabled: true,
  
  // Logging
  logLevel: 'info',
  debugMode: false,
  enableMetrics: true
};

const automationService = new AutomationService(config);
```

### Strategy-Specific Configuration

```javascript
// Baby Steps Strategy Parameters
const bobConfig = {
  targetRangeUpper: 105,     // 105% of current price
  targetRangeLower: 95,      // 95% of current price
  rebalanceThresholdUpper: 2, // 2% beyond upper range
  rebalanceThresholdLower: 2, // 2% beyond lower range
  maxSlippage: 0.5,          // 0.5% max slippage
  emergencyExitTrigger: 1,   // 1% emergency threshold
  maxUtilization: 95         // 95% max vault utilization
};

// Parris Island Strategy Parameters  
const parrisConfig = {
  // ... Bob parameters plus:
  adaptiveRanges: true,
  rebalanceCountThresholdHigh: 5,
  rebalanceCountThresholdLow: 2,
  adaptiveTimeframeHigh: 86400,      // 24 hours
  adaptiveTimeframeLow: 43200,       // 12 hours
  rangeAdjustmentPercentHigh: 10,    // 10% range adjustment
  thresholdAdjustmentPercentHigh: 5, // 5% threshold adjustment
  oracleSource: 0,                   // Primary oracle
  priceDeviationTolerance: 2,        // 2% price deviation
  maxPositionSizePercent: 50,        // 50% max position size
  targetUtilization: 80              // 80% target utilization
};
```

## Testing and Development

### Running Tests

```bash
# Run all tests
npm test

# Run specific test suites
npm test vault-initialization
npm test event-handling
npm test strategy-evaluation

# Run with coverage
npm run test:coverage
```

### Development Mode

```bash
# Link local fum_library for development
npm run dev:link

# Run automation with enhanced logging
npm run script scripts/test-automation.js --debug

# Start test environment
npm run test:setup
```

### Debugging

```bash
# Enable debug logging
DEBUG=fum:* npm run start

# Run with Node.js inspector
node --inspect scripts/test-automation.js

# Monitor event flows
npm run start:logs --log-port 3001
```

## Common Issues and Solutions

### Connection Issues

**Problem**: RPC connection failures
```
Error: Provider connection failed
```

**Solution**: Check RPC URLs and network connectivity
```bash
# Test RPC connectivity
curl -X POST -H "Content-Type: application/json" \
  --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
  $RPC_URL_1
```

### Authorization Issues

**Problem**: Vault not found in registry
```
Warning: Vault 0x... not authorized for automation
```

**Solution**: Verify vault has authorized the automation service
```javascript
// Check authorization status
const isAuthorized = await vaultContract.isExecutorAuthorized(
  automationServiceAddress
);
console.log('Authorized:', isAuthorized);
```

### Strategy Evaluation Issues

**Problem**: Strategy evaluation fails
```
Error: Unable to evaluate rebalance for position
```

**Solution**: Check position data and adapter connectivity
```javascript
// Debug position data
console.log('Position data:', position);
console.log('Pool data available:', !!position.poolData);
console.log('Token prices loaded:', !!position.tokenPrices);
```

## Performance Optimization

### Batch Processing

```javascript
// Process multiple vaults efficiently
const vaultBatches = chunk(authorizedVaults, config.batchSize);

for (const batch of vaultBatches) {
  await Promise.all(batch.map(vault => 
    automationService.processVault(vault)
  ));
  
  // Small delay between batches to prevent rate limiting
  await sleep(100);
}
```

### Caching Strategies

```javascript
// Enable position data caching
const vaultDataService = new VaultDataService({
  cacheEnabled: true,
  cacheTtlMs: 30000, // 30 second cache
  maxCacheSize: 1000
});

// Pre-load commonly accessed data
await vaultDataService.preloadVaultData(frequentVaults);
```

## Next Steps

- **[Architecture Overview](../architecture/overview.md)** - Understanding the system design
- **[Strategy Development](../examples/custom-strategies.md)** - Creating custom automation strategies  
- **[API Reference](../api-reference/README.md)** - Complete API documentation
- **[Deployment Guide](../configuration/deployment.md)** - Production deployment setup
- **[Monitoring Setup](../configuration/monitoring.md)** - Observability and alerting

## Support

For issues and questions:
1. Check the [troubleshooting guide](../configuration/monitoring.md#troubleshooting)
2. Review the [API documentation](../api-reference/README.md)
3. Examine [example implementations](../examples/)