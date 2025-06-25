// fum_library/adapters/PlatformAdapter.js
/**
 * Base class for DeFi platform adapters.
 * Each platform (Uniswap V3, Sushiswap, etc.) should extend this class
 * and implement all required methods.
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
   * Get pool address for tokens and fee
   * @param {Object} token0 - First token details
   * @param {string} token0.address - Token contract address
   * @param {number} token0.decimals - Token decimals
   * @param {string} token0.symbol - Token symbol
   * @param {string} token0.name - Token name
   * @param {Object} token1 - Second token details
   * @param {string} token1.address - Token contract address
   * @param {number} token1.decimals - Token decimals
   * @param {string} token1.symbol - Token symbol
   * @param {string} token1.name - Token name
   * @param {number} fee - Fee tier
   * @returns {Promise<{poolAddress: string, token0: Object, token1: Object}>} Pool information (incl. sorted tokens)
   */
  async getPoolAddress(token0, token1, fee) {
    throw new Error("getPoolAddress must be implemented by subclasses");
  }

  /**
   * Get pool ABI
   * @returns {Array} - Pool ABI
   */
  async getPoolABI() {
    throw new Error("getPoolABI must be implemented by subclasses");
  }

  /**
   * Get position manager ABI
   * @returns {Array} - Position Manager ABI
   */
  getPositionManagerABI() {
    throw new Error("getPositionManagerABI must be implemented by subclasses");
  }

  /**
   * Check if a pool exists for the given tokens and fee tier
   * @param {Object} token0 - First token details
   * @param {string} token0.address - Token contract address
   * @param {number} token0.decimals - Token decimals
   * @param {Object} token1 - Second token details
   * @param {string} token1.address - Token contract address
   * @param {number} token1.decimals - Token decimals
   * @param {number} fee - Fee tier
   * @returns {Promise<{exists: boolean, poolAddress: string|null, slot0: Object|null}>} Pool existence check result
   */
  async checkPoolExists(token0, token1, fee) {
    throw new Error("checkPoolExists must be implemented by subclasses");
  }

  /**
   * Get positions for the connected user
   * @param {string} address - User's wallet address
   * @param {number} chainId - Chain ID
   * @returns {Promise<{positions: Array, poolData: Object, tokenData: Object}>} Position data
   */
  async getPositions(address, chainId) {
    throw new Error("getPositions must be implemented by subclasses");
  }

  /**
   * Calculate uncollected fees for a position
   * @param {Object} position - Position object with liquidity and fee growth data
   * @param {Object} poolData - Current pool state including fee growth globals and tick data
   * @param {number} token0Decimals - Token0 decimals for formatting
   * @param {number} token1Decimals - Token1 decimals for formatting
   * @returns {{token0: {raw: bigint, formatted: string}, token1: {raw: bigint, formatted: string}}} Uncollected fees
   */
  calculateUncollectedFees(position, poolData, token0Decimals, token1Decimals) {
    throw new Error("calculateUncollectedFees must be implemented by subclasses");
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
   * Claim fees for a position
   * @param {Object} params - Parameters for claiming fees
   * @returns {Promise<Object>} - Transaction receipt
   */
  async claimFees(params) {
    throw new Error("claimFees must be implemented by subclasses");
  }

  /**
   * Check if a position is in range (active)
   * @param {Object} position - Position object
   * @param {Object} poolData - Pool data
   * @returns {boolean} - Whether the position is in range
   */
  isPositionInRange(position, poolData) {
    throw new Error("isPositionInRange must be implemented by subclasses");
  }

  /**
   * Calculate price from sqrtPriceX96
   * @param {string} sqrtPriceX96 - Square root price in X96 format
   * @param {Object} baseToken - Base token metadata
   * @param {Object} quoteToken - Quote token metadata
   * @param {number} chainId - Chain ID
   * @returns {string} Formatted price
   */
  calculatePriceFromSqrtPrice(sqrtPriceX96, baseToken, quoteToken, chainId) {
    throw new Error("calculatePriceFromSqrtPrice must be implemented by subclasses");
  }

  /**
   * Convert a tick value to a corresponding price
   * @param {number} tick - The tick value
   * @param {Object} baseToken - Base token metadata
   * @param {Object} quoteToken - Quote token metadata
   * @param {number} chainId - Chain ID
   * @returns {string} The formatted price corresponding to the tick
   */
  tickToPrice(tick, baseToken, quoteToken, chainId) {
    throw new Error("tickToPrice must be implemented by subclasses");
  }

  /**
   * Calculate token amounts for a position (if it were to be closed)
   * @param {Object} position - Position object
   * @param {Object} poolData - Pool data
   * @param {Object} token0Data - Token0 data
   * @param {Object} token1Data - Token1 data
   * @param {number} chainId - Chain ID from the wallet
   * @returns {Promise<Object>} - Token amounts
   */
  async calculateTokenAmounts(position, poolData, token0Data, token1Data, chainId) {
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
   * Remove liquidity from a position and collect fees
   * @param {Object} params - Parameters for removing liquidity
   * @returns {Promise<Object>} Transaction receipt and updated data
   */
  async decreaseLiquidity(params) {
    throw new Error("decreaseLiquidity must be implemented by subclasses");
  }

  /**
   * Close a position completely by removing all liquidity and optionally burning the NFT
   * @param {Object} params - Parameters for closing position
   * @returns {Promise<Object>} Transaction receipt and updated data
   */
  async closePosition(params) {
    throw new Error("closePosition must be implemented by subclasses");
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
   * Add liquidity to an existing position
   * @param {Object} params - Parameters for adding liquidity
   * @returns {Promise<Object>} Transaction receipt and updated data
   */
  async addLiquidity(params) {
    throw new Error("addLiquidity must be implemented by subclasses");
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
   * Create a new liquidity position
   * @param {Object} params - Parameters for creating a new position
   * @returns {Promise<Object>} Transaction receipt and position data
   */
  async createPosition(params) {
    throw new Error("createPosition must be implemented by subclasses");
  }

  /**
   * Generate swap transaction data
   * @param {Object} params - Swap parameters
   * @returns {Promise<Object>} Transaction data with to, data, and value
   */
  async generateSwapData(params) {
    throw new Error("generateSwapData must be implemented by subclasses");
  }

  /**
   * Discover available pools for a token pair across all fee tiers
   * @param {string} token0Address - Address of first token
   * @param {string} token1Address - Address of second token
   * @param {number} chainId - Chain ID
   * @returns {Promise<Array>} Array of pool information objects with { address, fee, liquidity, sqrtPriceX96, tick }
   */
  async discoverAvailablePools(token0Address, token1Address, chainId) {
    throw new Error("discoverAvailablePools must be implemented by subclasses");
  }
}
