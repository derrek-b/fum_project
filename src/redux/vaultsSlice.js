// redux/vaultsSlice.js - Enhanced version with strategy integration
import { createSlice } from "@reduxjs/toolkit";

const vaultsSlice = createSlice({
  name: "vaults",
  initialState: {
    userVaults: [], // List of user's vaults with their details
    vaultPositions: {}, // Positions in each vault by vaultAddress -> positionIds
    vaultMetrics: {}, // Metrics for each vault by vaultAddress (TVL, APY, etc.)
    isLoadingVaults: false, // Loading state for vaults
    vaultError: null, // Any error during vault loading or operations
  },
  reducers: {
    setVaults: (state, action) => {
      state.userVaults = action.payload;
    },
    addVault: (state, action) => {
      // Add a single new vault to the list
      state.userVaults.push(action.payload);
    },
    updateVault: (state, action) => {
      // Update a specific vault's details
      const { vaultAddress, vaultData } = action.payload;
      const index = state.userVaults.findIndex(v => v.address === vaultAddress);
      if (index !== -1) {
        state.userVaults[index] = { ...state.userVaults[index], ...vaultData };
      }
    },
    setVaultPositions: (state, action) => {
      // Set positions for a vault
      const { vaultAddress, positionIds } = action.payload;
      state.vaultPositions[vaultAddress] = positionIds;
    },
    addPositionToVault: (state, action) => {
      // Add a position to a vault
      const { vaultAddress, positionId } = action.payload;
      if (!state.vaultPositions[vaultAddress]) {
        state.vaultPositions[vaultAddress] = [];
      }
      if (!state.vaultPositions[vaultAddress].includes(positionId)) {
        state.vaultPositions[vaultAddress].push(positionId);
      }
    },
    removePositionFromVault: (state, action) => {
      // Remove a position from a vault
      const { vaultAddress, positionId } = action.payload;
      if (state.vaultPositions[vaultAddress]) {
        state.vaultPositions[vaultAddress] = state.vaultPositions[vaultAddress]
          .filter(id => id !== positionId);
      }
    },
    updateVaultMetrics: (state, action) => {
      // Update metrics for a vault
      const { vaultAddress, metrics } = action.payload;
      state.vaultMetrics[vaultAddress] = {
        ...state.vaultMetrics[vaultAddress],
        ...metrics,
        lastUpdated: Date.now()
      };
    },
    clearVaults: (state) => {
      state.userVaults = [];
      state.vaultPositions = {};
      state.vaultMetrics = {};
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
  updateVaultMetrics,
  clearVaults,
  setLoadingVaults,
  setVaultError
} = vaultsSlice.actions;

export default vaultsSlice.reducer;
