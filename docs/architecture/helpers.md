# Helpers Architecture

## Overview

The helpers module contains the core business logic of the FUM Library. It orchestrates data gathering, performs calculations, and provides utility functions that abstract complex operations into simple, reusable interfaces.

## Module Organization

### Functional Separation

```
helpers/
├── tokenHelpers.js     # Token data management and validation
├── chainHelpers.js     # Chain configuration and utilities
├── strategyHelpers.js  # Strategy validation and parameter management
├── platformHelpers.js  # Platform metadata and configuration
└── formatHelpers.js    # Data formatting and display utilities
```

### Responsibility Distribution

#### **TokenHelpers** - Data Access Layer
- **Role**: Provides token configuration and validation
- **Pattern**: Repository pattern for static data
- **Complexity**: Low - mainly data access with validation

#### **ChainHelpers** - Configuration Management
- **Role**: Chain-specific configuration and utilities
- **Pattern**: Configuration facade pattern
- **Complexity**: Low - configuration access and validation

#### **StrategyHelpers** - Business Rules Engine
- **Role**: Strategy validation and parameter management
- **Pattern**: Rules engine with validation pipelines
- **Complexity**: Medium - complex validation logic

#### **PlatformHelpers** - Metadata Management
- **Role**: Platform configuration and display data
- **Pattern**: Metadata facade pattern
- **Complexity**: Low - simple data access

#### **FormatHelpers** - Presentation Layer
- **Role**: Data formatting for display
- **Pattern**: Utility functions with no state
- **Complexity**: Low - pure functions

## Strategy Helpers Architecture

### Rules Engine Pattern

StrategyHelpers implements a rules engine for parameter validation:

```javascript
export function validateStrategyParams(strategyId, params) {
  const strategy = strategies[strategyId];
  const errors = {};
  
  // Validate each parameter according to its rules
  Object.entries(strategy.parameters).forEach(([paramId, paramConfig]) => {
    const value = params[paramId];
    const paramErrors = validateParameter(value, paramConfig);
    
    if (paramErrors.length > 0) {
      errors[paramId] = paramErrors;
    }
  });
  
  return {
    isValid: Object.keys(errors).length === 0,
    errors
  };
}
```

### Parameter Processing Pipeline

```javascript
const validateParameter = (value, config) => {
  const errors = [];
  
  // Type validation
  if (!validateType(value, config.type)) {
    errors.push(`Expected ${config.type}, got ${typeof value}`);
  }
  
  // Range validation
  if (config.min !== undefined && value < config.min) {
    errors.push(`Value must be >= ${config.min}`);
  }
  
  if (config.max !== undefined && value > config.max) {
    errors.push(`Value must be <= ${config.max}`);
  }
  
  // Custom validation
  if (config.validator && !config.validator(value)) {
    errors.push(config.validationMessage || 'Invalid value');
  }
  
  return errors;
};
```

### Conditional Logic Handling

```javascript
export function shouldShowParameter(paramConfig, currentParams) {
  if (!paramConfig.conditionalOn) return true;
  
  const conditionValue = currentParams[paramConfig.conditionalOn];
  
  // Support multiple condition types
  if (Array.isArray(paramConfig.conditionalValue)) {
    return paramConfig.conditionalValue.includes(conditionValue);
  }
  
  return conditionValue === paramConfig.conditionalValue;
}
```

## Token Helpers Architecture

### Repository Pattern

TokenHelpers implements a repository pattern for token data:

```javascript
// Private data store
const tokens = {
  'USDC': {
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
    addresses: {
      1: '0xA0b86a33E6441e6d0b83cd...',      // Ethereum
      42161: '0xFF970A61A04b1cA0e7974F...',   // Arbitrum
    }
  }
  // ... more tokens
};

// Public interface
export function getTokenBySymbol(symbol) {
  return tokens[symbol] || null;
}

export function getTokenAddress(symbol, chainId) {
  const token = tokens[symbol];
  return token?.addresses[chainId] || null;
}
```

### Validation Patterns

```javascript
export function areTokensSupportedOnChain(tokenSymbols, chainId) {
  return tokenSymbols.every(symbol => {
    const token = getTokenBySymbol(symbol);
    return token && token.addresses[chainId];
  });
}

export function registerToken(token) {
  // Validation
  if (!token || !token.symbol) return false;
  
  // Required fields validation
  const requiredFields = ['symbol', 'name', 'decimals'];
  if (!requiredFields.every(field => token[field] !== undefined)) {
    return false;
  }
  
  // Register token
  tokens[token.symbol] = { ...token };
  return true;
}
```

## Format Helpers Architecture

### Pure Function Design

FormatHelpers contains only pure functions with no side effects:

```javascript
export function formatPrice(price) {
  if (!price || price === "0") return "0";
  
  const numPrice = parseFloat(price);
  
  // Different formatting based on price range
  if (numPrice < 0.0001) return "< 0.0001";
  if (numPrice < 1) return numPrice.toFixed(6);
  if (numPrice < 1000) return numPrice.toFixed(4);
  if (numPrice < 100000) return numPrice.toFixed(2);
  
  // Large numbers with K, M notation
  return abbreviateNumber(numPrice);
}
```

### Consistent Interface Pattern

```javascript
// All formatting functions follow same pattern:
// input -> validation -> formatting -> output

export function formatCurrency(value, decimals = 2) {
  if (!isValidNumber(value)) return "N/A";
  
  const num = parseFloat(value);
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  }).format(num);
}

export function formatPercentage(value, decimals = 2) {
  if (!isValidNumber(value)) return "N/A";
  
  const num = parseFloat(value);
  return new Intl.NumberFormat('en-US', {
    style: 'percent',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  }).format(num / 100);
}
```

## Cross-Module Communication

### Dependency Injection Pattern

Helpers avoid direct imports of heavy dependencies, instead receiving them as parameters:

```javascript
// Good: Dependencies injected
export const getVaultData = async (vaultAddress, provider, chainId) => {
  const adapter = AdapterFactory.getAdapter(platformId, provider);
  // ... use adapter
};

// Avoid: Direct dependency on specific implementations
// import UniswapV3Adapter from '../adapters/UniswapV3Adapter.js';
```

### Event-Driven Communication

For future extensibility, helpers are designed to support event-driven patterns:

```javascript
// Future: Event emission for monitoring
const calculateTVL = async (positions, prices) => {
  const startTime = Date.now();
  
  try {
    const tvl = performCalculation(positions, prices);
    
    // Future: Emit success event
    // events.emit('tvl:calculated', { tvl, duration: Date.now() - startTime });
    
    return tvl;
  } catch (error) {
    // Future: Emit error event  
    // events.emit('tvl:error', { error, duration: Date.now() - startTime });
    throw error;
  }
};
```

## Performance Optimization

### Caching at Helper Level

```javascript
// Cache expensive calculations
const calculationCache = new Map();

export const calculateComplexMetric = (position, poolData) => {
  const cacheKey = `${position.id}-${poolData.tick}`;
  
  if (calculationCache.has(cacheKey)) {
    return calculationCache.get(cacheKey);
  }
  
  const result = performExpensiveCalculation(position, poolData);
  calculationCache.set(cacheKey, result);
  
  return result;
};
```

### Batch Processing

```javascript
// Process multiple items efficiently
export const calculateMultiplePositionsTVL = async (positions, poolData, tokenData) => {
  // Group positions by pool for efficient processing
  const positionsByPool = groupBy(positions, 'poolAddress');
  
  const results = await Promise.all(
    Object.entries(positionsByPool).map(([poolAddress, poolPositions]) =>
      calculatePoolPositionsTVL(poolPositions, poolData[poolAddress], tokenData)
    )
  );
  
  return aggregateResults(results);
};
```

### Memory Management

```javascript
// Clean up intermediate data structures
const processLargeDataset = async (data) => {
  const chunks = chunkArray(data, 100); // Process in chunks
  const results = [];
  
  for (const chunk of chunks) {
    const chunkResults = await processChunk(chunk);
    results.push(...chunkResults);
    
    // Allow garbage collection between chunks
    if (results.length % 1000 === 0) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }
  
  return results;
};
```

## Testing Strategies

### Unit Testing with Mocks

```javascript
// Mock external dependencies
const mockAdapter = {
  getPositions: jest.fn().mockResolvedValue(mockPositions),
  calculateFees: jest.fn().mockResolvedValue(mockFees)
};

const mockPriceService = {
  fetchTokenPrices: jest.fn().mockResolvedValue(mockPrices)
};

// Test helper functions in isolation
test('calculatePositionsTVL handles partial failures', async () => {
  const positions = [validPosition, invalidPosition];
  const result = await calculatePositionsTVL(positions, poolData, tokenData);
  
  expect(result.hasPartialData).toBe(true);
  expect(result.positionTVL).toBeGreaterThan(0);
});
```

### Integration Testing

```javascript
// Test helper orchestration with real dependencies
test('getVaultData integration', async () => {
  const result = await getVaultData(testVaultAddress, testProvider, testChainId);
  
  expect(result).toHaveProperty('basicInfo');
  expect(result).toHaveProperty('positions');
  expect(result).toHaveProperty('tvl');
  expect(typeof result.tvl).toBe('number');
});
```

## Future Extensibility

### Plugin Architecture Support

Helpers designed to support future plugin architecture:

```javascript
// Future: Plugin registration
const plugins = new Map();

export function registerPlugin(name, plugin) {
  plugins.set(name, plugin);
}

export async function processWithPlugins(data, operation) {
  let result = data;
  
  for (const [name, plugin] of plugins) {
    if (plugin.supports(operation)) {
      result = await plugin.process(result, operation);
    }
  }
  
  return result;
}
```

### Configuration-Driven Behavior

```javascript
// Future: Configurable processing pipelines
const processingPipeline = [
  'validate',
  'enrich',
  'calculate',
  'format'
];

export async function processData(data, config = {}) {
  const pipeline = config.pipeline || processingPipeline;
  
  let result = data;
  for (const step of pipeline) {
    result = await processors[step](result, config);
  }
  
  return result;
}
```