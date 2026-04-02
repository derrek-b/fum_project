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
import { isInsufficientFundsError } from '../utils/errors.js';
// COMMENTED OUT: ERC20ABI was only used for on-chain WETH verification debug block,
// which was removed after refreshTokens at top of attemptTopUp makes cache fresh.
// import ERC20ARTIFACT from '@openzeppelin/contracts/build/contracts/ERC20.json' with { type: 'json' };
// const ERC20ABI = ERC20ARTIFACT.abi;

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

    // Funding-required state: vaultAddress → { enteredAt }
    // Vaults in this map have had InsufficientGasError — locked until user funds executor
    this.fundingRequired = new Map();

    // On-chain event listeners for ExecutorFunded (per-vault)
    this.onChainListeners = new Map();  // vaultAddress → listener cleanup function

    // Pending top-up flag: set by state-changing events (PositionRebalanced, FeesCollected,
    // NewPositionCreated) to signal that vault tokens have changed and a top-up should be
    // attempted on the next VaultUnlocked. Prevents the infinite retry loop where failed
    // top-ups unlock → VaultUnlocked → re-attempt → fail → unlock → repeat.
    this.pendingTopUp = new Set();

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
    this.pendingTopUp.clear();
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
    this.pendingTopUp.delete(normalized);
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

  /**
   * Get the full holdback data for a vault.
   * Strategies use this at the mint boundary to deduct tokens matching
   * attemptTopUp's funding source priority (native/wrapped-native first).
   *
   * @param {string} vaultAddress
   * @returns {{ amountNative: number, amountUsd: number } | null}
   */
  getHoldback(vaultAddress) {
    const normalized = ethers.utils.getAddress(vaultAddress);
    const holdback = this.holdbacks.get(normalized);
    return holdback ? { amountNative: holdback.amountNative, amountUsd: holdback.amountUsd } : null;
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
   * On insufficient funds: enters fundingRequired state and keeps lock held.
   *
   * @param {string} vaultAddress - Vault address (checksummed)
   */
  async attemptTopUp(vaultAddress) {
    const holdback = this.holdbacks.get(vaultAddress);
    if (!holdback) {
      this.unlockVault(vaultAddress);
      return;
    }

    // COMMENTED OUT: vaultStateMutated tracking removed — refreshTokens at the top of
    // attemptTopUp ensures fresh cache. No end-of-function refreshes needed.
    // let vaultStateMutated = false;

    try {
      const vault = await this.vaultDataService.getVault(vaultAddress);
      if (!vault) {
        this.log(`Vault ${vaultAddress} not in cache — skipping top-up`);
        this.unlockVault(vaultAddress);
        return;
      }

      // Refresh VDS token cache — VaultHealth's single freshness point.
      // vault.tokens includes native (ETH/AVAX) via fetchTokenBalances → provider.getBalance,
      // so no separate getBalance RPC needed.
      // Note: refreshTokens mutates the vault object in-place (same reference from #vaults Map),
      // so vault.tokens is already fresh after this call — no need to re-read via getVault.
      await this.vaultDataService.refreshTokens(vaultAddress);

      const executorAddress = this.deriveExecutorAddress(vault);
      const topUpAmountWei = ethers.utils.parseEther(holdback.amountNative.toFixed(18));

      // Read vault's native balance from fresh cache
      const nativeSymbol = getNativeSymbol(this.chainId);
      const vaultNativeBalance = ethers.BigNumber.from(vault.tokens?.[nativeSymbol] || '0');
      let availableNative = vaultNativeBalance;

      // ── Path 1: Unwrap wrapped native (WETH/WAVAX) ──
      if (availableNative.lt(topUpAmountWei)) {
        const wrappedNativeSymbol = getWrappedNativeSymbol(this.chainId);
        const wrappedBalance = vault.tokens?.[wrappedNativeSymbol];

        // COMMENTED OUT: on-chain WETH verification and debug token dump — redundant after
        // refreshTokens at top of attemptTopUp. Cache is guaranteed fresh.
        // See git log for original debug instrumentation if needed.

        const deficit = topUpAmountWei.sub(availableNative);
        const wrappedBN = wrappedBalance ? ethers.BigNumber.from(wrappedBalance) : ethers.BigNumber.from(0);
        const deficitThreshold = deficit.div(4); // 25% of deficit

        if (wrappedBN.gte(deficitThreshold)) {
          const amountToUnwrap = deficit.gt(wrappedBN) ? wrappedBN : deficit;

          try {
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

            // COMMENTED OUT: vaultStateMutated tracking removed
            // vaultStateMutated = true;
            availableNative = availableNative.add(amountToUnwrap);
            this.log(`Unwrapped ${ethers.utils.formatEther(amountToUnwrap)} ${wrappedNativeSymbol} for top-up`);
          } catch (unwrapError) {
            this.log(`Unwrap failed for ${vaultAddress}: ${unwrapError.message} — continuing to ERC20 swap path`);
          }
        }
      }

      // ── Path 2: Swap ERC20 tokens to native ──
      // Adapters handle native output internally (TJ: swapExactTokensForNATIVE,
      // V3/V4: UniversalRouter native output routing) — no separate unwrap needed.
      if (availableNative.lt(topUpAmountWei)) {
        const deficit = topUpAmountWei.sub(availableNative);

        // Gate: skip ERC20 swap if remaining deficit is <25% of full top-up amount.
        // Cheap paths (native balance + unwrap) covered most of it — not worth swap gas.
        // Next monitoring cycle may accumulate more native (fee collection, rebalance).
        if (deficit.lt(topUpAmountWei.div(4))) {
          this.log(
            `Vault ${vaultAddress} remaining deficit ${ethers.utils.formatEther(deficit)}` +
            ` < 25% of top-up target ${ethers.utils.formatEther(topUpAmountWei)} — skipping ERC20 swap`
          );
        } else {
          this.log(`Vault ${vaultAddress} native deficit: ${ethers.utils.formatEther(deficit)} — attempting ERC20 swap`);
          try {
            await this.swapTokensForNative(vault, deficit);
          } catch (swapError) {
            this.log(`ERC20 swap failed for ${vaultAddress}: ${swapError.message}`);
          }
        }
      }

      // ── Final balance check — re-read from chain as single source of truth ──
      availableNative = await retryRpcCall(
        () => this.provider.getBalance(vaultAddress),
        `getBalance(vault:${vaultAddress.slice(0, 8)}:final)`,
        { log: (msg) => this.log(msg) }
      );

      const { decimals: nativeDecimals } = getChainConfig(this.chainId).nativeCurrency;
      const minBalanceWei = ethers.utils.parseUnits(getMinExecutorBalance(this.chainId).toString(), nativeDecimals);

      if (availableNative.lt(minBalanceWei)) {
        this.log(`Vault ${vaultAddress} has insufficient native balance for top-up (${ethers.utils.formatEther(availableNative)} < min ${getMinExecutorBalance(this.chainId)})`);
        // COMMENTED OUT: refreshTokens moved to top of attemptTopUp
        // if (vaultStateMutated) {
        //   await this.vaultDataService.refreshTokens(vaultAddress).catch(refreshErr => {
        //     this.log(`Failed to refresh tokens after give-up for ${vaultAddress}: ${refreshErr.message}`);
        //   });
        // }
        this.unlockVault(vaultAddress);
        return;
      }

      // ── Execute: transfer native ETH from vault to executor ──
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

      // Success — clear holdback, release lock
      this.clearHoldback(vaultAddress);
      // COMMENTED OUT: refreshTokens moved to top of attemptTopUp
      // await this.vaultDataService.refreshTokens(vaultAddress).catch(refreshErr => {
      //   this.log(`Failed to refresh tokens after successful top-up for ${vaultAddress}: ${refreshErr.message}`);
      // });
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

      // COMMENTED OUT: refreshTokens moved to top of attemptTopUp
      // if (vaultStateMutated) {
      //   await this.vaultDataService.refreshTokens(vaultAddress).catch(refreshErr => {
      //     this.log(`Failed to refresh tokens after top-up error for ${vaultAddress}: ${refreshErr.message}`);
      //   });
      // }

      // Insufficient funds means the executor can't pay gas for the fundExecutor tx —
      // enter funding-required lockdown (keep holding the lock)
      if (isInsufficientFundsError(error)) {
        this.enterFundingRequired(vaultAddress);
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
    // ── State-changing events: flag that vault tokens have changed ──
    // These events mean the vault did on-chain work that likely changed token balances,
    // so a top-up should be attempted on the next VaultUnlocked.
    const stateChangingEvents = ['PositionRebalanced', 'FeesCollected', 'NewPositionCreated', 'LiquidityAddedToPosition'];
    for (const eventName of stateChangingEvents) {
      this.eventManager.subscribe(eventName, (data) => {
        try {
          const normalized = ethers.utils.getAddress(data.vaultAddress);
          if (!this.managedVaults.has(normalized)) return;
          if (!this.holdbacks.has(normalized)) return;  // no top-up needed
          this.pendingTopUp.add(normalized);
        } catch (error) {
          console.error(`[VaultHealth] Error in ${eventName} handler:`, error);
        }
      });
    }

    // ── VaultUnlocked: timing mechanism for top-up attempts ──
    // Fires AFTER lock is released (AS line 1884 deletes lock, line 1887 emits event).
    // Only attempts top-up if pendingTopUp flag is set (by state-changing events above).
    // This prevents the infinite loop where failed top-ups unlock → VaultUnlocked →
    // re-attempt → fail → unlock → repeat (Issue 4).
    this.eventManager.subscribe('VaultUnlocked', async (data) => {
      try {
        const normalized = ethers.utils.getAddress(data.vaultAddress);
        if (!this.managedVaults.has(normalized)) return;

        if (this.fundingRequired.has(normalized)) {
          // Vault just had InsufficientGasError. AutomationService released lock.
          // Re-acquire and hold until user funds executor via fundExecutor().
          // (On-chain ExecutorFunded listener already set up by enterFundingRequired.)
          this.lockVault(normalized);
          return;
        }

        if (this.pendingTopUp.has(normalized) && this.holdbacks.has(normalized)) {
          // A state-changing event signaled new resources are available.
          // Clear the flag BEFORE attempting (prevents re-entry on failure).
          this.pendingTopUp.delete(normalized);
          if (!this.lockVault(normalized)) return;  // someone else grabbed it
          await this.attemptTopUp(normalized);
          // attemptTopUp releases lock on success or non-gas error
          // attemptTopUp enters fundingRequired on insufficient funds (keeps lock)
        }
      } catch (error) {
        console.error('[VaultHealth] Error in VaultUnlocked handler:', error);
      }
    });

    // ── VaultSetupComplete: initial top-up path ──
    // Fires after initial vault setup (AS line 1648). setupVault itself doesn't acquire
    // locks, but callers may hold the lock (retryFailedVaults acquires at line 1030).
    // Handler attempts lockVault and returns gracefully if lock is held —
    // VaultUnlocked from the caller's finally block will catch it (via pendingTopUp
    // being set by VaultSetupComplete, which IS a state-changing event for new vaults).
    this.eventManager.subscribe('VaultSetupComplete', async (data) => {
      try {
        const normalized = ethers.utils.getAddress(data.vaultAddress);
        if (!this.managedVaults.has(normalized)) return;
        if (!this.holdbacks.has(normalized)) return;     // no top-up needed
        if (!this.lockVault(normalized)) {
          // Lock held by caller — set pendingTopUp so VaultUnlocked picks it up
          this.pendingTopUp.add(normalized);
          return;
        }
        await this.attemptTopUp(normalized);
        // attemptTopUp releases lock on success or non-gas error
        // attemptTopUp enters fundingRequired on insufficient funds (keeps lock)
      } catch (error) {
        console.error('[VaultHealth] Error in VaultSetupComplete handler:', error);
      }
    });
  }

  //#endregion

  //#region Funding Required

  /**
   * Enter funding-required state for a vault. Called from two paths:
   * 1. AutomationService catch block when InsufficientGasError is caught
   * 2. VaultHealth's own attemptTopUp when isInsufficientFundsError() matches
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
   * @returns {Object} Map contents as plain object: { vaultAddress: { enteredAt } }
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
   * Quote the swap amount needed to cover a native deficit using a specific adapter.
   *
   * Uses EXACT_OUTPUT to determine "how much tokenIn to get `deficit` native out?"
   * - If requiredInput <= balance: return requiredInput (partial swap covers deficit)
   * - If requiredInput > balance but balance >= requiredInput/4: return full balance
   *   with proportionally estimated output (token can meaningfully reduce deficit)
   * - If balance < requiredInput/4: return null (dust — not worth the gas)
   *
   * Always consumed as EXACT_INPUT by batchSwapTransactions. EXACT_OUTPUT is only
   * used to size the input amount — same pattern as BabyStepsStrategy.getDeficitSwapQuote.
   *
   * @param {PlatformAdapter} adapter - Adapter instance to quote with
   * @param {Object} token - Token data { address, decimals, symbol, balance }
   * @param {BigNumber} remainingDeficit - Native token deficit in wei
   * @returns {Promise<{ amount: string, estimatedOutput: string }|null>} Quote or null
   */
  async quoteSwapAmount(adapter, token, remainingDeficit) {
    const balanceBN = ethers.BigNumber.from(token.balance);

    const exactOutputQuote = await retryRpcCall(
      () => adapter.getBestSwapQuote({
        tokenInAddress: token.address,
        amount: remainingDeficit.toString(),
        isAmountIn: false,
        tokenOutIsNative: true,
        provider: this.provider
      }),
      `getBestSwapQuote EXACT_OUTPUT ${token.symbol}→native`,
      { log: (msg) => this.log(msg) }
    );

    const requiredInput = ethers.BigNumber.from(exactOutputQuote.amountIn);

    if (requiredInput.lte(balanceBN)) {
      // Token can cover the full deficit — swap only what's needed
      return {
        amount: requiredInput.toString(),
        estimatedOutput: remainingDeficit.toString()
      };
    }

    // Token can't cover full deficit — check if it's worth swapping at all
    if (balanceBN.lt(requiredInput.div(4))) {
      // Dust: balance < 25% of what's needed. Skip.
      return null;
    }

    // Partial coverage: swap full balance, estimate output proportionally
    // At executor funding amounts (~$4-16), pool price is linear — no meaningful impact
    const estimatedOutput = remainingDeficit.mul(balanceBN).div(requiredInput);
    return {
      amount: token.balance,
      estimatedOutput: estimatedOutput.toString()
    };
  }

  /**
   * Swap ERC20 tokens held in the vault to native for executor gas top-up.
   *
   * Uses adapter.getBestSwapQuote() EXACT_OUTPUT to determine the precise amount
   * of each token needed — only swaps what's required to cover the deficit, not
   * the full token balance. Falls back to full-balance swap when a token can't
   * cover the entire remaining deficit but holds ≥25% of what's needed.
   *
   * Dust gate: tokens whose balance < 25% of the required input are skipped
   * (determined by the quoter, not USD estimation). No CoinGecko dependency.
   *
   * Adapter selection:
   * - Cycles through vault.targetPlatforms in order for each token swap
   * - If an adapter can't route the pair (quote fails), tries the next
   * - Quote and swap always use the same adapter (no double-quote race)
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

    if (!vault.tokens || Object.keys(vault.tokens).length === 0) {
      this.log(`Vault ${vaultAddress} has no tokens to swap`);
      return 0;
    }

    // Build swappable token list: exclude native, wrapped native, zero balances
    const swappableTokens = [];
    for (const [symbol, balance] of Object.entries(vault.tokens)) {
      const tokenConfig = this.tokens[symbol];
      if (!tokenConfig) continue;
      if (tokenConfig.isNative) continue;
      if (symbol === wrappedNativeSymbol) continue;

      const balanceBN = ethers.BigNumber.from(balance);
      if (balanceBN.lte(0)) continue;

      swappableTokens.push({
        symbol,
        address: tokenConfig.address,
        decimals: tokenConfig.decimals,
        balance
      });
    }

    if (swappableTokens.length === 0) {
      this.log(`Vault ${vaultAddress} has no swappable tokens`);
      return 0;
    }

    let swapCount = 0;
    let remainingDeficit = deficit;
    const signer = this.deriveVaultSigner(vault);
    const vaultContract = getVaultContract(vaultAddress, this.provider).connect(signer);

    for (const token of swappableTokens) {
      let swapped = false;
      let swappedQuote = null;

      for (const adapter of adapters) {
        try {
          // Quote: determine precise swap amount via on-chain quoter
          const quote = await this.quoteSwapAmount(adapter, token, remainingDeficit);
          if (!quote) {
            this.log(
              `Adapter ${adapter.platformId}: ${token.symbol} skipped (no route or dust)` +
              (adapters.indexOf(adapter) < adapters.length - 1 ? ' — trying next adapter' : '')
            );
            continue;
          }

          this.log(
            `Swapping ${ethers.utils.formatUnits(quote.amount, token.decimals)} ${token.symbol}` +
            ` → ~${ethers.utils.formatEther(quote.estimatedOutput)} ${nativeSymbol}` +
            ` for executor top-up (via ${adapter.platformId})`
          );

          // Approvals
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

          // Swap (always EXACT_INPUT — quoter sized the input, adapter re-quotes internally)
          const swapInstruction = {
            tokenIn: { address: token.address, decimals: token.decimals, symbol: token.symbol },
            tokenOut: nativeToken,
            amount: quote.amount,
            isAmountIn: true
          };
          const swapOptions = {
            signer,
            recipient: vaultAddress,
            slippageTolerance: vault.strategy.parameters.maxSlippage,
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
          swappedQuote = quote;
          break;
        } catch (adapterError) {
          this.log(
            `Adapter ${adapter.platformId} failed for ${token.symbol}: ${adapterError.message}` +
            (adapters.indexOf(adapter) < adapters.length - 1 ? ' — trying next adapter' : ' — no more adapters')
          );
        }
      }

      if (!swapped) {
        this.log(`All adapters failed for ${token.symbol} swap — skipping token`);
        continue;
      }

      swapCount++;
      remainingDeficit = remainingDeficit.sub(ethers.BigNumber.from(swappedQuote.estimatedOutput));
      if (remainingDeficit.lte(0)) {
        this.log(`Deficit covered after swapping ${token.symbol}`);
        break;
      }
    }

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
