const { expect } = require("chai");
const { ethers } = require('hardhat');

describe("TJPositionProxy", function() {
  let proxy;
  let manager, nonManager;
  let mockToken;

  beforeEach(async function() {
    [manager, nonManager] = await ethers.getSigners();

    // Deploy proxy implementation directly (not via clone — same logic)
    const TJPositionProxy = await ethers.getContractFactory("TJPositionProxy");
    proxy = await TJPositionProxy.deploy();
    await proxy.waitForDeployment();

    // Deploy a MockERC20 as a target for execute tests
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    mockToken = await MockERC20.deploy("Test Token", "TST", 18);
    await mockToken.waitForDeployment();
  });

  describe("initialization", function() {
    it("should set manager address on initialize", async function() {
      await proxy.initialize(manager.address);
      expect(await proxy.manager()).to.equal(manager.address);
    });

    it("should reject double initialization", async function() {
      await proxy.initialize(manager.address);
      await expect(
        proxy.initialize(nonManager.address)
      ).to.be.revertedWith("TJPositionProxy: already initialized");
    });

    it("should reject zero manager address", async function() {
      await expect(
        proxy.initialize(ethers.ZeroAddress)
      ).to.be.revertedWith("TJPositionProxy: zero manager");
    });
  });

  describe("execute", function() {
    beforeEach(async function() {
      await proxy.initialize(manager.address);
    });

    it("should forward calls and return data when called by manager", async function() {
      const proxyAddr = await proxy.getAddress();
      const tokenAddr = await mockToken.getAddress();

      // Mint some tokens to the proxy so balanceOf returns non-zero
      await mockToken.mint(proxyAddr, ethers.parseEther("100"));

      // Call balanceOf through the proxy's execute
      const balanceOfData = mockToken.interface.encodeFunctionData("balanceOf", [proxyAddr]);
      const result = await proxy.execute.staticCall(tokenAddr, balanceOfData);

      const decoded = ethers.AbiCoder.defaultAbiCoder().decode(["uint256"], result);
      expect(decoded[0]).to.equal(ethers.parseEther("100"));
    });

    it("should revert with 'only manager' when called by non-manager", async function() {
      const tokenAddr = await mockToken.getAddress();
      const balanceOfData = mockToken.interface.encodeFunctionData("balanceOf", [manager.address]);

      await expect(
        proxy.connect(nonManager).execute(tokenAddr, balanceOfData)
      ).to.be.revertedWith("TJPositionProxy: only manager");
    });

    it("should bubble up revert reasons from target contract", async function() {
      const tokenAddr = await mockToken.getAddress();

      // Call transferFrom with no approval — should revert with ERC20 error
      const transferFromData = mockToken.interface.encodeFunctionData("transferFrom", [
        nonManager.address, manager.address, ethers.parseEther("1")
      ]);

      await expect(
        proxy.execute(tokenAddr, transferFromData)
      ).to.be.reverted;
    });
  });

  describe("ERC1155 receiver", function() {
    it("should support ERC1155Receiver interface via supportsInterface", async function() {
      // ERC1155Receiver interface ID = 0x4e2312e0
      const supportsERC1155Receiver = await proxy.supportsInterface("0x4e2312e0");
      expect(supportsERC1155Receiver).to.equal(true);
    });

    it("should support ERC165 interface", async function() {
      // ERC165 interface ID = 0x01ffc9a7
      const supportsERC165 = await proxy.supportsInterface("0x01ffc9a7");
      expect(supportsERC165).to.equal(true);
    });
  });
});
