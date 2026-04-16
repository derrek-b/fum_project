<!-- Source: src/services/blockExplorer.js -->
# Block Explorer Service API

Factory-based service for fetching internal transactions from chain-specific block explorers. Used by `UniswapV4Adapter` to track native ETH transfers within closure/collect receipts (V4 can use native ETH as `currency0`, so ETH flows don't always appear as ERC20 `Transfer` events).

## Overview

The service exposes a factory function that returns a chain-specific implementation (currently Arbiscan for Arbitrum chains; Alchemy for Ethereum/Polygon is reserved for future use). The factory abstracts away the HTTP API differences so callers get the same `{ getInternalTransactions, getEthTransfersForWallet }` interface regardless of the underlying explorer.

**Supported chains:**

| Chain ID | Explorer | Status |
|---|---|---|
| `42161` | Arbiscan (Etherscan V2 unified endpoint) | Implemented |
| `1337` | Arbiscan (queries mainnet data — fork uses same block history) | Implemented |
| `1` | Alchemy | Not yet implemented (throws) |
| `137` | Alchemy | Not yet implemented (throws) |

## Exports

```javascript
import {
  configureBlockExplorer,
  getBlockExplorerConfig,
  resetBlockExplorerConfig,
  getBlockExplorerService
} from 'fum_library/services/blockExplorer';
```

## Configuration

### configureBlockExplorer

Set API keys for block explorer providers. Called once at application startup (or via `initFumLibrary`).

```javascript
configureBlockExplorer({
  blockExplorerApiKey?: string,
  alchemyApiKey?: string
}): void
```

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `blockExplorerApiKey` | `string` | No | Etherscan V2 / Arbiscan API key. If omitted, the previous value is preserved. Without a key, requests still work but are heavily rate-limited. |
| `alchemyApiKey` | `string` | No | Reserved for future Alchemy-backed chains. |

#### Example
```javascript
import { configureBlockExplorer } from 'fum_library/services/blockExplorer';

configureBlockExplorer({
  blockExplorerApiKey: process.env.BLOCK_EXPLORER_API_KEY,
  alchemyApiKey: process.env.ALCHEMY_API_KEY
});
```

---

### getBlockExplorerConfig

Returns a copy of the current configuration. Testing utility.

```javascript
getBlockExplorerConfig(): {
  blockExplorerApiKey: string | null,
  alchemyApiKey: string | null
}
```

---

### resetBlockExplorerConfig

Resets configuration to defaults (both keys set to `null`). Testing utility.

```javascript
resetBlockExplorerConfig(): void
```

#### Example
```javascript
import { resetBlockExplorerConfig } from 'fum_library/services/blockExplorer';
beforeEach(() => resetBlockExplorerConfig());
```

---

## Factory

### getBlockExplorerService

Returns a chain-specific service object with two async methods.

```javascript
getBlockExplorerService(chainId: number): BlockExplorerService
```

#### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `chainId` | `number` | Yes | Chain ID |

#### Returns

A `BlockExplorerService` object:

```javascript
{
  getInternalTransactions(txHash: string): Promise<InternalTx[]>,
  getEthTransfersForWallet(txHash: string, walletAddress: string): Promise<{
    received: BigNumber,
    sent: BigNumber
  }>
}
```

#### Throws

| Error | Condition |
|-------|-----------|
| `chainId must be a finite number` | Invalid `chainId` |
| `No block explorer configured for chainId X` | Chain not in the mapping |
| `Alchemy block explorer not yet implemented for chainId X` | Reserved for Ethereum (1) and Polygon (137) — not implemented yet |

#### Example
```javascript
import { getBlockExplorerService } from 'fum_library/services/blockExplorer';

const explorer = getBlockExplorerService(42161);
```

---

## Service Methods (returned by factory)

### getInternalTransactions

Fetch internal transactions (message-call traces) for a given transaction hash.

```javascript
async getInternalTransactions(txHash: string): Promise<InternalTx[]>
```

#### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `txHash` | `string` | Yes | Transaction hash (0x-prefixed, 64 hex chars) |

#### Returns

`Promise<InternalTx[]>` — Array of internal transactions:

```javascript
[
  {
    blockNumber: "123456",
    timeStamp: "1234567890",
    hash: "0x...",
    from: "0x...",
    to: "0x...",
    value: "1000000000000000000",  // wei
    contractAddress: "",
    input: "",
    type: "call",
    gas: "...",
    gasUsed: "...",
    traceId: "0",
    isError: "0",
    errCode: ""
  }
]
```

Returns `[]` when the transaction has no internal transactions.

#### Throws

| Error | Condition |
|-------|-----------|
| `txHash is required and must be a string` | Missing or non-string txHash |
| `Invalid transaction hash format` | Fails the 0x + 64 hex chars regex |
| `Arbiscan API error: <status> <statusText>` | HTTP error from Arbiscan |
| `Arbiscan API error: <message>` | Application error from Arbiscan (e.g., rate limited) |

---

### getEthTransfersForWallet

Sum ETH received and sent by a specific wallet across all internal transactions in a given transaction. Used for V4 closure/collect parsing where native ETH flows into/out of the vault.

```javascript
async getEthTransfersForWallet(
  txHash: string,
  walletAddress: string
): Promise<{ received: BigNumber, sent: BigNumber }>
```

#### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `txHash` | `string` | Yes | Transaction hash |
| `walletAddress` | `string` | Yes | Wallet to filter for |

#### Returns

`Promise<{ received: BigNumber, sent: BigNumber }>` — Summed ETH amounts as `ethers.BigNumber`. Both values are in wei. Failed internal txs (`isError !== '0'`) and zero-value transfers are skipped.

#### Throws

| Error | Condition |
|-------|-----------|
| `walletAddress is required and must be a string` | Missing or non-string walletAddress |
| Any error from `getInternalTransactions` | Propagated from the underlying call |

#### Example

```javascript
import { configureBlockExplorer, getBlockExplorerService } from 'fum_library/services/blockExplorer';
import { ethers } from 'ethers';

configureBlockExplorer({ blockExplorerApiKey: process.env.BLOCK_EXPLORER_API_KEY });
const explorer = getBlockExplorerService(42161);

const { received, sent } = await explorer.getEthTransfersForWallet(
  '0xabc...def',  // closure tx hash
  vaultAddress
);

const netEth = received.sub(sent);
console.log(`Net ETH: ${ethers.utils.formatEther(netEth)}`);
```

---

## Implementation Notes

### Etherscan V2 Unified API

Both `42161` (Arbitrum One) and `1337` (Hardhat Arbitrum fork) route to the Etherscan V2 unified endpoint:

```
https://api.etherscan.io/v2/api?chainid=42161&module=account&action=txlistinternal&txhash={txHash}
```

The Hardhat fork shares Arbitrum's block history, so queries with the fork's `chainId = 1337` are mapped to `42161` before hitting the API. This means: the fork explorer only sees data from the fork's upstream block; transactions minted locally on the fork will not appear.

### Alchemy Backend (Future)

The factory reserves `'alchemy'` for `chainId` 1 (Ethereum) and 137 (Polygon). Calling `getBlockExplorerService(1)` today throws `Alchemy block explorer not yet implemented for chainId 1`. Implementation will use `alchemy-sdk`'s `getAssetTransfers` with `category: ['internal']`.

### Error Handling Philosophy

The service validates inputs strictly and throws on every failure path — no fallbacks to `null` or empty objects. Callers that need resilience should wrap calls in try/catch and decide whether to retry, skip, or abort based on the error message. This matches the rest of `fum_library` (fail-loud, don't mask errors).

## See Also

- [`theGraph`](./theGraph.md) — V4 pool discovery and position enumeration
- [`merkl`](./merkl.md) — V4 incentive campaigns
- [Adapters Architecture](../../architecture/adapters.md) — How V4 uses this service during receipt parsing
- [Etherscan V2 API Documentation](https://docs.etherscan.io/etherscan-v2)
