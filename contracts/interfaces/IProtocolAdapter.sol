// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * @title IProtocolAdapter
 * @notice Interface for platform-specific adapter contracts
 * @dev Protocol adapters implement this interface to provide platform-specific functionality
 * while maintaining a consistent interface for the LiquidityManager
 */
interface IProtocolAdapter {
    /**
     * @notice Creates a new liquidity position on the platform
     * @param token0 Address of the first token in the pair
     * @param token1 Address of the second token in the pair
     * @param fee Fee tier for the position
     * @param tickLower Lower tick boundary of the position
     * @param tickUpper Upper tick boundary of the position
     * @param amount0Desired Desired amount of token0 to deposit
     * @param amount1Desired Desired amount of token1 to deposit
     * @param amount0Min Minimum amount of token0 to deposit (slippage protection)
     * @param amount1Min Minimum amount of token1 to deposit (slippage protection)
     * @param recipient Address that will receive the position NFT
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
    ) external returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1);

    /**
     * @notice Adds liquidity to an existing position
     * @param tokenId ID of the position to add liquidity to
     * @param amount0Desired Desired amount of token0 to add
     * @param amount1Desired Desired amount of token1 to add
     * @param amount0Min Minimum amount of token0 to add (slippage protection)
     * @param amount1Min Minimum amount of token1 to add (slippage protection)
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
    ) external returns (uint128 liquidity, uint256 amount0, uint256 amount1);

    /**
     * @notice Removes liquidity from an existing position
     * @param tokenId ID of the position to remove liquidity from
     * @param liquidity Amount of liquidity to remove
     * @param amount0Min Minimum amount of token0 to receive (slippage protection)
     * @param amount1Min Minimum amount of token1 to receive (slippage protection)
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
    ) external returns (uint256 amount0, uint256 amount1);

    /**
     * @notice Collects accumulated fees from a position
     * @param tokenId ID of the position
     * @param recipient Address that will receive the collected fees
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
    ) external returns (uint256 amount0, uint256 amount1);

    /**
     * @notice Closes a position (removes all liquidity, collects fees, and optionally burns the NFT)
     * @param tokenId ID of the position to close
     * @param collectFees Whether to collect accumulated fees
     * @param burnToken Whether to burn the position NFT
     * @return amount0 Total amount of token0 received
     * @return amount1 Total amount of token1 received
     */
    function closePosition(
        uint256 tokenId,
        bool collectFees,
        bool burnToken
    ) external returns (uint256 amount0, uint256 amount1);

    /**
     * @notice Gets detailed information about a position
     * @param tokenId ID of the position
     * @return token0 Address of token0
     * @return token1 Address of token1
     * @return fee Fee tier of the position
     * @return tickLower Lower tick boundary
     * @return tickUpper Upper tick boundary
     * @return liquidity Amount of liquidity in the position
     */
    function getPositionDetails(uint256 tokenId) external view returns (
        address token0,
        address token1,
        uint24 fee,
        int24 tickLower,
        int24 tickUpper,
        uint128 liquidity
    );

    /**
     * @notice Gets the address of the platform's factory contract
     * @return factoryAddress Address of the factory contract
     */
    function factory() external view returns (address);

    /**
     * @notice Gets the version information of the adapter
     * @return version Version string
     */
    function version() external pure returns (string memory);

    /**
     * @notice Calculates the uncollected fees for a position
     * @param tokenId ID of the position
     * @return amount0 Uncollected amount of token0 fees
     * @return amount1 Uncollected amount of token1 fees
     */
    function calculateUncollectedFees(uint256 tokenId) external view returns (
        uint256 amount0,
        uint256 amount1
    );

    /**
     * @notice Checks whether a position is currently in range
     * @param tokenId ID of the position
     * @return inRange Whether the position is currently in range
     */
    function isPositionInRange(uint256 tokenId) external view returns (bool);
}
