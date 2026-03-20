import { useState, useEffect, useRef, useCallback } from 'react';

const REFRESH_INTERVAL_MS = 30000;

/**
 * Hook for managing fresh pool data and position display data while a modal is open.
 *
 * - Fetches fresh poolData on modal open
 * - Checks position data freshness (re-fetches via refreshPositionForDisplay if > 30s old)
 * - Auto-refreshes both every 30 seconds while modal is visible
 * - Flattens position.platformData onto root for adapter generate*Data calls
 * - Cleans up interval when modal closes
 *
 * @param {Object} adapter - Platform adapter instance (from AdapterFactory.getAdapter)
 * @param {Object} position - Position object from Redux (getPositionsForDisplay shape)
 * @param {Object} provider - Read provider (from useReadProvider or useProviders)
 * @param {boolean} isVisible - True when modal is showing
 * @returns {{ poolData: Object|null, positionForAdapter: Object|null, isLoading: boolean }}
 */
export function useModalData(adapter, position, provider, isVisible) {
  const [poolData, setPoolData] = useState(null);
  const [freshPosition, setFreshPosition] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const intervalRef = useRef(null);

  // Flatten position with platformData for adapter calls
  const flattenPosition = useCallback((pos) => {
    if (!pos) return null;
    return { ...pos, ...pos.platformData, active: true };
  }, []);

  // Core fetch function — fetches pool data and optionally refreshes position
  const fetchData = useCallback(async (forceRefreshPosition = false) => {
    if (!adapter || !position?.pool || !position?.id || !provider) return;

    try {
      // Always fetch fresh pool data
      const freshPoolData = await adapter.getPoolData(position.pool, provider);
      setPoolData(freshPoolData);

      // Check if position display data is stale (> 30s old) or forced refresh
      const isStale = forceRefreshPosition || !position.lastUpdated ||
        (Date.now() - position.lastUpdated > REFRESH_INTERVAL_MS);

      if (isStale) {
        const refreshed = await adapter.refreshPositionForDisplay(position.id, provider);
        setFreshPosition(refreshed);
      } else if (!freshPosition) {
        // First load with fresh data — use existing position
        setFreshPosition(position);
      }
    } catch (error) {
      console.error('useModalData fetch error:', error);
    }
  }, [adapter, position, provider, freshPosition]);

  // Fetch on open + set up interval
  useEffect(() => {
    if (!isVisible || !adapter || !position || !provider) {
      // Modal closed or missing deps — clean up
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      setPoolData(null);
      setFreshPosition(null);
      setIsLoading(false);
      return;
    }

    // Modal just opened — fetch immediately
    setIsLoading(true);
    fetchData().finally(() => setIsLoading(false));

    // Set up refresh interval
    intervalRef.current = setInterval(async () => {
      try {
        if (!adapter || !position?.pool || !position?.id || !provider) return;

        const freshPoolData = await adapter.getPoolData(position.pool, provider);
        setPoolData(freshPoolData);

        const refreshed = await adapter.refreshPositionForDisplay(position.id, provider);
        setFreshPosition(refreshed);
      } catch (error) {
        console.error('useModalData refresh error:', error);
      }
    }, REFRESH_INTERVAL_MS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isVisible, adapter, position?.id, position?.pool, provider]);

  // Compute flattened position for adapter calls
  const positionForAdapter = flattenPosition(freshPosition);

  return { poolData, positionForAdapter, isLoading };
}
