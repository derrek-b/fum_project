// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "../interfaces/IIncentiveValidator.sol";

/**
 * @title MerklIncentiveValidator
 * @notice Validates Merkl Distributor claim operations
 * @dev Ensures incentive claim transactions are safe for vault execution.
 *
 * Merkl's Distributor contract has a single claim function:
 *   claim(address user, address[] tokens, uint256[] amounts, bytes32[][] proofs)
 *
 * The `user` parameter determines who receives the reward tokens.
 * This validator ensures `user` is always the vault address, preventing
 * a compromised executor from redirecting rewards to another address.
 *
 * Merkl uses a cumulative claim model — each claim includes the total
 * earned amount with an updated Merkle proof, so claiming is idempotent
 * and safe to repeat.
 */
contract MerklIncentiveValidator is IIncentiveValidator {
    // Version information
    string public constant VERSION = "2.0.0";

    // Function selector for claim(address,address[],uint256[],bytes32[][])
    bytes4 constant internal CLAIM_SELECTOR = 0xa0165082;

    /**
     * @notice Validates Merkl claim calldata
     * @param data The calldata being sent to the Merkl Distributor
     * @param vault The vault address (claim recipient must match)
     * @dev Validates:
     *      1. Function selector is claim()
     *      2. The `user` parameter (first arg) equals the vault address
     */
    function validateIncentive(bytes calldata data, address vault) external pure override {
        require(data.length >= 4, "MerklIncentiveValidator: invalid calldata");

        bytes4 selector = bytes4(data[:4]);
        require(selector == CLAIM_SELECTOR, "MerklIncentiveValidator: not a claim call");

        // Extract the user parameter (first param after selector, at byte offset 4)
        // ABI encoding: address is left-padded to 32 bytes
        address user;
        assembly {
            user := calldataload(add(data.offset, 4))
        }
        require(user == vault, "MerklIncentiveValidator: claim user must be vault");
    }
}
