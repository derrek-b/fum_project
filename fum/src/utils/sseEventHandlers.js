// utils/sseEventHandlers.js
// Targeted data fetch handlers for SSE automation events.
// Each handler fetches only the data that changed and dispatches directly to Redux.

import { loadVaultTokenBalances } from './vaultsHelpers';
import { AdapterFactory } from 'fum_library/adapters';
import { updatePosition, addVaultPositions, removePosition } from '../redux/positionsSlice';
import { updateVaultPositions } from '../redux/vaultsSlice';

/**
 * Refresh token balances for a vault after a balance-changing event.
 * Dispatches updateVaultTokenBalances + updateVaultMetrics to Redux.
 */
async function refreshTokenBalances(vaultAddress, provider, chainId, dispatch) {
  try {
    await loadVaultTokenBalances(vaultAddress, provider, chainId, dispatch);
  } catch (error) {
    console.error(`[SSE:handler] Failed to refresh token balances for ${vaultAddress}:`, error.message);
  }
}

/**
 * Refresh a single position's display data from chain.
 * @param {string|number} positionId - Position ID
 * @param {string} platform - Platform ID (e.g., 'uniswapV3', 'traderjoeV2_2')
 * @param {string} vaultAddress - Vault address (used for isNew to set inVault)
 * @param {object} provider - Ethers provider
 * @param {number} chainId - Chain ID
 * @param {function} dispatch - Redux dispatch
 * @param {boolean} isNew - If true, adds position to Redux as a new vault position
 */
async function refreshSinglePosition(positionId, platform, vaultAddress, provider, chainId, dispatch, isNew = false) {
  try {
    const adapter = AdapterFactory.getAdapter(platform, chainId);
    const freshPosition = await adapter.refreshPositionForDisplay(positionId, provider);

    if (isNew) {
      dispatch(addVaultPositions({ positions: [freshPosition], vaultAddress }));
    } else {
      dispatch(updatePosition(freshPosition));
    }
  } catch (error) {
    console.error(`[SSE:handler] Failed to refresh position ${positionId} (${platform}):`, error.message);
  }
}

/**
 * Process an SSE event and trigger targeted data fetches.
 * Called from useAutomationEvents for every data-changing event.
 *
 * @param {string} eventName - SSE event name
 * @param {object} data - Event payload data
 * @param {object} context - { provider, chainId, dispatch, getPositions }
 */
export function processSSEEvent(eventName, data, { provider, chainId, dispatch, getPositions }) {
  if (!provider || !chainId) return;
  if (!data?.vaultAddress) return;

  const { vaultAddress } = data;

  switch (eventName) {
    // Token balance changes only
    case 'TokensSwapped':
    case 'NativeWrapped':
    case 'NativeUnwrapped':
      refreshTokenBalances(vaultAddress, provider, chainId, dispatch);
      break;

    // New position created — fetch position + update balances
    case 'NewPositionCreated':
      refreshSinglePosition(data.positionId, data.platform, vaultAddress, provider, chainId, dispatch, true);
      refreshTokenBalances(vaultAddress, provider, chainId, dispatch);
      break;

    // Liquidity added to existing position — refresh position + update balances
    case 'LiquidityAddedToPosition':
      refreshSinglePosition(data.positionId, data.platform, vaultAddress, provider, chainId, dispatch);
      refreshTokenBalances(vaultAddress, provider, chainId, dispatch);
      break;

    // Fees collected — refresh each position + update balances
    case 'FeesCollected': {
      const positions = getPositions();
      if (data.positionIds) {
        for (const positionId of data.positionIds) {
          const existing = positions.find(p => p.id === positionId);
          if (existing) {
            refreshSinglePosition(positionId, existing.platform, vaultAddress, provider, chainId, dispatch);
          } else {
            // Position not in Redux — skip individual refresh, token balances still update
            console.warn(`[SSE:handler] FeesCollected: position ${positionId} not in Redux, skipping position refresh`);
          }
        }
      }
      refreshTokenBalances(vaultAddress, provider, chainId, dispatch);
      break;
    }

    // Positions closed — remove from Redux + update balances
    case 'PositionsClosed':
      if (data.closedPositions) {
        const closedIds = data.closedPositions.map(p => p.positionId || p.id).filter(Boolean);
        for (const id of closedIds) {
          dispatch(removePosition(id));
        }
        if (closedIds.length > 0) {
          dispatch(updateVaultPositions({
            vaultAddress,
            positionIds: closedIds,
            operation: 'remove'
          }));
        }
      }
      refreshTokenBalances(vaultAddress, provider, chainId, dispatch);
      break;

    // PositionRebalanced — skip (component events PositionsClosed + TokensSwapped + NewPositionCreated cover it)
    case 'PositionRebalanced':
      break;

    default:
      break;
  }
}
