// redux/store.js - Updated to include strategiesSlice
import { configureStore } from "@reduxjs/toolkit";
import positionsReducer from "./positionsSlice";
import walletReducer from "./walletSlice";
import updatesReducer from "./updateSlice";
import platformsReducer from "./platformsSlice";
import vaultsReducer from "./vaultsSlice";
import strategiesReducer from "./strategiesSlice"; // Add strategiesReducer
import automationReducer from "./automationSlice";

export const store = configureStore({
  reducer: {
    positions: positionsReducer,
    wallet: walletReducer,
    updates: updatesReducer,
    platforms: platformsReducer,
    vaults: vaultsReducer,
    strategies: strategiesReducer, // Add strategies reducer
    automation: automationReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        // Add strategy-related actions to ignored actions
        ignoredActions: [
          "wallet/setWallet",
          "positions/setPositions",
          "platforms/setPlatforms",
          "vaults/setVaults",
          "vaults/addVault",
          "strategies/setStrategyConfig",
          "strategies/updatePerformance",
          "strategies/addExecutionRecord"
        ],
        // Add strategies to ignored paths
        ignoredPaths: [
          "wallet.chainId",
          "positions.positions",
          "platforms.supportedPlatforms",
          "vaults.userVaults",
          "strategies.strategyConfigs",
          "strategies.executionHistory"
        ],
      },
    }),
});
