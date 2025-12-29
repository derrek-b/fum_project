/**
 * @module strategies/babySteps/BabyStepsStrategy
 * @description Baby Steps strategy implementation for conservative position management
 */

import { ethers } from 'ethers';
import { StrategyBase } from '../base/index.js';
import { getStrategyDetails, getTransactionDeadlineMinutes, getWethAddress, getVaultContract, fetchTokenPrices, CACHE_DURATIONS } from 'fum_library';
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
    // Step 3: Close non-aligned positions
    //   - Batch close all non-aligned positions
    //   - Collect fees during closure
    //   - Distribute fees to owner
    //   - JIT approval: adapter.getApprovalTarget('liquidity') before close
    //
    // Step 4: Prepare tokens for target pool (ETH/WETH handling)
    //   - Check target pool's token0/token1 to see if it uses ETH or WETH
    //   - If pool uses WETH and vault has ETH → wrapETH
    //   - If pool uses ETH and vault has WETH → unwrapETH
    //   - This is POOL-SPECIFIC, not platform-specific (V4 has both ETH and WETH pools)
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

    // Step 3: Close non-aligned positions
    let collectedFees = {};
    let closureReceipt = null;
    if (Object.keys(evaluation.nonAlignedPositions).length > 0) {
      this.log(`Closing ${Object.keys(evaluation.nonAlignedPositions).length} non-aligned position(s)`);
      const { receipt, feesByPosition } = await this.closePositions(vault, evaluation.nonAlignedPositions);
      collectedFees = feesByPosition;
      closureReceipt = receipt;

      // Aggregate fees, emit FeesCollected, and distribute to owner
      if (Object.keys(collectedFees).length > 0) {
        const aggregatedFees = this.aggregateFeesFromPositions(collectedFees);
        await this.emitFeesCollected(
          vault,
          aggregatedFees,
          'initialization',
          Object.keys(collectedFees),
          closureReceipt.transactionHash
        );
        await this.distributeFees(vault, aggregatedFees);
      }
    }

    // TODO: Steps 4-7

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
}
