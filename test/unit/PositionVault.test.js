const { expect } = require("chai");
const { ethers } = require('hardhat');

describe("PositionVault - 0.3.2", function() {
  let PositionVault;
  let MockPositionNFT;
  let MockToken;
  let vault;
  let nft;
  let token;
  let owner;
  let user1;
  let user2;
  let strategyContract;
  let executorWallet;

  beforeEach(async function() {
    // Get signers
    [owner, user1, user2, strategyContract, executorWallet] = await ethers.getSigners();

    // Deploy the test contracts
    PositionVault = await ethers.getContractFactory("PositionVault");
    vault = await PositionVault.deploy(owner.address);
    await vault.waitForDeployment();

    // Deploy mock NFT contract
    MockPositionNFT = await ethers.getContractFactory("MockPositionNFT");
    nft = await MockPositionNFT.deploy(owner.address);
    await nft.waitForDeployment();

    // Deploy mock ERC20 token
    MockToken = await ethers.getContractFactory("MockERC20");
    token = await MockToken.deploy("Mock Token", "MOCK", 18);
    await token.waitForDeployment();

    // Mint some tokens to owner
    await token.mint(owner.address, ethers.parseEther("1000"));

    // Transfer some tokens to the vault
    await token.transfer(await vault.getAddress(), ethers.parseEther("100"));
  });

  // All existing tests remain the same

  // Add new tests for position tracking
  describe("Position ID Tracking", function() {
    // Use BigInt for token IDs to match contract return values
    const tokenIds = [BigInt(1), BigInt(2), BigInt(3)];

    beforeEach(async function() {
      // Create multiple position NFTs
      for (let i = 0; i < tokenIds.length; i++) {
        await nft.createPosition(
          owner.address,
          await token.getAddress(),
          ethers.ZeroAddress,
          3000,
          -10000,
          10000,
          1000000
        );

        // Approve vault to transfer the NFT
        await nft.approve(await vault.getAddress(), tokenIds[i]);
      }
    });

    it("should track position IDs correctly", async function() {
      const vaultAddress = await vault.getAddress();

      // Initial state should be empty
      let positionIds = await vault.getPositionIds();
      expect(positionIds).to.be.an('array').that.is.empty;

      // Transfer first NFT
      await nft["safeTransferFrom(address,address,uint256)"](
        owner.address,
        vaultAddress,
        tokenIds[0]
      );

      // Check position is tracked
      positionIds = await vault.getPositionIds();
      expect(positionIds.length).to.equal(1);
      expect(positionIds[0]).to.equal(tokenIds[0]);

      // Transfer second NFT
      await nft["safeTransferFrom(address,address,uint256)"](
        owner.address,
        vaultAddress,
        tokenIds[1]
      );

      // Check both positions are tracked - use BigInt-aware comparison
      positionIds = await vault.getPositionIds();
      expect(positionIds.length).to.equal(2);

      // Check each position ID individually
      expect(positionIds).to.deep.include(tokenIds[0]);
      expect(positionIds).to.deep.include(tokenIds[1]);
    });

    it("should handle position removal correctly", async function() {
      const vaultAddress = await vault.getAddress();

      // Transfer all NFTs to vault
      for (const id of tokenIds) {
        await nft["safeTransferFrom(address,address,uint256)"](
          owner.address,
          vaultAddress,
          id
        );
      }

      // Check all positions are tracked
      let positionIds = await vault.getPositionIds();
      expect(positionIds.length).to.equal(tokenIds.length);

      // Withdraw the middle position
      await vault.withdrawPosition(await nft.getAddress(), tokenIds[1], user1.address);

      // Check position tracking updated correctly - use BigInt comparison
      positionIds = await vault.getPositionIds();
      expect(positionIds.length).to.equal(tokenIds.length - 1);

      // Check each position individually
      expect(positionIds).to.deep.include(tokenIds[0]);
      expect(positionIds).to.deep.include(tokenIds[2]);
      expect(positionIds).to.not.deep.include(tokenIds[1]);

      // Verify NFT ownership
      expect(await nft.ownerOf(tokenIds[1])).to.equal(user1.address);
    });

    it("should handle removing all positions correctly", async function() {
      const vaultAddress = await vault.getAddress();

      // Transfer all NFTs to vault
      for (const id of tokenIds) {
        await nft["safeTransferFrom(address,address,uint256)"](
          owner.address,
          vaultAddress,
          id
        );
      }

      // Withdraw all positions
      for (const id of tokenIds) {
        await vault.withdrawPosition(await nft.getAddress(), id, user1.address);
      }

      // Check no positions remain
      const positionIds = await vault.getPositionIds();
      expect(positionIds).to.be.an('array').that.is.empty;
    });

    it("should maintain correct position tracking after multiple operations", async function() {
      const vaultAddress = await vault.getAddress();

      // Transfer NFTs 0 and 1
      await nft["safeTransferFrom(address,address,uint256)"](
        owner.address,
        vaultAddress,
        tokenIds[0]
      );

      await nft["safeTransferFrom(address,address,uint256)"](
        owner.address,
        vaultAddress,
        tokenIds[1]
      );

      // Withdraw NFT 0
      await vault.withdrawPosition(await nft.getAddress(), tokenIds[0], user1.address);

      // Add NFT 2
      await nft["safeTransferFrom(address,address,uint256)"](
        owner.address,
        vaultAddress,
        tokenIds[2]
      );

      // Check correct positions are tracked - use BigInt-aware comparison
      const positionIds = await vault.getPositionIds();
      expect(positionIds.length).to.equal(2);

      // Check each position individually
      expect(positionIds).to.deep.include(tokenIds[1]);
      expect(positionIds).to.deep.include(tokenIds[2]);
      expect(positionIds).to.not.deep.include(tokenIds[0]);
    });
  });

  // Test for executor management
  describe("Executor Management", function() {
    it("should set executor and emit ExecutorChanged event with authorization", async function() {
      // Initially executor should be zero address
      expect(await vault.executor()).to.equal(ethers.ZeroAddress);

      // Set executor
      const tx = await vault.setExecutor(executorWallet.address);
      
      // Check executor was set
      expect(await vault.executor()).to.equal(executorWallet.address);

      // Check event was emitted correctly
      await expect(tx)
        .to.emit(vault, "ExecutorChanged")
        .withArgs(executorWallet.address, true);
    });

    it("should remove executor and emit ExecutorChanged event with revocation", async function() {
      // First set an executor
      await vault.setExecutor(executorWallet.address);
      expect(await vault.executor()).to.equal(executorWallet.address);

      // Remove executor
      const tx = await vault.removeExecutor();
      
      // Check executor was cleared
      expect(await vault.executor()).to.equal(ethers.ZeroAddress);

      // Check event was emitted with the old executor address and false
      await expect(tx)
        .to.emit(vault, "ExecutorChanged")
        .withArgs(executorWallet.address, false);
    });

    it("should only allow owner to set executor", async function() {
      await expect(
        vault.connect(user1).setExecutor(executorWallet.address)
      ).to.be.revertedWith("PositionVault: caller is not the owner");
    });

    it("should only allow owner to remove executor", async function() {
      await vault.setExecutor(executorWallet.address);
      
      await expect(
        vault.connect(user1).removeExecutor()
      ).to.be.revertedWith("PositionVault: caller is not the owner");
    });

    it("should not allow setting zero address as executor", async function() {
      await expect(
        vault.setExecutor(ethers.ZeroAddress)
      ).to.be.revertedWith("PositionVault: zero executor address");
    });

    it("should allow executor to call execute function", async function() {
      // Set executor
      await vault.setExecutor(executorWallet.address);

      // Test execute function - using a simple call that should succeed
      const targets = [await token.getAddress()];
      const data = [token.interface.encodeFunctionData("transfer", [user1.address, 1])];

      // This should not revert (executor is authorized)
      await expect(vault.connect(executorWallet).execute(targets, data))
        .to.not.be.reverted;
    });

    it("should not allow unauthorized user to call execute function", async function() {
      // Don't set any executor, try with unauthorized user
      const targets = [await token.getAddress()];
      const data = [token.interface.encodeFunctionData("transfer", [user1.address, 1])];

      await expect(
        vault.connect(user1).execute(targets, data)
      ).to.be.revertedWith("PositionVault: caller is not authorized");
    });

    it("should always allow owner to call execute function", async function() {
      // Owner should be able to execute even without setting executor
      const targets = [await token.getAddress()];
      const data = [token.interface.encodeFunctionData("transfer", [user1.address, 1])];

      // This should not revert (owner is always authorized)
      await expect(vault.connect(owner).execute(targets, data))
        .to.not.be.reverted;
    });
  });

  // Test for contract version
  describe("Contract Version", function() {
    it("should return the correct version", async function() {
      expect(await vault.getVersion()).to.equal("0.3.2");
    });
  });
});
