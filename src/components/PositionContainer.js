// src/components/PositionContainer.js - Updated to fetch vault data
import React, { useEffect, useState, useRef } from "react";
import { Row, Col, Alert, Spinner, Button } from "react-bootstrap";
import { useSelector, useDispatch } from "react-redux";
import PositionCard from "./PositionCard";
import RefreshControls from "./RefreshControls";
import PlatformFilter from "./PlatformFilter";
import AddLiquidityModal from "./AddLiquidityModal";
import { AdapterFactory } from "../adapters";
import config from "../utils/config.js";
import { getUserVaults, getVaultInfo, getVaultContract } from "../utils/contracts";
import { setPositions, addVaultPositions } from "../redux/positionsSlice";
import { setPools, clearPools } from "../redux/poolSlice";
import { setTokens, clearTokens } from "../redux/tokensSlice";
import { triggerUpdate, setResourceUpdating, markAutoRefresh } from "../redux/updateSlice";
import { setPlatforms, setActivePlatforms, setPlatformFilter, clearPlatforms } from "../redux/platformsSlice";
import { setVaults, clearVaults, setLoadingVaults, setVaultError } from "../redux/vaultsSlice";

export default function PositionContainer() {
  const dispatch = useDispatch();
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
  const [isCreatingPosition, setIsCreatingPosition] = useState(false);
  const [createPositionError, setCreatePositionError] = useState(null);

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
            const info = await getVaultInfo(vaultAddress, provider);
            return {
              address: vaultAddress,
              ...info
            };
          })
        );

        console.log(`Found ${vaultsWithInfo.length} vaults for user ${address}`);
        dispatch(setVaults(vaultsWithInfo));
      } catch (error) {
        console.error("Error fetching user vaults:", error);
        dispatch(setVaultError(`Failed to load vaults: ${error.message}`));
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
      console.log("Wallet disconnected or incomplete connection, clearing state");
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

    fetchWalletPositions();
  }, [isConnected, address, provider, chainId, lastUpdate, dispatch]);

  // Effect 3: Fetch vault positions when wallet is connected and vaults are loaded
  useEffect(() => {
    if (!isConnected || !address || !provider || !chainId || !userVaults || userVaults.length === 0) {
      return; // Exit early if not connected or no vaults
    }

    const fetchVaultPositions = async () => {
      console.log(`Fetching positions from ${userVaults.length} vaults`);
      dispatch(setResourceUpdating({ resource: 'vaultPositions', isUpdating: true }));

      // Get current pool and token data from the store
      const currentPools = {...(pools || {})};
      const currentTokens = {...(tokens || {})};

      // Get adapters again (could be pulled from previous effect if stored)
      const adapters = AdapterFactory.getAdaptersForChain(chainId, provider);

      if (adapters.length === 0) {
        console.log("No adapters available for vault position fetching");
        dispatch(setResourceUpdating({ resource: 'vaultPositions', isUpdating: false }));
        return;
      }

      for (const vault of userVaults) {
        try {
          console.log(`Fetching positions from vault: ${vault.name} (${vault.address})`);

          // For each vault, fetch positions from all platforms
          for (const adapter of adapters) {
            try {
              console.log(`Checking ${adapter.platformName} positions in vault ${vault.name}`);
              const result = await adapter.getPositions(vault.address, chainId);

              if (result && result.positions && result.positions.length > 0) {
                console.log(`Found ${result.positions.length} ${adapter.platformName} positions in vault ${vault.name}`);

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
              // Continue with other adapters even if one fails
            }
          }
        } catch (vaultError) {
          console.error(`Error processing vault ${vault.name}:`, vaultError);
          // Continue with other vaults even if one fails
        }
      }

      dispatch(setResourceUpdating({ resource: 'vaultPositions', isUpdating: false }));
    };

    fetchVaultPositions();
}, [isConnected, address, provider, chainId, userVaults, lastUpdate, dispatch]);

  // Handle create position
  const handleCreatePosition = async (params) => {
    setCreatePositionError(null);
    setIsCreatingPosition(true);

    try {
      // Get adapter for the selected platform
      const adapter = AdapterFactory.getAdapter(params.platformId, provider);

      if (!adapter) {
        throw new Error(`No adapter available for platform: ${params.platformId}`);
      }

      await adapter.createPosition({
        ...params,
        provider,
        address,
        chainId,
        dispatch,
        onStart: () => setIsCreatingPosition(true),
        onFinish: () => setIsCreatingPosition(false),
        onSuccess: () => {
          setShowCreatePositionModal(false);
          dispatch(triggerUpdate()); // Refresh to show new position
        },
        onError: (errorMessage) => {
          setCreatePositionError(`Failed to create position: ${errorMessage}`);
        }
      });
    } catch (error) {
      console.error("Error creating position:", error);
      setCreatePositionError(`Error creating position: ${error.message}`);
      setIsCreatingPosition(false);
    }
  };

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
              Connected to {config.chains[chainId]?.name || `Chain ID ${chainId}`}
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
                variant="primary"
                size="sm"
                onClick={() => setShowCreatePositionModal(true)}
                disabled={!isConnected || isCreatingPosition}
              >
                {isCreatingPosition ?
                  <>
                    <Spinner size="sm" animation="border" className="me-1" />
                    Creating...
                  </> :
                  <>+ Create Position</>
                }
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

      {/* Create Position Modal */}
      <AddLiquidityModal
        show={showCreatePositionModal}
        onHide={() => setShowCreatePositionModal(false)}
        position={null} // Null means we're creating a new position
        isProcessing={isCreatingPosition}
        onCreatePosition={handleCreatePosition}
        errorMessage={createPositionError}
      />
    </div>
  );
}
