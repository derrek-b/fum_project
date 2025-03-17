import React, { useState, useEffect } from 'react';
import { Modal, Button, Spinner, Alert, Badge, Form, Row, Col } from 'react-bootstrap';

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
  // State for the percentage slider
  const [percentage, setPercentage] = useState(100);
  const [estimatedBalances, setEstimatedBalances] = useState(null);

  // Calculate estimated token amounts based on percentage
  useEffect(() => {
    if (tokenBalances) {
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
    }
  }, [percentage, tokenBalances]);

  // Calculate USD values
  const getUsdValue = (amount, tokenSymbol) => {
    if (!amount || amount === "0" || !tokenPrices) return null;

    const price = tokenSymbol === token0Data?.symbol ? tokenPrices.token0 : tokenPrices.token1;
    if (!price) return null;

    return parseFloat(amount) * price;
  };

  // Calculate total USD value
  const totalUsdValue = estimatedBalances ?
    (getUsdValue(estimatedBalances.token0.formatted, token0Data?.symbol) || 0) +
    (getUsdValue(estimatedBalances.token1.formatted, token1Data?.symbol) || 0) :
    null;

  // Handle slider change
  const handleSliderChange = (e) => {
    setPercentage(parseInt(e.target.value, 10));
  };

  // Handle remove liquidity
  const handleRemove = () => {
    onRemoveLiquidity(percentage);
  };

  return (
    <Modal
      show={show}
      onHide={onHide}
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
        <Button variant="secondary" onClick={onHide} disabled={isRemoving}>
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
