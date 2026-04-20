// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "../interfaces/ILiquidityValidator.sol";

/**
 * @title UniswapV3PositionValidator
 * @notice Validates Uniswap V3 NonfungiblePositionManager operations
 * @dev Ensures liquidity operation recipients are the vault.
 *
 * Validated operations:
 * - mint (0x88316456): NFT recipient must be vault
 * - increaseLiquidity (0x219f5d17): No recipient validation (tokens go to position)
 * - decreaseLiquidity via multicall (0xac9650d8): Collect recipients must be vault
 * - collect (0xfc6f7865): Recipient must be vault
 * - burn (0x42966c68): No recipient validation (just removes empty NFT)
 */
contract UniswapV3PositionValidator is ILiquidityValidator {
    // Version information
    string public constant VERSION = "2.0.0";

    // Function selectors for NonfungiblePositionManager
    bytes4 constant internal MINT_SELECTOR = 0x88316456;
    bytes4 constant internal INCREASE_LIQUIDITY_SELECTOR = 0x219f5d17;
    bytes4 constant internal DECREASE_LIQUIDITY_SELECTOR = 0x0c49ccbe;
    bytes4 constant internal COLLECT_SELECTOR = 0xfc6f7865;
    bytes4 constant internal BURN_SELECTOR = 0x42966c68;
    bytes4 constant internal MULTICALL_SELECTOR = 0xac9650d8;

    /**
     * @notice Validates mint calldata
     * @param data The calldata being sent to NonfungiblePositionManager
     * @param vault The vault address (for recipient validation)
     * @dev MintParams recipient is at offset 292 (4-byte selector + 9 * 32-byte params)
     */
    function validateMint(bytes calldata data, address vault) external pure override {
        require(data.length >= 356, "UniswapV3PositionValidator: invalid mint data");

        bytes4 selector = bytes4(data[:4]);
        require(selector == MINT_SELECTOR, "UniswapV3PositionValidator: not a mint call");

        // MintParams struct layout: token0, token1, fee, tickLower, tickUpper,
        // amount0Desired, amount1Desired, amount0Min, amount1Min, recipient, deadline
        // recipient is the 10th parameter (index 9), at offset 4 + 9*32 = 292
        address recipient = abi.decode(data[292:324], (address));
        require(recipient == vault, "UniswapV3PositionValidator: mint recipient must be vault");
    }

    /**
     * @notice Validates increaseLiquidity calldata
     * @param data The calldata being sent to NonfungiblePositionManager
     * @param vault The vault address (unused - no recipient validation needed)
     * @dev Tokens go to an existing position, no recipient in the call
     */
    function validateIncreaseLiquidity(bytes calldata data, address vault) external pure override {
        require(data.length >= 4, "UniswapV3PositionValidator: invalid calldata");

        bytes4 selector = bytes4(data[:4]);
        require(selector == INCREASE_LIQUIDITY_SELECTOR, "UniswapV3PositionValidator: not an increaseLiquidity call");

        // No recipient validation needed - tokens go to existing position
        // The vault owns the position NFT, so it controls the liquidity
        vault; // Silence unused variable warning
    }

    /**
     * @notice Validates decreaseLiquidity multicall calldata
     * @param data The calldata being sent to NonfungiblePositionManager
     * @param vault The vault address (for recipient validation in collect calls)
     * @dev Must be a multicall containing decreaseLiquidity + collect.
     *      Validates that all collect recipients are the vault.
     */
    function validateDecreaseLiquidity(bytes calldata data, address vault) external pure override {
        require(data.length >= 4, "UniswapV3PositionValidator: invalid calldata");

        bytes4 selector = bytes4(data[:4]);
        require(selector == MULTICALL_SELECTOR, "UniswapV3PositionValidator: must be multicall");

        // Decode the multicall data to get inner calls
        bytes[] memory innerCalls = abi.decode(data[4:], (bytes[]));

        for (uint256 i = 0; i < innerCalls.length; i++) {
            bytes memory innerCall = innerCalls[i];
            require(innerCall.length >= 4, "UniswapV3PositionValidator: invalid inner calldata");

            bytes4 innerSelector;
            assembly {
                innerSelector := mload(add(innerCall, 32))
            }

            // decreaseLiquidity (0x0c49ccbe) - allowed, no recipient
            if (innerSelector == DECREASE_LIQUIDITY_SELECTOR) {
                continue;
            }
            // collect (0xfc6f7865) - validate recipient
            if (innerSelector == COLLECT_SELECTOR) {
                require(innerCall.length >= 68, "UniswapV3PositionValidator: invalid collect data");

                // CollectParams: tokenId (32 bytes), recipient (32 bytes), ...
                // recipient is at offset 36 (4-byte selector + 32-byte tokenId)
                address recipient;
                assembly {
                    recipient := mload(add(innerCall, 68)) // 32 (length) + 4 (selector) + 32 (tokenId)
                }
                require(recipient == vault, "UniswapV3PositionValidator: collect recipient must be vault");
                continue;
            }
            // burn (0x42966c68) - allowed, no recipient (just removes empty NFT)
            if (innerSelector == BURN_SELECTOR) {
                continue;
            }
            // All other selectors blocked
            revert("UniswapV3PositionValidator: function not allowed in multicall");
        }
    }

    /**
     * @notice Validates collect calldata
     * @param data The calldata being sent to NonfungiblePositionManager
     * @param vault The vault address (for recipient validation)
     * @dev CollectParams recipient is at offset 36 (4-byte selector + 32-byte tokenId)
     */
    function validateCollect(bytes calldata data, address vault) external pure override {
        require(data.length >= 68, "UniswapV3PositionValidator: invalid collect data");

        bytes4 selector = bytes4(data[:4]);
        require(selector == COLLECT_SELECTOR, "UniswapV3PositionValidator: not a collect call");

        // CollectParams struct layout: tokenId, recipient, amount0Max, amount1Max
        // recipient is the 2nd parameter (index 1), at offset 4 + 32 = 36
        address recipient = abi.decode(data[36:68], (address));
        require(recipient == vault, "UniswapV3PositionValidator: collect recipient must be vault");
    }

    /**
     * @notice Validates burn calldata
     * @param data The calldata being sent to NonfungiblePositionManager
     * @param vault The vault address (unused - no recipient validation needed)
     * @dev burn(uint256 tokenId) just removes an empty NFT, no recipient
     */
    function validateBurn(bytes calldata data, address vault) external pure override {
        require(data.length >= 4, "UniswapV3PositionValidator: invalid calldata");

        bytes4 selector = bytes4(data[:4]);
        require(selector == BURN_SELECTOR, "UniswapV3PositionValidator: not a burn call");

        // No recipient validation - just burns empty NFT
        vault; // Silence unused variable warning
    }
}
