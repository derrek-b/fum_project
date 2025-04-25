// src/utils/vaultsHelpers.js
import { useSelector } from 'react-redux';
import { setPositions, addVaultPositions } from '../redux/positionsSlice';
import { setPools } from '../redux/poolSlice';
import { setTokens } from '../redux/tokensSlice';
import { updateVaultPositions, updateVaultTokenBalances, updateVaultMetrics, updateVault, setVaults } from '../redux/vaultsSlice';
import { triggerUpdate } from '../redux/updateSlice';
import { setAvailableStrategies, setStrategyAddress } from '../redux/strategiesSlice';
import { ethers } from 'ethers';
import { AdapterFactory } from 'fum_library/adapters';
import { getUserVaults, getVaultInfo } from 'fum_library/blockchain';
import { fetchTokenPrices, calculateUsdValue, prefetchTokenPrices, calculateUsdValueSync } from 'fum_library/services';
import { getAvailableStrategies, getStrategyParameters } from 'fum_library/helpers';
import { getAllTokens } from 'fum_library/helpers';
import contractData from 'fum_library/artifacts/contracts';
import ERC20ARTIFACT from '@openzeppelin/contracts/build/contracts/ERC20.json';
const ERC20ABI = ERC20ARTIFACT.abi;

/**
 * Map OracleSource enum to string value
 * @param {number} enumValue - Enum value from contract
 * @returns {string} String representation
 */
// const mapOracleSourceEnum = (enumValue) => {
//   const sources = ['dex', 'chainlink', 'twap'];
//   const index = parseInt(enumValue.toString());
//   if (index >= 0 && index < sources.length) {
//     return sources[index];
//   }
//   return 'unknown'; // Fallback for UI compatibility
// };

/**
 * Map PlatformSelectionCriteria enum to string value
 * @param {number} enumValue - Enum value from contract
 * @returns {string} String representation
 */
// const mapPlatformCriteriaEnum = (enumValue) => {
//   const criteria = ['highest_tvl', 'highest_volume', 'lowest_fees', 'highest_rewards'];
//   const index = parseInt(enumValue.toString());
//   if (index >= 0 && index < criteria.length) {
//     return criteria[index];
//   }
//   return 'unknown'; // Fallback for UI compatibility
// };

/**
 * Map strategy parameters from contract return value to named objects
 * @param {string} strategyId - Strategy ID
 * @param {Array} params - Parameters array from contract
 * @returns {object} Named parameters
 */
const mapStrategyParameters = (strategyId, params) => {
  try {
    // Strategy-specific parameter mappings
    if (strategyId.toLowerCase() === 'parris') {
      return {
        // Range Parameters
        targetRangeUpper: parseInt(params[0]) / 100, // Convert basis points to percent
        targetRangeLower: parseInt(params[1]) / 100,
        rebalanceThresholdUpper: parseInt(params[2]) / 100,
        rebalanceThresholdLower: parseInt(params[3]) / 100,

        // Fee Settings
        feeReinvestment: params[4],
        reinvestmentTrigger: ethers.formatUnits(params[5], 2),
        reinvestmentRatio: parseInt(params[6]) / 100,

        // Risk Management
        maxSlippage: parseInt(params[7]) / 100,
        emergencyExitTrigger: parseInt(params[8]) / 100,
        maxVaultUtilization: parseInt(params[9]) / 100,

        // Adaptive Settings
        adaptiveRanges: params[10],
        rebalanceCountThresholdHigh: parseInt(params[11]),
        rebalanceCountThresholdLow: parseInt(params[12]),
        adaptiveTimeframeHigh: parseInt(params[13]),
        adaptiveTimeframeLow: parseInt(params[14]),
        rangeAdjustmentPercentHigh: parseInt(params[15]) / 100,
        thresholdAdjustmentPercentHigh: parseInt(params[16]) / 100,
        rangeAdjustmentPercentLow: parseInt(params[17]) / 100,
        thresholdAdjustmentPercentLow: parseInt(params[18]) / 100,

        // Oracle Settings
        oracleSource: parseInt(params[19]),
        priceDeviationTolerance: parseInt(params[20]) / 100,

        // Position Sizing
        maxPositionSizePercent: parseInt(params[21]) / 100,
        minPositionSize: ethers.formatUnits(params[22], 2),
        targetUtilization: parseInt(params[23]) / 100,

        // Platform Settings
        platformSelectionCriteria: parseInt(params[24]),
        minPoolLiquidity: ethers.formatUnits(params[25], 2)
      };
    }
    else if (strategyId.toLowerCase() === 'fed') {
      return {
        targetRange: parseInt(params[0]) / 100,
        rebalanceThreshold: parseInt(params[1]) / 100,
        feeReinvestment: params[2],
        maxSlippage: parseInt(params[3]) / 100
        // Add other Fed strategy parameters as needed
      };
    }

    // If we reach here, we don't know how to map this strategy
    console.warn(`No parameter mapping defined for strategy ${strategyId}`);
    return {};
  } catch (error) {
    console.error(`Error mapping strategy parameters for ${strategyId}:`, error);
    return {};
  }
};

/**
 * Fetch and map parameter values from a strategy contract
 * @param {string} strategyAddress - The strategy contract address
 * @param {string} strategyId - Strategy ID (e.g., "parris", "fed")
 * @param {string} vaultAddress - The vault address
 * @param {object} provider - Ethers provider
 * @returns {Promise<object>} Strategy parameters and metadata
 */
const fetchStrategyParameters = async (strategyAddress, strategyId, vaultAddress, provider) => {
  try {
    // Find the contract key for this strategy
    const contractKey = Object.keys(contractData).find(key =>
      key.toLowerCase() === strategyId.toLowerCase() ||
      (key.toLowerCase().includes(strategyId.toLowerCase()) &&
       strategyId.toLowerCase().includes(key.toLowerCase()))
    );

    if (!contractKey || !contractData[contractKey]?.abi) {
      console.warn(`No contract ABI found for strategy ${strategyId}`);
      return null;
    }

    // Create contract instance
    const strategyContract = new ethers.Contract(
      strategyAddress,
      contractData[contractKey].abi,
      provider
    );

    // Get template information
    const templateEnum = await strategyContract.selectedTemplate(vaultAddress);

    // Get customization bitmap
    const customizationBitmap = await strategyContract.customizationBitmap(vaultAddress);

    // Get all parameters in a single call
    const allParams = await strategyContract.getAllParameters(vaultAddress);

    // Map the template to a human-readable value
    let selectedTemplate = 'custom';

    // Use the templateEnumMap from strategy config to map enum value to template ID
    const availableStrategies = getAvailableStrategies();
    const strategy = availableStrategies.find(s => s.id === strategyId);

    if (strategy?.templateEnumMap) {
      // Reverse lookup in templateEnumMap
      for (const [templateId, enumValue] of Object.entries(strategy.templateEnumMap)) {
        if (enumValue === parseInt(templateEnum.toString())) {
          selectedTemplate = templateId;
          break;
        }
      }
    }

    return {
      selectedTemplate,
      templateEnum: templateEnum.toString(),
      customizationBitmap: customizationBitmap.toString(),
      parameters: mapStrategyParameters(strategyId, allParams)
    };
  } catch (error) {
    console.error(`Error fetching strategy parameters:`, error);
    return null;
  }
};

/**
 * Load strategies for a specific chain and configure Redux
 * @param {object} provider - Ethers provider
 * @param {number} chainId - Chain ID
 * @param {function} dispatch - Redux dispatch function
 * @param {object} options - Additional options
 * @returns {Promise<object>} Result object containing strategies and mappings
 */
export const loadVaultStrategies = async (provider, chainId, dispatch, options = {}) => {
  const { showError } = options;

  try {
    // Get strategy information
    const availableStrategies = getAvailableStrategies();

    // Create a mapping from contract addresses to strategy IDs
    const addressToStrategyMap = {};

    // Build a direct mapping from addresses to strategy IDs
    Object.keys(contractData).forEach(contractKey => {
      // Skip non-strategy contracts
      if (['VaultFactory', 'PositionVault', 'BatchExecutor'].includes(contractKey)) {
        return;
      }

      const addresses = contractData[contractKey].addresses || {};

      // Map each address directly to the contract key
      Object.entries(addresses).forEach(([addrChainId, address]) => {
        // Store normalized (lowercase) address for case-insensitive comparison
        addressToStrategyMap[address.toLowerCase()] = {
          strategyId: contractKey,
          contractKey,
          address,
          chainId: addrChainId
        };
      });
    });

    // Create simplified strategies for the Redux store
    const simplifiedStrategies = availableStrategies.map(strategy => {
      // Find contract data for this strategy
      const strategyContractKey = Object.keys(contractData).find(key =>
        key.toLowerCase() === strategy.id.toLowerCase() ||
        (key.toLowerCase().includes(strategy.id.toLowerCase()) &&
         strategy.id.toLowerCase().includes(key.toLowerCase()))
      );

      // Get addresses from contract data if available
      const addresses = strategyContractKey ?
        (contractData[strategyContractKey].addresses || {}) : {};

      // Return simplified strategy with addresses
      return {
        id: strategy.id,
        name: strategy.name,
        subtitle: strategy.subtitle,
        description: strategy.description,
        contractKey: strategyContractKey || strategy.id,
        addresses: { ...addresses }, // Create a new object to avoid frozen objects
        supportsTemplates: !!strategy.templateEnumMap,
        templateEnumMap: strategy.templateEnumMap ? {...strategy.templateEnumMap} : null,
        hasGetAllParameters: true,
        parameters: strategy.parameters || []
      };
    });

    // Update Redux store with strategies
    dispatch(setAvailableStrategies(simplifiedStrategies));

    // Also update strategy addresses in Redux
    Object.values(addressToStrategyMap).forEach(({ strategyId, chainId, address }) => {
      dispatch(setStrategyAddress({
        strategyId,
        chainId,
        address
      }));
    });

    return {
      success: true,
      strategies: simplifiedStrategies,
      addressToStrategyMap
    };
  } catch (error) {
    console.error("Error loading strategy configurations:", error);
    if (showError) showError(`Failed to load strategy configurations: ${error.message}`);
    return { success: false, error: error.message };
  }
};

/**
 * Load basic vault information and contract details
 * @param {string} vaultAddress - The vault address
 * @param {object} provider - Ethers provider
 * @param {object} addressToStrategyMap - Map of strategy addresses to strategy IDs
 * @param {function} dispatch - Redux dispatch function
 * @param {object} options - Additional options
 * @returns {Promise<object>} Result object with vault data
 */
export const loadVaultBasicInfo = async (vaultAddress, provider, addressToStrategyMap = {}, dispatch, options = {}) => {
  const { showError } = options;

  try {
    // Get basic vault info
    const vaultInfo = await getVaultInfo(vaultAddress, provider);

    // Get additional contract info (executor, strategy address, target tokens, target platforms)
    let executor = null;
    let strategyAddress = null;
    let targetTokens = [];
    let targetPlatforms = [];
    let strategyParams = {};
    let activeTemplate = null;
    let strategyId = null;

    try {
      // Enhanced vault contract with additional methods
      const vaultContract = new ethers.Contract(
        vaultAddress,
        [
          "function executor() view returns (address)",
          "function strategy() view returns (address)",
          "function getTargetTokens() view returns (string[])",
          "function getTargetPlatforms() view returns (string[])"
        ],
        provider
      );

      // Get basic vault information
      [executor, strategyAddress] = await Promise.all([
        vaultContract.executor(),
        vaultContract.strategy()
      ]);

      // Check if strategy is set and active
      if (strategyAddress && strategyAddress !== ethers.ZeroAddress) {
        try {
          // Get target tokens and platforms from vault
          [targetTokens, targetPlatforms] = await Promise.all([
            vaultContract.getTargetTokens(),
            vaultContract.getTargetPlatforms()
          ]);

          // Find the matching strategy from our direct mapping
          // Use lowercase for case-insensitive comparison
          const strategyInfo = addressToStrategyMap[strategyAddress.toLowerCase()];

          if (strategyInfo) {
            strategyId = strategyInfo.strategyId;

            // Get strategy parameters from the contract
            try {
              // Fetch detailed strategy parameters using our new approach
              const strategyResult = await fetchStrategyParameters(
                strategyAddress,
                strategyId,
                vaultAddress,
                provider
              );

              if (strategyResult) {
                activeTemplate = strategyResult.selectedTemplate;

                // Store all parameters and metadata
                strategyParams = {
                  ...strategyResult.parameters,
                  customizationBitmap: strategyResult.customizationBitmap,
                  templateEnum: strategyResult.templateEnum
                };
              }
            } catch (err) {
              console.warn("Error loading strategy details:", err.message);
            }
          } else {
            console.warn(`Strategy at address ${strategyAddress} not found in available strategies`);
            strategyId = 'unknown';
          }
        } catch (targetError) {
          console.warn(`Error loading target tokens/platforms: ${targetError.message}`);
        }
      }
    } catch (contractError) {
      console.warn(`Could not fetch additional vault contract data: ${contractError.message}`);
    }

    // Create strategy object if strategy address is set
    // Maintaining the EXACT same structure for frontend compatibility
    const strategy = strategyAddress && strategyAddress !== ethers.ZeroAddress ? {
      strategyId: strategyId || 'unknown',
      strategyAddress,
      isActive: true,
      selectedTokens: targetTokens,
      selectedPlatforms: targetPlatforms,
      parameters: strategyParams,
      activeTemplate: activeTemplate,
      lastUpdated: Date.now()
    } : null;

    // Create vault data object with updated structure including strategy
    const vaultData = {
      address: vaultAddress,
      ...vaultInfo,
      executor: executor || null,
      strategyAddress: strategyAddress || null,
      hasActiveStrategy: strategyAddress && strategyAddress !== ethers.ZeroAddress,
      strategy: strategy,
      positions: [] // Initialize empty positions array
    };

    // Update the vault in Redux
    dispatch(updateVault({
      vaultAddress,
      vaultData
    }));

    return {
      success: true,
      vaultData
    };
  } catch (error) {
    console.error("Error loading vault basic info:", error);
    if (showError) showError(`Failed to load vault information: ${error.message}`);
    return { success: false, error: error.message };
  }
};

/**
 * Load token balances for a vault
 * @param {string} vaultAddress - The vault address
 * @param {object} provider - Ethers provider
 * @param {number} chainId - Chain ID
 * @param {function} dispatch - Redux dispatch function
 * @param {object} options - Additional options
 * @returns {Promise<object>} Result object with token data
 */
export const loadVaultTokenBalances = async (vaultAddress, provider, chainId, dispatch, options = {}) => {
  const { showError } = options;

  try {
    const allTokens = getAllTokens();
    const tokenAddresses = Object.values(allTokens)
      .filter(token => token.addresses[chainId])
      .map(token => ({
        ...token,
        address: token.addresses[chainId]
      }));

    // First, get all token symbols for prefetching prices
    const allSymbols = tokenAddresses.map(token => token.symbol);

    // Prefetch all token prices at once to populate the cache
    await prefetchTokenPrices(Array.from(new Set(allSymbols)));
    const tokenPricesLoaded = true;

    const tokenBalances = await Promise.all(
      tokenAddresses.map(async (token) => {
        try {
          const abi = ERC20ABI.abi;
          const tokenContract = new ethers.Contract(token.address, abi, provider);
          const balance = await tokenContract.balanceOf(vaultAddress);
          const formattedBalance = ethers.formatUnits(balance, token.decimals);
          const numericalBalance = parseFloat(formattedBalance);

          // Skip tokens with 0 balance
          if (numericalBalance === 0) return null;

          // Get token price from our utility
          const valueUsd = calculateUsdValueSync(formattedBalance, token.symbol);

          return {
            ...token,
            balance: formattedBalance,
            numericalBalance,
            valueUsd: valueUsd || 0
          };
        } catch (err) {
          console.error(`Error fetching balance for ${token.symbol}:`, err);
          return null;
        }
      })
    );

    const filteredTokens = tokenBalances.filter(token => token !== null);

    // Calculate total value of all tokens
    const totalTokenValue = filteredTokens.reduce((sum, token) => sum + (token.valueUsd || 0), 0);

    // Store token balances in Redux
    const tokenBalancesMap = {};
    filteredTokens.forEach(token => {
      tokenBalancesMap[token.symbol] = {
        symbol: token.symbol,
        name: token.name,
        balance: token.balance,
        numericalBalance: token.numericalBalance,
        valueUsd: token.valueUsd,
        decimals: token.decimals,
        logoURI: token.logoURI
      };
    });

    // Update token balances in Redux
    if (Object.keys(tokenBalancesMap).length > 0) {
      dispatch(updateVaultTokenBalances({
        vaultAddress,
        tokenBalances: tokenBalancesMap
      }));
    }

    // Update vault metrics with tokenTVL
    dispatch(updateVaultMetrics({
      vaultAddress,
      metrics: {
        tokenTVL: totalTokenValue,
        lastTVLUpdate: Date.now()
      }
    }));

    return {
      success: true,
      vaultTokens: filteredTokens,
      totalTokenValue,
      tokenPricesLoaded
    };
  } catch (err) {
    console.error("Error fetching token balances:", err);
    if (showError) showError("Failed to fetch vault tokens");
    return { success: false, error: err.message };
  }
};

/**
 * Load positions for a vault from all adapters
 * @param {string} vaultAddress - The vault address
 * @param {object} provider - Ethers provider
 * @param {number} chainId - Chain ID
 * @param {function} dispatch - Redux dispatch function
 * @param {object} options - Additional options
 * @returns {Promise<object>} Result object with position data
 */
export const loadVaultPositions = async (vaultAddress, provider, chainId, dispatch, options = {}) => {
  const { showError } = options;

  try {
    // Get adapters for the current chain
    const adapters = AdapterFactory.getAdaptersForChain(chainId, provider);
    if (adapters.length === 0) {
      const error = `No adapters available for chain ID ${chainId}`;
      if (showError) showError(error);
      return { success: false, error };
    }

    // Load positions from all adapters
    const vaultPositions = [];
    const allPoolData = {};
    const allTokenData = {};
    const positionIds = [];

    for (const adapter of adapters) {
      try {
        const result = await adapter.getPositions(vaultAddress, chainId);

        if (result?.positions?.length > 0) {
          // Mark positions as being in vault and collect IDs
          result.positions.forEach(position => {
            positionIds.push(position.id);
            vaultPositions.push({
              ...position,
              inVault: true,
              vaultAddress
            });
          });

          // Collect pool and token data
          if (result.poolData) {
            Object.assign(allPoolData, result.poolData);
          }

          if (result.tokenData) {
            Object.assign(allTokenData, result.tokenData);
          }
        }
      } catch (error) {
        console.error(`Error loading positions from ${adapter.platformName}:`, error);
        // Continue with other adapters even if one fails
      }
    }

    // Update Redux state
    if (positionIds.length > 0) {
      // Update vault positions in vaultsSlice
      dispatch(updateVaultPositions({
        vaultAddress,
        positionIds,
        operation: 'replace'
      }));

      // Update position count
      dispatch(updateVaultMetrics({
        vaultAddress,
        metrics: { positionCount: positionIds.length }
      }));
    }

    // Add positions to positionsSlice
    if (vaultPositions.length > 0) {
      dispatch(addVaultPositions({
        positions: vaultPositions,
        vaultAddress
      }));
    }

    // Update pools and tokens
    if (Object.keys(allPoolData).length > 0) {
      dispatch(setPools(allPoolData));
    }

    if (Object.keys(allTokenData).length > 0) {
      dispatch(setTokens(allTokenData));
    }

    return {
      success: true,
      positions: vaultPositions,
      positionIds,
      poolData: allPoolData,
      tokenData: allTokenData
    };
  } catch (error) {
    console.error("Error loading vault positions:", error);
    if (showError) showError(`Failed to load positions: ${error.message}`);
    return { success: false, error: error.message };
  }
};

/**
 * Main function to load a specific vault's data and positions
 * @param {string} vaultAddress - The vault address
 * @param {object} provider - Ethers provider
 * @param {number} chainId - Chain ID
 * @param {function} dispatch - Redux dispatch function
 * @param {object} options - Additional options
 * @returns {Promise<object>} Result object with success status and vault data
 */
export const getVaultData = async (vaultAddress, provider, chainId, dispatch, options = {}) => {
  const { showError, showSuccess } = options;

  if (!vaultAddress || !provider || !chainId || !dispatch) {
    const error = "Missing required parameters for loading vault data";
    if (showError) showError(error);
    return { success: false, error };
  }

  try {
    console.log(`Loading complete data for vault: ${vaultAddress}`);

    // Step 1: Load strategies
    const strategiesResult = await loadVaultStrategies(provider, chainId, dispatch, options);
    if (!strategiesResult.success) {
      console.warn("Strategy loading failed, continuing with partial data");
    }

    // Step 2: Load basic vault info
    const vaultInfoResult = await loadVaultBasicInfo(
      vaultAddress,
      provider,
      strategiesResult.addressToStrategyMap || {},
      dispatch,
      options
    );

    if (!vaultInfoResult.success) {
      return { success: false, error: vaultInfoResult.error };
    }

    // Store vault data for final result
    const vaultData = vaultInfoResult.vaultData;

    // Step 3: Load token balances
    const tokenResult = await loadVaultTokenBalances(vaultAddress, provider, chainId, dispatch, options);

    // Step 4: Load positions
    const positionsResult = await loadVaultPositions(vaultAddress, provider, chainId, dispatch, options);

    if (positionsResult.success) {
      // Update vault with position IDs
      vaultData.positions = positionsResult.positionIds;

      // Update Redux
      dispatch(updateVault({
        vaultAddress,
        vaultData
      }));
    }

    return {
      success: true,
      vault: vaultData,
      positions: positionsResult.success ? positionsResult.positions : [],
      vaultTokens: tokenResult.success ? tokenResult.vaultTokens : [],
      totalTokenValue: tokenResult.success ? tokenResult.totalTokenValue : 0,
      poolData: positionsResult.poolData || {},
      tokenData: positionsResult.tokenData || {}
    };
  } catch (error) {
    console.error("Error loading vault data:", error);
    if (showError) showError(`Failed to load vault data: ${error.message}`);
    return { success: false, error: error.message };
  }
};

/**
 * Force a complete data refresh after position creation
 * @param {string} vaultAddress - Vault address
 * @param {object} provider - Ethers provider
 * @param {number} chainId - Chain ID
 * @param {function} dispatch - Redux dispatch function
 * @param {function} showSuccess - Success notification function
 * @param {function} showError - Error notification function
 */
export const refreshAfterPositionCreation = async (vaultAddress, provider, chainId, dispatch, showSuccess, showError) => {
  try {
    console.log(`Starting focused refresh after position creation in vault ${vaultAddress}`);

    // 1. First trigger Redux update
    dispatch(triggerUpdate());

    // 2. Simply reload the vault data, TVL calculation is done after
    const result = await getVaultData(vaultAddress, provider, chainId, dispatch, { showError });

    if (result.success) {
      // Calculate TVL for this vault specifically - using the same approach as in the loadVaultData function
      const positions = result.positions || [];
      const poolData = result.poolData || {};
      const tokenData = result.tokenData || {};

      if (positions.length > 0) {

        // Get unique token symbols and collect data
        const tokenSymbols = new Set();
        const positionData = [];

        // Process each position
        for (const position of positions) {
          try {
            if (!position.poolAddress || !poolData[position.poolAddress]) continue;

            const pool = poolData[position.poolAddress];
            if (!pool.token0 || !pool.token1) continue;

            const token0 = tokenData[pool.token0];
            const token1 = tokenData[pool.token1];

            if (!token0?.symbol || !token1?.symbol) continue;

            tokenSymbols.add(token0.symbol);
            tokenSymbols.add(token1.symbol);

            positionData.push({
              position,
              poolData: pool,
              token0Data: token0,
              token1Data: token1
            });
          } catch (error) {
            console.error(`Error processing position data: ${error.message}`);
          }
        }

        // Fetch token prices
        let pricesFetchFailed = false;

        try {
          // Prefetch all token prices at once to populate the cache
          await prefetchTokenPrices(Array.from(tokenSymbols));
        } catch (error) {
          console.error(`Error prefetching token prices: ${error.message}`);
          pricesFetchFailed = true;
        }

        // Calculate TVL
        let totalTVL = 0;
        let hasPartialData = pricesFetchFailed;

        for (const data of positionData) {
          try {
            const adapter = AdapterFactory.getAdapter(data.position.platform, provider);
            if (!adapter) continue;

            const tokenBalances = await adapter.calculateTokenAmounts(
              data.position,
              data.poolData,
              data.token0Data,
              data.token1Data,
              chainId
            );

            if (!tokenBalances) continue;

            // Use the sync version since we've already prefetched prices
            const token0UsdValue = calculateUsdValueSync(
              tokenBalances.token0.formatted,
              data.token0Data.symbol
            );

            const token1UsdValue = calculateUsdValueSync(
              tokenBalances.token1.formatted,
              data.token1Data.symbol
            );

            if (token0UsdValue) totalTVL += token0UsdValue;
            if (token1UsdValue) totalTVL += token1UsdValue;

            // If either token value couldn't be calculated, mark as partial data
            if (token0UsdValue === null || token1UsdValue === null) {
              hasPartialData = true;
            }
          } catch (error) {
            console.error(`Error calculating position value: ${error.message}`);
            hasPartialData = true;
          }
        }

        // Update vault metrics with TVL
        dispatch(updateVaultMetrics({
          vaultAddress,
          metrics: {
            tvl: totalTVL,
            hasPartialData,
            lastTVLUpdate: Date.now()
          }
        }));
      }

      if (showSuccess) {
        showSuccess("Position data refreshed successfully");
      }
    } else {
      if (showError) {
        showError("Partial data refresh - some information may be missing");
      }
    }
  } catch (error) {
    console.error("Error refreshing data after position creation:", error);
    if (showError) {
      showError("Failed to refresh data completely");
    }
  }
};

/**
 * Load all user vault data, positions (including non-vault positions), and related data
 * @param {string} userAddress - The user's wallet address
 * @param {object} provider - Ethers provider
 * @param {number} chainId - Chain ID
 * @param {function} dispatch - Redux dispatch function
 * @param {object} options - Additional options
 * @returns {Promise<object>} Result object with success status
 */
export const loadVaultData = async (userAddress, provider, chainId, dispatch, options = {}) => {
  const { showError, showSuccess } = options;

  if (!userAddress || !provider || !chainId || !dispatch) {
    const error = "Missing required parameters for loading user data";
    if (showError) showError(error);
    return { success: false, error };
  }

  try {
    // 1. Load strategies
    await loadVaultStrategies(provider, chainId, dispatch, options);

    // 2. Get all vault addresses for the user
    const vaultAddresses = await getUserVaults(userAddress, provider);

    // Initialize collections for data
    const vaultsData = [];
    const allPositions = [];
    const allPoolData = {};
    const allTokenData = {};
    const positionsByVault = {};

    // 3. Process each vault to get its details
    for (const vaultAddress of vaultAddresses) {
      try {
        // Load full vault data for each vault
        const vaultResult = await getVaultData(vaultAddress, provider, chainId, dispatch, options);

        if (vaultResult.success) {
          vaultsData.push(vaultResult.vault);

          if (vaultResult.positions && vaultResult.positions.length > 0) {
            allPositions.push(...vaultResult.positions);
            positionsByVault[vaultAddress] = vaultResult.positions;

            // Collect pool and token data
            if (vaultResult.poolData) {
              Object.assign(allPoolData, vaultResult.poolData);
            }
            if (vaultResult.tokenData) {
              Object.assign(allTokenData, vaultResult.tokenData);
            }
          }
        }
      } catch (error) {
        console.error(`Error processing vault ${vaultAddress}:`, error);
      }
    }

    // 4. Update all vaults in Redux
    dispatch(setVaults(vaultsData));

    // 5. Get all user positions that aren't in vaults
    const vaultPositionIds = new Set(allPositions.map(p => p.id));
    const adapters = AdapterFactory.getAdaptersForChain(chainId, provider);

    for (const adapter of adapters) {
      try {
        // Get all user positions
        const result = await adapter.getPositions(userAddress, chainId);

        if (result?.positions?.length > 0) {
          // Filter out positions already in vaults
          const nonVaultPositions = result.positions
            .filter(position => !vaultPositionIds.has(position.id))
            .map(position => ({
              ...position,
              inVault: false,
              vaultAddress: null
            }));

          // Add non-vault positions to allPositions
          allPositions.push(...nonVaultPositions);

          // Collect additional pool and token data for Redux
          if (result.poolData) {
            Object.assign(allPoolData, result.poolData);
          }

          if (result.tokenData) {
            Object.assign(allTokenData, result.tokenData);
          }
        }
      } catch (error) {
        console.error(`Error fetching all positions from ${adapter.platformName}:`, error);
      }
    }

    // 6. Update Redux with ALL positions (vault and non-vault)
    dispatch(setPositions(allPositions));

    // 7. Update pools and tokens
    if (Object.keys(allPoolData).length > 0) {
      dispatch(setPools(allPoolData));
    }

    if (Object.keys(allTokenData).length > 0) {
      dispatch(setTokens(allTokenData));
    }

    // 8. Calculate TVL for each vault - THIS IS THE IMPORTANT PART
    // THIS MUST BE DONE AFTER ALL TOKENS, POOLS AND POSITIONS ARE COLLECTED
    console.log("Starting TVL calculation for all vaults");
    for (const vault of vaultsData) {
      const vaultPositions = positionsByVault[vault.address] || [];

      if (vaultPositions.length === 0) {
        continue;
      }

      // Get unique token symbols and collect data
      const tokenSymbols = new Set();
      const positionData = [];

      // Process each position
      for (const position of vaultPositions) {
        try {
          if (!position.poolAddress || !allPoolData[position.poolAddress]) continue;

          const poolData = allPoolData[position.poolAddress];
          if (!poolData.token0 || !poolData.token1) continue;

          const token0Data = allTokenData[poolData.token0];
          const token1Data = allTokenData[poolData.token1];

          if (!token0Data?.symbol || !token1Data?.symbol) continue;

          tokenSymbols.add(token0Data.symbol);
          tokenSymbols.add(token1Data.symbol);

          positionData.push({
            position,
            poolData,
            token0Data,
            token1Data
          });
        } catch (error) {
          console.error(`Error processing position data: ${error.message}`);
        }
      }

      // Fetch token prices
      let pricesFetchFailed = false;

      try {
        // Prefetch all token prices at once to populate the cache
        await prefetchTokenPrices(Array.from(tokenSymbols));
      } catch (error) {
        console.error(`Error prefetching token prices: ${error.message}`);
        pricesFetchFailed = true;
      }

      // Calculate TVL
      let totalTVL = 0;
      let hasPartialData = pricesFetchFailed;

      for (const data of positionData) {
        try {
          const adapter = AdapterFactory.getAdapter(data.position.platform, provider);
          if (!adapter) continue;

          const tokenBalances = await adapter.calculateTokenAmounts(
            data.position,
            data.poolData,
            data.token0Data,
            data.token1Data,
            chainId
          );

          if (!tokenBalances) continue;

          // Use the sync version since we've already prefetched prices
          const token0UsdValue = calculateUsdValueSync(
            tokenBalances.token0.formatted,
            data.token0Data.symbol
          );

          const token1UsdValue = calculateUsdValueSync(
            tokenBalances.token1.formatted,
            data.token1Data.symbol
          );

          if (token0UsdValue) totalTVL += token0UsdValue;
          if (token1UsdValue) totalTVL += token1UsdValue;

          // If either token value couldn't be calculated, mark as partial data
          if (token0UsdValue === null || token1UsdValue === null) {
            hasPartialData = true;
          }
        } catch (error) {
          console.error(`Error calculating position value: ${error.message}`);
          hasPartialData = true;
        }
      }

      // IMPORTANT: Update vault metrics with TVL
      dispatch(updateVaultMetrics({
        vaultAddress: vault.address,
        metrics: {
          tvl: totalTVL,
          hasPartialData,
          lastTVLUpdate: Date.now()
        }
      }));
    }

    return {
      success: true,
      vaults: vaultsData,
      positions: allPositions
    };
  } catch (error) {
    console.error("Error loading user vault data:", error);
    if (showError) showError(`Failed to load user data: ${error.message}`);
    return { success: false, error: error.message };
  }
};
