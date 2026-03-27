// fum_library/adapters/TraderJoeV2_2Adapter.js
/**
 * Adapter for Trader Joe V2.2 Liquidity Book on Arbitrum
 *
 * Trader Joe V2.2 uses a bin-based concentrated liquidity system where:
 * - tokenX = lower address (equivalent to Uniswap's token0)
 * - tokenY = higher address (equivalent to Uniswap's token1)
 * - Liquidity is distributed across discrete price bins instead of continuous ticks
 */

import { ethers } from "ethers";
import PlatformAdapter from "./PlatformAdapter.js";
import { getPlatformAddresses, getChainConfig } from "../helpers/chainHelpers.js";
import { getTokenBySymbol, getTokenByAddress, getWrappedNativeAddress, getWrappedNativeSymbol, isNativeToken, isWrappedNativeToken } from "../helpers/tokenHelpers.js";
import ERC20ARTIFACT from '@openzeppelin/contracts/build/contracts/ERC20.json' with { type: 'json' };
import contractData from "../artifacts/contracts.js";

// Trader Joe V2.2 ABIs and addresses from official SDK
import {
  LBPairV21ABI,
  LBRouterV21ABI,
  LBQuoterV21ABI,
  LBFactoryV21ABI,
  LB_FACTORY_V21_ADDRESS,
  LiquidityHelperV2ABI,
  getUniformDistributionFromBinRange,
  Bin,
} from "@traderjoe-xyz/sdk-v2";

const ERC20ABI = ERC20ARTIFACT.abi;

export default class TraderJoeV2_2Adapter extends PlatformAdapter {
  /**
   * Constructor for the Trader Joe V2.2 adapter
   * @param {number} chainId - Chain ID for the adapter
   */
  constructor(chainId) {
    super(chainId, "traderjoeV2_2", "Trader Joe V2.2");

    // Cache platform addresses from chain config
    this.addresses = { ...getPlatformAddresses(chainId, "traderjoeV2_2") };
    this.chainConfig = getChainConfig(chainId);

    // Store ABIs from official SDK
    this.lbPairABI = LBPairV21ABI;
    this.lbRouterABI = LBRouterV21ABI;
    this.lbQuoterABI = LBQuoterV21ABI;
    this.lbFactoryABI = LBFactoryV21ABI;

    // ERC20 ABI and interface for approval checks
    this.erc20ABI = ERC20ABI;
    this.erc20Interface = new ethers.utils.Interface(this.erc20ABI);

    // TJ V2.2 pools use WAVAX/WETH — no native token pools. Router wraps internally.
    // supportsNativePools = false (inherited from PlatformAdapter)
  }

  // =============================================================================
  // IMPLEMENTED METHODS
  // =============================================================================

  /**
   * Sort tokens into Trader Joe's canonical ordering (lower address = tokenX)
   *
   * @param {Object} token0 - First token data object
   * @param {string} token0.address - Token contract address
   * @param {Object} token1 - Second token data object
   * @param {string} token1.address - Token contract address
   * @returns {{sortedToken0: Object, sortedToken1: Object, tokensSwapped: boolean}}
   */
  sortTokens(token0, token1) {
    if (!token0?.address || !token1?.address) {
      throw new Error("Both tokens must have valid addresses");
    }

    const tokensSwapped = token0.address.toLowerCase() > token1.address.toLowerCase();

    return tokensSwapped
      ? { sortedToken0: token1, sortedToken1: token0, tokensSwapped: true }
      : { sortedToken0: token0, sortedToken1: token1, tokensSwapped: false };
  }

  // =============================================================================
  // STUB METHODS - To be implemented
  // =============================================================================

  /**
   * Get the event filter for monitoring swap events on Trader Joe V2.2
   *
   * For Trader Joe V2.2, the poolId IS the LBPair contract address.
   * Swaps emit directly from the LBPair contract (same pattern as V3).
   *
   * LBPair Swap event signature:
   *   Swap(address sender, address to, uint24 id, bytes32 amountsIn, bytes32 amountsOut, uint24 volatilityAccumulator, bytes32 totalFees, bytes32 protocolFees)
   *
   * @param {string} poolId - LBPair contract address
   * @returns {Object} Filter object with address and topics array
   * @throws {Error} If poolId is invalid
   */
  getSwapEventFilter(poolId) {
    if (!poolId || typeof poolId !== 'string') {
      throw new Error('poolId parameter is required and must be a string');
    }

    try {
      ethers.utils.getAddress(poolId);
    } catch (error) {
      throw new Error(`Invalid poolId address: ${poolId}`);
    }

    return {
      address: poolId,
      topics: [ethers.utils.id(this._getSwapEventSignature())]
    };
  }

  /**
   * Parse a Trader Joe V2.2 swap event log
   *
   * Decodes log data from an LBPair Swap event. Validates the event signature,
   * extracts indexed parameters (sender, to) from topics, and decodes non-indexed
   * data including packed bytes32 amounts.
   *
   * V2.2 Swap event:
   *   Swap(address indexed sender, address indexed to, uint24 id, bytes32 amountsIn,
   *        bytes32 amountsOut, uint24 volatilityAccumulator, bytes32 totalFees, bytes32 protocolFees)
   *
   * bytes32 packed amounts: upper 128 bits = tokenX amount, lower 128 bits = tokenY amount
   *
   * @param {Object} log - Raw blockchain event log
   * @param {string} log.address - LBPair contract address that emitted the event
   * @param {Array<string>} log.topics - [eventSig, sender, to]
   * @param {string} log.data - ABI-encoded non-indexed event data
   * @returns {Object} Parsed swap event data
   * @returns {number} result.activeId - Active bin ID after the swap (TJ equivalent of tick)
   * @returns {string} result.sender - Address that initiated the swap (checksummed)
   * @returns {string} result.to - Address that received the output (checksummed)
   * @returns {Object} result.amountsIn - Decoded input amounts { amountX: string, amountY: string }
   * @returns {Object} result.amountsOut - Decoded output amounts { amountX: string, amountY: string }
   * @returns {number} result.volatilityAccumulator - Protocol volatility tracking value
   * @returns {Object} result.totalFees - Decoded total fees { amountX: string, amountY: string }
   * @returns {Object} result.protocolFees - Decoded protocol fees { amountX: string, amountY: string }
   * @throws {Error} If log is null/undefined or missing required properties
   * @throws {Error} If log cannot be parsed as a Trader Joe V2.2 Swap event
   */
  parseSwapEvent(log) {
    if (!log) {
      throw new Error('Log parameter is required');
    }

    if (!log.address) {
      throw new Error('Log must have address property');
    }

    if (!log.topics || !Array.isArray(log.topics)) {
      throw new Error('Log must have topics array');
    }

    if (log.topics.length < 3) {
      throw new Error('Log must have at least 3 topics (event signature, sender, to)');
    }

    if (!log.data) {
      throw new Error('Log must have data property');
    }

    const expectedTopic = ethers.utils.id(this._getSwapEventSignature());
    if (log.topics[0] !== expectedTopic) {
      throw new Error(`Invalid swap event signature. Expected ${expectedTopic}, got ${log.topics[0]}`);
    }

    try {
      // Extract indexed parameters from topics
      // topics[1] = sender (address padded to 32 bytes)
      // topics[2] = to (address padded to 32 bytes)
      const sender = ethers.utils.getAddress('0x' + log.topics[1].slice(26));
      const to = ethers.utils.getAddress('0x' + log.topics[2].slice(26));

      // Decode non-indexed data
      const decoded = ethers.utils.defaultAbiCoder.decode(
        ['uint24', 'bytes32', 'bytes32', 'uint24', 'bytes32', 'bytes32'],
        log.data
      );

      return {
        activeId: Number(decoded[0]),
        sender,
        to,
        amountsIn: this._decodePackedAmounts(decoded[1]),
        amountsOut: this._decodePackedAmounts(decoded[2]),
        volatilityAccumulator: Number(decoded[3]),
        totalFees: this._decodePackedAmounts(decoded[4]),
        protocolFees: this._decodePackedAmounts(decoded[5])
      };
    } catch (error) {
      if (error.message.startsWith('Log ') || error.message.startsWith('Invalid swap')) {
        throw error;
      }
      throw new Error(`Failed to parse swap event: ${error.message}`);
    }
  }

  /**
   * Evaluate price movement between a baseline and current swap state
   *
   * Uses Trader Joe V2.2 bin-based pricing:
   *   price(id) = (1 + binStep/10000)^(id - 8388608)
   *
   * The percentage simplifies to:
   *   priceRatio = (1 + binStep/10000)^(currentId - baselineId)
   *   priceMovementPercent = |priceRatio - 1| * 100
   *
   * @param {Object} swapData - Parsed swap event from parseSwapEvent
   * @param {number} swapData.activeId - Current active bin ID
   * @param {Object} baseline - Baseline from getPoolCurrent ({ activeId, binStep })
   * @param {number} baseline.activeId - Baseline active bin ID
   * @param {number} baseline.binStep - Bin step in basis points
   * @param {Object} token0Data - Token0 data (tokenX, lower address)
   * @param {string} token0Data.address - Token contract address
   * @param {string} token0Data.symbol - Token symbol
   * @param {number} token0Data.decimals - Token decimals
   * @param {Object} token1Data - Token1 data (tokenY, higher address)
   * @param {string} token1Data.address - Token contract address
   * @param {string} token1Data.symbol - Token symbol
   * @param {number} token1Data.decimals - Token decimals
   * @returns {{ priceMovementPercent: number, baselinePrice: string, currentPrice: string, direction: string }}
   * @throws {Error} If any parameter is invalid or missing required properties
   */
  evaluatePriceMovement(swapData, baseline, token0Data, token1Data) {
    // Validate swapData
    if (!swapData) {
      throw new Error('swapData parameter is required');
    }
    if (typeof swapData.activeId !== 'number') {
      throw new Error('swapData must have activeId property as a number');
    }

    // Validate baseline
    if (baseline === undefined || baseline === null) {
      throw new Error('baseline parameter is required');
    }
    if (typeof baseline !== 'object' || typeof baseline.activeId !== 'number') {
      throw new Error('baseline must have activeId property as a number');
    }
    if (baseline.binStep === undefined || baseline.binStep === null) {
      throw new Error('baseline must have binStep property');
    }

    // Validate token data
    if (!token0Data || !token0Data.address || !token0Data.symbol || token0Data.decimals === undefined) {
      throw new Error('token0Data must have address, symbol, and decimals properties');
    }
    if (!token1Data || !token1Data.address || !token1Data.symbol || token1Data.decimals === undefined) {
      throw new Error('token1Data must have address, symbol, and decimals properties');
    }

    const currentActiveId = swapData.activeId;
    const baselineActiveId = baseline.activeId;
    const binStep = baseline.binStep;

    // Convert bin IDs to human-readable prices
    const baselinePrice = this._binIdToPrice(baselineActiveId, binStep, token0Data.decimals, token1Data.decimals);
    const currentPrice = this._binIdToPrice(currentActiveId, binStep, token0Data.decimals, token1Data.decimals);

    // Calculate price movement percentage
    // priceRatio = (1 + binStep/10000)^(currentId - baselineId)
    // priceMovementPercent = |priceRatio - 1| * 100
    if (baselinePrice === 0) {
      throw new Error('Baseline price is zero, cannot calculate movement');
    }

    const priceRatio = currentPrice / baselinePrice;
    const priceMovementPercent = Math.abs((priceRatio - 1) * 100);
    const direction = currentPrice >= baselinePrice ? 'up' : 'down';

    return {
      priceMovementPercent,
      baselinePrice: baselinePrice.toString(),
      currentPrice: currentPrice.toString(),
      direction
    };
  }

  async getPositionsForVDS(address, provider) {
    // Validate address
    if (!address) {
      throw new Error("Address parameter is required");
    }
    try {
      ethers.utils.getAddress(address);
    } catch (error) {
      throw new Error(`Invalid address: ${address}`);
    }

    // Validate provider
    if (!provider || typeof provider.getNetwork !== 'function') {
      throw new Error("Valid provider parameter is required");
    }

    try {
      const positionManagerAddress = this.addresses.positionManagerAddress;
      if (!positionManagerAddress) {
        throw new Error(`No position manager address configured for chainId: ${this.chainId}`);
      }

      const positionManager = new ethers.Contract(
        positionManagerAddress, contractData.TJPositionManager.abi, provider
      );

      // Get all position IDs for this vault
      const positionIds = await positionManager.getPositionsByVault(address);

      if (positionIds.length === 0) {
        return { positions: {}, poolData: {} };
      }

      // Fetch each position via getPositionById and aggregate results
      const positions = {};
      const poolData = {};

      for (const positionId of positionIds) {
        try {
          const result = await this.getPositionById(positionId, provider);

          // Filter out inactive positions (TJ equivalent of zero-liquidity filter)
          if (!result.position.active) {
            continue;
          }

          positions[result.position.id] = result.position;
          Object.assign(poolData, result.poolData);
        } catch (error) {
          // Skip positions that fail to fetch (e.g., no deposit bins)
          continue;
        }
      }

      return { positions, poolData };

    } catch (error) {
      if (error.message.includes('Address parameter') ||
          error.message.includes('Invalid address') ||
          error.message.includes('Valid provider') ||
          error.message.includes('No position manager')) {
        throw error;
      }
      throw new Error(`Failed to fetch positions for VDS: ${error.message}`);
    }
  }

  async getPositionsForDisplay(ownerAddress, provider) {
    // Validate address
    if (!ownerAddress) {
      throw new Error("Address parameter is required");
    }
    try {
      ethers.utils.getAddress(ownerAddress);
    } catch (error) {
      throw new Error(`Invalid address: ${ownerAddress}`);
    }

    // Validate provider
    if (!provider || typeof provider.getNetwork !== 'function') {
      throw new Error("Valid provider parameter is required");
    }

    try {
      const positionManagerAddress = this.addresses.positionManagerAddress;
      if (!positionManagerAddress) {
        throw new Error(`No position manager address configured for chainId: ${this.chainId}`);
      }

      const positionManager = new ethers.Contract(
        positionManagerAddress, contractData.TJPositionManager.abi, provider
      );

      // Get all position IDs for this vault
      const positionIds = await positionManager.getPositionsByVault(ownerAddress);

      if (positionIds.length === 0) {
        return { positions: {} };
      }

      // Fetch each position and filter inactive
      const activePositions = [];
      for (const positionId of positionIds) {
        const positionData = await positionManager.getPosition(positionId);
        if (!positionData.active) continue;

        const depositIds = positionData.depositIds.map(id => Number(id));
        if (depositIds.length === 0) continue;

        activePositions.push({
          id: String(positionId),
          lbPair: positionData.lbPair.toLowerCase(),
          proxy: positionData.proxy,
          tokenX: positionData.tokenX,
          tokenY: positionData.tokenY,
          depositIds,
          liquidityMinted: positionData.liquidityMinted.map(lm => lm.toString()),
          binStep: Number(positionData.binStep),
          lowerBinId: Math.min(...depositIds),
          upperBinId: Math.max(...depositIds),
        });
      }

      if (activePositions.length === 0) {
        return { positions: {} };
      }

      // Group by pool (LBPair address) to batch pool data fetches
      const poolGroups = new Map();
      for (const pos of activePositions) {
        const poolKey = pos.lbPair;
        if (!poolGroups.has(poolKey)) {
          poolGroups.set(poolKey, []);
        }
        poolGroups.get(poolKey).push(pos);
      }

      // Fetch pool data and token metadata once per pool
      const poolDataMap = new Map();
      await Promise.all(
        Array.from(poolGroups.keys()).map(async (poolAddress) => {
          const poolData = await this.getPoolData(poolAddress, provider);
          const token0Config = getTokenByAddress(poolData.tokenX, this.chainId);
          const token1Config = getTokenByAddress(poolData.tokenY, this.chainId);
          const token0Data = { address: poolData.tokenX, symbol: token0Config.symbol, decimals: token0Config.decimals };
          const token1Data = { address: poolData.tokenY, symbol: token1Config.symbol, decimals: token1Config.decimals };
          poolDataMap.set(poolAddress, { poolData, token0Data, token1Data });
        })
      );

      // Build display positions
      const positions = {};

      for (const [poolAddress, posGroup] of poolGroups.entries()) {
        const { poolData, token0Data, token1Data } = poolDataMap.get(poolAddress);

        for (const pos of posGroup) {
          // Range check
          const inRange = poolData.activeId >= pos.lowerBinId && poolData.activeId <= pos.upperBinId;

          // Prices from bin IDs
          const currentPrice = this._binIdToPrice(poolData.activeId, poolData.binStep, token0Data.decimals, token1Data.decimals);
          const priceLower = this._binIdToPrice(pos.lowerBinId, poolData.binStep, token0Data.decimals, token1Data.decimals);
          const priceUpper = this._binIdToPrice(pos.upperBinId, poolData.binStep, token0Data.decimals, token1Data.decimals);

          // Token amounts (requires RPC for TJ)
          const positionForCalc = {
            pool: pos.lbPair,
            depositIds: pos.depositIds,
            liquidityMinted: pos.liquidityMinted,
          };
          const [token0Raw, token1Raw] = await this.calculateTokenAmounts(
            positionForCalc, poolData, token0Data, token1Data, provider
          );
          const token0Amount = Number(token0Raw) / Math.pow(10, token0Data.decimals);
          const token1Amount = Number(token1Raw) / Math.pow(10, token1Data.decimals);

          // Uncollected fees via LiquidityHelperV2
          const posData = await this._getPositionOnChainData(pos.id, provider);
          const feeResult = await this._computeFeeShares(posData, provider);

          let totalFeesX = 0n;
          let totalFeesY = 0n;
          for (const feeX of feeResult.feesX) totalFeesX += BigInt(feeX);
          for (const feeY of feeResult.feesY) totalFeesY += BigInt(feeY);

          const uncollectedFees0 = Number(totalFeesX) / Math.pow(10, token0Data.decimals);
          const uncollectedFees1 = Number(totalFeesY) / Math.pow(10, token1Data.decimals);

          // Fee percentage (base fee only), rounded to avoid IEEE 754 float noise
          const fee = Math.round(poolData.feeParameters.baseFactor * poolData.binStep / 1e8 * 100 * 1e6) / 1e6;

          positions[pos.id] = {
            // Identity
            id: pos.id,
            platform: this.platformId,
            platformName: this.platformName,
            tokenPair: `${token0Data.symbol}/${token1Data.symbol}`,
            pool: poolAddress,

            // Display-ready numbers
            inRange,
            currentPrice,
            priceLower,
            priceUpper,
            token0Amount,
            token1Amount,
            uncollectedFees0,
            uncollectedFees1,
            fee,

            // Opaque platform data for actions
            platformData: {
              lowerBinId: pos.lowerBinId,
              upperBinId: pos.upperBinId,
              binStep: poolData.binStep,
              depositIds: pos.depositIds,
              liquidityMinted: pos.liquidityMinted,
              activeId: poolData.activeId,
              proxyAddress: pos.proxy,
            }
          };
        }
      }

      return { positions };

    } catch (error) {
      // Re-throw validation errors as-is
      if (error.message.includes('Address parameter') ||
          error.message.includes('Invalid address') ||
          error.message.includes('Valid provider') ||
          error.message.includes('No position manager')) {
        throw error;
      }
      throw new Error(`Failed to fetch positions for display: ${error.message}`);
    }
  }

  /**
   * Refresh display data for a single position
   *
   * Returns the same per-position shape as getPositionsForDisplay but for one position.
   * Used by the frontend to refresh display data while a modal is open without
   * re-fetching all positions for the owner.
   *
   * @param {string} positionId - Position ID (numeric string)
   * @param {Object} provider - Ethers provider instance
   * @returns {Promise<Object>} Single position in getPositionsForDisplay shape
   * @throws {Error} If positionId is invalid, position not found, inactive, or has no bins
   */
  async refreshPositionForDisplay(positionId, provider) {
    // Validate positionId
    if (positionId === null || positionId === undefined) {
      throw new Error("Position ID is required");
    }
    if (typeof positionId !== 'string') {
      throw new Error("Position ID must be a string");
    }
    if (!/^\d+$/.test(positionId)) {
      throw new Error("Position ID must be a numeric string");
    }

    // Validate provider
    if (!provider || typeof provider.getNetwork !== 'function') {
      throw new Error("Valid provider parameter is required");
    }

    try {
      if (!this.addresses?.positionManagerAddress) {
        throw new Error(`No position manager address configured for chainId: ${this.chainId}`);
      }

      const positionManager = new ethers.Contract(
        this.addresses.positionManagerAddress, contractData.TJPositionManager.abi, provider
      );
      const positionData = await positionManager.getPosition(positionId);

      // Reject non-existent positions
      if (positionData.lbPair === ethers.constants.AddressZero) {
        throw new Error(`Position ${positionId} not found`);
      }

      // Reject inactive positions
      if (!positionData.active) {
        throw new Error(`Position ${positionId} is not active`);
      }

      const depositIds = positionData.depositIds.map(id => Number(id));
      if (depositIds.length === 0) {
        throw new Error(`Position ${positionId} has no deposit bins`);
      }

      const liquidityMinted = positionData.liquidityMinted.map(lm => lm.toString());
      const lowerBinId = Math.min(...depositIds);
      const upperBinId = Math.max(...depositIds);
      const poolAddress = positionData.lbPair.toLowerCase();

      // Fetch pool data and token metadata
      const poolData = await this.getPoolData(poolAddress, provider);
      const token0Config = getTokenByAddress(poolData.tokenX, this.chainId);
      const token1Config = getTokenByAddress(poolData.tokenY, this.chainId);
      const token0Data = { address: poolData.tokenX, symbol: token0Config.symbol, decimals: token0Config.decimals };
      const token1Data = { address: poolData.tokenY, symbol: token1Config.symbol, decimals: token1Config.decimals };

      // Range check
      const inRange = poolData.activeId >= lowerBinId && poolData.activeId <= upperBinId;

      // Prices
      const currentPrice = this._binIdToPrice(poolData.activeId, poolData.binStep, token0Data.decimals, token1Data.decimals);
      const priceLower = this._binIdToPrice(lowerBinId, poolData.binStep, token0Data.decimals, token1Data.decimals);
      const priceUpper = this._binIdToPrice(upperBinId, poolData.binStep, token0Data.decimals, token1Data.decimals);

      // Token amounts
      const positionForCalc = { pool: poolAddress, depositIds, liquidityMinted };
      const [token0Raw, token1Raw] = await this.calculateTokenAmounts(positionForCalc, poolData, token0Data, token1Data, provider);
      const token0Amount = Number(token0Raw) / Math.pow(10, token0Data.decimals);
      const token1Amount = Number(token1Raw) / Math.pow(10, token1Data.decimals);

      // Uncollected fees
      const posData = await this._getPositionOnChainData(positionId, provider);
      const feeResult = await this._computeFeeShares(posData, provider);

      let totalFeesX = 0n;
      let totalFeesY = 0n;
      for (const feeX of feeResult.feesX) totalFeesX += BigInt(feeX);
      for (const feeY of feeResult.feesY) totalFeesY += BigInt(feeY);

      const uncollectedFees0 = Number(totalFeesX) / Math.pow(10, token0Data.decimals);
      const uncollectedFees1 = Number(totalFeesY) / Math.pow(10, token1Data.decimals);

      // Fee percentage (base fee only), rounded to avoid IEEE 754 float noise
      const fee = Math.round(poolData.feeParameters.baseFactor * poolData.binStep / 1e8 * 100 * 1e6) / 1e6;

      return {
        id: String(positionId),
        platform: this.platformId,
        platformName: this.platformName,
        tokenPair: `${token0Data.symbol}/${token1Data.symbol}`,
        pool: poolAddress,
        inRange, currentPrice, priceLower, priceUpper,
        token0Amount, token1Amount, uncollectedFees0, uncollectedFees1, fee,
        platformData: {
          lowerBinId, upperBinId,
          binStep: poolData.binStep,
          depositIds,
          liquidityMinted,
          activeId: poolData.activeId,
          proxyAddress: positionData.proxy,
        }
      };
    } catch (error) {
      if (error.message.includes('Position ID') ||
          error.message.includes('Valid provider') ||
          error.message.includes('not found') ||
          error.message.includes('not active') ||
          error.message.includes('no deposit bins')) {
        throw error;
      }
      throw new Error(`Failed to refresh position ${positionId} for display: ${error.message}`);
    }
  }

  async getPositionById(tokenId, provider) {
    // Validate params (same pattern as V3/V4)
    if (tokenId === null || tokenId === undefined || tokenId === '') {
      throw new Error('TokenId parameter is required');
    }
    if (!provider || typeof provider.getNetwork !== 'function') {
      throw new Error('Valid provider parameter is required');
    }

    try {
      const positionManagerAddress = this.addresses.positionManagerAddress;
      if (!positionManagerAddress) {
        throw new Error(`No position manager address configured for chainId: ${this.chainId}`);
      }

      const positionManager = new ethers.Contract(
        positionManagerAddress, contractData.TJPositionManager.abi, provider
      );

      const positionData = await positionManager.getPosition(tokenId);

      if (positionData.lbPair === ethers.constants.AddressZero) {
        throw new Error(`Position ${tokenId} not found`);
      }

      const depositIds = positionData.depositIds.map(id => Number(id));
      const liquidityMinted = positionData.liquidityMinted.map(lm => lm.toString());

      if (depositIds.length === 0) {
        throw new Error(`Position ${tokenId} has no deposit bins`);
      }

      const poolAddress = positionData.lbPair.toLowerCase();
      const tokenXInfo = getTokenByAddress(positionData.tokenX, this.chainId);
      const tokenYInfo = getTokenByAddress(positionData.tokenY, this.chainId);

      return {
        position: {
          id: String(tokenId),
          pool: poolAddress,
          proxy: positionData.proxy,
          lowerBinId: Math.min(...depositIds),
          upperBinId: Math.max(...depositIds),
          depositIds,
          liquidityMinted,
          active: positionData.active,
          createdAt: Number(positionData.createdAt),
          lastUpdated: Date.now()
        },
        poolData: {
          [poolAddress]: {
            token0Symbol: tokenXInfo.symbol,
            token1Symbol: tokenYInfo.symbol,
            binStep: Number(positionData.binStep),
            platform: 'traderjoeV2_2'
          }
        }
      };
    } catch (error) {
      if (error.message.includes('TokenId parameter') ||
          error.message.includes('Valid provider') ||
          error.message.includes('not found') ||
          error.message.includes('No position manager')) {
        throw error;
      }
      throw new Error(`Failed to fetch position ${tokenId}: ${error.message}`);
    }
  }

  async getAccruedFeesUSD(position, tokenPrices, provider) {
    // Validate inputs
    if (!position || typeof position !== 'object') {
      throw new Error('position is required and must be an object');
    }
    if (position.id === undefined || position.id === null) {
      throw new Error('position.id is required');
    }
    if (!tokenPrices || typeof tokenPrices !== 'object') {
      throw new Error('tokenPrices is required and must be an object');
    }
    if (typeof tokenPrices.token0 !== 'number' || typeof tokenPrices.token1 !== 'number') {
      throw new Error('tokenPrices must have token0 and token1 as numbers');
    }
    if (!provider) {
      throw new Error('provider is required');
    }

    // Fetch position on-chain data (baselines, proxy, token addresses)
    const posData = await this._getPositionOnChainData(position.id, provider);

    // Compute feeShares and earned fees via LiquidityHelperV2
    const feeResult = await this._computeFeeShares(posData, provider);

    // Sum per-bin fees using BigInt for precision
    let totalFeesX = BigInt(0);
    let totalFeesY = BigInt(0);

    for (const feeX of feeResult.feesX) {
      totalFeesX += BigInt(feeX);
    }
    for (const feeY of feeResult.feesY) {
      totalFeesY += BigInt(feeY);
    }

    // Look up token decimals (tokenX = lower address = token0)
    const tokenXData = getTokenByAddress(posData.tokenX, this.chainId);
    const tokenYData = getTokenByAddress(posData.tokenY, this.chainId);

    // Format fees (divide by 10^decimals)
    const token0Fees = Number(totalFeesX) / Math.pow(10, tokenXData.decimals);
    const token1Fees = Number(totalFeesY) / Math.pow(10, tokenYData.decimals);

    // Convert to USD
    const token0USD = token0Fees * tokenPrices.token0;
    const token1USD = token1Fees * tokenPrices.token1;
    const totalUSD = token0USD + token1USD;

    return {
      totalUSD,
      token0Fees,
      token1Fees,
      token0USD,
      token1USD,
      fees0: totalFeesX.toString(),
      fees1: totalFeesY.toString(),
      feeShares: feeResult.feeShares,
    };
  }

  async generateClaimFeesData(params) {
    const {
      position, provider, feeData,
      slippageTolerance = 0.5, deadlineMinutes = 20
    } = params;

    if (!position || typeof position !== 'object') throw new Error("Position parameter is required");
    if (position.id === null || position.id === undefined) throw new Error("Position id is required");
    if (!this.addresses?.positionManagerAddress) throw new Error("No position manager address configured");

    // Get feeShares: from threaded feeData (strategy path) or compute fresh (frontend path)
    let feeShares, feesX, feesY;
    if (feeData && feeData.feeShares) {
      feeShares = feeData.feeShares;
      feesX = feeData.fees0 ? [feeData.fees0] : null;
      feesY = feeData.fees1 ? [feeData.fees1] : null;
    } else {
      if (!provider) throw new Error("provider is required when feeData is not provided");
      const posData = await this._getPositionOnChainData(position.id, provider);
      const computed = await this._computeFeeShares(posData, provider);
      feeShares = computed.feeShares;
      feesX = computed.feesX;
      feesY = computed.feesY;
    }

    // Early return null if all feeShares are zero (nothing to collect)
    const allZero = feeShares.every(fs => fs === '0');
    if (allZero) {
      return null;
    }

    // Compute slippage minimums from fee amounts
    const slippageBps = BigInt(Math.round(slippageTolerance * 100));
    let totalFeesX = BigInt(0);
    let totalFeesY = BigInt(0);
    if (feesX) {
      for (const fx of feesX) totalFeesX += BigInt(fx);
    }
    if (feesY) {
      for (const fy of feesY) totalFeesY += BigInt(fy);
    }
    const amountXMin = (totalFeesX * (10000n - slippageBps) / 10000n).toString();
    const amountYMin = (totalFeesY * (10000n - slippageBps) / 10000n).toString();

    const deadline = this._createDeadline(deadlineMinutes);

    const iface = new ethers.utils.Interface([
      "function collectFees(uint256 positionId, uint256[] feeShares, uint256 amountXMin, uint256 amountYMin, uint256 deadline)"
    ]);

    return {
      to: this.addresses.positionManagerAddress,
      data: iface.encodeFunctionData("collectFees", [
        position.id, feeShares, amountXMin, amountYMin, deadline
      ]),
      value: '0x00',
      quote: { feeShares, feesX, feesY, amountXMin, amountYMin },
    };
  }

  /**
   * Evaluate a position's range status relative to current pool state
   *
   * Determines if a Trader Joe V2.2 position is in range and calculates distance metrics.
   * Checks the current activeId against the position's lowerBinId/upperBinId.
   *
   * Two modes:
   * 1. Without swapData: fetches current activeId from blockchain via provider
   * 2. With options.swapData: extracts activeId from parsed swap event (no RPC call)
   *
   * @param {Object} position - Position object with bin range bounds
   * @param {number} position.lowerBinId - Lower bin boundary
   * @param {number} position.upperBinId - Upper bin boundary
   * @param {string} position.pool - LBPair contract address (required if fetching from blockchain)
   * @param {Object} provider - Ethers provider instance (can be null if swapData provided)
   * @param {Object} [options] - Optional parameters
   * @param {Object} [options.swapData] - Parsed swap event data with activeId
   * @returns {Promise<Object>} Range evaluation result
   *   - inRange: boolean - Is position currently earning fees
   *   - centeredness: number (0-1) - 0 = at lower, 0.5 = centered, 1 = at upper
   *   - distanceToUpper: number (0-1) - Distance to upper bound as fraction
   *   - distanceToLower: number (0-1) - Distance to lower bound as fraction
   *   - current: number - Current active bin ID
   */
  async evaluatePositionRange(position, provider, options = {}) {
    // Validate position object
    if (!position) {
      throw new Error('position parameter is required');
    }

    // Validate bin bounds
    if (position.lowerBinId === undefined || position.lowerBinId === null) {
      throw new Error(`Position missing bin range data: lowerBinId=${position.lowerBinId}, upperBinId=${position.upperBinId}`);
    }
    if (position.upperBinId === undefined || position.upperBinId === null) {
      throw new Error(`Position missing bin range data: lowerBinId=${position.lowerBinId}, upperBinId=${position.upperBinId}`);
    }

    // Get current activeId - either from swapData or from blockchain
    let currentBinId;
    if (options.swapData !== undefined) {
      // Extract activeId from parsed swap event
      if (!options.swapData || typeof options.swapData.activeId !== 'number') {
        throw new Error('options.swapData must have activeId property as a number');
      }
      if (!Number.isFinite(options.swapData.activeId)) {
        throw new Error('options.swapData.activeId must be a finite number');
      }
      currentBinId = options.swapData.activeId;
    } else {
      // Fetch from blockchain via getPoolData
      if (!position.pool) {
        throw new Error('Position missing pool address');
      }
      const poolData = await this.getPoolData(position.pool, provider);
      currentBinId = poolData.activeId;
    }

    // Calculate range metrics
    const rangeSize = position.upperBinId - position.lowerBinId;
    if (rangeSize <= 0) {
      throw new Error(`Invalid bin range: ${position.lowerBinId} to ${position.upperBinId}`);
    }

    const inRange = currentBinId >= position.lowerBinId && currentBinId <= position.upperBinId;
    const distanceToUpper = (position.upperBinId - currentBinId) / rangeSize;
    const distanceToLower = (currentBinId - position.lowerBinId) / rangeSize;
    const centeredness = distanceToLower; // 0 = at lower, 0.5 = centered, 1 = at upper

    return {
      inRange,
      centeredness: Math.max(0, Math.min(1, centeredness)),
      distanceToUpper: Math.max(0, Math.min(1, distanceToUpper)),
      distanceToLower: Math.max(0, Math.min(1, distanceToLower)),
      current: currentBinId
    };
  }

  /**
   * Calculate the current token amounts for a Trader Joe V2.2 position.
   *
   * Unlike V3/V4 (pure math from liquidity + price), TJ requires RPC calls
   * to fetch per-bin reserves and total supplies from the LBPair contract,
   * then delegates to PairV2.calculateAmounts() from the TJ SDK.
   *
   * @param {Object} position - Position from getPositionById()
   * @param {string} position.pool - LBPair contract address
   * @param {number[]} position.depositIds - Bin IDs with liquidity
   * @param {string[]} position.liquidityMinted - Liquidity shares per bin
   * @param {Object} poolData - Pool data from getPoolData()
   * @param {Object} token0Data - Token0 metadata
   * @param {Object} token1Data - Token1 metadata
   * @param {Object} provider - Ethers provider instance (REQUIRED for TJ)
   * @returns {Promise<[BigInt, BigInt]>} [amountX, amountY] as native BigInts
   */
  async calculateTokenAmounts(position, poolData, token0Data, token1Data, provider) {
    // --- Provider validation (required for TJ) ---
    if (!provider) {
      throw new Error('provider is required for Trader Joe V2.2 calculateTokenAmounts');
    }

    // --- Position validation ---
    if (!position || typeof position !== 'object' || Array.isArray(position)) {
      throw new Error('position is required and must be an object');
    }
    if (!position.pool || typeof position.pool !== 'string') {
      throw new Error('position.pool is required and must be a string');
    }
    if (!Array.isArray(position.depositIds) || position.depositIds.length === 0) {
      throw new Error('position.depositIds is required and must be a non-empty array');
    }
    if (!Array.isArray(position.liquidityMinted) || position.liquidityMinted.length === 0) {
      throw new Error('position.liquidityMinted is required and must be a non-empty array');
    }
    if (position.depositIds.length !== position.liquidityMinted.length) {
      throw new Error(
        `position.depositIds length (${position.depositIds.length}) must match ` +
        `position.liquidityMinted length (${position.liquidityMinted.length})`
      );
    }

    // --- Pool/token data validation ---
    if (!poolData || typeof poolData !== 'object' || Array.isArray(poolData)) {
      throw new Error('poolData is required and must be an object');
    }
    if (!token0Data || typeof token0Data !== 'object') {
      throw new Error('token0Data is required and must be an object');
    }
    if (!token1Data || typeof token1Data !== 'object') {
      throw new Error('token1Data is required and must be an object');
    }

    // --- Early return for zero liquidity ---
    const allZero = position.liquidityMinted.every(lm => BigInt(lm) === 0n);
    if (allZero) {
      return [0n, 0n];
    }

    // --- Fetch per-bin reserves + total supplies from LBPair ---
    const lbPair = new ethers.Contract(position.pool, this.lbPairABI, provider);
    const [activeId, bins, totalSupplies] = await Promise.all([
      lbPair.getActiveId(),
      Promise.all(position.depositIds.map(id => lbPair.getBin(id))),
      Promise.all(position.depositIds.map(id => lbPair.totalSupply(id)))
    ]);

    // --- Use TJ SDK to compute token amounts ---
    const { PairV2 } = await import("@traderjoe-xyz/sdk-v2");

    const binReserves = bins.map(b => ({
      reserveX: b[0].toBigInt(),
      reserveY: b[1].toBigInt()
    }));
    const supplies = totalSupplies.map(ts => ts.toBigInt());

    const { amountX, amountY } = PairV2.calculateAmounts(
      position.depositIds,
      Number(activeId),
      binReserves,
      supplies,
      position.liquidityMinted
    );

    return [BigInt(amountX.toString()), BigInt(amountY.toString())];
  }

  /**
   * Generate calldata for removing liquidity from a TJ V2.2 position
   *
   * The vault calls decreaseLiquidity() on VaultFactory, which validates via
   * TJPositionValidator, then executes the calldata against TJPositionManager.
   * Uses removePosition() for 100% removal, decreaseLiquidity() for partial.
   *
   * @param {Object} params
   * @param {Object} params.position - Position object from getPositionById()
   * @param {string} params.position.id - Position ID (numeric string)
   * @param {string} params.position.pool - LBPair contract address
   * @param {number[]} params.position.depositIds - Bin IDs with liquidity
   * @param {string[]} params.position.liquidityMinted - Liquidity amounts per bin
   * @param {boolean} params.position.active - Must be true
   * @param {number} params.percentage - Percentage of liquidity to remove (1-100)
   * @param {Object} params.provider - Ethers provider instance
   * @param {string} params.walletAddress - Vault address
   * @param {number} params.slippageTolerance - Slippage tolerance (0-100)
   * @param {number} params.deadlineMinutes - Transaction deadline in minutes from now
   * @returns {Promise<{to: string, data: string, value: string, quote: Object}>}
   */
  async generateRemoveLiquidityData(params) {
    const {
      position,
      percentage,
      provider,
      slippageTolerance,
      deadlineMinutes
    } = params;

    // --- Position validation ---
    if (position === null || position === undefined) {
      throw new Error("Position parameter is required");
    }
    if (typeof position !== 'object' || Array.isArray(position)) {
      throw new Error("Position must be an object");
    }
    if (position.id === null || position.id === undefined) {
      throw new Error("Position id is required");
    }
    if (!/^\d+$/.test(String(position.id))) {
      throw new Error("Position id must be numeric");
    }
    if (!position.pool || typeof position.pool !== 'string') {
      throw new Error("Position pool is required");
    }
    if (!Array.isArray(position.depositIds) || position.depositIds.length === 0) {
      throw new Error("Position depositIds must be a non-empty array");
    }
    if (!Array.isArray(position.liquidityMinted) || position.liquidityMinted.length === 0) {
      throw new Error("Position liquidityMinted must be a non-empty array");
    }
    if (position.depositIds.length !== position.liquidityMinted.length) {
      throw new Error("Position depositIds and liquidityMinted must have the same length");
    }
    if (position.active !== true) {
      throw new Error("Position must be active");
    }

    // --- Percentage validation ---
    if (percentage === null || percentage === undefined) {
      throw new Error("Percentage is required");
    }
    if (!Number.isFinite(percentage)) {
      throw new Error("Percentage must be a finite number");
    }
    if (!Number.isInteger(percentage)) {
      throw new Error("Percentage must be an integer");
    }
    if (percentage < 1 || percentage > 100) {
      throw new Error("Percentage must be between 1 and 100");
    }

    // --- Provider validation ---
    if (!provider) {
      throw new Error("Provider is required");
    }

    // --- Slippage validation ---
    if (slippageTolerance === null || slippageTolerance === undefined) {
      throw new Error("Slippage tolerance is required");
    }
    if (!Number.isFinite(slippageTolerance)) {
      throw new Error("Slippage tolerance must be a finite number");
    }
    if (slippageTolerance < 0 || slippageTolerance > 100) {
      throw new Error("Slippage tolerance must be between 0 and 100");
    }

    // --- Deadline validation ---
    if (deadlineMinutes === null || deadlineMinutes === undefined) {
      throw new Error("Deadline minutes is required");
    }
    if (!Number.isFinite(deadlineMinutes)) {
      throw new Error("Deadline minutes must be a finite number");
    }
    if (deadlineMinutes <= 0) {
      throw new Error("Deadline minutes must be greater than 0");
    }

    // --- Position manager address ---
    if (!this.addresses?.positionManagerAddress) {
      throw new Error(`No position manager address found for chainId: ${this.chainId}`);
    }
    const positionManagerAddress = this.addresses.positionManagerAddress;

    // --- Compute amounts to remove per bin (scale by percentage) ---
    const amountsToRemove = position.liquidityMinted.map(
      lm => (BigInt(lm) * BigInt(percentage) / 100n).toString()
    );

    // --- Fetch bin reserves + total supplies from LBPair ---
    const lbPair = new ethers.Contract(position.pool, this.lbPairABI, provider);
    const [activeId, bins, totalSupplies] = await Promise.all([
      lbPair.getActiveId(),
      Promise.all(position.depositIds.map(id => lbPair.getBin(id))),
      Promise.all(position.depositIds.map(id => lbPair.totalSupply(id)))
    ]);

    // --- Use TJ SDK static method to compute expected amounts ---
    const { PairV2 } = await import("@traderjoe-xyz/sdk-v2");

    const binReserves = bins.map(b => ({
      reserveX: b[0].toBigInt(),
      reserveY: b[1].toBigInt()
    }));
    const supplies = totalSupplies.map(ts => ts.toBigInt());

    const { amountX, amountY } = PairV2.calculateAmounts(
      position.depositIds,
      Number(activeId),
      binReserves,
      supplies,
      amountsToRemove
    );

    // Convert JSBI to BigInt strings
    const amountXStr = amountX.toString();
    const amountYStr = amountY.toString();

    // --- Compute feeShares via LiquidityHelperV2 ---
    const posData = await this._getPositionOnChainData(position.id, provider);
    const { feeShares } = await this._computeFeeShares(posData, provider);

    // --- Apply slippage to principal only ---
    // Fees are deterministic (based on feeShares passed in) and not susceptible to
    // sandwich attacks. Including fees in the minimum risks reverts from rounding
    // differences between off-chain helper and on-chain contract math.
    const slippageBps = BigInt(Math.round(slippageTolerance * 100));
    const amountXMin = (BigInt(amountXStr) * (10000n - slippageBps) / 10000n).toString();
    const amountYMin = (BigInt(amountYStr) * (10000n - slippageBps) / 10000n).toString();

    // --- Compute deadline ---
    const deadline = this._createDeadline(deadlineMinutes);

    // --- Encode calldata: removePosition (100%) or decreaseLiquidity (partial) ---
    let calldata;

    if (percentage === 100) {
      const iface = new ethers.utils.Interface([
        "function removePosition(uint256 positionId, uint256[] feeShares, uint256 amountXMin, uint256 amountYMin, uint256 deadline)"
      ]);
      calldata = iface.encodeFunctionData("removePosition", [
        position.id, feeShares, amountXMin, amountYMin, deadline
      ]);
    } else {
      const iface = new ethers.utils.Interface([
        "function decreaseLiquidity(uint256 positionId, uint256 percentage, uint256[] feeShares, uint256 amountXMin, uint256 amountYMin, uint256 deadline)"
      ]);
      calldata = iface.encodeFunctionData("decreaseLiquidity", [
        position.id, percentage, feeShares, amountXMin, amountYMin, deadline
      ]);
    }

    return {
      to: positionManagerAddress,
      data: calldata,
      value: '0x00',
      quote: {
        positionId: position.id,
        percentage,
        amountX: amountXStr,
        amountY: amountYStr,
        amountXMin,
        amountYMin,
        feeShares,
        deadline,
        depositIds: position.depositIds,
        liquidityMinted: position.liquidityMinted,
        amountsToRemove
      }
    };
  }

  async generateAddLiquidityData(params) {
    const {
      position,
      token0Amount,
      token1Amount,
      provider,
      poolData,
      token0Data,
      token1Data,
      slippageTolerance,
      deadlineMinutes
    } = params;

    // --- Position validation (hybrid of create + remove patterns) ---
    if (position === null || position === undefined) {
      throw new Error("Position parameter is required");
    }
    if (typeof position !== 'object' || Array.isArray(position)) {
      throw new Error("Position must be an object");
    }
    if (position.id === null || position.id === undefined) {
      throw new Error("Position id is required");
    }
    if (!/^\d+$/.test(String(position.id))) {
      throw new Error("Position id must be numeric");
    }
    if (position.lowerBinId === null || position.lowerBinId === undefined) {
      throw new Error("Position lowerBinId is required");
    }
    if (!Number.isFinite(position.lowerBinId)) {
      throw new Error("Position lowerBinId must be a finite number");
    }
    if (position.upperBinId === null || position.upperBinId === undefined) {
      throw new Error("Position upperBinId is required");
    }
    if (!Number.isFinite(position.upperBinId)) {
      throw new Error("Position upperBinId must be a finite number");
    }
    if (position.lowerBinId >= position.upperBinId) {
      throw new Error("Position lowerBinId must be less than upperBinId");
    }

    // --- Token amount validation ---
    if (token0Amount === null || token0Amount === undefined) {
      throw new Error("Token0 amount is required");
    }
    if (typeof token0Amount !== 'string') {
      throw new Error("Token0 amount must be a string");
    }
    if (!/^\d+$/.test(token0Amount)) {
      throw new Error("Token0 amount must be a positive numeric string");
    }
    if (token1Amount === null || token1Amount === undefined) {
      throw new Error("Token1 amount is required");
    }
    if (typeof token1Amount !== 'string') {
      throw new Error("Token1 amount must be a string");
    }
    if (!/^\d+$/.test(token1Amount)) {
      throw new Error("Token1 amount must be a positive numeric string");
    }
    if (parseInt(token0Amount) === 0 && parseInt(token1Amount) === 0) {
      throw new Error("At least one token amount must be greater than 0");
    }

    if (!provider) {
      throw new Error("Provider is required");
    }

    if (poolData === null || poolData === undefined) {
      throw new Error("Pool data parameter is required");
    }
    if (typeof poolData !== 'object' || Array.isArray(poolData)) {
      throw new Error("Pool data must be an object");
    }
    if (poolData.activeId === null || poolData.activeId === undefined) {
      throw new Error("Pool data activeId is required");
    }
    if (!Number.isFinite(poolData.activeId)) {
      throw new Error("Pool data activeId must be a finite number");
    }
    if (poolData.binStep === null || poolData.binStep === undefined) {
      throw new Error("Pool data binStep is required");
    }
    if (!Number.isFinite(poolData.binStep) || poolData.binStep <= 0) {
      throw new Error("Pool data binStep must be a positive finite number");
    }
    if (!poolData.address) {
      throw new Error("Pool data address is required");
    }

    if (token0Data === null || token0Data === undefined) {
      throw new Error("Token0 data parameter is required");
    }
    if (!token0Data.address) {
      throw new Error("Token0 address is required");
    }
    if (token1Data === null || token1Data === undefined) {
      throw new Error("Token1 data parameter is required");
    }
    if (!token1Data.address) {
      throw new Error("Token1 address is required");
    }
    if (token0Data.address.toLowerCase() === token1Data.address.toLowerCase()) {
      throw new Error("Token0 and token1 addresses cannot be the same");
    }

    if (slippageTolerance === null || slippageTolerance === undefined) {
      throw new Error("Slippage tolerance is required");
    }
    if (!Number.isFinite(slippageTolerance)) {
      throw new Error("Slippage tolerance must be a finite number");
    }
    if (slippageTolerance < 0 || slippageTolerance > 100) {
      throw new Error("Slippage tolerance must be between 0 and 100");
    }

    if (deadlineMinutes === null || deadlineMinutes === undefined) {
      throw new Error("Deadline minutes is required");
    }
    if (!Number.isFinite(deadlineMinutes)) {
      throw new Error("Deadline minutes must be a finite number");
    }
    if (deadlineMinutes <= 0) {
      throw new Error("Deadline minutes must be greater than 0");
    }

    // --- Resolve position manager address ---
    if (!this.addresses?.positionManagerAddress) {
      throw new Error(`No position manager address found for chainId: ${this.chainId}`);
    }
    const positionManagerAddress = this.addresses.positionManagerAddress;

    // --- Sort tokens to TJ canonical order (tokenX = lower address) ---
    const { sortedToken0: tokenX, sortedToken1: tokenY, tokensSwapped } =
      this.sortTokens(token0Data, token1Data);
    const amountX = tokensSwapped ? token1Amount : token0Amount;
    const amountY = tokensSwapped ? token0Amount : token1Amount;

    // --- Apply slippage to amounts ---
    const slipMul = BigInt(Math.floor((100 - slippageTolerance) * 100));
    const amountXMin = (BigInt(amountX) * slipMul / 10000n).toString();
    const amountYMin = (BigInt(amountY) * slipMul / 10000n).toString();

    // --- Compute idSlippage from price slippage ---
    const idSlippage = Bin.getIdSlippageFromPriceSlippage(slippageTolerance / 100, poolData.binStep);

    // --- Generate bin distribution using SDK ---
    const { deltaIds, distributionX, distributionY } =
      getUniformDistributionFromBinRange(poolData.activeId, [position.lowerBinId, position.upperBinId]);

    // --- Compute deadline ---
    const deadline = this._createDeadline(deadlineMinutes);

    // --- Fetch current fees for previousFeesX/previousFeesY ---
    const posData = await this._getPositionOnChainData(position.id, provider);
    const helper = new ethers.Contract(
      this.addresses.liquidityHelperAddress, LiquidityHelperV2ABI, provider
    );
    const feesResult = await helper.getAmountsAndFeesEarnedOf(
      posData.lbPair, posData.proxy, posData.depositIds, posData.previousX, posData.previousY
    );
    const previousFeesX = feesResult.feesX.map(f => f.toString());
    const previousFeesY = feesResult.feesY.map(f => f.toString());

    // --- Encode addToPosition calldata ---
    const iface = new ethers.utils.Interface([
      "function addToPosition(uint256 positionId, uint256[] previousFeesX, uint256[] previousFeesY, uint256 amountX, uint256 amountY, uint256 amountXMin, uint256 amountYMin, uint256 activeIdDesired, uint256 idSlippage, int256[] deltaIds, uint256[] distributionX, uint256[] distributionY, uint256 deadline)"
    ]);

    const calldata = iface.encodeFunctionData("addToPosition", [
      position.id,
      previousFeesX,
      previousFeesY,
      amountX,
      amountY,
      amountXMin,
      amountYMin,
      poolData.activeId,
      idSlippage,
      deltaIds,
      distributionX.map(d => d.toString()),
      distributionY.map(d => d.toString()),
      deadline
    ]);

    return {
      to: positionManagerAddress,
      data: calldata,
      value: '0x00',
      quote: {
        positionId: position.id,
        amountX,
        amountY,
        amountXMin,
        amountYMin,
        previousFeesX,
        previousFeesY,
        deltaIds,
        distributionX: distributionX.map(d => d.toString()),
        distributionY: distributionY.map(d => d.toString()),
        tokensSwapped,
        idSlippage,
        lbPair: poolData.address,
        binStep: poolData.binStep,
        activeId: poolData.activeId
      }
    };
  }

  /**
   * Calculate the optimal token value ratio for a Trader Joe V2.2 bin-based position
   *
   * Uses bin count approach: counts bins above/below the active bin, then reads the
   * active bin's reserves to compute its actual value split. This is more accurate
   * than a test-quote approach for TJ because TJ's test quote only reflects the
   * active bin's composition — for a multi-bin position, a skewed active bin produces
   * wildly wrong ratios.
   *
   * @param {Object} params - See PlatformAdapter.getOptimalTokenRatio for full JSDoc
   * @returns {Promise<{token0Share: number, token1Share: number}>}
   */
  async getOptimalTokenRatio(params) {
    const {
      position,
      poolData,
      token0Data,
      token1Data,
      token0Price,
      token1Price,
      provider
    } = params;

    // --- Validation ---
    if (!position || typeof position !== 'object' || Array.isArray(position)) {
      throw new Error('position is required and must be an object');
    }
    if (position.lowerBinId === null || position.lowerBinId === undefined) {
      throw new Error('position.lowerBinId is required');
    }
    if (!Number.isFinite(position.lowerBinId)) {
      throw new Error('position.lowerBinId must be a finite number');
    }
    if (position.upperBinId === null || position.upperBinId === undefined) {
      throw new Error('position.upperBinId is required');
    }
    if (!Number.isFinite(position.upperBinId)) {
      throw new Error('position.upperBinId must be a finite number');
    }
    if (position.lowerBinId >= position.upperBinId) {
      throw new Error('position.lowerBinId must be less than position.upperBinId');
    }
    if (!poolData || typeof poolData !== 'object') {
      throw new Error('poolData is required and must be an object');
    }
    if (poolData.activeId === null || poolData.activeId === undefined) {
      throw new Error('poolData.activeId is required');
    }
    if (!Number.isFinite(poolData.activeId)) {
      throw new Error('poolData.activeId must be a finite number');
    }
    if (poolData.binStep === null || poolData.binStep === undefined) {
      throw new Error('poolData.binStep is required');
    }
    if (!Number.isFinite(poolData.binStep) || poolData.binStep <= 0) {
      throw new Error('poolData.binStep must be a positive finite number');
    }
    if (!poolData.address) {
      throw new Error('poolData.address is required');
    }
    if (!token0Data || typeof token0Data !== 'object') {
      throw new Error('token0Data is required and must be an object');
    }
    if (!token0Data.address) {
      throw new Error('token0Data.address is required');
    }
    if (token0Data.decimals === null || token0Data.decimals === undefined) {
      throw new Error('token0Data.decimals is required');
    }
    if (!token1Data || typeof token1Data !== 'object') {
      throw new Error('token1Data is required and must be an object');
    }
    if (!token1Data.address) {
      throw new Error('token1Data.address is required');
    }
    if (token1Data.decimals === null || token1Data.decimals === undefined) {
      throw new Error('token1Data.decimals is required');
    }
    if (typeof token0Price !== 'number' || !Number.isFinite(token0Price) || token0Price <= 0) {
      throw new Error('token0Price must be a positive finite number');
    }
    if (typeof token1Price !== 'number' || !Number.isFinite(token1Price) || token1Price <= 0) {
      throw new Error('token1Price must be a positive finite number');
    }
    if (!provider) {
      throw new Error('provider is required');
    }

    const { lowerBinId, upperBinId } = position;
    const { activeId } = poolData;

    // --- Token sorting (TJ canonical: tokenX = lower address) ---
    const { tokensSwapped } = this.sortTokens(token0Data, token1Data);

    // --- Out-of-range: entirely above active (all tokenX) ---
    if (lowerBinId > activeId) {
      return tokensSwapped
        ? { token0Share: 0, token1Share: 1 }
        : { token0Share: 1, token1Share: 0 };
    }

    // --- Out-of-range: entirely below active (all tokenY) ---
    if (upperBinId < activeId) {
      return tokensSwapped
        ? { token0Share: 1, token1Share: 0 }
        : { token0Share: 0, token1Share: 1 };
    }

    // --- In-range: active bin is within position ---
    const binsAbove = upperBinId - activeId;  // X-only bins
    const binsBelow = activeId - lowerBinId;  // Y-only bins
    const totalBins = upperBinId - lowerBinId + 1;

    // Fetch active bin reserves (1 RPC call via existing helper)
    const activeBinData = await this._getActiveBinData(poolData.address, activeId, provider);

    // Resolve token data in canonical order
    const tokenXData = tokensSwapped ? token1Data : token0Data;
    const tokenYData = tokensSwapped ? token0Data : token1Data;
    const tokenXPrice = tokensSwapped ? token1Price : token0Price;
    const tokenYPrice = tokensSwapped ? token0Price : token1Price;

    // Active bin USD value split
    const reserveXFormatted = parseFloat(ethers.utils.formatUnits(activeBinData.reserveX.toString(), tokenXData.decimals));
    const reserveYFormatted = parseFloat(ethers.utils.formatUnits(activeBinData.reserveY.toString(), tokenYData.decimals));
    const xUSD = reserveXFormatted * tokenXPrice;
    const yUSD = reserveYFormatted * tokenYPrice;
    const activeTotalUSD = xUSD + yUSD;

    let activeXShare, activeYShare;
    if (activeTotalUSD === 0) {
      activeXShare = 0.5;
      activeYShare = 0.5;
    } else {
      activeXShare = xUSD / activeTotalUSD;
      activeYShare = yUSD / activeTotalUSD;
    }

    // Weighted bin counts (X = above + active's X portion, Y = below + active's Y portion)
    const xWeight = binsAbove + activeXShare;
    const yWeight = binsBelow + activeYShare;

    // Map back to caller's token order
    const token0Weight = tokensSwapped ? yWeight : xWeight;
    const token1Weight = tokensSwapped ? xWeight : yWeight;

    return {
      token0Share: token0Weight / totalBins,
      token1Share: token1Weight / totalBins
    };
  }

  /**
   * Generate calldata for creating a new liquidity position via TJPositionManager
   *
   * The vault calls mint() on VaultFactory, which validates via TJPositionValidator,
   * then executes the calldata against TJPositionManager.createPosition().
   *
   * @param {Object} params
   * @param {Object} params.position - Position range from getPositionRange()
   * @param {number} params.position.lowerBinId - Lower bin boundary
   * @param {number} params.position.upperBinId - Upper bin boundary
   * @param {string} params.token0Amount - Amount of caller's token0 in wei
   * @param {string} params.token1Amount - Amount of caller's token1 in wei
   * @param {Object} params.provider - Ethers provider instance
   * @param {string} params.walletAddress - Vault address (position recipient)
   * @param {Object} params.poolData - Pool data from getPoolData()
   * @param {Object} params.token0Data - Caller's token0 data ({ address, decimals, symbol })
   * @param {Object} params.token1Data - Caller's token1 data ({ address, decimals, symbol })
   * @param {number} params.slippageTolerance - Slippage tolerance (0-100)
   * @param {number} params.deadlineMinutes - Transaction deadline in minutes from now
   * @returns {Promise<{to: string, data: string, value: string, quote: Object}>}
   */
  async generateCreatePositionData(params) {
    const {
      position,
      token0Amount,
      token1Amount,
      provider,
      walletAddress,
      poolData,
      token0Data,
      token1Data,
      slippageTolerance,
      deadlineMinutes
    } = params;

    // --- Input validation ---
    if (position === null || position === undefined) {
      throw new Error("Position parameter is required");
    }
    if (typeof position !== 'object' || Array.isArray(position)) {
      throw new Error("Position must be an object");
    }
    if (position.lowerBinId === null || position.lowerBinId === undefined) {
      throw new Error("Position lowerBinId is required");
    }
    if (!Number.isFinite(position.lowerBinId)) {
      throw new Error("Position lowerBinId must be a finite number");
    }
    if (position.upperBinId === null || position.upperBinId === undefined) {
      throw new Error("Position upperBinId is required");
    }
    if (!Number.isFinite(position.upperBinId)) {
      throw new Error("Position upperBinId must be a finite number");
    }
    if (position.lowerBinId >= position.upperBinId) {
      throw new Error("Position lowerBinId must be less than upperBinId");
    }

    if (token0Amount === null || token0Amount === undefined) {
      throw new Error("Token0 amount is required");
    }
    if (typeof token0Amount !== 'string') {
      throw new Error("Token0 amount must be a string");
    }
    if (!/^\d+$/.test(token0Amount)) {
      throw new Error("Token0 amount must be a positive numeric string");
    }
    if (token1Amount === null || token1Amount === undefined) {
      throw new Error("Token1 amount is required");
    }
    if (typeof token1Amount !== 'string') {
      throw new Error("Token1 amount must be a string");
    }
    if (!/^\d+$/.test(token1Amount)) {
      throw new Error("Token1 amount must be a positive numeric string");
    }
    if (parseInt(token0Amount) === 0 && parseInt(token1Amount) === 0) {
      throw new Error("At least one token amount must be greater than 0");
    }

    if (!provider) {
      throw new Error("Provider is required");
    }

    if (walletAddress === null || walletAddress === undefined || walletAddress === '') {
      throw new Error("Wallet address is required");
    }
    if (typeof walletAddress !== 'string') {
      throw new Error("Wallet address must be a string");
    }
    try {
      ethers.utils.getAddress(walletAddress);
    } catch (error) {
      throw new Error(`Invalid wallet address: ${walletAddress}`);
    }

    if (poolData === null || poolData === undefined) {
      throw new Error("Pool data parameter is required");
    }
    if (typeof poolData !== 'object' || Array.isArray(poolData)) {
      throw new Error("Pool data must be an object");
    }
    if (poolData.activeId === null || poolData.activeId === undefined) {
      throw new Error("Pool data activeId is required");
    }
    if (!Number.isFinite(poolData.activeId)) {
      throw new Error("Pool data activeId must be a finite number");
    }
    if (poolData.binStep === null || poolData.binStep === undefined) {
      throw new Error("Pool data binStep is required");
    }
    if (!Number.isFinite(poolData.binStep) || poolData.binStep <= 0) {
      throw new Error("Pool data binStep must be a positive finite number");
    }
    if (!poolData.address) {
      throw new Error("Pool data address is required");
    }

    if (token0Data === null || token0Data === undefined) {
      throw new Error("Token0 data parameter is required");
    }
    if (!token0Data.address) {
      throw new Error("Token0 address is required");
    }
    if (token1Data === null || token1Data === undefined) {
      throw new Error("Token1 data parameter is required");
    }
    if (!token1Data.address) {
      throw new Error("Token1 address is required");
    }
    if (token0Data.address.toLowerCase() === token1Data.address.toLowerCase()) {
      throw new Error("Token0 and token1 addresses cannot be the same");
    }

    if (slippageTolerance === null || slippageTolerance === undefined) {
      throw new Error("Slippage tolerance is required");
    }
    if (!Number.isFinite(slippageTolerance)) {
      throw new Error("Slippage tolerance must be a finite number");
    }
    if (slippageTolerance < 0 || slippageTolerance > 100) {
      throw new Error("Slippage tolerance must be between 0 and 100");
    }

    if (deadlineMinutes === null || deadlineMinutes === undefined) {
      throw new Error("Deadline minutes is required");
    }
    if (!Number.isFinite(deadlineMinutes)) {
      throw new Error("Deadline minutes must be a finite number");
    }
    if (deadlineMinutes <= 0) {
      throw new Error("Deadline minutes must be greater than 0");
    }

    // --- Resolve position manager address ---
    if (!this.addresses?.positionManagerAddress) {
      throw new Error(`No position manager address found for chainId: ${this.chainId}`);
    }
    const positionManagerAddress = this.addresses.positionManagerAddress;

    // --- Sort tokens to TJ canonical order (tokenX = lower address) ---
    const { sortedToken0: tokenX, sortedToken1: tokenY, tokensSwapped } =
      this.sortTokens(token0Data, token1Data);
    const amountX = tokensSwapped ? token1Amount : token0Amount;
    const amountY = tokensSwapped ? token0Amount : token1Amount;

    // --- Apply slippage to amounts ---
    const slipMul = BigInt(Math.floor((100 - slippageTolerance) * 100));
    const amountXMin = (BigInt(amountX) * slipMul / 10000n).toString();
    const amountYMin = (BigInt(amountY) * slipMul / 10000n).toString();

    // --- Compute idSlippage from price slippage ---
    const idSlippage = Bin.getIdSlippageFromPriceSlippage(slippageTolerance / 100, poolData.binStep);

    // --- Generate bin distribution using SDK ---
    const { deltaIds, distributionX, distributionY } =
      getUniformDistributionFromBinRange(poolData.activeId, [position.lowerBinId, position.upperBinId]);

    // --- Compute deadline ---
    const deadline = this._createDeadline(deadlineMinutes);

    // --- Encode createPosition calldata ---
    const iface = new ethers.utils.Interface([
      "function createPosition(address vault, address lbPair, uint256 amountX, uint256 amountY, uint256 amountXMin, uint256 amountYMin, uint256 activeIdDesired, uint256 idSlippage, int256[] deltaIds, uint256[] distributionX, uint256[] distributionY, uint256 deadline)"
    ]);

    const calldata = iface.encodeFunctionData("createPosition", [
      walletAddress,
      poolData.address,
      amountX,
      amountY,
      amountXMin,
      amountYMin,
      poolData.activeId,
      idSlippage,
      deltaIds,
      distributionX.map(d => d.toString()),
      distributionY.map(d => d.toString()),
      deadline
    ]);

    return {
      to: positionManagerAddress,
      data: calldata,
      value: '0x00',
      quote: {
        amountX,
        amountY,
        amountXMin,
        amountYMin,
        deltaIds,
        distributionX: distributionX.map(d => d.toString()),
        distributionY: distributionY.map(d => d.toString()),
        tokensSwapped,
        idSlippage,
        lbPair: poolData.address,
        binStep: poolData.binStep,
        activeId: poolData.activeId
      }
    };
  }

  /**
   * Read position data from TJPositionManager contract
   * @private
   * @param {string|number} positionId - Position ID
   * @param {Object} provider - Ethers provider
   * @returns {Promise<Object>} Position on-chain data with string arrays
   */
  async _getPositionOnChainData(positionId, provider) {
    const pm = new ethers.Contract(
      this.addresses.positionManagerAddress, contractData.TJPositionManager.abi, provider
    );
    const pos = await pm.getPosition(positionId);
    return {
      lbPair: pos.lbPair,
      proxy: pos.proxy,
      tokenX: pos.tokenX,
      tokenY: pos.tokenY,
      depositIds: pos.depositIds.map(id => id.toString()),
      liquidityMinted: pos.liquidityMinted.map(lm => lm.toString()),
      previousX: pos.previousX.map(x => x.toString()),
      previousY: pos.previousY.map(y => y.toString()),
      active: pos.active,
      binStep: Number(pos.binStep),
    };
  }

  /**
   * Compute feeShares and earned fees via LiquidityHelperV2 contract
   * Two-step: getLiquiditiesForAmounts -> getFeeSharesAndFeesEarnedOf
   * @private
   * @param {Object} posData - Position on-chain data from _getPositionOnChainData
   * @param {Object} provider - Ethers provider
   * @returns {Promise<{feeShares: string[], feesX: string[], feesY: string[]}>}
   */
  async _computeFeeShares(posData, provider) {
    const helper = new ethers.Contract(
      this.addresses.liquidityHelperAddress, LiquidityHelperV2ABI, provider
    );

    const liquidities = await helper.getLiquiditiesForAmounts(
      posData.lbPair, posData.depositIds, posData.previousX, posData.previousY
    );

    const result = await helper.getFeeSharesAndFeesEarnedOf(
      posData.lbPair, posData.proxy, posData.depositIds, liquidities
    );

    return {
      feeShares: result.feeShares.map(fs => fs.toString()),
      feesX: result.feesX.map(f => f.toString()),
      feesY: result.feesY.map(f => f.toString()),
    };
  }

  /**
   * Fetch active bin reserves and total supply from LBPair contract
   * @private
   * @param {string} poolAddress - LBPair contract address
   * @param {number} activeId - Active bin ID
   * @param {Object} provider - Ethers provider
   * @returns {Promise<{reserveX: bigint, reserveY: bigint, totalSupply: bigint}>}
   */
  async _getActiveBinData(poolAddress, activeId, provider) {
    const lbPair = new ethers.Contract(poolAddress, this.lbPairABI, provider);
    const [binData, totalSupply] = await Promise.all([
      lbPair.getBin(activeId),
      lbPair.totalSupply(activeId)
    ]);
    return {
      reserveX: binData[0].toBigInt(),
      reserveY: binData[1].toBigInt(),
      totalSupply: totalSupply.toBigInt()
    };
  }

  /**
   * Create a deadline timestamp from minutes
   * @param {number} deadlineMinutes - Minutes from now
   * @returns {number} Unix timestamp
   */
  _createDeadline(deadlineMinutes) {
    if (!Number.isFinite(deadlineMinutes) || deadlineMinutes < 0) {
      throw new Error(`Invalid deadline minutes: ${deadlineMinutes}. Must be a non-negative number.`);
    }
    return Math.floor(Date.now() / 1000) + (deadlineMinutes * 60);
  }

  /**
   * Get the Swap event signature for Trader Joe V2.2 LBPair
   * @returns {string} Solidity event signature
   */
  _getSwapEventSignature() {
    return 'Swap(address,address,uint24,bytes32,bytes32,uint24,bytes32,bytes32)';
  }

  /**
   * Get the swap event topic hash for a given TJ version.
   *
   * V2.1 and V2.2 LBPairs share the same Swap event signature (packed bytes32).
   * Only V2.0 uses the legacy signature with bool/uint256.
   *
   * @param {number} version - ILBRouter.Version enum: 0=V1, 1=V2, 2=V2_1, 3=V2_2
   * @returns {string} keccak256 topic hash
   */
  _getSwapTopicForVersion(version) {
    switch (version) {
      case 0: // V1 (JoePair / UniswapV2-style)
        return ethers.utils.id('Swap(address,uint256,uint256,uint256,uint256,address)');
      case 1: // V2.0 (Legacy LBPair — bool swapForY + uint256 amounts)
        return ethers.utils.id('Swap(address,address,uint256,bool,uint256,uint256,uint256,uint256)');
      case 2: // V2.1 (shares V2.2 packed bytes32 event signature)
      case 3: // V2.2 (Current LBPair)
        return ethers.utils.id(this._getSwapEventSignature());
      default:
        throw new Error(`Unknown TJ version: ${version}`);
    }
  }

  /**
   * Parse a V1 JoePair (UniswapV2-style) Swap event log.
   * Topics: [hash, sender(indexed), to(indexed)]
   * Data: [amount0In, amount1In, amount0Out, amount1Out]
   * @param {Object} log - Raw event log
   * @returns {{ amount0In: string, amount1In: string, amount0Out: string, amount1Out: string }}
   */
  _parseV1SwapEvent(log) {
    const decoded = ethers.utils.defaultAbiCoder.decode(
      ['uint256', 'uint256', 'uint256', 'uint256'],
      log.data
    );
    return {
      amount0In: decoded[0].toString(),
      amount1In: decoded[1].toString(),
      amount0Out: decoded[2].toString(),
      amount1Out: decoded[3].toString(),
    };
  }

  /**
   * Parse a V2/V2.1 Legacy LBPair Swap event log.
   * Topics: [hash, sender(indexed), recipient(indexed), id(indexed)]
   * Data: [swapForY, amountIn, amountOut, volatilityAccumulated, fees]
   * @param {Object} log - Raw event log
   * @returns {{ swapForY: boolean, amountIn: string, amountOut: string }}
   */
  _parseV2LegacySwapEvent(log) {
    const decoded = ethers.utils.defaultAbiCoder.decode(
      ['bool', 'uint256', 'uint256', 'uint256', 'uint256'],
      log.data
    );
    return {
      swapForY: decoded[0],
      amountIn: decoded[1].toString(),
      amountOut: decoded[2].toString(),
    };
  }

  /**
   * Convert a bin ID to a human-readable price
   *
   * Trader Joe V2.2 Liquidity Book price formula:
   *   price(id) = (1 + binStep/10000)^(id - 8388608) * 10^(token0Decimals - token1Decimals)
   *
   * The reference bin (8388608 = 2^23) represents a raw price ratio of 1.0.
   * The decimal adjustment converts from raw token units to human-readable price.
   *
   * @param {number} binId - Bin ID to convert
   * @param {number} binStep - Bin step in basis points (e.g., 20 = 0.20%)
   * @param {number} token0Decimals - Decimals of token0 (tokenX, lower address)
   * @param {number} token1Decimals - Decimals of token1 (tokenY, higher address)
   * @returns {number} Human-readable price (token1 per token0)
   */
  _binIdToPrice(binId, binStep, token0Decimals, token1Decimals) {
    const REFERENCE_BIN = 8388608; // 2^23
    const base = 1 + binStep / 10000;
    const rawPrice = Math.pow(base, binId - REFERENCE_BIN);
    const decimalAdjustment = Math.pow(10, token0Decimals - token1Decimals);
    return rawPrice * decimalAdjustment;
  }

  /**
   * Decode a packed bytes32 value into tokenX and tokenY amounts
   *
   * Trader Joe V2.2 packs two 128-bit amounts into a single bytes32:
   *   - Upper 128 bits = tokenX amount
   *   - Lower 128 bits = tokenY amount
   *
   * @param {string} packedBytes32 - The packed bytes32 value
   * @returns {{ amountX: string, amountY: string }} Decoded amounts as strings
   */
  _decodePackedAmounts(packedBytes32) {
    const bn = ethers.BigNumber.from(packedBytes32);
    const mask128 = ethers.BigNumber.from('0x' + 'f'.repeat(32));
    const amountX = bn.and(mask128);
    const amountY = bn.shr(128);
    return { amountX: amountX.toString(), amountY: amountY.toString() };
  }

  async batchSwapTransactions(swapInstructions, options) {
    const { provider, chainId, recipient, slippageTolerance } = options;

    // Validate options (no signer — TJ V2.2 doesn't use Permit2)
    if (!provider) throw new Error("provider is required");
    if (!chainId) throw new Error("chainId is required");
    if (!recipient) throw new Error("recipient is required");
    if (slippageTolerance === undefined || slippageTolerance === null) {
      throw new Error("slippageTolerance is required");
    }

    if (!Array.isArray(swapInstructions)) throw new Error("swapInstructions must be an array");
    if (swapInstructions.length === 0) throw new Error("swapInstructions cannot be empty");

    const transactions = [];
    const metadata = [];

    for (const instruction of swapInstructions) {
      if (!instruction.tokenIn || !instruction.tokenIn.symbol) throw new Error("tokenIn with symbol is required");
      if (!instruction.tokenOut || !instruction.tokenOut.symbol) throw new Error("tokenOut with symbol is required");
      if (!instruction.amount) throw new Error("amount is required");

      const result = await this._generateSwapTransaction({
        tokenIn: instruction.tokenIn,
        tokenOut: instruction.tokenOut,
        amount: instruction.amount,
        isAmountIn: instruction.isAmountIn !== undefined ? instruction.isAmountIn : true,
        provider, chainId, recipient, slippageTolerance,
      });

      transactions.push(result.transaction);
      metadata.push({
        tokenInSymbol: instruction.tokenIn.symbol,
        tokenOutSymbol: instruction.tokenOut.symbol,
        tokenInAddress: result.tokenInAddress,
        tokenOutAddress: result.tokenOutAddress,
        quotedAmountIn: result.quotedAmountIn,
        quotedAmountOut: result.quotedAmountOut,
        isAmountIn: result.isAmountIn,
        routes: result.routes,
      });
    }

    return { transactions, metadata };
  }

  /**
   * Generate a single swap transaction using LBQuoter for routing and LBRouter for calldata.
   * @private
   */
  async _generateSwapTransaction(params) {
    const { tokenIn, tokenOut, amount, isAmountIn, provider, chainId, recipient, slippageTolerance } = params;

    const tokenInIsNative = !!tokenIn.isNative;
    const tokenOutIsNative = !!tokenOut.isNative;

    // Resolve addresses: native → wrapped native token for route/quote
    const wrappedNativeAddress = getWrappedNativeAddress(chainId);
    const tokenInAddress = tokenInIsNative ? wrappedNativeAddress : tokenIn.address;
    const tokenOutAddress = tokenOutIsNative ? wrappedNativeAddress : tokenOut.address;

    // 1. Get quote from LBQuoter
    const quoter = new ethers.Contract(this.addresses.lbQuoterAddress, this.lbQuoterABI, provider);
    const route = [tokenInAddress, tokenOutAddress];

    let quote;
    try {
      quote = isAmountIn
        ? await quoter.findBestPathFromAmountIn(route, amount)
        : await quoter.findBestPathFromAmountOut(route, amount);
    } catch (error) {
      throw new Error(`Failed to get swap quote for ${tokenIn.symbol} -> ${tokenOut.symbol}: ${error.message}`);
    }

    // 2. Extract amounts
    const quotedAmounts = quote.amounts;
    const quotedAmountIn = quotedAmounts[0].toString();
    const quotedAmountOut = quotedAmounts[quotedAmounts.length - 1].toString();

    if (quotedAmountOut === '0') {
      throw new Error(`No valid route found for ${tokenIn.symbol} -> ${tokenOut.symbol}`);
    }

    // 3. Build Path struct from quote results
    const path = {
      pairBinSteps: quote.binSteps.map(bs => bs.toString()),
      versions: quote.versions.map(v => Number(v)),
      tokenPath: quote.route,
    };

    // 4. Apply slippage and encode router calldata
    const slippageBps = BigInt(Math.round(slippageTolerance * 100));
    const deadline = this._createDeadline(30);
    const routerInterface = new ethers.utils.Interface(this.lbRouterABI);

    let data, value;

    if (isAmountIn) {
      const amountOutMin = (BigInt(quotedAmountOut) * (10000n - slippageBps) / 10000n).toString();

      if (tokenInIsNative) {
        data = routerInterface.encodeFunctionData('swapExactNATIVEForTokens', [amountOutMin, path, recipient, deadline]);
        value = ethers.BigNumber.from(quotedAmountIn).toHexString();
      } else if (tokenOutIsNative) {
        data = routerInterface.encodeFunctionData('swapExactTokensForNATIVE', [quotedAmountIn, amountOutMin, path, recipient, deadline]);
        value = '0x00';
      } else {
        data = routerInterface.encodeFunctionData('swapExactTokensForTokens', [quotedAmountIn, amountOutMin, path, recipient, deadline]);
        value = '0x00';
      }
    } else {
      const amountInMax = (BigInt(quotedAmountIn) * (10000n + slippageBps) / 10000n).toString();

      if (tokenInIsNative) {
        data = routerInterface.encodeFunctionData('swapNATIVEForExactTokens', [amount, path, recipient, deadline]);
        value = ethers.BigNumber.from(amountInMax).toHexString();
      } else if (tokenOutIsNative) {
        data = routerInterface.encodeFunctionData('swapTokensForExactNATIVE', [amount, amountInMax, path, recipient, deadline]);
        value = '0x00';
      } else {
        data = routerInterface.encodeFunctionData('swapTokensForExactTokens', [amount, amountInMax, path, recipient, deadline]);
        value = '0x00';
      }
    }

    // Build routes for parseSwapReceipt (always include for version info)
    const tokenPath = quote.route.map(addr => addr.toLowerCase());
    const poolCount = quote.binSteps.length;
    const versions = quote.versions.map(v => Number(v));
    const routes = [{ tokenPath, poolCount, versions }];

    return {
      transaction: { to: this.addresses.lbRouterAddress, data, value },
      tokenInAddress,    // WETH address if native (for parseSwapReceipt compatibility)
      tokenOutAddress,   // WETH address if native
      quotedAmountIn,
      quotedAmountOut,
      isAmountIn,
      routes,
    };
  }

  async parseClosureReceipt(receipt, positionMetadata, options = {}) {
    if (receipt === null || receipt === undefined) throw new Error("Receipt parameter is required");
    if (!receipt.logs) throw new Error("Receipt must have logs property");
    if (!positionMetadata || typeof positionMetadata !== 'object' || Array.isArray(positionMetadata))
      throw new Error("Position metadata parameter is required");

    const principalByPosition = {};
    const feesByPosition = {};

    const feesIface = new ethers.utils.Interface([
      'event FeesCollected(uint256 indexed positionId, address indexed vault, address indexed lbPair, uint256 amountX, uint256 amountY)'
    ]);
    const removedIface = new ethers.utils.Interface([
      'event PositionRemoved(uint256 indexed positionId, address indexed vault, address indexed lbPair, uint256 percentage, uint256 amountX, uint256 amountY)'
    ]);
    const feesTopic = feesIface.getEventTopic('FeesCollected');
    const removedTopic = removedIface.getEventTopic('PositionRemoved');

    for (const log of receipt.logs) {
      try {
        if (log.topics && log.topics[0] === removedTopic) {
          const decoded = removedIface.parseLog(log);
          const positionId = decoded.args.positionId.toString();
          if (positionMetadata[positionId]) {
            principalByPosition[positionId] = {
              amount0: decoded.args.amountX,
              amount1: decoded.args.amountY,
            };
          }
        } else if (log.topics && log.topics[0] === feesTopic) {
          const decoded = feesIface.parseLog(log);
          const positionId = decoded.args.positionId.toString();
          if (positionMetadata[positionId]) {
            feesByPosition[positionId] = {
              token0: decoded.args.amountX,
              token1: decoded.args.amountY,
              metadata: positionMetadata[positionId],
            };
          }
        }
      } catch (e) {
        // Not a matching event, continue
      }
    }

    // Fill zero fees for positions with no FeesCollected event
    for (const positionId of Object.keys(positionMetadata)) {
      if (!feesByPosition[positionId] && principalByPosition[positionId]) {
        feesByPosition[positionId] = {
          token0: ethers.BigNumber.from(0),
          token1: ethers.BigNumber.from(0),
          metadata: positionMetadata[positionId],
        };
      }
    }

    return { principalByPosition, feesByPosition };
  }

  async parseCollectReceipt(receipt, positionMetadata, options = {}) {
    if (receipt === null || receipt === undefined) throw new Error("Receipt parameter is required");
    if (!receipt.logs) throw new Error("Receipt must have logs property");
    if (!positionMetadata || typeof positionMetadata !== 'object' || Array.isArray(positionMetadata))
      throw new Error("Position metadata parameter is required");

    const feesByPosition = {};

    const feesIface = new ethers.utils.Interface([
      'event FeesCollected(uint256 indexed positionId, address indexed vault, address indexed lbPair, uint256 amountX, uint256 amountY)'
    ]);
    const feesTopic = feesIface.getEventTopic('FeesCollected');

    for (const log of receipt.logs) {
      try {
        if (log.topics && log.topics[0] === feesTopic) {
          const decoded = feesIface.parseLog(log);
          const positionId = decoded.args.positionId.toString();
          if (positionMetadata[positionId]) {
            feesByPosition[positionId] = {
              token0: decoded.args.amountX,
              token1: decoded.args.amountY,
              metadata: positionMetadata[positionId],
            };
          }
        }
      } catch (e) {
        // Not a matching event, continue
      }
    }

    return { feesByPosition };
  }

  parseSwapReceipt(receipt, swapMetadata) {
    // Validate receipt
    if (receipt === null || receipt === undefined) {
      throw new Error("Receipt parameter is required");
    }
    if (!receipt.logs) {
      throw new Error("Receipt must have logs property");
    }

    // Validate swapMetadata
    if (swapMetadata === null || swapMetadata === undefined) {
      throw new Error("Swap metadata parameter is required");
    }
    if (!Array.isArray(swapMetadata)) {
      throw new Error("Swap metadata must be an array");
    }

    if (swapMetadata.length === 0) {
      return [];
    }

    // Compute topic hashes for all known TJ swap versions
    const topicV1 = this._getSwapTopicForVersion(0);
    const topicV2Legacy = this._getSwapTopicForVersion(1); // V2.0 only
    const topicV22 = this._getSwapTopicForVersion(3);      // V2.1 and V2.2 share this

    // Step 1: Scan all receipt logs, collecting swap events from ALL versions
    // Version tags: 0=V1, 1=V2.0 legacy, 3=V2.1/V2.2 (same format)
    const allSwapEvents = [];
    for (const log of receipt.logs) {
      if (!log.topics || !log.topics[0]) continue;
      const topic0 = log.topics[0];
      try {
        if (topic0 === topicV22) {
          allSwapEvents.push({ version: 3, parsed: this.parseSwapEvent(log), logIndex: log.logIndex, address: log.address.toLowerCase() });
        } else if (topic0 === topicV2Legacy) {
          allSwapEvents.push({ version: 1, parsed: this._parseV2LegacySwapEvent(log), logIndex: log.logIndex, address: log.address.toLowerCase() });
        } else if (topic0 === topicV1) {
          allSwapEvents.push({ version: 0, parsed: this._parseV1SwapEvent(log), logIndex: log.logIndex, address: log.address.toLowerCase() });
        }
      } catch (e) {
        // Not a valid swap event, skip
      }
    }

    // Sort by logIndex to maintain emission order
    allSwapEvents.sort((a, b) => (a.logIndex ?? 0) - (b.logIndex ?? 0));

    // Step 2: Match events to metadata sequentially
    // Each hop may produce multiple Swap events (multi-bin crossing in LB pools).
    // We group contiguous events from the same pool address as belonging to one hop.
    // For amountIn: use the first event of the hop's group.
    // For amountOut: use the last event of the hop's group.
    let eventIndex = 0;
    const actualSwaps = [];

    for (const metadata of swapMetadata) {
      if (!metadata.tokenInAddress) {
        throw new Error("Swap metadata must have tokenInAddress");
      }
      if (!metadata.tokenOutAddress) {
        throw new Error("Swap metadata must have tokenOutAddress");
      }
      if (!metadata.routes || metadata.routes.length === 0) {
        throw new Error("Swap metadata must have routes");
      }

      let totalAmountIn = BigInt(0);
      let totalAmountOut = BigInt(0);

      for (const { tokenPath, poolCount } of metadata.routes) {
        for (let hopIdx = 0; hopIdx < poolCount; hopIdx++) {
          if (eventIndex >= allSwapEvents.length) break;

          // Consume all contiguous events from the same pool address (multi-bin crossing)
          const hopPoolAddress = allSwapEvents[eventIndex].address;
          const firstEvent = allSwapEvents[eventIndex];
          let lastEvent = firstEvent;
          eventIndex++;

          while (eventIndex < allSwapEvents.length && allSwapEvents[eventIndex].address === hopPoolAddress) {
            lastEvent = allSwapEvents[eventIndex];
            eventIndex++;
          }

          const hopTokenIn = tokenPath[hopIdx].toLowerCase();
          const hopTokenOut = tokenPath[hopIdx + 1].toLowerCase();

          if (hopIdx === 0) {
            totalAmountIn += this._extractAmountIn(firstEvent.version, firstEvent.parsed, hopTokenIn, hopTokenOut);
          }

          if (hopIdx === poolCount - 1) {
            totalAmountOut += this._extractAmountOut(lastEvent.version, lastEvent.parsed, hopTokenIn, hopTokenOut);
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
   * Extract amountIn from a parsed swap event based on TJ version and token ordering.
   * @param {number} version - TJ version (0=V1, 1/2=V2/V2.1, 3=V2.2)
   * @param {Object} parsed - Parsed event data
   * @param {string} hopTokenIn - Lowercase address of hop input token
   * @param {string} hopTokenOut - Lowercase address of hop output token
   * @returns {bigint} Amount in
   */
  _extractAmountIn(version, parsed, hopTokenIn, hopTokenOut) {
    if (version === 0) {
      // V1: token0 = lower address (enforced by UniswapV2 factory)
      return BigInt(hopTokenIn < hopTokenOut ? parsed.amount0In : parsed.amount1In);
    } else if (version === 1) {
      // V2.0 Legacy: amountIn is given directly
      return BigInt(parsed.amountIn);
    } else {
      // V2.1/V2.2: packed bytes32. Sum both components — only the input side is non-zero.
      // Can't assume tokenX = lower address; V2.1/V2.2 factories don't enforce ordering.
      return BigInt(parsed.amountsIn.amountX) + BigInt(parsed.amountsIn.amountY);
    }
  }

  /**
   * Extract amountOut from a parsed swap event based on TJ version and token ordering.
   * @param {number} version - TJ version (0=V1, 1/2=V2/V2.1, 3=V2.2)
   * @param {Object} parsed - Parsed event data
   * @param {string} hopTokenIn - Lowercase address of hop input token
   * @param {string} hopTokenOut - Lowercase address of hop output token
   * @returns {bigint} Amount out
   */
  _extractAmountOut(version, parsed, hopTokenIn, hopTokenOut) {
    if (version === 0) {
      // V1: token0 = lower address (enforced by UniswapV2 factory)
      return BigInt(hopTokenOut < hopTokenIn ? parsed.amount0Out : parsed.amount1Out);
    } else if (version === 1) {
      // V2.0 Legacy: amountOut is given directly
      return BigInt(parsed.amountOut);
    } else {
      // V2.1/V2.2: packed bytes32. Sum both components — only the output side is non-zero.
      // Can't assume tokenX = lower address; V2.1/V2.2 factories don't enforce ordering.
      return BigInt(parsed.amountsOut.amountX) + BigInt(parsed.amountsOut.amountY);
    }
  }

  parseIncreaseLiquidityReceipt(receipt, { position, poolData } = {}) {
    if (receipt === null || receipt === undefined) {
      throw new Error("Receipt parameter is required");
    }
    if (!receipt.logs) {
      throw new Error("Receipt must have logs property");
    }

    const positionCreatedIface = new ethers.utils.Interface([
      'event PositionCreated(uint256 indexed positionId, address indexed vault, address indexed lbPair, address proxy, uint256[] depositIds, uint256[] liquidityMinted, uint256 amountXAdded, uint256 amountYAdded)'
    ]);
    const positionCreatedTopic = positionCreatedIface.getEventTopic('PositionCreated');

    const positionIncreasedIface = new ethers.utils.Interface([
      'event PositionIncreased(uint256 indexed positionId, address indexed vault, address indexed lbPair, uint256 amountXAdded, uint256 amountYAdded)'
    ]);
    const positionIncreasedTopic = positionIncreasedIface.getEventTopic('PositionIncreased');

    let createdEvent = null;
    let increasedEvent = null;

    for (const log of receipt.logs) {
      try {
        if (log.topics && log.topics[0] === positionCreatedTopic) {
          createdEvent = positionCreatedIface.parseLog(log);
        } else if (log.topics && log.topics[0] === positionIncreasedTopic) {
          increasedEvent = positionIncreasedIface.parseLog(log);
        }
      } catch (e) {
        // Not a matching event, continue
      }
    }

    if (createdEvent) {
      const depositIds = createdEvent.args.depositIds.map(id => Number(id));
      const totalLiquidity = createdEvent.args.liquidityMinted.reduce(
        (sum, val) => (BigInt(sum) + BigInt(val.toString())).toString(), '0'
      );

      return {
        tokenId: createdEvent.args.positionId.toString(),
        liquidity: totalLiquidity,
        amount0: createdEvent.args.amountXAdded.toString(),
        amount1: createdEvent.args.amountYAdded.toString(),
        tickLower: Math.min(...depositIds),
        tickUpper: Math.max(...depositIds),
        poolAddress: createdEvent.args.lbPair,
      };
    }

    if (increasedEvent) {
      return {
        tokenId: increasedEvent.args.positionId.toString(),
        liquidity: null,
        amount0: increasedEvent.args.amountXAdded.toString(),
        amount1: increasedEvent.args.amountYAdded.toString(),
        tickLower: null,
        tickUpper: null,
        poolAddress: null,
      };
    }

    throw new Error('PositionCreated or PositionIncreased event not found in receipt');
  }

  async getBestSwapQuote(params) {
    const { tokenInAddress, tokenOutAddress, amount, isAmountIn, tokenInIsNative = false, tokenOutIsNative = false, provider } = params;

    // Validate provider (TJ requires it — no cached router like V3/V4's AlphaRouter)
    if (!provider) {
      throw new Error("provider is required");
    }

    // Validate addresses — skip for native ETH
    if (!tokenInIsNative) {
      if (!tokenInAddress || typeof tokenInAddress !== 'string') {
        throw new Error("TokenIn address parameter is required");
      }
      try {
        ethers.utils.getAddress(tokenInAddress);
      } catch (error) {
        throw new Error(`Invalid tokenIn address: ${tokenInAddress}`);
      }
    }

    if (!tokenOutIsNative) {
      if (!tokenOutAddress || typeof tokenOutAddress !== 'string') {
        throw new Error("TokenOut address parameter is required");
      }
      try {
        ethers.utils.getAddress(tokenOutAddress);
      } catch (error) {
        throw new Error(`Invalid tokenOut address: ${tokenOutAddress}`);
      }
    }

    if (!amount) {
      throw new Error("Amount parameter is required");
    }
    if (typeof amount !== 'string') {
      throw new Error("Amount must be a string");
    }
    if (!/^\d+$/.test(amount)) {
      throw new Error("Amount must be a positive numeric string");
    }
    if (amount === '0') {
      throw new Error("Amount cannot be zero");
    }

    if (typeof isAmountIn !== 'boolean') {
      throw new Error("isAmountIn parameter is required and must be a boolean");
    }

    // Resolve native → wrapped native token for quoter route
    const wrappedNativeAddress = getWrappedNativeAddress(this.chainId);
    const resolvedTokenIn = tokenInIsNative ? wrappedNativeAddress : tokenInAddress;
    const resolvedTokenOut = tokenOutIsNative ? wrappedNativeAddress : tokenOutAddress;

    // Call LBQuoter — handles pool discovery across all bin steps internally
    const quoter = new ethers.Contract(this.addresses.lbQuoterAddress, this.lbQuoterABI, provider);
    const route = [resolvedTokenIn, resolvedTokenOut];

    let quote;
    try {
      quote = isAmountIn
        ? await quoter.findBestPathFromAmountIn(route, amount)
        : await quoter.findBestPathFromAmountOut(route, amount);
    } catch (error) {
      throw new Error(`Failed to get swap quote: ${error.message}`);
    }

    const quotedAmounts = quote.amounts;
    const quotedAmountIn = quotedAmounts[0].toString();
    const quotedAmountOut = quotedAmounts[quotedAmounts.length - 1].toString();

    if (quotedAmountOut === '0') {
      throw new Error(`No route found for token pair ${resolvedTokenIn}/${resolvedTokenOut}`);
    }

    if (isAmountIn) {
      return {
        amountIn: amount,
        amountOut: quotedAmountOut,
        route: quote,
      };
    } else {
      return {
        amountIn: quotedAmountIn,
        amountOut: amount,
        route: quote,
      };
    }
  }

  /**
   * Get required ERC20 approval transactions for a vault operation
   *
   * For liquidity operations, the vault must approve TJPositionManager (not LBRouter)
   * because TJPositionManager calls transferFrom to pull tokens from the vault.
   *
   * @param {string} operationType - 'liquidity' or 'swap'
   * @param {string} vaultAddress - Vault contract address
   * @param {string[]} tokenAddresses - Array of token addresses to check
   * @param {Object} provider - Ethers provider instance
   * @returns {Promise<Array<{to: string, data: string, value: string}>>} Approval transactions
   */
  async getRequiredApprovals(operationType, vaultAddress, tokenAddresses, provider) {
    if (!operationType || !['swap', 'liquidity'].includes(operationType)) {
      throw new Error('getRequiredApprovals: operationType must be "swap" or "liquidity"');
    }
    if (!vaultAddress || !ethers.utils.isAddress(vaultAddress)) {
      throw new Error('getRequiredApprovals: invalid vaultAddress');
    }
    if (!Array.isArray(tokenAddresses) || tokenAddresses.length === 0) {
      throw new Error('getRequiredApprovals: tokenAddresses must be a non-empty array');
    }
    if (!provider) {
      throw new Error('getRequiredApprovals: provider is required');
    }

    const transactions = [];

    // For liquidity operations, spender is TJPositionManager (it pulls tokens via transferFrom)
    const spender = operationType === 'liquidity'
      ? this.addresses.positionManagerAddress
      : this.addresses.lbRouterAddress; // Swap uses router directly

    if (!spender) {
      throw new Error(`getRequiredApprovals: no spender address found for operationType "${operationType}"`);
    }

    for (const tokenAddress of tokenAddresses) {
      if (tokenAddress === ethers.constants.AddressZero) {
        continue;
      }
      if (!ethers.utils.isAddress(tokenAddress)) {
        throw new Error(`getRequiredApprovals: invalid token address ${tokenAddress}`);
      }

      const needsApproval = await this._checkNeedsERC20Approval(vaultAddress, tokenAddress, spender, provider);
      if (needsApproval) {
        transactions.push(this._encodeERC20Approve(tokenAddress, spender));
      }
    }

    return transactions;
  }

  /**
   * Check if a vault needs ERC20 approval for a spender
   * @param {string} vaultAddress - Vault address (token owner)
   * @param {string} tokenAddress - ERC20 token address
   * @param {string} spender - Spender address to check allowance for
   * @param {Object} provider - Ethers provider
   * @returns {Promise<boolean>} True if approval is needed
   */
  async _checkNeedsERC20Approval(vaultAddress, tokenAddress, spender, provider) {
    const token = new ethers.Contract(tokenAddress, this.erc20ABI, provider);
    const allowance = await token.allowance(vaultAddress, spender);
    return allowance.lt(ethers.constants.MaxUint256.div(2));
  }

  /**
   * Encode an ERC20 approve transaction
   * @param {string} tokenAddress - Token to approve
   * @param {string} spender - Address to approve as spender
   * @returns {{to: string, data: string, value: string}} Transaction object
   */
  _encodeERC20Approve(tokenAddress, spender) {
    const data = this.erc20Interface.encodeFunctionData('approve', [
      spender,
      ethers.constants.MaxUint256
    ]);
    return {
      to: tokenAddress,
      data: data,
      value: '0'
    };
  }

  /**
   * Select the best LBPair for a token pair based on liquidity
   *
   * Queries the LBFactory contract directly to discover all LBPairs for the token pair,
   * then selects the one with highest total reserves.
   *
   * @param {string} tokenASymbol - First token symbol (e.g., 'ETH', 'WETH', 'USDC')
   * @param {string} tokenBSymbol - Second token symbol
   * @param {Object} provider - Ethers provider instance
   * @param {number} chainId - Chain ID (42161, 1337, etc.)
   * @returns {Promise<{bestPool: Object, poolsDiscovered: number, poolsActive: number}>}
   */
  async selectBestPool(tokenASymbol, tokenBSymbol, provider, chainId) {
    // Validate tokenASymbol
    if (!tokenASymbol || typeof tokenASymbol !== 'string') {
      throw new Error("tokenASymbol parameter is required and must be a string");
    }

    // Validate tokenBSymbol
    if (!tokenBSymbol || typeof tokenBSymbol !== 'string') {
      throw new Error("tokenBSymbol parameter is required and must be a string");
    }

    // Validate provider
    if (!provider || typeof provider.getNetwork !== 'function') {
      throw new Error("provider parameter is required and must be an ethers provider instance");
    }

    // Validate chainId
    if (chainId === null || chainId === undefined || typeof chainId !== 'number') {
      throw new Error("chainId parameter is required and must be a number");
    }

    // Resolve token addresses
    // Trader Joe V2.2 uses wrapped native tokens (WAVAX/WETH), so convert native to wrapped
    const resolveTokenData = (symbol) => {
      if (isNativeToken(symbol)) {
        // Convert native token to wrapped native for Trader Joe V2.2
        const wrappedAddress = getWrappedNativeAddress(chainId);
        const wrappedSymbol = getWrappedNativeSymbol(chainId);
        return {
          address: wrappedAddress,
          symbol: wrappedSymbol,
          decimals: 18,
          isNative: false
        };
      }
      // Handle wrapped native tokens specially - they're not in the base tokens config
      // but are derived from native token's wrappedAddresses
      if (isWrappedNativeToken(symbol)) {
        const wrappedAddress = getWrappedNativeAddress(chainId);
        const wrappedSymbol = getWrappedNativeSymbol(chainId);
        return {
          address: wrappedAddress,
          symbol: wrappedSymbol,
          decimals: 18,
          isNative: false
        };
      }
      const token = getTokenBySymbol(symbol);
      if (!token) {
        throw new Error(`Token ${symbol} not found`);
      }
      const address = token.addresses[chainId];
      if (!address) {
        throw new Error(`Token ${symbol} not available on chain ${chainId}`);
      }
      return {
        address,
        symbol,
        decimals: token.decimals,
        isNative: false
      };
    };

    const tokenAData = resolveTokenData(tokenASymbol);
    const tokenBData = resolveTokenData(tokenBSymbol);

    // Sort tokens (tokenX < tokenY by address)
    const { sortedToken0: tokenX, sortedToken1: tokenY } = this.sortTokens(tokenAData, tokenBData);

    // Get factory address for this chain from our config (supports local fork chainId 1337)
    const factoryAddress = this.addresses.lbFactoryAddress;
    if (!factoryAddress || factoryAddress === ethers.constants.AddressZero) {
      throw new Error(`Trader Joe V2.2 not available on chain ${chainId}`);
    }

    // Create factory contract instance
    const factoryContract = new ethers.Contract(
      factoryAddress,
      this.lbFactoryABI,
      provider
    );

    // Query factory for all LBPairs with this token pair
    // getAllLBPairs returns array of LBPairInformation structs
    const allPairs = await factoryContract.getAllLBPairs(tokenX.address, tokenY.address);

    if (allPairs.length === 0) {
      throw new Error(`No pools found for ${tokenASymbol}/${tokenBSymbol} on ${this.platformName}`);
    }

    // Fetch reserves for each pair in parallel
    const pairDataPromises = allPairs.map(async (pairInfo) => {
      // pairInfo is a struct: { binStep, LBPair, createdByOwner, ignoredForRouting }
      const pairAddress = pairInfo.LBPair;
      const binStep = Number(pairInfo.binStep);

      // Skip if pair address is zero (shouldn't happen, but be safe)
      if (pairAddress === ethers.constants.AddressZero) {
        return null;
      }

      try {
        const pairContract = new ethers.Contract(pairAddress, this.lbPairABI, provider);
        const [reserves, activeId] = await Promise.all([
          pairContract.getReserves(),
          pairContract.getActiveId()
        ]);

        return {
          address: pairAddress,
          binStep,
          activeId: Number(activeId),
          reserveX: reserves.reserveX.toString(),
          reserveY: reserves.reserveY.toString(),
          // Calculate total liquidity as sum of reserves (simple metric)
          // For proper TVL we'd need token prices, but reserves work for comparison
          totalReserves: reserves.reserveX.add(reserves.reserveY)
        };
      } catch (error) {
        // Pool query failed — skip this pair
        return null;
      }
    });

    const pairDataResults = await Promise.all(pairDataPromises);
    const validPairs = pairDataResults.filter(p => p !== null);

    if (validPairs.length === 0) {
      throw new Error(`No pools found for ${tokenASymbol}/${tokenBSymbol} on ${this.platformName}`);
    }

    // Filter pools with zero reserves (no liquidity)
    const activePools = validPairs.filter(pool => {
      const reserveX = BigInt(pool.reserveX);
      const reserveY = BigInt(pool.reserveY);
      return reserveX > 0n || reserveY > 0n;
    });

    if (activePools.length === 0) {
      throw new Error(`No active pools (with liquidity) found for ${tokenASymbol}/${tokenBSymbol} on ${this.platformName}`);
    }

    // Sort by total reserves (highest first) and select best
    activePools.sort((a, b) => {
      if (b.totalReserves.gt(a.totalReserves)) return 1;
      if (b.totalReserves.lt(a.totalReserves)) return -1;
      return 0;
    });

    const best = activePools[0];

    // Build normalized pool data structure
    const tokenXData = {
      address: tokenX.address,
      symbol: tokenX.symbol,
      decimals: tokenX.decimals,
      isNative: false  // TJ always uses wrapped native, never raw native
    };
    const tokenYData = {
      address: tokenY.address,
      symbol: tokenY.symbol,
      decimals: tokenY.decimals,
      isNative: false
    };

    const bestPool = {
      address: best.address,
      binStep: best.binStep,
      activeId: best.activeId,
      tokenX: tokenXData,
      tokenY: tokenYData,
      // Normalized aliases for cross-platform strategy compatibility (token0/token1 is the standard)
      token0: tokenXData,
      token1: tokenYData,
      reserveX: best.reserveX,
      reserveY: best.reserveY
    };

    return {
      bestPool,
      poolsDiscovered: validPairs.length,
      poolsActive: activePools.length
    };
  }

  /**
   * Calculate position bin range from percentage parameters
   *
   * Converts percentage-based range into bin IDs for Trader Joe V2.2 Liquidity Book.
   * Each bin represents a price step of (binStep / 10000) as a ratio.
   *
   * Math: bins = log(1 + percent/100) / log(1 + binStep/10000)
   *
   * @param {Object} poolData - Pool data from getPoolData
   * @param {number} poolData.activeId - Current active bin ID
   * @param {number} poolData.binStep - Bin step in basis points (e.g., 20 = 0.20%)
   * @param {number} upperPercent - Upper range in percentage (e.g., 5 for +5%)
   * @param {number} lowerPercent - Lower range in percentage (e.g., 5 for -5%)
   * @returns {{lowerBinId: number, upperBinId: number, activeBinId: number}}
   * @throws {Error} If parameters are invalid
   */
  getPositionRange(poolData, upperPercent, lowerPercent) {
    // Validate poolData
    if (!poolData || typeof poolData !== 'object') {
      throw new Error('poolData is required and must be an object');
    }
    if (poolData.activeId === null || poolData.activeId === undefined) {
      throw new Error('poolData.activeId is required');
    }
    if (!Number.isFinite(poolData.activeId)) {
      throw new Error('poolData.activeId must be a finite number');
    }
    if (poolData.binStep === null || poolData.binStep === undefined) {
      throw new Error('poolData.binStep is required');
    }
    if (!Number.isFinite(poolData.binStep) || poolData.binStep <= 0) {
      throw new Error('poolData.binStep must be a positive finite number');
    }

    // Validate upperPercent
    if (upperPercent === null || upperPercent === undefined) {
      throw new Error('upperPercent is required');
    }
    if (typeof upperPercent !== 'number' || !Number.isFinite(upperPercent)) {
      throw new Error('upperPercent must be a finite number');
    }
    if (upperPercent <= 0 || upperPercent > 100) {
      throw new Error('upperPercent must be greater than 0 and at most 100');
    }

    // Validate lowerPercent
    if (lowerPercent === null || lowerPercent === undefined) {
      throw new Error('lowerPercent is required');
    }
    if (typeof lowerPercent !== 'number' || !Number.isFinite(lowerPercent)) {
      throw new Error('lowerPercent must be a finite number');
    }
    if (lowerPercent <= 0 || lowerPercent > 100) {
      throw new Error('lowerPercent must be greater than 0 and at most 100');
    }

    // Calculate bin offsets from percentages
    // Liquidity Book price formula: price = (1 + binStep/10000)^(id - 2^23)
    // For a p% price change: n_bins = log(1 + p/100) / log(1 + binStep/10000)
    const logBase = Math.log(1 + poolData.binStep / 10000);
    const upperBinOffset = Math.ceil(Math.log(1 + upperPercent / 100) / logBase);
    const lowerBinOffset = Math.ceil(Math.log(1 + lowerPercent / 100) / logBase);

    // Calculate bin IDs (integer values, no spacing alignment needed)
    const upperBinId = poolData.activeId + upperBinOffset;
    const lowerBinId = poolData.activeId - lowerBinOffset;

    // Validate bin IDs are in valid range (uint24: 0 to 16777215)
    if (lowerBinId < 0) {
      throw new Error(`Calculated lowerBinId (${lowerBinId}) is below minimum (0)`);
    }
    if (upperBinId > 16777215) {
      throw new Error(`Calculated upperBinId (${upperBinId}) exceeds maximum (16777215)`);
    }
    if (lowerBinId >= upperBinId) {
      throw new Error(`Invalid bin range: lowerBinId (${lowerBinId}) must be less than upperBinId (${upperBinId})`);
    }

    return {
      lowerBinId,
      upperBinId,
      activeBinId: poolData.activeId
    };
  }

  /**
   * Format a human-readable summary of a pool for logging.
   * @param {Object} pool - Pool object from selectBestPool
   * @returns {string} Formatted pool description
   */
  describePool(pool) {
    const t0 = pool.tokenX?.symbol ?? pool.token0?.symbol ?? '?';
    const t1 = pool.tokenY?.symbol ?? pool.token1?.symbol ?? '?';
    return `${t0}/${t1} at ${pool.address} (binStep: ${pool.binStep}, activeId: ${pool.activeId})`;
  }

  /**
   * Extract position bounds from an existing position object
   *
   * For Trader Joe V2.2, positions store bounds as lowerBinId and upperBinId.
   * Returns them in a platform-agnostic format for strategy event emission.
   *
   * @param {Object} position - Position object from vault cache
   * @param {number} position.lowerBinId - Lower bin boundary
   * @param {number} position.upperBinId - Upper bin boundary
   * @returns {{lower: number, upper: number}} Position bounds
   * @throws {Error} If position is invalid or missing required properties
   */
  extractPositionBounds(position) {
    if (!position || typeof position !== 'object' || Array.isArray(position)) {
      throw new Error('Position is required and must be an object');
    }

    if (position.lowerBinId === undefined || position.lowerBinId === null) {
      throw new Error('Position missing lowerBinId property');
    }

    if (position.upperBinId === undefined || position.upperBinId === null) {
      throw new Error('Position missing upperBinId property');
    }

    return {
      lower: position.lowerBinId,
      upper: position.upperBinId
    };
  }

  /**
   * Get current pool state value for baseline tracking
   *
   * For Trader Joe V2.2, the current pool state includes both the active bin ID
   * and the bin step. The bin step is needed by evaluatePriceMovement to convert
   * bin IDs to prices (it's not available in swap event data).
   *
   * The returned object is opaque platform-specific data — the strategy stores it
   * and passes it back to evaluatePriceMovement without inspecting it.
   *
   * @param {Object} poolData - Pool data object from getPoolData
   * @param {number} poolData.activeId - Current active bin ID
   * @param {number} poolData.binStep - Bin step in basis points
   * @returns {{activeId: number, binStep: number}} Current pool state for baseline tracking
   * @throws {Error} If poolData is invalid or missing required properties
   */
  getPoolCurrent(poolData) {
    if (!poolData || poolData.activeId === undefined) {
      throw new Error('Pool data must have activeId property');
    }
    if (poolData.binStep === undefined) {
      throw new Error('Pool data must have binStep property');
    }
    return { activeId: poolData.activeId, binStep: poolData.binStep };
  }

  /**
   * Fetch current on-chain state of an LBPair
   *
   * @param {string} poolId - LBPair contract address
   * @param {Object} provider - Ethers provider instance
   * @returns {Promise<Object>} Pool state data
   */
  async getPoolData(poolId, provider) {
    // Validate poolId - must be valid address
    if (!poolId || typeof poolId !== 'string') {
      throw new Error("poolId parameter is required and must be a string");
    }
    try {
      ethers.utils.getAddress(poolId);
    } catch (error) {
      throw new Error(`Invalid poolId address: ${poolId}`);
    }

    // Validate provider
    if (!provider) {
      throw new Error("Provider parameter is required");
    }

    try {
      // Create LBPair contract instance
      const lbPairContract = new ethers.Contract(
        poolId,
        this.lbPairABI,
        provider
      );

      // Fetch pool state in parallel
      const [
        activeId,
        reserves,
        binStep,
        staticFeeParameters,
        tokenX,
        tokenY
      ] = await Promise.all([
        lbPairContract.getActiveId(),
        lbPairContract.getReserves(),
        lbPairContract.getBinStep(),
        lbPairContract.getStaticFeeParameters(),
        lbPairContract.getTokenX(),
        lbPairContract.getTokenY()
      ]);

      // Build pool data object
      // Note: Trader Joe uses activeId (bin) instead of tick, and doesn't have sqrtPriceX96
      return {
        address: poolId,
        activeId: Number(activeId),
        binStep: Number(binStep),
        reserveX: reserves.reserveX.toString(),
        reserveY: reserves.reserveY.toString(),
        tokenX: tokenX.toLowerCase(),
        tokenY: tokenY.toLowerCase(),
        // Static fee parameters
        feeParameters: {
          baseFactor: Number(staticFeeParameters.baseFactor),
          filterPeriod: Number(staticFeeParameters.filterPeriod),
          decayPeriod: Number(staticFeeParameters.decayPeriod),
          reductionFactor: Number(staticFeeParameters.reductionFactor),
          variableFeeControl: Number(staticFeeParameters.variableFeeControl),
          protocolShare: Number(staticFeeParameters.protocolShare),
          maxVolatilityAccumulator: Number(staticFeeParameters.maxVolatilityAccumulator)
        },
        lastUpdated: Date.now()
      };
    } catch (error) {
      throw new Error(`Failed to get pool data for ${poolId}: ${error.message}`);
    }
  }
}
