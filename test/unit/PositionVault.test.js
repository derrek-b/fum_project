const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("PositionVault - 0.3.1", function() {
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

  // Test for contract version
  describe("Contract Version", function() {
    it("should return the correct version", async function() {
      expect(await vault.getVersion()).to.equal("0.3.1");
    });
  });
});
