// redux/poolSlice.js
import { createSlice } from "@reduxjs/toolkit";

const poolSlice = createSlice({
  name: "pools",
  initialState: {},
  reducers: {
    setPools: (state, action) => {
      // Merge the action payload into the existing state
      Object.assign(state, action.payload);
    },
    clearPools: (state) => {
      // Explicitly clear all pools if needed
      Object.keys(state).forEach(key => delete state[key]);
    },
  },
});

export const { setPools, clearPools } = poolSlice.actions;
export default poolSlice.reducer;
