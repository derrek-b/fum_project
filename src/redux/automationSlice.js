// redux/automationSlice.js
import { createSlice } from "@reduxjs/toolkit";

const automationSlice = createSlice({
  name: "automation",
  initialState: {
    connected: false,
    lastEvent: null,
    recentEvents: [],      // Rolling window of recent events for display
    connectionError: null,
    stats: {
      eventsReceived: 0,
      lastConnectedAt: null,
      reconnectCount: 0
    }
  },
  reducers: {
    setConnected: (state, action) => {
      state.connected = true;
      state.connectionError = null;
      state.stats.lastConnectedAt = action.payload?.timestamp || Date.now();
    },
    setDisconnected: (state) => {
      state.connected = false;
    },
    setConnectionError: (state, action) => {
      state.connected = false;
      state.connectionError = action.payload;
      state.stats.reconnectCount += 1;
    },
    eventReceived: (state, action) => {
      const event = {
        ...action.payload,
        receivedAt: Date.now()
      };
      state.lastEvent = event;
      state.recentEvents.unshift(event);
      // Keep last 50 events
      if (state.recentEvents.length > 50) {
        state.recentEvents.pop();
      }
      state.stats.eventsReceived += 1;
    },
    clearRecentEvents: (state) => {
      state.recentEvents = [];
    }
  }
});

export const {
  setConnected,
  setDisconnected,
  setConnectionError,
  eventReceived,
  clearRecentEvents
} = automationSlice.actions;

export default automationSlice.reducer;
