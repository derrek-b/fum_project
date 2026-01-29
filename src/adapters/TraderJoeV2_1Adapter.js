// fum_library/adapters/TraderJoeV2_1Adapter.js
/**
 * Adapter for Trader Joe V2.1 Liquidity Book on Arbitrum
 *
 * Trader Joe V2.1 uses a bin-based concentrated liquidity system where:
 * - tokenX = lower address (equivalent to Uniswap's token0)
 * - tokenY = higher address (equivalent to Uniswap's token1)
 * - Liquidity is distributed across discrete price bins instead of continuous ticks
 */

import { ethers } from "ethers";
import PlatformAdapter from "./PlatformAdapter.js";
import { getPlatformAddresses, getChainConfig } from "../helpers/chainHelpers.js";
import { getTokenBySymbol, getWethAddress, isNativeToken } from "../helpers/tokenHelpers.js";
import ERC20ARTIFACT from '@openzeppelin/contracts/build/contracts/ERC20.json' with { type: 'json' };

// Trader Joe V2.1 ABIs and addresses from official SDK
import {
  LBPairV21ABI,
  LBRouterV21ABI,
  LBQuoterV21ABI,
  LBFactoryV21ABI,
  LB_FACTORY_V21_ADDRESS,
  getUniformDistributionFromBinRange
} from "@traderjoe-xyz/sdk-v2";

const ERC20ABI = ERC20ARTIFACT.abi;

export default class TraderJoeV2_1Adapter extends PlatformAdapter {
  /**
   * Constructor for the Trader Joe V2.1 adapter
   * @param {number} chainId - Chain ID for the adapter
   * @param {Object} provider - Ethers provider instance
   */
  constructor(chainId, provider) {
    super(chainId, "traderjoeV2_1", "Trader Joe V2.1");

    // Cache platform addresses from chain config
    this.addresses = { ...getPlatformAddresses(chainId, "traderjoeV2_1") };
    this.chainConfig = getChainConfig(chainId);

    // Store ABIs from official SDK
    this.lbPairABI = LBPairV21ABI;
    this.lbRouterABI = LBRouterV21ABI;
    this.lbQuoterABI = LBQuoterV21ABI;
    this.lbFactoryABI = LBFactoryV21ABI;

    // ERC20 ABI and interface for approval checks
    this.erc20ABI = ERC20ABI;
    this.erc20Interface = new ethers.utils.Interface(this.erc20ABI);
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

  getSwapEventFilter(poolId) {
    throw new Error("TraderJoeV2_1Adapter.getSwapEventFilter not implemented");
  }

  parseSwapEvent(log) {
    throw new Error("TraderJoeV2_1Adapter.parseSwapEvent not implemented");
  }

  evaluatePriceMovement(swapData, baseline, token0Data, token1Data) {
    throw new Error("TraderJoeV2_1Adapter.evaluatePriceMovement not implemented");
  }

  async getPositionsForVDS(address, provider) {
    throw new Error("TraderJoeV2_1Adapter.getPositionsForVDS not implemented");
  }

  async getPositionById(tokenId, provider) {
    throw new Error("TraderJoeV2_1Adapter.getPositionById not implemented");
  }

  async getAccruedFeesUSD(position, tokenPrices, provider) {
    throw new Error("TraderJoeV2_1Adapter.getAccruedFeesUSD not implemented");
  }

  async generateClaimFeesData(params) {
    throw new Error("TraderJoeV2_1Adapter.generateClaimFeesData not implemented");
  }

  /**
   * Evaluate a position's range status relative to current pool state
   *
   * Determines if a Trader Joe V2.1 position is in range and calculates distance metrics.
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
   *   - currentTick: number - Current active bin ID (named for interface compatibility)
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
      currentTick: currentBinId // Named for interface compatibility with strategy code
    };
  }

  async calculateTokenAmounts(position, poolData, token0Data, token1Data) {
    throw new Error("TraderJoeV2_1Adapter.calculateTokenAmounts not implemented");
  }

  async generateRemoveLiquidityData(params) {
    throw new Error("TraderJoeV2_1Adapter.generateRemoveLiquidityData not implemented");
  }

  async generateAddLiquidityData(params) {
    throw new Error("TraderJoeV2_1Adapter.generateAddLiquidityData not implemented");
  }

  async getAddLiquidityAmounts(params) {
    throw new Error("TraderJoeV2_1Adapter.getAddLiquidityAmounts not implemented");
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
    // Formula from TJ SDK Bin.getIdSlippageFromPriceSlippage (not exported, so inline)
    const priceSlippage = slippageTolerance / 100;
    const idSlippage = Math.floor(
      Math.log(1 + priceSlippage) / Math.log(1 + poolData.binStep / 1e4)
    );

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

  async batchSwapTransactions(swapInstructions, options) {
    throw new Error("TraderJoeV2_1Adapter.batchSwapTransactions not implemented");
  }

  async parseClosureReceipt(receipt, positionMetadata, options = {}) {
    throw new Error("TraderJoeV2_1Adapter.parseClosureReceipt not implemented");
  }

  async parseCollectReceipt(receipt, positionMetadata, options = {}) {
    throw new Error("TraderJoeV2_1Adapter.parseCollectReceipt not implemented");
  }

  parseSwapReceipt(receipt, swapMetadata) {
    throw new Error("TraderJoeV2_1Adapter.parseSwapReceipt not implemented");
  }

  parseIncreaseLiquidityReceipt(receipt, { position, poolData }) {
    throw new Error("TraderJoeV2_1Adapter.parseIncreaseLiquidityReceipt not implemented");
  }

  async getBestSwapQuote(params) {
    throw new Error("TraderJoeV2_1Adapter.getBestSwapQuote not implemented");
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
    // Trader Joe V2.1 uses WETH (not native ETH), so convert ETH to WETH
    const resolveTokenData = (symbol) => {
      if (isNativeToken(symbol)) {
        // Convert native ETH to WETH for Trader Joe V2.1
        const wethAddress = getWethAddress(chainId);
        return {
          address: wethAddress,
          symbol: 'WETH',
          decimals: 18,
          isNative: false
        };
      }
      // Handle WETH specially - it's not in the base tokens config
      // but is derived from ETH's wethAddresses
      if (symbol === 'WETH') {
        const wethAddress = getWethAddress(chainId);
        return {
          address: wethAddress,
          symbol: 'WETH',
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
      throw new Error(`Trader Joe V2.1 not available on chain ${chainId}`);
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
        // 🔵 DEBUG: Pool query failed
        console.error(`🔵 DEBUG: Failed to query pool ${pairAddress}: ${error.message}`);
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
    const bestPool = {
      address: best.address,
      binStep: best.binStep,
      activeId: best.activeId,
      tokenX: {
        id: tokenX.address.toLowerCase(),
        symbol: tokenX.symbol,
        decimals: tokenX.decimals
      },
      tokenY: {
        id: tokenY.address.toLowerCase(),
        symbol: tokenY.symbol,
        decimals: tokenY.decimals
      },
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
   * Converts percentage-based range into bin IDs for Trader Joe V2.1 Liquidity Book.
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
   * Extract position bounds from an existing position object
   *
   * For Trader Joe V2.1, positions store bounds as lowerBinId and upperBinId.
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
   * For Trader Joe V2.1, the current pool state is represented by the active bin ID.
   * This is analogous to Uniswap's tick - it identifies where the current price sits.
   *
   * @param {Object} poolData - Pool data object from getPoolData
   * @param {number} poolData.activeId - Current active bin ID
   * @returns {number} Current active bin ID
   * @throws {Error} If poolData is invalid or missing activeId property
   */
  getPoolCurrent(poolData) {
    if (!poolData || poolData.activeId === undefined) {
      throw new Error('Pool data must have activeId property');
    }
    return poolData.activeId;
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
