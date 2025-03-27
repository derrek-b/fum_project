// src/components/VaultsContainer.js
import React, { useEffect, useState, useRef } from "react";
import { useSelector, useDispatch } from "react-redux";
import { Row, Col, Alert, Spinner, Button } from "react-bootstrap";
import { ErrorBoundary } from "react-error-boundary";
import VaultCard from "./VaultCard";
import CreateVaultModal from "./CreateVaultModal";
import { createVault } from "../utils/contracts";
import { addVault } from "../redux/vaultsSlice";
import { triggerUpdate, markAutoRefresh } from "../redux/updateSlice";
import { useToast } from "../context/ToastContext";
import { useVaultData } from "../hooks/useVaultData";

// Error Fallback Component
function ErrorFallback({ error, resetErrorBoundary }) {
  const { showError } = useToast();

  React.useEffect(() => {
    console.error("Vaults error:", error);
    showError("There was a problem loading your vaults. Please try again.");
  }, [error, showError]);

  return (
    <Alert variant="danger" className="my-4">
      <Alert.Heading>Error Loading Vaults</Alert.Heading>
      <p>
        We encountered an error while loading your vaults. Please try refreshing.
      </p>
      <hr />
      <div className="d-flex justify-content-end">
        <Button
          variant="outline-danger"
          onClick={resetErrorBoundary}
        >
          Try again
        </Button>
      </div>
    </Alert>
  );
}

export default function VaultsContainer() {
  const dispatch = useDispatch();
  const { showError, showSuccess } = useToast();

  // Get wallet and update data from Redux
  const { isConnected, address, chainId, provider } = useSelector((state) => state.wallet);
  const { userVaults, isLoadingVaults, vaultError } = useSelector((state) => state.vaults);
  const { lastUpdate, autoRefresh, resourcesUpdating } = useSelector((state) => state.updates);

  // Use our custom hook for loading vault data
  const { isLoading, error, loadData } = useVaultData();

  // State for create vault modal
  const [showCreateVaultModal, setShowCreateVaultModal] = useState(false);
  const [isCreatingVault, setIsCreatingVault] = useState(false);
  const [createVaultError, setCreateVaultError] = useState(null);

  // Track the last refresh time to prevent excessive updates
  const lastRefreshTimeRef = useRef(Date.now());
  const timerRef = useRef(null);

  // Load data when component mounts or dependencies change
  useEffect(() => {
    if (isConnected && address && provider && chainId) {
      loadData();
    }
  // lastUpdate is the only value that should trigger a reload once connected
  }, [isConnected, address, provider, chainId, lastUpdate, loadData]);

  // Set up auto-refresh timer for vaults
  useEffect(() => {
    // Clear any existing timer
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    // Only set up timer if auto-refresh is enabled and we're connected
    if (autoRefresh.enabled && isConnected && provider && address && chainId) {
      try {
        console.log(`Setting up vaults auto-refresh timer with interval: ${autoRefresh.interval}ms`);
        timerRef.current = setInterval(() => {
          const now = Date.now();
          const timeSinceLastRefresh = now - lastRefreshTimeRef.current;

          // Enforce a minimum time between refreshes (5 seconds)
          // This prevents rapid-fire updates that could cause loops
          if (timeSinceLastRefresh >= 5000) {
            console.log(`Vaults auto-refresh triggered at ${new Date(now).toISOString()}`);
            lastRefreshTimeRef.current = now;

            // Dispatch refresh actions
            dispatch(markAutoRefresh());
            dispatch(triggerUpdate(now));
          } else {
            console.log(`Skipping auto-refresh - too soon (${timeSinceLastRefresh}ms since last refresh)`);
          }
        }, autoRefresh.interval);
      } catch (error) {
        console.error("Error setting up vaults auto-refresh timer:", error);
        showError("Failed to set up auto-refresh for vaults. Please try toggling it off and on again.");
      }
    }

    // Cleanup on unmount
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [autoRefresh.enabled, autoRefresh.interval, isConnected, provider, address, chainId, dispatch, showError]);

  // Handle vault creation
  const handleCreateVault = async (vaultName) => {
    setIsCreatingVault(true);
    setCreateVaultError(null);

    try {
      // Validate
      if (!vaultName || vaultName.trim() === '') {
        throw new Error("Vault name is required");
      }

      if (!provider || !address) {
        throw new Error("Wallet connection required");
      }

      // Get signer
      const signer = await provider.getSigner();

      // Create the vault - this will call our VaultFactory contract
      console.log(`Creating new vault: ${vaultName}`);
      const newVaultAddress = await createVault(vaultName, signer);

      // Use our hook to reload data which will fetch the new vault too
      loadData();

      showSuccess(`Successfully created vault: ${vaultName}`);
      setShowCreateVaultModal(false);
    } catch (error) {
      console.error("Error creating vault:", error);
      setCreateVaultError(error.message);
      showError(`Failed to create vault: ${error.message}`);
    } finally {
      setIsCreatingVault(false);
    }
  };

  // Get the refreshing state
  const isUpdatingVaults = resourcesUpdating?.vaults || false;

  // Determine the overall loading state
  const showLoading = isLoading || (isLoadingVaults && userVaults.length === 0);

  return (
    <div className="mb-5">
      <h2 className="mb-3">Your Vaults</h2>

      <ErrorBoundary
        FallbackComponent={ErrorFallback}
        onReset={() => {
          loadData();
        }}
      >
        {!isConnected ? (
          <Alert variant="info" className="text-center">
            Connect your wallet to view your vaults
          </Alert>
        ) : showLoading ? (
          <div className="text-center py-4">
            <Spinner animation="border" variant="primary" role="status" />
            <p className="mt-3">Loading your vaults...</p>
          </div>
        ) : error || (vaultError && userVaults.length === 0) ? (
          <Alert variant="danger">
            <Alert.Heading>Error Loading Vaults</Alert.Heading>
            <p>{error || vaultError}</p>
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
              <div className="d-flex align-items-center">
                {isUpdatingVaults && (
                  <div className="d-flex align-items-center me-3">
                    <Spinner animation="border" size="sm" variant="secondary" className="me-2" />
                    <small className="text-muted">Refreshing...</small>
                  </div>
                )}
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
      </ErrorBoundary>

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
