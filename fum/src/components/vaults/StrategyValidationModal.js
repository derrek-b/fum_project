// src/components/vaults/StrategyValidationModal.js
import React from 'react';
import { Modal, Button, Alert } from 'react-bootstrap';

/**
 * Modal to show validation warnings before strategy saves, token deposits, or position transfers.
 * Reusable across flows — title, prompt, and confirm label are customizable via props.
 */
const StrategyValidationModal = ({
  show,
  onHide,
  onConfirm,
  warnings = [],
  title = 'Review Strategy Configuration',
  prompt = 'Do you want to proceed with saving this strategy configuration?',
  confirmLabel = 'Continue to Save'
}) => {
  // Render a single warning object
  const renderWarning = (warning, index) => {
    if (warning.type === 'unmatchedTokens') {
      return (
        <div key={index} className="mb-4">
          <strong>Token Balance Mismatch ({warning.count} token{warning.count !== 1 ? 's' : ''})</strong>
          <p className="mb-2 mt-2">
            The vault holds balances for the following token{warning.count !== 1 ? 's' : ''} that {warning.count !== 1 ? 'are' : 'is'} not included in your strategy configuration:
          </p>
          <ul className="mb-2">
            {warning.items.map((tokenSymbol, idx) => (
              <li key={idx}>{tokenSymbol}</li>
            ))}
          </ul>
          <p className="mb-0">
            These tokens will be swapped into the strategy's target tokens when the strategy executes.
          </p>
        </div>
      );
    } else if (warning.type === 'unmatchedPositions') {
      return (
        <div key={index} className="mb-4">
          <strong>Position Token Mismatch ({warning.count} position{warning.count !== 1 ? 's' : ''})</strong>
          <p className="mb-2 mt-2">
            The vault has {warning.count} position{warning.count !== 1 ? 's' : ''} with tokens that {warning.count !== 1 ? 'are' : 'is'} not included in your strategy configuration:
          </p>
          <ul className="mb-2">
            {warning.items.map((position, idx) => (
              <li key={idx}>
                Position {position.id.slice(0, 8)}... ({position.tokenPair})
                <br />
                <span style={{ marginLeft: '1.5rem', fontSize: '0.9rem', color: 'var(--neutral-700)' }}>
                  Non-matching token{position.nonMatchingTokens.length !== 1 ? 's' : ''}: {position.nonMatchingTokens.join(', ')}
                </span>
              </li>
            ))}
          </ul>
          <p className="mb-0">
            {warning.count !== 1 ? 'These positions' : 'This position'} will be closed immediately and the tokens will be swapped into the strategy's target tokens.
          </p>
        </div>
      );
    } else if (warning.type === 'unmatchedPlatform') {
      return (
        <div key={index} className="mb-4">
          <strong>Platform Mismatch ({warning.count} position{warning.count !== 1 ? 's' : ''})</strong>
          <p className="mb-2 mt-2">
            {warning.count !== 1 ? 'These positions are' : 'This position is'} on a platform not targeted by the strategy:
          </p>
          <ul className="mb-2">
            {warning.items.map((position, idx) => (
              <li key={idx}>
                Position {position.id.slice(0, 8)}... ({position.tokenPair}) — <strong>{position.platformName}</strong>
                <br />
                <span style={{ marginLeft: '1.5rem', fontSize: '0.9rem', color: 'var(--neutral-700)' }}>
                  Strategy targets: {position.targetPlatformNames}
                </span>
              </li>
            ))}
          </ul>
          <p className="mb-0">
            {warning.count !== 1 ? 'These positions' : 'This position'} will be closed and tokens redeployed on the target platform.
          </p>
        </div>
      );
    }
    return null;
  };

  // Split warnings by severity
  const noPoolWarnings = warnings.filter(w => w.type === 'noPool');
  const noPoolSummary = warnings.find(w => w.type === 'noPoolSummary');
  const noticeWarnings = warnings.filter(w => w.type !== 'noPool' && w.type !== 'noPoolSummary');

  return (
    <Modal show={show} onHide={onHide} centered>
      <Modal.Header closeButton>
        <Modal.Title>{title}</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {warnings.length > 0 ? (
          <>
            {noPoolWarnings.length > 0 && (
              <Alert variant="danger">
                <Alert.Heading>Missing Pool{noPoolWarnings.length !== 1 ? 's' : ''}</Alert.Heading>
                <p className="mb-2">
                  The following token pair / platform combination{noPoolWarnings.length !== 1 ? 's have' : ' has'} no active pool:
                </p>
                <ul className="mb-3">
                  {noPoolWarnings.map((w, idx) => (
                    <li key={idx}>{w.reason}</li>
                  ))}
                </ul>
                <hr />
                <p className="mb-0">
                  {noPoolSummary?.isTotalFailure ? (
                    <>
                      <strong>This strategy setup will fail</strong> — no live pool exists for any selected token pair + platform combination. Saving will likely cause the vault to be blacklisted after retries are exhausted, requiring a manual retry once a pool is created and funded.
                    </>
                  ) : (
                    <>
                      <strong>Your vault may not perform as expected</strong> — positions will not be deployed for the combinations above. The strategy will still operate on the remaining live combinations.
                    </>
                  )}
                </p>
              </Alert>
            )}
            {noticeWarnings.length > 0 && (
              <Alert variant="warning">
                <Alert.Heading>Configuration Notices</Alert.Heading>
                <p className="mb-3">
                  Please review the following items about your strategy configuration:
                </p>
                <hr />
                <div className="mt-3">
                  {noticeWarnings.map((warning, index) => renderWarning(warning, index))}
                </div>
              </Alert>
            )}
            <p className="mb-0">
              {prompt}
            </p>
          </>
        ) : (
          <p>Ready to save your strategy configuration?</p>
        )}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onHide}>
          Cancel
        </Button>
        <Button variant="primary" onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default StrategyValidationModal;
