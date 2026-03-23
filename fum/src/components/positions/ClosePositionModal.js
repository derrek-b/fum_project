import React, { useState, useMemo } from 'react';
import { Modal, Button, Spinner, Alert, Form, InputGroup } from 'react-bootstrap';
import { useSelector, useDispatch } from 'react-redux';
import { useRouter } from 'next/router';

// FUM Library imports
import { AdapterFactory } from 'fum_library/adapters';
import { formatFeeDisplay } from 'fum_library/helpers/formatHelpers';

// Local project imports
import { useToast } from '../../context/ToastContext';
import { useProviders } from '../../hooks/useProviders';
import { useModalData } from '../../hooks/useModalData';
import { removePosition } from '../../redux/positionsSlice';

// CSS to hide number input spinner arrows
const numberInputStyles = `
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

export default function ClosePositionModal({
  show,
  onHide,
  position,
  tokenPrices,
  onCloseRedirect
}) {
  const router = useRouter();
  const dispatch = useDispatch();
  const { showError, showSuccess } = useToast();
  const { address, chainId } = useSelector(state => state.wallet);
  const { readProvider, getSigner } = useProviders();

  // State for burn option
  const [shouldBurn, setShouldBurn] = useState(true);

  // State for slippage tolerance
  const [slippageTolerance, setSlippageTolerance] = useState(0.5);

  // State for operation status
  const [isClosing, setIsClosing] = useState(false);
  const [operationError, setOperationError] = useState(null);

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

  // Calculate USD values
  const getUsdValue = (amount, isToken0) => {
    if (!amount || !tokenPrices) return null;
    const price = isToken0 ? tokenPrices.token0 : tokenPrices.token1;
    if (!price) return null;
    return amount * price;
  };

  // Total balance value
  const totalBalanceUsd = positionForAdapter ?
    (getUsdValue(positionForAdapter.token0Amount, true) || 0) +
    (getUsdValue(positionForAdapter.token1Amount, false) || 0) :
    null;

  // Total fees value
  const totalFeesUsd = positionForAdapter ?
    (getUsdValue(positionForAdapter.uncollectedFees0, true) || 0) +
    (getUsdValue(positionForAdapter.uncollectedFees1, false) || 0) :
    null;

  // Grand total (balances + fees)
  const grandTotalUsd = (totalBalanceUsd || 0) + (totalFeesUsd || 0);

  // Check if we have meaningful token amounts
  const hasBalances = positionForAdapter &&
    (positionForAdapter.token0Amount > 0 || positionForAdapter.token1Amount > 0);

  const hasFees = positionForAdapter &&
    (positionForAdapter.uncollectedFees0 > 0 || positionForAdapter.uncollectedFees1 > 0);

  // Function to close position using the adapter
  const closePosition = async (shouldBurn, slippageTolerance) => {
    if (!adapter) {
      throw new Error("No adapter available for this position");
    }

    setIsClosing(true);
    setOperationError(null);

    try {
      // Closing a position is removing 100% of liquidity (which also collects fees)
      // Adapter resolves token data internally (Fix 6)
      const txData = await adapter.generateRemoveLiquidityData({
        position: positionForAdapter,
        percentage: 100,
        provider: readProvider,
        walletAddress: address,
        poolData,
        slippageTolerance,
        deadlineMinutes: 20,
        burnToken: shouldBurn
      });

      // Get signer to send transaction
      const signer = await getSigner();

      // Send the transaction
      const tx = await signer.sendTransaction(txData);

      // Wait for confirmation
      const receipt = await tx.wait();

      // Show success message
      showSuccess("Successfully closed position!", receipt.transactionHash);

      // Remove position from Redux and redirect to source page
      dispatch(removePosition(positionForAdapter.id));
      router.push(onCloseRedirect);

      setIsClosing(false);
    } catch (error) {
      // Always set closing to false first to prevent state update issues
      setIsClosing(false);

      // Check if user cancelled the transaction
      if (error.code === 'ACTION_REJECTED' || error.code === 4001 || error.message?.includes('user rejected')) {
        // User cancelled - silently ignore, modal stays open
        return;
      }

      // Real error - log and show user-friendly message
      console.error("Error closing position:", error);
      const errorDetail = error.reason || error.message;
      setOperationError(`Transaction failed${errorDetail ? `: ${errorDetail}` : ''}`);
    }
  };

  // Handle the close position action
  const handleClosePosition = () => {
    setOperationError(null);

    // Validate inputs
    if (!position) {
      setOperationError("Position data is missing");
      return;
    }

    const slippageNum = parseFloat(slippageTolerance);
    if (isNaN(slippageNum) || slippageNum < 0.1 || slippageNum > 5) {
      setOperationError("Slippage tolerance must be between 0.1% and 5%");
      return;
    }

    // Call the function that interacts with the adapter
    closePosition(shouldBurn, slippageNum);
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
      keyboard={false}
      data-no-propagation="true"
    >
      <style>{numberInputStyles}</style>
      <Modal.Header closeButton>
        <Modal.Title>
          Close Position #{position?.id} - {position?.tokenPair}
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

        {/* Token Balances Section */}
        <div className="mb-4">
          <h6 className="border-bottom pb-2">Token Balances to Withdraw</h6>
          {isLoading ? (
            <div className="text-center py-3">
              <Spinner animation="border" size="sm" className="me-2" />
              Loading position data...
            </div>
          ) : !positionForAdapter ? (
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
              {totalBalanceUsd !== null && (
                <div className="text-end mt-2">
                  <small style={{ color: 'var(--neutral-600)' }}>Total: ${totalBalanceUsd.toFixed(2)}</small>
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

        {/* Slippage Tolerance */}
        <div className="border-top pt-3 mt-3 mb-5">
          <h6 className="mb-2">Slippage Tolerance</h6>
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
                disabled={isClosing}
                className="no-number-spinner"
              />
              <InputGroup.Text>%</InputGroup.Text>
            </InputGroup>
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
          <Form.Text style={{ color: 'var(--neutral-600)' }}>
            Burning the position NFT frees up storage on the blockchain and may result in a gas refund.
            If unchecked, the empty position will remain in your wallet, but will not earn fees.
          </Form.Text>
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={handleModalClose} disabled={isClosing}>
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={handleClosePosition}
          disabled={isClosing || isLoading}
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
