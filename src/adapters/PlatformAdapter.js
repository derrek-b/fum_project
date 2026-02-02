// fum_library/adapters/PlatformAdapter.js
/**
 * Base class for DeFi platform adapters.
 * Each platform (Uniswap V3, Sushiswap, etc.) should extend this class
 * and implement all required methods.
 *
 * =============================================================================
 * PLATFORM ADAPTER INTERFACE TRACKING
 * =============================================================================
 * This tracks which methods are confirmed as required interface methods vs
 * platform-specific helpers. Update as we build out the automation service.
 *
 * CONFIRMED INTERFACE METHODS (platform-agnostic, required for all adapters):
 * ----------------------------------------------------------------------------------
 * | Method                       | Used By                             | Status    |
 * |------------------------------|-------------------------------------|-----------|
 * | calculateTokenAmounts        | VDS.fetchAssetValues                | CONFIRMED |
 * | getPositionsForVDS           | VDS.fetchPositions                  | CONFIRMED |
 * | getPositionById              | Strategy.createNewPosition          | CONFIRMED |
 * | getRequiredApprovals         | Strategy.ensureApprovals            | CONFIRMED |
 * | getPoolData                  | VDS.fetchAssetValues                | CONFIRMED |
 * | selectBestPool               | Strategy.initializeVault            | CONFIRMED |
 * | getPoolCurrent               | Strategy.initializeVault            | CONFIRMED |
 * | parseClosureReceipt          | Strategy.closePositions             | CONFIRMED |
 * | parseCollectReceipt          | Strategy.collectFees                | CONFIRMED |
 * | generateRemoveLiquidityData  | Strategy.closePositions             | CONFIRMED |
 * | generateClaimFeesData        | Strategy.collectFees                | CONFIRMED |
 * | getAddLiquidityAmounts       | Strategy.addToPosition              | CONFIRMED |
 * | generateAddLiquidityData     | Strategy.addToPosition              | CONFIRMED |
 * | generateCreatePositionData   | Strategy.createNewPosition          | CONFIRMED |
 * | parseSwapReceipt             | Strategy.prepareTokens              | CONFIRMED |x??
 * | parseIncreaseLiquidityReceipt| Strategy.addToPosition              | CONFIRMED |
 * | getBestSwapQuote             | Strategy.prepareTokens              | CONFIRMED |
 * | extractPositionBounds        | Strategy event emission             | CONFIRMED |
 * | getPositionRange             | Strategy.createNewPosition          | CONFIRMED |
 * | evaluatePositionRange        | Strategy.evaluatePositions          | CONFIRMED |
 * | batchSwapTransactions        | Strategy.prepareTokens              | CONFIRMED |
 * | getSwapEventFilter           | EventManager.subscribeToSwapEvents  | CONFIRMED |x
 * | parseSwapEvent               | Strategy.handleSwapEvent            | CONFIRMED |x
 * | evaluatePriceMovement        | Strategy.handleSwapEvent            | CONFIRMED |
 * | getAccruedFeesUSD            | Strategy.handleSwapEvent            | CONFIRMED |
 * | sortTokens                   | Strategy pool token ordering        | CONFIRMED |
 * =============================================================================
 */
export default class PlatformAdapter {
  /**
   * Constructor for the platform adapter
   * @param {number} chainId - Chain ID for the adapter
   * @param {string} platformId - Platform Id
   * @param {string} platformName - Platform Name
   */
  constructor(chainId, platformId, platformName) {
    this.chainId = chainId;
    this.platformId = platformId;
    this.platformName = platformName;

    // Validation
    if (this.constructor === PlatformAdapter) {
      throw new Error("Abstract class cannot be instantiated");
    }

    if (!chainId || typeof chainId !== 'number') {
      throw new Error("chainId must be a valid number");
    }

    if (!this.platformId) {
      throw new Error("platformId must be defined");
    }

    if (!this.platformName) {
      throw new Error("platformName must be defined");
    }
  }

  /**
   * Get the event filter for monitoring swap events on this platform
   *
   * Returns a filter object compatible with ethers provider.on() for listening
   * to swap events. The filter structure varies by platform:
   * - V3: Filter by individual pool contract address
   * - V4: Filter by PoolManager address + PoolId topic
   *
   * @param {string} poolId - Pool identifier (address for V3, PoolId for V4)
   * @returns {Object} Filter object with address and topics array
   *   - address: Contract address to monitor
   *   - topics: Array of topic filters for the event
   * @throws {Error} If poolId is invalid
   */
  getSwapEventFilter(poolId) {
    throw new Error("getSwapEventFilter must be implemented by subclasses");
  }

  /**
   * Parse a swap event log from the blockchain
   *
   * Extracts key data from a platform-specific swap event log, returning
   * normalized data that can be used for position evaluation and decision making.
   *
   * @param {Object} log - Raw blockchain event log
   * @param {string} log.address - Contract address that emitted the event
   * @param {Array<string>} log.topics - Array of indexed event topics
   * @param {string} log.data - ABI-encoded non-indexed event data
   * @returns {Object} Parsed swap event data
   * @returns {number} result.tick - Current tick after the swap (for tick-based AMMs)
   * @returns {string} result.sqrtPriceX96 - Square root price in Q64.96 format (string)
   * @returns {string} result.liquidity - Pool liquidity at time of swap (string)
   * @returns {string} result.amount0 - Amount of token0 swapped (signed, string)
   * @returns {string} result.amount1 - Amount of token1 swapped (signed, string)
   * @throws {Error} If log is invalid or cannot be parsed
   */
  parseSwapEvent(log) {
    throw new Error("parseSwapEvent must be implemented by subclasses");
  }

  /**
   * Evaluate price movement between current swap state and a baseline
   *
   * Compares the current pool state (from swap event) against a stored baseline
   * to calculate the percentage price movement. Used for emergency exit evaluation.
   *
   * @param {Object} swapData - Parsed swap event data from parseSwapEvent()
   * @param {number|string} baseline - Baseline state value (tick for V3, price for others)
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
    throw new Error("evaluatePriceMovement must be implemented by subclasses");
  }

  /**
   * Get positions formatted for VaultDataService
   * @param {string} address - Vault address
   * @param {Object} provider - Ethers provider instance
   * @returns {Promise<{positions: Object, poolData: Object}>} Normalized position data and pool data
   */
  async getPositionsForVDS(address, provider) {
    throw new Error("getPositionsForVDS must be implemented by subclasses");
  }

  /**
   * Fetch a single position by tokenId directly from on-chain (no Graph dependency)
   *
   * Used after creating/modifying positions when we have the tokenId from the receipt
   * but The Graph hasn't indexed it yet. Returns both position and poolData for
   * cache updates.
   *
   * @param {string|number} tokenId - The position NFT token ID
   * @param {Object} provider - Ethers provider instance
   * @returns {Promise<{position: Object, poolData: Object}>} Position and pool metadata
   * @returns {Object} result.position - Position data matching getPositionsForVDS format
   * @returns {string} result.position.id - Token ID as string
   * @returns {string} result.position.pool - Pool identifier (address for V3, bytes32 for V4)
   * @returns {number} result.position.tickLower - Lower tick bound
   * @returns {number} result.position.tickUpper - Upper tick bound
   * @returns {string} result.position.liquidity - Position liquidity (wei string)
   * @returns {string} result.position.feeGrowthInside0LastX128 - Fee growth tracker
   * @returns {string} result.position.feeGrowthInside1LastX128 - Fee growth tracker
   * @returns {string} result.position.tokensOwed0 - Uncollected token0 fees
   * @returns {string} result.position.tokensOwed1 - Uncollected token1 fees
   * @returns {number} result.position.lastUpdated - Timestamp of fetch
   * @returns {Object} result.poolData - Pool metadata keyed by pool identifier
   * @throws {Error} If tokenId is invalid, position not found, or has been burned
   */
  async getPositionById(tokenId, provider) {
    throw new Error("getPositionById must be implemented by subclasses");
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
    throw new Error("getAccruedFeesUSD must be implemented by subclasses");
  }

  /**
   * Generate transaction data for claiming fees from a position
   * @param {Object} params - Parameters for generating claim fees data
   * @returns {Promise<Object>} Transaction data object with `to`, `data`, `value` properties
   * @throws {Error} If parameters are invalid or transaction data cannot be generated
   */
  async generateClaimFeesData(params) {
    throw new Error("generateClaimFeesData must be implemented by subclasses");
  }

  /**
   * Evaluate a position's range status relative to current pool state
   *
   * Determines if a position is in range and calculates distance metrics.
   * For tick-based AMMs, this checks currentTick against tickLower/tickUpper.
   *
   * Can be called in two modes:
   * 1. Without swapData: fetches current state from blockchain via provider (async)
   * 2. With options.swapData: extracts state from parsed swap event (no RPC call)
   *
   * @param {Object} position - Position object with range bounds
   * @param {number} position.tickLower - Lower tick bound (for tick-based AMMs)
   * @param {number} position.tickUpper - Upper tick bound (for tick-based AMMs)
   * @param {string} position.pool - Pool address (required if fetching from blockchain)
   * @param {Object} provider - Ethers provider instance (can be null if swapData provided)
   * @param {Object} [options] - Optional parameters
   * @param {Object} [options.swapData] - Parsed swap event data (skips RPC if provided)
   * @returns {Promise<Object>} Range evaluation result
   * @returns {boolean} result.inRange - Is position currently active/earning fees
   * @returns {number} result.centeredness - Position in range (0-1, 0.5 = centered)
   * @returns {number} result.distanceToUpper - Distance to upper bound as fraction
   * @returns {number} result.distanceToLower - Distance to lower bound as fraction
   * @returns {number} result.currentTick - Current pool tick value
   */
  async evaluatePositionRange(position, provider, options = {}) {
    throw new Error("evaluatePositionRange must be implemented by subclasses");
  }

  /**
   * Calculate token amounts for a position (if it were to be closed)
   * @param {Object} position - Position object
   * @param {Object} poolData - Pool data
   * @param {Object} token0Data - Token0 data
   * @param {Object} token1Data - Token1 data
   * @param {Object} [provider] - Ethers provider (required for some adapters, e.g. TJ V2.1)
   * @returns {Promise<[BigInt, BigInt]>} [amount0, amount1]
   */
  async calculateTokenAmounts(position, poolData, token0Data, token1Data, provider) {
    throw new Error("calculateTokenAmounts must be implemented by subclasses");
  }

  /**
   * Generate transaction data for removing liquidity from a position
   * @param {Object} params - Parameters for generating remove liquidity data
   * @returns {Promise<Object>} Transaction data object with `to`, `data`, `value` properties
   * @throws {Error} If parameters are invalid or transaction data cannot be generated
   */
  async generateRemoveLiquidityData(params) {
    throw new Error("generateRemoveLiquidityData must be implemented by subclasses");
  }



  /**
   * Generate transaction data for adding liquidity to an existing position
   * @param {Object} params - Parameters for generating add liquidity data
   * @returns {Promise<Object>} Transaction data object with `to`, `data`, `value` properties
   * @throws {Error} If parameters are invalid or transaction data cannot be generated
   */
  async generateAddLiquidityData(params) {
    throw new Error("generateAddLiquidityData must be implemented by subclasses");
  }

  /**
   * Get the token amounts required to add liquidity to a position
   *
   * Returns amounts in the CALLER's token order (not SDK-sorted order).
   * Each platform implements this using their native calculation method.
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
    throw new Error("getAddLiquidityAmounts must be implemented by subclasses");
  }


  /**
   * Generate transaction data for creating a new position
   * @param {Object} params - Parameters for generating create position data
   * @returns {Promise<Object>} Transaction data object with `to`, `data`, `value` properties
   * @throws {Error} If parameters are invalid or transaction data cannot be generated
   */
  async generateCreatePositionData(params) {
    throw new Error("generateCreatePositionData must be implemented by subclasses");
  }

  /**
   * Generate batched swap transactions with platform-specific auth handling
   *
   * Creates multiple swap transactions in a batch, handling platform-specific
   * requirements like Permit2 nonce tracking across swaps with the same input token.
   *
   * @param {Array<Object>} swapInstructions - Array of swap instructions
   * @param {Object} swapInstructions[].tokenIn - Input token { address, symbol, decimals, isNative? }
   * @param {Object} swapInstructions[].tokenOut - Output token { address, symbol, decimals, isNative? }
   * @param {string} swapInstructions[].amount - Amount to swap (raw wei string)
   * @param {boolean} swapInstructions[].isAmountIn - true for EXACT_INPUT, false for EXACT_OUTPUT
   * @param {Object} options - Common options for all swaps
   * @param {Object} options.signer - Ethers Wallet for signing (required for Permit2)
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
    throw new Error("batchSwapTransactions must be implemented by subclasses");
  }

  /**
   * Parse position closure receipt to extract principal and fees
   *
   * When positions are closed (decreaseLiquidity + collect), this method parses
   * the transaction receipt to extract:
   * - Principal amounts (from DecreaseLiquidity events or equivalent)
   * - Fee amounts (Collect amounts minus principal)
   *
   * @param {Object} receipt - Transaction receipt from closing positions
   * @param {Object} positionMetadata - Metadata for closed positions
   *   { [tokenId]: { position, poolMetadata, token0Data, token1Data, adapter } }
   * @param {Object} [options] - Optional settings (platform-specific)
   * @param {number} [options.chainId] - Chain ID for block explorer (V4 native ETH tracking)
   * @param {string} [options.walletAddress] - Wallet address for ETH tracking
   * @returns {Promise<Object>} Parsed closure data
   *   { principalByPosition: { [tokenId]: { amount0, amount1 } },
   *     feesByPosition: { [tokenId]: { token0, token1, metadata } } }
   */
  async parseClosureReceipt(receipt, positionMetadata, options = {}) {
    throw new Error("parseClosureReceipt must be implemented by subclasses");
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
   * @param {Object} [options] - Optional settings (platform-specific)
   * @param {number} [options.chainId] - Chain ID for block explorer (V4 native ETH tracking)
   * @param {string} [options.walletAddress] - Wallet address for ETH tracking
   * @returns {Promise<Object>} Parsed fee data
   *   { feesByPosition: { [tokenId]: { token0: BigNumber, token1: BigNumber, metadata } } }
   */
  async parseCollectReceipt(receipt, positionMetadata, options = {}) {
    throw new Error("parseCollectReceipt must be implemented by subclasses");
  }

  /**
   * Parse swap transaction receipt to extract actual swap amounts
   *
   * When swaps are executed, this method parses the transaction receipt to extract
   * the actual amounts swapped from platform-specific Swap events.
   *
   * @param {Object} receipt - Transaction receipt from swap execution
   * @param {Object} receipt.logs - Array of transaction logs
   * @param {Array} swapMetadata - Array of swap metadata in execution order
   * @param {string} swapMetadata[].tokenInAddress - Input token address
   * @param {string} swapMetadata[].tokenOutAddress - Output token address
   * @param {number} [swapMetadata[].expectedSwapEvents=1] - Number of swap events for this swap
   * @param {Array} [swapMetadata[].routes] - Multi-hop route info for split routes
   * @returns {Array<{actualAmountIn: string, actualAmountOut: string}>} Actual amounts per swap
   * @throws {Error} If receipt or swapMetadata is null/undefined
   */
  parseSwapReceipt(receipt, swapMetadata) {
    throw new Error("parseSwapReceipt must be implemented by subclasses");
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
   * @param {Object} context - Platform-specific context for parsing
   * @param {Object} context.position - Position object with tick bounds
   * @param {Object} context.poolData - Pool data with current price (sqrtPriceX96)
   * @returns {Object} Parsed position data
   * @returns {string} result.tokenId - Position NFT token ID
   * @returns {string} result.liquidity - Liquidity added
   * @returns {string} result.amount0 - Actual token0 amount consumed
   * @returns {string} result.amount1 - Actual token1 amount consumed
   * @returns {number|null} result.tickLower - Lower tick (only for new positions)
   * @returns {number|null} result.tickUpper - Upper tick (only for new positions)
   * @returns {string|null} result.poolAddress - Pool address/ID (only for new positions)
   * @throws {Error} If receipt is null/undefined or liquidity event not found
   */
  parseIncreaseLiquidityReceipt(receipt, { position, poolData }) {
    throw new Error("parseIncreaseLiquidityReceipt must be implemented by subclasses");
  }

  /**
   * Get best swap quote using platform's routing mechanism
   *
   * @param {Object} params - Parameters for getting best swap quote
   * @param {string} [params.tokenInAddress] - Address of input token (not required if tokenInIsNative=true)
   * @param {string} [params.tokenOutAddress] - Address of output token (not required if tokenOutIsNative=true)
   * @param {string} params.amount - Amount to trade (interpretation depends on isAmountIn)
   * @param {boolean} params.isAmountIn - True if amount is input (EXACT_INPUT), false if amount is output (EXACT_OUTPUT)
   * @param {boolean} [params.tokenInIsNative=false] - True if input token is native ETH
   * @param {boolean} [params.tokenOutIsNative=false] - True if output token is native ETH
   * @returns {Promise<Object>} Quote with { amountIn: string, amountOut: string, route: Object, methodParameters?: Object }
   * @throws {Error} If no valid route can be found
   */
  async getBestSwapQuote(params) {
    throw new Error("getBestSwapQuote must be implemented by subclasses");
  }

  /**
   * Get required approval transactions for a given operation type
   *
   * Returns an array of transaction objects that must be executed to grant
   * sufficient token approvals for the specified operation. Each platform
   * handles approvals differently:
   * - V3 Swaps: ERC20 approve to Permit2
   * - V3 Liquidity: ERC20 approve to NonfungiblePositionManager
   * - V4 Swaps: ERC20 approve to Permit2
   * - V4 Liquidity: ERC20 approve to Permit2 + Permit2 allowance to PositionManager
   *
   * The method checks current allowances and only returns transactions for
   * approvals that are actually needed.
   *
   * @param {string} operationType - Operation type: 'swap' or 'liquidity'
   * @param {string} vaultAddress - Address of the vault that needs approvals
   * @param {Array<string>} tokenAddresses - Array of token addresses to approve
   * @param {Object} provider - Ethers provider for checking current allowances
   * @returns {Promise<Array<Object>>} Array of transaction objects { to, data, value }
   * @example
   * // Get approval transactions for V4 liquidity operation
   * const approvalTxs = await adapter.getRequiredApprovals(
   *   'liquidity',
   *   vault.address,
   *   [token0.address, token1.address],
   *   provider
   * );
   *
   * // Execute each approval transaction
   * for (const tx of approvalTxs) {
   *   await executeVaultTransaction(vault, tx);
   * }
   */
  async getRequiredApprovals(operationType, vaultAddress, tokenAddresses, provider) {
    throw new Error("getRequiredApprovals must be implemented by subclasses");
  }

  /**
   * Sort tokens into the platform's canonical ordering for pool operations
   *
   * Most platforms order tokens by address (lower address = token0), but
   * implementations may vary. All adapters must implement this to ensure
   * consistent token ordering when interacting with pools.
   *
   * @param {Object} token0 - First token data object
   * @param {string} token0.address - Token contract address
   * @param {string} token0.symbol - Token symbol
   * @param {Object} token1 - Second token data object
   * @param {string} token1.address - Token contract address
   * @param {string} token1.symbol - Token symbol
   * @returns {{sortedToken0: Object, sortedToken1: Object, tokensSwapped: boolean}}
   *          Sorted tokens and flag indicating if order was swapped
   * @throws {Error} If token addresses are missing or invalid
   */
  sortTokens(token0, token1) {
    throw new Error("sortTokens must be implemented by subclasses");
  }

  /**
   * Select the best pool for a token pair
   * Discovers pools, filters inactive ones, sorts by depth, returns best
   *
   * @param {string} tokenASymbol - First token symbol (order doesn't matter)
   * @param {string} tokenBSymbol - Second token symbol
   * @param {Object} provider - Ethers provider instance
   * @param {number} chainId - Chain ID for address lookups
   * @returns {Promise<Object>} Selection result
   * @returns {Object} result.bestPool - Best pool object (platform-specific structure)
   * @returns {number} result.poolsDiscovered - Total pools found
   * @returns {number} result.poolsActive - Pools with non-zero depth
   * @throws {Error} If no pools or no active pools found
   */
  async selectBestPool(tokenASymbol, tokenBSymbol, provider, chainId) {
    throw new Error("selectBestPool must be implemented by subclasses");
  }

  /**
   * Calculate position range bounds from percentage parameters
   *
   * Returns a position object with platform-specific range properties that can be
   * passed directly to other adapter methods (getAddLiquidityAmounts, generateCreatePositionData).
   *
   * @param {Object} poolData - Pool data object containing current state
   * @param {number} upperPercent - Upper range in percentage (e.g., 5 for +5%)
   * @param {number} lowerPercent - Lower range in percentage (e.g., 5 for -5%)
   * @returns {Object} Position range object with platform-specific properties
   *   - For Uniswap V3: { tickLower, tickUpper, currentTick }
   * @throws {Error} If parameters are invalid
   */
  getPositionRange(poolData, upperPercent, lowerPercent) {
    throw new Error("getPositionRange must be implemented by subclasses");
  }

  /**
   * Extract position bounds from an existing position object
   *
   * Takes a cached position object and returns bounds in a platform-agnostic format.
   * Used for event emission where we need generic field names regardless of platform.
   *
   * @param {Object} position - Position object from vault cache
   * @returns {Object} Position bounds { lower, upper } as numbers
   *   - lower: Lower bound of the position range
   *   - upper: Upper bound of the position range
   * @throws {Error} If position is invalid or missing required properties
   */
  extractPositionBounds(position) {
    throw new Error("extractPositionBounds must be implemented by subclasses");
  }

  /**
   * Get current pool state value for baseline tracking
   *
   * Returns platform-specific value representing current pool state.
   * Used for emergency exit baseline capture.
   *
   * @param {Object} poolData - Pool data object from getPoolData or similar
   * @returns {number} Current state value (tick for V3, price for others)
   * @throws {Error} If poolData is invalid or missing required state property
   */
  getPoolCurrent(poolData) {
    throw new Error("getPoolCurrent must be implemented by subclasses");
  }

  /**
   * Get pool data by pool identifier
   *
   * Returns core pool state needed for position management and price calculations.
   * For V3: poolId is the pool contract address
   * For V4: poolId is the bytes32 PoolId hash
   *
   * @param {string} poolId - Pool identifier (address for V3, bytes32 for V4)
   * @param {Object} provider - Ethers provider instance
   * @returns {Promise<Object>} Pool data object with core state
   * @throws {Error} If parameters are invalid or pool data cannot be retrieved
   * @example
   * // V3: Pass pool contract address
   * const poolData = await adapter.getPoolData('0x8ad599c3...', provider);
   *
   * // V4: Pass poolId (bytes32 hash)
   * const poolData = await adapter.getPoolData('0xabcd1234...', provider);
   *
   * // Common return fields:
   * // - address: Pool identifier (address for V3, poolId for V4)
   * // - sqrtPriceX96: Current price as sqrt ratio
   * // - tick: Current tick
   * // - liquidity: Active liquidity in range
   * // - fee: Fee tier in basis points
   * // - feeGrowthGlobal0X128, feeGrowthGlobal1X128: Fee accumulators
   * // - lastUpdated: Timestamp of data fetch
   */
  async getPoolData(poolId, provider) {
    throw new Error("getPoolData must be implemented by subclasses");
  }
}
