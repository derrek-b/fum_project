// src/configs/strategies.js
import { getAllTokens, getStablecoins } from "../helpers/tokenHelpers.js";

/**
 * Strategy configuration with templates and parameters
 * Core definitions for DeFi liquidity management strategies
 */
const strategies = {
  // None strategy (manual management)
  "none": {
    id: "none",
    name: "Manual Management",
    subtitle: "No Automated Strategy",
    description: "Manually manage your positions without automation",
    icon: "Ban",
    color: "#6c757d",
    borderColor: "#6c757d",
    textColor: "#FFFFFF",
    supportedTokens: getAllTokens(),
    parameters: {
      tokenDeposits: {
        name: "Token Deposits",
        description: "Select tokens and amounts to deposit into your vault",
        type: "token-deposits",
        defaultValue: { tokens: [], amounts: {} }
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

  // Parris Island strategy
  "parris": {
    id: "parris",
    name: "Parris Island",
    subtitle: "Basic Liquidity Management",
    description: "A foundational strategy for automated liquidity position management with essential controls",
    icon: "Dumbbell",
    color: "#1565C0",
    borderColor: "#B22234",
    textColor: "#FFFFFF",
    supportedTokens: getAllTokens(),
    minTokens: 2,
    requireTokenSelection: true,
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
    // Templates for Parris Island
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
    parameters: {
      // Range and Rebalance Parameters
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
        contractGroup: "range"
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
        contractGroup: "range"
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
        contractGroup: "range"
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
        contractGroup: "range"
      },

      // Fee Settings
      feeReinvestment: {
        name: "Reinvest Fees",
        description: "Automatically reinvest collected fees",
        type: "boolean",
        defaultValue: true,
        group: 1,
        contractGroup: "fee"
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
        conditionalOn: "feeReinvestment",
        conditionalValue: true
      },

      // Risk Management
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
        contractGroup: "risk"
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
        contractGroup: "risk"
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
        contractGroup: "risk"
      },

      // Adaptive Range Parameters
      adaptiveRanges: {
        name: "Adaptive Ranges",
        description: "Automatically adjust ranges based on rebalance frequency",
        type: "boolean",
        defaultValue: true,
        group: 3,
        contractGroup: "adaptive"
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
        conditionalOn: "adaptiveRanges",
        conditionalValue: true
      },

      // Oracle Parameters
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
        contractGroup: "oracle"
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
        contractGroup: "oracle"
      },

      // Position Sizing Parameters
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
        contractGroup: "positionSizing"
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
        contractGroup: "positionSizing"
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
        contractGroup: "positionSizing"
      },

      // Platform Parameters
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
        contractGroup: "platform"
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
        contractGroup: "platform"
      }
    }
  },

  // The Fed strategy for stablecoin management
  "fed": {
    id: "fed",
    name: "The Fed",
    subtitle: "Stablecoin Optimization",
    description: "Automated stablecoin strategy with peg deviation positioning and range optimization",
    icon: "Banknote",
    color: "#1B5E20",
    borderColor: "#1B5E20",
    textColor: "#F5F5F5",
    supportedTokens: getStablecoins(),
    minTokens: 2,
    requireTokenSelection: true,
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
    parameters: {
      targetRange: {
        name: "Range",
        description: "Range around the current price to set the position boundaries",
        type: "number",
        defaultValue: 0.5,
        min: 0.1,
        max: 5.0,
        step: 0.1,
        suffix: "%"
      },
      rebalanceThreshold: {
        name: "Rebalance Trigger",
        description: "Price movement percentage that triggers a rebalance",
        type: "number",
        defaultValue: 1.0,
        min: 0.1,
        max: 10.0,
        step: 0.1,
        suffix: "%"
      },
      feeReinvestment: {
        name: "Reinvest Fees",
        description: "Automatically reinvest collected fees",
        type: "boolean",
        defaultValue: true
      },
      maxSlippage: {
        name: "Max Slippage",
        description: "Maximum acceptable slippage when executing trades",
        type: "number",
        defaultValue: 0.5,
        min: 0.1,
        max: 5.0,
        step: 0.1,
        suffix: "%"
      }
    }
  }
};

export default strategies;
