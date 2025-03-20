// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "../interfaces/ILiquidityManager.sol";
import "../interfaces/IProtocolAdapter.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title LiquidityManager
 * @notice Main contract for managing liquidity positions across multiple DeFi platforms
 * @dev Implements ILiquidityManager and delegates platform-specific operations to adapter contracts
 */
contract LiquidityManager is ILiquidityManager, Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // Mapping of platform address to adapter address
    mapping(address => address) private _adapters;

    // Mapping of tokenId to position info
    mapping(uint256 => PositionInfo) private _positions;

    // Struct to store position information
    struct PositionInfo {
        address platform;
        address owner;
    }

    /**
     * @notice Constructor
     * @param initialOwner Address that will be the owner of the contract
     */
    constructor(address initialOwner) Ownable(initialOwner) {
    }

    /**
     * @notice Modifier to restrict a function to the position owner
     * @param tokenId ID of the position
     */
    modifier onlyPositionOwner(uint256 tokenId) {
        require(_positions[tokenId].owner == msg.sender, "LiquidityManager: Not position owner");
        _;
    }

    /**
     * @notice Modifier to check if an adapter is registered for a platform
     * @param platform Platform address to check
     */
    modifier adapterExists(address platform) {
        require(_adapters[platform] != address(0), "LiquidityManager: Adapter not registered");
        _;
    }

    /**
     * @notice Pauses the contract, preventing certain operations
     * @dev Only callable by the owner
     */
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @notice Unpauses the contract, allowing operations again
     * @dev Only callable by the owner
     */
    function unpause() external onlyOwner {
        _unpause();
    }

    /**
     * @notice Registers a new adapter for a platform
     * @param platform Platform identifier (typically the factory address)
     * @param adapter Address of the adapter contract
     */
    function registerAdapter(address platform, address adapter)
        external
        override
        onlyOwner
    {
        require(platform != address(0), "LiquidityManager: Zero platform address");
        require(adapter != address(0), "LiquidityManager: Zero adapter address");
        require(_adapters[platform] == address(0), "LiquidityManager: Adapter already registered");

        // Verify that the adapter implementation supports expected interface
        // This helps prevent misconfigurations
        try IProtocolAdapter(adapter).factory() returns (address factory) {
            // Optionally verify that the returned factory matches the platform
        } catch {
            revert("LiquidityManager: Invalid adapter implementation");
        }

        _adapters[platform] = adapter;

        emit AdapterRegistered(platform, adapter);
    }

    /**
     * @notice Updates an existing adapter for a platform
     * @param platform Platform identifier
     * @param adapter New address of the adapter contract
     */
    function updateAdapter(address platform, address adapter)
        external
        override
        onlyOwner
        adapterExists(platform)
    {
        require(adapter != address(0), "LiquidityManager: Zero adapter address");

        // Verify that the new adapter implementation supports expected interface
        try IProtocolAdapter(adapter).factory() returns (address) {
            // Basic interface verification passed
        } catch {
            revert("LiquidityManager: Invalid adapter implementation");
        }

        _adapters[platform] = adapter;

        emit AdapterUpdated(platform, adapter);
    }

    /**
     * @notice Removes an adapter for a platform
     * @param platform Platform identifier
     */
    function removeAdapter(address platform)
        external
        override
        onlyOwner
        adapterExists(platform)
    {
        delete _adapters[platform];

        emit AdapterRemoved(platform);
    }

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
        override
        whenNotPaused
        nonReentrant
        adapterExists(params.platform)
        returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)
    {
        // Forward call to the platform adapter
        address adapter = _adapters[params.platform];

        // Handle token approvals if needed
        _approveTokensIfNeeded(params.token0, params.amount0Desired, adapter);
        _approveTokensIfNeeded(params.token1, params.amount1Desired, adapter);

        // Create the position through the adapter
        (tokenId, liquidity, amount0, amount1) = IProtocolAdapter(adapter).createPosition(
            params.token0,
            params.token1,
            params.fee,
            params.tickLower,
            params.tickUpper,
            params.amount0Desired,
            params.amount1Desired,
            params.amount0Min,
            params.amount1Min,
            params.recipient,
            params.deadline
        );

        // Store position information
        _positions[tokenId] = PositionInfo({
            platform: params.platform,
            owner: msg.sender
        });

        emit PositionCreated(tokenId, params.platform, msg.sender);

        return (tokenId, liquidity, amount0, amount1);
    }

    /**
     * @notice Adds liquidity to an existing position
     * @param params Parameters for adding liquidity
     * @return liquidity Amount of liquidity added
     * @return amount0 Actual amount of token0 used
     * @return amount1 Actual amount of token1 used
     */
    function addLiquidity(AddLiquidityParams calldata params)
        external
        override
        whenNotPaused
        nonReentrant
        onlyPositionOwner(params.tokenId)
        returns (uint128 liquidity, uint256 amount0, uint256 amount1)
    {
        PositionInfo storage positionInfo = _positions[params.tokenId];
        require(positionInfo.platform != address(0), "LiquidityManager: Position does not exist");

        address adapter = _adapters[positionInfo.platform];
        require(adapter != address(0), "LiquidityManager: Adapter not found");

        // Get position details to know which tokens are involved
        (address token0, address token1,,,,) = IProtocolAdapter(adapter).getPositionDetails(params.tokenId);

        // Handle token approvals
        _approveTokensIfNeeded(token0, params.amount0Desired, adapter);
        _approveTokensIfNeeded(token1, params.amount1Desired, adapter);

        // Add liquidity through the adapter
        (liquidity, amount0, amount1) = IProtocolAdapter(adapter).addLiquidity(
            params.tokenId,
            params.amount0Desired,
            params.amount1Desired,
            params.amount0Min,
            params.amount1Min,
            params.deadline
        );

        emit LiquidityAdded(params.tokenId, liquidity, amount0, amount1);

        return (liquidity, amount0, amount1);
    }

    /**
     * @notice Removes liquidity from an existing position
     * @param params Parameters for removing liquidity
     * @return amount0 Amount of token0 received
     * @return amount1 Amount of token1 received
     */
    function removeLiquidity(RemoveLiquidityParams calldata params)
        external
        override
        whenNotPaused
        nonReentrant
        onlyPositionOwner(params.tokenId)
        returns (uint256 amount0, uint256 amount1)
    {
        PositionInfo storage positionInfo = _positions[params.tokenId];
        require(positionInfo.platform != address(0), "LiquidityManager: Position does not exist");

        address adapter = _adapters[positionInfo.platform];
        require(adapter != address(0), "LiquidityManager: Adapter not found");

        // Remove liquidity through the adapter
        (amount0, amount1) = IProtocolAdapter(adapter).removeLiquidity(
            params.tokenId,
            params.liquidity,
            params.amount0Min,
            params.amount1Min,
            params.deadline
        );

        emit LiquidityRemoved(params.tokenId, params.liquidity, amount0, amount1);

        return (amount0, amount1);
    }

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
    )
        external
        override
        whenNotPaused
        nonReentrant
        onlyPositionOwner(tokenId)
        returns (uint256 amount0, uint256 amount1)
    {
        PositionInfo storage positionInfo = _positions[tokenId];
        require(positionInfo.platform != address(0), "LiquidityManager: Position does not exist");

        address adapter = _adapters[positionInfo.platform];
        require(adapter != address(0), "LiquidityManager: Adapter not found");

        // Collect fees through the adapter
        (amount0, amount1) = IProtocolAdapter(adapter).collectFees(
            tokenId,
            recipient,
            amount0Max,
            amount1Max
        );

        emit FeesCollected(tokenId, amount0, amount1);

        return (amount0, amount1);
    }

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
    )
        external
        override
        whenNotPaused
        nonReentrant
        onlyPositionOwner(tokenId)
        returns (uint256 amount0, uint256 amount1)
    {
        PositionInfo storage positionInfo = _positions[tokenId];
        require(positionInfo.platform != address(0), "LiquidityManager: Position does not exist");

        address adapter = _adapters[positionInfo.platform];
        require(adapter != address(0), "LiquidityManager: Adapter not found");

        // Close position through the adapter
        (amount0, amount1) = IProtocolAdapter(adapter).closePosition(
            tokenId,
            collectFees,
            burnToken
        );

        // If the position was completely closed (burn=true), remove it from our tracking
        if (burnToken) {
            delete _positions[tokenId];
        }

        emit PositionClosed(tokenId, collectFees, burnToken);

        return (amount0, amount1);
    }

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
    function getPosition(uint256 tokenId)
        external
        view
        override
        returns (
            address platform,
            address owner,
            address token0,
            address token1,
            uint24 fee,
            int24 tickLower,
            int24 tickUpper,
            uint128 liquidity
        )
    {
        PositionInfo storage positionInfo = _positions[tokenId];
        require(positionInfo.platform != address(0), "LiquidityManager: Position does not exist");

        address adapter = _adapters[positionInfo.platform];
        require(adapter != address(0), "LiquidityManager: Adapter not found");

        // Get position details from the adapter
        (token0, token1, fee, tickLower, tickUpper, liquidity) = IProtocolAdapter(adapter).getPositionDetails(tokenId);

        return (
            positionInfo.platform,
            positionInfo.owner,
            token0,
            token1,
            fee,
            tickLower,
            tickUpper,
            liquidity
        );
    }

    /**
     * @notice Checks if an adapter is registered for a platform
     * @param platform Platform identifier
     * @return isRegistered Whether the adapter is registered
     */
    function isAdapterRegistered(address platform)
        external
        view
        override
        returns (bool)
    {
        return _adapters[platform] != address(0);
    }

    /**
     * @notice Gets the adapter address for a platform
     * @param platform Platform identifier
     * @return adapter Address of the adapter contract
     */
    function getAdapter(address platform)
        external
        view
        override
        returns (address)
    {
        return _adapters[platform];
    }

    /**
     * @notice Helper function to approve tokens if needed
     * @param token Address of the token
     * @param amount Amount to approve
     * @param spender Address that will spend the tokens
     */
    function _approveTokensIfNeeded(address token, uint256 amount, address spender) internal {
        if (amount > 0) {
            IERC20 tokenContract = IERC20(token);
            uint256 allowance = tokenContract.allowance(address(this), spender);

            if (allowance < amount) {
                // If allowance is insufficient, approve the full amount to avoid repeated approvals
                tokenContract.safeApprove(spender, 0); // First reset to 0
                tokenContract.safeApprove(spender, type(uint256).max); // Then approve max
            }
        }
    }
}
