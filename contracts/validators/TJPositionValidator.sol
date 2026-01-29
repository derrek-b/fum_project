// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "../interfaces/ILiquidityValidator.sol";

/**
 * @title TJPositionValidator
 * @notice Validates calldata for TJPositionManager operations
 * @dev Called by VaultFactory before PositionVault executes calls to TJPositionManager.
 *      Only validateMint is functional; others revert with "not yet implemented".
 *
 *      Validation ensures:
 *      - The function selector matches createPosition
 *      - The vault address in calldata matches the actual calling vault
 */
contract TJPositionValidator is ILiquidityValidator {
    // createPosition(address,address,uint256,uint256,uint256,uint256,uint256,uint256,int256[],uint256[],uint256[],uint256)
    bytes4 constant internal CREATE_POSITION_SELECTOR = bytes4(keccak256(
        "createPosition(address,address,uint256,uint256,uint256,uint256,uint256,uint256,int256[],uint256[],uint256[],uint256)"
    ));

    /**
     * @notice Validates mint (createPosition) calldata
     * @param data The calldata being sent to TJPositionManager
     * @param vault The vault address (must match first param in calldata)
     */
    function validateMint(bytes calldata data, address vault) external pure override {
        require(data.length >= 36, "TJPositionValidator: invalid data");
        bytes4 selector = bytes4(data[:4]);
        require(selector == CREATE_POSITION_SELECTOR, "TJPositionValidator: not createPosition");
        address calldataVault = abi.decode(data[4:36], (address));
        require(calldataVault == vault, "TJPositionValidator: vault mismatch");
    }

    function validateIncreaseLiquidity(bytes calldata, address) external pure override {
        revert("TJPositionValidator: not yet implemented");
    }

    function validateDecreaseLiquidity(bytes calldata, address) external pure override {
        revert("TJPositionValidator: not yet implemented");
    }

    function validateCollect(bytes calldata, address) external pure override {
        revert("TJPositionValidator: not yet implemented");
    }

    function validateBurn(bytes calldata, address) external pure override {
        revert("TJPositionValidator: not yet implemented");
    }
}
