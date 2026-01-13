/**
 * @module strategies/babySteps/BabyStepsStrategy
 * @description Baby Steps strategy implementation for conservative position management
 */

import { ethers } from 'ethers';
import { StrategyBase } from '../base/index.js';
import { getStrategyDetails, getTransactionDeadlineMinutes, getWethAddress, getVaultContract, fetchTokenPrices, CACHE_DURATIONS, getMinDeploymentForGas } from 'fum_library';
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
        message: `Selected ${bestPool.token0.symbol}/${bestPool.token1.symbol} pool: ${bestPool.address} (fee: ${bestPool.fee}bp)`
      }
    });

    // Enrich token metadata with full token data from this.tokens
    const targetPool = {
      ...bestPool,
      token0: { ...this.tokens[bestPool.token0.symbol], ...bestPool.token0 },
      token1: { ...this.tokens[bestPool.token1.symbol], ...bestPool.token1 }
    };

    this.log(`🎯 Target pool selected: ${targetPool.token0.symbol}/${targetPool.token1.symbol} at ${targetPool.address}`);

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

        this.log(`🔍 Baseline check (retry scenario): baseline=${existingBaseline}, movement=${priceMovement.priceMovementPercent.toFixed(2)}%, trigger=${emergencyExitTrigger}%`);

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
    vault.tokens = await this.vaultDataService.fetchTokenBalances(
      vault.address,
      Object.keys(this.tokens)
    );

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
          const currentTick = adapter.getPoolCurrent(targetPool);
          this.emergencyExitBaseline[vault.address] = currentTick;
          this.log(`Set emergency exit baseline ${currentTick} for vault ${vault.address}`);
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
        // At or above max utilization - this is OK
        this.log('No available capital to deploy (at or above max utilization)');

        // Still need to set emergency exit baseline if we have aligned positions
        if (Object.keys(evaluation.alignedPositions).length > 0 && this.emergencyExitBaseline[vault.address] === undefined) {
          const currentTick = adapter.getPoolCurrent(targetPool);
          this.emergencyExitBaseline[vault.address] = currentTick;
          this.log(`Set emergency exit baseline ${currentTick} for vault ${vault.address} (at max utilization)`);
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

    this.log(`🔍 Swap detected in pool ${poolId}`);

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
    // Use 0.5% threshold = using 99% of range before triggering rebalance
    const REBALANCE_EDGE_THRESHOLD = 0.005;

    const rangeStatus = await adapter.evaluatePositionRange(
      position,
      null,  // provider not needed when swapData provided
      { swapData }
    );

    this.log(`Position range status: centeredness=${(rangeStatus.centeredness * 100).toFixed(2)}%, inRange=${rangeStatus.inRange}, tick=${rangeStatus.currentTick}`);

    if (!rangeStatus.inRange) {
      this.log(`🔄 REBALANCE NEEDED for vault ${vault.address}: Position is out of range`);
      await this.rebalancePosition(vault, position);
      this.swapCountSinceLastFeeCheck[vault.address] = 0;
      return;
    }

    if (rangeStatus.centeredness < REBALANCE_EDGE_THRESHOLD) {
      this.log(`🔄 REBALANCE NEEDED for vault ${vault.address}: Position too close to lower edge (${(rangeStatus.centeredness * 100).toFixed(2)}% < ${REBALANCE_EDGE_THRESHOLD * 100}% threshold)`);
      await this.rebalancePosition(vault, position);
      this.swapCountSinceLastFeeCheck[vault.address] = 0;
      return;
    }

    if (rangeStatus.centeredness > (1 - REBALANCE_EDGE_THRESHOLD)) {
      this.log(`🔄 REBALANCE NEEDED for vault ${vault.address}: Position too close to upper edge (${(rangeStatus.centeredness * 100).toFixed(2)}% > ${(1 - REBALANCE_EDGE_THRESHOLD) * 100}% threshold)`);
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
        const feeCollectionNeeded = await this.checkFeesToCollect(vault, position, adapter);
        this.swapCountSinceLastFeeCheck[vault.address] = 0;

        if (feeCollectionNeeded) {
          this.log(`💰 Executing fee collection for vault ${vault.address}`);
          await this.collectFees(vault, position);
          await this.vaultDataService.refreshPositionsAndTokens(vault.address);
          this.log(`Refreshed vault data for ${vault.address}`);
          return;
        }
      } catch (error) {
        this.log(`Error checking fees: ${error.message}`);
        // Don't reset counter on error - try again next interval
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
   * @returns {Promise<boolean>} Whether fee collection is needed
   */
  async checkFeesToCollect(vault, position, adapter) {
    // Check if fee reinvestment is enabled
    if (!vault.strategy.parameters.feeReinvestment) {
      this.log(`Fee reinvestment disabled for vault ${vault.address}`);
      return false;
    }

    const reinvestmentTrigger = vault.strategy.parameters.reinvestmentTrigger;
    if (!reinvestmentTrigger || reinvestmentTrigger === 0) {
      this.log(`No reinvestment trigger set for vault ${vault.address}`);
      return false;
    }

    this.log(`🔍 Checking fees for position ${position.id} with trigger $${reinvestmentTrigger}`);

    // Get pool metadata for token symbols
    const poolMetadata = this.poolData[position.pool];
    if (!poolMetadata) {
      this.log(`No pool metadata found for ${position.pool}`);
      return false;
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
      return false;
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

    return shouldCollect;
  }

  /**
   * Collect fees from a position and distribute to owner
   *
   * Generates and executes the collect transaction, parses the receipt,
   * emits the FeesCollected event, and distributes owner's portion.
   *
   * @param {Object} vault - Vault data
   * @param {Object} position - Position to collect fees from
   * @returns {Promise<Object>} Collection results
   */
  async collectFees(vault, position) {
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

    this.log(`Generating claim fees transaction for position ${positionId}`);

    // Generate claim fees transaction
    const claimFeesData = await retryRpcCall(
      () => adapter.generateClaimFeesData({
        positionId,
        provider: this.provider,
        walletAddress: vault.address,
        token0Address: token0Data.address,
        token1Address: token1Data.address,
        token0Decimals: token0Data.decimals,
        token1Decimals: token1Data.decimals,
        token0IsNative,
        token1IsNative
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
    const positionMetadata = {
      [positionId]: {
        token0Data,
        token1Data
      }
    };

    // Parse the collect receipt
    const { feesByPosition } = adapter.parseCollectReceipt(txResult.receipt, positionMetadata);

    // Log collected amounts
    if (feesByPosition[positionId]) {
      const fees = feesByPosition[positionId];
      this.log(`Collected fees - ${token0Data.symbol}: ${ethers.utils.formatUnits(fees.token0, token0Data.decimals)}, ${token1Data.symbol}: ${ethers.utils.formatUnits(fees.token1, token1Data.decimals)}`);
    }

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

      // selectBestPool handles ETH -> WETH resolution internally
      const { bestPool } = await retryRpcCall(
        () => adapter.selectBestPool(vault.targetTokens[0], vault.targetTokens[1], this.provider, this.chainId),
        'selectBestPool (rebalance)',
        { log: (msg) => this.log(msg) }
      );

      // Enrich with token data
      const targetPool = {
        ...bestPool,
        token0: { ...this.tokens[bestPool.token0.symbol], ...bestPool.token0 },
        token1: { ...this.tokens[bestPool.token1.symbol], ...bestPool.token1 }
      };

      this.log(`Target pool for new position: ${targetPool.token0.symbol}/${targetPool.token1.symbol} at ${targetPool.address}`);

      // Step 2: Close the out-of-range position
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
      vault.tokens = await this.vaultDataService.fetchTokenBalances(
        vault.address,
        Object.keys(this.tokens)
      );

      // Step 5: Calculate available deployment
      const { availableDeployment, assetValues } = await this.calculateAvailableDeployment(vault);

      // Step 6: Validate - we MUST have capital after closing a position
      if (availableDeployment <= 0) {
        throw new UnrecoverableError(
          `No available capital after closing position. ` +
          `availableDeployment=${availableDeployment}, totalValue=${assetValues.totalVaultValue}, ` +
          `maxUtilization=${vault.strategy.parameters.maxUtilization}%`
        );
      }

      // Step 7: Create new position centered on current price
      await this.createNewPosition(vault, availableDeployment, assetValues, targetPool);

      // Step 8: Refresh vault data
      await this.vaultDataService.refreshPositionsAndTokens(vault.address);

      // Step 9: Emit PositionRebalanced event
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

    // Use targetPool's actual tokens for alignment (adapter-resolved, e.g., WETH for V3)
    // This allows vault.targetTokens to contain 'ETH' while we check against 'WETH'
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

      // 6. Check range alignment result - position must be in range and not too close to edge
      const EDGE_THRESHOLD = 0.05; // 5% from either edge

      if (!rangeStatus.inRange) {
        this.log(`Position ${positionId} out of range: currentTick=${rangeStatus.currentTick}, range=${position.tickLower}-${position.tickUpper}`);
        nonAlignedPositions[positionId] = position;
      } else if (rangeStatus.centeredness < EDGE_THRESHOLD || rangeStatus.centeredness > (1 - EDGE_THRESHOLD)) {
        this.log(`Position ${positionId} too close to edge: centeredness=${rangeStatus.centeredness.toFixed(4)}, threshold=${EDGE_THRESHOLD}`);
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

      // Fetch fresh pool data
      const poolData = await retryRpcCall(
        () => adapter.getPoolData(position.pool, {}, this.provider),
        'getPoolData',
        { log: (msg) => this.log(msg) }
      );

      this.log(`Adding position ${positionId} to close batch: ${poolMetadata.token0Symbol}/${poolMetadata.token1Symbol} on ${poolMetadata.platform}`);

      // Store metadata for event parsing
      positionMetadata[positionId] = {
        position,
        poolMetadata,
        token0Data,
        token1Data,
        adapter
      };

      // Generate close position transaction data (100% removal)
      const closeData = await retryRpcCall(
        () => adapter.generateRemoveLiquidityData({
          position,
          percentage: 100,
          provider: this.provider,
          walletAddress: vault.address,
          poolData,
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

    for (const [adapter, platformMetadata] of metadataByAdapter) {
      const result = adapter.parseClosureReceipt(txResult.receipt, platformMetadata);
      Object.assign(principalByPosition, result.principalByPosition);
      Object.assign(feesByPosition, result.feesByPosition);
    }

    // Build detailed closure data for event
    const closedPositions = Object.entries(positions).map(([positionId, position]) => {
      const metadata = positionMetadata[positionId];
      const principal = principalByPosition[positionId] || { amount0: '0', amount1: '0' };

      return {
        positionId,
        position,
        platform: metadata.poolMetadata.platform,
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
   * WETH is unwrapped to native ETH before transfer.
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
    const wethAddress = getWethAddress(this.chainId);
    const vaultContract = getVaultContract(vault.address, this.provider);
    const signer = new ethers.Wallet(process.env.AUTOMATION_PRIVATE_KEY, this.provider);
    const vaultWithSigner = vaultContract.connect(signer);

    const distributions = [];
    const failures = [];

    for (const [addr, tokenData] of Object.entries(ownerAmounts)) {
      const isWeth = addr.toLowerCase() === wethAddress.toLowerCase();

      try {
        const receipt = await retryRpcCall(async () => {
          let tx;
          if (isWeth) {
            tx = await vaultWithSigner.unwrapAndWithdrawETH(wethAddress, tokenData.amount);
          } else {
            tx = await vaultWithSigner.withdrawTokens(tokenData.address, tokenData.amount);
          }
          return tx.wait();
        }, 'fee distribution', { log: (msg) => this.log(msg) });

        distributions.push({
          token: tokenData.symbol,
          address: tokenData.address,
          amount: tokenData.amount.toString(),
          amountFormatted: ethers.utils.formatUnits(tokenData.amount, tokenData.decimals),
          asNativeEth: isWeth,
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
   * Calculate available capital for deployment based on utilization limits
   *
   * Formula: availableDeployment = (totalValue * maxUtilization) - positionValue
   *
   * Applies two minimum thresholds:
   * 1. Chain minimum - don't waste gas on tiny deployments
   * 2. Vault-relative minimum (1%) - don't deploy unless utilization gap > 1%
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
    const maxUtilization = vault.strategy.parameters.maxUtilization / 100;
    const currentUtilization = totalValue > 0 ? positionValue / totalValue : 0;
    const rawAvailableDeployment = totalValue * maxUtilization - positionValue;

    // Minimum deployment thresholds:
    // - Chain minimum: don't waste gas on tiny deployments
    // - Vault-relative (1%): don't deploy unless utilization gap > 1%
    const chainMinimum = getMinDeploymentForGas(this.chainId);
    const vaultRelativeMinimum = totalValue * 0.01; // 1% of vault value
    const minDeployment = Math.max(chainMinimum, vaultRelativeMinimum);

    // Apply minimum threshold - if below, not worth deploying
    const availableDeployment = rawAvailableDeployment > minDeployment ? rawAvailableDeployment : 0;

    // Emit utilization metrics
    const utilizationGap = maxUtilization - currentUtilization;
    this.eventManager.emit('UtilizationCalculated', {
      vaultAddress: vault.address,
      totalVaultValue: totalValue,
      positionValue: positionValue,
      tokenValue: tokenValue,
      currentUtilization: currentUtilization,
      maxUtilization: maxUtilization,
      utilizationGap: utilizationGap,
      utilizationGapPercent: utilizationGap * 100,
      availableDeployment: availableDeployment,
      rawAvailableDeployment: rawAvailableDeployment,
      minDeployment: minDeployment,
      chainMinimum: chainMinimum,
      vaultRelativeMinimum: vaultRelativeMinimum,
      timestamp: Date.now(),
      strategyId: vault.strategy.strategyId,
      log: {
        level: 'info',
        message: `Vault value: $${totalValue.toFixed(2)}, Utilization: ${(currentUtilization * 100).toFixed(1)}% (gap: ${(utilizationGap * 100).toFixed(1)}%), Available: $${availableDeployment.toFixed(2)} (min: $${minDeployment.toFixed(2)})`,
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

    // Step 3: Convert full budget to token0 amount (adapter will determine actual split)
    const positionValues = assetValues.positions[position.id];
    if (!positionValues) {
      throw new UnrecoverableError(`Position ${position.id} not found in assetValues`);
    }

    const token0Price = positionValues.token0Price;
    const token1Price = positionValues.token1Price;

    // Calculate current position VALUE ratio (not token amount ratio)
    // This determines how to split the deployment budget between tokens
    const token0ValueUSD = positionValues.token0UsdValue;
    const token1ValueUSD = positionValues.token1UsdValue;
    const positionValueRatio = token0ValueUSD / token1ValueUSD;

    this.log(`Position value: $${token0ValueUSD.toFixed(2)} ${token0Data.symbol} : $${token1ValueUSD.toFixed(2)} ${token1Data.symbol}`);
    this.log(`Position value ratio: ${positionValueRatio.toFixed(4)} (${(positionValueRatio / (1 + positionValueRatio) * 100).toFixed(1)}% ${token0Data.symbol} : ${(1 / (1 + positionValueRatio) * 100).toFixed(1)}% ${token1Data.symbol})`);

    // Calculate how much of token0 to use as input based on VALUE ratio
    // If value ratio is 0.88 (47% WETH : 53% USDC), we allocate 47% of budget to WETH
    const token0Share = availableDeployment * (positionValueRatio / (1 + positionValueRatio));

    // Convert USD amount to raw token amount
    const token0InputDecimal = token0Share / token0Price;
    const token0InputAmount = ethers.utils.parseUnits(
      token0InputDecimal.toFixed(token0Data.decimals),
      token0Data.decimals
    );

    this.log(`Requesting quote for ${ethers.utils.formatUnits(token0InputAmount, token0Data.decimals)} ${token0Data.symbol} ($${token0Share.toFixed(2)} of $${availableDeployment.toFixed(2)} budget)`);

    // Step 4: Get add liquidity quote amounts - adapter determines optimal token split
    const platformId = vault.targetPlatforms[0];
    const adapter = this.adapters.get(platformId);
    if (!adapter) {
      throw new UnrecoverableError(`No adapter for platform ${platformId}`);
    }

    // Get add liquidity amounts - platform-agnostic interface returns amounts in caller's token order
    const quote = await retryRpcCall(
      () => adapter.getAddLiquidityAmounts({
        position,
        token0Amount: token0InputAmount.toString(),
        token1Amount: "0",
        provider: this.provider,
        poolData: targetPool,
        token0Data,
        token1Data
      }),
      'adapter.getAddLiquidityAmounts'
    );

    this.log(`Quote amounts received - need: ${ethers.utils.formatUnits(quote.token0Amount, token0Data.decimals)} ${token0Data.symbol}, ${ethers.utils.formatUnits(quote.token1Amount, token1Data.decimals)} ${token1Data.symbol}`);

    // Capture original requirements for post-swap validation (if deficit swaps fail)
    const originalRequirements = {
      token0Amount: BigInt(quote.token0Amount),
      token1Amount: BigInt(quote.token1Amount)
    };

    // Step 5: Prepare tokens (swap/wrap if needed to cover deficits)
    const { deficitSwaps, bufferSwaps, wrapUnwrap, metadata } = await this.prepareTokensForPosition(
      vault,
      quote,
      token0Data,
      token1Data
    );

    // Execute wrap/unwrap FIRST (swaps may depend on wrapped tokens)
    if (BigInt(wrapUnwrap.wrapAmount) > 0n) {
      this.log(`Wrapping ${ethers.utils.formatEther(wrapUnwrap.wrapAmount)} ETH to WETH`);
      await retryRpcCall(
        () => this.executeWrap(vault, wrapUnwrap.wrapAmount),
        `wrapETH for vault ${vault.address}`
      );
    }
    if (BigInt(wrapUnwrap.unwrapAmount) > 0n) {
      this.log(`Unwrapping ${ethers.utils.formatEther(wrapUnwrap.unwrapAmount)} WETH to ETH`);
      await retryRpcCall(
        () => this.executeUnwrap(vault, wrapUnwrap.unwrapAmount),
        `unwrapWETH for vault ${vault.address}`
      );
    }

    // Execute deficit swaps (CRITICAL - with retry on failure, but continue to buffer swaps even if exhausted)
    let currentDeficitSwaps = deficitSwaps;
    let currentBufferSwaps = bufferSwaps;
    let currentDeficitMetadata = metadata.deficit;
    let currentBufferMetadata = metadata.buffer;
    const maxRetries = 1;
    let retryCount = 0;

    // Track if deficit swaps failed - we'll still try buffer swaps
    let deficitSwapsFailed = false;
    let deficitSwapError = null;

    while (currentDeficitSwaps.length > 0) {
      try {
        this.log(`Executing ${currentDeficitSwaps.length} deficit swaps (critical)${retryCount > 0 ? ` [retry ${retryCount}]` : ''}`);
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
          // Don't throw yet - try buffer swaps first, then validate
          deficitSwapsFailed = true;
          deficitSwapError = error.message;
          this.log(`⚠️ Deficit swaps failed after ${maxRetries} retry(s), continuing to buffer swaps...`);
          break;
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
          quote,
          token0Data,
          token1Data
        );

        // Note: wrap/unwrap already executed, so freshResult.wrapUnwrap should be 0
        // But check just in case balances changed unexpectedly
        if (BigInt(freshResult.wrapUnwrap.wrapAmount) > 0n) {
          this.log(`Wrapping additional ${ethers.utils.formatEther(freshResult.wrapUnwrap.wrapAmount)} ETH to WETH`);
          await retryRpcCall(
            () => this.executeWrap(vault, freshResult.wrapUnwrap.wrapAmount),
            `wrapETH (additional) for vault ${vault.address}`
          );
        }
        if (BigInt(freshResult.wrapUnwrap.unwrapAmount) > 0n) {
          this.log(`Unwrapping additional ${ethers.utils.formatEther(freshResult.wrapUnwrap.unwrapAmount)} WETH to ETH`);
          await retryRpcCall(
            () => this.executeUnwrap(vault, freshResult.wrapUnwrap.unwrapAmount),
            `unwrapWETH (additional) for vault ${vault.address}`
          );
        }

        // Update swaps and metadata for next iteration
        currentDeficitSwaps = freshResult.deficitSwaps;
        currentBufferSwaps = freshResult.bufferSwaps;
        currentDeficitMetadata = freshResult.metadata.deficit;
        currentBufferMetadata = freshResult.metadata.buffer;

        // If no deficit swaps needed after refresh, we're done
        if (currentDeficitSwaps.length === 0) {
          this.log('No deficit swaps needed after balance refresh');
          break;
        }
      }
    }

    // Execute buffer swaps (OPTIONAL - failure is logged but doesn't block)
    if (currentBufferSwaps.length > 0) {
      try {
        this.log(`Executing ${currentBufferSwaps.length} buffer swaps (optional)`);
        const { receipt, gasEstimated } = await this.executeBatchTransactions(vault, currentBufferSwaps, 'buffer swaps', 'swap');

        // Extract actual amounts from receipt and emit TokensSwapped event
        const actualSwaps = adapter.parseSwapReceipt(receipt, currentBufferMetadata);
        const swapDetails = this.buildSwapDetails(currentBufferMetadata, actualSwaps);
        this.eventManager.emit('TokensSwapped', {
          vaultAddress: vault.address,
          swapCount: swapDetails.length,
          swapType: 'buffer',
          swaps: swapDetails,
          gasUsed: receipt.gasUsed.toString(),
          gasEstimated: gasEstimated,
          effectiveGasPrice: receipt.effectiveGasPrice.toString(),
          transactionHash: receipt.transactionHash,
          success: receipt.status === 1,
          timestamp: Date.now()
        });
      } catch (error) {
        this.log(`⚠️ Buffer swaps failed (non-critical): ${error.message}`);
        // Continue - buffer swaps are nice-to-have, not required
      }
    }

    // Step 6: Refresh token balances after swaps are completed
    vault.tokens = await this.vaultDataService.fetchTokenBalances(
      vault.address,
      Object.keys(this.tokens)
    );

    // Validate against original requirements (ONLY if deficit swaps failed)
    // If deficit swaps succeeded, we got what we needed - no extra validation
    if (deficitSwapsFailed) {
      const available0 = BigInt(vault.tokens[token0Data.symbol] || '0');
      const available1 = BigInt(vault.tokens[token1Data.symbol] || '0');

      // Use maxSlippage as tolerance (user's configured acceptable variance)
      const maxSlippage = vault.strategy.parameters.maxSlippage;
      const toleranceMultiplier = (100 - maxSlippage) / 100; // e.g., 0.995 for 0.5% slippage

      const minRequired0 = BigInt(Math.floor(Number(originalRequirements.token0Amount) * toleranceMultiplier));
      const minRequired1 = BigInt(Math.floor(Number(originalRequirements.token1Amount) * toleranceMultiplier));

      const hasEnoughToken0 = available0 >= minRequired0;
      const hasEnoughToken1 = available1 >= minRequired1;

      if (!hasEnoughToken0 || !hasEnoughToken1) {
        const shortfall0 = hasEnoughToken0 ? 0n : minRequired0 - available0;
        const shortfall1 = hasEnoughToken1 ? 0n : minRequired1 - available1;

        throw new UnrecoverableError(
          `Position requirements not met after swap attempts (tolerance: ${maxSlippage}%). ` +
          `${token0Data.symbol}: need ${ethers.utils.formatUnits(minRequired0, token0Data.decimals)}, ` +
          `have ${ethers.utils.formatUnits(available0, token0Data.decimals)} ` +
          `(short ${ethers.utils.formatUnits(shortfall0, token0Data.decimals)}). ` +
          `${token1Data.symbol}: need ${ethers.utils.formatUnits(minRequired1, token1Data.decimals)}, ` +
          `have ${ethers.utils.formatUnits(available1, token1Data.decimals)} ` +
          `(short ${ethers.utils.formatUnits(shortfall1, token1Data.decimals)}). ` +
          `Original error: ${deficitSwapError}`
        );
      }

      this.log(`✅ Buffer swaps compensated for deficit swap failure - proceeding with position`);
    }

    // Step 7: Calculate final amounts - cap at original quote (respects maxUtilization) but don't exceed actual balance
    const finalToken0Balance = BigInt(vault.tokens[token0Data.symbol]);
    const finalToken1Balance = BigInt(vault.tokens[token1Data.symbol]);
    const originalToken0 = BigInt(quote.token0Amount);
    const originalToken1 = BigInt(quote.token1Amount);

    const token0ForLiquidity = finalToken0Balance < originalToken0
      ? finalToken0Balance.toString()
      : quote.token0Amount;
    const token1ForLiquidity = finalToken1Balance < originalToken1
      ? finalToken1Balance.toString()
      : quote.token1Amount;

    this.log(`🔧 Final amounts for liquidity: ${ethers.utils.formatUnits(token0ForLiquidity, token0Data.decimals)} ${token0Data.symbol}, ${ethers.utils.formatUnits(token1ForLiquidity, token1Data.decimals)} ${token1Data.symbol}`);

    // Step 8: Execute increaseLiquidity transaction
    // 8a. Ensure token approvals for position manager
    const liquidityTarget = adapter.getApprovalTarget('liquidity');
    await this.ensureApprovals(vault, [token0Data.address, token1Data.address], liquidityTarget);

    // 8b. Generate add liquidity transaction data
    const addLiquidityData = await retryRpcCall(
      () => adapter.generateAddLiquidityData({
        position,
        token0Amount: token0ForLiquidity,
        token1Amount: token1ForLiquidity,
        provider: this.provider,
        poolData: targetPool,
        token0Data,
        token1Data,
        slippageTolerance: vault.strategy.parameters.maxSlippage,
        deadlineMinutes: getTransactionDeadlineMinutes(this.chainId)
      }),
      'generateAddLiquidityData'
    );

    // 8c. Execute add liquidity transaction
    this.log(`Executing increaseLiquidity for position ${position.id}`);
    const { receipt, gasEstimated } = await this.executeBatchTransactions(
      vault,
      [addLiquidityData],
      'add liquidity',
      'addliq'
    );

    // 8d. Parse receipt for actual amounts consumed
    const receiptData = adapter.parseIncreaseLiquidityReceipt(receipt);

    this.log(`✅ Liquidity added: ${ethers.utils.formatUnits(receiptData.amount0, token0Data.decimals)} ${token0Data.symbol}, ${ethers.utils.formatUnits(receiptData.amount1, token1Data.decimals)} ${token1Data.symbol} (liquidity: ${receiptData.liquidity})`);

    // Step 9: Emit LiquidityAddedToPosition event
    this.eventManager.emit('LiquidityAddedToPosition', {
      // Identity
      vaultAddress: vault.address,
      positionId: position.id,
      poolAddress: position.pool,

      // Amounts (quoted vs actual for slippage tracking)
      quotedToken0: token0ForLiquidity,
      quotedToken1: token1ForLiquidity,
      actualToken0: receiptData.amount0,
      actualToken1: receiptData.amount1,

      // Position (full object - use adapter methods to extract bounds)
      position,

      // Pool state at time of add (platform-agnostic via adapter)
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

    // Step 10: Refresh vault cache with updated position and token balances
    // If this fails, error bubbles up to trigger failed vault retry mechanism
    await this.vaultDataService.refreshPositionsAndTokens(vault.address);
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

    // Get position range object (platform-specific properties, e.g., tickLower/tickUpper for V3)
    const position = adapter.getPositionRange(
      targetPool,
      vault.strategy.parameters.targetRangeUpper,
      vault.strategy.parameters.targetRangeLower
    );

    // Generic logging via Object.values destructuring
    const [lower, upper, current] = Object.values(position);
    this.log(`Calculated range: ${lower} to ${upper} (current: ${current})`);
    this.log(`Range params: +${vault.strategy.parameters.targetRangeUpper}% / -${vault.strategy.parameters.targetRangeLower}%`);

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

    // Get test quote to determine pool's required ratio at this tick range
    // Use $100 worth of token0 to ensure precision across extreme price disparities (e.g., PEPE/WBTC)
    const testValueUSD = 100;
    const testInputDecimal = testValueUSD / token0Price;
    const testAmount = ethers.utils.parseUnits(
      testInputDecimal.toFixed(token0Data.decimals),
      token0Data.decimals
    );
    const testQuote = await retryRpcCall(
      () => adapter.getAddLiquidityAmounts({
        position,
        token0Amount: testAmount.toString(),
        token1Amount: '0',
        provider: this.provider,
        poolData: targetPool,
        token0Data,
        token1Data
      }),
      'getAddLiquidityAmounts (test quote)'
    );

    // Calculate optimal VALUE ratio from test quote
    const testToken0Decimal = parseFloat(ethers.utils.formatUnits(testQuote.token0Amount, token0Data.decimals));
    const testToken1Decimal = parseFloat(ethers.utils.formatUnits(testQuote.token1Amount, token1Data.decimals));
    const testToken0ValueUSD = testToken0Decimal * token0Price;
    const testToken1ValueUSD = testToken1Decimal * token1Price;
    const optimalRatio = testToken0ValueUSD / testToken1ValueUSD;

    this.log(`Token prices: ${token0Data.symbol}=$${token0Price.toFixed(2)}, ${token1Data.symbol}=$${token1Price.toFixed(2)}`);
    this.log(`Test quote ratio: ${testToken0Decimal.toFixed(6)} ${token0Data.symbol} : ${testToken1Decimal.toFixed(6)} ${token1Data.symbol}`);
    this.log(`Optimal value ratio: ${optimalRatio.toFixed(4)} (${(optimalRatio / (1 + optimalRatio) * 100).toFixed(1)}% ${token0Data.symbol} : ${(1 / (1 + optimalRatio) * 100).toFixed(1)}% ${token1Data.symbol})`);

    // Step 5: Split budget according to optimal ratio
    // Calculate how much of token0 to use as input based on VALUE ratio
    // If ratio is 1.0 (50%:50%), we allocate 50% of budget to token0
    const token0Share = availableDeployment * (optimalRatio / (1 + optimalRatio));

    // Convert USD amount to raw token amount
    const token0InputDecimal = token0Share / token0Price;
    const token0InputAmount = ethers.utils.parseUnits(
      token0InputDecimal.toFixed(token0Data.decimals),
      token0Data.decimals
    );

    this.log(`Requesting quote for ${ethers.utils.formatUnits(token0InputAmount, token0Data.decimals)} ${token0Data.symbol} ($${token0Share.toFixed(2)} of $${availableDeployment.toFixed(2)} budget)`);

    // Step 6: Get FULL add liquidity quote with actual amounts
    const quote = await retryRpcCall(
      () => adapter.getAddLiquidityAmounts({
        position,
        token0Amount: token0InputAmount.toString(),
        token1Amount: '0',
        provider: this.provider,
        poolData: targetPool,
        token0Data,
        token1Data
      }),
      'adapter.getAddLiquidityAmounts'
    );

    this.log(`Quote amounts received - need: ${ethers.utils.formatUnits(quote.token0Amount, token0Data.decimals)} ${token0Data.symbol}, ${ethers.utils.formatUnits(quote.token1Amount, token1Data.decimals)} ${token1Data.symbol}`);

    // Capture original requirements for post-swap validation (if deficit swaps fail)
    const originalRequirements = {
      token0Amount: BigInt(quote.token0Amount),
      token1Amount: BigInt(quote.token1Amount)
    };

    // Step 7: Prepare tokens (swap/wrap if needed to cover deficits)
    const { deficitSwaps, bufferSwaps, wrapUnwrap, metadata } = await this.prepareTokensForPosition(
      vault,
      quote,
      token0Data,
      token1Data
    );

    // Execute wrap/unwrap FIRST (swaps may depend on wrapped tokens)
    if (BigInt(wrapUnwrap.wrapAmount) > 0n) {
      this.log(`Wrapping ${ethers.utils.formatEther(wrapUnwrap.wrapAmount)} ETH to WETH`);
      await retryRpcCall(
        () => this.executeWrap(vault, wrapUnwrap.wrapAmount),
        `wrapETH for vault ${vault.address}`
      );
    }
    if (BigInt(wrapUnwrap.unwrapAmount) > 0n) {
      this.log(`Unwrapping ${ethers.utils.formatEther(wrapUnwrap.unwrapAmount)} WETH to ETH`);
      await retryRpcCall(
        () => this.executeUnwrap(vault, wrapUnwrap.unwrapAmount),
        `unwrapWETH for vault ${vault.address}`
      );
    }

    // Execute deficit swaps (CRITICAL - with retry on failure, but continue to buffer swaps even if exhausted)
    let currentDeficitSwaps = deficitSwaps;
    let currentBufferSwaps = bufferSwaps;
    let currentDeficitMetadata = metadata.deficit;
    let currentBufferMetadata = metadata.buffer;
    const maxRetries = 1;
    let retryCount = 0;

    // Track if deficit swaps failed - we'll still try buffer swaps
    let deficitSwapsFailed = false;
    let deficitSwapError = null;

    while (currentDeficitSwaps.length > 0) {
      try {
        this.log(`Executing ${currentDeficitSwaps.length} deficit swaps (critical)${retryCount > 0 ? ` [retry ${retryCount}]` : ''}`);
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
          // Don't throw yet - try buffer swaps first, then validate
          deficitSwapsFailed = true;
          deficitSwapError = error.message;
          this.log(`⚠️ Deficit swaps failed after ${maxRetries} retry(s), continuing to buffer swaps...`);
          break;
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
          quote,
          token0Data,
          token1Data
        );

        // Note: wrap/unwrap already executed, so freshResult.wrapUnwrap should be 0
        // But check just in case balances changed unexpectedly
        if (BigInt(freshResult.wrapUnwrap.wrapAmount) > 0n) {
          this.log(`Wrapping additional ${ethers.utils.formatEther(freshResult.wrapUnwrap.wrapAmount)} ETH to WETH`);
          await retryRpcCall(
            () => this.executeWrap(vault, freshResult.wrapUnwrap.wrapAmount),
            `wrapETH (additional) for vault ${vault.address}`
          );
        }
        if (BigInt(freshResult.wrapUnwrap.unwrapAmount) > 0n) {
          this.log(`Unwrapping additional ${ethers.utils.formatEther(freshResult.wrapUnwrap.unwrapAmount)} WETH to ETH`);
          await retryRpcCall(
            () => this.executeUnwrap(vault, freshResult.wrapUnwrap.unwrapAmount),
            `unwrapWETH (additional) for vault ${vault.address}`
          );
        }

        // Update swaps and metadata for next iteration
        currentDeficitSwaps = freshResult.deficitSwaps;
        currentBufferSwaps = freshResult.bufferSwaps;
        currentDeficitMetadata = freshResult.metadata.deficit;
        currentBufferMetadata = freshResult.metadata.buffer;

        // If no deficit swaps needed after refresh, we're done
        if (currentDeficitSwaps.length === 0) {
          this.log('No deficit swaps needed after balance refresh');
          break;
        }
      }
    }

    // Execute buffer swaps (OPTIONAL - failure is logged but doesn't block)
    if (currentBufferSwaps.length > 0) {
      try {
        this.log(`Executing ${currentBufferSwaps.length} buffer swaps (optional)`);
        const { receipt, gasEstimated } = await this.executeBatchTransactions(vault, currentBufferSwaps, 'buffer swaps', 'swap');

        // Extract actual amounts from receipt and emit TokensSwapped event
        const actualSwaps = adapter.parseSwapReceipt(receipt, currentBufferMetadata);
        const swapDetails = this.buildSwapDetails(currentBufferMetadata, actualSwaps);
        this.eventManager.emit('TokensSwapped', {
          vaultAddress: vault.address,
          swapCount: swapDetails.length,
          swapType: 'buffer',
          swaps: swapDetails,
          gasUsed: receipt.gasUsed.toString(),
          gasEstimated: gasEstimated,
          effectiveGasPrice: receipt.effectiveGasPrice.toString(),
          transactionHash: receipt.transactionHash,
          success: receipt.status === 1,
          timestamp: Date.now()
        });
      } catch (error) {
        this.log(`⚠️ Buffer swaps failed (non-critical): ${error.message}`);
        // Continue - buffer swaps are nice-to-have, not required
      }
    }

    // Step 8: Refresh token balances after swaps are completed
    vault.tokens = await this.vaultDataService.fetchTokenBalances(
      vault.address,
      Object.keys(this.tokens)
    );

    // Step 9: Validate against original requirements (ONLY if deficit swaps failed)
    // If deficit swaps succeeded, we got what we needed - no extra validation
    if (deficitSwapsFailed) {
      const available0 = BigInt(vault.tokens[token0Data.symbol] || '0');
      const available1 = BigInt(vault.tokens[token1Data.symbol] || '0');

      // Use maxSlippage as tolerance (user's configured acceptable variance)
      const maxSlippage = vault.strategy.parameters.maxSlippage;
      const toleranceMultiplier = (100 - maxSlippage) / 100; // e.g., 0.995 for 0.5% slippage

      const minRequired0 = BigInt(Math.floor(Number(originalRequirements.token0Amount) * toleranceMultiplier));
      const minRequired1 = BigInt(Math.floor(Number(originalRequirements.token1Amount) * toleranceMultiplier));

      const hasEnoughToken0 = available0 >= minRequired0;
      const hasEnoughToken1 = available1 >= minRequired1;

      if (!hasEnoughToken0 || !hasEnoughToken1) {
        const shortfall0 = hasEnoughToken0 ? 0n : minRequired0 - available0;
        const shortfall1 = hasEnoughToken1 ? 0n : minRequired1 - available1;

        throw new UnrecoverableError(
          `Position requirements not met after swap attempts (tolerance: ${maxSlippage}%). ` +
          `${token0Data.symbol}: need ${ethers.utils.formatUnits(minRequired0, token0Data.decimals)}, ` +
          `have ${ethers.utils.formatUnits(available0, token0Data.decimals)} ` +
          `(short ${ethers.utils.formatUnits(shortfall0, token0Data.decimals)}). ` +
          `${token1Data.symbol}: need ${ethers.utils.formatUnits(minRequired1, token1Data.decimals)}, ` +
          `have ${ethers.utils.formatUnits(available1, token1Data.decimals)} ` +
          `(short ${ethers.utils.formatUnits(shortfall1, token1Data.decimals)}). ` +
          `Original error: ${deficitSwapError}`
        );
      }

      this.log(`✅ Buffer swaps compensated for deficit swap failure - proceeding with position`);
    }

    // Step 10: Calculate final amounts - cap at original quote but don't exceed actual balance
    const finalToken0Balance = BigInt(vault.tokens[token0Data.symbol]);
    const finalToken1Balance = BigInt(vault.tokens[token1Data.symbol]);
    const originalToken0 = BigInt(quote.token0Amount);
    const originalToken1 = BigInt(quote.token1Amount);

    const token0ForLiquidity = finalToken0Balance < originalToken0
      ? finalToken0Balance.toString()
      : quote.token0Amount;
    const token1ForLiquidity = finalToken1Balance < originalToken1
      ? finalToken1Balance.toString()
      : quote.token1Amount;

    this.log(`Final amounts for liquidity: ${ethers.utils.formatUnits(token0ForLiquidity, token0Data.decimals)} ${token0Data.symbol}, ${ethers.utils.formatUnits(token1ForLiquidity, token1Data.decimals)} ${token1Data.symbol}`);

    // Step 11: Execute mint transaction
    // 11a. Ensure token approvals for position manager
    const liquidityTarget = adapter.getApprovalTarget('liquidity');
    await this.ensureApprovals(vault, [token0Data.address, token1Data.address], liquidityTarget);

    // 11b. Generate CREATE position data (different from addToPosition which uses generateAddLiquidityData)
    const createPositionData = await retryRpcCall(
      () => adapter.generateCreatePositionData({
        position,
        token0Amount: token0ForLiquidity,
        token1Amount: token1ForLiquidity,
        provider: this.provider,
        walletAddress: vault.address,
        poolData: targetPool,
        token0Data,
        token1Data,
        slippageTolerance: vault.strategy.parameters.maxSlippage,
        deadlineMinutes: getTransactionDeadlineMinutes(this.chainId)
      }),
      'generateCreatePositionData'
    );

    // 11c. Execute MINT transaction (different from 'addliq')
    this.log(`Executing mint for new ${token0Data.symbol}/${token1Data.symbol} position`);
    const { receipt, gasEstimated } = await this.executeBatchTransactions(
      vault,
      [createPositionData],
      'create position',
      'mint'
    );

    // 11d. Parse receipt for actual amounts consumed and new position ID
    const receiptData = adapter.parseIncreaseLiquidityReceipt(receipt);

    this.log(`✅ Position created: ID ${receiptData.tokenId}, ${ethers.utils.formatUnits(receiptData.amount0, token0Data.decimals)} ${token0Data.symbol}, ${ethers.utils.formatUnits(receiptData.amount1, token1Data.decimals)} ${token1Data.symbol} (liquidity: ${receiptData.liquidity})`);

    // Step 12: Emit NewPositionCreated event
    this.eventManager.emit('NewPositionCreated', {
      // Identity
      vaultAddress: vault.address,
      positionId: receiptData.tokenId,
      poolAddress: targetPool.address,

      // Amounts (quoted vs actual for slippage tracking)
      quotedToken0: token0ForLiquidity,
      quotedToken1: token1ForLiquidity,
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

    // Step 12.5: Set emergency exit baseline for new position
    // This overwrites any previous baseline (e.g., from aligned position at init, or previous position before rebalance)
    const currentPool = adapter.getPoolCurrent(targetPool);
    this.emergencyExitBaseline[vault.address] = currentPool;
    this.log(`Set emergency exit baseline ${currentPool} for vault ${vault.address} (new position)`);

    // Step 13: Refresh vault cache with new position and updated token balances
    // If this fails, error bubbles up to trigger failed vault retry mechanism
    await this.vaultDataService.refreshPositionsAndTokens(vault.address);
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
   * 3. Convert remaining non-aligned tokens 50/50 to target tokens
   *
   * @param {Object} vault - Vault object with tokens balance
   * @param {Object} quote - Liquidity quote with required amounts
   * @param {Object} token0Data - Token0 data { address, symbol, decimals }
   * @param {Object} token1Data - Token1 data { address, symbol, decimals }
   * @returns {Promise<Object>} { deficitSwaps: [], bufferSwaps: [], metadata: { deficit: [], buffer: [] } }
   */
  async prepareTokensForPosition(vault, quote, token0Data, token1Data) {
    const platformId = vault.targetPlatforms[0];
    const adapter = this.adapters.get(platformId);
    if (!adapter) {
      throw new UnrecoverableError(`No adapter for platform ${platformId}`);
    }

    // Track which phases were used
    const phasesUsed = {
      wrapUnwrap: false,
      nonAlignedForDeficit: false,
      excessTargetTokens: false,
      bufferSwaps: false
    };
    const nonAlignedTokensUsedForDeficit = new Set();

    // 1. Calculate required vs available
    const requiredToken0 = BigInt(quote.token0Amount);
    const requiredToken1 = BigInt(quote.token1Amount);
    const availableToken0 = BigInt(vault.tokens[token0Data.symbol] || '0'); // Keep fallback values because vault cache will not have entries for tokens with 0 balance
    const availableToken1 = BigInt(vault.tokens[token1Data.symbol] || '0');

    this.log(`Required: ${ethers.utils.formatUnits(requiredToken0, token0Data.decimals)} ${token0Data.symbol}, ${ethers.utils.formatUnits(requiredToken1, token1Data.decimals)} ${token1Data.symbol}`);
    this.log(`Available: ${ethers.utils.formatUnits(availableToken0, token0Data.decimals)} ${token0Data.symbol}, ${ethers.utils.formatUnits(availableToken1, token1Data.decimals)} ${token1Data.symbol}`);

    // 2. Calculate deficits
    const token0Deficit = requiredToken0 > availableToken0 ? requiredToken0 - availableToken0 : 0n;
    const token1Deficit = requiredToken1 > availableToken1 ? requiredToken1 - availableToken1 : 0n;

    // 3. Get non-aligned tokens
    const nonAlignedTokens = Object.keys(vault.tokens).filter(symbol =>
      symbol !== token0Data.symbol &&
      symbol !== token1Data.symbol &&
      vault.tokens[symbol] !== '0'
    );

    const remainingBalances = {};
    for (const symbol of nonAlignedTokens) {
      remainingBalances[symbol] = BigInt(vault.tokens[symbol]);
    }

    this.log(`Deficits: ${ethers.utils.formatUnits(token0Deficit, token0Data.decimals)} ${token0Data.symbol}, ${ethers.utils.formatUnits(token1Deficit, token1Data.decimals)} ${token1Data.symbol}`);
    this.log(`Non-aligned tokens available: ${nonAlignedTokens.length > 0 ? nonAlignedTokens.join(', ') : 'none'}`);

    const deficitSwapInstructions = [];
    const bufferSwapInstructions = [];
    let remainingToken0Deficit = token0Deficit;
    let remainingToken1Deficit = token1Deficit;

    // Track wrap/unwrap amounts (ETH <-> WETH is 1:1, no router needed)
    let wrapAmount = 0n;    // ETH → WETH
    let unwrapAmount = 0n;  // WETH → ETH

    // Pre-Phase: Handle ETH <-> WETH conversions before normal swap routing
    const ethSymbol = 'ETH';
    const wethSymbol = 'WETH';
    const token0IsWeth = token0Data.symbol === wethSymbol;
    const token1IsWeth = token1Data.symbol === wethSymbol;
    const token0IsNativeEth = token0Data.isNative === true;
    const token1IsNativeEth = token1Data.isNative === true;

    // Case 1: Non-aligned ETH, target token is WETH → wrap
    if (nonAlignedTokens.includes(ethSymbol) && (token0IsWeth || token1IsWeth)) {
      const ethBalance = remainingBalances[ethSymbol] || 0n;
      const wethDeficit = token0IsWeth ? remainingToken0Deficit : remainingToken1Deficit;

      if (ethBalance > 0n && wethDeficit > 0n) {
        const amount = ethBalance < wethDeficit ? ethBalance : wethDeficit;
        wrapAmount += amount;

        remainingBalances[ethSymbol] -= amount;
        if (token0IsWeth) remainingToken0Deficit -= amount;
        else remainingToken1Deficit -= amount;

        if (remainingBalances[ethSymbol] === 0n) {
          delete remainingBalances[ethSymbol];
          const idx = nonAlignedTokens.indexOf(ethSymbol);
          if (idx > -1) nonAlignedTokens.splice(idx, 1);
        }
        phasesUsed.wrapUnwrap = true;
        this.log(`Pre-phase: Wrapping ${ethers.utils.formatEther(amount)} ETH to WETH`);
      }
    }

    // Case 2: Non-aligned WETH, target token is native ETH → unwrap
    if (nonAlignedTokens.includes(wethSymbol) && (token0IsNativeEth || token1IsNativeEth)) {
      const wethBalance = remainingBalances[wethSymbol] || 0n;
      const ethDeficit = token0IsNativeEth ? remainingToken0Deficit : remainingToken1Deficit;

      if (wethBalance > 0n && ethDeficit > 0n) {
        const amount = wethBalance < ethDeficit ? wethBalance : ethDeficit;
        unwrapAmount += amount;

        remainingBalances[wethSymbol] -= amount;
        if (token0IsNativeEth) remainingToken0Deficit -= amount;
        else remainingToken1Deficit -= amount;

        if (remainingBalances[wethSymbol] === 0n) {
          delete remainingBalances[wethSymbol];
          const idx = nonAlignedTokens.indexOf(wethSymbol);
          if (idx > -1) nonAlignedTokens.splice(idx, 1);
        }
        phasesUsed.wrapUnwrap = true;
        this.log(`Pre-phase: Unwrapping ${ethers.utils.formatEther(amount)} WETH to ETH`);
      }
    }

    // Phase 1: Use non-aligned tokens to cover deficits
    for (const tokenSymbol of nonAlignedTokens) {
      const tokenData = this.tokens[tokenSymbol];
      if (!tokenData) continue;

      // Cover token0 deficit
      if (remainingToken0Deficit > 0n && remainingBalances[tokenSymbol] > 0n) {
        // Skip ETH <-> WETH pairs (handled in pre-phase as wrap/unwrap)
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
        // Skip ETH <-> WETH pairs (handled in pre-phase as wrap/unwrap)
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

    // Phase 2: Use excess target tokens if deficits remain
    const excessToken0 = availableToken0 > requiredToken0 ? availableToken0 - requiredToken0 : 0n;
    const excessToken1 = availableToken1 > requiredToken1 ? availableToken1 - requiredToken1 : 0n;

    if (remainingToken0Deficit > 0n && excessToken1 > 0n) {
      const swapResult = await this.getDeficitSwapQuote(
        adapter, token1Data, token0Data, excessToken1, remainingToken0Deficit
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

    if (remainingToken1Deficit > 0n && excessToken0 > 0n) {
      const swapResult = await this.getDeficitSwapQuote(
        adapter, token0Data, token1Data, excessToken0, remainingToken1Deficit
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

    // Verify deficits are covered
    if (remainingToken0Deficit > 0n || remainingToken1Deficit > 0n) {
      throw new UnrecoverableError(`Unable to cover deficits: ${token0Data.symbol}=${remainingToken0Deficit}, ${token1Data.symbol}=${remainingToken1Deficit}`);
    }

    // Phase 3: Buffer swaps for remaining non-aligned tokens
    for (const tokenSymbol of nonAlignedTokens) {
      if (remainingBalances[tokenSymbol] > 0n) {
        const tokenData = this.tokens[tokenSymbol];
        if (!tokenData) continue;

        const halfBalance = remainingBalances[tokenSymbol] / 2n;
        const otherHalf = remainingBalances[tokenSymbol] - halfBalance;

        // Check if either half should be a wrap/unwrap instead of swap
        const { isWrap: isToken0Wrap, isUnwrap: isToken0Unwrap } = this.isWrapUnwrapPair(tokenData, token0Data);
        const { isWrap: isToken1Wrap, isUnwrap: isToken1Unwrap } = this.isWrapUnwrapPair(tokenData, token1Data);

        // Handle half going to token0
        if (halfBalance > 0n) {
          if (isToken0Wrap) {
            wrapAmount += halfBalance;
            phasesUsed.wrapUnwrap = true;
            this.log(`Buffer phase: Adding ${ethers.utils.formatEther(halfBalance)} ETH to wrap amount`);
          } else if (isToken0Unwrap) {
            unwrapAmount += halfBalance;
            phasesUsed.wrapUnwrap = true;
            this.log(`Buffer phase: Adding ${ethers.utils.formatEther(halfBalance)} WETH to unwrap amount`);
          } else {
            bufferSwapInstructions.push({
              tokenIn: tokenData, tokenOut: token0Data, amount: halfBalance.toString(), isAmountIn: true
            });
            phasesUsed.bufferSwaps = true;
          }
        }

        // Handle half going to token1
        if (otherHalf > 0n) {
          if (isToken1Wrap) {
            wrapAmount += otherHalf;
            phasesUsed.wrapUnwrap = true;
            this.log(`Buffer phase: Adding ${ethers.utils.formatEther(otherHalf)} ETH to wrap amount`);
          } else if (isToken1Unwrap) {
            unwrapAmount += otherHalf;
            phasesUsed.wrapUnwrap = true;
            this.log(`Buffer phase: Adding ${ethers.utils.formatEther(otherHalf)} WETH to unwrap amount`);
          } else {
            bufferSwapInstructions.push({
              tokenIn: tokenData, tokenOut: token1Data, amount: otherHalf.toString(), isAmountIn: true
            });
            phasesUsed.bufferSwaps = true;
          }
        }
      }
    }

    // Early return if no swaps or wraps needed
    const hasWrapUnwrap = wrapAmount > 0n || unwrapAmount > 0n;
    if (deficitSwapInstructions.length === 0 && bufferSwapInstructions.length === 0 && !hasWrapUnwrap) {
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
        bufferSwapCount: 0,
        wrapUnwrap: { wrapAmount: '0', unwrapAmount: '0' },
        nonAlignedTokensUsed: [],
        swapMetadata: { deficit: [], buffer: [] },
        phasesUsed,
        timestamp: Date.now(),
        log: { level: 'info', message: 'Sufficient tokens available, no swaps or wraps needed', includeData: false }
      });

      return {
        deficitSwaps: [],
        bufferSwaps: [],
        wrapUnwrap: { wrapAmount: '0', unwrapAmount: '0' },
        metadata: { deficit: [], buffer: [] }
      };
    }

    // Ensure on-chain approvals for swap tokens (Permit2 for V3, router for traditional)
    // Skip native ETH - it doesn't need ERC20 approvals
    const allSwapInstructions = [...deficitSwapInstructions, ...bufferSwapInstructions];
    const tokenInAddresses = [...new Set(
      allSwapInstructions
        .filter(i => !i.tokenIn.isNative)  // Native ETH has no contract to approve
        .map(i => i.tokenIn.address)
    )];
    const swapTarget = adapter.getApprovalTarget('swap');
    await this.ensureApprovals(vault, tokenInAddresses, swapTarget);

    // Generate swap transactions - adapter handles platform-specific auth
    // IMPORTANT: Generate ALL swaps in a single batch to share Permit2 nonce tracker
    // (separate batches would create nonce collisions when executed sequentially)
    const signer = new ethers.Wallet(process.env.AUTOMATION_PRIVATE_KEY, this.provider);
    const swapOptions = {
      signer,
      recipient: vault.address,
      slippageTolerance: vault.strategy.parameters.maxSlippage,
      provider: this.provider,
      chainId: this.chainId
    };

    const { transactions: allSwapTransactions, metadata: allSwapMetadata } =
      await adapter.batchSwapTransactions(allSwapInstructions, swapOptions);

    // Split transactions back into deficit and buffer swaps for separate execution
    const deficitSwaps = allSwapTransactions.slice(0, deficitSwapInstructions.length);
    const bufferSwaps = allSwapTransactions.slice(deficitSwapInstructions.length);
    const deficitMetadata = allSwapMetadata.slice(0, deficitSwapInstructions.length);
    const bufferMetadata = allSwapMetadata.slice(deficitSwapInstructions.length);

    // Build wrap/unwrap result
    const wrapUnwrapResult = {
      wrapAmount: wrapAmount.toString(),
      unwrapAmount: unwrapAmount.toString()
    };

    // Log summary
    const wrapUnwrapSummary = hasWrapUnwrap
      ? `, wrap: ${ethers.utils.formatEther(wrapAmount)} ETH, unwrap: ${ethers.utils.formatEther(unwrapAmount)} WETH`
      : '';
    this.log(`Generated ${deficitSwaps.length} deficit + ${bufferSwaps.length} buffer swap transactions${wrapUnwrapSummary}`);

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
      swapTransactions: [...deficitSwaps, ...bufferSwaps],
      deficitSwapCount: deficitSwaps.length,
      bufferSwapCount: bufferSwaps.length,
      wrapUnwrap: wrapUnwrapResult,
      nonAlignedTokensUsed: Array.from(nonAlignedTokensUsedForDeficit),
      swapMetadata: { deficit: deficitMetadata, buffer: bufferMetadata },
      phasesUsed,
      timestamp: Date.now(),
      log: { level: 'info', message: `Generated ${deficitSwaps.length} deficit + ${bufferSwaps.length} buffer swap transactions${wrapUnwrapSummary}`, includeData: false }
    });

    return {
      deficitSwaps,
      bufferSwaps,
      wrapUnwrap: wrapUnwrapResult,
      metadata: { deficit: deficitMetadata, buffer: bufferMetadata }
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
          tokenOutIsNative
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
            tokenOutIsNative
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
