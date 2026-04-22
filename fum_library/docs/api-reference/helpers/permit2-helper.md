<!-- Source: src/helpers/Permit2Helper.js -->
# Permit2Helper

Reusable functions for Permit2 signature generation and calldata wrapping.

Permit2 is a universal token approval standard adopted by:
- Uniswap (V3, V4 via Universal Router)
- 1inch
- CoW Protocol
- Balancer
- And others

## Import

```javascript
import {
  PERMIT2_ADDRESS,
  getPermit2Nonce,
  generatePermit2Signature,
  encodePermit2Input,
  wrapWithPermit2
} from 'fum_library/helpers';
```

---

## Constants

### PERMIT2_ADDRESS

Canonical Permit2 contract address - same on all EVM chains.

```javascript
const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
```

---

## Functions

### getPermit2Nonce

Get current nonce for a token/owner/spender combination from the Permit2 contract.

```javascript
const nonce = await getPermit2Nonce(provider, ownerAddress, tokenAddress, spenderAddress);
```

#### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `provider` | `ethers.Provider` | Ethers provider for reading contract state |
| `ownerAddress` | `string` | Address that owns the tokens (e.g., vault address) |
| `tokenAddress` | `string` | Token contract address |
| `spenderAddress` | `string` | Address that will spend tokens (e.g., Universal Router) |

#### Returns

`Promise<number>` - Current nonce value

#### Example

```javascript
const nonce = await getPermit2Nonce(
  provider,
  vaultAddress,
  WETH_ADDRESS,
  UNIVERSAL_ROUTER_ADDRESS
);
```

---

### generatePermit2Signature

Generate EIP-712 signature for PermitSingle.

```javascript
const { signature, permitData } = await generatePermit2Signature(
  signer,
  chainId,
  tokenAddress,
  amount,
  spenderAddress,
  nonce,
  deadline
);
```

#### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `signer` | `ethers.Wallet` | Wallet that will sign the permit (must be authorized by owner) |
| `chainId` | `number` | Chain ID |
| `tokenAddress` | `string` | Token contract address |
| `amount` | `string` | Amount to permit (wei string, must fit in uint160) |
| `spenderAddress` | `string` | Address that will spend tokens |
| `nonce` | `number` | Current nonce from `getPermit2Nonce()` |
| `deadline` | `number` | Unix timestamp when signature expires |

#### Returns

```javascript
{
  signature: string,   // EIP-712 signature
  permitData: {
    details: {
      token: string,
      amount: string,
      expiration: number,
      nonce: number
    },
    spender: string,
    sigDeadline: number
  }
}
```

#### Example

```javascript
const deadline = Math.floor(Date.now() / 1000) + 3600; // 1 hour
const nonce = await getPermit2Nonce(provider, vaultAddress, tokenAddress, routerAddress);

const { signature, permitData } = await generatePermit2Signature(
  signer,
  42161,  // Arbitrum
  tokenAddress,
  ethers.utils.parseEther('100').toString(),
  routerAddress,
  nonce,
  deadline
);
```

---

### encodePermit2Input

Encode PermitSingle + signature for Universal Router PERMIT2_PERMIT command.

```javascript
const permitInput = encodePermit2Input(permitData, signature);
```

#### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `permitData` | `Object` | Permit data from `generatePermit2Signature()` |
| `signature` | `string` | Signature from `generatePermit2Signature()` |

#### Returns

`string` - ABI-encoded permit input

---

### wrapWithPermit2

Wrap Universal Router calldata with PERMIT2_PERMIT command (0x0a).

This prepends the PERMIT2_PERMIT command to the existing command sequence, allowing the Universal Router to pull tokens via Permit2 before executing swaps.

```javascript
const wrappedCalldata = wrapWithPermit2(routerInterface, swapCalldata, permitData, signature);
```

#### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `routerInterface` | `ethers.Interface` | Universal Router interface for encoding |
| `swapCalldata` | `string` | Original swap calldata from AlphaRouter |
| `permitData` | `Object` | Permit data from `generatePermit2Signature()` |
| `signature` | `string` | Signature from `generatePermit2Signature()` |

#### Returns

`string` - Wrapped calldata with PERMIT2_PERMIT prepended

---

## Complete Example

```javascript
import { ethers } from 'ethers';
import {
  PERMIT2_ADDRESS,
  getPermit2Nonce,
  generatePermit2Signature,
  wrapWithPermit2
} from 'fum_library/helpers';

// Get current nonce
const nonce = await getPermit2Nonce(
  provider,
  vaultAddress,
  tokenInAddress,
  universalRouterAddress
);

// Generate signature
const deadline = Math.floor(Date.now() / 1000) + 3600;
const { signature, permitData } = await generatePermit2Signature(
  signer,
  chainId,
  tokenInAddress,
  amountIn,
  universalRouterAddress,
  nonce,
  deadline
);

// Wrap swap calldata with Permit2
const wrappedCalldata = wrapWithPermit2(
  routerInterface,
  swapCalldata,
  permitData,
  signature
);

// Execute transaction through the vault — PositionVault.execute(targets, data)
const tx = await vault.execute([universalRouterAddress], [wrappedCalldata]);
```

---

## Notes

- The Permit2 contract address is the same on all EVM chains
- Signatures are EIP-712 typed data signatures
- The signer must be authorized to sign on behalf of the token owner (e.g., vault executor)
- Amount must fit within uint160 (max ~1.46e48)
- Nonces are per-token, per-owner, per-spender combination
