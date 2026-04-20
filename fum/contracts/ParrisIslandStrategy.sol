// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./StrategyBase.sol";

/**
 * @title ParrisIslandStrategy
 * @dev Contract that stores and manages parameters for the Parris Island liquidity management strategy
 * Uses templates as source of truth with efficient parameter customization
 */
contract ParrisIslandStrategy is StrategyBase {
    // Version information
    string public constant VERSION = "0.4.0";

    // ==================== Template Constants ====================
    uint8 public constant TEMPLATE_NONE = 0;
    uint8 public constant TEMPLATE_CONSERVATIVE = 1;
    uint8 public constant TEMPLATE_MODERATE = 2;
    uint8 public constant TEMPLATE_AGGRESSIVE = 3;

    // ==================== Enums ====================
    // Oracle sources
    enum OracleSource { DEX, Chainlink, TWAP }

    // Platform selection criteria
    enum PlatformSelectionCriteria { HighestTVL, HighestVolume, LowestFees, HighestRewards }

    // ==================== Template Values ====================
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

    // ==================== Parameter Getters ====================

    /**
     * @dev Get target range upper value with template fallback
     * @param vault Address of the vault
     * @return Parameter value
     */
    function getTargetRangeUpper(address vault) public view returns (uint16) {
        if (_isCustomized(vault, 0)) {
            return targetRangeUpper[vault];
        }

        uint8 template = selectedTemplate[vault];
        if (template == TEMPLATE_CONSERVATIVE) return CONS_TARGET_RANGE_UPPER;
        if (template == TEMPLATE_MODERATE) return MOD_TARGET_RANGE_UPPER;
        if (template == TEMPLATE_AGGRESSIVE) return AGG_TARGET_RANGE_UPPER;

        return MOD_TARGET_RANGE_UPPER;
    }

    /**
     * @dev Get target range lower value with template fallback
     * @param vault Address of the vault
     * @return Parameter value
     */
    function getTargetRangeLower(address vault) public view returns (uint16) {
        if (_isCustomized(vault, 1)) {
            return targetRangeLower[vault];
        }

        uint8 template = selectedTemplate[vault];
        if (template == TEMPLATE_CONSERVATIVE) return CONS_TARGET_RANGE_LOWER;
        if (template == TEMPLATE_MODERATE) return MOD_TARGET_RANGE_LOWER;
        if (template == TEMPLATE_AGGRESSIVE) return AGG_TARGET_RANGE_LOWER;

        return MOD_TARGET_RANGE_LOWER;
    }

    /**
     * @dev Get rebalance threshold upper value with template fallback
     * @param vault Address of the vault
     * @return Parameter value
     */
    function getRebalanceThresholdUpper(address vault) public view returns (uint16) {
        if (_isCustomized(vault, 2)) {
            return rebalanceThresholdUpper[vault];
        }

        uint8 template = selectedTemplate[vault];
        if (template == TEMPLATE_CONSERVATIVE) return CONS_REBALANCE_THRESHOLD_UPPER;
        if (template == TEMPLATE_MODERATE) return MOD_REBALANCE_THRESHOLD_UPPER;
        if (template == TEMPLATE_AGGRESSIVE) return AGG_REBALANCE_THRESHOLD_UPPER;

        return MOD_REBALANCE_THRESHOLD_UPPER;
    }

    /**
     * @dev Get rebalance threshold lower value with template fallback
     * @param vault Address of the vault
     * @return Parameter value
     */
    function getRebalanceThresholdLower(address vault) public view returns (uint16) {
        if (_isCustomized(vault, 3)) {
            return rebalanceThresholdLower[vault];
        }

        uint8 template = selectedTemplate[vault];
        if (template == TEMPLATE_CONSERVATIVE) return CONS_REBALANCE_THRESHOLD_LOWER;
        if (template == TEMPLATE_MODERATE) return MOD_REBALANCE_THRESHOLD_LOWER;
        if (template == TEMPLATE_AGGRESSIVE) return AGG_REBALANCE_THRESHOLD_LOWER;

        return MOD_REBALANCE_THRESHOLD_LOWER;
    }

    /**
     * @dev Get fee reinvestment flag with template fallback
     * @param vault Address of the vault
     * @return Parameter value
     */
    function getFeeReinvestment(address vault) public view returns (bool) {
        if (_isCustomized(vault, 4)) {
            return feeReinvestment[vault];
        }

        uint8 template = selectedTemplate[vault];
        if (template == TEMPLATE_CONSERVATIVE) return false;
        if (template == TEMPLATE_MODERATE) return true;
        if (template == TEMPLATE_AGGRESSIVE) return true;

        return true;
    }

    /**
     * @dev Get reinvestment trigger value with template fallback
     * @param vault Address of the vault
     * @return Parameter value
     */
    function getReinvestmentTrigger(address vault) public view returns (uint256) {
        if (_isCustomized(vault, 5)) {
            return reinvestmentTrigger[vault];
        }

        uint8 template = selectedTemplate[vault];
        if (template == TEMPLATE_CONSERVATIVE) return 0;
        if (template == TEMPLATE_MODERATE) return MOD_REINVESTMENT_TRIGGER;
        if (template == TEMPLATE_AGGRESSIVE) return AGG_REINVESTMENT_TRIGGER;

        return MOD_REINVESTMENT_TRIGGER;
    }

    /**
     * @dev Get reinvestment ratio value with template fallback
     * @param vault Address of the vault
     * @return Parameter value
     */
    function getReinvestmentRatio(address vault) public view returns (uint16) {
        if (_isCustomized(vault, 6)) {
            return reinvestmentRatio[vault];
        }

        uint8 template = selectedTemplate[vault];
        if (template == TEMPLATE_CONSERVATIVE) return 0;
        if (template == TEMPLATE_MODERATE) return MOD_REINVESTMENT_RATIO;
        if (template == TEMPLATE_AGGRESSIVE) return AGG_REINVESTMENT_RATIO;

        return MOD_REINVESTMENT_RATIO;
    }

    /**
     * @dev Get max slippage value with template fallback
     * @param vault Address of the vault
     * @return Parameter value
     */
    function getMaxSlippage(address vault) public view returns (uint16) {
        if (_isCustomized(vault, 7)) {
            return maxSlippage[vault];
        }

        uint8 template = selectedTemplate[vault];
        if (template == TEMPLATE_CONSERVATIVE) return CONS_MAX_SLIPPAGE;
        if (template == TEMPLATE_MODERATE) return MOD_MAX_SLIPPAGE;
        if (template == TEMPLATE_AGGRESSIVE) return AGG_MAX_SLIPPAGE;

        return MOD_MAX_SLIPPAGE;
    }

    /**
     * @dev Get emergency exit trigger value with template fallback
     * @param vault Address of the vault
     * @return Parameter value
     */
    function getEmergencyExitTrigger(address vault) public view returns (uint16) {
        if (_isCustomized(vault, 8)) {
            return emergencyExitTrigger[vault];
        }

        uint8 template = selectedTemplate[vault];
        if (template == TEMPLATE_CONSERVATIVE) return CONS_EMERGENCY_EXIT_TRIGGER;
        if (template == TEMPLATE_MODERATE) return MOD_EMERGENCY_EXIT_TRIGGER;
        if (template == TEMPLATE_AGGRESSIVE) return AGG_EMERGENCY_EXIT_TRIGGER;

        return MOD_EMERGENCY_EXIT_TRIGGER;
    }

    /**
     * @dev Get max vault utilization value with template fallback
     * @param vault Address of the vault
     * @return Parameter value
     */
    function getMaxVaultUtilization(address vault) public view returns (uint16) {
        if (_isCustomized(vault, 9)) {
            return maxVaultUtilization[vault];
        }

        uint8 template = selectedTemplate[vault];
        if (template == TEMPLATE_CONSERVATIVE) return CONS_MAX_VAULT_UTILIZATION;
        if (template == TEMPLATE_MODERATE) return MOD_MAX_VAULT_UTILIZATION;
        if (template == TEMPLATE_AGGRESSIVE) return AGG_MAX_VAULT_UTILIZATION;

        return MOD_MAX_VAULT_UTILIZATION;
    }

    /**
     * @dev Get adaptive ranges flag with template fallback
     * @param vault Address of the vault
     * @return Parameter value
     */
    function getAdaptiveRanges(address vault) public view returns (bool) {
        if (_isCustomized(vault, 10)) {
            return adaptiveRanges[vault];
        }

        uint8 template = selectedTemplate[vault];
        if (template == TEMPLATE_CONSERVATIVE) return false;
        if (template == TEMPLATE_MODERATE) return true;
        if (template == TEMPLATE_AGGRESSIVE) return true;

        return true;
    }

    /**
     * @dev Get rebalance count threshold high value with template fallback
     * @param vault Address of the vault
     * @return Parameter value
     */
    function getRebalanceCountThresholdHigh(address vault) public view returns (uint8) {
        if (_isCustomized(vault, 11)) {
            return rebalanceCountThresholdHigh[vault];
        }

        uint8 template = selectedTemplate[vault];
        if (template == TEMPLATE_CONSERVATIVE) return 0;
        if (template == TEMPLATE_MODERATE) return MOD_REBALANCE_COUNT_THRESHOLD_HIGH;
        if (template == TEMPLATE_AGGRESSIVE) return AGG_REBALANCE_COUNT_THRESHOLD_HIGH;

        return MOD_REBALANCE_COUNT_THRESHOLD_HIGH;
    }

    /**
     * @dev Get rebalance count threshold low value with template fallback
     * @param vault Address of the vault
     * @return Parameter value
     */
    function getRebalanceCountThresholdLow(address vault) public view returns (uint8) {
        if (_isCustomized(vault, 12)) {
            return rebalanceCountThresholdLow[vault];
        }

        uint8 template = selectedTemplate[vault];
        if (template == TEMPLATE_CONSERVATIVE) return 0;
        if (template == TEMPLATE_MODERATE) return MOD_REBALANCE_COUNT_THRESHOLD_LOW;
        if (template == TEMPLATE_AGGRESSIVE) return AGG_REBALANCE_COUNT_THRESHOLD_LOW;

        return MOD_REBALANCE_COUNT_THRESHOLD_LOW;
    }

    /**
     * @dev Get adaptive timeframe high value with template fallback
     * @param vault Address of the vault
     * @return Parameter value
     */
    function getAdaptiveTimeframeHigh(address vault) public view returns (uint16) {
        if (_isCustomized(vault, 13)) {
            return adaptiveTimeframeHigh[vault];
        }

        uint8 template = selectedTemplate[vault];
        if (template == TEMPLATE_CONSERVATIVE) return 0;
        if (template == TEMPLATE_MODERATE) return MOD_ADAPTIVE_TIMEFRAME_HIGH;
        if (template == TEMPLATE_AGGRESSIVE) return AGG_ADAPTIVE_TIMEFRAME_HIGH;

        return MOD_ADAPTIVE_TIMEFRAME_HIGH;
    }

    /**
     * @dev Get adaptive timeframe low value with template fallback
     * @param vault Address of the vault
     * @return Parameter value
     */
    function getAdaptiveTimeframeLow(address vault) public view returns (uint16) {
        if (_isCustomized(vault, 14)) {
            return adaptiveTimeframeLow[vault];
        }

        uint8 template = selectedTemplate[vault];
        if (template == TEMPLATE_CONSERVATIVE) return 0;
        if (template == TEMPLATE_MODERATE) return MOD_ADAPTIVE_TIMEFRAME_LOW;
        if (template == TEMPLATE_AGGRESSIVE) return AGG_ADAPTIVE_TIMEFRAME_LOW;

        return MOD_ADAPTIVE_TIMEFRAME_LOW;
    }

    /**
     * @dev Get range adjustment percent high value with template fallback
     * @param vault Address of the vault
     * @return Parameter value
     */
    function getRangeAdjustmentPercentHigh(address vault) public view returns (uint16) {
        if (_isCustomized(vault, 15)) {
            return rangeAdjustmentPercentHigh[vault];
        }

        uint8 template = selectedTemplate[vault];
        if (template == TEMPLATE_CONSERVATIVE) return 0;
        if (template == TEMPLATE_MODERATE) return MOD_RANGE_ADJUSTMENT_PERCENT_HIGH;
        if (template == TEMPLATE_AGGRESSIVE) return AGG_RANGE_ADJUSTMENT_PERCENT_HIGH;

        return MOD_RANGE_ADJUSTMENT_PERCENT_HIGH;
    }

    /**
     * @dev Get threshold adjustment percent high value with template fallback
     * @param vault Address of the vault
     * @return Parameter value
     */
    function getThresholdAdjustmentPercentHigh(address vault) public view returns (uint16) {
        if (_isCustomized(vault, 16)) {
            return thresholdAdjustmentPercentHigh[vault];
        }

        uint8 template = selectedTemplate[vault];
        if (template == TEMPLATE_CONSERVATIVE) return 0;
        if (template == TEMPLATE_MODERATE) return MOD_THRESHOLD_ADJUSTMENT_PERCENT_HIGH;
        if (template == TEMPLATE_AGGRESSIVE) return AGG_THRESHOLD_ADJUSTMENT_PERCENT_HIGH;

        return MOD_THRESHOLD_ADJUSTMENT_PERCENT_HIGH;
    }

    /**
     * @dev Get range adjustment percent low value with template fallback
     * @param vault Address of the vault
     * @return Parameter value
     */
    function getRangeAdjustmentPercentLow(address vault) public view returns (uint16) {
        if (_isCustomized(vault, 17)) {
            return rangeAdjustmentPercentLow[vault];
        }

        uint8 template = selectedTemplate[vault];
        if (template == TEMPLATE_CONSERVATIVE) return 0;
        if (template == TEMPLATE_MODERATE) return MOD_RANGE_ADJUSTMENT_PERCENT_LOW;
        if (template == TEMPLATE_AGGRESSIVE) return AGG_RANGE_ADJUSTMENT_PERCENT_LOW;

        return MOD_RANGE_ADJUSTMENT_PERCENT_LOW;
    }

    /**
     * @dev Get threshold adjustment percent low value with template fallback
     * @param vault Address of the vault
     * @return Parameter value
     */
    function getThresholdAdjustmentPercentLow(address vault) public view returns (uint16) {
        if (_isCustomized(vault, 18)) {
            return thresholdAdjustmentPercentLow[vault];
        }

        uint8 template = selectedTemplate[vault];
        if (template == TEMPLATE_CONSERVATIVE) return 0;
        if (template == TEMPLATE_MODERATE) return MOD_THRESHOLD_ADJUSTMENT_PERCENT_LOW;
        if (template == TEMPLATE_AGGRESSIVE) return AGG_THRESHOLD_ADJUSTMENT_PERCENT_LOW;

        return MOD_THRESHOLD_ADJUSTMENT_PERCENT_LOW;
    }

    /**
     * @dev Get oracle source value with template fallback
     * @param vault Address of the vault
     * @return Parameter value
     */
    function getOracleSource(address vault) public view returns (OracleSource) {
        if (_isCustomized(vault, 19)) {
            return oracleSource[vault];
        }

        uint8 template = selectedTemplate[vault];
        if (template == TEMPLATE_CONSERVATIVE) return OracleSource.Chainlink;
        if (template == TEMPLATE_MODERATE) return OracleSource.DEX;
        if (template == TEMPLATE_AGGRESSIVE) return OracleSource.TWAP;

        return OracleSource.DEX;
    }

    /**
     * @dev Get price deviation tolerance value with template fallback
     * @param vault Address of the vault
     * @return Parameter value
     */
    function getPriceDeviationTolerance(address vault) public view returns (uint16) {
        if (_isCustomized(vault, 20)) {
            return priceDeviationTolerance[vault];
        }

        uint8 template = selectedTemplate[vault];
        if (template == TEMPLATE_CONSERVATIVE) return CONS_PRICE_DEVIATION_TOLERANCE;
        if (template == TEMPLATE_MODERATE) return MOD_PRICE_DEVIATION_TOLERANCE;
        if (template == TEMPLATE_AGGRESSIVE) return AGG_PRICE_DEVIATION_TOLERANCE;

        return MOD_PRICE_DEVIATION_TOLERANCE;
    }

    /**
     * @dev Get max position size percent value with template fallback
     * @param vault Address of the vault
     * @return Parameter value
     */
    function getMaxPositionSizePercent(address vault) public view returns (uint16) {
        if (_isCustomized(vault, 21)) {
            return maxPositionSizePercent[vault];
        }

        uint8 template = selectedTemplate[vault];
        if (template == TEMPLATE_CONSERVATIVE) return CONS_MAX_POSITION_SIZE_PERCENT;
        if (template == TEMPLATE_MODERATE) return MOD_MAX_POSITION_SIZE_PERCENT;
        if (template == TEMPLATE_AGGRESSIVE) return AGG_MAX_POSITION_SIZE_PERCENT;

        return MOD_MAX_POSITION_SIZE_PERCENT;
    }

    /**
     * @dev Get min position size value with template fallback
     * @param vault Address of the vault
     * @return Parameter value
     */
    function getMinPositionSize(address vault) public view returns (uint256) {
        if (_isCustomized(vault, 22)) {
            return minPositionSize[vault];
        }

        uint8 template = selectedTemplate[vault];
        if (template == TEMPLATE_CONSERVATIVE) return CONS_MIN_POSITION_SIZE;
        if (template == TEMPLATE_MODERATE) return MOD_MIN_POSITION_SIZE;
        if (template == TEMPLATE_AGGRESSIVE) return AGG_MIN_POSITION_SIZE;

        return MOD_MIN_POSITION_SIZE;
    }

    /**
     * @dev Get target utilization value with template fallback
     * @param vault Address of the vault
     * @return Parameter value
     */
    function getTargetUtilization(address vault) public view returns (uint16) {
        if (_isCustomized(vault, 23)) {
            return targetUtilization[vault];
        }

        uint8 template = selectedTemplate[vault];
        if (template == TEMPLATE_CONSERVATIVE) return CONS_TARGET_UTILIZATION;
        if (template == TEMPLATE_MODERATE) return MOD_TARGET_UTILIZATION;
        if (template == TEMPLATE_AGGRESSIVE) return AGG_TARGET_UTILIZATION;

        return MOD_TARGET_UTILIZATION;
    }

    /**
     * @dev Get platform selection criteria value with template fallback
     * @param vault Address of the vault
     * @return Parameter value
     */
    function getPlatformSelectionCriteria(address vault) public view returns (PlatformSelectionCriteria) {
        if (_isCustomized(vault, 24)) {
            return platformSelectionCriteria[vault];
        }

        uint8 template = selectedTemplate[vault];
        if (template == TEMPLATE_CONSERVATIVE) return PlatformSelectionCriteria.HighestTVL;
        if (template == TEMPLATE_MODERATE) return PlatformSelectionCriteria.HighestVolume;
        if (template == TEMPLATE_AGGRESSIVE) return PlatformSelectionCriteria.HighestRewards;

        return PlatformSelectionCriteria.HighestVolume;
    }

    /**
     * @dev Get min pool liquidity value with template fallback
     * @param vault Address of the vault
     * @return Parameter value
     */
    function getMinPoolLiquidity(address vault) public view returns (uint256) {
        if (_isCustomized(vault, 25)) {
            return minPoolLiquidity[vault];
        }

        uint8 template = selectedTemplate[vault];
        if (template == TEMPLATE_CONSERVATIVE) return CONS_MIN_POOL_LIQUIDITY;
        if (template == TEMPLATE_MODERATE) return MOD_MIN_POOL_LIQUIDITY;
        if (template == TEMPLATE_AGGRESSIVE) return AGG_MIN_POOL_LIQUIDITY;

        return MOD_MIN_POOL_LIQUIDITY;
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
    ) external onlyAuthorizedVault {
        targetRangeUpper[msg.sender] = upperRange;
        targetRangeLower[msg.sender] = lowerRange;
        rebalanceThresholdUpper[msg.sender] = upperThreshold;
        rebalanceThresholdLower[msg.sender] = lowerThreshold;

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
        maxVaultUtilization[msg.sender] = utilization;

        _markCustomized((1 << 7) | (1 << 8) | (1 << 9));

        emit ParameterUpdated(msg.sender, "riskParameters");
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
    ) external onlyAuthorizedVault {
        adaptiveRanges[msg.sender] = adaptive;
        rebalanceCountThresholdHigh[msg.sender] = countHigh;
        rebalanceCountThresholdLow[msg.sender] = countLow;
        adaptiveTimeframeHigh[msg.sender] = timeHigh;
        adaptiveTimeframeLow[msg.sender] = timeLow;
        rangeAdjustmentPercentHigh[msg.sender] = rangeHigh;
        thresholdAdjustmentPercentHigh[msg.sender] = thresholdHigh;
        rangeAdjustmentPercentLow[msg.sender] = rangeLow;
        thresholdAdjustmentPercentLow[msg.sender] = thresholdLow;

        _markCustomized((1 << 10) | (1 << 11) | (1 << 12) | (1 << 13) | (1 << 14) |
                 (1 << 15) | (1 << 16) | (1 << 17) | (1 << 18));

        emit ParameterUpdated(msg.sender, "adaptiveParameters");
    }

    /**
     * @dev Update oracle settings
     * @param source Oracle data source
     * @param tolerance Maximum deviation tolerance in basis points
     */
    function setOracleParameters(
        OracleSource source,
        uint16 tolerance
    ) external onlyAuthorizedVault {
        oracleSource[msg.sender] = source;
        priceDeviationTolerance[msg.sender] = tolerance;

        _markCustomized((1 << 19) | (1 << 20));

        emit ParameterUpdated(msg.sender, "oracleParameters");
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
    ) external onlyAuthorizedVault {
        maxPositionSizePercent[msg.sender] = maxSize;
        minPositionSize[msg.sender] = minSize;
        targetUtilization[msg.sender] = utilization;

        _markCustomized((1 << 21) | (1 << 22) | (1 << 23));

        emit ParameterUpdated(msg.sender, "positionSizingParameters");
    }

    /**
     * @dev Update platform parameters
     * @param criteria Platform selection criteria
     * @param liquidity Minimum pool liquidity in USD (wei)
     */
    function setPlatformParameters(
        PlatformSelectionCriteria criteria,
        uint256 liquidity
    ) external onlyAuthorizedVault {
        platformSelectionCriteria[msg.sender] = criteria;
        minPoolLiquidity[msg.sender] = liquidity;

        _markCustomized((1 << 24) | (1 << 25));

        emit ParameterUpdated(msg.sender, "platformParameters");
    }

}
