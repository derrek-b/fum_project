// src/components/VaultCard.js
import React from "react";
import { Card, Badge, Button, Spinner, OverlayTrigger, Tooltip } from "react-bootstrap";
import { useSelector } from "react-redux";
import { useRouter } from "next/router";

export default function VaultCard({ vault }) {
  const router = useRouter();
  const { address } = useSelector((state) => state.wallet);
  const { activeStrategies, strategyPerformance } = useSelector((state) => state.strategies);

  // Use metrics directly from the vault object
  const metrics = vault.metrics || { tvl: 0, positionCount: 0 };

  // Get position count from the vault's positions array
  const positionCount = vault.positions ? vault.positions.length : 0;

  // Get strategy information for this vault
  const vaultStrategy = activeStrategies?.[vault.address];
  const strategyData = vaultStrategy ? strategyPerformance?.[vault.address] : null;

  // Format the creation time
  const formattedDate = new Date(vault.creationTime * 1000).toLocaleDateString();

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
            <div className="text-center">{positionCount}</div>
          </div>
          <div>
            <small className="text-muted">TVL</small>
            <div className="text-end">
              {metrics.loading ? (
                <Spinner animation="border" size="sm" />
              ) : metrics.errorMessage ? (
                <span className="text-danger">Error</span>
              ) : metrics.tvl !== undefined ? (
                `${metrics.tvl.toFixed(2)}`
              ) : (
                <span className="text-danger">N/A</span>
              )}
              {metrics.hasPartialData && (
                <OverlayTrigger
                  placement="top"
                  overlay={<Tooltip>
                    {metrics.errorMessage || "Some position data or price information is missing or incomplete"}
                  </Tooltip>}
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
