// redux/positionsSlice.js - Modified to support vault positions
import { createSlice } from "@reduxjs/toolkit";
import { transferPositionToVault, transferPositionFromVault } from './vaultPositionActions';

const positionsSlice = createSlice({
  name: "positions",
  initialState: {
    positions: [], // Will include both direct wallet and vault positions
    positionsLastFetched: null, // Timestamp of last full positions load (wallet + vault)
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

    // Update a single position's display data while preserving inVault/vaultAddress
    updatePosition: (state, action) => {
      const freshPosition = action.payload;
      const existingIndex = state.positions.findIndex(p => p.id === freshPosition.id);

      if (existingIndex >= 0) {
        // Preserve vault status from existing entry, update everything else
        const existing = state.positions[existingIndex];
        state.positions[existingIndex] = {
          ...freshPosition,
          inVault: existing.inVault,
          vaultAddress: existing.vaultAddress
        };
      }
    },

    // Set timestamp for when full positions list was last fetched
    setPositionsLastFetched: (state, action) => {
      state.positionsLastFetched = action.payload;
    },

    // Add a single position to Redux (e.g., direct URL navigation)
    addPosition: (state, action) => {
      const newPosition = action.payload;
      const existingIndex = state.positions.findIndex(p => p.id === newPosition.id);

      if (existingIndex === -1) {
        state.positions.push(newPosition);
      } else {
        const existing = state.positions[existingIndex];
        state.positions[existingIndex] = {
          ...newPosition,
          inVault: existing.inVault,
          vaultAddress: existing.vaultAddress
        };
      }
    },

    // Remove a position from Redux (e.g., after close/burn)
    removePosition: (state, action) => {
      state.positions = state.positions.filter(p => p.id !== action.payload);
    },

  },
  extraReducers: (builder) => {
    builder
      .addCase(transferPositionToVault, (state, action) => {
        const { positionId, vaultAddress } = action.payload;
        const position = state.positions.find(p => p.id === positionId);
        if (position) {
          position.inVault = true;
          position.vaultAddress = vaultAddress;
        }
      })
      .addCase(transferPositionFromVault, (state, action) => {
        const { positionId } = action.payload;
        const position = state.positions.find(p => p.id === positionId);
        if (position) {
          position.inVault = false;
          position.vaultAddress = null;
        }
      });
  },
});

export const {
  setPositions,
  addVaultPositions,
  updatePosition,
  addPosition,
  removePosition,
  setPositionsLastFetched
} = positionsSlice.actions;

export default positionsSlice.reducer;
