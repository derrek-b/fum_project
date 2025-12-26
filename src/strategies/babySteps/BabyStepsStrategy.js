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

    // Caches - initialized empty, populated during vault initialization
    this.bestPoolCache = {};
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
    // Step 2: Determine target pool
    //   - If aligned position exists → use its pool
    //   - If no aligned position → run pool selection (selectBestPool)
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

    // TODO: Steps 2-7

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
}
