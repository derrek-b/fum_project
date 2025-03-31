// src/components/StrategyParameterForm.js
import React, { useMemo } from "react";
import { Form, Card, OverlayTrigger, Tooltip, InputGroup } from "react-bootstrap";
import { InfoCircle } from 'react-bootstrap-icons';
import {
  getStrategyParametersByStep,
  getStrategyParameters,
  getStrategyDetails,
  getStrategyLayouts,
  shouldRenderLayout
} from "../utils/strategyConfig";
import CustomParameterLayout from "./CustomParameterLayout";

// Component for rendering strategy parameters based on step
function StrategyParameterForm({ strategyId, currentStep, params, onParamChange, disabled, validationErrors = {} }) {
  // Get parameters for the current step
  const stepParameters = useMemo(() =>
    getStrategyParametersByStep(strategyId, currentStep),
  [strategyId, currentStep]);

  // Get all parameters (for conditional rendering)
  const allParameters = useMemo(() =>
    getStrategyParameters(strategyId),
  [strategyId]);

  // Get available layouts for this step
  const layouts = useMemo(() =>
    getStrategyLayouts(strategyId, currentStep),
  [strategyId, currentStep]);

  // Group parameters for display
  const parametersByGroup = useMemo(() => {
    const groups = {};

    Object.entries(stepParameters).forEach(([paramId, paramConfig]) => {
      const groupId = paramConfig.group || 0;
      if (!groups[groupId]) {
        groups[groupId] = [];
      }
      groups[groupId].push({ id: paramId, ...paramConfig });
    });

    return groups;
  }, [stepParameters]);

  // Get strategy details for group information
  const strategyDetails = useMemo(() =>
    getStrategyDetails(strategyId),
  [strategyId]);

  const parameterGroups = strategyDetails?.parameterGroups || [];

  // Check if parameter should be shown based on conditional rendering
  const shouldShowParameter = (paramConfig) => {
    if (!paramConfig.conditionalOn) return true;

    const conditionParamValue = params[paramConfig.conditionalOn];
    return conditionParamValue === paramConfig.conditionalValue;
  };

  // Create a list of all paramater IDs that will be handled by custom layouts
  const customLayoutParamIds = useMemo(() => {
    if (!layouts) return [];

    const paramIds = [];

    // Helper function to collect parameter IDs from layout fields
    const collectParamIds = (item) => {
      if (!item) return;

      switch (item.type) {
        case 'field-row':
        case 'field-group':
          item.fields?.forEach(field => {
            if (field.id) paramIds.push(field.id);
          });
          break;
        case 'sentence-fields':
          item.fields?.forEach(field => {
            if (field.id) paramIds.push(field.id);
          });
          break;
        case 'feature-toggle':
          if (item.id) paramIds.push(item.id);
          break;
        case 'conditional-fields':
          item.items?.forEach(subItem => collectParamIds(subItem));
          break;
        default:
          break;
      }
    };

    // Process all layouts
    Object.entries(layouts).forEach(([layoutId, layout]) => {
      // Skip layouts that shouldn't be rendered
      if (!shouldRenderLayout(layout, params)) return;

      // Process all sections and items
      layout.sections?.forEach(section => {
        section.items?.forEach(item => collectParamIds(item));
      });
    });

    return paramIds;
  }, [layouts, params]);

  // Render a single parameter input
  const renderParameterInput = (paramId, paramConfig) => {
    // Skip if this parameter is part of a custom layout
    if (customLayoutParamIds.includes(paramId)) return null;

    const value = params[paramId];
    const error = validationErrors[paramId];

    switch (paramConfig.type) {
      case 'number':
        return (
          <Form.Group key={paramId} className="mb-3">
            <Form.Label>
              {paramConfig.name}
              <OverlayTrigger
                placement="top"
                overlay={<Tooltip>{paramConfig.description}</Tooltip>}
              >
                <InfoCircle size={16} className="ms-1 text-muted" style={{ cursor: 'help' }} />
              </OverlayTrigger>
            </Form.Label>
            <InputGroup>
              {paramConfig.prefix && (
                <InputGroup.Text>{paramConfig.prefix}</InputGroup.Text>
              )}
              <Form.Control
                type="number"
                value={value}
                onChange={(e) => onParamChange(paramId, parseFloat(e.target.value))}
                disabled={disabled}
                min={paramConfig.min}
                max={paramConfig.max}
                step={paramConfig.step}
                isInvalid={!!error}
              />
              {paramConfig.suffix && (
                <InputGroup.Text>{paramConfig.suffix}</InputGroup.Text>
              )}
              <Form.Control.Feedback type="invalid">
                {error}
              </Form.Control.Feedback>
            </InputGroup>
          </Form.Group>
        );

      case 'boolean':
        return (
          <Form.Group key={paramId} className="mb-3">
            <div className="d-flex align-items-center">
              <Form.Label className="me-2 mb-0">
                {paramConfig.name}
                <OverlayTrigger
                  placement="top"
                  overlay={<Tooltip>{paramConfig.description}</Tooltip>}
                >
                  <InfoCircle size={16} className="ms-1 text-muted" style={{ cursor: 'help' }} />
                </OverlayTrigger>
              </Form.Label>
              <Form.Check
                type="switch"
                id={`param-${paramId}`}
                checked={value}
                onChange={(e) => onParamChange(paramId, e.target.checked)}
                disabled={disabled}
                isInvalid={!!error}
              />
            </div>
            {error && (
              <Form.Control.Feedback type="invalid" style={{ display: 'block' }}>
                {error}
              </Form.Control.Feedback>
            )}
          </Form.Group>
        );

      case 'select':
        return (
          <Form.Group key={paramId} className="mb-3">
            <Form.Label>
              {paramConfig.name}
              <OverlayTrigger
                placement="top"
                overlay={<Tooltip>{paramConfig.description}</Tooltip>}
              >
                <InfoCircle size={16} className="ms-1 text-muted" style={{ cursor: 'help' }} />
              </OverlayTrigger>
            </Form.Label>
            <Form.Select
              value={value}
              onChange={(e) => onParamChange(paramId, e.target.value)}
              disabled={disabled}
              isInvalid={!!error}
            >
              {paramConfig.options.map(option => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Form.Select>
            {error && (
              <Form.Control.Feedback type="invalid">
                {error}
              </Form.Control.Feedback>
            )}
          </Form.Group>
        );

      default:
        return null;
    }
  };

  // Render custom layouts
  const renderCustomLayouts = () => {
    if (!layouts) return null;

    // Create parameter config map to pass to the custom layout
    const paramConfigs = {};
    Object.entries(allParameters).forEach(([paramId, config]) => {
      paramConfigs[paramId] = config;
    });

    // Enhanced params object with parameter configurations
    const layoutParams = {
      ...params,
      _paramConfigs: paramConfigs
    };

    return Object.entries(layouts).map(([layoutId, layout]) => {
      // Skip layouts that shouldn't be rendered
      if (!shouldRenderLayout(layout, params)) return null;

      return (
        <CustomParameterLayout
          key={layoutId}
          layout={layout}
          params={layoutParams}
          onParamChange={onParamChange}
          disabled={disabled}
          validationErrors={validationErrors}
        />
      );
    });
  };

  // Get groups that have been fully handled by custom layouts
  const getHandledGroups = () => {
    if (!layouts) return [];

    const handledGroups = [];

    // Find all group IDs that are handled by layouts
    Object.values(layouts).forEach(layout => {
      if (layout.groupId !== undefined && shouldRenderLayout(layout, params)) {
        // Check if this layout handles all parameters in its group
        const groupParams = parametersByGroup[layout.groupId] || [];
        const groupParamIds = groupParams.map(p => p.id);

        // If all group parameters are in custom layouts, mark the group as handled
        if (groupParamIds.every(id => customLayoutParamIds.includes(id))) {
          handledGroups.push(layout.groupId);
        }
      }
    });

    return handledGroups;
  };

  // If no parameters for this step, don't render anything
  if (Object.keys(stepParameters).length === 0) {
    return null;
  }

  // Get fully handled groups
  const handledGroups = getHandledGroups();

  return (
    <div className="strategy-parameters mb-4">
      {/* First render all custom layouts */}
      {renderCustomLayouts()}

      {/* Then render any remaining parameter groups not fully handled by custom layouts */}
      {Object.entries(parametersByGroup).map(([groupId, parameters]) => {
        const groupIdInt = parseInt(groupId);

        // Skip groups that are fully handled by custom layouts
        if (handledGroups.includes(groupIdInt)) {
          return null;
        }

        const groupInfo = parameterGroups[groupIdInt];

        // Filter parameters to only those not handled by custom layouts
        const remainingParams = parameters.filter(param =>
          !customLayoutParamIds.includes(param.id)
        );

        // Skip empty groups
        if (remainingParams.length === 0) {
          return null;
        }

        return (
          <Card key={groupId} className="mb-3">
            {groupInfo && (
              <Card.Header>
                <strong>{groupInfo.name}</strong>
                {groupInfo.description && (
                  <div className="text-muted small">{groupInfo.description}</div>
                )}
              </Card.Header>
            )}
            <Card.Body>
              {remainingParams.map(param =>
                shouldShowParameter(param) && renderParameterInput(param.id, param)
              )}
            </Card.Body>
          </Card>
        );
      })}
    </div>
  );
}

export default StrategyParameterForm;
