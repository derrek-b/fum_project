// redux/tokensSlice.js
import { createSlice } from "@reduxjs/toolkit";

const tokensSlice = createSlice({
  name: "tokens",
  initialState: {},
  reducers: {
    setTokens: (state, action) => {
      Object.assign(state, action.payload);
    },
    clearTokens: (state) => {
      Object.keys(state).forEach(key => delete state[key]);
    },
  },
});

export const { setTokens, clearTokens } = tokensSlice.actions;
export default tokensSlice.reducer;
