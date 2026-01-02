/**
 * @module strategies/babySteps/BabyStepsStrategy
 * @description Baby Steps strategy implementation for conservative position management
 */

import { ethers } from 'ethers';
import { StrategyBase } from '../base/index.js';
import { getStrategyDetails, getTransactionDeadlineMinutes, getWethAddress, getVaultContract, fetchTokenPrices, CACHE_DURATIONS, getMinDeploymentForGas } from 'fum_library';
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
    // Step 1: Select best pool
    //   - Always select best pool based on on-chain liquidity (regardless of aligned positions)
    //   - Highest liquidity pool wins (better execution, more depth)
    //   - Target pool determines ETH vs WETH requirement
    //
    // Step 2: Evaluate positions
    //   - Check which existing positions are aligned with strategy
    //   - Aligned = correct tokens, platform, and in acceptable range
    //   - Returns { alignedPositions, nonAlignedPositions }
    //
    // Step 3: Close non-aligned positions
    //   - Batch close all non-aligned positions
    //   - Collect fees during closure
    //   - Distribute fees to owner
    //
    // Step 4: Refresh token balances
    //   - Fetch updated balances after closures and ETH conversion
    //
    // Step 5: Calculate available deployment
    //   - Use maxUtilization from strategy params
    //   - Account for existing position value (if aligned position exists)
    //
    // Step 6: Deploy capital
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

    // Step 1: Select best pool (must happen before position evaluation)
    const [targetToken0, targetToken1] = vault.targetTokens;
    const adapter = this.adapters.get(vault.targetPlatforms[0]);

    if (!adapter) {
      throw new Error(`No adapter available for platform ${vault.targetPlatforms[0]}`);
    }

    const targetPool = await this.selectBestPool(targetToken0, targetToken1, adapter, vault.address);
    this.log(`Target pool selected: ${targetPool.token0.symbol}/${targetPool.token1.symbol} at ${targetPool.address}`);

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
        await this.distributeFees(vault, aggregatedFees);
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
      }
    }

    // TODO: Step 7

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
        throw new Error(`Position ${positionId} missing pool metadata for ${position.pool} - cache consistency failure`);
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

      // 5. Range alignment check via platform utils
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
    // Discover all pools for this pair
    // Adapter handles platform-specific token resolution (e.g., V3 translates ETH → WETH)
    const pools = await retryRpcCall(
      () => adapter.discoverAvailablePools(
        tokenASymbol,
        tokenBSymbol,
        this.provider,
        this.chainId
      ),
      'discoverAvailablePools',
      { log: (msg) => this.log(msg) }
    );

    if (pools.length === 0) {
      throw new Error(`No pools found for ${tokenASymbol}/${tokenBSymbol} on ${adapter.platformName}`);
    }

    // Filter dead pools (liquidity = 0)
    const activePools = pools.filter(pool => BigInt(pool.liquidity) > 0n);

    if (activePools.length === 0) {
      throw new Error(`No active pools for ${tokenASymbol}/${tokenBSymbol} on ${adapter.platformName} (${pools.length} pools exist but all have zero liquidity)`);
    }

    // Sort by liquidity descending
    activePools.sort((a, b) => {
      const liqA = BigInt(a.liquidity);
      const liqB = BigInt(b.liquidity);
      return liqB > liqA ? 1 : liqB < liqA ? -1 : 0;
    });

    const bestPool = activePools[0];

    // Pool now includes token metadata from adapter (e.g., WETH for V3 when ETH was requested)
    const { token0, token1 } = bestPool;

    this.log(`🎯 Selected pool: ${bestPool.address} (fee: ${bestPool.fee}bp, liquidity: ${bestPool.liquidity})`);

    this.eventManager.emit('BestPoolSelected', {
      vaultAddress,
      token0Symbol: token0.symbol,
      token1Symbol: token1.symbol,
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
        message: `Selected ${token0.symbol}/${token1.symbol} pool: ${bestPool.address} (fee: ${bestPool.fee}bp)`
      }
    });

    // Enrich token metadata with full token data from this.tokens
    // (adapter returns symbol/address, we need decimals etc. for downstream use)
    const enrichedToken0 = { ...this.tokens[token0.symbol], ...token0 };
    const enrichedToken1 = { ...this.tokens[token1.symbol], ...token1 };

    return {
      ...bestPool,
      token0: enrichedToken0,
      token1: enrichedToken1
    };
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
      this.eventManager.emit('FeesDistributed', {
        vaultAddress: vault.address,
        owner: vault.owner,
        reinvestmentRatio,
        distributions,
        failures,
        totalTokensDistributed: distributions.length,
        totalTokensFailed: failures.length,
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
      throw new Error(`Position ${position.id} not found in assetValues`);
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
      throw new Error(`No adapter available for platform ${platformId}`);
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
      await this.executeWrap(vault, wrapUnwrap.wrapAmount);
    }
    if (BigInt(wrapUnwrap.unwrapAmount) > 0n) {
      this.log(`Unwrapping ${ethers.utils.formatEther(wrapUnwrap.unwrapAmount)} WETH to ETH`);
      await this.executeUnwrap(vault, wrapUnwrap.unwrapAmount);
    }

    // Execute deficit swaps (CRITICAL - with retry on failure, but continue to buffer swaps even if exhausted)
    let currentDeficitSwaps = deficitSwaps;
    let currentBufferSwaps = bufferSwaps;
    const maxRetries = 1;
    let retryCount = 0;

    // Track if deficit swaps failed - we'll still try buffer swaps
    let deficitSwapsFailed = false;
    let deficitSwapError = null;

    while (currentDeficitSwaps.length > 0) {
      try {
        this.log(`Executing ${currentDeficitSwaps.length} deficit swaps (critical)${retryCount > 0 ? ` [retry ${retryCount}]` : ''}`);
        await this.executeBatchTransactions(vault, currentDeficitSwaps, 'deficit swaps', 'swap');
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
          await this.executeWrap(vault, freshResult.wrapUnwrap.wrapAmount);
        }
        if (BigInt(freshResult.wrapUnwrap.unwrapAmount) > 0n) {
          this.log(`Unwrapping additional ${ethers.utils.formatEther(freshResult.wrapUnwrap.unwrapAmount)} WETH to ETH`);
          await this.executeUnwrap(vault, freshResult.wrapUnwrap.unwrapAmount);
        }

        // Update swaps for next iteration
        currentDeficitSwaps = freshResult.deficitSwaps;
        currentBufferSwaps = freshResult.bufferSwaps;

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
        await this.executeBatchTransactions(vault, currentBufferSwaps, 'buffer swaps', 'swap');
      } catch (error) {
        this.log(`⚠️ Buffer swaps failed (non-critical): ${error.message}`);
        // Continue - buffer swaps are nice-to-have, not required
      }
    }

    // Validate against original requirements (ONLY if deficit swaps failed)
    // If deficit swaps succeeded, we got what we needed - no extra validation
    if (deficitSwapsFailed) {
      // Refresh token balances to see what we actually have
      vault.tokens = await this.vaultDataService.fetchTokenBalances(
        vault.address,
        Object.keys(this.tokens)
      );

      const available0 = BigInt(vault.tokens[token0Data.symbol] || '0');
      const available1 = BigInt(vault.tokens[token1Data.symbol] || '0');

      // Use maxSlippage as tolerance (user's configured acceptable variance)
      const maxSlippage = vault.params?.maxSlippage || 0.5; // default 0.5%
      const toleranceMultiplier = (100 - maxSlippage) / 100; // e.g., 0.995 for 0.5% slippage

      const minRequired0 = BigInt(Math.floor(Number(originalRequirements.token0Amount) * toleranceMultiplier));
      const minRequired1 = BigInt(Math.floor(Number(originalRequirements.token1Amount) * toleranceMultiplier));

      const hasEnoughToken0 = available0 >= minRequired0;
      const hasEnoughToken1 = available1 >= minRequired1;

      if (!hasEnoughToken0 || !hasEnoughToken1) {
        const shortfall0 = hasEnoughToken0 ? 0n : minRequired0 - available0;
        const shortfall1 = hasEnoughToken1 ? 0n : minRequired1 - available1;

        throw new Error(
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

    // TODO: Steps 6-8
    // 6. JIT approval: adapter.getApprovalTarget('liquidity')
    // 7. Get fresh quote
    // 8. Execute increaseLiquidity transaction
    // 9. Emit LiquidityAddedToPosition event
    this.log('⚠️ addToPosition steps 6-8 not yet implemented - token preparation complete, skipping liquidity add');
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
    // TODO: Implement
    // 1. Validate availableDeployment
    // 2. Get adapter for target platform
    // 3. Calculate tick range using strategy params (targetRangeUpper/Lower)
    // 4. Get test quote to determine optimal token ratio
    // 5. Split budget according to optimal ratio
    // 6. Get full add liquidity quote
    // 7. Prepare tokens (swap if needed to cover deficits)
    // 8. JIT approval: adapter.getApprovalTarget('liquidity')
    // 9. Execute mint transaction
    // 10. Emit PositionCreated event
    this.log('⚠️ createNewPosition not yet implemented');
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
      throw new Error(`No adapter available for platform ${platformId}`);
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
      throw new Error(`Unable to cover deficits: ${token0Data.symbol}=${remainingToken0Deficit}, ${token1Data.symbol}=${remainingToken1Deficit}`);
    }

    // Phase 3: Buffer swaps for remaining non-aligned tokens
    for (const tokenSymbol of nonAlignedTokens) {
      if (remainingBalances[tokenSymbol] > 0n) {
        const tokenData = this.tokens[tokenSymbol];
        if (!tokenData) continue;

        const halfBalance = remainingBalances[tokenSymbol] / 2n;
        const otherHalf = remainingBalances[tokenSymbol] - halfBalance;

        // Check if either half should be a wrap/unwrap instead of swap
        const { isWrapOrUnwrap: isToken0WrapUnwrap } = this.isWrapUnwrapPair(tokenData, token0Data);
        const { isWrapOrUnwrap: isToken1WrapUnwrap } = this.isWrapUnwrapPair(tokenData, token1Data);

        // Handle half going to token0
        if (halfBalance > 0n) {
          if (isToken0WrapUnwrap) {
            // ETH → WETH or WETH → ETH
            if (tokenData.isNative && token0IsWeth) {
              wrapAmount += halfBalance;
              phasesUsed.wrapUnwrap = true;
              this.log(`Buffer phase: Adding ${ethers.utils.formatEther(halfBalance)} ETH to wrap amount`);
            } else if (tokenData.symbol === 'WETH' && token0IsNativeEth) {
              unwrapAmount += halfBalance;
              phasesUsed.wrapUnwrap = true;
              this.log(`Buffer phase: Adding ${ethers.utils.formatEther(halfBalance)} WETH to unwrap amount`);
            }
          } else {
            bufferSwapInstructions.push({
              tokenIn: tokenData, tokenOut: token0Data, amount: halfBalance.toString(), isAmountIn: true
            });
            phasesUsed.bufferSwaps = true;
          }
        }

        // Handle half going to token1
        if (otherHalf > 0n) {
          if (isToken1WrapUnwrap) {
            // ETH → WETH or WETH → ETH
            if (tokenData.isNative && token1IsWeth) {
              wrapAmount += otherHalf;
              phasesUsed.wrapUnwrap = true;
              this.log(`Buffer phase: Adding ${ethers.utils.formatEther(otherHalf)} ETH to wrap amount`);
            } else if (tokenData.symbol === 'WETH' && token1IsNativeEth) {
              unwrapAmount += otherHalf;
              phasesUsed.wrapUnwrap = true;
              this.log(`Buffer phase: Adding ${ethers.utils.formatEther(otherHalf)} WETH to unwrap amount`);
            }
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
    // Skip native ETH - it doesn't need ERC20 approvals (address is null)
    const allSwapInstructions = [...deficitSwapInstructions, ...bufferSwapInstructions];
    const tokenInAddresses = [...new Set(
      allSwapInstructions
        .filter(i => !i.tokenIn.isNative)  // Native ETH has no contract to approve
        .map(i => i.tokenIn.address)
    )];
    const swapTarget = adapter.getApprovalTarget('swap');
    await this.ensureApprovals(vault, tokenInAddresses, swapTarget);

    // Generate swap transactions - platformUtils handles platform-specific auth internally
    // IMPORTANT: Generate ALL swaps in a single batch to share Permit2 nonce tracker
    // (separate batches would create nonce collisions when executed sequentially)
    const platformUtils = PlatformUtilsFactory.getUtils(platformId);
    const swapOptions = {
      recipient: vault.address,
      slippageTolerance: vault.strategy.parameters.maxSlippage,
      adapter,
      provider: this.provider,
      chainId: this.chainId
    };

    const { transactions: allSwapTransactions, metadata: allSwapMetadata } =
      await platformUtils.batchSwapTransactions(allSwapInstructions, swapOptions);

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
          tokenInAddress: tokenInIsNative ? undefined : tokenInData.address,
          tokenOutAddress: tokenOutIsNative ? undefined : tokenOutData.address,
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
            tokenInAddress: tokenInIsNative ? undefined : tokenInData.address,
            tokenOutAddress: tokenOutIsNative ? undefined : tokenOutData.address,
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
}
