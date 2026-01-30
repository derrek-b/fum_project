// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title MockLBRouter
 * @notice Mock Trader Joe V2.1 LB Router for testing TJPositionManager
 * @dev Simulates addLiquidity by consuming tokens and returning configurable deposit IDs
 *      and liquidity amounts. Sends ERC1155 receipt tokens via the mock pair.
 */
contract MockLBRouter {
    using SafeERC20 for IERC20;

    // Configurable return values
    uint256 public returnAmountXAdded;
    uint256 public returnAmountYAdded;
    uint256 public returnAmountXLeft;
    uint256 public returnAmountYLeft;
    uint256[] public returnDepositIds;
    uint256[] public returnLiquidityMinted;

    // Captured parameters for verification
    address public lastTokenX;
    address public lastTokenY;
    uint256 public lastBinStep;
    uint256 public lastAmountX;
    uint256 public lastAmountY;
    address public lastTo;
    address public lastRefundTo;

    // removeLiquidity captured params
    address public lastRemoveTokenX;
    address public lastRemoveTokenY;
    uint16 public lastRemoveBinStep;
    uint256 public lastRemoveAmountXMin;
    uint256 public lastRemoveAmountYMin;
    address public lastRemoveTo;
    uint256[] public lastRemoveIds;
    uint256[] public lastRemoveAmounts;

    // removeLiquidity return values
    uint256 public returnRemoveAmountX;
    uint256 public returnRemoveAmountY;

    // Control flags
    bool public shouldFail;
    bool public shouldFailRemove;

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

    constructor() {
        // Default return values: 3 bins deposited
        returnAmountXAdded = 1 ether;
        returnAmountYAdded = 1000 * 1e6; // USDC-like
        returnAmountXLeft = 0;
        returnAmountYLeft = 0;

        returnDepositIds = new uint256[](3);
        returnDepositIds[0] = 8388607;
        returnDepositIds[1] = 8388608;
        returnDepositIds[2] = 8388609;

        returnLiquidityMinted = new uint256[](3);
        returnLiquidityMinted[0] = 1000;
        returnLiquidityMinted[1] = 2000;
        returnLiquidityMinted[2] = 1000;
    }

    function setShouldFail(bool _shouldFail) external {
        shouldFail = _shouldFail;
    }

    function setShouldFailRemove(bool _shouldFailRemove) external {
        shouldFailRemove = _shouldFailRemove;
    }

    function setRemoveReturnValues(uint256 amountX, uint256 amountY) external {
        returnRemoveAmountX = amountX;
        returnRemoveAmountY = amountY;
    }

    function setReturnValues(
        uint256 amountXAdded,
        uint256 amountYAdded,
        uint256 amountXLeft,
        uint256 amountYLeft,
        uint256[] calldata depositIds,
        uint256[] calldata liquidityMinted
    ) external {
        returnAmountXAdded = amountXAdded;
        returnAmountYAdded = amountYAdded;
        returnAmountXLeft = amountXLeft;
        returnAmountYLeft = amountYLeft;

        delete returnDepositIds;
        for (uint256 i = 0; i < depositIds.length; i++) {
            returnDepositIds.push(depositIds[i]);
        }

        delete returnLiquidityMinted;
        for (uint256 i = 0; i < liquidityMinted.length; i++) {
            returnLiquidityMinted.push(liquidityMinted[i]);
        }
    }

    function addLiquidity(LiquidityParameters calldata params)
        external
        returns (
            uint256 amountXAdded,
            uint256 amountYAdded,
            uint256 amountXLeft,
            uint256 amountYLeft,
            uint256[] memory depositIds,
            uint256[] memory liquidityMinted
        )
    {
        require(!shouldFail, "MockLBRouter: forced failure");

        // Capture parameters for verification
        lastTokenX = params.tokenX;
        lastTokenY = params.tokenY;
        lastBinStep = params.binStep;
        lastAmountX = params.amountX;
        lastAmountY = params.amountY;
        lastTo = params.to;
        lastRefundTo = params.refundTo;

        // Consume tokens from caller (simulating real router behavior)
        IERC20(params.tokenX).safeTransferFrom(msg.sender, address(this), params.amountX);
        IERC20(params.tokenY).safeTransferFrom(msg.sender, address(this), params.amountY);

        // Refund leftover tokens if configured
        if (returnAmountXLeft > 0) {
            IERC20(params.tokenX).safeTransfer(params.refundTo, returnAmountXLeft);
        }
        if (returnAmountYLeft > 0) {
            IERC20(params.tokenY).safeTransfer(params.refundTo, returnAmountYLeft);
        }

        // Return configured values
        amountXAdded = returnAmountXAdded;
        amountYAdded = returnAmountYAdded;
        amountXLeft = returnAmountXLeft;
        amountYLeft = returnAmountYLeft;

        // Copy storage arrays to memory for return
        depositIds = new uint256[](returnDepositIds.length);
        for (uint256 i = 0; i < returnDepositIds.length; i++) {
            depositIds[i] = returnDepositIds[i];
        }
        liquidityMinted = new uint256[](returnLiquidityMinted.length);
        for (uint256 i = 0; i < returnLiquidityMinted.length; i++) {
            liquidityMinted[i] = returnLiquidityMinted[i];
        }
    }

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
    ) external returns (uint256 amountX, uint256 amountY) {
        require(!shouldFailRemove, "MockLBRouter: forced remove failure");
        require(deadline >= block.timestamp, "MockLBRouter: deadline expired");

        // Capture parameters for verification
        lastRemoveTokenX = tokenX;
        lastRemoveTokenY = tokenY;
        lastRemoveBinStep = binStep;
        lastRemoveAmountXMin = amountXMin;
        lastRemoveAmountYMin = amountYMin;
        lastRemoveTo = to;

        delete lastRemoveIds;
        delete lastRemoveAmounts;
        for (uint256 i = 0; i < ids.length; i++) {
            lastRemoveIds.push(ids[i]);
            lastRemoveAmounts.push(amounts[i]);
        }

        // Use configured return values, or defaults based on amountXMin/amountYMin
        amountX = returnRemoveAmountX > 0 ? returnRemoveAmountX : amountXMin;
        amountY = returnRemoveAmountY > 0 ? returnRemoveAmountY : amountYMin;

        // Send tokens to the recipient (simulating real router behavior)
        if (amountX > 0) {
            IERC20(tokenX).safeTransfer(to, amountX);
        }
        if (amountY > 0) {
            IERC20(tokenY).safeTransfer(to, amountY);
        }
    }
}
