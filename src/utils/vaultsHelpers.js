// src/utils/vaultsHelpers.js
import { AdapterFactory } from '../adapters';
import { useSelector } from 'react-redux';
import { setPositions, addVaultPositions } from '../redux/positionsSlice';
import { setPools } from '../redux/poolSlice';
import { setTokens } from '../redux/tokensSlice';
import { updateVaultPositions, updateVaultTokenBalances, updateVaultMetrics, updateVault, setVaults } from '../redux/vaultsSlice';
import { getUserVaults, getVaultInfo } from './contracts';
import { fetchTokenPrices, calculateUsdValue, prefetchTokenPrices, calculateUsdValueSync } from './coingeckoUtils';
import { triggerUpdate } from '../redux/updateSlice';
import { getAvailableStrategies, getStrategyParameters } from './strategyConfig';
import { getAllTokens } from './tokenConfig';
import { setAvailableStrategies, setStrategyAddress } from '../redux/strategiesSlice';
import contractData from '../abis/contracts.json';
import { ethers } from 'ethers';

/**
 * Load a specific vault's data and positions
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
    console.log(`Loading data for vault: ${vaultAddress}`);

    // 1. Get strategy information
    const availableStrategies = getAvailableStrategies();

    // Create a mapping from contract addresses to strategy IDs
    // This approach avoids modifying potentially frozen objects
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
        parameterGroups: strategy.parameterGroups || []
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

    // 2. Get basic vault info
    const vaultInfo = await getVaultInfo(vaultAddress, provider);

    // 3. Get additional contract info (executor, strategy address, target tokens, target platforms)
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
            const contractKey = strategyInfo.contractKey;

            // Find matching strategy in our simplified strategies
            const matchingStrategy = simplifiedStrategies.find(s => s.id === strategyId);

            // Get strategy configuration
            const parameterDefinitions = getStrategyParameters(strategyId);

            // Create strategy contract instance with actual ABI
            const strategyContract = new ethers.Contract(
              strategyAddress,
              contractData[contractKey]?.abi || [],
              provider
            );

            // Get template if strategy supports templates
            if (matchingStrategy?.supportsTemplates) {
              try {
                // Try as a function with parameter
                try {
                  const templateValue = await strategyContract.selectedTemplate(vaultAddress);

                  // Map template value to string based on strategy's enum mapping
                  const templateMap = matchingStrategy.templateEnumMap || {
                    1: 'conservative',
                    2: 'moderate',
                    3: 'aggressive',
                    0: 'custom'
                  };

                  activeTemplate = templateMap[templateValue] || 'custom';
                } catch (err) {
                  // Try as a state variable
                  const templateValue = await strategyContract.selectedTemplate();

                  const templateMap = matchingStrategy.templateEnumMap || {
                    1: 'conservative',
                    2: 'moderate',
                    3: 'aggressive',
                    0: 'custom'
                  };

                  activeTemplate = templateMap[templateValue] || 'custom';
                }
              } catch (templateError) {
                console.warn(`Error getting template: ${templateError.message}`);
              }
            }

            // Get parameters based on strategy's parameter groups
            try {
              // For "ParrisIslandStrategy" or similar strategies with getAllParameters method
              try {
                const params = await strategyContract.getAllParameters(vaultAddress);

                // Map the returned parameters to a structured object
                strategyParams = {};
                let paramIndex = 0;

                // Process parameter groups
                const parameterGroups = matchingStrategy?.parameterGroups || [];

                for (const group of parameterGroups) {
                  // Get parameters for this group
                  const groupParams = Object.entries(parameterDefinitions)
                    .filter(([paramId, config]) => config.group === group.id)
                    .map(([paramId, config]) => ({ paramId, config }));

                  // Process each parameter in the group
                  for (const { paramId, config } of groupParams) {
                    if (paramIndex < params.length) {
                      const rawValue = params[paramIndex++];

                      // Format based on parameter type
                      switch (config.type) {
                        case 'percent':
                          // Convert basis points to percentage
                          strategyParams[paramId] = parseFloat(rawValue) / 100;
                          break;

                        case 'currency':
                          // Convert wei to ether
                          strategyParams[paramId] = ethers.formatUnits(rawValue, 18);
                          break;

                        case 'boolean':
                          strategyParams[paramId] = !!rawValue;
                          break;

                        case 'select':
                          // Use raw value for enums
                          strategyParams[paramId] = rawValue;
                          break;

                        default:
                          // Use raw value for other types
                          strategyParams[paramId] = rawValue;
                      }
                    }
                  }
                }

                console.log("Strategy parameters loaded successfully");
              } catch (err) {
                console.warn("getAllParameters error:", err.message);

                // Try individual parameter getters as fallback
                // (Your existing parameter getter code can go here if needed)
              }
            } catch (paramError) {
              console.warn(`Error loading strategy parameters: ${paramError.message}`);
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

    // 4. Get adapters for the current chain
    const adapters = AdapterFactory.getAdaptersForChain(chainId, provider);
    if (adapters.length === 0) {
      const error = `No adapters available for chain ID ${chainId}`;
      if (showError) showError(error);
      return { success: false, error, vault: vaultData };
    }

    // 5. Load positions from all adapters
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

    // 6. Update vault data with position IDs
    vaultData.positions = positionIds;

    // 7. Update Redux state
    if (positionIds.length > 0) {
      // Update vault object with positions IDs
      dispatch(updateVault({
        vaultAddress,
        vaultData
      }));

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
    } else {
      // Even if no positions, update the vault with the new contract data
      dispatch(updateVault({
        vaultAddress,
        vaultData
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
      vault: vaultData,
      positions: vaultPositions
    };
  } catch (error) {
    console.error("Error loading vault data:", error);
    if (showError) showError(`Failed to load vault data: ${error.message}`);
    return { success: false, error: error.message };
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

    // 1. Get all available strategies and add to store
    const availableStrategies = getAvailableStrategies();
    const simplifiedStrategies = availableStrategies.map(strategy => ({
      id: strategy.id,
      name: strategy.name,
      subtitle: strategy.subtitle,
      description: strategy.description
    }));

    dispatch(setAvailableStrategies(simplifiedStrategies));

    // 2. Get all vault addresses for the user
    const vaultAddresses = await getUserVaults(userAddress, provider);

    // 3. Get adapters for the current chain
    const adapters = AdapterFactory.getAdaptersForChain(chainId, provider);
    if (adapters.length === 0) {
      const error = `No adapters available for chain ID ${chainId}`;
      if (showError) showError(error);
      return { success: false, error };
    }

    // 4. Initialize collections for data
    const vaultsData = [];
    const allPositions = [];
    const allPoolData = {};
    const allTokenData = {};
    const vaultPositionIds = new Set();
    const positionsByVault = {};

    // 5. Process each vault to get its details
    for (const vaultAddress of vaultAddresses) {
      try {

        // Get basic vault info
        const vaultInfo = await getVaultInfo(vaultAddress, provider);

        // Get executor and strategy from contract
        let executor = null;
        let strategyAddress = null;

        try {
          const vaultContract = new ethers.Contract(
            vaultAddress,
            [
              "function executor() view returns (address)",
              "function strategy() view returns (address)"
            ],
            provider
          );

          [executor, strategyAddress] = await Promise.all([
            vaultContract.executor(),
            vaultContract.strategy()
          ]);
        } catch (contractError) {
          console.warn(`Could not fetch additional vault contract data: ${contractError.message}`);
        }

        // Create vault data object with updated structure
        const vaultData = {
          address: vaultAddress,
          ...vaultInfo,
          executor: executor || null,
          strategyAddress: strategyAddress || null,
          hasActiveStrategy: strategyAddress && strategyAddress !== ethers.ZeroAddress,
          positions: [], // Initialize empty positions array
          metrics: { tvl: 0, positionCount: 0 }
        };

        // Get vault positions from all adapters
        const currentVaultPositions = [];
        const currentVaultPositionIds = [];

        for (const adapter of adapters) {
          try {
            const result = await adapter.getPositions(vaultAddress, chainId);

            if (result?.positions?.length > 0) {

              // Process each position
              result.positions.forEach(position => {
                const positionWithVault = {
                  ...position,
                  inVault: true,
                  vaultAddress
                };

                currentVaultPositionIds.push(position.id);
                vaultPositionIds.add(position.id);
                currentVaultPositions.push(position);
                allPositions.push(positionWithVault);
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
          }
        }

        // Store position IDs in vault data
        vaultData.positions = currentVaultPositionIds;
        vaultData.metrics.positionCount = currentVaultPositionIds.length;

        if (currentVaultPositions.length > 0) {
          positionsByVault[vaultAddress] = currentVaultPositions;
        }

        // Add vault to collection
        vaultsData.push(vaultData);

        // Update individual vault in Redux store
        dispatch(updateVault({
          vaultAddress,
          vaultData
        }));

        // Update vault positions
        if (currentVaultPositionIds.length > 0) {
          dispatch(updateVaultPositions({
            vaultAddress,
            positionIds: currentVaultPositionIds,
            operation: 'replace'
          }));

          dispatch(updateVaultMetrics({
            vaultAddress,
            metrics: { positionCount: currentVaultPositionIds.length }
          }));
        }
      } catch (error) {
        console.error(`Error processing vault ${vaultAddress}:`, error);
      }
    }

    // 6. Update all vaults in Redux
    dispatch(setVaults(vaultsData));

    // 7. Get ALL user positions including those not in vaults
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

    // 8. Update Redux with ALL positions (vault and non-vault)
    dispatch(setPositions(allPositions));

    // 9. Update pools and tokens
    if (Object.keys(allPoolData).length > 0) {
      dispatch(setPools(allPoolData));
    }

    if (Object.keys(allTokenData).length > 0) {
      dispatch(setTokens(allTokenData));
    }

    // 10. Calculate TVL for each vault

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

          // Log successful value calculations
          console.log(`Position ${data.position.id}: ${data.token0Data.symbol} = $${token0UsdValue?.toFixed(2) || 'N/A'}, ${data.token1Data.symbol} = $${token1UsdValue?.toFixed(2) || 'N/A'}`);

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
        vaultAddress: vault.address,
        metrics: {
          tvl: totalTVL,
          hasPartialData,
          lastTVLUpdate: Date.now()
        }
      }));
    }

    // 11. Calculate token TVL for each vault
    for (const vault of vaultsData) {
      try {
        // Create an ERC20 ABI instance for token balance checks
        const ERC20_ABI = [
          {
            constant: true,
            inputs: [{ name: "_owner", type: "address" }],
            name: "balanceOf",
            outputs: [{ name: "balance", type: "uint256" }],
            type: "function"
          }
        ];

        const allTokens = getAllTokens();
        const tokenAddresses = Object.values(allTokens)
          .filter(token => token.addresses[chainId])
          .map(token => ({
            ...token,
            address: token.addresses[chainId]
          }));

        // Get all token symbols for prefetching prices
        const allSymbols = tokenAddresses.map(token => token.symbol);

        // Prefetch all token prices at once to populate the cache
        await prefetchTokenPrices(Array.from(new Set(allSymbols)));

        let totalTokenValue = 0;
        let hasTokenPriceErrors = false;
        let tokenBalances = {}; // Store token balances for Redux

        // Get token balances and calculate value
        const tokenPromises = tokenAddresses.map(async (token) => {
          try {
            const tokenContract = new ethers.Contract(token.address, ERC20_ABI, provider);
            const balance = await tokenContract.balanceOf(vault.address);
            const formattedBalance = ethers.formatUnits(balance, token.decimals);
            const numericalBalance = parseFloat(formattedBalance);

            // Skip tokens with 0 balance
            if (numericalBalance === 0) return 0;

            // Save token balance to our tracking object
            tokenBalances[token.symbol] = {
              symbol: token.symbol,
              name: token.name,
              balance: formattedBalance,
              numericalBalance,
              decimals: token.decimals,
              logoURI: token.logoURI
            };

            // Get token price from our utility
            const valueUsd = calculateUsdValueSync(formattedBalance, token.symbol);

            if (valueUsd === null) {
              hasTokenPriceErrors = true;
              return 0;
            }

            // Add value to token balance object
            tokenBalances[token.symbol].valueUsd = valueUsd;

            return valueUsd || 0;
          } catch (err) {
            console.error(`Error calculating value for ${token.symbol}:`, err);
            hasTokenPriceErrors = true;
            return 0;
          }
        });

        const tokenValues = await Promise.all(tokenPromises);
        totalTokenValue = tokenValues.reduce((sum, value) => sum + value, 0);

        // Store token balances in the vault
        if (Object.keys(tokenBalances).length > 0) {
          dispatch(updateVaultTokenBalances({
            vaultAddress: vault.address,
            tokenBalances
          }));
        }

        // Get existing metrics and only add the tokenTVL field
        // Do NOT modify the existing tvl field which represents position TVL
        dispatch(updateVaultMetrics({
          vaultAddress: vault.address,
          metrics: {
            tokenTVL: totalTokenValue,
            hasPartialData: vault.metrics?.hasPartialData || hasTokenPriceErrors,
            lastTVLUpdate: Date.now()
          }
        }));
      } catch (error) {
        console.error(`Error calculating token TVL for vault ${vault.address}:`, error);
      }
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
    console.log(`Starting full data refresh after position creation in vault ${vaultAddress}`);

    // 1. First trigger Redux update
    dispatch(triggerUpdate());

    // 2. Force load vault data from chain
    const result = await getVaultData(vaultAddress, provider, chainId, dispatch, { showError });

    if (!result.success) {
      console.error("Error in vault data refresh:", result.error);
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
