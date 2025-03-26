// src/redux/strategiesSlice.js
import { createSlice } from "@reduxjs/toolkit";

const strategiesSlice = createSlice({
  name: "strategies",
  initialState: {
    // Available strategy templates
    availableStrategies: {
      // The Fed - Stablecoin strategy
      "the-fed": {
        id: "the-fed",
        name: "The Fed",
        description: "Automated stablecoin strategy with peg deviation positioning and range optimization",
        supportedPairs: ["USDC/USDT", "USDC/DAI", "DAI/USDT"], // Supported token pairs
        parameters: {
          targetRange: 0.5, // Default range around peg (0.5%)
          rebalanceThreshold: 1.0, // Price threshold for rebalancing (1.0%)
          feeReinvestment: true, // Auto-reinvest fees
          maxSlippage: 0.5, // Max slippage tolerance (0.5%)
        },
        // User-friendly parameter descriptions
        parameterDescriptions: {
          targetRange: "Range around the peg (1.00) to set position bounds",
          rebalanceThreshold: "Price deviation that triggers a rebalance",
          feeReinvestment: "Automatically reinvest collected fees",
          maxSlippage: "Maximum allowed slippage for transactions",
        }
      }
    },

    // User strategy configurations
    strategyConfigs: {},

    // Active strategies by vault
    activeStrategies: {},

    // Strategy performance data
    strategyPerformance: {},

    // Execution history
    executionHistory: {},

    // Loading states
    isLoadingStrategies: false,

    // Errors
    strategyError: null,
  },
  reducers: {
    // Add/update strategy configuration for a vault
    setStrategyConfig: (state, action) => {
      const { vaultAddress, strategyId, config } = action.payload;
      state.strategyConfigs[vaultAddress] = {
        strategyId,
        ...config
      };
    },

    // Set strategy activation status for a vault
    setStrategyActive: (state, action) => {
      const { vaultAddress, isActive } = action.payload;

      if (!state.strategyConfigs[vaultAddress]) {
        return; // Skip if no config exists
      }

      // Update active status
      state.activeStrategies[vaultAddress] = {
        strategyId: state.strategyConfigs[vaultAddress].strategyId,
        isActive
      };
    },

    // Update strategy performance data
    updatePerformance: (state, action) => {
      const { vaultAddress, performanceData } = action.payload;
      state.strategyPerformance[vaultAddress] = {
        ...state.strategyPerformance[vaultAddress],
        ...performanceData,
        lastUpdated: Date.now()
      };
    },

    // Add execution record to history
    addExecutionRecord: (state, action) => {
      const { vaultAddress, record } = action.payload;

      if (!state.executionHistory[vaultAddress]) {
        state.executionHistory[vaultAddress] = [];
      }

      state.executionHistory[vaultAddress].unshift({
        ...record,
        timestamp: Date.now()
      });

      // Keep only last 20 records per vault
      if (state.executionHistory[vaultAddress].length > 20) {
        state.executionHistory[vaultAddress] = state.executionHistory[vaultAddress].slice(0, 20);
      }
    },

    // Set loading state
    setLoadingStrategies: (state, action) => {
      state.isLoadingStrategies = action.payload;
    },

    // Set error state
    setStrategyError: (state, action) => {
      state.strategyError = action.payload;
    },

    // Clear strategies for a single vault
    clearVaultStrategies: (state, action) => {
      const vaultAddress = action.payload;

      delete state.strategyConfigs[vaultAddress];
      delete state.activeStrategies[vaultAddress];
      delete state.strategyPerformance[vaultAddress];
      delete state.executionHistory[vaultAddress];
    },

    // Clear all strategies (e.g., on disconnect)
    clearAllStrategies: (state) => {
      state.strategyConfigs = {};
      state.activeStrategies = {};
      state.strategyPerformance = {};
      state.executionHistory = {};
      state.strategyError = null;
    }
  }
});

export const {
  setStrategyConfig,
  setStrategyActive,
  updatePerformance,
  addExecutionRecord,
  setLoadingStrategies,
  setStrategyError,
  clearVaultStrategies,
  clearAllStrategies
} = strategiesSlice.actions;

export default strategiesSlice.reducer;
