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
import { fetchTokenPrices, CACHE_DURATIONS, getTokenBySymbol, AdapterFactory } from 'fum_library';
import { getWrappedNativeSymbol } from 'fum_library/helpers/tokenHelpers';

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
   * @param {number} config.chainId - Chain ID for the network
   * @param {boolean} [config.debug=false] - Enable debug logging
   * @param {string} [config.trackingFailuresFilePath='./data/trackingFailures.json'] - Path to tracking failures file
   */
  constructor(config) {
    if (!config.dataDir) {
      throw new Error('dataDir is required in Tracker configuration');
    }
    if (!config.eventManager) {
      throw new Error('eventManager is required in Tracker configuration');
    }
    if (!config.chainId) {
      throw new Error('chainId is required in Tracker configuration');
    }

    this.dataDir = path.resolve(config.dataDir);
    this.eventManager = config.eventManager;
    this.chainId = config.chainId;
    this.debug = config.debug || false;
    this.trackingFailuresFilePath = config.trackingFailuresFilePath || './data/trackingFailures.json';

    this.vaultMetadata = new Map();
    this.trackingFailures = new Map();
  }

  /**
   * Initialize the tracker
   * @returns {Promise<void>}
   */
  async initialize() {
    this.log('Initializing Tracker...');

    await this.ensureDirectoryExists(this.dataDir);
    await this.loadAllVaultMetadata();
    await this.loadTrackingFailures();
    this.setupEventListeners();

    this.log(`Tracker initialized with ${this.vaultMetadata.size} vaults, ${this.trackingFailures.size} tracking failures`);
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

    this.eventManager.subscribe('FeesDistributed', async (data) => {
      await this.handleFeesDistributed(data);
    });

    this.eventManager.subscribe('FeeDistributionFailed', async (data) => {
      await this.handleFeeDistributionFailed(data);
    });

    this.eventManager.subscribe('FeeTrackingFailed', async (data) => {
      await this.handleFeeTrackingFailed(data);
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

    this.eventManager.subscribe('ETHWrapped', async (data) => {
      await this.handleWrapUnwrap(data, 'wrap');
    });

    this.eventManager.subscribe('ETHUnwrapped', async (data) => {
      await this.handleWrapUnwrap(data, 'unwrap');
    });

    this.eventManager.subscribe('VaultBlacklisted', async (data) => {
      await this.handleVaultBlacklisted(data);
    });

    this.eventManager.subscribe('VaultFailed', async (data) => {
      await this.handleVaultRetryQueued(data);
    });

    this.eventManager.subscribe('VaultRecovered', async (data) => {
      await this.handleVaultRetrySuccess(data);
    });

    this.log('Event listeners set up for vault tracking');
  }

  /**
   * Handle asset values fetched event
   * @private
   */
  async handleAssetValuesFetched(data) {
    const { vaultAddress, timestamp } = data;
    if (!this.vaultMetadata.has(vaultAddress)) return;

    try {
      const { totalVaultValue } = data;
      await this.updateSnapshot(vaultAddress, totalVaultValue, timestamp);
    } catch (error) {
      await this.logTrackingError(vaultAddress, {
        eventType: 'AssetValuesFetched',
        timestamp,
        error: error.message
      });
    }
  }

  /**
   * Handle vault baseline capture event
   * @private
   */
  async handleBaselineCapture(data) {
    const { vaultAddress, totalVaultValue, tokenValue, positionValue, timestamp, capturePoint } = data;

    try {
      this.log(`Capturing baseline for vault ${vaultAddress}: $${totalVaultValue.toFixed(2)} (${capturePoint})`);

      await this.getVaultDirectory(vaultAddress);

      // Check for existing metadata (may exist from prior failures/blacklist/retry during initialization)
      const existingMetadata = this.vaultMetadata.get(vaultAddress);
      const firstSeen = existingMetadata?.metadata?.firstSeen || timestamp;
      const priorBlacklistCount = existingMetadata?.aggregates?.blacklistCount || 0;
      const priorRetryCount = existingMetadata?.aggregates?.retryCount || 0;

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
          cumulativeFeesWithdrawFailedUSD: 0,
          cumulativeGasETH: 0,
          cumulativeGasUSD: 0,
          swapCount: 0,
          rebalanceCount: 0,
          feeCollectionCount: 0,
          transactionCount: 0,
          wrapUnwrapCount: 0,
          trackingErrorCount: 0,
          feeTrackingFailureCount: 0,
          blacklistCount: priorBlacklistCount,
          retryCount: priorRetryCount
        },
        failedDistributions: [],
        lastSnapshot: {
          value: totalVaultValue,
          timestamp
        },
        metadata: {
          strategyId: data.strategyId || null,
          firstSeen,
          lastUpdated: timestamp
        }
      };

      await this.saveMetadata(vaultAddress, metadata);
      this.vaultMetadata.set(vaultAddress, metadata);

      // Clear any prior tracking failure for this vault
      await this.clearTrackingFailure(vaultAddress);
    } catch (error) {
      console.error(`[Tracker] 🔴 Failed to capture baseline for ${vaultAddress}: ${error.message}`);
      await this.trackFailure(vaultAddress, 'VaultBaselineCaptured', error.message);
    }
  }

  /**
   * Handle fees collected event
   * @private
   */
  async handleFeesCollected(data) {
    const { vaultAddress, transactionHash, timestamp } = data;

    if (!this.vaultMetadata.has(vaultAddress)) {
      this.log(`Vault ${vaultAddress} not tracked yet, skipping fee event`);
      return;
    }

    try {
      const { totalUSD } = data;
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

      // Track reinvested portion at collection time (stays in vault)
      const reinvestmentRatio = data.reinvestmentRatio ?? 0;
      metadata.aggregates.cumulativeFeesReinvestedUSD += totalUSD * (reinvestmentRatio / 100);
      // NOTE: cumulativeFeesWithdrawnUSD updated in handleFeesDistributed on actual distribution

      if (data.source === 'explicit_collection') {
        metadata.aggregates.feeCollectionCount += 1;
      }
      metadata.aggregates.transactionCount += 1;
      metadata.metadata.lastUpdated = timestamp;

      await this.saveMetadata(vaultAddress, metadata);
    } catch (error) {
      await this.logTrackingError(vaultAddress, {
        eventType: 'FeesCollected',
        transactionHash,
        timestamp,
        error: error.message
      });
    }
  }

  /**
   * Handle fees distributed event - fees actually sent to owner
   * @private
   */
  async handleFeesDistributed(data) {
    const { vaultAddress, timestamp } = data;

    if (!this.vaultMetadata.has(vaultAddress)) {
      this.log(`Vault ${vaultAddress} not tracked yet, skipping distribution event`);
      return;
    }

    try {
      const { distributions, reinvestmentRatio, totalDistributedUSD } = data;

      this.log(`Fees distributed for vault ${vaultAddress}: $${totalDistributedUSD?.toFixed(2) || '0.00'}`);

      await this.appendTransaction(vaultAddress, {
        type: 'FeesDistributed',
        vaultAddress,
        distributions,
        reinvestmentRatio,
        totalDistributedUSD,
        timestamp
      });

      const metadata = this.vaultMetadata.get(vaultAddress);
      if (totalDistributedUSD) {
        metadata.aggregates.cumulativeFeesWithdrawnUSD += totalDistributedUSD;
      }
      metadata.metadata.lastUpdated = timestamp;

      await this.saveMetadata(vaultAddress, metadata);
    } catch (error) {
      await this.logTrackingError(vaultAddress, {
        eventType: 'FeesDistributed',
        timestamp,
        error: error.message
      });
    }
  }

  /**
   * Handle fee distribution failure - fees remain in vault
   * @private
   */
  async handleFeeDistributionFailed(data) {
    const { vaultAddress, timestamp } = data;

    if (!this.vaultMetadata.has(vaultAddress)) {
      this.log(`Vault ${vaultAddress} not tracked yet, skipping distribution failure event`);
      return;
    }

    try {
      const { fees, source, error, totalFailedUSD } = data;
      this.log(`Fee distribution failed for vault ${vaultAddress}: $${totalFailedUSD?.toFixed(2) || '0.00'} - ${error}`);

      await this.appendTransaction(vaultAddress, {
        type: 'FeeDistributionFailed',
        vaultAddress,
        fees,
        source,
        error,
        totalFailedUSD,
        timestamp
      });

      // Track failed distribution in metadata for visibility
      const metadata = this.vaultMetadata.get(vaultAddress);
      metadata.failedDistributions.push({
        fees,
        source,
        error,
        totalFailedUSD,
        timestamp
      });
      if (totalFailedUSD) {
        metadata.aggregates.cumulativeFeesWithdrawFailedUSD += totalFailedUSD;
      }
      metadata.metadata.lastUpdated = timestamp;

      await this.saveMetadata(vaultAddress, metadata);
    } catch (trackError) {
      await this.logTrackingError(vaultAddress, {
        eventType: 'FeeDistributionFailed',
        timestamp,
        error: trackError.message
      });
    }
  }

  /**
   * Handle fee tracking failure - fees exist but amounts unknown for native ETH
   * @private
   */
  async handleFeeTrackingFailed(data) {
    const { vaultAddress, transactionHash, timestamp } = data;

    if (!this.vaultMetadata.has(vaultAddress)) {
      this.log(`Vault ${vaultAddress} not tracked yet, skipping fee tracking failure event`);
      return;
    }

    try {
      const { failures, reason } = data;
      this.log(`Fee tracking failed for vault ${vaultAddress}: ${failures.length} position(s)`);

      await this.appendTransaction(vaultAddress, {
        type: 'FeeTrackingFailed',
        vaultAddress,
        transactionHash,
        failures,
        reason,
        timestamp
      });

      const metadata = this.vaultMetadata.get(vaultAddress);
      metadata.aggregates.feeTrackingFailureCount += failures.length;
      metadata.metadata.lastUpdated = timestamp;

      await this.saveMetadata(vaultAddress, metadata);
    } catch (error) {
      await this.logTrackingError(vaultAddress, {
        eventType: 'FeeTrackingFailed',
        transactionHash,
        timestamp,
        error: error.message
      });
    }
  }

  /**
   * Handle position rebalanced event
   * @private
   */
  async handlePositionRebalanced(data) {
    const { vaultAddress, timestamp } = data;
    if (!this.vaultMetadata.has(vaultAddress)) return;

    try {
      const { oldPositionId, currentTick, reason } = data;
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
    } catch (error) {
      await this.logTrackingError(vaultAddress, {
        eventType: 'PositionRebalanced',
        timestamp,
        error: error.message
      });
    }
  }

  /**
   * Handle positions closed event
   * @private
   */
  async handlePositionsClosed(data) {
    const { vaultAddress, transactionHash, timestamp } = data;
    if (!this.vaultMetadata.has(vaultAddress)) return;

    try {
      const { closedCount, closedPositions, gasUsed, effectiveGasPrice } = data;
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
    } catch (error) {
      await this.logTrackingError(vaultAddress, {
        eventType: 'PositionsClosed',
        transactionHash,
        timestamp,
        error: error.message
      });
    }
  }

  /**
   * Handle token swaps event
   * @private
   */
  async handleTokensSwapped(data) {
    const { vaultAddress, transactionHash, timestamp } = data;
    if (!this.vaultMetadata.has(vaultAddress)) return;

    try {
      const { swapCount, swapType, swaps, gasUsed, effectiveGasPrice } = data;
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
    } catch (error) {
      await this.logTrackingError(vaultAddress, {
        eventType: 'TokensSwapped',
        transactionHash,
        timestamp,
        error: error.message
      });
    }
  }

  /**
   * Handle ETH wrap/unwrap events
   * @param {Object} data - Event data with vaultAddress, amount, gas metrics
   * @param {string} type - 'wrap' or 'unwrap'
   * @private
   */
  async handleWrapUnwrap(data, type) {
    const { vaultAddress, transactionHash, timestamp } = data;
    if (!this.vaultMetadata.has(vaultAddress)) return;

    try {
      const { amount, amountFormatted, gasUsed, gasEstimated, effectiveGasPrice, success } = data;
      const wrappedNativeSymbol = getWrappedNativeSymbol(this.chainId);
      const operation = type === 'wrap' ? `Native→${wrappedNativeSymbol}` : `${wrappedNativeSymbol}→Native`;
      this.log(`${operation} for vault ${vaultAddress}: ${amountFormatted}`);

      // Calculate gas costs
      const gasUsedBN = ethers.BigNumber.from(gasUsed);
      const gasPriceBN = ethers.BigNumber.from(effectiveGasPrice);
      const gasCostWei = gasUsedBN.mul(gasPriceBN);
      const gasNative = parseFloat(ethers.utils.formatEther(gasCostWei));
      const gasUSD = await this.calculateGasUSD(gasNative);

      // Calculate amount in USD (use wrapped native price since 1:1 conversion)
      const prices = await fetchTokenPrices([wrappedNativeSymbol], CACHE_DURATIONS['2-MINUTES']);
      const nativePrice = prices[wrappedNativeSymbol];
      const amountUSD = parseFloat(amountFormatted) * nativePrice;

      // Append transaction
      await this.appendTransaction(vaultAddress, {
        type: type === 'wrap' ? 'ETHWrapped' : 'ETHUnwrapped',
        vaultAddress,
        amount,
        amountFormatted,
        amountUSD,
        gasUsed,
        gasEstimated,
        effectiveGasPrice,
        gasETH,
        gasUSD,
        transactionHash,
        success,
        timestamp
      });

      // Update metadata aggregates
      const metadata = this.vaultMetadata.get(vaultAddress);
      metadata.aggregates.wrapUnwrapCount += 1;
      metadata.aggregates.transactionCount += 1;
      metadata.aggregates.cumulativeGasETH += gasETH;
      metadata.aggregates.cumulativeGasUSD += gasUSD;
      metadata.metadata.lastUpdated = timestamp;

      await this.saveMetadata(vaultAddress, metadata);
    } catch (error) {
      await this.logTrackingError(vaultAddress, {
        eventType: type === 'wrap' ? 'ETHWrapped' : 'ETHUnwrapped',
        transactionHash,
        timestamp,
        error: error.message
      });
    }
  }

  /**
   * Handle vault blacklisted event
   * Creates metadata if vault was never successfully set up (baseline: null)
   * @private
   */
  async handleVaultBlacklisted(data) {
    const { vaultAddress, reason } = data;
    const timestamp = data.timestamp || Date.now();

    try {
      const normalizedAddress = ethers.utils.getAddress(vaultAddress);

      // Create metadata if it doesn't exist (vault was never successfully set up)
      if (!this.vaultMetadata.has(normalizedAddress)) {
        this.log(`Creating metadata for blacklisted vault ${normalizedAddress} (never set up)`);

        await this.getVaultDirectory(normalizedAddress);

        const metadata = {
          vaultAddress: normalizedAddress,
          baseline: null,
          aggregates: {
            cumulativeFeesUSD: 0,
            cumulativeFeesReinvestedUSD: 0,
            cumulativeFeesWithdrawnUSD: 0,
            cumulativeFeesWithdrawFailedUSD: 0,
            cumulativeGasETH: 0,
            cumulativeGasUSD: 0,
            swapCount: 0,
            rebalanceCount: 0,
            feeCollectionCount: 0,
            transactionCount: 0,
            wrapUnwrapCount: 0,
            trackingErrorCount: 0,
            feeTrackingFailureCount: 0,
            blacklistCount: 1
          },
          failedDistributions: [],
          lastSnapshot: null,
          metadata: {
            strategyId: null,
            firstSeen: timestamp,
            lastUpdated: timestamp
          }
        };

        await this.saveMetadata(normalizedAddress, metadata);
        this.vaultMetadata.set(normalizedAddress, metadata);
      } else {
        // Vault exists - increment blacklist count
        const metadata = this.vaultMetadata.get(normalizedAddress);
        metadata.aggregates.blacklistCount = (metadata.aggregates.blacklistCount || 0) + 1;
        metadata.metadata.lastUpdated = timestamp;
        await this.saveMetadata(normalizedAddress, metadata);
      }

      // Append transaction record
      await this.appendTransaction(normalizedAddress, {
        type: 'VaultBlacklisted',
        vaultAddress: normalizedAddress,
        reason,
        timestamp
      });

      this.log(`Tracked blacklist for vault ${normalizedAddress}: ${reason}`);
    } catch (error) {
      console.error(`[Tracker] 🔴 Failed to track blacklist for ${vaultAddress}: ${error.message}`);
      // Attempt to log the error - may also fail if directory creation was the issue
      try {
        await this.logTrackingError(vaultAddress, {
          eventType: 'VaultBlacklisted',
          timestamp,
          error: error.message
        });
      } catch (logError) {
        // Directory creation itself failed - nothing more we can do
        console.error(`[Tracker] 🔴 Unable to log tracking error: ${logError.message}`);
      }
    }
  }

  /**
   * Handle vault entering retry queue
   * @private
   */
  async handleVaultRetryQueued(data) {
    const { vaultAddress, error, attempts, source } = data;
    const timestamp = data.timestamp || Date.now();

    try {
      const normalizedAddress = ethers.utils.getAddress(vaultAddress);

      // Create metadata if vault never existed
      if (!this.vaultMetadata.has(normalizedAddress)) {
        this.log(`Creating metadata for retry-queued vault ${normalizedAddress} (never set up)`);

        await this.getVaultDirectory(normalizedAddress);

        const metadata = {
          vaultAddress: normalizedAddress,
          baseline: null,
          aggregates: {
            cumulativeFeesUSD: 0,
            cumulativeFeesReinvestedUSD: 0,
            cumulativeFeesWithdrawnUSD: 0,
            cumulativeFeesWithdrawFailedUSD: 0,
            cumulativeGasETH: 0,
            cumulativeGasUSD: 0,
            swapCount: 0,
            rebalanceCount: 0,
            feeCollectionCount: 0,
            transactionCount: 0,
            wrapUnwrapCount: 0,
            trackingErrorCount: 0,
            feeTrackingFailureCount: 0,
            blacklistCount: 0,
            retryCount: 1
          },
          failedDistributions: [],
          lastSnapshot: null,
          metadata: {
            strategyId: null,
            firstSeen: timestamp,
            lastUpdated: timestamp
          }
        };

        await this.saveMetadata(normalizedAddress, metadata);
        this.vaultMetadata.set(normalizedAddress, metadata);
      } else {
        // Vault exists - increment retry count
        const metadata = this.vaultMetadata.get(normalizedAddress);
        metadata.aggregates.retryCount = (metadata.aggregates.retryCount || 0) + 1;
        metadata.metadata.lastUpdated = timestamp;
        await this.saveMetadata(normalizedAddress, metadata);
      }

      // Append transaction record
      await this.appendTransaction(normalizedAddress, {
        type: 'VaultRetryQueued',
        vaultAddress: normalizedAddress,
        error,
        source,
        attempts,
        timestamp
      });

      this.log(`Tracked retry queue for vault ${normalizedAddress} (${source}): ${error} (attempt ${attempts})`);
    } catch (err) {
      console.error(`[Tracker] 🔴 Failed to track retry for ${vaultAddress}: ${err.message}`);
      try {
        await this.logTrackingError(vaultAddress, {
          eventType: 'VaultFailed',
          timestamp,
          error: err.message
        });
      } catch (logError) {
        console.error(`[Tracker] 🔴 Unable to log tracking error: ${logError.message}`);
      }
    }
  }

  /**
   * Handle vault successfully recovered from retry queue
   * @private
   */
  async handleVaultRetrySuccess(data) {
    const { vaultAddress } = data;
    const timestamp = data.timestamp || Date.now();

    try {
      const normalizedAddress = ethers.utils.getAddress(vaultAddress);

      // Only log if we have metadata (vault was tracked)
      if (!this.vaultMetadata.has(normalizedAddress)) return;

      const metadata = this.vaultMetadata.get(normalizedAddress);
      metadata.metadata.lastUpdated = timestamp;
      await this.saveMetadata(normalizedAddress, metadata);

      // Append transaction record
      await this.appendTransaction(normalizedAddress, {
        type: 'VaultRetrySuccess',
        vaultAddress: normalizedAddress,
        timestamp
      });

      this.log(`Tracked retry success for vault ${normalizedAddress}`);
    } catch (err) {
      console.error(`[Tracker] 🔴 Failed to track retry success for ${vaultAddress}: ${err.message}`);
    }
  }

  /**
   * Handle new position created event
   * @private
   */
  async handleNewPositionCreated(data) {
    const { vaultAddress, transactionHash, timestamp } = data;
    if (!this.vaultMetadata.has(vaultAddress)) return;

    try {
      const { targetToken0, targetToken1, actualToken0, actualToken1, tokenSymbols, gasUsed, effectiveGasPrice } = data;
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

      const targetToken0Formatted = parseFloat(ethers.utils.formatUnits(targetToken0, token0Decimals));
      const targetToken1Formatted = parseFloat(ethers.utils.formatUnits(targetToken1, token1Decimals));
      const targetToken0USD = targetToken0Formatted * (prices[tokenSymbols[0]] || 0);
      const targetToken1USD = targetToken1Formatted * (prices[tokenSymbols[1]] || 0);
      const totalTargetUSD = targetToken0USD + targetToken1USD;

      const actualToken0Formatted = parseFloat(ethers.utils.formatUnits(actualToken0, token0Decimals));
      const actualToken1Formatted = parseFloat(ethers.utils.formatUnits(actualToken1, token1Decimals));
      const actualToken0USD = actualToken0Formatted * (prices[tokenSymbols[0]] || 0);
      const actualToken1USD = actualToken1Formatted * (prices[tokenSymbols[1]] || 0);
      const totalActualUSD = actualToken0USD + actualToken1USD;

      const differenceUSD = totalTargetUSD - totalActualUSD;
      const differencePercent = totalTargetUSD > 0 ? (differenceUSD / totalTargetUSD) * 100 : 0;

      await this.appendTransaction(vaultAddress, {
        type: 'NewPositionCreated',
        vaultAddress,
        positionId: data.positionId,
        poolAddress: data.poolAddress,
        token0Symbol: tokenSymbols[0],
        token1Symbol: tokenSymbols[1],
        targetToken0,
        targetToken1,
        targetToken0USD,
        targetToken1USD,
        totalTargetUSD,
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
    } catch (error) {
      await this.logTrackingError(vaultAddress, {
        eventType: 'NewPositionCreated',
        transactionHash,
        timestamp,
        error: error.message
      });
    }
  }

  /**
   * Handle liquidity added to position event
   * @private
   */
  async handleLiquidityAddedToPosition(data) {
    const { vaultAddress, transactionHash, timestamp } = data;
    if (!this.vaultMetadata.has(vaultAddress)) return;

    try {
      const { quotedToken0, quotedToken1, actualToken0, actualToken1, tokenSymbols, gasUsed, effectiveGasPrice } = data;
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
        ...data.position,
        currentTick: data.currentTick,
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
    } catch (error) {
      await this.logTrackingError(vaultAddress, {
        eventType: 'LiquidityAddedToPosition',
        transactionHash,
        timestamp,
        error: error.message
      });
    }
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
  async calculateGasUSD(gasNative) {
    try {
      const wrappedNativeSymbol = getWrappedNativeSymbol(this.chainId);
      const prices = await fetchTokenPrices([wrappedNativeSymbol], CACHE_DURATIONS['2-MINUTES']);
      const nativePriceUSD = prices[wrappedNativeSymbol] || 0;

      if (nativePriceUSD === 0) {
        this.log(`${wrappedNativeSymbol} price unavailable, gas cost will be 0`);
        return 0;
      }

      return gasNative * nativePriceUSD;
    } catch (error) {
      console.error('Failed to calculate gas cost in USD:', error.message);
      return 0;
    }
  }

  /**
   * Log a tracking error to transactions.jsonl and increment error count
   * @param {string} vaultAddress
   * @param {Object} errorData - { eventType, transactionHash, timestamp, error }
   * @private
   */
  async logTrackingError(vaultAddress, errorData) {
    const { eventType, transactionHash, timestamp, error } = errorData;

    console.error(`[Tracker] Error handling ${eventType} for ${vaultAddress}: ${error}`);

    // Log error details to transactions file
    try {
      await this.appendTransaction(vaultAddress, {
        type: 'TrackingError',
        eventType,
        vaultAddress,
        transactionHash: transactionHash || null,
        error,
        timestamp: timestamp || Date.now()
      });
    } catch (appendError) {
      console.error(`[Tracker] Failed to log tracking error: ${appendError.message}`);
    }

    // Increment error count in metadata
    const metadata = this.vaultMetadata.get(vaultAddress);
    if (metadata) {
      metadata.aggregates.trackingErrorCount = (metadata.aggregates.trackingErrorCount || 0) + 1;
      metadata.metadata.lastUpdated = Date.now();
      try {
        await this.saveMetadata(vaultAddress, metadata);
      } catch (saveError) {
        console.error(`[Tracker] Failed to save error count: ${saveError.message}`);
      }
    }
  }

  //#region Tracking Failures

  /**
   * Load tracking failures from disk
   * @private
   */
  async loadTrackingFailures() {
    const dir = path.dirname(this.trackingFailuresFilePath);

    try {
      await fs.access(dir);
    } catch {
      // Directory doesn't exist - will be created when first failure is tracked
      this.log('Tracking failures directory does not exist yet');
      return;
    }

    try {
      const data = await fs.readFile(this.trackingFailuresFilePath, 'utf-8');
      const failures = JSON.parse(data);

      for (const [address, info] of Object.entries(failures)) {
        this.trackingFailures.set(address, info);
      }

      this.log(`Loaded ${this.trackingFailures.size} tracking failure(s)`);
    } catch (error) {
      if (error.code === 'ENOENT') {
        this.log('No tracking failures file found');
        return;
      }
      console.error(`[Tracker] Failed to load tracking failures: ${error.message}`);
    }
  }

  /**
   * Save tracking failures to disk
   * @private
   */
  async saveTrackingFailures() {
    const dir = path.dirname(this.trackingFailuresFilePath);

    try {
      await fs.access(dir);
    } catch {
      await fs.mkdir(dir, { recursive: true });
    }

    const data = JSON.stringify(this.getTrackingFailuresData(), null, 2);
    await fs.writeFile(this.trackingFailuresFilePath, data, 'utf-8');
    this.log('Tracking failures saved');
  }

  /**
   * Track a failure for a vault
   * @param {string} vaultAddress - Vault address
   * @param {string} eventType - Type of event that failed
   * @param {string} error - Error message
   */
  async trackFailure(vaultAddress, eventType, error) {
    const normalizedAddress = ethers.utils.getAddress(vaultAddress);
    const now = Date.now();
    const existing = this.trackingFailures.get(normalizedAddress);

    this.trackingFailures.set(normalizedAddress, {
      vaultAddress: normalizedAddress,
      failedAt: existing?.failedAt || now,
      lastAttempt: now,
      attempts: (existing?.attempts || 0) + 1,
      error,
      eventType
    });

    await this.saveTrackingFailures();

    this.eventManager.emit('TrackerFailure', {
      vaultAddress: normalizedAddress,
      eventType,
      error,
      attempts: this.trackingFailures.get(normalizedAddress).attempts,
      log: { level: 'error', message: `Tracking failed for ${normalizedAddress}: ${error}` }
    });
  }

  /**
   * Clear a tracking failure for a vault
   * @param {string} vaultAddress - Vault address
   */
  async clearTrackingFailure(vaultAddress) {
    const normalizedAddress = ethers.utils.getAddress(vaultAddress);

    if (this.trackingFailures.delete(normalizedAddress)) {
      await this.saveTrackingFailures();

      this.eventManager.emit('TrackerFailureCleared', {
        vaultAddress: normalizedAddress,
        log: { level: 'info', message: `Tracking failure cleared for ${normalizedAddress}` }
      });
    }
  }

  /**
   * Get tracking failures data for API
   * @returns {Object} Tracking failures data
   */
  getTrackingFailuresData() {
    const data = {};
    for (const [address, info] of this.trackingFailures.entries()) {
      data[address] = info;
    }
    return data;
  }

  //#endregion

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

    // Save tracking failures
    try {
      await this.saveTrackingFailures();
    } catch (error) {
      console.error(`[Tracker] Failed to save tracking failures during shutdown: ${error.message}`);
    }

    this.log('Tracker shutdown complete');
  }
}
