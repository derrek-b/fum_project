// src/utils/strategyConfig.js

import { getAllTokens, getStablecoins } from "./tokenConfig";

// Strategies registry
const strategies = {
  // None strategy (manual management)
  "none": {
    id: "none",
    name: "Manual Management",
    subtitle: "No Automated Strategy",
    description: "Manually manage your positions without automation",
    icon: "Ban", // Lucide icon name
    color: "#6c757d", // Dull grey
    borderColor: "#6c757d", // Same grey for border
    textColor: "#FFFFFF", // White text
    supportedTokens: getAllTokens(), // All tokens supported
    totalParameterSteps: 1, // One parameter step for demonstration
    parameterGroups: [
      {
        name: "Basic Configuration",
        description: "Configure basic vault options"
      }
    ],
    parameters: {
      tokenDeposits: {
        name: "Token Deposits",
        description: "Select tokens and amounts to deposit into your vault",
        type: "token-deposits",
        defaultValue: { tokens: [], amounts: {} },
        group: 0,
        wizardStep: 1
      }
    },
    templates: [
      {
        id: "custom",
        name: "Custom",
        description: "Fully customized parameter configuration"
      }
    ]
  },

  // All other strategies remain unchanged
  "parris": {
    id: "parris",
    name: "Parris Island",
    subtitle: "Basic Liquidity Management",
    description: "A foundational strategy for automated liquidity position management with essential controls",
    icon: "Dumbbell", // Lucide icon name
    color: "#1565C0", // Marine blue
    borderColor: "#B22234", // USA flag red
    textColor: "#FFFFFF", // White text
    supportedTokens: getAllTokens(), // Common tokens for beginners
    minTokens: 2, // Need at least a pair
    requireTokenSelection: true,
    totalParameterSteps: 2, // Corresponds to step 3 and 4 in the wizard
    parameterGroups: [
      {
        id: 0,
        name: "Range Settings",
        description: "Control how your position responds to price movements",
        setterMethod: "setRangeParameters"
      },
      {
        id: 1,
        name: "Fee Settings",
        description: "Configure how fees are handled and reinvested",
        setterMethod: "setFeeParameters"
      },
      {
        id: 2,
        name: "Risk Management",
        description: "Set safeguards to protect your position",
      },
      {
        id: 3,
        name: "Advanced Settings",
        description: "Fine-tune your strategy behavior",
      }
    ],
    contractParametersGroups: [
      {
        id: "range",
        setterMethod: "setRangeParameters",
        parameters: ["targetRangeUpper", "targetRangeLower", "rebalanceThresholdUpper", "rebalanceThresholdLower"]
      },
      {
        id: "fee",
        setterMethod: "setFeeParameters",
        parameters: ["feeReinvestment", "reinvestmentTrigger", "reinvestmentRatio"]
      },
      {
        id: "risk",
        setterMethod: "setRiskParameters",
        parameters: ["maxSlippage", "emergencyExitTrigger", "maxVaultUtilization"]
      },
      {
        id: "adaptive",
        setterMethod: "setAdaptiveParameters",
        parameters: ["adaptiveRanges", "rebalanceCountThresholdHigh", "rebalanceCountThresholdLow",
                     "adaptiveTimeframeHigh", "adaptiveTimeframeLow", "rangeAdjustmentPercentHigh",
                     "thresholdAdjustmentPercentHigh", "rangeAdjustmentPercentLow", "thresholdAdjustmentPercentLow"]
      },
      {
        id: "oracle",
        setterMethod: "setOracleParameters",
        parameters: ["oracleSource", "priceDeviationTolerance"]
      },
      {
        id: "positionSizing",
        setterMethod: "setPositionSizingParameters",
        parameters: ["maxPositionSizePercent", "minPositionSize", "targetUtilization"]
      },
      {
        id: "platform",
        setterMethod: "setPlatformParameters",
        parameters: ["platformSelectionCriteria", "minPoolLiquidity"]
      }
    ],
    layouts: {
      // Step 3 layouts (was step 2)
      3: {
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

        // Risk Management (Step 3 portion)
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
                  type: "feature-toggle",
                  id: "adaptiveRanges",
                  label: "Enable Adaptive Ranges"
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

      // Step 4 layouts (was step 5)
      4: {
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
    // Templates for Parris Island (new)
    templateEnumMap: {
      'conservative': 1,
      'moderate': 2,
      'aggressive': 3
    },
    templates: [
      {
        id: "conservative",
        name: "Conservative",
        description: "Lower risk position management with wider ranges and fewer rebalances",
        defaults: {
          // Keep ALL parameters from your original config with conservative values
          targetRangeUpper: 3.0,
          targetRangeLower: 3.0,
          rebalanceThresholdUpper: 1.5,
          rebalanceThresholdLower: 1.5,
          maxVaultUtilization: 60,
          adaptiveRanges: false,
          maxSlippage: 0.3,
          emergencyExitTrigger: 20,
          oracleSource: "0",
          priceDeviationTolerance: 0.5,
          maxPositionSizePercent: 20,
          minPositionSize: 200,
          targetUtilization: 15,
          feeReinvestment: false,
          platformSelectionCriteria: "0",
          minPoolLiquidity: 200000
        }
      },
      {
        id: "moderate",
        name: "Moderate",
        description: "Balanced approach to risk and yield",
        defaults: {
          // All parameters with moderate values
          targetRangeUpper: 5.0,
          targetRangeLower: 5.0,
          rebalanceThresholdUpper: 1.0,
          rebalanceThresholdLower: 1.0,
          maxVaultUtilization: 80,
          adaptiveRanges: true,
          rebalanceCountThresholdHigh: 3,
          rebalanceCountThresholdLow: 1,
          adaptiveTimeframeHigh: 7,
          adaptiveTimeframeLow: 7,
          rangeAdjustmentPercentHigh: 20,
          thresholdAdjustmentPercentHigh: 15,
          rangeAdjustmentPercentLow: 20,
          thresholdAdjustmentPercentLow: 15,
          maxSlippage: 0.5,
          emergencyExitTrigger: 15,
          oracleSource: "0",
          priceDeviationTolerance: 1.0,
          maxPositionSizePercent: 30,
          minPositionSize: 100,
          targetUtilization: 20,
          feeReinvestment: true,
          reinvestmentTrigger: 50,
          reinvestmentRatio: 80,
          platformSelectionCriteria: "0",
          minPoolLiquidity: 100000
        }
      },
      {
        id: "aggressive",
        name: "Aggressive",
        description: "Optimized for maximum fee generation with tighter ranges",
        defaults: {
          // All parameters with aggressive values
          targetRangeUpper: 8.0,
          targetRangeLower: 8.0,
          rebalanceThresholdUpper: 0.8,
          rebalanceThresholdLower: 0.8,
          maxVaultUtilization: 95,
          adaptiveRanges: true,
          rebalanceCountThresholdHigh: 4,
          rebalanceCountThresholdLow: 1,
          adaptiveTimeframeHigh: 5,
          adaptiveTimeframeLow: 5,
          rangeAdjustmentPercentHigh: 30,
          thresholdAdjustmentPercentHigh: 20,
          rangeAdjustmentPercentLow: 30,
          thresholdAdjustmentPercentLow: 20,
          maxSlippage: 1.0,
          emergencyExitTrigger: 10,
          oracleSource: "0",
          priceDeviationTolerance: 2.0,
          maxPositionSizePercent: 50,
          minPositionSize: 50,
          targetUtilization: 30,
          feeReinvestment: true,
          reinvestmentTrigger: 25,
          reinvestmentRatio: 100,
          platformSelectionCriteria: "3",
          minPoolLiquidity: 50000
        }
      },
      {
        id: "custom",
        name: "Custom",
        description: "Fully customized parameter configuration"
      }
    ],
    // KEEPING ALL YOUR ORIGINAL PARAMETERS - just updating wizardStep values
    parameters: {
      // Range and Rebalance Parameters - contractGroup: "range"
      targetRangeUpper: {
        name: "Upper Range",
        description: "Range percentage above current price",
        type: "percent",
        defaultValue: 5.0,
        min: 0.1,
        max: 10.0,
        step: 0.1,
        suffix: "%",
        group: 0,
        contractGroup: "range",
        wizardStep: 3
      },
      targetRangeLower: {
        name: "Lower Range",
        description: "Range percentage below current price",
        type: "percent",
        defaultValue: 5.0,
        min: 0.1,
        max: 10.0,
        step: 0.1,
        suffix: "%",
        group: 0,
        contractGroup: "range",
        wizardStep: 3
      },
      rebalanceThresholdUpper: {
        name: "Upper Rebalance Trigger",
        description: "Price movement percentage above range that triggers a rebalance",
        type: "percent",
        defaultValue: 3.0,
        min: 0.1,
        max: 20.0,
        step: 0.1,
        suffix: "%",
        group: 0,
        contractGroup: "range",
        wizardStep: 3
      },
      rebalanceThresholdLower: {
        name: "Lower Rebalance Trigger",
        description: "Price movement percentage below range that triggers a rebalance",
        type: "percent",
        defaultValue: 3.0,
        min: 0.1,
        max: 20.0,
        step: 0.1,
        suffix: "%",
        group: 0,
        contractGroup: "range",
        wizardStep: 3
      },

      // Fee Settings - contractGroup: "fee"
      feeReinvestment: {
        name: "Reinvest Fees",
        description: "Automatically reinvest collected fees",
        type: "boolean",
        defaultValue: true,
        group: 1,
        contractGroup: "fee",
        wizardStep: 4
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
        contractGroup: "fee",
        type: "fiat-currency",
        wizardStep: 4,
        conditionalOn: "feeReinvestment",
        conditionalValue: true
      },
      reinvestmentRatio: {
        name: "Reinvestment Ratio",
        description: "Percentage of collected fees to reinvest vs. hold as reserve",
        type: "percent",
        defaultValue: 80,
        min: 0,
        max: 100,
        step: 5,
        suffix: "%",
        group: 1,
        contractGroup: "fee",
        wizardStep: 4,
        conditionalOn: "feeReinvestment",
        conditionalValue: true
      },

      // Risk Management - contractGroup: "risk"
      maxSlippage: {
        name: "Max Slippage",
        description: "Maximum acceptable slippage when executing trades",
        type: "percent",
        defaultValue: 0.5,
        min: 0.1,
        max: 5.0,
        step: 0.1,
        suffix: "%",
        group: 2,
        contractGroup: "risk",
        wizardStep: 3
      },
      emergencyExitTrigger: {
        name: "Emergency Exit",
        description: "Price change percentage that triggers emergency exit from positions",
        type: "percent",
        defaultValue: 15,
        min: 5,
        max: 50,
        step: 1,
        suffix: "%",
        group: 2,
        contractGroup: "risk",
        wizardStep: 3
      },
      maxVaultUtilization: {
        name: "Max Vault Utilization",
        description: "Maximum percentage of vault assets that can be deployed across all positions",
        type: "percent",
        defaultValue: 80,
        min: 10,
        max: 100,
        step: 5,
        suffix: "%",
        group: 2,
        contractGroup: "risk",
        wizardStep: 3
      },

      // Adaptive Range Parameters - contractGroup: "adaptive"
      adaptiveRanges: {
        name: "Adaptive Ranges",
        description: "Automatically adjust ranges based on rebalance frequency",
        type: "boolean",
        defaultValue: true,
        group: 3,
        contractGroup: "adaptive",
        wizardStep: 3
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
        contractGroup: "adaptive",
        wizardStep: 3,
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
        contractGroup: "adaptive",
        wizardStep: 3,
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
        contractGroup: "adaptive",
        wizardStep: 3,
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
        contractGroup: "adaptive",
        wizardStep: 3,
        conditionalOn: "adaptiveRanges",
        conditionalValue: true
      },
      rangeAdjustmentPercentHigh: {
        name: "Range Expansion Amount",
        description: "Percentage to increase position ranges when too many rebalances occur",
        type: "percent",
        defaultValue: 20,
        min: 5,
        max: 100,
        step: 5,
        suffix: "%",
        group: 3,
        contractGroup: "adaptive",
        wizardStep: 3,
        conditionalOn: "adaptiveRanges",
        conditionalValue: true
      },
      thresholdAdjustmentPercentHigh: {
        name: "Threshold Expansion Amount",
        description: "Percentage to increase rebalance thresholds when too many rebalances occur",
        type: "percent",
        defaultValue: 15,
        min: 5,
        max: 100,
        step: 5,
        suffix: "%",
        group: 3,
        contractGroup: "adaptive",
        wizardStep: 3,
        conditionalOn: "adaptiveRanges",
        conditionalValue: true
      },
      rangeAdjustmentPercentLow: {
        name: "Range Contraction Amount",
        description: "Percentage to decrease position ranges when too few rebalances occur",
        type: "percent",
        defaultValue: 20,
        min: 5,
        max: 100,
        step: 5,
        suffix: "%",
        group: 3,
        contractGroup: "adaptive",
        wizardStep: 3,
        conditionalOn: "adaptiveRanges",
        conditionalValue: true
      },
      thresholdAdjustmentPercentLow: {
        name: "Threshold Contraction Amount",
        description: "Percentage to decrease rebalance thresholds when too few rebalances occur",
        type: "percent",
        defaultValue: 15,
        min: 5,
        max: 100,
        step: 5,
        suffix: "%",
        group: 3,
        contractGroup: "adaptive",
        wizardStep: 3,
        conditionalOn: "adaptiveRanges",
        conditionalValue: true
      },

      // Oracle Parameters - contractGroup: "oracle"
      oracleSource: {
        name: "Price Oracle",
        description: "Source of price data for strategy decisions",
        type: "select",
        options: [
          { value: "0", label: "DEX Price" },
          { value: "1", label: "Chainlink" },
          { value: "2", label: "Time-Weighted Average Price" },
        ],
        defaultValue: "0",
        group: 3,
        contractGroup: "oracle",
        wizardStep: 3
      },
      priceDeviationTolerance: {
        name: "Oracle Deviation Tolerance",
        description: "Maximum allowed deviation between different price sources",
        type: "percent",
        defaultValue: 1.0,
        min: 0.1,
        max: 5.0,
        step: 0.1,
        suffix: "%",
        group: 3,
        contractGroup: "oracle",
        wizardStep: 3
      },

      // Position Sizing Parameters - contractGroup: "positionSizing"
      maxPositionSizePercent: {
        name: "Max Position Size",
        description: "Maximum percentage of vault assets to allocate to any single position",
        type: "percent",
        defaultValue: 30,
        min: 5,
        max: 100,
        step: 5,
        suffix: "%",
        group: 2,
        contractGroup: "positionSizing",
        wizardStep: 4
      },
      minPositionSize: {
        name: "Min Position Size",
        description: "Minimum position size in USD value to avoid dust positions",
        type: "fiat-currency",
        defaultValue: 100,
        min: 10,
        max: 10000,
        step: 10,
        prefix: "$",
        group: 2,
        contractGroup: "positionSizing",
        wizardStep: 4
      },
      targetUtilization: {
        name: "Target Utilization",
        description: "Target percentage of vault assets to deploy (per position)",
        type: "percent",
        defaultValue: 20,
        min: 5,
        max: 100,
        step: 5,
        suffix: "%",
        group: 2,
        contractGroup: "positionSizing",
        wizardStep: 4
      },

      // Platform Parameters - contractGroup: "platform"
      platformSelectionCriteria: {
        name: "Platform Selection",
        description: "Criteria for selecting which platform to use for a position",
        type: "select",
        options: [
          { value: "0", label: "Highest TVL" },
          { value: "1", label: "Highest Volume" },
          { value: "2", label: "Lowest Fees" },
          { value: "3", label: "Best Rewards" },
        ],
        defaultValue: "1",
        group: 3,
        contractGroup: "platform",
        wizardStep: 4
      },
      minPoolLiquidity: {
        name: "Min Pool Liquidity",
        description: "Minimum pool liquidity threshold to enter a position",
        type: "fiat-currency",
        defaultValue: 100000,
        min: 10000,
        max: 10000000,
        step: 10000,
        prefix: "$",
        group: 2,
        contractGroup: "platform",
        wizardStep: 4
      }
    }
  },
  // The Fed strategy for stablecoin management
  "fed": {
    id: "fed",
    name: "The Fed",
    subtitle: "Stablecoin Optimization",
    description: "Automated stablecoin strategy with peg deviation positioning and range optimization",
    icon: "Banknote", // Lucide icon name
    color: "#1B5E20", // Dark dollar green
    borderColor: "#1B5E20", // Same green for border
    textColor: "#F5F5F5", // Off-white
    supportedTokens: getStablecoins(), // Stablecoins only
    minTokens: 2,
    requireTokenSelection: true,
    totalParameterSteps: 1, // Only one parameter step (step 3)
    // Templates for The Fed
    templates: [
      {
        id: "stability",
        name: "Stability Focus",
        description: "Prioritize maintaining peg with minimal deviation",
        defaults: {
          targetRange: 0.3,
          rebalanceThreshold: 0.2,
          feeReinvestment: true,
          maxSlippage: 0.1
        }
      },
      {
        id: "yield",
        name: "Yield Optimized",
        description: "Balance peg maintenance with fee generation",
        defaults: {
          targetRange: 0.5,
          rebalanceThreshold: 0.3,
          feeReinvestment: true,
          maxSlippage: 0.3
        }
      },
      {
        id: "defense",
        name: "Peg Defense",
        description: "React quickly to peg deviations",
        defaults: {
          targetRange: 0.2,
          rebalanceThreshold: 0.1,
          feeReinvestment: false,
          maxSlippage: 0.5
        }
      },
      {
        id: "custom",
        name: "Custom",
        description: "Fully customized parameter configuration"
      }
    ],
    // Keep original parameters - just update step numbers
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
        wizardStep: 3  // Changed from 2 to 3
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
        wizardStep: 3  // Changed from 2 to 3
      },
      feeReinvestment: {
        name: "Reinvest Fees",
        description: "Automatically reinvest collected fees",
        type: "boolean",
        defaultValue: true,
        wizardStep: 3  // Changed from 2 to 3
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
        wizardStep: 3  // Changed from 2 to 3
      }
    }
  }
};

/**
 * Get the list of available strategy configs (excluding the "none" strategy)
 * @returns {Array} Array of strategy objects with id, name, and subtitle
 */
export function getAvailableStrategies() {
  return Object.values(strategies)
    .filter(strategy => strategy.id !== "none")
    .map(strategy => ({
      id: strategy.id,
      name: strategy.name,
      subtitle: strategy.subtitle,
      description: strategy.description,
      templateEnumMap: strategy.templateEnumMap,
      parameters: strategy.parameters,
      parameterGroups: strategy.parameterGroups,
      contractParametersGroups: strategy.contractParametersGroups,
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
    subtitle: strategy.subtitle,
    description: strategy.description,
    icon: strategy.icon,
    color: strategy.color,
    borderColor: strategy.borderColor,
    textColor: strategy.textColor,
    supportedTokens: strategy.supportedTokens,
    minTokens: strategy.minTokens,
    maxTokens: strategy.maxTokens,
    requireTokenSelection: strategy.requireTokenSelection,
    parameterGroups: strategy.parameterGroups || [],
    totalParameterSteps: strategy.totalParameterSteps || 0
  };
}

/**
 * Get templates for a specific strategy
 * @param {string} strategyId - ID of the strategy
 * @returns {Array} Array of template objects
 */
export function getStrategyTemplates(strategyId) {
  const strategy = strategies[strategyId];
  if (!strategy || !strategy.templates) return [];

  return strategy.templates;
}

/**
 * Get default parameters for a specific template
 * @param {string} strategyId - ID of the strategy
 * @param {string} templateId - ID of the template
 * @returns {Object} Default parameter values for the template
 */
export function getTemplateDefaults(strategyId, templateId) {
  const strategy = strategies[strategyId];
  if (!strategy || !strategy.templates) return {};

  // For custom template or when no specific template is selected
  if (templateId === "custom" || !templateId) {
    return Object.entries(strategy.parameters || {}).reduce((defaults, [paramId, paramConfig]) => {
      defaults[paramId] = paramConfig.defaultValue;
      return defaults;
    }, {});
  }

  // Find the specific template
  const template = strategy.templates.find(t => t.id === templateId);
  if (!template || !template.defaults) {
    // Fallback to strategy defaults
    return getTemplateDefaults(strategyId, "custom");
  }

  return template.defaults;
}

/**
 * Get the default parameters for a strategy
 * @param {string} strategyId - ID of the strategy
 * @returns {Object} Object with default parameter values
 */
export function getDefaultParams(strategyId) {
  return getTemplateDefaults(strategyId, "custom");
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
    // Validate upper and lower ranges
    if (params.targetRangeUpper <= 0) {
      errors.targetRangeUpper = "Upper range must be greater than 0";
    }
    if (params.targetRangeLower <= 0) {
      errors.targetRangeLower = "Lower range must be greater than 0";
    }
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors
  };
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

export default {
  getAvailableStrategies,
  getStrategyDetails,
  getDefaultParams,
  getStrategyParameters,
  getStrategyParametersByStep,
  validateStrategyParams,
  getStrategyTemplates,
  getTemplateDefaults,
  getStrategyLayouts,
  shouldRenderLayout
};
