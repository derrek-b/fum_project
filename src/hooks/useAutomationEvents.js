// hooks/useAutomationEvents.js
import { useEffect, useCallback, useRef } from 'react';
import { useDispatch } from 'react-redux';
import {
  setConnected,
  setDisconnected,
  setConnectionError,
  eventReceived
} from '../redux/automationSlice';
import { triggerUpdate } from '../redux/updateSlice';
import { updateVault, appendVaultTransaction } from '../redux/vaultsSlice';

const SSE_URL = process.env.NEXT_PUBLIC_SSE_URL || 'http://localhost:3001/events';

// Events that should trigger a data refresh
const REFRESH_TRIGGER_EVENTS = [
  'NewPositionCreated',
  'PositionsClosed',
  'PositionRebalanced',
  'LiquidityAddedToPosition',
  'FeesCollected',
  'TokensSwapped',
  'VaultUnrecoverable'
];

/**
 * Hook to connect to the automation service SSE stream
 * Dispatches events to Redux and triggers data refreshes when needed
 */
export function useAutomationEvents() {
  const dispatch = useDispatch();
  const eventSourceRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);

  const connect = useCallback(() => {
    // Don't create multiple connections
    if (eventSourceRef.current) {
      return;
    }

    // SSE is not available in SSR
    if (typeof window === 'undefined') {
      return;
    }

    try {
      const eventSource = new EventSource(SSE_URL);
      eventSourceRef.current = eventSource;

      eventSource.onopen = () => {
        console.log('[SSE] Connected to automation service');
        dispatch(setConnected({ timestamp: Date.now() }));
      };

      eventSource.onerror = (error) => {
        console.error('[SSE] Connection error:', error);
        dispatch(setConnectionError('Connection lost'));

        // EventSource will auto-reconnect, but we track the state
        // If the connection is closed, clean up
        if (eventSource.readyState === EventSource.CLOSED) {
          eventSourceRef.current = null;
        }
      };

      // Handle initial connection event
      eventSource.addEventListener('connected', (e) => {
        try {
          const data = JSON.parse(e.data);
          console.log('[SSE] Received connection confirmation:', data);
          dispatch(setConnected({ timestamp: data.timestamp }));
        } catch (err) {
          console.error('[SSE] Error parsing connected event:', err);
        }
      });

      // Handle all automation events
      const automationEvents = [
        'ServiceStarted',
        'ServiceStartFailed',
        'NewPositionCreated',
        'PositionsClosed',
        'PositionRebalanced',
        'LiquidityAddedToPosition',
        'FeesCollected',
        'TokensSwapped',
        'VaultBaselineCaptured',
        'MonitoringStarted',
        'VaultLoadFailed',
        'VaultLoadRecovered',
        'VaultUnrecoverable',
        'VaultBlacklisted',
        'VaultUnblacklisted',
        'FeeCollectionFailed',
        'TransactionLogged'
      ];

      automationEvents.forEach(eventName => {
        eventSource.addEventListener(eventName, (e) => {
          try {
            const payload = JSON.parse(e.data);
            console.log(`[SSE] ${eventName}:`, payload);

            // Dispatch to Redux
            dispatch(eventReceived({
              event: eventName,
              data: payload.data,
              timestamp: payload.timestamp
            }));

            // Handle vault state updates
            if (eventName === 'VaultLoadFailed' && payload.data?.vaultAddress) {
              // Vault is having trouble loading - show retry warning
              dispatch(updateVault({
                vaultAddress: payload.data.vaultAddress,
                vaultData: {
                  isRetrying: true,
                  retryError: {
                    message: payload.data.error || 'Unknown error',
                    attempts: payload.data.attempts || 1,
                    lastAttempt: payload.data.lastAttempt || Date.now()
                  }
                }
              }));
            } else if (eventName === 'VaultLoadRecovered' && payload.data?.vaultAddress) {
              // Vault recovered - clear retry state and blacklist (backend unblacklists on recovery)
              dispatch(updateVault({
                vaultAddress: payload.data.vaultAddress,
                vaultData: {
                  isRetrying: false,
                  retryError: null,
                  isBlacklisted: false,
                  blacklistReason: null
                }
              }));
            } else if (eventName === 'VaultUnrecoverable' && payload.data?.vaultAddress) {
              // Vault blacklisted - clear retry state, set blacklist state
              dispatch(updateVault({
                vaultAddress: payload.data.vaultAddress,
                vaultData: {
                  isBlacklisted: true,
                  blacklistReason: payload.data.reason || 'Unknown error',
                  isRetrying: false,
                  retryError: null
                }
              }));
            } else if (eventName === 'VaultBlacklisted' && payload.data?.vaultAddress) {
              // Vault blacklisted - clear retry state, set blacklist state
              dispatch(updateVault({
                vaultAddress: payload.data.vaultAddress,
                vaultData: {
                  isBlacklisted: true,
                  blacklistReason: payload.data.reason || 'Unknown error',
                  isRetrying: false,
                  retryError: null
                }
              }));
            } else if (eventName === 'VaultUnblacklisted' && payload.data?.vaultAddress) {
              // Vault removed from blacklist - clear blacklist state
              dispatch(updateVault({
                vaultAddress: payload.data.vaultAddress,
                vaultData: {
                  isBlacklisted: false,
                  blacklistReason: null
                }
              }));
            } else if (eventName === 'TransactionLogged' && payload.data?.vaultAddress) {
              // Append new transaction to vault's history for real-time updates
              dispatch(appendVaultTransaction({
                vaultAddress: payload.data.vaultAddress,
                transaction: payload.data
              }));
            }

            // Trigger data refresh for relevant events
            if (REFRESH_TRIGGER_EVENTS.includes(eventName)) {
              dispatch(triggerUpdate());
            }
          } catch (err) {
            console.error(`[SSE] Error parsing ${eventName} event:`, err);
          }
        });
      });

    } catch (error) {
      console.error('[SSE] Failed to create EventSource:', error);
      dispatch(setConnectionError(error.message));
    }
  }, [dispatch]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
      dispatch(setDisconnected());
      console.log('[SSE] Disconnected from automation service');
    }
  }, [dispatch]);

  // Connect on mount, disconnect on unmount
  useEffect(() => {
    connect();
    return () => disconnect();
  }, [connect, disconnect]);

  return { connect, disconnect };
}

export default useAutomationEvents;
