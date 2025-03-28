// src/components/PositionSelectionModal.js
import React, { useState, useEffect, useMemo } from "react";
import { Modal, Button, Form, Spinner, Alert, ListGroup, Badge } from "react-bootstrap";
import { useSelector, useDispatch } from "react-redux";
import { useToast } from "../context/ToastContext";

export default function PositionSelectionModal({
  show,
  onHide,
  vault,
  mode // 'add' or 'remove'
}) {
  const { showError } = useToast();
  const dispatch = useDispatch();
  const { positions } = useSelector((state) => state.positions);
  const { pools } = useSelector((state) => state.pools);
  const { tokens } = useSelector((state) => state.tokens);

  // State for selected positions
  const [selectedPositions, setSelectedPositions] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);

  // Filter positions based on mode using useMemo to avoid unnecessary recalculations
  const filteredPositions = useMemo(() => {
    console.log("Filtering positions:", positions.length, "total positions");

    return positions.filter(position => {
      if (mode === 'add') {
        // When adding, show only positions NOT in any vault
        const isDirectWalletPosition = !position.inVault || !position.vaultAddress;
        console.log(`Position ${position.id}: inVault=${position.inVault}, vaultAddress=${position.vaultAddress || 'none'}, isWallet=${isDirectWalletPosition}`);
        return isDirectWalletPosition;
      } else {
        // When removing, show only positions IN THIS vault
        const isInThisVault = position.inVault && position.vaultAddress === vault.address;
        console.log(`Position ${position.id}: inVault=${position.inVault}, vaultAddress=${position.vaultAddress || 'none'}, isInThisVault=${isInThisVault}`);
        return isInThisVault;
      }
    });
  }, [positions, mode, vault.address]);

  // Reset selection when modal opens/closes or mode changes
  useEffect(() => {
    // Reset selections when modal opens or mode changes
    if (show) {
      setSelectedPositions([]);
      console.log(`Modal opened in ${mode} mode with ${filteredPositions.length} available positions`);
    }
  }, [show, mode]);

  // Log the state of positions when they change
  useEffect(() => {
    if (show) {
      console.log(`Available positions for ${mode}:`, filteredPositions.length);
      console.log(`Total positions in store: ${positions.length}`);
    }
  }, [show, filteredPositions.length, positions.length, mode]);

  // Handle checkbox change
  const handlePositionToggle = (positionId) => {
    setSelectedPositions(prev => {
      if (prev.includes(positionId)) {
        return prev.filter(id => id !== positionId);
      } else {
        return [...prev, positionId];
      }
    });
  };

  // Handle position action (add or remove)
  const handleConfirm = async () => {
    if (selectedPositions.length === 0) {
      showError("Please select at least one position");
      return;
    }

    setIsProcessing(true);

    try {
      // Will be implemented in the next step
      console.log(`${mode === 'add' ? 'Adding' : 'Removing'} positions:`, selectedPositions);

      // Placeholder for now - we'll implement the actual logic later
      onHide(); // Close the modal after "completion"
    } catch (error) {
      console.error(`Error ${mode === 'add' ? 'adding' : 'removing'} positions:`, error);
      showError(`Failed to ${mode === 'add' ? 'add' : 'remove'} positions: ${error.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  // Get position details for display
  const getPositionDetails = (position) => {
    try {
      // First try to use the position's tokenPair if available
      const defaultPair = position.tokenPair || 'Unknown Pair';

      // Try to get more detailed info from pool data
      const poolData = pools[position.poolAddress];
      if (!poolData) return { pair: defaultPair, isInRange: false };

      const token0Data = tokens[poolData.token0];
      const token1Data = tokens[poolData.token1];

      // If we can't get token data, use what we have
      if (!token0Data || !token1Data) return { pair: defaultPair, isInRange: false };

      // Check if position is in range using the pool's current tick
      let isInRange = false;
      try {
        if (poolData.tick !== undefined && poolData.tick !== null) {
          // Basic calculation: position is in range if current tick is between tickLower and tickUpper
          isInRange = poolData.tick >= position.tickLower && poolData.tick <= position.tickUpper;
        }
      } catch (rangeError) {
        console.error(`Error calculating range status for position ${position.id}:`, rangeError);
      }

      // Format the pair string from token symbols
      const pairStr = token0Data.symbol && token1Data.symbol
        ? `${token0Data.symbol}/${token1Data.symbol}`
        : defaultPair;

      // Return formatted details
      return {
        pair: pairStr,
        feeTier: position.fee ? `${position.fee / 10000}%` : 'N/A',
        isInRange
      };
    } catch (error) {
      console.error(`Error getting details for position ${position.id}:`, error);
      return { pair: position.tokenPair || 'Unknown Pair', isInRange: false };
    }
  };

  return (
    <Modal
      show={show}
      onHide={onHide}
      size="lg"
      centered
      backdrop={isProcessing ? "static" : true}
      keyboard={!isProcessing}
    >
      <Modal.Header closeButton>
        <Modal.Title>
          {mode === 'add' ? 'Add Positions to Vault' : 'Remove Positions from Vault'}
        </Modal.Title>
      </Modal.Header>

      <Modal.Body>
        <p>
          {mode === 'add'
            ? 'Select the positions you want to transfer to this vault:'
            : 'Select the positions you want to remove from this vault:'}
        </p>

        {positions.length === 0 ? (
          <Alert variant="warning">
            No positions found in the system. Please ensure your wallet is connected and you have positions.
          </Alert>
        ) : filteredPositions.length === 0 ? (
          <Alert variant="info">
            {mode === 'add'
              ? "You don't have any wallet positions available to add to this vault. All your positions might already be in vaults."
              : "This vault doesn't have any positions to remove."}
          </Alert>
        ) : (
          <ListGroup className="mb-3">
            {filteredPositions.map(position => {
              const details = getPositionDetails(position);
              return (
                <ListGroup.Item
                  key={position.id}
                  className="d-flex justify-content-between align-items-center"
                >
                  <Form.Check
                    type="checkbox"
                    id={`position-${position.id}`}
                    label={
                      <div className="ms-2">
                        <div><strong>{details.pair}</strong> - Position #{position.id}</div>
                        <div className="text-muted small">Fee: {details.feeTier}</div>
                      </div>
                    }
                    checked={selectedPositions.includes(position.id)}
                    onChange={() => handlePositionToggle(position.id)}
                    disabled={isProcessing}
                  />
                  <div>
                    <Badge bg={details.isInRange ? "success" : "danger"} className="me-2">
                      {details.isInRange ? "In Range" : "Out of Range"}
                    </Badge>
                    {position.platform && (
                      <Badge bg="info">{position.platformName || position.platform}</Badge>
                    )}
                  </div>
                </ListGroup.Item>
              );
            })}
          </ListGroup>
        )}
      </Modal.Body>

      <Modal.Footer>
        <Button variant="secondary" onClick={onHide} disabled={isProcessing}>
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={handleConfirm}
          disabled={isProcessing || selectedPositions.length === 0 || filteredPositions.length === 0}
        >
          {isProcessing ? (
            <>
              <Spinner
                as="span"
                animation="border"
                size="sm"
                role="status"
                aria-hidden="true"
                className="me-2"
              />
              Processing...
            </>
          ) : (
            mode === 'add' ? 'Add Selected Positions' : 'Remove Selected Positions'
          )}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
