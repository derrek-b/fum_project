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

const SSE_URL = process.env.NEXT_PUBLIC_SSE_URL || 'http://localhost:3001/events';

// Events that should trigger a data refresh
const REFRESH_TRIGGER_EVENTS = [
  'NewPositionCreated',
  'PositionsClosed',
  'PositionRebalanced',
  'FeesCollected',
  'VaultOnboarded',
  'VaultOffboarded',
  'TokensSwapped'
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
        'VaultOnboarded',
        'VaultOffboarded',
        'VaultAuthGranted',
        'VaultAuthRevoked',
        'NewPositionCreated',
        'PositionsClosed',
        'PositionRebalanced',
        'LiquidityAddedToPosition',
        'FeesCollected',
        'TokensSwapped',
        'VaultBaselineCaptured',
        'MonitoringStarted',
        'VaultMonitoringStopped',
        'VaultUnrecoverable',
        'VaultRecovered',
        'FeeCollectionFailed'
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
