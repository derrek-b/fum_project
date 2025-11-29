import React, { useState } from 'react';
import { Modal, Button, Spinner, Alert, Badge, Form, InputGroup } from 'react-bootstrap';
import { useSelector, useDispatch } from 'react-redux';

// FUM Library imports
import { AdapterFactory } from 'fum_library/adapters';
import { formatFeeDisplay } from 'fum_library/helpers/formatHelpers';

// Local project imports
import { useToast } from '../../context/ToastContext';
import { useProviders } from '../../hooks/useProviders';
import { triggerUpdate } from '../../redux/updateSlice';

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
  const totalBalanceUsd = (tokenBalances?.token0 && tokenBalances?.token1) ?
    calculateTotalUsdValue(tokenBalances.token0.formatted, tokenBalances.token1.formatted) : null;

  // Total fees value
  const totalFeesUsd = (uncollectedFees?.token0 && uncollectedFees?.token1) ?
    calculateTotalUsdValue(uncollectedFees.token0.formatted, uncollectedFees.token1.formatted) : null;

  // Grand total (balances + fees)
  const grandTotalUsd = (totalBalanceUsd || 0) + (totalFeesUsd || 0);

  // Check if we have meaningful token amounts
  const hasBalances = (tokenBalances?.token0 && tokenBalances?.token1) &&
    (parseFloat(tokenBalances.token0.formatted) > 0 || parseFloat(tokenBalances.token1.formatted) > 0);

  const hasFees = (uncollectedFees?.token0 && uncollectedFees?.token1) &&
    (parseFloat(uncollectedFees.token0.formatted) > 0 || parseFloat(uncollectedFees.token1.formatted) > 0);

  // Function to close position using the adapter
  const closePosition = async (shouldBurn, slippageTolerance) => {
    // Get the appropriate adapter (uses read provider)
    const adapter = AdapterFactory.getAdapter(position.platform, chainId, readProvider);

    if (!adapter) {
      throw new Error("No adapter available for this position");
    }

    setIsClosing(true);
    setOperationError(null);

    try {
      // Closing a position is just removing 100% of liquidity (which also collects fees)
      const txData = await adapter.generateRemoveLiquidityData({
        position,
        percentage: 100, // Remove 100% to close
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

      // TODO: If shouldBurn is true, we could send a second transaction to burn the NFT
      // For now, we just remove 100% liquidity which leaves an empty NFT
      // The burn functionality may need to be implemented separately

      // Show success message
      showSuccess("Successfully closed position!", receipt.transactionHash);

      // Close modal and refresh data
      onHide();
      dispatch(triggerUpdate());

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
      keyboard={false} // Prevent Escape key from closing
      data-no-propagation="true" // Custom attribute for clarity
    >
      <style>{numberInputStyles}</style>
      <Modal.Header closeButton>
        <Modal.Title>
          Close Position #{position?.id} - {position?.tokenPair}
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

        {/* Token Balances Section */}
        <div className="mb-4">
          <h6 className="border-bottom pb-2">Token Balances to Withdraw</h6>
          {!tokenBalances?.token0 || !tokenBalances?.token1 ? (
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

        {/* Add slippage tolerance input */}
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
                  setOperationError(null); // Clear error when typing
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
