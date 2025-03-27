// src/hooks/useVaultDetailData.js
import { useState, useCallback, useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { getVaultInfo } from '../utils/contracts';
import { updateVault, updateVaultMetrics } from '../redux/vaultsSlice';
import { useToast } from '../context/ToastContext';

/**
 * Custom hook for loading and managing data for a specific vault
 * @param {string} vaultAddress - The address of the vault to load data for
 */
export const useVaultDetailData = (vaultAddress) => {
  const dispatch = useDispatch();
  const { showError } = useToast();

  // Redux state
  const { address: userAddress, chainId, provider } = useSelector((state) => state.wallet);
  const { userVaults } = useSelector((state) => state.vaults);
  const { positions } = useSelector((state) => state.positions);

  // Local state
  const [vault, setVault] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isOwner, setIsOwner] = useState(false);
  const [error, setError] = useState(null);

  // Get vault positions
  const vaultPositions = positions.filter(p => p.inVault && p.vaultAddress === vaultAddress);

  /**
   * Load detailed vault data
   */
  const loadData = useCallback(async () => {
    if (!vaultAddress || !provider) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Fetch vault info from contracts
      const vaultInfo = await getVaultInfo(vaultAddress, provider);

      // Create vault object
      const vaultData = {
        address: vaultAddress,
        ...vaultInfo
      };

      // Check if user is the owner
      const isOwnerCheck = userAddress && vaultInfo.owner &&
                          userAddress.toLowerCase() === vaultInfo.owner.toLowerCase();
      setIsOwner(isOwnerCheck);

      // Update local state
      setVault(vaultData);

      // Get the Redux vault object to get positions
      const reduxVault = userVaults.find(v => v.address === vaultAddress);

      // Combine data from contract and Redux
      const combinedVault = {
        ...vaultData,
        positions: reduxVault?.positions || [],
        metrics: reduxVault?.metrics || { tvl: 0, positionCount: 0 }
      };

      // Update Redux if vault info changed
      if (reduxVault) {
        const needsUpdate =
          reduxVault.name !== vaultData.name ||
          reduxVault.owner !== vaultData.owner;

        if (needsUpdate) {
          dispatch(updateVault({
            vaultAddress,
            vaultData: combinedVault
          }));
        }
      }

      // Update position count if it's not accurate
      if (vaultPositions.length !== (combinedVault.metrics?.positionCount || 0)) {
        dispatch(updateVaultMetrics({
          vaultAddress,
          metrics: {
            positionCount: vaultPositions.length
          }
        }));
      }
    } catch (err) {
      console.error("Error fetching vault data:", err);
      setError("Failed to load vault details: " + err.message);
      showError("Error loading vault details");
    } finally {
      setIsLoading(false);
    }
  }, [vaultAddress, provider, userAddress, userVaults, dispatch, vaultPositions.length, showError]);

  return {
    vault,
    vaultPositions,
    isLoading,
    isOwner,
    error,
    loadData
  };
};
