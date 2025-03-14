'use client';

import React, { useEffect, useState, useRef } from "react";
import { Row, Col, Alert, Spinner } from "react-bootstrap";
import { useSelector, useDispatch } from "react-redux";
import PositionCard from "./PositionCard";
import RefreshControls from "./RefreshControls";
import PlatformFilter from "./PlatformFilter";
import { AdapterFactory } from "../adapters";
import config from "../utils/config.js";
import { setPositions } from "../redux/positionsSlice";
import { setPools, clearPools } from "../redux/poolSlice";
import { setTokens, clearTokens } from "../redux/tokensSlice";
import { triggerUpdate, setResourceUpdating, markAutoRefresh } from "../redux/updateSlice";
import { setPlatforms, setActivePlatforms, setPlatformFilter, clearPlatforms } from "../redux/platformsSlice";

export default function PositionContainer({ provider }) {
  const dispatch = useDispatch();
  const { isConnected, address, chainId } = useSelector((state) => state.wallet);
  const { lastUpdate, autoRefresh, resourcesUpdating } = useSelector((state) => state.updates);
  const { platformFilter } = useSelector((state) => state.platforms);
  const [positions, setLocalPositions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const timerRef = useRef(null);

  // Set up auto-refresh timer
  useEffect(() => {
    // Clear any existing timer
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    // Only set up timer if auto-refresh is enabled and we're connected
    if (autoRefresh.enabled && isConnected && provider && address && chainId) {
      console.log(`Setting up auto-refresh timer with interval: ${autoRefresh.interval}ms`);
      timerRef.current = setInterval(() => {
        console.log('Auto-refreshing data...');
        dispatch(markAutoRefresh());
        dispatch(triggerUpdate());
      }, autoRefresh.interval);
    }

    // Cleanup on unmount
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [autoRefresh.enabled, autoRefresh.interval, isConnected, provider, address, chainId, dispatch]);

  // Fetch positions data from all platforms
  useEffect(() => {
    if (!isConnected || !address || !provider || !chainId) {
      setLocalPositions([]);
      dispatch(setPositions([]));
      dispatch(clearPools());
      dispatch(clearTokens());
      dispatch(clearPlatforms());
      setError(null);
      return;
    }

    const fetchAllPositions = async () => {
      setLoading(true);
      setError(null);
      dispatch(setResourceUpdating({ resource: 'positions', isUpdating: true }));

      try {
        // Get all platform adapters for the current chain
        const adapters = AdapterFactory.getAdaptersForChain(chainId, provider);

        if (adapters.length === 0) {
          throw new Error(`No supported platforms found for chainId: ${chainId}`);
        }

        console.log(`Found ${adapters.length} platform adapters for chain ${chainId}`);

        // Store supported platform IDs
        const supportedPlatforms = adapters.map(adapter => ({
          id: adapter.platformId,
          name: adapter.platformName
        }));

        // Update Redux with supported platforms
        dispatch(setPlatforms(supportedPlatforms));

        // Fetch positions from all platforms in parallel
        const platformResults = await Promise.all(
          adapters.map(adapter => {
            console.log(`Fetching positions from ${adapter.platformName}`);
            return adapter.getPositions(address, chainId);
          })
        );

        // Combine position data from all platforms
        let allPositions = [];
        let allPoolData = {};
        let allTokenData = {};
        let activePlatforms = [];

        platformResults.forEach((result, index) => {
          if (result && result.positions && result.positions.length > 0) {
            console.log(`Got ${result.positions.length} positions from ${adapters[index].platformName}`);
            allPositions = [...allPositions, ...result.positions];

            // Track active platforms (those with positions)
            activePlatforms.push(adapters[index].platformId);

            // Merge pool data
            if (result.poolData) {
              allPoolData = { ...allPoolData, ...result.poolData };
            }

            // Merge token data
            if (result.tokenData) {
              allTokenData = { ...allTokenData, ...result.tokenData };
            }
          }
        });

        // Update active platforms in Redux
        dispatch(setActivePlatforms(activePlatforms));

        setLocalPositions(allPositions);
        dispatch(setPositions(allPositions));
        dispatch(setPools(allPoolData));
        dispatch(setTokens(allTokenData));

      } catch (error) {
        console.error("Position fetching error:", error);
        setError(`Error fetching positions: ${error.message}`);
        setLocalPositions([]);
        dispatch(setPositions([]));
        // Do not clear pools or tokens on partial error—only on disconnect
      } finally {
        setLoading(false);
        dispatch(setResourceUpdating({ resource: 'positions', isUpdating: false }));
      }
    };

    fetchAllPositions();
  }, [isConnected, address, provider, chainId, lastUpdate, dispatch]);

  // Filter active positions (with liquidity > 0)
  // Apply platform filter if selected
  const activePositions = positions
    .filter((pos) => pos.liquidity > 0)
    .filter((pos) => platformFilter === null || pos.platform === platformFilter);

  // Get the refreshing state
  const isUpdatingPositions = resourcesUpdating?.positions || false;

  return (
    <div>
      {!isConnected ? (
        <Alert variant="info" className="text-center">
          Connect your wallet to view your liquidity positions
        </Alert>
      ) : loading ? (
        <div className="text-center py-5">
          <Spinner animation="border" variant="primary" role="status" />
          <p className="mt-3">Loading your liquidity positions...</p>
        </div>
      ) : error ? (
        <Alert variant="danger">
          <Alert.Heading>Error Loading Positions</Alert.Heading>
          <p>{error}</p>
        </Alert>
      ) : activePositions.length === 0 ? (
        <Alert variant="warning" className="text-center">
          <p className="mb-0">No active liquidity positions found for this wallet.</p>
          {chainId && (
            <small className="d-block mt-2">
              Connected to {config.chains[1337]?.name || `Chain ID ${chainId}`}
            </small>
          )}
        </Alert>
      ) : (
        <>
          <div className="d-flex justify-content-between align-items-center mb-3">
            <p className="text-muted mb-0">
              Found {activePositions.length} active position{activePositions.length !== 1 ? 's' : ''}
            </p>

            <div className="d-flex align-items-center">
              {isUpdatingPositions && (
                <div className="d-flex align-items-center me-3">
                  <Spinner animation="border" size="sm" variant="secondary" className="me-2" />
                  <small className="text-muted">Refreshing...</small>
                </div>
              )}
              <RefreshControls />
            </div>
          </div>

          {/* Add platform filter */}
          <PlatformFilter />

          <Row>
            {activePositions.map((pos) => (
              <Col md={6} key={pos.id}>
                <PositionCard
                  position={pos}
                  provider={provider}
                />
              </Col>
            ))}
          </Row>
        </>
      )}
    </div>
  );
}
