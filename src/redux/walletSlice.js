import { createSlice } from "@reduxjs/toolkit";

// LocalStorage key for wallet connection
const WALLET_STORAGE_KEY = "fum_wallet_connection";

// Load wallet state from localStorage
const loadWalletFromStorage = () => {
  if (typeof window === "undefined") return null;
  try {
    const stored = localStorage.getItem(WALLET_STORAGE_KEY);
    return stored ? JSON.parse(stored) : null;
  } catch (error) {
    console.error("Error loading wallet from localStorage:", error);
    return null;
  }
};

// Save wallet state to localStorage
const saveWalletToStorage = (address, chainId) => {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(WALLET_STORAGE_KEY, JSON.stringify({ address, chainId }));
  } catch (error) {
    console.error("Error saving wallet to localStorage:", error);
  }
};

// Clear wallet state from localStorage
const clearWalletFromStorage = () => {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(WALLET_STORAGE_KEY);
  } catch (error) {
    console.error("Error clearing wallet from localStorage:", error);
  }
};

// Get initial state from localStorage or defaults
const storedWallet = loadWalletFromStorage();
const initialState = storedWallet
  ? {
      address: storedWallet.address,
      chainId: storedWallet.chainId,
      isConnected: false, // Set to false initially, will be true after reconnection
      isReconnecting: false, // Track auto-reconnect status
    }
  : {
      address: null,
      chainId: null,
      isConnected: false,
      isReconnecting: false,
    };

const walletSlice = createSlice({
  name: "wallet",
  initialState,
  reducers: {
    setWallet: (state, action) => {
      state.address = action.payload.address;
      state.chainId = action.payload.chainId; // Number is serializable, but ensure it's a plain number
      state.isConnected = true;
      state.isReconnecting = false; // Clear reconnecting flag on successful connection
      // Save to localStorage for persistence
      saveWalletToStorage(action.payload.address, action.payload.chainId);
    },
    disconnectWallet: (state) => {
      state.address = null;
      state.chainId = null;
      state.isConnected = false;
      state.isReconnecting = false; // Clear reconnecting flag on disconnect
      // Clear from localStorage
      clearWalletFromStorage();
    },
    setReconnecting: (state, action) => {
      state.isReconnecting = action.payload;
    },
  },
});

export const { setWallet, disconnectWallet, setReconnecting } = walletSlice.actions;
export default walletSlice.reducer;
