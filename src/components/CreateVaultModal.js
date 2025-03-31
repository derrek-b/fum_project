// src/components/CreateVaultModal.js
import React, { useState, useEffect, useMemo } from "react";
import { Modal, Button, Form, Spinner, Alert, ProgressBar, ListGroup, Badge, Card, Row, Col } from "react-bootstrap";
import StrategyParameterForm from "./StrategyParameterForm.js";
import TokenDepositsSection from '../components/TokenDepositsSection';
import PositionDepositsSection from '../components/PositionDepositsSection';
import { useSelector, useDispatch } from "react-redux";
import Image from "next/image";
import { useToast } from "../context/ToastContext";
import {
  getAvailableStrategies,
  getDefaultParams,
  getStrategyDetails,
  validateStrategyParams,
  getStrategyParameters,
  getStrategyParametersByStep,
  getStrategyTemplates,
  getTemplateDefaults
} from "../utils/strategyConfig";
import { getTokenBySymbol, getAllTokens } from "@/utils/tokenConfig";
import config from "../utils/config";
import { createVault } from "../utils/contracts";
import { triggerUpdate } from "../redux/updateSlice";

export default function CreateVaultModal({
  show,
  onHide,
  errorMessage
}) {
  const { showError, showSuccess } = useToast();
  const dispatch = useDispatch();

  // Get data from Redux store
  const { isConnected, chainId, provider, address } = useSelector((state) => state.wallet);
  const { positions } = useSelector((state) => state.positions);

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
  const [useStrategy, setUseStrategy] = useState(false);
  const [strategyId, setStrategyId] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState("");

  // Strategy parameters
  const [strategyParams, setStrategyParams] = useState({});
  const [validated, setValidated] = useState(false);
  const [validationErrors, setValidationErrors] = useState({});

  // Token and platform selection
  const [selectedTokens, setSelectedTokens] = useState([]);
  const [selectedPlatforms, setSelectedPlatforms] = useState([]);
  const [tokenSelectionError, setTokenSelectionError] = useState("");
  const [platformSelectionError, setPlatformSelectionError] = useState("");

  // Position selection
  const [selectedPositions, setSelectedPositions] = useState([]);

  // Get currently selected strategy details
  const selectedStrategy = useMemo(() => {
    if (!strategyId) return null;
    return getStrategyDetails(strategyId);
  }, [strategyId]);

  // Get available templates for selected strategy
  const availableTemplates = useMemo(() => {
    if (!strategyId) return [];
    return getStrategyTemplates(strategyId);
  }, [strategyId]);

  // Calculate total steps based on strategy and template selection
  const totalSteps = useMemo(() => {
    // Always includes: 1. Vault info, 2. Strategy selection, n+1. Asset deposit, n+2. Summary
    let steps = 4;

    // If using a strategy and it's not a pre-configured template
    if (useStrategy && strategyId && selectedTemplate === "custom") {
      // Add strategy-specific parameter steps
      const strategySteps = selectedStrategy?.totalParameterSteps || 0;
      steps += strategySteps;
    }

    return steps;
  }, [useStrategy, strategyId, selectedTemplate, selectedStrategy]);

  // Initialize form on first render or when modal is shown
  useEffect(() => {
    if (show && !initialized) {
      // Reset all form state
      setCurrentStep(1);
      setVaultName("");
      setVaultDescription("");
      setUseStrategy(false);
      setStrategyId("");
      setSelectedTemplate("");
      setStrategyParams({});
      setSelectedTokens([]);
      setSelectedPlatforms([]);
      setTokenSelectionError("");
      setPlatformSelectionError("");
      setSelectedPositions([]);
      setValidated(false);
      setValidationErrors({});
      setCreatedVaultAddress(null);
      setIsCreatingVault(false);
      setTxError("");
      setInitialized(true);
    } else if (!show) {
      // Reset initialization flag when modal closes
      setInitialized(false);
    }
  }, [show, initialized]);

  // Update strategy parameters when template changes
  useEffect(() => {
    if (strategyId && selectedTemplate) {
      if (selectedTemplate === "custom") {
        // For custom, use default parameters
        setStrategyParams(getDefaultParams(strategyId));
      } else {
        // For templates, use template-specific defaults
        setStrategyParams(getTemplateDefaults(strategyId, selectedTemplate));
      }
    } else {
      // Reset parameters when no strategy/template selected
      setStrategyParams({});
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

    // Clear validation error for this parameter
    if (validationErrors[paramId]) {
      setValidationErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[paramId];
        return newErrors;
      });
    }
  };

  // Handle strategy toggle
  const handleStrategyToggle = (checked) => {
    setUseStrategy(checked);

    if (!checked) {
      // If turning off strategy, reset strategy selections
      setStrategyId("");
      setSelectedTemplate("");
      setStrategyParams({});
    } else if (!strategyId) {
      // If turning on strategy and none selected, default to first available
      const firstStrategy = getAvailableStrategies()[0]?.id;
      if (firstStrategy) {
        setStrategyId(firstStrategy);
      }
    }
  };

  // Handle strategy selection change
  const handleStrategyChange = (newStrategyId) => {
    if (newStrategyId === strategyId) return;

    setStrategyId(newStrategyId);
    setSelectedTemplate(""); // Reset template when strategy changes
    setStrategyParams({}); // Reset parameters
    setValidationErrors({});
  };

  // Handle template selection
  const handleTemplateChange = (templateId) => {
    setSelectedTemplate(templateId);

    // Load template-specific parameters
    if (templateId === "custom") {
      setStrategyParams(getDefaultParams(strategyId));
    } else {
      setStrategyParams(getTemplateDefaults(strategyId, templateId));
    }

    // Clear validation errors
    setValidationErrors({});
  };

  // Handle token selection
  const handleTokenSelection = (symbol) => {
    setSelectedTokens(prev => {
      // If token is already selected, remove it
      if (prev.includes(symbol)) {
        return prev.filter(token => token !== symbol);
      }
      // Otherwise, add it
      return [...prev, symbol];
    });

    // Clear any token selection errors
    if (tokenSelectionError) {
      setTokenSelectionError("");
    }
  };

  // Validate token selection
  const validateTokenSelection = () => {
    if (useStrategy && selectedStrategy?.requireTokenSelection &&
        (!selectedTokens.length || selectedTokens.length < (selectedStrategy.minTokens || 1))) {
      setTokenSelectionError(`Please select at least ${selectedStrategy.minTokens || 1} token(s)`);
      return false;
    }

    if (useStrategy && selectedStrategy?.maxTokens && selectedTokens.length > selectedStrategy.maxTokens) {
      setTokenSelectionError(`Please select no more than ${selectedStrategy.maxTokens} token(s)`);
      return false;
    }

    return true;
  };

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
      if (useStrategy && !strategyId) {
        showError("Please select a strategy");
        return;
      }

      if (useStrategy && !selectedTemplate) {
        showError("Please select a template or custom configuration");
        return;
      }

      // Handle template selection - if a template is chosen (not custom),
      // skip the parameter configuration steps
      if (useStrategy && selectedTemplate !== "custom") {
        // Skip to asset deposit step
        setCurrentStep(totalSteps - 1); // Second-to-last step (asset deposit)
        return;
      }
    } else if (useStrategy && strategyId && selectedTemplate === "custom") {
      // For parameter configuration steps
      const wizardStep = currentStep;

      // Get parameters for current step
      const stepParameters = getStrategyParametersByStep(strategyId, wizardStep);

      // Validate parameters
      const stepParamIds = Object.keys(stepParameters);
      const { isValid, errors } = validateStrategyParams(strategyId, strategyParams);

      // Filter errors to only show those for the current step
      const currentStepErrors = {};
      Object.entries(errors || {}).forEach(([paramId, error]) => {
        if (stepParamIds.includes(paramId)) {
          currentStepErrors[paramId] = error;
        }
      });

      if (!isValid && Object.keys(currentStepErrors).length > 0) {
        setValidationErrors(currentStepErrors);
        return;
      }
    }

    // Advance to next step
    setCurrentStep(prev => prev + 1);
  };

  // Handle going back
  const handleBack = () => {
    // If we're at step 2, and we've already created a vault,
    // don't allow going back to vault creation step
    if (currentStep === 2 && createdVaultAddress) {
      return; // Don't allow going back to vault creation
    }

    // For template selection step, go back to strategy selection
    if (currentStep === totalSteps - 1 && useStrategy && selectedTemplate !== "custom") {
      setCurrentStep(2);
    } else {
      setCurrentStep(prev => prev - 1);
    }
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
      setValidated(true);
      return;
    }

    setValidated(true);

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

  // Handle submit (final step)
  const handleSubmit = async () => {
    try {
      // Set loading state
      setIsCreatingVault(true);
      setTxError("");

      // Here we'd configure the already-created vault with strategy settings
      // const vaultContract = getVaultContract(createdVaultAddress, provider, signer);

      if (useStrategy) {
        // Configure strategy on the vault
        console.log(`Configuring vault ${createdVaultAddress} with strategy ${strategyId} using template ${selectedTemplate}`);

        // Here you would:
        // 1. Apply strategy parameters to the vault
        // 2. Activate the strategy
        // 3. Set up any needed authorizations
      }

      // Handle token deposits
      if (selectedTokens.length > 0) {
        console.log(`Adding tokens to vault: ${selectedTokens.join(', ')}`);
        // Code to add tokens to vault
      }

      // Handle position transfers
      if (selectedPositions.length > 0) {
        console.log(`Adding positions to vault: ${selectedPositions.join(', ')}`);
        // Code to transfer positions to vault
      }

      // Show success message
      showSuccess(`Vault setup completed successfully!`);

      // Refresh vaults data
      dispatch(triggerUpdate(Date.now()));

      // Move to the final success view
      setCurrentStep(totalSteps);
    } catch (error) {
      console.error("Error configuring vault:", error);
      setTxError(error.message || "Transaction failed");
    } finally {
      setIsCreatingVault(false);
    }
  };

  // Get the step title
  const getStepTitle = () => {
    switch(currentStep) {
      case 1:
        return "Create New Vault";
      case 2:
        return "Strategy Selection";
      case totalSteps - 1: // Asset deposit
        return "Asset Deposits";
      case totalSteps: // Final summary
        return "Complete Setup";
      default:
        // For strategy parameter steps
        if (useStrategy && strategyId && selectedTemplate === "custom") {
          const stepNum = currentStep - 2;
          return `Strategy Configuration - Step ${stepNum}`;
        }
        return "Configure Strategy";
    }
  };

  // Check if the current step is the final step
  const isFinalStep = () => {
    return currentStep === totalSteps;
  };

  // Render step 1: Vault Information
    const renderVaultInfoStep = () => {
      return (
        <Form noValidate validated={validated} onSubmit={handleVaultInfoSubmit}>
          <Modal.Body>
            <div className="mb-3">
              <ProgressBar now={getStepProgress()} label={`Step ${currentStep} of ${totalSteps}`} className="mb-3" />
              <h5>Vault Information</h5>
              <p>
                A vault allows you to group your DeFi positions and apply automated
                strategies to them. You'll be able to deposit positions and configure
                strategies after creation.
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
              <Form.Control.Feedback type="invalid">
                Please provide a name for your vault.
              </Form.Control.Feedback>
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
              You can choose to activate a strategy now or later from the vault details page.
            </p>
          </div>

          <Form.Group className="mb-4">
            <Form.Check
              type="switch"
              id="use-strategy-switch"
              label="Use an automated strategy"
              checked={useStrategy}
              onChange={(e) => handleStrategyToggle(e.target.checked)}
              disabled={isCreatingVault}
            />
          </Form.Group>

          {useStrategy && (
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
                <Form.Text className="text-muted">
                  Select a strategy that matches your investment goals.
                </Form.Text>
              </Form.Group>

              {strategyId && (
                <Form.Group className="mb-4">
                  <Form.Label>Configuration Template</Form.Label>
                  <Form.Select
                    value={selectedTemplate}
                    onChange={(e) => handleTemplateChange(e.target.value)}
                    disabled={isCreatingVault}
                  >
                    <option value="">Select a template...</option>
                    {availableTemplates.map(template => (
                      <option key={template.id} value={template.id}>
                        {template.name} - {template.description}
                      </option>
                    ))}
                  </Form.Select>
                  <Form.Text className="text-muted">
                    Choose a preset template or select "Custom" for full control over all parameters.
                  </Form.Text>
                </Form.Group>
              )}

              {strategyId && selectedTemplate && (
                <Alert variant={selectedTemplate === "custom" ? "info" : "success"}>
                  {selectedTemplate === "custom" ? (
                    <>
                      <strong>Custom Configuration</strong>
                      <p className="mb-0">You'll be guided through setting all strategy parameters in the next steps.</p>
                    </>
                  ) : (
                    <>
                      <strong>{availableTemplates.find(t => t.id === selectedTemplate)?.name} Template</strong>
                      <p className="mb-0">Preconfigured settings will be applied. You can modify these later from the vault dashboard.</p>
                    </>
                  )}
                </Alert>
              )}
            </>
          )}

          {!useStrategy && (
            <Alert variant="info">
              <strong>Manual Management</strong>
              <p className="mb-0">
                You'll manually manage your positions without automation. You can always
                activate a strategy later from the vault details page.
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
            disabled={isCreatingVault || (useStrategy && (!strategyId || !selectedTemplate))}
          >
            Next
          </Button>
        </Modal.Footer>
      </Form>
    );
  };

  // Render parameter configuration steps
  const renderParameterStep = () => {
    // Calculate the actual wizard step number as expected by the form
    const wizardStep = currentStep;

    return (
      <Form noValidate onSubmit={(e) => {
        e.preventDefault();
        handleNextStep();
      }}>
        <Modal.Body>
          <div className="mb-3">
            <ProgressBar now={getStepProgress()} label={`Step ${currentStep} of ${totalSteps}`} className="mb-3" />
            <h5>Strategy Parameters - Step {currentStep - 2}</h5>
            <p>Configure the detailed parameters for your selected strategy.</p>
          </div>

          <StrategyParameterForm
            strategyId={strategyId}
            currentStep={wizardStep}
            params={strategyParams}
            onParamChange={handleParamChange}
            disabled={isCreatingVault}
            validationErrors={validationErrors}
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
            {isFinalStep() ? "Create Vault" : "Next"}
          </Button>
        </Modal.Footer>
      </Form>
    );
  };

  // Render asset deposit step
  const renderAssetDepositStep = () => {
    return (
      <Form noValidate onSubmit={(e) => {
        e.preventDefault();
        handleNextStep();
      }}>
        <Modal.Body>
          <div className="mb-3">
            <ProgressBar now={getStepProgress()} label={`Step ${currentStep} of ${totalSteps}`} className="mb-3" />
            <h5>Asset Deposits</h5>
            <p>
              Add tokens and positions to your vault. You can add more later from the vault dashboard.
            </p>
          </div>

          <TokenDepositsSection
            selectedTokens={selectedTokens}
            setSelectedTokens={setSelectedTokens}
            depositAmounts={strategyParams.depositAmounts || {}}
            onAmountChange={(symbol, value) => {
              const newDepositAmounts = {
                ...(strategyParams.depositAmounts || {}),
                [symbol]: value
              };
              handleParamChange('depositAmounts', newDepositAmounts);
            }}
            useStrategy={useStrategy}
            strategyId={strategyId}
          />

          <PositionDepositsSection
            selectedPositions={selectedPositions}
            setSelectedPositions={setSelectedPositions}
            useStrategy={useStrategy}
            strategyId={strategyId}
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
            <ProgressBar now={isCreatingVault ? 75 : 100} label={isCreatingVault ? "Creating Vault..." : "Complete"} className="mb-3" />

            {isCreatingVault ? (
              <div className="text-center py-4">
                <Spinner animation="border" role="status" className="mb-3">
                  <span className="visually-hidden">Creating vault...</span>
                </Spinner>
                <h5>Creating Your Vault</h5>
                <p className="text-muted">
                  Please confirm the transaction in your wallet and wait for it to be processed.
                </p>
              </div>
            ) : txError ? (
              <Alert variant="danger">
                <Alert.Heading>Error Creating Vault</Alert.Heading>
                <p>{txError}</p>
                <p>Please try again or contact support if the issue persists.</p>
              </Alert>
            ) : createdVaultAddress ? (
              <>
                <Alert variant="success">
                  <Alert.Heading>Vault Created Successfully!</Alert.Heading>
                  <p>Your vault has been created at:</p>
                  <code className="d-block mb-3">{createdVaultAddress}</code>
                </Alert>

                <Card className="mb-4">
                  <Card.Header>Vault Details</Card.Header>
                  <Card.Body>
                    <Row>
                      <Col md={6}>
                        <p><strong>Name:</strong> {vaultName}</p>
                        {vaultDescription && <p><strong>Description:</strong> {vaultDescription}</p>}
                        <p>
                          <strong>Strategy:</strong> {useStrategy
                            ? `${selectedStrategy?.name} (${availableTemplates.find(t => t.id === selectedTemplate)?.name})`
                            : "Manual Management"}
                        </p>
                      </Col>
                      <Col md={6}>
                        <p><strong>Tokens:</strong> {selectedTokens.join(", ") || "None"}</p>
                        <p><strong>Positions:</strong> {selectedPositions.length}</p>
                      </Col>
                    </Row>
                  </Card.Body>
                </Card>

                <div className="text-center">
                  <p>Your vault is ready to use. You can now:</p>
                  <ul className="text-start">
                    <li>Add more positions</li>
                    <li>Deposit additional tokens</li>
                    <li>{useStrategy ? "Monitor your automated strategy" : "Activate a strategy"}</li>
                  </ul>
                </div>
              </>
            ) : (
              <>
                <h5>Review and Create</h5>
                <p className="mb-3">
                  Please review your vault configuration and click "Create Vault" to proceed.
                </p>

                <Card className="mb-4">
                  <Card.Header>Vault Summary</Card.Header>
                  <Card.Body>
                    <p><strong>Name:</strong> {vaultName}</p>
                    {vaultDescription && <p><strong>Description:</strong> {vaultDescription}</p>}
                    <p>
                      <strong>Strategy:</strong> {useStrategy
                        ? `${selectedStrategy?.name} (${availableTemplates.find(t => t.id === selectedTemplate)?.name})`
                        : "Manual Management"}
                    </p>
                    <p><strong>Tokens:</strong> {selectedTokens.join(", ") || "None"}</p>
                    <p><strong>Positions:</strong> {selectedPositions.length}</p>

                    {useStrategy && selectedTemplate !== "custom" && (
                      <Alert variant="info" className="mt-3 mb-0">
                        You've selected a preset template. The strategy will be configured with optimized parameters.
                      </Alert>
                    )}
                  </Card.Body>
                </Card>

                <div className="d-grid">
                  <Button
                    variant="primary"
                    onClick={handleSubmit}
                    disabled={isCreatingVault}
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
                        Configuring Vault...
                      </>
                    ) : "Complete Setup"}
                  </Button>
                </div>
              </>
            )}
          </div>
        </Modal.Body>

        <Modal.Footer>
          {isCreatingVault ? (
            <div /> // No buttons during processing
          ) : txError ? (
            <>
              <Button variant="secondary" onClick={onHide}>
                Cancel
              </Button>
              <Button variant="primary" onClick={() => setCurrentStep(totalSteps - 1)}>
                Try Again
              </Button>
            </>
          ) : createdVaultAddress ? (
            <>
              <Button variant="secondary" onClick={onHide}>
                Close
              </Button>
              <Button
                variant="primary"
                onClick={() => window.location.href = `/vault/${createdVaultAddress}`}
              >
                Go to Vault
              </Button>
            </>
          ) : (
            <>
              <Button variant="secondary" onClick={handleBack} disabled={isCreatingVault}>
                Back
              </Button>
              <Button
                variant="primary"
                onClick={handleSubmit}
                disabled={isCreatingVault}
              >
                Create Vault
              </Button>
            </>
          )}
        </Modal.Footer>
      </>
    );
  };

  // Render the current step content
  const renderStepContent = () => {
    switch (currentStep) {
      case 1:
        return renderVaultInfoStep();
      case 2:
        return renderStrategySelectionStep();
      case totalSteps - 1:
        return renderAssetDepositStep();
      case totalSteps:
        return renderFinalStep();
      default:
        // For parameter configuration steps (only if using custom)
        if (useStrategy && selectedTemplate === "custom") {
          return renderParameterStep();
        }
        // Fallback
        return renderFinalStep();
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
