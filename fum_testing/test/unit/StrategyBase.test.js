const { expect } = require("chai");
const { ethers } = require('hardhat');

/**
 * Tests for StrategyBase functionality (shared by all strategy contracts)
 * Uses BabyStepsStrategy as the concrete implementation since StrategyBase is abstract
 */
describe("StrategyBase", function () {
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

  // Template constants (using uint8 values)
  const TEMPLATE_NONE = 0;
  const TEMPLATE_CONSERVATIVE = 1;
  const TEMPLATE_MODERATE = 2;
  const TEMPLATE_AGGRESSIVE = 3;

  // Strategy function interface for encoding calls
  const strategyInterface = new ethers.Interface([
    "function selectTemplate(uint8 template)",
    "function setRangeParameters(uint16 upperRange, uint16 lowerRange)",
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

    // Deploy VaultFactory with owner and permit2 (v2.0.0)
    const VaultFactory = await ethers.getContractFactory("VaultFactory");
    factory = await VaultFactory.deploy(
      owner.address,
      "0x000000000022D473030F116dDEE9F6B43aC78BA3"  // permit2
    );
    await factory.waitForDeployment();

    // Deploy BabyStepsStrategy (concrete implementation of StrategyBase)
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
  });

  describe("Authorization", function() {
    it("Should allow vault owner to authorize their vault", async function() {
      // user1 (vault owner) authorizes vault1
      await strategy.connect(user1).authorizeVault(vault1Address);
      expect(await strategy.authorizedVaults(vault1Address)).to.equal(true);
    });

    it("Should emit VaultAuthorized event on authorization", async function() {
      await expect(strategy.connect(user1).authorizeVault(vault1Address))
        .to.emit(strategy, "VaultAuthorized")
        .withArgs(vault1Address, true);
    });

    it("Should allow vault owner to deauthorize their vault", async function() {
      // First authorize
      await strategy.connect(user1).authorizeVault(vault1Address);
      expect(await strategy.authorizedVaults(vault1Address)).to.equal(true);

      // Then deauthorize
      await strategy.connect(user1).deauthorizeVault(vault1Address);
      expect(await strategy.authorizedVaults(vault1Address)).to.equal(false);
    });

    it("Should emit VaultAuthorized event on deauthorization", async function() {
      await strategy.connect(user1).authorizeVault(vault1Address);

      await expect(strategy.connect(user1).deauthorizeVault(vault1Address))
        .to.emit(strategy, "VaultAuthorized")
        .withArgs(vault1Address, false);
    });

    it("Should fail when non-owner tries to authorize someone else's vault", async function() {
      // user2 (NOT the vault owner) tries to authorize user1's vault
      await expect(
        strategy.connect(user2).authorizeVault(vault1Address)
      ).to.be.revertedWith("StrategyBase: caller is not vault owner");
    });

    it("Should fail when non-owner tries to deauthorize someone else's vault", async function() {
      // First authorize properly
      await strategy.connect(user1).authorizeVault(vault1Address);

      // user2 tries to deauthorize vault1 (owned by user1)
      await expect(
        strategy.connect(user2).deauthorizeVault(vault1Address)
      ).to.be.revertedWith("StrategyBase: caller is not vault owner");
    });

    it("Should fail when authorizing zero address", async function() {
      await expect(
        strategy.connect(user1).authorizeVault(ethers.ZeroAddress)
      ).to.be.revertedWith("StrategyBase: zero vault address");
    });

    it("Should fail when unauthorized vault tries to set parameters", async function() {
      // vault1 is NOT authorized - try to set parameters
      const data = strategyInterface.encodeFunctionData("setRangeParameters", [600, 400]);
      await expect(
        vault1Contract.connect(user1).execute([strategyAddress], [data])
      ).to.be.revertedWith("PositionVault: transaction failed");
    });

    it("Should fail when unauthorized vault tries to select template", async function() {
      // vault1 is NOT authorized - try to select template
      const data = strategyInterface.encodeFunctionData("selectTemplate", [TEMPLATE_CONSERVATIVE]);
      await expect(
        vault1Contract.connect(user1).execute([strategyAddress], [data])
      ).to.be.revertedWith("PositionVault: transaction failed");
    });

    it("Should allow authorized vault to set parameters", async function() {
      // Authorize first
      await strategy.connect(user1).authorizeVault(vault1Address);

      // Now should succeed
      await executeOnStrategy(vault1Contract, user1, "setRangeParameters", [600, 400]);

      // Verify parameter was set
      expect(await strategy.getTargetRangeUpper(vault1Address)).to.equal(600);
    });

    it("Should fail authorizeVault when target has no owner() function", async function() {
      // user2 is an EOA — staticcall succeeds with empty data, fails the data.length == 32 check
      await expect(
        strategy.connect(user1).authorizeVault(user2.address)
      ).to.be.revertedWith("StrategyBase: failed to get vault owner");
    });

    it("Should fail deauthorizeVault when target has no owner() function", async function() {
      await expect(
        strategy.connect(user1).deauthorizeVault(user2.address)
      ).to.be.revertedWith("StrategyBase: failed to get vault owner");
    });

    it("Should fail selectTemplate when called directly by non-authorized address", async function() {
      // Direct call (not via vault.execute) exercises the onlyAuthorizedVault failure branch
      await expect(
        strategy.connect(user2).selectTemplate(TEMPLATE_CONSERVATIVE)
      ).to.be.revertedWith("StrategyBase: caller is not an authorized vault");
    });
  });

  describe("Template Selection", function () {
    beforeEach(async function() {
      // Authorize vaults for template tests
      await strategy.connect(user1).authorizeVault(vault1Address);
      await strategy.connect(user2).authorizeVault(vault2Address);
    });

    it("Should set default template to None (0)", async function () {
      const template = await strategy.selectedTemplate(vault1Address);
      expect(template).to.equal(TEMPLATE_NONE);
    });

    it("Should select template", async function () {
      await executeOnStrategy(vault1Contract, user1, "selectTemplate", [TEMPLATE_CONSERVATIVE]);
      const template = await strategy.selectedTemplate(vault1Address);
      expect(template).to.equal(TEMPLATE_CONSERVATIVE);
    });

    it("Should emit TemplateSelected event", async function () {
      const data = strategyInterface.encodeFunctionData("selectTemplate", [TEMPLATE_MODERATE]);

      await expect(vault1Contract.connect(user1).execute([strategyAddress], [data]))
        .to.emit(strategy, "TemplateSelected")
        .withArgs(vault1Address, TEMPLATE_MODERATE);
    });

    it("Should clear customization bitmap when selecting non-None template", async function () {
      // First set a custom parameter
      await executeOnStrategy(vault1Contract, user1, "setRangeParameters", [1000, 1000]);

      // Verify bitmap is non-zero
      const bitmapBefore = await strategy.customizationBitmap(vault1Address);
      expect(bitmapBefore).to.not.equal(0n);

      // Select a template
      await executeOnStrategy(vault1Contract, user1, "selectTemplate", [TEMPLATE_MODERATE]);

      // Verify bitmap is cleared
      const bitmapAfter = await strategy.customizationBitmap(vault1Address);
      expect(bitmapAfter).to.equal(0n);
    });

    it("Should NOT clear customization bitmap when selecting None template", async function () {
      // First set a custom parameter
      await executeOnStrategy(vault1Contract, user1, "setRangeParameters", [1000, 1000]);

      // Verify bitmap is non-zero
      const bitmapBefore = await strategy.customizationBitmap(vault1Address);
      expect(bitmapBefore).to.not.equal(0n);

      // Select None template
      await executeOnStrategy(vault1Contract, user1, "selectTemplate", [TEMPLATE_NONE]);

      // Verify bitmap is NOT cleared
      const bitmapAfter = await strategy.customizationBitmap(vault1Address);
      expect(bitmapAfter).to.equal(bitmapBefore);
    });

    it("Should allow different vaults to have different templates", async function () {
      await executeOnStrategy(vault1Contract, user1, "selectTemplate", [TEMPLATE_CONSERVATIVE]);
      await executeOnStrategy(vault2Contract, user2, "selectTemplate", [TEMPLATE_AGGRESSIVE]);

      expect(await strategy.selectedTemplate(vault1Address)).to.equal(TEMPLATE_CONSERVATIVE);
      expect(await strategy.selectedTemplate(vault2Address)).to.equal(TEMPLATE_AGGRESSIVE);
    });
  });

  describe("Customization Bitmap", function () {
    beforeEach(async function() {
      await strategy.connect(user1).authorizeVault(vault1Address);
    });

    it("Should start with zero bitmap", async function () {
      const bitmap = await strategy.customizationBitmap(vault1Address);
      expect(bitmap).to.equal(0n);
    });

    it("Should update bitmap when setting parameters", async function () {
      await executeOnStrategy(vault1Contract, user1, "setRangeParameters", [600, 400]);

      const bitmap = await strategy.customizationBitmap(vault1Address);
      // Bits 0-1 should be set (3 = 0b11)
      expect(bitmap & 3n).to.equal(3n);
    });

    it("Should emit CustomizationUpdated event", async function () {
      const data = strategyInterface.encodeFunctionData("setRangeParameters", [600, 400]);

      await expect(vault1Contract.connect(user1).execute([strategyAddress], [data]))
        .to.emit(strategy, "CustomizationUpdated");
    });
  });

  describe("Reset Functions", function () {
    beforeEach(async function() {
      await strategy.connect(user1).authorizeVault(vault1Address);
    });

    describe("resetToTemplate", function () {
      it("Should clear customization bitmap", async function () {
        // Set custom parameters
        await executeOnStrategy(vault1Contract, user1, "setRangeParameters", [1000, 1000]);

        // Verify bitmap is non-zero
        const bitmapBefore = await strategy.customizationBitmap(vault1Address);
        expect(bitmapBefore).to.not.equal(0n);

        // Reset to template
        await executeOnStrategy(vault1Contract, user1, "resetToTemplate", []);

        // Check bitmap was cleared
        const bitmapAfter = await strategy.customizationBitmap(vault1Address);
        expect(bitmapAfter).to.equal(0n);
      });

      it("Should NOT change selected template", async function () {
        // Select template
        await executeOnStrategy(vault1Contract, user1, "selectTemplate", [TEMPLATE_CONSERVATIVE]);

        // Set custom parameters
        await executeOnStrategy(vault1Contract, user1, "setRangeParameters", [1000, 1000]);

        // Reset to template
        await executeOnStrategy(vault1Contract, user1, "resetToTemplate", []);

        // Template should still be Conservative
        expect(await strategy.selectedTemplate(vault1Address)).to.equal(TEMPLATE_CONSERVATIVE);
      });

      it("Should emit ParameterUpdated and CustomizationUpdated events", async function () {
        const data = strategyInterface.encodeFunctionData("resetToTemplate", []);

        await expect(vault1Contract.connect(user1).execute([strategyAddress], [data]))
          .to.emit(strategy, "ParameterUpdated")
          .withArgs(vault1Address, "resetToTemplate")
          .and.to.emit(strategy, "CustomizationUpdated")
          .withArgs(vault1Address, 0);
      });
    });

    describe("resetAll", function () {
      it("Should clear customization bitmap", async function () {
        // Set custom parameters
        await executeOnStrategy(vault1Contract, user1, "setRangeParameters", [1000, 1000]);

        // Reset all
        await executeOnStrategy(vault1Contract, user1, "resetAll", []);

        // Check bitmap was cleared
        const bitmap = await strategy.customizationBitmap(vault1Address);
        expect(bitmap).to.equal(0n);
      });

      it("Should reset template to None", async function () {
        // Select template
        await executeOnStrategy(vault1Contract, user1, "selectTemplate", [TEMPLATE_CONSERVATIVE]);

        // Reset all
        await executeOnStrategy(vault1Contract, user1, "resetAll", []);

        // Template should be reset to None
        expect(await strategy.selectedTemplate(vault1Address)).to.equal(TEMPLATE_NONE);
      });

      it("Should emit TemplateSelected, ParameterUpdated, and CustomizationUpdated events", async function () {
        const data = strategyInterface.encodeFunctionData("resetAll", []);

        await expect(vault1Contract.connect(user1).execute([strategyAddress], [data]))
          .to.emit(strategy, "TemplateSelected")
          .withArgs(vault1Address, TEMPLATE_NONE)
          .and.to.emit(strategy, "ParameterUpdated")
          .withArgs(vault1Address, "resetAll")
          .and.to.emit(strategy, "CustomizationUpdated")
          .withArgs(vault1Address, 0);
      });
    });
  });

  describe("Vault Independence", function () {
    beforeEach(async function() {
      await strategy.connect(user1).authorizeVault(vault1Address);
      await strategy.connect(user2).authorizeVault(vault2Address);
    });

    it("Should maintain independent authorization status per vault", async function () {
      // Deauthorize vault1
      await strategy.connect(user1).deauthorizeVault(vault1Address);

      // vault1 should be deauthorized, vault2 should still be authorized
      expect(await strategy.authorizedVaults(vault1Address)).to.equal(false);
      expect(await strategy.authorizedVaults(vault2Address)).to.equal(true);
    });

    it("Should maintain independent templates per vault", async function () {
      await executeOnStrategy(vault1Contract, user1, "selectTemplate", [TEMPLATE_CONSERVATIVE]);
      await executeOnStrategy(vault2Contract, user2, "selectTemplate", [TEMPLATE_AGGRESSIVE]);

      expect(await strategy.selectedTemplate(vault1Address)).to.equal(TEMPLATE_CONSERVATIVE);
      expect(await strategy.selectedTemplate(vault2Address)).to.equal(TEMPLATE_AGGRESSIVE);
    });

    it("Should maintain independent customization bitmaps per vault", async function () {
      // vault1 customizes range parameters (bits 0-1)
      await executeOnStrategy(vault1Contract, user1, "setRangeParameters", [600, 400]);

      // vault2 has no customizations
      const bitmap1 = await strategy.customizationBitmap(vault1Address);
      const bitmap2 = await strategy.customizationBitmap(vault2Address);

      expect(bitmap1).to.not.equal(0n);
      expect(bitmap2).to.equal(0n);
    });
  });
});
