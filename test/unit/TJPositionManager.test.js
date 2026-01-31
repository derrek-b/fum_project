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

  describe("addToPosition via vault.increaseLiquidity()", function() {

    // Helper to encode addToPosition calldata
    function encodeAddToPosition(vaultAddr, positionId, amountX, amountY, amountXMin, amountYMin, activeIdDesired, idSlippage, deltaIds, distributionX, distributionY, dl) {
      const iface = new ethers.Interface([
        "function addToPosition(address vault, uint256 positionId, uint256 amountX, uint256 amountY, uint256 amountXMin, uint256 amountYMin, uint256 activeIdDesired, uint256 idSlippage, int256[] deltaIds, uint256[] distributionX, uint256[] distributionY, uint256 deadline)"
      ]);
      return iface.encodeFunctionData("addToPosition", [
        vaultAddr, positionId, amountX, amountY, amountXMin, amountYMin,
        activeIdDesired, idSlippage, deltaIds, distributionX, distributionY, dl
      ]);
    }

    // Helper to create a position and return its ID (also funds router for removals)
    async function createTestPosition() {
      const vaultAddr = await vault.getAddress();
      const lbPairAddr = await mockLBPair.getAddress();
      const pmAddr = await positionManager.getAddress();

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

    describe("basic operations", function() {
      it("should add liquidity to existing position with same bins", async function() {
        const positionId = await createTestPosition();
        const vaultAddr = await vault.getAddress();
        const pmAddr = await positionManager.getAddress();

        // Default mock returns same 3 bins: [8388607, 8388608, 8388609] with [1000, 2000, 1000]
        const calldata = encodeAddToPosition(
          vaultAddr, positionId,
          ethers.parseEther("1"), 1000n * 10n ** 6n,
          0, 0,
          8388608, 5,
          [-1, 0, 1],
          [0, ethers.parseEther("0.5"), ethers.parseEther("0.5")],
          [ethers.parseEther("0.5"), ethers.parseEther("0.5"), 0],
          deadline
        );

        await vault.increaseLiquidity([pmAddr], [calldata], [0n]);

        const pos = await positionManager.getPosition(positionId);
        expect(pos.active).to.equal(true);
        // Same 3 bins, liquidity doubled
        expect(pos.depositIds.length).to.equal(3);
        expect(pos.liquidityMinted[0]).to.equal(2000); // 1000 + 1000
        expect(pos.liquidityMinted[1]).to.equal(4000); // 2000 + 2000
        expect(pos.liquidityMinted[2]).to.equal(2000); // 1000 + 1000
      });

      it("should add liquidity with new bins extending the range", async function() {
        const positionId = await createTestPosition();
        const vaultAddr = await vault.getAddress();
        const pmAddr = await positionManager.getAddress();

        // Reconfigure mock to return entirely new bins
        await mockLBRouter.setReturnValues(
          ethers.parseEther("1"), 1000n * 10n ** 6n, 0, 0,
          [8388610, 8388611], // new bins beyond original range
          [500, 500]
        );

        const calldata = encodeAddToPosition(
          vaultAddr, positionId,
          ethers.parseEther("1"), 1000n * 10n ** 6n,
          0, 0,
          8388608, 5,
          [2, 3],
          [ethers.parseEther("0.5"), ethers.parseEther("0.5")],
          [0, 0],
          deadline
        );

        await vault.increaseLiquidity([pmAddr], [calldata], [0n]);

        const pos = await positionManager.getPosition(positionId);
        // Original 3 + 2 new = 5 bins
        expect(pos.depositIds.length).to.equal(5);
        expect(pos.depositIds[3]).to.equal(8388610n);
        expect(pos.depositIds[4]).to.equal(8388611n);
        expect(pos.liquidityMinted[3]).to.equal(500);
        expect(pos.liquidityMinted[4]).to.equal(500);
        // Original bins unchanged
        expect(pos.liquidityMinted[0]).to.equal(1000);
        expect(pos.liquidityMinted[1]).to.equal(2000);
        expect(pos.liquidityMinted[2]).to.equal(1000);
      });

      it("should add liquidity with partially overlapping bins", async function() {
        const positionId = await createTestPosition();
        const vaultAddr = await vault.getAddress();
        const pmAddr = await positionManager.getAddress();

        // Reconfigure mock: bins [8388608, 8388609, 8388610]
        // overlaps original [8388607, 8388608, 8388609] on bins 8388608 and 8388609
        await mockLBRouter.setReturnValues(
          ethers.parseEther("1"), 1000n * 10n ** 6n, 0, 0,
          [8388608, 8388609, 8388610],
          [300, 400, 500]
        );

        const calldata = encodeAddToPosition(
          vaultAddr, positionId,
          ethers.parseEther("1"), 1000n * 10n ** 6n,
          0, 0,
          8388608, 5,
          [0, 1, 2],
          [0, ethers.parseEther("0.333"), ethers.parseEther("0.667")],
          [ethers.parseEther("1"), 0, 0],
          deadline
        );

        await vault.increaseLiquidity([pmAddr], [calldata], [0n]);

        const pos = await positionManager.getPosition(positionId);
        // Original 3 bins + 1 new = 4 total
        expect(pos.depositIds.length).to.equal(4);
        // Bin 8388607: unchanged
        expect(pos.liquidityMinted[0]).to.equal(1000);
        // Bin 8388608: 2000 + 300 = 2300
        expect(pos.liquidityMinted[1]).to.equal(2300);
        // Bin 8388609: 1000 + 400 = 1400
        expect(pos.liquidityMinted[2]).to.equal(1400);
        // Bin 8388610: new, 500
        expect(pos.depositIds[3]).to.equal(8388610n);
        expect(pos.liquidityMinted[3]).to.equal(500);
      });

      it("should emit PositionIncreased event with correct args", async function() {
        const positionId = await createTestPosition();
        const vaultAddr = await vault.getAddress();
        const pmAddr = await positionManager.getAddress();
        const lbPairAddr = await mockLBPair.getAddress();

        const calldata = encodeAddToPosition(
          vaultAddr, positionId,
          ethers.parseEther("1"), 1000n * 10n ** 6n,
          0, 0,
          8388608, 5,
          [-1, 0, 1],
          [0, ethers.parseEther("0.5"), ethers.parseEther("0.5")],
          [ethers.parseEther("0.5"), ethers.parseEther("0.5"), 0],
          deadline
        );

        await expect(vault.increaseLiquidity([pmAddr], [calldata], [0n]))
          .to.emit(positionManager, "PositionIncreased")
          .withArgs(
            positionId,
            vaultAddr,
            lbPairAddr,
            ethers.parseEther("1"), // amountXAdded from mock
            1000n * 10n ** 6n       // amountYAdded from mock
          );
      });

      it("should pass correct parameters to LBRouter.addLiquidity()", async function() {
        const positionId = await createTestPosition();
        const vaultAddr = await vault.getAddress();
        const pmAddr = await positionManager.getAddress();

        const calldata = encodeAddToPosition(
          vaultAddr, positionId,
          ethers.parseEther("2"), 2000n * 10n ** 6n,
          0, 0,
          8388608, 5,
          [-1, 0, 1],
          [0, ethers.parseEther("0.5"), ethers.parseEther("0.5")],
          [ethers.parseEther("0.5"), ethers.parseEther("0.5"), 0],
          deadline
        );

        await vault.increaseLiquidity([pmAddr], [calldata], [0n]);

        // Verify router received correct params
        expect(await mockLBRouter.lastTokenX()).to.equal(await tokenX.getAddress());
        expect(await mockLBRouter.lastTokenY()).to.equal(await tokenY.getAddress());
        expect(await mockLBRouter.lastBinStep()).to.equal(20);
        expect(await mockLBRouter.lastAmountX()).to.equal(ethers.parseEther("2"));
        expect(await mockLBRouter.lastAmountY()).to.equal(2000n * 10n ** 6n);
        expect(await mockLBRouter.lastTo()).to.equal(pmAddr);
        expect(await mockLBRouter.lastRefundTo()).to.equal(vaultAddr);
      });

      it("should pull tokens from vault", async function() {
        const positionId = await createTestPosition();
        const vaultAddr = await vault.getAddress();
        const pmAddr = await positionManager.getAddress();

        const beforeX = await tokenX.balanceOf(vaultAddr);
        const beforeY = await tokenY.balanceOf(vaultAddr);

        const calldata = encodeAddToPosition(
          vaultAddr, positionId,
          ethers.parseEther("1"), 1000n * 10n ** 6n,
          0, 0,
          8388608, 5,
          [-1, 0, 1],
          [0, ethers.parseEther("0.5"), ethers.parseEther("0.5")],
          [ethers.parseEther("0.5"), ethers.parseEther("0.5"), 0],
          deadline
        );

        await vault.increaseLiquidity([pmAddr], [calldata], [0n]);

        const afterX = await tokenX.balanceOf(vaultAddr);
        const afterY = await tokenY.balanceOf(vaultAddr);

        expect(afterX).to.be.lt(beforeX);
        expect(afterY).to.be.lt(beforeY);
      });

      it("should reset token approvals after execution", async function() {
        const positionId = await createTestPosition();
        const vaultAddr = await vault.getAddress();
        const pmAddr = await positionManager.getAddress();
        const routerAddr = await mockLBRouter.getAddress();

        const calldata = encodeAddToPosition(
          vaultAddr, positionId,
          ethers.parseEther("1"), 1000n * 10n ** 6n,
          0, 0,
          8388608, 5,
          [-1, 0, 1],
          [0, ethers.parseEther("0.5"), ethers.parseEther("0.5")],
          [ethers.parseEther("0.5"), ethers.parseEther("0.5"), 0],
          deadline
        );

        await vault.increaseLiquidity([pmAddr], [calldata], [0n]);

        expect(await tokenX.allowance(pmAddr, routerAddr)).to.equal(0);
        expect(await tokenY.allowance(pmAddr, routerAddr)).to.equal(0);
      });
    });

    describe("position state verification", function() {
      it("should keep position active after addToPosition", async function() {
        const positionId = await createTestPosition();
        const vaultAddr = await vault.getAddress();
        const pmAddr = await positionManager.getAddress();

        const calldata = encodeAddToPosition(
          vaultAddr, positionId,
          ethers.parseEther("1"), 1000n * 10n ** 6n,
          0, 0,
          8388608, 5,
          [-1, 0, 1],
          [0, ethers.parseEther("0.5"), ethers.parseEther("0.5")],
          [ethers.parseEther("0.5"), ethers.parseEther("0.5"), 0],
          deadline
        );

        await vault.increaseLiquidity([pmAddr], [calldata], [0n]);

        const pos = await positionManager.getPosition(positionId);
        expect(pos.active).to.equal(true);
        expect(pos.vault).to.equal(vaultAddr);
        expect(pos.lbPair).to.equal(await mockLBPair.getAddress());
        expect(pos.tokenX).to.equal(await tokenX.getAddress());
        expect(pos.tokenY).to.equal(await tokenY.getAddress());
        expect(pos.binStep).to.equal(20);
      });

      it("should work after partial removal then add back", async function() {
        const positionId = await createTestPosition();
        const vaultAddr = await vault.getAddress();
        const pmAddr = await positionManager.getAddress();

        // Remove 50%
        const removeIface = new ethers.Interface([
          "function removePosition(address vault, uint256 positionId, uint256 percentage, uint256 amountXMin, uint256 amountYMin, uint256 deadline)"
        ]);
        const removeCalldata = removeIface.encodeFunctionData("removePosition", [
          vaultAddr, positionId, 50, 0, 0, deadline
        ]);
        await vault.decreaseLiquidity([pmAddr], [removeCalldata]);

        // Verify halved
        let pos = await positionManager.getPosition(positionId);
        expect(pos.liquidityMinted[0]).to.equal(500);
        expect(pos.liquidityMinted[1]).to.equal(1000);
        expect(pos.liquidityMinted[2]).to.equal(500);

        // Add back with same bins (default mock returns [1000, 2000, 1000])
        const addCalldata = encodeAddToPosition(
          vaultAddr, positionId,
          ethers.parseEther("1"), 1000n * 10n ** 6n,
          0, 0,
          8388608, 5,
          [-1, 0, 1],
          [0, ethers.parseEther("0.5"), ethers.parseEther("0.5")],
          [ethers.parseEther("0.5"), ethers.parseEther("0.5"), 0],
          deadline
        );
        await vault.increaseLiquidity([pmAddr], [addCalldata], [0n]);

        pos = await positionManager.getPosition(positionId);
        expect(pos.active).to.equal(true);
        // 500 + 1000 = 1500, 1000 + 2000 = 3000, 500 + 1000 = 1500
        expect(pos.liquidityMinted[0]).to.equal(1500);
        expect(pos.liquidityMinted[1]).to.equal(3000);
        expect(pos.liquidityMinted[2]).to.equal(1500);
      });
    });

    describe("validation and security", function() {
      it("should revert if vault mismatch in calldata", async function() {
        const positionId = await createTestPosition();
        const pmAddr = await positionManager.getAddress();

        const calldata = encodeAddToPosition(
          user1.address, // wrong vault
          positionId,
          ethers.parseEther("1"), 1000n * 10n ** 6n,
          0, 0,
          8388608, 5,
          [-1, 0, 1],
          [0, ethers.parseEther("0.5"), ethers.parseEther("0.5")],
          [ethers.parseEther("0.5"), ethers.parseEther("0.5"), 0],
          deadline
        );

        await expect(
          vault.increaseLiquidity([pmAddr], [calldata], [0n])
        ).to.be.revertedWith("TJPositionValidator: vault mismatch");
      });

      it("should revert if position doesn't exist", async function() {
        const vaultAddr = await vault.getAddress();
        const pmAddr = await positionManager.getAddress();

        const calldata = encodeAddToPosition(
          vaultAddr, 999, // non-existent
          ethers.parseEther("1"), 1000n * 10n ** 6n,
          0, 0,
          8388608, 5,
          [-1, 0, 1],
          [0, ethers.parseEther("0.5"), ethers.parseEther("0.5")],
          [ethers.parseEther("0.5"), ethers.parseEther("0.5"), 0],
          deadline
        );

        await expect(
          vault.increaseLiquidity([pmAddr], [calldata], [0n])
        ).to.be.reverted;
      });

      it("should revert if position is not active (fully removed)", async function() {
        const positionId = await createTestPosition();
        const vaultAddr = await vault.getAddress();
        const pmAddr = await positionManager.getAddress();

        // Remove 100%
        const removeIface = new ethers.Interface([
          "function removePosition(address vault, uint256 positionId, uint256 percentage, uint256 amountXMin, uint256 amountYMin, uint256 deadline)"
        ]);
        const removeCalldata = removeIface.encodeFunctionData("removePosition", [
          vaultAddr, positionId, 100, 0, 0, deadline
        ]);
        await vault.decreaseLiquidity([pmAddr], [removeCalldata]);

        // Try to add to inactive position
        const addCalldata = encodeAddToPosition(
          vaultAddr, positionId,
          ethers.parseEther("1"), 1000n * 10n ** 6n,
          0, 0,
          8388608, 5,
          [-1, 0, 1],
          [0, ethers.parseEther("0.5"), ethers.parseEther("0.5")],
          [ethers.parseEther("0.5"), ethers.parseEther("0.5"), 0],
          deadline
        );

        await expect(
          vault.increaseLiquidity([pmAddr], [addCalldata], [0n])
        ).to.be.reverted;
      });

      it("should revert if caller is not position owner", async function() {
        const positionId = await createTestPosition();
        const pmAddr = await positionManager.getAddress();

        // Direct call from user1 who doesn't own the position
        await expect(
          positionManager.connect(user1).addToPosition(
            user1.address, positionId,
            ethers.parseEther("1"), 1000n * 10n ** 6n,
            0, 0,
            8388608, 5,
            [-1, 0, 1],
            [0, ethers.parseEther("0.5"), ethers.parseEther("0.5")],
            [ethers.parseEther("0.5"), ethers.parseEther("0.5"), 0],
            deadline
          )
        ).to.be.revertedWith("TJPositionManager: not position owner");
      });

      it("should revert if router addLiquidity fails", async function() {
        const positionId = await createTestPosition();
        const vaultAddr = await vault.getAddress();
        const pmAddr = await positionManager.getAddress();

        await mockLBRouter.setShouldFail(true);

        const calldata = encodeAddToPosition(
          vaultAddr, positionId,
          ethers.parseEther("1"), 1000n * 10n ** 6n,
          0, 0,
          8388608, 5,
          [-1, 0, 1],
          [0, ethers.parseEther("0.5"), ethers.parseEther("0.5")],
          [ethers.parseEther("0.5"), ethers.parseEther("0.5"), 0],
          deadline
        );

        await expect(
          vault.increaseLiquidity([pmAddr], [calldata], [0n])
        ).to.be.reverted;
      });

      it("should reject non-addToPosition selector via validator", async function() {
        const pmAddr = await positionManager.getAddress();
        const fakeCalldata = "0xdeadbeef" + "00".repeat(32);

        await expect(
          vault.increaseLiquidity([pmAddr], [fakeCalldata], [0n])
        ).to.be.revertedWith("TJPositionValidator: not addToPosition");
      });
    });

    describe("sequential operations", function() {
      it("should support multiple addToPosition calls on same position", async function() {
        const positionId = await createTestPosition();
        const vaultAddr = await vault.getAddress();
        const pmAddr = await positionManager.getAddress();

        // Default mock: same 3 bins [1000, 2000, 1000]
        const calldata = encodeAddToPosition(
          vaultAddr, positionId,
          ethers.parseEther("1"), 1000n * 10n ** 6n,
          0, 0,
          8388608, 5,
          [-1, 0, 1],
          [0, ethers.parseEther("0.5"), ethers.parseEther("0.5")],
          [ethers.parseEther("0.5"), ethers.parseEther("0.5"), 0],
          deadline
        );

        // Add twice
        await vault.increaseLiquidity([pmAddr], [calldata], [0n]);
        await vault.increaseLiquidity([pmAddr], [calldata], [0n]);

        const pos = await positionManager.getPosition(positionId);
        expect(pos.depositIds.length).to.equal(3);
        // Original [1000, 2000, 1000] + [1000, 2000, 1000] + [1000, 2000, 1000]
        expect(pos.liquidityMinted[0]).to.equal(3000);
        expect(pos.liquidityMinted[1]).to.equal(6000);
        expect(pos.liquidityMinted[2]).to.equal(3000);
      });

      it("should work correctly with create → add → remove(100%)", async function() {
        const positionId = await createTestPosition();
        const vaultAddr = await vault.getAddress();
        const pmAddr = await positionManager.getAddress();

        // Add to position
        const addCalldata = encodeAddToPosition(
          vaultAddr, positionId,
          ethers.parseEther("1"), 1000n * 10n ** 6n,
          0, 0,
          8388608, 5,
          [-1, 0, 1],
          [0, ethers.parseEther("0.5"), ethers.parseEther("0.5")],
          [ethers.parseEther("0.5"), ethers.parseEther("0.5"), 0],
          deadline
        );
        await vault.increaseLiquidity([pmAddr], [addCalldata], [0n]);

        // Verify doubled
        let pos = await positionManager.getPosition(positionId);
        expect(pos.liquidityMinted[0]).to.equal(2000);

        // Remove 100%
        const removeIface = new ethers.Interface([
          "function removePosition(address vault, uint256 positionId, uint256 percentage, uint256 amountXMin, uint256 amountYMin, uint256 deadline)"
        ]);
        const removeCalldata = removeIface.encodeFunctionData("removePosition", [
          vaultAddr, positionId, 100, 0, 0, deadline
        ]);
        await vault.decreaseLiquidity([pmAddr], [removeCalldata]);

        pos = await positionManager.getPosition(positionId);
        expect(pos.active).to.equal(false);
        expect(pos.depositIds.length).to.equal(0);
        expect(pos.liquidityMinted.length).to.equal(0);
      });

      it("should correctly merge bins across multiple additions", async function() {
        const positionId = await createTestPosition();
        const vaultAddr = await vault.getAddress();
        const pmAddr = await positionManager.getAddress();

        // First add: extend right with [8388609, 8388610]
        await mockLBRouter.setReturnValues(
          ethers.parseEther("1"), 1000n * 10n ** 6n, 0, 0,
          [8388609, 8388610],
          [100, 200]
        );

        let calldata = encodeAddToPosition(
          vaultAddr, positionId,
          ethers.parseEther("1"), 1000n * 10n ** 6n,
          0, 0,
          8388608, 5,
          [1, 2],
          [ethers.parseEther("0.5"), ethers.parseEther("0.5")],
          [0, 0],
          deadline
        );
        await vault.increaseLiquidity([pmAddr], [calldata], [0n]);

        // Second add: extend left with [8388606, 8388607]
        await mockLBRouter.setReturnValues(
          ethers.parseEther("1"), 1000n * 10n ** 6n, 0, 0,
          [8388606, 8388607],
          [300, 400]
        );

        calldata = encodeAddToPosition(
          vaultAddr, positionId,
          ethers.parseEther("1"), 1000n * 10n ** 6n,
          0, 0,
          8388608, 5,
          [-2, -1],
          [0, 0],
          [ethers.parseEther("0.5"), ethers.parseEther("0.5")],
          deadline
        );
        await vault.increaseLiquidity([pmAddr], [calldata], [0n]);

        const pos = await positionManager.getPosition(positionId);
        // Original: [8388607, 8388608, 8388609]
        // After first add: [8388607, 8388608, 8388609, 8388610]
        // After second add: [8388607, 8388608, 8388609, 8388610, 8388606]
        expect(pos.depositIds.length).to.equal(5);

        // Bin 8388607: 1000 + 400 = 1400
        expect(pos.depositIds[0]).to.equal(8388607n);
        expect(pos.liquidityMinted[0]).to.equal(1400);
        // Bin 8388608: unchanged at 2000
        expect(pos.depositIds[1]).to.equal(8388608n);
        expect(pos.liquidityMinted[1]).to.equal(2000);
        // Bin 8388609: 1000 + 100 = 1100
        expect(pos.depositIds[2]).to.equal(8388609n);
        expect(pos.liquidityMinted[2]).to.equal(1100);
        // Bin 8388610: new at 200
        expect(pos.depositIds[3]).to.equal(8388610n);
        expect(pos.liquidityMinted[3]).to.equal(200);
        // Bin 8388606: new at 300
        expect(pos.depositIds[4]).to.equal(8388606n);
        expect(pos.liquidityMinted[4]).to.equal(300);
      });
    });
  });

  describe("stub validator methods", function() {
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

  describe("getAccruedFees", function() {

    // Helper to create a position and return its ID
    async function createTestPosition() {
      const vaultAddr = await vault.getAddress();
      const lbPairAddr = await mockLBPair.getAddress();
      const pmAddr = await positionManager.getAddress();

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

    // Helper to encode addToPosition calldata
    function encodeAddToPosition(vaultAddr, positionId, amountX, amountY, amountXMin, amountYMin, activeIdDesired, idSlippage, deltaIds, distributionX, distributionY, dl) {
      const iface = new ethers.Interface([
        "function addToPosition(address vault, uint256 positionId, uint256 amountX, uint256 amountY, uint256 amountXMin, uint256 amountYMin, uint256 activeIdDesired, uint256 idSlippage, int256[] deltaIds, uint256[] distributionX, uint256[] distributionY, uint256 deadline)"
      ]);
      return iface.encodeFunctionData("addToPosition", [
        vaultAddr, positionId, amountX, amountY, amountXMin, amountYMin,
        activeIdDesired, idSlippage, deltaIds, distributionX, distributionY, dl
      ]);
    }

    describe("input validation", function() {
      it("should revert for non-existent position", async function() {
        await expect(
          positionManager.getAccruedFees(999)
        ).to.be.revertedWith("TJPositionManager: position not active");
      });

      it("should revert for inactive position (fully removed)", async function() {
        const positionId = await createTestPosition();
        const vaultAddr = await vault.getAddress();
        const pmAddr = await positionManager.getAddress();

        // Remove 100%
        const removeIface = new ethers.Interface([
          "function removePosition(address vault, uint256 positionId, uint256 percentage, uint256 amountXMin, uint256 amountYMin, uint256 deadline)"
        ]);
        const removeCalldata = removeIface.encodeFunctionData("removePosition", [
          vaultAddr, positionId, 100, 0, 0, deadline
        ]);
        await vault.decreaseLiquidity([pmAddr], [removeCalldata]);

        await expect(
          positionManager.getAccruedFees(positionId)
        ).to.be.revertedWith("TJPositionManager: position not active");
      });
    });

    describe("zero-fee cases", function() {
      it("should return zero deltas when balances match baselines", async function() {
        const positionId = await createTestPosition();
        const pmAddr = await positionManager.getAddress();

        // Set MockLBPair balances to match stored liquidityMinted
        await mockLBPair.setBalance(pmAddr, 8388607, 1000);
        await mockLBPair.setBalance(pmAddr, 8388608, 2000);
        await mockLBPair.setBalance(pmAddr, 8388609, 1000);

        const [depositIds, currentBalances, storedBalances, feeDeltas] =
          await positionManager.getAccruedFees(positionId);

        expect(feeDeltas[0]).to.equal(0);
        expect(feeDeltas[1]).to.equal(0);
        expect(feeDeltas[2]).to.equal(0);
      });
    });

    describe("fee accrual detection", function() {
      it("should detect fee accrual in all bins", async function() {
        const positionId = await createTestPosition();
        const pmAddr = await positionManager.getAddress();

        // Simulate fee growth: each bin has 10% more than baseline
        await mockLBPair.setBalance(pmAddr, 8388607, 1100);
        await mockLBPair.setBalance(pmAddr, 8388608, 2200);
        await mockLBPair.setBalance(pmAddr, 8388609, 1100);

        const [,,, feeDeltas] = await positionManager.getAccruedFees(positionId);

        expect(feeDeltas[0]).to.equal(100);
        expect(feeDeltas[1]).to.equal(200);
        expect(feeDeltas[2]).to.equal(100);
      });

      it("should detect fee accrual in only one bin", async function() {
        const positionId = await createTestPosition();
        const pmAddr = await positionManager.getAddress();

        // Only middle bin has grown
        await mockLBPair.setBalance(pmAddr, 8388607, 1000);
        await mockLBPair.setBalance(pmAddr, 8388608, 2500);
        await mockLBPair.setBalance(pmAddr, 8388609, 1000);

        const [,,, feeDeltas] = await positionManager.getAccruedFees(positionId);

        expect(feeDeltas[0]).to.equal(0);
        expect(feeDeltas[1]).to.equal(500);
        expect(feeDeltas[2]).to.equal(0);
      });

      it("should detect large fee accrual (100% increase)", async function() {
        const positionId = await createTestPosition();
        const pmAddr = await positionManager.getAddress();

        // 100% increase in all bins
        await mockLBPair.setBalance(pmAddr, 8388607, 2000);
        await mockLBPair.setBalance(pmAddr, 8388608, 4000);
        await mockLBPair.setBalance(pmAddr, 8388609, 2000);

        const [,,, feeDeltas] = await positionManager.getAccruedFees(positionId);

        expect(feeDeltas[0]).to.equal(1000);
        expect(feeDeltas[1]).to.equal(2000);
        expect(feeDeltas[2]).to.equal(1000);
      });

      it("should return zero delta when current is less than stored (defensive)", async function() {
        const positionId = await createTestPosition();
        const pmAddr = await positionManager.getAddress();

        // Set balances below stored (rounding edge case)
        await mockLBPair.setBalance(pmAddr, 8388607, 999);
        await mockLBPair.setBalance(pmAddr, 8388608, 1999);
        await mockLBPair.setBalance(pmAddr, 8388609, 999);

        const [,,, feeDeltas] = await positionManager.getAccruedFees(positionId);

        expect(feeDeltas[0]).to.equal(0);
        expect(feeDeltas[1]).to.equal(0);
        expect(feeDeltas[2]).to.equal(0);
      });
    });

    describe("return structure verification", function() {
      it("should return correct depositIds matching position", async function() {
        const positionId = await createTestPosition();
        const pmAddr = await positionManager.getAddress();

        await mockLBPair.setBalance(pmAddr, 8388607, 1000);
        await mockLBPair.setBalance(pmAddr, 8388608, 2000);
        await mockLBPair.setBalance(pmAddr, 8388609, 1000);

        const [depositIds] = await positionManager.getAccruedFees(positionId);

        expect(depositIds.length).to.equal(3);
        expect(depositIds[0]).to.equal(8388607n);
        expect(depositIds[1]).to.equal(8388608n);
        expect(depositIds[2]).to.equal(8388609n);
      });

      it("should return correct storedBalances matching liquidityMinted", async function() {
        const positionId = await createTestPosition();
        const pmAddr = await positionManager.getAddress();

        await mockLBPair.setBalance(pmAddr, 8388607, 1100);
        await mockLBPair.setBalance(pmAddr, 8388608, 2200);
        await mockLBPair.setBalance(pmAddr, 8388609, 1100);

        const [,, storedBalances] = await positionManager.getAccruedFees(positionId);

        expect(storedBalances[0]).to.equal(1000);
        expect(storedBalances[1]).to.equal(2000);
        expect(storedBalances[2]).to.equal(1000);
      });

      it("should return correct currentBalances from MockLBPair.balanceOf", async function() {
        const positionId = await createTestPosition();
        const pmAddr = await positionManager.getAddress();

        await mockLBPair.setBalance(pmAddr, 8388607, 1234);
        await mockLBPair.setBalance(pmAddr, 8388608, 5678);
        await mockLBPair.setBalance(pmAddr, 8388609, 9012);

        const [, currentBalances] = await positionManager.getAccruedFees(positionId);

        expect(currentBalances[0]).to.equal(1234);
        expect(currentBalances[1]).to.equal(5678);
        expect(currentBalances[2]).to.equal(9012);
      });
    });

    describe("post-addToPosition baseline updates", function() {
      it("should reflect updated baselines after addToPosition", async function() {
        const positionId = await createTestPosition();
        const vaultAddr = await vault.getAddress();
        const pmAddr = await positionManager.getAddress();

        // Add to position with same bins (default mock: +[1000, 2000, 1000])
        const addCalldata = encodeAddToPosition(
          vaultAddr, positionId,
          ethers.parseEther("1"), 1000n * 10n ** 6n,
          0, 0,
          8388608, 5,
          [-1, 0, 1],
          [0, ethers.parseEther("0.5"), ethers.parseEther("0.5")],
          [ethers.parseEther("0.5"), ethers.parseEther("0.5"), 0],
          deadline
        );
        await vault.increaseLiquidity([pmAddr], [addCalldata], [0n]);

        // Stored baselines should now be doubled: [2000, 4000, 2000]
        // Simulate fee accrual of 100 per bin on top of new baseline
        await mockLBPair.setBalance(pmAddr, 8388607, 2100);
        await mockLBPair.setBalance(pmAddr, 8388608, 4100);
        await mockLBPair.setBalance(pmAddr, 8388609, 2100);

        const [depositIds, currentBalances, storedBalances, feeDeltas] =
          await positionManager.getAccruedFees(positionId);

        // Stored baselines should be updated
        expect(storedBalances[0]).to.equal(2000);
        expect(storedBalances[1]).to.equal(4000);
        expect(storedBalances[2]).to.equal(2000);

        // Fee deltas should be 100 each
        expect(feeDeltas[0]).to.equal(100);
        expect(feeDeltas[1]).to.equal(100);
        expect(feeDeltas[2]).to.equal(100);
      });
    });
  });
});
