// src/components/VaultCard.js
import React, { useState, useEffect, useRef } from "react";
import { Card, Badge, Button, Spinner, OverlayTrigger, Tooltip } from "react-bootstrap";
import { useSelector, useDispatch } from "react-redux";
import { useRouter } from "next/router";
import { useToast } from "../context/ToastContext";
import { updateVaultMetrics } from "../redux/vaultsSlice";

export default function VaultCard({ vault }) {
  const router = useRouter();
  const dispatch = useDispatch();
  const { showError } = useToast();
  const { address } = useSelector((state) => state.wallet);
  const { positions } = useSelector((state) => state.positions);
  const { vaultMetrics } = useSelector((state) => state.vaults);
  const { activeStrategies, strategyPerformance } = useSelector((state) => state.strategies);

  // Get metrics for this vault
  const metrics = vaultMetrics[vault.address] || { tvl: 0, positionCount: 0 };

  // Filter positions that are in this vault
  const vaultPositions = positions.filter(p => p.inVault && p.vaultAddress === vault.address);

  // Get strategy information for this vault
  const vaultStrategy = activeStrategies?.[vault.address];
  const strategyData = vaultStrategy ? strategyPerformance?.[vault.address] : null;

  // Format the creation time
  const formattedDate = new Date(vault.creationTime * 1000).toLocaleDateString();

  // Calculate total value locked in the vault
  const [calculatingTVL, setCalculatingTVL] = useState(false);

  // Get token prices from the store
  const { tokenPrices } = useSelector((state) => state.tokens);
  const { poolData } = useSelector((state) => state.pools);

  // Calculate total value locked
  useEffect(() => {
    const calculateVaultTVL = async () => {
      // Don't recalculate if already calculating
      if (calculatingTVL) return;

      setCalculatingTVL(true);

      try {
        // Real TVL calculation using position data from the store
        let totalTVL = 0;
        let hasError = false;

        // Iterate through vault positions to calculate TVL
        for (const position of vaultPositions) {
          try {
            // Get position-related data
            const pool = poolData[position.poolAddress];

            if (!pool || !pool.token0 || !pool.token1) {
              console.error(`Missing pool data for position ${position.id}`);
              continue;
            }

            // Get token data for this position
            const token0Price = tokenPrices[pool.token0];
            const token1Price = tokenPrices[pool.token1];

            if (!token0Price || !token1Price) {
              console.error(`Missing price data for tokens in position ${position.id}`);
              continue;
            }

            // Get token amounts for position (would use proper SDK calculations in production)
            const token0Amount = parseFloat(position.amount0 || 0);
            const token1Amount = parseFloat(position.amount1 || 0);

            // Calculate value in USD
            const value0USD = token0Amount * token0Price;
            const value1USD = token1Amount * token1Price;
            const positionValue = value0USD + value1USD;

            // Add to total
            totalTVL += isNaN(positionValue) ? 0 : positionValue;
          } catch (positionError) {
            console.error(`Error calculating value for position ${position.id}:`, positionError);
            hasError = true;
            continue;
          }
        }

        // Only dispatch update if we have valid TVL
        if (!hasError || totalTVL > 0) {
          dispatch(updateVaultMetrics({
            vaultAddress: vault.address,
            metrics: {
              tvl: totalTVL,
              positionCount: vaultPositions.length,
              lastCalculated: Date.now(),
              hasPartialData: hasError
            }
          }));
        }
      } catch (error) {
        console.error(`Error calculating TVL for vault ${vault.address}:`, error);
        // Don't update metrics with invalid data
      } finally {
        setCalculatingTVL(false);
      }
    };

    // Only calculate TVL if we have positions and required data
    if (vaultPositions.length > 0 && tokenPrices && poolData) {
      calculateVaultTVL();
    }
  }, [vault.address, vaultPositions, dispatch, tokenPrices, poolData, calculatingTVL]);

  // Handle card click to navigate to detail page
  const handleCardClick = () => {
    router.push(`/vault/${vault.address}`);
  };

  // Get APY for display
  const getApy = () => {
    if (!strategyData || !strategyData.apy) return "—";
    return `${strategyData.apy.toFixed(2)}%`;
  };

  return (
    <Card
      className="mb-3"
      style={{
        cursor: "pointer",
        borderColor: vaultStrategy?.isActive ? '#28a745' : '#dee2e6',
        boxShadow: vaultStrategy?.isActive
          ? '0 0 0 1px rgba(40, 167, 69, 0.2)'
          : '0 0 0 1px rgba(0, 0, 0, 0.05)'
      }}
      onClick={handleCardClick}
    >
      <Card.Body>
        <div className="d-flex justify-content-between align-items-center mb-2">
          <Card.Title>
            {vault.name}
            {vault.owner === address && (
              <Badge bg="secondary" className="ms-2" pill>Owner</Badge>
            )}
          </Card.Title>
          <Badge
            bg={vaultStrategy?.isActive ? "success" : "secondary"}
            className="text-white"
          >
            {vaultStrategy?.isActive ? "Active Strategy" : "No Strategy"}
          </Badge>
        </div>

        <div className="d-flex justify-content-between mb-3">
          <div>
            <small className="text-muted">Created</small>
            <div>{formattedDate}</div>
          </div>
          <div>
            <small className="text-muted">Positions</small>
            <div className="text-center">{vaultPositions.length}</div>
          </div>
          <div>
            <small className="text-muted">TVL</small>
            <div className="text-end">
              {calculatingTVL ? (
                <Spinner animation="border" size="sm" />
              ) : metrics.tvl !== undefined ? (
                `${metrics.tvl.toFixed(2)}`
              ) : (
                <span className="text-danger">N/A</span>
              )}
              {metrics.hasPartialData && (
                <OverlayTrigger
                  placement="top"
                  overlay={<Tooltip>Some position data is missing or incomplete</Tooltip>}
                >
                  <span className="text-warning ms-1" style={{ cursor: "help" }}>⚠️</span>
                </OverlayTrigger>
              )}
            </div>
          </div>
        </div>

        <div className="d-flex justify-content-between align-items-center">
          <div>
            <small className="text-muted d-block">Strategy</small>
            {vaultStrategy?.isActive ? (
              <Badge bg="light" text="success">The Fed</Badge>
            ) : (
              <Badge bg="light" text="secondary">Not Configured</Badge>
            )}
          </div>

          <div>
            <small className="text-muted d-block text-end">APY</small>
            <div className="text-end">
              {vaultStrategy?.isActive ? getApy() : "—"}
            </div>
          </div>
        </div>

        <Card.Text className="mt-3 mb-0">
          <small className="text-muted">
            {vault.address.substring(0, 6)}...{vault.address.substring(vault.address.length - 4)}
          </small>
        </Card.Text>
      </Card.Body>
    </Card>
  );
}
