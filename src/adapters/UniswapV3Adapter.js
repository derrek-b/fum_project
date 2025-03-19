// src/adapters/UniswapV3Adapter.js
import { ethers } from "ethers";
import { Pool } from "@uniswap/v3-sdk";
import { Token } from "@uniswap/sdk-core";
import nonfungiblePositionManagerABI from "@uniswap/v3-periphery/artifacts/contracts/NonfungiblePositionManager.sol/NonfungiblePositionManager.json" assert { type: "json" };
import IUniswapV3PoolABI from "@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Pool.sol/IUniswapV3Pool.json" assert { type: "json" };
import ERC20ABI from "@openzeppelin/contracts/build/contracts/ERC20.json" assert { type: "json" };
import PlatformAdapter from "./PlatformAdapter";
import { formatUnits } from "../utils/formatHelpers";

export default class UniswapV3Adapter extends PlatformAdapter {
  constructor(config, provider) {
    super(config, provider, "uniswapV3", "Uniswap V3");
  }

  /**
   * Calculate pool address for the given tokens and fee tier
   * @param {Object} token0 - First token object with address, decimals, symbol, name
   * @param {Object} token1 - Second token object with address, decimals, symbol, name
   * @param {number} fee - Fee tier (e.g., 500, 3000, 10000)
   * @returns {Promise<Object>} - Pool address and sorted tokens
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

    try {
      // Use the Uniswap SDK to calculate pool address
      const { Pool } = require('@uniswap/v3-sdk');
      const { Token } = require('@uniswap/sdk-core');

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
   * Check if a pool exists for the given tokens and fee tier
   * @param {Object} token0 - First token object with address and decimals
   * @param {Object} token1 - Second token object with address and decimals
   * @param {number} fee - Fee tier (e.g., 500, 3000, 10000)
   * @returns {Promise<{exists: boolean, poolAddress: string|null, slot0: Object|null}>}
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

  async getPositions(address, chainId) {
    if (!address || !this.provider || !chainId) {
      return { positions: [], poolData: {}, tokenData: {} };
    }

    try {
      // Get chain configuration
      const chainConfig = this.config.chains[chainId];
      if (!chainConfig || !chainConfig.platforms?.uniswapV3?.positionManagerAddress) {
        throw new Error(`No configuration found for chainId: ${chainId}`);
      }

      const positionManagerAddress = chainConfig.platforms.uniswapV3.positionManagerAddress;

      // Create contract instance
      const positionManager = new ethers.Contract(
        positionManagerAddress,
        nonfungiblePositionManagerABI.abi,
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
        const token0Contract = new ethers.Contract(token0, ERC20ABI.abi, this.provider);
        const token1Contract = new ethers.Contract(token1, ERC20ABI.abi, this.provider);

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
          const poolContract = new ethers.Contract(poolAddress, IUniswapV3PoolABI.abi, this.provider);

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
          const poolContract = new ethers.Contract(poolAddress, IUniswapV3PoolABI.abi, this.provider);

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
          poolAddress,
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
   * @param {Object} poolData - Pool data
   * @returns {boolean} - Whether the position is in range
   */
  isPositionInRange(position, poolData) {
    if (!poolData || !position) return false;
    const currentTick = poolData.tick;
    return currentTick >= position.tickLower && currentTick <= position.tickUpper;
  }

  /**
   * Calculate price from sqrtPriceX96
   * @param {string} sqrtPriceX96 - Square root price in X96 format
   * @param {number} decimals0 - Decimals of token0
   * @param {number} decimals1 - Decimals of token1
   * @param {boolean} invert - Whether to invert the price
   * @returns {string} - Formatted price
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
   * Helper: Calculate price from sqrtPriceX96
   * @param {string} sqrtPriceX96 - Square root price in X96 format
   * @param {number} decimals0 - Decimals of token0
   * @param {number} decimals1 - Decimals of token1
   * @param {boolean} invert - Whether to invert the price
   * @returns {string} - Formatted price
   */
  _calculatePriceFromSqrtPrice(sqrtPriceX96, decimals0, decimals1, invert = false) {
    if (!sqrtPriceX96 || sqrtPriceX96 === "0") return "N/A";

    // Convert sqrtPriceX96 to a number and calculate price
    const sqrtPriceX96AsNumber = Number(sqrtPriceX96) / (2 ** 96);
    const priceInt = sqrtPriceX96AsNumber * sqrtPriceX96AsNumber;

    // Apply decimal adjustment - must handle both positive and negative cases
    const decimalsDiff = decimals1 - decimals0;
    let price = priceInt * Math.pow(10, decimalsDiff < 0 ? -decimalsDiff : 0);

    // Invert the price if requested
    if (invert) {
      price = 1 / price;
    }

    // Format with appropriate precision
    const formattedPrice = Number.isFinite(price) ? price.toFixed(6) : "N/A";
    return formattedPrice;
  }

  /**
   * Helper: Convert a tick value to a corresponding price
   * @param {number} tick - The tick value
   * @param {number} decimals0 - Decimals of token0
   * @param {number} decimals1 - Decimals of token1
   * @param {boolean} invert - Whether to invert the price
   * @returns {string} The formatted price corresponding to the tick
   */
  _tickToPrice(tick, decimals0, decimals1, invert = false) {
    if (!Number.isFinite(tick)) return "N/A";

    // Calculate raw price using the same formula from Uniswap: 1.0001^tick
    const rawPrice = Math.pow(1.0001, tick);

    // Apply the decimal adjustment
    const decimalsDiff = decimals1 - decimals0;
    let price = rawPrice * Math.pow(10, decimalsDiff < 0 ? -decimalsDiff : 0);

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
   * @param {Object} poolData - Pool data
   * @param {Object} token0Data - Token0 data
   * @param {Object} token1Data - Token1 data
   * @returns {Object|null} - Uncollected fees or null if calculation fails
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
      tokensOwed0: BigInt(position.tokensOwed0),
      tokensOwed1: BigInt(position.tokensOwed1)
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
   * Helper: Calculate uncollected fees for a Uniswap V3 position
   * @param {Object} params - Parameters object
   * @returns {Object} Uncollected fees for token0 and token1
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
    verbose = true
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

    console.log(token0, token1)

    // Position data extraction
    const tickLowerValue = Number(position.tickLower);
    const tickUpperValue = Number(position.tickUpper);
    const liquidity = toBigInt(position.liquidity);
    const feeGrowthInside0LastX128 = toBigInt(position.feeGrowthInside0LastX128);
    const feeGrowthInside1LastX128 = toBigInt(position.feeGrowthInside1LastX128);
    const tokensOwed0 = toBigInt(position.tokensOwed0);
    const tokensOwed1 = toBigInt(position.tokensOwed1);

    if (verbose) {
      console.log(`\n=== CALCULATING UNCOLLECTED FEES ===`);
      // Verbose logging code removed for brevity
    }

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
    const returnTokens =  {
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


    console.log(returnTokens, returnTokens)

    return returnTokens

  }

  /**
   * Claim fees for a position
   * @param {Object} params - Parameters for claiming fees
   * @returns {Promise<Object>} - Transaction receipt
   */
  async claimFees(params) {
    const { position, provider, address, chainId, poolData, token0Data, token1Data, dispatch, onStart, onSuccess, onError, onFinish } = params;

    if (!provider || !address || !chainId) {
      onError && onError("Wallet not connected");
      return;
    }

    onStart && onStart();

    try {
      // Dynamically get the positionManagerAddress
      const chainConfig = this.config.chains[chainId];
      if (!chainConfig || !chainConfig.platforms?.uniswapV3?.positionManagerAddress) {
        throw new Error(`No configuration found for chainId: ${chainId}`);
      }
      const positionManagerAddress = chainConfig.platforms.uniswapV3.positionManagerAddress;

      // Get signer
      const signer = await provider.getSigner();

      // Import necessary modules
      const { NonfungiblePositionManager } = require('@uniswap/v3-sdk');
      const { CurrencyAmount, Token } = require('@uniswap/sdk-core');

      // Create contract instance to get position data
      const nftManager = new ethers.Contract(
        positionManagerAddress,
        nonfungiblePositionManagerABI.abi,
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

      // Construct transaction
      const transaction = {
        data: calldata,
        to: positionManagerAddress,
        value: value,
        from: address,
        gasLimit: 300000
      };

      // Send transaction
      const tx = await signer.sendTransaction(transaction);
      await tx.wait();

      // IMPORTANT: After claiming fees, fetch the updated position data
      try {
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

        // Also get fresh pool data for fee calculation
        const poolContract = new ethers.Contract(
          position.poolAddress,
          IUniswapV3PoolABI.abi,
          provider
        );

        const feeGrowthGlobal0X128 = await poolContract.feeGrowthGlobal0X128();
        const feeGrowthGlobal1X128 = await poolContract.feeGrowthGlobal1X128();

        // Update the pool data with fresh fee growth values
        const updatedPoolData = {
          ...poolData,
          feeGrowthGlobal0X128: feeGrowthGlobal0X128.toString(),
          feeGrowthGlobal1X128: feeGrowthGlobal1X128.toString()
        };

        if (dispatch) {
          // Import the necessary actions
          const { setPositions } = require('../redux/positionsSlice');
          const { setPools } = require('../redux/poolSlice');
          const { triggerUpdate } = require('../redux/updateSlice');

          // This is passed to the component to update Redux
          onSuccess && onSuccess({
            success: true,
            tx,
            updatedPosition,
            updatedPoolData
          });

          // Also trigger an update to refresh the UI
          dispatch(triggerUpdate());
        } else {
          onSuccess && onSuccess({ success: true, tx });
        }
      } catch (updateError) {
        console.error("Error fetching updated position data:", updateError);
        // Still consider the claim successful even if the update fails
        onSuccess && onSuccess({ success: true, tx });
      }
    } catch (error) {
      console.error("Error claiming fees:", error);
      onError && onError(error.message || "Unknown error");
    } finally {
      onFinish && onFinish();
    }
  }

  /**
   * Calculate token amounts for a position (if it were to be closed)
   * @param {Object} position - Position object
   * @param {Object} poolData - Pool data
   * @param {Object} token0Data - Token0 data
   * @param {Object} token1Data - Token1 data
   * @param {number} chainId - Chain ID from the wallet
   * @returns {Object} - Token amounts
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

      // Import required libraries from Uniswap SDK
      const { Position, Pool } = require("@uniswap/v3-sdk");
      const { Token, CurrencyAmount } = require("@uniswap/sdk-core");

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
   * Decrease liquidity for a position
   * @param {Object} params - Parameters for decreasing liquidity
   * @returns {Promise<Object>} - Transaction receipt
   */
  async decreaseLiquidity(params) {
    const {
      position,
      provider,
      address,
      chainId,
      percentage = 100,
      slippageTolerance = 0.5,
      dispatch,
      onStart,
      onFinish,
      onSuccess,
      onError
    } = params;

    if (!provider || !address || !chainId) {
      onError && onError("Wallet not connected");
      return;
    }

    onStart && onStart();

    try {
      // Get chain configuration
      const chainConfig = this.config.chains[chainId];
      if (!chainConfig || !chainConfig.platforms?.uniswapV3?.positionManagerAddress) {
        throw new Error(`No configuration found for chainId: ${chainId}`);
      }

      const positionManagerAddress = chainConfig.platforms.uniswapV3.positionManagerAddress;

      // Get signer
      const signer = await provider.getSigner();

      // Create contract instance for the position manager
      const positionManager = new ethers.Contract(
        positionManagerAddress,
        nonfungiblePositionManagerABI.abi,
        signer
      );

      // Calculate liquidity to remove based on percentage
      const liquidityToRemove = percentage === 100
        ? BigInt(position.liquidity.toString())
        : BigInt(Math.floor(position.liquidity * percentage / 100)).toString();

      console.log(`Decreasing ${percentage}% liquidity (${liquidityToRemove} of ${position.liquidity}) for position ${position.id}`);

      // Only proceed if the position has liquidity
      if (position.liquidity <= 0) {
        throw new Error("Position has no liquidity to remove");
      }

      // Calculate minimum amounts based on current amounts and slippage tolerance
      // This requires first getting the current amounts
      const { token0Data, token1Data } = params;
      let amount0Min, amount1Min;

      try {
        // Use the SDK to calculate expected amounts
        const { Position, Pool } = require("@uniswap/v3-sdk");
        const { Token } = require("@uniswap/sdk-core");

        // Create Token objects
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

        // Create Pool instance from position data
        const poolData = params.poolData;
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
          liquidity: liquidityToRemove.toString(),
          tickLower: position.tickLower,
          tickUpper: position.tickUpper
        });

        // Get expected amounts
        const amount0 = positionInstance.amount0;
        const amount1 = positionInstance.amount1;

        // Apply slippage tolerance
        const slippageFactor = 1 - slippageTolerance/100;
        amount0Min = BigInt(Math.floor(Number(amount0.quotient.toString()) * slippageFactor));
        amount1Min = BigInt(Math.floor(Number(amount1.quotient.toString()) * slippageFactor));

        console.log(`Expected amounts: ${amount0.toSignificant(6)} ${token0.symbol}, ${amount1.toSignificant(6)} ${token1.symbol}`);
        console.log(`Minimum amounts (with ${slippageTolerance}% slippage): ${amount0Min} ${token0.symbol}, ${amount1Min} ${token1.symbol}`);
      } catch (error) {
        // NO FALLBACKS - If we can't calculate minimum amounts, throw an error
        console.error("Error calculating minimum amounts:", error);
        throw new Error(`Failed to calculate minimum token amounts for safe removal: ${error.message}`);
      }

      // Create decreaseLiquidity parameters
      const decreaseLiquidityParams = {
        tokenId: position.id,
        liquidity: liquidityToRemove.toString(),
        amount0Min: amount0Min.toString(),
        amount1Min: amount1Min.toString(),
        deadline: Math.floor(Date.now() / 1000) + 60 * 20 // 20 minutes from now
      };

      // Execute liquidity decrease
      const decreaseTx = await positionManager.decreaseLiquidity(decreaseLiquidityParams);
      const decreaseReceipt = await decreaseTx.wait();
      console.log(`Liquidity decreased for position ${position.id}`);

      // After decreasing liquidity, we need to collect the tokens
      // The issue is with this collect parameters
      const collectTokensParams = {
        tokenId: position.id,
        recipient: address,
        // FIXED: Use the right parameter names
        amount0Max: BigInt("0xffffffffffffffffffffffffffffffff"),
        amount1Max: BigInt("0xffffffffffffffffffffffffffffffff")
      };

      const collectTokensTx = await positionManager.collect(collectTokensParams);
      const collectReceipt = await collectTokensTx.wait();
      console.log(`Tokens collected for position ${position.id}`);

      // Trigger update after successful transaction
      if (dispatch) {
        const { triggerUpdate } = require('../redux/updateSlice');
        dispatch(triggerUpdate());
      }

      onSuccess && onSuccess({
        decreaseReceipt,
        collectReceipt,
        percentage
      });

      return {
        decreaseReceipt,
        collectReceipt
      };
    } catch (error) {
      console.error("Error decreasing liquidity:", error);
      onError && onError(error.message || "Unknown error");
      throw error;
    } finally {
      onFinish && onFinish();
    }
  }

  /**
   * Close a position - removes liquidity and optionally burns the position NFT
   * @param {Object} params - Parameters for closing the position
   * @returns {Promise<Object>} - Transaction receipt
   */
  async closePosition(params) {
    const {
      position,
      provider,
      address,
      chainId,
      collectFees = true,
      burnPosition = true,
      dispatch,
      onStart,
      onFinish,
      onSuccess,
      onError
    } = params;

    if (!provider || !address || !chainId) {
      onError && onError("Wallet not connected");
      return;
    }

    onStart && onStart();

    try {
      // Step 1: If requested, collect any uncollected fees
      let feeReceipt = null;
      if (collectFees) {
        console.log(`Collecting fees for position ${position.id} before closing`);

        try {
          const feeResult = await this.claimFees({
            position,
            provider,
            address,
            chainId,
            poolData: params.poolData,
            token0Data: params.token0Data,
            token1Data: params.token1Data,
            dispatch
          });

          if (feeResult && feeResult.success) {
            feeReceipt = feeResult;
            console.log(`Fees collected for position ${position.id}`);
          } else {
            // If fee collection failed but we're still proceeding, log it clearly
            console.warn("Fee collection failed but continuing with position closure");
          }
        } catch (error) {
          // Don't silently continue - inform the user there was an error
          console.error(`Error collecting fees: ${error.message}`);
          throw new Error(`Fee collection failed: ${error.message}. Please try again or collect fees separately first.`);
        }
      }

      // Step 2: Remove all liquidity using our decreaseLiquidity method
      // This will fail properly if there's an issue - no fallbacks
      const liquidityResult = await this.decreaseLiquidity({
        position,
        provider,
        address,
        chainId,
        percentage: 100, // Remove all liquidity
        poolData: params.poolData,
        token0Data: params.token0Data,
        token1Data: params.token1Data,
        dispatch
      });

      console.log(`Liquidity removed for position ${position.id}`);

      // Step 3: If requested, burn the position NFT
      let burnReceipt = null;
      if (burnPosition) {
        console.log(`Burning position NFT ${position.id}`);

        const positionManagerAddress = this.config.chains[chainId].platforms.uniswapV3.positionManagerAddress;
        const signer = await provider.getSigner();
        const positionManager = new ethers.Contract(
          positionManagerAddress,
          nonfungiblePositionManagerABI.abi,
          signer
        );

        const burnTx = await positionManager.burn(position.id);
        burnReceipt = await burnTx.wait();

        console.log(`Position ${position.id} successfully burned. Transaction hash: ${burnReceipt.hash}`);
      } else {
        console.log(`Position ${position.id} closed (liquidity removed) but not burned as requested`);
      }

      // Trigger update after successful transaction
      if (dispatch) {
        const { triggerUpdate } = require('../redux/updateSlice');
        dispatch(triggerUpdate());
      }

      onSuccess && onSuccess({
        feeReceipt,
        liquidityResult,
        burnReceipt,
        fullyBurned: burnPosition
      });

      return {
        feeReceipt,
        liquidityResult,
        burnReceipt,
        fullyBurned: burnPosition
      };
    } catch (error) {
      console.error("Error closing position:", error);
      onError && onError(error.message || "Unknown error");
      throw error;
    } finally {
      onFinish && onFinish();
    }
  }

/**
 * Create a new liquidity position
 * @param {Object} params - Parameters for creating a position
 * @returns {Promise<Object>} - Transaction receipt and created position
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
    slippageTolerance = 0.5, // Default 0.5%
    provider,
    address,
    chainId,
    dispatch,
    onStart,
    onFinish,
    onSuccess,
    onError
  } = params;

  if (!provider || !address || !chainId) {
    onError && onError("Wallet not connected");
    return;
  }

  onStart && onStart();

  try {
    // Get chain configuration
    const chainConfig = this.config.chains[chainId];
    if (!chainConfig || !chainConfig.platforms?.uniswapV3?.positionManagerAddress) {
      throw new Error(`No configuration found for chainId: ${chainId}`);
    }

    const positionManagerAddress = chainConfig.platforms.uniswapV3.positionManagerAddress;

    // Get signer
    const signer = await provider.getSigner();

    // Import required libraries from Uniswap SDK
    const { NonfungiblePositionManager, Pool, Position } = require('@uniswap/v3-sdk');
    const { Token, CurrencyAmount, Percent } = require('@uniswap/sdk-core');
    const { TickMath } = require('@uniswap/v3-sdk');

    // Create contract instances for tokens
    const tokenABI = [
      'function decimals() external view returns (uint8)',
      'function symbol() external view returns (string)',
      'function name() external view returns (string)',
      'function approve(address spender, uint amount) external returns (bool)',
      'function balanceOf(address owner) external view returns (uint)'
    ];

    const token0Contract = new ethers.Contract(token0Address, tokenABI, signer);
    const token1Contract = new ethers.Contract(token1Address, tokenABI, signer);

    // Get token details
    const [
      token0Decimals,
      token0Symbol,
      token0Name,
      token0Balance,
      token1Decimals,
      token1Symbol,
      token1Name,
      token1Balance
    ] = await Promise.all([
      token0Contract.decimals(),
      token0Contract.symbol(),
      token0Contract.name(),
      token0Contract.balanceOf(address),
      token1Contract.decimals(),
      token1Contract.symbol(),
      token1Contract.name(),
      token1Contract.balanceOf(address)
    ]);

    // Create Token instances for the SDK
    const token0 = new Token(
      chainId,
      token0Address,
      Number(token0Decimals),
      token0Symbol,
      token0Name
    );

    const token1 = new Token(
      chainId,
      token1Address,
      Number(token1Decimals),
      token1Symbol,
      token1Name
    );

    // We need pool data to create a position
    // Get or create Pool instance using Factory
    const poolAddress = Pool.getAddress(token0, token1, feeTier);
    const poolContract = new ethers.Contract(
      poolAddress,
      [
        'function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
        'function liquidity() external view returns (uint128)'
      ],
      provider
    );

    // Get pool data
    const [slot0, liquidity] = await Promise.all([
      poolContract.slot0(),
      poolContract.liquidity()
    ]);

    const pool = new Pool(
      token0,
      token1,
      Number(feeTier),
      slot0.sqrtPriceX96.toString(),
      liquidity.toString(),
      Number(slot0.tick)
    );

    // Parse the amounts
    const amount0Desired = ethers.parseUnits(token0Amount, token0Decimals);
    const amount1Desired = ethers.parseUnits(token1Amount, token1Decimals);

    // Convert to CurrencyAmount
    const tokenAmount0 = CurrencyAmount.fromRawAmount(token0, amount0Desired.toString());
    const tokenAmount1 = CurrencyAmount.fromRawAmount(token1, amount1Desired.toString());

    // Create Position instance using fromAmounts method
    const position = Position.fromAmounts({
      pool,
      tickLower,
      tickUpper,
      amount0: tokenAmount0.quotient.toString(),
      amount1: tokenAmount1.quotient.toString(),
      useFullPrecision: true
    });

    // Calculate minimum amounts based on slippage tolerance
    const slippageFactor = new Percent(Math.floor(slippageTolerance * 100), 10000); // Convert to basis points

    const [amount0Min, amount1Min] = position.mintAmountsWithSlippage(slippageFactor);

    // First approve tokens
    const positionManager = new ethers.Contract(
      positionManagerAddress,
      [
        'function mint(tuple(address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline)) external payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)'
      ],
      signer
    );

    console.log("Approving tokens for position creation...");

    // Check if approval is needed
    const approvalTxs = [];

    const token0Allowance = await token0Contract.allowance(address, positionManagerAddress);
    if (token0Allowance < amount0Desired) {
      const tx0 = await token0Contract.approve(positionManagerAddress, amount0Desired);
      approvalTxs.push(tx0.wait());
    }

    const token1Allowance = await token1Contract.allowance(address, positionManagerAddress);
    if (token1Allowance < amount1Desired) {
      const tx1 = await token1Contract.approve(positionManagerAddress, amount1Desired);
      approvalTxs.push(tx1.wait());
    }

    // Wait for all approvals to complete
    if (approvalTxs.length > 0) {
      await Promise.all(approvalTxs);
      console.log("Tokens approved");
    }

    // Create mint parameters
    const mintParams = {
      token0: token0Address,
      token1: token1Address,
      fee: feeTier,
      tickLower,
      tickUpper,
      amount0Desired: amount0Desired.toString(),
      amount1Desired: amount1Desired.toString(),
      amount0Min: amount0Min.toString(),
      amount1Min: amount1Min.toString(),
      recipient: address,
      deadline: Math.floor(Date.now() / 1000) + 60 * 20 // 20 minutes
    };

    console.log("Creating position...");
    const mintTx = await positionManager.mint(mintParams, { gasLimit: 5000000 });

    console.log("Transaction sent:", mintTx.hash);
    const receipt = await mintTx.wait();
    console.log("Position created!");

    // Find the Transfer event to get the tokenId
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

    if (!transferEvent) {
      throw new Error("Transfer event not found in transaction receipt");
    }

    // Extract tokenId from the event
    const tokenId = ethers.toBigInt(transferEvent.topics[3]);
    console.log(`Successfully minted position with ID: ${tokenId}`);

    // Trigger update after successful creation
    if (dispatch) {
      const { triggerUpdate } = require('../redux/updateSlice');
      dispatch(triggerUpdate());
    }

    onSuccess && onSuccess({
      receipt,
      tokenId: tokenId.toString(),
      txHash: receipt.hash,
      token0,
      token1,
      amount0,
      amount1
    });

    return {
      receipt,
      tokenId: tokenId.toString(),
      txHash: receipt.hash
    };

  } catch (error) {
    console.error("Error creating position:", error);
    onError && onError(error.message || "Unknown error");
    throw error;
  } finally {
    onFinish && onFinish();
  }
}

/**
 * Add liquidity to an existing position
 * @param {Object} params - Parameters for adding liquidity
 * @returns {Promise<Object>} - Transaction receipt and updated position
 */
async addLiquidity(params) {
  const {
    position,
    token0Amount,
    token1Amount,
    slippageTolerance = 0.5, // Default 0.5%
    provider,
    address,
    chainId,
    dispatch,
    onStart,
    onFinish,
    onSuccess,
    onError
  } = params;

  if (!provider || !address || !chainId) {
    onError && onError("Wallet not connected");
    return;
  }

  onStart && onStart();

  try {
    // Get chain configuration
    const chainConfig = this.config.chains[chainId];
    if (!chainConfig || !chainConfig.platforms?.uniswapV3?.positionManagerAddress) {
      throw new Error(`No configuration found for chainId: ${chainId}`);
    }

    const positionManagerAddress = chainConfig.platforms.uniswapV3.positionManagerAddress;

    // Get signer
    const signer = await provider.getSigner();

    // Create contract instances
    const positionManager = new ethers.Contract(
      positionManagerAddress,
      [
        'function positions(uint256 tokenId) external view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)',
        'function increaseLiquidity(tuple(uint256 tokenId, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, uint256 deadline)) external payable returns (uint128 liquidity, uint256 amount0, uint256 amount1)'
      ],
      signer
    );

    // Get position details
    const positionInfo = await positionManager.positions(position.id);

    // Create token contract instances
    const tokenABI = [
      'function decimals() external view returns (uint8)',
      'function approve(address spender, uint amount) external returns (bool)',
      'function allowance(address owner, address spender) external view returns (uint)'
    ];

    const token0Contract = new ethers.Contract(positionInfo.token0, tokenABI, signer);
    const token1Contract = new ethers.Contract(positionInfo.token1, tokenABI, signer);

    // Get token decimals
    const token0Decimals = await token0Contract.decimals();
    const token1Decimals = await token1Contract.decimals();

    // Parse the amounts
    const amount0Desired = ethers.parseUnits(token0Amount, token0Decimals);
    const amount1Desired = ethers.parseUnits(token1Amount, token1Decimals);

    // Calculate slippage tolerance for minimum amounts
    const slippageFactor = 1 - (slippageTolerance / 100);
    const amount0Min = BigInt(Math.floor(Number(amount0Desired) * slippageFactor));
    const amount1Min = BigInt(Math.floor(Number(amount1Desired) * slippageFactor));

    // Check token approvals and approve if needed
    const approvalTxs = [];

    const token0Allowance = await token0Contract.allowance(address, positionManagerAddress);
    if (token0Allowance < amount0Desired) {
      const tx0 = await token0Contract.approve(positionManagerAddress, amount0Desired);
      approvalTxs.push(tx0.wait());
    }

    const token1Allowance = await token1Contract.allowance(address, positionManagerAddress);
    if (token1Allowance < amount1Desired) {
      const tx1 = await token1Contract.approve(positionManagerAddress, amount1Desired);
      approvalTxs.push(tx1.wait());
    }

    // Wait for all approvals to complete
    if (approvalTxs.length > 0) {
      await Promise.all(approvalTxs);
      console.log("Tokens approved");
    }

    // Create increaseLiquidity parameters
    const increaseLiquidityParams = {
      tokenId: position.id,
      amount0Desired: amount0Desired.toString(),
      amount1Desired: amount1Desired.toString(),
      amount0Min: amount0Min.toString(),
      amount1Min: amount1Min.toString(),
      deadline: Math.floor(Date.now() / 1000) + 60 * 20 // 20 minutes
    };

    console.log("Increasing liquidity for position", position.id);
    const increaseTx = await positionManager.increaseLiquidity(increaseLiquidityParams, { gasLimit: 5000000 });

    console.log("Transaction sent:", increaseTx.hash);
    const receipt = await increaseTx.wait();
    console.log("Liquidity increased!");

    // Trigger update after successful addition
    if (dispatch) {
      const { triggerUpdate } = require('../redux/updateSlice');
      dispatch(triggerUpdate());
    }

    onSuccess && onSuccess({
      receipt,
      txHash: receipt.hash,
      tokenId: position.id,
      increased: true
    });

    return {
      receipt,
      txHash: receipt.hash,
      tokenId: position.id
    };

  } catch (error) {
    console.error("Error adding liquidity:", error);
    onError && onError(error.message || "Unknown error");
    throw error;
  } finally {
    onFinish && onFinish();
  }
}
}
