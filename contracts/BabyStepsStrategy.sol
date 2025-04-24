// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title BabyStepsStrategy
 * @dev Contract that stores and manages parameters for the Baby Steps liquidity management strategy
 * A simplified strategy focused on the core essentials of liquidity management
 */
contract BabyStepsStrategy is Ownable {
    // Version information
    string public constant VERSION = "1.0.0";

    // ==================== Events ====================
    event ParameterUpdated(address indexed vault, string paramName);
    event TemplateSelected(address indexed vault, Template template);
    event CustomizationUpdated(address indexed vault, uint256 bitmap);
    event VaultAuthorized(address indexed vault, bool authorized);

    // ==================== Authorization ====================
    // Mapping to track vaults that can modify their own parameters
    mapping(address => bool) public authorizedVaults;

    // Modifier to ensure caller is an authorized vault
    modifier onlyAuthorizedVault() {
        require(authorizedVaults[msg.sender], "BabyStepsStrategy: caller is not an authorized vault");
        _;
    }

    // Functions to manage vault authorization
    function authorizeVault(address vault) external onlyOwner {
        require(vault != address(0), "BabyStepsStrategy: zero vault address");
        authorizedVaults[vault] = true;
        emit VaultAuthorized(vault, true);
    }

    function deauthorizeVault(address vault) external onlyOwner {
        authorizedVaults[vault] = false;
        emit VaultAuthorized(vault, false);
    }

    // ==================== Enums ====================
    // Templates
    enum Template { None, Conservative, Moderate, Aggressive, Stablecoin }

    // ==================== Template Constants ====================
    // Conservative template values - WIDER ranges, fewer rebalances
    uint16 private constant CONS_TARGET_RANGE_UPPER = 1000;          // 10.00%
    uint16 private constant CONS_TARGET_RANGE_LOWER = 1000;          // 10.00%
    uint16 private constant CONS_REBALANCE_THRESHOLD_UPPER = 300;    // 3.00%
    uint16 private constant CONS_REBALANCE_THRESHOLD_LOWER = 300;    // 3.00%
    uint16 private constant CONS_MAX_SLIPPAGE = 30;                  // 0.30%
    uint16 private constant CONS_EMERGENCY_EXIT_TRIGGER = 2000;      // 20.00%
    uint16 private constant CONS_MAX_UTILIZATION = 6000;             // 60.00%
    bool private constant CONS_FEE_REINVESTMENT = false;             // No fee reinvestment

    // Moderate template values - MEDIUM ranges, moderate rebalances
    uint16 private constant MOD_TARGET_RANGE_UPPER = 500;            // 5.00%
    uint16 private constant MOD_TARGET_RANGE_LOWER = 500;            // 5.00%
    uint16 private constant MOD_REBALANCE_THRESHOLD_UPPER = 150;     // 1.50%
    uint16 private constant MOD_REBALANCE_THRESHOLD_LOWER = 150;     // 1.50%
    uint256 private constant MOD_REINVESTMENT_TRIGGER = 50 ether;    // $50
    uint16 private constant MOD_REINVESTMENT_RATIO = 8000;           // 80.00%
    uint16 private constant MOD_MAX_SLIPPAGE = 50;                   // 0.50%
    uint16 private constant MOD_EMERGENCY_EXIT_TRIGGER = 1500;       // 15.00%
    uint16 private constant MOD_MAX_UTILIZATION = 8000;              // 80.00%

    // Aggressive template values - TIGHTER ranges, frequent rebalances
    uint16 private constant AGG_TARGET_RANGE_UPPER = 300;            // 3.00%
    uint16 private constant AGG_TARGET_RANGE_LOWER = 300;            // 3.00%
    uint16 private constant AGG_REBALANCE_THRESHOLD_UPPER = 80;      // 0.80%
    uint16 private constant AGG_REBALANCE_THRESHOLD_LOWER = 80;      // 0.80%
    uint256 private constant AGG_REINVESTMENT_TRIGGER = 25 ether;    // $25
    uint16 private constant AGG_REINVESTMENT_RATIO = 10000;          // 100.00%
    uint16 private constant AGG_MAX_SLIPPAGE = 100;                  // 1.00%
    uint16 private constant AGG_EMERGENCY_EXIT_TRIGGER = 1000;       // 10.00%
    uint16 private constant AGG_MAX_UTILIZATION = 9500;              // 95.00%

    // Stablecoin template values - VERY TIGHT ranges for stablecoins
    uint16 private constant STBL_TARGET_RANGE_UPPER = 50;            // 0.50%
    uint16 private constant STBL_TARGET_RANGE_LOWER = 50;            // 0.50%
    uint16 private constant STBL_REBALANCE_THRESHOLD_UPPER = 20;     // 0.20%
    uint16 private constant STBL_REBALANCE_THRESHOLD_LOWER = 20;     // 0.20%
    uint256 private constant STBL_REINVESTMENT_TRIGGER = 10 ether;   // $10
    uint16 private constant STBL_REINVESTMENT_RATIO = 10000;         // 100.00%
    uint16 private constant STBL_MAX_SLIPPAGE = 10;                  // 0.10%
    uint16 private constant STBL_EMERGENCY_EXIT_TRIGGER = 200;       // 2.00%
    uint16 private constant STBL_MAX_UTILIZATION = 9000;             // 90.00%

    // ==================== Customization Bitmap ====================
    // Bitmap tracks which parameters have been customized (1 = customized, 0 = use template)
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
    mapping(address => uint16) public maxUtilization;           // Basis points

    /**
     * @dev Constructor
     */
    constructor() Ownable(msg.sender) {}

    // ==================== Template Selection ====================

    /**
     * @dev Select a template
     * @param template Template to select
     */
    function selectTemplate(Template template) external onlyAuthorizedVault {
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
        if (template == Template.Stablecoin) return STBL_TARGET_RANGE_UPPER;

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
        if (template == Template.Stablecoin) return STBL_TARGET_RANGE_LOWER;

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
        if (template == Template.Stablecoin) return STBL_REBALANCE_THRESHOLD_UPPER;

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
        if (template == Template.Stablecoin) return STBL_REBALANCE_THRESHOLD_LOWER;

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
        if (template == Template.Conservative) return CONS_FEE_REINVESTMENT;
        if (template == Template.Moderate) return true;
        if (template == Template.Aggressive) return true;
        if (template == Template.Stablecoin) return true;

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
        if (template == Template.Stablecoin) return STBL_REINVESTMENT_TRIGGER;

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
        if (template == Template.Stablecoin) return STBL_REINVESTMENT_RATIO;

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
        if (template == Template.Stablecoin) return STBL_MAX_SLIPPAGE;

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
        if (template == Template.Stablecoin) return STBL_EMERGENCY_EXIT_TRIGGER;

        // Default value if no template or Template.None
        return MOD_EMERGENCY_EXIT_TRIGGER;
    }

    /**
     * @dev Get max utilization value with template fallback
     * @param vault Address of the vault
     * @return Parameter value
     */
    function getMaxUtilization(address vault) public view returns (uint16) {
        // Check if parameter is customized
        if ((customizationBitmap[vault] & (1 << 9)) != 0) {
            return maxUtilization[vault];
        }

        // Return template value
        Template template = selectedTemplate[vault];
        if (template == Template.Conservative) return CONS_MAX_UTILIZATION;
        if (template == Template.Moderate) return MOD_MAX_UTILIZATION;
        if (template == Template.Aggressive) return AGG_MAX_UTILIZATION;
        if (template == Template.Stablecoin) return STBL_MAX_UTILIZATION;

        // Default value if no template or Template.None
        return MOD_MAX_UTILIZATION;
    }

    /**
     * @dev Get all parameters for a vault in a single call (with template fallbacks)
     * @param vault Address of the vault
     * @return All strategy parameters packaged in a tuple
     */
    function getAllParameters(address vault) external view returns (
        uint16, uint16, uint16, uint16,
        bool, uint256, uint16,
        uint16, uint16, uint16
    ) {
        return (
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
    ) external onlyAuthorizedVault {
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
    ) external onlyAuthorizedVault {
        maxSlippage[msg.sender] = slippage;
        emergencyExitTrigger[msg.sender] = exitTrigger;
        maxUtilization[msg.sender] = utilization;

        // Update customization bitmap
        uint256 bitmap = customizationBitmap[msg.sender];
        bitmap |= (1 << 7) | (1 << 8) | (1 << 9);
        customizationBitmap[msg.sender] = bitmap;

        emit ParameterUpdated(msg.sender, "riskParameters");
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
