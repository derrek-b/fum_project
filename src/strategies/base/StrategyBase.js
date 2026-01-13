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
 * | ensureApprovals              | Check & approve tokens as needed    |
 * | executeWrap                  | Wrap native ETH to WETH             |
 * | executeUnwrap                | Unwrap WETH to native ETH           |
 * | isWrapUnwrapPair             | Check if swap is ETH<->WETH         |
 * | buildSwapDetails             | Combine metadata with actual swaps  |
 * | log                          | Debug logging with strategy prefix  |
 * =============================================================================
 */

import { ethers } from 'ethers';
import { getVaultContract } from 'fum_library';
import { retryRpcCall, retryWithBackoff } from '../../utils/RetryHelper.js';
import { UnrecoverableError } from '../../utils/errors.js';
import ERC20ARTIFACT from '@openzeppelin/contracts/build/contracts/ERC20.json' with { type: 'json' };

const ERC20_ABI = ERC20ARTIFACT.abi;

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

  // ===========================================================================
  // Approval Helpers
  // ===========================================================================

  /**
   * Ensure token approvals exist for the given spender
   * Uses just-in-time checking - blockchain is the source of truth
   *
   * Usage: Call right before executing an operation, with spender from adapter
   *   const target = adapter.getApprovalTarget('swap');     // Permit2 for V3
   *   await this.ensureApprovals(vault, [tokenIn], target);
   *   const target = adapter.getApprovalTarget('liquidity'); // NFT PM for V3
   *   await this.ensureApprovals(vault, [token0, token1], target);
   *
   * @param {Object} vault - Vault object
   * @param {string[]} tokenAddresses - Token addresses to check
   * @param {string} spender - Spender address from adapter.getApprovalTarget(operationType)
   * @returns {Promise<{approved: string[], alreadyApproved: string[]}>}
   */
  async ensureApprovals(vault, tokenAddresses, spender) {
    const approved = [];
    const alreadyApproved = [];

    for (const tokenAddress of tokenAddresses) {
      const needsApproval = await this._checkNeedsApproval(vault.address, tokenAddress, spender);

      if (needsApproval) {
        await this._executeApproval(vault.address, tokenAddress, spender);
        approved.push(tokenAddress);
      } else {
        alreadyApproved.push(tokenAddress);
      }
    }

    if (approved.length > 0) {
      this.log(`Approved ${approved.length} token(s) for ${spender}`);
    }
    if (alreadyApproved.length > 0) {
      this.log(`${alreadyApproved.length} token(s) already approved for ${spender}`);
    }

    return { approved, alreadyApproved };
  }

  /**
   * Check if token needs approval (allowance < MAX/2)
   * @param {string} vaultAddress - Vault address
   * @param {string} tokenAddress - Token address
   * @param {string} spender - Spender address
   * @returns {Promise<boolean>} True if approval needed
   * @private
   */
  async _checkNeedsApproval(vaultAddress, tokenAddress, spender) {
    const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, this.provider);
    const allowance = await retryRpcCall(
      () => tokenContract.allowance(vaultAddress, spender),
      'allowance',
      { log: (msg) => this.log(msg) }
    );
    return allowance.lt(ethers.constants.MaxUint256.div(2));
  }

  /**
   * Execute approval through vault contract
   * @param {string} vaultAddress - Vault address
   * @param {string} tokenAddress - Token address
   * @param {string} spender - Spender address
   * @returns {Promise<void>}
   * @private
   */
  async _executeApproval(vaultAddress, tokenAddress, spender) {
    // Get vault contract with signer
    const vaultContract = getVaultContract(vaultAddress, this.provider);
    const signer = new ethers.Wallet(process.env.AUTOMATION_PRIVATE_KEY, this.provider);
    const vaultWithSigner = vaultContract.connect(signer);

    // Encode approval calldata
    const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, this.provider);
    const approvalData = tokenContract.interface.encodeFunctionData('approve', [
      spender,
      ethers.constants.MaxUint256
    ]);

    // Execute through vault with retry for transient failures
    const receipt = await retryRpcCall(
      async () => {
        const tx = await vaultWithSigner.approve([tokenAddress], [approvalData]);
        return tx.wait();
      },
      'approve',
      { log: (msg) => this.log(msg) }
    );

    this.log(`Approved ${tokenAddress} for ${spender}, tx: ${receipt.transactionHash}`);

    // Emit event for tracking
    this.eventManager.emit('TokenApprovalExecuted', {
      vaultAddress,
      tokenAddress,
      spender,
      transactionHash: receipt.transactionHash,
      log: { level: 'info', message: `Approved ${tokenAddress} for ${spender}` }
    });
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

    // Create signer for transaction execution
    const automationPrivateKey = process.env.AUTOMATION_PRIVATE_KEY;
    if (!automationPrivateKey) {
      throw new UnrecoverableError('AUTOMATION_PRIVATE_KEY not found in environment variables');
    }
    const signer = new ethers.Wallet(automationPrivateKey, this.provider);
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
        return retryRpcCall(() => vaultContract.estimateGas.mint(targets, calldatas), 'estimateGas.mint');
      case 'addliq':
        return retryRpcCall(() => vaultContract.estimateGas.increaseLiquidity(targets, calldatas), 'estimateGas.increaseLiquidity');
      case 'subliq':
        return retryRpcCall(() => vaultContract.estimateGas.decreaseLiquidity(targets, calldatas), 'estimateGas.decreaseLiquidity');
      case 'collect':
        return retryRpcCall(() => vaultContract.estimateGas.collect(targets, calldatas), 'estimateGas.collect');
      case 'burn':
        return retryRpcCall(() => vaultContract.estimateGas.burn(targets, calldatas), 'estimateGas.burn');
      default:
        throw new UnrecoverableError(`Invalid transaction type: ${type}. Must be one of: swap, approval, mint, addliq, subliq, collect, burn`);
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
        return vaultContract.mint(targets, calldatas);
      case 'addliq':
        return vaultContract.increaseLiquidity(targets, calldatas);
      case 'subliq':
        return vaultContract.decreaseLiquidity(targets, calldatas);
      case 'collect':
        return vaultContract.collect(targets, calldatas);
      case 'burn':
        return vaultContract.burn(targets, calldatas);
      default:
        throw new UnrecoverableError(`Invalid transaction type: ${type}. Must be one of: swap, approval, mint, addliq, subliq, collect, burn`);
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
  // ETH/WETH Wrap/Unwrap Helpers
  // ===========================================================================

  /**
   * Check if token pair is ETH <-> WETH (wrap/unwrap, not swap)
   * @param {Object} tokenIn - Input token data with isNative and symbol
   * @param {Object} tokenOut - Output token data with isNative and symbol
   * @returns {{ isWrap: boolean, isUnwrap: boolean, isWrapOrUnwrap: boolean }}
   */
  isWrapUnwrapPair(tokenIn, tokenOut) {
    const isWrap = tokenIn.isNative === true && tokenOut.symbol === 'WETH';
    const isUnwrap = tokenIn.symbol === 'WETH' && tokenOut.isNative === true;
    return { isWrap, isUnwrap, isWrapOrUnwrap: isWrap || isUnwrap };
  }

  /**
   * Execute ETH → WETH wrap via vault
   * @param {Object} vault - Vault data with address
   * @param {string} amount - Amount in wei (as string)
   * @returns {Promise<Object>} Transaction receipt
   */
  async executeWrap(vault, amount) {
    const wethAddress = this.tokens['WETH'].address;
    const vaultContract = getVaultContract(vault.address, this.provider);
    const signer = new ethers.Wallet(process.env.AUTOMATION_PRIVATE_KEY, this.provider);
    const vaultWithSigner = vaultContract.connect(signer);

    this.log(`Wrapping ${ethers.utils.formatEther(amount)} ETH to WETH`);

    // Estimate gas before execution
    let gasEstimated = '0';
    try {
      const estimate = await retryRpcCall(
        () => vaultWithSigner.estimateGas.wrapETH(wethAddress, amount),
        'estimateGas.wrapETH'
      );
      gasEstimated = estimate.toString();
    } catch (e) {
      this.log(`⚠️ Gas estimation failed for wrap: ${e.message}`);
    }

    const receipt = await retryRpcCall(
      async () => {
        const tx = await vaultWithSigner.wrapETH(wethAddress, amount);
        return tx.wait();
      },
      'wrapETH',
      { log: (msg) => this.log(msg) }
    );

    this.log(`Wrap complete: ${receipt.transactionHash}`);

    this.eventManager.emit('ETHWrapped', {
      vaultAddress: vault.address,
      amount: amount.toString(),
      amountFormatted: ethers.utils.formatEther(amount),
      transactionHash: receipt.transactionHash,
      gasUsed: receipt.gasUsed.toString(),
      gasEstimated,
      effectiveGasPrice: receipt.effectiveGasPrice.toString(),
      success: receipt.status === 1,
      timestamp: Date.now(),
      log: { level: 'info', message: `Wrapped ${ethers.utils.formatEther(amount)} ETH to WETH` }
    });

    return receipt;
  }

  /**
   * Execute WETH → ETH unwrap via vault
   * @param {Object} vault - Vault data with address
   * @param {string} amount - Amount in wei (as string)
   * @returns {Promise<Object>} Transaction receipt
   */
  async executeUnwrap(vault, amount) {
    const wethAddress = this.tokens['WETH'].address;
    const vaultContract = getVaultContract(vault.address, this.provider);
    const signer = new ethers.Wallet(process.env.AUTOMATION_PRIVATE_KEY, this.provider);
    const vaultWithSigner = vaultContract.connect(signer);

    this.log(`Unwrapping ${ethers.utils.formatEther(amount)} WETH to ETH`);

    // Estimate gas before execution
    let gasEstimated = '0';
    try {
      const estimate = await retryRpcCall(
        () => vaultWithSigner.estimateGas.unwrapETH(wethAddress, amount),
        'estimateGas.unwrapETH'
      );
      gasEstimated = estimate.toString();
    } catch (e) {
      this.log(`⚠️ Gas estimation failed for unwrap: ${e.message}`);
    }

    const receipt = await retryRpcCall(
      async () => {
        const tx = await vaultWithSigner.unwrapETH(wethAddress, amount);
        return tx.wait();
      },
      'unwrapETH',
      { log: (msg) => this.log(msg) }
    );

    this.log(`Unwrap complete: ${receipt.transactionHash}`);

    this.eventManager.emit('ETHUnwrapped', {
      vaultAddress: vault.address,
      amount: amount.toString(),
      amountFormatted: ethers.utils.formatEther(amount),
      transactionHash: receipt.transactionHash,
      gasUsed: receipt.gasUsed.toString(),
      gasEstimated,
      effectiveGasPrice: receipt.effectiveGasPrice.toString(),
      success: receipt.status === 1,
      timestamp: Date.now(),
      log: { level: 'info', message: `Unwrapped ${ethers.utils.formatEther(amount)} WETH to ETH` }
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

}
