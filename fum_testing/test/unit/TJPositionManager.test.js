const { expect } = require("chai");
const { ethers } = require('hardhat');

describe("TJPositionManager", function() {
  let owner, user1;
  let tokenX, tokenY;
  let mockLBPair, mockLBRouter;
  let positionManager;
  let proxyImpl;
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

    // Deploy TJPositionProxy implementation
    const TJPositionProxy = await ethers.getContractFactory("TJPositionProxy");
    proxyImpl = await TJPositionProxy.deploy();
    await proxyImpl.waitForDeployment();

    // Deploy TJPositionManager with router and proxy implementation
    const TJPositionManager = await ethers.getContractFactory("TJPositionManager");
    positionManager = await TJPositionManager.deploy(
      await mockLBRouter.getAddress(),
      await proxyImpl.getAddress()
    );
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

    it("should set proxyImplementation address", async function() {
      expect(await positionManager.proxyImplementation()).to.equal(await proxyImpl.getAddress());
    });

    it("should reject zero router address", async function() {
      const TJPositionManager = await ethers.getContractFactory("TJPositionManager");
      await expect(
        TJPositionManager.deploy(ethers.ZeroAddress, await proxyImpl.getAddress())
      ).to.be.revertedWith("TJPositionManager: zero router");
    });

    it("should reject zero proxy implementation address", async function() {
      const TJPositionManager = await ethers.getContractFactory("TJPositionManager");
      await expect(
        TJPositionManager.deploy(await mockLBRouter.getAddress(), ethers.ZeroAddress)
      ).to.be.revertedWith("TJPositionManager: zero proxy impl");
    });
  });

  describe("createPosition via vault.mint()", function() {

    it("should create a position and store position data", async function() {
      const vaultAddr = await vault.getAddress();
      const lbPairAddr = await mockLBPair.getAddress();
      const pmAddr = await positionManager.getAddress();

      // Set up totalSupply and reserves so previousX/Y are computed
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
      expect(position.proxy).to.not.equal(ethers.ZeroAddress);

      // Verify previousX/Y baselines computed from reserves
      // Mock liquidityMinted=[1000,2000,1000], totalSupply=10000 per bin
      // Bin 8388607 (Y-only): shareX = 1000*0/10000 = 0, shareY = 1000*10000/10000 = 1000
      // Bin 8388608 (active): shareX = 2000*5000/10000 = 1000, shareY = 1000
      // Bin 8388609 (X-only): shareX = 1000*10000/10000 = 1000, shareY = 0
      expect(position.previousX.length).to.equal(3);
      expect(position.previousY.length).to.equal(3);
      expect(position.previousX[0]).to.equal(0);
      expect(position.previousY[0]).to.equal(1000);
      expect(position.previousX[1]).to.equal(1000);
      expect(position.previousY[1]).to.equal(1000);
      expect(position.previousX[2]).to.equal(1000);
      expect(position.previousY[2]).to.equal(0);
    });

    it("should emit PositionCreated event with proxy address", async function() {
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

      const tx = await vault.mint([pmAddr], [calldata], [0n]);
      const receipt = await tx.wait();

      // Parse PositionCreated event from receipt logs
      const events = receipt.logs.map(log => {
        try { return positionManager.interface.parseLog(log); }
        catch { return null; }
      }).filter(e => e !== null);

      const createdEvent = events.find(e => e.name === "PositionCreated");
      expect(createdEvent).to.not.be.undefined;
      expect(createdEvent.args.positionId).to.equal(1);
      expect(createdEvent.args.vault).to.equal(vaultAddr);
      expect(createdEvent.args.lbPair).to.equal(lbPairAddr);
      expect(createdEvent.args.proxy).to.not.equal(ethers.ZeroAddress);
      expect(createdEvent.args.depositIds).to.deep.equal([8388607n, 8388608n, 8388609n]);
      expect(createdEvent.args.liquidityMinted).to.deep.equal([1000n, 2000n, 1000n]);
      expect(createdEvent.args.amountXAdded).to.equal(ethers.parseEther("1"));
      expect(createdEvent.args.amountYAdded).to.equal(1000n * 10n ** 6n);
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
      // LB tokens go to proxy, refund to vault
      const position = await positionManager.getPosition(1);
      expect(await mockLBRouter.lastTo()).to.equal(position.proxy);
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

      // Approvals on proxy should be reset to 0
      const position = await positionManager.getPosition(1);
      expect(await tokenX.allowance(position.proxy, routerAddr)).to.equal(0);
      expect(await tokenY.allowance(position.proxy, routerAddr)).to.equal(0);
    });

    it("should deploy a unique proxy for each position", async function() {
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
      await vault.mint([pmAddr], [calldata], [0n]);

      const pos1 = await positionManager.getPosition(1);
      const pos2 = await positionManager.getPosition(2);
      expect(pos1.proxy).to.not.equal(pos2.proxy);
      expect(pos1.proxy).to.not.equal(ethers.ZeroAddress);
      expect(pos2.proxy).to.not.equal(ethers.ZeroAddress);
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
      expect(pos.proxy).to.not.equal(ethers.ZeroAddress);
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

    // Helper to encode addToPosition calldata (new signature with previousFeesX/Y)
    function encodeAddToPosition(positionId, amountX, amountY, amountXMin, amountYMin, activeIdDesired, idSlippage, deltaIds, distributionX, distributionY, dl) {
      const iface = new ethers.Interface([
        "function addToPosition(uint256 positionId, uint256[] previousFeesX, uint256[] previousFeesY, uint256 amountX, uint256 amountY, uint256 amountXMin, uint256 amountYMin, uint256 activeIdDesired, uint256 idSlippage, int256[] deltaIds, uint256[] distributionX, uint256[] distributionY, uint256 deadline)"
      ]);
      return iface.encodeFunctionData("addToPosition", [
        positionId, [0, 0, 0], [0, 0, 0], amountX, amountY, amountXMin, amountYMin,
        activeIdDesired, idSlippage, deltaIds, distributionX, distributionY, dl
      ]);
    }

    // Helper variant that accepts explicit previousFees arrays
    function encodeAddToPositionWithFees(positionId, previousFeesX, previousFeesY, amountX, amountY, amountXMin, amountYMin, activeIdDesired, idSlippage, deltaIds, distributionX, distributionY, dl) {
      const iface = new ethers.Interface([
        "function addToPosition(uint256 positionId, uint256[] previousFeesX, uint256[] previousFeesY, uint256 amountX, uint256 amountY, uint256 amountXMin, uint256 amountYMin, uint256 activeIdDesired, uint256 idSlippage, int256[] deltaIds, uint256[] distributionX, uint256[] distributionY, uint256 deadline)"
      ]);
      return iface.encodeFunctionData("addToPosition", [
        positionId, previousFeesX, previousFeesY, amountX, amountY, amountXMin, amountYMin,
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
    // Resulting previousX/Y baselines:
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
          positionId,
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
          positionId,
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
          positionId,
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
          positionId,
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
          positionId,
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
        const pos = await positionManager.getPosition(positionId);
        expect(await mockLBRouter.lastTo()).to.equal(pos.proxy);
        expect(await mockLBRouter.lastRefundTo()).to.equal(vaultAddr);
      });

      it("should pull tokens from vault", async function() {
        const positionId = await createTestPosition();
        const vaultAddr = await vault.getAddress();
        const pmAddr = await positionManager.getAddress();

        const beforeX = await tokenX.balanceOf(vaultAddr);
        const beforeY = await tokenY.balanceOf(vaultAddr);

        const calldata = encodeAddToPosition(
          positionId,
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
          positionId,
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
        expect(await tokenX.allowance(pos.proxy, routerAddr)).to.equal(0);
        expect(await tokenY.allowance(pos.proxy, routerAddr)).to.equal(0);
      });
    });

    describe("position state verification", function() {
      it("should keep position active after addToPosition", async function() {
        const positionId = await createTestPosition();
        const vaultAddr = await vault.getAddress();
        const pmAddr = await positionManager.getAddress();

        const calldata = encodeAddToPosition(
          positionId,
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

        // Remove 50% (new signature with feeShares)
        const removeIface = new ethers.Interface([
          "function decreaseLiquidity(uint256 positionId, uint256 percentage, uint256[] feeShares, uint256 amountXMin, uint256 amountYMin, uint256 deadline)"
        ]);
        const removeCalldata = removeIface.encodeFunctionData("decreaseLiquidity", [
          positionId, 50, [0, 0, 0], 0, 0, deadline
        ]);
        await vault.decreaseLiquidity([pmAddr], [removeCalldata]);

        // Verify halved
        let pos = await positionManager.getPosition(positionId);
        expect(pos.liquidityMinted[0]).to.equal(500);
        expect(pos.liquidityMinted[1]).to.equal(1000);
        expect(pos.liquidityMinted[2]).to.equal(500);

        // Add back with same bins (default mock returns [1000, 2000, 1000])
        const addCalldata = encodeAddToPosition(
          positionId,
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
      it("should revert if position doesn't exist", async function() {
        const vaultAddr = await vault.getAddress();
        const pmAddr = await positionManager.getAddress();

        const calldata = encodeAddToPosition(
          999, // non-existent
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

        // Remove 100% (new signature with feeShares)
        const removeIface = new ethers.Interface([
          "function removePosition(uint256 positionId, uint256[] feeShares, uint256 amountXMin, uint256 amountYMin, uint256 deadline)"
        ]);
        const removeCalldata = removeIface.encodeFunctionData("removePosition", [
          positionId, [0, 0, 0], 0, 0, deadline
        ]);
        await vault.decreaseLiquidity([pmAddr], [removeCalldata]);

        // Try to add to inactive position
        const addCalldata = encodeAddToPosition(
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
          vault.increaseLiquidity([pmAddr], [addCalldata], [0n])
        ).to.be.reverted;
      });

      it("should revert if caller is not position owner", async function() {
        const positionId = await createTestPosition();

        // Direct call from user1 who doesn't own the position
        await expect(
          positionManager.connect(user1).addToPosition(
            positionId,
            [0, 0, 0], [0, 0, 0],
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
        ).to.be.reverted;
      });

      it("should reject non-addToPosition selector via validator", async function() {
        const pmAddr = await positionManager.getAddress();
        const fakeCalldata = "0xdeadbeef" + "00".repeat(32);

        await expect(
          vault.increaseLiquidity([pmAddr], [fakeCalldata], [0n])
        ).to.be.revertedWith("TJPositionValidator: not addToPosition");
      });

      it("should revert when previousFeesX length mismatches depositIds", async function() {
        const positionId = await createTestPosition();
        const vaultAddr = await vault.getAddress();
        const pmAddr = await positionManager.getAddress();

        const calldata = encodeAddToPositionWithFees(
          positionId,
          [0, 0], [0, 0, 0], // feesX has 2 elements, depositIds has 3
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
        ).to.be.revertedWith("TJPositionManager: feesX length mismatch");
      });

      it("should revert when previousFeesY length mismatches depositIds", async function() {
        const positionId = await createTestPosition();
        const vaultAddr = await vault.getAddress();
        const pmAddr = await positionManager.getAddress();

        const calldata = encodeAddToPositionWithFees(
          positionId,
          [0, 0, 0], [0, 0], // feesY has 2 elements, depositIds has 3
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
        ).to.be.revertedWith("TJPositionManager: feesY length mismatch");
      });
    });

    describe("sequential operations", function() {
      it("should support multiple addToPosition calls on same position", async function() {
        const positionId = await createTestPosition();
        const vaultAddr = await vault.getAddress();
        const pmAddr = await positionManager.getAddress();

        // Default mock: same 3 bins [1000, 2000, 1000]
        const calldata = encodeAddToPosition(
          positionId,
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
          positionId,
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

        // Remove 100% (new signature with feeShares)
        const removeIface = new ethers.Interface([
          "function removePosition(uint256 positionId, uint256[] feeShares, uint256 amountXMin, uint256 amountYMin, uint256 deadline)"
        ]);
        const removeCalldata = removeIface.encodeFunctionData("removePosition", [
          positionId, [0, 0, 0], 0, 0, deadline
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
          positionId,
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
          positionId,
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
        expect(pos.previousX[0]).to.equal(0);
        expect(pos.previousY[0]).to.equal(1100);
        expect(pos.previousX[1]).to.equal(1100);
        expect(pos.previousY[1]).to.equal(1100);
        expect(pos.previousX[2]).to.equal(1100);
        expect(pos.previousY[2]).to.equal(0);
      });

      it("should compute fee-aware baseline when previousFees are non-zero", async function() {
        const positionId = await createTestPosition();
        const vaultAddr = await vault.getAddress();
        const pmAddr = await positionManager.getAddress();

        // After create: liquidityMinted=[1000,2000,1000], previousX/Y computed from reserves
        // Current shares at totalSupply=10000:
        //   bin 8388607: currentX=0,    currentY=1000
        //   bin 8388608: currentX=1000, currentY=1000
        //   bin 8388609: currentX=1000, currentY=0

        // Add to position with non-zero previousFees (simulating known fee amounts)
        // After add: liquidityMinted=[2000,4000,2000]
        // currentX for bin 8388608: 4000*5000/10000 = 2000
        // With previousFeesX=[0,100,100] → previousX[1] = 2000 - 100 = 1900
        const calldata = encodeAddToPositionWithFees(
          positionId,
          [0, 100, 100], [100, 100, 0], // non-zero previousFees
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
        // After add: liquidityMinted=[2000,4000,2000]
        // Bin 8388607 (Y-only): currentX=0, currentY=2000*10000/10000=2000, previousY=2000-100=1900
        expect(pos.previousX[0]).to.equal(0);
        expect(pos.previousY[0]).to.equal(1900);
        // Bin 8388608 (active): currentX=4000*5000/10000=2000, previousX=2000-100=1900
        expect(pos.previousX[1]).to.equal(1900);
        expect(pos.previousY[1]).to.equal(1900);
        // Bin 8388609 (X-only): currentX=2000*10000/10000=2000, previousX=2000-100=1900
        expect(pos.previousX[2]).to.equal(1900);
        expect(pos.previousY[2]).to.equal(0);
      });
    });
  });

  describe("removePosition via vault.decreaseLiquidity()", function() {

    // Helper to encode removePosition (100%) or decreaseLiquidity (partial) calldata
    function encodeRemovePosition(positionId, percentage, feeShares, amountXMin, amountYMin, dl) {
      if (percentage === 100) {
        const iface = new ethers.Interface([
          "function removePosition(uint256 positionId, uint256[] feeShares, uint256 amountXMin, uint256 amountYMin, uint256 deadline)"
        ]);
        return iface.encodeFunctionData("removePosition", [
          positionId, feeShares, amountXMin, amountYMin, dl
        ]);
      } else {
        const iface = new ethers.Interface([
          "function decreaseLiquidity(uint256 positionId, uint256 percentage, uint256[] feeShares, uint256 amountXMin, uint256 amountYMin, uint256 deadline)"
        ]);
        return iface.encodeFunctionData("decreaseLiquidity", [
          positionId, percentage, feeShares, amountXMin, amountYMin, dl
        ]);
      }
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

      const calldata = encodeRemovePosition(positionId, 100, [0, 0, 0], 0, 0, deadline);
      await vault.decreaseLiquidity([pmAddr], [calldata]);

      // Struct should be fully deleted (all fields zeroed)
      const pos = await positionManager.getPosition(positionId);
      expect(pos.vault).to.equal(ethers.ZeroAddress);
      expect(pos.lbPair).to.equal(ethers.ZeroAddress);
      expect(pos.active).to.equal(false);
      expect(pos.depositIds.length).to.equal(0);
      expect(pos.liquidityMinted.length).to.equal(0);
      expect(pos.previousX.length).to.equal(0);
      expect(pos.previousY.length).to.equal(0);
    });

    it("should remove 50% of a position and keep active with reduced liquidity", async function() {
      const positionId = await createTestPosition();
      const vaultAddr = await vault.getAddress();
      const pmAddr = await positionManager.getAddress();

      // Get original liquidity values
      const posBefore = await positionManager.getPosition(positionId);
      const origLiquidity = posBefore.liquidityMinted.map(lm => lm);

      const calldata = encodeRemovePosition(positionId, 50, [0, 0, 0], 0, 0, deadline);
      await vault.decreaseLiquidity([pmAddr], [calldata]);

      const posAfter = await positionManager.getPosition(positionId);
      expect(posAfter.active).to.equal(true);
      expect(posAfter.depositIds.length).to.equal(3);
      expect(posAfter.liquidityMinted.length).to.equal(3);

      // Each liquidityMinted should be halved
      for (let i = 0; i < posAfter.liquidityMinted.length; i++) {
        expect(posAfter.liquidityMinted[i]).to.equal(origLiquidity[i] / 2n);
      }

      // previousX/Y baselines should be recalculated for reduced position
      // Bin 8388607 (Y-only): shareX=0, shareY=500*10000/10000=500
      // Bin 8388608 (active): shareX=1000*5000/10000=500, shareY=500
      // Bin 8388609 (X-only): shareX=500*10000/10000=500, shareY=0
      expect(posAfter.previousX[0]).to.equal(0);
      expect(posAfter.previousY[0]).to.equal(500);
      expect(posAfter.previousX[1]).to.equal(500);
      expect(posAfter.previousY[1]).to.equal(500);
      expect(posAfter.previousX[2]).to.equal(500);
      expect(posAfter.previousY[2]).to.equal(0);
    });

    it("should emit PositionRemoved event", async function() {
      const positionId = await createTestPosition();
      const vaultAddr = await vault.getAddress();
      const pmAddr = await positionManager.getAddress();

      const calldata = encodeRemovePosition(positionId, 100, [0, 0, 0], 0, 0, deadline);

      await expect(vault.decreaseLiquidity([pmAddr], [calldata]))
        .to.emit(positionManager, "PositionRemoved");
    });

    it("should pass correct parameters to LBRouter.removeLiquidity", async function() {
      const positionId = await createTestPosition();
      const vaultAddr = await vault.getAddress();
      const pmAddr = await positionManager.getAddress();

      // Set mock return values so the combined slippage check passes
      await mockLBRouter.setRemoveReturnValues(ethers.parseEther("0.5"), 500n * 10n ** 6n);

      const calldata = encodeRemovePosition(positionId, 100, [0, 0, 0], 500, 600, deadline);
      await vault.decreaseLiquidity([pmAddr], [calldata]);

      // Verify router received correct params
      expect(await mockLBRouter.lastRemoveTokenX()).to.equal(await tokenX.getAddress());
      expect(await mockLBRouter.lastRemoveTokenY()).to.equal(await tokenY.getAddress());
      expect(await mockLBRouter.lastRemoveBinStep()).to.equal(20);
      // Combined slippage: amountXMin/YMin are passed as 0 to per-step calls,
      // checked combined at the end. So lastRemove captures the principal call with 0.
      expect(await mockLBRouter.lastRemoveAmountXMin()).to.equal(0);
      expect(await mockLBRouter.lastRemoveAmountYMin()).to.equal(0);
      expect(await mockLBRouter.lastRemoveTo()).to.equal(vaultAddr);
    });

    it("should send scaled amounts to router for 100% removal", async function() {
      const positionId = await createTestPosition();
      const vaultAddr = await vault.getAddress();
      const pmAddr = await positionManager.getAddress();

      // Mock returns liquidityMinted = [1000, 2000, 1000]
      // 100% -> amounts = [1000, 2000, 1000]
      const calldata = encodeRemovePosition(positionId, 100, [0, 0, 0], 0, 0, deadline);
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
      const calldata = encodeRemovePosition(positionId, 50, [0, 0, 0], 0, 0, deadline);
      await vault.decreaseLiquidity([pmAddr], [calldata]);

      expect(await mockLBRouter.lastRemoveAmounts(0)).to.equal(500);
      expect(await mockLBRouter.lastRemoveAmounts(1)).to.equal(1000);
      expect(await mockLBRouter.lastRemoveAmounts(2)).to.equal(500);
    });

    it("should send deposit IDs to router", async function() {
      const positionId = await createTestPosition();
      const vaultAddr = await vault.getAddress();
      const pmAddr = await positionManager.getAddress();

      const calldata = encodeRemovePosition(positionId, 100, [0, 0, 0], 0, 0, deadline);
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

      const calldata = encodeRemovePosition(positionId, 100, [0, 0, 0], 0, 0, deadline);
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

      // Capture proxy address before removal (struct gets deleted on 100%)
      const posBefore = await positionManager.getPosition(positionId);
      const proxyAddr = posBefore.proxy;

      const calldata = encodeRemovePosition(positionId, 100, [0, 0, 0], 0, 0, deadline);
      await vault.decreaseLiquidity([pmAddr], [calldata]);

      // After removal, approval on proxy should be reset to false
      const approved = await mockLBPair.isApprovedForAll(proxyAddr, routerAddr);
      expect(approved).to.equal(false);
    });

    it("should revert when combined amounts fail slippage check", async function() {
      const positionId = await createTestPosition();
      const vaultAddr = await vault.getAddress();

      // Set router to return very small amounts
      await mockLBRouter.setRemoveReturnValues(1, 1);

      // Impersonate vault to call position manager directly (bypasses PositionVault wrapper)
      await ethers.provider.send("hardhat_impersonateAccount", [vaultAddr]);
      await ethers.provider.send("hardhat_setBalance", [vaultAddr, "0x56BC75E2D63100000"]); // 100 ETH
      const vaultSigner = await ethers.getSigner(vaultAddr);

      await expect(
        positionManager.connect(vaultSigner).removePosition(
          positionId, [0, 0, 0],
          ethers.parseEther("100"), // amountXMin way too high
          ethers.parseEther("100"), // amountYMin way too high
          deadline
        )
      ).to.be.revertedWith("TJPositionManager: insufficient amountX");

      await ethers.provider.send("hardhat_stopImpersonatingAccount", [vaultAddr]);
    });

    describe("validation and security", function() {
      it("should reject when position is not owned by vault", async function() {
        // Create position from our vault
        const positionId = await createTestPosition();

        // Try to remove from a different vault (user1 directly calling)
        await expect(
          positionManager.connect(user1).removePosition(
            positionId, [0, 0, 0], 0, 0, deadline
          )
        ).to.be.revertedWith("TJPositionManager: not position owner");
      });

      it("should reject when position is not active", async function() {
        const positionId = await createTestPosition();
        const vaultAddr = await vault.getAddress();
        const pmAddr = await positionManager.getAddress();

        // Remove 100% first
        const calldata1 = encodeRemovePosition(positionId, 100, [0, 0, 0], 0, 0, deadline);
        await vault.decreaseLiquidity([pmAddr], [calldata1]);

        // Try to remove again - should fail
        const calldata2 = encodeRemovePosition(positionId, 100, [0, 0, 0], 0, 0, deadline);
        await expect(
          vault.decreaseLiquidity([pmAddr], [calldata2])
        ).to.be.reverted;
      });

      it("should reject percentage of 0", async function() {
        const positionId = await createTestPosition();
        const vaultAddr = await vault.getAddress();
        const pmAddr = await positionManager.getAddress();

        const calldata = encodeRemovePosition(positionId, 0, [0, 0, 0], 0, 0, deadline);
        await expect(
          vault.decreaseLiquidity([pmAddr], [calldata])
        ).to.be.reverted;
      });

      it("should reject percentage over 100", async function() {
        const positionId = await createTestPosition();
        const vaultAddr = await vault.getAddress();
        const pmAddr = await positionManager.getAddress();

        const calldata = encodeRemovePosition(positionId, 101, [0, 0, 0], 0, 0, deadline);
        await expect(
          vault.decreaseLiquidity([pmAddr], [calldata])
        ).to.be.reverted;
      });

      it("should reject when router removeLiquidity fails", async function() {
        const positionId = await createTestPosition();
        const vaultAddr = await vault.getAddress();
        const pmAddr = await positionManager.getAddress();

        await mockLBRouter.setShouldFailRemove(true);

        const calldata = encodeRemovePosition(positionId, 100, [0, 0, 0], 0, 0, deadline);
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
        const calldata1 = encodeRemovePosition(positionId, 50, [0, 0, 0], 0, 0, deadline);
        await vault.decreaseLiquidity([pmAddr], [calldata1]);

        let pos = await positionManager.getPosition(positionId);
        expect(pos.active).to.equal(true);
        expect(pos.liquidityMinted[0]).to.equal(500); // 1000 / 2

        // Remove remaining 100% of what's left
        const calldata2 = encodeRemovePosition(positionId, 100, [0, 0, 0], 0, 0, deadline);
        await vault.decreaseLiquidity([pmAddr], [calldata2]);

        // Struct should be fully deleted
        pos = await positionManager.getPosition(positionId);
        expect(pos.vault).to.equal(ethers.ZeroAddress);
        expect(pos.lbPair).to.equal(ethers.ZeroAddress);
        expect(pos.active).to.equal(false);
        expect(pos.depositIds.length).to.equal(0);
        expect(pos.liquidityMinted.length).to.equal(0);
        expect(pos.previousX.length).to.equal(0);
        expect(pos.previousY.length).to.equal(0);
      });

      it("should allow multiple partial removals", async function() {
        const positionId = await createTestPosition();
        const vaultAddr = await vault.getAddress();
        const pmAddr = await positionManager.getAddress();

        // Remove 25% three times
        for (let i = 0; i < 3; i++) {
          const calldata = encodeRemovePosition(positionId, 25, [0, 0, 0], 0, 0, deadline);
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

        await mockLBRouter.resetRemoveCallCount();

        // Set up return values for fee burn (first call) and principal burn (second call)
        await mockLBRouter.setRemoveReturnValues(
          ethers.parseEther("0.01"),  // fee amountX
          100n * 10n ** 6n            // fee amountY
        );
        await mockLBRouter.setRemoveReturnValues2(
          ethers.parseEther("0.5"),   // principal amountX
          500n * 10n ** 6n            // principal amountY
        );

        // Pass non-zero feeShares
        const calldata = encodeRemovePosition(positionId, 100, [91, 182, 91], 0, 0, deadline);
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

        await mockLBRouter.resetRemoveCallCount();

        await mockLBRouter.setRemoveReturnValues(
          ethers.parseEther("0.01"), 100n * 10n ** 6n
        );
        await mockLBRouter.setRemoveReturnValues2(
          ethers.parseEther("0.25"), 250n * 10n ** 6n
        );

        // feeShares: [91, 182, 91] — fee LB tokens to burn
        // After fee burn: lm = [1000-91, 2000-182, 1000-91] = [909, 1818, 909]
        // Then 50% principal: remove [909*50/100, 1818*50/100, 909*50/100] = [454, 909, 454]
        // Final: [909-454, 1818-909, 909-454] = [455, 909, 455]
        const calldata = encodeRemovePosition(positionId, 50, [91, 182, 91], 0, 0, deadline);
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

        expect(pos.liquidityMinted[0]).to.equal(455);
        expect(pos.liquidityMinted[1]).to.equal(909);
        expect(pos.liquidityMinted[2]).to.equal(455);
      });

      it("should skip fee collection when no fees", async function() {
        const positionId = await createTestPosition();
        const vaultAddr = await vault.getAddress();
        const pmAddr = await positionManager.getAddress();

        await mockLBRouter.resetRemoveCallCount();

        // Reserves unchanged — no fees
        await mockLBRouter.setRemoveReturnValues(
          ethers.parseEther("0.5"), 500n * 10n ** 6n
        );

        // Pass [0,0,0] feeShares — no fee burn
        const calldata = encodeRemovePosition(positionId, 100, [0, 0, 0], 0, 0, deadline);
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

        await mockLBRouter.resetRemoveCallCount();

        await mockLBRouter.setRemoveReturnValues(
          ethers.parseEther("0.01"), 100n * 10n ** 6n
        );
        await mockLBRouter.setRemoveReturnValues2(
          ethers.parseEther("0.5"), 500n * 10n ** 6n
        );

        // Pass non-zero feeShares
        const calldata = encodeRemovePosition(positionId, 100, [91, 182, 91], 0, 0, deadline);
        await vault.decreaseLiquidity([pmAddr], [calldata]);

        // Two removeLiquidity calls: fee collection + principal removal
        expect(await mockLBRouter.removeCallCount()).to.equal(2);
      });
    });
  });

  describe("collectFees", function() {

    // Helper matching setup:
    // depositIds=[8388607,8388608,8388609], liquidityMinted=[1000,2000,1000]
    // totalSupply=10000 per bin
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

    function encodeCollectFees(positionId, feeShares, amountXMin, amountYMin, dl) {
      const iface = new ethers.Interface([
        "function collectFees(uint256 positionId, uint256[] feeShares, uint256 amountXMin, uint256 amountYMin, uint256 deadline)"
      ]);
      return iface.encodeFunctionData("collectFees", [positionId, feeShares, amountXMin, amountYMin, dl]);
    }

    describe("validation", function() {
      it("should revert if caller is not position owner", async function() {
        const positionId = await createTestPosition();

        // Direct call from user1 who doesn't own the position
        await expect(
          positionManager.connect(user1).collectFees(positionId, [0, 0, 0], 0, 0, deadline)
        ).to.be.revertedWith("TJPositionManager: not position owner");
      });

      it("should revert for inactive position", async function() {
        const positionId = await createTestPosition();
        const vaultAddr = await vault.getAddress();
        const pmAddr = await positionManager.getAddress();

        // Remove position first (new signature with feeShares)
        const removeIface = new ethers.Interface([
          "function removePosition(uint256 positionId, uint256[] feeShares, uint256 amountXMin, uint256 amountYMin, uint256 deadline)"
        ]);
        const removeCalldata = removeIface.encodeFunctionData("removePosition", [
          positionId, [0, 0, 0], 0, 0, deadline
        ]);
        await vault.decreaseLiquidity([pmAddr], [removeCalldata]);

        const collectCalldata = encodeCollectFees(positionId, [0, 0, 0], 0, 0, deadline);
        await expect(
          vault.collect([pmAddr], [collectCalldata])
        ).to.be.reverted;
      });

      it("should revert when feeShares length mismatches depositIds", async function() {
        const positionId = await createTestPosition();
        const vaultAddr = await vault.getAddress();

        // Impersonate vault to call position manager directly (bypasses PositionVault wrapper)
        await ethers.provider.send("hardhat_impersonateAccount", [vaultAddr]);
        await ethers.provider.send("hardhat_setBalance", [vaultAddr, "0x56BC75E2D63100000"]); // 100 ETH
        const vaultSigner = await ethers.getSigner(vaultAddr);

        // feeShares has 2 elements, depositIds has 3
        await expect(
          positionManager.connect(vaultSigner).collectFees(
            positionId, [0, 0], 0, 0, deadline
          )
        ).to.be.revertedWith("TJPositionManager: feeShares length mismatch");

        await ethers.provider.send("hardhat_stopImpersonatingAccount", [vaultAddr]);
      });
    });

    describe("zero fees", function() {
      it("should return (0,0) when feeShares are all zero", async function() {
        const positionId = await createTestPosition();
        const vaultAddr = await vault.getAddress();
        const pmAddr = await positionManager.getAddress();

        // Pass [0,0,0] feeShares — no-op (early return)
        const collectCalldata = encodeCollectFees(positionId, [0, 0, 0], 0, 0, deadline);
        const tx = await vault.collect([pmAddr], [collectCalldata]);
        const receipt = await tx.wait();

        // No FeesCollected event should be emitted
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

        // Configure mock router return values for removeLiquidity
        await mockLBRouter.setRemoveReturnValues(
          ethers.parseEther("0.01"),  // feeAmountX
          100n * 10n ** 6n            // feeAmountY
        );

        // Pass non-zero feeShares
        const collectCalldata = encodeCollectFees(positionId, [50, 100, 50], 0, 0, deadline);
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

        await mockLBRouter.setRemoveReturnValues(
          ethers.parseEther("0.01"), 100n * 10n ** 6n
        );

        // feeShares = [50, 100, 50] — burns these amounts from each bin
        const collectCalldata = encodeCollectFees(positionId, [50, 100, 50], 0, 0, deadline);
        await vault.collect([pmAddr], [collectCalldata]);

        // liquidityMinted should have decreased by exactly feeShares
        const posAfter = await positionManager.getPosition(positionId);
        expect(posAfter.liquidityMinted[0]).to.equal(posBefore.liquidityMinted[0] - 50n);
        expect(posAfter.liquidityMinted[1]).to.equal(posBefore.liquidityMinted[1] - 100n);
        expect(posAfter.liquidityMinted[2]).to.equal(posBefore.liquidityMinted[2] - 50n);

        // Position should still be active
        expect(posAfter.active).to.be.true;
      });

      it("should update previousX/Y baselines after fee collection", async function() {
        const positionId = await createTestPosition();
        const vaultAddr = await vault.getAddress();
        const pmAddr = await positionManager.getAddress();

        await mockLBRouter.setRemoveReturnValues(
          ethers.parseEther("0.01"), 100n * 10n ** 6n
        );

        // Collect fees with feeShares [50, 100, 50]
        const collectCalldata = encodeCollectFees(positionId, [50, 100, 50], 0, 0, deadline);
        await vault.collect([pmAddr], [collectCalldata]);

        const posAfter = await positionManager.getPosition(positionId);
        // After fee burn: lm = [950, 1900, 950]
        // Baselines reset to current share of post-burn liquidity
        // Bin 8388607 (Y-only): previousX=0, previousY=950*10000/10000=950
        expect(posAfter.previousX[0]).to.equal(0);
        expect(posAfter.previousY[0]).to.equal(950);
        // Bin 8388608 (active): previousX=1900*5000/10000=950, previousY=950
        expect(posAfter.previousX[1]).to.equal(950);
        expect(posAfter.previousY[1]).to.equal(950);
        // Bin 8388609 (X-only): previousX=950*10000/10000=950, previousY=0
        expect(posAfter.previousX[2]).to.equal(950);
        expect(posAfter.previousY[2]).to.equal(0);
      });
    });
  });
});
