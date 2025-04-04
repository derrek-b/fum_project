// src/components/VaultsContainer.js
import React, { useEffect, useState } from "react";
import { useSelector, useDispatch } from "react-redux";
import { Row, Col, Alert, Spinner, Button, Toast, ToastContainer } from "react-bootstrap";
import VaultCard from "./VaultCard";
import CreateVaultModal from "./CreateVaultModal";
import { createVault, getUserVaults, getVaultInfo } from "../utils/contracts";
import { triggerUpdate } from "../redux/updateSlice";
import { AdapterFactory } from '../adapters';
import { setVaults, setLoadingVaults, setVaultError, updateVaultPositions, updateVaultMetrics } from '../redux/vaultsSlice';
import { addVaultPositions, setPositions } from '../redux/positionsSlice';
import { setPools } from '../redux/poolSlice';
import { setTokens } from '../redux/tokensSlice';
import { setResourceUpdating } from '../redux/updateSlice';
import { fetchTokenPrices, calculateUsdValueSync, prefetchTokenPrices } from '../utils/coingeckoUtils';

export default function VaultsContainer() {
  const dispatch = useDispatch();

  // Redux state
  const { isConnected, address, chainId, provider } = useSelector((state) => state.wallet);
  const { userVaults } = useSelector((state) => state.vaults);
  const { lastUpdate } = useSelector((state) => state.updates);

  // Local state
  const [isLoading, setIsLoading] = useState(true);
  const [showCreateVaultModal, setShowCreateVaultModal] = useState(false);
  const [isCreatingVault, setIsCreatingVault] = useState(false);
  const [createVaultError, setCreateVaultError] = useState(null);
  const [error, setError] = useState(null);
  const [notifications, setNotifications] = useState([]);

  // Local notification handling
  const addNotification = (message, variant = 'success') => {
    const id = Date.now();
    setNotifications(prev => [...prev, { id, message, variant }]);

    // Auto-remove after 5 seconds without causing re-renders of the main component
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== id));
    }, 5000);
  };

  const removeNotification = (id) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  };

  // Load data effect
  useEffect(() => {
    // Skip if not connected
    if (!isConnected || !address || !provider || !chainId) {
      setIsLoading(false);
      return;
    }

    console.log("Starting vault data loading");
    setIsLoading(true);
    setError(null);

    async function loadData() {
      try {
        // 1. Load basic vault data
        console.log("Fetching user vaults...");
        dispatch(setLoadingVaults(true));
        dispatch(setVaultError(null));
        dispatch(setResourceUpdating({ resource: 'vaults', isUpdating: true }));

        const vaultAddresses = await getUserVaults(address, provider);
        console.log(`Found ${vaultAddresses.length} vault addresses`);

        // Get details for each vault
        const vaultsWithInfo = await Promise.all(
          vaultAddresses.map(async (vaultAddress) => {
            try {
              const info = await getVaultInfo(vaultAddress, provider);
              return {
                address: vaultAddress,
                ...info,
                positions: [],
                metrics: { tvl: 0, positionCount: 0 }
              };
            } catch (error) {
              console.error(`Error fetching vault info: ${error.message}`);
              return {
                address: vaultAddress,
                name: "Unknown Vault",
                creationTime: 0,
                positions: [],
                metrics: { tvl: 0, positionCount: 0 }
              };
            }
          })
        );

        // Update Redux with vault info
        dispatch(setVaults(vaultsWithInfo));

        // 2. Fetch positions for each vault
        const vaultPositions = [];
        const allPoolData = {};
        const allTokenData = {};
        const positionsByVault = {};

        const adapters = AdapterFactory.getAdaptersForChain(chainId, provider);

        for (const vault of vaultsWithInfo) {
          console.log(`Fetching positions for vault: ${vault.address}`);

          const vaultPositionIds = [];
          const currentVaultPositions = [];

          for (const adapter of adapters) {
            try {
              const result = await adapter.getPositions(vault.address, chainId);

              if (result && result.positions && result.positions.length > 0) {
                console.log(`Found ${result.positions.length} positions`);

                result.positions.forEach(position => {
                  vaultPositionIds.push(position.id);
                  currentVaultPositions.push(position);
                  vaultPositions.push({
                    ...position,
                    inVault: true,
                    vaultAddress: vault.address
                  });
                });

                // Collect pool and token data
                if (result.poolData) {
                  Object.assign(allPoolData, result.poolData);
                }

                if (result.tokenData) {
                  Object.assign(allTokenData, result.tokenData);
                }
              }
            } catch (error) {
              console.error(`Error fetching positions: ${error.message}`);
              // Continue with other adapters
            }
          }

          // Store positions for this vault
          if (vaultPositionIds.length > 0) {
            dispatch(updateVaultPositions({
              vaultAddress: vault.address,
              positionIds: vaultPositionIds,
              operation: 'replace'
            }));

            dispatch(updateVaultMetrics({
              vaultAddress: vault.address,
              metrics: { positionCount: vaultPositionIds.length }
            }));

            positionsByVault[vault.address] = currentVaultPositions;
          }
        }

        // 3. Fetch ALL positions (including non-vault positions)
        console.log("Fetching all positions including non-vault positions");
        const allPositions = [...vaultPositions]; // Start with vault positions
        const vaultPositionIds = vaultPositions.map(pos => pos.id);

        for (const adapter of adapters) {
          try {
            // Use getAllUserPositions instead of getNonVaultPositions
            // (assuming this method exists on the adapter)
            const result = await adapter.getPositions(address, chainId);
            console.log('RESULT', result.poolData)

            if (result && result.positions && result.positions.length > 0) {
              console.log(`Found ${result.positions.length} total ${adapter.platformName} positions`);

              // Filter to only include positions not already in vaults
              let nonVaultPositions = result.positions.filter(
                position => !vaultPositionIds.includes(position.id)
              );

              nonVaultPositions = nonVaultPositions.map((pos) => {
                return {
                  ...pos,
                  inVault: false,
                  vaultAddress: null
                }
              })

              console.log(`${nonVaultPositions.length} positions are not in vaults`);

              // Add non-vault positions to allPositions
              allPositions.push(...nonVaultPositions);

              // Collect additional pool and token data
              if (result.poolData) {
                Object.assign(allPoolData, result.poolData);
              }

              if (result.tokenData) {
                Object.assign(allTokenData, result.tokenData);
              }
            }
          } catch (error) {
            console.error(`Error fetching all positions from ${adapter.platformName}: ${fallbackError.message}`);
            // Continue with other adapters
          }
        }

        console.log('ALL POOL DATA', allPoolData)

        // Update Redux with ALL positions (vault and non-vault)
        dispatch(setPositions(allPositions));

        if (Object.keys(allPoolData).length > 0) {
          console.log("DISPATCHING POOLS")
          dispatch(setPools(allPoolData));
        }

        if (Object.keys(allTokenData).length > 0) {
          dispatch(setTokens(allTokenData));
        }

        // 4. Calculate TVL for each vault
        console.log("Calculating TVL for all vaults...");

        for (const vault of vaultsWithInfo) {
          const vaultPositions = positionsByVault[vault.address] || [];

          if (vaultPositions.length === 0) {
            console.log(`No positions for vault ${vault.address}, skipping TVL calculation`);
            continue;
          }

          console.log(`Calculating TVL for vault ${vault.address} with ${vaultPositions.length} positions`);

          // Get unique token symbols and collect data
          const tokenSymbols = new Set();
          const positionData = [];

          // Process each position
          for (const position of vaultPositions) {
            try {
              if (!position.poolAddress || !allPoolData[position.poolAddress]) continue;

              const poolData = allPoolData[position.poolAddress];
              if (!poolData.token0 || !poolData.token1) continue;

              const token0Data = allTokenData[poolData.token0];
              const token1Data = allTokenData[poolData.token1];

              if (!token0Data?.symbol || !token1Data?.symbol) continue;

              tokenSymbols.add(token0Data.symbol);
              tokenSymbols.add(token1Data.symbol);

              positionData.push({
                position,
                poolData,
                token0Data,
                token1Data
              });
            } catch (error) {
              console.error(`Error processing position data: ${error.message}`);
            }
          }

          if (positionData.length === 0) {
            console.log(`No valid position data for vault ${vault.address}`);
            continue;
          }

          // Fetch token prices
          let tokenPrices = {};
          let pricesFetchFailed = false;

          try {
            console.log("Fetching prices for tokens:", Array.from(tokenSymbols));
            // Prefetch all token prices at once to populate the cache
            await prefetchTokenPrices(Array.from(tokenSymbols));
          } catch (error) {
            console.error(`Error prefetching token prices: ${error.message}`);
            pricesFetchFailed = true;
          }

          // Calculate TVL
          let totalTVL = 0;
          let hasPartialData = pricesFetchFailed;

          for (const data of positionData) {
            try {
              const adapter = AdapterFactory.getAdapter(data.position.platform, provider);
              if (!adapter) continue;

              const tokenBalances = await adapter.calculateTokenAmounts(
                data.position,
                data.poolData,
                data.token0Data,
                data.token1Data,
                chainId
              );

              if (!tokenBalances) continue;

              // Use the sync version since we've already prefetched prices
              const token0UsdValue = calculateUsdValueSync(
                tokenBalances.token0.formatted,
                data.token0Data.symbol
              );

              const token1UsdValue = calculateUsdValueSync(
                tokenBalances.token1.formatted,
                data.token1Data.symbol
              );

              if (token0UsdValue) totalTVL += token0UsdValue;
              if (token1UsdValue) totalTVL += token1UsdValue;

              // Log successful value calculations
              console.log(`Position ${data.position.id}: ${data.token0Data.symbol} = $${token0UsdValue?.toFixed(2) || 'N/A'}, ${data.token1Data.symbol} = $${token1UsdValue?.toFixed(2) || 'N/A'}`);

              // If either token value couldn't be calculated, mark as partial data
              if (token0UsdValue === null || token1UsdValue === null) {
                hasPartialData = true;
              }
            } catch (error) {
              console.error(`Error calculating position value: ${error.message}`);
              hasPartialData = true;
            }
          }
          console.log(4)

          console.log(`Final TVL for vault ${vault.address}: ${totalTVL.toFixed(2)}`);

          // Update vault metrics with TVL
          dispatch(updateVaultMetrics({
            vaultAddress: vault.address,
            metrics: {
              tvl: totalTVL,
              hasPartialData,
              lastTVLUpdate: Date.now() + 1
            }
          }));
        }

        console.log("All vault data loaded successfully");
      } catch (error) {
        console.error(`Error loading vault data: ${error.message}`);
        setError(`Failed to load vaults: ${error.message}`);
        dispatch(setVaultError(`Failed to load vaults: ${error.message}`));
        addNotification(`Failed to load your vaults: ${error.message}`, 'danger');
      } finally {
        dispatch(setLoadingVaults(false));
        dispatch(setResourceUpdating({ resource: 'vaults', isUpdating: false }));
        setIsLoading(false);
      }
    }

    // Execute the data loading function
    loadData();
  }, [isConnected, address, provider, chainId, lastUpdate, dispatch]);

  // Handle vault creation
  const handleCreateVault = async (vaultName, vaultDescription, strategyConfig) => {
    if (!vaultName || !provider || !address) return;

    setIsCreatingVault(true);
    setCreateVaultError(null);

    try {
      const signer = await provider.getSigner();

      // Step 1: Create the vault - this remains the same for now
      const newVaultAddress = await createVault(vaultName, signer);

      // Log strategy config for future implementation
      if (strategyConfig) {
        console.log("Strategy config for vault:", newVaultAddress, strategyConfig);
        /*
        // This will be implemented in a future update:
        await configureVaultStrategy(
          newVaultAddress,
          strategyConfig.strategyId,
          strategyConfig.parameters,
          signer
        );
        */
      }

      // Trigger a reload by dispatching an update
      dispatch(triggerUpdate(Date.now()));

      // Add a success notification
      addNotification(`Successfully created vault: ${vaultName}`);
      if (strategyConfig) {
        addNotification(`Strategy configuration saved. Will be activated in future update.`);
      }

      setShowCreateVaultModal(false);
    } catch (error) {
      setCreateVaultError(error.message);
      // Add an error notification
      addNotification(`Failed to create vault: ${error.message}`, 'danger');
    } finally {
      setIsCreatingVault(false);
    }
  };

  // Render component
  return (
    <div className="mb-5">
      <h2 className="mb-3">Your Vaults</h2>

      {/* Bootstrap Toast Notifications */}
      <ToastContainer position="top-end" className="p-3" style={{ zIndex: 1100 }}>
        {notifications.map(notification => (
          <Toast
            key={notification.id}
            onClose={() => removeNotification(notification.id)}
            show={true}
            bg={notification.variant}
            className="mb-2"
            delay={5000}
            autohide
          >
            <Toast.Header closeButton>
              <strong className="me-auto">
                {notification.variant === 'danger' ? 'Error' : 'Success'}
              </strong>
            </Toast.Header>
            <Toast.Body className={notification.variant === 'danger' ? 'text-white' : ''}>
              {notification.message}
            </Toast.Body>
          </Toast>
        ))}
      </ToastContainer>

      {!isConnected ? (
        <Alert variant="info" className="text-center">
          Connect your wallet to view your vaults
        </Alert>
      ) : isLoading ? (
        <div className="text-center py-4">
          <Spinner animation="border" variant="primary" role="status" />
          <p className="mt-3">Loading your vaults...</p>
        </div>
      ) : error ? (
        <Alert variant="danger">
          <Alert.Heading>Error Loading Vaults</Alert.Heading>
          <p>{error}</p>
          <Button
            variant="outline-danger"
            size="sm"
            onClick={() => dispatch(triggerUpdate(Date.now()))}
            className="mt-2"
          >
            Try Again
          </Button>
        </Alert>
      ) : userVaults.length === 0 ? (
        <Alert variant="warning" className="text-center">
          <p className="mb-0">You don't have any vaults yet.</p>
          <p className="mt-2">
            <Button
              variant="primary"
              onClick={() => setShowCreateVaultModal(true)}
            >
              Create Your First Vault
            </Button>
          </p>
        </Alert>
      ) : (
        <>
          <div className="d-flex justify-content-between align-items-center mb-3">
            <div>
              <p className="text-muted mb-0">
                Found {userVaults.length} vault{userVaults.length !== 1 ? 's' : ''}
              </p>
            </div>
            <div>
              <Button
                variant="outline-primary"
                size="sm"
                onClick={() => setShowCreateVaultModal(true)}
                disabled={isCreatingVault}
              >
                {isCreatingVault ? (
                  <>
                    <Spinner size="sm" animation="border" className="me-1" />
                    Creating...
                  </>
                ) : '+ Create Vault'}
              </Button>
            </div>
          </div>

          <Row>
            {userVaults.map((vault) => (
              <Col md={6} key={vault.address}>
                <VaultCard vault={vault} />
              </Col>
            ))}
          </Row>
        </>
      )}

      {/* Create Vault Modal */}
      <CreateVaultModal
        show={showCreateVaultModal}
        onHide={() => setShowCreateVaultModal(false)}
        onCreateVault={handleCreateVault}
        isCreating={isCreatingVault}
        errorMessage={createVaultError}
      />
    </div>
  );
}
