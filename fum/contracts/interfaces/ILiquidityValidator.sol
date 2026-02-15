// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * @title ILiquidityValidator
 * @notice Interface for liquidity operation validation contracts
 * @dev Validators are called by PositionVault before executing liquidity operations.
 *      Each position manager type needs its own validator implementation.
 */
interface ILiquidityValidator {
    /**
     * @notice Validates mint (new position) calldata
     * @param data The calldata being sent to the position manager
     * @param vault The vault address (for recipient validation)
     * @dev Must revert if validation fails. Should ensure the NFT recipient is the vault.
     */
    function validateMint(bytes calldata data, address vault) external view;

    /**
     * @notice Validates increaseLiquidity calldata
     * @param data The calldata being sent to the position manager
     * @param vault The vault address (for recipient validation)
     * @dev Must revert if validation fails. No recipient validation typically needed
     *      since tokens go to an existing position owned by the vault.
     */
    function validateIncreaseLiquidity(bytes calldata data, address vault) external view;

    /**
     * @notice Validates decreaseLiquidity calldata (typically a multicall)
     * @param data The calldata being sent to the position manager
     * @param vault The vault address (for recipient validation)
     * @dev Must revert if validation fails. Should validate that collect recipients
     *      within any multicall are the vault.
     */
    function validateDecreaseLiquidity(bytes calldata data, address vault) external view;

    /**
     * @notice Validates collect (fee collection) calldata
     * @param data The calldata being sent to the position manager
     * @param vault The vault address (for recipient validation)
     * @dev Must revert if validation fails. Should ensure the recipient is the vault.
     */
    function validateCollect(bytes calldata data, address vault) external view;

    /**
     * @notice Validates burn (remove empty position NFT) calldata
     * @param data The calldata being sent to the position manager
     * @param vault The vault address (for recipient validation)
     * @dev Must revert if validation fails. No recipient validation needed
     *      since burn just removes an empty NFT.
     */
    function validateBurn(bytes calldata data, address vault) external view;
}
