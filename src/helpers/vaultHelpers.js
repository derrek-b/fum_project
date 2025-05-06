// src/helpers/vaultHelpers.js
import { ethers } from 'ethers';
import { AdapterFactory } from '../adapters';
import { getUserVaults, getVaultInfo } from '../blockchain';
import { fetchTokenPrices, calculateUsdValue, prefetchTokenPrices, calculateUsdValueSync } from '../services';
import { getAvailableStrategies, getStrategyParameters } from './strategyHelpers';
import { getAllTokens } from './tokenHelpers';
import contractData from '../artifacts/contracts';
import ERC20ARTIFACT from '@openzeppelin/contracts/build/contracts/ERC20.json';
const ERC20ABI = ERC20ARTIFACT.abi;

/**
 * Map strategy parameters from contract return value to named objects
 * @param {string} strategyId - Strategy ID
 * @param {Array} params - Parameters array from contract
 * @returns {object} Named parameters
 */
export const mapStrategyParameters = (strategyId, params) => {
  try {
    // Strategy-specific parameter mappings
    if (strategyId.toLowerCase() === 'bob') {
      return {
        // Range Parameters
        targetRangeUpper: parseInt(params[0]) / 100, // Convert basis points to percent
        targetRangeLower: parseInt(params[1]) / 100,
        rebalanceThresholdUpper: parseInt(params[2]) / 100,
        rebalanceThresholdLower: parseInt(params[3]) / 100,

        // Fee Settings
        feeReinvestment: params[4],
        reinvestmentTrigger: ethers.formatUnits(params[5], 2), // Convert to dollars with 2 decimal places
        reinvestmentRatio: parseInt(params[6]) / 100,

        // Risk Management
        maxSlippage: parseInt(params[7]) / 100,
        emergencyExitTrigger: parseInt(params[8]) / 100,
        maxUtilization: parseInt(params[9]) / 100
      };
    }
    else if (strategyId.toLowerCase() === 'parris') {
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
export const fetchStrategyParameters = async (strategyAddress, strategyId, vaultAddress, provider) => {
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
 * Get available strategy configurations for a chain
 * @param {object} provider - Ethers provider 
 * @param {number} chainId - Chain ID
 * @returns {Promise<object>} Result object containing strategies and mappings
 */
export const getVaultStrategies = async (provider, chainId) => {
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

    // Create simplified strategies
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

    return {
      success: true,
      strategies: simplifiedStrategies,
      addressToStrategyMap
    };
  } catch (error) {
    console.error("Error loading strategy configurations:", error);
    return { success: false, error: error.message };
  }
};

/**
 * Load basic vault information and contract details
 * @param {string} vaultAddress - The vault address
 * @param {object} provider - Ethers provider
 * @param {object} addressToStrategyMap - Map of strategy addresses to strategy IDs
 * @returns {Promise<object>} Result object with vault data
 */
export const getVaultBasicInfo = async (vaultAddress, provider, addressToStrategyMap = {}) => {
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

    return {
      success: true,
      vaultData
    };
  } catch (error) {
    console.error("Error loading vault basic info:", error);
    return { success: false, error: error.message };
  }
};

/**
 * Load token balances for a vault
 * @param {string} vaultAddress - The vault address
 * @param {object} provider - Ethers provider
 * @param {number} chainId - Chain ID
 * @returns {Promise<object>} Result object with token data
 */
export const getVaultTokenBalances = async (vaultAddress, provider, chainId) => {
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
          const tokenContract = new ethers.Contract(token.address, ERC20ABI, provider);
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

    // Store token balances in a map
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

    return {
      success: true,
      vaultTokens: filteredTokens,
      totalTokenValue,
      tokenPricesLoaded,
      tokenBalancesMap
    };
  } catch (err) {
    console.error("Error fetching token balances:", err);
    return {
      success: false,
      error: err.message,
      totalTokenValue: 0,
      vaultTokens: [],
      tokenBalancesMap: {}
    };
  }
};

/**
 * Load positions for a vault from all adapters
 * @param {string} vaultAddress - The vault address
 * @param {object} provider - Ethers provider
 * @param {number} chainId - Chain ID
 * @returns {Promise<object>} Result object with position data
 */
export const getVaultPositions = async (vaultAddress, provider, chainId) => {
  try {
    // Get adapters for the current chain
    const adapters = AdapterFactory.getAdaptersForChain(chainId, provider);
    if (adapters.length === 0) {
      const error = `No adapters available for chain ID ${chainId}`;
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

    return {
      success: true,
      positions: vaultPositions,
      positionIds,
      poolData: allPoolData,
      tokenData: allTokenData
    };
  } catch (error) {
    console.error("Error loading vault positions:", error);
    return { success: false, error: error.message };
  }
};

/**
 * Get TVL for positions
 * @param {Array} positions - Position objects
 * @param {Object} poolData - Pool data
 * @param {Object} tokenData - Token data
 * @param {Object} provider - Ethers provider
 * @param {Number} chainId - Chain ID
 * @returns {Promise<{positionTVL: number, hasPartialData: boolean}>} TVL and data quality flag
 */
export const calculatePositionsTVL = async (positions, poolData, tokenData, provider, chainId) => {
  let positionTVL = 0;
  let hasPartialData = false;

  if (!positions || positions.length === 0) {
    return { positionTVL, hasPartialData };
  }

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

  // Get unique token symbols and prefetch prices
  const tokenSymbols = new Set();
  positionData.forEach(data => {
    tokenSymbols.add(data.token0Data.symbol);
    tokenSymbols.add(data.token1Data.symbol);
  });

  try {
    await prefetchTokenPrices(Array.from(tokenSymbols));
  } catch (error) {
    console.error(`Error prefetching token prices: ${error.message}`);
    hasPartialData = true;
  }

  // Calculate position TVL
  for (const data of positionData) {
    try {
      const adapter = AdapterFactory.getAdapter(data.position.platform, provider);
      if (!adapter) {
        hasPartialData = true;
        continue;
      }

      const tokenBalances = await adapter.calculateTokenAmounts(
        data.position,
        data.poolData,
        data.token0Data,
        data.token1Data,
        chainId
      );

      if (!tokenBalances) {
        hasPartialData = true;
        continue;
      }

      // Use the sync version since we've already prefetched prices
      const token0UsdValue = calculateUsdValueSync(
        tokenBalances.token0.formatted,
        data.token0Data.symbol
      );

      const token1UsdValue = calculateUsdValueSync(
        tokenBalances.token1.formatted,
        data.token1Data.symbol
      );

      if (token0UsdValue !== null) positionTVL += token0UsdValue;
      if (token1UsdValue !== null) positionTVL += token1UsdValue;

      // If either token value couldn't be calculated, mark as partial data
      if (token0UsdValue === null || token1UsdValue === null) {
        hasPartialData = true;
      }
    } catch (error) {
      console.error(`Error calculating position value: ${error.message}`);
      hasPartialData = true;
    }
  }

  return { positionTVL, hasPartialData };
};

/**
 * Main function to get a specific vault's data and positions
 * @param {string} vaultAddress - The vault address
 * @param {object} provider - Ethers provider
 * @param {number} chainId - Chain ID
 * @returns {Promise<object>} Result object with success status and vault data
 */
export const getVaultData = async (vaultAddress, provider, chainId) => {
  if (!vaultAddress || !provider || !chainId) {
    const error = "Missing required parameters for loading vault data";
    return { success: false, error };
  }

  try {
    console.log(`Loading complete data for vault: ${vaultAddress}`);

    // Step 1: Load strategies
    const strategiesResult = await getVaultStrategies(provider, chainId);
    if (!strategiesResult.success) {
      console.warn("Strategy loading failed, continuing with partial data");
    }

    // Step 2: Load basic vault info
    const vaultInfoResult = await getVaultBasicInfo(
      vaultAddress,
      provider,
      strategiesResult.addressToStrategyMap || {}
    );

    if (!vaultInfoResult.success) {
      return { success: false, error: vaultInfoResult.error };
    }

    // Store vault data for final result
    const vaultData = vaultInfoResult.vaultData;

    // Step 3: Load token balances
    const tokenResult = await getVaultTokenBalances(
      vaultAddress,
      provider,
      chainId
    );

    // Step 4: Load positions
    const positionsResult = await getVaultPositions(vaultAddress, provider, chainId);

    if (positionsResult.success) {
      // Update vault with position IDs
      vaultData.positions = positionsResult.positionIds;
    }

    // Calculate TVL if positions are available
    let metrics = {
      tvl: 0,
      tokenTVL: tokenResult.success ? tokenResult.totalTokenValue : 0,
      hasPartialData: false,
      positionCount: positionsResult.success ? positionsResult.positions.length : 0,
      lastTVLUpdate: Date.now()
    };

    if (positionsResult.success && positionsResult.positions.length > 0) {
      const { positionTVL, hasPartialData } = await calculatePositionsTVL(
        positionsResult.positions,
        positionsResult.poolData || {},
        positionsResult.tokenData || {},
        provider,
        chainId
      );

      metrics.tvl = positionTVL;
      metrics.hasPartialData = hasPartialData;
    }

    // Add metrics to vault data
    vaultData.metrics = metrics;

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
    return { success: false, error: error.message };
  }
};

/**
 * Get all user vaults with full data
 * @param {string} userAddress - The user's wallet address
 * @param {object} provider - Ethers provider
 * @param {number} chainId - Chain ID
 * @returns {Promise<object>} Result object with success status and vaults data
 */
export const getAllUserVaultData = async (userAddress, provider, chainId) => {
  if (!userAddress || !provider || !chainId) {
    const error = "Missing required parameters for loading user data";
    return { success: false, error };
  }

  try {
    // 1. Load strategies
    const strategiesResult = await getVaultStrategies(provider, chainId);
    
    // 2. Get all vault addresses for the user
    const vaultAddresses = await getUserVaults(userAddress, provider);

    // Initialize collections for data
    const allPositions = [];
    const allPoolData = {};
    const allTokenData = {};
    const positionsByVault = {};
    const vaults = []; // Will hold fully calculated vault data

    // 3. First pass: Get basic vault info and collect position data
    console.log("First pass: gathering basic vault info and positions");
    for (const vaultAddress of vaultAddresses) {
      try {
        // Get basic vault info including positions
        const vaultResult = await getVaultData(vaultAddress, provider, chainId);

        if (vaultResult.success) {
          // Store vault data
          vaults.push(vaultResult.vault);

          // Store positions for TVL calculation
          if (vaultResult.positions && vaultResult.positions.length > 0) {
            allPositions.push(...vaultResult.positions);
            positionsByVault[vaultAddress] = vaultResult.positions;
          } else {
            positionsByVault[vaultAddress] = [];
          }

          // Collect pool and token data
          if (vaultResult.poolData) {
            Object.assign(allPoolData, vaultResult.poolData);
          }
          if (vaultResult.tokenData) {
            Object.assign(allTokenData, vaultResult.tokenData);
          }
        }
      } catch (error) {
        console.error(`Error processing vault ${vaultAddress}:`, error);
      }
    }

    // 4. Get all user positions that aren't in vaults
    const vaultPositionIds = new Set(allPositions.map(p => p.id));
    const nonVaultPositions = [];
    const adapters = AdapterFactory.getAdaptersForChain(chainId, provider);

    for (const adapter of adapters) {
      try {
        // Get all user positions
        const result = await adapter.getPositions(userAddress, chainId);

        if (result?.positions?.length > 0) {
          // Filter out positions already in vaults
          const userNonVaultPositions = result.positions
            .filter(position => !vaultPositionIds.has(position.id))
            .map(position => ({
              ...position,
              inVault: false,
              vaultAddress: null
            }));

          // Add non-vault positions
          nonVaultPositions.push(...userNonVaultPositions);

          // Collect additional pool and token data
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

    return {
      success: true,
      vaults,
      positions: {
        vaultPositions: allPositions,
        nonVaultPositions
      },
      poolData: allPoolData,
      tokenData: allTokenData
    };
  } catch (error) {
    console.error("Error loading user vault data:", error);
    return { success: false, error: error.message };
  }
};

// Export all utilities to be used by the automation service
export default {
  getVaultStrategies,
  getVaultBasicInfo,
  getVaultTokenBalances,
  getVaultPositions,
  getVaultData,
  getAllUserVaultData,
  calculatePositionsTVL,
  fetchStrategyParameters,
  mapStrategyParameters
};