// src/components/vaults/VaultCard.js
import React from "react";
import { Card, Badge, Spinner, OverlayTrigger, Tooltip } from "react-bootstrap";
import { useSelector } from "react-redux";
import { useRouter } from "next/router";
import * as LucideIcons from 'lucide-react';
import { getStrategyDetails } from 'fum_library/helpers/strategyHelpers';

export default function VaultCard({ vault }) {
  const router = useRouter();
  const { activeStrategies, strategyPerformance } = useSelector((state) => state.strategies);

  // Get metrics from the vault object without fallbacks
  const metrics = vault.metrics;

  // Get position count directly from positions array
  const positionCount = vault.positions?.length;

  // Get strategy information directly
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
    if (!strategyData || strategyData.apy === undefined) {
      return null;
    }
    return `${strategyData.apy.toFixed(2)}%`;
  };

  // Calculate total TVL only if we have the data
  const hasPositionTvl = metrics && typeof metrics.tvl === 'number';
  const hasTokenTvl = metrics && typeof metrics.tokenTVL === 'number';

  // Only calculate total if we have at least one of the values
  const totalTVL = hasPositionTvl || hasTokenTvl ?
    (hasPositionTvl ? metrics.tvl : 0) + (hasTokenTvl ? metrics.tokenTVL : 0) :
    null;

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
          <Card.Title className="d-flex align-items-center">
            {vault.name}
            {(() => {
              // Check if there's a strategy configured in the vault data
              const hasConfiguredStrategy = vault.strategy?.strategyId;

              if (vault.strategy?.isActive && hasConfiguredStrategy) {
                // Active strategy case
                const strategyDetails = getStrategyDetails(vault.strategy?.strategyId);
                const IconComponent = strategyDetails?.icon ? LucideIcons[strategyDetails.icon] : null;

                return (
                  <Badge
                    pill
                    bg=""
                    className="ms-2 d-inline-flex align-items-center"
                    style={{
                      backgroundColor: strategyDetails?.color || "#6c757d",
                      borderColor: strategyDetails?.borderColor || strategyDetails?.color || "#6c757d",
                      borderWidth: "1px",
                      borderStyle: "solid",
                      color: strategyDetails?.textColor || "#FFFFFF",
                      padding: '0.25em 0.8em',
                    }}
                  >
                    {IconComponent && <IconComponent size={14} className="me-1" />}
                    {strategyDetails?.name || vaultStrategy.strategyId || "Unknown"}
                  </Badge>
                );
              } else {
                // "Not Configured" case - use the "none" strategy settings
                const noneStrategy = getStrategyDetails("none");
                const NoneIcon = noneStrategy?.icon ? LucideIcons[noneStrategy.icon] : null;

                return (
                  <Badge
                    pill
                    bg=""
                    className="ms-2 d-inline-flex align-items-center"
                    style={{
                      backgroundColor: noneStrategy?.color || "#6c757d",
                      borderColor: noneStrategy?.borderColor || "#6c757d",
                      borderWidth: "1px",
                      borderStyle: "solid",
                      color: noneStrategy?.textColor || "#FFFFFF",
                      padding: '0.25em 0.8em',
                    }}
                  >
                    {NoneIcon && <NoneIcon size={14} className="me-1" />}
                    {"Not Configured"}
                  </Badge>
                );
              }
            })()}
          </Card.Title>
        </div>

        <div className="d-flex justify-content-between mb-3">
          <div>
            <small className="text-muted">Created</small>
            <div>{formattedDate}</div>
          </div>
          <div>
            <small className="text-muted">Positions</small>
            <div className="text-center">
              {positionCount !== undefined ? positionCount : (
                <span className="text-danger">Error</span>
              )}
            </div>
          </div>
          <div>
            <small className="text-muted">TVL</small>
            <div className="text-end">
              {metrics?.loading ? (
                <Spinner animation="border" size="sm" />
              ) : totalTVL !== null ? (
                <>
                  ${totalTVL.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2
                  })}
                  {metrics?.hasPartialData && (
                    <OverlayTrigger
                      placement="top"
                      overlay={<Tooltip>Some data is missing or incomplete. Total value may be underestimated.</Tooltip>}
                    >
                      <span className="text-warning ms-1" style={{ cursor: "help" }}>⚠️</span>
                    </OverlayTrigger>
                  )}
                  <OverlayTrigger
                    placement="top"
                    overlay={
                      <Tooltip>
                        <div>Last updated: {metrics?.lastTVLUpdate ? new Date(metrics.lastTVLUpdate).toLocaleString() : 'N/A'}</div>
                        <div>Position TVL: {typeof metrics?.tvl === 'number' ?
                          `${metrics.tvl.toLocaleString(undefined, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2
                          })}` : 'N/A'}</div>
                        <div>Token TVL: {typeof metrics?.tokenTVL === 'number' ?
                          `${metrics.tokenTVL.toLocaleString(undefined, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2
                          })}` : 'N/A'}</div>
                      </Tooltip>
                    }
                  >
                    <small className="ms-1 text-muted" style={{ cursor: "help", fontSize: "0.7rem" }}>ⓘ</small>
                  </OverlayTrigger>
                </>
              ) : (
                <span className="text-danger">Error</span>
              )}
            </div>
          </div>
        </div>

        <div className="d-flex justify-content-between align-items-center">
          <div>
            <small className="text-muted d-block text-end">APY</small>
            <div className="text-end">
              <span className="text-secondary">—</span>
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
