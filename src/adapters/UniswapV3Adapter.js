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
import { getPlatformFeeTiers } from "../helpers/platformHelpers.js";
import { getPlatformAddresses, getChainConfig } from "../helpers/chainHelpers.js";
import { getTokenByAddress } from "../helpers/tokenHelpers.js";
import { Position, Pool, NonfungiblePositionManager, tickToPrice, TickMath } from '@uniswap/v3-sdk';
import { Percent, Token, CurrencyAmount, Price } from '@uniswap/sdk-core';
import JSBI from "jsbi";

// Import ABIs from Uniswap and OpenZeppelin libraries
import NonfungiblePositionManagerARTIFACT from '@uniswap/v3-periphery/artifacts/contracts/NonfungiblePositionManager.sol/NonfungiblePositionManager.json' with { type: 'json' };
import IUniswapV3PoolARTIFACT from '@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Pool.sol/IUniswapV3Pool.json' with { type: 'json' };
import SwapRouterARTIFACT from '@uniswap/v3-periphery/artifacts/contracts/SwapRouter.sol/SwapRouter.json' with { type: 'json' };
import QuoterARTIFACT from '@uniswap/v3-periphery/artifacts/contracts/lens/QuoterV2.sol/QuoterV2.json' with { type: 'json' };
import ERC20ARTIFACT from '@openzeppelin/contracts/build/contracts/ERC20.json' with { type: 'json' };

const NonfungiblePositionManagerABI = NonfungiblePositionManagerARTIFACT.abi;
const IUniswapV3PoolABI = IUniswapV3PoolARTIFACT.abi;
const SwapRouterABI = SwapRouterARTIFACT.abi;
const QuoterABI = QuoterARTIFACT.abi;
const ERC20ABI = ERC20ARTIFACT.abi;

// Define MaxUint128 constant (2^128 - 1) as JSBI for Uniswap SDK compatibility
const MaxUint128 = JSBI.subtract(JSBI.exponentiate(JSBI.BigInt(2), JSBI.BigInt(128)), JSBI.BigInt(1));

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
 * // Get pool address (from factory contract)
 * const poolAddress = await adapter.getPoolAddress(token0Address, token1Address, 500, provider);
 *
 * // Get live pool data (makes blockchain calls)
 * const poolData = await adapter.fetchPoolData(token0Address, token1Address, 500, provider);
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
    this.quoterABI = QuoterABI;
    this.erc20ABI = ERC20ABI;

    // Pre-create contract interfaces for better performance
    this.swapRouterInterface = new ethers.Interface(this.swapRouterABI);
    this.positionManagerInterface = new ethers.Interface(this.nonfungiblePositionManagerABI);
    this.poolInterface = new ethers.Interface(this.uniswapV3PoolABI);
    this.quoterInterface = new ethers.Interface(this.quoterABI);
    this.erc20Interface = new ethers.Interface(this.erc20ABI);

  }

  /**
   * Validate and normalize slippage tolerance
   * @param {number} slippageTolerance - Slippage tolerance percentage (0-100)
   * @returns {number} Validated slippage tolerance
   * @throws {Error} If slippage tolerance is invalid
   */
  _validateSlippageTolerance(slippageTolerance) {
    if (!Number.isFinite(slippageTolerance) || slippageTolerance < 0 || slippageTolerance > 100) {
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
    if (!Number.isFinite(deadlineMinutes) || deadlineMinutes < 0) {
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
   * Validate that provider is on the correct chain
   * @param {Object} provider - Ethers provider instance
   * @throws {Error} If provider is invalid or on wrong chain
   */
  async _validateProviderChain(provider) {
    // Validate provider using ethers v6 pattern
    if (!(provider instanceof ethers.AbstractProvider)) {
      throw new Error('Invalid provider. Must be an ethers provider instance.');
    }

    try {
      const network = await provider.getNetwork();

      if (!network || network.chainId === undefined) {
        throw new Error('Provider returned invalid network data');
      }

      // In ethers v6, chainId is always a bigint
      const providerChainId = Number(network.chainId);

      if (providerChainId !== this.chainId) {
        throw new Error(`Provider chain ${providerChainId} doesn't match adapter chain ${this.chainId}`);
      }
    } catch (error) {
      if (error.message.includes("doesn't match adapter chain")) {
        throw error; // Re-throw chain mismatch errors as-is
      }
      throw new Error(`Failed to validate provider chain: ${error.message}`);
    }
  }

  /**
   * Get pool address from factory contract
   * @param {string} token0Address - Address of first token
   * @param {string} token1Address - Address of second token
   * @param {number} fee - Fee tier (e.g., 500, 3000, 10000)
   * @param {Object} provider - Ethers provider instance
   * @returns {Promise<string>} Pool address
   */
  async getPoolAddress(token0Address, token1Address, fee, provider) {
    // Validate token0 address
    if (!token0Address) {
      throw new Error("Token0 address parameter is required");
    }
    try {
      ethers.getAddress(token0Address);
    } catch (error) {
      throw new Error(`Invalid token0 address: ${token0Address}`);
    }

    // Validate token1 address
    if (!token1Address) {
      throw new Error("Token1 address parameter is required");
    }
    try {
      ethers.getAddress(token1Address);
    } catch (error) {
      throw new Error(`Invalid token1 address: ${token1Address}`);
    }

    // Validate fee
    if (fee === null || fee === undefined) {
      throw new Error("Fee parameter is required");
    }
    if (typeof fee !== 'number' || !Number.isFinite(fee)) {
      throw new Error("Fee must be a valid number");
    }

    // Validate provider
    await this._validateProviderChain(provider);

    if (!this.addresses?.factoryAddress) {
      throw new Error(`No Uniswap V3 factory address found for chainId: ${this.chainId}`);
    }

    const factoryABI = [
      "function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)"
    ];

    const factoryContract = new ethers.Contract(this.addresses.factoryAddress, factoryABI, provider);
    return await factoryContract.getPool(token0Address, token1Address, fee);
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
    // Validate token0
    if (!token0) {
      throw new Error("Token0 parameter is required");
    }
    if (!token0.address) {
      throw new Error("Token0 address is required");
    }
    try {
      ethers.getAddress(token0.address);
    } catch (error) {
      throw new Error(`Invalid token0 address: ${token0.address}`);
    }
    if (token0.decimals === null || token0.decimals === undefined) {
      throw new Error("Token0 decimals is required");
    }
    if (typeof token0.decimals !== 'number' || !Number.isFinite(token0.decimals)) {
      throw new Error("Token0 decimals must be a valid number");
    }

    // Validate token1
    if (!token1) {
      throw new Error("Token1 parameter is required");
    }
    if (!token1.address) {
      throw new Error("Token1 address is required");
    }
    try {
      ethers.getAddress(token1.address);
    } catch (error) {
      throw new Error(`Invalid token1 address: ${token1.address}`);
    }
    if (token1.decimals === null || token1.decimals === undefined) {
      throw new Error("Token1 decimals is required");
    }
    if (typeof token1.decimals !== 'number' || !Number.isFinite(token1.decimals)) {
      throw new Error("Token1 decimals must be a valid number");
    }

    // Validate fee
    if (fee === null || fee === undefined) {
      throw new Error("Fee parameter is required");
    }
    if (typeof fee !== 'number' || !Number.isFinite(fee)) {
      throw new Error("Fee must be a valid number");
    }

    // Validate provider is on correct chain
    await this._validateProviderChain(provider);

    try {
      const poolAddress = await this.getPoolAddress(token0.address, token1.address, fee, provider);

      // Use the full pool ABI that we already have at the class level
      const poolContract = new ethers.Contract(poolAddress, this.uniswapV3PoolABI, provider);

      try {
        // Try to call slot0() to see if the pool exists
        const slot0 = await poolContract.slot0();
        return { exists: true, poolAddress, slot0 };
      } catch (error) {
        // If the call fails, the pool likely doesn't exist
        return { exists: false, poolAddress: null, slot0: null };
      }
    } catch (error) {
      // If getPoolAddress fails, propagate the error (could be validation or network error)
      throw error;
    }
  }

  /**
   * Get position manager contract instance
   * @param {Object} provider - Ethers provider instance
   * @returns {ethers.Contract} Position manager contract instance
   * @private
   */
  _getPositionManager(provider) {
    if (!provider) {
      throw new Error('Provider is required');
    }

    if (!this.addresses?.positionManagerAddress) {
      throw new Error(`Position manager not available for chain ${this.chainId}`);
    }

    return new ethers.Contract(
      this.addresses.positionManagerAddress,
      this.nonfungiblePositionManagerABI,
      provider
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
    // Validate address parameter
    if (!address) {
      throw new Error("Address parameter is required");
    }

    // Validate address format
    try {
      ethers.getAddress(address); // This will throw if invalid
    } catch (error) {
      throw new Error("Invalid Ethereum address");
    }

    // Validate positionManager parameter
    if (!positionManager) {
      throw new Error("Position manager parameter is required");
    }

    // Check if positionManager has required methods
    if (typeof positionManager.balanceOf !== 'function' ||
        typeof positionManager.tokenOfOwnerByIndex !== 'function') {
      throw new Error("Invalid position manager contract - missing required methods");
    }

    const balance = await positionManager.balanceOf(address);
    const tokenIds = [];

    for (let i = 0; i < balance; i++) {
      const tokenId = await positionManager.tokenOfOwnerByIndex(address, i);
      tokenIds.push(String(tokenId));
    }

    return tokenIds;
  }

  /**
   * Fetch pool state data
   * @param {string} token0Address - Token0 contract address
   * @param {string} token1Address - Token1 contract address
   * @param {number} fee - Pool fee tier
   * @param {Object} provider - Ethers provider
   * @returns {Promise<Object>} Pool state data
   */
  async fetchPoolData(token0Address, token1Address, fee, provider) {
    // Validate token0 address
    if (!token0Address) {
      throw new Error("Token0 address parameter is required");
    }
    try {
      ethers.getAddress(token0Address);
    } catch (error) {
      throw new Error(`Invalid token0 address: ${token0Address}`);
    }

    // Validate token1 address
    if (!token1Address) {
      throw new Error("Token1 address parameter is required");
    }
    try {
      ethers.getAddress(token1Address);
    } catch (error) {
      throw new Error(`Invalid token1 address: ${token1Address}`);
    }

    // Validate fee
    if (fee === null || fee === undefined) {
      throw new Error("Fee parameter is required");
    }
    if (typeof fee !== 'number' || !Number.isFinite(fee)) {
      throw new Error("Fee must be a valid number");
    }

    // Validate provider
    await this._validateProviderChain(provider);

    // Get token data from config
    const token0Config = getTokenByAddress(token0Address, this.chainId);
    if (!token0Config) {
      throw new Error(`Unsupported token: ${token0Address} on chain ${this.chainId}`);
    }

    const token1Config = getTokenByAddress(token1Address, this.chainId);
    if (!token1Config) {
      throw new Error(`Unsupported token: ${token1Address} on chain ${this.chainId}`);
    }

    // Create token data objects
    const token0Data = {
      address: token0Address,
      decimals: token0Config.decimals,
      symbol: token0Config.symbol,
      chainId: this.chainId
    };

    const token1Data = {
      address: token1Address,
      decimals: token1Config.decimals,
      symbol: token1Config.symbol,
      chainId: this.chainId
    };

    // Calculate pool address
    const poolAddress = await this.getPoolAddress(token0Data.address, token1Data.address, fee, provider);

    // Create pool contract
    const poolContract = new ethers.Contract(poolAddress, this.uniswapV3PoolABI, provider);

    try {
      const slot0 = await poolContract.slot0();
      const observationIndex = Number(slot0[2]);
      const lastObservation = await poolContract.observations(observationIndex);
      const protocolFees = await poolContract.protocolFees();

      return {
        poolAddress,
        token0: token0Data,
        token1: token1Data,
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
   * Get pool data by address with optional tick data and token information
   * @param {string} poolAddress - Pool contract address
   * @param {Object} options - Options object for additional data to include (required)
   * @param {Array<number>} [options.includeTicks] - Array of tick indices to fetch data for (must be integers)
   * @param {boolean} [options.includeTokens] - Whether to fetch token0 and token1 addresses
   * @param {Object} provider - Ethers provider instance
   * @returns {Promise<Object>} Complete pool data with requested additional fields
   * @throws {Error} If parameters are invalid or pool data cannot be retrieved
   */
  async getPoolData(poolAddress, options, provider) {
    // Validate options parameter
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
      throw new Error("Options parameter must be an object");
    }

    // Validate includeTicks if provided
    if (options.includeTicks !== undefined) {
      if (!Array.isArray(options.includeTicks)) {
        throw new Error("includeTicks must be an array");
      }
      if (!options.includeTicks.every(tick => typeof tick === 'number' && Number.isInteger(tick))) {
        throw new Error("All includeTicks values must be integers");
      }
    }

    // Validate includeTokens if provided  
    if (options.includeTokens !== undefined) {
      if (typeof options.includeTokens !== 'boolean') {
        throw new Error("includeTokens must be a boolean");
      }
    }

    const { includeTicks = [], includeTokens = false } = options;

    // Validate pool address
    if (!poolAddress) {
      throw new Error("Pool address parameter is required");
    }

    let normalizedAddress;
    try {
      normalizedAddress = ethers.getAddress(poolAddress);
    } catch (error) {
      throw new Error(`Invalid pool address: ${poolAddress}`);
    }

    // Validate provider
    if (!provider || !(provider instanceof ethers.AbstractProvider)) {
      throw new Error("Provider parameter is required");
    }

    try {
      // Create pool contract
      const poolContract = new ethers.Contract(normalizedAddress, this.uniswapV3PoolABI, provider);

      // Fetch core pool state data
      const [slot0, liquidity, feeGrowthGlobal0X128, feeGrowthGlobal1X128, fee] =
        await Promise.all([
          poolContract.slot0(),
          poolContract.liquidity(),
          poolContract.feeGrowthGlobal0X128(),
          poolContract.feeGrowthGlobal1X128(),
          poolContract.fee()
        ]);

      // Build base pool data object
      const poolData = {
        address: normalizedAddress,
        sqrtPriceX96: slot0.sqrtPriceX96.toString(),
        tick: Number(slot0.tick),
        observationIndex: Number(slot0.observationIndex),
        observationCardinality: Number(slot0.observationCardinality),
        observationCardinalityNext: Number(slot0.observationCardinalityNext),
        feeProtocol: Number(slot0.feeProtocol),
        unlocked: slot0.unlocked,
        liquidity: liquidity.toString(),
        feeGrowthGlobal0X128: feeGrowthGlobal0X128.toString(),
        feeGrowthGlobal1X128: feeGrowthGlobal1X128.toString(),
        fee: Number(fee),
        lastUpdated: Date.now()
      };

      // Add tick data if requested
      if (includeTicks.length > 0) {
        poolData.ticks = {};
        const tickPromises = includeTicks.map(tick =>
          poolContract.ticks(tick).then(data => ({ tick, data }))
        );
        const tickResults = await Promise.all(tickPromises);

        for (const { tick, data } of tickResults) {
          poolData.ticks[tick.toString()] = {
            liquidityGross: data.liquidityGross.toString(),
            liquidityNet: data.liquidityNet.toString(),
            feeGrowthOutside0X128: data.feeGrowthOutside0X128.toString(),
            feeGrowthOutside1X128: data.feeGrowthOutside1X128.toString(),
            tickCumulativeOutside: data.tickCumulativeOutside.toString(),
            secondsPerLiquidityOutsideX128: data.secondsPerLiquidityOutsideX128.toString(),
            secondsOutside: Number(data.secondsOutside),
            initialized: data.initialized,
            lastUpdated: Date.now()
          };
        }
      }

      // Add token addresses if requested
      if (includeTokens) {
        const [token0, token1] = await Promise.all([
          poolContract.token0(),
          poolContract.token1()
        ]);
        poolData.token0 = token0;
        poolData.token1 = token1;
      }

      return poolData;
    } catch (error) {
      throw new Error(`Failed to get pool data for ${normalizedAddress}: ${error.message}`);
    }
  }

  /**
   * Fetch tick-specific data for fee calculations
   * @param {string} poolAddress - Pool contract address
   * @param {number} tickLower - Lower tick of the position
   * @param {number} tickUpper - Upper tick of the position
   * @param {Object} provider - Ethers provider instance
   * @returns {Promise<{tickLower: Object, tickUpper: Object}>} Tick data
   */
  async fetchTickData(poolAddress, tickLower, tickUpper, provider) {
    // Validate pool address
    if (!poolAddress) {
      throw new Error("Pool address parameter is required");
    }
    try {
      ethers.getAddress(poolAddress);
    } catch (error) {
      throw new Error(`Invalid pool address: ${poolAddress}`);
    }

    // Validate tickLower
    if (tickLower === null || tickLower === undefined) {
      throw new Error("tickLower parameter is required");
    }
    if (typeof tickLower !== 'number' || !Number.isFinite(tickLower)) {
      throw new Error("tickLower must be a valid number");
    }

    // Validate tickUpper
    if (tickUpper === null || tickUpper === undefined) {
      throw new Error("tickUpper parameter is required");
    }
    if (typeof tickUpper !== 'number' || !Number.isFinite(tickUpper)) {
      throw new Error("tickUpper must be a valid number");
    }

    // Validate provider
    await this._validateProviderChain(provider);

    const poolContract = new ethers.Contract(poolAddress, this.uniswapV3PoolABI, provider);

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
   * Get current tick for a Uniswap V3 pool
   * @param {string} poolAddress - Pool contract address
   * @param {Object} provider - Ethers provider instance
   * @returns {Promise<number>} Current tick value
   * @throws {Error} If parameters invalid or pool query fails
   */
  async getCurrentTick(poolAddress, provider) {
    // Parameter validation (follows fetchTickData pattern)
    if (!poolAddress) {
      throw new Error("Pool address parameter is required");
    }
    
    try {
      ethers.getAddress(poolAddress);
    } catch (error) {
      throw new Error(`Invalid pool address: ${poolAddress}`);
    }
    
    // Provider validation
    await this._validateProviderChain(provider);
    
    // Create pool contract and get tick
    const poolContract = new ethers.Contract(poolAddress, this.uniswapV3PoolABI, provider);
    
    try {
      const slot0 = await poolContract.slot0();
      return Number(slot0.tick);
    } catch (error) {
      throw new Error(`Failed to get current tick for pool ${poolAddress}: ${error.message}`);
    }
  }

  /**
   * Get the pool contract ABI
   * @returns {Array} Pool contract ABI
   */
  getPoolABI() {
    return this.uniswapV3PoolABI;
  }

  /**
   * Assemble position data from contract data and pool data
   * @param {string} tokenId - Position token ID
   * @param {Object} positionData - Raw position data from contract
   * @param {Object} poolData - Pool data containing token and pool information
   * @returns {Object} Assembled position object
   * @private
   */
  _assemblePositionData(tokenId, positionData, poolData) {
    const {
      nonce,
      operator,
      fee,
      tickLower,
      tickUpper,
      liquidity,
      feeGrowthInside0LastX128,
      feeGrowthInside1LastX128,
      tokensOwed0,
      tokensOwed1
    } = positionData;

    // Get token data and pool address from poolData
    const { token0, token1, poolAddress } = poolData;
    const tokenPair = `${token0.symbol}/${token1.symbol}`;

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
   * @param {Object} provider - Ethers provider instance
   * @returns {Promise<{positions: Array, poolData: Object}>} Position data
   */
  async getPositions(address, provider) {
    // Validate address
    if (!address) {
      throw new Error("Address parameter is required");
    }
    try {
      ethers.getAddress(address);
    } catch (error) {
      throw new Error(`Invalid address: ${address}`);
    }

    // Validate provider
    await this._validateProviderChain(provider);

    try {
      // Get position manager contract
      const positionManager = this._getPositionManager(provider);

      // Fetch user's position token IDs
      const tokenIds = await this._fetchUserPositionIds(address, positionManager);

      if (tokenIds.length === 0) {
        return { positions: {}, poolData: {} };
      }

      const positions = {};
      const poolDataMap = {};
      const processingErrors = [];

      // Process each position
      for (const tokenId of tokenIds) {
        try {
          // Get position data from contract
          const positionData = await positionManager.positions(tokenId);
          const { token0, token1, fee, tickLower, tickUpper } = positionData;

          // Fetch pool data (which includes token data and canonical pool address)
          const poolData = await this.fetchPoolData(token0, token1, Number(fee), provider);
          const poolAddress = poolData.poolAddress;

          // Cache pool data using canonical pool address
          if (!poolDataMap[poolAddress]) {
            poolDataMap[poolAddress] = poolData;
          }

          // Fetch tick data if not already present
          const cachedPoolData = poolDataMap[poolAddress];
          const tickLowerNum = Number(tickLower);
          const tickUpperNum = Number(tickUpper);
          if (!cachedPoolData.ticks[tickLowerNum] || !cachedPoolData.ticks[tickUpperNum]) {
            const tickData = await this.fetchTickData(poolAddress, tickLowerNum, tickUpperNum, provider);
            cachedPoolData.ticks[tickLowerNum] = tickData.tickLower;
            cachedPoolData.ticks[tickUpperNum] = tickData.tickUpper;
          }

          // Assemble position data
          const position = this._assemblePositionData(tokenId, positionData, cachedPoolData);
          positions[position.id] = position;

        } catch (error) {
          processingErrors.push(`Position ${tokenId}: ${error.message}`);
        }
      }

      // If any positions failed to process, throw error with all failures
      if (processingErrors.length > 0) {
        throw new Error(`Failed to process ${processingErrors.length} position(s): ${processingErrors.join('; ')}`);
      }

      return {
        positions,
        poolData: poolDataMap
      };

    } catch (error) {
      throw new Error(`Failed to fetch Uniswap V3 positions: ${error.message}`);
    }
  }

  /**
   * Get positions formatted for VaultDataService
   * @param {string} address - Vault address
   * @param {Object} provider - Ethers provider instance
   * @returns {Promise<{positions: Object, poolData: Object}>} Normalized position data and pool data
   */
  async getPositionsForVDS(address, provider) {
    // Validate address
    if (!address) {
      throw new Error("Address parameter is required");
    }
    try {
      ethers.getAddress(address);
    } catch (error) {
      throw new Error(`Invalid address: ${address}`);
    }

    // Validate provider
    if (!provider || typeof provider.getNetwork !== 'function') {
      throw new Error("Valid provider parameter is required");
    }

    try {
      // Call the existing getPositions method
      const result = await this.getPositions(address, provider);
      
      // Normalize positions to VDS format - pare down to essential fields only
      const normalizedPositions = {};
      if (result.positions && Object.keys(result.positions).length > 0) {
        Object.values(result.positions).forEach(position => {
          normalizedPositions[position.id] = {
            id: position.id,
            pool: position.pool,
            tickLower: position.tickLower,
            tickUpper: position.tickUpper,
            liquidity: position.liquidity,
            lastUpdated: Date.now()
          };
        });
      }

      // Extract only essential metadata from poolData (no time-sensitive data)
      const metadataPoolData = {};
      if (result.poolData) {
        for (const [poolAddress, poolInfo] of Object.entries(result.poolData)) {
          metadataPoolData[poolAddress] = {
            // Only stable metadata - no time-sensitive data
            poolAddress: poolAddress,
            token0Symbol: poolInfo.token0?.symbol,
            token1Symbol: poolInfo.token1?.symbol,
            fee: poolInfo.fee,
            platform: 'uniswapV3'
          };
        }
      }

      return {
        positions: normalizedPositions,
        poolData: metadataPoolData
      };

    } catch (error) {
      throw new Error(`Failed to fetch positions for VDS: ${error.message}`);
    }
  }

  /**
   * Check if a position is in range (active)
   * @param {number} currentTick - Current tick of the pool
   * @param {number} tickLower - Lower tick of the position
   * @param {number} tickUpper - Upper tick of the position
   * @returns {boolean} - Whether the position is in range
   * @throws {Error} - If parameters are invalid
   */
  isPositionInRange(currentTick, tickLower, tickUpper) {
    if (typeof currentTick !== 'number' || !isFinite(currentTick)) {
      throw new Error('Invalid currentTick: must be a number');
    }
    if (typeof tickLower !== 'number' || !isFinite(tickLower)) {
      throw new Error('Invalid tickLower: must be a number');
    }
    if (typeof tickUpper !== 'number' || !isFinite(tickUpper)) {
      throw new Error('Invalid tickUpper: must be a number');
    }

    if (tickLower >= tickUpper) {
      throw new Error('Invalid tick range: tickLower must be less than tickUpper');
    }

    return currentTick >= tickLower && currentTick <= tickUpper;
  }

  /**
   * Calculate price from sqrtPriceX96 using the Uniswap V3 SDK
   * @param {string} sqrtPriceX96 - Square root price in X96 format
   * @param {Object} baseToken - Base token (token0 unless inverted)
   * @param {string} baseToken.address - Token address
   * @param {number} baseToken.decimals - Token decimals
   * @param {Object} quoteToken - Quote token (token1 unless inverted)
   * @param {string} quoteToken.address - Token address
   * @param {number} quoteToken.decimals - Token decimals
   * @returns {Price} Uniswap SDK Price object with methods like toFixed(), toSignificant(), etc.
   */
  calculatePriceFromSqrtPrice(sqrtPriceX96, baseToken, quoteToken) {
    // Validate sqrtPriceX96 is a string
    if (typeof sqrtPriceX96 !== 'string') {
      throw new Error('sqrtPriceX96 must be a string');
    }

    if (!sqrtPriceX96 || sqrtPriceX96 === "0") {
      throw new Error("Invalid sqrtPriceX96 value");
    }

    if (!baseToken || !quoteToken) {
      throw new Error("Missing required token information");
    }

    // Validate addresses
    if (!baseToken.address) {
      throw new Error("baseToken.address is required");
    }
    if (!quoteToken.address) {
      throw new Error("quoteToken.address is required");
    }

    let validatedBaseAddress, validatedQuoteAddress;
    try {
      validatedBaseAddress = ethers.getAddress(baseToken.address);
    } catch (error) {
      throw new Error(`Invalid baseToken.address: ${baseToken.address}`);
    }

    try {
      validatedQuoteAddress = ethers.getAddress(quoteToken.address);
    } catch (error) {
      throw new Error(`Invalid quoteToken.address: ${quoteToken.address}`);
    }

    // Validate decimals
    if (!Number.isFinite(baseToken.decimals) || baseToken.decimals < 0 || baseToken.decimals > 255) {
      throw new Error("baseToken.decimals must be a finite number between 0 and 255");
    }
    if (!Number.isFinite(quoteToken.decimals) || quoteToken.decimals < 0 || quoteToken.decimals > 255) {
      throw new Error("quoteToken.decimals must be a finite number between 0 and 255");
    }

    try {
      // Create Token instances
      const base = new Token(
        this.chainId,
        validatedBaseAddress,
        baseToken.decimals
      );

      const quote = new Token(
        this.chainId,
        validatedQuoteAddress,
        quoteToken.decimals
      );

      // Convert sqrtPriceX96 to JSBI BigInt
      let sqrtRatioX96;
      try {
        sqrtRatioX96 = JSBI.BigInt(sqrtPriceX96);
      } catch (error) {
        throw new Error('Invalid sqrtPriceX96: must be a valid numeric string');
      }

      // Validate that sqrtPriceX96 is positive
      if (JSBI.lessThanOrEqual(sqrtRatioX96, JSBI.BigInt(0))) {
        throw new Error('Invalid sqrtPriceX96: must be a valid numeric string');
      }

      // Get the tick at this sqrt ratio
      const tick = TickMath.getTickAtSqrtRatio(sqrtRatioX96);

      // Use SDK's tickToPrice to get the price
      const price = tickToPrice(base, quote, tick);

      // Return the raw Price object - let consumers decide how to format
      return price;
    } catch (error) {
      throw new Error(`Failed to calculate price: ${error.message}`);
    }
  }

  /**
   * Convert a tick value to a corresponding price using the Uniswap V3 SDK
   * @param {number} tick - The tick value
   * @param {Object} baseToken - Base token (token0 unless inverted)
   * @param {string} baseToken.address - Token address
   * @param {number} baseToken.decimals - Token decimals
   * @param {Object} quoteToken - Quote token (token1 unless inverted)
   * @param {string} quoteToken.address - Token address
   * @param {number} quoteToken.decimals - Token decimals
   * @returns {Price} Uniswap SDK Price object with methods like toFixed(), toSignificant(), etc.
   */
  tickToPrice(tick, baseToken, quoteToken) {
    if (!Number.isFinite(tick)) {
      throw new Error("Invalid tick value");
    }

    if (!baseToken || !quoteToken) {
      throw new Error("Missing required token information");
    }

    // Validate addresses
    if (!baseToken.address) {
      throw new Error("baseToken.address is required");
    }
    if (!quoteToken.address) {
      throw new Error("quoteToken.address is required");
    }

    let validatedBaseAddress, validatedQuoteAddress;
    try {
      validatedBaseAddress = ethers.getAddress(baseToken.address);
    } catch (error) {
      throw new Error(`Invalid baseToken.address: ${baseToken.address}`);
    }

    try {
      validatedQuoteAddress = ethers.getAddress(quoteToken.address);
    } catch (error) {
      throw new Error(`Invalid quoteToken.address: ${quoteToken.address}`);
    }

    // Validate decimals
    if (!Number.isFinite(baseToken.decimals) || baseToken.decimals < 0 || baseToken.decimals > 255) {
      throw new Error("baseToken.decimals must be a finite number between 0 and 255");
    }
    if (!Number.isFinite(quoteToken.decimals) || quoteToken.decimals < 0 || quoteToken.decimals > 255) {
      throw new Error("quoteToken.decimals must be a finite number between 0 and 255");
    }

    try {
      // Create Token instances
      const base = new Token(
        this.chainId,
        validatedBaseAddress,
        baseToken.decimals
      );

      const quote = new Token(
        this.chainId,
        validatedQuoteAddress,
        quoteToken.decimals
      );

      // Use SDK's tickToPrice function
      const price = tickToPrice(base, quote, tick);

      // Return the raw Price object - let consumers decide how to format
      return price;
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
   * @param {string} position.liquidity - Position liquidity (large value, must be string)
   * @param {string} position.feeGrowthInside0LastX128 - Fee growth inside for token0 at last action (large value, must be string)
   * @param {string} position.feeGrowthInside1LastX128 - Fee growth inside for token1 at last action (large value, must be string)
   * @param {number} position.tickLower - Lower tick of the position
   * @param {number} position.tickUpper - Upper tick of the position
   * @param {string} position.tokensOwed0 - Already accumulated fees for token0 (large value, must be string)
   * @param {string} position.tokensOwed1 - Already accumulated fees for token1 (large value, must be string)
   * @param {Object} poolData - Current pool state data
   * @param {number} poolData.tick - Current pool tick
   * @param {string} poolData.feeGrowthGlobal0X128 - Current global fee growth for token0 (large value, must be string)
   * @param {string} poolData.feeGrowthGlobal1X128 - Current global fee growth for token1 (large value, must be string)
   * @param {Object} poolData.ticks - Object containing tick data for the position's ticks
   * @param {Object} poolData.ticks[tickLower] - Lower tick data with feeGrowthOutside values
   * @param {Object} poolData.ticks[tickUpper] - Upper tick data with feeGrowthOutside values
   * @returns {[bigint, bigint]} Array with [token0Fees, token1Fees] as raw bigint values
   * @throws {Error} If required pool or token data is missing
   */
  calculateUncollectedFees(position, poolData) {
    // Validate position exists
    if (!position) {
      throw new Error("Position parameter is required");
    }

    // Validate position required properties exist
    if (!position.liquidity) {
      throw new Error("position.liquidity is required");
    }
    if (!position.feeGrowthInside0LastX128) {
      throw new Error("position.feeGrowthInside0LastX128 is required");
    }
    if (!position.feeGrowthInside1LastX128) {
      throw new Error("position.feeGrowthInside1LastX128 is required");
    }
    if (!position.tokensOwed0) {
      throw new Error("position.tokensOwed0 is required");
    }
    if (!position.tokensOwed1) {
      throw new Error("position.tokensOwed1 is required");
    }
    if (position.tickLower === undefined || position.tickLower === null) {
      throw new Error("position.tickLower is required");
    }
    if (position.tickUpper === undefined || position.tickUpper === null) {
      throw new Error("position.tickUpper is required");
    }

    // Validate position property types
    if (typeof position.liquidity !== 'string') {
      throw new Error("position.liquidity must be a string");
    }
    if (typeof position.feeGrowthInside0LastX128 !== 'string') {
      throw new Error("position.feeGrowthInside0LastX128 must be a string");
    }
    if (typeof position.feeGrowthInside1LastX128 !== 'string') {
      throw new Error("position.feeGrowthInside1LastX128 must be a string");
    }
    if (typeof position.tokensOwed0 !== 'string') {
      throw new Error("position.tokensOwed0 must be a string");
    }
    if (typeof position.tokensOwed1 !== 'string') {
      throw new Error("position.tokensOwed1 must be a string");
    }
    if (!Number.isFinite(position.tickLower)) {
      throw new Error("position.tickLower must be a finite number");
    }
    if (!Number.isFinite(position.tickUpper)) {
      throw new Error("position.tickUpper must be a finite number");
    }

    // Validate poolData exists
    if (!poolData) {
      throw new Error("poolData parameter is required");
    }

    // Validate poolData required properties exist
    if (poolData.tick === undefined || poolData.tick === null) {
      throw new Error("poolData.tick is required");
    }
    if (!poolData.feeGrowthGlobal0X128) {
      throw new Error("poolData.feeGrowthGlobal0X128 is required");
    }
    if (!poolData.feeGrowthGlobal1X128) {
      throw new Error("poolData.feeGrowthGlobal1X128 is required");
    }
    if (!poolData.ticks) {
      throw new Error("poolData.ticks is required");
    }

    // Validate poolData property types
    if (!Number.isFinite(poolData.tick)) {
      throw new Error("poolData.tick must be a finite number");
    }
    if (typeof poolData.feeGrowthGlobal0X128 !== 'string') {
      throw new Error("poolData.feeGrowthGlobal0X128 must be a string");
    }
    if (typeof poolData.feeGrowthGlobal1X128 !== 'string') {
      throw new Error("poolData.feeGrowthGlobal1X128 must be a string");
    }

    // Validate tick data exists
    if (!poolData.ticks[position.tickLower]) {
      throw new Error(`Missing tick data for tickLower ${position.tickLower}`);
    }
    if (!poolData.ticks[position.tickUpper]) {
      throw new Error(`Missing tick data for tickUpper ${position.tickUpper}`);
    }

    const tickLowerData = poolData.ticks[position.tickLower];
    const tickUpperData = poolData.ticks[position.tickUpper];

    // Internal calculation with all parameters
    return this._calculateUncollectedFeesInternal({
      position,
      currentTick: poolData.tick,
      feeGrowthGlobal0X128: poolData.feeGrowthGlobal0X128,
      feeGrowthGlobal1X128: poolData.feeGrowthGlobal1X128,
      tickLowerData,
      tickUpperData
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
    tickLowerData,
    tickUpperData,
  }) {
    // Position data extraction with validation
    let liquidity, feeGrowthInside0LastX128, feeGrowthInside1LastX128, tokensOwed0, tokensOwed1;

    // Validate liquidity is decimal-only string
    if (!/^\d+$/.test(position.liquidity)) {
      throw new Error('Invalid position.liquidity: must be a valid numeric string');
    }
    try {
      liquidity = BigInt(position.liquidity);
    } catch (error) {
      throw new Error('Invalid position.liquidity: must be a valid numeric string');
    }

    // Validate feeGrowthInside0LastX128 is decimal-only string
    if (!/^\d+$/.test(position.feeGrowthInside0LastX128)) {
      throw new Error('Invalid position.feeGrowthInside0LastX128: must be a valid numeric string');
    }
    try {
      feeGrowthInside0LastX128 = BigInt(position.feeGrowthInside0LastX128);
    } catch (error) {
      throw new Error('Invalid position.feeGrowthInside0LastX128: must be a valid numeric string');
    }

    // Validate feeGrowthInside1LastX128 is decimal-only string
    if (!/^\d+$/.test(position.feeGrowthInside1LastX128)) {
      throw new Error('Invalid position.feeGrowthInside1LastX128: must be a valid numeric string');
    }
    try {
      feeGrowthInside1LastX128 = BigInt(position.feeGrowthInside1LastX128);
    } catch (error) {
      throw new Error('Invalid position.feeGrowthInside1LastX128: must be a valid numeric string');
    }

    // Validate tokensOwed0 is decimal-only string
    if (!/^\d+$/.test(position.tokensOwed0)) {
      throw new Error('Invalid position.tokensOwed0: must be a valid numeric string');
    }
    try {
      tokensOwed0 = BigInt(position.tokensOwed0);
    } catch (error) {
      throw new Error('Invalid position.tokensOwed0: must be a valid numeric string');
    }

    // Validate tokensOwed1 is decimal-only string
    if (!/^\d+$/.test(position.tokensOwed1)) {
      throw new Error('Invalid position.tokensOwed1: must be a valid numeric string');
    }
    try {
      tokensOwed1 = BigInt(position.tokensOwed1);
    } catch (error) {
      throw new Error('Invalid position.tokensOwed1: must be a valid numeric string');
    }

    // Tick data extraction with validation
    let lowerTickData, upperTickData;

    // Validate tick lower data fee growth values are decimal-only strings
    if (!/^\d+$/.test(tickLowerData.feeGrowthOutside0X128) || !/^\d+$/.test(tickLowerData.feeGrowthOutside1X128)) {
      throw new Error('Invalid tickLowerData fee growth values: must be valid numeric strings');
    }
    try {
      lowerTickData = {
        feeGrowthOutside0X128: BigInt(tickLowerData.feeGrowthOutside0X128),
        feeGrowthOutside1X128: BigInt(tickLowerData.feeGrowthOutside1X128),
        initialized: Boolean(tickLowerData.initialized)
      };
    } catch (error) {
      throw new Error('Invalid tickLowerData fee growth values: must be valid numeric strings');
    }

    // Validate tick upper data fee growth values are decimal-only strings
    if (!/^\d+$/.test(tickUpperData.feeGrowthOutside0X128) || !/^\d+$/.test(tickUpperData.feeGrowthOutside1X128)) {
      throw new Error('Invalid tickUpperData fee growth values: must be valid numeric strings');
    }
    try {
      upperTickData = {
        feeGrowthOutside0X128: BigInt(tickUpperData.feeGrowthOutside0X128),
        feeGrowthOutside1X128: BigInt(tickUpperData.feeGrowthOutside1X128),
        initialized: Boolean(tickUpperData.initialized)
      };
    } catch (error) {
      throw new Error('Invalid tickUpperData fee growth values: must be valid numeric strings');
    }

    // Convert global fee growth with validation
    let feeGrowthGlobal0X128BigInt, feeGrowthGlobal1X128BigInt;

    // Validate feeGrowthGlobal0X128 is decimal-only string
    if (!/^\d+$/.test(feeGrowthGlobal0X128)) {
      throw new Error('Invalid feeGrowthGlobal0X128: must be a valid numeric string');
    }
    try {
      feeGrowthGlobal0X128BigInt = BigInt(feeGrowthGlobal0X128);
    } catch (error) {
      throw new Error('Invalid feeGrowthGlobal0X128: must be a valid numeric string');
    }

    // Validate feeGrowthGlobal1X128 is decimal-only string
    if (!/^\d+$/.test(feeGrowthGlobal1X128)) {
      throw new Error('Invalid feeGrowthGlobal1X128: must be a valid numeric string');
    }
    try {
      feeGrowthGlobal1X128BigInt = BigInt(feeGrowthGlobal1X128);
    } catch (error) {
      throw new Error('Invalid feeGrowthGlobal1X128: must be a valid numeric string');
    }

    // Calculate current fee growth inside the position's range
    let feeGrowthInside0X128, feeGrowthInside1X128;

    if (currentTick < position.tickLower) {
      // Current tick is below the position's range
      feeGrowthInside0X128 = lowerTickData.feeGrowthOutside0X128 - upperTickData.feeGrowthOutside0X128;
      feeGrowthInside1X128 = lowerTickData.feeGrowthOutside1X128 - upperTickData.feeGrowthOutside1X128;
    } else if (currentTick >= position.tickUpper) {
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
    const ZERO = 0n;

    if (feeGrowthInside0X128 < ZERO) {
      feeGrowthInside0X128 = feeGrowthInside0X128 + MAX_UINT256;
    }

    if (feeGrowthInside1X128 < ZERO) {
      feeGrowthInside1X128 = feeGrowthInside1X128 + MAX_UINT256;
    }

    // Calculate fee growth since last position update
    let feeGrowthDelta0 = feeGrowthInside0X128 - feeGrowthInside0LastX128;
    let feeGrowthDelta1 = feeGrowthInside1X128 - feeGrowthInside1LastX128;

    // Handle underflow
    if (feeGrowthDelta0 < ZERO) {
      feeGrowthDelta0 = feeGrowthDelta0 + MAX_UINT256;
    }

    if (feeGrowthDelta1 < ZERO) {
      feeGrowthDelta1 = feeGrowthDelta1 + MAX_UINT256;
    }

    // Calculate uncollected fees
    // The formula is: tokensOwed + (liquidity * feeGrowthDelta) / 2^128
    const DENOMINATOR = 2n ** 128n;

    const uncollectedFees0Raw = tokensOwed0 + (liquidity * feeGrowthDelta0) / DENOMINATOR;
    const uncollectedFees1Raw = tokensOwed1 + (liquidity * feeGrowthDelta1) / DENOMINATOR;

    // Return raw bigint values
    return [uncollectedFees0Raw, uncollectedFees1Raw];
  }

  /**
   * Calculate token amounts for a position (if it were to be closed)
   * @param {Object} position - Position object
   * @param {string} position.liquidity - Position liquidity (large value, must be string)
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
   * @param {Object} token1Data - Token1 data
   * @param {string} token1Data.address - Token contract address
   * @param {number} token1Data.decimals - Token decimals
   * @returns {Promise<Array<bigint>>} Array of [token0Raw, token1Raw] amounts
   */
  async calculateTokenAmounts(position, poolData, token0Data, token1Data) {
    // Validate position parameter
    if (!position) {
      throw new Error("position parameter is required");
    }

    // Validate position properties
    if (position.liquidity === null || position.liquidity === undefined) {
      throw new Error("position.liquidity is required");
    }
    if (typeof position.liquidity !== 'string') {
      throw new Error("position.liquidity must be a string");
    }

    // Validate liquidity is a valid positive decimal numeric string
    // Only allow positive decimal strings (no hex, octal, negative, etc.)
    if (!/^\d+$/.test(position.liquidity)) {
      throw new Error('Invalid position.liquidity: must be a valid positive numeric string');
    }

    let liquidityBigInt;
    try {
      liquidityBigInt = BigInt(position.liquidity);
    } catch (error) {
      throw new Error('Invalid position.liquidity: must be a valid positive numeric string');
    }

    if (liquidityBigInt === 0n) {
      return [0n, 0n];
    }

    if (position.tickLower === null || position.tickLower === undefined) {
      throw new Error("position.tickLower is required");
    }
    if (typeof position.tickLower !== 'number' || !Number.isFinite(position.tickLower)) {
      throw new Error("position.tickLower must be a valid number");
    }

    if (position.tickUpper === null || position.tickUpper === undefined) {
      throw new Error("position.tickUpper is required");
    }
    if (typeof position.tickUpper !== 'number' || !Number.isFinite(position.tickUpper)) {
      throw new Error("position.tickUpper must be a valid number");
    }

    // Validate poolData parameter
    if (!poolData) {
      throw new Error("poolData parameter is required");
    }

    // Validate poolData properties
    if (poolData.fee === null || poolData.fee === undefined) {
      throw new Error("poolData.fee is required");
    }
    if (typeof poolData.fee !== 'number' || !Number.isFinite(poolData.fee)) {
      throw new Error("poolData.fee must be a valid number");
    }

    if (!poolData.sqrtPriceX96) {
      throw new Error("poolData.sqrtPriceX96 is required");
    }
    if (typeof poolData.sqrtPriceX96 !== 'string') {
      throw new Error("poolData.sqrtPriceX96 must be a string");
    }

    if (!poolData.liquidity) {
      throw new Error("poolData.liquidity is required");
    }
    if (typeof poolData.liquidity !== 'string') {
      throw new Error("poolData.liquidity must be a string");
    }

    if (poolData.tick === null || poolData.tick === undefined) {
      throw new Error("poolData.tick is required");
    }
    if (typeof poolData.tick !== 'number' || !Number.isFinite(poolData.tick)) {
      throw new Error("poolData.tick must be a valid number");
    }

    // Validate token0Data
    if (!token0Data) {
      throw new Error("token0Data parameter is required");
    }
    if (!token0Data.address) {
      throw new Error("token0Data.address is required");
    }
    try {
      ethers.getAddress(token0Data.address);
    } catch (error) {
      throw new Error(`Invalid token0Data.address: ${token0Data.address}`);
    }
    if (token0Data.decimals === null || token0Data.decimals === undefined) {
      throw new Error("token0Data.decimals is required");
    }
    if (typeof token0Data.decimals !== 'number' || !Number.isFinite(token0Data.decimals)) {
      throw new Error("token0Data.decimals must be a valid number");
    }

    // Validate token1Data
    if (!token1Data) {
      throw new Error("token1Data parameter is required");
    }
    if (!token1Data.address) {
      throw new Error("token1Data.address is required");
    }
    try {
      ethers.getAddress(token1Data.address);
    } catch (error) {
      throw new Error(`Invalid token1Data.address: ${token1Data.address}`);
    }
    if (token1Data.decimals === null || token1Data.decimals === undefined) {
      throw new Error("token1Data.decimals is required");
    }
    if (typeof token1Data.decimals !== 'number' || !Number.isFinite(token1Data.decimals)) {
      throw new Error("token1Data.decimals must be a valid number");
    }

    try {

      // Create Token objects - use chainId from instance
      const token0 = new Token(
        this.chainId,
        token0Data.address,
        token0Data.decimals
      );

      const token1 = new Token(
        this.chainId,
        token1Data.address,
        token1Data.decimals
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
        liquidity: position.liquidity,
        tickLower: position.tickLower,
        tickUpper: position.tickUpper
      });

      // Get token amounts
      const amount0 = positionInstance.amount0;
      const amount1 = positionInstance.amount1;

      return [
        BigInt(amount0.quotient.toString()),
        BigInt(amount1.quotient.toString())
      ];
    } catch (error) {
      console.error("Error calculating token amounts:", error);
      throw error;
    }
  }

  /**
   * Discover available pools for a token pair across all fee tiers
   * @param {string} token0Address - Address of first token
   * @param {string} token1Address - Address of second token
   * @param {Object} provider - Ethers provider instance
   * @returns {Promise<Array>} Array of pool information objects
   */
  async discoverAvailablePools(token0Address, token1Address, provider) {
    // Validate token0 address
    if (!token0Address) {
      throw new Error("Token0 address parameter is required");
    }
    try {
      ethers.getAddress(token0Address);
    } catch (error) {
      throw new Error(`Invalid token0 address: ${token0Address}`);
    }

    // Validate token1 address
    if (!token1Address) {
      throw new Error("Token1 address parameter is required");
    }
    try {
      ethers.getAddress(token1Address);
    } catch (error) {
      throw new Error(`Invalid token1 address: ${token1Address}`);
    }

    // Validate provider
    await this._validateProviderChain(provider);

    const feeTiers = getPlatformFeeTiers('uniswapV3');
    const pools = [];

    for (const fee of feeTiers) {
      const poolAddress = await this.getPoolAddress(token0Address, token1Address, fee, provider);

      if (poolAddress === ethers.ZeroAddress) {
        continue; // Expected - no pool for this fee tier
      }

      const poolContract = new ethers.Contract(poolAddress, this.uniswapV3PoolABI, provider);

      let poolData;
      try {
        poolData = await Promise.all([
          poolContract.slot0(),
          poolContract.liquidity()
        ]);
      } catch (firstError) {
        // Log transient error for monitoring (retry will follow)
        console.warn(`Pool ${poolAddress} (fee: ${fee}) initial fetch failed, retrying:`, firstError.message);

        // Retry once after delay for transient errors
        await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay
        try {
          poolData = await Promise.all([
            poolContract.slot0(),
            poolContract.liquidity()
          ]);
        } catch (secondError) {
          throw new Error(`Pool ${poolAddress} (fee: ${fee}) failed after retry: ${secondError.message}`);
        }
      }

      const [slot0, liquidity] = poolData;

      if (liquidity > 0) {
        pools.push({
          address: poolAddress,
          fee,
          liquidity: liquidity.toString(),
          sqrtPriceX96: slot0.sqrtPriceX96.toString(),
          tick: slot0.tick
        });
      }
    }

    return pools;
  }

  /**
   * Generate transaction data for claiming fees from a position
   * @param {Object} params - Parameters for generating claim fees data
   * @param {string|number} params.positionId - Position NFT token ID
   * @param {Object} params.provider - Ethers provider
   * @param {string} params.walletAddress - User's wallet address
   * @param {string} params.token0Address - Token0 address
   * @param {string} params.token1Address - Token1 address
   * @param {number} params.token0Decimals - Token0 decimals
   * @param {number} params.token1Decimals - Token1 decimals
   * @returns {Object} Transaction data object with `to`, `data`, `value` properties
   * @throws {Error} If parameters are invalid or transaction data cannot be generated
   */
  async generateClaimFeesData(params) {
    const { positionId, provider, walletAddress, token0Address, token1Address, token0Decimals, token1Decimals } = params;

    // Input validation
    if (positionId === null || positionId === undefined) {
      throw new Error("Position ID is required");
    }

    // Validate positionId is a numeric string
    if (typeof positionId !== 'string') {
      throw new Error('positionId must be a string');
    }
    if (!/^\d+$/.test(positionId)) {
      throw new Error('positionId must be a numeric string');
    }

    // Validate token0 address
    if (!token0Address) {
      throw new Error("Token0 address parameter is required");
    }
    try {
      ethers.getAddress(token0Address);
    } catch (error) {
      throw new Error(`Invalid token0 address: ${token0Address}`);
    }

    // Validate token1 address
    if (!token1Address) {
      throw new Error("Token1 address parameter is required");
    }
    try {
      ethers.getAddress(token1Address);
    } catch (error) {
      throw new Error(`Invalid token1 address: ${token1Address}`);
    }

    // Validate wallet address
    if (!walletAddress) {
      throw new Error("Wallet address parameter is required");
    }
    try {
      ethers.getAddress(walletAddress);
    } catch (error) {
      throw new Error(`Invalid wallet address: ${walletAddress}`);
    }

    // Validate token decimals
    if (token0Decimals === null || token0Decimals === undefined) {
      throw new Error("Token0 decimals is required");
    }
    if (typeof token0Decimals !== 'number' || !Number.isFinite(token0Decimals)) {
      throw new Error("Token0 decimals must be a valid number");
    }

    if (token1Decimals === null || token1Decimals === undefined) {
      throw new Error("Token1 decimals is required");
    }
    if (typeof token1Decimals !== 'number' || !Number.isFinite(token1Decimals)) {
      throw new Error("Token1 decimals must be a valid number");
    }

    // Validate provider
    await this._validateProviderChain(provider);

    try {
      // Get position manager address from cached addresses
      if (!this.addresses?.positionManagerAddress) {
        throw new Error(`No position manager address found for chainId: ${this.chainId}`);
      }
      const positionManagerAddress = this.addresses.positionManagerAddress;


      // Create Token instances for the SDK
      const token0 = new Token(
        this.chainId,
        token0Address,
        token0Decimals
      );

      const token1 = new Token(
        this.chainId,
        token1Address,
        token1Decimals
      );

      // Create collectOptions object to collect ALL available fees
      const collectOptions = {
        tokenId: positionId,
        expectedCurrencyOwed0: CurrencyAmount.fromRawAmount(
          token0,
          MaxUint128
        ),
        expectedCurrencyOwed1: CurrencyAmount.fromRawAmount(
          token1,
          MaxUint128
        ),
        recipient: walletAddress
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
      throw new Error(`Failed to generate claim fees data: ${error.message}`);
    }
  }

  /**
   * Generate transaction data for removing liquidity from a position
   * @param {Object} params - Parameters for generating remove liquidity data
   * @param {Object} params.position - Position object with required properties
   * @param {string} params.position.id - Position NFT token ID
   * @param {number} params.position.tickLower - Lower tick boundary of the position
   * @param {number} params.position.tickUpper - Upper tick boundary of the position
   * @param {number} params.percentage - Percentage of liquidity to remove (1-100)
   * @param {Object} params.provider - Ethers provider instance
   * @param {string} params.walletAddress - User's wallet address (recipient of tokens and fees)
   * @param {Object} params.poolData - Current pool state data
   * @param {number} params.poolData.fee - Pool fee tier (e.g., 500, 3000, 10000)
   * @param {string} params.poolData.sqrtPriceX96 - Current pool price as sqrt(price) * 2^96
   * @param {string} params.poolData.liquidity - Current pool liquidity
   * @param {number} params.poolData.tick - Current pool tick
   * @param {Object} params.token0Data - First token data (will be sorted by address)
   * @param {string} params.token0Data.address - Token contract address
   * @param {number} params.token0Data.decimals - Token decimal places
   * @param {Object} params.token1Data - Second token data (will be sorted by address)
   * @param {string} params.token1Data.address - Token contract address
   * @param {number} params.token1Data.decimals - Token decimal places
   * @param {number} params.slippageTolerance - Slippage tolerance percentage (e.g., 0.5 for 0.5%)
   * @param {number} params.deadlineMinutes - Transaction deadline in minutes from now
   * @returns {Object} Transaction data object with `to`, `data`, `value` properties
   * @throws {Error} If parameters are invalid or transaction data cannot be generated
   */
  async generateRemoveLiquidityData(params) {
    const {
      position,
      percentage,
      provider,
      walletAddress,
      poolData,
      token0Data,
      token1Data,
      slippageTolerance,
      deadlineMinutes
    } = params;

    // Input validation
    if (position === null || position === undefined) {
      throw new Error("Position parameter is required");
    }
    if (typeof position !== 'object' || Array.isArray(position)) {
      throw new Error("Position must be an object");
    }
    if (position.id === null || position.id === undefined) {
      throw new Error("Position ID is required");
    }
    if (typeof position.id !== 'string') {
      throw new Error('Position ID must be a string');
    }
    if (!/^\d+$/.test(position.id)) {
      throw new Error('Position ID must be a numeric string');
    }
    if (position.tickLower === null || position.tickLower === undefined) {
      throw new Error("Position tickLower is required");
    }
    if (!Number.isFinite(position.tickLower)) {
      throw new Error("Position tickLower must be a finite number");
    }
    if (position.tickUpper === null || position.tickUpper === undefined) {
      throw new Error("Position tickUpper is required");
    }
    if (!Number.isFinite(position.tickUpper)) {
      throw new Error("Position tickUpper must be a finite number");
    }
    if (position.tickLower >= position.tickUpper) {
      throw new Error("Position tickLower must be less than tickUpper");
    }

    if (percentage === null || percentage === undefined) {
      throw new Error("Percentage parameter is required");
    }
    if (!Number.isFinite(percentage)) {
      throw new Error("Percentage must be a finite number");
    }
    if (percentage <= 0 || percentage > 100) {
      throw new Error("Percentage must be between 1 and 100");
    }

    if (provider === null || provider === undefined) {
      throw new Error("Provider is required");
    }
    if (typeof provider !== 'object' || Array.isArray(provider)) {
      throw new Error("Provider must be an ethers provider object");
    }

    if (walletAddress === null || walletAddress === undefined || walletAddress === '') {
      throw new Error("Wallet address is required");
    }
    if (typeof walletAddress !== 'string') {
      throw new Error("Wallet address must be a string");
    }
    try {
      ethers.getAddress(walletAddress);
    } catch (error) {
      throw new Error(`Invalid wallet address: ${walletAddress}`);
    }

    if (poolData === null || poolData === undefined) {
      throw new Error("Pool data parameter is required");
    }
    if (typeof poolData !== 'object' || Array.isArray(poolData)) {
      throw new Error("Pool data must be an object");
    }
    if (poolData.fee === null || poolData.fee === undefined) {
      throw new Error("Pool data fee is required");
    }
    if (!Number.isFinite(poolData.fee) || poolData.fee < 0) {
      throw new Error("Pool data fee must be a non-negative finite number");
    }
    if (!poolData.sqrtPriceX96) {
      throw new Error("Pool data sqrtPriceX96 is required");
    }
    if (typeof poolData.sqrtPriceX96 !== 'string') {
      throw new Error("Pool data sqrtPriceX96 must be a string");
    }
    if (!/^\d+$/.test(poolData.sqrtPriceX96)) {
      throw new Error("Pool data sqrtPriceX96 must be a positive numeric string");
    }
    if (!poolData.liquidity) {
      throw new Error("Pool data liquidity is required");
    }
    if (typeof poolData.liquidity !== 'string') {
      throw new Error("Pool data liquidity must be a string");
    }
    if (!/^\d+$/.test(poolData.liquidity)) {
      throw new Error("Pool data liquidity must be a positive numeric string");
    }
    if (poolData.tick === null || poolData.tick === undefined) {
      throw new Error("Pool data tick is required");
    }
    if (!Number.isFinite(poolData.tick)) {
      throw new Error("Pool data tick must be a finite number");
    }

    if (token0Data === null || token0Data === undefined) {
      throw new Error("Token0 data parameter is required");
    }
    if (typeof token0Data !== 'object' || Array.isArray(token0Data)) {
      throw new Error("Token0 data must be an object");
    }
    if (token0Data.address === null || token0Data.address === undefined || token0Data.address === '') {
      throw new Error("Token0 address is required");
    }
    if (typeof token0Data.address !== 'string') {
      throw new Error("Token0 address must be a string");
    }
    try {
      ethers.getAddress(token0Data.address);
    } catch (error) {
      throw new Error(`Invalid token0 address: ${token0Data.address}`);
    }
    if (token0Data.decimals === null || token0Data.decimals === undefined) {
      throw new Error("Token0 decimals is required");
    }
    if (!Number.isFinite(token0Data.decimals) || token0Data.decimals < 0 || token0Data.decimals > 255) {
      throw new Error("Token0 decimals must be a finite number between 0 and 255");
    }

    if (token1Data === null || token1Data === undefined) {
      throw new Error("Token1 data parameter is required");
    }
    if (typeof token1Data !== 'object' || Array.isArray(token1Data)) {
      throw new Error("Token1 data must be an object");
    }
    if (token1Data.address === null || token1Data.address === undefined || token1Data.address === '') {
      throw new Error("Token1 address is required");
    }
    if (typeof token1Data.address !== 'string') {
      throw new Error("Token1 address must be a string");
    }
    try {
      ethers.getAddress(token1Data.address);
    } catch (error) {
      throw new Error(`Invalid token1 address: ${token1Data.address}`);
    }
    if (token1Data.decimals === null || token1Data.decimals === undefined) {
      throw new Error("Token1 decimals is required");
    }
    if (!Number.isFinite(token1Data.decimals) || token1Data.decimals < 0 || token1Data.decimals > 255) {
      throw new Error("Token1 decimals must be a finite number between 0 and 255");
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

    try {
      // Get position manager address from cached addresses
      if (!this.addresses?.positionManagerAddress) {
        throw new Error(`No position manager address found for chainId: ${this.chainId}`);
      }
      const positionManagerAddress = this.addresses.positionManagerAddress;

      // Get current position data from contract FIRST to ensure correct token order
      const nftManager = new ethers.Contract(
        positionManagerAddress,
        this.nonfungiblePositionManagerABI,
        provider
      );

      const positionData = await nftManager.positions(position.id);

      // Use sortTokens to get correct Uniswap token ordering
      const { sortedToken0, sortedToken1 } = this.sortTokens(token0Data, token1Data);

      // Verify the sorted tokens match the position's token order
      if (positionData.token0.toLowerCase() !== sortedToken0.address.toLowerCase() ||
          positionData.token1.toLowerCase() !== sortedToken1.address.toLowerCase()) {
        throw new Error(`Token mismatch: position tokens (${positionData.token0}, ${positionData.token1}) don't match provided tokens (${token0Data.address}, ${token1Data.address})`);
      }

      // Create Token instances for the SDK with correct order
      const token0 = new Token(
        this.chainId,
        sortedToken0.address,
        sortedToken0.decimals
      );

      const token1 = new Token(
        this.chainId,
        sortedToken1.address,
        sortedToken1.decimals
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

      // Always collect all available fees when removing liquidity
      const expectedCurrencyOwed0 = CurrencyAmount.fromRawAmount(token0, MaxUint128);
      const expectedCurrencyOwed1 = CurrencyAmount.fromRawAmount(token1, MaxUint128);

      // Create CollectOptions to collect fees in the same transaction
      const collectOptions = {
        expectedCurrencyOwed0,
        expectedCurrencyOwed1,
        recipient: walletAddress
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
   * Generate transaction data for adding liquidity to an existing position
   * @param {Object} params - Parameters for generating add liquidity data
   * @param {Object} params.position - Position object with ID and tick range
   * @param {string} params.position.id - Position NFT token ID
   * @param {number} params.position.tickLower - Lower tick of the position range
   * @param {number} params.position.tickUpper - Upper tick of the position range
   * @param {string} params.token0Amount - Amount of token0 to add (in human readable format)
   * @param {string} params.token1Amount - Amount of token1 to add (in human readable format)
   * @param {Object} params.provider - Ethers provider
   * @param {Object} params.poolData - Pool data for the position
   * @param {number} params.poolData.fee - Pool fee tier (100, 500, 3000, 10000)
   * @param {string} params.poolData.sqrtPriceX96 - Current pool price in sqrt format
   * @param {string} params.poolData.liquidity - Current pool liquidity
   * @param {number} params.poolData.tick - Current pool tick
   * @param {Object} params.token0Data - Token0 data
   * @param {string} params.token0Data.address - Token0 contract address
   * @param {number} params.token0Data.decimals - Token0 decimal places
   * @param {Object} params.token1Data - Token1 data
   * @param {string} params.token1Data.address - Token1 contract address
   * @param {number} params.token1Data.decimals - Token1 decimal places
   * @param {number} params.slippageTolerance - Slippage tolerance percentage (0-100)
   * @param {number} [params.deadlineMinutes=20] - Transaction deadline in minutes
   * @returns {Object} Transaction data object with `to`, `data`, `value` properties and `quote` with full getAddLiquidityQuote result
   * @throws {Error} If parameters are invalid or transaction data cannot be generated
   */
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

    // Input validation
    if (position === null || position === undefined) {
      throw new Error("Position parameter is required");
    }
    if (typeof position !== 'object' || Array.isArray(position)) {
      throw new Error("Position must be an object");
    }
    if (position.id === null || position.id === undefined) {
      throw new Error("Position ID is required");
    }
    if (typeof position.id !== 'string') {
      throw new Error('Position ID must be a string');
    }
    if (!/^\d+$/.test(position.id)) {
      throw new Error('Position ID must be a numeric string');
    }
    if (position.tickLower === null || position.tickLower === undefined) {
      throw new Error("Position tickLower is required");
    }
    if (!Number.isFinite(position.tickLower)) {
      throw new Error("Position tickLower must be a finite number");
    }
    if (position.tickUpper === null || position.tickUpper === undefined) {
      throw new Error("Position tickUpper is required");
    }
    if (!Number.isFinite(position.tickUpper)) {
      throw new Error("Position tickUpper must be a finite number");
    }
    if (position.tickLower >= position.tickUpper) {
      throw new Error("Position tickLower must be less than tickUpper");
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

    // Validate provider using existing method
    await this._validateProviderChain(provider);

    if (poolData === null || poolData === undefined) {
      throw new Error("Pool data parameter is required");
    }
    if (typeof poolData !== 'object' || Array.isArray(poolData)) {
      throw new Error("Pool data must be an object");
    }
    if (poolData.fee === null || poolData.fee === undefined) {
      throw new Error("Pool data fee is required");
    }
    if (!Number.isFinite(poolData.fee) || poolData.fee < 0) {
      throw new Error("Pool data fee must be a non-negative finite number");
    }
    if (!poolData.sqrtPriceX96) {
      throw new Error("Pool data sqrtPriceX96 is required");
    }
    if (typeof poolData.sqrtPriceX96 !== 'string') {
      throw new Error("Pool data sqrtPriceX96 must be a string");
    }
    if (!/^\d+$/.test(poolData.sqrtPriceX96)) {
      throw new Error("Pool data sqrtPriceX96 must be a positive numeric string");
    }
    if (!poolData.liquidity) {
      throw new Error("Pool data liquidity is required");
    }
    if (typeof poolData.liquidity !== 'string') {
      throw new Error("Pool data liquidity must be a string");
    }
    if (!/^\d+$/.test(poolData.liquidity)) {
      throw new Error("Pool data liquidity must be a positive numeric string");
    }
    if (poolData.tick === null || poolData.tick === undefined) {
      throw new Error("Pool data tick is required");
    }
    if (!Number.isFinite(poolData.tick)) {
      throw new Error("Pool data tick must be a finite number");
    }

    if (token0Data === null || token0Data === undefined) {
      throw new Error("Token0 data parameter is required");
    }
    if (typeof token0Data !== 'object' || Array.isArray(token0Data)) {
      throw new Error("Token0 data must be an object");
    }
    if (token0Data.address === null || token0Data.address === undefined || token0Data.address === '') {
      throw new Error("Token0 address is required");
    }
    if (typeof token0Data.address !== 'string') {
      throw new Error("Token0 address must be a string");
    }
    try {
      ethers.getAddress(token0Data.address);
    } catch (error) {
      throw new Error(`Invalid token0 address: ${token0Data.address}`);
    }
    if (token0Data.decimals === null || token0Data.decimals === undefined) {
      throw new Error("Token0 decimals is required");
    }
    if (!Number.isFinite(token0Data.decimals) || token0Data.decimals < 0 || token0Data.decimals > 255) {
      throw new Error("Token0 decimals must be a finite number between 0 and 255");
    }

    if (token1Data === null || token1Data === undefined) {
      throw new Error("Token1 data parameter is required");
    }
    if (typeof token1Data !== 'object' || Array.isArray(token1Data)) {
      throw new Error("Token1 data must be an object");
    }
    if (token1Data.address === null || token1Data.address === undefined || token1Data.address === '') {
      throw new Error("Token1 address is required");
    }
    if (typeof token1Data.address !== 'string') {
      throw new Error("Token1 address must be a string");
    }
    try {
      ethers.getAddress(token1Data.address);
    } catch (error) {
      throw new Error(`Invalid token1 address: ${token1Data.address}`);
    }
    if (token1Data.decimals === null || token1Data.decimals === undefined) {
      throw new Error("Token1 decimals is required");
    }
    if (!Number.isFinite(token1Data.decimals) || token1Data.decimals < 0 || token1Data.decimals > 255) {
      throw new Error("Token1 decimals must be a finite number between 0 and 255");
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

    try {
      // Get position manager address from platform addresses
      if (!this.addresses?.positionManagerAddress) {
        throw new Error(`No position manager address found for chainId: ${this.chainId}`);
      }
      const positionManagerAddress = this.addresses.positionManagerAddress;

      // Use getAddLiquidityQuote to calculate the position
      const quote = await this.getAddLiquidityQuote({
        position,
        token0Amount,
        token1Amount,
        provider,
        poolData,
        token0Data,
        token1Data
      });

      // Extract the calculated position and metadata
      const { position: positionToIncreaseBy, tokensSwapped, sortedToken0, sortedToken1 } = quote;

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

      // Return transaction data with calculated amounts
      return {
        to: positionManagerAddress,
        data: calldata,
        value: value,
        quote: quote
      };
    } catch (error) {
      console.error("Error generating add liquidity data:", error);
      throw new Error(`Failed to generate add liquidity data: ${error.message}`);
    }
  }

  /**
   * Get liquidity quote for adding liquidity to a position
   * @param {Object} params - Parameters for getting add liquidity quote
   * @param {Object} params.position - Position object with tick range
   * @param {number} params.position.tickLower - Lower tick of the position range
   * @param {number} params.position.tickUpper - Upper tick of the position range
   * @param {string} params.token0Amount - Amount of token0 to add (in wei string)
   * @param {string} params.token1Amount - Amount of token1 to add (in wei string)
   * @param {Object} params.provider - Ethers provider
   * @param {Object} params.poolData - Pool data for the position
   * @param {number} params.poolData.fee - Pool fee tier (100, 500, 3000, 10000)
   * @param {string} params.poolData.sqrtPriceX96 - Current pool price in sqrt format
   * @param {string} params.poolData.liquidity - Current pool liquidity
   * @param {number} params.poolData.tick - Current pool tick
   * @param {Object} params.token0Data - Token0 data
   * @param {string} params.token0Data.address - Token0 contract address
   * @param {number} params.token0Data.decimals - Token0 decimal places
   * @param {Object} params.token1Data - Token1 data
   * @param {string} params.token1Data.address - Token1 contract address
   * @param {number} params.token1Data.decimals - Token1 decimal places
   * @returns {Promise<Object>} Position object with calculated amounts
   * @throws {Error} If parameters are invalid or quote cannot be calculated
   */
  async getAddLiquidityQuote(params) {
    const {
      position,
      token0Amount,
      token1Amount,
      provider,
      poolData,
      token0Data,
      token1Data
    } = params;

    // Input validation (same as generateAddLiquidityData except for slippage and deadline)
    if (position === null || position === undefined) {
      throw new Error("Position parameter is required");
    }
    if (typeof position !== 'object' || Array.isArray(position)) {
      throw new Error("Position must be an object");
    }
    if (position.tickLower === null || position.tickLower === undefined) {
      throw new Error("Position tickLower is required");
    }
    if (!Number.isFinite(position.tickLower)) {
      throw new Error("Position tickLower must be a finite number");
    }
    if (position.tickUpper === null || position.tickUpper === undefined) {
      throw new Error("Position tickUpper is required");
    }
    if (!Number.isFinite(position.tickUpper)) {
      throw new Error("Position tickUpper must be a finite number");
    }
    if (position.tickLower >= position.tickUpper) {
      throw new Error("Position tickLower must be less than tickUpper");
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

    // Validate provider using existing method
    await this._validateProviderChain(provider);

    if (poolData === null || poolData === undefined) {
      throw new Error("Pool data parameter is required");
    }
    if (typeof poolData !== 'object' || Array.isArray(poolData)) {
      throw new Error("Pool data must be an object");
    }
    if (poolData.fee === null || poolData.fee === undefined) {
      throw new Error("Pool data fee is required");
    }
    if (!Number.isFinite(poolData.fee) || poolData.fee < 0) {
      throw new Error("Pool data fee must be a non-negative finite number");
    }
    if (!poolData.sqrtPriceX96) {
      throw new Error("Pool data sqrtPriceX96 is required");
    }
    if (typeof poolData.sqrtPriceX96 !== 'string') {
      throw new Error("Pool data sqrtPriceX96 must be a string");
    }
    if (!/^\d+$/.test(poolData.sqrtPriceX96)) {
      throw new Error("Pool data sqrtPriceX96 must be a positive numeric string");
    }
    if (!poolData.liquidity) {
      throw new Error("Pool data liquidity is required");
    }
    if (typeof poolData.liquidity !== 'string') {
      throw new Error("Pool data liquidity must be a string");
    }
    if (!/^\d+$/.test(poolData.liquidity)) {
      throw new Error("Pool data liquidity must be a positive numeric string");
    }
    if (poolData.tick === null || poolData.tick === undefined) {
      throw new Error("Pool data tick is required");
    }
    if (!Number.isFinite(poolData.tick)) {
      throw new Error("Pool data tick must be a finite number");
    }

    if (token0Data === null || token0Data === undefined) {
      throw new Error("Token0 data parameter is required");
    }
    if (typeof token0Data !== 'object' || Array.isArray(token0Data)) {
      throw new Error("Token0 data must be an object");
    }
    if (token0Data.address === null || token0Data.address === undefined || token0Data.address === '') {
      throw new Error("Token0 address is required");
    }
    if (typeof token0Data.address !== 'string') {
      throw new Error("Token0 address must be a string");
    }
    try {
      ethers.getAddress(token0Data.address);
    } catch (error) {
      throw new Error(`Invalid token0 address: ${token0Data.address}`);
    }
    if (token0Data.decimals === null || token0Data.decimals === undefined) {
      throw new Error("Token0 decimals is required");
    }
    if (!Number.isFinite(token0Data.decimals) || token0Data.decimals < 0 || token0Data.decimals > 255) {
      throw new Error("Token0 decimals must be a finite number between 0 and 255");
    }

    if (token1Data === null || token1Data === undefined) {
      throw new Error("Token1 data parameter is required");
    }
    if (typeof token1Data !== 'object' || Array.isArray(token1Data)) {
      throw new Error("Token1 data must be an object");
    }
    if (token1Data.address === null || token1Data.address === undefined || token1Data.address === '') {
      throw new Error("Token1 address is required");
    }
    if (typeof token1Data.address !== 'string') {
      throw new Error("Token1 address must be a string");
    }
    try {
      ethers.getAddress(token1Data.address);
    } catch (error) {
      throw new Error(`Invalid token1 address: ${token1Data.address}`);
    }
    if (token1Data.decimals === null || token1Data.decimals === undefined) {
      throw new Error("Token1 decimals is required");
    }
    if (!Number.isFinite(token1Data.decimals) || token1Data.decimals < 0 || token1Data.decimals > 255) {
      throw new Error("Token1 decimals must be a finite number between 0 and 255");
    }

    try {
      // Use sortTokens to get correct Uniswap token ordering
      const { sortedToken0, sortedToken1, tokensSwapped } = this.sortTokens(token0Data, token1Data);

      // Create Token instances for the SDK with correct order
      const token0 = new Token(
        this.chainId,
        sortedToken0.address,
        sortedToken0.decimals
      );

      const token1 = new Token(
        this.chainId,
        sortedToken1.address,
        sortedToken1.decimals
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

      // Convert token amounts to JSBI for the SDK, accounting for token sorting
      // For missing amounts, use 0 (Uniswap SDK will calculate optimal amounts)
      let amount0, amount1;

      if (tokensSwapped) {
        amount0 = JSBI.BigInt(token1Amount);
        amount1 = JSBI.BigInt(token0Amount);
      } else {
        amount0 = JSBI.BigInt(token0Amount);
        amount1 = JSBI.BigInt(token1Amount);
      }

      // Create a Position instance to represent the amount we want to add
      let quotePosition;

      if (JSBI.equal(amount1, JSBI.BigInt(0))) {
        // Only token0 - use fromAmount0
        quotePosition = Position.fromAmount0({
          pool,
          tickLower: position.tickLower,
          tickUpper: position.tickUpper,
          amount0,
          useFullPrecision: true,
        });
      } else if (JSBI.equal(amount0, JSBI.BigInt(0))) {
        // Only token1 - use fromAmount1
        quotePosition = Position.fromAmount1({
          pool,
          tickLower: position.tickLower,
          tickUpper: position.tickUpper,
          amount1,
          useFullPrecision: true,
        });
      } else {
        // Both tokens - use fromAmounts
        quotePosition = Position.fromAmounts({
          pool,
          tickLower: position.tickLower,
          tickUpper: position.tickUpper,
          amount0,
          amount1,
          useFullPrecision: true,
        });
      }

      // Return the Position object with additional metadata
      return {
        position: quotePosition,
        tokensSwapped,
        sortedToken0,
        sortedToken1,
        pool
      };
    } catch (error) {
      console.error("Error calculating add liquidity quote:", error);
      throw new Error(`Failed to calculate add liquidity quote: ${error.message}`);
    }
  }

  /**
   * Get expected output amount for a swap using Quoter contract
   * @param {Object} params - Parameters for getting swap quote
   * @param {string} params.tokenInAddress - Address of input token
   * @param {string} params.tokenOutAddress - Address of output token
   * @param {number} params.fee - Fee tier (e.g., 500, 3000, 10000)
   * @param {string} params.amountIn - Amount of input tokens (in wei string)
   * @param {Object} params.provider - Ethers provider instance
   * @returns {Promise<string>} Expected output amount in wei string
   * @throws {Error} If quote cannot be calculated
   */
  async getSwapQuote(params) {
    const { tokenInAddress, tokenOutAddress, fee, amountIn, provider } = params;

    // Validate tokenIn address
    if (!tokenInAddress) {
      throw new Error("TokenIn address parameter is required");
    }
    try {
      ethers.getAddress(tokenInAddress);
    } catch (error) {
      throw new Error(`Invalid tokenIn address: ${tokenInAddress}`);
    }

    // Validate tokenOut address
    if (!tokenOutAddress) {
      throw new Error("TokenOut address parameter is required");
    }
    try {
      ethers.getAddress(tokenOutAddress);
    } catch (error) {
      throw new Error(`Invalid tokenOut address: ${tokenOutAddress}`);
    }

    // Validate fee
    if (fee === null || fee === undefined) {
      throw new Error("Fee parameter is required");
    }
    if (typeof fee !== 'number' || !Number.isFinite(fee)) {
      throw new Error("Fee must be a valid number");
    }
    if (!this.feeTiers.includes(fee)) {
      throw new Error(`Invalid fee tier: ${fee}. Must be one of: ${this.feeTiers.join(', ')}`);
    }

    // Validate amountIn
    if (!amountIn) {
      throw new Error("AmountIn parameter is required");
    }
    if (typeof amountIn !== 'string') {
      throw new Error("AmountIn must be a string");
    }
    if (!/^\d+$/.test(amountIn)) {
      throw new Error("AmountIn must be a positive numeric string");
    }
    if (amountIn === '0') {
      throw new Error("AmountIn cannot be zero");
    }

    // Validate provider
    await this._validateProviderChain(provider);

    // Use quoter address from config
    if (!this.addresses?.quoterAddress) {
      throw new Error(`No Uniswap V3 quoter address found for chainId: ${this.chainId}`);
    }

    try {
      const quoterContract = new ethers.Contract(this.addresses.quoterAddress, this.quoterABI, provider);

      // QuoterV2 takes a struct parameter
      const params = {
        tokenIn: tokenInAddress,
        tokenOut: tokenOutAddress,
        fee: fee,
        amountIn: amountIn,
        sqrtPriceLimitX96: 0 // No price limit
      };

      const result = await quoterContract.quoteExactInputSingle.staticCall(params);

      // QuoterV2 returns [amountOut, sqrtPriceX96After]
      return result[0].toString();
    } catch (error) {
      throw new Error(`Failed to get swap quote: ${error.message}`);
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
   * @param {number} params.slippageTolerance - Slippage tolerance percentage (0-100)
   * @param {string} params.sqrtPriceLimitX96 - Price limit (0 for no limit)
   * @param {number} params.deadlineMinutes - Transaction deadline in minutes
   * @param {Object} params.provider - Ethers provider
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
      slippageTolerance,
      sqrtPriceLimitX96,
      deadlineMinutes,
      provider
    } = params;

    // Validate tokenIn address
    if (!tokenIn) {
      throw new Error("TokenIn address parameter is required");
    }
    try {
      ethers.getAddress(tokenIn);
    } catch (error) {
      throw new Error(`Invalid tokenIn address: ${tokenIn}`);
    }

    // Validate tokenOut address
    if (!tokenOut) {
      throw new Error("TokenOut address parameter is required");
    }
    try {
      ethers.getAddress(tokenOut);
    } catch (error) {
      throw new Error(`Invalid tokenOut address: ${tokenOut}`);
    }

    // Validate fee
    if (fee === null || fee === undefined) {
      throw new Error("Fee parameter is required");
    }
    if (typeof fee !== 'number' || !Number.isFinite(fee)) {
      throw new Error("Fee must be a valid number");
    }
    if (!this.feeTiers.includes(fee)) {
      throw new Error(`Invalid fee tier: ${fee}. Must be one of: ${this.feeTiers.join(', ')}`);
    }

    // Validate recipient address
    if (!recipient) {
      throw new Error("Recipient address parameter is required");
    }
    try {
      ethers.getAddress(recipient);
    } catch (error) {
      throw new Error(`Invalid recipient address: ${recipient}`);
    }

    // Validate amountIn
    if (!amountIn) {
      throw new Error("AmountIn parameter is required");
    }
    if (typeof amountIn !== 'string') {
      throw new Error("AmountIn must be a string");
    }
    if (!/^\d+$/.test(amountIn)) {
      throw new Error("AmountIn must be a positive numeric string");
    }
    if (amountIn === '0') {
      throw new Error("AmountIn cannot be zero");
    }

    // Validate slippage tolerance
    if (slippageTolerance === null || slippageTolerance === undefined) {
      throw new Error("Slippage tolerance is required");
    }
    if (!Number.isFinite(slippageTolerance)) {
      throw new Error("Slippage tolerance must be a finite number");
    }
    if (slippageTolerance < 0 || slippageTolerance > 100) {
      throw new Error("Slippage tolerance must be between 0 and 100");
    }

    // Validate sqrtPriceLimitX96
    if (sqrtPriceLimitX96 === null || sqrtPriceLimitX96 === undefined) {
      throw new Error("sqrtPriceLimitX96 parameter is required");
    }
    if (typeof sqrtPriceLimitX96 !== 'string') {
      throw new Error("sqrtPriceLimitX96 must be a string");
    }
    if (!/^\d+$/.test(sqrtPriceLimitX96)) {
      throw new Error("sqrtPriceLimitX96 must be a positive numeric string");
    }

    // Validate deadlineMinutes
    if (deadlineMinutes === null || deadlineMinutes === undefined) {
      throw new Error("Deadline minutes is required");
    }
    if (!Number.isFinite(deadlineMinutes) || deadlineMinutes < 0) {
      throw new Error("Deadline minutes must be a non-negative number");
    }

    // Validate provider
    await this._validateProviderChain(provider);

    // Use cached router address
    if (!this.addresses?.routerAddress) {
      throw new Error(`No Uniswap V3 router address found for chainId: ${this.chainId}`);
    }

    const routerAddress = this.addresses.routerAddress;

    try {
      // Get quote for the swap
      const expectedAmountOut = await this.getSwapQuote({
        tokenInAddress: tokenIn,
        tokenOutAddress: tokenOut,
        fee,
        amountIn,
        provider
      });

      // Calculate minimum amount out with slippage
      const expectedAmountOutBigInt = BigInt(expectedAmountOut);
      const slippageMultiplier = BigInt(Math.floor((100 - slippageTolerance) * 100));
      const amountOutMinimum = (expectedAmountOutBigInt * slippageMultiplier / 10000n).toString();

      // Create swap parameters for exactInputSingle
      const swapParams = {
        tokenIn,
        tokenOut,
        fee,
        recipient,
        deadline: this._createDeadline(deadlineMinutes),
        amountIn,
        amountOutMinimum,
        sqrtPriceLimitX96
      };

      // Encode the function call
      const data = this.swapRouterInterface.encodeFunctionData("exactInputSingle", [swapParams]);

      return {
        to: routerAddress,
        data,
        value: "0x00"
      };

    } catch (error) {
      throw new Error(`Failed to generate swap data: ${error.message}`);
    }
  }

  /**
   * Generate transaction data for creating a new position
   * @param {Object} params - Parameters for generating create position data
   * @param {Object} params.position - Position object with tick range
   * @param {number} params.position.tickLower - Lower tick of the position range
   * @param {number} params.position.tickUpper - Upper tick of the position range
   * @param {string} params.token0Amount - Amount of token0 to add (in human readable format)
   * @param {string} params.token1Amount - Amount of token1 to add (in human readable format)
   * @param {Object} params.provider - Ethers provider
   * @param {string} params.walletAddress - User's wallet address
   * @param {Object} params.poolData - Pool data for the position
   * @param {number} params.poolData.fee - Pool fee tier (100, 500, 3000, 10000)
   * @param {string} params.poolData.sqrtPriceX96 - Current pool price in sqrt format
   * @param {string} params.poolData.liquidity - Current pool liquidity
   * @param {number} params.poolData.tick - Current pool tick
   * @param {Object} params.token0Data - Token0 data
   * @param {string} params.token0Data.address - Token0 contract address
   * @param {number} params.token0Data.decimals - Token0 decimal places
   * @param {Object} params.token1Data - Token1 data
   * @param {string} params.token1Data.address - Token1 contract address
   * @param {number} params.token1Data.decimals - Token1 decimal places
   * @param {number} params.slippageTolerance - Slippage tolerance percentage (0-100)
   * @param {number} [params.deadlineMinutes=20] - Transaction deadline in minutes
   * @returns {Object} Transaction data object with `to`, `data`, `value` properties and `quote` with full getAddLiquidityQuote result
   * @throws {Error} If parameters are invalid or transaction data cannot be generated
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

    // Input validation
    if (position === null || position === undefined) {
      throw new Error("Position parameter is required");
    }
    if (typeof position !== 'object' || Array.isArray(position)) {
      throw new Error("Position must be an object");
    }
    if (position.tickLower === null || position.tickLower === undefined) {
      throw new Error("Position tickLower is required");
    }
    if (!Number.isFinite(position.tickLower)) {
      throw new Error("Position tickLower must be a finite number");
    }
    if (position.tickUpper === null || position.tickUpper === undefined) {
      throw new Error("Position tickUpper is required");
    }
    if (!Number.isFinite(position.tickUpper)) {
      throw new Error("Position tickUpper must be a finite number");
    }
    if (position.tickLower >= position.tickUpper) {
      throw new Error("Position tickLower must be less than tickUpper");
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

    // Validate provider using existing method
    await this._validateProviderChain(provider);

    if (walletAddress === null || walletAddress === undefined || walletAddress === '') {
      throw new Error("Wallet address is required");
    }
    if (typeof walletAddress !== 'string') {
      throw new Error("Wallet address must be a string");
    }
    try {
      ethers.getAddress(walletAddress);
    } catch (error) {
      throw new Error(`Invalid wallet address: ${walletAddress}`);
    }

    if (poolData === null || poolData === undefined) {
      throw new Error("Pool data parameter is required");
    }
    if (typeof poolData !== 'object' || Array.isArray(poolData)) {
      throw new Error("Pool data must be an object");
    }
    if (poolData.fee === null || poolData.fee === undefined) {
      throw new Error("Pool data fee is required");
    }
    if (!Number.isFinite(poolData.fee) || poolData.fee < 0) {
      throw new Error("Pool data fee must be a non-negative finite number");
    }
    if (!poolData.sqrtPriceX96) {
      throw new Error("Pool data sqrtPriceX96 is required");
    }
    if (typeof poolData.sqrtPriceX96 !== 'string') {
      throw new Error("Pool data sqrtPriceX96 must be a string");
    }
    if (!/^\d+$/.test(poolData.sqrtPriceX96)) {
      throw new Error("Pool data sqrtPriceX96 must be a positive numeric string");
    }
    if (!poolData.liquidity) {
      throw new Error("Pool data liquidity is required");
    }
    if (typeof poolData.liquidity !== 'string') {
      throw new Error("Pool data liquidity must be a string");
    }
    if (!/^\d+$/.test(poolData.liquidity)) {
      throw new Error("Pool data liquidity must be a positive numeric string");
    }
    if (poolData.tick === null || poolData.tick === undefined) {
      throw new Error("Pool data tick is required");
    }
    if (!Number.isFinite(poolData.tick)) {
      throw new Error("Pool data tick must be a finite number");
    }

    if (token0Data === null || token0Data === undefined) {
      throw new Error("Token0 data parameter is required");
    }
    if (typeof token0Data !== 'object' || Array.isArray(token0Data)) {
      throw new Error("Token0 data must be an object");
    }
    if (token0Data.address === null || token0Data.address === undefined || token0Data.address === '') {
      throw new Error("Token0 address is required");
    }
    if (typeof token0Data.address !== 'string') {
      throw new Error("Token0 address must be a string");
    }
    try {
      ethers.getAddress(token0Data.address);
    } catch (error) {
      throw new Error(`Invalid token0 address: ${token0Data.address}`);
    }
    if (token0Data.decimals === null || token0Data.decimals === undefined) {
      throw new Error("Token0 decimals is required");
    }
    if (!Number.isFinite(token0Data.decimals) || token0Data.decimals < 0 || token0Data.decimals > 255) {
      throw new Error("Token0 decimals must be a finite number between 0 and 255");
    }

    if (token1Data === null || token1Data === undefined) {
      throw new Error("Token1 data parameter is required");
    }
    if (typeof token1Data !== 'object' || Array.isArray(token1Data)) {
      throw new Error("Token1 data must be an object");
    }
    if (token1Data.address === null || token1Data.address === undefined || token1Data.address === '') {
      throw new Error("Token1 address is required");
    }
    if (typeof token1Data.address !== 'string') {
      throw new Error("Token1 address must be a string");
    }
    try {
      ethers.getAddress(token1Data.address);
    } catch (error) {
      throw new Error(`Invalid token1 address: ${token1Data.address}`);
    }
    if (token1Data.decimals === null || token1Data.decimals === undefined) {
      throw new Error("Token1 decimals is required");
    }
    if (!Number.isFinite(token1Data.decimals) || token1Data.decimals < 0 || token1Data.decimals > 255) {
      throw new Error("Token1 decimals must be a finite number between 0 and 255");
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

    try {
      // Get position manager address from platform addresses
      if (!this.addresses?.positionManagerAddress) {
        throw new Error(`No position manager address found for chainId: ${this.chainId}`);
      }
      const positionManagerAddress = this.addresses.positionManagerAddress;

      // Use getAddLiquidityQuote to calculate the position
      const quote = await this.getAddLiquidityQuote({
        position,
        token0Amount,
        token1Amount,
        provider,
        poolData,
        token0Data,
        token1Data
      });

      // Extract the calculated position and metadata
      const { position: newPosition, tokensSwapped, sortedToken0, sortedToken1 } = quote;

      // Create MintOptions (for new position)
      const mintOptions = {
        recipient: walletAddress,
        deadline: this._createDeadline(deadlineMinutes), // Use provided deadline
        slippageTolerance: this._createSlippagePercent(slippageTolerance), // Use standardized slippage
      };

      // Generate the calldata using the SDK
      const { calldata, value } = NonfungiblePositionManager.addCallParameters(
        newPosition,
        mintOptions
      );

      // Return transaction data with calculated amounts
      return {
        to: positionManagerAddress,
        data: calldata,
        value: value,
        quote: quote
      };
    } catch (error) {
      console.error("Error generating create position data:", error);
      throw new Error(`Failed to generate create position data: ${error.message}`);
    }
  }
}
