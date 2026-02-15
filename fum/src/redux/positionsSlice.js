// redux/positionsSlice.js - Modified to support vault positions
import { createSlice } from "@reduxjs/toolkit";

const positionsSlice = createSlice({
  name: "positions",
  initialState: {
    positions: [], // Will include both direct wallet and vault positions
  },
  reducers: {
    setPositions: (state, action) => {
      // This sets wallet positions while preserving vault positions
      // First, filter out any existing vault positions
      const vaultPositions = state.positions.filter(pos => pos.inVault);

      // Mark incoming positions as NOT in vault (these are wallet positions)
      const walletPositions = action.payload.map(position => ({
        ...position,
        inVault: false,
        vaultAddress: null
      }));

      // Combine wallet positions with existing vault positions
      state.positions = [...walletPositions, ...vaultPositions];
    },

    // New reducer to specifically add vault positions
    addVaultPositions: (state, action) => {
      const { positions, vaultAddress } = action.payload;

      // Mark all these positions as coming from a vault
      const vaultPositions = positions.map(position => ({
        ...position,
        inVault: true,
        vaultAddress
      }));

      // Add only positions that don't already exist, update those that do
      vaultPositions.forEach(newPosition => {
        const existingIndex = state.positions.findIndex(p => p.id === newPosition.id);

        if (existingIndex === -1) {
          // Position doesn't exist, add it
          state.positions.push(newPosition);
        } else {
          // Position exists, update it instead of adding duplicate
          state.positions[existingIndex] = {
            ...state.positions[existingIndex],
            ...newPosition,
            inVault: true,
            vaultAddress
          };
        }
      });
    },

    // Mark a position as being in a vault
    setPositionVaultStatus: (state, action) => {
      const { positionId, inVault, vaultAddress } = action.payload;
      const position = state.positions.find(p => p.id === positionId);

      if (position) {
        position.inVault = inVault;
        position.vaultAddress = inVault ? vaultAddress : null;
      }
    },
  },
});

export const {
  setPositions,
  addVaultPositions,
  setPositionVaultStatus
} = positionsSlice.actions;

export default positionsSlice.reducer;
