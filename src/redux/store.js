import { configureStore } from "@reduxjs/toolkit";
import positionsReducer from "./positionsSlice";
import walletReducer from "./walletSlice";

export const store = configureStore({
  reducer: {
    positions: positionsReducer,
    wallet: walletReducer,
  },
  // Optional: Configure serializableCheck to ignore non-serializable errors for chainId
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        ignoredActions: ["wallet/setWallet"], // Ignore setWallet actions
        ignoredPaths: ["wallet.chainId"], // Ignore chainId in state
      },
    }),
});

export default store;
