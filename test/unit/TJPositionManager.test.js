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

      // Set up totalSupply and reserves so originalShareX/Y are computed
      await mockLBPair.setTotalSupply(8388607, 10000);
      await mockLBPair.setTotalSupply(8388608, 10000);
      await mockLBPair.setTotalSupply(8388609, 10000);
      await mockLBPair.setBinReserves(8388607, 0, 10000);
      await mockLBPair.setBinReserves(8388608, 5000, 5000);
      await mockLBPair.setBinReserves(8388609, 10000, 0);

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

      // Verify originalShareX/Y baselines computed from reserves
      // Mock liquidityMinted=[1000,2000,1000], totalSupply=10000 per bin
      // Bin 8388607 (Y-only): shareX = 1000*0/10000 = 0, shareY = 1000*10000/10000 = 1000
      // Bin 8388608 (active): shareX = 2000*5000/10000 = 1000, shareY = 1000
      // Bin 8388609 (X-only): shareX = 1000*10000/10000 = 1000, shareY = 0
      expect(position.originalShareX.length).to.equal(3);
      expect(position.originalShareY.length).to.equal(3);
      expect(position.originalShareX[0]).to.equal(0);
      expect(position.originalShareY[0]).to.equal(1000);
      expect(position.originalShareX[1]).to.equal(1000);
      expect(position.originalShareY[1]).to.equal(1000);
      expect(position.originalShareX[2]).to.equal(1000);
      expect(position.originalShareY[2]).to.equal(0);
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
          [1000n, 2000n, 1000n], // liquidityMinted from mock
          ethers.parseEther("1"), // amountXAdded from mock
          1000n * 10n ** 6n // amountYAdded from mock
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
    // Default mock returns: depositIds=[8388607,8388608,8388609], liquidityMinted=[1000,2000,1000]
    // totalSupply=10000 per bin, reserves:
    //   8388607 (below active): Y-only  → reserveX=0,     reserveY=10000
    //   8388608 (active):       both    → reserveX=5000,   reserveY=5000
    //   8388609 (above active): X-only  → reserveX=10000,  reserveY=0
    //
    // Resulting originalShare baselines:
    //   8388607: shareX=0,    shareY=1000
    //   8388608: shareX=1000, shareY=1000
    //   8388609: shareX=1000, shareY=0
    async function createTestPosition() {
      const vaultAddr = await vault.getAddress();
      const lbPairAddr = await mockLBPair.getAddress();
      const pmAddr = await positionManager.getAddress();

      const routerAddr = await mockLBRouter.getAddress();
      await tokenX.mint(routerAddr, ethers.parseEther("100"));
      await tokenY.mint(routerAddr, 100000n * 10n ** 6n);

      // Set up totalSupply and reserves BEFORE position creation
      await mockLBPair.setTotalSupply(8388607, 10000);
      await mockLBPair.setTotalSupply(8388608, 10000);
      await mockLBPair.setTotalSupply(8388609, 10000);
      await mockLBPair.setBinReserves(8388607, 0, 10000);
      await mockLBPair.setBinReserves(8388608, 5000, 5000);
      await mockLBPair.setBinReserves(8388609, 10000, 0);

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

      it("should revert when adding bins outside the position range", async function() {
        const positionId = await createTestPosition();
        const vaultAddr = await vault.getAddress();
        const pmAddr = await positionManager.getAddress();

        // Reconfigure mock to return entirely new bins not in position
        await mockLBRouter.setReturnValues(
          ethers.parseEther("1"), 1000n * 10n ** 6n, 0, 0,
          [8388610, 8388611], // not in original [8388607, 8388608, 8388609]
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

        await expect(
          vault.increaseLiquidity([pmAddr], [calldata], [0n])
        ).to.be.revertedWith("TJPositionManager: bin not in position");
      });

      it("should revert when adding partially overlapping bins", async function() {
        const positionId = await createTestPosition();
        const vaultAddr = await vault.getAddress();
        const pmAddr = await positionManager.getAddress();

        // Reconfigure mock: bins [8388608, 8388609, 8388610]
        // 8388610 is NOT in original [8388607, 8388608, 8388609]
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

        await expect(
          vault.increaseLiquidity([pmAddr], [calldata], [0n])
        ).to.be.revertedWith("TJPositionManager: bin not in position");
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
          "function decreaseLiquidity(address vault, uint256 positionId, uint256 percentage, uint256 amountXMin, uint256 amountYMin, uint256 deadline)"
        ]);
        const removeCalldata = removeIface.encodeFunctionData("decreaseLiquidity", [
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
          "function removePosition(address vault, uint256 positionId, uint256 amountXMin, uint256 amountYMin, uint256 deadline)"
        ]);
        const removeCalldata = removeIface.encodeFunctionData("removePosition", [
          vaultAddr, positionId, 0, 0, deadline
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
          "function removePosition(address vault, uint256 positionId, uint256 amountXMin, uint256 amountYMin, uint256 deadline)"
        ]);
        const removeCalldata = removeIface.encodeFunctionData("removePosition", [
          vaultAddr, positionId, 0, 0, deadline
        ]);
        await vault.decreaseLiquidity([pmAddr], [removeCalldata]);

        // Struct should be fully deleted
        pos = await positionManager.getPosition(positionId);
        expect(pos.vault).to.equal(ethers.ZeroAddress);
        expect(pos.lbPair).to.equal(ethers.ZeroAddress);
        expect(pos.active).to.equal(false);
        expect(pos.depositIds.length).to.equal(0);
        expect(pos.liquidityMinted.length).to.equal(0);
      });

      it("should revert if router returns bins not in position", async function() {
        const positionId = await createTestPosition();
        const vaultAddr = await vault.getAddress();
        const pmAddr = await positionManager.getAddress();

        // Router returns bin 8388610 which is NOT in the original position [8388607, 8388608, 8388609]
        await mockLBRouter.setReturnValues(
          ethers.parseEther("1"), 1000n * 10n ** 6n, 0, 0,
          [8388609, 8388610],
          [100, 200]
        );

        const calldata = encodeAddToPosition(
          vaultAddr, positionId,
          ethers.parseEther("1"), 1000n * 10n ** 6n,
          0, 0,
          8388608, 5,
          [1, 2],
          [ethers.parseEther("0.5"), ethers.parseEther("0.5")],
          [0, 0],
          deadline
        );

        await expect(
          vault.increaseLiquidity([pmAddr], [calldata], [0n])
        ).to.be.revertedWith("TJPositionManager: bin not in position");
      });

      it("should update baselines when adding to existing bins only", async function() {
        const positionId = await createTestPosition();
        const vaultAddr = await vault.getAddress();
        const pmAddr = await positionManager.getAddress();

        // Router returns only bins already in the position [8388607, 8388608, 8388609]
        await mockLBRouter.setReturnValues(
          ethers.parseEther("1"), 1000n * 10n ** 6n, 0, 0,
          [8388607, 8388608, 8388609],
          [100, 200, 100]
        );

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
        expect(pos.depositIds.length).to.equal(3);
        // Original [1000, 2000, 1000] + [100, 200, 100]
        expect(pos.liquidityMinted[0]).to.equal(1100);
        expect(pos.liquidityMinted[1]).to.equal(2200);
        expect(pos.liquidityMinted[2]).to.equal(1100);

        // Baselines should reflect new current shares (no fees, so baseline = currentShare)
        // Bin 8388607 (Y-only): shareX=0, shareY=1100*10000/10000=1100
        // Bin 8388608 (active): shareX=2200*5000/10000=1100, shareY=1100
        // Bin 8388609 (X-only): shareX=1100*10000/10000=1100, shareY=0
        expect(pos.originalShareX[0]).to.equal(0);
        expect(pos.originalShareY[0]).to.equal(1100);
        expect(pos.originalShareX[1]).to.equal(1100);
        expect(pos.originalShareY[1]).to.equal(1100);
        expect(pos.originalShareX[2]).to.equal(1100);
        expect(pos.originalShareY[2]).to.equal(0);
      });
    });
  });

  describe("stub validator methods", function() {
    it("validateCollect should accept collectFees with correct vault", async function() {
      const iface = new ethers.Interface([
        "function collectFees(address vault, uint256 positionId)"
      ]);
      const calldata = iface.encodeFunctionData("collectFees", [owner.address, 1]);
      await expect(
        tjValidator.validateCollect(calldata, owner.address)
      ).to.not.be.reverted;
    });

    it("validateCollect should reject invalid selector", async function() {
      const fakeCalldata = "0xdeadbeef" + "00".repeat(32);
      await expect(
        tjValidator.validateCollect(fakeCalldata, owner.address)
      ).to.be.revertedWith("TJPositionValidator: not collectFees");
    });

    it("validateCollect should reject vault mismatch", async function() {
      const iface = new ethers.Interface([
        "function collectFees(address vault, uint256 positionId)"
      ]);
      const calldata = iface.encodeFunctionData("collectFees", [user1.address, 1]);
      await expect(
        tjValidator.validateCollect(calldata, owner.address)
      ).to.be.revertedWith("TJPositionValidator: vault mismatch");
    });

    it("validateBurn should revert", async function() {
      await expect(
        tjValidator.validateBurn("0x", owner.address)
      ).to.be.revertedWith("TJPositionValidator: not yet implemented");
    });
  });

  describe("removePosition via vault.decreaseLiquidity()", function() {


    // Helper to encode removePosition (100%) or decreaseLiquidity (partial) calldata
    function encodeRemovePosition(vaultAddr, positionId, percentage, amountXMin, amountYMin, dl) {
      if (percentage === 100) {
        const iface = new ethers.Interface([
          "function removePosition(address vault, uint256 positionId, uint256 amountXMin, uint256 amountYMin, uint256 deadline)"
        ]);
        return iface.encodeFunctionData("removePosition", [
          vaultAddr, positionId, amountXMin, amountYMin, dl
        ]);
      } else {
        const iface = new ethers.Interface([
          "function decreaseLiquidity(address vault, uint256 positionId, uint256 percentage, uint256 amountXMin, uint256 amountYMin, uint256 deadline)"
        ]);
        return iface.encodeFunctionData("decreaseLiquidity", [
          vaultAddr, positionId, percentage, amountXMin, amountYMin, dl
        ]);
      }
    }

    // Helper to create a position and return its ID
    // Default mock returns: depositIds=[8388607,8388608,8388609], liquidityMinted=[1000,2000,1000]
    // totalSupply=10000 per bin, reserves:
    //   8388607 (below active): Y-only  → reserveX=0,     reserveY=10000
    //   8388608 (active):       both    → reserveX=5000,   reserveY=5000
    //   8388609 (above active): X-only  → reserveX=10000,  reserveY=0
    //
    // Resulting originalShare baselines:
    //   8388607: shareX=0,    shareY=1000
    //   8388608: shareX=1000, shareY=1000
    //   8388609: shareX=1000, shareY=0
    async function createTestPosition() {
      const vaultAddr = await vault.getAddress();
      const lbPairAddr = await mockLBPair.getAddress();
      const pmAddr = await positionManager.getAddress();

      // Fund the mock router with tokens to send back during removal
      const routerAddr = await mockLBRouter.getAddress();
      await tokenX.mint(routerAddr, ethers.parseEther("100"));
      await tokenY.mint(routerAddr, 100000n * 10n ** 6n);

      // Set up totalSupply and reserves BEFORE position creation
      await mockLBPair.setTotalSupply(8388607, 10000);
      await mockLBPair.setTotalSupply(8388608, 10000);
      await mockLBPair.setTotalSupply(8388609, 10000);
      await mockLBPair.setBinReserves(8388607, 0, 10000);
      await mockLBPair.setBinReserves(8388608, 5000, 5000);
      await mockLBPair.setBinReserves(8388609, 10000, 0);

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

      // Struct should be fully deleted (all fields zeroed)
      const pos = await positionManager.getPosition(positionId);
      expect(pos.vault).to.equal(ethers.ZeroAddress);
      expect(pos.lbPair).to.equal(ethers.ZeroAddress);
      expect(pos.active).to.equal(false);
      expect(pos.depositIds.length).to.equal(0);
      expect(pos.liquidityMinted.length).to.equal(0);
      expect(pos.originalShareX.length).to.equal(0);
      expect(pos.originalShareY.length).to.equal(0);
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

      // originalShareX/Y baselines should be recalculated for reduced position
      // Bin 8388607 (Y-only): shareX=0, shareY=500*10000/10000=500
      // Bin 8388608 (active): shareX=1000*5000/10000=500, shareY=500
      // Bin 8388609 (X-only): shareX=500*10000/10000=500, shareY=0
      expect(posAfter.originalShareX[0]).to.equal(0);
      expect(posAfter.originalShareY[0]).to.equal(500);
      expect(posAfter.originalShareX[1]).to.equal(500);
      expect(posAfter.originalShareY[1]).to.equal(500);
      expect(posAfter.originalShareX[2]).to.equal(500);
      expect(posAfter.originalShareY[2]).to.equal(0);
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
            user1.address, positionId, 0, 0, deadline
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
        ).to.be.revertedWith("TJPositionValidator: not removePosition or decreaseLiquidity");
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

        // Struct should be fully deleted
        pos = await positionManager.getPosition(positionId);
        expect(pos.vault).to.equal(ethers.ZeroAddress);
        expect(pos.lbPair).to.equal(ethers.ZeroAddress);
        expect(pos.active).to.equal(false);
        expect(pos.depositIds.length).to.equal(0);
        expect(pos.liquidityMinted.length).to.equal(0);
        expect(pos.originalShareX.length).to.equal(0);
        expect(pos.originalShareY.length).to.equal(0);
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

    describe("fee collection during removal", function() {
      it("should collect fees before 100% removal", async function() {
        const positionId = await createTestPosition();
        const vaultAddr = await vault.getAddress();
        const pmAddr = await positionManager.getAddress();

        // Simulate 10% fee accrual
        await mockLBPair.setBinReserves(8388607, 0, 11000);
        await mockLBPair.setBinReserves(8388608, 5500, 5500);
        await mockLBPair.setBinReserves(8388609, 11000, 0);

        // First removeLiquidity call = fee collection, second = principal removal
        await mockLBRouter.setRemoveReturnValues(
          ethers.parseEther("0.01"),  // fee amountX
          100n * 10n ** 6n            // fee amountY
        );
        await mockLBRouter.setRemoveReturnValues2(
          ethers.parseEther("0.5"),   // principal amountX
          500n * 10n ** 6n            // principal amountY
        );

        const calldata = encodeRemovePosition(vaultAddr, positionId, 100, 0, 0, deadline);
        const tx = await vault.decreaseLiquidity([pmAddr], [calldata]);
        const receipt = await tx.wait();

        // Both FeesCollected and PositionRemoved should be emitted
        const events = receipt.logs.map(log => {
          try { return positionManager.interface.parseLog(log); }
          catch { return null; }
        }).filter(e => e !== null);

        const feesEvent = events.find(e => e.name === "FeesCollected");
        const removedEvent = events.find(e => e.name === "PositionRemoved");

        expect(feesEvent).to.not.be.undefined;
        expect(removedEvent).to.not.be.undefined;
        expect(feesEvent.args.amountX).to.equal(ethers.parseEther("0.01"));
        expect(feesEvent.args.amountY).to.equal(100n * 10n ** 6n);
        expect(removedEvent.args.percentage).to.equal(100);

        // Position should be inactive
        const pos = await positionManager.getPosition(positionId);
        expect(pos.active).to.equal(false);
      });

      it("should collect fees before 50% partial removal", async function() {
        const positionId = await createTestPosition();
        const vaultAddr = await vault.getAddress();
        const pmAddr = await positionManager.getAddress();

        // Simulate 10% fee accrual
        await mockLBPair.setBinReserves(8388607, 0, 11000);
        await mockLBPair.setBinReserves(8388608, 5500, 5500);
        await mockLBPair.setBinReserves(8388609, 11000, 0);

        await mockLBRouter.setRemoveReturnValues(
          ethers.parseEther("0.01"), 100n * 10n ** 6n
        );
        await mockLBRouter.setRemoveReturnValues2(
          ethers.parseEther("0.25"), 250n * 10n ** 6n
        );

        const calldata = encodeRemovePosition(vaultAddr, positionId, 50, 0, 0, deadline);
        const tx = await vault.decreaseLiquidity([pmAddr], [calldata]);
        const receipt = await tx.wait();

        // Both events should be emitted
        const events = receipt.logs.map(log => {
          try { return positionManager.interface.parseLog(log); }
          catch { return null; }
        }).filter(e => e !== null);

        expect(events.some(e => e.name === "FeesCollected")).to.be.true;
        expect(events.some(e => e.name === "PositionRemoved")).to.be.true;

        // Position should still be active with reduced liquidityMinted
        const pos = await positionManager.getPosition(positionId);
        expect(pos.active).to.equal(true);

        // After fee collection, liquidityMinted was reduced by fee LB tokens,
        // then 50% of the remaining was removed.
        // Fee LB tokens per bin (10% reserve increase):
        //   8388607: principalLb = 1000*10000/11000 = 909, feeLb = 1000-909 = 91 → lm: 909
        //   8388608: principalLb = 1000*10000/5500 = 1818, feeLb = 2000-1818 = 182 → lm: 1818
        //   8388609: principalLb = 1000*10000/11000 = 909, feeLb = 1000-909 = 91 → lm: 909
        // Then 50% removal: [909/2=454, 1818/2=909, 909/2=454]
        // Final: [909-454=455, 1818-909=909, 909-454=455]
        expect(pos.liquidityMinted[0]).to.equal(455);
        expect(pos.liquidityMinted[1]).to.equal(909);
        expect(pos.liquidityMinted[2]).to.equal(455);
      });

      it("should skip fee collection when no fees accrued during removal", async function() {
        const positionId = await createTestPosition();
        const vaultAddr = await vault.getAddress();
        const pmAddr = await positionManager.getAddress();

        // Reserves unchanged — no fees
        await mockLBRouter.setRemoveReturnValues(
          ethers.parseEther("0.5"), 500n * 10n ** 6n
        );

        const calldata = encodeRemovePosition(vaultAddr, positionId, 100, 0, 0, deadline);
        const tx = await vault.decreaseLiquidity([pmAddr], [calldata]);
        const receipt = await tx.wait();

        // Only PositionRemoved should be emitted, no FeesCollected
        const events = receipt.logs.map(log => {
          try { return positionManager.interface.parseLog(log); }
          catch { return null; }
        }).filter(e => e !== null);

        expect(events.some(e => e.name === "FeesCollected")).to.be.false;
        expect(events.some(e => e.name === "PositionRemoved")).to.be.true;

        // Only one removeLiquidity call should have been made (principal only)
        expect(await mockLBRouter.removeCallCount()).to.equal(1);
      });

      it("should make two router calls when fees are present", async function() {
        const positionId = await createTestPosition();
        const vaultAddr = await vault.getAddress();
        const pmAddr = await positionManager.getAddress();

        // Simulate fee accrual
        await mockLBPair.setBinReserves(8388607, 0, 11000);
        await mockLBPair.setBinReserves(8388608, 5500, 5500);
        await mockLBPair.setBinReserves(8388609, 11000, 0);

        await mockLBRouter.setRemoveReturnValues(
          ethers.parseEther("0.01"), 100n * 10n ** 6n
        );
        await mockLBRouter.setRemoveReturnValues2(
          ethers.parseEther("0.5"), 500n * 10n ** 6n
        );

        const calldata = encodeRemovePosition(vaultAddr, positionId, 100, 0, 0, deadline);
        await vault.decreaseLiquidity([pmAddr], [calldata]);

        // Two removeLiquidity calls: fee collection + principal removal
        expect(await mockLBRouter.removeCallCount()).to.equal(2);
      });
    });
  });

  describe("getAccruedFees", function() {

    // Helper to create a position with reserves and totalSupply initialized
    // Default mock returns: depositIds=[8388607,8388608,8388609], liquidityMinted=[1000,2000,1000]
    // We set totalSupply=10000 per bin and realistic reserves:
    //   8388607 (below active): Y-only  → reserveX=0,     reserveY=10000
    //   8388608 (active):       both    → reserveX=5000,   reserveY=5000
    //   8388609 (above active): X-only  → reserveX=10000,  reserveY=0
    //
    // Resulting originalShare baselines:
    //   8388607: shareX=0,    shareY=1000
    //   8388608: shareX=1000, shareY=1000
    //   8388609: shareX=1000, shareY=0
    async function createTestPosition() {
      const vaultAddr = await vault.getAddress();
      const lbPairAddr = await mockLBPair.getAddress();
      const pmAddr = await positionManager.getAddress();

      const routerAddr = await mockLBRouter.getAddress();
      await tokenX.mint(routerAddr, ethers.parseEther("100"));
      await tokenY.mint(routerAddr, 100000n * 10n ** 6n);

      // Set up totalSupply and reserves BEFORE position creation
      await mockLBPair.setTotalSupply(8388607, 10000);
      await mockLBPair.setTotalSupply(8388608, 10000);
      await mockLBPair.setTotalSupply(8388609, 10000);
      await mockLBPair.setBinReserves(8388607, 0, 10000);
      await mockLBPair.setBinReserves(8388608, 5000, 5000);
      await mockLBPair.setBinReserves(8388609, 10000, 0);

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
          "function removePosition(address vault, uint256 positionId, uint256 amountXMin, uint256 amountYMin, uint256 deadline)"
        ]);
        const removeCalldata = removeIface.encodeFunctionData("removePosition", [
          vaultAddr, positionId, 0, 0, deadline
        ]);
        await vault.decreaseLiquidity([pmAddr], [removeCalldata]);

        await expect(
          positionManager.getAccruedFees(positionId)
        ).to.be.revertedWith("TJPositionManager: position not active");
      });
    });

    describe("zero-fee cases", function() {
      it("should return zero fees when reserves unchanged", async function() {
        const positionId = await createTestPosition();

        // Reserves unchanged since creation — no fee accrual
        const [feesX, feesY] = await positionManager.getAccruedFees(positionId);

        expect(feesX[0]).to.equal(0);
        expect(feesX[1]).to.equal(0);
        expect(feesX[2]).to.equal(0);
        expect(feesY[0]).to.equal(0);
        expect(feesY[1]).to.equal(0);
        expect(feesY[2]).to.equal(0);
      });
    });

    describe("fee accrual detection", function() {
      it("should detect fee accrual in all bins via reserve growth", async function() {
        const positionId = await createTestPosition();

        // Increase reserves by 10% in each bin
        await mockLBPair.setBinReserves(8388607, 0, 11000);
        await mockLBPair.setBinReserves(8388608, 5500, 5500);
        await mockLBPair.setBinReserves(8388609, 11000, 0);

        const [feesX, feesY] = await positionManager.getAccruedFees(positionId);

        // 8388607 (Y-only): feeY = 1000*11000/10000 - 1000 = 100
        expect(feesX[0]).to.equal(0);
        expect(feesY[0]).to.equal(100);
        // 8388608 (active): feeX = 2000*5500/10000 - 1000 = 100, feeY same
        expect(feesX[1]).to.equal(100);
        expect(feesY[1]).to.equal(100);
        // 8388609 (X-only): feeX = 1000*11000/10000 - 1000 = 100
        expect(feesX[2]).to.equal(100);
        expect(feesY[2]).to.equal(0);
      });

      it("should detect fee accrual in only the active bin", async function() {
        const positionId = await createTestPosition();

        // Only increase reserves in the active bin (50% increase)
        await mockLBPair.setBinReserves(8388608, 7500, 7500);

        const [feesX, feesY] = await positionManager.getAccruedFees(positionId);

        expect(feesX[0]).to.equal(0);
        expect(feesY[0]).to.equal(0);
        // 8388608: feeX = 2000*7500/10000 - 1000 = 500
        expect(feesX[1]).to.equal(500);
        expect(feesY[1]).to.equal(500);
        expect(feesX[2]).to.equal(0);
        expect(feesY[2]).to.equal(0);
      });

      it("should detect large fee accrual (100% reserve increase)", async function() {
        const positionId = await createTestPosition();

        // Double all reserves
        await mockLBPair.setBinReserves(8388607, 0, 20000);
        await mockLBPair.setBinReserves(8388608, 10000, 10000);
        await mockLBPair.setBinReserves(8388609, 20000, 0);

        const [feesX, feesY] = await positionManager.getAccruedFees(positionId);

        // 8388607: feeY = 1000*20000/10000 - 1000 = 1000
        expect(feesX[0]).to.equal(0);
        expect(feesY[0]).to.equal(1000);
        // 8388608: feeX = 2000*10000/10000 - 1000 = 1000
        expect(feesX[1]).to.equal(1000);
        expect(feesY[1]).to.equal(1000);
        // 8388609: feeX = 1000*20000/10000 - 1000 = 1000
        expect(feesX[2]).to.equal(1000);
        expect(feesY[2]).to.equal(0);
      });

      it("should return zero fees when reserves decrease (defensive)", async function() {
        const positionId = await createTestPosition();

        // Decrease reserves (shouldn't happen normally, but defensive)
        await mockLBPair.setBinReserves(8388607, 0, 9000);
        await mockLBPair.setBinReserves(8388608, 4500, 4500);
        await mockLBPair.setBinReserves(8388609, 9000, 0);

        const [feesX, feesY] = await positionManager.getAccruedFees(positionId);

        expect(feesX[0]).to.equal(0);
        expect(feesY[0]).to.equal(0);
        expect(feesX[1]).to.equal(0);
        expect(feesY[1]).to.equal(0);
        expect(feesX[2]).to.equal(0);
        expect(feesY[2]).to.equal(0);
      });
    });

    describe("post-addToPosition baseline updates", function() {
      it("should preserve accrued fees across addToPosition", async function() {
        const positionId = await createTestPosition();
        const vaultAddr = await vault.getAddress();
        const pmAddr = await positionManager.getAddress();

        // Simulate 10% fee accrual via reserve growth
        await mockLBPair.setBinReserves(8388607, 0, 11000);
        await mockLBPair.setBinReserves(8388608, 5500, 5500);
        await mockLBPair.setBinReserves(8388609, 11000, 0);

        // Add to position (default mock returns +[1000, 2000, 1000])
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

        // Without changing reserves further, original fees should still be reported
        const [feesX, feesY] = await positionManager.getAccruedFees(positionId);

        expect(feesX[0]).to.equal(0);
        expect(feesY[0]).to.equal(100);
        expect(feesX[1]).to.equal(100);
        expect(feesY[1]).to.equal(100);
        expect(feesX[2]).to.equal(100);
        expect(feesY[2]).to.equal(0);
      });
    });
  });

  describe("collectFees", function() {

    // Helper matching getAccruedFees setup:
    // depositIds=[8388607,8388608,8388609], liquidityMinted=[1000,2000,1000]
    // totalSupply=10000 per bin
    // originalShare baselines: 8388607: X=0,Y=1000 | 8388608: X=1000,Y=1000 | 8388609: X=1000,Y=0
    async function createTestPosition() {
      const vaultAddr = await vault.getAddress();
      const lbPairAddr = await mockLBPair.getAddress();
      const pmAddr = await positionManager.getAddress();

      const routerAddr = await mockLBRouter.getAddress();
      await tokenX.mint(routerAddr, ethers.parseEther("100"));
      await tokenY.mint(routerAddr, 100000n * 10n ** 6n);

      await mockLBPair.setTotalSupply(8388607, 10000);
      await mockLBPair.setTotalSupply(8388608, 10000);
      await mockLBPair.setTotalSupply(8388609, 10000);
      await mockLBPair.setBinReserves(8388607, 0, 10000);
      await mockLBPair.setBinReserves(8388608, 5000, 5000);
      await mockLBPair.setBinReserves(8388609, 10000, 0);

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

    function encodeCollectFees(vaultAddr, positionId) {
      const iface = new ethers.Interface([
        "function collectFees(address vault, uint256 positionId)"
      ]);
      return iface.encodeFunctionData("collectFees", [vaultAddr, positionId]);
    }

    describe("validation", function() {
      it("should revert if vault is not msg.sender", async function() {
        const positionId = await createTestPosition();
        const pmAddr = await positionManager.getAddress();

        // Call directly (not through vault) — msg.sender != vault param
        await expect(
          positionManager.collectFees(await vault.getAddress(), positionId)
        ).to.be.revertedWith("TJPositionManager: vault must be caller");
      });

      it("should revert for position not owned by vault", async function() {
        const positionId = await createTestPosition();
        const pmAddr = await positionManager.getAddress();

        // Use a different address as vault param (matching msg.sender but not position owner)
        const [, user1] = await ethers.getSigners();
        await expect(
          positionManager.connect(user1).collectFees(user1.address, positionId)
        ).to.be.revertedWith("TJPositionManager: not position owner");
      });

      it("should revert for inactive position", async function() {
        const positionId = await createTestPosition();
        const vaultAddr = await vault.getAddress();
        const pmAddr = await positionManager.getAddress();

        // Remove position first
        const removeIface = new ethers.Interface([
          "function removePosition(address vault, uint256 positionId, uint256 amountXMin, uint256 amountYMin, uint256 deadline)"
        ]);
        const removeCalldata = removeIface.encodeFunctionData("removePosition", [
          vaultAddr, positionId, 0, 0, deadline
        ]);
        await vault.decreaseLiquidity([pmAddr], [removeCalldata]);

        const collectCalldata = encodeCollectFees(vaultAddr, positionId);
        await expect(
          vault.collect([pmAddr], [collectCalldata])
        ).to.be.reverted;
      });
    });

    describe("zero fees", function() {
      it("should return (0,0) when no fees accrued", async function() {
        const positionId = await createTestPosition();
        const vaultAddr = await vault.getAddress();
        const pmAddr = await positionManager.getAddress();

        // Reserves unchanged — no fees
        const collectCalldata = encodeCollectFees(vaultAddr, positionId);
        const tx = await vault.collect([pmAddr], [collectCalldata]);
        const receipt = await tx.wait();

        // No FeesCollected event should be emitted (count == 0, early return)
        const feesCollectedEvents = receipt.logs.filter(log => {
          try {
            const parsed = positionManager.interface.parseLog(log);
            return parsed && parsed.name === "FeesCollected";
          } catch { return false; }
        });
        expect(feesCollectedEvents.length).to.equal(0);
      });
    });

    describe("fee collection", function() {
      it("should collect fees and emit FeesCollected event", async function() {
        const positionId = await createTestPosition();
        const vaultAddr = await vault.getAddress();
        const pmAddr = await positionManager.getAddress();

        // Simulate 10% fee accrual
        await mockLBPair.setBinReserves(8388607, 0, 11000);
        await mockLBPair.setBinReserves(8388608, 5500, 5500);
        await mockLBPair.setBinReserves(8388609, 11000, 0);

        // Configure mock router return values for removeLiquidity
        await mockLBRouter.setRemoveReturnValues(
          ethers.parseEther("0.01"),  // feeAmountX
          100n * 10n ** 6n            // feeAmountY
        );

        const collectCalldata = encodeCollectFees(vaultAddr, positionId);
        const tx = await vault.collect([pmAddr], [collectCalldata]);
        const receipt = await tx.wait();

        // Verify FeesCollected event was emitted
        const feesCollectedEvents = receipt.logs.filter(log => {
          try {
            const parsed = positionManager.interface.parseLog(log);
            return parsed && parsed.name === "FeesCollected";
          } catch { return false; }
        });
        expect(feesCollectedEvents.length).to.equal(1);

        const parsed = positionManager.interface.parseLog(feesCollectedEvents[0]);
        expect(parsed.args.positionId).to.equal(positionId);
        expect(parsed.args.vault).to.equal(vaultAddr);
        expect(parsed.args.amountX).to.equal(ethers.parseEther("0.01"));
        expect(parsed.args.amountY).to.equal(100n * 10n ** 6n);
      });

      it("should reduce liquidityMinted after fee collection", async function() {
        const positionId = await createTestPosition();
        const vaultAddr = await vault.getAddress();
        const pmAddr = await positionManager.getAddress();

        // Get liquidityMinted before
        const posBefore = await positionManager.getPosition(positionId);
        const lmBefore = posBefore.liquidityMinted.map(lm => lm);

        // Simulate 10% fee accrual
        await mockLBPair.setBinReserves(8388607, 0, 11000);
        await mockLBPair.setBinReserves(8388608, 5500, 5500);
        await mockLBPair.setBinReserves(8388609, 11000, 0);

        await mockLBRouter.setRemoveReturnValues(
          ethers.parseEther("0.01"), 100n * 10n ** 6n
        );

        const collectCalldata = encodeCollectFees(vaultAddr, positionId);
        await vault.collect([pmAddr], [collectCalldata]);

        // liquidityMinted should have decreased (fee LB tokens were burned)
        const posAfter = await positionManager.getPosition(positionId);
        for (let i = 0; i < posAfter.liquidityMinted.length; i++) {
          expect(posAfter.liquidityMinted[i]).to.be.lt(lmBefore[i]);
        }

        // Position should still be active
        expect(posAfter.active).to.be.true;
      });

      it("should collect fees when only Y-side accrues in active bin (asymmetric fees)", async function() {
        const positionId = await createTestPosition();
        const vaultAddr = await vault.getAddress();
        const pmAddr = await positionManager.getAddress();

        // Simulate asymmetric fee accrual: Y reserves grow but X stays the same
        // Active bin (8388608) has reserveX=5000, reserveY=5500 — only Y grew
        // This is the scenario where round-trip swaps generate fees only on one side
        await mockLBPair.setBinReserves(8388607, 0, 11000);   // below active: Y grew
        await mockLBPair.setBinReserves(8388608, 5000, 5500);  // active: only Y grew, X unchanged
        await mockLBPair.setBinReserves(8388609, 10000, 0);    // above active: no change

        // Verify getAccruedFees detects Y-side fees in active bin
        const [feesX, feesY] = await positionManager.getAccruedFees(positionId);
        // Bin 8388607: Y grew → feesY[0] > 0
        expect(feesY[0]).to.be.gt(0);
        // Bin 8388608 (active): X unchanged → feesX[1] == 0, Y grew → feesY[1] > 0
        expect(feesX[1]).to.equal(0);
        expect(feesY[1]).to.be.gt(0);
        // Bin 8388609: no change → both 0
        expect(feesX[2]).to.equal(0);
        expect(feesY[2]).to.equal(0);

        await mockLBRouter.setRemoveReturnValues(
          ethers.parseEther("0.01"), 100n * 10n ** 6n
        );

        const collectCalldata = encodeCollectFees(vaultAddr, positionId);
        const tx = await vault.collect([pmAddr], [collectCalldata]);
        const receipt = await tx.wait();

        // Verify FeesCollected event was emitted (Y-side fallback worked)
        const feesCollectedEvents = receipt.logs.filter(log => {
          try {
            const parsed = positionManager.interface.parseLog(log);
            return parsed && parsed.name === "FeesCollected";
          } catch { return false; }
        });
        expect(feesCollectedEvents.length).to.equal(1);

        // Verify liquidityMinted decreased for bins with fees
        const posAfter = await positionManager.getPosition(positionId);
        // Bin 8388607 (index 0): had Y-side fees → should decrease
        // Bin 8388608 (index 1): had Y-side fees with X unchanged → Y-fallback should detect and decrease
        // Bin 8388609 (index 2): no fees → may stay same or only change minimally
        const posBefore = await createTestPosition(); // fresh position for comparison
        const freshPos = await positionManager.getPosition(posBefore);

        // The key assertion: active bin (index 1) LB tokens were burned despite X-side giving 0
        expect(posAfter.liquidityMinted[1]).to.be.lt(freshPos.liquidityMinted[1]);
      });

      it("should reset baselines so getAccruedFees returns zero after collection", async function() {
        const positionId = await createTestPosition();
        const vaultAddr = await vault.getAddress();
        const pmAddr = await positionManager.getAddress();

        // Simulate fee accrual
        await mockLBPair.setBinReserves(8388607, 0, 11000);
        await mockLBPair.setBinReserves(8388608, 5500, 5500);
        await mockLBPair.setBinReserves(8388609, 11000, 0);

        // Verify fees exist before collection
        const [feesXBefore, feesYBefore] = await positionManager.getAccruedFees(positionId);
        expect(feesYBefore[0]).to.equal(100);
        expect(feesXBefore[1]).to.equal(100);
        expect(feesXBefore[2]).to.equal(100);

        await mockLBRouter.setRemoveReturnValues(
          ethers.parseEther("0.01"), 100n * 10n ** 6n
        );

        const collectCalldata = encodeCollectFees(vaultAddr, positionId);
        await vault.collect([pmAddr], [collectCalldata]);

        // After collection, fees should be zero (baselines reset)
        const [feesXAfter, feesYAfter] = await positionManager.getAccruedFees(positionId);
        expect(feesXAfter[0]).to.equal(0);
        expect(feesYAfter[0]).to.equal(0);
        expect(feesXAfter[1]).to.equal(0);
        expect(feesYAfter[1]).to.equal(0);
        expect(feesXAfter[2]).to.equal(0);
        expect(feesYAfter[2]).to.equal(0);
      });
    });
  });
});
