// redux/positionsSlice.js
import { createSlice } from "@reduxjs/toolkit";

const positionsSlice = createSlice({
  name: "positions",
  initialState: {
    positions: [],
  },
  reducers: {
    setPositions: (state, action) => {
      state.positions = action.payload;
    },
  },
});

export const { setPositions } = positionsSlice.actions;
export default positionsSlice.reducer;
