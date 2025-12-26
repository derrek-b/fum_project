/**
 * @module core/VaultDataService
 * @description Service for loading and managing vault data in the automation service.
 * Centralizes vault data loading, caching, and access to prevent fragmented data fetching.
 * @since 2.0.0
 */

import { ethers } from 'ethers';
import { fetchTokenPrices, CACHE_DURATIONS } from 'fum_library/services/coingecko';
import { retryWithBackoff } from '../utils/RetryHelper.js';
import {
  getVaultContract,
  getVaultInfo,
  getContract,
  getContractInfoByAddress,
  mapStrategyParameters,
  getTokenAddress,
  getAllTokenSymbols
} from 'fum_library';
import { isNativeToken, getWethAddress } from 'fum_library/helpers/tokenHelpers';
import ERC20ARTIFACT from '@openzeppelin/contracts/build/contracts/ERC20.json' with { type: 'json' };
const ERC20ABI = ERC20ARTIFACT.abi;

/**
 * Service for loading and managing vault data
 * @class VaultDataService
 * @since 2.0.0
 */
class VaultDataService {
  /**
   * Creates a new VaultDataService instance
   * @param {EventManager} eventManager - Event manager instance for emitting events
   */
  constructor(eventManager) {
    this.vaults = new Map();
    this.eventManager = eventManager;
    this.provider = null;
    this.chainId = null;
    this.lastRefreshTime = null;
    this.adapters = null;
    this.poolData = null;
    this.tokens = null;
  }

  //#region Initialization Methods

  /**
   * Initialize the data service
   * @param {ethers.Provider} provider - Ethers provider instance
   * @param {number} chainId - Chain ID for the network
   */
  initialize(provider, chainId) {
    this.provider = provider;
    this.chainId = chainId;
    this.eventManager.emit('initialized', { chainId });
  }

  /**
   * Set the tokens configuration reference
   * @param {Object} tokens - Token configurations
   */
  setTokens(tokens) {
    this.tokens = tokens;
  }

  /**
   * Set the adapter cache reference
   * @param {Map} adapters - Map of platform adapters
   */
  setAdapters(adapters) {
    this.adapters = adapters;
  }

  /**
   * Set the pool data cache reference
   * @param {Object} poolData - Pool data object
   */
  setPoolData(poolData) {
    this.poolData = poolData;
  }

  //#endregion

  //#region Vault Loading

  /**
   * Get vault data if cached, or load if not
   * @param {string} vaultAddress - Vault address to retrieve
   * @param {boolean} [forceRefresh=false] - Force refresh even if cached
   * @returns {Promise<Object>} Vault data object
   */
  async getVault(vaultAddress, forceRefresh = false) {
    const normalizedAddress = ethers.utils.getAddress(vaultAddress);

    if (!forceRefresh && this.vaults.has(normalizedAddress)) {
      return this.vaults.get(normalizedAddress);
    }

    return this.loadVaultData(normalizedAddress);
  }

  /**
   * Load vault data from blockchain with retry logic
   * @param {string} vaultAddress - The vault address
   * @returns {Promise<Object>} Vault data object
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
   * @private
   */
  async _loadVaultDataInternal(normalizedAddress) {
    this.ensureInitialized();

    this.eventManager.emit('vaultLoading', normalizedAddress);

    try {
      console.log(`Loading vault data for ${normalizedAddress}`);

      const vaultContract = getVaultContract(normalizedAddress, this.provider);

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

      if (!strategyAddress || strategyAddress === ethers.constants.AddressZero) {
        throw new Error(`Vault ${normalizedAddress} has no strategy set. Automation requires a strategy to be configured.`);
      }

      let strategyData = null;
      try {
        const contractInfo = getContractInfoByAddress(strategyAddress);
        const strategyContract = await getContract(contractInfo.contractName, this.provider);
        const rawParams = await strategyContract.getAllParameters(normalizedAddress);
        const mappedParams = mapStrategyParameters(contractInfo.contractName, rawParams);

        strategyData = {
          strategyId: contractInfo.contractName,
          strategyAddress: strategyAddress,
          parameters: mappedParams
        };
      } catch (error) {
        throw new Error(`Failed to load strategy data for vault ${normalizedAddress} (strategy: ${strategyAddress}): ${error.message}`);
      }

      const [tokenBalances, positions] = await Promise.all([
        this.fetchTokenBalances(normalizedAddress, getAllTokenSymbols()),
        this.fetchPositions(vaultContract.address)
      ]);

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
   */
  async fetchTokenBalances(vaultAddress, tokenSymbols) {
    if (!tokenSymbols || tokenSymbols.length === 0) {
      throw new Error(`Vault ${vaultAddress} has no target tokens configured`);
    }

    try {
      const balancePromises = tokenSymbols.map(async (symbol) => {
        try {
          if (isNativeToken(symbol)) {
            const balance = await this.provider.getBalance(vaultAddress);
            return { symbol, balance: balance.toString() };
          }

          let tokenAddress;
          if (symbol === 'WETH') {
            tokenAddress = getWethAddress(this.chainId);
          } else {
            tokenAddress = getTokenAddress(symbol, this.chainId);
          }
          const tokenContract = new ethers.Contract(tokenAddress, ERC20ABI, this.provider);
          const balance = await tokenContract.balanceOf(vaultAddress);

          return { symbol, balance: balance.toString() };
        } catch (error) {
          throw new Error(`Failed to get token balance for ${symbol} in vault ${vaultAddress}: ${error.message}`);
        }
      });

      const results = await Promise.all(balancePromises);

      const balances = results.reduce((acc, result) => {
        acc[result.symbol] = result.balance;
        return acc;
      }, {});

      this.eventManager.emit('TokenBalancesFetched', {
        vaultAddress,
        balances,
        tokenCount: tokenSymbols.length,
        timestamp: Date.now()
      });

      return balances;
    } catch (error) {
      throw new Error(`Failed to fetch token balances for vault ${vaultAddress}: ${error.message}`);
    }
  }

  /**
   * Fetch position details for a vault
   * @private
   */
  async fetchPositions(vaultAddress) {
    if (!this.adapters) {
      throw new Error('Adapters not initialized. AutomationService must call setAdapters() first.');
    }
    if (this.adapters.size === 0) {
      throw new Error(`No adapters available for chain ID ${this.chainId}`);
    }

    const vaultPositions = {};

    for (const adapter of this.adapters.values()) {
      if (typeof adapter.getPositionsForVDS !== 'function') {
        throw new Error(`Adapter ${adapter.platformName} does not implement getPositionsForVDS method`);
      }

      const result = await adapter.getPositionsForVDS(vaultAddress, this.provider);

      if (result.positions && Object.keys(result.positions).length > 0) {
        Object.assign(vaultPositions, result.positions);
      }

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
   */
  assembleVaultData(data) {
    return {
      address: data.address,
      owner: data.owner,
      chainId: data.chainId,
      strategyAddress: data.strategyAddress,
      strategy: data.strategy,
      tokens: data.tokens,
      targetTokens: data.targetTokens,
      targetPlatforms: data.targetPlatforms,
      positions: data.positions,
      lastUpdated: Date.now()
    };
  }

  //#endregion

  //#region Event Integration

  /**
   * Get available events
   * @returns {Array<string>} Array of available event names
   */
  getAvailableEvents() {
    return [
      'initialized',
      'vaultLoading',
      'vaultLoaded',
      'vaultLoadError',
      'positionsRefreshing',
      'positionsRefreshed',
      'positionsRefreshError',
      'cacheCleared',
      'targetTokensUpdated',
      'targetPlatformsUpdated'
    ];
  }

  /**
   * Subscribe to data service events
   * @param {string} event - Event name
   * @param {Function} callback - Callback function
   * @returns {Function} Unsubscribe function
   */
  subscribe(event, callback) {
    return this.eventManager.subscribe(event, callback);
  }

  //#endregion

  //#region Helpers

  /**
   * Check if the service is initialized
   * @private
   */
  ensureInitialized() {
    if (!this.provider || !this.chainId) {
      throw new Error('VaultDataService not initialized. Call initialize() first.');
    }
  }

  /**
   * Get all vaults (cached)
   * @returns {Array<Object>} Array of all cached vault objects
   */
  getAllVaults() {
    return Array.from(this.vaults.values());
  }

  /**
   * Get the strategy ID for a vault from cache
   * @param {string} vaultAddress - Vault address
   * @returns {string|null} Strategy ID or null
   */
  getVaultStrategyId(vaultAddress) {
    const normalizedAddress = ethers.utils.getAddress(vaultAddress);
    const vault = this.vaults.get(normalizedAddress);
    return vault?.strategy?.strategyId || null;
  }

  /**
   * Refresh positions and token balances for a vault
   * @param {string} vaultAddress - Vault address to refresh
   * @returns {Promise<boolean>} True if refresh successful
   */
  async refreshPositionsAndTokens(vaultAddress) {
    this.ensureInitialized();

    const normalizedAddress = ethers.utils.getAddress(vaultAddress);

    this.eventManager.emit('positionsRefreshing', normalizedAddress);

    try {
      const vault = this.vaults.get(normalizedAddress);
      if (!vault) {
        throw new Error(`Vault ${normalizedAddress} not found in cache`);
      }

      const [allTokenBalances, currentPositions] = await Promise.all([
        this.fetchTokenBalances(normalizedAddress, getAllTokenSymbols()),
        this.fetchPositions(normalizedAddress)
      ]);

      vault.tokens = allTokenBalances;
      vault.positions = currentPositions;
      vault.lastUpdated = Date.now();
      this.vaults.set(normalizedAddress, vault);

      this.eventManager.emit('positionsRefreshed', normalizedAddress, Object.values(currentPositions));
      return true;
    } catch (error) {
      const detailedMessage = `Error refreshing positions for vault ${normalizedAddress}: ${error.message}`;
      console.error(detailedMessage, error);
      this.eventManager.emit('positionsRefreshError', normalizedAddress, detailedMessage);
      throw new Error(detailedMessage);
    }
  }

  /**
   * Fetch USD values for all vault assets
   * @param {Object} vault - Vault object
   * @param {number} [cacheDuration] - Cache duration in ms
   * @returns {Promise<Object>} Asset values
   */
  async fetchAssetValues(vault, cacheDuration = CACHE_DURATIONS['5-SECONDS']) {
    try {
      const allTokenSymbols = new Set();

      if (vault.tokens && typeof vault.tokens === 'object') {
        Object.keys(vault.tokens).forEach(symbol => allTokenSymbols.add(symbol));
      } else {
        throw new Error(`vault.tokens is invalid`);
      }

      for (const position of Object.values(vault.positions)) {
        const poolMetadata = this.poolData[position.pool];
        if (poolMetadata) {
          allTokenSymbols.add(poolMetadata.token0Symbol);
          allTokenSymbols.add(poolMetadata.token1Symbol);
        }
      }

      const prices = await fetchTokenPrices(Array.from(allTokenSymbols), cacheDuration);

      const tokens = {};
      for (const [symbol, balance] of Object.entries(vault.tokens)) {
        const tokenConfig = this.tokens[symbol];
        if (tokenConfig && prices[symbol]) {
          const balanceFormatted = ethers.utils.formatUnits(balance, tokenConfig.decimals);
          const usdValue = parseFloat(balanceFormatted) * prices[symbol];
          tokens[symbol] = { price: prices[symbol], usdValue };
        }
      }

      const positions = {};
      const poolData = {};

      for (const [positionId, position] of Object.entries(vault.positions)) {
        const poolMetadata = this.poolData[position.pool];
        if (!poolMetadata) continue;

        const adapter = this.adapters.get(poolMetadata.platform);
        if (!adapter) {
          throw new Error(`No adapter found for platform: ${poolMetadata.platform}`);
        }

        let freshPoolData;
        if (!poolData[position.pool]) {
          freshPoolData = await adapter.getPoolData(position.pool, {}, this.provider);
          poolData[position.pool] = freshPoolData;
        } else {
          freshPoolData = poolData[position.pool];
        }

        const token0Data = this.tokens[poolMetadata.token0Symbol];
        const token1Data = this.tokens[poolMetadata.token1Symbol];

        if (!token0Data || !token1Data) continue;

        const tokenAmounts = await adapter.calculateTokenAmounts(
          position, freshPoolData, token0Data, token1Data
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

      const totalTokenValue = Object.values(tokens).reduce((sum, token) => sum + token.usdValue, 0);
      const totalPositionValue = Object.values(positions).reduce((sum, pos) => sum + pos.token0UsdValue + pos.token1UsdValue, 0);
      const totalVaultValue = totalTokenValue + totalPositionValue;

      const result = {
        tokens,
        positions,
        totalTokenValue,
        totalPositionValue,
        totalVaultValue
      };

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
   * @param {string} vaultAddress - Vault address
   * @returns {boolean} True if vault exists
   */
  hasVault(vaultAddress) {
    const normalizedAddress = ethers.utils.getAddress(vaultAddress);
    return this.vaults.has(normalizedAddress);
  }

  /**
   * Remove a vault from cache
   * @param {string} vaultAddress - Vault address
   * @returns {boolean} True if removed
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
   */
  clearCache() {
    this.vaults.clear();
    this.lastRefreshTime = null;
    this.eventManager.emit('cacheCleared');
  }

  /**
   * Update target tokens for a vault
   * @param {string} vaultAddress - Vault address
   * @param {Array<string>} newTokens - New target token symbols
   * @returns {Promise<boolean>} True if successful
   */
  async updateTargetTokens(vaultAddress, newTokens) {
    this.ensureInitialized();

    try {
      const normalizedAddress = ethers.utils.getAddress(vaultAddress);
      const vault = await this.getVault(normalizedAddress);
      if (!vault) {
        throw new Error(`Vault ${normalizedAddress} not found`);
      }

      vault.targetTokens = [...newTokens];
      vault.lastUpdated = Date.now();
      this.vaults.set(normalizedAddress, vault);

      this.eventManager.emit('targetTokensUpdated', normalizedAddress, newTokens);
      return true;
    } catch (error) {
      console.error(`Error updating target tokens for vault ${vaultAddress}:`, error);
      return false;
    }
  }

  /**
   * Update target platforms for a vault
   * @param {string} vaultAddress - Vault address
   * @param {Array<string>} newPlatforms - New target platform IDs
   * @returns {Promise<boolean>} True if successful
   */
  async updateTargetPlatforms(vaultAddress, newPlatforms) {
    this.ensureInitialized();

    try {
      const normalizedAddress = ethers.utils.getAddress(vaultAddress);
      const vault = await this.getVault(normalizedAddress);
      if (!vault) {
        throw new Error(`Vault ${normalizedAddress} not found`);
      }

      vault.targetPlatforms = [...newPlatforms];
      vault.lastUpdated = Date.now();
      this.vaults.set(normalizedAddress, vault);

      this.eventManager.emit('targetPlatformsUpdated', normalizedAddress, newPlatforms);
      return true;
    } catch (error) {
      console.error(`Error updating target platforms for vault ${vaultAddress}:`, error);
      return false;
    }
  }

  //#endregion
}

export default VaultDataService;
