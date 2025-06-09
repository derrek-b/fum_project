// fum_library/adapters/PlatformAdapter.js
/**
 * Base class for DeFi platform adapters.
 * Each platform (Uniswap V3, Sushiswap, etc.) should extend this class
 * and implement all required methods.
 */
export default class PlatformAdapter {
  /**
   * Constructor for the platform adapter
   * @param {Object} config - Configuration object
   * @param {Object} provider - Ethers provider
   * @param {string} platformId - Platform Id
   * @param {string} platformName - Platform Name
   */
  constructor(config, provider, platformId, platformName) {
    this.config = config;
    this.provider = provider;
    this.platformId = platformId;
    this.platformName = platformName;

    // Validation
    if (this.constructor === PlatformAdapter) {
      throw new Error("Abstract class cannot be instantiated");
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
   * @param {Object} token1 - Second token details
   * @param {number} fee - Fee tier
   * @returns {Promise<Object>} - Pool address and sorted tokens
   */
  async getPoolAddress(token0, token1, fee) {
    throw new Error("getPoolAddress must be implemented by subclasses");
  }

  /**
   * Get pool ABI
   * @returns {Object} - Pool ABI
   */
  async getPoolABI() {
    throw new Error("getPoolABI must be implemented by subclasses");
  }

  /**
   * Get position manager ABI
   * @returns {Object} - Position Manager ABI
   */
  getPositionManagerABI() {
    throw new Error("getPositionManagerABI must be implemented by subclasses");
  }

  /**
   * Check if a pool exists for the given tokens and fee tier
   * @param {Object} token0 - First token details
   * @param {Object} token1 - Second token details
   * @param {number} fee - Fee tier
   * @returns {Promise<{exists: boolean, poolAddress: string|null, slot0: Object|null}>}
   */
  async checkPoolExists(token0, token1, fee) {
    throw new Error("checkPoolExists must be implemented by subclasses");
  }

  /**
   * Get positions for the connected user
   * @param {string} address - User's wallet address
   * @param {number} chainId - Chain ID
   * @returns {Promise<Object>} - Object containing positions, poolData, and tokenData
   */
  async getPositions(address, chainId) {
    throw new Error("getPositions must be implemented by subclasses");
  }

  /**
   * Calculate uncollected fees for a position
   * @param {Object} position - Position object
   * @param {Object} poolData - Pool data
   * @param {Object} token0Data - Token0 data
   * @param {Object} token1Data - Token1 data
   * @returns {Promise<Object>} - Uncollected fees
   */
  async calculateFees(position, poolData, token0Data, token1Data) {
    throw new Error("calculateFees must be implemented by subclasses");
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
   * Calculate and format the price for a position
   * @param {Object} position - Position object
   * @param {Object} poolData - Pool data
   * @param {Object} token0Data - Token0 data
   * @param {Object} token1Data - Token1 data
   * @param {boolean} invert - Whether to invert the price
   * @returns {Object} - Formatted price information
   */
  calculatePrice(position, poolData, token0Data, token1Data, invert = false) {
    throw new Error("calculatePrice must be implemented by subclasses");
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
}
