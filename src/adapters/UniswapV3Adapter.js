/**
 * UniswapV3Adapter - Uniswap V3 Protocol Integration
 * 
 * This adapter provides integration with Uniswap V3 concentrated liquidity pools:
 * - Fetch pool and position data
 * - Calculate position values and uncollected fees
 * - Generate swap and liquidity management transactions
 * - Handle price calculations and tick conversions
 * 
 * @module adapters/UniswapV3Adapter
 */

import { ethers } from "ethers";
import PlatformAdapter from "./PlatformAdapter.js";
import { formatUnits } from "../helpers/formatHelpers.js";
import { Position, Pool, NonfungiblePositionManager } from '@uniswap/v3-sdk';
import { Percent, Token, CurrencyAmount } from '@uniswap/sdk-core';
import JSBI from "jsbi";

// Import ABIs from Uniswap and OpenZeppelin libraries
import NonfungiblePositionManagerARTIFACT from '@uniswap/v3-periphery/artifacts/contracts/NonfungiblePositionManager.sol/NonfungiblePositionManager.json';
import IUniswapV3PoolARTIFACT from '@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Pool.sol/IUniswapV3Pool.json';
import SwapRouterARTIFACT from '@uniswap/v3-periphery/artifacts/contracts/SwapRouter.sol/SwapRouter.json';
import ERC20ARTIFACT from '@openzeppelin/contracts/build/contracts/ERC20.json';

const NonfungiblePositionManagerABI = NonfungiblePositionManagerARTIFACT.abi;
const IUniswapV3PoolABI = IUniswapV3PoolARTIFACT.abi;
const SwapRouterABI = SwapRouterARTIFACT.abi;
const ERC20ABI = ERC20ARTIFACT.abi;

/**
 * Adapter for Uniswap V3 platform
 */
export default class UniswapV3Adapter extends PlatformAdapter {
  /**
   * Constructor
   * @param {Object} config - Chain configurations object
   * @param {Object} config[chainId] - Configuration for each chain
   * @param {Object} config[chainId].platformAddresses - Platform contract addresses
   * @param {Object} config[chainId].tokenAddresses - Token contract addresses
   * @param {Object} provider - Ethers provider instance
   */
  constructor(config, provider) {
    super(config, provider, "uniswapV3", "Uniswap V3");

    // Store the imported ABIs
    this.nonfungiblePositionManagerABI = NonfungiblePositionManagerABI;
    this.uniswapV3PoolABI = IUniswapV3PoolABI;
    this.swapRouterABI = SwapRouterABI;
    this.erc20ABI = ERC20ABI;
  }

  /**
   * Calculate pool address for the given tokens and fee tier
   * @param {Object} token0 - First token object
   * @param {string} token0.address - Token contract address
   * @param {number} token0.decimals - Token decimals
   * @param {string} token0.symbol - Token symbol
   * @param {string} token0.name - Token name
   * @param {Object} token1 - Second token object
   * @param {string} token1.address - Token contract address
   * @param {number} token1.decimals - Token decimals
   * @param {string} token1.symbol - Token symbol
   * @param {string} token1.name - Token name
   * @param {number} fee - Fee tier (e.g., 500, 3000, 10000)
   * @returns {Promise<{poolAddress: string, token0: Object, token1: Object}>} Pool information
   */
  async getPoolAddress(token0, token1, fee) {
    if (!token0?.address || !token1?.address || fee === undefined ||
        token0.decimals === undefined || token1.decimals === undefined) {
      throw new Error("Missing required token information for pool address calculation");
    }

    // Sort tokens according to Uniswap V3 rules
    let sortedToken0, sortedToken1;
    const tokensSwapped = token0.address.toLowerCase() > token1.address.toLowerCase();

    if (tokensSwapped) {
      sortedToken0 = token1;
      sortedToken1 = token0;
    } else {
      sortedToken0 = token0;
      sortedToken1 = token1;
    }

    // Get chainId from provider
    let chainId;
    try {
      const network = await this.provider.getNetwork();
      // Handle ethers v6 where chainId might be a bigint
      chainId = typeof network.chainId === 'bigint'
        ? Number(network.chainId)
        : network.chainId;
    } catch (error) {
      console.error("Failed to get network from provider:", error);
      throw new Error("Could not determine chainId from provider");
    }

    if (!chainId) {
      throw new Error("Invalid chainId from provider");
    }

    try {      // Use the Uniswap SDK to calculate pool address

      const sdkToken0 = new Token(
        chainId,
        sortedToken0.address,
        sortedToken0.decimals,
        sortedToken0.symbol || "",
        sortedToken0.name || ""
      );

      const sdkToken1 = new Token(
        chainId,
        sortedToken1.address,
        sortedToken1.decimals,
        sortedToken1.symbol || "",
        sortedToken1.name || ""
      );

      const poolAddress = Pool.getAddress(sdkToken0, sdkToken1, fee);

      return {
        poolAddress,
        sortedToken0,
        sortedToken1,
        tokensSwapped
      };
    } catch (error) {
      console.error("Error calculating pool address:", error);
      throw new Error(`Failed to calculate pool address: ${error.message}`);
    }
  }

  /**
   * Get the Uniswap V3 Pool ABI
   * @returns {Array} The pool contract ABI
   */
  getPoolABI() {
    return IUniswapV3PoolABI;
  }

  /**
   * Get the Nonfungible Position Manager ABI
   * @returns {Array} The position manager contract ABI
   */
  getPositionManagerABI() {
    return NonfungiblePositionManagerABI;
  }

  /**
   * Check if a pool exists for the given tokens and fee tier
   * @param {Object} token0 - First token object
   * @param {string} token0.address - Token contract address
   * @param {number} token0.decimals - Token decimals
   * @param {Object} token1 - Second token object
   * @param {string} token1.address - Token contract address
   * @param {number} token1.decimals - Token decimals
   * @param {number} fee - Fee tier (e.g., 500, 3000, 10000)
   * @returns {Promise<{exists: boolean, poolAddress: string|null, slot0: Object|null}>} Pool existence check result
   */
  async checkPoolExists(token0, token1, fee) {
    try {
      const { poolAddress } = await this.getPoolAddress(token0, token1, fee);

      // Create a minimal pool contract to check if the pool exists
      const poolABI = [
        'function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)'
      ];

      const poolContract = new ethers.Contract(poolAddress, poolABI, this.provider);

      try {
        // Try to call slot0() to see if the pool exists
        const slot0 = await poolContract.slot0();
        return { exists: true, poolAddress, slot0 };
      } catch (error) {
        // If the call fails, the pool likely doesn't exist
        return { exists: false, poolAddress, slot0: null };
      }
    } catch (error) {
      console.error("Error checking pool existence:", error);
      return { exists: false, poolAddress: null, slot0: null };
    }
  }

  /**
   * Get positions for the connected user
   * @param {string} address - User's wallet address
   * @param {number} chainId - Chain ID
   * @returns {Promise<{positions: Array, poolData: Object, tokenData: Object}>} Position data
   */
  async getPositions(address, chainId) {
    if (!address || !this.provider || !chainId) {
      return { positions: [], poolData: {}, tokenData: {} };
    }

    try {
      // Get chain configuration
      const chainConfig = this.config[chainId];
      if (!chainConfig || !chainConfig.platformAddresses?.uniswapV3?.positionManagerAddress) {
        throw new Error(`No configuration found for chainId: ${chainId}`);
      }

      const positionManagerAddress = chainConfig.platformAddresses.uniswapV3.positionManagerAddress;

      // Create contract instance
      const positionManager = new ethers.Contract(
        positionManagerAddress,
        this.nonfungiblePositionManagerABI,
        this.provider
      );

      // Get the number of positions owned by the user
      const balance = await positionManager.balanceOf(address);
      const positionsData = [];
      const poolDataMap = {};
      const tokenDataMap = {};

      // Fetch data for each position
      for (let i = 0; i < balance; i++) {
        const tokenId = await positionManager.tokenOfOwnerByIndex(address, i);
        const positionId = String(tokenId);

        // Get position details
        const positionData = await positionManager.positions(tokenId);
        const {
          nonce,
          operator,
          token0,
          token1,
          fee,
          tickLower,
          tickUpper,
          liquidity,
          feeGrowthInside0LastX128,
          feeGrowthInside1LastX128,
          tokensOwed0,
          tokensOwed1
        } = positionData;

        // Get token details
        const token0Contract = new ethers.Contract(token0, this.erc20ABI, this.provider);
        const token1Contract = new ethers.Contract(token1, this.erc20ABI, this.provider);

        let decimals0, name0, symbol0, balance0, decimals1, name1, symbol1, balance1;

        try {
          [decimals0, name0, symbol0, balance0] = await Promise.all([
            token0Contract.decimals(),
            token0Contract.name(),
            token0Contract.symbol(),
            token0Contract.balanceOf(address),
          ]);

          decimals0 = Number(decimals0.toString());
          balance0 = Number(ethers.formatUnits(balance0, decimals0));

        } catch (err) {
          console.error("Error retrieving token0 data:", err);
          continue;
        }

        try {
          [decimals1, name1, symbol1, balance1] = await Promise.all([
            token1Contract.decimals(),
            token1Contract.name(),
            token1Contract.symbol(),
            token1Contract.balanceOf(address),
          ]);

          decimals1 = Number(decimals1.toString());
          balance1 = Number(ethers.formatUnits(balance1, decimals1));

        } catch (err) {
          console.error("Error retrieving token1 data:", err);
          continue;
        }

        // Store token data
        if (!tokenDataMap[token0]) {
          tokenDataMap[token0] = {
            address: token0,
            decimals: decimals0,
            symbol: symbol0,
            name: name0,
            balance: balance0
          };
        }

        if (!tokenDataMap[token1]) {
          tokenDataMap[token1] = {
            address: token1,
            decimals: decimals1,
            symbol: symbol1,
            name: name1,
            balance: balance1
          };
        }

        // Create Token instances for pool address calculation
        const token0Instance = new Token(chainId, token0, decimals0, symbol0);
        const token1Instance = new Token(chainId, token1, decimals1, symbol1);

        // Create a descriptive token pair name
        const tokenPair = `${symbol0}/${symbol1}`;

        // Calculate pool address
        const feeNumber = Number(fee.toString());
        const poolAddress = Pool.getAddress(token0Instance, token1Instance, feeNumber);

        // Fetch pool data if not already fetched
        if (!poolDataMap[poolAddress]) {
          const poolContract = new ethers.Contract(poolAddress, this.uniswapV3PoolABI, this.provider);

          try {
            const slot0 = await poolContract.slot0();
            const observationIndex = Number(slot0[2].toString());
            const lastObservation = await poolContract.observations(observationIndex);
            const protocolFees = await poolContract.protocolFees();

            poolDataMap[poolAddress] = {
              poolAddress,
              token0,
              token1,
              sqrtPriceX96: slot0[0].toString(),
              tick: Number(slot0[1].toString()),
              observationIndex: Number(slot0[2].toString()),
              observationCardinality: Number(slot0[3].toString()),
              observationCardinalityNext: Number(slot0[4].toString()),
              feeProtocol: Number(slot0[5].toString()),
              unlocked: slot0[6],
              liquidity: (await poolContract.liquidity()).toString(),
              feeGrowthGlobal0X128: (await poolContract.feeGrowthGlobal0X128()).toString(),
              feeGrowthGlobal1X128: (await poolContract.feeGrowthGlobal1X128()).toString(),
              protocolFeeToken0: protocolFees[0].toString(),
              protocolFeeToken1: protocolFees[1].toString(),
              tickSpacing: Number((await poolContract.tickSpacing()).toString()),
              fee: Number((await poolContract.fee()).toString()),
              maxLiquidityPerTick: (await poolContract.maxLiquidityPerTick()).toString(),
              lastObservation: {
                blockTimestamp: Number(lastObservation.blockTimestamp.toString()),
                tickCumulative: lastObservation.tickCumulative.toString(),
                secondsPerLiquidityCumulativeX128: lastObservation.secondsPerLiquidityCumulativeX128.toString(),
                initialized: lastObservation.initialized,
              },
              ticks: {} // Initialize ticks object
            };

            // Fetch tick data for this position
            try {
              // Fetch lower tick data
              const lowerTickData = await poolContract.ticks(tickLower);
              poolDataMap[poolAddress].ticks[tickLower] = {
                feeGrowthOutside0X128: lowerTickData.feeGrowthOutside0X128.toString(),
                feeGrowthOutside1X128: lowerTickData.feeGrowthOutside1X128.toString(),
                initialized: lowerTickData.initialized
              };

              // Fetch upper tick data
              const upperTickData = await poolContract.ticks(tickUpper);
              poolDataMap[poolAddress].ticks[tickUpper] = {
                feeGrowthOutside0X128: upperTickData.feeGrowthOutside0X128.toString(),
                feeGrowthOutside1X128: upperTickData.feeGrowthOutside1X128.toString(),
                initialized: upperTickData.initialized
              };

            } catch (tickError) {
              console.error(`Failed to fetch tick data for position ${positionId}:`, tickError);
            }

          } catch (slot0Error) {
            console.error(`Failed to fetch slot0 or pool data for pool ${poolAddress}:`, slot0Error);
            poolDataMap[poolAddress] = { poolAddress }; // Minimal data on failure
          }

        } else if (poolDataMap[poolAddress].ticks) {
          // If pool data exists but we haven't fetched these specific ticks yet
          const poolContract = new ethers.Contract(poolAddress, this.uniswapV3PoolABI, this.provider);

          try {
            // Check if we need to fetch the lower tick
            if (!poolDataMap[poolAddress].ticks[tickLower]) {
              const lowerTickData = await poolContract.ticks(tickLower);
              poolDataMap[poolAddress].ticks[tickLower] = {
                feeGrowthOutside0X128: lowerTickData.feeGrowthOutside0X128.toString(),
                feeGrowthOutside1X128: lowerTickData.feeGrowthOutside1X128.toString(),
                initialized: lowerTickData.initialized
              };
            }

            // Check if we need to fetch the upper tick
            if (!poolDataMap[poolAddress].ticks[tickUpper]) {
              const upperTickData = await poolContract.ticks(tickUpper);
              poolDataMap[poolAddress].ticks[tickUpper] = {
                feeGrowthOutside0X128: upperTickData.feeGrowthOutside0X128.toString(),
                feeGrowthOutside1X128: upperTickData.feeGrowthOutside1X128.toString(),
                initialized: upperTickData.initialized
              };
            }

          } catch (tickError) {
            console.error(`Failed to fetch additional tick data for position ${positionId}:`, tickError);
          }
        }

        // Create position object with platform identifier
        positionsData.push({
          id: positionId,
          tokenPair,
          pool: poolAddress,
          nonce: Number(nonce.toString()),
          operator,
          fee: feeNumber,
          tickLower: Number(tickLower.toString()),
          tickUpper: Number(tickUpper.toString()),
          liquidity: Number(liquidity.toString()),
          feeGrowthInside0LastX128: feeGrowthInside0LastX128.toString(),
          feeGrowthInside1LastX128: feeGrowthInside1LastX128.toString(),
          tokensOwed0: Number(tokensOwed0.toString()),
          tokensOwed1: Number(tokensOwed1.toString()),
          platform: this.platformId,
          platformName: this.platformName
        });
      }

      return {
        positions: positionsData,
        poolData: poolDataMap,
        tokenData: tokenDataMap
      };

    } catch (error) {
      console.error("Error fetching Uniswap V3 positions:", error);
      return {
        positions: [],
        poolData: {},
        tokenData: {}
      };
    }
  }

  /**
   * Check if a position is in range (active)
   * @param {Object} position - Position data
   * @param {number} position.tickLower - Lower tick of the position
   * @param {number} position.tickUpper - Upper tick of the position
   * @param {Object} poolData - Pool data
   * @param {number} poolData.tick - Current tick of the pool
   * @returns {boolean} - Whether the position is in range
   */
  isPositionInRange(position, poolData) {
    if (!poolData || !position) return false;
    const currentTick = poolData.tick;
    return currentTick >= position.tickLower && currentTick <= position.tickUpper;
  }

  /**
   * Calculate price from sqrtPriceX96
   * @param {Object} position - Position data
   * @param {number} position.tickLower - Lower tick of the position
   * @param {number} position.tickUpper - Upper tick of the position
   * @param {Object} poolData - Pool data
   * @param {string} poolData.sqrtPriceX96 - Square root price in X96 format
   * @param {Object} token0Data - Token0 data
   * @param {number} token0Data.decimals - Token0 decimals
   * @param {Object} token1Data - Token1 data
   * @param {number} token1Data.decimals - Token1 decimals
   * @param {boolean} invert - Whether to invert the price
   * @returns {{currentPrice: string, lowerPrice: string, upperPrice: string}} Formatted price information
   */
  calculatePrice(position, poolData, token0Data, token1Data, invert = false) {
    if (!poolData || !token0Data || !token1Data)
      return { currentPrice: "N/A", lowerPrice: "N/A", upperPrice: "N/A" };

    const currentPrice = this._calculatePriceFromSqrtPrice(
      poolData.sqrtPriceX96,
      token0Data.decimals,
      token1Data.decimals,
      invert
    );

    const lowerPrice = this._tickToPrice(
      position.tickLower,
      token0Data.decimals,
      token1Data.decimals,
      invert
    );

    const upperPrice = this._tickToPrice(
      position.tickUpper,
      token0Data.decimals,
      token1Data.decimals,
      invert
    );

    return {
      currentPrice,
      lowerPrice,
      upperPrice,
      token0Symbol: token0Data.symbol,
      token1Symbol: token1Data.symbol
    };
  }

  /**
   * Calculate price from sqrtPriceX96
   * @param {string} sqrtPriceX96 - Square root price in X96 format
   * @param {number} decimals0 - Decimals of token0
   * @param {number} decimals1 - Decimals of token1
   * @param {boolean} invert - Whether to invert the price
   * @returns {string} Formatted price
   * @private
   */
  _calculatePriceFromSqrtPrice(sqrtPriceX96, decimals0, decimals1, invert = false) {
    if (!sqrtPriceX96 || sqrtPriceX96 === "0") return "N/A";

    // Convert sqrtPriceX96 to a number and calculate price
    const sqrtPriceX96AsNumber = Number(sqrtPriceX96) / (2 ** 96);
    const priceInt = sqrtPriceX96AsNumber * sqrtPriceX96AsNumber;

    // Apply decimal adjustment - must handle both positive and negative cases
    const decimalsDiff = decimals1 - decimals0;
    let price = priceInt;

    // Apply correct decimal adjustment for both positive and negative differences
    if (decimalsDiff > 0) {
      // If token1 has more decimals than token0, multiply by 10^(decimals1-decimals0)
      price = price * Math.pow(10, decimalsDiff);
    } else if (decimalsDiff < 0) {
      // If token0 has more decimals than token1, divide by 10^(decimals0-decimals1)
      price = price / Math.pow(10, -decimalsDiff);
    }

    // Invert the price if requested
    if (invert) {
      price = 1 / price;
    }

    // Format with appropriate precision
    const formattedPrice = Number.isFinite(price) ? price.toFixed(6) : "N/A";
    return formattedPrice;
  }

  /**
   * Convert a tick value to a corresponding price
   * @param {number} tick - The tick value
   * @param {number} decimals0 - Decimals of token0
   * @param {number} decimals1 - Decimals of token1
   * @param {boolean} invert - Whether to invert the price
   * @returns {string} The formatted price corresponding to the tick
   * @private
   */
  _tickToPrice(tick, decimals0, decimals1, invert = false) {
    if (!Number.isFinite(tick)) return "N/A";

    // Calculate raw price using the same formula from Uniswap: 1.0001^tick
    const rawPrice = Math.pow(1.0001, tick);

    // Apply the decimal adjustment
    const decimalsDiff = decimals1 - decimals0;
    let price = rawPrice;

    // Apply correct decimal adjustment for both positive and negative differences
    if (decimalsDiff > 0) {
      // If token1 has more decimals than token0, multiply by 10^(decimals1-decimals0)
      price = price * Math.pow(10, decimalsDiff);
    } else if (decimalsDiff < 0) {
      // If token0 has more decimals than token1, divide by 10^(decimals0-decimals1)
      price = price / Math.pow(10, -decimalsDiff);
    }

    // Invert if requested (token0 per token1 instead of token1 per token0)
    if (invert) {
      price = 1 / price;
    }

    // Format based on value
    if (!Number.isFinite(price)) return "N/A";
    if (price < 0.0001) return "< 0.0001";
    if (price > 1000000) return price.toLocaleString(undefined, { maximumFractionDigits: 0 });

    // Return with appropriate precision
    return price.toFixed(6);
  }

  /**
   * Calculate uncollected fees for a position
   * @param {Object} position - Position data
   * @param {string} position.liquidity - Position liquidity
   * @param {string} position.feeGrowthInside0LastX128 - Fee growth inside for token0
   * @param {string} position.feeGrowthInside1LastX128 - Fee growth inside for token1
   * @param {number} position.tickLower - Lower tick of the position
   * @param {number} position.tickUpper - Upper tick of the position
   * @param {Object} poolData - Pool data
   * @param {number} poolData.tick - Current pool tick
   * @param {string} poolData.feeGrowthGlobal0X128 - Global fee growth for token0
   * @param {string} poolData.feeGrowthGlobal1X128 - Global fee growth for token1
   * @param {Object} poolData.ticks - Tick data object
   * @param {Object} token0Data - Token0 data
   * @param {number} token0Data.decimals - Token0 decimals
   * @param {Object} token1Data - Token1 data
   * @param {number} token1Data.decimals - Token1 decimals
   * @returns {{token0: string, token1: string}|null} Uncollected fees or null if calculation fails
   */
  async calculateFees(position, poolData, token0Data, token1Data) {
    if (!poolData || !poolData.feeGrowthGlobal0X128 || !poolData.feeGrowthGlobal1X128 ||
        !poolData.ticks || !poolData.ticks[position.tickLower] || !poolData.ticks[position.tickUpper]) {
      return null;
    }

    const tickLower = poolData.ticks[position.tickLower];
    const tickUpper = poolData.ticks[position.tickUpper];


    // Create position object for fee calculation
    const positionForFeeCalc = {
      ...position,
      // Convert to BigInt compatible format
      liquidity: BigInt(position.liquidity),
      feeGrowthInside0LastX128: BigInt(position.feeGrowthInside0LastX128),
      feeGrowthInside1LastX128: BigInt(position.feeGrowthInside1LastX128),
    };

    try {
      return this._calculateUncollectedFees({
        position: positionForFeeCalc,
        currentTick: poolData.tick,
        feeGrowthGlobal0X128: poolData.feeGrowthGlobal0X128,
        feeGrowthGlobal1X128: poolData.feeGrowthGlobal1X128,
        tickLower,
        tickUpper,
        token0: token0Data,
        token1: token1Data
      });
    } catch (error) {
      console.error("Error calculating fees for position", position.id, ":", error);
      return null;
    }
  }

  /**
   * Calculate uncollected fees for a Uniswap V3 position
   * @param {Object} params - Parameters object containing position, pool, and price data
   * @param {Object} params.position - Position object with liquidity and fee growth data
   * @param {number} params.currentTick - Current tick of the pool
   * @param {string} params.feeGrowthGlobal0X128 - Global fee growth for token0
   * @param {string} params.feeGrowthGlobal1X128 - Global fee growth for token1
   * @param {Object} params.tickLower - Lower tick data object
   * @param {Object} params.tickUpper - Upper tick data object
   * @param {Object} params.token0 - Token0 data with decimals
   * @param {Object} params.token1 - Token1 data with decimals
   * @returns {{token0: string, token1: string}} Uncollected fees for token0 and token1
   * @private
   */
  _calculateUncollectedFees({
    position,
    currentTick,
    feeGrowthGlobal0X128,
    feeGrowthGlobal1X128,
    tickLower,
    tickUpper,
    token0,
    token1,
  }) {
    // Convert all inputs to proper types
    const toBigInt = (val) => {
      if (typeof val === 'bigint') return val;
      if (typeof val === 'string') return BigInt(val);
      if (typeof val === 'number') return BigInt(Math.floor(val));
      if (val?._isBigNumber) return BigInt(val.toString());
      if (val?.toString) return BigInt(val.toString());
      return BigInt(0);
    };

    // Position data extraction
    const tickLowerValue = Number(position.tickLower);
    const tickUpperValue = Number(position.tickUpper);
    const liquidity = toBigInt(position.liquidity);
    const feeGrowthInside0LastX128 = toBigInt(position.feeGrowthInside0LastX128);
    const feeGrowthInside1LastX128 = toBigInt(position.feeGrowthInside1LastX128);
    const tokensOwed0 = toBigInt(position.tokensOwed0);
    const tokensOwed1 = toBigInt(position.tokensOwed1);

    // Ensure we have tick data
    if (!tickLower || !tickUpper) {
      throw new Error("Required tick data is missing for fee calculation");
    }

    const lowerTickData = {
      feeGrowthOutside0X128: tickLower ? toBigInt(tickLower.feeGrowthOutside0X128) : 0n,
      feeGrowthOutside1X128: tickLower ? toBigInt(tickLower.feeGrowthOutside1X128) : 0n,
      initialized: tickLower ? Boolean(tickLower.initialized) : false
    };

    const upperTickData = {
      feeGrowthOutside0X128: tickUpper ? toBigInt(tickUpper.feeGrowthOutside0X128) : 0n,
      feeGrowthOutside1X128: tickUpper ? toBigInt(tickUpper.feeGrowthOutside1X128) : 0n,
      initialized: tickUpper ? Boolean(tickUpper.initialized) : false
    };

    // Convert global fee growth to BigInt
    const feeGrowthGlobal0X128BigInt = toBigInt(feeGrowthGlobal0X128);
    const feeGrowthGlobal1X128BigInt = toBigInt(feeGrowthGlobal1X128);

    // Calculate current fee growth inside the position's range
    let feeGrowthInside0X128, feeGrowthInside1X128;

    if (currentTick < tickLowerValue) {
      // Current tick is below the position's range
      feeGrowthInside0X128 = lowerTickData.feeGrowthOutside0X128 - upperTickData.feeGrowthOutside0X128;
      feeGrowthInside1X128 = lowerTickData.feeGrowthOutside1X128 - upperTickData.feeGrowthOutside1X128;
    } else if (currentTick >= tickUpperValue) {
      // Current tick is at or above the position's range
      feeGrowthInside0X128 = upperTickData.feeGrowthOutside0X128 - lowerTickData.feeGrowthOutside0X128;
      feeGrowthInside1X128 = upperTickData.feeGrowthOutside1X128 - lowerTickData.feeGrowthOutside1X128;
    } else {
      // Current tick is within the position's range
      feeGrowthInside0X128 = feeGrowthGlobal0X128BigInt - lowerTickData.feeGrowthOutside0X128 - upperTickData.feeGrowthOutside0X128;
      feeGrowthInside1X128 = feeGrowthGlobal1X128BigInt - lowerTickData.feeGrowthOutside1X128 - upperTickData.feeGrowthOutside1X128;
    }

    // Handle negative values by adding 2^256
    const MAX_UINT256 = 2n ** 256n;
    if (feeGrowthInside0X128 < 0n) {
      feeGrowthInside0X128 += MAX_UINT256;
    }

    if (feeGrowthInside1X128 < 0n) {
      feeGrowthInside1X128 += MAX_UINT256;
    }

    // Calculate fee growth since last position update
    let feeGrowthDelta0 = feeGrowthInside0X128 - feeGrowthInside0LastX128;
    let feeGrowthDelta1 = feeGrowthInside1X128 - feeGrowthInside1LastX128;

    // Handle underflow
    if (feeGrowthDelta0 < 0n) {
      feeGrowthDelta0 += MAX_UINT256;
    }

    if (feeGrowthDelta1 < 0n) {
      feeGrowthDelta1 += MAX_UINT256;
    }

    // Calculate uncollected fees
    // The formula is: tokensOwed + (liquidity * feeGrowthDelta) / 2^128
    const DENOMINATOR = 2n ** 128n;

    const uncollectedFees0Raw = tokensOwed0 + (liquidity * feeGrowthDelta0) / DENOMINATOR;
    const uncollectedFees1Raw = tokensOwed1 + (liquidity * feeGrowthDelta1) / DENOMINATOR;

    // Format with proper decimals
    if (!token0?.decimals || !token1?.decimals) {
      throw new Error("Token decimal information missing - cannot calculate fees accurately");
    }
    const token0Decimals = token0.decimals;
    const token1Decimals = token1.decimals;

    // Return both raw and formatted values for flexibility
    return {
      token0: {
        raw: uncollectedFees0Raw,
        // Convert to string for safer handling in UI
        formatted: formatUnits(uncollectedFees0Raw, token0Decimals)
      },
      token1: {
        raw: uncollectedFees1Raw,
        formatted: formatUnits(uncollectedFees1Raw, token1Decimals)
      }
    };
  }

  /**
   * Calculate token amounts for a position (if it were to be closed)
   * @param {Object} position - Position object
   * @param {number} position.liquidity - Position liquidity
   * @param {number} position.tickLower - Lower tick of the position
   * @param {number} position.tickUpper - Upper tick of the position
   * @param {Object} poolData - Pool data
   * @param {number} poolData.fee - Pool fee tier
   * @param {string} poolData.sqrtPriceX96 - Square root price X96
   * @param {string} poolData.liquidity - Pool liquidity
   * @param {number} poolData.tick - Current pool tick
   * @param {Object} token0Data - Token0 data
   * @param {string} token0Data.address - Token contract address
   * @param {number} token0Data.decimals - Token decimals
   * @param {string} token0Data.symbol - Token symbol
   * @param {string} token0Data.name - Token name
   * @param {Object} token1Data - Token1 data
   * @param {string} token1Data.address - Token contract address
   * @param {number} token1Data.decimals - Token decimals
   * @param {string} token1Data.symbol - Token symbol
   * @param {string} token1Data.name - Token name
   * @param {number} chainId - Chain ID from the wallet
   * @returns {Promise<{token0: {raw: bigint, formatted: string}, token1: {raw: bigint, formatted: string}}>} Token amounts
   */
  async calculateTokenAmounts(position, poolData, token0Data, token1Data, chainId) {
    try {
      if (!position || !poolData || !token0Data || !token1Data || !chainId) {
        throw new Error("Missing data for token amount calculation");
      }

      if (position.liquidity <= 0) {
        return {
          token0: { raw: 0n, formatted: "0" },
          token1: { raw: 0n, formatted: "0" }
        };
      }

      // Create Token objects - use chainId from params
      const token0 = new Token(
        chainId,
        token0Data.address,
        token0Data.decimals,
        token0Data.symbol,
        token0Data.name || token0Data.symbol
      );

      const token1 = new Token(
        chainId,
        token1Data.address,
        token1Data.decimals,
        token1Data.symbol,
        token1Data.name || token1Data.symbol
      );

      // Create Pool instance
      const pool = new Pool(
        token0,
        token1,
        poolData.fee,
        poolData.sqrtPriceX96,
        poolData.liquidity,
        poolData.tick
      );

      // Create Position instance
      const positionInstance = new Position({
        pool,
        liquidity: position.liquidity.toString(),
        tickLower: position.tickLower,
        tickUpper: position.tickUpper
      });

      // Get token amounts
      const amount0 = positionInstance.amount0;
      const amount1 = positionInstance.amount1;

      return {
        token0: {
          raw: BigInt(amount0.quotient.toString()),
          formatted: amount0.toSignificant(6)
        },
        token1: {
          raw: BigInt(amount1.quotient.toString()),
          formatted: amount1.toSignificant(6)
        }
      };
    } catch (error) {
      console.error("Error calculating token amounts:", error);
      throw error;
    }
  }

  /**
   * Generate transaction data for claiming fees from a position
   * @param {Object} params - Parameters for generating claim fees data
   * @param {Object} params.position - Position object with ID and other properties
   * @param {Object} params.provider - Ethers provider
   * @param {string} params.address - User's wallet address
   * @param {number} params.chainId - Chain ID
   * @param {Object} params.poolData - Pool data for the position
   * @param {Object} params.token0Data - Token0 data
   * @param {Object} params.token1Data - Token1 data
   * @returns {Object} Transaction data object with `to`, `data`, `value` properties
   * @throws {Error} If parameters are invalid or transaction data cannot be generated
   */
  async generateClaimFeesData(params) {
    const { position, provider, address, chainId, poolData, token0Data, token1Data } = params;

    // Input validation
    if (!position || !position.id) {
      throw new Error("Invalid position data");
    }

    if (!provider) {
      throw new Error("Provider is required");
    }

    if (!address) {
      throw new Error("Wallet address is required");
    }

    if (!chainId) {
      throw new Error("Chain ID is required");
    }

    if (!poolData || !poolData.token0 || !poolData.token1) {
      throw new Error("Invalid pool data");
    }

    if (!token0Data || !token0Data.decimals || !token0Data.symbol) {
      throw new Error("Invalid token0 data");
    }

    if (!token1Data || !token1Data.decimals || !token1Data.symbol) {
      throw new Error("Invalid token1 data");
    }

    try {
      // Get position manager address from chain config
      const chainConfig = this.config[chainId];
      if (!chainConfig || !chainConfig.platformAddresses?.uniswapV3?.positionManagerAddress) {
        throw new Error(`No configuration found for chainId: ${chainId}`);
      }
      const positionManagerAddress = chainConfig.platformAddresses.uniswapV3.positionManagerAddress;

      // Create contract instance to get position data
      const nftManager = new ethers.Contract(
        positionManagerAddress,
        this.nonfungiblePositionManagerABI,
        provider
      );

      // Get current position data directly from contract
      const positionData = await nftManager.positions(position.id);

      // Create Token instances for the SDK
      const token0 = new Token(
        chainId,
        poolData.token0,
        token0Data.decimals,
        token0Data.symbol,
        token0Data.name || token0Data.symbol
      );

      const token1 = new Token(
        chainId,
        poolData.token1,
        token1Data.decimals,
        token1Data.symbol,
        token1Data.name || token1Data.symbol
      );

      // Create collectOptions object as per Uniswap docs
      const collectOptions = {
        tokenId: position.id,
        expectedCurrencyOwed0: CurrencyAmount.fromRawAmount(
          token0,
          positionData.tokensOwed0.toString()
        ),
        expectedCurrencyOwed1: CurrencyAmount.fromRawAmount(
          token1,
          positionData.tokensOwed1.toString()
        ),
        recipient: address
      };

      // Use SDK to generate calldata and value
      const { calldata, value } = NonfungiblePositionManager.collectCallParameters(collectOptions);

      // Return transaction data
      return {
        to: positionManagerAddress,
        data: calldata,
        value: value
      };
    } catch (error) {
      console.error("Error generating claim fees data:", error);
      throw new Error(`Failed to generate claim fees data: ${error.message}`);
    }
  }

  /**
   * Claim fees for a position
   * @param {Object} params - Parameters for claiming fees
   * @param {Object} params.position - Position object with ID and other properties
   * @param {Object} params.provider - Ethers provider
   * @param {string} params.address - User's wallet address
   * @param {number} params.chainId - Chain ID
   * @param {Object} params.poolData - Pool data for the position
   * @param {Object} params.token0Data - Token0 data
   * @param {Object} params.token1Data - Token1 data
   * @param {Function} params.onStart - Callback function called when transaction starts
   * @param {Function} params.onSuccess - Callback function called on successful transaction
   * @param {Function} params.onError - Callback function called on error
   * @param {Function} params.onFinish - Callback function called when process finishes
   * @returns {Promise<Object>} Transaction receipt and updated data
   */
  async claimFees(params) {
    const { position, provider, address, chainId, poolData, token0Data, token1Data, onStart, onSuccess, onError, onFinish } = params;

    // Input validation
    if (!provider || !address || !chainId) {
      onError && onError("Wallet not connected");
      return;
    }

    // Notify start of operation
    onStart && onStart();

    try {
      // Generate transaction data
      const txData = await this.generateClaimFeesData({
        position,
        provider,
        address,
        chainId,
        poolData,
        token0Data,
        token1Data
      });

      // Get signer
      const signer = await provider.getSigner();

      // Construct transaction
      const transaction = {
        to: txData.to,
        data: txData.data,
        value: txData.value,
        from: address,
        gasLimit: 300000
      };

      // Send transaction
      const tx = await signer.sendTransaction(transaction);
      const receipt = await tx.wait();

      // IMPORTANT: Fetch updated position data after claiming fees
      try {
        // Get position manager address from chain config
        const chainConfig = this.config[chainId];
        const positionManagerAddress = chainConfig.platformAddresses.uniswapV3.positionManagerAddress;

        // Create contract instances for fetching updated data
        const nftManager = new ethers.Contract(
          positionManagerAddress,
          this.nonfungiblePositionManagerABI,
          provider
        );

        const poolContract = new ethers.Contract(
          position.poolAddress,
          this.uniswapV3PoolABI,
          provider
        );

        // Get the updated position directly from the contract
        const updatedPositionData = await nftManager.positions(position.id);

        // Create an updated position object that reflects the fee claim
        const updatedPosition = {
          ...position,
          tokensOwed0: Number(updatedPositionData.tokensOwed0.toString()),
          tokensOwed1: Number(updatedPositionData.tokensOwed1.toString()),
          feeGrowthInside0LastX128: updatedPositionData.feeGrowthInside0LastX128.toString(),
          feeGrowthInside1LastX128: updatedPositionData.feeGrowthInside1LastX128.toString()
        };

        // Get fresh pool data for fee calculation
        const feeGrowthGlobal0X128 = await poolContract.feeGrowthGlobal0X128();
        const feeGrowthGlobal1X128 = await poolContract.feeGrowthGlobal1X128();

        // Update the pool data with fresh fee growth values
        const updatedPoolData = {
          ...poolData,
          feeGrowthGlobal0X128: feeGrowthGlobal0X128.toString(),
          feeGrowthGlobal1X128: feeGrowthGlobal1X128.toString()
        };

        // Call success callback with updated data
        onSuccess && onSuccess({
          success: true,
          tx: receipt,
          updatedPosition,
          updatedPoolData
        });
      } catch (updateError) {
        console.error("Error fetching updated position data:", updateError);
        // Still consider the claim successful even if the update fails
        onSuccess && onSuccess({
          success: true,
          tx: receipt,
          warning: "Position was updated but failed to fetch new data"
        });
      }
    } catch (error) {
      console.error("Error claiming fees:", error);

      // Provide more detailed error information based on error code
      let errorMessage = "Unknown error";

      if (error.code) {
        // Handle ethers/provider specific error codes
        switch(error.code) {
          case 4001:
            errorMessage = "Transaction rejected by user";
            break;
          case -32603:
            errorMessage = "Internal JSON-RPC error";
            break;
          default:
            errorMessage = error.message || `Error code: ${error.code}`;
        }
      } else {
        errorMessage = error.message || "Unknown error";
      }

      onError && onError(errorMessage);
    } finally {
      onFinish && onFinish();
    }
  }

  /**
   * Generate transaction data for removing liquidity from a position
   * @param {Object} params - Parameters for generating remove liquidity data
   * @param {Object} params.position - Position object with ID and other properties
   * @param {number} params.percentage - Percentage of liquidity to remove (1-100)
   * @param {Object} params.provider - Ethers provider
   * @param {string} params.address - User's wallet address
   * @param {number} params.chainId - Chain ID
   * @param {Object} params.poolData - Pool data for the position
   * @param {Object} params.token0Data - Token0 data
   * @param {Object} params.token1Data - Token1 data
   * @param {number} params.slippageTolerance - Slippage tolerance percentage (e.g., 0.5 for 0.5%)
   * @param {boolean} params.collectFees - Whether to collect fees during removal
   * @returns {Object} Transaction data object with `to`, `data`, `value` properties
   * @throws {Error} If parameters are invalid or transaction data cannot be generated
   */
  async generateRemoveLiquidityData(params) {
    const {
      position,
      percentage,
      provider,
      address,
      chainId,
      poolData,
      token0Data,
      token1Data,
      slippageTolerance = 0.5,
      collectFees = true // Whether to collect fees during removal
    } = params;

    // Input validation
    if (!position || !position.id) {
      throw new Error("Invalid position data");
    }

    if (!percentage || percentage <= 0 || percentage > 100) {
      throw new Error("Percentage must be between 1 and 100");
    }

    if (!provider) {
      throw new Error("Provider is required");
    }

    if (!address) {
      throw new Error("Wallet address is required");
    }

    if (!chainId) {
      throw new Error("Chain ID is required");
    }

    if (!poolData || !token0Data || !token1Data) {
      throw new Error("Pool and token data are required");
    }

    try {
      // Get position manager address from chain config
      const chainConfig = this.config[chainId];
      if (!chainConfig || !chainConfig.platformAddresses?.uniswapV3?.positionManagerAddress) {
        throw new Error(`No configuration found for chainId: ${chainId}`);
      }
      const positionManagerAddress = chainConfig.platformAddresses.uniswapV3.positionManagerAddress;

      // Get current position data from contract FIRST to ensure correct token order
      const nftManager = new ethers.Contract(
        positionManagerAddress,
        this.nonfungiblePositionManagerABI,
        provider
      );

      const positionData = await nftManager.positions(position.id);

      // CRITICAL: Ensure token order matches the position's actual token order

      // The tokens MUST be in the same order as the position expects
      let orderedToken0Data, orderedToken1Data;
      if (positionData.token0.toLowerCase() === token0Data.address.toLowerCase() && 
          positionData.token1.toLowerCase() === token1Data.address.toLowerCase()) {
        // Order matches
        orderedToken0Data = token0Data;
        orderedToken1Data = token1Data;
      } else if (positionData.token0.toLowerCase() === token1Data.address.toLowerCase() && 
                 positionData.token1.toLowerCase() === token0Data.address.toLowerCase()) {
        // Order is reversed
        
        orderedToken0Data = token1Data;
        orderedToken1Data = token0Data;
      } else {
        throw new Error(`Token mismatch: position tokens (${positionData.token0}, ${positionData.token1}) don't match provided tokens (${token0Data.address}, ${token1Data.address})`);
      }

      // Create Token instances for the SDK with correct order
      const token0 = new Token(
        chainId,
        orderedToken0Data.address,
        orderedToken0Data.decimals,
        orderedToken0Data.symbol,
        orderedToken0Data.name || orderedToken0Data.symbol
      );

      const token1 = new Token(
        chainId,
        orderedToken1Data.address,
        orderedToken1Data.decimals,
        orderedToken1Data.symbol,
        orderedToken1Data.name || orderedToken1Data.symbol
      );


      // Create Pool instance
      const pool = new Pool(
        token0,
        token1,
        poolData.fee,
        poolData.sqrtPriceX96,
        poolData.liquidity,
        poolData.tick
      );

      // Create a Position instance using the current position data

      const currentPosition = new Position({
        pool,
        liquidity: positionData.liquidity.toString(),
        tickLower: position.tickLower,
        tickUpper: position.tickUpper
      });

      // Calculate uncollected fees if we're collecting them
      let expectedCurrencyOwed0 = CurrencyAmount.fromRawAmount(token0, 0);
      let expectedCurrencyOwed1 = CurrencyAmount.fromRawAmount(token1, 0);

      if (collectFees) {
        try {
          const fees = await this.calculateFees(position, poolData, token0Data, token1Data);
          if (fees && fees.token0 && fees.token1) {
            expectedCurrencyOwed0 = CurrencyAmount.fromRawAmount(
              token0,
              fees.token0.raw.toString()
            );
            expectedCurrencyOwed1 = CurrencyAmount.fromRawAmount(
              token1,
              fees.token1.raw.toString()
            );
          }
        } catch (feeError) {
          console.warn("Error calculating fees, will use zero minimums:", feeError);
        }
      }

      // Create CollectOptions to collect fees in the same transaction
      const collectOptions = {
        expectedCurrencyOwed0,
        expectedCurrencyOwed1,
        recipient: address
      };

      // Debug: Log slippage tolerance calculation

      // Create slippage tolerance Percent
      const slippageTolerancePercent = new Percent(Math.floor(slippageTolerance * 100), 10_000);

      // Debug: Log liquidity percentage calculation

      // Create liquidity percentage Percent
      const liquidityPercentage = new Percent(percentage, 100);

      // Create RemoveLiquidityOptions
      const removeLiquidityOptions = {
        deadline: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
        slippageTolerance: slippageTolerancePercent,
        tokenId: position.id,
        // Percentage of liquidity to remove
        liquidityPercentage: liquidityPercentage,
        collectOptions,
      };

      // Generate the calldata using the SDK
      
      const { calldata, value } = NonfungiblePositionManager.removeCallParameters(
        currentPosition,
        removeLiquidityOptions
      );

      // Return transaction data
      return {
        to: positionManagerAddress,
        data: calldata,
        value: value
      };
    } catch (error) {
      console.error("Error generating remove liquidity data:", error);
      throw new Error(`Failed to generate remove liquidity data: ${error.message}`);
    }
  }

  /**
   * Remove liquidity from a position and collect fees
   * @param {Object} params - Parameters for removing liquidity
   * @param {Object} params.position - Position object with ID and other properties
   * @param {number} params.percentage - Percentage of liquidity to remove (1-100)
   * @param {Object} params.provider - Ethers provider
   * @param {string} params.address - User's wallet address
   * @param {number} params.chainId - Chain ID
   * @param {Object} params.poolData - Pool data for the position
   * @param {Object} params.token0Data - Token0 data
   * @param {Object} params.token1Data - Token1 data
   * @param {number} params.slippageTolerance - Slippage tolerance percentage
   * @param {Function} params.onStart - Callback function called when transaction starts
   * @param {Function} params.onSuccess - Callback function called on successful transaction
   * @param {Function} params.onError - Callback function called on error
   * @param {Function} params.onFinish - Callback function called when process finishes
   * @returns {Promise<Object>} Transaction receipt and updated data
   */
  async decreaseLiquidity(params) {
    const {
      position,
      percentage,
      provider,
      address,
      chainId,
      poolData,
      token0Data,
      token1Data,
      slippageTolerance = 0.5,
      onStart,
      onSuccess,
      onError,
      onFinish
    } = params;

    // Input validation
    if (!provider || !address || !chainId) {
      onError && onError("Wallet not connected");
      return;
    }

    if (!percentage || percentage <= 0 || percentage > 100) {
      onError && onError("Percentage must be between 1 and 100");
      return;
    }

    // Notify start of operation
    onStart && onStart();

    try {
      // Generate transaction data for removing liquidity and collecting fees in one transaction
      const txData = await this.generateRemoveLiquidityData({
        position,
        percentage,
        provider,
        address,
        chainId,
        poolData,
        token0Data,
        token1Data,
        slippageTolerance,
        collectFees: true
      });

      // Get signer
      const signer = await provider.getSigner();

      // Construct transaction
      const transaction = {
        to: txData.to,
        data: txData.data,
        value: txData.value,
        from: address,
        gasLimit: 500000 // Higher gas limit for complex operation
      };

      // Send transaction
      const tx = await signer.sendTransaction(transaction);
      const receipt = await tx.wait();

      // IMPORTANT: Fetch updated position data after decreasing liquidity
      try {
        // Get position manager address from chain config
        const chainConfig = this.config[chainId];
        const positionManagerAddress = chainConfig.platformAddresses.uniswapV3.positionManagerAddress;

        // Create contract instances for fetching updated data
        const nftManager = new ethers.Contract(
          positionManagerAddress,
          this.nonfungiblePositionManagerABI,
          provider
        );

        const poolContract = new ethers.Contract(
          position.poolAddress,
          this.uniswapV3PoolABI,
          provider
        );

        // Get the updated position directly from the contract
        const updatedPositionData = await nftManager.positions(position.id);

        // Create an updated position object that reflects the liquidity decrease
        const updatedPosition = {
          ...position,
          liquidity: Number(updatedPositionData.liquidity.toString()),
          tokensOwed0: Number(updatedPositionData.tokensOwed0.toString()),
          tokensOwed1: Number(updatedPositionData.tokensOwed1.toString()),
          feeGrowthInside0LastX128: updatedPositionData.feeGrowthInside0LastX128.toString(),
          feeGrowthInside1LastX128: updatedPositionData.feeGrowthInside1LastX128.toString()
        };

        // Get fresh pool data for fee calculation
        const feeGrowthGlobal0X128 = await poolContract.feeGrowthGlobal0X128();
        const feeGrowthGlobal1X128 = await poolContract.feeGrowthGlobal1X128();

        // Update the pool data with fresh fee growth values
        const updatedPoolData = {
          ...poolData,
          feeGrowthGlobal0X128: feeGrowthGlobal0X128.toString(),
          feeGrowthGlobal1X128: feeGrowthGlobal1X128.toString()
        };

        // Call success callback with updated data
        onSuccess && onSuccess({
          success: true,
          tx: receipt,
          updatedPosition,
          updatedPoolData,
          decreaseReceipt: receipt,
          collectReceipt: receipt
        });
      } catch (updateError) {
        console.error("Error fetching updated position data:", updateError);
        // Still consider the transaction successful even if the update fails
        onSuccess && onSuccess({
          success: true,
          tx: receipt,
          decreaseReceipt: receipt,
          collectReceipt: receipt,
          warning: "Position was updated but failed to fetch new data"
        });
      }
    } catch (error) {
      console.error("Error removing liquidity:", error);

      // Provide more detailed error information based on error code
      let errorMessage = "Unknown error";

      if (error.code) {
        // Handle ethers/provider specific error codes
        switch(error.code) {
          case 4001:
            errorMessage = "Transaction rejected by user";
            break;
          case -32603:
            errorMessage = "Internal JSON-RPC error";
            break;
          default:
            errorMessage = error.message || `Error code: ${error.code}`;
        }
      } else {
        errorMessage = error.message || "Unknown error";
      }

      onError && onError(errorMessage);
    } finally {
      onFinish && onFinish();
    }
  }

  /**
   * Close a position completely by removing all liquidity and optionally burning the NFT
   * @param {Object} params - Parameters for closing position
   * @param {Object} params.position - Position object with ID and other properties
   * @param {Object} params.provider - Ethers provider
   * @param {string} params.address - User's wallet address
   * @param {number} params.chainId - Chain ID
   * @param {Object} params.poolData - Pool data for the position
   * @param {Object} params.token0Data - Token0 data
   * @param {Object} params.token1Data - Token1 data
   * @param {boolean} params.collectFees - Whether to collect fees
   * @param {boolean} params.burnPosition - Whether to burn the position NFT
   * @param {number} params.slippageTolerance - Slippage tolerance percentage (default: 0.5)
   * @param {Function} params.onStart - Callback function called when transaction starts
   * @param {Function} params.onSuccess - Callback function called on successful transaction
   * @param {Function} params.onError - Callback function called on error
   * @param {Function} params.onFinish - Callback function called when process finishes
   * @returns {Promise<Object>} Transaction receipt and updated data
   */
  async closePosition(params) {
    const {
      position,
      provider,
      address,
      chainId,
      poolData,
      token0Data,
      token1Data,
      collectFees = true,
      burnPosition = false,
      slippageTolerance = 0.5,
      onStart,
      onSuccess,
      onError,
      onFinish
    } = params;

    // Call onStart callback
    onStart && onStart();

    try {
      // Step 1: Remove all liquidity and collect fees using our improved decreaseLiquidity function
      const liquidityResult = await this.decreaseLiquidity({
        position,
        percentage: 100, // Remove 100% of liquidity
        provider,
        address,
        chainId,
        poolData,
        token0Data,
        token1Data,
        slippageTolerance, // Use the provided slippage tolerance
        onStart: () => {}, // We already called onStart
        onFinish: () => {}, // Don't call onFinish yet
        onError, // Pass through the error callback
        onSuccess: () => {} // Don't call onSuccess yet, we'll handle it after burning if needed
      });

      // Step 2: Burn the position NFT if requested
      let burnReceipt = null;
      if (burnPosition) {
        try {
          // Burn implementation here
          // This would be implemented if needed
        } catch (burnError) {
          console.error("Error burning position NFT:", burnError);
        }
      }

      // Call success callback with combined results
      onSuccess && onSuccess({
        success: true,
        liquidityResult,
        burnReceipt,
        tx: liquidityResult,
      });
    } catch (error) {
      console.error("Error closing position:", error);
      onError && onError(error.message || "Unknown error closing position");
    } finally {
      onFinish && onFinish();
    }
  }

  /**
   * Generate transaction data for adding liquidity to an existing position
   * @param {Object} params - Parameters for generating add liquidity data
   * @param {Object} params.position - Position object with ID and other properties
   * @param {string} params.token0Amount - Amount of token0 to add
   * @param {string} params.token1Amount - Amount of token1 to add
   * @param {Object} params.provider - Ethers provider
   * @param {string} params.address - User's wallet address
   * @param {number} params.chainId - Chain ID
   * @param {Object} params.poolData - Pool data for the position
   * @param {Object} params.token0Data - Token0 data
   * @param {Object} params.token1Data - Token1 data
   * @param {number} params.slippageTolerance - Slippage tolerance percentage (e.g., 0.5 for 0.5%)
   * @returns {Object} Transaction data object with `to`, `data`, `value` properties
   * @throws {Error} If parameters are invalid or transaction data cannot be generated
   */
  async generateAddLiquidityData(params) {
    const {
      position,
      token0Amount,
      token1Amount,
      provider,
      address,
      chainId,
      poolData,
      token0Data,
      token1Data,
      slippageTolerance = 0.5
    } = params;

    // Input validation
    if (!position || !position.id) {
      throw new Error("Invalid position data");
    }

    if ((!token0Amount || parseFloat(token0Amount) <= 0) &&
        (!token1Amount || parseFloat(token1Amount) <= 0)) {
      throw new Error("At least one token amount must be provided");
    }

    if (!provider) {
      throw new Error("Provider is required");
    }

    if (!address) {
      throw new Error("Wallet address is required");
    }

    if (!chainId) {
      throw new Error("Chain ID is required");
    }

    if (!poolData || !token0Data || !token1Data) {
      throw new Error("Pool and token data are required");
    }

    try {
      // Get position manager address from chain config
      const chainConfig = this.config[chainId];
      if (!chainConfig || !chainConfig.platformAddresses?.uniswapV3?.positionManagerAddress) {
        throw new Error(`No configuration found for chainId: ${chainId}`);
      }
      const positionManagerAddress = chainConfig.platformAddresses.uniswapV3.positionManagerAddress;

      // Create Token instances for the SDK
      const token0 = new Token(
        chainId,
        token0Data.address,
        token0Data.decimals,
        token0Data.symbol,
        token0Data.name || token0Data.symbol
      );

      const token1 = new Token(
        chainId,
        token1Data.address,
        token1Data.decimals,
        token1Data.symbol,
        token1Data.name || token1Data.symbol
      );

      // Create Pool instance
      const pool = new Pool(
        token0,
        token1,
        poolData.fee,
        poolData.sqrtPriceX96,
        poolData.liquidity,
        poolData.tick
      );

      // Convert token amounts to JSBI for the SDK
      const amount0 = token0Amount
        ? JSBI.BigInt(ethers.parseUnits(parseFloat(token0Amount).toFixed(token0Data.decimals), token0Data.decimals).toString())
        : JSBI.BigInt(0);

      const amount1 = token1Amount
        ? JSBI.BigInt(ethers.parseUnits(parseFloat(token1Amount).toFixed(token1Data.decimals), token1Data.decimals).toString())
        : JSBI.BigInt(0);

      // Create a Position instance to represent the amount we want to add
      const positionToIncreaseBy = Position.fromAmounts({
        pool,
        tickLower: position.tickLower,
        tickUpper: position.tickUpper,
        amount0,
        amount1,
        useFullPrecision: true,
      });

      // Create AddLiquidityOptions
      const addLiquidityOptions = {
        deadline: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
        slippageTolerance: new Percent(Math.floor(slippageTolerance * 100), 10_000), // Convert to SDK format
        tokenId: position.id,
      };

      // Generate the calldata using the SDK
      const { calldata, value } = NonfungiblePositionManager.addCallParameters(
        positionToIncreaseBy,
        addLiquidityOptions
      );

      // Return transaction data
      return {
        to: positionManagerAddress,
        data: calldata,
        value: value
      };
    } catch (error) {
      console.error("Error generating add liquidity data:", error);
      throw new Error(`Failed to generate add liquidity data: ${error.message}`);
    }
  }

  /**
   * Add liquidity to an existing position
   * @param {Object} params - Parameters for adding liquidity
   * @param {Object} params.position - Position object with ID and other properties
   * @param {string} params.token0Amount - Amount of token0 to add
   * @param {string} params.token1Amount - Amount of token1 to add
   * @param {Object} params.provider - Ethers provider
   * @param {string} params.address - User's wallet address
   * @param {number} params.chainId - Chain ID
   * @param {Object} params.poolData - Pool data for the position
   * @param {Object} params.token0Data - Token0 data
   * @param {Object} params.token1Data - Token1 data
   * @param {number} params.slippageTolerance - Slippage tolerance percentage
   * @param {Function} params.onStart - Callback function called when transaction starts
   * @param {Function} params.onSuccess - Callback function called on successful transaction
   * @param {Function} params.onError - Callback function called on error
   * @param {Function} params.onFinish - Callback function called when process finishes
   * @returns {Promise<Object>} Transaction receipt and updated data
   */
  async addLiquidity(params) {
    const {
      position,
      token0Amount,
      token1Amount,
      provider,
      address,
      chainId,
      poolData,
      token0Data,
      token1Data,
      slippageTolerance = 0.5,
      onStart,
      onSuccess,
      onError,
      onFinish
    } = params;

    // Input validation
    if (!provider || !address || !chainId) {
      onError && onError("Wallet not connected");
      return;
    }

    if ((!token0Amount || parseFloat(token0Amount) <= 0) &&
        (!token1Amount || parseFloat(token1Amount) <= 0)) {
      onError && onError("At least one token amount must be provided");
      return;
    }

    // Notify start of operation
    onStart && onStart();

    try {
      // Get position manager address from chain config
      const chainConfig = this.config[chainId];
      if (!chainConfig || !chainConfig.platformAddresses?.uniswapV3?.positionManagerAddress) {
        throw new Error(`No configuration found for chainId: ${chainId}`);
      }
      const positionManagerAddress = chainConfig.platformAddresses.uniswapV3.positionManagerAddress;

      // Get signer
      const signer = await provider.getSigner();

      // Create ERC20 contract instances
      const erc20Abi = [
        'function approve(address spender, uint256 amount) external returns (bool)',
        'function allowance(address owner, address spender) external view returns (uint256)'
      ];

      // Convert token amounts to wei/smallest units
      let amount0InWei = '0';
      let amount1InWei = '0';

      if (token0Amount && parseFloat(token0Amount) > 0) {
        const roundedAmount0 = parseFloat(token0Amount).toFixed(token0Data.decimals);
        amount0InWei = ethers.parseUnits(roundedAmount0, token0Data.decimals).toString();
      }

      if (token1Amount && parseFloat(token1Amount) > 0) {
        const roundedAmount1 = parseFloat(token1Amount).toFixed(token1Data.decimals);
        amount1InWei = ethers.parseUnits(roundedAmount1, token1Data.decimals).toString();
      }

      // STEP 1: Check and approve tokens
      const tokenApprovals = [];

      if (parseFloat(token0Amount) > 0) {
        const token0Contract = new ethers.Contract(token0Data.address, erc20Abi, provider);

        // Check current allowance
        const allowance0 = await token0Contract.allowance(address, positionManagerAddress);

        if (BigInt(allowance0) < BigInt(amount0InWei)) {
          // Create approval transaction
          const approveTx = await token0Contract.connect(signer).approve(
            positionManagerAddress,
            ethers.MaxUint256, // ethers v6 syntax for max uint256
            { gasLimit: 100000 }
          );

          tokenApprovals.push(approveTx.wait());
        }
      }

      if (parseFloat(token1Amount) > 0) {
        const token1Contract = new ethers.Contract(token1Data.address, erc20Abi, provider);

        // Check current allowance
        const allowance1 = await token1Contract.allowance(address, positionManagerAddress);

        if (BigInt(allowance1) < BigInt(amount1InWei)) {

          // Create approval transaction
          const approveTx = await token1Contract.connect(signer).approve(
            positionManagerAddress,
            ethers.MaxUint256, // ethers v6 syntax for max uint256
            { gasLimit: 100000 }
          );

          tokenApprovals.push(approveTx.wait());
        } else {
        }
      }

      // Wait for all approvals to complete
      if (tokenApprovals.length > 0) {
        await Promise.all(tokenApprovals);
      }

      // STEP 2: Generate transaction data for adding liquidity
      const txData = await this.generateAddLiquidityData({
        position,
        token0Amount,
        token1Amount,
        provider,
        address,
        chainId,
        poolData,
        token0Data,
        token1Data,
        slippageTolerance
      });

      // Construct transaction
      const transaction = {
        to: txData.to,
        data: txData.data,
        value: txData.value,
        from: address,
        gasLimit: 500000 // Higher gas limit for add liquidity operation
      };

      // Send transaction
      const tx = await signer.sendTransaction(transaction);
      const receipt = await tx.wait();

      // IMPORTANT: Fetch updated position data after adding liquidity
      try {
        // Get the updated position directly from the contract
        const nftManager = new ethers.Contract(
          positionManagerAddress,
          this.nonfungiblePositionManagerABI,
          provider
        );

        const poolContract = new ethers.Contract(
          position.poolAddress,
          this.uniswapV3PoolABI,
          provider
        );

        // Get the updated position directly from the contract
        const updatedPositionData = await nftManager.positions(position.id);

        // Create an updated position object that reflects the liquidity increase
        const updatedPosition = {
          ...position,
          liquidity: Number(updatedPositionData.liquidity.toString()),
          tokensOwed0: Number(updatedPositionData.tokensOwed0.toString()),
          tokensOwed1: Number(updatedPositionData.tokensOwed1.toString()),
          feeGrowthInside0LastX128: updatedPositionData.feeGrowthInside0LastX128.toString(),
          feeGrowthInside1LastX128: updatedPositionData.feeGrowthInside1LastX128.toString()
        };

        // Get fresh pool data for fee calculation
        const feeGrowthGlobal0X128 = await poolContract.feeGrowthGlobal0X128();
        const feeGrowthGlobal1X128 = await poolContract.feeGrowthGlobal1X128();

        // Update the pool data with fresh fee growth values
        const updatedPoolData = {
          ...poolData,
          feeGrowthGlobal0X128: feeGrowthGlobal0X128.toString(),
          feeGrowthGlobal1X128: feeGrowthGlobal1X128.toString()
        };

        // Call success callback with updated data
        onSuccess && onSuccess({
          success: true,
          tx: receipt,
          updatedPosition,
          updatedPoolData
        });
      } catch (updateError) {
        console.error("Error fetching updated position data:", updateError);
        // Still consider the transaction successful even if the update fails
        onSuccess && onSuccess({
          success: true,
          tx: receipt,
          warning: "Position was updated but failed to fetch new data"
        });
      }
    } catch (error) {
      console.error("Error adding liquidity:", error);

      // Provide more detailed error information based on error code
      let errorMessage = "Unknown error";

      if (error.code) {
        // Handle ethers/provider specific error codes
        switch(error.code) {
          case 4001:
            errorMessage = "Transaction rejected by user";
            break;
          case -32603:
            errorMessage = "Internal JSON-RPC error";
            break;
          default:
            errorMessage = error.message || `Error code: ${error.code}`;
        }
      } else {
        errorMessage = error.message || "Unknown error";
      }

      onError && onError(errorMessage);
    } finally {
      onFinish && onFinish();
    }
  }

  /**
   * Generate transaction data for creating a new position
   * @param {Object} params - Parameters for generating create position data
   * @param {string} params.token0Address - Address of token0
   * @param {string} params.token1Address - Address of token1
   * @param {number} params.feeTier - Fee tier (e.g., 500, 3000, 10000)
   * @param {number} params.tickLower - Lower tick of the position
   * @param {number} params.tickUpper - Upper tick of the position
   * @param {string} params.token0Amount - Amount of token0 to add
   * @param {string} params.token1Amount - Amount of token1 to add
   * @param {Object} params.provider - Ethers provider
   * @param {string} params.address - User's wallet address
   * @param {number} params.chainId - Chain ID
   * @param {number} params.slippageTolerance - Slippage tolerance percentage
   * @param {boolean} params.tokensSwapped - Whether tokens need to be swapped for Uniswap ordering
   * @returns {Object} Transaction data object with `to`, `data`, `value` properties
   * @throws {Error} If parameters are invalid or transaction data cannot be generated
   */
  async generateCreatePositionData(params) {
    const {
      token0Address,
      token1Address,
      feeTier,
      tickLower,
      tickUpper,
      token0Amount,
      token1Amount,
      provider,
      address,
      chainId,
      slippageTolerance = 0.5,
      tokensSwapped = false
    } = params;

    // Input validation
    if (!token0Address || !token1Address) {
      throw new Error("Token addresses are required");
    }

    if (!provider) {
      throw new Error("Provider is required");
    }

    if (!address) {
      throw new Error("Wallet address is required");
    }

    try {
      // Get configuration for current chain
      const chainConfig = this.config[chainId];
      if (!chainConfig || !chainConfig.platformAddresses?.uniswapV3) {
        throw new Error(`No configuration found for chainId: ${chainId}`);
      }

      const positionManagerAddress = chainConfig.platformAddresses.uniswapV3.positionManagerAddress;
      const factoryAddress = chainConfig.platformAddresses.uniswapV3.factoryAddress;

      if (!positionManagerAddress || !factoryAddress) {
        throw new Error(`Missing contract addresses for chainId: ${chainId}`);
      }

      // Step 1: Get token details
      const token0Contract = new ethers.Contract(token0Address, this.erc20ABI, provider);
      const token1Contract = new ethers.Contract(token1Address, this.erc20ABI, provider);

      const [decimals0, symbol0, name0, decimals1, symbol1, name1] = await Promise.all([
        token0Contract.decimals().then(d => Number(d)),
        token0Contract.symbol(),
        token0Contract.name(),
        token1Contract.decimals().then(d => Number(d)),
        token1Contract.symbol(),
        token1Contract.name()
      ]);

      // Step 2: Create Token instances for the SDK
      // Token constructor requires (chainId, address, decimals, symbol, name)
      const tokenA = new Token(
        chainId,
        token0Address,
        decimals0,
        symbol0,
        name0
      );

      const tokenB = new Token(
        chainId,
        token1Address,
        decimals1,
        symbol1,
        name1
      );

      // Step 3: Compute the Pool address to get Pool data
      const currentPoolAddress = Pool.getAddress(tokenA, tokenB, Number(feeTier));

      // Step 4: Create Pool contract and get pool data
      const poolContract = new ethers.Contract(
        currentPoolAddress,
        this.uniswapV3PoolABI,
        provider
      );

      let liquidity, slot0, tickSpacing;
      try {
        [liquidity, slot0, tickSpacing] = await Promise.all([
          poolContract.liquidity(),
          poolContract.slot0(),
          poolContract.tickSpacing()
        ]);
      } catch (error) {
        console.warn("Pool doesn't exist yet, using default values");
        liquidity = "0";
        slot0 = {
          sqrtPriceX96: Math.sqrt(1) * (2 ** 96),
          tick: 0
        };

        // Default tick spacing based on fee
        switch (Number(feeTier)) {
          case 100: tickSpacing = 1; break;
          case 500: tickSpacing = 10; break;
          case 3000: tickSpacing = 60; break;
          case 10000: tickSpacing = 200; break;
          default: throw new Error(`Unsupported fee tier: ${feeTier}`);
        }
      }

      // Step 5: Create the Pool instance
      const configuredPool = new Pool(
        tokenA,
        tokenB,
        Number(feeTier),
        slot0.sqrtPriceX96.toString(),
        liquidity.toString(),
        Number(slot0.tick)
      );

      // Step 6: Normalize ticks based on tickSpacing
      const normalizedTickLower = Math.floor(Number(tickLower) / Number(tickSpacing)) * Number(tickSpacing);
      const normalizedTickUpper = Math.floor(Number(tickUpper) / Number(tickSpacing)) * Number(tickSpacing);

      // Step 7: Convert token amounts to JSBI
      const amount0 = token0Amount && parseFloat(token0Amount) > 0
        ? JSBI.BigInt(ethers.parseUnits(parseFloat(token0Amount).toFixed(decimals0), decimals0).toString())
        : JSBI.BigInt(0);

      const amount1 = token1Amount && parseFloat(token1Amount) > 0
        ? JSBI.BigInt(ethers.parseUnits(parseFloat(token1Amount).toFixed(decimals1), decimals1).toString())
        : JSBI.BigInt(0);

      // Step 8: Create the Position instance
      const position = Position.fromAmounts({
        pool: configuredPool,
        tickLower: normalizedTickLower,
        tickUpper: normalizedTickUpper,
        amount0: tokensSwapped ? amount1 : amount0,
        amount1: tokensSwapped ? amount0 : amount1,
        useFullPrecision: true
      });

      // Step 9: Create mint options
      const mintOptions = {
        recipient: address,
        deadline: Math.floor(Date.now() / 1000) + 60 * 20, // 20 minutes from now
        slippageTolerance: new Percent(Math.floor(slippageTolerance * 100), 10_000),
      };

      // Step 10: Get calldata for minting
      const { calldata, value } = NonfungiblePositionManager.addCallParameters(
        position,
        mintOptions
      );

      // Return the transaction data
      return {
        to: positionManagerAddress,
        data: calldata,
        value: value,
        position: {
          token0: {
            address: tokenA.address,
            symbol: tokenA.symbol,
            decimals: tokenA.decimals
          },
          token1: {
            address: tokenB.address,
            symbol: tokenB.symbol,
            decimals: tokenB.decimals
          },
          fee: Number(feeTier),
          tickLower: normalizedTickLower,
          tickUpper: normalizedTickUpper,
          amount0: position.amount0.quotient.toString(),
          amount1: position.amount1.quotient.toString(),
          liquidity: position.liquidity.toString()
        }
      };
    } catch (error) {
      console.error("Error generating create position data:", error);
      throw new Error(`Failed to generate create position data: ${error.message}`);
    }
  }

  /**
   * Create a new liquidity position
   * @param {Object} params - Parameters for creating a new position
   * @param {string} params.token0Address - Address of token0
   * @param {string} params.token1Address - Address of token1
   * @param {number} params.feeTier - Fee tier (e.g., 500, 3000, 10000)
   * @param {number} params.tickLower - Lower tick of the position
   * @param {number} params.tickUpper - Upper tick of the position
   * @param {string} params.token0Amount - Amount of token0 to add
   * @param {string} params.token1Amount - Amount of token1 to add
   * @param {Object} params.provider - Ethers provider
   * @param {string} params.address - User's wallet address
   * @param {number} params.chainId - Chain ID
   * @param {number} params.slippageTolerance - Slippage tolerance percentage
   * @param {boolean} params.tokensSwapped - Whether tokens were swapped for correct ordering
   * @param {Function} params.onStart - Callback function called when transaction starts
   * @param {Function} params.onSuccess - Callback function called on successful transaction
   * @param {Function} params.onError - Callback function called on error
   * @param {Function} params.onFinish - Callback function called when process finishes
   * @returns {Promise<Object>} Transaction receipt and position data
   */
  async createPosition(params) {
    const {
      token0Address,
      token1Address,
      feeTier,
      tickLower,
      tickUpper,
      token0Amount,
      token1Amount,
      provider,
      address,
      chainId,
      slippageTolerance = 0.5,
      tokensSwapped = false,
      onStart,
      onSuccess,
      onError,
      onFinish
    } = params;

    // Input validation
    if (!provider || !address || !chainId) {
      onError && onError("Wallet not connected");
      return;
    }

    if (!token0Address || !token1Address) {
      onError && onError("Token addresses are required");
      return;
    }

    if ((!token0Amount || parseFloat(token0Amount) <= 0) &&
        (!token1Amount || parseFloat(token1Amount) <= 0)) {
      onError && onError("At least one token amount must be provided");
      return;
    }

    // Notify start of operation
    onStart && onStart();

    try {
      // Get position manager address from chain config
      const chainConfig = this.config[chainId];
      if (!chainConfig || !chainConfig.platformAddresses?.uniswapV3?.positionManagerAddress) {
        throw new Error(`No configuration found for chainId: ${chainId}`);
      }
      const positionManagerAddress = chainConfig.platformAddresses.uniswapV3.positionManagerAddress;

      // Get signer
      const signer = await provider.getSigner();

      // Create ERC20 contract instances
      const erc20Abi = [
        'function decimals() view returns (uint8)',
        'function symbol() view returns (string)',
        'function name() view returns (string)',
        'function approve(address spender, uint256 amount) external returns (bool)',
        'function allowance(address owner, address spender) external view returns (uint256)'
      ];

      // Determine which tokens we need to approve based on input amounts
      const needsToken0Approval = token0Amount && parseFloat(token0Amount) > 0;
      const needsToken1Approval = token1Amount && parseFloat(token1Amount) > 0;

      // Create token contracts
      const token0Contract = new ethers.Contract(token0Address, erc20Abi, provider);
      const token1Contract = new ethers.Contract(token1Address, erc20Abi, provider);

      // Get token details
      const [token0Decimals, token0Symbol, token1Decimals, token1Symbol] = await Promise.all([
        token0Contract.decimals(),
        token0Contract.symbol(),
        token1Contract.decimals(),
        token1Contract.symbol()
      ]);

      // Convert token amounts to wei/smallest units
      const amount0InWei = needsToken0Approval
        ? ethers.parseUnits(parseFloat(token0Amount).toFixed(token0Decimals), token0Decimals).toString()
        : '0';

      const amount1InWei = needsToken1Approval
        ? ethers.parseUnits(parseFloat(token1Amount).toFixed(token1Decimals), token1Decimals).toString()
        : '0';

      // STEP 1: Check and approve tokens
      const tokenApprovals = [];

      if (needsToken0Approval) {
        // Check current allowance
        const allowance0 = await token0Contract.allowance(address, positionManagerAddress);

        if (BigInt(allowance0) < BigInt(amount0InWei)) {

          // Create approval transaction
          const approveTx = await token0Contract.connect(signer).approve(
            positionManagerAddress,
            ethers.MaxUint256, // ethers v6 syntax for max uint256
            { gasLimit: 100000 }
          );

          tokenApprovals.push(approveTx.wait());
        }
      }

      if (needsToken1Approval) {
        // Check current allowance
        const allowance1 = await token1Contract.allowance(address, positionManagerAddress);

        if (BigInt(allowance1) < BigInt(amount1InWei)) {

          // Create approval transaction
          const approveTx = await token1Contract.connect(signer).approve(
            positionManagerAddress,
            ethers.MaxUint256, // ethers v6 syntax for max uint256
            { gasLimit: 100000 }
          );

          tokenApprovals.push(approveTx.wait());
        }
      }

      // Wait for all approvals to complete
      if (tokenApprovals.length > 0) {
        await Promise.all(tokenApprovals);
      }

      // STEP 2: Generate transaction data for creating the position
      const txData = await this.generateCreatePositionData({
        token0Address,
        token1Address,
        feeTier,
        tickLower,
        tickUpper,
        token0Amount,
        token1Amount,
        provider,
        address,
        chainId,
        slippageTolerance,
        tokensSwapped
      });

      // Construct transaction
      const transaction = {
        to: txData.to,
        data: txData.data,
        value: txData.value,
        from: address,
        gasLimit: 1000000 // Higher gas limit for position creation
      };

      // Send transaction
      const tx = await signer.sendTransaction(transaction);
      const receipt = await tx.wait();

      // Extract the position ID from the transaction receipt
      let positionId = null;
      try {
        // Find the Transfer event (NFT minted)
        const transferEvent = receipt.logs.find(log => {
          try {
            // A Transfer event has 3 topics: event signature + from + to
            return log.topics.length === 4 &&
                  log.topics[0] === ethers.id("Transfer(address,address,uint256)") &&
                  log.topics[1] === ethers.zeroPadValue("0x0000000000000000000000000000000000000000", 32) &&
                  log.topics[2] === ethers.zeroPadValue(address.toLowerCase(), 32);
          } catch (e) {
            return false;
          }
        });

        if (transferEvent) {
          positionId = ethers.getBigInt(transferEvent.topics[3]).toString();
        } else {
          console.warn("Could not find Transfer event in receipt");
        }
      } catch (parseError) {
        console.error("Error parsing position ID from receipt:", parseError);
      }

      // Call success callback with result
      onSuccess && onSuccess({
        success: true,
        positionId,
        tx: receipt,
        txHash: receipt.hash,
        token0: {
          address: token0Address,
          symbol: token0Symbol,
          decimals: token0Decimals
        },
        token1: {
          address: token1Address,
          symbol: token1Symbol,
          decimals: token1Decimals
        },
        fee: feeTier,
        tickLower,
        tickUpper
      });
    } catch (error) {
      console.error("Error creating position:", error);

      // Provide more detailed error information based on error code
      let errorMessage = "Unknown error";

      if (error.code) {
        // Handle ethers/provider specific error codes
        switch(error.code) {
          case 4001:
            errorMessage = "Transaction rejected by user";
            break;
          case -32603:
            errorMessage = "Internal JSON-RPC error";
            break;
          default:
            errorMessage = error.message || `Error code: ${error.code}`;
        }
      } else {
        errorMessage = error.message || "Unknown error";
      }

      onError && onError(errorMessage);
    } finally {
      onFinish && onFinish();
    }
  }

  /**
   * Generate swap transaction data for Uniswap V3
   * @param {Object} params - Parameters for swap
   * @param {string} params.tokenIn - Address of input token
   * @param {string} params.tokenOut - Address of output token  
   * @param {number} params.fee - Fee tier (500, 3000, 10000)
   * @param {string} params.recipient - Address to receive output tokens
   * @param {string} params.amountIn - Amount of input tokens (in wei)
   * @param {string} params.amountOutMinimum - Minimum amount of output tokens (in wei)
   * @param {number} params.sqrtPriceLimitX96 - Price limit (0 for no limit)
   * @param {Object} params.provider - Ethers provider
   * @param {number} params.chainId - Chain ID
   * @returns {Promise<Object>} Transaction data with to, data, and value
   * @throws {Error} If parameters are invalid or transaction data cannot be generated
   */
  async generateSwapData(params) {
    const {
      tokenIn,
      tokenOut,
      fee,
      recipient,
      amountIn,
      amountOutMinimum,
      sqrtPriceLimitX96,
      provider,
      chainId
    } = params;

    try {
      // Validate required parameters
      if (!tokenIn || !tokenOut || !fee || !recipient || !amountIn || !provider || !chainId) {
        throw new Error("Missing required parameters for swap");
      }

      // Get chain configuration
      const chainConfig = this.config[chainId];
      if (!chainConfig || !chainConfig.platformAddresses?.uniswapV3?.routerAddress) {
        throw new Error(`No Uniswap V3 router configuration found for chainId: ${chainId}`);
      }

      const routerAddress = chainConfig.platformAddresses.uniswapV3.routerAddress;

      // Create swap router interface
      const swapRouterInterface = new ethers.Interface(this.swapRouterABI);

      // Create swap parameters for exactInputSingle
      const swapParams = {
        tokenIn,
        tokenOut,
        fee,
        recipient,
        deadline: Math.floor(Date.now() / 1000) + 60 * 20, // 20 minutes from now
        amountIn,
        amountOutMinimum: amountOutMinimum || 0,
        sqrtPriceLimitX96: sqrtPriceLimitX96 || 0
      };

      // Encode the function call
      const data = swapRouterInterface.encodeFunctionData("exactInputSingle", [swapParams]);

      return {
        to: routerAddress,
        data,
        value: tokenIn.toLowerCase() === "0x0000000000000000000000000000000000000000" ? amountIn : 0
      };

    } catch (error) {
      console.error("Error generating swap data:", error);
      throw new Error(`Failed to generate swap data: ${error.message}`);
    }
  }
}
