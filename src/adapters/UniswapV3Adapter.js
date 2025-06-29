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
import { getPlatformFeeTiers } from "../helpers/platformHelpers.js";
import { getPlatformAddresses, getChainConfig } from "../helpers/chainHelpers.js";
import { getTokensForChain } from "../helpers/tokenHelpers.js";
import { Position, Pool, NonfungiblePositionManager, tickToPrice, TickMath } from '@uniswap/v3-sdk';
import { Percent, Token, CurrencyAmount, Price } from '@uniswap/sdk-core';
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
 *
 * This adapter is designed for single-chain operation and caches all necessary
 * configuration data during construction for optimal performance:
 * - Platform contract addresses (factory, position manager, router)
 * - Supported fee tiers and chain configuration
 * - Token lookup maps for fast address/symbol resolution
 * - Pre-compiled contract interfaces for transaction encoding
 *
 * Note: Methods requiring blockchain interaction accept a provider parameter
 * rather than storing one in the adapter instance.
 *
 * @example
 * // Create adapter for Arbitrum
 * const adapter = new UniswapV3Adapter(42161);
 *
 * // Get pool address (no blockchain calls)
 * const poolAddress = await adapter.getPoolAddress(token0, token1, 500, provider);
 *
 * // Get live pool data (makes blockchain calls)
 * const poolData = await adapter.fetchPoolData(token0, token1, 500, 42161, provider);
 */
export default class UniswapV3Adapter extends PlatformAdapter {
  /**
   * Constructor
   * @param {number} chainId - Chain ID for the adapter
   */
  constructor(chainId) {
    super(chainId, "uniswapV3", "Uniswap V3");

    // Cache platform addresses
    this.addresses = getPlatformAddresses(chainId, "uniswapV3");
    if (!this.addresses || !this.addresses.enabled) {
      throw new Error(`Uniswap V3 not available on chain ${chainId}`);
    }

    // Cache platform configuration data
    this.feeTiers = getPlatformFeeTiers("uniswapV3");
    this.chainConfig = getChainConfig(chainId);

    // Store the imported ABIs
    this.nonfungiblePositionManagerABI = NonfungiblePositionManagerABI;
    this.uniswapV3PoolABI = IUniswapV3PoolABI;
    this.swapRouterABI = SwapRouterABI;
    this.erc20ABI = ERC20ABI;

    // Pre-create contract interfaces for better performance
    this.swapRouterInterface = new ethers.Interface(this.swapRouterABI);
    this.positionManagerInterface = new ethers.Interface(this.nonfungiblePositionManagerABI);
    this.poolInterface = new ethers.Interface(this.uniswapV3PoolABI);
    this.erc20Interface = new ethers.Interface(this.erc20ABI);

  }

  /**
   * Validate and normalize slippage tolerance
   * @param {number} slippageTolerance - Slippage tolerance percentage (0-100)
   * @returns {number} Validated slippage tolerance
   * @throws {Error} If slippage tolerance is invalid
   */
  _validateSlippageTolerance(slippageTolerance) {
    if (typeof slippageTolerance !== 'number' || isNaN(slippageTolerance) || slippageTolerance < 0 || slippageTolerance > 100) {
      throw new Error(`Invalid slippage tolerance: ${slippageTolerance}. Must be between 0 and 100.`);
    }

    return slippageTolerance;
  }

  /**
   * Create deadline timestamp from minutes offset
   * @param {number} deadlineMinutes - Minutes from now
   * @returns {number} Unix timestamp
   * @throws {Error} If deadlineMinutes is invalid
   */
  _createDeadline(deadlineMinutes) {
    if (typeof deadlineMinutes !== 'number' || isNaN(deadlineMinutes) || deadlineMinutes < 0) {
      throw new Error(`Invalid deadline minutes: ${deadlineMinutes}. Must be a non-negative number.`);
    }

    return Math.floor(Date.now() / 1000) + (deadlineMinutes * 60);
  }

  /**
   * Estimate gas for a transaction with buffer
   * @param {ethers.Contract} contract - Contract instance
   * @param {string} method - Method name
   * @param {Array} args - Method arguments
   * @param {Object} [overrides] - Transaction overrides
   * @returns {Promise<number>} Estimated gas limit
   * @throws {Error} If gas estimation fails (indicating transaction would likely revert)
   */
  async _estimateGas(contract, method, args, overrides = {}) {
    // Validate inputs
    if (!contract || typeof contract !== 'object') {
      throw new Error('Invalid contract instance');
    }

    if (!method || typeof method !== 'string') {
      throw new Error('Method must be a non-empty string');
    }

    if (!contract[method] || typeof contract[method].estimateGas !== 'function') {
      throw new Error(`Method '${method}' does not exist or cannot estimate gas`);
    }

    if (!Array.isArray(args)) {
      throw new Error('Args must be an array');
    }

    if (overrides !== undefined && (typeof overrides !== 'object' || overrides === null)) {
      throw new Error('Overrides must be an object if provided');
    }

    try {
      const estimatedGas = await contract[method].estimateGas(...args, overrides);
      return Number(estimatedGas);
    } catch (error) {
      // In DeFi, gas estimation failure usually means transaction will revert
      // Better to fail fast than waste user's money on a doomed transaction
      throw new Error(
        `Gas estimation failed for ${method}. This usually indicates the transaction would revert. ` +
        `Possible causes: insufficient balance, excessive slippage, or invalid parameters. ` +
        `Original error: ${error.message}`
      );
    }
  }

  /**
   * Estimate gas from transaction data with buffer
   * @param {ethers.Signer} signer - Signer instance
   * @param {Object} txData - Transaction data object
   * @returns {Promise<number>} Estimated gas limit
   * @throws {Error} If gas estimation fails (indicating transaction would likely revert)
   */
  async _estimateGasFromTxData(signer, txData) {
    // Validate signer
    if (!signer || typeof signer !== 'object') {
      throw new Error('Invalid signer instance');
    }

    if (typeof signer.estimateGas !== 'function') {
      throw new Error('Signer must have estimateGas method');
    }

    // Validate txData
    if (!txData || typeof txData !== 'object') {
      throw new Error('Transaction data must be an object');
    }

    // Require 'to' field for all transactions
    if (txData.to === null || txData.to === undefined) {
      throw new Error("Transaction data must include 'to' field");
    }

    // Validate 'to' address format
    try {
      ethers.getAddress(txData.to); // This will throw if invalid
    } catch (error) {
      throw new Error(`Invalid 'to' address: ${txData.to}`);
    }

    // Validate data field if provided
    if (txData.data !== undefined && typeof txData.data !== 'string') {
      throw new Error('Transaction data field must be a string');
    }

    // Validate value field if provided
    if (txData.value !== undefined && typeof txData.value !== 'bigint' && typeof txData.value !== 'string' && typeof txData.value !== 'number') {
      throw new Error('Transaction value must be a valid bigint, string, or number');
    }

    try {
      const estimatedGas = await signer.estimateGas(txData);
      return Number(estimatedGas);
    } catch (error) {
      // In DeFi, gas estimation failure usually means transaction will revert
      // Better to fail fast than waste user's money on a doomed transaction
      throw new Error(
        `Gas estimation failed. This usually indicates the transaction would revert. ` +
        `Possible causes: insufficient balance, excessive slippage, insufficient allowance, or invalid parameters. ` +
        `Original error: ${error.message}`
      );
    }
  }


  /**
   * Create standardized slippage tolerance Percent object
   * @param {number} slippageTolerance - Slippage tolerance percentage
   * @returns {Percent} Uniswap SDK Percent object
   */
  _createSlippagePercent(slippageTolerance) {
    const validatedSlippage = this._validateSlippageTolerance(slippageTolerance);
    return new Percent(Math.floor(validatedSlippage * 100), 10_000);
  }

  /**
   * Sort tokens according to Uniswap V3 rules (lower address first)
   * @param {Object} token0 - First token object
   * @param {string} token0.address - Token contract address
   * @param {Object} token1 - Second token object  
   * @param {string} token1.address - Token contract address
   * @returns {{sortedToken0: Object, sortedToken1: Object, tokensSwapped: boolean}} Sorted tokens and swap flag
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

  /**
   * Get chain ID from provider (ethers v6)
   * @param {Object} provider - Ethers provider instance
   * @returns {Promise<number>} Chain ID as number
   * @throws {Error} If provider is invalid or network fetch fails
   */
  async getChainId(provider) {
    if (!provider || typeof provider.getNetwork !== 'function') {
      throw new Error('Invalid provider - must have getNetwork method');
    }

    try {
      const network = await provider.getNetwork();
      
      if (!network || network.chainId === undefined) {
        throw new Error('Provider returned invalid network data');
      }

      // In ethers v6, chainId is always a bigint
      const chainId = Number(network.chainId);

      if (!chainId || chainId <= 0) {
        throw new Error(`Invalid chainId received: ${chainId}`);
      }

      return chainId;
    } catch (error) {
      throw new Error(`Failed to get chainId from provider: ${error.message}`);
    }
  }

  /**
   * Calculate pool address for the given tokens and fee tier
   * @param {Object} token0 - First token object
   * @param {string} token0.address - Token contract address
   * @param {number} token0.decimals - Token decimals
   * @param {Object} token1 - Second token object
   * @param {string} token1.address - Token contract address  
   * @param {number} token1.decimals - Token decimals
   * @param {number} fee - Fee tier (e.g., 500, 3000, 10000)
   * @param {Object} provider - Ethers provider instance
   * @returns {Promise<string>} Pool contract address
   */
  async getPoolAddress(token0, token1, fee, provider) {
    if (!token0?.address || !token1?.address || fee === undefined ||
        token0.decimals === undefined || token1.decimals === undefined) {
      throw new Error("Missing required token information for pool address calculation");
    }

    // Sort tokens according to Uniswap V3 rules
    const { sortedToken0, sortedToken1, tokensSwapped } = this.sortTokens(token0, token1);

    // Get chainId from provider
    const chainId = await this.getChainId(provider);

    try {      // Use the Uniswap SDK to calculate pool address

      const sdkToken0 = new Token(
        chainId,
        sortedToken0.address,
        sortedToken0.decimals
      );

      const sdkToken1 = new Token(
        chainId,
        sortedToken1.address,
        sortedToken1.decimals
      );

      const poolAddress = Pool.getAddress(sdkToken0, sdkToken1, fee);

      return poolAddress;
    } catch (error) {
      throw new Error(`Failed to calculate pool address: ${error.message}`);
    }
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
   * @param {Object} provider - Ethers provider instance
   * @returns {Promise<{exists: boolean, poolAddress: string|null, slot0: Object|null}>} Pool existence check result
   */
  async checkPoolExists(token0, token1, fee, provider) {
    try {
      const poolAddress = await this.getPoolAddress(token0, token1, fee, provider);

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
   * Get position manager contract instance for a given chain
   * @param {number} chainId - Chain ID
   * @returns {Promise<ethers.Contract>} Position manager contract instance
   * @private
   */
  async _getPositionManager(chainId) {
    const chainConfig = this.config[chainId];
    if (!chainConfig || !chainConfig.platformAddresses?.uniswapV3?.positionManagerAddress) {
      throw new Error(`No configuration found for chainId: ${chainId}`);
    }

    const positionManagerAddress = chainConfig.platformAddresses.uniswapV3.positionManagerAddress;

    return new ethers.Contract(
      positionManagerAddress,
      this.nonfungiblePositionManagerABI,
      this.provider
    );
  }

  /**
   * Fetch user's position token IDs
   * @param {string} address - User's wallet address
   * @param {ethers.Contract} positionManager - Position manager contract
   * @returns {Promise<string[]>} Array of position token IDs
   * @private
   */
  async _fetchUserPositionIds(address, positionManager) {
    const balance = await positionManager.balanceOf(address);
    const tokenIds = [];

    for (let i = 0; i < balance; i++) {
      const tokenId = await positionManager.tokenOfOwnerByIndex(address, i);
      tokenIds.push(String(tokenId));
    }

    return tokenIds;
  }

  /**
   * Fetch token metadata and user balances
   * @param {string} token0Address - Token0 contract address
   * @param {string} token1Address - Token1 contract address
   * @param {string} userAddress - User's wallet address
   * @param {number} chainId - Chain ID
   * @returns {Promise<{token0Data: Object, token1Data: Object}>} Token metadata and balances
   */
  async fetchTokenData(token0Address, token1Address, userAddress, chainId) {
    if (!token0Address || !token1Address || !userAddress || !chainId) {
      throw new Error("Missing required parameters for token data fetch");
    }

    const token0Contract = new ethers.Contract(token0Address, this.erc20ABI, this.provider);
    const token1Contract = new ethers.Contract(token1Address, this.erc20ABI, this.provider);

    let token0Data, token1Data;

    try {
      const [decimals0, name0, symbol0, balance0] = await Promise.all([
        token0Contract.decimals(),
        token0Contract.name(),
        token0Contract.symbol(),
        token0Contract.balanceOf(userAddress),
      ]);

      token0Data = {
        address: token0Address,
        decimals: Number(decimals0),
        name: name0,
        symbol: symbol0,
        balance: Number(ethers.formatUnits(balance0, Number(decimals0))),
        chainId
      };
    } catch (err) {
      console.error("Error retrieving token0 data:", err);
      throw new Error(`Failed to fetch token0 data: ${err.message}`);
    }

    try {
      const [decimals1, name1, symbol1, balance1] = await Promise.all([
        token1Contract.decimals(),
        token1Contract.name(),
        token1Contract.symbol(),
        token1Contract.balanceOf(userAddress),
      ]);

      token1Data = {
        address: token1Address,
        decimals: Number(decimals1),
        name: name1,
        symbol: symbol1,
        balance: Number(ethers.formatUnits(balance1, Number(decimals1))),
        chainId
      };
    } catch (err) {
      console.error("Error retrieving token1 data:", err);
      throw new Error(`Failed to fetch token1 data: ${err.message}`);
    }

    return { token0Data, token1Data };
  }

  /**
   * Fetch pool state data
   * @param {Object} token0 - Token0 data object
   * @param {Object} token1 - Token1 data object
   * @param {number} fee - Pool fee tier
   * @param {number} chainId - Chain ID
   * @returns {Promise<Object>} Pool state data
   */
  async fetchPoolData(token0, token1, fee, chainId, provider) {
    if (!token0?.address || !token1?.address || !fee || !chainId) {
      throw new Error("Missing required parameters for pool data fetch");
    }

    // Create Token instances for pool address calculation
    const token0Instance = new Token(chainId, token0.address, token0.decimals, token0.symbol, token0.name);
    const token1Instance = new Token(chainId, token1.address, token1.decimals, token1.symbol, token1.name);

    // Calculate pool address
    const feeNumber = Number(fee);
    const poolAddress = Pool.getAddress(token0Instance, token1Instance, feeNumber);

    // Create pool contract
    const poolContract = new ethers.Contract(poolAddress, this.uniswapV3PoolABI, provider);

    try {
      const slot0 = await poolContract.slot0();
      const observationIndex = Number(slot0[2]);
      const lastObservation = await poolContract.observations(observationIndex);
      const protocolFees = await poolContract.protocolFees();

      return {
        poolAddress,
        token0,
        token1,
        sqrtPriceX96: slot0[0].toString(),
        tick: Number(slot0[1]),
        observationIndex: Number(slot0[2]),
        observationCardinality: Number(slot0[3]),
        observationCardinalityNext: Number(slot0[4]),
        feeProtocol: Number(slot0[5]),
        unlocked: slot0[6],
        liquidity: (await poolContract.liquidity()).toString(),
        feeGrowthGlobal0X128: (await poolContract.feeGrowthGlobal0X128()).toString(),
        feeGrowthGlobal1X128: (await poolContract.feeGrowthGlobal1X128()).toString(),
        protocolFeeToken0: protocolFees[0].toString(),
        protocolFeeToken1: protocolFees[1].toString(),
        tickSpacing: Number(await poolContract.tickSpacing()),
        fee: Number(await poolContract.fee()),
        maxLiquidityPerTick: (await poolContract.maxLiquidityPerTick()).toString(),
        lastObservation: {
          blockTimestamp: Number(lastObservation.blockTimestamp),
          tickCumulative: lastObservation.tickCumulative.toString(),
          secondsPerLiquidityCumulativeX128: lastObservation.secondsPerLiquidityCumulativeX128.toString(),
          initialized: lastObservation.initialized,
        },
        ticks: {} // Will be populated by fetchTickData
      };
    } catch (error) {
      throw new Error(`Failed to fetch pool data: ${error.message}`);
    }
  }

  /**
   * Fetch tick-specific data for fee calculations
   * @param {string} poolAddress - Pool contract address
   * @param {number} tickLower - Lower tick of the position
   * @param {number} tickUpper - Upper tick of the position
   * @returns {Promise<{tickLower: Object, tickUpper: Object}>} Tick data
   */
  async fetchTickData(poolAddress, tickLower, tickUpper) {
    if (!poolAddress || tickLower === undefined || tickUpper === undefined) {
      throw new Error("Missing required parameters for tick data fetch");
    }

    const poolContract = new ethers.Contract(poolAddress, this.uniswapV3PoolABI, this.provider);

    try {
      const [lowerTickData, upperTickData] = await Promise.all([
        poolContract.ticks(tickLower),
        poolContract.ticks(tickUpper)
      ]);

      return {
        tickLower: {
          liquidityGross: lowerTickData.liquidityGross.toString(),
          liquidityNet: lowerTickData.liquidityNet.toString(),
          feeGrowthOutside0X128: lowerTickData.feeGrowthOutside0X128.toString(),
          feeGrowthOutside1X128: lowerTickData.feeGrowthOutside1X128.toString(),
          tickCumulativeOutside: lowerTickData.tickCumulativeOutside.toString(),
          secondsPerLiquidityOutsideX128: lowerTickData.secondsPerLiquidityOutsideX128.toString(),
          secondsOutside: Number(lowerTickData.secondsOutside),
          initialized: lowerTickData.initialized,
        },
        tickUpper: {
          liquidityGross: upperTickData.liquidityGross.toString(),
          liquidityNet: upperTickData.liquidityNet.toString(),
          feeGrowthOutside0X128: upperTickData.feeGrowthOutside0X128.toString(),
          feeGrowthOutside1X128: upperTickData.feeGrowthOutside1X128.toString(),
          tickCumulativeOutside: upperTickData.tickCumulativeOutside.toString(),
          secondsPerLiquidityOutsideX128: upperTickData.secondsPerLiquidityOutsideX128.toString(),
          secondsOutside: Number(upperTickData.secondsOutside),
          initialized: upperTickData.initialized,
        }
      };
    } catch (error) {
      throw new Error(`Failed to fetch tick data: ${error.message}`);
    }
  }

  /**
   * Assemble position data from contract data and cached pool/token data
   * @param {string} tokenId - Position token ID
   * @param {Object} positionData - Raw position data from contract
   * @param {Object} poolDataMap - Cached pool data
   * @param {Object} tokenDataMap - Cached token data
   * @returns {Object} Assembled position object
   * @private
   */
  _assemblePositionData(tokenId, positionData, poolDataMap, tokenDataMap) {
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

    const token0Data = tokenDataMap[token0];
    const token1Data = tokenDataMap[token1];
    const tokenPair = `${token0Data.symbol}/${token1Data.symbol}`;

    // Get pool address
    const token0Instance = new Token(token0Data.chainId, token0, token0Data.decimals, token0Data.symbol);
    const token1Instance = new Token(token1Data.chainId, token1, token1Data.decimals, token1Data.symbol);
    const poolAddress = Pool.getAddress(token0Instance, token1Instance, Number(fee));

    return {
      id: String(tokenId),
      tokenPair,
      pool: poolAddress,
      nonce: Number(nonce),
      operator,
      fee: Number(fee),
      tickLower: Number(tickLower),
      tickUpper: Number(tickUpper),
      liquidity: liquidity.toString(),
      feeGrowthInside0LastX128: feeGrowthInside0LastX128.toString(),
      feeGrowthInside1LastX128: feeGrowthInside1LastX128.toString(),
      tokensOwed0: tokensOwed0.toString(),
      tokensOwed1: tokensOwed1.toString(),
      platform: this.platformId,
      platformName: this.platformName
    };
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
      // Get position manager contract
      const positionManager = await this._getPositionManager(chainId);

      // Fetch user's position token IDs
      const tokenIds = await this._fetchUserPositionIds(address, positionManager);

      if (tokenIds.length === 0) {
        return { positions: [], poolData: {}, tokenData: {} };
      }

      const positions = [];
      const poolDataMap = {};
      const tokenDataMap = {};

      // Process each position
      for (const tokenId of tokenIds) {
        try {
          // Get position data from contract
          const positionData = await positionManager.positions(tokenId);
          const { token0, token1, fee, tickLower, tickUpper } = positionData;

          // Fetch token data if not cached
          if (!tokenDataMap[token0] || !tokenDataMap[token1]) {
            const { token0Data, token1Data } = await this.fetchTokenData(token0, token1, address, chainId);

            if (!tokenDataMap[token0]) {
              tokenDataMap[token0] = token0Data;
            }
            if (!tokenDataMap[token1]) {
              tokenDataMap[token1] = token1Data;
            }
          }

          // Get pool address and fetch pool data if not cached
          const token0Data = tokenDataMap[token0];
          const token1Data = tokenDataMap[token1];
          const token0Instance = new Token(chainId, token0, token0Data.decimals, token0Data.symbol);
          const token1Instance = new Token(chainId, token1, token1Data.decimals, token1Data.symbol);
          const poolAddress = Pool.getAddress(token0Instance, token1Instance, Number(fee));

          if (!poolDataMap[poolAddress]) {
            const poolData = await this.fetchPoolData(token0Data, token1Data, fee, chainId);
            poolDataMap[poolAddress] = poolData;
          }

          // Fetch tick data if not already present
          const poolData = poolDataMap[poolAddress];
          if (!poolData.ticks[tickLower] || !poolData.ticks[tickUpper]) {
            const tickData = await this.fetchTickData(poolAddress, tickLower, tickUpper);
            poolData.ticks[tickLower] = tickData.tickLower;
            poolData.ticks[tickUpper] = tickData.tickUpper;
          }

          // Assemble position data
          const position = this._assemblePositionData(tokenId, positionData, poolDataMap, tokenDataMap);
          positions.push(position);

        } catch (error) {
          console.error(`Error processing position ${tokenId}:`, error);
          // Continue with other positions even if one fails
        }
      }

      return {
        positions,
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
   * Calculate price from sqrtPriceX96 using the Uniswap V3 SDK
   * @param {string} sqrtPriceX96 - Square root price in X96 format
   * @param {Object} baseToken - Base token (token0 unless inverted)
   * @param {string} baseToken.address - Token address
   * @param {number} baseToken.decimals - Token decimals
   * @param {string} baseToken.symbol - Token symbol
   * @param {Object} quoteToken - Quote token (token1 unless inverted)
   * @param {string} quoteToken.address - Token address
   * @param {number} quoteToken.decimals - Token decimals
   * @param {string} quoteToken.symbol - Token symbol
   * @param {number} chainId - Chain ID
   * @returns {string} Formatted price
   */
  calculatePriceFromSqrtPrice(sqrtPriceX96, baseToken, quoteToken, chainId) {
    if (!sqrtPriceX96 || sqrtPriceX96 === "0") {
      throw new Error("Invalid sqrtPriceX96 value");
    }

    if (!baseToken?.address || !quoteToken?.address || !chainId) {
      throw new Error("Missing required token information or chainId");
    }

    try {
      // Create Token instances
      const base = new Token(
        chainId,
        baseToken.address,
        baseToken.decimals,
        baseToken.symbol || "",
        baseToken.name || ""
      );

      const quote = new Token(
        chainId,
        quoteToken.address,
        quoteToken.decimals,
        quoteToken.symbol || "",
        quoteToken.name || ""
      );

      // Convert sqrtPriceX96 to JSBI if needed
      const sqrtRatioX96 = JSBI.BigInt(sqrtPriceX96.toString());

      // Get the tick at this sqrt ratio
      const tick = TickMath.getTickAtSqrtRatio(sqrtRatioX96);

      // Use SDK's tickToPrice to get the price
      const price = tickToPrice(base, quote, tick);

      // Return formatted price with appropriate precision
      return price.toFixed(6);
    } catch (error) {
      console.error("Error calculating price from sqrtPriceX96:", error);
      throw new Error(`Failed to calculate price: ${error.message}`);
    }
  }

  /**
   * Convert a tick value to a corresponding price using the Uniswap V3 SDK
   * @param {number} tick - The tick value
   * @param {Object} baseToken - Base token (token0 unless inverted)
   * @param {string} baseToken.address - Token address
   * @param {number} baseToken.decimals - Token decimals
   * @param {string} baseToken.symbol - Token symbol
   * @param {Object} quoteToken - Quote token (token1 unless inverted)
   * @param {string} quoteToken.address - Token address
   * @param {number} quoteToken.decimals - Token decimals
   * @param {string} quoteToken.symbol - Token symbol
   * @param {number} chainId - Chain ID
   * @returns {string} The formatted price corresponding to the tick
   */
  tickToPrice(tick, baseToken, quoteToken, chainId) {
    if (!Number.isFinite(tick)) {
      throw new Error("Invalid tick value");
    }

    if (!baseToken?.address || !quoteToken?.address || !chainId) {
      throw new Error("Missing required token information or chainId");
    }

    try {
      // Create Token instances
      const base = new Token(
        chainId,
        baseToken.address,
        baseToken.decimals,
        baseToken.symbol || "",
        baseToken.name || ""
      );

      const quote = new Token(
        chainId,
        quoteToken.address,
        quoteToken.decimals,
        quoteToken.symbol || "",
        quoteToken.name || ""
      );

      // Use SDK's tickToPrice function
      const price = tickToPrice(base, quote, tick);

      // Format based on value
      const priceNumber = parseFloat(price.toFixed(10));
      if (priceNumber < 0.0001) return "< 0.0001";
      if (priceNumber > 1000000) return priceNumber.toLocaleString(undefined, { maximumFractionDigits: 0 });

      // Return with appropriate precision
      return price.toFixed(6);
    } catch (error) {
      console.error("Error converting tick to price:", error);
      throw new Error(`Failed to convert tick to price: ${error.message}`);
    }
  }


  /**
   * Calculate uncollected fees for a Uniswap V3 position
   *
   * This method implements the Uniswap V3 fee calculation logic, which requires
   * on-chain data that the SDK doesn't fetch. The calculation accounts for:
   * - Global fee growth since the position was last updated
   * - Fee growth inside/outside the position's price range
   * - The position's liquidity and tick range
   *
   * @param {Object} position - Position data
   * @param {string|number|bigint} position.liquidity - Position liquidity
   * @param {string|number|bigint} position.feeGrowthInside0LastX128 - Fee growth inside for token0 at last action
   * @param {string|number|bigint} position.feeGrowthInside1LastX128 - Fee growth inside for token1 at last action
   * @param {number} position.tickLower - Lower tick of the position
   * @param {number} position.tickUpper - Upper tick of the position
   * @param {string|number|bigint} position.tokensOwed0 - Already accumulated fees for token0
   * @param {string|number|bigint} position.tokensOwed1 - Already accumulated fees for token1
   * @param {Object} poolData - Current pool state data
   * @param {number} poolData.tick - Current pool tick
   * @param {string} poolData.feeGrowthGlobal0X128 - Current global fee growth for token0
   * @param {string} poolData.feeGrowthGlobal1X128 - Current global fee growth for token1
   * @param {Object} poolData.ticks - Object containing tick data for the position's ticks
   * @param {Object} poolData.ticks[tickLower] - Lower tick data with feeGrowthOutside values
   * @param {Object} poolData.ticks[tickUpper] - Upper tick data with feeGrowthOutside values
   * @param {number} token0Decimals - Token0 decimals for formatting
   * @param {number} token1Decimals - Token1 decimals for formatting
   * @returns {{token0: {raw: bigint, formatted: string}, token1: {raw: bigint, formatted: string}}} Uncollected fees
   * @throws {Error} If required pool or token data is missing
   */
  calculateUncollectedFees(position, poolData, token0Decimals, token1Decimals) {
    // Validate inputs
    if (!poolData || !poolData.feeGrowthGlobal0X128 || !poolData.feeGrowthGlobal1X128) {
      throw new Error("Missing required pool data for fee calculation");
    }

    if (!poolData.ticks || !poolData.ticks[position.tickLower] || !poolData.ticks[position.tickUpper]) {
      throw new Error("Missing required tick data for fee calculation");
    }

    if (typeof token0Decimals !== 'number' || typeof token1Decimals !== 'number') {
      throw new Error("Missing token decimal information for fee calculation");
    }

    const tickLower = poolData.ticks[position.tickLower];
    const tickUpper = poolData.ticks[position.tickUpper];

    // Internal calculation with all parameters
    return this._calculateUncollectedFeesInternal({
      position,
      currentTick: poolData.tick,
      feeGrowthGlobal0X128: poolData.feeGrowthGlobal0X128,
      feeGrowthGlobal1X128: poolData.feeGrowthGlobal1X128,
      tickLower,
      tickUpper,
      token0Decimals,
      token1Decimals
    });
  }

  /**
   * Internal implementation of fee calculation logic
   * @private
   */
  _calculateUncollectedFeesInternal({
    position,
    currentTick,
    feeGrowthGlobal0X128,
    feeGrowthGlobal1X128,
    tickLower,
    tickUpper,
    token0Decimals,
    token1Decimals,
  }) {
    // Position data extraction
    const tickLowerValue = Number(position.tickLower);
    const tickUpperValue = Number(position.tickUpper);
    const liquidity = BigInt(position.liquidity);
    const feeGrowthInside0LastX128 = BigInt(position.feeGrowthInside0LastX128);
    const feeGrowthInside1LastX128 = BigInt(position.feeGrowthInside1LastX128);
    const tokensOwed0 = BigInt(position.tokensOwed0);
    const tokensOwed1 = BigInt(position.tokensOwed1);

    // Ensure we have tick data
    if (!tickLower || !tickUpper) {
      throw new Error("Required tick data is missing for fee calculation");
    }

    const lowerTickData = {
      feeGrowthOutside0X128: tickLower ? BigInt(tickLower.feeGrowthOutside0X128) : 0n,
      feeGrowthOutside1X128: tickLower ? BigInt(tickLower.feeGrowthOutside1X128) : 0n,
      initialized: tickLower ? Boolean(tickLower.initialized) : false
    };

    const upperTickData = {
      feeGrowthOutside0X128: tickUpper ? BigInt(tickUpper.feeGrowthOutside0X128) : 0n,
      feeGrowthOutside1X128: tickUpper ? BigInt(tickUpper.feeGrowthOutside1X128) : 0n,
      initialized: tickUpper ? Boolean(tickUpper.initialized) : false
    };

    // Convert global fee growth to BigInt
    const feeGrowthGlobal0X128BigInt = BigInt(feeGrowthGlobal0X128);
    const feeGrowthGlobal1X128BigInt = BigInt(feeGrowthGlobal1X128);

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
    const { position, provider, address, chainId, poolData, token0Data, token1Data, gasMultiplier = 1.1, onStart, onSuccess, onError, onFinish } = params;

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

      // Estimate gas using the transaction data
      const gasEstimate = await this._estimateGasFromTxData(
        signer,
        {
          to: txData.to,
          data: txData.data,
          value: txData.value,
          from: address
        }
      );
      const gasLimit = Math.ceil(gasEstimate * gasMultiplier);

      // Construct transaction
      const transaction = {
        to: txData.to,
        data: txData.data,
        value: txData.value,
        from: address,
        gasLimit
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
          tokensOwed0: updatedPositionData.tokensOwed0.toString(),
          tokensOwed1: updatedPositionData.tokensOwed1.toString(),
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
      slippageTolerance,
      collectFees = true, // Whether to collect fees during removal
      deadlineMinutes
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

    if (!deadlineMinutes) {
      throw new Error("Deadline minutes is required");
    }

    if (slippageTolerance === undefined || slippageTolerance === null) {
      throw new Error("Slippage tolerance is required");
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

      // Create slippage tolerance using standardized method
      const slippageTolerancePercent = this._createSlippagePercent(slippageTolerance);

      // Create liquidity percentage Percent
      const liquidityPercentage = new Percent(percentage, 100);

      // Create RemoveLiquidityOptions
      const removeLiquidityOptions = {
        deadline: this._createDeadline(deadlineMinutes), // Use provided deadline
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
      slippageTolerance,
      deadlineMinutes,
      gasMultiplier = 1.1,
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

    if (slippageTolerance === undefined || slippageTolerance === null) {
      onError && onError("Slippage tolerance is required");
      return;
    }

    if (!deadlineMinutes) {
      onError && onError("Deadline minutes is required");
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
        deadlineMinutes,
        collectFees: true
      });

      // Get signer
      const signer = await provider.getSigner();

      // Estimate gas using the transaction data
      const gasEstimate = await this._estimateGasFromTxData(
        signer,
        {
          to: txData.to,
          data: txData.data,
          value: txData.value,
          from: address
        }
      );
      const gasLimit = Math.ceil(gasEstimate * gasMultiplier);

      // Construct transaction
      const transaction = {
        to: txData.to,
        data: txData.data,
        value: txData.value,
        from: address,
        gasLimit
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
          liquidity: updatedPositionData.liquidity.toString(),
          tokensOwed0: updatedPositionData.tokensOwed0.toString(),
          tokensOwed1: updatedPositionData.tokensOwed1.toString(),
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
      slippageTolerance,
      deadlineMinutes,
      gasMultiplier = 1.1,
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
        deadlineMinutes, // Pass through deadline
        gasMultiplier, // Pass through gas multiplier
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
        ? JSBI.BigInt(ethers.parseUnits(token0Amount, token0Data.decimals).toString())
        : JSBI.BigInt(0);

      const amount1 = token1Amount
        ? JSBI.BigInt(ethers.parseUnits(token1Amount, token1Data.decimals).toString())
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
        deadline: this._createDeadline(deadlineMinutes), // Use provided deadline
        slippageTolerance: this._createSlippagePercent(slippageTolerance), // Use standardized slippage
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
      slippageTolerance,
      deadlineMinutes,
      gasMultiplier = 1.1,
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

    if (!deadlineMinutes) {
      onError && onError("Deadline minutes is required");
      return;
    }

    if (slippageTolerance === undefined || slippageTolerance === null) {
      onError && onError("Slippage tolerance is required");
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
        amount0InWei = ethers.parseUnits(token0Amount, token0Data.decimals).toString();
      }

      if (token1Amount && parseFloat(token1Amount) > 0) {
        amount1InWei = ethers.parseUnits(token1Amount, token1Data.decimals).toString();
      }

      // STEP 1: Check and approve tokens
      const tokenApprovals = [];

      if (parseFloat(token0Amount) > 0) {
        const token0Contract = new ethers.Contract(token0Data.address, erc20Abi, provider);

        // Check current allowance
        const allowance0 = await token0Contract.allowance(address, positionManagerAddress);

        if (BigInt(allowance0) < BigInt(amount0InWei)) {
          // Estimate gas for approval
          const approvalGasEstimate = await this._estimateGas(
            token0Contract,
            'approve',
            [positionManagerAddress, ethers.MaxUint256]
          );
          const approvalGasLimit = Math.ceil(approvalGasEstimate * gasMultiplier);

          // Create approval transaction
          const approveTx = await token0Contract.connect(signer).approve(
            positionManagerAddress,
            ethers.MaxUint256, // ethers v6 syntax for max uint256
            { gasLimit: approvalGasLimit }
          );

          tokenApprovals.push(approveTx.wait());
        }
      }

      if (parseFloat(token1Amount) > 0) {
        const token1Contract = new ethers.Contract(token1Data.address, erc20Abi, provider);

        // Check current allowance
        const allowance1 = await token1Contract.allowance(address, positionManagerAddress);

        if (BigInt(allowance1) < BigInt(amount1InWei)) {
          // Estimate gas for approval
          const approvalGasEstimate = await this._estimateGas(
            token1Contract,
            'approve',
            [positionManagerAddress, ethers.MaxUint256]
          );
          const approvalGasLimit = Math.ceil(approvalGasEstimate * gasMultiplier);

          // Create approval transaction
          const approveTx = await token1Contract.connect(signer).approve(
            positionManagerAddress,
            ethers.MaxUint256, // ethers v6 syntax for max uint256
            { gasLimit: approvalGasLimit }
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
        slippageTolerance,
        deadlineMinutes
      });

      // Estimate gas using the transaction data
      const gasEstimate = await this._estimateGasFromTxData(
        signer,
        {
          to: txData.to,
          data: txData.data,
          value: txData.value,
          from: address
        }
      );
      const gasLimit = Math.ceil(gasEstimate * gasMultiplier);

      // Construct transaction
      const transaction = {
        to: txData.to,
        data: txData.data,
        value: txData.value,
        from: address,
        gasLimit
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
          liquidity: updatedPositionData.liquidity.toString(),
          tokensOwed0: updatedPositionData.tokensOwed0.toString(),
          tokensOwed1: updatedPositionData.tokensOwed1.toString(),
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
      slippageTolerance,
      tokensSwapped = false,
      deadlineMinutes
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

    if (!deadlineMinutes) {
      throw new Error("Deadline minutes is required");
    }

    if (slippageTolerance === undefined || slippageTolerance === null) {
      throw new Error("Slippage tolerance is required");
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
        throw new Error(`Cannot create position: pool does not exist for ${symbol0}/${symbol1} with ${feeTier} fee tier. Pool must be created first.`);
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
        ? JSBI.BigInt(ethers.parseUnits(token0Amount, decimals0).toString())
        : JSBI.BigInt(0);

      const amount1 = token1Amount && parseFloat(token1Amount) > 0
        ? JSBI.BigInt(ethers.parseUnits(token1Amount, decimals1).toString())
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
        deadline: this._createDeadline(deadlineMinutes), // Use provided deadline
        slippageTolerance: this._createSlippagePercent(slippageTolerance), // Use standardized slippage
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
      slippageTolerance,
      tokensSwapped = false,
      deadlineMinutes,
      gasMultiplier = 1.1,
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

    if (!deadlineMinutes) {
      onError && onError("Deadline minutes is required");
      return;
    }

    if (slippageTolerance === undefined || slippageTolerance === null) {
      onError && onError("Slippage tolerance is required");
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
        ? ethers.parseUnits(token0Amount, token0Decimals).toString()
        : '0';

      const amount1InWei = needsToken1Approval
        ? ethers.parseUnits(token1Amount, token1Decimals).toString()
        : '0';

      // STEP 1: Check and approve tokens
      const tokenApprovals = [];

      if (needsToken0Approval) {
        // Check current allowance
        const allowance0 = await token0Contract.allowance(address, positionManagerAddress);

        if (BigInt(allowance0) < BigInt(amount0InWei)) {

          // Estimate gas for approval
          const approvalGasEstimate = await this._estimateGas(
            token0Contract,
            'approve',
            [positionManagerAddress, ethers.MaxUint256]
          );
          const approvalGasLimit = Math.ceil(approvalGasEstimate * gasMultiplier);

          // Create approval transaction
          const approveTx = await token0Contract.connect(signer).approve(
            positionManagerAddress,
            ethers.MaxUint256, // ethers v6 syntax for max uint256
            { gasLimit: approvalGasLimit }
          );

          tokenApprovals.push(approveTx.wait());
        }
      }

      if (needsToken1Approval) {
        // Check current allowance
        const allowance1 = await token1Contract.allowance(address, positionManagerAddress);

        if (BigInt(allowance1) < BigInt(amount1InWei)) {

          // Estimate gas for approval
          const approvalGasEstimate = await this._estimateGas(
            token1Contract,
            'approve',
            [positionManagerAddress, ethers.MaxUint256]
          );
          const approvalGasLimit = Math.ceil(approvalGasEstimate * gasMultiplier);

          // Create approval transaction
          const approveTx = await token1Contract.connect(signer).approve(
            positionManagerAddress,
            ethers.MaxUint256, // ethers v6 syntax for max uint256
            { gasLimit: approvalGasLimit }
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
        tokensSwapped,
        deadlineMinutes
      });

      // Estimate gas using the transaction data
      const gasEstimate = await this._estimateGasFromTxData(
        signer,
        {
          to: txData.to,
          data: txData.data,
          value: txData.value,
          from: address
        }
      );
      const gasLimit = Math.ceil(gasEstimate * gasMultiplier);

      // Construct transaction
      const transaction = {
        to: txData.to,
        data: txData.data,
        value: txData.value,
        from: address,
        gasLimit
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
      deadlineMinutes,
      provider,
      chainId
    } = params;

    try {
      // Validate required parameters
      if (!tokenIn || !tokenOut || !fee || !recipient || !amountIn || !provider || !chainId || !deadlineMinutes) {
        throw new Error("Missing required parameters for swap");
      }

      // Validate chainId matches our adapter's chainId
      if (chainId !== this.chainId) {
        throw new Error(`ChainId ${chainId} does not match adapter chainId ${this.chainId}`);
      }

      // Use cached router address
      if (!this.addresses?.routerAddress) {
        throw new Error(`No Uniswap V3 router address found for chainId: ${chainId}`);
      }

      const routerAddress = this.addresses.routerAddress;

      // Create swap router interface
      const swapRouterInterface = new ethers.Interface(this.swapRouterABI);

      // Create swap parameters for exactInputSingle
      const swapParams = {
        tokenIn,
        tokenOut,
        fee,
        recipient,
        deadline: this._createDeadline(deadlineMinutes), // Use provided deadline
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
      throw new Error(`Failed to generate swap data: ${error.message}`);
    }
  }

  /**
   * Discover available pools for a token pair across all fee tiers
   * @param {string} token0Address - Address of first token
   * @param {string} token1Address - Address of second token
   * @param {number} chainId - Chain ID
   * @returns {Promise<Array>} Array of pool information objects
   */
  async discoverAvailablePools(token0Address, token1Address, chainId) {
    const feeTiers = getPlatformFeeTiers('uniswapV3');
    const pools = [];

    for (const fee of feeTiers) {
      try {
        const poolAddress = await this.getPoolAddressFromFactory(token0Address, token1Address, fee, chainId);

        if (poolAddress && poolAddress !== ethers.ZeroAddress) {
          const poolContract = new ethers.Contract(poolAddress, this.uniswapV3PoolABI, this.provider);

          try {
            const [slot0, liquidity] = await Promise.all([
              poolContract.slot0(),
              poolContract.liquidity()
            ]);

            if (liquidity > 0) {
              pools.push({
                address: poolAddress,
                fee,
                liquidity: liquidity.toString(),
                sqrtPriceX96: slot0.sqrtPriceX96.toString(),
                tick: slot0.tick
              });
            }
          } catch (poolError) {
            // Pool exists but is not active, skip it
          }
        }
      } catch (error) {
        // No pool found for this fee tier, skip it
      }
    }

    return pools;
  }

  /**
   * Get pool address from factory contract
   * @param {string} token0Address - Address of first token
   * @param {string} token1Address - Address of second token
   * @param {number} fee - Fee tier
   * @param {number} chainId - Chain ID
   * @returns {Promise<string>} Pool address
   */
  async getPoolAddressFromFactory(token0Address, token1Address, fee, chainId) {
    const chainConfig = this.config[chainId];
    if (!chainConfig?.platformAddresses?.uniswapV3?.factoryAddress) {
      throw new Error(`No Uniswap V3 factory configuration found for chainId: ${chainId}`);
    }

    const factoryAddress = chainConfig.platformAddresses.uniswapV3.factoryAddress;
    const factoryABI = [
      "function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)"
    ];

    const factoryContract = new ethers.Contract(factoryAddress, factoryABI, this.provider);
    return await factoryContract.getPool(token0Address, token1Address, fee);
  }
}
