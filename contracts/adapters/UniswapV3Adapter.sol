// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "../interfaces/IProtocolAdapter.sol";
import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Factory.sol";
import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";
import "@uniswap/v3-periphery/contracts/interfaces/INonfungiblePositionManager.sol";
import "@uniswap/v3-periphery/contracts/libraries/PositionKey.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title UniswapV3Adapter
 * @notice Adapter for interacting with Uniswap V3 contracts
 * @dev Implements the IProtocolAdapter interface for Uniswap V3
 */
contract UniswapV3Adapter is IProtocolAdapter {
    using SafeERC20 for IERC20;

    // Uniswap V3 contract addresses
    address public immutable override factory;
    address public immutable positionManager;

    // Maximum uint128 value (used for collecting all fees)
    uint128 private constant MAX_UINT128 = type(uint128).max;

    /**
     * @notice Constructor
     * @param _positionManager Address of the Uniswap V3 NonfungiblePositionManager
     * @param _factory Address of the Uniswap V3 Factory
     */
    constructor(address _positionManager, address _factory) {
        require(_positionManager != address(0), "UniswapV3Adapter: Zero position manager address");
        require(_factory != address(0), "UniswapV3Adapter: Zero factory address");

        positionManager = _positionManager;
        factory = _factory;
    }

    /**
     * @notice Creates a new Uniswap V3 position
     * @param token0 Address of the first token
     * @param token1 Address of the second token
     * @param fee Fee tier for the position
     * @param tickLower Lower tick boundary
     * @param tickUpper Upper tick boundary
     * @param amount0Desired Desired amount of token0
     * @param amount1Desired Desired amount of token1
     * @param amount0Min Minimum amount of token0
     * @param amount1Min Minimum amount of token1
     * @param recipient Address to receive the position NFT
     * @param deadline Timestamp after which the transaction will revert
     * @return tokenId ID of the created position
     * @return liquidity Amount of liquidity in the position
     * @return amount0 Actual amount of token0 used
     * @return amount1 Actual amount of token1 used
     */
    function createPosition(
        address token0,
        address token1,
        uint24 fee,
        int24 tickLower,
        int24 tickUpper,
        uint256 amount0Desired,
        uint256 amount1Desired,
        uint256 amount0Min,
        uint256 amount1Min,
        address recipient,
        uint256 deadline
    ) external override returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1) {
        // Sort tokens if needed (Uniswap requires token0 < token1)
        (address sortedToken0, address sortedToken1, uint256 sortedAmount0Desired,
         uint256 sortedAmount1Desired, uint256 sortedAmount0Min, uint256 sortedAmount1Min) =
            _sortTokensAndAmounts(
                token0,
                token1,
                amount0Desired,
                amount1Desired,
                amount0Min,
                amount1Min
            );

        // Transfer tokens from the caller to this contract
        if (sortedAmount0Desired > 0) {
            IERC20(sortedToken0).safeTransferFrom(msg.sender, address(this), sortedAmount0Desired);
            _approveToken(sortedToken0, positionManager, sortedAmount0Desired);
        }

        if (sortedAmount1Desired > 0) {
            IERC20(sortedToken1).safeTransferFrom(msg.sender, address(this), sortedAmount1Desired);
            _approveToken(sortedToken1, positionManager, sortedAmount1Desired);
        }

        // Create mint parameters for Uniswap
        INonfungiblePositionManager.MintParams memory params = INonfungiblePositionManager.MintParams({
            token0: sortedToken0,
            token1: sortedToken1,
            fee: fee,
            tickLower: tickLower,
            tickUpper: tickUpper,
            amount0Desired: sortedAmount0Desired,
            amount1Desired: sortedAmount1Desired,
            amount0Min: sortedAmount0Min,
            amount1Min: sortedAmount1Min,
            recipient: recipient,
            deadline: deadline
        });

        // Create the position using Uniswap's position manager
        (tokenId, liquidity, amount0, amount1) = INonfungiblePositionManager(positionManager).mint(params);

        // If tokens were sorted, we need to swap the returned amounts to match the input order
        if (token0 != sortedToken0) {
            // Swap amount0 and amount1
            (amount0, amount1) = (amount1, amount0);
        }

        // Refund any unused tokens to the caller
        if (sortedAmount0Desired > amount0 && sortedAmount0Desired - amount0 > 0) {
            IERC20(sortedToken0).safeTransfer(msg.sender, sortedAmount0Desired - amount0);
        }

        if (sortedAmount1Desired > amount1 && sortedAmount1Desired - amount1 > 0) {
            IERC20(sortedToken1).safeTransfer(msg.sender, sortedAmount1Desired - amount1);
        }

        return (tokenId, liquidity, amount0, amount1);
    }

    /**
     * @notice Adds liquidity to an existing Uniswap V3 position
     * @param tokenId ID of the position
     * @param amount0Desired Desired amount of token0
     * @param amount1Desired Desired amount of token1
     * @param amount0Min Minimum amount of token0
     * @param amount1Min Minimum amount of token1
     * @param deadline Timestamp after which the transaction will revert
     * @return liquidity Amount of liquidity added
     * @return amount0 Actual amount of token0 used
     * @return amount1 Actual amount of token1 used
     */
    function addLiquidity(
        uint256 tokenId,
        uint256 amount0Desired,
        uint256 amount1Desired,
        uint256 amount0Min,
        uint256 amount1Min,
        uint256 deadline
    ) external override returns (uint128 liquidity, uint256 amount0, uint256 amount1) {
        // Get position details to get token addresses
        (address token0, address token1, , , , ) = getPositionDetails(tokenId);

        // Transfer tokens from the caller to this contract
        if (amount0Desired > 0) {
            IERC20(token0).safeTransferFrom(msg.sender, address(this), amount0Desired);
            _approveToken(token0, positionManager, amount0Desired);
        }

        if (amount1Desired > 0) {
            IERC20(token1).safeTransferFrom(msg.sender, address(this), amount1Desired);
            _approveToken(token1, positionManager, amount1Desired);
        }

        // Create increase liquidity parameters for Uniswap
        INonfungiblePositionManager.IncreaseLiquidityParams memory params =
            INonfungiblePositionManager.IncreaseLiquidityParams({
                tokenId: tokenId,
                amount0Desired: amount0Desired,
                amount1Desired: amount1Desired,
                amount0Min: amount0Min,
                amount1Min: amount1Min,
                deadline: deadline
            });

        // Increase liquidity using Uniswap's position manager
        (liquidity, amount0, amount1) = INonfungiblePositionManager(positionManager).increaseLiquidity(params);

        // Refund any unused tokens to the caller
        if (amount0Desired > amount0 && amount0Desired - amount0 > 0) {
            IERC20(token0).safeTransfer(msg.sender, amount0Desired - amount0);
        }

        if (amount1Desired > amount1 && amount1Desired - amount1 > 0) {
            IERC20(token1).safeTransfer(msg.sender, amount1Desired - amount1);
        }

        return (liquidity, amount0, amount1);
    }

    /**
     * @notice Removes liquidity from a Uniswap V3 position
     * @param tokenId ID of the position
     * @param liquidity Amount of liquidity to remove
     * @param amount0Min Minimum amount of token0 to receive
     * @param amount1Min Minimum amount of token1 to receive
     * @param deadline Timestamp after which the transaction will revert
     * @return amount0 Amount of token0 received
     * @return amount1 Amount of token1 received
     */
    function removeLiquidity(
        uint256 tokenId,
        uint128 liquidity,
        uint256 amount0Min,
        uint256 amount1Min,
        uint256 deadline
    ) external override returns (uint256 amount0, uint256 amount1) {
        // Create decrease liquidity parameters for Uniswap
        INonfungiblePositionManager.DecreaseLiquidityParams memory decreaseParams =
            INonfungiblePositionManager.DecreaseLiquidityParams({
                tokenId: tokenId,
                liquidity: liquidity,
                amount0Min: amount0Min,
                amount1Min: amount1Min,
                deadline: deadline
            });

        // Decrease liquidity using Uniswap's position manager
        (amount0, amount1) = INonfungiblePositionManager(positionManager).decreaseLiquidity(decreaseParams);

        // After decreasing liquidity, we need to collect the tokens
        INonfungiblePositionManager.CollectParams memory collectParams =
            INonfungiblePositionManager.CollectParams({
                tokenId: tokenId,
                recipient: msg.sender,
                amount0Max: uint128(amount0),
                amount1Max: uint128(amount1)
            });

        // Collect the tokens and return them to the caller
        (amount0, amount1) = INonfungiblePositionManager(positionManager).collect(collectParams);

        return (amount0, amount1);
    }

    /**
     * @notice Collects fees from a Uniswap V3 position
     * @param tokenId ID of the position
     * @param recipient Address to receive the collected fees
     * @param amount0Max Maximum amount of token0 fees to collect
     * @param amount1Max Maximum amount of token1 fees to collect
     * @return amount0 Amount of token0 fees collected
     * @return amount1 Amount of token1 fees collected
     */
    function collectFees(
        uint256 tokenId,
        address recipient,
        uint128 amount0Max,
        uint128 amount1Max
    ) external override returns (uint256 amount0, uint256 amount1) {
        // Create collect parameters for Uniswap
        INonfungiblePositionManager.CollectParams memory params =
            INonfungiblePositionManager.CollectParams({
                tokenId: tokenId,
                recipient: recipient,
                amount0Max: amount0Max,
                amount1Max: amount1Max
            });

        // Collect fees using Uniswap's position manager
        (amount0, amount1) = INonfungiblePositionManager(positionManager).collect(params);

        return (amount0, amount1);
    }

    /**
     * @notice Closes a Uniswap V3 position (removes all liquidity, collects fees, optionally burns NFT)
     * @param tokenId ID of the position
     * @param collectFees Whether to collect accumulated fees
     * @param burnToken Whether to burn the position NFT
     * @return amount0 Total amount of token0 received
     * @return amount1 Total amount of token1 received
     */
    function closePosition(
        uint256 tokenId,
        bool collectFees,
        bool burnToken
    ) external override returns (uint256 amount0, uint256 amount1) {
        // Get position details
        (address token0, address token1, , , , uint128 positionLiquidity) = getPositionDetails(tokenId);

        uint256 collectedAmount0 = 0;
        uint256 collectedAmount1 = 0;

        // Step 1: Decrease all liquidity if there's any
        if (positionLiquidity > 0) {
            // Create decrease liquidity parameters for Uniswap
            INonfungiblePositionManager.DecreaseLiquidityParams memory decreaseParams =
                INonfungiblePositionManager.DecreaseLiquidityParams({
                    tokenId: tokenId,
                    liquidity: positionLiquidity,
                    amount0Min: 0, // No minimum for closing - consider adding slippage protection
                    amount1Min: 0, // No minimum for closing - consider adding slippage protection
                    deadline: block.timestamp + 1800 // 30 minutes deadline
                });

            // Decrease all liquidity
            (amount0, amount1) = INonfungiblePositionManager(positionManager).decreaseLiquidity(decreaseParams);
        }

        // Step 2: Collect all tokens (both from liquidity and fees if requested)
        if (collectFees || amount0 > 0 || amount1 > 0) {
            // Create collect parameters for Uniswap
            INonfungiblePositionManager.CollectParams memory collectParams =
                INonfungiblePositionManager.CollectParams({
                    tokenId: tokenId,
                    recipient: msg.sender,
                    amount0Max: MAX_UINT128, // Collect all token0
                    amount1Max: MAX_UINT128  // Collect all token1
                });

            // Collect all tokens
            (collectedAmount0, collectedAmount1) = INonfungiblePositionManager(positionManager).collect(collectParams);
        }

        // Step 3: Burn the NFT if requested
        if (burnToken) {
            INonfungiblePositionManager(positionManager).burn(tokenId);
        }

        // Update amounts to include collected amounts
        amount0 = collectedAmount0;
        amount1 = collectedAmount1;

        return (amount0, amount1);
    }

    /**
     * @notice Gets detailed information about a Uniswap V3 position
     * @param tokenId ID of the position
     * @return token0 Address of token0
     * @return token1 Address of token1
     * @return fee Fee tier of the position
     * @return tickLower Lower tick boundary
     * @return tickUpper Upper tick boundary
     * @return liquidity Amount of liquidity in the position
     */
    function getPositionDetails(uint256 tokenId)
        public
        view
        override
        returns (
            address token0,
            address token1,
            uint24 fee,
            int24 tickLower,
            int24 tickUpper,
            uint128 liquidity
        )
    {
        // Get position details from Uniswap's position manager
        (
            ,
            ,
            token0,
            token1,
            fee,
            tickLower,
            tickUpper,
            liquidity,
            ,
            ,
            ,
        ) = INonfungiblePositionManager(positionManager).positions(tokenId);

        return (token0, token1, fee, tickLower, tickUpper, liquidity);
    }

    /**
     * @notice Calculates the uncollected fees for a position
     * @param tokenId ID of the position
     * @return amount0 Uncollected amount of token0 fees
     * @return amount1 Uncollected amount of token1 fees
     */
    function calculateUncollectedFees(uint256 tokenId)
        public
        view
        override
        returns (uint256 amount0, uint256 amount1)
    {
        // Get position details
        (
            address token0,
            address token1,
            uint24 fee,
            int24 tickLower,
            int24 tickUpper,
            uint128 liquidity
        ) = getPositionDetails(tokenId);

        // If position has no liquidity, there are no fees
        if (liquidity == 0) {
            return (0, 0);
        }

        // Get the pool address
        address poolAddress = IUniswapV3Factory(factory).getPool(token0, token1, fee);
        if (poolAddress == address(0)) {
            return (0, 0);
        }

        // Get the pool instance
        IUniswapV3Pool pool = IUniswapV3Pool(poolAddress);

        // Get full position data
        (
            ,
            ,
            ,
            ,
            ,
            ,
            ,
            ,
            uint256 feeGrowthInside0LastX128,
            uint256 feeGrowthInside1LastX128,
            uint128 tokensOwed0,
            uint128 tokensOwed1
        ) = INonfungiblePositionManager(positionManager).positions(tokenId);

        // Get current fee growth global
        uint256 feeGrowthGlobal0X128 = pool.feeGrowthGlobal0X128();
        uint256 feeGrowthGlobal1X128 = pool.feeGrowthGlobal1X128();

        // Get current tick from the pool
        (,int24 tickCurrent,,,,,) = pool.slot0();

        // Get fee growth outside for the ticks
        (,,,uint256 feeGrowthOutside0X128Lower,,,,) = pool.ticks(tickLower);
        (,,,uint256 feeGrowthOutside1X128Lower,,,,) = pool.ticks(tickLower);
        (,,,uint256 feeGrowthOutside0X128Upper,,,,) = pool.ticks(tickUpper);
        (,,,uint256 feeGrowthOutside1X128Upper,,,,) = pool.ticks(tickUpper);

        // Calculate fee growth inside
        uint256 feeGrowthInside0X128;
        uint256 feeGrowthInside1X128;

        // Calculate fee growth inside based on current tick position
        unchecked {
            if (tickCurrent < tickLower) {
                // Current tick is below the position range
                feeGrowthInside0X128 = feeGrowthOutside0X128Lower - feeGrowthOutside0X128Upper;
                feeGrowthInside1X128 = feeGrowthOutside1X128Lower - feeGrowthOutside1X128Upper;
            } else if (tickCurrent >= tickUpper) {
                // Current tick is at or above the position range
                feeGrowthInside0X128 = feeGrowthOutside0X128Upper - feeGrowthOutside0X128Lower;
                feeGrowthInside1X128 = feeGrowthOutside1X128Upper - feeGrowthOutside1X128Lower;
            } else {
                // Current tick is within the position range
                feeGrowthInside0X128 = feeGrowthGlobal0X128 - feeGrowthOutside0X128Lower - feeGrowthOutside0X128Upper;
                feeGrowthInside1X128 = feeGrowthGlobal1X128 - feeGrowthOutside1X128Lower - feeGrowthOutside1X128Upper;
            }
        }

        // Handle underflow/overflow when calculating fee growth delta
        uint256 feeGrowthDelta0;
        uint256 feeGrowthDelta1;

        unchecked {
            if (feeGrowthInside0X128 >= feeGrowthInside0LastX128) {
                feeGrowthDelta0 = feeGrowthInside0X128 - feeGrowthInside0LastX128;
            } else {
                feeGrowthDelta0 = type(uint256).max - feeGrowthInside0LastX128 + feeGrowthInside0X128 + 1;
            }

            if (feeGrowthInside1X128 >= feeGrowthInside1LastX128) {
                feeGrowthDelta1 = feeGrowthInside1X128 - feeGrowthInside1LastX128;
            } else {
                feeGrowthDelta1 = type(uint256).max - feeGrowthInside1LastX128 + feeGrowthInside1X128 + 1;
            }
        }

        // Calculate uncollected fees using the formula: tokensOwed + (liquidity * feeGrowthDelta) / 2^128
        unchecked {
            amount0 = uint256(tokensOwed0) + uint256((uint256(liquidity) * feeGrowthDelta0) >> 128);
            amount1 = uint256(tokensOwed1) + uint256((uint256(liquidity) * feeGrowthDelta1) >> 128);
        }

        return (amount0, amount1);
    }

    /**
     * @notice Checks whether a position is currently in range
     * @param tokenId ID of the position
     * @return inRange Whether the position is currently in range
     */
    function isPositionInRange(uint256 tokenId) external view override returns (bool) {
        // Get position details
        (
            address token0,
            address token1,
            uint24 fee,
            int24 tickLower,
            int24 tickUpper,
            uint128 liquidity
        ) = getPositionDetails(tokenId);

        // If position has no liquidity, it's not relevant if it's in range
        if (liquidity == 0) {
            return false;
        }

        // Get the pool address
        address poolAddress = IUniswapV3Factory(factory).getPool(token0, token1, fee);
        if (poolAddress == address(0)) {
            return false;
        }

        // Get the pool instance
        IUniswapV3Pool pool = IUniswapV3Pool(poolAddress);

        // Get current tick from the pool
        (,int24 tickCurrent,,,,,) = pool.slot0();

        // Check if current tick is within the position's range
        return tickCurrent >= tickLower && tickCurrent < tickUpper;
    }

    /**
     * @notice Returns the version of the adapter
     * @return version Version string
     */
    function version() external pure override returns (string memory) {
        return "UniswapV3Adapter v1.0.0";
    }

    /**
     * @notice Helper function to sort tokens and their corresponding amounts
     * @param tokenA First token address
     * @param tokenB Second token address
     * @param amountADesired Desired amount of first token
     * @param amountBDesired Desired amount of second token
     * @param amountAMin Minimum amount of first token
     * @param amountBMin Minimum amount of second token
     * @return token0 Address of the first token (sorted)
     * @return token1 Address of the second token (sorted)
     * @return amount0Desired Desired amount of first token (sorted)
     * @return amount1Desired Desired amount of second token (sorted)
     * @return amount0Min Minimum amount of first token (sorted)
     * @return amount1Min Minimum amount of second token (sorted)
     */
    function _sortTokensAndAmounts(
        address tokenA,
        address tokenB,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin
    ) internal pure returns (
        address token0,
        address token1,
        uint256 amount0Desired,
        uint256 amount1Desired,
        uint256 amount0Min,
        uint256 amount1Min
    ) {
        // Sort tokens by address
        (token0, token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);

        // If tokens are already in order, return as is
        if (tokenA == token0) {
            amount0Desired = amountADesired;
            amount1Desired = amountBDesired;
            amount0Min = amountAMin;
            amount1Min = amountBMin;
        } else {
            // Otherwise, swap the amounts
            amount0Desired = amountBDesired;
            amount1Desired = amountADesired;
            amount0Min = amountBMin;
            amount1Min = amountAMin;
        }

        return (token0, token1, amount0Desired, amount1Desired, amount0Min, amount1Min);
    }

    /**
     * @notice Helper function to approve tokens for spending
     * @param token Token address
     * @param spender Address that will spend the tokens
     * @param amount Amount to approve
     */
    function _approveToken(address token, address spender, uint256 amount) internal {
        IERC20 tokenContract = IERC20(token);

        // Check current allowance
        uint256 allowance = tokenContract.allowance(address(this), spender);

        // If allowance is insufficient, approve
        if (allowance < amount) {
            // First reset to 0 (for tokens that require this pattern)
            if (allowance > 0) {
                tokenContract.safeApprove(spender, 0);
            }

            // Then approve the desired amount
            tokenContract.safeApprove(spender, type(uint256).max); // Approve max for gas efficiency
        }
    }
}
