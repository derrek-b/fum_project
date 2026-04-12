// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "../interfaces/ILiquidityValidator.sol";

/**
 * @title TJPositionValidator
 * @notice Validates calldata for TJPositionManager operations
 * @dev Called by VaultFactory before PositionVault executes calls to TJPositionManager.
 *
 *      Validation model:
 *      - validateMint (createPosition): selector check + owner address in calldata must match caller
 *      - All other operations: selector-only check. Ownership is enforced by TJPositionManager
 *        itself via require(pos.owner == msg.sender), using stored on-chain state.
 */
contract TJPositionValidator is ILiquidityValidator {
    // createPosition(address,address,uint256,uint256,uint256,uint256,uint256,uint256,int256[],uint256[],uint256[],uint256)
    bytes4 constant internal CREATE_POSITION_SELECTOR = bytes4(keccak256(
        "createPosition(address,address,uint256,uint256,uint256,uint256,uint256,uint256,int256[],uint256[],uint256[],uint256)"
    ));

    /**
     * @notice Validates mint (createPosition) calldata
     * @param data The calldata being sent to TJPositionManager
     * @param caller The caller address (must match first param in calldata)
     */
    function validateMint(bytes calldata data, address caller) external pure override {
        require(data.length >= 36, "TJPositionValidator: invalid data");
        bytes4 selector = bytes4(data[:4]);
        require(selector == CREATE_POSITION_SELECTOR, "TJPositionValidator: not createPosition");
        address calldataOwner = abi.decode(data[4:36], (address));
        require(calldataOwner == caller, "TJPositionValidator: owner mismatch");
    }

    // addToPosition(uint256,uint256[],uint256[],uint256,uint256,uint256,uint256,uint256,uint256,int256[],uint256[],uint256[],uint256)
    bytes4 constant internal ADD_TO_POSITION_SELECTOR = bytes4(keccak256(
        "addToPosition(uint256,uint256[],uint256[],uint256,uint256,uint256,uint256,uint256,uint256,int256[],uint256[],uint256[],uint256)"
    ));

    // Selector-only: ownership enforced by TJPositionManager (pos.owner == msg.sender)
    function validateIncreaseLiquidity(bytes calldata data, address) external pure override {
        require(data.length >= 4, "TJPositionValidator: invalid data");
        bytes4 selector = bytes4(data[:4]);
        require(selector == ADD_TO_POSITION_SELECTOR, "TJPositionValidator: not addToPosition");
    }

    // collectFees(uint256,uint256[],uint256,uint256,uint256)
    bytes4 constant internal COLLECT_FEES_SELECTOR = bytes4(keccak256(
        "collectFees(uint256,uint256[],uint256,uint256,uint256)"
    ));

    // decreaseLiquidity(uint256,uint256,uint256[],uint256,uint256,uint256)
    bytes4 constant internal DECREASE_LIQUIDITY_SELECTOR = bytes4(keccak256(
        "decreaseLiquidity(uint256,uint256,uint256[],uint256,uint256,uint256)"
    ));

    // removePosition(uint256,uint256[],uint256,uint256,uint256)
    bytes4 constant internal REMOVE_POSITION_SELECTOR = bytes4(keccak256(
        "removePosition(uint256,uint256[],uint256,uint256,uint256)"
    ));

    // Selector-only: ownership enforced by TJPositionManager (pos.owner == msg.sender)
    function validateDecreaseLiquidity(bytes calldata data, address) external pure override {
        require(data.length >= 4, "TJPositionValidator: invalid data");
        bytes4 selector = bytes4(data[:4]);
        require(
            selector == REMOVE_POSITION_SELECTOR || selector == DECREASE_LIQUIDITY_SELECTOR,
            "TJPositionValidator: not removePosition or decreaseLiquidity"
        );
    }

    // Selector-only: ownership enforced by TJPositionManager (pos.owner == msg.sender)
    function validateCollect(bytes calldata data, address) external pure override {
        require(data.length >= 4, "TJPositionValidator: invalid data");
        bytes4 selector = bytes4(data[:4]);
        require(selector == COLLECT_FEES_SELECTOR, "TJPositionValidator: not collectFees");
    }

    function validateBurn(bytes calldata, address) external pure override {
        revert("TJPositionValidator: not yet implemented");
    }
}
