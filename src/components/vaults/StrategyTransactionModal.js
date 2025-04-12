// src/components/vaults/StrategyTransactionModal.js
import React from 'react';
import { Modal, Button, Spinner, Alert } from 'react-bootstrap';
import { Check2Circle, XCircle, ArrowClockwise } from 'react-bootstrap-icons';

/**
 * A step by step transaction modal for strategy configuration
 * Shows each transaction step and its current status
 */
const StrategyTransactionModal = ({
  show,
  onHide,
  currentStep,
  steps,
  isLoading,
  error,
  tokenSymbols = [],
  onCancel,
  strategyName
}) => {
  return (
    <Modal show={show} onHide={onCancel} backdrop="static" centered size="lg">
      <Modal.Header>
        <Modal.Title>Configuring Strategy: {strategyName || "Strategy"}</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {error && (
          <Alert variant="danger" className="mb-3">
            <Alert.Heading>Error</Alert.Heading>
            <p>{error}</p>
          </Alert>
        )}

        <p className="mb-3">
          To configure this strategy, several transactions need to be approved in your wallet.
          Please confirm each transaction when prompted.
        </p>

        <div className="transaction-steps">
          {steps.map((step, index) => {
            // Determine step status
            const isCurrentStep = index === currentStep;
            const isPendingStep = index === currentStep && isLoading;
            const isCompletedStep = index < currentStep;
            const isUpcomingStep = index > currentStep;

            // Determine step display details
            let stepTitle = step.title;
            if (step.tokenIndex !== undefined && tokenSymbols.length > step.tokenIndex) {
              stepTitle = stepTitle.replace('{TOKEN}', tokenSymbols[step.tokenIndex]);
            }

            return (
              <div
                key={index}
                className={`transaction-step d-flex align-items-center p-3 mb-2 border rounded ${
                  isCurrentStep ? 'bg-light border-primary' :
                  isCompletedStep ? 'bg-light border-success' :
                  'bg-white'
                }`}
              >
                <div className="step-status me-3">
                  {isCompletedStep && (
                    <Check2Circle className="text-success" size={24} />
                  )}
                  {isPendingStep && (
                    <Spinner animation="border" size="sm" variant="primary" />
                  )}
                  {isCurrentStep && !isPendingStep && (
                    <ArrowClockwise className="text-primary" size={24} />
                  )}
                  {isUpcomingStep && (
                    <div className="step-number">{index + 1}</div>
                  )}
                </div>
                <div className="step-content flex-grow-1">
                  <div className="fw-bold">{stepTitle}</div>
                  <div className="text-muted small">{step.description}</div>
                </div>
                <div className="step-status text-end text-muted small">
                  {isCompletedStep && "Completed"}
                  {isPendingStep && "Processing..."}
                  {isCurrentStep && !isPendingStep && "Waiting for confirmation"}
                  {isUpcomingStep && "Upcoming"}
                </div>
              </div>
            );
          })}
        </div>

        <div className="text-center mt-4">
          {isLoading ? (
            <div>
              <Spinner animation="border" className="me-2" />
              <span>Processing transaction, please confirm in your wallet</span>
            </div>
          ) : (
            <div className="text-muted">
              {currentStep < steps.length ?
                "Please confirm the current transaction in your wallet app" :
                "Strategy configuration complete!"}
            </div>
          )}
        </div>
      </Modal.Body>
      <Modal.Footer>
        {!isLoading && (
          <Button variant="outline-secondary" onClick={onCancel}>
            Cancel
          </Button>
        )}
        {currentStep >= steps.length && (
          <Button variant="primary" onClick={onHide}>
            Done
          </Button>
        )}
      </Modal.Footer>
    </Modal>
  );
};

export default StrategyTransactionModal;
