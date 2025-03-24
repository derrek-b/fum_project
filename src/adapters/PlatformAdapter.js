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
 * @param {boolean} params.collectFees - Whether to collect fees as part of the transaction (default: true)
 * @returns {Promise<Object>} Transaction data object with `to`, `data`, `value` properties
 * @throws {Error} If parameters are invalid or transaction data cannot be generated
 */
  async generateRemoveLiquidityData(params) {
    throw new Error("generateRemoveLiquidityData must be implemented by subclasses");
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
   * @param {Function} params.dispatch - Redux dispatch function
   * @param {Function} params.onStart - Callback function called when transaction starts
   * @param {Function} params.onSuccess - Callback function called on successful transaction
   * @param {Function} params.onError - Callback function called on error
   * @param {Function} params.onFinish - Callback function called when process finishes
   * @returns {Promise<Object>} Transaction receipt and updated data
   */
  async decreaseLiquidity(params) {
    throw new Error("decreaseLiquidity must be implemented by subclasses");
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
 * @param {number} params.slippageTolerance - Slippage tolerance percentage
 * @param {Function} params.dispatch - Redux dispatch function
 * @param {Function} params.onStart - Callback function called when transaction starts
 * @param {Function} params.onSuccess - Callback function called on successful transaction
 * @param {Function} params.onError - Callback function called on error
 * @param {Function} params.onFinish - Callback function called when process finishes
 * @returns {Promise<Object>} Transaction receipt and updated data
 */
  async closePosition(params) {
    throw new Error("closePosition must be implemented by subclasses");
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
 * @returns {Promise<Object>} Transaction data object with `to`, `data`, `value` properties
 * @throws {Error} If parameters are invalid or transaction data cannot be generated
 */
  async generateAddLiquidityData(params) {
    throw new Error("generateAddLiquidityData must be implemented by subclasses");
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
   * @param {Function} params.dispatch - Redux dispatch function
   * @param {Function} params.onStart - Callback function called when transaction starts
   * @param {Function} params.onSuccess - Callback function called on successful transaction
   * @param {Function} params.onError - Callback function called on error
   * @param {Function} params.onFinish - Callback function called when process finishes
   * @returns {Promise<Object>} Transaction receipt and updated data
   */
  async addLiquidity(params) {
    throw new Error("addLiquidity must be implemented by subclasses");
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
 * @returns {Promise<Object>} Transaction data object with `to`, `data`, `value` properties
 * @throws {Error} If parameters are invalid or transaction data cannot be generated
 */
  async generateCreatePositionData(params) {
    throw new Error("generateCreatePositionData must be implemented by subclasses");
  }

  /**
   * Create a new liquidity position
   * @param {Object} params - Parameters for creating a new position
   * @param {string} params.platformId - Platform ID (e.g., 'uniswapV3')
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
   * @param {Function} params.dispatch - Redux dispatch function
   * @param {Function} params.onStart - Callback function called when transaction starts
   * @param {Function} params.onSuccess - Callback function called on successful transaction
   * @param {Function} params.onError - Callback function called on error
   * @param {Function} params.onFinish - Callback function called when process finishes
   * @returns {Promise<Object>} Transaction receipt and position data
   */
  async createPosition(params) {
    throw new Error("createPosition must be implemented by subclasses");
  }
}
