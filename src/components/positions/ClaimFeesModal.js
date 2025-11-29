import React, { useState } from 'react';
import { Modal, Button, Spinner, Alert, Badge } from 'react-bootstrap';
import { useSelector, useDispatch } from 'react-redux';
import { ethers } from 'ethers';

// FUM Library imports
import { AdapterFactory } from 'fum_library/adapters';
import { formatFeeDisplay } from 'fum_library/helpers/formatHelpers';

// Local project imports
import { useToast } from '../../context/ToastContext';
import { useProviders } from '../../hooks/useProviders';
import { triggerUpdate } from '../../redux/updateSlice';

export default function ClaimFeesModal({
  show,
  onHide,
  position,
  uncollectedFees,
  token0Data,
  token1Data,
  tokenPrices,
  poolData
}) {
  const dispatch = useDispatch();
  const { showError, showSuccess } = useToast();
  const { address, chainId } = useSelector(state => state.wallet);
  const { readProvider, getSigner, isReadReady } = useProviders();

  // State for operation status
  const [isClaiming, setIsClaiming] = useState(false);
  const [operationError, setOperationError] = useState(null);

  // Calculate USD values
  const getUsdValue = (amount, tokenSymbol) => {
    if (!amount || amount === "0" || !tokenPrices) return null;

    try {
      const price = tokenSymbol === token0Data?.symbol ? tokenPrices.token0 : tokenPrices.token1;
      if (!price) return null;

      return parseFloat(amount) * price;
    } catch (error) {
      console.error(`Error calculating USD value for ${tokenSymbol}:`, error);
      return null;
    }
  };

  // Calculate total USD value for the fees
  const totalFeeValue = (uncollectedFees?.token0 && uncollectedFees?.token1) ? (
    (getUsdValue(uncollectedFees.token0.formatted, token0Data?.symbol) || 0) +
    (getUsdValue(uncollectedFees.token1.formatted, token1Data?.symbol) || 0)
  ) : null;

  // Check if we have meaningful token amounts
  const hasFees = (uncollectedFees?.token0 && uncollectedFees?.token1) &&
    (parseFloat(uncollectedFees.token0.formatted) > 0 || parseFloat(uncollectedFees.token1.formatted) > 0);

  // Function to claim fees using the adapter
  const claimFees = async () => {
    // Get the appropriate adapter (uses read provider for initialization)
    const adapter = AdapterFactory.getAdapter(position.platform, chainId, readProvider);

    if (!adapter) {
      throw new Error("No adapter available for this position");
    }

    setIsClaiming(true);
    setOperationError(null);

    try {
      // Generate transaction data for claiming fees (uses read provider for data lookup)
      const txData = await adapter.generateClaimFeesData({
        positionId: position.id,
        provider: readProvider,
        walletAddress: address,
        token0Address: token0Data.address,
        token1Address: token1Data.address,
        token0Decimals: token0Data.decimals,
        token1Decimals: token1Data.decimals
      });

      // Get signer to send transaction
      const signer = await getSigner();

      // Send the transaction
      const tx = await signer.sendTransaction(txData);

      // Wait for confirmation
      const receipt = await tx.wait();

      // Show success message
      showSuccess("Successfully claimed fees!", receipt.transactionHash);

      // Close modal and refresh data
      onHide();
      dispatch(triggerUpdate());

      setIsClaiming(false);
    } catch (error) {
      // Always set claiming to false first to prevent state update issues
      setIsClaiming(false);

      // Check if user cancelled the transaction
      if (error.code === 'ACTION_REJECTED' || error.code === 4001 || error.message?.includes('user rejected')) {
        // User cancelled - silently ignore, modal stays open
        return;
      }

      // Real error - log and show user-friendly message
      console.error("Error claiming fees:", error);
      const errorDetail = error.reason || error.message;
      setOperationError(`Transaction failed${errorDetail ? `: ${errorDetail}` : ''}`);
    }
  };

  // Handle the claim fees action
  const handleClaimFees = () => {
    setOperationError(null);

    // Validate inputs
    if (!position) {
      setOperationError("Position data is missing");
      return;
    }

    if (!hasFees) {
      setOperationError("No fees to claim");
      return;
    }

    // Call the function that interacts with the adapter
    claimFees();
  };

  // Handle modal close with safety checks
  const handleModalClose = () => {
    if (isClaiming) {
      showError("Cannot close this window while the transaction is in progress");
      return;
    }
    // Reset state
    setOperationError(null);
    setIsClaiming(false);
    onHide();
  };

  return (
    <Modal
      show={show}
      onHide={handleModalClose}
      centered
      backdrop="static"
      keyboard={false}
      data-no-propagation="true"
    >
      <Modal.Header closeButton>
        <Modal.Title>
          Claim Fees from Position #{position?.id} - {position?.tokenPair}
          <small className="ms-2 text-muted">({position?.fee / 10000}% fee)</small>
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {/* Operation Error Message */}
        {operationError && (
          <Alert variant="danger" className="mb-3">
            {operationError}
          </Alert>
        )}

        {/* Uncollected Fees Section */}
        <div className="mb-4">
          <h6 className="border-bottom pb-2">Uncollected Fees to Claim</h6>
          {!uncollectedFees?.token0 || !uncollectedFees?.token1 ? (
            <Alert variant="warning">
              Fee information is not available
            </Alert>
          ) : !hasFees ? (
            <Alert variant="warning">
              This position has no uncollected fees
            </Alert>
          ) : (
            <>
              <div className="d-flex justify-content-between align-items-center mb-2">
                <div style={{ fontSize: '0.9em' }}>
                  <span style={{ color: 'var(--crimson-700)', fontWeight: 'bold' }}>{token0Data?.symbol}:</span> {formatFeeDisplay(parseFloat(uncollectedFees.token0.formatted))}
                </div>
                {tokenPrices?.token0 > 0 && (
                  <span style={{ fontSize: '0.9em', color: 'var(--neutral-600)' }}>
                    ${getUsdValue(uncollectedFees.token0.formatted, token0Data?.symbol)?.toFixed(2) || '—'}
                  </span>
                )}
              </div>
              <div className="d-flex justify-content-between align-items-center">
                <div style={{ fontSize: '0.9em' }}>
                  <span style={{ color: 'var(--crimson-700)', fontWeight: 'bold' }}>{token1Data?.symbol}:</span> {formatFeeDisplay(parseFloat(uncollectedFees.token1.formatted))}
                </div>
                {tokenPrices?.token1 > 0 && (
                  <span style={{ fontSize: '0.9em', color: 'var(--neutral-600)' }}>
                    ${getUsdValue(uncollectedFees.token1.formatted, token1Data?.symbol)?.toFixed(2) || '—'}
                  </span>
                )}
              </div>
              {totalFeeValue !== null && (
                <div className="text-end mt-2">
                  <small style={{ color: 'var(--neutral-600)' }}>Total: ${totalFeeValue.toFixed(2)}</small>
                </div>
              )}
            </>
          )}
        </div>

        {/* Information about fee claiming */}
        <div className="mb-3">
          <Alert variant="info" className="small">
            <strong>Note:</strong> Claiming fees will collect all earned protocol fees without affecting your liquidity position.
          </Alert>
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={handleModalClose} disabled={isClaiming}>
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={handleClaimFees}
          disabled={isClaiming}
        >
          {isClaiming ? (
            <>
              <Spinner
                as="span"
                animation="border"
                size="sm"
                role="status"
                aria-hidden="true"
                className="me-2"
              />
              Claiming Fees...
            </>
          ) : "Claim Fees"}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
