const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("PositionVault - 0.2.0", function() {
  let PositionVault;
  let MockPositionNFT;
  let MockToken;
  let vault;
  let nft;
  let token;
  let owner;
  let user1;
  let user2;
  let strategy;

  beforeEach(async function() {
    // Get signers
    [owner, user1, user2, strategy] = await ethers.getSigners();

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

  describe("Basic Configuration", function() {
    it("should initialize with the correct owner", async function() {
      expect(await vault.owner()).to.equal(owner.address);
    });
  });

  describe("Strategy Authorization", function() {
    it("should allow owner to authorize strategies", async function() {
      await vault.setStrategyAuthorization(strategy.address, true);
      expect(await vault.authorizedStrategies(strategy.address)).to.be.true;

      // Check event emission
      await expect(vault.setStrategyAuthorization(strategy.address, true))
        .to.emit(vault, "StrategyAuthorized")
        .withArgs(strategy.address, true);
    });

    it("should allow owner to deauthorize strategies", async function() {
      // First authorize, then deauthorize
      await vault.setStrategyAuthorization(strategy.address, true);
      await vault.setStrategyAuthorization(strategy.address, false);

      expect(await vault.authorizedStrategies(strategy.address)).to.be.false;
    });

    it("should reject authorization changes from non-owner", async function() {
      await expect(
        vault.connect(user1).setStrategyAuthorization(strategy.address, true)
      ).to.be.revertedWith("PositionVault: caller is not authorized");
    });
  });

  describe("Transaction Execution", function() {
    // We'll use the ERC20 transfer as a test transaction
    const transferAmount = ethers.parseEther("10");
    let callData;

    beforeEach(async function() {
      // Create calldata for ERC20 transfer
      callData = token.interface.encodeFunctionData("transfer", [
        user1.address,
        transferAmount
      ]);
    });

    it("should allow owner to execute transactions", async function() {
      const initialBalance = await token.balanceOf(user1.address);

      // Execute transfer transaction
      await vault.execute(
        [await token.getAddress()],
        [callData]
      );

      // Check that transfer was successful
      const finalBalance = await token.balanceOf(user1.address);
      expect(finalBalance - initialBalance).to.equal(transferAmount);
    });

    it("should allow authorized strategies to execute transactions", async function() {
      // Authorize strategy
      await vault.setStrategyAuthorization(strategy.address, true);

      const initialBalance = await token.balanceOf(user1.address);

      // Execute transfer transaction from strategy
      await vault.connect(strategy).execute(
        [await token.getAddress()],
        [callData]
      );

      // Check that transfer was successful
      const finalBalance = await token.balanceOf(user1.address);
      expect(finalBalance - initialBalance).to.equal(transferAmount);
    });

    it("should reject execution from unauthorized callers", async function() {
      await expect(
        vault.connect(user1).execute(
          [await token.getAddress()],
          [callData]
        )
      ).to.be.revertedWith("PositionVault: caller is not authorized");
    });

    it("should handle multiple transactions in a batch", async function() {
      // Create two transfer transactions
      const callData1 = token.interface.encodeFunctionData("transfer", [
        user1.address,
        transferAmount
      ]);

      const callData2 = token.interface.encodeFunctionData("transfer", [
        user2.address,
        transferAmount
      ]);

      // Execute batch transaction
      await vault.execute(
        [await token.getAddress(), await token.getAddress()],
        [callData1, callData2]
      );

      // Check both transfers were successful
      expect(await token.balanceOf(user1.address)).to.equal(transferAmount);
      expect(await token.balanceOf(user2.address)).to.equal(transferAmount);
    });

    it("should revert all transactions if one fails", async function() {
      // Create one valid and one invalid transaction
      const validCallData = token.interface.encodeFunctionData("transfer", [
        user1.address,
        transferAmount
      ]);

      // Invalid calldata (wrong function signature)
      const invalidCallData = "0xdeadbeef";

      // Attempt to execute batch
      await expect(
        vault.execute(
          [await token.getAddress(), await token.getAddress()],
          [validCallData, invalidCallData]
        )
      ).to.be.reverted;

      // Check the first transfer didn't go through
      expect(await token.balanceOf(user1.address)).to.equal(0);
    });
  });

  describe("Token Withdrawals", function() {
    it("should allow owner to withdraw tokens", async function() {
      const amount = ethers.parseEther("50");
      const initialBalance = await token.balanceOf(user1.address);

      await vault.withdrawTokens(
        await token.getAddress(),
        user1.address,
        amount
      );

      const finalBalance = await token.balanceOf(user1.address);
      expect(finalBalance - initialBalance).to.equal(amount);
    });

    it("should reject withdrawals from non-owner", async function() {
      await expect(
        vault.connect(user1).withdrawTokens(
          await token.getAddress(),
          user1.address,
          ethers.parseEther("1")
        )
      ).to.be.revertedWith("PositionVault: caller is not the owner");
    });
  });

  describe("Position NFT Management", function() {
    let tokenId;

    beforeEach(async function() {
      // Create a position NFT
      const tx = await nft.createPosition(
        owner.address,
        await token.getAddress(), // token0
        ethers.ZeroAddress,       // token1
        3000,                     // fee
        -10000,                   // tickLower
        10000,                    // tickUpper
        1000000                   // liquidity
      );
      await tx.wait();

      // Get tokenId from transaction events
      tokenId = 1; // First token has ID 1

      // Approve vault to transfer the NFT
      await nft.approve(await vault.getAddress(), tokenId);
    });

    it("should receive position NFTs correctly", async function() {
      // Get vault address
      const vaultAddress = await vault.getAddress();

      // Check initial state
      expect(await vault.managedPositions(tokenId)).to.be.false;

      // Transfer NFT to vault using safeTransferFrom with explicit function signature
      await nft["safeTransferFrom(address,address,uint256)"](
        owner.address,
        vaultAddress,
        tokenId
      );

      // Check that vault registered the position
      expect(await vault.managedPositions(tokenId)).to.be.true;

      // Verify NFT ownership
      expect(await nft.ownerOf(tokenId)).to.equal(vaultAddress);
    });

    it("should allow owner to withdraw position NFTs", async function() {
      // Get vault address
      const vaultAddress = await vault.getAddress();

      // First transfer NFT to vault using safeTransferFrom with explicit function signature
      await nft["safeTransferFrom(address,address,uint256)"](
        owner.address,
        vaultAddress,
        tokenId
      );

      // Verify the position is now managed
      expect(await vault.managedPositions(tokenId)).to.be.true;

      // Then withdraw it to user1
      await vault.withdrawPosition(
        await nft.getAddress(),
        tokenId,
        user1.address
      );

      // Check that position is no longer managed by vault
      expect(await vault.managedPositions(tokenId)).to.be.false;

      // Verify NFT ownership
      expect(await nft.ownerOf(tokenId)).to.equal(user1.address);
    });

    it("should reject position withdrawals from non-owner", async function() {
      // First transfer NFT to vault using safeTransferFrom with explicit function signature
      await nft["safeTransferFrom(address,address,uint256)"](
        owner.address,
        await vault.getAddress(),
        tokenId
      );

      // Attempt unauthorized withdrawal
      await expect(
        vault.connect(user1).withdrawPosition(
          await nft.getAddress(),
          tokenId,
          user1.address
        )
      ).to.be.revertedWith("PositionVault: caller is not the owner");
    });

    it("should reject withdrawing positions that aren't managed by the vault", async function() {
      // Try to withdraw without transferring first
      await expect(
        vault.withdrawPosition(
          await nft.getAddress(),
          tokenId,
          user1.address
        )
      ).to.be.revertedWith("PositionVault: position not managed by vault");
    });
  });
});
