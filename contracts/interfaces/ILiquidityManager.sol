// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * @title ILiquidityManager
 * @notice Interface for the main liquidity management contract that orchestrates
 * operations across different DeFi platforms
 * @dev This contract serves as the main entry point for liquidity operations and
 * delegates calls to the appropriate protocol adapters
 */
interface ILiquidityManager {
    /**
     * @notice Struct for organizing position creation parameters
     * @param platform Address identifying the platform (typically the factory address)
     * @param token0 Address of the first token in the pair
     * @param token1 Address of the second token in the pair
     * @param fee Fee tier for the position (e.g., 500 for 0.05%, 3000 for 0.3%)
     * @param tickLower Lower tick boundary of the position
     * @param tickUpper Upper tick boundary of the position
     * @param amount0Desired Desired amount of token0 to deposit
     * @param amount1Desired Desired amount of token1 to deposit
     * @param amount0Min Minimum amount of token0 to deposit (slippage protection)
     * @param amount1Min Minimum amount of token1 to deposit (slippage protection)
     * @param recipient Address that will receive the position NFT
     * @param deadline Timestamp after which the transaction will revert
     */
    struct CreatePositionParams {
        address platform;
        address token0;
        address token1;
        uint24 fee;
        int24 tickLower;
        int24 tickUpper;
        uint256 amount0Desired;
        uint256 amount1Desired;
        uint256 amount0Min;
        uint256 amount1Min;
        address recipient;
        uint256 deadline;
    }

    /**
     * @notice Struct for organizing add liquidity parameters
     * @param tokenId ID of the position to add liquidity to
     * @param amount0Desired Desired amount of token0 to add
     * @param amount1Desired Desired amount of token1 to add
     * @param amount0Min Minimum amount of token0 to add (slippage protection)
     * @param amount1Min Minimum amount of token1 to add (slippage protection)
     * @param deadline Timestamp after which the transaction will revert
     */
    struct AddLiquidityParams {
        uint256 tokenId;
        uint256 amount0Desired;
        uint256 amount1Desired;
        uint256 amount0Min;
        uint256 amount1Min;
        uint256 deadline;
    }

    /**
     * @notice Struct for organizing remove liquidity parameters
     * @param tokenId ID of the position to remove liquidity from
     * @param liquidity Amount of liquidity to remove (in the position's liquidity units)
     * @param amount0Min Minimum amount of token0 to receive (slippage protection)
     * @param amount1Min Minimum amount of token1 to receive (slippage protection)
     * @param deadline Timestamp after which the transaction will revert
     */
    struct RemoveLiquidityParams {
        uint256 tokenId;
        uint128 liquidity;
        uint256 amount0Min;
        uint256 amount1Min;
        uint256 deadline;
    }

    /**
     * @notice Event emitted when an adapter is registered
     * @param platform Platform identifier (typically factory address)
     * @param adapter Address of the adapter contract
     */
    event AdapterRegistered(address indexed platform, address indexed adapter);

    /**
     * @notice Event emitted when an adapter is updated
     * @param platform Platform identifier
     * @param adapter New address of the adapter contract
     */
    event AdapterUpdated(address indexed platform, address indexed adapter);

    /**
     * @notice Event emitted when an adapter is removed
     * @param platform Platform identifier
     */
    event AdapterRemoved(address indexed platform);

    /**
     * @notice Event emitted when a position is created
     * @param tokenId ID of the created position
     * @param platform Platform identifier
     * @param owner Address of the position owner
     */
    event PositionCreated(uint256 indexed tokenId, address indexed platform, address indexed owner);

    /**
     * @notice Event emitted when liquidity is added to a position
     * @param tokenId ID of the position
     * @param liquidity Amount of liquidity added
     * @param amount0 Amount of token0 added
     * @param amount1 Amount of token1 added
     */
    event LiquidityAdded(uint256 indexed tokenId, uint128 liquidity, uint256 amount0, uint256 amount1);

    /**
     * @notice Event emitted when liquidity is removed from a position
     * @param tokenId ID of the position
     * @param liquidity Amount of liquidity removed
     * @param amount0 Amount of token0 removed
     * @param amount1 Amount of token1 removed
     */
    event LiquidityRemoved(uint256 indexed tokenId, uint128 liquidity, uint256 amount0, uint256 amount1);

    /**
     * @notice Event emitted when fees are collected from a position
     * @param tokenId ID of the position
     * @param amount0 Amount of token0 collected
     * @param amount1 Amount of token1 collected
     */
    event FeesCollected(uint256 indexed tokenId, uint256 amount0, uint256 amount1);

    /**
     * @notice Event emitted when a position is closed
     * @param tokenId ID of the position
     * @param collected Whether fees were collected
     * @param burned Whether the position NFT was burned
     */
    event PositionClosed(uint256 indexed tokenId, bool collected, bool burned);

    /**
     * @notice Creates a new liquidity position on the specified platform
     * @param params Parameters for creating the position
     * @return tokenId ID of the created position
     * @return liquidity Amount of liquidity in the position
     * @return amount0 Actual amount of token0 used
     * @return amount1 Actual amount of token1 used
     */
    function createPosition(CreatePositionParams calldata params)
        external
        returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1);

    /**
     * @notice Adds liquidity to an existing position
     * @param params Parameters for adding liquidity
     * @return liquidity Amount of liquidity added
     * @return amount0 Actual amount of token0 used
     * @return amount1 Actual amount of token1 used
     */
    function addLiquidity(AddLiquidityParams calldata params)
        external
        returns (uint128 liquidity, uint256 amount0, uint256 amount1);

    /**
     * @notice Removes liquidity from an existing position
     * @param params Parameters for removing liquidity
     * @return amount0 Amount of token0 received
     * @return amount1 Amount of token1 received
     */
    function removeLiquidity(RemoveLiquidityParams calldata params)
        external
        returns (uint256 amount0, uint256 amount1);

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
     * @return amount0 Total amount of token0 received (liquidity + fees if collected)
     * @return amount1 Total amount of token1 received (liquidity + fees if collected)
     */
    function closePosition(
        uint256 tokenId,
        bool collectFees,
        bool burnToken
    ) external returns (uint256 amount0, uint256 amount1);

    /**
     * @notice Registers a new adapter for a platform
     * @param platform Platform identifier (typically the factory address)
     * @param adapter Address of the adapter contract
     */
    function registerAdapter(address platform, address adapter) external;

    /**
     * @notice Updates an existing adapter for a platform
     * @param platform Platform identifier
     * @param adapter New address of the adapter contract
     */
    function updateAdapter(address platform, address adapter) external;

    /**
     * @notice Removes an adapter for a platform
     * @param platform Platform identifier
     */
    function removeAdapter(address platform) external;

    /**
     * @notice Gets detailed information about a position
     * @param tokenId ID of the position
     * @return platform Platform identifier
     * @return owner Address of the position owner
     * @return token0 Address of token0
     * @return token1 Address of token1
     * @return fee Fee tier of the position
     * @return tickLower Lower tick boundary
     * @return tickUpper Upper tick boundary
     * @return liquidity Amount of liquidity in the position
     */
    function getPosition(uint256 tokenId) external view returns (
        address platform,
        address owner,
        address token0,
        address token1,
        uint24 fee,
        int24 tickLower,
        int24 tickUpper,
        uint128 liquidity
    );

    /**
     * @notice Checks if an adapter is registered for a platform
     * @param platform Platform identifier
     * @return isRegistered Whether the adapter is registered
     */
    function isAdapterRegistered(address platform) external view returns (bool);

    /**
     * @notice Gets the adapter address for a platform
     * @param platform Platform identifier
     * @return adapter Address of the adapter contract
     */
    function getAdapter(address platform) external view returns (address);
}
