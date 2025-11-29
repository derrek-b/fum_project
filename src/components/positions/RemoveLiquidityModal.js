import React, { useState, useEffect } from 'react';
import { Modal, Button, Spinner, Alert, Badge, Form, Row, Col, InputGroup } from 'react-bootstrap';
import { useSelector, useDispatch } from 'react-redux';

// FUM Library imports
import { AdapterFactory } from 'fum_library/adapters';
import { formatFeeDisplay } from 'fum_library/helpers/formatHelpers';

// Local project imports
import { useToast } from '../../context/ToastContext';
import { useProviders } from '../../hooks/useProviders';
import { triggerUpdate } from '../../redux/updateSlice';

// CSS for custom slider styling and hiding number input spinners
const sliderStyles = `
  input[type="range"].crimson-slider::-webkit-slider-thumb {
    background: var(--crimson-700);
  }

  input[type="range"].crimson-slider::-moz-range-thumb {
    background: var(--crimson-700);
  }

  input[type="range"].crimson-slider::-webkit-slider-runnable-track {
    background: linear-gradient(to right, var(--crimson-700) 0%, var(--crimson-700) var(--value), #dee2e6 var(--value), #dee2e6 100%);
  }

  input[type="range"].crimson-slider::-moz-range-track {
    background: #dee2e6;
  }

  input[type="range"].crimson-slider::-moz-range-progress {
    background: var(--crimson-700);
  }

  /* Chrome, Safari, Edge, Opera */
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

export default function RemoveLiquidityModal({
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
  const { address, chainId } = useSelector(state => state.wallet);
  const { readProvider, getSigner } = useProviders();

  // State for the percentage slider
  const [percentage, setPercentage] = useState(100);
  const [slippageTolerance, setSlippageTolerance] = useState(0.5);
  const [estimatedBalances, setEstimatedBalances] = useState(null);

  // State for operation status
  const [isRemoving, setIsRemoving] = useState(false);
  const [operationError, setOperationError] = useState(null);

  // Calculate estimated token amounts based on percentage
  useEffect(() => {
    if (tokenBalances?.token0 && tokenBalances?.token1) {
      try {
        setEstimatedBalances({
          token0: {
            raw: BigInt(tokenBalances.token0.raw) * BigInt(percentage) / BigInt(100),
            formatted: (parseFloat(tokenBalances.token0.formatted) * percentage / 100).toFixed(6)
          },
          token1: {
            raw: BigInt(tokenBalances.token1.raw) * BigInt(percentage) / BigInt(100),
            formatted: (parseFloat(tokenBalances.token1.formatted) * percentage / 100).toFixed(6)
          }
        });
      } catch (error) {
        console.error("Error calculating estimated balances:", error);
        setEstimatedBalances(null);
      }
    } else {
      setEstimatedBalances(null);
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

  // Calculate total USD value for current position
  const currentTotalUsdValue = tokenBalances ?
    (getUsdValue(tokenBalances.token0.formatted, token0Data?.symbol) || 0) +
    (getUsdValue(tokenBalances.token1.formatted, token1Data?.symbol) || 0) :
    null;

  // Calculate total USD value for estimated amount to receive
  const totalUsdValue = estimatedBalances ?
    (getUsdValue(estimatedBalances.token0.formatted, token0Data?.symbol) || 0) +
    (getUsdValue(estimatedBalances.token1.formatted, token1Data?.symbol) || 0) :
    null;

  // Calculate total USD value for uncollected fees
  const totalFeesUsd = (uncollectedFees?.token0 && uncollectedFees?.token1) ?
    (getUsdValue(uncollectedFees.token0.formatted, token0Data?.symbol) || 0) +
    (getUsdValue(uncollectedFees.token1.formatted, token1Data?.symbol) || 0) :
    null;

  // Calculate grand total (estimated liquidity + all fees)
  const grandTotalUsd = (totalUsdValue || 0) + (totalFeesUsd || 0);

  // Check if we have meaningful fee amounts
  const hasFees = (uncollectedFees?.token0 && uncollectedFees?.token1) &&
    (parseFloat(uncollectedFees.token0.formatted) > 0 || parseFloat(uncollectedFees.token1.formatted) > 0);

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

  // Function to remove liquidity using the adapter
  const removeLiquidity = async (percentage, slippageTolerance) => {
    // Get the appropriate adapter (uses read provider)
    const adapter = AdapterFactory.getAdapter(position.platform, chainId, readProvider);

    if (!adapter) {
      throw new Error("No adapter available for this position");
    }

    setIsRemoving(true);
    setOperationError(null);

    try {
      // Generate transaction data for removing liquidity
      const txData = await adapter.generateRemoveLiquidityData({
        position,
        percentage,
        provider: readProvider,
        walletAddress: address,
        poolData,
        token0Data,
        token1Data,
        slippageTolerance,
        deadlineMinutes: 20
      });

      // Get signer to send transaction
      const signer = await getSigner();

      // Send the transaction
      const tx = await signer.sendTransaction(txData);

      // Wait for confirmation
      const receipt = await tx.wait();

      // Show success message
      showSuccess(`Successfully removed ${percentage}% of liquidity!`, receipt.transactionHash);

      // Close modal and refresh data
      onHide();
      dispatch(triggerUpdate());

      setIsRemoving(false);
    } catch (error) {
      // Always set removing to false first to prevent state update issues
      setIsRemoving(false);

      // Check if user cancelled the transaction
      if (error.code === 'ACTION_REJECTED' || error.code === 4001 || error.message?.includes('user rejected')) {
        // User cancelled - silently ignore, modal stays open
        return;
      }

      // Real error - log and show user-friendly message
      console.error("Error removing liquidity:", error);
      const errorDetail = error.reason || error.message;
      setOperationError(`Transaction failed${errorDetail ? `: ${errorDetail}` : ''}`);
    }
  };

  // Handle remove liquidity
  const handleRemove = () => {
    setOperationError(null);

    // Validate inputs
    if (!position) {
      setOperationError("Position data is missing");
      return;
    }

    if (percentage <= 0 || percentage > 100) {
      setOperationError("Invalid percentage value (must be between 1-100%)");
      return;
    }

    const slippageNum = parseFloat(slippageTolerance);
    if (isNaN(slippageNum) || slippageNum < 0.1 || slippageNum > 5) {
      setOperationError("Slippage tolerance must be between 0.1% and 5%");
      return;
    }

    removeLiquidity(percentage, slippageNum);
  };

  // Handle modal close with safety checks
  const handleModalClose = () => {
    if (isRemoving) {
      showError("Cannot close this window while the transaction is in progress");
      return;
    }
    // Reset state
    setOperationError(null);
    setIsRemoving(false);
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
      <style>{sliderStyles}</style>
      <Modal.Header closeButton>
        <Modal.Title>
          Remove Liquidity from Position #{position?.id} - {position?.tokenPair}
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

        {/* Current Position Information */}
        <div className="mb-4">
          <h6 className="border-bottom pb-2">Current Position</h6>
          {!tokenBalances?.token0 || !tokenBalances?.token1 ? (
            <Alert variant="warning">
              Token balance information is not available
            </Alert>
          ) : (
            <>
              <div className="d-flex justify-content-between align-items-center mb-2">
                <div style={{ fontSize: '0.9em' }}>
                  <span style={{ color: 'var(--crimson-700)', fontWeight: 'bold' }}>{token0Data?.symbol}:</span> {tokenBalances.token0.formatted}
                </div>
                {tokenPrices?.token0 > 0 && (
                  <span style={{ fontSize: '0.9em', color: 'var(--neutral-600)' }}>
                    ${getUsdValue(tokenBalances.token0.formatted, token0Data?.symbol)?.toFixed(2) || '—'}
                  </span>
                )}
              </div>
              <div className="d-flex justify-content-between align-items-center">
                <div style={{ fontSize: '0.9em' }}>
                  <span style={{ color: 'var(--crimson-700)', fontWeight: 'bold' }}>{token1Data?.symbol}:</span> {tokenBalances.token1.formatted}
                </div>
                {tokenPrices?.token1 > 0 && (
                  <span style={{ fontSize: '0.9em', color: 'var(--neutral-600)' }}>
                    ${getUsdValue(tokenBalances.token1.formatted, token1Data?.symbol)?.toFixed(2) || '—'}
                  </span>
                )}
              </div>
              {currentTotalUsdValue !== null && (
                <div className="text-end mt-2">
                  <small style={{ color: 'var(--neutral-600)' }}>Total: ${currentTotalUsdValue.toFixed(2)}</small>
                </div>
              )}
            </>
          )}
        </div>

        {/* Percentage Slider */}
        <div className="mb-5">
          <h6 className="border-bottom pb-2">Amount to Remove</h6>
          <Form.Group className="mb-3">
            <Row className="align-items-center">
              <Col className="d-flex align-items-center">
                <Form.Range
                  min={1}
                  max={100}
                  step={1}
                  value={percentage}
                  onChange={handleSliderChange}
                  disabled={isRemoving}
                  className="crimson-slider"
                  style={{ '--value': `${percentage}%` }}
                />
              </Col>
              <Col xs="auto" className="d-flex align-items-center">
                <Badge className="bg-crimson" style={{ backgroundColor: 'var(--crimson-700) !important', color: 'white' }}>{percentage}%</Badge>
              </Col>
            </Row>
          </Form.Group>

          {/* Warning when removing 100% */}
          {percentage === 100 && (
            <Alert variant="warning" className="small mt-3 mb-0">
              <strong>Tip:</strong> Removing 100% of liquidity will leave an empty position NFT that won't earn future fees.
              Use <strong>Close Position</strong> to burn the NFT and maybe receive a gas refund.
            </Alert>
          )}
        </div>

        {/* Add slippage tolerance input after the percentage slider */}
        <div className="mb-5">
          <h6 className="border-bottom pb-2">Slippage Tolerance</h6>
          <Form.Group>
            <InputGroup size="sm">
              <Form.Control
                type="number"
                placeholder="Enter slippage tolerance"
                value={slippageTolerance}
                onChange={(e) => {
                  setSlippageTolerance(e.target.value);
                  setOperationError(null); // Clear error when typing
                }}
                onKeyDown={(e) => {
                  if (e.key === 'e' || e.key === 'E' || e.key === '+' || e.key === '-') {
                    e.preventDefault();
                  }
                }}
                onWheel={(e) => e.target.blur()}
                step="any"
                disabled={isRemoving}
                className="no-number-spinner"
              />
              <InputGroup.Text>%</InputGroup.Text>
            </InputGroup>
          </Form.Group>
        </div>

        {/* Estimated Amounts to Receive */}
        <div className="mb-3">
          <h6 className="border-bottom pb-2">You Will Receive</h6>
          {!estimatedBalances?.token0 || !estimatedBalances?.token1 ? (
            <Alert variant="warning">
              Cannot estimate token amounts
            </Alert>
          ) : (
            <>
              <div className="d-flex justify-content-between align-items-center mb-2">
                <div style={{ fontSize: '0.9em' }}>
                  <span style={{ color: 'var(--crimson-700)', fontWeight: 'bold' }}>{token0Data?.symbol}:</span> {estimatedBalances.token0.formatted}
                </div>
                {tokenPrices?.token0 > 0 && (
                  <span style={{ fontSize: '0.9em', color: 'var(--neutral-600)' }}>
                    ${getUsdValue(estimatedBalances.token0.formatted, token0Data?.symbol)?.toFixed(2) || '—'}
                  </span>
                )}
              </div>
              <div className="d-flex justify-content-between align-items-center">
                <div style={{ fontSize: '0.9em' }}>
                  <span style={{ color: 'var(--crimson-700)', fontWeight: 'bold' }}>{token1Data?.symbol}:</span> {estimatedBalances.token1.formatted}
                </div>
                {tokenPrices?.token1 > 0 && (
                  <span style={{ fontSize: '0.9em', color: 'var(--neutral-600)' }}>
                    ${getUsdValue(estimatedBalances.token1.formatted, token1Data?.symbol)?.toFixed(2) || '—'}
                  </span>
                )}
              </div>
              {totalUsdValue !== null && (
                <div className="text-end mt-2">
                  <small style={{ color: 'var(--neutral-600)' }}>Total: ${totalUsdValue.toFixed(2)}</small>
                </div>
              )}
            </>
          )}
        </div>

        {/* Uncollected Fees Section */}
        <div className="mb-3">
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
              {totalFeesUsd !== null && (
                <div className="text-end mt-2">
                  <small style={{ color: 'var(--neutral-600)' }}>Total: ${totalFeesUsd.toFixed(2)}</small>
                </div>
              )}
            </>
          )}
        </div>

        {/* Grand Total Section */}
        {grandTotalUsd > 0 && (
          <div className="border-top pt-3 mt-3 mb-5">
            <div className="d-flex justify-content-between">
              <h6 className="mb-0" style={{ color: 'var(--blue-accent)', fontWeight: 'bold' }}>Total Value to Receive:</h6>
              <h6 className="mb-0" style={{ color: 'var(--blue-accent)', fontWeight: 'bold' }}>${grandTotalUsd.toFixed(2)}</h6>
            </div>
          </div>
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
