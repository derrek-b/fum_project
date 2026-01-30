// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * @title ILBRouter
 * @notice Minimal interface for Trader Joe V2.1 Liquidity Book Router
 * @dev Used by TJPositionManager for addLiquidity calls
 */
interface ILBRouter {
    struct LiquidityParameters {
        address tokenX;
        address tokenY;
        uint256 binStep;
        uint256 amountX;
        uint256 amountY;
        uint256 amountXMin;
        uint256 amountYMin;
        uint256 activeIdDesired;
        uint256 idSlippage;
        int256[] deltaIds;
        uint256[] distributionX;
        uint256[] distributionY;
        address to;
        address refundTo;
        uint256 deadline;
    }

    function addLiquidity(LiquidityParameters calldata liquidityParameters)
        external
        returns (
            uint256 amountXAdded,
            uint256 amountYAdded,
            uint256 amountXLeft,
            uint256 amountYLeft,
            uint256[] memory depositIds,
            uint256[] memory liquidityMinted
        );

    function removeLiquidity(
        address tokenX,
        address tokenY,
        uint16 binStep,
        uint256 amountXMin,
        uint256 amountYMin,
        uint256[] calldata ids,
        uint256[] calldata amounts,
        address to,
        uint256 deadline
    ) external returns (uint256 amountX, uint256 amountY);
}
