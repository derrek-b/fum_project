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
import { getPlatformFeeTiers, getPlatformTickSpacing, getPlatformTickBounds } from "../helpers/platformHelpers.js";
import { getPlatformAddresses, getChainConfig, getChainRpcUrls } from "../helpers/chainHelpers.js";
import { getTokenByAddress, getTokenBySymbol, getTokenAddress, getWethAddress, isNativeToken } from "../helpers/tokenHelpers.js";
import { PERMIT2_ADDRESS, wrapWithPermit2, getPermit2Nonce, generatePermit2Signature } from "../helpers/Permit2Helper.js";
import { Position, Pool, NonfungiblePositionManager, tickToPrice, priceToClosestTick, TickMath } from '@uniswap/v3-sdk';
import { Percent, Token, CurrencyAmount, Price, TradeType, Ether } from '@uniswap/sdk-core';
import { AlphaRouter, SwapType } from '@uniswap/smart-order-router';
import { UniversalRouterVersion } from '@uniswap/universal-router-sdk';
import JSBI from "jsbi";

// Import ABIs from Uniswap and OpenZeppelin libraries
import NonfungiblePositionManagerARTIFACT from '@uniswap/v3-periphery/artifacts/contracts/NonfungiblePositionManager.sol/NonfungiblePositionManager.json' with { type: 'json' };
import IUniswapV3PoolARTIFACT from '@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Pool.sol/IUniswapV3Pool.json' with { type: 'json' };
import SwapRouterARTIFACT from '@uniswap/v3-periphery/artifacts/contracts/SwapRouter.sol/SwapRouter.json' with { type: 'json' };
import QuoterARTIFACT from '@uniswap/v3-periphery/artifacts/contracts/lens/QuoterV2.sol/QuoterV2.json' with { type: 'json' };
import UniversalRouterARTIFACT from '@uniswap/universal-router/artifacts/contracts/UniversalRouter.sol/UniversalRouter.json' with { type: 'json' };
import ERC20ARTIFACT from '@openzeppelin/contracts/build/contracts/ERC20.json' with { type: 'json' };

const NonfungiblePositionManagerABI = NonfungiblePositionManagerARTIFACT.abi;
const IUniswapV3PoolABI = IUniswapV3PoolARTIFACT.abi;
const SwapRouterABI = SwapRouterARTIFACT.abi;
const QuoterABI = QuoterARTIFACT.abi;
const UniversalRouterABI = UniversalRouterARTIFACT.abi;
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
 * const adapter = new UniswapV3Adapter(42161, provider);
 *
 * // Get pool data by address
 * const poolData = await adapter.getPoolData(poolAddress, provider);
 *
 * // Get positions for a vault
 * const vdsData = await adapter.getPositionsForVDS(vaultAddress, provider);
 */
export default class UniswapV3Adapter extends PlatformAdapter {
  /**
   * Constructor
   * @param {number} chainId - Chain ID for the adapter
   * @param {Object} provider - Ethers provider instance
   */
  constructor(chainId, provider) {
    super(chainId, "uniswapV3", "Uniswap V3");

    // Cache platform addresses (getPlatformAddresses throws if not configured)
    this.addresses = { ...getPlatformAddresses(chainId, "uniswapV3") };

    // Cache platform configuration data
    this.feeTiers = getPlatformFeeTiers("uniswapV3");
    this.chainConfig = getChainConfig(chainId);

    // Store the imported ABIs
    this.nonfungiblePositionManagerABI = NonfungiblePositionManagerABI;
    this.uniswapV3PoolABI = IUniswapV3PoolABI;
    this.swapRouterABI = SwapRouterABI;
    this.quoterABI = QuoterABI;
    this.universalRouterABI = UniversalRouterABI;
    this.erc20ABI = ERC20ABI;

    // Pre-create contract interfaces for better performance
    this.swapRouterInterface = new ethers.utils.Interface(this.swapRouterABI);
    this.positionManagerInterface = new ethers.utils.Interface(this.nonfungiblePositionManagerABI);
    this.poolInterface = new ethers.utils.Interface(this.uniswapV3PoolABI);
    this.quoterInterface = new ethers.utils.Interface(this.quoterABI);
    this.universalRouterInterface = new ethers.utils.Interface(this.universalRouterABI);
    this.erc20Interface = new ethers.utils.Interface(this.erc20ABI);

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

  /**
   * Get required approval transactions for a given operation type
   *
   * For Uniswap V3:
   * - Swaps: ERC20 approve to Permit2 (Universal Router pulls via Permit2)
   * - Liquidity: ERC20 approve directly to NFT Position Manager
   *
   * @param {string} operationType - Operation type: 'swap' or 'liquidity'
   * @param {string} vaultAddress - Address of the vault that needs approvals
   * @param {Array<string>} tokenAddresses - Array of token addresses to approve
   * @param {Object} provider - Ethers provider for checking current allowances
   * @returns {Promise<Array<Object>>} Array of transaction objects { to, data, value }
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

    // Determine the spender based on operation type
    const spender = operationType === 'liquidity'
      ? this.addresses.positionManagerAddress
      : PERMIT2_ADDRESS;

    // Check each token and add approval tx if needed
    for (const tokenAddress of tokenAddresses) {
      // Skip native ETH - no ERC20 approval needed
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
   * Check if an ERC20 approval is needed
   *
   * Returns true if current allowance is less than half of MaxUint256.
   * This threshold ensures we don't need to re-approve frequently.
   *
   * @param {string} vaultAddress - Address that owns the tokens
   * @param {string} tokenAddress - Token contract address
   * @param {string} spender - Address that will spend tokens
   * @param {Object} provider - Ethers provider
   * @returns {Promise<boolean>} True if approval is needed
   * @private
   */
  async _checkNeedsERC20Approval(vaultAddress, tokenAddress, spender, provider) {
    const token = new ethers.Contract(tokenAddress, this.erc20ABI, provider);
    const allowance = await token.allowance(vaultAddress, spender);
    // Renew approval if less than half of max (avoid frequent re-approvals)
    return allowance.lt(ethers.constants.MaxUint256.div(2));
  }

  /**
   * Encode an ERC20 approve transaction
   *
   * @param {string} tokenAddress - Token contract address
   * @param {string} spender - Address to approve
   * @returns {Object} Transaction object { to, data, value }
   * @private
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

  /**
   * Get the Uniswap V3 swap event signature
   * @returns {string} The Uniswap V3 Swap event signature
   */
  _getSwapEventSignature() {
    return 'Swap(address,address,int256,int256,uint160,uint128,int24)';
  }

  /**
   * Get the event filter for monitoring swap events
   *
   * For Uniswap V3, the poolId IS the pool contract address, so the filter
   * listens directly to that contract for Swap events.
   *
   * @param {string} poolId - Pool contract address
   * @returns {Object} Filter object with address and topics
   * @throws {Error} If poolId is invalid
   */
  getSwapEventFilter(poolId) {
    // Validate poolId
    if (!poolId || typeof poolId !== 'string') {
      throw new Error('poolId parameter is required and must be a string');
    }

    // Validate it's a valid address format
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
   * Parse a Uniswap V3 swap event log from the blockchain
   *
   * Extracts key data from a Uniswap V3 Swap event log, returning
   * normalized data that can be used for position evaluation and decision making.
   *
   * Uniswap V3 Swap event signature:
   * event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)
   *
   * @param {Object} log - Raw blockchain event log
   * @param {string} log.address - Pool contract address that emitted the event
   * @param {Array<string>} log.topics - Array of indexed event topics [eventSig, sender, recipient]
   * @param {string} log.data - ABI-encoded non-indexed event data
   * @returns {Object} Parsed swap event data
   * @returns {number} result.tick - Current tick after the swap
   * @returns {string} result.sqrtPriceX96 - Square root price in Q64.96 format (string)
   * @returns {string} result.liquidity - Pool liquidity at time of swap (string)
   * @returns {string} result.amount0 - Amount of token0 swapped (signed, string)
   * @returns {string} result.amount1 - Amount of token1 swapped (signed, string)
   * @returns {string} result.sender - Address that initiated the swap (indexed)
   * @returns {string} result.recipient - Address that received the swap output (indexed)
   * @throws {Error} If log is null/undefined or missing required properties
   * @throws {Error} If log cannot be parsed as a Uniswap V3 Swap event
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
      throw new Error('Log must have at least 3 topics (event signature, sender, recipient)');
    }

    if (!log.data) {
      throw new Error('Log must have data property');
    }

    // Validate the event signature matches Uniswap V3 Swap event
    const expectedTopic = ethers.utils.id(this._getSwapEventSignature());
    if (log.topics[0] !== expectedTopic) {
      throw new Error(`Invalid swap event signature. Expected ${expectedTopic}, got ${log.topics[0]}`);
    }

    try {
      // Create interface for parsing
      const swapInterface = new ethers.utils.Interface([
        'event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)'
      ]);

      // Parse the log
      const decoded = swapInterface.parseLog(log);

      // Extract indexed parameters from topics
      // topics[1] = sender (padded to 32 bytes)
      // topics[2] = recipient (padded to 32 bytes)
      const sender = ethers.utils.getAddress('0x' + log.topics[1].slice(26));
      const recipient = ethers.utils.getAddress('0x' + log.topics[2].slice(26));

      return {
        tick: Number(decoded.args.tick),
        sqrtPriceX96: decoded.args.sqrtPriceX96.toString(),
        liquidity: decoded.args.liquidity.toString(),
        amount0: decoded.args.amount0.toString(),
        amount1: decoded.args.amount1.toString(),
        sender,
        recipient
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
   * Evaluate price movement between current swap state and a baseline tick
   *
   * For Uniswap V3, compares current tick from swap event against a baseline tick
   * to calculate percentage price movement. Uses tickToPrice for accurate conversion.
   *
   * @param {Object} currentTickData - Parsed swap event data from parseSwapEvent()
   * @param {number} currentTickData.tick - Current tick from swap event
   * @param {number} baseline - Baseline tick value (stored when position was entered)
   * @param {Object} token0Data - Token0 data object
   * @param {string} token0Data.address - Token contract address
   * @param {string} token0Data.symbol - Token symbol
   * @param {number} token0Data.decimals - Token decimals
   * @param {Object} token1Data - Token1 data object
   * @param {string} token1Data.address - Token contract address
   * @param {string} token1Data.symbol - Token symbol
   * @param {number} token1Data.decimals - Token decimals
   * @returns {Object} Price movement evaluation
   * @returns {number} result.priceMovementPercent - Absolute percentage price movement
   * @returns {string} result.baselinePrice - Baseline price as human-readable string
   * @returns {string} result.currentPrice - Current price as human-readable string
   * @returns {string} result.direction - 'up' or 'down' indicating price direction
   * @throws {Error} If currentTickData or baseline is invalid
   */
  evaluatePriceMovement(currentTickData, baseline, token0Data, token1Data) {
    // Validate currentTickData
    if (!currentTickData) {
      throw new Error('currentTickData parameter is required');
    }

    if (typeof currentTickData.tick !== 'number') {
      throw new Error('currentTickData must have tick property as a number');
    }

    // Validate baseline
    if (baseline === undefined || baseline === null) {
      throw new Error('baseline parameter is required');
    }

    if (typeof baseline !== 'number') {
      throw new Error('baseline must be a number (tick value)');
    }

    // Validate token data
    if (!token0Data || !token0Data.address || !token0Data.symbol || token0Data.decimals === undefined) {
      throw new Error('token0Data must have address, symbol, and decimals properties');
    }

    if (!token1Data || !token1Data.address || !token1Data.symbol || token1Data.decimals === undefined) {
      throw new Error('token1Data must have address, symbol, and decimals properties');
    }

    const currentTick = currentTickData.tick;

    // Convert ticks to prices using the SDK
    const baselinePrice = this.tickToPrice(baseline, token0Data, token1Data, this.chainId);
    const currentPrice = this.tickToPrice(currentTick, token0Data, token1Data, this.chainId);

    // Calculate price movement percentage
    const baselinePriceValue = parseFloat(baselinePrice.toSignificant(18));
    const currentPriceValue = parseFloat(currentPrice.toSignificant(18));

    // Avoid division by zero
    if (baselinePriceValue === 0) {
      throw new Error('Baseline price is zero, cannot calculate movement');
    }

    const priceRatio = currentPriceValue / baselinePriceValue;
    const priceMovementPercent = Math.abs((priceRatio - 1) * 100);
    const direction = currentPriceValue >= baselinePriceValue ? 'up' : 'down';

    return {
      priceMovementPercent,
      baselinePrice: baselinePriceValue.toString(),
      currentPrice: currentPriceValue.toString(),
      direction
    };
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

    if (!contract[method]) {
      throw new Error(`Method '${method}' does not exist or cannot estimate gas`);
    }

    if (!Array.isArray(args)) {
      throw new Error('Args must be an array');
    }

    if (overrides !== undefined && (typeof overrides !== 'object' || overrides === null)) {
      throw new Error('Overrides must be an object if provided');
    }

    try {
      const estimatedGas = await contract.estimateGas[method](...args, overrides);
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
      ethers.utils.getAddress(txData.to); // This will throw if invalid
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
    // slippageTolerance is a percentage (e.g., 5 = 5%)
    // Convert to basis points: 5 * 100 = 500, then Percent(500, 10_000) = 5%
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
   * Calculate tick range from percentage parameters
   * @static
   * @param {number} currentTick - Current tick of the pool
   * @param {number} upperPercent - Upper range in percentage (e.g., 10 for 10%)
   * @param {number} lowerPercent - Lower range in percentage (e.g., 10 for 10%)
   * @param {number} fee - Fee tier (100, 500, 3000, or 10000)
   * @returns {{tickLower: number, tickUpper: number}} Tick range aligned to tick spacing
   * @throws {Error} If fee tier is invalid
   */
  calculateTickRangeFromPercentages(currentTick, upperPercent, lowerPercent, fee) {
    // Validate currentTick
    if (!Number.isFinite(currentTick)) {
      throw new Error(`Invalid currentTick: ${currentTick}. Must be a finite number.`);
    }

    // Validate upperPercent
    if (!Number.isFinite(upperPercent)) {
      throw new Error(`Invalid upperPercent: ${upperPercent}. Must be a finite number.`);
    }
    if (upperPercent <= 0 || upperPercent > 100) {
      throw new Error(`Invalid upperPercent: ${upperPercent}. Must be between 0 and 100 (exclusive of 0).`);
    }

    // Validate lowerPercent
    if (!Number.isFinite(lowerPercent)) {
      throw new Error(`Invalid lowerPercent: ${lowerPercent}. Must be a finite number.`);
    }
    if (lowerPercent <= 0 || lowerPercent > 100) {
      throw new Error(`Invalid lowerPercent: ${lowerPercent}. Must be between 0 and 100 (exclusive of 0).`);
    }

    // Validate fee
    if (!Number.isFinite(fee)) {
      throw new Error(`Invalid fee: ${fee}. Must be a finite number.`);
    }

    // Get tick spacing from platform configuration
    const tickSpacing = getPlatformTickSpacing('uniswapV3', fee);

    // Convert percentages to tick offsets
    // Formula: 1% price change ≈ 100 ticks (since 1.0001^100 ≈ 1.01)
    const ticksPerPercent = Math.round(Math.log(1.01) / Math.log(1.0001));
    const upperOffset = Math.round(upperPercent * ticksPerPercent);
    const lowerOffset = Math.round(lowerPercent * ticksPerPercent);

    // Calculate raw tick positions
    const rawUpperTick = currentTick + upperOffset;
    const rawLowerTick = currentTick - lowerOffset;

    // Align ticks to tick spacing boundaries
    // Upper tick: round up to next valid tick
    // Lower tick: round down to previous valid tick
    let tickUpper = Math.ceil(rawUpperTick / tickSpacing) * tickSpacing;
    let tickLower = Math.floor(rawLowerTick / tickSpacing) * tickSpacing;

    // Convert -0 to +0 for consistency (JavaScript distinguishes between them)
    if (Object.is(tickUpper, -0)) tickUpper = 0;
    if (Object.is(tickLower, -0)) tickLower = 0;

    // Validate against platform tick bounds
    const { minTick, maxTick } = getPlatformTickBounds('uniswapV3');

    if (tickLower < minTick || tickLower > maxTick) {
      throw new Error(`Invalid tickLower: ${tickLower}. Must be between ${minTick} and ${maxTick}.`);
    }
    if (tickUpper < minTick || tickUpper > maxTick) {
      throw new Error(`Invalid tickUpper: ${tickUpper}. Must be between ${minTick} and ${maxTick}.`);
    }

    // Ensure valid range (tickLower must be less than tickUpper)
    if (tickLower >= tickUpper) {
      throw new Error(`Invalid tick range: tickLower (${tickLower}) must be less than tickUpper (${tickUpper})`);
    }

    return { tickLower, tickUpper };
  }

  /**
   * Calculate position range bounds from percentage parameters
   *
   * Wraps calculateTickRangeFromPercentages and returns a position object
   * suitable for passing to getAddLiquidityAmounts and generateCreatePositionData.
   *
   * @param {Object} poolData - Pool data object with tick and fee properties
   * @param {number} poolData.tick - Current tick of the pool
   * @param {number} poolData.fee - Fee tier (100, 500, 3000, or 10000)
   * @param {number} upperPercent - Upper range in percentage (e.g., 5 for +5%)
   * @param {number} lowerPercent - Lower range in percentage (e.g., 5 for -5%)
   * @returns {{tickLower: number, tickUpper: number, currentTick: number}} Position range
   * @throws {Error} If poolData is missing required properties or percentages are invalid
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
    if (poolData.fee === null || poolData.fee === undefined) {
      throw new Error('poolData.fee is required');
    }
    if (!Number.isFinite(poolData.fee)) {
      throw new Error('poolData.fee must be a finite number');
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

    // Delegate to existing method for tick calculation
    const { tickLower, tickUpper } = this.calculateTickRangeFromPercentages(
      poolData.tick,
      upperPercent,
      lowerPercent,
      poolData.fee
    );

    // Return position object with current tick for logging
    return {
      tickLower,
      tickUpper,
      currentTick: poolData.tick
    };
  }

  /**
   * Extract position bounds from an existing position object
   *
   * For Uniswap V3, positions store bounds as tickLower and tickUpper.
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
   * Get current tick from pool data
   *
   * For Uniswap V3, the current pool state is represented by the tick.
   * Used for emergency exit baseline capture.
   *
   * @param {Object} poolData - Pool data object with tick property
   * @returns {number} Current tick
   * @throws {Error} If poolData is invalid or missing tick property
   */
  getPoolCurrent(poolData) {
    if (!poolData || poolData.tick === undefined) {
      throw new Error('Pool data must have tick property');
    }
    return poolData.tick;
  }

  /**
   * Validate that provider is on the correct chain
   * @param {Object} provider - Ethers provider instance
   * @throws {Error} If provider is invalid or on wrong chain
   */
  async _validateProviderChain(provider) {
    // Validate provider using ethers pattern
    if (!(provider instanceof ethers.providers.Provider)) {
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
  async _getPoolAddress(token0Address, token1Address, fee, provider) {
    // Validate token0 address
    if (!token0Address) {
      throw new Error("Token0 address parameter is required");
    }
    try {
      ethers.utils.getAddress(token0Address);
    } catch (error) {
      throw new Error(`Invalid token0 address: ${token0Address}`);
    }

    // Validate token1 address
    if (!token1Address) {
      throw new Error("Token1 address parameter is required");
    }
    try {
      ethers.utils.getAddress(token1Address);
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
      ethers.utils.getAddress(token0.address);
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
      ethers.utils.getAddress(token1.address);
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
      const poolAddress = await this._getPoolAddress(token0.address, token1.address, fee, provider);

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
      ethers.utils.getAddress(address); // This will throw if invalid
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
   * @private
   */
  async _fetchPoolData(token0Address, token1Address, fee, provider) {
    // Validate token0 address
    if (!token0Address) {
      throw new Error("Token0 address parameter is required");
    }
    try {
      ethers.utils.getAddress(token0Address);
    } catch (error) {
      throw new Error(`Invalid token0 address: ${token0Address}`);
    }

    // Validate token1 address
    if (!token1Address) {
      throw new Error("Token1 address parameter is required");
    }
    try {
      ethers.utils.getAddress(token1Address);
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
    const poolAddress = await this._getPoolAddress(token0Data.address, token1Data.address, fee, provider);

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
   * Get pool data by address
   *
   * Returns core pool state needed for position management and price calculations.
   * Use fetchTickData() separately if tick-specific data is needed.
   *
   * @param {string} poolAddress - Pool contract address
   * @param {Object} provider - Ethers provider instance
   * @returns {Promise<Object>} Pool data object
   * @throws {Error} If parameters are invalid or pool data cannot be retrieved
   */
  async getPoolData(poolAddress, provider) {
    // Validate pool address
    if (!poolAddress) {
      throw new Error("Pool address parameter is required");
    }

    let normalizedAddress;
    try {
      normalizedAddress = ethers.utils.getAddress(poolAddress);
    } catch (error) {
      throw new Error(`Invalid pool address: ${poolAddress}`);
    }

    // Validate provider
    if (!provider || !(provider instanceof ethers.providers.Provider)) {
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

      // Build pool data object
      return {
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
      ethers.utils.getAddress(poolAddress);
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
      ethers.utils.getAddress(poolAddress);
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
      ethers.utils.getAddress(address);
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
          const poolData = await this._fetchPoolData(token0, token1, Number(fee), provider);
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
      ethers.utils.getAddress(address);
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
          // Skip positions with zero liquidity (closed positions)
          if (BigInt(position.liquidity) === 0n) {
            return;
          }
          normalizedPositions[position.id] = {
            id: position.id,
            pool: position.pool,
            tickLower: position.tickLower,
            tickUpper: position.tickUpper,
            liquidity: position.liquidity,
            // Fee fields - stable values that only change on position interaction (mint, +/- liquidity, collect, burn)
            feeGrowthInside0LastX128: position.feeGrowthInside0LastX128,
            feeGrowthInside1LastX128: position.feeGrowthInside1LastX128,
            tokensOwed0: position.tokensOwed0,
            tokensOwed1: position.tokensOwed1,
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
   * Fetch a single position by tokenId (no Graph dependency)
   * Used for immediate cache updates after position creation
   *
   * @param {string|number} tokenId - The position NFT token ID
   * @param {ethers.Provider} provider - Ethers provider
   * @returns {Promise<{position: Object, poolData: Object}>} Position and pool metadata
   * @throws {Error} If tokenId or provider is invalid, or position not found
   */
  async getPositionById(tokenId, provider) {
    // Parameter validation
    if (tokenId === null || tokenId === undefined || tokenId === '') {
      throw new Error('TokenId parameter is required');
    }
    if (!provider || typeof provider.getNetwork !== 'function') {
      throw new Error('Valid provider parameter is required');
    }

    try {
      // Get position manager contract
      const positionManager = this._getPositionManager(provider);

      // Direct on-chain call - contract reverts with "Invalid token ID" for burned/non-existent positions
      const positionData = await positionManager.positions(tokenId);

      // Zero-liquidity positions are closed — reject like burned/non-existent
      if (BigInt(positionData.liquidity.toString()) === 0n) {
        throw new Error(`Position ${tokenId} has zero liquidity`);
      }

      // Get pool address
      const poolAddress = await this._getPoolAddress(
        positionData.token0,
        positionData.token1,
        positionData.fee,
        provider
      );

      // Resolve token symbols
      const token0Info = getTokenByAddress(positionData.token0, this.chainId);
      const token1Info = getTokenByAddress(positionData.token1, this.chainId);

      return {
        position: {
          id: String(tokenId),
          pool: poolAddress,
          tickLower: positionData.tickLower,
          tickUpper: positionData.tickUpper,
          liquidity: positionData.liquidity.toString(),
          feeGrowthInside0LastX128: positionData.feeGrowthInside0LastX128.toString(),
          feeGrowthInside1LastX128: positionData.feeGrowthInside1LastX128.toString(),
          tokensOwed0: positionData.tokensOwed0.toString(),
          tokensOwed1: positionData.tokensOwed1.toString(),
          lastUpdated: Date.now()
        },
        poolData: {
          [poolAddress]: {
            token0Symbol: token0Info.symbol,
            token1Symbol: token1Info.symbol,
            fee: positionData.fee,
            platform: 'uniswapV3'
          }
        }
      };
    } catch (error) {
      // Re-throw validation errors as-is
      if (error.message.includes('TokenId parameter') ||
          error.message.includes('Valid provider') ||
          error.message.includes('zero liquidity')) {
        throw error;
      }
      throw new Error(`Failed to fetch position ${tokenId}: ${error.message}`);
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
   * Evaluate a position's range status for concentrated liquidity positions
   *
   * Determines if a position is in range and calculates distance metrics
   * for strategy decision making.
   *
   * Can be called in two modes:
   * 1. Without swapData: fetches current tick from blockchain via provider
   * 2. With options.swapData: extracts tick from parsed swap event (no RPC call)
   *
   * @param {Object} position - Position object with tick bounds
   * @param {number} position.tickLower - Lower tick bound
   * @param {number} position.tickUpper - Upper tick bound
   * @param {string} position.pool - Pool address (required if fetching from blockchain)
   * @param {Object} provider - Ethers provider instance (can be null if swapData provided)
   * @param {Object} [options] - Optional parameters
   * @param {Object} [options.swapData] - Parsed swap event data (skips RPC if provided)
   * @returns {Promise<Object>} Range evaluation result
   * @returns {boolean} result.inRange - Is current tick within position bounds
   * @returns {number} result.centeredness - Position in range (0-1, 0.5 = centered)
   * @returns {number} result.distanceToUpper - Distance to upper bound as fraction of range
   * @returns {number} result.distanceToLower - Distance to lower bound as fraction of range
   * @returns {number} result.currentTick - Current tick value
   * @throws {Error} If position missing required tick data or currentTick cannot be determined
   */
  async evaluatePositionRange(position, provider, options = {}) {
    // Validate position object
    if (!position) {
      throw new Error('position parameter is required');
    }

    // Validate tick bounds
    if (position.tickLower === undefined || position.tickLower === null) {
      throw new Error(`Position missing tick range data: tickLower=${position.tickLower}, tickUpper=${position.tickUpper}`);
    }
    if (position.tickUpper === undefined || position.tickUpper === null) {
      throw new Error(`Position missing tick range data: tickLower=${position.tickLower}, tickUpper=${position.tickUpper}`);
    }

    // Get currentTick - either from swapData or from blockchain
    let currentTick;
    if (options.swapData !== undefined) {
      // Extract tick from parsed swap event (adapter knows the structure)
      if (!options.swapData || typeof options.swapData.tick !== 'number') {
        throw new Error('options.swapData must have tick property as a number');
      }
      if (!Number.isFinite(options.swapData.tick)) {
        throw new Error('options.swapData.tick must be a finite number');
      }
      currentTick = options.swapData.tick;
    } else {
      // Fetch from blockchain (existing behavior)
      if (!position.pool) {
        throw new Error('Position missing pool address');
      }
      currentTick = await this.getCurrentTick(position.pool, provider);
    }

    // Calculate range metrics
    const rangeSize = position.tickUpper - position.tickLower;
    if (rangeSize <= 0) {
      throw new Error(`Invalid tick range: ${position.tickLower} to ${position.tickUpper}`);
    }

    const inRange = currentTick >= position.tickLower && currentTick <= position.tickUpper;
    const distanceToUpper = (position.tickUpper - currentTick) / rangeSize;
    const distanceToLower = (currentTick - position.tickLower) / rangeSize;
    const centeredness = distanceToLower; // 0 = at lower, 0.5 = centered, 1 = at upper

    return {
      inRange,
      centeredness: Math.max(0, Math.min(1, centeredness)),
      distanceToUpper: Math.max(0, Math.min(1, distanceToUpper)),
      distanceToLower: Math.max(0, Math.min(1, distanceToLower)),
      currentTick
    };
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
      validatedBaseAddress = ethers.utils.getAddress(baseToken.address);
    } catch (error) {
      throw new Error(`Invalid baseToken.address: ${baseToken.address}`);
    }

    try {
      validatedQuoteAddress = ethers.utils.getAddress(quoteToken.address);
    } catch (error) {
      throw new Error(`Invalid quoteToken.address: ${quoteToken.address}`);
    }

    // Validate tokens are not the same
    if (validatedBaseAddress.toLowerCase() === validatedQuoteAddress.toLowerCase()) {
      throw new Error("Base and quote token addresses cannot be the same");
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
      validatedBaseAddress = ethers.utils.getAddress(baseToken.address);
    } catch (error) {
      throw new Error(`Invalid baseToken.address: ${baseToken.address}`);
    }

    try {
      validatedQuoteAddress = ethers.utils.getAddress(quoteToken.address);
    } catch (error) {
      throw new Error(`Invalid quoteToken.address: ${quoteToken.address}`);
    }

    // Validate tokens are not the same
    if (validatedBaseAddress.toLowerCase() === validatedQuoteAddress.toLowerCase()) {
      throw new Error("Base and quote token addresses cannot be the same");
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
   * Convert a human-readable price to a tick value
   * @param {number} price - Human-readable price (quoteToken per baseToken)
   * @param {Object} baseToken - Base token (denominator)
   * @param {string} baseToken.address - Token address
   * @param {number} baseToken.decimals - Token decimals
   * @param {Object} quoteToken - Quote token (numerator)
   * @param {string} quoteToken.address - Token address
   * @param {number} quoteToken.decimals - Token decimals
   * @returns {number} The closest valid tick for this price
   */
  priceToTick(price, baseToken, quoteToken) {
    if (!Number.isFinite(price) || price <= 0) {
      throw new Error("Invalid price value: must be a positive finite number");
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
      validatedBaseAddress = ethers.utils.getAddress(baseToken.address);
    } catch (error) {
      throw new Error(`Invalid baseToken.address: ${baseToken.address}`);
    }

    try {
      validatedQuoteAddress = ethers.utils.getAddress(quoteToken.address);
    } catch (error) {
      throw new Error(`Invalid quoteToken.address: ${quoteToken.address}`);
    }

    // Validate that base and quote tokens are different
    if (validatedBaseAddress === validatedQuoteAddress) {
      throw new Error('Base and quote token addresses cannot be the same');
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
      const base = new Token(this.chainId, validatedBaseAddress, baseToken.decimals);
      const quote = new Token(this.chainId, validatedQuoteAddress, quoteToken.decimals);

      // Create a Price object from the human-readable price
      // The SDK's Price class stores RAW ratios, not decimal-adjusted prices.
      // Human price = rawRatio * 10^(baseDecimals - quoteDecimals)
      // So: rawRatio = humanPrice * 10^(quoteDecimals - baseDecimals)
      //
      // Example: 1 ETH per USDC (base=USDC 6dec, quote=ETH 18dec)
      // rawRatio = 1 * 10^(18-6) = 10^12
      // We express this as numerator/denominator where:
      //   denominator = 10^baseDecimals
      //   numerator = humanPrice * 10^quoteDecimals

      const denominator = (10n ** BigInt(base.decimals)).toString();
      const numerator = BigInt(Math.floor(price * Math.pow(10, quote.decimals))).toString();

      const priceObj = new Price(base, quote, denominator, numerator);

      // Convert Price object to tick using SDK function
      const tick = priceToClosestTick(priceObj);

      return tick;
    } catch (error) {
      console.error("Error converting price to tick:", error);
      throw new Error(`Failed to convert price to tick: ${error.message}`);
    }
  }

  /**
   * Calculate the original tick where a position was created based on its tick range
   *
   * This method reverse-engineers the tick at position creation time by analyzing
   * the tick range boundaries and the target range percentages used. This is useful
   * for tracking price movements from the original position creation point.
   *
   * @param {Object} position - Position data
   * @param {number} position.tickLower - Lower tick boundary of the position
   * @param {number} position.tickUpper - Upper tick boundary of the position
   * @param {number} position.fee - Fee tier (used to get tick spacing)
   * @param {number} targetRangeUpper - Target range upper percentage (0-100)
   * @param {number} targetRangeLower - Target range lower percentage (0-100)
   * @returns {number} Estimated original tick where position was created
   * @throws {Error} If position data is invalid or missing required fields
   * @throws {Error} If target range percentages are invalid
   *
   * @example
   * const originalTick = adapter.calculateOriginalTick(
   *   { tickLower: 195000, tickUpper: 205000, fee: 500 },
   *   10, // 10% upper range
   *   10  // 10% lower range
   * );
   * // Returns: 200000 (the original tick)
   * @since 1.0.0
   */
  calculateOriginalTick(position, targetRangeUpper, targetRangeLower) {
    // Parameter validation following adapter patterns
    if (!position) {
      throw new Error("Position parameter is required");
    }

    if (!Number.isFinite(position.tickLower)) {
      throw new Error("position.tickLower must be a finite number");
    }

    if (!Number.isFinite(position.tickUpper)) {
      throw new Error("position.tickUpper must be a finite number");
    }

    if (position.tickLower >= position.tickUpper) {
      throw new Error("position.tickLower must be less than position.tickUpper");
    }

    if (!Number.isFinite(position.fee)) {
      throw new Error("position.fee must be a finite number");
    }

    if (!Number.isFinite(targetRangeUpper) || targetRangeUpper < 0 || targetRangeUpper > 100) {
      throw new Error("targetRangeUpper must be a number between 0 and 100");
    }

    if (!Number.isFinite(targetRangeLower) || targetRangeLower < 0 || targetRangeLower > 100) {
      throw new Error("targetRangeLower must be a number between 0 and 100");
    }

    // Get tick spacing for the fee tier
    const tickSpacing = getPlatformTickSpacing('uniswapV3', position.fee);

    // Calculate ticks per percent (approximately 100 ticks = 1% price movement)
    const ticksPerPercent = Math.round(Math.log(1.01) / Math.log(1.0001));

    // Calculate expected tick distances from original price
    const expectedUpperTicks = Math.round(targetRangeUpper * ticksPerPercent);
    const expectedLowerTicks = Math.round(targetRangeLower * ticksPerPercent);

    // For symmetric ranges, the original tick is the midpoint
    if (targetRangeUpper === targetRangeLower) {
      const midpoint = (position.tickLower + position.tickUpper) / 2;
      return Math.round(midpoint);
    }

    // For asymmetric ranges, calculate based on the proportion
    // The original tick divides the range proportionally to the target percentages
    const totalRange = expectedUpperTicks + expectedLowerTicks;
    const actualRange = position.tickUpper - position.tickLower;

    // Account for tick spacing alignment
    // The actual range might be slightly different due to tick spacing rounding
    // We estimate the original tick based on the proportional split
    const lowerProportion = expectedLowerTicks / totalRange;
    const originalTick = Math.round(
      position.tickLower + (lowerProportion * actualRange)
    );

    return originalTick;
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
   * Calculate accrued (uncollected) fees for a position in USD
   *
   * High-level method that handles all platform-specific data fetching internally.
   * Strategy doesn't need to know about ticks, pool data structures, etc.
   *
   * @param {Object} position - Position object (with fee growth fields from cache)
   * @param {Object} tokenPrices - { token0: number, token1: number } USD prices
   * @param {Object} provider - Ethers provider
   * @returns {Promise<Object>} Accrued fees breakdown
   * @returns {number} result.totalUSD - Total fees in USD
   * @returns {number} result.token0Fees - Token0 fees (formatted, not raw)
   * @returns {number} result.token1Fees - Token1 fees (formatted, not raw)
   * @returns {number} result.token0USD - Token0 fees in USD
   * @returns {number} result.token1USD - Token1 fees in USD
   */
  async getAccruedFeesUSD(position, tokenPrices, provider) {
    // Validate inputs
    if (!position) throw new Error('position is required');
    if (!tokenPrices || typeof tokenPrices.token0 !== 'number' || typeof tokenPrices.token1 !== 'number') {
      throw new Error('tokenPrices must have token0 and token1 as numbers');
    }
    if (!provider) throw new Error('provider is required');

    // Validate position has required fee fields
    if (!position.feeGrowthInside0LastX128 || !position.feeGrowthInside1LastX128) {
      throw new Error('position missing fee growth fields');
    }
    if (!position.tokensOwed0 || !position.tokensOwed1) {
      throw new Error('position missing tokensOwed fields');
    }

    // Fetch pool data, tick data, and token addresses in parallel
    const poolContract = new ethers.Contract(position.pool, this.uniswapV3PoolABI, provider);
    const [poolData, tickData, token0Address, token1Address] = await Promise.all([
      this.getPoolData(position.pool, provider),
      this.fetchTickData(position.pool, position.tickLower, position.tickUpper, provider),
      poolContract.token0(),
      poolContract.token1()
    ]);

    // Attach tick data in the format calculateUncollectedFees expects
    poolData.ticks = {
      [position.tickLower.toString()]: tickData.tickLower,
      [position.tickUpper.toString()]: tickData.tickUpper
    };

    // Calculate uncollected fees (raw bigint values)
    const [token0FeesRaw, token1FeesRaw] = this.calculateUncollectedFees(position, poolData);

    // Get token decimals from config using addresses
    const token0Data = getTokenByAddress(token0Address, this.chainId);
    const token1Data = getTokenByAddress(token1Address, this.chainId);
    const token0Decimals = token0Data.decimals;
    const token1Decimals = token1Data.decimals;

    // Format fees
    const token0Fees = Number(token0FeesRaw) / Math.pow(10, token0Decimals);
    const token1Fees = Number(token1FeesRaw) / Math.pow(10, token1Decimals);

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
      fees0: token0FeesRaw.toString(),  // Raw amount for fallback/native ETH handling
      fees1: token1FeesRaw.toString()   // Raw amount for fallback/native ETH handling
    };
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
   * @param {Object} [provider] - Ethers provider (unused by V3, accepted for interface compatibility)
   * @returns {Promise<Array<bigint>>} Array of [token0Raw, token1Raw] amounts
   */
  async calculateTokenAmounts(position, poolData, token0Data, token1Data, provider) {
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
      ethers.utils.getAddress(token0Data.address);
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
      ethers.utils.getAddress(token1Data.address);
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
   * Select the best pool for a token pair
   * Discovers pools, filters inactive ones, sorts by liquidity, returns best
   *
   * @param {string} tokenASymbol - First token symbol (order doesn't matter)
   * @param {string} tokenBSymbol - Second token symbol
   * @param {Object} provider - Ethers provider instance
   * @param {number} chainId - Chain ID for address lookups
   * @returns {Promise<Object>} Selection result
   * @returns {Object} result.bestPool - Best pool object with full pool data
   * @returns {number} result.poolsDiscovered - Total pools found
   * @returns {number} result.poolsActive - Pools with non-zero liquidity
   * @throws {Error} If parameters invalid, no pools found, or no active pools
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

    // Discover pools (internal method has additional validation for token resolution)
    const pools = await this._discoverAvailablePools(tokenASymbol, tokenBSymbol, provider, chainId);

    if (pools.length === 0) {
      throw new Error(`No pools found for ${tokenASymbol}/${tokenBSymbol} on ${this.platformName}`);
    }

    // Filter dead pools (liquidity = 0)
    const activePools = pools.filter(pool => BigInt(pool.liquidity) > 0n);

    if (activePools.length === 0) {
      throw new Error(
        `No active pools for ${tokenASymbol}/${tokenBSymbol} on ${this.platformName} ` +
        `(${pools.length} pools exist but all have zero liquidity)`
      );
    }

    // Sort by liquidity descending (higher = better depth)
    activePools.sort((a, b) => {
      const liqA = BigInt(a.liquidity);
      const liqB = BigInt(b.liquidity);
      return liqB > liqA ? 1 : liqB < liqA ? -1 : 0;
    });

    return {
      bestPool: activePools[0],
      poolsDiscovered: pools.length,
      poolsActive: activePools.length
    };
  }

  /**
   * Discover available pools for a token pair across all fee tiers (internal)
   * V3 adapter translates ETH → WETH internally (V3 only uses WETH, not native ETH)
   * @private
   * @param {string} token0Symbol - Symbol of first token (e.g., 'ETH', 'USDC')
   * @param {string} token1Symbol - Symbol of second token
   * @param {Object} provider - Ethers provider instance
   * @param {number} chainId - Chain ID for address lookups
   * @returns {Promise<Array>} Array of pool information objects with token metadata
   */
  async _discoverAvailablePools(token0Symbol, token1Symbol, provider, chainId) {
    // Validate symbols
    if (!token0Symbol || typeof token0Symbol !== 'string') {
      throw new Error("Token0 symbol parameter is required");
    }
    if (!token1Symbol || typeof token1Symbol !== 'string') {
      throw new Error("Token1 symbol parameter is required");
    }

    // Validate chainId
    if (!chainId || typeof chainId !== 'number') {
      throw new Error("Chain ID parameter is required");
    }

    // V3 only uses WETH for ETH pairs - resolve addresses accordingly
    const resolveTokenData = (symbol) => {
      if (isNativeToken(symbol) || symbol === 'WETH') {
        // For native ETH or WETH, use WETH address - V3 only uses WETH
        const wethAddress = getWethAddress(chainId);
        return {
          address: wethAddress,
          symbol: 'WETH',  // Pool actually uses WETH
          inputWasNative: isNativeToken(symbol)
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
        inputWasNative: false
      };
    };

    const token0Data = resolveTokenData(token0Symbol);
    const token1Data = resolveTokenData(token1Symbol);

    // Validate provider
    await this._validateProviderChain(provider);

    const feeTiers = getPlatformFeeTiers('uniswapV3');
    const pools = [];

    for (const fee of feeTiers) {
      const poolAddress = await this._getPoolAddress(token0Data.address, token1Data.address, fee, provider);

      if (poolAddress === ethers.constants.AddressZero) {
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

      // Sort tokens to match pool's actual order (lower address = token0)
      const sortedAddresses = [token0Data.address, token1Data.address].sort((a, b) =>
        a.toLowerCase() < b.toLowerCase() ? -1 : 1
      );
      const poolToken0 = sortedAddresses[0] === token0Data.address.toLowerCase() ||
                         sortedAddresses[0].toLowerCase() === token0Data.address.toLowerCase()
        ? token0Data : token1Data;
      const poolToken1 = poolToken0 === token0Data ? token1Data : token0Data;

      pools.push({
        address: poolAddress,
        fee,
        liquidity: liquidity.toString(),
        sqrtPriceX96: slot0.sqrtPriceX96.toString(),
        tick: slot0.tick,
        // Include token metadata so callers know what the pool actually uses
        token0: {
          symbol: poolToken0.symbol,
          address: poolToken0.address
        },
        token1: {
          symbol: poolToken1.symbol,
          address: poolToken1.address
        }
      });
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
   * @param {boolean} [params.token0IsNative=false] - Whether token0 is native ETH (triggers unwrapWETH9)
   * @param {boolean} [params.token1IsNative=false] - Whether token1 is native ETH (triggers unwrapWETH9)
   * @param {Object} [params.poolData] - Pool data (accepted for V4 compatibility, not used by V3)
   * @returns {Object} Transaction data object with `to`, `data`, `value` properties
   * @throws {Error} If parameters are invalid or transaction data cannot be generated
   */
  async generateClaimFeesData(params) {
    const {
      position, provider, walletAddress,
      token0Address, token1Address,
      token0Decimals, token1Decimals,
      token0IsNative = false,
      token1IsNative = false,
      poolData  // Accepted for V4 compatibility, not used by V3
    } = params;

    // Position object validation
    if (position === null || position === undefined) {
      throw new Error("Position parameter is required");
    }
    if (typeof position !== 'object' || Array.isArray(position)) {
      throw new Error("Position must be an object");
    }

    // Extract and validate position.id
    const positionId = position.id;
    if (positionId === null || positionId === undefined) {
      throw new Error("Position ID is required");
    }
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
      ethers.utils.getAddress(token0Address);
    } catch (error) {
      throw new Error(`Invalid token0 address: ${token0Address}`);
    }

    // Validate token1 address
    if (!token1Address) {
      throw new Error("Token1 address parameter is required");
    }
    try {
      ethers.utils.getAddress(token1Address);
    } catch (error) {
      throw new Error(`Invalid token1 address: ${token1Address}`);
    }

    // Validate wallet address
    if (!walletAddress) {
      throw new Error("Wallet address parameter is required");
    }
    try {
      ethers.utils.getAddress(walletAddress);
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


      // Create currency instances for the SDK
      // Use Ether.onChain() for native tokens to trigger unwrapWETH9 in the multicall
      const currency0 = token0IsNative
        ? Ether.onChain(this.chainId)
        : new Token(this.chainId, token0Address, token0Decimals);

      const currency1 = token1IsNative
        ? Ether.onChain(this.chainId)
        : new Token(this.chainId, token1Address, token1Decimals);

      // For collectCallParameters, use 0 for expectedCurrencyOwed because:
      // 1. The SDK uses these values as amountMinimum for unwrapWETH9/sweepToken
      // 2. Using MaxUint128 would fail (contract doesn't have that much WETH)
      // 3. The actual collect call internally uses MaxUint128 to collect all fees
      // 4. The currency TYPE still triggers native ETH detection for unwrapping
      // 5. unwrap/sweep have no slippage risk (1:1 conversion, direct transfer)
      const collectOptions = {
        tokenId: positionId,
        expectedCurrencyOwed0: CurrencyAmount.fromRawAmount(currency0, 0),
        expectedCurrencyOwed1: CurrencyAmount.fromRawAmount(currency1, 0),
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
   * @param {boolean} [params.token0IsNative=false] - Whether token0 is native ETH (triggers unwrapWETH9)
   * @param {boolean} [params.token1IsNative=false] - Whether token1 is native ETH (triggers unwrapWETH9)
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
      deadlineMinutes,
      token0IsNative = false,
      token1IsNative = false
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

      // For collectOptions, use Ether if native (triggers unwrapWETH9 in multicall)
      // Pool/Position still use Token instances since pools always use WETH
      const collectCurrency0 = token0IsNative
        ? Ether.onChain(this.chainId)
        : token0;

      const collectCurrency1 = token1IsNative
        ? Ether.onChain(this.chainId)
        : token1;

      // For removeCallParameters, use 0 for expectedCurrencyOwed because:
      // 1. The SDK ADDS burn amounts to these values - using MaxUint128 causes overflow
      // 2. The actual collect call internally uses MaxUint128 to collect all tokens
      // 3. These values only affect amountMinimum for unwrapWETH9/sweepToken (no slippage risk)
      // 4. The currency TYPE still triggers native ETH detection for unwrapping
      const collectOptions = {
        expectedCurrencyOwed0: CurrencyAmount.fromRawAmount(collectCurrency0, 0),
        expectedCurrencyOwed1: CurrencyAmount.fromRawAmount(collectCurrency1, 0),
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
   * Parse position closure receipt to extract principal and fees
   *
   * When positions are closed via decreaseLiquidity + collect, this method parses
   * the transaction receipt to extract:
   * - Principal amounts (from DecreaseLiquidity events)
   * - Fee amounts (Collect amounts minus principal)
   *
   * @param {Object} receipt - Transaction receipt from closing positions
   * @param {Object} positionMetadata - Metadata for closed positions
   *   { [tokenId]: { position, poolMetadata, token0Data, token1Data, adapter } }
   * @param {Object} [options] - Optional settings (unused in V3, included for API compatibility)
   * @returns {Promise<Object>} Parsed closure data
   *   { principalByPosition: { [tokenId]: { amount0, amount1 } },
   *     feesByPosition: { [tokenId]: { token0, token1, metadata } } }
   */
  async parseClosureReceipt(receipt, positionMetadata, options = {}) {
    // Validate receipt
    if (receipt === null || receipt === undefined) {
      throw new Error("Receipt parameter is required");
    }
    if (!receipt.logs) {
      throw new Error("Receipt must have logs property");
    }

    // Validate positionMetadata
    if (positionMetadata === null || positionMetadata === undefined) {
      throw new Error("Position metadata parameter is required");
    }
    if (typeof positionMetadata !== 'object' || Array.isArray(positionMetadata)) {
      throw new Error("Position metadata must be an object");
    }

    const principalByPosition = {};
    const feesByPosition = {};

    // Get event topic hashes from the pre-compiled interface
    const decreaseLiquidityTopic = this.positionManagerInterface.getEventTopic('DecreaseLiquidity');
    const collectTopic = this.positionManagerInterface.getEventTopic('Collect');

    // First pass: collect DecreaseLiquidity events (principal amounts)
    for (const log of receipt.logs) {
      try {
        if (log.topics[0] === decreaseLiquidityTopic) {
          const decoded = this.positionManagerInterface.parseLog(log);
          const tokenId = decoded.args.tokenId.toString();

          if (positionMetadata[tokenId]) {
            principalByPosition[tokenId] = {
              amount0: decoded.args.amount0,
              amount1: decoded.args.amount1
            };
          }
        }
      } catch (e) {
        // Not a DecreaseLiquidity event from this interface, continue
      }
    }

    // Second pass: collect Collect events and calculate fees
    for (const log of receipt.logs) {
      try {
        if (log.topics[0] === collectTopic) {
          const decoded = this.positionManagerInterface.parseLog(log);
          const tokenId = decoded.args.tokenId.toString();

          if (positionMetadata[tokenId] && principalByPosition[tokenId]) {
            // Fees = Collect amounts - DecreaseLiquidity amounts (principal)
            const token0Fees = decoded.args.amount0.sub(principalByPosition[tokenId].amount0);
            const token1Fees = decoded.args.amount1.sub(principalByPosition[tokenId].amount1);

            feesByPosition[tokenId] = {
              token0: token0Fees,
              token1: token1Fees,
              metadata: positionMetadata[tokenId]
            };
          }
        }
      } catch (e) {
        // Not a Collect event from this interface, continue
      }
    }

    return { principalByPosition, feesByPosition };
  }

  /**
   * Parse fee collection receipt to extract collected fee amounts
   *
   * For standalone fee collection (no liquidity decrease), this method parses
   * the transaction receipt to extract the fee amounts from Collect events.
   * Unlike parseClosureReceipt where fees = Collect - DecreaseLiquidity,
   * here the Collect amounts ARE the fees directly.
   *
   * @param {Object} receipt - Transaction receipt from collect execution
   * @param {Object} positionMetadata - Metadata for positions keyed by tokenId
   *   { [tokenId]: { token0Data, token1Data } }
   * @param {Object} [options] - Optional settings (unused in V3, included for API compatibility)
   * @returns {Promise<Object>} Parsed fee data
   *   { feesByPosition: { [tokenId]: { token0: BigNumber, token1: BigNumber, metadata } } }
   */
  async parseCollectReceipt(receipt, positionMetadata, options = {}) {
    // Validate receipt
    if (receipt === null || receipt === undefined) {
      throw new Error("Receipt parameter is required");
    }
    if (!receipt.logs) {
      throw new Error("Receipt must have logs property");
    }

    // Validate positionMetadata
    if (positionMetadata === null || positionMetadata === undefined) {
      throw new Error("Position metadata parameter is required");
    }
    if (typeof positionMetadata !== 'object' || Array.isArray(positionMetadata)) {
      throw new Error("Position metadata must be an object");
    }

    const feesByPosition = {};
    const collectTopic = this.positionManagerInterface.getEventTopic('Collect');

    for (const log of receipt.logs) {
      try {
        if (log.topics[0] === collectTopic) {
          const decoded = this.positionManagerInterface.parseLog(log);
          const tokenId = decoded.args.tokenId.toString();

          if (positionMetadata[tokenId]) {
            // For standalone collect, amounts ARE the fees
            feesByPosition[tokenId] = {
              token0: decoded.args.amount0,
              token1: decoded.args.amount1,
              metadata: positionMetadata[tokenId]
            };
          }
        }
      } catch (e) {
        // Not a Collect event from this interface, continue
      }
    }

    return { feesByPosition };
  }

  /**
   * Parse swap transaction receipt to extract actual swap amounts
   *
   * When swaps are executed, this method parses the transaction receipt to extract
   * the actual amounts swapped from Uniswap V3 Swap events.
   *
   * @param {Object} receipt - Transaction receipt from swap execution
   * @param {Object} receipt.logs - Array of transaction logs
   * @param {Array} swapMetadata - Array of swap metadata in execution order
   * @param {string} swapMetadata[].tokenInAddress - Input token address
   * @param {string} swapMetadata[].tokenOutAddress - Output token address
   * @param {number} [swapMetadata[].expectedSwapEvents=1] - Number of swap events for this swap
   * @param {Array} [swapMetadata[].routes] - Multi-hop route info for split routes
   * @param {Array} swapMetadata[].routes[].tokenPath - Array of token addresses in route
   * @param {number} swapMetadata[].routes[].poolCount - Number of pools in route
   * @returns {Array<{actualAmountIn: string, actualAmountOut: string}>} Actual amounts per swap
   * @throws {Error} If receipt or swapMetadata is null/undefined
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

    // Get Swap event topic from pool interface
    const swapTopicHash = this.poolInterface.getEventTopic('Swap');

    // Collect all swap events from the receipt
    const swapEvents = [];
    for (const log of receipt.logs) {
      try {
        if (log.topics[0] === swapTopicHash) {
          const decoded = this.poolInterface.parseLog(log);
          swapEvents.push({
            poolAddress: log.address,
            amount0: decoded.args.amount0,
            amount1: decoded.args.amount1
          });
        }
      } catch (e) {
        // Not a Swap event from this interface, continue
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
   * When liquidity is added to an existing position or a new position is created,
   * this method parses the transaction receipt to extract the actual token amounts
   * consumed and liquidity added.
   *
   * @param {Object} receipt - Transaction receipt from increaseLiquidity/mint
   * @param {Object} receipt.logs - Array of transaction logs
   * @returns {Object} Parsed position data
   * @returns {string} result.tokenId - Position NFT token ID
   * @returns {string} result.liquidity - Liquidity added
   * @returns {string} result.amount0 - Actual token0 amount consumed
   * @returns {string} result.amount1 - Actual token1 amount consumed
   * @returns {number|null} result.tickLower - Lower tick (only for new positions)
   * @returns {number|null} result.tickUpper - Upper tick (only for new positions)
   * @returns {string|null} result.poolAddress - Pool address (only for new positions)
   * @throws {Error} If receipt is null/undefined or IncreaseLiquidity event not found
   * @param {Object} context - Platform-specific context (unused in V3, required for interface)
   * @param {Object} context.position - Position object (unused - V3 has amounts in events)
   * @param {Object} context.poolData - Pool data (unused - V3 has amounts in events)
   */
  parseIncreaseLiquidityReceipt(receipt, { position, poolData } = {}) {
    // Validate receipt
    if (receipt === null || receipt === undefined) {
      throw new Error("Receipt parameter is required");
    }
    if (!receipt.logs) {
      throw new Error("Receipt must have logs property");
    }

    // Get event topic hashes from pre-compiled interface
    const increaseLiquidityTopic = this.positionManagerInterface.getEventTopic('IncreaseLiquidity');

    // Mint event from pool (for new positions)
    const mintInterface = new ethers.utils.Interface([
      'event Mint(address sender, address indexed owner, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount, uint256 amount0, uint256 amount1)'
    ]);
    const mintTopicHash = mintInterface.getEventTopic('Mint');

    let increaseLiqEvent = null;
    let mintEvent = null;

    // Parse all logs to find the events we need
    for (const log of receipt.logs) {
      try {
        // Try to parse as IncreaseLiquidity event
        if (log.topics[0] === increaseLiquidityTopic) {
          const decoded = this.positionManagerInterface.parseLog(log);
          increaseLiqEvent = {
            tokenId: decoded.args.tokenId.toString(),
            liquidity: decoded.args.liquidity.toString(),
            amount0: decoded.args.amount0.toString(),
            amount1: decoded.args.amount1.toString()
          };
        }

        // Try to parse as Mint event (only present for new position creation)
        if (log.topics[0] === mintTopicHash) {
          const decoded = mintInterface.parseLog(log);
          mintEvent = {
            poolAddress: log.address,
            tickLower: Number(decoded.args.tickLower),
            tickUpper: Number(decoded.args.tickUpper),
            amount0: decoded.args.amount0.toString(),
            amount1: decoded.args.amount1.toString()
          };
        }
      } catch (e) {
        // Not an event we're looking for, continue
      }
    }

    if (!increaseLiqEvent) {
      throw new Error('IncreaseLiquidity event not found in receipt');
    }

    // Return combined data from both events
    return {
      // From IncreaseLiquidity event (always present)
      tokenId: increaseLiqEvent.tokenId,
      liquidity: increaseLiqEvent.liquidity,
      amount0: increaseLiqEvent.amount0,
      amount1: increaseLiqEvent.amount1,

      // From Mint event (only for new positions)
      tickLower: mintEvent?.tickLower ?? null,
      tickUpper: mintEvent?.tickUpper ?? null,
      poolAddress: mintEvent?.poolAddress ?? null
    };
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

      // =====================================================================
      // Apply Slippage BEFORE Position Calculation (same approach as V4)
      // =====================================================================
      //
      // We calculate position from reduced amounts to get conservative liquidity,
      // then set Desired = full balances (what we're willing to provide) and
      // Min = mintAmounts from conservative calc (floor protection).
      //
      // This gives headroom: if price moves favorably, more can be deposited.
      // The Min protects against getting too little liquidity.

      // Store input amounts as balances (these become our Desired caps)
      const balance0 = BigInt(token0Amount);
      const balance1 = BigInt(token1Amount);

      // Apply slippage to reduce amounts for position calculation
      // e.g., 5% slippage → use 95% of balance for position calculation
      const slippageMultiplier = BigInt(Math.floor((100 - slippageTolerance) * 100));
      const slippageDivisor = BigInt(10000);

      const forPosition0 = (balance0 * slippageMultiplier / slippageDivisor).toString();
      const forPosition1 = (balance1 * slippageMultiplier / slippageDivisor).toString();

      // Calculate position from reduced amounts to get conservative mintAmounts
      const quote = await this.getAddLiquidityQuote({
        position,
        token0Amount: forPosition0,
        token1Amount: forPosition1,
        provider,
        poolData,
        token0Data,
        token1Data
      });

      // Extract the calculated position and token swap info
      const { position: positionToIncreaseBy, tokensSwapped } = quote;

      // Calldata expects amounts in SORTED token order (pool's token0/token1)
      // If tokensSwapped, caller's token0 is pool's token1 and vice versa
      const amount0Desired = tokensSwapped ? balance1 : balance0;
      const amount1Desired = tokensSwapped ? balance0 : balance1;

      // Use mintAmounts from conservative position as Min (floor protection)
      // mintAmounts are already in sorted order from SDK
      const amount0Min = positionToIncreaseBy.mintAmounts.amount0;
      const amount1Min = positionToIncreaseBy.mintAmounts.amount1;



      // Encode the increaseLiquidity function directly
      const calldata = this.positionManagerInterface.encodeFunctionData('increaseLiquidity', [{
        tokenId: position.id,
        amount0Desired: amount0Desired.toString(),
        amount1Desired: amount1Desired.toString(),
        amount0Min: amount0Min.toString(),
        amount1Min: amount1Min.toString(),
        deadline: this._createDeadline(deadlineMinutes)
      }]);

      // V3 uses WETH, not native ETH, so value is always 0
      const value = '0x00';

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
   * Get the token amounts required to add liquidity to a position
   *
   * Returns amounts in the CALLER's token order (not SDK-sorted order).
   * Internally uses getAddLiquidityQuote and maps amounts back to caller's order.
   *
   * @param {Object} params - Parameters for calculating amounts
   * @param {Object} params.position - Position range definition
   * @param {number} params.position.tickLower - Lower tick of position range
   * @param {number} params.position.tickUpper - Upper tick of position range
   * @param {string} params.token0Amount - Desired amount of caller's token0 (wei string, can be "0")
   * @param {string} params.token1Amount - Desired amount of caller's token1 (wei string, can be "0")
   * @param {Object} params.poolData - Pool state data
   * @param {number} params.poolData.fee - Pool fee tier
   * @param {string} params.poolData.sqrtPriceX96 - Current pool sqrt price
   * @param {string} params.poolData.liquidity - Current pool liquidity
   * @param {number} params.poolData.tick - Current pool tick
   * @param {Object} params.token0Data - Caller's token0 data
   * @param {string} params.token0Data.address - Token contract address
   * @param {number} params.token0Data.decimals - Token decimals
   * @param {Object} params.token1Data - Caller's token1 data
   * @param {string} params.token1Data.address - Token contract address
   * @param {number} params.token1Data.decimals - Token decimals
   * @param {Object} params.provider - Ethers provider instance
   * @returns {Promise<Object>} Calculated amounts in caller's token order
   * @returns {string} result.token0Amount - Amount of caller's token0 required (wei string)
   * @returns {string} result.token1Amount - Amount of caller's token1 required (wei string)
   * @returns {string} result.liquidity - Resulting position liquidity (wei string)
   * @throws {Error} If parameters are invalid or calculation fails
   */
  async getAddLiquidityAmounts(params) {
    const {
      position,
      token0Amount,
      token1Amount,
      poolData,
      token0Data,
      token1Data,
      provider
    } = params;

    // Position validation
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

    // Token0Amount validation
    if (token0Amount === null || token0Amount === undefined) {
      throw new Error("Token0 amount is required");
    }
    if (typeof token0Amount !== 'string') {
      throw new Error("Token0 amount must be a string");
    }
    if (!/^\d+$/.test(token0Amount)) {
      throw new Error("Token0 amount must be a positive numeric string");
    }

    // Token1Amount validation
    if (token1Amount === null || token1Amount === undefined) {
      throw new Error("Token1 amount is required");
    }
    if (typeof token1Amount !== 'string') {
      throw new Error("Token1 amount must be a string");
    }
    if (!/^\d+$/.test(token1Amount)) {
      throw new Error("Token1 amount must be a positive numeric string");
    }

    // At least one amount must be non-zero
    if (parseInt(token0Amount) === 0 && parseInt(token1Amount) === 0) {
      throw new Error("At least one token amount must be greater than 0");
    }

    // Provider validation
    await this._validateProviderChain(provider);

    // PoolData validation
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

    // Token0Data validation
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

    // Token1Data validation
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

    // Tokens must be different
    if (token0Data.address.toLowerCase() === token1Data.address.toLowerCase()) {
      throw new Error("Token0 and token1 addresses cannot be the same");
    }

    try {
      // Use internal getAddLiquidityQuote for SDK calculations
      const quote = await this.getAddLiquidityQuote({
        position,
        token0Amount,
        token1Amount,
        provider,
        poolData,
        token0Data,
        token1Data
      });

      // Extract amounts from SDK Position object
      const sdkAmount0 = quote.position.amount0.quotient.toString();
      const sdkAmount1 = quote.position.amount1.quotient.toString();
      const liquidity = quote.position.liquidity.toString();

      // Map SDK amounts back to caller's token order
      // tokensSwapped=true means caller's token0 became SDK's token1 (and vice versa)
      return {
        token0Amount: quote.tokensSwapped ? sdkAmount1 : sdkAmount0,
        token1Amount: quote.tokensSwapped ? sdkAmount0 : sdkAmount1,
        liquidity
      };
    } catch (error) {
      throw new Error(`Failed to calculate add liquidity amounts: ${error.message}`);
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
      ethers.utils.getAddress(tokenInAddress);
    } catch (error) {
      throw new Error(`Invalid tokenIn address: ${tokenInAddress}`);
    }

    // Validate tokenOut address
    if (!tokenOutAddress) {
      throw new Error("TokenOut address parameter is required");
    }
    try {
      ethers.utils.getAddress(tokenOutAddress);
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

      const result = await quoterContract.callStatic.quoteExactInputSingle(params);

      // QuoterV2 returns [amountOut, sqrtPriceX96After]
      return result[0].toString();
    } catch (error) {
      throw new Error(`Failed to get swap quote: ${error.message}`);
    }
  }

  /**
   * Get best swap quote using AlphaRouter for optimal routing
   * @param {Object} params - Parameters for getting best swap quote
   * @param {string} [params.tokenInAddress] - Address of input token (not required if tokenInIsNative=true)
   * @param {string} [params.tokenOutAddress] - Address of output token (not required if tokenOutIsNative=true)
   * @param {string} params.amount - Amount to trade (interpretation depends on isAmountIn)
   * @param {boolean} params.isAmountIn - True if amount is input (EXACT_INPUT), false if amount is output (EXACT_OUTPUT)
   * @param {boolean} [params.tokenInIsNative=false] - True if input token is native ETH (skips address validation)
   * @param {boolean} [params.tokenOutIsNative=false] - True if output token is native ETH (skips address validation)
   * @returns {Promise<Object>} Quote with { amountIn: string, amountOut: string, route: SwapRoute, methodParameters?: MethodParameters }
   * @throws {Error} If no valid route can be found
   */
  async getBestSwapQuote(params) {
    const { tokenInAddress, tokenOutAddress, amount, isAmountIn, tokenInIsNative = false, tokenOutIsNative = false } = params;

    // Validate parameters - skip address validation for native ETH (address not used)
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

    // Create Currency instances - use Ether for native ETH, Token for ERC20
    const tokenIn = tokenInIsNative
      ? Ether.onChain(this.alphaRouterChainId)
      : this._createTokenInstance(tokenInAddress);
    const tokenOut = tokenOutIsNative
      ? Ether.onChain(this.alphaRouterChainId)
      : this._createTokenInstance(tokenOutAddress);

    // Create CurrencyAmount and call AlphaRouter based on amount type
    let currencyAmount, quoteCurrency, route;

    if (!isAmountIn) {
      // Amount is desired output (EXACT_OUTPUT), find required input
      currencyAmount = CurrencyAmount.fromRawAmount(tokenOut, amount);
      quoteCurrency = tokenIn;

      route = await this.alphaRouter.route(
        currencyAmount,
        quoteCurrency,
        TradeType.EXACT_OUTPUT,
        undefined, // swapConfig - not needed for quotes only
        undefined  // partialRoutingConfig - use defaults
      );

      if (!route) {
        throw new Error(`No route found for token pair ${tokenInAddress}/${tokenOutAddress}`);
      }

      // For EXACT_OUTPUT: quote is the required input amount
      const amountIn = route.quote.quotient.toString();
      return {
        amountIn,
        amountOut: amount,
        route,
        methodParameters: route.methodParameters
      };
    } else {
      // Amount is input (EXACT_INPUT), find expected output
      currencyAmount = CurrencyAmount.fromRawAmount(tokenIn, amount);
      quoteCurrency = tokenOut;

      route = await this.alphaRouter.route(
        currencyAmount,
        quoteCurrency,
        TradeType.EXACT_INPUT,
        undefined, // swapConfig - not needed for quotes only
        undefined  // partialRoutingConfig - use defaults
      );

      if (!route) {
        throw new Error(`No route found for token pair ${tokenInAddress}/${tokenOutAddress}`);
      }

      // For EXACT_INPUT: quote is the expected output amount
      const amountOut = route.quote.quotient.toString();
      return {
        amountIn: amount,
        amountOut,
        route,
        methodParameters: route.methodParameters
      };
    }
  }

  /**
   * Get swap route with execution-ready transaction data using AlphaRouter
   * @param {Object} params - Parameters for getting swap route
   * @param {string} [params.tokenInAddress] - Address of input token (not required if tokenInIsNative=true)
   * @param {string} [params.tokenOutAddress] - Address of output token (not required if tokenOutIsNative=true)
   * @param {string} params.amount - Amount to trade (interpretation depends on isAmountIn)
   * @param {boolean} params.isAmountIn - True if amount is input (EXACT_INPUT), false if amount is output (EXACT_OUTPUT)
   * @param {string} params.recipient - Address to receive output tokens
   * @param {number} [params.slippageTolerance=0.5] - Slippage tolerance percentage (e.g., 0.5 for 0.5%)
   * @param {number} [params.deadlineMinutes=30] - Transaction deadline in minutes from now
   * @param {boolean} [params.tokenInIsNative=false] - True if input token is native ETH (skips address validation)
   * @param {boolean} [params.tokenOutIsNative=false] - True if output token is native ETH (skips address validation)
   * @returns {Promise<Object>} Route with { amountIn: string, amountOut: string, route: SwapRoute, methodParameters: MethodParameters }
   * @throws {Error} If no valid route can be found or if parameters are invalid
   */
  async getSwapRoute(params) {
    const {
      tokenInAddress,
      tokenOutAddress,
      amount,
      isAmountIn,
      recipient,
      slippageTolerance = 0.5,
      deadlineMinutes = 30,
      tokenInIsNative = false,
      tokenOutIsNative = false
    } = params;

    // Validate parameters - skip address validation for native ETH (address not used)
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

    if (!recipient || typeof recipient !== 'string') {
      throw new Error("Recipient address parameter is required for swap route");
    }
    try {
      ethers.utils.getAddress(recipient);
    } catch (error) {
      throw new Error(`Invalid recipient address: ${recipient}`);
    }

    // Validate slippage tolerance
    if (typeof slippageTolerance !== 'number' || isNaN(slippageTolerance)) {
      throw new Error("Slippage tolerance must be a number");
    }
    if (slippageTolerance < 0 || slippageTolerance > 100) {
      throw new Error("Slippage tolerance must be between 0 and 100");
    }

    // Validate deadline
    if (typeof deadlineMinutes !== 'number' || isNaN(deadlineMinutes)) {
      throw new Error("Deadline must be a number");
    }
    if (deadlineMinutes <= 0) {
      throw new Error("Deadline must be greater than 0");
    }

    // Create Currency instances - use Ether for native ETH, Token for ERC20
    const tokenIn = tokenInIsNative
      ? Ether.onChain(this.alphaRouterChainId)
      : this._createTokenInstance(tokenInAddress);
    const tokenOut = tokenOutIsNative
      ? Ether.onChain(this.alphaRouterChainId)
      : this._createTokenInstance(tokenOutAddress);

    // Build swapConfig for execution-ready transaction data using Universal Router
    const swapConfig = {
      type: SwapType.UNIVERSAL_ROUTER,
      version: UniversalRouterVersion.V2_0,
      recipient,
      slippageTolerance: new Percent(Math.floor(slippageTolerance * 100), 10_000),
      deadline: Math.floor(Date.now() / 1000 + deadlineMinutes * 60)
    };

    // Create CurrencyAmount and call AlphaRouter based on amount type
    let currencyAmount, quoteCurrency, route;

    if (!isAmountIn) {
      // Amount is desired output (EXACT_OUTPUT), find required input
      currencyAmount = CurrencyAmount.fromRawAmount(tokenOut, amount);
      quoteCurrency = tokenIn;

      route = await this.alphaRouter.route(
        currencyAmount,
        quoteCurrency,
        TradeType.EXACT_OUTPUT,
        swapConfig,
        undefined  // partialRoutingConfig - use defaults
      );

      if (!route) {
        throw new Error(`No route found for token pair ${tokenInAddress}/${tokenOutAddress}`);
      }

      // For EXACT_OUTPUT: quote is the required input amount
      const amountIn = route.quote.quotient.toString();
      return {
        amountIn,
        amountOut: amount,
        route,
        methodParameters: route.methodParameters
      };
    } else {
      // Amount is input (EXACT_INPUT), find expected output
      currencyAmount = CurrencyAmount.fromRawAmount(tokenIn, amount);
      quoteCurrency = tokenOut;

      route = await this.alphaRouter.route(
        currencyAmount,
        quoteCurrency,
        TradeType.EXACT_INPUT,
        swapConfig,
        undefined  // partialRoutingConfig - use defaults
      );

      if (!route) {
        throw new Error(`No route found for token pair ${tokenInAddress}/${tokenOutAddress}`);
      }

      // For EXACT_INPUT: quote is the expected output amount
      const amountOut = route.quote.quotient.toString();
      return {
        amountIn: amount,
        amountOut,
        route,
        methodParameters: route.methodParameters
      };
    }
  }

  /**
   * Generate swap transaction data using AlphaRouter route + Universal Router + Permit2
   *
   * For ERC20 swaps, this method wraps the swap calldata with a pre-generated Permit2 signature.
   * The caller is responsible for:
   * 1. Fetching/tracking the nonce (use getPermit2Nonce from Permit2Helper)
   * 2. Generating the signature (use generatePermit2Signature from Permit2Helper)
   * 3. Setting an appropriate deadline
   *
   * For native ETH swaps (tokenInIsNative=true), Permit2 is skipped and the route's
   * methodParameters are returned directly (no approval needed for native ETH).
   *
   * @param {Object} params - Parameters for swap
   * @param {Object} params.route - Route object from getSwapRoute() with methodParameters
   * @param {string} params.recipient - Address to receive output tokens (also the token owner)
   * @param {string} params.tokenInAddress - Address of input token (WETH address for native ETH routing)
   * @param {string} params.amountIn - Amount of input tokens (as string)
   * @param {string} [params.permit2Signature] - Pre-generated EIP-712 signature (not needed for native ETH)
   * @param {number} [params.permit2Nonce] - Current nonce for this token/owner/spender (not needed for native ETH)
   * @param {number} [params.permit2Deadline] - Unix timestamp when signature expires (not needed for native ETH)
   * @param {boolean} [params.tokenInIsNative=false] - True if input is native ETH (skips Permit2 wrapping)
   * @returns {Promise<Object>} Transaction data with {to, data, value}
   * @throws {Error} If parameters are invalid
   */
  async generateAlphaSwapData(params) {
    const {
      route, recipient, tokenInAddress, amountIn,
      permit2Signature, permit2Nonce, permit2Deadline,
      tokenInIsNative = false
    } = params;

    // Validate route object
    if (!route || typeof route !== 'object' || Array.isArray(route)) {
      throw new Error('Route parameter is required and must be an object');
    }
    if (!route.methodParameters) {
      throw new Error('Route must include methodParameters from getSwapRoute()');
    }
    if (!route.methodParameters.calldata || typeof route.methodParameters.calldata !== 'string') {
      throw new Error('Route methodParameters must include calldata');
    }

    // Validate Universal Router address (needed for both native and ERC20)
    if (!this.addresses?.universalRouterAddress) {
      throw new Error(`No Universal Router address found for chainId: ${this.chainId}`);
    }

    // Native ETH input - skip Permit2 wrapping, use route directly
    if (tokenInIsNative) {
      return {
        to: this.addresses.universalRouterAddress,
        data: route.methodParameters.calldata,
        value: route.methodParameters.value
      };
    }

    // ERC20 flow - validate recipient
    if (!recipient || typeof recipient !== 'string') {
      throw new Error('Recipient address parameter is required');
    }
    try {
      ethers.utils.getAddress(recipient);
    } catch (error) {
      throw new Error(`Invalid recipient address: ${recipient}`);
    }

    // Validate tokenInAddress
    if (!tokenInAddress || typeof tokenInAddress !== 'string') {
      throw new Error('TokenInAddress parameter is required');
    }
    try {
      ethers.utils.getAddress(tokenInAddress);
    } catch (error) {
      throw new Error(`Invalid tokenInAddress: ${tokenInAddress}`);
    }

    // Validate amountIn
    if (!amountIn) {
      throw new Error('AmountIn parameter is required');
    }

    // Validate Permit2 parameters
    if (!permit2Signature || typeof permit2Signature !== 'string') {
      throw new Error('permit2Signature parameter is required and must be a string');
    }
    if (typeof permit2Nonce !== 'number' || permit2Nonce < 0) {
      throw new Error('permit2Nonce parameter is required and must be a non-negative number');
    }
    if (typeof permit2Deadline !== 'number' || permit2Deadline <= 0) {
      throw new Error('permit2Deadline parameter is required and must be a positive number');
    }

    // Construct permitData from provided parameters
    const permitData = {
      details: {
        token: tokenInAddress,
        amount: amountIn,
        expiration: permit2Deadline,
        nonce: permit2Nonce
      },
      spender: this.addresses.universalRouterAddress,
      sigDeadline: permit2Deadline
    };

    // Wrap calldata with Permit2 command
    const wrappedCalldata = wrapWithPermit2(
      this.universalRouterInterface,
      route.methodParameters.calldata,
      permitData,
      permit2Signature
    );

    return {
      to: this.addresses.universalRouterAddress,
      data: wrappedCalldata,
      value: route.methodParameters.value
    };
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
  /**
   * @private
   * Internal method for generating swap transaction data.
   * Used by test setup files to fund wallets with tokens.
   * For production swaps, use batchSwapTransactions instead.
   */
  async _generateSwapData(params) {
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
      ethers.utils.getAddress(tokenIn);
    } catch (error) {
      throw new Error(`Invalid tokenIn address: ${tokenIn}`);
    }

    // Validate tokenOut address
    if (!tokenOut) {
      throw new Error("TokenOut address parameter is required");
    }
    try {
      ethers.utils.getAddress(tokenOut);
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
      ethers.utils.getAddress(recipient);
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
   * Generate batched swap transactions with Permit2 nonce tracking
   *
   * Creates multiple swap transactions in a batch, handling Uniswap V3-specific
   * requirements like Permit2 nonce tracking across swaps with the same input token.
   *
   * @param {Array<Object>} swapInstructions - Array of swap instructions
   * @param {Object} swapInstructions[].tokenIn - Input token { address, symbol, decimals, isNative? }
   * @param {Object} swapInstructions[].tokenOut - Output token { address, symbol, decimals, isNative? }
   * @param {string} swapInstructions[].amount - Amount to swap (raw wei string)
   * @param {boolean} swapInstructions[].isAmountIn - true for EXACT_INPUT, false for EXACT_OUTPUT
   * @param {Object} options - Common options for all swaps
   * @param {Object} options.signer - Ethers Wallet for signing Permit2 (required for ERC20 inputs)
   * @param {Object} options.provider - Ethers provider instance
   * @param {number} options.chainId - Chain ID for address lookups
   * @param {string} options.recipient - Address to receive swap outputs
   * @param {number} options.slippageTolerance - Slippage tolerance percentage
   * @returns {Promise<Object>} Batch result
   * @returns {Array<Object>} result.transactions - Array of { to, data, value } transaction objects
   * @returns {Array<Object>} result.metadata - Array of swap metadata per transaction
   * @throws {Error} If required parameters missing or swap generation fails
   */
  async batchSwapTransactions(swapInstructions, options) {
    const { signer, provider, chainId, recipient, slippageTolerance } = options;

    // Validate required options
    if (!signer) {
      throw new Error("signer is required for Permit2 signature generation");
    }
    if (!provider) {
      throw new Error("provider is required");
    }
    if (!chainId) {
      throw new Error("chainId is required");
    }
    if (!recipient) {
      throw new Error("recipient is required");
    }
    if (slippageTolerance === undefined || slippageTolerance === null) {
      throw new Error("slippageTolerance is required");
    }

    // Validate swapInstructions
    if (!Array.isArray(swapInstructions)) {
      throw new Error("swapInstructions must be an array");
    }
    if (swapInstructions.length === 0) {
      throw new Error("swapInstructions cannot be empty");
    }

    const transactions = [];
    const metadata = [];

    // Create internal nonce tracker for this batch
    // This handles the Permit2-specific requirement that nonces increment
    const nonceTracker = new Map();

    for (const instruction of swapInstructions) {
      const result = await this._generateSwapTransaction({
        ...instruction,
        signer,
        provider,
        chainId,
        recipient,
        slippageTolerance,
        _nonceTracker: nonceTracker
      });

      transactions.push(result.transaction);
      metadata.push({
        tokenInSymbol: instruction.tokenIn.symbol,
        tokenOutSymbol: instruction.tokenOut.symbol,
        tokenInAddress: instruction.tokenIn.address,
        tokenOutAddress: instruction.tokenOut.address,
        quotedAmountIn: result.quotedAmountIn,
        quotedAmountOut: result.quotedAmountOut,
        isAmountIn: result.isAmountIn
      });
    }

    return { transactions, metadata };
  }

  /**
   * Generate a single swap transaction using AlphaRouter + Permit2
   *
   * Internal method - called by batchSwapTransactions.
   * Handles all Uniswap V3-specific details:
   * - AlphaRouter route finding
   * - Permit2 nonce management
   * - Permit2 signature generation
   * - Universal Router calldata wrapping
   *
   * @param {Object} params - Swap parameters
   * @param {Object} params.tokenIn - Input token { address, symbol, decimals, isNative? }
   * @param {Object} params.tokenOut - Output token { address, symbol, decimals, isNative? }
   * @param {string} params.amount - Amount to swap (raw wei string)
   * @param {boolean} params.isAmountIn - true for EXACT_INPUT, false for EXACT_OUTPUT
   * @param {Object} params.signer - Ethers Wallet for signing Permit2
   * @param {Object} params.provider - Ethers provider instance
   * @param {number} params.chainId - Chain ID
   * @param {string} params.recipient - Address to receive swap output
   * @param {number} params.slippageTolerance - Slippage tolerance percentage
   * @param {Map} [params._nonceTracker] - Internal: nonce tracker for batched swaps
   * @returns {Promise<Object>} Swap result with transaction and metadata
   * @private
   */
  async _generateSwapTransaction(params) {
    const {
      tokenIn,
      tokenOut,
      amount,
      isAmountIn,
      signer,
      provider,
      chainId,
      recipient,
      slippageTolerance,
      _nonceTracker
    } = params;

    // Validate required params
    if (!tokenIn || !tokenIn.symbol) {
      throw new Error("tokenIn with symbol is required");
    }
    if (!tokenOut || !tokenOut.symbol) {
      throw new Error("tokenOut with symbol is required");
    }
    if (!amount) {
      throw new Error("amount is required");
    }

    // 1. Get route from adapter using AlphaRouter
    // For native ETH, address is not required - adapter uses Ether.onChain() internally
    const routeResult = await this.getSwapRoute({
      tokenInAddress: tokenIn.address,
      tokenOutAddress: tokenOut.address,
      amount,
      isAmountIn,
      recipient,
      slippageTolerance,
      deadlineMinutes: 30,
      tokenInIsNative: tokenIn.isNative,
      tokenOutIsNative: tokenOut.isNative
    });

    // 2. Branch: native ETH input skips Permit2
    if (tokenIn.isNative) {
      // Native ETH - use route directly, no Permit2 needed
      const swapData = await this.generateAlphaSwapData({
        route: routeResult.route,
        recipient,
        tokenInAddress: undefined,
        amountIn: routeResult.amountIn,
        tokenInIsNative: true
      });

      return {
        transaction: swapData,
        quotedAmountIn: routeResult.amountIn,
        quotedAmountOut: routeResult.amountOut,
        isAmountIn
      };
    }

    // ERC20 flow - requires Permit2 signature

    // 3. Get/track Permit2 nonce (Uniswap-specific detail)
    const addresses = getPlatformAddresses(chainId, 'uniswapV3');
    let nonce;

    if (_nonceTracker?.has(tokenIn.address)) {
      // Use tracked nonce for batched swaps
      nonce = _nonceTracker.get(tokenIn.address);
    } else {
      // Fetch current nonce from Permit2 contract
      nonce = await getPermit2Nonce(
        provider,
        recipient,
        tokenIn.address,
        addresses.universalRouterAddress
      );
    }

    // Update tracker for next swap with same token
    _nonceTracker?.set(tokenIn.address, nonce + 1);

    // 4. Generate Permit2 signature
    const deadline = Math.floor(Date.now() / 1000) + 1800; // 30 minutes
    const { signature } = await generatePermit2Signature(
      signer,
      chainId,
      tokenIn.address,
      routeResult.amountIn,
      addresses.universalRouterAddress,
      nonce,
      deadline
    );

    // 5. Generate wrapped swap calldata via adapter
    const swapData = await this.generateAlphaSwapData({
      route: routeResult.route,
      recipient,
      tokenInAddress: tokenIn.address,
      amountIn: routeResult.amountIn,
      permit2Signature: signature,
      permit2Nonce: nonce,
      permit2Deadline: deadline
    });

    return {
      transaction: swapData,
      quotedAmountIn: routeResult.amountIn,
      quotedAmountOut: routeResult.amountOut,
      isAmountIn
    };
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

      // =====================================================================
      // Apply Slippage BEFORE Position Calculation (same approach as V4)
      // =====================================================================
      //
      // We calculate position from reduced amounts to get conservative liquidity,
      // then set Desired = full balances (what we're willing to provide) and
      // Min = mintAmounts from conservative calc (floor protection).
      //
      // This gives headroom: if price moves favorably, more can be deposited.
      // The Min protects against getting too little liquidity.

      // Store input amounts as balances (these become our Desired caps)
      const balance0 = BigInt(token0Amount);
      const balance1 = BigInt(token1Amount);

      // Apply slippage to reduce amounts for position calculation
      // e.g., 5% slippage → use 95% of balance for position calculation
      const slippageMultiplier = BigInt(Math.floor((100 - slippageTolerance) * 100));
      const slippageDivisor = BigInt(10000);

      const forPosition0 = (balance0 * slippageMultiplier / slippageDivisor).toString();
      const forPosition1 = (balance1 * slippageMultiplier / slippageDivisor).toString();

      // Calculate position from reduced amounts to get conservative mintAmounts
      const quote = await this.getAddLiquidityQuote({
        position,
        token0Amount: forPosition0,
        token1Amount: forPosition1,
        provider,
        poolData,
        token0Data,
        token1Data
      });

      // Extract the calculated position, metadata, and token swap info
      const { position: newPosition, tokensSwapped } = quote;

      // Calldata expects amounts in SORTED token order (pool's token0/token1)
      // If tokensSwapped, caller's token0 is pool's token1 and vice versa
      const amount0Desired = tokensSwapped ? balance1 : balance0;
      const amount1Desired = tokensSwapped ? balance0 : balance1;

      // Use mintAmounts from conservative position as Min (floor protection)
      // mintAmounts are already in sorted order from SDK
      const amount0Min = newPosition.mintAmounts.amount0;
      const amount1Min = newPosition.mintAmounts.amount1;



      // Encode the mint function directly using the position manager interface
      const calldata = this.positionManagerInterface.encodeFunctionData('mint', [{
        token0: newPosition.pool.token0.address,
        token1: newPosition.pool.token1.address,
        fee: newPosition.pool.fee,
        tickLower: newPosition.tickLower,
        tickUpper: newPosition.tickUpper,
        amount0Desired: amount0Desired.toString(),
        amount1Desired: amount1Desired.toString(),
        amount0Min: amount0Min.toString(),
        amount1Min: amount1Min.toString(),
        recipient: walletAddress,
        deadline: this._createDeadline(deadlineMinutes)
      }]);

      // V3 uses WETH, not native ETH, so value is always 0
      const value = '0x00';

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
