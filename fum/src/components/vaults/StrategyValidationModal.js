// src/components/vaults/StrategyValidationModal.js
import React from 'react';
import { Modal, Button, Alert } from 'react-bootstrap';

/**
 * Modal to show validation warnings before saving strategy configuration
 */
const StrategyValidationModal = ({
  show,
  onHide,
  onConfirm,
  warnings = []
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
    }
    return null;
  };

  return (
    <Modal show={show} onHide={onHide} centered>
      <Modal.Header closeButton>
        <Modal.Title>Review Strategy Configuration</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {warnings.length > 0 ? (
          <>
            <Alert variant="warning">
              <Alert.Heading>Configuration Notices</Alert.Heading>
              <p className="mb-3">
                Please review the following items about your strategy configuration:
              </p>
              <hr />
              <div className="mt-3">
                {warnings.map((warning, index) => renderWarning(warning, index))}
              </div>
            </Alert>
            <p className="mb-0">
              Do you want to proceed with saving this strategy configuration?
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
          Continue to Save
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default StrategyValidationModal;
