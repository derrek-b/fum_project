import { configureStore } from "@reduxjs/toolkit";
import positionsReducer from "./positionsSlice";
import walletReducer from "./walletSlice";

export const store = configureStore({
  reducer: {
    positions: positionsReducer,
    wallet: walletReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        ignoredActions: ["wallet/setWallet", "positions/setPositions"], // Ignore both wallet and positions actions
        ignoredPaths: ["wallet.chainId", "positions.positions"], // Ignore chainId and positions in state
      },
    }),
});

export default store;
