// src/utils/strategyUtils.js
import { ethers } from 'ethers';
import { getVaultContract } from './contracts';

/**
 * Helper functions for strategy operations
 */

/**
 * Calculate optimal tick range for stablecoin pairs based on volatility
 * @param {Object} poolData - Pool data from the state
 * @param {number} targetRange - Target range percentage (e.g., 0.5 for 0.5%)
 * @param {number} tickSpacing - The tick spacing for the pool
 * @returns {Object} - Lower and upper tick boundaries
 */
export function calculateOptimalTickRange(poolData, targetRange, tickSpacing) {
  if (!poolData || !poolData.tick) {
    throw new Error("Pool data is required for tick range calculation");
  }

  // Convert percentage to decimal (e.g., 0.5% -> 0.005)
  const rangeDecimal = targetRange / 100;

  // For stablecoins, we calculate a tight range around the current tick
  // based on the target range percentage
  // Math: log(1+range%)/log(1.0001) gives the tick delta for a given percentage
  const tickDelta = Math.ceil(Math.log(1 + rangeDecimal) / Math.log(1.0001));

  // Apply tick spacing
  const spacedTickDelta = Math.ceil(tickDelta / tickSpacing) * tickSpacing;

  // Calculate lower and upper ticks
  const currentTick = poolData.tick;
  const lowTick = Math.floor(currentTick - spacedTickDelta);
  const highTick = Math.ceil(currentTick + spacedTickDelta);

  // Normalize to tick spacing
  const normalizedLowTick = Math.floor(lowTick / tickSpacing) * tickSpacing;
  const normalizedHighTick = Math.ceil(highTick / tickSpacing) * tickSpacing;

  return {
    tickLower: normalizedLowTick,
    tickUpper: normalizedHighTick,
    rawTickDelta: tickDelta,
    effectiveRange: (Math.pow(1.0001, spacedTickDelta) - 1) * 100 // Convert back to percentage
  };
}

/**
 * Determine if a position needs rebalancing based on price movement
 * @param {Object} position - Position data
 * @param {Object} poolData - Current pool data
 * @param {number} rebalanceThreshold - Threshold percentage to trigger rebalance
 * @returns {Object} - Rebalance assessment result
 */
export function assessRebalanceNeeded(position, poolData, rebalanceThreshold) {
  if (!position || !poolData || !poolData.tick) {
    throw new Error("Position and pool data are required for rebalance assessment");
  }

  const currentTick = poolData.tick;
  const lowerTick = position.tickLower;
  const upperTick = position.tickUpper;
  const midpoint = (lowerTick + upperTick) / 2;

  // Calculate distance from midpoint as a percentage
  const tickDistance = Math.abs(currentTick - midpoint);
  const percentDistance = (Math.pow(1.0001, tickDistance) - 1) * 100;

  // Calculate distance from boundaries as percentages
  const lowerDistance = currentTick - lowerTick;
  const upperDistance = upperTick - currentTick;
  const lowerPercentage = (Math.pow(1.0001, lowerDistance) - 1) * 100;
  const upperPercentage = (Math.pow(1.0001, upperDistance) - 1) * 100;

  // Check if price is within bounds
  const isInRange = currentTick >= lowerTick && currentTick <= upperTick;

  // Check if rebalance is needed
  const isOffCenter = percentDistance > rebalanceThreshold;

  // Calculate optimal new range if rebalance is needed
  let newRange = null;
  if (isOffCenter) {
    // Calculate range width in ticks
    const rangeWidth = upperTick - lowerTick;

    // Center the range around current price
    const halfRange = Math.floor(rangeWidth / 2);
    const newLowerTick = Math.floor(currentTick - halfRange);
    const newUpperTick = Math.ceil(currentTick + halfRange);

    newRange = {
      tickLower: newLowerTick,
      tickUpper: newUpperTick
    };
  }

  return {
    isInRange,
    needsRebalance: isOffCenter,
    percentOffCenter: percentDistance,
    lowerPercentage,
    upperPercentage,
    newRange
  };
}

/**
 * Calculate estimated APY based on fee accumulation
 * @param {Object} position - Position data
 * @param {Object} feeData - Fee data with token amounts and timestamps
 * @param {Object} tokenPrices - Token price data for USD conversion
 * @param {Object} positionValue - Current position value in tokens and USD
 * @returns {number} - Estimated APY as a percentage
 */
export function calculateEstimatedAPY(position, feeData, tokenPrices, positionValue) {
  if (!position || !feeData || !feeData.startTime || !tokenPrices || !positionValue) {
    return null;
  }

  try {
    // Calculate time period in years
    const now = Date.now();
    const startTime = feeData.startTime;
    const timeElapsedMs = now - startTime;
    const timeElapsedYears = timeElapsedMs / (1000 * 60 * 60 * 24 * 365);

    // Need at least 1 day of data for meaningful calculation
    if (timeElapsedMs < 1000 * 60 * 60 * 24) {
      return null;
    }

    // Get accumulated fees in USD
    const fee0USD = parseFloat(feeData.token0Fee) * tokenPrices.token0;
    const fee1USD = parseFloat(feeData.token1Fee) * tokenPrices.token1;
    const totalFeeUSD = fee0USD + fee1USD;

    // Get position value in USD
    const positionUSD = positionValue.totalUSD;

    if (positionUSD === 0) return 0;

    // Calculate annualized return
    const annualizedReturn = (totalFeeUSD / positionUSD) / timeElapsedYears;

    // Convert to percentage
    return annualizedReturn * 100;
  } catch (error) {
    console.error("Error calculating APY:", error);
    return null;
  }
}

/**
 * Generate transaction data for executing a strategy operation
 * @param {Object} vaultContract - Vault contract instance
 * @param {Object} strategyParams - Parameters for the strategy operation
 * @returns {Object} Transaction parameters
 */
export async function generateStrategyExecutionData(vaultContract, strategyParams) {
  // This would interact with the vault contract to generate the proper calldata
  // for executing a strategy operation through the vault

  // In a real implementation, this would:
  // 1. Encode the strategy function calls
  // 2. Format them correctly for the vault's execute method
  // 3. Return the transaction object ready for sending

  // Placeholder implementation
  return {
    targets: [],
    data: [],
    estimatedGas: ethers.toBigInt("300000")
  };
}

/**
 * Activate or deactivate a strategy on a vault
 * @param {string} vaultAddress - Address of the vault
 * @param {string} strategyAddress - Address of the strategy contract
 * @param {boolean} activate - Whether to activate or deactivate
 * @param {Object} signer - Ethers signer
 * @returns {Promise<Object>} Transaction receipt
 */
export async function toggleStrategy(vaultAddress, strategyAddress, activate, signer) {
  if (!vaultAddress || !strategyAddress || !signer) {
    throw new Error("Missing required parameters for strategy toggle");
  }

  try {
    const vaultContract = getVaultContract(vaultAddress, signer.provider, signer);

    // Call the vault's setStrategyAuthorization method
    const tx = await vaultContract.setStrategyAuthorization(
      strategyAddress,
      activate,
      { gasLimit: 200000 }
    );

    return await tx.wait();
  } catch (error) {
    console.error("Error toggling strategy:", error);
    throw error;
  }
}

/**
 * Calculate liquidity distribution for multiple positions
 * @param {Array} positions - Array of position objects
 * @param {number} totalLiquidity - Total liquidity to distribute
 * @param {Object} volumeData - Trading volume data for pairs
 * @returns {Array} - Liquidity allocations for each position
 */
export function calculateLiquidityDistribution(positions, totalLiquidity, volumeData) {
  if (!positions || positions.length === 0 || !totalLiquidity || !volumeData) {
    return [];
  }

  try {
    // Calculate weights based on volume
    const totalVolume = Object.values(volumeData).reduce((sum, vol) => sum + vol, 0);

    if (totalVolume === 0) {
      // Equal distribution if no volume data
      const equalAmount = totalLiquidity / positions.length;
      return positions.map(pos => ({
        positionId: pos.id,
        amount: equalAmount,
        percentage: (100 / positions.length).toFixed(2)
      }));
    }

    // Calculate weighted distribution
    return positions.map(pos => {
      const poolAddress = pos.poolAddress;
      const volume = volumeData[poolAddress] || 0;
      const weight = volume / totalVolume;
      const amount = totalLiquidity * weight;

      return {
        positionId: pos.id,
        amount,
        percentage: (weight * 100).toFixed(2)
      };
    });
  } catch (error) {
    console.error("Error calculating liquidity distribution:", error);
    return [];
  }
}

/**
 * Generate a strategy report for a vault
 * @param {string} vaultAddress - Address of the vault
 * @param {Array} positions - Array of positions in the vault
 * @param {Object} fees - Fee data for the positions
 * @param {Object} metrics - Performance metrics
 * @returns {Object} - Strategy report
 */
export function generateStrategyReport(vaultAddress, positions, fees, metrics) {
  if (!vaultAddress || !positions) {
    return null;
  }

  try {
    // Calculate total fees
    const totalFees = {
      token0: 0,
      token1: 0,
      usd: 0
    };

    // Calculate total position value
    const totalValue = {
      token0: 0,
      token1: 0,
      usd: 0
    };

    // Process positions
    const positionReports = positions.map(pos => {
      const positionFees = fees[pos.id] || { token0: 0, token1: 0, usd: 0 };
      const positionValue = metrics.positionValues[pos.id] || { token0: 0, token1: 0, usd: 0 };

      // Add to totals
      totalFees.token0 += positionFees.token0;
      totalFees.token1 += positionFees.token1;
      totalFees.usd += positionFees.usd;

      totalValue.token0 += positionValue.token0;
      totalValue.token1 += positionValue.token1;
      totalValue.usd += positionValue.usd;

      return {
        positionId: pos.id,
        tokenPair: pos.tokenPair,
        fees: positionFees,
        value: positionValue,
        isInRange: metrics.isInRange[pos.id] || false
      };
    });

    // Calculate summary stats
    const inRangeCount = positionReports.filter(p => p.isInRange).length;
    const inRangePercentage = positions.length > 0 ? (inRangeCount / positions.length) * 100 : 0;

    // Calculate APY if enough data
    const apy = metrics.apy || 0;

    return {
      vaultAddress,
      timestamp: Date.now(),
      positions: positionReports,
      summary: {
        totalPositions: positions.length,
        inRangePositions: inRangeCount,
        inRangePercentage,
        totalValue,
        totalFees,
        estimatedAPY: apy
      }
    };
  } catch (error) {
    console.error("Error generating strategy report:", error);
    return null;
  }
}
