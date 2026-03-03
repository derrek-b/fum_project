/**
 * @module strategies/babySteps/BabyStepsStrategy
 * @description Baby Steps strategy implementation for conservative position management
 */

import { ethers } from 'ethers';
import { StrategyBase } from '../base/index.js';
import { getStrategyDetails, getTransactionDeadlineMinutes, getVaultContract, fetchTokenPrices, CACHE_DURATIONS, getMinDeploymentForGas, getMinSwapValue } from 'fum_library';
import { getWrappedNativeAddress, getWrappedNativeSymbol, getNativeSymbol } from 'fum_library/helpers/tokenHelpers';
import { retryRpcCall } from '../../utils/RetryHelper.js';
import { UnrecoverableError } from '../../utils/errors.js';

/**
 * Baby Steps Strategy - Conservative position management with single position per vault
 *
 * Phase 1: Basic initialization only.
 * Strategy methods TBD during Phase 2 design.
 */
export default class BabyStepsStrategy extends StrategyBase {
  /**
   * Create a new BabyStepsStrategy instance
   * @param {Object} dependencies - Strategy dependencies (passed to StrategyBase)
   */
  constructor(dependencies) {
    super(dependencies);

    // Strategy identification
    this.type = 'bob';
    this.name = 'Baby Steps Strategy';

    // Load strategy config from library
    this.config = getStrategyDetails('bob');

    // State tracking - initialized empty, populated during vault initialization
    this.emergencyExitBaseline = {};
    this.swapCountSinceLastFeeCheck = {};  // { [vaultAddress]: number }
  }

  // ===========================================================================
  // Vault Initialization
  // ===========================================================================

  /**
   * Initialize a vault for the Baby Steps strategy
   * Called by AutomationService.setupVault after vault data is loaded
   *
   * @param {Object} vault - Vault data object
   * @returns {Promise<boolean>} Success status
   */
  async initializeVault(vault) {
    this.log(`Initializing vault ${vault.address} for Baby Steps strategy`);
    // Step 1: Select best pool (must happen before position evaluation)
    const [targetToken0, targetToken1] = vault.targetTokens;
    const adapter = this.adapters.get(vault.targetPlatforms[0]);
    const platformId = vault.targetPlatforms[0];

    if (!adapter) {
      throw new UnrecoverableError(`No adapter for platform ${platformId}`);
    }

    // Select best pool via adapter
    const { bestPool, poolsDiscovered, poolsActive } = await retryRpcCall(
      () => adapter.selectBestPool(targetToken0, targetToken1, this.provider, this.chainId),
      'selectBestPool',
      { log: (msg) => this.log(msg) }
    );

    // Emit BestPoolSelected event
    this.eventManager.emit('BestPoolSelected', {
      vaultAddress: vault.address,
      platformId,
      pool: bestPool,
      poolsDiscovered,
      poolsActive,
      timestamp: Date.now(),
      log: {
        level: 'info',
        message: `Selected ${adapter.describePool(bestPool)}`
      }
    });

    const targetPool = bestPool;

    this.log(`🎯 Target pool selected: ${adapter.describePool(targetPool)}`);

    // Step 1.5: Check emergency exit baseline if exists (retry/recovery scenario)
    // If vault was in retry queue and price moved beyond emergency threshold, blacklist immediately
    const existingBaseline = this.emergencyExitBaseline[vault.address];
    if (existingBaseline !== undefined) {
      const { emergencyExitTrigger } = vault.strategy.parameters;

      if (emergencyExitTrigger) {
        // Use adapter to evaluate price movement (targetPool has current state from selectBestPool)
        const priceMovement = adapter.evaluatePriceMovement(
          targetPool,  // Pool data from selectBestPool includes current tick/state
          existingBaseline,
          targetPool.token0,
          targetPool.token1
        );

        if (priceMovement.priceMovementPercent >= emergencyExitTrigger) {
          this.log(`🚨 EMERGENCY EXIT TRIGGERED during setup for vault ${vault.address}:`);
          this.log(`  Price moved ${priceMovement.priceMovementPercent.toFixed(2)}% while in retry queue (trigger: ${emergencyExitTrigger}%)`);
          this.log(`  Baseline: ${priceMovement.baselinePrice} → Current: ${priceMovement.currentPrice}`);

          const reason = `Emergency exit: price moved ${priceMovement.priceMovementPercent.toFixed(2)}% ` +
                         `(threshold: ${emergencyExitTrigger}%) while vault was in retry queue - ` +
                         `${priceMovement.direction} from ${priceMovement.baselinePrice} to ${priceMovement.currentPrice}`;

          // Blacklist vault - this handles all cleanup (offboardVault, listeners, caches, baseline)
          await this.automationService.blacklistVault(vault.address, reason);

          // Notify owner
          await this.sendTelegramMessage(
            `🚨 EMERGENCY EXIT (retry): ${vault.address.slice(0, 6)}...${vault.address.slice(-4)}\n` +
            `Price moved ${priceMovement.priceMovementPercent.toFixed(2)}% ${priceMovement.direction} while in retry queue (threshold: ${emergencyExitTrigger}%)\n` +
            `Vault blacklisted - manual review required.`
          ).catch(err => console.error('Telegram notification error:', err));

          return false;
        }
      }

      this.log(`✅ Baseline check passed for retry scenario`);
    }

    // Step 2: Evaluate positions against targetPool
    const evaluation = await this.evaluateInitialPositions(vault, targetPool);
    this.log(`Evaluation complete: ${Object.keys(evaluation.alignedPositions).length} aligned, ${Object.keys(evaluation.nonAlignedPositions).length} non-aligned`);

    // Step 3: Close non-aligned positions
    if (Object.keys(evaluation.nonAlignedPositions).length > 0) {
      this.log(`Closing ${Object.keys(evaluation.nonAlignedPositions).length} non-aligned position(s)`);
      const { receipt, feesByPosition } = await this.closePositions(vault, evaluation.nonAlignedPositions);

      // Aggregate fees, emit FeesCollected, and distribute to owner
      if (Object.keys(feesByPosition).length > 0) {
        const aggregatedFees = this.aggregateFeesFromPositions(feesByPosition);
        await this.emitFeesCollected(
          vault,
          aggregatedFees,
          'initialization',
          Object.keys(feesByPosition),
          receipt.transactionHash
        );

        // Wrap distribution in try-catch - fees remain in vault on failure
        try {
          await this.distributeFees(vault, aggregatedFees);
        } catch (error) {
          // Calculate USD value of failed distribution
          let totalFailedUSD = 0;
          try {
            const tokenSymbols = Object.values(aggregatedFees).map(f => f.symbol);
            const prices = await retryRpcCall(
              () => fetchTokenPrices(tokenSymbols, CACHE_DURATIONS['30-SECONDS']),
              'fetch prices for failed distribution',
              { log: (msg) => this.log(msg) }
            );
            for (const fee of Object.values(aggregatedFees)) {
              const amountFormatted = parseFloat(ethers.utils.formatUnits(fee.amount, fee.decimals));
              const price = prices[fee.symbol.toUpperCase()] || 0;
              totalFailedUSD += amountFormatted * price;
            }
          } catch (priceError) {
            this.log(`🔴 Could not fetch prices for failed distribution: ${priceError.message}`);
          }

          this.eventManager.emit('FeeDistributionFailed', {
            vaultAddress: vault.address,
            fees: aggregatedFees,
            source: 'initialization',
            totalFailedUSD,
            error: error.message,
            timestamp: Date.now(),
            log: {
              level: 'error',
              message: `🔴 Fee distribution failed for vault ${vault.address}: ${error.message}`
            }
          });

          this.sendTelegramMessage(
            `⚠️ Fee distribution failed: ${vault.address.slice(0, 6)}...${vault.address.slice(-4)}\n` +
            `Fees remain in vault - will retry on next operation\n` +
            `Error: ${error.message.slice(0, 100)}`
          ).catch(console.error);
          // Continue with operation - fees are safe in vault
        }
      }
    }

    // Step 4: Refresh token balances after position closures and fee distribution
    await this.vaultDataService.refreshTokens(vault.address);

    // Step 5: Calculate available deployment
    const { availableDeployment, assetValues } = await this.calculateAvailableDeployment(vault);

    // Step 6: Deploy capital
    if (availableDeployment > 0) {
      if (Object.keys(evaluation.alignedPositions).length > 0) {
        // We have an aligned position - add liquidity to it
        const position = Object.values(evaluation.alignedPositions)[0]; // BabySteps only allows 1 position
        await this.addToPosition(vault, position, assetValues, availableDeployment, targetPool);

        // Step 6a: Set emergency exit baseline (only if not already set)
        // If baseline exists, we're in a retry scenario and should preserve the original baseline
        if (this.emergencyExitBaseline[vault.address] === undefined) {
          const currentPool = adapter.getPoolCurrent(targetPool);
          this.emergencyExitBaseline[vault.address] = currentPool;
          this.log(`Set emergency exit baseline ${JSON.stringify(currentPool)} for vault ${vault.address}`);
        } else {
          this.log(`Preserved existing emergency exit baseline ${this.emergencyExitBaseline[vault.address]} for vault ${vault.address} (retry scenario)`);
        }
      } else {
        // No aligned positions - create a new one
        await this.createNewPosition(vault, availableDeployment, assetValues, targetPool);
      }
    } else {
      // availableDeployment <= 0
      if (assetValues.totalVaultValue === 0) {
        throw new Error(`Empty vault cannot be managed: no tokens or positions (vault: ${vault.address})`);
      } else {
        // No available tokens above minimum threshold - all value is in positions
        this.log('No available capital to deploy (all value in positions or below minimum)');

        // Still need to set emergency exit baseline if we have aligned positions
        if (Object.keys(evaluation.alignedPositions).length > 0 && this.emergencyExitBaseline[vault.address] === undefined) {
          const currentPool = adapter.getPoolCurrent(targetPool);
          this.emergencyExitBaseline[vault.address] = currentPool;
          this.log(`Set emergency exit baseline ${JSON.stringify(currentPool)} for vault ${vault.address} (no deployable capital)`);
        }
      }
    }

    return true;
  }

  // ===========================================================================
  // Swap Event Handling
  // ===========================================================================

  /**
   * Handle a swap event from a monitored pool
   *
   * Evaluates whether the vault needs action (rebalance, fee collection, emergency exit)
   * based on the new pool state after the swap.
   *
   * @override
   * @param {Object} vault - Vault object
   * @param {string} poolId - Pool where swap occurred
   * @param {string} platform - Platform identifier
   * @param {Object} log - Raw log from blockchain event
   * @returns {Promise<void>}
   */
  async handleSwapEvent(vault, poolId, platform, log) {
    this.log(`handleSwapEvent called for vault ${vault.address}, pool ${poolId}`);

    // STEP 1: Parse swap event using platform adapter
    const adapter = this.adapters.get(platform);
    if (!adapter) {
      throw new UnrecoverableError(`No adapter for platform ${platform}`);
    }

    // Parse swap event - returns platform-specific data (kept opaque for adapter methods)
    const swapData = adapter.parseSwapEvent(log);

    // STEP 2: Validate Baby Steps constraints
    const positionIds = Object.keys(vault.positions);

    if (positionIds.length === 0) {
      throw new Error(`BabySteps: vault ${vault.address} has no positions`);
    }

    if (positionIds.length > 1) {
      throw new Error(`BabySteps: vault ${vault.address} has ${positionIds.length} positions (expected 1)`);
    }

    const position = vault.positions[positionIds[0]];

    if (position.pool.toLowerCase() !== poolId.toLowerCase()) {
      throw new Error(`BabySteps: pool mismatch - swap for ${poolId} but position in ${position.pool}`);
    }

    this.log(`Found position ${position.id} for pool ${poolId}`);

    // STEP 3: Check emergency exit trigger - if triggered, execute immediately and return (highest priority)
    const emergencyExitTrigger = vault.strategy.parameters.emergencyExitTrigger;

    if (emergencyExitTrigger) {
      const baseline = this.emergencyExitBaseline[vault.address];

      if (baseline === undefined || baseline === null) {
        throw new Error(`BabySteps: emergency exit configured (${emergencyExitTrigger}%) but no baseline for vault ${vault.address}`);
      }

      const poolMetadata = this.poolData[position.pool];
      if (!poolMetadata) {
        throw new Error(`BabySteps: missing pool metadata for emergency exit check (pool: ${position.pool})`);
      }

      const token0Data = this.tokens[poolMetadata.token0Symbol];
      const token1Data = this.tokens[poolMetadata.token1Symbol];
      if (!token0Data || !token1Data) {
        throw new Error(`BabySteps: missing token data for emergency exit check (${poolMetadata.token0Symbol}/${poolMetadata.token1Symbol})`);
      }

      // Evaluate price movement (synchronous calculation, no RPC)
      const priceMovement = adapter.evaluatePriceMovement(
        swapData,
        baseline,
        token0Data,
        token1Data
      );

      this.log(`Price movement: ${priceMovement.priceMovementPercent.toFixed(2)}% (${priceMovement.direction}), trigger: ${emergencyExitTrigger}%`);

      if (priceMovement.priceMovementPercent >= emergencyExitTrigger) {
        this.log(`🚨 EMERGENCY EXIT TRIGGERED for vault ${vault.address}:`);
        this.log(`  Price moved ${priceMovement.priceMovementPercent.toFixed(2)}% (trigger: ${emergencyExitTrigger}%)`);
        this.log(`  Baseline: ${priceMovement.baselinePrice} → Current: ${priceMovement.currentPrice}`);

        // Blacklist and notify - vault cleanup handled by blacklistVault()
        await this.executeEmergencyExit(vault, priceMovement);
        return;
      }
    } else {
      throw new Error(`Emergency exit not configured for vault ${vault.address}`);
    }

    // STEP 4: Check if rebalance needed - if needed, execute immediately and return
    const rangeStatus = await adapter.evaluatePositionRange(
      position,
      null,  // provider not needed when swapData provided
      { swapData }
    );

    this.log(`Position range status: centeredness=${(rangeStatus.centeredness * 100).toFixed(2)}%, inRange=${rangeStatus.inRange}, current=${rangeStatus.current}`);

    if (!rangeStatus.inRange) {
      this.log(`🔄 REBALANCE NEEDED for vault ${vault.address}: Position is out of range`);
      await this.rebalancePosition(vault, position);
      this.swapCountSinceLastFeeCheck[vault.address] = 0;
      return;
    }

    // STEP 5: Check if fees need collected
    // Use 50-swap interval to reduce RPC calls
    const FEE_CHECK_INTERVAL = 50;

    this.swapCountSinceLastFeeCheck[vault.address] =
      (this.swapCountSinceLastFeeCheck[vault.address] || 0) + 1;

    const swapCount = this.swapCountSinceLastFeeCheck[vault.address];
    this.log(`Swap count since last fee check: ${swapCount}/${FEE_CHECK_INTERVAL}`);

    if (swapCount >= FEE_CHECK_INTERVAL) {
      try {
        const { shouldCollect, feeData } = await this.checkFeesToCollect(vault, position, adapter);

        if (shouldCollect) {
          this.log(`💰 Executing fee collection for vault ${vault.address}`);
          await this.collectFees(vault, position, feeData);
          await this.vaultDataService.refreshTokens(vault.address);
          this.log(`Refreshed token balances for ${vault.address}`);
          this.swapCountSinceLastFeeCheck[vault.address] = 0;  // Reset after successful collection
          return;
        } else {
          // No collection needed, reset counter to check again in 50 swaps
          this.swapCountSinceLastFeeCheck[vault.address] = 0;
        }
      } catch (error) {
        this.log(`Error checking fees: ${error.message}`);
        // Counter stays at 50+ so we retry on next swap
      }
    }

    // -------------------------------------------------------------------------
    // STEP 6: No action needed
    // -------------------------------------------------------------------------
    this.log(`✅ Position ${position.id} is healthy, no action needed`);
  }

  // ===========================================================================
  // Emergency Exit
  // ===========================================================================

  /**
   * Execute emergency exit - blacklist vault and notify owner
   *
   * When price movement exceeds the emergency exit threshold, we stop automated
   * management and let the owner decide what to do. We do NOT close positions
   * or make financial decisions - just blacklist and notify.
   *
   * @param {Object} vault - Vault data
   * @param {Object} priceMovement - Price movement data from adapter.evaluatePriceMovement()
   * @param {number} priceMovement.priceMovementPercent - Percentage price moved
   * @param {string} priceMovement.direction - 'up' or 'down'
   * @param {string} priceMovement.baselinePrice - Baseline price string
   * @param {string} priceMovement.currentPrice - Current price string
   */
  async executeEmergencyExit(vault, priceMovement) {
    const vaultAddress = vault.address;
    const trigger = vault.strategy.parameters.emergencyExitTrigger;

    const reason = `Emergency exit: price moved ${priceMovement.priceMovementPercent.toFixed(2)}% ` +
                   `(threshold: ${trigger}%) - ${priceMovement.direction} from ${priceMovement.baselinePrice} to ${priceMovement.currentPrice}`;

    this.log(`🚨 Executing emergency exit for vault ${vaultAddress}`);

    // Blacklist vault - this handles all cleanup (offboardVault, listeners, caches)
    await this.automationService.blacklistVault(vaultAddress, reason);

    // Notify owner
    await this.sendTelegramMessage(
      `🚨 EMERGENCY EXIT: ${vaultAddress.slice(0, 6)}...${vaultAddress.slice(-4)}\n` +
      `Price moved ${priceMovement.priceMovementPercent.toFixed(2)}% ${priceMovement.direction} (threshold: ${trigger}%)\n` +
      `Vault blacklisted - manual review required.`
    ).catch(err => console.error('Telegram notification error:', err));

    this.log(`Emergency exit complete for vault ${vaultAddress}`);
  }

  // ===========================================================================
  // Fee Management
  // ===========================================================================

  /**
   * Check if accumulated fees exceed collection threshold
   *
   * @param {Object} vault - Vault data
   * @param {Object} position - Position to check
   * @param {Object} adapter - Platform adapter
   * @returns {Promise<{shouldCollect: boolean, feeData: Object|null}>}
   */
  async checkFeesToCollect(vault, position, adapter) {
    // Check if fee reinvestment is enabled
    if (!vault.strategy.parameters.feeReinvestment) {
      this.log(`Fee reinvestment disabled for vault ${vault.address}`);
      return { shouldCollect: false, feeData: null };
    }

    const reinvestmentTrigger = vault.strategy.parameters.reinvestmentTrigger;
    if (!reinvestmentTrigger || reinvestmentTrigger === 0) {
      this.log(`No reinvestment trigger set for vault ${vault.address}`);
      return { shouldCollect: false, feeData: null };
    }

    // Get pool metadata for token symbols
    const poolMetadata = this.poolData[position.pool];
    if (!poolMetadata) {
      throw new Error(`Missing pool metadata for position ${position.id} (pool: ${position.pool})`);
    }

    const token0Symbol = poolMetadata.token0Symbol;
    const token1Symbol = poolMetadata.token1Symbol;

    // Fetch current prices from CoinGecko
    const prices = await retryRpcCall(
      () => fetchTokenPrices([token0Symbol, token1Symbol], CACHE_DURATIONS['30-SECONDS']),
      'fetchTokenPrices for fee check',
      { log: (msg) => this.log(msg) }
    );

    const token0Price = prices[token0Symbol.toUpperCase()];
    const token1Price = prices[token1Symbol.toUpperCase()];

    if (token0Price === 0 && token1Price === 0) {
      this.log(`⚠️ No price data available for fee calculation (CoinGecko may be unavailable)`);
      return { shouldCollect: false, feeData: null };
    }

    // Use platform-agnostic adapter method (handles all internal data fetching)
    const fees = await retryRpcCall(
      () => adapter.getAccruedFeesUSD(
        position,
        { token0: token0Price, token1: token1Price },
        this.provider
      ),
      'getAccruedFeesUSD',
      { log: (msg) => this.log(msg) }
    );

    this.log(`💵 Fees - ${poolMetadata.token0Symbol}: ${fees.token0Fees.toFixed(6)} ($${fees.token0USD.toFixed(4)}), ${poolMetadata.token1Symbol}: ${fees.token1Fees.toFixed(6)} ($${fees.token1USD.toFixed(4)}), Total: $${fees.totalUSD.toFixed(4)} (trigger: $${reinvestmentTrigger})`);

    const shouldCollect = fees.totalUSD >= reinvestmentTrigger;
    this.log(`Should collect fees: ${shouldCollect}`);

    return { shouldCollect, feeData: fees };
  }

  /**
   * Collect fees from a position and distribute to owner
   *
   * Generates and executes the collect transaction, parses the receipt,
   * emits the FeesCollected event, and distributes owner's portion.
   *
   * @param {Object} vault - Vault data
   * @param {Object} position - Position to collect fees from
   * @param {Object} feeData - Fee data from checkFeesToCollect (opaque to strategy, adapter extracts what it needs)
   * @returns {Promise<Object>} Collection results
   */
  async collectFees(vault, position, feeData) {
    const positionId = position.id;

    // Get pool metadata
    const poolMetadata = this.poolData[position.pool];
    if (!poolMetadata) {
      throw new UnrecoverableError(`Missing pool metadata for position ${positionId}`);
    }

    // Get adapter
    const adapter = this.adapters.get(poolMetadata.platform);
    if (!adapter) {
      throw new UnrecoverableError(`No adapter for platform ${poolMetadata.platform}`);
    }

    // Get token data
    const token0Data = this.tokens[poolMetadata.token0Symbol];
    const token1Data = this.tokens[poolMetadata.token1Symbol];
    if (!token0Data || !token1Data) {
      throw new UnrecoverableError(`Missing token data for ${poolMetadata.token0Symbol}/${poolMetadata.token1Symbol}`);
    }

    // Check if tokens are native ETH (platform-agnostic via token data)
    const token0IsNative = token0Data.isNative === true;
    const token1IsNative = token1Data.isNative === true;
    const hasNativeToken = token0IsNative || token1IsNative;

    // Use fee data from checkFeesToCollect (avoids redundant RPC calls)
    const expectedFeesResult = feeData;

    this.log(`Generating claim fees transaction for position ${positionId}`);

    // Generate claim fees transaction
    const claimFeesData = await retryRpcCall(
      () => adapter.generateClaimFeesData({
        position,
        provider: this.provider,
        walletAddress: vault.address,
        token0Address: token0Data.address,
        token1Address: token1Data.address,
        token0Decimals: token0Data.decimals,
        token1Decimals: token1Data.decimals,
        token0IsNative,
        token1IsNative,
        poolData: poolMetadata,
        feeData,
      }),
      'generateClaimFeesData',
      { log: (msg) => this.log(msg) }
    );

    // Execute via vault's collect function
    const txResult = await this.executeBatchTransactions(
      vault,
      [{ to: claimFeesData.to, data: claimFeesData.data, value: claimFeesData.value || 0 }],
      'fee collection',
      'collect'
    );

    // Build position metadata for receipt parsing
    // V4 needs position.liquidity for proportional native ETH distribution
    const positionMetadata = {
      [positionId]: {
        token0Data,
        token1Data,
        position
      }
    };

    // Parse the collect receipt, with fallback to pre-calculated fees if parsing fails
    let feesByPosition;
    try {
      const { feesByPosition: parsedFees } = await retryRpcCall(
        () => adapter.parseCollectReceipt(
          txResult.receipt,
          positionMetadata,
          { chainId: this.chainId, walletAddress: vault.address }
        ),
        'parseCollectReceipt',
        { log: (msg) => this.log(msg) }
      );

      // Fill in null values with pre-calculated fees (for native ETH positions)
      feesByPosition = hasNativeToken
        ? this._fillMissingFees(parsedFees, {
            [positionId]: { fees0: expectedFeesResult.fees0, fees1: expectedFeesResult.fees1 }
          })
        : parsedFees;
    } catch (parseError) {
      // Transaction succeeded but parsing failed - use pre-calculated fees as fallback
      this.log(`⚠️ PARSER_FALLBACK: Position ${positionId} - ${parseError.message}, using pre-calculated fees`);
      feesByPosition = {
        [positionId]: {
          token0: ethers.BigNumber.from(expectedFeesResult.fees0),
          token1: ethers.BigNumber.from(expectedFeesResult.fees1),
          metadata: positionMetadata[positionId]
        }
      };
    }

    // Log collected amounts
    const fees = feesByPosition[positionId];
    this.log(`Collected fees - ${token0Data.symbol}: ${ethers.utils.formatUnits(fees.token0, token0Data.decimals)}, ${token1Data.symbol}: ${ethers.utils.formatUnits(fees.token1, token1Data.decimals)}`);

    // Aggregate fees (single position but using standard flow)
    const aggregatedFees = this.aggregateFeesFromPositions(feesByPosition);

    // Emit FeesCollected event
    await this.emitFeesCollected(
      vault,
      aggregatedFees,
      'swap_threshold',
      [positionId],
      txResult.receipt.transactionHash
    );

    // Distribute owner's portion - wrap in try-catch as fees remain in vault on failure
    let distributionResult = null;
    try {
      distributionResult = await this.distributeFees(vault, aggregatedFees);
    } catch (error) {
      // Calculate USD value of failed distribution
      let totalFailedUSD = 0;
      try {
        const tokenSymbols = Object.values(aggregatedFees).map(f => f.symbol);
        const prices = await retryRpcCall(
          () => fetchTokenPrices(tokenSymbols, CACHE_DURATIONS['30-SECONDS']),
          'fetch prices for failed distribution',
          { log: (msg) => this.log(msg) }
        );
        for (const fee of Object.values(aggregatedFees)) {
          const amountFormatted = parseFloat(ethers.utils.formatUnits(fee.amount, fee.decimals));
          const price = prices[fee.symbol.toUpperCase()] || 0;
          totalFailedUSD += amountFormatted * price;
        }
      } catch (priceError) {
        this.log(`🔴 Could not fetch prices for failed distribution: ${priceError.message}`);
      }

      this.eventManager.emit('FeeDistributionFailed', {
        vaultAddress: vault.address,
        fees: aggregatedFees,
        source: 'swap_threshold',
        totalFailedUSD,
        error: error.message,
        timestamp: Date.now(),
        log: {
          level: 'error',
          message: `🔴 Fee distribution failed for vault ${vault.address}: ${error.message}`
        }
      });

      this.sendTelegramMessage(
        `⚠️ Fee distribution failed: ${vault.address.slice(0, 6)}...${vault.address.slice(-4)}\n` +
        `Fees remain in vault - will retry on next operation\n` +
        `Error: ${error.message.slice(0, 100)}`
      ).catch(console.error);
      // Continue - fees collected but not distributed
    }

    return {
      receipt: txResult.receipt,
      feesByPosition,
      distributionResult
    };
  }

  // ===========================================================================
  // Rebalance
  // ===========================================================================

  /**
   * Rebalance a position that is out of range or near boundaries
   *
   * Closes the existing position, distributes any collected fees to the owner,
   * and creates a new position centered on the current price.
   *
   * @param {Object} vault - Vault object
   * @param {Object} position - Position to rebalance
   * @returns {Promise<void>}
   */
  async rebalancePosition(vault, position) {
    const vaultAddress = vault.address;
    this.log(`🔄 Starting rebalance for position ${position.id} in vault ${vaultAddress}`);

    try {
      // Step 1: Get fresh targetPool data for new position creation
      const adapter = this.adapters.get(vault.targetPlatforms[0]);
      if (!adapter) {
        throw new UnrecoverableError(`No adapter for platform ${vault.targetPlatforms[0]}`);
      }

      // selectBestPool handles native -> wrapped native resolution internally
      const { bestPool } = await retryRpcCall(
        () => adapter.selectBestPool(vault.targetTokens[0], vault.targetTokens[1], this.provider, this.chainId),
        'selectBestPool (rebalance)',
        { log: (msg) => this.log(msg) }
      );

      const targetPool = bestPool;

      this.log(`Target pool for new position: ${adapter.describePool(targetPool)}`);

      // Step 2: Close the out-of-range position
      const rebalanceBounds = adapter.extractPositionBounds(position);
      const { receipt, feesByPosition } = await this.closePositions(vault, { [position.id]: position });

      // Step 3: Process fees (if any)
      if (Object.keys(feesByPosition).length > 0) {
        const aggregatedFees = this.aggregateFeesFromPositions(feesByPosition);
        await this.emitFeesCollected(
          vault,
          aggregatedFees,
          'rebalance',
          [position.id],
          receipt.transactionHash
        );

        // Wrap distribution in try-catch - fees remain in vault on failure
        try {
          await this.distributeFees(vault, aggregatedFees);
        } catch (error) {
          // Calculate USD value of failed distribution
          let totalFailedUSD = 0;
          try {
            const tokenSymbols = Object.values(aggregatedFees).map(f => f.symbol);
            const prices = await retryRpcCall(
              () => fetchTokenPrices(tokenSymbols, CACHE_DURATIONS['30-SECONDS']),
              'fetch prices for failed distribution',
              { log: (msg) => this.log(msg) }
            );
            for (const fee of Object.values(aggregatedFees)) {
              const amountFormatted = parseFloat(ethers.utils.formatUnits(fee.amount, fee.decimals));
              const price = prices[fee.symbol.toUpperCase()] || 0;
              totalFailedUSD += amountFormatted * price;
            }
          } catch (priceError) {
            this.log(`🔴 Could not fetch prices for failed distribution: ${priceError.message}`);
          }

          this.eventManager.emit('FeeDistributionFailed', {
            vaultAddress: vault.address,
            fees: aggregatedFees,
            source: 'rebalance',
            totalFailedUSD,
            error: error.message,
            timestamp: Date.now(),
            log: {
              level: 'error',
              message: `🔴 Fee distribution failed for vault ${vault.address}: ${error.message}`
            }
          });

          this.sendTelegramMessage(
            `⚠️ Fee distribution failed: ${vault.address.slice(0, 6)}...${vault.address.slice(-4)}\n` +
            `Fees remain in vault - will retry on next operation\n` +
            `Error: ${error.message.slice(0, 100)}`
          ).catch(console.error);
          // Continue with rebalance - fees are safe in vault
        }
      }

      // Step 4: Refresh token balances after position closure and fee distribution
      await this.vaultDataService.refreshTokens(vault.address);

      // Step 5: Calculate available deployment
      const { availableDeployment, assetValues } = await this.calculateAvailableDeployment(vault);

      // Step 6: Validate - we MUST have capital after closing a position
      if (availableDeployment <= 0) {
        throw new UnrecoverableError(
          `No available capital after closing position. ` +
          `availableDeployment=${availableDeployment}, totalValue=${assetValues.totalVaultValue}, ` +
          `tokenValue=${assetValues.totalTokenValue}`
        );
      }

      // Step 7: Create new position centered on current price
      // Note: createNewPosition handles its own cache update via getPositionById + updatePosition
      await this.createNewPosition(vault, availableDeployment, assetValues, targetPool);

      // Step 8: Emit PositionRebalanced event
      this.eventManager.emit('PositionRebalanced', {
        vaultAddress: vault.address,
        oldPositionId: position.id,
        reason: 'out_of_range_or_threshold',
        availableDeployment,
        timestamp: Date.now(),
        log: {
          level: 'info',
          message: `Position ${position.id} rebalanced for vault ${vault.address}`
        }
      });

      // Step 11: Send notification
      this.sendTelegramMessage(
        `🔄 Position rebalanced: ${vaultAddress.slice(0, 6)}...${vaultAddress.slice(-4)} ` +
        `(Position ${position.id} was out of range)`
      ).catch(console.error);

      this.log(`✅ Rebalance complete for vault ${vaultAddress}`);

    } catch (error) {
      // Log and notify - let handleSwapEvent → trackFailedVault handle retry/blacklist
      const message = `Rebalance failed for vault ${vaultAddress}: ${error.message}`;
      console.error(`[${vaultAddress}] ${message}`);

      this.sendTelegramMessage(
        `⚠️ Rebalance failed: ${vaultAddress.slice(0, 6)}...${vaultAddress.slice(-4)} - ${error.message.slice(0, 100)}`
      ).catch(console.error);

      // Re-throw to trigger retry mechanism via handleSwapEvent
      throw error;
    }
  }

  // ===========================================================================
  // Position Evaluation
  // ===========================================================================

  /**
   * Evaluate which positions are aligned with the Baby Steps strategy
   *
   * Alignment criteria:
   * 1. Token alignment: both position tokens must be in vault.targetTokens
   * 2. Platform alignment: position platform must be in vault.targetPlatforms
   * 3. Pool alignment: position must be in the targetPool (same pool address)
   * 4. Range alignment: position must be in range (current tick within position bounds)
   * 5. maxPositions limit: if more aligned positions than allowed, keep most centered
   *
   * @param {Object} vault - Vault data object
   * @param {Object} vault.positions - Positions keyed by position ID
   * @param {string[]} vault.targetTokens - Target token symbols
   * @param {string[]} vault.targetPlatforms - Target platform IDs
   * @param {Object} vault.strategy - Strategy configuration
   * @param {string} vault.address - Vault address
   * @param {Object} targetPool - Selected target pool from selectBestPool()
   * @param {string} targetPool.address - Pool address to match against
   * @returns {Promise<Object>} Evaluation result
   * @returns {Object} result.alignedPositions - Positions aligned with strategy
   * @returns {Object} result.nonAlignedPositions - Positions not aligned with strategy
   */
  async evaluateInitialPositions(vault, targetPool) {
    const { positions, targetPlatforms, address } = vault;

    const alignedPositions = {};
    const nonAlignedPositions = {};

    // Handle empty positions case
    if (!positions || Object.keys(positions).length === 0) {
      this.log(`Vault ${address} has no positions to evaluate`);

      this.eventManager.emit('InitialPositionsEvaluated', {
        vaultAddress: address,
        alignedCount: 0,
        nonAlignedCount: 0,
        alignedPositionIds: [],
        nonAlignedPositionIds: [],
        success: true,
        timestamp: Date.now(),
        log: {
          level: 'info',
          message: 'No positions to evaluate'
        }
      });

      return { alignedPositions, nonAlignedPositions };
    }

    // Use targetPool's actual tokens for alignment (adapter-resolved, e.g., WETH/WAVAX for V3)
    // This allows vault.targetTokens to contain 'ETH'/'AVAX' while we check against wrapped versions
    const targetTokenSymbols = [targetPool.token0.symbol, targetPool.token1.symbol];

    for (const [positionId, position] of Object.entries(positions)) {
      // 1. Get pool metadata from cache
      const poolMetadata = this.poolData[position.pool];
      if (!poolMetadata) {
        throw new UnrecoverableError(`Position ${positionId} missing pool metadata for ${position.pool}`);
      }

      // 2. Basic alignment check: tokens (using targetPool's resolved tokens)
      const token0Symbol = poolMetadata.token0Symbol;
      const token1Symbol = poolMetadata.token1Symbol;
      const tokensAligned = targetTokenSymbols.includes(token0Symbol) && targetTokenSymbols.includes(token1Symbol);

      if (!tokensAligned) {
        this.log(`Position ${positionId} tokens not aligned: ${token0Symbol}/${token1Symbol} not in [${targetTokenSymbols.join(', ')}]`);
        nonAlignedPositions[positionId] = position;
        continue;
      }

      // 3. Basic alignment check: platform
      const positionPlatform = poolMetadata.platform;
      const platformAligned = positionPlatform && targetPlatforms.includes(positionPlatform);

      if (!platformAligned) {
        this.log(`Position ${positionId} platform not aligned: ${positionPlatform} not in [${targetPlatforms.join(', ')}]`);
        nonAlignedPositions[positionId] = position;
        continue;
      }

      // 4. Pool alignment check: position must be in the same pool as targetPool
      const poolAligned = position.pool.toLowerCase() === targetPool.address.toLowerCase();
      if (!poolAligned) {
        this.log(`Position ${positionId} pool not aligned: ${position.pool} !== targetPool ${targetPool.address}`);
        nonAlignedPositions[positionId] = position;
        continue;
      }

      // 5. Range alignment check via adapter
      const adapter = this.adapters.get(positionPlatform);

      if (!adapter) {
        throw new UnrecoverableError(`No adapter for platform ${positionPlatform}`);
      }

      const rangeStatus = await retryRpcCall(
        () => adapter.evaluatePositionRange(position, this.provider),
        'evaluatePositionRange',
        { log: (msg) => this.log(msg) }
      );

      // 6. Check range alignment result - position must be in range
      if (!rangeStatus.inRange) {
        const positionBounds = adapter.extractPositionBounds(position);
        this.log(`Position ${positionId} out of range: current=${rangeStatus.current}, range=${positionBounds.lower}-${positionBounds.upper}`);
        nonAlignedPositions[positionId] = position;
      } else {
        this.log(`Position ${positionId} aligned: ${token0Symbol}/${token1Symbol} on ${positionPlatform}, centeredness=${rangeStatus.centeredness.toFixed(4)}`);
        // Store position with centeredness for maxPositions sorting
        alignedPositions[positionId] = {
          ...position,
          _centeredness: rangeStatus.centeredness
        };
      }
    }

    // 7. Apply maxPositions limit - if too many aligned, keep most centered
    const { maxPositions } = getStrategyDetails(vault.strategy.strategyId);
    const alignedKeys = Object.keys(alignedPositions);

    if (alignedKeys.length > maxPositions) {
      this.log(`Found ${alignedKeys.length} aligned positions, but strategy only allows ${maxPositions}`);

      // Sort by how close to perfectly centered (0.5) - ascending distance from center
      const sortedByCenter = alignedKeys.sort((a, b) => {
        const distA = Math.abs(alignedPositions[a]._centeredness - 0.5);
        const distB = Math.abs(alignedPositions[b]._centeredness - 0.5);
        return distA - distB;
      });

      // Keep top N, demote the rest
      const positionsToKeep = sortedByCenter.slice(0, maxPositions);
      const positionsToDemote = sortedByCenter.slice(maxPositions);

      this.log(`Keeping ${positionsToKeep.length} most centered positions, demoting ${positionsToDemote.length}`);

      // Move demoted positions to nonAligned
      for (const posId of positionsToDemote) {
        const pos = alignedPositions[posId];
        this.log(`Demoting position ${posId}: centeredness=${pos._centeredness.toFixed(4)} (excess beyond maxPositions)`);
        nonAlignedPositions[posId] = pos;
        delete alignedPositions[posId];
      }
    }

    // Emit evaluation event
    const alignedCount = Object.keys(alignedPositions).length;
    const nonAlignedCount = Object.keys(nonAlignedPositions).length;

    this.eventManager.emit('InitialPositionsEvaluated', {
      vaultAddress: address,
      alignedCount,
      nonAlignedCount,
      alignedPositionIds: Object.keys(alignedPositions),
      nonAlignedPositionIds: Object.keys(nonAlignedPositions),
      success: true,
      timestamp: Date.now(),
      log: {
        level: 'info',
        message: `Found ${alignedCount} aligned positions, ${nonAlignedCount} non-aligned positions`
      }
    });

    return { alignedPositions, nonAlignedPositions };
  }

  // ===========================================================================
  // Position Management
  // ===========================================================================

  /**
   * Close positions and collect fees
   *
   * Batch closes multiple positions, parses the receipt to extract principal
   * and fees, and emits events for tracking.
   *
   * @param {Object} vault - Vault data object
   * @param {Object} positions - Positions to close, keyed by position ID
   * @returns {Promise<{receipt: Object, feesByPosition: Object}>}
   *          Transaction receipt and parsed fees per position
   * @throws {Error} If pool metadata, adapter, or token data is missing
   */
  async closePositions(vault, positions) {
    const transactions = [];
    const positionMetadata = {};
    const expectedFeesByPosition = {};  // Store pre-calc results for native ETH fallback

    // Generate transaction data for each position to close
    for (const [positionId, position] of Object.entries(positions)) {
      // Get pool metadata from cache
      const poolMetadata = this.poolData[position.pool];
      if (!poolMetadata) {
        throw new UnrecoverableError(`Missing pool metadata for position ${positionId} pool ${position.pool}`);
      }

      // Get adapter for this platform
      const adapter = this.adapters.get(poolMetadata.platform);
      if (!adapter) {
        throw new UnrecoverableError(`No adapter for platform ${poolMetadata.platform}`);
      }

      // Get token data
      const token0Data = this.tokens[poolMetadata.token0Symbol];
      const token1Data = this.tokens[poolMetadata.token1Symbol];
      if (!token0Data || !token1Data) {
        throw new UnrecoverableError(`Missing token data for ${poolMetadata.token0Symbol}/${poolMetadata.token1Symbol}`);
      }

      // Check if position has native ETH (V4 native ETH transfers emit no events)
      const token0IsNative = token0Data.address === ethers.constants.AddressZero;
      const token1IsNative = token1Data.address === ethers.constants.AddressZero;
      const hasNativeToken = token0IsNative || token1IsNative;

      // Pre-calc fees for native ETH positions (required - parser returns null for native ETH)
      if (hasNativeToken) {
        try {
          const feesResult = await retryRpcCall(
            () => adapter.getAccruedFeesUSD(
              position,  // Pass full position object with fee growth fields
              { token0: 0, token1: 0 },  // prices not needed, we use raw fees0/fees1
              this.provider
            ),
            'getAccruedFeesUSD',
            { log: (msg) => this.log(msg) }
          );
          expectedFeesByPosition[positionId] = {
            fees0: feesResult.fees0,
            fees1: feesResult.fees1
          };
        } catch (error) {
          // Log warning but proceed - will emit FeeTrackingFailed later
          this.log(`⚠️ Pre-calc failed for position ${positionId}: ${error.message}`);
          expectedFeesByPosition[positionId] = null;  // Mark as failed
        }
      }

      this.log(`Adding position ${positionId} to close batch: ${poolMetadata.token0Symbol}/${poolMetadata.token1Symbol} on ${poolMetadata.platform}`);

      // Fetch fresh pool state (cached poolMetadata only has static metadata)
      const freshPoolState = await retryRpcCall(
        () => adapter.getPoolData(position.pool, this.provider),
        'getPoolData',
        { log: (msg) => this.log(msg) }
      );
      const poolData = {
        ...poolMetadata,
        ...freshPoolState
      };

      // Store metadata for event parsing (use fresh poolData, not cached poolMetadata)
      positionMetadata[positionId] = {
        position,
        poolData,  // Fresh pool data (includes sqrtPriceX96 for principal calc)
        token0Data,
        token1Data,
        adapter,
        hasNativeToken   // Track for fee fallback logic
      };

      // Generate close position transaction data (100% removal)
      const closeData = await retryRpcCall(
        () => adapter.generateRemoveLiquidityData({
          position,
          percentage: 100,
          provider: this.provider,
          walletAddress: vault.address,
          poolData,  // Use merged poolData with fresh state
          token0Data,
          token1Data,
          slippageTolerance: vault.strategy.parameters.maxSlippage,
          deadlineMinutes: getTransactionDeadlineMinutes(this.chainId)
        }),
        'generateRemoveLiquidityData',
        { log: (msg) => this.log(msg) }
      );

      transactions.push({
        to: closeData.to,
        data: closeData.data,
        value: closeData.value || 0
      });
    }

    // Execute batch transactions via vault's decreaseLiquidity function
    const txResult = await this.executeBatchTransactions(vault, transactions, 'position closes', 'subliq');

    // Remove closed positions from vault.positions
    for (const position of Object.values(positions)) {
      delete vault.positions[position.id];
    }

    // Group positionMetadata by adapter (platform) for receipt parsing
    const metadataByAdapter = new Map();
    for (const [positionId, metadata] of Object.entries(positionMetadata)) {
      const adapter = metadata.adapter;
      if (!metadataByAdapter.has(adapter)) {
        metadataByAdapter.set(adapter, {});
      }
      metadataByAdapter.get(adapter)[positionId] = metadata;
    }

    // Each adapter parses only its positions from the receipt
    const principalByPosition = {};
    const feesByPosition = {};
    const feeTrackingFailures = [];  // Track positions where fee tracking failed

    for (const [adapter, platformMetadata] of metadataByAdapter) {
      const result = await retryRpcCall(
        () => adapter.parseClosureReceipt(
          txResult.receipt,
          platformMetadata,
          { chainId: this.chainId, walletAddress: vault.address }
        ),
        'parseClosureReceipt',
        { log: (msg) => this.log(msg) }
      );
      Object.assign(principalByPosition, result.principalByPosition);

      // Process fees with fallback logic for native ETH positions
      for (const [positionId, feeData] of Object.entries(result.feesByPosition)) {
        const metadata = platformMetadata[positionId];

        if (metadata.hasNativeToken) {
          const expected = expectedFeesByPosition[positionId];

          if (expected) {
            // Pre-calc succeeded - fill in null values with pre-calculated fees
            feesByPosition[positionId] = {
              token0: feeData.token0 !== null
                ? feeData.token0
                : ethers.BigNumber.from(expected.fees0),
              token1: feeData.token1 !== null
                ? feeData.token1
                : ethers.BigNumber.from(expected.fees1),
              metadata: feeData.metadata
            };
          } else {
            // Pre-calc failed - substitute 0 for null, flag for FeeTrackingFailed event
            feesByPosition[positionId] = {
              token0: feeData.token0 !== null ? feeData.token0 : ethers.BigNumber.from(0),
              token1: feeData.token1 !== null ? feeData.token1 : ethers.BigNumber.from(0),
              metadata: feeData.metadata
            };

            // Track which token(s) couldn't be tracked for event emission
            feeTrackingFailures.push({
              positionId,
              token0Failed: feeData.token0 === null,
              token1Failed: feeData.token1 === null,
              token0Address: metadata.token0Data.address,
              token1Address: metadata.token1Data.address,
              token0Symbol: metadata.token0Data.symbol,
              token1Symbol: metadata.token1Data.symbol
            });
          }
        } else {
          // ERC20-only position - use parsed fees directly
          feesByPosition[positionId] = feeData;
        }
      }
    }

    // Emit FeeTrackingFailed event if any positions couldn't be tracked
    if (feeTrackingFailures.length > 0) {
      this.eventManager.emit('FeeTrackingFailed', {
        vaultAddress: vault.address,
        transactionHash: txResult.receipt.transactionHash,
        failures: feeTrackingFailures,
        reason: 'pre_calculation_failed_for_native_eth',
        timestamp: Date.now(),
        log: {
          level: 'warn',
          message: `Fee tracking failed for ${feeTrackingFailures.length} position(s) - fees remain in vault`
        }
      });
    }

    // Build detailed closure data for event
    const closedPositions = Object.entries(positions).map(([positionId, position]) => {
      const metadata = positionMetadata[positionId];
      const principal = principalByPosition[positionId] || { amount0: '0', amount1: '0' };

      return {
        positionId,
        position,
        platform: metadata.poolData.platform,
        principalAmount0: principal.amount0.toString(),
        principalAmount1: principal.amount1.toString()
      };
    });

    // Emit event for successful position closures
    this.eventManager.emit('PositionsClosed', {
      vaultAddress: vault.address,
      closedCount: closedPositions.length,
      closedPositions,
      gasUsed: txResult.receipt.gasUsed.toString(),
      gasEstimated: txResult.gasEstimated,
      effectiveGasPrice: txResult.receipt.effectiveGasPrice.toString(),
      transactionHash: txResult.receipt.transactionHash,
      success: true,
      timestamp: Date.now(),
      log: {
        level: 'info',
        message: `Successfully closed ${closedPositions.length} positions`
      }
    });

    // Return receipt and fees for caller (e.g., fee distribution)
    return {
      receipt: txResult.receipt,
      feesByPosition
    };
  }

  // ===========================================================================
  // Fee Distribution
  // ===========================================================================

  /**
   * Build and emit FeesCollected event
   *
   * Emits event with USD values and owner/reinvested breakdown for each token.
   * Used during initialization, rebalance, and explicit fee collection.
   *
   * @param {Object} vault - Vault object
   * @param {Object} aggregatedFees - Fees keyed by token address
   *   { [address]: { amount: BigNumber, symbol, decimals, address } }
   * @param {string} source - 'initialization' | 'rebalance' | 'explicit_collection'
   * @param {string[]} positionIds - Position IDs fees were collected from
   * @param {string} transactionHash - Transaction hash
   */
  async emitFeesCollected(vault, aggregatedFees, source, positionIds, transactionHash) {
    if (Object.keys(aggregatedFees).length === 0) {
      return;
    }

    // Get prices for USD calculation
    const prices = await fetchTokenPrices(
      Object.values(aggregatedFees).map(f => f.symbol),
      CACHE_DURATIONS['30-SECONDS']
    );

    const reinvestmentRatio = vault.strategy.parameters.reinvestmentRatio || 0;
    const ownerBasisPoints = ethers.BigNumber.from((100 - reinvestmentRatio) * 100);

    const fees = Object.values(aggregatedFees).map(f => {
      const amountFormatted = parseFloat(ethers.utils.formatUnits(f.amount, f.decimals));
      const ownerAmount = f.amount.mul(ownerBasisPoints).div(10000);
      const reinvestedAmount = f.amount.sub(ownerAmount);

      return {
        token: f.symbol,
        address: f.address,
        amount: f.amount.toString(),
        amountFormatted,
        decimals: f.decimals,
        usd: amountFormatted * (prices[f.symbol.toUpperCase()] || 0),
        toOwner: parseFloat(ethers.utils.formatUnits(ownerAmount, f.decimals)),
        reinvested: parseFloat(ethers.utils.formatUnits(reinvestedAmount, f.decimals))
      };
    });

    const totalUSD = fees.reduce((sum, f) => sum + f.usd, 0);

    this.eventManager.emit('FeesCollected', {
      vaultAddress: vault.address,
      source,
      positionIds,
      fees,
      totalUSD,
      reinvestmentRatio,
      transactionHash,
      timestamp: Date.now(),
      log: {
        level: 'info',
        message: `Collected $${totalUSD.toFixed(2)} in fees from ${positionIds.length} position(s)`
      }
    });
  }

  /**
   * Fill in null fee values with pre-calculated expected fees
   *
   * Used when receipt parsing cannot determine amounts (e.g., native ETH in V4).
   * V4 sends native ETH via assembly call() which emits no Transfer events,
   * so the parser returns null. This method fills those nulls with the
   * pre-calculated amounts from getAccruedFeesUSD.
   *
   * @param {Object} feesByPosition - Parsed fees from parseCollectReceipt (may contain nulls)
   *   { [positionId]: { token0: BigNumber|null, token1: BigNumber|null, metadata } }
   * @param {Object} expectedFeesByPosition - Pre-calculated fees from getAccruedFeesUSD
   *   { [positionId]: { fees0: string, fees1: string } }
   * @returns {Object} Complete feesByPosition with nulls replaced by expected values
   */
  _fillMissingFees(feesByPosition, expectedFeesByPosition) {
    const result = {};

    for (const [positionId, feeData] of Object.entries(feesByPosition)) {
      const expected = expectedFeesByPosition[positionId];

      result[positionId] = {
        token0: feeData.token0 !== null
          ? feeData.token0
          : ethers.BigNumber.from(expected.fees0),
        token1: feeData.token1 !== null
          ? feeData.token1
          : ethers.BigNumber.from(expected.fees1),
        metadata: feeData.metadata
      };
    }

    return result;
  }

  /**
   * Aggregate fees from feesByPosition into a token-address-keyed format
   *
   * Converts position-keyed fee data (from parseClosureReceipt) into
   * a token-address-keyed format suitable for distribution.
   *
   * @param {Object} feesByPosition - Fees keyed by position ID
   * @returns {Object} Aggregated fees keyed by token address (lowercase)
   *   { [tokenAddress]: { amount: BigNumber, symbol, decimals, address } }
   */
  aggregateFeesFromPositions(feesByPosition) {
    const aggregatedFees = {};

    for (const [_positionId, feeData] of Object.entries(feesByPosition)) {
      const { token0, token1, metadata } = feeData;
      const { token0Data, token1Data } = metadata;

      // Add token0 fees
      if (token0.gt(0)) {
        const addr = token0Data.address.toLowerCase();
        if (!aggregatedFees[addr]) {
          aggregatedFees[addr] = {
            amount: ethers.BigNumber.from(0),
            symbol: token0Data.symbol,
            decimals: token0Data.decimals,
            address: token0Data.address
          };
        }
        aggregatedFees[addr].amount = aggregatedFees[addr].amount.add(token0);
      }

      // Add token1 fees
      if (token1.gt(0)) {
        const addr = token1Data.address.toLowerCase();
        if (!aggregatedFees[addr]) {
          aggregatedFees[addr] = {
            amount: ethers.BigNumber.from(0),
            symbol: token1Data.symbol,
            decimals: token1Data.decimals,
            address: token1Data.address
          };
        }
        aggregatedFees[addr].amount = aggregatedFees[addr].amount.add(token1);
      }
    }

    return aggregatedFees;
  }

  /**
   * Distribute collected fees to vault owner based on reinvestment ratio
   *
   * Takes aggregated fees (keyed by token address), calculates the owner's
   * portion based on reinvestmentRatio, and transfers to owner.
   * Wrapped native tokens (WETH/WAVAX) are unwrapped to native before transfer.
   *
   * Individual token withdrawals are wrapped in try/catch - failures for one
   * token won't prevent distribution of other tokens.
   *
   * @param {Object} vault - Vault data object
   * @param {Object} aggregatedFees - Fees keyed by token address (lowercase)
   *   { [tokenAddress]: { amount: BigNumber, symbol, decimals, address } }
   * @returns {Promise<Object>} Distribution results
   *   { distributions: Array, failures: Array, reinvestmentRatio, totalDistributed, totalFailed }
   */
  async distributeFees(vault, aggregatedFees) {
    // Skip if no fees to distribute
    if (Object.keys(aggregatedFees).length === 0) {
      return { distributions: [], failures: [], reinvestmentRatio: 0, totalDistributed: 0, totalFailed: 0 };
    }

    // Skip if 100% reinvestment (owner gets nothing)
    const reinvestmentRatio = vault.strategy.parameters.reinvestmentRatio;
    if (reinvestmentRatio >= 100) {
      this.log('Reinvestment ratio is 100%, skipping fee distribution to owner');
      return { distributions: [], failures: [], reinvestmentRatio, totalDistributed: 0, totalFailed: 0 };
    }

    // Calculate owner portion using basis points for precision
    const ownerBasisPoints = ethers.BigNumber.from((100 - reinvestmentRatio) * 100);

    const ownerAmounts = {};
    for (const [addr, tokenData] of Object.entries(aggregatedFees)) {
      const ownerAmount = tokenData.amount.mul(ownerBasisPoints).div(10000);
      if (ownerAmount.gt(0)) {
        ownerAmounts[addr] = { ...tokenData, amount: ownerAmount };
      }
    }

    // Skip if all owner amounts rounded to zero
    if (Object.keys(ownerAmounts).length === 0) {
      this.log('All fee amounts rounded to zero after reinvestment calculation');
      return { distributions: [], failures: [], reinvestmentRatio, totalDistributed: 0, totalFailed: 0 };
    }

    // Execute withdrawals
    const wrappedNativeAddress = getWrappedNativeAddress(this.chainId);
    const vaultContract = getVaultContract(vault.address, this.provider);
    const signer = this.getVaultSigner(vault);
    const vaultWithSigner = vaultContract.connect(signer);

    const distributions = [];
    const failures = [];

    for (const [addr, tokenData] of Object.entries(ownerAmounts)) {
      const isWrappedNative = addr.toLowerCase() === wrappedNativeAddress.toLowerCase();
      const isNativeToken = tokenData.address === ethers.constants.AddressZero;

      try {
        const receipt = await retryRpcCall(async () => {
          let tx;
          if (isWrappedNative) {
            // V3: Wrapped native (WETH/WAVAX) needs unwrapping
            tx = await vaultWithSigner.unwrapAndWithdrawETH(wrappedNativeAddress, tokenData.amount);
          } else if (isNativeToken) {
            // V4: Native token is already unwrapped, use withdrawETH
            tx = await vaultWithSigner.withdrawETH(tokenData.amount);
          } else {
            // ERC20 tokens
            tx = await vaultWithSigner.withdrawTokens(tokenData.address, tokenData.amount);
          }
          return tx.wait();
        }, 'fee distribution', { log: (msg) => this.log(msg) });

        distributions.push({
          token: tokenData.symbol,
          address: tokenData.address,
          amount: tokenData.amount.toString(),
          amountFormatted: ethers.utils.formatUnits(tokenData.amount, tokenData.decimals),
          asNativeToken: isWrappedNative,
          transactionHash: receipt.transactionHash
        });

        this.log(`Distributed ${ethers.utils.formatUnits(tokenData.amount, tokenData.decimals)} ${tokenData.symbol} to owner`);
      } catch (error) {
        // Log failure but continue with other tokens
        this.log(`⚠️ Failed to distribute ${tokenData.symbol} fees: ${error.message}`);
        failures.push({
          token: tokenData.symbol,
          address: tokenData.address,
          amount: tokenData.amount.toString(),
          amountFormatted: ethers.utils.formatUnits(tokenData.amount, tokenData.decimals),
          error: error.message
        });
      }
    }

    // Emit event (only if at least one distribution succeeded or failed)
    if (distributions.length > 0 || failures.length > 0) {
      // Calculate total USD distributed
      let totalDistributedUSD = 0;
      if (distributions.length > 0) {
        try {
          const tokenSymbols = distributions.map(d => d.token);
          const prices = await retryRpcCall(
            () => fetchTokenPrices(tokenSymbols, CACHE_DURATIONS['30-SECONDS']),
            'fetch prices for distributed fees',
            { log: (msg) => this.log(msg) }
          );
          for (const dist of distributions) {
            const price = prices[dist.token.toUpperCase()] || 0;
            totalDistributedUSD += parseFloat(dist.amountFormatted) * price;
          }
        } catch (priceError) {
          this.log(`🔴 Could not fetch prices for distributed fees: ${priceError.message}`);
        }
      }

      this.eventManager.emit('FeesDistributed', {
        vaultAddress: vault.address,
        owner: vault.owner,
        reinvestmentRatio,
        distributions,
        failures,
        totalTokensDistributed: distributions.length,
        totalTokensFailed: failures.length,
        totalDistributedUSD,
        timestamp: Date.now(),
        log: {
          level: failures.length > 0 ? 'warn' : 'info',
          message: failures.length > 0
            ? `Distributed fees for ${distributions.length} token(s) to owner, ${failures.length} failed`
            : `Distributed fees for ${distributions.length} token(s) to owner`
        }
      });
    }

    return {
      distributions,
      failures,
      reinvestmentRatio,
      totalDistributed: distributions.length,
      totalFailed: failures.length
    };
  }

  // ===========================================================================
  // Deployment Calculation
  // ===========================================================================

  /**
   * Calculate available capital for deployment
   *
   * Deploys all undeployed tokens (tokenValue) unless below minimum thresholds.
   *
   * Applies two minimum thresholds:
   * 1. Chain minimum - don't waste gas on tiny deployments
   * 2. Vault-relative minimum (1%) - don't deploy dust relative to vault size
   *
   * Uses max(chainMin, vaultValue * 1%) to ensure both constraints are met.
   *
   * @param {Object} vault - Vault object
   * @returns {Promise<Object>} { availableDeployment: number, assetValues: Object }
   */
  async calculateAvailableDeployment(vault) {
    const assetValues = await this.vaultDataService.fetchAssetValues(vault);
    const totalValue = assetValues.totalVaultValue;
    const positionValue = assetValues.totalPositionValue;
    const tokenValue = assetValues.totalTokenValue;
    const currentUtilization = totalValue > 0 ? positionValue / totalValue : 0;

    // Minimum deployment thresholds:
    // - Chain minimum: don't waste gas on tiny deployments
    // - Vault-relative (1%): don't deploy dust relative to vault size
    const chainMinimum = getMinDeploymentForGas(this.chainId);
    const vaultRelativeMinimum = totalValue * 0.01; // 1% of vault value
    const minDeployment = Math.max(chainMinimum, vaultRelativeMinimum);

    // Subtract holdback for executor gas funding (VaultHealth Phase 6)
    const holdbackAmount = this.vaultHealth.getHoldbackAmount(vault.address);
    const deployableValue = tokenValue - holdbackAmount;

    // Deploy available tokens (minus holdback) if above minimum threshold
    const availableDeployment = deployableValue > minDeployment ? deployableValue : 0;

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

    return { availableDeployment, assetValues };
  }

  // ===========================================================================
  // Capital Deployment
  // ===========================================================================

  /**
   * Add liquidity to an existing aligned position
   *
   * @param {Object} vault - Vault object
   * @param {Object} position - The aligned position to add to
   * @param {Object} assetValues - Asset values from fetchAssetValues
   * @param {number} availableDeployment - USD amount available to deploy
   * @param {Object} targetPool - The target pool for this vault
   * @returns {Promise<void>}
   */
  async addToPosition(vault, position, assetValues, availableDeployment, targetPool) {
    this.log(`Adding to position ${position.id} with $${availableDeployment.toFixed(2)} available`);

    // Step 1: Validate availableDeployment
    if (availableDeployment <= 0) {
      this.log('No deployment available, skipping addToPosition');
      return;
    }

    // Step 2: Get token data from targetPool
    const token0Data = targetPool.token0;
    const token1Data = targetPool.token1;

    // Step 3: Get adapter and ensure token approvals early
    const platformId = vault.targetPlatforms[0];
    const adapter = this.adapters.get(platformId);
    if (!adapter) {
      throw new UnrecoverableError(`No adapter for platform ${platformId}`);
    }

    // Step 3a: Ensure token approvals for position manager (do early while calculating)
    const approvalTxs = await adapter.getRequiredApprovals(
      'liquidity',
      vault.address,
      [token0Data.address, token1Data.address],
      this.provider
    );
    if (approvalTxs.length > 0) {
      await this.executeBatchTransactions(vault, approvalTxs, 'token approvals', 'approval');
    }

    // Step 4: Calculate target amounts from position ratio and total vault value
    const positionValues = assetValues.positions[position.id];
    if (!positionValues) {
      throw new UnrecoverableError(`Position ${position.id} not found in assetValues`);
    }

    const token0Price = positionValues.token0Price;
    const token1Price = positionValues.token1Price;

    // Validate prices exist
    if (!token0Price || !token1Price || !Number.isFinite(token0Price) || !Number.isFinite(token1Price)) {
      throw new UnrecoverableError(
        `Missing or invalid prices for position ${position.id}: ` +
        `${token0Data.symbol}=${token0Price}, ${token1Data.symbol}=${token1Price}`
      );
    }

    // Calculate current position VALUE ratio (not token amount ratio)
    const token0ValueUSD = positionValues.token0UsdValue;
    const token1ValueUSD = positionValues.token1UsdValue;
    const positionValueRatio = token0ValueUSD / token1ValueUSD;

    this.log(`Position value ratio: ${positionValueRatio.toFixed(4)} (${(positionValueRatio / (1 + positionValueRatio) * 100).toFixed(1)}% ${token0Data.symbol} : ${(1 / (1 + positionValueRatio) * 100).toFixed(1)}% ${token1Data.symbol})`);

    // Calculate target amounts based on ratio and AVAILABLE DEPLOYMENT (not total vault value)
    // The available deployment is what we're adding to the position, not the entire vault
    const targetToken0ValueUSD = availableDeployment * (positionValueRatio / (1 + positionValueRatio));
    const targetToken1ValueUSD = availableDeployment - targetToken0ValueUSD;

    // Convert to token amounts
    const targetToken0Amount = ethers.utils.parseUnits(
      (targetToken0ValueUSD / token0Price).toFixed(token0Data.decimals),
      token0Data.decimals
    );
    const targetToken1Amount = ethers.utils.parseUnits(
      (targetToken1ValueUSD / token1Price).toFixed(token1Data.decimals),
      token1Data.decimals
    );

    this.log(`Target amounts: ${ethers.utils.formatUnits(targetToken0Amount, token0Data.decimals)} ${token0Data.symbol} ($${targetToken0ValueUSD.toFixed(2)}), ${ethers.utils.formatUnits(targetToken1Amount, token1Data.decimals)} ${token1Data.symbol} ($${targetToken1ValueUSD.toFixed(2)})`);
    this.log(`Available deployment: $${availableDeployment.toFixed(2)}`);

    // Step 5: Prepare tokens (swap/wrap if needed to cover deficits)
    const { deficitSwaps, wrapUnwrap, metadata } = await this.prepareTokensForPosition(
      vault,
      { token0Amount: targetToken0Amount.toString(), token1Amount: targetToken1Amount.toString() },
      token0Data,
      token1Data
    );

    // Execute wrap/unwrap FIRST (swaps may depend on wrapped tokens)
    const nativeSymbol = getNativeSymbol(this.chainId);
    const wrappedNativeSymbol = getWrappedNativeSymbol(this.chainId);
    if (BigInt(wrapUnwrap.wrapAmount) > 0n) {
      this.log(`Wrapping ${ethers.utils.formatEther(wrapUnwrap.wrapAmount)} ${nativeSymbol} to ${wrappedNativeSymbol}`);
      await retryRpcCall(
        () => this.executeWrap(vault, wrapUnwrap.wrapAmount),
        `wrap native for vault ${vault.address}`
      );
    }
    if (BigInt(wrapUnwrap.unwrapAmount) > 0n) {
      this.log(`Unwrapping ${ethers.utils.formatEther(wrapUnwrap.unwrapAmount)} ${wrappedNativeSymbol} to ${nativeSymbol}`);
      await retryRpcCall(
        () => this.executeUnwrap(vault, wrapUnwrap.unwrapAmount),
        `unwrap native for vault ${vault.address}`
      );
    }

    // Step 6: Execute deficit swaps (with retry on failure)
    let currentDeficitSwaps = deficitSwaps;
    let currentDeficitMetadata = metadata.deficit;
    const maxRetries = 1;
    let retryCount = 0;

    while (currentDeficitSwaps.length > 0) {
      try {
        this.log(`Executing ${currentDeficitSwaps.length} deficit swaps${retryCount > 0 ? ` [retry ${retryCount}]` : ''}`);
        const { receipt, gasEstimated } = await this.executeBatchTransactions(vault, currentDeficitSwaps, 'deficit swaps', 'swap');

        // Extract actual amounts from receipt and emit TokensSwapped event
        const actualSwaps = adapter.parseSwapReceipt(receipt, currentDeficitMetadata);
        const swapDetails = this.buildSwapDetails(currentDeficitMetadata, actualSwaps);
        this.eventManager.emit('TokensSwapped', {
          vaultAddress: vault.address,
          swapCount: swapDetails.length,
          swapType: 'deficit_coverage',
          swaps: swapDetails,
          gasUsed: receipt.gasUsed.toString(),
          gasEstimated: gasEstimated,
          effectiveGasPrice: receipt.effectiveGasPrice.toString(),
          transactionHash: receipt.transactionHash,
          success: receipt.status === 1,
          timestamp: Date.now()
        });

        break; // Success - exit retry loop
      } catch (error) {
        retryCount++;
        if (retryCount > maxRetries) {
          throw new UnrecoverableError(`Deficit swaps failed after ${maxRetries} retry(s): ${error.message}`);
        }

        this.log(`⚠️ Deficit swaps failed, attempting retry ${retryCount}/${maxRetries}...`);
        this.log(`   Failure reason: ${error.message}`);

        // Refresh token balances to get current on-chain state
        vault.tokens = await this.vaultDataService.fetchTokenBalances(
          vault.address,
          Object.keys(this.tokens)
        );

        // Regenerate swap transactions with fresh quotes and Permit2 nonces
        const freshResult = await this.prepareTokensForPosition(
          vault,
          { token0Amount: targetToken0Amount.toString(), token1Amount: targetToken1Amount.toString() },
          token0Data,
          token1Data
        );

        // Note: wrap/unwrap already executed, so freshResult.wrapUnwrap should be 0
        // But check just in case balances changed unexpectedly
        if (BigInt(freshResult.wrapUnwrap.wrapAmount) > 0n) {
          this.log(`Wrapping additional ${ethers.utils.formatEther(freshResult.wrapUnwrap.wrapAmount)} ${nativeSymbol} to ${wrappedNativeSymbol}`);
          await retryRpcCall(
            () => this.executeWrap(vault, freshResult.wrapUnwrap.wrapAmount),
            `wrap native (additional) for vault ${vault.address}`
          );
        }
        if (BigInt(freshResult.wrapUnwrap.unwrapAmount) > 0n) {
          this.log(`Unwrapping additional ${ethers.utils.formatEther(freshResult.wrapUnwrap.unwrapAmount)} ${wrappedNativeSymbol} to ${nativeSymbol}`);
          await retryRpcCall(
            () => this.executeUnwrap(vault, freshResult.wrapUnwrap.unwrapAmount),
            `unwrap native (additional) for vault ${vault.address}`
          );
        }

        // Update swaps and metadata for next iteration
        currentDeficitSwaps = freshResult.deficitSwaps;
        currentDeficitMetadata = freshResult.metadata.deficit;

        // If no deficit swaps needed after refresh, we're done
        if (currentDeficitSwaps.length === 0) {
          this.log('No deficit swaps needed after balance refresh');
          break;
        }
      }
    }

    // Step 7: Refresh token balances after swaps are completed
    vault.tokens = await this.vaultDataService.fetchTokenBalances(
      vault.address,
      Object.keys(this.tokens)
    );

    // Step 8: Re-fetch pool data at current price (swaps may have moved it)
    // Merge fresh state with original targetPool to preserve poolKey
    const freshPoolState = await retryRpcCall(
      () => adapter.getPoolData(targetPool.address, this.provider),
      'getPoolData (post-swap refresh)'
    );
    const freshPoolData = {
      ...targetPool,
      ...freshPoolState
    };

    // Step 9: Get final token balances and apply holdback deduction
    let finalToken0Balance = BigInt(vault.tokens[token0Data.symbol]);
    let finalToken1Balance = BigInt(vault.tokens[token1Data.symbol]);

    ({ token0Balance: finalToken0Balance, token1Balance: finalToken1Balance } =
      this.applyHoldbackDeduction(vault, token0Data, token1Data, finalToken0Balance, finalToken1Balance, token0Price, token1Price));

    const maxSlippage = vault.strategy.parameters.maxSlippage;

    this.log(`🔄 Token balances for position: ${token0Data.symbol}=${ethers.utils.formatUnits(finalToken0Balance, token0Data.decimals)}, ${token1Data.symbol}=${ethers.utils.formatUnits(finalToken1Balance, token1Data.decimals)}`);

    // Step 10: Execute increaseLiquidity transaction
    // 10a. Generate add liquidity transaction data
    // Pass holdback-deducted balances - adapter applies slippage internally
    const addLiquidityData = await retryRpcCall(
      () => adapter.generateAddLiquidityData({
        position,
        token0Amount: finalToken0Balance.toString(),
        token1Amount: finalToken1Balance.toString(),
        provider: this.provider,
        poolData: freshPoolData,
        token0Data,
        token1Data,
        slippageTolerance: maxSlippage,
        deadlineMinutes: getTransactionDeadlineMinutes(this.chainId)
      }),
      'generateAddLiquidityData'
    );

    // 10b. Execute add liquidity transaction
    this.log(`Executing increaseLiquidity for position ${position.id}`);
    const { receipt, gasEstimated } = await this.executeBatchTransactions(
      vault,
      [addLiquidityData],
      'add liquidity',
      'addliq'
    );

    // 10c. Parse receipt for actual amounts consumed
    const receiptData = adapter.parseIncreaseLiquidityReceipt(receipt, {
      position,
      poolData: freshPoolData
    });

    this.log(`✅ Liquidity added: ${ethers.utils.formatUnits(receiptData.amount0, token0Data.decimals)} ${token0Data.symbol}, ${ethers.utils.formatUnits(receiptData.amount1, token1Data.decimals)} ${token1Data.symbol} (liquidity: ${receiptData.liquidity})`);

    // Step 11: Emit LiquidityAddedToPosition event
    this.eventManager.emit('LiquidityAddedToPosition', {
      // Identity
      vaultAddress: vault.address,
      positionId: position.id,
      poolAddress: position.pool,

      // Amounts (target vs actual for tracking)
      targetToken0: targetToken0Amount.toString(),
      targetToken1: targetToken1Amount.toString(),
      actualToken0: receiptData.amount0,
      actualToken1: receiptData.amount1,

      // Position (full object - use adapter methods to extract bounds)
      position,

      // Pool state at time of add (platform-agnostic via adapter)
      current: adapter.getPoolCurrent(freshPoolData),

      // Transaction
      transactionHash: receipt.transactionHash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString(),
      gasEstimated,
      effectiveGasPrice: receipt.effectiveGasPrice.toString(),

      // Context
      tokenSymbols: [token0Data.symbol, token1Data.symbol],
      platform: platformId,
      deploymentAmount: availableDeployment,
      timestamp: Date.now()
    });

    // Step 11: Update cache with modified position (direct on-chain, no Graph latency)
    const { position: updatedPosition, poolData: updatedPoolData } = await retryRpcCall(
      () => adapter.getPositionById(position.id, this.provider),
      'getPositionById'
    );
    await this.vaultDataService.updatePosition(vault.address, updatedPosition, updatedPoolData);
    // COMMENTED OUT: VaultHealth now refreshes tokens at the top of attemptTopUp.
    // Strategy mid-flow refreshes (initializeVault:193, rebalancePosition:765, handleSwapEvent:363)
    // handle strategy's own freshness needs. This end-of-function refresh was only for VaultHealth.
    // await this.vaultDataService.refreshTokens(vault.address);
  }

  /**
   * Create a new position when no aligned position exists
   *
   * @param {Object} vault - Vault object
   * @param {number} availableDeployment - USD amount available to deploy
   * @param {Object} assetValues - Asset values from fetchAssetValues
   * @param {Object} targetPool - The target pool for this vault
   * @returns {Promise<void>}
   */
  async createNewPosition(vault, availableDeployment, assetValues, targetPool) {
    this.log(`Creating new position with $${availableDeployment.toFixed(2)} available`);

    // Step 1: Validate availableDeployment
    if (availableDeployment <= 0) {
      this.log('No deployment available, skipping createNewPosition');
      return;
    }

    // Step 2: Get token data from targetPool
    const token0Data = targetPool.token0;
    const token1Data = targetPool.token1;

    // Step 3: Get adapter and calculate position range
    const platformId = vault.targetPlatforms[0];
    const adapter = this.adapters.get(platformId);
    if (!adapter) {
      throw new UnrecoverableError(`No adapter for platform ${platformId}`);
    }

    // Step 3a: Ensure token approvals for position manager (do early while calculating quotes)
    const approvalTxs = await adapter.getRequiredApprovals(
      'liquidity',
      vault.address,
      [token0Data.address, token1Data.address],
      this.provider
    );
    if (approvalTxs.length > 0) {
      await this.executeBatchTransactions(vault, approvalTxs, 'token approvals', 'approval');
    }

    // Get position range object (platform-specific properties, e.g., tickLower/tickUpper for V3)
    let position = adapter.getPositionRange(
      targetPool,
      vault.strategy.parameters.targetRangeUpper,
      vault.strategy.parameters.targetRangeLower
    );

    // Step 4: Get token prices and determine optimal ratio via test quote
    // Always fetch prices for target tokens (cache handles efficiency)
    const prices = await fetchTokenPrices(
      [token0Data.symbol, token1Data.symbol],
      CACHE_DURATIONS['30-SECONDS']
    );
    const token0Price = prices[token0Data.symbol.toUpperCase()];
    const token1Price = prices[token1Data.symbol.toUpperCase()];

    if (!token0Price || !token1Price) {
      throw new Error(`Unable to fetch prices for ${token0Data.symbol} and/or ${token1Data.symbol}`);
    }

    // Get optimal token value ratio from the adapter (platform-specific calculation)
    const { token0Share, token1Share } = await retryRpcCall(
      () => adapter.getOptimalTokenRatio({
        position,
        poolData: targetPool,
        token0Data,
        token1Data,
        token0Price,
        token1Price,
        provider: this.provider
      }),
      'getOptimalTokenRatio'
    );

    this.log(`Token prices: ${token0Data.symbol}=$${token0Price.toFixed(2)}, ${token1Data.symbol}=$${token1Price.toFixed(2)}`);
    this.log(`Optimal value ratio: ${(token0Share * 100).toFixed(1)}% ${token0Data.symbol} : ${(token1Share * 100).toFixed(1)}% ${token1Data.symbol}`);

    // Step 5: Calculate target amounts based on ratio and total vault value
    // Use totalVaultValue (includes non-aligned tokens that will be swapped)
    // Holdback deduction happens later at the mint boundary (Step 10)
    const totalValue = assetValues.totalVaultValue;
    const targetToken0ValueUSD = totalValue * token0Share;
    const targetToken1ValueUSD = totalValue * token1Share;

    // Convert to token amounts
    const targetToken0Amount = ethers.utils.parseUnits(
      (targetToken0ValueUSD / token0Price).toFixed(token0Data.decimals),
      token0Data.decimals
    );
    const targetToken1Amount = ethers.utils.parseUnits(
      (targetToken1ValueUSD / token1Price).toFixed(token1Data.decimals),
      token1Data.decimals
    );

    this.log(`Target amounts: ${ethers.utils.formatUnits(targetToken0Amount, token0Data.decimals)} ${token0Data.symbol} ($${targetToken0ValueUSD.toFixed(2)}), ${ethers.utils.formatUnits(targetToken1Amount, token1Data.decimals)} ${token1Data.symbol} ($${targetToken1ValueUSD.toFixed(2)})`);
    this.log(`Total vault value: $${totalValue.toFixed(2)}`);

    // Step 6: Prepare tokens (swap/wrap if needed to cover deficits)
    const { deficitSwaps, wrapUnwrap, metadata } = await this.prepareTokensForPosition(
      vault,
      { token0Amount: targetToken0Amount.toString(), token1Amount: targetToken1Amount.toString() },
      token0Data,
      token1Data
    );

    // Execute wrap/unwrap FIRST (swaps may depend on wrapped tokens)
    const nativeSymbol = getNativeSymbol(this.chainId);
    const wrappedNativeSymbol = getWrappedNativeSymbol(this.chainId);
    if (BigInt(wrapUnwrap.wrapAmount) > 0n) {
      this.log(`Wrapping ${ethers.utils.formatEther(wrapUnwrap.wrapAmount)} ${nativeSymbol} to ${wrappedNativeSymbol}`);
      await retryRpcCall(
        () => this.executeWrap(vault, wrapUnwrap.wrapAmount),
        `wrap native for vault ${vault.address}`
      );
    }
    if (BigInt(wrapUnwrap.unwrapAmount) > 0n) {
      this.log(`Unwrapping ${ethers.utils.formatEther(wrapUnwrap.unwrapAmount)} ${wrappedNativeSymbol} to ${nativeSymbol}`);
      await retryRpcCall(
        () => this.executeUnwrap(vault, wrapUnwrap.unwrapAmount),
        `unwrap native for vault ${vault.address}`
      );
    }

    // Step 7: Execute deficit swaps (with retry on failure)
    let currentDeficitSwaps = deficitSwaps;
    let currentDeficitMetadata = metadata.deficit;
    const maxRetries = 1;
    let retryCount = 0;

    while (currentDeficitSwaps.length > 0) {
      try {
        this.log(`Executing ${currentDeficitSwaps.length} deficit swaps${retryCount > 0 ? ` [retry ${retryCount}]` : ''}`);
        const { receipt, gasEstimated } = await this.executeBatchTransactions(vault, currentDeficitSwaps, 'deficit swaps', 'swap');

        // Extract actual amounts from receipt and emit TokensSwapped event
        const actualSwaps = adapter.parseSwapReceipt(receipt, currentDeficitMetadata);
        const swapDetails = this.buildSwapDetails(currentDeficitMetadata, actualSwaps);
        this.eventManager.emit('TokensSwapped', {
          vaultAddress: vault.address,
          swapCount: swapDetails.length,
          swapType: 'deficit_coverage',
          swaps: swapDetails,
          gasUsed: receipt.gasUsed.toString(),
          gasEstimated: gasEstimated,
          effectiveGasPrice: receipt.effectiveGasPrice.toString(),
          transactionHash: receipt.transactionHash,
          success: receipt.status === 1,
          timestamp: Date.now()
        });

        break; // Success - exit retry loop
      } catch (error) {
        retryCount++;
        if (retryCount > maxRetries) {
          throw new UnrecoverableError(`Deficit swaps failed after ${maxRetries} retry(s): ${error.message}`);
        }

        this.log(`⚠️ Deficit swaps failed, attempting retry ${retryCount}/${maxRetries}...`);
        this.log(`   Failure reason: ${error.message}`);

        // Refresh token balances to get current on-chain state
        vault.tokens = await this.vaultDataService.fetchTokenBalances(
          vault.address,
          Object.keys(this.tokens)
        );

        // Regenerate swap transactions with fresh quotes and Permit2 nonces
        const freshResult = await this.prepareTokensForPosition(
          vault,
          { token0Amount: targetToken0Amount.toString(), token1Amount: targetToken1Amount.toString() },
          token0Data,
          token1Data
        );

        // Note: wrap/unwrap already executed, so freshResult.wrapUnwrap should be 0
        // But check just in case balances changed unexpectedly
        if (BigInt(freshResult.wrapUnwrap.wrapAmount) > 0n) {
          this.log(`Wrapping additional ${ethers.utils.formatEther(freshResult.wrapUnwrap.wrapAmount)} ${nativeSymbol} to ${wrappedNativeSymbol}`);
          await retryRpcCall(
            () => this.executeWrap(vault, freshResult.wrapUnwrap.wrapAmount),
            `wrap native (additional) for vault ${vault.address}`
          );
        }
        if (BigInt(freshResult.wrapUnwrap.unwrapAmount) > 0n) {
          this.log(`Unwrapping additional ${ethers.utils.formatEther(freshResult.wrapUnwrap.unwrapAmount)} ${wrappedNativeSymbol} to ${nativeSymbol}`);
          await retryRpcCall(
            () => this.executeUnwrap(vault, freshResult.wrapUnwrap.unwrapAmount),
            `unwrap native (additional) for vault ${vault.address}`
          );
        }

        // Update swaps and metadata for next iteration
        currentDeficitSwaps = freshResult.deficitSwaps;
        currentDeficitMetadata = freshResult.metadata.deficit;

        // If no deficit swaps needed after refresh, we're done
        if (currentDeficitSwaps.length === 0) {
          this.log('No deficit swaps needed after balance refresh');
          break;
        }
      }
    }

    // Step 8: Refresh token balances after swaps are completed
    vault.tokens = await this.vaultDataService.fetchTokenBalances(
      vault.address,
      Object.keys(this.tokens)
    );

    // Step 9: Re-fetch pool data at current price (swaps may have moved it)
    // Merge fresh state with original targetPool to preserve poolKey
    const freshPoolState = await retryRpcCall(
      () => adapter.getPoolData(targetPool.address, this.provider),
      'getPoolData (post-swap refresh)'
    );
    const freshPoolData = {
      ...targetPool,
      ...freshPoolState
    };
    // Step 9a: Recalculate position range centered on current tick
    // Deficit swaps may have moved the price, so we need to recenter the range
    // on the actual current tick to ensure position is properly centered
    position = adapter.getPositionRange(
      freshPoolData,
      vault.strategy.parameters.targetRangeUpper,
      vault.strategy.parameters.targetRangeLower
    );

    // Step 10: Get final token balances and apply holdback deduction
    let finalToken0Balance = BigInt(vault.tokens[token0Data.symbol]);
    let finalToken1Balance = BigInt(vault.tokens[token1Data.symbol]);

    ({ token0Balance: finalToken0Balance, token1Balance: finalToken1Balance } =
      this.applyHoldbackDeduction(vault, token0Data, token1Data, finalToken0Balance, finalToken1Balance, token0Price, token1Price));

    const maxSlippage = vault.strategy.parameters.maxSlippage;

    this.log(`Token balances for position: ${token0Data.symbol}=${ethers.utils.formatUnits(finalToken0Balance, token0Data.decimals)}, ${token1Data.symbol}=${ethers.utils.formatUnits(finalToken1Balance, token1Data.decimals)}`);

    // Step 11: Execute mint transaction
    // 11a. Generate CREATE position data with fresh pool data
    // Pass holdback-deducted balances - adapter applies slippage internally
    const createPositionData = await retryRpcCall(
      () => adapter.generateCreatePositionData({
        position,
        token0Amount: finalToken0Balance.toString(),
        token1Amount: finalToken1Balance.toString(),
        provider: this.provider,
        walletAddress: vault.address,
        poolData: freshPoolData,
        token0Data,
        token1Data,
        slippageTolerance: maxSlippage,
        deadlineMinutes: getTransactionDeadlineMinutes(this.chainId)
      }),
      'generateCreatePositionData'
    );

    this.log(`Position data generated, target: ${createPositionData.to}, value: ${createPositionData.value}`);
    this.log(`Position quote: ${JSON.stringify(createPositionData.quote)}`);

    // 11b. Execute MINT transaction (different from 'addliq')
    this.log(`Executing mint for new ${token0Data.symbol}/${token1Data.symbol} position`);
    const { receipt, gasEstimated } = await this.executeBatchTransactions(
      vault,
      [createPositionData],
      'create position',
      'mint'
    );

    // 11c. Parse receipt for actual amounts consumed and new position ID
    const receiptData = adapter.parseIncreaseLiquidityReceipt(receipt, {
      position,
      poolData: freshPoolData
    });

    this.log(`✅ Position created: ID ${receiptData.tokenId}, ${ethers.utils.formatUnits(receiptData.amount0, token0Data.decimals)} ${token0Data.symbol}, ${ethers.utils.formatUnits(receiptData.amount1, token1Data.decimals)} ${token1Data.symbol} (liquidity: ${receiptData.liquidity})`);

    // Step 12: Emit NewPositionCreated event
    this.eventManager.emit('NewPositionCreated', {
      // Identity
      vaultAddress: vault.address,
      positionId: receiptData.tokenId,
      poolAddress: targetPool.address,

      // Amounts (target vs actual for tracking)
      targetToken0: targetToken0Amount.toString(),
      targetToken1: targetToken1Amount.toString(),
      actualToken0: receiptData.amount0,
      actualToken1: receiptData.amount1,

      // Position range (full position object - use adapter methods to extract bounds)
      position,

      // Pool state at time of creation (platform-agnostic via adapter)
      current: adapter.getPoolCurrent(targetPool),

      // Transaction
      transactionHash: receipt.transactionHash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString(),
      gasEstimated,
      effectiveGasPrice: receipt.effectiveGasPrice.toString(),

      // Context
      tokenSymbols: [token0Data.symbol, token1Data.symbol],
      platform: platformId,
      deploymentAmount: availableDeployment,
      timestamp: Date.now()
    });

    // Step 13: Update cache with new position (direct on-chain, no Graph latency)
    const { position: newPosition, poolData: newPoolData } = await retryRpcCall(
      () => adapter.getPositionById(receiptData.tokenId, this.provider),
      'getPositionById'
    );
    // Step 14: Set emergency exit baseline from fresh pool data (after swaps)
    // This overwrites any previous baseline (e.g., from aligned position at init, or previous position before rebalance)
    // Note: Use freshPoolData (has tick), not newPoolData (only has metadata from getPositionById)
    const currentPool = adapter.getPoolCurrent(freshPoolData);
    this.emergencyExitBaseline[vault.address] = currentPool;
    this.log(`Set emergency exit baseline ${JSON.stringify(currentPool)} for vault ${vault.address} (new position)`);
    await this.vaultDataService.updatePosition(vault.address, newPosition, newPoolData);
    // COMMENTED OUT: VaultHealth now refreshes tokens at the top of attemptTopUp.
    // Strategy mid-flow refreshes (initializeVault:193, rebalancePosition:765, handleSwapEvent:363)
    // handle strategy's own freshness needs. This end-of-function refresh was only for VaultHealth.
    // await this.vaultDataService.refreshTokens(vault.address);

  }

  // ===========================================================================
  // Token Preparation
  // ===========================================================================

  /**
   * Prepare tokens for position creation/addition by swapping to cover deficits
   *
   * Three-phase approach:
   * 1. Use non-aligned tokens to cover deficits (with quote-based amounts)
   * 2. Use excess target tokens if deficits remain
   *
   * @param {Object} vault - Vault object with tokens balance
   * @param {Object} targetAmounts - Target amounts { token0Amount, token1Amount } based on ratio
   * @param {Object} token0Data - Token0 data { address, symbol, decimals }
   * @param {Object} token1Data - Token1 data { address, symbol, decimals }
   * @returns {Promise<Object>} { deficitSwaps: [], wrapUnwrap: {}, metadata: { deficit: [] } }
   */
  async prepareTokensForPosition(vault, targetAmounts, token0Data, token1Data) {
    const platformId = vault.targetPlatforms[0];
    const adapter = this.adapters.get(platformId);
    if (!adapter) {
      throw new UnrecoverableError(`No adapter for platform ${platformId}`);
    }

    // Fetch prices for all tokens (aligned + non-aligned) early
    const allTokenSymbols = [token0Data.symbol, token1Data.symbol];
    const nonAlignedTokens = Object.keys(vault.tokens).filter(symbol =>
      symbol !== token0Data.symbol &&
      symbol !== token1Data.symbol &&
      vault.tokens[symbol] !== '0'
    );
    allTokenSymbols.push(...nonAlignedTokens);

    const prices = await retryRpcCall(
      () => fetchTokenPrices(allTokenSymbols, CACHE_DURATIONS['30-SECONDS']),
      'fetchTokenPrices for prepareTokensForPosition',
      { log: (msg) => this.log(msg) }
    );

    // Validate target token prices exist
    const token0Price = prices[token0Data.symbol.toUpperCase()];
    const token1Price = prices[token1Data.symbol.toUpperCase()];

    if (!token0Price || !token1Price || !Number.isFinite(token0Price) || !Number.isFinite(token1Price)) {
      throw new UnrecoverableError(
        `Missing or invalid prices for target tokens: ` +
        `${token0Data.symbol}=${token0Price}, ${token1Data.symbol}=${token1Price}`
      );
    }

    // Get minimum swap value for this chain
    const minSwapValue = getMinSwapValue(this.chainId);
    this.log(`Minimum swap value for chain ${this.chainId}: $${minSwapValue}`);

    // Track skipped dust value for deficit tolerance calculation
    let totalSkippedDustUSD = 0;

    // Track which phases were used
    const phasesUsed = {
      wrapUnwrap: false,
      nonAlignedForDeficit: false,
      excessTargetTokens: false
    };
    const nonAlignedTokensUsedForDeficit = new Set();

    // 1. Calculate required vs available (target amounts from ratio calculation)
    // No slippage buffer needed here - adapter handles slippage during mint
    const requiredToken0 = BigInt(targetAmounts.token0Amount);
    const requiredToken1 = BigInt(targetAmounts.token1Amount);
    const availableToken0 = BigInt(vault.tokens[token0Data.symbol] || '0'); // Keep fallback values because vault cache will not have entries for tokens with 0 balance
    const availableToken1 = BigInt(vault.tokens[token1Data.symbol] || '0');

    this.log(`Required: ${ethers.utils.formatUnits(requiredToken0, token0Data.decimals)} ${token0Data.symbol}, ${ethers.utils.formatUnits(requiredToken1, token1Data.decimals)} ${token1Data.symbol}`);
    this.log(`Available: ${ethers.utils.formatUnits(availableToken0, token0Data.decimals)} ${token0Data.symbol}, ${ethers.utils.formatUnits(availableToken1, token1Data.decimals)} ${token1Data.symbol}`);

    // 2. Calculate deficits
    const token0Deficit = requiredToken0 > availableToken0 ? requiredToken0 - availableToken0 : 0n;
    const token1Deficit = requiredToken1 > availableToken1 ? requiredToken1 - availableToken1 : 0n;

    // 3. Track remaining balances for non-aligned tokens
    const remainingBalances = {};
    for (const symbol of nonAlignedTokens) {
      remainingBalances[symbol] = BigInt(vault.tokens[symbol]);
    }

    this.log(`Deficits: ${ethers.utils.formatUnits(token0Deficit, token0Data.decimals)} ${token0Data.symbol}, ${ethers.utils.formatUnits(token1Deficit, token1Data.decimals)} ${token1Data.symbol}`);
    this.log(`Non-aligned tokens available: ${nonAlignedTokens.length > 0 ? nonAlignedTokens.join(', ') : 'none'}`);

    const deficitSwapInstructions = [];
    let remainingToken0Deficit = token0Deficit;
    let remainingToken1Deficit = token1Deficit;

    // Track wrap/unwrap amounts (native <-> wrapped native is 1:1, no router needed)
    let wrapAmount = 0n;    // native → wrapped native (e.g., ETH → WETH, AVAX → WAVAX)
    let unwrapAmount = 0n;  // wrapped native → native (e.g., WETH → ETH, WAVAX → AVAX)

    // Pre-Phase: Handle native <-> wrapped native conversions before normal swap routing
    const nativeSymbol = getNativeSymbol(this.chainId);
    const wrappedNativeSymbol = getWrappedNativeSymbol(this.chainId);
    const token0IsWrappedNative = token0Data.symbol === wrappedNativeSymbol;
    const token1IsWrappedNative = token1Data.symbol === wrappedNativeSymbol;
    const token0IsNative = token0Data.isNative === true;
    const token1IsNative = token1Data.isNative === true;

    // Case 1: Non-aligned native, target token is wrapped native → wrap
    if (nonAlignedTokens.includes(nativeSymbol) && (token0IsWrappedNative || token1IsWrappedNative)) {
      const nativeBalance = remainingBalances[nativeSymbol] || 0n;
      const wrappedNativeDeficit = token0IsWrappedNative ? remainingToken0Deficit : remainingToken1Deficit;

      if (nativeBalance > 0n && wrappedNativeDeficit > 0n) {
        const amount = nativeBalance < wrappedNativeDeficit ? nativeBalance : wrappedNativeDeficit;
        wrapAmount += amount;

        remainingBalances[nativeSymbol] -= amount;
        if (token0IsWrappedNative) remainingToken0Deficit -= amount;
        else remainingToken1Deficit -= amount;

        if (remainingBalances[nativeSymbol] === 0n) {
          delete remainingBalances[nativeSymbol];
          const idx = nonAlignedTokens.indexOf(nativeSymbol);
          if (idx > -1) nonAlignedTokens.splice(idx, 1);
        }
        phasesUsed.wrapUnwrap = true;
        this.log(`Pre-phase: Wrapping ${ethers.utils.formatEther(amount)} ${nativeSymbol} to ${wrappedNativeSymbol}`);
      }
    }

    // Case 2: Non-aligned wrapped native, target token is native → unwrap
    if (nonAlignedTokens.includes(wrappedNativeSymbol) && (token0IsNative || token1IsNative)) {
      const wrappedNativeBalance = remainingBalances[wrappedNativeSymbol] || 0n;
      const nativeDeficit = token0IsNative ? remainingToken0Deficit : remainingToken1Deficit;

      if (wrappedNativeBalance > 0n && nativeDeficit > 0n) {
        const amount = wrappedNativeBalance < nativeDeficit ? wrappedNativeBalance : nativeDeficit;
        unwrapAmount += amount;

        remainingBalances[wrappedNativeSymbol] -= amount;
        if (token0IsNative) remainingToken0Deficit -= amount;
        else remainingToken1Deficit -= amount;

        if (remainingBalances[wrappedNativeSymbol] === 0n) {
          delete remainingBalances[wrappedNativeSymbol];
          const idx = nonAlignedTokens.indexOf(wrappedNativeSymbol);
          if (idx > -1) nonAlignedTokens.splice(idx, 1);
        }
        phasesUsed.wrapUnwrap = true;
        this.log(`Pre-phase: Unwrapping ${ethers.utils.formatEther(amount)} ${wrappedNativeSymbol} to ${nativeSymbol}`);
      }
    }

    // Phase 1: Use non-aligned tokens to cover deficits (filter dust)
    for (const tokenSymbol of nonAlignedTokens) {
      const tokenData = this.tokens[tokenSymbol];
      if (!tokenData) continue;

      // Calculate USD value of this token
      const tokenBalance = remainingBalances[tokenSymbol];
      const tokenPrice = prices[tokenSymbol.toUpperCase()];

      // Validate price exists (fail fast if missing for non-aligned token)
      if (!tokenPrice || !Number.isFinite(tokenPrice)) {
        this.log(`⚠️ Warning: Missing price for ${tokenSymbol}, skipping swap`);
        continue;
      }

      const tokenUSDValue = parseFloat(ethers.utils.formatUnits(tokenBalance, tokenData.decimals)) * tokenPrice;

      // Skip dust swaps - track their value for deficit tolerance
      if (tokenUSDValue < minSwapValue) {
        totalSkippedDustUSD += tokenUSDValue;
        this.log(`Skipping ${tokenSymbol} swap: $${tokenUSDValue.toFixed(2)} < $${minSwapValue} minimum (dust)`);
        continue;
      }

      // Cover token0 deficit
      if (remainingToken0Deficit > 0n && remainingBalances[tokenSymbol] > 0n) {
        // Skip native <-> wrapped native pairs (handled in pre-phase as wrap/unwrap)
        if (this.isWrapUnwrapPair(tokenData, token0Data).isWrapOrUnwrap) continue;

        const swapResult = await this.getDeficitSwapQuote(
          adapter, tokenData, token0Data, remainingBalances[tokenSymbol], remainingToken0Deficit
        );
        if (swapResult) {
          deficitSwapInstructions.push({
            tokenIn: tokenData, tokenOut: token0Data, amount: swapResult.amountIn, isAmountIn: true
          });
          phasesUsed.nonAlignedForDeficit = true;
          nonAlignedTokensUsedForDeficit.add(tokenSymbol);
          remainingBalances[tokenSymbol] -= BigInt(swapResult.amountIn);
          remainingToken0Deficit -= BigInt(swapResult.amountOut);
          if (remainingToken0Deficit < 0n) remainingToken0Deficit = 0n;
        }
      }

      // Cover token1 deficit
      if (remainingToken1Deficit > 0n && remainingBalances[tokenSymbol] > 0n) {
        // Skip native <-> wrapped native pairs (handled in pre-phase as wrap/unwrap)
        if (this.isWrapUnwrapPair(tokenData, token1Data).isWrapOrUnwrap) continue;

        const swapResult = await this.getDeficitSwapQuote(
          adapter, tokenData, token1Data, remainingBalances[tokenSymbol], remainingToken1Deficit
        );
        if (swapResult) {
          deficitSwapInstructions.push({
            tokenIn: tokenData, tokenOut: token1Data, amount: swapResult.amountIn, isAmountIn: true
          });
          phasesUsed.nonAlignedForDeficit = true;
          nonAlignedTokensUsedForDeficit.add(tokenSymbol);
          remainingBalances[tokenSymbol] -= BigInt(swapResult.amountIn);
          remainingToken1Deficit -= BigInt(swapResult.amountOut);
          if (remainingToken1Deficit < 0n) remainingToken1Deficit = 0n;
        }
      }
    }

    // Phase 2: Use excess target tokens if deficits remain (filter dust)
    const excessToken0 = availableToken0 > requiredToken0 ? availableToken0 - requiredToken0 : 0n;
    const excessToken1 = availableToken1 > requiredToken1 ? availableToken1 - requiredToken1 : 0n;

    // Check if excess amounts are above swap minimum
    let swappableExcessToken0 = excessToken0;
    let swappableExcessToken1 = excessToken1;

    if (excessToken0 > 0n) {
      const excessToken0USD = parseFloat(ethers.utils.formatUnits(excessToken0, token0Data.decimals)) * token0Price;
      if (excessToken0USD < minSwapValue) {
        this.log(`Skipping excess ${token0Data.symbol} swap: $${excessToken0USD.toFixed(2)} < $${minSwapValue} minimum (dust)`);
        totalSkippedDustUSD += excessToken0USD;
        swappableExcessToken0 = 0n;
      }
    }

    if (excessToken1 > 0n) {
      const excessToken1USD = parseFloat(ethers.utils.formatUnits(excessToken1, token1Data.decimals)) * token1Price;
      if (excessToken1USD < minSwapValue) {
        this.log(`Skipping excess ${token1Data.symbol} swap: $${excessToken1USD.toFixed(2)} < $${minSwapValue} minimum (dust)`);
        totalSkippedDustUSD += excessToken1USD;
        swappableExcessToken1 = 0n;
      }
    }

    if (remainingToken0Deficit > 0n && swappableExcessToken1 > 0n) {
      const swapResult = await this.getDeficitSwapQuote(
        adapter, token1Data, token0Data, swappableExcessToken1, remainingToken0Deficit
      );
      if (swapResult) {
        deficitSwapInstructions.push({
          tokenIn: token1Data, tokenOut: token0Data, amount: swapResult.amountIn, isAmountIn: true
        });
        phasesUsed.excessTargetTokens = true;
        remainingToken0Deficit -= BigInt(swapResult.amountOut);
        if (remainingToken0Deficit < 0n) remainingToken0Deficit = 0n;
      }
    }

    if (remainingToken1Deficit > 0n && swappableExcessToken0 > 0n) {
      const swapResult = await this.getDeficitSwapQuote(
        adapter, token0Data, token1Data, swappableExcessToken0, remainingToken1Deficit
      );
      if (swapResult) {
        deficitSwapInstructions.push({
          tokenIn: token0Data, tokenOut: token1Data, amount: swapResult.amountIn, isAmountIn: true
        });
        phasesUsed.excessTargetTokens = true;
        remainingToken1Deficit -= BigInt(swapResult.amountOut);
        if (remainingToken1Deficit < 0n) remainingToken1Deficit = 0n;
      }
    }

    // Log remaining deficits (informational — position will be created with available balances)
    if (remainingToken0Deficit > 0n || remainingToken1Deficit > 0n) {
      const token0DeficitPct = Number(remainingToken0Deficit) / Number(requiredToken0) * 100;
      const token1DeficitPct = Number(remainingToken1Deficit) / Number(requiredToken1) * 100;

      // Calculate USD values if prices are available
      if (token0Price && token1Price && Number.isFinite(token0Price) && Number.isFinite(token1Price)) {
        const token0DeficitUSD = parseFloat(ethers.utils.formatUnits(remainingToken0Deficit, token0Data.decimals)) * token0Price;
        const token1DeficitUSD = parseFloat(ethers.utils.formatUnits(remainingToken1Deficit, token1Data.decimals)) * token1Price;
        const totalDeficitUSD = token0DeficitUSD + token1DeficitUSD;

        this.log(`⚠️ Remaining deficits after swap attempts:`);
        this.log(`   ${token0Data.symbol}: ${remainingToken0Deficit} (${token0DeficitPct.toFixed(2)}% of target, $${token0DeficitUSD.toFixed(2)})`);
        this.log(`   ${token1Data.symbol}: ${remainingToken1Deficit} (${token1DeficitPct.toFixed(2)}% of target, $${token1DeficitUSD.toFixed(2)})`);
        this.log(`   Total deficit: $${totalDeficitUSD.toFixed(2)}, Skipped dust: $${totalSkippedDustUSD.toFixed(2)}`);

        // Warn on unusually large deficits (>2%) — may indicate swap issues
        const targetUSD = parseFloat(ethers.utils.formatUnits(requiredToken0, token0Data.decimals)) * token0Price +
                          parseFloat(ethers.utils.formatUnits(requiredToken1, token1Data.decimals)) * token1Price;
        if (totalDeficitUSD > targetUSD * 0.02) {
          this.log(`   ⚠️ Large deficit: $${totalDeficitUSD.toFixed(2)} is ${(totalDeficitUSD / targetUSD * 100).toFixed(1)}% of target $${targetUSD.toFixed(2)}`);
        }
      } else {
        this.log(`⚠️ Remaining deficits after swap attempts:`);
        this.log(`   ${token0Data.symbol}: ${remainingToken0Deficit} (${token0DeficitPct.toFixed(2)}% of target)`);
        this.log(`   ${token1Data.symbol}: ${remainingToken1Deficit} (${token1DeficitPct.toFixed(2)}% of target)`);
      }
    }

    // Early return if no swaps or wraps needed
    const hasWrapUnwrap = wrapAmount > 0n || unwrapAmount > 0n;
    if (deficitSwapInstructions.length === 0 && !hasWrapUnwrap) {
      this.log('No swaps or wraps needed - sufficient tokens available');

      this.eventManager.emit('TokenPreparationCompleted', {
        vaultAddress: vault.address,
        strategyId: vault.strategy.strategyId,
        platformId,
        targetTokens: {
          token0: { symbol: token0Data.symbol, required: requiredToken0.toString(), available: availableToken0.toString(), deficit: token0Deficit.toString() },
          token1: { symbol: token1Data.symbol, required: requiredToken1.toString(), available: availableToken1.toString(), deficit: token1Deficit.toString() }
        },
        preparationResult: 'sufficient_tokens',
        swapTransactions: [],
        deficitSwapCount: 0,
        wrapUnwrap: { wrapAmount: '0', unwrapAmount: '0' },
        nonAlignedTokensUsed: [],
        swapMetadata: { deficit: [] },
        phasesUsed,
        timestamp: Date.now(),
        log: { level: 'info', message: 'Sufficient tokens available, no swaps or wraps needed', includeData: false }
      });

      return {
        deficitSwaps: [],
        wrapUnwrap: { wrapAmount: '0', unwrapAmount: '0' },
        metadata: { deficit: [] }
      };
    }

    // Ensure on-chain approvals for swap tokens (Permit2 for V3, router for traditional)
    // Skip native ETH - it doesn't need ERC20 approvals
    const tokenInAddresses = [...new Set(
      deficitSwapInstructions
        .filter(i => !i.tokenIn.isNative)  // Native ETH has no contract to approve
        .map(i => i.tokenIn.address)
    )];
    if (tokenInAddresses.length > 0) {
      const approvalTxs = await adapter.getRequiredApprovals(
        'swap',
        vault.address,
        tokenInAddresses,
        this.provider
      );
      if (approvalTxs.length > 0) {
        await this.executeBatchTransactions(vault, approvalTxs, 'swap token approvals', 'approval');
      }
    }

    // Generate swap transactions - adapter handles platform-specific auth
    const signer = this.getVaultSigner(vault);
    const swapOptions = {
      signer,
      recipient: vault.address,
      slippageTolerance: vault.strategy.parameters.maxSlippage,
      provider: this.provider,
      chainId: this.chainId
    };

    const { transactions: deficitSwaps, metadata: deficitMetadata } =
      await adapter.batchSwapTransactions(deficitSwapInstructions, swapOptions);

    // Build wrap/unwrap result
    const wrapUnwrapResult = {
      wrapAmount: wrapAmount.toString(),
      unwrapAmount: unwrapAmount.toString()
    };

    // Log summary
    const wrapUnwrapSummary = hasWrapUnwrap
      ? `, wrap: ${ethers.utils.formatEther(wrapAmount)} ${nativeSymbol}, unwrap: ${ethers.utils.formatEther(unwrapAmount)} ${wrappedNativeSymbol}`
      : '';
    this.log(`Generated ${deficitSwaps.length} deficit swap transactions${wrapUnwrapSummary}`);

    // Emit event
    this.eventManager.emit('TokenPreparationCompleted', {
      vaultAddress: vault.address,
      strategyId: vault.strategy.strategyId,
      platformId,
      targetTokens: {
        token0: { symbol: token0Data.symbol, required: requiredToken0.toString(), available: availableToken0.toString(), deficit: token0Deficit.toString() },
        token1: { symbol: token1Data.symbol, required: requiredToken1.toString(), available: availableToken1.toString(), deficit: token1Deficit.toString() }
      },
      preparationResult: 'swaps_generated',
      swapTransactions: deficitSwaps,
      deficitSwapCount: deficitSwaps.length,
      wrapUnwrap: wrapUnwrapResult,
      nonAlignedTokensUsed: Array.from(nonAlignedTokensUsedForDeficit),
      swapMetadata: { deficit: deficitMetadata },
      phasesUsed,
      timestamp: Date.now(),
      log: { level: 'info', message: `Generated ${deficitSwaps.length} deficit swap transactions${wrapUnwrapSummary}`, includeData: false }
    });

    return {
      deficitSwaps,
      wrapUnwrap: wrapUnwrapResult,
      metadata: { deficit: deficitMetadata }
    };
  }

  /**
   * Get a swap quote to cover a deficit
   * @private
   */
  async getDeficitSwapQuote(adapter, tokenInData, tokenOutData, availableAmount, targetDeficit) {
    if (availableAmount <= 0n || targetDeficit <= 0n) return null;

    // Native ETH uses Ether.onChain() - skip address validation
    const tokenInIsNative = tokenInData.isNative === true;
    const tokenOutIsNative = tokenOutData.isNative === true;

    try {
      // Try EXACT_OUTPUT first
      const exactOutputQuote = await retryRpcCall(
        () => adapter.getBestSwapQuote({
          tokenInAddress: tokenInData.address,
          tokenOutAddress: tokenOutData.address,
          amount: targetDeficit.toString(),
          isAmountIn: false,
          tokenInIsNative,
          tokenOutIsNative,
          provider: this.provider
        }),
        `getBestSwapQuote EXACT_OUTPUT ${tokenInData.symbol}→${tokenOutData.symbol}`
      );
      const requiredInput = BigInt(exactOutputQuote.amountIn);

      if (requiredInput <= availableAmount) {
        return { amountIn: requiredInput.toString(), amountOut: targetDeficit.toString() };
      } else {
        // Fall back to EXACT_INPUT
        const exactInputQuote = await retryRpcCall(
          () => adapter.getBestSwapQuote({
            tokenInAddress: tokenInData.address,
            tokenOutAddress: tokenOutData.address,
            amount: availableAmount.toString(),
            isAmountIn: true,
            tokenInIsNative,
            tokenOutIsNative,
            provider: this.provider
          }),
          `getBestSwapQuote EXACT_INPUT ${tokenInData.symbol}→${tokenOutData.symbol}`
        );
        return { amountIn: availableAmount.toString(), amountOut: exactInputQuote.amountOut };
      }
    } catch (error) {
      this.log(`⚠️ Failed to get swap quote ${tokenInData.symbol} → ${tokenOutData.symbol}: ${error.message}`);
      return null;
    }
  }

  // ===========================================================================
  // Emergency Exit Baseline
  // ===========================================================================

  /**
   * Clear emergency exit baseline for a vault
   * Called when vault is removed, blacklisted, or positions are closed
   *
   * @param {string} vaultAddress - Vault address
   */
  clearEmergencyExitBaseline(vaultAddress) {
    if (this.emergencyExitBaseline[vaultAddress]) {
      delete this.emergencyExitBaseline[vaultAddress];
      this.log(`Cleared emergency exit baseline for vault ${vaultAddress}`);
    }
  }

  /**
   * Clean up all strategy-specific state for a vault (called during shutdown)
   * @param {string} vaultAddress - Vault address to clean up
   */
  cleanup(vaultAddress) {
    if (!vaultAddress) {
      this.log('Error: No vault address provided for cleanup');
      return;
    }

    const normalizedVaultAddress = vaultAddress.toLowerCase();

    // Clean up emergency exit baseline cache
    if (this.emergencyExitBaseline[vaultAddress]) {
      delete this.emergencyExitBaseline[vaultAddress];
      this.log(`Cleaned up emergency exit baseline for vault ${vaultAddress}`);
    }

    // Clean up swap counter for fee checks
    if (this.swapCountSinceLastFeeCheck[vaultAddress]) {
      delete this.swapCountSinceLastFeeCheck[vaultAddress];
    }

    // Emit cleanup event
    this.eventManager.emit('VaultPositionChecksCleared', {
      vaultAddress,
      log: {
        message: `Baby Steps cleanup for vault ${vaultAddress}`,
        level: 'info'
      }
    });
  }

  /**
   * Set up any additional monitoring beyond standard swap events
   * BabySteps strategy uses only standard swap event monitoring, so this is a no-op
   * @param {Object} vault - Vault data object
   * @returns {Promise<void>}
   */
  async setupAdditionalMonitoring(vault) {
    // BabySteps doesn't need additional monitoring beyond swap events
    // This stub satisfies the interface requirement
    this.log(`No additional monitoring needed for vault ${vault.address}`);
  }
}
