# Blockchain Architecture

## Overview

The blockchain module provides abstraction over Web3 interactions, offering a consistent interface for wallet management, contract interactions, and multi-chain operations. It handles the complexity of provider management, transaction signing, and blockchain-specific configurations.

## Design Philosophy

### 1. **Provider Abstraction**
- Unified interface for different provider types (browser wallets, JSON-RPC, etc.)
- Environment-agnostic provider creation
- Graceful fallbacks between provider types

### 2. **Chain Agnostic Design**
- Same interface works across different blockchain networks
- Chain-specific configurations isolated to config files
- Easy addition of new chains without code changes

### 3. **Transaction Safety**
- Library never handles private keys
- All transactions return unsigned data for external signing
- Clear separation between data preparation and execution

### 4. **Contract Management**
- Centralized contract address and ABI management
- Lazy loading of contract instances
- Version management for contract upgrades

## Module Architecture

```
blockchain/
├── wallet.js      # Provider creation and wallet management
├── contracts.js   # Contract interaction utilities
└── index.js       # Module exports and aggregation
```

## Wallet Management Architecture

### Provider Creation Strategy

```javascript
// Hierarchical provider creation with fallbacks
export async function createProvider(options = {}) {
  const { rpcUrl, preferBrowser = true } = options;
  
  if (preferBrowser && typeof window !== 'undefined') {
    try {
      // Try browser wallet first
      return await createBrowserProvider();
    } catch (error) {
      console.warn('Browser wallet unavailable:', error.message);
      
      // Fallback to RPC if available
      if (rpcUrl) {
        return createJsonRpcProvider(rpcUrl);
      }
      
      throw new Error('No provider available');
    }
  }
  
  // Direct RPC provider for server environments
  if (rpcUrl) {
    return createJsonRpcProvider(rpcUrl);
  }
  
  throw new Error('Provider configuration required');
}
```

### Browser Wallet Integration

```javascript
export async function createBrowserProvider() {
  // Check for available wallet
  if (!window.ethereum) {
    throw new Error('No browser wallet detected');
  }
  
  // Create ethers browser provider
  const provider = new ethers.BrowserProvider(window.ethereum);
  
  // Validate connection
  try {
    await provider.getSigner();
    return provider;
  } catch (error) {
    throw new Error(`Wallet connection failed: ${error.message}`);
  }
}
```

### Connection Management

```javascript
export async function requestWalletConnection(provider) {
  if (!provider || typeof provider.send !== 'function') {
    throw new Error('Invalid provider for wallet connection');
  }
  
  try {
    // Request account access
    const accounts = await provider.send('eth_requestAccounts', []);
    
    if (!accounts || accounts.length === 0) {
      throw new Error('No accounts available');
    }
    
    return accounts;
  } catch (error) {
    if (error.code === 4001) {
      throw new Error('User rejected connection request');
    }
    throw new Error(`Connection failed: ${error.message}`);
  }
}
```

### Chain Management

```javascript
export async function switchChain(provider, chainId) {
  if (!provider.send) {
    throw new Error('Provider does not support chain switching');
  }
  
  const hexChainId = `0x${chainId.toString(16)}`;
  
  try {
    // Try to switch to the chain
    await provider.send('wallet_switchEthereumChain', [
      { chainId: hexChainId }
    ]);
  } catch (error) {
    // Chain not added to wallet, try to add it
    if (error.code === 4902) {
      await addChainToWallet(provider, chainId);
    } else {
      throw error;
    }
  }
}

async function addChainToWallet(provider, chainId) {
  const chainConfig = getChainConfig(chainId);
  
  if (!chainConfig) {
    throw new Error(`Unsupported chain ID: ${chainId}`);
  }
  
  await provider.send('wallet_addEthereumChain', [{
    chainId: `0x${chainId.toString(16)}`,
    chainName: chainConfig.name,
    rpcUrls: [chainConfig.rpcUrl],
    nativeCurrency: chainConfig.nativeCurrency,
    blockExplorerUrls: [chainConfig.explorerUrl]
  }]);
}
```

## Contract Management Architecture

### Contract Registry Pattern

```javascript
// Centralized contract management
const contractInstances = new Map();

export function getContract(contractName, chainId, provider) {
  const cacheKey = `${contractName}-${chainId}-${provider.connection?.url || 'browser'}`;
  
  // Return cached instance if available
  if (contractInstances.has(cacheKey)) {
    return contractInstances.get(cacheKey);
  }
  
  // Create new contract instance
  const address = getContractAddress(contractName, chainId);
  const abi = getContractABI(contractName);
  
  if (!address) {
    throw new Error(`No address for contract ${contractName} on chain ${chainId}`);
  }
  
  if (!abi) {
    throw new Error(`No ABI for contract ${contractName}`);
  }
  
  const contract = new ethers.Contract(address, abi, provider);
  
  // Cache for reuse
  contractInstances.set(cacheKey, contract);
  
  return contract;
}
```

### Address Resolution

```javascript
export function getContractAddress(contractName, chainId) {
  const contractData = contracts[contractName];
  
  if (!contractData) {
    throw new Error(`Unknown contract: ${contractName}`);
  }
  
  const address = contractData.addresses[chainId];
  
  if (!address) {
    console.warn(`No address for ${contractName} on chain ${chainId}`);
    return null;
  }
  
  return address;
}
```

### ABI Management

```javascript
export function getContractABI(contractName) {
  const contractData = contracts[contractName];
  
  if (!contractData) {
    throw new Error(`Unknown contract: ${contractName}`);
  }
  
  if (!contractData.abi) {
    throw new Error(`No ABI for contract: ${contractName}`);
  }
  
  return contractData.abi;
}
```

## Vault Contract Interactions

### Specialized Contract Helpers

```javascript
export async function getVaultContract(vaultAddress, provider) {
  // Get generic vault ABI
  const abi = getContractABI('Vault');
  return new ethers.Contract(vaultAddress, abi, provider);
}

export async function getVaultFactory(chainId, provider) {
  return getContract('VaultFactory', chainId, provider);
}

export async function getBatchExecutor(chainId, provider) {
  return getContract('BatchExecutor', chainId, provider);
}
```

### User Vault Discovery

```javascript
export async function getUserVaults(userAddress, provider) {
  try {
    // Get the current chain ID
    const network = await provider.getNetwork();
    const chainId = Number(network.chainId);
    
    // Get vault factory contract
    const vaultFactory = await getVaultFactory(chainId, provider);
    
    // Query user's vaults
    const vaultAddresses = await vaultFactory.getUserVaults(userAddress);
    
    return vaultAddresses;
  } catch (error) {
    console.error('Error fetching user vaults:', error);
    throw new Error(`Failed to fetch vaults for ${userAddress}: ${error.message}`);
  }
}
```

### Vault Information Retrieval

```javascript
export async function getVaultInfo(vaultAddress, provider) {
  try {
    const vaultContract = await getVaultContract(vaultAddress, provider);
    
    // Fetch basic vault information in parallel
    const [
      owner,
      strategy,
      targetTokens,
      targetPlatforms,
      isActive
    ] = await Promise.all([
      vaultContract.owner().catch(() => null),
      vaultContract.strategy().catch(() => null),
      vaultContract.getTargetTokens().catch(() => []),
      vaultContract.getTargetPlatforms().catch(() => []),
      vaultContract.isActive().catch(() => false)
    ]);
    
    return {
      address: vaultAddress,
      owner,
      strategy,
      targetTokens,
      targetPlatforms,
      isActive
    };
  } catch (error) {
    console.error(`Error fetching vault info for ${vaultAddress}:`, error);
    throw new Error(`Failed to get vault info: ${error.message}`);
  }
}
```

## Error Handling

### Network Error Patterns

```javascript
async function safeContractCall(contractMethod, ...args) {
  try {
    return await contractMethod(...args);
  } catch (error) {
    // Categorize errors for appropriate handling
    if (error.code === 'NETWORK_ERROR') {
      throw new NetworkError('Blockchain network unavailable', error);
    }
    
    if (error.code === 'CALL_EXCEPTION') {
      throw new ContractError('Contract call failed', error);
    }
    
    if (error.reason) {
      throw new ContractError(`Contract reverted: ${error.reason}`, error);
    }
    
    // Unknown error
    throw new BlockchainError('Blockchain operation failed', error);
  }
}
```

### Retry Mechanisms

```javascript
async function retryContractCall(contractMethod, args, maxRetries = 3) {
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await contractMethod(...args);
    } catch (error) {
      lastError = error;
      
      // Don't retry on certain error types
      if (error.code === 'CALL_EXCEPTION' || error.reason) {
        throw error; // Contract logic error, don't retry
      }
      
      if (attempt < maxRetries) {
        const delay = Math.pow(2, attempt - 1) * 1000; // Exponential backoff
        console.warn(`Contract call attempt ${attempt} failed, retrying in ${delay}ms`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError;
}
```

### Provider Validation

```javascript
export function validateProvider(provider) {
  if (!provider) {
    throw new Error('Provider is required');
  }
  
  if (typeof provider.getNetwork !== 'function') {
    throw new Error('Invalid provider: missing getNetwork method');
  }
  
  if (typeof provider.call !== 'function') {
    throw new Error('Invalid provider: missing call method');
  }
  
  return true;
}
```

## Transaction Management

### Transaction Data Generation

```javascript
// Library generates transaction data, doesn't execute
export async function generateTransactionData(contractName, methodName, params, chainId) {
  const address = getContractAddress(contractName, chainId);
  const abi = getContractABI(contractName);
  
  if (!address || !abi) {
    throw new Error(`Cannot generate transaction for ${contractName} on chain ${chainId}`);
  }
  
  // Create interface for encoding
  const contractInterface = new ethers.Interface(abi);
  
  try {
    const data = contractInterface.encodeFunctionData(methodName, params);
    
    return {
      to: address,
      data,
      value: 0 // Most calls don't send ETH
    };
  } catch (error) {
    throw new Error(`Failed to encode transaction data: ${error.message}`);
  }
}
```

### Gas Estimation

```javascript
export async function estimateGas(provider, transactionData) {
  try {
    const gasEstimate = await provider.estimateGas(transactionData);
    
    // Add 20% buffer for safety
    const gasLimit = (gasEstimate * 120n) / 100n;
    
    return {
      gasLimit,
      gasEstimate
    };
  } catch (error) {
    console.warn('Gas estimation failed:', error);
    
    // Return reasonable defaults
    return {
      gasLimit: 500000n, // 500k gas limit
      gasEstimate: null
    };
  }
}
```

## Multi-Chain Support

### Chain Configuration Management

```javascript
export function getChainConfig(chainId) {
  const config = chains[chainId];
  
  if (!config) {
    return null;
  }
  
  return {
    chainId,
    name: config.name,
    rpcUrl: config.rpcUrl,
    explorerUrl: config.explorerUrl,
    nativeCurrency: config.nativeCurrency,
    platformAddresses: config.platformAddresses || {}
  };
}

export function getSupportedChainIds() {
  return Object.keys(chains).map(id => parseInt(id));
}

export function isChainSupported(chainId) {
  return chainId in chains;
}
```

### Cross-Chain Data Aggregation

```javascript
export async function getMultiChainData(userAddress, chainIds, provider) {
  const results = await Promise.allSettled(
    chainIds.map(async (chainId) => {
      try {
        // Switch to appropriate chain or use chain-specific provider
        const chainProvider = await getProviderForChain(chainId, provider);
        const data = await getChainSpecificData(userAddress, chainProvider);
        
        return { chainId, data, success: true };
      } catch (error) {
        console.error(`Failed to fetch data for chain ${chainId}:`, error);
        return { chainId, error: error.message, success: false };
      }
    })
  );
  
  return {
    successful: results.filter(r => r.status === 'fulfilled' && r.value.success),
    failed: results.filter(r => r.status === 'rejected' || !r.value.success),
    hasPartialData: results.some(r => r.status === 'rejected' || !r.value.success)
  };
}
```

## Performance Optimization

### Connection Pooling

```javascript
// Maintain provider instances per chain
const providerPool = new Map();

export function getProviderForChain(chainId, fallbackProvider) {
  const cacheKey = `chain-${chainId}`;
  
  if (providerPool.has(cacheKey)) {
    return providerPool.get(cacheKey);
  }
  
  const chainConfig = getChainConfig(chainId);
  
  if (!chainConfig) {
    return fallbackProvider; // Use fallback if chain not configured
  }
  
  const provider = new ethers.JsonRpcProvider(chainConfig.rpcUrl);
  providerPool.set(cacheKey, provider);
  
  return provider;
}
```

### Batch Contract Calls

```javascript
export async function batchContractCalls(calls, provider) {
  // Use multicall contract for efficiency
  const multicallAddress = getContractAddress('Multicall', await getChainId(provider));
  
  if (!multicallAddress) {
    // Fallback to individual calls
    return Promise.all(calls.map(call => call()));
  }
  
  // Encode all calls for multicall
  const encodedCalls = calls.map(call => ({
    target: call.target,
    callData: call.data
  }));
  
  const multicall = await getContract('Multicall', await getChainId(provider), provider);
  const results = await multicall.aggregate(encodedCalls);
  
  // Decode results
  return results.returnData.map((data, index) => {
    return calls[index].decode(data);
  });
}
```

### Contract Instance Caching

```javascript
// Automatic cleanup of stale contract instances
setInterval(() => {
  const now = Date.now();
  const maxAge = 10 * 60 * 1000; // 10 minutes
  
  for (const [key, instance] of contractInstances.entries()) {
    if (now - instance.createdAt > maxAge) {
      contractInstances.delete(key);
    }
  }
}, 5 * 60 * 1000); // Cleanup every 5 minutes
```

## Security Considerations

### Input Validation

```javascript
export function validateAddress(address) {
  if (!address || typeof address !== 'string') {
    throw new Error('Address must be a string');
  }
  
  if (!ethers.isAddress(address)) {
    throw new Error(`Invalid Ethereum address: ${address}`);
  }
  
  return ethers.getAddress(address); // Returns checksummed address
}

export function validateChainId(chainId) {
  if (!Number.isInteger(chainId) || chainId <= 0) {
    throw new Error('Chain ID must be a positive integer');
  }
  
  if (!isChainSupported(chainId)) {
    throw new Error(`Unsupported chain ID: ${chainId}`);
  }
  
  return chainId;
}
```

### Safe Contract Interactions

```javascript
export async function safeContractRead(contract, methodName, ...args) {
  // Validate contract has the method
  if (typeof contract[methodName] !== 'function') {
    throw new Error(`Contract does not have method: ${methodName}`);
  }
  
  try {
    // Ensure it's a read-only call
    const result = await contract[methodName].staticCall(...args);
    return result;
  } catch (error) {
    throw new Error(`Contract read failed for ${methodName}: ${error.message}`);
  }
}
```

## Testing Strategies

### Mock Providers

```javascript
export class MockProvider {
  constructor(mockData = {}) {
    this.mockData = mockData;
    this.callHistory = [];
  }
  
  async call(transaction) {
    this.callHistory.push(transaction);
    
    // Return mock data based on the call
    const key = `${transaction.to}-${transaction.data}`;
    return this.mockData[key] || '0x';
  }
  
  async getNetwork() {
    return { chainId: this.mockData.chainId || 1 };
  }
  
  async estimateGas() {
    return BigInt(21000); // Standard gas estimate
  }
}
```

### Contract Testing

```javascript
describe('Contract Interactions', () => {
  let mockProvider;
  
  beforeEach(() => {
    mockProvider = new MockProvider({
      chainId: 1,
      'vault-address-method': '0x...' // Mock return data
    });
  });
  
  test('should fetch vault info correctly', async () => {
    const vaultInfo = await getVaultInfo('0x123...', mockProvider);
    
    expect(vaultInfo).toHaveProperty('address');
    expect(vaultInfo).toHaveProperty('owner');
    expect(mockProvider.callHistory).toHaveLength(5); // Number of parallel calls
  });
});
```

## Future Extensibility

### Plugin Architecture

```javascript
// Future: Blockchain plugin system
class BlockchainPlugin {
  constructor(name, chainId, config) {
    this.name = name;
    this.chainId = chainId;
    this.config = config;
  }
  
  async createProvider() {
    // Plugin-specific provider creation
  }
  
  async getContractAddress(contractName) {
    // Plugin-specific address resolution
  }
}

const pluginRegistry = new Map();

export function registerBlockchainPlugin(plugin) {
  pluginRegistry.set(plugin.chainId, plugin);
}
```

### Advanced Features

```javascript
// Future: Transaction simulation
export async function simulateTransaction(transactionData, provider) {
  // Use eth_call with state override for simulation
  const result = await provider.call({
    ...transactionData,
    // Add simulation parameters
  });
  
  return {
    success: true,
    gasUsed: result.gasUsed,
    returnData: result.returnData
  };
}

// Future: MEV protection
export async function submitTransactionWithMEVProtection(transactionData, provider) {
  // Use flashbots or similar for MEV protection
  const flashbotsProvider = new providers.FlashbotsBundleProvider(provider);
  
  return flashbotsProvider.sendBundle([transactionData]);
}
```