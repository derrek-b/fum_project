// src/utils/strategyConfig.js

import { getAllTokens, getStablecoins } from "./tokenConfig";

// Strategies registry
const strategies = {
  // Basic strategy for beginners
  "parris": {
    id: "parris",
    name: "Parris Island",
    subtitle: "Basic Liquidity Management",
    description: "A foundational strategy for automated liquidity position management with essential controls",
    supportedTokens: getAllTokens(), // Common tokens for beginners
    minTokens: 2, // Need at least a pair
    requireTokenSelection: true,
    parameterGroups: [
      {
        name: "Range Settings",
        description: "Control how your position responds to price movements"
      },
      {
        name: "Fee Settings",
        description: "Configure how fees are handled and reinvested"
      },
      {
        name: "Risk Management",
        description: "Set safeguards to protect your position"
      },
      {
        name: "Advanced Settings",
        description: "Fine-tune your strategy behavior"
      }
    ],
    // Layout definitions for different wizard steps
    layouts: {
      // Step 2 layouts
      2: {
        // Range Settings
        rangeSettings: {
          groupId: 0,
          title: "Position Range Configuration",
          description: "Define how your liquidity is distributed around the current price",
          sections: [
            {
              layout: "grid",
              items: [
                {
                  type: "field-group",
                  title: "Range Boundaries",
                  description: "Set the price range limits for your position",
                  fields: [
                    {
                      id: "targetRangeUpper",
                      label: "Upper Range",
                      width: 6,
                      suffix: "%",
                      size: "md"
                    },
                    {
                      id: "targetRangeLower",
                      label: "Lower Range",
                      width: 6,
                      suffix: "%",
                      size: "md"
                    }
                  ]
                },
                {
                  type: "field-group",
                  title: "Rebalance Triggers",
                  description: "When price moves beyond these thresholds, your position will rebalance",
                  fields: [
                    {
                      id: "rebalanceThresholdUpper",
                      label: "Upper Trigger",
                      width: 6,
                      suffix: "%",
                      size: "md"
                    },
                    {
                      id: "rebalanceThresholdLower",
                      label: "Lower Trigger",
                      width: 6,
                      suffix: "%",
                      size: "md"
                    }
                  ]
                }
              ]
            }
          ]
        },

        // Risk Management (Step 2 portion)
        riskManagement: {
          groupId: 2,
          title: "Risk Management",
          description: "Set safeguards to protect your position",
          sections: [
            {
              layout: "grid",
              items: [
                {
                  type: "field-row",
                  fields: [
                    {
                      id: "maxSlippage",
                      label: "Maximum Slippage",
                      width: 4,
                      suffix: "%",
                      description: "Maximum price slippage allowed when executing trades"
                    },
                    {
                      id: "emergencyExitTrigger",
                      label: "Emergency Exit",
                      width: 4,
                      suffix: "%",
                      description: "Price change that triggers automatic position exit"
                    },
                    {
                      id: "maxVaultUtilization",
                      label: "Max Utilization",
                      width: 4,
                      suffix: "%",
                      description: "Maximum percentage of vault assets to deploy"
                    }
                  ]
                }
              ]
            }
          ]
        },

        // Advanced Settings Section
        advancedSettings: {
          groupId: 3,
          title: "Advanced Settings",
          description: "Fine-tune your strategy behavior",
          sections: [
            {
              title: "Oracle Settings",
              description: "Price data feed information ",
              className: "subsection-title",
              layout: "regular",
              items: [
                {
                  type: "field-row",
                  fields: [
                    {
                      id: "oracleSource",
                      label: "Price Data Source",
                      width: 6,
                      type: "select"
                    },
                    {
                      id: "priceDeviationTolerance",
                      label: "Deviation Tolerance",
                      width: 6,
                      suffix: "%",
                      description: "Maximum allowed deviation between price sources"
                    }
                  ]
                }
              ]
            },
            {
              title: "Adaptive Range Settings",
              description: "Automatically adjust position ranges based on market activity",
              className: "subsection-title",
              layout: "regular",
              items: [
                {
                  type: "feature-toggle", // Change this from "field-row" to "feature-toggle"
                  id: "adaptiveRanges",
                  label: "Enable Adaptive Ranges"
                  // Remove the width and className properties
                },
                {
                  type: "conditional-fields",
                  condition: { param: "adaptiveRanges", value: true },
                  items: [
                    {
                      type: "sentence-fields",
                      template: "If more than {0} rebalances occur within {1} days",
                      fields: [
                        {
                          id: "rebalanceCountThresholdHigh",
                          width: "compact",
                          suffix: ""
                        },
                        {
                          id: "adaptiveTimeframeHigh",
                          width: "compact",
                          suffix: ""
                        }
                      ]
                    },
                    {
                      type: "field-row",
                      fields: [
                        {
                          id: "rangeAdjustmentPercentHigh",
                          label: "Increase Range By",
                          width: 6,
                          suffix: "%",
                          description: "Percentage to widen position ranges"
                        },
                        {
                          id: "thresholdAdjustmentPercentHigh",
                          label: "Increase Thresholds By",
                          width: 6,
                          suffix: "%",
                          description: "Percentage to increase rebalance thresholds"
                        }
                      ]
                    },
                    {
                      type: "sentence-fields",
                      template: "If fewer than {0} rebalances occur within {1} days",
                      fields: [
                        {
                          id: "rebalanceCountThresholdLow",
                          width: "compact",
                          suffix: ""
                        },
                        {
                          id: "adaptiveTimeframeLow",
                          width: "compact",
                          suffix: ""
                        }
                      ]
                    },
                    {
                      type: "field-row",
                      fields: [
                        {
                          id: "rangeAdjustmentPercentLow",
                          label: "Decrease Range By",
                          width: 6,
                          suffix: "%",
                          description: "Percentage to narrow position ranges"
                        },
                        {
                          id: "thresholdAdjustmentPercentLow",
                          label: "Decrease Thresholds By",
                          width: 6,
                          suffix: "%",
                          description: "Percentage to decrease rebalance thresholds"
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        }
      },

      // Step 5 layouts
      5: {
        // Position Sizing
        positionSizing: {
          groupId: 2,
          title: "Position Sizing",
          description: "Control how much capital is allocated to each position",
          sections: [
            {
              layout: "grid",
              items: [
                {
                  type: "field-row",
                  fields: [
                    {
                      id: "targetUtilization",
                      label: "Target Utilization",
                      width: 4,
                      suffix: "%",
                      description: "Target percentage of vault assets to deploy per position"
                    },
                    {
                      id: "maxPositionSizePercent",
                      label: "Max Position Size",
                      width: 4,
                      suffix: "%",
                      description: "Maximum percentage of vault assets for any single position"
                    },
                    {
                      id: "minPositionSize",
                      label: "Min Position Size",
                      width: 4,
                      prefix: "$",
                      description: "Minimum USD value for creating a position"
                    }
                  ]
                },
                {
                  type: "field-row",
                  fields: [
                    {
                      id: "minPoolLiquidity",
                      label: "Min Pool Liquidity",
                      width: 6,
                      prefix: "$",
                      description: "Minimum pool liquidity threshold for valid positions"
                    },
                    {
                      id: "platformSelectionCriteria",
                      label: "Platform Selection",
                      width: 6,
                      type: "select",
                      description: "How to choose which platform to use for positions"
                    }
                  ]
                }
              ]
            }
          ]
        },

        // Fee Handling
        feeSettings: {
          groupId: 1,
          title: "Fee Management",
          description: "Configure how trading fees are handled",
          sections: [
            {
              layout: "grid",
              items: [
                {
                  type: "feature-toggle",
                  id: "feeReinvestment",
                  label: "Automatically Reinvest Fees",
                  description: "When enabled, collected fees will be reinvested based on settings below"
                },
                {
                  type: "conditional-fields",
                  condition: { param: "feeReinvestment", value: true },
                  items: [
                    {
                      type: "field-row",
                      fields: [
                        {
                          id: "reinvestmentTrigger",
                          label: "Reinvestment Threshold",
                          width: 6,
                          prefix: "$",
                          description: "Minimum USD value of fees before reinvesting"
                        },
                        {
                          id: "reinvestmentRatio",
                          label: "Reinvestment Percentage",
                          width: 6,
                          suffix: "%",
                          description: "Percentage of fees to reinvest vs. hold as reserve"
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        }
      }
    },
    parameters: {
      // Range and Rebalance Parameters - Step 2
      targetRangeUpper: {
        name: "Upper Range",
        description: "Range percentage above current price",
        type: "number",
        defaultValue: 5.0,
        min: 0.1,
        max: 10.0,
        step: 0.1,
        suffix: "%",
        group: 0,
        wizardStep: 2
      },
      targetRangeLower: {
        name: "Lower Range",
        description: "Range percentage below current price",
        type: "number",
        defaultValue: 5.0,
        min: 0.1,
        max: 10.0,
        step: 0.1,
        suffix: "%",
        group: 0,
        wizardStep: 2
      },
      rebalanceThresholdUpper: {
        name: "Upper Rebalance Trigger",
        description: "Price movement percentage above range that triggers a rebalance",
        type: "number",
        defaultValue: 3.0,
        min: 0.1,
        max: 20.0,
        step: 0.1,
        suffix: "%",
        group: 0,
        wizardStep: 2
      },
      rebalanceThresholdLower: {
        name: "Lower Rebalance Trigger",
        description: "Price movement percentage below range that triggers a rebalance",
        type: "number",
        defaultValue: 3.0,
        min: 0.1,
        max: 20.0,
        step: 0.1,
        suffix: "%",
        group: 0,
        wizardStep: 2
      },
      maxVaultUtilization: {
        name: "Max Vault Utilization",
        description: "Maximum percentage of vault assets that can be deployed across all positions",
        type: "number",
        defaultValue: 80,
        min: 10,
        max: 100,
        step: 5,
        suffix: "%",
        group: 2,
        wizardStep: 2
      },

      // Adaptive Range Parameters - Step 2
      adaptiveRanges: {
        name: "Adaptive Ranges",
        description: "Automatically adjust ranges based on rebalance frequency",
        type: "boolean",
        defaultValue: true,
        group: 3,
        wizardStep: 2
      },
      rebalanceCountThresholdHigh: {
        name: "High Rebalance Count",
        description: "If more than this many rebalances occur in the timeframe, widen ranges",
        type: "number",
        defaultValue: 3,
        min: 1,
        max: 20,
        step: 1,
        group: 3,
        wizardStep: 2,
        conditionalOn: "adaptiveRanges",
        conditionalValue: true
      },
      rebalanceCountThresholdLow: {
        name: "Low Rebalance Count",
        description: "If fewer than this many rebalances occur in the timeframe, tighten ranges",
        type: "number",
        defaultValue: 1,
        min: 0,
        max: 10,
        step: 1,
        group: 3,
        wizardStep: 2,
        conditionalOn: "adaptiveRanges",
        conditionalValue: true
      },
      adaptiveTimeframeHigh: {
        name: "High Count Timeframe",
        description: "Days to look back when counting rebalances for widening ranges",
        type: "number",
        defaultValue: 7,
        min: 1,
        max: 30,
        step: 1,
        suffix: " days",
        group: 3,
        wizardStep: 2,
        conditionalOn: "adaptiveRanges",
        conditionalValue: true
      },
      adaptiveTimeframeLow: {
        name: "Low Count Timeframe",
        description: "Days to look back when counting rebalances for tightening ranges",
        type: "number",
        defaultValue: 7,
        min: 1,
        max: 30,
        step: 1,
        suffix: " days",
        group: 3,
        wizardStep: 2,
        conditionalOn: "adaptiveRanges",
        conditionalValue: true
      },
      rangeAdjustmentPercentHigh: {
        name: "Range Expansion Amount",
        description: "Percentage to increase position ranges when too many rebalances occur",
        type: "number",
        defaultValue: 20,
        min: 5,
        max: 100,
        step: 5,
        suffix: "%",
        group: 3,
        wizardStep: 2,
        conditionalOn: "adaptiveRanges",
        conditionalValue: true
      },
      thresholdAdjustmentPercentHigh: {
        name: "Threshold Expansion Amount",
        description: "Percentage to increase rebalance thresholds when too many rebalances occur",
        type: "number",
        defaultValue: 15,
        min: 5,
        max: 100,
        step: 5,
        suffix: "%",
        group: 3,
        wizardStep: 2,
        conditionalOn: "adaptiveRanges",
        conditionalValue: true
      },
      rangeAdjustmentPercentLow: {
        name: "Range Contraction Amount",
        description: "Percentage to decrease position ranges when too few rebalances occur",
        type: "number",
        defaultValue: 20,
        min: 5,
        max: 100,
        step: 5,
        suffix: "%",
        group: 3,
        wizardStep: 2,
        conditionalOn: "adaptiveRanges",
        conditionalValue: true
      },
      thresholdAdjustmentPercentLow: {
        name: "Threshold Contraction Amount",
        description: "Percentage to decrease rebalance thresholds when too few rebalances occur",
        type: "number",
        defaultValue: 15,
        min: 5,
        max: 100,
        step: 5,
        suffix: "%",
        group: 3,
        wizardStep: 2,
        conditionalOn: "adaptiveRanges",
        conditionalValue: true
      },

      // Risk Parameters - Step 2
      maxSlippage: {
        name: "Max Slippage",
        description: "Maximum acceptable slippage when executing trades",
        type: "number",
        defaultValue: 0.5,
        min: 0.1,
        max: 5.0,
        step: 0.1,
        suffix: "%",
        group: 2,
        wizardStep: 2
      },
      emergencyExitTrigger: {
        name: "Emergency Exit",
        description: "Price change percentage that triggers emergency exit from positions",
        type: "number",
        defaultValue: 15,
        min: 5,
        max: 50,
        step: 1,
        suffix: "%",
        group: 2,
        wizardStep: 2
      },

      // Oracle Parameters - Step 2
      oracleSource: {
        name: "Price Oracle",
        description: "Source of price data for strategy decisions",
        type: "select",
        options: [
          { value: "dex", label: "DEX Price" },
          { value: "chainlink", label: "Chainlink" },
          { value: "twap", label: "Time-Weighted Average Price" },
        ],
        defaultValue: "dex",
        group: 3,
        wizardStep: 2
      },
      priceDeviationTolerance: {
        name: "Oracle Deviation Tolerance",
        description: "Maximum allowed deviation between different price sources",
        type: "number",
        defaultValue: 1.0,
        min: 0.1,
        max: 5.0,
        step: 0.1,
        suffix: "%",
        group: 3,
        wizardStep: 2
      },

      // Position Sizing Parameters - Step 5
      maxPositionSizePercent: {
        name: "Max Position Size",
        description: "Maximum percentage of vault assets to allocate to any single position",
        type: "number",
        defaultValue: 30,
        min: 5,
        max: 100,
        step: 5,
        suffix: "%",
        group: 2,
        wizardStep: 5
      },
      minPositionSize: {
        name: "Min Position Size",
        description: "Minimum position size in USD value to avoid dust positions",
        type: "number",
        defaultValue: 100,
        min: 10,
        max: 10000,
        step: 10,
        prefix: "$",
        group: 2,
        wizardStep: 5
      },
      targetUtilization: {
        name: "Target Utilization",
        description: "Target percentage of vault assets to deploy (per position)",
        type: "number",
        defaultValue: 20,
        min: 5,
        max: 100,
        step: 5,
        suffix: "%",
        group: 0,
        wizardStep: 5
      },

      // Fee Parameters - Step 5
      feeReinvestment: {
        name: "Reinvest Fees",
        description: "Automatically reinvest collected fees",
        type: "boolean",
        defaultValue: true,
        group: 1,
        wizardStep: 5
      },
      reinvestmentTrigger: {
        name: "Reinvestment Trigger",
        description: "Minimum USD value of fees before reinvesting",
        type: "number",
        defaultValue: 50,
        min: 10,
        max: 1000,
        step: 10,
        prefix: "$",
        group: 1,
        wizardStep: 5,
        conditionalOn: "feeReinvestment",
        conditionalValue: true
      },
      reinvestmentRatio: {
        name: "Reinvestment Ratio",
        description: "Percentage of collected fees to reinvest vs. hold as reserve",
        type: "number",
        defaultValue: 80,
        min: 0,
        max: 100,
        step: 5,
        suffix: "%",
        group: 1,
        wizardStep: 5,
        conditionalOn: "feeReinvestment",
        conditionalValue: true
      },

      // Platform Parameters - Step 5
      platformSelectionCriteria: {
        name: "Platform Selection",
        description: "Criteria for selecting which platform to use for a position",
        type: "select",
        options: [
          { value: "highest_tvl", label: "Highest TVL" },
          { value: "highest_volume", label: "Highest Volume" },
          { value: "lowest_fees", label: "Lowest Fees" },
          { value: "highest_rewards", label: "Best Rewards" },
        ],
        defaultValue: "highest_volume",
        group: 3,
        wizardStep: 5
      },
      minPoolLiquidity: {
        name: "Min Pool Liquidity",
        description: "Minimum pool liquidity threshold to enter a position",
        type: "number",
        defaultValue: 100000,
        min: 10000,
        max: 10000000,
        step: 10000,
        prefix: "$",
        group: 2,
        wizardStep: 5
      },
    }
  },

  // The Fed strategy for stablecoin management
  "fed": {
    id: "fed",
    name: "The Fed",
    subtitle: "Stablecoin Optimization",
    description: "Automated stablecoin strategy with peg deviation positioning and range optimization",
    supportedTokens: getStablecoins(), // Stablecoins only
    minTokens: 2,
    requireTokenSelection: true,
    parameters: {
      targetRange: {
        name: "Range",
        description: "Range around the current price to set the position boundaries",
        type: "number",
        defaultValue: 0.5,
        min: 0.1,
        max: 5.0,
        step: 0.1,
        suffix: "%",
        wizardStep: 2
      },
      rebalanceThreshold: {
        name: "Rebalance Trigger",
        description: "Price movement percentage that triggers a rebalance",
        type: "number",
        defaultValue: 1.0,
        min: 0.1,
        max: 10.0,
        step: 0.1,
        suffix: "%",
        wizardStep: 2
      },
      feeReinvestment: {
        name: "Reinvest Fees",
        description: "Automatically reinvest collected fees",
        type: "boolean",
        defaultValue: true,
        wizardStep: 2
      },
      maxSlippage: {
        name: "Max Slippage",
        description: "Maximum acceptable slippage when executing trades",
        type: "number",
        defaultValue: 0.5,
        min: 0.1,
        max: 5.0,
        step: 0.1,
        suffix: "%",
        wizardStep: 2
      }
    }
  }
};

/**
 * Get the list of available strategy configs
 * @returns {Array} Array of strategy objects with id, name, and subtitle
 */
export function getAvailableStrategies() {
  return Object.values(strategies).map(strategy => ({
    id: strategy.id,
    name: strategy.name,
    subtitle: strategy.subtitle,
    description: strategy.description,
    comingSoon: strategy.comingSoon || false
  }));
}

/**
 * Get details about a specific strategy
 * @param {string} strategyId - ID of the strategy to get details for
 * @returns {Object} Strategy details object
 */
export function getStrategyDetails(strategyId) {
  const strategy = strategies[strategyId];
  if (!strategy) return null;

  return {
    id: strategy.id,
    name: strategy.name,
    description: strategy.description,
    supportedTokens: strategy.supportedTokens,
    minTokens: strategy.minTokens,
    maxTokens: strategy.maxTokens,
    requireTokenSelection: strategy.requireTokenSelection,
    parameterGroups: strategy.parameterGroups || []
  };
}

/**
 * Get the default parameters for a strategy
 * @param {string} strategyId - ID of the strategy
 * @returns {Object} Object with default parameter values
 */
export function getDefaultParams(strategyId) {
  const strategy = strategies[strategyId];
  if (!strategy) return {};

  const defaultParams = {};

  // Extract default values from each parameter definition
  Object.entries(strategy.parameters).forEach(([paramId, paramConfig]) => {
    defaultParams[paramId] = paramConfig.defaultValue;
  });

  return defaultParams;
}

/**
 * Get parameter definitions for a strategy
 * @param {string} strategyId - ID of the strategy
 * @returns {Object} Object with parameter definitions
 */
export function getStrategyParameters(strategyId) {
  const strategy = strategies[strategyId];
  if (!strategy) return {};

  return strategy.parameters;
}

/**
 * Get parameters for a specific wizard step
 * @param {string} strategyId - ID of the strategy
 * @param {number} step - Wizard step number
 * @returns {Object} Object with parameter definitions for the specified step
 */
export function getStrategyParametersByStep(strategyId, step) {
  const strategy = strategies[strategyId];
  if (!strategy) return {};

  const stepParams = {};

  Object.entries(strategy.parameters).forEach(([paramId, paramConfig]) => {
    if (paramConfig.wizardStep === step) {
      stepParams[paramId] = paramConfig;
    }
  });

  return stepParams;
}

/**
 * Get available layouts for a strategy and step
 * @param {string} strategyId - ID of the strategy
 * @param {number} step - Wizard step number
 * @returns {Object} Available layouts for the step
 */
export function getStrategyLayouts(strategyId, step) {
  const strategy = strategies[strategyId];
  if (!strategy || !strategy.layouts || !strategy.layouts[step]) {
    return {};
  }
  return strategy.layouts[step];
}

/**
 * Check if a layout should be rendered based on its condition
 * @param {Object} layout - Layout configuration
 * @param {Object} params - Current parameter values
 * @returns {boolean} Whether the layout should be rendered
 */
export function shouldRenderLayout(layout, params) {
  if (!layout.condition) return true;

  const { param, value } = layout.condition;
  return params[param] === value;
}

/**
 * Validate strategy parameters
 * @param {string} strategyId - ID of the strategy
 * @param {Object} params - Parameter values to validate
 * @returns {Object} Validation result with isValid flag and errors object
 */
export function validateStrategyParams(strategyId, params) {
  const strategy = strategies[strategyId];
  if (!strategy) {
    return {
      isValid: false,
      errors: { _general: "Invalid strategy ID" }
    };
  }

  const errors = {};

  // Validate each parameter
  Object.entries(strategy.parameters).forEach(([paramId, paramConfig]) => {
    const value = params[paramId];

    // Skip validation for conditional parameters that aren't applicable
    if (paramConfig.conditionalOn) {
      const conditionParam = params[paramConfig.conditionalOn];
      if (conditionParam !== paramConfig.conditionalValue) {
        return;
      }
    }

    // Required parameter is missing
    if (value === undefined || value === null || value === "") {
      errors[paramId] = `${paramConfig.name} is required`;
      return;
    }

    // Numeric validations
    if (paramConfig.type === "number") {
      const numValue = Number(value);

      if (isNaN(numValue)) {
        errors[paramId] = `${paramConfig.name} must be a number`;
        return;
      }

      if (paramConfig.min !== undefined && numValue < paramConfig.min) {
        errors[paramId] = `${paramConfig.name} must be at least ${paramConfig.min}${paramConfig.suffix || ''}`;
        return;
      }

      if (paramConfig.max !== undefined && numValue > paramConfig.max) {
        errors[paramId] = `${paramConfig.name} must be at most ${paramConfig.max}${paramConfig.suffix || ''}`;
        return;
      }
    }

    // Select validation
    if (paramConfig.type === "select" && paramConfig.options) {
      const validOptions = paramConfig.options.map(opt => opt.value);
      if (!validOptions.includes(value)) {
        errors[paramId] = `${paramConfig.name} must be one of the provided options`;
        return;
      }
    }
  });

  // Strategy-specific validations
  if (strategyId === "parris") {
    // Adaptive range values should make sense
    if (params.adaptiveRanges) {
      if (params.rebalanceCountThresholdHigh <= params.rebalanceCountThresholdLow) {
        errors.rebalanceCountThresholdHigh = "High count must be greater than low count";
      }
    }

    // Upper/lower range values should be positive
    if (params.targetRangeUpper <= 0) {
      errors.targetRangeUpper = "Upper range must be greater than 0";
    }

    if (params.targetRangeLower <= 0) {
      errors.targetRangeLower = "Lower range must be greater than 0";
    }

    // Reinvestment ratio should be between 0-100%
    if (params.feeReinvestment && (params.reinvestmentRatio < 0 || params.reinvestmentRatio > 100)) {
      errors.reinvestmentRatio = "Reinvestment ratio must be between 0 and 100%";
    }
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors
  };
}

// Export all necessary functions
export default {
  getAvailableStrategies,
  getStrategyDetails,
  getDefaultParams,
  getStrategyParameters,
  getStrategyParametersByStep,
  validateStrategyParams,
  getStrategyLayouts,
  shouldRenderLayout
};
