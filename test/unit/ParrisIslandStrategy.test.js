import { expect } from "chai";
import { ethers } from "hardhat";

describe("ParrisIslandStrategy", function () {
  let strategy;
  let owner;
  let user1;
  let user2;
  let vault1;
  let vault2;

  // Constants for template values
  const CONS_TARGET_RANGE_UPPER = 300;
  const MOD_TARGET_RANGE_UPPER = 500;
  const AGG_TARGET_RANGE_UPPER = 800;

  const CONS_REBALANCE_THRESHOLD_UPPER = 150;
  const MOD_MAX_POSITION_SIZE_PERCENT = 3000;
  const AGG_MIN_POSITION_SIZE = ethers.parseEther("50");

  // Enum values
  const Template = {
    None: 0,
    Conservative: 1,
    Moderate: 2,
    Aggressive: 3
  };

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

  beforeEach(async function () {
    [owner, user1, user2, vault1, vault2] = await ethers.getSigners();

    const StrategyFactory = await ethers.getContractFactory("ParrisIslandStrategy");
    strategy = await StrategyFactory.deploy();
    await strategy.waitForDeployment();

    // Authorize vault1 and vault2 as valid vaults
    await strategy.authorizeVault(vault1.address);
    await strategy.authorizeVault(vault2.address);
  });

  describe("Authorization", function() {
    it("Should allow owner to authorize vaults", async function() {
      const newVault = user1.address;
      await strategy.authorizeVault(newVault);
      expect(await strategy.authorizedVaults(newVault)).to.equal(true);
    });

    it("Should allow owner to deauthorize vaults", async function() {
      await strategy.deauthorizeVault(vault1.address);
      expect(await strategy.authorizedVaults(vault1.address)).to.equal(false);
    });

    it("Should fail when unauthorized vault tries to set parameters", async function() {
      await expect(
        strategy.connect(user1).setRangeParameters(600, 400, 120, 80)
      ).to.be.revertedWith("ParrisIslandStrategy: caller is not an authorized vault");
    });

    it("Should fail when unauthorized vault tries to select template", async function() {
      await expect(
        strategy.connect(user1).selectTemplate(Template.Conservative)
      ).to.be.revertedWith("ParrisIslandStrategy: caller is not an authorized vault");
    });
  });

  describe("Template Selection", function () {
    it("Should set default template to None", async function () {
      const template = await strategy.selectedTemplate(vault1.address);
      expect(template).to.equal(Template.None);
    });

    it("Should select Conservative template", async function () {
      await strategy.connect(vault1).selectTemplate(Template.Conservative);
      const template = await strategy.selectedTemplate(vault1.address);
      expect(template).to.equal(Template.Conservative);
    });

    it("Should clear customization bitmap when selecting template", async function () {
      // First set a custom parameter
      await strategy.connect(vault1).setRangeParameters(1000, 1000, 100, 100);

      // Verify bitmap is non-zero
      const bitmapBefore = await strategy.customizationBitmap(vault1.address);
      expect(bitmapBefore).to.not.equal(0n);

      // Select a template
      await strategy.connect(vault1).selectTemplate(Template.Moderate);

      // Verify bitmap is cleared
      const bitmapAfter = await strategy.customizationBitmap(vault1.address);
      expect(bitmapAfter).to.equal(0n);
    });
  });

  describe("Parameter Getters", function () {
    it("Should return moderate template values by default", async function () {
      const rangeUpper = await strategy.getTargetRangeUpper(vault1.address);
      expect(rangeUpper).to.equal(MOD_TARGET_RANGE_UPPER);

      const maxPositionSize = await strategy.getMaxPositionSizePercent(vault1.address);
      expect(maxPositionSize).to.equal(MOD_MAX_POSITION_SIZE_PERCENT);
    });

    it("Should return conservative template values when selected", async function () {
      await strategy.connect(vault1).selectTemplate(Template.Conservative);

      const rangeUpper = await strategy.getTargetRangeUpper(vault1.address);
      expect(rangeUpper).to.equal(CONS_TARGET_RANGE_UPPER);

      const rebalanceThresholdUpper = await strategy.getRebalanceThresholdUpper(vault1.address);
      expect(rebalanceThresholdUpper).to.equal(CONS_REBALANCE_THRESHOLD_UPPER);

      const oracleSource = await strategy.getOracleSource(vault1.address);
      expect(oracleSource).to.equal(OracleSource.Chainlink);
    });

    it("Should return aggressive template values when selected", async function () {
      await strategy.connect(vault1).selectTemplate(Template.Aggressive);

      const rangeUpper = await strategy.getTargetRangeUpper(vault1.address);
      expect(rangeUpper).to.equal(AGG_TARGET_RANGE_UPPER);

      const minPositionSize = await strategy.getMinPositionSize(vault1.address);
      expect(minPositionSize).to.equal(AGG_MIN_POSITION_SIZE);

      const platformCriteria = await strategy.getPlatformSelectionCriteria(vault1.address);
      expect(platformCriteria).to.equal(PlatformSelectionCriteria.HighestRewards);
    });

    it("Should return customized values when parameters are customized", async function () {
      // Set custom range parameters
      const customRangeUpper = 1234;
      const customRangeLower = 2345;

      // First select template
      await strategy.connect(vault1).selectTemplate(Template.Conservative);

      // Then customize parameters
      await strategy.connect(vault1).setRangeParameters(
        customRangeUpper, customRangeLower, 100, 100
      );

      // Should return custom values
      const rangeUpper = await strategy.getTargetRangeUpper(vault1.address);
      const rangeLower = await strategy.getTargetRangeLower(vault1.address);

      expect(rangeUpper).to.equal(customRangeUpper);
      expect(rangeLower).to.equal(customRangeLower);
    });

    it("Should return all parameters with template fallbacks", async function () {
      await strategy.connect(vault1).selectTemplate(Template.Moderate);

      // Set just one custom parameter
      const customSlippage = 75;
      await strategy.connect(vault1).setRiskParameters(
        customSlippage, 1500, 8000
      );

      // Get all parameters
      const params = await strategy.getAllParameters(vault1.address);

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

      await strategy.connect(vault1).setRangeParameters(
        upperRange, lowerRange, upperThreshold, lowerThreshold
      );

      // Check values were set
      expect(await strategy.getTargetRangeUpper(vault1.address)).to.equal(upperRange);
      expect(await strategy.getTargetRangeLower(vault1.address)).to.equal(lowerRange);
      expect(await strategy.getRebalanceThresholdUpper(vault1.address)).to.equal(upperThreshold);
      expect(await strategy.getRebalanceThresholdLower(vault1.address)).to.equal(lowerThreshold);

      // Check bitmap was updated
      const bitmap = await strategy.customizationBitmap(vault1.address);
      // Check if bits 0-3 are set (15 = 0b1111)
      expect(bitmap & 15n).to.equal(15n);
    });

    it("Should set fee parameters", async function () {
      const reinvest = true;
      const trigger = ethers.parseEther("100");
      const ratio = 7500;

      await strategy.connect(vault1).setFeeParameters(
        reinvest, trigger, ratio
      );

      // Check values were set
      expect(await strategy.getFeeReinvestment(vault1.address)).to.equal(reinvest);
      expect(await strategy.getReinvestmentTrigger(vault1.address)).to.equal(trigger);
      expect(await strategy.getReinvestmentRatio(vault1.address)).to.equal(ratio);

      // Check bitmap was updated
      const bitmap = await strategy.customizationBitmap(vault1.address);
      // Check if bits 4-6 are set (112 = 0b1110000)
      expect(bitmap & 112n).to.equal(112n);
    });

    it("Should set risk parameters", async function () {
      const slippage = 40;
      const exitTrigger = 1200;
      const utilization = 7000;

      await strategy.connect(vault1).setRiskParameters(
        slippage, exitTrigger, utilization
      );

      // Check values were set
      expect(await strategy.getMaxSlippage(vault1.address)).to.equal(slippage);
      expect(await strategy.getEmergencyExitTrigger(vault1.address)).to.equal(exitTrigger);
      expect(await strategy.getMaxVaultUtilization(vault1.address)).to.equal(utilization);

      // Check bitmap was updated
      const bitmap = await strategy.customizationBitmap(vault1.address);
      // Check if bits 7-9 are set (896 = 0b1110000000)
      expect(bitmap & 896n).to.equal(896n);
    });

    it("Should allow multiple vaults to have independent parameters", async function () {
      // Vault 1 sets parameters
      await strategy.connect(vault1).setRangeParameters(600, 400, 120, 80);

      // Vault 2 sets different parameters
      await strategy.connect(vault2).setRangeParameters(300, 300, 100, 100);

      // Check values are independent
      expect(await strategy.getTargetRangeUpper(vault1.address)).to.equal(600);
      expect(await strategy.getTargetRangeUpper(vault2.address)).to.equal(300);
    });
  });

  describe("Reset Functions", function () {
    it("Should reset to template defaults", async function () {
      // Select template
      await strategy.connect(vault1).selectTemplate(Template.Conservative);

      // Set custom parameters
      await strategy.connect(vault1).setRangeParameters(1000, 1000, 200, 200);

      // Reset to template
      await strategy.connect(vault1).resetToTemplate();

      // Check values returned to template defaults
      expect(await strategy.getTargetRangeUpper(vault1.address)).to.equal(CONS_TARGET_RANGE_UPPER);

      // Check bitmap was cleared
      const bitmap = await strategy.customizationBitmap(vault1.address);
      expect(bitmap).to.equal(0n);
    });

    it("Should reset all parameters to moderate defaults", async function () {
      // Select template and set custom values
      await strategy.connect(vault1).selectTemplate(Template.Conservative);
      await strategy.connect(vault1).setRangeParameters(1000, 1000, 200, 200);

      // Reset all
      await strategy.connect(vault1).resetAll();

      // Check template was reset to None
      expect(await strategy.selectedTemplate(vault1.address)).to.equal(Template.None);

      // Check values returned to moderate defaults
      expect(await strategy.getTargetRangeUpper(vault1.address)).to.equal(MOD_TARGET_RANGE_UPPER);

      // Check bitmap was cleared
      const bitmap = await strategy.customizationBitmap(vault1.address);
      expect(bitmap).to.equal(0n);
    });
  });

  describe("Admin Functions", function () {
    it("Should return correct version", async function () {
      const version = await strategy.getVersion();
      expect(version).to.equal("1.0.0"); // Updated version
    });
  });
});
