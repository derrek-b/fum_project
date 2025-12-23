// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./StrategyBase.sol";

/**
 * @title BabyStepsStrategy
 * @dev Contract that stores and manages parameters for the Baby Steps liquidity management strategy
 * A simplified strategy focused on the core essentials of liquidity management
 */
contract BabyStepsStrategy is StrategyBase {
    // Version information
    string public constant VERSION = "1.3.0";

    // ==================== Template Constants ====================
    uint8 public constant TEMPLATE_NONE = 0;
    uint8 public constant TEMPLATE_CONSERVATIVE = 1;
    uint8 public constant TEMPLATE_MODERATE = 2;
    uint8 public constant TEMPLATE_AGGRESSIVE = 3;
    uint8 public constant TEMPLATE_STABLECOIN = 4;

    // Conservative template values - WIDER ranges, fewer rebalances
    uint16 private constant CONS_TARGET_RANGE_UPPER = 1000;          // 10.00%
    uint16 private constant CONS_TARGET_RANGE_LOWER = 1000;          // 10.00%
    uint16 private constant CONS_REBALANCE_THRESHOLD_UPPER = 600;    // 6.00%
    uint16 private constant CONS_REBALANCE_THRESHOLD_LOWER = 600;    // 6.00%
    uint256 private constant CONS_REINVESTMENT_TRIGGER = 5000;       // $50.00 (in cents)
    uint16 private constant CONS_REINVESTMENT_RATIO = 3000;          // 30.00%
    uint16 private constant CONS_MAX_SLIPPAGE = 50;                  // 0.50%
    uint16 private constant CONS_EMERGENCY_EXIT_TRIGGER = 1000;      // 10.00%
    uint16 private constant CONS_MAX_UTILIZATION = 9000;             // 90.00%
    bool private constant CONS_FEE_REINVESTMENT = true;              // Fee reinvestment enabled

    // Moderate template values - MEDIUM ranges, moderate rebalances
    uint16 private constant MOD_TARGET_RANGE_UPPER = 500;            // 5.00%
    uint16 private constant MOD_TARGET_RANGE_LOWER = 500;            // 5.00%
    uint16 private constant MOD_REBALANCE_THRESHOLD_UPPER = 400;     // 4.00%
    uint16 private constant MOD_REBALANCE_THRESHOLD_LOWER = 400;     // 4.00%
    uint256 private constant MOD_REINVESTMENT_TRIGGER = 5000;        // $50.00 (in cents)
    uint16 private constant MOD_REINVESTMENT_RATIO = 5000;           // 50.00%
    uint16 private constant MOD_MAX_SLIPPAGE = 50;                   // 0.50%
    uint16 private constant MOD_EMERGENCY_EXIT_TRIGGER = 1000;       // 10.00%
    uint16 private constant MOD_MAX_UTILIZATION = 9000;              // 90.00%

    // Aggressive template values - TIGHTER ranges, frequent rebalances
    uint16 private constant AGG_TARGET_RANGE_UPPER = 300;            // 3.00%
    uint16 private constant AGG_TARGET_RANGE_LOWER = 300;            // 3.00%
    uint16 private constant AGG_REBALANCE_THRESHOLD_UPPER = 80;      // 0.80%
    uint16 private constant AGG_REBALANCE_THRESHOLD_LOWER = 80;      // 0.80%
    uint256 private constant AGG_REINVESTMENT_TRIGGER = 5000;        // $50.00 (in cents)
    uint16 private constant AGG_REINVESTMENT_RATIO = 9000;           // 90.00%
    uint16 private constant AGG_MAX_SLIPPAGE = 50;                   // 0.50%
    uint16 private constant AGG_EMERGENCY_EXIT_TRIGGER = 1000;       // 10.00%
    uint16 private constant AGG_MAX_UTILIZATION = 9000;              // 90.00%

    // Stablecoin template values - VERY TIGHT ranges for stablecoins
    uint16 private constant STBL_TARGET_RANGE_UPPER = 20;            // 0.20%
    uint16 private constant STBL_TARGET_RANGE_LOWER = 20;            // 0.20%
    uint16 private constant STBL_REBALANCE_THRESHOLD_UPPER = 1250;   // 12.50%
    uint16 private constant STBL_REBALANCE_THRESHOLD_LOWER = 1250;   // 12.50%
    uint256 private constant STBL_REINVESTMENT_TRIGGER = 1000;       // $10.00 (in cents)
    uint16 private constant STBL_REINVESTMENT_RATIO = 10000;         // 100.00%
    uint16 private constant STBL_MAX_SLIPPAGE = 20;                  // 0.20%
    uint16 private constant STBL_EMERGENCY_EXIT_TRIGGER = 100;       // 1.00%
    uint16 private constant STBL_MAX_UTILIZATION = 9000;             // 90.00%

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
    mapping(address => uint16) public maxUtilization;           // Basis points

    /**
     * @dev Constructor
     */
    constructor() Ownable(msg.sender) {}

    // ==================== Parameter Getters ====================

    /**
     * @dev Get target range upper value with template fallback
     * @param vault Address of the vault
     * @return Parameter value
     */
    function getTargetRangeUpper(address vault) public view returns (uint16) {
        // Check if parameter is customized
        if (_isCustomized(vault, 0)) {
            return targetRangeUpper[vault];
        }

        // Return template value
        uint8 template = selectedTemplate[vault];
        if (template == TEMPLATE_CONSERVATIVE) return CONS_TARGET_RANGE_UPPER;
        if (template == TEMPLATE_MODERATE) return MOD_TARGET_RANGE_UPPER;
        if (template == TEMPLATE_AGGRESSIVE) return AGG_TARGET_RANGE_UPPER;
        if (template == TEMPLATE_STABLECOIN) return STBL_TARGET_RANGE_UPPER;

        // Default value if no template or TEMPLATE_NONE
        return MOD_TARGET_RANGE_UPPER;
    }

    /**
     * @dev Get target range lower value with template fallback
     * @param vault Address of the vault
     * @return Parameter value
     */
    function getTargetRangeLower(address vault) public view returns (uint16) {
        // Check if parameter is customized
        if (_isCustomized(vault, 1)) {
            return targetRangeLower[vault];
        }

        // Return template value
        uint8 template = selectedTemplate[vault];
        if (template == TEMPLATE_CONSERVATIVE) return CONS_TARGET_RANGE_LOWER;
        if (template == TEMPLATE_MODERATE) return MOD_TARGET_RANGE_LOWER;
        if (template == TEMPLATE_AGGRESSIVE) return AGG_TARGET_RANGE_LOWER;
        if (template == TEMPLATE_STABLECOIN) return STBL_TARGET_RANGE_LOWER;

        // Default value if no template or TEMPLATE_NONE
        return MOD_TARGET_RANGE_LOWER;
    }

    /**
     * @dev Get rebalance threshold upper value with template fallback
     * @param vault Address of the vault
     * @return Parameter value
     */
    function getRebalanceThresholdUpper(address vault) public view returns (uint16) {
        // Check if parameter is customized
        if (_isCustomized(vault, 2)) {
            return rebalanceThresholdUpper[vault];
        }

        // Return template value
        uint8 template = selectedTemplate[vault];
        if (template == TEMPLATE_CONSERVATIVE) return CONS_REBALANCE_THRESHOLD_UPPER;
        if (template == TEMPLATE_MODERATE) return MOD_REBALANCE_THRESHOLD_UPPER;
        if (template == TEMPLATE_AGGRESSIVE) return AGG_REBALANCE_THRESHOLD_UPPER;
        if (template == TEMPLATE_STABLECOIN) return STBL_REBALANCE_THRESHOLD_UPPER;

        // Default value if no template or TEMPLATE_NONE
        return MOD_REBALANCE_THRESHOLD_UPPER;
    }

    /**
     * @dev Get rebalance threshold lower value with template fallback
     * @param vault Address of the vault
     * @return Parameter value
     */
    function getRebalanceThresholdLower(address vault) public view returns (uint16) {
        // Check if parameter is customized
        if (_isCustomized(vault, 3)) {
            return rebalanceThresholdLower[vault];
        }

        // Return template value
        uint8 template = selectedTemplate[vault];
        if (template == TEMPLATE_CONSERVATIVE) return CONS_REBALANCE_THRESHOLD_LOWER;
        if (template == TEMPLATE_MODERATE) return MOD_REBALANCE_THRESHOLD_LOWER;
        if (template == TEMPLATE_AGGRESSIVE) return AGG_REBALANCE_THRESHOLD_LOWER;
        if (template == TEMPLATE_STABLECOIN) return STBL_REBALANCE_THRESHOLD_LOWER;

        // Default value if no template or TEMPLATE_NONE
        return MOD_REBALANCE_THRESHOLD_LOWER;
    }

    /**
     * @dev Get fee reinvestment flag with template fallback
     * @param vault Address of the vault
     * @return Parameter value
     */
    function getFeeReinvestment(address vault) public view returns (bool) {
        // Check if parameter is customized
        if (_isCustomized(vault, 4)) {
            return feeReinvestment[vault];
        }

        // Return template value
        uint8 template = selectedTemplate[vault];
        if (template == TEMPLATE_CONSERVATIVE) return CONS_FEE_REINVESTMENT;
        if (template == TEMPLATE_MODERATE) return true;
        if (template == TEMPLATE_AGGRESSIVE) return true;
        if (template == TEMPLATE_STABLECOIN) return true;

        // Default value if no template or TEMPLATE_NONE
        return true;
    }

    /**
     * @dev Get reinvestment trigger value with template fallback
     * @param vault Address of the vault
     * @return Parameter value
     */
    function getReinvestmentTrigger(address vault) public view returns (uint256) {
        // Check if parameter is customized
        if (_isCustomized(vault, 5)) {
            return reinvestmentTrigger[vault];
        }

        // Return template value
        uint8 template = selectedTemplate[vault];
        if (template == TEMPLATE_CONSERVATIVE) return CONS_REINVESTMENT_TRIGGER;
        if (template == TEMPLATE_MODERATE) return MOD_REINVESTMENT_TRIGGER;
        if (template == TEMPLATE_AGGRESSIVE) return AGG_REINVESTMENT_TRIGGER;
        if (template == TEMPLATE_STABLECOIN) return STBL_REINVESTMENT_TRIGGER;

        // Default value if no template or TEMPLATE_NONE
        return MOD_REINVESTMENT_TRIGGER;
    }

    /**
     * @dev Get reinvestment ratio value with template fallback
     * @param vault Address of the vault
     * @return Parameter value
     */
    function getReinvestmentRatio(address vault) public view returns (uint16) {
        // Check if parameter is customized
        if (_isCustomized(vault, 6)) {
            return reinvestmentRatio[vault];
        }

        // Return template value
        uint8 template = selectedTemplate[vault];
        if (template == TEMPLATE_CONSERVATIVE) return CONS_REINVESTMENT_RATIO;
        if (template == TEMPLATE_MODERATE) return MOD_REINVESTMENT_RATIO;
        if (template == TEMPLATE_AGGRESSIVE) return AGG_REINVESTMENT_RATIO;
        if (template == TEMPLATE_STABLECOIN) return STBL_REINVESTMENT_RATIO;

        // Default value if no template or TEMPLATE_NONE
        return MOD_REINVESTMENT_RATIO;
    }

    /**
     * @dev Get max slippage value with template fallback
     * @param vault Address of the vault
     * @return Parameter value
     */
    function getMaxSlippage(address vault) public view returns (uint16) {
        // Check if parameter is customized
        if (_isCustomized(vault, 7)) {
            return maxSlippage[vault];
        }

        // Return template value
        uint8 template = selectedTemplate[vault];
        if (template == TEMPLATE_CONSERVATIVE) return CONS_MAX_SLIPPAGE;
        if (template == TEMPLATE_MODERATE) return MOD_MAX_SLIPPAGE;
        if (template == TEMPLATE_AGGRESSIVE) return AGG_MAX_SLIPPAGE;
        if (template == TEMPLATE_STABLECOIN) return STBL_MAX_SLIPPAGE;

        // Default value if no template or TEMPLATE_NONE
        return MOD_MAX_SLIPPAGE;
    }

    /**
     * @dev Get emergency exit trigger value with template fallback
     * @param vault Address of the vault
     * @return Parameter value
     */
    function getEmergencyExitTrigger(address vault) public view returns (uint16) {
        // Check if parameter is customized
        if (_isCustomized(vault, 8)) {
            return emergencyExitTrigger[vault];
        }

        // Return template value
        uint8 template = selectedTemplate[vault];
        if (template == TEMPLATE_CONSERVATIVE) return CONS_EMERGENCY_EXIT_TRIGGER;
        if (template == TEMPLATE_MODERATE) return MOD_EMERGENCY_EXIT_TRIGGER;
        if (template == TEMPLATE_AGGRESSIVE) return AGG_EMERGENCY_EXIT_TRIGGER;
        if (template == TEMPLATE_STABLECOIN) return STBL_EMERGENCY_EXIT_TRIGGER;

        // Default value if no template or TEMPLATE_NONE
        return MOD_EMERGENCY_EXIT_TRIGGER;
    }

    /**
     * @dev Get max utilization value with template fallback
     * @param vault Address of the vault
     * @return Parameter value
     */
    function getMaxUtilization(address vault) public view returns (uint16) {
        // Check if parameter is customized
        if (_isCustomized(vault, 9)) {
            return maxUtilization[vault];
        }

        // Return template value
        uint8 template = selectedTemplate[vault];
        if (template == TEMPLATE_CONSERVATIVE) return CONS_MAX_UTILIZATION;
        if (template == TEMPLATE_MODERATE) return MOD_MAX_UTILIZATION;
        if (template == TEMPLATE_AGGRESSIVE) return AGG_MAX_UTILIZATION;
        if (template == TEMPLATE_STABLECOIN) return STBL_MAX_UTILIZATION;

        // Default value if no template or TEMPLATE_NONE
        return MOD_MAX_UTILIZATION;
    }

    /**
     * @dev Get all parameters for a vault in a single call (with template fallbacks)
     * @param vault Address of the vault
     * @return ABI-encoded parameters
     */
    function getAllParameters(address vault) external view override returns (bytes memory) {
        return abi.encode(
            // Range Parameters
            getTargetRangeUpper(vault), getTargetRangeLower(vault),
            getRebalanceThresholdUpper(vault), getRebalanceThresholdLower(vault),

            // Fee Settings
            getFeeReinvestment(vault), getReinvestmentTrigger(vault), getReinvestmentRatio(vault),

            // Risk Management
            getMaxSlippage(vault), getEmergencyExitTrigger(vault), getMaxUtilization(vault)
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
    ) external onlyAuthorizedVault {
        targetRangeUpper[msg.sender] = upperRange;
        targetRangeLower[msg.sender] = lowerRange;
        rebalanceThresholdUpper[msg.sender] = upperThreshold;
        rebalanceThresholdLower[msg.sender] = lowerThreshold;

        // Update customization bitmap
        _markCustomized((1 << 0) | (1 << 1) | (1 << 2) | (1 << 3));

        emit ParameterUpdated(msg.sender, "rangeParameters");
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
    ) external onlyAuthorizedVault {
        feeReinvestment[msg.sender] = reinvest;
        reinvestmentTrigger[msg.sender] = trigger;
        reinvestmentRatio[msg.sender] = ratio;

        // Update customization bitmap
        _markCustomized((1 << 4) | (1 << 5) | (1 << 6));

        emit ParameterUpdated(msg.sender, "feeParameters");
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
    ) external onlyAuthorizedVault {
        maxSlippage[msg.sender] = slippage;
        emergencyExitTrigger[msg.sender] = exitTrigger;
        maxUtilization[msg.sender] = utilization;

        // Update customization bitmap
        _markCustomized((1 << 7) | (1 << 8) | (1 << 9));

        emit ParameterUpdated(msg.sender, "riskParameters");
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
