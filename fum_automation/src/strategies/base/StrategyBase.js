/**
 * @module strategies/base/StrategyBase
 * @description Abstract base class for all vault management strategies
 *
 * =============================================================================
 * STRATEGY INTERFACE TRACKING
 * =============================================================================
 * This tracks required methods that all strategies must implement.
 *
 * REQUIRED INTERFACE METHODS:
 * -----------------------------------------------------------------------------
 * | Method                    | Called By                          | Status    |
 * |---------------------------|------------------------------------|-----------|
 * | initializeVault           | AutomationService.setupVault       | CONFIRMED |
 * | handleSwapEvent           | AutomationService.handleSwapEvent  | CONFIRMED |
 * | cleanup                   | AutomationService.cleanupVault     | CONFIRMED |
 * | setupAdditionalMonitoring | AutomationService.startMonitoring  | CONFIRMED |
 *
 * HELPER METHODS (shared utilities in StrategyBase):
 * -----------------------------------------------------------------------------
 * | Method                       | Notes                               |
 * |------------------------------|-------------------------------------|
 * | executeBatchTransactions     | Execute tx batch through vault      |
 * | executeWrap                  | Wrap native to wrapped native       |
 * | executeUnwrap                | Unwrap wrapped native to native     |
 * | isWrapUnwrapPair             | Check if swap is native<->wrapped   |
 * | buildSwapDetails             | Combine metadata with actual swaps  |
 * | log                          | Debug logging with strategy prefix  |
 * =============================================================================
 */

import { ethers } from 'ethers';
import { getVaultContract } from 'fum_library';
import { getNativeSymbol, getWrappedNativeSymbol } from 'fum_library/helpers/tokenHelpers';
import { retryRpcCall, retryWithBackoff } from '../../utils/RetryHelper.js';
import { UnrecoverableError, InsufficientGasError, isInsufficientFundsError } from '../../utils/errors.js';

/**
 * Abstract base class that defines the interface for vault management strategies.
 * All strategy implementations must extend this class.
 */
export default class StrategyBase {
  /**
   * Create a new strategy instance
   * @param {Object} dependencies - Strategy dependencies
   * @param {Object} dependencies.vaultDataService - Service for vault data access
   * @param {Object} dependencies.eventManager - Event management service
   * @param {Object} dependencies.provider - Ethers provider (null until initialize)
   * @param {Map} dependencies.adapters - Platform adapters map (null until initialize)
   * @param {number} dependencies.chainId - Chain ID
   * @param {boolean} dependencies.debug - Debug mode flag
   * @param {Object} dependencies.vaultLocks - Vault locking mechanism
   * @param {Object} dependencies.poolData - Pool data cache
   * @param {Function} dependencies.sendTelegramMessage - Notification function
   * @param {Object} dependencies.automationService - Reference to AutomationService
   * @param {Object} dependencies.tokens - Token configurations (null until initialize)
   * @param {Object} dependencies.serviceConfig - Service configuration (null until initialize)
   */
  constructor(dependencies) {
    this.vaultDataService = dependencies.vaultDataService;
    this.eventManager = dependencies.eventManager;
    this.provider = dependencies.provider;
    this.adapters = dependencies.adapters;
    this.chainId = dependencies.chainId;
    this.debug = dependencies.debug ?? false;
    this.vaultLocks = dependencies.vaultLocks;
    this.poolData = dependencies.poolData;
    this.sendTelegramMessage = dependencies.sendTelegramMessage;
    this.automationService = dependencies.automationService;
    this.tokens = dependencies.tokens;
    this.serviceConfig = dependencies.serviceConfig;

    // Track registered listeners per vault for cleanup
    this.registeredListenerKeys = {};
  }

  /**
   * Log a message with strategy prefix
   * @param {string} message - Message to log
   * @param {...any} args - Additional arguments
   */
  log(message, ...args) {
    if (this.debug) {
      console.log(`[${this.constructor.name}] ${message}`, ...args);
    }
  }

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

  // ===========================================================================
  // Transaction Execution
  // ===========================================================================

  /**
   * Execute batch transactions through vault contract
   *
   * Handles gas estimation, execution, retry logic, and event emission.
   * Uses vault's role-specific functions for proper access control.
   *
   * Vault function signatures:
   * - swap(targets, data, values) - payable, requires values array
   * - approve/mint/increaseLiquidity/decreaseLiquidity/collect/burn(targets, data) - not payable
   *
   * @param {Object} vault - Vault data object
   * @param {Array<Object>} transactions - Array of { to, data, value? } objects (value only used for swaps)
   * @param {string} operationType - Human-readable description for logging
   * @param {string} type - Vault function type: 'swap' | 'approval' | 'mint' | 'addliq' | 'subliq' | 'collect' | 'burn'
   * @returns {Promise<{receipt: Object, gasEstimated: string}>} Transaction receipt and gas estimate
   * @throws {Error} If gas estimation or execution fails
   */
  async executeBatchTransactions(vault, transactions, operationType, type) {
    const targets = [];
    const calldatas = [];
    const values = []; // Only used for swap

    // Extract transaction data
    for (const txn of transactions) {
      targets.push(txn.to);
      calldatas.push(txn.data);
      values.push(txn.value || 0);
    }

    // Calculate total value for payable calls (only swap uses this)
    const totalValue = values.reduce((sum, v) => sum.add(ethers.BigNumber.from(v)), ethers.BigNumber.from(0));

    // Get vault contract for execution
    const vaultContract = getVaultContract(vault.address, this.provider);

    // Create per-vault signer via HD derivation
    const signer = this.getVaultSigner(vault);
    const vaultContractWithSigner = vaultContract.connect(signer);

    // Estimate gas before execution
    let gasEstimated = '0';
    try {
      const gasEstimate = await this._estimateGasForType(vaultContractWithSigner, type, targets, calldatas, values, totalValue);
      gasEstimated = gasEstimate.toString();
      this.log(`Gas estimate for ${operationType}: ${gasEstimated}`);
    } catch (gasError) {
      this._logGasEstimationError(gasError);
      throw new Error(`Gas estimation failed for ${operationType} - transaction data may be invalid: ${gasError.message}`);
    }

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
      if (isInsufficientFundsError(error)) {
        throw new InsufficientGasError(
          `Executor has insufficient gas for ${operationType}: ${error.message}`,
          vault.address,
          signer.address
        );
      }
      throw error;
    }

    this.log(`Successfully executed ${targets.length} ${operationType}, tx: ${receipt.transactionHash}`);

    // Emit batch transaction execution event
    this.eventManager.emit('BatchTransactionExecuted', {
      vaultAddress: vault.address,
      strategyId: vault.strategy?.strategyId,
      operationType: operationType,
      transactionCount: transactions.length,
      transactionHash: receipt.transactionHash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString(),
      gasEstimated: gasEstimated,
      gasEfficiency: gasEstimated !== '0' ? ((Number(receipt.gasUsed) / Number(gasEstimated)) * 100).toFixed(1) : 'N/A',
      targets: targets,
      executor: receipt.from,
      status: receipt.status,
      timestamp: Date.now(),
      log: {
        level: 'info',
        message: `Executed ${transactions.length} ${operationType} in tx ${receipt.transactionHash}`,
        includeData: false
      }
    });

    return { receipt, gasEstimated };
  }

  /**
   * Estimate gas for the given transaction type
   * @param {Object} vaultContract - Vault contract with signer
   * @param {string} type - Transaction type
   * @param {string[]} targets - Target addresses
   * @param {string[]} calldatas - Encoded calldata
   * @param {Array<number|string>} values - Values for each transaction (swap only)
   * @param {BigNumber} totalValue - Total ETH value to send (swap only)
   * @returns {Promise<BigNumber>} Gas estimate
   * @private
   */
  async _estimateGasForType(vaultContract, type, targets, calldatas, values, totalValue) {
    switch (type) {
      case 'swap':
        // swap(targets, data, values) - NOT payable, vault uses its internal ETH balance
        return retryRpcCall(() => vaultContract.estimateGas.swap(targets, calldatas, values), 'estimateGas.swap');
      case 'approval':
        return retryRpcCall(() => vaultContract.estimateGas.approve(targets, calldatas), 'estimateGas.approve');
      case 'mint':
        return retryRpcCall(() => vaultContract.estimateGas.mint(targets, calldatas, values), 'estimateGas.mint');
      case 'addliq':
        return retryRpcCall(() => vaultContract.estimateGas.increaseLiquidity(targets, calldatas, values), 'estimateGas.increaseLiquidity');
      case 'subliq':
        return retryRpcCall(() => vaultContract.estimateGas.decreaseLiquidity(targets, calldatas), 'estimateGas.decreaseLiquidity');
      case 'collect':
        return retryRpcCall(() => vaultContract.estimateGas.collect(targets, calldatas), 'estimateGas.collect');
      case 'burn':
        return retryRpcCall(() => vaultContract.estimateGas.burn(targets, calldatas), 'estimateGas.burn');
      case 'incentive':
        return retryRpcCall(() => vaultContract.estimateGas.incentive(targets, calldatas, values), 'estimateGas.incentive');
      default:
        throw new UnrecoverableError(`Invalid transaction type: ${type}. Must be one of: swap, approval, mint, addliq, subliq, collect, burn, incentive`);
    }
  }

  /**
   * Execute transaction for the given type
   * @param {Object} vaultContract - Vault contract with signer
   * @param {string} type - Transaction type
   * @param {string[]} targets - Target addresses
   * @param {string[]} calldatas - Encoded calldata
   * @param {Array<number|string>} values - Values for each transaction (swap only)
   * @param {BigNumber} totalValue - Total ETH value to send (swap only)
   * @returns {Promise<Object>} Transaction response
   * @private
   */
  async _executeForType(vaultContract, type, targets, calldatas, values, totalValue) {
    switch (type) {
      case 'swap':
        // swap(targets, data, values) - NOT payable, vault uses its internal ETH balance
        return vaultContract.swap(targets, calldatas, values);
      case 'approval':
        return vaultContract.approve(targets, calldatas);
      case 'mint':
        return vaultContract.mint(targets, calldatas, values);
      case 'addliq':
        return vaultContract.increaseLiquidity(targets, calldatas, values);
      case 'subliq':
        return vaultContract.decreaseLiquidity(targets, calldatas);
      case 'collect':
        return vaultContract.collect(targets, calldatas);
      case 'burn':
        return vaultContract.burn(targets, calldatas);
      case 'incentive':
        return vaultContract.incentive(targets, calldatas, values);
      default:
        throw new UnrecoverableError(`Invalid transaction type: ${type}. Must be one of: swap, approval, mint, addliq, subliq, collect, burn, incentive`);
    }
  }

  /**
   * Log detailed gas estimation error information
   * @param {Error} gasError - Gas estimation error
   * @private
   */
  _logGasEstimationError(gasError) {
    if (gasError.data) {
      try {
        const decodedError = ethers.utils.toUtf8String('0x' + gasError.data.slice(138));
        console.log(`   Decoded revert reason: ${decodedError}`);
      } catch {
        console.log(`   Could not decode error data as string`);
      }
    }

    if (gasError.error) {
      console.log(`   Nested error:`, JSON.stringify(gasError.error, null, 2));
    }

    if (gasError.transaction) {
      console.log(`   Transaction that failed:`, JSON.stringify(gasError.transaction, null, 2));
    }
  }

  // ===========================================================================
  // Native/Wrapped Native Wrap/Unwrap Helpers
  // ===========================================================================

  /**
   * Check if token pair is native <-> wrapped native (wrap/unwrap, not swap)
   * Works for ETH<->WETH on Arbitrum, AVAX<->WAVAX on Avalanche, etc.
   * @param {Object} tokenIn - Input token data with isNative and symbol
   * @param {Object} tokenOut - Output token data with isNative and symbol
   * @returns {{ isWrap: boolean, isUnwrap: boolean, isWrapOrUnwrap: boolean }}
   */
  isWrapUnwrapPair(tokenIn, tokenOut) {
    const wrappedNativeSymbol = getWrappedNativeSymbol(this.chainId);
    const isWrap = tokenIn.isNative === true && tokenOut.symbol === wrappedNativeSymbol;
    const isUnwrap = tokenIn.symbol === wrappedNativeSymbol && tokenOut.isNative === true;
    return { isWrap, isUnwrap, isWrapOrUnwrap: isWrap || isUnwrap };
  }

  /**
   * Execute native → wrapped native wrap via vault
   * Works for ETH→WETH on Arbitrum, AVAX→WAVAX on Avalanche, etc.
   * @param {Object} vault - Vault data with address
   * @param {string} amount - Amount in wei (as string)
   * @returns {Promise<Object>} Transaction receipt
   */
  async executeWrap(vault, amount) {
    const wrappedNativeSymbol = getWrappedNativeSymbol(this.chainId);
    const wrappedNativeAddress = this.tokens[wrappedNativeSymbol].address;
    const vaultContract = getVaultContract(vault.address, this.provider);
    const signer = this.getVaultSigner(vault);
    const vaultWithSigner = vaultContract.connect(signer);

    this.log(`Wrapping ${ethers.utils.formatEther(amount)} native to ${wrappedNativeSymbol}`);

    // Estimate gas before execution
    let gasEstimated = '0';
    try {
      const estimate = await retryRpcCall(
        () => vaultWithSigner.estimateGas.wrapETH(wrappedNativeAddress, amount),
        'estimateGas.wrapETH'
      );
      gasEstimated = estimate.toString();
    } catch (e) {
      this.log(`⚠️ Gas estimation failed for wrap: ${e.message}`);
    }

    const receipt = await retryRpcCall(
      async () => {
        const tx = await vaultWithSigner.wrapETH(wrappedNativeAddress, amount);
        return tx.wait();
      },
      'wrapETH',
      { log: (msg) => this.log(msg) }
    );

    this.log(`Wrap complete: ${receipt.transactionHash}`);

    this.eventManager.emit('NativeWrapped', {
      vaultAddress: vault.address,
      wrappedNativeSymbol,
      amount: amount.toString(),
      amountFormatted: ethers.utils.formatEther(amount),
      transactionHash: receipt.transactionHash,
      gasUsed: receipt.gasUsed.toString(),
      gasEstimated,
      effectiveGasPrice: receipt.effectiveGasPrice.toString(),
      success: receipt.status === 1,
      timestamp: Date.now(),
      log: { level: 'info', message: `Wrapped ${ethers.utils.formatEther(amount)} native to ${wrappedNativeSymbol}` }
    });

    return receipt;
  }

  /**
   * Execute wrapped native → native unwrap via vault
   * Works for WETH→ETH on Arbitrum, WAVAX→AVAX on Avalanche, etc.
   * @param {Object} vault - Vault data with address
   * @param {string} amount - Amount in wei (as string)
   * @returns {Promise<Object>} Transaction receipt
   */
  async executeUnwrap(vault, amount) {
    const wrappedNativeSymbol = getWrappedNativeSymbol(this.chainId);
    const wrappedNativeAddress = this.tokens[wrappedNativeSymbol].address;
    const vaultContract = getVaultContract(vault.address, this.provider);
    const signer = this.getVaultSigner(vault);
    const vaultWithSigner = vaultContract.connect(signer);

    this.log(`Unwrapping ${ethers.utils.formatEther(amount)} ${wrappedNativeSymbol} to native`);

    // Estimate gas before execution
    let gasEstimated = '0';
    try {
      const estimate = await retryRpcCall(
        () => vaultWithSigner.estimateGas.unwrapETH(wrappedNativeAddress, amount),
        'estimateGas.unwrapETH'
      );
      gasEstimated = estimate.toString();
    } catch (e) {
      this.log(`⚠️ Gas estimation failed for unwrap: ${e.message}`);
    }

    const receipt = await retryRpcCall(
      async () => {
        const tx = await vaultWithSigner.unwrapETH(wrappedNativeAddress, amount);
        return tx.wait();
      },
      'unwrapETH',
      { log: (msg) => this.log(msg) }
    );

    this.log(`Unwrap complete: ${receipt.transactionHash}`);

    this.eventManager.emit('NativeUnwrapped', {
      vaultAddress: vault.address,
      wrappedNativeSymbol,
      amount: amount.toString(),
      amountFormatted: ethers.utils.formatEther(amount),
      transactionHash: receipt.transactionHash,
      gasUsed: receipt.gasUsed.toString(),
      gasEstimated,
      effectiveGasPrice: receipt.effectiveGasPrice.toString(),
      success: receipt.status === 1,
      timestamp: Date.now(),
      log: { level: 'info', message: `Unwrapped ${ethers.utils.formatEther(amount)} ${wrappedNativeSymbol} to native` }
    });

    return receipt;
  }

  /**
   * Build combined swap details from metadata and actual results
   * @param {Array} swapMetadata - Array of swap metadata with quoted amounts
   * @param {Array} actualSwaps - Array of actual amounts from receipt
   * @returns {Array} Combined swap details with both quoted and actual amounts
   */
  buildSwapDetails(swapMetadata, actualSwaps) {
    return swapMetadata.map((metadata, index) => {
      const actual = actualSwaps[index];
      return {
        tokenInSymbol: metadata.tokenInSymbol,
        tokenOutSymbol: metadata.tokenOutSymbol,
        quotedAmountIn: metadata.quotedAmountIn,
        quotedAmountOut: metadata.quotedAmountOut,
        actualAmountIn: actual.actualAmountIn,
        actualAmountOut: actual.actualAmountOut,
        isAmountIn: metadata.isAmountIn,
        expectedSwapEvents: metadata.expectedSwapEvents
      };
    });
  }

  // ===========================================================================
  // Holdback Deduction
  // ===========================================================================

  /**
   * Reduce mint amounts to reserve tokens for executor top-up.
   * Priority matches VaultHealth.attemptTopUp:
   *   1. If one token is native or wrapped native → subtract amountNative (no conversion)
   *   2. Else → convert holdback USD via price, subtract from highest-USD-value token
   *
   * @param {Object} vault - Vault data object
   * @param {Object} token0Data - Token 0 config ({ symbol, decimals })
   * @param {Object} token1Data - Token 1 config ({ symbol, decimals })
   * @param {bigint} token0Balance - Current token0 balance (wei)
   * @param {bigint} token1Balance - Current token1 balance (wei)
   * @param {number} token0Price - Token 0 USD price
   * @param {number} token1Price - Token 1 USD price
   * @returns {{ token0Balance: bigint, token1Balance: bigint }}
   */
  applyHoldbackDeduction(vault, token0Data, token1Data, token0Balance, token1Balance, token0Price, token1Price) {
    const holdback = this.vaultHealth.getHoldback(vault.address);
    if (!holdback) return { token0Balance, token1Balance };

    const nativeSymbol = getNativeSymbol(this.chainId);
    const wrappedNativeSymbol = getWrappedNativeSymbol(this.chainId);
    const holdbackWei = ethers.utils.parseEther(holdback.amountNative.toFixed(18)).toBigInt();

    // Tier 1: native or wrapped native — subtract amountNative directly (no price conversion)
    if (token0Data.symbol === nativeSymbol || token0Data.symbol === wrappedNativeSymbol) {
      token0Balance = token0Balance > holdbackWei ? token0Balance - holdbackWei : 0n;
    } else if (token1Data.symbol === nativeSymbol || token1Data.symbol === wrappedNativeSymbol) {
      token1Balance = token1Balance > holdbackWei ? token1Balance - holdbackWei : 0n;
    } else {
      // Tier 2: neither token is native — deduct from highest-USD-value token
      const token0Usd = parseFloat(ethers.utils.formatUnits(token0Balance, token0Data.decimals)) * token0Price;
      const token1Usd = parseFloat(ethers.utils.formatUnits(token1Balance, token1Data.decimals)) * token1Price;

      if (token0Usd >= token1Usd) {
        const holdbackTokens = ethers.utils.parseUnits(
          (holdback.amountUsd / token0Price).toFixed(token0Data.decimals),
          token0Data.decimals
        ).toBigInt();
        token0Balance = token0Balance > holdbackTokens ? token0Balance - holdbackTokens : 0n;
      } else {
        const holdbackTokens = ethers.utils.parseUnits(
          (holdback.amountUsd / token1Price).toFixed(token1Data.decimals),
          token1Data.decimals
        ).toBigInt();
        token1Balance = token1Balance > holdbackTokens ? token1Balance - holdbackTokens : 0n;
      }
    }

    this.log(`Holdback deduction: ${holdback.amountNative.toFixed(6)} native ($${holdback.amountUsd.toFixed(2)}) reserved for executor top-up`);
    return { token0Balance, token1Balance };
  }

}
