<!-- Source: src/blockchain/contracts.js -->
# Contracts API

Utilities for interacting with FUM vault contracts and related infrastructure. Uses ethers.js v5 throughout.

## Overview

The Contracts module provides helper functions for working with the vault system: the `VaultFactory`, individual `PositionVault` instances, and strategy contracts deployed under the factory. It handles contract instantiation (with ABIs and chain-specific addresses from `src/artifacts/contracts.js`), address resolution, common vault operations, and atomic batch transaction execution.

## Exports

```javascript
import {
  getContract,
  getVaultFactory,
  getVaultFactoryAddress,
  createVault,
  getVaultContract,
  getUserVaults,
  getActiveVaults,
  getVaultInfo,
  getVaultExecutorIndex,
  getContractInfoByAddress,
  executeVaultTransactions,
} from 'fum_library/blockchain/contracts';
```

---

## Contract Instantiation

### getContract

Creates a read-only contract instance for the provider's current network. Detects chain ID automatically from the provider.

```javascript
async getContract(
  contractName: string,
  provider: ethers.providers.Provider
): Promise<ethers.Contract>
```

| Name | Type | Description |
|------|------|-------------|
| `contractName` | `string` | Name of the contract (e.g., `'VaultFactory'`, `'PositionVault'`, `'bob'`) |
| `provider` | `ethers.providers.Provider` | Ethers v5 provider |

**Throws:**
- `Contract name must be a valid string.` — missing/wrong type
- `Invalid provider. Must be an ethers provider instance.` — not a `Provider`
- `Provider network not available. ...` — `provider.getNetwork()` failed
- `Contract <name> not found in contract data` — unknown contract name
- `No <name> deployment found for network <chainId>` — contract exists but not deployed on this chain

Returned contract is read-only. Connect a signer for write operations:

```javascript
const factory = await getContract('VaultFactory', provider);
const factoryWithSigner = factory.connect(signer);
await factoryWithSigner.createVault('My Vault');
```

---

### getVaultFactory

Shorthand for `getContract('VaultFactory', provider)`.

```javascript
async getVaultFactory(provider: ethers.providers.Provider): Promise<ethers.Contract>
```

---

### getVaultContract

Creates a `PositionVault` contract instance for a specific vault address. Synchronous — no network call (uses the provider for later read/write operations, not for address resolution).

```javascript
getVaultContract(
  vaultAddress: string,
  provider: ethers.providers.Provider
): ethers.Contract
```

**Throws** if `vaultAddress` is missing/invalid, provider is not an ethers provider, or the bundled `PositionVault` ABI is missing.

```javascript
const vault = getVaultContract('0xVault...', provider);
const owner = await vault.owner();

// Connect a signer for writes
const vaultWithSigner = vault.connect(signer);
```

---

## Address Utilities

### getVaultFactoryAddress

Synchronous lookup of the `VaultFactory` deployment address for a chain.

```javascript
getVaultFactoryAddress(chainId: number): string | null
```

Returns `null` if the factory is not deployed on the given chain.

**Throws** `chainId must be a number` if `chainId` is not a number.

```javascript
const factoryAddress = getVaultFactoryAddress(42161);
// "0x..." or null
```

---

### getContractInfoByAddress

Reverse lookup: given a deployed contract address, return the contract name and chain ID.

```javascript
getContractInfoByAddress(address: string): {
  contractName: string,
  chainId: number
}
```

Address comparison is case-insensitive.

**Throws** if the address is missing, not a valid Ethereum address, or not found in any deployment.

---

## Vault Operations

### createVault

Creates a new vault via `VaultFactory.createVault(name)`. Sends a transaction, waits for the receipt, and extracts the new vault's address from the `VaultCreated` event.

```javascript
async createVault(
  name: string,
  signer: ethers.Signer
): Promise<string>
```

**Throws:**
- `Name must be a string` / `Vault name cannot be empty`
- `Invalid signer. ...`
- `Failed to create vault: <reason>` for on-chain reverts
- `Transaction failed: ...` / `Network error while creating vault: ...`
- `Failed to find VaultCreated event in transaction receipt` — unexpected receipt shape

---

### getUserVaults

All vault addresses owned by a user, via `VaultFactory.getVaults(user)`.

```javascript
async getUserVaults(
  userAddress: string,
  provider: ethers.providers.Provider
): Promise<string[]>
```

**Throws** if `userAddress` is missing/invalid or the factory call fails.

---

### getActiveVaults

All vaults currently with an executor set (automation enabled), via `VaultFactory.getActiveVaults()`.

```javascript
async getActiveVaults(provider: ethers.providers.Provider): Promise<string[]>
```

The factory maintains the index — this is O(1) on the client.

**Throws** if the factory call fails.

---

### getVaultInfo

Reads metadata from `VaultFactory.getVaultInfo(vault)`.

```javascript
async getVaultInfo(
  vaultAddress: string,
  provider: ethers.providers.Provider
): Promise<{
  owner: string,
  name: string,
  creationTime: number,
  creationBlock: number,
  executorIndex: number
}>
```

`creationTime`, `creationBlock`, and `executorIndex` are returned as plain numbers (converted from on-chain `uint256`).

**Throws** if `vaultAddress` is invalid or the factory call fails.

---

### getVaultExecutorIndex

Convenience accessor — reads only the `executorIndex` field.

```javascript
async getVaultExecutorIndex(
  vaultAddress: string,
  provider: ethers.providers.Provider
): Promise<number>
```

---

## Transaction Execution

### executeVaultTransactions

Executes a batch of transactions through a vault's `execute(targets, data)` method. **Atomic** — all transactions succeed together, or the whole call reverts. The return value is a single boolean (`true` if the vault accepted the batch).

```javascript
async executeVaultTransactions(
  vaultAddress: string,
  transactions: Array<{ target: string, data: string }>,
  signer: ethers.Signer
): Promise<boolean>
```

| Field | Type | Description |
|---|---|---|
| `transactions[].target` | `string` | Target contract address |
| `transactions[].data` | `string` | Hex-encoded calldata (must start with `0x`) |

**Throws:**
- `Vault address parameter is required` / `Invalid vault address: ...`
- `Transactions must be an array` / `Transactions array cannot be empty`
- `Transaction at index N is missing target address` / `... missing data`
- `Invalid target address at index N: ...`
- `Transaction data at index N must be a string` / `... must be hex encoded (start with 0x)`
- `Invalid signer. ...`
- `Failed to execute vault transactions: <underlying>`

This is the primary on-chain path adapters use for swaps, liquidity operations, and approvals — each `{ to, data, value }` transaction returned by an adapter's `generate*` method is executed through the vault via this function (adapters map `to` → `target`, and `value` is handled by the vault's native-ETH wrapping logic).

---

## Common Patterns

### Creating and Managing a Vault

```javascript
import {
  createVault,
  getVaultInfo,
  getVaultContract
} from 'fum_library/blockchain/contracts';

async function setupVault(signer) {
  const vaultAddress = await createVault('My Trading Vault', signer);
  const info = await getVaultInfo(vaultAddress, signer.provider);
  console.log(`Created vault "${info.name}" at ${vaultAddress}`);

  return getVaultContract(vaultAddress, signer.provider);
}
```

### Multi-Chain Deployment Check

```javascript
import { getVaultFactoryAddress } from 'fum_library/blockchain/contracts';

function isFactoryDeployed(chainId) {
  return getVaultFactoryAddress(chainId) !== null;
}
```

## Error Handling

```javascript
try {
  const vaultAddress = await createVault('My Vault', signer);
} catch (error) {
  if (error.message.includes('Provider network not available')) {
    // Wallet network issue
  } else if (error.message.includes('No VaultFactory deployment')) {
    // Factory not deployed on this chain
  } else if (error.message.includes('VaultCreated event')) {
    // Vault creation succeeded but event parsing failed
  } else {
    // Unexpected error
  }
  throw error;
}
```

## See Also

- [`wallet`](./wallet.md) — Provider and wallet utilities
- [Blockchain Architecture](../../architecture/blockchain.md) — Module overview
- [ethers.js v5 Contract Docs](https://docs.ethers.org/v5/api/contract/)
