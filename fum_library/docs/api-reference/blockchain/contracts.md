# Contracts API

Utilities for interacting with FUM vault contracts and related infrastructure.

## Overview

The Contracts module provides helper functions for working with vault contracts, including the VaultFactory, PositionVault, and BatchExecutor contracts. It handles contract instantiation, address resolution, and common operations.

## Contract Instantiation

### getContract

Gets a contract instance using the appropriate address for the current network.

#### Signature
```javascript
getContract(contractName: string, provider: ethers.JsonRpcProvider, signer?: ethers.Signer): ethers.Contract
```

#### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| contractName | `string` | Yes | Name of the contract ("VaultFactory", "PositionVault", or "BatchExecutor") |
| provider | `ethers.JsonRpcProvider` | Yes | Ethers provider |
| signer | `ethers.Signer` | No | Optional signer for write operations |

#### Returns

`ethers.Contract` - The contract instance

#### Throws

| Error | Condition |
|-------|-----------|
| `Error` | Contract not found in contract data |
| `Error` | Provider network not available |
| `Error` | No deployment found for network |

#### Example

```javascript
import { getContract } from './blockchain/contracts.js';

// Read-only contract
const factory = getContract('VaultFactory', provider);

// Contract with signer for transactions
const factoryWithSigner = getContract('VaultFactory', provider, signer);
```

### getVaultContract

Creates a PositionVault contract instance for a specific vault address.

#### Signature
```javascript
getVaultContract(vaultAddress: string, provider: ethers.JsonRpcProvider, signer?: ethers.Signer): ethers.Contract
```

#### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| vaultAddress | `string` | Yes | Address of the vault |
| provider | `ethers.JsonRpcProvider` | Yes | Ethers provider |
| signer | `ethers.Signer` | No | Optional signer for write operations |

#### Returns

`ethers.Contract` - The vault contract instance

#### Example

```javascript
const vaultAddress = '0x1234...';
const vault = getVaultContract(vaultAddress, provider, signer);

// Read vault owner
const owner = await vault.owner();
```

### getVaultFactory

Gets the VaultFactory contract for the current network.

#### Signature
```javascript
getVaultFactory(provider: ethers.JsonRpcProvider, signer?: ethers.Signer): ethers.Contract
```

#### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| provider | `ethers.JsonRpcProvider` | Yes | Ethers provider |
| signer | `ethers.Signer` | No | Optional signer for write operations |

#### Returns

`ethers.Contract` - The VaultFactory contract instance

#### Example

```javascript
const factory = getVaultFactory(provider);
const userVaults = await factory.getVaults(userAddress);
```

### getBatchExecutor

Gets the BatchExecutor contract for the current network.

#### Signature
```javascript
getBatchExecutor(provider: ethers.JsonRpcProvider, signer?: ethers.Signer): ethers.Contract
```

#### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| provider | `ethers.JsonRpcProvider` | Yes | Ethers provider |
| signer | `ethers.Signer` | No | Optional signer for write operations |

#### Returns

`ethers.Contract` - The BatchExecutor contract instance

#### Example

```javascript
const batchExecutor = getBatchExecutor(provider, signer);
```

## Address Utilities

### getVaultFactoryAddress

Gets the address of the VaultFactory for a specific network.

#### Signature
```javascript
getVaultFactoryAddress(chainId: number | string): string | null
```

#### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| chainId | `number \| string` | Yes | Chain ID of the network |

#### Returns

`string | null` - Address of the VaultFactory or null if not deployed

#### Example

```javascript
const factoryAddress = getVaultFactoryAddress(1); // Mainnet
// "0x1234..."

const polygonFactory = getVaultFactoryAddress(137); // Polygon
// "0x5678..." or null if not deployed
```

### getBatchExecutorAddress

Gets the address of the BatchExecutor for a specific network.

#### Signature
```javascript
getBatchExecutorAddress(chainId: number | string): string | null
```

#### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| chainId | `number \| string` | Yes | Chain ID of the network |

#### Returns

`string | null` - Address of the BatchExecutor or null if not deployed

#### Example

```javascript
const batchAddress = getBatchExecutorAddress(1);
// "0xabcd..."
```

## Vault Operations

### createVault

Creates a new vault using the VaultFactory.

#### Signature
```javascript
async createVault(name: string, signer: ethers.Signer): Promise<string>
```

#### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| name | `string` | Yes | Name for the new vault |
| signer | `ethers.Signer` | Yes | Signer for the transaction |

#### Returns

`Promise<string>` - The address of the newly created vault

#### Throws

| Error | Condition |
|-------|-----------|
| `Error` | Failed to find VaultCreated event |

#### Example

```javascript
const vaultName = "My DeFi Vault";
const vaultAddress = await createVault(vaultName, signer);
console.log('Created vault at:', vaultAddress);
```

### getUserVaults

Gets all vaults owned by a user.

#### Signature
```javascript
async getUserVaults(userAddress: string, provider: ethers.JsonRpcProvider): Promise<string[]>
```

#### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| userAddress | `string` | Yes | Address of the user |
| provider | `ethers.JsonRpcProvider` | Yes | Ethers provider |

#### Returns

`Promise<string[]>` - Array of vault addresses

#### Example

```javascript
const vaults = await getUserVaults(userAddress, provider);
console.log(`User has ${vaults.length} vaults`);
```

### getVaultInfo

Gets information about a vault.

#### Signature
```javascript
async getVaultInfo(vaultAddress: string, provider: ethers.JsonRpcProvider): Promise<{owner: string, name: string, creationTime: number}>
```

#### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| vaultAddress | `string` | Yes | Address of the vault |
| provider | `ethers.JsonRpcProvider` | Yes | Ethers provider |

#### Returns

`Promise<Object>` - Vault information:

| Field | Type | Description |
|-------|------|-------------|
| owner | `string` | Vault owner address |
| name | `string` | Vault name |
| creationTime | `number` | Creation timestamp |

#### Example

```javascript
const info = await getVaultInfo(vaultAddress, provider);
console.log(`Vault "${info.name}" owned by ${info.owner}`);
```

## Transaction Execution

### executeVaultTransactions

Executes a batch of transactions through a vault.

#### Signature
```javascript
async executeVaultTransactions(vaultAddress: string, transactions: Array<{target: string, data: string}>, signer: ethers.Signer): Promise<boolean[]>
```

#### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| vaultAddress | `string` | Yes | Address of the vault |
| transactions | `Array<Object>` | Yes | Array of transactions to execute |
| transactions[].target | `string` | Yes | Target contract address |
| transactions[].data | `string` | Yes | Encoded transaction data |
| signer | `ethers.Signer` | Yes | Signer for the transaction |

#### Returns

`Promise<boolean[]>` - Array of success flags for each transaction

#### Example

```javascript
const transactions = [
  {
    target: tokenAddress,
    data: tokenContract.interface.encodeFunctionData('approve', [spender, amount])
  },
  {
    target: dexAddress,
    data: dexContract.interface.encodeFunctionData('swap', [...params])
  }
];

const results = await executeVaultTransactions(vaultAddress, transactions, signer);
console.log('Transaction results:', results); // [true, true]
```

### executeBatchTransactions

Executes a batch of transactions through the BatchExecutor.

#### Signature
```javascript
async executeBatchTransactions(transactions: Array<{to: string, data: string, value?: string}>, signer: ethers.Signer): Promise<{successes: boolean[], results: string[]}>
```

#### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| transactions | `Array<Object>` | Yes | Array of transactions to execute |
| transactions[].to | `string` | Yes | Target address |
| transactions[].data | `string` | Yes | Encoded transaction data |
| transactions[].value | `string` | No | ETH value to send |
| signer | `ethers.Signer` | Yes | Signer for the transaction |

#### Returns

`Promise<Object>` - Batch execution results:

| Field | Type | Description |
|-------|------|-------------|
| successes | `boolean[]` | Success flag for each transaction |
| results | `string[]` | Return data for each transaction |

#### Example

```javascript
const transactions = [
  {
    to: token1Address,
    data: encodeApproval(spender, amount1),
    value: '0'
  },
  {
    to: token2Address,
    data: encodeApproval(spender, amount2),
    value: '0'
  },
  {
    to: dexAddress,
    data: encodeSwap(params),
    value: ethers.parseEther('0.1') // Sending ETH
  }
];

const { successes, results } = await executeBatchTransactions(transactions, signer);

successes.forEach((success, i) => {
  console.log(`Transaction ${i}: ${success ? 'Success' : 'Failed'}`);
});
```

## Common Patterns

### Creating and Managing Vaults

```javascript
import * as contracts from './blockchain/contracts.js';

async function setupVault(signer) {
  // Create a new vault
  const vaultAddress = await contracts.createVault('My Trading Vault', signer);
  
  // Get vault info
  const info = await contracts.getVaultInfo(vaultAddress, signer.provider);
  console.log(`Created vault "${info.name}" at ${vaultAddress}`);
  
  // Get vault contract for direct interaction
  const vault = contracts.getVaultContract(vaultAddress, signer.provider, signer);
  
  return vault;
}
```

### Batch Operations

```javascript
async function performBatchOperations(vaultAddress, signer) {
  // Prepare multiple transactions
  const transactions = [];
  
  // Add token approval
  transactions.push({
    target: tokenAddress,
    data: tokenInterface.encodeFunctionData('approve', [
      positionManagerAddress,
      ethers.MaxUint256
    ])
  });
  
  // Add liquidity provision
  transactions.push({
    target: positionManagerAddress,
    data: positionManagerInterface.encodeFunctionData('mint', [mintParams])
  });
  
  // Execute through vault
  const results = await contracts.executeVaultTransactions(
    vaultAddress,
    transactions,
    signer
  );
  
  if (results.every(r => r)) {
    console.log('All transactions successful');
  }
}
```

### Multi-Chain Support

```javascript
async function getContractsForChain(chainId, provider, signer) {
  // Check if contracts are deployed on this chain
  const factoryAddress = contracts.getVaultFactoryAddress(chainId);
  const batchAddress = contracts.getBatchExecutorAddress(chainId);
  
  if (!factoryAddress || !batchAddress) {
    throw new Error(`Contracts not deployed on chain ${chainId}`);
  }
  
  // Get contract instances
  return {
    factory: contracts.getVaultFactory(provider, signer),
    batchExecutor: contracts.getBatchExecutor(provider, signer)
  };
}
```

## Error Handling

```javascript
async function safeCreateVault(name, signer) {
  try {
    const vaultAddress = await contracts.createVault(name, signer);
    return vaultAddress;
  } catch (error) {
    if (error.message.includes('Provider network not available')) {
      console.error('Wallet network connection issue - check provider');
    } else if (error.message.includes('No VaultFactory deployment')) {
      console.error('VaultFactory not deployed on this network');
    } else if (error.message.includes('VaultCreated event')) {
      console.error('Vault creation failed - check transaction');
    } else {
      console.error('Unexpected error:', error);
    }
    throw error;
  }
}
```

## Best Practices

1. **Signer Management**: Only provide signers when write operations are needed
2. **Event Parsing**: Always verify transaction success through events
3. **Gas Estimation**: Consider gas costs for batch operations
4. **Error Handling**: Implement proper error handling for contract calls
5. **Network Validation**: Verify contract deployment before operations

## See Also

- [`wallet`](./wallet.md) - Wallet and provider utilities
- [Vault Architecture](../../architecture/overview.md) - System architecture
- [ethers.js Contract Documentation](https://docs.ethers.org/v6/api/contract/)