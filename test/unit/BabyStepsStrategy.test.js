const { expect } = require("chai");
const { ethers } = require('hardhat');

describe("BabyStepsStrategy", function () {
  let strategy;
  let strategyAddress;
  let factory;
  let owner;
  let user1;
  let user2;
  let vault1Contract;
  let vault2Contract;
  let vault1Address;
  let vault2Address;

  // ==================== Template Constants ====================
  // Conservative template values - WIDER ranges, fewer rebalances
  const CONS_TARGET_RANGE_UPPER = 1000;           // 10.00%
  const CONS_TARGET_RANGE_LOWER = 1000;           // 10.00%
  const CONS_REBALANCE_THRESHOLD_UPPER = 600;     // 6.00%
  const CONS_REBALANCE_THRESHOLD_LOWER = 600;     // 6.00%
  const CONS_REINVESTMENT_TRIGGER = 5000;         // $50.00 (in cents)
  const CONS_REINVESTMENT_RATIO = 3000;           // 30.00%
  const CONS_MAX_SLIPPAGE = 50;                   // 0.50%
  const CONS_EMERGENCY_EXIT_TRIGGER = 1000;       // 10.00%
  const CONS_MAX_UTILIZATION = 9000;              // 90.00%
  const CONS_FEE_REINVESTMENT = true;

  // Moderate template values - MEDIUM ranges, moderate rebalances
  const MOD_TARGET_RANGE_UPPER = 500;             // 5.00%
  const MOD_TARGET_RANGE_LOWER = 500;             // 5.00%
  const MOD_REBALANCE_THRESHOLD_UPPER = 400;      // 4.00%
  const MOD_REBALANCE_THRESHOLD_LOWER = 400;      // 4.00%
  const MOD_REINVESTMENT_TRIGGER = 5000;          // $50.00 (in cents)
  const MOD_REINVESTMENT_RATIO = 5000;            // 50.00%
  const MOD_MAX_SLIPPAGE = 50;                    // 0.50%
  const MOD_EMERGENCY_EXIT_TRIGGER = 1000;        // 10.00%
  const MOD_MAX_UTILIZATION = 9000;               // 90.00%
  const MOD_FEE_REINVESTMENT = true;

  // Aggressive template values - TIGHTER ranges, frequent rebalances
  const AGG_TARGET_RANGE_UPPER = 300;             // 3.00%
  const AGG_TARGET_RANGE_LOWER = 300;             // 3.00%
  const AGG_REBALANCE_THRESHOLD_UPPER = 80;       // 0.80%
  const AGG_REBALANCE_THRESHOLD_LOWER = 80;       // 0.80%
  const AGG_REINVESTMENT_TRIGGER = 5000;          // $50.00 (in cents)
  const AGG_REINVESTMENT_RATIO = 9000;            // 90.00%
  const AGG_MAX_SLIPPAGE = 50;                    // 0.50%
  const AGG_EMERGENCY_EXIT_TRIGGER = 1000;        // 10.00%
  const AGG_MAX_UTILIZATION = 9000;               // 90.00%
  const AGG_FEE_REINVESTMENT = true;

  // Stablecoin template values - VERY TIGHT ranges for stablecoins
  const STBL_TARGET_RANGE_UPPER = 20;             // 0.20%
  const STBL_TARGET_RANGE_LOWER = 20;             // 0.20%
  const STBL_REBALANCE_THRESHOLD_UPPER = 1250;    // 12.50%
  const STBL_REBALANCE_THRESHOLD_LOWER = 1250;    // 12.50%
  const STBL_REINVESTMENT_TRIGGER = 1000;         // $10.00 (in cents)
  const STBL_REINVESTMENT_RATIO = 10000;          // 100.00%
  const STBL_MAX_SLIPPAGE = 20;                   // 0.20%
  const STBL_EMERGENCY_EXIT_TRIGGER = 100;        // 1.00%
  const STBL_MAX_UTILIZATION = 9000;              // 90.00%
  const STBL_FEE_REINVESTMENT = true;

  // Enum values
  const Template = {
    None: 0,
    Conservative: 1,
    Moderate: 2,
    Aggressive: 3,
    Stablecoin: 4
  };

  // Strategy function interface for encoding calls
  const strategyInterface = new ethers.Interface([
    "function selectTemplate(uint8 template)",
    "function setRangeParameters(uint16 upperRange, uint16 lowerRange, uint16 upperThreshold, uint16 lowerThreshold)",
    "function setFeeParameters(bool reinvest, uint256 trigger, uint16 ratio)",
    "function setRiskParameters(uint16 slippage, uint16 exitTrigger, uint16 utilization)",
    "function resetToTemplate()",
    "function resetAll()"
  ]);

  // Helper to execute strategy calls through vault
  async function executeOnStrategy(vault, vaultOwner, functionName, args) {
    const data = strategyInterface.encodeFunctionData(functionName, args);
    return vault.connect(vaultOwner).execute([strategyAddress], [data]);
  }

  beforeEach(async function () {
    [owner, user1, user2] = await ethers.getSigners();

    // Deploy MockUniversalRouter
    const MockUniversalRouter = await ethers.getContractFactory("MockUniversalRouter");
    const router = await MockUniversalRouter.deploy();
    await router.waitForDeployment();

    // Deploy VaultFactory
    const VaultFactory = await ethers.getContractFactory("VaultFactory");
    factory = await VaultFactory.deploy(
      owner.address,
      await router.getAddress(),
      "0x000000000022D473030F116dDEE9F6B43aC78BA3", // permit2
      "0xC36442b4a4522E871399CD717aBDD847Ab11FE88"  // nonfungiblePositionManager
    );
    await factory.waitForDeployment();

    // Deploy BabyStepsStrategy
    const StrategyFactory = await ethers.getContractFactory("BabyStepsStrategy");
    strategy = await StrategyFactory.deploy();
    await strategy.waitForDeployment();
    strategyAddress = await strategy.getAddress();

    // Create vault1 owned by user1
    let tx = await factory.connect(user1).createVault("Test Vault 1");
    let receipt = await tx.wait();
    vault1Address = receipt.logs.find(log => log.fragment?.name === 'VaultCreated').args[1];
    vault1Contract = await ethers.getContractAt("PositionVault", vault1Address);

    // Create vault2 owned by user2
    tx = await factory.connect(user2).createVault("Test Vault 2");
    receipt = await tx.wait();
    vault2Address = receipt.logs.find(log => log.fragment?.name === 'VaultCreated').args[1];
    vault2Contract = await ethers.getContractAt("PositionVault", vault2Address);

    // Authorize vaults (called by vault owners)
    await strategy.connect(user1).authorizeVault(vault1Address);
    await strategy.connect(user2).authorizeVault(vault2Address);
  });

  describe("Authorization", function() {
    it("Should allow vault owner to authorize their vault", async function() {
      // Create a new vault owned by user1
      const tx = await factory.connect(user1).createVault("New Vault");
      const receipt = await tx.wait();
      const newVaultAddress = receipt.logs.find(log => log.fragment?.name === 'VaultCreated').args[1];

      // user1 (vault owner) authorizes the new vault
      await strategy.connect(user1).authorizeVault(newVaultAddress);
      expect(await strategy.authorizedVaults(newVaultAddress)).to.equal(true);
    });

    it("Should allow vault owner to deauthorize their vault", async function() {
      await strategy.connect(user1).deauthorizeVault(vault1Address);
      expect(await strategy.authorizedVaults(vault1Address)).to.equal(false);
    });

    it("Should fail when non-owner tries to authorize someone else's vault", async function() {
      // Create a new vault owned by user1
      const tx = await factory.connect(user1).createVault("New Vault");
      const receipt = await tx.wait();
      const newVaultAddress = receipt.logs.find(log => log.fragment?.name === 'VaultCreated').args[1];

      // user2 (NOT the vault owner) tries to authorize user1's vault
      await expect(
        strategy.connect(user2).authorizeVault(newVaultAddress)
      ).to.be.revertedWith("BabyStepsStrategy: caller is not vault owner");
    });

    it("Should fail when non-owner tries to deauthorize someone else's vault", async function() {
      // user2 tries to deauthorize vault1 (owned by user1)
      await expect(
        strategy.connect(user2).deauthorizeVault(vault1Address)
      ).to.be.revertedWith("BabyStepsStrategy: caller is not vault owner");
    });

    it("Should fail when unauthorized vault tries to set parameters", async function() {
      // Create a new vault but don't authorize it
      const tx = await factory.connect(user1).createVault("Unauthorized Vault");
      const receipt = await tx.wait();
      const unauthorizedVaultAddress = receipt.logs.find(log => log.fragment?.name === 'VaultCreated').args[1];
      const unauthorizedVault = await ethers.getContractAt("PositionVault", unauthorizedVaultAddress);

      // Try to set parameters through the unauthorized vault
      const data = strategyInterface.encodeFunctionData("setRangeParameters", [600, 400, 120, 80]);
      await expect(
        unauthorizedVault.connect(user1).execute([strategyAddress], [data])
      ).to.be.revertedWith("PositionVault: transaction failed");
    });

    it("Should fail when unauthorized vault tries to select template", async function() {
      // Create a new vault but don't authorize it
      const tx = await factory.connect(user1).createVault("Unauthorized Vault");
      const receipt = await tx.wait();
      const unauthorizedVaultAddress = receipt.logs.find(log => log.fragment?.name === 'VaultCreated').args[1];
      const unauthorizedVault = await ethers.getContractAt("PositionVault", unauthorizedVaultAddress);

      // Try to select template through the unauthorized vault
      const data = strategyInterface.encodeFunctionData("selectTemplate", [Template.Conservative]);
      await expect(
        unauthorizedVault.connect(user1).execute([strategyAddress], [data])
      ).to.be.revertedWith("PositionVault: transaction failed");
    });
  });

  describe("Template Selection", function () {
    it("Should set default template to None", async function () {
      const template = await strategy.selectedTemplate(vault1Address);
      expect(template).to.equal(Template.None);
    });

    it("Should select Conservative template", async function () {
      await executeOnStrategy(vault1Contract, user1, "selectTemplate", [Template.Conservative]);
      const template = await strategy.selectedTemplate(vault1Address);
      expect(template).to.equal(Template.Conservative);
    });

    it("Should select Stablecoin template", async function () {
      await executeOnStrategy(vault1Contract, user1, "selectTemplate", [Template.Stablecoin]);
      const template = await strategy.selectedTemplate(vault1Address);
      expect(template).to.equal(Template.Stablecoin);
    });

    it("Should clear customization bitmap when selecting template", async function () {
      // First set a custom parameter
      await executeOnStrategy(vault1Contract, user1, "setRangeParameters", [1000, 1000, 100, 100]);

      // Verify bitmap is non-zero
      const bitmapBefore = await strategy.customizationBitmap(vault1Address);
      expect(bitmapBefore).to.not.equal(0n);

      // Select a template
      await executeOnStrategy(vault1Contract, user1, "selectTemplate", [Template.Moderate]);

      // Verify bitmap is cleared
      const bitmapAfter = await strategy.customizationBitmap(vault1Address);
      expect(bitmapAfter).to.equal(0n);
    });
  });

  describe("Parameter Getters", function () {
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
      expect(await strategy.getMaxUtilization(vault1Address)).to.equal(MOD_MAX_UTILIZATION);
    });

    it("Should return conservative template values when selected", async function () {
      await executeOnStrategy(vault1Contract, user1, "selectTemplate", [Template.Conservative]);

      // Range parameters
      expect(await strategy.getTargetRangeUpper(vault1Address)).to.equal(CONS_TARGET_RANGE_UPPER);
      expect(await strategy.getTargetRangeLower(vault1Address)).to.equal(CONS_TARGET_RANGE_LOWER);
      expect(await strategy.getRebalanceThresholdUpper(vault1Address)).to.equal(CONS_REBALANCE_THRESHOLD_UPPER);
      expect(await strategy.getRebalanceThresholdLower(vault1Address)).to.equal(CONS_REBALANCE_THRESHOLD_LOWER);

      // Fee parameters
      expect(await strategy.getFeeReinvestment(vault1Address)).to.equal(CONS_FEE_REINVESTMENT);
      expect(await strategy.getReinvestmentTrigger(vault1Address)).to.equal(CONS_REINVESTMENT_TRIGGER);
      expect(await strategy.getReinvestmentRatio(vault1Address)).to.equal(CONS_REINVESTMENT_RATIO);

      // Risk parameters
      expect(await strategy.getMaxSlippage(vault1Address)).to.equal(CONS_MAX_SLIPPAGE);
      expect(await strategy.getEmergencyExitTrigger(vault1Address)).to.equal(CONS_EMERGENCY_EXIT_TRIGGER);
      expect(await strategy.getMaxUtilization(vault1Address)).to.equal(CONS_MAX_UTILIZATION);
    });

    it("Should return aggressive template values when selected", async function () {
      await executeOnStrategy(vault1Contract, user1, "selectTemplate", [Template.Aggressive]);

      // Range parameters
      expect(await strategy.getTargetRangeUpper(vault1Address)).to.equal(AGG_TARGET_RANGE_UPPER);
      expect(await strategy.getTargetRangeLower(vault1Address)).to.equal(AGG_TARGET_RANGE_LOWER);
      expect(await strategy.getRebalanceThresholdUpper(vault1Address)).to.equal(AGG_REBALANCE_THRESHOLD_UPPER);
      expect(await strategy.getRebalanceThresholdLower(vault1Address)).to.equal(AGG_REBALANCE_THRESHOLD_LOWER);

      // Fee parameters
      expect(await strategy.getFeeReinvestment(vault1Address)).to.equal(AGG_FEE_REINVESTMENT);
      expect(await strategy.getReinvestmentTrigger(vault1Address)).to.equal(AGG_REINVESTMENT_TRIGGER);
      expect(await strategy.getReinvestmentRatio(vault1Address)).to.equal(AGG_REINVESTMENT_RATIO);

      // Risk parameters
      expect(await strategy.getMaxSlippage(vault1Address)).to.equal(AGG_MAX_SLIPPAGE);
      expect(await strategy.getEmergencyExitTrigger(vault1Address)).to.equal(AGG_EMERGENCY_EXIT_TRIGGER);
      expect(await strategy.getMaxUtilization(vault1Address)).to.equal(AGG_MAX_UTILIZATION);
    });

    it("Should return stablecoin template values when selected", async function () {
      await executeOnStrategy(vault1Contract, user1, "selectTemplate", [Template.Stablecoin]);

      // Range parameters
      expect(await strategy.getTargetRangeUpper(vault1Address)).to.equal(STBL_TARGET_RANGE_UPPER);
      expect(await strategy.getTargetRangeLower(vault1Address)).to.equal(STBL_TARGET_RANGE_LOWER);
      expect(await strategy.getRebalanceThresholdUpper(vault1Address)).to.equal(STBL_REBALANCE_THRESHOLD_UPPER);
      expect(await strategy.getRebalanceThresholdLower(vault1Address)).to.equal(STBL_REBALANCE_THRESHOLD_LOWER);

      // Fee parameters
      expect(await strategy.getFeeReinvestment(vault1Address)).to.equal(STBL_FEE_REINVESTMENT);
      expect(await strategy.getReinvestmentTrigger(vault1Address)).to.equal(STBL_REINVESTMENT_TRIGGER);
      expect(await strategy.getReinvestmentRatio(vault1Address)).to.equal(STBL_REINVESTMENT_RATIO);

      // Risk parameters
      expect(await strategy.getMaxSlippage(vault1Address)).to.equal(STBL_MAX_SLIPPAGE);
      expect(await strategy.getEmergencyExitTrigger(vault1Address)).to.equal(STBL_EMERGENCY_EXIT_TRIGGER);
      expect(await strategy.getMaxUtilization(vault1Address)).to.equal(STBL_MAX_UTILIZATION);
    });

    it("Should return customized values when parameters are customized", async function () {
      // Set custom range parameters
      const customRangeUpper = 1234;
      const customRangeLower = 2345;

      // First select template
      await executeOnStrategy(vault1Contract, user1, "selectTemplate", [Template.Conservative]);

      // Then customize parameters
      await executeOnStrategy(vault1Contract, user1, "setRangeParameters", [customRangeUpper, customRangeLower, 100, 100]);

      // Should return custom values
      const rangeUpper = await strategy.getTargetRangeUpper(vault1Address);
      const rangeLower = await strategy.getTargetRangeLower(vault1Address);

      expect(rangeUpper).to.equal(customRangeUpper);
      expect(rangeLower).to.equal(customRangeLower);
    });

    it("Should return all parameters with template fallbacks", async function () {
      await executeOnStrategy(vault1Contract, user1, "selectTemplate", [Template.Moderate]);

      // Set just one custom parameter
      const customSlippage = 75;
      await executeOnStrategy(vault1Contract, user1, "setRiskParameters", [customSlippage, 1500, 8000]);

      // Get all parameters
      const params = await strategy.getAllParameters(vault1Address);

      // Check template values and custom values are all returned
      expect(params[0]).to.equal(MOD_TARGET_RANGE_UPPER); // Template value
      expect(params[7]).to.equal(customSlippage);         // Custom value
    });
  });

  describe("Parameter Setters", function () {
    it("Should set range parameters", async function () {
      const upperRange = 600;
      const lowerRange = 400;
      const upperThreshold = 120;
      const lowerThreshold = 80;

      await executeOnStrategy(vault1Contract, user1, "setRangeParameters", [upperRange, lowerRange, upperThreshold, lowerThreshold]);

      // Check values were set
      expect(await strategy.getTargetRangeUpper(vault1Address)).to.equal(upperRange);
      expect(await strategy.getTargetRangeLower(vault1Address)).to.equal(lowerRange);
      expect(await strategy.getRebalanceThresholdUpper(vault1Address)).to.equal(upperThreshold);
      expect(await strategy.getRebalanceThresholdLower(vault1Address)).to.equal(lowerThreshold);

      // Check bitmap was updated
      const bitmap = await strategy.customizationBitmap(vault1Address);
      // Check if bits 0-3 are set (15 = 0b1111)
      expect(bitmap & 15n).to.equal(15n);
    });

    it("Should set fee parameters", async function () {
      const reinvest = true;
      const trigger = ethers.parseEther("100");
      const ratio = 7500;

      await executeOnStrategy(vault1Contract, user1, "setFeeParameters", [reinvest, trigger, ratio]);

      // Check values were set
      expect(await strategy.getFeeReinvestment(vault1Address)).to.equal(reinvest);
      expect(await strategy.getReinvestmentTrigger(vault1Address)).to.equal(trigger);
      expect(await strategy.getReinvestmentRatio(vault1Address)).to.equal(ratio);

      // Check bitmap was updated
      const bitmap = await strategy.customizationBitmap(vault1Address);
      // Check if bits 4-6 are set (112 = 0b1110000)
      expect(bitmap & 112n).to.equal(112n);
    });

    it("Should set risk parameters", async function () {
      const slippage = 40;
      const exitTrigger = 1200;
      const utilization = 7000;

      await executeOnStrategy(vault1Contract, user1, "setRiskParameters", [slippage, exitTrigger, utilization]);

      // Check values were set
      expect(await strategy.getMaxSlippage(vault1Address)).to.equal(slippage);
      expect(await strategy.getEmergencyExitTrigger(vault1Address)).to.equal(exitTrigger);
      expect(await strategy.getMaxUtilization(vault1Address)).to.equal(utilization);

      // Check bitmap was updated
      const bitmap = await strategy.customizationBitmap(vault1Address);
      // Check if bits 7-9 are set (896 = 0b1110000000)
      expect(bitmap & 896n).to.equal(896n);
    });

    it("Should allow multiple vaults to have independent parameters", async function () {
      // Vault 1 sets parameters
      await executeOnStrategy(vault1Contract, user1, "setRangeParameters", [600, 400, 120, 80]);

      // Vault 2 sets different parameters
      await executeOnStrategy(vault2Contract, user2, "setRangeParameters", [300, 300, 100, 100]);

      // Check values are independent
      expect(await strategy.getTargetRangeUpper(vault1Address)).to.equal(600);
      expect(await strategy.getTargetRangeUpper(vault2Address)).to.equal(300);
    });
  });

  describe("Reset Functions", function () {
    it("Should reset to template defaults", async function () {
      // Select template
      await executeOnStrategy(vault1Contract, user1, "selectTemplate", [Template.Conservative]);

      // Set custom parameters
      await executeOnStrategy(vault1Contract, user1, "setRangeParameters", [1000, 1000, 200, 200]);

      // Reset to template
      await executeOnStrategy(vault1Contract, user1, "resetToTemplate", []);

      // Check values returned to template defaults
      expect(await strategy.getTargetRangeUpper(vault1Address)).to.equal(CONS_TARGET_RANGE_UPPER);

      // Check bitmap was cleared
      const bitmap = await strategy.customizationBitmap(vault1Address);
      expect(bitmap).to.equal(0n);
    });

    it("Should reset all parameters to moderate defaults", async function () {
      // Select template and set custom values
      await executeOnStrategy(vault1Contract, user1, "selectTemplate", [Template.Conservative]);
      await executeOnStrategy(vault1Contract, user1, "setRangeParameters", [1000, 1000, 200, 200]);

      // Reset all
      await executeOnStrategy(vault1Contract, user1, "resetAll", []);

      // Check template was reset to None
      expect(await strategy.selectedTemplate(vault1Address)).to.equal(Template.None);

      // Check values returned to moderate defaults
      expect(await strategy.getTargetRangeUpper(vault1Address)).to.equal(MOD_TARGET_RANGE_UPPER);

      // Check bitmap was cleared
      const bitmap = await strategy.customizationBitmap(vault1Address);
      expect(bitmap).to.equal(0n);
    });
  });

  describe("Admin Functions", function () {
    it("Should return correct version", async function () {
      const version = await strategy.getVersion();
      expect(version).to.equal("1.1.0");
    });
  });
});
