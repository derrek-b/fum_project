import React, { useState, useMemo, useEffect } from 'react';
import { Modal, Button, Spinner, Alert, Badge, Form, Row, Col, InputGroup } from 'react-bootstrap';
import { useSelector, useDispatch } from 'react-redux';

// FUM Library imports
import { AdapterFactory } from 'fum_library/adapters';
import { formatFeeDisplay } from 'fum_library/helpers/formatHelpers';

// Local project imports
import { useToast } from '../../context/ToastContext';
import { useProviders } from '../../hooks/useProviders';
import { useModalData } from '../../hooks/useModalData';
import { updatePosition } from '../../redux/positionsSlice';

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
  tokenPrices
}) {
  const dispatch = useDispatch();
  const { showError, showSuccess } = useToast();
  const { address, chainId } = useSelector(state => state.wallet);
  const { readProvider, getSigner } = useProviders();

  // State for the percentage slider
  const [percentage, setPercentage] = useState(100);
  const [slippageTolerance, setSlippageTolerance] = useState(0.5);

  // State for operation status
  const [isRemoving, setIsRemoving] = useState(false);
  const [operationError, setOperationError] = useState(null);

  // Reset to 100% each time modal opens
  useEffect(() => {
    if (show) {
      setPercentage(100);
      setOperationError(null);
    }
  }, [show]);

  // Get adapter for this position's platform
  const adapter = useMemo(() => {
    if (!position?.platform || !chainId) return null;
    try {
      return AdapterFactory.getAdapter(position.platform, chainId);
    } catch {
      return null;
    }
  }, [position?.platform, chainId]);

  // Hook manages fresh pool data + position display data with 30s auto-refresh
  const { poolData, positionForAdapter, isLoading } = useModalData(adapter, position, readProvider, show);

  // Token symbols from position's tokenPair
  const [token0Symbol, token1Symbol] = useMemo(() => {
    if (!position?.tokenPair) return ['', ''];
    return position.tokenPair.split('/');
  }, [position?.tokenPair]);

  // Estimated token amounts based on percentage (simple float math)
  const estimatedToken0 = positionForAdapter ? (positionForAdapter.token0Amount * percentage / 100) : null;
  const estimatedToken1 = positionForAdapter ? (positionForAdapter.token1Amount * percentage / 100) : null;

  // Calculate USD values
  const getUsdValue = (amount, isToken0) => {
    if (!amount || !tokenPrices) return null;
    const price = isToken0 ? tokenPrices.token0 : tokenPrices.token1;
    if (!price) return null;
    return amount * price;
  };

  // Calculate total USD value for current position
  const currentTotalUsdValue = positionForAdapter ?
    (getUsdValue(positionForAdapter.token0Amount, true) || 0) +
    (getUsdValue(positionForAdapter.token1Amount, false) || 0) :
    null;

  // Calculate total USD value for estimated amount to receive
  const totalUsdValue = (estimatedToken0 !== null && estimatedToken1 !== null) ?
    (getUsdValue(estimatedToken0, true) || 0) +
    (getUsdValue(estimatedToken1, false) || 0) :
    null;

  // Calculate total USD value for uncollected fees
  const totalFeesUsd = positionForAdapter ?
    (getUsdValue(positionForAdapter.uncollectedFees0, true) || 0) +
    (getUsdValue(positionForAdapter.uncollectedFees1, false) || 0) :
    null;

  // Calculate grand total (estimated liquidity + all fees)
  const grandTotalUsd = (totalUsdValue || 0) + (totalFeesUsd || 0);

  // Check if we have meaningful fee amounts
  const hasFees = positionForAdapter &&
    (positionForAdapter.uncollectedFees0 > 0 || positionForAdapter.uncollectedFees1 > 0);

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
    if (!adapter) {
      throw new Error("No adapter available for this position");
    }

    setIsRemoving(true);
    setOperationError(null);

    try {
      // Generate transaction data — adapter resolves token data internally (Fix 6)
      const txData = await adapter.generateRemoveLiquidityData({
        position: positionForAdapter,
        percentage,
        provider: readProvider,
        walletAddress: address,
        poolData,
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

      // Refresh this position's data and close modal
      const freshPosition = await adapter.refreshPositionForDisplay(positionForAdapter.id, readProvider);
      dispatch(updatePosition(freshPosition));
      onHide();

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
      keyboard={false}
      data-no-propagation="true"
    >
      <style>{sliderStyles}</style>
      <Modal.Header closeButton>
        <Modal.Title>
          Remove Liquidity from Position #{position?.id} - {position?.tokenPair}
          <small className="ms-2 text-muted">({position?.fee}% fee)</small>
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
          {isLoading ? (
            <div className="text-center py-3">
              <Spinner animation="border" size="sm" className="me-2" />
              Loading position data...
            </div>
          ) : !positionForAdapter ? (
            <Alert variant="warning">
              Token balance information is not available
            </Alert>
          ) : (
            <>
              <div className="d-flex justify-content-between align-items-center mb-2">
                <div style={{ fontSize: '0.9em' }}>
                  <span style={{ color: 'var(--crimson-700)', fontWeight: 'bold' }}>{token0Symbol}:</span> {positionForAdapter.token0Amount.toFixed(6)}
                </div>
                {tokenPrices?.token0 > 0 && (
                  <span style={{ fontSize: '0.9em', color: 'var(--neutral-600)' }}>
                    ${getUsdValue(positionForAdapter.token0Amount, true)?.toFixed(2) || '—'}
                  </span>
                )}
              </div>
              <div className="d-flex justify-content-between align-items-center">
                <div style={{ fontSize: '0.9em' }}>
                  <span style={{ color: 'var(--crimson-700)', fontWeight: 'bold' }}>{token1Symbol}:</span> {positionForAdapter.token1Amount.toFixed(6)}
                </div>
                {tokenPrices?.token1 > 0 && (
                  <span style={{ fontSize: '0.9em', color: 'var(--neutral-600)' }}>
                    ${getUsdValue(positionForAdapter.token1Amount, false)?.toFixed(2) || '—'}
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

        {/* Slippage Tolerance */}
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
                  setOperationError(null);
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
          {estimatedToken0 === null || estimatedToken1 === null ? (
            <Alert variant="warning">
              Cannot estimate token amounts
            </Alert>
          ) : (
            <>
              <div className="d-flex justify-content-between align-items-center mb-2">
                <div style={{ fontSize: '0.9em' }}>
                  <span style={{ color: 'var(--crimson-700)', fontWeight: 'bold' }}>{token0Symbol}:</span> {estimatedToken0.toFixed(6)}
                </div>
                {tokenPrices?.token0 > 0 && (
                  <span style={{ fontSize: '0.9em', color: 'var(--neutral-600)' }}>
                    ${getUsdValue(estimatedToken0, true)?.toFixed(2) || '—'}
                  </span>
                )}
              </div>
              <div className="d-flex justify-content-between align-items-center">
                <div style={{ fontSize: '0.9em' }}>
                  <span style={{ color: 'var(--crimson-700)', fontWeight: 'bold' }}>{token1Symbol}:</span> {estimatedToken1.toFixed(6)}
                </div>
                {tokenPrices?.token1 > 0 && (
                  <span style={{ fontSize: '0.9em', color: 'var(--neutral-600)' }}>
                    ${getUsdValue(estimatedToken1, false)?.toFixed(2) || '—'}
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
          {isLoading || !positionForAdapter ? (
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
                  <span style={{ color: 'var(--crimson-700)', fontWeight: 'bold' }}>{token0Symbol}:</span> {formatFeeDisplay(positionForAdapter.uncollectedFees0)}
                </div>
                {tokenPrices?.token0 > 0 && (
                  <span style={{ fontSize: '0.9em', color: 'var(--neutral-600)' }}>
                    ${getUsdValue(positionForAdapter.uncollectedFees0, true)?.toFixed(2) || '—'}
                  </span>
                )}
              </div>
              <div className="d-flex justify-content-between align-items-center">
                <div style={{ fontSize: '0.9em' }}>
                  <span style={{ color: 'var(--crimson-700)', fontWeight: 'bold' }}>{token1Symbol}:</span> {formatFeeDisplay(positionForAdapter.uncollectedFees1)}
                </div>
                {tokenPrices?.token1 > 0 && (
                  <span style={{ fontSize: '0.9em', color: 'var(--neutral-600)' }}>
                    ${getUsdValue(positionForAdapter.uncollectedFees1, false)?.toFixed(2) || '—'}
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
          disabled={isRemoving || isLoading}
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
