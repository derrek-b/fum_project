// src/utils/vaultsHelpers.js
import { AdapterFactory } from '../adapters';
import { setPositions, addVaultPositions } from '../redux/positionsSlice';
import { setPools } from '../redux/poolSlice';
import { setTokens } from '../redux/tokensSlice';
import { updateVaultPositions, updateVaultMetrics } from '../redux/vaultsSlice';
import { getUserVaults, getVaultInfo } from './contracts';
import { fetchTokenPrices, calculateUsdValue } from './coingeckoUtils';
import { triggerUpdate } from '../redux/updateSlice';

/**
 * Load vault data and its positions directly from chain
 * @param {string} vaultAddress - The vault address
 * @param {object} provider - Ethers provider
 * @param {number} chainId - Chain ID
 * @param {function} dispatch - Redux dispatch function
 * @param {object} options - Additional options
 * @returns {Promise<object>} Result object with success status
 */
export const loadVaultData = async (vaultAddress, provider, chainId, dispatch, options = {}) => {
  const { showError, showSuccess } = options;

  if (!vaultAddress || !provider || !chainId || !dispatch) {
    const error = "Missing required parameters for loading vault data";
    if (showError) showError(error);
    return { success: false, error };
  }

  try {
    console.log(`Loading data for vault: ${vaultAddress}`);

    // 1. Get basic vault info
    const vaultInfo = await getVaultInfo(vaultAddress, provider);
    const vaultData = {
      address: vaultAddress,
      ...vaultInfo
    };

    // 2. Get adapters for the current chain
    const adapters = AdapterFactory.getAdaptersForChain(chainId, provider);
    if (adapters.length === 0) {
      const error = `No adapters available for chain ID ${chainId}`;
      if (showError) showError(error);
      return { success: false, error, vault: vaultData };
    }

    // 3. Load positions from all adapters
    const vaultPositions = [];
    const allPoolData = {};
    const allTokenData = {};

    for (const adapter of adapters) {
      try {
        console.log(`Fetching ${adapter.platformName} positions for vault ${vaultAddress}`);
        const result = await adapter.getPositions(vaultAddress, chainId);

        if (result?.positions?.length > 0) {
          console.log(`Found ${result.positions.length} ${adapter.platformName} positions in vault`);

          // Mark positions as being in vault
          const markedPositions = result.positions.map(position => ({
            ...position,
            inVault: true,
            vaultAddress
          }));

          vaultPositions.push(...markedPositions);

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

    // 4. Update Redux state
    const positionIds = vaultPositions.map(p => p.id);

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
    const result = await loadVaultData(vaultAddress, provider, chainId, dispatch, { showError });

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
