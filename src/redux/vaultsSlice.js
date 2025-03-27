// redux/vaultsSlice.js - Updated with direct position IDs in vault objects
import { createSlice } from "@reduxjs/toolkit";

const vaultsSlice = createSlice({
  name: "vaults",
  initialState: {
    userVaults: [], // List of user's vaults with their details INCLUDING position IDs and metrics
    isLoadingVaults: false, // Loading state for vaults
    vaultError: null, // Any error during vault loading or operations
  },
  reducers: {
    setVaults: (state, action) => {
      // Initialize vaults with empty positions arrays and metrics if not provided
      state.userVaults = action.payload.map(vault => ({
        ...vault,
        positions: vault.positions || [], // Ensure positions array exists
        metrics: vault.metrics || {        // Ensure metrics object exists
          tvl: 0,
          positionCount: 0
        }
      }));
    },
    addVault: (state, action) => {
      // Add a single new vault to the list, with empty positions array and metrics if not provided
      const newVault = {
        ...action.payload,
        positions: action.payload.positions || [],
        metrics: action.payload.metrics || {
          tvl: 0,
          positionCount: 0
        }
      };
      state.userVaults.push(newVault);
    },
    updateVault: (state, action) => {
      // Update a specific vault's details, preserving positions if not provided
      const { vaultAddress, vaultData } = action.payload;
      const index = state.userVaults.findIndex(v => v.address === vaultAddress);
      if (index !== -1) {
        // Keep existing positions and metrics if not included in update
        const existingPositions = state.userVaults[index].positions || [];
        const existingMetrics = state.userVaults[index].metrics || { tvl: 0, positionCount: 0 };

        state.userVaults[index] = {
          ...state.userVaults[index],
          ...vaultData,
          positions: vaultData.positions || existingPositions,
          metrics: vaultData.metrics || existingMetrics
        };
      }
    },
    // Set or replace all positions for a vault
    setVaultPositions: (state, action) => {
      const { vaultAddress, positionIds } = action.payload;
      const vaultIndex = state.userVaults.findIndex(v => v.address === vaultAddress);

      if (vaultIndex !== -1) {
        state.userVaults[vaultIndex].positions = positionIds;
      }
    },
    // Add a single position to a vault
    addPositionToVault: (state, action) => {
      const { vaultAddress, positionId } = action.payload;
      const vaultIndex = state.userVaults.findIndex(v => v.address === vaultAddress);

      if (vaultIndex !== -1) {
        // Initialize positions array if it doesn't exist
        if (!state.userVaults[vaultIndex].positions) {
          state.userVaults[vaultIndex].positions = [];
        }

        // Add position if not already present
        if (!state.userVaults[vaultIndex].positions.includes(positionId)) {
          state.userVaults[vaultIndex].positions.push(positionId);
        }
      }
    },
    // Remove a position from a vault
    removePositionFromVault: (state, action) => {
      const { vaultAddress, positionId } = action.payload;
      const vaultIndex = state.userVaults.findIndex(v => v.address === vaultAddress);

      if (vaultIndex !== -1 && state.userVaults[vaultIndex].positions) {
        state.userVaults[vaultIndex].positions = state.userVaults[vaultIndex].positions
          .filter(id => id !== positionId);
      }
    },
    // Update multiple positions for a vault
    updateVaultPositions: (state, action) => {
      const { vaultAddress, positionIds, operation } = action.payload;
      const vaultIndex = state.userVaults.findIndex(v => v.address === vaultAddress);

      if (vaultIndex === -1) return;

      // Initialize positions array if needed
      if (!state.userVaults[vaultIndex].positions) {
        state.userVaults[vaultIndex].positions = [];
      }

      switch (operation) {
        case 'add':
          // Add positions that aren't already in the vault
          positionIds.forEach(id => {
            if (!state.userVaults[vaultIndex].positions.includes(id)) {
              state.userVaults[vaultIndex].positions.push(id);
            }
          });
          break;
        case 'remove':
          // Remove specified positions
          state.userVaults[vaultIndex].positions = state.userVaults[vaultIndex].positions
            .filter(id => !positionIds.includes(id));
          break;
        case 'replace':
          // Replace all positions
          state.userVaults[vaultIndex].positions = positionIds;
          break;
        default:
          // Default is to add (same as 'add' case)
          positionIds.forEach(id => {
            if (!state.userVaults[vaultIndex].positions.includes(id)) {
              state.userVaults[vaultIndex].positions.push(id);
            }
          });
      }
    },
    updateVaultMetrics: (state, action) => {
      // Update metrics for a vault
      const { vaultAddress, metrics } = action.payload;
      const vaultIndex = state.userVaults.findIndex(v => v.address === vaultAddress);

      if (vaultIndex !== -1) {
        // Initialize metrics object if it doesn't exist
        if (!state.userVaults[vaultIndex].metrics) {
          state.userVaults[vaultIndex].metrics = {};
        }

        // Update metrics in the vault object
        state.userVaults[vaultIndex].metrics = {
          ...state.userVaults[vaultIndex].metrics,
          ...metrics,
          lastUpdated: Date.now()
        };
      }
    },
    clearVaults: (state) => {
      state.userVaults = [];
      state.vaultError = null;
    },
    setLoadingVaults: (state, action) => {
      state.isLoadingVaults = action.payload;
    },
    setVaultError: (state, action) => {
      state.vaultError = action.payload;
    },
  },
});

export const {
  setVaults,
  addVault,
  updateVault,
  setVaultPositions,
  addPositionToVault,
  removePositionFromVault,
  updateVaultPositions, // New action for batch operations
  updateVaultMetrics,
  clearVaults,
  setLoadingVaults,
  setVaultError
} = vaultsSlice.actions;

export default vaultsSlice.reducer;
