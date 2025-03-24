const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("VaultFactory - 0.2.1", function() {
  let VaultFactory;
  let PositionVault;
  let factory;
  let owner;
  let user1;
  let user2;
  let strategyMock;

  beforeEach(async function() {
    // Get signers
    [owner, user1, user2, strategyMock] = await ethers.getSigners();

    // Deploy the PositionVault contract first (we need its bytecode for the factory)
    PositionVault = await ethers.getContractFactory("PositionVault");

    // Deploy the VaultFactory contract
    VaultFactory = await ethers.getContractFactory("VaultFactory");
    factory = await VaultFactory.deploy(owner.address);
    await factory.waitForDeployment();
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

      // Verify the vault contract has the correct owner
      const vault = await ethers.getContractAt("PositionVault", vaultAddress);
      expect(await vault.owner()).to.equal(user1.address);
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

  describe("Strategy Whitelisting", function() {
    it("should allow owner to whitelist strategies", async function() {
      await factory.connect(owner).setStrategyWhitelisting(strategyMock.address, true);

      expect(await factory.whitelistedStrategies(strategyMock.address)).to.be.true;

      const whitelistedStrategies = await factory.getWhitelistedStrategies();
      expect(whitelistedStrategies.length).to.equal(1);
      expect(whitelistedStrategies[0]).to.equal(strategyMock.address);
    });

    it("should allow owner to dewhitelist strategies", async function() {
      // First whitelist, then dewhitelist
      await factory.connect(owner).setStrategyWhitelisting(strategyMock.address, true);
      await factory.connect(owner).setStrategyWhitelisting(strategyMock.address, false);

      expect(await factory.whitelistedStrategies(strategyMock.address)).to.be.false;

      const whitelistedStrategies = await factory.getWhitelistedStrategies();
      expect(whitelistedStrategies.length).to.equal(0);
    });

    it("should reject whitelisting from non-owner", async function() {
      await expect(
        factory.connect(user1).setStrategyWhitelisting(strategyMock.address, true)
      ).to.be.reverted;  // Just check that it reverts without specifics
    });

    it("should auto-authorize whitelisted strategies for new vaults", async function() {
      // Whitelist a strategy
      await factory.connect(owner).setStrategyWhitelisting(strategyMock.address, true);

      // Create a vault
      const tx = await factory.connect(user1).createVault("Auto Strategy Vault");
      const receipt = await tx.wait();
      const vaultAddress = receipt.logs.find(
        log => log.fragment && log.fragment.name === 'VaultCreated'
      ).args[1];

      // Check that the strategy is authorized in the new vault
      const vault = await ethers.getContractAt("PositionVault", vaultAddress);
      expect(await vault.authorizedStrategies(strategyMock.address)).to.be.true;
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
});
