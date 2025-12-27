const { expect } = require("chai");
const { ethers } = require('hardhat');

/**
 * Tests for BabyStepsStrategy-specific functionality
 * Base functionality (authorization, template selection, reset) is tested in StrategyBase.test.js
 */
describe("BabyStepsStrategy", function () {
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
  const TEMPLATE_STABLECOIN = 4;

  // Conservative template values
  const CONS_TARGET_RANGE_UPPER = 1000;           // 10.00%
  const CONS_TARGET_RANGE_LOWER = 1000;           // 10.00%
  const CONS_REINVESTMENT_TRIGGER = 5000;         // $50.00 (in cents)
  const CONS_REINVESTMENT_RATIO = 3000;           // 30.00%
  const CONS_MAX_SLIPPAGE = 50;                   // 0.50%
  const CONS_EMERGENCY_EXIT_TRIGGER = 1000;       // 10.00%
  const CONS_MAX_UTILIZATION = 9000;              // 90.00%
  const CONS_FEE_REINVESTMENT = true;

  // Moderate template values
  const MOD_TARGET_RANGE_UPPER = 500;             // 5.00%
  const MOD_TARGET_RANGE_LOWER = 500;             // 5.00%
  const MOD_REINVESTMENT_TRIGGER = 5000;          // $50.00 (in cents)
  const MOD_REINVESTMENT_RATIO = 5000;            // 50.00%
  const MOD_MAX_SLIPPAGE = 50;                    // 0.50%
  const MOD_EMERGENCY_EXIT_TRIGGER = 1000;        // 10.00%
  const MOD_MAX_UTILIZATION = 9000;               // 90.00%
  const MOD_FEE_REINVESTMENT = true;

  // Aggressive template values
  const AGG_TARGET_RANGE_UPPER = 300;             // 3.00%
  const AGG_TARGET_RANGE_LOWER = 300;             // 3.00%
  const AGG_REINVESTMENT_TRIGGER = 5000;          // $50.00 (in cents)
  const AGG_REINVESTMENT_RATIO = 9000;            // 90.00%
  const AGG_MAX_SLIPPAGE = 50;                    // 0.50%
  const AGG_EMERGENCY_EXIT_TRIGGER = 1000;        // 10.00%
  const AGG_MAX_UTILIZATION = 9000;               // 90.00%

  // Stablecoin template values
  const STBL_TARGET_RANGE_UPPER = 20;             // 0.20%
  const STBL_TARGET_RANGE_LOWER = 20;             // 0.20%
  const STBL_REINVESTMENT_TRIGGER = 1000;         // $10.00 (in cents)
  const STBL_REINVESTMENT_RATIO = 10000;          // 100.00%
  const STBL_MAX_SLIPPAGE = 20;                   // 0.20%
  const STBL_EMERGENCY_EXIT_TRIGGER = 100;        // 1.00%
  const STBL_MAX_UTILIZATION = 9000;              // 90.00%

  // Strategy function interface for encoding calls
  const strategyInterface = new ethers.Interface([
    "function selectTemplate(uint8 template)",
    "function setRangeParameters(uint16 upperRange, uint16 lowerRange)",
    "function setFeeParameters(bool reinvest, uint256 trigger, uint16 ratio)",
    "function setRiskParameters(uint16 slippage, uint16 exitTrigger, uint16 utilization)"
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

    // Deploy BabyStepsStrategy
    const StrategyFactory = await ethers.getContractFactory("BabyStepsStrategy");
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
      expect(await strategy.TEMPLATE_STABLECOIN()).to.equal(TEMPLATE_STABLECOIN);
    });
  });

  describe("Template Values - Default (Moderate)", function () {
    it("Should return moderate template values by default", async function () {
      // Range parameters
      expect(await strategy.getTargetRangeUpper(vault1Address)).to.equal(MOD_TARGET_RANGE_UPPER);
      expect(await strategy.getTargetRangeLower(vault1Address)).to.equal(MOD_TARGET_RANGE_LOWER);

      // Fee parameters
      expect(await strategy.getFeeReinvestment(vault1Address)).to.equal(MOD_FEE_REINVESTMENT);
      expect(await strategy.getReinvestmentTrigger(vault1Address)).to.equal(MOD_REINVESTMENT_TRIGGER);
      expect(await strategy.getReinvestmentRatio(vault1Address)).to.equal(MOD_REINVESTMENT_RATIO);

      // Risk parameters
      expect(await strategy.getMaxSlippage(vault1Address)).to.equal(MOD_MAX_SLIPPAGE);
      expect(await strategy.getEmergencyExitTrigger(vault1Address)).to.equal(MOD_EMERGENCY_EXIT_TRIGGER);
      expect(await strategy.getMaxUtilization(vault1Address)).to.equal(MOD_MAX_UTILIZATION);
    });
  });

  describe("Template Values - Conservative", function () {
    beforeEach(async function () {
      await executeOnStrategy(vault1Contract, user1, "selectTemplate", [TEMPLATE_CONSERVATIVE]);
    });

    it("Should return conservative template values", async function () {
      expect(await strategy.getTargetRangeUpper(vault1Address)).to.equal(CONS_TARGET_RANGE_UPPER);
      expect(await strategy.getTargetRangeLower(vault1Address)).to.equal(CONS_TARGET_RANGE_LOWER);
      expect(await strategy.getFeeReinvestment(vault1Address)).to.equal(CONS_FEE_REINVESTMENT);
      expect(await strategy.getReinvestmentTrigger(vault1Address)).to.equal(CONS_REINVESTMENT_TRIGGER);
      expect(await strategy.getReinvestmentRatio(vault1Address)).to.equal(CONS_REINVESTMENT_RATIO);
      expect(await strategy.getMaxSlippage(vault1Address)).to.equal(CONS_MAX_SLIPPAGE);
      expect(await strategy.getEmergencyExitTrigger(vault1Address)).to.equal(CONS_EMERGENCY_EXIT_TRIGGER);
      expect(await strategy.getMaxUtilization(vault1Address)).to.equal(CONS_MAX_UTILIZATION);
    });
  });

  describe("Template Values - Aggressive", function () {
    beforeEach(async function () {
      await executeOnStrategy(vault1Contract, user1, "selectTemplate", [TEMPLATE_AGGRESSIVE]);
    });

    it("Should return aggressive template values", async function () {
      expect(await strategy.getTargetRangeUpper(vault1Address)).to.equal(AGG_TARGET_RANGE_UPPER);
      expect(await strategy.getTargetRangeLower(vault1Address)).to.equal(AGG_TARGET_RANGE_LOWER);
      expect(await strategy.getReinvestmentTrigger(vault1Address)).to.equal(AGG_REINVESTMENT_TRIGGER);
      expect(await strategy.getReinvestmentRatio(vault1Address)).to.equal(AGG_REINVESTMENT_RATIO);
      expect(await strategy.getMaxSlippage(vault1Address)).to.equal(AGG_MAX_SLIPPAGE);
      expect(await strategy.getEmergencyExitTrigger(vault1Address)).to.equal(AGG_EMERGENCY_EXIT_TRIGGER);
      expect(await strategy.getMaxUtilization(vault1Address)).to.equal(AGG_MAX_UTILIZATION);
    });
  });

  describe("Template Values - Stablecoin", function () {
    beforeEach(async function () {
      await executeOnStrategy(vault1Contract, user1, "selectTemplate", [TEMPLATE_STABLECOIN]);
    });

    it("Should return stablecoin template values", async function () {
      expect(await strategy.getTargetRangeUpper(vault1Address)).to.equal(STBL_TARGET_RANGE_UPPER);
      expect(await strategy.getTargetRangeLower(vault1Address)).to.equal(STBL_TARGET_RANGE_LOWER);
      expect(await strategy.getReinvestmentTrigger(vault1Address)).to.equal(STBL_REINVESTMENT_TRIGGER);
      expect(await strategy.getReinvestmentRatio(vault1Address)).to.equal(STBL_REINVESTMENT_RATIO);
      expect(await strategy.getMaxSlippage(vault1Address)).to.equal(STBL_MAX_SLIPPAGE);
      expect(await strategy.getEmergencyExitTrigger(vault1Address)).to.equal(STBL_EMERGENCY_EXIT_TRIGGER);
      expect(await strategy.getMaxUtilization(vault1Address)).to.equal(STBL_MAX_UTILIZATION);
    });
  });

  describe("Parameter Setters", function () {
    it("Should set range parameters", async function () {
      const upperRange = 600;
      const lowerRange = 400;

      await executeOnStrategy(vault1Contract, user1, "setRangeParameters", [upperRange, lowerRange]);

      expect(await strategy.getTargetRangeUpper(vault1Address)).to.equal(upperRange);
      expect(await strategy.getTargetRangeLower(vault1Address)).to.equal(lowerRange);
    });

    it("Should set fee parameters", async function () {
      const reinvest = false;
      const trigger = 10000; // $100 in cents
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
      expect(await strategy.getMaxUtilization(vault1Address)).to.equal(utilization);
    });

    it("Should emit ParameterUpdated event", async function () {
      const data = strategyInterface.encodeFunctionData("setRangeParameters", [600, 400]);

      await expect(vault1Contract.connect(user1).execute([strategyAddress], [data]))
        .to.emit(strategy, "ParameterUpdated")
        .withArgs(vault1Address, "rangeParameters");
    });
  });

  describe("Customization Override", function () {
    it("Should return custom values over template values", async function () {
      // Select Conservative template
      await executeOnStrategy(vault1Contract, user1, "selectTemplate", [TEMPLATE_CONSERVATIVE]);

      // Verify template value
      expect(await strategy.getTargetRangeUpper(vault1Address)).to.equal(CONS_TARGET_RANGE_UPPER);

      // Set custom value
      const customValue = 1234;
      await executeOnStrategy(vault1Contract, user1, "setRangeParameters", [customValue, 1000]);

      // Should return custom value
      expect(await strategy.getTargetRangeUpper(vault1Address)).to.equal(customValue);

      // Other template values should still work
      expect(await strategy.getMaxSlippage(vault1Address)).to.equal(CONS_MAX_SLIPPAGE);
    });
  });

  describe("getAllParameters", function () {
    // ABI types for decoding getAllParameters bytes (8 params after removing rebalanceThresholds)
    const PARAM_TYPES = ['uint16', 'uint16', 'bool', 'uint256', 'uint16', 'uint16', 'uint16', 'uint16'];

    it("Should return bytes that can be decoded to all parameters", async function () {
      await executeOnStrategy(vault1Contract, user1, "selectTemplate", [TEMPLATE_MODERATE]);

      const rawBytes = await strategy.getAllParameters(vault1Address);

      // Decode the bytes
      const params = ethers.AbiCoder.defaultAbiCoder().decode(PARAM_TYPES, rawBytes);

      // Verify all 8 parameters are returned in correct order
      expect(params[0]).to.equal(MOD_TARGET_RANGE_UPPER);       // targetRangeUpper
      expect(params[1]).to.equal(MOD_TARGET_RANGE_LOWER);       // targetRangeLower
      expect(params[2]).to.equal(MOD_FEE_REINVESTMENT);         // feeReinvestment
      expect(params[3]).to.equal(MOD_REINVESTMENT_TRIGGER);     // reinvestmentTrigger
      expect(params[4]).to.equal(MOD_REINVESTMENT_RATIO);       // reinvestmentRatio
      expect(params[5]).to.equal(MOD_MAX_SLIPPAGE);             // maxSlippage
      expect(params[6]).to.equal(MOD_EMERGENCY_EXIT_TRIGGER);   // emergencyExitTrigger
      expect(params[7]).to.equal(MOD_MAX_UTILIZATION);          // maxUtilization
    });

    it("Should include custom values mixed with template values", async function () {
      await executeOnStrategy(vault1Contract, user1, "selectTemplate", [TEMPLATE_MODERATE]);

      // Set custom risk parameters
      const customSlippage = 75;
      await executeOnStrategy(vault1Contract, user1, "setRiskParameters", [customSlippage, 1500, 8000]);

      const rawBytes = await strategy.getAllParameters(vault1Address);
      const params = ethers.AbiCoder.defaultAbiCoder().decode(PARAM_TYPES, rawBytes);

      // Template values
      expect(params[0]).to.equal(MOD_TARGET_RANGE_UPPER);

      // Custom values
      expect(params[5]).to.equal(customSlippage);
      expect(params[6]).to.equal(1500);
      expect(params[7]).to.equal(8000);
    });

    it("Should return valid hex bytes string", async function () {
      const rawBytes = await strategy.getAllParameters(vault1Address);

      // Should be a hex string starting with 0x
      expect(rawBytes).to.match(/^0x[0-9a-fA-F]+$/);
    });
  });

  describe("Version", function () {
    it("Should return correct version", async function () {
      const version = await strategy.getVersion();
      expect(version).to.equal("2.0.0");
    });
  });
});
