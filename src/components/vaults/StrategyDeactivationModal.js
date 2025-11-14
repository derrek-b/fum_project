// src/components/vaults/StrategyDeactivationModal.js
import React from 'react';
import { Modal, Button, Alert } from 'react-bootstrap';

/**
 * Modal to confirm strategy deactivation
 */
const StrategyDeactivationModal = ({ show, onHide, onConfirm, strategyName, hasExecutor = false }) => {
  return (
    <Modal show={show} onHide={onHide} backdrop="static" centered>
      <Modal.Header closeButton>
        <Modal.Title>Deactivate Strategy</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <Alert variant="warning">
          <Alert.Heading>Are you sure?</Alert.Heading>
          <p>
            You are about to deactivate the <strong>{strategyName || "active"}</strong> strategy for this vault.
            {hasExecutor ? ' This will disable automation and deactivate the strategy (2 transactions).' : ' This will deactivate the strategy (1 transaction).'}
          </p>
          <p>This means:</p>
          <ul>
            {hasExecutor && (
              <>
                <li>Automation will be disabled</li>
                <li>No automatic rebalancing will occur</li>
                <li>Fee collection will not be automated</li>
              </>
            )}
            <li>Your positions will no longer be actively managed by the strategy</li>
          </ul>
          <p className="mb-0">
            You can reactivate the strategy at any time with the same or different parameters.
          </p>
        </Alert>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="outline-secondary" onClick={onHide}>
          Cancel
        </Button>
        <Button variant="danger" onClick={onConfirm}>
          Deactivate Strategy
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default StrategyDeactivationModal;
