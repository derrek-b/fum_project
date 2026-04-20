const { expect } = require("chai");
const { ethers } = require('hardhat');

describe("UniswapV4PositionValidator", function() {
  let UniswapV4PositionValidator;
  let validator;
  let vaultAddress;
  let otherAddress;
  let token0;
  let token1;
  let hooks;

  // Uniswap V4 sentinel address that resolves to msg.sender at execution time
  const MSG_SENDER = "0x0000000000000000000000000000000000000001";

  // V4 Action codes
  const ACTIONS = {
    INCREASE_LIQUIDITY: 0x00,
    DECREASE_LIQUIDITY: 0x01,
    MINT_POSITION: 0x02,
    BURN_POSITION: 0x03,
    MINT_POSITION_FROM_DELTAS: 0x05,
    SETTLE_PAIR: 0x0d,
    TAKE: 0x0e,
    TAKE_PORTION: 0x10,
    TAKE_PAIR: 0x11,
    SWEEP: 0x14
  };

  // Helper to encode PoolKey struct
  // PoolKey: (Currency currency0, Currency currency1, uint24 fee, int24 tickSpacing, address hooks)
  function encodePoolKey(currency0, currency1, fee, tickSpacing, hooksAddr) {
    return ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "address", "uint24", "int24", "address"],
      [currency0, currency1, fee, tickSpacing, hooksAddr]
    );
  }

  // Helper to encode MINT_POSITION params
  // (PoolKey, int24 tickLower, int24 tickUpper, uint256 liquidity, uint128 amount0Max, uint128 amount1Max, address owner, bytes hookData)
  function encodeMintPositionParams(poolKey, tickLower, tickUpper, liquidity, amount0Max, amount1Max, owner, hookData = "0x") {
    const poolKeyEncoded = encodePoolKey(poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks);

    // Remove 0x prefix from poolKey encoding and add other params
    const params = poolKeyEncoded.slice(2) +
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["int24", "int24", "uint256", "uint128", "uint128", "address", "bytes"],
        [tickLower, tickUpper, liquidity, amount0Max, amount1Max, owner, hookData]
      ).slice(2);

    return "0x" + params;
  }

  // Helper to encode MINT_POSITION_FROM_DELTAS params
  // (PoolKey, int24 tickLower, int24 tickUpper, uint128 amount0Max, uint128 amount1Max, address owner, bytes hookData)
  function encodeMintFromDeltasParams(poolKey, tickLower, tickUpper, amount0Max, amount1Max, owner, hookData = "0x") {
    const poolKeyEncoded = encodePoolKey(poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks);

    const params = poolKeyEncoded.slice(2) +
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["int24", "int24", "uint128", "uint128", "address", "bytes"],
        [tickLower, tickUpper, amount0Max, amount1Max, owner, hookData]
      ).slice(2);

    return "0x" + params;
  }

  // Helper to encode INCREASE_LIQUIDITY or DECREASE_LIQUIDITY params
  // (uint256 tokenId, uint256 liquidity, uint128 amount0, uint128 amount1, bytes hookData)
  function encodeModifyLiquidityParams(tokenId, liquidity, amount0, amount1, hookData = "0x") {
    return ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint256", "uint256", "uint128", "uint128", "bytes"],
      [tokenId, liquidity, amount0, amount1, hookData]
    );
  }

  // Helper to encode BURN_POSITION params
  // (uint256 tokenId, uint128 amount0Min, uint128 amount1Min, bytes hookData)
  function encodeBurnParams(tokenId, amount0Min, amount1Min, hookData = "0x") {
    return ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint256", "uint128", "uint128", "bytes"],
      [tokenId, amount0Min, amount1Min, hookData]
    );
  }

  // Helper to encode TAKE params
  // (Currency currency, address recipient, uint256 amount)
  function encodeTakeParams(currency, recipient, amount) {
    return ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "address", "uint256"],
      [currency, recipient, amount]
    );
  }

  // Helper to encode TAKE_PORTION params
  // (Currency currency, address recipient, uint256 bips)
  function encodeTakePortionParams(currency, recipient, bips) {
    return ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "address", "uint256"],
      [currency, recipient, bips]
    );
  }

  // Helper to encode TAKE_PAIR params
  // (Currency currency0, Currency currency1, address recipient)
  function encodeTakePairParams(currency0, currency1, recipient) {
    return ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "address", "address"],
      [currency0, currency1, recipient]
    );
  }

  // Helper to encode SWEEP params
  // (Currency currency, address to)
  function encodeSweepParams(currency, to) {
    return ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "address"],
      [currency, to]
    );
  }

  // Helper to encode SETTLE_PAIR params
  // (Currency currency0, Currency currency1)
  function encodeSettlePairParams(currency0, currency1) {
    return ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "address"],
      [currency0, currency1]
    );
  }

  // Helper to encode unlockData with actions and params
  function encodeUnlockData(actions, params) {
    // actions is an array of action codes (uint8)
    // params is an array of bytes

    // Pack actions into bytes
    const actionsBytes = "0x" + actions.map(a => a.toString(16).padStart(2, '0')).join('');

    // Encode as (bytes actions, bytes[] params)
    return ethers.AbiCoder.defaultAbiCoder().encode(
      ["bytes", "bytes[]"],
      [actionsBytes, params]
    );
  }

  // Helper to encode full modifyLiquidities calldata
  function encodeModifyLiquidities(actions, params, deadline) {
    const unlockData = encodeUnlockData(actions, params);

    const iface = new ethers.Interface([
      "function modifyLiquidities(bytes unlockData, uint256 deadline)"
    ]);

    return iface.encodeFunctionData("modifyLiquidities", [unlockData, deadline]);
  }

  beforeEach(async function() {
    const [owner, user1, tokenA, tokenB, hooksContract] = await ethers.getSigners();
    vaultAddress = owner.address;
    otherAddress = user1.address;
    token0 = tokenA.address < tokenB.address ? tokenA.address : tokenB.address;
    token1 = tokenA.address < tokenB.address ? tokenB.address : tokenA.address;
    hooks = hooksContract.address;

    UniswapV4PositionValidator = await ethers.getContractFactory("UniswapV4PositionValidator");
    validator = await UniswapV4PositionValidator.deploy();
    await validator.waitForDeployment();
  });

  describe("validateMint", function() {
    const deadline = Math.floor(Date.now() / 1000) + 3600;

    it("should allow mint with vault as owner", async function() {
      const poolKey = { currency0: token0, currency1: token1, fee: 3000, tickSpacing: 60, hooks: ethers.ZeroAddress };
      const mintParams = encodeMintPositionParams(poolKey, -887220, 887220, ethers.parseEther("1"), ethers.parseEther("1"), ethers.parseEther("1"), vaultAddress);
      const settlePairParams = encodeSettlePairParams(token0, token1);

      const calldata = encodeModifyLiquidities(
        [ACTIONS.MINT_POSITION, ACTIONS.SETTLE_PAIR],
        [mintParams, settlePairParams],
        deadline
      );

      await expect(validator.validateMint(calldata, vaultAddress)).to.not.be.reverted;
    });

    it("should allow mint from deltas with vault as owner", async function() {
      const poolKey = { currency0: token0, currency1: token1, fee: 3000, tickSpacing: 60, hooks: ethers.ZeroAddress };
      const mintParams = encodeMintFromDeltasParams(poolKey, -887220, 887220, ethers.parseEther("1"), ethers.parseEther("1"), vaultAddress);
      const settlePairParams = encodeSettlePairParams(token0, token1);

      const calldata = encodeModifyLiquidities(
        [ACTIONS.MINT_POSITION_FROM_DELTAS, ACTIONS.SETTLE_PAIR],
        [mintParams, settlePairParams],
        deadline
      );

      await expect(validator.validateMint(calldata, vaultAddress)).to.not.be.reverted;
    });

    it("should reject mint with non-vault owner", async function() {
      const poolKey = { currency0: token0, currency1: token1, fee: 3000, tickSpacing: 60, hooks: ethers.ZeroAddress };
      const mintParams = encodeMintPositionParams(poolKey, -887220, 887220, ethers.parseEther("1"), ethers.parseEther("1"), ethers.parseEther("1"), otherAddress);
      const settlePairParams = encodeSettlePairParams(token0, token1);

      const calldata = encodeModifyLiquidities(
        [ACTIONS.MINT_POSITION, ACTIONS.SETTLE_PAIR],
        [mintParams, settlePairParams],
        deadline
      );

      await expect(validator.validateMint(calldata, vaultAddress))
        .to.be.revertedWith("UniswapV4PositionValidator: mint owner must be vault");
    });

    it("should reject non-modifyLiquidities selector", async function() {
      // Use wrong selector with enough padding
      const fakeCalldata = "0x12345678" + "00".repeat(500);

      await expect(validator.validateMint(fakeCalldata, vaultAddress))
        .to.be.revertedWith("UniswapV4PositionValidator: not modifyLiquidities");
    });

    it("should reject calldata without mint action", async function() {
      const increaseParams = encodeModifyLiquidityParams(1, ethers.parseEther("1"), ethers.parseEther("1"), ethers.parseEther("1"));
      const settlePairParams = encodeSettlePairParams(token0, token1);

      const calldata = encodeModifyLiquidities(
        [ACTIONS.INCREASE_LIQUIDITY, ACTIONS.SETTLE_PAIR],
        [increaseParams, settlePairParams],
        deadline
      );

      await expect(validator.validateMint(calldata, vaultAddress))
        .to.be.revertedWith("UniswapV4PositionValidator: no mint action found");
    });

    it("should reject calldata that is too short", async function() {
      await expect(validator.validateMint("0x0c49ccbe", vaultAddress))
        .to.be.reverted;
    });
  });

  describe("validateIncreaseLiquidity", function() {
    const deadline = Math.floor(Date.now() / 1000) + 3600;

    it("should allow valid increaseLiquidity call", async function() {
      const increaseParams = encodeModifyLiquidityParams(1, ethers.parseEther("1"), ethers.parseEther("1"), ethers.parseEther("1"));
      const settlePairParams = encodeSettlePairParams(token0, token1);

      const calldata = encodeModifyLiquidities(
        [ACTIONS.INCREASE_LIQUIDITY, ACTIONS.SETTLE_PAIR],
        [increaseParams, settlePairParams],
        deadline
      );

      await expect(validator.validateIncreaseLiquidity(calldata, vaultAddress)).to.not.be.reverted;
    });

    it("should reject non-modifyLiquidities selector", async function() {
      const fakeCalldata = "0x12345678" + "00".repeat(500);

      await expect(validator.validateIncreaseLiquidity(fakeCalldata, vaultAddress))
        .to.be.revertedWith("UniswapV4PositionValidator: not modifyLiquidities");
    });

    it("should reject calldata without increase liquidity action", async function() {
      const decreaseParams = encodeModifyLiquidityParams(1, ethers.parseEther("1"), 0, 0);
      const takePairParams = encodeTakePairParams(token0, token1, vaultAddress);

      const calldata = encodeModifyLiquidities(
        [ACTIONS.DECREASE_LIQUIDITY, ACTIONS.TAKE_PAIR],
        [decreaseParams, takePairParams],
        deadline
      );

      await expect(validator.validateIncreaseLiquidity(calldata, vaultAddress))
        .to.be.revertedWith("UniswapV4PositionValidator: no increase liquidity action found");
    });

    it("should reject calldata that is too short", async function() {
      await expect(validator.validateIncreaseLiquidity("0x12", vaultAddress))
        .to.be.revertedWith("UniswapV4PositionValidator: invalid calldata");
    });
  });

  describe("validateDecreaseLiquidity", function() {
    const deadline = Math.floor(Date.now() / 1000) + 3600;

    it("should allow decreaseLiquidity with TAKE_PAIR to vault", async function() {
      const decreaseParams = encodeModifyLiquidityParams(1, ethers.parseEther("1"), 0, 0);
      const takePairParams = encodeTakePairParams(token0, token1, vaultAddress);

      const calldata = encodeModifyLiquidities(
        [ACTIONS.DECREASE_LIQUIDITY, ACTIONS.TAKE_PAIR],
        [decreaseParams, takePairParams],
        deadline
      );

      await expect(validator.validateDecreaseLiquidity(calldata, vaultAddress)).to.not.be.reverted;
    });

    it("should allow decreaseLiquidity with TAKE_PAIR to MSG_SENDER", async function() {
      const decreaseParams = encodeModifyLiquidityParams(1, ethers.parseEther("1"), 0, 0);
      const takePairParams = encodeTakePairParams(token0, token1, MSG_SENDER);

      const calldata = encodeModifyLiquidities(
        [ACTIONS.DECREASE_LIQUIDITY, ACTIONS.TAKE_PAIR],
        [decreaseParams, takePairParams],
        deadline
      );

      await expect(validator.validateDecreaseLiquidity(calldata, vaultAddress)).to.not.be.reverted;
    });

    it("should allow decreaseLiquidity with TAKE to vault", async function() {
      const decreaseParams = encodeModifyLiquidityParams(1, ethers.parseEther("1"), 0, 0);
      const takeParams0 = encodeTakeParams(token0, vaultAddress, ethers.parseEther("1"));
      const takeParams1 = encodeTakeParams(token1, vaultAddress, ethers.parseEther("1"));

      const calldata = encodeModifyLiquidities(
        [ACTIONS.DECREASE_LIQUIDITY, ACTIONS.TAKE, ACTIONS.TAKE],
        [decreaseParams, takeParams0, takeParams1],
        deadline
      );

      await expect(validator.validateDecreaseLiquidity(calldata, vaultAddress)).to.not.be.reverted;
    });

    it("should allow decreaseLiquidity with TAKE_PORTION to vault", async function() {
      const decreaseParams = encodeModifyLiquidityParams(1, ethers.parseEther("1"), 0, 0);
      const takePortionParams0 = encodeTakePortionParams(token0, vaultAddress, 10000); // 100% in bips
      const takePortionParams1 = encodeTakePortionParams(token1, vaultAddress, 10000);

      const calldata = encodeModifyLiquidities(
        [ACTIONS.DECREASE_LIQUIDITY, ACTIONS.TAKE_PORTION, ACTIONS.TAKE_PORTION],
        [decreaseParams, takePortionParams0, takePortionParams1],
        deadline
      );

      await expect(validator.validateDecreaseLiquidity(calldata, vaultAddress)).to.not.be.reverted;
    });

    it("should allow decreaseLiquidity with SWEEP to vault", async function() {
      const decreaseParams = encodeModifyLiquidityParams(1, ethers.parseEther("1"), 0, 0);
      const takePairParams = encodeTakePairParams(token0, token1, vaultAddress);
      const sweepParams = encodeSweepParams(ethers.ZeroAddress, vaultAddress); // Sweep native ETH

      const calldata = encodeModifyLiquidities(
        [ACTIONS.DECREASE_LIQUIDITY, ACTIONS.TAKE_PAIR, ACTIONS.SWEEP],
        [decreaseParams, takePairParams, sweepParams],
        deadline
      );

      await expect(validator.validateDecreaseLiquidity(calldata, vaultAddress)).to.not.be.reverted;
    });

    it("should reject TAKE_PAIR to non-vault recipient", async function() {
      const decreaseParams = encodeModifyLiquidityParams(1, ethers.parseEther("1"), 0, 0);
      const takePairParams = encodeTakePairParams(token0, token1, otherAddress); // Wrong recipient

      const calldata = encodeModifyLiquidities(
        [ACTIONS.DECREASE_LIQUIDITY, ACTIONS.TAKE_PAIR],
        [decreaseParams, takePairParams],
        deadline
      );

      await expect(validator.validateDecreaseLiquidity(calldata, vaultAddress))
        .to.be.revertedWith("UniswapV4PositionValidator: take pair recipient must be vault or MSG_SENDER");
    });

    it("should reject TAKE to non-vault recipient", async function() {
      const decreaseParams = encodeModifyLiquidityParams(1, ethers.parseEther("1"), 0, 0);
      const takeParams = encodeTakeParams(token0, otherAddress, ethers.parseEther("1")); // Wrong recipient

      const calldata = encodeModifyLiquidities(
        [ACTIONS.DECREASE_LIQUIDITY, ACTIONS.TAKE],
        [decreaseParams, takeParams],
        deadline
      );

      await expect(validator.validateDecreaseLiquidity(calldata, vaultAddress))
        .to.be.revertedWith("UniswapV4PositionValidator: take recipient must be vault");
    });

    it("should reject TAKE_PORTION to non-vault recipient", async function() {
      const decreaseParams = encodeModifyLiquidityParams(1, ethers.parseEther("1"), 0, 0);
      const takePortionParams = encodeTakePortionParams(token0, otherAddress, 10000); // Wrong recipient

      const calldata = encodeModifyLiquidities(
        [ACTIONS.DECREASE_LIQUIDITY, ACTIONS.TAKE_PORTION],
        [decreaseParams, takePortionParams],
        deadline
      );

      await expect(validator.validateDecreaseLiquidity(calldata, vaultAddress))
        .to.be.revertedWith("UniswapV4PositionValidator: take portion recipient must be vault");
    });

    it("should reject SWEEP to non-vault recipient", async function() {
      const decreaseParams = encodeModifyLiquidityParams(1, ethers.parseEther("1"), 0, 0);
      const takePairParams = encodeTakePairParams(token0, token1, vaultAddress);
      const sweepParams = encodeSweepParams(ethers.ZeroAddress, otherAddress); // Wrong recipient

      const calldata = encodeModifyLiquidities(
        [ACTIONS.DECREASE_LIQUIDITY, ACTIONS.TAKE_PAIR, ACTIONS.SWEEP],
        [decreaseParams, takePairParams, sweepParams],
        deadline
      );

      await expect(validator.validateDecreaseLiquidity(calldata, vaultAddress))
        .to.be.revertedWith("UniswapV4PositionValidator: sweep recipient must be vault");
    });

    it("should reject calldata that is too short", async function() {
      await expect(validator.validateDecreaseLiquidity("0x12", vaultAddress))
        .to.be.revertedWith("UniswapV4PositionValidator: invalid calldata");
    });
  });

  describe("validateCollect", function() {
    const deadline = Math.floor(Date.now() / 1000) + 3600;

    it("should allow collect with TAKE_PAIR to vault", async function() {
      // Collect is done via DECREASE_LIQUIDITY with 0 liquidity + TAKE_PAIR
      const decreaseParams = encodeModifyLiquidityParams(1, 0, 0, 0); // 0 liquidity = collect fees only
      const takePairParams = encodeTakePairParams(token0, token1, vaultAddress);

      const calldata = encodeModifyLiquidities(
        [ACTIONS.DECREASE_LIQUIDITY, ACTIONS.TAKE_PAIR],
        [decreaseParams, takePairParams],
        deadline
      );

      await expect(validator.validateCollect(calldata, vaultAddress)).to.not.be.reverted;
    });

    it("should allow collect with TAKE_PAIR to MSG_SENDER", async function() {
      // Collect is done via DECREASE_LIQUIDITY with 0 liquidity + TAKE_PAIR
      const decreaseParams = encodeModifyLiquidityParams(1, 0, 0, 0); // 0 liquidity = collect fees only
      const takePairParams = encodeTakePairParams(token0, token1, MSG_SENDER);

      const calldata = encodeModifyLiquidities(
        [ACTIONS.DECREASE_LIQUIDITY, ACTIONS.TAKE_PAIR],
        [decreaseParams, takePairParams],
        deadline
      );

      await expect(validator.validateCollect(calldata, vaultAddress)).to.not.be.reverted;
    });

    it("should reject collect with TAKE_PAIR to non-vault", async function() {
      const decreaseParams = encodeModifyLiquidityParams(1, 0, 0, 0);
      const takePairParams = encodeTakePairParams(token0, token1, otherAddress); // Wrong recipient

      const calldata = encodeModifyLiquidities(
        [ACTIONS.DECREASE_LIQUIDITY, ACTIONS.TAKE_PAIR],
        [decreaseParams, takePairParams],
        deadline
      );

      await expect(validator.validateCollect(calldata, vaultAddress))
        .to.be.revertedWith("UniswapV4PositionValidator: take pair recipient must be vault or MSG_SENDER");
    });

    it("should reject calldata that is too short", async function() {
      await expect(validator.validateCollect("0x12", vaultAddress))
        .to.be.revertedWith("UniswapV4PositionValidator: invalid calldata");
    });
  });

  describe("validateBurn", function() {
    const deadline = Math.floor(Date.now() / 1000) + 3600;

    it("should allow valid burn call", async function() {
      const burnParams = encodeBurnParams(1, 0, 0);

      const calldata = encodeModifyLiquidities(
        [ACTIONS.BURN_POSITION],
        [burnParams],
        deadline
      );

      await expect(validator.validateBurn(calldata, vaultAddress)).to.not.be.reverted;
    });

    it("should reject non-modifyLiquidities selector", async function() {
      const fakeCalldata = "0x12345678" + "00".repeat(500);

      await expect(validator.validateBurn(fakeCalldata, vaultAddress))
        .to.be.revertedWith("UniswapV4PositionValidator: not modifyLiquidities");
    });

    it("should reject calldata without burn action", async function() {
      const decreaseParams = encodeModifyLiquidityParams(1, ethers.parseEther("1"), 0, 0);
      const takePairParams = encodeTakePairParams(token0, token1, vaultAddress);

      const calldata = encodeModifyLiquidities(
        [ACTIONS.DECREASE_LIQUIDITY, ACTIONS.TAKE_PAIR],
        [decreaseParams, takePairParams],
        deadline
      );

      await expect(validator.validateBurn(calldata, vaultAddress))
        .to.be.revertedWith("UniswapV4PositionValidator: no burn action found");
    });

    it("should reject calldata that is too short", async function() {
      await expect(validator.validateBurn("0x12", vaultAddress))
        .to.be.revertedWith("UniswapV4PositionValidator: invalid calldata");
    });
  });

  describe("Version", function() {
    it("should return the correct version", async function() {
      expect(await validator.VERSION()).to.equal("2.0.0");
    });
  });
});
