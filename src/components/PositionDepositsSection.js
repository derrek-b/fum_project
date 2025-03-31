// src/components/PositionDepositsSection.js
import React from 'react';
import { useSelector } from 'react-redux';
import { Card, Form, Alert, Badge, Spinner } from 'react-bootstrap';
import Image from 'next/image';
import config from '../utils/config';

/**
 * Component for selecting positions to transfer to a vault
 */
const PositionDepositsSection = ({
  selectedPositions,
  setSelectedPositions,
  useStrategy,
  strategyId
}) => {
  // Get available positions
  const { positions, isLoading } = useSelector((state) => state.positions);

  // Filter positions based on strategy
  const getFilteredPositions = () => {
    // Filter positions not already in vaults
    let filteredPositions = positions.filter(p => !p.inVault);

    // If using strategy, apply additional filters
    if (useStrategy && strategyId) {
      const strategy = useSelector((state) => state.strategies.availableStrategies[strategyId]);

      // Filter by supported tokens if needed
      if (strategy?.supportedTokens) {
        const supportedSymbols = Object.keys(strategy.supportedTokens);

        filteredPositions = filteredPositions.filter(position => {
          const [token0, token1] = position.tokenPair.split('/');
          return supportedSymbols.includes(token0) && supportedSymbols.includes(token1);
        });
      }

      // Filter by supported platforms if needed
      if (strategy?.supportedPlatforms) {
        filteredPositions = filteredPositions.filter(position =>
          strategy.supportedPlatforms.includes(position.platform)
        );
      }
    }

    return filteredPositions;
  };

  const availablePositions = getFilteredPositions();

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

  // Get platform badge/icon for position
  const renderPlatformBadge = (position) => {
    if (!position.platform) return null;

    const platformMeta = config.platformMetadata[position.platform];

    if (platformMeta?.logo) {
      return (
        <div className="ms-2 d-inline-flex align-items-center justify-content-center" style={{ height: '20px', width: '20px' }}>
          <Image
            src={platformMeta.logo}
            alt={position.platformName || position.platform}
            width={20}
            height={20}
            title={position.platformName || position.platform}
          />
        </div>
      );
    } else {
      return (
        <Badge
          className="ms-2"
          pill
          bg=""
          style={{
            fontSize: '0.75rem',
            backgroundColor: platformMeta?.color || '#6c757d',
            padding: '0.25em 0.5em',
            color: 'white',
            border: 'none'
          }}
        >
          {position.platformName || position.platform}
        </Badge>
      );
    }
  };

  return (
    <Card>
      <Card.Header>
        <h5 className="mb-0">Position Transfers</h5>
      </Card.Header>
      <Card.Body>
        {isLoading ? (
          <div className="text-center py-4">
            <Spinner animation="border" />
            <p className="mt-2">Loading positions...</p>
          </div>
        ) : availablePositions.length === 0 ? (
          <Alert variant="info">
            You don't have any available positions to add to this vault.
            {useStrategy && strategyId && (
              <span> Some positions may be filtered out due to strategy constraints.</span>
            )}
          </Alert>
        ) : (
          <>
            <p className="mb-3">Select positions to transfer to your vault:</p>

            <div
              className="position-list"
              style={{
                maxHeight: availablePositions.length > 5 ? '350px' : 'auto',
                overflowY: availablePositions.length > 5 ? 'auto' : 'visible'
              }}
            >
              {availablePositions.map(position => (
                <div key={position.id} className="position-item border rounded p-3 mb-2">
                  <Form.Check
                    type="checkbox"
                    id={`position-${position.id}`}
                    label={
                      <div>
                        <div className="d-flex align-items-center">
                          <strong>{position.tokenPair}</strong>
                          <Badge bg="secondary" className="ms-2">#{position.id}</Badge>
                          <Badge bg="info" className="ms-2">{position.fee / 10000}%</Badge>
                          {renderPlatformBadge(position)}
                        </div>
                      </div>
                    }
                    checked={selectedPositions.includes(position.id)}
                    onChange={() => handlePositionToggle(position.id)}
                  />
                </div>
              ))}
            </div>

            {selectedPositions.length > 0 && (
              <div className="mt-3 text-end">
                <small className="text-muted me-2">
                  {selectedPositions.length} position(s) selected
                </small>
              </div>
            )}
          </>
        )}
      </Card.Body>
    </Card>
  );
};

export default PositionDepositsSection;
