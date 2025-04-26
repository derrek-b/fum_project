// src/components/vaults/VaultCard.js
import React, { useState } from "react";
import { Card, Badge, Button, Spinner, OverlayTrigger, Tooltip, Dropdown } from "react-bootstrap";
import { useSelector } from "react-redux";
import { useRouter } from "next/router";
import * as LucideIcons from 'lucide-react';
import { getStrategyDetails } from 'fum_library/helpers/strategyHelpers';
import PositionSelectionModal from "./PositionSelectionModal";

export default function VaultCard({ vault }) {
  const router = useRouter();
  const { address } = useSelector((state) => state.wallet);
  const { activeStrategies, strategyPerformance } = useSelector((state) => state.strategies);

  // States for modals
  const [showAddPositionModal, setShowAddPositionModal] = useState(false);
  const [showRemovePositionModal, setShowRemovePositionModal] = useState(false);

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
  const handleCardClick = (e) => {
    // Don't navigate if clicking on the action button
    if (e.target.closest('.action-button-exclude')) {
      e.stopPropagation();
      return;
    }
    router.push(`/vault/${vault.address}`);
  };

  // Handle showing add position modal
  const handleShowAddPositionModal = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setShowAddPositionModal(true);
  };

  // Handle showing remove position modal
  const handleShowRemovePositionModal = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setShowRemovePositionModal(true);
  };

  // Get APY for display
  const getApy = () => {
    if (!strategyData || !strategyData.apy) return "—";
    return `${strategyData.apy.toFixed(2)}%`;
  };

  // Custom dropdown toggle for better styling
  const CustomToggle = React.forwardRef(({ children, onClick }, ref) => (
    <Button
      ref={ref}
      variant="outline-secondary"
      size="sm"
      onClick={(e) => {
        e.preventDefault();
        onClick(e);
      }}
      className="action-button-exclude"
    >
      {children}
    </Button>
  ));

  const poolsParam = useSelector((state) => state.pools)
  const tokensParam = useSelector((state) => state.tokens)
  const { chainId } = useSelector((state) => state.wallet)

  return (
    <>
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
            <Dropdown className="action-button-exclude">
              <Dropdown.Toggle as={CustomToggle} id={`vault-actions-${vault.address}`}>
                Actions
              </Dropdown.Toggle>
              <Dropdown.Menu align="end">
                <Dropdown.Item onClick={handleShowAddPositionModal}>
                  Add Position
                </Dropdown.Item>
                <Dropdown.Item onClick={handleShowRemovePositionModal}>
                  Remove Position
                </Dropdown.Item>
                <Dropdown.Item disabled>Close Vault</Dropdown.Item>
                <Dropdown.Item disabled>Manage Strategy</Dropdown.Item>
              </Dropdown.Menu>
            </Dropdown>
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
                ) : ((metrics.tvl !== undefined && metrics.tvl !== null) ||
                    (metrics.tokenTVL !== undefined && metrics.tokenTVL !== null)) ? (
                  <>
                    ${((metrics.tvl || 0) + (metrics.tokenTVL || 0)).toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2
                    })}
                    {metrics.hasPartialData && (
                      <OverlayTrigger
                        placement="top"
                        overlay={<Tooltip>Some data is missing or incomplete. Total value may be underestimated.</Tooltip>}
                      >
                        <span className="text-warning ms-1" style={{ cursor: "help" }}>⚠️</span>
                      </OverlayTrigger>
                    )}
                    {metrics.lastTVLUpdate && (
                      <OverlayTrigger
                        placement="top"
                        overlay={
                          <Tooltip>
                            <div>Last updated: {new Date(metrics.lastTVLUpdate).toLocaleString()}</div>
                            <div>Position TVL: ${(metrics.tvl || 0).toLocaleString(undefined, {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2
                            })}</div>
                            <div>Token TVL: ${(metrics.tokenTVL || 0).toLocaleString(undefined, {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2
                            })}</div>
                          </Tooltip>
                        }
                      >
                        <small className="ms-1 text-muted" style={{ cursor: "help", fontSize: "0.7rem" }}>ⓘ</small>
                      </OverlayTrigger>
                    )}
                  </>
                ) : (
                  <OverlayTrigger
                    placement="top"
                    overlay={<Tooltip>Could not calculate TVL. Token prices may be unavailable.</Tooltip>}
                  >
                    <span className="text-danger">N/A</span>
                  </OverlayTrigger>
                )}
              </div>
            </div>
          </div>

          <div className="d-flex justify-content-between align-items-center">

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

      {/* The modals will be created separately */}
      {showAddPositionModal && (
        <PositionSelectionModal
          show={showAddPositionModal}
          onHide={() => setShowAddPositionModal(false)}
          vault={vault}
          pools={poolsParam}
          tokens={tokensParam}
          chainId={chainId}
          mode="add"
        />
      )}

      {showRemovePositionModal && (
        <PositionSelectionModal
          show={showRemovePositionModal}
          onHide={() => setShowRemovePositionModal(false)}
          vault={vault}
          pools={poolsParam}
          tokens={tokensParam}
          chainId={chainId}
          mode="remove"
        />
      )}
    </>
  );
}
