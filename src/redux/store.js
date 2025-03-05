// redux/store.js
import { configureStore } from "@reduxjs/toolkit";
import positionsReducer from "./positionsSlice";
import poolReducer from "./poolSlice";
import tokensReducer from "./tokensSlice";
import walletReducer from "./walletSlice";

export const store = configureStore({
  reducer: {
    positions: positionsReducer,
    pools: poolReducer,
    tokens: tokensReducer,
    wallet: walletReducer,
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
