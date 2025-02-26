import { createSlice } from "@reduxjs/toolkit";
import dummyPositions from "../utils/dummyData"; // Updated path

const positionsSlice = createSlice({
  name: "positions",
  initialState: {
    positions: dummyPositions,
  },
  reducers: {
    setPositions: (state, action) => {
      state.positions = action.payload;
    },
  },
});

export const { setPositions } = positionsSlice.actions;
export default positionsSlice.reducer;
