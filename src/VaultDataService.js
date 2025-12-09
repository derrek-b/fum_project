/**
 * @module VaultDataService
 * @description Service for loading and managing vault data in the automation service.
 * Centralizes vault data loading, caching, and access to prevent fragmented data fetching.
 * This service enhances position data by loading from blockchain, parsing token pairs,
 * looking up token configurations, and storing enhanced positions with complete token information.
 * @since 1.0.0
 */

// src/VaultDataService.js

import { ethers } from 'ethers';
import { fetchTokenPrices, CACHE_DURATIONS } from 'fum_library/services/coingecko';
import { retryWithBackoff } from './RetryHelper.js';
import {
  getChainConfig,
  getVaultContract,
  getVaultInfo,
  getContract,
  getContractInfoByAddress,
  getStrategyDetails,
  mapStrategyParameters,
  getTokenAddress,
  getAllTokenSymbols,
  AdapterFactory
} from 'fum_library';
import ERC20ARTIFACT from '@openzeppelin/contracts/build/contracts/ERC20.json' with { type: 'json' };
const ERC20ABI = ERC20ARTIFACT.abi;

/**
 * @class VaultDataService
 * @memberof module:VaultDataService
 * @description Service for loading and managing vault data in the automation service.
 * Centralizes vault data loading, caching, and access to prevent fragmented data fetching.
 * This service enhances position data by:
 * - Loading position data from the blockchain
 * - Parsing tokenPair strings to identify tokens (e.g., "USDC/WETH")
 * - Looking up token configuration data (addresses, decimals, etc.)
 * - Creating token0/token1 objects with complete token information
 * - Storing enhanced positions in vault.positions objects for strategies to use
 * @since 1.0.0
 */
class VaultDataService {
  /**
   * Creates a new VaultDataService instance
   * @memberof module:VaultDataService.VaultDataService
   * @param {EventManager} eventManager - Event manager instance for emitting events
   * @since 1.0.0
   */
  constructor(eventManager) {
    this.vaults = new Map(); // Map of vault address to vault data
    this.eventManager = eventManager;
    this.provider = null;
    this.chainId = null;
    this.lastRefreshTime = null;
    this.adapters = null; // Will be set by AutomationService after adapter initialization
    this.poolData = null; // Will be set by AutomationService after poolData initialization
  }

  //#region Initialization Methods
  /**
   * Initialize the data service
   * @memberof module:VaultDataService.VaultDataService
   * @param {ethers.Provider} provider - Ethers provider instance
   * @param {number} chainId - Chain ID for the network
   * @since 1.0.0
   */
  initialize(provider, chainId) {
    this.provider = provider;
    this.chainId = chainId;
    this.eventManager.emit('initialized', { chainId });
  }

  /**
   * Set the tokens configuration reference from AutomationService
   * @memberof module:VaultDataService.VaultDataService
   * @param {Object} tokens - Token configurations from AutomationService
   * @since 1.0.0
   */
  setTokens(tokens) {
    this.tokens = tokens;
  }

  /**
   * Set the adapter cache reference from AutomationService
   * @memberof module:VaultDataService.VaultDataService
   * @param {Map} adapters - Map of platform adapters from AutomationService
   * @since 1.0.0
   */
  setAdapters(adapters) {
    this.adapters = adapters;
  }

  /**
   * Set the pool data cache reference from AutomationService
   * @memberof module:VaultDataService.VaultDataService
   * @param {Object} poolData - Pool data object from AutomationService
   * @since 1.0.0
   */
  setPoolData(poolData) {
    this.poolData = poolData;
  }
  //#endregion

  //#region Vault Loading
  /**
   * Get vault data if it's cached, or load it if not
   * @memberof module:VaultDataService.VaultDataService
   * @param {string} vaultAddress - Vault address to retrieve
   * @param {boolean} [forceRefresh=false] - Force refresh even if cached data exists
   * @returns {Promise<Object>} Vault data object
   * @since 1.0.0
   */
  async getVault(vaultAddress, forceRefresh = false) {
    const normalizedAddress = ethers.utils.getAddress(vaultAddress);

    // Return cached vault if available and not forcing refresh
    if (!forceRefresh && this.vaults.has(normalizedAddress)) {
      return this.vaults.get(normalizedAddress);
    }

    // Otherwise load it
    return this.loadVaultData(normalizedAddress);
  }

  /**
   * Load vault data from blockchain with retry logic
   * @memberof module:VaultDataService.VaultDataService
   * @param {string} vaultAddress - The vault address
   * @returns {Promise<Object>} Vault data object
   * @since 1.0.0
   */
  async loadVaultData(vaultAddress) {
    const normalizedAddress = ethers.utils.getAddress(vaultAddress);

    return await retryWithBackoff(
      () => this._loadVaultDataInternal(normalizedAddress),
      {
        maxRetries: 3,
        baseDelay: 1000,
        exponential: true,
        context: `Loading vault data for ${normalizedAddress}`,
        logger: console,
        onRetry: (attempt, error) => {
          console.warn(`Retry ${attempt}/3 for vault ${normalizedAddress}: ${error.message}`);
          this.eventManager.emit('vaultLoadRetrying', { vaultAddress: normalizedAddress, attempt, error: error.message });
        }
      }
    );
  }

  /**
   * Internal vault data loading implementation
   * @memberof module:VaultDataService.VaultDataService
   * @param {string} normalizedAddress - The normalized vault address
   * @returns {Promise<Object>} Vault data object
   * @private
   * @since 1.0.0
   */
  async _loadVaultDataInternal(normalizedAddress) {
    this.ensureInitialized();

    this.eventManager.emit('vaultLoading', normalizedAddress);

    try {
      console.log(`Loading vault data for ${normalizedAddress}`);

      // 1. Get vault contract
      const vaultContract = getVaultContract(normalizedAddress, this.provider);

      // 2. Parallel data fetching for basic vault info
      const [
        vaultInfo,
        strategyAddress,
        targetTokens,
        targetPlatforms
      ] = await Promise.all([
        getVaultInfo(normalizedAddress, this.provider),
        vaultContract.strategy(),
        vaultContract.getTargetTokens(),
        vaultContract.getTargetPlatforms()
      ]);

      // 3. Validate strategy is set
      if (!strategyAddress || strategyAddress === ethers.constants.AddressZero) {
        throw new Error(`Vault ${normalizedAddress} has no strategy set. Automation requires a strategy to be configured.`);
      }

      // 4. Get strategy details
      let strategyData = null;
      try {
        const contractInfo = getContractInfoByAddress(strategyAddress);

        // Fetch strategy parameters from contract
        const strategyContract = await getContract(contractInfo.contractName, this.provider);
        const rawParams = await strategyContract.getAllParameters(normalizedAddress);
        const mappedParams = mapStrategyParameters(contractInfo.contractName, rawParams);

        strategyData = {
          strategyId: contractInfo.contractName,
          strategyAddress: strategyAddress,
          parameters: mappedParams
        };
      } catch (error) {
        // Strategy is required for vault management - propagate the error with context
        throw new Error(`Failed to load strategy data for vault ${normalizedAddress} (strategy: ${strategyAddress}): ${error.message}`);
      }

      // 4. Get token balances and positions in parallel
      const [tokenBalances, positions] = await Promise.all([
        this.fetchTokenBalances(normalizedAddress, getAllTokenSymbols()),
        this.fetchPositions(vaultContract.address)
      ]);

      // 5. Assemble vault data
      const vault = this.assembleVaultData({
        address: normalizedAddress,
        owner: vaultInfo.owner,
        chainId: this.chainId,
        strategyAddress: strategyAddress,
        strategy: strategyData,
        targetTokens: targetTokens,
        targetPlatforms: targetPlatforms,
        tokens: tokenBalances,
        positions: positions
      });

      // Cache the vault
      this.vaults.set(normalizedAddress, vault);
      console.log(`Loaded and cached vault ${normalizedAddress} with ${Object.keys(vault.positions).length} positions`);

      this.eventManager.emit('vaultLoaded', {
        vaultAddress: normalizedAddress,
        positionCount: Object.keys(positions).length,
        positionIds: Object.keys(positions),
        tokenCount: Object.keys(tokenBalances).length,
        strategyId: strategyData.strategyId,
        targetTokens: targetTokens,
        targetPlatforms: targetPlatforms,
        owner: vaultInfo.owner
      });
      return vault;

    } catch (error) {
      console.error(`Failed to load vault ${normalizedAddress}:`, error);
      this.eventManager.emit('vaultLoadError', normalizedAddress, error.message);
      throw error;
    }
  }

  /**
   * Fetch token balances for a vault
   * @private
   * @param {string} vaultAddress - Vault address
   * @param {Array<string>} tokenSymbols - Array of token symbols
   * @returns {Promise<Object>} Token balances keyed by symbol
   * @since 1.0.0
   */
  async fetchTokenBalances(vaultAddress, tokenSymbols) {
    if (!tokenSymbols || tokenSymbols.length === 0) {
      throw new Error(`Vault ${vaultAddress} has no target tokens configured - cannot manage vault without knowing which tokens to use`);
    }

    try {
      // Get token addresses and create balance queries
      const balancePromises = tokenSymbols.map(async (symbol) => {
        try {
          const tokenAddress = getTokenAddress(symbol, this.chainId);
          const tokenContract = new ethers.Contract(tokenAddress, ERC20ABI, this.provider);
          const balance = await tokenContract.balanceOf(vaultAddress);

          return {
            symbol,
            balance: balance.toString()
          };
        } catch (error) {
          throw new Error(`Failed to get token balance for ${symbol} in vault ${vaultAddress}: ${error.message}`);
        }
      });

      const results = await Promise.all(balancePromises);

      // Convert to object keyed by symbol
      const balances = results.reduce((acc, result) => {
        acc[result.symbol] = result.balance;
        return acc;
      }, {});

      // Emit event for testing and monitoring
      this.eventManager.emit('TokenBalancesFetched', {
        vaultAddress,
        balances,
        tokenCount: tokenSymbols.length,
        timestamp: Date.now()
      });

      return balances;
    } catch (error) {
      throw new Error(`Failed to fetch token balances for vault ${vaultAddress} (tokens: ${tokenSymbols.join(', ')}): ${error.message}`);
    }
  }

  /**
   * Fetch position details for a vault by querying platform adapters directly
   * Note: Positions are discovered by querying the NFT contract (e.g., NonfungiblePositionManager)
   * rather than relying on vault.getPositionIds() which is unreliable for Uniswap V3
   * (Uniswap uses _mint() not _safeMint(), so onERC721Received is never called)
   * @private
   * @param {string} vaultAddress - Vault address to query positions for
   * @returns {Promise<Object>} Positions object keyed by position ID
   * @since 1.0.0
   */
  async fetchPositions(vaultAddress) {
    // Use cached adapters from AutomationService
    if (!this.adapters) {
      throw new Error('Adapters not initialized. AutomationService must call setAdapters() first.');
    }
    if (this.adapters.size === 0) {
      throw new Error(`No adapters available for chain ID ${this.chainId}`);
    }

    // Load positions from all adapters - return as object keyed by position ID
    const vaultPositions = {};

    for (const adapter of this.adapters.values()) {
      if (typeof adapter.getPositionsForVDS !== 'function') {
        throw new Error(`Adapter ${adapter.platformName} does not implement getPositionsForVDS method - cannot process vault positions`);
      }

      const result = await adapter.getPositionsForVDS(vaultAddress, this.provider);

      // getPositionsForVDS returns positions already in object format
      if (result.positions && Object.keys(result.positions).length > 0) {
        Object.assign(vaultPositions, result.positions);
      }

      // Emit event with pool data for AutomationService to cache
      if (result.poolData && Object.keys(result.poolData).length > 0) {
        this.eventManager.emit('PoolDataFetched', {
          poolData: result.poolData,
          source: adapter.platformName,
          vaultAddress: vaultAddress
        });
      }
    }

    return vaultPositions;
  }

  /**
   * Assemble vault data into the required structure
   * @private
   * @param {Object} data - Raw vault data
   * @returns {Object} Assembled vault object
   * @since 1.0.0
   */
  assembleVaultData(data) {
    return {
      // Core vault properties
      address: data.address,
      owner: data.owner,
      chainId: data.chainId,
      strategyAddress: data.strategyAddress,

      // Strategy configuration
      strategy: data.strategy,

      // Token balances (symbol-keyed)
      tokens: data.tokens,

      // Target configuration (keeping these at top level as per cache structure)
      targetTokens: data.targetTokens,
      targetPlatforms: data.targetPlatforms,

      // Positions (object-keyed by position ID)
      positions: data.positions,

      // Metadata
      lastUpdated: Date.now()
    };
  }
  //#endregion

  //#region Methods For Logging In AutomationService
  /**
   * Get available events
   * @memberof module:VaultDataService.VaultDataService
   * @returns {Array<string>} Array of available event names
   * @since 1.0.0
   * @example
   * const events = vaultDataService.getAvailableEvents();
   * // Returns: ['initialized', 'vaultLoading', 'vaultLoaded', ...]
   */
  getAvailableEvents() {
    return [
      'initialized',
      'vaultLoading',
      'vaultLoaded',
      'vaultLoadError',
      'userVaultsLoading',
      'userVaultsLoaded',
      'userVaultsLoadError',
      'positionsRefreshing',
      'positionsRefreshed',
      'positionsRefreshError',
      'refreshIntervalChanged',
      'cacheCleared',
      'dynamicDataFetched',
      'dynamicDataError',
      'vaultRebalanceUpdating',
      'vaultRebalanceUpdated',
      'vaultRebalanceError',
      'targetTokensUpdated',
      'targetTokensUpdateError',
      'targetPlatformsUpdated',
      'targetPlatformsUpdateError',
      'positionRemoved',
      'positionRemoveError',
      'adaptersCreated',
      'adaptersCreateError',
      'poolAddressCalculated'
    ];
  }

  /**
   * Subscribe to data service events
   * @memberof module:VaultDataService.VaultDataService
   * @param {string} event - Event name to subscribe to
   * @param {Function} callback - Callback function to execute when event occurs
   * @returns {Function} Unsubscribe function to remove the listener
   * @since 1.0.0
   * @example
   * const unsubscribe = vaultDataService.subscribe('vaultLoaded', (address, data) => {
   *   console.log(`Vault ${address} loaded`);
   * });
   * // Later: unsubscribe();
   */
  subscribe(event, callback) {
    return this.eventManager.subscribe(event, callback);
  }
  //#endregion

  //#region Helpers
  /**
   * Check if the service is initialized
   * @memberof module:VaultDataService.VaultDataService
   * @throws {Error} If not initialized (provider or chainId is missing)
   * @private
   * @since 1.0.0
   */
  ensureInitialized() {
    if (!this.provider || !this.chainId) {
      throw new Error('VaultDataService not initialized. Call initialize() first.');
    }
  }

  /**
   * Get all vaults (cached)
   * @memberof module:VaultDataService.VaultDataService
   * @returns {Array<Object>} Array of all cached vault objects
   * @since 1.0.0
   */
  getAllVaults() {
    return Array.from(this.vaults.values());
  }

  /**
   * Get the strategy ID for a vault from cache
   * @memberof module:VaultDataService.VaultDataService
   * @param {string} vaultAddress - Vault address
   * @returns {string|null} Strategy ID or null if vault not found or no strategy
   * @since 1.0.0
   */
  getVaultStrategyId(vaultAddress) {
    const normalizedAddress = ethers.utils.getAddress(vaultAddress);
    const vault = this.vaults.get(normalizedAddress);
    return vault.strategy.strategyId;
  }

  /**
   * Refresh both positions and token balances for a vault
   * @memberof module:VaultDataService.VaultDataService
   * @param {string} vaultAddress - Vault address to refresh
   * @returns {Promise<boolean>} True if refresh successful
   * @throws {Error} If refresh fails
   * @since 1.0.0
   */
  async refreshPositionsAndTokens(vaultAddress) {
    this.ensureInitialized();

    const normalizedAddress = ethers.utils.getAddress(vaultAddress);

    this.eventManager.emit('positionsRefreshing', normalizedAddress);

    try {
      // Get vault from cache
      const vault = this.vaults.get(normalizedAddress);
      if (!vault) {
        throw new Error(`Vault ${normalizedAddress} not found in cache`);
      }

      // Fetch ALL token balances and current positions in parallel
      // Note: fetchPositions queries the NFT contract directly via adapters
      const [allTokenBalances, currentPositions] = await Promise.all([
        this.fetchTokenBalances(normalizedAddress, getAllTokenSymbols()),
        this.fetchPositions(normalizedAddress)
      ]);

      // Update vault cache
      vault.tokens = allTokenBalances;
      vault.positions = currentPositions;
      vault.lastUpdated = Date.now();
      this.vaults.set(normalizedAddress, vault);

      this.eventManager.emit('positionsRefreshed', normalizedAddress, Object.values(currentPositions));
      return true;
    } catch (error) {
      const detailedMessage = `Error refreshing positions and token balances for vault ${normalizedAddress}: ${error.message}`;
      console.error(detailedMessage, error);
      this.eventManager.emit('positionsRefreshError', normalizedAddress, detailedMessage);
      throw new Error(detailedMessage);
    }
  }

  /**
   * Fetch USD values for all vault assets (positions + token balances)
   * @param {Object} vault - Vault object with positions and tokens
   * @param {number} [cacheDuration] - Cache duration in ms (default: 5 seconds for critical ops, use longer for tracking)
   * @returns {Promise<Object>} Asset values with tokens and positions data
   * @since 1.0.0
   */
  async fetchAssetValues(vault, cacheDuration = CACHE_DURATIONS['5-SECONDS']) {
    try {
      // Get all unique token symbols from positions and balances
      const allTokenSymbols = new Set();

      // Add tokens from vault balances

      if (vault.tokens && typeof vault.tokens === 'object') {
        Object.keys(vault.tokens).forEach(symbol => allTokenSymbols.add(symbol));
      } else {
        console.error(`🔍 ERROR: vault.tokens is invalid:`, vault.tokens);
        throw new Error(`vault.tokens is ${vault.tokens}, expected object with token balances`);
      }

      // Add tokens from positions
      for (const position of Object.values(vault.positions)) {
        const poolMetadata = this.poolData[position.pool];
        if (poolMetadata) {
          allTokenSymbols.add(poolMetadata.token0Symbol);
          allTokenSymbols.add(poolMetadata.token1Symbol);
        } else {
        }
      }

      // Fetch current USD prices
      const prices = await fetchTokenPrices(
        Array.from(allTokenSymbols),
        cacheDuration
      );

      // Calculate token balance values
      const tokens = {};
      for (const [symbol, balance] of Object.entries(vault.tokens)) {
        const tokenConfig = this.tokens[symbol];
        if (tokenConfig && prices[symbol]) {
          const balanceFormatted = ethers.utils.formatUnits(balance, tokenConfig.decimals);
          const usdValue = parseFloat(balanceFormatted) * prices[symbol];
          tokens[symbol] = {
            price: prices[symbol],
            usdValue
          };
        } else {
        }
      }

      // Calculate position values
      const positions = {};
      const poolData = {};

      for (const [positionId, position] of Object.entries(vault.positions)) {
        const poolMetadata = this.poolData[position.pool];
        if (!poolMetadata) {
          continue;
        }

        // Get adapter for this platform
        const adapter = this.adapters.get(poolMetadata.platform);
        if (!adapter) {
          throw new Error(`No adapter found for platform: ${poolMetadata.platform}. Available platforms: ${Array.from(this.adapters.keys()).join(', ')}`);
        }

        // Only fetch pool data if we haven't already fetched it in this execution
        let freshPoolData;
        if (!poolData[position.pool]) {
          freshPoolData = await adapter.getPoolData(position.pool, {}, this.provider);
          poolData[position.pool] = freshPoolData;
        } else {
          freshPoolData = poolData[position.pool];
        }

        const token0Data = this.tokens[poolMetadata.token0Symbol];
        const token1Data = this.tokens[poolMetadata.token1Symbol];

        if (!token0Data) {
          console.error(`🔍 ERROR: No token config found for ${poolMetadata.token0Symbol}`);
          continue;
        }
        if (!token1Data) {
          console.error(`🔍 ERROR: No token config found for ${poolMetadata.token1Symbol}`);
          continue;
        }

        const tokenAmounts = await adapter.calculateTokenAmounts(
          position, freshPoolData, token0Data, token1Data, this.chainId
        );

        const token0Formatted = ethers.utils.formatUnits(tokenAmounts[0], token0Data.decimals);
        const token1Formatted = ethers.utils.formatUnits(tokenAmounts[1], token1Data.decimals);

        positions[positionId] = {
          token0Amount: tokenAmounts[0].toString(),
          token1Amount: tokenAmounts[1].toString(),
          token0UsdValue: parseFloat(token0Formatted) * prices[poolMetadata.token0Symbol],
          token1UsdValue: parseFloat(token1Formatted) * prices[poolMetadata.token1Symbol],
          token0Price: prices[poolMetadata.token0Symbol],
          token1Price: prices[poolMetadata.token1Symbol]
        };
      }

      // Calculate total values
      const totalTokenValue = Object.values(tokens).reduce((sum, token) => sum + token.usdValue, 0);
      const totalPositionValue = Object.values(positions).reduce((sum, pos) => sum + pos.token0UsdValue + pos.token1UsdValue, 0);
      const totalVaultValue = totalTokenValue + totalPositionValue;

      const result = {
        tokens,
        positions,
        poolData,
        totalTokenValue,
        totalPositionValue,
        totalVaultValue
      };

      // Emit AssetValuesFetched event
      this.eventManager.emit('AssetValuesFetched', {
        vaultAddress: vault.address,
        tokenCount: Object.keys(tokens).length,
        positionCount: Object.keys(positions).length,
        totalTokenValue,
        totalPositionValue,
        totalVaultValue,
        assetData: result,
        timestamp: Date.now()
      });

      return result;

    } catch (error) {
      throw new Error(`Failed to fetch asset values for vault ${vault.address}: ${error.message}`);
    }
  }

  /**
   * Check if a vault exists in the cache
   * @memberof module:VaultDataService.VaultDataService
   * @param {string} vaultAddress - Address of the vault to check
   * @returns {boolean} True if vault exists in cache, false otherwise
   * @since 1.0.0
   */
  hasVault(vaultAddress) {
    const normalizedAddress = ethers.utils.getAddress(vaultAddress);
    return this.vaults.has(normalizedAddress);
  }

  /**
   * Remove a specific vault from the cache
   * @memberof module:VaultDataService.VaultDataService
   * @param {string} vaultAddress - Address of the vault to remove
   * @returns {boolean} True if vault was removed, false if it didn't exist
   * @since 1.0.0
   */
  removeVault(vaultAddress) {
    const normalizedAddress = ethers.utils.getAddress(vaultAddress);
    const existed = this.vaults.has(normalizedAddress);

    if (existed) {
      this.vaults.delete(normalizedAddress);
      this.eventManager.emit('vaultRemoved', normalizedAddress);
    }

    return existed;
  }

  /**
   * Clear all cached data
   * @memberof module:VaultDataService.VaultDataService
   * @since 1.0.0
   */
  clearCache() {
    this.vaults.clear();
    this.lastRefreshTime = null;
    this.eventManager.emit('cacheCleared');
  }
  //#endregion

  //#region Temporarily Unused Functions
  /**
   * Update target tokens for a vault
   * @memberof module:VaultDataService.VaultDataService
   * @param {string} vaultAddress - Vault address to update
   * @param {Array<string>} newTokens - New target token symbols
   * @returns {Promise<boolean>} True if update successful, false otherwise
   * @since 1.0.0
   */
  async updateTargetTokens(vaultAddress, newTokens) {
    this.ensureInitialized();

    try {
      const normalizedAddress = ethers.utils.getAddress(vaultAddress);

      // Get the current vault data
      const vault = await this.getVault(normalizedAddress);
      if (!vault) {
        throw new Error(`Vault ${normalizedAddress} not found`);
      }

      // Update the target tokens and last updated timestamp
      vault.targetTokens = [...newTokens];
      vault.lastUpdated = Date.now();

      // Store the updated vault
      this.vaults.set(normalizedAddress, vault);

      this.eventManager.emit('targetTokensUpdated', normalizedAddress, newTokens);
      return true;
    } catch (error) {
      console.error(`Error updating target tokens for vault ${vaultAddress}:`, error);
      this.eventManager.emit('targetTokensUpdateError', vaultAddress, error.message);
      return false;
    }
  }

  /**
   * Update target platforms for a vault
   * @memberof module:VaultDataService.VaultDataService
   * @param {string} vaultAddress - Vault address to update
   * @param {Array<string>} newPlatforms - New target platform IDs
   * @returns {Promise<boolean>} True if update successful, false otherwise
   * @since 1.0.0
   */
  async updateTargetPlatforms(vaultAddress, newPlatforms) {
    this.ensureInitialized();

    try {
      const normalizedAddress = ethers.utils.getAddress(vaultAddress);

      // Get the current vault data
      const vault = await this.getVault(normalizedAddress);
      if (!vault) {
        throw new Error(`Vault ${normalizedAddress} not found`);
      }

      // Update the target platforms and last updated timestamp
      vault.targetPlatforms = [...newPlatforms];
      vault.lastUpdated = Date.now();

      // Store the updated vault
      this.vaults.set(normalizedAddress, vault);

      this.eventManager.emit('targetPlatformsUpdated', normalizedAddress, newPlatforms);
      return true;
    } catch (error) {
      console.error(`Error updating target platforms for vault ${vaultAddress}:`, error);
      this.eventManager.emit('targetPlatformsUpdateError', vaultAddress, error.message);
      return false;
    }
  }

  /**
   * Update strategy for a vault
   * @memberof module:VaultDataService.VaultDataService
   * @param {string} vaultAddress - Address of the vault to update
   * @param {string} newStrategyAddress - Address of the new strategy
   * @returns {Promise<boolean>} True if update successful, false otherwise
   * @since 1.0.0
   */
  async updateVaultStrategy(vaultAddress, newStrategyAddress) {
    this.ensureInitialized();

    try {
      const normalizedAddress = ethers.utils.getAddress(vaultAddress);

      // Get the current vault data
      const vault = await this.getVault(normalizedAddress);
      if (!vault) {
        throw new Error(`Vault ${normalizedAddress} not found`);
      }

      // Update the strategy address and last updated timestamp
      vault.strategyAddress = newStrategyAddress;
      vault.lastUpdated = Date.now();

      // Store the updated vault
      this.vaults.set(normalizedAddress, vault);

      this.eventManager.emit('strategyChanged', normalizedAddress, newStrategyAddress);
      return true;
    } catch (error) {
      console.error(`Error updating strategy for vault ${vaultAddress}:`, error);
      this.eventManager.emit('strategyChangeError', vaultAddress, error.message);
      return false;
    }
  }
  //#endregion

  //#region Unused Code
  /**
   * Get vault positions
   * @memberof module:VaultDataService.VaultDataService
   * @param {string} vaultAddress - Vault address to get positions for
   * @returns {Array<Object>} Array of enhanced position objects for the vault
   * @since 1.0.0
   */
  getVaultPositions(vaultAddress) {
    const normalizedAddress = ethers.utils.getAddress(vaultAddress);
    const vault = this.vaults.get(normalizedAddress);
    if (!vault || !vault.positions) return [];

    return Object.values(vault.positions);
  }

  /**
   * Get position by ID
   * @memberof module:VaultDataService.VaultDataService
   * @param {string} positionId - Position ID to retrieve
   * @returns {Object|null} Position data object or null if not found
   * @since 1.0.0
   */
  getPosition(positionId) {
    // Search through all vaults to find the position
    for (const vault of this.vaults.values()) {
      if (vault.positions && vault.positions[positionId]) {
        return vault.positions[positionId];
      }
    }
    return null;
  }

  /**
   * Load data for a specific vault
   * @memberof module:VaultDataService.VaultDataService
   * @param {string} vaultAddress - Vault address to load
   * @param {boolean} [forceRefresh=false] - Force refresh even if cached data exists
   * @returns {Promise<Object>} The vault data object containing vault info, positions, tokens, and metadata
   * @throws {Error} If vault loading fails
   * @since 1.0.0
   * @example
   * const vaultData = await vaultDataService.loadVault('0x123...abc', false);
   * console.log(vaultData.positions); // Object of position data keyed by position ID
   */
  async loadVault(vaultAddress, forceRefresh = false) {
    // Just delegate to the new method
    return this.loadVaultData(vaultAddress);
  }

  /**
   * Get vaults by filter
   * @memberof module:VaultDataService.VaultDataService
   * @param {Function} filterFn - Filter function that receives vault object and returns boolean
   * @returns {Array<Object>} Array of filtered vault objects
   * @since 1.0.0
   * @example
   * const activeVaults = vaultDataService.getVaultsByFilter(vault => !!vault.strategy);
   */
  getVaultsByFilter(filterFn) {
    return Array.from(this.vaults.values()).filter(filterFn);
  }

  /**
   * Get vaults by strategy ID
   * @memberof module:VaultDataService.VaultDataService
   * @param {string} strategyId - Strategy ID to filter by
   * @returns {Array<Object>} Array of vaults with matching strategy
   * @since 1.0.0
   */
  getVaultsByStrategy(strategyId) {
    return this.getVaultsByFilter(vault =>
      vault.strategy &&
      vault.strategy.strategyId &&
      vault.strategy.strategyId.toLowerCase() === strategyId.toLowerCase()
    );
  }

  /**
   * Check if a vault has an active strategy
   * @memberof module:VaultDataService.VaultDataService
   * @param {string} vaultAddress - Vault address to check
   * @returns {boolean} True if vault has active strategy, false otherwise
   * @since 1.0.0
   */
  hasActiveStrategy(vaultAddress) {
    const normalizedAddress = ethers.utils.getAddress(vaultAddress);
    const vault = this.vaults.get(normalizedAddress);
    return vault ? !!vault.strategy : false;
  }

  /**
   * Get dynamic state for a vault and pool based on current price data
   * @memberof module:VaultDataService.VaultDataService
   * @param {string} vaultAddress - Vault address
   * @param {Object} position - Position object with pool information
   * @param {number} currentTick - Current tick value from the pool
   * @param {string} sqrtPriceX96 - Current sqrt price in X96 format
   * @param {Object} adapter - Platform adapter instance for fee calculations
   * @returns {Promise<Object>} Dynamic vault state with position range status and fees
   * @throws {Error} If vault not found or dynamic data calculation fails
   * @since 1.0.0
   * @example
   * const adapter = automationService.getAdapter('uniswapv3');
   * const dynamicState = await vaultDataService.getDynamicVaultState(
   *   '0x123...abc',
   *   position,
   *   -887272,
   *   '79228162514264337593543950336',
   *   adapter
   * );
   */
  async getDynamicVaultState(vaultAddress, position, currentTick, sqrtPriceX96, adapter) {
    this.ensureInitialized();

    try {
      const normalizedAddress = ethers.utils.getAddress(vaultAddress);
      const vault = await this.getVault(normalizedAddress);

      if (!vault) {
        throw new Error(`Vault ${normalizedAddress} not found`);
      }

      // Create the simplified dynamic data structure
      const dynamicData = {
        positions: {}  // Object keyed by position ID for O(1) access
      };

      // Get pool address from position
      const poolAddress = position.pool;
      if (!poolAddress) {
        throw new Error(`No pool address found for position ${position.id}`);
      }

      // Get positions in the affected pool
      const allPositions = this.getVaultPositions(normalizedAddress);
      const relevantPositions = allPositions.filter(pos =>
        pos.pool && pos.pool.toLowerCase() === poolAddress.toLowerCase()
      );


      for (const pos of relevantPositions) {
        try {
          // Calculate if position is in range based on current tick
          const isInRange = currentTick >= pos.tickLower && currentTick <= pos.tickUpper;

          // Calculate current fee data if adapter is available
          let fees = null;

          if (adapter && pos.contracts?.pool) {
            // Get fresh fee growth data from pool
            const poolContract = pos.contracts.pool;
            const [feeGrowthGlobal0X128, feeGrowthGlobal1X128] = await Promise.all([
              poolContract.feeGrowthGlobal0X128(),
              poolContract.feeGrowthGlobal1X128()
            ]);

            // Get token data
            const token0 = this.getToken(pos.token0);
            const token1 = this.getToken(pos.token1);

            if (token0 && token1) {
              // Fetch fresh tick data for this position's range
              const tickData = await adapter.fetchTickData(poolAddress, pos.tickLower, pos.tickUpper, this.provider);

              // Create data objects needed by adapter with fresh tick data
              const poolDataForFees = {
                feeGrowthGlobal0X128: feeGrowthGlobal0X128.toString(),
                feeGrowthGlobal1X128: feeGrowthGlobal1X128.toString(),
                tick: currentTick,
                token0: pos.token0,
                token1: pos.token1,
                ticks: {
                  [pos.tickLower]: tickData.tickLower,
                  [pos.tickUpper]: tickData.tickUpper
                }
              };

              // Calculate fees using correct adapter method
              const [rawFees0, rawFees1] = await adapter.calculateUncollectedFees(
                pos,
                poolDataForFees
              );

              // Format the raw bigint values for strategy use
              fees = {
                token0: ethers.utils.formatUnits(rawFees0, token0.decimals),
                token1: ethers.utils.formatUnits(rawFees1, token1.decimals)
              };
            }
          }

          // Add dynamic position data (keyed by position ID)
          dynamicData.positions[pos.id] = {
            inRange: isInRange,
            fees: fees
          };
        } catch (posError) {
          console.error(`Error getting dynamic data for position ${pos.id}:`, posError);
          this.eventManager.emit('dynamicDataError', normalizedAddress, pos.id, posError.message);
        }
      }

      this.eventManager.emit('dynamicDataFetched', normalizedAddress, dynamicData);
      return dynamicData;
    } catch (error) {
      console.error(`Error getting dynamic vault state for ${vaultAddress}:`, error);
      this.eventManager.emit('dynamicDataError', vaultAddress, null, error.message);
      throw error;
    }
  }

  /**
   * Remove a position from a vault
   * @memberof module:VaultDataService.VaultDataService
   * @param {string} vaultAddress - Vault address
   * @param {string} positionId - Position ID to remove
   * @returns {Promise<boolean>} True if removal successful, false otherwise
   * @since 1.0.0
   */
  async removePosition(vaultAddress, positionId) {
    this.ensureInitialized();

    try {
      const normalizedAddress = ethers.utils.getAddress(vaultAddress);

      // First check if we have the vault in the cache
      const vault = this.vaults.get(normalizedAddress);
      if (!vault) {
        throw new Error(`Vault ${normalizedAddress} not found in cache`);
      }

      // Check if the position exists in the vault
      if (!vault.positions || !vault.positions[positionId]) {
        console.log(`Position ${positionId} not found in vault ${normalizedAddress}`);
        return false;
      }

      const position = vault.positions[positionId];

      // Get pool address for position
      const poolAddress = position.pool;
      if (!poolAddress) {
        console.log(`No pool address found for position ${positionId}`);
      }

      // Remove the position from vault.positions
      delete vault.positions[positionId];
      vault.lastUpdated = Date.now();
      this.vaults.set(normalizedAddress, vault);

      this.eventManager.emit('positionRemoved', normalizedAddress, positionId);
      return true;
    } catch (error) {
      console.error(`Error removing position ${positionId} from vault ${vaultAddress}:`, error);
      this.eventManager.emit('positionRemoveError', vaultAddress, positionId, error.message);
      return false;
    }
  }

  /**
   * Calculate pool address deterministically
   * @memberof module:VaultDataService.VaultDataService
   * @param {string} token0 - Token0 address
   * @param {string} token1 - Token1 address
   * @param {number} fee - Fee tier (e.g., 500, 3000, 10000)
   * @param {string} platform - Platform identifier (e.g., 'uniswapv3')
   * @param {number} [chainId=null] - Chain ID (uses current if not specified)
   * @param {Object} [adapter=null] - Platform adapter instance (optional, fallback to config)
   * @returns {Promise<string>} Computed pool address
   * @throws {Error} If pool address calculation fails
   * @since 1.0.0
   * @example
   * const adapter = automationService.getAdapter('uniswapv3');
   * const poolAddress = await vaultDataService.computePoolAddress(
   *   '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
   *   '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
   *   3000, // 0.3% fee tier
   *   'uniswapv3',
   *   null,
   *   adapter
   * );
   */
  async computePoolAddress(token0, token1, fee, platform, chainId = null, adapter = null) {
    this.ensureInitialized();

    // Use the current chain ID if not specified
    const targetChainId = chainId || this.chainId;

    try {
      // Use provided adapter or try to get from fallback logic
      if (adapter) {
        // Use adapter's getPoolAddress method which has the proper implementation
        const token0Data = { address: token0 };
        const token1Data = { address: token1 };

        // Get token decimals if needed
        try {
          const tokenABI = ['function decimals() view returns (uint8)'];

          const token0Contract = new ethers.Contract(token0, tokenABI, this.provider);
          const token1Contract = new ethers.Contract(token1, tokenABI, this.provider);

          const [decimals0, decimals1] = await Promise.all([
            token0Contract.decimals(),
            token1Contract.decimals()
          ]);

          token0Data.decimals = Number(decimals0);
          token1Data.decimals = Number(decimals1);
        } catch (error) {
          // If we can't get decimals, continue with defaults in the adapter
          console.warn(`Warning: Could not get token decimals: ${error.message}`);
        }

        const result = await adapter.getPoolAddress(token0Data, token1Data, Number(fee));
        return result.poolAddress;
      }

      // If adapter not available, use chain config (fallback)
      const chainConfig = getChainConfig(targetChainId);
      if (!chainConfig) {
        throw new Error(`No chain configuration found for chain ${targetChainId}`);
      }

      const platformConfig = chainConfig.platformAddresses[platform.toLowerCase()];
      if (!platformConfig) {
        throw new Error(`No platform configuration found for ${platform} on chain ${targetChainId}`);
      }

      if (platform.toLowerCase() === 'uniswapv3') {
        // Use factory address from configuration
        const factoryAddress = platformConfig.factoryAddress;
        if (!factoryAddress) {
          throw new Error(`No factory address found for Uniswap V3 on chain ${targetChainId}`);
        }

        // Sort tokens (Uniswap V3 requires token0 < token1)
        let sortedToken0, sortedToken1;
        if (token0.toLowerCase() < token1.toLowerCase()) {
          sortedToken0 = token0;
          sortedToken1 = token1;
        } else {
          sortedToken0 = token1;
          sortedToken1 = token0;
        }

        // Create salt
        const salt = ethers.utils.solidityKeccak256(
          ['address', 'address', 'uint24'],
          [sortedToken0, sortedToken1, fee]
        );

        // Use the proper init code hash for the chain from configuration or constants
        const poolInitCodeHash = '0xe34f199b19b2b4f47f68442619d555527d244f78a3297ea89325f843f87b8b54';

        return ethers.utils.getCreate2Address(
          factoryAddress,
          salt,
          poolInitCodeHash
        );
      }

      throw new Error(`Pool address calculation not implemented for platform ${platform}`);
    } catch (error) {
      console.error(`Error calculating pool address: ${error.message}`);
      throw error;
    }
  }

  /**
   * Infer the platform from a transaction receipt
   * @memberof module:VaultDataService.VaultDataService
   * @param {Object} receipt - Transaction receipt to analyze
   * @param {number} chainId - Chain ID for the transaction
   * @returns {string|null} Platform ID (e.g., 'uniswapv3') or null if not found
   * @private
   * @since 1.0.0
   */
  inferPlatformFromReceipt(receipt, chainId) {
    try {
      if (!receipt || !receipt.logs || !chainId) {
        return null;
      }

      // Get chain configuration
      const { getChainConfig } = require('fum_library/helpers/chainHelpers');
      const chainConfig = getChainConfig(chainId);

      if (!chainConfig || !chainConfig.platformAddresses) {
        return null;
      }

      // Look for known addresses in the receipt logs
      for (const log of receipt.logs) {
        // Check all platforms in the chain config
        for (const [platformId, platformConfig] of Object.entries(chainConfig.platformAddresses)) {
          if (!platformConfig) {
            continue;
          }

          // Check if the log address matches the position manager address
          if (platformConfig.positionManagerAddress &&
              log.address.toLowerCase() === platformConfig.positionManagerAddress.toLowerCase()) {
            return platformId;
          }
        }
      }

      return null;
    } catch (error) {
      console.error("Error inferring platform from receipt:", error);
      return null;
    }
  }
  //#endregion
}

export default VaultDataService;
