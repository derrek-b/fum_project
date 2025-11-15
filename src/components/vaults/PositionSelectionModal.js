// src/components/PositionSelectionModal.js
import React, { useState, useEffect, useMemo } from "react";
import { Modal, Button, Form, Spinner, Alert, ListGroup, Badge } from "react-bootstrap";
import Image from "next/image";
import { useSelector, useDispatch } from "react-redux";
import { useToast } from "../../context/ToastContext";
import { useProvider } from '../../contexts/ProviderContext';
import { platforms } from 'fum_library/configs';
import { triggerUpdate } from "../../redux/updateSlice";
import { setPositionVaultStatus } from "../../redux/positionsSlice";
import { addPositionToVault, removePositionFromVault } from "../../redux/vaultsSlice";
import { lookupPlatformById } from 'fum_library/helpers/platformHelpers';
import { getVaultContract } from 'fum_library/blockchain/contracts';
import { ethers } from "ethers";
import StrategyTransactionModal from './StrategyTransactionModal';

export default function PositionSelectionModal({
  show,
  onHide,
  vault,
  pools,
  tokens,
  chainId,
  mode // 'add' or 'remove'
}) {
  const { showSuccess, showError } = useToast();
  const dispatch = useDispatch();

  // Get data from Redux store
  const { positions } = useSelector((state) => state.positions);
  //const { provider } = useSelector((state) => state.wallet.provider);
  const { address } = useSelector((state) => state.wallet);
  const { provider } = useProvider();
  // const { pools = {} } = useSelector((state) => state.pools);
  // const { tokens = {} } = useSelector((state) => state.tokens);

  // State for selected positions
  const [selectedPositions, setSelectedPositions] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);

  // State for progress modal
  const [transactionSteps, setTransactionSteps] = useState([]);
  const [currentTransactionStep, setCurrentTransactionStep] = useState(0);
  const [transactionLoading, setTransactionLoading] = useState(false);
  const [transactionError, setTransactionError] = useState("");
  const [transactionWarning, setTransactionWarning] = useState("");
  const [showTransactionModal, setShowTransactionModal] = useState(false);

  // Check if we have the necessary data
  const poolsLoaded = Object.keys(pools).length > 0;
  const tokensLoaded = Object.keys(tokens).length > 0;

  // Debug logs
  useEffect(() => {
    if (show) {
      // Log some position details to help debug
      const directWalletPositions = positions.filter(p => !p.inVault);
      const vaultPositions = positions.filter(p => p.inVault && p.vaultAddress === vault.address);

      // Check for pool addresses
      const uniquePoolAddresses = new Set();
      positions.forEach(pos => {
        if (pos.poolAddress) uniquePoolAddresses.add(pos.poolAddress);
      });

      // Check which pools are missing
      const missingPools = Array.from(uniquePoolAddresses).filter(addr => !pools[addr]);
      if (missingPools.length > 0) {
        console.warn(`- Missing ${missingPools.length} pools in the store`);
        console.warn(`- First missing pool: ${missingPools[0]}`);
      }
    }
  }, [show, positions, tokens, vault.address, poolsLoaded, tokensLoaded]);

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

  // Reset selection when modal opens/closes or mode changes
  useEffect(() => {
    // Reset selections when modal opens or mode changes
    if (show) {
      setSelectedPositions([]);
    }
  }, [show, mode]);

  // Log the state of pools and tokens when they change
  useEffect(() => {
    if (show) {
      // Check if any positions have pool addresses that don't exist in pools
      const missingPools = positions
        .filter(p => p.poolAddress && !pools[p.poolAddress])
        .map(p => ({ id: p.id, poolAddress: p.poolAddress }));

      if (missingPools.length > 0) {
        console.warn('Positions with missing pool data:', missingPools);
      }
    }
  }, [show, tokens, positions]);

  // Handle position toggle
  const handlePositionToggle = (positionId) => {
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
      const feeTier = position.fee ? `${position.fee / 10000}%` : 'Unknown fee';

      return {
        title: `Transfer Position #${positionId}`,
        description: `${tokenPair} - ${feeTier}`
      };
    });
  };

  // Handle position action (add or remove)
  const handleConfirm = async () => {
    if (selectedPositions.length === 0) {
      showError("Please select at least one position");
      return;
    }

    // Conditional logic: single position = toast flow, multiple = progress modal flow
    if (selectedPositions.length === 1) {
      // Path A: Single position - simple toast-based flow
      setIsProcessing(true);

      try {
        const positionId = selectedPositions[0];
        const signer = await provider.getSigner();

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
          // Remove: Call vault's withdrawPosition method
          const vaultContract = getVaultContract(vault.address, provider);
          const vaultWithSigner = vaultContract.connect(signer);
          tx = await vaultWithSigner.withdrawPosition(
            platformInfo.positionManagerAddress,
            positionId,
            address
          );
        }

        await tx.wait();

        // Update Redux store based on mode
        if (mode === 'add') {
          dispatch(setPositionVaultStatus({
            positionId,
            inVault: true,
            vaultAddress: vault.address
          }));
          dispatch(addPositionToVault({
            vaultAddress: vault.address,
            positionId
          }));
          showSuccess(`Successfully added position #${positionId} to vault`);
        } else {
          dispatch(setPositionVaultStatus({
            positionId,
            inVault: false,
            vaultAddress: null
          }));
          dispatch(removePositionFromVault({
            vaultAddress: vault.address,
            positionId
          }));
          showSuccess(`Successfully removed position #${positionId} from vault`);
        }
        dispatch(triggerUpdate(Date.now()));
        onHide();
      } catch (error) {
        // Check if user cancelled the transaction
        if (error.code === 'ACTION_REJECTED' || error.code === 4001 || error.message?.includes('user rejected')) {
          // User cancelled - silently ignore
          return;
        }

        // Real error - log and show user-friendly message
        const action = mode === 'add' ? 'adding position to' : 'removing position from';
        console.error(`Error ${action} vault:`, error);
        const errorDetail = error.reason || error.message || "Unknown error";
        showError(`Failed to ${mode} position: ${errorDetail}`);
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
        const signer = await provider.getSigner();

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
              // Remove: Call vault's withdrawPosition method
              const vaultContract = getVaultContract(vault.address, provider);
              const vaultWithSigner = vaultContract.connect(signer);
              tx = await vaultWithSigner.withdrawPosition(
                platformInfo.positionManagerAddress,
                positionId,
                address
              );
            }

            await tx.wait();

            // Update Redux store based on mode
            if (mode === 'add') {
              dispatch(setPositionVaultStatus({
                positionId,
                inVault: true,
                vaultAddress: vault.address
              }));
              dispatch(addPositionToVault({
                vaultAddress: vault.address,
                positionId
              }));
            } else {
              dispatch(setPositionVaultStatus({
                positionId,
                inVault: false,
                vaultAddress: null
              }));
              dispatch(removePositionFromVault({
                vaultAddress: vault.address,
                positionId
              }));
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
        dispatch(triggerUpdate(Date.now()));
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

    // Trigger data refresh
    dispatch(triggerUpdate(Date.now()));

    // Close the parent modal
    onHide();
  };

  // Get position details for display
  const getPositionDetails = (position) => {
    // Use position's tokenPair
    const tokenPair = position.tokenPair;

    // Fee tier from position
    const feeTier = `${position.fee / 10000}%`;

    // Get the platform color directly from config
    const platformColor = position.protocol && platforms[position.protocol]?.color
                         ? platforms[position.protocol].color
                         : '#6c757d';

    return { pair: tokenPair, feeTier, platformColor };
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

        {Object.keys(pools).length === 0 && (
          <Alert variant="warning">
            Loading pool data... Position details may be limited until data is loaded.
          </Alert>
        )}

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
              const details =  getPositionDetails(position);

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
                  {/* Conditional display of either logo or badge */}
                  {position.protocol && (
                    platforms[position.protocol]?.logo ? (
                      // Show logo if available
                      <div
                        className="ms-2 d-inline-flex align-items-center justify-content-center"
                        style={{
                          height: '20px',
                          width: '20px'
                        }}
                      >
                        <Image
                          src={platforms[position.platform].logo}
                          alt={position.platformName || position.platform}
                          width={40}
                          height={40}
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

      {/* Progress Modal for Multiple Position Transfers */}
      <StrategyTransactionModal
        show={showTransactionModal}
        steps={transactionSteps}
        currentStep={currentTransactionStep}
        loading={transactionLoading}
        error={transactionError}
        warning={transactionWarning}
        onClose={handleCloseTransactionModal}
      />
    </Modal>
  );
}
