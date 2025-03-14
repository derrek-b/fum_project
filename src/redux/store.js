// redux/store.js
import { configureStore } from "@reduxjs/toolkit";
import positionsReducer from "./positionsSlice";
import poolReducer from "./poolSlice";
import tokensReducer from "./tokensSlice";
import walletReducer from "./walletSlice";
import updatesReducer from "./updateSlice";
import platformsReducer from "./platformsSlice"; // New platforms reducer

export const store = configureStore({
  reducer: {
    positions: positionsReducer,
    pools: poolReducer,
    tokens: tokensReducer,
    wallet: walletReducer,
    updates: updatesReducer,
    platforms: platformsReducer, // Added platforms reducer
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        ignoredActions: [
          "wallet/setWallet",
          "positions/setPositions",
          "pools/setPools",
          "tokens/setTokens",
          "platforms/setPlatforms"
        ],
        ignoredPaths: [
          "wallet.chainId",
          "positions.positions",
          "pools",
          "tokens",
          "platforms.supportedPlatforms"
        ],
      },
    }),
});
