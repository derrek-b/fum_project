// redux/platformsSlice.js
import { createSlice } from "@reduxjs/toolkit";

const platformsSlice = createSlice({
  name: "platforms",
  initialState: {
    supportedPlatforms: [], // List of supported platforms on the current chain
    activePlatforms: [], // List of platforms with active positions
    platformFilter: null, // Filter to show positions from a specific platform (null = show all)
  },
  reducers: {
    setPlatforms: (state, action) => {
      state.supportedPlatforms = action.payload;
    },
    setActivePlatforms: (state, action) => {
      state.activePlatforms = action.payload;
    },
    setPlatformFilter: (state, action) => {
      state.platformFilter = action.payload;
    },
    clearPlatforms: (state) => {
      state.supportedPlatforms = [];
      state.activePlatforms = [];
      state.platformFilter = null;
    },
  },
});

export const {
  setPlatforms,
  setActivePlatforms,
  setPlatformFilter,
  clearPlatforms
} = platformsSlice.actions;

export default platformsSlice.reducer;
