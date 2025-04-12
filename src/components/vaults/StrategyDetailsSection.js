// src/components/vault_wizard/StrategyDetailsSection.js
import React, { useState, useEffect, useMemo } from 'react';
import { useSelector } from 'react-redux';
import {
  Card,
  Button,
  Alert,
  Accordion,
  Badge,
  Form,
  Row,
  Col,
  ListGroup,
  Image
} from 'react-bootstrap';
import { GearFill, InfoCircle, BookmarkStar, Wallet, Bank } from 'react-bootstrap-icons';
import { useToast } from '../../context/ToastContext';
import CustomParameterLayout from './CustomParameterLayout';
import {
  getStrategyDetails,
  getStrategyParameters,
  getStrategyLayouts,
  validateStrategyParams,
  getDefaultParams,
  getStrategyTemplates,
  getTemplateDefaults
} from '../../utils/strategyConfig';
import { getAvailablePlatforms } from '../../utils/config';
import { getAllTokens } from '../../utils/tokenConfig';

/**
 * Displays and allows editing of detailed strategy configuration for a vault
 */
const StrategyDetailsSection = ({
  vaultAddress,
  isOwner,
  strategyId,
  strategyActive,
  editMode,
  onEditRequest,
  onCancel,
  onValidate,
  onParamsChange
}) => {
  const { showError } = useToast();

  // Get current vault data from Redux
  const vault = useSelector((state) =>
    state.vaults.userVaults.find(v => v.address === vaultAddress)
  );
  const currentStrategy = vault?.strategy || null;

  // Get current chain ID
  const chainId = useSelector((state) => state.wallet.chainId) || 1; // Default to Ethereum if not set

  // Get vault token balances
  const vaultTokenBalances = useSelector((state) => {
    if (!vaultAddress) return {};

    const vault = state.vaults.userVaults.find(v => v.address === vaultAddress);
    return vault?.tokenBalances || {};
  });

  // Component state
  const [params, setParams] = useState({});
  const [errors, setErrors] = useState({});
  const [activePreset, setActivePreset] = useState('custom');
  const [selectedTokens, setSelectedTokens] = useState([]);
  const [selectedPlatforms, setSelectedPlatforms] = useState([]);

  // Derived values
  const strategyDetails = useMemo(() => {
    if (!strategyId || strategyId === 'none') return null;
    return getStrategyDetails(strategyId);
  }, [strategyId]);

  // Get parameter definitions
  const parameterDefinitions = useMemo(() => {
    if (!strategyId || strategyId === 'none') return {};
    return getStrategyParameters(strategyId);
  }, [strategyId]);

  // Get parameter groups
  const parameterGroups = useMemo(() => {
    if (!strategyDetails) return [];
    return strategyDetails.parameterGroups || [];
  }, [strategyDetails]);

  // Get strategy templates/presets
  const strategyTemplates = useMemo(() => {
    if (!strategyId || strategyId === 'none') return [];
    return getStrategyTemplates(strategyId);
  }, [strategyId]);

  // Get available tokens for the selected strategy
  const availableTokens = useMemo(() => {
    if (!strategyId || strategyId === 'none') {
      return getAllTokens();
    }

    const strategyDetails = getStrategyDetails(strategyId);
    return strategyDetails?.supportedTokens || getAllTokens();
  }, [strategyId]);

  // Get available platforms for the current chain
  const availablePlatforms = useMemo(() => {
    return getAvailablePlatforms(chainId);
  }, [chainId]);

  // Get layout configurations
  const layouts = useMemo(() => {
    if (!strategyId || strategyId === 'none') return {};

    // Combine layouts from all steps into one object
    const allLayouts = {};
    const steps = strategyDetails?.totalParameterSteps || 0;

    for (let step = 1; step <= steps; step++) {
      const stepLayouts = getStrategyLayouts(strategyId, step + 2);
      if (stepLayouts) {
        Object.assign(allLayouts, stepLayouts);
      }
    }

    return allLayouts;
  }, [strategyId, strategyDetails]);

  // Initialize from current strategy config or defaults
  useEffect(() => {
    if (!strategyId || strategyId === 'none') {
      setParams({});
      setActivePreset('custom');
      setSelectedTokens([]);
      setSelectedPlatforms([]);
      return;
    }

    // Check if we have saved parameters in the vault strategy object
    if (currentStrategy?.parameters && currentStrategy.strategyId === strategyId) {
      setParams(currentStrategy.parameters);

      setActivePreset(currentStrategy.activeTemplate);

      // Set tokens and platforms if available
      if (currentStrategy.selectedTokens) {
        setSelectedTokens(currentStrategy.selectedTokens);
      }

      if (currentStrategy.selectedPlatforms) {
        setSelectedPlatforms(currentStrategy.selectedPlatforms);
      }
    } else {
      // Otherwise use default parameters for the strategy
      setParams(getDefaultParams(strategyId));
      setActivePreset('custom');

      // Reset tokens and platforms
      setSelectedTokens([]);
      setSelectedPlatforms([]);
    }

    // Reset errors
    setErrors({});
  }, [strategyId, currentStrategy]);

  // Update parent when params change
  useEffect(() => {
    if (onParamsChange) {
      onParamsChange({
        parameters: params,
        selectedTokens,
        selectedPlatforms,
        activePreset
      });
    }
  }, [params, selectedTokens, selectedPlatforms, activePreset]);

  // Expose validation functionality - only register once
  useEffect(() => {
    if (onValidate) {
      onValidate(validateParams);
    }
  }, [onValidate]);

  // Handle token selection
  const handleTokenToggle = (symbol) => {
    if (!editMode) return;

    setSelectedTokens(prev => {
      if (prev.includes(symbol)) {
        return prev.filter(t => t !== symbol);
      } else {
        return [...prev, symbol];
      }
    });
  };

  // Handle platform selection
  const handlePlatformToggle = (platformId) => {
    if (!editMode) return;

    setSelectedPlatforms(prev => {
      if (prev.includes(platformId)) {
        return prev.filter(p => p !== platformId);
      } else {
        return [...prev, platformId];
      }
    });
  };

  // Reset form to original values
  const resetForm = () => {
    if (currentStrategy?.parameters && currentStrategy.strategyId === strategyId) {
      setParams(currentStrategy.parameters);

      // Try to detect which preset matches the original parameters
      detectActivePreset(currentStrategy.parameters);

      // Reset tokens and platforms from current strategy
      if (currentStrategy.selectedTokens) {
        setSelectedTokens(currentStrategy.selectedTokens);
      } else {
        setSelectedTokens([]);
      }

      if (currentStrategy.selectedPlatforms) {
        setSelectedPlatforms(currentStrategy.selectedPlatforms);
      } else {
        setSelectedPlatforms([]);
      }
    } else {
      setParams(getDefaultParams(strategyId));
      setActivePreset('custom');
      setSelectedTokens([]);
      setSelectedPlatforms([]);
    }

    setErrors({});

    // Notify parent of cancel
    if (onCancel) {
      onCancel();
    }
  };

  // Detect which preset (if any) the current parameters match
  const detectActivePreset = (parameters) => {
    if (!strategyId || !parameters) {
      setActivePreset('custom');
      return;
    }

    const templates = getStrategyTemplates(strategyId);

    // Skip the "custom" template
    const presetTemplates = templates.filter(t => t.id !== 'custom' && t.defaults);

    // Try to find a matching preset
    for (const template of presetTemplates) {
      const defaults = template.defaults;
      const defaultKeys = Object.keys(defaults);

      // Check if all values match the preset
      const allMatch = defaultKeys.every(key => {
        // Handle special cases like arrays or objects
        if (typeof defaults[key] === 'object') {
          return JSON.stringify(defaults[key]) === JSON.stringify(parameters[key]);
        }
        return defaults[key] === parameters[key];
      });

      if (allMatch) {
        setActivePreset(template.id);
        return;
      }
    }

    // If no match found, it's a custom configuration
    setActivePreset('custom');
  };

  // Apply a preset template
  const applyPreset = (presetId) => {
    if (!editMode) return;

    setActivePreset(presetId);

    if (presetId === 'custom') {
      // For custom, we don't change the current parameters
      return;
    }

    // Get the template defaults
    const defaults = getTemplateDefaults(strategyId, presetId);
    if (defaults) {
      setParams(defaults);
      // Clear any validation errors
      setErrors({});
    }
  };

  // Handle parameter change
  const handleParamChange = (paramId, value) => {
    setParams(prev => ({
      ...prev,
      [paramId]: value
    }));

    // Clear validation error for this field if exists
    if (errors[paramId]) {
      setErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[paramId];
        return newErrors;
      });
    }
  };

  // Validate parameters
  const validateParams = () => {
    if (!strategyId || strategyId === 'none') return true;

    // Clear previous errors first
    setErrors({});

    // Validate strategy specific parameters
    const validation = validateStrategyParams(strategyId, params);
    let isValid = validation.isValid;
    const allErrors = { ...validation.errors };

    // Validate selected tokens
    const strategyDetails = getStrategyDetails(strategyId);
    if (strategyDetails?.minTokens && selectedTokens.length < strategyDetails.minTokens) {
      isValid = false;
      allErrors.tokens = `At least ${strategyDetails.minTokens} tokens must be selected`;
    }

    // Validate platforms
    if (selectedPlatforms.length === 0) {
      isValid = false;
      allErrors.platforms = 'At least one platform must be selected';
    }

    // Set errors if any
    if (!isValid) {
      setErrors(allErrors);

      // Show more specific error message
      const errorCount = Object.keys(allErrors).length;
      showError(`Please correct ${errorCount} field error${errorCount > 1 ? 's' : ''} in the form`);

      return false;
    }

    return true;
  };

  // Render preset selection
  const renderPresetSelection = () => {
    if (!strategyTemplates || strategyTemplates.length <= 1) {
      return null;
    }

    return (
      <Accordion.Item eventKey="presets">
        <Accordion.Header>
          <div className="d-flex align-items-center">
            <BookmarkStar className="me-2" />
            Presets
          </div>
        </Accordion.Header>
        <Accordion.Body>
          <p className="text-muted mb-3">
            Choose a preset configuration or customize your own settings.
          </p>

          <div className="preset-options">
            <div className="d-flex flex-wrap">
              {strategyTemplates.map(template => (
                <div key={template.id} className="me-3 mb-3" style={{ width: 'auto', minWidth: '200px', maxWidth: '300px' }}>
                  <Card
                    className={`h-100 ${activePreset === template.id ? 'border-primary' : ''}`}
                    style={{ cursor: editMode ? 'pointer' : 'default' }}
                    onClick={() => editMode && applyPreset(template.id)}
                  >
                    <Card.Body>
                      <div className="d-flex align-items-start">
                        <Form.Check
                          type="radio"
                          id={`preset-${template.id}`}
                          name="strategy-preset"
                          checked={activePreset === template.id}
                          onChange={() => applyPreset(template.id)}
                          disabled={!editMode}
                          className="mt-1 me-2"
                        />
                        <div>
                          <div className="fw-bold">{template.name}</div>
                          <small className="text-muted">{template.description}</small>
                        </div>
                      </div>
                    </Card.Body>
                  </Card>
                </div>
              ))}
            </div>
          </div>

          {editMode && activePreset !== 'custom' && (
            <div className="mt-3">
              <Alert variant="info" className="d-flex align-items-center">
                <InfoCircle className="me-2" size={20} />
                <div>
                  Using <strong>{strategyTemplates.find(t => t.id === activePreset)?.name}</strong> preset.
                  You can modify individual settings below to customize.
                </div>
              </Alert>
            </div>
          )}
        </Accordion.Body>
      </Accordion.Item>
    );
  };

  // Render token selection section
  const renderTokenSelection = () => {
    if (!strategyId || strategyId === 'none') return null;

    const tokenList = Object.entries(availableTokens);
    if (tokenList.length === 0) return null;

    return (
      <Accordion.Item eventKey="tokens">
        <Accordion.Header>
          <div className="d-flex align-items-center">
            <Wallet className="me-2" />
            Token Selection
          </div>
        </Accordion.Header>
        <Accordion.Body>
          <p className="text-muted mb-3">
            Select which tokens this strategy will manage.
            {strategyDetails?.minTokens && (
              <span className="ms-1">At least {strategyDetails.minTokens} tokens required.</span>
            )}
          </p>

          {errors.tokens && (
            <Alert variant="danger">{errors.tokens}</Alert>
          )}

          <ListGroup>
            {tokenList.map(([symbol, token]) => {
              // Check if token has balance in vault
              const hasBalance = vaultTokenBalances[symbol] && parseFloat(vaultTokenBalances[symbol].balance) > 0;
              return (
                <ListGroup.Item
                  key={symbol}
                  className="d-flex justify-content-between align-items-center"
                  disabled={!editMode || !hasBalance}
                >
                  <div className="d-flex align-items-center">
                    {token.logoURI && (
                      <Image
                        src={token.logoURI}
                        width={24}
                        height={24}
                        className="me-2"
                        alt={symbol}
                      />
                    )}
                    <div>
                      <div className="fw-bold">{symbol}</div>
                      <small className="text-muted">{token.name}</small>
                    </div>

                    {vaultTokenBalances[symbol] && (
                      <Badge bg="info" className="ms-2">
                        Balance: {parseFloat(vaultTokenBalances[symbol].balance).toFixed(4)}
                      </Badge>
                    )}

                    {!hasBalance && (
                      <Badge bg="secondary" className="ms-2">
                        No balance
                      </Badge>
                    )}
                  </div>

                  <Form.Check
                    type="checkbox"
                    checked={selectedTokens.includes(symbol)}
                    onChange={() => handleTokenToggle(symbol)}
                    disabled={!editMode || !hasBalance}
                  />
                </ListGroup.Item>
              );
            })}
          </ListGroup>

          {selectedTokens.length > 0 && (
            <div className="mt-3 text-end">
              <small className="text-muted">
                {selectedTokens.length} token(s) selected
              </small>
            </div>
          )}
        </Accordion.Body>
      </Accordion.Item>
    );
  };

  // Render platform selection section
  const renderPlatformSelection = () => {
    if (!strategyId || strategyId === 'none') return null;

    if (availablePlatforms.length === 0) return null;

    return (
      <Accordion.Item eventKey="platforms">
        <Accordion.Header>
          <div className="d-flex align-items-center">
            <Bank className="me-2" />
            Platform Selection
          </div>
        </Accordion.Header>
        <Accordion.Body>
          <p className="text-muted mb-3">
            Select which platforms this strategy will use for liquidity positions.
          </p>

          {errors.platforms && (
            <Alert variant="danger">{errors.platforms}</Alert>
          )}

          <Row>
            {availablePlatforms.map(platform => (
              <Col md={6} key={platform.id} className="mb-3">
                <Card
                  className={`h-100 ${selectedPlatforms.includes(platform.id) ? 'border-primary' : ''}`}
                  style={{ cursor: editMode ? 'pointer' : 'default' }}
                  onClick={() => editMode && handlePlatformToggle(platform.id)}
                >
                  <Card.Body>
                    <div className="d-flex align-items-start">
                      <Form.Check
                        type="checkbox"
                        id={`platform-${platform.id}`}
                        checked={selectedPlatforms.includes(platform.id)}
                        onChange={() => handlePlatformToggle(platform.id)}
                        disabled={!editMode}
                        className="mt-1 me-2"
                      />
                      <div className="d-flex align-items-center">
                        {platform.logo && (
                          <Image
                            src={platform.logo}
                            width={24}
                            height={24}
                            className="me-2"
                            alt={platform.name}
                          />
                        )}
                        <div>
                          <div className="fw-bold">{platform.name}</div>
                          <small className="text-muted">{platform.description}</small>
                        </div>
                      </div>
                    </div>
                  </Card.Body>
                </Card>
              </Col>
            ))}
          </Row>

          {selectedPlatforms.length > 0 && (
            <div className="mt-3 text-end">
              <small className="text-muted">
                {selectedPlatforms.length} platform(s) selected
              </small>
            </div>
          )}
        </Accordion.Body>
      </Accordion.Item>
    );
  };

  // Render group parameters using CustomParameterLayout
  const renderParameterGroup = (groupId) => {
    // Filter layouts that belong to this group
    const groupLayouts = Object.entries(layouts)
      .filter(([key, layout]) => layout.groupId === groupId)
      .map(([key, layout]) => ({
        key,
        ...layout
      }));

    if (groupLayouts.length === 0) {
      // Fallback when no layout is defined - create a simple one
      const groupParameters = Object.entries(parameterDefinitions)
        .filter(([paramId, config]) => config.group === groupId)
        .reduce((acc, [paramId, config]) => {
          acc[paramId] = config;
          return acc;
        }, {});

      if (Object.keys(groupParameters).length === 0) {
        return null;
      }

      // Create a fallback layout
      return (
        <Card className="mb-3">
          <Card.Body>
            <Form>
              {Object.entries(groupParameters).map(([paramId, config]) => {
                // Skip conditional parameters that aren't applicable
                if (config.conditionalOn && params[config.conditionalOn] !== config.conditionalValue) {
                  return null;
                }

                return renderParameter(paramId, config);
              })}
            </Form>
          </Card.Body>
        </Card>
      );
    }

    // Use custom layouts
    return groupLayouts.map(layout => (
      <CustomParameterLayout
        key={layout.key}
        layout={layout}
        params={{
          ...params,
          _paramConfigs: parameterDefinitions  // Pass parameter configs for reference
        }}
        onParamChange={handleParamChange}
        disabled={!editMode}
        validationErrors={errors}
      />
    ));
  };

  // Render individual parameter (used in fallback mode)
  const renderParameter = (paramId, config) => {
    const value = params[paramId] !== undefined ? params[paramId] : config.defaultValue;

    // Make sure we check for errors properly
    const error = errors && errors[paramId];

    switch (config.type) {
      case 'boolean':
        return (
          <Form.Group className="mb-3" key={paramId}>
            <Form.Check
              type="switch"
              id={`param-${paramId}`}
              label={config.name}
              checked={!!value}
              onChange={(e) => handleParamChange(paramId, e.target.checked)}
              disabled={!editMode}
              isInvalid={!!error}
            />
            <Form.Text className="text-muted">{config.description}</Form.Text>
            <Form.Control.Feedback type="invalid">{error}</Form.Control.Feedback>
          </Form.Group>
        );

      case 'select':
        return (
          <Form.Group className="mb-3" key={paramId}>
            <Form.Label>{config.name}</Form.Label>
            <Form.Select
              value={value}
              onChange={(e) => handleParamChange(paramId, e.target.value)}
              disabled={!editMode}
              isInvalid={!!error}
            >
              {config.options.map(option => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Form.Select>
            <Form.Text className="text-muted">{config.description}</Form.Text>
            <Form.Control.Feedback type="invalid">{error}</Form.Control.Feedback>
          </Form.Group>
        );

      case 'number':
      default:
        return (
          <Form.Group className="mb-3" key={paramId}>
            <Form.Label>{config.name}</Form.Label>
            <div className="input-group">
              {config.prefix && <div className="input-group-prepend">
                <span className="input-group-text">{config.prefix}</span>
              </div>}

              <Form.Control
                type="number"
                value={value}
                onChange={(e) => {
                  const val = e.target.value === '' ? '' : parseFloat(e.target.value);
                  handleParamChange(paramId, val);
                }}
                min={config.min}
                max={config.max}
                step={config.step}
                disabled={!editMode}
                isInvalid={!!error}
              />

              {config.suffix && <div className="input-group-append">
                <span className="input-group-text">{config.suffix}</span>
              </div>}

              <Form.Control.Feedback type="invalid">{error}</Form.Control.Feedback>
            </div>
            <Form.Text className="text-muted">{config.description}</Form.Text>
          </Form.Group>
        );
    }
  };

  // If no strategy is selected, show information message
  if (!strategyId || strategyId === 'none') {
    return (
      <Alert variant="info">
        No strategy selected. Select a strategy and activate it to enable automated management.
      </Alert>
    );
  }

  // If no strategy details available
  if (!strategyDetails) {
    return (
      <Alert variant="warning">
        Selected strategy information not found. Please select a different strategy.
      </Alert>
    );
  }

  return (
    <div className="strategy-details-section mt-3">
      {/* Strategy information header */}
      <div className="mb-3">
        <div className="d-flex justify-content-between align-items-center">
          <div>
            <h5 className="mb-1">{strategyDetails.name}</h5>
            <p className="text-muted mb-0">{strategyDetails.description}</p>
          </div>

          {!editMode && isOwner && (
            <Button
              variant="outline-primary"
              size="sm"
              onClick={onEditRequest}
            >
              <GearFill className="me-1" /> Edit Settings
            </Button>
          )}
        </div>

        {strategyActive && (
          <Badge bg="success" className="mt-2">Active</Badge>
        )}
      </div>

      {/* Edit mode alert */}
      {editMode && (
        <Alert variant="danger" className="mb-3">
          <div className="d-flex justify-content-between align-items-center">
            <div>
              <InfoCircle className="me-2" />
              You're editing the strategy configuration. Make your changes and save when done.
            </div>
            <div>
              <Button
                variant="outline-light"
                size="sm"
                onClick={resetForm}
              >
                Cancel
              </Button>
            </div>
          </div>
        </Alert>
      )}

      {/* Parameter Groups */}
      <Accordion defaultActiveKey={['presets', 'tokens', 'platforms']} alwaysOpen>
        {/* Presets Section */}
        {renderPresetSelection()}

        {/* Token Selection Section */}
        {renderTokenSelection()}

        {/* Platform Selection Section */}
        {renderPlatformSelection()}

        {/* Parameter Groups */}
        {parameterGroups.map((group, index) => (
          <Accordion.Item key={`param-${index}`} eventKey={`param-${index}`}>
            <Accordion.Header>{group.name}</Accordion.Header>
            <Accordion.Body>
              {group.description && (
                <p className="text-muted mb-3">{group.description}</p>
              )}
              {renderParameterGroup(index)}
            </Accordion.Body>
          </Accordion.Item>
        ))}
      </Accordion>
    </div>
  );
};

export default StrategyDetailsSection;
