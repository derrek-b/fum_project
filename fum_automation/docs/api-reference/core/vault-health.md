<!-- Source: src/core/VaultHealth.js -->
# VaultHealth API

**Source:** `src/core/VaultHealth.js`

Executor gas monitoring and automated top-up for per-vault signers. Tracks executor balances, sets holdback amounts that strategies subtract from deployable capital, and executes top-ups when vault funds are available.

## Constructor

```javascript
new VaultHealth({
  eventManager,              // EventManager instance, required
  chainId,                   // number, required
  debug,                     // boolean, default false
  balanceCheckIntervalMs     // number, default 300000 (5 min) — 0 disables interval
})
```

## Post-Construction Dependencies

Set by AutomationService after construction:

| Method | Description |
|---|---|
| `setProvider(provider)` | Set ethers provider (also resubscribes on-chain listeners) |
| `setHdNode(hdNode)` | Set HD node for executor key derivation |
| `setVaultDataService(vds)` | Set VaultDataService reference |
| `setTokens(tokens)` | Set token configurations |
| `setAdapters(adapters)` | Set platform adapter Map |
| `setLockFunctions(lockFn, unlockFn)` | Inject vault lock/unlock from AutomationService |

## Lifecycle

| Method | Description |
|---|---|
| `start()` | Populate managed vaults from VaultDataService, check all balances, begin interval |
| `stop()` | Clear interval, unsubscribe on-chain listeners, clear all state |

## Vault Management

| Method | Description |
|---|---|
| `addVault(vaultAddress)` | Add vault to monitoring, check executor balance immediately |
| `removeVault(vaultAddress)` | Remove vault from monitoring, clear holdback/funding state |

## Core API

| Method | Returns | Description |
|---|---|---|
| `getHoldbackAmount(vaultAddress)` | `number` (USD) | Holdback USD amount. Returns 0 if executor balance is healthy. |
| `getHoldback(vaultAddress)` | `Object \| null` | Full holdback object `{ amountNative, amountUsd, setAt }` or null |
| `checkAllBalances()` | `Promise<void>` | Check all managed vault executors, set/clear holdbacks |
| `checkExecutorBalance(vaultAddress)` | `Promise<void>` | Check single executor balance, set holdback if underfunded |
| `setHoldback(vaultAddress, currentBalance, maxBalance)` | `Promise<void>` | Calculate and store holdback for underfunded executor |
| `clearHoldback(vaultAddress)` | `void` | Remove holdback for a vault |
| `attemptTopUp(vaultAddress)` | `Promise<void>` | Swap vault tokens for native and send to executor |
| `getStatus()` | `Object` | Returns `{ managedVaults, activeHoldbacks, holdbacks, fundingRequired }` |

## Funding-Required State

Vaults enter funding-required when an `InsufficientGasError` occurs — the executor cannot send transactions. The vault is effectively locked until the user manually funds the executor or the system retries successfully.

| Method | Description |
|---|---|
| `enterFundingRequired(vaultAddress)` | Mark vault as funding-required, emit `ExecutorFundingRequired`, subscribe to on-chain `ExecutorFunded` event |
| `clearFundingRequired(vaultAddress)` | Clear funding-required state, emit `ExecutorFundingCleared`, unsubscribe from on-chain event |
| `getFundingRequiredData()` | Get all funding-required vaults as serializable object |

## On-Chain Listeners

| Method | Description |
|---|---|
| `subscribeToExecutorFundedEvent(vaultAddress)` | Listen for on-chain ExecutorFunded event to auto-clear funding-required |
| `unsubscribeFromExecutorFundedEvent(vaultAddress)` | Remove on-chain listener |
| `resubscribeOnChainListeners()` | Re-register all on-chain listeners after provider reconnect |

## Events Emitted

| Event | Data | When |
|---|---|---|
| `ExecutorFundingRequired` | `{ vaultAddress }` | Executor cannot afford gas |
| `ExecutorFundingCleared` | `{ vaultAddress }` | Funding-required state resolved |
| `ExecutorFunded` | `{ vaultAddress, amount }` | Top-up transaction completed |

## Internal State

| Field | Type | Description |
|---|---|---|
| `holdbacks` | `Map<address, {amountNative, amountUsd, setAt}>` | Per-vault holdback amounts |
| `managedVaults` | `Set<address>` | Vault addresses under monitoring |
| `fundingRequired` | `Map<address, {enteredAt}>` | Vaults with insufficient executor gas |
| `pendingTopUp` | `Set<address>` | Vaults flagged for top-up on next unlock |

## See Also

- [Executor Gas Management](../../architecture/executor-gas-management.md) — Architecture and holdback flow
- [AutomationService](../automation-service/automation-service.md) — Creates and injects VaultHealth
