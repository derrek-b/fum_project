// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";
import "@uniswap/v3-core/contracts/interfaces/callback/IUniswapV3SwapCallback.sol";
import "@uniswap/v3-core/contracts/interfaces/callback/IUniswapV3MintCallback.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title PoolReplay
 * @notice Replays historical Uniswap V3 pool events (swaps, mints, burns) on a Hardhat fork.
 *         Implements pool callbacks to handle token transfers during swap and mint operations.
 *         The calling wallet must approve this contract for both pool tokens before use.
 */
contract PoolReplay is IUniswapV3SwapCallback, IUniswapV3MintCallback {

  function executeSwap(
    address pool,
    bool zeroForOne,
    int256 amountSpecified,
    uint160 sqrtPriceLimitX96
  ) external {
    IUniswapV3Pool(pool).swap(
      msg.sender,
      zeroForOne,
      amountSpecified,
      sqrtPriceLimitX96,
      abi.encode(msg.sender)
    );
  }

  function uniswapV3SwapCallback(
    int256 amount0Delta,
    int256 amount1Delta,
    bytes calldata data
  ) external override {
    address payer = abi.decode(data, (address));
    address token0 = IUniswapV3Pool(msg.sender).token0();
    address token1 = IUniswapV3Pool(msg.sender).token1();

    if (amount0Delta > 0) {
      IERC20(token0).transferFrom(payer, msg.sender, uint256(amount0Delta));
    }
    if (amount1Delta > 0) {
      IERC20(token1).transferFrom(payer, msg.sender, uint256(amount1Delta));
    }
  }

  function executeMint(
    address pool,
    int24 tickLower,
    int24 tickUpper,
    uint128 amount
  ) external {
    IUniswapV3Pool(pool).mint(
      address(this),
      tickLower,
      tickUpper,
      amount,
      abi.encode(msg.sender)
    );
  }

  function uniswapV3MintCallback(
    uint256 amount0Owed,
    uint256 amount1Owed,
    bytes calldata data
  ) external override {
    address payer = abi.decode(data, (address));
    address token0 = IUniswapV3Pool(msg.sender).token0();
    address token1 = IUniswapV3Pool(msg.sender).token1();

    if (amount0Owed > 0) {
      IERC20(token0).transferFrom(payer, msg.sender, amount0Owed);
    }
    if (amount1Owed > 0) {
      IERC20(token1).transferFrom(payer, msg.sender, amount1Owed);
    }
  }

  function executeBurn(
    address pool,
    int24 tickLower,
    int24 tickUpper,
    uint128 amount
  ) external {
    IUniswapV3Pool(pool).burn(tickLower, tickUpper, amount);
    IUniswapV3Pool(pool).collect(
      msg.sender,
      tickLower,
      tickUpper,
      type(uint128).max,
      type(uint128).max
    );
  }
}
