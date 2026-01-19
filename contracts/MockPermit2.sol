// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * @title MockPermit2
 * @notice Mock Permit2 contract for testing vault approval selector validation
 * @dev Only implements the approve function with the correct signature
 */
contract MockPermit2 {
    /**
     * @notice Approve a spender to use a specific amount of a token
     * @param token Token address
     * @param spender Spender address
     * @param amount Max amount
     * @param expiration Expiration timestamp
     */
    function approve(
        address token,
        address spender,
        uint160 amount,
        uint48 expiration
    ) external {
        // Mock implementation - just emit an event for testing
        emit Approval(msg.sender, token, spender, amount, expiration);
    }

    event Approval(
        address indexed owner,
        address indexed token,
        address indexed spender,
        uint160 amount,
        uint48 expiration
    );
}
