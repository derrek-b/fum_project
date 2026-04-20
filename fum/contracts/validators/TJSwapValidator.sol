// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "../interfaces/ISwapValidator.sol";

/**
 * @title TJSwapValidator
 * @notice Validates calldata for LB Router swap operations
 * @dev Called by VaultFactory before PositionVault executes swap calls to the LB Router.
 *
 *      Validates that:
 *      - The function selector matches one of the 6 allowed LB Router swap functions
 *      - The `to` (recipient) parameter equals the vault address
 *
 *      Allowed swap functions (grouped by parameter count):
 *
 *      5-param group (2 uint256s before Path, `to` at byte offset 100):
 *      - swapExactTokensForTokens(uint256,uint256,(uint256[],uint8[],address[]),address,uint256)
 *      - swapExactTokensForNATIVE(uint256,uint256,(uint256[],uint8[],address[]),address,uint256)
 *      - swapTokensForExactTokens(uint256,uint256,(uint256[],uint8[],address[]),address,uint256)
 *      - swapTokensForExactNATIVE(uint256,uint256,(uint256[],uint8[],address[]),address,uint256)
 *
 *      4-param group (1 uint256 before Path, `to` at byte offset 68):
 *      - swapExactNATIVEForTokens(uint256,(uint256[],uint8[],address[]),address,uint256)
 *      - swapNATIVEForExactTokens(uint256,(uint256[],uint8[],address[]),address,uint256)
 */
contract TJSwapValidator is ISwapValidator {
    // Version information
    string public constant VERSION = "2.0.0";

    // 5-param group: swapExactTokensForTokens(uint256,uint256,(uint256[],uint8[],address[]),address,uint256)
    bytes4 constant internal SWAP_EXACT_TOKENS_FOR_TOKENS = bytes4(keccak256(
        "swapExactTokensForTokens(uint256,uint256,(uint256[],uint8[],address[]),address,uint256)"
    ));

    // 5-param group: swapExactTokensForNATIVE(uint256,uint256,(uint256[],uint8[],address[]),address,uint256)
    bytes4 constant internal SWAP_EXACT_TOKENS_FOR_NATIVE = bytes4(keccak256(
        "swapExactTokensForNATIVE(uint256,uint256,(uint256[],uint8[],address[]),address,uint256)"
    ));

    // 5-param group: swapTokensForExactTokens(uint256,uint256,(uint256[],uint8[],address[]),address,uint256)
    bytes4 constant internal SWAP_TOKENS_FOR_EXACT_TOKENS = bytes4(keccak256(
        "swapTokensForExactTokens(uint256,uint256,(uint256[],uint8[],address[]),address,uint256)"
    ));

    // 5-param group: swapTokensForExactNATIVE(uint256,uint256,(uint256[],uint8[],address[]),address,uint256)
    bytes4 constant internal SWAP_TOKENS_FOR_EXACT_NATIVE = bytes4(keccak256(
        "swapTokensForExactNATIVE(uint256,uint256,(uint256[],uint8[],address[]),address,uint256)"
    ));

    // 4-param group: swapExactNATIVEForTokens(uint256,(uint256[],uint8[],address[]),address,uint256)
    bytes4 constant internal SWAP_EXACT_NATIVE_FOR_TOKENS = bytes4(keccak256(
        "swapExactNATIVEForTokens(uint256,(uint256[],uint8[],address[]),address,uint256)"
    ));

    // 4-param group: swapNATIVEForExactTokens(uint256,(uint256[],uint8[],address[]),address,uint256)
    bytes4 constant internal SWAP_NATIVE_FOR_EXACT_TOKENS = bytes4(keccak256(
        "swapNATIVEForExactTokens(uint256,(uint256[],uint8[],address[]),address,uint256)"
    ));

    /**
     * @notice Validates LB Router swap calldata
     * @param data The calldata being sent to the LB Router
     * @param vault The vault address (must match `to` parameter in calldata)
     * @dev Reverts if selector is unknown or recipient is not the vault
     */
    function validateSwap(bytes calldata data, address vault) external pure override {
        require(data.length >= 4, "TJSwapValidator: invalid data");

        bytes4 selector = bytes4(data[:4]);
        uint256 toOffset;

        // 5-param group: to is at byte 100 (selector + 3 slots)
        if (
            selector == SWAP_EXACT_TOKENS_FOR_TOKENS ||
            selector == SWAP_EXACT_TOKENS_FOR_NATIVE ||
            selector == SWAP_TOKENS_FOR_EXACT_TOKENS ||
            selector == SWAP_TOKENS_FOR_EXACT_NATIVE
        ) {
            toOffset = 100;
        }
        // 4-param group: to is at byte 68 (selector + 2 slots)
        else if (
            selector == SWAP_EXACT_NATIVE_FOR_TOKENS ||
            selector == SWAP_NATIVE_FOR_EXACT_TOKENS
        ) {
            toOffset = 68;
        }
        else {
            revert("TJSwapValidator: unknown selector");
        }

        require(data.length >= toOffset + 32, "TJSwapValidator: data too short");
        address to = abi.decode(data[toOffset:toOffset + 32], (address));
        require(to == vault, "TJSwapValidator: recipient mismatch");
    }
}
