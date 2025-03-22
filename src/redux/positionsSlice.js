// redux/positionsSlice.js - Modified to support vault positions
import { createSlice } from "@reduxjs/toolkit";

const positionsSlice = createSlice({
  name: "positions",
  initialState: {
    positions: [], // Will include both direct wallet and vault positions
  },
  reducers: {
    setPositions: (state, action) => {
      // Ensure we maintain the inVault property for existing positions if present
      if (state.positions.length > 0 && action.payload.length > 0) {
        // Create a mapping of existing positions with inVault flags
        const existingPositionMap = state.positions.reduce((map, pos) => {
          if (pos.inVault) {
            map[pos.id] = { inVault: pos.inVault, vaultAddress: pos.vaultAddress };
          }
          return map;
        }, {});

        // Apply inVault flags to new positions if they existed before
        state.positions = action.payload.map(position => {
          if (existingPositionMap[position.id]) {
            return {
              ...position,
              inVault: existingPositionMap[position.id].inVault,
              vaultAddress: existingPositionMap[position.id].vaultAddress
            };
          }
          return position;
        });
      } else {
        // Just set the positions if we don't have existing data to preserve
        state.positions = action.payload;
      }
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

      // Create a set of IDs for fast lookup
      const existingIds = new Set(state.positions.map(p => p.id));

      // Add only positions that don't already exist
      vaultPositions.forEach(position => {
        if (!existingIds.has(position.id)) {
          state.positions.push(position);
        } else {
          // Update existing position to mark it as in vault if needed
          const index = state.positions.findIndex(p => p.id === position.id);
          if (index !== -1) {
            state.positions[index] = {
              ...state.positions[index],
              inVault: true,
              vaultAddress
            };
          }
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
