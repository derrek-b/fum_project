const { expect } = require("chai");
const { ethers } = require('hardhat');

describe("UniversalRouterValidator", function() {
  let UniversalRouterValidator;
  let validator;
  let vaultAddress;
  let otherAddress;

  // Universal Router execute selector: 0x3593564c
  const EXECUTE_SELECTOR = "0x3593564c";

  // ADDRESS_THIS constant used by Universal Router for multi-hop swaps
  const ADDRESS_THIS = "0x0000000000000000000000000000000000000002";

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
    UNWRAP_WETH: 0x0c,
    V4_SWAP: 0x10
  };

  // V4 Action IDs (inside V4_SWAP)
  const V4_ACTION = {
    SWAP_EXACT_IN_SINGLE: 0x06,
    SWAP_EXACT_IN: 0x07,
    SETTLE_ALL: 0x0c,
    TAKE: 0x0e,
    TAKE_ALL: 0x0f,
    TAKE_PORTION: 0x10,
    TAKE_PAIR: 0x11,
    SWEEP: 0x14
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

  // Helper to encode SWEEP input
  function encodeSweepInput(token, recipient, minAmount) {
    const abiCoder = ethers.AbiCoder.defaultAbiCoder();
    return abiCoder.encode(
      ["address", "address", "uint256"],
      [token, recipient, minAmount]
    );
  }

  // Helper to encode WRAP_ETH / UNWRAP_WETH input
  function encodeWrapInput(recipient, amount) {
    const abiCoder = ethers.AbiCoder.defaultAbiCoder();
    return abiCoder.encode(["address", "uint256"], [recipient, amount]);
  }

  // Helper to encode PERMIT2_PERMIT input (simplified)
  function encodePermit2Input() {
    const abiCoder = ethers.AbiCoder.defaultAbiCoder();
    // Simplified - just needs to be valid bytes
    return abiCoder.encode(["bytes"], ["0x"]);
  }

  // Mock swap path
  function createMockPath(tokenIn, tokenOut) {
    const fee = "000bb8"; // 3000 = 0.3%
    return tokenIn.toLowerCase() + fee + tokenOut.toLowerCase().slice(2);
  }

  // Helper to encode V4_SWAP input (actions + params)
  function encodeV4SwapInput(actions, params) {
    const abiCoder = ethers.AbiCoder.defaultAbiCoder();
    const actionBytes = ethers.hexlify(Uint8Array.from(actions));
    return abiCoder.encode(["bytes", "bytes[]"], [actionBytes, params]);
  }

  // Helper to encode V4 TAKE action params: (Currency currency, address recipient, uint256 amount)
  function encodeV4TakeParams(currency, recipient, amount) {
    const abiCoder = ethers.AbiCoder.defaultAbiCoder();
    return abiCoder.encode(["address", "address", "uint256"], [currency, recipient, amount]);
  }

  // Helper to encode V4 TAKE_ALL action params: (Currency currency, uint256 minAmount)
  function encodeV4TakeAllParams(currency, minAmount) {
    const abiCoder = ethers.AbiCoder.defaultAbiCoder();
    return abiCoder.encode(["address", "uint256"], [currency, minAmount]);
  }

  // Helper to encode V4 TAKE_PAIR action params: (Currency0, Currency1, address recipient)
  function encodeV4TakePairParams(currency0, currency1, recipient) {
    const abiCoder = ethers.AbiCoder.defaultAbiCoder();
    return abiCoder.encode(["address", "address", "address"], [currency0, currency1, recipient]);
  }

  // Helper to encode V4 swap action params (simplified - just placeholder bytes)
  function encodeV4SwapActionParams() {
    return "0x";
  }

  beforeEach(async function() {
    const [owner, user1] = await ethers.getSigners();
    vaultAddress = owner.address; // Use owner as mock vault
    otherAddress = user1.address;

    UniversalRouterValidator = await ethers.getContractFactory("UniversalRouterValidator");
    validator = await UniversalRouterValidator.deploy();
    await validator.waitForDeployment();
  });

  describe("V3_SWAP_EXACT_IN (0x00)", function() {
    it("should allow vault as recipient", async function() {
      const path = createMockPath(otherAddress, otherAddress);
      const input = encodeV3SwapInput(vaultAddress, 1000, 900, path, true);
      const calldata = encodeRouterExecute([CMD.V3_SWAP_EXACT_IN], [input]);

      // Should not revert
      await expect(validator.validateSwap(calldata, vaultAddress)).to.not.be.reverted;
    });

    it("should allow ADDRESS_THIS as recipient (multi-hop)", async function() {
      const path = createMockPath(otherAddress, otherAddress);
      const input = encodeV3SwapInput(ADDRESS_THIS, 1000, 900, path, true);
      const calldata = encodeRouterExecute([CMD.V3_SWAP_EXACT_IN], [input]);

      await expect(validator.validateSwap(calldata, vaultAddress)).to.not.be.reverted;
    });

    it("should reject other address as recipient", async function() {
      const path = createMockPath(otherAddress, otherAddress);
      const input = encodeV3SwapInput(otherAddress, 1000, 900, path, true);
      const calldata = encodeRouterExecute([CMD.V3_SWAP_EXACT_IN], [input]);

      await expect(validator.validateSwap(calldata, vaultAddress))
        .to.be.revertedWith("UniversalRouterValidator: swap recipient must be vault or router");
    });
  });

  describe("V3_SWAP_EXACT_OUT (0x01)", function() {
    it("should allow vault as recipient", async function() {
      const path = createMockPath(otherAddress, otherAddress);
      const input = encodeV3SwapInput(vaultAddress, 1000, 900, path, true);
      const calldata = encodeRouterExecute([CMD.V3_SWAP_EXACT_OUT], [input]);

      await expect(validator.validateSwap(calldata, vaultAddress)).to.not.be.reverted;
    });

    it("should allow ADDRESS_THIS as recipient (multi-hop)", async function() {
      const path = createMockPath(otherAddress, otherAddress);
      const input = encodeV3SwapInput(ADDRESS_THIS, 1000, 900, path, true);
      const calldata = encodeRouterExecute([CMD.V3_SWAP_EXACT_OUT], [input]);

      await expect(validator.validateSwap(calldata, vaultAddress)).to.not.be.reverted;
    });

    it("should reject other address as recipient", async function() {
      const path = createMockPath(otherAddress, otherAddress);
      const input = encodeV3SwapInput(otherAddress, 1000, 900, path, true);
      const calldata = encodeRouterExecute([CMD.V3_SWAP_EXACT_OUT], [input]);

      await expect(validator.validateSwap(calldata, vaultAddress))
        .to.be.revertedWith("UniversalRouterValidator: swap recipient must be vault or router");
    });
  });

  describe("SWEEP (0x04)", function() {
    it("should allow vault as recipient", async function() {
      const input = encodeSweepInput(otherAddress, vaultAddress, 900);
      const calldata = encodeRouterExecute([CMD.SWEEP], [input]);

      await expect(validator.validateSwap(calldata, vaultAddress)).to.not.be.reverted;
    });

    it("should reject ADDRESS_THIS as recipient (must go to vault)", async function() {
      const input = encodeSweepInput(otherAddress, ADDRESS_THIS, 900);
      const calldata = encodeRouterExecute([CMD.SWEEP], [input]);

      await expect(validator.validateSwap(calldata, vaultAddress))
        .to.be.revertedWith("UniversalRouterValidator: sweep recipient must be vault");
    });

    it("should reject other address as recipient", async function() {
      const input = encodeSweepInput(otherAddress, otherAddress, 900);
      const calldata = encodeRouterExecute([CMD.SWEEP], [input]);

      await expect(validator.validateSwap(calldata, vaultAddress))
        .to.be.revertedWith("UniversalRouterValidator: sweep recipient must be vault");
    });
  });

  describe("V2_SWAP_EXACT_IN (0x08)", function() {
    it("should allow vault as recipient", async function() {
      const input = encodeV2SwapInput(vaultAddress, 1000, 900, [otherAddress, otherAddress], true);
      const calldata = encodeRouterExecute([CMD.V2_SWAP_EXACT_IN], [input]);

      await expect(validator.validateSwap(calldata, vaultAddress)).to.not.be.reverted;
    });

    it("should allow ADDRESS_THIS as recipient (multi-hop)", async function() {
      const input = encodeV2SwapInput(ADDRESS_THIS, 1000, 900, [otherAddress, otherAddress], true);
      const calldata = encodeRouterExecute([CMD.V2_SWAP_EXACT_IN], [input]);

      await expect(validator.validateSwap(calldata, vaultAddress)).to.not.be.reverted;
    });

    it("should reject other address as recipient", async function() {
      const input = encodeV2SwapInput(otherAddress, 1000, 900, [otherAddress, otherAddress], true);
      const calldata = encodeRouterExecute([CMD.V2_SWAP_EXACT_IN], [input]);

      await expect(validator.validateSwap(calldata, vaultAddress))
        .to.be.revertedWith("UniversalRouterValidator: swap recipient must be vault or router");
    });
  });

  describe("V2_SWAP_EXACT_OUT (0x09)", function() {
    it("should allow vault as recipient", async function() {
      const input = encodeV2SwapInput(vaultAddress, 1000, 900, [otherAddress, otherAddress], true);
      const calldata = encodeRouterExecute([CMD.V2_SWAP_EXACT_OUT], [input]);

      await expect(validator.validateSwap(calldata, vaultAddress)).to.not.be.reverted;
    });

    it("should reject other address as recipient", async function() {
      const input = encodeV2SwapInput(otherAddress, 1000, 900, [otherAddress, otherAddress], true);
      const calldata = encodeRouterExecute([CMD.V2_SWAP_EXACT_OUT], [input]);

      await expect(validator.validateSwap(calldata, vaultAddress))
        .to.be.revertedWith("UniversalRouterValidator: swap recipient must be vault or router");
    });
  });

  describe("PERMIT2_PERMIT (0x0a)", function() {
    it("should allow without recipient validation", async function() {
      const input = encodePermit2Input();
      const calldata = encodeRouterExecute([CMD.PERMIT2_PERMIT], [input]);

      await expect(validator.validateSwap(calldata, vaultAddress)).to.not.be.reverted;
    });
  });

  describe("WRAP_ETH (0x0b)", function() {
    it("should allow vault as recipient", async function() {
      const input = encodeWrapInput(vaultAddress, ethers.parseEther("1"));
      const calldata = encodeRouterExecute([CMD.WRAP_ETH], [input]);

      await expect(validator.validateSwap(calldata, vaultAddress)).to.not.be.reverted;
    });

    it("should allow ADDRESS_THIS as recipient (multi-hop)", async function() {
      const input = encodeWrapInput(ADDRESS_THIS, ethers.parseEther("1"));
      const calldata = encodeRouterExecute([CMD.WRAP_ETH], [input]);

      await expect(validator.validateSwap(calldata, vaultAddress)).to.not.be.reverted;
    });

    it("should reject other address as recipient", async function() {
      const input = encodeWrapInput(otherAddress, ethers.parseEther("1"));
      const calldata = encodeRouterExecute([CMD.WRAP_ETH], [input]);

      await expect(validator.validateSwap(calldata, vaultAddress))
        .to.be.revertedWith("UniversalRouterValidator: wrap recipient must be vault or router");
    });
  });

  describe("UNWRAP_WETH (0x0c)", function() {
    it("should allow vault as recipient", async function() {
      const input = encodeWrapInput(vaultAddress, ethers.parseEther("1"));
      const calldata = encodeRouterExecute([CMD.UNWRAP_WETH], [input]);

      await expect(validator.validateSwap(calldata, vaultAddress)).to.not.be.reverted;
    });

    it("should reject ADDRESS_THIS as recipient (ETH must go to vault)", async function() {
      const input = encodeWrapInput(ADDRESS_THIS, ethers.parseEther("1"));
      const calldata = encodeRouterExecute([CMD.UNWRAP_WETH], [input]);

      await expect(validator.validateSwap(calldata, vaultAddress))
        .to.be.revertedWith("UniversalRouterValidator: unwrap recipient must be vault");
    });

    it("should reject other address as recipient", async function() {
      const input = encodeWrapInput(otherAddress, ethers.parseEther("1"));
      const calldata = encodeRouterExecute([CMD.UNWRAP_WETH], [input]);

      await expect(validator.validateSwap(calldata, vaultAddress))
        .to.be.revertedWith("UniversalRouterValidator: unwrap recipient must be vault");
    });
  });

  describe("V4_SWAP (0x10)", function() {
    it("should allow V4_SWAP with TAKE_ALL (msgSender = vault)", async function() {
      // TAKE_ALL uses msgSender, no explicit recipient to validate
      const takeAllParams = encodeV4TakeAllParams(otherAddress, 900);
      const v4Input = encodeV4SwapInput(
        [V4_ACTION.SWAP_EXACT_IN_SINGLE, V4_ACTION.SETTLE_ALL, V4_ACTION.TAKE_ALL],
        [encodeV4SwapActionParams(), encodeV4SwapActionParams(), takeAllParams]
      );
      const calldata = encodeRouterExecute([CMD.V4_SWAP], [v4Input]);

      await expect(validator.validateSwap(calldata, vaultAddress)).to.not.be.reverted;
    });

    it("should allow V4_SWAP with TAKE to vault", async function() {
      const takeParams = encodeV4TakeParams(otherAddress, vaultAddress, 900);
      const v4Input = encodeV4SwapInput(
        [V4_ACTION.SWAP_EXACT_IN_SINGLE, V4_ACTION.SETTLE_ALL, V4_ACTION.TAKE],
        [encodeV4SwapActionParams(), encodeV4SwapActionParams(), takeParams]
      );
      const calldata = encodeRouterExecute([CMD.V4_SWAP], [v4Input]);

      await expect(validator.validateSwap(calldata, vaultAddress)).to.not.be.reverted;
    });

    it("should allow V4_SWAP with TAKE to ADDRESS_THIS (multi-hop)", async function() {
      const takeParams = encodeV4TakeParams(otherAddress, ADDRESS_THIS, 900);
      const v4Input = encodeV4SwapInput(
        [V4_ACTION.SWAP_EXACT_IN_SINGLE, V4_ACTION.SETTLE_ALL, V4_ACTION.TAKE],
        [encodeV4SwapActionParams(), encodeV4SwapActionParams(), takeParams]
      );
      const calldata = encodeRouterExecute([CMD.V4_SWAP], [v4Input]);

      await expect(validator.validateSwap(calldata, vaultAddress)).to.not.be.reverted;
    });

    it("should reject V4_SWAP with TAKE to external address", async function() {
      const takeParams = encodeV4TakeParams(otherAddress, otherAddress, 900);
      const v4Input = encodeV4SwapInput(
        [V4_ACTION.SWAP_EXACT_IN_SINGLE, V4_ACTION.SETTLE_ALL, V4_ACTION.TAKE],
        [encodeV4SwapActionParams(), encodeV4SwapActionParams(), takeParams]
      );
      const calldata = encodeRouterExecute([CMD.V4_SWAP], [v4Input]);

      await expect(validator.validateSwap(calldata, vaultAddress))
        .to.be.revertedWith("UniversalRouterValidator: V4 take recipient must be vault or router");
    });

    it("should allow V4_SWAP with V4 SWEEP to vault", async function() {
      const takeAllParams = encodeV4TakeAllParams(otherAddress, 900);
      const sweepParams = encodeV4TakeParams(otherAddress, vaultAddress, 0);
      const v4Input = encodeV4SwapInput(
        [V4_ACTION.SWAP_EXACT_IN_SINGLE, V4_ACTION.SETTLE_ALL, V4_ACTION.TAKE_ALL, V4_ACTION.SWEEP],
        [encodeV4SwapActionParams(), encodeV4SwapActionParams(), takeAllParams, sweepParams]
      );
      const calldata = encodeRouterExecute([CMD.V4_SWAP], [v4Input]);

      await expect(validator.validateSwap(calldata, vaultAddress)).to.not.be.reverted;
    });

    it("should reject V4_SWAP with V4 SWEEP to external address", async function() {
      const takeAllParams = encodeV4TakeAllParams(otherAddress, 900);
      const sweepParams = encodeV4TakeParams(otherAddress, otherAddress, 0);
      const v4Input = encodeV4SwapInput(
        [V4_ACTION.SWAP_EXACT_IN_SINGLE, V4_ACTION.SETTLE_ALL, V4_ACTION.TAKE_ALL, V4_ACTION.SWEEP],
        [encodeV4SwapActionParams(), encodeV4SwapActionParams(), takeAllParams, sweepParams]
      );
      const calldata = encodeRouterExecute([CMD.V4_SWAP], [v4Input]);

      await expect(validator.validateSwap(calldata, vaultAddress))
        .to.be.revertedWith("UniversalRouterValidator: V4 sweep recipient must be vault");
    });

    it("should validate multiple TAKE actions in single V4_SWAP", async function() {
      // First TAKE is OK, second TAKE has bad recipient
      const takeParams1 = encodeV4TakeParams(otherAddress, vaultAddress, 500);
      const takeParams2 = encodeV4TakeParams(otherAddress, otherAddress, 400); // Bad!
      const v4Input = encodeV4SwapInput(
        [V4_ACTION.SWAP_EXACT_IN_SINGLE, V4_ACTION.SETTLE_ALL, V4_ACTION.TAKE, V4_ACTION.TAKE],
        [encodeV4SwapActionParams(), encodeV4SwapActionParams(), takeParams1, takeParams2]
      );
      const calldata = encodeRouterExecute([CMD.V4_SWAP], [v4Input]);

      await expect(validator.validateSwap(calldata, vaultAddress))
        .to.be.revertedWith("UniversalRouterValidator: V4 take recipient must be vault or router");
    });

    it("should allow V4_SWAP with TAKE_PORTION to vault", async function() {
      // TAKE_PORTION has explicit recipient: (currency, recipient, bips)
      const takePortionParams = encodeV4TakeParams(otherAddress, vaultAddress, 5000); // 50% in bips
      const v4Input = encodeV4SwapInput(
        [V4_ACTION.SWAP_EXACT_IN_SINGLE, V4_ACTION.SETTLE_ALL, V4_ACTION.TAKE_PORTION],
        [encodeV4SwapActionParams(), encodeV4SwapActionParams(), takePortionParams]
      );
      const calldata = encodeRouterExecute([CMD.V4_SWAP], [v4Input]);

      await expect(validator.validateSwap(calldata, vaultAddress)).to.not.be.reverted;
    });

    it("should reject V4_SWAP with TAKE_PORTION to external address", async function() {
      // TAKE_PORTION has explicit recipient - must validate
      const takePortionParams = encodeV4TakeParams(otherAddress, otherAddress, 5000);
      const v4Input = encodeV4SwapInput(
        [V4_ACTION.SWAP_EXACT_IN_SINGLE, V4_ACTION.SETTLE_ALL, V4_ACTION.TAKE_PORTION],
        [encodeV4SwapActionParams(), encodeV4SwapActionParams(), takePortionParams]
      );
      const calldata = encodeRouterExecute([CMD.V4_SWAP], [v4Input]);

      await expect(validator.validateSwap(calldata, vaultAddress))
        .to.be.revertedWith("UniversalRouterValidator: V4 take recipient must be vault or router");
    });

    it("should allow V4_SWAP with TAKE_PAIR to vault", async function() {
      // TAKE_PAIR has explicit recipient: (currency0, currency1, recipient)
      const takePairParams = encodeV4TakePairParams(otherAddress, vaultAddress, vaultAddress);
      const v4Input = encodeV4SwapInput(
        [V4_ACTION.SWAP_EXACT_IN_SINGLE, V4_ACTION.SETTLE_ALL, V4_ACTION.TAKE_PAIR],
        [encodeV4SwapActionParams(), encodeV4SwapActionParams(), takePairParams]
      );
      const calldata = encodeRouterExecute([CMD.V4_SWAP], [v4Input]);

      await expect(validator.validateSwap(calldata, vaultAddress)).to.not.be.reverted;
    });

    it("should reject V4_SWAP with TAKE_PAIR to external address", async function() {
      // TAKE_PAIR has explicit recipient - must validate
      const takePairParams = encodeV4TakePairParams(otherAddress, vaultAddress, otherAddress);
      const v4Input = encodeV4SwapInput(
        [V4_ACTION.SWAP_EXACT_IN_SINGLE, V4_ACTION.SETTLE_ALL, V4_ACTION.TAKE_PAIR],
        [encodeV4SwapActionParams(), encodeV4SwapActionParams(), takePairParams]
      );
      const calldata = encodeRouterExecute([CMD.V4_SWAP], [v4Input]);

      await expect(validator.validateSwap(calldata, vaultAddress))
        .to.be.revertedWith("UniversalRouterValidator: V4 take recipient must be vault or router");
    });
  });

  describe("Blocked Commands", function() {
    it("should reject TRANSFER command (0x05)", async function() {
      const abiCoder = ethers.AbiCoder.defaultAbiCoder();
      const input = abiCoder.encode(["address", "address", "uint256"], [otherAddress, vaultAddress, 1000]);
      const calldata = encodeRouterExecute([CMD.TRANSFER], [input]);

      await expect(validator.validateSwap(calldata, vaultAddress))
        .to.be.revertedWith("UniversalRouterValidator: command not allowed");
    });

    it("should reject PAY_PORTION command (0x06)", async function() {
      const abiCoder = ethers.AbiCoder.defaultAbiCoder();
      const input = abiCoder.encode(["address", "address", "uint256"], [otherAddress, vaultAddress, 1000]);
      const calldata = encodeRouterExecute([CMD.PAY_PORTION], [input]);

      await expect(validator.validateSwap(calldata, vaultAddress))
        .to.be.revertedWith("UniversalRouterValidator: command not allowed");
    });

    it("should reject unknown command (0x20)", async function() {
      const abiCoder = ethers.AbiCoder.defaultAbiCoder();
      const input = abiCoder.encode(["bytes"], ["0x"]);
      const calldata = encodeRouterExecute([0x20], [input]);

      await expect(validator.validateSwap(calldata, vaultAddress))
        .to.be.revertedWith("UniversalRouterValidator: command not allowed");
    });
  });

  describe("Multi-command Validation", function() {
    it("should validate all commands in sequence", async function() {
      const path = createMockPath(otherAddress, otherAddress);
      // Multi-hop: swap to ADDRESS_THIS, then SWEEP to vault
      const swapInput = encodeV3SwapInput(ADDRESS_THIS, 1000, 900, path, true);
      const sweepInput = encodeSweepInput(otherAddress, vaultAddress, 900);
      const calldata = encodeRouterExecute(
        [CMD.V3_SWAP_EXACT_IN, CMD.SWEEP],
        [swapInput, sweepInput]
      );

      await expect(validator.validateSwap(calldata, vaultAddress)).to.not.be.reverted;
    });

    it("should reject if any command has wrong recipient", async function() {
      const path = createMockPath(otherAddress, otherAddress);
      // First swap OK (to ADDRESS_THIS), but SWEEP goes to wrong recipient
      const swapInput = encodeV3SwapInput(ADDRESS_THIS, 1000, 900, path, true);
      const sweepInput = encodeSweepInput(otherAddress, otherAddress, 900); // Wrong recipient!
      const calldata = encodeRouterExecute(
        [CMD.V3_SWAP_EXACT_IN, CMD.SWEEP],
        [swapInput, sweepInput]
      );

      await expect(validator.validateSwap(calldata, vaultAddress))
        .to.be.revertedWith("UniversalRouterValidator: sweep recipient must be vault");
    });

    it("should reject if any command is blocked", async function() {
      const path = createMockPath(otherAddress, otherAddress);
      const swapInput = encodeV3SwapInput(vaultAddress, 1000, 900, path, true);
      const abiCoder = ethers.AbiCoder.defaultAbiCoder();
      const transferInput = abiCoder.encode(["address", "address", "uint256"], [otherAddress, vaultAddress, 1000]);
      const calldata = encodeRouterExecute(
        [CMD.V3_SWAP_EXACT_IN, CMD.TRANSFER],
        [swapInput, transferInput]
      );

      await expect(validator.validateSwap(calldata, vaultAddress))
        .to.be.revertedWith("UniversalRouterValidator: command not allowed");
    });
  });

  describe("Edge Cases", function() {
    it("should reject calldata shorter than 4 bytes", async function() {
      await expect(validator.validateSwap("0x1234", vaultAddress))
        .to.be.revertedWith("UniversalRouterValidator: invalid calldata");
    });

    it("should handle empty commands array", async function() {
      const calldata = encodeRouterExecute([], []);
      // Empty commands is valid (nothing to validate)
      await expect(validator.validateSwap(calldata, vaultAddress)).to.not.be.reverted;
    });
  });
});
