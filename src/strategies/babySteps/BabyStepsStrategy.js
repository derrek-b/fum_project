/**
 * @module strategies/babySteps/BabyStepsStrategy
 * @description Baby Steps strategy implementation for conservative position management
 */

import { StrategyBase } from '../base/index.js';
import { getStrategyDetails } from 'fum_library';
import { retryRpcCall } from '../../utils/RetryHelper.js';
import PlatformUtilsFactory from '../../platformUtils/PlatformUtilsFactory.js';

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
    this.lastPositionCheck = {};
    this.rebalanceFailures = {};
    this.emergencyExitBaseline = {};
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

    // ==========================================================================
    // INITIALIZATION WORKFLOW
    // ==========================================================================
    //
    // Step 1: Evaluate positions
    //   - Check which existing positions are aligned with strategy
    //   - Aligned = correct tokens, platform, and in acceptable range
    //   - Returns { alignedPositions, nonAlignedPositions }
    //
    // Step 2: Select best pool
    //   - Always select best pool based on on-chain liquidity (regardless of aligned positions)
    //   - Highest liquidity pool wins (better execution, more depth)
    //   - Target pool determines ETH vs WETH requirement
    //
    // Step 3: Prepare tokens for target pool (ETH/WETH handling)
    //   - Check target pool's token0/token1 to see if it uses ETH or WETH
    //   - If pool uses WETH and vault has ETH → wrapETH
    //   - If pool uses ETH and vault has WETH → unwrapETH
    //   - This is POOL-SPECIFIC, not platform-specific (V4 has both ETH and WETH pools)
    //
    // Step 4: Close non-aligned positions
    //   - Batch close all non-aligned positions
    //   - Collect fees during closure
    //   - Distribute fees to owner
    //   - JIT approval: adapter.getApprovalTarget('liquidity') before close
    //
    // Step 5: Refresh token balances
    //   - Fetch updated balances after closures and ETH conversion
    //
    // Step 6: Calculate available deployment
    //   - Use maxUtilization from strategy params
    //   - Account for existing position value (if aligned position exists)
    //
    // Step 7: Deploy capital
    //   - If aligned position exists → addToPosition (increaseLiquidity)
    //   - If no aligned position → createNewPosition (mint)
    //   - JIT approval: adapter.getApprovalTarget('liquidity') before operation
    //   - If availableDeployment <= 0 and totalVaultValue == 0 → error (empty vault)
    //   - If availableDeployment <= 0 but has value → OK (at max utilization)
    //
    // ==========================================================================
    // APPROVAL PATTERN (JIT - Just In Time)
    // ==========================================================================
    //
    // Approvals happen right BEFORE each operation, not upfront:
    //
    //   const adapter = this.adapters.get(vault.targetPlatforms[0]);
    //
    //   // Before liquidity operations (mint, increase, decrease, collect):
    //   const liquidityTarget = adapter.getApprovalTarget('liquidity');
    //   await this.ensureApprovals(vault, [token0, token1], liquidityTarget);
    //
    //   // Before swaps:
    //   const swapTarget = adapter.getApprovalTarget('swap');
    //   await this.ensureApprovals(vault, [tokenIn], swapTarget);
    //
    // ==========================================================================
    // ETH/WETH PATTERN
    // ==========================================================================
    //
    // For LIQUIDITY: Pool decides (check pool.token0/token1)
    //   const wethAddress = getWethAddress(this.chainId);
    //   const poolUsesWETH = targetPool.token0 === wethAddress || targetPool.token1 === wethAddress;
    //   if (poolUsesWETH && vaultHasETH) → wrapETH
    //   if (!poolUsesWETH && vaultHasWETH) → unwrapETH
    //
    // For SWAPS: Route decides (adapter returns flag from getSwapRoute)
    //   const routeInfo = await adapter.getSwapRoute(tokenIn, tokenOut, amount);
    //   if (routeInfo.inputToken === 'WETH' && vaultHasETH) → wrapETH
    //   (strategy decides amount based on vault balances)
    //
    // ==========================================================================

    // Step 1: Evaluate positions
    const evaluation = await this.evaluateInitialPositions(vault);
    this.log(`Evaluation complete: ${Object.keys(evaluation.alignedPositions).length} aligned, ${Object.keys(evaluation.nonAlignedPositions).length} non-aligned`);

    // Step 2: Select best pool
    const [targetToken0, targetToken1] = vault.targetTokens;
    const adapter = this.adapters.get(vault.targetPlatforms[0]);

    if (!adapter) {
      throw new Error(`No adapter available for platform ${vault.targetPlatforms[0]}`);
    }

    const targetPool = await this.selectBestPool(targetToken0, targetToken1, adapter, vault.address);
    this.log(`Target pool selected: ${targetPool.token0.symbol}/${targetPool.token1.symbol} at ${targetPool.address}`);

    // TODO: Steps 3-7

    return true;
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
   * 3. Range alignment: position must be in range (current tick within position bounds)
   *
   * @param {Object} vault - Vault data object
   * @param {Object} vault.positions - Positions keyed by position ID
   * @param {string[]} vault.targetTokens - Target token symbols
   * @param {string[]} vault.targetPlatforms - Target platform IDs
   * @param {Object} vault.strategy - Strategy configuration
   * @param {string} vault.address - Vault address
   * @returns {Promise<Object>} Evaluation result
   * @returns {Object} result.alignedPositions - Positions aligned with strategy
   * @returns {Object} result.nonAlignedPositions - Positions not aligned with strategy
   */
  async evaluateInitialPositions(vault) {
    const { positions, targetTokens, targetPlatforms, address } = vault;

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

    for (const [positionId, position] of Object.entries(positions)) {
      // 1. Get pool metadata from cache
      const poolMetadata = this.poolData[position.pool];
      if (!poolMetadata) {
        throw new Error(`Position ${positionId} missing pool metadata for ${position.pool} - cache consistency failure`);
      }

      // 2. Basic alignment check: tokens
      const token0Symbol = poolMetadata.token0Symbol;
      const token1Symbol = poolMetadata.token1Symbol;
      const tokensAligned = targetTokens.includes(token0Symbol) && targetTokens.includes(token1Symbol);

      if (!tokensAligned) {
        this.log(`Position ${positionId} tokens not aligned: ${token0Symbol}/${token1Symbol} not in [${targetTokens.join(', ')}]`);
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

      // 4. Range alignment check via platform utils
      const util = PlatformUtilsFactory.getUtils(positionPlatform);
      const adapter = this.adapters.get(positionPlatform);

      if (!adapter) {
        throw new Error(`No adapter available for platform ${positionPlatform}`);
      }

      const rangeStatus = await retryRpcCall(
        () => util.evaluatePositionRange(position, {
          adapter,
          provider: this.provider
        }),
        'evaluatePositionRange',
        { log: (msg) => this.log(msg) }
      );

      // 5. Check range alignment result - position must be in range
      if (!rangeStatus.inRange) {
        this.log(`Position ${positionId} out of range: currentTick=${rangeStatus.currentTick}, range=${position.tickLower}-${position.tickUpper}`);
        nonAlignedPositions[positionId] = position;
      } else {
        this.log(`Position ${positionId} aligned: ${token0Symbol}/${token1Symbol} on ${positionPlatform}, centeredness=${rangeStatus.centeredness.toFixed(4)}`);
        alignedPositions[positionId] = position;
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
  // Pool Selection
  // ===========================================================================

  /**
   * Select the best pool for a token pair based on on-chain liquidity
   *
   * Selection criteria:
   * 1. Pool must have liquidity > 0 (not dead)
   * 2. Highest liquidity wins (more depth = better execution)
   *
   * @param {string} tokenASymbol - First token symbol (order doesn't matter)
   * @param {string} tokenBSymbol - Second token symbol (order doesn't matter)
   * @param {Object} adapter - Platform adapter
   * @param {string} vaultAddress - Vault address (for event/debugging)
   * @returns {Promise<Object>} Best pool with sorted token data
   * @returns {string} result.address - Pool address
   * @returns {number} result.fee - Fee tier in basis points
   * @returns {string} result.liquidity - Pool liquidity (L value)
   * @returns {string} result.sqrtPriceX96 - Current sqrt price
   * @returns {number} result.tick - Current tick
   * @returns {Object} result.token0 - Sorted token0 data
   * @returns {Object} result.token1 - Sorted token1 data
   * @throws {Error} If no active pools found for the pair
   */
  async selectBestPool(tokenASymbol, tokenBSymbol, adapter, vaultAddress) {
    const tokenAData = this.tokens[tokenASymbol];
    const tokenBData = this.tokens[tokenBSymbol];

    if (!tokenAData || !tokenBData) {
      throw new Error(`Token data not found for ${tokenASymbol} or ${tokenBSymbol}`);
    }

    const { sortedToken0, sortedToken1 } = adapter.sortTokens(tokenAData, tokenBData);

    this.log(`🔍 Selecting best pool for ${sortedToken0.symbol}/${sortedToken1.symbol} on ${adapter.platformName}`);

    // Discover all pools for this pair
    const pools = await retryRpcCall(
      () => adapter.discoverAvailablePools(
        sortedToken0.address,
        sortedToken1.address,
        this.provider
      ),
      'discoverAvailablePools',
      { log: (msg) => this.log(msg) }
    );

    if (pools.length === 0) {
      throw new Error(`No pools found for ${sortedToken0.symbol}/${sortedToken1.symbol} on ${adapter.platformName}`);
    }

    // Filter dead pools (liquidity = 0)
    const activePools = pools.filter(pool => BigInt(pool.liquidity) > 0n);

    if (activePools.length === 0) {
      throw new Error(`No active pools for ${sortedToken0.symbol}/${sortedToken1.symbol} on ${adapter.platformName} (${pools.length} pools exist but all have zero liquidity)`);
    }

    // Sort by liquidity descending
    activePools.sort((a, b) => {
      const liqA = BigInt(a.liquidity);
      const liqB = BigInt(b.liquidity);
      return liqB > liqA ? 1 : liqB < liqA ? -1 : 0;
    });

    const bestPool = activePools[0];

    this.log(`🎯 Selected pool: ${bestPool.address} (fee: ${bestPool.fee}bp, liquidity: ${bestPool.liquidity})`);

    this.eventManager.emit('BestPoolSelected', {
      vaultAddress,
      token0Symbol: sortedToken0.symbol,
      token1Symbol: sortedToken1.symbol,
      platformId: adapter.platformId,
      poolAddress: bestPool.address,
      poolFee: bestPool.fee,
      poolLiquidity: bestPool.liquidity,
      poolTick: bestPool.tick,
      poolsDiscovered: pools.length,
      poolsActive: activePools.length,
      timestamp: Date.now(),
      log: {
        level: 'info',
        message: `Selected ${sortedToken0.symbol}/${sortedToken1.symbol} pool: ${bestPool.address} (fee: ${bestPool.fee}bp)`
      }
    });

    return {
      ...bestPool,
      token0: sortedToken0,
      token1: sortedToken1
    };
  }
}
