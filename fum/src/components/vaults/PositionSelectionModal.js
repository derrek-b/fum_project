// src/components/PositionSelectionModal.js
import React, { useState, useEffect, useMemo } from "react";
import { Modal, Button, Form, Spinner, Alert, ListGroup, Badge } from "react-bootstrap";
import { useSelector, useDispatch } from "react-redux";
import { useToast } from "../../context/ToastContext";
import { useProviders } from '../../hooks/useProviders';
import { platforms } from 'fum_library/configs';
import { transferPositionToVault, transferPositionFromVault } from "../../redux/vaultPositionActions";
import { lookupPlatformById, getPlatformMetadata } from 'fum_library/helpers/platformHelpers';
import { getTokenBySymbol, getNativeSymbol, getWrappedNativeSymbol } from 'fum_library/helpers/tokenHelpers';
import { getVaultContract } from 'fum_library/blockchain/contracts';
import { ethers } from "ethers";
import TransactionProgressModal from '../common/TransactionProgressModal';
import StrategyValidationModal from './StrategyValidationModal';

export default function PositionSelectionModal({
  show,
  onHide,
  vault,
  chainId,
  mode // 'add' or 'remove'
}) {
  const { showSuccess, showError } = useToast();
  const dispatch = useDispatch();

  // Get data from Redux store
  const { positions } = useSelector((state) => state.positions);
  //const { provider } = useSelector((state) => state.wallet.provider);
  const { address } = useSelector((state) => state.wallet);
  const { readProvider, getSigner, isWriteReady } = useProviders();

  // State for selected positions
  const [selectedPositions, setSelectedPositions] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState("");

  // State for strategy warning modal
  const [showStrategyWarning, setShowStrategyWarning] = useState(false);
  const [strategyWarnings, setStrategyWarnings] = useState([]);

  // State for progress modal
  const [transactionSteps, setTransactionSteps] = useState([]);
  const [currentTransactionStep, setCurrentTransactionStep] = useState(0);
  const [transactionLoading, setTransactionLoading] = useState(false);
  const [transactionError, setTransactionError] = useState("");
  const [transactionWarning, setTransactionWarning] = useState("");
  const [showTransactionModal, setShowTransactionModal] = useState(false);

  // Filter positions based on mode using useMemo to avoid unnecessary recalculations
  const filteredPositions = useMemo(() => {

    return positions.filter(position => {
      if (mode === 'add') {
        // When adding, show only positions NOT in any vault
        const isDirectWalletPosition = !position.inVault || !position.vaultAddress;
        return isDirectWalletPosition;
      } else {
        // When removing, show only positions IN THIS vault
        const isInThisVault = position.inVault && position.vaultAddress === vault.address;
        return isInThisVault;
      }
    });
  }, [positions, mode, vault.address]);

  // Check if a position has supported tokens (only for 'add' mode)
  const isPositionSupported = (position) => {
    if (!position?.tokenPair) return { supported: false, reason: 'Missing token pair' };
    try {
      const [t0Symbol, t1Symbol] = position.tokenPair.split('/');
      getTokenBySymbol(t0Symbol);
      getTokenBySymbol(t1Symbol);
      return { supported: true };
    } catch (error) {
      return { supported: false, reason: 'Contains unsupported token(s)' };
    }
  };

  // Reset selection when modal opens/closes or mode changes
  useEffect(() => {
    // Reset selections when modal opens or mode changes
    if (show) {
      setSelectedPositions([]);
    }
  }, [show, mode]);


  // Handle position toggle
  const handlePositionToggle = (positionId) => {
    setError(""); // Clear error when selecting positions
    setSelectedPositions(prev => {
      if (prev.includes(positionId)) {
        return prev.filter(id => id !== positionId);
      } else {
        return [...prev, positionId];
      }
    });
  };

  // Generate transaction steps for progress modal
  const generateTransferSteps = (positionsToTransfer) => {
    return positionsToTransfer.map(positionId => {
      const position = positions.find(p => p.id === positionId);
      if (!position) {
        return {
          title: `Transfer Position #${positionId}`,
          description: 'Position data not found'
        };
      }

      const tokenPair = position.tokenPair || 'Unknown pair';
      const feeTier = position.fee != null ? `${position.fee}%` : 'Unknown fee';

      return {
        title: `Transfer Position #${positionId}`,
        description: `${tokenPair} - ${feeTier}`
      };
    });
  };

  // Check selected positions against vault strategy (token + platform alignment)
  const checkStrategyAlignment = () => {
    const targets = vault?.strategy?.selectedTokens;
    const targetPlatforms = vault?.strategy?.selectedPlatforms;
    if (!targets || targets.length === 0) return []; // No strategy = no warnings

    const nativeSymbol = getNativeSymbol(chainId);
    const wrappedSymbol = getWrappedNativeSymbol(chainId);

    const isTokenMatch = (symbol) => {
      if (targets.includes(symbol)) return true;
      if (symbol === nativeSymbol && targets.includes(wrappedSymbol)) return true;
      if (symbol === wrappedSymbol && targets.includes(nativeSymbol)) return true;
      return false;
    };

    const warnings = [];
    const tokenMismatches = [];
    const platformMismatches = [];

    for (const posId of selectedPositions) {
      const position = positions.find(p => p.id === posId);
      if (!position?.tokenPair) continue;

      const [t0, t1] = position.tokenPair.split('/');

      // Token mismatch check
      const nonMatching = [];
      if (!isTokenMatch(t0)) nonMatching.push(t0);
      if (!isTokenMatch(t1)) nonMatching.push(t1);
      if (nonMatching.length > 0) {
        tokenMismatches.push({
          id: position.id,
          tokenPair: position.tokenPair,
          nonMatchingTokens: nonMatching
        });
      }

      // Platform mismatch check
      if (targetPlatforms && targetPlatforms.length > 0 && position.platform && !targetPlatforms.includes(position.platform)) {
        const targetPlatformNames = targetPlatforms
          .map(id => { try { return getPlatformMetadata(id).name; } catch { return id; } })
          .join(', ');
        platformMismatches.push({
          id: position.id,
          tokenPair: position.tokenPair,
          platformName: position.platformName || position.platform,
          targetPlatformNames
        });
      }
    }

    if (tokenMismatches.length > 0) {
      warnings.push({ type: 'unmatchedPositions', count: tokenMismatches.length, items: tokenMismatches });
    }
    if (platformMismatches.length > 0) {
      warnings.push({ type: 'unmatchedPlatform', count: platformMismatches.length, items: platformMismatches });
    }
    return warnings;
  };

  // Handle position action (add or remove)
  const handleConfirm = async () => {
    if (selectedPositions.length === 0) {
      setError("Please select at least one position");
      return;
    }

    setError(""); // Clear any previous errors

    // Strategy alignment check (only when adding positions to a vault with an active strategy)
    if (mode === 'add') {
      const warnings = checkStrategyAlignment();
      if (warnings.length > 0) {
        setStrategyWarnings(warnings);
        setShowStrategyWarning(true);
        return;
      }
    }

    await executeTransfer();
  };

  // Execute the actual transfer (called directly or after warning confirmation)
  const executeTransfer = async () => {
    // Conditional logic: single position = toast flow, multiple = progress modal flow
    if (selectedPositions.length === 1) {
      // Path A: Single position - simple toast-based flow
      setIsProcessing(true);

      try {
        const positionId = selectedPositions[0];
        const signer = await getSigner();

        // Find the position object from the positions array
        const position = positions.find(p => p.id === positionId);
        if (!position) {
          throw new Error(`Position #${positionId} data not found`);
        }

        // Get the correct position manager address based on the position's platform
        const platformInfo = lookupPlatformById(position.platform, chainId);
        if (!platformInfo || !platformInfo.positionManagerAddress) {
          throw new Error(`Position manager address not found for platform ${position.platform}`);
        }

        let tx;
        if (mode === 'add') {
          // Add: Transfer position from user wallet to vault
          const nftPositionManager = new ethers.Contract(
            platformInfo.positionManagerAddress,
            [
              'function safeTransferFrom(address from, address to, uint256 tokenId) external'
            ],
            signer
          );
          tx = await nftPositionManager.safeTransferFrom(address, vault.address, positionId);
        } else {
          // Remove: Call vault's withdrawPosition method (always withdraws to owner)
          const vaultContract = getVaultContract(vault.address, readProvider);
          const vaultWithSigner = vaultContract.connect(signer);
          tx = await vaultWithSigner.withdrawPosition(
            platformInfo.positionManagerAddress,
            positionId
          );
        }

        await tx.wait();

        // Update Redux store based on mode (single dispatch updates both slices)
        if (mode === 'add') {
          dispatch(transferPositionToVault({ positionId, vaultAddress: vault.address }));
          showSuccess(`Successfully added position #${positionId} to vault`);
        } else {
          dispatch(transferPositionFromVault({ positionId, vaultAddress: vault.address }));
          showSuccess(`Successfully removed position #${positionId} from vault`);
        }
        onHide();
      } catch (error) {
        // Check if user cancelled the transaction
        if (error.code === 'ACTION_REJECTED' || error.code === 4001 || error.message?.includes('user rejected')) {
          // User cancelled - silently ignore
          return;
        }

        // Real error - log and show user-friendly message in modal
        const action = mode === 'add' ? 'adding position to' : 'removing position from';
        console.error(`Error ${action} vault:`, error);
        const errorDetail = error.reason || error.message || "Unknown error";
        setError(`Failed to ${mode} position: ${errorDetail}`);
      } finally {
        setIsProcessing(false);
      }
    } else {
      // Path B: Multiple positions - progress modal flow
      // Generate steps
      const steps = generateTransferSteps(selectedPositions);
      setTransactionSteps(steps);
      setCurrentTransactionStep(0);
      setTransactionLoading(true);
      setTransactionError("");
      setTransactionWarning("");
      setShowTransactionModal(true);

      try {
        const signer = await getSigner();

        // Process each position with step tracking
        for (let i = 0; i < selectedPositions.length; i++) {
          const positionId = selectedPositions[i];
          setCurrentTransactionStep(i);

          try {
            // Find the position object from the positions array
            const position = positions.find(p => p.id === positionId);
            if (!position) {
              throw new Error(`Position #${positionId} data not found`);
            }

            // Get the correct position manager address based on the position's platform
            const platformInfo = lookupPlatformById(position.platform, chainId);
            if (!platformInfo || !platformInfo.positionManagerAddress) {
              throw new Error(`Position manager address not found for platform ${position.platform}`);
            }

            let tx;
            if (mode === 'add') {
              // Add: Transfer position from user wallet to vault
              const nftPositionManager = new ethers.Contract(
                platformInfo.positionManagerAddress,
                [
                  'function safeTransferFrom(address from, address to, uint256 tokenId) external'
                ],
                signer
              );
              tx = await nftPositionManager.safeTransferFrom(address, vault.address, positionId);
            } else {
              // Remove: Call vault's withdrawPosition method (always withdraws to owner)
              const vaultContract = getVaultContract(vault.address, readProvider);
              const vaultWithSigner = vaultContract.connect(signer);
              tx = await vaultWithSigner.withdrawPosition(
                platformInfo.positionManagerAddress,
                positionId
              );
            }

            await tx.wait();

            // Update Redux store based on mode (single dispatch updates both slices)
            if (mode === 'add') {
              dispatch(transferPositionToVault({ positionId, vaultAddress: vault.address }));
            } else {
              dispatch(transferPositionFromVault({ positionId, vaultAddress: vault.address }));
            }
          } catch (posError) {
            // Check if user cancelled
            if (posError.code === 'ACTION_REJECTED' || posError.code === 4001 || posError.message?.includes('user rejected')) {
              setTransactionLoading(false);
              setTransactionWarning(`Transaction cancelled. ${i} of ${selectedPositions.length} position${selectedPositions.length !== 1 ? 's' : ''} transferred successfully. The remaining positions were not transferred.`);
              return;
            }

            // Real error - set error and stop processing
            setTransactionLoading(false);
            const errorDetail = posError.reason || posError.message || "Unknown error";
            setTransactionError(`Failed to transfer position #${positionId}: ${errorDetail}`);
            throw posError;
          }
        }

        // All transfers completed successfully
        setTransactionLoading(false);
        setCurrentTransactionStep(selectedPositions.length);
      } catch (error) {
        // Error already handled in per-position catch
        // Only need to handle if not already set
        if (!transactionError) {
          setTransactionLoading(false);
          const errorDetail = error.reason || error.message || "Unknown error";
          setTransactionError(`Failed to transfer positions: ${errorDetail}`);
        }
      }
    }
  };

  // Handle closing the transaction modal
  const handleCloseTransactionModal = () => {
    // Reset all transaction state
    setShowTransactionModal(false);
    setTransactionSteps([]);
    setCurrentTransactionStep(0);
    setTransactionLoading(false);
    setTransactionError("");
    setTransactionWarning("");

    // Close the parent modal
    onHide();
  };

  // Get position details for display
  const getPositionDetails = (position) => {
    // Use position's tokenPair
    const tokenPair = position.tokenPair;

    // Fee tier from position
    const feeTier = `${position.fee}%`;

    // Get the platform color directly from config
    const platformColor = position.platform && platforms[position.platform]?.color
                         ? platforms[position.platform].color
                         : '#6c757d';

    return { pair: tokenPair, feeTier, platformColor };
  };

  return (
    <>
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
        {error && (
          <Alert variant="danger">
            {error}
          </Alert>
        )}

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
              // Only check token support in 'add' mode - removal should always work
              const supportStatus = mode === 'add' ? isPositionSupported(position) : { supported: true };

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
                        {!supportStatus.supported && (
                          <div className="text-danger small">⚠️ {supportStatus.reason}</div>
                        )}
                      </div>
                    }
                    checked={selectedPositions.includes(position.id)}
                    onChange={() => handlePositionToggle(position.id)}
                    disabled={isProcessing || !supportStatus.supported}
                  />
                  {/* Conditional display of either logo or badge */}
                  {position.platform && (
                    platforms[position.platform]?.logo ? (
                      // Show logo if available
                      <div
                        className="ms-2 d-inline-flex align-items-center justify-content-center"
                        style={{
                          height: '20px',
                          width: '20px'
                        }}
                      >
                        <img
                          src={platforms[position.platform].logo}
                          alt={position.platformName || position.platform}
                          width={20}
                          height={20}
                          title={position.platformName || position.platform}
                        />
                      </div>
                    ) : (
                      // Show colored badge if no logo - with explicit color override
                      <Badge
                        className="ms-2 d-inline-flex align-items-center"
                        pill  // Add pill shape to match design
                        bg="" // Important! Set this to empty string to prevent default bg color
                        style={{
                          fontSize: '0.75rem',
                          backgroundColor: details.platformColor,
                          padding: '0.25em 0.5em',
                          color: 'white',
                          border: 'none'
                        }}
                      >
                        {position.platformName}
                      </Badge>
                    )
                  )}
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
          disabled={isProcessing}
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

      {/* Progress Modal for Multiple Position Transfers */}
      <TransactionProgressModal
        show={showTransactionModal}
        steps={transactionSteps}
        currentStep={currentTransactionStep}
        isLoading={transactionLoading}
        error={transactionError}
        warning={transactionWarning}
        onHide={handleCloseTransactionModal}
        onCancel={handleCloseTransactionModal}
        title="Position Management"
      />
    </Modal>

    <StrategyValidationModal
      show={showStrategyWarning}
      onHide={() => {
        setShowStrategyWarning(false);
        setStrategyWarnings([]);
      }}
      onConfirm={() => {
        setShowStrategyWarning(false);
        setStrategyWarnings([]);
        executeTransfer();
      }}
      warnings={strategyWarnings}
      title="Strategy Mismatch"
      prompt="Do you still want to transfer this position to the vault?"
      confirmLabel="Transfer Anyway"
    />
    </>
  );
}
