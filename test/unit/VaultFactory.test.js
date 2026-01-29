const { expect } = require("chai");
const { ethers } = require('hardhat');

describe("VaultFactory - 2.0.0", function() {
  let VaultFactory;
  let PositionVault;
  let UniversalRouterValidator;
  let UniswapV3PositionValidator;
  let MockUniversalRouter;
  let MockNonfungiblePositionManager;
  let factory;
  let router;
  let positionManager;
  let swapValidator;
  let liquidityValidator;
  let permit2Address;
  let owner;
  let user1;
  let user2;

  beforeEach(async function() {
    // Get signers
    [owner, user1, user2] = await ethers.getSigners();

    // Deploy mock Universal Router
    MockUniversalRouter = await ethers.getContractFactory("MockUniversalRouter");
    router = await MockUniversalRouter.deploy();
    await router.waitForDeployment();

    // Deploy mock NonfungiblePositionManager
    MockNonfungiblePositionManager = await ethers.getContractFactory("MockNonfungiblePositionManager");
    positionManager = await MockNonfungiblePositionManager.deploy();
    await positionManager.waitForDeployment();

    // Use canonical Uniswap address for permit2
    permit2Address = "0x000000000022D473030F116dDEE9F6B43aC78BA3";

    // Deploy validators
    UniversalRouterValidator = await ethers.getContractFactory("UniversalRouterValidator");
    swapValidator = await UniversalRouterValidator.deploy();
    await swapValidator.waitForDeployment();

    UniswapV3PositionValidator = await ethers.getContractFactory("UniswapV3PositionValidator");
    liquidityValidator = await UniswapV3PositionValidator.deploy();
    await liquidityValidator.waitForDeployment();

    // Deploy the PositionVault contract first (we need its bytecode for the factory)
    PositionVault = await ethers.getContractFactory("PositionVault");

    // Deploy the VaultFactory contract with owner and permit2 (v2.0.0)
    VaultFactory = await ethers.getContractFactory("VaultFactory");
    factory = await VaultFactory.deploy(
      owner.address,
      permit2Address
    );
    await factory.waitForDeployment();

    // Register validators with factory
    await factory.setSwapValidator(await router.getAddress(), await swapValidator.getAddress());
    await factory.setLiquidityValidator(await positionManager.getAddress(), await liquidityValidator.getAddress());
  });

  describe("Constructor", function() {
    it("should reject zero owner address", async function() {
      await expect(
        VaultFactory.deploy(
          ethers.ZeroAddress,
          permit2Address
        )
      ).to.be.revertedWithCustomError(VaultFactory, "OwnableInvalidOwner");
    });

    it("should reject zero permit2 address", async function() {
      await expect(
        VaultFactory.deploy(
          owner.address,
          ethers.ZeroAddress
        )
      ).to.be.revertedWith("VaultFactory: zero permit2 address");
    });

    it("should store immutable addresses correctly", async function() {
      expect(await factory.permit2()).to.equal(permit2Address);
    });
  });

  describe("Validator Registry", function() {
    it("should allow owner to set swap validator", async function() {
      const newRouter = user1.address;
      const newValidator = user2.address;

      await expect(factory.setSwapValidator(newRouter, newValidator))
        .to.emit(factory, "SwapValidatorUpdated")
        .withArgs(newRouter, newValidator);

      expect(await factory.swapValidators(newRouter)).to.equal(newValidator);
    });

    it("should allow owner to set liquidity validator", async function() {
      const newManager = user1.address;
      const newValidator = user2.address;

      await expect(factory.setLiquidityValidator(newManager, newValidator))
        .to.emit(factory, "LiquidityValidatorUpdated")
        .withArgs(newManager, newValidator);

      expect(await factory.liquidityValidators(newManager)).to.equal(newValidator);
    });

    it("should allow owner to remove swap validator by setting to zero", async function() {
      const routerAddress = await router.getAddress();

      await factory.setSwapValidator(routerAddress, ethers.ZeroAddress);
      expect(await factory.swapValidators(routerAddress)).to.equal(ethers.ZeroAddress);
    });

    it("should allow owner to remove liquidity validator by setting to zero", async function() {
      const positionManagerAddress = await positionManager.getAddress();

      await factory.setLiquidityValidator(positionManagerAddress, ethers.ZeroAddress);
      expect(await factory.liquidityValidators(positionManagerAddress)).to.equal(ethers.ZeroAddress);
    });

    it("should reject non-owner setting swap validator", async function() {
      await expect(
        factory.connect(user1).setSwapValidator(user2.address, user2.address)
      ).to.be.revertedWithCustomError(factory, "OwnableUnauthorizedAccount");
    });

    it("should reject non-owner setting liquidity validator", async function() {
      await expect(
        factory.connect(user1).setLiquidityValidator(user2.address, user2.address)
      ).to.be.revertedWithCustomError(factory, "OwnableUnauthorizedAccount");
    });
  });

  describe("Vault Creation", function() {
    it("should create a vault with the correct parameters", async function() {
      // Create a vault
      const tx = await factory.connect(user1).createVault("My First Vault");
      const receipt = await tx.wait();

      // Extract the vault address from the event
      const vaultCreatedEvent = receipt.logs.find(
        log => log.fragment && log.fragment.name === 'VaultCreated'
      );
      const vaultAddress = vaultCreatedEvent.args[1]; // Second arg is vault address

      // Verify the vault was created correctly
      const userVaults = await factory.getVaults(user1.address);
      expect(userVaults.length).to.equal(1);
      expect(userVaults[0]).to.equal(vaultAddress);

      // Verify vault info
      const vaultInfo = await factory.getVaultInfo(vaultAddress);
      expect(vaultInfo[0]).to.equal(user1.address); // owner
      expect(vaultInfo[1]).to.equal("My First Vault"); // name
      expect(vaultInfo[2]).to.be.gt(0); // creation time
      expect(vaultInfo[3]).to.be.gt(0); // creation block

      // Verify the vault contract has the correct owner and factory
      const vault = await ethers.getContractAt("PositionVault", vaultAddress);
      expect(await vault.owner()).to.equal(user1.address);
      expect(await vault.permit2()).to.equal(permit2Address);
      expect(await vault.factory()).to.equal(await factory.getAddress());
    });

    it("should allow a user to create multiple vaults", async function() {
      // Create first vault
      let tx = await factory.connect(user1).createVault("Vault 1");
      let receipt = await tx.wait();
      const vault1Address = receipt.logs.find(
        log => log.fragment && log.fragment.name === 'VaultCreated'
      ).args[1];

      // Create second vault
      tx = await factory.connect(user1).createVault("Vault 2");
      receipt = await tx.wait();
      const vault2Address = receipt.logs.find(
        log => log.fragment && log.fragment.name === 'VaultCreated'
      ).args[1];

      // Verify both vaults exist
      const userVaults = await factory.getVaults(user1.address);
      expect(userVaults.length).to.equal(2);
      expect(userVaults[0]).to.equal(vault1Address);
      expect(userVaults[1]).to.equal(vault2Address);

      // Verify vault count
      expect(await factory.getVaultCount(user1.address)).to.equal(2);
    });

    it("should reject vault creation with empty name", async function() {
      await expect(
        factory.connect(user1).createVault("")
      ).to.be.revertedWith("VaultFactory: vault name cannot be empty");
    });
  });

  describe("Vault Management", function() {
    let vault1Address;

    beforeEach(async function() {
      // Create a vault for testing
      const tx = await factory.connect(user1).createVault("Original Name");
      const receipt = await tx.wait();
      vault1Address = receipt.logs.find(
        log => log.fragment && log.fragment.name === 'VaultCreated'
      ).args[1];
    });

    it("should allow owner to update vault name", async function() {
      await factory.connect(user1).updateVaultName(vault1Address, "New Name");

      const vaultInfo = await factory.getVaultInfo(vault1Address);
      expect(vaultInfo[1]).to.equal("New Name");
    });

    it("should reject name update from non-owner", async function() {
      await expect(
        factory.connect(user2).updateVaultName(vault1Address, "Hacked Name")
      ).to.be.revertedWith("VaultFactory: not vault owner");
    });

    it("should reject empty names on update", async function() {
      await expect(
        factory.connect(user1).updateVaultName(vault1Address, "")
      ).to.be.revertedWith("VaultFactory: vault name cannot be empty");
    });

    it("should verify vault addresses correctly", async function() {
      // Check valid vault
      let [isVault, vaultOwner] = await factory.isVault(vault1Address);
      expect(isVault).to.be.true;
      expect(vaultOwner).to.equal(user1.address);

      // Check invalid vault
      [isVault, vaultOwner] = await factory.isVault(ethers.ZeroAddress);
      expect(isVault).to.be.false;
      expect(vaultOwner).to.equal(ethers.ZeroAddress);
    });
  });

  describe("Validation Functions", function() {
    let vaultAddress;

    beforeEach(async function() {
      // Create a vault for testing
      const tx = await factory.connect(user1).createVault("Test Vault");
      const receipt = await tx.wait();
      vaultAddress = receipt.logs.find(
        log => log.fragment && log.fragment.name === 'VaultCreated'
      ).args[1];
    });

    it("should reject validateSwap with unregistered router", async function() {
      const unknownRouter = user2.address;
      const mockCalldata = "0x1234567890";

      await expect(
        factory.validateSwap(unknownRouter, mockCalldata, vaultAddress)
      ).to.be.revertedWith("VaultFactory: no validator for router");
    });

    it("should reject validateMint with unregistered position manager", async function() {
      const unknownManager = user2.address;
      const mockCalldata = "0x1234567890";

      await expect(
        factory.validateMint(unknownManager, mockCalldata, vaultAddress)
      ).to.be.revertedWith("VaultFactory: no validator for position manager");
    });

    it("should reject validateIncreaseLiquidity with unregistered position manager", async function() {
      const unknownManager = user2.address;
      const mockCalldata = "0x1234567890";

      await expect(
        factory.validateIncreaseLiquidity(unknownManager, mockCalldata, vaultAddress)
      ).to.be.revertedWith("VaultFactory: no validator for position manager");
    });

    it("should reject validateDecreaseLiquidity with unregistered position manager", async function() {
      const unknownManager = user2.address;
      const mockCalldata = "0x1234567890";

      await expect(
        factory.validateDecreaseLiquidity(unknownManager, mockCalldata, vaultAddress)
      ).to.be.revertedWith("VaultFactory: no validator for position manager");
    });

    it("should reject validateCollect with unregistered position manager", async function() {
      const unknownManager = user2.address;
      const mockCalldata = "0x1234567890";

      await expect(
        factory.validateCollect(unknownManager, mockCalldata, vaultAddress)
      ).to.be.revertedWith("VaultFactory: no validator for position manager");
    });

    it("should reject validateBurn with unregistered position manager", async function() {
      const unknownManager = user2.address;
      const mockCalldata = "0x1234567890";

      await expect(
        factory.validateBurn(unknownManager, mockCalldata, vaultAddress)
      ).to.be.revertedWith("VaultFactory: no validator for position manager");
    });
  });

  describe("Global Registry", function() {
    it("should track all created vaults", async function() {
      // Create vaults from different users
      await factory.connect(user1).createVault("User1 Vault 1");
      await factory.connect(user1).createVault("User1 Vault 2");
      await factory.connect(user2).createVault("User2 Vault");

      // Check total count
      expect(await factory.getTotalVaultCount()).to.equal(3);
    });
  });

  describe("Version", function() {
    it("should return the correct version", async function() {
      expect(await factory.getVersion()).to.equal("2.0.0");
    });
  });
});
