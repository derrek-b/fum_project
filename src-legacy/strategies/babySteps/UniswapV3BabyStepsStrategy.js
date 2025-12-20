/**
 * @module strategies/babySteps/UniswapV3BabyStepsStrategy
 * @description Uniswap V3 specific implementation for BabySteps strategy swap event handling
 */

import { ethers } from 'ethers';
import { fetchTokenPrices, CACHE_DURATIONS } from 'fum_library/services/coingecko';
import { getPermit2Nonce, generatePermit2Signature } from 'fum_library/helpers/Permit2Helper';
import { getPlatformAddresses } from 'fum_library/helpers/chainHelpers';

/**
 * Uniswap V3 specific handler for BabySteps strategy
 *
 * @class UniswapV3BabyStepsStrategy
 * @memberof module:strategies/babySteps/UniswapV3BabyStepsStrategy
 */
export default class UniswapV3BabyStepsStrategy {
  /**
   * Constructor for Uniswap V3 BabySteps strategy handler
   * @param {Object} dependencies - Dependencies from parent strategy
   * @param {Object} dependencies.vaultDataService - VaultDataService instance
   * @param {Object} dependencies.eventManager - EventManager instance
   * @param {Object} dependencies.provider - Blockchain provider
   * @param {Map} dependencies.adapters - Platform adapters map
   * @param {number} dependencies.chainId - Chain ID
   * @param {boolean} dependencies.debug - Debug flag
   * @param {Function} dependencies.log - Logging function
   * @param {Object} dependencies.parent - Parent BabyStepsStrategy instance
   */
  constructor(dependencies) {
    // Store dependencies from parent
    this.vaultDataService = dependencies.vaultDataService;
    this.eventManager = dependencies.eventManager;
    this.provider = dependencies.provider;

    this.adapter = dependencies.adapters.get('uniswapV3');

    this.chainId = dependencies.chainId;
    this.debug = dependencies.debug;
    this.log = dependencies.log;
    this.parent = dependencies.parent;  // Reference to parent BabyStepsStrategy
  }

  /**
   * Handle swap event for Uniswap V3
   * @memberof module:strategies/babySteps/UniswapV3BabyStepsStrategy
   * @param {Object} vault - Vault object
   * @param {string} poolAddress - Pool address
   * @param {Object} log - Event log
   * @returns {Promise<void>}
   * @since 1.0.0
   */
  async handleSwapEvent(vault, poolAddress, log) {
    try {
      // Parse Uniswap V3 swap event
      const swapInterface = new ethers.utils.Interface([
        'event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)'
      ]);

      const decoded = swapInterface.parseLog(log);
      const currentTick = Number(decoded.args.tick);
      const sqrtPriceX96 = decoded.args.sqrtPriceX96;

      this.log(`UniswapV3 swap detected - tick: ${currentTick}, sqrtPriceX96: ${sqrtPriceX96}`);


      // Find position for this pool
      const position = Object.values(vault.positions).find(pos =>
        pos.pool.toLowerCase() === poolAddress.toLowerCase()
      );


      if (!position) {
        const errorMessage = `Critical: No position found for pool ${poolAddress} in vault ${vault.address}`;

        // Emit event with log property for automatic logging
        this.eventManager.emit('VaultUnrecoverable', {
          vaultAddress: vault.address,
          reason: errorMessage,
          details: {
            poolAddress,
            platform: 'uniswapV3',
            strategy: this.parent.type,
            availablePositions: Object.keys(vault.positions),
            positionPools: Object.values(vault.positions).map(p => p.pool)
          },
          log: {
            level: 'error',
            message: `❌ Vault ${vault.address} missing position for pool ${poolAddress} - marking unrecoverable`,
            includeData: true
          }
        });

        throw new Error(errorMessage);
      }

      // Check emergency exit trigger
      const emergencyExit = this.checkEmergencyExitTrigger(vault, position, currentTick);

      if (emergencyExit) {
        this.log(`Emergency exit triggered for position ${position.id}`);
        return await this.parent.executeEmergencyExit(vault, position, currentTick);
      }

      // Check if rebalance needed
      const needsRebalance = this.checkRebalanceNeeded(position, currentTick, vault.strategy.parameters);

      if (needsRebalance) {
        this.log(`Rebalance needed for position ${position.id}`);
        return await this.parent.rebalancePosition(vault, position, currentTick);
      }

      // Check if fees need collected if rebalance not needed
      const needsFeesCollected = await this.checkFeesToCollect(vault, position);

      if (needsFeesCollected) {
        this.log(`Fees need collected for vault ${vault.address}`);
        return await this.parent.collectFees(vault, position);
      }

      this.log(`Position ${position.id} is healthy, no action needed`);

    } catch (error) {
      this.log(`Error in UniswapV3 swap event handler: ${error.message}`);
      throw error; // Re-throw for vault blacklisting
    }
  }

  /**
   * Check if emergency exit should be triggered (Uniswap V3 specific)
   * @memberof module:strategies/babySteps/UniswapV3BabyStepsStrategy
   * @param {Object} vault - Vault object
   * @param {Object} position - Position object
   * @param {number} currentTick - Current tick from swap event
   * @returns {boolean} Whether emergency exit should be triggered
   * @since 1.0.0
   */
  checkEmergencyExitTrigger(vault, position, currentTick) {
    // Get baseline tick from parent strategy
    const baselineTick = this.parent.emergencyExitBaseline[vault.address];

    if (baselineTick === undefined || baselineTick === null) {
      this.log(`No emergency exit baseline cached for vault ${vault.address}`);
      return false;
    }

    // Get emergency exit trigger percentage from strategy parameters
    const emergencyExitTrigger = vault.strategy.parameters.emergencyExitTrigger;

    if (!emergencyExitTrigger || emergencyExitTrigger === 0) {
      this.log(`No emergency exit trigger configured for vault ${vault.address}`);
      return false;
    }

    try {
      // Get pool metadata to find token information
      const poolMetadata = this.parent.poolData[position.pool];
      if (!poolMetadata) {
        this.log(`No pool metadata found for pool ${position.pool}`);
        return false;
      }

      // Get token objects from parent token cache
      const token0 = this.parent.tokens[poolMetadata.token0Symbol];
      const token1 = this.parent.tokens[poolMetadata.token1Symbol];

      if (!token0 || !token1) {
        this.log(`Missing token data: ${poolMetadata.token0Symbol} or ${poolMetadata.token1Symbol}`);
        return false;
      }

      // Use adapter to convert ticks to prices for proper comparison
      const baselinePrice = this.adapter.tickToPrice(baselineTick, token0, token1);
      const currentPrice = this.adapter.tickToPrice(currentTick, token0, token1);

      // Calculate price movement percentage
      const baselinePriceValue = parseFloat(baselinePrice.toSignificant(18));
      const currentPriceValue = parseFloat(currentPrice.toSignificant(18));
      const priceRatio = currentPriceValue / baselinePriceValue;
      const priceMovementPercent = Math.abs((priceRatio - 1) * 100);

      if (priceMovementPercent >= emergencyExitTrigger) {
        this.log(`🚨 EMERGENCY EXIT TRIGGERED for vault ${vault.address}:`);
        this.log(`  Price moved ${priceMovementPercent.toFixed(2)}% (trigger: ${emergencyExitTrigger}%)`);
        this.log(`  Baseline: ${baselinePriceValue} → Current: ${currentPriceValue}`);
        return true;
      }

      return false;
    } catch (error) {
      this.log(`Error calculating emergency exit trigger: ${error.message}`);
      return false;
    }
  }

  /**
   * Check if position needs rebalancing (Uniswap V3 specific)
   * @memberof module:strategies/babySteps/UniswapV3BabyStepsStrategy
   * @param {Object} position - Position object
   * @param {number} currentTick - Current tick from swap event
   * @param {Object} params - Strategy parameters
   * @returns {boolean} Whether position needs rebalancing
   * @since 1.0.0
   */
  checkRebalanceNeeded(position, currentTick, params) {
    // Check if completely out of range
    if (currentTick < position.tickLower || currentTick > position.tickUpper) {
      this.log(`Position ${position.id} is OUT OF RANGE`);
      return true;
    }

    // Check threshold distances
    const lowerDistance = currentTick - position.tickLower;
    const upperDistance = position.tickUpper - currentTick;
    const rangeSize = position.tickUpper - position.tickLower;

    // Convert to percentages
    const lowerPercent = (lowerDistance / rangeSize) * 100;
    const upperPercent = (upperDistance / rangeSize) * 100;

    // Check against thresholds
    if (lowerPercent <= params.rebalanceThresholdLower) {
      this.log(`Position ${position.id} too close to lower bound: ${lowerPercent.toFixed(2)}%`);
      return true;
    }

    if (upperPercent <= params.rebalanceThresholdUpper) {
      this.log(`Position ${position.id} too close to upper bound: ${upperPercent.toFixed(2)}%`);
      return true;
    }

    return false;
  }

  /**
   * Check if fees should be collected based on reinvestment trigger
   * @memberof module:strategies/babySteps/UniswapV3BabyStepsStrategy
   * @param {Object} vault - Vault object
   * @param {Object} position - Position object
   * @returns {Promise<boolean>} Whether fees should be collected
   * @since 1.0.0
   */
  async checkFeesToCollect(vault, position) {
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


    this.log(`Checking fees for position ${position.id} with trigger $${reinvestmentTrigger}`);

    try {
      // Get pool metadata
      const poolMetadata = this.parent.poolData[position.pool];
      if (!poolMetadata) {
        this.log(`No pool metadata found for ${position.pool}`);
        return false;
      }

      const token0Data = this.parent.tokens[poolMetadata.token0Symbol];
      const token1Data = this.parent.tokens[poolMetadata.token1Symbol];

      this.log(`Fetching pool data for ${poolMetadata.token0Symbol}/${poolMetadata.token1Symbol} pool...`);

      // Fetch fresh pool data for fee growth globals and current tick
      const poolData = await this.adapter.fetchPoolData(
        token0Data.address,
        token1Data.address,
        poolMetadata.fee,
        this.provider
      );

      this.log(`Pool tick: ${poolData.tick}, Position range: [${position.tickLower}, ${position.tickUpper}]`);

      // Fetch fresh tick data for fee calculations
      const tickData = await this.adapter.fetchTickData(
        position.pool,
        position.tickLower,
        position.tickUpper,
        this.provider
      );

      // Merge tick data into pool data structure
      poolData.ticks = {
        [position.tickLower]: tickData.tickLower,
        [position.tickUpper]: tickData.tickUpper
      };

      // Fetch full position data from NFT Position Manager to get fee growth fields
      const positionManagerAddress = this.adapter.addresses.positionManagerAddress;
      const positionManagerABI = ['function positions(uint256 tokenId) view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)'];
      const positionManager = new ethers.Contract(positionManagerAddress, positionManagerABI, this.provider);
      const fullPositionData = await positionManager.positions(position.id);

      // Create position object with required fee fields
      const positionWithFeeData = {
        ...position,
        feeGrowthInside0LastX128: fullPositionData.feeGrowthInside0LastX128.toString(),
        feeGrowthInside1LastX128: fullPositionData.feeGrowthInside1LastX128.toString(),
        tokensOwed0: fullPositionData.tokensOwed0.toString(),
        tokensOwed1: fullPositionData.tokensOwed1.toString()
      };

      // Calculate uncollected fees
      const [token0FeesRaw, token1FeesRaw] = this.adapter.calculateUncollectedFees(positionWithFeeData, poolData);

      const token0FeesFormatted = Number(token0FeesRaw) / Math.pow(10, token0Data.decimals);
      const token1FeesFormatted = Number(token1FeesRaw) / Math.pow(10, token1Data.decimals);

      this.log(`Raw fees - ${poolMetadata.token0Symbol}: ${token0FeesFormatted.toFixed(6)}, ${poolMetadata.token1Symbol}: ${token1FeesFormatted.toFixed(6)}`);

      // Fetch current USD prices with 30-second cache for fee collection decisions
      this.log(`Fetching USD prices...`);
      const prices = await fetchTokenPrices(
        [poolMetadata.token0Symbol, poolMetadata.token1Symbol],
        CACHE_DURATIONS['30-SECONDS']
      );

      this.log(`Prices - ${poolMetadata.token0Symbol}: $${prices[poolMetadata.token0Symbol.toUpperCase()]}, ${poolMetadata.token1Symbol}: $${prices[poolMetadata.token1Symbol.toUpperCase()]}`);

      // Convert to USD values
      const token0FeesUSD = token0FeesFormatted * prices[poolMetadata.token0Symbol.toUpperCase()];
      const token1FeesUSD = token1FeesFormatted * prices[poolMetadata.token1Symbol.toUpperCase()];
      const totalFeesUSD = token0FeesUSD + token1FeesUSD;

      this.log(`Position ${position.id} fees in USD - ${poolMetadata.token0Symbol}: $${token0FeesUSD.toFixed(4)}, ${poolMetadata.token1Symbol}: $${token1FeesUSD.toFixed(4)}, Total: $${totalFeesUSD.toFixed(4)} (trigger: $${reinvestmentTrigger})`);

      const shouldCollect = totalFeesUSD >= reinvestmentTrigger;
      this.log(`Should collect fees: ${shouldCollect} ($${totalFeesUSD.toFixed(4)} ${shouldCollect ? '>=' : '<'} $${reinvestmentTrigger})`);

      return shouldCollect;

    } catch (error) {
      this.log(`Error checking fees to collect: ${error.message}`);
      return false; // Conservative: don't collect if we can't calculate
    }
  }

  /**
   * Generate buffer swap transactions using AlphaRouter
   * @memberof module:strategies/babySteps/UniswapV3BabyStepsStrategy
   * @param {Array} swapInstructions - Array of swap instruction objects
   * @param {Object} vault - Vault object
   * @returns {Promise<Object>} Object with { swaps: [...] }
   * @since 1.0.0
   */
  async generateBufferSwapTransactions(swapInstructions, vault) {
    const swaps = [];
    const swapMetadata = [];

    this.log(`Generating ${swapInstructions.length} buffer swap transactions`);

    // Create nonce tracker for batched swaps to avoid nonce collisions
    // When multiple swaps use the same input token, we need to track and increment nonces
    const nonceTracker = new Map();

    for (let i = 0; i < swapInstructions.length; i++) {
      const instruction = swapInstructions[i];
      try {
        const { tokenIn, tokenOut, amountIn, symbol, tokenData } = instruction;

        this.log(`Generating swap: ${ethers.utils.formatUnits(amountIn, tokenData.decimals)} ${symbol} → ${instruction.tokenOutSymbol}`);

        // Generate swap transaction using generic method
        // Buffer swaps always use EXACT_INPUT since we're swapping all available amount
        const swapResult = await this.generateSwapTransaction(
          tokenIn,
          tokenOut,
          amountIn,
          true,  // isAmountIn: true for EXACT_INPUT
          vault.address,
          vault.strategy.parameters.maxSlippage,
          vault,
          nonceTracker  // Pass tracker for nonce management
        );

        this.log(`  Swap transaction generated`);

        // Store transaction
        swaps.push(swapResult.transaction);

        // Store metadata for this swap
        swapMetadata.push({
          tokenInSymbol: symbol,
          tokenOutSymbol: instruction.tokenOutSymbol,
          quotedAmountIn: swapResult.quotedAmountIn,
          quotedAmountOut: swapResult.quotedAmountOut,
          isAmountIn: swapResult.isAmountIn,
          expectedSwapEvents: swapResult.expectedSwapEvents,
          routes: swapResult.routes
        });

      } catch (error) {
        this.log(`Failed to generate swap for ${instruction.symbol}: ${error.message}`);
        throw new Error(`Buffer swap generation failed for ${instruction.symbol}: ${error.message}`);
      }
    }

    this.log(`Generated ${swaps.length} buffer swap transactions`);

    return { swaps, metadata: swapMetadata };
  }

  /**
   * Generate a single swap transaction using AlphaRouter
   * @memberof module:strategies/babySteps/UniswapV3BabyStepsStrategy
   * @param {string} tokenInAddress - Address of input token
   * @param {string} tokenOutAddress - Address of output token
   * @param {string} amount - Amount to swap (as string)
   * @param {boolean} isAmountIn - True for EXACT_INPUT (amount is input), false for EXACT_OUTPUT (amount is output)
   * @param {string} recipient - Recipient address (vault address)
   * @param {number} slippageTolerance - Slippage tolerance percentage
   * @param {Object} vault - Vault object
   * @param {Map} [nonceTracker] - Optional nonce tracker for batched swaps
   * @returns {Promise<Object>} Transaction object with { to, data, value }
   * @since 1.0.0
   */
  async generateSwapTransaction(tokenInAddress, tokenOutAddress, amount, isAmountIn, recipient, slippageTolerance, vault, nonceTracker = null) {
    try {
      // Get optimal swap route from AlphaRouter
      const routeResult = await this.adapter.getSwapRoute({
        tokenInAddress: tokenInAddress,
        tokenOutAddress: tokenOutAddress,
        amount: amount,
        isAmountIn: isAmountIn,
        recipient: recipient,
        slippageTolerance: this.parent.validateSlippage(slippageTolerance),
        deadlineMinutes: Math.floor(this.parent.config.strategyProperties.transactionDeadlineSeconds / 60)
      });

      // Capture quoted amounts from route
      const quotedAmountIn = routeResult.amountIn;
      const quotedAmountOut = routeResult.amountOut;

      // Create signer for Permit2 signature
      const automationPrivateKey = process.env.AUTOMATION_PRIVATE_KEY;
      if (!automationPrivateKey) {
        throw new Error('AUTOMATION_PRIVATE_KEY environment variable is required for Permit2 signatures');
      }
      const signer = new ethers.Wallet(automationPrivateKey, this.provider);

      // Get Universal Router address for Permit2 spender
      const addresses = getPlatformAddresses(this.chainId, 'uniswapV3');
      const universalRouterAddress = addresses.universalRouterAddress;

      // Get or track nonce for this token
      // For batched swaps, we increment nonces to avoid collisions
      let nonce;
      if (nonceTracker && nonceTracker.has(tokenInAddress)) {
        // Use tracked nonce (already incremented from previous swap with this token)
        nonce = nonceTracker.get(tokenInAddress);
      } else {
        // Fetch current nonce from Permit2 contract
        nonce = await getPermit2Nonce(
          this.provider,
          recipient,
          tokenInAddress,
          universalRouterAddress
        );
      }

      // Update tracker with next nonce for this token
      if (nonceTracker) {
        nonceTracker.set(tokenInAddress, nonce + 1);
      }

      // Calculate deadline (30 minutes from now)
      const deadline = Math.floor(Date.now() / 1000) + 1800;

      // Generate Permit2 signature
      const { signature } = await generatePermit2Signature(
        signer,
        this.chainId,
        tokenInAddress,
        quotedAmountIn,
        universalRouterAddress,
        nonce,
        deadline
      );

      // Generate swap transaction data with Permit2
      const swapData = await this.adapter.generateAlphaSwapData({
        route: routeResult.route,
        recipient: recipient,
        tokenInAddress: tokenInAddress,
        amountIn: quotedAmountIn,
        permit2Signature: signature,
        permit2Nonce: nonce,
        permit2Deadline: deadline
      });

      // Calculate expected number of Swap events (hops) from the route
      let expectedSwapEvents = 1; // Default to 1 event for simple routes

      // Check routeResult.route.route (the actual route array from AlphaRouter)
      let routeData = null;
      if (Array.isArray(routeResult.route.route)) {
        // Split route - sum all sub-route pools
        expectedSwapEvents = routeResult.route.route.reduce((total, r) => {
          return total + (r.route?.pools?.length || 0);
        }, 0);

        // Extract tokenPath from each route for multi-hop parsing
        routeData = routeResult.route.route.map(r => {
          if (!r.route) return null;

          // Extract token addresses from tokenPath
          const tokenPath = Array.isArray(r.route.tokenPath)
            ? r.route.tokenPath.map(t => typeof t === 'string' ? t : t.address)
            : [];

          return {
            tokenPath,
            poolCount: r.route.pools?.length || 0
          };
        }).filter(r => r !== null);
      }

      return {
        transaction: swapData,
        quotedAmountIn,
        quotedAmountOut,
        isAmountIn,
        expectedSwapEvents,
        routes: routeData  // null for simple routes, array for split/multi-hop routes
      };

    } catch (error) {
      throw new Error(`Failed to generate swap transaction: ${error.message}`);
    }
  }
}
