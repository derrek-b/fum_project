const { expect } = require("chai");
const { ethers } = require('hardhat');

describe("TJPositionValidator", function() {
  let TJPositionValidator;
  let validator;
  let vaultAddress;
  let otherAddress;

  // Helper to encode createPosition calldata
  function encodeCreatePosition(vault, lbPair, amountX, amountY, amountXMin, amountYMin, activeIdDesired, idSlippage, deltaIds, distributionX, distributionY, deadline) {
    const iface = new ethers.Interface([
      "function createPosition(address vault, address lbPair, uint256 amountX, uint256 amountY, uint256 amountXMin, uint256 amountYMin, uint256 activeIdDesired, uint256 idSlippage, int256[] deltaIds, uint256[] distributionX, uint256[] distributionY, uint256 deadline)"
    ]);
    return iface.encodeFunctionData("createPosition", [
      vault, lbPair, amountX, amountY, amountXMin, amountYMin,
      activeIdDesired, idSlippage, deltaIds, distributionX, distributionY, deadline
    ]);
  }

  beforeEach(async function() {
    const [owner, user1] = await ethers.getSigners();
    vaultAddress = owner.address;
    otherAddress = user1.address;

    TJPositionValidator = await ethers.getContractFactory("TJPositionValidator");
    validator = await TJPositionValidator.deploy();
    await validator.waitForDeployment();
  });

  describe("validateMint", function() {
    const deadline = Math.floor(Date.now() / 1000) + 3600;
    const lbPair = "0x000000000000000000000000000000000000dEaD";

    it("should allow createPosition with correct vault", async function() {
      const calldata = encodeCreatePosition(
        vaultAddress, lbPair,
        ethers.parseEther("1"), ethers.parseEther("1000"),
        0, 0,
        8388608, 5, // activeIdDesired, idSlippage
        [-2, -1, 0, 1, 2], // deltaIds
        [0, 0, ethers.parseEther("0.333"), ethers.parseEther("0.333"), ethers.parseEther("0.334")], // distributionX
        [ethers.parseEther("0.334"), ethers.parseEther("0.333"), ethers.parseEther("0.333"), 0, 0], // distributionY
        deadline
      );

      await expect(validator.validateMint(calldata, vaultAddress)).to.not.be.reverted;
    });

    it("should reject createPosition with wrong vault in calldata", async function() {
      const calldata = encodeCreatePosition(
        otherAddress, lbPair, // Wrong vault!
        ethers.parseEther("1"), ethers.parseEther("1000"),
        0, 0,
        8388608, 5,
        [-2, -1, 0, 1, 2],
        [0, 0, ethers.parseEther("0.333"), ethers.parseEther("0.333"), ethers.parseEther("0.334")],
        [ethers.parseEther("0.334"), ethers.parseEther("0.333"), ethers.parseEther("0.333"), 0, 0],
        deadline
      );

      await expect(validator.validateMint(calldata, vaultAddress))
        .to.be.revertedWith("TJPositionValidator: vault mismatch");
    });

    it("should reject non-createPosition selector", async function() {
      // Use a random selector with enough padding to pass length check
      const fakeCalldata = "0xdeadbeef" + "00".repeat(32);

      await expect(validator.validateMint(fakeCalldata, vaultAddress))
        .to.be.revertedWith("TJPositionValidator: not createPosition");
    });

    it("should reject calldata that is too short", async function() {
      // Less than 36 bytes (4 selector + 32 param)
      await expect(validator.validateMint("0xdeadbeef", vaultAddress))
        .to.be.revertedWith("TJPositionValidator: invalid data");
    });

    it("should reject calldata with only selector (35 bytes)", async function() {
      // 4 bytes selector + 31 bytes = 35 bytes, less than required 36
      const shortCalldata = "0xdeadbeef" + "00".repeat(31);

      await expect(validator.validateMint(shortCalldata, vaultAddress))
        .to.be.revertedWith("TJPositionValidator: invalid data");
    });
  });

  describe("validateIncreaseLiquidity", function() {
    it("should revert with not yet implemented", async function() {
      await expect(validator.validateIncreaseLiquidity("0x", vaultAddress))
        .to.be.revertedWith("TJPositionValidator: not yet implemented");
    });
  });

  describe("validateDecreaseLiquidity", function() {
    it("should revert with not yet implemented", async function() {
      await expect(validator.validateDecreaseLiquidity("0x", vaultAddress))
        .to.be.revertedWith("TJPositionValidator: not yet implemented");
    });
  });

  describe("validateCollect", function() {
    it("should revert with not yet implemented", async function() {
      await expect(validator.validateCollect("0x", vaultAddress))
        .to.be.revertedWith("TJPositionValidator: not yet implemented");
    });
  });

  describe("validateBurn", function() {
    it("should revert with not yet implemented", async function() {
      await expect(validator.validateBurn("0x", vaultAddress))
        .to.be.revertedWith("TJPositionValidator: not yet implemented");
    });
  });
});
