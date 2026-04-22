// src/configs/strategies.js

/**
 * Strategy configuration with templates and parameters
 * Core definitions for DeFi liquidity management strategies
 */
const strategies = {
  // None strategy (manual management)
  "none": {
    id: "none",
    name: "No Strategy",
    subtitle: "No Automated Strategy",
    description: "Manually manage your positions without automation",
    icon: "Ban",
    color: "#6c757d",
    borderColor: "#6c757d",
    textColor: "#FFFFFF",
    tokenSupport: "all",
    minTokens: 0,
    maxTokens: 0,
    minPlatforms: 0,
    maxPlatforms: 0,
    minPositions: 0,
    maxPositions: 0,
    strategyProperties: {},
    templateEnumMap: {
      'custom': 0
    },
    templates: {
      'custom': {
        name: "Custom",
        description: "Fully customized parameter configuration",
        defaults: {
          tokenDeposits: {
            tokens: [],
            amounts: {}
          }
        }
      }
    },
    parameters: {
      tokenDeposits: {
        name: "Token Deposits",
        description: "Select tokens and amounts to deposit into your vault",
        type: "token-deposits",
        defaultValue: { tokens: [], amounts: {} },
        group: 0,
        contractGroup: "manual"
      }
    },
    parameterGroups: {
      0: {
        name: "Manual Settings",
        description: "Configure manual token deposits and management"
      }
    },
    contractParametersGroups: {
      "manual": {
        setterMethod: "setTokenDeposits"
      }
    }
  },

  // Basic strategy - simplified version of Parris Island
  "bob": {
    id: "bob",
    name: "Baby Steps",
    subtitle: "Baby Step into Liquidity Management",
    description: "A simplified strategy for beginner position management w/ only essential controls",
    icon: "Footprints",
    color: "gold",
    borderColor: "black",
    textColor: "black",
    tokenSupport: "all",
    minTokens: 2,
    maxTokens: 2,
    minPlatforms: 1,
    maxPlatforms: 1,
    minPositions: 1,
    maxPositions: 1,
    strategyProperties: {
      minTVL: 1000000,
      minPoolAge: 90,
      tvlAveragingPeriod: 14,
      transactionDeadlineSeconds: 60
    },
    // Templates for Basic Strategy
    templateEnumMap: {
      'custom': 0,
      'conservative': 1,
      'moderate': 2,
      'aggressive': 3,
      'stablecoin': 4
    },
    templates: {
      'conservative': {
        name: "Conservative",
        description: "Wider ranges with fewer rebalances, lower risk",
        defaults: {
          targetRangeUpper: 10.0,
          targetRangeLower: 10.0,
          maxSlippage: 0.5,
          emergencyExitTrigger: 10,
          feeReinvestment: true,
          reinvestmentTrigger: 50.00,
          reinvestmentRatio: 30
        }
      },
      'moderate': {
        name: "Moderate",
        description: "Balanced approach to risk and yield",
        defaults: {
          targetRangeUpper: 5.0,
          targetRangeLower: 5.0,
          maxSlippage: 0.5,
          emergencyExitTrigger: 10,
          feeReinvestment: true,
          reinvestmentTrigger: 50.00,
          reinvestmentRatio: 50
        }
      },
      'aggressive': {
        name: "Aggressive",
        description: "Tighter ranges for maximum fee generation",
        defaults: {
          targetRangeUpper: 3.0,
          targetRangeLower: 3.0,
          maxSlippage: 0.5,
          emergencyExitTrigger: 10,
          feeReinvestment: true,
          reinvestmentTrigger: 50.00,
          reinvestmentRatio: 90
        }
      },
      'stablecoin': {
        name: "Stablecoin",
        description: "Very tight ranges for stablecoin pairs",
        defaults: {
          targetRangeUpper: 0.2,
          targetRangeLower: 0.2,
          maxSlippage: 0.2,
          emergencyExitTrigger: 1.0,
          feeReinvestment: true,
          reinvestmentTrigger: 10.00,
          reinvestmentRatio: 100
        }
      },
      'custom': {
        name: "Custom",
        description: "Fully customized parameter configuration",
        defaults: {
          targetRangeUpper: 5.0,
          targetRangeLower: 5.0,
          feeReinvestment: true,
          reinvestmentTrigger: 50.00,
          reinvestmentRatio: 50,
          maxSlippage: 0.5,
          emergencyExitTrigger: 10
        }
      }
    },
    parameters: {
      // Range and Rebalance Parameters
      targetRangeUpper: {
        name: "Upper Range",
        description: "Range percentage above current price",
        type: "percent",
        defaultValue: 5.0,
        min: 0.1,
        max: 20.0,
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
        defaultValue: 50.00,
        min: 5.00,
        max: 10000.00,
        step: 5.00,
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
        min: 1,
        max: 50,
        step: 1,
        suffix: "%",
        group: 2,
        contractGroup: "risk"
      }
    },
    parameterGroups: {
      0: {
        name: "Range Settings",
        description: "Control how your position responds to price movements"
      },
      1: {
        name: "Fee Settings",
        description: "Configure how fees are handled and reinvested"
      },
      2: {
        name: "Risk Management",
        description: "Set safeguards to protect your position"
      }
    },
    contractParametersGroups: {
      "range": {
        setterMethod: "setRangeParameters"
      },
      "fee": {
        setterMethod: "setFeeParameters"
      },
      "risk": {
        setterMethod: "setRiskParameters"
      }
    }
  },

};

export default strategies;
