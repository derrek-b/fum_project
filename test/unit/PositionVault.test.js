const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("PositionVault - 0.3.0", function() {
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

  describe("Basic Configuration", function() {
    it("should initialize with the correct owner", async function() {
      expect(await vault.owner()).to.equal(owner.address);
    });

    it("should initialize with empty strategy and executor", async function() {
      expect(await vault.strategy()).to.equal(ethers.ZeroAddress);
      expect(await vault.executor()).to.equal(ethers.ZeroAddress);
    });
  });

  describe("Strategy Management", function() {
    it("should allow owner to set strategy", async function() {
      await vault.setStrategy(strategyContract.address);
      expect(await vault.strategy()).to.equal(strategyContract.address);

      // Check event emission
      await expect(vault.setStrategy(strategyContract.address))
        .to.emit(vault, "StrategyChanged")
        .withArgs(strategyContract.address);
    });

    it("should allow owner to remove strategy", async function() {
      // First set, then remove
      await vault.setStrategy(strategyContract.address);
      await vault.removeStrategy();

      expect(await vault.strategy()).to.equal(ethers.ZeroAddress);

      // Check event emission
      await expect(vault.removeStrategy())
        .to.emit(vault, "StrategyChanged")
        .withArgs(ethers.ZeroAddress);
    });

    it("should reject strategy changes from non-owner", async function() {
      await expect(
        vault.connect(user1).setStrategy(strategyContract.address)
      ).to.be.revertedWith("PositionVault: caller is not the owner");

      await expect(
        vault.connect(user1).removeStrategy()
      ).to.be.revertedWith("PositionVault: caller is not the owner");
    });

    it("should reject setting zero address strategy", async function() {
      await expect(
        vault.setStrategy(ethers.ZeroAddress)
      ).to.be.revertedWith("PositionVault: zero strategy address");
    });
  });

  describe("Executor Management", function() {
    it("should allow owner to set executor", async function() {
      await vault.setExecutor(executorWallet.address);
      expect(await vault.executor()).to.equal(executorWallet.address);

      // Check event emission
      await expect(vault.setExecutor(executorWallet.address))
        .to.emit(vault, "ExecutorChanged")
        .withArgs(executorWallet.address);
    });

    it("should allow owner to remove executor", async function() {
      // First set, then remove
      await vault.setExecutor(executorWallet.address);
      await vault.removeExecutor();

      expect(await vault.executor()).to.equal(ethers.ZeroAddress);

      // Check event emission
      await expect(vault.removeExecutor())
        .to.emit(vault, "ExecutorChanged")
        .withArgs(ethers.ZeroAddress);
    });

    it("should reject executor changes from non-owner", async function() {
      await expect(
        vault.connect(user1).setExecutor(executorWallet.address)
      ).to.be.revertedWith("PositionVault: caller is not the owner");

      await expect(
        vault.connect(user1).removeExecutor()
      ).to.be.revertedWith("PositionVault: caller is not the owner");
    });

    it("should reject setting zero address executor", async function() {
      await expect(
        vault.setExecutor(ethers.ZeroAddress)
      ).to.be.revertedWith("PositionVault: zero executor address");
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

      // Set up executor for some tests
      await vault.setExecutor(executorWallet.address);
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

    it("should allow authorized executor to execute transactions", async function() {
      const initialBalance = await token.balanceOf(user1.address);

      // Execute transfer transaction from executor
      await vault.connect(executorWallet).execute(
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

      // Even the strategy contract cannot execute (only owner and executor can)
      await expect(
        vault.connect(strategyContract).execute(
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

      // Even the executor cannot withdraw tokens
      await vault.setExecutor(executorWallet.address);
      await expect(
        vault.connect(executorWallet).withdrawTokens(
          await token.getAddress(),
          executorWallet.address,
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

      // Even the executor cannot withdraw positions
      await vault.setExecutor(executorWallet.address);
      await expect(
        vault.connect(executorWallet).withdrawPosition(
          await nft.getAddress(),
          tokenId,
          executorWallet.address
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
