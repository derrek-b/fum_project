// src/components/VaultsContainer.js
import React, { useEffect, useState } from "react";
import { useSelector, useDispatch } from "react-redux";
import { Row, Col, Alert, Spinner, Button, Toast, ToastContainer } from "react-bootstrap";
import VaultCard from "./VaultCard";
import CreateVaultModal from "./CreateVaultModal";
import { createVault } from "../../utils/contracts";
import { triggerUpdate } from "../../redux/updateSlice";
import { setLoadingVaults, setVaultError } from '../../redux/vaultsSlice';
import { setResourceUpdating } from '../../redux/updateSlice';
import { loadVaultData } from '../../utils/vaultsHelpers';

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

  // Helper for showing error/success messages that can be passed to the vault helper
  const showError = (message) => {
    addNotification(message, 'danger');
  };

  const showSuccess = (message) => {
    addNotification(message, 'success');
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

    // 1. Set loading states
    dispatch(setLoadingVaults(true));
    dispatch(setVaultError(null));
    dispatch(setResourceUpdating({ resource: 'vaults', isUpdating: true }));

    // 2. Use our helper function to load all data
    loadVaultData(address, provider, chainId, dispatch, { showError, showSuccess })
      .then(result => {
        if (!result.success) {
          console.error(`Error loading vaults: ${result.error}`);
          setError(`Failed to load vaults: ${result.error}`);
          dispatch(setVaultError(`Failed to load vaults: ${result.error}`));
        } else {
          console.log("All vault data loaded successfully");
        }
      })
      .catch(error => {
        console.error(`Error loading vault data: ${error.message}`);
        setError(`Failed to load vaults: ${error.message}`);
        dispatch(setVaultError(`Failed to load vaults: ${error.message}`));
        showError(`Failed to load your vaults: ${error.message}`);
      })
      .finally(() => {
        dispatch(setLoadingVaults(false));
        dispatch(setResourceUpdating({ resource: 'vaults', isUpdating: false }));
        setIsLoading(false);
      });

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
      showSuccess(`Successfully created vault: ${vaultName}`);
      if (strategyConfig) {
        showSuccess(`Strategy configuration saved. Will be activated in future update.`);
      }

      setShowCreateVaultModal(false);
    } catch (error) {
      setCreateVaultError(error.message);
      // Add an error notification
      showError(`Failed to create vault: ${error.message}`);
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
