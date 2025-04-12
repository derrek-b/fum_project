// src/components/vaults/StrategyDeactivationModal.js
import React from 'react';
import { Modal, Button, Alert } from 'react-bootstrap';

/**
 * Modal to confirm strategy deactivation
 */
const StrategyDeactivationModal = ({ show, onHide, onConfirm, strategyName }) => {
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
            This means:
          </p>
          <ul>
            <li>Your positions will no longer be actively managed</li>
            <li>No automatic rebalancing will occur</li>
            <li>Fee collection will not be automated</li>
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
