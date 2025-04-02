// src/components/CreateVaultModal.js
import React, { useState, useEffect, useMemo } from "react";
import { Modal, Button, Form, Spinner, Alert, ProgressBar } from "react-bootstrap";
import { useSelector, useDispatch } from "react-redux";
import { useToast } from "../../context/ToastContext";
import StrategyParameterForm from "./StrategyParameterForm";
import {
  getAvailableStrategies,
  getStrategyDetails,
  getDefaultParams,
  getStrategyTemplates,
  getTemplateDefaults
} from "../../utils/strategyConfig";
import { createVault } from "../../utils/contracts";
import { triggerUpdate } from "../../redux/updateSlice";

export default function CreateVaultModal({
  show,
  onHide
}) {
  const { showError, showSuccess } = useToast();
  const dispatch = useDispatch();

  // Get data from Redux store
  const { chainId, provider, address } = useSelector((state) => state.wallet);

  // State for tracking wizard progress
  const [currentStep, setCurrentStep] = useState(1);
  const [initialized, setInitialized] = useState(false);
  const [isCreatingVault, setIsCreatingVault] = useState(false);
  const [createdVaultAddress, setCreatedVaultAddress] = useState(null);
  const [txError, setTxError] = useState("");

  // Form state for vault info
  const [vaultName, setVaultName] = useState("");
  const [vaultDescription, setVaultDescription] = useState("");

  // Form state for strategy selection
  const [strategyId, setStrategyId] = useState("none");
  const [selectedTemplate, setSelectedTemplate] = useState("custom");

  // Strategy parameters
  const [strategyParams, setStrategyParams] = useState({});

  // Get currently selected strategy details
  const selectedStrategy = useMemo(() => {
    return getStrategyDetails(strategyId);
  }, [strategyId]);

  // Calculate total steps based on strategy
  const totalSteps = useMemo(() => {
    // Step 1: Vault Info
    // Step 2: Strategy Selection
    // Steps 3 to n: Strategy Parameter Steps
    // Step n+1: Final Summary

    // Base steps: Vault Info + Strategy Selection + Final Summary
    const baseSteps = 3;

    // Add parameter steps from strategy
    const parameterSteps = selectedStrategy.totalParameterSteps;

    return baseSteps + parameterSteps;
  }, [selectedStrategy]);

  // Initialize form on first render or when modal is shown
  useEffect(() => {
    if (show && !initialized) {
      // Reset all form state
      setCurrentStep(1);
      setVaultName("");
      setVaultDescription("");
      setStrategyId("none");
      setSelectedTemplate("custom");
      setStrategyParams(getDefaultParams("none"));
      setCreatedVaultAddress(null);
      setIsCreatingVault(false);
      setTxError("");
      setInitialized(true);
    } else if (!show) {
      // Reset initialization flag when modal closes
      setInitialized(false);
    }
  }, [show, initialized]);

  // Update parameters when strategy/template changes
  useEffect(() => {
    if (strategyId && selectedTemplate) {
      if (selectedTemplate === "custom") {
        // For custom, use default parameters
        setStrategyParams(getDefaultParams(strategyId));
      } else {
        // For templates, use template-specific defaults
        setStrategyParams(getTemplateDefaults(strategyId, selectedTemplate));
      }
    }
  }, [strategyId, selectedTemplate]);

  // Get step progress percentage
  const getStepProgress = () => {
    return Math.round((currentStep / totalSteps) * 100);
  };

  // Handle parameter change
  const handleParamChange = (paramId, value) => {
    setStrategyParams(prev => ({
      ...prev,
      [paramId]: value
    }));
  };

  // Handle strategy toggle
  const handleStrategyToggle = (checked) => {
    if (!checked) {
      // Using manual management
      setStrategyId("none");
      setSelectedTemplate("custom");
    } else {
      // Using automated strategy
      const strategies = getAvailableStrategies();
      if (strategies && strategies.length > 0) {
        setStrategyId(strategies[0].id);
        setSelectedTemplate(""); // Reset template
      }
    }
  };

  // Handle strategy selection change
  const handleStrategyChange = (newStrategyId) => {
    if (newStrategyId === strategyId) return;
    setStrategyId(newStrategyId);
    setSelectedTemplate(""); // Reset template when strategy changes
  };

  // Handle template selection
  const handleTemplateChange = (templateId) => {
    setSelectedTemplate(templateId);
  };

  // Handle next step
  const handleNextStep = () => {
    // Validate current step
    if (currentStep === 1) {
      // Validate vault info
      if (!vaultName.trim()) {
        showError("Please enter a vault name");
        return;
      }
    } else if (currentStep === 2) {
      // Validate strategy selection
      if (!selectedTemplate) {
        showError("Please select a template or custom configuration");
        return;
      }
    }

    // Advance to next step
    setCurrentStep(prev => prev + 1);
  };

  // Handle going back
  const handleBack = () => {
    setCurrentStep(prev => prev - 1);
  };

  // Create vault
  const handleCreateVault = async () => {
    if (!provider || !address) {
      showError("Wallet not connected");
      return null;
    }

    try {
      const signer = await provider.getSigner();
      const vaultAddress = await createVault(vaultName, signer);
      console.log(`Vault created at address: ${vaultAddress}`);
      return vaultAddress;
    } catch (error) {
      console.error("Error creating vault:", error);
      throw error;
    }
  };

  // Handle first step submission (vault name)
  const handleVaultInfoSubmit = async (e) => {
    e.preventDefault();

    const form = e.currentTarget;

    // Form validation
    if (form.checkValidity() === false) {
      e.stopPropagation();
      return;
    }

    // Create the vault right after step 1
    try {
      // Set loading state
      setIsCreatingVault(true);
      setTxError("");

      // Create the vault
      const vaultAddress = await handleCreateVault();

      // If successful, store the vault address
      setCreatedVaultAddress(vaultAddress);

      // Show success message
      showSuccess(`Vault "${vaultName}" created successfully!`);

      // Refresh vaults data
      dispatch(triggerUpdate(Date.now()));

      // Move to next step if validation passes
      setCurrentStep(2);
    } catch (error) {
      console.error("Error creating vault:", error);
      setTxError(error.message || "Transaction failed");
    } finally {
      setIsCreatingVault(false);
    }
  };

  // Handle final step submission
  const handleSubmit = async () => {
    try {
      showSuccess("Vault setup completed!");
      onHide();
    } catch (error) {
      console.error("Error finalizing vault:", error);
      setTxError(error.message || "Transaction failed");
    }
  };

  // Get the step title
  const getStepTitle = () => {
    if (currentStep === 1) {
      return "Create New Vault";
    } else if (currentStep === 2) {
      return "Strategy Selection";
    } else if (currentStep === totalSteps) {
      return "Complete Setup";
    } else {
      // Parameter steps
      return `Parameter Configuration - Step ${currentStep - 2}`;
    }
  };

  // Calculate the current parameter step (if we're in a parameter step)
  const getCurrentParameterStep = () => {
    if (currentStep <= 2 || currentStep === totalSteps) {
      return 0; // Not a parameter step
    }
    return currentStep - 2; // Parameter steps start after step 2
  };

  // Render step 1: Vault Information
  const renderVaultInfoStep = () => {
    return (
      <Form noValidate onSubmit={handleVaultInfoSubmit}>
        <Modal.Body>
          <div className="mb-3">
            <ProgressBar now={getStepProgress()} label={`Step ${currentStep} of ${totalSteps}`} className="mb-3" />
            <h5>Vault Information</h5>
            <p>
              A vault allows you to group your DeFi positions and apply automated
              strategies to them.
            </p>
          </div>

          <Form.Group className="mb-3">
            <Form.Label>Vault Name <span className="text-danger">*</span></Form.Label>
            <Form.Control
              type="text"
              placeholder="Enter a name for your vault"
              value={vaultName}
              onChange={(e) => setVaultName(e.target.value)}
              disabled={isCreatingVault}
              required
              maxLength={50}
            />
            <Form.Text className="text-muted">
              Choose a meaningful name to help you identify this vault.
            </Form.Text>
          </Form.Group>

          <Form.Group className="mb-3">
            <Form.Label>Description (Optional)</Form.Label>
            <Form.Control
              as="textarea"
              rows={2}
              placeholder="What is this vault for? (Optional)"
              value={vaultDescription}
              onChange={(e) => setVaultDescription(e.target.value)}
              disabled={isCreatingVault}
              maxLength={200}
            />
            <Form.Text className="text-muted">
              Add context or notes about this vault's purpose.
            </Form.Text>
          </Form.Group>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={onHide} disabled={isCreatingVault}>
            Cancel
          </Button>
          <Button
            variant="primary"
            type="submit"
            disabled={isCreatingVault || !vaultName.trim()}
          >
            {isCreatingVault ? (
              <>
                <Spinner
                  as="span"
                  animation="border"
                  size="sm"
                  role="status"
                  aria-hidden="true"
                  className="me-2"
                />
                Creating Vault...
              </>
            ) : "Create Vault"}
          </Button>
        </Modal.Footer>
      </Form>
    );
  };

  // Render step 2: Strategy Selection
  const renderStrategySelectionStep = () => {
    return (
      <Form noValidate onSubmit={(e) => {
        e.preventDefault();
        handleNextStep();
      }}>
        <Modal.Body>
          <div className="mb-3">
            <ProgressBar now={getStepProgress()} label={`Step ${currentStep} of ${totalSteps}`} className="mb-3" />
            <h5>Strategy Selection</h5>
            <p>
              A strategy can automate management of your liquidity positions for optimal returns.
            </p>
          </div>

          <Form.Group className="mb-4">
            <Form.Check
              type="switch"
              id="use-strategy-switch"
              label="Use an automated strategy"
              checked={strategyId !== "none"}
              onChange={(e) => handleStrategyToggle(e.target.checked)}
              disabled={isCreatingVault}
            />
          </Form.Group>

          {strategyId !== "none" && (
            <>
              <Form.Group className="mb-4">
                <Form.Label>Strategy Type</Form.Label>
                <Form.Select
                  value={strategyId}
                  onChange={(e) => handleStrategyChange(e.target.value)}
                  disabled={isCreatingVault}
                >
                  {getAvailableStrategies().map(strategy => (
                    <option
                      key={strategy.id}
                      value={strategy.id}
                      disabled={strategy.comingSoon}
                    >
                      {strategy.name} - {strategy.subtitle}
                      {strategy.comingSoon ? " (Coming Soon)" : ""}
                    </option>
                  ))}
                </Form.Select>
              </Form.Group>

              <Form.Group className="mb-4">
                <Form.Label>Configuration Template</Form.Label>
                <Form.Select
                  value={selectedTemplate}
                  onChange={(e) => handleTemplateChange(e.target.value)}
                  disabled={isCreatingVault}
                >
                  <option value="">Select a template...</option>
                  {getStrategyTemplates(strategyId).map(template => (
                    <option key={template.id} value={template.id}>
                      {template.name} - {template.description}
                    </option>
                  ))}
                </Form.Select>
              </Form.Group>
            </>
          )}

          {strategyId === "none" && (
            <Alert variant="info">
              <strong>Manual Management</strong>
              <p className="mb-0">
                You'll manually manage your positions without automation.
              </p>
            </Alert>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={handleBack} disabled={isCreatingVault}>
            Back
          </Button>
          <Button
            variant="primary"
            type="submit"
            disabled={isCreatingVault || (!selectedTemplate && strategyId !== "none")}
          >
            Next
          </Button>
        </Modal.Footer>
      </Form>
    );
  };

  // Render parameter step
  const renderParameterStep = () => {
    const parameterStep = getCurrentParameterStep();

    return (
      <Form noValidate onSubmit={(e) => {
        e.preventDefault();
        handleNextStep();
      }}>
        <Modal.Body>
          <div className="mb-3">
            <ProgressBar now={getStepProgress()} label={`Step ${currentStep} of ${totalSteps}`} className="mb-3" />
            <h5>{getStepTitle()}</h5>
            <p>Configure the parameters for your selected strategy.</p>
          </div>

          <StrategyParameterForm
            strategyId={strategyId}
            currentStep={parameterStep}
            params={strategyParams}
            onParamChange={handleParamChange}
            disabled={isCreatingVault}
          />
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={handleBack} disabled={isCreatingVault}>
            Back
          </Button>
          <Button
            variant="primary"
            type="submit"
            disabled={isCreatingVault}
          >
            Next
          </Button>
        </Modal.Footer>
      </Form>
    );
  };

  // Render final step
  const renderFinalStep = () => {
    return (
      <>
        <Modal.Body>
          <div className="mb-3">
            <ProgressBar now={getStepProgress()} label={`Step ${currentStep} of ${totalSteps}`} className="mb-3" />
            <h5>Complete Setup</h5>

            <Alert variant="success">
              <p className="mb-0">
                Your vault is ready to be set up. Click "Complete" to finalize the configuration.
              </p>
            </Alert>

            <div className="mt-3">
              <h6>Summary:</h6>
              <ul>
                <li><strong>Vault Name:</strong> {vaultName}</li>
                <li><strong>Strategy:</strong> {selectedStrategy.name}</li>
                <li><strong>Address:</strong> {createdVaultAddress}</li>
              </ul>
            </div>
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={handleBack} disabled={isCreatingVault}>
            Back
          </Button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            disabled={isCreatingVault}
          >
            Complete
          </Button>
        </Modal.Footer>
      </>
    );
  };

  // Render the current step content
  const renderStepContent = () => {
    if (currentStep === 1) {
      return renderVaultInfoStep();
    } else if (currentStep === 2) {
      return renderStrategySelectionStep();
    } else if (currentStep === totalSteps) {
      return renderFinalStep();
    } else {
      // Parameter steps (3 to totalSteps-1)
      return renderParameterStep();
    }
  };

  // Handle modal close
  const handleModalClose = () => {
    if (isCreatingVault) {
      showError("Cannot close this window while the transaction is in progress");
      return;
    }
    onHide();
  };

  return (
    <Modal
      show={show}
      onHide={handleModalClose}
      centered
      backdrop="static"
      keyboard={false}
      size={currentStep === 1 ? "md" : "lg"}
    >
      <Modal.Header closeButton={!isCreatingVault}>
        <Modal.Title>{getStepTitle()}</Modal.Title>
      </Modal.Header>

      {renderStepContent()}
    </Modal>
  );
}
