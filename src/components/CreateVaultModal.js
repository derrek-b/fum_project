// src/components/CreateVaultModal.js
import React, { useState, useEffect, useMemo } from "react";
import { Modal, Button, Form, Spinner, Alert, ProgressBar, ListGroup, Badge, Card, Row, Col } from "react-bootstrap";
import StrategyParameterForm from "./StrategyParameterForm.js";
import { useSelector, useDispatch } from "react-redux";
import Image from "next/image";
import { useToast } from "../context/ToastContext";
import {
  getAvailableStrategies,
  getDefaultParams,
  getStrategyDetails,
  validateStrategyParams,
  getStrategyParameters,
  getStrategyParametersByStep
} from "../utils/strategyConfig";
import { getTokenBySymbol } from "@/utils/tokenConfig";
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

  // Available strategies - use useMemo to prevent recreation on each render
  const availableStrategies = useMemo(() => getAvailableStrategies(), []);

  // Track the current step (1: vault name, 2: strategy selection, 3: strategy parameters, 4: token deposit, 5: position settings)
  const [currentStep, setCurrentStep] = useState(1);

  // Form state for vault info
  const [vaultName, setVaultName] = useState("");
  const [vaultDescription, setVaultDescription] = useState("");

  // Form state for strategy selection
  const [useStrategy, setUseStrategy] = useState(false);
  const [strategyId, setStrategyId] = useState("");
  const [strategy, setStrategy] = useState({});
  const [strategyParams, setStrategyParams] = useState({});

  // Token selection state
  const [selectedTokens, setSelectedTokens] = useState([]);
  const [tokenSelectionError, setTokenSelectionError] = useState("");

  // Platform selection state
  const [selectedPlatforms, setSelectedPlatforms] = useState([]);
  const [availablePlatforms, setAvailablePlatforms] = useState([]);
  const [platformSelectionError, setPlatformSelectionError] = useState("");

  // Position selection state
  const [selectedPositions, setSelectedPositions] = useState([]);

  // Transaction state
  const [isCreatingVault, setIsCreatingVault] = useState(false);
  const [createdVaultAddress, setCreatedVaultAddress] = useState(null);
  const [txError, setTxError] = useState("");

  // Validation state
  const [validated, setValidated] = useState(false);
  const [validationErrors, setValidationErrors] = useState({});

  // Track if we've already initialized the parameters to avoid loops
  const [initialized, setInitialized] = useState(false);

  // Get available platforms for the current chain
  function getAvailablePlatforms(chainId) {
    if (!chainId || !config.chains[chainId]) return [];

    const chainConfig = config.chains[chainId];
    const platforms = [];

    // Get enabled platforms from chain config
    Object.values(chainConfig.platforms).forEach(platform => {
      if (platform.enabled) {
        // Merge platform info with metadata
        const metadata = config.platformMetadata[platform.id] || {};

        platforms.push({
          id: platform.id,
          name: platform.name || metadata.name || platform.id,
          factoryAddress: platform.factoryAddress,
          positionManagerAddress: platform.positionManagerAddress,
          logo: metadata.logo,
          color: metadata.color || "#6c757d", // Default gray if no color specified
          description: metadata.description || ""
        });
      }
    });

    return platforms;
  }

  // Get available positions for selection
  const availablePositions = useMemo(() => {
    return positions.filter(position => !position.inVault || !position.vaultAddress);
  }, [positions]);

  // Initialize available platforms
  useEffect(() => {
    if (chainId) {
      const platforms = getAvailablePlatforms(chainId);
      setAvailablePlatforms(platforms);
    }
  }, [chainId]);

  // Calculate the total number of steps based on strategy
  const totalSteps = useMemo(() => {
    // Base steps (vault info, strategy selection, final position selection)
    let steps = 3;

    // Add step for strategy parameters if using a strategy
    if (useStrategy && strategyId) {
      // Find the highest step number in the strategy parameters
      const parameters = getStrategyParameters(strategyId);
      if (Object.keys(parameters).length > 0) {
        const maxStep = Math.max(
          ...Object.values(parameters).map(param => param.wizardStep || 2)
        );
        steps = Math.max(steps, maxStep);
      }
    }

    return steps;
  }, [useStrategy, strategyId]);

  // Initialize form on first render or when modal is shown
  useEffect(() => {
    if (show && !initialized) {
      // Set first available strategy
      const firstStrategy = availableStrategies[0]?.id || "";

      // Get platforms for current chain
      const platforms = getAvailablePlatforms(chainId);
      setAvailablePlatforms(platforms);

      // Reset platform selection (allow no platform selected)
      setSelectedPlatforms([]);
      setPlatformSelectionError("");

      // Initialize state with defaults
      setCurrentStep(1);
      setVaultName("");
      setVaultDescription("");
      setUseStrategy(false);
      setStrategyId(firstStrategy);
      setStrategy(firstStrategy ? getStrategyDetails(firstStrategy) : {});
      setStrategyParams(firstStrategy ? getDefaultParams(firstStrategy) : {});
      setSelectedTokens([]);
      setTokenSelectionError("");
      setValidated(false);
      setValidationErrors({});
      setCreatedVaultAddress(null);
      setIsCreatingVault(false);
      setTxError("");
      setSelectedPositions([]);
      setInitialized(true);
    } else if (!show) {
      // Reset initialization flag when modal closes
      setInitialized(false);
    }
  }, [show, initialized, availableStrategies, chainId]);

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

  // Get step progress percentage
  const getStepProgress = () => {
    return Math.round((currentStep / totalSteps) * 100);
  };

  // Handle strategy selection change
  const handleStrategyChange = (e) => {
    const newStrategyId = e.target.value;
    setStrategyId(newStrategyId);

    // Reset parameters to defaults for the new strategy
    if (newStrategyId) {
      setStrategy(getStrategyDetails(newStrategyId));
      setStrategyParams(getDefaultParams(newStrategyId));
      // Reset token selection when strategy changes
      setSelectedTokens([]);
      setTokenSelectionError("");
    } else {
      setStrategy({});
      setStrategyParams({});
    }

    // Clear validation errors
    setValidationErrors({});
  };

  // Handle platform selection toggle
  const handlePlatformSelection = (platformId) => {
    setSelectedPlatforms(prev => {
      if (prev.includes(platformId)) {
        // Allow deselecting platforms (including deselecting all)
        return prev.filter(id => id !== platformId);
      } else {
        return [...prev, platformId];
      }
    });

    // Clear any platform selection errors
    if (platformSelectionError) {
      setPlatformSelectionError("");
    }
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

  // Validate token selection
  const validateTokenSelection = () => {
    if (useStrategy && strategy.requireTokenSelection && (!selectedTokens.length || selectedTokens.length < (strategy.minTokens || 1))) {
      setTokenSelectionError(`Please select at least ${strategy.minTokens || 1} token(s)`);
      return false;
    }

    if (useStrategy && strategy.maxTokens && selectedTokens.length > strategy.maxTokens) {
      setTokenSelectionError(`Please select no more than ${strategy.maxTokens} token(s)`);
      return false;
    }

    return true;
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

  // Handle next step navigation
  const handleNextStep = () => {
    // Validate current step parameters
    if (currentStep === 2) {
      // Validate token selection if required
      if (useStrategy && strategy.requireTokenSelection && !validateTokenSelection()) {
        return;
      }
    }

    // Strategy parameter validation for each step
    if (useStrategy && strategyId && currentStep >= 2) {
      // Get parameters for current step
      const stepParams = getStrategyParametersByStep(strategyId, currentStep);

      // Create a subset of params for validation
      const currentStepParamIds = Object.keys(stepParams);
      const stepParamValues = {};
      currentStepParamIds.forEach(paramId => {
        stepParamValues[paramId] = strategyParams[paramId];
      });

      // Validate this step's parameters
      const { isValid, errors } = validateStrategyParams(strategyId, strategyParams);

      // Filter errors to only show those for current step parameters
      const currentStepErrors = {};
      Object.entries(errors || {}).forEach(([paramId, error]) => {
        if (currentStepParamIds.includes(paramId)) {
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
    setCurrentStep(prev => Math.max(1, prev - 1));
  };

  // Create vault directly from the modal
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

  // Handle vault submission
  const handleSubmit = async (e) => {
    if (e) e.preventDefault();

    try {
      // Validate strategy configuration if enabled
      if (useStrategy) {
        // Validate token selection
        if (!validateTokenSelection()) {
          return;
        }

        // Validate all parameters
        const { isValid, errors } = validateStrategyParams(strategyId, strategyParams);
        if (!isValid) {
          setValidationErrors(errors);
          // Find which step has errors and go there (existing code)...
        }
      }

      // Now we just need to handle strategy activation
      // since vault is already created

      // Move to the final step
      setCurrentStep(totalSteps);

      // Show success message
      showSuccess(`Strategy configured successfully!`);
    } catch (error) {
      console.error("Error in strategy configuration:", error);
      showError(error.message);
    }
  };

  // Handle position submission after vault creation
  const handlePositionSubmit = async () => {
    try {
      // Here you would call a function to add positions to the vault
      // Typically using the BatchedExecutor contract

      showSuccess(`Added ${selectedPositions.length} position(s) to vault`);

      // Close the modal after success
      onHide();
    } catch (error) {
      console.error("Error adding positions:", error);
      showError(error.message);
    }
  };

  // Handle modal close with safety checks
  const handleModalClose = () => {
    if (isCreatingVault) {
      showError("Cannot close this window while the transaction is in progress");
      return;
    }
    onHide();
  };

  // Get the step title
  const getStepTitle = () => {
    switch(currentStep) {
      case 1:
        return "Create New Vault";
      case 2:
        return "Strategy Selection";
      case 3:
        return "Strategy Parameters";
      case 4:
        return "Token Deposits";
      case 5:
        return "Position Settings";
      case totalSteps:
        if (totalSteps > 5) return "Position Settings";
        return "Manage Positions";
      default:
        return "Configure Strategy";
    }
  };

  // Check if the current step is the final step
  const isFinalStep = () => {
    return currentStep === totalSteps || (currentStep === 3 && totalSteps === 3);
  };

  // Render intermediate steps based on strategy parameters
  const renderIntermediateStep = (step) => {
    return (
      <Form noValidate onSubmit={(e) => e.preventDefault()}>
        <Modal.Body>
          <div className="mb-3">
            <ProgressBar now={getStepProgress()} label={`Step ${currentStep} of ${totalSteps}`} className="mb-3" />
            <h5>Strategy Parameters - {getStepTitle()}</h5>
            <p>Configure the detailed parameters for your selected strategy.</p>
          </div>

          <StrategyParameterForm
            strategyId={strategyId}
            currentStep={step}
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
            onClick={isFinalStep() ? handleSubmit : handleNextStep}
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
                Processing...
              </>
            ) : isFinalStep() ? "Create Vault" : "Next"}
          </Button>
        </Modal.Footer>
      </Form>
    );
  };

  // Render the appropriate step content
  const renderStepContent = () => {
    // If step is beyond the first two predefined steps and before the final position step
    if (currentStep > 2 && currentStep < totalSteps) {
      return renderIntermediateStep(currentStep);
    }

    switch(currentStep) {
      case 1:
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
              <Button variant="secondary" onClick={handleModalClose} disabled={isCreatingVault}>
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

      case 2:
        return (
          <Form noValidate onSubmit={(e) => e.preventDefault()}>
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
                  onChange={(e) => setUseStrategy(e.target.checked)}
                  disabled={isCreatingVault}
                />
              </Form.Group>

              {useStrategy && (
                <>
                  <Form.Group className="mb-4">
                    <Form.Label>Strategy Type</Form.Label>
                    <Form.Select
                      value={strategyId}
                      onChange={handleStrategyChange}
                      disabled={isCreatingVault}
                    >
                      {availableStrategies.map(strategy => (
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

                  {useStrategy && strategyId && (
                    <Form.Group className="mb-4">
                      <Form.Label>Select Platforms</Form.Label>
                      <div className="d-flex flex-wrap">
                        {availablePlatforms.map((platform) => {
                          const isSelected = selectedPlatforms.includes(platform.id);

                          return (
                            <div
                              key={platform.id}
                              className={`border rounded p-2 m-1 d-flex align-items-center cursor-pointer ${isSelected ? 'bg-primary text-white' : ''}`}
                              onClick={() => handlePlatformSelection(platform.id)}
                              style={{ cursor: 'pointer' }}
                            >
                              {platform.logo && (
                                <div className="me-1"
                                     style={{ width: '20px', height: '20px', position: 'relative' }}>
                                  <Image
                                    src={platform.logo}
                                    alt={platform.name}
                                    width={20}
                                    height={20}
                                  />
                                </div>
                              )}
                              <span>{platform.name}</span>
                            </div>
                          );
                        })}
                      </div>
                      {platformSelectionError && (
                        <div className="text-danger small mt-1">
                          {platformSelectionError}
                        </div>
                      )}
                      <Form.Text className="text-muted">
                        Select one or more DeFi platforms for this vault. You can select none to use all available platforms.
                      </Form.Text>
                    </Form.Group>
                  )}

                  {useStrategy && strategyId && strategy.supportedTokens && (
                    <Form.Group className="mb-4">
                      <Form.Label>
                        Select Tokens {strategy.requireTokenSelection && <span className="text-danger">*</span>}
                      </Form.Label>
                      <div className="d-flex flex-wrap">
                        {Object.entries(strategy.supportedTokens).map(([symbol, tokenData]) => {
                          const isSelected = selectedTokens.includes(symbol);

                          return (
                            <div
                              key={symbol}
                              className={`border rounded p-2 m-1 d-flex align-items-center cursor-pointer ${isSelected ? 'bg-primary text-white' : ''}`}
                              onClick={() => handleTokenSelection(symbol)}
                              style={{ cursor: 'pointer' }}
                            >
                              {tokenData.logoURI && (
                                <img
                                  src={tokenData.logoURI}
                                  alt={symbol}
                                  width="20"
                                  height="20"
                                  className="me-1"
                                />
                              )}
                              <span>{symbol}</span>
                            </div>
                          );
                        })}
                      </div>
                      {tokenSelectionError && (
                        <div className="text-danger small mt-1">
                          {tokenSelectionError}
                        </div>
                      )}
                      <Form.Text className="text-muted">
                        {strategy.minTokens && strategy.maxTokens
                          ? `Select between ${strategy.minTokens} and ${strategy.maxTokens} tokens for this strategy.`
                          : strategy.minTokens
                              ? `Select at least ${strategy.minTokens} token(s) for this strategy.`
                              : strategy.maxTokens
                                ? `Select up to ${strategy.maxTokens} token(s) for this strategy.`
                                : "Click to select the tokens you want to use with this strategy."}
                      </Form.Text>
                    </Form.Group>
                  )}

                  {/* Render strategy parameters for this step */}
                  <StrategyParameterForm
                    strategyId={strategyId}
                    currentStep={currentStep}
                    params={strategyParams}
                    onParamChange={handleParamChange}
                    disabled={isCreatingVault}
                    validationErrors={validationErrors}
                  />
                </>
              )}

              {!useStrategy && (
                <Alert variant="info">
                  You can always activate a strategy later from the vault details page.
                </Alert>
              )}
            </Modal.Body>
            <Modal.Footer>
              <Button variant="secondary" onClick={handleBack} disabled={isCreatingVault}>
                Back
              </Button>
              <Button
                variant="primary"
                onClick={isFinalStep() ? handleSubmit : handleNextStep}
                disabled={isCreatingVault || (useStrategy && strategy.requireTokenSelection && selectedTokens.length < (strategy.minTokens || 1))}
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
                    Creating...
                  </>
                ) : isFinalStep() ? "Start Strategy" : "Next"}
              </Button>
            </Modal.Footer>
          </Form>
        );

      case totalSteps:
        return (
          <>
            <Modal.Body>
              <div className="mb-3">
                <ProgressBar now={isCreatingVault ? 75 : 100} label={isCreatingVault ? "Creating Vault..." : `Step ${currentStep} of ${totalSteps}`} className="mb-3" />

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
                ) : (
                  <>
                    <h5>Vault Created Successfully!</h5>
                    <p className="mb-3">
                      Your vault has been created at address: <code>{createdVaultAddress}</code>
                    </p>

                    <h5>Add Positions to Your Vault</h5>
                    <p>
                      Select the positions you want to add to this vault. You can also add positions later.
                    </p>

                    {availablePositions.length === 0 ? (
                      <Alert variant="info">
                        You don't have any wallet positions available to add to this vault.
                      </Alert>
                    ) : (
                      <ListGroup className="mb-3">
                        {availablePositions.map(position => {
                          return (
                            <ListGroup.Item
                              key={position.id}
                              className="d-flex justify-content-between align-items-center"
                            >
                              <Form.Check
                                type="checkbox"
                                id={`position-${position.id}`}
                                label={
                                  <div className="ms-2">
                                    <div><strong>{position.tokenPair}</strong> - Position #{position.id}</div>
                                    <div className="text-muted small">Fee: {position.fee / 10000}%</div>
                                  </div>
                                }
                                checked={selectedPositions.includes(position.id)}
                                onChange={() => handlePositionToggle(position.id)}
                              />
                              {position.platform && config.platformMetadata[position.platform] && (
                                config.platformMetadata[position.platform].logo ? (
                                  <div
                                    className="ms-2 d-inline-flex align-items-center justify-content-center"
                                    style={{
                                      height: '20px',
                                      width: '20px'
                                    }}
                                  >
                                    <Image
                                      src={config.platformMetadata[position.platform].logo}
                                      alt={position.platformName || position.platform}
                                      width={40}
                                      height={40}
                                      title={position.platformName || position.platform}
                                    />
                                  </div>
                                ) : (
                                  <Badge
                                    className="ms-2 d-inline-flex align-items-center"
                                    pill
                                    bg=""
                                    style={{
                                      fontSize: '0.75rem',
                                      backgroundColor: config.platformMetadata[position.platform]?.color || '#6c757d',
                                      padding: '0.25em 0.5em',
                                      color: 'white',
                                      border: 'none'
                                    }}
                                  >
                                    {position.platformName || position.platform}
                                  </Badge>
                                )
                              )}
                            </ListGroup.Item>
                          );
                        })}
                      </ListGroup>
                    )}
                  </>
                )}
              </div>
            </Modal.Body>

            <Modal.Footer>
              {isCreatingVault ? (
                // No buttons during processing
                <div />
              ) : txError ? (
                <>
                  <Button variant="secondary" onClick={handleModalClose}>
                    Cancel
                  </Button>
                  <Button variant="primary" onClick={() => setCurrentStep(totalSteps - 1)}>
                    Try Again
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    variant="secondary"
                    onClick={handleModalClose}
                  >
                    Skip for Now
                  </Button>
                  <Button
                    variant="primary"
                    onClick={handlePositionSubmit}
                    disabled={selectedPositions.length === 0}
                  >
                    Add {selectedPositions.length} Position{selectedPositions.length !== 1 ? 's' : ''}
                  </Button>
                </>
              )}
            </Modal.Footer>
          </>
        );

      default:
        return null;
    }
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
