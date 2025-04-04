// src/redux/strategiesSlice.js
import { createSlice } from "@reduxjs/toolkit";

const strategiesSlice = createSlice({
  name: "strategies",
  initialState: {
    // Available strategy templates with just the 4 fields we need
    availableStrategies: []
  },
  reducers: {
    // Set available strategies
    setAvailableStrategies: (state, action) => {
      // Replace all available strategies with the provided list
      state.availableStrategies = action.payload;
    }
  }
});

export const { setAvailableStrategies } = strategiesSlice.actions;

export default strategiesSlice.reducer;
