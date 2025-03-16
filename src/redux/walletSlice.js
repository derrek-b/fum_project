import { createSlice } from "@reduxjs/toolkit";

const walletSlice = createSlice({
  name: "wallet",
  initialState: {
    address: null,
    chainId: null, // Ensure this is null initially, a number when set
    isConnected: false,
    provider: null, // Added provider to state
  },
  reducers: {
    setWallet: (state, action) => {
      state.address = action.payload.address;
      state.chainId = action.payload.chainId; // Number is serializable, but ensure it's a plain number
      state.isConnected = true;

      // If provider is included in the payload, store it
      if (action.payload.provider) {
        state.provider = action.payload.provider;
      }
    },
    setProvider: (state, action) => {
      state.provider = action.payload;
    },
    disconnectWallet: (state) => {
      state.address = null;
      state.chainId = null;
      state.isConnected = false;
      state.provider = null;
    },
  },
});

export const { setWallet, disconnectWallet, setProvider } = walletSlice.actions;
export default walletSlice.reducer;
