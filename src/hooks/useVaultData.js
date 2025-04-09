// src/hooks/useVaultData.js
import { useState, useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { getUserVaults, getVaultInfo } from '../utils/contracts';
import { AdapterFactory } from '../adapters';
import { setVaults, updateVaultPositions, updateVaultMetrics } from '../redux/vaultsSlice';
import { addVaultPositions, setPositions } from '../redux/positionsSlice';
import { setPools } from '../redux/poolSlice';
import { setTokens } from '../redux/tokensSlice';
import { setResourceUpdating } from '../redux/updateSlice';
import { fetchTokenPrices, calculateUsdValue } from '../utils/coingeckoUtils';
import { useToast } from '../context/ToastContext';

/**
 * Custom hook for loading vault data and non-vault positions
 */
export const useVaultData = () => {
  const dispatch = useDispatch();
  const { showError } = useToast();

  // Redux state
  const { isConnected, address, chainId, provider } = useSelector((state) => state.wallet);
  const { lastUpdate } = useSelector((state) => state.updates);

  // Local state
  const [isLoading, setIsLoading] = useState(true);

  // Load all data effect
  useEffect(() => {
    if (!isConnected || !address || !provider || !chainId) {
      setIsLoading(false);
      return;
    }

    async function loadData() {
      try {
        console.log("Started loading vault data");
        setIsLoading(true);
        dispatch(setResourceUpdating({ resource: 'vaults', isUpdating: true }));

        // 1. Fetch vaults
        const vaultAddresses = await getUserVaults(address, provider);

        // 2. Get vault info
        const vaultsWithInfo = await Promise.all(
          vaultAddresses.map(async (vaultAddress) => {
            try {
              const info = await getVaultInfo(vaultAddress, provider);
              return {
                address: vaultAddress,
                ...info,
                positions: [],
                metrics: { tvl: 0, positionCount: 0 }
              };
            } catch (error) {
              return {
                address: vaultAddress,
                name: "Unknown Vault",
                creationTime: 0,
                positions: [],
                metrics: { tvl: 0, positionCount: 0 }
              };
            }
          })
        );

        // 3. Update Redux with vault info
        dispatch(setVaults(vaultsWithInfo));

        // 4. Collect vault positions, pools, tokens
        const vaultPositions = [];
        const allPoolData = {};
        const allTokenData = {};
        const positionsByVault = {};

        // Get adapters
        const adapters = AdapterFactory.getAdaptersForChain(chainId, provider);

        // Fetch positions for each vault
        for (const vault of vaultsWithInfo) {
          const vaultPositionIds = [];
          const currentVaultPositions = [];

          for (const adapter of adapters) {
            try {
              const result = await adapter.getPositions(vault.address, chainId);

              if (result?.positions?.length > 0) {
                // Collect positions
                result.positions.forEach(position => {
                  vaultPositionIds.push(position.id);
                  currentVaultPositions.push(position);
                  vaultPositions.push(position);
                });

                // Collect pool data
                if (result.poolData) {
                  Object.assign(allPoolData, result.poolData);
                }

                // Collect token data
                if (result.tokenData) {
                  Object.assign(allTokenData, result.tokenData);
                }
              }
            } catch (error) {
              console.error(`Error fetching positions for vault ${vault.address}: ${error.message}`);
            }
          }

          // Update vault position IDs
          if (vaultPositionIds.length > 0) {
            dispatch(updateVaultPositions({
              vaultAddress: vault.address,
              positionIds: vaultPositionIds,
              operation: 'replace'
            }));

            // Update position count
            dispatch(updateVaultMetrics({
              vaultAddress: vault.address,
              metrics: { positionCount: vaultPositionIds.length }
            }));

            // Store positions for TVL calculation
            positionsByVault[vault.address] = currentVaultPositions;
          }
        }

        // 5. Fetch non-vault positions for the add position modal
        const allPositions = [...vaultPositions]; // Start with vault positions

        // Try each adapter to get non-vault positions
        for (const adapter of adapters) {
          try {
            const result = await adapter.getNonVaultPositions(address, vaultAddresses, chainId);

            if (result?.positions?.length > 0) {

              // Add positions to our collection
              allPositions.push(...result.positions);

              // Collect additional pool and token data
              if (result.poolData) {
                Object.assign(allPoolData, result.poolData);
              }

              if (result.tokenData) {
                Object.assign(allTokenData, result.tokenData);
              }
            }
          } catch (error) {
            console.error(`Error fetching non-vault positions from ${adapter.platformName}: ${error.message}`);
          }
        }

        // 6. Update Redux with ALL position data
        dispatch(setPositions(allPositions));

        // Only add vault positions with the vault flag
        if (vaultPositions.length > 0) {
          dispatch(addVaultPositions({ positions: vaultPositions }));
        }

        if (Object.keys(allPoolData).length > 0) {
          dispatch(setPools(allPoolData));
        }

        if (Object.keys(allTokenData).length > 0) {
          dispatch(setTokens(allTokenData));
        }

        // 7. Calculate and update TVL
        for (const vault of vaultsWithInfo) {
          const vaultPositions = positionsByVault[vault.address] || [];

          if (vaultPositions.length === 0) {
            continue;
          }

          // Get unique token symbols and position data
          const tokenSymbols = new Set();
          const positionData = [];

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
          let tokenPrices = {};
          let pricesFetchFailed = false;

          try {
            tokenPrices = await fetchTokenPrices(Array.from(tokenSymbols));
          } catch (error) {
            console.error(`Error fetching token prices: ${error.message}`);
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

              const token0UsdValue = calculateUsdValue(
                tokenBalances.token0.formatted,
                tokenPrices[data.token0Data.symbol]
              );

              const token1UsdValue = calculateUsdValue(
                tokenBalances.token1.formatted,
                tokenPrices[data.token1Data.symbol]
              );

              if (token0UsdValue) totalTVL += token0UsdValue;
              if (token1UsdValue) totalTVL += token1UsdValue;
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

        console.log("All vault data loaded and TVL calculated");
      } catch (error) {
        console.error(`Error loading data: ${error.message}`);
        showError(`Failed to load vault data: ${error.message}`);
      } finally {
        setIsLoading(false);
        dispatch(setResourceUpdating({ resource: 'vaults', isUpdating: false }));
      }
    }

    loadData();
  }, [isConnected, address, provider, chainId, lastUpdate, dispatch, showError]);

  // Return the loading state (but no complex data or functions)
  return { isLoading };
};
