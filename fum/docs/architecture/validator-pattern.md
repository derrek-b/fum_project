<!-- Source: contracts/validators/*, contracts/interfaces/ISwapValidator.sol, contracts/interfaces/ILiquidityValidator.sol, contracts/interfaces/IIncentiveValidator.sol -->
# Validator Pattern

Deep-dive into the calldata validation system that secures vault operations. Every swap, mint, and liquidity operation passes through a validator that parses raw calldata and enforces recipient restrictions before the vault executes the call.

## How Validators Are Invoked

```
User/Executor calls vault.swap(targets, data, values)
  │
  for each target[i]:
  │
  ├── vault calls factory.validateSwap(target, data[i], vaultAddress)
  │     │
  │     ├── factory looks up swapValidators[target]
  │     │     (reverts if no validator registered)
  │     │
  │     └── validator.validateSwap(data[i], vaultAddress)
  │           │
  │           ├── parse function selector from data[0:4]
  │           ├── extract recipient address from calldata
  │           ├── check recipient == vault (or allowed sentinel)
  │           └── revert with specific message if invalid
  │
  └── vault executes: target.call{value: values[i]}(data[i])
```

Same flow for liquidity operations (`mint`, `increaseLiquidity`, `decreaseLiquidity`, `collect`, `burn`) using `liquidityValidators[target]`, and for incentive operations (`incentive`) using `incentiveValidators[target]`.

---

## Three Validator Interfaces

**ISwapValidator** — Single method for swap routers:
```solidity
interface ISwapValidator {
    function validateSwap(bytes calldata data, address vault) external view;
}
```

**ILiquidityValidator** — Five methods for position managers:
```solidity
interface ILiquidityValidator {
    function validateMint(bytes calldata data, address vault) external view;
    function validateIncreaseLiquidity(bytes calldata data, address vault) external view;
    function validateDecreaseLiquidity(bytes calldata data, address vault) external view;
    function validateCollect(bytes calldata data, address vault) external view;
    function validateBurn(bytes calldata data, address vault) external view;
}
```

**IIncentiveValidator** — Single method for incentive reward contracts:
```solidity
interface IIncentiveValidator {
    function validateIncentive(bytes calldata data, address vault) external view;
}
```

**Why the split:** Swap routers, position managers, and incentive contracts are different targets with different validation needs. A DEX might have one router for swaps, a separate position manager for liquidity, and a separate distributor for incentive claims — each gets its own validator type registered independently in VaultFactory.

---

## Validator Inventory

| Validator | Interface | Target Contract | Complexity |
|---|---|---|---|
| UniversalRouterValidator | ISwapValidator | Uniswap UniversalRouter | High — nested command parsing, V4 sub-actions |
| TJSwapValidator | ISwapValidator | Trader Joe LBRouter | Low — selector + offset |
| UniswapV3PositionValidator | ILiquidityValidator | V3 NonfungiblePositionManager | Medium — multicall unwrapping, assembly |
| UniswapV4PositionValidator | ILiquidityValidator | V4 PositionManager | High — nested ABI decoding, 7 assembly ops |
| TJPositionValidator | ILiquidityValidator | TJPositionManager | Low — selector-only (createPosition also checks vault param) |
| MerklIncentiveValidator | IIncentiveValidator | Merkl Distributor | Low — selector + user check |

---

## UniversalRouterValidator

**Source:** `contracts/validators/UniversalRouterValidator.sol`
**Implements:** ISwapValidator

Parses `execute(bytes commands, bytes[] inputs, uint256 deadline)` — the Universal Router's single entry point. Each byte in `commands` identifies an operation; the corresponding `inputs[i]` contains ABI-encoded parameters.

**Sentinel address:** `ADDRESS_THIS = address(2)` (0x0000...0002) — Keeps tokens in the router between commands for multi-hop swaps. Safe because the router holds tokens only during execution.

### Allowed Commands

| Code | Name | Recipient Validation |
|---|---|---|
| `0x00` | V3_SWAP_EXACT_IN | recipient = vault OR ADDRESS_THIS |
| `0x01` | V3_SWAP_EXACT_OUT | recipient = vault OR ADDRESS_THIS |
| `0x04` | SWEEP | recipient = vault (strict) |
| `0x08` | V2_SWAP_EXACT_IN | recipient = vault OR ADDRESS_THIS |
| `0x09` | V2_SWAP_EXACT_OUT | recipient = vault OR ADDRESS_THIS |
| `0x0a` | PERMIT2_PERMIT | Allowed (no recipient) |
| `0x0b` | WRAP_ETH | recipient = vault OR ADDRESS_THIS |
| `0x0c` | UNWRAP_WETH | recipient = vault (strict) |
| `0x10` | V4_SWAP | Nested action parsing (see below) |

Any command not in this table causes a revert.

### V4_SWAP Nested Actions

When command `0x10` (V4_SWAP) is encountered, the validator decodes `(bytes actions, bytes[] params)` from the input and validates each action:

| Action | Name | Recipient | Offset in params |
|---|---|---|---|
| `0x0e` | TAKE | vault OR ADDRESS_THIS | 0x20 (32 bytes) |
| `0x0f` | TAKE_ALL | Safe (uses msgSender = vault) | — |
| `0x10` | TAKE_PORTION | vault OR ADDRESS_THIS | 0x20 |
| `0x11` | TAKE_PAIR | vault OR ADDRESS_THIS | 0x40 (64 bytes) |
| `0x14` | SWEEP | vault (strict) | 0x20 |

### Multi-Hop Pattern

```
Command sequence: V3_SWAP(recipient=ADDRESS_THIS) → SWEEP(recipient=vault)
```
First swap sends tokens to the router (ADDRESS_THIS), then SWEEP collects all remaining tokens to the vault. SWEEP and UNWRAP_WETH always require the vault as strict recipient — no sentinel allowed.

---

## TJSwapValidator

**Source:** `contracts/validators/TJSwapValidator.sol`
**Implements:** ISwapValidator

Validates 6 LBRouter swap functions organized into two offset groups based on the `to` parameter position.

### 5-Param Group — `to` at byte 100

Signature pattern: `swap*(uint256, uint256, Path, address to, uint256)`
- `to` is the 4th parameter: offset = 4 (selector) + 3 × 32 = **100**

| Selector | Function |
|---|---|
| `0x53b13d6d` | `swapExactTokensForTokens` |
| `0x57ea03ba` | `swapExactTokensForNATIVE` |
| `0x67bfb98a` | `swapTokensForExactTokens` |
| `0xe4a26194` | `swapTokensForExactNATIVE` |

### 4-Param Group — `to` at byte 68

Signature pattern: `swap*(uint256, Path, address to, uint256)`
- `to` is the 3rd parameter: offset = 4 (selector) + 2 × 32 = **68**

| Selector | Function |
|---|---|
| `0x414bf569` | `swapExactNATIVEForTokens` |
| `0xaa18af95` | `swapNATIVEForExactTokens` |

**Parsing:** Extract selector from `data[0:4]`, determine offset group, decode `data[offset:offset+32]` as address, require address == vault.

---

## UniswapV3PositionValidator

**Source:** `contracts/validators/UniswapV3PositionValidator.sol`
**Implements:** ILiquidityValidator

### Selectors

| Function | Selector | Validation Method |
|---|---|---|
| `mint` | `0x88316456` | `validateMint` |
| `increaseLiquidity` | `0x219f5d17` | `validateIncreaseLiquidity` |
| `decreaseLiquidity` | `0x0c49ccbe` | via `validateDecreaseLiquidity` (multicall) |
| `collect` | `0xfc6f7865` | `validateCollect` |
| `burn` | `0x42966c68` | `validateBurn` |
| `multicall` | `0xac9650d8` | `validateDecreaseLiquidity` (entry point) |

### validateMint

MintParams struct has 11 fields: `token0, token1, fee, tickLower, tickUpper, amount0Desired, amount1Desired, amount0Min, amount1Min, recipient, deadline`

- `recipient` is the 10th parameter (index 9)
- **Offset: 292** = 4 (selector) + 9 × 32
- Extract: `abi.decode(data[292:324], (address))`
- Require: recipient == vault

### validateIncreaseLiquidity

- Checks selector = `0x219f5d17`
- **No recipient validation** — tokens go to an existing position identified by tokenId

### validateDecreaseLiquidity

Entry point requires multicall selector (`0xac9650d8`). Unwraps inner calls:

```solidity
bytes[] memory calls = abi.decode(data[4:], (bytes[]));
for each inner call:
  selector = assembly { mload(add(innerCall, 32)) }  // first 4 bytes
  if selector == DECREASE_LIQUIDITY: allowed, continue
  if selector == COLLECT: validate recipient
  if selector == BURN: allowed, continue (no recipient — removes empty NFT)
```

**Collect recipient in multicall context:**
CollectParams struct: `tokenId, recipient, amount0Max, amount1Max`
- Assembly reads at memory offset 68: `mload(add(innerCall, 68))` where 68 = 32 (memory length word) + 4 (selector) + 32 (tokenId)
- Require: recipient == vault

### validateCollect

CollectParams: `tokenId, recipient, amount0Max, amount1Max`
- `recipient` is the 2nd parameter (index 1)
- **Offset: 36** = 4 (selector) + 1 × 32
- Extract: `abi.decode(data[36:68], (address))`
- Require: recipient == vault

### validateBurn

- Checks selector = `0x42966c68`
- **No recipient validation** — just removes an empty NFT

---

## UniswapV4PositionValidator

**Source:** `contracts/validators/UniswapV4PositionValidator.sol`
**Implements:** ILiquidityValidator

All V4 position operations go through a single entry point: `modifyLiquidities(bytes unlockData, uint256 deadline)` (selector `0xdd46508f`). The unlockData contains packed arrays of actions and their parameters.

**Sentinel address:** `MSG_SENDER = address(1)` (0x0000...0001) — Resolves to msg.sender at execution time (which is the vault).

### Action Codes

| Code | Name | Validated Field | Offset | Recipient Rule |
|---|---|---|---|---|
| `0x00` | INCREASE_LIQUIDITY | — | — | No recipient |
| `0x01` | DECREASE_LIQUIDITY | — | — | No recipient |
| `0x02` | MINT_POSITION | owner | **0x140** (320) | Must be vault |
| `0x03` | BURN_POSITION | — | — | No recipient |
| `0x05` | MINT_POSITION_FROM_DELTAS | owner | **0x120** (288) | Must be vault |
| `0x0b` | SETTLE | — | — | Internal |
| `0x0d` | SETTLE_PAIR | — | — | Internal |
| `0x0e` | TAKE | recipient | **0x20** (32) | Must be vault |
| `0x10` | TAKE_PORTION | recipient | **0x20** (32) | Must be vault |
| `0x11` | TAKE_PAIR | recipient | **0x40** (64) | Vault OR MSG_SENDER |
| `0x14` | SWEEP | to | **0x20** (32) | Must be vault |

### MINT_POSITION Offset Calculation

Params: `PoolKey(5×32=160), tickLower(32), tickUpper(32), liquidity(32), amount0Max(32), amount1Max(32), owner(32), hookData`
- owner offset = 160 + 32 + 32 + 32 + 32 + 32 = **320 = 0x140**

### MINT_POSITION_FROM_DELTAS Offset Calculation

Params: `PoolKey(5×32=160), tickLower(32), tickUpper(32), amount0Max(32), amount1Max(32), owner(32), hookData`
- owner offset = 160 + 32 + 32 + 32 + 32 = **288 = 0x120**
- (Same as MINT_POSITION minus the `liquidity` field)

### _decodeUnlockData Calldata Layout

The most complex parsing in the system — 7 assembly `calldataload` operations to navigate nested ABI encoding:

```
Calldata layout for modifyLiquidities(bytes unlockData, uint256 deadline):

[0x00-0x04]  selector (0xdd46508f)
[0x04-0x24]  offset to unlockData (typically 0x40)
[0x24-0x44]  deadline (uint256)
[0x44-0x64]  unlockData.length
[0x64+]      unlockData content:
               [+0x00]  offset to actions (bytes)
               [+0x20]  offset to params (bytes[])
               [+actionsOffset]      actions.length
               [+actionsOffset+0x20] packed action bytes (1 byte each)
               [+paramsOffset]       params.length
               [+paramsOffset+0x20]  offsets to each param[i]
               [+param[i]Offset]     param[i].length
               [+param[i]Offset+20]  param[i] data
```

**_extractAddress helper:**
```solidity
function _extractAddress(bytes memory data, uint256 offset) internal pure returns (address addr) {
    assembly {
        addr := mload(add(add(data, 32), offset))
    }
}
```
Adds 32 (Solidity memory length word) + offset to get absolute memory position.

### Per-Operation Validation

- **validateMint:** Finds MINT_POSITION or MINT_POSITION_FROM_DELTAS action, validates owner field
- **validateIncreaseLiquidity:** Finds INCREASE_LIQUIDITY action, no recipient validation
- **validateDecreaseLiquidity:** Validates all TAKE/TAKE_PORTION/TAKE_PAIR/SWEEP recipients
- **validateCollect:** Same logic as decreaseLiquidity (V4 collects fees via DECREASE with 0 liquidity + TAKE_PAIR)
- **validateBurn:** Finds BURN_POSITION action, no recipient validation

---

## TJPositionValidator

**Source:** `contracts/validators/TJPositionValidator.sol`
**Implements:** ILiquidityValidator

Two-tier validation: `createPosition` gets a vault param check (no existing position to look up), while the other 4 operations use selector-only validation since TJPositionManager enforces `pos.vault == msg.sender` internally.

### Selectors

| Operation | Function Validated | Validation |
|---|---|---|
| `validateMint` | `createPosition(address,address,uint256,...,uint256)` | Selector + vault param check (`data[4:36]`) |
| `validateIncreaseLiquidity` | `addToPosition(uint256,uint256[],...,uint256)` | Selector only |
| `validateDecreaseLiquidity` | `removePosition(uint256,uint256[],...,uint256)` OR `decreaseLiquidity(uint256,uint256,...,uint256)` | Selector only (both accepted) |
| `validateCollect` | `collectFees(uint256,uint256[],...,uint256)` | Selector only |
| `validateBurn` | — | Reverts "not yet implemented" |

**createPosition** (the only function with a vault param):
```solidity
address calldataVault = abi.decode(data[4:36], (address));
require(calldataVault == vault, "TJPositionValidator: vault mismatch");
```

**All other operations** (selector-only):
```solidity
require(data.length >= 4, "TJPositionValidator: invalid data");
bytes4 selector = bytes4(data[:4]);
require(selector == EXPECTED_SELECTOR, "TJPositionValidator: not <functionName>");
```

Why selector-only is secure for existing positions: TJPositionManager stores `pos.vault` at creation and enforces `require(pos.vault == msg.sender)` on every operation. Since `msg.sender` is unforgeable and `pos.vault` is trusted on-chain state, there's no calldata the executor could craft to operate on another vault's position.

---

## MerklIncentiveValidator

**Source:** `contracts/validators/MerklIncentiveValidator.sol`
**Implements:** IIncentiveValidator

Validates calls to the Merkl Distributor's `claim(address user, address[] tokens, uint256[] amounts, bytes32[][] proofs)` function.

### Validation

| Check | Detail |
|---|---|
| Selector | Must be `0xa0165082` (`claim`) |
| User | First parameter (`data[4:36]`) must equal the vault address |

**Why both checks:** The selector ensures only `claim()` can be called (not arbitrary functions on the Distributor). The user check ensures rewards are claimed to the vault, not to an attacker address.

See [docs/decisions/incentive-validator-design.md](../../../docs/decisions/incentive-validator-design.md) for the design rationale behind creating a separate validator interface for incentives.

---

## Calldata Parsing Techniques

### 1. abi.decode on Slices (most common)

```solidity
address recipient = abi.decode(data[offset:offset+32], (address));
```
Used by: TJSwapValidator, TJPositionValidator, UniswapV3PositionValidator (mint, collect)

### 2. Assembly mload for Memory Bytes

```solidity
bytes memory innerCall = calls[i];
bytes4 selector;
assembly { selector := mload(add(innerCall, 32)) }
```
Used by: UniswapV3PositionValidator (multicall unwrapping). The `32` accounts for Solidity's memory layout where `bytes` starts with a length word.

### 3. Assembly calldataload for Raw Calldata

```solidity
uint256 value;
assembly { value := calldataload(add(data.offset, position)) }
```
Used by: UniswapV4PositionValidator (_decodeUnlockData). Direct calldata access is cheaper than copying to memory for complex nested structures.

### 4. _extractAddress Helper

```solidity
function _extractAddress(bytes memory data, uint256 offset) internal pure returns (address addr) {
    assembly { addr := mload(add(add(data, 32), offset)) }
}
```
Used by: UniswapV4PositionValidator. Extracts addresses from already-decoded params arrays (memory bytes, not calldata).

### Key Offset Reference

| Context | What | Offset | Calculation |
|---|---|---|---|
| V3 MintParams.recipient | 10th of 11 fields | 292 | 4 + 9×32 |
| V3 CollectParams.recipient | 2nd of 4 fields | 36 | 4 + 1×32 |
| V4 MINT_POSITION.owner | After PoolKey(5)+4 fields | 0x140 (320) | 5×32 + 5×32 |
| V4 MINT_FROM_DELTAS.owner | After PoolKey(5)+3 fields | 0x120 (288) | 5×32 + 4×32 |
| V4 TAKE.recipient | 2nd of 3 fields | 0x20 (32) | 1×32 |
| V4 TAKE_PAIR.recipient | 3rd of 3 fields | 0x40 (64) | 2×32 |
| TJ 5-param swap.to | 4th of 5 params | 100 | 4 + 3×32 |
| TJ 4-param swap.to | 3rd of 4 params | 68 | 4 + 2×32 |
| TJ all position ops.vault | 1st param | 4 | 4 + 0×32 |

---

## Security Invariants

What the validator system guarantees:

1. **Recipient restriction** — Tokens from swaps, fee collection, and position exits can only be sent to the vault itself (or sentinel addresses that resolve to the vault/router)
2. **Selector whitelisting** — Only known function selectors are allowed. Unknown selectors revert. Approve only allows ERC20.approve and Permit2.permit selectors
3. **Sentinel addresses** — ADDRESS_THIS (0x2) only used mid-execution in Universal Router for multi-hop. MSG_SENDER (0x1) resolves to vault at V4 execution. SWEEP/UNWRAP always require vault as strict recipient
4. **Executor limitations** — Even with a compromised executor key, the attacker cannot extract tokens because all operations route tokens back to the vault. The `execute()` function (raw calls, no validation) is owner-only
5. **Factory-mediated dispatch** — Validators are registered centrally in VaultFactory. A vault cannot bypass validation or use unregistered validators
6. **No validator = no execution** — If no validator is registered for a target contract, the factory reverts. New platforms cannot be used until validators are deployed and registered

---

## Adding a New Validator

1. **Determine interface** — Is the target a swap router (ISwapValidator) or position manager (ILiquidityValidator)?
2. **Study calldata format** — Use the target contract's ABI to understand function signatures and parameter ordering. Identify which parameters contain recipient/owner addresses
3. **Implement validator** — For each function:
   - Extract the function selector from `data[0:4]`
   - Calculate byte offset to the recipient field: `4 + (paramIndex × 32)` for simple cases
   - Decode and validate the address
4. **Handle batch/nested patterns** — If the target uses multicall, batch operations, or nested encoding (like Universal Router commands or V4 actions), parse the outer structure first, then validate each inner operation
5. **Choose parsing technique** — Use `abi.decode` for simple cases, assembly for performance-critical or deeply nested structures
6. **Deploy and register** — Deploy the validator, then call `factory.setSwapValidator` or `factory.setLiquidityValidator` with the target contract address as key
7. **Test checklist:**
   - Valid operations with vault as recipient pass
   - Operations with non-vault recipient revert
   - Unknown selectors revert
   - Edge cases: empty data, truncated data, batch operations with mixed valid/invalid

---

## See Also

- [Contract System](./contract-system.md) — How validators fit into the factory-vault architecture
- `contracts/interfaces/ISwapValidator.sol` — Interface source
- `contracts/interfaces/ILiquidityValidator.sol` — Interface source
