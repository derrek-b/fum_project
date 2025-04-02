// src/components/StrategyConfigPanel.js
import React, { useState, useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Card, Form, Button, Alert, Spinner, Row, Col, ProgressBar, OverlayTrigger, Tooltip } from "react-bootstrap";
import { setStrategyConfig, setStrategyActive } from "../../redux/strategiesSlice";
import { useToast } from "../../context/ToastContext";
import { formatTimestamp } from "../../utils/formatHelpers";

// Helper component for parameter inputs
const ParameterInput = ({
  label,
  name,
  value,
  onChange,
  disabled,
  type = "number",
  min,
  max,
  step,
  description
}) => (
  <Form.Group className="mb-3">
    <div className="d-flex justify-content-between align-items-center">
      <Form.Label>
        {label}
        {description && (
          <OverlayTrigger
            placement="top"
            overlay={<Tooltip>{description}</Tooltip>}
          >
            <span className="text-info ms-1" style={{ cursor: "help" }}>ⓘ</span>
          </OverlayTrigger>
        )}
      </Form.Label>
      {type === "switch" ? (
        <Form.Check
          type="switch"
          id={`switch-${name}`}
          checked={value}
          onChange={(e) => onChange(name, e.target.checked)}
          disabled={disabled}
        />
      ) : null}
    </div>

    {type !== "switch" && (
      <Form.Control
        type={type}
        name={name}
        value={value}
        onChange={(e) => onChange(name, type === "number" ? parseFloat(e.target.value) : e.target.value)}
        disabled={disabled}
        min={min}
        max={max}
        step={step}
      />
    )}
  </Form.Group>
);

// Main Strategy Config Panel Component
export default function StrategyConfigPanel({
  vaultAddress,
  isOwner,
  strategyConfig,
  strategyActive,
  performance,
  onStrategyToggle
}) {
  const dispatch = useDispatch();
  const { showError, showSuccess } = useToast();

  // Get available strategies from Redux
  const { availableStrategies } = useSelector((state) => state.strategies);

  // Component state
  const [config, setConfig] = useState({
    strategyId: "the-fed",
    parameters: {
      targetRange: 0.5,
      rebalanceThreshold: 1.0,
      feeReinvestment: true,
      maxSlippage: 0.5
    }
  });
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  // Selected strategy template
  const selectedStrategy = availableStrategies[config.strategyId];

  // Initialize config from props or default values
  useEffect(() => {
    // Only update if we have meaningful changes to prevent loops
    if (strategyConfig) {
      // Check if current config is different from incoming strategyConfig
      const hasChanges = !config ||
        config.strategyId !== strategyConfig.strategyId ||
        JSON.stringify(config.parameters) !== JSON.stringify(strategyConfig.parameters);

      if (hasChanges) {
        setConfig(strategyConfig);
      }
    } else if (selectedStrategy && (!config || config.strategyId !== "the-fed")) {
      // Use default parameters from the strategy template, but only if config is empty
      // or has a different strategy ID to prevent unnecessary re-renders
      setConfig({
        strategyId: "the-fed",
        parameters: { ...selectedStrategy.parameters }
      });
    }
  }, [strategyConfig, selectedStrategy, config]);

  // Handle parameter change
  const handleParameterChange = (name, value) => {
    setConfig({
      ...config,
      parameters: {
        ...config.parameters,
        [name]: value
      }
    });
  };

  // Handle save configuration
  const handleSaveConfig = async () => {
    setSaving(true);

    try {
      // Validate parameters
      if (config.parameters.targetRange < 0.1 || config.parameters.targetRange > 10) {
        throw new Error("Target range must be between 0.1% and 10%");
      }

      if (config.parameters.rebalanceThreshold < 0.1 || config.parameters.rebalanceThreshold > 10) {
        throw new Error("Rebalance threshold must be between 0.1% and 10%");
      }

      if (config.parameters.maxSlippage < 0.1 || config.parameters.maxSlippage > 5) {
        throw new Error("Max slippage must be between 0.1% and 5%");
      }

      // Save to Redux
      dispatch(setStrategyConfig({
        vaultAddress,
        strategyId: config.strategyId,
        config: {
          parameters: config.parameters,
          lastUpdated: Date.now()
        }
      }));

      // Exit editing mode
      setIsEditing(false);
      showSuccess("Strategy configuration saved");
    } catch (error) {
      console.error("Error saving strategy config:", error);
      showError(error.message);
    } finally {
      setSaving(false);
    }
  };

  // Handle toggle strategy activation
  const handleToggleActivation = async () => {
    setToggling(true);

    try {
      // Call parent handler (which would handle contract interaction)
      await onStrategyToggle(!strategyActive);

      // Update Redux state
      dispatch(setStrategyActive({
        vaultAddress,
        isActive: !strategyActive
      }));

      showSuccess(`Strategy ${!strategyActive ? 'activated' : 'deactivated'} successfully`);
    } catch (error) {
      console.error("Error toggling strategy:", error);
      showError(`Failed to ${!strategyActive ? 'activate' : 'deactivate'} strategy: ${error.message}`);
    } finally {
      setToggling(false);
    }
  };

  // Function to render strategy health indicators
  const renderHealthIndicators = () => {
    if (!performance) return null;

    return (
      <Card className="mb-4">
        <Card.Header>Strategy Health</Card.Header>
        <Card.Body>
          <Row>
            <Col md={6}>
              <div className="mb-3">
                <div className="d-flex justify-content-between mb-1">
                  <span>Efficiency</span>
                  <span>{performance.efficiency ? `${performance.efficiency}%` : 'N/A'}</span>
                </div>
                <ProgressBar
                  now={performance.efficiency || 0}
                  variant={performance.efficiency > 70 ? "success" : performance.efficiency > 40 ? "warning" : "danger"}
                />
              </div>
            </Col>
            <Col md={6}>
              <div className="mb-3">
                <div className="d-flex justify-content-between mb-1">
                  <span>Profitability</span>
                  <span>{performance.profitability ? `${performance.profitability}%` : 'N/A'}</span>
                </div>
                <ProgressBar
                  now={performance.profitability || 0}
                  variant={performance.profitability > 70 ? "success" : performance.profitability > 40 ? "warning" : "danger"}
                />
              </div>
            </Col>
          </Row>
          <div className="text-muted small mt-2">
            Last updated: {performance.lastUpdated ? formatTimestamp(performance.lastUpdated) : 'Never'}
          </div>
        </Card.Body>
      </Card>
    );
  };

  // If no strategy selected
  if (!selectedStrategy) {
    return (
      <Alert variant="warning">
        Selected strategy template not found. Please contact support.
      </Alert>
    );
  }

  return (
    <div>
      {/* Strategy Overview */}
      <Card className="mb-4">
        <Card.Header>
          <div className="d-flex justify-content-between align-items-center">
            <h5 className="mb-0">The Fed Strategy</h5>
            {isOwner && !isEditing && (
              <Button
                variant="outline-primary"
                size="sm"
                onClick={() => setIsEditing(true)}
                disabled={saving || toggling}
              >
                Edit Configuration
              </Button>
            )}
          </div>
        </Card.Header>
        <Card.Body>
          <p>{selectedStrategy.description}</p>

          <div className="mb-3">
            <strong>Status:</strong>{" "}
            <span className={strategyActive ? "text-success" : "text-muted"}>
              {strategyActive ? "Active" : "Inactive"}
            </span>
          </div>

          {performance && (
            <div className="mb-3">
              <strong>Performance:</strong>{" "}
              <span className={
                performance.apy > 10 ? "text-success" :
                performance.apy > 5 ? "text-primary" :
                performance.apy > 0 ? "text-warning" : "text-danger"
              }>
                {performance.apy ? `${performance.apy.toFixed(2)}% APY` : 'Not enough data'}
              </span>
            </div>
          )}

          <div className="mb-3">
            <strong>Supported Pairs:</strong>{" "}
            <span>
              {selectedStrategy.supportedPairs.join(", ")}
            </span>
          </div>

          {isOwner && !isEditing && (
            <Button
              variant={strategyActive ? "outline-danger" : "success"}
              className="mt-3"
              onClick={handleToggleActivation}
              disabled={toggling}
            >
              {toggling ? (
                <>
                  <Spinner animation="border" size="sm" className="me-2" />
                  {strategyActive ? "Deactivating..." : "Activating..."}
                </>
              ) : (
                strategyActive ? "Deactivate Strategy" : "Activate Strategy"
              )}
            </Button>
          )}
        </Card.Body>
      </Card>

      {/* Strategy Health (only show when we have performance data) */}
      {performance && renderHealthIndicators()}

      {/* Strategy Configuration */}
      <Card>
        <Card.Header>
          <div className="d-flex justify-content-between align-items-center">
            <h5 className="mb-0">Configuration</h5>
            {isEditing && (
              <div>
                <Button
                  variant="outline-secondary"
                  size="sm"
                  className="me-2"
                  onClick={() => setIsEditing(false)}
                  disabled={saving}
                >
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleSaveConfig}
                  disabled={saving}
                >
                  {saving ? (
                    <>
                      <Spinner animation="border" size="sm" className="me-2" />
                      Saving...
                    </>
                  ) : "Save"}
                </Button>
              </div>
            )}
          </div>
        </Card.Header>
        <Card.Body>
          {!isEditing ? (
            // Read-only view
            <dl className="row">
              <dt className="col-sm-4">Target Range</dt>
              <dd className="col-sm-8">{config.parameters.targetRange}%</dd>

              <dt className="col-sm-4">Rebalance Threshold</dt>
              <dd className="col-sm-8">{config.parameters.rebalanceThreshold}%</dd>

              <dt className="col-sm-4">Fee Reinvestment</dt>
              <dd className="col-sm-8">{config.parameters.feeReinvestment ? "Enabled" : "Disabled"}</dd>

              <dt className="col-sm-4">Max Slippage</dt>
              <dd className="col-sm-8">{config.parameters.maxSlippage}%</dd>
            </dl>
          ) : (
            // Editable form
            <Form>
              <ParameterInput
                label="Target Range (%)"
                name="targetRange"
                value={config.parameters.targetRange}
                onChange={handleParameterChange}
                disabled={saving}
                type="number"
                min={0.1}
                max={10}
                step={0.1}
                description={selectedStrategy.parameterDescriptions.targetRange}
              />

              <ParameterInput
                label="Rebalance Threshold (%)"
                name="rebalanceThreshold"
                value={config.parameters.rebalanceThreshold}
                onChange={handleParameterChange}
                disabled={saving}
                type="number"
                min={0.1}
                max={10}
                step={0.1}
                description={selectedStrategy.parameterDescriptions.rebalanceThreshold}
              />

              <ParameterInput
                label="Fee Reinvestment"
                name="feeReinvestment"
                value={config.parameters.feeReinvestment}
                onChange={handleParameterChange}
                disabled={saving}
                type="switch"
                description={selectedStrategy.parameterDescriptions.feeReinvestment}
              />

              <ParameterInput
                label="Max Slippage (%)"
                name="maxSlippage"
                value={config.parameters.maxSlippage}
                onChange={handleParameterChange}
                disabled={saving}
                type="number"
                min={0.1}
                max={5}
                step={0.1}
                description={selectedStrategy.parameterDescriptions.maxSlippage}
              />
            </Form>
          )}

          <div className="mt-3">
            <Alert variant="info">
              <strong>How This Strategy Works:</strong>
              <p className="mb-0 mt-2">
                The Fed strategy optimizes liquidity positions for stablecoin pairs by:
              </p>
              <ul className="mb-0 mt-2">
                <li>Setting narrow ranges based on historical volatility</li>
                <li>Monitoring peg deviations to rebalance efficiently</li>
                <li>Automatically reinvesting collected fees for compounding returns</li>
                <li>Adjusting positions to optimize for volume and fee generation</li>
              </ul>
            </Alert>
          </div>
        </Card.Body>
      </Card>
    </div>
  );
}
