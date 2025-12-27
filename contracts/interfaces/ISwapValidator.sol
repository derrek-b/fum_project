// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * @title ISwapValidator
 * @notice Interface for swap validation contracts
 * @dev Validators are called by PositionVault before executing swap transactions.
 *      Each DEX/router type needs its own validator implementation.
 */
interface ISwapValidator {
    /**
     * @notice Validates swap calldata before execution
     * @param data The calldata being sent to the router
     * @param vault The vault address (for recipient validation)
     * @dev Must revert if validation fails. Validation should ensure:
     *      - Only allowed commands/functions are called
     *      - Recipients are either the vault or router-internal addresses
     *      - No unauthorized fund transfers can occur
     */
    function validateSwap(bytes calldata data, address vault) external view;
}
