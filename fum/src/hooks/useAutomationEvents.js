// hooks/useAutomationEvents.js
import { useEffect, useCallback, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  setConnected,
  setDisconnected,
  setConnectionError,
  eventReceived
} from '../redux/automationSlice';
import { updateVault, appendVaultTransaction } from '../redux/vaultsSlice';
import { useProvider } from '../contexts/ProviderContext';
import { processSSEEvent } from '../utils/sseEventHandlers';

const SSE_URL = process.env.NEXT_PUBLIC_SSE_URL;

/**
 * Hook to connect to the automation service SSE stream
 * Dispatches events to Redux and triggers data refreshes when needed
 */
export function useAutomationEvents() {
  const dispatch = useDispatch();
  const { readProvider } = useProvider();
  const chainId = useSelector(state => state.wallet.chainId);
  const positions = useSelector(state => state.positions.positions);
  const eventSourceRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);

  // Refs for stable closure access inside SSE event listeners
  const providerRef = useRef(null);
  const chainIdRef = useRef(null);
  const positionsRef = useRef([]);

  useEffect(() => { providerRef.current = readProvider; }, [readProvider]);
  useEffect(() => { chainIdRef.current = chainId; }, [chainId]);
  useEffect(() => { positionsRef.current = positions; }, [positions]);

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
        'NativeWrapped',
        'NativeUnwrapped',
        'VaultBaselineCaptured',
        'MonitoringStarted',
        'VaultFailed',
        'VaultRecovered',
        'VaultBlacklisted',
        'VaultUnblacklisted',
        'FeeCollectionFailed',
        'TransactionLogged',
        'ExecutorFundingRequired',
        'ExecutorFundingCleared'
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
            if (eventName === 'VaultFailed' && payload.data?.vaultAddress) {
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
            } else if (eventName === 'VaultRecovered' && payload.data?.vaultAddress) {
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
            } else if (eventName === 'ExecutorFundingRequired' && payload.data?.vaultAddress) {
              dispatch(updateVault({
                vaultAddress: payload.data.vaultAddress,
                vaultData: {
                  isFundingRequired: true,
                  fundingRequiredAt: payload.data.timestamp || Date.now()
                }
              }));
            } else if (eventName === 'ExecutorFundingCleared' && payload.data?.vaultAddress) {
              dispatch(updateVault({
                vaultAddress: payload.data.vaultAddress,
                vaultData: {
                  isFundingRequired: false,
                  fundingRequiredAt: null
                }
              }));
            } else if (eventName === 'TransactionLogged' && payload.data?.vaultAddress) {
              // Append new transaction to vault's history for real-time updates
              dispatch(appendVaultTransaction({
                vaultAddress: payload.data.vaultAddress,
                transaction: payload.data
              }));
            }

            // Trigger targeted data fetches for data-changing events
            processSSEEvent(eventName, payload.data, {
              provider: providerRef.current,
              chainId: chainIdRef.current,
              dispatch,
              getPositions: () => positionsRef.current
            });
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
