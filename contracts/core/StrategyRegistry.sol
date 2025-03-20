// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "../interfaces/IStrategy.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";

/**
 * @title StrategyRegistry
 * @notice Registry for managing and executing strategy contracts
 * @dev This contract allows the registration and execution of strategy contracts
 * that implement advanced liquidity management strategies
 */
contract StrategyRegistry is Ownable, ReentrancyGuard, Pausable {
    // Mapping of strategy ID to strategy address
    mapping(bytes32 => address) private _strategies;

    // Mapping of strategy address to approval status
    mapping(address => bool) private _approvedStrategies;

    // Events
    event StrategyRegistered(bytes32 indexed id, address indexed strategy);
    event StrategyApprovalChanged(address indexed strategy, bool approved);
    event StrategyExecuted(bytes32 indexed strategyId, uint256 indexed tokenId, address indexed executor);

    /**
     * @notice Constructor
     * @param initialOwner Address that will be the owner of the contract
     */
    constructor(address initialOwner) Ownable(initialOwner) {
    }

    /**
     * @notice Pauses the contract, preventing strategy execution
     * @dev Only callable by the owner
     */
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @notice Unpauses the contract, allowing strategy execution again
     * @dev Only callable by the owner
     */
    function unpause() external onlyOwner {
        _unpause();
    }

    /**
     * @notice Registers a new strategy
     * @param id Unique identifier for the strategy
     * @param strategy Address of the strategy contract
     * @param approved Whether the strategy should be approved for execution
     */
    function registerStrategy(bytes32 id, address strategy, bool approved) external onlyOwner {
        require(strategy != address(0), "StrategyRegistry: Zero strategy address");
        require(_strategies[id] == address(0), "StrategyRegistry: Strategy ID already registered");

        // Verify that the contract implements IStrategy
        try IStrategy(strategy).getInfo() returns (IStrategy.StrategyInfo memory) {
            // Interface check passed
        } catch {
            revert("StrategyRegistry: Contract does not implement IStrategy");
        }

        _strategies[id] = strategy;
        _approvedStrategies[strategy] = approved;

        emit StrategyRegistered(id, strategy);
        if (approved) {
            emit StrategyApprovalChanged(strategy, true);
        }
    }

    /**
     * @notice Updates an existing strategy
     * @param id Unique identifier for the strategy
     * @param strategy New address of the strategy contract
     */
    function updateStrategy(bytes32 id, address strategy) external onlyOwner {
        require(strategy != address(0), "StrategyRegistry: Zero strategy address");
        require(_strategies[id] != address(0), "StrategyRegistry: Strategy ID not registered");

        // Verify that the contract implements IStrategy
        try IStrategy(strategy).getInfo() returns (IStrategy.StrategyInfo memory) {
            // Interface check passed
        } catch {
            revert("StrategyRegistry: Contract does not implement IStrategy");
        }

        // Update the strategy address
        _strategies[id] = strategy;
        // New strategies start as unapproved
        _approvedStrategies[strategy] = false;

        emit StrategyRegistered(id, strategy);
        emit StrategyApprovalChanged(strategy, false);
    }

    /**
     * @notice Sets the approval status of a strategy
     * @param strategy Address of the strategy contract
     * @param approved Whether the strategy should be approved for execution
     */
    function setStrategyApproval(address strategy, bool approved) external onlyOwner {
        require(strategy != address(0), "StrategyRegistry: Zero strategy address");

        // Check if this is a known strategy by looping through the registry
        bool isKnownStrategy = false;
        for (bytes32 id = 0; id != bytes32(0); id++) {
            if (_strategies[id] == strategy) {
                isKnownStrategy = true;
                break;
            }
        }

        require(isKnownStrategy, "StrategyRegistry: Strategy not registered");

        _approvedStrategies[strategy] = approved;

        emit StrategyApprovalChanged(strategy, approved);
    }

    /**
     * @notice Executes a strategy on a position
     * @param id Unique identifier for the strategy
     * @param tokenId ID of the position to execute the strategy on
     * @param params ABI-encoded parameters for the strategy
     * @return success Whether the strategy execution was successful
     */
    function executeStrategy(bytes32 id, uint256 tokenId, bytes calldata params)
        external
        whenNotPaused
        nonReentrant
        returns (bool success)
    {
        address strategy = _strategies[id];
        require(strategy != address(0), "StrategyRegistry: Strategy not registered");
        require(_approvedStrategies[strategy], "StrategyRegistry: Strategy not approved");

        // Check if the strategy is compatible with the position
        require(
            IStrategy(strategy).isCompatible(tokenId),
            "StrategyRegistry: Strategy not compatible with position"
        );

        // Execute the strategy
        success = IStrategy(strategy).execute(tokenId, params);

        require(success, "StrategyRegistry: Strategy execution failed");

        emit StrategyExecuted(id, tokenId, msg.sender);

        return success;
    }

    /**
     * @notice Simulates the execution of a strategy without making state changes
     * @param id Unique identifier for the strategy
     * @param tokenId ID of the position to simulate the strategy on
     * @param params ABI-encoded parameters for the strategy
     * @return success Whether the strategy simulation was successful
     * @return result ABI-encoded result of the simulation
     */
    function simulateStrategy(bytes32 id, uint256 tokenId, bytes calldata params)
        external
        view
        returns (bool success, bytes memory result)
    {
        address strategy = _strategies[id];
        require(strategy != address(0), "StrategyRegistry: Strategy not registered");

        return IStrategy(strategy).simulate(tokenId, params);
    }

    /**
     * @notice Gets information about a strategy
     * @param id Unique identifier for the strategy
     * @return info StrategyInfo struct containing name, description, and parameter format
     * @return strategyAddress Address of the strategy contract
     * @return approved Whether the strategy is approved for execution
     */
    function getStrategyInfo(bytes32 id)
        external
        view
        returns (
            IStrategy.StrategyInfo memory info,
            address strategyAddress,
            bool approved
        )
    {
        strategyAddress = _strategies[id];
        require(strategyAddress != address(0), "StrategyRegistry: Strategy not registered");

        info = IStrategy(strategyAddress).getInfo();
        approved = _approvedStrategies[strategyAddress];

        return (info, strategyAddress, approved);
    }

    /**
     * @notice Checks if a strategy is registered
     * @param id Unique identifier for the strategy
     * @return isRegistered Whether the strategy is registered
     */
    function isStrategyRegistered(bytes32 id) external view returns (bool) {
        return _strategies[id] != address(0);
    }

    /**
     * @notice Checks if a strategy is approved
     * @param strategy Address of the strategy contract
     * @return isApproved Whether the strategy is approved
     */
    function isStrategyApproved(address strategy) external view returns (bool) {
        return _approvedStrategies[strategy];
    }

    /**
     * @notice Gets the address of a strategy
     * @param id Unique identifier for the strategy
     * @return strategy Address of the strategy contract
     */
    function getStrategy(bytes32 id) external view returns (address) {
        return _strategies[id];
    }
}
