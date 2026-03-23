// Shared actions for cross-slice vault/position transfers
// Both positionsSlice and vaultsSlice listen for these via extraReducers
import { createAction } from '@reduxjs/toolkit';

export const transferPositionToVault = createAction('positions/transferToVault');
export const transferPositionFromVault = createAction('positions/transferFromVault');

// Payload shape: { positionId, vaultAddress }
