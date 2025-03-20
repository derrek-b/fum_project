// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * @title IStrategy
 * @notice Interface for strategy contracts that implement advanced liquidity management strategies
 * @dev Strategy contracts implement this interface and are registered with the StrategyRegistry
 */
interface IStrategy {
    /**
     * @notice Struct containing information about a strategy
     * @param name Name of the strategy
     * @param description Description of what the strategy does
     * @param parameterFormat ABI-encoded format of the parameters the strategy expects
     */
    struct StrategyInfo {
        string name;
        string description;
        bytes parameterFormat;
    }

    /**
     * @notice Event emitted when a strategy is executed
     * @param tokenId ID of the position the strategy was executed on
     * @param executor Address that executed the strategy
     * @param result Success or failure
     */
    event StrategyExecuted(uint256 indexed tokenId, address indexed executor, bool result);

    /**
     * @notice Executes the strategy on a position
     * @param tokenId ID of the position to execute the strategy on
     * @param params ABI-encoded parameters for the strategy
     * @return success Whether the strategy execution was successful
     */
    function execute(uint256 tokenId, bytes calldata params) external returns (bool success);

    /**
     * @notice Gets information about the strategy
     * @return info StrategyInfo struct containing name, description, and parameter format
     */
    function getInfo() external view returns (StrategyInfo memory info);

    /**
     * @notice Checks if a position is compatible with this strategy
     * @param tokenId ID of the position to check
     * @return compatible Whether the position is compatible with this strategy
     */
    function isCompatible(uint256 tokenId) external view returns (bool compatible);

    /**
     * @notice Simulates the execution of the strategy without making any state changes
     * @param tokenId ID of the position to simulate the strategy on
     * @param params ABI-encoded parameters for the strategy
     * @return success Whether the strategy simulation was successful
     * @return result ABI-encoded result of the simulation
     */
    function simulate(uint256 tokenId, bytes calldata params) external view returns (
        bool success,
        bytes memory result
    );

    /**
     * @notice Gets the permissions required by this strategy
     * @return permissions Bit mask of the permissions required by this strategy
     */
    function requiredPermissions() external pure returns (uint256 permissions);

    /**
     * @notice Gets the version information of the strategy
     * @return version Version string
     */
    function version() external pure returns (string memory);
}
