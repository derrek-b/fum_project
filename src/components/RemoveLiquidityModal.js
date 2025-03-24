import React, { useState, useEffect } from 'react';
import { Modal, Button, Spinner, Alert, Badge, Form, Row, Col, InputGroup } from 'react-bootstrap';
import { useToast } from '../context/ToastContext';

export default function RemoveLiquidityModal({
  show,
  onHide,
  position,
  tokenBalances,
  token0Data,
  token1Data,
  tokenPrices,
  isRemoving,
  onRemoveLiquidity,
  errorMessage
}) {
  const { showError } = useToast();
  // State for the percentage slider
  const [percentage, setPercentage] = useState(100);
  const [slippageTolerance, setSlippageTolerance] = useState(0.5);
  const [estimatedBalances, setEstimatedBalances] = useState(null);

  // Calculate estimated token amounts based on percentage
  useEffect(() => {
    if (tokenBalances) {
      try {
        setEstimatedBalances({
          token0: {
            raw: tokenBalances.token0.raw * BigInt(percentage) / BigInt(100),
            formatted: (parseFloat(tokenBalances.token0.formatted) * percentage / 100).toFixed(6)
          },
          token1: {
            raw: tokenBalances.token1.raw * BigInt(percentage) / BigInt(100),
            formatted: (parseFloat(tokenBalances.token1.formatted) * percentage / 100).toFixed(6)
          }
        });
      } catch (error) {
        console.error("Error calculating estimated balances:", error);
        setEstimatedBalances(null);
      }
    }
  }, [percentage, tokenBalances]);

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

  // Calculate total USD value
  const totalUsdValue = estimatedBalances ?
    (getUsdValue(estimatedBalances.token0.formatted, token0Data?.symbol) || 0) +
    (getUsdValue(estimatedBalances.token1.formatted, token1Data?.symbol) || 0) :
    null;

  // Handle slider change
  const handleSliderChange = (e) => {
    try {
      const newPercentage = parseInt(e.target.value, 10);
      setPercentage(newPercentage);
    } catch (error) {
      console.error("Error updating percentage:", error);
      showError("Invalid percentage value");
    }
  };

  // Handle remove liquidity
  const handleRemove = () => {
    try {
      if (!position) {
        throw new Error("Position data is missing");
      }

      if (percentage <= 0 || percentage > 100) {
        throw new Error("Invalid percentage value (must be between 1-100%)");
      }

      if (slippageTolerance < 0.1 || slippageTolerance > 5) {
        throw new Error("Slippage tolerance must be between 0.1% and 5%");
      }

      onRemoveLiquidity(percentage, slippageTolerance);
    } catch (error) {
      console.error("Error initiating liquidity removal:", error);
      showError(`Failed to remove liquidity: ${error.message}`);
    }
  };

  // Handle modal close with safety checks
  const handleModalClose = () => {
    if (isRemoving) {
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
          Remove Liquidity from Position #{position?.id} - {position?.tokenPair}
          <small className="ms-2 text-muted">({position?.fee / 10000}% fee)</small>
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {/* Current Position Information */}
        <div className="mb-4">
          <h6 className="border-bottom pb-2">Current Position</h6>
          {!tokenBalances ? (
            <Alert variant="warning">
              Token balance information is not available
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
              <div className="d-flex justify-content-between align-items-center mb-3">
                <Badge bg="light" text="dark" className="px-3 py-2">
                  {tokenBalances.token1.formatted} {token1Data?.symbol}
                </Badge>
                {tokenPrices?.token1 > 0 && (
                  <span className="text-muted">
                    ≈ ${getUsdValue(tokenBalances.token1.formatted, token1Data?.symbol)?.toFixed(2) || '—'}
                  </span>
                )}
              </div>
            </>
          )}
        </div>

        {/* Percentage Slider */}
        <div className="mb-4">
          <h6 className="border-bottom pb-2">Amount to Remove</h6>
          <Form.Group className="mb-3">
            <Row className="align-items-center">
              <Col>
                <Form.Range
                  min={1}
                  max={100}
                  step={1}
                  value={percentage}
                  onChange={handleSliderChange}
                  disabled={isRemoving}
                />
              </Col>
              <Col xs="auto">
                <Badge bg="primary">{percentage}%</Badge>
              </Col>
            </Row>
          </Form.Group>
        </div>

        {/* Add slippage tolerance input after the percentage slider */}
        <div className="mb-4">
          <h6 className="border-bottom pb-2">Slippage Tolerance</h6>
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
                disabled={isRemoving}
              />
              <InputGroup.Text>%</InputGroup.Text>
            </InputGroup>
            <Form.Text className="text-muted small">
              Maximum allowed price change during transaction (0.1% to 5%)
            </Form.Text>
          </Form.Group>
        </div>

        {/* Estimated Amounts to Receive */}
        <div className="mb-3">
          <h6 className="border-bottom pb-2">You Will Receive</h6>
          {!estimatedBalances ? (
            <Alert variant="warning">
              Cannot estimate token amounts
            </Alert>
          ) : (
            <>
              <div className="d-flex justify-content-between align-items-center mb-2">
                <Badge bg="light" text="dark" className="px-3 py-2">
                  {estimatedBalances.token0.formatted} {token0Data?.symbol}
                </Badge>
                {tokenPrices?.token0 > 0 && (
                  <span className="text-muted">
                    ≈ ${getUsdValue(estimatedBalances.token0.formatted, token0Data?.symbol)?.toFixed(2) || '—'}
                  </span>
                )}
              </div>
              <div className="d-flex justify-content-between align-items-center">
                <Badge bg="light" text="dark" className="px-3 py-2">
                  {estimatedBalances.token1.formatted} {token1Data?.symbol}
                </Badge>
                {tokenPrices?.token1 > 0 && (
                  <span className="text-muted">
                    ≈ ${getUsdValue(estimatedBalances.token1.formatted, token1Data?.symbol)?.toFixed(2) || '—'}
                  </span>
                )}
              </div>
              {totalUsdValue !== null && (
                <div className="text-end mt-2">
                  <small className="text-muted">Total: ${totalUsdValue.toFixed(2)}</small>
                </div>
              )}
            </>
          )}
        </div>

        {/* Info about fees */}
        <Alert variant="info" className="small">
          <strong>Note:</strong> Removing liquidity will also collect any unclaimed fees
          for this position.
        </Alert>

        {/* Error Message */}
        {errorMessage && (
          <Alert variant="danger" className="mt-3 mb-0">
            {errorMessage}
          </Alert>
        )}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={handleModalClose} disabled={isRemoving}>
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={handleRemove}
          disabled={isRemoving}
        >
          {isRemoving ? (
            <>
              <Spinner
                as="span"
                animation="border"
                size="sm"
                role="status"
                aria-hidden="true"
                className="me-2"
              />
              Removing...
            </>
          ) : `Remove ${percentage}% Liquidity`}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
