const { expect } = require("chai");
const { ethers } = require('hardhat');

describe("TJPositionManager", function() {
  let owner, user1;
  let tokenX, tokenY;
  let mockLBPair, mockLBRouter;
  let positionManager;
  let vault, vaultFactory;
  let tjValidator;
  let deadline;

  // Helper to encode createPosition calldata
  function encodeCreatePosition(vaultAddr, lbPairAddr, amountX, amountY, amountXMin, amountYMin, activeIdDesired, idSlippage, deltaIds, distributionX, distributionY, deadline) {
    const iface = new ethers.Interface([
      "function createPosition(address vault, address lbPair, uint256 amountX, uint256 amountY, uint256 amountXMin, uint256 amountYMin, uint256 activeIdDesired, uint256 idSlippage, int256[] deltaIds, uint256[] distributionX, uint256[] distributionY, uint256 deadline)"
    ]);
    return iface.encodeFunctionData("createPosition", [
      vaultAddr, lbPairAddr, amountX, amountY, amountXMin, amountYMin,
      activeIdDesired, idSlippage, deltaIds, distributionX, distributionY, deadline
    ]);
  }

  beforeEach(async function() {
    [owner, user1] = await ethers.getSigners();

    // Deploy mock tokens
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    tokenX = await MockERC20.deploy("Token X", "TKX", 18);
    await tokenX.waitForDeployment();
    tokenY = await MockERC20.deploy("Token Y", "TKY", 6);
    await tokenY.waitForDeployment();

    // Sort tokens: tokenX address must be < tokenY address (Trader Joe convention)
    const tokenXAddr = await tokenX.getAddress();
    const tokenYAddr = await tokenY.getAddress();
    if (tokenXAddr.toLowerCase() > tokenYAddr.toLowerCase()) {
      [tokenX, tokenY] = [tokenY, tokenX];
    }

    // Deploy mock LB pair
    const MockLBPair = await ethers.getContractFactory("MockLBPair");
    mockLBPair = await MockLBPair.deploy(
      await tokenX.getAddress(),
      await tokenY.getAddress(),
      20 // binStep
    );
    await mockLBPair.waitForDeployment();

    // Deploy mock LB router
    const MockLBRouter = await ethers.getContractFactory("MockLBRouter");
    mockLBRouter = await MockLBRouter.deploy();
    await mockLBRouter.waitForDeployment();

    // Deploy TJPositionManager
    const TJPositionManager = await ethers.getContractFactory("TJPositionManager");
    positionManager = await TJPositionManager.deploy(await mockLBRouter.getAddress());
    await positionManager.waitForDeployment();

    // Deploy TJPositionValidator
    const TJPositionValidator = await ethers.getContractFactory("TJPositionValidator");
    tjValidator = await TJPositionValidator.deploy();
    await tjValidator.waitForDeployment();

    // Deploy VaultFactory and PositionVault infrastructure
    const MockPermit2 = await ethers.getContractFactory("MockPermit2");
    const permit2 = await MockPermit2.deploy();
    await permit2.waitForDeployment();

    const VaultFactory = await ethers.getContractFactory("VaultFactory");
    vaultFactory = await VaultFactory.deploy(owner.address, await permit2.getAddress());
    await vaultFactory.waitForDeployment();

    // Register TJ validator
    await vaultFactory.setLiquidityValidator(
      await positionManager.getAddress(),
      await tjValidator.getAddress()
    );

    // Create vault
    const tx = await vaultFactory.createVault("Test Vault");
    const receipt = await tx.wait();
    const vaultCreatedEvent = receipt.logs.find(log => {
      try {
        const parsed = vaultFactory.interface.parseLog(log);
        return parsed && parsed.name === 'VaultCreated';
      } catch {
        return false;
      }
    });
    const vaultAddress = vaultFactory.interface.parseLog(vaultCreatedEvent).args[1];

    const PositionVault = await ethers.getContractFactory("PositionVault");
    vault = PositionVault.attach(vaultAddress);

    // Mint tokens to vault
    const vaultAddr = await vault.getAddress();
    await tokenX.mint(vaultAddr, ethers.parseEther("10"));
    await tokenY.mint(vaultAddr, 10000n * 10n ** 6n); // 10,000 USDC-like

    // Vault approves TJPositionManager for both tokens
    const approveIface = new ethers.Interface([
      "function approve(address spender, uint256 amount) returns (bool)"
    ]);
    const pmAddress = await positionManager.getAddress();

    const approveXData = approveIface.encodeFunctionData("approve", [
      pmAddress, ethers.MaxUint256
    ]);
    const approveYData = approveIface.encodeFunctionData("approve", [
      pmAddress, ethers.MaxUint256
    ]);

    await vault.approve(
      [await tokenX.getAddress(), await tokenY.getAddress()],
      [approveXData, approveYData]
    );

    // Compute deadline from current block timestamp (not wall-clock time)
    // so it remains valid regardless of how many blocks have been mined
    // by other tests in the full suite
    const block = await ethers.provider.getBlock("latest");
    deadline = block.timestamp + 3600;
  });

  describe("constructor", function() {
    it("should set lbRouter address", async function() {
      expect(await positionManager.lbRouter()).to.equal(await mockLBRouter.getAddress());
    });

    it("should reject zero router address", async function() {
      const TJPositionManager = await ethers.getContractFactory("TJPositionManager");
      await expect(
        TJPositionManager.deploy(ethers.ZeroAddress)
      ).to.be.revertedWith("TJPositionManager: zero router");
    });
  });

  describe("createPosition via vault.mint()", function() {


    it("should create a position and store position data", async function() {
      const vaultAddr = await vault.getAddress();
      const lbPairAddr = await mockLBPair.getAddress();
      const pmAddr = await positionManager.getAddress();

      const calldata = encodeCreatePosition(
        vaultAddr, lbPairAddr,
        ethers.parseEther("1"), 1000n * 10n ** 6n,
        0, 0,
        8388608, 5,
        [-1, 0, 1],
        [0, ethers.parseEther("0.5"), ethers.parseEther("0.5")],
        [ethers.parseEther("0.5"), ethers.parseEther("0.5"), 0],
        deadline
      );

      await vault.mint([pmAddr], [calldata], [0n]);

      // Verify position was stored
      const position = await positionManager.getPosition(1);
      expect(position.vault).to.equal(vaultAddr);
      expect(position.lbPair).to.equal(lbPairAddr);
      expect(position.tokenX).to.equal(await tokenX.getAddress());
      expect(position.tokenY).to.equal(await tokenY.getAddress());
      expect(position.binStep).to.equal(20);
      expect(position.active).to.equal(true);
      expect(position.depositIds.length).to.equal(3);
      expect(position.liquidityMinted.length).to.equal(3);
    });

    it("should emit PositionCreated event", async function() {
      const vaultAddr = await vault.getAddress();
      const lbPairAddr = await mockLBPair.getAddress();
      const pmAddr = await positionManager.getAddress();

      const calldata = encodeCreatePosition(
        vaultAddr, lbPairAddr,
        ethers.parseEther("1"), 1000n * 10n ** 6n,
        0, 0,
        8388608, 5,
        [-1, 0, 1],
        [0, ethers.parseEther("0.5"), ethers.parseEther("0.5")],
        [ethers.parseEther("0.5"), ethers.parseEther("0.5"), 0],
        deadline
      );

      await expect(vault.mint([pmAddr], [calldata], [0n]))
        .to.emit(positionManager, "PositionCreated")
        .withArgs(
          1, // positionId
          vaultAddr,
          lbPairAddr,
          [8388607n, 8388608n, 8388609n], // depositIds from mock
          [1000n, 2000n, 1000n] // liquidityMinted from mock
        );
    });

    it("should pass correct parameters to LBRouter", async function() {
      const vaultAddr = await vault.getAddress();
      const lbPairAddr = await mockLBPair.getAddress();
      const pmAddr = await positionManager.getAddress();

      const calldata = encodeCreatePosition(
        vaultAddr, lbPairAddr,
        ethers.parseEther("1"), 1000n * 10n ** 6n,
        0, 0,
        8388608, 5,
        [-1, 0, 1],
        [0, ethers.parseEther("0.5"), ethers.parseEther("0.5")],
        [ethers.parseEther("0.5"), ethers.parseEther("0.5"), 0],
        deadline
      );

      await vault.mint([pmAddr], [calldata], [0n]);

      // Verify router received correct params
      expect(await mockLBRouter.lastTokenX()).to.equal(await tokenX.getAddress());
      expect(await mockLBRouter.lastTokenY()).to.equal(await tokenY.getAddress());
      expect(await mockLBRouter.lastBinStep()).to.equal(20);
      expect(await mockLBRouter.lastAmountX()).to.equal(ethers.parseEther("1"));
      expect(await mockLBRouter.lastAmountY()).to.equal(1000n * 10n ** 6n);
      // LB tokens go to position manager, refund to vault
      expect(await mockLBRouter.lastTo()).to.equal(pmAddr);
      expect(await mockLBRouter.lastRefundTo()).to.equal(vaultAddr);
    });

    it("should pull tokens from vault", async function() {
      const vaultAddr = await vault.getAddress();
      const lbPairAddr = await mockLBPair.getAddress();
      const pmAddr = await positionManager.getAddress();

      const beforeX = await tokenX.balanceOf(vaultAddr);
      const beforeY = await tokenY.balanceOf(vaultAddr);

      const calldata = encodeCreatePosition(
        vaultAddr, lbPairAddr,
        ethers.parseEther("1"), 1000n * 10n ** 6n,
        0, 0,
        8388608, 5,
        [-1, 0, 1],
        [0, ethers.parseEther("0.5"), ethers.parseEther("0.5")],
        [ethers.parseEther("0.5"), ethers.parseEther("0.5"), 0],
        deadline
      );

      await vault.mint([pmAddr], [calldata], [0n]);

      const afterX = await tokenX.balanceOf(vaultAddr);
      const afterY = await tokenY.balanceOf(vaultAddr);

      // Vault should have less tokens (consumed by router mock)
      expect(afterX).to.be.lt(beforeX);
      expect(afterY).to.be.lt(beforeY);
    });

    it("should reset router approvals after addLiquidity", async function() {
      const vaultAddr = await vault.getAddress();
      const lbPairAddr = await mockLBPair.getAddress();
      const pmAddr = await positionManager.getAddress();
      const routerAddr = await mockLBRouter.getAddress();

      const calldata = encodeCreatePosition(
        vaultAddr, lbPairAddr,
        ethers.parseEther("1"), 1000n * 10n ** 6n,
        0, 0,
        8388608, 5,
        [-1, 0, 1],
        [0, ethers.parseEther("0.5"), ethers.parseEther("0.5")],
        [ethers.parseEther("0.5"), ethers.parseEther("0.5"), 0],
        deadline
      );

      await vault.mint([pmAddr], [calldata], [0n]);

      // Approvals should be reset to 0
      expect(await tokenX.allowance(pmAddr, routerAddr)).to.equal(0);
      expect(await tokenY.allowance(pmAddr, routerAddr)).to.equal(0);
    });
  });

  describe("position enumeration", function() {


    it("should track multiple positions per vault", async function() {
      const vaultAddr = await vault.getAddress();
      const lbPairAddr = await mockLBPair.getAddress();
      const pmAddr = await positionManager.getAddress();

      const calldata = encodeCreatePosition(
        vaultAddr, lbPairAddr,
        ethers.parseEther("1"), 1000n * 10n ** 6n,
        0, 0,
        8388608, 5,
        [-1, 0, 1],
        [0, ethers.parseEther("0.5"), ethers.parseEther("0.5")],
        [ethers.parseEther("0.5"), ethers.parseEther("0.5"), 0],
        deadline
      );

      // Create two positions
      await vault.mint([pmAddr], [calldata], [0n]);
      await vault.mint([pmAddr], [calldata], [0n]);

      // Verify enumeration
      expect(await positionManager.getPositionCount(vaultAddr)).to.equal(2);
      const ids = await positionManager.getPositionsByVault(vaultAddr);
      expect(ids.length).to.equal(2);
      expect(ids[0]).to.equal(1);
      expect(ids[1]).to.equal(2);
    });

    it("should return correct position data for each ID", async function() {
      const vaultAddr = await vault.getAddress();
      const lbPairAddr = await mockLBPair.getAddress();
      const pmAddr = await positionManager.getAddress();

      const calldata = encodeCreatePosition(
        vaultAddr, lbPairAddr,
        ethers.parseEther("1"), 1000n * 10n ** 6n,
        0, 0,
        8388608, 5,
        [-1, 0, 1],
        [0, ethers.parseEther("0.5"), ethers.parseEther("0.5")],
        [ethers.parseEther("0.5"), ethers.parseEther("0.5"), 0],
        deadline
      );

      await vault.mint([pmAddr], [calldata], [0n]);

      const pos = await positionManager.getPosition(1);
      expect(pos.vault).to.equal(vaultAddr);
      expect(pos.lbPair).to.equal(lbPairAddr);
      expect(pos.binStep).to.equal(20);
      expect(pos.active).to.equal(true);
      expect(pos.createdAt).to.be.gt(0);
    });

    it("should return empty data for non-existent position", async function() {
      const pos = await positionManager.getPosition(999);
      expect(pos.vault).to.equal(ethers.ZeroAddress);
      expect(pos.active).to.equal(false);
    });

    it("should return zero count for vault with no positions", async function() {
      expect(await positionManager.getPositionCount(user1.address)).to.equal(0);
    });
  });

  describe("validation and security", function() {


    it("should reject when vault param does not match msg.sender", async function() {
      const vaultAddr = await vault.getAddress();
      const lbPairAddr = await mockLBPair.getAddress();
      const pmAddr = await positionManager.getAddress();

      // Encode with wrong vault address
      const calldata = encodeCreatePosition(
        user1.address, // wrong vault!
        lbPairAddr,
        ethers.parseEther("1"), 1000n * 10n ** 6n,
        0, 0,
        8388608, 5,
        [-1, 0, 1],
        [0, ethers.parseEther("0.5"), ethers.parseEther("0.5")],
        [ethers.parseEther("0.5"), ethers.parseEther("0.5"), 0],
        deadline
      );

      // Validator should catch the mismatch before the call even reaches the manager
      await expect(
        vault.mint([pmAddr], [calldata], [0n])
      ).to.be.revertedWith("TJPositionValidator: vault mismatch");
    });

    it("should reject unregistered position manager", async function() {
      const vaultAddr = await vault.getAddress();
      const lbPairAddr = await mockLBPair.getAddress();

      const calldata = encodeCreatePosition(
        vaultAddr, lbPairAddr,
        ethers.parseEther("1"), 1000n * 10n ** 6n,
        0, 0,
        8388608, 5,
        [-1, 0, 1],
        [0, ethers.parseEther("0.5"), ethers.parseEther("0.5")],
        [ethers.parseEther("0.5"), ethers.parseEther("0.5"), 0],
        deadline
      );

      await expect(
        vault.mint([user1.address], [calldata], [0n]) // unregistered target
      ).to.be.revertedWith("VaultFactory: no validator for position manager");
    });

    it("should reject zero lbPair address", async function() {
      const vaultAddr = await vault.getAddress();
      const pmAddr = await positionManager.getAddress();

      const calldata = encodeCreatePosition(
        vaultAddr, ethers.ZeroAddress, // zero lbPair!
        ethers.parseEther("1"), 1000n * 10n ** 6n,
        0, 0,
        8388608, 5,
        [-1, 0, 1],
        [0, ethers.parseEther("0.5"), ethers.parseEther("0.5")],
        [ethers.parseEther("0.5"), ethers.parseEther("0.5"), 0],
        deadline
      );

      // The vault.mint low-level call will fail; check it reverts
      // The exact error depends on whether the zero address call fails first
      await expect(
        vault.mint([pmAddr], [calldata], [0n])
      ).to.be.reverted;
    });

    it("should reject when router addLiquidity fails", async function() {
      const vaultAddr = await vault.getAddress();
      const lbPairAddr = await mockLBPair.getAddress();
      const pmAddr = await positionManager.getAddress();

      // Set router to fail
      await mockLBRouter.setShouldFail(true);

      const calldata = encodeCreatePosition(
        vaultAddr, lbPairAddr,
        ethers.parseEther("1"), 1000n * 10n ** 6n,
        0, 0,
        8388608, 5,
        [-1, 0, 1],
        [0, ethers.parseEther("0.5"), ethers.parseEther("0.5")],
        [ethers.parseEther("0.5"), ethers.parseEther("0.5"), 0],
        deadline
      );

      await expect(
        vault.mint([pmAddr], [calldata], [0n])
      ).to.be.reverted;
    });
  });

  describe("stub validator methods", function() {
    it("validateIncreaseLiquidity should revert", async function() {
      await expect(
        tjValidator.validateIncreaseLiquidity("0x", owner.address)
      ).to.be.revertedWith("TJPositionValidator: not yet implemented");
    });

    it("validateCollect should revert", async function() {
      await expect(
        tjValidator.validateCollect("0x", owner.address)
      ).to.be.revertedWith("TJPositionValidator: not yet implemented");
    });

    it("validateBurn should revert", async function() {
      await expect(
        tjValidator.validateBurn("0x", owner.address)
      ).to.be.revertedWith("TJPositionValidator: not yet implemented");
    });
  });

  describe("removePosition via vault.decreaseLiquidity()", function() {


    // Helper to encode removePosition calldata
    function encodeRemovePosition(vaultAddr, positionId, percentage, amountXMin, amountYMin, dl) {
      const iface = new ethers.Interface([
        "function removePosition(address vault, uint256 positionId, uint256 percentage, uint256 amountXMin, uint256 amountYMin, uint256 deadline)"
      ]);
      return iface.encodeFunctionData("removePosition", [
        vaultAddr, positionId, percentage, amountXMin, amountYMin, dl
      ]);
    }

    // Helper to create a position and return its ID
    async function createTestPosition() {
      const vaultAddr = await vault.getAddress();
      const lbPairAddr = await mockLBPair.getAddress();
      const pmAddr = await positionManager.getAddress();

      // Fund the mock router with tokens to send back during removal
      const routerAddr = await mockLBRouter.getAddress();
      await tokenX.mint(routerAddr, ethers.parseEther("100"));
      await tokenY.mint(routerAddr, 100000n * 10n ** 6n);

      const calldata = encodeCreatePosition(
        vaultAddr, lbPairAddr,
        ethers.parseEther("1"), 1000n * 10n ** 6n,
        0, 0,
        8388608, 5,
        [-1, 0, 1],
        [0, ethers.parseEther("0.5"), ethers.parseEther("0.5")],
        [ethers.parseEther("0.5"), ethers.parseEther("0.5"), 0],
        deadline
      );

      await vault.mint([pmAddr], [calldata], [0n]);

      const posIds = await positionManager.getPositionsByVault(vaultAddr);
      return posIds[posIds.length - 1];
    }

    it("should remove 100% of a position and mark inactive", async function() {
      const positionId = await createTestPosition();
      const vaultAddr = await vault.getAddress();
      const pmAddr = await positionManager.getAddress();

      const calldata = encodeRemovePosition(vaultAddr, positionId, 100, 0, 0, deadline);
      await vault.decreaseLiquidity([pmAddr], [calldata]);

      const pos = await positionManager.getPosition(positionId);
      expect(pos.active).to.equal(false);
      expect(pos.depositIds.length).to.equal(0);
      expect(pos.liquidityMinted.length).to.equal(0);
    });

    it("should remove 50% of a position and keep active with reduced liquidity", async function() {
      const positionId = await createTestPosition();
      const vaultAddr = await vault.getAddress();
      const pmAddr = await positionManager.getAddress();

      // Get original liquidity values
      const posBefore = await positionManager.getPosition(positionId);
      const origLiquidity = posBefore.liquidityMinted.map(lm => lm);

      const calldata = encodeRemovePosition(vaultAddr, positionId, 50, 0, 0, deadline);
      await vault.decreaseLiquidity([pmAddr], [calldata]);

      const posAfter = await positionManager.getPosition(positionId);
      expect(posAfter.active).to.equal(true);
      expect(posAfter.depositIds.length).to.equal(3);
      expect(posAfter.liquidityMinted.length).to.equal(3);

      // Each liquidityMinted should be halved
      for (let i = 0; i < posAfter.liquidityMinted.length; i++) {
        expect(posAfter.liquidityMinted[i]).to.equal(origLiquidity[i] / 2n);
      }
    });

    it("should emit PositionRemoved event", async function() {
      const positionId = await createTestPosition();
      const vaultAddr = await vault.getAddress();
      const pmAddr = await positionManager.getAddress();
      const lbPairAddr = await mockLBPair.getAddress();

      const calldata = encodeRemovePosition(vaultAddr, positionId, 100, 0, 0, deadline);

      await expect(vault.decreaseLiquidity([pmAddr], [calldata]))
        .to.emit(positionManager, "PositionRemoved");
    });

    it("should pass correct parameters to LBRouter.removeLiquidity", async function() {
      const positionId = await createTestPosition();
      const vaultAddr = await vault.getAddress();
      const pmAddr = await positionManager.getAddress();

      const calldata = encodeRemovePosition(vaultAddr, positionId, 100, 500, 600, deadline);
      await vault.decreaseLiquidity([pmAddr], [calldata]);

      // Verify router received correct params
      expect(await mockLBRouter.lastRemoveTokenX()).to.equal(await tokenX.getAddress());
      expect(await mockLBRouter.lastRemoveTokenY()).to.equal(await tokenY.getAddress());
      expect(await mockLBRouter.lastRemoveBinStep()).to.equal(20);
      expect(await mockLBRouter.lastRemoveAmountXMin()).to.equal(500);
      expect(await mockLBRouter.lastRemoveAmountYMin()).to.equal(600);
      expect(await mockLBRouter.lastRemoveTo()).to.equal(vaultAddr);
    });

    it("should send scaled amounts to router for 100% removal", async function() {
      const positionId = await createTestPosition();
      const vaultAddr = await vault.getAddress();
      const pmAddr = await positionManager.getAddress();

      // Mock returns liquidityMinted = [1000, 2000, 1000]
      // 100% -> amounts = [1000, 2000, 1000]
      const calldata = encodeRemovePosition(vaultAddr, positionId, 100, 0, 0, deadline);
      await vault.decreaseLiquidity([pmAddr], [calldata]);

      // Verify amounts passed to router
      expect(await mockLBRouter.lastRemoveAmounts(0)).to.equal(1000);
      expect(await mockLBRouter.lastRemoveAmounts(1)).to.equal(2000);
      expect(await mockLBRouter.lastRemoveAmounts(2)).to.equal(1000);
    });

    it("should send scaled amounts to router for 50% removal", async function() {
      const positionId = await createTestPosition();
      const vaultAddr = await vault.getAddress();
      const pmAddr = await positionManager.getAddress();

      // Mock returns liquidityMinted = [1000, 2000, 1000]
      // 50% -> amounts = [500, 1000, 500]
      const calldata = encodeRemovePosition(vaultAddr, positionId, 50, 0, 0, deadline);
      await vault.decreaseLiquidity([pmAddr], [calldata]);

      expect(await mockLBRouter.lastRemoveAmounts(0)).to.equal(500);
      expect(await mockLBRouter.lastRemoveAmounts(1)).to.equal(1000);
      expect(await mockLBRouter.lastRemoveAmounts(2)).to.equal(500);
    });

    it("should send deposit IDs to router", async function() {
      const positionId = await createTestPosition();
      const vaultAddr = await vault.getAddress();
      const pmAddr = await positionManager.getAddress();

      const calldata = encodeRemovePosition(vaultAddr, positionId, 100, 0, 0, deadline);
      await vault.decreaseLiquidity([pmAddr], [calldata]);

      // Mock depositIds = [8388607, 8388608, 8388609]
      expect(await mockLBRouter.lastRemoveIds(0)).to.equal(8388607);
      expect(await mockLBRouter.lastRemoveIds(1)).to.equal(8388608);
      expect(await mockLBRouter.lastRemoveIds(2)).to.equal(8388609);
    });

    it("should send tokens back to vault via router", async function() {
      const positionId = await createTestPosition();
      const vaultAddr = await vault.getAddress();
      const pmAddr = await positionManager.getAddress();

      // Set router to return specific amounts
      await mockLBRouter.setRemoveReturnValues(ethers.parseEther("0.5"), 500n * 10n ** 6n);

      const beforeX = await tokenX.balanceOf(vaultAddr);
      const beforeY = await tokenY.balanceOf(vaultAddr);

      const calldata = encodeRemovePosition(vaultAddr, positionId, 100, 0, 0, deadline);
      await vault.decreaseLiquidity([pmAddr], [calldata]);

      const afterX = await tokenX.balanceOf(vaultAddr);
      const afterY = await tokenY.balanceOf(vaultAddr);

      // Vault should have received tokens
      expect(afterX - beforeX).to.equal(ethers.parseEther("0.5"));
      expect(afterY - beforeY).to.equal(500n * 10n ** 6n);
    });

    it("should approve and then reset LBPair approvals for router", async function() {
      const positionId = await createTestPosition();
      const vaultAddr = await vault.getAddress();
      const pmAddr = await positionManager.getAddress();
      const routerAddr = await mockLBRouter.getAddress();

      const calldata = encodeRemovePosition(vaultAddr, positionId, 100, 0, 0, deadline);
      await vault.decreaseLiquidity([pmAddr], [calldata]);

      // After removal, approval should be reset to false
      const approved = await mockLBPair.isApprovedForAll(pmAddr, routerAddr);
      expect(approved).to.equal(false);
    });

    describe("validation and security", function() {
      it("should reject when vault param does not match msg.sender", async function() {
        const positionId = await createTestPosition();
        const pmAddr = await positionManager.getAddress();

        const calldata = encodeRemovePosition(user1.address, positionId, 100, 0, 0, deadline);

        await expect(
          vault.decreaseLiquidity([pmAddr], [calldata])
        ).to.be.revertedWith("TJPositionValidator: vault mismatch");
      });

      it("should reject when position is not owned by vault", async function() {
        // Create position from our vault
        const positionId = await createTestPosition();
        const pmAddr = await positionManager.getAddress();

        // Try to remove from a different vault (user1 directly calling)
        // This should fail because msg.sender != vault param
        await expect(
          positionManager.connect(user1).removePosition(
            user1.address, positionId, 100, 0, 0, deadline
          )
        ).to.be.revertedWith("TJPositionManager: not position owner");
      });

      it("should reject when position is not active", async function() {
        const positionId = await createTestPosition();
        const vaultAddr = await vault.getAddress();
        const pmAddr = await positionManager.getAddress();

        // Remove 100% first
        const calldata1 = encodeRemovePosition(vaultAddr, positionId, 100, 0, 0, deadline);
        await vault.decreaseLiquidity([pmAddr], [calldata1]);

        // Try to remove again - should fail
        const calldata2 = encodeRemovePosition(vaultAddr, positionId, 100, 0, 0, deadline);
        await expect(
          vault.decreaseLiquidity([pmAddr], [calldata2])
        ).to.be.reverted;
      });

      it("should reject percentage of 0", async function() {
        const positionId = await createTestPosition();
        const vaultAddr = await vault.getAddress();
        const pmAddr = await positionManager.getAddress();

        const calldata = encodeRemovePosition(vaultAddr, positionId, 0, 0, 0, deadline);
        await expect(
          vault.decreaseLiquidity([pmAddr], [calldata])
        ).to.be.reverted;
      });

      it("should reject percentage over 100", async function() {
        const positionId = await createTestPosition();
        const vaultAddr = await vault.getAddress();
        const pmAddr = await positionManager.getAddress();

        const calldata = encodeRemovePosition(vaultAddr, positionId, 101, 0, 0, deadline);
        await expect(
          vault.decreaseLiquidity([pmAddr], [calldata])
        ).to.be.reverted;
      });

      it("should reject when router removeLiquidity fails", async function() {
        const positionId = await createTestPosition();
        const vaultAddr = await vault.getAddress();
        const pmAddr = await positionManager.getAddress();

        await mockLBRouter.setShouldFailRemove(true);

        const calldata = encodeRemovePosition(vaultAddr, positionId, 100, 0, 0, deadline);
        await expect(
          vault.decreaseLiquidity([pmAddr], [calldata])
        ).to.be.reverted;
      });

      it("should reject non-removePosition selector via validator", async function() {
        const pmAddr = await positionManager.getAddress();
        const fakeCalldata = "0xdeadbeef" + "00".repeat(32);

        await expect(
          vault.decreaseLiquidity([pmAddr], [fakeCalldata])
        ).to.be.revertedWith("TJPositionValidator: not removePosition");
      });
    });

    describe("sequential operations", function() {
      it("should allow partial then full removal", async function() {
        const positionId = await createTestPosition();
        const vaultAddr = await vault.getAddress();
        const pmAddr = await positionManager.getAddress();

        // Remove 50%
        const calldata1 = encodeRemovePosition(vaultAddr, positionId, 50, 0, 0, deadline);
        await vault.decreaseLiquidity([pmAddr], [calldata1]);

        let pos = await positionManager.getPosition(positionId);
        expect(pos.active).to.equal(true);
        expect(pos.liquidityMinted[0]).to.equal(500); // 1000 / 2

        // Remove remaining 100% of what's left
        const calldata2 = encodeRemovePosition(vaultAddr, positionId, 100, 0, 0, deadline);
        await vault.decreaseLiquidity([pmAddr], [calldata2]);

        pos = await positionManager.getPosition(positionId);
        expect(pos.active).to.equal(false);
        expect(pos.depositIds.length).to.equal(0);
        expect(pos.liquidityMinted.length).to.equal(0);
      });

      it("should allow multiple partial removals", async function() {
        const positionId = await createTestPosition();
        const vaultAddr = await vault.getAddress();
        const pmAddr = await positionManager.getAddress();

        // Remove 25% three times
        for (let i = 0; i < 3; i++) {
          const calldata = encodeRemovePosition(vaultAddr, positionId, 25, 0, 0, deadline);
          await vault.decreaseLiquidity([pmAddr], [calldata]);
        }

        const pos = await positionManager.getPosition(positionId);
        expect(pos.active).to.equal(true);
        // Original: [1000, 2000, 1000]
        // After 3x 25%: depends on integer truncation
        // Round 1: remove [250, 500, 250] -> [750, 1500, 750]
        // Round 2: remove [187, 375, 187] -> [563, 1125, 563]
        // Round 3: remove [140, 281, 140] -> [423, 844, 423]
        expect(pos.liquidityMinted[0]).to.equal(423);
        expect(pos.liquidityMinted[1]).to.equal(844);
        expect(pos.liquidityMinted[2]).to.equal(423);
      });
    });
  });
});
