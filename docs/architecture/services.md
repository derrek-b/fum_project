# Services Architecture

## Overview

The services module handles integration with external APIs and data sources. It implements caching, rate limiting, error handling, and data transformation patterns to provide reliable access to external data while minimizing API calls and costs.

## Design Principles

### 1. **External Data Abstraction**
- Services provide a consistent interface regardless of external API changes
- Internal data structures remain stable even when external APIs evolve
- Multiple providers can be supported for the same data type

### 2. **Reliability Over Speed**
- Graceful degradation when external services are unavailable
- Retry mechanisms with exponential backoff
- Fallback strategies for critical data

### 3. **Cost Optimization**
- Intelligent caching to minimize API calls
- Batch operations to reduce request count
- Configurable rate limiting to stay within quotas

### 4. **Data Quality**
- Input validation for external data
- Consistency checks for returned data
- Clear indication when data is stale or partial

## CoinGecko Service Architecture

### Service Pattern Implementation

```javascript
// Singleton pattern with configurable behavior
class CoinGeckoService {
  constructor() {
    this.config = DEFAULT_CONFIG;
    this.cache = new PriceCache();
    this.batchQueue = new BatchQueue();
  }
  
  // Public interface
  async fetchTokenPrices(tokenSymbols, cacheStrategy) {
    return this.processRequest(tokenSymbols, cacheStrategy);
  }
  
  // Private implementation
  async processRequest(tokenSymbols) {
    // Check cache first
    // Queue for batching if needed
    // Execute API call
    // Update cache
    // Return results
  }
}
```

### Caching Strategy

#### Time-Based Cache with TTL
```javascript
class PriceCache {
  constructor() {
    this.cache = new Map();
    this.expiryTime = 60000; // 60 seconds
  }
  
  get(tokenSymbol) {
    const entry = this.cache.get(tokenSymbol);
    
    if (!entry) return null;
    
    // Check if entry is still valid
    if (Date.now() - entry.timestamp > this.expiryTime) {
      this.cache.delete(tokenSymbol);
      return null;
    }
    
    return entry.price;
  }
  
  set(tokenSymbol, price) {
    this.cache.set(tokenSymbol, {
      price,
      timestamp: Date.now()
    });
  }
}
```

#### Cache Warming Strategy
```javascript
export async function prefetchTokenPrices(tokenSymbols) {
  // Check which tokens need refreshing
  const tokensToFetch = tokenSymbols.filter(symbol => {
    const cached = priceCache.get(symbol);
    return !cached || isNearExpiry(cached);
  });
  
  if (tokensToFetch.length > 0) {
    // Fetch in background without blocking
    fetchTokenPrices(tokensToFetch, '2-MINUTES').catch(error => {
      console.warn('Background price fetch failed:', error);
    });
  }
}
```

### Batch Processing

#### Request Batching Pattern
```javascript
class BatchQueue {
  constructor() {
    this.queue = [];
    this.timer = null;
    this.batchSize = 250; // CoinGecko limit
    this.batchDelay = 100; // 100ms debounce
  }
  
  add(tokenSymbol, resolve, reject) {
    this.queue.push({ tokenSymbol, resolve, reject });
    
    // Start or reset the batch timer
    if (this.timer) clearTimeout(this.timer);
    
    // Execute immediately if batch is full
    if (this.queue.length >= this.batchSize) {
      this.executeBatch();
    } else {
      // Otherwise wait for more requests
      this.timer = setTimeout(() => this.executeBatch(), this.batchDelay);
    }
  }
  
  async executeBatch() {
    if (this.queue.length === 0) return;
    
    const batch = this.queue.splice(0, this.batchSize);
    const symbols = [...new Set(batch.map(item => item.tokenSymbol))];
    
    try {
      const prices = await this.fetchPricesFromAPI(symbols);
      
      // Resolve all promises in the batch
      batch.forEach(({ tokenSymbol, resolve }) => {
        resolve(prices[tokenSymbol] || null);
      });
    } catch (error) {
      // Reject all promises in the batch
      batch.forEach(({ reject }) => {
        reject(error);
      });
    }
  }
}
```

#### Promise Coordination
```javascript
export function fetchTokenPrices(tokenSymbols, cacheStrategy) {
  const promises = tokenSymbols.map(symbol => {
    // Check cache first
    const cached = priceCache.get(symbol);
    if (cached) return Promise.resolve(cached);
    
    // Add to batch queue
    return new Promise((resolve, reject) => {
      batchQueue.add(symbol, resolve, reject);
    });
  });
  
  return Promise.all(promises).then(prices => {
    // Convert array to object
    return tokenSymbols.reduce((acc, symbol, index) => {
      acc[symbol] = prices[index];
      return acc;
    }, {});
  });
}
```

### Error Handling

#### Layered Error Handling
```javascript
async function makeApiRequest(endpoint, params) {
  try {
    // Level 1: Network/HTTP errors
    const response = await fetch(buildApiUrl(endpoint, params));
    
    if (!response.ok) {
      throw new ApiError(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    // Level 2: JSON parsing errors
    const data = await response.json();
    
    // Level 3: API-specific errors
    if (data.error) {
      throw new ApiError(`CoinGecko API Error: ${data.error}`);
    }
    
    // Level 4: Data validation
    if (!validateResponse(data)) {
      throw new ValidationError('Invalid response format from CoinGecko');
    }
    
    return data;
    
  } catch (error) {
    // Add context and rethrow
    throw new ServiceError(`CoinGecko request failed for ${endpoint}`, error);
  }
}
```

#### Retry Strategy
```javascript
async function fetchWithRetry(url, options, maxRetries = 3) {
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fetch(url, options);
    } catch (error) {
      lastError = error;
      
      // Don't retry on client errors (4xx)
      if (error.status >= 400 && error.status < 500) {
        throw error;
      }
      
      // Exponential backoff: 1s, 2s, 4s
      if (attempt < maxRetries) {
        const delay = Math.pow(2, attempt - 1) * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
        console.warn(`Retry attempt ${attempt} after ${delay}ms`);
      }
    }
  }
  
  throw lastError;
}
```

#### Fallback Strategies
```javascript
export async function fetchTokenPrices(tokenSymbols, cacheStrategy) {
  try {
    // Primary: CoinGecko API
    return await fetchFromCoinGecko(tokenSymbols, cacheStrategy);
  } catch (error) {
    console.error('CoinGecko failed, trying fallback:', error);
    
    try {
      // Fallback 1: Alternative API
      return await fetchFromAlternativeAPI(tokenSymbols, cacheStrategy);
    } catch (fallbackError) {
      console.error('All price services failed:', fallbackError);
      
      // Fallback 2: Return cached prices (even if stale)
      return getStaleFromCache(tokenSymbols);
    }
  }
}
```

### Rate Limiting

#### Token Bucket Implementation
```javascript
class RateLimiter {
  constructor(maxRequests, windowMs) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
    this.requests = [];
  }
  
  async checkLimit() {
    const now = Date.now();
    
    // Remove old requests outside the window
    this.requests = this.requests.filter(
      timestamp => now - timestamp < this.windowMs
    );
    
    // Check if we're at the limit
    if (this.requests.length >= this.maxRequests) {
      const oldestRequest = Math.min(...this.requests);
      const waitTime = this.windowMs - (now - oldestRequest);
      
      console.log(`Rate limit reached, waiting ${waitTime}ms`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
      
      return this.checkLimit(); // Recursive check after waiting
    }
    
    // Record this request
    this.requests.push(now);
    return true;
  }
}
```

#### Usage in Service
```javascript
const rateLimiter = new RateLimiter(50, 60000); // 50 requests per minute

async function makeRequest(endpoint, params) {
  await rateLimiter.checkLimit();
  return fetch(buildApiUrl(endpoint, params));
}
```

## Configuration Management

### Environment-Based Configuration
```javascript
const DEFAULT_CONFIG = {
  apiBaseUrl: 'https://api.coingecko.com/api/v3',
  cacheExpiryTime: 60000,     // 1 minute
  batchSize: 250,             // CoinGecko limit
  batchDelay: 100,            // 100ms debounce
  retryAttempts: 3,
  retryDelay: 1000,           // Base delay for exponential backoff
  useFreeTier: true           // Use free API if no key provided
};

export function configureCoingecko(config = {}) {
  serviceConfig = { ...DEFAULT_CONFIG, ...config };
  
  // Update cache expiry time
  priceCache.expiryTime = serviceConfig.cacheExpiryTime;
  
  // Update batch queue settings
  batchQueue.batchSize = serviceConfig.batchSize;
  batchQueue.batchDelay = serviceConfig.batchDelay;
}
```

### API Key Management
```javascript
function getApiKey() {
  // Priority order: explicit config > environment > none
  return serviceConfig.apiKey || 
         process.env.COINGECKO_API_KEY || 
         null;
}

function buildApiUrl(endpoint, params = {}) {
  const apiKey = getApiKey();
  const url = new URL(`${serviceConfig.apiBaseUrl}${endpoint}`);
  
  // Add query parameters
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.append(key, value);
  });
  
  // Add API key if available
  if (apiKey) {
    url.searchParams.append('x_cg_demo_api_key', apiKey);
  }
  
  return url.toString();
}
```

## Data Transformation

### Token Symbol Mapping
```javascript
// Map internal symbols to CoinGecko IDs
const SYMBOL_TO_COINGECKO_ID = {
  'ETH': 'ethereum',
  'WETH': 'weth',
  'USDC': 'usd-coin',
  'USDT': 'tether',
  'DAI': 'dai',
  'WBTC': 'wrapped-bitcoin'
};

function mapSymbolToId(symbol) {
  const id = SYMBOL_TO_COINGECKO_ID[symbol.toUpperCase()];
  if (!id) {
    throw new Error(`No CoinGecko ID mapping for symbol: ${symbol}`);
  }
  return id;
}
```

### Response Normalization
```javascript
function normalizeApiResponse(apiData) {
  const normalized = {};
  
  Object.entries(apiData).forEach(([coinId, priceData]) => {
    // Find symbol for this coin ID
    const symbol = findSymbolByCoinId(coinId);
    
    if (symbol && priceData.usd) {
      normalized[symbol] = {
        price: priceData.usd,
        timestamp: Date.now(),
        source: 'coingecko'
      };
    }
  });
  
  return normalized;
}
```

### Data Validation
```javascript
function validatePriceData(data) {
  // Check required structure
  if (!data || typeof data !== 'object') {
    return false;
  }
  
  // Validate each price entry
  for (const [symbol, priceInfo] of Object.entries(data)) {
    if (!isValidSymbol(symbol)) return false;
    if (!isValidPrice(priceInfo.price)) return false;
    if (!isValidTimestamp(priceInfo.timestamp)) return false;
  }
  
  return true;
}

function isValidPrice(price) {
  return typeof price === 'number' && 
         price > 0 && 
         price < Number.MAX_SAFE_INTEGER &&
         !isNaN(price);
}
```

## Performance Monitoring

### Service Metrics
```javascript
class ServiceMetrics {
  constructor() {
    this.metrics = {
      requests: 0,
      cacheHits: 0,
      cacheMisses: 0,
      errors: 0,
      averageResponseTime: 0
    };
  }
  
  recordRequest(startTime, success, fromCache) {
    this.metrics.requests++;
    
    if (fromCache) {
      this.metrics.cacheHits++;
    } else {
      this.metrics.cacheMisses++;
    }
    
    if (!success) {
      this.metrics.errors++;
    }
    
    // Update average response time
    const responseTime = Date.now() - startTime;
    this.metrics.averageResponseTime = 
      (this.metrics.averageResponseTime + responseTime) / 2;
  }
  
  getCacheHitRate() {
    const total = this.metrics.cacheHits + this.metrics.cacheMisses;
    return total > 0 ? this.metrics.cacheHits / total : 0;
  }
}
```

### Debugging Support
```javascript
export function getPriceCache() {
  return {
    entries: priceCache.size,
    cacheAge: Math.min(...Array.from(priceCache.cache.values())
      .map(entry => Date.now() - entry.timestamp)) / 1000,
    hitRate: metrics.getCacheHitRate(),
    totalRequests: metrics.metrics.requests
  };
}
```

## Adding New Services

### Service Interface Pattern
```javascript
// Base service interface
class ExternalService {
  constructor(config) {
    this.config = config;
    this.cache = new Map();
    this.rateLimiter = new RateLimiter(config.rateLimit);
  }
  
  async fetchData(params) {
    // Check cache
    const cached = this.checkCache(params);
    if (cached) return cached;
    
    // Rate limiting
    await this.rateLimiter.checkLimit();
    
    // Fetch from API
    const data = await this.makeRequest(params);
    
    // Update cache
    this.updateCache(params, data);
    
    return data;
  }
  
  // Abstract methods to be implemented
  makeRequest(params) { throw new Error('Must implement'); }
  buildUrl(params) { throw new Error('Must implement'); }
  validateResponse(data) { throw new Error('Must implement'); }
}
```

### Example: Adding DeBank API Service
```javascript
class DeBankService extends ExternalService {
  constructor(config) {
    super({
      apiBaseUrl: 'https://openapi.debank.com',
      rateLimit: { maxRequests: 100, windowMs: 60000 },
      ...config
    });
  }
  
  async fetchPortfolioData(address) {
    return this.fetchData({ address, endpoint: 'portfolio' });
  }
  
  buildUrl(params) {
    return `${this.config.apiBaseUrl}/v1/user/total_balance?id=${params.address}`;
  }
  
  validateResponse(data) {
    return data && 
           typeof data.total_usd_value === 'number' &&
           Array.isArray(data.chain_list);
  }
  
  async makeRequest(params) {
    const response = await fetch(this.buildUrl(params));
    const data = await response.json();
    
    if (!this.validateResponse(data)) {
      throw new Error('Invalid DeBank API response');
    }
    
    return this.transformResponse(data);
  }
}
```

## Testing Strategies

### Mock Service Implementation
```javascript
// Test doubles for external services
class MockCoinGeckoService {
  constructor(mockData = {}) {
    this.mockData = mockData;
    this.callCount = 0;
  }
  
  async fetchTokenPrices(symbols) {
    this.callCount++;
    
    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Return mock data
    return symbols.reduce((acc, symbol) => {
      acc[symbol] = this.mockData[symbol] || 1.0;
      return acc;
    }, {});
  }
  
  reset() {
    this.callCount = 0;
  }
}
```

### Integration Testing
```javascript
describe('CoinGecko Service Integration', () => {
  test('should handle rate limiting gracefully', async () => {
    const service = new CoinGeckoService({
      rateLimit: { maxRequests: 2, windowMs: 1000 }
    });
    
    // Make requests that exceed rate limit
    const promises = [
      service.fetchTokenPrices(['ETH']),
      service.fetchTokenPrices(['USDC']),
      service.fetchTokenPrices(['DAI'])  // Should be delayed
    ];
    
    const start = Date.now();
    await Promise.all(promises);
    const duration = Date.now() - start;
    
    // Third request should have been delayed
    expect(duration).toBeGreaterThan(1000);
  });
});
```

## Future Extensibility

### Multi-Provider Support
```javascript
// Future: Support multiple price providers
class PriceAggregator {
  constructor() {
    this.providers = [
      new CoinGeckoService(),
      new CoinMarketCapService(),
      new DeFiPulseService()
    ];
  }
  
  async fetchTokenPrices(symbols, cacheStrategy) {
    // Try providers in order of preference
    for (const provider of this.providers) {
      try {
        return await provider.fetchTokenPrices(symbols, cacheStrategy);
      } catch (error) {
        console.warn(`Provider ${provider.name} failed:`, error);
        continue;
      }
    }
    
    throw new Error('All price providers failed');
  }
}
```

### Plugin Architecture
```javascript
// Future: Plugin system for custom data enrichment
class ServicePlugin {
  constructor(name, processor) {
    this.name = name;
    this.processor = processor;
  }
  
  async process(data, context) {
    return this.processor(data, context);
  }
}

// Usage
const priceValidator = new ServicePlugin('priceValidator', (data) => {
  return validatePriceReasonableness(data);
});

const currencyConverter = new ServicePlugin('currencyConverter', (data, context) => {
  return convertCurrency(data, context.targetCurrency);
});
```