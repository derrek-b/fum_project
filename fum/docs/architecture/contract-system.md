<!-- Source: contracts/PositionVault.sol, contracts/VaultFactory.sol, contracts/StrategyBase.sol, contracts/BabyStepsStrategy.sol, contracts/TJPositionManager.sol, contracts/TJPositionProxy.sol, contracts/interfaces/*, contracts/validators/* -->
# Contract System

How all smart contracts relate, their execution flows, and the factory-validator-strategy architecture that enables secure, extensible DeFi vault management.

## Contract Inventory

| Contract | Purpose | Deployment | Version |
|---|---|---|---|
| VaultFactory | Deploys vaults, manages validator registry | One per chain | 2.0.0 |
| PositionVault | User-controlled vault for tokens + LP positions | One per user (via factory) | 2.0.0 |
| StrategyBase | Abstract base for automation strategies | Never deployed directly | — |
| BabyStepsStrategy | Conservative range-based strategy | One per chain | 2.0.0 |
| TJPositionManager | Manages Trader Joe V2.2 bin positions (proxy-per-position) | One per chain | — |
| TJPositionProxy | EIP-1167 minimal proxy holding ERC1155 LB tokens | One per position (cloned) | — |
| UniversalRouterValidator | Validates Uniswap Universal Router swaps | One per chain | — |
| UniswapV3PositionValidator | Validates V3 NonfungiblePositionManager ops | One per chain | — |
| UniswapV4PositionValidator | Validates V4 PositionManager ops | One per chain | — |
| TJPositionValidator | Validates TJPositionManager ops | One per chain | — |
| TJSwapValidator | Validates Trader Joe LBRouter swaps | One per chain | — |
| MerklIncentiveValidator | Validates Merkl Distributor claim() calls | One per chain | — |

---

## Architecture Diagram

```
                          ┌─────────────────┐
                          │   VaultFactory   │
                          │   (per chain)    │
                          ├─────────────────┤
                          │ swapValidators   │──── router addr → ISwapValidator
                          │ liquidityValid.  │──── posMgr addr → ILiquidityValidator
                          │ incentiveValid.  │──── target addr → IIncentiveValidator
                          │ userVaults[]     │
                          │ vaultInfo{}      │
                          │ allVaults[]      │
                          └────────┬────────┘
                                   │ createVault()
                                   ▼
┌──────────┐           ┌─────────────────┐           ┌──────────────────┐
│  Owner   │──owns────▶│  PositionVault  │──────────▶│   Validators     │
│ (wallet) │           │   (per user)    │  validate │ (via factory)    │
└──────────┘           ├─────────────────┤           └──────────────────┘
                       │ owner           │
┌──────────┐           │ executor        │           ┌──────────────────┐
│ Executor │──auth────▶│ strategy        │──────────▶│   Strategy       │
│ (bot)    │           │ factory         │  params   │ (per chain)      │
└──────────┘           │ permit2         │           └──────────────────┘
                       └─────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
        ┌──────────┐   ┌──────────┐   ┌──────────────┐
        │ Uniswap  │   │ Uniswap  │   │ Trader Joe   │
        │ V3 / V4  │   │ Router   │   │ LBRouter +   │
        │ PosMgr   │   │          │   │ TJPosMgr     │
        └──────────┘   └──────────┘   └──────────────┘
```

**Role Model:**
- **Owner** — Full control. Can call `execute()` (raw arbitrary calls, no validation), set strategy/executor, withdraw tokens/positions, configure targets
- **Executor** — Automation bot. Can call validated operations (swap, mint, liquidity, collect, burn) and withdraw functions — but withdraw/unwrap functions hardcode the recipient to the vault owner, so the executor cannot redirect funds to itself. Cannot call `execute()` or change strategy/executor
- **onlyOwner**: `execute`, `setStrategy`, `removeStrategy`, `setExecutor`, `removeExecutor`, `setTargetTokens`, `setTargetPlatforms`
- **onlyAuthorized** (owner OR executor): all other operational functions

---

## VaultFactory

**Source:** `contracts/VaultFactory.sol`

**Constructor:** `constructor(address initialOwner, address _permit2)`
- `initialOwner` — Factory owner (can register validators)
- `_permit2` — Permit2 contract address (immutable, passed to each vault)

### Validator Registries

Three mappings that define the extensibility mechanism:

```solidity
mapping(address => ISwapValidator) public swapValidators;            // router → validator
mapping(address => ILiquidityValidator) public liquidityValidators;   // posMgr → validator
mapping(address => IIncentiveValidator) public incentiveValidators;   // target → validator
```

**Registration (onlyOwner):**
- `setSwapValidator(address router, ISwapValidator validator)` — Maps a DEX router to its swap validator
- `setLiquidityValidator(address positionManager, ILiquidityValidator validator)` — Maps a position manager to its liquidity validator
- `setIncentiveValidator(address target, IIncentiveValidator validator)` — Maps an incentive contract (e.g., Merkl Distributor) to its validator

**Validation dispatch:** When a vault calls `factory.validateSwap(router, data, vault)`, the factory looks up `swapValidators[router]` and delegates. Same pattern for `validateIncentive(target, data, vault)`. Reverts if no validator registered.

### Vault Tracking

```solidity
mapping(address => address[]) public userVaults;   // user → their vault addresses
mapping(address => VaultInfo) public vaultInfo;     // vault → metadata
address[] public allVaults;                         // global registry
uint256 public nextExecutorIndex;                   // monotonic counter assigned at vault creation

struct VaultInfo {
    address owner;
    string name;
    uint256 creationTime;
    uint256 creationBlock;
    uint256 executorIndex;   // per-vault index for deterministic executor wallet derivation
}
```

**Functions:** `createVault(name)`, `updateVaultName(vault, name)`, `getVaults(user)`, `getVaultInfo(vault)`, `getVaultCount(user)`, `getTotalVaultCount()`, `isVault(vault) → (bool, address owner)`, `getVersion() → "2.0.0"`

**Events:** `VaultCreated(user, vault, name, userVaultCount)`, `VaultNameUpdated(vault, name)`, `SwapValidatorUpdated(router, validator)`, `LiquidityValidatorUpdated(positionManager, validator)`, `IncentiveValidatorUpdated(target, validator)`

### Active Vault Registry

Tracks the subset of vaults that have an executor set — the working set the automation service iterates.

```solidity
address[] public activeVaults;
mapping(address => uint256) private activeVaultIndex;   // 1-indexed (0 = not active)
```

**Vault-callable functions** (only the vault itself may call these; enforced via `msg.sender == vault`):
- `registerActiveVault(vault)` — Called by `PositionVault.setExecutor` on first activation (executor transitions from `address(0)` → non-zero)
- `deregisterActiveVault(vault)` — Called by `PositionVault.removeExecutor`. Uses swap-and-pop for O(1) removal.

**Public views:** `getActiveVaults() → address[]`, `getActiveVaultCount() → uint256`

---

## PositionVault

**Source:** `contracts/PositionVault.sol`

**Constructor:** `constructor(address _owner, address _permit2, address _factory)`

### Execution Flow for Validated Operations

```
vault.swap(targets, data, values)
  │
  ├── for each target[i]:
  │     factory.validateSwap(target, data[i], address(this))
  │       └── swapValidators[target].validateSwap(data[i], vault)
  │             └── parse calldata, check recipients → revert or pass
  │
  └── for each target[i]:
        target.call{value: values[i]}(data[i])
        emit TransactionExecuted(target, data, success, "swap")
```

Same pattern for `mint`, `increaseLiquidity`, `decreaseLiquidity`, `collect`, `burn` — each calls the corresponding `factory.validate*()` before execution.

### Function Table

| Function | Access | Validation | ETH Values |
|---|---|---|---|
| `execute(targets, data)` | onlyOwner | **NONE** (raw arbitrary calls) | No |
| `swap(targets, data, values)` | onlyAuthorized | `factory.validateSwap` per target | Yes |
| `approve(targets, data)` | onlyAuthorized | Selector whitelist (see below) | No |
| `mint(targets, data, values)` | onlyAuthorized | `factory.validateMint` per target | Yes |
| `increaseLiquidity(targets, data, values)` | onlyAuthorized | `factory.validateIncreaseLiquidity` | Yes |
| `decreaseLiquidity(targets, data)` | onlyAuthorized | `factory.validateDecreaseLiquidity` | No |
| `collect(targets, data)` | onlyAuthorized | `factory.validateCollect` | No |
| `burn(targets, data)` | onlyAuthorized | `factory.validateBurn` | No |
| `incentive(targets, data, values)` | onlyAuthorized | `factory.validateIncentive` per target | Yes |
| `withdrawTokens(token, amount)` | onlyAuthorized | None (sends to owner) | — |
| `withdrawETH(amount)` | onlyAuthorized | None (sends to owner) | — |
| `unwrapAndWithdrawETH(weth, amount)` | onlyAuthorized | None (sends to owner) | — |
| `wrapETH(weth, amount)` | onlyAuthorized | None (stays in vault) | — |
| `unwrapETH(weth, amount)` | onlyAuthorized | None (stays in vault) | — |
| `withdrawPosition(nftContract, tokenId)` | onlyAuthorized | None (sends to owner) | — |
| `setExecutor(_executor)` | onlyOwner | None (registers vault with factory on first activation) | **payable** — optional `msg.value` forwarded to executor for initial gas funding |
| `removeExecutor()` | onlyOwner | None (deregisters vault from factory) | — |
| `fundExecutor(amount)` | onlyAuthorized | None (sends to executor) | **payable** — accepts `msg.value` |

**Approve validation:** Only allows selectors `0x095ea7b3` (ERC20 `approve`) and `0x87517c45` (Permit2 `permit`). All other selectors revert.

### EIP-1271 Support

`isValidSignature(bytes32 hash, bytes signature)` — Validates signatures by recovering the signer and checking against `owner`. Enables Permit2 and other signature-based protocols to work with the vault.

### ETH Handling

- `receive() external payable` — Accepts ETH transfers
- Swap/mint/increaseLiquidity accept `values[]` parameter — vault sends its own ETH with each call
- Wrap/unwrap functions for ETH ↔ WETH conversion within the vault

**Events:** `TransactionExecuted(target, data, success, txType)`, `TokensWithdrawn(token, to, amount)`, `PositionWithdrawn(tokenId, nftContract, to)`, `StrategyChanged(strategy)`, `ExecutorChanged(executor, isAuthorized)`, `ExecutorFunded(executor, amount)`, `TargetTokensUpdated(tokens)`, `TargetPlatformsUpdated(platforms)`

---

## Strategy System

### StrategyBase

**Source:** `contracts/StrategyBase.sol`

Abstract base providing vault authorization and template management. Key design: **strategies are parameter-only contracts** — all execution logic lives in fum_automation. The on-chain strategy stores configuration parameters and controls which vaults can use it.

**Storage:**
```solidity
mapping(address => bool) public authorizedVaults;
mapping(address => uint8) public selectedTemplate;        // 0 = None/Custom
mapping(address => uint256) public customizationBitmap;   // bit flags per param
```

**Authorization flow:**
```
User calls strategy.authorizeVault(vaultAddress)
  │
  ├── strategy calls vault.owner() via staticcall
  ├── checks msg.sender == returned owner
  └── sets authorizedVaults[vault] = true
```

**Template + customization bitmap pattern:**
- Each strategy defines templates with preset parameter values
- `selectedTemplate[vault]` selects a template (0 = none)
- `customizationBitmap[vault]` tracks which parameters the user has customized (bit per param)
- Getters check the bitmap: if bit is set, return custom value; otherwise return template default
- `selectTemplate(id)` clears the bitmap (resets all customizations)
- `_markCustomized(bits)` sets bits when setter is called

**Events:** `ParameterUpdated(vault, paramName)`, `TemplateSelected(vault, template)`, `CustomizationUpdated(vault, bitmap)`, `VaultAuthorized(vault, authorized)`

### BabyStepsStrategy

**Source:** `contracts/BabyStepsStrategy.sol` — Library artifact name: `'bob'`

**Templates:**

| ID | Name | Range U/L | Reinvest Trigger | Ratio | Max Slip | Emergency |
|---|---|---|---|---|---|---|
| 0 | NONE | — | — | — | — | — |
| 1 | CONSERVATIVE | 10% / 10% | $50 | 30% | 0.50% | 10% |
| 2 | MODERATE | 5% / 5% | $50 | 50% | 0.50% | 10% |
| 3 | AGGRESSIVE | 3% / 3% | $50 | 90% | 0.50% | 10% |
| 4 | STABLECOIN | 0.20% / 0.20% | $10 | 100% | 0.20% | 1% |

**7 Parameters** (per-vault, all basis points except where noted):

| Param | Type | Bitmap Bit | Setter Group |
|---|---|---|---|
| `targetRangeUpper` | uint16 (bps) | 0 | `setRangeParameters` |
| `targetRangeLower` | uint16 (bps) | 1 | `setRangeParameters` |
| `feeReinvestment` | bool | 2 | `setFeeParameters` |
| `reinvestmentTrigger` | uint256 (cents, USD) | 3 | `setFeeParameters` |
| `reinvestmentRatio` | uint16 (bps) | 4 | `setFeeParameters` |
| `maxSlippage` | uint16 (bps) | 5 | `setRiskParameters` |
| `emergencyExitTrigger` | uint16 (bps) | 6 | `setRiskParameters` |

> **Note:** Template constants for `reinvestmentTrigger` are stored as cents (e.g., `CONS_REINVESTMENT_TRIGGER = 5000` = $50.00). The field comment in `BabyStepsStrategy.sol` mislabels this as "USD value in wei (18 decimals)" — the template constants and all downstream comparisons treat the value as cents.

## TJPositionManager + TJPositionProxy

**Sources:** `contracts/TJPositionManager.sol`, `contracts/TJPositionProxy.sol`

Wraps Trader Joe V2.2 Liquidity Book (ERC1155-based) positions into a managed system with auto-incrementing IDs. Each position gets an EIP-1167 minimal proxy that holds its ERC1155 LB tokens — this isolation enables per-position fee attribution via the LiquidityHelperContract.

**Constructor:** `constructor(address _lbRouter, address _proxyImplementation)`
- `_lbRouter` — LB Router address (immutable)
- `_proxyImplementation` — TJPositionProxy implementation address (immutable, cloned per position)

**TJPositionProxy** is a minimal contract: `initialize(address _manager)` + `execute(address to, bytes data) returns (bytes memory)` (onlyManager). The manager clones it per position and routes all LB token operations through it.

### Position Struct

```solidity
struct Position {
    address owner;              // Position owner (always a PositionVault — enforced by createPosition auth)
    address lbPair;             // LB Pair contract
    address tokenX;             // First token
    address tokenY;             // Second token
    address proxy;              // EIP-1167 proxy holding LB tokens
    uint16 binStep;             // Bin step (e.g., 25 = 0.25%)
    uint256[] depositIds;       // Bin IDs with liquidity
    uint256[] liquidityMinted;  // LB tokens per bin
    uint256[] previousX;        // Fee baseline X amounts per bin
    uint256[] previousY;        // Fee baseline Y amounts per bin
    uint256 createdAt;          // Creation timestamp
    bool active;                // Position active flag
}
```

### Execution Flow

```
vault.mint(targets=[tjPositionManager], data, values)
  │
  ├── factory.validateMint(tjPositionManager, data, vault)
  │     └── TJPositionValidator checks selector + vault param (createPosition only)
  │
  └── tjPositionManager.createPosition(owner=vault, lbPair, ...)
        ├── require(owner == msg.sender)  // enforces vault == owner
        ├── deploy proxy via Clones.clone(proxyImplementation)
        ├── proxy.initialize(address(this))
        ├── transferFrom owner → manager → proxy (tokenX, tokenY)
        ├── via proxy: approve LBRouter, addLiquidity(to=proxy, refundTo=owner)
        ├── store Position with proxy, depositIds, liquidityMinted, previousX/Y
        ├── via proxy: reset approvals, sweep leftover tokens to owner
        └── emit PositionCreated(positionId, owner, lbPair, proxy, ...)
```

**Key difference from V3/V4:** Each position's LB tokens are held by a dedicated proxy (not the manager), enabling per-position `balanceOf` queries for fee math. Tokens flow: vault → manager → proxy → LBRouter.

### Off-Chain Fee Math

All fee computation happens off-chain via LFJ's LiquidityHelperContract (view calls). The contract stores baselines (`previousX/Y`) and executes burns. See `docs/platform-knowledge/trader-joe-v2-2.md` for constant-sum separation math and helper contract details.

- **Fee collection/removal**: Accept `feeShares[]` computed off-chain, burn fee LB tokens via proxy. Zero-amount entries are filtered by `_filterNonZero()` before calling `removeLiquidity` (LBPair reverts on zero amounts).
- **Add to position**: Accept `previousFeesX/Y[]` and adjust baselines. Fees stay compounding until explicitly collected.

**Functions:** `createPosition(owner, lbPair, ...)`, `addToPosition(positionId, previousFeesX[], previousFeesY[], ...)`, `collectFees(positionId, feeShares[], amountXMin, amountYMin, deadline)`, `decreaseLiquidity(positionId, percentage, feeShares[], amountXMin, amountYMin, deadline)`, `removePosition(positionId, feeShares[], amountXMin, amountYMin, deadline)`, `safeTransferFrom(from, to, tokenId)`, `getPosition(id)`, `getPositionsByOwner(owner)`, `getPositionCount(owner)`

**Events:** `PositionCreated(positionId, owner, lbPair, proxy, depositIds, liquidityMinted, amountXAdded, amountYAdded)`, `PositionRemoved(positionId, owner, lbPair, percentage, amountX, amountY)`, `PositionIncreased(positionId, owner, lbPair, amountXAdded, amountYAdded)`, `FeesCollected(positionId, owner, lbPair, amountX, amountY)`, `PositionTransferred(positionId, from, to)`

Auth: `createPosition` requires `owner == msg.sender`; all other operations check `pos.owner == msg.sender` against stored position state. Because the vault is always `msg.sender`, `pos.owner` is always a PositionVault.

---

## Interfaces

| Interface | Implementors | Key Functions |
|---|---|---|
| ISwapValidator | UniversalRouterValidator, TJSwapValidator | `validateSwap(data, vault)` |
| ILiquidityValidator | UniswapV3PositionValidator, UniswapV4PositionValidator, TJPositionValidator | `validateMint`, `validateIncreaseLiquidity`, `validateDecreaseLiquidity`, `validateCollect`, `validateBurn` |
| IIncentiveValidator | MerklIncentiveValidator | `validateIncentive(data, vault)` |
| IVaultFactory | VaultFactory | `validateSwap`, `validateMint`, `validateIncreaseLiquidity`, `validateDecreaseLiquidity`, `validateCollect`, `validateBurn`, `validateIncentive`, `registerActiveVault`, `deregisterActiveVault` |
| ILBPair | (external Trader Joe) | `getTokenX/Y`, `getBinStep`, `balanceOf`, `getBin`, `totalSupply`, `approveForAll` |
| ILBRouter | (external Trader Joe) | `addLiquidity(LiquidityParameters)`, `removeLiquidity(...)` |

---

## Deployment & Registration Flow

Setting up on a new chain:

1. Deploy `VaultFactory(deployer, permit2Address)`
2. Deploy `BabyStepsStrategy()`
3. Deploy all 6 validators
4. Deploy `TJPositionProxy()` (implementation contract, if Trader Joe supported)
5. Deploy `TJPositionManager(lbRouterAddress, tjPositionProxyAddress)` (if Trader Joe supported)
6. Register swap validators:
   - `factory.setSwapValidator(universalRouterAddress, universalRouterValidator)`
   - `factory.setSwapValidator(lbRouterAddress, tjSwapValidator)`
7. Register liquidity validators:
   - `factory.setLiquidityValidator(v3PositionManager, v3PositionValidator)`
   - `factory.setLiquidityValidator(v4PositionManager, v4PositionValidator)`
   - `factory.setLiquidityValidator(tjPositionManager, tjPositionValidator)`
8. Register incentive validators:
   - `factory.setIncentiveValidator(merklDistributorAddress, merklIncentiveValidator)`
9. Update fum_library with deployed addresses
10. Run `npm run pack` in fum_library to distribute

---

## Adding a New Platform

1. **Determine interfaces needed** — Does the platform have a swap router (ISwapValidator)? A position manager (ILiquidityValidator)? An incentive/reward distributor (IIncentiveValidator)? Any combination of the three.
2. **Create validators** — Implement the relevant validator interface(s); for each function, parse calldata and enforce that recipients equal the vault address
3. **Optional position manager wrapper** — If the platform uses ERC1155 or non-standard position tracking (like TJPositionManager wraps LB)
4. **Deploy and register** — Deploy validators, call `setSwapValidator` / `setLiquidityValidator` / `setIncentiveValidator` on VaultFactory as appropriate
5. **Test** — Ensure all calldata parsing handles the platform's encoding correctly

---

## See Also

- [Validator Pattern](./validator-pattern.md) — Deep-dive into calldata parsing and security invariants
- [Scripts Pipeline](./scripts-pipeline.md) — How contracts are compiled, extracted, and deployed
- fum_automation `docs/architecture/strategy-system.md` — Strategy execution logic (the other half of the strategy system)
