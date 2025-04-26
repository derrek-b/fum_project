import React, { useState } from 'react';
import { Modal, Button, Spinner, Alert, Badge, Form, InputGroup } from 'react-bootstrap';
import { useSelector, useDispatch } from 'react-redux';

// FUM Library imports
import { AdapterFactory } from 'fum_library/adapters';
import { formatFeeDisplay } from 'fum_library/helpers/formatHelpers';

// Local project imports
import { useToast } from '../../context/ToastContext';
import { triggerUpdate } from '../../redux/updateSlice';

export default function ClosePositionModal({
  show,
  onHide,
  position,
  tokenBalances,
  uncollectedFees,
  token0Data,
  token1Data,
  tokenPrices,
  errorMessage,
  poolData
}) {
  const dispatch = useDispatch();
  const { showError, showSuccess } = useToast();
  const { address, chainId, provider } = useSelector(state => state.wallet);

  // State for burn option
  const [shouldBurn, setShouldBurn] = useState(true); // Default to true - burning is recommended

  // Add state for slippage tolerance with default of 0.5%
  const [slippageTolerance, setSlippageTolerance] = useState(0.5);

  // State for operation status
  const [isClosing, setIsClosing] = useState(false);
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

  // Function to close position using the adapter
  const closePosition = async (shouldBurn, slippageTolerance) => {
    // Get the appropriate adapter
    const adapter = AdapterFactory.getAdapter(position.platform, provider);

    if (!adapter) {
      throw new Error("No adapter available for this position");
    }

    setIsClosing(true);
    setOperationError(null);

    try {
      await adapter.closePosition({
        position,
        provider,
        address,
        chainId,
        poolData, // Will be fetched by the adapter if needed
        token0Data,
        token1Data,
        collectFees: true, // Always collect fees when closing a position
        burnPosition: shouldBurn, // Whether to burn the position NFT
        slippageTolerance, // Add slippage tolerance parameter
        dispatch,
        onStart: () => setIsClosing(true),
        onFinish: () => setIsClosing(false),
        onSuccess: (result) => {
          // Show success toast with transaction hash if available
          const txHash = result?.burnReceipt?.hash || result?.liquidityResult?.decreaseReceipt?.hash;
          showSuccess("Successfully closed position!", txHash);
          onHide();
          dispatch(triggerUpdate()); // Refresh data
        },
        onError: (errorMessage) => {
          setOperationError(errorMessage);
          showError(errorMessage);
          setIsClosing(false);
        }
      });
    } catch (error) {
      console.error("Error closing position:", error);
      setOperationError(error.message);
      showError(error.message);
      setIsClosing(false);
    }
  };

  // Handle the close position action
  const handleClosePosition = () => {
    try {
      if (!position) {
        throw new Error("Position data is missing");
      }

      // Validate slippage tolerance
      if (slippageTolerance < 0.1 || slippageTolerance > 5) {
        throw new Error("Slippage tolerance must be between 0.1% and 5%");
      }

      // Call the function that interacts with the adapter
      closePosition(shouldBurn, slippageTolerance);
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
    // Reset state
    setOperationError(null);
    setIsClosing(false);
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

        {/* Add slippage tolerance input */}
        <div className="border-top pt-3 mt-3 mb-3">
          <h6 className="mb-2">Slippage Tolerance</h6>
          <Form.Group>
            <InputGroup size="sm">
              <Form.Control
                type="number"
                placeholder="Enter slippage tolerance"
                value={slippageTolerance}
                onChange={(e) => setSlippageTolerance(parseFloat(e.target.value) || 0.5)}
                min="0.1"
                max="5"
                step="0.1"
                required
                disabled={isClosing}
              />
              <InputGroup.Text>%</InputGroup.Text>
            </InputGroup>
            <Form.Text className="text-muted small">
              Maximum allowed price change during transaction (0.1% to 5%)
            </Form.Text>
          </Form.Group>
        </div>

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

        {/* Operation Error Message */}
        {operationError && (
          <Alert variant="danger" className="mt-3 mb-0">
            {operationError}
          </Alert>
        )}

        {/* Legacy Error Message - for backward compatibility */}
        {errorMessage && !operationError && (
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
