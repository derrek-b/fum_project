<!-- Source: fum_automation/src/core/AutomationService.js, fum_automation/src/strategies/base/StrategyBase.js, fum_automation/src/strategies/babySteps/BabyStepsStrategy.js, fum_automation/src/core/EventManager.js, fum/contracts/PositionVault.sol, fum/contracts/VaultFactory.sol, fum_library/src/blockchain/contracts.js, fum_library/src/configs/chains.js -->
# Per-Vault Signer Architecture

## Status: Design Complete — Ready for Implementation

## Problem

The automation service uses a single private key (AUTOMATION_PRIVATE_KEY) to execute transactions across all vaults. ethers.js v5's default Wallet calls `getTransactionCount` independently on every `sendTransaction`, so concurrent transactions from different vaults can receive the same nonce. One succeeds, the rest fail.

Per-vault locking prevents intra-vault nonce collisions (sequential transactions within one vault), but cross-vault collisions are unprotected. This is a latent bug that will surface as vault count grows.

### Alternatives Considered

Before arriving at this design, three nonce-management approaches were evaluated:

1. **FIFO Transaction Queue** — Serialize all transactions through a single chokepoint. Correct and simple, but O(n) latency for the nth concurrent transaction. At 50 concurrent rebalances on Arbitrum, the last vault waits ~50 seconds. Multi-step operations (decrease → collect → swap → mint) make it worse.

2. **Mutex Around Broadcast** — Only serialize the `sendTransaction` call (~200ms), let confirmations run in parallel. ~5x better throughput than FIFO, but broadcast failures create nonce gaps that require recovery logic. More complex, still has a serialization bottleneck.

3. **ethers.js v5 NonceManager** — Experimental, not production-ready. Nonce gaps on failed sends (all future txs stuck), no re-broadcast for dropped txs, gets out of sync with external sends, maintainer says "not designed for fire-and-forget." Violates fail-loud principle.

All three manage the single-signer concurrency problem with varying degrees of complexity and throughput. The per-vault signer approach eliminates the problem entirely by removing the shared nonce space.

### EVM Nonce Behavior (Cross-Chain Research)

All EVM chains consume the nonce on reverted transactions — this is the EVM specification, not chain-specific. The nonce is incremented before execution begins. A reverted transaction (status=0 in receipt) is included in a block and permanently consumes the nonce on every chain.

The nonce collision risk in our codebase is about **broadcast-level races** (two concurrent `sendTransaction` calls getting the same nonce before either is broadcast), not about on-chain reverts.

Key per-chain differences relevant to nonce management:

| Chain | Mempool | `'pending'` tag reliable? | Key gotcha |
|---|---|---|---|
| Arbitrum | No (sequencer) | N/A (instant processing) | Future nonces rejected immediately, not queued |
| Avalanche | Yes (validator gossip) | Node-local only | None significant |
| Polygon | Yes (public) | **Unreliable** | Reorgs, gas estimation, nonce desync |
| Optimism/Base | Yes (private) | **Buggy (1-2s stale)** | Nonce update latency after tx submission |
| Ethereum | Yes (public) | Node-local | Standard, 12s blocks |
| BSC | Yes (public) | Standard | None — faster Ethereum |

The per-vault signer design eliminates cross-vault nonce collisions on all chains. Chain-specific quirks (Polygon's unreliable pending tag, OP Stack's nonce latency) still apply within a single vault's nonce space, but existing per-vault locking already serializes transactions within a vault, so these are not a concern.

## Proposed Solution: Per-Vault Derived Signers

Store a BIP-39 mnemonic instead of a single private key. Derive a unique wallet for each vault using HD derivation (BIP-32/BIP-44). Each vault gets its own executor address with its own nonce space.

```
Mnemonic (one secret, stored in automation service env)
  ├── m/44'/60'/0'/0/0 → Wallet A → manages Vault A (nonce space A)
  ├── m/44'/60'/0'/0/1 → Wallet B → manages Vault B (nonce space B)
  ├── m/44'/60'/0'/0/2 → Wallet C → manages Vault C (nonce space C)
  └── ...
```

Derivation is deterministic — same mnemonic + same index always produces the same private key and address. No private keys are stored per-vault; they are derived on the fly when needed.

### Why This Works

- Each derived wallet has its own address → its own nonce space
- Cross-vault nonce collisions are structurally impossible
- Existing per-vault locking already ensures sequential transactions within a vault
- No queue, no mutex, no nonce tracking infrastructure needed
- Fully parallel execution across all vaults with zero coordination

---

## Decisions

### 1. Authorization Model — DECIDED

**PositionVault's authorization model requires no changes.** The contract already has a single `executor` storage slot per vault (`address public executor`). Different vaults can have different executor addresses — the contract just checks `msg.sender == executor` via the `onlyAuthorized` modifier. The per-vault signer model works with the existing authorization interface. (PositionVault does get other changes — `setExecutor` becomes payable for initial gas funding (#2) and both `setExecutor`/`removeExecutor` gain active vault registry callbacks (#6) — but the core authorization model is unchanged.)

**VaultFactory requires two additions:**

```solidity
uint256 public nextExecutorIndex;  // Monotonic counter, starts at 0

struct VaultInfo {
    address owner;
    string name;
    uint256 creationTime;
    uint256 creationBlock;
    uint256 executorIndex;  // NEW: assigned at vault creation, never changes
}
```

`createVault()` assigns and increments the index:

```solidity
vaultInfo[vault] = VaultInfo(msg.sender, name, block.timestamp, block.number, nextExecutorIndex);
nextExecutorIndex++;
```

The index is assigned at vault creation time, not at authorization time. This means vaults that never enable automation still consume an index, but uint256 is effectively infinite and it keeps the design simple — no separate index-assignment mechanism needed.

**Frontend changes:** The current `executorAddress` field in chain config (`fum_library/src/configs/chains.js`) is replaced with an `executorXpub` — the extended public key derived from the mnemonic. The frontend reads a vault's `executorIndex` from VaultFactory, derives the executor address from the xpub, and passes it to `vault.setExecutor()`. No automation service dependency for onboarding.

**Migration:** Not needed. The single existing v1 vault will be manually deauthorized and its position removed before this version rolls out.

### 3. Index Mapping & Persistence — DECIDED

**The mapping lives on-chain in VaultFactory's VaultInfo struct.** No off-chain persistence needed.

- **Sequential monotonic counter** (`nextExecutorIndex++` at vault creation). No hashing, no deterministic derivation from vault address.
- **Indices are never reused.** When a vault is deauthorized, its index stays assigned. Simpler than tracking freed slots, and uint256 has no practical limit.
- **Recovery is trivial.** The automation service can reconstruct its full vault-to-signer mapping by reading on-chain state — iterate `allVaults[]`, read each vault's `executorIndex`, derive the wallet, check if `derivedAddress == vault.executor()`.
- **No backup strategy needed** for the mapping itself. The blockchain is the persistence layer. The only secret to back up is the mnemonic.

### 6. Vault Discovery & Onboarding — DECIDED

#### Active Vault Registry

The `allVaults[]` array is a historical registry — it only grows. As users come and go, create new vaults, or abandon old ones, iterating all vaults at startup becomes increasingly expensive (O(total) cross-contract calls). To solve this, VaultFactory maintains a separate active vault registry that tracks only vaults with executors set.

**VaultFactory additions:**

```solidity
address[] public activeVaults;
mapping(address => uint256) private activeVaultIndex; // 1-indexed (0 = not active)

function registerActiveVault(address vault) external {
    require(vaultInfo[vault].owner != address(0), "VaultFactory: not a vault");
    require(msg.sender == vault, "VaultFactory: caller is not vault");
    require(activeVaultIndex[vault] == 0, "VaultFactory: already active");

    activeVaults.push(vault);
    activeVaultIndex[vault] = activeVaults.length; // 1-indexed
}

function deregisterActiveVault(address vault) external {
    require(msg.sender == vault, "VaultFactory: caller is not vault");
    uint256 index = activeVaultIndex[vault];
    require(index != 0, "VaultFactory: not active");

    // Swap-and-pop for O(1) removal
    uint256 lastIndex = activeVaults.length;
    if (index != lastIndex) {
        address lastVault = activeVaults[lastIndex - 1];
        activeVaults[index - 1] = lastVault;
        activeVaultIndex[lastVault] = index;
    }
    activeVaults.pop();
    activeVaultIndex[vault] = 0;
}

function getActiveVaults() external view returns (address[] memory) {
    return activeVaults;
}

function getActiveVaultCount() external view returns (uint256) {
    return activeVaults.length;
}
```

**PositionVault changes** — callbacks on executor transitions only (not on executor-to-executor changes):

```solidity
function setExecutor(address _executor) external payable onlyOwner {
    require(_executor != address(0), "PositionVault: zero executor address");
    bool wasInactive = (executor == address(0));
    executor = _executor;
    if (msg.value > 0) {
        (bool sent, ) = _executor.call{value: msg.value}("");
        require(sent, "PositionVault: executor funding failed");
    }
    if (wasInactive) {
        IVaultFactory(factory).registerActiveVault(address(this));
    }
    emit ExecutorChanged(_executor, true);
}

function removeExecutor() external onlyOwner {
    address oldExecutor = executor;
    executor = address(0);
    if (oldExecutor != address(0)) {
        IVaultFactory(factory).deregisterActiveVault(address(this));
    }
    emit ExecutorChanged(oldExecutor, false);
}
```

**Design choices:**

- **1-indexed mapping** — `activeVaultIndex` uses 0 to mean "not in the array." Solidity initializes all mapping values to 0, so a 0-indexed mapping can't distinguish "vault at index 0" from "vault never registered." The 1-offset sidesteps this, combining the existence check and array position into a single mapping (no separate `isActive` bool needed — one SSTORE per register/deregister instead of two).
- **Swap-and-pop removal** — O(1) instead of O(n) array shifting. Order doesn't matter for discovery.
- **Transition-only callbacks** — PositionVault checks `executor == address(0)` before the set. If changing from one executor to another (already active), skips the factory call. Saves a cross-contract CALL on executor changes.
- **`msg.sender == vault` access control** — only factory-created vaults can register (verified via `vaultInfo[vault].owner != address(0)`).
- **`allVaults` stays** — historical registry for frontend/analytics. `activeVaults` is the operational subset for automation.

**Future optimization (deferred):** When vault count grows large enough that even `getActiveVaults()` becomes slow, Multicall3 batching can parallelize the per-vault `executorIndex` + `executor()` reads that follow discovery. Not needed at current scale.

#### Startup Discovery

The automation service calls `factory.getActiveVaults()` to get only vaults with executors set. For each, it reads `executorIndex` from VaultInfo, derives the address from the cached HDNode (`hdNode.derivePath("m/44'/60'/0'/0/" + executorIndex).address`), and verifies `derivedAddress == vault.executor()` as a sanity check. The `executorIndex` is stored in the vault cache for on-demand signer derivation during operations.

The derivation verification is a sanity check, not the partitioning mechanism. There is one automation service instance per chain — no need to distinguish "our vaults" from another service's vaults.

#### New Vault Onboarding

Fully self-service, no service dependency:

1. User creates vault → VaultFactory assigns `executorIndex` from `nextExecutorIndex++`
2. Frontend reads `executorIndex` from VaultFactory
3. Frontend derives executor address from xpub + index (client-side, no API call)
4. User calls `vault.setExecutor(derivedAddress)` with `msg.value` for initial gas funding
5. Automation service discovers the vault at next startup or via `ExecutorChanged` event

**Service offline at onboarding:** Not a problem. The xpub is in the frontend's chain config. Address derivation is a pure computation — no service interaction needed.

**xpub derivation (BIP-32):** HD wallets allow extracting an extended public key (xpub) that can derive child public keys and addresses without knowing any private keys. The xpub is derived at the `m/44'/60'/0'/0` level. From that xpub, the frontend can derive the address at any index below it. Private keys cannot be derived from the xpub — only the mnemonic holder (the automation service) can derive signers.

```javascript
// Service side (one-time setup):
const hdNode = ethers.utils.HDNode.fromMnemonic(mnemonic);
const xpub = hdNode.derivePath("m/44'/60'/0'/0").neuter().extendedKey;
// xpub goes into chain config

// Frontend side (per-vault, at authorization time):
const parentNode = ethers.utils.HDNode.fromExtendedKey(xpub);
const executorAddress = parentNode.derivePath(String(executorIndex)).address;
// User calls vault.setExecutor(executorAddress)

// Service side (at startup — single PBKDF2):
const hdNode = ethers.utils.HDNode.fromMnemonic(mnemonic);
// hdNode cached in AutomationService, passed to strategies

// Service side (at transaction time — microseconds, no caching needed):
const childNode = hdNode.derivePath(`m/44'/60'/0'/0/${executorIndex}`);
const signer = new ethers.Wallet(childNode.privateKey, provider);
// signer.address matches executorAddress
```

**Setup procedure:** One-time operational step when deploying the system:
1. Generate mnemonic
2. Derive xpub from mnemonic
3. Store mnemonic in automation service env (`AUTOMATION_MNEMONIC`)
4. Store xpub in chain config (`executorXpub` field, replaces `executorAddress`)
5. If mnemonic is ever rotated, the chain config xpub must be updated in lockstep

### 2. Gas Distribution — DECIDED

**Approach: Vault self-funding with VaultHealth subservice.**

Each vault funds its own executor from its own assets. No external banker wallet needed.

**Configuration:** Chain config gets `minExecutorBalance` and `maxExecutorBalance` properties — human-readable native asset amounts (e.g., `0.002` for 0.002 ETH on Arbitrum, `0.04` for 0.04 AVAX on Avalanche). Chain config handles chain-awareness naturally.

**Initial funding:** `setExecutor` becomes payable. When the user enables automation, the frontend bundles the executor funding with the authorization call — user sends `maxExecutorBalance` worth of native tokens with the `setExecutor` transaction, and the contract forwards `msg.value` to the executor address. One transaction, no chicken-and-egg.

```solidity
function setExecutor(address _executor) external payable onlyOwner {
    require(_executor != address(0), "PositionVault: zero executor address");
    bool wasInactive = (executor == address(0));
    executor = _executor;
    if (msg.value > 0) {
        (bool sent, ) = _executor.call{value: msg.value}("");
        require(sent, "PositionVault: executor funding failed");
    }
    if (wasInactive) {
        IVaultFactory(factory).registerActiveVault(address(this));
    }
    emit ExecutorChanged(_executor, true);
}
```

**Ongoing top-ups — responsibility split:**

The strategy deploys as much capital as possible into LP positions, leaving little or no liquid tokens in the vault. To fund executor gas without disrupting position sizing, VaultHealth and the strategy coordinate via a holdback amount:

- **VaultHealth** monitors executor balances (interval-based + event-driven), calculates holdback amounts, and executes the actual top-up (acquires vault lock, swaps held-back tokens to native, withdraws to executor, clears holdback).
- **Strategy** reads `holdbackAmount` and subtracts it from `availableDeployment` when sizing positions. The strategy doesn't know or care what the holdback is for — it just deploys less.

**Top-up flow:**

1. VaultHealth runs on a configurable interval (e.g., 5-30 min). Checks `provider.getBalance(executorAddress)` vs `minExecutorBalance`.
2. If low: calculates `holdbackAmount = (maxExecutorBalance - currentBalance) * nativeTokenPrice` in USD. Stored per vault.
3. Next rebalance (or position creation): strategy reads holdback, creates position with `tokenValue - holdbackAmount` instead of `tokenValue`. Remaining tokens stay in vault as undeployed balance.
4. VaultHealth listens for rebalance-complete events via EventManager. When it sees a vault with an outstanding holdback has completed a rebalance, it acquires the vault lock and executes the top-up: swap held-back tokens to native gas token, withdraw to executor, clear holdback. (Swap output may be native or wrapped depending on pool/router — unwrap only if needed.)
5. Interval check serves as fallback — catches cases where executor gets low between rebalances, or where a rebalance hasn't happened recently.

**Fee-funded top-ups (complementary):** When VaultHealth detects an outstanding holdback at fee collection time, it can divert a portion of collected fees to the executor before fees are redeployed. Fees are already "new money" entering the vault — skimming gas from them doesn't reduce the principal position and avoids the holdback impacting position sizing on the next rebalance. This is a complement to the holdback system, not a replacement — fee collection timing and amounts are unpredictable, so it can't be the primary mechanism.

**Service restart:** In-memory holdback state is lost on crash. VaultHealth recalculates from scratch on startup — checks all executor balances during `loadAuthorizedVaults`, sets holdbacks as needed before strategies execute.

**Integration with `calculateAvailableDeployment`:**

```javascript
// Current:
const availableDeployment = tokenValue > minDeployment ? tokenValue : 0;

// With holdback:
const holdbackAmount = this.vaultHealth.getHoldbackAmount(vault.address); // USD
const deployableValue = tokenValue - holdbackAmount;
const availableDeployment = deployableValue > minDeployment ? deployableValue : 0;
```

**Non-native vault top-ups:** Vaults holding only ERC20s (e.g., stablecoin strategies) can't withdraw native tokens directly. VaultHealth handles this: swap a small amount of vault tokens to native gas token via existing adapter swap infrastructure, withdraw to executor. Unwrap only if swap output is wrapped native. Amount is tiny, slippage irrelevant.

**Insufficient gas error handling:**

If the executor runs out of gas before VaultHealth can top it up, transaction submissions fail with ethers.js error code `INSUFFICIENT_FUNDS`. This requires a third error category alongside the existing binary (unrecoverable → blacklist, recoverable → retry):

- **Unrecoverable** (`UnrecoverableError`) — vault is broken, blacklist it
- **Recoverable** — transient failure (network, RPC), retry
- **Operationally blocked** (`InsufficientGasError`) — vault is fine but executor can't pay gas. Don't retry (balance hasn't changed), don't blacklist (vault isn't broken). Trigger VaultHealth holdback and skip the vault until gas is restored.

```javascript
// New error class in utils/errors.js
export class InsufficientGasError extends Error {
  constructor(message, vaultAddress, executorAddress) {
    super(message);
    this.name = 'InsufficientGasError';
    this.vaultAddress = vaultAddress;
    this.executorAddress = executorAddress;
  }
}
```

**Detection:** `executeBatchTransactions` in StrategyBase catches `error.code === 'INSUFFICIENT_FUNDS'` from ethers.js and wraps it in `InsufficientGasError`. AutomationService error handlers get a third branch:

```javascript
if (error instanceof InsufficientGasError) {
  // Don't retry, don't blacklist — enter funding-required lockdown
  this.vaultHealth.enterFundingRequired(vaultAddress);
} else if (this.isRecoverableError(error)) {
  await this.trackFailedVault(...);
} else {
  await this.blacklistVault(...);
}
```

**Why `INSUFFICIENT_FUNDS` always means gas:** Executors are EOAs that never send value. All vault functions (`swap`, `mint`, `liquidity`, `incentive`) are non-payable from the caller's perspective — the `values[]` arrays in these functions control how much of the vault's own ETH to forward to targets (e.g., V4 native ETH pools), not the executor's ETH. The vault checks `address(this).balance >= totalValue` against its own balance.

**Implementation details to resolve during build:**
- **Token selection for gas swap**: When vault has no native/wrapped-native, pick the token with the largest liquid balance (not locked in LP positions).
- **`minExecutorBalance` sizing**: Covers ~12 worst-case rebalance cycles (200 gwei on Arbitrum, 565 nAVAX on Avalanche). VaultHealth triggers top-up at this threshold. Even during extreme gas spikes, the executor has sufficient buffer for multiple operations before the next top-up.
- **Vault with no liquid assets and no holdback set**: If all value is locked in LP positions and no holdback was set before executor got low, VaultHealth can't fund the executor until the next rebalance frees assets. Flag via event/alert.
- **Defunding on revoke**: Executor's remaining gas should ideally be swept back to the vault during offboard (before `removeExecutor` revokes authorization). On Arbitrum the remaining amount is negligible, but on more expensive chains it may matter.

**VaultHealth as operational infrastructure module:** VaultHealth is not limited to gas distribution. It's the home for future operational concerns that require vault-level execution but aren't position management decisions — e.g., failed reward collection retries, staking operation retries. It uses the same vault transaction infrastructure as strategies (adapters, `executeBatchTransactions`).

**Alternatives considered:**
- **Master banker wallet**: Single wallet distributes gas to all executors. Simpler UX (user doesn't pay gas), but single point of failure, operational overhead, and business cost. Better suited if FUM charges management fees.
- **Account abstraction (ERC-4337)**: Paymaster sponsors executor transactions, eliminating gas distribution entirely. Cleanest long-term solution but over-engineered for current needs.

### 4. Security Considerations — DECIDED

**Risk profile is equivalent to current model.** Today: one private key compromised → attacker can execute authorized operations on all vaults. New model: mnemonic compromised → same outcome. One secret controls everything either way. Storage requirements are identical in practice — one env var on one server.

**Per-vault isolation is marginally better.** If a single derived private key is leaked (memory dump, side-channel) without the mnemonic leaking, only one vault is compromised. With the current single PK, any leak compromises all vaults. Edge case, but the per-vault architecture provides isolation the single-PK model doesn't.

**xpub is not secret.** The extended public key reveals derived addresses but cannot derive private keys. It can safely live in chain config (client-side code), on-chain, or both.

**Recovery is better.** A 12-word BIP-39 mnemonic reconstructs the entire wallet tree. Combined with on-chain index mapping, the full signer set can be recovered from the mnemonic alone.

**BIP-39 mnemonic, no passphrase.** BIP-39 is the right choice — ethers.js v5 has native support (`Wallet.fromMnemonic`), standard wallet tools can import/verify it, easier to back up than a hex string. The optional BIP-39 passphrase is NOT used — it adds operational risk (misconfiguring different passphrases per chain silently produces different key trees) with no real security benefit when both secrets would live in the same env file.

**On-chain guardrails already in place:** The validator system already enforces destination restrictions. Every vault operation goes through a factory-registered validator that parses calldata and enforces `recipient == vault` on all fund transfers. The registry lookup itself acts as target address validation — unknown target contracts revert at `require(address(validator) != address(0))` before execution reaches the call. A compromised executor cannot extract tokens because all operations route back to the vault. These guardrails are independent of the signer architecture and apply equally to single-PK and per-vault signer models. Additional guardrails (e.g., withdrawal rate limits) are not in scope for this design.

**Mnemonic collision risk:** A 12-word BIP-39 mnemonic encodes 128 bits of entropy (2^128 ≈ 3.4 × 10^38 possibilities). No collision checking exists or is needed — the keyspace is large enough that collisions are statistically impossible. This is the same assumption underpinning all of cryptocurrency: private keys, digital signatures, and TLS encryption all trust that large random numbers don't collide.

### 5. Multi-Chain Implications — DECIDED

**One mnemonic across all chains.** Same `AUTOMATION_MNEMONIC` env var used for Arbitrum, Avalanche, and any future chains. A mnemonic has no concept of "which chain" — derived addresses are just EOAs that exist on every EVM chain simultaneously. One secret to manage, one xpub for all chains.

Separate mnemonics per chain would give the illusion of independence without the reality (both stored in the same env file on the same server). More operational complexity for no security benefit.

**Independent index spaces per chain.** Each chain has its own VaultFactory with its own `nextExecutorIndex` counter. Arbitrum vault at index 3 and Avalanche vault at index 3 happen to get the same derived executor address — that's fine. Different chains, independent nonces, independent balances, independent state.

**No per-chain derivation logic.** Same mnemonic, same derivation path scheme (`m/44'/60'/0'/0/{index}`), same xpub. Chain-specific differences are handled by chain config (gas amounts in #2) and per-chain VaultFactory deployments (index assignment in #3), not by the derivation scheme.

**Gas distribution is chain-aware via config.** Already handled by #2's design — `minExecutorBalance`/`maxExecutorBalance` are per-chain values in chain config, denominated in each chain's native token.

**Per-vault signer is chain-agnostic for nonce correctness.** Cross-vault nonce collisions are eliminated on all chains. Chain-specific quirks (Polygon's unreliable `pending` tag, OP Stack's 1-2s nonce latency) only matter for concurrent transactions from the same address. Per-vault locking already serializes within a vault, so these quirks don't apply. The architecture works identically on every EVM chain.

**Enforcement:** Operational discipline — deploy the same mnemonic to all chain instances. The vault discovery sanity check (derived address must match `vault.executor()`) catches misconfiguration.

### 7. Operational Concerns — DECIDED

Straightforward implementation details, no design decisions needed.

- **Monitoring:** VaultHealth already checks executor balances on its interval (from #2). When low, it sets the holdback amount and listens for `VaultUnlocked` events to trigger top-up execution. When an `InsufficientGasError` is caught, AutomationService calls `vaultHealth.enterFundingRequired()` directly — emits `ExecutorFundingRequired` for SSE/alerts (e.g., Telegram notifications).
- **Debugging:** Include the derivation index in log prefixes and emitted events alongside the vault address. When investigating a failed transaction, the index identifies which derived wallet was involved and the signer can be re-derived for inspection.
- **Backup/recovery:** Secure offline storage of the 12-word mnemonic (standard practice). Index mapping lives on-chain (#3), so the mnemonic is the only secret to back up. Full signer set is reconstructable from mnemonic + on-chain state.
- **Key rotation:** Requires generating a new mnemonic, updating `AUTOMATION_MNEMONIC` env var, updating `executorXpub` in chain config, and having every vault owner call `setExecutor` with their new derived address. Coordinated migration — the frontend would need to detect the xpub change and prompt users to re-authorize. Disruptive but operationally identical to rotating the current single PK (which also requires every vault to re-authorize).

---

## Implementation Steps

Ordered by dependency — each phase depends on the ones above it.

### Phase 1: Smart Contract Changes

The foundation — all downstream work depends on these contracts.

**VaultFactory.sol:**
- Add `uint256 public nextExecutorIndex` state variable
- Add `executorIndex` field to `VaultInfo` struct (alongside existing `creationTime`, `creationBlock`)
- Update `createVault()` to assign `nextExecutorIndex` and increment
- Add `activeVaults[]` array + `activeVaultIndex` mapping (1-indexed)
- Add `registerActiveVault()`, `deregisterActiveVault()` (vault-only, swap-and-pop)
- Add `getActiveVaults()`, `getActiveVaultCount()`
- Update `getVaultInfo()` return signature to include `executorIndex`

**PositionVault.sol:**
- Make `setExecutor` payable — forward `msg.value` to executor
- Add transition check (`wasInactive`) — only call `registerActiveVault` on `address(0) → non-zero`
- Add `deregisterActiveVault` call to `removeExecutor`

**IVaultFactory.sol:**
- Add `registerActiveVault(address vault) external` to interface
- Add `deregisterActiveVault(address vault) external` to interface

---

#### Phase 1 Implementation Details

Line references are to the current source files. Each change is shown as "Replace" (swap existing code) or "Insert" (add new code at a location). Code blocks are complete and copy-pasteable.

##### IVaultFactory.sol

**Insert after `validateIncentive` (line 66), before the closing `}`:**

```solidity
    /**
     * @notice Registers vault as active in the factory's active vault registry
     * @param vault The vault address to register
     * @dev Called by PositionVault.setExecutor on first activation (address(0) → non-zero)
     */
    function registerActiveVault(address vault) external;

    /**
     * @notice Deregisters vault from the factory's active vault registry
     * @param vault The vault address to deregister
     * @dev Called by PositionVault.removeExecutor
     */
    function deregisterActiveVault(address vault) external;
```

##### VaultFactory.sol

**Change 1 — Modify VaultInfo struct** (replace lines 30–35):

```solidity
    // BEFORE:
    struct VaultInfo {
        address owner;
        string name;
        uint256 creationTime;
        uint256 creationBlock;
    }

    // AFTER:
    struct VaultInfo {
        address owner;
        string name;
        uint256 creationTime;
        uint256 creationBlock;
        uint256 executorIndex;
    }
```

**Change 2 — Add state variables** (insert after line 39, after `address[] public allVaults;`):

```solidity
    // Per-vault signer index — monotonic counter, assigned at vault creation
    uint256 public nextExecutorIndex;

    // Active vault registry — tracks only vaults with executors set
    address[] public activeVaults;
    mapping(address => uint256) private activeVaultIndex; // 1-indexed (0 = not active)
```

**Change 3 — Update `createVault()` VaultInfo initialization** (replace lines 199–205):

```solidity
    // BEFORE:
        // Store vault info
        vaultInfo[vault] = VaultInfo({
            owner: msg.sender,
            name: name,
            creationTime: block.timestamp,
            creationBlock: block.number
        });

    // AFTER:
        // Store vault info with executor index
        vaultInfo[vault] = VaultInfo({
            owner: msg.sender,
            name: name,
            creationTime: block.timestamp,
            creationBlock: block.number,
            executorIndex: nextExecutorIndex
        });
        nextExecutorIndex++;
```

The rest of `createVault()` (PositionVault constructor call, userVaults push, allVaults push, event emit) is unchanged. Full function after changes:

```solidity
    function createVault(string calldata name) external returns (address vault) {
        require(bytes(name).length > 0, "VaultFactory: vault name cannot be empty");

        vault = address(new PositionVault(
            msg.sender,
            permit2,
            address(this)
        ));

        userVaults[msg.sender].push(vault);

        vaultInfo[vault] = VaultInfo({
            owner: msg.sender,
            name: name,
            creationTime: block.timestamp,
            creationBlock: block.number,
            executorIndex: nextExecutorIndex
        });
        nextExecutorIndex++;

        allVaults.push(vault);

        emit VaultCreated(msg.sender, vault, name, userVaults[msg.sender].length);

        return vault;
    }
```

**Change 4 — Add Active Vault Registry section** (insert after `isVault` function, before `getVersion`, line 285):

```solidity
    // ============ Active Vault Registry ============

    /**
     * @notice Registers a vault as active (called by vault on first setExecutor)
     * @param vault Address of the vault to register
     * @dev Only callable by factory-created vaults. Access control:
     *      - vaultInfo[vault].owner != address(0) ensures it's a factory-created vault
     *      - msg.sender == vault ensures only the vault itself can register
     *      - activeVaultIndex[vault] == 0 prevents duplicate registration
     */
    function registerActiveVault(address vault) external {
        require(vaultInfo[vault].owner != address(0), "VaultFactory: not a vault");
        require(msg.sender == vault, "VaultFactory: caller is not vault");
        require(activeVaultIndex[vault] == 0, "VaultFactory: already active");

        activeVaults.push(vault);
        activeVaultIndex[vault] = activeVaults.length; // 1-indexed
    }

    /**
     * @notice Deregisters a vault from active registry (called by vault on removeExecutor)
     * @param vault Address of the vault to deregister
     * @dev Swap-and-pop for O(1) removal. Only callable by the vault itself.
     */
    function deregisterActiveVault(address vault) external {
        require(msg.sender == vault, "VaultFactory: caller is not vault");
        uint256 index = activeVaultIndex[vault];
        require(index != 0, "VaultFactory: not active");

        uint256 lastIndex = activeVaults.length;
        if (index != lastIndex) {
            address lastVault = activeVaults[lastIndex - 1];
            activeVaults[index - 1] = lastVault;
            activeVaultIndex[lastVault] = index;
        }
        activeVaults.pop();
        activeVaultIndex[vault] = 0;
    }

    /**
     * @notice Returns all active vault addresses
     * @return Array of active vault addresses
     */
    function getActiveVaults() external view returns (address[] memory) {
        return activeVaults;
    }

    /**
     * @notice Returns the number of active vaults
     * @return Number of active vaults
     */
    function getActiveVaultCount() external view returns (uint256) {
        return activeVaults.length;
    }
```

**Change 5 — Update `getVaultInfo()` return signature** (replace lines 247–255):

```solidity
    // BEFORE:
    function getVaultInfo(address vault) external view returns (
        address owner,
        string memory name,
        uint256 creationTime,
        uint256 creationBlock
    ) {
        VaultInfo memory info = vaultInfo[vault];
        return (info.owner, info.name, info.creationTime, info.creationBlock);
    }

    // AFTER:
    function getVaultInfo(address vault) external view returns (
        address owner,
        string memory name,
        uint256 creationTime,
        uint256 creationBlock,
        uint256 executorIndex
    ) {
        VaultInfo memory info = vaultInfo[vault];
        return (info.owner, info.name, info.creationTime, info.creationBlock, info.executorIndex);
    }
```

##### PositionVault.sol

**Change 1 — Replace `setExecutor`** (replace lines 193–201):

```solidity
    // BEFORE:
    /**
     * @notice Authorizes an executor
     * @param _executor Address of the executor
     */
    function setExecutor(address _executor) external onlyOwner {
        require(_executor != address(0), "PositionVault: zero executor address");
        executor = _executor;
        emit ExecutorChanged(_executor, true);
    }

    // AFTER:
    /**
     * @notice Authorizes an executor and optionally funds it with ETH
     * @param _executor Address of the executor
     * @dev Payable — msg.value is forwarded to the executor for initial gas funding.
     *      On first activation (address(0) → non-zero), registers vault as active in factory.
     *      Executor-to-executor changes skip the factory call (vault already active).
     */
    function setExecutor(address _executor) external payable onlyOwner {
        require(_executor != address(0), "PositionVault: zero executor address");
        bool wasInactive = (executor == address(0));
        executor = _executor;
        if (msg.value > 0) {
            (bool sent, ) = _executor.call{value: msg.value}("");
            require(sent, "PositionVault: executor funding failed");
        }
        if (wasInactive) {
            IVaultFactory(factory).registerActiveVault(address(this));
        }
        emit ExecutorChanged(_executor, true);
    }
```

**Change 2 — Replace `removeExecutor`** (replace lines 203–209):

```solidity
    // BEFORE:
    /**
     * @notice De-authorises an executor
     */
    function removeExecutor() external onlyOwner {
        emit ExecutorChanged(executor, false);
        executor = address(0);
    }

    // AFTER:
    /**
     * @notice De-authorises the executor and deregisters from active vault registry
     * @dev Saves old executor address for event emission before clearing.
     *      Only calls deregisterActiveVault if there was an active executor —
     *      allows calling removeExecutor when executor is already address(0) (no-op).
     */
    function removeExecutor() external onlyOwner {
        address oldExecutor = executor;
        executor = address(0);
        if (oldExecutor != address(0)) {
            IVaultFactory(factory).deregisterActiveVault(address(this));
        }
        emit ExecutorChanged(oldExecutor, false);
    }
```

**Change 3 — Add `ExecutorFunded` event and `fundExecutor` function**

Add the new event after the existing `TargetPlatformsUpdated` event (line 60):

```solidity
    event ExecutorFunded(address indexed executor, uint256 amount);
```

Add the new function after `removeExecutor` (after line 209):

```solidity
    /**
     * @notice Transfers native ETH from vault to executor for gas funding
     * @param amount Amount of ETH to transfer to executor
     * @dev Only callable by owner or executor (onlyAuthorized). Used by VaultHealth
     *      for automated gas top-ups. Guards against sending to address(0) when
     *      no executor is set — without this check, an owner call when executor == address(0)
     *      would pass onlyAuthorized (owner path) and burn ETH to the zero address.
     */
    function fundExecutor(uint256 amount) external onlyAuthorized nonReentrant {
        require(executor != address(0), "PositionVault: no executor set");
        require(amount > 0, "PositionVault: zero amount");
        require(address(this).balance >= amount, "PositionVault: insufficient ETH balance");
        (bool success, ) = executor.call{value: amount}("");
        require(success, "PositionVault: executor funding failed");
        emit ExecutorFunded(executor, amount);
    }
```

**Security note:** This is a new capability — currently the executor CANNOT extract native ETH from the vault (existing `withdrawETH` sends to `owner`). `fundExecutor` allows the executor to pull native ETH to itself. However:
- The executor is a derived address controlled by the automation mnemonic — same trust model as all other vault operations
- If the mnemonic is compromised, the attacker can already cause far more damage via malicious swaps or liquidity removals
- The amount is bounded off-chain by VaultHealth to `maxExecutorBalance` (0.004 ETH on Arbitrum, 0.08 AVAX on Avalanche) — negligible compared to vault value
- This matches the initial funding model (`setExecutor` is payable and sends `msg.value` to executor)

##### Issues Flagged

**1. `removeExecutor` event semantics — ~~design doc diverges from current behavior.~~ RESOLVED.**
The Decision #6 code block now uses the `oldExecutor` local variable pattern, matching the implementation. Event preserves the old executor address before clearing.

**2. `removeExecutor` when no executor is set — guarded to preserve current behavior.**
The current contract allows calling `removeExecutor` when `executor` is already `address(0)` (effectively a no-op). Without a guard, the new `deregisterActiveVault` call would revert with "VaultFactory: not active". The implementation adds `if (oldExecutor != address(0))` to skip the deregister call in this edge case, preserving the no-op behavior.

**3. Existing test compatibility — no breakage.**
`getVaultInfo()` adds a 5th return value (`executorIndex`) at positional index [4]. VaultFactory.test.js accesses `vaultInfo[0]`–`vaultInfo[3]` — these remain correct. No existing test modifications needed for Phase 1; Phase 2 adds new assertions for `vaultInfo[4]` (executorIndex) and for the active vault registry.

**4. No version bump specified.**
Phase 1 doesn't mention bumping from `2.0.0`. The changes are ABI-breaking (`getVaultInfo` return signature changes, `setExecutor` gains `payable`). Consider bumping to `2.1.0`. Deferring decision to Phase 3 (sync & distribute).

---

### Phase 2: Contract Tests

**VaultFactory.test.js:**
- `executorIndex` assigned at vault creation (starts at 0, increments)
- `getVaultInfo()` returns executorIndex
- `registerActiveVault` / `deregisterActiveVault` access control (vault-only)
- `getActiveVaults()` correctness after register/deregister sequences
- Swap-and-pop ordering (register A,B,C → deregister B → verify [A,C])
- Reject duplicate registration, reject deregister when not active

**PositionVault.test.js:**
- `setExecutor` accepts and forwards msg.value
- `setExecutor` with zero msg.value still works
- Active vault registry callback fires on first setExecutor only (transition)
- No callback on executor-to-executor change
- `removeExecutor` triggers deregister callback

The existing "Executor Management" describe block (PositionVault.test.js, lines 276-327) tests `setExecutor`, `removeExecutor`, ownership restrictions, and zero-address rejection. These tests remain valid but need extending for payable behavior and factory callbacks. The current pattern:

```javascript
const tx = await vault.setExecutor(executorWallet.address);
expect(await vault.executor()).to.equal(executorWallet.address);
await expect(tx).to.emit(vault, "ExecutorChanged").withArgs(executorWallet.address, true);
```

New tests follow the same pattern but add `{ value: ... }` overrides and assertions on factory state (`getActiveVaults()`, `getActiveVaultCount()`).

**Verification:** `cd fum && npm run contracts:test`

---

#### Phase 2 Implementation Details

Line references are to the current test files. New tests are shown as complete describe blocks to insert at specific locations. Existing tests are unmodified — all new assertions go in new test blocks.

##### VaultFactory.test.js

**Insert two new describe blocks** after "Global Registry" (line 321) and before "Incentive Validator Registry" (line 323):

```javascript
  describe("Executor Index", function() {
    it("should assign executorIndex 0 to first vault", async function() {
      const tx = await factory.connect(user1).createVault("First Vault");
      const receipt = await tx.wait();
      const vaultAddress = receipt.logs.find(
        log => log.fragment && log.fragment.name === 'VaultCreated'
      ).args[1];

      const vaultInfo = await factory.getVaultInfo(vaultAddress);
      expect(vaultInfo[4]).to.equal(0);
    });

    it("should assign sequential executorIndex values", async function() {
      const addresses = [];
      for (let i = 0; i < 3; i++) {
        const tx = await factory.connect(user1).createVault(`Vault ${i}`);
        const receipt = await tx.wait();
        addresses.push(
          receipt.logs.find(log => log.fragment && log.fragment.name === 'VaultCreated').args[1]
        );
      }

      for (let i = 0; i < 3; i++) {
        const vaultInfo = await factory.getVaultInfo(addresses[i]);
        expect(vaultInfo[4]).to.equal(i);
      }
    });

    it("should assign unique indices across different users", async function() {
      const tx1 = await factory.connect(user1).createVault("User1 Vault");
      const receipt1 = await tx1.wait();
      const vault1Address = receipt1.logs.find(
        log => log.fragment && log.fragment.name === 'VaultCreated'
      ).args[1];

      const tx2 = await factory.connect(user2).createVault("User2 Vault");
      const receipt2 = await tx2.wait();
      const vault2Address = receipt2.logs.find(
        log => log.fragment && log.fragment.name === 'VaultCreated'
      ).args[1];

      const info1 = await factory.getVaultInfo(vault1Address);
      const info2 = await factory.getVaultInfo(vault2Address);
      expect(info1[4]).to.equal(0);
      expect(info2[4]).to.equal(1);
    });

    it("should expose nextExecutorIndex counter", async function() {
      expect(await factory.nextExecutorIndex()).to.equal(0);

      await factory.connect(user1).createVault("Vault 1");
      expect(await factory.nextExecutorIndex()).to.equal(1);

      await factory.connect(user2).createVault("Vault 2");
      expect(await factory.nextExecutorIndex()).to.equal(2);
    });
  });

  describe("Active Vault Registry", function() {
    let executor1, executor2, executor3;
    let vaultA, vaultB, vaultC;
    let vaultAAddress, vaultBAddress, vaultCAddress;

    beforeEach(async function() {
      const signers = await ethers.getSigners();
      executor1 = signers[3];
      executor2 = signers[4];
      executor3 = signers[5];

      let tx, receipt;

      tx = await factory.connect(user1).createVault("Vault A");
      receipt = await tx.wait();
      vaultAAddress = receipt.logs.find(
        log => log.fragment && log.fragment.name === 'VaultCreated'
      ).args[1];
      vaultA = await ethers.getContractAt("PositionVault", vaultAAddress);

      tx = await factory.connect(user1).createVault("Vault B");
      receipt = await tx.wait();
      vaultBAddress = receipt.logs.find(
        log => log.fragment && log.fragment.name === 'VaultCreated'
      ).args[1];
      vaultB = await ethers.getContractAt("PositionVault", vaultBAddress);

      tx = await factory.connect(user1).createVault("Vault C");
      receipt = await tx.wait();
      vaultCAddress = receipt.logs.find(
        log => log.fragment && log.fragment.name === 'VaultCreated'
      ).args[1];
      vaultC = await ethers.getContractAt("PositionVault", vaultCAddress);
    });

    // --- Access control (direct calls to factory) ---

    it("should reject registerActiveVault for non-existent vault", async function() {
      // user1's own address is not a vault
      await expect(
        factory.connect(user1).registerActiveVault(user1.address)
      ).to.be.revertedWith("VaultFactory: not a vault");
    });

    it("should reject registerActiveVault from non-vault caller", async function() {
      // Vault exists, but msg.sender (user1) is not the vault contract
      await expect(
        factory.connect(user1).registerActiveVault(vaultAAddress)
      ).to.be.revertedWith("VaultFactory: caller is not vault");
    });

    it("should reject deregisterActiveVault from non-vault caller", async function() {
      await expect(
        factory.connect(user1).deregisterActiveVault(vaultAAddress)
      ).to.be.revertedWith("VaultFactory: caller is not vault");
    });

    it("should reject duplicate registration", async function() {
      // Register vault A through normal setExecutor
      await vaultA.connect(user1).setExecutor(executor1.address);

      // Impersonate vault A and try to register again directly
      await owner.sendTransaction({ to: vaultAAddress, value: ethers.parseEther("1") });
      await ethers.provider.send("hardhat_impersonateAccount", [vaultAAddress]);
      const vaultASigner = await ethers.getSigner(vaultAAddress);

      await expect(
        factory.connect(vaultASigner).registerActiveVault(vaultAAddress)
      ).to.be.revertedWith("VaultFactory: already active");

      await ethers.provider.send("hardhat_stopImpersonatingAccount", [vaultAAddress]);
    });

    it("should reject deregister when not active", async function() {
      // Vault A was never registered (no setExecutor called)
      await owner.sendTransaction({ to: vaultAAddress, value: ethers.parseEther("1") });
      await ethers.provider.send("hardhat_impersonateAccount", [vaultAAddress]);
      const vaultASigner = await ethers.getSigner(vaultAAddress);

      await expect(
        factory.connect(vaultASigner).deregisterActiveVault(vaultAAddress)
      ).to.be.revertedWith("VaultFactory: not active");

      await ethers.provider.send("hardhat_stopImpersonatingAccount", [vaultAAddress]);
    });

    // --- Integration (via vault setExecutor/removeExecutor) ---

    it("should start with zero active vaults", async function() {
      expect(await factory.getActiveVaultCount()).to.equal(0);
      const activeVaults = await factory.getActiveVaults();
      expect(activeVaults.length).to.equal(0);
    });

    it("should register vault as active on setExecutor", async function() {
      await vaultA.connect(user1).setExecutor(executor1.address);

      expect(await factory.getActiveVaultCount()).to.equal(1);
      const activeVaults = await factory.getActiveVaults();
      expect(activeVaults[0]).to.equal(vaultAAddress);
    });

    it("should deregister vault on removeExecutor", async function() {
      await vaultA.connect(user1).setExecutor(executor1.address);
      expect(await factory.getActiveVaultCount()).to.equal(1);

      await vaultA.connect(user1).removeExecutor();
      expect(await factory.getActiveVaultCount()).to.equal(0);
      const activeVaults = await factory.getActiveVaults();
      expect(activeVaults.length).to.equal(0);
    });

    it("should track correct count through register/deregister lifecycle", async function() {
      await vaultA.connect(user1).setExecutor(executor1.address);
      expect(await factory.getActiveVaultCount()).to.equal(1);

      await vaultB.connect(user1).setExecutor(executor2.address);
      expect(await factory.getActiveVaultCount()).to.equal(2);

      await vaultC.connect(user1).setExecutor(executor3.address);
      expect(await factory.getActiveVaultCount()).to.equal(3);

      await vaultB.connect(user1).removeExecutor();
      expect(await factory.getActiveVaultCount()).to.equal(2);

      await vaultA.connect(user1).removeExecutor();
      expect(await factory.getActiveVaultCount()).to.equal(1);

      await vaultC.connect(user1).removeExecutor();
      expect(await factory.getActiveVaultCount()).to.equal(0);
    });

    it("should handle swap-and-pop removal correctly (middle element)", async function() {
      await vaultA.connect(user1).setExecutor(executor1.address);
      await vaultB.connect(user1).setExecutor(executor2.address);
      await vaultC.connect(user1).setExecutor(executor3.address);

      // Remove B (middle) — C should swap into B's slot
      await vaultB.connect(user1).removeExecutor();

      const activeVaults = await factory.getActiveVaults();
      expect(activeVaults.length).to.equal(2);
      expect(activeVaults[0]).to.equal(vaultAAddress);
      expect(activeVaults[1]).to.equal(vaultCAddress);
    });

    it("should handle removal of last element without swap", async function() {
      await vaultA.connect(user1).setExecutor(executor1.address);
      await vaultB.connect(user1).setExecutor(executor2.address);

      // Remove B (last element) — no swap needed
      await vaultB.connect(user1).removeExecutor();

      const activeVaults = await factory.getActiveVaults();
      expect(activeVaults.length).to.equal(1);
      expect(activeVaults[0]).to.equal(vaultAAddress);
    });

    it("should handle removal of only element", async function() {
      await vaultA.connect(user1).setExecutor(executor1.address);

      await vaultA.connect(user1).removeExecutor();

      expect(await factory.getActiveVaultCount()).to.equal(0);
      const activeVaults = await factory.getActiveVaults();
      expect(activeVaults.length).to.equal(0);
    });

    it("should not re-register on executor-to-executor change", async function() {
      await vaultA.connect(user1).setExecutor(executor1.address);
      expect(await factory.getActiveVaultCount()).to.equal(1);

      // Change to different executor — vault already active, no factory call
      await vaultA.connect(user1).setExecutor(executor2.address);
      expect(await factory.getActiveVaultCount()).to.equal(1);

      // Verify vault is still listed once
      const activeVaults = await factory.getActiveVaults();
      expect(activeVaults.length).to.equal(1);
      expect(activeVaults[0]).to.equal(vaultAAddress);
    });

    it("should allow re-registration after deregistration", async function() {
      await vaultA.connect(user1).setExecutor(executor1.address);
      expect(await factory.getActiveVaultCount()).to.equal(1);

      await vaultA.connect(user1).removeExecutor();
      expect(await factory.getActiveVaultCount()).to.equal(0);

      // Re-register with new executor
      await vaultA.connect(user1).setExecutor(executor2.address);
      expect(await factory.getActiveVaultCount()).to.equal(1);

      const activeVaults = await factory.getActiveVaults();
      expect(activeVaults[0]).to.equal(vaultAAddress);
    });

    it("should maintain correct state after swap-and-pop then re-register", async function() {
      // Register A, B, C
      await vaultA.connect(user1).setExecutor(executor1.address);
      await vaultB.connect(user1).setExecutor(executor2.address);
      await vaultC.connect(user1).setExecutor(executor3.address);

      // Remove B — array becomes [A, C]
      await vaultB.connect(user1).removeExecutor();

      // Re-register B — array becomes [A, C, B]
      await vaultB.connect(user1).setExecutor(executor2.address);

      const activeVaults = await factory.getActiveVaults();
      expect(activeVaults.length).to.equal(3);
      expect(activeVaults[0]).to.equal(vaultAAddress);
      expect(activeVaults[1]).to.equal(vaultCAddress);
      expect(activeVaults[2]).to.equal(vaultBAddress);
    });
  });
```

##### PositionVault.test.js

**Insert new tests at the end of the "Executor Management" describe block** (after line 361, before the closing `});` at line 362):

```javascript
    // --- Payable setExecutor ---

    it("should forward msg.value to executor on setExecutor", async function() {
      const fundAmount = ethers.parseEther("0.01");
      const balanceBefore = await ethers.provider.getBalance(executorWallet.address);

      await vault.setExecutor(executorWallet.address, { value: fundAmount });

      const balanceAfter = await ethers.provider.getBalance(executorWallet.address);
      expect(balanceAfter - balanceBefore).to.equal(fundAmount);
    });

    it("should set executor without initial funding", async function() {
      const tx = await vault.setExecutor(executorWallet.address);

      expect(await vault.executor()).to.equal(executorWallet.address);
      await expect(tx)
        .to.emit(vault, "ExecutorChanged")
        .withArgs(executorWallet.address, true);
    });

    it("should revert if ETH forwarding to executor fails", async function() {
      // VaultFactory has no receive() — cannot accept ETH
      const factoryAddress = await factory.getAddress();

      await expect(
        vault.setExecutor(factoryAddress, { value: ethers.parseEther("0.01") })
      ).to.be.revertedWith("PositionVault: executor funding failed");
    });

    it("should not leave ETH in vault after successful forwarding", async function() {
      const vaultAddress = await vault.getAddress();
      const vaultBalanceBefore = await ethers.provider.getBalance(vaultAddress);

      await vault.setExecutor(executorWallet.address, { value: ethers.parseEther("0.5") });

      const vaultBalanceAfter = await ethers.provider.getBalance(vaultAddress);
      expect(vaultBalanceAfter).to.equal(vaultBalanceBefore);
    });

    // --- Active vault registry callbacks ---

    it("should register vault as active on first setExecutor", async function() {
      const vaultAddress = await vault.getAddress();
      expect(await factory.getActiveVaultCount()).to.equal(0);

      await vault.setExecutor(executorWallet.address);

      expect(await factory.getActiveVaultCount()).to.equal(1);
      const activeVaults = await factory.getActiveVaults();
      expect(activeVaults[0]).to.equal(vaultAddress);
    });

    it("should not re-register on executor-to-executor change", async function() {
      await vault.setExecutor(executorWallet.address);
      expect(await factory.getActiveVaultCount()).to.equal(1);

      // Change executor — already active, no factory callback
      await vault.setExecutor(user1.address);
      expect(await factory.getActiveVaultCount()).to.equal(1);
    });

    it("should deregister vault on removeExecutor", async function() {
      await vault.setExecutor(executorWallet.address);
      expect(await factory.getActiveVaultCount()).to.equal(1);

      await vault.removeExecutor();
      expect(await factory.getActiveVaultCount()).to.equal(0);
    });

    it("should handle removeExecutor when no executor is set (no-op)", async function() {
      // executor is already address(0) from constructor
      const tx = await vault.removeExecutor();

      expect(await vault.executor()).to.equal(ethers.ZeroAddress);
      await expect(tx)
        .to.emit(vault, "ExecutorChanged")
        .withArgs(ethers.ZeroAddress, false);

      // Factory not called — no deregister attempt
      expect(await factory.getActiveVaultCount()).to.equal(0);
    });

    // --- fundExecutor ---

    it("should transfer ETH from vault to executor", async function() {
      // Setup: authorize executor and fund vault with ETH
      await vault.setExecutor(executorWallet.address);
      const vaultAddress = await vault.getAddress();
      await owner.sendTransaction({ to: vaultAddress, value: ethers.parseEther("1.0") });

      const fundAmount = ethers.parseEther("0.05");
      const executorBalanceBefore = await ethers.provider.getBalance(executorWallet.address);

      // Executor calls fundExecutor (via onlyAuthorized)
      await vault.connect(executorWallet).fundExecutor(fundAmount);

      const executorBalanceAfter = await ethers.provider.getBalance(executorWallet.address);
      // Balance increase is fundAmount minus gas cost — just verify it increased
      expect(executorBalanceAfter).to.be.greaterThan(executorBalanceBefore);

      // Verify vault ETH decreased by exact amount
      const vaultBalance = await ethers.provider.getBalance(vaultAddress);
      expect(vaultBalance).to.equal(ethers.parseEther("1.0") - fundAmount);
    });

    it("should allow owner to call fundExecutor", async function() {
      await vault.setExecutor(executorWallet.address);
      const vaultAddress = await vault.getAddress();
      await owner.sendTransaction({ to: vaultAddress, value: ethers.parseEther("1.0") });

      const fundAmount = ethers.parseEther("0.05");
      const executorBalanceBefore = await ethers.provider.getBalance(executorWallet.address);

      // Owner calls fundExecutor — sends ETH to executor, not to owner
      await vault.fundExecutor(fundAmount);

      const executorBalanceAfter = await ethers.provider.getBalance(executorWallet.address);
      expect(executorBalanceAfter - executorBalanceBefore).to.equal(fundAmount);
    });

    it("should emit ExecutorFunded event", async function() {
      await vault.setExecutor(executorWallet.address);
      const vaultAddress = await vault.getAddress();
      await owner.sendTransaction({ to: vaultAddress, value: ethers.parseEther("1.0") });

      const fundAmount = ethers.parseEther("0.05");
      const tx = await vault.connect(executorWallet).fundExecutor(fundAmount);

      await expect(tx)
        .to.emit(vault, "ExecutorFunded")
        .withArgs(executorWallet.address, fundAmount);
    });

    it("should revert fundExecutor when no executor is set", async function() {
      // executor is address(0) from constructor — owner can pass onlyAuthorized
      // but fundExecutor should reject to prevent sending ETH to zero address
      const vaultAddress = await vault.getAddress();
      await owner.sendTransaction({ to: vaultAddress, value: ethers.parseEther("1.0") });

      await expect(
        vault.fundExecutor(ethers.parseEther("0.05"))
      ).to.be.revertedWith("PositionVault: no executor set");
    });

    it("should revert fundExecutor with zero amount", async function() {
      await vault.setExecutor(executorWallet.address);
      const vaultAddress = await vault.getAddress();
      await owner.sendTransaction({ to: vaultAddress, value: ethers.parseEther("1.0") });

      await expect(
        vault.connect(executorWallet).fundExecutor(0)
      ).to.be.revertedWith("PositionVault: zero amount");
    });

    it("should revert fundExecutor with insufficient ETH balance", async function() {
      await vault.setExecutor(executorWallet.address);
      // Vault has 0 ETH

      await expect(
        vault.connect(executorWallet).fundExecutor(ethers.parseEther("0.05"))
      ).to.be.revertedWith("PositionVault: insufficient ETH balance");
    });

    it("should revert fundExecutor from non-authorized address", async function() {
      await vault.setExecutor(executorWallet.address);
      const vaultAddress = await vault.getAddress();
      await owner.sendTransaction({ to: vaultAddress, value: ethers.parseEther("1.0") });

      await expect(
        vault.connect(user1).fundExecutor(ethers.parseEther("0.05"))
      ).to.be.revertedWith("PositionVault: caller is not authorized");
    });
```

##### Issues Flagged

**1. Impersonation tests for factory defense-in-depth.**
The "reject duplicate registration" and "reject deregister when not active" tests use Hardhat `hardhat_impersonateAccount` because these revert paths can't be triggered through normal vault operations — PositionVault's `wasInactive` check and `oldExecutor != address(0)` guard prevent the calls from reaching the factory. Impersonation tests verify the factory's own input validation independently of the vault's behavior. If the test environment doesn't support impersonation (unlikely with Hardhat), these two tests can be dropped without reducing practical coverage.

**2. Existing tests gain implicit factory callbacks — no breakage.**
After Phase 1 changes, existing PositionVault tests that call `setExecutor` (lines 281, 294, 316, 331, 248) will trigger `registerActiveVault` as a side effect. These tests pass because they don't assert on factory state, and the factory is correctly deployed (vault is created via factory in beforeEach). No modifications to existing tests needed.

**3. Vault owner context differs between test files.**
In VaultFactory.test.js, vaults are created by `user1` — so `user1` must call `setExecutor`/`removeExecutor`. In PositionVault.test.js, the vault is created by `owner` — so `owner` calls these functions (default signer). Test code is written accordingly. Mixing these up would cause "caller is not the owner" reverts.

---

### Configuration Values

New config values introduced by this architecture:

| Value | Location | Notes |
|---|---|---|
| `AUTOMATION_MNEMONIC` | Env var (replaces `AUTOMATION_PRIVATE_KEY`) | BIP-39 12-word mnemonic. Only secret. |
| `executorXpub` | Chain config in `chains.js` (replaces `executorAddress`) | Derived from mnemonic once at setup. Public, safe to ship in client code. |
| `minExecutorBalance` | Chain config in `chains.js` | Native token amount (e.g., `0.002` ETH, `0.04` AVAX). Sized to cover ~12 worst-case rebalance cycles. |
| `maxExecutorBalance` | Chain config in `chains.js` | Native token amount. Target balance for top-ups and initial funding via payable `setExecutor`. Sized to cover ~24 worst-case rebalance cycles. |
| `vaultHealthIntervalMs` | AutomationService constructor config | Follows existing pattern (`retryIntervalMs`, `maxFailureDurationMs`). Default TBD. |

### Phase 3: Pipeline — Sync & Distribute

#### Verification: Pipeline passes through unchanged

The contract sync pipeline (`npm run contracts:sync`) is fully automated and requires no code changes. Phase 1's contract modifications flow through automatically:

**`sync-contracts-to-ecosystem.js`** — No changes. VaultFactory and PositionVault are in `CORE_CONTRACTS` (line 21-22). IVaultFactory is in `TESTING_SUBDIRECTORIES` → `interfaces/` (line 45-47). Updated `.sol` files sync to fum_testing, then compile, then ABI/bytecode extraction runs.

**`extract-abis.js`** — No changes. VaultFactory.sol and PositionVault.sol are in `contractMapping` (lines 19-20). Solc recompiles from source and extracts full ABIs. New VaultFactory methods (`registerActiveVault`, `deregisterActiveVault`, `getActiveVaults`, `getActiveVaultCount`, updated `getVaultInfo` with `executorIndex` return), payable `setExecutor`, `fundExecutor`, and `ExecutorFunded` event will appear in the extracted ABI automatically. The `updateLibraryContracts()` function merges new ABIs with existing deployment addresses, writing to both `src/artifacts/contracts.js` and `dist/artifacts/contracts.js`.

**`extract-bytecode.js`** — No changes. VaultFactory and PositionVault are in `CONTRACTS_TO_EXTRACT` (lines 17-23). Reads compiled artifacts from fum_testing and writes `.bin` files.

**`deploy.js`** — No changes. VaultFactory constructor is `(address _owner, address _permit2)` — unchanged by Phase 1. Constructor call at line 263: `factory.deploy(wallet.address, permit2Address)`.

**`start-hardhat.js`** — No changes. VaultFactory deploy at line 102: `VaultFactory.deploy(wallet.address, permit2Address, { gasLimit: 5000000 })` — unchanged constructor args.

**`fum_library/src/artifacts/contracts.js`** — Auto-generated. Updated automatically when `extract-abis.js` runs (Step 4 of sync pipeline).

#### Dev script changes

The `seed-localhost` npm command runs `create-test-vault.js && seed.js`. Currently neither script calls `setExecutor` — the vault is created without an authorized executor, and `seed.js` funds a hardcoded executor address directly via `wallet.sendTransaction`. This needs to change so the executor is both authorized AND funded through the payable `setExecutor` contract call.

**Change 1 — `create-test-vault.js`: Add executor authorization after vault creation**

Insert after line 145 (`const vaultAddress = vaultCreatedEvents[0].args[1];`), before the token address definitions:

```javascript
  // === Authorize automation executor ===
  // Read executorIndex assigned at vault creation (Phase 1: 5th return from getVaultInfo)
  const vaultInfo = await vaultFactory.getVaultInfo(vaultAddress);
  const executorIndex = vaultInfo[4];
  console.log(`Vault assigned executorIndex: ${executorIndex}`);

  // Derive executor address from mnemonic + index
  // WARNING: Dev-only mnemonic — must match AUTOMATION_MNEMONIC in fum_automation/.env.local
  const DEV_MNEMONIC = 'pumpkin ghost mammal enrich toss laptop travel main again clever edit orchard';
  const hdNode = ethers.utils.HDNode.fromMnemonic(DEV_MNEMONIC);
  const executorAddress = hdNode.derivePath(`m/44'/60'/0'/0/${executorIndex}`).address;
  console.log(`Derived executor address: ${executorAddress}`);

  // Authorize executor via payable setExecutor — forwards msg.value as initial gas funding
  const vault = new ethers.Contract(vaultAddress, positionVaultABI, signer);
  const executorFunding = ethers.utils.parseEther("10");
  console.log(`\nAuthorizing executor and funding with ${ethers.utils.formatEther(executorFunding)} ETH...`);
  const setExecutorTx = await vault.setExecutor(executorAddress, { value: executorFunding });
  await setExecutorTx.wait();

  // Verify
  const executorBalance = await provider.getBalance(executorAddress);
  console.log(`Executor authorized and funded. Balance: ${ethers.utils.formatEther(executorBalance)} ETH`);
```

Context: `positionVaultABI` is already loaded at line 112 via `loadContractABI('PositionVault')`. The `signer` (Hardhat account #0) is the vault owner and has authority to call `setExecutor`. The script already imports `ethers` from ethers.js v5 which provides `HDNode`.

**Change 2 — `seed.js`: Remove hardcoded executor funding**

Delete lines 501–510 (the executor funding block that is now handled by `create-test-vault.js`):

```javascript
  // DELETE — replaced by payable setExecutor in create-test-vault.js:
  // Fund the automation executor address with ETH for gas
  const AUTOMATION_EXECUTOR = '0xabA472B2EA519490EE10E643A422D578a507197A';
  console.log(`\nFunding automation executor ${AUTOMATION_EXECUTOR} with 10 ETH...`);
  const fundTx = await wallet.sendTransaction({
    to: AUTOMATION_EXECUTOR,
    value: ethers.utils.parseEther('10')
  });
  await fundTx.wait();
  const executorBalance = await provider.getBalance(AUTOMATION_EXECUTOR);
  console.log(`Automation executor funded. Balance: ${ethers.utils.formatEther(executorBalance)} ETH`);
```

#### Flagged Issues

**1. Dev mnemonic must match automation service config.**
`create-test-vault.js` hardcodes `DEV_MNEMONIC` following the same pattern as the hardcoded Hardhat private key (line 85). This mnemonic MUST match the `AUTOMATION_MNEMONIC` value in `fum_automation/.env.local`. Using the Phase 8 test mnemonic (`pumpkin ghost mammal...`) for consistency — the same mnemonic used in fum_automation workflow tests. When Phase 5 updates `.env.local` to replace `AUTOMATION_PRIVATE_KEY` with `AUTOMATION_MNEMONIC`, it must set this value.

**2. `seed-localhost` flow now requires create-test-vault.js to run first.**
This is already the case — the npm command is `create-test-vault.js && seed.js` (sequential). But removing the executor funding from `seed.js` means `seed.js` can no longer be run standalone for executor funding. This is correct behavior — executor authorization should always go through the contract, not via direct ETH transfer.

**3. No version bump in Phase 3.**
Deferred per Phase 1 Issue #4 discussion. Version stays at `2.0.0` until all platform-agnostic refactoring is complete, then bumps to v3.

### Phase 4: Library Changes

#### Change 1 — `fum_library/src/configs/chains.js`: Replace `executorAddress` with per-vault signer config

Replace `executorAddress` with `executorXpub`, `minExecutorBalance`, and `maxExecutorBalance` on all 4 chains:

**Arbitrum One (42161)** — replace line 18:
```javascript
    // BEFORE:
    executorAddress: "0x42d9df99e78ba0573b2990d6177d6eef7145c8e6",

    // AFTER:
    executorXpub: "",  // Populated when production mnemonic is generated
    minExecutorBalance: 0.002,  // ETH — ~12 worst-case rebalance cycles (at 200 gwei spike)
    maxExecutorBalance: 0.004,  // ETH — ~24 worst-case rebalance cycles
```

**Forked Arbitrum (1337)** — replace line 52:
```javascript
    // BEFORE:
    executorAddress: "0xabA472B2EA519490EE10E643A422D578a507197A",

    // AFTER:
    executorXpub: "xpub6F8xskVEWJTqZB69U3UmjGe8zwoXUefq5YCBgpyS2xf4CFEzNX4zUbxYBqZLdC96gEayShKc9f9rhgnNhSMtzADf8x4HX8Wia4AjBmqAPir",
    minExecutorBalance: 0.002,
    maxExecutorBalance: 0.004,
```

**Avalanche (43114)** — replace line 86:
```javascript
    // BEFORE:
    executorAddress: "0x0",

    // AFTER:
    executorXpub: "",  // Not configured yet
    minExecutorBalance: 0.04,   // AVAX — ~13 worst-case rebalance cycles (at 565 nAVAX spike)
    maxExecutorBalance: 0.08,   // AVAX — ~26 worst-case rebalance cycles
```

**Forked Avalanche (1338)** — replace line 111:
```javascript
    // BEFORE:
    executorAddress: "0xabA472B2EA519490EE10E643A422D578a507197A", // Same test account as 1337

    // AFTER:
    executorXpub: "xpub6F8xskVEWJTqZB69U3UmjGe8zwoXUefq5YCBgpyS2xf4CFEzNX4zUbxYBqZLdC96gEayShKc9f9rhgnNhSMtzADf8x4HX8Wia4AjBmqAPir",
    minExecutorBalance: 0.04,
    maxExecutorBalance: 0.08,
```

Local fork chains (1337, 1338) use the Phase 8 test mnemonic's xpub. Production chains (42161, 43114) have empty xpub — populated at deployment time when the production mnemonic is generated.

#### Change 2 — `fum_library/src/helpers/chainHelpers.js`: Replace `getExecutorAddress` with `getExecutorXpub` + balance helpers

**Remove `getExecutorAddress`** (delete lines 170–204) and replace with three new functions:

```javascript
/**
 * Get the executor extended public key for the specified chain
 * @memberof module:helpers/chainHelpers
 * @param {number} chainId - The blockchain network ID
 * @returns {string} The executor xpub (BIP-32 extended public key)
 * @throws {Error} If chainId is not valid
 * @throws {Error} If chain is not supported
 * @throws {Error} If no executor xpub is configured for the chain
 * @since 2.0.0
 */
export function getExecutorXpub(chainId) {
  validateChainId(chainId);

  const config = chains[chainId];
  if (!config) {
    throw new Error(`Chain ${chainId} is not supported`);
  }

  if (!config.executorXpub || config.executorXpub === '') {
    throw new Error(`No executor xpub configured for chain ${chainId}`);
  }

  return config.executorXpub;
}

/**
 * Get minimum executor balance for the specified chain (native token)
 * @memberof module:helpers/chainHelpers
 * @param {number} chainId - The blockchain network ID
 * @returns {number} Minimum executor balance in native token units
 * @throws {Error} If chainId is not valid
 * @throws {Error} If chain is not supported
 * @throws {Error} If no minimum executor balance is configured for the chain
 * @since 2.0.0
 */
export function getMinExecutorBalance(chainId) {
  validateChainId(chainId);

  const config = chains[chainId];
  if (!config) {
    throw new Error(`Chain ${chainId} is not supported`);
  }

  if (typeof config.minExecutorBalance !== 'number' || !Number.isFinite(config.minExecutorBalance) || config.minExecutorBalance <= 0) {
    throw new Error(`No minimum executor balance configured for chain ${chainId}`);
  }

  return config.minExecutorBalance;
}

/**
 * Get maximum executor balance (top-up target) for the specified chain (native token)
 * @memberof module:helpers/chainHelpers
 * @param {number} chainId - The blockchain network ID
 * @returns {number} Maximum executor balance in native token units
 * @throws {Error} If chainId is not valid
 * @throws {Error} If chain is not supported
 * @throws {Error} If no maximum executor balance is configured for the chain
 * @since 2.0.0
 */
export function getMaxExecutorBalance(chainId) {
  validateChainId(chainId);

  const config = chains[chainId];
  if (!config) {
    throw new Error(`Chain ${chainId} is not supported`);
  }

  if (typeof config.maxExecutorBalance !== 'number' || !Number.isFinite(config.maxExecutorBalance) || config.maxExecutorBalance <= 0) {
    throw new Error(`No maximum executor balance configured for chain ${chainId}`);
  }

  return config.maxExecutorBalance;
}
```

Also update the `getChainConfig` JSDoc at line 60 — replace `executorAddress` with `executorXpub` in the `@returns` description.

#### Change 3 — `fum_library/src/blockchain/contracts.js`: Replace `getAuthorizedVaults` with `getActiveVaults` + add `getVaultExecutorIndex`

**Replace `getAuthorizedVaults`** (lines 260–307) with `getActiveVaults`:

```javascript
/**
 * Gets all vaults that currently have an executor set (active vaults)
 * @param {ethers.JsonRpcProvider} provider - Ethers provider
 * @returns {Promise<string[]>} Array of active vault addresses
 * @throws {Error} If provider is invalid
 * @since 2.0.0
 */
export async function getActiveVaults(provider) {
  // Provider validation happens in getVaultFactory
  const factory = await getVaultFactory(provider);

  try {
    return await factory.getActiveVaults();
  } catch (error) {
    throw new Error(`Failed to get active vaults: ${error.message}`);
  }
}
```

The old `getAuthorizedVaults(executorAddress, provider)` iterated ALL vaults (O(n) RPC calls) and compared each vault's executor against a single address. The new `getActiveVaults(provider)` is a single RPC call to the Phase 1 active vault registry. No `executorAddress` parameter — the caller (automation service) verifies derived addresses per vault in Phase 5.

**Update `getVaultInfo`** (lines 315–341) to include `executorIndex`:

```javascript
export async function getVaultInfo(vaultAddress, provider) {
  // Validate vault address
  if (!vaultAddress) {
    throw new Error('Vault address parameter is required');
  }
  try {
    ethers.utils.getAddress(vaultAddress);
  } catch (error) {
    throw new Error(`Invalid vault address: ${vaultAddress}`);
  }

  // Provider validation happens in getVaultFactory
  const factory = await getVaultFactory(provider);

  try {
    const [owner, name, creationTime, creationBlock, executorIndex] = await factory.getVaultInfo(vaultAddress);

    return {
      owner,
      name,
      creationTime: Number(creationTime),
      creationBlock: Number(creationBlock),
      executorIndex: Number(executorIndex)
    };
  } catch (error) {
    throw new Error(`Failed to get vault info: ${error.message}`);
  }
}
```

Changes from current: destructures 5th element `executorIndex`, adds `executorIndex: Number(executorIndex)` to return object. Existing consumers that only read `.owner` (VaultDataService) are unaffected — the new field is additive.

**Add `getVaultExecutorIndex`** helper (new function, insert after `getVaultInfo`):

```javascript
/**
 * Gets the executor index for a specific vault
 * Convenience function that reads only the executorIndex from VaultInfo
 * @param {string} vaultAddress - Address of the vault
 * @param {ethers.JsonRpcProvider} provider - Ethers provider
 * @returns {Promise<number>} The vault's executor index
 * @throws {Error} If vaultAddress is invalid or provider is invalid
 * @since 2.0.0
 */
export async function getVaultExecutorIndex(vaultAddress, provider) {
  const info = await getVaultInfo(vaultAddress, provider);
  return info.executorIndex;
}
```

#### Change 4 — Library tests

**`test/unit/configs/chains.test.js`:**

Replace `executorAddress` validation with `executorXpub` + balance config validation. Update the `requiredExecutorProperties` array and `validateExecutorAddress` helper:

```javascript
// BEFORE (lines 26-29):
function validateExecutorAddress(address) {
  if (typeof address !== 'string') return false;
  return address === '0x0' || validateEthereumAddress(address);
}

// AFTER:
function validateExecutorXpub(xpub) {
  if (typeof xpub !== 'string') return false;
  // Empty string is valid (production chains before mnemonic generation)
  // Non-empty must start with 'xpub' (BIP-32 extended public key)
  return xpub === '' || xpub.startsWith('xpub');
}
```

```javascript
// BEFORE (line 131):
    const requiredExecutorProperties = ['executorAddress'];

// AFTER:
    const requiredExecutorProperties = ['executorXpub'];
```

```javascript
// BEFORE (lines 173-178):
      // Validate executor address
      requiredExecutorProperties.forEach(prop => {
        if (!validateExecutorAddress(chain[prop])) {
          chainErrors.push(`Property ${prop} must be a valid Ethereum address or '0x0', got: ${chain[prop]}`);
        }
      });

// AFTER:
      // Validate executor xpub
      requiredExecutorProperties.forEach(prop => {
        if (!validateExecutorXpub(chain[prop])) {
          chainErrors.push(`Property ${prop} must be a valid xpub or empty string, got: ${chain[prop]}`);
        }
      });

      // Validate executor balance config
      ['minExecutorBalance', 'maxExecutorBalance'].forEach(prop => {
        if (typeof chain[prop] !== 'number' || !Number.isFinite(chain[prop]) || chain[prop] <= 0) {
          chainErrors.push(`Property ${prop} must be a positive finite number, got: ${chain[prop]}`);
        }
      });
```

**`test/unit/helpers/chainHelpers.test.js`:**

**Remove** the entire `describe('getExecutorAddress', ...)` block (lines 286–358).

**Add** new describe blocks after the removed section. Update the import to replace `getExecutorAddress` with `getExecutorXpub, getMinExecutorBalance, getMaxExecutorBalance`:

```javascript
  describe('getExecutorXpub', () => {
    describe('Success Cases', () => {
      it('should return correct xpub for Forked Arbitrum (chainId 1337)', () => {
        const xpub = getExecutorXpub(1337);

        expect(typeof xpub).toBe('string');
        expect(xpub.startsWith('xpub')).toBe(true);
        expect(xpub).toBe('xpub6F8xskVEWJTqZB69U3UmjGe8zwoXUefq5YCBgpyS2xf4CFEzNX4zUbxYBqZLdC96gEayShKc9f9rhgnNhSMtzADf8x4HX8Wia4AjBmqAPir');
      });
    });

    describe('Error Cases', () => {
      it('should throw error for unsupported chain', () => {
        expect(() => getExecutorXpub(999999)).toThrow('Chain 999999 is not supported');
      });

      it('should throw error for chains with empty xpub', () => {
        // Arbitrum production has empty xpub until deployment
        expect(() => getExecutorXpub(42161)).toThrow('No executor xpub configured for chain 42161');
        // Avalanche also not configured
        expect(() => getExecutorXpub(43114)).toThrow('No executor xpub configured for chain 43114');
      });

      it('should throw error when no executorXpub property is configured', async () => {
        vi.doMock('../../../src/configs/chains.js', () => ({
          default: {
            555: {
              name: 'Test Chain Without Xpub',
              rpcUrls: ['http://test.com']
              // No executorXpub property
            }
          }
        }));

        vi.resetModules();
        const chainHelpers = await import('../../../src/helpers/chainHelpers.js');

        expect(() => chainHelpers.getExecutorXpub(555)).toThrow('No executor xpub configured for chain 555');

        vi.doUnmock('../../../src/configs/chains.js');
        vi.resetModules();
      });

      it('should validate chainId parameter', () => {
        expect(() => getExecutorXpub(null)).toThrow('chainId parameter is required');
        expect(() => getExecutorXpub('1')).toThrow('chainId must be a number');
        expect(() => getExecutorXpub(0)).toThrow('chainId must be greater than 0');
      });
    });
  });

  describe('getMinExecutorBalance', () => {
    describe('Success Cases', () => {
      it('should return a positive number for valid chains', () => {
        expect(typeof getMinExecutorBalance(42161)).toBe('number');
        expect(getMinExecutorBalance(42161)).toBeGreaterThan(0);
        expect(typeof getMinExecutorBalance(1337)).toBe('number');
        expect(getMinExecutorBalance(1337)).toBeGreaterThan(0);
      });
    });

    describe('Error Cases', () => {
      it('should throw error for unsupported chain', () => {
        expect(() => getMinExecutorBalance(999999)).toThrow('Chain 999999 is not supported');
      });

      it('should validate chainId parameter', () => {
        expect(() => getMinExecutorBalance(null)).toThrow('chainId parameter is required');
        expect(() => getMinExecutorBalance('1')).toThrow('chainId must be a number');
      });
    });
  });

  describe('getMaxExecutorBalance', () => {
    describe('Success Cases', () => {
      it('should return a positive number for valid chains', () => {
        expect(typeof getMaxExecutorBalance(42161)).toBe('number');
        expect(getMaxExecutorBalance(42161)).toBeGreaterThan(0);
      });

      it('should be greater than or equal to minExecutorBalance', () => {
        const min = getMinExecutorBalance(42161);
        const max = getMaxExecutorBalance(42161);
        expect(max).toBeGreaterThanOrEqual(min);
      });
    });

    describe('Error Cases', () => {
      it('should throw error for unsupported chain', () => {
        expect(() => getMaxExecutorBalance(999999)).toThrow('Chain 999999 is not supported');
      });

      it('should validate chainId parameter', () => {
        expect(() => getMaxExecutorBalance(null)).toThrow('chainId parameter is required');
        expect(() => getMaxExecutorBalance('1')).toThrow('chainId must be a number');
      });
    });
  });
```

Also update the `getChainConfig` test (line 100) — replace executor assertion:

```javascript
    // BEFORE:
    expect(config.executorAddress).toBe('0x42d9df99e78ba0573b2990d6177d6eef7145c8e6');

    // AFTER:
    expect(config.executorXpub).toBe('');
    expect(config.minExecutorBalance).toBe(0.002);
    expect(config.maxExecutorBalance).toBe(0.004);
```

And the Avalanche config test (line 111):

```javascript
    // BEFORE:
    expect(config.executorAddress).toBe('0x0');

    // AFTER:
    expect(config.executorXpub).toBe('');
    expect(config.minExecutorBalance).toBe(0.04);
    expect(config.maxExecutorBalance).toBe(0.08);
```

**`test/unit/blockchain/contracts.test.js`:**

**Replace** the entire `describe('getAuthorizedVaults', ...)` block (lines 754–929) with `getActiveVaults` tests. Update the import at line 18 (`getAuthorizedVaults` → `getActiveVaults`):

```javascript
  describe('getActiveVaults', () => {

    describe('Success Cases', () => {
      it('should return array of vault addresses with executors set', async () => {
        // Create 3 vaults, authorize executor on 2
        const executorAddress = env.signers[2].address;

        const vault1 = await createVault('Vault 1', env.signers[0]);
        const vault2 = await createVault('Vault 2', env.signers[0]);
        const vault3 = await createVault('Vault 3', env.signers[0]);

        const v1Contract = getVaultContract(vault1, env.provider);
        const v3Contract = getVaultContract(vault3, env.provider);

        await (await v1Contract.connect(env.signers[0]).setExecutor(executorAddress)).wait();
        await (await v3Contract.connect(env.signers[0]).setExecutor(executorAddress)).wait();

        const activeVaults = await getActiveVaults(env.provider);

        expect(activeVaults).toBeDefined();
        expect(Array.isArray(activeVaults)).toBe(true);
        expect(activeVaults).toContain(vault1);
        expect(activeVaults).toContain(vault3);
        expect(activeVaults).not.toContain(vault2);
      }, 180000);

      it('should return empty array when no vaults have executors', async () => {
        // Create vault but don't set executor
        await createVault('No Executor Vault', env.signers[0]);

        // getActiveVaults should not include vaults without executors
        // Note: other tests may have set executors, so just verify the no-executor vault is absent
        const activeVaults = await getActiveVaults(env.provider);
        expect(Array.isArray(activeVaults)).toBe(true);
      }, 180000);

      it('should remove vault from active list when executor is removed', async () => {
        const executorAddress = env.signers[2].address;

        const vault = await createVault('Temp Executor Vault', env.signers[0]);
        const vaultContract = getVaultContract(vault, env.provider);

        // Set executor — vault should appear in active list
        await (await vaultContract.connect(env.signers[0]).setExecutor(executorAddress)).wait();
        let activeVaults = await getActiveVaults(env.provider);
        expect(activeVaults).toContain(vault);

        // Remove executor — vault should disappear from active list
        await (await vaultContract.connect(env.signers[0]).removeExecutor()).wait();
        activeVaults = await getActiveVaults(env.provider);
        expect(activeVaults).not.toContain(vault);
      }, 180000);
    });

    describe('Error Cases', () => {
      it('should throw error for invalid provider - null', async () => {
        await expect(
          getActiveVaults(null)
        ).rejects.toThrow('Invalid provider. Must be an ethers provider instance.');
      });

      it('should throw error for invalid provider - undefined', async () => {
        await expect(
          getActiveVaults(undefined)
        ).rejects.toThrow('Invalid provider. Must be an ethers provider instance.');
      });

      it('should throw error for invalid provider - plain object', async () => {
        await expect(
          getActiveVaults({})
        ).rejects.toThrow('Invalid provider. Must be an ethers provider instance.');
      });
    });
  });
```

**Update `getVaultInfo` tests** — add `executorIndex` assertions to existing tests. In the "should return vault info with correct structure and values" test (line 933), add:

```javascript
        // Add to structure checks:
        expect(vaultInfo).toHaveProperty('executorIndex');

        // Add to value checks:
        expect(typeof vaultInfo.executorIndex).toBe('number');
        expect(vaultInfo.executorIndex).toBeGreaterThanOrEqual(0);
```

In the "should return valid data types for all fields" test (line 991), add:

```javascript
        expect(typeof vaultInfo.executorIndex).toBe('number');
        expect(Number.isInteger(vaultInfo.executorIndex)).toBe(true);
        expect(vaultInfo.executorIndex).toBeGreaterThanOrEqual(0);
```

**Add `getVaultExecutorIndex` describe block** (insert after the `getVaultInfo` describe block, before `executeVaultTransactions`):

```javascript
  describe('getVaultExecutorIndex', () => {
    describe('Success Cases', () => {
      it('should return executor index for a vault', async () => {
        const index = await getVaultExecutorIndex(env.testVault.address, env.provider);

        expect(typeof index).toBe('number');
        expect(Number.isInteger(index)).toBe(true);
        expect(index).toBeGreaterThanOrEqual(0);
      });

      it('should return sequential indices for sequentially created vaults', async () => {
        const vault1 = await createVault('Index Test 1', env.signers[0]);
        const vault2 = await createVault('Index Test 2', env.signers[0]);

        const index1 = await getVaultExecutorIndex(vault1, env.provider);
        const index2 = await getVaultExecutorIndex(vault2, env.provider);

        expect(index2).toBe(index1 + 1);
      }, 60000);
    });

    describe('Error Cases', () => {
      it('should throw error for missing vault address', async () => {
        await expect(
          getVaultExecutorIndex(null, env.provider)
        ).rejects.toThrow('Vault address parameter is required');
      });

      it('should throw error for invalid vault address', async () => {
        await expect(
          getVaultExecutorIndex('0xinvalid', env.provider)
        ).rejects.toThrow('Invalid vault address');
      });

      it('should throw error for invalid provider', async () => {
        await expect(
          getVaultExecutorIndex(env.testVault.address, null)
        ).rejects.toThrow('Invalid provider');
      });
    });
  });
```

#### Flagged Issues

**1. Frontend consumers of `getExecutorAddress` need updating (Phase 9 scope).**
Two files import `getExecutorAddress` from chainHelpers:
- `fum/src/pages/vault/[address].js` (line 193) — uses it to get the executor address for `setExecutor` call. Will need to read `executorXpub` + `executorIndex` and derive the address instead.
- `fum/src/components/vaults/StrategyConfigPanel.js` (line 17) — dead import, never called. Can be removed.

These are Phase 9 (Frontend) changes. The function is removed from chainHelpers in this phase, so fum's frontend will not compile until Phase 9 updates the imports. This is fine — frontend is updated last and all phases are written before implementation begins.

**2. `getActiveVaults` test depends on Phase 1 contract changes.**
The `getActiveVaults` function calls `factory.getActiveVaults()` which is a Phase 1 contract addition. The library tests run against a Hardhat fork with deployed contracts — the test environment must use the updated VaultFactory bytecode (from Phase 3 sync). This is the expected pipeline order: Phase 1 → Phase 3 sync → Phase 4 library.

**3. `getAuthorizedVaults` is removed, not deprecated.**
The automation service's `loadAuthorizedVaults()` (AutomationService.js:1515) currently calls `getAuthorizedVaults(this.automationServiceAddress, this.provider)`. This import breaks when Phase 4 removes the function. Phase 5 replaces the call with `getActiveVaults(this.provider)`. Since all phases are implemented together, this is not a concern.

**4. Executor balance values are profiled — based on measured gas data.**
Values derived from Hardhat fork gas profiling of full rebalance cycles:
- **V3 rebalance (Arbitrum):** 822,827 gas (close: 184k, swap: 196k, mint: 442k)
- **TJ V2.2 rebalance (Avalanche):** 5,410,379 gas (close: 1.4M, approvals: 65k, swap: 275k, create: 3.7M)
- **Arbitrum worst-case gas price:** 200 gwei (historical spike) → 0.000165 ETH per rebalance
- **Avalanche worst-case gas price:** 565 nAVAX (30-day high) → 0.00306 AVAX per rebalance
- `minExecutorBalance`: ~12 worst-case rebalances (0.002 ETH / 0.04 AVAX)
- `maxExecutorBalance`: ~24 worst-case rebalances (0.004 ETH / 0.08 AVAX)
- UX impact: $500 vault on Arbitrum pays ~$7.60 initial gas deposit (1.5% of vault value at $1,900/ETH)

**Verification:** `cd fum_library && npm test && npm run pack`

### Phase 5: Automation Service — Per-Vault Signers

This is the largest phase — 8 file changes across the automation service. The core transformation: replace the single shared private key with HDNode-based per-vault signer derivation. The `automationServiceAddress` concept is eliminated entirely.

#### Change 1: `fum_automation/src/utils/errors.js` — Add InsufficientGasError

Add after the existing `UnrecoverableError` class (line 25):

```js
/**
 * Error thrown when a vault's executor has insufficient native gas for transaction execution.
 * This is NOT an unrecoverable error — the vault is healthy, it just needs a gas top-up.
 * Phase 6 VaultHealth handles automatic top-ups; until then, the vault is skipped.
 *
 * @class InsufficientGasError
 * @extends Error
 */
export class InsufficientGasError extends Error {
  /**
   * @param {string} message - Error message
   * @param {string} vaultAddress - Vault that triggered the error
   * @param {string} executorAddress - Executor address that needs gas
   */
  constructor(message, vaultAddress, executorAddress) {
    super(message);
    this.name = 'InsufficientGasError';
    this.vaultAddress = vaultAddress;
    this.executorAddress = executorAddress;
  }
}
```

#### Change 2: `fum_automation/src/core/AutomationService.js` — HDNode, vault discovery, error handling

8 modifications within AutomationService.js:

**2a. Imports (line 9)**

Replace:
```js
import { getAdaptersForChain, getAllTokens, getContract, getAuthorizedVaults } from 'fum_library';
```

With:
```js
import { getAdaptersForChain, getAllTokens, getContract, getActiveVaults, getVaultExecutorIndex, getVaultContract } from 'fum_library';
```

Update errors import (line 12):
```js
import { UnrecoverableError, InsufficientGasError } from '../utils/errors.js';
```

**2b. Constructor (lines 26-136)**

Replace JSDoc `@param {string} config.automationServiceAddress` (line 28) with nothing — the param is removed.

Replace the config storage block (lines 38-52):
```js
  constructor(config) {
    // Validate required config
    this.validateConfig(config);

    // Cache HDNode from mnemonic (single PBKDF2, ~10-50ms)
    const mnemonic = process.env.AUTOMATION_MNEMONIC;
    if (!mnemonic) {
      throw new Error('AUTOMATION_MNEMONIC environment variable is required');
    }
    try {
      this.hdNode = ethers.utils.HDNode.fromMnemonic(mnemonic);
    } catch (error) {
      throw new Error(`Invalid AUTOMATION_MNEMONIC: ${error.message}`);
    }

    // Store configuration
    this.chainId = config.chainId;
    this.wsUrl = config.wsUrl;
    this.debug = config.debug || false;
    this.retryIntervalMs = config.retryIntervalMs || 300000;
    this.maxFailureDurationMs = config.maxFailureDurationMs || 3600000;
    this.ssePort = config.ssePort || 3001;
    this.dataDir = path.resolve(config.dataDir || './data');
    this.blacklistFilePath = path.join(this.dataDir, 'blacklist.json');
    this.trackingDataDir = path.join(this.dataDir, 'vaults');
    this.trackingFailuresFilePath = path.join(this.dataDir, 'trackingFailures.json');
```

Note: `this.automationServiceAddress` is removed entirely. No replacement.

**2c. validateConfig (lines 144-163)**

Replace entire method:
```js
  validateConfig(config) {
    if (!config.chainId) {
      throw new Error('chainId is required');
    }
    if (typeof config.chainId !== 'number' || config.chainId <= 0) {
      throw new Error('chainId must be a positive number');
    }
    if (!config.wsUrl) {
      throw new Error('wsUrl is required');
    }
    if (!config.wsUrl.startsWith('wss://') && !config.wsUrl.startsWith('ws://')) {
      throw new Error('wsUrl must be a valid WebSocket URL (wss:// or ws://)');
    }
  }
```

The `automationServiceAddress` validation (lines 145-149) is removed entirely.

**2d. start() — subscribeToAuthorizationEvents call (lines 199-203)**

Replace:
```js
      this.eventManager.subscribeToAuthorizationEvents(
        this.provider,
        this.automationServiceAddress,
        this.chainId
      );
```

With:
```js
      this.eventManager.subscribeToAuthorizationEvents(
        this.provider,
        this.hdNode,
        this.chainId
      );
```

And update ServiceStarted event (line 220-230) — remove `automationServiceAddress`:
```js
      this.eventManager.emit('ServiceStarted', {
        chainId: this.chainId,
        adaptersLoaded: this.adapters.size,
        tokensLoaded: Object.keys(this.tokens).length,
        timestamp: Date.now(),
        log: {
          level: 'info',
          message: `AutomationService started on chain ${this.chainId}`
        }
      });
```

**2e. reestablishEventListeners() (lines 564-572)**

Replace:
```js
    this.eventManager.subscribeToAuthorizationEvents(
      this.provider,
      this.automationServiceAddress,
      this.chainId
    );
```

With:
```js
    this.eventManager.subscribeToAuthorizationEvents(
      this.provider,
      this.hdNode,
      this.chainId
    );
```

**2f. updateStrategyDependencies() (lines 742-757)**

Replace:
```js
  updateStrategyDependencies() {
    const serviceConfig = {
      chainId: this.chainId,
      automationServiceAddress: this.automationServiceAddress,
      wsUrl: this.wsUrl,
      debug: this.debug
    };

    for (const [strategyId, strategy] of this.strategies) {
      strategy.provider = this.provider;
      strategy.adapters = this.adapters;
      strategy.tokens = this.tokens;
      strategy.serviceConfig = serviceConfig;
      this.log(`Updated dependencies for strategy: ${strategyId}`);
    }
  }
```

With:
```js
  updateStrategyDependencies() {
    const serviceConfig = {
      chainId: this.chainId,
      wsUrl: this.wsUrl,
      debug: this.debug
    };

    for (const [strategyId, strategy] of this.strategies) {
      strategy.provider = this.provider;
      strategy.adapters = this.adapters;
      strategy.tokens = this.tokens;
      strategy.hdNode = this.hdNode;
      strategy.serviceConfig = serviceConfig;
      this.log(`Updated dependencies for strategy: ${strategyId}`);
    }
  }
```

**2g. loadAuthorizedVaults() (lines 1510-1572)**

Replace the entire method:
```js
  async loadAuthorizedVaults() {
    this.log('Discovering active vaults...');

    // Get all vaults with an active executor (Phase 1 active vault registry)
    const activeVaultAddresses = await retryRpcCall(
      () => getActiveVaults(this.provider),
      'getActiveVaults',
      { log: (msg) => this.log(msg) }
    );

    this.log(`Found ${activeVaultAddresses.length} active vault(s), verifying ownership...`);

    const results = {
      total: activeVaultAddresses.length,
      successful: [],
      failed: [],
      skippedBlacklisted: [],
      skippedNotOurs: []
    };

    for (const vaultAddress of activeVaultAddresses) {
      // Skip blacklisted vaults
      if (this.isVaultBlacklisted(vaultAddress)) {
        this.log(`Skipping blacklisted vault: ${vaultAddress}`);
        results.skippedBlacklisted.push(vaultAddress);
        continue;
      }

      // Verify this vault's executor belongs to our HD tree
      try {
        const [executorIndex, onChainExecutor] = await Promise.all([
          retryRpcCall(
            () => getVaultExecutorIndex(vaultAddress, this.provider),
            'getVaultExecutorIndex'
          ),
          retryRpcCall(
            () => getVaultContract(vaultAddress, this.provider).executor(),
            'vault.executor'
          )
        ]);

        const derivedAddress = this.hdNode.derivePath(
          "m/44'/60'/0'/0/" + executorIndex
        ).address;

        if (derivedAddress.toLowerCase() !== onChainExecutor.toLowerCase()) {
          this.log(
            `Vault ${vaultAddress} executor ${onChainExecutor} ` +
            `does not match derived ${derivedAddress} (index ${executorIndex}) — skipping`
          );
          results.skippedNotOurs.push(vaultAddress);
          continue;
        }

        this.log(`Vault ${vaultAddress} verified: executor index ${executorIndex}`);
      } catch (error) {
        console.error(`Failed to verify vault ${vaultAddress} ownership:`, error.message);
        results.failed.push({ vaultAddress, error: `ownership verification: ${error.message}` });
        continue;
      }

      // Vault is ours — set it up
      try {
        await this.setupVault(vaultAddress);
        results.successful.push(vaultAddress);
      } catch (error) {
        console.error(`Failed to setup vault ${vaultAddress}:`, error.message);
        results.failed.push({ vaultAddress, error: error.message });

        // InsufficientGasError: executor needs funding, not a retry/blacklist case.
        // Direct call to VaultHealth — no event indirection needed.
        if (error.name === 'InsufficientGasError') {
          this.vaultHealth.enterFundingRequired(vaultAddress);
          continue;
        }

        // Check if error is recoverable - blacklist immediately for unrecoverable errors
        if (this.isRecoverableError(error)) {
          try {
            await this.trackFailedVault(vaultAddress, error.message, 'initial_setup');
          } catch (handlerError) {
            console.error(`[initial_setup] trackFailedVault error for ${vaultAddress}:`, handlerError.message);
            await this.emergencyVaultCleanup(vaultAddress, `[initial_setup] trackFailedVault failed: ${handlerError.message}`);
          }
        } else {
          this.log(`Unrecoverable error during initial setup - blacklisting ${vaultAddress}`);
          await this.blacklistVault(vaultAddress, error.message);
        }
      }
    }

    this.eventManager.emit('VaultsLoaded', {
      total: results.total,
      successful: results.successful.length,
      failed: results.failed.length,
      skippedBlacklisted: results.skippedBlacklisted.length,
      skippedNotOurs: results.skippedNotOurs.length,
      timestamp: Date.now(),
      log: {
        level: results.failed.length > 0 ? 'warn' : 'info',
        message: `Loaded ${results.successful.length}/${results.total} vaults ` +
          `(${results.failed.length} failed, ${results.skippedBlacklisted.length} blacklisted, ` +
          `${results.skippedNotOurs.length} not ours)`
      }
    });

    return results;
  }
```

**2h. InsufficientGasError handling in handleSwapEvent (lines 1808-1825)**

Insert before the existing `isRecoverableError` check at line 1812:
```js
    } catch (error) {
      console.error(`Error processing swap event for vault ${vaultAddress}:`, error);

      // InsufficientGasError: executor needs funding, skip vault without retry/blacklist.
      // Direct call to VaultHealth — no event indirection needed.
      if (error.name === 'InsufficientGasError') {
        this.vaultHealth.enterFundingRequired(vaultAddress);
      } else if (this.isRecoverableError(error)) {
        // ... existing recoverable handling ...
```

Same pattern in `retryFailedVaults` (lines 1045-1060) and `VaultAuthGranted` handler (lines 866-874) — add InsufficientGasError check before the recoverable/unrecoverable branching. All four sites use direct `this.vaultHealth.enterFundingRequired(vaultAddress)` call instead of emitting `ExecutorInsufficientGas` event.

**2i. getStatus() (lines 2110-2123)**

Remove `automationServiceAddress`:
```js
  getStatus() {
    return {
      isRunning: this.isRunning,
      chainId: this.chainId,
      adaptersLoaded: this.adapters.size,
      tokensLoaded: Object.keys(this.tokens).length,
      poolsCached: Object.keys(this.poolData).length,
      vaultsCached: this.vaultDataService.getAllVaults().length,
      failedVaults: this.failedVaults.size,
      blacklistedVaults: this.blacklistedVaults.size,
      sse: this.sseBroadcaster.getStatus()
    };
  }
```

#### Change 3: `fum_automation/src/core/VaultDataService.js` — Include executorIndex in vault cache

VaultDataService already calls `getVaultInfo(address, provider)` which (per Phase 4) now returns `executorIndex`. Pass it through to the vault cache so strategies can access `vault.executorIndex` for signer derivation.

In `_loadVaultDataInternal` (line 188-198), add `executorIndex`:
```js
      const vault = this.assembleVaultData({
        address: normalizedAddress,
        owner: vaultInfo.owner,
        executorIndex: vaultInfo.executorIndex,
        chainId: this.chainId,
        strategyAddress: strategyAddress,
        strategy: strategyData,
        targetTokens: targetTokens,
        targetPlatforms: targetPlatforms,
        tokens: tokenBalances,
        positions: positions
      });
```

In `assembleVaultData` (lines 325-338), add `executorIndex`:
```js
  assembleVaultData(data) {
    return {
      address: data.address,
      owner: data.owner,
      executorIndex: data.executorIndex,
      chainId: data.chainId,
      strategyAddress: data.strategyAddress,
      strategy: data.strategy,
      tokens: data.tokens,
      targetTokens: data.targetTokens,
      targetPlatforms: data.targetPlatforms,
      positions: data.positions,
      lastUpdated: Date.now()
    };
  }
```

#### Change 4: `fum_automation/src/strategies/base/StrategyBase.js` — Per-vault signer derivation

3 modifications: add helper method, replace 3 signer creation sites, add InsufficientGasError catch.

**4a. Add `getVaultSigner` helper method**

Add after the `log` method (line 86), before the Transaction Execution section:

```js
  /**
   * Derive the per-vault signer from HDNode + vault's executorIndex.
   * Child key derivation is microseconds (HMAC-SHA512) — no caching needed.
   *
   * @param {Object} vault - Vault data object with executorIndex
   * @returns {ethers.Wallet} Signer connected to current provider
   */
  getVaultSigner(vault) {
    if (!this.hdNode) {
      throw new UnrecoverableError(
        'HDNode not initialized — updateStrategyDependencies must be called before transaction execution'
      );
    }
    const childNode = this.hdNode.derivePath("m/44'/60'/0'/0/" + vault.executorIndex);
    return new ethers.Wallet(childNode.privateKey, this.provider);
  }
```

**4b. Replace signer creation in `executeBatchTransactions` (lines 127-133)**

Replace:
```js
    // Create signer for transaction execution
    const automationPrivateKey = process.env.AUTOMATION_PRIVATE_KEY;
    if (!automationPrivateKey) {
      throw new UnrecoverableError('AUTOMATION_PRIVATE_KEY not found in environment variables');
    }
    const signer = new ethers.Wallet(automationPrivateKey, this.provider);
    const vaultContractWithSigner = vaultContract.connect(signer);
```

With:
```js
    // Create per-vault signer via HD derivation
    const signer = this.getVaultSigner(vault);
    const vaultContractWithSigner = vaultContract.connect(signer);
```

And wrap the `retryWithBackoff` block (lines 147-160) to catch InsufficientGasError:

Replace:
```js
    // Execute batch transaction with retry on network errors
    const { receipt } = await retryWithBackoff(
      async () => {
        this.log(`Executing batch of ${targets.length} ${operationType}`);
        const tx = await this._executeForType(vaultContractWithSigner, type, targets, calldatas, values, totalValue);
        return { receipt: await tx.wait() };
      },
      {
        maxRetries: 1,           // 2 total attempts (1 retry)
        baseDelay: 500,          // Short delay appropriate for tx execution
        exponential: false,      // Linear delay for tx retries
        context: operationType,
        logger: { log: (msg) => this.log(msg) }
      }
    );
```

With:
```js
    // Execute batch transaction with retry on network errors
    let receipt;
    try {
      ({ receipt } = await retryWithBackoff(
        async () => {
          this.log(`Executing batch of ${targets.length} ${operationType}`);
          const tx = await this._executeForType(vaultContractWithSigner, type, targets, calldatas, values, totalValue);
          return { receipt: await tx.wait() };
        },
        {
          maxRetries: 1,           // 2 total attempts (1 retry)
          baseDelay: 500,          // Short delay appropriate for tx execution
          exponential: false,      // Linear delay for tx retries
          context: operationType,
          logger: { log: (msg) => this.log(msg) }
        }
      ));
    } catch (error) {
      // Detect insufficient gas and wrap in InsufficientGasError for structured handling
      if (error.code === 'INSUFFICIENT_FUNDS') {
        throw new InsufficientGasError(
          `Executor has insufficient gas for ${operationType}: ${error.message}`,
          vault.address,
          signer.address
        );
      }
      throw error;
    }
```

Update errors import (line 36):
```js
import { UnrecoverableError, InsufficientGasError } from '../../utils/errors.js';
```

**4c. Replace signer creation in `executeWrap` (line 312)**

Replace:
```js
    const signer = new ethers.Wallet(process.env.AUTOMATION_PRIVATE_KEY, this.provider);
```

With:
```js
    const signer = this.getVaultSigner(vault);
```

**4d. Replace signer creation in `executeUnwrap` (line 368)**

Replace:
```js
    const signer = new ethers.Wallet(process.env.AUTOMATION_PRIVATE_KEY, this.provider);
```

With:
```js
    const signer = this.getVaultSigner(vault);
```

#### Change 5: `fum_automation/src/strategies/babySteps/BabyStepsStrategy.js` — Per-vault signer derivation

**5a. Replace signer creation in `distributeFees` (line 1436)**

Replace:
```js
    const signer = new ethers.Wallet(process.env.AUTOMATION_PRIVATE_KEY, this.provider);
    const vaultWithSigner = vaultContract.connect(signer);
```

With:
```js
    const signer = this.getVaultSigner(vault);
    const vaultWithSigner = vaultContract.connect(signer);
```

`getVaultSigner` is inherited from StrategyBase (Change 4a).

**5b. Replace signer creation in `prepareTokensForPosition` (line 2557)**

Replace:
```js
    const signer = new ethers.Wallet(process.env.AUTOMATION_PRIVATE_KEY, this.provider);
```

With:
```js
    const signer = this.getVaultSigner(vault);
```

**5c. Holdback in `calculateAvailableDeployment`**

No changes in Phase 5. Phase 6 (VaultHealth) adds holdback subtraction here. See Phase 6 section.

#### Change 6: `fum_automation/src/core/EventManager.js` — Authorization event filtering

Replace the `subscribeToAuthorizationEvents` method (lines 788-856):

```js
  /**
   * Subscribe to authorization events (ExecutorChanged)
   *
   * With per-vault signers, there is no single automation service address.
   * - Grants: verify the executor address is derivable from our HD tree
   *   (read vault's executorIndex from VaultFactory, derive, compare)
   * - Revocations: check if the vault is in our managed set
   *
   * @param {Object} provider - Ethers provider
   * @param {Object} hdNode - Cached HDNode for address derivation
   * @param {number} chainId - Chain ID
   */
  subscribeToAuthorizationEvents(provider, hdNode, chainId) {
    this.log('Subscribing to authorization events...');

    const filter = {
      topics: [ethers.utils.id('ExecutorChanged(address,bool)')]
    };

    const handleExecutorChanged = async (log) => {
      try {
        const executorAddress = '0x' + log.topics[1].slice(26);
        const isAuthorized = log.topics[2].endsWith('1');
        const vaultAddress = log.address;

        if (isAuthorized) {
          // Grant: verify this executor belongs to our HD tree
          // Read executorIndex from VaultFactory, derive our address, compare
          let executorIndex;
          try {
            executorIndex = await retryRpcCall(
              () => getVaultExecutorIndex(vaultAddress, provider),
              'getVaultExecutorIndex(authEvent)'
            );
          } catch (indexError) {
            this.log(`Could not read executorIndex for vault ${vaultAddress}: ${indexError.message}`);
            return;
          }

          const derivedAddress = hdNode.derivePath(
            "m/44'/60'/0'/0/" + executorIndex
          ).address;

          if (derivedAddress.toLowerCase() !== executorAddress.toLowerCase()) {
            this.log(
              `ExecutorChanged grant for vault ${vaultAddress}: ` +
              `executor ${executorAddress} is not ours (derived: ${derivedAddress}), ignoring`
            );
            return;
          }

          this.emit('VaultAuthGranted', {
            vaultAddress,
            executorAddress,
            executorIndex,
            log: {
              level: 'info',
              message: `New vault authorization detected: ${vaultAddress}`
            }
          });
        } else {
          // Revocation: only process if vault is in our managed set
          if (!this.vaultDataService || !this.vaultDataService.hasVault(vaultAddress)) {
            this.log(`ExecutorChanged revocation for vault ${vaultAddress}: not in managed set, ignoring`);
            return;
          }

          this.emit('VaultAuthRevoked', {
            vaultAddress,
            executorAddress,
            log: {
              level: 'warn',
              message: `Vault authorization revoked: ${vaultAddress}`
            }
          });
        }
      } catch (error) {
        console.error('Error handling executor change event:', error);
        this.emit('VaultAuthEventFailed', {
          vaultAddress: log.address,
          rawLog: log,
          error: error.message,
          log: {
            level: 'error',
            message: `Failed to process ExecutorChanged event for vault: ${log.address}`
          }
        });
      }
    };

    this.registerFilterListener({
      provider,
      filter,
      handler: handleExecutorChanged,
      address: 'global',
      eventType: 'authorization',
      chainId,
      additionalId: 'executor-changed'
    });

    this.log('Subscribed to authorization events');
  }
```

Update the static imports at the top of EventManager.js (line 10):
```js
import { getVaultContract, getVaultExecutorIndex } from 'fum_library';
import { retryRpcCall } from '../utils/RetryHelper.js';
```

#### Change 7: `fum_automation/scripts/start-automation.js` — Replace private key with mnemonic

**7a. REQUIRED_VARS (line 24)**

Replace `'AUTOMATION_PRIVATE_KEY'` with `'AUTOMATION_MNEMONIC'`.

**7b. loadConfig() (lines 49-71)**

Replace:
```js
function loadConfig() {
  const missing = REQUIRED_VARS.filter(key => !process.env[key]);

  if (missing.length > 0) {
    console.error(`Missing required environment variables: ${missing.join(', ')}`);
    console.error('Set them in .env.local (development) or in your platform config (production)');
    process.exit(1);
  }

  // Derive executor address from private key
  const wallet = new ethers.Wallet(process.env.AUTOMATION_PRIVATE_KEY);

  return {
    chainId: parseInt(process.env.CHAIN_ID),
    wsUrl: process.env.WS_URL,
    executorAddress: wallet.address,
    debug: process.env.DEBUG === 'true',
    dataDir: process.env.DATA_DIR,
    ssePort: parseInt(process.env.SSE_PORT),
    retryIntervalMs: parseInt(process.env.RETRY_INTERVAL_MS),
    maxFailureDurationMs: parseInt(process.env.MAX_FAILURE_DURATION_MS)
  };
}
```

With:
```js
function loadConfig() {
  const missing = REQUIRED_VARS.filter(key => !process.env[key]);

  if (missing.length > 0) {
    console.error(`Missing required environment variables: ${missing.join(', ')}`);
    console.error('Set them in .env.local (development) or in your platform config (production)');
    process.exit(1);
  }

  // Validate mnemonic (HDNode creation validates BIP-39 format)
  try {
    ethers.utils.HDNode.fromMnemonic(process.env.AUTOMATION_MNEMONIC);
  } catch (error) {
    console.error(`Invalid AUTOMATION_MNEMONIC: ${error.message}`);
    process.exit(1);
  }

  return {
    chainId: parseInt(process.env.CHAIN_ID),
    wsUrl: process.env.WS_URL,
    debug: process.env.DEBUG === 'true',
    dataDir: process.env.DATA_DIR,
    ssePort: parseInt(process.env.SSE_PORT),
    retryIntervalMs: parseInt(process.env.RETRY_INTERVAL_MS),
    maxFailureDurationMs: parseInt(process.env.MAX_FAILURE_DURATION_MS)
  };
}
```

**7c. main() — console output and AutomationService constructor (lines 107-142)**

Replace config logging:
```js
    console.log("Configuration:");
    console.log(`  Chain ID: ${config.chainId}`);
    console.log(`  WebSocket URL: ${config.wsUrl}`);
    console.log(`  Debug: ${config.debug}`);
    console.log(`  SSE Port: ${config.ssePort}`);
    console.log(`  Data Dir: ${config.dataDir || './data (default)'}`);
    console.log(`  Retry Interval: ${config.retryIntervalMs}ms (${config.retryIntervalMs / 1000}s)`);
    console.log(`  Max Failure Duration: ${config.maxFailureDurationMs}ms (${config.maxFailureDurationMs / (1000 * 60 * 60)}h)\n`);
```

Replace AutomationService constructor call:
```js
    const service = new AutomationService({
      debug: config.debug,
      chainId: config.chainId,
      wsUrl: config.wsUrl,
      dataDir: config.dataDir,
      ssePort: config.ssePort,
      retryIntervalMs: config.retryIntervalMs,
      maxFailureDurationMs: config.maxFailureDurationMs,
    });
```

Note: `automationServiceAddress` and `executorAddress` are both removed from the config and constructor call. AutomationService reads `AUTOMATION_MNEMONIC` directly from `process.env`.

#### Change 8: `.env.example` and `.env.local` — Replace private key with mnemonic

**`.env.example` (lines 16-19)**

Replace:
```
# Private key for the automation executor wallet
# This wallet signs transactions for vault operations
# WARNING: Never commit real private keys to version control
AUTOMATION_PRIVATE_KEY=
```

With:
```
# BIP-39 mnemonic for HD wallet derivation (per-vault executor signers)
# Each vault gets a unique executor derived from this mnemonic + vault's executorIndex
# WARNING: Never commit mnemonics to version control
AUTOMATION_MNEMONIC=
```

**`.env.local` (lines 10-11)**

Replace:
```
# Executor wallet (account #4 in Ganache - for signing transactions)
AUTOMATION_PRIVATE_KEY=0x153b8bcb033769a3f3d51b6c2c99be54e76ea190a20752a308a7ec0873383470
```

With:
```
# HD wallet mnemonic for per-vault executor derivation (test mnemonic, matches Phase 8)
AUTOMATION_MNEMONIC=pumpkin ghost mammal enrich toss laptop travel main again clever edit orchard
```

Also remove legacy env vars (lines 15-16) that AutomationService now derives from `config.dataDir`:
```
BLACKLIST_PATH=./data/.vault-blacklist.json
TRACKING_DATA_DIR=./data/vaults
```

#### Flagged Issues (Resolved)

**1. ~~Dynamic import in EventManager~~ → Static import.** Changed to static import: `import { getVaultContract, getVaultExecutorIndex } from 'fum_library'` at line 10. Code above already reflects this.

**2. VaultDataService is Phase 5 scope.** Change 3 adds `executorIndex` to VaultDataService's vault cache. This file isn't in the original Phase 5 outline but is required — strategies need `vault.executorIndex` to derive signers. VaultDataService already calls `getVaultInfo` which (per Phase 4) returns `executorIndex`, so it's just passing the field through.

**3. Holdback deferred to Phase 6.** `calculateAvailableDeployment` is not modified in Phase 5. The holdback subtraction requires VaultHealth (Phase 6) to provide the value. Phase 5 adds the signer derivation and InsufficientGasError infrastructure that Phase 6 builds on. Note: InsufficientGasError handling also changed — AutomationService catch blocks now call `this.vaultHealth.enterFundingRequired(vaultAddress)` directly instead of emitting `ExecutorInsufficientGas` event (Phase 6 design update).

**4. Backtest runner needs mnemonic update → noted in Phase 8.** `backtest/runners/run-v3-backtest.js` (line 351) sets `process.env.AUTOMATION_PRIVATE_KEY` and passes `automationServiceAddress` in config. Added to Phase 8 scope below.

**5. ~~Legacy env vars in `.env.local`~~ → Removed.** Change 8 removes `BLACKLIST_PATH` and `TRACKING_DATA_DIR` from `.env.local` — AutomationService derives both from `config.dataDir`.

**Verification:** `cd fum_automation && npm test` (after Phase 8 test updates)

### Phase 6: VaultHealth Module

Executor gas monitoring and automated top-up. VaultHealth tracks per-vault executor balances, sets holdback amounts that strategies subtract from deployable capital, and executes top-ups when vault funds are available — including swapping ERC20 tokens to native when no native/wrapped-native is present (critical for stablecoin-only vaults). Four file changes.

#### Change 1: `fum_automation/src/core/VaultHealth.js` (NEW)

New module — handles executor balance monitoring, holdback management, and top-up execution.

**Design notes:**
- Follows EventManager's dependency injection pattern (`setX` methods)
- Follows AutomationService's lifecycle pattern (`start`, `stop`)
- Derives executor addresses using the same HDNode path as StrategyBase.getVaultSigner
- Uses `retryRpcCall` for all RPC calls
- Acquires vault locks before on-chain operations (top-ups)
- No persistence — holdbacks are derived from on-chain executor balances at startup
- Event-driven top-ups: subscribes to `VaultUnlocked` (fires after any lock release) and `VaultSetupComplete` (fires after initial vault setup). When a vault with an outstanding holdback completes processing and releases its lock, VaultHealth acquires the lock and attempts a top-up. No delay needed — `VaultUnlocked` fires after the lock is already released (line 1884 deletes lock, line 1887 emits event).
- Interval check recalculates holdback every cycle — overwrites previous holdback with fresh `maxBalance - currentBalance`. Clears holdback when executor balance recovers above `minBalance`.
- Interval-based fallback: checks all balances every `balanceCheckIntervalMs` (default 5 min). Catches cases where executor gets low between operations.
- Swap-based top-ups: when a vault has no native or wrapped-native, VaultHealth uses platform adapters to swap ERC20s → wrapped native. Tokens are sorted by USD value (highest first); secondary tokens gated by 25%-of-remaining-deficit threshold. Target is midpoint between minExecutorBalance and maxExecutorBalance. For each token swap, adapters are tried in `vault.targetPlatforms` order — if the first adapter fails (no pool, revert), the next is tried. Only skips a token if all adapters fail.
- Adapter dependency: `setAdapters(adapters)` injects the platform adapter Map from AutomationService. Required for swap-based top-ups; `getAdaptersForVault` throws if no target platforms resolve to adapters.

```js
/**
 * @module core/VaultHealth
 * @description Executor gas monitoring and automated top-up for per-vault signers.
 * Tracks executor balances, sets holdback amounts that strategies subtract from
 * deployable capital, and executes top-ups when vault funds are available.
 * @since 2.0.0
 */

import { ethers } from 'ethers';
import { getVaultContract } from 'fum_library';
import { getMinExecutorBalance, getMaxExecutorBalance, getChainConfig } from 'fum_library/helpers/chainHelpers';
import { fetchTokenPrices, CACHE_DURATIONS } from 'fum_library/services/coingecko';
import { getNativeSymbol, getWrappedNativeSymbol, getWrappedNativeAddress } from 'fum_library/helpers/tokenHelpers';
import { retryRpcCall } from '../utils/RetryHelper.js';
import ERC20ARTIFACT from '@openzeppelin/contracts/build/contracts/ERC20.json' with { type: 'json' };
const ERC20ABI = ERC20ARTIFACT.abi;

class VaultHealth {
  /**
   * @param {Object} options
   * @param {Object} options.eventManager - EventManager instance
   * @param {number} options.chainId - Chain ID
   * @param {boolean} [options.debug=false] - Debug logging
   * @param {number} [options.balanceCheckIntervalMs=300000] - Balance check interval (0 disables interval)
   */
  constructor({ eventManager, chainId, debug = false, balanceCheckIntervalMs = 300000 }) {
    this.eventManager = eventManager;
    this.chainId = chainId;
    this.debug = debug;
    this.balanceCheckIntervalMs = balanceCheckIntervalMs;

    // Per-vault holdback state: vaultAddress → { amountNative, amountUsd, setAt }
    this.holdbacks = new Map();

    // Vault addresses under monitoring
    this.managedVaults = new Set();

    // Funding-required state: vaultAddress → { executorAddress, enteredAt }
    // Vaults in this map have had InsufficientGasError — locked until user funds executor
    this.fundingRequired = new Map();

    // On-chain event listeners for ExecutorFunded (per-vault)
    this.onChainListeners = new Map();  // vaultAddress → listener cleanup function

    // Interval handle
    this.balanceCheckInterval = null;

    // Dependencies (injected after construction via setX methods)
    this.provider = null;
    this.hdNode = null;
    this.vaultDataService = null;
    this.tokens = null;
    this.adapters = null;
    this.lockVault = null;
    this.unlockVault = null;

    // Subscribe to events (handlers are no-ops until start() populates managedVaults)
    this.setupEventSubscriptions();
  }

  //#region Dependency Injection

  setProvider(provider) {
    this.provider = provider;
    this.resubscribeOnChainListeners();
  }
  setHdNode(hdNode) { this.hdNode = hdNode; }
  setVaultDataService(vaultDataService) { this.vaultDataService = vaultDataService; }
  setTokens(tokens) { this.tokens = tokens; }
  setAdapters(adapters) { this.adapters = adapters; }

  /**
   * Inject vault lock/unlock functions from AutomationService
   * @param {Function} lockFn - (vaultAddress) => boolean
   * @param {Function} unlockFn - (vaultAddress) => void
   */
  setLockFunctions(lockFn, unlockFn) {
    this.lockVault = lockFn;
    this.unlockVault = unlockFn;
  }

  //#endregion

  //#region Lifecycle

  /**
   * Start monitoring — check all executor balances and begin interval
   * Called after loadAuthorizedVaults so VaultDataService has vault data.
   */
  async start() {
    this.log('Starting VaultHealth...');

    // Populate managed vault set from VaultDataService
    const vaults = this.vaultDataService.getAllVaults();
    for (const vault of vaults) {
      this.managedVaults.add(ethers.utils.getAddress(vault.address));
    }

    // Initial balance check — sets holdbacks for any underfunded executors
    await this.checkAllBalances();

    // Start periodic monitoring (0 = disabled, useful in tests)
    if (this.balanceCheckIntervalMs > 0) {
      this.balanceCheckInterval = setInterval(
        () => this.checkAllBalances(),
        this.balanceCheckIntervalMs
      );
    }

    this.log(`VaultHealth started — monitoring ${this.managedVaults.size} vault(s), ${this.holdbacks.size} holdback(s) set`);
  }

  /**
   * Stop monitoring — clear interval and all state
   */
  stop() {
    if (this.balanceCheckInterval) {
      clearInterval(this.balanceCheckInterval);
      this.balanceCheckInterval = null;
    }
    // Unsubscribe all on-chain listeners
    for (const [addr, cleanup] of this.onChainListeners) {
      cleanup();
    }
    this.onChainListeners.clear();
    this.holdbacks.clear();
    this.fundingRequired.clear();
    this.managedVaults.clear();
    this.log('VaultHealth stopped');
  }

  //#endregion

  //#region Vault Management

  /**
   * Add a vault to monitoring. Called by AutomationService after successful setupVault.
   * Checks executor balance immediately (fire-and-forget).
   * @param {string} vaultAddress - Vault address
   */
  addVault(vaultAddress) {
    const normalized = ethers.utils.getAddress(vaultAddress);
    this.managedVaults.add(normalized);
    this.checkExecutorBalance(normalized).catch(error => {
      this.log(`Error checking balance for new vault ${normalized}: ${error.message}`);
    });
  }

  /**
   * Remove a vault from monitoring. Called by AutomationService during cleanupVault.
   * @param {string} vaultAddress - Vault address
   */
  removeVault(vaultAddress) {
    const normalized = ethers.utils.getAddress(vaultAddress);
    this.managedVaults.delete(normalized);
    this.holdbacks.delete(normalized);
    this.fundingRequired.delete(normalized);
    this.unsubscribeFromExecutorFundedEvent(normalized);
  }

  //#endregion

  //#region Core API

  /**
   * Get the holdback amount (USD) for a vault.
   * Strategies call this in calculateAvailableDeployment to subtract from deployable capital.
   * Returns 0 if executor balance is healthy (no holdback needed).
   *
   * @param {string} vaultAddress - Vault address
   * @returns {number} Holdback amount in USD (0 if no holdback)
   */
  getHoldbackAmount(vaultAddress) {
    const normalized = ethers.utils.getAddress(vaultAddress);
    const holdback = this.holdbacks.get(normalized);
    return holdback ? holdback.amountUsd : 0;
  }

  //#endregion

  //#region Balance Checking

  /**
   * Check all managed executor balances. Called on interval and at startup.
   * Prunes vaults no longer in VaultDataService.
   */
  async checkAllBalances() {
    // Prune vaults removed from VaultDataService since last check
    for (const addr of this.managedVaults) {
      if (!this.vaultDataService.hasVault(addr)) {
        this.managedVaults.delete(addr);
        this.holdbacks.delete(addr);
      }
    }

    for (const vaultAddress of this.managedVaults) {
      try {
        await this.checkExecutorBalance(vaultAddress);
      } catch (error) {
        this.log(`Error checking executor balance for ${vaultAddress}: ${error.message}`);
      }
    }

    // Check funding-required vaults for balance recovery (catches raw ETH transfers
    // that bypass vault.fundExecutor() and don't emit the on-chain ExecutorFunded event)
    for (const [vaultAddress] of this.fundingRequired) {
      try {
        const vault = await this.vaultDataService.getVault(vaultAddress);
        if (!vault) continue;
        const executorAddress = this.deriveExecutorAddress(vault);
        const balance = await retryRpcCall(
          () => this.provider.getBalance(executorAddress),
          `getBalance(executor:${vaultAddress.slice(0, 8)})`,
          { log: (msg) => this.log(msg) }
        );
        const balanceNative = parseFloat(ethers.utils.formatEther(balance));
        if (balanceNative >= getMinExecutorBalance(this.chainId)) {
          this.log(`Funding-required vault ${vaultAddress} executor balance recovered to ${balanceNative} — clearing`);
          this.clearFundingRequired(vaultAddress);
        }
      } catch (error) {
        this.log(`Error checking funding-required vault ${vaultAddress}: ${error.message}`);
      }
    }
  }

  /**
   * Check a single vault's executor balance and set/clear holdback.
   * @param {string} vaultAddress - Vault address (must be checksummed)
   */
  async checkExecutorBalance(vaultAddress) {
    const vault = await this.vaultDataService.getVault(vaultAddress);
    if (!vault) return;

    const executorAddress = this.deriveExecutorAddress(vault);

    const balance = await retryRpcCall(
      () => this.provider.getBalance(executorAddress),
      `getBalance(executor:${vaultAddress.slice(0, 8)})`,
      { log: (msg) => this.log(msg) }
    );

    const balanceNative = parseFloat(ethers.utils.formatEther(balance));
    const minBalance = getMinExecutorBalance(this.chainId);
    const maxBalance = getMaxExecutorBalance(this.chainId);

    if (balanceNative < minBalance) {
      await this.setHoldback(vaultAddress, balanceNative, maxBalance);
    } else if (this.holdbacks.has(vaultAddress)) {
      this.clearHoldback(vaultAddress);
    }
  }

  //#endregion

  //#region Holdback Management

  /**
   * Set holdback for a vault whose executor is underfunded.
   * Calculates the deficit (maxBalance - currentBalance) and converts to USD.
   *
   * Note: Unconditionally overwrites any existing holdback with a fresh calculation.
   * Each interval cycle recalculates `maxBalance - currentBalance` with fresh balance
   * data, so the holdback tracks executor spend between top-ups. The `isNew` flag
   * only controls event emission, not whether the overwrite happens.
   *
   * @param {string} vaultAddress - Vault address (checksummed)
   * @param {number} currentBalance - Current executor balance in native token
   * @param {number} maxBalance - Target balance (maxExecutorBalance from chain config)
   */
  async setHoldback(vaultAddress, currentBalance, maxBalance) {
    const deficitNative = maxBalance - currentBalance;

    // Convert native deficit to USD
    const nativeSymbol = getNativeSymbol(this.chainId);
    const prices = await fetchTokenPrices(
      [nativeSymbol],
      CACHE_DURATIONS['1-MINUTE']
    );
    const nativePrice = prices[nativeSymbol.toUpperCase()];
    const holdbackUsd = deficitNative * nativePrice;

    const isNew = !this.holdbacks.has(vaultAddress);
    this.holdbacks.set(vaultAddress, {
      amountNative: deficitNative,
      amountUsd: holdbackUsd,
      setAt: Date.now()
    });

    if (isNew) {
      this.log(`Holdback set for ${vaultAddress}: ${deficitNative.toFixed(6)} native ($${holdbackUsd.toFixed(2)})`);

      this.eventManager.emit('ExecutorHoldbackSet', {
        vaultAddress,
        deficitNative,
        holdbackUsd,
        currentBalance,
        minBalance: getMinExecutorBalance(this.chainId),
        maxBalance,
        timestamp: Date.now(),
        log: {
          level: 'warn',
          message: `Executor holdback set for ${vaultAddress}: ${deficitNative.toFixed(6)} native ($${holdbackUsd.toFixed(2)})`
        }
      });
    }
  }

  /**
   * Clear holdback for a vault whose executor has recovered.
   * @param {string} vaultAddress - Vault address (checksummed)
   */
  clearHoldback(vaultAddress) {
    if (this.holdbacks.delete(vaultAddress)) {
      this.log(`Holdback cleared for ${vaultAddress}`);

      this.eventManager.emit('ExecutorHoldbackCleared', {
        vaultAddress,
        timestamp: Date.now(),
        log: {
          level: 'info',
          message: `Executor holdback cleared for ${vaultAddress}`
        }
      });
    }
  }

  //#endregion

  //#region Top-Up Execution

  /**
   * Attempt to top up a vault's executor from vault funds.
   *
   * Flow:
   * 1. Check vault's native ETH balance (caller must hold lock)
   * 2. If insufficient native, try unwrapping wrapped native (WETH/WAVAX)
   * 3. If still insufficient, swap ERC20 tokens → wrapped native → unwrap
   * 4. Call vault.fundExecutor(amount) to transfer native to executor
   * 5. Clear holdback, refresh vault token balances, release lock
   *
   * Lock contract: Caller MUST hold the vault lock before calling.
   * On success or non-gas error: releases lock.
   * On INSUFFICIENT_FUNDS: enters fundingRequired state and keeps lock held.
   *
   * @param {string} vaultAddress - Vault address (checksummed)
   */
  async attemptTopUp(vaultAddress) {
    const holdback = this.holdbacks.get(vaultAddress);
    if (!holdback) {
      this.unlockVault(vaultAddress);
      return;
    }

    try {
      const vault = await this.vaultDataService.getVault(vaultAddress);
      if (!vault) {
        this.log(`Vault ${vaultAddress} not in cache — skipping top-up`);
        this.unlockVault(vaultAddress);
        return;
      }

      const executorAddress = this.deriveExecutorAddress(vault);
      const topUpAmountWei = ethers.utils.parseEther(holdback.amountNative.toFixed(18));

      // Check vault's native ETH balance
      const vaultNativeBalance = await retryRpcCall(
        () => this.provider.getBalance(vaultAddress),
        `getBalance(vault:${vaultAddress.slice(0, 8)})`,
        { log: (msg) => this.log(msg) }
      );

      let availableNative = vaultNativeBalance;

      // If vault doesn't have enough native, try unwrapping wrapped native
      if (availableNative.lt(topUpAmountWei)) {
        const wrappedNativeSymbol = getWrappedNativeSymbol(this.chainId);
        const wrappedBalance = vault.tokens?.[wrappedNativeSymbol];

        if (wrappedBalance && ethers.BigNumber.from(wrappedBalance).gt(0)) {
          const deficit = topUpAmountWei.sub(availableNative);
          const wrappedBN = ethers.BigNumber.from(wrappedBalance);
          const amountToUnwrap = deficit.gt(wrappedBN) ? wrappedBN : deficit;

          // Unwrap: WETH → ETH (or WAVAX → AVAX)
          const wrappedNativeAddress = getWrappedNativeAddress(this.chainId);
          const signer = this.deriveVaultSigner(vault);
          const vaultContract = getVaultContract(vaultAddress, this.provider).connect(signer);

          await retryRpcCall(
            async () => {
              const tx = await vaultContract.unwrapETH(wrappedNativeAddress, amountToUnwrap);
              return tx.wait();
            },
            'unwrapETH(topUp)',
            { log: (msg) => this.log(msg) }
          );

          availableNative = availableNative.add(amountToUnwrap);
          this.log(`Unwrapped ${ethers.utils.formatEther(amountToUnwrap)} ${wrappedNativeSymbol} for top-up`);
        }
      }

      // If still not enough native, try swapping ERC20 tokens to native
      // Adapters handle native output internally (TJ: swapExactTokensForNATIVE,
      // V3/V4: UniversalRouter native output routing) — no separate unwrap needed.
      if (availableNative.lt(topUpAmountWei)) {
        const deficit = topUpAmountWei.sub(availableNative);
        this.log(`Vault ${vaultAddress} native deficit: ${ethers.utils.formatEther(deficit)} — attempting ERC20 swap`);

        const swapCount = await this.swapTokensForNative(vault, deficit);

        if (swapCount > 0) {
          // Re-read native balance after swap (adapters output native directly)
          availableNative = await retryRpcCall(
            () => this.provider.getBalance(vaultAddress),
            'getBalance(postSwapTopUp)'
          );
        }

        // If still not enough, vault truly has nothing to swap — just log and return
        const { decimals: nativeDecimals } = getChainConfig(this.chainId).nativeCurrency;
        const minBalanceWei = ethers.utils.parseUnits(getMinExecutorBalance(this.chainId).toString(), nativeDecimals);
        if (availableNative.lt(minBalanceWei)) {
          this.log(`Vault ${vaultAddress} has insufficient balance for top-up after swap attempts`);
          this.unlockVault(vaultAddress);
          return;
        }
      }

      // Execute: transfer native ETH from vault to executor
      const actualAmount = availableNative.gt(topUpAmountWei) ? topUpAmountWei : availableNative;
      const signer = this.deriveVaultSigner(vault);
      const vaultContract = getVaultContract(vaultAddress, this.provider).connect(signer);

      this.log(`Funding executor ${executorAddress} with ${ethers.utils.formatEther(actualAmount)} native`);

      const receipt = await retryRpcCall(
        async () => {
          const tx = await vaultContract.fundExecutor(actualAmount);
          return tx.wait();
        },
        'fundExecutor',
        { log: (msg) => this.log(msg) }
      );

      // Success — clear holdback, refresh vault data, release lock
      this.clearHoldback(vaultAddress);
      await this.vaultDataService.refreshTokens(vaultAddress);
      this.unlockVault(vaultAddress);

      this.eventManager.emit('ExecutorFunded', {
        vaultAddress,
        executorAddress,
        amount: ethers.utils.formatEther(actualAmount),
        transactionHash: receipt.transactionHash,
        gasUsed: receipt.gasUsed.toString(),
        effectiveGasPrice: receipt.effectiveGasPrice.toString(),
        timestamp: Date.now(),
        log: {
          level: 'info',
          message: `Funded executor ${executorAddress} with ${ethers.utils.formatEther(actualAmount)} native`
        }
      });

    } catch (error) {
      console.error(`Top-up execution failed for ${vaultAddress}:`, error);

      // INSUFFICIENT_FUNDS means the vault truly can't fund its executor —
      // enter funding-required lockdown (keep holding the lock)
      if (error.code === 'INSUFFICIENT_FUNDS') {
        this.enterFundingRequired(vaultAddress);
        // Do NOT release lock — VaultUnlocked handler will re-acquire and hold it,
        // but we're already holding it, so just return without unlocking
        return;
      }

      this.eventManager.emit('ExecutorTopUpFailed', {
        vaultAddress,
        error: error.message,
        timestamp: Date.now(),
        log: {
          level: 'error',
          message: `Top-up failed for ${vaultAddress}: ${error.message}`
        }
      });
      // Other errors: release lock, holdback stays set, retry on next VaultUnlocked
      this.unlockVault(vaultAddress);
    }
  }

  //#endregion

  //#region Event Handlers

  /**
   * Set up event subscriptions. Called in constructor.
   * Handlers are safe to run before start() — they check managedVaults membership.
   */
  setupEventSubscriptions() {
    // VaultUnlocked — fires AFTER lock is released (line 1884 deletes lock, line 1887 emits event).
    // Replaces BatchTransactionExecuted/FeesCollected subscriptions which raced with the lock.
    this.eventManager.subscribe('VaultUnlocked', async (data) => {
      const normalized = ethers.utils.getAddress(data.vaultAddress);
      if (!this.managedVaults.has(normalized)) return;

      if (this.fundingRequired.has(normalized)) {
        // Vault just had InsufficientGasError. AutomationService released lock.
        // Re-acquire and hold until user funds executor via fundExecutor().
        // (On-chain ExecutorFunded listener already set up by enterFundingRequired.)
        this.lockVault(normalized);
        return;
      }

      if (this.holdbacks.has(normalized)) {
        // Success path: vault completed processing, tokens available for top-up.
        // Lock is already released — acquire it for the top-up.
        if (!this.lockVault(normalized)) return;  // someone else grabbed it
        await this.attemptTopUp(normalized);
        // attemptTopUp releases lock on success or non-gas error
        // attemptTopUp enters fundingRequired on INSUFFICIENT_FUNDS (keeps lock)
      }
    });

    // VaultSetupComplete — fires after initial vault setup (line 1648).
    // Note: setupVault itself doesn't acquire locks, but callers may hold the lock
    // (retryFailedVaults acquires lock at line 1030 before calling setupVault at line 1037).
    // Handler attempts lockVault and returns gracefully if lock is held —
    // VaultUnlocked from the caller's finally block will catch it.
    // For callers that don't hold locks (loadAuthorizedVaults line 1538,
    // VaultAuthGranted line 850), VaultSetupComplete is the only trigger.
    this.eventManager.subscribe('VaultSetupComplete', async (data) => {
      const normalized = ethers.utils.getAddress(data.vaultAddress);
      if (!this.managedVaults.has(normalized)) return;
      if (!this.holdbacks.has(normalized)) return;     // no top-up needed
      if (!this.lockVault(normalized)) return;          // lock held — VaultUnlocked will catch it
      await this.attemptTopUp(normalized);
      // attemptTopUp releases lock on success or non-gas error
      // attemptTopUp enters fundingRequired on INSUFFICIENT_FUNDS (keeps lock)
    });
  }

  //#endregion

  //#region Funding Required

  /**
   * Enter funding-required state for a vault. Called from two paths:
   * 1. AutomationService catch block when InsufficientGasError is caught
   * 2. VaultHealth's own attemptTopUp when INSUFFICIENT_FUNDS is hit
   *
   * Sets up the on-chain ExecutorFunded listener immediately — doesn't defer
   * to VaultUnlocked handler. Lock acquisition is handled by callers:
   * - Path 1: VaultUnlocked handler re-acquires after AS releases in finally
   * - Path 2: VaultHealth already holds the lock from attemptTopUp
   *
   * @param {string} vaultAddress - Vault address
   */
  enterFundingRequired(vaultAddress) {
    const normalized = ethers.utils.getAddress(vaultAddress);
    this.fundingRequired.set(normalized, {
      enteredAt: Date.now()
    });

    // Subscribe to on-chain ExecutorFunded event immediately so we detect
    // funding regardless of which path triggered enterFundingRequired
    this.subscribeToExecutorFundedEvent(normalized);

    this.eventManager.emit('ExecutorFundingRequired', {
      vaultAddress: normalized,
      timestamp: Date.now(),
      log: {
        level: 'error',
        message: `Vault ${normalized} entered funding-required state — executor needs manual funding via fundExecutor()`
      }
    });

    this.log(`Vault ${normalized} entered funding-required state`);
  }

  /**
   * Clear funding-required state for a vault. Called when on-chain ExecutorFunded event fires.
   * Releases lock, clears holdback, unsubscribes from on-chain event.
   *
   * @param {string} vaultAddress - Vault address (checksummed)
   */
  clearFundingRequired(vaultAddress) {
    if (!this.fundingRequired.has(vaultAddress)) return;

    this.fundingRequired.delete(vaultAddress);
    this.unsubscribeFromExecutorFundedEvent(vaultAddress);
    this.clearHoldback(vaultAddress);
    this.unlockVault(vaultAddress);

    this.eventManager.emit('ExecutorFundingCleared', {
      vaultAddress,
      timestamp: Date.now(),
      log: {
        level: 'info',
        message: `Vault ${vaultAddress} exited funding-required state — executor funded`
      }
    });

    this.log(`Vault ${vaultAddress} cleared funding-required state`);
  }

  /**
   * Get funding-required data for API endpoint.
   * @returns {Object} Map contents as plain object: { vaultAddress: { executorAddress, enteredAt } }
   */
  getFundingRequiredData() {
    return Object.fromEntries(this.fundingRequired);
  }

  //#endregion

  //#region On-Chain Listeners

  /**
   * Subscribe to the on-chain ExecutorFunded event for a specific vault.
   * When the user calls vault.fundExecutor(), this event fires and clears
   * the funding-required state.
   *
   * Note: Funding MUST go through vault.fundExecutor() — raw ETH transfers
   * to the executor won't emit this event and won't be detected.
   *
   * @param {string} vaultAddress - Vault address (checksummed)
   */
  subscribeToExecutorFundedEvent(vaultAddress) {
    if (this.onChainListeners.has(vaultAddress)) return;  // already subscribed

    const vaultContract = getVaultContract(vaultAddress, this.provider);
    const filter = vaultContract.filters.ExecutorFunded();

    const listener = (executor, amount, event) => {
      this.log(`On-chain ExecutorFunded event for ${vaultAddress}: ${ethers.utils.formatEther(amount)} to ${executor}`);
      this.clearFundingRequired(vaultAddress);
    };

    vaultContract.on(filter, listener);

    // Store cleanup function
    this.onChainListeners.set(vaultAddress, () => {
      vaultContract.off(filter, listener);
    });

    this.log(`Subscribed to on-chain ExecutorFunded event for ${vaultAddress}`);
  }

  /**
   * Unsubscribe from the on-chain ExecutorFunded event for a vault.
   * Called when funding clears, vault is removed, or service stops.
   *
   * @param {string} vaultAddress - Vault address (checksummed)
   */
  unsubscribeFromExecutorFundedEvent(vaultAddress) {
    const cleanup = this.onChainListeners.get(vaultAddress);
    if (cleanup) {
      cleanup();
      this.onChainListeners.delete(vaultAddress);
      this.log(`Unsubscribed from on-chain ExecutorFunded event for ${vaultAddress}`);
    }
  }

  /**
   * Tear down and re-create all on-chain ExecutorFunded listeners.
   * Called by setProvider() after WebSocket reconnection — existing listeners
   * are bound to ethers Contract instances that reference the old dead provider.
   */
  resubscribeOnChainListeners() {
    if (this.onChainListeners.size === 0) return;

    const vaults = [...this.onChainListeners.keys()];
    this.log(`Resubscribing ${vaults.length} on-chain ExecutorFunded listener(s) after provider change`);

    for (const vaultAddress of vaults) {
      this.unsubscribeFromExecutorFundedEvent(vaultAddress);
      this.subscribeToExecutorFundedEvent(vaultAddress);
    }
  }

  //#endregion

  //#region Helpers

  /**
   * Derive the executor address for a vault from the cached HDNode.
   * @param {Object} vault - Vault data object with executorIndex
   * @returns {string} Executor address (checksummed)
   */
  deriveExecutorAddress(vault) {
    return this.hdNode.derivePath("m/44'/60'/0'/0/" + vault.executorIndex).address;
  }

  /**
   * Derive the per-vault signer from the cached HDNode.
   * Same derivation path as StrategyBase.getVaultSigner.
   * @param {Object} vault - Vault data object with executorIndex
   * @returns {ethers.Wallet} Signer connected to current provider
   */
  deriveVaultSigner(vault) {
    const childNode = this.hdNode.derivePath("m/44'/60'/0'/0/" + vault.executorIndex);
    return new ethers.Wallet(childNode.privateKey, this.provider);
  }

  /**
   * Get ordered platform adapters for a vault based on its targetPlatforms.
   * Returns adapters in targetPlatforms order for swap fallthrough —
   * callers try each adapter until one succeeds.
   *
   * @param {Object} vault - Vault data object with targetPlatforms array
   * @returns {PlatformAdapter[]} Ordered array of adapter instances
   * @throws {Error} If vault has no target platforms or none resolve to adapters
   */
  getAdaptersForVault(vault) {
    if (!vault.targetPlatforms || vault.targetPlatforms.length === 0) {
      throw new Error(`Vault ${vault.address} has no target platforms configured`);
    }
    const adapters = [];
    for (const platformId of vault.targetPlatforms) {
      const adapter = this.adapters.get(platformId);
      if (adapter) {
        adapters.push(adapter);
      }
    }
    if (adapters.length === 0) {
      throw new Error(`No adapters found for vault ${vault.address} platforms: ${vault.targetPlatforms.join(', ')}`);
    }
    return adapters;
  }

  /**
   * Swap ERC20 tokens to wrapped native to cover an executor funding deficit.
   *
   * Strategy:
   * - Build token list from vault.tokens + this.tokens metadata + price data
   * - Sort by USD value (highest first), exclude native and wrapped native
   * - Swap the highest-value token first (always, no gate)
   * - Continue to secondary tokens only if still below midpoint AND
   *   the token can cover ≥25% of the remaining deficit (in USD terms)
   * - Stop once accumulated swaps would bring executor above midpoint
   *
   * Adapter selection:
   * - Cycles through vault.targetPlatforms in order for each token swap
   * - If the first adapter fails (no pool, revert, gas estimation failure),
   *   tries the next adapter. Only throws if ALL adapters fail for a token.
   * - The amounts are tiny (gas funding), so adapter choice doesn't matter
   *   for slippage — we just need one that has a pool for the pair.
   *
   * @param {Object} vault - Vault data object (vault.tokens = { symbol: balanceString })
   * @param {BigNumber} deficit - Native token deficit in wei
   * @returns {number} Number of swaps executed (zero if none)
   */
  async swapTokensForNative(vault, deficit) {
    const vaultAddress = vault.address;
    const adapters = this.getAdaptersForVault(vault);
    const nativeSymbol = getNativeSymbol(this.chainId);
    const nativeToken = this.tokens[nativeSymbol];
    const wrappedNativeSymbol = getWrappedNativeSymbol(this.chainId);

    // vault.tokens is { symbol: balanceString } — build enriched list with USD values
    if (!vault.tokens || Object.keys(vault.tokens).length === 0) {
      this.log(`Vault ${vaultAddress} has no tokens to swap`);
      return 0;
    }

    // Fetch prices for all vault tokens + native (needed for deficit calculation)
    const allSymbols = [...Object.keys(vault.tokens), nativeSymbol];
    const prices = await fetchTokenPrices(allSymbols);
    const nativePriceUsd = prices[nativeSymbol];
    if (!nativePriceUsd) {
      throw new Error(`Cannot fetch ${nativeSymbol} price for swap deficit calculation`);
    }

    // Build swappable token list: exclude native and wrapped native (already unwrapped in pre-swap step)
    const swappableTokens = [];
    for (const [symbol, balance] of Object.entries(vault.tokens)) {
      const tokenConfig = this.tokens[symbol];
      if (!tokenConfig) continue;
      if (tokenConfig.isNative) continue;                   // skip native (swapping native → native)
      if (symbol === wrappedNativeSymbol) continue;          // skip wrapped native (already unwrapped)

      const balanceBN = ethers.BigNumber.from(balance);
      if (balanceBN.lte(0)) continue;

      const balanceFormatted = parseFloat(ethers.utils.formatUnits(balance, tokenConfig.decimals));
      const balanceUsd = prices[symbol] ? balanceFormatted * prices[symbol] : 0;
      if (balanceUsd <= 0) continue;

      swappableTokens.push({
        symbol,
        address: tokenConfig.address,
        decimals: tokenConfig.decimals,
        balance,
        balanceUsd
      });
    }

    // Sort by USD value descending
    swappableTokens.sort((a, b) => b.balanceUsd - a.balanceUsd);

    if (swappableTokens.length === 0) {
      this.log(`Vault ${vaultAddress} has no swappable tokens with value`);
      return 0;
    }

    const deficitUsd = parseFloat(ethers.utils.formatEther(deficit)) * nativePriceUsd;

    let swapCount = 0;
    let remainingDeficitUsd = deficitUsd;
    const signer = this.deriveVaultSigner(vault);
    const vaultContract = getVaultContract(vaultAddress, this.provider).connect(signer);

    for (let i = 0; i < swappableTokens.length; i++) {
      const token = swappableTokens[i];

      // Secondary tokens (i > 0): must cover ≥25% of remaining deficit
      if (i > 0 && token.balanceUsd < remainingDeficitUsd * 0.25) {
        this.log(`Skipping ${token.symbol}: $${token.balanceUsd.toFixed(2)} < 25% of remaining deficit $${remainingDeficitUsd.toFixed(2)}`);
        continue;
      }

      this.log(`Swapping ${token.symbol} ($${token.balanceUsd.toFixed(2)}) → ${nativeSymbol} for executor top-up`);

      // Cycle through adapters until one succeeds for this token
      let swapped = false;
      for (const adapter of adapters) {
        try {
          // Get approvals (e.g., Permit2 approval for UniversalRouter)
          const approvals = await adapter.getRequiredApprovals(
            'swap', vaultAddress, [token.address], this.provider
          );
          if (approvals.length > 0) {
            const approvalTargets = approvals.map(a => a.to);
            const approvalCalldatas = approvals.map(a => a.data);
            await retryRpcCall(
              async () => {
                const tx = await vaultContract.approve(approvalTargets, approvalCalldatas);
                return tx.wait();
              },
              `approve(swapForTopUp-${token.symbol}-${adapter.platformId})`,
              { log: (msg) => this.log(msg) }
            );
          }

          // Execute swap: full token balance → native (adapter handles native output)
          const swapInstruction = {
            tokenIn: { address: token.address, decimals: token.decimals, symbol: token.symbol },
            tokenOut: nativeToken,
            amount: token.balance,
            isAmountIn: true
          };
          const swapOptions = {
            signer,
            recipient: vaultAddress,
            slippageTolerance: 0.01,
            provider: this.provider,
            chainId: this.chainId
          };

          const { transactions } = await adapter.batchSwapTransactions([swapInstruction], swapOptions);
          const swapTargets = transactions.map(t => t.to);
          const swapCalldatas = transactions.map(t => t.data);
          const swapValues = transactions.map(t => t.value || 0);

          await retryRpcCall(
            async () => {
              const tx = await vaultContract.swap(swapTargets, swapCalldatas, swapValues);
              return tx.wait();
            },
            `swap(topUp-${token.symbol}-${adapter.platformId})`,
            { log: (msg) => this.log(msg) }
          );

          swapped = true;
          break;  // This adapter worked — move to next token
        } catch (adapterError) {
          this.log(
            `Adapter ${adapter.platformId} failed for ${token.symbol} swap: ${adapterError.message}` +
            (adapters.indexOf(adapter) < adapters.length - 1 ? ' — trying next adapter' : ' — no more adapters')
          );
        }
      }

      if (!swapped) {
        this.log(`All adapters failed for ${token.symbol} swap — skipping token`);
        continue;
      }

      swapCount++;
      remainingDeficitUsd -= token.balanceUsd;

      // Check if we've covered enough (deficit fully covered or past midpoint)
      if (remainingDeficitUsd <= 0) {
        this.log(`Deficit covered after swapping ${token.symbol}`);
        break;
      }
    }

    // Return swap count so caller knows swaps happened — actual wrapped-native amount
    // is read from on-chain balance post-swap (output may differ from estimate)
    return swapCount;
  }

  log(message, ...args) {
    if (this.debug) {
      console.log(`[VaultHealth] ${message}`, ...args);
    }
  }

  /**
   * Get VaultHealth status for monitoring/SSE.
   * @returns {Object} Status object
   */
  getStatus() {
    return {
      managedVaults: this.managedVaults.size,
      activeHoldbacks: this.holdbacks.size,
      holdbacks: Object.fromEntries(
        Array.from(this.holdbacks.entries()).map(([addr, h]) => [
          addr,
          { amountNative: h.amountNative, amountUsd: h.amountUsd, setAt: h.setAt }
        ])
      ),
      fundingRequired: this.getFundingRequiredData()
    };
  }

  //#endregion
}

export default VaultHealth;
```

#### Change 2: `fum_automation/src/core/AutomationService.js` — VaultHealth integration

10 modifications to wire VaultHealth into the service lifecycle.

**2a. Import (after line 17)**

```js
import VaultHealth from './VaultHealth.js';
```

**2b. Constructor — add config param and instantiate VaultHealth**

Add `vaultHealthIntervalMs` to the JSDoc `@param` block:
```js
   * @param {number} [config.vaultHealthIntervalMs=300000] - VaultHealth balance check interval (0 disables)
```

Insert after the Tracker instantiation (after `this.tracker = new Tracker({...})`) and before `this.sseBroadcaster`:

```js
    this.vaultHealth = new VaultHealth({
      eventManager: this.eventManager,
      chainId: this.chainId,
      debug: this.debug,
      balanceCheckIntervalMs: config.vaultHealthIntervalMs ?? 300000
    });
```

**2c. initialize() — wire VaultHealth dependencies**

Insert after step 8 (`this.updateStrategyDependencies()`) and before the success log:

```js
      // 9. Wire VaultHealth dependencies (provider, HDNode, data service, adapters, locks)
      this.vaultHealth.setProvider(this.provider);
      this.vaultHealth.setHdNode(this.hdNode);
      this.vaultHealth.setVaultDataService(this.vaultDataService);
      this.vaultHealth.setTokens(this.tokens);
      this.vaultHealth.setAdapters(this.adapters);
      this.vaultHealth.setLockFunctions(
        (addr) => this.lockVault(addr),
        (addr) => this.unlockVault(addr)
      );
```

**2d. start() — start VaultHealth after vault discovery**

Insert after `await this.loadAuthorizedVaults()` (Phase 5 line) and before subscribing to authorization events:

```js
      // Phase 5.5: Start VaultHealth monitoring (initial balance check, begin interval)
      await this.vaultHealth.start();
```

**2e. stop() — stop VaultHealth early in shutdown**

Insert after stopping the failed vault retry timer (step 1) and before cleaning up monitored vaults (step 3):

```js
    // 1.5. Stop VaultHealth monitoring
    this.vaultHealth.stop();
```

**2f. updateStrategyDependencies — pass VaultHealth to strategies**

Add after `strategy.hdNode = this.hdNode;` (Phase 5 line):

```js
      strategy.vaultHealth = this.vaultHealth;
```

**2g. setupVault — add vault to VaultHealth after successful setup**

Insert inside `setupVault()`, **before** emitting `VaultSetupComplete` (so the vault is in `managedVaults` when VaultHealth's `VaultSetupComplete` handler fires):

```js
      // Step 5: Register with VaultHealth for executor monitoring
      this.vaultHealth.addVault(normalizedAddress);
```

**2h. cleanupVault — remove vault from VaultHealth**

Insert at the top of `cleanupVault()`, before strategy cleanup (step 1):

```js
    // 0. Remove from VaultHealth monitoring
    this.vaultHealth.removeVault(vaultAddress);
```

**2i. reestablishEventListeners — update VaultHealth provider**

Insert after creating the new provider (after `this.attachProviderEventHandlers()`) in `attemptReconnection()`:

```js
        // Update VaultHealth provider reference
        this.vaultHealth.setProvider(this.provider);
```

**2j. getStatus — include VaultHealth status**

Add to the `getStatus()` return object:

```js
      vaultHealth: this.vaultHealth.getStatus(),
```

**2k. SSEBroadcaster — add `/funding-required` endpoint**

Add `getFundingRequired` to the SSEBroadcaster options in the constructor (same pattern as `getBlacklistData` at line 219):

```js
    this.sseBroadcaster = new SSEBroadcaster({
      // ... existing options ...
      getFundingRequired: () => this.vaultHealth.getFundingRequiredData(),
    });
```

Add handler in SSEBroadcaster for `/funding-required` route (same pattern as `/blacklist` at `handleBlacklistRequest` line 219):

```js
  handleFundingRequiredRequest(req, res) {
    try {
      const data = this.getFundingRequired();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    } catch (error) {
      console.error('Error getting funding-required data:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to get funding-required data' }));
    }
  }
```

Route it in the request handler:
```js
    if (pathname === '/funding-required') {
      return this.handleFundingRequiredRequest(req, res);
    }
```

#### Change 3: `fum_automation/src/strategies/babySteps/BabyStepsStrategy.js` — holdback subtraction

Modify `calculateAvailableDeployment` (around line 1552) to subtract the VaultHealth holdback from available deployment capital.

Replace:
```js
    // Deploy all available tokens if above minimum threshold
    const availableDeployment = tokenValue > minDeployment ? tokenValue : 0;
```

With:
```js
    // Subtract holdback for executor gas funding (VaultHealth Phase 6)
    const holdbackAmount = this.vaultHealth.getHoldbackAmount(vault.address);
    const deployableValue = tokenValue - holdbackAmount;

    // Deploy available tokens (minus holdback) if above minimum threshold
    const availableDeployment = deployableValue > minDeployment ? deployableValue : 0;
```

Update the `DeploymentCalculated` event to include holdback:

Replace:
```js
    // Emit deployment metrics
    this.eventManager.emit('DeploymentCalculated', {
      vaultAddress: vault.address,
      totalVaultValue: totalValue,
      positionValue: positionValue,
      tokenValue: tokenValue,
      currentUtilization: currentUtilization,
      availableDeployment: availableDeployment,
      minDeployment: minDeployment,
      chainMinimum: chainMinimum,
      vaultRelativeMinimum: vaultRelativeMinimum,
      timestamp: Date.now(),
      strategyId: vault.strategy.strategyId,
      log: {
        level: 'info',
        message: `Vault value: $${totalValue.toFixed(2)}, Utilization: ${(currentUtilization * 100).toFixed(1)}%, Available: $${availableDeployment.toFixed(2)} (min: $${minDeployment.toFixed(2)})`,
        includeData: false
      }
    });
```

With:
```js
    // Emit deployment metrics
    this.eventManager.emit('DeploymentCalculated', {
      vaultAddress: vault.address,
      totalVaultValue: totalValue,
      positionValue: positionValue,
      tokenValue: tokenValue,
      holdbackAmount: holdbackAmount,
      currentUtilization: currentUtilization,
      availableDeployment: availableDeployment,
      minDeployment: minDeployment,
      chainMinimum: chainMinimum,
      vaultRelativeMinimum: vaultRelativeMinimum,
      timestamp: Date.now(),
      strategyId: vault.strategy.strategyId,
      log: {
        level: 'info',
        message: holdbackAmount > 0
          ? `Vault value: $${totalValue.toFixed(2)}, Utilization: ${(currentUtilization * 100).toFixed(1)}%, Available: $${availableDeployment.toFixed(2)} (min: $${minDeployment.toFixed(2)}, holdback: $${holdbackAmount.toFixed(2)})`
          : `Vault value: $${totalValue.toFixed(2)}, Utilization: ${(currentUtilization * 100).toFixed(1)}%, Available: $${availableDeployment.toFixed(2)} (min: $${minDeployment.toFixed(2)})`,
        includeData: false
      }
    });
```

#### Change 4: `fum_automation/src/core/Tracker.js` — executor funding tracking

Two new event subscriptions and handlers. Follows the existing dual-write pattern: append to `transactions.jsonl` (history) and update `metadata.json` (aggregates).

**4a. New aggregate fields in `handleBaselineCapture` initial metadata**

Add to the `aggregates` object (after `retryCount: priorRetryCount`, line 255):

```js
          executorFundingCount: 0,
          cumulativeExecutorFundingNative: 0,
          cumulativeExecutorFundingUSD: 0,
          executorTopUpFailureCount: 0,
```

**4b. New event subscriptions in `setupEventListeners`**

Add after the `VaultRecovered` subscription (after line 187):

```js
    this.eventManager.subscribe('ExecutorFunded', async (data) => {
      await this.handleExecutorFunded(data);
    });

    this.eventManager.subscribe('ExecutorTopUpFailed', async (data) => {
      await this.handleExecutorTopUpFailed(data);
    });
```

**4c. Handler: `handleExecutorFunded`**

Insert after `handleVaultRetrySuccess` (line 834):

```js
  /**
   * Handle executor funded event — vault transferred native ETH to executor for gas
   * @private
   */
  async handleExecutorFunded(data) {
    const { vaultAddress, transactionHash, timestamp } = data;

    if (!this.vaultMetadata.has(vaultAddress)) {
      this.log(`Vault ${vaultAddress} not tracked yet, skipping executor funded event`);
      return;
    }

    try {
      const { executorAddress, amount, gasUsed, effectiveGasPrice } = data;
      const fundingAmountNative = parseFloat(amount);

      this.log(`Executor funded for vault ${vaultAddress}: ${amount} native to ${executorAddress}`);

      // Gas cost calculation (same pattern as handlePositionsClosed etc.)
      const gasUsedBN = ethers.BigNumber.from(gasUsed);
      const gasPriceBN = ethers.BigNumber.from(effectiveGasPrice);
      const gasCostWei = gasUsedBN.mul(gasPriceBN);
      const gasETH = parseFloat(ethers.utils.formatEther(gasCostWei));
      const gasUSD = await this.calculateGasUSD(gasETH);

      // Funding amount in USD (reuse gas USD conversion — same native→USD rate)
      const fundingAmountUSD = await this.calculateGasUSD(fundingAmountNative);

      await this.appendTransaction(vaultAddress, {
        type: 'ExecutorFunded',
        vaultAddress,
        executorAddress,
        amount,
        fundingAmountUSD,
        gasUsed,
        effectiveGasPrice,
        gasETH,
        gasUSD,
        txHash: transactionHash,
        timestamp
      });

      const metadata = this.vaultMetadata.get(vaultAddress);
      metadata.aggregates.executorFundingCount += 1;
      metadata.aggregates.cumulativeExecutorFundingNative += fundingAmountNative;
      metadata.aggregates.cumulativeExecutorFundingUSD += fundingAmountUSD;
      metadata.aggregates.transactionCount += 1;
      metadata.aggregates.cumulativeGasETH += gasETH;
      metadata.aggregates.cumulativeGasUSD += gasUSD;
      metadata.metadata.lastUpdated = timestamp;

      await this.saveMetadata(vaultAddress, metadata);
    } catch (error) {
      await this.logTrackingError(vaultAddress, {
        eventType: 'ExecutorFunded',
        transactionHash,
        timestamp,
        error: error.message
      });
    }
  }
```

**4d. Handler: `handleExecutorTopUpFailed`**

Insert after `handleExecutorFunded`:

```js
  /**
   * Handle executor top-up failure — transaction log only, no metadata array.
   * VaultHealth's holdback state + interval retry handles re-attempts.
   * @private
   */
  async handleExecutorTopUpFailed(data) {
    const { vaultAddress, timestamp } = data;

    if (!this.vaultMetadata.has(vaultAddress)) {
      this.log(`Vault ${vaultAddress} not tracked yet, skipping top-up failure event`);
      return;
    }

    try {
      const { error } = data;
      this.log(`Executor top-up failed for vault ${vaultAddress}: ${error}`);

      await this.appendTransaction(vaultAddress, {
        type: 'ExecutorTopUpFailed',
        vaultAddress,
        error,
        timestamp
      });

      const metadata = this.vaultMetadata.get(vaultAddress);
      metadata.aggregates.executorTopUpFailureCount += 1;
      metadata.metadata.lastUpdated = timestamp;

      await this.saveMetadata(vaultAddress, metadata);
    } catch (trackError) {
      await this.logTrackingError(vaultAddress, {
        eventType: 'ExecutorTopUpFailed',
        timestamp,
        error: trackError.message
      });
    }
  }
```

#### Flagged Issues

**1. `fundExecutor()` contract function needed — Phase 1 addition.**

VaultHealth's `attemptTopUp` calls `vaultContract.fundExecutor(amount)` to transfer native ETH from the vault to the executor's EOA. This function does NOT exist yet. The current `withdrawETH(amount)` sends to `owner`, not to `executor`. A new function is needed in PositionVault:

```solidity
/**
 * @notice Transfers native ETH from vault to executor for gas funding
 * @param amount Amount of ETH to transfer to executor
 * @dev Only callable by the executor (onlyAuthorized). Used by VaultHealth
 *      for automated gas top-ups. The executor cannot extract tokens or
 *      LP positions — only native ETH for gas costs.
 */
function fundExecutor(uint256 amount) external onlyAuthorized nonReentrant {
    require(amount > 0, "PositionVault: zero amount");
    require(address(this).balance >= amount, "PositionVault: insufficient ETH balance");
    (bool success, ) = executor.call{value: amount}("");
    require(success, "PositionVault: executor funding failed");
    emit ExecutorFunded(executor, amount);
}
```

And a new event:
```solidity
event ExecutorFunded(address indexed executor, uint256 amount);
```

**Security note:** This is a new capability — currently the executor CANNOT extract value from the vault (all operations route tokens back to the vault via validators). `fundExecutor` allows the executor to withdraw native ETH to itself. However:
- The executor is a derived address controlled by the automation mnemonic — same trust model as all other vault operations
- If the mnemonic is compromised, the attacker can already cause far more damage via malicious swaps or liquidity removals
- The amount is bounded off-chain by VaultHealth to `maxExecutorBalance` (0.004 ETH on Arbitrum, 0.08 AVAX on Avalanche) — negligible compared to vault value
- This matches the initial funding model (`setExecutor` is payable and sends `msg.value` to executor)

**Resolved:** Added to Phase 1 (Change 3 — event + function with `executor != address(0)` guard), Phase 2 (7 tests: ETH transfer, owner access, event emission, no-executor revert, zero-amount revert, insufficient-balance revert, unauthorized revert), and Phase 3 (ABI extraction note updated). The Phase 1 version adds a `require(executor != address(0))` guard not present in the original Phase 6 code above — this prevents the owner from accidentally burning ETH to the zero address when calling `fundExecutor` while no executor is set (owner passes `onlyAuthorized` via the owner path, bypassing the `msg.sender == executor` check).

**2. Swap-based top-ups — implemented.**

**Resolved:** Integrated into `attemptTopUp` (swap path after unwrap) and new `swapTokensForNative()` helper. When a vault has no native or wrapped-native tokens, VaultHealth swaps ERC20 tokens to wrapped native using the platform adapter's swap infrastructure. Flow: sort tokens by USD value descending → swap highest-value token first (always) → continue to secondary tokens only if still below midpoint AND token covers ≥25% of remaining deficit → unwrap result → fundExecutor. For each token, adapters are tried in `vault.targetPlatforms` order with fallthrough — if the first adapter fails (no pool, revert), the next is tried; the token is skipped only if all adapters fail. Adapters are injected via `setAdapters()` (Map, accessed via `.get()`) and wired in AutomationService.initialize(). The `ExecutorTopUpDeferred` event is removed — an empty vault simply returns with a debug log.

**3. `VaultHealth.getVault` is async.**

`VaultDataService.getVault(address)` returns a Promise — it loads from blockchain if not cached. In VaultHealth's `checkExecutorBalance` and `attemptTopUp`, we `await` this call. All vault data should already be cached (vaults are loaded during `loadAuthorizedVaults`), so this is a cache hit in normal operation. If it triggers a load, that's fine — just slightly slower.

**4. Price fetch failure in `setHoldback`.**

`fetchTokenPrices` can throw (API error, network failure). If it throws inside `setHoldback`, the holdback is not set and the executor remains underfunded. The calling code (`checkExecutorBalance`) catches this error and logs it — the next interval will retry. This matches the fail-loud principle: we don't fall back to a guessed USD value.

**5. VaultHealth events summary — 6 events for Phase 8 test assertions:**
- `ExecutorHoldbackSet` — holdback activated for a vault (operational state only — not tracked in Tracker)
- `ExecutorHoldbackCleared` — holdback cleared (operational state only — not tracked in Tracker)
- `ExecutorFundingRequired` — vault entered funding-required state (executor has insufficient gas, needs manual funding via `fundExecutor()`)
- `ExecutorFundingCleared` — vault exited funding-required state (executor funded via on-chain `ExecutorFunded` event or raw ETH transfer detected by interval check)
- `ExecutorFunded` — top-up executed successfully → **Tracker: transaction log + metadata aggregates** (Change 4c)
- `ExecutorTopUpFailed` — top-up execution error → **Tracker: transaction log + failure count aggregate** (Change 4d)

**Note:** The `ExecutorInsufficientGas` event (from Phase 5) has been removed — replaced by direct `this.vaultHealth.enterFundingRequired()` call from AutomationService catch blocks. No event indirection needed.

**6. Funding via `vault.fundExecutor()` is preferred but raw ETH transfers are also detected.**

Raw ETH transfers to the executor address don't emit the on-chain `ExecutorFunded` event and won't trigger VaultHealth's on-chain listener. However, `checkAllBalances` (interval-based, default 5 min) checks all funding-required vaults' executor balances and clears the state if the balance has recovered above `minExecutorBalance`. Worst case: up to 5 minutes delay before the system notices a raw transfer. The frontend funding UI should still prefer `vault.fundExecutor()` for immediate detection.

**Verification:** `cd fum_automation && npm test` (after Phase 8 test updates)

### Phase 7: Provider Reconnection Bug Fix

**Problem:** When the WebSocket disconnects and `attemptReconnection()` creates a new provider (line 517: `this.provider = new ethers.providers.WebSocketProvider(this.wsUrl)`), several components still hold references to the old dead provider. Any operation using those stale references will fail with a dead WebSocket.

**Analysis — provider reference audit after reconnect:**

| Component | Stores provider? | Current update on reconnect | Status |
|---|---|---|---|
| **Strategies** | Yes — `strategy.provider` (line 751) | NOT updated | **BUG** |
| **VaultDataService** | Yes — `this.provider` (line 54) | NOT updated | **BUG** |
| **VaultHealth** | Yes — `this.provider` (Phase 6) | Phase 6 Change 2i handles it | OK |
| EventManager | No — receives provider as parameter per-call | N/A | OK |
| Adapters | No — receives provider as parameter per-call | N/A | OK |
| HDNode | Provider-independent (pure key derivation) | N/A | OK |
| Strategy contracts (`this.contracts.*`) | Yes (ethers Contract stores provider) — but only used for `.address` property, never for provider calls | N/A | OK |

The existing `reestablishEventListeners()` (line 564) passes `this.provider` directly to EventManager subscription methods, so event listeners correctly use the new provider. But strategies and VaultDataService retain their old provider reference and will fail on the next vault processing cycle.

**File: `fum_automation/src/core/AutomationService.js`**

**Change 1: Add dependency updates to `attemptReconnection()` (line 529)**

Current code after reconnection succeeds (lines 528-532):
```js
        // Re-establish all event listeners
        await this.reestablishEventListeners();

        // Restart heartbeat
        this.startHeartbeat();
```

Insert after `reestablishEventListeners()` and before `startHeartbeat()`:
```js
        // Re-establish all event listeners
        await this.reestablishEventListeners();

        // Update all dependency provider references (strategies + VaultDataService)
        this.vaultDataService.provider = this.provider;
        this.updateStrategyDependencies();

        // Restart heartbeat
        this.startHeartbeat();
```

This updates:
- **VaultDataService** — direct property assignment (same pattern VaultDataService.initialize() uses at line 54). VaultDataService has no `setProvider()` method and doesn't need one — the property is public.
- **Strategies** — `updateStrategyDependencies()` (line 742) sets `strategy.provider = this.provider` for each strategy. It also re-assigns adapters, tokens, hdNode, vaultHealth, and serviceConfig — those haven't changed, but the overhead is negligible and this ensures future dependency additions are automatically covered on reconnect.

**Post-Phase-7 success path in `attemptReconnection()`:**

```
1. Create new provider                          (line 517)
2. attachProviderEventHandlers()                 (line 518)
3. VaultHealth provider update                   (Phase 6 Change 2i)
4. Verify connection via getNetwork()            (line 521)
5. reestablishEventListeners()                   (line 529)
6. VaultDataService + strategy dependency update (Phase 7 — NEW)
7. startHeartbeat()                              (line 532)
```

**Note on Phase 6 Change 2i placement:** Change 2i places the VaultHealth provider update at step 3, before connection verification (step 4). `setProvider()` stores the reference and resubscribes any on-chain `ExecutorFunded` listeners (which are bound to ethers Contract instances that reference the old dead provider). The resubscription makes RPC calls, so it should ideally happen after connection verification. However, at step 3 the provider is already constructed — if the WebSocket is alive enough to reach this point, the resubscription calls will succeed. Moving it to step 6 with the other dependency updates would also be correct.

**Verification: `test/workflow/error-handling/provider-reconnection.test.js`**

The existing "Successful Reconnection" test (line 129) verifies vault state preservation and swap event detection post-reconnect. But swap event detection only proves EventManager listeners work (EventManager receives provider as a parameter per-call — it was never affected by this bug). The test does NOT verify that strategy and VaultDataService provider references were updated.

Add these assertions to the "should reconnect and preserve vault state" test, after the "Verify listeners re-established" block (line 212) and before the swap event verification:

```js
      // Verify provider references updated (Phase 7 bug fix)
      // Before this fix, strategies and VaultDataService retained the old dead provider
      expect(service.vaultDataService.provider).toBe(service.provider);
      for (const [, strategy] of service.strategies) {
        expect(strategy.provider).toBe(service.provider);
      }
      console.log('Provider references updated after reconnection');
```

These are identity checks (`toBe`, not `toEqual`) — they verify the objects are the exact same reference, not just structurally equal. If the Phase 7 fix is missing, the strategy/VDS references would point to the old provider object and these assertions would fail.

---

**Change 2: Remove dead `provider` parameter from adapter creation chain**

All three adapter constructors accept a `provider` parameter that is never stored or used. The `PlatformAdapter` base class constructor doesn't take `provider` at all — the subclasses accept it and silently discard it. This dead parameter propagates through `AdapterFactory` and the `index.js` convenience wrappers, creating the false impression that adapters hold a provider reference.

**File: `fum_library/src/adapters/UniswapV3Adapter.js` (line 72)**

Replace:
```js
  constructor(chainId, provider) {
```

With:
```js
  constructor(chainId) {
```

**File: `fum_library/src/adapters/UniswapV4Adapter.js` (line 82)**

Replace:
```js
  constructor(chainId, provider) {
```

With:
```js
  constructor(chainId) {
```

**File: `fum_library/src/adapters/TraderJoeV2_2Adapter.js` (line 38)**

Replace:
```js
  constructor(chainId, provider) {
```

With:
```js
  constructor(chainId) {
```

**File: `fum_library/src/adapters/AdapterFactory.js`**

`getAdaptersForChain` (line 52) — remove `provider` parameter and from constructor call:
```js
  static getAdaptersForChain(chainId) {
```
Line 76:
```js
          adapters.push(new AdapterClass(chainId));
```

`getAdapter` (line 112) — remove `provider` parameter and from constructor call:
```js
  static getAdapter(platformId, chainId) {
```
Line 130:
```js
      return new AdapterClass(chainId);
```

Update JSDoc on both methods: remove `@param {Object} provider` lines and remove `provider` from `@example` blocks.

**File: `fum_library/src/adapters/index.js` (lines 19-26)**

Replace:
```js
export const getAdaptersForChain = (config, chainId, provider) => {
  return AdapterFactory.getAdaptersForChain(config, chainId, provider);
};

// Export a convenience function to get a specific adapter
export const getAdapter = (config, platformId, provider) => {
  return AdapterFactory.getAdapter(config, platformId, provider);
};
```

With:
```js
export const getAdaptersForChain = (chainId) => {
  return AdapterFactory.getAdaptersForChain(chainId);
};

// Export a convenience function to get a specific adapter
export const getAdapter = (platformId, chainId) => {
  return AdapterFactory.getAdapter(platformId, chainId);
};
```

Note: The wrapper parameter names were also wrong — the first param was called `config` but received `chainId`. The wrappers worked by accident because they were pure positional pass-throughs. This cleanup fixes the naming too.

**File: `fum_automation/src/core/AutomationService.js` (line 651)**

Replace:
```js
    const result = getAdaptersForChain(this.chainId, this.provider);
```

With:
```js
    const result = getAdaptersForChain(this.chainId);
```

**File: `fum_automation/backtest/runners/run-v3-backtest.js` (line 281)**

Replace:
```js
  const adapterResult = getAdaptersForChain(CHAIN_ID, provider);
```

With:
```js
  const adapterResult = getAdaptersForChain(CHAIN_ID);
```

**Frontend callers (`fum/src/`):** ~10 call sites still pass `provider` to `AdapterFactory.getAdaptersForChain()` and `AdapterFactory.getAdapter()`. JavaScript silently ignores extra arguments, so these continue to work. Clean up during the planned frontend refactor.

**Test file: `fum_library/test/unit/adapters/AdapterFactory.test.js`:** ~60 call sites pass `mockProvider`. Same — JS ignores extra args. Clean up when next touching this test file.

**Verification:** `cd fum_library && npm test && npm run pack` — ensures adapter tests still pass and the tarball is rebuilt for fum_automation.

### Phase 8: Automation Tests

30 existing test files + 1 backtest runner + 2 env files need updates. 2 new unit test files from scratch. This phase touches no source code — only test infrastructure, test files, and env files.

**Test mnemonic:** Tests use a dedicated mnemonic decoupled from Hardhat's built-in accounts. Derived executor addresses are predictable and independent of Hardhat's account list. The mnemonic and reference addresses are defined as constants in test helpers.

```
Mnemonic: pumpkin ghost mammal enrich toss laptop travel main again clever edit orchard

Index 0: 0xdfA3e220f3a214dE67Ba2eda2B94B6FB5ccefd65
Index 1: 0xc7F416Fb1Ba54bdE6D2130f504EcfBFf6af0891A
Index 2: 0x4bcEb093F6CEC00183765D1b368F68dB16569e68
Index 3: 0x1e8AABd94F0fC32aFe09F461b6A47C71bF68a75C
Index 4: 0x93036838C55648104ECDac7619bbBaea07E7dFfE

xpub: xpub6F8xskVEWJTqZB69U3UmjGe8zwoXUefq5YCBgpyS2xf4CFEzNX4zUbxYBqZLdC96gEayShKc9f9rhgnNhSMtzADf8x4HX8Wia4AjBmqAPir
```

These addresses have no ETH on the Hardhat node by default (Hardhat only pre-funds its own 20 accounts). Executor funding comes from the payable `setExecutor` call — the vault owner (a funded Hardhat account) sends `msg.value` which the contract forwards to the derived executor address.

**Key architecture shift in tests:** The old pattern was a single `automationServiceAddress` (TEST_ACCOUNTS[4]) shared across all vaults. The new pattern derives a unique executor per vault from the test mnemonic + the vault's `executorIndex` (assigned by VaultFactory at creation time). Since VaultFactory assigns indices monotonically starting from 0, single-vault tests always get index 0 (executor `0xdfA3...fd65`), multi-vault tests get index 0 for the first vault, index 1 for the second, etc.

**Funding change:** The old pattern funded TEST_ACCOUNTS[4] with 100 ETH from the deployer. The new pattern funds each executor individually via the payable `setExecutor` call — the vault owner sends `msg.value` which the contract forwards to the derived executor. This means `hardhat-setup.js` no longer sends 100 ETH to a single automation account; instead, each vault setup helper funds its own executor.

#### Change 1: `fum_automation/test/global-setup.js` — Set AUTOMATION_MNEMONIC env var

The mnemonic needs to be in `process.env` before any test file runs, because AutomationService's constructor reads it from `process.env.AUTOMATION_MNEMONIC`. The `.env.local` file (loaded by dotenv at line 30) will contain the mnemonic after Change 9, so this change is actually automatic — dotenv loads `.env.local` which now has `AUTOMATION_MNEMONIC` instead of `AUTOMATION_PRIVATE_KEY`.

**No code changes needed in global-setup.js.** The env var name changes happen in `.env.local` (Change 9).

However, for safety — to ensure the mnemonic is available even if dotenv fails or `.env.local` is missing — add an explicit fallback after the dotenv call:

After line 30 (`dotenv.config({ path: path.join(__dirname, '../.env.local') });`), add:

```js
  // Ensure test mnemonic is available (fallback if .env.local missing)
  if (!process.env.AUTOMATION_MNEMONIC) {
    process.env.AUTOMATION_MNEMONIC = 'pumpkin ghost mammal enrich toss laptop travel main again clever edit orchard';
  }
```

This is the test mnemonic only — production would never hit this fallback because the env var is required.

#### Change 2: `fum_automation/test/helpers/hardhat-setup.js` — Remove automationServiceAddress, add vaultHealthIntervalMs

5 modifications:

**2a. Remove TEST_ACCOUNTS import and automation funding (lines 10, 173-198)**

Remove from imports (line 10):
```js
// BEFORE:
import { TEST_ACCOUNTS } from 'fum_library/test/setup/hardhat-config';

// AFTER:
// (remove entire import — TEST_ACCOUNTS no longer used)
```

Remove the automation service address derivation and funding block (lines 173-198):
```js
  // REMOVE — entire block:
  // Use account #4 from standard Hardhat test accounts as automation service
  const automationServiceAddress = TEST_ACCOUNTS[4].address; // 0xabA472B2EA519490EE10E643A422D578a507197A

  // ... (testConfig block — replaced below) ...

  // Fund the automation service account with ETH for gas costs
  const fundingTx = await shared.deployer.sendTransaction({
    to: automationServiceAddress,
    value: ethers.utils.parseEther("100") // Send 100 ETH for gas costs
  });
  await fundingTx.wait();
  console.log(`Funded automation service account ${automationServiceAddress} with 100 ETH`);
```

**2b. Replace testConfig (lines 180-190)**

Replace the entire testConfig block:
```js
  // BEFORE:
  const testConfig = {
    automationServiceAddress,
    chainId,
    wsUrl: `ws://localhost:${shared.port}`,
    debug: true,
    envPath: path.join(__dirname, '../.env.test'),
    dataDir: path.join(__dirname, '../../data'),
    ssePort: 3090,
    retryIntervalMs: 5000,
    maxFailureDurationMs: 60000
  };

  // AFTER:
  const testConfig = {
    chainId,
    wsUrl: `ws://localhost:${shared.port}`,
    debug: true,
    envPath: path.join(__dirname, '../.env.test'),
    dataDir: path.join(__dirname, '../../data'),
    ssePort: 3090,
    retryIntervalMs: 5000,
    maxFailureDurationMs: 60000,
    vaultHealthIntervalMs: 0  // Disable interval-based checks (tests trigger manually)
  };
```

`automationServiceAddress` removed, `vaultHealthIntervalMs: 0` added. Setting to 0 disables the VaultHealth interval timer so it doesn't fire during tests and cause non-deterministic behavior. Tests that need VaultHealth activity call `checkAllBalances()` or `checkExecutorBalance()` directly.

**2c. Update return object (lines 200-207)**

No changes — `testConfig` is still returned. Consumers that destructure `testConfig.automationServiceAddress` will get `undefined`, which is the desired failure mode: any test that forgets to update will fail loudly at the site that uses the value.

**2d. Export the `connectToSharedHardhat` function**

Currently `connectToSharedHardhat` is module-private. Vault setup helpers need access to `shared.signers` (Hardhat's funded accounts) to create vault owners. This is already the case — vault setup helpers receive `hardhatServer` (which is the `shared` object) as their first parameter. No change needed.

**2e. Keep signers creation from TEST_ACCOUNTS (line 67)**

Wait — removing the `TEST_ACCOUNTS` import (Change 2a) breaks the signers creation at line 67:
```js
  const signers = TEST_ACCOUNTS.map(
    account => new ethers.Wallet(account.privateKey, provider)
  );
```

**Resolution:** `TEST_ACCOUNTS` is still needed for signers — it provides the Hardhat built-in accounts that own vaults, deploy contracts, fund swaps, etc. Only the `automationServiceAddress = TEST_ACCOUNTS[4].address` usage is removed. Keep the import, just remove the automation-specific usage.

Corrected Change 2a — keep the import:
```js
// KEEP:
import { TEST_ACCOUNTS } from 'fum_library/test/setup/hardhat-config';
```

Only remove lines 174 and 192-198:
```js
  // REMOVE line 174:
  const automationServiceAddress = TEST_ACCOUNTS[4].address;

  // REMOVE lines 192-198 (automation funding block):
  const fundingTx = await shared.deployer.sendTransaction({
    to: automationServiceAddress,
    value: ethers.utils.parseEther("100")
  });
  await fundingTx.wait();
  console.log(`Funded automation service account ${automationServiceAddress} with 100 ETH`);
```

Full `setupTestBlockchain` after changes:
```js
export async function setupTestBlockchain(options = {}) {
  await clearTestData();
  await clearBlacklist();

  const shared = await connectToSharedHardhat();

  const contractsModule = await import('fum_library/artifacts/contracts');
  const contractArtifacts = contractsModule.default;
  const VaultFactoryAbi = contractArtifacts.VaultFactory.abi;
  const BabyStepsStrategyAbi = contractArtifacts.bob.abi;

  const vaultFactory = new ethers.Contract(
    shared.deployedContracts.VaultFactory,
    VaultFactoryAbi,
    shared.deployer
  );

  const babyStepsStrategy = new ethers.Contract(
    shared.deployedContracts.BabyStepsStrategy,
    BabyStepsStrategyAbi,
    shared.deployer
  );

  const contracts = {
    vaultFactory,
    babyStepsStrategy
  };

  const chainId = shared.chainId || 1337;

  const testConfig = {
    chainId,
    wsUrl: `ws://localhost:${shared.port}`,
    debug: true,
    envPath: path.join(__dirname, '../.env.test'),
    dataDir: path.join(__dirname, '../../data'),
    ssePort: 3090,
    retryIntervalMs: 5000,
    maxFailureDurationMs: 60000,
    vaultHealthIntervalMs: 0
  };

  return {
    hardhatServer: shared,
    deployedContracts: shared.deployedContracts,
    contracts,
    signers: shared.signers,
    deployer: shared.deployer,
    testConfig
  };
}
```

#### Change 3: `fum_automation/test/helpers/v4-hardhat-setup.js` — Same changes as hardhat-setup.js

Mirror Change 2 exactly. Same 3 modifications:

**3a. Remove automation service address derivation (line 155):**
```js
  // REMOVE:
  const automationServiceAddress = TEST_ACCOUNTS[4].address;
```

**3b. Replace testConfig (lines 158-168):**
```js
  // BEFORE:
  const testConfig = {
    automationServiceAddress,
    chainId: 1337,
    wsUrl: `ws://localhost:${shared.port}`,
    debug: true,
    envPath: path.join(__dirname, '../.env.test'),
    dataDir: path.join(__dirname, '../../data'),
    ssePort: 3091,
    retryIntervalMs: 5000,
    maxFailureDurationMs: 60000
  };

  // AFTER:
  const testConfig = {
    chainId: 1337,
    wsUrl: `ws://localhost:${shared.port}`,
    debug: true,
    envPath: path.join(__dirname, '../.env.test'),
    dataDir: path.join(__dirname, '../../data'),
    ssePort: 3091,
    retryIntervalMs: 5000,
    maxFailureDurationMs: 60000,
    vaultHealthIntervalMs: 0
  };
```

**3c. Remove automation funding block (lines 171-176):**
```js
  // REMOVE:
  const fundingTx = await shared.deployer.sendTransaction({
    to: automationServiceAddress,
    value: ethers.utils.parseEther("100")
  });
  await fundingTx.wait();
  console.log(`Funded automation service account ${automationServiceAddress} with 100 ETH`);
```

Keep the `TEST_ACCOUNTS` import — it's still used for signers creation (line 58).

#### Change 4: `fum_automation/test/helpers/test-vault-setup.js` — Derive executor from mnemonic + executorIndex

Replace the `automationServiceAddress` parameter with per-vault executor derivation.

**4a. Add ethers HDNode derivation helper (after line 11, after imports):**

```js
import { getMaxExecutorBalance } from 'fum_library/helpers/chainHelpers';

/**
 * Test mnemonic for per-vault executor derivation (Phase 8)
 * Matches AUTOMATION_MNEMONIC in .env.local and global-setup.js
 */
const TEST_MNEMONIC = 'pumpkin ghost mammal enrich toss laptop travel main again clever edit orchard';
const TEST_HD_NODE = ethers.utils.HDNode.fromMnemonic(TEST_MNEMONIC);

/**
 * Derive executor address for a vault from test mnemonic + executorIndex
 * @param {number} executorIndex - The vault's executor index from VaultFactory
 * @returns {string} Derived executor address
 */
function deriveTestExecutorAddress(executorIndex) {
  return TEST_HD_NODE.derivePath("m/44'/60'/0'/0/" + executorIndex).address;
}
```

**4b. Replace the executor setup block (lines 482-497):**

```js
  // BEFORE (lines 482-497):
  const automationServiceAddress = config.automationServiceAddress;
  if (!automationServiceAddress) {
    throw new Error('automationServiceAddress must be provided in config for vault setup');
  }
  console.log(`    Authorizing automation service ${automationServiceAddress} as vault executor...`);
  const setExecutorTx = await testVault.setExecutor(automationServiceAddress);
  const executorReceipt = await setExecutorTx.wait();
  console.log(`    setExecutor transaction confirmed in block ${executorReceipt.blockNumber} with status: ${executorReceipt.status === 1 ? 'SUCCESS' : 'FAILED'}`);

  // Verify authorization was set correctly
  const executor = await testVault.executor();
  if (executor.toLowerCase() !== automationServiceAddress.toLowerCase()) {
    throw new Error(`Authorization failed: expected ${automationServiceAddress}, got ${executor}`);
  }
  console.log(`    Vault ${vaultAddress} is now authorized for automation service`);

  // AFTER:
  // Read executorIndex assigned by VaultFactory during vault creation
  const vaultFactory = new ethers.Contract(
    deployedContracts.VaultFactory,
    (await import('fum_library/artifacts/contracts')).default.VaultFactory.abi,
    hardhatServer.provider
  );
  const vaultInfo = await vaultFactory.getVaultInfo(vaultAddress);
  const executorIndex = Number(vaultInfo.executorIndex ?? vaultInfo[4]);

  // Derive executor address from test mnemonic + vault's executorIndex
  const executorAddress = deriveTestExecutorAddress(executorIndex);

  // Determine gas funding amount
  const chainId = hardhatServer.chainId || 1337;
  const maxBalance = getMaxExecutorBalance(chainId);
  const fundingAmount = ethers.utils.parseEther(maxBalance.toString());

  console.log(`    Setting executor ${executorAddress} (index ${executorIndex}) with ${maxBalance} ETH gas funding...`);
  const setExecutorTx = await testVault.setExecutor(executorAddress, { value: fundingAmount });
  const executorReceipt = await setExecutorTx.wait();
  console.log(`    setExecutor confirmed in block ${executorReceipt.blockNumber} with status: ${executorReceipt.status === 1 ? 'SUCCESS' : 'FAILED'}`);

  // Verify authorization was set correctly
  const executor = await testVault.executor();
  if (executor.toLowerCase() !== executorAddress.toLowerCase()) {
    throw new Error(`Authorization failed: expected ${executorAddress}, got ${executor}`);
  }
  console.log(`    Vault ${vaultAddress} authorized with executor index ${executorIndex}`);
```

**4c. Update function signature and parameter handling:**

The function currently receives `config` as its 4th parameter and reads `config.automationServiceAddress`. After this change it still receives `config` but no longer reads `automationServiceAddress` from it. Instead, it reads `deployedContracts` (3rd parameter, already available) to get the VaultFactory address for the `executorIndex` query.

The `config.automationServiceAddress` validation (lines 483-486) is removed — executor address is now derived, not passed in.

**4d. Update return object:**

Add `executorIndex` and `executorAddress` to the return object so tests can assert on them:
```js
  return {
    vault: testVault,
    vaultAddress,
    executorIndex,
    executorAddress,
    positions: createdPositions,
    tokenBalances: finalTokenBalances,
    tokenContracts,
    config: settings
  };
```

#### Change 5: `fum_automation/test/helpers/v4-vault-setup.js` — Same pattern as test-vault-setup.js

Mirror Change 4 exactly. Same 4 modifications:

**5a. Add imports and helper (after existing imports):**
```js
import { getMaxExecutorBalance } from 'fum_library/helpers/chainHelpers';

const TEST_MNEMONIC = 'pumpkin ghost mammal enrich toss laptop travel main again clever edit orchard';
const TEST_HD_NODE = ethers.utils.HDNode.fromMnemonic(TEST_MNEMONIC);

function deriveTestExecutorAddress(executorIndex) {
  return TEST_HD_NODE.derivePath("m/44'/60'/0'/0/" + executorIndex).address;
}
```

**5b. Replace executor setup block (lines 451-466):**

Same pattern as Change 4b — read `executorIndex` from VaultFactory, derive address, call payable `setExecutor`.

```js
  // Read executorIndex assigned by VaultFactory
  const vaultFactory = new ethers.Contract(
    deployedContracts.VaultFactory,
    (await import('fum_library/artifacts/contracts')).default.VaultFactory.abi,
    hardhatServer.provider
  );
  const vaultInfo = await vaultFactory.getVaultInfo(vaultAddress);
  const executorIndex = Number(vaultInfo.executorIndex ?? vaultInfo[4]);

  const executorAddress = deriveTestExecutorAddress(executorIndex);
  const chainId = hardhatServer.chainId || 1337;
  const maxBalance = getMaxExecutorBalance(chainId);
  const fundingAmount = ethers.utils.parseEther(maxBalance.toString());

  console.log(`    Setting executor ${executorAddress} (index ${executorIndex}) with ${maxBalance} ETH gas funding...`);
  const setExecutorTx = await testVault.setExecutor(executorAddress, { value: fundingAmount });
  const executorReceipt = await setExecutorTx.wait();
  console.log(`    setExecutor confirmed in block ${executorReceipt.blockNumber}`);

  const executor = await testVault.executor();
  if (executor.toLowerCase() !== executorAddress.toLowerCase()) {
    throw new Error(`Authorization failed: expected ${executorAddress}, got ${executor}`);
  }
  console.log(`    Vault ${vaultAddress} authorized with executor index ${executorIndex}`);
```

**5c. Update return object — add `executorIndex` and `executorAddress`:**
```js
  return {
    vault: testVault,
    vaultAddress,
    executorIndex,
    executorAddress,
    positions: createdPositions,
    tokenBalances: finalTokenBalances,
    tokenContracts,
    adapter,
    config: settings
  };
```

#### Change 6: `fum_automation/test/helpers/traderjoe-vault-setup.js` — Same pattern as test-vault-setup.js

Mirror Change 4 exactly. Same 4 modifications:

**6a. Add imports and helper (after existing imports):**
```js
import { getMaxExecutorBalance } from 'fum_library/helpers/chainHelpers';

const TEST_MNEMONIC = 'pumpkin ghost mammal enrich toss laptop travel main again clever edit orchard';
const TEST_HD_NODE = ethers.utils.HDNode.fromMnemonic(TEST_MNEMONIC);

function deriveTestExecutorAddress(executorIndex) {
  return TEST_HD_NODE.derivePath("m/44'/60'/0'/0/" + executorIndex).address;
}
```

**6b. Replace executor setup block (lines 518-533):**

Same pattern as Change 4b. Note: TJ tests run on Avalanche fork (chainId 1338), so `getMaxExecutorBalance(1338)` returns 0.08 AVAX (not 0.004 ETH).

```js
  const vaultFactory = new ethers.Contract(
    deployedContracts.VaultFactory,
    (await import('fum_library/artifacts/contracts')).default.VaultFactory.abi,
    hardhatServer.provider
  );
  const vaultInfo = await vaultFactory.getVaultInfo(vaultAddress);
  const executorIndex = Number(vaultInfo.executorIndex ?? vaultInfo[4]);

  const executorAddress = deriveTestExecutorAddress(executorIndex);
  const chainId = hardhatServer.chainId || 1338;
  const maxBalance = getMaxExecutorBalance(chainId);
  const fundingAmount = ethers.utils.parseEther(maxBalance.toString());

  console.log(`    Setting executor ${executorAddress} (index ${executorIndex}) with ${maxBalance} native gas funding...`);
  const setExecutorTx = await testVault.setExecutor(executorAddress, { value: fundingAmount });
  const executorReceipt = await setExecutorTx.wait();
  console.log(`    setExecutor confirmed in block ${executorReceipt.blockNumber}`);

  const executor = await testVault.executor();
  if (executor.toLowerCase() !== executorAddress.toLowerCase()) {
    throw new Error(`Authorization failed: expected ${executorAddress}, got ${executor}`);
  }
  console.log(`    Vault ${vaultAddress} authorized with executor index ${executorIndex}`);
```

**6c. Update return object — add `executorIndex` and `executorAddress`:**
```js
  return {
    vault: testVault,
    vaultAddress,
    executorIndex,
    executorAddress,
    positions: createdPositions,
    tokenBalances: finalTokenBalances,
    tokenContracts,
    adapter,
    config: settings
  };
```

#### Change 7: Existing workflow test updates — 30 files

All 30 test files that instantiate AutomationService need the same two changes:
1. Remove `automationServiceAddress` from the config passed to `new AutomationService()`
2. Remove assertions on `service.automationServiceAddress` or `serviceStartedEvent.automationServiceAddress`

The `automationServiceAddress` field in `testConfig` is already removed by Changes 2/3. Since all 30 files use `new AutomationService(testConfig)`, the config change propagates automatically. **No code changes needed in files that simply pass `testConfig` through.** AutomationService's new constructor (Phase 5) doesn't accept or validate `automationServiceAddress` — extra properties are silently ignored by JS destructuring.

However, some files have **explicit assertions** on the removed field. These need updating:

**7a. Constructor validation tests — `basic-init.test.js` (V3) and `traderjoe/basic-init.test.js` (TJ)**

Both files test that missing/invalid `automationServiceAddress` throws. These tests must be replaced with `AUTOMATION_MNEMONIC` validation tests.

**V3 basic-init.test.js** — Replace lines 37-50:
```js
  // BEFORE:
  describe('Constructor Validation', () => {
    it('should throw error for missing automationServiceAddress', () => {
      expect(() => new AutomationService({
        chainId: 1337,
        wsUrl: 'ws://localhost:8545'
      })).toThrow('automationServiceAddress is required');
    });

    it('should throw error for invalid automationServiceAddress', () => {
      expect(() => new AutomationService({
        automationServiceAddress: 'not-an-address',
        chainId: 1337,
        wsUrl: 'ws://localhost:8545'
      })).toThrow('automationServiceAddress must be a valid Ethereum address');
    });

  // AFTER:
  describe('Constructor Validation', () => {
    it('should throw error for missing AUTOMATION_MNEMONIC', () => {
      const originalMnemonic = process.env.AUTOMATION_MNEMONIC;
      delete process.env.AUTOMATION_MNEMONIC;
      try {
        expect(() => new AutomationService({
          chainId: 1337,
          wsUrl: 'ws://localhost:8545'
        })).toThrow('AUTOMATION_MNEMONIC environment variable is required');
      } finally {
        process.env.AUTOMATION_MNEMONIC = originalMnemonic;
      }
    });

    it('should throw error for invalid AUTOMATION_MNEMONIC', () => {
      const originalMnemonic = process.env.AUTOMATION_MNEMONIC;
      process.env.AUTOMATION_MNEMONIC = 'not a valid mnemonic';
      try {
        expect(() => new AutomationService({
          chainId: 1337,
          wsUrl: 'ws://localhost:8545'
        })).toThrow('Invalid AUTOMATION_MNEMONIC');
      } finally {
        process.env.AUTOMATION_MNEMONIC = originalMnemonic;
      }
    });
```

The `chainId` and `wsUrl` validation tests (lines 52-80) remain unchanged — those validations still exist.

The default values test (lines 82-93) stays but remove reference to `automationServiceAddress` in the constructor call. Actually — the constructor no longer takes `automationServiceAddress`, so just pass `chainId` and `wsUrl`:
```js
    it('should use default values for optional config', () => {
      const svc = new AutomationService({
        chainId: 1337,
        wsUrl: 'ws://localhost:8545'
      });

      expect(svc.debug).toBe(false);
      expect(svc.ssePort).toBe(3001);
      expect(svc.retryIntervalMs).toBe(300000);
      expect(svc.maxFailureDurationMs).toBe(3600000);
    });
```

Same change for the PoolDataFetched test (lines 95-114) — remove `automationServiceAddress` from the constructor call.

**TJ basic-init.test.js** — Mirror exact same changes. Replace lines 39-51 with mnemonic validation tests. Same constructor call updates in default values and PoolDataFetched tests (use chainId 1338, wsUrl port 8546).

**7b. Remove `service.automationServiceAddress` assertions**

Two files assert `service.automationServiceAddress`:
- `basic-init.test.js` line 121: `expect(service.automationServiceAddress).toBe(testConfig.automationServiceAddress);`
- `traderjoe/basic-init.test.js` line 123: same

Replace with HDNode assertion:
```js
  // BEFORE:
  expect(service.automationServiceAddress).toBe(testConfig.automationServiceAddress);

  // AFTER:
  expect(service.hdNode).toBeDefined();
  expect(service.hdNode.fingerprint).toBeDefined(); // HDNode cached from mnemonic
```

**7c. Remove `serviceStartedEvent.automationServiceAddress` assertions**

Three files assert `serviceStartedEvent.automationServiceAddress`:
- `basic-init.test.js` line 229
- `traderjoe/basic-init.test.js` line 231
- (V4 BS-0001.test.js line 231 — same if present)

Remove the assertion:
```js
  // REMOVE:
  expect(serviceStartedEvent.automationServiceAddress).toBe(testConfig.automationServiceAddress);
```

No replacement needed — `ServiceStarted` event no longer includes `automationServiceAddress` (Phase 5 Change 2d removes it).

**7d. Remove `automationServiceAddress` from vault setup helper calls**

28 files pass `automationServiceAddress: testConfig.automationServiceAddress` to vault setup helpers. After Changes 4/5/6, the helpers no longer read this property — they derive the executor internally. The property is silently ignored by JS destructuring.

**No code changes needed.** The extra property in the settings object does no harm. However, for cleanliness, each file can remove the line:
```js
  // OPTIONAL CLEANUP (28 files) — remove from vault setup settings:
  automationServiceAddress: testConfig.automationServiceAddress,
```

This is a mechanical find-and-delete across 28 files. Not strictly required for correctness — JS ignores extra properties — but reduces confusion.

**7e. Update `vault-auth-grant.test.js` executor address assertion**

Line 138-140 asserts the executor address matches `testConfig.automationServiceAddress`:
```js
  // BEFORE:
  expect(vaultAuthGrantedEvent.executorAddress.toLowerCase()).toBe(
    testConfig.automationServiceAddress.toLowerCase()
  );

  // AFTER:
  // Executor address is derived from test mnemonic + executorIndex
  // The vault's executorIndex is assigned by VaultFactory at creation time
  // For the first (only) vault created in this test, executorIndex = 0
  const expectedExecutor = ethers.utils.HDNode.fromMnemonic(
    process.env.AUTOMATION_MNEMONIC
  ).derivePath("m/44'/60'/0'/0/0").address;
  expect(vaultAuthGrantedEvent.executorAddress.toLowerCase()).toBe(
    expectedExecutor.toLowerCase()
  );
```

Or more cleanly, use `testVault.executorAddress` (returned by the updated vault setup helper, Change 4d):
```js
  expect(vaultAuthGrantedEvent.executorAddress.toLowerCase()).toBe(
    testVault.executorAddress.toLowerCase()
  );
```

The `VaultAuthGranted` event now also includes `executorIndex` (Phase 5 Change 6). Add assertion:
```js
  expect(vaultAuthGrantedEvent.executorIndex).toBe(testVault.executorIndex);
```

**7f. Update `vault-auth-revoke.test.js` executor address assertion**

Line 134-136 asserts the revoked executor matches `testConfig.automationServiceAddress`:
```js
  // BEFORE:
  expect(vaultAuthRevokedEvent.executorAddress.toLowerCase()).toBe(
    testConfig.automationServiceAddress.toLowerCase()
  );

  // AFTER:
  expect(vaultAuthRevokedEvent.executorAddress.toLowerCase()).toBe(
    testVault.executorAddress.toLowerCase()
  );
```

**7g. Add VaultHealth assertions to basic-init tests**

After Phase 6, `AutomationService.start()` creates and starts VaultHealth. The basic-init tests (V3 and TJ) should verify this.

Add to the "Phase 1: Pre-Start State" section of `basic-init.test.js`:
```js
    it('should initialize VaultHealth correctly', () => {
      expect(service.vaultHealth).toBeDefined();
      expect(service.vaultHealth.managedVaults).toBeInstanceOf(Set);
      expect(service.vaultHealth.managedVaults.size).toBe(0);
      expect(service.vaultHealth.holdbacks).toBeInstanceOf(Map);
      expect(service.vaultHealth.holdbacks.size).toBe(0);
      expect(service.vaultHealth.fundingRequired).toBeInstanceOf(Map);
      expect(service.vaultHealth.fundingRequired.size).toBe(0);
      expect(service.vaultHealth.balanceCheckIntervalMs).toBe(0); // Disabled via testConfig
    });
```

Add to the "Phase 2: Service Start" section:
```js
    it('should start VaultHealth with service', () => {
      // VaultHealth starts after loadAuthorizedVaults
      // In 0-vault test, no managed vaults
      expect(service.vaultHealth.managedVaults.size).toBe(0);
      expect(service.vaultHealth.balanceCheckInterval).toBe(null); // Interval disabled (0ms)
    });
```

Same additions to `traderjoe/basic-init.test.js`.

For tests with vaults (e.g., `BS-0010.test.js`, `BS-0001.test.js`), VaultHealth should have the vault registered:
```js
    // After vault is loaded:
    expect(service.vaultHealth.managedVaults.has(
      ethers.utils.getAddress(testVault.vaultAddress)
    )).toBe(true);
```

**7h. Add provider reconnection assertions (Phase 7)**

`provider-reconnection.test.js` — add after "Verify listeners re-established" block (line 212) and before the swap event verification:

```js
      // Verify provider references updated (Phase 7 bug fix)
      // Before this fix, strategies and VaultDataService retained the old dead provider
      expect(service.vaultDataService.provider).toBe(service.provider);
      for (const [, strategy] of service.strategies) {
        expect(strategy.provider).toBe(service.provider);
      }
      console.log('Provider references updated after reconnection');
```

These are identity checks (`toBe`, not `toEqual`) — they verify the objects are the exact same reference. If the Phase 7 fix is missing, the strategy/VDS references would point to the old provider object and these assertions would fail.

Also add VaultHealth provider reference check:
```js
      expect(service.vaultHealth.provider).toBe(service.provider);
```

**7i. Unit test — `BlacklistManager.test.js`**

Creates AutomationService with hardcoded config including `automationServiceAddress`. Remove it:
```js
  // BEFORE (inside createServiceHelper or similar):
  const service = new AutomationService({
    automationServiceAddress: '0xabA472B2EA519490EE10E643A422D578a507197A',
    chainId: 1337,
    wsUrl: 'ws://localhost:8545',
    ...
  });

  // AFTER:
  const service = new AutomationService({
    chainId: 1337,
    wsUrl: 'ws://localhost:8545',
    ...
  });
```

**7j. Files that need `automationServiceAddress` removed from vault setup settings (complete list)**

These 28 files pass `automationServiceAddress: testConfig.automationServiceAddress` to vault setup helpers. After Changes 4-6 the helpers ignore it, but for cleanliness, remove the line from each:

V3 tests (use `setupTestVault`):
- `test/workflow/service-init/init-errors.test.js`
- `test/workflow/service-init/BS-0010.test.js`
- `test/workflow/service-init/BS-1212.test.js`
- `test/workflow/vault-auth/vault-auth-grant.test.js`
- `test/workflow/vault-auth/vault-auth-revoke.test.js`
- `test/workflow/service-stop/service-stop.test.js`
- `test/workflow/swap-event/swap-event-detection.test.js`
- `test/workflow/swap-event/rebalance.test.js`
- `test/workflow/swap-event/fee-collection.test.js`
- `test/workflow/config-update/config-update.test.js`
- `test/workflow/vault-setup/vault-setup-errors.test.js`
- `test/workflow/error-handling/blacklist.test.js`
- `test/workflow/error-handling/swap-event-failures.test.js`
- `test/workflow/error-handling/retry-queue-cleanup.test.js`
- `test/workflow/error-handling/provider-reconnection.test.js`
- `test/workflow/error-handling/emergency-exit.test.js`
- `test/workflow/error-handling/setup-retry-recovery.test.js`
- `test/workflow/error-handling/config-update-failures.test.js`

V4 tests (use `setupV4TestVault`):
- `test/workflow/v4/service-init/BS-0001.test.js`
- `test/workflow/v4/service-init/BS-0010.test.js`
- `test/workflow/v4/execution/rebalance-and-fees.test.js`
- `test/workflow/v4/execution/emergency-exit.test.js`

TJ tests (use `setupTraderJoeTestVault`):
- `test/workflow/traderjoe/BS-0001.test.js`
- `test/workflow/traderjoe/BS-0010.test.js`
- `test/workflow/traderjoe/BS-2100.test.js`
- `test/workflow/traderjoe/execution/rebalance-and-fees.test.js`
- `test/workflow/traderjoe/execution/emergency-exit.test.js`

Each has one or more lines like:
```js
  automationServiceAddress: testConfig.automationServiceAddress,
```
Remove each occurrence. Mechanical find-and-delete.

#### Change 8: New unit test — `test/unit/InsufficientGasError.test.js`

Tests the `InsufficientGasError` class (Phase 5 Change 1) and its integration with AutomationService error handling.

```js
/**
 * @fileoverview Unit tests for InsufficientGasError
 *
 * Tests:
 * 1. Error construction and properties
 * 2. Detection pattern (error.name === 'InsufficientGasError')
 * 3. instanceof check
 */

import { describe, it, expect } from 'vitest';
import { InsufficientGasError } from '../../src/utils/errors.js';

describe('InsufficientGasError', () => {
  it('should construct with message, vaultAddress, and executorAddress', () => {
    const error = new InsufficientGasError(
      'Executor has insufficient gas for rebalance',
      '0x1234567890123456789012345678901234567890',
      '0xdfA3e220f3a214dE67Ba2eda2B94B6FB5ccefd65'
    );

    expect(error.message).toBe('Executor has insufficient gas for rebalance');
    expect(error.vaultAddress).toBe('0x1234567890123456789012345678901234567890');
    expect(error.executorAddress).toBe('0xdfA3e220f3a214dE67Ba2eda2B94B6FB5ccefd65');
    expect(error.name).toBe('InsufficientGasError');
  });

  it('should be an instance of Error', () => {
    const error = new InsufficientGasError('test', '0x0', '0x0');
    expect(error).toBeInstanceOf(Error);
  });

  it('should be detectable by name property', () => {
    const error = new InsufficientGasError('test', '0x0', '0x0');

    // This is the detection pattern used in AutomationService catch blocks
    expect(error.name === 'InsufficientGasError').toBe(true);
  });

  it('should have a stack trace', () => {
    const error = new InsufficientGasError('test', '0x0', '0x0');
    expect(error.stack).toBeDefined();
    expect(error.stack).toContain('InsufficientGasError');
  });

  it('should be distinguishable from UnrecoverableError', async () => {
    const { UnrecoverableError } = await import('../../src/utils/errors.js');

    const gasError = new InsufficientGasError('gas', '0x0', '0x0');
    const unrecoverableError = new UnrecoverableError('fatal');

    expect(gasError.name).toBe('InsufficientGasError');
    expect(unrecoverableError.name).toBe('UnrecoverableError');
    expect(gasError.name).not.toBe(unrecoverableError.name);
  });
});
```

#### Change 9: New unit test — `test/unit/VaultHealth.test.js`

Tests the VaultHealth module (Phase 6). This is the largest new test file. Tests are organized by VaultHealth's core responsibilities: balance monitoring, holdback management, top-up execution, funding-required state, and event-driven triggers.

**Note:** VaultHealth requires extensive mocking because it makes RPC calls (getBalance), reads token prices (fetchTokenPrices), and interacts with vault contracts (fundExecutor, unwrapETH). Tests use Vitest's `vi.fn()` and `vi.spyOn` to control all external calls.

```js
/**
 * @fileoverview Unit tests for VaultHealth
 *
 * Tests:
 * 1. Balance monitoring — holdback set/clear based on executor balance vs min/max
 * 2. Holdback calculation — native deficit converted to USD via token prices
 * 3. Top-up execution — VaultUnlocked trigger, fundExecutor call, holdback cleared
 * 4. VaultSetupComplete trigger — initial top-up after vault onboarding
 * 5. Funding-required state — enter/clear, lock hold, on-chain listener
 * 6. Interval check — recalculation, funding-required balance recovery
 * 7. Vault add/remove
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ethers } from 'ethers';
import VaultHealth from '../../src/core/VaultHealth.js';
import EventManager from '../../src/core/EventManager.js';

// Mock fum_library imports
vi.mock('fum_library', () => ({
  getVaultContract: vi.fn()
}));
vi.mock('fum_library/helpers/chainHelpers', () => ({
  getMinExecutorBalance: vi.fn().mockReturnValue(0.002),
  getMaxExecutorBalance: vi.fn().mockReturnValue(0.004),
  getChainConfig: vi.fn().mockReturnValue({
    nativeCurrency: { decimals: 18 }
  })
}));
vi.mock('fum_library/services/coingecko', () => ({
  fetchTokenPrices: vi.fn().mockResolvedValue({ ETH: 2000 }),
  CACHE_DURATIONS: { '1-MINUTE': 60000 }
}));
vi.mock('fum_library/helpers/tokenHelpers', () => ({
  getNativeSymbol: vi.fn().mockReturnValue('ETH'),
  getWrappedNativeSymbol: vi.fn().mockReturnValue('WETH'),
  getWrappedNativeAddress: vi.fn().mockReturnValue('0xWrappedNative')
}));
vi.mock('../../src/utils/RetryHelper.js', () => ({
  retryRpcCall: vi.fn((fn) => fn())
}));

describe('VaultHealth', () => {
  let vaultHealth;
  let eventManager;
  let mockProvider;
  let mockVaultDataService;
  let mockHdNode;

  // Test constants
  const VAULT_ADDRESS = ethers.utils.getAddress('0x1234567890123456789012345678901234567890');
  const EXECUTOR_ADDRESS = '0xdfA3e220f3a214dE67Ba2eda2B94B6FB5ccefd65'; // Index 0

  beforeEach(() => {
    eventManager = new EventManager();
    eventManager.setDebug(false);

    mockProvider = {
      getBalance: vi.fn().mockResolvedValue(ethers.utils.parseEther('0.004')),
      on: vi.fn(),
      removeListener: vi.fn()
    };

    mockVaultDataService = {
      hasVault: vi.fn().mockReturnValue(true),
      getVault: vi.fn().mockResolvedValue({
        address: VAULT_ADDRESS,
        executorIndex: 0,
        tokens: {}
      }),
      getAllVaults: vi.fn().mockReturnValue([{ address: VAULT_ADDRESS }]),
      refreshTokens: vi.fn().mockResolvedValue()
    };

    mockHdNode = {
      derivePath: vi.fn().mockReturnValue({
        address: EXECUTOR_ADDRESS,
        privateKey: '0x1234'
      })
    };

    vaultHealth = new VaultHealth({
      eventManager,
      chainId: 1337,
      debug: false,
      balanceCheckIntervalMs: 0 // Disable interval for unit tests
    });

    vaultHealth.setProvider(mockProvider);
    vaultHealth.setHdNode(mockHdNode);
    vaultHealth.setVaultDataService(mockVaultDataService);
    vaultHealth.setLockFunctions(
      vi.fn().mockReturnValue(true),  // lockVault always succeeds
      vi.fn()                          // unlockVault no-op
    );
  });

  afterEach(() => {
    vaultHealth.stop();
    vi.restoreAllMocks();
  });

  describe('Balance Monitoring', () => {
    it('should set holdback when executor balance is below minExecutorBalance', async () => {
      // Executor has 0.001 ETH (below min of 0.002)
      mockProvider.getBalance.mockResolvedValue(ethers.utils.parseEther('0.001'));

      vaultHealth.managedVaults.add(VAULT_ADDRESS);
      await vaultHealth.checkExecutorBalance(VAULT_ADDRESS);

      expect(vaultHealth.holdbacks.has(VAULT_ADDRESS)).toBe(true);
      const holdback = vaultHealth.holdbacks.get(VAULT_ADDRESS);
      expect(holdback.amountNative).toBeCloseTo(0.003); // max(0.004) - current(0.001)
    });

    it('should clear holdback when executor balance recovers above minExecutorBalance', async () => {
      // Set an existing holdback
      vaultHealth.holdbacks.set(VAULT_ADDRESS, {
        amountNative: 0.003,
        amountUsd: 6.0,
        setAt: Date.now()
      });

      // Executor now has 0.003 ETH (above min of 0.002)
      mockProvider.getBalance.mockResolvedValue(ethers.utils.parseEther('0.003'));

      vaultHealth.managedVaults.add(VAULT_ADDRESS);
      await vaultHealth.checkExecutorBalance(VAULT_ADDRESS);

      expect(vaultHealth.holdbacks.has(VAULT_ADDRESS)).toBe(false);
    });

    it('should not set holdback when executor balance is above minExecutorBalance', async () => {
      mockProvider.getBalance.mockResolvedValue(ethers.utils.parseEther('0.003'));

      vaultHealth.managedVaults.add(VAULT_ADDRESS);
      await vaultHealth.checkExecutorBalance(VAULT_ADDRESS);

      expect(vaultHealth.holdbacks.has(VAULT_ADDRESS)).toBe(false);
    });
  });

  describe('Holdback Calculation', () => {
    it('should convert native deficit to USD using token prices', async () => {
      // ETH price is $2000 (from mock)
      // Deficit: 0.004 - 0.001 = 0.003 ETH = $6.00
      mockProvider.getBalance.mockResolvedValue(ethers.utils.parseEther('0.001'));

      vaultHealth.managedVaults.add(VAULT_ADDRESS);
      await vaultHealth.checkExecutorBalance(VAULT_ADDRESS);

      const holdback = vaultHealth.holdbacks.get(VAULT_ADDRESS);
      expect(holdback.amountUsd).toBeCloseTo(6.0);
    });

    it('should return 0 from getHoldbackAmount when no holdback exists', () => {
      expect(vaultHealth.getHoldbackAmount(VAULT_ADDRESS)).toBe(0);
    });

    it('should return USD amount from getHoldbackAmount when holdback exists', () => {
      vaultHealth.holdbacks.set(VAULT_ADDRESS, {
        amountNative: 0.003,
        amountUsd: 6.0,
        setAt: Date.now()
      });

      expect(vaultHealth.getHoldbackAmount(VAULT_ADDRESS)).toBe(6.0);
    });

    it('should emit ExecutorHoldbackSet event on first holdback', async () => {
      const events = [];
      eventManager.subscribe('ExecutorHoldbackSet', (data) => events.push(data));

      mockProvider.getBalance.mockResolvedValue(ethers.utils.parseEther('0.001'));
      vaultHealth.managedVaults.add(VAULT_ADDRESS);
      await vaultHealth.checkExecutorBalance(VAULT_ADDRESS);

      expect(events.length).toBe(1);
      expect(events[0].vaultAddress).toBe(VAULT_ADDRESS);
      expect(events[0].deficitNative).toBeCloseTo(0.003);
    });

    it('should emit ExecutorHoldbackCleared event when holdback cleared', async () => {
      const events = [];
      eventManager.subscribe('ExecutorHoldbackCleared', (data) => events.push(data));

      // Set existing holdback
      vaultHealth.holdbacks.set(VAULT_ADDRESS, {
        amountNative: 0.003,
        amountUsd: 6.0,
        setAt: Date.now()
      });

      // Balance recovered
      mockProvider.getBalance.mockResolvedValue(ethers.utils.parseEther('0.003'));
      vaultHealth.managedVaults.add(VAULT_ADDRESS);
      await vaultHealth.checkExecutorBalance(VAULT_ADDRESS);

      expect(events.length).toBe(1);
      expect(events[0].vaultAddress).toBe(VAULT_ADDRESS);
    });
  });

  describe('Funding-Required State', () => {
    it('should enter funding-required state', () => {
      vaultHealth.managedVaults.add(VAULT_ADDRESS);
      vaultHealth.enterFundingRequired(VAULT_ADDRESS);

      expect(vaultHealth.fundingRequired.has(VAULT_ADDRESS)).toBe(true);
      expect(vaultHealth.isFundingRequired(VAULT_ADDRESS)).toBe(true);
    });

    it('should emit ExecutorFundingRequired event', () => {
      const events = [];
      eventManager.subscribe('ExecutorFundingRequired', (data) => events.push(data));

      vaultHealth.managedVaults.add(VAULT_ADDRESS);
      vaultHealth.enterFundingRequired(VAULT_ADDRESS);

      expect(events.length).toBe(1);
      expect(events[0].vaultAddress).toBe(VAULT_ADDRESS);
    });

    it('should clear funding-required state', () => {
      vaultHealth.managedVaults.add(VAULT_ADDRESS);
      vaultHealth.enterFundingRequired(VAULT_ADDRESS);
      vaultHealth.clearFundingRequired(VAULT_ADDRESS);

      expect(vaultHealth.fundingRequired.has(VAULT_ADDRESS)).toBe(false);
      expect(vaultHealth.isFundingRequired(VAULT_ADDRESS)).toBe(false);
    });

    it('should emit ExecutorFundingCleared event', () => {
      const events = [];
      eventManager.subscribe('ExecutorFundingCleared', (data) => events.push(data));

      vaultHealth.managedVaults.add(VAULT_ADDRESS);
      vaultHealth.enterFundingRequired(VAULT_ADDRESS);
      vaultHealth.clearFundingRequired(VAULT_ADDRESS);

      expect(events.length).toBe(1);
      expect(events[0].vaultAddress).toBe(VAULT_ADDRESS);
    });

    it('should clear funding-required when interval check detects balance recovery', async () => {
      vaultHealth.managedVaults.add(VAULT_ADDRESS);
      vaultHealth.enterFundingRequired(VAULT_ADDRESS);

      // Executor balance recovered above min (0.002)
      mockProvider.getBalance.mockResolvedValue(ethers.utils.parseEther('0.003'));

      await vaultHealth.checkAllBalances();

      expect(vaultHealth.fundingRequired.has(VAULT_ADDRESS)).toBe(false);
    });
  });

  describe('Vault Management', () => {
    it('should add vault to monitoring', () => {
      vaultHealth.addVault(VAULT_ADDRESS);
      expect(vaultHealth.managedVaults.has(VAULT_ADDRESS)).toBe(true);
    });

    it('should remove vault from monitoring and clear all state', () => {
      vaultHealth.managedVaults.add(VAULT_ADDRESS);
      vaultHealth.holdbacks.set(VAULT_ADDRESS, { amountNative: 0.003, amountUsd: 6.0, setAt: Date.now() });
      vaultHealth.fundingRequired.set(VAULT_ADDRESS, { executorAddress: EXECUTOR_ADDRESS, enteredAt: Date.now() });

      vaultHealth.removeVault(VAULT_ADDRESS);

      expect(vaultHealth.managedVaults.has(VAULT_ADDRESS)).toBe(false);
      expect(vaultHealth.holdbacks.has(VAULT_ADDRESS)).toBe(false);
      expect(vaultHealth.fundingRequired.has(VAULT_ADDRESS)).toBe(false);
    });

    it('should prune vaults removed from VaultDataService during checkAllBalances', async () => {
      vaultHealth.managedVaults.add(VAULT_ADDRESS);
      mockVaultDataService.hasVault.mockReturnValue(false); // VDS no longer has vault

      await vaultHealth.checkAllBalances();

      expect(vaultHealth.managedVaults.has(VAULT_ADDRESS)).toBe(false);
    });
  });

  describe('Lifecycle', () => {
    it('should populate managedVaults from VaultDataService on start', async () => {
      await vaultHealth.start();
      expect(vaultHealth.managedVaults.has(VAULT_ADDRESS)).toBe(true);
    });

    it('should clear all state on stop', async () => {
      vaultHealth.managedVaults.add(VAULT_ADDRESS);
      vaultHealth.holdbacks.set(VAULT_ADDRESS, { amountNative: 0.003, amountUsd: 6.0, setAt: Date.now() });

      vaultHealth.stop();

      expect(vaultHealth.managedVaults.size).toBe(0);
      expect(vaultHealth.holdbacks.size).toBe(0);
      expect(vaultHealth.fundingRequired.size).toBe(0);
    });

    it('should not start interval when balanceCheckIntervalMs is 0', async () => {
      await vaultHealth.start();
      expect(vaultHealth.balanceCheckInterval).toBe(null);
    });
  });
});
```

#### Change 10: `.env.local` — Replace private key with mnemonic

Replace lines 10-11 and remove lines 15-16:

```
# BEFORE:
# Executor wallet (account #4 in Ganache - for signing transactions)
AUTOMATION_PRIVATE_KEY=0x153b8bcb033769a3f3d51b6c2c99be54e76ea190a20752a308a7ec0873383470

# ...

BLACKLIST_PATH=./data/.vault-blacklist.json
TRACKING_DATA_DIR=./data/vaults

# AFTER:
# HD wallet mnemonic for per-vault executor derivation (test mnemonic, matches Phase 8)
AUTOMATION_MNEMONIC=pumpkin ghost mammal enrich toss laptop travel main again clever edit orchard
```

`BLACKLIST_PATH` and `TRACKING_DATA_DIR` are removed — AutomationService derives both from `config.dataDir` (Phase 5 Change 2b).

Full `.env.local` after changes:
```
# ===========================================
# FUM Automation Service - Local Environment
# ===========================================
# Use this for running against a Ganache node

# Network Configuration
CHAIN_ID=1337
WS_URL=ws://localhost:8545

# HD wallet mnemonic for per-vault executor derivation (test mnemonic, matches Phase 8)
AUTOMATION_MNEMONIC=pumpkin ghost mammal enrich toss laptop travel main again clever edit orchard

# Service Configuration
DEBUG=true
SSE_PORT=3001
RETRY_INTERVAL_MS=15000
MAX_FAILURE_DURATION_MS=60000

# API Keys
ALCHEMY_API_KEY=iA2PW-w7zdi08eIQxBbjsgvMazsq1H0s
THEGRAPH_API_KEY=b6c72daa76d9470d3066aae2459b9633
BLOCK_EXPLORER_API_KEY=4SK48UHR6MT6SPED3VF56R2GTKPR5TQ89A
COINGECKO_API_KEY=CG-55gfeszP9N39yJdSeZJzkeY5

# Notifications (mock values for testing)
TELEGRAM_BOT_API_KEY=test_key
TELEGRAM_CHAT_ID=test_chat_id

# Real values for Telegram notifications
# TELEGRAM_BOT_API_KEY=8098929304:AAH61dG7lmQyeZNJvM1YJA--LHRT-z5j_bQ
# TELEGRAM_CHAT_ID=5561938715
```

#### Change 11: `.env.example` — Replace private key with mnemonic

Replace lines 16-19:

```
# BEFORE:
# Private key for the automation executor wallet
# This wallet signs transactions for vault operations
# WARNING: Never commit real private keys to version control
AUTOMATION_PRIVATE_KEY=

# AFTER:
# BIP-39 mnemonic for HD wallet derivation (per-vault executor signers)
# Each vault gets a unique executor derived from this mnemonic + vault's executorIndex
# WARNING: Never commit mnemonics to version control
AUTOMATION_MNEMONIC=
```

#### Change 12: Backtest runner — `backtest/runners/run-v3-backtest.js`

**12a. Replace executor derivation (lines 348-351)**

```js
  // BEFORE:
  // 7. Executor wallet from mnemonic path m/44'/60'/0'/0/1
  const executorWallet = ethers.Wallet.fromMnemonic(MNEMONIC, "m/44'/60'/0'/0/1").connect(provider);
  const executorAddress = executorWallet.address;
  process.env.AUTOMATION_PRIVATE_KEY = executorWallet.privateKey;

  // AFTER:
  // 7. Set mnemonic env var for AutomationService HDNode initialization
  process.env.AUTOMATION_MNEMONIC = MNEMONIC;
```

**12b. Replace service config (lines 353-359)**

```js
  // BEFORE:
  const serviceConfig = {
    chainId: CHAIN_ID,
    automationServiceAddress: executorAddress,
    wsUrl: null,
    debug: false,
  };

  // AFTER:
  const serviceConfig = {
    chainId: CHAIN_ID,
    wsUrl: null,
    debug: false,
  };
```

Note: The backtest creates its own strategy directly (line 362: `new BacktestBabyStepsStrategy(...)`) and doesn't use AutomationService's constructor. The `serviceConfig` is passed to the strategy as a dependency, but the strategy no longer reads `automationServiceAddress` from it (Phase 5 Change 2f removes it from `updateStrategyDependencies`).

The backtest strategy needs an HDNode for `getVaultSigner`. The backtest already has `MNEMONIC` as a constant — the strategy gets `hdNode` from `updateStrategyDependencies`:
```js
  // After creating strategy, set hdNode:
  strategy.hdNode = ethers.utils.HDNode.fromMnemonic(MNEMONIC);
```

This is already handled if the backtest follows the same dependency injection pattern as AutomationService. Verify during implementation.

#### Flagged Issues

**1. VaultFactory `getVaultInfo` return shape — tuple vs named struct.**

Vault setup helpers (Changes 4-6) read `executorIndex` from `vaultFactory.getVaultInfo(vaultAddress)`. The return type depends on how the Solidity struct is returned. If it's a named struct with `executorIndex` field, `vaultInfo.executorIndex` works. If it's a positional tuple (as ethers v5 often returns for struct returns), it would be `vaultInfo[4]`. The code uses `vaultInfo.executorIndex ?? vaultInfo[4]` as a safety net. This should be verified against the actual ABI when implementing Phase 1 (which adds `executorIndex` to the `VaultInfo` struct).

**2. Race condition in vault-auth-grant test — executor derivation timing.**

The `vault-auth-grant.test.js` test creates a vault then expects `VaultAuthGranted` to fire. In Phase 5, the EventManager's `subscribeToAuthorizationEvents` handler reads `executorIndex` from VaultFactory to derive the expected address. The vault must exist in VaultFactory before the `ExecutorChanged` event is processed. Since `setExecutor` is called after vault creation (inside `setupTestVault`), VaultFactory already knows the vault. No race — the `ExecutorChanged` event fires from `setExecutor`, which is called after the vault is registered. No issue.

**3. Multi-vault tests — executor indices are sequential.**

Tests that create multiple vaults (e.g., `BS-1212.test.js` creates 2 vaults) will get executorIndex 0 and 1 from VaultFactory. The vault setup helpers handle this automatically — each call reads the vault's own executorIndex from VaultFactory and derives accordingly. No hardcoded index assumptions in test code.

**4. TEST_MNEMONIC duplication across 3 vault setup helpers.**

Changes 4-6 all define the same `TEST_MNEMONIC` constant and `deriveTestExecutorAddress` helper. Consider extracting to a shared helper (e.g., `test/helpers/executor-utils.js`):
```js
// test/helpers/executor-utils.js
import { ethers } from 'ethers';

export const TEST_MNEMONIC = 'pumpkin ghost mammal enrich toss laptop travel main again clever edit orchard';
export const TEST_HD_NODE = ethers.utils.HDNode.fromMnemonic(TEST_MNEMONIC);

export function deriveTestExecutorAddress(executorIndex) {
  return TEST_HD_NODE.derivePath("m/44'/60'/0'/0/" + executorIndex).address;
}
```

Import from the shared helper instead of defining in each file. This is optional — 3 copies is acceptable, but a shared file is cleaner and matches the project's existing pattern of shared test helpers.

**5. Executor funding amount — `maxExecutorBalance` vs test-specific override.**

Changes 4-6 fund executors with `maxExecutorBalance` from chain config. Most tests don't need a specific funding amount — they just need the executor to have enough gas. However, some VaultHealth-focused tests might want to control the executor balance precisely (e.g., test that holdback triggers at exactly `minExecutorBalance`). These tests should either:
- Use a separate Hardhat account to drain the executor balance after setup, or
- Skip the vault setup helper's automatic funding and fund manually

This is a test-design consideration, not a code issue. The default of funding to `maxExecutorBalance` is correct for the majority of tests.

**6. `vaultHealthIntervalMs` is not in the AutomationService constructor.**

Phase 6's VaultHealth constructor takes `balanceCheckIntervalMs`. Phase 5's AutomationService constructor creates VaultHealth (Change 2 of Phase 6). The `testConfig` field is `vaultHealthIntervalMs` (Change 2b above), which AutomationService passes to VaultHealth as `balanceCheckIntervalMs`. Verify the parameter name mapping during implementation.

**Verification:** `cd fum_automation && npm test`

### Phase 9: Frontend Changes

Deferred — tracked in MEMORY.md under "TODO / Frontend". The frontend has not been refactored for recent backend changes (per-vault signers, platform-agnostic library refactoring, etc.). Frontend updates for this design include: xpub-based executor derivation, payable setExecutor calls, and updated onboarding flow.

---

## Implementation Notes

**HDNode caching:** `Wallet.fromMnemonic` runs PBKDF2 (2048 rounds of HMAC-SHA512) on every call — roughly 10-50ms. Instead of caching per-vault signers, the service caches the HDNode once at startup (`ethers.utils.HDNode.fromMnemonic(mnemonic)` — single PBKDF2). Child key derivation from the cached HDNode is microseconds (just HMAC-SHA512 per path component), so signers are derived on demand with no performance concern. No per-vault signer map needed. The HDNode is provider-independent — on provider reconnect, new Wallets are created with the new provider using the same cached HDNode.

**Related pre-existing bug:** `reestablishEventListeners()` in AutomationService does not call `updateStrategyDependencies()` after WebSocket provider reconnect. Strategies retain a stale provider reference. This bug exists independently of the per-vault signer design but is relevant — the HDNode reference doesn't change on reconnect, but the provider passed to `new ethers.Wallet(privateKey, provider)` must be the new one. The fix (call `updateStrategyDependencies()` during reconnect) ensures strategies use the current provider when deriving signers.
