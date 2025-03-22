// redux/vaultsSlice.js
import { createSlice } from "@reduxjs/toolkit";

const vaultsSlice = createSlice({
  name: "vaults",
  initialState: {
    userVaults: [], // List of user's vaults with their details
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
  clearVaults,
  setLoadingVaults,
  setVaultError
} = vaultsSlice.actions;

export default vaultsSlice.reducer;
