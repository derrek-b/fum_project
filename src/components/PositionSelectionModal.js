// src/components/PositionSelectionModal.js
import React, { useState, useEffect, useMemo } from "react";
import { Modal, Button, Form, Spinner, Alert, ListGroup, Badge } from "react-bootstrap";
import Image from "next/image";
import { useSelector, useDispatch } from "react-redux";
import { useToast } from "../context/ToastContext";
import config from "../utils/config";
import { AdapterFactory } from "@/adapters";

export default function PositionSelectionModal({
  show,
  onHide,
  vault,
  pools,
  tokens,
  chainId,
  mode // 'add' or 'remove'
}) {
  const { showError } = useToast();
  const dispatch = useDispatch();

  // Get data from Redux store
  const { positions } = useSelector((state) => state.positions);
  const { provider } = useSelector((state) => state.wallet.provider);
  // const { pools = {} } = useSelector((state) => state.pools);
  // const { tokens = {} } = useSelector((state) => state.tokens);

  // State for selected positions
  const [selectedPositions, setSelectedPositions] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);

  // Check if we have the necessary data
  const poolsLoaded = Object.keys(pools).length > 0;
  const tokensLoaded = Object.keys(tokens).length > 0;

  // Debug logs
  useEffect(() => {
    if (show) {
      console.log("Modal opened with data:");
      console.log(`- Total positions: ${positions.length}`);
      console.log(`- Pools loaded: ${poolsLoaded} (${Object.keys(pools).length} pools)`);
      console.log(`- Tokens loaded: ${tokensLoaded} (${Object.keys(tokens).length} tokens)`);

      // Log some position details to help debug
      const directWalletPositions = positions.filter(p => !p.inVault);
      const vaultPositions = positions.filter(p => p.inVault && p.vaultAddress === vault.address);

      console.log(`- Direct wallet positions: ${directWalletPositions.length}`);
      console.log(`- Positions in this vault: ${vaultPositions.length}`);

      // Check for pool addresses
      const uniquePoolAddresses = new Set();
      positions.forEach(pos => {
        if (pos.poolAddress) uniquePoolAddresses.add(pos.poolAddress);
      });
      console.log(`- Unique pool addresses in positions: ${uniquePoolAddresses.size}`);

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

  // Log the state of pools and tokens when they change
  useEffect(() => {
    if (show) {
      console.log(`Pools object available: ${!!pools}`);
      if (pools) {
        console.log(`Pool keys: ${Object.keys(pools).length}`);
      }

      console.log(`Tokens object available: ${!!tokens}`);
      if (tokens) {
        console.log(`Token keys: ${Object.keys(tokens).length}`);
      }

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
    // Use position's tokenPair
    const tokenPair = position.tokenPair;

    // Fee tier from position
    const feeTier = `${position.fee / 10000}%`;

    // Get the platform color directly from config
    const platformColor = position.platform && config.platformMetadata[position.platform]?.color
                         ? config.platformMetadata[position.platform].color
                         : '#6c757d';


    // // If pool data isn't in the store yet
    // if (!pools[position.poolAddress]) {
    //   console.log(`Pool not found for position ${position.id}, address: ${position.poolAddress}`);

    //   token0 = { raw: 0n, formatted: "N/A" },
    //   token1 = { raw: 0n, formatted: "N/A" }

    //   return { pair: tokenPair, feeTier, platformColor, token0, token1 };
    // } else {
    //   const adapter = AdapterFactory.getAdapter(position.platform, provider)
    //   const poolData = pools[position.poolAddress]

    //   const token0Full = tokens[poolData.token0]
    //   const token0Data = {
    //     address: token0Full.address,
    //     decimals: token0Full.decimals,
    //     symbol: token0Full.symbol,
    //     name: token0Full.name,
    //   }

    //   const token1Full = tokens[poolData.token1]
    //   const token1Data = {
    //     address: token1Full.address,
    //     decimals: token1Full.decimals,
    //     symbol: token1Full.symbol,
    //     name: token1Full.name,
    //   }

    //   const { token0, token1 } = await adapter.calculateTokenAmounts(position, poolData, token0Data, token1Data, chainId)
    // }

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
                  {position.platform && (
                    config.platformMetadata[position.platform]?.logo ? (
                      // Show logo if available
                      <div
                        className="ms-2 d-inline-flex align-items-center justify-content-center"
                        style={{
                          height: '20px',
                          width: '20px'
                        }}
                      >
                        <Image
                          src={config.platformMetadata[position.platform].logo}
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
    </Modal>
  );
}
