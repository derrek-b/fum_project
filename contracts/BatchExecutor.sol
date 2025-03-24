// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title BatchExecutor
 * @notice Simple contract for executing multiple transactions atomically in a single call
 * @dev Can be used directly by wallets or extended by more complex contracts like vaults
 */
contract BatchExecutor is ReentrancyGuard {
    // Events
    event TransactionExecuted(address indexed target, bytes data, bool success, bytes returnData);
    event BatchExecuted(address indexed sender, uint256 txCount, bool success);

    /**
     * @notice Executes a batch of transactions atomically
     * @param targets Array of contract addresses to call
     * @param data Array of calldata to send to each target
     * @param values Array of ETH values to send with each call
     * @return successes Array of execution success flags
     * @return results Array of return data from each call
     */
    function executeBatch(
        address[] calldata targets,
        bytes[] calldata data,
        uint256[] calldata values
    )
        external
        payable
        nonReentrant
        returns (bool[] memory successes, bytes[] memory results)
    {
        require(targets.length == data.length, "BatchExecutor: array length mismatch");
        require(targets.length == values.length, "BatchExecutor: values length mismatch");

        // Check if total ETH value is sufficient
        uint256 totalValue = 0;
        for (uint256 i = 0; i < values.length; i++) {
            totalValue += values[i];
        }
        require(msg.value >= totalValue, "BatchExecutor: insufficient ETH value");

        successes = new bool[](targets.length);
        results = new bytes[](targets.length);

        // Execute each transaction
        for (uint256 i = 0; i < targets.length; i++) {
            require(targets[i] != address(0), "BatchExecutor: zero target address");

            // Execute the call
            (bool success, bytes memory returnData) = targets[i].call{value: values[i]}(data[i]);

            // Store the result
            successes[i] = success;
            results[i] = returnData;

            // Emit event for this transaction
            emit TransactionExecuted(targets[i], data[i], success, returnData);

            // If any transaction fails, revert the entire batch
            require(success, "BatchExecutor: transaction failed");
        }

        // Refund any excess ETH
        uint256 remaining = msg.value - totalValue;
        if (remaining > 0) {
            (bool refundSuccess, ) = msg.sender.call{value: remaining}("");
            require(refundSuccess, "BatchExecutor: ETH refund failed");
        }

        emit BatchExecuted(msg.sender, targets.length, true);
        return (successes, results);
    }

    /**
     * @notice Version information for tracking deployments
     * @return String representing the contract version
     */
    function getVersion() external pure returns (string memory) {
        return "0.2.1";
    }

    /**
     * @notice Allows the contract to receive ETH
     */
    receive() external payable {}
}
