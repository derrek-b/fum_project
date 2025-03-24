// src/adapters/PlatformAdapter.js
/**
 * Base class for platform adapters.
 * Each platform (Uniswap V3, Sushiswap, etc.) should extend this class.
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


  getPoolAddress(token0Address, token1Address, fee, token0Decimals, token1Decimals) {
    throw new Error("getPoolAddress must be implemented by subclasses");
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
}
