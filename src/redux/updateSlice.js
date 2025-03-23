// redux/updateSlice.js
import { createSlice } from "@reduxjs/toolkit";

const updateSlice = createSlice({
  name: "updates",
  initialState: {
    lastUpdate: Date.now(),
    isUpdating: false,
    autoRefresh: {
      enabled: false,
      interval: 30000, // 30 seconds in milliseconds
      lastAutoRefresh: null
    },
    resourcesUpdating: {
      positions: false,
      pools: false,
      tokens: false
    }
  },
  reducers: {
    triggerUpdate: (state) => {
      state.lastUpdate = Date.now();
    },
    setIsUpdating: (state, action) => {
      state.isUpdating = action.payload;
    },
    setResourceUpdating: (state, action) => {
      const { resource, isUpdating } = action.payload;
      state.resourcesUpdating[resource] = isUpdating;
    },
    setAutoRefresh: (state, action) => {
      state.autoRefresh = {
        ...state.autoRefresh,
        ...action.payload
      };
    },
    markAutoRefresh: (state) => {
      state.autoRefresh.lastAutoRefresh = Date.now();
    }
  }
});

export const {
  triggerUpdate,
  setIsUpdating,
  setResourceUpdating,
  setAutoRefresh,
  markAutoRefresh
} = updateSlice.actions;

export default updateSlice.reducer;
