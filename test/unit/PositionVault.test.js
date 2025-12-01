const { expect } = require("chai");
const { ethers } = require('hardhat');

describe("PositionVault - 0.4.3", function() {
  let PositionVault;
  let MockPositionNFT;
  let MockToken;
  let MockUniversalRouter;
  let MockNonfungiblePositionManager;
  let vault;
  let nft;
  let token;
  let token2;
  let router;
  let positionManager;
  let permit2Address;
  let nonfungiblePositionManagerAddress;
  let owner;
  let user1;
  let user2;
  let strategyContract;
  let executorWallet;

  beforeEach(async function() {
    // Get signers
    [owner, user1, user2, strategyContract, executorWallet] = await ethers.getSigners();

    // Deploy mock Universal Router first (needed for vault)
    MockUniversalRouter = await ethers.getContractFactory("MockUniversalRouter");
    router = await MockUniversalRouter.deploy();
    await router.waitForDeployment();

    // Deploy mock NonfungiblePositionManager
    MockNonfungiblePositionManager = await ethers.getContractFactory("MockNonfungiblePositionManager");
    positionManager = await MockNonfungiblePositionManager.deploy();
    await positionManager.waitForDeployment();

    // Use deterministic address for permit2 (canonical Uniswap address)
    permit2Address = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
    // Use deployed mock for position manager
    nonfungiblePositionManagerAddress = await positionManager.getAddress();

    // Deploy the vault with owner, router, permit2, and position manager
    PositionVault = await ethers.getContractFactory("PositionVault");
    vault = await PositionVault.deploy(
      owner.address,
      await router.getAddress(),
      permit2Address,
      nonfungiblePositionManagerAddress
    );
    await vault.waitForDeployment();

    // Deploy mock NFT contract
    MockPositionNFT = await ethers.getContractFactory("MockPositionNFT");
    nft = await MockPositionNFT.deploy(owner.address);
    await nft.waitForDeployment();

    // Deploy mock ERC20 tokens
    MockToken = await ethers.getContractFactory("MockERC20");
    token = await MockToken.deploy("Mock Token", "MOCK", 18);
    await token.waitForDeployment();

    token2 = await MockToken.deploy("Mock Token 2", "MOCK2", 18);
    await token2.waitForDeployment();

    // Mint some tokens to owner
    await token.mint(owner.address, ethers.parseEther("1000"));
    await token2.mint(owner.address, ethers.parseEther("1000"));

    // Transfer some tokens to the vault
    await token.transfer(await vault.getAddress(), ethers.parseEther("100"));
    await token2.transfer(await vault.getAddress(), ethers.parseEther("100"));
  });

  // Test for constructor validation
  describe("Constructor", function() {
    it("should reject zero owner address", async function() {
      await expect(
        PositionVault.deploy(
          ethers.ZeroAddress,
          await router.getAddress(),
          permit2Address,
          nonfungiblePositionManagerAddress
        )
      ).to.be.revertedWith("PositionVault: zero owner address");
    });

    it("should reject zero router address", async function() {
      await expect(
        PositionVault.deploy(
          owner.address,
          ethers.ZeroAddress,
          permit2Address,
          nonfungiblePositionManagerAddress
        )
      ).to.be.revertedWith("PositionVault: zero router address");
    });

    it("should reject zero permit2 address", async function() {
      await expect(
        PositionVault.deploy(
          owner.address,
          await router.getAddress(),
          ethers.ZeroAddress,
          nonfungiblePositionManagerAddress
        )
      ).to.be.revertedWith("PositionVault: zero permit2 address");
    });

    it("should reject zero position manager address", async function() {
      await expect(
        PositionVault.deploy(
          owner.address,
          await router.getAddress(),
          permit2Address,
          ethers.ZeroAddress
        )
      ).to.be.revertedWith("PositionVault: zero position manager address");
    });

    it("should store immutable addresses correctly", async function() {
      expect(await vault.universalRouter()).to.equal(await router.getAddress());
      expect(await vault.permit2()).to.equal(permit2Address);
      expect(await vault.nonfungiblePositionManager()).to.equal(nonfungiblePositionManagerAddress);
    });
  });

  // Test for empty batch validation
  describe("Empty Batch Validation", function() {
    it("should reject execute() with empty arrays", async function() {
      await expect(
        vault.execute([], [])
      ).to.be.revertedWith("PositionVault: empty batch");
    });

    it("should reject swap() with empty arrays", async function() {
      await expect(
        vault.swap([], [])
      ).to.be.revertedWith("PositionVault: empty batch");
    });

    it("should reject approve() with empty arrays", async function() {
      await expect(
        vault.approve([], [])
      ).to.be.revertedWith("PositionVault: empty batch");
    });

    it("should reject mint() with empty arrays", async function() {
      await expect(
        vault.mint([], [])
      ).to.be.revertedWith("PositionVault: empty batch");
    });

    it("should reject increaseLiquidity() with empty arrays", async function() {
      await expect(
        vault.increaseLiquidity([], [])
      ).to.be.revertedWith("PositionVault: empty batch");
    });

    it("should reject decreaseLiquidity() with empty arrays", async function() {
      await expect(
        vault.decreaseLiquidity([], [])
      ).to.be.revertedWith("PositionVault: empty batch");
    });

    it("should reject collect() with empty arrays", async function() {
      await expect(
        vault.collect([], [])
      ).to.be.revertedWith("PositionVault: empty batch");
    });

    it("should reject burn() with empty arrays", async function() {
      await expect(
        vault.burn([], [])
      ).to.be.revertedWith("PositionVault: empty batch");
    });
  });

  // Test for position withdrawal security
  describe("Position Withdrawal", function() {
    const tokenId = BigInt(1);

    beforeEach(async function() {
      // Create a position NFT
      await nft.createPosition(
        owner.address,
        await token.getAddress(),
        ethers.ZeroAddress,
        3000,
        -10000,
        10000,
        1000000
      );

      // Transfer NFT to vault
      await nft.approve(await vault.getAddress(), tokenId);
      await nft["safeTransferFrom(address,address,uint256)"](
        owner.address,
        await vault.getAddress(),
        tokenId
      );
    });

    it("should withdraw position to owner address only", async function() {
      // Withdraw position - should go to owner
      await vault.withdrawPosition(await nft.getAddress(), tokenId);

      // Verify NFT went to owner
      expect(await nft.ownerOf(tokenId)).to.equal(owner.address);
    });

    it("should emit PositionWithdrawn event with owner as recipient", async function() {
      await expect(vault.withdrawPosition(await nft.getAddress(), tokenId))
        .to.emit(vault, "PositionWithdrawn")
        .withArgs(tokenId, await nft.getAddress(), owner.address);
    });

    it("should only allow authorized callers to withdraw positions", async function() {
      await expect(
        vault.connect(user1).withdrawPosition(await nft.getAddress(), tokenId)
      ).to.be.revertedWith("PositionVault: caller is not authorized");
    });

    it("should allow executor to withdraw position to owner", async function() {
      // Set executor
      await vault.setExecutor(executorWallet.address);

      // Executor withdraws position
      await vault.connect(executorWallet).withdrawPosition(await nft.getAddress(), tokenId);

      // Verify NFT went to owner (not executor)
      expect(await nft.ownerOf(tokenId)).to.equal(owner.address);
    });

    it("should emit PositionWithdrawn with owner as recipient when executor calls", async function() {
      // Set executor
      await vault.setExecutor(executorWallet.address);

      // Verify event shows owner as recipient
      await expect(vault.connect(executorWallet).withdrawPosition(await nft.getAddress(), tokenId))
        .to.emit(vault, "PositionWithdrawn")
        .withArgs(tokenId, await nft.getAddress(), owner.address);
    });

    it("should reject zero NFT contract address", async function() {
      await expect(
        vault.withdrawPosition(ethers.ZeroAddress, tokenId)
      ).to.be.revertedWith("PositionVault: zero NFT contract address");
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

    it("should NOT allow executor to call execute function (owner only)", async function() {
      // Set executor
      await vault.setExecutor(executorWallet.address);

      // Test execute function - executor should NOT be able to call it
      const targets = [await token.getAddress()];
      const data = [token.interface.encodeFunctionData("transfer", [user1.address, 1])];

      // This should revert (execute is now owner-only)
      await expect(
        vault.connect(executorWallet).execute(targets, data)
      ).to.be.revertedWith("PositionVault: caller is not the owner");
    });

    it("should not allow unauthorized user to call execute function", async function() {
      // Try with unauthorized user
      const targets = [await token.getAddress()];
      const data = [token.interface.encodeFunctionData("transfer", [user1.address, 1])];

      await expect(
        vault.connect(user1).execute(targets, data)
      ).to.be.revertedWith("PositionVault: caller is not the owner");
    });

    it("should allow owner to call execute function", async function() {
      // Owner should be able to execute for arbitrary calls (e.g., strategy config)
      const targets = [await token.getAddress()];
      const data = [token.interface.encodeFunctionData("transfer", [user1.address, 1])];

      // This should not revert (owner can call execute)
      await expect(vault.connect(owner).execute(targets, data))
        .to.not.be.reverted;
    });
  });

  // Test for contract version
  describe("Contract Version", function() {
    it("should return the correct version", async function() {
      expect(await vault.getVersion()).to.equal("0.4.3");
    });
  });

  // Test for token withdrawal security
  describe("Token Withdrawal", function() {
    it("should withdraw tokens to owner address only", async function() {
      const vaultAddress = await vault.getAddress();
      const initialOwnerBalance = await token.balanceOf(owner.address);
      const vaultBalance = await token.balanceOf(vaultAddress);

      // Withdraw tokens - should go to owner
      await vault.withdrawTokens(await token.getAddress(), vaultBalance);

      // Verify tokens went to owner
      const finalOwnerBalance = await token.balanceOf(owner.address);
      expect(finalOwnerBalance).to.equal(initialOwnerBalance + vaultBalance);

      // Verify vault is empty
      expect(await token.balanceOf(vaultAddress)).to.equal(0);
    });

    it("should emit TokensWithdrawn event with owner as recipient", async function() {
      const withdrawAmount = ethers.parseEther("10");

      await expect(vault.withdrawTokens(await token.getAddress(), withdrawAmount))
        .to.emit(vault, "TokensWithdrawn")
        .withArgs(await token.getAddress(), owner.address, withdrawAmount);
    });

    it("should only allow authorized callers to withdraw tokens", async function() {
      await expect(
        vault.connect(user1).withdrawTokens(await token.getAddress(), ethers.parseEther("10"))
      ).to.be.revertedWith("PositionVault: caller is not authorized");
    });

    it("should allow executor to withdraw tokens to owner", async function() {
      // Set executor
      await vault.setExecutor(executorWallet.address);

      const withdrawAmount = ethers.parseEther("10");
      const initialOwnerBalance = await token.balanceOf(owner.address);
      const initialExecutorBalance = await token.balanceOf(executorWallet.address);

      // Executor withdraws tokens
      await vault.connect(executorWallet).withdrawTokens(await token.getAddress(), withdrawAmount);

      // Verify tokens went to owner (not executor)
      expect(await token.balanceOf(owner.address)).to.equal(initialOwnerBalance + withdrawAmount);
      expect(await token.balanceOf(executorWallet.address)).to.equal(initialExecutorBalance);
    });

    it("should emit TokensWithdrawn with owner as recipient when executor calls", async function() {
      // Set executor
      await vault.setExecutor(executorWallet.address);

      const withdrawAmount = ethers.parseEther("10");

      // Verify event shows owner as recipient
      await expect(vault.connect(executorWallet).withdrawTokens(await token.getAddress(), withdrawAmount))
        .to.emit(vault, "TokensWithdrawn")
        .withArgs(await token.getAddress(), owner.address, withdrawAmount);
    });

    it("should reject zero token address", async function() {
      await expect(
        vault.withdrawTokens(ethers.ZeroAddress, ethers.parseEther("10"))
      ).to.be.revertedWith("PositionVault: zero token address");
    });
  });

  // Test for token approval security
  describe("Token Approval", function() {
    // Helper to encode ERC20.approve calldata
    function encodeApprove(spender, amount) {
      const iface = new ethers.Interface(["function approve(address spender, uint256 amount)"]);
      return iface.encodeFunctionData("approve", [spender, amount]);
    }

    it("should approve tokens for permit2", async function() {
      const amount = ethers.parseEther("100");
      const approveData = encodeApprove(permit2Address, amount);

      await expect(vault.approve(
        [await token.getAddress()],
        [approveData]
      )).to.emit(vault, "TransactionExecuted")
        .withArgs(await token.getAddress(), approveData, true, "approval");

      // Verify allowance was set
      const allowance = await token.allowance(await vault.getAddress(), permit2Address);
      expect(allowance).to.equal(amount);
    });

    it("should approve tokens for nonfungiblePositionManager", async function() {
      const amount = ethers.parseEther("50");
      const approveData = encodeApprove(nonfungiblePositionManagerAddress, amount);

      await vault.approve(
        [await token.getAddress()],
        [approveData]
      );

      const allowance = await token.allowance(await vault.getAddress(), nonfungiblePositionManagerAddress);
      expect(allowance).to.equal(amount);
    });

    it("should batch approve multiple tokens", async function() {
      const amount1 = ethers.parseEther("100");
      const amount2 = ethers.parseEther("200");
      const approveData1 = encodeApprove(permit2Address, amount1);
      const approveData2 = encodeApprove(nonfungiblePositionManagerAddress, amount2);

      await vault.approve(
        [await token.getAddress(), await token2.getAddress()],
        [approveData1, approveData2]
      );

      const allowance1 = await token.allowance(await vault.getAddress(), permit2Address);
      const allowance2 = await token2.allowance(await vault.getAddress(), nonfungiblePositionManagerAddress);

      expect(allowance1).to.equal(amount1);
      expect(allowance2).to.equal(amount2);
    });

    it("should reject invalid spender address", async function() {
      const approveData = encodeApprove(user1.address, ethers.parseEther("100"));

      await expect(
        vault.approve(
          [await token.getAddress()],
          [approveData]
        )
      ).to.be.revertedWith("PositionVault: invalid spender");
    });

    it("should reject zero token address", async function() {
      const approveData = encodeApprove(permit2Address, ethers.parseEther("100"));

      await expect(
        vault.approve(
          [ethers.ZeroAddress],
          [approveData]
        )
      ).to.be.revertedWith("PositionVault: zero token address");
    });

    it("should reject mismatched array lengths", async function() {
      const approveData = encodeApprove(permit2Address, ethers.parseEther("100"));

      await expect(
        vault.approve(
          [await token.getAddress(), await token2.getAddress()],
          [approveData]
        )
      ).to.be.revertedWith("PositionVault: length mismatch");
    });

    it("should reject invalid approval data (too short)", async function() {
      await expect(
        vault.approve(
          [await token.getAddress()],
          ["0x1234"]
        )
      ).to.be.revertedWith("PositionVault: invalid approval data");
    });

    it("should only allow authorized callers", async function() {
      const approveData = encodeApprove(permit2Address, ethers.parseEther("100"));

      await expect(
        vault.connect(user1).approve(
          [await token.getAddress()],
          [approveData]
        )
      ).to.be.revertedWith("PositionVault: caller is not authorized");
    });

    it("should allow executor to approve tokens", async function() {
      // Set executor
      await vault.setExecutor(executorWallet.address);

      const amount = ethers.parseEther("100");
      const approveData = encodeApprove(permit2Address, amount);

      await vault.connect(executorWallet).approve(
        [await token.getAddress()],
        [approveData]
      );

      const allowance = await token.allowance(await vault.getAddress(), permit2Address);
      expect(allowance).to.equal(amount);
    });

    it("should reject non-approve function calls", async function() {
      // Try to pass a transfer call through approve function
      const iface = new ethers.Interface([
        "function transfer(address to, uint256 amount)"
      ]);
      const transferData = iface.encodeFunctionData("transfer", [permit2Address, ethers.parseEther("100")]);

      await expect(
        vault.approve(
          [await token.getAddress()],
          [transferData]
        )
      ).to.be.revertedWith("PositionVault: not an approve call");
    });
  });

  // Test for mint function (create new positions)
  describe("Mint Position", function() {
    // Helper to encode NonfungiblePositionManager.mint calldata
    function encodeMint(token0, token1, fee, tickLower, tickUpper, amount0Desired, amount1Desired, amount0Min, amount1Min, recipient, deadline) {
      const iface = new ethers.Interface([
        "function mint((address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline) params)"
      ]);
      return iface.encodeFunctionData("mint", [{
        token0,
        token1,
        fee,
        tickLower,
        tickUpper,
        amount0Desired,
        amount1Desired,
        amount0Min,
        amount1Min,
        recipient,
        deadline
      }]);
    }

    it("should allow mint with vault as recipient", async function() {
      const vaultAddress = await vault.getAddress();
      const deadline = Math.floor(Date.now() / 1000) + 3600;
      const tokenAddress = await token.getAddress();
      const token2Address = await token2.getAddress();

      const calldata = encodeMint(
        tokenAddress,
        token2Address,
        3000, // fee tier
        -887220, // tickLower
        887220,  // tickUpper
        ethers.parseEther("1"),
        ethers.parseEther("1"),
        0,
        0,
        vaultAddress, // recipient = vault
        deadline
      );

      await expect(
        vault.mint(
          [nonfungiblePositionManagerAddress],
          [calldata]
        )
      ).to.emit(vault, "TransactionExecuted")
        .withArgs(nonfungiblePositionManagerAddress, calldata, true, "mint");
    });

    it("should reject mint with non-vault recipient", async function() {
      const deadline = Math.floor(Date.now() / 1000) + 3600;
      const tokenAddress = await token.getAddress();
      const token2Address = await token2.getAddress();

      const calldata = encodeMint(
        tokenAddress,
        token2Address,
        3000,
        -887220,
        887220,
        ethers.parseEther("1"),
        ethers.parseEther("1"),
        0,
        0,
        user1.address, // wrong recipient
        deadline
      );

      await expect(
        vault.mint(
          [nonfungiblePositionManagerAddress],
          [calldata]
        )
      ).to.be.revertedWith("PositionVault: mint recipient must be vault");
    });

    it("should reject invalid target address", async function() {
      const vaultAddress = await vault.getAddress();
      const deadline = Math.floor(Date.now() / 1000) + 3600;
      const tokenAddress = await token.getAddress();
      const token2Address = await token2.getAddress();

      const calldata = encodeMint(
        tokenAddress,
        token2Address,
        3000,
        -887220,
        887220,
        ethers.parseEther("1"),
        ethers.parseEther("1"),
        0,
        0,
        vaultAddress,
        deadline
      );

      await expect(
        vault.mint(
          [user1.address], // wrong target
          [calldata]
        )
      ).to.be.revertedWith("PositionVault: invalid target");
    });

    it("should reject mismatched array lengths", async function() {
      const vaultAddress = await vault.getAddress();
      const deadline = Math.floor(Date.now() / 1000) + 3600;
      const tokenAddress = await token.getAddress();
      const token2Address = await token2.getAddress();

      const calldata = encodeMint(
        tokenAddress,
        token2Address,
        3000,
        -887220,
        887220,
        ethers.parseEther("1"),
        ethers.parseEther("1"),
        0,
        0,
        vaultAddress,
        deadline
      );

      await expect(
        vault.mint(
          [nonfungiblePositionManagerAddress, nonfungiblePositionManagerAddress],
          [calldata]
        )
      ).to.be.revertedWith("PositionVault: length mismatch");
    });

    it("should only allow authorized callers", async function() {
      const vaultAddress = await vault.getAddress();
      const deadline = Math.floor(Date.now() / 1000) + 3600;
      const tokenAddress = await token.getAddress();
      const token2Address = await token2.getAddress();

      const calldata = encodeMint(
        tokenAddress,
        token2Address,
        3000,
        -887220,
        887220,
        ethers.parseEther("1"),
        ethers.parseEther("1"),
        0,
        0,
        vaultAddress,
        deadline
      );

      await expect(
        vault.connect(user1).mint(
          [nonfungiblePositionManagerAddress],
          [calldata]
        )
      ).to.be.revertedWith("PositionVault: caller is not authorized");
    });

    it("should allow executor to mint", async function() {
      await vault.setExecutor(executorWallet.address);

      const vaultAddress = await vault.getAddress();
      const deadline = Math.floor(Date.now() / 1000) + 3600;
      const tokenAddress = await token.getAddress();
      const token2Address = await token2.getAddress();

      const calldata = encodeMint(
        tokenAddress,
        token2Address,
        3000,
        -887220,
        887220,
        ethers.parseEther("1"),
        ethers.parseEther("1"),
        0,
        0,
        vaultAddress,
        deadline
      );

      await expect(
        vault.connect(executorWallet).mint(
          [nonfungiblePositionManagerAddress],
          [calldata]
        )
      ).to.emit(vault, "TransactionExecuted")
        .withArgs(nonfungiblePositionManagerAddress, calldata, true, "mint");
    });

    it("should reject calldata that is too short", async function() {
      // Only provide partial calldata (less than 356 bytes needed)
      const calldata = "0x88316456" + "00".repeat(100); // selector + 100 bytes

      await expect(
        vault.mint(
          [nonfungiblePositionManagerAddress],
          [calldata]
        )
      ).to.be.revertedWith("PositionVault: invalid mint data");
    });

    it("should reject non-mint function calls", async function() {
      // Create calldata that's 356+ bytes but with wrong selector (not 0x88316456)
      // Use a fake selector 0x11111111 followed by enough padding to pass length check
      const wrongSelector = "0x11111111";
      // Mint requires 356 bytes minimum. 4 bytes selector + 352 bytes padding = 356 bytes
      const padding = "00".repeat(352);
      const fakeCalldata = wrongSelector + padding;

      await expect(
        vault.mint(
          [nonfungiblePositionManagerAddress],
          [fakeCalldata]
        )
      ).to.be.revertedWith("PositionVault: not a mint call");
    });
  });

  // Test for increaseLiquidity function
  describe("Increase Liquidity", function() {
    // Helper to encode NonfungiblePositionManager.increaseLiquidity calldata
    function encodeIncreaseLiquidity(tokenId, amount0Desired, amount1Desired, amount0Min, amount1Min, deadline) {
      const iface = new ethers.Interface([
        "function increaseLiquidity((uint256 tokenId, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, uint256 deadline) params)"
      ]);
      return iface.encodeFunctionData("increaseLiquidity", [{
        tokenId,
        amount0Desired,
        amount1Desired,
        amount0Min,
        amount1Min,
        deadline
      }]);
    }

    it("should only allow calls to nonfungiblePositionManager", async function() {
      const deadline = Math.floor(Date.now() / 1000) + 3600;
      const calldata = encodeIncreaseLiquidity(1, 1000, 1000, 0, 0, deadline);

      await expect(
        vault.increaseLiquidity(
          [nonfungiblePositionManagerAddress],
          [calldata]
        )
      ).to.emit(vault, "TransactionExecuted")
        .withArgs(nonfungiblePositionManagerAddress, calldata, true, "addliq");
    });

    it("should reject invalid target address", async function() {
      const deadline = Math.floor(Date.now() / 1000) + 3600;
      const calldata = encodeIncreaseLiquidity(1, 1000, 1000, 0, 0, deadline);

      await expect(
        vault.increaseLiquidity(
          [user1.address],
          [calldata]
        )
      ).to.be.revertedWith("PositionVault: invalid target");
    });

    it("should reject mismatched array lengths", async function() {
      const deadline = Math.floor(Date.now() / 1000) + 3600;
      const calldata = encodeIncreaseLiquidity(1, 1000, 1000, 0, 0, deadline);

      await expect(
        vault.increaseLiquidity(
          [nonfungiblePositionManagerAddress, nonfungiblePositionManagerAddress],
          [calldata]
        )
      ).to.be.revertedWith("PositionVault: length mismatch");
    });

    it("should only allow authorized callers", async function() {
      const deadline = Math.floor(Date.now() / 1000) + 3600;
      const calldata = encodeIncreaseLiquidity(1, 1000, 1000, 0, 0, deadline);

      await expect(
        vault.connect(user1).increaseLiquidity(
          [nonfungiblePositionManagerAddress],
          [calldata]
        )
      ).to.be.revertedWith("PositionVault: caller is not authorized");
    });

    it("should allow executor to increase liquidity", async function() {
      // Set executor
      await vault.setExecutor(executorWallet.address);

      const deadline = Math.floor(Date.now() / 1000) + 3600;
      const calldata = encodeIncreaseLiquidity(1, 1000, 1000, 0, 0, deadline);

      await expect(
        vault.connect(executorWallet).increaseLiquidity(
          [nonfungiblePositionManagerAddress],
          [calldata]
        )
      ).to.emit(vault, "TransactionExecuted")
        .withArgs(nonfungiblePositionManagerAddress, calldata, true, "addliq");
    });

    it("should reject non-increaseLiquidity function calls", async function() {
      // Try to pass a collect call through increaseLiquidity function
      const vaultAddress = await vault.getAddress();
      const maxUint128 = 2n ** 128n - 1n;
      const iface = new ethers.Interface([
        "function collect((uint256 tokenId, address recipient, uint128 amount0Max, uint128 amount1Max) params)"
      ]);
      const collectCalldata = iface.encodeFunctionData("collect", [{
        tokenId: 1,
        recipient: vaultAddress,
        amount0Max: maxUint128,
        amount1Max: maxUint128
      }]);

      await expect(
        vault.increaseLiquidity(
          [nonfungiblePositionManagerAddress],
          [collectCalldata]
        )
      ).to.be.revertedWith("PositionVault: not an increaseLiquidity call");
    });

    it("should reject calldata that is too short", async function() {
      const shortCalldata = "0x219f"; // Less than 4 bytes

      await expect(
        vault.increaseLiquidity(
          [nonfungiblePositionManagerAddress],
          [shortCalldata]
        )
      ).to.be.revertedWith("PositionVault: invalid calldata");
    });
  });

  // Test for decreaseLiquidity function (only accepts multicall)
  describe("Decrease Liquidity", function() {
    // Helper to encode NonfungiblePositionManager.decreaseLiquidity calldata
    function encodeDecreaseLiquidity(tokenId, liquidity, amount0Min, amount1Min, deadline) {
      const iface = new ethers.Interface([
        "function decreaseLiquidity((uint256 tokenId, uint128 liquidity, uint256 amount0Min, uint256 amount1Min, uint256 deadline) params)"
      ]);
      return iface.encodeFunctionData("decreaseLiquidity", [{
        tokenId,
        liquidity,
        amount0Min,
        amount1Min,
        deadline
      }]);
    }

    // Helper to encode NonfungiblePositionManager.collect calldata
    function encodeCollect(tokenId, recipient, amount0Max, amount1Max) {
      const iface = new ethers.Interface([
        "function collect((uint256 tokenId, address recipient, uint128 amount0Max, uint128 amount1Max) params)"
      ]);
      return iface.encodeFunctionData("collect", [{
        tokenId,
        recipient,
        amount0Max,
        amount1Max
      }]);
    }

    // Helper to encode multicall
    function encodeMulticall(innerCalls) {
      const iface = new ethers.Interface([
        "function multicall(bytes[] data)"
      ]);
      return iface.encodeFunctionData("multicall", [innerCalls]);
    }

    it("should allow multicall with decreaseLiquidity + collect (vault recipient)", async function() {
      const vaultAddress = await vault.getAddress();
      const deadline = Math.floor(Date.now() / 1000) + 3600;
      const maxUint128 = 2n ** 128n - 1n;

      const decreaseCalldata = encodeDecreaseLiquidity(1, 1000, 0, 0, deadline);
      const collectCalldata = encodeCollect(1, vaultAddress, maxUint128, maxUint128);
      const multicallData = encodeMulticall([decreaseCalldata, collectCalldata]);

      await expect(
        vault.decreaseLiquidity(
          [nonfungiblePositionManagerAddress],
          [multicallData]
        )
      ).to.emit(vault, "TransactionExecuted")
        .withArgs(nonfungiblePositionManagerAddress, multicallData, true, "subliq");
    });

    it("should reject direct decreaseLiquidity calls (must be multicall)", async function() {
      const deadline = Math.floor(Date.now() / 1000) + 3600;
      const calldata = encodeDecreaseLiquidity(1, 1000, 0, 0, deadline);

      await expect(
        vault.decreaseLiquidity(
          [nonfungiblePositionManagerAddress],
          [calldata]
        )
      ).to.be.revertedWith("PositionVault: must be multicall");
    });

    it("should reject direct collect calls (must be multicall)", async function() {
      const vaultAddress = await vault.getAddress();
      const maxUint128 = 2n ** 128n - 1n;
      const calldata = encodeCollect(1, vaultAddress, maxUint128, maxUint128);

      await expect(
        vault.decreaseLiquidity(
          [nonfungiblePositionManagerAddress],
          [calldata]
        )
      ).to.be.revertedWith("PositionVault: must be multicall");
    });

    it("should reject multicall with collect to non-vault recipient", async function() {
      const deadline = Math.floor(Date.now() / 1000) + 3600;
      const maxUint128 = 2n ** 128n - 1n;

      const decreaseCalldata = encodeDecreaseLiquidity(1, 1000, 0, 0, deadline);
      const collectCalldata = encodeCollect(1, user1.address, maxUint128, maxUint128);
      const multicallData = encodeMulticall([decreaseCalldata, collectCalldata]);

      await expect(
        vault.decreaseLiquidity(
          [nonfungiblePositionManagerAddress],
          [multicallData]
        )
      ).to.be.revertedWith("PositionVault: collect recipient must be vault");
    });

    it("should reject multicall with disallowed function", async function() {
      const deadline = Math.floor(Date.now() / 1000) + 3600;

      const decreaseCalldata = encodeDecreaseLiquidity(1, 1000, 0, 0, deadline);
      const burnIface = new ethers.Interface(["function burn(uint256 tokenId)"]);
      const burnCalldata = burnIface.encodeFunctionData("burn", [1]);
      const multicallData = encodeMulticall([decreaseCalldata, burnCalldata]);

      await expect(
        vault.decreaseLiquidity(
          [nonfungiblePositionManagerAddress],
          [multicallData]
        )
      ).to.be.revertedWith("PositionVault: function not allowed in multicall");
    });

    it("should reject invalid target address", async function() {
      const vaultAddress = await vault.getAddress();
      const deadline = Math.floor(Date.now() / 1000) + 3600;
      const maxUint128 = 2n ** 128n - 1n;

      const decreaseCalldata = encodeDecreaseLiquidity(1, 1000, 0, 0, deadline);
      const collectCalldata = encodeCollect(1, vaultAddress, maxUint128, maxUint128);
      const multicallData = encodeMulticall([decreaseCalldata, collectCalldata]);

      await expect(
        vault.decreaseLiquidity(
          [user1.address],
          [multicallData]
        )
      ).to.be.revertedWith("PositionVault: invalid target");
    });

    it("should reject mismatched array lengths", async function() {
      const vaultAddress = await vault.getAddress();
      const deadline = Math.floor(Date.now() / 1000) + 3600;
      const maxUint128 = 2n ** 128n - 1n;

      const decreaseCalldata = encodeDecreaseLiquidity(1, 1000, 0, 0, deadline);
      const collectCalldata = encodeCollect(1, vaultAddress, maxUint128, maxUint128);
      const multicallData = encodeMulticall([decreaseCalldata, collectCalldata]);

      await expect(
        vault.decreaseLiquidity(
          [nonfungiblePositionManagerAddress, nonfungiblePositionManagerAddress],
          [multicallData]
        )
      ).to.be.revertedWith("PositionVault: length mismatch");
    });

    it("should only allow authorized callers", async function() {
      const vaultAddress = await vault.getAddress();
      const deadline = Math.floor(Date.now() / 1000) + 3600;
      const maxUint128 = 2n ** 128n - 1n;

      const decreaseCalldata = encodeDecreaseLiquidity(1, 1000, 0, 0, deadline);
      const collectCalldata = encodeCollect(1, vaultAddress, maxUint128, maxUint128);
      const multicallData = encodeMulticall([decreaseCalldata, collectCalldata]);

      await expect(
        vault.connect(user1).decreaseLiquidity(
          [nonfungiblePositionManagerAddress],
          [multicallData]
        )
      ).to.be.revertedWith("PositionVault: caller is not authorized");
    });

    it("should allow executor to decrease liquidity", async function() {
      await vault.setExecutor(executorWallet.address);

      const vaultAddress = await vault.getAddress();
      const deadline = Math.floor(Date.now() / 1000) + 3600;
      const maxUint128 = 2n ** 128n - 1n;

      const decreaseCalldata = encodeDecreaseLiquidity(1, 1000, 0, 0, deadline);
      const collectCalldata = encodeCollect(1, vaultAddress, maxUint128, maxUint128);
      const multicallData = encodeMulticall([decreaseCalldata, collectCalldata]);

      await expect(
        vault.connect(executorWallet).decreaseLiquidity(
          [nonfungiblePositionManagerAddress],
          [multicallData]
        )
      ).to.emit(vault, "TransactionExecuted")
        .withArgs(nonfungiblePositionManagerAddress, multicallData, true, "subliq");
    });

    it("should reject calldata that is too short", async function() {
      const calldata = "0xac96"; // Less than 4 bytes

      await expect(
        vault.decreaseLiquidity(
          [nonfungiblePositionManagerAddress],
          [calldata]
        )
      ).to.be.revertedWith("PositionVault: invalid calldata");
    });

    it("should reject multicall with empty inner call", async function() {
      const multicallData = encodeMulticall(["0x00"]);

      await expect(
        vault.decreaseLiquidity(
          [nonfungiblePositionManagerAddress],
          [multicallData]
        )
      ).to.be.revertedWith("PositionVault: invalid inner calldata");
    });

    it("should allow multicall with only decreaseLiquidity", async function() {
      const deadline = Math.floor(Date.now() / 1000) + 3600;
      const decreaseCalldata = encodeDecreaseLiquidity(1, 1000, 0, 0, deadline);
      const multicallData = encodeMulticall([decreaseCalldata]);

      await expect(
        vault.decreaseLiquidity(
          [nonfungiblePositionManagerAddress],
          [multicallData]
        )
      ).to.emit(vault, "TransactionExecuted");
    });
  });

  // Test for collect function (fee collection)
  describe("Collect Fees", function() {
    // Helper to encode NonfungiblePositionManager.collect calldata
    function encodeCollect(tokenId, recipient, amount0Max, amount1Max) {
      const iface = new ethers.Interface([
        "function collect((uint256 tokenId, address recipient, uint128 amount0Max, uint128 amount1Max) params)"
      ]);
      return iface.encodeFunctionData("collect", [{
        tokenId,
        recipient,
        amount0Max,
        amount1Max
      }]);
    }

    it("should allow collect calls with vault as recipient", async function() {
      const vaultAddress = await vault.getAddress();
      const maxUint128 = 2n ** 128n - 1n;
      const calldata = encodeCollect(1, vaultAddress, maxUint128, maxUint128);

      await expect(
        vault.collect(
          [nonfungiblePositionManagerAddress],
          [calldata]
        )
      ).to.emit(vault, "TransactionExecuted")
        .withArgs(nonfungiblePositionManagerAddress, calldata, true, "collect");
    });

    it("should reject collect calls with non-vault recipient", async function() {
      const maxUint128 = 2n ** 128n - 1n;
      const calldata = encodeCollect(1, user1.address, maxUint128, maxUint128);

      await expect(
        vault.collect(
          [nonfungiblePositionManagerAddress],
          [calldata]
        )
      ).to.be.revertedWith("PositionVault: collect recipient must be vault");
    });

    it("should reject non-collect function calls", async function() {
      // Try to pass a decreaseLiquidity call through collect function
      const iface = new ethers.Interface([
        "function decreaseLiquidity((uint256 tokenId, uint128 liquidity, uint256 amount0Min, uint256 amount1Min, uint256 deadline) params)"
      ]);
      const deadline = Math.floor(Date.now() / 1000) + 3600;
      const decreaseCalldata = iface.encodeFunctionData("decreaseLiquidity", [{
        tokenId: 1,
        liquidity: 1000,
        amount0Min: 0,
        amount1Min: 0,
        deadline: deadline
      }]);

      await expect(
        vault.collect(
          [nonfungiblePositionManagerAddress],
          [decreaseCalldata]
        )
      ).to.be.revertedWith("PositionVault: not a collect call");
    });

    it("should reject calldata that is too short", async function() {
      const shortCalldata = "0xfc6f"; // Less than 4 bytes

      await expect(
        vault.collect(
          [nonfungiblePositionManagerAddress],
          [shortCalldata]
        )
      ).to.be.revertedWith("PositionVault: invalid collect data");
    });

    it("should reject invalid target address", async function() {
      const vaultAddress = await vault.getAddress();
      const maxUint128 = 2n ** 128n - 1n;
      const calldata = encodeCollect(1, vaultAddress, maxUint128, maxUint128);

      await expect(
        vault.collect(
          [user1.address],
          [calldata]
        )
      ).to.be.revertedWith("PositionVault: invalid target");
    });

    it("should reject mismatched array lengths", async function() {
      const vaultAddress = await vault.getAddress();
      const maxUint128 = 2n ** 128n - 1n;
      const calldata = encodeCollect(1, vaultAddress, maxUint128, maxUint128);

      await expect(
        vault.collect(
          [nonfungiblePositionManagerAddress, nonfungiblePositionManagerAddress],
          [calldata]
        )
      ).to.be.revertedWith("PositionVault: length mismatch");
    });

    it("should only allow authorized callers", async function() {
      const vaultAddress = await vault.getAddress();
      const maxUint128 = 2n ** 128n - 1n;
      const calldata = encodeCollect(1, vaultAddress, maxUint128, maxUint128);

      await expect(
        vault.connect(user1).collect(
          [nonfungiblePositionManagerAddress],
          [calldata]
        )
      ).to.be.revertedWith("PositionVault: caller is not authorized");
    });

    it("should allow executor to collect fees", async function() {
      await vault.setExecutor(executorWallet.address);

      const vaultAddress = await vault.getAddress();
      const maxUint128 = 2n ** 128n - 1n;
      const calldata = encodeCollect(1, vaultAddress, maxUint128, maxUint128);

      await expect(
        vault.connect(executorWallet).collect(
          [nonfungiblePositionManagerAddress],
          [calldata]
        )
      ).to.emit(vault, "TransactionExecuted")
        .withArgs(nonfungiblePositionManagerAddress, calldata, true, "collect");
    });
  });

  // Test for burn function (burn empty position NFTs)
  describe("Burn Position", function() {
    // Helper to encode NonfungiblePositionManager.burn calldata
    function encodeBurn(tokenId) {
      const iface = new ethers.Interface([
        "function burn(uint256 tokenId)"
      ]);
      return iface.encodeFunctionData("burn", [tokenId]);
    }

    it("should allow burn calls to nonfungiblePositionManager", async function() {
      const calldata = encodeBurn(1);

      await expect(
        vault.burn(
          [nonfungiblePositionManagerAddress],
          [calldata]
        )
      ).to.emit(vault, "TransactionExecuted")
        .withArgs(nonfungiblePositionManagerAddress, calldata, true, "burn");
    });

    it("should reject invalid target address", async function() {
      const calldata = encodeBurn(1);

      await expect(
        vault.burn(
          [user1.address],
          [calldata]
        )
      ).to.be.revertedWith("PositionVault: invalid target");
    });

    it("should reject mismatched array lengths", async function() {
      const calldata = encodeBurn(1);

      await expect(
        vault.burn(
          [nonfungiblePositionManagerAddress, nonfungiblePositionManagerAddress],
          [calldata]
        )
      ).to.be.revertedWith("PositionVault: length mismatch");
    });

    it("should only allow authorized callers", async function() {
      const calldata = encodeBurn(1);

      await expect(
        vault.connect(user1).burn(
          [nonfungiblePositionManagerAddress],
          [calldata]
        )
      ).to.be.revertedWith("PositionVault: caller is not authorized");
    });

    it("should allow executor to burn", async function() {
      await vault.setExecutor(executorWallet.address);

      const calldata = encodeBurn(1);

      await expect(
        vault.connect(executorWallet).burn(
          [nonfungiblePositionManagerAddress],
          [calldata]
        )
      ).to.emit(vault, "TransactionExecuted")
        .withArgs(nonfungiblePositionManagerAddress, calldata, true, "burn");
    });

    it("should allow batch burning multiple positions", async function() {
      const calldata1 = encodeBurn(1);
      const calldata2 = encodeBurn(2);

      await expect(
        vault.burn(
          [nonfungiblePositionManagerAddress, nonfungiblePositionManagerAddress],
          [calldata1, calldata2]
        )
      ).to.emit(vault, "TransactionExecuted");
    });

    it("should reject non-burn function calls", async function() {
      // Try to pass a collect call through burn function
      const iface = new ethers.Interface([
        "function collect((uint256 tokenId, address recipient, uint128 amount0Max, uint128 amount1Max) params)"
      ]);
      const maxUint128 = 2n ** 128n - 1n;
      const collectCalldata = iface.encodeFunctionData("collect", [{
        tokenId: 1,
        recipient: user1.address,
        amount0Max: maxUint128,
        amount1Max: maxUint128
      }]);

      await expect(
        vault.burn(
          [nonfungiblePositionManagerAddress],
          [collectCalldata]
        )
      ).to.be.revertedWith("PositionVault: not a burn call");
    });

    it("should reject calldata that is too short", async function() {
      const shortCalldata = "0x4296"; // Less than 4 bytes

      await expect(
        vault.burn(
          [nonfungiblePositionManagerAddress],
          [shortCalldata]
        )
      ).to.be.revertedWith("PositionVault: invalid calldata");
    });
  });

  // Test for EIP-1271 signature validation
  describe("EIP-1271 Signature Validation", function() {
    const MAGICVALUE = "0x1626ba7e";
    let testMessage;
    let testMessageHash;

    beforeEach(async function() {
      // Create a test message
      testMessage = "Test message for EIP-1271";
      testMessageHash = ethers.hashMessage(testMessage);
    });

    it("should validate signature from owner", async function() {
      // Sign the message (not the hash) - signMessage will hash it internally
      const signature = await owner.signMessage(testMessage);

      // Verify signature through vault using the hash
      const result = await vault.isValidSignature(testMessageHash, signature);
      expect(result).to.equal(MAGICVALUE);
    });

    it("should validate signature from executor", async function() {
      // Set executor
      await vault.setExecutor(executorWallet.address);

      // Sign the message with executor's private key
      const signature = await executorWallet.signMessage(testMessage);

      // Verify signature through vault
      const result = await vault.isValidSignature(testMessageHash, signature);
      expect(result).to.equal(MAGICVALUE);
    });

    it("should reject signature from unauthorized address", async function() {
      // Sign with unauthorized user
      const signature = await user1.signMessage(testMessage);

      // Should revert with error
      await expect(
        vault.isValidSignature(testMessageHash, signature)
      ).to.be.revertedWith("PositionVault: invalid signer");
    });

    it("should reject invalid signature", async function() {
      // Create a fake signature (just random bytes)
      const fakeSignature = ethers.hexlify(ethers.randomBytes(65));

      // Should revert - ECDSA will revert with custom error for invalid signature
      await expect(
        vault.isValidSignature(testMessageHash, fakeSignature)
      ).to.be.reverted;
    });

    it("should return correct magic value on success", async function() {
      const signature = await owner.signMessage(testMessage);
      const result = await vault.isValidSignature(testMessageHash, signature);

      // Verify it's exactly the EIP-1271 magic value
      expect(result).to.equal("0x1626ba7e");
    });

    it("should work with different message hashes", async function() {
      // Test with multiple different messages
      const messages = [
        "First test message",
        "Second test message",
        "0x1234567890abcdef"
      ];

      for (const msg of messages) {
        const msgHash = ethers.hashMessage(msg);
        const signature = await owner.signMessage(msg);
        const result = await vault.isValidSignature(msgHash, signature);
        expect(result).to.equal(MAGICVALUE);
      }
    });

    it("should reject signature after executor is removed", async function() {
      // Set executor
      await vault.setExecutor(executorWallet.address);

      // Sign with executor
      const signature = await executorWallet.signMessage(testMessage);

      // Verify it works
      let result = await vault.isValidSignature(testMessageHash, signature);
      expect(result).to.equal(MAGICVALUE);

      // Remove executor
      await vault.removeExecutor();

      // Same signature should now be rejected
      await expect(
        vault.isValidSignature(testMessageHash, signature)
      ).to.be.revertedWith("PositionVault: invalid signer");
    });

    it("should validate complex EIP-712 typed data signatures (Permit2 simulation)", async function() {
      // Simulate Permit2-style EIP-712 signature
      const domain = {
        name: "Permit2",
        version: "1",
        chainId: 31337, // Hardhat default chain ID
        verifyingContract: await vault.getAddress()
      };

      const types = {
        PermitTransferFrom: [
          { name: "token", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" }
        ]
      };

      const value = {
        token: await token.getAddress(),
        amount: ethers.parseEther("100"),
        nonce: 0,
        deadline: Math.floor(Date.now() / 1000) + 3600
      };

      // Owner signs the typed data
      const signature = await owner.signTypedData(domain, types, value);

      // Compute the EIP-712 hash
      const digest = ethers.TypedDataEncoder.hash(domain, types, value);

      // Verify signature through vault
      const result = await vault.isValidSignature(digest, signature);
      expect(result).to.equal(MAGICVALUE);
    });
  });

  // Test for swap() function with command validation
  describe("Swap Function", function() {
    // Universal Router execute selector: 0x3593564c
    const EXECUTE_SELECTOR = "0x3593564c";

    // Command IDs
    const CMD = {
      V3_SWAP_EXACT_IN: 0x00,
      V3_SWAP_EXACT_OUT: 0x01,
      SWEEP: 0x04,
      TRANSFER: 0x05,
      PAY_PORTION: 0x06,
      V2_SWAP_EXACT_IN: 0x08,
      V2_SWAP_EXACT_OUT: 0x09,
      PERMIT2_PERMIT: 0x0a,
      WRAP_ETH: 0x0b,
      UNWRAP_WETH: 0x0c
    };

    // Helper to encode Universal Router execute calldata
    function encodeRouterExecute(commands, inputs, deadline = Math.floor(Date.now() / 1000) + 3600) {
      const abiCoder = ethers.AbiCoder.defaultAbiCoder();
      const commandBytes = ethers.hexlify(Uint8Array.from(commands));
      const encoded = abiCoder.encode(
        ["bytes", "bytes[]", "uint256"],
        [commandBytes, inputs, deadline]
      );
      return EXECUTE_SELECTOR + encoded.slice(2);
    }

    // Helper to encode V3 swap input
    function encodeV3SwapInput(recipient, amountIn, amountOutMin, path, payerIsUser) {
      const abiCoder = ethers.AbiCoder.defaultAbiCoder();
      return abiCoder.encode(
        ["address", "uint256", "uint256", "bytes", "bool"],
        [recipient, amountIn, amountOutMin, path, payerIsUser]
      );
    }

    // Helper to encode V2 swap input
    function encodeV2SwapInput(recipient, amountIn, amountOutMin, path, payerIsUser) {
      const abiCoder = ethers.AbiCoder.defaultAbiCoder();
      return abiCoder.encode(
        ["address", "uint256", "uint256", "address[]", "bool"],
        [recipient, amountIn, amountOutMin, path, payerIsUser]
      );
    }

    // Helper to encode generic input (for blocked commands)
    function encodeGenericInput(addr1, addr2, value) {
      const abiCoder = ethers.AbiCoder.defaultAbiCoder();
      return abiCoder.encode(["address", "address", "uint256"], [addr1, addr2, value]);
    }

    // Mock swap path
    function createMockPath(tokenIn, tokenOut) {
      const fee = "000bb8";
      return tokenIn.toLowerCase() + fee + tokenOut.toLowerCase().slice(2);
    }

    describe("Authorization", function() {
      it("should allow owner to call swap and emit TransactionExecuted with swap type", async function() {
        const vaultAddress = await vault.getAddress();
        const routerAddress = await router.getAddress();
        const tokenAddress = await token.getAddress();
        const path = createMockPath(tokenAddress, tokenAddress);

        const input = encodeV3SwapInput(vaultAddress, 1000, 900, path, true);
        const calldata = encodeRouterExecute([CMD.V3_SWAP_EXACT_IN], [input]);

        // Should emit TransactionExecuted with "swap" type
        await expect(vault.swap([routerAddress], [calldata]))
          .to.emit(vault, "TransactionExecuted")
          .withArgs(routerAddress, calldata, true, "swap");
      });

      it("should allow executor to call swap", async function() {
        await vault.setExecutor(executorWallet.address);

        const vaultAddress = await vault.getAddress();
        const routerAddress = await router.getAddress();
        const tokenAddress = await token.getAddress();
        const path = createMockPath(tokenAddress, tokenAddress);

        const input = encodeV3SwapInput(vaultAddress, 1000, 900, path, true);
        const calldata = encodeRouterExecute([CMD.V3_SWAP_EXACT_IN], [input]);

        await expect(vault.connect(executorWallet).swap([routerAddress], [calldata]))
          .to.emit(vault, "TransactionExecuted")
          .withArgs(routerAddress, calldata, true, "swap");
      });

      it("should reject unauthorized caller", async function() {
        const vaultAddress = await vault.getAddress();
        const routerAddress = await router.getAddress();
        const tokenAddress = await token.getAddress();
        const path = createMockPath(tokenAddress, tokenAddress);

        const input = encodeV3SwapInput(vaultAddress, 1000, 900, path, true);
        const calldata = encodeRouterExecute([CMD.V3_SWAP_EXACT_IN], [input]);

        await expect(vault.connect(user1).swap([routerAddress], [calldata]))
          .to.be.revertedWith("PositionVault: caller is not authorized");
      });

      it("should reject unsupported router", async function() {
        const vaultAddress = await vault.getAddress();
        const tokenAddress = await token.getAddress();
        const path = createMockPath(tokenAddress, tokenAddress);

        const input = encodeV3SwapInput(vaultAddress, 1000, 900, path, true);
        const calldata = encodeRouterExecute([CMD.V3_SWAP_EXACT_IN], [input]);

        // Use a random address as router
        await expect(vault.swap([user2.address], [calldata]))
          .to.be.revertedWith("PositionVault: unsupported router");
      });
    });

    describe("V3 Swap Commands (0x00, 0x01)", function() {
      // ADDRESS_THIS constant used by Universal Router for multi-hop swaps
      const ADDRESS_THIS = "0x0000000000000000000000000000000000000002";

      it("should allow V3_SWAP_EXACT_IN with vault as recipient", async function() {
        const vaultAddress = await vault.getAddress();
        const routerAddress = await router.getAddress();
        const tokenAddress = await token.getAddress();
        const path = createMockPath(tokenAddress, tokenAddress);

        const input = encodeV3SwapInput(vaultAddress, 1000, 900, path, true);
        const calldata = encodeRouterExecute([CMD.V3_SWAP_EXACT_IN], [input]);

        await expect(vault.swap([routerAddress], [calldata]))
          .to.not.be.revertedWith("PositionVault: swap recipient must be vault or router");
      });

      it("should allow V3_SWAP_EXACT_IN with ADDRESS_THIS as recipient (multi-hop)", async function() {
        const routerAddress = await router.getAddress();
        const tokenAddress = await token.getAddress();
        const path = createMockPath(tokenAddress, tokenAddress);

        const input = encodeV3SwapInput(ADDRESS_THIS, 1000, 900, path, true);
        const calldata = encodeRouterExecute([CMD.V3_SWAP_EXACT_IN], [input]);

        await expect(vault.swap([routerAddress], [calldata]))
          .to.not.be.revertedWith("PositionVault: swap recipient must be vault or router");
      });

      it("should reject V3_SWAP_EXACT_IN with non-vault/non-router recipient", async function() {
        const routerAddress = await router.getAddress();
        const tokenAddress = await token.getAddress();
        const path = createMockPath(tokenAddress, tokenAddress);

        const input = encodeV3SwapInput(user1.address, 1000, 900, path, true);
        const calldata = encodeRouterExecute([CMD.V3_SWAP_EXACT_IN], [input]);

        await expect(vault.swap([routerAddress], [calldata]))
          .to.be.revertedWith("PositionVault: swap recipient must be vault or router");
      });

      it("should reject V3_SWAP_EXACT_OUT with non-vault/non-router recipient", async function() {
        const routerAddress = await router.getAddress();
        const tokenAddress = await token.getAddress();
        const path = createMockPath(tokenAddress, tokenAddress);

        const input = encodeV3SwapInput(user1.address, 1000, 1100, path, true);
        const calldata = encodeRouterExecute([CMD.V3_SWAP_EXACT_OUT], [input]);

        await expect(vault.swap([routerAddress], [calldata]))
          .to.be.revertedWith("PositionVault: swap recipient must be vault or router");
      });
    });

    describe("V2 Swap Commands (0x08, 0x09)", function() {
      // ADDRESS_THIS constant used by Universal Router for multi-hop swaps
      const ADDRESS_THIS = "0x0000000000000000000000000000000000000002";

      it("should allow V2_SWAP_EXACT_IN with vault as recipient", async function() {
        const vaultAddress = await vault.getAddress();
        const routerAddress = await router.getAddress();
        const tokenAddress = await token.getAddress();
        const path = [tokenAddress, tokenAddress];

        const input = encodeV2SwapInput(vaultAddress, 1000, 900, path, true);
        const calldata = encodeRouterExecute([CMD.V2_SWAP_EXACT_IN], [input]);

        await expect(vault.swap([routerAddress], [calldata]))
          .to.not.be.revertedWith("PositionVault: swap recipient must be vault or router");
      });

      it("should allow V2_SWAP_EXACT_IN with ADDRESS_THIS as recipient (multi-hop)", async function() {
        const routerAddress = await router.getAddress();
        const tokenAddress = await token.getAddress();
        const path = [tokenAddress, tokenAddress];

        const input = encodeV2SwapInput(ADDRESS_THIS, 1000, 900, path, true);
        const calldata = encodeRouterExecute([CMD.V2_SWAP_EXACT_IN], [input]);

        await expect(vault.swap([routerAddress], [calldata]))
          .to.not.be.revertedWith("PositionVault: swap recipient must be vault or router");
      });

      it("should reject V2_SWAP_EXACT_IN with non-vault/non-router recipient", async function() {
        const routerAddress = await router.getAddress();
        const tokenAddress = await token.getAddress();
        const path = [tokenAddress, tokenAddress];

        const input = encodeV2SwapInput(user1.address, 1000, 900, path, true);
        const calldata = encodeRouterExecute([CMD.V2_SWAP_EXACT_IN], [input]);

        await expect(vault.swap([routerAddress], [calldata]))
          .to.be.revertedWith("PositionVault: swap recipient must be vault or router");
      });

      it("should reject V2_SWAP_EXACT_OUT with non-vault/non-router recipient", async function() {
        const routerAddress = await router.getAddress();
        const tokenAddress = await token.getAddress();
        const path = [tokenAddress, tokenAddress];

        const input = encodeV2SwapInput(user1.address, 1000, 1100, path, true);
        const calldata = encodeRouterExecute([CMD.V2_SWAP_EXACT_OUT], [input]);

        await expect(vault.swap([routerAddress], [calldata]))
          .to.be.revertedWith("PositionVault: swap recipient must be vault or router");
      });
    });

    describe("PERMIT2_PERMIT Command (0x0a)", function() {
      it("should allow PERMIT2_PERMIT command", async function() {
        const routerAddress = await router.getAddress();
        const abiCoder = ethers.AbiCoder.defaultAbiCoder();
        const mockPermitInput = abiCoder.encode(
          ["tuple(tuple(address,uint160,uint48,uint48),address,uint256)", "bytes"],
          [[[ethers.ZeroAddress, 0, 0, 0], ethers.ZeroAddress, 0], "0x"]
        );
        const calldata = encodeRouterExecute([CMD.PERMIT2_PERMIT], [mockPermitInput]);

        // Should not revert with command not allowed
        await expect(vault.swap([routerAddress], [calldata]))
          .to.not.be.revertedWith("PositionVault: command not allowed");
      });
    });

    describe("SWEEP Command (0x04)", function() {
      // Helper to encode SWEEP input: (address token, address recipient, uint256 amountMin)
      function encodeSweepInput(token, recipient, amountMin) {
        const abiCoder = ethers.AbiCoder.defaultAbiCoder();
        return abiCoder.encode(["address", "address", "uint256"], [token, recipient, amountMin]);
      }

      it("should allow SWEEP command with vault as recipient", async function() {
        const vaultAddress = await vault.getAddress();
        const routerAddress = await router.getAddress();
        const tokenAddress = await token.getAddress();

        const input = encodeSweepInput(tokenAddress, vaultAddress, 0);
        const calldata = encodeRouterExecute([CMD.SWEEP], [input]);

        await expect(vault.swap([routerAddress], [calldata]))
          .to.not.be.revertedWith("PositionVault: sweep recipient must be vault");
      });

      it("should reject SWEEP command with non-vault recipient", async function() {
        const routerAddress = await router.getAddress();
        const tokenAddress = await token.getAddress();

        const input = encodeSweepInput(tokenAddress, user1.address, 0);
        const calldata = encodeRouterExecute([CMD.SWEEP], [input]);

        await expect(vault.swap([routerAddress], [calldata]))
          .to.be.revertedWith("PositionVault: sweep recipient must be vault");
      });
    });

    describe("Multi-hop Swap Pattern (swap + SWEEP)", function() {
      // ADDRESS_THIS constant used by Universal Router for multi-hop swaps
      const ADDRESS_THIS = "0x0000000000000000000000000000000000000002";

      // Helper to encode SWEEP input
      function encodeSweepInput(token, recipient, amountMin) {
        const abiCoder = ethers.AbiCoder.defaultAbiCoder();
        return abiCoder.encode(["address", "address", "uint256"], [token, recipient, amountMin]);
      }

      it("should allow multi-hop pattern: V3_SWAP to ADDRESS_THIS + SWEEP to vault", async function() {
        const vaultAddress = await vault.getAddress();
        const routerAddress = await router.getAddress();
        const tokenAddress = await token.getAddress();
        const path = createMockPath(tokenAddress, tokenAddress);

        // Multi-hop: swap output stays in router, then SWEEP sends to vault
        const swapInput = encodeV3SwapInput(ADDRESS_THIS, 1000, 900, path, true);
        const sweepInput = encodeSweepInput(tokenAddress, vaultAddress, 900);
        const calldata = encodeRouterExecute(
          [CMD.V3_SWAP_EXACT_IN, CMD.SWEEP],
          [swapInput, sweepInput]
        );

        // Validation should pass - if it fails, it should be "swap failed" from mock router
        // not from our validation checks
        try {
          await vault.swap([routerAddress], [calldata]);
        } catch (error) {
          // Mock router doesn't execute real swaps, so "swap failed" is expected
          // But validation errors should NOT occur
          expect(error.message).to.include("swap failed");
          expect(error.message).to.not.include("swap recipient must be vault or router");
          expect(error.message).to.not.include("sweep recipient must be vault");
          expect(error.message).to.not.include("command not allowed");
        }
      });

      it("should reject multi-hop pattern if SWEEP recipient is not vault", async function() {
        const routerAddress = await router.getAddress();
        const tokenAddress = await token.getAddress();
        const path = createMockPath(tokenAddress, tokenAddress);

        // Multi-hop with SWEEP to wrong recipient
        const swapInput = encodeV3SwapInput(ADDRESS_THIS, 1000, 900, path, true);
        const sweepInput = encodeSweepInput(tokenAddress, user1.address, 900);
        const calldata = encodeRouterExecute(
          [CMD.V3_SWAP_EXACT_IN, CMD.SWEEP],
          [swapInput, sweepInput]
        );

        await expect(vault.swap([routerAddress], [calldata]))
          .to.be.revertedWith("PositionVault: sweep recipient must be vault");
      });
    });

    describe("Blocked Commands", function() {
      it("should reject TRANSFER command (0x05)", async function() {
        const vaultAddress = await vault.getAddress();
        const routerAddress = await router.getAddress();
        const tokenAddress = await token.getAddress();

        const input = encodeGenericInput(tokenAddress, vaultAddress, 1000);
        const calldata = encodeRouterExecute([CMD.TRANSFER], [input]);

        await expect(vault.swap([routerAddress], [calldata]))
          .to.be.revertedWith("PositionVault: command not allowed");
      });

      it("should reject PAY_PORTION command (0x06)", async function() {
        const vaultAddress = await vault.getAddress();
        const routerAddress = await router.getAddress();
        const tokenAddress = await token.getAddress();

        const input = encodeGenericInput(tokenAddress, vaultAddress, 5000);
        const calldata = encodeRouterExecute([CMD.PAY_PORTION], [input]);

        await expect(vault.swap([routerAddress], [calldata]))
          .to.be.revertedWith("PositionVault: command not allowed");
      });

      it("should reject WRAP_ETH command (0x0b)", async function() {
        const vaultAddress = await vault.getAddress();
        const routerAddress = await router.getAddress();
        const abiCoder = ethers.AbiCoder.defaultAbiCoder();
        const input = abiCoder.encode(["address", "uint256"], [vaultAddress, ethers.parseEther("1")]);
        const calldata = encodeRouterExecute([CMD.WRAP_ETH], [input]);

        await expect(vault.swap([routerAddress], [calldata]))
          .to.be.revertedWith("PositionVault: command not allowed");
      });

      it("should reject UNWRAP_WETH command (0x0c)", async function() {
        const vaultAddress = await vault.getAddress();
        const routerAddress = await router.getAddress();
        const abiCoder = ethers.AbiCoder.defaultAbiCoder();
        const input = abiCoder.encode(["address", "uint256"], [vaultAddress, ethers.parseEther("1")]);
        const calldata = encodeRouterExecute([CMD.UNWRAP_WETH], [input]);

        await expect(vault.swap([routerAddress], [calldata]))
          .to.be.revertedWith("PositionVault: command not allowed");
      });

      it("should reject unknown command (0x10 V4_SWAP)", async function() {
        const routerAddress = await router.getAddress();
        const abiCoder = ethers.AbiCoder.defaultAbiCoder();
        const input = abiCoder.encode(["bytes", "bytes[]"], ["0x", []]);
        const calldata = encodeRouterExecute([0x10], [input]);

        await expect(vault.swap([routerAddress], [calldata]))
          .to.be.revertedWith("PositionVault: command not allowed");
      });
    });

    describe("Multi-command Validation", function() {
      it("should validate all commands in a single router call", async function() {
        const vaultAddress = await vault.getAddress();
        const tokenAddress = await token.getAddress();
        const path = createMockPath(tokenAddress, tokenAddress);
        const routerAddress = await router.getAddress();

        const abiCoder = ethers.AbiCoder.defaultAbiCoder();
        const permitInput = abiCoder.encode(
          ["tuple(tuple(address,uint160,uint48,uint48),address,uint256)", "bytes"],
          [[[tokenAddress, 1000, Math.floor(Date.now()/1000) + 3600, 0], routerAddress, Math.floor(Date.now()/1000) + 3600], "0x"]
        );
        const swapInput = encodeV3SwapInput(vaultAddress, 1000, 900, path, true);

        const calldata = encodeRouterExecute(
          [CMD.PERMIT2_PERMIT, CMD.V3_SWAP_EXACT_IN],
          [permitInput, swapInput]
        );

        await expect(vault.swap([routerAddress], [calldata]))
          .to.not.be.revertedWith("PositionVault:");
      });

      it("should reject if any command has invalid recipient", async function() {
        const vaultAddress = await vault.getAddress();
        const routerAddress = await router.getAddress();
        const tokenAddress = await token.getAddress();
        const path = createMockPath(tokenAddress, tokenAddress);

        const validSwap = encodeV3SwapInput(vaultAddress, 1000, 900, path, true);
        const invalidSwap = encodeV3SwapInput(user1.address, 500, 450, path, true);

        const calldata = encodeRouterExecute(
          [CMD.V3_SWAP_EXACT_IN, CMD.V3_SWAP_EXACT_IN],
          [validSwap, invalidSwap]
        );

        await expect(vault.swap([routerAddress], [calldata]))
          .to.be.revertedWith("PositionVault: swap recipient must be vault or router");
      });

      it("should reject if any command is blocked", async function() {
        const vaultAddress = await vault.getAddress();
        const routerAddress = await router.getAddress();
        const tokenAddress = await token.getAddress();
        const path = createMockPath(tokenAddress, tokenAddress);

        const validSwap = encodeV3SwapInput(vaultAddress, 1000, 900, path, true);
        const blockedCmd = encodeGenericInput(tokenAddress, vaultAddress, 1000);

        // Use TRANSFER (0x05) as the blocked command
        const calldata = encodeRouterExecute(
          [CMD.V3_SWAP_EXACT_IN, CMD.TRANSFER],
          [validSwap, blockedCmd]
        );

        await expect(vault.swap([routerAddress], [calldata]))
          .to.be.revertedWith("PositionVault: command not allowed");
      });

      it("should execute multiple swap transactions in one call", async function() {
        const vaultAddress = await vault.getAddress();
        const routerAddress = await router.getAddress();
        const tokenAddress = await token.getAddress();
        const path = createMockPath(tokenAddress, tokenAddress);

        // Two separate swap calldatas
        const swap1Input = encodeV3SwapInput(vaultAddress, 1000, 900, path, true);
        const swap1Calldata = encodeRouterExecute([CMD.V3_SWAP_EXACT_IN], [swap1Input]);

        const swap2Input = encodeV3SwapInput(vaultAddress, 2000, 1800, path, true);
        const swap2Calldata = encodeRouterExecute([CMD.V3_SWAP_EXACT_IN], [swap2Input]);

        // Should pass validation for both (router will fail but that's ok)
        await expect(vault.swap([routerAddress, routerAddress], [swap1Calldata, swap2Calldata]))
          .to.not.be.revertedWith("PositionVault: swap recipient must be vault");
      });

      it("should reject batched swaps if any has invalid recipient", async function() {
        const vaultAddress = await vault.getAddress();
        const routerAddress = await router.getAddress();
        const tokenAddress = await token.getAddress();
        const path = createMockPath(tokenAddress, tokenAddress);

        // First swap invalid recipient (will fail validation before any execution)
        const swap1Input = encodeV3SwapInput(user1.address, 1000, 900, path, true);
        const swap1Calldata = encodeRouterExecute([CMD.V3_SWAP_EXACT_IN], [swap1Input]);

        const swap2Input = encodeV3SwapInput(vaultAddress, 2000, 1800, path, true);
        const swap2Calldata = encodeRouterExecute([CMD.V3_SWAP_EXACT_IN], [swap2Input]);

        await expect(vault.swap([routerAddress, routerAddress], [swap1Calldata, swap2Calldata]))
          .to.be.revertedWith("PositionVault: swap recipient must be vault or router");
      });
    });

    describe("Execute function (owner only)", function() {
      it("should allow owner to call execute for arbitrary calls and emit TransactionExecuted with any type", async function() {
        const tokenAddress = await token.getAddress();
        const calldata = token.interface.encodeFunctionData("transfer", [user1.address, 1]);

        await expect(vault.connect(owner).execute([tokenAddress], [calldata]))
          .to.emit(vault, "TransactionExecuted")
          .withArgs(tokenAddress, calldata, true, "any");
      });

      it("should reject executor calling execute", async function() {
        await vault.setExecutor(executorWallet.address);
        const tokenAddress = await token.getAddress();
        const calldata = token.interface.encodeFunctionData("transfer", [user1.address, 1]);

        await expect(
          vault.connect(executorWallet).execute([tokenAddress], [calldata])
        ).to.be.revertedWith("PositionVault: caller is not the owner");
      });
    });
  });
});
