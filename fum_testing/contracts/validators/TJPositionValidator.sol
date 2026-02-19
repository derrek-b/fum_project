// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "../interfaces/ILiquidityValidator.sol";

/**
 * @title TJPositionValidator
 * @notice Validates calldata for TJPositionManager operations
 * @dev Called by VaultFactory before PositionVault executes calls to TJPositionManager.
 *
 *      Validation ensures:
 *      - The function selector matches the expected operation
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

    // addToPosition(address,uint256,uint256[],uint256[],uint256,uint256,uint256,uint256,uint256,uint256,int256[],uint256[],uint256[],uint256)
    bytes4 constant internal ADD_TO_POSITION_SELECTOR = bytes4(keccak256(
        "addToPosition(address,uint256,uint256[],uint256[],uint256,uint256,uint256,uint256,uint256,uint256,int256[],uint256[],uint256[],uint256)"
    ));

    function validateIncreaseLiquidity(bytes calldata data, address vault) external pure override {
        require(data.length >= 36, "TJPositionValidator: invalid data");
        bytes4 selector = bytes4(data[:4]);
        require(selector == ADD_TO_POSITION_SELECTOR, "TJPositionValidator: not addToPosition");
        address calldataVault = abi.decode(data[4:36], (address));
        require(calldataVault == vault, "TJPositionValidator: vault mismatch");
    }

    // collectFees(address,uint256,uint256[],uint256,uint256,uint256)
    bytes4 constant internal COLLECT_FEES_SELECTOR = bytes4(keccak256(
        "collectFees(address,uint256,uint256[],uint256,uint256,uint256)"
    ));

    // decreaseLiquidity(address,uint256,uint256,uint256[],uint256,uint256,uint256)
    bytes4 constant internal DECREASE_LIQUIDITY_SELECTOR = bytes4(keccak256(
        "decreaseLiquidity(address,uint256,uint256,uint256[],uint256,uint256,uint256)"
    ));

    // removePosition(address,uint256,uint256[],uint256,uint256,uint256)
    bytes4 constant internal REMOVE_POSITION_SELECTOR = bytes4(keccak256(
        "removePosition(address,uint256,uint256[],uint256,uint256,uint256)"
    ));

    function validateDecreaseLiquidity(bytes calldata data, address vault) external pure override {
        require(data.length >= 36, "TJPositionValidator: invalid data");
        bytes4 selector = bytes4(data[:4]);
        require(
            selector == REMOVE_POSITION_SELECTOR || selector == DECREASE_LIQUIDITY_SELECTOR,
            "TJPositionValidator: not removePosition or decreaseLiquidity"
        );
        address calldataVault = abi.decode(data[4:36], (address));
        require(calldataVault == vault, "TJPositionValidator: vault mismatch");
    }

    function validateCollect(bytes calldata data, address vault) external pure override {
        require(data.length >= 36, "TJPositionValidator: invalid data");
        bytes4 selector = bytes4(data[:4]);
        require(selector == COLLECT_FEES_SELECTOR, "TJPositionValidator: not collectFees");
        address calldataVault = abi.decode(data[4:36], (address));
        require(calldataVault == vault, "TJPositionValidator: vault mismatch");
    }

    function validateBurn(bytes calldata, address) external pure override {
        revert("TJPositionValidator: not yet implemented");
    }
}
