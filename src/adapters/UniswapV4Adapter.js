// fum_library/adapters/UniswapV4Adapter.js
/**
 * Uniswap V4 Platform Adapter
 *
 * Key differences from V3:
 * - Singleton PoolManager contract holds all pool state (no individual pool contracts)
 * - Pools identified by PoolId (hash of PoolKey) instead of contract address
 * - Hooks system allows custom logic at various pool lifecycle points
 * - Native ETH support without wrapping
 * - Flash accounting for gas-efficient multi-hop operations
 * - Dynamic fees possible via hooks
 * - Position management via PositionManager (ERC-721 NFT based, similar to V3)
 *
 * Architecture:
 * - PoolManager: Singleton holding all pool state, handles swaps
 * - PositionManager: ERC-721 NFT for LP positions (similar to V3 NonfungiblePositionManager)
 * - Hooks: Optional contracts that can modify pool behavior
 * - PoolKey: { currency0, currency1, fee, tickSpacing, hooks }
 * - PoolId: keccak256(abi.encode(PoolKey))
 *
 * @module adapters/UniswapV4Adapter
 */

import { ethers } from "ethers";
import PlatformAdapter from "./PlatformAdapter.js";
import { getPlatformTickBounds } from "../helpers/platformHelpers.js";
import { getPlatformAddresses, getChainConfig, getChainRpcUrls } from "../helpers/chainHelpers.js";
import { getTokenByAddress, getTokenBySymbol, getWethAddress } from "../helpers/tokenHelpers.js";
import { PERMIT2_ADDRESS } from "../helpers/Permit2Helper.js";
import { Token, Percent, CurrencyAmount, TradeType, Ether } from '@uniswap/sdk-core';
import { AlphaRouter, SwapType } from '@uniswap/smart-order-router';
import { Protocol } from '@uniswap/router-sdk';
import { UniversalRouterVersion } from '@uniswap/universal-router-sdk';
import { SqrtPriceMath, TickMath } from '@uniswap/v3-sdk';
import { Pool as V4Pool, Position as V4Position, V4PositionManager } from '@uniswap/v4-sdk';
import JSBI from "jsbi";

// Import V4 ABIs from Uniswap packages (Foundry output structure)
import PoolManagerARTIFACT from '@uniswap/v4-core/out/PoolManager.sol/PoolManager.json' with { type: 'json' };
import PositionManagerARTIFACT from '@uniswap/v4-periphery/foundry-out/PositionManager.sol/PositionManager.json' with { type: 'json' };
import StateViewARTIFACT from '@uniswap/v4-periphery/foundry-out/StateView.sol/StateView.json' with { type: 'json' };
import V4QuoterARTIFACT from '@uniswap/v4-periphery/foundry-out/V4Quoter.sol/V4Quoter.json' with { type: 'json' };

// Shared ABIs
import UniversalRouterARTIFACT from '@uniswap/universal-router/artifacts/contracts/UniversalRouter.sol/UniversalRouter.json' with { type: 'json' };
import ERC20ARTIFACT from '@openzeppelin/contracts/build/contracts/ERC20.json' with { type: 'json' };

const PoolManagerABI = PoolManagerARTIFACT.abi;
const PositionManagerABI = PositionManagerARTIFACT.abi;
const StateViewABI = StateViewARTIFACT.abi;
const V4QuoterABI = V4QuoterARTIFACT.abi;
const UniversalRouterABI = UniversalRouterARTIFACT.abi;
const ERC20ABI = ERC20ARTIFACT.abi;

// Define MaxUint128 constant (2^128 - 1) as JSBI for SDK compatibility
const MaxUint128 = JSBI.subtract(JSBI.exponentiate(JSBI.BigInt(2), JSBI.BigInt(128)), JSBI.BigInt(1));

/**
 * Adapter for Uniswap V4 platform
 *
 * This adapter handles the singleton PoolManager architecture of V4:
 * - All pools exist within a single PoolManager contract
 * - Pools are identified by PoolId (keccak256 hash of PoolKey)
 * - Positions are NFTs managed by the PositionManager contract
 *
 * @example
 * // Create adapter for Arbitrum
 * const adapter = new UniswapV4Adapter(42161, provider);
 *
 * // Get pool data (queries PoolManager via StateView)
 * const poolData = await adapter.getPoolData(poolId, {}, provider);
 */
export default class UniswapV4Adapter extends PlatformAdapter {
  /**
   * Constructor for the Uniswap V4 adapter
   * @param {number} chainId - Chain ID for the adapter
   * @param {Object} provider - Ethers provider instance
   */
  constructor(chainId, provider) {
    super(chainId, "uniswapV4", "Uniswap V4");

    // Cache platform addresses (getPlatformAddresses throws if not configured)
    this.addresses = getPlatformAddresses(chainId, "uniswapV4");

    // Cache platform configuration data
    this.tickBounds = getPlatformTickBounds("uniswapV4");
    this.chainConfig = getChainConfig(chainId);

    // Store ABIs for reference
    this.poolManagerABI = PoolManagerABI;
    this.positionManagerABI = PositionManagerABI;
    this.stateViewABI = StateViewABI;
    this.quoterABI = V4QuoterABI;
    this.universalRouterABI = UniversalRouterABI;
    this.erc20ABI = ERC20ABI;

    // Pre-create ethers Interfaces for encoding/decoding
    this.poolManagerInterface = new ethers.utils.Interface(this.poolManagerABI);
    this.positionManagerInterface = new ethers.utils.Interface(this.positionManagerABI);
    this.stateViewInterface = new ethers.utils.Interface(this.stateViewABI);
    this.quoterInterface = new ethers.utils.Interface(this.quoterABI);
    this.universalRouterInterface = new ethers.utils.Interface(this.universalRouterABI);
    this.erc20Interface = new ethers.utils.Interface(this.erc20ABI);

    // Cache for PoolKey lookups (PoolId -> PoolKey)
    // PoolId is a hash, so we need to cache the original PoolKey for operations
    this.poolKeyCache = new Map();

    // For test chain (1337), use real Arbitrum provider and chainId for AlphaRouter
    // AlphaRouter requires real chain infrastructure (multicall contracts, subgraphs)
    this.alphaRouterChainId = chainId === 1337 ? 42161 : chainId;

    if (chainId === 1337) {
      const arbitrumRpcUrls = getChainRpcUrls(42161);
      const arbitrumProvider = new ethers.providers.JsonRpcProvider(arbitrumRpcUrls[0]);
      this.alphaRouter = new AlphaRouter({ chainId: this.alphaRouterChainId, provider: arbitrumProvider });
    } else {
      this.alphaRouter = new AlphaRouter({ chainId: this.alphaRouterChainId, provider });
    }
  }

  // ===========================================================================
  // HELPER METHODS
  // ===========================================================================

  /**
   * Create SDK Token instance from address using cached config
   * @param {string} tokenAddress - Token address
   * @returns {Token} SDK Token instance
   * @private
   */
  _createTokenInstance(tokenAddress) {
    const tokenConfig = getTokenByAddress(tokenAddress, this.chainId);
    if (!tokenConfig) {
      throw new Error(`Token ${tokenAddress} not found in config for chain ${this.chainId}`);
    }
    return new Token(
      this.alphaRouterChainId,
      tokenAddress,
      tokenConfig.decimals,
      tokenConfig.symbol,
      tokenConfig.name
    );
  }

  // ===========================================================================
  // SWAP EVENT METHODS
  // ===========================================================================

  /**
   * Get the Uniswap V4 swap event signature
   * @returns {string} The Uniswap V4 Swap event signature
   * @private
   */
  _getSwapEventSignature() {
    return 'Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)';
  }

  /**
   * Get the event filter for monitoring swap events on this platform
   *
   * V4 difference: All swaps emit from the singleton PoolManager contract.
   * Filter by PoolManager address + indexed poolId in topics.
   *
   * @param {string} poolId - Pool identifier (PoolId bytes32 hash for V4)
   * @returns {Object} Filter object with address and topics array
   * @throws {Error} If poolId is invalid
   */
  getSwapEventFilter(poolId) {
    // Validate poolId
    if (!poolId || typeof poolId !== 'string') {
      throw new Error('poolId parameter is required and must be a string');
    }

    // Validate it looks like a bytes32 (66 chars with 0x prefix)
    if (!/^0x[a-fA-F0-9]{64}$/.test(poolId)) {
      throw new Error(`Invalid poolId format: ${poolId}. Expected bytes32 hex string.`);
    }

    return {
      address: this.addresses.poolManagerAddress,
      topics: [
        ethers.utils.id(this._getSwapEventSignature()),
        poolId  // indexed PoolId
      ]
    };
  }

  /**
   * Parse a Uniswap V4 swap event log from the blockchain
   *
   * Extracts key data from a Uniswap V4 Swap event log, returning
   * normalized data that can be used for position evaluation and decision making.
   *
   * Uniswap V4 Swap event signature:
   * event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)
   *
   * @param {Object} log - Raw blockchain event log
   * @param {string} log.address - PoolManager contract address that emitted the event
   * @param {Array<string>} log.topics - Array of indexed event topics [eventSig, poolId, sender]
   * @param {string} log.data - ABI-encoded non-indexed event data
   * @returns {Object} Parsed swap event data
   * @returns {string} result.poolId - Pool identifier (bytes32)
   * @returns {number} result.tick - Current tick after the swap
   * @returns {string} result.sqrtPriceX96 - Square root price in Q64.96 format (string)
   * @returns {string} result.liquidity - Pool liquidity at time of swap (string)
   * @returns {string} result.amount0 - Amount of token0 swapped (signed, string)
   * @returns {string} result.amount1 - Amount of token1 swapped (signed, string)
   * @returns {string} result.sender - Address that initiated the swap (indexed)
   * @returns {number} result.fee - Fee charged for this swap (uint24)
   * @throws {Error} If log is null/undefined or missing required properties
   * @throws {Error} If log cannot be parsed as a Uniswap V4 Swap event
   */
  parseSwapEvent(log) {
    // Validate log parameter exists
    if (!log) {
      throw new Error('Log parameter is required');
    }

    // Validate log has required properties
    if (!log.address) {
      throw new Error('Log must have address property');
    }

    if (!log.topics || !Array.isArray(log.topics)) {
      throw new Error('Log must have topics array');
    }

    if (log.topics.length < 3) {
      throw new Error('Log must have at least 3 topics (event signature, poolId, sender)');
    }

    if (!log.data) {
      throw new Error('Log must have data property');
    }

    // Validate the event signature matches Uniswap V4 Swap event
    const expectedTopic = ethers.utils.id(this._getSwapEventSignature());
    if (log.topics[0] !== expectedTopic) {
      throw new Error(`Invalid swap event signature. Expected ${expectedTopic}, got ${log.topics[0]}`);
    }

    try {
      // Extract indexed parameters from topics
      // topics[1] = poolId (bytes32)
      // topics[2] = sender (padded to 32 bytes)
      const poolId = log.topics[1];
      const sender = ethers.utils.getAddress('0x' + log.topics[2].slice(26));

      // Decode the non-indexed data manually (ethers parseLog has issues with int128)
      // V4 Swap data: int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee
      const decoded = ethers.utils.defaultAbiCoder.decode(
        ['int128', 'int128', 'uint160', 'uint128', 'int24', 'uint24'],
        log.data
      );

      return {
        poolId,
        tick: Number(decoded[4]),
        sqrtPriceX96: decoded[2].toString(),
        liquidity: decoded[3].toString(),
        amount0: decoded[0].toString(),
        amount1: decoded[1].toString(),
        sender,
        fee: Number(decoded[5])
      };
    } catch (error) {
      // If it's already one of our validation errors, re-throw
      if (error.message.startsWith('Log ') || error.message.startsWith('Invalid swap')) {
        throw error;
      }
      // Otherwise wrap the parsing error
      throw new Error(`Failed to parse swap event: ${error.message}`);
    }
  }

  /**
   * Evaluate price movement between current swap state and a baseline
   *
   * V4 note: Uses same tick-based math as V3 since both are concentrated liquidity.
   *
   * @param {Object} swapData - Parsed swap event data from parseSwapEvent()
   * @param {number|string} baseline - Baseline tick value
   * @param {Object} token0Data - Token0 data object
   * @param {Object} token1Data - Token1 data object
   * @returns {Object} Price movement evaluation
   */
  evaluatePriceMovement(swapData, baseline, token0Data, token1Data) {
    // TODO: Implement tick-to-price conversion and comparison
    // Math should be identical to V3 since both use ticks
    throw new Error("UniswapV4Adapter.evaluatePriceMovement not implemented");
  }

  // ===========================================================================
  // POSITION MANAGEMENT METHODS
  // ===========================================================================

  /**
   * Get positions formatted for VaultDataService
   *
   * V4 difference: Positions are still NFTs but managed by V4 PositionManager.
   * Position data structure includes PoolKey instead of just pool address.
   *
   * @param {string} address - Vault address
   * @param {Object} provider - Ethers provider instance
   * @returns {Promise<{positions: Object, poolData: Object}>} Normalized position data
   */
  async getPositionsForVDS(address, provider) {
    // TODO: Enumerate NFT positions from V4 PositionManager
    // 1. Get NFT balance: positionManager.balanceOf(address)
    // 2. For each token: positionManager.tokenOfOwnerByIndex(address, i)
    // 3. Get position info: positionManager.positions(tokenId)
    // 4. Extract PoolKey and position range
    // 5. Normalize to VDS format
    throw new Error("UniswapV4Adapter.getPositionsForVDS not implemented");
  }

  /**
   * Calculate accrued (uncollected) fees for a position in USD
   *
   * V4 difference: Fee calculation may involve hooks that modify fee distribution.
   * Core math similar to V3 but need to account for hook fee adjustments.
   *
   * @param {Object} position - Position object
   * @param {Object} tokenPrices - { token0: number, token1: number } USD prices
   * @param {Object} provider - Ethers provider
   * @returns {Promise<Object>} Accrued fees breakdown
   */
  async getAccruedFeesUSD(position, tokenPrices, provider) {
    // TODO: Calculate uncollected fees
    // V4 uses similar fee growth tracking to V3
    // Need to handle hook fee modifications if present
    throw new Error("UniswapV4Adapter.getAccruedFeesUSD not implemented");
  }

  /**
   * Evaluate a position's range status relative to current pool state
   *
   * V4 note: Same tick-based range logic as V3.
   *
   * @param {Object} position - Position object with tickLower/tickUpper
   * @param {Object} provider - Ethers provider instance
   * @param {Object} [options] - Optional { swapData } for cached state
   * @returns {Promise<Object>} Range evaluation result
   */
  async evaluatePositionRange(position, provider, options = {}) {
    // TODO: Implement range evaluation
    // Get current tick from pool state (via PoolManager.getSlot0)
    // Compare against position's tickLower/tickUpper
    // Calculate centeredness and distances
    throw new Error("UniswapV4Adapter.evaluatePositionRange not implemented");
  }

  /**
   * Calculate token amounts for a position (if it were to be closed)
   *
   * V4 note: Same concentrated liquidity math as V3.
   *
   * @param {Object} position - Position object
   * @param {Object} poolData - Pool data
   * @param {Object} token0Data - Token0 data
   * @param {Object} token1Data - Token1 data
   * @returns {Promise<Object>} Token amounts
   */
  async calculateTokenAmounts(position, poolData, token0Data, token1Data) {
    // TODO: Calculate token amounts from liquidity
    // Uses same formulas as V3 (getAmountsForLiquidity)
    throw new Error("UniswapV4Adapter.calculateTokenAmounts not implemented");
  }

  // ===========================================================================
  // LIQUIDITY TRANSACTION METHODS
  // ===========================================================================

  /**
   * Generate transaction data for claiming fees from a position
   *
   * V4 difference: Uses V4 PositionManager.collect() method.
   *
   * @param {Object} params - Parameters for generating claim fees data
   * @returns {Promise<Object>} Transaction data { to, data, value }
   */
  async generateClaimFeesData(params) {
    // TODO: Generate V4 collect transaction
    // V4 PositionManager has similar collect interface to V3
    throw new Error("UniswapV4Adapter.generateClaimFeesData not implemented");
  }

  /**
   * Generate transaction data for removing liquidity from a position
   *
   * V4 difference: Uses V4 PositionManager.decreaseLiquidity() + collect().
   * May need to handle hook interactions.
   *
   * @param {Object} params - Parameters for removing liquidity
   * @returns {Promise<Object>} Transaction data { to, data, value }
   */
  async generateRemoveLiquidityData(params) {
    // TODO: Generate V4 decreaseLiquidity + collect transaction
    // Might use multicall pattern similar to V3
    throw new Error("UniswapV4Adapter.generateRemoveLiquidityData not implemented");
  }

  /**
   * Generate transaction data for adding liquidity to an existing position
   *
   * V4 difference: Uses V4 PositionManager.increaseLiquidity().
   *
   * @param {Object} params - Parameters for adding liquidity
   * @returns {Promise<Object>} Transaction data { to, data, value }
   */
  async generateAddLiquidityData(params) {
    // TODO: Generate V4 increaseLiquidity transaction
    throw new Error("UniswapV4Adapter.generateAddLiquidityData not implemented");
  }

  /**
   * Get the token amounts required to add liquidity to a position
   *
   * V4 note: Same concentrated liquidity math as V3.
   *
   * @param {Object} params - Parameters for calculating amounts
   * @returns {Promise<Object>} { token0Amount, token1Amount, liquidity } as wei strings
   */
  async getAddLiquidityAmounts(params) {
    // TODO: Calculate required token amounts
    // Uses same liquidity math as V3
    throw new Error("UniswapV4Adapter.getAddLiquidityAmounts not implemented");
  }

  /**
   * Generate transaction data for creating a new position
   *
   * V4 difference: Uses V4 PositionManager via V4PositionManager.addCallParameters().
   * Encodes MINT_POSITION + SETTLE_PAIR (+ SWEEP for native ETH).
   *
   * @param {Object} params - Parameters for creating position
   * @param {Object} params.position - Position object with tick range
   * @param {number} params.position.tickLower - Lower tick of the position range
   * @param {number} params.position.tickUpper - Upper tick of the position range
   * @param {string} params.token0Amount - Amount of token0 to add (wei string)
   * @param {string} params.token1Amount - Amount of token1 to add (wei string)
   * @param {Object} params.provider - Ethers provider
   * @param {string} params.walletAddress - User's wallet address (recipient)
   * @param {Object} params.poolKey - V4 PoolKey for pool identification
   * @param {string} params.poolKey.currency0 - Token0 address (must be < currency1)
   * @param {string} params.poolKey.currency1 - Token1 address
   * @param {number} params.poolKey.fee - Fee in hundredths of a bip
   * @param {number} params.poolKey.tickSpacing - Pool tick spacing
   * @param {string} params.poolKey.hooks - Hooks contract address
   * @param {Object} params.poolData - Pool data for the position
   * @param {number} params.poolData.fee - Pool fee tier
   * @param {string} params.poolData.sqrtPriceX96 - Current pool price in sqrt format
   * @param {string} params.poolData.liquidity - Current pool liquidity
   * @param {number} params.poolData.tick - Current pool tick
   * @param {Object} params.token0Data - Token0 data
   * @param {string} params.token0Data.address - Token0 contract address
   * @param {number} params.token0Data.decimals - Token0 decimals
   * @param {Object} params.token1Data - Token1 data
   * @param {string} params.token1Data.address - Token1 contract address
   * @param {number} params.token1Data.decimals - Token1 decimals
   * @param {number} params.slippageTolerance - Slippage tolerance percentage (0-100)
   * @param {number} params.deadlineMinutes - Transaction deadline in minutes
   * @param {string} [params.hookData='0x'] - Optional hook data
   * @returns {Promise<Object>} Transaction data { to, data, value, quote }
   * @throws {Error} If parameters are invalid or transaction data cannot be generated
   */
  async generateCreatePositionData(params) {
    const {
      position,
      token0Amount,
      token1Amount,
      provider,
      walletAddress,
      poolKey,
      poolData,
      token0Data,
      token1Data,
      slippageTolerance,
      deadlineMinutes,
      hookData = '0x'
    } = params;

    // =====================================================================
    // Input Validation
    // =====================================================================

    // Validate position
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

    // Validate token amounts
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

    // Validate provider
    if (!provider) {
      throw new Error("Provider parameter is required");
    }

    // Validate wallet address
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

    // Validate poolKey (V4-specific requirement)
    if (poolKey === null || poolKey === undefined) {
      throw new Error("PoolKey parameter is required for V4");
    }
    if (typeof poolKey !== 'object' || Array.isArray(poolKey)) {
      throw new Error("PoolKey must be an object");
    }
    if (!poolKey.currency0 || !poolKey.currency1) {
      throw new Error("PoolKey must have currency0 and currency1");
    }
    if (poolKey.fee === undefined || poolKey.fee === null) {
      throw new Error("PoolKey must have fee");
    }
    if (poolKey.tickSpacing === undefined || poolKey.tickSpacing === null) {
      throw new Error("PoolKey must have tickSpacing");
    }
    if (!poolKey.hooks) {
      throw new Error("PoolKey must have hooks (use ethers.constants.AddressZero for no hooks)");
    }
    // Validate address ordering
    if (poolKey.currency0.toLowerCase() >= poolKey.currency1.toLowerCase()) {
      throw new Error("PoolKey currency0 must be less than currency1 (addresses must be sorted)");
    }

    // Validate poolData
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

    // Validate token0Data
    if (token0Data === null || token0Data === undefined) {
      throw new Error("Token0 data parameter is required");
    }
    if (typeof token0Data !== 'object' || Array.isArray(token0Data)) {
      throw new Error("Token0 data must be an object");
    }
    if (!token0Data.address) {
      throw new Error("Token0 address is required");
    }
    try {
      ethers.utils.getAddress(token0Data.address);
    } catch (error) {
      throw new Error(`Invalid token0 address: ${token0Data.address}`);
    }
    if (token0Data.decimals === null || token0Data.decimals === undefined) {
      throw new Error("Token0 decimals is required");
    }
    if (!Number.isFinite(token0Data.decimals) || token0Data.decimals < 0 || token0Data.decimals > 255) {
      throw new Error("Token0 decimals must be a finite number between 0 and 255");
    }

    // Validate token1Data
    if (token1Data === null || token1Data === undefined) {
      throw new Error("Token1 data parameter is required");
    }
    if (typeof token1Data !== 'object' || Array.isArray(token1Data)) {
      throw new Error("Token1 data must be an object");
    }
    if (!token1Data.address) {
      throw new Error("Token1 address is required");
    }
    try {
      ethers.utils.getAddress(token1Data.address);
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

    // Validate slippage
    if (slippageTolerance === null || slippageTolerance === undefined) {
      throw new Error("Slippage tolerance is required");
    }
    if (!Number.isFinite(slippageTolerance)) {
      throw new Error("Slippage tolerance must be a finite number");
    }
    if (slippageTolerance < 0 || slippageTolerance > 100) {
      throw new Error("Slippage tolerance must be between 0 and 100");
    }

    // Validate deadline
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
      // =====================================================================
      // Create V4 Pool and Position using V4 SDK
      // =====================================================================

      // Sort tokens to match pool ordering
      const { sortedToken0, sortedToken1, tokensSwapped } = this.sortTokens(token0Data, token1Data);

      // Check if either token is native ETH (address 0)
      const isToken0Native = sortedToken0.address === ethers.constants.AddressZero;
      const isToken1Native = sortedToken1.address === ethers.constants.AddressZero;

      // Create SDK currency instances - use Ether for native ETH, Token for ERC20
      const sdkToken0 = isToken0Native
        ? Ether.onChain(this.chainId)
        : new Token(this.chainId, sortedToken0.address, sortedToken0.decimals);
      const sdkToken1 = isToken1Native
        ? Ether.onChain(this.chainId)
        : new Token(this.chainId, sortedToken1.address, sortedToken1.decimals);

      // Create V4 Pool instance
      // V4Pool constructor: (currencyA, currencyB, fee, tickSpacing, hooks, sqrtRatioX96, liquidity, tickCurrent, ticks)
      const pool = new V4Pool(
        sdkToken0,
        sdkToken1,
        poolKey.fee,
        poolKey.tickSpacing,
        poolKey.hooks,
        poolData.sqrtPriceX96,
        poolData.liquidity,
        poolData.tick,
        []  // Empty ticks array - not needed for position creation
      );

      // Determine amounts in sorted order
      let amount0, amount1;
      if (tokensSwapped) {
        amount0 = JSBI.BigInt(token1Amount);
        amount1 = JSBI.BigInt(token0Amount);
      } else {
        amount0 = JSBI.BigInt(token0Amount);
        amount1 = JSBI.BigInt(token1Amount);
      }

      // Create V4 Position using the SDK
      let v4Position;
      if (JSBI.equal(amount1, JSBI.BigInt(0))) {
        v4Position = V4Position.fromAmount0({
          pool,
          tickLower: position.tickLower,
          tickUpper: position.tickUpper,
          amount0,
          useFullPrecision: true,
        });
      } else if (JSBI.equal(amount0, JSBI.BigInt(0))) {
        v4Position = V4Position.fromAmount1({
          pool,
          tickLower: position.tickLower,
          tickUpper: position.tickUpper,
          amount1,
          useFullPrecision: true,
        });
      } else {
        v4Position = V4Position.fromAmounts({
          pool,
          tickLower: position.tickLower,
          tickUpper: position.tickUpper,
          amount0,
          amount1,
          useFullPrecision: true,
        });
      }

      // =====================================================================
      // Generate Transaction Data using V4PositionManager
      // =====================================================================

      // Calculate deadline timestamp
      const deadline = Math.floor(Date.now() / 1000) + (deadlineMinutes * 60);

      // Create MintOptions for V4PositionManager
      // slippageTolerance is in percentage (e.g., 0.5 for 0.5%), convert to Percent
      const slippagePercent = new Percent(Math.floor(slippageTolerance * 100), 10000);

      const mintOptions = {
        recipient: walletAddress,
        slippageTolerance: slippagePercent,
        deadline: deadline.toString(),
        hookData: hookData,
        // Must set useNative when one of the currencies is native ETH
        // This tells the SDK to expect ETH payment and generates correct calldata
        ...(isToken0Native && { useNative: Ether.onChain(this.chainId) })
      };

      // Use V4PositionManager.addCallParameters to generate calldata
      // This encodes MINT_POSITION + SETTLE_PAIR (+ SWEEP for native ETH)
      const { calldata, value } = V4PositionManager.addCallParameters(v4Position, mintOptions);

      // Build quote object for return (amounts in caller's token order)
      const mintAmount0 = v4Position.mintAmounts.amount0.toString();
      const mintAmount1 = v4Position.mintAmounts.amount1.toString();

      const quote = {
        liquidity: v4Position.liquidity.toString(),
        // Return amounts in caller's original token order
        mintAmount0: tokensSwapped ? mintAmount1 : mintAmount0,
        mintAmount1: tokensSwapped ? mintAmount0 : mintAmount1,
        // Also include SDK-sorted amounts for reference
        sortedMintAmount0: mintAmount0,
        sortedMintAmount1: mintAmount1,
        tokensSwapped,
        sortedToken0,
        sortedToken1
      };

      return {
        to: this.addresses.positionManagerAddress,
        data: calldata,
        value: value,
        quote
      };

    } catch (error) {
      // Re-throw validation errors as-is
      if (error.message.includes('is required') ||
          error.message.includes('must be') ||
          error.message.includes('cannot be')) {
        throw error;
      }
      throw new Error(`Failed to generate create position data: ${error.message}`);
    }
  }

  // ===========================================================================
  // SWAP METHODS
  // ===========================================================================

  /**
   * @private
   * Internal method for generating swap transaction data.
   * Used by test setup files to fund wallets with tokens.
   * For production swaps, use batchSwapTransactions instead.
   *
   * Uses AlphaRouter to find optimal route across all protocols (V2, V3, V4, Mixed).
   *
   * @param {Object} params - Swap parameters
   * @param {string} params.tokenIn - Input token address (use ethers.constants.AddressZero for native ETH)
   * @param {string} params.tokenOut - Output token address
   * @param {string} params.amountIn - Amount of input tokens (as string in wei)
   * @param {string} params.recipient - Address to receive output tokens
   * @param {number} [params.slippageTolerance=0.5] - Slippage tolerance percentage
   * @param {number} [params.deadlineMinutes=20] - Transaction deadline in minutes
   * @param {string} [params.forceProtocol] - Force specific protocol ('V2', 'V3', 'V4') for testing
   * @returns {Promise<Object>} Transaction data with { to, data, value, quote }
   */
  async _generateSwapData(params) {
    const {
      tokenIn,
      tokenOut,
      amountIn,
      recipient,
      slippageTolerance = 0.5,
      deadlineMinutes = 20,
      forceProtocol
    } = params;

    // ========================================================================
    // Parameter Validation
    // ========================================================================

    if (!tokenIn) {
      throw new Error('tokenIn is required');
    }
    if (!tokenOut) {
      throw new Error('tokenOut is required');
    }
    if (!amountIn) {
      throw new Error('amountIn is required');
    }
    if (typeof amountIn !== 'string') {
      throw new Error('amountIn must be a string');
    }
    if (amountIn === '0') {
      throw new Error('amountIn cannot be zero');
    }
    if (!recipient) {
      throw new Error('recipient is required');
    }
    try {
      ethers.utils.getAddress(recipient);
    } catch (error) {
      throw new Error(`Invalid recipient address: ${recipient}`);
    }
    if (slippageTolerance < 0 || slippageTolerance > 100) {
      throw new Error('slippageTolerance must be between 0 and 100');
    }
    if (deadlineMinutes <= 0) {
      throw new Error('deadlineMinutes must be positive');
    }

    // ========================================================================
    // Determine if native ETH
    // ========================================================================

    const isNativeIn = tokenIn === ethers.constants.AddressZero;
    const isNativeOut = tokenOut === ethers.constants.AddressZero;

    // ========================================================================
    // Build Currency objects for AlphaRouter
    // ========================================================================

    const currencyIn = isNativeIn
      ? Ether.onChain(this.alphaRouterChainId)
      : this._createTokenInstance(tokenIn);

    const currencyOut = isNativeOut
      ? Ether.onChain(this.alphaRouterChainId)
      : this._createTokenInstance(tokenOut);

    const currencyAmount = CurrencyAmount.fromRawAmount(currencyIn, amountIn);

    // ========================================================================
    // Configure swap for Universal Router
    // ========================================================================

    const swapConfig = {
      type: SwapType.UNIVERSAL_ROUTER,
      version: UniversalRouterVersion.V2_0,
      recipient,
      slippageTolerance: new Percent(Math.floor(slippageTolerance * 100), 10_000),
      deadline: Math.floor(Date.now() / 1000 + deadlineMinutes * 60)
    };

    // ========================================================================
    // Route through best pools (AlphaRouter optimizes across all protocols)
    // ========================================================================

    // Build routing config - optionally force specific protocol
    const routingConfig = forceProtocol ? {
      protocols: [Protocol[forceProtocol]]
    } : undefined;

    const route = await this.alphaRouter.route(
      currencyAmount,
      currencyOut,
      TradeType.EXACT_INPUT,
      swapConfig,
      routingConfig
    );

    if (!route) {
      throw new Error('No route found for this swap');
    }

    // ========================================================================
    // Build response
    // ========================================================================

    return {
      to: this.addresses.universalRouterAddress,
      data: route.methodParameters.calldata,
      value: isNativeIn ? amountIn : '0',
      quote: {
        amountOut: route.quote.quotient.toString(),
        amountOutMinimum: route.quoteGasAdjusted.quotient.toString(),
        gasEstimate: route.estimatedGasUsed.toString(),
        route: route.route.map(r => ({
          protocol: r.protocol,
          pools: r.poolAddresses || r.pools?.map(p => p.address)
        }))
      }
    };
  }

  /**
   * Get best swap quote using platform's routing mechanism
   *
   * V4 difference: May use different router (UniversalRouter with V4 support).
   * Flash accounting allows more efficient multi-hop swaps.
   *
   * @param {Object} params - { tokenInAddress, tokenOutAddress, amount, isAmountIn, tokenInIsNative?, tokenOutIsNative? }
   * @returns {Promise<Object>} Quote with { amountIn, amountOut, route, methodParameters? }
   */
  async getBestSwapQuote(params) {
    // TODO: Implement V4 swap routing
    // V4 supports native ETH without wrapping
    // May need to use V4-compatible router
    throw new Error("UniswapV4Adapter.getBestSwapQuote not implemented");
  }

  /**
   * Generate batched swap transactions with platform-specific auth handling
   *
   * V4 difference: Flash accounting enables batching multiple operations
   * in a single transaction more efficiently than V3.
   *
   * @param {Array<Object>} swapInstructions - Array of swap instructions
   * @param {Object} options - { signer, provider, chainId, recipient, slippageTolerance }
   * @returns {Promise<Object>} { transactions: Array<{to, data, value}>, metadata: Array }
   */
  async batchSwapTransactions(swapInstructions, options) {
    // TODO: Implement batched swap generation
    // V4 flash accounting may allow more efficient batching
    throw new Error("UniswapV4Adapter.batchSwapTransactions not implemented");
  }

  // ===========================================================================
  // RECEIPT PARSING METHODS
  // ===========================================================================

  /**
   * Parse position closure receipt to extract principal and fees
   *
   * V4 difference: Events emit from V4 PositionManager with potentially different signatures.
   *
   * @param {Object} receipt - Transaction receipt
   * @param {Object} positionMetadata - { [tokenId]: { position, poolMetadata, token0Data, token1Data } }
   * @returns {Object} { principalByPosition, feesByPosition }
   */
  parseClosureReceipt(receipt, positionMetadata) {
    // TODO: Parse V4 DecreaseLiquidity and Collect events
    throw new Error("UniswapV4Adapter.parseClosureReceipt not implemented");
  }

  /**
   * Parse fee collection receipt to extract collected fee amounts
   *
   * @param {Object} receipt - Transaction receipt
   * @param {Object} positionMetadata - { [tokenId]: { token0Data, token1Data } }
   * @returns {Object} { feesByPosition: { [tokenId]: { token0, token1, metadata } } }
   */
  parseCollectReceipt(receipt, positionMetadata) {
    // TODO: Parse V4 Collect events
    throw new Error("UniswapV4Adapter.parseCollectReceipt not implemented");
  }

  /**
   * Parse swap transaction receipt to extract actual swap amounts
   *
   * V4 difference: Swap events emit from PoolManager, not individual pools.
   *
   * @param {Object} receipt - Transaction receipt
   * @param {Array} swapMetadata - Array of swap metadata
   * @returns {Array<{actualAmountIn: string, actualAmountOut: string}>}
   */
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

    // Return empty array for empty metadata
    if (swapMetadata.length === 0) {
      return [];
    }

    const actualSwaps = [];

    // Get V4 Swap event topic
    const swapTopicHash = ethers.utils.id(this._getSwapEventSignature());

    // Collect all swap events from the receipt
    // V4 difference: All swaps emit from PoolManager, not individual pools
    const swapEvents = [];
    for (const log of receipt.logs) {
      try {
        if (log.topics[0] === swapTopicHash) {
          // Decode V4 swap event data manually (ethers parseLog has issues with int128)
          const decoded = ethers.utils.defaultAbiCoder.decode(
            ['int128', 'int128', 'uint160', 'uint128', 'int24', 'uint24'],
            log.data
          );
          swapEvents.push({
            poolId: log.topics[1],  // V4: poolId from indexed topic
            amount0: decoded[0],    // int128
            amount1: decoded[1]     // int128
          });
        }
      } catch (e) {
        // Not a V4 Swap event, continue
      }
    }

    // Match swap events to metadata in order (swaps execute sequentially)
    let eventIndex = 0;

    for (const metadata of swapMetadata) {
      // Validate required metadata fields
      if (!metadata.tokenInAddress) {
        throw new Error("Swap metadata must have tokenInAddress");
      }
      if (!metadata.tokenOutAddress) {
        throw new Error("Swap metadata must have tokenOutAddress");
      }

      const numEvents = metadata.expectedSwapEvents || 1;
      const tokenInAddress = metadata.tokenInAddress.toLowerCase();
      const tokenOutAddress = metadata.tokenOutAddress.toLowerCase();

      let totalAmountIn = BigInt(0);
      let totalAmountOut = BigInt(0);

      // MULTI-HOP/SPLIT ROUTE: Use tokenPath to intelligently parse events
      if (metadata.routes && metadata.routes.length > 0) {
        for (let routeIdx = 0; routeIdx < metadata.routes.length; routeIdx++) {
          const route = metadata.routes[routeIdx];
          const { tokenPath, poolCount } = route;

          // For this route, we consume poolCount events
          for (let hopIdx = 0; hopIdx < poolCount; hopIdx++) {
            if (eventIndex >= swapEvents.length) {
              break;
            }

            const event = swapEvents[eventIndex];
            const isFirstHop = (hopIdx === 0);
            const isLastHop = (hopIdx === poolCount - 1);

            // For first hop: extract amountIn using tokenPath[0]
            if (isFirstHop) {
              const firstToken = tokenPath[0].toLowerCase();
              const secondToken = tokenPath[1].toLowerCase();
              const isToken0 = firstToken < secondToken;

              const amountIn = isToken0
                ? BigInt(event.amount0.abs().toString())
                : BigInt(event.amount1.abs().toString());

              totalAmountIn += amountIn;
            }

            // For last hop: extract amountOut using tokenPath[poolCount]
            if (isLastHop) {
              const secondToLastToken = tokenPath[poolCount - 1].toLowerCase();
              const lastToken = tokenPath[poolCount].toLowerCase();
              const isToken0 = secondToLastToken < lastToken;

              const amountOut = isToken0
                ? BigInt(event.amount1.abs().toString())
                : BigInt(event.amount0.abs().toString());

              totalAmountOut += amountOut;
            }

            eventIndex++;
          }
        }
      } else {
        // SIMPLE ROUTE: Single event, use basic token ordering
        const isTokenInToken0 = tokenInAddress < tokenOutAddress;

        // Consume exactly numEvents events for this metadata entry
        for (let i = 0; i < numEvents; i++) {
          if (eventIndex < swapEvents.length) {
            const event = swapEvents[eventIndex];

            const actualIn = isTokenInToken0
              ? BigInt(event.amount0.abs().toString())
              : BigInt(event.amount1.abs().toString());

            const actualOut = isTokenInToken0
              ? BigInt(event.amount1.abs().toString())
              : BigInt(event.amount0.abs().toString());

            totalAmountIn += actualIn;
            totalAmountOut += actualOut;
            eventIndex++;
          } else {
            // Not enough events - swap may have failed partially
            break;
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
   * Parse increaseLiquidity transaction receipt to extract actual amounts
   *
   * V4 difference: ModifyLiquidity event doesn't include token amounts directly.
   * We calculate amounts from liquidityDelta using tick math.
   *
   * @param {Object} receipt - Transaction receipt
   * @param {Object} context - Platform-specific context for parsing
   * @param {Object} context.position - Position object with tick bounds
   * @param {Object} context.poolData - Pool data with sqrtPriceX96
   * @returns {Object} { tokenId, liquidity, amount0, amount1, tickLower?, tickUpper?, poolAddress? }
   */
  parseIncreaseLiquidityReceipt(receipt, { position, poolData }) {
    // Validate receipt
    if (receipt === null || receipt === undefined) {
      throw new Error("Receipt parameter is required");
    }
    if (!receipt.logs) {
      throw new Error("Receipt must have logs property");
    }

    // Validate context - required for V4 amount calculations
    if (!position) {
      throw new Error("position is required for V4 receipt parsing");
    }
    if (!poolData?.sqrtPriceX96) {
      throw new Error("poolData.sqrtPriceX96 is required for V4 receipt parsing");
    }

    // Event topic hashes
    // ModifyLiquidity(bytes32 indexed id, address indexed sender, int24 tickLower, int24 tickUpper, int256 liquidityDelta, bytes32 salt)
    const modifyLiquidityTopic = ethers.utils.id('ModifyLiquidity(bytes32,address,int24,int24,int256,bytes32)');
    // ERC721 Transfer(address indexed from, address indexed to, uint256 indexed tokenId)
    const erc721TransferTopic = ethers.utils.id('Transfer(address,address,uint256)');

    let modifyLiqEvent = null;
    let tokenId = null;

    // Parse all logs to find the events we need
    for (const log of receipt.logs) {
      // Parse ModifyLiquidity event from PoolManager
      if (log.topics[0] === modifyLiquidityTopic) {
        const decoded = ethers.utils.defaultAbiCoder.decode(
          ['int24', 'int24', 'int256', 'bytes32'],
          log.data
        );
        modifyLiqEvent = {
          poolId: log.topics[1],  // indexed poolId
          tickLower: decoded[0],
          tickUpper: decoded[1],
          liquidityDelta: decoded[2]
        };
      }

      // Parse ERC721 Transfer (from 0x0 = mint) to get tokenId for new positions
      if (log.topics[0] === erc721TransferTopic && log.topics.length >= 4) {
        const from = '0x' + log.topics[1].slice(26);
        if (from === '0x0000000000000000000000000000000000000000') {
          tokenId = ethers.BigNumber.from(log.topics[3]).toString();
        }
      }
    }

    if (!modifyLiqEvent) {
      throw new Error('ModifyLiquidity event not found in receipt');
    }

    // Get tick bounds - prefer from event, fallback to position
    const tickLower = modifyLiqEvent.tickLower ?? position.tickLower;
    const tickUpper = modifyLiqEvent.tickUpper ?? position.tickUpper;

    // Calculate token amounts using tick math
    // V4 uses same math as V3 - the V4 SDK imports V3 SDK's SqrtPriceMath
    const sqrtPriceX96 = JSBI.BigInt(poolData.sqrtPriceX96.toString());
    const sqrtPriceLower = TickMath.getSqrtRatioAtTick(tickLower);
    const sqrtPriceUpper = TickMath.getSqrtRatioAtTick(tickUpper);
    const liquidity = JSBI.BigInt(modifyLiqEvent.liquidityDelta.toString());

    // Handle negative liquidity (decrease) by taking absolute value for calculation
    const absLiquidity = JSBI.greaterThanOrEqual(liquidity, JSBI.BigInt(0))
      ? liquidity
      : JSBI.multiply(liquidity, JSBI.BigInt(-1));

    let amount0, amount1;

    if (JSBI.lessThan(sqrtPriceX96, sqrtPriceLower)) {
      // Current price below range - only token0
      amount0 = SqrtPriceMath.getAmount0Delta(sqrtPriceLower, sqrtPriceUpper, absLiquidity, true);
      amount1 = JSBI.BigInt(0);
    } else if (JSBI.greaterThan(sqrtPriceX96, sqrtPriceUpper)) {
      // Current price above range - only token1
      amount0 = JSBI.BigInt(0);
      amount1 = SqrtPriceMath.getAmount1Delta(sqrtPriceLower, sqrtPriceUpper, absLiquidity, true);
    } else {
      // Current price in range - both tokens
      amount0 = SqrtPriceMath.getAmount0Delta(sqrtPriceX96, sqrtPriceUpper, absLiquidity, true);
      amount1 = SqrtPriceMath.getAmount1Delta(sqrtPriceLower, sqrtPriceX96, absLiquidity, true);
    }

    return {
      // tokenId - from ERC721 Transfer for new positions, null for adding to existing
      tokenId: tokenId,
      // From ModifyLiquidity event
      liquidity: modifyLiqEvent.liquidityDelta.toString(),
      // Calculated from tick math
      amount0: amount0.toString(),
      amount1: amount1.toString(),
      // Tick bounds - from event or position
      tickLower: tickLower,
      tickUpper: tickUpper,
      // V4 returns poolId in poolAddress field for interface consistency
      poolAddress: modifyLiqEvent.poolId
    };
  }

  // ===========================================================================
  // POOL AND TOKEN METHODS
  // ===========================================================================

  /**
   * Select the best pool for a token pair
   *
   * V4 difference: Pools identified by PoolKey (currency0, currency1, fee, tickSpacing, hooks).
   * Multiple pools can exist for same pair with different hooks/fees.
   *
   * @param {string} tokenASymbol - First token symbol
   * @param {string} tokenBSymbol - Second token symbol
   * @param {Object} provider - Ethers provider instance
   * @param {number} chainId - Chain ID
   * @returns {Promise<Object>} { bestPool, poolsDiscovered, poolsActive }
   */
  async selectBestPool(tokenASymbol, tokenBSymbol, provider, chainId) {
    // TODO: Discover V4 pools
    // Query for pools by token pair, enumerate different fee tiers and hooks
    // Filter by liquidity depth
    throw new Error("UniswapV4Adapter.selectBestPool not implemented");
  }

  /**
   * Calculate tick range from percentage offsets around a current tick.
   * Internal helper used by getPositionRange.
   *
   * V4 note: tickSpacing is an explicit pool parameter, not derived from fee.
   *
   * @param {number} currentTick - Current pool tick
   * @param {number} upperPercent - Upper range percentage (e.g., 5 for +5%)
   * @param {number} lowerPercent - Lower range percentage (e.g., 5 for -5%)
   * @param {number} tickSpacing - Pool's tick spacing (from PoolKey)
   * @returns {Object} { tickLower, tickUpper }
   * @throws {Error} If parameters are invalid or result in invalid tick range
   */
  _calculateTickRangeFromPercentages(currentTick, upperPercent, lowerPercent, tickSpacing) {
    if (!Number.isFinite(currentTick)) {
      throw new Error(`Invalid currentTick: ${currentTick}. Must be a finite number.`);
    }
    if (!Number.isFinite(upperPercent)) {
      throw new Error(`Invalid upperPercent: ${upperPercent}. Must be a finite number.`);
    }
    if (upperPercent <= 0 || upperPercent > 100) {
      throw new Error(`Invalid upperPercent: ${upperPercent}. Must be between 0 and 100 (exclusive of 0).`);
    }
    if (!Number.isFinite(lowerPercent)) {
      throw new Error(`Invalid lowerPercent: ${lowerPercent}. Must be a finite number.`);
    }
    if (lowerPercent <= 0 || lowerPercent > 100) {
      throw new Error(`Invalid lowerPercent: ${lowerPercent}. Must be between 0 and 100 (exclusive of 0).`);
    }
    if (!Number.isFinite(tickSpacing) || tickSpacing <= 0) {
      throw new Error(`Invalid tickSpacing: ${tickSpacing}. Must be a positive finite number.`);
    }

    const LOG_BASE = Math.log(1.0001);

    const upperPrice = 1 + upperPercent / 100;
    const lowerPrice = 1 - lowerPercent / 100;
    const upperTickOffset = Math.round(Math.log(upperPrice) / LOG_BASE);
    const lowerTickOffset = Math.round(Math.log(lowerPrice) / LOG_BASE);

    let tickUpper = currentTick + upperTickOffset;
    let tickLower = currentTick + lowerTickOffset;

    // Align to tick spacing (round down for upper, round up for lower to narrow range)
    tickUpper = Math.floor(tickUpper / tickSpacing) * tickSpacing;
    tickLower = Math.ceil(tickLower / tickSpacing) * tickSpacing;

    // Clamp to platform tick bounds
    tickUpper = Math.min(tickUpper, this.tickBounds.maxTick);
    tickLower = Math.max(tickLower, this.tickBounds.minTick);

    if (tickLower >= tickUpper) {
      throw new Error(`Invalid tick range: tickLower (${tickLower}) must be less than tickUpper (${tickUpper})`);
    }

    return { tickLower, tickUpper };
  }

  /**
   * Calculate position range bounds from percentage parameters.
   * Wraps _calculateTickRangeFromPercentages with poolData validation.
   *
   * V4 note: tickSpacing is an explicit pool parameter in V4, not derived from fee.
   *
   * @param {Object} poolData - Pool data with current tick and tickSpacing
   * @param {number} poolData.tick - Current tick of the pool
   * @param {number} poolData.tickSpacing - Pool's tick spacing (from PoolKey)
   * @param {number} upperPercent - Upper range percentage (e.g., 5 for +5%)
   * @param {number} lowerPercent - Lower range percentage (e.g., 5 for -5%)
   * @returns {Object} { tickLower, tickUpper, currentTick }
   * @throws {Error} If parameters are invalid
   */
  getPositionRange(poolData, upperPercent, lowerPercent) {
    // Validate poolData
    if (!poolData || typeof poolData !== 'object') {
      throw new Error('poolData is required and must be an object');
    }
    if (poolData.tick === null || poolData.tick === undefined) {
      throw new Error('poolData.tick is required');
    }
    if (!Number.isFinite(poolData.tick)) {
      throw new Error('poolData.tick must be a finite number');
    }
    if (poolData.tickSpacing === null || poolData.tickSpacing === undefined) {
      throw new Error('poolData.tickSpacing is required');
    }
    if (!Number.isFinite(poolData.tickSpacing) || poolData.tickSpacing <= 0) {
      throw new Error('poolData.tickSpacing must be a positive finite number');
    }

    // Validate upperPercent
    if (upperPercent === null || upperPercent === undefined) {
      throw new Error('upperPercent is required');
    }
    if (!Number.isFinite(upperPercent)) {
      throw new Error('upperPercent must be a finite number');
    }

    // Validate lowerPercent
    if (lowerPercent === null || lowerPercent === undefined) {
      throw new Error('lowerPercent is required');
    }
    if (!Number.isFinite(lowerPercent)) {
      throw new Error('lowerPercent must be a finite number');
    }

    const { tickLower, tickUpper } = this._calculateTickRangeFromPercentages(
      poolData.tick,
      upperPercent,
      lowerPercent,
      poolData.tickSpacing
    );

    return { tickLower, tickUpper, currentTick: poolData.tick };
  }

  /**
   * Extract position bounds from an existing position object.
   *
   * For Uniswap V4, positions store bounds as tickLower and tickUpper.
   * This method extracts them in a platform-agnostic format.
   *
   * @param {Object} position - Position object from vault cache
   * @param {number} position.tickLower - Lower tick boundary
   * @param {number} position.tickUpper - Upper tick boundary
   * @returns {Object} Position bounds { lower, upper } as numbers
   * @throws {Error} If position is invalid or missing tick properties
   */
  extractPositionBounds(position) {
    if (!position || typeof position !== 'object' || Array.isArray(position)) {
      throw new Error('Position is required and must be an object');
    }
    if (position.tickLower === undefined || position.tickLower === null) {
      throw new Error('Position missing tickLower property');
    }
    if (position.tickUpper === undefined || position.tickUpper === null) {
      throw new Error('Position missing tickUpper property');
    }
    return {
      lower: position.tickLower,
      upper: position.tickUpper
    };
  }

  /**
   * Get current pool state value for baseline tracking.
   *
   * V4 note: Returns current tick, same as V3.
   *
   * @param {Object} poolData - Pool data object with tick property
   * @param {number} poolData.tick - Current tick of the pool
   * @returns {number} Current tick
   * @throws {Error} If poolData is missing or doesn't have tick property
   */
  getPoolCurrent(poolData) {
    if (!poolData || poolData.tick === undefined) {
      throw new Error('Pool data must have tick property');
    }
    return poolData.tick;
  }

  /**
   * Get pool data by poolId
   *
   * V4 difference: Queries StateView contract instead of individual pool contracts.
   * Pool is identified by PoolId (bytes32) derived from PoolKey.
   *
   * @param {string} poolId - Pool identifier (PoolId bytes32 for V4)
   * @param {Object} provider - Ethers provider instance
   * @returns {Promise<Object>} Pool data object
   * @throws {Error} If parameters are invalid or pool data cannot be retrieved
   */
  async getPoolData(poolId, provider) {
    // Validate poolId - must be bytes32 format
    if (!poolId || typeof poolId !== 'string') {
      throw new Error("poolId parameter is required and must be a string");
    }
    if (!/^0x[a-fA-F0-9]{64}$/.test(poolId)) {
      throw new Error(`Invalid poolId format: ${poolId}. Expected bytes32 hex string.`);
    }

    // Validate provider
    if (!provider) {
      throw new Error("Provider parameter is required");
    }

    try {
      // Create StateView contract instance
      const stateViewContract = new ethers.Contract(
        this.addresses.stateViewAddress,
        this.stateViewABI,
        provider
      );

      // Fetch pool state from StateView in parallel
      const [slot0, liquidity, feeGrowthGlobals] = await Promise.all([
        stateViewContract.getSlot0(poolId),
        stateViewContract.getLiquidity(poolId),
        stateViewContract.getFeeGrowthGlobals(poolId)
      ]);

      // Build pool data object with V3-compatible interface
      // V4 slot0: sqrtPriceX96, tick, protocolFee, lpFee (no observation fields)
      return {
        address: poolId,  // V4 returns poolId in address field for interface consistency
        sqrtPriceX96: slot0.sqrtPriceX96.toString(),
        tick: Number(slot0.tick),
        protocolFee: Number(slot0.protocolFee),  // V4-specific: protocol fee
        lpFee: Number(slot0.lpFee),              // V4-specific: LP fee
        fee: Number(slot0.lpFee),                // Alias for V3 compatibility
        liquidity: liquidity.toString(),
        feeGrowthGlobal0X128: feeGrowthGlobals.feeGrowthGlobal0.toString(),
        feeGrowthGlobal1X128: feeGrowthGlobals.feeGrowthGlobal1.toString(),
        lastUpdated: Date.now()
      };
    } catch (error) {
      throw new Error(`Failed to get pool data for ${poolId}: ${error.message}`);
    }
  }

  /**
   * Fetch pool state data by token addresses and pool configuration
   *
   * V4 difference: Requires tickSpacing and hooks parameters to construct PoolKey.
   * Computes poolId from PoolKey and calls getPoolData.
   *
   * @param {string} token0Address - Token0 contract address (use ethers.constants.AddressZero for native ETH)
   * @param {string} token1Address - Token1 contract address
   * @param {number} fee - Pool fee in hundredths of a bip
   * @param {number} tickSpacing - Pool tick spacing
   * @param {string} hooks - Hooks contract address (use ethers.constants.AddressZero for no hooks)
   * @param {Object} provider - Ethers provider
   * @returns {Promise<Object>} Pool state data including poolKey and poolId
   * @private
   */
  async _fetchPoolData(token0Address, token1Address, fee, tickSpacing, hooks, provider) {
    // Validate token0 address
    if (token0Address === null || token0Address === undefined) {
      throw new Error("Token0 address parameter is required");
    }
    // Allow address(0) for native ETH, otherwise validate
    if (token0Address !== ethers.constants.AddressZero) {
      try {
        ethers.utils.getAddress(token0Address);
      } catch (error) {
        throw new Error(`Invalid token0 address: ${token0Address}`);
      }
    }

    // Validate token1 address
    if (token1Address === null || token1Address === undefined) {
      throw new Error("Token1 address parameter is required");
    }
    if (token1Address !== ethers.constants.AddressZero) {
      try {
        ethers.utils.getAddress(token1Address);
      } catch (error) {
        throw new Error(`Invalid token1 address: ${token1Address}`);
      }
    }

    // Validate fee
    if (fee === null || fee === undefined) {
      throw new Error("Fee parameter is required");
    }
    if (typeof fee !== 'number' || !Number.isFinite(fee)) {
      throw new Error("Fee must be a valid number");
    }

    // Validate tickSpacing
    if (tickSpacing === null || tickSpacing === undefined) {
      throw new Error("TickSpacing parameter is required");
    }
    if (typeof tickSpacing !== 'number' || !Number.isFinite(tickSpacing)) {
      throw new Error("TickSpacing must be a valid number");
    }

    // Validate hooks
    if (hooks === null || hooks === undefined) {
      throw new Error("Hooks parameter is required (use ethers.constants.AddressZero for no hooks)");
    }
    try {
      ethers.utils.getAddress(hooks);
    } catch (error) {
      throw new Error(`Invalid hooks address: ${hooks}`);
    }

    // Validate provider
    if (!provider) {
      throw new Error("Provider parameter is required");
    }

    // Sort token addresses (V4 requires currency0 < currency1)
    let currency0, currency1, tokensSwapped;
    if (token0Address.toLowerCase() < token1Address.toLowerCase()) {
      currency0 = token0Address;
      currency1 = token1Address;
      tokensSwapped = false;
    } else {
      currency0 = token1Address;
      currency1 = token0Address;
      tokensSwapped = true;
    }

    // Construct PoolKey
    const poolKey = {
      currency0,
      currency1,
      fee,
      tickSpacing,
      hooks
    };

    // Compute poolId
    const poolId = this._computePoolId(poolKey);

    // Get pool data from StateView
    const poolData = await this.getPoolData(poolId, provider);

    // Get token configs for metadata
    const token0Config = currency0 === ethers.constants.AddressZero
      ? { address: ethers.constants.AddressZero, decimals: 18, symbol: 'ETH' }
      : getTokenByAddress(currency0, this.chainId) || { address: currency0, decimals: 18, symbol: 'UNKNOWN' };

    const token1Config = currency1 === ethers.constants.AddressZero
      ? { address: ethers.constants.AddressZero, decimals: 18, symbol: 'ETH' }
      : getTokenByAddress(currency1, this.chainId) || { address: currency1, decimals: 18, symbol: 'UNKNOWN' };

    // Return enriched pool data
    return {
      ...poolData,
      poolId,
      poolKey,
      token0: {
        address: currency0,
        decimals: token0Config.decimals,
        symbol: token0Config.symbol
      },
      token1: {
        address: currency1,
        decimals: token1Config.decimals,
        symbol: token1Config.symbol
      },
      tokensSwapped
    };
  }

  /**
   * Sort tokens into the platform's canonical ordering
   *
   * V4 note: Same address-based ordering as V3 (lower address = token0).
   *
   * @param {Object} token0 - First token data
   * @param {Object} token1 - Second token data
   * @returns {Object} { sortedToken0, sortedToken1, tokensSwapped }
   */
  sortTokens(token0, token1) {
    // Token ordering is the same as V3 - by address
    if (!token0?.address || !token1?.address) {
      throw new Error("Both tokens must have valid addresses");
    }

    const addr0 = token0.address.toLowerCase();
    const addr1 = token1.address.toLowerCase();

    if (addr0 < addr1) {
      return { sortedToken0: token0, sortedToken1: token1, tokensSwapped: false };
    } else {
      return { sortedToken0: token1, sortedToken1: token0, tokensSwapped: true };
    }
  }

  /**
   * Get the address that tokens should be approved to for operations
   *
   * For Uniswap V4:
   * - Swaps: Tokens approved to Permit2 (UniversalRouter pulls via Permit2)
   * - Liquidity: Tokens approved directly to V4 PositionManager
   *
   * @param {string} [operationType='swap'] - 'swap' or 'liquidity'
   * @returns {string} Approval target address
   */
  getApprovalTarget(operationType = 'swap') {
    if (operationType === 'liquidity') {
      return this.addresses.positionManagerAddress;
    }
    return PERMIT2_ADDRESS;
  }

  // ===========================================================================
  // V4-SPECIFIC HELPER METHODS
  // ===========================================================================

  /**
   * Compute PoolId from PoolKey
   *
   * PoolId = keccak256(abi.encode(currency0, currency1, fee, tickSpacing, hooks))
   *
   * @param {Object} poolKey - { currency0, currency1, fee, tickSpacing, hooks }
   * @param {string} poolKey.currency0 - First token address (lower address)
   * @param {string} poolKey.currency1 - Second token address (higher address)
   * @param {number} poolKey.fee - Fee in hundredths of a bip (e.g., 3000 = 0.30%)
   * @param {number} poolKey.tickSpacing - Tick spacing for the pool
   * @param {string} poolKey.hooks - Hooks contract address (0x0 for no hooks)
   * @returns {string} PoolId as bytes32 hex string
   */
  _computePoolId(poolKey) {
    // Validate poolKey
    if (!poolKey) {
      throw new Error("poolKey parameter is required");
    }
    if (!poolKey.currency0 || !poolKey.currency1) {
      throw new Error("poolKey must have currency0 and currency1");
    }
    if (poolKey.fee === undefined || poolKey.fee === null) {
      throw new Error("poolKey must have fee");
    }
    if (poolKey.tickSpacing === undefined || poolKey.tickSpacing === null) {
      throw new Error("poolKey must have tickSpacing");
    }
    if (!poolKey.hooks) {
      throw new Error("poolKey must have hooks (use ethers.constants.AddressZero for no hooks)");
    }

    // Validate addresses
    try {
      ethers.utils.getAddress(poolKey.currency0);
      ethers.utils.getAddress(poolKey.currency1);
      ethers.utils.getAddress(poolKey.hooks);
    } catch (error) {
      throw new Error(`Invalid address in poolKey: ${error.message}`);
    }

    // Validate currency ordering (currency0 < currency1)
    if (poolKey.currency0.toLowerCase() >= poolKey.currency1.toLowerCase()) {
      throw new Error("currency0 must be less than currency1 (addresses must be sorted)");
    }

    // Encode PoolKey and compute hash
    // PoolKey struct: { Currency currency0, Currency currency1, uint24 fee, int24 tickSpacing, IHooks hooks }
    const encoded = ethers.utils.defaultAbiCoder.encode(
      ['address', 'address', 'uint24', 'int24', 'address'],
      [poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks]
    );

    return ethers.utils.keccak256(encoded);
  }

  /**
   * Get PoolKey for a given PoolId
   *
   * V4 note: PoolKey must be stored/indexed separately since it cannot be
   * derived from PoolId alone (hash is not reversible).
   *
   * @param {string} poolId - PoolId bytes32
   * @param {Object} provider - Ethers provider
   * @returns {Promise<Object>} PoolKey object
   */
  async getPoolKeyFromId(poolId, provider) {
    // TODO: Look up PoolKey from indexer or cache
    // PoolKeys need to be stored at pool creation time
    throw new Error("UniswapV4Adapter.getPoolKeyFromId not implemented");
  }
}
