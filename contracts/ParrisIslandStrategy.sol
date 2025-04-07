// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title ParrisIslandStrategy
 * @dev Contract that stores and manages parameters for the Parris Island liquidity management strategy
 * Uses templates as source of truth with efficient parameter customization
 */
contract ParrisIslandStrategy is Ownable {
    // Version information
    string public constant VERSION = "1.0.0";

    // ==================== Events ====================
    event ParameterUpdated(address indexed vault, string paramName);
    event TemplateSelected(address indexed vault, Template template);
    event CustomizationUpdated(address indexed vault, uint256 bitmap);

    // ==================== Enums ====================
    // Templates
    enum Template { None, Conservative, Moderate, Aggressive }

    // Oracle sources
    enum OracleSource { DEX, Chainlink, TWAP }

    // Platform selection criteria
    enum PlatformSelectionCriteria { HighestTVL, HighestVolume, LowestFees, HighestRewards }

    // ==================== Template Constants ====================
    // Conservative template values
    uint16 private constant CONS_TARGET_RANGE_UPPER = 300;          // 3.00%
    uint16 private constant CONS_TARGET_RANGE_LOWER = 300;          // 3.00%
    uint16 private constant CONS_REBALANCE_THRESHOLD_UPPER = 150;   // 1.50%
    uint16 private constant CONS_REBALANCE_THRESHOLD_LOWER = 150;   // 1.50%
    uint16 private constant CONS_MAX_SLIPPAGE = 30;                 // 0.30%
    uint16 private constant CONS_EMERGENCY_EXIT_TRIGGER = 2000;     // 20.00%
    uint16 private constant CONS_MAX_VAULT_UTILIZATION = 6000;      // 60.00%
    uint16 private constant CONS_MAX_POSITION_SIZE_PERCENT = 2000;  // 20.00%
    uint256 private constant CONS_MIN_POSITION_SIZE = 200 ether;    // $200
    uint16 private constant CONS_TARGET_UTILIZATION = 1500;         // 15.00%
    uint16 private constant CONS_PRICE_DEVIATION_TOLERANCE = 50;    // 0.50%
    uint256 private constant CONS_MIN_POOL_LIQUIDITY = 200000 ether;// $200,000

    // Moderate template values
    uint16 private constant MOD_TARGET_RANGE_UPPER = 500;           // 5.00%
    uint16 private constant MOD_TARGET_RANGE_LOWER = 500;           // 5.00%
    uint16 private constant MOD_REBALANCE_THRESHOLD_UPPER = 100;    // 1.00%
    uint16 private constant MOD_REBALANCE_THRESHOLD_LOWER = 100;    // 1.00%
    uint256 private constant MOD_REINVESTMENT_TRIGGER = 50 ether;   // $50
    uint16 private constant MOD_REINVESTMENT_RATIO = 8000;          // 80.00%
    uint16 private constant MOD_MAX_SLIPPAGE = 50;                  // 0.50%
    uint16 private constant MOD_EMERGENCY_EXIT_TRIGGER = 1500;      // 15.00%
    uint16 private constant MOD_MAX_VAULT_UTILIZATION = 8000;       // 80.00%
    uint8 private constant MOD_REBALANCE_COUNT_THRESHOLD_HIGH = 3;
    uint8 private constant MOD_REBALANCE_COUNT_THRESHOLD_LOW = 1;
    uint16 private constant MOD_ADAPTIVE_TIMEFRAME_HIGH = 7;        // 7 days
    uint16 private constant MOD_ADAPTIVE_TIMEFRAME_LOW = 7;         // 7 days
    uint16 private constant MOD_RANGE_ADJUSTMENT_PERCENT_HIGH = 2000;      // 20.00%
    uint16 private constant MOD_THRESHOLD_ADJUSTMENT_PERCENT_HIGH = 1500;  // 15.00%
    uint16 private constant MOD_RANGE_ADJUSTMENT_PERCENT_LOW = 2000;       // 20.00%
    uint16 private constant MOD_THRESHOLD_ADJUSTMENT_PERCENT_LOW = 1500;   // 15.00%
    uint16 private constant MOD_MAX_POSITION_SIZE_PERCENT = 3000;   // 30.00%
    uint256 private constant MOD_MIN_POSITION_SIZE = 100 ether;     // $100
    uint16 private constant MOD_TARGET_UTILIZATION = 2000;          // 20.00%
    uint16 private constant MOD_PRICE_DEVIATION_TOLERANCE = 100;    // 1.00%
    uint256 private constant MOD_MIN_POOL_LIQUIDITY = 100000 ether; // $100,000

    // Aggressive template values
    uint16 private constant AGG_TARGET_RANGE_UPPER = 800;           // 8.00%
    uint16 private constant AGG_TARGET_RANGE_LOWER = 800;           // 8.00%
    uint16 private constant AGG_REBALANCE_THRESHOLD_UPPER = 80;     // 0.80%
    uint16 private constant AGG_REBALANCE_THRESHOLD_LOWER = 80;     // 0.80%
    uint256 private constant AGG_REINVESTMENT_TRIGGER = 25 ether;   // $25
    uint16 private constant AGG_REINVESTMENT_RATIO = 10000;         // 100.00%
    uint16 private constant AGG_MAX_SLIPPAGE = 100;                 // 1.00%
    uint16 private constant AGG_EMERGENCY_EXIT_TRIGGER = 1000;      // 10.00%
    uint16 private constant AGG_MAX_VAULT_UTILIZATION = 9500;       // 95.00%
    uint8 private constant AGG_REBALANCE_COUNT_THRESHOLD_HIGH = 4;
    uint8 private constant AGG_REBALANCE_COUNT_THRESHOLD_LOW = 1;
    uint16 private constant AGG_ADAPTIVE_TIMEFRAME_HIGH = 5;        // 5 days
    uint16 private constant AGG_ADAPTIVE_TIMEFRAME_LOW = 5;         // 5 days
    uint16 private constant AGG_RANGE_ADJUSTMENT_PERCENT_HIGH = 3000;      // 30.00%
    uint16 private constant AGG_THRESHOLD_ADJUSTMENT_PERCENT_HIGH = 2000;  // 20.00%
    uint16 private constant AGG_RANGE_ADJUSTMENT_PERCENT_LOW = 3000;       // 30.00%
    uint16 private constant AGG_THRESHOLD_ADJUSTMENT_PERCENT_LOW = 2000;   // 20.00%
    uint16 private constant AGG_MAX_POSITION_SIZE_PERCENT = 5000;   // 50.00%
    uint256 private constant AGG_MIN_POSITION_SIZE = 50 ether;      // $50
    uint16 private constant AGG_TARGET_UTILIZATION = 3000;          // 30.00%
    uint16 private constant AGG_PRICE_DEVIATION_TOLERANCE = 200;    // 2.00%
    uint256 private constant AGG_MIN_POOL_LIQUIDITY = 50000 ether;  // $50,000

    // ==================== Customization Bitmap ====================
    // Bitmap tracks which parameters have been customized (1 = customized, 0 = use template)
    // Bit positions:
    // 0: targetRangeUpper
    // 1: targetRangeLower
    // 2: rebalanceThresholdUpper
    // 3: rebalanceThresholdLower
    // 4: feeReinvestment
    // ... and so on
    mapping(address => uint256) public customizationBitmap;

    // ==================== Template Selection ====================
    mapping(address => Template) public selectedTemplate;

    // ==================== Parameter Storage ====================
    // Range Parameters
    mapping(address => uint16) public targetRangeUpper;         // Basis points (1/100th of a percent)
    mapping(address => uint16) public targetRangeLower;         // Basis points
    mapping(address => uint16) public rebalanceThresholdUpper;  // Basis points
    mapping(address => uint16) public rebalanceThresholdLower;  // Basis points

    // Fee Settings
    mapping(address => bool) public feeReinvestment;
    mapping(address => uint256) public reinvestmentTrigger;     // USD value in wei (18 decimals)
    mapping(address => uint16) public reinvestmentRatio;        // Basis points

    // Risk Management
    mapping(address => uint16) public maxSlippage;              // Basis points
    mapping(address => uint16) public emergencyExitTrigger;     // Basis points
    mapping(address => uint16) public maxVaultUtilization;      // Basis points

    // Adaptive Range Settings
    mapping(address => bool) public adaptiveRanges;
    mapping(address => uint8) public rebalanceCountThresholdHigh;
    mapping(address => uint8) public rebalanceCountThresholdLow;
    mapping(address => uint16) public adaptiveTimeframeHigh;    // Days
    mapping(address => uint16) public adaptiveTimeframeLow;     // Days
    mapping(address => uint16) public rangeAdjustmentPercentHigh;    // Basis points
    mapping(address => uint16) public thresholdAdjustmentPercentHigh; // Basis points
    mapping(address => uint16) public rangeAdjustmentPercentLow;     // Basis points
    mapping(address => uint16) public thresholdAdjustmentPercentLow;  // Basis points

    // Oracle Settings
    mapping(address => OracleSource) public oracleSource;
    mapping(address => uint16) public priceDeviationTolerance;   // Basis points

    // Position Sizing
    mapping(address => uint16) public maxPositionSizePercent;    // Basis points
    mapping(address => uint256) public minPositionSize;          // USD value in wei (18 decimals)
    mapping(address => uint16) public targetUtilization;         // Basis points

    // Platform Settings
    mapping(address => PlatformSelectionCriteria) public platformSelectionCriteria;
    mapping(address => uint256) public minPoolLiquidity;         // USD value in wei (18 decimals)

    /**
     * @dev Constructor
     */
    constructor() Ownable(msg.sender) {}

    // ==================== Template Selection ====================

    /**
     * @dev Select a template
     * @param template Template to select
     */
    function selectTemplate(Template template) external {
        selectedTemplate[msg.sender] = template;

        // Clear customization bitmap if selecting a non-None template
        if (template != Template.None) {
            customizationBitmap[msg.sender] = 0;
        }

        emit TemplateSelected(msg.sender, template);
    }

    // ==================== Parameter Getters ====================

    /**
     * @dev Get target range upper value with template fallback
     * @param vault Address of the vault
     * @return Parameter value
     */
    function getTargetRangeUpper(address vault) public view returns (uint16) {
        // Check if parameter is customized
        if (customizationBitmap[vault] & (1 << 0) != 0) {
            return targetRangeUpper[vault];
        }

        // Return template value
        Template template = selectedTemplate[vault];
        if (template == Template.Conservative) return CONS_TARGET_RANGE_UPPER;
        if (template == Template.Moderate) return MOD_TARGET_RANGE_UPPER;
        if (template == Template.Aggressive) return AGG_TARGET_RANGE_UPPER;

        // Default value if no template or Template.None
        return MOD_TARGET_RANGE_UPPER;
    }

    /**
     * @dev Get target range lower value with template fallback
     * @param vault Address of the vault
     * @return Parameter value
     */
    function getTargetRangeLower(address vault) public view returns (uint16) {
        // Check if parameter is customized
        if ((customizationBitmap[vault] & (1 << 1)) != 0) {
            return targetRangeLower[vault];
        }

        // Return template value
        Template template = selectedTemplate[vault];
        if (template == Template.Conservative) return CONS_TARGET_RANGE_LOWER;
        if (template == Template.Moderate) return MOD_TARGET_RANGE_LOWER;
        if (template == Template.Aggressive) return AGG_TARGET_RANGE_LOWER;

        // Default value if no template or Template.None
        return MOD_TARGET_RANGE_LOWER;
    }

    /**
     * @dev Get rebalance threshold upper value with template fallback
     * @param vault Address of the vault
     * @return Parameter value
     */
    function getRebalanceThresholdUpper(address vault) public view returns (uint16) {
        // Check if parameter is customized
        if ((customizationBitmap[vault] & (1 << 2)) != 0) {
            return rebalanceThresholdUpper[vault];
        }

        // Return template value
        Template template = selectedTemplate[vault];
        if (template == Template.Conservative) return CONS_REBALANCE_THRESHOLD_UPPER;
        if (template == Template.Moderate) return MOD_REBALANCE_THRESHOLD_UPPER;
        if (template == Template.Aggressive) return AGG_REBALANCE_THRESHOLD_UPPER;

        // Default value if no template or Template.None
        return MOD_REBALANCE_THRESHOLD_UPPER;
    }

    /**
     * @dev Get rebalance threshold lower value with template fallback
     * @param vault Address of the vault
     * @return Parameter value
     */
    function getRebalanceThresholdLower(address vault) public view returns (uint16) {
        // Check if parameter is customized
        if ((customizationBitmap[vault] & (1 << 3)) != 0) {
            return rebalanceThresholdLower[vault];
        }

        // Return template value
        Template template = selectedTemplate[vault];
        if (template == Template.Conservative) return CONS_REBALANCE_THRESHOLD_LOWER;
        if (template == Template.Moderate) return MOD_REBALANCE_THRESHOLD_LOWER;
        if (template == Template.Aggressive) return AGG_REBALANCE_THRESHOLD_LOWER;

        // Default value if no template or Template.None
        return MOD_REBALANCE_THRESHOLD_LOWER;
    }

    /**
     * @dev Get fee reinvestment flag with template fallback
     * @param vault Address of the vault
     * @return Parameter value
     */
    function getFeeReinvestment(address vault) public view returns (bool) {
        // Check if parameter is customized
        if ((customizationBitmap[vault] & (1 << 4)) != 0) {
            return feeReinvestment[vault];
        }

        // Return template value
        Template template = selectedTemplate[vault];
        if (template == Template.Conservative) return false;
        if (template == Template.Moderate) return true;
        if (template == Template.Aggressive) return true;

        // Default value if no template or Template.None
        return true;
    }

    /**
     * @dev Get reinvestment trigger value with template fallback
     * @param vault Address of the vault
     * @return Parameter value
     */
    function getReinvestmentTrigger(address vault) public view returns (uint256) {
        // Check if parameter is customized
        if ((customizationBitmap[vault] & (1 << 5)) != 0) {
            return reinvestmentTrigger[vault];
        }

        // Return template value
        Template template = selectedTemplate[vault];
        if (template == Template.Conservative) return 0;              // Not used since reinvestment is off
        if (template == Template.Moderate) return MOD_REINVESTMENT_TRIGGER;
        if (template == Template.Aggressive) return AGG_REINVESTMENT_TRIGGER;

        // Default value if no template or Template.None
        return MOD_REINVESTMENT_TRIGGER;
    }

    /**
     * @dev Get reinvestment ratio value with template fallback
     * @param vault Address of the vault
     * @return Parameter value
     */
    function getReinvestmentRatio(address vault) public view returns (uint16) {
        // Check if parameter is customized
        if ((customizationBitmap[vault] & (1 << 6)) != 0) {
            return reinvestmentRatio[vault];
        }

        // Return template value
        Template template = selectedTemplate[vault];
        if (template == Template.Conservative) return 0;              // Not used since reinvestment is off
        if (template == Template.Moderate) return MOD_REINVESTMENT_RATIO;
        if (template == Template.Aggressive) return AGG_REINVESTMENT_RATIO;

        // Default value if no template or Template.None
        return MOD_REINVESTMENT_RATIO;
    }

    /**
     * @dev Get max slippage value with template fallback
     * @param vault Address of the vault
     * @return Parameter value
     */
    function getMaxSlippage(address vault) public view returns (uint16) {
        // Check if parameter is customized
        if ((customizationBitmap[vault] & (1 << 7)) != 0) {
            return maxSlippage[vault];
        }

        // Return template value
        Template template = selectedTemplate[vault];
        if (template == Template.Conservative) return CONS_MAX_SLIPPAGE;
        if (template == Template.Moderate) return MOD_MAX_SLIPPAGE;
        if (template == Template.Aggressive) return AGG_MAX_SLIPPAGE;

        // Default value if no template or Template.None
        return MOD_MAX_SLIPPAGE;
    }

    /**
     * @dev Get emergency exit trigger value with template fallback
     * @param vault Address of the vault
     * @return Parameter value
     */
    function getEmergencyExitTrigger(address vault) public view returns (uint16) {
        // Check if parameter is customized
        if ((customizationBitmap[vault] & (1 << 8)) != 0) {
            return emergencyExitTrigger[vault];
        }

        // Return template value
        Template template = selectedTemplate[vault];
        if (template == Template.Conservative) return CONS_EMERGENCY_EXIT_TRIGGER;
        if (template == Template.Moderate) return MOD_EMERGENCY_EXIT_TRIGGER;
        if (template == Template.Aggressive) return AGG_EMERGENCY_EXIT_TRIGGER;

        // Default value if no template or Template.None
        return MOD_EMERGENCY_EXIT_TRIGGER;
    }

    /**
     * @dev Get max vault utilization value with template fallback
     * @param vault Address of the vault
     * @return Parameter value
     */
    function getMaxVaultUtilization(address vault) public view returns (uint16) {
        // Check if parameter is customized
        if ((customizationBitmap[vault] & (1 << 9)) != 0) {
            return maxVaultUtilization[vault];
        }

        // Return template value
        Template template = selectedTemplate[vault];
        if (template == Template.Conservative) return CONS_MAX_VAULT_UTILIZATION;
        if (template == Template.Moderate) return MOD_MAX_VAULT_UTILIZATION;
        if (template == Template.Aggressive) return AGG_MAX_VAULT_UTILIZATION;

        // Default value if no template or Template.None
        return MOD_MAX_VAULT_UTILIZATION;
    }

    /**
     * @dev Get adaptive ranges flag with template fallback
     * @param vault Address of the vault
     * @return Parameter value
     */
    function getAdaptiveRanges(address vault) public view returns (bool) {
        // Check if parameter is customized
        if ((customizationBitmap[vault] & (1 << 10)) != 0) {
            return adaptiveRanges[vault];
        }

        // Return template value
        Template template = selectedTemplate[vault];
        if (template == Template.Conservative) return false;
        if (template == Template.Moderate) return true;
        if (template == Template.Aggressive) return true;

        // Default value if no template or Template.None
        return true;
    }

    /**
     * @dev Get rebalance count threshold high value with template fallback
     * @param vault Address of the vault
     * @return Parameter value
     */
    function getRebalanceCountThresholdHigh(address vault) public view returns (uint8) {
        // Check if parameter is customized
        if ((customizationBitmap[vault] & (1 << 11)) != 0) {
            return rebalanceCountThresholdHigh[vault];
        }

        // Return template value
        Template template = selectedTemplate[vault];
        if (template == Template.Conservative) return 0;              // Not used since adaptive is off
        if (template == Template.Moderate) return MOD_REBALANCE_COUNT_THRESHOLD_HIGH;
        if (template == Template.Aggressive) return AGG_REBALANCE_COUNT_THRESHOLD_HIGH;

        // Default value if no template or Template.None
        return MOD_REBALANCE_COUNT_THRESHOLD_HIGH;
    }

    /**
     * @dev Get rebalance count threshold low value with template fallback
     * @param vault Address of the vault
     * @return Parameter value
     */
    function getRebalanceCountThresholdLow(address vault) public view returns (uint8) {
        // Check if parameter is customized
        if ((customizationBitmap[vault] & (1 << 12)) != 0) {
            return rebalanceCountThresholdLow[vault];
        }

        // Return template value
        Template template = selectedTemplate[vault];
        if (template == Template.Conservative) return 0;              // Not used since adaptive is off
        if (template == Template.Moderate) return MOD_REBALANCE_COUNT_THRESHOLD_LOW;
        if (template == Template.Aggressive) return AGG_REBALANCE_COUNT_THRESHOLD_LOW;

        // Default value if no template or Template.None
        return MOD_REBALANCE_COUNT_THRESHOLD_LOW;
    }

    /**
     * @dev Get adaptive timeframe high value with template fallback
     * @param vault Address of the vault
     * @return Parameter value
     */
    function getAdaptiveTimeframeHigh(address vault) public view returns (uint16) {
        // Check if parameter is customized
        if ((customizationBitmap[vault] & (1 << 13)) != 0) {
            return adaptiveTimeframeHigh[vault];
        }

        // Return template value
        Template template = selectedTemplate[vault];
        if (template == Template.Conservative) return 0;              // Not used since adaptive is off
        if (template == Template.Moderate) return MOD_ADAPTIVE_TIMEFRAME_HIGH;
        if (template == Template.Aggressive) return AGG_ADAPTIVE_TIMEFRAME_HIGH;

        // Default value if no template or Template.None
        return MOD_ADAPTIVE_TIMEFRAME_HIGH;
    }

    /**
     * @dev Get adaptive timeframe low value with template fallback
     * @param vault Address of the vault
     * @return Parameter value
     */
    function getAdaptiveTimeframeLow(address vault) public view returns (uint16) {
        // Check if parameter is customized
        if ((customizationBitmap[vault] & (1 << 14)) != 0) {
            return adaptiveTimeframeLow[vault];
        }

        // Return template value
        Template template = selectedTemplate[vault];
        if (template == Template.Conservative) return 0;              // Not used since adaptive is off
        if (template == Template.Moderate) return MOD_ADAPTIVE_TIMEFRAME_LOW;
        if (template == Template.Aggressive) return AGG_ADAPTIVE_TIMEFRAME_LOW;

        // Default value if no template or Template.None
        return MOD_ADAPTIVE_TIMEFRAME_LOW;
    }

    /**
     * @dev Get range adjustment percent high value with template fallback
     * @param vault Address of the vault
     * @return Parameter value
     */
    function getRangeAdjustmentPercentHigh(address vault) public view returns (uint16) {
        // Check if parameter is customized
        if ((customizationBitmap[vault] & (1 << 15)) != 0) {
            return rangeAdjustmentPercentHigh[vault];
        }

        // Return template value
        Template template = selectedTemplate[vault];
        if (template == Template.Conservative) return 0;              // Not used since adaptive is off
        if (template == Template.Moderate) return MOD_RANGE_ADJUSTMENT_PERCENT_HIGH;
        if (template == Template.Aggressive) return AGG_RANGE_ADJUSTMENT_PERCENT_HIGH;

        // Default value if no template or Template.None
        return MOD_RANGE_ADJUSTMENT_PERCENT_HIGH;
    }

    /**
     * @dev Get threshold adjustment percent high value with template fallback
     * @param vault Address of the vault
     * @return Parameter value
     */
    function getThresholdAdjustmentPercentHigh(address vault) public view returns (uint16) {
        // Check if parameter is customized
        if ((customizationBitmap[vault] & (1 << 16)) != 0) {
            return thresholdAdjustmentPercentHigh[vault];
        }

        // Return template value
        Template template = selectedTemplate[vault];
        if (template == Template.Conservative) return 0;              // Not used since adaptive is off
        if (template == Template.Moderate) return MOD_THRESHOLD_ADJUSTMENT_PERCENT_HIGH;
        if (template == Template.Aggressive) return AGG_THRESHOLD_ADJUSTMENT_PERCENT_HIGH;

        // Default value if no template or Template.None
        return MOD_THRESHOLD_ADJUSTMENT_PERCENT_HIGH;
    }

    /**
     * @dev Get range adjustment percent low value with template fallback
     * @param vault Address of the vault
     * @return Parameter value
     */
    function getRangeAdjustmentPercentLow(address vault) public view returns (uint16) {
        // Check if parameter is customized
        if ((customizationBitmap[vault] & (1 << 17)) != 0) {
            return rangeAdjustmentPercentLow[vault];
        }

        // Return template value
        Template template = selectedTemplate[vault];
        if (template == Template.Conservative) return 0;              // Not used since adaptive is off
        if (template == Template.Moderate) return MOD_RANGE_ADJUSTMENT_PERCENT_LOW;
        if (template == Template.Aggressive) return AGG_RANGE_ADJUSTMENT_PERCENT_LOW;

        // Default value if no template or Template.None
        return MOD_RANGE_ADJUSTMENT_PERCENT_LOW;
    }

    /**
     * @dev Get threshold adjustment percent low value with template fallback
     * @param vault Address of the vault
     * @return Parameter value
     */
    function getThresholdAdjustmentPercentLow(address vault) public view returns (uint16) {
        // Check if parameter is customized
        if ((customizationBitmap[vault] & (1 << 18)) != 0) {
            return thresholdAdjustmentPercentLow[vault];
        }

        // Return template value
        Template template = selectedTemplate[vault];
        if (template == Template.Conservative) return 0;              // Not used since adaptive is off
        if (template == Template.Moderate) return MOD_THRESHOLD_ADJUSTMENT_PERCENT_LOW;
        if (template == Template.Aggressive) return AGG_THRESHOLD_ADJUSTMENT_PERCENT_LOW;

        // Default value if no template or Template.None
        return MOD_THRESHOLD_ADJUSTMENT_PERCENT_LOW;
    }

    /**
     * @dev Get oracle source value with template fallback
     * @param vault Address of the vault
     * @return Parameter value
     */
    function getOracleSource(address vault) public view returns (OracleSource) {
        // Check if parameter is customized
        if ((customizationBitmap[vault] & (1 << 19)) != 0) {
            return oracleSource[vault];
        }

        // Return template value
        Template template = selectedTemplate[vault];
        if (template == Template.Conservative) return OracleSource.Chainlink;
        if (template == Template.Moderate) return OracleSource.DEX;
        if (template == Template.Aggressive) return OracleSource.TWAP;

        // Default value if no template or Template.None
        return OracleSource.DEX;
    }

    /**
     * @dev Get price deviation tolerance value with template fallback
     * @param vault Address of the vault
     * @return Parameter value
     */
    function getPriceDeviationTolerance(address vault) public view returns (uint16) {
        // Check if parameter is customized
        if ((customizationBitmap[vault] & (1 << 20)) != 0) {
            return priceDeviationTolerance[vault];
        }

        // Return template value
        Template template = selectedTemplate[vault];
        if (template == Template.Conservative) return CONS_PRICE_DEVIATION_TOLERANCE;
        if (template == Template.Moderate) return MOD_PRICE_DEVIATION_TOLERANCE;
        if (template == Template.Aggressive) return AGG_PRICE_DEVIATION_TOLERANCE;

        // Default value if no template or Template.None
        return MOD_PRICE_DEVIATION_TOLERANCE;
    }

    /**
     * @dev Get max position size percent value with template fallback
     * @param vault Address of the vault
     * @return Parameter value
     */
    function getMaxPositionSizePercent(address vault) public view returns (uint16) {
        // Check if parameter is customized
        if ((customizationBitmap[vault] & (1 << 21)) != 0) {
            return maxPositionSizePercent[vault];
        }

        // Return template value
        Template template = selectedTemplate[vault];
        if (template == Template.Conservative) return CONS_MAX_POSITION_SIZE_PERCENT;
        if (template == Template.Moderate) return MOD_MAX_POSITION_SIZE_PERCENT;
        if (template == Template.Aggressive) return AGG_MAX_POSITION_SIZE_PERCENT;

        // Default value if no template or Template.None
        return MOD_MAX_POSITION_SIZE_PERCENT;
    }

    /**
     * @dev Get min position size value with template fallback
     * @param vault Address of the vault
     * @return Parameter value
     */
    function getMinPositionSize(address vault) public view returns (uint256) {
        // Check if parameter is customized
        if ((customizationBitmap[vault] & (1 << 22)) != 0) {
            return minPositionSize[vault];
        }

        // Return template value
        Template template = selectedTemplate[vault];
        if (template == Template.Conservative) return CONS_MIN_POSITION_SIZE;
        if (template == Template.Moderate) return MOD_MIN_POSITION_SIZE;
        if (template == Template.Aggressive) return AGG_MIN_POSITION_SIZE;

        // Default value if no template or Template.None
        return MOD_MIN_POSITION_SIZE;
    }

    /**
     * @dev Get target utilization value with template fallback
     * @param vault Address of the vault
     * @return Parameter value
     */
    function getTargetUtilization(address vault) public view returns (uint16) {
        // Check if parameter is customized
        if ((customizationBitmap[vault] & (1 << 23)) != 0) {
            return targetUtilization[vault];
        }

        // Return template value
        Template template = selectedTemplate[vault];
        if (template == Template.Conservative) return CONS_TARGET_UTILIZATION;
        if (template == Template.Moderate) return MOD_TARGET_UTILIZATION;
        if (template == Template.Aggressive) return AGG_TARGET_UTILIZATION;

        // Default value if no template or Template.None
        return MOD_TARGET_UTILIZATION;
    }

    /**
     * @dev Get platform selection criteria value with template fallback
     * @param vault Address of the vault
     * @return Parameter value
     */
    function getPlatformSelectionCriteria(address vault) public view returns (PlatformSelectionCriteria) {
        // Check if parameter is customized
        if ((customizationBitmap[vault] & (1 << 24)) != 0) {
            return platformSelectionCriteria[vault];
        }

        // Return template value
        Template template = selectedTemplate[vault];
        if (template == Template.Conservative) return PlatformSelectionCriteria.HighestTVL;
        if (template == Template.Moderate) return PlatformSelectionCriteria.HighestVolume;
        if (template == Template.Aggressive) return PlatformSelectionCriteria.HighestRewards;

        // Default value if no template or Template.None
        return PlatformSelectionCriteria.HighestVolume;
    }

    /**
     * @dev Get min pool liquidity value with template fallback
     * @param vault Address of the vault
     * @return Parameter value
     */
    function getMinPoolLiquidity(address vault) public view returns (uint256) {
        // Check if parameter is customized
        if ((customizationBitmap[vault] & (1 << 25)) != 0) {
            return minPoolLiquidity[vault];
        }

        // Return template value
        Template template = selectedTemplate[vault];
        if (template == Template.Conservative) return CONS_MIN_POOL_LIQUIDITY;
        if (template == Template.Moderate) return MOD_MIN_POOL_LIQUIDITY;
        if (template == Template.Aggressive) return AGG_MIN_POOL_LIQUIDITY;

        // Default value if no template or Template.None
        return MOD_MIN_POOL_LIQUIDITY;
    }

    /**
     * @dev Get all parameters for a vault in a single call (with template fallbacks)
     * @param vault Address of the vault
     * @return All strategy parameters packaged in a tuple
     */
    function getAllParameters(address vault) external view returns (
        uint16, uint16, uint16, uint16,
        bool, uint256, uint16,
        uint16, uint16, uint16,
        bool, uint8, uint8, uint16, uint16, uint16, uint16, uint16, uint16,
        OracleSource, uint16,
        uint16, uint256, uint16,
        PlatformSelectionCriteria, uint256
    ) {
        return (
            // Range Parameters
            getTargetRangeUpper(vault), getTargetRangeLower(vault),
            getRebalanceThresholdUpper(vault), getRebalanceThresholdLower(vault),

            // Fee Settings
            getFeeReinvestment(vault), getReinvestmentTrigger(vault), getReinvestmentRatio(vault),

            // Risk Management
            getMaxSlippage(vault), getEmergencyExitTrigger(vault), getMaxVaultUtilization(vault),

            // Adaptive Settings
            getAdaptiveRanges(vault), getRebalanceCountThresholdHigh(vault), getRebalanceCountThresholdLow(vault),
            getAdaptiveTimeframeHigh(vault), getAdaptiveTimeframeLow(vault),
            getRangeAdjustmentPercentHigh(vault), getThresholdAdjustmentPercentHigh(vault),
            getRangeAdjustmentPercentLow(vault), getThresholdAdjustmentPercentLow(vault),

            // Oracle Settings
            getOracleSource(vault), getPriceDeviationTolerance(vault),

            // Position Sizing
            getMaxPositionSizePercent(vault), getMinPositionSize(vault), getTargetUtilization(vault),

            // Platform Settings
            getPlatformSelectionCriteria(vault), getMinPoolLiquidity(vault)
        );
    }

    // ==================== Parameter Setters ====================

    /**
     * @dev Update range parameters
     * @param upperRange Target upper range in basis points
     * @param lowerRange Target lower range in basis points
     * @param upperThreshold Upper rebalance threshold in basis points
     * @param lowerThreshold Lower rebalance threshold in basis points
     */
    function setRangeParameters(
        uint16 upperRange,
        uint16 lowerRange,
        uint16 upperThreshold,
        uint16 lowerThreshold
    ) external {
        targetRangeUpper[msg.sender] = upperRange;
        targetRangeLower[msg.sender] = lowerRange;
        rebalanceThresholdUpper[msg.sender] = upperThreshold;
        rebalanceThresholdLower[msg.sender] = lowerThreshold;

        // Update customization bitmap
        uint256 bitmap = customizationBitmap[msg.sender];
        bitmap |= (1 << 0) | (1 << 1) | (1 << 2) | (1 << 3);
        customizationBitmap[msg.sender] = bitmap;

        emit ParameterUpdated(msg.sender, "rangeParameters");
        emit CustomizationUpdated(msg.sender, bitmap);
    }

    /**
     * @dev Update fee settings
     * @param reinvest Whether to automatically reinvest fees
     * @param trigger Minimum USD value for reinvestment (in wei)
     * @param ratio Percentage of fees to reinvest (in basis points)
     */
    function setFeeParameters(
        bool reinvest,
        uint256 trigger,
        uint16 ratio
    ) external {
        feeReinvestment[msg.sender] = reinvest;
        reinvestmentTrigger[msg.sender] = trigger;
        reinvestmentRatio[msg.sender] = ratio;

        // Update customization bitmap
        uint256 bitmap = customizationBitmap[msg.sender];
        bitmap |= (1 << 4) | (1 << 5) | (1 << 6);
        customizationBitmap[msg.sender] = bitmap;

        emit ParameterUpdated(msg.sender, "feeParameters");
        emit CustomizationUpdated(msg.sender, bitmap);
    }

    /**
     * @dev Update risk management parameters
     * @param slippage Maximum acceptable slippage in basis points
     * @param exitTrigger Price change that triggers emergency exit in basis points
     * @param utilization Maximum vault utilization in basis points
     */
    function setRiskParameters(
        uint16 slippage,
        uint16 exitTrigger,
        uint16 utilization
    ) external {
        maxSlippage[msg.sender] = slippage;
        emergencyExitTrigger[msg.sender] = exitTrigger;
        maxVaultUtilization[msg.sender] = utilization;

        // Update customization bitmap
        uint256 bitmap = customizationBitmap[msg.sender];
        bitmap |= (1 << 7) | (1 << 8) | (1 << 9);
        customizationBitmap[msg.sender] = bitmap;

        emit ParameterUpdated(msg.sender, "riskParameters");
        emit CustomizationUpdated(msg.sender, bitmap);
    }

    /**
     * @dev Update adaptive range settings
     * @param adaptive Whether to enable adaptive ranges
     * @param countHigh High rebalance count threshold
     * @param countLow Low rebalance count threshold
     * @param timeHigh High timeframe in days
     * @param timeLow Low timeframe in days
     * @param rangeHigh Range expansion percentage in basis points
     * @param thresholdHigh Threshold expansion percentage in basis points
     * @param rangeLow Range contraction percentage in basis points
     * @param thresholdLow Threshold contraction percentage in basis points
     */
    function setAdaptiveParameters(
        bool adaptive,
        uint8 countHigh,
        uint8 countLow,
        uint16 timeHigh,
        uint16 timeLow,
        uint16 rangeHigh,
        uint16 thresholdHigh,
        uint16 rangeLow,
        uint16 thresholdLow
    ) external {
        adaptiveRanges[msg.sender] = adaptive;
        rebalanceCountThresholdHigh[msg.sender] = countHigh;
        rebalanceCountThresholdLow[msg.sender] = countLow;
        adaptiveTimeframeHigh[msg.sender] = timeHigh;
        adaptiveTimeframeLow[msg.sender] = timeLow;
        rangeAdjustmentPercentHigh[msg.sender] = rangeHigh;
        thresholdAdjustmentPercentHigh[msg.sender] = thresholdHigh;
        rangeAdjustmentPercentLow[msg.sender] = rangeLow;
        thresholdAdjustmentPercentLow[msg.sender] = thresholdLow;

        // Update customization bitmap
        uint256 bitmap = customizationBitmap[msg.sender];
        bitmap |= (1 << 10) | (1 << 11) | (1 << 12) | (1 << 13) | (1 << 14) |
                 (1 << 15) | (1 << 16) | (1 << 17) | (1 << 18);
        customizationBitmap[msg.sender] = bitmap;

        emit ParameterUpdated(msg.sender, "adaptiveParameters");
        emit CustomizationUpdated(msg.sender, bitmap);
    }

    /**
     * @dev Update oracle settings
     * @param source Oracle data source
     * @param tolerance Maximum deviation tolerance in basis points
     */
    function setOracleParameters(
        OracleSource source,
        uint16 tolerance
    ) external {
        oracleSource[msg.sender] = source;
        priceDeviationTolerance[msg.sender] = tolerance;

        // Update customization bitmap
        uint256 bitmap = customizationBitmap[msg.sender];
        bitmap |= (1 << 19) | (1 << 20);
        customizationBitmap[msg.sender] = bitmap;

        emit ParameterUpdated(msg.sender, "oracleParameters");
        emit CustomizationUpdated(msg.sender, bitmap);
    }

    /**
     * @dev Update position sizing parameters
     * @param maxSize Maximum position size as percentage of vault in basis points
     * @param minSize Minimum position size in USD (wei)
     * @param utilization Target utilization percentage in basis points
     */
    function setPositionSizingParameters(
        uint16 maxSize,
        uint256 minSize,
        uint16 utilization
    ) external {
        maxPositionSizePercent[msg.sender] = maxSize;
        minPositionSize[msg.sender] = minSize;
        targetUtilization[msg.sender] = utilization;

        // Update customization bitmap
        uint256 bitmap = customizationBitmap[msg.sender];
        bitmap |= (1 << 21) | (1 << 22) | (1 << 23);
        customizationBitmap[msg.sender] = bitmap;

        emit ParameterUpdated(msg.sender, "positionSizingParameters");
        emit CustomizationUpdated(msg.sender, bitmap);
    }

    /**
     * @dev Update platform parameters
     * @param criteria Platform selection criteria
     * @param liquidity Minimum pool liquidity in USD (wei)
     */
    function setPlatformParameters(
        PlatformSelectionCriteria criteria,
        uint256 liquidity
    ) external {
        platformSelectionCriteria[msg.sender] = criteria;
        minPoolLiquidity[msg.sender] = liquidity;

        // Update customization bitmap
        uint256 bitmap = customizationBitmap[msg.sender];
        bitmap |= (1 << 24) | (1 << 25);
        customizationBitmap[msg.sender] = bitmap;

        emit ParameterUpdated(msg.sender, "platformParameters");
        emit CustomizationUpdated(msg.sender, bitmap);
    }

    /**
     * @dev Reset customizations to revert to template defaults
     */
    function resetToTemplate() external {
        // This effectively removes all customizations
        customizationBitmap[msg.sender] = 0;

        emit ParameterUpdated(msg.sender, "resetToTemplate");
        emit CustomizationUpdated(msg.sender, 0);
    }

    /**
     * @dev Reset all parameters and template selection
     * Effectively sets all parameters to default values
     */
    function resetAll() external {
        // Reset template selection
        selectedTemplate[msg.sender] = Template.None;

        // Reset customization bitmap
        customizationBitmap[msg.sender] = 0;

        emit TemplateSelected(msg.sender, Template.None);
        emit ParameterUpdated(msg.sender, "resetAll");
        emit CustomizationUpdated(msg.sender, 0);
    }

    // ==================== Admin Functions ====================

    /**
     * @dev Get the contract version
     * @return Version string
     */
    function getVersion() external pure returns (string memory) {
        return VERSION;
    }
}
