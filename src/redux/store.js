// redux/store.js
import { configureStore } from "@reduxjs/toolkit";
import positionsReducer from "./positionsSlice";
import poolReducer from "./poolSlice";
import tokensReducer from "./tokensSlice";
import walletReducer from "./walletSlice";
import updatesReducer from "./updateSlice";
import platformsReducer from "./platformsSlice";
import vaultsReducer from "./vaultsSlice"; // Add vaults reducer

export const store = configureStore({
  reducer: {
    positions: positionsReducer,
    pools: poolReducer,
    tokens: tokensReducer,
    wallet: walletReducer,
    updates: updatesReducer,
    platforms: platformsReducer,
    vaults: vaultsReducer, // Add vaults reducer
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        // Add wallet/setProvider to the ignored actions
        ignoredActions: [
          "wallet/setWallet",
          "wallet/setProvider",
          "positions/setPositions",
          "pools/setPools",
          "tokens/setTokens",
          "platforms/setPlatforms",
          "vaults/setVaults",
          "vaults/addVault"
        ],
        // Add wallet.provider to the ignored paths
        ignoredPaths: [
          "wallet.chainId",
          "wallet.provider",
          "positions.positions",
          "pools",
          "tokens",
          "platforms.supportedPlatforms",
          "vaults.userVaults"
        ],
      },
    }),
});
