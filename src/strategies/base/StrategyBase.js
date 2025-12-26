/**
 * @module strategies/base/StrategyBase
 * @description Abstract base class for all vault management strategies
 *
 * =============================================================================
 * STRATEGY INTERFACE TRACKING
 * =============================================================================
 * This tracks required methods that all strategies must implement.
 *
 * CONFIRMED INTERFACE METHODS (required for all strategies):
 * -----------------------------------------------------------------------------
 * | Method                  | Called By                    | Status    |
 * |-------------------------|------------------------------|-----------|
 * | initializeVault         | AutomationService.setupVault | CONFIRMED |
 *
 * PENDING REVIEW (may become required):
 * -----------------------------------------------------------------------------
 * | Method                       | Notes                               |
 * |------------------------------|-------------------------------------|
 * | handleSwapEvent              | Strategy-specific swap handling     |
 * | needsRecovery                | Recovery check logic                |
 * | attemptRecovery              | Recovery execution                  |
 * | cleanup                      | Vault cleanup on revocation         |
 * | setupAdditionalMonitoring    | Optional supplementary monitoring   |
 *
 * HELPER METHODS (shared utilities in StrategyBase):
 * -----------------------------------------------------------------------------
 * | Method                       | Notes                               |
 * |------------------------------|-------------------------------------|
 * | ensureApprovals              | Check & approve tokens as needed    |
 * | wrapETH                      | Wrap native ETH to WETH             |
 * | log                          | Debug logging with strategy prefix  |
 * =============================================================================
 */

import { ethers } from 'ethers';
import { getVaultContract } from 'fum_library';
import { retryRpcCall } from '../../utils/RetryHelper.js';
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
}
