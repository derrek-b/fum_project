// src/components/CreateVaultModal.js
import React, { useState } from "react";
import { Modal, Button, Form, Spinner, Alert } from "react-bootstrap";
import { useSelector, useDispatch } from "react-redux";
import { useToast } from "../../context/ToastContext";
import { useProvider } from '../../contexts/ProviderContext';
import { createVault } from 'fum_library/blockchain/contracts';
import { triggerUpdate } from "../../redux/updateSlice";
import { useRouter } from "next/router";

export default function CreateVaultModal({
  show,
  onHide
}) {
  const { showError, showSuccess } = useToast();
  const dispatch = useDispatch();
  const router = useRouter();

  // Get data from Redux store
  const { address } = useSelector((state) => state.wallet);
  const { provider } = useProvider();

  // Form state for vault info
  const [vaultName, setVaultName] = useState("");
  const [vaultDescription, setVaultDescription] = useState("");
  const [isCreatingVault, setIsCreatingVault] = useState(false);
  const [txError, setTxError] = useState("");

  // Create vault
  const handleCreateVault = async () => {
    if (!provider || !address) {
      showError("Wallet not connected");
      return null;
    }

    try {
      const signer = await provider.getSigner();
      const vaultAddress = await createVault(vaultName, signer);
      return vaultAddress;
    } catch (error) {
      // Only log if it's not a user rejection
      if (error.code !== 'ACTION_REJECTED' && error.code !== 4001 && !error.message?.includes('user rejected')) {
        console.error("Error creating vault:", error);
      }
      throw error;
    }
  };

  // Handle form submission
  const handleSubmit = async (e) => {
    e.preventDefault();

    const form = e.currentTarget;

    // Form validation
    if (form.checkValidity() === false) {
      e.stopPropagation();
      return;
    }

    // Check if vault name is entered
    if (!vaultName.trim()) {
      showError("Please enter a vault name");
      return;
    }

    try {
      // Set loading state
      setIsCreatingVault(true);
      setTxError("");

      // Create the vault
      const vaultAddress = await handleCreateVault();

      // Show success message
      showSuccess(`Vault "${vaultName}" created successfully!`);

      // Close modal
      onHide();

      // Navigate to the vault details page
      router.push(`/vault/${vaultAddress}`);
    } catch (error) {
      // Always set loading state to false first to prevent state update issues
      setIsCreatingVault(false);

      // Check if user cancelled the transaction
      if (error.code === 'ACTION_REJECTED' || error.code === 4001 || error.message?.includes('user rejected')) {
        // User cancelled - silently ignore, modal stays open
        // Don't log to console to avoid triggering error boundaries
        return;
      }

      // Real error - log and show user-friendly message
      console.error("Error creating vault:", error);
      const errorDetail = error.reason || error.message;
      setTxError(`Transaction failed${errorDetail ? `: ${errorDetail}` : ''}`);
    }
  };

  // Handle modal close
  const handleModalClose = () => {
    if (isCreatingVault) {
      showError("Cannot close this window while the transaction is in progress");
      return;
    }
    onHide();
  };

  return (
    <Modal
      show={show}
      onHide={handleModalClose}
      centered
      backdrop="static"
      keyboard={false}
      size="md"
    >
      <Modal.Header closeButton={!isCreatingVault}>
        <Modal.Title>Create New Vault</Modal.Title>
      </Modal.Header>

      <Form noValidate onSubmit={handleSubmit}>
        <Modal.Body>
          <div className="mb-3">
            <p>
              A vault allows you to group your DeFi positions and apply strategies to them.
            </p>
          </div>

          <Form.Group className="mb-3">
            <Form.Label>Vault Name <span className="text-danger">*</span></Form.Label>
            <Form.Control
              type="text"
              placeholder="Enter a name for your vault"
              value={vaultName}
              onChange={(e) => setVaultName(e.target.value)}
              disabled={isCreatingVault}
              required
              maxLength={50}
            />
            <Form.Text className="text-muted">
              Choose a meaningful name to help you identify this vault.
            </Form.Text>
          </Form.Group>

          <Form.Group className="mb-3">
            <Form.Label>Description (Optional)</Form.Label>
            <Form.Control
              as="textarea"
              rows={2}
              placeholder="What is this vault for? (Optional)"
              value={vaultDescription}
              onChange={(e) => setVaultDescription(e.target.value)}
              disabled={isCreatingVault}
              maxLength={200}
            />
            <Form.Text className="text-muted">
              Add context or notes about this vault's purpose.
            </Form.Text>
          </Form.Group>

          {txError && (
            <Alert variant="danger">
              {txError}
            </Alert>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={onHide} disabled={isCreatingVault}>
            Cancel
          </Button>
          <Button
            variant="primary"
            type="submit"
            disabled={isCreatingVault || !vaultName.trim()}
          >
            {isCreatingVault ? (
              <>
                <Spinner
                  as="span"
                  animation="border"
                  size="sm"
                  role="status"
                  aria-hidden="true"
                  className="me-2"
                />
                Creating Vault...
              </>
            ) : "Create Vault"}
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
}
