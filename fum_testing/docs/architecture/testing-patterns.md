<!-- Source: contracts/Mock*.sol, test/unit/*.test.js, hardhat.config.js -->
# Testing Patterns

Mock contract APIs, deployment sequences, calldata encoding helpers, and testing gotchas for the fum_testing Hardhat environment. Reference this before writing new tests or debugging test failures.

## Mock Contracts

Eight mock contracts simulate external protocols. All live in `contracts/` alongside the real contracts (not in a subdirectory).

### MockERC20

**Simulates:** Standard ERC20 token with owner-controlled minting.

```solidity
constructor(string name, string symbol, uint8 decimals_)
```

| Function | Access | Notes |
|---|---|---|
| `mint(address to, uint256 amount)` | onlyOwner | Test helper for funding accounts |
| `burn(uint256 amount)` | public | Burns caller's tokens |
| `decimals()` | view | Returns custom `_decimals` value |

Plus standard ERC20: `balanceOf`, `transfer`, `approve`, `transferFrom`, `allowance`.

### MockWETH

**Simulates:** WETH contract with ETH wrapping.

```solidity
constructor()  // "Wrapped Ether" / "WETH", 18 decimals
```

| Function | Notes |
|---|---|
| `deposit()` | payable — mints WETH equal to msg.value |
| `withdraw(uint256 wad)` | Burns WETH, returns ETH |
| `receive()` | Fallback — accepts ETH, mints WETH |

Extends MockERC20 so inherits `mint`, `burn`, and all ERC20 functions.

### MockPositionNFT

**Simulates:** Uniswap V3 Position NFTs (ERC721). Used for testing vault NFT transfer/holding.

```solidity
constructor(address initialOwner)
```

| Function | Notes |
|---|---|
| `createPosition(address to, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity)` | Returns `uint256 tokenId` |
| `updateLiquidity(uint256 tokenId, uint128 newLiquidity)` | Test helper |

**State:** `positions` mapping (tokenId → PositionInfo struct), `_nextTokenId` counter starting at 1. Plus standard ERC721 (`ownerOf`, `balanceOf`, `safeTransferFrom`).

### MockNonfungiblePositionManager

**Simulates:** Uniswap V3 NonfungiblePositionManager (full position lifecycle).

```solidity
constructor()  // Sets default return values
```

**Configuration (test setup):**

| Function | Controls |
|---|---|
| `setShouldFail(bool)` | Makes all operations revert |
| `setReturnValues(uint128 liquidity, uint256 amount0, uint256 amount1)` | Configures return values |
| `setReturnTokenId(uint256 tokenId)` | Configures token ID returned by mint |

**Core operations:**

| Function | Params Struct | Returns |
|---|---|---|
| `mint(MintParams)` | `{token0, token1, fee, tickLower, tickUpper, amount0Desired, amount1Desired, amount0Min, amount1Min, recipient, deadline}` | `(tokenId, liquidity, amount0, amount1)` |
| `increaseLiquidity(IncreaseLiquidityParams)` | `{tokenId, amount0Desired, amount1Desired, amount0Min, amount1Min, deadline}` | `(liquidity, amount0, amount1)` |
| `decreaseLiquidity(DecreaseLiquidityParams)` | `{tokenId, liquidity, amount0Min, amount1Min, deadline}` | `(amount0, amount1)` |
| `collect(CollectParams)` | `{tokenId, recipient, amount0Max, amount1Max}` | `(amount0, amount1)` |
| `burn(uint256 tokenId)` | — | — |
| `multicall(bytes[] data)` | — | `bytes[] results` |

**Call tracking:** Every operation captures params in public state variables (`lastToken0`, `lastMintRecipient`, `lastTokenId`, etc.) and emits events (`MintCalled`, `IncreaseLiquidityCalled`, `DecreaseLiquidityCalled`, `CollectCalled`).

### MockUniversalRouter

**Simulates:** Uniswap Universal Router swap execution.

```solidity
constructor()
```

**Configuration:**

| Function | Controls |
|---|---|
| `setSwapOutput(address token, uint256 amount)` | Token and amount sent to recipient |
| `setShouldFail(bool)` | Makes execute revert |

**Core operation:**

```solidity
execute(bytes commands, bytes[] inputs, uint256 deadline)
```

Decodes second input element as `(address recipient, uint256 amountIn, uint256 amountOutMin, bytes path, bool payerIsUser)`, transfers `outputToken`/`outputAmount` to recipient.

**Call tracking:** `lastCommands`, `lastInputs`, `lastSwapRecipient`, `lastAmountIn`, `lastAmountOutMin`, `lastPath`. Events: `ExecuteCalled`, `SwapDecoded`.

### MockLBPair

**Simulates:** Trader Joe V2.2 LB Pair (ERC1155-style bin positions).

```solidity
constructor(address tokenX_, address tokenY_, uint16 binStep_)
```

| Function | Notes |
|---|---|
| `getTokenX()` / `getTokenY()` / `getBinStep()` | Pair metadata |
| `balanceOf(address, uint256 id)` | ERC1155-style per-bin balance |
| `balanceOfBatch(address[], uint256[] ids)` | Batch balance query |
| `approveForAll(address spender, bool)` | V2.1 naming (not `setApprovalForAll`) |
| `isApprovedForAll(address, address)` | Check operator approval |
| `getBin(uint24 id)` | Returns `(reserveX, reserveY)` |
| `totalSupply(uint256 id)` | Per-bin total supply |

**Test helpers:** `setBalance(address, id, amount)`, `setBinReserves(id, reserveX, reserveY)`, `setTotalSupply(id, supply)`.

### MockLBRouter

**Simulates:** Trader Joe V2.2 LB Router (liquidity add/remove).

```solidity
constructor()  // Default: 3 bins, 1 ETH + 1000 USDC added
```

**Configuration:**

| Function | Controls |
|---|---|
| `setShouldFail(bool)` | Makes `addLiquidity` revert |
| `setShouldFailRemove(bool)` | Makes `removeLiquidity` revert |
| `setReturnValues(amountXAdded, amountYAdded, amountXLeft, amountYLeft, depositIds[], liquidityMinted[])` | Full add return values |
| `setRemoveReturnValues(amountX, amountY)` | First remove call returns |
| `setRemoveReturnValues2(amountX, amountY)` | Second remove call returns (for fee + principal) |
| `resetRemoveCallCount()` | Reset sequential call counter |

**Core operations:**

- `addLiquidity(LiquidityParameters)` — Pulls tokens via `safeTransferFrom`, refunds leftovers to `refundTo`, returns configured values
- `removeLiquidity(tokenX, tokenY, binStep, amountXMin, amountYMin, ids[], amounts[], to, deadline)` — Tracks call count for sequential calls (different return values for 1st vs 2nd call)

**Call tracking:** Captures all params in public `last*` variables for both add and remove.

### MockPermit2

**Simulates:** Permit2 gasless approval system.

```solidity
constructor()
```

| Function | Notes |
|---|---|
| `approve(address token, address spender, uint160 amount, uint48 expiration)` | Emits `Approval` event only (no state) |

---

## Standard Deployment Sequences

### Full Vault Setup (PositionVault.test.js pattern)

Used by `PositionVault.test.js`, `TJPositionManager.test.js`, `BabyStepsStrategy.test.js`:

```javascript
// 1. Get signers
const [owner, user1, user2, strategyContract, executorWallet] = await ethers.getSigners();

// 2. Deploy mocks
const MockUniversalRouter = await ethers.getContractFactory("MockUniversalRouter");
const router = await MockUniversalRouter.deploy();

const MockNonfungiblePositionManager = await ethers.getContractFactory("MockNonfungiblePositionManager");
const positionManager = await MockNonfungiblePositionManager.deploy();

const MockPermit2 = await ethers.getContractFactory("MockPermit2");
const permit2 = await MockPermit2.deploy();
const permit2Address = await permit2.getAddress();

// 3. Deploy validators
const UniversalRouterValidator = await ethers.getContractFactory("UniversalRouterValidator");
const swapValidator = await UniversalRouterValidator.deploy();

const UniswapV3PositionValidator = await ethers.getContractFactory("UniswapV3PositionValidator");
const liquidityValidator = await UniswapV3PositionValidator.deploy();

// 4. Deploy VaultFactory
const VaultFactory = await ethers.getContractFactory("VaultFactory");
const factory = await VaultFactory.deploy(owner.address, permit2Address);

// 5. Register validators
await factory.setSwapValidator(await router.getAddress(), await swapValidator.getAddress());
await factory.setLiquidityValidator(
  await positionManager.getAddress(),
  await liquidityValidator.getAddress()
);

// 6. Create vault (extract address from event)
const tx = await factory.connect(owner).createVault("Test Vault");
const receipt = await tx.wait();
const vaultCreatedEvent = receipt.logs.find(
  log => log.fragment && log.fragment.name === 'VaultCreated'
);
const vaultAddress = vaultCreatedEvent.args[1];  // args[0] = owner, args[1] = vault
const vault = await ethers.getContractAt("PositionVault", vaultAddress);

// 7. Fund vault with test tokens
const MockERC20 = await ethers.getContractFactory("MockERC20");
const token = await MockERC20.deploy("Test Token", "TEST", 18);
await token.mint(vaultAddress, ethers.parseEther("100"));
```

### Trader Joe Extension

Extends the full vault setup with TJ-specific contracts:

```javascript
// Token sorting (TJ requires tokenX < tokenY by address)
const tokenXAddr = await tokenX.getAddress();
const tokenYAddr = await tokenY.getAddress();
if (tokenXAddr.toLowerCase() > tokenYAddr.toLowerCase()) {
  [tokenX, tokenY] = [tokenY, tokenX];
}

// Deploy TJ mocks
const MockLBPair = await ethers.getContractFactory("MockLBPair");
const lbPair = await MockLBPair.deploy(
  await tokenX.getAddress(), await tokenY.getAddress(), 20  // binStep
);

const MockLBRouter = await ethers.getContractFactory("MockLBRouter");
const lbRouter = await MockLBRouter.deploy();

// Deploy TJPositionProxy (implementation) + TJPositionManager
const TJPositionProxy = await ethers.getContractFactory("TJPositionProxy");
const proxyImpl = await TJPositionProxy.deploy();

const TJPositionManager = await ethers.getContractFactory("TJPositionManager");
const positionManager = await TJPositionManager.deploy(
  await lbRouter.getAddress(), await proxyImpl.getAddress()
);

const TJPositionValidator = await ethers.getContractFactory("TJPositionValidator");
const tjValidator = await TJPositionValidator.deploy();

// Register TJ validator
await factory.setLiquidityValidator(
  await positionManager.getAddress(),
  await tjValidator.getAddress()
);

// Vault must approve TJPositionManager for token transfers
const approveIface = new ethers.Interface([
  "function approve(address spender, uint256 amount) returns (bool)"
]);
const approveData = approveIface.encodeFunctionData("approve", [pmAddress, ethers.MaxUint256]);
await vault.approve([tokenXAddress, tokenYAddress], [approveData, approveData]);
```

### Validator-Only Setup (minimal)

Used by all 5 validator test files — no mocks, no factory, no vault:

```javascript
beforeEach(async function() {
  const [owner, user1] = await ethers.getSigners();
  vaultAddress = owner.address;   // Signer address as mock vault
  otherAddress = user1.address;   // Unauthorized address

  const Validator = await ethers.getContractFactory("ValidatorName");
  validator = await Validator.deploy();
  await validator.waitForDeployment();
});
```

Validator tests use the signer's address as a stand-in for the vault address. The validators only check that the recipient in calldata matches the vault address — they don't need a real vault.

### Strategy Setup

Extends full vault setup with strategy authorization:

```javascript
// Deploy strategy
const BabyStepsStrategy = await ethers.getContractFactory("BabyStepsStrategy");
const strategy = await BabyStepsStrategy.deploy();
const strategyAddress = await strategy.getAddress();

// Create vault for a user
const tx = await factory.connect(user1).createVault("Test Vault 1");
const receipt = await tx.wait();
const vault1Address = receipt.logs.find(
  log => log.fragment?.name === 'VaultCreated'
).args[1];

// Authorize vault (must be called by vault owner)
await strategy.connect(user1).authorizeVault(vault1Address);

// Interact with strategy through vault.execute()
const strategyInterface = new ethers.Interface([
  "function selectTemplate(uint8 template)",
  "function setRangeParameters(uint16 upperRange, uint16 lowerRange)",
  "function setFeeParameters(bool reinvest, uint256 trigger, uint16 ratio)",
  "function setRiskParameters(uint16 slippage, uint16 exitTrigger)"
]);

const data = strategyInterface.encodeFunctionData("selectTemplate", [1]); // CONSERVATIVE
await vault.connect(user1).execute([strategyAddress], [data]);
```

---

## Calldata Encoding Helpers

Each validator test file defines local encoding helpers that build calldata matching the real protocol's ABI. These are essential reference when writing new validator tests or debugging calldata parsing.

### Universal Router (UniversalRouterValidator.test.js)

```
encodeRouterExecute(commands, inputs, deadline)    — Top-level execute() calldata
encodeV3SwapInput(recipient, amountIn, amountOutMin, path, payerIsUser)
encodeV2SwapInput(recipient, amountIn, amountOutMin, path, payerIsUser)
encodeSweepInput(token, recipient, minAmount)
encodeWrapInput(recipient, amount)
encodePermit2Input()
encodeV4SwapInput(actions, params)                 — V4_SWAP command input
encodeV4TakeParams(currency, recipient, amount)
encodeV4TakeAllParams(currency, minAmount)
encodeV4TakePairParams(currency0, currency1, recipient)
encodeV4SwapActionParams()
```

**Key constants:**
- `EXECUTE_SELECTOR = "0x3593564c"`
- `ADDRESS_THIS = "0x0000000000000000000000000000000000000002"` (router-internal multi-hop recipient)
- Command IDs: `V3_SWAP_EXACT_IN = "0x00"`, `V3_SWAP_EXACT_OUT = "0x01"`, `SWEEP = "0x04"`, `UNWRAP_WETH = "0x0c"`, `V4_SWAP = "0x10"`, `WRAP_ETH = "0x0b"`, `PERMIT2_PERMIT = "0x0a"`

### Uniswap V3 Position Manager (UniswapV3PositionValidator.test.js)

```
encodeMint(token0, token1, fee, tickLower, tickUpper, amount0Desired, amount1Desired,
           amount0Min, amount1Min, recipient, deadline)
encodeIncreaseLiquidity(tokenId, amount0Desired, amount1Desired, amount0Min, amount1Min, deadline)
encodeDecreaseLiquidity(tokenId, liquidity, amount0Min, amount1Min, deadline)
encodeCollect(tokenId, recipient, amount0Max, amount1Max)
encodeBurn(tokenId)
encodeMulticall(calls)                             — Wraps array of encoded calls
```

**Selectors:** `MINT = "0x88316456"`, `INCREASE_LIQUIDITY = "0x219f5d17"`, `DECREASE_LIQUIDITY = "0x0c49ccbe"`, `COLLECT = "0xfc6f7865"`, `BURN = "0x42966c68"`, `MULTICALL = "0xac9650d8"`

### Uniswap V4 Position Manager (UniswapV4PositionValidator.test.js)

```
encodePoolKey(currency0, currency1, fee, tickSpacing, hooksAddr)
encodeMintPositionParams(poolKey, tickLower, tickUpper, liquidity, amount0Max, amount1Max,
                         owner, hookData)
encodeMintFromDeltasParams(poolKey, tickLower, tickUpper, amount0Max, amount1Max, owner, hookData)
encodeModifyLiquidityParams(tokenId, liquidity, amount0, amount1, hookData)
encodeBurnParams(tokenId, amount0Min, amount1Min, hookData)
encodeTakeParams(currency, recipient, amount)
encodeTakePortionParams(currency, recipient, bips)
encodeTakePairParams(currency0, currency1, recipient)
encodeSweepParams(currency, to)
encodeSettlePairParams(currency0, currency1)
encodeUnlockData(actions, params)                  — Inner ABI encoding
encodeModifyLiquidities(actions, params, deadline)  — Top-level entry point
```

**Key constant:** `MSG_SENDER = "0x0000000000000000000000000000000000000001"` (V4 sentinel for owner)

**Action codes:** `INCREASE_LIQUIDITY = 0`, `DECREASE_LIQUIDITY = 1`, `MINT_POSITION = 2`, `BURN_POSITION = 3`, `MINT_POSITION_FROM_DELTAS = 26`, `TAKE_PAIR = 16`, `SETTLE_PAIR = 17`, `TAKE = 13`, `TAKE_PORTION = 14`, `SWEEP = 20`

### Trader Joe Position (TJPositionValidator.test.js)

```
encodeCreatePosition(vault, lbPair, amountX, amountY, amountXMin, amountYMin,
                     activeIdDesired, idSlippage, deltaIds, distributionX, distributionY, deadline)
encodeAddToPosition(vault, positionId, previousFeesX, previousFeesY, amountX, amountY,
                    amountXMin, amountYMin, activeIdDesired, idSlippage, deltaIds,
                    distributionX, distributionY, deadline)
encodeCollectFees(vault, positionId, feeShares, amountXMin, amountYMin, deadline)
encodeDecreaseLiquidity(vault, positionId, percentage, feeShares, amountXMin, amountYMin, deadline)
encodeRemovePosition(vault, positionId, feeShares, amountXMin, amountYMin, deadline)
```

### Trader Joe Swap (TJSwapValidator.test.js)

```
encodeLBRouterSwap(functionName, params)
```

Handles all 6 LB Router swap functions. 5-param group (`swapExactTokensForTokens`, `swapExactTokensForNATIVE`, `swapTokensForExactTokens`, `swapTokensForExactNATIVE`) encodes as `(amount1, amount2, path, to, deadline)`. 4-param group (`swapNATIVEForExactTokens`, `swapExactNATIVEForTokens`) encodes as `(amount1, path, to, deadline)`.

---

## Vault Address Extraction Pattern

Every test that creates a vault needs to extract the address from the `VaultCreated` event:

```javascript
const tx = await factory.connect(owner).createVault("Test Vault");
const receipt = await tx.wait();
const vaultCreatedEvent = receipt.logs.find(
  log => log.fragment && log.fragment.name === 'VaultCreated'
);
const vaultAddress = vaultCreatedEvent.args[1];  // args[0] = owner, args[1] = vault address
const vault = await ethers.getContractAt("PositionVault", vaultAddress);
```

**Alternative (safer parsing):**
```javascript
const vaultCreatedEvent = receipt.logs.find(log => {
  try {
    const parsed = factory.interface.parseLog(log);
    return parsed && parsed.name === 'VaultCreated';
  } catch { return false; }
});
const vaultAddress = factory.interface.parseLog(vaultCreatedEvent).args[1];
```

---

## Gotchas

1. **Mock contracts are in `contracts/`, not a subdirectory** — They compile alongside the real contracts. The naming prefix `Mock*` is the only distinction.

2. **Token sorting for Trader Joe** — LB pairs require `tokenX < tokenY` by address. Always sort before creating a MockLBPair or encoding TJ calldata.

3. **Deadline source matters** — Use `(await ethers.provider.getBlock("latest")).timestamp + 3600` for block-relative deadlines. Wall-clock `Date.now()` can drift from the forked block timestamp.

4. **V4 has no mock contract** — UniswapV4PositionValidator tests use signer addresses as stand-ins for token and hook addresses. Only calldata encoding/parsing is tested.

5. **Vault approval for TJ** — The vault must approve TJPositionManager for token transfers. This is done through `vault.approve()` with encoded ERC20 `approve` calldata, not a direct `token.approve()` call.

6. **Strategy interaction goes through vault.execute()** — Strategies are never called directly in tests. Encode the function call and pass it through `vault.execute([strategyAddress], [encodedData])`.

7. **MockLBRouter sequential call tracking** — `removeLiquidity` tracks call count and uses different return values for 1st vs 2nd call (simulates fee collection + principal removal). Call `resetRemoveCallCount()` between test cases.

8. **Event parsing requires fragment check** — Use `log.fragment?.name` or wrap in try/catch. Some logs from internal calls don't have parsed fragments.

9. **`viaIR: true` in compiler settings** — Hardhat config enables the IR-based code generator. This is required for contracts that exceed the stack depth limit with the legacy pipeline.

10. **Hardhat config is `.js` not `.cjs`** — fum_testing is CommonJS (no `"type": "module"`), so `.js` extension works. This differs from fum's `hardhat.config.cjs` which needs the `.cjs` extension because fum is ESM.

---

## See Also

- [Contract System](../../fum/docs/architecture/contract-system.md) — What these tests verify
- [Validator Pattern](../../fum/docs/architecture/validator-pattern.md) — Calldata validation details with offset calculations
- fum `CLAUDE.md` — Contract sync commands (`npm run contracts:sync`, `npm run contracts:test`)
