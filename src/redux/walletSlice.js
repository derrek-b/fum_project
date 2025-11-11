import { createSlice } from "@reduxjs/toolkit";

const walletSlice = createSlice({
  name: "wallet",
  initialState: {
    address: null,
    chainId: null, // Ensure this is null initially, a number when set
    isConnected: false,
  },
  reducers: {
    setWallet: (state, action) => {
      state.address = action.payload.address;
      state.chainId = action.payload.chainId; // Number is serializable, but ensure it's a plain number
      state.isConnected = true;
    },
    disconnectWallet: (state) => {
      state.address = null;
      state.chainId = null;
      state.isConnected = false;
    },
  },
});

export const { setWallet, disconnectWallet } = walletSlice.actions;
export default walletSlice.reducer;
