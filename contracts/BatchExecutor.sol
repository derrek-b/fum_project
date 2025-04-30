// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title BatchExecutor
 * @notice Simple contract for executing multiple transactions in a single call
 * @dev Supports both atomic (all-or-nothing) and sequential execution modes
 */
contract BatchExecutor is ReentrancyGuard {

    // Events
    event TransactionExecuted(address indexed target, bytes data, bool success, bytes returnData);
    event AtomicBatchExecuted(address indexed sender, uint256 txCount, bool success, bool[] successes, bytes[] results);
    event SequenceBatchExecuted(address indexed sender, uint256 txCount, uint256 completedCount, bool[] successes, bytes[] results);

    /**
     * @notice Executes a batch of transactions atomically (all-or-nothing)
     * @param targets Array of contract addresses to call
     * @param data Array of calldata to send to each target
     * @param values Array of ETH values to send with each call
     * @return success Boolean indicating if all transactions succeeded
     */
    function executeAtomicBatch(
        address[] calldata targets,
        bytes[] calldata data,
        uint256[] calldata values
    )
        external
        payable
        nonReentrant
        returns (bool)
    {
        require(targets.length == data.length, "BatchExecutor: array length mismatch");
        require(targets.length == values.length, "BatchExecutor: values length mismatch");

        // Check if total ETH value is sufficient
        uint256 totalValue = 0;
        for (uint256 x = 0; x < values.length; x++) {
            totalValue += values[x];
        }
        require(msg.value >= totalValue, "BatchExecutor: insufficient ETH value");

        // Initialize result arrays
        bool[] memory successes = new bool[](targets.length);
        bytes[] memory results = new bytes[](targets.length);

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

        emit AtomicBatchExecuted(msg.sender, targets.length, true, successes, results);
        return true;
    }

    /**
     * @notice Executes a batch of transactions sequentially (stops at first failure)
     * @param targets Array of contract addresses to call
     * @param data Array of calldata to send to each target
     * @param values Array of ETH values to send with each call
     * @return success Boolean indicating if execution completed
     */
    function executeSequenceBatch(
        address[] calldata targets,
        bytes[] calldata data,
        uint256[] calldata values
    )
        external
        payable
        nonReentrant
        returns (bool)
    {
        require(targets.length == data.length, "BatchExecutor: array length mismatch");
        require(targets.length == values.length, "BatchExecutor: values length mismatch");

        // Check if total ETH value is sufficient
        uint256 totalValue = 0;
        for (uint256 x = 0; x < values.length; x++) {
            totalValue += values[x];
        }
        require(msg.value >= totalValue, "BatchExecutor: insufficient ETH value");

        // Initialize result arrays
        bool[] memory successes = new bool[](targets.length);
        bytes[] memory results = new bytes[](targets.length);

        // Track ETH actually used
        uint256 ethUsed = 0;

        uint256 i;
        // Execute each transaction until one fails
        for (i = 0; i < targets.length; i++) {
            require(targets[i] != address(0), "BatchExecutor: zero target address");

            // Execute the call
            (bool success, bytes memory returnData) = targets[i].call{value: values[i]}(data[i]);

            // Track ETH used
            ethUsed += values[i];

            // Store the result
            successes[i] = success;
            results[i] = returnData;

            // Emit event for this transaction
            emit TransactionExecuted(targets[i], data[i], success, returnData);

            // If transaction fails, stop execution but keep successful ones
            if (!success) {
                break;
            }
        }

        // Refund unused ETH (both excess and for unexecuted transactions)
        uint256 refundAmount = msg.value - ethUsed;
        if (refundAmount > 0) {
            (bool refundSuccess, ) = msg.sender.call{value: refundAmount}("");
            require(refundSuccess, "BatchExecutor: ETH refund failed");
        }

        emit SequenceBatchExecuted(msg.sender, targets.length, i, successes, results);
        return true;
    }

    /**
     * @notice Version information for tracking deployments
     * @return String representing the contract version
     */
    function getVersion() external pure returns (string memory) {
        return "0.3.0";
    }

    /**
     * @notice Allows the contract to receive ETH
     */
    receive() external payable {}
}
