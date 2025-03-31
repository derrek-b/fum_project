// src/components/CustomParameterLayout.js
import React from 'react';
import { Card, Form, Row, Col, InputGroup, OverlayTrigger, Tooltip } from 'react-bootstrap';
import { InfoCircle } from 'react-bootstrap-icons';

/**
 * Component to render custom parameter layouts
 */
const CustomParameterLayout = ({
  layout,
  params,
  onParamChange,
  disabled,
  validationErrors = {}
}) => {
  if (!layout || !layout.sections) return null;

  /**
   * Renders a tooltip next to a label
   */
  const renderTooltip = (description) => {
    if (!description) return null;

    return (
      <OverlayTrigger
        placement="top"
        overlay={<Tooltip>{description}</Tooltip>}
      >
        <InfoCircle size={16} className="ms-2 text-muted" style={{ cursor: 'help' }} />
      </OverlayTrigger>
    );
  };

  /**
   * Renders a form input based on parameter definition and field configuration
   */
  const renderInput = (field, paramConfig) => {
    if (!paramConfig) return null;

    const value = params[field.id] !== undefined ? params[field.id] : '';
    const error = validationErrors[field.id];

    // Default to parameter config if not specified in field
    const min = field.min ?? paramConfig.min;
    const max = field.max ?? paramConfig.max;
    const step = field.step ?? paramConfig.step;
    const fieldType = field.type || paramConfig.type || 'number';

    // For select inputs
    if (fieldType === 'select') {
      return (
        <Form.Select
          value={value}
          onChange={(e) => onParamChange(field.id, e.target.value)}
          disabled={disabled}
          isInvalid={!!error}
          size={field.size || "md"}
          style={field.style}
        >
          {paramConfig.options.map(option => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Form.Select>
      );
    }

    // For boolean inputs
    if (fieldType === 'boolean') {
      return (
        <Form.Check
          type="switch"
          id={`switch-${field.id}`}
          checked={!!value}
          onChange={(e) => onParamChange(field.id, e.target.checked)}
          disabled={disabled}
          isInvalid={!!error}
        />
      );
    }

    // For number inputs (default)
    return (
      <InputGroup size={field.size || "md"} hasValidation>
        {field.prefix || paramConfig.prefix ? (
          <InputGroup.Text>{field.prefix || paramConfig.prefix}</InputGroup.Text>
        ) : null}

        <Form.Control
          type="number"
          value={value}
          onChange={(e) => {
            const val = e.target.value === '' ? '' : parseFloat(e.target.value);
            onParamChange(field.id, val);
          }}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          isInvalid={!!error}
          style={field.style}
        />

        {field.suffix || paramConfig.suffix ? (
          <InputGroup.Text>{field.suffix || paramConfig.suffix}</InputGroup.Text>
        ) : null}

        <Form.Control.Feedback type="invalid">
          {error}
        </Form.Control.Feedback>
      </InputGroup>
    );
  };

  /**
   * Renders a row of fields
   */
  const renderFieldRow = (item, paramConfigs) => {
    if (!item.fields || !item.fields.length) return null;

    return (
      <Row className="g-2 align-items-center mb-3">
        {item.fields.map((field, index) => {
          const paramConfig = paramConfigs[field.id];
          if (!paramConfig) return null;

          // Calculate column width
          let colWidth;
          if (field.width === "auto" || field.width === "compact") {
            colWidth = { xs: 'auto' }; // Auto-width column
          } else if (typeof field.width === "number") {
            colWidth = { md: field.width };
          } else {
            colWidth = { md: 12 / item.fields.length }; // Equal width columns
          }

          return (
            <Col key={field.id} {...colWidth} className={field.width === "compact" ? "me-2" : ""}>
              {field.label && (
                <Form.Label className={field.labelClass || "mb-1"}>
                  {field.label}
                  {renderTooltip(field.description || paramConfig.description)}
                </Form.Label>
              )}
              {renderInput(field, paramConfig)}
            </Col>
          );
        })}
      </Row>
    );
  };

  /**
   * Renders a group of fields with a shared title
   */
  const renderFieldGroup = (item, paramConfigs) => {
    if (!item.fields || !item.fields.length) return null;

    return (
      <div className="mb-3">
        {item.title && (
          <div className="mb-2">
            <h6 className="mb-0">{item.title}</h6>
            {item.description && (
              <small className="text-muted d-block">{item.description}</small>
            )}
          </div>
        )}

        <Row className="g-2 align-items-center">
          {item.fields.map((field, index) => {
            const paramConfig = paramConfigs[field.id];
            if (!paramConfig) return null;

            // Calculate column width
            let colWidth;
            if (field.width === "auto") {
              colWidth = { xs: 'auto' }; // Auto-width column
            } else if (typeof field.width === "number") {
              colWidth = { md: field.width };
            } else {
              colWidth = { md: 12 / item.fields.length }; // Equal width columns
            }

            return (
              <Col key={field.id} {...colWidth}>
                <Form.Group>
                  <Form.Label className="mb-1">
                    {field.label || paramConfig.name}
                    {renderTooltip(field.description || paramConfig.description)}
                  </Form.Label>
                  {renderInput(field, paramConfig)}
                </Form.Group>
              </Col>
            );
          })}
        </Row>
      </div>
    );
  };

  /**
   * Renders fields as part of a sentence
   */
  const renderSentenceFields = (item, paramConfigs) => {
    if (!item.fields || !item.fields.length || !item.template) return null;

    // Get values to populate in the template
    const values = item.fields.map(field => {
      const paramConfig = paramConfigs[field.id];
      return {
        field,
        paramConfig,
        element: (
          <span key={field.id} className="d-inline-flex align-items-center mx-1" style={{ minWidth: field.width === "compact" ? "60px" : "auto" }}>
            <Form.Control
              type="number"
              value={params[field.id] || ''}
              onChange={(e) => {
                const val = e.target.value === '' ? '' : parseFloat(e.target.value);
                onParamChange(field.id, val);
              }}
              min={paramConfigs[field.id]?.min}
              max={paramConfigs[field.id]?.max}
              step={paramConfigs[field.id]?.step}
              disabled={disabled}
              isInvalid={!!validationErrors[field.id]}
              size="sm"
              className="mx-1"
              style={{
                width: field.width === "compact" ? "60px" : "auto",
                display: "inline-block"
              }}
            />
            {field.suffix && (
              <span className="ms-1">{field.suffix}</span>
            )}
          </span>
        )
      };
    });

    // Create sentence by replacing placeholders with field elements
    const sentence = item.template.split(/\{(\d+)\}/).map((part, index) => {
      if (index % 2 === 0) {
        // Text part
        return <span key={index}>{part}</span>;
      } else {
        // Field part
        const fieldIndex = parseInt(part, 10);
        return fieldIndex < values.length ? values[fieldIndex].element : null;
      }
    });

    return (
      <div className="sentence-fields mb-3 p-2 border rounded bg-light">
        <div className="d-flex align-items-center flex-wrap">
          {sentence}
        </div>
        {item.hint && (
          <small className="text-muted d-block mt-1">{item.hint}</small>
        )}
      </div>
    );
  };

  /**
   * Renders a feature toggle (boolean switch with description)
   */
  const renderFeatureToggle = (item, paramConfigs) => {
    if (!item.id) return null;

    const paramConfig = paramConfigs[item.id];
    if (!paramConfig) return null;

    const value = params[item.id] !== undefined ? params[item.id] : false;
    const error = validationErrors[item.id];

    return (
      <div className="feature-toggle mb-3">
        <div className="d-flex justify-content-between align-items-center">
          <div>
            <Form.Label className="mb-0">
              {item.label || paramConfig.name}
              {renderTooltip(item.description || paramConfig.description)}
            </Form.Label>
          </div>
          <Form.Check
            type="switch"
            id={`toggle-${item.id}`}
            checked={!!value}
            onChange={(e) => onParamChange(item.id, e.target.checked)}
            disabled={disabled}
            className="ms-2"
          />
        </div>
        {error && (
          <div className="text-danger small">{error}</div>
        )}
      </div>
    );
  };

  /**
   * Renders conditional items based on a parameter value
   */
  const renderConditionalItems = (item, paramConfigs) => {
    if (!item.condition || !item.items) return null;

    const { param, value } = item.condition;
    const paramValue = params[param];

    // Only render if the condition is met
    if (paramValue !== value) return null;

    return (
      <div className="conditional-items ps-3 border-start">
        {item.items.map((subItem, index) => renderItem(subItem, paramConfigs, index))}
      </div>
    );
  };

  /**
   * Renders a layout item based on its type
   */
  const renderItem = (item, paramConfigs, index) => {
    if (!item || !item.type) return null;

    const key = `item-${index}`;

    switch(item.type) {
      case 'field-row':
        return <div key={key}>{renderFieldRow(item, paramConfigs)}</div>;
      case 'field-group':
        return <div key={key}>{renderFieldGroup(item, paramConfigs)}</div>;
      case 'sentence-fields':
        return <div key={key}>{renderSentenceFields(item, paramConfigs)}</div>;
      case 'feature-toggle':
        return <div key={key}>{renderFeatureToggle(item, paramConfigs)}</div>;
      case 'conditional-fields':
        return <div key={key}>{renderConditionalItems(item, paramConfigs)}</div>;
      default:
        return null;
    }
  };

  /**
   * Renders a section of the layout
   */
  const renderSection = (section, paramConfigs, index) => {
    if (!section.items || !section.items.length) return null;

    const sectionClass = section.layout === "compact" ? "mb-4" : "mb-4";

    return (
      <div className={sectionClass} key={`section-${index}`}>
        {section.title && (
          <div className="mb-2">
            <h6 className="mb-0">{section.title}</h6>
            {section.description && (
              <small className="text-muted d-block">{section.description}</small>
            )}
          </div>
        )}

        <div className={section.layout === "compact" ? "ps-2" : ""}>
          {section.items.map((item, idx) => renderItem(item, paramConfigs, idx))}
        </div>
      </div>
    );
  };

  return (
    <Card className="mb-3">
      {layout.title && (
        <Card.Header>
          <div className="d-flex justify-content-between align-items-center">
            <strong>{layout.title}</strong>
            {layout.headerControls && (
              <div>{layout.headerControls}</div>
            )}
          </div>
          {layout.description && (
            <small className="text-muted">{layout.description}</small>
          )}
        </Card.Header>
      )}
      <Card.Body>
        {layout.sections.map((section, index) => (
          renderSection(section, params._paramConfigs, index)
        ))}
      </Card.Body>
    </Card>
  );
};

export default CustomParameterLayout;
