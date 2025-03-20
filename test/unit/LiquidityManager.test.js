// test/LiquidityManager.test.js
const { expect } = require("chai");
const { ethers } = require("hardhat");

// Uniswap V3 contract addresses on Arbitrum
const UNISWAP_V3_FACTORY = "0x1F98431c8aD98523631AE4a59f267346ea31F984";
const UNISWAP_V3_POSITION_MANAGER = "0xC36442b4a4522E871399CD717aBDD847Ab11FE88";

// Common token addresses on Arbitrum
const WETH_ADDRESS = "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1";
const USDC_ADDRESS = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";

describe("LiquidityManager", function() {
  // These tests might take time as they interact with a forked network
  this.timeout(60000);

  // Variables we'll use throughout the tests
  let liquidityManager;
  let uniswapAdapter;
  let owner, user1, user2;

  // Set up test environment before each test
  beforeEach(async function() {
    // Get signers
    [owner, user1, user2] = await ethers.getSigners();

    // Deploy LiquidityManager
    const LiquidityManager = await ethers.getContractFactory("LiquidityManager");
    liquidityManager = await LiquidityManager.deploy(owner.address);
    await liquidityManager.deployed();

    // Deploy UniswapV3Adapter
    const UniswapV3Adapter = await ethers.getContractFactory("UniswapV3Adapter");
    uniswapAdapter = await UniswapV3Adapter.deploy(UNISWAP_V3_POSITION_MANAGER, UNISWAP_V3_FACTORY);
    await uniswapAdapter.deployed();

    // Register the adapter with the manager
    await liquidityManager.registerAdapter(UNISWAP_V3_FACTORY, uniswapAdapter.address);
  });

  // Group 1: Basic contract functionality
  describe("Basic functionality", function() {
    it("should initialize with the correct owner", async function() {
      expect(await liquidityManager.owner()).to.equal(owner.address);
    });

    it("should start in unpaused state", async function() {
      expect(await liquidityManager.paused()).to.equal(false);
    });

    it("should allow owner to pause the contract", async function() {
      await liquidityManager.pause();
      expect(await liquidityManager.paused()).to.equal(true);
    });

    it("should allow owner to unpause the contract", async function() {
      await liquidityManager.pause();
      await liquidityManager.unpause();
      expect(await liquidityManager.paused()).to.equal(false);
    });

    it("should prevent non-owners from pausing the contract", async function() {
      await expect(
        liquidityManager.connect(user1).pause()
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
  });

  // Group 2: Adapter management
  describe("Adapter management", function() {
    it("should register the adapter correctly", async function() {
      expect(await liquidityManager.isAdapterRegistered(UNISWAP_V3_FACTORY)).to.equal(true);
      expect(await liquidityManager.getAdapter(UNISWAP_V3_FACTORY)).to.equal(uniswapAdapter.address);
    });

    it("should prevent registering adapter with a zero platform address", async function() {
      await expect(
        liquidityManager.registerAdapter(ethers.constants.AddressZero, uniswapAdapter.address)
      ).to.be.revertedWith("LiquidityManager: Zero platform address");
    });

    it("should prevent registering adapter with a zero adapter address", async function() {
      await expect(
        liquidityManager.registerAdapter(UNISWAP_V3_FACTORY, ethers.constants.AddressZero)
      ).to.be.revertedWith("LiquidityManager: Zero adapter address");
    });

    it("should prevent registering adapter for a platform that already has one", async function() {
      await expect(
        liquidityManager.registerAdapter(UNISWAP_V3_FACTORY, uniswapAdapter.address)
      ).to.be.revertedWith("LiquidityManager: Adapter already registered");
    });

    it("should allow updating an adapter", async function() {
      // Deploy a new adapter
      const UniswapV3Adapter = await ethers.getContractFactory("UniswapV3Adapter");
      const newAdapter = await UniswapV3Adapter.deploy(UNISWAP_V3_POSITION_MANAGER, UNISWAP_V3_FACTORY);
      await newAdapter.deployed();

      // Update the adapter
      await liquidityManager.updateAdapter(UNISWAP_V3_FACTORY, newAdapter.address);

      // Verify it was updated
      expect(await liquidityManager.getAdapter(UNISWAP_V3_FACTORY)).to.equal(newAdapter.address);
    });

    it("should allow removing an adapter", async function() {
      await liquidityManager.removeAdapter(UNISWAP_V3_FACTORY);
      expect(await liquidityManager.isAdapterRegistered(UNISWAP_V3_FACTORY)).to.equal(false);
    });
  });

  // Group 3: Position management - Basic tests without token transfers
  describe("Position management basics", function() {
    it("should revert when creating a position with an unregistered platform", async function() {
      const unregisteredPlatform = "0x0000000000000000000000000000000000000001";

      const createParams = {
        platform: unregisteredPlatform,
        token0: WETH_ADDRESS,
        token1: USDC_ADDRESS,
        fee: 3000,
        tickLower: -84222,
        tickUpper: -73136,
        amount0Desired: ethers.utils.parseEther("0.1"),
        amount1Desired: ethers.utils.parseUnits("200", 6),
        amount0Min: 0,
        amount1Min: 0,
        recipient: owner.address,
        deadline: Math.floor(Date.now() / 1000) + 3600
      };

      await expect(
        liquidityManager.createPosition(createParams)
      ).to.be.revertedWith("LiquidityManager: Adapter not registered");
    });
  });

  // We'll add more sophisticated tests that involve actual token transfers
  // and interactions with Uniswap in a separate group
  describe("Position creation (requires token setup)", function() {
    // This test is commented out as it requires token setup
    // We'll set up a helper function to get tokens before enabling this test
    /*
    it("should create a position correctly", async function() {
      // This test would require:
      // 1. Getting test tokens (WETH, USDC)
      // 2. Approving tokens for LiquidityManager
      // 3. Creating a position
      // 4. Verifying position details
    });
    */
  });
});
