// src/hooks/useVaultData.js
import { useState, useCallback, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { AdapterFactory } from '../adapters';
import { getUserVaults, getVaultInfo } from '../utils/contracts';
import { setVaults, setLoadingVaults, setVaultError, updateVaultPositions, updateVaultMetrics } from '../redux/vaultsSlice';
import { addVaultPositions } from '../redux/positionsSlice';
import { setPools } from '../redux/poolSlice';
import { setTokens } from '../redux/tokensSlice';
import { setResourceUpdating } from '../redux/updateSlice';
import { fetchTokenPrices, calculateUsdValue } from '../utils/coingeckoUtils';
import { useToast } from '../context/ToastContext';

/**
 * Custom hook for loading and managing vault data
 */
export const useVaultData = () => {
  const dispatch = useDispatch();
  const { showError, showSuccess } = useToast();

  // Redux state
  const { address, chainId, provider } = useSelector((state) => state.wallet);
  const { userVaults } = useSelector((state) => state.vaults);
  const { positions } = useSelector((state) => state.positions);
  const pools = useSelector((state) => state.pools);
  const tokens = useSelector((state) => state.tokens);

  // Local state
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const isCalculatingRef = useRef(false);

  /**
   * Calculate TVL for a specific vault
   *
   * Note: We're not including positions/pools/tokens in the dependency array
   * to avoid circular dependencies and infinite loops. This function should be
   * called only when we know the data has changed.
   */
  const calculateVaultTVL = useCallback(async (vault) => {
    try {
      // Skip if no positions
      if (!vault.positions || vault.positions.length === 0) {
        return;
      }

      console.log(`Calculating TVL for vault ${vault.address} with ${vault.positions.length} positions`);

      // Get the full position objects from position IDs
      const vaultPositions = [];
      for (const positionId of vault.positions) {
        const fullPosition = positions.find(p => p.id === positionId);
        if (fullPosition) {
          vaultPositions.push(fullPosition);
        }
      }

      if (vaultPositions.length === 0) {
        console.log('No matching vault positions found in position data');
        return;
      }

      // Get unique token symbols and collect data for calculations
      const tokenSymbols = new Set();
      const positionData = [];

      // Collect token data
      for (const position of vaultPositions) {
        try {
          if (!position.poolAddress || !pools[position.poolAddress]) continue;

          const poolData = pools[position.poolAddress];
          if (!poolData.token0 || !poolData.token1) continue;

          const token0Data = tokens[poolData.token0];
          const token1Data = tokens[poolData.token1];

          if (!token0Data?.symbol || !token1Data?.symbol) continue;

          tokenSymbols.add(token0Data.symbol);
          tokenSymbols.add(token1Data.symbol);

          positionData.push({
            position,
            poolData,
            token0Data,
            token1Data
          });
        } catch (posError) {
          console.error(`Error processing position ${position.id} data:`, posError);
        }
      }

      if (tokenSymbols.size === 0 || positionData.length === 0) {
        return;
      }

      // Fetch token prices with error handling
      let tokenPrices = {};
      let pricesFetchFailed = false;
      try {
        tokenPrices = await fetchTokenPrices(Array.from(tokenSymbols));
      } catch (priceError) {
        console.error(`Error fetching token prices for vault ${vault.address}:`, priceError);
        pricesFetchFailed = true;
      }

      // Calculate TVL
      let totalTVL = 0;
      let hasPartialData = pricesFetchFailed; // Mark as partial data if prices fetch failed

      for (const data of positionData) {
        try {
          if (!data.position.platform) {
            hasPartialData = true;
            continue;
          }

          // Get adapter for this position's platform
          const adapter = AdapterFactory.getAdapter(data.position.platform, provider);
          if (!adapter) {
            hasPartialData = true;
            continue;
          }

          // Calculate token amounts
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

          // Calculate USD values
          const token0UsdValue = calculateUsdValue(
            tokenBalances.token0.formatted,
            tokenPrices[data.token0Data.symbol]
          );

          const token1UsdValue = calculateUsdValue(
            tokenBalances.token1.formatted,
            tokenPrices[data.token1Data.symbol]
          );

          // Add to total TVL
          if (token0UsdValue) totalTVL += token0UsdValue;
          if (token1UsdValue) totalTVL += token1UsdValue;
        } catch (calcError) {
          console.error(`Error calculating value for position ${data.position.id}:`, calcError);
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
    } catch (vaultError) {
      console.error(`Error calculating TVL for vault ${vault.address}:`, vaultError);
    }
  // Remove positions, pools, tokens from dependencies to avoid loops
  }, [provider, chainId, dispatch]);

  /**
   * Main function to load all vault data
   *
   * Note: We're only depending on address, chainId, provider and showError.
   * The calculateVaultTVL function is a stable reference so no infinite loops.
   * dispatch is stable and doesn't change.
   */
  const loadData = useCallback(async () => {
    // Prevent loading if we're not connected or don't have required info
    if (!address || !provider || !chainId) {
      return;
    }

    setIsLoading(true);
    setError(null);
    dispatch(setLoadingVaults(true));
    dispatch(setVaultError(null));
    dispatch(setResourceUpdating({ resource: 'vaults', isUpdating: true }));

    try {
      console.log("Loading vault data...");

      // Step 1: Fetch user vaults
      console.log("Fetching user vaults...");
      const vaultAddresses = await getUserVaults(address, provider);
      console.log(`Found ${vaultAddresses.length} vault addresses for user ${address}`);

      // Step 2: Get detailed info for each vault
      const vaultsWithInfo = await Promise.all(
        vaultAddresses.map(async (vaultAddress) => {
          try {
            const info = await getVaultInfo(vaultAddress, provider);
            return {
              address: vaultAddress,
              ...info,
              positions: [], // Initialize with empty positions array
              metrics: {
                tvl: 0,
                positionCount: 0
              }
            };
          } catch (vaultError) {
            console.error(`Error fetching info for vault ${vaultAddress}:`, vaultError);
            // Return minimal info with empty positions array
            return {
              address: vaultAddress,
              name: "Unknown Vault",
              creationTime: 0,
              error: vaultError.message,
              positions: [],
              metrics: {
                tvl: 0,
                positionCount: 0
              }
            };
          }
        })
      );

      // Step 3: Update Redux with vault information
      dispatch(setVaults(vaultsWithInfo));
      console.log(`Successfully loaded ${vaultsWithInfo.length} vaults`);

      // Step 4: Fetch positions for each vault
      if (vaultsWithInfo.length > 0) {
        console.log("Fetching positions for each vault...");

        // Get adapters for position fetching
        const adapters = AdapterFactory.getAdaptersForChain(chainId, provider);

        if (adapters.length === 0) {
          throw new Error(`No supported platform adapters found for chainId: ${chainId}`);
        }

        // Storage for collecting all pool and token data
        const allPoolData = {};
        const allTokenData = {};

        // For each vault, fetch positions from all platforms
        for (const vault of vaultsWithInfo) {
          console.log(`Fetching positions for vault: ${vault.name} (${vault.address})`);

          const vaultPositionIds = [];

          // Try each adapter to get vault positions
          for (const adapter of adapters) {
            try {
              console.log(`Checking ${adapter.platformName} positions in vault ${vault.name}`);
              const result = await adapter.getPositions(vault.address, chainId);

              if (result && result.positions && result.positions.length > 0) {
                console.log(`Found ${result.positions.length} ${adapter.platformName} positions in vault ${vault.name}`);

                // Add position IDs to the vault's collection
                const positionIds = result.positions.map(position => position.id);
                vaultPositionIds.push(...positionIds);

                // Add these positions to Redux with vault flag
                dispatch(addVaultPositions({
                  positions: result.positions,
                  vaultAddress: vault.address
                }));

                // Collect pool and token data
                if (result.poolData) {
                  Object.assign(allPoolData, result.poolData);
                }

                if (result.tokenData) {
                  Object.assign(allTokenData, result.tokenData);
                }
              }
            } catch (adapterError) {
              console.error(`Error fetching ${adapter.platformName} positions from vault ${vault.name}:`, adapterError);
              // Continue with other adapters even if one fails
            }
          }

          // Store position IDs in the vault object
          if (vaultPositionIds.length > 0) {
            console.log(`Storing ${vaultPositionIds.length} position IDs for vault ${vault.address}`);

            // Update positions array and position count in Redux
            dispatch(updateVaultPositions({
              vaultAddress: vault.address,
              positionIds: vaultPositionIds,
              operation: 'replace'
            }));

            // Update position count right away
            dispatch(updateVaultMetrics({
              vaultAddress: vault.address,
              metrics: {
                positionCount: vaultPositionIds.length
              }
            }));

            // Calculate TVL for each vault with error handling
            try {
              await calculateVaultTVL({...vault, positions: vaultPositionIds});
            } catch (tvlError) {
              console.error(`Error calculating TVL for vault ${vault.address}:`, tvlError);
              // Continue with other vaults even if TVL calculation fails for one

              // Update metrics to show we had an error
              dispatch(updateVaultMetrics({
                vaultAddress: vault.address,
                metrics: {
                  tvl: 0,
                  hasPartialData: true,
                  lastTVLUpdate: Date.now(),
                  errorMessage: "TVL calculation failed"
                }
              }));
            }
          }
        }

        // Step 5: Batch update pool and token data to Redux
        if (Object.keys(allPoolData).length > 0) {
          dispatch(setPools(allPoolData));
        }

        if (Object.keys(allTokenData).length > 0) {
          dispatch(setTokens(allTokenData));
        }
      }

      console.log("Vault data loading completed successfully");
    } catch (loadError) {
      console.error("Error loading vault data:", loadError);
      setError(loadError.message);
      dispatch(setVaultError(`Failed to load vaults: ${loadError.message}`));
      showError(`Failed to load your vaults: ${loadError.message}`);
    } finally {
      setIsLoading(false);
      dispatch(setLoadingVaults(false));
      dispatch(setResourceUpdating({ resource: 'vaults', isUpdating: false }));
    }
  }, [address, chainId, provider, calculateVaultTVL, showError, dispatch]);

  /**
   * Recalculate TVL for all vaults
   */
  const refreshVaultTVLs = useCallback(async () => {
    if (isCalculatingRef.current || !userVaults || userVaults.length === 0) return;

    isCalculatingRef.current = true;
    try {
      console.log("Refreshing TVL for all vaults...");

      for (const vault of userVaults) {
        await calculateVaultTVL(vault);
      }

      console.log("TVL refresh completed");
    } catch (error) {
      console.error("Error refreshing vault TVLs:", error);
    } finally {
      isCalculatingRef.current = false;
    }
  }, [userVaults, calculateVaultTVL]);

  return {
    isLoading,
    error,
    loadData,
    refreshVaultTVLs
  };
};
