// redux/store.js
import { configureStore } from "@reduxjs/toolkit";
import positionsReducer from "./positionsSlice";
import poolReducer from "./poolSlice";
import tokensReducer from "./tokensSlice";
import walletReducer from "./walletSlice";
import updatesReducer from "./updateSlice";

export const store = configureStore({
  reducer: {
    positions: positionsReducer,
    pools: poolReducer,
    tokens: tokensReducer,
    wallet: walletReducer,
    updates: updatesReducer, // Added new reducer
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        ignoredActions: ["wallet/setWallet", "positions/setPositions", "pools/setPools", "tokens/setTokens"],
        ignoredPaths: ["wallet.chainId", "positions.positions", "pools", "tokens"],
      },
    }),
});

export default store;
