// src/utils/vaultsHelpers.js
import { AdapterFactory } from '../adapters';
import { setPositions, addVaultPositions } from '../redux/positionsSlice';
import { setPools } from '../redux/poolSlice';
import { setTokens } from '../redux/tokensSlice';
import { updateVaultPositions, updateVaultMetrics, updateVault, setVaults } from '../redux/vaultsSlice';
import { getUserVaults, getVaultInfo } from './contracts';
import { fetchTokenPrices, calculateUsdValue, prefetchTokenPrices, calculateUsdValueSync } from './coingeckoUtils';
import { triggerUpdate } from '../redux/updateSlice';
import { getAvailableStrategies } from './strategyConfig';
import { setAvailableStrategies } from '../redux/strategiesSlice';
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
    const simplifiedStrategies = availableStrategies.map(strategy => ({
      id: strategy.id,
      name: strategy.name,
      subtitle: strategy.subtitle,
      description: strategy.description
    }));

    dispatch(setAvailableStrategies(simplifiedStrategies));

    // 2. Get basic vault info
    const vaultInfo = await getVaultInfo(vaultAddress, provider);

    // 3. Get additional contract info (executor, strategy address)
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

      console.log(`Vault ${vaultAddress} strategy: ${strategyAddress}, executor: ${executor}`);
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
        console.log(`Fetching ${adapter.platformName} positions for vault ${vaultAddress}`);
        const result = await adapter.getPositions(vaultAddress, chainId);

        if (result?.positions?.length > 0) {
          console.log(`Found ${result.positions.length} ${adapter.platformName} positions in vault`);

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
    console.log(`Loading data for user: ${userAddress}`);

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
    console.log(`Found ${vaultAddresses.length} vault addresses`);

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
        console.log(`Processing vault: ${vaultAddress}`);

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

          console.log(`Vault ${vaultAddress} strategy: ${strategyAddress}, executor: ${executor}`);
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
            console.log(`Fetching ${adapter.platformName} positions for vault ${vaultAddress}`);
            const result = await adapter.getPositions(vaultAddress, chainId);

            if (result?.positions?.length > 0) {
              console.log(`Found ${result.positions.length} ${adapter.platformName} positions in vault`);

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
          console.log(`Found ${result.positions.length} total ${adapter.platformName} positions for user`);

          // Filter out positions already in vaults
          const nonVaultPositions = result.positions
            .filter(position => !vaultPositionIds.has(position.id))
            .map(position => ({
              ...position,
              inVault: false,
              vaultAddress: null
            }));

          console.log(`${nonVaultPositions.length} positions are not in vaults`);

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
    console.log("Calculating TVL for all vaults...");

    for (const vault of vaultsData) {
      const vaultPositions = positionsByVault[vault.address] || [];

      if (vaultPositions.length === 0) {
        console.log(`No positions for vault ${vault.address}, skipping TVL calculation`);
        continue;
      }

      console.log(`Calculating TVL for vault ${vault.address} with ${vaultPositions.length} positions`);

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

      if (positionData.length === 0) {
        console.log(`No valid position data for vault ${vault.address}`);
        continue;
      }

      // Fetch token prices
      let pricesFetchFailed = false;

      try {
        console.log("Fetching prices for tokens:", Array.from(tokenSymbols));
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

      console.log(`Final TVL for vault ${vault.address}: ${totalTVL.toFixed(2)}`);

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
