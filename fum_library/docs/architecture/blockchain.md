<!-- Source: src/blockchain/wallet.js, src/blockchain/contracts.js -->
# Blockchain Architecture

## Overview

The blockchain module provides provider creation and contract interaction utilities using **ethers.js v5**. Split into two files: `wallet.js` for provider/wallet management and `contracts.js` for vault contract operations.

```
src/blockchain/
├── index.js       # Re-exports wallet + contracts
├── wallet.js      # Provider creation, wallet connection, chain switching
└── contracts.js   # Contract instantiation, vault CRUD, transaction execution
```

## wallet.js

**Source:** `src/blockchain/wallet.js`

Provider creation and browser wallet management. Uses ethers v5 API (`ethers.providers.Web3Provider`, `ethers.providers.JsonRpcProvider`).

### Exported Functions

#### createWeb3Provider()

Creates an ethers Web3Provider from the browser's `window.ethereum` (MetaMask, etc.).

```javascript
const provider = await createWeb3Provider();
// Returns: ethers.providers.Web3Provider
```

Throws if `window.ethereum` is not available (no browser wallet detected).

#### createJsonRpcProvider(rpcUrl)

Creates a JsonRpcProvider for server-side or direct RPC access. Validates URL format and tests connectivity with 2 retries.

```javascript
const provider = await createJsonRpcProvider('https://arb-mainnet.g.alchemy.com/v2/KEY');
// Returns: ethers.providers.JsonRpcProvider
```

Throws if URL is invalid or connectivity test fails after retries.

#### getConnectedAccounts(provider)

Gets currently connected accounts from a provider via `provider.listAccounts()`.

```javascript
const accounts = await getConnectedAccounts(provider);
// Returns: ['0x...', ...]
```

#### requestWalletConnection(provider)

Triggers the wallet connection popup via `eth_requestAccounts`. Requires a browser (Web3) provider — throws for JsonRpcProvider.

```javascript
const accounts = await requestWalletConnection(provider);
```

#### getChainId(provider)

Gets the chain ID from the provider's network.

```javascript
const chainId = await getChainId(provider);
// Returns: 42161
```

#### switchChain(provider, chainId)

Switches the browser wallet to a different chain. If the chain isn't added to the wallet (error 4902), attempts to add it using chain config from `getChainConfig()`.

```javascript
const success = await switchChain(provider, 42161);
// Returns: true/false
```

Requires a browser provider. Returns `false` on failure instead of throwing.

---

## contracts.js

**Source:** `src/blockchain/contracts.js`

Contract interaction utilities centered around the vault system. Uses `contractData` from `artifacts/contracts.js` for ABIs and addresses. Uses ethers v5 API (`ethers.utils.getAddress`, `ethers.providers.Provider`, `ethers.Contract`).

### Exported Functions

#### getContract(contractName, provider)

Creates a read-only contract instance by looking up the ABI and address from `artifacts/contracts.js` for the provider's current network.

```javascript
const factory = await getContract('VaultFactory', provider);
```

Detects chain ID automatically from the provider. Throws if contract name unknown or no deployment exists for the chain.

#### getVaultFactory(provider)

Shorthand for `getContract('VaultFactory', provider)`.

#### getVaultFactoryAddress(chainId)

Synchronous lookup of the VaultFactory address for a chain. Returns `null` if not deployed.

```javascript
const addr = getVaultFactoryAddress(42161);
// Returns: '0x...' or null
```

#### createVault(name, signer)

Creates a new vault via VaultFactory. Sends a transaction, waits for receipt, and extracts the vault address from the `VaultCreated` event.

```javascript
const vaultAddress = await createVault('My Vault', signer);
```

#### getVaultContract(vaultAddress, provider)

Creates a PositionVault contract instance for a specific vault address. Synchronous (no network call).

```javascript
const vault = getVaultContract('0x...', provider);
const owner = await vault.owner();
```

#### getUserVaults(userAddress, provider)

Gets all vault addresses owned by a user via `VaultFactory.getVaults(userAddress)`.

```javascript
const vaults = await getUserVaults('0xUser...', provider);
// Returns: ['0xVault1...', '0xVault2...']
```

#### getVaultInfo(vaultAddress, provider)

Gets vault metadata from VaultFactory.

```javascript
const info = await getVaultInfo('0xVault...', provider);
// Returns: { owner, name, creationTime, creationBlock }
```

#### getAuthorizedVaults(executorAddress, provider)

Finds all vaults that have authorized a specific executor address. Iterates through all vaults in the factory and checks each vault's `executor()`.

```javascript
const vaults = await getAuthorizedVaults('0xExecutor...', provider);
// Returns: ['0xVault1...', '0xVault2...']
```

Note: This iterates all vaults — performance scales linearly with total vault count.

#### getContractInfoByAddress(address)

Reverse lookup: given a deployed contract address, find the contract name and chain ID.

```javascript
const info = getContractInfoByAddress('0xDeployed...');
// Returns: { contractName: 'VaultFactory', chainId: 42161 }
```

Throws if address not found in any contract deployment.

#### executeVaultTransactions(vaultAddress, transactions, signer)

Executes a batch of transactions through a vault's `execute(targets, data)` method. Execution is atomic — all succeed or all revert.

```javascript
const success = await executeVaultTransactions(
  vaultAddress,
  [
    { target: tokenAddress, data: '0x...' },
    { target: routerAddress, data: '0x...' }
  ],
  signer
);
// Returns: true
```

Each transaction must have `target` (address) and `data` (hex-encoded calldata). The function validates all inputs before sending.

This is the primary mechanism adapters use to execute on-chain operations through vaults — swap transactions, liquidity operations, approvals, etc. are all encoded as `{ target, data }` pairs and executed via this function.

---

## Key Design Points

- **ethers.js v5** throughout — `ethers.providers.Web3Provider` (not `BrowserProvider`), `ethers.utils.getAddress` (not `ethers.getAddress`), `ethers.Contract` with `provider` (not `runner`)
- **No private key storage** — the library creates contract instances and transaction data, but signing happens through the caller's signer
- **ABIs and addresses** from `artifacts/contracts.js` — auto-generated by `fum/scripts/extract-abis.js`, not manually maintained
- **Provider validation** uses `instanceof ethers.providers.Provider` checks throughout

## See Also

- [Architecture Overview](./overview.md) — Module structure and initialization
- [Adapters Architecture](./adapters.md) — How adapters use `executeVaultTransactions` for on-chain operations
