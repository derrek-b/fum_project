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
import { getBlockExplorerService } from "../services/blockExplorer.js";
import { fetchPoolIncentives, fetchClaimData } from "../services/merkl.js";
import { getPlatformTickBounds } from "../helpers/platformHelpers.js";
import { getPlatformAddresses, getChainConfig, getChainRpcUrls, isLocalChain } from "../helpers/chainHelpers.js";
import { getTokenByAddress, getTokenBySymbol, getWrappedNativeAddress, getWrappedNativeSymbol, isNativeToken, isWrappedNativeToken } from "../helpers/tokenHelpers.js";
import { discoverV4Pools, getV4PositionsByOwner } from "../services/theGraph.js";
import { PERMIT2_ADDRESS, wrapWithPermit2, getPermit2Nonce, generatePermit2Signature } from "../helpers/Permit2Helper.js";
import { Token, Percent, CurrencyAmount, TradeType, Ether } from '@uniswap/sdk-core';
import { AlphaRouter, SwapType, StaticV3SubgraphProvider, UniswapMulticallProvider, V3PoolProvider, StaticGasPriceProvider } from '@uniswap/smart-order-router';
import { Protocol } from '@uniswap/router-sdk';
import { UniversalRouterVersion } from '@uniswap/universal-router-sdk';
import { SqrtPriceMath, TickMath, tickToPrice } from '@uniswap/v3-sdk';
import { Pool as V4Pool, Position as V4Position, V4PositionManager, V4PositionPlanner } from '@uniswap/v4-sdk';
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
   */
  constructor(chainId) {
    super(chainId, "uniswapV4", "Uniswap V4");

    // Cache platform addresses (getPlatformAddresses throws if not configured)
    this.addresses = { ...getPlatformAddresses(chainId, "uniswapV4") };

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

    // AlphaRouter requires real chain infrastructure (multicall contracts, subgraphs)
    // For test chain (1337), use the local fork provider with on-chain-only pool discovery
    // (StaticV3SubgraphProvider) so quotes reflect the fork's pool state, not mainnet.
    // For real chains, use a dedicated RPC provider with default subgraph-based discovery.
    // AlphaRouter requires real chain infrastructure (multicall contracts, subgraphs)
    // For test chain (1337), use the local fork provider with on-chain-only pool discovery
    // (StaticV3SubgraphProvider) so quotes reflect the fork's pool state, not mainnet.
    // For real chains, use a dedicated RPC provider with default subgraph-based discovery.
    this.alphaRouterChainId = chainId === 1337 ? 42161 : chainId;

    if (chainId === 1337) {
      const localRpcUrl = getChainRpcUrls(chainId)[0]; // http://localhost:8545
      const localProvider = new ethers.providers.JsonRpcProvider(localRpcUrl);
      const multicallProvider = new UniswapMulticallProvider(this.alphaRouterChainId, localProvider);
      const v3PoolProvider = new V3PoolProvider(this.alphaRouterChainId, multicallProvider);
      // Static gas price avoids calling Arbitrum's ArbGasInfo precompile (0x6C)
      // which doesn't exist on the Hardhat fork
      const gasPriceProvider = new StaticGasPriceProvider(ethers.BigNumber.from(100000000)); // 0.1 gwei
      // Stub arbitrumGasDataProvider to avoid ArbGasInfo precompile calls.
      // Values must be non-zero — AlphaRouter's gas model divides by perArbGasTotal.
      const arbitrumGasDataProvider = {
        getGasData: async () => ({
          perL2TxFee: ethers.BigNumber.from(1),
          perL1CalldataFee: ethers.BigNumber.from(1),
          perArbGasTotal: ethers.BigNumber.from(1),
        })
      };
      this.alphaRouter = new AlphaRouter({
        chainId: this.alphaRouterChainId,
        provider: localProvider,
        multicall2Provider: multicallProvider,
        v3SubgraphProvider: new StaticV3SubgraphProvider(this.alphaRouterChainId, v3PoolProvider),
        v3PoolProvider,
        gasPriceProvider,
        arbitrumGasDataProvider,
      });
    } else {
      const rpcUrls = getChainRpcUrls(this.alphaRouterChainId);
      const alphaRouterProvider = new ethers.providers.JsonRpcProvider(rpcUrls[0]);
      this.alphaRouter = new AlphaRouter({ chainId: this.alphaRouterChainId, provider: alphaRouterProvider });
    }

    // On local fork, constrain route exploration to avoid 60-370s EXACT_OUTPUT calls.
    // Default Arbitrum config explores many splits/pools — unnecessary for test pairs.
    this.routingConfig = chainId === 1337 ? {
      protocols: [Protocol.V3, Protocol.V4],
      maxSplits: 1,
      distributionPercent: 100,
      v3PoolSelection: {
        topN: 1,
        topNDirectSwaps: 1,
        topNTokenInOut: 1,
        topNSecondHop: 0,
        topNWithEachBaseToken: 1,
        topNWithBaseToken: 1,
      },
    } : undefined;

    // V4 supports native ETH pools (currency0 = AddressZero)
    this.supportsNativePools = true;
  }

  // ===========================================================================
  // HELPER METHODS
  // ===========================================================================

  /**
   * Discover V4 position tokenIds owned by an address by scanning Transfer events.
   * Used on local Hardhat chains where The Graph subgraph is unavailable.
   *
   * Scans Transfer events on the PositionManager contract where `to` matches
   * the target address, then verifies current ownership via ownerOf().
   *
   * @param {string} address - Owner address to discover positions for
   * @param {ethers.Provider} provider - Ethers provider
   * @returns {Promise<string[]>} Array of tokenId strings currently owned by the address
   * @private
   */
  async _discoverTokenIdsByTransferEvents(address, provider) {
    const transferTopic = ethers.utils.id('Transfer(address,address,uint256)');
    const addressTopic = ethers.utils.hexZeroPad(address.toLowerCase(), 32);

    // Get the fork block number — local transactions only exist after this point.
    // Scanning from block 0 would proxy the request to the upstream RPC (e.g. Alchemy)
    // which rejects the massive block range.
    const metadata = await provider.send('hardhat_metadata', []);
    const forkBlock = metadata.forkedNetwork.forkBlockNumber;

    // Get all Transfer events TO this address (mints + transfers in)
    const incomingLogs = await provider.getLogs({
      address: this.addresses.positionManagerAddress,
      topics: [transferTopic, null, addressTopic],
      fromBlock: forkBlock,
      toBlock: 'latest'
    });

    // Collect candidate tokenIds (deduplicated)
    const candidateTokenIds = new Set();
    for (const log of incomingLogs) {
      const tokenId = ethers.BigNumber.from(log.topics[3]).toString();
      candidateTokenIds.add(tokenId);
    }

    if (candidateTokenIds.size === 0) {
      return [];
    }

    // Verify current ownership on-chain via ownerOf()
    const positionManagerContract = new ethers.Contract(
      this.addresses.positionManagerAddress,
      this.positionManagerABI,
      provider
    );

    const ownedTokenIds = [];
    const normalizedAddress = ethers.utils.getAddress(address);

    for (const tokenId of candidateTokenIds) {
      try {
        const owner = await positionManagerContract.ownerOf(tokenId);
        if (ethers.utils.getAddress(owner) === normalizedAddress) {
          ownedTokenIds.push(tokenId);
        }
      } catch {
        // ownerOf reverts for burned tokens (ERC721 spec) — skip
      }
    }

    return ownedTokenIds;
  }

  /**
   * Create SDK Token instance from address using cached config
   * @param {string} tokenAddress - Token address
   * @returns {Token} SDK Token instance
   * @private
   */
  _createTokenInstance(tokenAddress) {
    // getTokenByAddress throws if token not found — no guard needed
    const tokenConfig = getTokenByAddress(tokenAddress, this.chainId);
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
   * Get the topic hash for Uniswap V2 Swap events
   * @returns {string} Keccak256 topic hash
   * @private
   */
  _getSwapTopicV2() {
    return ethers.utils.id('Swap(address,uint256,uint256,uint256,uint256,address)');
  }

  /**
   * Get the topic hash for Uniswap V3 Swap events
   * @returns {string} Keccak256 topic hash
   * @private
   */
  _getSwapTopicV3() {
    return ethers.utils.id('Swap(address,address,int256,int256,uint160,uint128,int24)');
  }

  /**
   * Parse a Uniswap V2 Swap event log
   * @param {Object} log - Raw log with data containing [uint256, uint256, uint256, uint256]
   * @returns {Object} Parsed amounts { amount0In, amount1In, amount0Out, amount1Out }
   * @private
   */
  _parseV2SwapEvent(log) {
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
   * Parse a Uniswap V3 Swap event log
   * @param {Object} log - Raw log with data containing [int256, int256, uint160, uint128, int24]
   * @returns {Object} Parsed amounts { amount0, amount1 } (signed)
   * @private
   */
  _parseV3SwapEvent(log) {
    const decoded = ethers.utils.defaultAbiCoder.decode(
      ['int256', 'int256', 'uint160', 'uint128', 'int24'],
      log.data
    );
    return {
      amount0: decoded[0],
      amount1: decoded[1]
    };
  }

  /**
   * Extract amountIn and amountOut from a parsed swap event, regardless of protocol version.
   *
   * - V2: unsigned amounts — sum amount0In+amount1In (only one non-zero), same for out
   * - V3/V4: signed amounts — positive = pool received (user's input), negative = pool sent (user's output)
   *
   * @param {string} protocol - 'V2', 'V3', or 'V4'
   * @param {Object} parsed - Protocol-specific parsed event data
   * @returns {{ amountIn: bigint, amountOut: bigint }}
   * @private
   */
  _extractSwapAmounts(protocol, parsed) {
    if (protocol === 'V2') {
      return {
        amountIn: BigInt(parsed.amount0In) + BigInt(parsed.amount1In),
        amountOut: BigInt(parsed.amount0Out) + BigInt(parsed.amount1Out)
      };
    }
    const a0 = BigInt(parsed.amount0.toString());
    const a1 = BigInt(parsed.amount1.toString());
    if (protocol === 'V4') {
      // V4: positive = user received (output), negative = user sent (input)
      return {
        amountIn: a0 < 0n ? -a0 : -a1,
        amountOut: a0 > 0n ? a0 : a1
      };
    }
    // V3: positive = pool received (user input), negative = pool sent (user output)
    return {
      amountIn: a0 > 0n ? a0 : a1,
      amountOut: a0 < 0n ? -a0 : -a1
    };
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
   * Evaluate price movement between current swap state and a baseline tick
   *
   * V4 note: Uses same tick-based math as V3 since both are concentrated liquidity.
   *
   * @param {Object} swapData - Parsed swap event data from parseSwapEvent()
   * @param {number} swapData.tick - Current tick from swap event
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
   * @throws {Error} If swapData or baseline is invalid
   */
  evaluatePriceMovement(swapData, baseline, token0Data, token1Data) {
    // Validate swapData
    if (!swapData) {
      throw new Error('swapData parameter is required');
    }

    if (typeof swapData.tick !== 'number') {
      throw new Error('swapData must have tick property as a number');
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

    const currentTick = swapData.tick;

    // Convert ticks to prices using the SDK
    const baselinePrice = this._tickToPrice(baseline, token0Data, token1Data);
    const currentPrice = this._tickToPrice(currentTick, token0Data, token1Data);

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

  // ===========================================================================
  // POSITION MANAGEMENT METHODS
  // ===========================================================================

  /**
   * Resolve token symbol from currency address
   *
   * Handles native ETH (AddressZero) and falls back to UNKNOWN for unrecognized tokens.
   *
   * @param {string} currencyAddress - Token/currency address
   * @returns {string} Token symbol
   * @private
   */
  _resolveTokenSymbol(currencyAddress) {
    if (currencyAddress === ethers.constants.AddressZero) {
      return 'ETH';
    }
    try {
      const token = getTokenByAddress(currencyAddress, this.chainId);
      return token?.symbol || 'UNKNOWN';
    } catch {
      return 'UNKNOWN';
    }
  }

  /**
   * Get positions formatted for VaultDataService
   *
   * V4 difference: Positions are still NFTs but managed by V4 PositionManager.
   * Position data structure includes PoolKey instead of just pool address.
   * Uses StateView for position liquidity and fee data.
   *
   * Note: V4 PositionManager doesn't implement ERC721Enumerable, so position
   * enumeration requires The Graph API. This differs from V3 which uses on-chain
   * tokenOfOwnerByIndex.
   *
   * @param {string} address - Vault address
   * @param {Object} provider - Ethers provider instance
   * @returns {Promise<{positions: Object, poolData: Object}>} Normalized position data
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
      // Get contract instances
      const positionManagerContract = new ethers.Contract(
        this.addresses.positionManagerAddress,
        this.positionManagerABI,
        provider
      );
      const stateViewContract = new ethers.Contract(
        this.addresses.stateViewAddress,
        this.stateViewABI,
        provider
      );

      // Discover position tokenIds
      // V4 PositionManager doesn't implement ERC721Enumerable (no tokenOfOwnerByIndex)
      let tokenIds;
      if (isLocalChain(this.chainId)) {
        // Local Hardhat forks aren't indexed by The Graph — scan Transfer events instead
        tokenIds = await this._discoverTokenIdsByTransferEvents(address, provider);
      } else {
        // Production chains: use The Graph subgraph
        tokenIds = await getV4PositionsByOwner(address, this.chainId);
      }

      if (tokenIds.length === 0) {
        return { positions: {}, poolData: {} };
      }

      const positions = {};
      const poolDataMap = {};
      const processingErrors = [];

      // Process each position
      for (const tokenId of tokenIds) {
        try {
          // Get pool key and packed position info
          const [poolKey, packedInfo] = await positionManagerContract.getPoolAndPositionInfo(tokenId);

          // Decode tick bounds from packed info
          const { tickLower, tickUpper } = this._decodePositionInfo(packedInfo);

          // Compute poolId
          const normalizedPoolKey = {
            currency0: poolKey.currency0,
            currency1: poolKey.currency1,
            fee: Number(poolKey.fee),
            tickSpacing: Number(poolKey.tickSpacing),
            hooks: poolKey.hooks
          };
          const poolId = this._computePoolId(normalizedPoolKey);

          // Get position liquidity and fee data from StateView
          const salt = ethers.utils.hexZeroPad(ethers.BigNumber.from(tokenId).toHexString(), 32);
          const positionInfo = await stateViewContract['getPositionInfo(bytes32,address,int24,int24,bytes32)'](
            poolId,
            this.addresses.positionManagerAddress,
            tickLower,
            tickUpper,
            salt
          );

          const liquidity = positionInfo[0];
          const feeGrowthInside0LastX128 = positionInfo[1];
          const feeGrowthInside1LastX128 = positionInfo[2];

          // Skip positions with zero liquidity (closed positions)
          if (BigInt(liquidity.toString()) === 0n) {
            continue;
          }

          // Build pool metadata — always build, caller handles caching
          poolDataMap[poolId] = {
            token0Symbol: this._resolveTokenSymbol(normalizedPoolKey.currency0),
            token1Symbol: this._resolveTokenSymbol(normalizedPoolKey.currency1),
            fee: normalizedPoolKey.fee,
            tickSpacing: normalizedPoolKey.tickSpacing,
            hooks: normalizedPoolKey.hooks,
            platform: 'uniswapV4',
            poolKey: normalizedPoolKey
          };

          // Assemble position data
          positions[tokenId] = {
            id: tokenId,
            pool: poolId,
            tickLower,
            tickUpper,
            liquidity: liquidity.toString(),
            feeGrowthInside0LastX128: feeGrowthInside0LastX128.toString(),
            feeGrowthInside1LastX128: feeGrowthInside1LastX128.toString(),
            tokensOwed0: "0", // V4 doesn't track these in the same struct
            tokensOwed1: "0",
            lastUpdated: Date.now()
          };

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
      // Re-throw validation errors as-is
      if (error.message.includes('Address parameter') ||
          error.message.includes('Invalid address') ||
          error.message.includes('Valid provider')) {
        throw error;
      }
      throw new Error(`Failed to fetch V4 positions for VDS: ${error.message}`);
    }
  }

  /**
   * Get positions formatted for frontend display
   *
   * Returns pre-computed, display-ready position data with a universal shape
   * across all platforms. The adapter computes all display values internally
   * (prices, amounts, fees, range status) so the frontend never interprets
   * platform-specific pool state.
   *
   * V4 differences from V3:
   * - Pool identified by poolId (bytes32 hash of PoolKey), not contract address
   * - Position discovery via Transfer events (local) or The Graph (production)
   * - Fee calculation via StateView (async), not manual tick math
   * - Native ETH support (currency0 = AddressZero)
   * - Price computed from tick via _tickToPrice (no calculatePriceFromSqrtPrice)
   *
   * @param {string} ownerAddress - Vault or wallet address that owns positions
   * @param {Object} provider - Ethers provider instance
   * @returns {Promise<{positions: Object}>} Display-ready position data keyed by position ID
   *
   * Position shape per entry:
   * @returns {string}  positions[id].id - Position identifier
   * @returns {string}  positions[id].platform - 'uniswapV4'
   * @returns {string}  positions[id].platformName - 'Uniswap V4'
   * @returns {string}  positions[id].tokenPair - Token pair string (e.g. 'ETH/USDC')
   * @returns {string}  positions[id].pool - Pool identifier (poolId bytes32)
   * @returns {boolean} positions[id].inRange - Whether position is currently in range
   * @returns {number}  positions[id].currentPrice - Current pool price (token0/token1)
   * @returns {number}  positions[id].priceLower - Lower bound price
   * @returns {number}  positions[id].priceUpper - Upper bound price
   * @returns {number}  positions[id].token0Amount - Decimal-adjusted token0 amount
   * @returns {number}  positions[id].token1Amount - Decimal-adjusted token1 amount
   * @returns {number}  positions[id].uncollectedFees0 - Decimal-adjusted uncollected token0 fees
   * @returns {number}  positions[id].uncollectedFees1 - Decimal-adjusted uncollected token1 fees
   * @returns {number}  positions[id].fee - Fee as percentage (e.g. 0.05 for 0.05%)
   * @returns {Object}  positions[id].platformData - Opaque platform-specific data for actions
   */
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
      const positionManagerContract = new ethers.Contract(
        this.addresses.positionManagerAddress,
        this.positionManagerABI,
        provider
      );

      const stateViewContract = new ethers.Contract(
        this.addresses.stateViewAddress,
        this.stateViewABI,
        provider
      );

      // Discover position token IDs
      let tokenIds;
      if (isLocalChain(this.chainId)) {
        tokenIds = await this._discoverTokenIdsByTransferEvents(ownerAddress, provider);
      } else {
        tokenIds = await getV4PositionsByOwner(ownerAddress, this.chainId);
      }

      if (tokenIds.length === 0) {
        return { positions: {} };
      }

      // Fetch raw position data for all token IDs
      const rawPositions = [];
      const processingErrors = [];

      for (const tokenId of tokenIds) {
        try {
          const [poolKey, packedInfo] = await positionManagerContract.getPoolAndPositionInfo(tokenId);
          const { tickLower, tickUpper } = this._decodePositionInfo(packedInfo);

          const normalizedPoolKey = {
            currency0: poolKey.currency0,
            currency1: poolKey.currency1,
            fee: Number(poolKey.fee),
            tickSpacing: Number(poolKey.tickSpacing),
            hooks: poolKey.hooks
          };
          const poolId = this._computePoolId(normalizedPoolKey);

          // Get position liquidity and fee data from StateView
          const salt = ethers.utils.hexZeroPad(ethers.BigNumber.from(tokenId).toHexString(), 32);
          const positionInfo = await stateViewContract['getPositionInfo(bytes32,address,int24,int24,bytes32)'](
            poolId,
            this.addresses.positionManagerAddress,
            tickLower,
            tickUpper,
            salt
          );

          const liquidity = positionInfo[0];
          const feeGrowthInside0LastX128 = positionInfo[1];
          const feeGrowthInside1LastX128 = positionInfo[2];

          // Skip zero-liquidity positions
          if (BigInt(liquidity.toString()) === 0n) {
            continue;
          }

          rawPositions.push({
            tokenId,
            tickLower,
            tickUpper,
            liquidity,
            feeGrowthInside0LastX128,
            feeGrowthInside1LastX128,
            poolKey: normalizedPoolKey,
            poolId
          });
        } catch (error) {
          processingErrors.push(`Position ${tokenId}: ${error.message}`);
        }
      }

      if (processingErrors.length > 0) {
        throw new Error(`Failed to process ${processingErrors.length} position(s): ${processingErrors.join('; ')}`);
      }

      if (rawPositions.length === 0) {
        return { positions: {} };
      }

      // Group positions by poolId to batch pool data fetches
      const poolGroups = new Map();
      for (const pos of rawPositions) {
        if (!poolGroups.has(pos.poolId)) {
          poolGroups.set(pos.poolId, { poolKey: pos.poolKey, positions: [] });
        }
        poolGroups.get(pos.poolId).positions.push(pos);
      }

      // Fetch pool data once per pool and resolve token metadata
      const poolDataMap = new Map();
      await Promise.all(
        Array.from(poolGroups.entries()).map(async ([poolId, group]) => {
          const poolData = await this.getPoolData(poolId, provider);

          // Resolve token metadata — handle native ETH (AddressZero)
          const token0Data = this._resolveTokenDataForDisplay(group.poolKey.currency0);
          const token1Data = this._resolveTokenDataForDisplay(group.poolKey.currency1);

          poolDataMap.set(poolId, { poolData, token0Data, token1Data });
        })
      );

      // Build display positions
      const positions = {};

      for (const [poolId, group] of poolGroups.entries()) {
        const { poolData, token0Data, token1Data } = poolDataMap.get(poolId);

        for (const pos of group.positions) {
          // Range check
          const inRange = poolData.tick >= pos.tickLower && poolData.tick <= pos.tickUpper;

          // Prices from ticks
          const currentPriceObj = this._tickToPrice(poolData.tick, token0Data, token1Data);
          const currentPrice = parseFloat(currentPriceObj.toSignificant(8));

          const priceLowerObj = this._tickToPrice(pos.tickLower, token0Data, token1Data);
          const priceUpperObj = this._tickToPrice(pos.tickUpper, token0Data, token1Data);
          const priceLower = parseFloat(priceLowerObj.toSignificant(8));
          const priceUpper = parseFloat(priceUpperObj.toSignificant(8));

          // Token amounts
          const positionForCalc = {
            liquidity: pos.liquidity.toString(),
            tickLower: pos.tickLower,
            tickUpper: pos.tickUpper,
          };
          const [token0Raw, token1Raw] = await this.calculateTokenAmounts(
            positionForCalc, poolData, token0Data, token1Data
          );
          const token0Amount = Number(token0Raw) / Math.pow(10, token0Data.decimals);
          const token1Amount = Number(token1Raw) / Math.pow(10, token1Data.decimals);

          // Uncollected fees
          const { fees0, fees1 } = await this._calculateUncollectedFees(
            pos.tokenId, poolId, pos.tickLower, pos.tickUpper, provider
          );
          const uncollectedFees0 = Number(fees0) / Math.pow(10, token0Data.decimals);
          const uncollectedFees1 = Number(fees1) / Math.pow(10, token1Data.decimals);

          // Fee percentage
          const fee = poolData.fee / 10000;

          positions[String(pos.tokenId)] = {
            id: String(pos.tokenId),
            platform: this.platformId,
            platformName: this.platformName,
            tokenPair: `${token0Data.symbol}/${token1Data.symbol}`,
            pool: poolId,
            inRange,
            currentPrice,
            priceLower,
            priceUpper,
            token0Amount,
            token1Amount,
            uncollectedFees0,
            uncollectedFees1,
            fee,
            platformData: {
              tickLower: pos.tickLower,
              tickUpper: pos.tickUpper,
              poolKey: pos.poolKey,
              poolId,
              feeGrowthInside0LastX128: pos.feeGrowthInside0LastX128.toString(),
              feeGrowthInside1LastX128: pos.feeGrowthInside1LastX128.toString(),
            }
          };
        }
      }

      return { positions };

    } catch (error) {
      if (error.message.includes('Address parameter') ||
          error.message.includes('Invalid address') ||
          error.message.includes('Valid provider')) {
        throw error;
      }
      throw new Error(`Failed to fetch positions for display: ${error.message}`);
    }
  }

  /**
   * Resolve token metadata for display — handles native ETH (AddressZero)
   * @param {string} currencyAddress - Token address or AddressZero for native ETH
   * @returns {{address: string, symbol: string, decimals: number}} Flat token data
   * @private
   */
  _resolveTokenDataForDisplay(currencyAddress) {
    if (currencyAddress === ethers.constants.AddressZero) {
      return { address: ethers.constants.AddressZero, symbol: 'ETH', decimals: 18 };
    }
    const config = getTokenByAddress(currencyAddress, this.chainId);
    return { address: currencyAddress, symbol: config.symbol, decimals: config.decimals };
  }

  /**
   * Refresh display data for a single position
   *
   * Returns the same per-position shape as getPositionsForDisplay but for one position.
   * Used by the frontend to refresh display data while a modal is open without
   * re-fetching all positions for the owner.
   *
   * @param {string} positionId - Position NFT token ID (numeric string)
   * @param {Object} provider - Ethers provider instance
   * @returns {Promise<Object>} Single position in getPositionsForDisplay shape
   * @throws {Error} If positionId is invalid, position not found, or has zero liquidity
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
      const positionManagerContract = new ethers.Contract(
        this.addresses.positionManagerAddress,
        this.positionManagerABI,
        provider
      );
      const stateViewContract = new ethers.Contract(
        this.addresses.stateViewAddress,
        this.stateViewABI,
        provider
      );

      // Fetch position's pool key and tick bounds
      const [poolKey, packedInfo] = await positionManagerContract.getPoolAndPositionInfo(positionId);
      const { tickLower, tickUpper } = this._decodePositionInfo(packedInfo);

      const normalizedPoolKey = {
        currency0: poolKey.currency0,
        currency1: poolKey.currency1,
        fee: Number(poolKey.fee),
        tickSpacing: Number(poolKey.tickSpacing),
        hooks: poolKey.hooks
      };
      const poolId = this._computePoolId(normalizedPoolKey);

      // Fetch position liquidity and fee growth from StateView
      const salt = ethers.utils.hexZeroPad(ethers.BigNumber.from(positionId).toHexString(), 32);
      const positionInfo = await stateViewContract['getPositionInfo(bytes32,address,int24,int24,bytes32)'](
        poolId, this.addresses.positionManagerAddress, tickLower, tickUpper, salt
      );
      const liquidity = positionInfo[0];
      const feeGrowthInside0LastX128 = positionInfo[1];
      const feeGrowthInside1LastX128 = positionInfo[2];

      // Reject zero-liquidity positions
      if (BigInt(liquidity.toString()) === 0n) {
        throw new Error(`Position ${positionId} has zero liquidity`);
      }

      // Fetch pool data
      const poolData = await this.getPoolData(poolId, provider);

      // Resolve token metadata
      const token0Data = this._resolveTokenDataForDisplay(normalizedPoolKey.currency0);
      const token1Data = this._resolveTokenDataForDisplay(normalizedPoolKey.currency1);

      // Range check
      const inRange = poolData.tick >= tickLower && poolData.tick <= tickUpper;

      // Prices
      const currentPriceObj = this._tickToPrice(poolData.tick, token0Data, token1Data);
      const currentPrice = parseFloat(currentPriceObj.toSignificant(8));
      const priceLowerObj = this._tickToPrice(tickLower, token0Data, token1Data);
      const priceUpperObj = this._tickToPrice(tickUpper, token0Data, token1Data);
      const priceLower = parseFloat(priceLowerObj.toSignificant(8));
      const priceUpper = parseFloat(priceUpperObj.toSignificant(8));

      // Token amounts
      const positionForCalc = { liquidity: liquidity.toString(), tickLower, tickUpper };
      const [token0Raw, token1Raw] = await this.calculateTokenAmounts(positionForCalc, poolData, token0Data, token1Data);
      const token0Amount = Number(token0Raw) / Math.pow(10, token0Data.decimals);
      const token1Amount = Number(token1Raw) / Math.pow(10, token1Data.decimals);

      // Uncollected fees
      const { fees0, fees1 } = await this._calculateUncollectedFees(
        positionId, poolId, tickLower, tickUpper, provider
      );
      const uncollectedFees0 = Number(fees0) / Math.pow(10, token0Data.decimals);
      const uncollectedFees1 = Number(fees1) / Math.pow(10, token1Data.decimals);

      // Fee percentage
      const fee = poolData.fee / 10000;

      return {
        id: String(positionId),
        platform: this.platformId,
        platformName: this.platformName,
        tokenPair: `${token0Data.symbol}/${token1Data.symbol}`,
        pool: poolId,
        inRange, currentPrice, priceLower, priceUpper,
        token0Amount, token1Amount, uncollectedFees0, uncollectedFees1, fee,
        platformData: {
          tickLower, tickUpper,
          poolKey: normalizedPoolKey,
          poolId,
          feeGrowthInside0LastX128: feeGrowthInside0LastX128.toString(),
          feeGrowthInside1LastX128: feeGrowthInside1LastX128.toString(),
        }
      };
    } catch (error) {
      if (error.message.includes('Position ID') ||
          error.message.includes('Valid provider') ||
          error.message.includes('zero liquidity')) {
        throw error;
      }
      throw new Error(`Failed to refresh position ${positionId} for display: ${error.message}`);
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
      const positionManagerContract = new ethers.Contract(
        this.addresses.positionManagerAddress,
        this.positionManagerABI,
        provider
      );

      const stateViewContract = new ethers.Contract(
        this.addresses.stateViewAddress,
        this.stateViewABI,
        provider
      );

      // Step 1: Get pool key and packed position info
      const [poolKey, packedInfo] = await positionManagerContract.getPoolAndPositionInfo(tokenId);

      // Check if position exists - V4 returns zeroed data for burned/non-existent positions
      if (poolKey.currency0 === ethers.constants.AddressZero &&
          poolKey.currency1 === ethers.constants.AddressZero) {
        throw new Error(`Position ${tokenId} not found or has been burned`);
      }

      // Step 2: Decode tick bounds from packed info
      const { tickLower, tickUpper } = this._decodePositionInfo(packedInfo);

      // Step 3: Normalize pool key and compute pool ID
      const normalizedPoolKey = {
        currency0: poolKey.currency0,
        currency1: poolKey.currency1,
        fee: Number(poolKey.fee),
        tickSpacing: Number(poolKey.tickSpacing),
        hooks: poolKey.hooks
      };
      const poolId = this._computePoolId(normalizedPoolKey);

      // Step 4: Get position liquidity and fee data from StateView
      const salt = ethers.utils.hexZeroPad(ethers.BigNumber.from(tokenId).toHexString(), 32);
      const positionInfo = await stateViewContract['getPositionInfo(bytes32,address,int24,int24,bytes32)'](
        poolId,
        this.addresses.positionManagerAddress,
        tickLower,
        tickUpper,
        salt
      );

      const liquidity = positionInfo[0];

      // Zero-liquidity positions are closed — reject like burned/non-existent
      if (BigInt(liquidity.toString()) === 0n) {
        throw new Error(`Position ${tokenId} has zero liquidity`);
      }

      const feeGrowthInside0LastX128 = positionInfo[1];
      const feeGrowthInside1LastX128 = positionInfo[2];

      // Step 5: Resolve token symbols
      const token0Symbol = this._resolveTokenSymbol(normalizedPoolKey.currency0);
      const token1Symbol = this._resolveTokenSymbol(normalizedPoolKey.currency1);

      return {
        position: {
          id: String(tokenId),
          pool: poolId,
          tickLower,
          tickUpper,
          liquidity: liquidity.toString(),
          feeGrowthInside0LastX128: feeGrowthInside0LastX128.toString(),
          feeGrowthInside1LastX128: feeGrowthInside1LastX128.toString(),
          tokensOwed0: "0",  // V4 doesn't track these in position struct
          tokensOwed1: "0",
          lastUpdated: Date.now()
        },
        poolData: {
          [poolId]: {
            token0Symbol,
            token1Symbol,
            fee: normalizedPoolKey.fee,
            tickSpacing: normalizedPoolKey.tickSpacing,
            hooks: normalizedPoolKey.hooks,
            platform: 'uniswapV4',
            poolKey: normalizedPoolKey
          }
        }
      };
    } catch (error) {
      // Re-throw validation errors as-is
      if (error.message.includes('TokenId parameter') ||
          error.message.includes('Valid provider') ||
          error.message.includes('not found or has been burned') ||
          error.message.includes('zero liquidity')) {
        throw error;
      }
      throw new Error(`Failed to fetch V4 position ${tokenId}: ${error.message}`);
    }
  }

  /**
   * Calculate accrued (uncollected) fees for a position in USD
   *
   * V4 difference from V3:
   * - Uses StateView.getFeeGrowthInside() instead of manual tick math
   * - Position lookup via (poolId, owner, tickLower, tickUpper, salt)
   * - salt = bytes32(tokenId), owner = PositionManager address
   *
   * @param {Object} position - Position object
   * @param {string|number} position.id - NFT token ID (required)
   * @param {number} [position.token0Decimals=18] - Token0 decimals
   * @param {number} [position.token1Decimals=6] - Token1 decimals
   * @param {Object} tokenPrices - { token0: number, token1: number } USD prices
   * @param {Object} provider - Ethers provider
   * @returns {Promise<Object>} Accrued fees breakdown (V3-compatible format)
   * @returns {number} result.totalUSD - Total fees in USD
   * @returns {number} result.token0Fees - Token0 fees (formatted, not raw)
   * @returns {number} result.token1Fees - Token1 fees (formatted, not raw)
   * @returns {number} result.token0USD - Token0 fees in USD
   * @returns {number} result.token1USD - Token1 fees in USD
   */
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
    if (!provider) {
      throw new Error('provider is required');
    }

    // Get PoolKey and packed position info from tokenId
    const positionManagerContract = new ethers.Contract(
      this.addresses.positionManagerAddress,
      this.positionManagerABI,
      provider
    );

    const [poolKey, packedInfo] = await positionManagerContract.getPoolAndPositionInfo(position.id);

    // Decode tick bounds from packed info
    const { tickLower, tickUpper } = this._decodePositionInfo(packedInfo);

    // Compute poolId from PoolKey
    const poolId = this._computePoolId(poolKey);

    // Calculate uncollected fees
    const { fees0, fees1, liquidity } = await this._calculateUncollectedFees(
      position.id, poolId, tickLower, tickUpper, provider
    );

    // Get token decimals (from position or defaults)
    const token0Decimals = position.token0Decimals ?? 18;
    const token1Decimals = position.token1Decimals ?? 6;

    // Format fees (match V3 adapter format)
    const token0Fees = Number(fees0) / (10 ** token0Decimals);
    const token1Fees = Number(fees1) / (10 ** token1Decimals);

    // Convert to USD
    const token0USD = token0Fees * (tokenPrices.token0 ?? 0);
    const token1USD = token1Fees * (tokenPrices.token1 ?? 0);
    const totalUSD = token0USD + token1USD;

    // Return in V3-compatible format for strategy compatibility
    return {
      totalUSD,
      token0Fees,
      token1Fees,
      token0USD,
      token1USD,
      fees0: fees0.toString(),  // Raw amount for fallback/native ETH handling
      fees1: fees1.toString()   // Raw amount for fallback/native ETH handling
    };
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
      // Extract tick from parsed swap event
      if (!options.swapData || typeof options.swapData.tick !== 'number') {
        throw new Error('options.swapData must have tick property as a number');
      }
      if (!Number.isFinite(options.swapData.tick)) {
        throw new Error('options.swapData.tick must be a finite number');
      }
      currentTick = options.swapData.tick;
    } else {
      // Fetch from blockchain
      if (!position.pool) {
        throw new Error('Position missing pool');
      }
      currentTick = await this._getCurrentTickV4(position.pool, provider);
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
      current: currentTick
    };
  }

  /**
   * Get the current tick for a V4 pool from StateView
   *
   * @param {string} poolId - The pool ID (bytes32)
   * @param {Object} provider - Ethers provider
   * @returns {Promise<number>} Current pool tick
   * @private
   */
  async _getCurrentTickV4(poolId, provider) {
    // Validate poolId
    if (!poolId) {
      throw new Error('poolId parameter is required');
    }
    if (typeof poolId !== 'string' || !/^0x[a-fA-F0-9]{64}$/.test(poolId)) {
      throw new Error(`Invalid poolId format: ${poolId}`);
    }

    // Validate provider
    if (!provider) {
      throw new Error('provider is required');
    }

    try {
      const stateViewContract = new ethers.Contract(
        this.addresses.stateViewAddress,
        this.stateViewABI,
        provider
      );
      const slot0 = await stateViewContract.getSlot0(poolId);
      return Number(slot0.tick);
    } catch (error) {
      throw new Error(`Failed to get current tick for pool ${poolId}: ${error.message}`);
    }
  }

  /**
   * Calculate token amounts for a position based on its liquidity and tick bounds.
   *
   * Uses the same concentrated liquidity math as V3 (SqrtPriceMath from @uniswap/v3-sdk).
   * Calculates how much of each token the position currently holds based on:
   * - The position's liquidity amount
   * - The position's tick range (tickLower, tickUpper)
   * - The current pool price (sqrtPriceX96)
   *
   * @param {Object} position - Position object with liquidity and tick bounds
   * @param {string|number} position.liquidity - Position liquidity as numeric string
   * @param {number} position.tickLower - Lower tick boundary
   * @param {number} position.tickUpper - Upper tick boundary
   * @param {Object} poolData - Pool state data
   * @param {string|number} poolData.sqrtPriceX96 - Current sqrt price in Q64.96 format
   * @param {number} poolData.tick - Current pool tick
   * @param {Object} token0Data - Token0 metadata (address, decimals)
   * @param {Object} token1Data - Token1 metadata (address, decimals)
   * @param {Object} [provider] - Ethers provider (unused by V4, accepted for interface compatibility)
   * @returns {Promise<[BigInt, BigInt]>} [amount0, amount1] as BigInts in wei
   * @throws {Error} If parameters are invalid
   */
  async calculateTokenAmounts(position, poolData, token0Data, token1Data, provider) {
    // === VALIDATION ===

    // Position validation
    if (!position || typeof position !== 'object' || Array.isArray(position)) {
      throw new Error('position is required and must be an object');
    }
    if (position.liquidity === undefined || position.liquidity === null) {
      throw new Error('position.liquidity is required');
    }
    const liquidityStr = String(position.liquidity);
    if (!/^\d+$/.test(liquidityStr)) {
      throw new Error(`position.liquidity must be a non-negative numeric string, got: ${position.liquidity}`);
    }
    if (!Number.isFinite(position.tickLower)) {
      throw new Error('position.tickLower must be a finite number');
    }
    if (!Number.isFinite(position.tickUpper)) {
      throw new Error('position.tickUpper must be a finite number');
    }
    if (position.tickLower >= position.tickUpper) {
      throw new Error(`position.tickLower (${position.tickLower}) must be less than position.tickUpper (${position.tickUpper})`);
    }

    // PoolData validation
    if (!poolData || typeof poolData !== 'object' || Array.isArray(poolData)) {
      throw new Error('poolData is required and must be an object');
    }
    if (poolData.sqrtPriceX96 === undefined || poolData.sqrtPriceX96 === null) {
      throw new Error('poolData.sqrtPriceX96 is required');
    }
    const sqrtPriceStr = String(poolData.sqrtPriceX96);
    if (!/^\d+$/.test(sqrtPriceStr)) {
      throw new Error(`poolData.sqrtPriceX96 must be a non-negative numeric string, got: ${poolData.sqrtPriceX96}`);
    }
    if (!Number.isFinite(poolData.tick)) {
      throw new Error('poolData.tick must be a finite number');
    }

    // Token data validation
    if (!token0Data || typeof token0Data !== 'object') {
      throw new Error('token0Data is required and must be an object');
    }
    if (!token1Data || typeof token1Data !== 'object') {
      throw new Error('token1Data is required and must be an object');
    }

    // === CALCULATION ===

    // Convert to JSBI and delegate to helper
    const liquidity = JSBI.BigInt(liquidityStr);
    const sqrtPriceX96 = JSBI.BigInt(sqrtPriceStr);

    const [amount0, amount1] = this._calculateAmountsFromLiquidity(
      liquidity,
      position.tickLower,
      position.tickUpper,
      sqrtPriceX96
    );

    return [BigInt(amount0.toString()), BigInt(amount1.toString())];
  }

  // ===========================================================================
  // LIQUIDITY TRANSACTION METHODS
  // ===========================================================================

  /**
   * Generate transaction data for claiming fees from a position
   *
   * V4 difference from V3:
   * - Uses DECREASE_LIQUIDITY with amount=0 + TAKE_PAIR pattern
   * - Requires PoolKey (currency0, currency1, fee, tickSpacing, hooks)
   * - Can handle native ETH directly
   *
   * @param {Object} params - Parameters for generating claim fees data
   * @param {Object} params.position - Position object (required)
   * @param {string|number} params.position.id - Position NFT token ID (required)
   * @param {string} params.walletAddress - Recipient address for claimed fees (required)
   * @param {Object} params.provider - Ethers provider (required)
   * @param {Object} [params.poolKey] - Pool key (optional, fetched from tokenId if not provided)
   * @param {string} params.poolKey.currency0 - Token0 address
   * @param {string} params.poolKey.currency1 - Token1 address
   * @param {number} params.poolKey.fee - Pool fee
   * @param {number} params.poolKey.tickSpacing - Pool tick spacing
   * @param {string} params.poolKey.hooks - Hooks contract address
   * @param {Object} [params.poolData] - Pool data (optional, fetched if not provided)
   * @param {number} [params.deadlineMinutes=20] - Transaction deadline in minutes
   * @param {string} [params.hookData='0x'] - Optional hook data
   * @returns {Promise<Object>} Transaction data { to, data, value }
   */
  async generateClaimFeesData(params) {
    const {
      position,
      walletAddress,
      provider,
      poolData: providedPoolData,
      deadlineMinutes = 20,
      hookData = '0x'
    } = params;

    // Validate position
    if (position === null || position === undefined) {
      throw new Error('position is required');
    }
    if (typeof position !== 'object' || Array.isArray(position)) {
      throw new Error('position must be an object');
    }

    // Extract and validate tokenId from position
    const tokenId = position.id;
    if (tokenId === null || tokenId === undefined) {
      throw new Error('position.id is required');
    }

    // Extract and validate tickLower and tickUpper from position
    const tickLower = position.tickLower;
    const tickUpper = position.tickUpper;
    if (tickLower === null || tickLower === undefined) {
      throw new Error('position.tickLower is required');
    }
    if (tickUpper === null || tickUpper === undefined) {
      throw new Error('position.tickUpper is required');
    }

    // Validate walletAddress
    if (!walletAddress) {
      throw new Error('walletAddress is required');
    }
    try {
      ethers.utils.getAddress(walletAddress);
    } catch (error) {
      throw new Error(`Invalid walletAddress: ${walletAddress}`);
    }

    // Validate provider
    if (!provider) {
      throw new Error('provider is required');
    }

    // Validate deadlineMinutes
    if (typeof deadlineMinutes !== 'number' || !Number.isFinite(deadlineMinutes) || deadlineMinutes <= 0) {
      throw new Error('deadlineMinutes must be a positive number');
    }

    // Validate poolData
    if (!providedPoolData || typeof providedPoolData !== 'object') {
      throw new Error('poolData is required');
    }

    // Resolve poolKey: prefer poolData.poolKey, fall back to position.poolKey (from flattened platformData)
    const poolKey = providedPoolData.poolKey || position.poolKey;
    if (!poolKey || typeof poolKey !== 'object') {
      throw new Error('poolKey is required — provide via poolData.poolKey or position.poolKey');
    }

    try {
      // Fetch current pool state (sqrtPriceX96, liquidity, tick change with every swap)
      const poolId = position.pool;
      if (!poolId) {
        throw new Error('position.pool is required to fetch pool state');
      }
      const poolData = await this.getPoolData(poolId, provider);

      // Determine if tokens are native ETH
      const isToken0Native = poolKey.currency0 === ethers.constants.AddressZero;
      const isToken1Native = poolKey.currency1 === ethers.constants.AddressZero;

      // Create SDK currency objects
      const currency0 = isToken0Native
        ? Ether.onChain(this.chainId)
        : new Token(this.chainId, poolKey.currency0, 18); // decimals don't matter for collect

      const currency1 = isToken1Native
        ? Ether.onChain(this.chainId)
        : new Token(this.chainId, poolKey.currency1, 18);

      // Create V4Pool object
      const v4Pool = new V4Pool(
        currency0,
        currency1,
        poolKey.fee,
        poolKey.tickSpacing,
        poolKey.hooks,
        poolData.sqrtPriceX96.toString(),
        poolData.liquidity.toString(),
        poolData.tick
      );

      // Create a minimal V4Position for collectCallParameters
      // The SDK only needs pool.currency0 and pool.currency1 for TAKE_PAIR
      // Use tickLower/tickUpper if we have them, otherwise use aligned fallback values (not used for collect)
      // Fallback ticks must be aligned to tick spacing or SDK will throw
      const alignedCurrentTick = Math.floor(poolData.tick / poolKey.tickSpacing) * poolKey.tickSpacing;
      const v4Position = new V4Position({
        pool: v4Pool,
        tickLower: tickLower ?? alignedCurrentTick - poolKey.tickSpacing,
        tickUpper: tickUpper ?? alignedCurrentTick + poolKey.tickSpacing,
        liquidity: 1 // Not used for collect, just needs to be non-zero for Position construction
      });

      // Calculate deadline
      const deadline = Math.floor(Date.now() / 1000) + (deadlineMinutes * 60);

      // Generate collect calldata using SDK
      const { calldata, value } = V4PositionManager.collectCallParameters(v4Position, {
        tokenId: tokenId.toString(),
        recipient: walletAddress,
        deadline: deadline.toString(),
        hookData: hookData
      });

      return {
        to: this.addresses.positionManagerAddress,
        data: calldata,
        value: value
      };

    } catch (error) {
      // Re-throw validation errors as-is
      if (error.message.includes('is required') ||
          error.message.includes('must be') ||
          error.message.includes('Invalid')) {
        throw error;
      }
      throw new Error(`Failed to generate claim fees data: ${error.message}`);
    }
  }

  /**
   * Generate transaction data for removing liquidity from a position
   *
   * V4 difference from V3:
   * - Uses V4PositionManager.removeCallParameters() from SDK
   * - Requires PoolKey (currency0, currency1, fee, tickSpacing, hooks)
   * - Must fetch actual position liquidity from StateView
   * - Supports burnToken option to burn NFT on 100% removal
   *
   * @param {Object} params - Parameters for removing liquidity
   * @param {Object} params.position - Position object (required)
   * @param {string|number} params.position.id - Position NFT token ID (required)
   * @param {number} params.percentage - Percentage to remove 1-100 (required)
   * @param {string} params.walletAddress - Recipient address (required)
   * @param {Object} params.provider - Ethers provider (required)
   * @param {Object} [params.poolKey] - Pool key (optional, fetched if not provided)
   * @param {Object} [params.poolData] - Pool data (optional, fetched if not provided)
   * @param {number} params.slippageTolerance - Slippage 0-100 (required)
   * @param {number} params.deadlineMinutes - Deadline in minutes (required)
   * @param {string} [params.hookData='0x'] - Optional hook data
   * @param {boolean} [params.burnToken=false] - Burn NFT if removing 100%
   * @returns {Promise<Object>} Transaction data { to, data, value }
   */
  async generateRemoveLiquidityData(params) {
    const {
      position,
      percentage,
      walletAddress,
      provider,
      poolData: providedPoolData,
      slippageTolerance,
      deadlineMinutes,
      hookData = '0x',
      burnToken = false
    } = params;

    // === VALIDATION ===

    // position validation
    if (position === null || position === undefined) {
      throw new Error('position is required');
    }
    if (typeof position !== 'object' || Array.isArray(position)) {
      throw new Error('position must be an object');
    }

    // Extract and validate tokenId from position
    const tokenId = position.id;
    if (tokenId === null || tokenId === undefined) {
      throw new Error('position.id is required');
    }

    // Extract and validate tickLower and tickUpper from position
    const tickLower = position.tickLower;
    const tickUpper = position.tickUpper;
    if (tickLower === null || tickLower === undefined) {
      throw new Error('position.tickLower is required');
    }
    if (tickUpper === null || tickUpper === undefined) {
      throw new Error('position.tickUpper is required');
    }

    // percentage validation (1-100)
    if (typeof percentage !== 'number' || !Number.isFinite(percentage) || percentage < 1 || percentage > 100) {
      throw new Error('percentage must be a number between 1 and 100');
    }

    // walletAddress validation
    if (!walletAddress) {
      throw new Error('walletAddress is required');
    }
    try {
      ethers.utils.getAddress(walletAddress);
    } catch (error) {
      throw new Error(`Invalid walletAddress: ${walletAddress}`);
    }

    // provider validation
    if (!provider) {
      throw new Error('provider is required');
    }

    // slippageTolerance validation (0-100)
    if (typeof slippageTolerance !== 'number' || !Number.isFinite(slippageTolerance) ||
        slippageTolerance < 0 || slippageTolerance > 100) {
      throw new Error('slippageTolerance must be a number between 0 and 100');
    }

    // deadlineMinutes validation
    if (typeof deadlineMinutes !== 'number' || !Number.isFinite(deadlineMinutes) || deadlineMinutes <= 0) {
      throw new Error('deadlineMinutes must be a positive number');
    }

    // Validate poolData
    if (!providedPoolData || typeof providedPoolData !== 'object') {
      throw new Error('poolData is required');
    }

    // Resolve poolKey: prefer poolData.poolKey, fall back to position.poolKey (from flattened platformData)
    const poolKey = providedPoolData.poolKey || position.poolKey;
    if (!poolKey || typeof poolKey !== 'object') {
      throw new Error('poolKey is required — provide via poolData.poolKey or position.poolKey');
    }

    try {
      const poolData = providedPoolData;

      // Get actual position liquidity from StateView
      const poolId = this._computePoolId(poolKey);
      const stateViewContract = new ethers.Contract(
        this.addresses.stateViewAddress,
        this.stateViewABI,
        provider
      );
      const salt = ethers.utils.hexZeroPad(ethers.BigNumber.from(tokenId).toHexString(), 32);

      const positionInfo = await stateViewContract['getPositionInfo(bytes32,address,int24,int24,bytes32)'](
        poolId,
        this.addresses.positionManagerAddress,
        tickLower,
        tickUpper,
        salt
      );
      const positionLiquidity = positionInfo[0]; // First element is liquidity

      // === CREATE SDK OBJECTS ===

      const isToken0Native = poolKey.currency0 === ethers.constants.AddressZero;
      const isToken1Native = poolKey.currency1 === ethers.constants.AddressZero;

      const currency0 = isToken0Native
        ? Ether.onChain(this.chainId)
        : new Token(this.chainId, poolKey.currency0, 18);

      const currency1 = isToken1Native
        ? Ether.onChain(this.chainId)
        : new Token(this.chainId, poolKey.currency1, 18);

      const v4Pool = new V4Pool(
        currency0,
        currency1,
        poolKey.fee,
        poolKey.tickSpacing,
        poolKey.hooks,
        poolData.sqrtPriceX96.toString(),
        poolData.liquidity.toString(),
        poolData.tick
      );

      const v4Position = new V4Position({
        pool: v4Pool,
        tickLower,
        tickUpper,
        liquidity: positionLiquidity.toString()
      });

      // === GENERATE REMOVE CALLDATA ===

      const deadline = Math.floor(Date.now() / 1000) + (deadlineMinutes * 60);
      // slippageTolerance is a percentage (e.g., 5 = 5%), convert to basis points
      const slippagePercent = new Percent(Math.floor(slippageTolerance * 100), 10000);
      const liquidityPercentage = new Percent(percentage, 100);

      const { calldata, value } = V4PositionManager.removeCallParameters(v4Position, {
        tokenId: tokenId.toString(),
        liquidityPercentage,
        slippageTolerance: slippagePercent,
        deadline: deadline.toString(),
        hookData,
        burnToken
      });

      return {
        to: this.addresses.positionManagerAddress,
        data: calldata,
        value
      };

    } catch (error) {
      // Re-throw validation errors as-is
      if (error.message.includes('is required') ||
          error.message.includes('must be') ||
          error.message.includes('Invalid')) {
        throw error;
      }
      throw new Error(`Failed to generate remove liquidity data: ${error.message}`);
    }
  }

  /**
   * Generate transaction data for adding liquidity to an existing position
   *
   * V4 difference: Uses V4PositionManager.addCallParameters() with IncreaseLiquidityOptions
   * (same method as create, but with tokenId instead of recipient).
   *
   * @param {Object} params - Parameters for adding liquidity
   * @param {Object} params.position - Position object with id and tick bounds
   * @param {string} params.position.id - Position NFT token ID (required)
   * @param {number} params.position.tickLower - Lower tick bound
   * @param {number} params.position.tickUpper - Upper tick bound
   * @param {string} params.token0Amount - Amount of token0 to add in wei (required)
   * @param {string} params.token1Amount - Amount of token1 to add in wei (required)
   * @param {Object} params.provider - Ethers provider (required)
   * @param {Object} params.poolData - Pool data with embedded poolKey (required)
   * @param {Object} params.token0Data - Token0 data (for interface consistency with V3)
   * @param {Object} params.token1Data - Token1 data (for interface consistency with V3)
   * @param {number} params.slippageTolerance - Slippage 0-100 (required)
   * @param {number} params.deadlineMinutes - Deadline in minutes (required)
   * @param {string} [params.hookData='0x'] - Optional hook data
   * @returns {Promise<{to: string, data: string, value: string, quote: Object}>} Transaction data
   */
  async generateAddLiquidityData(params) {
    const {
      position,
      token0Amount,
      token1Amount,
      provider,
      poolData: providedPoolData,
      token0Data,
      token1Data,
      slippageTolerance,
      deadlineMinutes,
      hookData = '0x'
    } = params;

    // === VALIDATION ===

    // position validation (V3-compatible interface)
    if (position === null || position === undefined) {
      throw new Error('position is required');
    }
    if (typeof position !== 'object' || Array.isArray(position)) {
      throw new Error('position must be an object');
    }
    if (position.id === null || position.id === undefined) {
      throw new Error('position.id is required');
    }

    // Extract tokenId from position for V4 SDK calls
    const tokenId = position.id;

    // token0Amount validation
    if (token0Amount === null || token0Amount === undefined) {
      throw new Error('token0Amount is required');
    }
    if (typeof token0Amount !== 'string') {
      throw new Error('token0Amount must be a string');
    }

    // token1Amount validation
    if (token1Amount === null || token1Amount === undefined) {
      throw new Error('token1Amount is required');
    }
    if (typeof token1Amount !== 'string') {
      throw new Error('token1Amount must be a string');
    }

    // At least one amount must be > 0
    if (token0Amount === '0' && token1Amount === '0') {
      throw new Error('At least one token amount must be greater than 0');
    }

    // provider validation
    if (!provider) {
      throw new Error('provider is required');
    }

    // slippageTolerance validation (0-100)
    if (typeof slippageTolerance !== 'number' || !Number.isFinite(slippageTolerance) ||
        slippageTolerance < 0 || slippageTolerance > 100) {
      throw new Error('slippageTolerance must be a number between 0 and 100');
    }

    // deadlineMinutes validation
    if (typeof deadlineMinutes !== 'number' || !Number.isFinite(deadlineMinutes) || deadlineMinutes <= 0) {
      throw new Error('deadlineMinutes must be a positive number');
    }

    // Validate poolData and poolData.poolKey
    if (!providedPoolData || typeof providedPoolData !== 'object') {
      throw new Error('poolData is required');
    }
    if (!providedPoolData.poolKey || typeof providedPoolData.poolKey !== 'object') {
      throw new Error('poolData.poolKey is required');
    }

    try {
      // === FETCH POSITION DATA ===

      const poolKey = providedPoolData.poolKey;

      // Use tick bounds from position object (V3-compatible interface)
      const tickLower = position.tickLower;
      const tickUpper = position.tickUpper;
      if (tickLower === undefined || tickUpper === undefined) {
        throw new Error('position.tickLower and position.tickUpper are required');
      }

      const poolData = providedPoolData;

      // === CREATE SDK OBJECTS ===

      const isToken0Native = poolKey.currency0 === ethers.constants.AddressZero;
      const isToken1Native = poolKey.currency1 === ethers.constants.AddressZero;

      const currency0 = isToken0Native
        ? Ether.onChain(this.chainId)
        : new Token(this.chainId, poolKey.currency0, 18);

      const currency1 = isToken1Native
        ? Ether.onChain(this.chainId)
        : new Token(this.chainId, poolKey.currency1, 18);

      const v4Pool = new V4Pool(
        currency0,
        currency1,
        poolKey.fee,
        poolKey.tickSpacing,
        poolKey.hooks,
        poolData.sqrtPriceX96.toString(),
        poolData.liquidity.toString(),
        poolData.tick
      );

      // === APPLY SLIPPAGE BEFORE POSITION CALCULATION ===
      //
      // Same approach as generateCreatePositionData:
      // - Use input amounts as hard caps (amount0Max/amount1Max)
      // - Apply slippage to reduce amounts for position calculation
      // - This gives headroom: if price moves, more tokens can be used up to balance

      // Store input amounts as balances (these become our hard caps)
      const balance0 = JSBI.BigInt(token0Amount);
      const balance1 = JSBI.BigInt(token1Amount);

      // Apply slippage to reduce amounts for position calculation
      // e.g., 0.5% slippage → use 99.5% of balance for position calculation
      const slippageMultiplier = JSBI.BigInt(Math.floor((100 - slippageTolerance) * 100));
      const slippageDivisor = JSBI.BigInt(10000);

      const forPosition0 = JSBI.divide(JSBI.multiply(balance0, slippageMultiplier), slippageDivisor);
      const forPosition1 = JSBI.divide(JSBI.multiply(balance1, slippageMultiplier), slippageDivisor);

      // Create position from reduced amounts
      let v4Position;
      if (JSBI.equal(forPosition0, JSBI.BigInt(0))) {
        v4Position = V4Position.fromAmount1({
          pool: v4Pool,
          tickLower,
          tickUpper,
          amount1: forPosition1
        });
      } else if (JSBI.equal(forPosition1, JSBI.BigInt(0))) {
        v4Position = V4Position.fromAmount0({
          pool: v4Pool,
          tickLower,
          tickUpper,
          amount0: forPosition0
        });
      } else {
        v4Position = V4Position.fromAmounts({
          pool: v4Pool,
          tickLower,
          tickUpper,
          amount0: forPosition0,
          amount1: forPosition1,
          useFullPrecision: true
        });
      }

      // === GENERATE ADD LIQUIDITY CALLDATA ===

      const deadline = Math.floor(Date.now() / 1000) + (deadlineMinutes * 60);

      // Use full balances as max amounts - this is our hard cap
      const amount0Max = balance0;
      const amount1Max = balance1;



      // Build calldata using V4PositionPlanner directly
      const planner = new V4PositionPlanner();

      // Add INCREASE_LIQUIDITY action
      planner.addIncrease(
        tokenId,                       // existing position token ID
        v4Position.liquidity,          // liquidity to add (JSBI)
        amount0Max,                    // full balance as hard cap
        amount1Max,                    // full balance as hard cap
        hookData                       // hookData
      );

      // Add SETTLE_PAIR action (user pays tokens to the pool)
      planner.addSettlePair(v4Pool.currency0, v4Pool.currency1);

      // Add SWEEP for native ETH (return unused ETH to sender)
      if (isToken0Native) {
        // Need to get the wallet address for sweep - use position owner
        const positionManagerContract = new ethers.Contract(
          this.addresses.positionManagerAddress,
          this.positionManagerABI,
          provider
        );
        const owner = await positionManagerContract.ownerOf(tokenId);
        planner.addSweep(v4Pool.currency0, owner);
      }

      // Encode the final calldata
      const unlockData = planner.finalize();
      const calldata = V4PositionManager.encodeModifyLiquidities(unlockData, deadline.toString());

      // Set value for native ETH (hex string of amount0Max)
      const value = isToken0Native ? ('0x' + amount0Max.toString(16)) : '0x0';

      return {
        to: this.addresses.positionManagerAddress,
        data: calldata,
        value,
        quote: {
          liquidity: v4Position.liquidity.toString(),
          amount0: v4Position.amount0.quotient.toString(),
          amount1: v4Position.amount1.quotient.toString(),
          // Max amounts used in transaction (for verification/debugging)
          amount0Max: amount0Max.toString(),
          amount1Max: amount1Max.toString()
        }
      };

    } catch (error) {
      if (error.message.includes('is required') ||
          error.message.includes('must be') ||
          error.message.includes('Invalid') ||
          error.message.includes('At least one')) {
        throw error;
      }
      throw new Error(`Failed to generate add liquidity data: ${error.message}`);
    }
  }

  /**
   * Get the token amounts required to add liquidity to a position
   *
   * V4 note: Same concentrated liquidity math as V3.
   *
   * @param {Object} params - Parameters for calculating amounts
   * @param {Object} params.position - { tickLower, tickUpper }
   * @param {string} params.token0Amount - Desired amount of caller's token0 (wei string, can be "0")
   * @param {string} params.token1Amount - Desired amount of caller's token1 (wei string, can be "0")
   * @param {Object} params.poolData - { sqrtPriceX96, liquidity, tick }
   * @param {Object} params.poolKey - V4 PoolKey { currency0, currency1, fee, tickSpacing, hooks }
   * @param {Object} params.token0Data - Caller's token0 { address, decimals }
   * @param {Object} params.token1Data - Caller's token1 { address, decimals }
   * @param {Object} params.provider - Ethers provider
   * @returns {Promise<{token0Amount: string, token1Amount: string, liquidity: string}>} All as wei strings
   */
  async _getAddLiquidityAmounts(params) {
    const {
      position,
      token0Amount,
      token1Amount,
      poolData,
      token0Data,
      token1Data,
      provider
    } = params;

    // === VALIDATION ===

    // poolData validation (first, since we need to extract poolKey)
    if (!poolData || typeof poolData !== 'object') {
      throw new Error('poolData is required and must be an object');
    }
    if (poolData.sqrtPriceX96 === undefined) {
      throw new Error('poolData.sqrtPriceX96 is required');
    }
    if (poolData.liquidity === undefined) {
      throw new Error('poolData.liquidity is required');
    }
    if (poolData.tick === undefined) {
      throw new Error('poolData.tick is required');
    }

    // Extract poolKey from poolData (added by selectBestPool normalization)
    const poolKey = poolData.poolKey;

    // poolKey validation (V4 specific)
    if (!poolKey || typeof poolKey !== 'object') {
      throw new Error('poolKey is required and must be an object');
    }

    // position validation
    if (!position || typeof position !== 'object') {
      throw new Error('position is required and must be an object');
    }
    if (typeof position.tickLower !== 'number' || !Number.isInteger(position.tickLower)) {
      throw new Error('position.tickLower must be an integer');
    }
    if (typeof position.tickUpper !== 'number' || !Number.isInteger(position.tickUpper)) {
      throw new Error('position.tickUpper must be an integer');
    }
    if (position.tickLower >= position.tickUpper) {
      throw new Error('position.tickLower must be less than position.tickUpper');
    }

    // token0Amount validation
    if (token0Amount === null || token0Amount === undefined) {
      throw new Error('token0Amount is required');
    }
    if (typeof token0Amount !== 'string') {
      throw new Error('token0Amount must be a string');
    }
    if (!/^\d+$/.test(token0Amount)) {
      throw new Error('token0Amount must be a numeric string');
    }

    // token1Amount validation
    if (token1Amount === null || token1Amount === undefined) {
      throw new Error('token1Amount is required');
    }
    if (typeof token1Amount !== 'string') {
      throw new Error('token1Amount must be a string');
    }
    if (!/^\d+$/.test(token1Amount)) {
      throw new Error('token1Amount must be a numeric string');
    }

    // At least one amount must be > 0
    if (token0Amount === '0' && token1Amount === '0') {
      throw new Error('At least one token amount must be greater than 0');
    }

    // provider validation
    if (!provider) {
      throw new Error('provider is required');
    }
    if (!poolKey.currency0) {
      throw new Error('poolKey.currency0 is required');
    }
    if (!poolKey.currency1) {
      throw new Error('poolKey.currency1 is required');
    }
    if (poolKey.fee === undefined) {
      throw new Error('poolKey.fee is required');
    }
    if (poolKey.tickSpacing === undefined) {
      throw new Error('poolKey.tickSpacing is required');
    }

    // token0Data validation
    if (!token0Data || typeof token0Data !== 'object') {
      throw new Error('token0Data is required and must be an object');
    }
    if (!token0Data.address || !/^0x[a-fA-F0-9]{40}$/.test(token0Data.address)) {
      throw new Error('token0Data.address must be a valid Ethereum address');
    }
    if (typeof token0Data.decimals !== 'number' || token0Data.decimals < 0 || token0Data.decimals > 255) {
      throw new Error('token0Data.decimals must be a number between 0 and 255');
    }

    // token1Data validation
    if (!token1Data || typeof token1Data !== 'object') {
      throw new Error('token1Data is required and must be an object');
    }
    if (!token1Data.address || !/^0x[a-fA-F0-9]{40}$/.test(token1Data.address)) {
      throw new Error('token1Data.address must be a valid Ethereum address');
    }
    if (typeof token1Data.decimals !== 'number' || token1Data.decimals < 0 || token1Data.decimals > 255) {
      throw new Error('token1Data.decimals must be a number between 0 and 255');
    }

    // Tokens must be different
    if (token0Data.address.toLowerCase() === token1Data.address.toLowerCase()) {
      throw new Error('token0Data and token1Data must have different addresses');
    }

    try {
      // === DETERMINE TOKEN ORDERING ===
      // V4 PoolKey has currency0 < currency1 by address
      // Caller's tokens may be in different order
      const { sortedToken0, sortedToken1, tokensSwapped } = this.sortTokens(token0Data, token1Data);

      // === CREATE SDK OBJECTS ===
      const isToken0Native = poolKey.currency0 === ethers.constants.AddressZero;
      const isToken1Native = poolKey.currency1 === ethers.constants.AddressZero;

      const currency0 = isToken0Native
        ? Ether.onChain(this.chainId)
        : new Token(this.chainId, poolKey.currency0, sortedToken0.decimals);

      const currency1 = isToken1Native
        ? Ether.onChain(this.chainId)
        : new Token(this.chainId, poolKey.currency1, sortedToken1.decimals);

      const v4Pool = new V4Pool(
        currency0,
        currency1,
        poolKey.fee,
        poolKey.tickSpacing,
        poolKey.hooks || ethers.constants.AddressZero,
        poolData.sqrtPriceX96.toString(),
        poolData.liquidity.toString(),
        poolData.tick
      );

      // === MAP CALLER'S AMOUNTS TO SDK ORDER ===
      const sdkAmount0 = tokensSwapped ? token1Amount : token0Amount;
      const sdkAmount1 = tokensSwapped ? token0Amount : token1Amount;

      // === CREATE POSITION FROM AMOUNTS ===
      let v4Position;
      if (sdkAmount0 === '0') {
        v4Position = V4Position.fromAmount1({
          pool: v4Pool,
          tickLower: position.tickLower,
          tickUpper: position.tickUpper,
          amount1: sdkAmount1
        });
      } else if (sdkAmount1 === '0') {
        v4Position = V4Position.fromAmount0({
          pool: v4Pool,
          tickLower: position.tickLower,
          tickUpper: position.tickUpper,
          amount0: sdkAmount0
        });
      } else {
        v4Position = V4Position.fromAmounts({
          pool: v4Pool,
          tickLower: position.tickLower,
          tickUpper: position.tickUpper,
          amount0: sdkAmount0,
          amount1: sdkAmount1,
          useFullPrecision: true
        });
      }

      // === EXTRACT AND MAP BACK TO CALLER'S ORDER ===
      const resultAmount0 = v4Position.amount0.quotient.toString();
      const resultAmount1 = v4Position.amount1.quotient.toString();

      return {
        token0Amount: tokensSwapped ? resultAmount1 : resultAmount0,
        token1Amount: tokensSwapped ? resultAmount0 : resultAmount1,
        liquidity: v4Position.liquidity.toString()
      };

    } catch (error) {
      if (error.message.includes('is required') ||
          error.message.includes('must be') ||
          error.message.includes('Invalid')) {
        throw error;
      }
      throw new Error(`Failed to calculate add liquidity amounts: ${error.message}`);
    }
  }

  /**
   * Calculate the optimal token value ratio for a V4 position range
   *
   * Uses a test quote via _getAddLiquidityAmounts: feeds $100 of token0 with 0 token1,
   * then converts the SDK's output amounts to USD values to determine the value split.
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
    if (!position || typeof position !== 'object') {
      throw new Error('position is required and must be an object');
    }
    if (!Number.isFinite(position.tickLower) || !Number.isFinite(position.tickUpper)) {
      throw new Error('position.tickLower and position.tickUpper must be finite numbers');
    }
    if (position.tickLower >= position.tickUpper) {
      throw new Error('position.tickLower must be less than position.tickUpper');
    }
    if (!poolData || typeof poolData !== 'object') {
      throw new Error('poolData is required and must be an object');
    }
    if (!token0Data || typeof token0Data !== 'object') {
      throw new Error('token0Data is required and must be an object');
    }
    if (!token1Data || typeof token1Data !== 'object') {
      throw new Error('token1Data is required and must be an object');
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

    // Compute test inputs: $100 worth of each token
    // Providing both tokens hits the fromAmounts() path in the SDK, which correctly
    // handles in-range, above-tick, and below-tick positions in a single call.
    const testValueUSD = 100;
    const testAmount0 = ethers.utils.parseUnits(
      (testValueUSD / token0Price).toFixed(token0Data.decimals),
      token0Data.decimals
    );
    const testAmount1 = ethers.utils.parseUnits(
      (testValueUSD / token1Price).toFixed(token1Data.decimals),
      token1Data.decimals
    );

    const testQuote = await this._getAddLiquidityAmounts({
      position,
      token0Amount: testAmount0.toString(),
      token1Amount: testAmount1.toString(),
      provider,
      poolData,
      token0Data,
      token1Data
    });

    // Convert returned amounts to USD values
    const token0Decimal = parseFloat(ethers.utils.formatUnits(testQuote.token0Amount, token0Data.decimals));
    const token1Decimal = parseFloat(ethers.utils.formatUnits(testQuote.token1Amount, token1Data.decimals));
    const token0ValueUSD = token0Decimal * token0Price;
    const token1ValueUSD = token1Decimal * token1Price;
    const totalValueUSD = token0ValueUSD + token1ValueUSD;

    if (totalValueUSD === 0) {
      throw new Error('Test quote returned zero amounts for both tokens');
    }

    return {
      token0Share: token0ValueUSD / totalValueUSD,
      token1Share: token1ValueUSD / totalValueUSD
    };
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

    // Validate poolData first (needed to extract poolKey)
    if (poolData === null || poolData === undefined) {
      throw new Error("Pool data parameter is required");
    }
    if (typeof poolData !== 'object' || Array.isArray(poolData)) {
      throw new Error("Pool data must be an object");
    }

    // Extract poolKey from poolData (added by selectBestPool normalization)
    const poolKey = poolData.poolKey;

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

    // Continue validating poolData fields
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

      // Determine balances in sorted order (these become our hard caps)
      let balance0, balance1;
      if (tokensSwapped) {
        balance0 = JSBI.BigInt(token1Amount);
        balance1 = JSBI.BigInt(token0Amount);
      } else {
        balance0 = JSBI.BigInt(token0Amount);
        balance1 = JSBI.BigInt(token1Amount);
      }

      // Apply slippage to reduce amounts for position calculation
      // This leaves headroom for price movement during execution
      // e.g., 0.5% slippage → use 99.5% of balance for position calculation
      const slippageMultiplier = JSBI.BigInt(Math.floor((100 - slippageTolerance) * 100));
      const slippageDivisor = JSBI.BigInt(10000);

      const forPosition0 = JSBI.divide(JSBI.multiply(balance0, slippageMultiplier), slippageDivisor);
      const forPosition1 = JSBI.divide(JSBI.multiply(balance1, slippageMultiplier), slippageDivisor);

      // Create V4 Position using the SDK with reduced amounts
      let v4Position;
      if (JSBI.equal(forPosition1, JSBI.BigInt(0))) {
        v4Position = V4Position.fromAmount0({
          pool,
          tickLower: position.tickLower,
          tickUpper: position.tickUpper,
          amount0: forPosition0,
          useFullPrecision: true,
        });
      } else if (JSBI.equal(forPosition0, JSBI.BigInt(0))) {
        v4Position = V4Position.fromAmount1({
          pool,
          tickLower: position.tickLower,
          tickUpper: position.tickUpper,
          amount1: forPosition1,
          useFullPrecision: true,
        });
      } else {
        v4Position = V4Position.fromAmounts({
          pool,
          tickLower: position.tickLower,
          tickUpper: position.tickUpper,
          amount0: forPosition0,
          amount1: forPosition1,
          useFullPrecision: true,
        });
      }

      // =====================================================================
      // Generate Transaction Data using V4PositionPlanner
      // =====================================================================
      //
      // We use the input token balances as amount0Max/amount1Max (hard caps).
      // The position was calculated with reduced amounts (slippage buffer),
      // so mintAmounts < balances, giving headroom for price movement.

      // Calculate deadline timestamp
      const deadline = Math.floor(Date.now() / 1000) + (deadlineMinutes * 60);

      // Use full balances as max amounts - this is our hard cap
      const amount0Max = balance0;
      const amount1Max = balance1;



      // Build calldata using V4PositionPlanner directly
      const planner = new V4PositionPlanner();

      // Add MINT_POSITION action
      planner.addMint(
        pool,                          // Pool object
        position.tickLower,            // tickLower
        position.tickUpper,            // tickUpper
        v4Position.liquidity,          // liquidity (JSBI)
        amount0Max,                    // OUR amount0Max (simple slippage)
        amount1Max,                    // OUR amount1Max (simple slippage)
        walletAddress,                 // recipient
        hookData                       // hookData
      );

      // Add SETTLE_PAIR action (user pays tokens to the pool)
      planner.addSettlePair(pool.currency0, pool.currency1);

      // Add SWEEP for native ETH (return unused ETH to sender)
      if (isToken0Native) {
        planner.addSweep(pool.currency0, walletAddress);
      }

      // Encode the final calldata
      const unlockData = planner.finalize();
      const calldata = V4PositionManager.encodeModifyLiquidities(unlockData, deadline.toString());

      // Set value for native ETH (hex string of amount0Max)
      const value = isToken0Native ? ('0x' + amount0Max.toString(16)) : '0x0';

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
        // Max amounts used in transaction (for verification/debugging)
        amount0Max: tokensSwapped ? amount1Max.toString() : amount0Max.toString(),
        amount1Max: tokensSwapped ? amount0Max.toString() : amount1Max.toString(),
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
      forceProtocol,
      // Optional Permit2 parameters for ERC20 inputs
      permit2Signature,
      permit2Nonce,
      permit2Deadline
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

    // Build routing config - optionally force specific protocol, merge with fork optimization
    const protocolOverride = forceProtocol ? { protocols: [Protocol[forceProtocol]] } : {};
    const routingConfig = this.routingConfig
      ? { ...this.routingConfig, ...protocolOverride }
      : (forceProtocol ? { protocols: [Protocol[forceProtocol]] } : undefined);

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
    // Build quote object (shared between wrapped and unwrapped responses)
    // ========================================================================

    const quote = {
      amountOut: route.quote.quotient.toString(),
      amountOutMinimum: route.quoteGasAdjusted.quotient.toString(),
      gasEstimate: route.estimatedGasUsed.toString(),
      route: route.route.map(r => ({
        protocol: r.protocol,
        pools: r.poolAddresses || r.pools?.map(p => p.address),
        tokenPath: (r.route.path || r.route.currencyPath || []).map(t =>
          t.isNative ? ethers.constants.AddressZero : (t.address || t.wrapped?.address || '').toLowerCase()
        ),
        poolCount: r.route.pools?.length || r.route.pairs?.length || 1,
      }))
    };

    // ========================================================================
    // Wrap with Permit2 for ERC20 inputs (if signature provided)
    // ========================================================================

    if (!isNativeIn && permit2Signature) {
      // Validate Permit2 parameters
      if (typeof permit2Nonce !== 'number' || permit2Nonce < 0) {
        throw new Error('permit2Nonce must be a non-negative number when permit2Signature is provided');
      }
      if (typeof permit2Deadline !== 'number' || permit2Deadline <= 0) {
        throw new Error('permit2Deadline must be a positive number when permit2Signature is provided');
      }

      const permitData = {
        details: {
          token: tokenIn,
          amount: amountIn,
          expiration: permit2Deadline,
          nonce: permit2Nonce
        },
        spender: this.addresses.universalRouterAddress,
        sigDeadline: permit2Deadline
      };

      const wrappedCalldata = wrapWithPermit2(
        this.universalRouterInterface,
        route.methodParameters.calldata,
        permitData,
        permit2Signature
      );

      return {
        to: this.addresses.universalRouterAddress,
        data: wrappedCalldata,
        value: '0',
        quote
      };
    }

    // ========================================================================
    // Return unwrapped response (native ETH or no Permit2)
    // ========================================================================

    return {
      to: this.addresses.universalRouterAddress,
      data: route.methodParameters.calldata,
      value: isNativeIn ? amountIn : '0',
      quote
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
        this.routingConfig
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
        this.routingConfig
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
      // Validate instruction
      if (!instruction.tokenIn || !instruction.tokenIn.symbol) {
        throw new Error("tokenIn with symbol is required");
      }
      if (!instruction.tokenOut || !instruction.tokenOut.symbol) {
        throw new Error("tokenOut with symbol is required");
      }
      if (!instruction.amount) {
        throw new Error("amount is required");
      }

      const { tokenIn, tokenOut, amount, isAmountIn = true } = instruction;

      // Determine token addresses (native ETH uses AddressZero)
      const tokenInAddress = tokenIn.isNative ? ethers.constants.AddressZero : tokenIn.address;
      const tokenOutAddress = tokenOut.isNative ? ethers.constants.AddressZero : tokenOut.address;

      let swapData;
      let quotedAmountIn = amount;
      let quotedAmountOut;

      if (tokenIn.isNative) {
        // Native ETH input - no Permit2 needed
        swapData = await this._generateSwapData({
          tokenIn: tokenInAddress,
          tokenOut: tokenOutAddress,
          amountIn: amount,
          recipient,
          slippageTolerance
        });

        quotedAmountOut = swapData.quote.amountOut;
      } else {
        // ERC20 input - requires Permit2 signature

        // Get/track Permit2 nonce
        let nonce;
        if (nonceTracker.has(tokenIn.address)) {
          // Use tracked nonce for batched swaps
          nonce = nonceTracker.get(tokenIn.address);
        } else {
          // Fetch current nonce from Permit2 contract
          nonce = await getPermit2Nonce(
            provider,
            recipient,
            tokenIn.address,
            this.addresses.universalRouterAddress
          );
        }

        // Update tracker for next swap with same token
        nonceTracker.set(tokenIn.address, nonce + 1);

        // Generate Permit2 signature
        const deadline = Math.floor(Date.now() / 1000) + 1800; // 30 minutes
        const { signature } = await generatePermit2Signature(
          signer,
          chainId,
          tokenIn.address,
          amount,
          this.addresses.universalRouterAddress,
          nonce,
          deadline
        );

        // Generate swap data with Permit2 wrapping
        swapData = await this._generateSwapData({
          tokenIn: tokenInAddress,
          tokenOut: tokenOutAddress,
          amountIn: amount,
          recipient,
          slippageTolerance,
          permit2Signature: signature,
          permit2Nonce: nonce,
          permit2Deadline: deadline
        });

        quotedAmountOut = swapData.quote.amountOut;
      }

      transactions.push({
        to: swapData.to,
        data: swapData.data,
        value: swapData.value
      });

      metadata.push({
        tokenInSymbol: tokenIn.symbol,
        tokenOutSymbol: tokenOut.symbol,
        tokenInAddress: tokenIn.address,
        tokenOutAddress: tokenOut.address,
        quotedAmountIn,
        quotedAmountOut,
        isAmountIn,
        routes: (swapData.quote.route || []).map(r => ({
          tokenPath: r.tokenPath,
          poolCount: r.poolCount,
        }))
      });
    }

    return { transactions, metadata };
  }

  // ===========================================================================
  // RECEIPT PARSING METHODS
  // ===========================================================================

  /**
   * Parse position closure receipt to extract principal and fees
   *
   * V4 difference: No direct DecreaseLiquidity/Collect events like V3.
   * - Principal amounts: Calculated from ModifyLiquidity.liquidityDelta using tick math
   * - Total amounts: Parsed from ERC20 Transfer events
   * - Fee amounts: Total - Principal for ERC20, null for native ETH (no events)
   *
   * IMPORTANT: For positions with native ETH (address 0x0), fees will be null.
   * Callers must use getAccruedFeesUSD() BEFORE the closure transaction to get
   * expected fee amounts for native ETH positions.
   *
   * @param {Object} receipt - Transaction receipt with logs
   * @param {Object} positionMetadata - Metadata for closed positions keyed by tokenId
   *   { [tokenId]: { position, poolData, token0Data, token1Data } }
   *   - position: { tickLower, tickUpper, liquidity, ... }
   *   - poolData: { sqrtPriceX96, tick, ... } (REQUIRED for principal calculation)
   *   - token0Data: { address, decimals, symbol }
   *   - token1Data: { address, decimals, symbol }
   * @param {Object} [options] - Optional settings for native ETH tracking
   * @param {number} [options.chainId] - Chain ID for block explorer service
   * @param {string} [options.walletAddress] - Wallet address to track ETH transfers
   * @returns {Promise<Object>} { principalByPosition, feesByPosition }
   *   - principalByPosition: { [tokenId]: { amount0: BigNumber, amount1: BigNumber } }
   *   - feesByPosition: { [tokenId]: { token0: BigNumber|null, token1: BigNumber|null, metadata } }
   *     - token0/token1 are null for native ETH only when options not provided or API fails
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
    const NATIVE_ETH = ethers.constants.AddressZero.toLowerCase();

    // Event topic hashes
    // ModifyLiquidity(bytes32 indexed id, address indexed sender, int24 tickLower, int24 tickUpper, int256 liquidityDelta, bytes32 salt)
    const modifyLiquidityTopic = ethers.utils.id('ModifyLiquidity(bytes32,address,int24,int24,int256,bytes32)');
    // ERC20 Transfer(address indexed from, address indexed to, uint256 value)
    const erc20TransferTopic = ethers.utils.id('Transfer(address,address,uint256)');

    // Validate metadata structure and build token address set for filtering
    const tokenAddresses = new Set();
    for (const [tokenId, metadata] of Object.entries(positionMetadata)) {
      if (!metadata || !metadata.token0Data || !metadata.token1Data) {
        throw new Error(`Invalid metadata for position ${tokenId}: missing token data`);
      }
      if (!metadata.token0Data.address || !metadata.token1Data.address) {
        throw new Error(`Invalid metadata for position ${tokenId}: missing token addresses`);
      }
      if (!metadata.poolData || !metadata.poolData.sqrtPriceX96) {
        throw new Error(`Invalid metadata for position ${tokenId}: missing poolData.sqrtPriceX96 (required for principal calculation)`);
      }
      if (!metadata.position) {
        throw new Error(`Invalid metadata for position ${tokenId}: missing position`);
      }

      const addr0 = metadata.token0Data.address.toLowerCase();
      const addr1 = metadata.token1Data.address.toLowerCase();
      if (addr0 !== NATIVE_ETH) tokenAddresses.add(addr0);
      if (addr1 !== NATIVE_ETH) tokenAddresses.add(addr1);
    }

    // First pass: Parse ModifyLiquidity events to get principal amounts
    // For closures, liquidityDelta will be NEGATIVE
    const modifyLiqEvents = [];
    for (const log of receipt.logs) {
      if (!log.address || !log.topics || !Array.isArray(log.topics)) {
        throw new Error("Invalid log structure in receipt: missing address or topics");
      }

      if (log.topics[0] === modifyLiquidityTopic) {
        // Decode non-indexed data: (int24 tickLower, int24 tickUpper, int256 liquidityDelta, bytes32 salt)
        const decoded = ethers.utils.defaultAbiCoder.decode(
          ['int24', 'int24', 'int256', 'bytes32'],
          log.data
        );
        modifyLiqEvents.push({
          poolId: log.topics[1],
          tickLower: decoded[0],
          tickUpper: decoded[1],
          liquidityDelta: decoded[2]
        });
      }
    }

    // Second pass: Parse Transfer events for ERC20 total amounts
    const transfersByToken = {};
    for (const log of receipt.logs) {
      if (log.topics[0] !== erc20TransferTopic) continue;

      const logAddress = log.address.toLowerCase();
      if (!tokenAddresses.has(logAddress)) continue;

      if (log.topics.length < 3) {
        throw new Error(`Transfer event from ${logAddress} has insufficient topics: ${log.topics.length}`);
      }

      const decoded = ethers.utils.defaultAbiCoder.decode(['uint256'], log.data);
      const amount = decoded[0];

      if (!transfersByToken[logAddress]) {
        transfersByToken[logAddress] = ethers.BigNumber.from(0);
      }
      transfersByToken[logAddress] = transfersByToken[logAddress].add(amount);
    }

    // Match events to positions and calculate principal/fees
    for (const [tokenId, metadata] of Object.entries(positionMetadata)) {
      const { position, poolData, token0Data, token1Data } = metadata;
      const token0Address = token0Data.address.toLowerCase();
      const token1Address = token1Data.address.toLowerCase();

      // Find the ModifyLiquidity event for this position
      // Use tick bounds to match (positions are identified by tickLower/tickUpper within a pool)
      const modifyEvent = modifyLiqEvents.find(e =>
        e.tickLower === position.tickLower &&
        e.tickUpper === position.tickUpper
      );

      // Calculate principal from liquidityDelta (defaults to 0 if not found)
      let principalAmount0 = ethers.BigNumber.from(0);
      let principalAmount1 = ethers.BigNumber.from(0);

      if (modifyEvent && modifyEvent.liquidityDelta.lt(0)) {
        // Use absolute value of liquidityDelta for calculation
        const absLiquidity = JSBI.BigInt(modifyEvent.liquidityDelta.abs().toString());
        const sqrtPriceX96 = JSBI.BigInt(poolData.sqrtPriceX96.toString());

        const [amount0, amount1] = this._calculateAmountsFromLiquidity(
          absLiquidity,
          position.tickLower,
          position.tickUpper,
          sqrtPriceX96
        );

        principalAmount0 = ethers.BigNumber.from(amount0.toString());
        principalAmount1 = ethers.BigNumber.from(amount1.toString());
      }

      principalByPosition[tokenId] = {
        amount0: principalAmount0,
        amount1: principalAmount1
      };

      // Calculate fees = total - principal
      // For native ETH: total is null (no events), so fees is null
      // For ERC20: total from Transfer events, fees = total - principal
      const total0 = token0Address === NATIVE_ETH
        ? null
        : (transfersByToken[token0Address] || ethers.BigNumber.from(0));

      const total1 = token1Address === NATIVE_ETH
        ? null
        : (transfersByToken[token1Address] || ethers.BigNumber.from(0));

      // Calculate fees (null if total is null)
      const fees0 = total0 === null
        ? null
        : total0.sub(principalAmount0);

      const fees1 = total1 === null
        ? null
        : total1.sub(principalAmount1);

      feesByPosition[tokenId] = {
        token0: fees0,
        token1: fees1,
        metadata
      };
    }

    // ETH tracking: If options provided and any position has native ETH, fetch internal txs
    const hasNativeEth = Object.values(positionMetadata).some(m =>
      m.token0Data.address.toLowerCase() === NATIVE_ETH ||
      m.token1Data.address.toLowerCase() === NATIVE_ETH
    );

    if (hasNativeEth && options.chainId && options.walletAddress) {
      try {
        const explorer = getBlockExplorerService(options.chainId);
        const ethTransfers = await explorer.getEthTransfersForWallet(
          receipt.transactionHash,
          options.walletAddress
        );

        // Total ETH received by wallet in this transaction
        const totalEthReceived = ethTransfers.received;

        if (!totalEthReceived.isZero()) {
          // Calculate total liquidity removed (for proportional distribution)
          let totalLiquidityRemoved = ethers.BigNumber.from(0);
          const liquidityByPosition = {};

          for (const [tokenId, metadata] of Object.entries(positionMetadata)) {
            const token0Addr = metadata.token0Data.address.toLowerCase();
            const token1Addr = metadata.token1Data.address.toLowerCase();

            // Only include positions with native ETH
            if (token0Addr === NATIVE_ETH || token1Addr === NATIVE_ETH) {
              // Find the ModifyLiquidity event for this position
              const modifyEvent = modifyLiqEvents.find(e =>
                e.tickLower === metadata.position.tickLower &&
                e.tickUpper === metadata.position.tickUpper
              );

              if (modifyEvent && modifyEvent.liquidityDelta.lt(0)) {
                const absLiq = modifyEvent.liquidityDelta.abs();
                liquidityByPosition[tokenId] = absLiq;
                totalLiquidityRemoved = totalLiquidityRemoved.add(absLiq);
              }
            }
          }

          // Distribute ETH proportionally by liquidity
          if (!totalLiquidityRemoved.isZero()) {
            for (const [tokenId, liq] of Object.entries(liquidityByPosition)) {
              const metadata = positionMetadata[tokenId];
              const token0Addr = metadata.token0Data.address.toLowerCase();
              const token1Addr = metadata.token1Data.address.toLowerCase();

              // Calculate this position's share of ETH
              // positionEth = totalEth * (positionLiquidity / totalLiquidity)
              const positionEth = totalEthReceived.mul(liq).div(totalLiquidityRemoved);

              // ETH received includes both principal + fees
              // fees = totalReceived - principal
              const principal = principalByPosition[tokenId];

              if (token0Addr === NATIVE_ETH) {
                const ethFees = positionEth.sub(principal.amount0);
                feesByPosition[tokenId].token0 = ethFees.lt(0) ? ethers.BigNumber.from(0) : ethFees;
              }
              if (token1Addr === NATIVE_ETH) {
                const ethFees = positionEth.sub(principal.amount1);
                feesByPosition[tokenId].token1 = ethFees.lt(0) ? ethers.BigNumber.from(0) : ethFees;
              }
            }
          }
        }
      } catch (error) {
        // Graceful degradation: log warning and keep null values
        console.warn(`⚠️ Block explorer ETH tracking failed: ${error.message}`);
      }
    }

    return { principalByPosition, feesByPosition };
  }

  /**
   * Parse fee collection receipt to extract collected fee amounts
   *
   * V4 difference: No direct Collect event like V3. For ERC20 tokens, we parse
   * standard Transfer events from token contracts. For native ETH, no events
   * are emitted (ETH is sent via assembly call), so null is returned.
   *
   * IMPORTANT: For positions with native ETH (address 0x0), token0 or token1
   * will be null. Callers must use getAccruedFeesUSD() BEFORE the claim
   * transaction to get expected fee amounts for native ETH positions.
   *
   * @param {Object} receipt - Transaction receipt with logs
   * @param {Object} positionMetadata - { [tokenId]: { token0Data, token1Data, position? } }
   *   - token0Data: { address, decimals, symbol }
   *   - token1Data: { address, decimals, symbol }
   *   - position: { liquidity } (optional, for proportional ETH distribution)
   * @param {Object} [options] - Optional settings for native ETH tracking
   * @param {number} [options.chainId] - Chain ID for block explorer service
   * @param {string} [options.walletAddress] - Wallet address to track ETH transfers
   * @returns {Promise<Object>} { feesByPosition: { [tokenId]: { token0, token1, metadata } } }
   *   - token0/token1: BigNumber for ERC20, null for native ETH only when options not provided
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
    const NATIVE_ETH = ethers.constants.AddressZero.toLowerCase();

    // V4 fee collection emits standard ERC20 Transfer events from the token contracts
    // Transfer(address indexed from, address indexed to, uint256 value)
    // NOTE: Native ETH transfers use assembly call() and emit NO events
    const erc20TransferTopic = ethers.utils.id('Transfer(address,address,uint256)');

    // Build set of ERC20 token addresses we care about (for filtering)
    // Skip native ETH (0x0) since it won't have Transfer events
    const tokenAddresses = new Set();
    for (const [tokenId, metadata] of Object.entries(positionMetadata)) {
      // Validate metadata structure - throw if malformed
      if (!metadata || !metadata.token0Data || !metadata.token1Data) {
        throw new Error(`Invalid metadata for position ${tokenId}: missing token data`);
      }
      if (!metadata.token0Data.address || !metadata.token1Data.address) {
        throw new Error(`Invalid metadata for position ${tokenId}: missing token addresses`);
      }

      const addr0 = metadata.token0Data.address.toLowerCase();
      const addr1 = metadata.token1Data.address.toLowerCase();
      if (addr0 !== NATIVE_ETH) {
        tokenAddresses.add(addr0);
      }
      if (addr1 !== NATIVE_ETH) {
        tokenAddresses.add(addr1);
      }
    }

    // Collect all ERC20 Transfer events from token contracts we care about
    const transfersByToken = {};

    for (const log of receipt.logs) {
      // Validate log structure
      if (!log.address || !log.topics || !Array.isArray(log.topics)) {
        throw new Error(`Invalid log structure in receipt: missing address or topics`);
      }

      // Skip non-Transfer events (legitimate filtering)
      if (log.topics[0] !== erc20TransferTopic) {
        continue;
      }

      // Skip Transfer events from tokens we don't care about (legitimate filtering)
      const logAddress = log.address.toLowerCase();
      if (!tokenAddresses.has(logAddress)) {
        continue;
      }

      // This is a Transfer event from a token we care about - must be valid
      if (log.topics.length < 3) {
        throw new Error(`Transfer event from ${logAddress} has insufficient topics: ${log.topics.length}`);
      }

      // Decode amount - if this fails for a Transfer event we care about, that's an error
      const decoded = ethers.utils.defaultAbiCoder.decode(['uint256'], log.data);
      const amount = decoded[0];

      // Track transfers by token address
      if (!transfersByToken[logAddress]) {
        transfersByToken[logAddress] = ethers.BigNumber.from(0);
      }
      transfersByToken[logAddress] = transfersByToken[logAddress].add(amount);
    }

    // Match transfers to positions based on token addresses
    for (const [tokenId, metadata] of Object.entries(positionMetadata)) {
      // Metadata already validated above
      const token0Address = metadata.token0Data.address.toLowerCase();
      const token1Address = metadata.token1Data.address.toLowerCase();

      // For native ETH, return null (cannot parse from receipt - no events emitted)
      // For ERC20, return parsed amount or BigNumber(0)
      const amount0 = token0Address === NATIVE_ETH
        ? null
        : (transfersByToken[token0Address] || ethers.BigNumber.from(0));

      const amount1 = token1Address === NATIVE_ETH
        ? null
        : (transfersByToken[token1Address] || ethers.BigNumber.from(0));

      // Always include position in result (caller needs to handle null values)
      feesByPosition[tokenId] = {
        token0: amount0,
        token1: amount1,
        metadata: metadata
      };
    }

    // ETH tracking: If options provided and any position has native ETH, fetch internal txs
    const hasNativeEth = Object.values(positionMetadata).some(m =>
      m.token0Data.address.toLowerCase() === NATIVE_ETH ||
      m.token1Data.address.toLowerCase() === NATIVE_ETH
    );

    if (hasNativeEth && options.chainId && options.walletAddress) {
      try {
        const explorer = getBlockExplorerService(options.chainId);
        const ethTransfers = await explorer.getEthTransfersForWallet(
          receipt.transactionHash,
          options.walletAddress
        );

        // Total ETH received by wallet = total fees collected
        const totalEthReceived = ethTransfers.received;

        if (!totalEthReceived.isZero()) {
          // Count positions with native ETH and calculate total liquidity for distribution
          const nativeEthPositions = [];
          let totalLiquidity = ethers.BigNumber.from(0);

          for (const [tokenId, metadata] of Object.entries(positionMetadata)) {
            const token0Addr = metadata.token0Data.address.toLowerCase();
            const token1Addr = metadata.token1Data.address.toLowerCase();

            if (token0Addr === NATIVE_ETH || token1Addr === NATIVE_ETH) {
              // Use liquidity for proportional distribution if available
              const liquidity = metadata.position?.liquidity
                ? ethers.BigNumber.from(metadata.position.liquidity.toString())
                : ethers.BigNumber.from(1); // Default to 1 for equal distribution

              nativeEthPositions.push({ tokenId, metadata, liquidity });
              totalLiquidity = totalLiquidity.add(liquidity);
            }
          }

          // Distribute ETH proportionally by liquidity
          for (const { tokenId, metadata, liquidity } of nativeEthPositions) {
            const token0Addr = metadata.token0Data.address.toLowerCase();
            const token1Addr = metadata.token1Data.address.toLowerCase();

            // Calculate this position's share of ETH
            const positionEth = totalEthReceived.mul(liquidity).div(totalLiquidity);

            // For collect, all ETH received is fees (no principal to subtract)
            if (token0Addr === NATIVE_ETH) {
              feesByPosition[tokenId].token0 = positionEth;
            }
            if (token1Addr === NATIVE_ETH) {
              feesByPosition[tokenId].token1 = positionEth;
            }
          }
        }
      } catch (error) {
        // Graceful degradation: log warning and keep null values
        console.warn(`⚠️ Block explorer ETH tracking failed: ${error.message}`);
      }
    }

    return { feesByPosition };
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

    // Compute topic hashes for all Uniswap swap versions
    const topicV2 = this._getSwapTopicV2();
    const topicV3 = this._getSwapTopicV3();
    const topicV4 = ethers.utils.id(this._getSwapEventSignature());

    // Step 1: Scan ALL receipt logs, collecting swap events from all versions
    const allSwapEvents = [];
    for (const log of receipt.logs) {
      if (!log.topics || !log.topics[0]) continue;
      const topic0 = log.topics[0];
      try {
        if (topic0 === topicV4) {
          const decoded = ethers.utils.defaultAbiCoder.decode(
            ['int128', 'int128', 'uint160', 'uint128', 'int24', 'uint24'],
            log.data
          );
          allSwapEvents.push({
            protocol: 'V4',
            parsed: { amount0: decoded[0], amount1: decoded[1] },
            logIndex: log.logIndex,
            address: log.address?.toLowerCase()
          });
        } else if (topic0 === topicV3) {
          allSwapEvents.push({
            protocol: 'V3',
            parsed: this._parseV3SwapEvent(log),
            logIndex: log.logIndex,
            address: log.address?.toLowerCase()
          });
        } else if (topic0 === topicV2) {
          allSwapEvents.push({
            protocol: 'V2',
            parsed: this._parseV2SwapEvent(log),
            logIndex: log.logIndex,
            address: log.address?.toLowerCase()
          });
        }
      } catch (e) {
        // Not a valid swap event, skip
      }
    }

    // Sort by logIndex to maintain emission order
    allSwapEvents.sort((a, b) => (a.logIndex ?? 0) - (b.logIndex ?? 0));

    // Step 2: Match events to metadata sequentially
    let eventIndex = 0;

    for (const metadata of swapMetadata) {
      // Validate required metadata fields
      if (!metadata.tokenInAddress) {
        throw new Error("Swap metadata must have tokenInAddress");
      }
      if (!metadata.tokenOutAddress) {
        throw new Error("Swap metadata must have tokenOutAddress");
      }

      let totalAmountIn = BigInt(0);
      let totalAmountOut = BigInt(0);

      if (metadata.routes && metadata.routes.length > 0) {
        // ROUTE-AWARE PARSING: Use tokenPath for multi-hop/split routes
        for (const { tokenPath, poolCount } of metadata.routes) {
          for (let hopIdx = 0; hopIdx < poolCount; hopIdx++) {
            if (eventIndex >= allSwapEvents.length) break;

            const event = allSwapEvents[eventIndex];
            const amounts = this._extractSwapAmounts(event.protocol, event.parsed);

            if (hopIdx === 0) {
              totalAmountIn += amounts.amountIn;
            }
            if (hopIdx === poolCount - 1) {
              totalAmountOut += amounts.amountOut;
            }

            eventIndex++;
          }
        }
      } else {
        // SIMPLE ROUTE: No route info — consume one event per metadata entry
        const numEvents = metadata.expectedSwapEvents || 1;
        for (let i = 0; i < numEvents; i++) {
          if (eventIndex >= allSwapEvents.length) break;

          const event = allSwapEvents[eventIndex];
          const amounts = this._extractSwapAmounts(event.protocol, event.parsed);

          totalAmountIn += amounts.amountIn;
          totalAmountOut += amounts.amountOut;
          eventIndex++;
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

    // Calculate token amounts using shared helper
    const sqrtPriceX96 = JSBI.BigInt(poolData.sqrtPriceX96.toString());
    const liquidity = JSBI.BigInt(modifyLiqEvent.liquidityDelta.toString());

    // Handle negative liquidity (decrease) by taking absolute value for calculation
    const absLiquidity = JSBI.greaterThanOrEqual(liquidity, JSBI.BigInt(0))
      ? liquidity
      : JSBI.multiply(liquidity, JSBI.BigInt(-1));

    const [amount0, amount1] = this._calculateAmountsFromLiquidity(
      absLiquidity,
      tickLower,
      tickUpper,
      sqrtPriceX96
    );

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
    // V4 supports native ETH (AddressZero) - no need to convert to WETH
    const resolveTokenData = (symbol) => {
      if (isNativeToken(symbol)) {
        return {
          address: ethers.constants.AddressZero,
          symbol: 'ETH',
          decimals: 18,
          isNative: true
        };
      }
      // Handle wrapped native tokens specially - they're not in the base tokens config
      // but are derived from native token's wrappedAddresses
      if (isWrappedNativeToken(symbol)) {
        const wrappedAddress = getWrappedNativeAddress(chainId);
        return {
          address: wrappedAddress,
          symbol: getWrappedNativeSymbol(chainId),
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

    // Sort tokens for subgraph query (token0 < token1)
    const { sortedToken0, sortedToken1 } = this.sortTokens(tokenAData, tokenBData);

    // Query subgraph for V4 pools (vanilla pools only - no hooks)
    const rawPools = await discoverV4Pools(
      sortedToken0.address,
      sortedToken1.address,
      chainId
    );

    if (rawPools.length === 0) {
      throw new Error(`No pools found for ${tokenASymbol}/${tokenBSymbol} on ${this.platformName}`);
    }

    // Normalize pool data structure - include static metadata only
    // Subgraph returns: id, feeTier, tick (STALE), sqrtPrice (STALE), liquidity (STALE), token0.id, token1.id
    // We keep: poolId, fee, tickSpacing, hooks, poolKey, TVL (for ranking)
    // We fetch fresh: tick, sqrtPriceX96, liquidity (from on-chain after selection)
    const pools = rawPools.map(pool => {
      const fee = parseInt(pool.feeTier, 10);
      const tickSpacing = parseInt(pool.tickSpacing, 10);
      const token0Address = pool.token0.id;
      const token1Address = pool.token1.id;
      const hooks = pool.hooks || ethers.constants.AddressZero;

      return {
        // V4 uses poolId (bytes32 hash) - expose as both 'address' and 'poolId' for compatibility
        address: pool.id,
        poolId: pool.id,
        // Static metadata from subgraph
        fee,
        tickSpacing,
        hooks,
        totalValueLockedUSD: pool.totalValueLockedUSD,
        // Token metadata — resolve symbols via fum_library config (not subgraph)
        // to ensure canonical symbols (e.g., 'USD₮0' not on-chain 'USDT')
        token0: {
          symbol: this._resolveTokenSymbol(token0Address),
          address: token0Address,
          decimals: parseInt(pool.token0.decimals, 10),
          isNative: token0Address === ethers.constants.AddressZero
        },
        token1: {
          symbol: this._resolveTokenSymbol(token1Address),
          address: token1Address,
          decimals: parseInt(pool.token1.decimals, 10),
          isNative: token1Address === ethers.constants.AddressZero
        },
        // V4-specific: Include poolKey for contract interactions
        poolKey: {
          currency0: token0Address,
          currency1: token1Address,
          fee,
          tickSpacing,
          hooks
        }
        // NOTE: NOT including tick, sqrtPriceX96, liquidity from subgraph - will fetch fresh below
      };
    });

    // Filter dead pools and sort by TVL from subgraph
    const activePools = pools.filter(pool => parseFloat(pool.totalValueLockedUSD || '0') > 0);

    if (activePools.length === 0) {
      throw new Error(
        `No active pools for ${tokenASymbol}/${tokenBSymbol} on ${this.platformName} ` +
        `(${pools.length} pools exist but all have zero TVL)`
      );
    }

    // Sort by TVL (highest first)
    activePools.sort((a, b) => {
      const tvlA = parseFloat(a.totalValueLockedUSD || '0');
      const tvlB = parseFloat(b.totalValueLockedUSD || '0');
      return tvlB - tvlA;
    });

    // Fetch FRESH on-chain state for the best pool
    const bestPoolMetadata = activePools[0];
    const freshPoolState = await this.getPoolData(bestPoolMetadata.address, provider);

    // Merge fresh state with subgraph metadata
    const bestPool = {
      ...bestPoolMetadata,  // Static metadata (poolKey, fee, tickSpacing, hooks, TVL)
      ...freshPoolState     // Fresh on-chain state (tick, sqrtPriceX96, liquidity, feeGrowth)
    };

    return {
      bestPool,
      poolsDiscovered: pools.length,
      poolsActive: activePools.length
    };
  }

  /**
   * Calculate token amounts from liquidity and tick bounds using SqrtPriceMath.
   * Internal helper used by calculateTokenAmounts and parseIncreaseLiquidityReceipt.
   *
   * Uses the same concentrated liquidity math as V3 (SqrtPriceMath from @uniswap/v3-sdk).
   *
   * @param {JSBI} liquidity - Position liquidity as JSBI (must be non-negative)
   * @param {number} tickLower - Lower tick boundary
   * @param {number} tickUpper - Upper tick boundary
   * @param {JSBI} sqrtPriceX96 - Current sqrt price in Q64.96 format as JSBI
   * @returns {[JSBI, JSBI]} [amount0, amount1] as JSBI values
   * @private
   */
  _calculateAmountsFromLiquidity(liquidity, tickLower, tickUpper, sqrtPriceX96) {
    // Handle zero liquidity edge case
    if (JSBI.equal(liquidity, JSBI.BigInt(0))) {
      return [JSBI.BigInt(0), JSBI.BigInt(0)];
    }

    // Convert tick bounds to sqrt prices
    const sqrtPriceLower = TickMath.getSqrtRatioAtTick(tickLower);
    const sqrtPriceUpper = TickMath.getSqrtRatioAtTick(tickUpper);

    let amount0, amount1;

    if (JSBI.lessThan(sqrtPriceX96, sqrtPriceLower)) {
      // Current price below range - position holds only token0
      amount0 = SqrtPriceMath.getAmount0Delta(sqrtPriceLower, sqrtPriceUpper, liquidity, true);
      amount1 = JSBI.BigInt(0);
    } else if (JSBI.greaterThan(sqrtPriceX96, sqrtPriceUpper)) {
      // Current price above range - position holds only token1
      amount0 = JSBI.BigInt(0);
      amount1 = SqrtPriceMath.getAmount1Delta(sqrtPriceLower, sqrtPriceUpper, liquidity, true);
    } else {
      // Current price in range - position holds both tokens
      amount0 = SqrtPriceMath.getAmount0Delta(sqrtPriceX96, sqrtPriceUpper, liquidity, true);
      amount1 = SqrtPriceMath.getAmount1Delta(sqrtPriceLower, sqrtPriceX96, liquidity, true);
    }

    return [amount0, amount1];
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
   * Format a human-readable summary of a pool for logging.
   * @param {Object} pool - Pool object from selectBestPool
   * @returns {string} Formatted pool description
   */
  describePool(pool) {
    const t0 = pool.token0?.symbol ?? '?';
    const t1 = pool.token1?.symbol ?? '?';
    return `${t0}/${t1} at ${pool.address} (fee: ${pool.fee}bp, tick: ${pool.tick})`;
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
   * NOTE: Not used in production source code — only called from test setup
   * and test helpers across fum_library and fum_automation.
   */
  async fetchPoolDataForTesting(token0Address, token1Address, fee, tickSpacing, hooks, provider) {
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
   * Convert a tick value to a corresponding price using the Uniswap SDK
   *
   * V4 note: Uses same tick math as V3 since both are concentrated liquidity.
   *
   * @param {number} tick - The tick value
   * @param {Object} baseToken - Base token (token0 unless inverted)
   * @param {string} baseToken.address - Token address
   * @param {number} baseToken.decimals - Token decimals
   * @param {Object} quoteToken - Quote token (token1 unless inverted)
   * @param {string} quoteToken.address - Token address
   * @param {number} quoteToken.decimals - Token decimals
   * @returns {Price} Uniswap SDK Price object with methods like toFixed(), toSignificant(), etc.
   */
  _tickToPrice(tick, baseToken, quoteToken) {
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
   * Get required approval transactions for a given operation type
   *
   * For Uniswap V4:
   * - Swaps: ERC20 approve to Permit2 (UniversalRouter pulls via Permit2)
   * - Liquidity: ERC20 approve to Permit2 + Permit2 allowance to PositionManager
   *   (V4 PositionManager uses permit2.transferFrom, requiring the two-step approval)
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

    // For V4, all operations go through Permit2 for ERC20 approval
    for (const tokenAddress of tokenAddresses) {
      // Skip native ETH - no ERC20 approval needed
      if (tokenAddress === ethers.constants.AddressZero) {
        continue;
      }

      if (!ethers.utils.isAddress(tokenAddress)) {
        throw new Error(`getRequiredApprovals: invalid token address ${tokenAddress}`);
      }

      // Step 1: Check if ERC20 approval to Permit2 is needed
      const needsERC20Approval = await this._checkNeedsERC20Approval(vaultAddress, tokenAddress, PERMIT2_ADDRESS, provider);
      if (needsERC20Approval) {
        transactions.push(this._encodeERC20Approve(tokenAddress, PERMIT2_ADDRESS));
      }

      // Step 2: For liquidity operations, also need Permit2 allowance to PositionManager
      if (operationType === 'liquidity') {
        const needsPermit2Allowance = await this._checkNeedsPermit2Allowance(
          vaultAddress,
          tokenAddress,
          this.addresses.positionManagerAddress,
          provider
        );
        if (needsPermit2Allowance) {
          // Set expiration to 1 year from now
          const expiration = Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60);
          transactions.push(this._encodePermit2Approve(tokenAddress, this.addresses.positionManagerAddress, expiration));
        }
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
   * Check if a Permit2 allowance is needed
   *
   * Returns true if current Permit2 allowance amount is 0 or if the
   * expiration is less than 1 hour from now.
   *
   * @param {string} vaultAddress - Address that owns the tokens
   * @param {string} tokenAddress - Token contract address
   * @param {string} spender - Address that will spend via Permit2
   * @param {Object} provider - Ethers provider
   * @returns {Promise<boolean>} True if Permit2 allowance is needed
   * @private
   */
  async _checkNeedsPermit2Allowance(vaultAddress, tokenAddress, spender, provider) {
    const permit2Abi = [
      'function allowance(address owner, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)'
    ];
    const permit2 = new ethers.Contract(PERMIT2_ADDRESS, permit2Abi, provider);
    const [amount, expiration] = await permit2.allowance(vaultAddress, tokenAddress, spender);
    const now = Math.floor(Date.now() / 1000);
    // Renew if amount is 0 or expiration is less than 1 hour from now
    return amount.eq(0) || expiration < now + 3600;
  }

  /**
   * Encode a Permit2 approve transaction
   *
   * Uses Permit2's approve() function to grant allowance to a spender.
   * This is the on-chain equivalent of the signed permit approach.
   *
   * @param {string} tokenAddress - Token contract address
   * @param {string} spender - Address to grant Permit2 allowance to
   * @param {number} expiration - Unix timestamp when allowance expires
   * @returns {Object} Transaction object { to, data, value }
   * @private
   */
  _encodePermit2Approve(tokenAddress, spender, expiration) {
    // Permit2 approve function signature:
    // approve(address token, address spender, uint160 amount, uint48 expiration)
    const permit2Interface = new ethers.utils.Interface([
      'function approve(address token, address spender, uint160 amount, uint48 expiration)'
    ]);

    // Use max uint160 for amount (2^160 - 1)
    const maxUint160 = ethers.BigNumber.from(2).pow(160).sub(1);

    const data = permit2Interface.encodeFunctionData('approve', [
      tokenAddress,
      spender,
      maxUint160,
      expiration
    ]);

    return {
      to: PERMIT2_ADDRESS,
      data: data,
      value: '0'
    };
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
   * Decode packed PositionInfo uint256 from PositionManager
   *
   * V4 PositionManager packs position info into a single uint256:
   * Layout: | 200 bits poolId | 24 bits tickUpper | 24 bits tickLower | 8 bits hasSubscriber |
   *
   * Note: The poolId in the packed info is truncated; use getPoolAndPositionInfo()
   * to get the full PoolKey instead.
   *
   * @param {string|BigInt|ethers.BigNumber} packedInfo - Packed PositionInfo uint256
   * @returns {Object} { tickLower, tickUpper, hasSubscriber }
   * @private
   */
  _decodePositionInfo(packedInfo) {
    const info = BigInt(packedInfo.toString());

    // Extract tickLower (bits 8-31, signed 24-bit)
    const tickLowerRaw = Number((info >> 8n) & 0xffffffn);
    const tickLower = tickLowerRaw >= 0x800000 ? tickLowerRaw - 0x1000000 : tickLowerRaw;

    // Extract tickUpper (bits 32-55, signed 24-bit)
    const tickUpperRaw = Number((info >> 32n) & 0xffffffn);
    const tickUpper = tickUpperRaw >= 0x800000 ? tickUpperRaw - 0x1000000 : tickUpperRaw;

    // Extract hasSubscriber (bits 0-7)
    const hasSubscriber = (info & 0xffn) !== 0n;

    return { tickLower, tickUpper, hasSubscriber };
  }

  /**
   * Calculate uncollected fees for a V4 position
   *
   * V4 difference from V3:
   * - Uses StateView.getFeeGrowthInside() instead of manual tick math
   * - Position lookup uses (poolId, owner, tickLower, tickUpper, salt)
   * - salt = bytes32(tokenId)
   * - owner = PositionManager address (not the NFT holder)
   *
   * @param {string|number} tokenId - Position NFT token ID
   * @param {string} poolId - Pool identifier (bytes32)
   * @param {number} tickLower - Lower tick boundary
   * @param {number} tickUpper - Upper tick boundary
   * @param {Object} provider - Ethers provider
   * @returns {Promise<{fees0: BigInt, fees1: BigInt, liquidity: BigInt}>}
   * @private
   */
  async _calculateUncollectedFees(tokenId, poolId, tickLower, tickUpper, provider) {
    const stateViewContract = new ethers.Contract(
      this.addresses.stateViewAddress,
      this.stateViewABI,
      provider
    );

    // salt = bytes32(tokenId), owner = positionManager
    const salt = ethers.utils.hexZeroPad(ethers.BigNumber.from(tokenId).toHexString(), 32);
    const owner = this.addresses.positionManagerAddress;

    // Fetch current and last fee growth in parallel
    // Note: getPositionInfo has two overloaded signatures, use explicit form for 5-param version
    const [feeGrowthInside, positionInfo] = await Promise.all([
      stateViewContract.getFeeGrowthInside(poolId, tickLower, tickUpper),
      stateViewContract['getPositionInfo(bytes32,address,int24,int24,bytes32)'](poolId, owner, tickLower, tickUpper, salt)
    ]);

    // StateView.getFeeGrowthInside returns (feeGrowthInside0X128, feeGrowthInside1X128)
    const [feeGrowthInside0, feeGrowthInside1] = feeGrowthInside;

    // StateView.getPositionInfo returns (liquidity, feeGrowthInside0LastX128, feeGrowthInside1LastX128)
    const [liquidity, feeGrowthLast0, feeGrowthLast1] = positionInfo;

    // Calculate fees: (currentGrowth - lastGrowth) * liquidity / 2^128
    const Q128 = 2n ** 128n;
    const fees0 = (BigInt(feeGrowthInside0.toString()) - BigInt(feeGrowthLast0.toString()))
                  * BigInt(liquidity.toString()) / Q128;
    const fees1 = (BigInt(feeGrowthInside1.toString()) - BigInt(feeGrowthLast1.toString()))
                  * BigInt(liquidity.toString()) / Q128;

    return { fees0, fees1, liquidity: BigInt(liquidity.toString()) };
  }

  // ===========================================================================
  // Incentive Rewards — Merkl Integration (auto-tracking, no staking needed)
  // ===========================================================================

  /**
   * Check if a V4 pool has active Merkl incentive campaigns
   *
   * V4 pools are identified by poolId (bytes32), which Merkl tracks directly.
   * No token address resolution needed — poolAddress IS the poolId.
   *
   * @param {string} poolAddress - V4 poolId (bytes32)
   * @param {Object} poolData - Pool metadata (unused for V4, kept for interface consistency)
   * @param {Object} provider - Ethers provider instance (unused, Merkl is off-chain)
   * @returns {Promise<Object>} { active: boolean, programs: Array }
   */
  async getPoolIncentives(poolAddress, poolData, provider) {
    return fetchPoolIncentives(this.chainId, poolAddress);
  }

  /**
   * Build claim transaction for unclaimed Merkl rewards
   *
   * Claims ALL unclaimed Merkl rewards for the vault across all pools/tokens.
   * This is safe because Merkl uses a cumulative claim model — each claim
   * includes the total earned amount with an updated Merkle proof.
   *
   * @param {string} vaultAddress - Vault address to claim rewards for
   * @param {string} poolAddress - Pool identifier (unused — Merkl claims are vault-wide)
   * @param {Object} poolData - Pool metadata (unused for V4)
   * @param {Object} provider - Ethers provider instance (unused, Merkl is off-chain)
   * @returns {Promise<Array<Object>>} Array of transaction data objects [{ to, data, value }]
   */
  async getIncentiveClaimTransactions(vaultAddress, poolAddress, poolData, provider) {
    const claimData = await fetchClaimData(this.chainId, vaultAddress);

    if (!claimData || !claimData.tokens || claimData.tokens.length === 0) {
      return [];
    }

    const distributorAddress = getChainConfig(this.chainId).merklDistributorAddress;
    if (!distributorAddress) {
      console.error(`No Merkl Distributor address configured for chain ${this.chainId}`);
      return [];
    }

    const iface = new ethers.utils.Interface([
      'function claim(address user, address[] tokens, uint256[] amounts, bytes32[][] proofs)'
    ]);

    const data = iface.encodeFunctionData('claim', [
      claimData.user,
      claimData.tokens,
      claimData.amounts,
      claimData.proofs,
    ]);

    return [{ to: distributorAddress, data, value: '0x0' }];
  }

}
