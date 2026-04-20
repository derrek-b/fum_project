const { expect } = require("chai");
const { ethers } = require('hardhat');

describe("TJSwapValidator", function() {
  let validator;
  let vaultAddress;
  let otherAddress;

  // Mock token addresses for Path struct
  const tokenA = "0x000000000000000000000000000000000000aaaa";
  const tokenB = "0x000000000000000000000000000000000000bbbb";

  // Mock Path struct: { pairBinSteps: [20], versions: [2], tokenPath: [tokenA, tokenB] }
  const mockPath = {
    pairBinSteps: [20],
    versions: [2],
    tokenPath: [tokenA, tokenB]
  };

  const deadline = Math.floor(Date.now() / 1000) + 3600;

  // LB Router swap function ABI fragments
  const SWAP_ABIS = {
    swapExactTokensForTokens: "function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, (uint256[] pairBinSteps, uint8[] versions, address[] tokenPath) path, address to, uint256 deadline)",
    swapExactTokensForNATIVE: "function swapExactTokensForNATIVE(uint256 amountIn, uint256 amountOutMin, (uint256[] pairBinSteps, uint8[] versions, address[] tokenPath) path, address to, uint256 deadline)",
    swapTokensForExactTokens: "function swapTokensForExactTokens(uint256 amountOut, uint256 amountInMax, (uint256[] pairBinSteps, uint8[] versions, address[] tokenPath) path, address to, uint256 deadline)",
    swapTokensForExactNATIVE: "function swapTokensForExactNATIVE(uint256 amountOut, uint256 amountInMax, (uint256[] pairBinSteps, uint8[] versions, address[] tokenPath) path, address to, uint256 deadline)",
    swapExactNATIVEForTokens: "function swapExactNATIVEForTokens(uint256 amountOutMin, (uint256[] pairBinSteps, uint8[] versions, address[] tokenPath) path, address to, uint256 deadline)",
    swapNATIVEForExactTokens: "function swapNATIVEForExactTokens(uint256 amountOut, (uint256[] pairBinSteps, uint8[] versions, address[] tokenPath) path, address to, uint256 deadline)"
  };

  /**
   * Encode LB Router swap calldata
   * @param {string} functionName - one of the 6 swap function names
   * @param {Object} params - function parameters
   */
  function encodeLBRouterSwap(functionName, params) {
    const iface = new ethers.Interface([SWAP_ABIS[functionName]]);

    // 5-param group
    if (['swapExactTokensForTokens', 'swapExactTokensForNATIVE',
         'swapTokensForExactTokens', 'swapTokensForExactNATIVE'].includes(functionName)) {
      return iface.encodeFunctionData(functionName, [
        params.amount1, params.amount2, params.path, params.to, params.deadline
      ]);
    }

    // 4-param group
    return iface.encodeFunctionData(functionName, [
      params.amount1, params.path, params.to, params.deadline
    ]);
  }

  beforeEach(async function() {
    const [owner, user1] = await ethers.getSigners();
    vaultAddress = owner.address;
    otherAddress = user1.address;

    const TJSwapValidator = await ethers.getContractFactory("TJSwapValidator");
    validator = await TJSwapValidator.deploy();
    await validator.waitForDeployment();
  });

  // ── 5-param group ────────────────────────────────────────────────

  describe("swapExactTokensForTokens", function() {
    it("should allow swap with vault as recipient", async function() {
      const calldata = encodeLBRouterSwap('swapExactTokensForTokens', {
        amount1: ethers.parseEther("1"), amount2: ethers.parseEther("0.9"),
        path: mockPath, to: vaultAddress, deadline
      });
      await expect(validator.validateSwap(calldata, vaultAddress)).to.not.be.reverted;
    });

    it("should reject swap with external recipient", async function() {
      const calldata = encodeLBRouterSwap('swapExactTokensForTokens', {
        amount1: ethers.parseEther("1"), amount2: ethers.parseEther("0.9"),
        path: mockPath, to: otherAddress, deadline
      });
      await expect(validator.validateSwap(calldata, vaultAddress))
        .to.be.revertedWith("TJSwapValidator: recipient mismatch");
    });
  });

  describe("swapExactTokensForNATIVE", function() {
    it("should allow swap with vault as recipient", async function() {
      const calldata = encodeLBRouterSwap('swapExactTokensForNATIVE', {
        amount1: ethers.parseEther("1"), amount2: ethers.parseEther("0.9"),
        path: mockPath, to: vaultAddress, deadline
      });
      await expect(validator.validateSwap(calldata, vaultAddress)).to.not.be.reverted;
    });

    it("should reject swap with external recipient", async function() {
      const calldata = encodeLBRouterSwap('swapExactTokensForNATIVE', {
        amount1: ethers.parseEther("1"), amount2: ethers.parseEther("0.9"),
        path: mockPath, to: otherAddress, deadline
      });
      await expect(validator.validateSwap(calldata, vaultAddress))
        .to.be.revertedWith("TJSwapValidator: recipient mismatch");
    });
  });

  describe("swapTokensForExactTokens", function() {
    it("should allow swap with vault as recipient", async function() {
      const calldata = encodeLBRouterSwap('swapTokensForExactTokens', {
        amount1: ethers.parseEther("1"), amount2: ethers.parseEther("1.1"),
        path: mockPath, to: vaultAddress, deadline
      });
      await expect(validator.validateSwap(calldata, vaultAddress)).to.not.be.reverted;
    });

    it("should reject swap with external recipient", async function() {
      const calldata = encodeLBRouterSwap('swapTokensForExactTokens', {
        amount1: ethers.parseEther("1"), amount2: ethers.parseEther("1.1"),
        path: mockPath, to: otherAddress, deadline
      });
      await expect(validator.validateSwap(calldata, vaultAddress))
        .to.be.revertedWith("TJSwapValidator: recipient mismatch");
    });
  });

  describe("swapTokensForExactNATIVE", function() {
    it("should allow swap with vault as recipient", async function() {
      const calldata = encodeLBRouterSwap('swapTokensForExactNATIVE', {
        amount1: ethers.parseEther("1"), amount2: ethers.parseEther("1.1"),
        path: mockPath, to: vaultAddress, deadline
      });
      await expect(validator.validateSwap(calldata, vaultAddress)).to.not.be.reverted;
    });

    it("should reject swap with external recipient", async function() {
      const calldata = encodeLBRouterSwap('swapTokensForExactNATIVE', {
        amount1: ethers.parseEther("1"), amount2: ethers.parseEther("1.1"),
        path: mockPath, to: otherAddress, deadline
      });
      await expect(validator.validateSwap(calldata, vaultAddress))
        .to.be.revertedWith("TJSwapValidator: recipient mismatch");
    });
  });

  // ── 4-param group ────────────────────────────────────────────────

  describe("swapExactNATIVEForTokens", function() {
    it("should allow swap with vault as recipient", async function() {
      const calldata = encodeLBRouterSwap('swapExactNATIVEForTokens', {
        amount1: ethers.parseEther("0.9"),
        path: mockPath, to: vaultAddress, deadline
      });
      await expect(validator.validateSwap(calldata, vaultAddress)).to.not.be.reverted;
    });

    it("should reject swap with external recipient", async function() {
      const calldata = encodeLBRouterSwap('swapExactNATIVEForTokens', {
        amount1: ethers.parseEther("0.9"),
        path: mockPath, to: otherAddress, deadline
      });
      await expect(validator.validateSwap(calldata, vaultAddress))
        .to.be.revertedWith("TJSwapValidator: recipient mismatch");
    });
  });

  describe("swapNATIVEForExactTokens", function() {
    it("should allow swap with vault as recipient", async function() {
      const calldata = encodeLBRouterSwap('swapNATIVEForExactTokens', {
        amount1: ethers.parseEther("1"),
        path: mockPath, to: vaultAddress, deadline
      });
      await expect(validator.validateSwap(calldata, vaultAddress)).to.not.be.reverted;
    });

    it("should reject swap with external recipient", async function() {
      const calldata = encodeLBRouterSwap('swapNATIVEForExactTokens', {
        amount1: ethers.parseEther("1"),
        path: mockPath, to: otherAddress, deadline
      });
      await expect(validator.validateSwap(calldata, vaultAddress))
        .to.be.revertedWith("TJSwapValidator: recipient mismatch");
    });
  });

  // ── Blocked selectors ────────────────────────────────────────────

  describe("Blocked selectors", function() {
    it("should reject unknown function selector", async function() {
      const fakeCalldata = "0xdeadbeef" + "00".repeat(128);
      await expect(validator.validateSwap(fakeCalldata, vaultAddress))
        .to.be.revertedWith("TJSwapValidator: unknown selector");
    });

    it("should reject another unknown selector", async function() {
      const fakeCalldata = "0x12345678" + "00".repeat(128);
      await expect(validator.validateSwap(fakeCalldata, vaultAddress))
        .to.be.revertedWith("TJSwapValidator: unknown selector");
    });
  });

  // ── Edge cases ───────────────────────────────────────────────────

  describe("Edge cases", function() {
    it("should reject calldata shorter than 4 bytes", async function() {
      await expect(validator.validateSwap("0x1234", vaultAddress))
        .to.be.revertedWith("TJSwapValidator: invalid data");
    });

    it("should reject empty calldata", async function() {
      await expect(validator.validateSwap("0x", vaultAddress))
        .to.be.revertedWith("TJSwapValidator: invalid data");
    });

    it("should reject exactly 4 bytes (valid selector but no params)", async function() {
      // Use a valid 5-param selector but with no data after it
      const iface = new ethers.Interface([SWAP_ABIS.swapExactTokensForTokens]);
      const selector = iface.getFunction('swapExactTokensForTokens').selector;
      await expect(validator.validateSwap(selector, vaultAddress))
        .to.be.revertedWith("TJSwapValidator: data too short");
    });

    it("should reject 5-param calldata truncated before to field", async function() {
      // Valid selector + only 2 slots (64 bytes) instead of needing 3 slots + to
      const iface = new ethers.Interface([SWAP_ABIS.swapExactTokensForTokens]);
      const selector = iface.getFunction('swapExactTokensForTokens').selector;
      const shortCalldata = selector + "00".repeat(96); // Only 96 bytes after selector, need 128
      await expect(validator.validateSwap(shortCalldata, vaultAddress))
        .to.be.revertedWith("TJSwapValidator: data too short");
    });

    it("should reject 4-param calldata truncated before to field", async function() {
      // Valid selector + only 1 slot (32 bytes) instead of needing 2 slots + to
      const iface = new ethers.Interface([SWAP_ABIS.swapExactNATIVEForTokens]);
      const selector = iface.getFunction('swapExactNATIVEForTokens').selector;
      const shortCalldata = selector + "00".repeat(64); // Only 64 bytes after selector, need 96
      await expect(validator.validateSwap(shortCalldata, vaultAddress))
        .to.be.revertedWith("TJSwapValidator: data too short");
    });
  });

  describe("Version", function() {
    it("should return the correct version", async function() {
      expect(await validator.VERSION()).to.equal("2.0.0");
    });
  });
});
