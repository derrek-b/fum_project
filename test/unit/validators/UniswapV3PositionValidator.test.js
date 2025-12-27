const { expect } = require("chai");
const { ethers } = require('hardhat');

describe("UniswapV3PositionValidator", function() {
  let UniswapV3PositionValidator;
  let validator;
  let vaultAddress;
  let otherAddress;
  let token0;
  let token1;

  // Function selectors for NonfungiblePositionManager
  const SELECTORS = {
    MINT: "0x88316456",
    INCREASE_LIQUIDITY: "0x219f5d17",
    DECREASE_LIQUIDITY: "0x0c49ccbe",
    COLLECT: "0xfc6f7865",
    BURN: "0x42966c68",
    MULTICALL: "0xac9650d8"
  };

  // Helper to encode mint calldata
  function encodeMint(token0Addr, token1Addr, fee, tickLower, tickUpper, amount0Desired, amount1Desired, amount0Min, amount1Min, recipient, deadline) {
    const iface = new ethers.Interface([
      "function mint((address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline) params)"
    ]);
    return iface.encodeFunctionData("mint", [{
      token0: token0Addr,
      token1: token1Addr,
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

  // Helper to encode increaseLiquidity calldata
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

  // Helper to encode decreaseLiquidity calldata
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

  // Helper to encode collect calldata
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

  // Helper to encode burn calldata
  function encodeBurn(tokenId) {
    const iface = new ethers.Interface([
      "function burn(uint256 tokenId)"
    ]);
    return iface.encodeFunctionData("burn", [tokenId]);
  }

  // Helper to encode multicall
  function encodeMulticall(calls) {
    const iface = new ethers.Interface([
      "function multicall(bytes[] data)"
    ]);
    return iface.encodeFunctionData("multicall", [calls]);
  }

  beforeEach(async function() {
    const [owner, user1, tokenA, tokenB] = await ethers.getSigners();
    vaultAddress = owner.address;
    otherAddress = user1.address;
    token0 = tokenA.address;
    token1 = tokenB.address;

    UniswapV3PositionValidator = await ethers.getContractFactory("UniswapV3PositionValidator");
    validator = await UniswapV3PositionValidator.deploy();
    await validator.waitForDeployment();
  });

  describe("validateMint", function() {
    const deadline = Math.floor(Date.now() / 1000) + 3600;

    it("should allow mint with vault as recipient", async function() {
      const calldata = encodeMint(
        token0, token1, 3000,
        -887220, 887220,
        ethers.parseEther("1"), ethers.parseEther("1"),
        0, 0,
        vaultAddress,
        deadline
      );

      await expect(validator.validateMint(calldata, vaultAddress)).to.not.be.reverted;
    });

    it("should reject mint with non-vault recipient", async function() {
      const calldata = encodeMint(
        token0, token1, 3000,
        -887220, 887220,
        ethers.parseEther("1"), ethers.parseEther("1"),
        0, 0,
        otherAddress, // Wrong recipient
        deadline
      );

      await expect(validator.validateMint(calldata, vaultAddress))
        .to.be.revertedWith("UniswapV3PositionValidator: mint recipient must be vault");
    });

    it("should reject non-mint selector", async function() {
      // Mint requires >= 356 bytes. Use collect selector + 352 bytes padding = 356 bytes total
      const fakeCalldata = "0xfc6f7865" + "00".repeat(352);

      await expect(validator.validateMint(fakeCalldata, vaultAddress))
        .to.be.revertedWith("UniswapV3PositionValidator: not a mint call");
    });

    it("should reject calldata that is too short", async function() {
      await expect(validator.validateMint("0x88316456", vaultAddress))
        .to.be.revertedWith("UniswapV3PositionValidator: invalid mint data");
    });
  });

  describe("validateIncreaseLiquidity", function() {
    const deadline = Math.floor(Date.now() / 1000) + 3600;

    it("should allow valid increaseLiquidity call", async function() {
      const calldata = encodeIncreaseLiquidity(
        1, // tokenId
        ethers.parseEther("1"),
        ethers.parseEther("1"),
        0, 0,
        deadline
      );

      await expect(validator.validateIncreaseLiquidity(calldata, vaultAddress)).to.not.be.reverted;
    });

    it("should reject non-increaseLiquidity selector", async function() {
      const maxUint128 = 2n ** 128n - 1n;
      const calldata = encodeCollect(1, vaultAddress, maxUint128, maxUint128);

      await expect(validator.validateIncreaseLiquidity(calldata, vaultAddress))
        .to.be.revertedWith("UniswapV3PositionValidator: not an increaseLiquidity call");
    });

    it("should reject calldata that is too short", async function() {
      await expect(validator.validateIncreaseLiquidity("0x12", vaultAddress))
        .to.be.revertedWith("UniswapV3PositionValidator: invalid calldata");
    });
  });

  describe("validateDecreaseLiquidity", function() {
    const deadline = Math.floor(Date.now() / 1000) + 3600;
    const maxUint128 = 2n ** 128n - 1n;

    it("should allow multicall with decreaseLiquidity + collect to vault", async function() {
      const decreaseCall = encodeDecreaseLiquidity(1, 1000, 0, 0, deadline);
      const collectCall = encodeCollect(1, vaultAddress, maxUint128, maxUint128);
      const calldata = encodeMulticall([decreaseCall, collectCall]);

      await expect(validator.validateDecreaseLiquidity(calldata, vaultAddress)).to.not.be.reverted;
    });

    it("should allow multicall with only decreaseLiquidity", async function() {
      const decreaseCall = encodeDecreaseLiquidity(1, 1000, 0, 0, deadline);
      const calldata = encodeMulticall([decreaseCall]);

      await expect(validator.validateDecreaseLiquidity(calldata, vaultAddress)).to.not.be.reverted;
    });

    it("should reject multicall with collect to wrong recipient", async function() {
      const decreaseCall = encodeDecreaseLiquidity(1, 1000, 0, 0, deadline);
      const collectCall = encodeCollect(1, otherAddress, maxUint128, maxUint128); // Wrong recipient!
      const calldata = encodeMulticall([decreaseCall, collectCall]);

      await expect(validator.validateDecreaseLiquidity(calldata, vaultAddress))
        .to.be.revertedWith("UniswapV3PositionValidator: collect recipient must be vault");
    });

    it("should reject non-multicall", async function() {
      const calldata = encodeDecreaseLiquidity(1, 1000, 0, 0, deadline);

      await expect(validator.validateDecreaseLiquidity(calldata, vaultAddress))
        .to.be.revertedWith("UniswapV3PositionValidator: must be multicall");
    });

    it("should reject multicall with disallowed function", async function() {
      const decreaseCall = encodeDecreaseLiquidity(1, 1000, 0, 0, deadline);
      const burnCall = encodeBurn(1); // Burn not allowed in decreaseLiquidity multicall
      const calldata = encodeMulticall([decreaseCall, burnCall]);

      await expect(validator.validateDecreaseLiquidity(calldata, vaultAddress))
        .to.be.revertedWith("UniswapV3PositionValidator: function not allowed in multicall");
    });

    it("should reject calldata that is too short", async function() {
      await expect(validator.validateDecreaseLiquidity("0x12", vaultAddress))
        .to.be.revertedWith("UniswapV3PositionValidator: invalid calldata");
    });
  });

  describe("validateCollect", function() {
    const maxUint128 = 2n ** 128n - 1n;

    it("should allow collect with vault as recipient", async function() {
      const calldata = encodeCollect(1, vaultAddress, maxUint128, maxUint128);

      await expect(validator.validateCollect(calldata, vaultAddress)).to.not.be.reverted;
    });

    it("should reject collect with non-vault recipient", async function() {
      const calldata = encodeCollect(1, otherAddress, maxUint128, maxUint128);

      await expect(validator.validateCollect(calldata, vaultAddress))
        .to.be.revertedWith("UniswapV3PositionValidator: collect recipient must be vault");
    });

    it("should reject non-collect selector", async function() {
      // Use calldata that's >= 68 bytes but has wrong selector (collect requires 68+ bytes)
      // Burn selector (0x42966c68) + 64 bytes padding = 68 bytes total
      const fakeCalldata = "0x42966c68" + "00".repeat(64);

      await expect(validator.validateCollect(fakeCalldata, vaultAddress))
        .to.be.revertedWith("UniswapV3PositionValidator: not a collect call");
    });

    it("should reject calldata that is too short", async function() {
      await expect(validator.validateCollect("0xfc6f7865", vaultAddress))
        .to.be.revertedWith("UniswapV3PositionValidator: invalid collect data");
    });
  });

  describe("validateBurn", function() {
    it("should allow valid burn call", async function() {
      const calldata = encodeBurn(1);

      await expect(validator.validateBurn(calldata, vaultAddress)).to.not.be.reverted;
    });

    it("should reject non-burn selector", async function() {
      const maxUint128 = 2n ** 128n - 1n;
      const calldata = encodeCollect(1, vaultAddress, maxUint128, maxUint128);

      await expect(validator.validateBurn(calldata, vaultAddress))
        .to.be.revertedWith("UniswapV3PositionValidator: not a burn call");
    });

    it("should reject calldata that is too short", async function() {
      await expect(validator.validateBurn("0x12", vaultAddress))
        .to.be.revertedWith("UniswapV3PositionValidator: invalid calldata");
    });
  });
});
