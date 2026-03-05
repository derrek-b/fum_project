// src/components/vaults/FundExecutorModal.js
import React, { useState, useEffect } from "react";
import { Modal, Button, Form, InputGroup, Spinner, Alert } from "react-bootstrap";
import { useSelector } from "react-redux";
import { ethers } from "ethers";
import { getMaxExecutorBalance } from 'fum_library/helpers/chainHelpers';
import { getNativeSymbol } from 'fum_library/helpers/tokenHelpers';
import { getVaultContract } from 'fum_library/blockchain/contracts';
import { useToast } from "../../context/ToastContext";
import { useProviders } from "../../hooks/useProviders";
import { Fuel } from 'lucide-react';

// CSS styles for the modal
const modalStyles = `
  /* Hide number input spinner arrows - Chrome, Safari, Edge, Opera */
  input.no-number-spinner::-webkit-outer-spin-button,
  input.no-number-spinner::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }

  /* Firefox */
  input.no-number-spinner[type=number] {
    -moz-appearance: textfield;
  }
`;

const FundExecutorModal = ({ show, onHide, vaultAddress, executorAddress, chainId, onSuccess }) => {
  const { address: userAddress } = useSelector((state) => state.wallet);
  const { readProvider, getSigner, isReadReady, isWriteReady } = useProviders();
  const { showSuccess, showError } = useToast();

  const [amount, setAmount] = useState("");
  const [executorBalance, setExecutorBalance] = useState(null);
  const [walletBalance, setWalletBalance] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  const nativeSymbol = chainId ? getNativeSymbol(chainId) : 'ETH';
  const maxBalance = chainId ? getMaxExecutorBalance(chainId) : 0;

  // Fetch balances when modal opens
  useEffect(() => {
    const fetchBalances = async () => {
      if (!show || !isReadReady || !executorAddress || !userAddress) return;

      setIsLoading(true);
      try {
        const [execBal, walletBal] = await Promise.all([
          readProvider.getBalance(executorAddress),
          readProvider.getBalance(userAddress)
        ]);
        const execFormatted = parseFloat(ethers.utils.formatEther(execBal));
        const walletFormatted = ethers.utils.formatEther(walletBal);

        setExecutorBalance(execFormatted);
        setWalletBalance(walletFormatted);

        // Pre-fill recommended amount
        const recommended = Math.max(0, maxBalance - execFormatted);
        if (recommended > 0) {
          setAmount(recommended.toFixed(6));
        }
      } catch (err) {
        console.error("Error fetching balances:", err);
        setError("Failed to fetch balances");
      } finally {
        setIsLoading(false);
      }
    };

    fetchBalances();
  }, [show, isReadReady, executorAddress, userAddress, readProvider, maxBalance]);

  // Reset state when modal closes
  useEffect(() => {
    if (!show) {
      setAmount("");
      setExecutorBalance(null);
      setWalletBalance(null);
      setError("");
      setIsLoading(false);
      setIsSubmitting(false);
    }
  }, [show]);

  const handleFund = async () => {
    if (!amount || !isWriteReady) return;

    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      setError("Amount must be greater than 0");
      return;
    }

    if (walletBalance && numAmount > parseFloat(walletBalance)) {
      setError("Amount exceeds your wallet balance");
      return;
    }

    setIsSubmitting(true);
    setError("");

    try {
      const signer = await getSigner();
      const vaultContract = getVaultContract(vaultAddress, signer);
      const amountWei = ethers.utils.parseEther(amount);

      const tx = await vaultContract.fundExecutor(amountWei, { value: amountWei });
      await tx.wait();

      showSuccess(`Successfully funded executor with ${amount} ${nativeSymbol}`);
      setIsSubmitting(false);
      if (onSuccess) onSuccess();
      onHide();
    } catch (err) {
      setIsSubmitting(false);

      // Silently ignore user rejection
      if (err.code === 'ACTION_REJECTED' || err.code === 4001 || err.message?.includes('user rejected')) {
        return;
      }

      console.error("Fund executor error:", err);
      const errorDetail = err.reason || err.message;
      setError(`Transaction failed${errorDetail ? `: ${errorDetail}` : ''}`);
    }
  };

  return (
    <Modal
      show={show}
      onHide={onHide}
      centered
      backdrop="static"
    >
      <style>{modalStyles}</style>
      <Modal.Header closeButton>
        <Modal.Title className="d-flex align-items-center">
          <Fuel size={20} className="me-2" />
          Fund Executor
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {error && <Alert variant="danger">{error}</Alert>}

        {isLoading ? (
          <div className="text-center py-4">
            <Spinner animation="border" />
            <p className="mt-2 text-muted">Loading balances...</p>
          </div>
        ) : (
          <>
            {/* Executor balance info */}
            <div className="mb-4 p-3" style={{ backgroundColor: '#f8f9fa', borderRadius: '8px' }}>
              <div className="d-flex justify-content-between mb-2">
                <span className="text-muted">Current Executor Balance</span>
                <strong>{executorBalance !== null ? `${executorBalance.toFixed(6)} ${nativeSymbol}` : '—'}</strong>
              </div>
              <div className="d-flex justify-content-between">
                <span className="text-muted">Target Balance</span>
                <strong>{maxBalance} {nativeSymbol}</strong>
              </div>
            </div>

            {/* Amount input */}
            <Form.Group className="mb-3">
              <div className="d-flex justify-content-between">
                <Form.Label>Amount to Send</Form.Label>
                <div className="text-muted" style={{ fontSize: '0.875rem' }}>
                  Wallet: {walletBalance ? `${parseFloat(walletBalance).toFixed(6)} ${nativeSymbol}` : '—'}
                </div>
              </div>
              <InputGroup>
                <Form.Control
                  type="number"
                  placeholder="0.0"
                  value={amount}
                  onChange={(e) => {
                    setAmount(e.target.value);
                    setError("");
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'e' || e.key === 'E' || e.key === '+' || e.key === '-') {
                      e.preventDefault();
                    }
                  }}
                  onWheel={(e) => e.target.blur()}
                  step="any"
                  disabled={isSubmitting}
                  className="no-number-spinner"
                />
                <Button
                  variant="outline-secondary"
                  onClick={() => {
                    if (executorBalance !== null) {
                      const recommended = Math.max(0, maxBalance - executorBalance);
                      setAmount(recommended.toFixed(6));
                    }
                  }}
                  disabled={isSubmitting}
                >
                  RECOMMENDED
                </Button>
              </InputGroup>
            </Form.Group>

            {/* Warning if wallet balance is low */}
            {walletBalance && amount && parseFloat(amount) > parseFloat(walletBalance) && (
              <Alert variant="warning" className="mb-3">
                Amount exceeds your wallet balance of {parseFloat(walletBalance).toFixed(6)} {nativeSymbol}
              </Alert>
            )}

            <div className="d-grid">
              <Button
                variant="primary"
                size="lg"
                onClick={handleFund}
                disabled={isSubmitting || !amount || parseFloat(amount) <= 0}
              >
                {isSubmitting ? (
                  <>
                    <Spinner animation="border" size="sm" className="me-2" />
                    Processing...
                  </>
                ) : (
                  `Send ${amount || '0'} ${nativeSymbol} to Executor`
                )}
              </Button>
            </div>
          </>
        )}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onHide} disabled={isSubmitting}>
          Cancel
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default FundExecutorModal;
