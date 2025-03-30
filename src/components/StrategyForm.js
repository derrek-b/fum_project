// src/components/StrategyForm.js
import React from "react";
import { Form, Card, Alert, OverlayTrigger, Tooltip, Row, Col } from "react-bootstrap";
import { getStrategyDetails } from "../utils/strategyConfig";

/**
 * Dynamic strategy configuration form
 */
const StrategyForm = ({ strategyId, params, onParamChange, disabled, validationErrors = {} }) => {
  const strategy = getStrategyDetails(strategyId);

  if (!strategy) {
    return (
      <Alert variant="danger">
        Strategy configuration not found. Please select a different strategy.
      </Alert>
    );
  }

  // Handle "coming soon" strategies
  if (strategy.comingSoon) {
    return (
      <Alert variant="info">
        <h5>{strategy.name} - {strategy.subtitle}</h5>
        <p>{strategy.description}</p>
        <p className="mb-0">This strategy is coming soon and is not yet available.</p>
      </Alert>
    );
  }

  // Render the strategy description card
  const renderStrategyInfo = () => (
    <Card className="mb-4">
      <Card.Header>{strategy.name} - {strategy.subtitle}</Card.Header>
      <Card.Body>
        <p>{strategy.description}</p>
        <p className="mb-0">
          <strong>Best for:</strong> {strategy.bestFor}
        </p>
      </Card.Body>
    </Card>
  );

  // Check if a parameter should be shown based on dependencies
  const shouldShowParameter = (paramDef) => {
    if (!paramDef.dependsOn) return true;

    const { parameter, value } = paramDef.dependsOn;
    return params[parameter] === value;
  };

  // Render a form control based on parameter definition
  const renderControl = (paramDef) => {
    // Skip parameters that shouldn't be shown based on dependencies
    if (!shouldShowParameter(paramDef)) return null;

    const value = params[paramDef.id] !== undefined ? params[paramDef.id] : paramDef.default;
    const hasError = !!validationErrors[paramDef.id];

    // Format help text with the current value if needed
    const formattedHelpText = paramDef.helpText?.replace('{value}', value);

    switch (paramDef.type) {
      case 'boolean':
        return (
          <Form.Group className="mb-3" key={paramDef.id}>
            <div className="d-flex justify-content-between align-items-center">
              <Form.Label>
                {paramDef.name}
                <OverlayTrigger
                  placement="top"
                  overlay={<Tooltip>{paramDef.description}</Tooltip>}
                >
                  <span className="text-info ms-1" style={{ cursor: "help" }}>ⓘ</span>
                </OverlayTrigger>
              </Form.Label>
              <Form.Check
                type="switch"
                id={`switch-${paramDef.id}`}
                checked={!!value}
                onChange={(e) => onParamChange(paramDef.id, e.target.checked)}
                disabled={disabled}
                isInvalid={hasError}
              />
            </div>
            {formattedHelpText && (
              <Form.Text className="text-muted">
                {formattedHelpText}
              </Form.Text>
            )}
            {hasError && (
              <Form.Control.Feedback type="invalid">
                {validationErrors[paramDef.id]}
              </Form.Control.Feedback>
            )}
          </Form.Group>
        );

      case 'slider':
        return (
          <Form.Group className="mb-3" key={paramDef.id}>
            <Form.Label>
              {paramDef.name} {paramDef.unit && `(${paramDef.unit})`}
              <OverlayTrigger
                placement="top"
                overlay={<Tooltip>{paramDef.description}</Tooltip>}
              >
                <span className="text-info ms-1" style={{ cursor: "help" }}>ⓘ</span>
              </OverlayTrigger>
            </Form.Label>
            <div>
              <Row className="align-items-center">
                <Col xs={9}>
                  <Form.Range
                    value={value}
                    onChange={(e) => onParamChange(paramDef.id, parseInt(e.target.value, 10))}
                    min={paramDef.min}
                    max={paramDef.max}
                    step={paramDef.step}
                    disabled={disabled}
                  />
                </Col>
                <Col xs={3} className="ps-0">
                  <div className="border rounded text-center p-1">
                    {value}{paramDef.unit}
                  </div>
                </Col>
              </Row>
            </div>
            {formattedHelpText && (
              <Form.Text className="text-muted">
                {formattedHelpText}
              </Form.Text>
            )}
          </Form.Group>
        );

      case 'number':
        return (
          <Form.Group className="mb-3" key={paramDef.id}>
            <div className="d-flex justify-content-between align-items-center">
              <Form.Label>
                {paramDef.name} {paramDef.unit && `(${paramDef.unit})`}
                <OverlayTrigger
                  placement="top"
                  overlay={<Tooltip>{paramDef.description}</Tooltip>}
                >
                  <span className="text-info ms-1" style={{ cursor: "help" }}>ⓘ</span>
                </OverlayTrigger>
              </Form.Label>
            </div>
            <Form.Control
              type="number"
              value={value}
              onChange={(e) => {
                const newValue = e.target.value === '' ? '' : parseFloat(e.target.value);
                onParamChange(paramDef.id, newValue);
              }}
              min={paramDef.min}
              max={paramDef.max}
              step={paramDef.step}
              disabled={disabled}
              isInvalid={hasError}
            />
            {formattedHelpText && (
              <Form.Text className="text-muted">
                {formattedHelpText}
              </Form.Text>
            )}
            {hasError && (
              <Form.Control.Feedback type="invalid">
                {validationErrors[paramDef.id]}
              </Form.Control.Feedback>
            )}
          </Form.Group>
        );

      case 'string':
        return (
          <Form.Group className="mb-3" key={paramDef.id}>
            <Form.Label>
              {paramDef.name}
              <OverlayTrigger
                placement="top"
                overlay={<Tooltip>{paramDef.description}</Tooltip>}
              >
                <span className="text-info ms-1" style={{ cursor: "help" }}>ⓘ</span>
              </OverlayTrigger>
            </Form.Label>
            <Form.Control
              type="text"
              value={value || ''}
              onChange={(e) => onParamChange(paramDef.id, e.target.value)}
              disabled={disabled}
              isInvalid={hasError}
            />
            {formattedHelpText && (
              <Form.Text className="text-muted">
                {formattedHelpText}
              </Form.Text>
            )}
            {hasError && (
              <Form.Control.Feedback type="invalid">
                {validationErrors[paramDef.id]}
              </Form.Control.Feedback>
            )}
          </Form.Group>
        );

      default:
        return null;
    }
  };

  return (
    <div>
      {renderStrategyInfo()}

      <h6 className="mb-3">Strategy Parameters</h6>

      {strategy.parameters.map(paramDef => renderControl(paramDef))}
    </div>
  );
};

export default StrategyForm;
