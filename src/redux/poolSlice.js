// In src/redux/poolSlice.js

import { createSlice } from '@reduxjs/toolkit';

// Helper function for merging pool data properly
function mergePoolData(state, newPools) {
  const result = { ...state };

  Object.keys(newPools).forEach(poolAddress => {
    const newPool = newPools[poolAddress];
    const existingPool = result[poolAddress];

    if (!existingPool) {
      // If pool doesn't exist yet, just add it
      result[poolAddress] = newPool;
      return;
    }

    // Merge the pool data, with special handling for ticks
    result[poolAddress] = {
      ...existingPool,
      ...newPool,
      // Special case: preserve and merge tick data from both sources
      ticks: {
        ...(existingPool.ticks || {}),
        ...(newPool.ticks || {})
      }
    };
  });

  return result;
}

// Initial state
const initialState = {};

// Create the slice
const poolSlice = createSlice({
  name: 'pools',
  initialState,
  reducers: {
    setPools: (state, action) => {
      return mergePoolData(state, action.payload);
    },
    clearPools: () => initialState
  },
});

export const { setPools, clearPools } = poolSlice.actions;
export default poolSlice.reducer;
