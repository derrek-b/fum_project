// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * @title IVaultFactory
 * @notice Interface for vault to call factory validation functions
 * @dev Vaults call these functions to validate transactions before execution.
 *      The factory looks up the appropriate validator and delegates to it.
 */
interface IVaultFactory {
    /**
     * @notice Validates swap calldata via the registered swap validator
     * @param router The router address being called
     * @param data The calldata being sent to the router
     * @param vault The vault address (for recipient validation)
     * @dev Reverts if no validator registered or validation fails
     */
    function validateSwap(address router, bytes calldata data, address vault) external view;

    /**
     * @notice Validates mint calldata via the registered liquidity validator
     * @param positionManager The position manager address being called
     * @param data The calldata being sent to the position manager
     * @param vault The vault address (for recipient validation)
     */
    function validateMint(address positionManager, bytes calldata data, address vault) external view;

    /**
     * @notice Validates increaseLiquidity calldata
     * @param positionManager The position manager address being called
     * @param data The calldata being sent to the position manager
     * @param vault The vault address (for recipient validation)
     */
    function validateIncreaseLiquidity(address positionManager, bytes calldata data, address vault) external view;

    /**
     * @notice Validates decreaseLiquidity calldata (typically a multicall)
     * @param positionManager The position manager address being called
     * @param data The calldata being sent to the position manager
     * @param vault The vault address (for recipient validation)
     */
    function validateDecreaseLiquidity(address positionManager, bytes calldata data, address vault) external view;

    /**
     * @notice Validates collect calldata
     * @param positionManager The position manager address being called
     * @param data The calldata being sent to the position manager
     * @param vault The vault address (for recipient validation)
     */
    function validateCollect(address positionManager, bytes calldata data, address vault) external view;

    /**
     * @notice Validates burn calldata
     * @param positionManager The position manager address being called
     * @param data The calldata being sent to the position manager
     * @param vault The vault address (for recipient validation)
     */
    function validateBurn(address positionManager, bytes calldata data, address vault) external view;
}
