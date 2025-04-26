// src/components/PositionContainer.js - Updated version with modal adapter calls
import React, { useEffect, useState, useRef } from "react";
import { Row, Col, Alert, Spinner, Button } from "react-bootstrap";
import { useSelector, useDispatch } from "react-redux";

// FUM Library imports
import { AdapterFactory } from "fum_library/adapters";
import { getUserVaults, getVaultInfo } from "fum_library/blockchain/contracts";
import { getChainName } from "fum_library/helpers/chainHelpers";

// Local project imports
import PositionCard from "./PositionCard";
import RefreshControls from "../RefreshControls";
import PlatformFilter from "./PlatformFilter";
import AddLiquidityModal from "./AddLiquidityModal";
import { setPositions, addVaultPositions } from "../../redux/positionsSlice";
import { setPools, clearPools } from "../../redux/poolSlice";
import { setTokens, clearTokens } from "../../redux/tokensSlice";
import { triggerUpdate, setResourceUpdating, markAutoRefresh } from "../../redux/updateSlice";
import { setPlatforms, setActivePlatforms, setPlatformFilter, clearPlatforms } from "../../redux/platformsSlice";
import { setVaults, clearVaults, setLoadingVaults, setVaultError } from "../../redux/vaultsSlice";
import { useToast } from "../../context/ToastContext";

export default function PositionContainer() {
  const dispatch = useDispatch();
  const { showError, showSuccess } = useToast();
  const { isConnected, address, chainId, provider } = useSelector((state) => state.wallet);
  const { lastUpdate, autoRefresh, resourcesUpdating } = useSelector((state) => state.updates);
  const { platformFilter } = useSelector((state) => state.platforms);
  const { userVaults } = useSelector((state) => state.vaults);
  const { positions } = useSelector((state) => state.positions);
  const pools = useSelector((state) => state.pools);
  const tokens = useSelector((state) => state.tokens);
  const [localPositions, setLocalPositions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const timerRef = useRef(null);

  // State for create position modal
  const [showCreatePositionModal, setShowCreatePositionModal] = useState(false);

  // Set up auto-refresh timer
  useEffect(() => {
    // Clear any existing timer
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    // Only set up timer if auto-refresh is enabled and we're connected
    if (autoRefresh.enabled && isConnected && provider && address && chainId) {
      try {
        timerRef.current = setInterval(() => {
          dispatch(markAutoRefresh());
          dispatch(triggerUpdate());
        }, autoRefresh.interval);
      } catch (error) {
        console.error("Error setting up auto-refresh timer:", error);
        showError("Failed to set up auto-refresh. Please try toggling it off and on again.");
      }
    }

    // Cleanup on unmount
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [autoRefresh.enabled, autoRefresh.interval, isConnected, provider, address, chainId, dispatch]);

  // Fetch vault data
  useEffect(() => {
    if (!isConnected || !address || !provider || !chainId) {
      dispatch(clearVaults());
      return;
    }

    const fetchUserVaults = async () => {
      dispatch(setLoadingVaults(true));
      dispatch(setVaultError(null));

      try {
        // Get all vaults for the user
        const vaultAddresses = await getUserVaults(address, provider);

        // For each vault, get detailed information
        const vaultsWithInfo = await Promise.all(
          vaultAddresses.map(async (vaultAddress) => {
            try {
              const info = await getVaultInfo(vaultAddress, provider);
              return {
                address: vaultAddress,
                ...info
              };
            } catch (vaultError) {
              console.error(`Error fetching info for vault ${vaultAddress}:`, vaultError);
              // Return minimal info so we don't lose the vault completely
              return {
                address: vaultAddress,
                name: "Unknown Vault",
                creationTime: 0,
                error: vaultError.message
              };
            }
          })
        );

        dispatch(setVaults(vaultsWithInfo));
      } catch (error) {
        console.error("Error fetching user vaults:", error);
        dispatch(setVaultError(`Failed to load vaults: ${error.message}`));
        showError(`Failed to load your vaults: ${error.message}`);
      } finally {
        dispatch(setLoadingVaults(false));
      }
    };

    fetchUserVaults();
  }, [isConnected, address, provider, chainId, lastUpdate, dispatch]);

  // Fetch positions data from all platforms for the user's wallet
  // Effect 1: Handle disconnection and clear state
  useEffect(() => {
    if (!isConnected || !address || !provider || !chainId) {
      console.warn("Wallet disconnected or incomplete connection, clearing state");
      setLocalPositions([]);
      dispatch(setPositions([]));
      dispatch(clearPools());
      dispatch(clearTokens());
      dispatch(clearPlatforms());
      dispatch(clearVaults());
      setError(null);
    }
  }, [isConnected, address, provider, chainId, dispatch]);

  // Effect 2: Fetch wallet positions when connected
  useEffect(() => {
    if (!isConnected || !address || !provider || !chainId) {
      return; // Exit early if not connected
    }

    const fetchWalletPositions = async () => {
      setLoading(true);
      setError(null);
      dispatch(setResourceUpdating({ resource: 'positions', isUpdating: true }));

      try {
        // Get all platform adapters for the current chain
        const adapters = AdapterFactory.getAdaptersForChain(chainId, provider);

        if (adapters.length === 0) {
          throw new Error(`No supported platforms found for chainId: ${chainId}`);
        }

        // Store supported platform IDs
        const supportedPlatforms = adapters.map(adapter => ({
          id: adapter.platformId,
          name: adapter.platformName
        }));

        // Update Redux with supported platforms
        dispatch(setPlatforms(supportedPlatforms));

        // Fetch positions from all platforms in parallel
        const platformResults = await Promise.all(
          adapters.map(async adapter => {
            try {
              return await adapter.getPositions(address, chainId);
            } catch (adapterError) {
              console.error(`Error fetching positions from ${adapter.platformName}:`, adapterError);
              showError(`Failed to fetch positions from ${adapter.platformName}. Some data may be missing.`);
              // Return empty result to avoid breaking the entire flow
              return { positions: [], poolData: {}, tokenData: {} };
            }
          })
        );

        // Combine position data from all platforms
        let allPositions = [];
        let allPoolData = {};
        let allTokenData = {};
        let activePlatforms = [];

        platformResults.forEach((result, index) => {
          if (result && result.positions && result.positions.length > 0) {
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

        // Mark these positions as direct wallet positions (not in vault)
        allPositions = allPositions.map(position => ({
          ...position,
          inVault: false,
          vaultAddress: null
        }));

        setLocalPositions(allPositions);
        dispatch(setPositions(allPositions));
        dispatch(setPools(allPoolData));
        dispatch(setTokens(allTokenData));

        // Success notification removed as per request - positions are visible on screen

      } catch (error) {
        console.error("Position fetching error:", error);
        setError(`Error fetching positions: ${error.message}`);
        showError(`Failed to fetch your positions: ${error.message}`);
        setLocalPositions([]);
        dispatch(setPositions([]));
        // Do not clear pools or tokens on partial error—only on disconnect
      } finally {
        setLoading(false);
        dispatch(setResourceUpdating({ resource: 'positions', isUpdating: false }));
      }
    };

    fetchWalletPositions();
  }, [isConnected, address, provider, chainId, lastUpdate, dispatch]);

  // Effect 3: Fetch vault positions when wallet is connected and vaults are loaded
  useEffect(() => {
    if (!isConnected || !address || !provider || !chainId || !userVaults || userVaults.length === 0) {
      return; // Exit early if not connected or no vaults
    }

    const fetchVaultPositions = async () => {
      dispatch(setResourceUpdating({ resource: 'vaultPositions', isUpdating: true }));

      // Get current pool and token data from the store
      const currentPools = {...(pools || {})};
      const currentTokens = {...(tokens || {})};

      // Get adapters again (could be pulled from previous effect if stored)
      const adapters = AdapterFactory.getAdaptersForChain(chainId, provider);

      if (adapters.length === 0) {
        dispatch(setResourceUpdating({ resource: 'vaultPositions', isUpdating: false }));
        return;
      }

      const vaultErrors = [];

      for (const vault of userVaults) {
        try {
          let vaultPositionsFound = 0;

          // For each vault, fetch positions from all platforms
          for (const adapter of adapters) {
            try {
              const result = await adapter.getPositions(vault.address, chainId);

              if (result && result.positions && result.positions.length > 0) {
                vaultPositionsFound += result.positions.length;

                // Add these positions to Redux with vault flag
                dispatch(addVaultPositions({
                  positions: result.positions,
                  vaultAddress: vault.address
                }));

                // Also merge any new pool or token data
                if (result.poolData) {
                  dispatch(setPools({
                    ...currentPools,
                    ...result.poolData
                  }));
                  // Update our local copy
                  Object.assign(currentPools, result.poolData);
                }

                if (result.tokenData) {
                  dispatch(setTokens({
                    ...currentTokens,
                    ...result.tokenData
                  }));
                  // Update our local copy
                  Object.assign(currentTokens, result.tokenData);
                }
              }
            } catch (adapterError) {
              console.error(`Error fetching ${adapter.platformName} positions from vault ${vault.name}:`, adapterError);
              vaultErrors.push(`${vault.name}: ${adapterError.message}`);
              // Continue with other adapters even if one fails
            }
          }
        } catch (vaultError) {
          console.error(`Error processing vault ${vault.name}:`, vaultError);
          vaultErrors.push(`${vault.name}: ${vaultError.message}`);
          // Continue with other vaults even if one fails
        }
      }

      // Success notification removed as per request - vault positions are visible on screen

      if (vaultErrors.length > 0) {
        // Group errors to avoid too many toasts
        showError(`Had trouble with some vaults: ${vaultErrors.slice(0, 2).join(', ')}${vaultErrors.length > 2 ? '...' : ''}`);
      }

      dispatch(setResourceUpdating({ resource: 'vaultPositions', isUpdating: false }));
    };

    fetchVaultPositions();
  }, [isConnected, address, provider, chainId, userVaults, lastUpdate, dispatch]);

  // Filter active positions (with liquidity > 0)
  // Apply platform filter if selected
  const activePositions = positions
    .filter((pos) => pos.liquidity > 0)
    .filter((pos) => platformFilter === null || pos.platform === platformFilter);

  // Get the refreshing state
  const isUpdatingPositions = resourcesUpdating?.positions || false;
  const isUpdatingVaultPositions = resourcesUpdating?.vaultPositions || false;

  // Count vault positions for display
  const vaultPositionsCount = positions.filter(p => p.inVault).length;

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
              Connected to {getChainName(chainId) || `Chain ID ${chainId}`}
            </small>
          )}
        </Alert>
      ) : (
        <>
          <div className="d-flex justify-content-between align-items-center mb-3">
            <div className="d-flex align-items-center">
              <p className="text-muted mb-0 me-3">
                Found {activePositions.length} active position{activePositions.length !== 1 ? 's' : ''}
                {vaultPositionsCount > 0 && (
                  <span className="ms-1">
                    (including <strong>{vaultPositionsCount}</strong> in vaults)
                  </span>
                )}
              </p>

              {/* Create position button */}
              <Button
                variant="outline-custom"
                size="sm"
                onClick={() => setShowCreatePositionModal(true)}
                disabled={!isConnected}
              >
                + Create Position
              </Button>
            </div>

            <div className="d-flex align-items-center">
              {(isUpdatingPositions || isUpdatingVaultPositions) && (
                <div className="d-flex align-items-center me-3">
                  <Spinner animation="border" size="sm" variant="secondary" className="me-2" />
                  <small className="text-muted">
                    {isUpdatingVaultPositions ? "Fetching vault positions..." : "Refreshing..."}
                  </small>
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
                  // Pass inVault property to the position card
                  inVault={pos.inVault}
                  vaultAddress={pos.vaultAddress}
                />
              </Col>
            ))}
          </Row>
        </>
      )}

      {/* Create Position Modal - Updated to use the refactored AddLiquidityModal */}
      <AddLiquidityModal
        show={showCreatePositionModal}
        onHide={() => setShowCreatePositionModal(false)}
        position={null} // Null means we're creating a new position
      />
    </div>
  );
}
