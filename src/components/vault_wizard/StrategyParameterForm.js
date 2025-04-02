// src/components/StrategyParameterForm.js
import React from 'react';
import TokenDepositsSection from './TokenDepositsSection';
import { getStrategyParametersByStep } from '../../utils/strategyConfig';

/**
 * Renders parameters for a specific strategy step
 */
const StrategyParameterForm = ({
  strategyId,
  currentStep,
  params,
  onParamChange,
  disabled
}) => {
  // Get parameters for this step
  const stepParameters = getStrategyParametersByStep(strategyId, currentStep);

  // Function to render the appropriate component based on parameter type
  const renderParameterComponent = (paramId, paramConfig) => {
    // Handle different parameter types
    switch(paramConfig.type) {
      case 'token-deposits':
        return (
          <TokenDepositsSection
            key={paramId}
            selectedTokens={params[paramId]?.tokens || []}
            setSelectedTokens={(tokens) => {
              // Update the tokens array in the parameter
              onParamChange(paramId, {
                ...(params[paramId] || {}),
                tokens
              });
            }}
            depositAmounts={params[paramId]?.amounts || {}}
            onAmountChange={(symbol, value) => {
              // Update the amount for this symbol
              const newAmounts = {
                ...(params[paramId]?.amounts || {}),
                [symbol]: value
              };
              onParamChange(paramId, {
                ...(params[paramId] || {}),
                amounts: newAmounts
              });
            }}
            strategyId={strategyId}
          />
        );

      // Add more parameter types as needed

      default:
        // For unsupported types, log a warning and return nothing
        console.warn(`Unsupported parameter type: ${paramConfig.type} for param: ${paramId}`);
        return null;
    }
  };

  // Render all parameters for this step
  return (
    <div className="strategy-parameters">
      {Object.entries(stepParameters).map(([paramId, paramConfig]) =>
        renderParameterComponent(paramId, paramConfig)
      )}
    </div>
  );
};

export default StrategyParameterForm;
