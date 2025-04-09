// src/redux/strategiesSlice.js
import { createSlice } from "@reduxjs/toolkit";

const strategiesSlice = createSlice({
  name: "strategies",
  initialState: {
    // Available strategy templates with addresses field added
    availableStrategies: []
  },
  reducers: {
    // Set available strategies
    setAvailableStrategies: (state, action) => {
      // Replace all available strategies with the provided list
      state.availableStrategies = action.payload;
    },

    // Add/update contract address for a strategy
    setStrategyAddress: (state, action) => {
      const { strategyId, chainId, address } = action.payload;

      // Find the strategy and update its address
      const strategy = state.availableStrategies.find(s => s.id === strategyId);
      if (strategy) {
        if (!strategy.addresses) {
          strategy.addresses = {};
        }
        strategy.addresses[chainId] = address;
      }
    }
  }
});

export const { setAvailableStrategies, setStrategyAddress } = strategiesSlice.actions;

export default strategiesSlice.reducer;
