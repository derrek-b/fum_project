// src/components/CreateVaultModal.js
import React, { useState, useEffect } from "react";
import { Modal, Button, Form, Spinner, Alert } from "react-bootstrap";
import { useSelector } from "react-redux";
import { useToast } from "../context/ToastContext";

export default function CreateVaultModal({
  show,
  onHide,
  onCreateVault,
  isCreating,
  errorMessage
}) {
  const { showError } = useToast();
  const { isConnected } = useSelector((state) => state.wallet);

  // Form state
  const [vaultName, setVaultName] = useState("");
  const [vaultDescription, setVaultDescription] = useState("");
  const [validated, setValidated] = useState(false);

  // Reset form state when modal opens/closes
  useEffect(() => {
    if (show) {
      setVaultName("");
      setVaultDescription("");
      setValidated(false);
    }
  }, [show]);

  // Handle form submission
  const handleSubmit = async (e) => {
    e.preventDefault();

    const form = e.currentTarget;

    // Form validation
    if (form.checkValidity() === false) {
      e.stopPropagation();
      setValidated(true);
      return;
    }

    setValidated(true);

    try {
      // Validate wallet connection
      if (!isConnected) {
        throw new Error("Please connect your wallet to create a vault");
      }

      // Call the parent component's creation handler
      await onCreateVault(vaultName, vaultDescription);
    } catch (error) {
      console.error("Error in vault creation form:", error);
      showError(error.message);
    }
  };

  // Handle modal close with safety checks
  const handleModalClose = () => {
    if (isCreating) {
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
    >
      <Form noValidate validated={validated} onSubmit={handleSubmit}>
        <Modal.Header closeButton>
          <Modal.Title>Create New Vault</Modal.Title>
        </Modal.Header>

        <Modal.Body>
          <p>
            A vault allows you to group your DeFi positions and apply automated
            strategies to them. You'll be able to deposit positions and configure
            strategies after creation.
          </p>

          <Form.Group className="mb-3">
            <Form.Label>Vault Name <span className="text-danger">*</span></Form.Label>
            <Form.Control
              type="text"
              placeholder="Enter a name for your vault"
              value={vaultName}
              onChange={(e) => setVaultName(e.target.value)}
              disabled={isCreating}
              required
              maxLength={50}
            />
            <Form.Control.Feedback type="invalid">
              Please provide a name for your vault.
            </Form.Control.Feedback>
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
              disabled={isCreating}
              maxLength={200}
            />
            <Form.Text className="text-muted">
              Add context or notes about this vault's purpose.
            </Form.Text>
          </Form.Group>

          {errorMessage && (
            <Alert variant="danger" className="mb-0">
              {errorMessage}
            </Alert>
          )}
        </Modal.Body>

        <Modal.Footer>
          <Button variant="secondary" onClick={handleModalClose} disabled={isCreating}>
            Cancel
          </Button>
          <Button
            variant="primary"
            type="submit"
            disabled={isCreating || !vaultName.trim()}
          >
            {isCreating ? (
              <>
                <Spinner
                  as="span"
                  animation="border"
                  size="sm"
                  role="status"
                  aria-hidden="true"
                  className="me-2"
                />
                Creating...
              </>
            ) : "Create Vault"}
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
}
