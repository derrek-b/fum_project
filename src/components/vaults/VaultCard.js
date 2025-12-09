// src/components/vaults/VaultCard.js
import React from "react";
import { Card, Badge, Spinner, OverlayTrigger, Tooltip } from "react-bootstrap";
import { useSelector } from "react-redux";
import { useRouter } from "next/router";
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { getStrategyDetails } from 'fum_library/helpers/strategyHelpers';
import { getStrategyIcon } from '../../utils/strategyIcons';
import { calculateVaultAPY } from '../../utils/vaultsHelpers';

export default function VaultCard({ vault }) {
  const router = useRouter();
  const { activeStrategies, strategyPerformance } = useSelector((state) => state.strategies);
  const allPositions = useSelector((state) => state.positions.positions);
  const pools = useSelector((state) => state.pools);
  const automationConnected = useSelector((state) => state.automation?.connected);

  // Check if automation is enabled
  const isAutomationEnabled = vault.executor &&
    vault.executor !== "0x0000000000000000000000000000000000000000";

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
      className="mb-4 animate-fade-in card-clickable"
      style={{
        cursor: "pointer",
        position: "relative",
        background: vault.isBlacklisted
          ? 'rgba(254, 242, 242, 0.95)'
          : vault.isRetrying
            ? 'rgba(255, 251, 235, 0.95)'
            : 'rgba(245, 245, 245, 0.95)',
        borderColor: vault.isBlacklisted
          ? '#dc3545'
          : vault.isRetrying
            ? '#f59e0b'
            : isAutomationEnabled
              ? 'rgba(16, 185, 129, 0.5)'
              : 'rgba(0, 0, 0, 0.1)',
        borderWidth: vault.isBlacklisted || vault.isRetrying ? '2px' : '1px'
      }}
      onClick={handleCardClick}
    >
      <Card.Body style={{ paddingTop: 'var(--space-xl)', paddingBottom: 'var(--space-xl)' }}>
        <div className="d-flex justify-content-between align-items-center">
          <Card.Title className="d-flex align-items-center mb-0" style={{ fontSize: '1.5rem' }}>
            {vault.name}
            {(() => {
              // Check if there's a strategy configured in the vault data
              const hasConfiguredStrategy = vault.strategy?.strategyId;

              if (vault.strategy?.isActive && hasConfiguredStrategy) {
                // Active strategy case
                const strategyDetails = getStrategyDetails(vault.strategy?.strategyId);
                const IconComponent = strategyDetails?.icon ? getStrategyIcon(strategyDetails.icon) : null;

                return (
                  <>
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
                        padding: '0.2em 0.6em',
                        fontSize: '0.75rem',
                      }}
                    >
                      {IconComponent && <IconComponent size={12} className="me-1" />}
                      {strategyDetails?.name || vaultStrategy.strategyId || "Unknown"}
                    </Badge>

                    {/* Automation indicator - only show if enabled AND not blacklisted AND not retrying AND service connected */}
                    {isAutomationEnabled && !vault.isBlacklisted && !vault.isRetrying && automationConnected && (
                      <div className="ms-2 d-inline-flex align-items-center">
                        {/* Pulsing green dot */}
                        <div
                          style={{
                            width: '12px',
                            height: '12px',
                            borderRadius: '50%',
                            backgroundColor: '#28a745',
                            animation: 'pulse 2s ease-in-out infinite'
                          }}
                        />
                        <style jsx>{`
                          @keyframes pulse {
                            0%, 100% { opacity: 1; transform: scale(1); }
                            50% { opacity: 0.4; transform: scale(0.8); }
                          }
                        `}</style>
                      </div>
                    )}
                  </>
                );
              } else {
                // "Not Configured" case - use the "none" strategy settings
                const noneStrategy = getStrategyDetails("none");
                const NoneIcon = noneStrategy?.icon ? getStrategyIcon(noneStrategy.icon) : null;

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
                      padding: '0.2em 0.6em',
                      fontSize: '0.75rem',
                    }}
                  >
                    {NoneIcon && <NoneIcon size={12} className="me-1" />}
                    {"No Strategy"}
                  </Badge>
                );
              }
            })()}
          </Card.Title>

          {/* TVL in top right */}
          <div style={{ fontSize: '1.5rem', fontWeight: '600', textAlign: 'right' }}>
            {metrics?.loading ? (
              <Spinner animation="border" size="sm" />
            ) : totalTVL !== null ? (
              <>
                <span className="text-crimson">
                  ${totalTVL.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2
                  })}
                </span>
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
                  <small className="ms-1 text-muted" style={{ cursor: "help", fontSize: "0.7rem", position: "relative", top: "-0.2rem" }}>ⓘ</small>
                </OverlayTrigger>
              </>
            ) : (
              <span className="text-danger">Error</span>
            )}
          </div>
        </div>

        {/* Vault Address and APY */}
        <div className="mb-3 mt-0 d-flex justify-content-between align-items-center">
          <code style={{ fontSize: '0.875rem', padding: 0, margin: 0 }}>
            {vault.address.substring(0, 10)}...{vault.address.substring(vault.address.length - 8)}
          </code>
          {(() => {
            const apyData = calculateVaultAPY(vault.trackerMetadata);
            if (!apyData) return null;
            const isNegative = apyData.apy < 0;
            return (
              <span style={{ fontSize: '0.875rem', color: '#3a3a3a' }}>
                APY: <span style={{ color: isNegative ? '#ef4444' : '#10b981' }}>
                  {isNegative ? '' : '+'}{apyData.apyPercent.toFixed(2)}%
                </span>
              </span>
            );
          })()}
        </div>

        {/* Asset Balances */}
        <div className="mt-4 pt-3" style={{ borderTop: '1px solid rgba(0, 0, 0, 0.1)' }}>
          <div className="row g-3">
            {/* Token Balances */}
            <div className="col-6">
              <small className="d-block mb-2" style={{ fontSize: '0.875rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#0a0a0a', fontWeight: '700' }}>
                Tokens
              </small>
              {vault.tokenBalances && Object.keys(vault.tokenBalances).length > 0 ? (
                <div style={{ fontSize: '0.8125rem', color: '#0a0a0a', paddingLeft: '0.7rem' }}>
                  {Object.keys(vault.tokenBalances).slice(0, 3).map((tokenKey) => {
                    const token = vault.tokenBalances[tokenKey];
                    return (
                      <div key={token.symbol} className="mb-1">
                        <strong style={{ color: 'var(--crimson-700)' }}>{token.symbol}:</strong> {token.numericalBalance.toFixed(2)}
                      </div>
                    );
                  })}
                  {Object.keys(vault.tokenBalances).length > 3 && (
                    <div className="text-muted" style={{ fontSize: '0.75rem' }}>
                      +{Object.keys(vault.tokenBalances).length - 3} more
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ fontSize: '0.8125rem', color: '#525252', paddingLeft: '0.7rem' }}>None</div>
              )}
            </div>

            {/* Positions */}
            <div className="col-6">
              <small className="d-block mb-2" style={{ fontSize: '0.875rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#0a0a0a', fontWeight: '700' }}>
                Positions
              </small>
              {vault.positions && vault.positions.length > 0 ? (
                <div style={{ fontSize: '0.8125rem', color: '#0a0a0a', paddingLeft: '0.7rem' }}>
                  {vault.positions.slice(0, 3).map((positionId) => {
                    const position = allPositions.find(p => p.id === positionId);
                    if (!position) return null;

                    const poolData = pools[position.pool];
                    const token0Symbol = poolData?.token0?.symbol || 'T0';
                    const token1Symbol = poolData?.token1?.symbol || 'T1';

                    return (
                      <div key={positionId} className="mb-1">
                        <strong style={{ color: 'var(--crimson-700)' }}>#{positionId}:</strong> {token0Symbol}/{token1Symbol}
                      </div>
                    );
                  })}
                  {vault.positions.length > 3 && (
                    <div className="text-muted" style={{ fontSize: '0.75rem' }}>
                      +{vault.positions.length - 3} more
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ fontSize: '0.8125rem', color: '#525252', paddingLeft: '0.7rem' }}>None</div>
              )}
            </div>
          </div>
        </div>

        {/* Blacklist Warning Banner */}
        {vault.isBlacklisted && (
          <div
            className="mt-3 d-flex align-items-center justify-content-center"
            style={{
              backgroundColor: '#dc3545',
              color: '#ffffff',
              padding: '0.75rem 1rem',
              marginLeft: 'calc(-1 * var(--space-xl))',
              marginRight: 'calc(-1 * var(--space-xl))',
              marginBottom: 'calc(-1 * var(--space-xl))',
              borderBottomLeftRadius: 'calc(var(--bs-card-border-radius) - 1px)',
              borderBottomRightRadius: 'calc(var(--bs-card-border-radius) - 1px)',
              fontWeight: '600',
              fontSize: '0.9rem'
            }}
          >
            <AlertTriangle size={18} className="me-2" />
            BLACKLISTED - Automation Disabled
          </div>
        )}

        {/* Retry Warning Banner - show when retrying but not blacklisted */}
        {vault.isRetrying && !vault.isBlacklisted && (
          <div
            className="mt-3 d-flex align-items-center justify-content-center"
            style={{
              backgroundColor: '#f59e0b',
              color: '#ffffff',
              padding: '0.75rem 1rem',
              marginLeft: 'calc(-1 * var(--space-xl))',
              marginRight: 'calc(-1 * var(--space-xl))',
              marginBottom: 'calc(-1 * var(--space-xl))',
              borderBottomLeftRadius: 'calc(var(--bs-card-border-radius) - 1px)',
              borderBottomRightRadius: 'calc(var(--bs-card-border-radius) - 1px)',
              fontWeight: '600',
              fontSize: '0.9rem'
            }}
          >
            <RefreshCw size={18} className="me-2" style={{ animation: 'spin 2s linear infinite' }} />
            RETRYING - Automation Having Issues
            <style jsx>{`
              @keyframes spin {
                from { transform: rotate(0deg); }
                to { transform: rotate(360deg); }
              }
            `}</style>
          </div>
        )}
      </Card.Body>
    </Card>
  );
}
