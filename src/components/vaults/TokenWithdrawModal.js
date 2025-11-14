// src/components/vaults/TokenWithdrawModal.js
import React, { useState, useEffect } from "react";
import { Modal, Button, Form, InputGroup, Spinner, Alert } from "react-bootstrap";
import { useSelector } from "react-redux";
import { ethers } from "ethers";
import { getTokenAddress } from 'fum_library/helpers/tokenHelpers';
import { getVaultContract } from 'fum_library/blockchain/contracts';
import { useToast } from "../../context/ToastContext";
import { useProvider } from "../../contexts/ProviderContext";

const TokenWithdrawModal = ({ show, onHide, vaultAddress, token, ownerAddress, onTokensUpdated }) => {
  const { chainId } = useSelector((state) => state.wallet);
  const { provider } = useProvider();
  const { showSuccess, showError } = useToast();

  // State
  const [amount, setAmount] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  // Reset state when modal closes
  useEffect(() => {
    if (!show) {
      setAmount("");
      setError("");
      setIsSubmitting(false);
    }
  }, [show]);

  // Handle max button click
  const handleMaxClick = () => {
    if (token) {
      setAmount(token.numericalBalance.toString());
    }
  };

  // Handle withdrawal
  const handleWithdraw = async () => {
    if (!token || !amount || !ownerAddress || !provider) {
      setError("Missing required information");
      return;
    }

    // Validate amount
    if (parseFloat(amount) <= 0) {
      setError("Amount must be greater than 0");
      return;
    }

    if (parseFloat(amount) > parseFloat(token.numericalBalance)) {
      setError("Amount exceeds vault balance");
      return;
    }

    setIsSubmitting(true);
    setError("");

    try {
      // Get token contract address
      const tokenAddress = getTokenAddress(token.symbol, chainId);

      // Get vault contract with signer
      const signer = await provider.getSigner();
      const vaultContract = getVaultContract(vaultAddress, provider).connect(signer);

      // Convert amount to token units
      const amountInUnits = ethers.utils.parseUnits(amount, token.decimals);

      // Call withdrawTokens on vault contract
      const tx = await vaultContract.withdrawTokens(tokenAddress, ownerAddress, amountInUnits);

      await tx.wait();

      showSuccess(`Successfully withdrew ${amount} ${token.symbol} from vault`);
      setAmount("");
      setIsSubmitting(false);
      if (onTokensUpdated) onTokensUpdated();
      onHide();
    } catch (err) {
      // Always set submitting to false first to prevent state update issues
      setIsSubmitting(false);

      // Check if user cancelled the transaction
      if (err.code === 'ACTION_REJECTED' || err.code === 4001 || err.message?.includes('user rejected')) {
        // User cancelled - silently ignore, modal stays open
        // Don't log to console to avoid triggering error boundaries
        return;
      }

      // Real error - log and show user-friendly message in modal
      console.error("Withdrawal error:", err);
      const errorDetail = err.reason || err.message;
      setError(`Transaction failed${errorDetail ? `: ${errorDetail}` : ''}`);
    }
  };

  // Don't render if no token selected
  if (!token) {
    return null;
  }

  return (
    <Modal
      show={show}
      onHide={onHide}
      centered
      size="md"
      backdrop="static"
    >
      <Modal.Header closeButton>
        <Modal.Title>Withdraw {token.symbol} from Vault</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {error && <Alert variant="danger">{error}</Alert>}

        <Form>
          {/* Token Info */}
          <div className="mb-4">
            <div className="d-flex align-items-center mb-2">
              {token.logoURI && (
                <div className="me-2">
                  <img
                    src={token.logoURI}
                    alt={token.symbol}
                    width={32}
                    height={32}
                  />
                </div>
              )}
              <div>
                <div className="fw-bold">{token.symbol}</div>
                <small className="text-muted">{token.name}</small>
              </div>
            </div>
            <div className="text-muted">
              Vault Balance: <strong>{parseFloat(token.numericalBalance).toFixed(6)} {token.symbol}</strong>
            </div>
          </div>

          {/* Amount Input */}
          <Form.Group className="mb-4">
            <Form.Label>Withdrawal Amount</Form.Label>
            <InputGroup>
              <Form.Control
                type="number"
                placeholder="0.0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                disabled={isSubmitting}
              />
              <Button
                variant="outline-secondary"
                onClick={handleMaxClick}
                disabled={isSubmitting}
              >
                MAX
              </Button>
            </InputGroup>
          </Form.Group>

          <div className="d-grid gap-2">
            <Button
              variant="primary"
              size="lg"
              onClick={handleWithdraw}
              disabled={isSubmitting || !amount || parseFloat(amount) <= 0 || parseFloat(amount) > parseFloat(token.numericalBalance)}
            >
              {isSubmitting ? (
                <>
                  <Spinner animation="border" size="sm" className="me-2" />
                  Processing...
                </>
              ) : (
                `Withdraw ${token.symbol}`
              )}
            </Button>
          </div>
        </Form>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onHide} disabled={isSubmitting}>
          Cancel
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default TokenWithdrawModal;
