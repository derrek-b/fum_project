# Wallet API

Ethereum wallet integration utilities for browser and RPC providers.

## Overview

The Wallet module provides utilities for creating and managing Ethereum providers, connecting to wallets, and handling chain operations. It supports both browser-based wallets (MetaMask, etc.) and JSON-RPC providers.

## Provider Creation

### createBrowserProvider

Creates an ethers provider using the browser's Ethereum wallet.

#### Signature
```javascript
async createBrowserProvider(): Promise<ethers.BrowserProvider>
```

#### Returns

`Promise<ethers.BrowserProvider>` - Configured ethers provider

#### Throws

| Error | Condition |
|-------|-----------|
| `Error` | No Ethereum provider found in browser |

#### Example

```javascript
import { createBrowserProvider } from './blockchain/wallet.js';

try {
  const provider = await createBrowserProvider();
  console.log('Connected to browser wallet');
} catch (error) {
  console.error('MetaMask not installed');
}
```

### createJsonRpcProvider

Creates an ethers provider using an RPC URL.

#### Signature
```javascript
createJsonRpcProvider(rpcUrl: string): ethers.JsonRpcProvider
```

#### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| rpcUrl | `string` | Yes | The RPC endpoint URL |

#### Returns

`ethers.JsonRpcProvider` - Configured ethers provider

#### Throws

| Error | Condition |
|-------|-----------|
| `Error` | RPC URL is not provided |

#### Example

```javascript
import { createJsonRpcProvider } from './blockchain/wallet.js';

const provider = createJsonRpcProvider('https://eth-mainnet.g.alchemy.com/v2/YOUR_API_KEY');
```

### createProvider

Creates an appropriate provider based on environment and parameters.

#### Signature
```javascript
async createProvider(options?: Object): Promise<ethers.Provider>
```

#### Parameters

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| options | `Object` | No | {} | Provider options |
| options.rpcUrl | `string` | No | - | RPC URL for JsonRpcProvider |
| options.preferBrowser | `boolean` | No | true | Whether to prefer browser wallet when available |

#### Returns

`Promise<ethers.Provider>` - The provider instance

#### Throws

| Error | Condition |
|-------|-----------|
| `Error` | No provider method available |

#### Example

```javascript
// Prefer browser wallet, fallback to RPC
const provider = await createProvider({
  rpcUrl: 'https://eth-mainnet.g.alchemy.com/v2/YOUR_API_KEY',
  preferBrowser: true
});

// Force RPC provider
const rpcProvider = await createProvider({
  rpcUrl: 'https://eth-mainnet.g.alchemy.com/v2/YOUR_API_KEY',
  preferBrowser: false
});
```

## Wallet Operations

### getConnectedAccounts

Gets the connected accounts from a browser wallet.

#### Signature
```javascript
async getConnectedAccounts(provider: ethers.BrowserProvider): Promise<string[]>
```

#### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| provider | `ethers.BrowserProvider` | Yes | The ethers provider |

#### Returns

`Promise<string[]>` - Array of connected account addresses

#### Example

```javascript
const provider = await createBrowserProvider();
const accounts = await getConnectedAccounts(provider);

if (accounts.length > 0) {
  console.log('Connected account:', accounts[0]);
} else {
  console.log('No accounts connected');
}
```

### requestWalletConnection

Requests wallet connection (triggers wallet popup).

#### Signature
```javascript
async requestWalletConnection(provider: ethers.BrowserProvider): Promise<string[]>
```

#### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| provider | `ethers.BrowserProvider` | Yes | The ethers provider |

#### Returns

`Promise<string[]>` - Array of connected account addresses

#### Throws

| Error | Condition |
|-------|-----------|
| `Error` | Failed to connect to wallet |

#### Example

```javascript
const provider = await createBrowserProvider();

try {
  const accounts = await requestWalletConnection(provider);
  console.log('Connected accounts:', accounts);
} catch (error) {
  console.error('User rejected connection');
}
```

## Chain Operations

### getChainId

Gets the chain ID from the provider.

#### Signature
```javascript
async getChainId(provider: ethers.Provider): Promise<number>
```

#### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| provider | `ethers.Provider` | Yes | The ethers provider |

#### Returns

`Promise<number>` - The chain ID

#### Example

```javascript
const chainId = await getChainId(provider);
console.log('Connected to chain:', chainId);
// 1 for Ethereum mainnet, 137 for Polygon, etc.
```

### switchChain

Switches the connected wallet to a specific chain.

#### Signature
```javascript
async switchChain(provider: ethers.BrowserProvider, chainId: number | string): Promise<boolean>
```

#### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| provider | `ethers.BrowserProvider` | Yes | The ethers provider |
| chainId | `number \| string` | Yes | The chain ID to switch to |

#### Returns

`Promise<boolean>` - Whether the switch was successful

#### Example

```javascript
const provider = await createBrowserProvider();

// Switch to Polygon (chain ID 137)
const success = await switchChain(provider, 137);

if (success) {
  console.log('Switched to Polygon');
} else {
  console.log('Failed to switch chain');
}

// Using hex format
await switchChain(provider, '0x89'); // Also switches to Polygon
```

## Common Patterns

### Complete Wallet Connection Flow

```javascript
import * as wallet from './blockchain/wallet.js';

async function connectWallet() {
  try {
    // Create browser provider
    const provider = await wallet.createBrowserProvider();
    
    // Request connection
    const accounts = await wallet.requestWalletConnection(provider);
    
    if (accounts.length === 0) {
      throw new Error('No accounts connected');
    }
    
    // Get current chain
    const chainId = await wallet.getChainId(provider);
    
    // Switch to desired chain if needed
    if (chainId !== 1) {
      await wallet.switchChain(provider, 1);
    }
    
    // Get signer for transactions
    const signer = await provider.getSigner();
    
    return { provider, signer, address: accounts[0] };
  } catch (error) {
    console.error('Wallet connection failed:', error);
    throw error;
  }
}
```

### Multi-Provider Support

```javascript
async function getProvider(config) {
  try {
    // Try browser wallet first
    return await wallet.createBrowserProvider();
  } catch (error) {
    // Fallback to RPC
    if (config.rpcUrl) {
      console.log('Using RPC provider as fallback');
      return wallet.createJsonRpcProvider(config.rpcUrl);
    }
    throw error;
  }
}
```

### Chain Detection and Switching

```javascript
async function ensureCorrectChain(provider, targetChainId) {
  const currentChainId = await wallet.getChainId(provider);
  
  if (currentChainId !== targetChainId) {
    console.log(`Switching from chain ${currentChainId} to ${targetChainId}`);
    
    const success = await wallet.switchChain(provider, targetChainId);
    
    if (!success) {
      throw new Error(`Failed to switch to chain ${targetChainId}`);
    }
  }
  
  return true;
}
```

## Error Handling

```javascript
async function safeWalletConnect() {
  try {
    const provider = await wallet.createProvider({
      rpcUrl: process.env.FALLBACK_RPC_URL
    });
    
    if (provider instanceof ethers.BrowserProvider) {
      // Browser wallet specific operations
      const accounts = await wallet.requestWalletConnection(provider);
      return { provider, accounts };
    } else {
      // RPC provider - no wallet connection needed
      return { provider, accounts: [] };
    }
  } catch (error) {
    if (error.message.includes('No Ethereum provider')) {
      console.error('Please install MetaMask');
    } else if (error.code === 4001) {
      console.error('User rejected connection');
    } else if (error.code === 4902) {
      console.error('Chain not added to wallet');
    } else {
      console.error('Unexpected error:', error);
    }
    throw error;
  }
}
```

## Best Practices

1. **Error Handling**: Always handle wallet connection rejections gracefully
2. **Chain Validation**: Verify the correct chain before transactions
3. **Provider Fallbacks**: Implement RPC fallbacks for better reliability
4. **User Experience**: Provide clear feedback during wallet operations
5. **Security**: Never store private keys; always use wallet providers

## See Also

- [`contracts`](./contracts.md) - Contract interaction utilities
- [ethers.js Documentation](https://docs.ethers.org/v6/)
- [EIP-1193: Ethereum Provider JavaScript API](https://eips.ethereum.org/EIPS/eip-1193)