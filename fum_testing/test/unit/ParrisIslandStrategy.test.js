const { expect } = require("chai");
const { ethers } = require('hardhat');

/**
 * Tests for ParrisIslandStrategy-specific functionality
 * Base functionality (authorization, template selection, reset) is tested in StrategyBase.test.js
 */
describe("ParrisIslandStrategy", function () {
  let strategy;
  let strategyAddress;
  let factory;
  let owner;
  let user1;
  let vault1Contract;
  let vault1Address;

  // ==================== Template Constants ====================
  // Template IDs
  const TEMPLATE_NONE = 0;
  const TEMPLATE_CONSERVATIVE = 1;
  const TEMPLATE_MODERATE = 2;
  const TEMPLATE_AGGRESSIVE = 3;

  // Enum values
  const OracleSource = {
    DEX: 0,
    Chainlink: 1,
    TWAP: 2
  };

  const PlatformSelectionCriteria = {
    HighestTVL: 0,
    HighestVolume: 1,
    LowestFees: 2,
    HighestRewards: 3
  };

  // Conservative template values
  const CONS_TARGET_RANGE_UPPER = 300;
  const CONS_TARGET_RANGE_LOWER = 300;
  const CONS_REBALANCE_THRESHOLD_UPPER = 150;
  const CONS_REBALANCE_THRESHOLD_LOWER = 150;
  const CONS_MAX_SLIPPAGE = 30;
  const CONS_EMERGENCY_EXIT_TRIGGER = 2000;
  const CONS_MAX_VAULT_UTILIZATION = 6000;
  const CONS_MAX_POSITION_SIZE_PERCENT = 2000;
  const CONS_MIN_POSITION_SIZE = ethers.parseEther("200");
  const CONS_TARGET_UTILIZATION = 1500;
  const CONS_PRICE_DEVIATION_TOLERANCE = 50;
  const CONS_MIN_POOL_LIQUIDITY = ethers.parseEther("200000");
  const CONS_FEE_REINVESTMENT = false;
  const CONS_ORACLE_SOURCE = OracleSource.Chainlink;
  const CONS_PLATFORM_CRITERIA = PlatformSelectionCriteria.HighestTVL;

  // Moderate template values
  const MOD_TARGET_RANGE_UPPER = 500;
  const MOD_TARGET_RANGE_LOWER = 500;
  const MOD_REBALANCE_THRESHOLD_UPPER = 100;
  const MOD_REBALANCE_THRESHOLD_LOWER = 100;
  const MOD_REINVESTMENT_TRIGGER = ethers.parseEther("50");
  const MOD_REINVESTMENT_RATIO = 8000;
  const MOD_MAX_SLIPPAGE = 50;
  const MOD_EMERGENCY_EXIT_TRIGGER = 1500;
  const MOD_MAX_VAULT_UTILIZATION = 8000;
  const MOD_REBALANCE_COUNT_THRESHOLD_HIGH = 3;
  const MOD_REBALANCE_COUNT_THRESHOLD_LOW = 1;
  const MOD_ADAPTIVE_TIMEFRAME_HIGH = 7;
  const MOD_ADAPTIVE_TIMEFRAME_LOW = 7;
  const MOD_RANGE_ADJUSTMENT_PERCENT_HIGH = 2000;
  const MOD_THRESHOLD_ADJUSTMENT_PERCENT_HIGH = 1500;
  const MOD_RANGE_ADJUSTMENT_PERCENT_LOW = 2000;
  const MOD_THRESHOLD_ADJUSTMENT_PERCENT_LOW = 1500;
  const MOD_MAX_POSITION_SIZE_PERCENT = 3000;
  const MOD_MIN_POSITION_SIZE = ethers.parseEther("100");
  const MOD_TARGET_UTILIZATION = 2000;
  const MOD_PRICE_DEVIATION_TOLERANCE = 100;
  const MOD_MIN_POOL_LIQUIDITY = ethers.parseEther("100000");
  const MOD_FEE_REINVESTMENT = true;
  const MOD_ORACLE_SOURCE = OracleSource.DEX;
  const MOD_PLATFORM_CRITERIA = PlatformSelectionCriteria.HighestVolume;

  // Aggressive template values
  const AGG_TARGET_RANGE_UPPER = 800;
  const AGG_TARGET_RANGE_LOWER = 800;
  const AGG_REBALANCE_THRESHOLD_UPPER = 80;
  const AGG_REBALANCE_THRESHOLD_LOWER = 80;
  const AGG_REINVESTMENT_TRIGGER = ethers.parseEther("25");
  const AGG_REINVESTMENT_RATIO = 10000;
  const AGG_MAX_SLIPPAGE = 100;
  const AGG_EMERGENCY_EXIT_TRIGGER = 1000;
  const AGG_MAX_VAULT_UTILIZATION = 9500;
  const AGG_REBALANCE_COUNT_THRESHOLD_HIGH = 4;
  const AGG_REBALANCE_COUNT_THRESHOLD_LOW = 1;
  const AGG_ADAPTIVE_TIMEFRAME_HIGH = 5;
  const AGG_ADAPTIVE_TIMEFRAME_LOW = 5;
  const AGG_RANGE_ADJUSTMENT_PERCENT_HIGH = 3000;
  const AGG_THRESHOLD_ADJUSTMENT_PERCENT_HIGH = 2000;
  const AGG_RANGE_ADJUSTMENT_PERCENT_LOW = 3000;
  const AGG_THRESHOLD_ADJUSTMENT_PERCENT_LOW = 2000;
  const AGG_MAX_POSITION_SIZE_PERCENT = 5000;
  const AGG_MIN_POSITION_SIZE = ethers.parseEther("50");
  const AGG_TARGET_UTILIZATION = 3000;
  const AGG_PRICE_DEVIATION_TOLERANCE = 200;
  const AGG_MIN_POOL_LIQUIDITY = ethers.parseEther("50000");
  const AGG_FEE_REINVESTMENT = true;
  const AGG_ORACLE_SOURCE = OracleSource.TWAP;
  const AGG_PLATFORM_CRITERIA = PlatformSelectionCriteria.HighestRewards;

  // Strategy function interface for encoding calls
  const strategyInterface = new ethers.Interface([
    "function selectTemplate(uint8 template)",
    "function setRangeParameters(uint16 upperRange, uint16 lowerRange, uint16 upperThreshold, uint16 lowerThreshold)",
    "function setFeeParameters(bool reinvest, uint256 trigger, uint16 ratio)",
    "function setRiskParameters(uint16 slippage, uint16 exitTrigger, uint16 utilization)",
    "function setAdaptiveParameters(bool adaptive, uint8 countHigh, uint8 countLow, uint16 timeHigh, uint16 timeLow, uint16 rangeHigh, uint16 thresholdHigh, uint16 rangeLow, uint16 thresholdLow)",
    "function setOracleParameters(uint8 source, uint16 tolerance)",
    "function setPositionSizingParameters(uint16 maxSize, uint256 minSize, uint16 utilization)",
    "function setPlatformParameters(uint8 criteria, uint256 liquidity)"
  ]);

  // Helper to execute strategy calls through vault
  async function executeOnStrategy(vault, vaultOwner, functionName, args) {
    const data = strategyInterface.encodeFunctionData(functionName, args);
    return vault.connect(vaultOwner).execute([strategyAddress], [data]);
  }

  beforeEach(async function () {
    [owner, user1] = await ethers.getSigners();

    // Deploy VaultFactory with owner and permit2 (v2.0.0)
    const VaultFactory = await ethers.getContractFactory("VaultFactory");
    factory = await VaultFactory.deploy(
      owner.address,
      "0x000000000022D473030F116dDEE9F6B43aC78BA3"  // permit2
    );
    await factory.waitForDeployment();

    // Deploy ParrisIslandStrategy
    const StrategyFactory = await ethers.getContractFactory("ParrisIslandStrategy");
    strategy = await StrategyFactory.deploy();
    await strategy.waitForDeployment();
    strategyAddress = await strategy.getAddress();

    // Create and authorize vault
    const tx = await factory.connect(user1).createVault("Test Vault 1");
    const receipt = await tx.wait();
    vault1Address = receipt.logs.find(log => log.fragment?.name === 'VaultCreated').args[1];
    vault1Contract = await ethers.getContractAt("PositionVault", vault1Address);

    await strategy.connect(user1).authorizeVault(vault1Address);
  });

  describe("Template Constants", function () {
    it("Should expose correct template constants", async function () {
      expect(await strategy.TEMPLATE_NONE()).to.equal(TEMPLATE_NONE);
      expect(await strategy.TEMPLATE_CONSERVATIVE()).to.equal(TEMPLATE_CONSERVATIVE);
      expect(await strategy.TEMPLATE_MODERATE()).to.equal(TEMPLATE_MODERATE);
      expect(await strategy.TEMPLATE_AGGRESSIVE()).to.equal(TEMPLATE_AGGRESSIVE);
    });
  });

  describe("Template Values - Default (Moderate)", function () {
    it("Should return moderate template values by default", async function () {
      // Range parameters
      expect(await strategy.getTargetRangeUpper(vault1Address)).to.equal(MOD_TARGET_RANGE_UPPER);
      expect(await strategy.getTargetRangeLower(vault1Address)).to.equal(MOD_TARGET_RANGE_LOWER);
      expect(await strategy.getRebalanceThresholdUpper(vault1Address)).to.equal(MOD_REBALANCE_THRESHOLD_UPPER);
      expect(await strategy.getRebalanceThresholdLower(vault1Address)).to.equal(MOD_REBALANCE_THRESHOLD_LOWER);

      // Fee parameters
      expect(await strategy.getFeeReinvestment(vault1Address)).to.equal(MOD_FEE_REINVESTMENT);
      expect(await strategy.getReinvestmentTrigger(vault1Address)).to.equal(MOD_REINVESTMENT_TRIGGER);
      expect(await strategy.getReinvestmentRatio(vault1Address)).to.equal(MOD_REINVESTMENT_RATIO);

      // Risk parameters
      expect(await strategy.getMaxSlippage(vault1Address)).to.equal(MOD_MAX_SLIPPAGE);
      expect(await strategy.getEmergencyExitTrigger(vault1Address)).to.equal(MOD_EMERGENCY_EXIT_TRIGGER);
      expect(await strategy.getMaxVaultUtilization(vault1Address)).to.equal(MOD_MAX_VAULT_UTILIZATION);

      // Adaptive parameters
      expect(await strategy.getAdaptiveRanges(vault1Address)).to.equal(true);
      expect(await strategy.getRebalanceCountThresholdHigh(vault1Address)).to.equal(MOD_REBALANCE_COUNT_THRESHOLD_HIGH);
      expect(await strategy.getRebalanceCountThresholdLow(vault1Address)).to.equal(MOD_REBALANCE_COUNT_THRESHOLD_LOW);

      // Position sizing
      expect(await strategy.getMaxPositionSizePercent(vault1Address)).to.equal(MOD_MAX_POSITION_SIZE_PERCENT);
      expect(await strategy.getMinPositionSize(vault1Address)).to.equal(MOD_MIN_POSITION_SIZE);
      expect(await strategy.getTargetUtilization(vault1Address)).to.equal(MOD_TARGET_UTILIZATION);

      // Oracle/Platform
      expect(await strategy.getOracleSource(vault1Address)).to.equal(MOD_ORACLE_SOURCE);
      expect(await strategy.getPlatformSelectionCriteria(vault1Address)).to.equal(MOD_PLATFORM_CRITERIA);
    });
  });

  describe("Template Values - Conservative", function () {
    beforeEach(async function () {
      await executeOnStrategy(vault1Contract, user1, "selectTemplate", [TEMPLATE_CONSERVATIVE]);
    });

    it("Should return conservative template values", async function () {
      expect(await strategy.getTargetRangeUpper(vault1Address)).to.equal(CONS_TARGET_RANGE_UPPER);
      expect(await strategy.getTargetRangeLower(vault1Address)).to.equal(CONS_TARGET_RANGE_LOWER);
      expect(await strategy.getRebalanceThresholdUpper(vault1Address)).to.equal(CONS_REBALANCE_THRESHOLD_UPPER);
      expect(await strategy.getRebalanceThresholdLower(vault1Address)).to.equal(CONS_REBALANCE_THRESHOLD_LOWER);
      expect(await strategy.getFeeReinvestment(vault1Address)).to.equal(CONS_FEE_REINVESTMENT);
      expect(await strategy.getMaxSlippage(vault1Address)).to.equal(CONS_MAX_SLIPPAGE);
      expect(await strategy.getEmergencyExitTrigger(vault1Address)).to.equal(CONS_EMERGENCY_EXIT_TRIGGER);
      expect(await strategy.getMaxVaultUtilization(vault1Address)).to.equal(CONS_MAX_VAULT_UTILIZATION);
      expect(await strategy.getMaxPositionSizePercent(vault1Address)).to.equal(CONS_MAX_POSITION_SIZE_PERCENT);
      expect(await strategy.getMinPositionSize(vault1Address)).to.equal(CONS_MIN_POSITION_SIZE);
      expect(await strategy.getTargetUtilization(vault1Address)).to.equal(CONS_TARGET_UTILIZATION);
      expect(await strategy.getPriceDeviationTolerance(vault1Address)).to.equal(CONS_PRICE_DEVIATION_TOLERANCE);
      expect(await strategy.getMinPoolLiquidity(vault1Address)).to.equal(CONS_MIN_POOL_LIQUIDITY);
      expect(await strategy.getOracleSource(vault1Address)).to.equal(CONS_ORACLE_SOURCE);
      expect(await strategy.getPlatformSelectionCriteria(vault1Address)).to.equal(CONS_PLATFORM_CRITERIA);

      // Conservative disables adaptive ranges
      expect(await strategy.getAdaptiveRanges(vault1Address)).to.equal(false);
    });
  });

  describe("Template Values - Aggressive", function () {
    beforeEach(async function () {
      await executeOnStrategy(vault1Contract, user1, "selectTemplate", [TEMPLATE_AGGRESSIVE]);
    });

    it("Should return aggressive template values", async function () {
      expect(await strategy.getTargetRangeUpper(vault1Address)).to.equal(AGG_TARGET_RANGE_UPPER);
      expect(await strategy.getTargetRangeLower(vault1Address)).to.equal(AGG_TARGET_RANGE_LOWER);
      expect(await strategy.getRebalanceThresholdUpper(vault1Address)).to.equal(AGG_REBALANCE_THRESHOLD_UPPER);
      expect(await strategy.getRebalanceThresholdLower(vault1Address)).to.equal(AGG_REBALANCE_THRESHOLD_LOWER);
      expect(await strategy.getFeeReinvestment(vault1Address)).to.equal(AGG_FEE_REINVESTMENT);
      expect(await strategy.getReinvestmentTrigger(vault1Address)).to.equal(AGG_REINVESTMENT_TRIGGER);
      expect(await strategy.getReinvestmentRatio(vault1Address)).to.equal(AGG_REINVESTMENT_RATIO);
      expect(await strategy.getMaxSlippage(vault1Address)).to.equal(AGG_MAX_SLIPPAGE);
      expect(await strategy.getEmergencyExitTrigger(vault1Address)).to.equal(AGG_EMERGENCY_EXIT_TRIGGER);
      expect(await strategy.getMaxVaultUtilization(vault1Address)).to.equal(AGG_MAX_VAULT_UTILIZATION);
      expect(await strategy.getMaxPositionSizePercent(vault1Address)).to.equal(AGG_MAX_POSITION_SIZE_PERCENT);
      expect(await strategy.getMinPositionSize(vault1Address)).to.equal(AGG_MIN_POSITION_SIZE);
      expect(await strategy.getTargetUtilization(vault1Address)).to.equal(AGG_TARGET_UTILIZATION);
      expect(await strategy.getPriceDeviationTolerance(vault1Address)).to.equal(AGG_PRICE_DEVIATION_TOLERANCE);
      expect(await strategy.getMinPoolLiquidity(vault1Address)).to.equal(AGG_MIN_POOL_LIQUIDITY);
      expect(await strategy.getOracleSource(vault1Address)).to.equal(AGG_ORACLE_SOURCE);
      expect(await strategy.getPlatformSelectionCriteria(vault1Address)).to.equal(AGG_PLATFORM_CRITERIA);

      // Aggressive enables adaptive ranges
      expect(await strategy.getAdaptiveRanges(vault1Address)).to.equal(true);
    });
  });

  describe("Parameter Setters", function () {
    it("Should set range parameters", async function () {
      const upperRange = 600;
      const lowerRange = 400;
      const upperThreshold = 120;
      const lowerThreshold = 80;

      await executeOnStrategy(vault1Contract, user1, "setRangeParameters", [upperRange, lowerRange, upperThreshold, lowerThreshold]);

      expect(await strategy.getTargetRangeUpper(vault1Address)).to.equal(upperRange);
      expect(await strategy.getTargetRangeLower(vault1Address)).to.equal(lowerRange);
      expect(await strategy.getRebalanceThresholdUpper(vault1Address)).to.equal(upperThreshold);
      expect(await strategy.getRebalanceThresholdLower(vault1Address)).to.equal(lowerThreshold);
    });

    it("Should set fee parameters", async function () {
      const reinvest = false;
      const trigger = ethers.parseEther("100");
      const ratio = 7500;

      await executeOnStrategy(vault1Contract, user1, "setFeeParameters", [reinvest, trigger, ratio]);

      expect(await strategy.getFeeReinvestment(vault1Address)).to.equal(reinvest);
      expect(await strategy.getReinvestmentTrigger(vault1Address)).to.equal(trigger);
      expect(await strategy.getReinvestmentRatio(vault1Address)).to.equal(ratio);
    });

    it("Should set risk parameters", async function () {
      const slippage = 40;
      const exitTrigger = 1200;
      const utilization = 7000;

      await executeOnStrategy(vault1Contract, user1, "setRiskParameters", [slippage, exitTrigger, utilization]);

      expect(await strategy.getMaxSlippage(vault1Address)).to.equal(slippage);
      expect(await strategy.getEmergencyExitTrigger(vault1Address)).to.equal(exitTrigger);
      expect(await strategy.getMaxVaultUtilization(vault1Address)).to.equal(utilization);
    });

    it("Should set adaptive parameters", async function () {
      await executeOnStrategy(vault1Contract, user1, "setAdaptiveParameters", [
        true,   // adaptive
        5,      // countHigh
        2,      // countLow
        10,     // timeHigh
        10,     // timeLow
        2500,   // rangeHigh
        2000,   // thresholdHigh
        1500,   // rangeLow
        1000    // thresholdLow
      ]);

      expect(await strategy.getAdaptiveRanges(vault1Address)).to.equal(true);
      expect(await strategy.getRebalanceCountThresholdHigh(vault1Address)).to.equal(5);
      expect(await strategy.getRebalanceCountThresholdLow(vault1Address)).to.equal(2);
      expect(await strategy.getAdaptiveTimeframeHigh(vault1Address)).to.equal(10);
      expect(await strategy.getAdaptiveTimeframeLow(vault1Address)).to.equal(10);
      expect(await strategy.getRangeAdjustmentPercentHigh(vault1Address)).to.equal(2500);
      expect(await strategy.getThresholdAdjustmentPercentHigh(vault1Address)).to.equal(2000);
      expect(await strategy.getRangeAdjustmentPercentLow(vault1Address)).to.equal(1500);
      expect(await strategy.getThresholdAdjustmentPercentLow(vault1Address)).to.equal(1000);
    });

    it("Should set oracle parameters", async function () {
      await executeOnStrategy(vault1Contract, user1, "setOracleParameters", [
        OracleSource.Chainlink,
        150
      ]);

      expect(await strategy.getOracleSource(vault1Address)).to.equal(OracleSource.Chainlink);
      expect(await strategy.getPriceDeviationTolerance(vault1Address)).to.equal(150);
    });

    it("Should set position sizing parameters", async function () {
      const maxSize = 4000;
      const minSize = ethers.parseEther("75");
      const utilization = 2500;

      await executeOnStrategy(vault1Contract, user1, "setPositionSizingParameters", [maxSize, minSize, utilization]);

      expect(await strategy.getMaxPositionSizePercent(vault1Address)).to.equal(maxSize);
      expect(await strategy.getMinPositionSize(vault1Address)).to.equal(minSize);
      expect(await strategy.getTargetUtilization(vault1Address)).to.equal(utilization);
    });

    it("Should set platform parameters", async function () {
      const criteria = PlatformSelectionCriteria.LowestFees;
      const liquidity = ethers.parseEther("150000");

      await executeOnStrategy(vault1Contract, user1, "setPlatformParameters", [criteria, liquidity]);

      expect(await strategy.getPlatformSelectionCriteria(vault1Address)).to.equal(criteria);
      expect(await strategy.getMinPoolLiquidity(vault1Address)).to.equal(liquidity);
    });
  });

  describe("Customization Override", function () {
    it("Should return custom values over template values", async function () {
      // Select Conservative template
      await executeOnStrategy(vault1Contract, user1, "selectTemplate", [TEMPLATE_CONSERVATIVE]);

      // Verify template value
      expect(await strategy.getOracleSource(vault1Address)).to.equal(OracleSource.Chainlink);

      // Set custom oracle source
      await executeOnStrategy(vault1Contract, user1, "setOracleParameters", [OracleSource.TWAP, 200]);

      // Should return custom value
      expect(await strategy.getOracleSource(vault1Address)).to.equal(OracleSource.TWAP);
      expect(await strategy.getPriceDeviationTolerance(vault1Address)).to.equal(200);

      // Other template values should still work
      expect(await strategy.getMaxSlippage(vault1Address)).to.equal(CONS_MAX_SLIPPAGE);
    });
  });

  describe("getAllParameters", function () {
    // ABI types for decoding getAllParameters bytes
    const PARAM_TYPES = [
      'uint16', 'uint16', 'uint16', 'uint16',           // Range params
      'bool', 'uint256', 'uint16',                       // Fee settings
      'uint16', 'uint16', 'uint16',                      // Risk management
      'bool', 'uint8', 'uint8', 'uint16', 'uint16', 'uint16', 'uint16', 'uint16', 'uint16', // Adaptive
      'uint8', 'uint16',                                 // Oracle (enum is uint8)
      'uint16', 'uint256', 'uint16',                     // Position sizing
      'uint8', 'uint256'                                 // Platform (enum is uint8)
    ];

    it("Should return bytes that can be decoded to all parameters", async function () {
      await executeOnStrategy(vault1Contract, user1, "selectTemplate", [TEMPLATE_MODERATE]);

      const rawBytes = await strategy.getAllParameters(vault1Address);

      // Decode the bytes
      const params = ethers.AbiCoder.defaultAbiCoder().decode(PARAM_TYPES, rawBytes);

      // Verify key parameters are in expected positions
      expect(params[0]).to.equal(MOD_TARGET_RANGE_UPPER);       // targetRangeUpper
      expect(params[1]).to.equal(MOD_TARGET_RANGE_LOWER);       // targetRangeLower
      expect(params[4]).to.equal(MOD_FEE_REINVESTMENT);         // feeReinvestment
      expect(params[7]).to.equal(MOD_MAX_SLIPPAGE);             // maxSlippage
      expect(params[10]).to.equal(true);                        // adaptiveRanges
    });

    it("Should return valid hex bytes string", async function () {
      const rawBytes = await strategy.getAllParameters(vault1Address);

      // Should be a hex string starting with 0x
      expect(rawBytes).to.match(/^0x[0-9a-fA-F]+$/);
    });
  });

  describe("Version", function () {
    it("Should return correct version", async function () {
      const version = await strategy.VERSION();
      expect(version).to.equal("0.4.0");
    });
  });
});
