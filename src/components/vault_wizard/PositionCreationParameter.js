// src/components/parameters/PositionCreationParameter.js
import React from 'react';
import CreatePositionSection from './CreatePositionSection';

/**
 * Custom parameter component for position creation
 * This integrates with StrategyParameterForm for custom parameter types
 */
const PositionCreationParameter = ({
  paramId,
  paramConfig,
  value,
  onChange,
  allParams,
  disabled
}) => {
  // Validation check
  if (!paramId || !onChange) {
    console.warn("PositionCreationParameter missing required props", { paramId, onChange });
    return (
      <div className="alert alert-warning">
        Position creation component is missing required configuration.
      </div>
    );
  }

  // Extract tokens and deposit amounts from all params
  const selectedTokens = allParams?.depositTokens || [];
  const depositAmounts = allParams?.depositAmounts || {};
  const strategyId = allParams?._strategyId || 'none';

  // The number of positions allowed comes from the strategy config or default to 1
  const maxPositions = paramConfig?.maxPositions || 1;

  return (
    <CreatePositionSection
      selectedTokens={selectedTokens}
      depositAmounts={depositAmounts}
      strategyId={strategyId}
      maxPositions={maxPositions}
      onPositionsChange={(positions) => onChange(paramId, positions)}
    />
  );
};

export default PositionCreationParameter;
