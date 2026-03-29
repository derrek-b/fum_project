// redux/vaultsSlice.js - Updated with direct position IDs in vault objects
import { createSlice } from "@reduxjs/toolkit";
import { transferPositionToVault, transferPositionFromVault } from './vaultPositionActions';

const vaultsSlice = createSlice({
  name: "vaults",
  initialState: {
    userVaults: [], // List of user's vaults with their details INCLUDING position IDs and metrics
    isLoadingVaults: false, // Loading state for vaults
    vaultError: null, // Any error during vault loading or operations
    vaultsLastFetched: null, // Timestamp of last full vaults load
  },
  reducers: {
    setVaults: (state, action) => {
      // Initialize vaults with empty positions arrays, metrics, and tokenBalances if not provided
      state.userVaults = action.payload.map(vault => ({
        ...vault,
        positions: vault.positions || [], // Ensure positions array exists
        metrics: vault.metrics || {        // Ensure metrics object exists
          tvl: 0,
          positionCount: 0
        },
        tokenBalances: vault.tokenBalances || {}, // Ensure tokenBalances object exists
        isBlacklisted: vault.isBlacklisted || false, // Blacklist status from automation service
        blacklistReason: vault.blacklistReason || null, // Reason for blacklisting if applicable
        isFundingRequired: vault.isFundingRequired || false, // Executor funding required
        fundingRequiredAt: vault.fundingRequiredAt || null, // Timestamp when funding became required
        isRetrying: vault.isRetrying || false, // Vault load retry in progress
        retryError: vault.retryError || null, // Error info during retry attempts
        // Tracker data from automation service
        trackerMetadata: vault.trackerMetadata || null, // Baseline, aggregates, last snapshot
        transactionHistory: vault.transactionHistory || [], // Transaction log entries
        trackerDataLoaded: vault.trackerDataLoaded || false // Flag indicating tracker data has been fetched
      }));
    },
    addVault: (state, action) => {
      // Add a single new vault to the list, with empty positions array and metrics if not provided
      const newVault = {
        ...action.payload,
        positions: action.payload.positions || [],
        metrics: action.payload.metrics || {
          tvl: 0,
          positionCount: 0
        },
        isBlacklisted: action.payload.isBlacklisted || false,
        blacklistReason: action.payload.blacklistReason || null,
        isFundingRequired: action.payload.isFundingRequired || false,
        fundingRequiredAt: action.payload.fundingRequiredAt || null,
        isRetrying: action.payload.isRetrying || false,
        retryError: action.payload.retryError || null,
        trackerMetadata: action.payload.trackerMetadata || null,
        transactionHistory: action.payload.transactionHistory || [],
        trackerDataLoaded: action.payload.trackerDataLoaded || false
      };
      state.userVaults.push(newVault);
    },
    updateVault: (state, action) => {
      // Upsert a vault — update if exists, add if not (supports direct URL navigation
      // where getVaultData runs before loadVaultData has populated the array)
      const { vaultAddress, vaultData } = action.payload;
      const index = state.userVaults.findIndex(v => v.address === vaultAddress);
      if (index !== -1) {
        // Update existing — preserve positions, metrics, and tokenBalances if not in update
        const existingPositions = state.userVaults[index].positions || [];
        const existingMetrics = state.userVaults[index].metrics || { tvl: 0, positionCount: 0 };
        const existingTokenBalances = state.userVaults[index].tokenBalances || {};

        state.userVaults[index] = {
          ...state.userVaults[index],
          ...vaultData,
          positions: vaultData.positions || existingPositions,
          metrics: vaultData.metrics || existingMetrics,
          tokenBalances: vaultData.tokenBalances || existingTokenBalances
        };
      } else {
        // Vault not in Redux yet — add it with defaults for missing fields
        state.userVaults.push({
          address: vaultAddress,
          positions: [],
          metrics: { tvl: 0, positionCount: 0 },
          tokenBalances: {},
          isBlacklisted: false,
          blacklistReason: null,
          isFundingRequired: false,
          fundingRequiredAt: null,
          isRetrying: false,
          retryError: null,
          trackerMetadata: null,
          transactionHistory: [],
          trackerDataLoaded: false,
          ...vaultData
        });
      }
    },
    // Set or replace all positions for a vault
    setVaultPositions: (state, action) => {
      const { vaultAddress, positionIds } = action.payload;
      const vaultIndex = state.userVaults.findIndex(v => v.address === vaultAddress);

      if (vaultIndex !== -1) {
        state.userVaults[vaultIndex].positions = positionIds;
      }
    },
    // Update multiple positions for a vault
    updateVaultPositions: (state, action) => {
      const { vaultAddress, positionIds, operation } = action.payload;
      const vaultIndex = state.userVaults.findIndex(v => v.address === vaultAddress);

      if (vaultIndex === -1) return;

      // Initialize positions array if needed
      if (!state.userVaults[vaultIndex].positions) {
        state.userVaults[vaultIndex].positions = [];
      }

      switch (operation) {
        case 'add':
          // Add positions that aren't already in the vault
          positionIds.forEach(id => {
            if (!state.userVaults[vaultIndex].positions.includes(id)) {
              state.userVaults[vaultIndex].positions.push(id);
            }
          });
          break;
        case 'remove':
          // Remove specified positions
          state.userVaults[vaultIndex].positions = state.userVaults[vaultIndex].positions
            .filter(id => !positionIds.includes(id));
          break;
        case 'replace':
          // Replace all positions
          state.userVaults[vaultIndex].positions = positionIds;
          break;
        default:
          // Default is to add (same as 'add' case)
          positionIds.forEach(id => {
            if (!state.userVaults[vaultIndex].positions.includes(id)) {
              state.userVaults[vaultIndex].positions.push(id);
            }
          });
      }
    },
    updateVaultTokenBalances: (state, action) => {
      const { vaultAddress, tokenBalances } = action.payload;
      const vaultIndex = state.userVaults.findIndex(v => v.address === vaultAddress);

      if (vaultIndex !== -1) {
        // Replace token balances entirely (don't merge) so 0-balance tokens are removed
        state.userVaults[vaultIndex].tokenBalances = tokenBalances;
      }
    },
    updateVaultMetrics: (state, action) => {
      // Update metrics for a vault
      const { vaultAddress, metrics } = action.payload;
      const vaultIndex = state.userVaults.findIndex(v => v.address === vaultAddress);

      if (vaultIndex !== -1) {
        // Initialize metrics object if it doesn't exist
        if (!state.userVaults[vaultIndex].metrics) {
          state.userVaults[vaultIndex].metrics = {};
        }

        // Update metrics in the vault object
        state.userVaults[vaultIndex].metrics = {
          ...state.userVaults[vaultIndex].metrics,
          ...metrics,
          lastUpdated: Date.now()
        };
      }
    },
    updateVaultStrategy: (state, action) => {
      const { vaultAddress, strategy } = action.payload;
      const vaultIndex = state.userVaults.findIndex(v => v.address === vaultAddress);

      if (vaultIndex !== -1) {
        // Initialize strategy object if it doesn't exist
        if (!state.userVaults[vaultIndex].strategy) {
          state.userVaults[vaultIndex].strategy = {};
        }

        // Update strategy in the vault object
        state.userVaults[vaultIndex].strategy = {
          ...strategy,
          lastUpdated: Date.now()
        };
      }
    },
    // Update tracker data (metadata and transactions) for a vault
    updateVaultTrackerData: (state, action) => {
      const { vaultAddress, trackerMetadata, transactionHistory } = action.payload;
      const vaultIndex = state.userVaults.findIndex(v => v.address === vaultAddress);

      if (vaultIndex !== -1) {
        if (trackerMetadata !== undefined) {
          state.userVaults[vaultIndex].trackerMetadata = trackerMetadata;
        }
        if (transactionHistory !== undefined) {
          state.userVaults[vaultIndex].transactionHistory = transactionHistory;
        }
        state.userVaults[vaultIndex].trackerDataLoaded = true;
      }
    },
    // Append a new transaction to vault's history (for real-time SSE updates)
    appendVaultTransaction: (state, action) => {
      const { vaultAddress, transaction } = action.payload;
      const vaultIndex = state.userVaults.findIndex(v => v.address === vaultAddress);

      if (vaultIndex !== -1) {
        // Initialize array if needed
        if (!state.userVaults[vaultIndex].transactionHistory) {
          state.userVaults[vaultIndex].transactionHistory = [];
        }
        // Deduplicate: skip if a transaction with the same type and timestamp already exists
        const isDuplicate = state.userVaults[vaultIndex].transactionHistory.some(
          t => t.type === transaction.type && t.timestamp === transaction.timestamp
        );
        if (!isDuplicate) {
          // Prepend new transaction (most recent first)
          state.userVaults[vaultIndex].transactionHistory.unshift(transaction);
        }
      }
    },
    clearVaults: (state) => {
      state.userVaults = [];
      state.vaultError = null;
    },
    setLoadingVaults: (state, action) => {
      state.isLoadingVaults = action.payload;
    },
    setVaultError: (state, action) => {
      state.vaultError = action.payload;
    },

    // Set timestamp for when full vaults list was last fetched
    setVaultsLastFetched: (state, action) => {
      state.vaultsLastFetched = action.payload;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(transferPositionToVault, (state, action) => {
        const { positionId, vaultAddress } = action.payload;
        const vaultIndex = state.userVaults.findIndex(v => v.address === vaultAddress);
        if (vaultIndex !== -1) {
          if (!state.userVaults[vaultIndex].positions) {
            state.userVaults[vaultIndex].positions = [];
          }
          if (!state.userVaults[vaultIndex].positions.includes(positionId)) {
            state.userVaults[vaultIndex].positions.push(positionId);
          }
        }
      })
      .addCase(transferPositionFromVault, (state, action) => {
        const { positionId, vaultAddress } = action.payload;
        const vaultIndex = state.userVaults.findIndex(v => v.address === vaultAddress);
        if (vaultIndex !== -1 && state.userVaults[vaultIndex].positions) {
          state.userVaults[vaultIndex].positions = state.userVaults[vaultIndex].positions
            .filter(id => id !== positionId);
        }
      });
  },
});

export const {
  setVaults,
  addVault,
  updateVault,
  setVaultPositions,
  updateVaultPositions,
  updateVaultTokenBalances,
  updateVaultMetrics,
  updateVaultStrategy,
  updateVaultTrackerData,
  appendVaultTransaction,
  clearVaults,
  setLoadingVaults,
  setVaultError,
  setVaultsLastFetched
} = vaultsSlice.actions;

export default vaultsSlice.reducer;
