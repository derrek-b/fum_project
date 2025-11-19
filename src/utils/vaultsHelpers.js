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
import { getUserVaults, getVaultInfo, getVaultContract } from 'fum_library/blockchain';
import { fetchTokenPrices, CACHE_DURATIONS } from 'fum_library/services';
import { lookupAvailableStrategies, mapStrategyParameters, getStrategyParametersByContractGroup, getParameterSetterMethod } from 'fum_library/helpers';
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
// const mapStrategyParameters = (strategyId, params) => {
//   try {
//     // Strategy-specific parameter mappings
//     if (strategyId.toLowerCase() === 'bob') {
//       return {
//         // Range Parameters
//         targetRangeUpper: parseInt(params[0]) / 100, // Convert basis points to percent
//         targetRangeLower: parseInt(params[1]) / 100,
//         rebalanceThresholdUpper: parseInt(params[2]) / 100,
//         rebalanceThresholdLower: parseInt(params[3]) / 100,

//         // Fee Settings
//         feeReinvestment: params[4],
//         reinvestmentTrigger: ethers.utils.formatUnits(params[5], 2), // Convert to dollars with 2 decimal places
//         reinvestmentRatio: parseInt(params[6]) / 100,

//         // Risk Management
//         maxSlippage: parseInt(params[7]) / 100,
//         emergencyExitTrigger: parseInt(params[8]) / 100,
//         maxUtilization: parseInt(params[9]) / 100
//       };
//     }
//     else if (strategyId.toLowerCase() === 'parris') {
//       return {
//         // Range Parameters
//         targetRangeUpper: parseInt(params[0]) / 100, // Convert basis points to percent
//         targetRangeLower: parseInt(params[1]) / 100,
//         rebalanceThresholdUpper: parseInt(params[2]) / 100,
//         rebalanceThresholdLower: parseInt(params[3]) / 100,

//         // Fee Settings
//         feeReinvestment: params[4],
//         reinvestmentTrigger: ethers.utils.formatUnits(params[5], 2),
//         reinvestmentRatio: parseInt(params[6]) / 100,

//         // Risk Management
//         maxSlippage: parseInt(params[7]) / 100,
//         emergencyExitTrigger: parseInt(params[8]) / 100,
//         maxVaultUtilization: parseInt(params[9]) / 100,

//         // Adaptive Settings
//         adaptiveRanges: params[10],
//         rebalanceCountThresholdHigh: parseInt(params[11]),
//         rebalanceCountThresholdLow: parseInt(params[12]),
//         adaptiveTimeframeHigh: parseInt(params[13]),
//         adaptiveTimeframeLow: parseInt(params[14]),
//         rangeAdjustmentPercentHigh: parseInt(params[15]) / 100,
//         thresholdAdjustmentPercentHigh: parseInt(params[16]) / 100,
//         rangeAdjustmentPercentLow: parseInt(params[17]) / 100,
//         thresholdAdjustmentPercentLow: parseInt(params[18]) / 100,

//         // Oracle Settings
//         oracleSource: parseInt(params[19]),
//         priceDeviationTolerance: parseInt(params[20]) / 100,

//         // Position Sizing
//         maxPositionSizePercent: parseInt(params[21]) / 100,
//         minPositionSize: ethers.utils.formatUnits(params[22], 2),
//         targetUtilization: parseInt(params[23]) / 100,

//         // Platform Settings
//         platformSelectionCriteria: parseInt(params[24]),
//         minPoolLiquidity: ethers.utils.formatUnits(params[25], 2)
//       };
//     }
//     else if (strategyId.toLowerCase() === 'fed') {
//       return {
//         targetRange: parseInt(params[0]) / 100,
//         rebalanceThreshold: parseInt(params[1]) / 100,
//         feeReinvestment: params[2],
//         maxSlippage: parseInt(params[3]) / 100
//         // Add other Fed strategy parameters as needed
//       };
//     }

//     // If we reach here, we don't know how to map this strategy
//     console.warn(`No parameter mapping defined for strategy ${strategyId}`);
//     return {};
//   } catch (error) {
//     console.error(`Error mapping strategy parameters for ${strategyId}:`, error);
//     return {};
//   }
// };

// DONE !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!

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
    const availableStrategies = lookupAvailableStrategies();
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
    const availableStrategies = lookupAvailableStrategies();

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

      // Build contractParametersGroups with parameter lists
      const contractParametersGroups = [];
      if (strategy.contractParametersGroups) {
        Object.keys(strategy.contractParametersGroups).forEach(groupId => {
          // Get parameters for this contract group using library function
          const groupParams = getStrategyParametersByContractGroup(strategy.id, groupId);
          const paramIds = Object.keys(groupParams);

          // Only include groups that have parameters
          if (paramIds.length > 0) {
            contractParametersGroups.push({
              id: groupId,
              setterMethod: getParameterSetterMethod(strategy.id, groupId),
              parameters: paramIds
            });
          }
        });
      }

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
        parameters: strategy.parameters || [],
        contractParametersGroups: contractParametersGroups,
        comingSoon: strategy.id !== 'bob' && strategy.id !== 'none' // Only Baby Steps and none are ready
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
      // Get vault contract from library
      const vaultContract = getVaultContract(vaultAddress, provider);

      // Get basic vault information
      [executor, strategyAddress] = await Promise.all([
        vaultContract.executor(),
        vaultContract.strategy()
      ]);

      // Check if strategy is set and active
      if (strategyAddress && strategyAddress !== ethers.constants.AddressZero) {
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
    const strategy = strategyAddress && strategyAddress !== ethers.constants.AddressZero ? {
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
      hasActiveStrategy: strategyAddress && strategyAddress !== ethers.constants.AddressZero,
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
  const { showError, silent = false } = options;

  // Track if we have partial token data
  let tokenHasPartialData = false;

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

    // Fetch token prices with 30s cache (aligns with CoinGecko's server cache)
    let prices = {};
    try {
      prices = await fetchTokenPrices(Array.from(new Set(allSymbols)), CACHE_DURATIONS['30-SECONDS']);
    } catch (priceError) {
      console.error(`⚠️ Token price fetch failed: ${priceError.message}`);
      tokenHasPartialData = true;
    }
    const tokenPricesLoaded = true;

    const tokenBalances = await Promise.all(
      tokenAddresses.map(async (token) => {
        try {
          const tokenContract = new ethers.Contract(token.address, ERC20ABI, provider);
          const balance = await tokenContract.balanceOf(vaultAddress);
          const formattedBalance = ethers.utils.formatUnits(balance, token.decimals);
          const numericalBalance = parseFloat(formattedBalance);

          // Skip tokens with 0 balance
          if (numericalBalance === 0) return null;

          // Calculate USD value
          const price = prices[token.symbol];
          if (!price) {
            console.error(`⚠️ No price available for token ${token.symbol} - setting tokenHasPartialData`);
            tokenHasPartialData = true;
          }
          const valueUsd = price ? numericalBalance * price : 0;

          return {
            ...token,
            balance: formattedBalance,
            numericalBalance,
            valueUsd: valueUsd || 0
          };
        } catch (err) {
          console.error(`⚠️ Error fetching balance for ${token.symbol}:`, err);
          tokenHasPartialData = true;
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

    // Only update Redux if not in silent mode
    if (!silent) {
      // Update token balances in Redux
      if (Object.keys(tokenBalancesMap).length > 0) {
        dispatch(updateVaultTokenBalances({
          vaultAddress,
          tokenBalances: tokenBalancesMap
        }));
      }

      // Update vault metrics with tokenTVL and tokenHasPartialData
      dispatch(updateVaultMetrics({
        vaultAddress,
        metrics: {
          tokenTVL: totalTokenValue,
          tokenHasPartialData,
          lastTVLUpdate: Date.now()
        }
      }));
    }

    return {
      success: true,
      vaultTokens: filteredTokens,
      totalTokenValue,
      tokenPricesLoaded,
      tokenBalancesMap,
      tokenHasPartialData
    };
  } catch (err) {
    console.error("⚠️ Error fetching token balances:", err);
    if (showError && !silent) showError("Failed to fetch vault tokens");
    return {
      success: false,
      error: err.message,
      totalTokenValue: 0,
      vaultTokens: [],
      tokenBalancesMap: {},
      tokenHasPartialData: true
    };
  }
};

// DONE !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!

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
    const { adapters, failures } = AdapterFactory.getAdaptersForChain(chainId, provider);
    if (failures.length > 0) {
      console.warn(`Failed to create some adapters:`, failures);
    }
    if (adapters.length === 0) {
      const error = `No adapters available for chain ID ${chainId}`;
      if (showError) showError(error);
      return { success: false, error };
    }

    // Load positions from all adapters
    const vaultPositions = [];
    const allPoolData = {};
    const positionIds = [];

    for (const adapter of adapters) {
      try {
        const result = await adapter.getPositions(vaultAddress, provider);
        const positionsArray = result?.positions ? Object.values(result.positions) : [];

        if (positionsArray.length > 0) {
          // Mark positions as being in vault and collect IDs
          positionsArray.forEach(position => {
            positionIds.push(position.id);
            vaultPositions.push({
              ...position,
              inVault: true,
              vaultAddress
            });
          });

          // Collect pool data (token data is embedded in pool objects)
          if (result.poolData) {
            Object.assign(allPoolData, result.poolData);
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

    // Update pools (token data is embedded in pool objects)
    if (Object.keys(allPoolData).length > 0) {
      dispatch(setPools(allPoolData));
    }

    return {
      success: true,
      positions: vaultPositions,
      positionIds,
      poolData: allPoolData
    };
  } catch (error) {
    console.error("Error loading vault positions:", error);
    if (showError) showError(`Failed to load positions: ${error.message}`);
    return { success: false, error: error.message };
  }
};

// DONE !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!

/**
 * Calculate total TVL for a collection of positions
 * @param {Array} positions - Array of position objects
 * @param {Object} poolData - Map of pool addresses to pool data
 * @param {number} chainId - Chain ID for adapter lookup
 * @param {Object} provider - Ethers provider
 * @returns {Promise<{totalTVL: number, hasPartialData: boolean}>}
 */
const calculatePositionsTVL = async (positions, poolData, chainId, provider) => {
  // Initialize
  let totalTVL = 0;
  let hasPartialData = false;

  // Return early if no positions
  if (!positions || positions.length === 0) {
    return { totalTVL: 0, hasPartialData: false };
  }

  // Get unique token symbols and collect data
  const tokenSymbols = new Set();
  const positionData = [];

  // Process each position
  for (const position of positions) {
    try {
      if (!position.pool) {
        hasPartialData = true;
        continue;
      }

      if (!poolData[position.pool]) {
        hasPartialData = true;
        continue;
      }

      const pool = poolData[position.pool];
      if (!pool.token0 || !pool.token1) {
        hasPartialData = true;
        continue;
      }

      // Token data is embedded in the pool object
      const token0 = pool.token0;
      const token1 = pool.token1;

      if (!token0?.symbol || !token1?.symbol) {
        hasPartialData = true;
        continue;
      }

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
      hasPartialData = true;
    }
  }

  // Fetch token prices
  let prices = {};
  try {
    // Fetch token prices with 30s cache (aligns with CoinGecko's server cache)
    prices = await fetchTokenPrices(Array.from(tokenSymbols), CACHE_DURATIONS['30-SECONDS']);
  } catch (error) {
    console.error(`Error prefetching token prices: ${error.message}`);
    hasPartialData = true;
  }

  // Calculate TVL for each position
  for (const data of positionData) {
    try {
      const adapter = AdapterFactory.getAdapter(data.position.platform, chainId, provider);
      if (!adapter) {
        hasPartialData = true;
        continue;
      }

      const tokenAmounts = await adapter.calculateTokenAmounts(
        data.position,
        data.poolData,
        data.token0Data,
        data.token1Data,
        chainId
      );

      if (!tokenAmounts || !Array.isArray(tokenAmounts) || tokenAmounts.length !== 2) {
        hasPartialData = true;
        continue;
      }

      // Format the BigInt amounts using token decimals
      const token0Formatted = ethers.utils.formatUnits(tokenAmounts[0], data.token0Data.decimals);
      const token1Formatted = ethers.utils.formatUnits(tokenAmounts[1], data.token1Data.decimals);

      // Calculate USD values
      const token0Price = prices[data.token0Data.symbol];
      const token0UsdValue = token0Price ? parseFloat(token0Formatted) * token0Price : null;

      const token1Price = prices[data.token1Data.symbol];
      const token1UsdValue = token1Price ? parseFloat(token1Formatted) * token1Price : null;

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

  return { totalTVL, hasPartialData };
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
  const { showError, showSuccess, skipMetricsUpdate = false } = options;

  if (!vaultAddress || !provider || !chainId || !dispatch) {
    const error = "Missing required parameters for loading vault data";
    if (showError) showError(error);
    return { success: false, error };
  }

  try {
    console.log(`🔵 ========================================`);
    console.log(`🔵 getVaultData() called for vault: ${vaultAddress}`);
    console.log(`🔵 skipMetricsUpdate option: ${skipMetricsUpdate}`);
    console.log(`🔵 ========================================`);

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

    // Step 3: Load token balances with silent mode if skipMetricsUpdate is true
    const tokenResult = await loadVaultTokenBalances(
      vaultAddress,
      provider,
      chainId,
      dispatch,
      { ...options, silent: skipMetricsUpdate }
    );

    // Step 4: Load positions
    console.log(`🔵 Loading positions for vault ${vaultAddress}...`);
    const positionsResult = await loadVaultPositions(vaultAddress, provider, chainId, dispatch, options);
    console.log(`🔵 loadVaultPositions result:`, {
      success: positionsResult.success,
      positionsCount: positionsResult.positions?.length || 0,
      positionIds: positionsResult.positionIds || [],
      hasPoolData: !!positionsResult.poolData
    });

    if (positionsResult.success) {
      // Update vault with position IDs
      vaultData.positions = positionsResult.positionIds;

      // Update Redux with the basic vault data
      dispatch(updateVault({
        vaultAddress,
        vaultData
      }));
    }

    // Only calculate position values and update metrics if not skipping metrics update
    console.log(`🔵 TVL Calculation Gate Check for vault ${vaultAddress}:`);
    console.log(`🔵   skipMetricsUpdate: ${skipMetricsUpdate}`);
    console.log(`🔵   positionsResult.success: ${positionsResult.success}`);
    console.log(`🔵   positionsResult.positions.length: ${positionsResult.positions?.length || 0}`);

    if (!skipMetricsUpdate && positionsResult.success) {
      const positions = positionsResult.positions || [];
      const poolData = positionsResult.poolData || {};

      console.log(`🔵 Processing vault with ${positions.length} positions`);

      // Calculate position TVL using shared function
      const { totalTVL, hasPartialData } = await calculatePositionsTVL(positions, poolData, chainId, provider);

      // Always update metrics whether there are positions or not
      console.log(`🔵 TVL calculation complete:`);
      console.log(`🔵   Total Position TVL: $${totalTVL}`);
      console.log(`🔵   Token TVL: $${tokenResult.success ? tokenResult.totalTokenValue : 0}`);
      console.log(`🔵   hasPartialData: ${hasPartialData}`);
      console.log(`🔵   tokenHasPartialData: ${tokenResult.tokenHasPartialData || false}`);
      console.log(`🔵   Position count: ${positions.length}`);

      // Update vault metrics with combined TVL information
      dispatch(updateVaultMetrics({
        vaultAddress,
        metrics: {
          tvl: totalTVL,
          tokenTVL: tokenResult.success ? tokenResult.totalTokenValue : 0,
          hasPartialData,
          tokenHasPartialData: tokenResult.tokenHasPartialData || false,
          positionCount: positions.length,
          lastTVLUpdate: Date.now()
        }
      }));

      console.log(`🔵 Dispatched updateVaultMetrics for vault ${vaultAddress}`);
    } else {
      console.log(`⚠️ TVL calculation SKIPPED for vault ${vaultAddress}`);
      if (skipMetricsUpdate) {
        console.log(`⚠️   Reason: skipMetricsUpdate = true`);
      }
      if (!positionsResult.success) {
        console.log(`⚠️   Reason: positionsResult.success = false`);
      }
      if (!positionsResult.positions || positionsResult.positions.length === 0) {
        console.log(`⚠️   Reason: No positions (length = ${positionsResult.positions?.length || 0})`);
      }
    }

    return {
      success: true,
      vault: vaultData,
      positions: positionsResult.success ? positionsResult.positions : [],
      vaultTokens: tokenResult.success ? tokenResult.vaultTokens : [],
      totalTokenValue: tokenResult.success ? tokenResult.totalTokenValue : 0,
      poolData: positionsResult.poolData || {}
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
    // 1. First trigger Redux update
    dispatch(triggerUpdate());

    // 2. Simply reload the vault data, TVL calculation is done after
    const result = await getVaultData(vaultAddress, provider, chainId, dispatch, { showError });

    if (result.success) {
      // Calculate TVL for this vault specifically - using the same approach as in the loadVaultData function
      const positions = result.positions || [];
      const poolData = result.poolData || {};

      if (positions.length > 0) {
        // Initialize hasPartialData
        let hasPartialData = false;

        // Get unique token symbols and collect data
        const tokenSymbols = new Set();
        const positionData = [];

        // Process each position
        for (const position of positions) {
          try {
            if (!position.pool) {
              hasPartialData = true;
              continue;
            }

            if (!poolData[position.pool]) {
              hasPartialData = true;
              continue;
            }

            const pool = poolData[position.pool];
            if (!pool.token0 || !pool.token1) {
              hasPartialData = true;
              continue;
            }

            // Token data is embedded in the pool object
            const token0 = pool.token0;
            const token1 = pool.token1;

            if (!token0?.symbol || !token1?.symbol) {
              hasPartialData = true;
              continue;
            }

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
        let prices = {};
        try {
          // Fetch token prices with 30s cache (aligns with CoinGecko's server cache)
          prices = await fetchTokenPrices(Array.from(tokenSymbols), CACHE_DURATIONS['30-SECONDS']);
        } catch (error) {
          console.error(`Error prefetching token prices: ${error.message}`);
          hasPartialData = true;
        }

        // Calculate TVL
        let totalTVL = 0;

        for (const data of positionData) {
          try {
            const adapter = AdapterFactory.getAdapter(data.position.platform, chainId, provider);
            if (!adapter) {
              hasPartialData = true;
              continue;
            }

            const tokenAmounts = await adapter.calculateTokenAmounts(
              data.position,
              data.poolData,
              data.token0Data,
              data.token1Data,
              chainId
            );

            console.log(`🔵 calculateTokenAmounts returned:`, tokenAmounts);

            if (!tokenAmounts || !Array.isArray(tokenAmounts) || tokenAmounts.length !== 2) {
              console.log(`⚠️ tokenAmounts invalid format`);
              hasPartialData = true;
              continue;
            }

            // Format the BigInt amounts using token decimals
            const token0Formatted = ethers.utils.formatUnits(tokenAmounts[0], data.token0Data.decimals);
            const token1Formatted = ethers.utils.formatUnits(tokenAmounts[1], data.token1Data.decimals);

            console.log(`🔵 Formatted amounts: token0=${token0Formatted} ${data.token0Data.symbol}, token1=${token1Formatted} ${data.token1Data.symbol}`);

            // Calculate USD values
            const token0Price = prices[data.token0Data.symbol];
            const token0UsdValue = token0Price ? parseFloat(token0Formatted) * token0Price : null;

            const token1Price = prices[data.token1Data.symbol];
            const token1UsdValue = token1Price ? parseFloat(token1Formatted) * token1Price : null;

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
    const allPositions = [];
    const allPoolData = {};
    const positionsByVault = {};
    const completeVaultsData = []; // Will hold fully calculated vault data

    // 3. First pass: Get basic vault info and collect position data
    for (const vaultAddress of vaultAddresses) {
      try {
        // Get basic vault info including positions, but don't update metrics yet
        const vaultResult = await getVaultData(vaultAddress, provider, chainId, dispatch, {
          ...options,
          skipMetricsUpdate: true // Add this flag to getVaultData
        });

        if (vaultResult.success) {
          // Store basic vault data (without finalized metrics)
          const vaultData = vaultResult.vault;

          // Store positions for TVL calculation
          if (vaultResult.positions && vaultResult.positions.length > 0) {
            allPositions.push(...vaultResult.positions);
            positionsByVault[vaultAddress] = vaultResult.positions;
          } else {
            positionsByVault[vaultAddress] = [];
          }

          // Collect pool data (token data is embedded in pool objects)
          if (vaultResult.poolData) {
            Object.assign(allPoolData, vaultResult.poolData);
          }

          // Store vault data temporarily
          completeVaultsData.push({
            ...vaultData,
            // Initialize metrics object that will be completed later
            metrics: {
              tvl: 0,
              tokenTVL: vaultResult.totalTokenValue || 0,
              positionCount: vaultResult.positions ? vaultResult.positions.length : 0,
              hasPartialData: false,
              lastTVLUpdate: Date.now()
            }
          });
        }
      } catch (error) {
        console.error(`Error processing vault ${vaultAddress}:`, error);
      }
    }

    // 4. Get all user positions that aren't in vaults
    const vaultPositionIds = new Set(allPositions.map(p => p.id));
    const { adapters: userAdapters, failures: userAdapterFailures } = AdapterFactory.getAdaptersForChain(chainId, provider);
    if (userAdapterFailures.length > 0) {
      console.warn(`Failed to create some adapters for user positions:`, userAdapterFailures);
    }

    for (const adapter of userAdapters) {
      try {
        // Get all user positions
        const result = await adapter.getPositions(userAddress, provider);
        const positionsArray = result?.positions ? Object.values(result.positions) : [];

        if (positionsArray.length > 0) {
          // Filter out positions already in vaults
          const nonVaultPositions = positionsArray
            .filter(position => !vaultPositionIds.has(position.id))
            .map(position => ({
              ...position,
              inVault: false,
              vaultAddress: null
            }));

          // Add non-vault positions to allPositions
          allPositions.push(...nonVaultPositions);

          // Collect additional pool data for Redux (token data is embedded in pool objects)
          if (result.poolData) {
            Object.assign(allPoolData, result.poolData);
          }
        }
      } catch (error) {
        console.error(`Error fetching all positions from ${adapter.platformName}:`, error);
      }
    }

    // 5. Update pools in Redux (token data is embedded in pool objects)
    if (Object.keys(allPoolData).length > 0) {
      dispatch(setPools(allPoolData));
    }

    // 6. Update Redux with wallet positions only
    // Note: setPositions is designed for wallet positions only and marks them as inVault: false
    // Vault positions will be added separately via addVaultPositions when each vault is loaded
    const walletPositions = allPositions.filter(p => !p.inVault);
    dispatch(setPositions(walletPositions));

    // 7. Prefetch all token prices at once to make TVL calculations faster
    const allTokenSymbols = new Set();

    // Collect all token symbols from pool data (token data is embedded in pool objects)
    Object.values(allPoolData).forEach(pool => {
      if (pool.token0?.symbol) {
        allTokenSymbols.add(pool.token0.symbol);
      }
      if (pool.token1?.symbol) {
        allTokenSymbols.add(pool.token1.symbol);
      }
    });

    let prices = {};
    try {
      // Fetch token prices with 30s cache (aligns with CoinGecko's server cache)
      prices = await fetchTokenPrices(Array.from(allTokenSymbols), CACHE_DURATIONS['30-SECONDS']);
    } catch (error) {
      console.warn("Error prefetching token prices:", error);
    }

    // 8. Second pass: Calculate TVL for each vault
    console.log(`🔵 Starting second pass: Calculating TVL for ${completeVaultsData.length} vaults`);

    for (let i = 0; i < completeVaultsData.length; i++) {
      const vault = completeVaultsData[i];
      const vaultPositions = positionsByVault[vault.address] || [];

      console.log(`🔵 Calculating TVL for vault ${vault.address} with ${vaultPositions.length} positions`);

      // Calculate position TVL using shared function
      const { totalTVL: positionTVL, hasPartialData } = await calculatePositionsTVL(vaultPositions, allPoolData, chainId, provider);

      // Update the metrics with calculated TVL
      console.log(`🔵 Vault ${vault.address} TVL calculated: $${positionTVL}, hasPartialData: ${hasPartialData}`);

      completeVaultsData[i] = {
        ...vault,
        metrics: {
          ...vault.metrics,
          tvl: positionTVL,
          hasPartialData: hasPartialData || vault.metrics.hasPartialData,
          lastTVLUpdate: Date.now()
        }
      };
    }

    console.log(`🔵 Second pass complete: All vault TVLs calculated`);

    // 9. Fetch token balances for each vault and add to complete data
    for (let i = 0; i < completeVaultsData.length; i++) {
      try {
        const tokenResult = await loadVaultTokenBalances(
          completeVaultsData[i].address,
          provider,
          chainId,
          dispatch,
          { ...options, silent: true } // Use silent mode, we'll include it in setVaults
        );

        // Add tokenBalances to the vault data
        if (tokenResult.success && tokenResult.tokenBalancesMap) {
          completeVaultsData[i].tokenBalances = tokenResult.tokenBalancesMap;
          // Also update metrics with tokenHasPartialData
          completeVaultsData[i].metrics.tokenHasPartialData = tokenResult.tokenHasPartialData || false;
        }
      } catch (error) {
        console.error(`Error loading token balances for vault ${completeVaultsData[i].address}:`, error);
        completeVaultsData[i].tokenBalances = {}; // Set to empty object on error
        completeVaultsData[i].metrics.tokenHasPartialData = true; // Mark as having partial data
      }
    }

    // 10. NOW update all vaults in Redux with COMPLETE data (including tokenBalances)
    console.log(`🔵 Dispatching ${completeVaultsData.length} vaults to Redux with complete data`);
    completeVaultsData.forEach(vault => {
      console.log(`🔵 Vault ${vault.address}: TVL=$${vault.metrics.tvl}, tokenTVL=$${vault.metrics.tokenTVL}, hasPartialData=${vault.metrics.hasPartialData}`);
    });
    dispatch(setVaults(completeVaultsData));

    return {
      success: true,
      vaults: completeVaultsData,
      positions: allPositions
    };
  } catch (error) {
    console.error("Error loading user vault data:", error);
    if (showError) showError(`Failed to load user data: ${error.message}`);
    return { success: false, error: error.message };
  }
};
