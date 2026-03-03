<!-- Source: fum_automation/src/core/AutomationService.js, fum_automation/src/core/VaultHealth.js, fum_automation/src/strategies/base/StrategyBase.js, fum/contracts/PositionVault.sol, fum/contracts/VaultFactory.sol, fum_library/src/configs/chains.js, fum_library/src/helpers/chainHelpers.js -->
# Per-Vault Derived Signers

## Problem

The automation service uses a single private key (`AUTOMATION_PRIVATE_KEY`) to execute transactions across all vaults. ethers.js v5's default Wallet calls `getTransactionCount` independently on every `sendTransaction`, so concurrent transactions from different vaults can receive the same nonce. One succeeds, the rest fail.

Per-vault locking prevents intra-vault nonce collisions (sequential transactions within one vault), but cross-vault collisions are unprotected. This is a latent bug that surfaces as vault count grows.

## Alternatives Evaluated

**FIFO Transaction Queue** — Serialize all transactions through a single chokepoint. Correct and simple, but O(n) latency for the nth concurrent transaction. At 50 concurrent rebalances on Arbitrum, the last vault waits ~50 seconds. Multi-step operations (decrease → collect → swap → mint) make it worse.

**Mutex Around Broadcast** — Only serialize the `sendTransaction` call (~200ms), let confirmations run in parallel. ~5x better throughput than FIFO, but broadcast failures create nonce gaps that require recovery logic. More complex, still has a serialization bottleneck.

**ethers.js v5 NonceManager** — Experimental, not production-ready. Nonce gaps on failed sends (all future txs stuck), no re-broadcast for dropped txs, gets out of sync with external sends, maintainer says "not designed for fire-and-forget." Violates the fail-loud principle.

All three manage the single-signer concurrency problem with varying degrees of complexity. The per-vault signer approach eliminates the problem entirely by removing the shared nonce space.

## Solution: Per-Vault Derived Signers

Store a BIP-39 mnemonic instead of a single private key. Derive a unique wallet for each vault using HD derivation (BIP-32/BIP-44). Each vault gets its own executor address with its own nonce space.

```
Mnemonic (one secret, stored in automation service env)
  ├── m/44'/60'/0'/0/0 → Wallet A → manages Vault A (nonce space A)
  ├── m/44'/60'/0'/0/1 → Wallet B → manages Vault B (nonce space B)
  ├── m/44'/60'/0'/0/2 → Wallet C → manages Vault C (nonce space C)
  └── ...
```

Derivation is deterministic — same mnemonic + same index always produces the same private key and address. No private keys are stored per-vault; they are derived on the fly when needed.

**Why this works:**

- Each derived wallet has its own address → its own nonce space
- Cross-vault nonce collisions are structurally impossible
- Existing per-vault locking already ensures sequential transactions within a vault
- No queue, no mutex, no nonce tracking infrastructure needed
- Fully parallel execution across all vaults with zero coordination

## Key Decisions

### Authorization Model

PositionVault's authorization model requires no changes. The contract already has a single `executor` storage slot per vault. Different vaults can have different executor addresses — the contract just checks `msg.sender == executor` via the `onlyAuthorized` modifier. The per-vault signer model works with the existing authorization interface.

VaultFactory gains two additions: a `nextExecutorIndex` monotonic counter and an `executorIndex` field in `VaultInfo`, assigned at vault creation. See `VaultFactory.sol` for the implementation.

### Index Mapping

The mapping lives on-chain in VaultFactory's `VaultInfo` struct. No off-chain persistence needed.

- **Sequential monotonic counter** — `nextExecutorIndex++` at vault creation. No hashing, no deterministic derivation from vault address.
- **Indices are never reused** — When a vault is deauthorized, its index stays assigned. Simpler than tracking freed slots, and uint256 has no practical limit.
- **Recovery is trivial** — Iterate `allVaults[]`, read each vault's `executorIndex`, derive the wallet, check if `derivedAddress == vault.executor()`. The blockchain is the persistence layer. The only secret to back up is the mnemonic.

### Gas Distribution

Vault self-funding with the VaultHealth subservice. Each vault funds its own executor from its own assets — no external banker wallet needed.

- **Configuration**: Chain config has `minExecutorBalance` and `maxExecutorBalance` — human-readable native asset amounts (e.g., `0.002` ETH on Arbitrum, `0.04` AVAX on Avalanche)
- **Initial funding**: `setExecutor` is payable. The frontend bundles initial gas funding with the authorization call — user sends `maxExecutorBalance` as `msg.value`, and the contract forwards it to the executor. One transaction, no chicken-and-egg.
- **Ongoing top-ups**: VaultHealth monitors executor balances and coordinates with strategies via a holdback amount. See [Executor Gas Management](../../fum_automation/docs/architecture/executor-gas-management.md) for the full VaultHealth design.
- **fundExecutor**: New PositionVault function that transfers native ETH from vault balance to executor. Called by VaultHealth for automated top-ups. `onlyAuthorized`, `nonReentrant`, guards against `executor == address(0)`.
- **Insufficient gas**: Third error category alongside unrecoverable (blacklist) and recoverable (retry). `InsufficientGasError` triggers VaultHealth holdback and skips the vault until gas is restored — don't retry (balance hasn't changed), don't blacklist (vault isn't broken). See `errors.js` for the error class and `isInsufficientFundsError()` detection helper.

**Alternatives considered:**

- **Master banker wallet**: Single wallet distributes gas to all executors. Simpler UX but single point of failure, operational overhead, and business cost. Better suited if FUM charges management fees.
- **Account abstraction (ERC-4337)**: Paymaster sponsors executor transactions. Cleanest long-term solution but over-engineered for current needs.

### Active Vault Registry

The `allVaults[]` array is a historical registry that only grows. As users come and go, iterating all vaults at startup becomes increasingly expensive. VaultFactory maintains a separate `activeVaults[]` array that tracks only vaults with executors set.

- **1-indexed mapping** — `activeVaultIndex` uses 0 to mean "not in the array." Solidity initializes all mapping values to 0, so a 0-indexed mapping can't distinguish "vault at index 0" from "vault never registered." The 1-offset sidesteps this, combining the existence check and array position into a single mapping (no separate `isActive` bool needed — one SSTORE per register/deregister instead of two).
- **Swap-and-pop removal** — O(1) instead of O(n) array shifting. Order doesn't matter for discovery.
- **Transition-only callbacks** — PositionVault checks `executor == address(0)` before the set. If changing from one executor to another (already active), skips the factory call. Saves a cross-contract CALL on executor changes.
- **`msg.sender == vault` access control** — Only factory-created vaults can register (verified via `vaultInfo[vault].owner != address(0)`).
- **`allVaults` stays** — Historical registry for frontend/analytics. `activeVaults` is the operational subset for automation.

See `VaultFactory.sol` for register/deregister functions and `PositionVault.sol` for setExecutor/removeExecutor callbacks.

### Frontend Onboarding

Fully self-service, no automation service dependency:

1. User creates vault → VaultFactory assigns `executorIndex` from `nextExecutorIndex++`
2. Frontend reads `executorIndex` from VaultFactory
3. Frontend derives executor address from xpub + index (client-side, pure computation)
4. User calls `vault.setExecutor(derivedAddress)` with `msg.value` for initial gas funding
5. Automation service discovers the vault at next startup or via `ExecutorChanged` event

The current `executorAddress` field in chain config (`chains.js`) is replaced with `executorXpub` — the extended public key derived from the mnemonic at the `m/44'/60'/0'/0` level. The frontend reads a vault's `executorIndex` from VaultFactory and derives the executor address locally. Private keys cannot be derived from the xpub — only the mnemonic holder (the automation service) can derive signers.

### Security

**Risk profile is equivalent to the current single-key model.** One private key compromised → attacker can execute authorized operations on all vaults. One mnemonic compromised → same outcome. One secret controls everything either way.

**Per-vault isolation is marginally better** — if a single derived private key is leaked (memory dump, side-channel) without the mnemonic leaking, only one vault is compromised. With the single-PK model, any leak compromises all vaults.

**xpub is not secret** — reveals derived addresses but cannot derive private keys. Safe for chain config (client-side code) or on-chain storage.

**BIP-39 mnemonic, no passphrase** — ethers.js v5 has native support, standard wallet tools can import/verify it, easier to back up than a hex string. The optional passphrase adds operational risk (misconfiguring different passphrases per chain silently produces different key trees) with no security benefit when both secrets would live in the same env file.

**On-chain guardrails already in place** — The validator system enforces destination restrictions on every vault operation. A compromised executor cannot extract tokens because all operations route back to the vault through factory-registered validators.

### Multi-Chain

**One mnemonic across all chains.** Same `AUTOMATION_MNEMONIC` env var for Arbitrum, Avalanche, and any future chains. A mnemonic has no concept of "which chain" — derived addresses are just EOAs that exist on every EVM chain simultaneously. Separate mnemonics per chain would give the illusion of independence without the reality (both stored in the same env file on the same server).

**Independent index spaces per chain.** Each chain has its own VaultFactory with its own `nextExecutorIndex` counter. Arbitrum vault at index 3 and Avalanche vault at index 3 happen to get the same derived executor address — that's fine. Different chains, independent nonces, independent balances, independent state.

**Gas distribution is chain-aware via config.** `minExecutorBalance`/`maxExecutorBalance` are per-chain values in chain config, denominated in each chain's native token.

## EVM Nonce Behavior (Cross-Chain Reference)

All EVM chains consume the nonce on reverted transactions — this is the EVM specification, not chain-specific. The nonce collision risk in this codebase is about broadcast-level races (two concurrent `sendTransaction` calls getting the same nonce before either is broadcast), not about on-chain reverts.

| Chain | Mempool | `'pending'` tag reliable? | Key gotcha |
|---|---|---|---|
| Arbitrum | No (sequencer) | N/A (instant processing) | Future nonces rejected immediately, not queued |
| Avalanche | Yes (validator gossip) | Node-local only | None significant |
| Polygon | Yes (public) | **Unreliable** | Reorgs, gas estimation, nonce desync |
| Optimism/Base | Yes (private) | **Buggy (1-2s stale)** | Nonce update latency after tx submission |
| Ethereum | Yes (public) | Node-local | Standard, 12s blocks |
| BSC | Yes (public) | Standard | None — faster Ethereum |

The per-vault signer design eliminates cross-vault nonce collisions on all chains. Chain-specific quirks (Polygon's unreliable pending tag, OP Stack's nonce latency) still apply within a single vault's nonce space, but per-vault locking already serializes transactions within a vault, so these are not a concern.

## Implementation Notes

### HDNode Caching

The mnemonic is converted to an HDNode once at startup (single PBKDF2 operation, ~10-50ms) and cached in `AutomationService.hdNode`. Per-vault signer derivation from the cached HDNode is microseconds — no caching needed at the child level. HDNode is provider-independent (pure key derivation), so it is not affected by provider reconnection or disconnection.

### Stale Provider After Reconnection

When the WebSocket disconnects and `attemptReconnection()` creates a new provider, strategies and VaultDataService retain references to the old dead provider. EventManager is unaffected (receives provider as parameter per-call), and HDNode is provider-independent. Fix: `attemptReconnection()` calls `updateStrategyDependencies()` and updates `vaultDataService.provider` after reconnecting. See `AutomationService.js` reconnection flow.

### VaultHealth as Operational Infrastructure

VaultHealth is not limited to gas distribution. It's the home for future operational concerns that require vault-level execution but aren't position management decisions — e.g., failed reward collection retries, staking operation retries. It uses the same vault transaction infrastructure as strategies (adapters, vault locks, `executeBatchTransactions`).

### Key Rotation

Requires generating a new mnemonic, updating `AUTOMATION_MNEMONIC` env var, updating `executorXpub` in chain config, and having every vault owner call `setExecutor` with their new derived address. Disruptive but operationally identical to rotating the current single PK (which also requires every vault to re-authorize).
