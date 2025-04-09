import React, { useState } from 'react';
import { Modal, Button, Spinner, Alert, Badge } from 'react-bootstrap';
import { useSelector, useDispatch } from 'react-redux';
import { formatFeeDisplay } from '../../utils/formatHelpers';
import { useToast } from '../../context/ToastContext';
import { AdapterFactory } from '../../adapters';
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
  const { address, chainId, provider } = useSelector(state => state.wallet);

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
  const totalFeeValue = uncollectedFees ? (
    (getUsdValue(uncollectedFees.token0.formatted, token0Data?.symbol) || 0) +
    (getUsdValue(uncollectedFees.token1.formatted, token1Data?.symbol) || 0)
  ) : null;

  // Check if we have meaningful token amounts
  const hasFees = uncollectedFees &&
    (parseFloat(uncollectedFees.token0.formatted) > 0 || parseFloat(uncollectedFees.token1.formatted) > 0);

  // Function to claim fees using the adapter
  const claimFees = async () => {
    // Get the appropriate adapter
    const adapter = AdapterFactory.getAdapter(position.platform, provider);

    if (!adapter) {
      throw new Error("No adapter available for this position");
    }

    setIsClaiming(true);
    setOperationError(null);

    try {
      await adapter.claimFees({
        position,
        provider,
        address,
        chainId,
        poolData, // Will be fetched by the adapter if needed
        token0Data,
        token1Data,
        dispatch,
        onStart: () => setIsClaiming(true),
        onFinish: () => setIsClaiming(false),
        onSuccess: (result) => {
          // Show success toast with transaction hash if available
          const txHash = result?.tx?.hash;
          showSuccess("Successfully claimed fees!", txHash);
          onHide();
          dispatch(triggerUpdate()); // Refresh data
        },
        onError: (errorMessage) => {
          setOperationError(errorMessage);
          showError(errorMessage);
          setIsClaiming(false);
        }
      });
    } catch (error) {
      console.error("Error claiming fees:", error);
      setOperationError(error.message);
      showError(error.message);
      setIsClaiming(false);
    }
  };

  // Handle the claim fees action
  const handleClaimFees = () => {
    try {
      if (!position) {
        throw new Error("Position data is missing");
      }

      if (!hasFees) {
        throw new Error("No fees to claim");
      }

      // Call the function that interacts with the adapter
      claimFees();
    } catch (error) {
      console.error("Error initiating fee claim:", error);
      showError(`Failed to claim fees: ${error.message}`);
    }
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
        {/* Uncollected Fees Section */}
        <div className="mb-4">
          <h6 className="border-bottom pb-2">Uncollected Fees to Claim</h6>
          {!uncollectedFees ? (
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
                <Badge bg="light" text="dark" className="px-3 py-2">
                  {formatFeeDisplay(uncollectedFees.token0.formatted)} {token0Data?.symbol}
                </Badge>
                {tokenPrices?.token0 > 0 && (
                  <span className="text-muted">
                    ≈ ${getUsdValue(uncollectedFees.token0.formatted, token0Data?.symbol)?.toFixed(2) || '—'}
                  </span>
                )}
              </div>
              <div className="d-flex justify-content-between align-items-center">
                <Badge bg="light" text="dark" className="px-3 py-2">
                  {formatFeeDisplay(uncollectedFees.token1.formatted)} {token1Data?.symbol}
                </Badge>
                {tokenPrices?.token1 > 0 && (
                  <span className="text-muted">
                    ≈ ${getUsdValue(uncollectedFees.token1.formatted, token1Data?.symbol)?.toFixed(2) || '—'}
                  </span>
                )}
              </div>
              {totalFeeValue && (
                <div className="text-end mt-2">
                  <small className="text-muted">Total Value: ${totalFeeValue.toFixed(2)}</small>
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

        {/* Operation Error Message */}
        {operationError && (
          <Alert variant="danger" className="mt-3 mb-0">
            {operationError}
          </Alert>
        )}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={handleModalClose} disabled={isClaiming}>
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={handleClaimFees}
          disabled={isClaiming || !hasFees}
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
