import React, { useState } from 'react';
import { Modal, Button, Spinner, Alert, Badge, Form } from 'react-bootstrap';
import { formatFeeDisplay } from '../utils/formatHelpers';
import { useToast } from '../context/ToastContext';

export default function ClosePositionModal({
  show,
  onHide,
  position,
  tokenBalances,
  uncollectedFees,
  token0Data,
  token1Data,
  tokenPrices,
  isClosing,
  onClosePosition,
  errorMessage
}) {
  const { showError } = useToast();

  // State for burn option
  const [shouldBurn, setShouldBurn] = useState(true); // Default to true - burning is recommended

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

  // Calculate total USD value for tokens
  const calculateTotalUsdValue = (token0Amount, token1Amount) => {
    if (!token0Data || !token1Data || !tokenPrices) return null;

    try {
      const token0UsdValue = getUsdValue(token0Amount, token0Data.symbol) || 0;
      const token1UsdValue = getUsdValue(token1Amount, token1Data.symbol) || 0;

      return token0UsdValue + token1UsdValue;
    } catch (error) {
      console.error("Error calculating total USD value:", error);
      return null;
    }
  };

  // Total balance value
  const totalBalanceUsd = tokenBalances ?
    calculateTotalUsdValue(tokenBalances.token0.formatted, tokenBalances.token1.formatted) : null;

  // Total fees value
  const totalFeesUsd = uncollectedFees ?
    calculateTotalUsdValue(uncollectedFees.token0.formatted, uncollectedFees.token1.formatted) : null;

  // Grand total (balances + fees)
  const grandTotalUsd = (totalBalanceUsd || 0) + (totalFeesUsd || 0);

  // Check if we have meaningful token amounts
  const hasBalances = tokenBalances &&
    (parseFloat(tokenBalances.token0.formatted) > 0 || parseFloat(tokenBalances.token1.formatted) > 0);

  const hasFees = uncollectedFees &&
    (parseFloat(uncollectedFees.token0.formatted) > 0 || parseFloat(uncollectedFees.token1.formatted) > 0);

  // Handle the close position action
  const handleClosePosition = () => {
    try {
      if (!position) {
        throw new Error("Position data is missing");
      }

      onClosePosition(shouldBurn);
    } catch (error) {
      console.error("Error initiating position close:", error);
      showError(`Failed to close position: ${error.message}`);
    }
  };

  // Handle modal close with safety checks
  const handleModalClose = () => {
    if (isClosing) {
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
      keyboard={false} // Prevent Escape key from closing
      data-no-propagation="true" // Custom attribute for clarity
    >
      <Modal.Header closeButton>
        <Modal.Title>
          Close Position #{position?.id} - {position?.tokenPair}
          <small className="ms-2 text-muted">({position?.fee / 10000}% fee)</small>
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {/* Token Balances Section */}
        <div className="mb-4">
          <h6 className="border-bottom pb-2">Token Balances to Withdraw</h6>
          {!tokenBalances ? (
            <Alert variant="warning">
              Token balance information is not available
            </Alert>
          ) : !hasBalances ? (
            <Alert variant="warning">
              This position has no token balances to withdraw
            </Alert>
          ) : (
            <>
              <div className="d-flex justify-content-between align-items-center mb-2">
                <Badge bg="light" text="dark" className="px-3 py-2">
                  {tokenBalances.token0.formatted} {token0Data?.symbol}
                </Badge>
                {tokenPrices?.token0 > 0 && (
                  <span className="text-muted">
                    ≈ ${getUsdValue(tokenBalances.token0.formatted, token0Data?.symbol)?.toFixed(2) || '—'}
                  </span>
                )}
              </div>
              <div className="d-flex justify-content-between align-items-center">
                <Badge bg="light" text="dark" className="px-3 py-2">
                  {tokenBalances.token1.formatted} {token1Data?.symbol}
                </Badge>
                {tokenPrices?.token1 > 0 && (
                  <span className="text-muted">
                    ≈ ${getUsdValue(tokenBalances.token1.formatted, token1Data?.symbol)?.toFixed(2) || '—'}
                  </span>
                )}
              </div>
              {totalBalanceUsd && (
                <div className="text-end mt-2">
                  <small className="text-muted">Total: ${totalBalanceUsd.toFixed(2)}</small>
                </div>
              )}
            </>
          )}
        </div>

        {/* Uncollected Fees Section */}
        <div className="mb-3">
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
              {totalFeesUsd && (
                <div className="text-end mt-2">
                  <small className="text-muted">Total: ${totalFeesUsd.toFixed(2)}</small>
                </div>
              )}
            </>
          )}
        </div>

        {/* Grand Total Section */}
        {grandTotalUsd > 0 && (
          <div className="border-top pt-3 mt-3">
            <div className="d-flex justify-content-between">
              <h6 className="mb-0">Total Value to Receive:</h6>
              <h6 className="mb-0">${grandTotalUsd.toFixed(2)}</h6>
            </div>
          </div>
        )}

        {/* Burn Option */}
        <div className="border-top pt-3 mt-3">
          <Form.Check
            type="checkbox"
            id="burn-position-checkbox"
            label="Burn position NFT (recommended)"
            checked={shouldBurn}
            onChange={(e) => setShouldBurn(e.target.checked)}
            disabled={isClosing}
          />
          <Form.Text className="text-muted">
            Burning the position NFT frees up storage on the blockchain and may result in a gas refund.
            If unchecked, the empty position will remain in your wallet.
          </Form.Text>
        </div>

        {/* Error Message */}
        {errorMessage && (
          <Alert variant="danger" className="mt-3 mb-0">
            {errorMessage}
          </Alert>
        )}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={handleModalClose} disabled={isClosing}>
          Cancel
        </Button>
        <Button
          variant="danger"
          onClick={handleClosePosition}
          disabled={isClosing}
        >
          {isClosing ? (
            <>
              <Spinner
                as="span"
                animation="border"
                size="sm"
                role="status"
                aria-hidden="true"
                className="me-2"
              />
              Closing...
            </>
          ) : "Close Position"}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
