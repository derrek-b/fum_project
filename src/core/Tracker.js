/**
 * @module core/Tracker
 * @description Vault tracking module for monitoring performance, ROI, and transaction history.
 * @since 2.0.0
 */

import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { ethers } from 'ethers';
import readline from 'readline';
import { fetchTokenPrices, CACHE_DURATIONS, getTokenBySymbol } from 'fum_library';

/**
 * Tracker class for vault performance monitoring
 * @class Tracker
 */
export default class Tracker {
  /**
   * Constructor for Tracker
   * @param {Object} config - Configuration object
   * @param {string} config.dataDir - Base directory for vault data
   * @param {Object} config.eventManager - EventManager instance
   * @param {boolean} [config.debug=false] - Enable debug logging
   */
  constructor(config) {
    if (!config.dataDir) {
      throw new Error('dataDir is required in Tracker configuration');
    }
    if (!config.eventManager) {
      throw new Error('eventManager is required in Tracker configuration');
    }

    this.dataDir = path.resolve(config.dataDir);
    this.eventManager = config.eventManager;
    this.debug = config.debug || false;

    this.vaultMetadata = new Map();
  }

  /**
   * Initialize the tracker
   * @returns {Promise<void>}
   */
  async initialize() {
    this.log('Initializing Tracker...');

    await this.ensureDirectoryExists(this.dataDir);
    await this.loadAllVaultMetadata();
    this.setupEventListeners();

    this.log(`Tracker initialized with ${this.vaultMetadata.size} vaults`);
  }

  /**
   * Ensure a directory exists
   * @private
   */
  async ensureDirectoryExists(dirPath) {
    try {
      await fs.access(dirPath);
    } catch {
      await fs.mkdir(dirPath, { recursive: true });
    }
  }

  /**
   * Load all vault metadata from disk
   * @private
   */
  async loadAllVaultMetadata() {
    try {
      const entries = await fs.readdir(this.dataDir, { withFileTypes: true });
      const vaultDirs = entries.filter(entry => entry.isDirectory() && entry.name.startsWith('0x'));

      for (const vaultDir of vaultDirs) {
        const vaultAddress = vaultDir.name;
        const metadataPath = path.join(this.dataDir, vaultAddress, 'metadata.json');

        try {
          const data = await fs.readFile(metadataPath, 'utf-8');
          const metadata = JSON.parse(data);
          this.vaultMetadata.set(vaultAddress, metadata);
        } catch (error) {
          console.error(`Failed to load metadata for vault ${vaultAddress}:`, error.message);
        }
      }

      this.log(`Loaded metadata for ${this.vaultMetadata.size} vaults`);
    } catch (error) {
      this.log('No existing vault data found');
    }
  }

  /**
   * Set up event listeners for tracking vault activities
   * @private
   */
  setupEventListeners() {
    this.eventManager.subscribe('VaultBaselineCaptured', async (data) => {
      await this.handleBaselineCapture(data);
    });

    this.eventManager.subscribe('FeesCollected', async (data) => {
      await this.handleFeesCollected(data);
    });

    this.eventManager.subscribe('PositionRebalanced', async (data) => {
      await this.handlePositionRebalanced(data);
    });

    this.eventManager.subscribe('PositionsClosed', async (data) => {
      await this.handlePositionsClosed(data);
    });

    this.eventManager.subscribe('TokensSwapped', async (data) => {
      await this.handleTokensSwapped(data);
    });

    this.eventManager.subscribe('NewPositionCreated', async (data) => {
      await this.handleNewPositionCreated(data);
    });

    this.eventManager.subscribe('LiquidityAddedToPosition', async (data) => {
      await this.handleLiquidityAddedToPosition(data);
    });

    this.eventManager.subscribe('AssetValuesFetched', async (data) => {
      await this.handleAssetValuesFetched(data);
    });

    this.log('Event listeners set up for vault tracking');
  }

  /**
   * Handle asset values fetched event
   * @private
   */
  async handleAssetValuesFetched(data) {
    const { vaultAddress, totalVaultValue, timestamp } = data;

    if (!this.vaultMetadata.has(vaultAddress)) return;

    await this.updateSnapshot(vaultAddress, totalVaultValue, timestamp);
  }

  /**
   * Handle vault baseline capture event
   * @private
   */
  async handleBaselineCapture(data) {
    const { vaultAddress, totalVaultValue, tokenValue, positionValue, timestamp, capturePoint } = data;

    this.log(`Capturing baseline for vault ${vaultAddress}: $${totalVaultValue.toFixed(2)} (${capturePoint})`);

    await this.getVaultDirectory(vaultAddress);

    const metadata = {
      vaultAddress,
      baseline: {
        value: totalVaultValue,
        tokenValue,
        positionValue,
        timestamp,
        block: data.block || null,
        capturePoint
      },
      aggregates: {
        cumulativeFeesUSD: 0,
        cumulativeFeesReinvestedUSD: 0,
        cumulativeFeesWithdrawnUSD: 0,
        cumulativeGasETH: 0,
        cumulativeGasUSD: 0,
        swapCount: 0,
        rebalanceCount: 0,
        feeCollectionCount: 0,
        transactionCount: 0
      },
      lastSnapshot: {
        value: totalVaultValue,
        timestamp
      },
      metadata: {
        strategyId: data.strategyId || null,
        firstSeen: timestamp,
        lastUpdated: timestamp
      }
    };

    await this.saveMetadata(vaultAddress, metadata);
    this.vaultMetadata.set(vaultAddress, metadata);
  }

  /**
   * Handle fees collected event
   * @private
   */
  async handleFeesCollected(data) {
    const { vaultAddress, totalUSD, transactionHash, timestamp } = data;

    if (!this.vaultMetadata.has(vaultAddress)) {
      this.log(`Vault ${vaultAddress} not tracked yet, skipping fee event`);
      return;
    }

    this.log(`Fees collected for vault ${vaultAddress}: $${totalUSD.toFixed(2)}`);

    await this.appendTransaction(vaultAddress, {
      type: 'FeesCollected',
      vaultAddress,
      positionIds: data.positionIds,
      source: data.source,
      fees: data.fees,
      totalUSD,
      reinvestmentRatio: data.reinvestmentRatio,
      txHash: transactionHash,
      timestamp
    });

    const metadata = this.vaultMetadata.get(vaultAddress);
    metadata.aggregates.cumulativeFeesUSD += totalUSD;

    const reinvestmentRatio = data.reinvestmentRatio ?? 0;
    metadata.aggregates.cumulativeFeesReinvestedUSD += totalUSD * (reinvestmentRatio / 100);
    metadata.aggregates.cumulativeFeesWithdrawnUSD += totalUSD * ((100 - reinvestmentRatio) / 100);

    if (data.source === 'explicit_collection') {
      metadata.aggregates.feeCollectionCount += 1;
    }
    metadata.aggregates.transactionCount += 1;
    metadata.metadata.lastUpdated = timestamp;

    await this.saveMetadata(vaultAddress, metadata);
  }

  /**
   * Handle position rebalanced event
   * @private
   */
  async handlePositionRebalanced(data) {
    const { vaultAddress, oldPositionId, currentTick, reason, timestamp } = data;

    if (!this.vaultMetadata.has(vaultAddress)) return;

    this.log(`Position rebalanced for vault ${vaultAddress}: ${reason}`);

    await this.appendTransaction(vaultAddress, {
      type: 'PositionRebalanced',
      vaultAddress,
      oldPositionId,
      currentTick,
      reason,
      timestamp
    });

    const metadata = this.vaultMetadata.get(vaultAddress);
    metadata.aggregates.rebalanceCount += 1;
    metadata.aggregates.transactionCount += 1;
    metadata.metadata.lastUpdated = timestamp;

    await this.saveMetadata(vaultAddress, metadata);
  }

  /**
   * Handle positions closed event
   * @private
   */
  async handlePositionsClosed(data) {
    const { vaultAddress, closedCount, closedPositions, gasUsed, effectiveGasPrice, transactionHash, timestamp } = data;

    if (!this.vaultMetadata.has(vaultAddress)) return;

    this.log(`Positions closed for vault ${vaultAddress}: ${closedCount} position(s)`);

    const gasUsedBN = ethers.BigNumber.from(gasUsed);
    const gasPriceBN = ethers.BigNumber.from(effectiveGasPrice);
    const gasCostWei = gasUsedBN.mul(gasPriceBN);
    const gasETH = parseFloat(ethers.utils.formatEther(gasCostWei));
    const gasUSD = await this.calculateGasUSD(gasETH);

    await this.appendTransaction(vaultAddress, {
      type: 'PositionsClosed',
      vaultAddress,
      closedCount,
      closedPositions,
      gasUsed,
      gasEstimated: data.gasEstimated,
      effectiveGasPrice,
      gasETH,
      gasUSD,
      transactionHash,
      success: data.success,
      timestamp
    });

    const metadata = this.vaultMetadata.get(vaultAddress);
    metadata.aggregates.transactionCount += 1;
    metadata.aggregates.cumulativeGasETH += gasETH;
    metadata.aggregates.cumulativeGasUSD += gasUSD;
    metadata.metadata.lastUpdated = timestamp;

    await this.saveMetadata(vaultAddress, metadata);
  }

  /**
   * Handle token swaps event
   * @private
   */
  async handleTokensSwapped(data) {
    const { vaultAddress, swapCount, swapType, swaps, gasUsed, effectiveGasPrice, transactionHash, timestamp } = data;

    if (!this.vaultMetadata.has(vaultAddress)) return;

    this.log(`${swapCount} token swap(s) for vault ${vaultAddress} (${swapType})`);

    const gasUsedBN = ethers.BigNumber.from(gasUsed);
    const gasPriceBN = ethers.BigNumber.from(effectiveGasPrice);
    const gasCostWei = gasUsedBN.mul(gasPriceBN);
    const gasETH = parseFloat(ethers.utils.formatEther(gasCostWei));
    const gasUSD = await this.calculateGasUSD(gasETH);

    const tokenSymbols = new Set();
    for (const swap of swaps) {
      tokenSymbols.add(swap.tokenInSymbol);
      tokenSymbols.add(swap.tokenOutSymbol);
    }

    const prices = await fetchTokenPrices(Array.from(tokenSymbols), CACHE_DURATIONS['2-MINUTES']);

    const enrichedSwaps = swaps.map(swap => {
      const { tokenInSymbol, tokenOutSymbol, quotedAmountIn, quotedAmountOut, actualAmountIn, actualAmountOut, isAmountIn } = swap;

      let tokenInDecimals = 18;
      let tokenOutDecimals = 18;
      try { tokenInDecimals = getTokenBySymbol(tokenInSymbol).decimals; } catch (e) { }
      try { tokenOutDecimals = getTokenBySymbol(tokenOutSymbol).decimals; } catch (e) { }

      const priceIn = prices[tokenInSymbol] || 0;
      const priceOut = prices[tokenOutSymbol] || 0;

      const quotedAmountInFormatted = parseFloat(ethers.utils.formatUnits(quotedAmountIn, tokenInDecimals));
      const quotedAmountOutFormatted = parseFloat(ethers.utils.formatUnits(quotedAmountOut, tokenOutDecimals));
      const actualAmountInFormatted = parseFloat(ethers.utils.formatUnits(actualAmountIn, tokenInDecimals));
      const actualAmountOutFormatted = parseFloat(ethers.utils.formatUnits(actualAmountOut, tokenOutDecimals));

      let slippagePercent = 0;
      if (isAmountIn) {
        if (quotedAmountOutFormatted > 0) {
          slippagePercent = ((quotedAmountOutFormatted - actualAmountOutFormatted) / quotedAmountOutFormatted) * 100;
        }
      } else {
        if (quotedAmountInFormatted > 0) {
          slippagePercent = ((actualAmountInFormatted - quotedAmountInFormatted) / quotedAmountInFormatted) * 100;
        }
      }

      return {
        tokenInSymbol,
        tokenOutSymbol,
        tokenInDecimals,
        tokenOutDecimals,
        quotedAmountIn,
        quotedAmountOut,
        actualAmountIn,
        actualAmountOut,
        isAmountIn,
        priceInUSD: priceIn,
        priceOutUSD: priceOut,
        quotedAmountInUSD: quotedAmountInFormatted * priceIn,
        quotedAmountOutUSD: quotedAmountOutFormatted * priceOut,
        actualAmountInUSD: actualAmountInFormatted * priceIn,
        actualAmountOutUSD: actualAmountOutFormatted * priceOut,
        slippagePercent
      };
    });

    await this.appendTransaction(vaultAddress, {
      type: 'TokensSwapped',
      vaultAddress,
      swapCount,
      swapType,
      swaps: enrichedSwaps,
      gasUsed,
      gasEstimated: data.gasEstimated,
      effectiveGasPrice,
      gasETH,
      gasUSD,
      transactionHash,
      success: data.success,
      timestamp
    });

    const metadata = this.vaultMetadata.get(vaultAddress);
    metadata.aggregates.swapCount += swapCount;
    metadata.aggregates.transactionCount += 1;
    metadata.aggregates.cumulativeGasETH += gasETH;
    metadata.aggregates.cumulativeGasUSD += gasUSD;
    metadata.metadata.lastUpdated = timestamp;

    await this.saveMetadata(vaultAddress, metadata);
  }

  /**
   * Handle new position created event
   * @private
   */
  async handleNewPositionCreated(data) {
    const { vaultAddress, quotedToken0, quotedToken1, actualToken0, actualToken1, tokenSymbols, gasUsed, effectiveGasPrice, transactionHash, timestamp } = data;

    if (!this.vaultMetadata.has(vaultAddress)) return;

    this.log(`Position created for vault ${vaultAddress}`);

    const gasUsedBN = ethers.BigNumber.from(gasUsed);
    const gasPriceBN = ethers.BigNumber.from(effectiveGasPrice);
    const gasCostWei = gasUsedBN.mul(gasPriceBN);
    const gasETH = parseFloat(ethers.utils.formatEther(gasCostWei));
    const gasUSD = await this.calculateGasUSD(gasETH);

    const prices = await fetchTokenPrices(tokenSymbols, CACHE_DURATIONS['2-MINUTES']);

    let token0Decimals = 18;
    let token1Decimals = 18;
    try { token0Decimals = getTokenBySymbol(tokenSymbols[0]).decimals; } catch (e) { }
    try { token1Decimals = getTokenBySymbol(tokenSymbols[1]).decimals; } catch (e) { }

    const quotedToken0Formatted = parseFloat(ethers.utils.formatUnits(quotedToken0, token0Decimals));
    const quotedToken1Formatted = parseFloat(ethers.utils.formatUnits(quotedToken1, token1Decimals));
    const quotedToken0USD = quotedToken0Formatted * (prices[tokenSymbols[0]] || 0);
    const quotedToken1USD = quotedToken1Formatted * (prices[tokenSymbols[1]] || 0);
    const totalQuotedUSD = quotedToken0USD + quotedToken1USD;

    const actualToken0Formatted = parseFloat(ethers.utils.formatUnits(actualToken0, token0Decimals));
    const actualToken1Formatted = parseFloat(ethers.utils.formatUnits(actualToken1, token1Decimals));
    const actualToken0USD = actualToken0Formatted * (prices[tokenSymbols[0]] || 0);
    const actualToken1USD = actualToken1Formatted * (prices[tokenSymbols[1]] || 0);
    const totalActualUSD = actualToken0USD + actualToken1USD;

    const differenceUSD = totalQuotedUSD - totalActualUSD;
    const differencePercent = totalQuotedUSD > 0 ? (differenceUSD / totalQuotedUSD) * 100 : 0;

    await this.appendTransaction(vaultAddress, {
      type: 'NewPositionCreated',
      vaultAddress,
      positionId: data.positionId,
      poolAddress: data.poolAddress,
      token0Symbol: tokenSymbols[0],
      token1Symbol: tokenSymbols[1],
      quotedToken0,
      quotedToken1,
      quotedToken0USD,
      quotedToken1USD,
      totalQuotedUSD,
      actualToken0,
      actualToken1,
      actualToken0USD,
      actualToken1USD,
      totalActualUSD,
      differenceUSD,
      differencePercent,
      tickLower: data.tickLower,
      tickUpper: data.tickUpper,
      currentTick: data.currentTick,
      liquidity: data.liquidity,
      gasUsed,
      gasEstimated: data.gasEstimated,
      effectiveGasPrice,
      gasETH,
      gasUSD,
      transactionHash,
      blockNumber: data.blockNumber,
      platform: data.platform,
      deploymentAmount: data.deploymentAmount,
      success: true,
      timestamp
    });

    const metadata = this.vaultMetadata.get(vaultAddress);
    metadata.aggregates.transactionCount += 1;
    metadata.aggregates.cumulativeGasETH += gasETH;
    metadata.aggregates.cumulativeGasUSD += gasUSD;
    metadata.metadata.lastUpdated = timestamp;

    await this.saveMetadata(vaultAddress, metadata);
  }

  /**
   * Handle liquidity added to position event
   * @private
   */
  async handleLiquidityAddedToPosition(data) {
    const { vaultAddress, quotedToken0, quotedToken1, actualToken0, actualToken1, tokenSymbols, gasUsed, effectiveGasPrice, transactionHash, timestamp } = data;

    if (!this.vaultMetadata.has(vaultAddress)) return;

    this.log(`Liquidity added to position for vault ${vaultAddress}`);

    const gasUsedBN = ethers.BigNumber.from(gasUsed);
    const gasPriceBN = ethers.BigNumber.from(effectiveGasPrice);
    const gasCostWei = gasUsedBN.mul(gasPriceBN);
    const gasETH = parseFloat(ethers.utils.formatEther(gasCostWei));
    const gasUSD = await this.calculateGasUSD(gasETH);

    const prices = await fetchTokenPrices(tokenSymbols, CACHE_DURATIONS['2-MINUTES']);

    let token0Decimals = 18;
    let token1Decimals = 18;
    try { token0Decimals = getTokenBySymbol(tokenSymbols[0]).decimals; } catch (e) { }
    try { token1Decimals = getTokenBySymbol(tokenSymbols[1]).decimals; } catch (e) { }

    const quotedToken0Formatted = parseFloat(ethers.utils.formatUnits(quotedToken0, token0Decimals));
    const quotedToken1Formatted = parseFloat(ethers.utils.formatUnits(quotedToken1, token1Decimals));
    const quotedToken0USD = quotedToken0Formatted * (prices[tokenSymbols[0]] || 0);
    const quotedToken1USD = quotedToken1Formatted * (prices[tokenSymbols[1]] || 0);
    const totalQuotedUSD = quotedToken0USD + quotedToken1USD;

    const actualToken0Formatted = parseFloat(ethers.utils.formatUnits(actualToken0, token0Decimals));
    const actualToken1Formatted = parseFloat(ethers.utils.formatUnits(actualToken1, token1Decimals));
    const actualToken0USD = actualToken0Formatted * (prices[tokenSymbols[0]] || 0);
    const actualToken1USD = actualToken1Formatted * (prices[tokenSymbols[1]] || 0);
    const totalActualUSD = actualToken0USD + actualToken1USD;

    const differenceUSD = totalQuotedUSD - totalActualUSD;
    const differencePercent = totalQuotedUSD > 0 ? (differenceUSD / totalQuotedUSD) * 100 : 0;

    await this.appendTransaction(vaultAddress, {
      type: 'LiquidityAddedToPosition',
      vaultAddress,
      positionId: data.positionId,
      poolAddress: data.poolAddress,
      token0Symbol: tokenSymbols[0],
      token1Symbol: tokenSymbols[1],
      quotedToken0,
      quotedToken1,
      quotedToken0USD,
      quotedToken1USD,
      totalQuotedUSD,
      actualToken0,
      actualToken1,
      actualToken0USD,
      actualToken1USD,
      totalActualUSD,
      differenceUSD,
      differencePercent,
      tickLower: data.tickLower,
      tickUpper: data.tickUpper,
      currentTick: data.currentTick,
      liquidity: data.liquidity,
      gasUsed,
      gasEstimated: data.gasEstimated,
      effectiveGasPrice,
      gasETH,
      gasUSD,
      transactionHash,
      blockNumber: data.blockNumber,
      platform: data.platform,
      deploymentAmount: data.deploymentAmount,
      success: true,
      timestamp
    });

    const metadata = this.vaultMetadata.get(vaultAddress);
    metadata.aggregates.transactionCount += 1;
    metadata.aggregates.cumulativeGasETH += gasETH;
    metadata.aggregates.cumulativeGasUSD += gasUSD;
    metadata.metadata.lastUpdated = timestamp;

    await this.saveMetadata(vaultAddress, metadata);
  }

  /**
   * Get vault directory path
   * @private
   */
  async getVaultDirectory(vaultAddress) {
    const normalizedAddress = ethers.utils.getAddress(vaultAddress);
    const vaultDir = path.join(this.dataDir, normalizedAddress);
    await this.ensureDirectoryExists(vaultDir);
    return vaultDir;
  }

  /**
   * Save metadata to disk (atomic write)
   * @private
   */
  async saveMetadata(vaultAddress, metadata) {
    const vaultDir = await this.getVaultDirectory(vaultAddress);
    const metadataPath = path.join(vaultDir, 'metadata.json');
    const tempPath = `${metadataPath}.tmp`;

    try {
      await fs.writeFile(tempPath, JSON.stringify(metadata, null, 2), 'utf-8');
      await fs.rename(tempPath, metadataPath);
    } catch (error) {
      console.error(`Failed to save metadata for vault ${vaultAddress}:`, error.message);
    }
  }

  /**
   * Append transaction to JSONL log
   * @private
   */
  async appendTransaction(vaultAddress, transaction) {
    const vaultDir = await this.getVaultDirectory(vaultAddress);
    const transactionsPath = path.join(vaultDir, 'transactions.jsonl');

    try {
      const line = JSON.stringify(transaction) + '\n';
      await fs.appendFile(transactionsPath, line, 'utf-8');
      this.eventManager.emit('TransactionLogged', transaction);
    } catch (error) {
      console.error(`Failed to append transaction for vault ${vaultAddress}:`, error.message);
    }
  }

  /**
   * Get metadata for a vault
   * @param {string} vaultAddress - Vault address
   * @returns {Object|null} Metadata object or null
   */
  getMetadata(vaultAddress) {
    const normalizedAddress = ethers.utils.getAddress(vaultAddress);
    return this.vaultMetadata.get(normalizedAddress) || null;
  }

  /**
   * Get transactions for a vault within a time range
   * @param {string} vaultAddress - Vault address
   * @param {number} [startTime=0] - Start timestamp
   * @param {number} [endTime=Date.now()] - End timestamp
   * @returns {Promise<Array>} Array of transaction objects
   */
  async getTransactions(vaultAddress, startTime = 0, endTime = Date.now()) {
    const normalizedAddress = ethers.utils.getAddress(vaultAddress);
    const vaultDir = path.join(this.dataDir, normalizedAddress);
    const transactionsPath = path.join(vaultDir, 'transactions.jsonl');

    try {
      const transactions = [];
      const fileStream = fsSync.createReadStream(transactionsPath);
      const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
      });

      for await (const line of rl) {
        if (line.trim()) {
          const tx = JSON.parse(line);
          if (tx.timestamp >= startTime && tx.timestamp <= endTime) {
            transactions.push(tx);
          }
        }
      }

      return transactions;
    } catch (error) {
      return [];
    }
  }

  /**
   * Calculate ROI for a vault
   * @param {string} vaultAddress - Vault address
   * @param {number} currentValue - Current vault value in USD
   * @returns {Object|null} ROI metrics or null
   */
  calculateROI(vaultAddress, currentValue) {
    const metadata = this.getMetadata(vaultAddress);
    if (!metadata || !metadata.baseline) return null;

    const baselineValue = metadata.baseline.value;
    const cumulativeFees = metadata.aggregates.cumulativeFeesUSD;
    const cumulativeGas = metadata.aggregates.cumulativeGasUSD;

    const netValue = currentValue + cumulativeFees - cumulativeGas;
    const roi = baselineValue > 0 ? ((netValue - baselineValue) / baselineValue) * 100 : 0;

    return {
      baselineValue,
      currentValue,
      cumulativeFees,
      cumulativeGas,
      netValue,
      roi,
      roiPercent: roi.toFixed(2)
    };
  }

  /**
   * Update snapshot value for a vault
   * @param {string} vaultAddress - Vault address
   * @param {number} currentValue - Current vault value in USD
   * @param {number} [timestamp=Date.now()] - Timestamp
   */
  async updateSnapshot(vaultAddress, currentValue, timestamp = Date.now()) {
    const metadata = this.getMetadata(vaultAddress);
    if (!metadata) {
      this.log(`Cannot update snapshot for untracked vault ${vaultAddress}`);
      return;
    }

    metadata.lastSnapshot = { value: currentValue, timestamp };
    metadata.metadata.lastUpdated = timestamp;

    await this.saveMetadata(vaultAddress, metadata);
  }

  /**
   * Calculate gas cost in USD
   * @private
   */
  async calculateGasUSD(gasETH) {
    try {
      const prices = await fetchTokenPrices(['WETH'], CACHE_DURATIONS['2-MINUTES']);
      const wethPriceUSD = prices.WETH || 0;

      if (wethPriceUSD === 0) {
        this.log('WETH price unavailable, gas cost will be 0');
        return 0;
      }

      return gasETH * wethPriceUSD;
    } catch (error) {
      console.error('Failed to calculate gas cost in USD:', error.message);
      return 0;
    }
  }

  /**
   * Log message if debug enabled
   * @private
   */
  log(message) {
    if (this.debug) {
      console.log(`[Tracker] ${message}`);
    }
  }

  /**
   * Shutdown the tracker
   * @returns {Promise<void>}
   */
  async shutdown() {
    this.log('Shutting down Tracker...');

    for (const [vaultAddress, metadata] of this.vaultMetadata.entries()) {
      await this.saveMetadata(vaultAddress, metadata);
    }

    this.log('Tracker shutdown complete');
  }
}
