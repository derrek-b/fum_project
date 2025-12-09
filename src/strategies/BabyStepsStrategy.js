/**
 * @module BabyStepsStrategy
 * @description Baby Steps Strategy implementation for automated liquidity management. A simpler version of Parris Island strategy
 * focusing on essential parameters for easier management. Manages single concentrated liquidity positions with automated
 * rebalancing and fee collection capabilities.
 * @since 1.0.0
 */

// src/strategies/BabyStepsStrategy.js
import { ethers } from 'ethers';
import StrategyBase from './StrategyBase.js';
import { fetchTokenPrices, CACHE_DURATIONS, getStrategyDetails, getPoolTVLAverage, getPoolAge, getVaultContract, getMinDeploymentForGas, getMinLiquidityAmount, getMinDeploymentMultiplier, getMinBufferSwapValue } from 'fum_library';
import { retryExternalService } from '../RetryHelper.js';
import ERC20ABI from '@openzeppelin/contracts/build/contracts/ERC20.json' assert { type: 'json' };
import BabyStepsStrategyFactory from './babySteps/BabyStepsStrategyFactory.js';

// Permit2 address is a constant (same on all chains)
const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3';

/**
 * @class BabyStepsStrategy
 * @memberof module:BabyStepsStrategy
 * @description Baby Steps Strategy implementation for simplified automated liquidity management.
 * Extends StrategyBase to provide single-position management with automated rebalancing
 * based on price boundaries and fee collection triggers.
 * @extends StrategyBase
 * @since 1.0.0
 */
class BabyStepsStrategy extends StrategyBase {
  /**
   * Creates an instance of BabyStepsStrategy
   * @memberof module:BabyStepsStrategy.BabyStepsStrategy
   * @param {Object} dependencies - Strategy dependencies
   * @param {Object} dependencies.vaultDataService - VaultDataService for accessing vault data
   * @param {Object} dependencies.eventManager - EventManager for handling events
   * @param {ethers.Provider} dependencies.provider - Blockchain provider
   * @param {boolean} dependencies.debug - Debug logging enabled
   * @param {number} dependencies.chainId - Chain ID for operations
   * @param {Object} dependencies.automationService - Automation service for coordination
   * @param {Object} dependencies.vaultLocks - Vault locking system reference
   * @since 1.0.0
   */
  constructor(dependencies) {
    super(dependencies);
    this.type = "bob";
    this.name = "Baby Steps Strategy";

    // Load strategy configuration
    this.config = getStrategyDetails(this.type);

    // Transaction deadline for all automation operations (1 minute)
    this.TRANSACTION_DEADLINE_SECONDS = 60;

    // Cache for optimal pools by token pair
    this.bestPoolCache = {};

    // Tracking for last position check
    this.lastPositionCheck = {};

    // Failure tracking for rebalance operations
    this.rebalanceFailures = {}; // { [vaultAddress]: { count, lastAttempt } }

    // Emergency exit baseline cache - stores original tick for each vault
    // Used to track price movements from position creation point
    this.emergencyExitBaseline = {};

    // Set up event listeners for emergency exit baseline caching
    this.setupEmergencyExitBaselineListeners();

    // Removed local eventFilters object - now using EventManager
  }

  //#region Position Evaluation & Management
  /**
   * Initialize a vault to align with the Baby Steps strategy
   * @memberof module:BabyStepsStrategy.BabyStepsStrategy
   * @param {Object} vault - Vault object with current state and configuration
   * @param {string} vault.address - Vault contract address
   * @param {Object} vault.strategy - Strategy configuration
   * @param {Array<string>} vault.targetTokens - Target token symbols
   * @param {Array<string>} vault.targetPlatforms - Target platforms
   * @param {Object} params - Strategy parameters
   * @param {number} params.maxUtilization - Maximum capital utilization percentage
   * @returns {Promise<boolean>} Success status
   * @throws {Error} If vault data is invalid or initialization fails
   * @example
   * const success = await strategy.initializeVaultStrategy(vault, {
   *   maxUtilization: 90,
   *   targetRangeUpper: 10,
   *   targetRangeLower: 10
   * });
   * @since 1.0.0
   */
  async initializeVaultStrategy(vault) {

    if (!vault || !vault.address) {
      throw new Error("Invalid vault data provided for initialization");
    }

    try {
      // Step 1: Evaluate which positions are aligned with strategy
      const evaluation = await this.evaluateInitialPositions(vault);

      // Step 2: Close all non-aligned positions as a batch
      if (Object.keys(evaluation.nonAlignedPositions).length > 0) {
        const { receipt, positionMetadata } = await this.closePositions(vault, evaluation.nonAlignedPositions);

        // Extract fees from closure events
        const feesByPosition = this.extractFeesFromClosureEvents(receipt, positionMetadata);

        // Calculate total fees collected across all closed positions
        let totalToken0Fees = ethers.BigNumber.from(0);
        let totalToken1Fees = ethers.BigNumber.from(0);
        let token0Data = null;
        let token1Data = null;

        for (const fees of Object.values(feesByPosition)) {
          totalToken0Fees = totalToken0Fees.add(fees.token0);
          totalToken1Fees = totalToken1Fees.add(fees.token1);
          // Get token data from first position (all should be same in BabySteps)
          if (!token0Data) {
            token0Data = fees.metadata.token0Data;
            token1Data = fees.metadata.token1Data;
          }
        }

        // Distribute fees to owner if any were collected
        if ((totalToken0Fees.gt(0) || totalToken1Fees.gt(0)) && token0Data && token1Data) {
          const token0Formatted = parseFloat(ethers.utils.formatUnits(totalToken0Fees, token0Data.decimals));
          const token1Formatted = parseFloat(ethers.utils.formatUnits(totalToken1Fees, token1Data.decimals));
          this.log(`Total fees collected during initialization: ${token0Formatted} ${token0Data.symbol}, ${token1Formatted} ${token1Data.symbol}`);

          // Distribute to owner
          const distribution = await this.distributeFeesToOwner(
            vault,
            totalToken0Fees,
            totalToken1Fees,
            token0Data,
            token1Data,
            'initialization'
          );

          // Get current USD prices for event
          const prices = await fetchTokenPrices(
            [token0Data.symbol, token1Data.symbol],
            CACHE_DURATIONS['30-SECONDS']
          );

          const token0USD = token0Formatted * prices[token0Data.symbol.toUpperCase()];
          const token1USD = token1Formatted * prices[token1Data.symbol.toUpperCase()];
          const totalUSD = token0USD + token1USD;

          // Emit FeesCollected event for initialization
          this.eventManager.emit('FeesCollected', {
            vaultAddress: vault.address,
            positionId: Object.keys(evaluation.nonAlignedPositions).join(','), // Multiple positions
            source: 'initialization',
            token0Collected: token0Formatted,
            token1Collected: token1Formatted,
            token0Symbol: token0Data.symbol,
            token1Symbol: token1Data.symbol,
            token0USD,
            token1USD,
            totalUSD,
            token0ToOwner: parseFloat(ethers.utils.formatUnits(distribution.token0ToOwner, token0Data.decimals)),
            token1ToOwner: parseFloat(ethers.utils.formatUnits(distribution.token1ToOwner, token1Data.decimals)),
            token0Reinvested: parseFloat(ethers.utils.formatUnits(distribution.token0Reinvested, token0Data.decimals)),
            token1Reinvested: parseFloat(ethers.utils.formatUnits(distribution.token1Reinvested, token1Data.decimals)),
            reinvestmentRatio: distribution.reinvestmentRatio,
            transactionHash: receipt.transactionHash,
            timestamp: Date.now(),
            log: {
              level: 'info',
              message: `💰 Collected $${totalUSD.toFixed(2)} in fees during initialization (${distribution.reinvestmentRatio}% reinvested)`,
              includeData: true
            }
          });
        }
      }

      // Step 3: Refresh token balances with all configured tokens

      vault.tokens = await this.vaultDataService.fetchTokenBalances(
        vault.address,
        Object.keys(this.tokens)
      );


      // Step 4: Calculate available deployment using helper method
      const { availableDeployment, assetValues } = await this.calculateAvailableDeployment(vault);

      // Step 5: Deploy available capital
      if (availableDeployment > 0) {
        if (Object.keys(evaluation.alignedPositions).length > 0) {
          // We have an aligned position - add liquidity to it
          const position = Object.values(evaluation.alignedPositions)[0]; // BabySteps only allows 1 position
          await this.addToPosition(vault, position, assetValues, availableDeployment);
        } else {
          // No aligned positions - create a new one (will set targetPool internally)
          await this.createNewPosition(vault, availableDeployment, assetValues);
        }
      } else {
        // availableDeployment <= 0
        if (assetValues.totalVaultValue === 0) {
          throw new Error(`Empty vault cannot be managed: no tokens or positions (vault: ${vault.address})`);
        } else {
          // Over-utilized or at max utilization - this is OK, let it run
          this.log('No available capital to deploy (at or above max utilization)');
        }
      }

    } catch (error) {
      this.log(`Error initializing vault for Baby Steps strategy: ${error.message}`);
      throw error;
    }
  }
  /**
   * Evaluate which positions are aligned with the strategy based on tokens and platforms
   * @memberof module:BabyStepsStrategy.BabyStepsStrategy
   * @param {Object} vault - Vault object containing positions and configuration
   * @param {string} vault.address - Vault contract address
   * @param {Object} vault.positions - Vault positions keyed by position ID
   * @param {Array<string>} vault.targetTokens - Target token symbols for strategy
   * @param {Array<string>} vault.targetPlatforms - Target platforms for strategy
   * @param {Object} vault.strategy - Strategy configuration
   * @param {Object} vault.strategy.parameters - Strategy parameters
   * @returns {Promise<Object>} Evaluation results
   * @returns {Object} returns.alignedPositions - Positions aligned with strategy
   * @returns {Object} returns.nonAlignedPositions - Positions not aligned with strategy
   * @since 1.0.0
   */
  async evaluateInitialPositions(vault) {
    // Extract what we need from vault
    const { positions, targetTokens, targetPlatforms, strategy, address } = vault;
    const parameters = strategy.parameters;

    const alignedPositions = {};
    const nonAlignedPositions = {};

    // First do basic token/platform alignment check
    const basicAlignedPositions = {};
    for (const [positionId, position] of Object.entries(positions)) {
      // Get pool metadata from cache
      const poolMetadata = this.poolData[position.pool];
      if (!poolMetadata) {
        throw new Error(`Position ${positionId} missing pool metadata for ${position.pool} - this indicates a cache consistency failure`);
      }

      // Extract token symbols and platform from pool metadata
      const token0Symbol = poolMetadata.token0Symbol;
      const token1Symbol = poolMetadata.token1Symbol;
      const positionPlatform = poolMetadata.platform;

      // Check token alignment - both tokens must be in target tokens
      const tokensAligned = targetTokens.includes(token0Symbol) && targetTokens.includes(token1Symbol);

      // Check platform alignment
      const platformAligned = positionPlatform && targetPlatforms.includes(positionPlatform);

      // Position is aligned only if both tokens and platform are aligned
      if (tokensAligned && platformAligned) {
        basicAlignedPositions[positionId] = position;
        this.log(`Position ${positionId} basic alignment: ${token0Symbol}/${token1Symbol} on ${positionPlatform}`);
      } else {
        nonAlignedPositions[positionId] = position;
        this.log(`Position ${positionId} not aligned: ${token0Symbol}/${token1Symbol} on ${positionPlatform} (tokens: ${tokensAligned}, platform: ${platformAligned})`);
      }
    }

    // If no positions passed basic alignment, emit event and return early
    if (Object.keys(basicAlignedPositions).length === 0) {
      // Emit event with evaluation results
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

      return {
        alignedPositions,
        nonAlignedPositions
      };
    }

    // First collect current ticks for all relevant pools
    const poolTicks = new Map();
    for (const position of Object.values(basicAlignedPositions)) {
      if (!position.pool) {
        throw new Error(`Position ${position.id} missing required pool address`);
      }
      if (poolTicks.has(position.pool)) continue;

      try {
        // Get pool metadata from cache
        const poolMetadata = this.poolData[position.pool];
        if (!poolMetadata) {
          throw new Error(`Missing pool metadata for ${position.pool}`);
        }
        if (!poolMetadata.platform) {
          throw new Error(`Pool metadata for ${position.pool} missing platform identifier`);
        }

        // Get cached adapter from service
        const adapter = this.adapters.get(poolMetadata.platform);
        if (!adapter) {
          throw new Error(`No adapter available for platform ${poolMetadata.platform}`);
        }

        // Use platform-agnostic getCurrentTick method
        const currentTick = await adapter.getCurrentTick(position.pool, this.provider);
        poolTicks.set(position.pool, currentTick);
        this.log(`Current tick for pool ${position.pool}: ${currentTick}`);
      } catch (error) {
        throw new Error(`Failed to get current tick for pool ${position.pool}: ${error.message}`);
      }
    }

    // Now evaluate each position based on range and threshold
    let rangeAlignedPositions = {};
    for (const position of Object.values(basicAlignedPositions)) {
      // Validate required position data
      if (!position.tickLower || !position.tickUpper) {
        throw new Error(`Position ${position.id} missing required tick range data: tickLower=${position.tickLower}, tickUpper=${position.tickUpper}`);
      }
      if (!position.pool) {
        throw new Error(`Position ${position.id} missing required pool address`);
      }

      // Get current tick for this position's pool
      const currentTick = poolTicks.get(position.pool);
      if (currentTick === undefined) {
        throw new Error(`Missing current tick data for pool ${position.pool} - tick collection failed`);
      }

      // Check if position is in range
      const isInRange = currentTick >= position.tickLower && currentTick <= position.tickUpper;

      if (!isInRange) {
        this.log(`Position ${position.id} is out of range: currentTick=${currentTick}, range=${position.tickLower}-${position.tickUpper}`);
        nonAlignedPositions[position.id] = position;
        continue;
      }

      // Check distance to boundaries (similar to rebalance threshold logic)
      const rangeSize = position.tickUpper - position.tickLower;

      // Calculate distance to upper and lower bounds as percentage of range
      const distanceToUpper = position.tickUpper - currentTick;
      const distanceToLower = currentTick - position.tickLower;

      const upperPercentage = distanceToUpper / rangeSize;
      const lowerPercentage = distanceToLower / rangeSize;

      // Use the strategy's threshold parameters - convert from percentage to decimal
      const upperThreshold = parameters.rebalanceThresholdUpper / 100;
      const lowerThreshold = parameters.rebalanceThresholdLower / 100;

      // If too close to boundaries, consider non-aligned
      if (upperPercentage <= upperThreshold || lowerPercentage <= lowerThreshold) {
        this.log(`Position ${position.id} is too close to range boundaries`);
        this.log(`Upper distance: ${upperPercentage.toFixed(4)}, threshold: ${upperThreshold.toFixed(4)}`);
        this.log(`Lower distance: ${lowerPercentage.toFixed(4)}, threshold: ${lowerThreshold.toFixed(4)}`);
        nonAlignedPositions[position.id] = position;
      } else {
        // Position passes all criteria so far - it's properly aligned with the strategy range & thresholds
        rangeAlignedPositions[position.id] = position;
        this.log(`Position ${position.id} is aligned with strategy parameters`);
      }
    }

    // Now validate pool criteria for all range-aligned positions

    const poolValidatedPositions = {};
    for (const [positionId, position] of Object.entries(rangeAlignedPositions)) {
      try {
        const isPoolValid = await this.validatePoolCriteria(position.pool);
        if (isPoolValid) {
          poolValidatedPositions[positionId] = position;
          this.log(`Position ${positionId} pool ${position.pool} meets all criteria`);
        } else {
          nonAlignedPositions[positionId] = position;
          this.log(`Position ${positionId} pool ${position.pool} failed criteria validation`);
        }
      } catch (error) {
        // Infrastructure/configuration errors should bubble up for retry
        this.log(`Critical pool validation failure for vault ${address}, position ${positionId}: ${error.message}`);
        throw new Error(`Pool validation failed for position ${positionId} in vault ${address}: ${error.message}`);
      }
    }


    // Check if we have more aligned positions than allowed by strategy
    const maxPositions = this.config.maxPositions;
    if (Object.keys(poolValidatedPositions).length > maxPositions) {
      this.log(`Found ${Object.keys(poolValidatedPositions).length} aligned positions, but strategy only allows ${maxPositions}`);

      // Sort positions by how centered the current price is within the range
      const sortedPositions = Object.values(poolValidatedPositions).sort((a, b) => {
        // Get current ticks for the positions (guaranteed to exist due to fail-fast validation)
        const currentTickA = poolTicks.get(a.pool);
        const currentTickB = poolTicks.get(b.pool);

        // Calculate how centered each position is (0.5 = perfectly centered)
        const rangeA = a.tickUpper - a.tickLower;
        const rangeB = b.tickUpper - b.tickLower;

        const centerednessA = (currentTickA - a.tickLower) / rangeA;
        const centerednessB = (currentTickB - b.tickLower) / rangeB;

        // Calculate how far each position is from being perfectly centered (0.5)
        const distanceFromCenterA = Math.abs(centerednessA - 0.5);
        const distanceFromCenterB = Math.abs(centerednessB - 0.5);

        // Sort by closest to center (ascending distance from 0.5)
        return distanceFromCenterA - distanceFromCenterB;
      });

      // Keep only the positions within the limit
      const positionsToKeep = sortedPositions.slice(0, maxPositions);
      const extraPositions = sortedPositions.slice(maxPositions);

      // Log details about position selection for debugging
      this.log(`Keeping ${positionsToKeep.length} positions within limit, moving ${extraPositions.length} to non-aligned`);

      sortedPositions.forEach((position, index) => {
        const currentTick = poolTicks.get(position.pool);
        const range = position.tickUpper - position.tickLower;
        const centeredness = (currentTick - position.tickLower) / range;
        const isKept = index < maxPositions;

        this.log(`Position ${position.id}: centeredness=${centeredness.toFixed(4)}, ` +
                 `range=${range}, current=${currentTick}, ` +
                 `bounds=${position.tickLower}-${position.tickUpper}, ` +
                 `status=${isKept ? 'KEPT' : 'DROPPED'}`);
      });

      // Add extra positions to non-aligned list (convert array to object)
      const extraPositionsObj = extraPositions.reduce((obj, pos) => {
        obj[pos.id] = pos;
        return obj;
      }, {});

      Object.assign(nonAlignedPositions, extraPositionsObj);

      // Update aligned positions list (convert array back to object)
      Object.assign(alignedPositions, positionsToKeep.reduce((obj, pos) => {
        obj[pos.id] = pos;
        return obj;
      }, {}));
    } else {
      // All pool-validated positions fit within the limit
      Object.assign(alignedPositions, poolValidatedPositions);
    }

    // Emit event with evaluation results
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

    return {
      alignedPositions,
      nonAlignedPositions
    };
  }

  /**
   * Add liquidity to an existing aligned position
   * @memberof module:BabyStepsStrategy.BabyStepsStrategy
   * @param {Object} vault - Vault object
   * @param {Object} position - Position object from evaluation
   * @param {Object} assetValues - Complete asset values from fetchAssetValues
   * @param {number} availableDeployment - USD amount available to deploy
   * @returns {Promise<void>}
   * @since 1.0.0
   */
  async addToPosition(vault, position, assetValues, availableDeployment) {
    try {
      // Validate availableDeployment
      if (!availableDeployment || availableDeployment <= 0 || !Number.isFinite(availableDeployment)) {
        throw new Error(`Invalid availableDeployment: ${availableDeployment}. Must be a positive finite number.`);
      }

      this.log(`Adding liquidity to position ${position.id} with $${availableDeployment.toFixed(2)} available`);

      // Get pool metadata and token configs
      const poolMetadata = this.poolData[position.pool];
      const poolState = assetValues.poolData[position.pool];
      const platformId = this.poolData[position.pool].platform;

      // Get token data using pool metadata since position object doesn't have token symbols
      const token0Data = this.tokens[poolMetadata.token0Symbol];
      const token1Data = this.tokens[poolMetadata.token1Symbol];

      // Get position values, prices, and pool data from assetValues
      const positionValues = assetValues.positions[position.id];

      const token0Price = assetValues.tokens[token0Data.symbol].price;
      const token1Price = assetValues.tokens[token1Data.symbol].price;

      // Get current position token amounts (raw amounts from adapter)
      const token0RawAmount = BigInt(positionValues.token0Amount);
      const token1RawAmount = BigInt(positionValues.token1Amount);

      // Convert to decimal amounts for ratio calculation
      const token0DecimalAmount = Number(ethers.utils.formatUnits(token0RawAmount, token0Data.decimals));
      const token1DecimalAmount = Number(ethers.utils.formatUnits(token1RawAmount, token1Data.decimals));

      // Calculate USD values for each token in the position
      const token0ValueUSD = token0DecimalAmount * token0Price;
      const token1ValueUSD = token1DecimalAmount * token1Price;

      // Calculate current position VALUE ratio (not token amount ratio)
      const positionValueRatio = token0ValueUSD / token1ValueUSD;

      this.log(`Position amounts: ${token0DecimalAmount.toFixed(4)} ${token0Data.symbol} ($${token0ValueUSD.toFixed(2)}) : ${token1DecimalAmount.toFixed(4)} ${token1Data.symbol} ($${token1ValueUSD.toFixed(2)})`);
      this.log(`Position value ratio: ${positionValueRatio.toFixed(4)} (${(positionValueRatio / (1 + positionValueRatio) * 100).toFixed(1)}% ${token0Data.symbol} : ${(1 / (1 + positionValueRatio) * 100).toFixed(1)}% ${token1Data.symbol})`);

      // Calculate how much of token0 to use as input based on VALUE ratio
      // If value ratio is 0.88 (47% WETH : 53% USDC), we allocate 47% of budget to WETH
      const token0Share = availableDeployment * (positionValueRatio / (1 + positionValueRatio));

      // Convert USD amount to raw token amount (use toFixed to prevent scientific notation)
      const token0InputDecimal = token0Share / token0Price;

      const token0InputAmount = ethers.utils.parseUnits(
        token0InputDecimal.toFixed(token0Data.decimals),
        token0Data.decimals
      );

      this.log(`Allocating $${token0Share.toFixed(2)} to ${token0Data.symbol}: ${token0InputDecimal.toFixed(6)} ${token0Data.symbol} at $${token0Price.toFixed(2)}`);

      // Get adapter and call getAddLiquidityQuote
      const adapter = this.adapters.get(platformId);
      const quote = await adapter.getAddLiquidityQuote({
        position,
        token0Amount: token0InputAmount.toString(),
        token1Amount: "0", // Let SDK calculate optimal token1 amount
        provider: this.provider,
        poolData: poolState,
        token0Data,
        token1Data
      });

      // Access amounts from CurrencyAmount objects using .quotient property
      const amount0 = quote.position.amount0.quotient.toString();
      const amount1 = quote.position.amount1.quotient.toString();

      this.log(`Quote calculated: position will use ${ethers.utils.formatUnits(amount0, token0Data.decimals)} ${token0Data.symbol} and ${ethers.utils.formatUnits(amount1, token1Data.decimals)} ${token1Data.symbol}`);

      // Prepare tokens & swap if needed to meet requirements
      const tokenPrep = await this.prepareTokensForPosition(vault, quote, token0Data, token1Data, platformId);

      // Execute deficit swaps if needed
      if (tokenPrep && tokenPrep.swaps.length > 0) {
        // Execute swaps and wait for completion
        const txResult = await this.executeBatchTransactions(vault, tokenPrep.swaps, 'deficit covering swaps', 'swap');

        // Extract actual swap amounts from receipt
        const actualSwaps = this.extractSwapAmountsFromReceipt(txResult.receipt, tokenPrep.metadata);

        // Build complete swap details
        const swapDetails = this.buildSwapDetails(tokenPrep.metadata, actualSwaps);

        // Emit TokensSwapped event
        this.eventManager.emit('TokensSwapped', {
          vaultAddress: vault.address,
          swapCount: swapDetails.length,
          swapType: 'deficit_coverage',
          swaps: swapDetails,
          gasUsed: txResult.receipt.gasUsed.toString(),
          gasEstimated: txResult.gasEstimated,
          effectiveGasPrice: txResult.receipt.effectiveGasPrice.toString(),
          transactionHash: txResult.receipt.transactionHash,
          success: true,
          timestamp: Date.now()
        });

        // Refresh token balances after swaps
        vault.tokens = await this.vaultDataService.fetchTokenBalances(
          vault.address,
          Object.keys(this.tokens)
        );
      }

      // Step 2: Execute 50/50 buffer swaps to prevent insufficient balance errors
      try {
        // Get current token balances
        const currentBalances = {};
        for (const symbol of Object.keys(this.tokens)) {
          currentBalances[symbol] = BigInt(vault.tokens[symbol]);
        }

        // Identify non-aligned tokens
        const nonAlignedTokens = Object.keys(this.tokens).filter(symbol =>
          symbol !== token0Data.symbol && symbol !== token1Data.symbol
        );

        const bufferSwaps = await this.swapRemainingTokens5050(
          adapter,
          nonAlignedTokens,
          currentBalances,
          token0Data,
          token1Data,
          assetValues,
          vault,
          platformId
        );

        if (bufferSwaps.swaps.length > 0) {
          this.log(`Executing ${bufferSwaps.swaps.length} buffer swaps to ensure sufficient balances`);

          // Execute swaps (no approvals needed with Permit2)
          const txResult = await this.executeBatchTransactions(vault, bufferSwaps.swaps, 'buffer swaps', 'swap');

          // Extract actual swap amounts from receipt
          const actualSwaps = this.extractSwapAmountsFromReceipt(txResult.receipt, bufferSwaps.metadata);

          // Build complete swap details
          const swapDetails = this.buildSwapDetails(bufferSwaps.metadata, actualSwaps);

          // Emit TokensSwapped event
          this.eventManager.emit('TokensSwapped', {
            vaultAddress: vault.address,
            swapCount: swapDetails.length,
            swapType: 'buffer_5050',
            swaps: swapDetails,
            gasUsed: txResult.receipt.gasUsed.toString(),
            gasEstimated: txResult.gasEstimated,
            effectiveGasPrice: txResult.receipt.effectiveGasPrice.toString(),
            transactionHash: txResult.receipt.transactionHash,
            success: true,
            timestamp: Date.now()
          });

          // Refresh token balances after swaps
          vault.tokens = await this.vaultDataService.fetchTokenBalances(
            vault.address,
            Object.keys(this.tokens)
          );
        } else {
          this.log('No remaining tokens available for buffer swaps');
        }
      } catch (bufferError) {
        this.log(`Buffer swap failed: ${bufferError.message}`);
        // Continue but balance verification may fail
      }

      // Step 3: Verify final token balances (should pass thanks to buffer swaps)
      const finalToken0 = BigInt(vault.tokens[token0Data.symbol]);
      const finalToken1 = BigInt(vault.tokens[token1Data.symbol]);
      const requiredToken0 = BigInt(quote.position.amount0.quotient.toString());
      const requiredToken1 = BigInt(quote.position.amount1.quotient.toString());

      // Use 0.1% tolerance
      const token0Tolerance = requiredToken0 / 1000n;
      const token1Tolerance = requiredToken1 / 1000n;

      this.log(`Final pre liquidity addition token0 balance check: have ${ethers.utils.formatUnits(finalToken0, token0Data.decimals)}, need ${ethers.utils.formatUnits(requiredToken0, token0Data.decimals)}, sufficient: ${finalToken0 + token0Tolerance >= requiredToken0}`);
      this.log(`Final pre liquidity addition token1 balance check: have ${ethers.utils.formatUnits(finalToken1, token1Data.decimals)}, need ${ethers.utils.formatUnits(requiredToken1, token1Data.decimals)}, sufficient: ${finalToken1 + token1Tolerance >= requiredToken1}`);

      if (finalToken0 + token0Tolerance < requiredToken0) {
        throw new Error(`Insufficient ${token0Data.symbol} even after buffer swaps: have ${ethers.utils.formatUnits(finalToken0, token0Data.decimals)}, need ${ethers.utils.formatUnits(requiredToken0, token0Data.decimals)}`);
      }
      if (finalToken1 + token1Tolerance < requiredToken1) {
        throw new Error(`Insufficient ${token1Data.symbol} even after buffer swaps: have ${ethers.utils.formatUnits(finalToken1, token1Data.decimals)}, need ${ethers.utils.formatUnits(requiredToken1, token1Data.decimals)}`);
      }

      // Step 4: Execute add liquidity transaction
      const addLiquidityData = await adapter.generateAddLiquidityData({
        position,
        token0Amount: quote.position.amount0.quotient.toString(),
        token1Amount: quote.position.amount1.quotient.toString(),
        provider: this.provider,
        poolData: poolState,
        token0Data,
        token1Data,
        slippageTolerance: vault.strategy.parameters.maxSlippage,
        deadlineMinutes: this.config.strategyProperties.transactionDeadlineSeconds / 60,
        sqrtPriceLimitX96: '0'
      });

      // Generate token approvals for the position manager
      const approvalTransactions = [];
      const positionManagerAddress = addLiquidityData.to;

      // Approve token0 if amount > 0
      const token0Amount = quote.position.amount0.quotient.toString();
      if (BigInt(token0Amount) > 0n) {
        const token0Approval = this.generateApprovalTransaction(
          token0Data.address,
          positionManagerAddress,
          token0Amount,
          token0Data.symbol,
          vault.address
        );
        approvalTransactions.push(token0Approval);
      }

      // Approve token1 if amount > 0
      const token1Amount = quote.position.amount1.quotient.toString();
      if (BigInt(token1Amount) > 0n) {
        const token1Approval = this.generateApprovalTransaction(
          token1Data.address,
          positionManagerAddress,
          token1Amount,
          token1Data.symbol,
          vault.address
        );
        approvalTransactions.push(token1Approval);
      }

      // Execute approvals first if any
      if (approvalTransactions.length > 0) {
        this.log(`Executing ${approvalTransactions.length} token approvals for add liquidity`);
        await this.executeBatchTransactions(vault, approvalTransactions, 'add liquidity approvals', 'approval');
      }

      this.log(`Executing add liquidity transaction for position ${position.id}`);
      const txResult = await this.executeBatchTransactions(vault, [addLiquidityData], 'add liquidity', 'addliq');

      // Extract actual amounts from receipt events
      const receiptData = this.extractPositionAmountsFromReceipt(txResult.receipt);

      // Final state update - refresh vault with ALL token balances and positions
      await this.vaultDataService.refreshPositionsAndTokens(vault.address);
      vault = await this.vaultDataService.getVault(vault.address);

      // Get all non-aligned token balances
      const nonAlignedBalances = {};
      for (const [symbol, balance] of Object.entries(vault.tokens)) {
        if (symbol !== token0Data.symbol && symbol !== token1Data.symbol) {
          nonAlignedBalances[symbol] = balance.toString();
        }
      }

      // Calculate total vault value for utilization tracking
      // Use long cache duration - prices were fetched earlier for sizing, tracking doesn't need fresh data
      const finalAssetValues = await this.vaultDataService.fetchAssetValues(vault, CACHE_DURATIONS['10-MINUTES']);

      // Emit comprehensive position update event
      this.eventManager.emit('LiquidityAddedToPosition', {
        vaultAddress: vault.address,
        positionId: position.id,
        poolAddress: position.pool,

        // Quoted amounts (from quote - what we expected)
        quotedToken0: requiredToken0.toString(),
        quotedToken1: requiredToken1.toString(),

        // Actual amounts (from receipt - what was consumed)
        actualToken0: receiptData.actualToken0,
        actualToken1: receiptData.actualToken1,

        // Final vault state
        finalToken0Balance: vault.tokens[token0Data.symbol].toString(),
        finalToken1Balance: vault.tokens[token1Data.symbol].toString(),
        nonAlignedBalances,
        totalVaultValue: finalAssetValues.totalVaultValue,
        totalPositionValue: finalAssetValues.totalPositionValue,

        // Position details (updated liquidity from receipt)
        tickLower: position.tickLower,
        tickUpper: position.tickUpper,
        currentTick: poolState.tick,
        liquidity: receiptData.liquidity,

        // Transaction details
        transactionHash: txResult.receipt.transactionHash,
        blockNumber: txResult.receipt.blockNumber,
        gasUsed: txResult.receipt.gasUsed.toString(),
        gasEstimated: txResult.gasEstimated,
        effectiveGasPrice: txResult.receipt.effectiveGasPrice.toString(),

        // Strategy context
        deploymentAmount: availableDeployment,
        platform: poolMetadata.platform,
        tokenSymbols: [token0Data.symbol, token1Data.symbol],
        timestamp: Date.now()
      });

      this.log(`Successfully added liquidity to position ${position.id}`);
      this.log(`Used: ${ethers.utils.formatUnits(requiredToken0, token0Data.decimals)} ${token0Data.symbol}, ${ethers.utils.formatUnits(requiredToken1, token1Data.decimals)} ${token1Data.symbol}`)

    } catch (error) {
      throw new Error(`Failed to add liquidity to position ${position.id}: ${error.message}`);
    }
  }

  /**
   * Create a new position for the vault
   * @memberof module:BabyStepsStrategy.BabyStepsStrategy
   * @param {Object} vault - Vault object
   * @param {Object} alignedTokens - Aligned token balances
   * @param {Array<string>} nonAlignedTokens - Non-aligned token symbols
   * @param {number} availableDeployment - USD amount available to deploy
   * @param {Object} assetValues - Complete asset values from fetchAssetValues
   * @returns {Promise<void>}
   * @since 1.0.0
   */
  async createNewPosition(vault, availableDeployment, assetValues) {
    try {
      // Validate availableDeployment
      if (!availableDeployment || availableDeployment <= 0 || !Number.isFinite(availableDeployment)) {
        throw new Error(`Invalid availableDeployment: ${availableDeployment}. Must be a positive finite number.`);
      }

      this.log(`Creating new position for vault ${vault.address} with $${availableDeployment.toFixed(2)} available`);

      // 1. Get adapter
      const platformId = vault.targetPlatforms[0];
      const adapter = this.adapters.get(platformId);
      if(!adapter) {
        throw new Error(`Failed to get ${platformId}`);
      }

      // 2. Select optimal pool
      const [targetToken0Symbol, targetToken1Symbol] = vault.targetTokens;

      // Get token data and sort them according to Uniswap's ordering BEFORE selecting pool
      const unsortedToken0Data = this.tokens[targetToken0Symbol];
      const unsortedToken1Data = this.tokens[targetToken1Symbol];

      // Use adapter's sortTokens to get proper ordering
      const { sortedToken0, sortedToken1 } = adapter.sortTokens(unsortedToken0Data, unsortedToken1Data);
      const token0Data = sortedToken0;
      const token1Data = sortedToken1;

      const pool = await this.selectOptimalPool(
        token0Data.symbol,
        token1Data.symbol,
        adapter
      );


      // 3. Calculate position range using the library helper
      const { tickLower, tickUpper } = adapter.calculateTickRangeFromPercentages(
        Number(pool.tick),
        vault.strategy.parameters.targetRangeUpper,
        vault.strategy.parameters.targetRangeLower,
        pool.fee
      );

      // 4. Get initial quote (no position.id for new positions)
      const position = { tickLower, tickUpper };

      // Calculate initial token amounts using two-step quote process
      const token0Price = assetValues.tokens[token0Data.symbol].price;
      const token1Price = assetValues.tokens[token1Data.symbol].price;

      // Get optimal ratio with small test quote
      const testAmount = ethers.utils.parseUnits("1", token0Data.decimals); // 1 token0
      const testQuote = await adapter.getAddLiquidityQuote({
        position,
        token0Amount: testAmount.toString(),
        token1Amount: "0", // Let SDK calculate optimal token1 amount
        provider: this.provider,
        poolData: { ...pool, tick: Number(pool.tick) },
        token0Data,
        token1Data
      });

      // Calculate ratio from test quote using VALUE instead of token amounts
      const testToken0 = Number(ethers.utils.formatUnits(testQuote.position.amount0.quotient.toString(), token0Data.decimals));
      const testToken1 = Number(ethers.utils.formatUnits(testQuote.position.amount1.quotient.toString(), token1Data.decimals));

      // Calculate VALUE ratio, not token amount ratio
      const testToken0ValueUSD = testToken0 * token0Price;
      const testToken1ValueUSD = testToken1 * token1Price;
      const optimalRatio = testToken0ValueUSD / testToken1ValueUSD; // token0:token1 VALUE ratio

      // Split budget using optimal ratio
      const token0Share = availableDeployment / (1 + (1 / optimalRatio));

      // Convert to token amounts (use toFixed to prevent scientific notation)
      const token0Amount = ethers.utils.parseUnits(
        (token0Share / token0Price).toFixed(token0Data.decimals),
        token0Data.decimals
      );

      // Get quote for deficit swaps with proper budget allocation
      const quote1 = await adapter.getAddLiquidityQuote({
        position,
        token0Amount: token0Amount.toString(),
        token1Amount: "0",
        provider: this.provider,
        poolData: { ...pool, tick: Number(pool.tick) },
        token0Data,
        token1Data
      });

      // Emit comprehensive position parameters event
      this.eventManager.emit('PositionParametersCalculated', {
        vaultAddress: vault.address,
        poolAddress: pool.address,
        poolFee: pool.fee,
        poolTick: pool.tick,
        token0Symbol: token0Data.symbol,
        token1Symbol: token1Data.symbol,
        tickLower,
        tickUpper,
        targetRangeUpper: vault.strategy.parameters.targetRangeUpper,
        targetRangeLower: vault.strategy.parameters.targetRangeLower,
        optimalRatio,
        deploymentAmount: availableDeployment,
        token0Amount: token0Amount.toString(),
        finalQuoteToken0: ethers.utils.formatUnits(quote1.position.amount0.quotient.toString(), token0Data.decimals),
        finalQuoteToken1: ethers.utils.formatUnits(quote1.position.amount1.quotient.toString(), token1Data.decimals),
        chainId: this.chainId,
        timestamp: Date.now(),
        log: {
          level: 'info',
          message: `Position parameters calculated for ${token0Data.symbol}/${token1Data.symbol} on ${adapter.platformName} (fee: ${pool.fee}) - range: [${tickLower}, ${tickUpper}], position size: ${ethers.utils.formatUnits(quote1.position.amount0.quotient.toString(), token0Data.decimals)} ${token0Data.symbol}/${ethers.utils.formatUnits(quote1.position.amount1.quotient.toString(), token1Data.decimals)} ${token1Data.symbol}, ratio: ${optimalRatio.toFixed(4)}`,
          includeData: false
        }
      });

      // 5. Handle deficit swaps
      const tokenPrep = await this.prepareTokensForPosition(
        vault,
        quote1,
        token0Data,
        token1Data,
        platformId
      );

      if (tokenPrep && tokenPrep.swaps.length > 0) {
        this.log(`Executing ${tokenPrep.swaps.length} deficit covering swaps`);

        // Execute swaps and wait for completion
        const txResult = await this.executeBatchTransactions(vault, tokenPrep.swaps, 'deficit swaps', 'swap');

        // Extract actual swap amounts from receipt
        const actualSwaps = this.extractSwapAmountsFromReceipt(txResult.receipt, tokenPrep.metadata);

        // Build complete swap details
        const swapDetails = this.buildSwapDetails(tokenPrep.metadata, actualSwaps);

        // Emit TokensSwapped event
        this.eventManager.emit('TokensSwapped', {
          vaultAddress: vault.address,
          swapCount: swapDetails.length,
          swapType: 'deficit_coverage',
          swaps: swapDetails,
          gasUsed: txResult.receipt.gasUsed.toString(),
          gasEstimated: txResult.gasEstimated,
          effectiveGasPrice: txResult.receipt.effectiveGasPrice.toString(),
          transactionHash: txResult.receipt.transactionHash,
          success: true,
          timestamp: Date.now()
        });

        // Refresh token balances after deficit swaps
        vault.tokens = await this.vaultDataService.fetchTokenBalances(
          vault.address,
          Object.keys(this.tokens)
        );
      }

      // 6. Handle 50/50 buffer swaps (continue if fails)
      try {
        // Get current token balances
        const currentBalances = {};
        for (const symbol of Object.keys(this.tokens)) {
          currentBalances[symbol] = BigInt(vault.tokens[symbol]);
        }

        // Identify non-aligned tokens
        const nonAlignedTokens = Object.keys(this.tokens).filter(symbol =>
          symbol !== token0Data.symbol && symbol !== token1Data.symbol
        );

        const bufferSwaps = await this.swapRemainingTokens5050(
          adapter,
          nonAlignedTokens,
          currentBalances,
          token0Data,
          token1Data,
          assetValues,
          vault,
          platformId
        );

        if (bufferSwaps.swaps.length > 0) {
          this.log(`Executing ${bufferSwaps.swaps.length} buffer swaps to ensure sufficient balances`);

          // Execute swaps (no approvals needed with Permit2)
          const txResult = await this.executeBatchTransactions(vault, bufferSwaps.swaps, 'buffer swaps', 'swap');

          // Extract actual swap amounts from receipt
          const actualSwaps = this.extractSwapAmountsFromReceipt(txResult.receipt, bufferSwaps.metadata);

          // Build complete swap details
          const swapDetails = this.buildSwapDetails(bufferSwaps.metadata, actualSwaps);

          // Emit TokensSwapped event
          this.eventManager.emit('TokensSwapped', {
            vaultAddress: vault.address,
            swapCount: swapDetails.length,
            swapType: 'buffer_5050',
            swaps: swapDetails,
            gasUsed: txResult.receipt.gasUsed.toString(),
            gasEstimated: txResult.gasEstimated,
            effectiveGasPrice: txResult.receipt.effectiveGasPrice.toString(),
            transactionHash: txResult.receipt.transactionHash,
            success: true,
            timestamp: Date.now()
          });

          // Refresh token balances after swaps
          vault.tokens = await this.vaultDataService.fetchTokenBalances(
            vault.address,
            Object.keys(this.tokens)
          );
        } else {
          this.log('No remaining tokens available for buffer swaps');
        }
      } catch (bufferError) {
        this.log(`Buffer swaps failed: ${bufferError.message} - continuing`);
        // Continue - buffer swaps are not critical
      }

      // 7: Verify final token balances after all swaps (should pass thanks to buffer swaps)
      try {
        const finalToken0 = BigInt(vault.tokens[token0Data.symbol]);
        const finalToken1 = BigInt(vault.tokens[token1Data.symbol]);
        const requiredToken0 = BigInt(quote1.position.amount0.quotient.toString());
        const requiredToken1 = BigInt(quote1.position.amount1.quotient.toString());

        // Use 0.1% tolerance
        const token0Tolerance = requiredToken0 / 1000n;
        const token1Tolerance = requiredToken1 / 1000n;

        this.log(`Final pre position creation token0 balance check: have ${ethers.utils.formatUnits(finalToken0, token0Data.decimals)}, need ${ethers.utils.formatUnits(requiredToken0, token0Data.decimals)}, sufficient: ${finalToken0 + token0Tolerance >= requiredToken0}`);
        this.log(`Final pre position creation token1 balance check: have ${ethers.utils.formatUnits(finalToken1, token1Data.decimals)}, need ${ethers.utils.formatUnits(requiredToken1, token1Data.decimals)}, sufficient: ${finalToken1 + token1Tolerance >= requiredToken1}`);

        if (finalToken0 + token0Tolerance < requiredToken0) {
          throw new Error(`Insufficient ${token0Data.symbol} for position creation: have ${ethers.utils.formatUnits(finalToken0, token0Data.decimals)}, need ${ethers.utils.formatUnits(requiredToken0, token0Data.decimals)}`);
        }
        if (finalToken1 + token1Tolerance < requiredToken1) {
          throw new Error(`Insufficient ${token1Data.symbol} for position creation: have ${ethers.utils.formatUnits(finalToken1, token1Data.decimals)}, need ${ethers.utils.formatUnits(requiredToken1, token1Data.decimals)}`);
        }

        this.log('✅ Token balance verification passed - sufficient tokens for position creation');
      } catch (error) {
        throw new Error(`Token balance verification failed: ${error.message}`);
      }

      // 8. Generate and execute create position transaction using original quote
      const createTx = await adapter.generateCreatePositionData({
        position,
        token0Amount: quote1.position.amount0.quotient.toString(),
        token1Amount: quote1.position.amount1.quotient.toString(),
        provider: this.provider,
        walletAddress: vault.address,
        poolData: { ...pool, tick: Number(pool.tick) },
        token0Data,
        token1Data,
        slippageTolerance: vault.strategy.parameters.maxSlippage,
        deadlineMinutes: this.config.strategyProperties.transactionDeadlineSeconds / 60
      });

      // Generate token approvals for the position manager
      const approvalTransactions = [];
      const positionManagerAddress = createTx.to;

      // Approve token0 if amount > 0
      const finalToken0Amount = quote1.position.amount0.quotient.toString();
      if (BigInt(finalToken0Amount) > 0n) {
        const token0Approval = this.generateApprovalTransaction(
          token0Data.address,
          positionManagerAddress,
          finalToken0Amount,
          token0Data.symbol,
          vault.address
        );
        approvalTransactions.push(token0Approval);
      }

      // Approve token1 if amount > 0
      const finalToken1Amount = quote1.position.amount1.quotient.toString();
      if (BigInt(finalToken1Amount) > 0n) {
        const token1Approval = this.generateApprovalTransaction(
          token1Data.address,
          positionManagerAddress,
          finalToken1Amount,
          token1Data.symbol,
          vault.address
        );
        approvalTransactions.push(token1Approval);
      }

      // Execute approvals first if any
      if (approvalTransactions.length > 0) {
        this.log(`Executing ${approvalTransactions.length} token approvals for create position`);
        await this.executeBatchTransactions(vault, approvalTransactions, 'create position approvals', 'approval');
      }

      this.log(`Executing create position transaction with amounts: ${ethers.utils.formatUnits(quote1.position.amount0.quotient.toString(), token0Data.decimals)} ${token0Data.symbol}, ${ethers.utils.formatUnits(quote1.position.amount1.quotient.toString(), token1Data.decimals)} ${token1Data.symbol}`);
      const txResult = await this.executeBatchTransactions(vault, [createTx], 'create position', 'mint');

      // Extract actual amounts from receipt events
      const receiptData = this.extractPositionAmountsFromReceipt(txResult.receipt);

      // 9. Refresh vault data (positions and tokens)
      await this.vaultDataService.refreshPositionsAndTokens(vault.address);
      vault = await this.vaultDataService.getVault(vault.address);

      // Get the new position (should be the only position after creation)
      const newPositionId = Object.keys(vault.positions)[0];
      const newPosition = vault.positions[newPositionId];

      // Get all non-aligned token balances
      const nonAlignedBalances = {};
      for (const [symbol, balance] of Object.entries(vault.tokens)) {
        if (symbol !== token0Data.symbol && symbol !== token1Data.symbol) {
          nonAlignedBalances[symbol] = balance.toString();
        }
      }

      // Calculate total vault value for utilization tracking
      // Use long cache duration - prices were fetched earlier for sizing, tracking doesn't need fresh data
      const finalAssetValues = await this.vaultDataService.fetchAssetValues(vault, CACHE_DURATIONS['10-MINUTES']);

      // Emit comprehensive position creation event
      this.eventManager.emit('NewPositionCreated', {
        vaultAddress: vault.address,
        positionId: newPositionId,
        poolAddress: receiptData.poolAddress || pool.address,

        // Quoted amounts (from quote - what we expected)
        quotedToken0: quote1.position.amount0.quotient.toString(),
        quotedToken1: quote1.position.amount1.quotient.toString(),

        // Actual amounts (from receipt - what was consumed)
        actualToken0: receiptData.actualToken0,
        actualToken1: receiptData.actualToken1,

        // Final vault state
        finalToken0Balance: vault.tokens[token0Data.symbol].toString(),
        finalToken1Balance: vault.tokens[token1Data.symbol].toString(),
        nonAlignedBalances,
        totalVaultValue: finalAssetValues.totalVaultValue,
        totalPositionValue: finalAssetValues.totalPositionValue,

        // Position details (from receipt events)
        tickLower: receiptData.tickLower || newPosition.tickLower,
        tickUpper: receiptData.tickUpper || newPosition.tickUpper,
        currentTick: Number(pool.tick),
        liquidity: receiptData.liquidity,

        // Transaction details
        transactionHash: txResult.receipt.transactionHash,
        blockNumber: txResult.receipt.blockNumber,
        gasUsed: txResult.receipt.gasUsed.toString(),
        gasEstimated: txResult.gasEstimated,
        effectiveGasPrice: txResult.receipt.effectiveGasPrice.toString(),

        // Strategy context
        deploymentAmount: availableDeployment,
        platform: platformId,
        tokenSymbols: [token0Data.symbol, token1Data.symbol],
        timestamp: Date.now()
      });

      this.log(`Successfully created new position for vault ${vault.address}`);
      this.log(`Final position amounts: ${ethers.utils.formatUnits(quote1.position.amount0.quotient.toString(), token0Data.decimals)} ${token0Data.symbol}, ${ethers.utils.formatUnits(quote1.position.amount1.quotient.toString(), token1Data.decimals)} ${token1Data.symbol}`);

    } catch (error) {
      throw new Error(`Failed to create new position for vault ${vault.address}: ${error.message}`);
    }
  }

  /**
   * Prepare tokens for position by swapping if needed to meet requirements
   * @memberof module:BabyStepsStrategy.BabyStepsStrategy
   * @param {Object} vault - Vault object
   * @param {Object} quote - Quote from getAddLiquidityQuote
   * @param {Object} token0Data - Token0 configuration
   * @param {Object} token1Data - Token1 configuration
   * @param {Object} poolMetadata - Pool metadata
   * @returns {Promise<void>}
   * @since 1.0.0
   */
  async prepareTokensForPosition(vault, quote, token0Data, token1Data, platformId) {
    try {
      // 1. Calculate required vs available amounts
      const requiredToken0 = BigInt(quote.position.amount0.quotient.toString());
      const requiredToken1 = BigInt(quote.position.amount1.quotient.toString());

      const availableToken0 = BigInt(vault.tokens[token0Data.symbol]);
      const availableToken1 = BigInt(vault.tokens[token1Data.symbol]);

      this.log(`Required: ${ethers.utils.formatUnits(requiredToken0, token0Data.decimals)} ${token0Data.symbol}, ${ethers.utils.formatUnits(requiredToken1, token1Data.decimals)} ${token1Data.symbol}`);
      this.log(`Available: ${ethers.utils.formatUnits(availableToken0, token0Data.decimals)} ${token0Data.symbol}, ${ethers.utils.formatUnits(availableToken1, token1Data.decimals)} ${token1Data.symbol}`);

      // Calculate base deficits (how much more we need)
      const baseToken0Deficit = requiredToken0 > availableToken0 ? requiredToken0 - availableToken0 : 0n;
      const baseToken1Deficit = requiredToken1 > availableToken1 ? requiredToken1 - availableToken1 : 0n;

      // Add 2% buffer to deficits to account for slippage and price impact
      // This ensures we'll have sufficient tokens after swaps complete
      const token0Deficit = baseToken0Deficit > 0n ? (baseToken0Deficit * 102n) / 100n : 0n;
      const token1Deficit = baseToken1Deficit > 0n ? (baseToken1Deficit * 102n) / 100n : 0n;

      if (token0Deficit === 0n && token1Deficit === 0n) {
        this.eventManager.emit('TokenPreparationCompleted', {
          vaultAddress: vault.address,
          strategyId: vault.strategy.strategyId,
          platformId: platformId,
          targetTokens: {
            token0: {
              symbol: token0Data.symbol,
              required: requiredToken0.toString(),
              available: availableToken0.toString(),
              deficit: token0Deficit.toString()
            },
            token1: {
              symbol: token1Data.symbol,
              required: requiredToken1.toString(),
              available: availableToken1.toString(),
              deficit: token1Deficit.toString()
            }
          },
          preparationResult: 'sufficient_tokens',
          swapTransactions: [],
          nonAlignedTokensUsed: [],
          timestamp: Date.now(),
          log: {
            level: 'info',
            message: 'Sufficient tokens available for position creation',
            includeData: false
          }
        });

        return {
          swaps: []
        };
      }

      this.log(`Deficits: ${ethers.utils.formatUnits(token0Deficit, token0Data.decimals)} ${token0Data.symbol}, ${ethers.utils.formatUnits(token1Deficit, token1Data.decimals)} ${token1Data.symbol}`);

      // Get adapter and handler for swap operations
      const adapter = await this.adapters.get(platformId);
      const handler = BabyStepsStrategyFactory.getHandler(platformId, this);
      const swapTransactions = [];
      const swapMetadata = [];

      // Set up nonce tracking for Permit2
      const tokenNonces = new Map();
      const PERMIT2_ABI = ['function allowance(address user, address token, address spender) external view returns (uint160 amount, uint48 expiration, uint48 nonce)'];
      const permit2Contract = new ethers.Contract(PERMIT2_ADDRESS, PERMIT2_ABI, this.provider);

      // Track remaining deficits and balances
      let remainingToken0Deficit = token0Deficit;
      let remainingToken1Deficit = token1Deficit;
      const remainingBalances = {};

      // Get all non-target tokens (tokens that are not token0 or token1) with a balance
      const nonAlignedTokens = Object.keys(vault.tokens).filter(symbol =>
        symbol !== token0Data.symbol && symbol !== token1Data.symbol && vault.tokens[symbol] !== '0'
      );

      this.log(`Non-aligned tokens available: ${nonAlignedTokens.join(', ')}`);

      // Initialize remaining balances for non-aligned tokens
      for (const symbol of nonAlignedTokens) {
        remainingBalances[symbol] = BigInt(vault.tokens[symbol]);
      }

      // Phase 1: Use non-aligned tokens to cover deficits
      for (const tokenSymbol of nonAlignedTokens) {
        const tokenData = this.tokens[tokenSymbol];
        if (!tokenData) {
          throw new Error(`Critical error: Token data not found for configured token ${tokenSymbol}. This indicates a configuration or initialization problem.`);
        }

        // Handle token0 deficit first
        if (!this.isDeficitEffectivelyCovered(remainingToken0Deficit, token0Deficit) && remainingBalances[tokenSymbol] > 0n) {
          // Get or fetch nonce for tokenIn
          let swapNonce;
          if (!tokenNonces.has(tokenData.address)) {
            const allowanceData = await permit2Contract.allowance(vault.address, tokenData.address, handler.adapter.addresses.universalRouterAddress);
            swapNonce = allowanceData.nonce;
          } else {
            swapNonce = tokenNonces.get(tokenData.address);
          }

          const swapResult = await this.handleDeficitSwaps(
            handler,
            tokenData,
            token0Data,
            remainingBalances[tokenSymbol],
            remainingToken0Deficit,
            vault.address,
            vault.strategy.parameters.maxSlippage,
            swapNonce,
            vault
          );

          // Increment nonce for next use
          tokenNonces.set(tokenData.address, swapNonce + 1);

          if (swapResult.transaction) {
            swapTransactions.push(swapResult.transaction);
            swapMetadata.push({
              tokenInSymbol: swapResult.tokenInSymbol,
              tokenOutSymbol: swapResult.tokenOutSymbol,
              quotedAmountIn: swapResult.quotedAmountIn,
              quotedAmountOut: swapResult.quotedAmountOut,
              isAmountIn: swapResult.isAmountIn,
              expectedSwapEvents: swapResult.expectedSwapEvents,
              routes: swapResult.routes
            });
            remainingBalances[tokenSymbol] -= BigInt(swapResult.amountIn);
            remainingToken0Deficit -= BigInt(swapResult.quotedAmountOut);

            this.log(`Swapping ${ethers.utils.formatUnits(swapResult.amountIn, tokenData.decimals)} ${tokenSymbol} → ${ethers.utils.formatUnits(swapResult.amountOut, token0Data.decimals)} ${token0Data.symbol}`);
          }
        }

        // Handle token1 deficit if non-aligned tokens remain
        if (!this.isDeficitEffectivelyCovered(remainingToken1Deficit, token1Deficit) && remainingBalances[tokenSymbol] > 0n) {
          // Get or fetch nonce for tokenIn
          let swapNonce;
          if (!tokenNonces.has(tokenData.address)) {
            const allowanceData = await permit2Contract.allowance(vault.address, tokenData.address, handler.adapter.addresses.universalRouterAddress);
            swapNonce = allowanceData.nonce;
          } else {
            swapNonce = tokenNonces.get(tokenData.address);
          }

          const swapResult = await this.handleDeficitSwaps(
            handler,
            tokenData,
            token1Data,
            remainingBalances[tokenSymbol],
            remainingToken1Deficit,
            vault.address,
            vault.strategy.parameters.maxSlippage,
            swapNonce,
            vault
          );

          // Increment nonce for next use
          tokenNonces.set(tokenData.address, swapNonce + 1);

          if (swapResult.transaction) {
            swapTransactions.push(swapResult.transaction);
            swapMetadata.push({
              tokenInSymbol: swapResult.tokenInSymbol,
              tokenOutSymbol: swapResult.tokenOutSymbol,
              quotedAmountIn: swapResult.quotedAmountIn,
              quotedAmountOut: swapResult.quotedAmountOut,
              isAmountIn: swapResult.isAmountIn,
              expectedSwapEvents: swapResult.expectedSwapEvents,
              routes: swapResult.routes
            });
            remainingBalances[tokenSymbol] -= BigInt(swapResult.amountIn);
            remainingToken1Deficit -= BigInt(swapResult.quotedAmountOut);

            this.log(`Swapping ${ethers.utils.formatUnits(swapResult.amountIn, tokenData.decimals)} ${tokenSymbol} → ${ethers.utils.formatUnits(swapResult.amountOut, token1Data.decimals)} ${token1Data.symbol}`);
          }
        }
      }

      // Phase 2: Use excess target tokens if deficits remain
      if (!this.isDeficitEffectivelyCovered(remainingToken0Deficit, token0Deficit) || !this.isDeficitEffectivelyCovered(remainingToken1Deficit, token1Deficit)) {
        const excessToken0 = availableToken0 > requiredToken0 ? availableToken0 - requiredToken0 : 0n;
        const excessToken1 = availableToken1 > requiredToken1 ? availableToken1 - requiredToken1 : 0n;

        // Use excess token1 to cover token0 deficit
        if (!this.isDeficitEffectivelyCovered(remainingToken0Deficit, token0Deficit) && excessToken1 > 0n) {
          // Get or fetch nonce for tokenIn
          let swapNonce;
          if (!tokenNonces.has(token1Data.address)) {
            const allowanceData = await permit2Contract.allowance(vault.address, token1Data.address, handler.adapter.addresses.universalRouterAddress);
            swapNonce = allowanceData.nonce;
          } else {
            swapNonce = tokenNonces.get(token1Data.address);
          }

          const swapResult = await this.handleDeficitSwaps(
            handler,
            token1Data,
            token0Data,
            excessToken1,
            remainingToken0Deficit,
            vault.address,
            vault.strategy.parameters.maxSlippage,
            swapNonce,
            vault
          );

          // Increment nonce for next use
          tokenNonces.set(token1Data.address, swapNonce + 1);

          if (swapResult.transaction) {
            swapTransactions.push(swapResult.transaction);
            swapMetadata.push({
              tokenInSymbol: swapResult.tokenInSymbol,
              tokenOutSymbol: swapResult.tokenOutSymbol,
              quotedAmountIn: swapResult.quotedAmountIn,
              quotedAmountOut: swapResult.quotedAmountOut,
              isAmountIn: swapResult.isAmountIn,
              expectedSwapEvents: swapResult.expectedSwapEvents,
              routes: swapResult.routes
            });
            remainingToken0Deficit -= BigInt(swapResult.quotedAmountOut);

            this.log(`Swapping excess ${ethers.utils.formatUnits(swapResult.amountIn, token1Data.decimals)} ${token1Data.symbol} → ${ethers.utils.formatUnits(swapResult.amountOut, token0Data.decimals)} ${token0Data.symbol}`);
          }
        }

        // Use excess token0 to cover token1 deficit
        if (!this.isDeficitEffectivelyCovered(remainingToken1Deficit, token1Deficit) && excessToken0 > 0n) {
          // Get or fetch nonce for tokenIn
          let swapNonce;
          if (!tokenNonces.has(token0Data.address)) {
            const allowanceData = await permit2Contract.allowance(vault.address, token0Data.address, handler.adapter.addresses.universalRouterAddress);
            swapNonce = allowanceData.nonce;
          } else {
            swapNonce = tokenNonces.get(token0Data.address);
          }

          const swapResult = await this.handleDeficitSwaps(
            handler,
            token0Data,
            token1Data,
            excessToken0,
            remainingToken1Deficit,
            vault.address,
            vault.strategy.parameters.maxSlippage,
            swapNonce,
            vault
          );

          // Increment nonce for next use
          tokenNonces.set(token0Data.address, swapNonce + 1);

          if (swapResult.transaction) {
            swapTransactions.push(swapResult.transaction);
            swapMetadata.push({
              tokenInSymbol: swapResult.tokenInSymbol,
              tokenOutSymbol: swapResult.tokenOutSymbol,
              quotedAmountIn: swapResult.quotedAmountIn,
              quotedAmountOut: swapResult.quotedAmountOut,
              isAmountIn: swapResult.isAmountIn,
              expectedSwapEvents: swapResult.expectedSwapEvents,
              routes: swapResult.routes
            });
            remainingToken1Deficit -= BigInt(swapResult.quotedAmountOut);

            this.log(`Swapping excess ${ethers.utils.formatUnits(swapResult.amountIn, token0Data.decimals)} ${token0Data.symbol} → ${ethers.utils.formatUnits(swapResult.amountOut, token1Data.decimals)} ${token1Data.symbol}`);
          }
        }
      }

      // Check if we have uncovered deficits that would prevent position creation
      if (!this.isDeficitEffectivelyCovered(remainingToken0Deficit, token0Deficit) ||
          !this.isDeficitEffectivelyCovered(remainingToken1Deficit, token1Deficit)) {
        throw new Error(`Insufficient tokens after swaps: missing ${ethers.utils.formatUnits(remainingToken0Deficit, token0Data.decimals)} ${token0Data.symbol}, ${ethers.utils.formatUnits(remainingToken1Deficit, token1Data.decimals)} ${token1Data.symbol}`);
      }

      if (swapTransactions.length > 0) {
        this.eventManager.emit('TokenPreparationCompleted', {
          vaultAddress: vault.address,
          strategyId: vault.strategy.strategyId,
          platformId: platformId,
          targetTokens: {
            token0: {
              symbol: token0Data.symbol,
              required: requiredToken0.toString(),
              available: availableToken0.toString(),
              deficit: token0Deficit.toString()
            },
            token1: {
              symbol: token1Data.symbol,
              required: requiredToken1.toString(),
              available: availableToken1.toString(),
              deficit: token1Deficit.toString()
            }
          },
          preparationResult: 'swaps_generated',
          swapTransactions: swapTransactions,
          nonAlignedTokensUsed: nonAlignedTokens,
          timestamp: Date.now(),
          log: {
            level: 'info',
            message: `Generated ${swapTransactions.length} swap transactions with Permit2 to prepare tokens`,
            includeData: false
          }
        });

        return {
          swaps: swapTransactions,
          metadata: swapMetadata
        };
      } else {
        throw new Error(`Unable to generate swap transactions to cover deficits: ${ethers.utils.formatUnits(remainingToken0Deficit, token0Data.decimals)} ${token0Data.symbol}, ${ethers.utils.formatUnits(remainingToken1Deficit, token1Data.decimals)} ${token1Data.symbol}. Check token liquidity pools.`);
      }

    } catch (error) {
      throw new Error(`Failed to prepare tokens for position: ${error.message}`);
    }
  }

  /**
   * Swap remaining non-aligned tokens 50/50 to target tokens by USD value
   * @memberof module:BabyStepsStrategy.BabyStepsStrategy
   * @param {Object} adapter - Platform adapter instance
   * @param {Array} nonAlignedTokens - Array of non-aligned token symbols
   * @param {Object} remainingBalances - Remaining token balances after deficit coverage
   * @param {Object} token0Data - Token0 configuration
   * @param {Object} token1Data - Token1 configuration
   * @param {Object} assetValues - Asset values including token prices
   * @param {Object} vault - Vault object containing address and strategy info
   * @param {string} platformId - Platform identifier
   * @returns {Promise<Array>} Array of swap transaction data
   * @since 1.0.0
   */
  async swapRemainingTokens5050(adapter, nonAlignedTokens, remainingBalances, token0Data, token1Data, assetValues, vault, platformId) {
    const nonAlignedTokensProcessed = []; // Track processing details for each token
    const remainingNATokens = nonAlignedTokens.filter(symbol => remainingBalances[symbol] > 0n);

    if (remainingNATokens.length === 0) {
      // Emit event even when no tokens to process
      this.eventManager.emit('5050SwapsPrepared', {
        vaultAddress: vault.address,
        strategyId: vault.strategy.strategyId,
        platformId: platformId,
        targetTokens: {
          token0: { symbol: token0Data.symbol, address: token0Data.address },
          token1: { symbol: token1Data.symbol, address: token1Data.address }
        },
        nonAlignedTokensProcessed: [],
        totalRemainingUSD: '0',
        targetToken0USD: '0',
        targetToken1USD: '0',
        actualSwappedToToken0USD: '0',
        actualSwappedToToken1USD: '0',
        conversionResult: 'no_remaining_tokens',
        swapTransactions: [],
        timestamp: Date.now(),
        log: {
          level: 'info',
          message: 'No remaining non-aligned tokens to convert',
          includeData: false
        }
      });

      return {
        swaps: [],
        metadata: []
      };
    }

    // Calculate total USD value of remaining tokens
    let totalRemainingUSD = 0;
    for (const symbol of remainingNATokens) {
      const price = assetValues.tokens[symbol].price;
      const decimals = this.tokens[symbol].decimals;

      const usdValue = Number(ethers.utils.formatUnits(remainingBalances[symbol], decimals)) * price;
      totalRemainingUSD += usdValue;
    }

    this.log(`Splitting $${totalRemainingUSD.toFixed(2)} of remaining non-aligned tokens 50/50 between target tokens`);

    const targetToken0USD = totalRemainingUSD / 2;
    const targetToken1USD = totalRemainingUSD / 2;
    let swappedToToken0USD = 0;
    let actualSwappedToToken0USD = 0;
    let actualSwappedToToken1USD = 0;

    // Build swap instructions (platform-agnostic data)
    const swapInstructions = [];

    // Process each Non Aligned token
    for (const symbol of remainingNATokens) {
      const tokenData = this.tokens[symbol];

      const price = assetValues.tokens[symbol].price;
      const balance = remainingBalances[symbol];

      const tokenUSDValue = Number(ethers.utils.formatUnits(balance, tokenData.decimals)) * price;

      // Skip dust - don't swap tokens below minimum threshold
      const minBufferSwapValue = getMinBufferSwapValue(this.chainId);
      if (tokenUSDValue < minBufferSwapValue) {
        this.log(`Skipping buffer swap for ${symbol}: $${tokenUSDValue.toFixed(4)} < $${minBufferSwapValue} threshold`);
        continue;
      }

      // Initialize tracking for this token
      const tokenProcessing = {
        symbol: symbol,
        initialBalance: balance.toString(),
        usdValue: tokenUSDValue.toString(),
        swappedToToken0: '0',
        swappedToToken1: '0'
      };

      const remainingToken0Target = targetToken0USD - swappedToToken0USD;

      if (remainingToken0Target > 0 && tokenUSDValue > 0) {
        // Determine how much of this token to swap to token0
        let amountToSwapToToken0;

        if (tokenUSDValue <= remainingToken0Target) {
          // Swap entire balance to token0
          amountToSwapToToken0 = balance;
        } else {
          // Swap only the portion needed to hit target using BigInt math
          // Convert USD values to cents for integer math (avoid precision loss)
          const targetUSDCents = BigInt(Math.floor(remainingToken0Target * 100));
          const totalUSDCents = BigInt(Math.floor(tokenUSDValue * 100));
          amountToSwapToToken0 = (balance * targetUSDCents) / totalUSDCents;
        }

        if (amountToSwapToToken0 > 0n) {
          // Add swap instruction
          swapInstructions.push({
            tokenIn: tokenData.address,
            tokenOut: token0Data.address,
            tokenOutSymbol: token0Data.symbol,
            amountIn: amountToSwapToToken0.toString(),
            symbol: symbol,
            tokenData: tokenData
          });

          const swappedUSD = Number(ethers.utils.formatUnits(amountToSwapToToken0, tokenData.decimals)) * price;
          swappedToToken0USD += swappedUSD;
          actualSwappedToToken0USD += swappedUSD;
          remainingBalances[symbol] -= amountToSwapToToken0;

          // Update token processing tracking
          tokenProcessing.swappedToToken0 = amountToSwapToToken0.toString();

          this.log(`Buffer swap: ${ethers.utils.formatUnits(amountToSwapToToken0, tokenData.decimals)} ${symbol} → ${token0Data.symbol} ($${swappedUSD.toFixed(2)})`);
        }
      }

      // Whatever is left goes to token1
      if (remainingBalances[symbol] > 0n) {
        // Add swap instruction
        swapInstructions.push({
          tokenIn: tokenData.address,
          tokenOut: token1Data.address,
          tokenOutSymbol: token1Data.symbol,
          amountIn: remainingBalances[symbol].toString(),
          symbol: symbol,
          tokenData: tokenData
        });

        const swappedUSD = Number(ethers.utils.formatUnits(remainingBalances[symbol], tokenData.decimals)) * price;
        actualSwappedToToken1USD += swappedUSD;

        // Update token processing tracking
        tokenProcessing.swappedToToken1 = remainingBalances[symbol].toString();

        this.log(`Buffer swap: ${ethers.utils.formatUnits(remainingBalances[symbol], tokenData.decimals)} ${symbol} → ${token1Data.symbol} ($${swappedUSD.toFixed(2)})`);
      }

      // Add this token's processing data to the tracking array
      nonAlignedTokensProcessed.push(tokenProcessing);
    }

    // Get platform-specific handler from factory
    const handler = BabyStepsStrategyFactory.getHandler(platformId, this);

    if (!handler) {
      throw new Error(`No handler available for platform ${platformId}`);
    }

    // Delegate to platform-specific handler to generate swap transactions
    const { swaps, metadata } = await handler.generateBufferSwapTransactions(swapInstructions, vault);

    // Emit 5050SwapsPrepared event
    this.eventManager.emit('5050SwapsPrepared', {
      vaultAddress: vault.address,
      strategyId: vault.strategy.strategyId,
      platformId: platformId,
      targetTokens: {
        token0: { symbol: token0Data.symbol, address: token0Data.address },
        token1: { symbol: token1Data.symbol, address: token1Data.address }
      },
      nonAlignedTokensProcessed: nonAlignedTokensProcessed,
      totalRemainingUSD: totalRemainingUSD.toString(),
      targetToken0USD: targetToken0USD.toString(),
      targetToken1USD: targetToken1USD.toString(),
      actualSwappedToToken0USD: actualSwappedToToken0USD.toString(),
      actualSwappedToToken1USD: actualSwappedToToken1USD.toString(),
      conversionResult: swaps.length > 0 ? 'swaps_generated' : 'no_remaining_tokens',
      swapTransactions: swaps,
      timestamp: Date.now(),
      log: {
        level: 'info',
        message: `Generated ${swaps.length} 50/50 conversion swaps`,
        includeData: false
      }
    });

    return {
      swaps,
      metadata
    };
  }
  /**
   * Close positions as a batched transaction
   * @memberof module:BabyStepsStrategy.BabyStepsStrategy
   * @param {Object} vault - Vault object
   * @param {Object} positions - Positions to close keyed by ID
   * @returns {Promise<Object>} Object with receipt and positionMetadata
   * @throws {Error} If batch transaction fails
   * @since 1.0.0
   */
  async closePositions(vault, positions) {
    const transactions = [];
    const positionMetadata = {}; // Track metadata for event parsing

    // Generate transaction data for each position to close
    for (const [positionId, position] of Object.entries(positions)) {
      // Get pool metadata from cache
      const poolMetadata = this.poolData[position.pool];
      if (!poolMetadata) {
        throw new Error(`Missing pool metadata for position ${positionId} pool ${position.pool}`);
      }

      // Get adapter for this platform
      const adapter = this.adapters.get(poolMetadata.platform);
      if (!adapter) {
        throw new Error(`No adapter available for platform ${poolMetadata.platform}`);
      }

      // Get token data
      const token0Data = this.tokens[poolMetadata.token0Symbol];
      const token1Data = this.tokens[poolMetadata.token1Symbol];
      if (!token0Data || !token1Data) {
        throw new Error(`Missing token data for ${poolMetadata.token0Symbol}/${poolMetadata.token1Symbol}`);
      }

      // Fetch fresh pool data
      const poolData = await adapter.getPoolData(position.pool, {}, this.provider);

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
      const closeData = await adapter.generateRemoveLiquidityData({
        position,
        percentage: 100,
        provider: this.provider,
        walletAddress: vault.address,
        poolData,
        token0Data,
        token1Data,
        slippageTolerance: vault.strategy.parameters.maxSlippage,
        deadlineMinutes: this.TRANSACTION_DEADLINE_SECONDS / 60
      });

      transactions.push({
        to: closeData.to,
        data: closeData.data,
        value: closeData.value || 0
      });
    }

    // Execute batch transactions via secure decreaseLiquidity function
    const txResult = await this.executeBatchTransactions(vault, transactions, 'position closes', 'subliq');

    // Remove closed positions from vault.positions
    for (const position of Object.values(positions)) {
      delete vault.positions[position.id];
    }

    // Parse principal amounts from receipt
    const principalByPosition = this.extractPrincipalFromReceipt(txResult.receipt, positionMetadata);

    // Build detailed closure data
    const closedPositions = Object.entries(positions).map(([positionId, position]) => {
      const metadata = positionMetadata[positionId];
      const principal = principalByPosition[positionId] || { amount0: ethers.BigNumber.from(0), amount1: ethers.BigNumber.from(0) };

      return {
        positionId,
        pool: position.pool,
        token0Symbol: metadata.poolMetadata.token0Symbol,
        token1Symbol: metadata.poolMetadata.token1Symbol,
        platform: metadata.poolMetadata.platform,
        principalAmount0: principal.amount0.toString(),
        principalAmount1: principal.amount1.toString(),
        tickLower: position.tickLower,
        tickUpper: position.tickUpper
      };
    });

    // Emit event for successful position closures
    const closedCount = closedPositions.length;
    this.eventManager.emit('PositionsClosed', {
      vaultAddress: vault.address,
      closedCount,
      closedPositions,
      gasUsed: txResult.receipt.gasUsed.toString(),
      gasEstimated: txResult.gasEstimated,
      effectiveGasPrice: txResult.receipt.effectiveGasPrice.toString(),
      transactionHash: txResult.receipt.transactionHash,
      success: true,
      timestamp: Date.now(),
      log: {
        level: 'info',
        message: `Successfully closed ${closedCount} positions`
      }
    });

    // Return receipt and metadata for fee extraction
    return {
      receipt: txResult.receipt,
      positionMetadata
    };
  }

  /**
   * Extract principal amounts from position closure receipt
   * @memberof module:BabyStepsStrategy.BabyStepsStrategy
   * @param {Object} receipt - Transaction receipt from closing positions
   * @param {Object} positionMetadata - Metadata for positions that were closed
   * @returns {Object} Principal amounts per position (amount0, amount1 as BigNumber)
   * @since 1.0.0
   */
  extractPrincipalFromReceipt(receipt, positionMetadata) {
    const principalByPosition = {};

    // Create interface for parsing DecreaseLiquidity events
    const decreaseLiquidityInterface = new ethers.utils.Interface([
      'event DecreaseLiquidity(uint256 indexed tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)'
    ]);
    const targetTopicHash = decreaseLiquidityInterface.getEventTopic('DecreaseLiquidity');

    // Parse logs for DecreaseLiquidity events
    for (const log of receipt.logs) {
      try {
        if (log.topics[0] === targetTopicHash) {
          const decoded = decreaseLiquidityInterface.parseLog(log);
          const tokenId = decoded.args.tokenId.toString();

          if (positionMetadata[tokenId]) {
            principalByPosition[tokenId] = {
              amount0: decoded.args.amount0,
              amount1: decoded.args.amount1
            };
            this.log(`Principal recovered from position ${tokenId}: amount0=${decoded.args.amount0}, amount1=${decoded.args.amount1}`);
          }
        }
      } catch (e) {
        // Not a DecreaseLiquidity event, continue
      }
    }

    return principalByPosition;
  }

  /**
   * Extract actual swap amounts from swap receipt
   * @memberof module:BabyStepsStrategy.BabyStepsStrategy
   * @param {Object} receipt - Transaction receipt from swap execution
   * @param {Array} swapMetadata - Array of swap metadata in execution order
   * @returns {Array} Actual swap amounts matching metadata order
   * @since 1.0.0
   */
  extractSwapAmountsFromReceipt(receipt, swapMetadata) {
    const actualSwaps = [];

    // Uniswap V3 Pool Swap event
    const swapInterface = new ethers.utils.Interface([
      'event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)'
    ]);
    const swapTopicHash = swapInterface.getEventTopic('Swap');

    // Collect all swap events from the receipt
    const swapEvents = [];

    for (const log of receipt.logs) {
      try {
        if (log.topics[0] === swapTopicHash) {
          const decoded = swapInterface.parseLog(log);
          swapEvents.push({
            poolAddress: log.address,  // Pool that emitted this event
            amount0: decoded.args.amount0,
            amount1: decoded.args.amount1
          });
        }
      } catch (e) {
        // Not a Swap event, continue
      }
    }

    // Match swap events to metadata in order (swaps execute sequentially)
    // Handle split routes by consuming multiple events per metadata entry
    let eventIndex = 0;

    for (const metadata of swapMetadata) {
      const numEvents = metadata.expectedSwapEvents || 1; // Default to 1 for backwards compatibility

      // Get token addresses for this swap
      const tokenInAddress = this.tokens[metadata.tokenInSymbol].address.toLowerCase();
      const tokenOutAddress = this.tokens[metadata.tokenOutSymbol].address.toLowerCase();

      let totalAmountIn = BigInt(0);
      let totalAmountOut = BigInt(0);

      // MULTI-HOP/SPLIT ROUTE: Use tokenPath to intelligently parse events
      if (metadata.routes && metadata.routes.length > 0) {
        // Process each sub-route
        for (let routeIdx = 0; routeIdx < metadata.routes.length; routeIdx++) {
          const route = metadata.routes[routeIdx];
          const { tokenPath, poolCount } = route;

          // For this route, we consume poolCount events
          for (let hopIdx = 0; hopIdx < poolCount; hopIdx++) {
            if (eventIndex >= swapEvents.length) {
              break;
            }

            const event = swapEvents[eventIndex];
            const isFirstHop = (hopIdx === 0);
            const isLastHop = (hopIdx === poolCount - 1);

            // For first hop: extract amountIn using tokenPath[0]
            if (isFirstHop) {
              const firstToken = tokenPath[0].toLowerCase();
              const secondToken = tokenPath[1].toLowerCase();
              const isToken0 = firstToken < secondToken;

              const amountIn = isToken0
                ? BigInt(event.amount0.abs().toString())
                : BigInt(event.amount1.abs().toString());

              totalAmountIn += amountIn;
            }

            // For last hop: extract amountOut using tokenPath[poolCount]
            if (isLastHop) {
              const secondToLastToken = tokenPath[poolCount - 1].toLowerCase();
              const lastToken = tokenPath[poolCount].toLowerCase();
              const isToken0 = secondToLastToken < lastToken;

              const amountOut = isToken0
                ? BigInt(event.amount1.abs().toString())
                : BigInt(event.amount0.abs().toString());

              totalAmountOut += amountOut;
            }

            eventIndex++;
          }
        }

      } else {
        // SIMPLE ROUTE: Single event, use basic token ordering
        const isTokenInToken0 = tokenInAddress < tokenOutAddress;

        // Consume exactly numEvents events for this metadata entry
        for (let i = 0; i < numEvents; i++) {
          if (eventIndex < swapEvents.length) {
            const event = swapEvents[eventIndex];

            const actualIn = isTokenInToken0
              ? BigInt(event.amount0.abs().toString())
              : BigInt(event.amount1.abs().toString());

            const actualOut = isTokenInToken0
              ? BigInt(event.amount1.abs().toString())
              : BigInt(event.amount0.abs().toString());

            totalAmountIn += actualIn;
            totalAmountOut += actualOut;
            eventIndex++;
          } else {
            // Not enough events - swap may have failed
            break;
          }
        }
      }

      actualSwaps.push({
        actualAmountIn: totalAmountIn.toString(),
        actualAmountOut: totalAmountOut.toString()
      });
    }

    return actualSwaps;
  }

  /**
   * Build swap details by combining metadata with actual amounts
   * @memberof module:BabyStepsStrategy.BabyStepsStrategy
   * @param {Array} swapMetadata - Array of swap metadata with quoted amounts
   * @param {Array} actualSwaps - Array of actual amounts from receipt
   * @returns {Array} Combined swap details with both quoted and actual amounts
   * @since 1.0.0
   */
  buildSwapDetails(swapMetadata, actualSwaps) {
    return swapMetadata.map((metadata, index) => {
      const actual = actualSwaps[index] || { actualAmountIn: '0', actualAmountOut: '0' };
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

  /**
   * Extract actual position amounts from receipt events
   * @memberof module:BabyStepsStrategy.BabyStepsStrategy
   * @param {Object} receipt - Transaction receipt from position creation or liquidity addition
   * @returns {Object} Object containing actual amounts and position details from events
   * @since 1.0.0
   */
  extractPositionAmountsFromReceipt(receipt) {
    // Event interfaces for parsing
    const increaseLiquidityInterface = new ethers.utils.Interface([
      'event IncreaseLiquidity(uint256 indexed tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)'
    ]);
    const mintInterface = new ethers.utils.Interface([
      'event Mint(address sender, address indexed owner, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount, uint256 amount0, uint256 amount1)'
    ]);

    const increaseLiquidityTopicHash = increaseLiquidityInterface.getEventTopic('IncreaseLiquidity');
    const mintTopicHash = mintInterface.getEventTopic('Mint');

    let increaseLiqEvent = null;
    let mintEvent = null;

    // Parse all logs to find the events we need
    for (const log of receipt.logs) {
      try {
        // Try to parse as IncreaseLiquidity event
        if (log.topics[0] === increaseLiquidityTopicHash) {
          const decoded = increaseLiquidityInterface.parseLog(log);
          increaseLiqEvent = {
            tokenId: decoded.args.tokenId.toString(),
            liquidity: decoded.args.liquidity.toString(),
            amount0: decoded.args.amount0.toString(),
            amount1: decoded.args.amount1.toString()
          };
        }

        // Try to parse as Mint event (only present for new position creation)
        if (log.topics[0] === mintTopicHash) {
          const decoded = mintInterface.parseLog(log);
          mintEvent = {
            poolAddress: log.address,
            tickLower: Number(decoded.args.tickLower),
            tickUpper: Number(decoded.args.tickUpper),
            amount0: decoded.args.amount0.toString(),
            amount1: decoded.args.amount1.toString()
          };
        }
      } catch (e) {
        // Not the event we're looking for, continue
      }
    }

    if (!increaseLiqEvent) {
      throw new Error('IncreaseLiquidity event not found in receipt');
    }

    // Return combined data from both events
    return {
      // From IncreaseLiquidity event (always present)
      actualToken0: increaseLiqEvent.amount0,
      actualToken1: increaseLiqEvent.amount1,
      liquidity: increaseLiqEvent.liquidity,
      tokenId: increaseLiqEvent.tokenId,

      // From Mint event (only for new positions)
      tickLower: mintEvent?.tickLower,
      tickUpper: mintEvent?.tickUpper,
      poolAddress: mintEvent?.poolAddress
    };
  }

  /**
   * Extract fees from position closure events
   * @memberof module:BabyStepsStrategy.BabyStepsStrategy
   * @param {Object} receipt - Transaction receipt from closing positions
   * @param {Object} positionMetadata - Metadata for positions that were closed
   * @returns {Object} Fees collected per position
   * @since 1.0.0
   */
  extractFeesFromClosureEvents(receipt, positionMetadata) {
    const feesByPosition = {};

    // Create interfaces for parsing events
    const decreaseLiquidityInterface = new ethers.utils.Interface([
      'event DecreaseLiquidity(uint256 indexed tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)'
    ]);
    const collectInterface = new ethers.utils.Interface([
      'event Collect(uint256 indexed tokenId, address recipient, uint256 amount0, uint256 amount1)'
    ]);

    // Track DecreaseLiquidity amounts (principal only)
    const principalByPosition = {};

    const decreaseLiquidityTopic = decreaseLiquidityInterface.getEventTopic('DecreaseLiquidity');
    const collectTopic = collectInterface.getEventTopic('Collect');

    // Parse logs for DecreaseLiquidity events
    for (const log of receipt.logs) {
      try {
        if (log.topics[0] === decreaseLiquidityTopic) {
          const decoded = decreaseLiquidityInterface.parseLog(log);
          const tokenId = decoded.args.tokenId.toString();

          if (positionMetadata[tokenId]) {
            principalByPosition[tokenId] = {
              amount0: decoded.args.amount0,
              amount1: decoded.args.amount1
            };
            this.log(`DecreaseLiquidity for position ${tokenId}: amount0=${decoded.args.amount0}, amount1=${decoded.args.amount1}`);
          }
        }
      } catch (e) {
        // Not a DecreaseLiquidity event, continue
      }
    }

    // Parse logs for Collect events and calculate fees
    for (const log of receipt.logs) {
      try {
        if (log.topics[0] === collectTopic) {
          const decoded = collectInterface.parseLog(log);
          const tokenId = decoded.args.tokenId.toString();

          if (positionMetadata[tokenId] && principalByPosition[tokenId]) {
            // Fees = Collect amounts - DecreaseLiquidity amounts
            const token0Fees = decoded.args.amount0.sub(principalByPosition[tokenId].amount0);
            const token1Fees = decoded.args.amount1.sub(principalByPosition[tokenId].amount1);

            feesByPosition[tokenId] = {
              token0: token0Fees,
              token1: token1Fees,
              metadata: positionMetadata[tokenId]
            };

            const { token0Data, token1Data } = positionMetadata[tokenId];
            const token0Formatted = parseFloat(ethers.utils.formatUnits(token0Fees, token0Data.decimals));
            const token1Formatted = parseFloat(ethers.utils.formatUnits(token1Fees, token1Data.decimals));

            this.log(`Collect for position ${tokenId}: collected fees = ${token0Formatted} ${token0Data.symbol}, ${token1Formatted} ${token1Data.symbol}`);
          }
        }
      } catch (e) {
        // Not a Collect event, continue
      }
    }

    return feesByPosition;
  }

  /**
   * Distribute fees to owner based on reinvestmentRatio
   * @memberof module:BabyStepsStrategy.BabyStepsStrategy
   * @param {Object} vault - Vault object
   * @param {BigInt} token0Collected - Amount of token0 fees collected
   * @param {BigInt} token1Collected - Amount of token1 fees collected
   * @param {Object} token0Data - Token0 data including address, decimals, symbol
   * @param {Object} token1Data - Token1 data including address, decimals, symbol
   * @param {string} source - Source of fees ('explicit_collection' or 'rebalance')
   * @returns {Promise<Object>} Distribution results including amounts sent to owner
   * @since 1.0.0
   */
  async distributeFeesToOwner(vault, token0Collected, token1Collected, token0Data, token1Data, source = 'explicit_collection') {
    // Handle fee distribution based on reinvestmentRatio
    // Note: reinvestmentRatio is stored as percentage (0-100) in cache, not basis points
    const reinvestmentRatio = vault.strategy.parameters.reinvestmentRatio || 0;
    const reinvestmentBasisPoints = reinvestmentRatio * 100; // Convert to basis points for calculations
    let token0ToOwner = ethers.BigNumber.from(0);
    let token1ToOwner = ethers.BigNumber.from(0);

    if (reinvestmentRatio < 100 && (token0Collected.gt(0) || token1Collected.gt(0))) {
      // Calculate portion to send to owner (using basis points for precision)
      const ownerBasisPoints = ethers.BigNumber.from(10000 - reinvestmentBasisPoints);
      token0ToOwner = token0Collected.mul(ownerBasisPoints).div(10000);
      token1ToOwner = token1Collected.mul(ownerBasisPoints).div(10000);

      if (token0ToOwner.gt(0) || token1ToOwner.gt(0)) {
        this.log(`Transferring non-reinvested fees to owner (${ownerBasisPoints.mul(100).div(10000).toString()}%)...`);

        // Get vault contract for execution
        const vaultContract = getVaultContract(vault.address, this.provider);

        // Create signer for transaction execution
        const automationPrivateKey = process.env.AUTOMATION_PRIVATE_KEY;
        if (!automationPrivateKey) {
          throw new Error('AUTOMATION_PRIVATE_KEY not found in environment variables');
        }
        const signer = new ethers.Wallet(automationPrivateKey, this.provider);
        const vaultContractWithSigner = vaultContract.connect(signer);

        // Distribute fees using withdrawTokens (recipient hardcoded to owner in contract)
        if (token0ToOwner.gt(0)) {
          const gasEstimate = await vaultContractWithSigner.estimateGas.withdrawTokens(token0Data.address, token0ToOwner);
          const gasLimit = gasEstimate.mul(120).div(100);
          const tx = await vaultContractWithSigner.withdrawTokens(token0Data.address, token0ToOwner, { gasLimit });
          const receipt = await tx.wait();
          if (receipt.status !== 1) {
            throw new Error(`Fee distribution for ${token0Data.symbol} failed with status ${receipt.status}`);
          }
          this.log(`Distributed ${ethers.utils.formatUnits(token0ToOwner, token0Data.decimals)} ${token0Data.symbol} to owner`);
        }

        if (token1ToOwner.gt(0)) {
          const gasEstimate = await vaultContractWithSigner.estimateGas.withdrawTokens(token1Data.address, token1ToOwner);
          const gasLimit = gasEstimate.mul(120).div(100);
          const tx = await vaultContractWithSigner.withdrawTokens(token1Data.address, token1ToOwner, { gasLimit });
          const receipt = await tx.wait();
          if (receipt.status !== 1) {
            throw new Error(`Fee distribution for ${token1Data.symbol} failed with status ${receipt.status}`);
          }
          this.log(`Distributed ${ethers.utils.formatUnits(token1ToOwner, token1Data.decimals)} ${token1Data.symbol} to owner`);
        }
      }
    }

    return {
      token0ToOwner,
      token1ToOwner,
      token0Reinvested: token0Collected.sub(token0ToOwner),
      token1Reinvested: token1Collected.sub(token1ToOwner),
      reinvestmentRatio
    };
  }
  //#endregion

  //#region Position E & M Helpers
  /**
   * Calculate available deployment for a vault
   * @memberof module:BabyStepsStrategy.BabyStepsStrategy
   * @param {Object} vault - Vault object
   * @returns {Promise<Object>} Object containing availableDeployment and assetValues
   * @since 1.0.0
   */
  async calculateAvailableDeployment(vault) {
    const assetValues = await this.vaultDataService.fetchAssetValues(vault);
    const totalValue = assetValues.totalVaultValue;
    const positionValue = assetValues.totalPositionValue;
    const tokenValue = assetValues.totalTokenValue;
    const maxUtilization = vault.strategy.parameters.maxUtilization / 100;
    const currentUtilization = totalValue > 0 ? positionValue / totalValue : 0;
    const rawAvailableDeployment = totalValue * maxUtilization - positionValue;

    // Calculate minimum deployment threshold using chain, platform, and strategy levels
    const chainMinimum = getMinDeploymentForGas(this.chainId);

    // Get platform minimums for all target platforms
    const platformMinimums = vault.targetPlatforms.map(platformId =>
      getMinLiquidityAmount(platformId)
    );
    const maxPlatformMinimum = Math.max(...platformMinimums);

    // Get strategy multiplier
    const strategyMultiplier = getMinDeploymentMultiplier(vault.strategy.strategyId);

    // Calculate effective minimum: max(chain, platform) * strategy multiplier
    const effectiveMinimum = Math.max(chainMinimum, maxPlatformMinimum) * strategyMultiplier;

    // Apply minimum threshold - if below threshold, consider it as 0
    const availableDeployment = rawAvailableDeployment > effectiveMinimum ? rawAvailableDeployment : 0;

    // Emit utilization metrics
    this.eventManager.emit('UtilizationCalculated', {
      vaultAddress: vault.address,
      totalVaultValue: totalValue,
      positionValue: positionValue,
      tokenValue: tokenValue,
      currentUtilization: currentUtilization,
      maxUtilization: maxUtilization,
      availableDeployment: availableDeployment,
      rawAvailableDeployment: rawAvailableDeployment,
      chainMinimum: chainMinimum,
      maxPlatformMinimum: maxPlatformMinimum,
      strategyMultiplier: strategyMultiplier,
      effectiveMinimum: effectiveMinimum,
      utilizationPercentage: currentUtilization * 100,
      timestamp: Date.now(),
      strategyId: vault.strategy.strategyId,
      log: {
        level: 'info',
        message: `Vault value: $${totalValue.toFixed(2)}, Current utilization: ${(currentUtilization * 100).toFixed(1)}%, Available deployment: $${availableDeployment.toFixed(2)}`,
        includeData: false
      }
    });

    return { availableDeployment, assetValues };
  }

  /**
   * Validate pool against Baby Steps strategy criteria including TVL requirements
   * @memberof module:BabyStepsStrategy.BabyStepsStrategy
   * @param {string} poolAddress - Pool contract address
   * @returns {Promise<boolean>} True if pool meets all criteria, false otherwise
   * @throws {Error} If pool data is missing or theGraph API fails
   * @since 1.0.0
   */
  async validatePoolCriteria(poolAddress) {
    if (!poolAddress) {
      throw new Error("Pool address is required for validation");
    }

    const { minTVL, tvlAveragingPeriod, minPoolAge } = this.config.strategyProperties;

    // Get pool metadata from cache
    const poolData = this.poolData[poolAddress];
    if (!poolData) {
      throw new Error(`Pool data not found for ${poolAddress}`);
    }

    // Check if we have fresh TVL data in cache
    const tvlCache = poolData.averageTVL && poolData.averageTVL[tvlAveragingPeriod];

    let isStale = !tvlCache;
    if (!isStale) {
      // Check if cached data is from a different UTC calendar day
      // TheGraph uses UTC for daily aggregations, so we must align with that
      const cachedDate = new Date(tvlCache.tvlTimestamp);
      const currentDate = new Date();

      // Get UTC start of day for both dates
      const cachedUTCDay = new Date(cachedDate).setUTCHours(0, 0, 0, 0);
      const currentUTCDay = new Date(currentDate).setUTCHours(0, 0, 0, 0);

      isStale = cachedUTCDay !== currentUTCDay;
    }

    let tvlValue;

    if (isStale) {
      // Fetch fresh TVL data
      this.log(`Fetching fresh TVL data for pool ${poolAddress} (${tvlAveragingPeriod} day average)`);

      try {
        tvlValue = await retryExternalService(
          () => getPoolTVLAverage(
            poolAddress,
            this.serviceConfig.chainId,
            poolData.platform,
            tvlAveragingPeriod,
            process.env.THEGRAPH_API_KEY
          ),
          'TheGraph TVL',
          this
        );

        poolData.averageTVL[tvlAveragingPeriod] = {
          tvlValue,
          tvlTimestamp: Date.now()
        };

        this.log(`Updated TVL cache for pool ${poolAddress}: ${tvlValue}`);
      } catch (error) {
        this.log(`Failed to fetch TVL for pool ${poolAddress}: ${error.message}`);
        throw new Error(`Unable to validate pool TVL: ${error.message}`);
      }
    } else {
      // Use cached TVL data
      tvlValue = tvlCache.tvlValue;
      this.log(`Using cached TVL data for pool ${poolAddress}: ${tvlValue}`);
    }

    // Validate TVL meets minimum requirement
    if (tvlValue < minTVL) {
      this.log(`Pool ${poolAddress} TVL ${tvlValue} below minimum ${minTVL}`);
      return false;
    }


    // Validate pool age meets minimum requirement
    const currentTimestamp = Math.floor(Date.now() / 1000);
    let poolCreationTimestamp;

    try {
      poolCreationTimestamp = await retryExternalService(
        () => getPoolAge(
          poolAddress,
          this.serviceConfig.chainId,
          poolData.platform,
          process.env.THEGRAPH_API_KEY
        ),
        'TheGraph PoolAge',
        this
      );
    } catch (error) {
      this.log(`Failed to fetch pool age for ${poolAddress}: ${error.message}`);
      throw new Error(`Unable to validate pool age: ${error.message}`);
    }

    const poolAgeInDays = (currentTimestamp - poolCreationTimestamp) / (24 * 60 * 60);

    if (poolAgeInDays < minPoolAge) {
      this.log(`Pool ${poolAddress} age ${poolAgeInDays.toFixed(1)} days below minimum ${minPoolAge} days`);
      return false;
    }

    this.log(`Pool ${poolAddress} meets all criteria: TVL ${tvlValue} >= ${minTVL}, fee ${poolData.fee}, age ${poolAgeInDays.toFixed(1)} >= ${minPoolAge} days`);
    return true;
  }

  /**
   * Execute a batch of transactions with retry logic for network errors
   * @memberof module:BabyStepsStrategy.BabyStepsStrategy
   * @param {Object} vault - Vault object
   * @param {Array} transactions - Array of transaction objects with {to, data, value} structure
   * @param {string} operationType - Description of operation for logging (e.g., 'position closes', 'token swaps')
   * @param {string} type - Transaction type: 'swap' uses vault.swap(), 'approval' uses vault.approve(), 'mint' uses vault.mint(), 'addliq' uses vault.increaseLiquidity(), 'subliq' uses vault.decreaseLiquidity(), 'collect' uses vault.collect(), 'burn' uses vault.burn()
   * @returns {Promise<Object>} Transaction receipt
   * @throws {Error} If batch transaction fails
   * @since 1.0.0
   */
  async executeBatchTransactions(vault, transactions, operationType, type) {

    const targets = [];
    const calldatas = [];
    const values = [];

    // Extract transaction data
    for (const txn of transactions) {
      targets.push(txn.to);
      calldatas.push(txn.data);
      values.push(txn.value || 0);
    }

    // Get vault contract for execution
    const { getVaultContract } = await import('fum_library');
    const vaultContract = getVaultContract(vault.address, this.provider);

    // Create signer for transaction execution
    const automationPrivateKey = process.env.AUTOMATION_PRIVATE_KEY;
    if (!automationPrivateKey) {
      throw new Error('AUTOMATION_PRIVATE_KEY not found in environment variables');
    }
    const signer = new ethers.Wallet(automationPrivateKey, this.provider);
    const vaultContractWithSigner = vaultContract.connect(signer);

    // Estimate gas before execution
    let gasEstimated = '0';
    try {
      let gasEstimate;
      if (type === 'swap') {
        gasEstimate = await vaultContractWithSigner.estimateGas.swap(targets, calldatas);
      } else if (type === 'approval') {
        gasEstimate = await vaultContractWithSigner.estimateGas.approve(targets, calldatas);
      } else if (type === 'mint') {
        gasEstimate = await vaultContractWithSigner.estimateGas.mint(targets, calldatas);
      } else if (type === 'addliq') {
        gasEstimate = await vaultContractWithSigner.estimateGas.increaseLiquidity(targets, calldatas);
      } else if (type === 'subliq') {
        gasEstimate = await vaultContractWithSigner.estimateGas.decreaseLiquidity(targets, calldatas);
      } else if (type === 'collect') {
        gasEstimate = await vaultContractWithSigner.estimateGas.collect(targets, calldatas);
      } else if (type === 'burn') {
        gasEstimate = await vaultContractWithSigner.estimateGas.burn(targets, calldatas);
      } else {
        throw new Error(`Invalid transaction type: ${type}. Must be one of: swap, approval, mint, addliq, subliq, collect, burn`);
      }
      gasEstimated = gasEstimate.toString();
      this.log(`Gas estimate for ${operationType}: ${gasEstimated}`);
    } catch (gasError) {
      // Try to decode the revert reason if available
      if (gasError.data) {
        try {
          // Try to decode as a string revert reason
          const decodedError = ethers.utils.toUtf8String('0x' + gasError.data.slice(138));
          console.log(`   Decoded revert reason: ${decodedError}`);
        } catch (decodeError) {
          console.log(`   Could not decode error data as string`);
        }
      }

      // Try to get more details from the error object
      if (gasError.error) {
        console.log(`   Nested error:`, JSON.stringify(gasError.error, null, 2));
      }

      if (gasError.transaction) {
        console.log(`   Transaction that failed:`, JSON.stringify(gasError.transaction, null, 2));
      }

      throw new Error(`Gas estimation failed for ${operationType} - transaction data may be invalid: ${gasError.message}`);
    }

    // Execute batch transaction with retry on network errors
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        this.log(`Executing batch of ${targets.length} ${operationType} (attempt ${attempt})`);

        let tx;
        if (type === 'swap') {
          tx = await vaultContractWithSigner.swap(targets, calldatas);
        } else if (type === 'approval') {
          tx = await vaultContractWithSigner.approve(targets, calldatas);
        } else if (type === 'mint') {
          tx = await vaultContractWithSigner.mint(targets, calldatas);
        } else if (type === 'addliq') {
          tx = await vaultContractWithSigner.increaseLiquidity(targets, calldatas);
        } else if (type === 'subliq') {
          tx = await vaultContractWithSigner.decreaseLiquidity(targets, calldatas);
        } else if (type === 'collect') {
          tx = await vaultContractWithSigner.collect(targets, calldatas);
        } else if (type === 'burn') {
          tx = await vaultContractWithSigner.burn(targets, calldatas);
        } else {
          throw new Error(`Invalid transaction type: ${type}. Must be one of: swap, approval, mint, addliq, subliq, collect, burn`);
        }
        const receipt = await tx.wait();

        this.log(`Successfully executed ${targets.length} ${operationType}, tx: ${receipt.transactionHash}`);

        // Emit batch transaction execution event
        this.eventManager.emit('BatchTransactionExecuted', {
          vaultAddress: vault.address,
          strategyId: vault.strategy.strategyId,
          operationType: operationType,
          transactionCount: transactions.length,
          transactionHash: receipt.transactionHash,
          blockNumber: receipt.blockNumber,
          gasUsed: receipt.gasUsed.toString(),
          gasEstimated: gasEstimated,
          gasEfficiency: gasEstimated !== '0' ? ((Number(receipt.gasUsed) / Number(gasEstimated)) * 100).toFixed(1) : 'N/A',
          totalValue: transactions.reduce((sum, tx) => sum + (Number(tx.value) || 0), 0).toString(),
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

        // Return receipt and gas estimate
        return { receipt, gasEstimated };
      } catch (error) {
        this.log(`Attempt ${attempt} failed: ${error.message}`);

        // If this is the second attempt or not a retryable error, throw
        if (attempt === 2 || !this.isRetryableError(error)) {
          throw new Error(`Failed to execute ${operationType} - ${this.isRetryableError(error) ? 'max retries exceeded' : 'non-retryable error'}: ${error.message}`);
        }

        this.log(`Retrying ${operationType} execution...`);
      }
    }
  }

  /**
   * Check if an error is retryable (network/nonce issues vs business logic)
   * @memberof module:BabyStepsStrategy.BabyStepsStrategy
   * @param {Error} error - Error to check
   * @returns {boolean} True if error should be retried
   * @since 1.0.0
   */
  isRetryableError(error) {
    const retryableCodes = ['NETWORK_ERROR', 'TIMEOUT', 'NONCE_EXPIRED'];
    const retryableMessages = ['network', 'timeout', 'connection', 'replacement fee too low'];

    if (retryableCodes.includes(error.code)) return true;
    if (retryableMessages.some(msg => error.message?.toLowerCase().includes(msg))) return true;
    if (error.reason === 'replacement fee too low') return true;

    return false;
  }

  /**
   * Generate an ERC20 approval transaction for vault operations
   * @memberof module:BabyStepsStrategy.BabyStepsStrategy
   * @param {string} tokenAddress - Address of the token to approve
   * @param {string} spenderAddress - Address that will be approved to spend
   * @param {string|BigInt} amount - Amount to approve
   * @param {string} tokenSymbol - Token symbol for logging
   * @param {string} vaultAddress - Vault address for event emission
   * @returns {Object} Transaction object with to, data, value fields
   * @since 1.0.0
   */
  generateApprovalTransaction(tokenAddress, spenderAddress, amount, tokenSymbol, vaultAddress) {
    const tokenContract = new ethers.Contract(tokenAddress, ERC20ABI.abi, this.provider);

    const approvalData = tokenContract.interface.encodeFunctionData('approve', [
      spenderAddress,
      amount.toString()
    ]);

    // Emit event for logging and tracking
    this.eventManager.emit('TokenApprovalGenerated', {
      vaultAddress: vaultAddress,
      tokenAddress: tokenAddress,
      tokenSymbol: tokenSymbol,
      spenderAddress: spenderAddress,
      amount: amount.toString(),
      timestamp: Date.now(),
      log: {
        level: 'info',
        message: `Generated approval for ${tokenSymbol}: vault ${vaultAddress} approves ${spenderAddress} to spend ${amount}`,
        includeData: false
      }
    });

    return {
      to: tokenAddress,
      data: approvalData,
      value: "0"
    };
  }

  /**
   * Select the optimal pool for a token pair based on TVL
   * @memberof module:BabyStepsStrategy.BabyStepsStrategy
   * @param {string} token0Symbol - First token symbol
   * @param {string} token1Symbol - Second token symbol
   * @param {Object} adapter - Platform adapter
   * @returns {Promise<Object>} Selected pool data including address, fee, liquidity, sqrtPriceX96, and tick
   * @since 1.0.0
   */
  async selectOptimalPool(token0Symbol, token1Symbol, adapter) {
    // Check cache first (1 month TTL)
    const cacheKey = `${adapter.platformId}-${token0Symbol}-${token1Symbol}`;
    const cached = this.bestPoolCache[cacheKey];
    const ONE_MONTH = 30 * 24 * 60 * 60 * 1000;

    if (cached && (Date.now() - cached.lastUpdated) < ONE_MONTH) {
      this.log(`Using cached pool for ${token0Symbol}/${token1Symbol} on ${adapter.platformName}: ${cached.pool.address}`);

      // Fetch current pool data for the cached pool selection
      // We cache the pool SELECTION (which fee tier is best) but always get fresh tick/liquidity data
      const token0Data = this.tokens[token0Symbol];
      const token1Data = this.tokens[token1Symbol];

      const currentPoolData = await adapter.fetchPoolData(
        token0Data.address,
        token1Data.address,
        cached.pool.fee,
        this.provider
      );

      // Merge cached pool selection with fresh dynamic data
      const updatedPool = {
        ...cached.pool,
        tick: currentPoolData.tick,
        sqrtPriceX96: currentPoolData.sqrtPriceX96,
        liquidity: currentPoolData.liquidity
      };

      // Emit OptimalPoolSelected event for cached pool
      this.eventManager.emit('OptimalPoolSelected', {
        token0Symbol,
        token1Symbol,
        platformId: adapter.platformId,
        platformName: adapter.platformName,
        poolAddress: updatedPool.address,
        poolFee: updatedPool.fee,
        poolLiquidity: updatedPool.liquidity,
        poolsDiscovered: 'N/A',
        poolsEligible: 'N/A',
        fromCache: true,
        selectionMethod: 'cache',
        chainId: this.chainId,
        timestamp: Date.now(),
        log: {
          level: 'info',
          message: `Selected cached pool ${updatedPool.address} for ${token0Symbol}/${token1Symbol} on ${adapter.platformName}`,
          includeData: false
        }
      });

      return updatedPool;
    }

    const token0Data = this.tokens[token0Symbol];
    const token1Data = this.tokens[token1Symbol];
    if (!token0Data || !token1Data) {
      throw new Error(`Token data not found for ${token0Symbol} or ${token1Symbol}`);
    }

    this.log(`Discovering pools for ${token0Symbol}/${token1Symbol} on ${adapter.platformName}...`);

    // Discover all available pools
    const pools = await adapter.discoverAvailablePools(
      token0Data.address,
      token1Data.address,
      this.provider
    );

    if (pools.length === 0) {
      throw new Error(`No pools found for ${token0Symbol}/${token1Symbol} on ${adapter.platformName}`);
    }

    // Fetch TVL for all pools in parallel
    const poolsWithTVL = await Promise.all(pools.map(async (pool) => {
      try {
        const tvl = await getPoolTVLAverage(
          pool.address,
          this.chainId,
          adapter.platformId,
          1, // 1 day average for speed
          process.env.THEGRAPH_API_KEY
        );
        return { ...pool, tvl };
      } catch (error) {
        this.log(`Could not fetch TVL for pool ${pool.address}: ${error.message}`);
        return { ...pool, tvl: 0 };
      }
    }));

    // Filter out dead pools (TVL = 0)
    const eligible = poolsWithTVL.filter(p => p.tvl > 0);

    if (eligible.length === 0) {
      throw new Error(`No active pools found for ${token0Symbol}/${token1Symbol} on ${adapter.platformName}`);
    }

    // Sort by TVL descending and pick the highest
    eligible.sort((a, b) => {
      const tvlA = BigInt(Math.floor(a.tvl));
      const tvlB = BigInt(Math.floor(b.tvl));
      return tvlB > tvlA ? 1 : tvlB < tvlA ? -1 : 0;
    });

    const selected = eligible[0];
    const selectionMethod = 'highest TVL';

    this.log(`Selected pool for ${token0Symbol}/${token1Symbol}: address=${selected.address}, fee=${selected.fee}, TVL=$${selected.tvl.toLocaleString()}, liquidity=${selected.liquidity}`);

    // Cache the result
    this.bestPoolCache[cacheKey] = {
      pool: selected,
      lastUpdated: Date.now()
    };

    // Emit OptimalPoolSelected event for new pool selection
    this.eventManager.emit('OptimalPoolSelected', {
      token0Symbol,
      token1Symbol,
      platformId: adapter.platformId,
      platformName: adapter.platformName,
      poolAddress: selected.address,
      poolFee: selected.fee,
      poolTVL: selected.tvl,
      poolLiquidity: selected.liquidity,
      poolsDiscovered: pools.length,
      poolsEligible: eligible.length,
      fromCache: false,
      selectionMethod,
      chainId: this.chainId,
      timestamp: Date.now(),
      log: {
        level: 'info',
        message: `Selected pool ${selected.address} for ${token0Symbol}/${token1Symbol} on ${adapter.platformName} (${selectionMethod})`,
        includeData: false
      }
    });

    return selected;
  }

  /**
   * Check if a deficit is effectively covered (within 0.1% tolerance)
   * @memberof module:BabyStepsStrategy.BabyStepsStrategy
   * @param {bigint} remainingDeficit - Current remaining deficit amount
   * @param {bigint} originalDeficit - Original deficit amount to calculate percentage against
   * @returns {boolean} True if deficit is effectively covered
   * @since 1.0.0
   */
  isDeficitEffectivelyCovered(remainingDeficit, originalDeficit) {
    if (remainingDeficit === 0n) return true;

    // Consider covered if remaining is less than 0.1% of original deficit
    const toleranceThreshold = originalDeficit / 1000n; // 0.1%
    return remainingDeficit <= toleranceThreshold;
  }

  /**
   * Handle deficit swap to cover token shortfalls for position creation & liquidity additions
   * @memberof module:BabyStepsStrategy.BabyStepsStrategy
   * @param {Object} handler - Platform-specific handler instance
   * @param {Object} tokenIn - Source token data (symbol, address, decimals)
   * @param {Object} tokenOut - Target token data (symbol, address, decimals)
   * @param {bigint} availableAmount - Available amount of source token
   * @param {bigint} targetDeficit - Target deficit amount in output token
   * @param {string} recipient - Recipient address (vault address)
   * @param {number} slippageTolerance - Slippage tolerance percentage from strategy
   * @param {number} nonce - Permit2 nonce for this swap
   * @param {Object} vault - Vault object
   * @returns {Promise<Object>} Swap result with transaction data or null
   * @since 1.0.0
   */
  async handleDeficitSwaps(handler, tokenIn, tokenOut, availableAmount, targetDeficit, recipient, slippageTolerance, nonce, vault) {
    try {
      // Get adapter from handler
      const adapter = handler.adapter;

      // Determine how much input we need to get the desired output (targetDeficit)
      const quoteResult = await adapter.getBestSwapQuote({
        tokenInAddress: tokenIn.address,
        tokenOutAddress: tokenOut.address,
        amount: targetDeficit.toString(),
        isAmountIn: false,
        provider: this.provider
      });

      const { amountIn } = quoteResult;
      const requiredAmountIn = BigInt(amountIn);

      let decidedAmountIn;
      let decidedAmountOut;

      // Check if we have enough tokens to cover the deficit
      if (requiredAmountIn <= availableAmount) {
        // We have enough - use the required amount (deficit already includes 2% buffer)
        decidedAmountIn = requiredAmountIn;
        decidedAmountOut = targetDeficit;
      } else {
        // We don't have enough - use all available and get EXACT_INPUT quote to know what we'll get
        const fallbackQuote = await adapter.getBestSwapQuote({
          tokenInAddress: tokenIn.address,
          tokenOutAddress: tokenOut.address,
          amount: availableAmount.toString(),
          isAmountIn: true,
          provider: this.provider
        });

        decidedAmountIn = availableAmount;
        decidedAmountOut = BigInt(fallbackQuote.amountOut);
      }

      // Generate swap transaction using platform handler with Permit2
      // Always use EXACT_INPUT (isAmountIn: true) for execution since we're specifying the input amount
      const swapResult = await handler.generateSwapTransaction(
        tokenIn.address,
        tokenOut.address,
        decidedAmountIn.toString(),
        true,
        recipient,
        slippageTolerance,
        nonce,
        vault
      );

      return {
        transaction: swapResult.transaction,
        amountIn: decidedAmountIn.toString(), // For deficit tracking logic
        amountOut: decidedAmountOut.toString(), // For deficit tracking logic
        quotedAmountIn: swapResult.quotedAmountIn,
        quotedAmountOut: swapResult.quotedAmountOut,
        isAmountIn: swapResult.isAmountIn,
        tokenInSymbol: tokenIn.symbol,
        tokenOutSymbol: tokenOut.symbol,
        expectedSwapEvents: swapResult.expectedSwapEvents,
        routes: swapResult.routes
      };

    } catch (error) {
      throw new Error(`Failed to prepare swap for ${tokenIn.symbol} → ${tokenOut.symbol}: ${error.message}`);
    }
  }

  /**
   * Validate slippage parameter and ensure it's within safe bounds
   * @memberof module:BabyStepsStrategy.BabyStepsStrategy
   * @param {number} slippage - Slippage value to validate
   * @returns {number} Validated slippage value
   * @throws {Error} If slippage is undefined, null, or outside safe bounds
   * @since 1.0.0
   */
  validateSlippage(slippage) {
    if (slippage === undefined || slippage === null) {
      throw new Error("Slippage tolerance is required and cannot be undefined - this is critical for financial safety");
    }

    const slippageNum = Number(slippage);
    if (isNaN(slippageNum)) {
      throw new Error(`Invalid slippage value: ${slippage} - must be a valid number`);
    }

    // Validate slippage is within reasonable bounds (0.01% to 10%)
    if (slippageNum < 0.01 || slippageNum > 10) {
      throw new Error(`Slippage ${slippageNum}% is outside safe bounds (0.01% - 10%) - this could lead to failed transactions or excessive losses`);
    }

    return slippageNum;
  }

  /**
   * Clean up all registered listeners and resources for a vault
   * @memberof module:BabyStepsStrategy.BabyStepsStrategy
   * @param {string} vaultAddress - Vault contract address
   * @since 1.0.0
   */
  cleanup(vaultAddress) {
    if (!vaultAddress) {
      this.log('Error: No vault address provided for cleanup');
      return;
    }

    // Clean up all lastPositionCheck entries for this vault
    const normalizedVaultAddress = vaultAddress.toLowerCase();

    // Find and delete all entries that belong to this vault
    let removedCheckCount = 0;
    for (const key of Object.keys(this.lastPositionCheck)) {
      if (key.toLowerCase().startsWith(`${normalizedVaultAddress}-`)) {
        delete this.lastPositionCheck[key];
        removedCheckCount++;
      }
    }

    // Clean up emergency exit baseline cache
    if (this.emergencyExitBaseline[vaultAddress]) {
      delete this.emergencyExitBaseline[vaultAddress];
      this.log(`Cleaned up emergency exit baseline for vault ${vaultAddress}`);
    }

    // Emit event with position check cleanup details
    this.eventManager.emit('VaultPositionChecksCleared', {
      vaultAddress,
      removedCheckCount,
      log: {
        message: `Baby Steps cleanup for vault ${vaultAddress} - Cleared ${removedCheckCount} position check timestamps`,
        level: 'info'
      }
    });
  }
  //#endregion

  //#region Price/Swap Event Handling
  /**
   * Handle swap event
   * @memberof module:BabyStepsStrategy.BabyStepsStrategy
   * @param {Object} vault - Vault object
   * @param {Object} position - Position affected by price change
   * @param {number} currentTick - Current tick from the event
   * @param {BigInt} sqrtPriceX96 - Square root price from the event
   * @returns {Promise<void>}
   * @since 1.0.0
   */
  async handleSwapEvent(vault, poolAddress, platform, log) {
    try {
      // Get platform-specific handler from factory
      const handler = BabyStepsStrategyFactory.getHandler(platform, this);

      if (!handler) {
        const errorMessage = `No handler available for platform: ${platform}`;

        // Emit event with log property for automatic logging
        this.eventManager.emit('VaultUnrecoverable', {
          vaultAddress: vault.address,
          reason: errorMessage,
          details: {
            platform,
            strategy: this.type
          },
          log: {
            level: 'error',
            message: `❌ Vault ${vault.address} has unsupported platform ${platform} - marking unrecoverable`,
            includeData: true
          }
        });

        throw new Error(errorMessage);
      }

      // Delegate to platform-specific handler
      await handler.handleSwapEvent(vault, poolAddress, log);

    } catch (error) {
      this.log(`Error handling swap event for vault ${vault.address}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Check if position needs rebalancing based on thresholds
   * @memberof module:BabyStepsStrategy.BabyStepsStrategy
   * @param {Object} position - Position to check
   * @param {number} currentTick - Current tick
   * @param {Object} params - Strategy parameters
   * @returns {boolean} Whether rebalance is needed
   * @since 1.0.0
   */
  checkRebalanceNeeded(position, currentTick, params) {
    // First check if completely out of range
    if (currentTick < position.tickLower || currentTick > position.tickUpper) {
      this.log(`Position ${position.id} is OUT OF RANGE`);
      return true;
    }

    // Check threshold distances
    const rangeSize = position.tickUpper - position.tickLower;
    const distanceToUpper = position.tickUpper - currentTick;
    const distanceToLower = currentTick - position.tickLower;

    const upperPercentage = distanceToUpper / rangeSize;
    const lowerPercentage = distanceToLower / rangeSize;

    const upperThreshold = params.rebalanceThresholdUpper / 100;
    const lowerThreshold = params.rebalanceThresholdLower / 100;

    if (upperPercentage <= upperThreshold || lowerPercentage <= lowerThreshold) {
      this.log(`Position ${position.id} approaching range boundary`);
      this.log(`Upper distance: ${(upperPercentage * 100).toFixed(2)}%, threshold: ${params.rebalanceThresholdUpper}%`);
      this.log(`Lower distance: ${(lowerPercentage * 100).toFixed(2)}%, threshold: ${params.rebalanceThresholdLower}%`);
      return true;
    }

    return false;
  }

  /**
   * Rebalance a position that is out of range or near boundaries
   * @memberof module:BabyStepsStrategy.BabyStepsStrategy
   * @param {Object} vault - Vault object
   * @param {Object} outOfRangePosition - Position to rebalance
   * @param {number} currentTick - Current tick
   * @returns {Promise<void>}
   * @since 1.0.0
   */
  async rebalancePosition(vault, position, currentTick) {
    const vaultAddress = vault.address;
    this.log(`Starting rebalance for position ${position.id} in vault ${vaultAddress}`);

    try {
      // Step 1: Close the out-of-range position and get receipt with metadata
      const nonAlignedPositions = { [position.id]: position };
      const { receipt, positionMetadata } = await this.closePositions(vault, nonAlignedPositions);

      // Step 2: Extract fees from closure events
      const feesByPosition = this.extractFeesFromClosureEvents(receipt, positionMetadata);

      // Step 3: Calculate total fees collected
      let totalToken0Fees = ethers.BigNumber.from(0);
      let totalToken1Fees = ethers.BigNumber.from(0);
      let token0Data = null;
      let token1Data = null;

      for (const [positionId, fees] of Object.entries(feesByPosition)) {
        totalToken0Fees = totalToken0Fees.add(fees.token0);
        totalToken1Fees = totalToken1Fees.add(fees.token1);
        // Get token data from metadata (same for all positions in this strategy)
        if (!token0Data) {
          token0Data = fees.metadata.token0Data;
          token1Data = fees.metadata.token1Data;
        }
      }

      // Step 4: Distribute fees to owner based on reinvestmentRatio
      if ((totalToken0Fees.gt(0) || totalToken1Fees.gt(0)) && token0Data && token1Data) {
        const token0Formatted = parseFloat(ethers.utils.formatUnits(totalToken0Fees, token0Data.decimals));
        const token1Formatted = parseFloat(ethers.utils.formatUnits(totalToken1Fees, token1Data.decimals));
        this.log(`Total fees collected during rebalance: ${token0Formatted} ${token0Data.symbol}, ${token1Formatted} ${token1Data.symbol}`);

        // Distribute to owner
        const distribution = await this.distributeFeesToOwner(
          vault,
          totalToken0Fees,
          totalToken1Fees,
          token0Data,
          token1Data,
          'rebalance'
        );

        // Get current USD prices for event
        const prices = await fetchTokenPrices(
          [token0Data.symbol, token1Data.symbol],
          CACHE_DURATIONS['30-SECONDS']
        );

        const token0USD = token0Formatted * prices[token0Data.symbol.toUpperCase()];
        const token1USD = token1Formatted * prices[token1Data.symbol.toUpperCase()];
        const totalUSD = token0USD + token1USD;

        // Emit FeesCollected event for rebalance
        this.eventManager.emit('FeesCollected', {
          vaultAddress: vault.address,
          positionId: position.id,
          source: 'rebalance',
          token0Collected: token0Formatted,
          token1Collected: token1Formatted,
          token0Symbol: token0Data.symbol,
          token1Symbol: token1Data.symbol,
          token0USD,
          token1USD,
          totalUSD,
          token0ToOwner: parseFloat(ethers.utils.formatUnits(distribution.token0ToOwner, token0Data.decimals)),
          token1ToOwner: parseFloat(ethers.utils.formatUnits(distribution.token1ToOwner, token1Data.decimals)),
          token0Reinvested: parseFloat(ethers.utils.formatUnits(distribution.token0Reinvested, token0Data.decimals)),
          token1Reinvested: parseFloat(ethers.utils.formatUnits(distribution.token1Reinvested, token1Data.decimals)),
          reinvestmentRatio: distribution.reinvestmentRatio,
          transactionHash: receipt.transactionHash,
          timestamp: Date.now(),
          log: {
            level: 'info',
            message: `💰 Collected $${totalUSD.toFixed(2)} in fees from position ${position.id} during rebalance (${distribution.reinvestmentRatio}% reinvested)`,
            includeData: true
          }
        });
      }

      // Step 5: Refresh token balances after fee distribution
      vault.tokens = await this.vaultDataService.fetchTokenBalances(
        vault.address,
        Object.keys(this.tokens)
      );

      // Step 6: Calculate available deployment using helper
      const { availableDeployment, assetValues } = await this.calculateAvailableDeployment(vault);

      // Step 7: Create new position - we must have capital after closing existing position
      if (availableDeployment <= 0) {
        throw new Error(`No available capital after closing position: availableDeployment=${availableDeployment}, totalValue=${assetValues.totalVaultValue}, maxUtilization=${vault.strategy.parameters.maxUtilization}% - this indicates a serious calculation issue`);
      }
      await this.createNewPosition(vault, availableDeployment, assetValues);

      // Step 8: Refresh vault data
      await this.vaultDataService.refreshPositionsAndTokens(vault.address);
      vault = await this.vaultDataService.getVault(vault.address);

      // Reset failure tracking on success
      delete this.rebalanceFailures[vaultAddress];

      // Step 6: Emit rebalance completed event
      this.eventManager.emit('PositionRebalanced', {
        vaultAddress: vault.address,
        oldPositionId: position.id,
        currentTick: currentTick,
        reason: 'out_of_range_or_threshold',
        availableDeployment: availableDeployment,
        timestamp: Date.now(),
        log: {
          level: 'info',
          message: `Position ${position.id} rebalanced for vault ${vault.address}`
        }
      });

      // Send notification
      this.sendTelegramMessage(
        `🔄 Position rebalanced: ${vault.address.slice(0,6)}...${vault.address.slice(-4)} ` +
        `(Position ${position.id} was out of range)`
      ).catch(console.error);

    } catch (error) {
      // Track failure
      if (!this.rebalanceFailures[vaultAddress]) {
        this.rebalanceFailures[vaultAddress] = { count: 0, lastAttempt: null };
      }
      this.rebalanceFailures[vaultAddress].count++;
      this.rebalanceFailures[vaultAddress].lastAttempt = Date.now();

      // Enhanced error message with failure count
      const failureCount = this.rebalanceFailures[vaultAddress].count;
      const message = `Rebalance failed (attempt #${failureCount}): ${error.message}`;

      // Check if we've exceeded the failure threshold
      if (failureCount >= 5) {
        this.log(`❌ Vault ${vaultAddress} failed rebalance ${failureCount} times - marking unrecoverable`);

        // Emit event to trigger blacklisting
        this.eventManager.emit('VaultUnrecoverable', {
          vaultAddress,
          reason: `Rebalance failed ${failureCount} times - persistent issue preventing rebalancing`,
          details: {
            failureCount,
            lastError: error.message,
            strategy: this.type
          },
          attempts: failureCount,
          timestamp: Date.now()
        });

        // Send urgent notification
        await this.sendTelegramMessage(
          `🚨 UNRECOVERABLE VAULT (${failureCount} rebalance failures): ${vaultAddress.slice(0,6)}...${vaultAddress.slice(-4)}\n` +
          `Repeated rebalance failures - requires manual intervention\n` +
          `Last error: ${error.message.slice(0, 100)}`
        ).catch(console.error);

        // Clear failure tracking since it will be blacklisted
        delete this.rebalanceFailures[vaultAddress];

        // Don't re-throw - vault will be blacklisted
        return;
      }

      // Log the enhanced error
      console.error(`[${vaultAddress}] ${message}`);

      // Send enhanced Telegram notification
      this.sendTelegramMessage(
        `⚠️ Rebalance failed (${failureCount}x): ${vaultAddress.slice(0,6)}...${vaultAddress.slice(-4)} ` +
        `- ${error.message.slice(0, 100)}`
      ).catch(console.error);

      // Re-throw with context - will be caught by handleSwapEvent
      throw new Error(message);
    }
  }

  async collectFees(vault, position) {
    try {
      this.log(`Collecting fees for vault ${vault.address} position ${position.id}`);

      // 1. Get pool metadata and token data
      const poolMetadata = this.poolData[position.pool];
      if (!poolMetadata) {
        throw new Error(`No pool metadata found for ${position.pool}`);
      }

      const token0Data = this.tokens[poolMetadata.token0Symbol];
      const token1Data = this.tokens[poolMetadata.token1Symbol];

      if (!token0Data || !token1Data) {
        throw new Error(`Missing token data for pool ${position.pool}`);
      }

      // 2. Get adapter for the platform
      const adapter = this.adapters.get(poolMetadata.platform);
      if (!adapter) {
        throw new Error(`No adapter found for platform ${poolMetadata.platform}`);
      }

      // 3. Generate claim fees transaction data
      this.log(`Generating claim fees transaction for position ${position.id}`);
      const claimFeesData = await adapter.generateClaimFeesData({
        positionId: position.id,
        walletAddress: vault.address,
        token0Address: token0Data.address,
        token0Decimals: token0Data.decimals,
        token1Address: token1Data.address,
        token1Decimals: token1Data.decimals,
        provider: this.provider
      });

      // 4. Execute through vault's secure collect function
      this.log(`Executing fee collection through vault...`);

      const txResult = await this.executeBatchTransactions(
        vault,
        [{ to: claimFeesData.to, data: claimFeesData.data }],
        'fee collection',
        'collect'
      );

      const receipt = txResult.receipt;

      // 5. Parse Collect event to get collected amounts
      // Note: The Pool emits the Collect event, not the Position Manager
      // Correct Uniswap V3 Pool Collect event signature (includes recipient)
      const poolCollectInterface = new ethers.utils.Interface([
        'event Collect(address indexed owner, address recipient, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount0, uint128 amount1)'
      ]);

      let token0Collected = ethers.BigNumber.from(0);
      let token1Collected = ethers.BigNumber.from(0);

      for (const log of receipt.logs) {
        try {
          // The Collect event comes from the Pool contract, not Position Manager
          // Event signature: 0x70935338e69775456a85ddef226c395fb668b63fa0115f5f20610b388e6ca9c0
          if (log.topics[0] === '0x70935338e69775456a85ddef226c395fb668b63fa0115f5f20610b388e6ca9c0' &&
              log.address.toLowerCase() === position.pool.toLowerCase()) {

            const decoded = poolCollectInterface.parseLog(log);

            // Check if this collect is for our vault (recipient) and our position's tick range
            if (decoded.args.recipient.toLowerCase() === vault.address.toLowerCase() &&
                decoded.args.tickLower.toString() === position.tickLower.toString() &&
                decoded.args.tickUpper.toString() === position.tickUpper.toString()) {
              token0Collected = ethers.BigNumber.from(decoded.args.amount0.toString());
              token1Collected = ethers.BigNumber.from(decoded.args.amount1.toString());
              break;
            }
          }
        } catch (e) {
          // Silently continue if parsing fails
        }
      }

      // Format collected amounts for logging
      const token0CollectedFormatted = parseFloat(ethers.utils.formatUnits(token0Collected, token0Data.decimals));
      const token1CollectedFormatted = parseFloat(ethers.utils.formatUnits(token1Collected, token1Data.decimals));


      // Use the helper to distribute fees to owner
      const distribution = await this.distributeFeesToOwner(
        vault,
        token0Collected,
        token1Collected,
        token0Data,
        token1Data,
        'explicit_collection'
      );


      // Get current USD prices for event logging
      const prices = await fetchTokenPrices(
        [poolMetadata.token0Symbol, poolMetadata.token1Symbol],
        CACHE_DURATIONS['30-SECONDS']
      );

      const token0USD = token0CollectedFormatted * prices[poolMetadata.token0Symbol.toUpperCase()];
      const token1USD = token1CollectedFormatted * prices[poolMetadata.token1Symbol.toUpperCase()];
      const totalUSD = token0USD + token1USD;

      // 6. Emit FeesCollected event with actual amounts
      this.eventManager.emit('FeesCollected', {
        vaultAddress: vault.address,
        positionId: position.id,
        source: 'explicit_collection',
        token0Collected: token0CollectedFormatted,
        token1Collected: token1CollectedFormatted,
        token0Symbol: poolMetadata.token0Symbol,
        token1Symbol: poolMetadata.token1Symbol,
        token0USD,
        token1USD,
        totalUSD,
        token0ToOwner: parseFloat(ethers.utils.formatUnits(distribution.token0ToOwner, token0Data.decimals)),
        token1ToOwner: parseFloat(ethers.utils.formatUnits(distribution.token1ToOwner, token1Data.decimals)),
        token0Reinvested: parseFloat(ethers.utils.formatUnits(distribution.token0Reinvested, token0Data.decimals)),
        token1Reinvested: parseFloat(ethers.utils.formatUnits(distribution.token1Reinvested, token1Data.decimals)),
        reinvestmentRatio: distribution.reinvestmentRatio,
        transactionHash: receipt.transactionHash,
        timestamp: Date.now(),
        log: {
          level: 'info',
          message: `💰 Collected $${totalUSD.toFixed(2)} in fees from position ${position.id} (${distribution.reinvestmentRatio}% reinvested)`,
          includeData: true
        }
      });

      return {
        token0Collected: token0CollectedFormatted,
        token1Collected: token1CollectedFormatted,
        token0ToOwner: parseFloat(ethers.utils.formatUnits(distribution.token0ToOwner, token0Data.decimals)),
        token1ToOwner: parseFloat(ethers.utils.formatUnits(distribution.token1ToOwner, token1Data.decimals)),
        token0Reinvested: parseFloat(ethers.utils.formatUnits(distribution.token0Reinvested, token0Data.decimals)),
        token1Reinvested: parseFloat(ethers.utils.formatUnits(distribution.token1Reinvested, token1Data.decimals)),
        totalUSD,
        transactionHash: receipt.transactionHash
      };

    } catch (error) {
      this.log(`Error collecting fees for position ${position.id}: ${error.message}`);

      // Emit error event
      this.eventManager.emit('FeeCollectionFailed', {
        vaultAddress: vault.address,
        positionId: position.id,
        error: error.message,
        timestamp: Date.now(),
        log: {
          level: 'error',
          message: `❌ Failed to collect fees for position ${position.id}: ${error.message}`,
          includeData: true
        }
      });

      throw error; // Re-throw for vault blacklisting
    }
  }
  //#endregion

  //#region Recovery Functions
  /**
   * Check if vault needs recovery
   * @memberof module:BabyStepsStrategy.BabyStepsStrategy
   * @param {Object} vault - Vault object
   * @returns {Promise<boolean>} True if vault needs recovery
   * @since 1.0.0
   */
  async needsRecovery(vault) {
    // BabySteps: if we have 0 positions, we had a failed rebalance and need recovery
    return Object.keys(vault.positions || {}).length === 0;
  }

  /**
   * Attempt vault recovery
   * @memberof module:BabyStepsStrategy.BabyStepsStrategy
   * @param {Object} vault - Vault object
   * @returns {Promise<boolean>} True if recovery was successful
   * @since 1.0.0
   */
  async attemptRecovery(vault) {
    const vaultAddress = vault.address;

    try {
      this.log(`Attempting recovery for vault ${vaultAddress} with no positions`);

      // Check available capital
      const { availableDeployment, assetValues } = await this.calculateAvailableDeployment(vault);

      if (availableDeployment <= 0) {
        // Vault has no positions AND no capital - this is unrecoverable
        this.log(`❌ Vault ${vaultAddress} has no positions AND no capital - unrecoverable`);

        // Emit event to request blacklisting
        this.eventManager.emit('VaultUnrecoverable', {
          vaultAddress,
          reason: 'No capital for recovery - vault has 0 positions and 0 available deployment',
          details: {
            availableDeployment,
            totalValue: assetValues.totalVaultValue,
            strategy: this.type
          },
          attempts: this.rebalanceFailures[vaultAddress]?.count || 1,
          timestamp: Date.now()
        });

        // Clear from failure tracking since it will be blacklisted
        delete this.rebalanceFailures[vaultAddress];

        // Send urgent notification
        await this.sendTelegramMessage(
          `🚨 UNRECOVERABLE VAULT: ${vaultAddress.slice(0,6)}...${vaultAddress.slice(-4)}\n` +
          `Reason: No positions, no capital for recovery\n` +
          `Available: $${availableDeployment.toFixed(2)}, Total Value: $${assetValues.totalVaultValue.toFixed(2)}`
        ).catch(console.error);

        return false;
      }

      // Create new position using existing method
      await this.createNewPosition(vault, availableDeployment, assetValues);

      // Refresh vault data
      await this.vaultDataService.refreshPositionsAndTokens(vaultAddress);
      vault = await this.vaultDataService.getVault(vaultAddress);

      // Clear failure tracking on success
      delete this.rebalanceFailures[vaultAddress];

      // Emit position rebalanced event (recovery completed with position creation)
      this.eventManager.emit('PositionRebalanced', {
        vaultAddress: vault.address,
        oldPositionId: null, // Recovery doesn't have an old position
        currentTick: null, // Will be set by the new position
        reason: 'recovery',
        availableDeployment: availableDeployment,
        timestamp: Date.now(),
        log: {
          level: 'info',
          message: `Vault ${vault.address} recovered with new position creation`
        }
      });

      // Emit recovery event
      this.eventManager.emit('VaultRecovered', {
        vaultAddress,
        availableDeployment,
        timestamp: Date.now()
      });

      // Send notification
      this.sendTelegramMessage(
        `✅ Vault recovered: ${vaultAddress.slice(0,6)}...${vaultAddress.slice(-4)} ` +
        `(New position created with $${availableDeployment.toFixed(2)})`
      ).catch(console.error);

      this.log(`Successfully recovered vault ${vaultAddress}`);
      return true;

    } catch (error) {
      // Update failure tracking for backoff
      if (!this.rebalanceFailures[vaultAddress]) {
        this.rebalanceFailures[vaultAddress] = { count: 0, lastAttempt: null };
      }
      this.rebalanceFailures[vaultAddress].count++;
      this.rebalanceFailures[vaultAddress].lastAttempt = Date.now();

      // Check if we've exceeded the failure threshold
      if (this.rebalanceFailures[vaultAddress].count >= 5) {
        this.log(`❌ Vault ${vaultAddress} failed recovery ${this.rebalanceFailures[vaultAddress].count} times - marking unrecoverable`);

        // Emit event to trigger blacklisting
        this.eventManager.emit('VaultUnrecoverable', {
          vaultAddress,
          reason: `Recovery failed ${this.rebalanceFailures[vaultAddress].count} times - persistent issue preventing position creation`,
          details: {
            failureCount: this.rebalanceFailures[vaultAddress].count,
            lastError: error.message,
            strategy: this.type
          },
          attempts: this.rebalanceFailures[vaultAddress].count,
          timestamp: Date.now()
        });

        // Send urgent notification
        await this.sendTelegramMessage(
          `🚨 UNRECOVERABLE VAULT (${this.rebalanceFailures[vaultAddress].count} failures): ${vaultAddress.slice(0,6)}...${vaultAddress.slice(-4)}\n` +
          `Repeated recovery failures - requires manual intervention\n` +
          `Last error: ${error.message.slice(0, 100)}`
        ).catch(console.error);

        // Clear failure tracking since it will be blacklisted
        delete this.rebalanceFailures[vaultAddress];
      }

      console.error(`Failed to recover vault ${vaultAddress}:`, error);
      throw error;
    }
  }
  //#endregion

  //#region Emergency Exit Helpers
  /**
   * Set up event listeners for emergency exit baseline caching
   * @memberof module:BabyStepsStrategy.BabyStepsStrategy
   * @private
   * @since 1.0.0
   */
  setupEmergencyExitBaselineListeners() {
    // Listen for new position creation to cache baseline tick
    this.eventManager.subscribe('NewPositionCreated', (data) => {
      // Cache the current tick as baseline for new positions
      this.emergencyExitBaseline[data.vaultAddress] = data.currentTick;
      this.log(`Cached emergency exit baseline tick ${data.currentTick} for vault ${data.vaultAddress} (new position ${data.positionId})`);
    });

    // Listen for initial position evaluation during vault initialization
    this.eventManager.subscribe('InitialPositionsEvaluated', async (data) => {
      // Only process if we have aligned positions
      if (!data.alignedPositionIds || data.alignedPositionIds.length === 0) {
        return;
      }

      // Skip if baseline already exists (safety check)
      if (this.emergencyExitBaseline[data.vaultAddress]) {
        this.log(`Emergency exit baseline already exists for vault ${data.vaultAddress}`);
        return;
      }

      try {
        // Get vault and first aligned position
        const vault = await this.vaultDataService.getVault(data.vaultAddress);
        if (!vault || !vault.positions || data.alignedPositionIds.length === 0) {
          this.log(`Warning: Could not get vault data for ${data.vaultAddress}`);
          return;
        }

        // Get the first aligned position (BabySteps only allows one)
        const positionId = data.alignedPositionIds[0];
        const position = vault.positions[positionId];
        if (!position) {
          this.log(`Warning: Could not find position ${positionId} in vault ${data.vaultAddress}`);
          return;
        }

        // Get pool metadata
        const poolMetadata = this.poolData[position.pool];
        if (!poolMetadata || !poolMetadata.platform) {
          // Fallback to current tick from pool
          const poolData = await this.fetchPoolData(position.pool);
          this.emergencyExitBaseline[data.vaultAddress] = poolData.tick;
          this.log(`Using current tick ${poolData.tick} as baseline for vault ${data.vaultAddress} (missing metadata)`);
          return;
        }

        // Get adapter and calculate original tick
        const adapter = this.adapters.get(poolMetadata.platform);
        if (!adapter || !adapter.calculateOriginalTick) {
          // Fallback to current tick
          const poolData = await this.fetchPoolData(position.pool);
          this.emergencyExitBaseline[data.vaultAddress] = poolData.tick;
          this.log(`Using current tick ${poolData.tick} as baseline for vault ${data.vaultAddress} (no calculateOriginalTick)`);
          return;
        }

        // Calculate the original tick from position's range
        const originalTick = adapter.calculateOriginalTick(
          {
            tickLower: position.tickLower,
            tickUpper: position.tickUpper,
            fee: poolMetadata.fee
          },
          vault.strategy.parameters.targetRangeUpper,
          vault.strategy.parameters.targetRangeLower
        );

        this.emergencyExitBaseline[data.vaultAddress] = originalTick;
        this.log(`Set emergency exit baseline tick ${originalTick} for vault ${data.vaultAddress} (aligned position ${positionId})`);

      } catch (error) {
        this.log(`Error setting baseline for vault ${data.vaultAddress}: ${error.message}`);
        // Don't set a fallback - better to have no baseline than a wrong one
      }
    });

  }


  /**
   * Execute emergency exit - close all positions and halt vault operations
   * @memberof module:BabyStepsStrategy.BabyStepsStrategy
   * @param {Object} vault - Vault object
   * @param {Object} position - Position that triggered the exit
   * @param {number} currentTick - Current pool tick
   * @returns {Promise<void>}
   * @since 1.0.0
   */
  async executeEmergencyExit(vault, position, currentTick) {
    const vaultAddress = vault.address;

    try {
      this.log(`Executing emergency exit for vault ${vaultAddress}`);

      // Step 1: Close ALL positions immediately
      // Create a shallow copy to avoid mutation issues during closure
      const allPositions = { ...(vault.positions) };

      if (Object.keys(allPositions).length > 0) {
        this.log(`Closing ${Object.keys(allPositions).length} positions for emergency exit`);
        await this.closePositions(vault, allPositions);
      }

      // Step 2: Mark vault as requiring manual intervention
      // Add to blacklist to prevent automated operations
      this.eventManager.emit('VaultUnrecoverable', {
        vaultAddress,
        reason: 'Emergency exit triggered - price movement exceeded safety threshold',
        details: {
          triggerTick: currentTick,
          baselineTick: this.emergencyExitBaseline[vaultAddress],
          emergencyExitTrigger: vault.strategy.parameters.emergencyExitTrigger,
          strategy: this.type
        },
        attempts: 1, // Emergency exit counts as final attempt
        timestamp: Date.now()
      });

      // Step 3: Send urgent notification
      await this.sendTelegramMessage(
        `🚨 EMERGENCY EXIT EXECUTED: ${vaultAddress.slice(0,6)}...${vaultAddress.slice(-4)}\n` +
        `All positions closed due to extreme price movement.\n` +
        `Vault requires manual review before reactivation.`
      ).catch(console.error);

      // Step 4: Clean up baseline (will be done by cleanup method when blacklisted)
      // No need to manually delete here

      this.log(`Emergency exit completed for vault ${vaultAddress}`);

    } catch (error) {
      console.error(`CRITICAL: Failed to execute emergency exit for vault ${vaultAddress}:`, error);

      // Even if closing positions fails, we must prevent further automated actions
      this.eventManager.emit('VaultUnrecoverable', {
        vaultAddress,
        reason: `Emergency exit failed: ${error.message}`,
        details: {
          triggerTick: currentTick,
          baselineTick: this.emergencyExitBaseline[vaultAddress],
          error: error.message,
          strategy: this.type
        },
        attempts: 1,
        timestamp: Date.now()
      });

      // Send critical failure notification
      await this.sendTelegramMessage(
        `🚨🚨 CRITICAL: Emergency exit FAILED for vault ${vaultAddress}\nError: ${error.message}\nIMMEDIATE MANUAL INTERVENTION REQUIRED!`
      ).catch(console.error);

      throw error; // Re-throw to ensure error is logged
    }
  }
  //#endregion

  //#region Unused Code
//   /**
//    * Generate comprehensive transaction plan to rebalance vault assets
//    * @memberof module:BabyStepsStrategy.BabyStepsStrategy
//    * @param {Object} vault - Vault object with current state
//    * @param {Object} evaluation - Results from evaluateInitialAssets
//    * @param {Array} evaluation.alignedPositions - Currently aligned positions
//    * @param {Array} evaluation.nonAlignedPositions - Positions to be closed
//    * @param {Array} evaluation.nonAlignedTokens - Available token balances
//    * @param {Object} params - Strategy parameters
//    * @returns {Promise<Object>} Complete transaction plan
//    * @returns {Array} returns.positionTransactions - Position management transactions
//    * @returns {Array} returns.swapTransactions - Token swap transactions
//    * @returns {Object} returns.batchTransaction - Batched transaction data
//    * @returns {number} returns.estimatedGas - Estimated gas for execution
//    * @returns {Object} returns.summary - Summary of planned actions
//    * @example
//    * const plan = await strategy.getRebalanceTransactions(vault, evaluation, params);
//    * console.log(`Plan includes ${plan.summary.swapsRequired} swaps`);
//    * @since 1.0.0
//    */
//   async getRebalanceTransactions(vault, evaluation) {
//     const params = vault.strategy.parameters;

//     try {
//       this.log(`Generating rebalance transactions for vault ${vault.address}`);

//       // Step 1: Calculate total USD value of all assets
//       const assetValuation = await this.calculateTotalAssetValue(vault, evaluation);
//       this.log(`Total vault assets valued at $${assetValuation.totalUsdValue.toFixed(2)}`);

//       // Steps 2-6: REPLACED BY planRebalance orchestrator
//       const rebalancePlanning = await this.planRebalance(vault, evaluation, assetValuation);

//       // Extract components for steps 7-9
//       const optimalConfig = rebalancePlanning.optimalConfig;
//       const liquidationPlan = rebalancePlanning.liquidationPlan;
//       const swapPlan = rebalancePlanning.swapPlan;
//       const positionPlan = rebalancePlanning.positionPlan;
//       const tokenComposition = rebalancePlanning.tokenComposition;

//       // Step 7: Generate transaction data for all operations
//       const transactionData = await this.generateTransactionData(
//         vault,
//         liquidationPlan,
//         swapPlan,
//         positionPlan,
//         params
//       );

//       // Step 8: Create batched transaction
//       const batchTransaction = this.createBatchTransaction(transactionData);

//       // Step 9: Estimate gas and validate
//       if (!params.gasConfig) {
//         throw new Error("gasConfig must be provided in params for gas estimation");
//       }
//       const gasEstimate = await this.estimateTransactionGas(batchTransaction, vault, params.gasConfig);

//       const rebalancePlan = {
//         positionTransactions: transactionData.positionTransactions,
//         swapTransactions: transactionData.swapTransactions,
//         batchTransaction,
//         estimatedGas: gasEstimate,
//         summary: {
//           positionsToClose: liquidationPlan.length,
//           positionsToCreate: positionPlan.create.length,
//           positionsToAddTo: positionPlan.addTo.length,
//           swapsRequired: swapPlan.length,
//           totalUsdValue: assetValuation.totalUsdValue,
//           optimalConfig,
//           tokenComposition: tokenComposition
//         }
//       };

//       this.log(`Rebalance plan: ${rebalancePlan.summary.positionsToClose} closes, ${rebalancePlan.summary.swapsRequired} swaps, ${rebalancePlan.summary.positionsToCreate} creates, ${rebalancePlan.summary.positionsToAddTo} additions`);

//       return rebalancePlan;

//     } catch (error) {
//       this.log(`Error generating rebalance transactions: ${error.message}`);
//       throw error;
//     }
//   }

//   /**
//    * Generate transaction data for all operations
//    * @memberof module:BabyStepsStrategy.BabyStepsStrategy
//    * @param {Object} vault - Vault object
//    * @param {Array} liquidationPlan - Liquidation transactions
//    * @param {Array} swapPlan - Token swap transactions
//    * @param {Object} positionPlan - Position management plan
//    * @param {Array} positionPlan.create - Positions to create
//    * @param {Array} positionPlan.addTo - Positions to add liquidity to
//    * @param {Object} params - Strategy parameters
//    * @returns {Promise<Object>} Transaction data
//    * @returns {Array} returns.positionTransactions - All position-related transactions
//    * @returns {Array} returns.swapTransactions - All swap transactions
//    * @since 1.0.0
//    */
//   async generateTransactionData(vault, liquidationPlan, swapPlan, positionPlan, params) {
//     const positionTransactions = [];
//     const swapTransactions = [];

//     // Generate liquidation transactions
//     for (const liquidation of liquidationPlan) {
//       positionTransactions.push({
//         type: 'close_position',
//         position: liquidation.position,
//         transactionData: liquidation.transactionData,
//         platform: liquidation.platform
//       });
//     }

//     // Generate swap transactions using platform-specific implementation
//     for (const swap of swapPlan) {
//       const swapTxData = await this.generateSwapTransactionData(vault, swap);
//       swapTransactions.push({
//         type: 'swap',
//         fromToken: swap.fromToken,
//         toToken: swap.toToken,
//         amount: swap.amount,
//         expectedOutputUsd: swap.expectedOutputUsd,
//         transactionData: swapTxData
//       });
//     }

//     // Generate position creation transactions
//     for (const creation of positionPlan.create) {
//       const adapter = await this.getAdapterForPlatform(creation.platform);

//       try {
//         const createPositionData = await adapter.generateCreatePositionData({
//           token0Address: creation.token0.address,
//           token1Address: creation.token1.address,
//           feeTier: creation.fee,
//           tickLower: creation.tickLower,
//           tickUpper: creation.tickUpper,
//           token0Amount: creation.token0Amount,
//           token1Amount: creation.token1Amount,
//           provider: this.provider,
//           address: vault.address,
//           chainId: this.serviceConfig.chainId || this.vaultDataService.chainId,
//           slippageTolerance: this.validateSlippage(params.maxSlippage)
//         });

//         positionTransactions.push({
//           type: 'create_position',
//           targetRange: {
//             tickLower: creation.tickLower,
//             tickUpper: creation.tickUpper
//           },
//           tokenAmounts: {
//             token0: creation.token0Amount,
//             token1: creation.token1Amount
//           },
//           transactionData: createPositionData,
//           platform: creation.platform
//         });

//       } catch (error) {
//         this.log(`Error generating create position data: ${error.message}`);
//         throw error;
//       }
//     }

//     // Generate add liquidity transactions
//     for (const addition of positionPlan.addTo) {
//       const adapter = await this.getAdapterForPlatform(addition.position.platform);

//       try {
//         const token0Data = this.vaultDataService.getToken(addition.position.token0?.address);
//         const token1Data = this.vaultDataService.getToken(addition.position.token1?.address);
//         let poolData = this.vaultDataService.getPool(addition.position.pool);

//         // Ensure BigInt fields are properly formatted for the adapter
//         if (poolData) {
//           poolData = {
//             ...poolData,
//             sqrtPriceX96: poolData.sqrtPriceX96.toString(),
//             liquidity: poolData.liquidity.toString()
//           };
//         }

//         const addLiquidityData = await adapter.generateAddLiquidityData({
//           position: addition.position,
//           token0Amount: addition.token0Amount,
//           token1Amount: addition.token1Amount,
//           provider: this.provider,
//           address: vault.address,
//           chainId: this.serviceConfig.chainId || this.vaultDataService.chainId,
//           poolData,
//           token0Data,
//           token1Data,
//           slippageTolerance: this.validateSlippage(params.maxSlippage)
//         });

//         positionTransactions.push({
//           type: 'add_liquidity',
//           position: addition.position,
//           tokenAmounts: {
//             token0: addition.token0Amount,
//             token1: addition.token1Amount
//           },
//           transactionData: addLiquidityData,
//           platform: addition.position.platform
//         });

//       } catch (error) {
//         this.log(`Error generating add liquidity data: ${error.message}`);
//         throw error;
//       }
//     }

//     return {
//       positionTransactions,
//       swapTransactions
//     };
//   }

//   /**
//    * Generate swap transaction data for Uniswap V3
//    * @memberof module:BabyStepsStrategy.BabyStepsStrategy
//    * @param {Object} vault - Vault object containing address
//    * @param {Object} swap - Swap plan details
//    * @param {string} swap.platform - Platform to execute swap on
//    * @param {string} swap.fromTokenAddress - Source token address
//    * @param {string} swap.toTokenAddress - Target token address
//    * @param {string} swap.amount - Amount to swap
//    * @param {number} swap.slippageTolerance - Slippage tolerance percentage
//    * @returns {Promise<Object>} Swap transaction data
//    * @returns {string} returns.to - Contract address to call
//    * @returns {string} returns.data - Encoded transaction data
//    * @returns {string} returns.value - ETH value to send
//    * @since 1.0.0
//    */
//   async generateSwapTransactionData(vault, swap) {
//     try {
//       const adapter = await this.getAdapterForPlatform(swap.platform);

//       // Get token data
//       const fromToken = this.vaultDataService.getToken(swap.fromTokenAddress);
//       const toToken = this.vaultDataService.getToken(swap.toTokenAddress);

//       if (!fromToken || !toToken) {
//         throw new Error(`Missing token data for swap: ${swap.fromToken} -> ${swap.toToken}`);
//       }

//       // Round the swap amount to the token's decimal precision before parsing
//       const roundedAmount = parseFloat(swap.amount).toFixed(fromToken.decimals);

//       // Parse amount based on decimals
//       const amountIn = ethers.utils.parseUnits(roundedAmount, fromToken.decimals);

//       // Calculate minimum amount out based on slippage tolerance - NEVER use 0 for financial safety
//       const slippageMultiplier = 1 - (swap.slippageTolerance / 100);

//       // Calculate expected output based on current market price
//       // This is a simplified calculation - in production, get actual quotes from the router
//       const { fetchTokenPrices } = await import('fum_library/services/coingecko');
//       const prices = await fetchTokenPrices([fromToken.symbol, toToken.symbol]);
//       const fromTokenPrice = prices[fromToken.symbol.toUpperCase()];
//       const toTokenPrice = prices[toToken.symbol.toUpperCase()];

//       if (!fromTokenPrice || !toTokenPrice) {
//         throw new Error(`Unable to get price data for swap ${fromToken.symbol} -> ${toToken.symbol} - cannot calculate safe minimum output`);
//       }

//       const expectedOutputAmount = (parseFloat(roundedAmount) * fromTokenPrice) / toTokenPrice;
//       const amountOutMinimum = ethers.utils.parseUnits(
//         (expectedOutputAmount * slippageMultiplier).toFixed(toToken.decimals),
//         toToken.decimals
//       );

//       // Generate swap transaction data using the adapter
//       const swapData = await adapter.generateSwapData({
//         tokenIn: swap.fromTokenAddress,
//         tokenOut: swap.toTokenAddress,
//         fee: 3000, // TODO: Make fee tier configurable - currently hardcoded to 0.3%
//         recipient: vault.address,
//         amountIn: amountIn.toString(),
//         amountOutMinimum: amountOutMinimum.toString(),
//         sqrtPriceLimitX96: "0", // No price limit
//         provider: this.provider,
//         chainId: this.serviceConfig.chainId || this.vaultDataService.chainId
//       });

//       return swapData;

//     } catch (error) {
//       this.log(`Error generating swap transaction data: ${error.message}`);
//       throw error;
//     }
//   }

//   /**
//    * Execute fee collection for a position
//    * @memberof module:BabyStepsStrategy.BabyStepsStrategy
//    * @param {Object} vault - Vault object with address
//    * @param {Object} position - Position object to collect fees from
//    * @param {Object} fees - Fee information
//    * @param {Object} fees.token0 - Token0 fee details
//    * @param {string} fees.token0 - Formatted fee amount for token0
//    * @param {Object} fees.token1 - Token1 fee details
//    * @param {string} fees.token1 - Formatted fee amount for token1
//    * @param {Object} params - Strategy parameters
//    * @returns {Promise<Object>} Transaction receipt
//    * @throws {Error} If fee collection fails
//    * @since 1.0.0
//    */
//   async executeFeeCollection(vault, position, fees, params) {
//     this.log(`💸 Executing fee collection for position ${position.id}`);

//     try {
//       const provider = this.provider;

//       // Use the position's adapter
//       const adapter = position.adapter;
//       if (!adapter) {
//         throw new Error(`No adapter available for position ${position.id}`);
//       }

//       // Get token data
//       const token0 = position.token0;
//       const token1 = position.token1;

//       if (!token0 || !token1) {
//         throw new Error(`Missing token data for position ${position.id}`);
//       }

//       // Format current balances for better reporting
//       let token0Balance = null;
//       let token1Balance = null;

//       try {
//         if (token0.balance && token0.decimals) {
//           token0Balance = ethers.utils.formatUnits(token0.balance, token0.decimals);
//         }

//         if (token1.balance && token1.decimals) {
//           token1Balance = ethers.utils.formatUnits(token1.balance, token1.decimals);
//         }
//       } catch (balanceError) {
//         // Continue even if balance formatting fails
//       }

//       // Prepare minimal pool data for adapter
//       const poolData = {
//         token0: position.token0,
//         token1: position.token1,
//         poolAddress: position.pool
//       };

//       // Generate transaction data using the adapter
//       const txData = await adapter.generateClaimFeesData({
//         position: position,
//         provider: provider,
//         address: vault.address,
//         chainId: this.serviceConfig.chainId || this.vaultDataService.chainId,
//         poolData: poolData,
//         token0Data: token0,
//         token1Data: token1
//       });

//       if (!txData) {
//         throw new Error("Failed to generate transaction data for fee collection");
//       }

//       // Get exact fee amounts from fees object - no fallbacks for financial data
//       if (!fees.token0 || !fees.token1) {
//         throw new Error(`Invalid fee data: token0 fees: ${fees.token0}, token1 fees: ${fees.token1}`);
//       }
//       const token0Fees = fees.token0;
//       const token1Fees = fees.token1;

//       // Log the vault's token balances before fee collection
//       this.log(`Current balances before fee collection:`);
//       this.log(`- ${token0.symbol}: ${token0Balance || 'balance unavailable'}`);
//       this.log(`- ${token1.symbol}: ${token1Balance || 'balance unavailable'}`);

//       // Log the fees being collected
//       this.log(`Fees to collect:`);
//       this.log(`- ${token0.symbol}: ${token0Fees}`);
//       this.log(`- ${token1.symbol}: ${token1Fees}`);

//       // Prepare transaction for execution
//       const transaction = {
//         target: txData.to,
//         data: txData.data,
//         value: txData.value || 0
//       };

//       // Get vault contract
//       const vaultContract = getVaultContract(vault.address, provider);

//       // Log what we're about to do but don't execute yet
//       this.log(`Executing fee collection transaction via vault ${vault.address}`,
//         { vaultAddress: vault.address, positionId: position.id },
//         'fee_collection',
//         'preparing');

//       // Calculate USD value of fees if possible
//       let usdValue = null;
//       try {
//         const prices = await fetchTokenPrices([token0.symbol, token1.symbol]);
//         const token0Price = prices[token0.symbol.toUpperCase()];
//         const token1Price = prices[token1.symbol.toUpperCase()];

//         if (token0Price && token1Price) {
//           usdValue = ((parseFloat(token0Fees) * token0Price) +
//                       (parseFloat(token1Fees) * token1Price)).toFixed(2);
//         }
//       } catch (priceError) {
//         // Just continue if price fetching fails
//       }

//       // Format data for notification
//       const vaultAddressShort = `${vault.address.slice(0, 6)}...${vault.address.slice(-4)}`;
//       const positionId = position.id;
//       const tokenSymbols = `${token0.symbol}/${token1.symbol}`;

//       // Send notification with properly formatted values before execution
//       await this.sendTelegramMessage(`
// 💸 FEE COLLECTION
// Vault: ${vaultAddressShort}
// Position ID: ${positionId}
// Tokens: ${tokenSymbols}
// Collecting: ${token0Fees} ${token0.symbol}, ${token1Fees} ${token1.symbol}
// Value: $${usdValue || 'unavailable'}
// Current balances: ${token0Balance || 'unavailable'} ${token0.symbol}, ${token1Balance || 'unavailable'} ${token1.symbol}
// `);

//       // Use vault's execute function to send the transaction
//       this.log(`Submitting fee collection transaction for vault ${vault.address}`,
//         { vaultAddress: vault.address, positionId: position.id },
//         'fee_collection',
//         'executing');

//       const tx = await vaultContract.execute([transaction.address], [transaction.data]);

//       this.log(`Fee collection transaction submitted: ${tx.hash}`,
//         { txHash: tx.hash, vaultAddress: vault.address },
//         'fee_collection',
//         'submitted');

//       // Wait for confirmation
//       const receipt = await tx.wait();

//       this.log(`Fee collection transaction confirmed: ${receipt.transactionHash}`,
//         { txHash: receipt.transactionHash, vaultAddress: vault.address },
//         'fee_collection',
//         'confirmed');

//       // Update vault data based on transaction
//       await this.vaultDataService.refreshPositionsAndTokens(vault.address);
//       vault = await this.vaultDataService.getVault(vault.address);

//       // Send notification about successful fee collection
//       await this.sendTelegramMessage(`
// ✅ FEE COLLECTION COMPLETED
// Vault: ${vaultAddressShort}
// Position ID: ${positionId}
// Tokens: ${tokenSymbols}
// Collected: ${token0Fees} ${token0.symbol}, ${token1Fees} ${token1.symbol}
// Value: $${usdValue || 'unavailable'}
// Transaction: https://etherscan.io/tx/${receipt.transactionHash}
//       `);

//       return receipt;
//     } catch (error) {
//       // Log error with structured data
//       this.log(`Error executing fee collection: ${error.message}`,
//         { error: error.message },
//         'fee_collection',
//         'error');

//       // Notify about failed fee collection
//       const vaultAddressShort = vault.address ?
//         `${vault.address.slice(0, 6)}...${vault.address.slice(-4)}` :
//         'invalid vault address';

//       await this.sendTelegramMessage(`
// ❌ FEE COLLECTION FAILED
// Vault: ${vaultAddressShort}
// Position ID: ${position?.id || 'invalid position'}
// Error: ${error.message}
//       `);

//       throw error;
//     }
//   }

//   /**
//    * Enhanced asset evaluation with strategy-specific criteria
//    * @memberof module:BabyStepsStrategy.BabyStepsStrategy
//    * @param {Object} vault - Vault object with current positions and balances
//    * @param {Object} params - Strategy parameters
//    * @param {number} params.rebalanceThresholdUpper - Upper threshold for position evaluation
//    * @param {number} params.rebalanceThresholdLower - Lower threshold for position evaluation
//    * @returns {Promise<Object>} Enhanced evaluation results
//    * @returns {Array} returns.alignedPositions - Positions aligned with strategy
//    * @returns {Array} returns.nonAlignedPositions - Positions not aligned with strategy
//    * @returns {Array} returns.nonAlignedTokens - Token balances not in positions
//    * @returns {boolean} returns.requiresAction - Whether vault needs rebalancing
//    * @since 1.0.0
//    */
//   async evaluateInitialAssets(vault) {
//     // First get basic evaluation from parent class (checks tokens and platforms)
//     const baseEvaluation = await super.evaluateInitialAssets(vault);

//     // If no positions passed basic alignment, no need to check if nonexistent positions are aligned with the strategy specific parameters
//     if (Object.keys(baseEvaluation.alignedPositions).length === 0) {
//       return baseEvaluation;
//     }

//     this.log(`Performing strategy-specific position evaluation for ${Object.keys(baseEvaluation.alignedPositions).length} initially aligned positions`);

//     // Validate pool criteria for all aligned positions
//     const poolValidatedPositions = {};
//     const poolFailedPositions = {};

//     for (const [positionId, position] of Object.entries(baseEvaluation.alignedPositions)) {
//       try {
//         const isPoolValid = await this.validatePoolCriteria(position.pool);
//         if (isPoolValid) {
//           poolValidatedPositions[positionId] = position;
//           this.log(`Position ${positionId} pool ${position.pool} meets TVL criteria`);
//         } else {
//           poolFailedPositions[positionId] = position;
//           this.log(`Position ${positionId} pool ${position.pool} failed TVL criteria`);
//         }
//       } catch (error) {
//         // Infrastructure/configuration errors should bubble up for retry
//         this.log(`Critical pool validation failure for vault ${vault.address}, position ${positionId}: ${error.message}`);
//         throw new Error(`Pool validation failed for position ${positionId} in vault ${vault.address}: ${error.message}`);
//       }
//     }

//     // If no positions passed pool validation, move all to non-aligned and return; no need to continue eval cause no more 'aligned' positions
//     if (Object.keys(poolValidatedPositions).length === 0) {
//       this.log(`No positions passed pool criteria validation`);
//       return {
//         alignedPositions: {},
//         nonAlignedPositions: { ...baseEvaluation.nonAlignedPositions, ...poolFailedPositions },
//         alignedTokens: baseEvaluation.alignedTokens,
//         nonAlignedTokens: baseEvaluation.nonAlignedTokens
//       };
//     }

//     this.log(`${Object.keys(poolValidatedPositions).length} positions passed pool criteria validation`);

//     const params = vault.strategy.parameters;

//     // Validate required strategy parameters
//     if (!params.rebalanceThresholdUpper || !params.rebalanceThresholdLower) {
//       this.log(`Missing required strategy parameters for position evaluation`);
//       throw new Error("Strategy parameters rebalanceThresholdUpper and rebalanceThresholdLower are required");
//     }

//     // Re-categorize the initially aligned positions based on strategy parameters
//     let strategyAlignedPositions = {};
//     let strategyNonAlignedPositions = {};

//     // First collect current ticks for all relevant pools
//     const poolTicks = new Map();
//     for (const position of Object.values(poolValidatedPositions)) {
//       if (!position.pool) {
//         throw new Error(`Position ${position.id} missing required pool address`);
//       }
//       if (poolTicks.has(position.pool)) continue;

//       try {
//         // Get pool metadata from cache
//         const poolMetadata = this.poolData[position.pool];
//         if (!poolMetadata) {
//           throw new Error(`Missing pool metadata for ${position.pool}`);
//         }
//         if (!poolMetadata.platform) {
//           throw new Error(`Pool metadata for ${position.pool} missing platform identifier`);
//         }

//         // Get cached adapter from service
//         const adapter = this.adapters.get(poolMetadata.platform);
//         if (!adapter) {
//           throw new Error(`No adapter available for platform ${poolMetadata.platform}`);
//         }

//         // Use platform-agnostic getCurrentTick method
//         const currentTick = await adapter.getCurrentTick(position.pool, this.provider);
//         poolTicks.set(position.pool, currentTick);
//         this.log(`Current tick for pool ${position.pool}: ${currentTick}`);
//       } catch (error) {
//         throw new Error(`Failed to get current tick for pool ${position.pool}: ${error.message}`);
//       }
//     }

//     // Now evaluate each position based on range and threshold
//     for (const position of Object.values(poolValidatedPositions)) {
//       // Validate required position data
//       if (!position.tickLower || !position.tickUpper) {
//         throw new Error(`Position ${position.id} missing required tick range data: tickLower=${position.tickLower}, tickUpper=${position.tickUpper}`);
//       }
//       if (!position.pool) {
//         throw new Error(`Position ${position.id} missing required pool address`);
//       }

//       // Get current tick for this position's pool
//       const currentTick = poolTicks.get(position.pool);
//       if (currentTick === undefined) {
//         throw new Error(`Missing current tick data for pool ${position.pool} - tick collection failed`);
//       }

//       // Check if position is in range
//       const isInRange = currentTick >= position.tickLower && currentTick <= position.tickUpper;

//       if (!isInRange) {
//         this.log(`Position ${position.id} is out of range: currentTick=${currentTick}, range=${position.tickLower}-${position.tickUpper}`);
//         strategyNonAlignedPositions[position.id] = position;
//         continue;
//       }

//       // Check distance to boundaries (similar to rebalance threshold logic)
//       const rangeSize = position.tickUpper - position.tickLower;

//       // Calculate distance to upper and lower bounds as percentage of range
//       const distanceToUpper = position.tickUpper - currentTick;
//       const distanceToLower = currentTick - position.tickLower;

//       const upperPercentage = distanceToUpper / rangeSize;
//       const lowerPercentage = distanceToLower / rangeSize;

//       // Use the strategy's threshold parameters - convert from percentage to decimal
//       const upperThreshold = params.rebalanceThresholdUpper / 100;
//       const lowerThreshold = params.rebalanceThresholdLower / 100;

//       // If too close to boundaries, consider non-aligned
//       if (upperPercentage <= upperThreshold || lowerPercentage <= lowerThreshold) {
//         this.log(`Position ${position.id} is too close to range boundaries`);
//         this.log(`Upper distance: ${upperPercentage.toFixed(4)}, threshold: ${upperThreshold.toFixed(4)}`);
//         this.log(`Lower distance: ${lowerPercentage.toFixed(4)}, threshold: ${lowerThreshold.toFixed(4)}`);
//         strategyNonAlignedPositions[position.id] = position;
//       } else {
//         // Position passes all criteria so far - it's properly aligned with the strategy range & thresholds
//         strategyAlignedPositions[position.id] = position;
//         this.log(`Position ${position.id} is aligned with strategy parameters`);
//       }
//     }

//     // Combine the strategy non-aligned positions with the base non-aligned positions and pool failed positions
//     let allNonAlignedPositions = {
//       ...baseEvaluation.nonAlignedPositions,
//       ...strategyNonAlignedPositions,
//       ...poolFailedPositions
//     };

//     // Get maximum positions allowed from strategy config
//     const maxPositions = this.config.maxPositions;

//     // Check if we have more aligned positions than allowed by strategy
//     if (Object.keys(strategyAlignedPositions).length > maxPositions) {
//       this.log(`Found ${Object.keys(strategyAlignedPositions).length} aligned positions, but strategy only allows ${maxPositions}`);

//       // Sort positions by how centered the current price is within the range
//       const sortedPositions = Object.values(strategyAlignedPositions).sort((a, b) => {
//         // Get current ticks for the positions (guaranteed to exist due to fail-fast validation)
//         const currentTickA = poolTicks.get(a.pool);
//         const currentTickB = poolTicks.get(b.pool);

//         // Calculate how centered each position is (0.5 = perfectly centered)
//         const rangeA = a.tickUpper - a.tickLower;
//         const rangeB = b.tickUpper - b.tickLower;

//         const centerednessA = (currentTickA - a.tickLower) / rangeA;
//         const centerednessB = (currentTickB - b.tickLower) / rangeB;

//         // Calculate how far each position is from being perfectly centered (0.5)
//         const distanceFromCenterA = Math.abs(centerednessA - 0.5);
//         const distanceFromCenterB = Math.abs(centerednessB - 0.5);

//         // Sort by closest to center (ascending distance from 0.5)
//         return distanceFromCenterA - distanceFromCenterB;
//       });

//       // Keep only the positions within the limit
//       const positionsToKeep = sortedPositions.slice(0, maxPositions);
//       const extraPositions = sortedPositions.slice(maxPositions);

//       // Log details about position selection for debugging
//       this.log(`Keeping ${positionsToKeep.length} positions within limit, moving ${extraPositions.length} to non-aligned`);

//       sortedPositions.forEach((position, index) => {
//         const currentTick = poolTicks.get(position.pool);
//         const range = position.tickUpper - position.tickLower;
//         const centeredness = (currentTick - position.tickLower) / range;
//         const isKept = index < maxPositions;

//         this.log(`Position ${position.id}: centeredness=${centeredness.toFixed(4)}, ` +
//                  `range=${range}, current=${currentTick}, ` +
//                  `bounds=${position.tickLower}-${position.tickUpper}, ` +
//                  `status=${isKept ? 'KEPT' : 'DROPPED'}`);
//       });

//       // Add extra positions to non-aligned list (convert array to object)
//       const extraPositionsObj = extraPositions.reduce((obj, pos) => {
//         obj[pos.id] = pos;
//         return obj;
//       }, {});

//       allNonAlignedPositions = {
//         ...allNonAlignedPositions,
//         ...extraPositionsObj
//       };

//       // Update aligned positions list (convert array back to object)
//       strategyAlignedPositions = positionsToKeep.reduce((obj, pos) => {
//         obj[pos.id] = pos;
//         return obj;
//       }, {});
//     }

//     const requiresAction = Object.keys(baseEvaluation.nonAlignedTokens).length > 0 || Object.keys(allNonAlignedPositions).length > 0;

//     // Return enhanced evaluation results
//     return {
//       alignedPositions: strategyAlignedPositions,
//       nonAlignedPositions: allNonAlignedPositions,
//       alignedTokens: baseEvaluation.alignedTokens,
//       nonAlignedTokens: baseEvaluation.nonAlignedTokens,
//       requiresAction
//     };
//   }

//   /**
//    * Get adapter for a given platform
//    * @memberof module:BabyStepsStrategy.BabyStepsStrategy
//    * @param {string} platform - Platform identifier (e.g., 'uniswap', 'pancakeswap')
//    * @returns {Promise<Object>} Adapter instance for the specified platform
//    * @throws {Error} If no adapter is available for the platform
//    * @since 1.0.0
//    */
//   async getAdapterForPlatform(platform) {
//     const { AdapterFactory } = await import('fum_library/adapters');
//     const adapter = AdapterFactory.getAdapter(platform, this.provider);
//     if (!adapter) {
//       throw new Error(`No adapter available for platform ${platform}`);
//     }
//     return adapter;
//   }

//   /**
//    * Calculate total USD value of all vault assets
//    * @memberof module:BabyStepsStrategy.BabyStepsStrategy
//    * @param {Object} vault - Vault object
//    * @param {Object} evaluation - Asset evaluation results
//    * @param {Object} evaluation.alignedPositions - Aligned positions to value
//    * @param {Object} evaluation.nonAlignedPositions - Non-aligned positions to value
//    * @param {Object} evaluation.alignedTokens - Aligned token balances to enhance
//    * @param {Object} evaluation.nonAlignedTokens - Non-aligned token balances to enhance
//    * @returns {Promise<Object>} Asset valuation breakdown
//    * @returns {number} returns.totalUsdValue - Total USD value of all assets
//    * @returns {number} returns.alignedPositionValue - USD value of aligned position
//    * @returns {Object} returns.tokenPrices - Current token prices used
//    * @since 1.0.0
//    */
//   async calculateTotalAssetValue(vault, evaluation) {
//     // Step 1: Process non-aligned positions to add their tokens to inventory
//     for (const position of Object.values(evaluation.nonAlignedPositions)) {
//       // Get pool metadata
//       const poolData = this.poolData[position.pool];
//       if (!poolData) {
//         throw new Error(`Missing pool data for position ${position.id} at pool ${position.pool}`);
//       }

//       // Get adapter
//       const adapter = this.adapters.get(poolData.platform);
//       if (!adapter) {
//         throw new Error(`No adapter found for platform ${poolData.platform}`);
//       }

//       // Get token configs
//       const token0Symbol = poolData.token0Symbol;
//       const token1Symbol = poolData.token1Symbol;
//       const token0Data = this.tokens[token0Symbol];
//       const token1Data = this.tokens[token1Symbol];

//       if (!token0Data || !token1Data) {
//         throw new Error(`Missing token configuration for ${token0Symbol} or ${token1Symbol}`);
//       }

//       // Get fresh pool data and calculate amounts
//       const freshPoolData = await adapter.getPoolData(position.pool, {}, this.provider);
//       const [token0Amount, token1Amount] = await adapter.calculateTokenAmounts(
//         position,
//         freshPoolData,
//         token0Data,
//         token1Data
//       );

//       // Add token0 to appropriate category
//       const token0Aligned = vault.targetTokens.includes(token0Symbol);
//       const token0Category = token0Aligned ? evaluation.alignedTokens : evaluation.nonAlignedTokens;

//       if (token0Category[token0Symbol]) {
//         // Add to existing amount
//         const existing = BigInt(token0Category[token0Symbol].amount);
//         token0Category[token0Symbol].amount = (existing + token0Amount).toString();
//       } else {
//         // Create new entry
//         token0Category[token0Symbol] = {
//           amount: token0Amount.toString()
//         };
//       }

//       // Add token1 to appropriate category
//       const token1Aligned = vault.targetTokens.includes(token1Symbol);
//       const token1Category = token1Aligned ? evaluation.alignedTokens : evaluation.nonAlignedTokens;

//       if (token1Category[token1Symbol]) {
//         const existing = BigInt(token1Category[token1Symbol].amount);
//         token1Category[token1Symbol].amount = (existing + token1Amount).toString();
//       } else {
//         token1Category[token1Symbol] = {
//           amount: token1Amount.toString()
//         };
//       }
//     }

//     // Step 2: Collect all token symbols for price fetching
//     const allTokenSymbols = new Set();
//     Object.keys(evaluation.alignedTokens).forEach(s => allTokenSymbols.add(s));
//     Object.keys(evaluation.nonAlignedTokens).forEach(s => allTokenSymbols.add(s));

//     // Also need symbols from aligned position for its value calculation
//     if (Object.keys(evaluation.alignedPositions).length > 0) {
//       const alignedPosition = Object.values(evaluation.alignedPositions)[0];
//       const poolData = this.poolData[alignedPosition.pool];
//       if (!poolData) {
//         throw new Error(`Missing pool data for aligned position ${alignedPosition.id}`);
//       }
//       allTokenSymbols.add(poolData.token0Symbol);
//       allTokenSymbols.add(poolData.token1Symbol);
//     }

//     if (allTokenSymbols.size === 0) {
//       return { totalUsdValue: 0, alignedPositionValue: 0, tokenPrices: {} };
//     }

//     // Step 3: Fetch all token prices at once (30 second cache for trading decisions)
//     const tokenPrices = await fetchTokenPrices(Array.from(allTokenSymbols), CACHE_DURATIONS['30-SECONDS']);

//     // Step 4: Enhance token objects with prices and USD values
//     let totalTokenValue = 0;

//     // Process aligned tokens
//     for (const [symbol, tokenObj] of Object.entries(evaluation.alignedTokens)) {
//       const tokenData = this.tokens[symbol];
//       if (!tokenData) {
//         throw new Error(`Missing token configuration for ${symbol}`);
//       }

//       const price = tokenPrices[symbol.toUpperCase()];
//       if (!price) {
//         throw new Error(`Missing price data for ${symbol}`);
//       }

//       // Add price and calculate USD value
//       tokenObj.price = price;
//       tokenObj.usdValue = parseFloat(ethers.utils.formatUnits(tokenObj.amount, tokenData.decimals)) * price;
//       totalTokenValue += tokenObj.usdValue;
//     }

//     // Process non-aligned tokens
//     for (const [symbol, tokenObj] of Object.entries(evaluation.nonAlignedTokens)) {
//       const tokenData = this.tokens[symbol];
//       if (!tokenData) {
//         throw new Error(`Missing token configuration for ${symbol}`);
//       }

//       const price = tokenPrices[symbol.toUpperCase()];
//       if (!price) {
//         throw new Error(`Missing price data for ${symbol}`);
//       }

//       tokenObj.price = price;
//       tokenObj.usdValue = parseFloat(ethers.utils.formatUnits(tokenObj.amount, tokenData.decimals)) * price;
//       totalTokenValue += tokenObj.usdValue;
//     }

//     // Step 5: Calculate aligned position value for maxUtilization
//     let alignedPositionValue = 0;

//     if (Object.keys(evaluation.alignedPositions).length > 0) {
//       const position = Object.values(evaluation.alignedPositions)[0]; // Baby Steps has max 1

//       // Get pool metadata
//       const poolData = this.poolData[position.pool];
//       if (!poolData) {
//         throw new Error(`Missing pool data for aligned position ${position.id}`);
//       }

//       // Get adapter
//       const adapter = this.adapters.get(poolData.platform);
//       if (!adapter) {
//         throw new Error(`No adapter found for platform ${poolData.platform}`);
//       }

//       // Get token configs
//       const token0Data = this.tokens[poolData.token0Symbol];
//       const token1Data = this.tokens[poolData.token1Symbol];

//       if (!token0Data || !token1Data) {
//         throw new Error(`Missing token configuration for position tokens`);
//       }

//       // Get fresh pool data and calculate amounts
//       const freshPoolData = await adapter.getPoolData(position.pool, {}, this.provider);
//       const [token0Amount, token1Amount] = await adapter.calculateTokenAmounts(
//         position,
//         freshPoolData,
//         token0Data,
//         token1Data
//       );

//       // Calculate USD value using fetched prices
//       const token0Price = tokenPrices[poolData.token0Symbol.toUpperCase()];
//       const token1Price = tokenPrices[poolData.token1Symbol.toUpperCase()];

//       if (!token0Price || !token1Price) {
//         throw new Error(`Missing price data for position tokens`);
//       }

//       const token0Value = parseFloat(ethers.utils.formatUnits(token0Amount, token0Data.decimals)) * token0Price;
//       const token1Value = parseFloat(ethers.utils.formatUnits(token1Amount, token1Data.decimals)) * token1Price;

//       alignedPositionValue = token0Value + token1Value;
//     }

//     // Return valuation results
//     return {
//       totalUsdValue: totalTokenValue + alignedPositionValue,
//       alignedPositionValue,
//       tokenPrices
//     };
//   }

//   /**
//    * Create batched transaction for vault execution
//    * @memberof module:BabyStepsStrategy.BabyStepsStrategy
//    * @param {Object} transactionData - All transaction data
//    * @param {Array} transactionData.positionTransactions - Position transactions
//    * @param {Array} transactionData.swapTransactions - Swap transactions
//    * @returns {Object} Batch transaction
//    * @returns {Array<string>} returns.targets - Target contract addresses
//    * @returns {Array<string>} returns.calldatas - Encoded calldata for each target
//    * @returns {Array<number>} returns.values - ETH values for each call
//    * @since 1.0.0
//    */
//   createBatchTransaction(transactionData) {
//     const targets = [];
//     const calldatas = [];
//     const values = [];

//     // Add position transactions
//     for (const tx of transactionData.positionTransactions) {
//       targets.push(tx.transactionData.to);
//       calldatas.push(tx.transactionData.data);
//       values.push(tx.transactionData.value || 0);
//     }

//     // Add swap transactions
//     for (const tx of transactionData.swapTransactions) {
//       targets.push(tx.transactionData.to);
//       calldatas.push(tx.transactionData.data);
//       values.push(tx.transactionData.value || 0);
//     }

//     return {
//       targets,
//       calldatas,
//       values
//     };
//   }

//   /**
//    * Estimate gas for the batch transaction
//    * @memberof module:BabyStepsStrategy.BabyStepsStrategy
//    * @param {Object} batchTransaction - Batch transaction data
//    * @param {Array} batchTransaction.targets - Target addresses
//    * @param {Array} batchTransaction.calldatas - Call data
//    * @param {Array} batchTransaction.values - ETH values
//    * @param {Object} vault - Vault object
//    * @param {Object} gasConfig - Gas configuration parameters
//    * @param {number} gasConfig.baseGas - Base gas amount for transactions
//    * @param {number} gasConfig.perTransactionGas - Gas per transaction in batch
//    * @returns {Promise<number>} Estimated gas units
//    * @since 1.0.0
//    */
//   async estimateTransactionGas(batchTransaction, vault, gasConfig) {
//     try {
//       const provider = this.provider;
//       if (!provider) {
//         throw new Error("No provider available for gas estimation");
//       }

//       // Validate gas configuration - no hardcoded gas values allowed
//       if (!gasConfig || !gasConfig.baseGas || !gasConfig.perTransactionGas) {
//         throw new Error("Gas configuration (baseGas and perTransactionGas) must be provided - no default gas estimates allowed");
//       }

//       // Calculate estimation based on configuration
//       const estimatedGas = gasConfig.baseGas + (batchTransaction.targets.length * gasConfig.perTransactionGas);

//       return estimatedGas;

//     } catch (error) {
//       this.log(`Error estimating gas: ${error.message}`);
//       throw new Error(`Failed to estimate gas: ${error.message} - cannot proceed without valid gas configuration`);
//     }
//   }

//   /**
//    * Parse strategy parameters from array
//    * @memberof module:BabyStepsStrategy.BabyStepsStrategy
//    * @param {Array} params - Raw parameters array from contract
//    * @param {number} params[0] - Target range upper (basis points)
//    * @param {number} params[1] - Target range lower (basis points)
//    * @param {number} params[2] - Rebalance threshold upper (basis points)
//    * @param {number} params[3] - Rebalance threshold lower (basis points)
//    * @param {boolean} params[4] - Fee reinvestment enabled
//    * @param {number} params[5] - Reinvestment trigger (basis points)
//    * @param {number} params[6] - Reinvestment ratio (basis points)
//    * @param {number} params[7] - Max slippage (basis points)
//    * @param {number} params[8] - Emergency exit trigger (basis points)
//    * @param {number} params[9] - Max utilization (basis points)
//    * @returns {Object} Parsed parameters object
//    * @returns {number} returns.targetRangeUpper - Target range upper percentage
//    * @returns {number} returns.targetRangeLower - Target range lower percentage
//    * @returns {number} returns.rebalanceThresholdUpper - Rebalance threshold upper percentage
//    * @returns {number} returns.rebalanceThresholdLower - Rebalance threshold lower percentage
//    * @returns {boolean} returns.feeReinvestment - Whether fee reinvestment is enabled
//    * @returns {number} returns.reinvestmentTrigger - Fee reinvestment trigger in USD
//    * @returns {number} returns.reinvestmentRatio - Reinvestment ratio percentage
//    * @returns {number} returns.maxSlippage - Maximum slippage percentage
//    * @returns {number} returns.emergencyExitTrigger - Emergency exit trigger percentage
//    * @returns {number} returns.maxUtilization - Maximum capital utilization percentage
//    * @throws {Error} If parameters cannot be parsed
//    * @since 1.0.0
//    */
//   parseParamsMethod(params) {
//     if (!params) {
//       throw new Error("No strategy parameters provided");
//     }

//     try {
//       return {
//         targetRangeUpper: Number(params[0]) / 100, // Convert basis points to percentage
//         targetRangeLower: Number(params[1]) / 100,
//         rebalanceThresholdUpper: Number(params[2]) / 100,
//         rebalanceThresholdLower: Number(params[3]) / 100,
//         feeReinvestment: params[4],
//         reinvestmentTrigger: Number(params[5]) / 100,
//         reinvestmentRatio: Number(params[6]) / 100,
//         maxSlippage: Number(params[7]) / 100,
//         emergencyExitTrigger: Number(params[8]) / 100,
//         maxUtilization: Number(params[9]) / 100
//       };
//     } catch (error) {
//       throw new Error(`Error parsing strategy parameters: ${error.message}`);
//     }
//   }

//   /**
//    * Evaluate if fee reinvestment is needed
//    * @memberof module:BabyStepsStrategy.BabyStepsStrategy
//    * @param {Object} vault - Vault object
//    * @param {Object} dynamicState - Current dynamic state with fee information
//    * @param {Object} position - Position object with pool information
//    * @param {number} currentTick - Current tick
//    * @param {string} sqrtPriceX96 - Square root price X96
//    * @param {Object} params - Strategy parameters
//    * @param {boolean} params.feeReinvestment - Whether fee reinvestment is enabled
//    * @param {number} params.reinvestmentTrigger - USD threshold for fee collection
//    * @param {number} params.minCheckInterval - Minimum interval between position checks in milliseconds
//    * @returns {Promise<boolean>} Whether any fee collection action was taken
//    * @since 1.0.0
//    */
//   async evaluateFeeReinvestment(vault, dynamicState, position, currentTick, sqrtPriceX96, params) {
//     if (!params.feeReinvestment) {
//       return false; // Skip if fee reinvestment is disabled
//     }

//     try {
//       // Get updated vault data - MUST have current data for fee processing
//       const updatedVault = await this.vaultDataService.getVault(data.vaultAddress);

//       // Fail if we couldn't get updated data
//       if (!updatedVault) {
//         throw new Error(`Failed to get updated vault data for ${vault.address}`);
//       }

//       // Update vault with current data
//       Object.assign(vault, updatedVault);

//       // Get positions from VaultDataService and find relevant ones in this pool
//       const positions = this.vaultDataService.getVaultPositions(vault.address);
//       const poolPositions = positions.filter(pos =>
//         pos.pool && pos.pool.toLowerCase() === position.pool.toLowerCase()
//       );

//       if (poolPositions.length === 0) {
//         this.log(`No positions found in pool ${position.pool}`);
//         return false;
//       }

//       let actionTaken = false;
//       // Process each position's fees
//       for (const position of poolPositions) {
//         // Check if we've recently processed this position (rate limiting)
//         const cacheKey = `${vault.address}-${position.id}`;
//         const now = Date.now();
//         const lastCheck = this.lastPositionCheck[cacheKey] || 0;

//         // Only check each position based on configured interval - no hardcoded timings
//         if (!params.minCheckInterval) {
//           throw new Error("minCheckInterval must be specified in params - no default timing intervals allowed");
//         }
//         if (now - lastCheck < params.minCheckInterval) {
//           // Skip processing this position - checked recently
//           continue;
//         }

//         this.lastPositionCheck[cacheKey] = now;

//         try {
//           // Get dynamic state for this position
//           const posState = dynamicState.positions[position.id];
//           if (!posState || !posState.fees) {
//             continue; // Skip if no fee data
//           }

//           // Get token data
//           const token0 = position.token0;
//           const token1 = position.token1;

//           if (!token0 || !token1) {
//             this.log(`Missing token data for position ${position.id}`);
//             continue;
//           }

//           // Use position's cached fee calculation from dynamicState
//           const fees = posState.fees;
//           if (!fees || !fees.token0 || !fees.token1) {
//             continue; // Skip if fees data is incomplete
//           }

//           // Convert fees to numbers for consistent handling
//           const amount0Value = Number(fees.token0);
//           const amount1Value = Number(fees.token1);

//           if (amount0Value === 0 && amount1Value === 0) {
//             continue; // Skip zero fees
//           }

//           // Use a price oracle service to get token prices
//           const prices = await fetchTokenPrices([token0.symbol, token1.symbol]);
//           const token0Price = prices[token0.symbol.toUpperCase()];
//           const token1Price = prices[token1.symbol.toUpperCase()];

//           if (!token0Price || !token1Price) {
//             this.log(`Warning: Missing price data for ${token0.symbol} or ${token1.symbol}`);
//             continue;
//           }

//           // Calculate total USD value
//           const usdValue = (amount0Value * token0Price) + (amount1Value * token1Price);

//           // Check if fees exceed reinvestment threshold
//           if (usdValue >= Number(params.reinvestmentTrigger)) {
//             // Log detailed breakdown of fees before collection
//             this.log(`Fee collection triggered:`);
//             this.log(`- Position ${position.id}: ${token0.symbol}/${token1.symbol}`);
//             this.log(`- ${token0.symbol} fees: ${amount0Value.toFixed(6)} ($${(amount0Value * token0Price).toFixed(2)})`);
//             this.log(`- ${token1.symbol} fees: ${amount1Value.toFixed(6)} ($${(amount1Value * token1Price).toFixed(2)})`);
//             this.log(`- Total value: $${usdValue.toFixed(2)} (threshold: $${params.reinvestmentTrigger})`);

//             // Use enhanced logging with actionType = 'fee_collection' and actionResult = 'triggered'
//             const Logger = (await import('../Logger.js')).default;
//             Logger.info(this.name, `Fee collection triggered for position ${position.id}`,
//               {
//                 positionId: position.id,
//                 tokenPair: `${token0.symbol}/${token1.symbol}`,
//                 fees: {
//                   token0: {
//                     symbol: token0.symbol,
//                     amount: amount0Value.toFixed(6),
//                     usdValue: (amount0Value * token0Price).toFixed(2)
//                   },
//                   token1: {
//                     symbol: token1.symbol,
//                     amount: amount1Value.toFixed(6),
//                     usdValue: (amount1Value * token1Price).toFixed(2)
//                   },
//                   totalUsdValue: usdValue.toFixed(2),
//                   threshold: params.reinvestmentTrigger
//                 }
//               },
//               'fee_collection',
//               'triggered'
//             );

//             // Generate and execute fee collection transaction
//             // Add execution back in after logging confirms calculations
//             // await this.executeFeeCollection(vault, position, fees, params);
//             actionTaken = true;

//             // Log success after execution
//             Logger.info(this.name, `Fee collection completed for position ${position.id}`,
//               { positionId: position.id },
//               'fee_collection',
//               'success'
//             );
//           }
//           // Log for fees below threshold with enhanced logging
//           else if (usdValue > 0) {
//             const Logger = (await import('../Logger.js')).default;
//             Logger.info(this.name, `Fee amount below threshold for position ${position.id}`,
//               {
//                 positionId: position.id,
//                 tokenPair: `${token0.symbol}/${token1.symbol}`,
//                 currentUsdValue: usdValue.toFixed(2),
//                 threshold: params.reinvestmentTrigger
//               },
//               'fee_collection',
//               'below_threshold'
//             );
//           }
//         } catch (posError) {
//           console.error(`Error processing position ${position.id} fees:`, posError);
//           // Continue with other positions even if one fails
//         }
//       }

//       return actionTaken;
//     } catch (error) {
//       console.error(`Error evaluating fee reinvestment: ${error.message}`);
//       throw error;
//     }
//   }
  //#endregion

}

export default BabyStepsStrategy;
