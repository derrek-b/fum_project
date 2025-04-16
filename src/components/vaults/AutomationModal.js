// src/components/vaults/AutomationModal.js
import React from 'react';
import { Modal, Button, Alert } from 'react-bootstrap';

const AutomationModal = ({
  show,
  onHide,
  isEnabling,
  executorAddress,
  onConfirm
}) => {
  return (
    <Modal show={show} onHide={onHide} centered>
      <Modal.Header closeButton>
        <Modal.Title>
          {isEnabling ? 'Enable Automation' : 'Disable Automation'}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {isEnabling ? (
          <>
            <Alert variant="info">
              <p>You are about to enable automated position management for this vault.</p>
              <p>This will authorize the following address to execute transactions on behalf of your vault:</p>
            </Alert>

            <div className="bg-light p-3 mb-3 rounded">
              <code className="user-select-all">{executorAddress}</code>
            </div>

            <p>The executor can only:</p>
            <ul>
              <li>Execute transactions according to your strategy parameters</li>
              <li>Rebalance positions when they move outside your target ranges</li>
              <li>Collect and reinvest fees based on your fee settings</li>
            </ul>

            <p className="fw-bold">The executor cannot withdraw tokens or positions from your vault.</p>

            <Alert variant="warning">
              You can disable automation at any time by toggling it off in the strategy settings.
            </Alert>
          </>
        ) : (
          <>
            <Alert variant="warning">
              <p>You are about to disable automated position management for this vault.</p>
              <p>This will revoke permission for the automation service to execute transactions on behalf of your vault.</p>
            </Alert>

            <p>After disabling automation:</p>
            <ul>
              <li>Your positions will no longer be automatically rebalanced</li>
              <li>Fees won't be automatically collected or reinvested</li>
              <li>You'll need to manually manage all positions</li>
            </ul>

            <p>You can re-enable automation at any time.</p>
          </>
        )}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onHide}>
          Cancel
        </Button>
        <Button
          variant={isEnabling ? "primary" : "danger"}
          onClick={onConfirm}
        >
          {isEnabling ? "Enable Automation" : "Disable Automation"}
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default AutomationModal;
