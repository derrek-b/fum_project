// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "../interfaces/ILiquidityValidator.sol";

/**
 * @title UniswapV4PositionValidator
 * @notice Validates Uniswap V4 PositionManager operations
 * @dev Ensures liquidity operation recipients are the vault.
 *
 * V4 Architecture:
 * - All liquidity operations go through modifyLiquidities(bytes unlockData, uint256 deadline)
 * - unlockData contains encoded actions (bytes) and params (bytes[])
 * - Actions are single bytes representing operation types
 *
 * Validated operations:
 * - MINT_POSITION (0x02): owner must be vault
 * - MINT_POSITION_FROM_DELTAS (0x05): owner must be vault
 * - INCREASE_LIQUIDITY (0x00): No recipient validation (tokens go to position)
 * - DECREASE_LIQUIDITY (0x01): No recipient in action itself
 * - TAKE (0x0e): recipient must be vault
 * - TAKE_PORTION (0x10): recipient must be vault
 * - TAKE_PAIR (0x11): recipient must be vault
 * - SWEEP (0x14): recipient must be vault
 * - BURN_POSITION (0x03): No recipient validation (burns empty NFT)
 */
contract UniswapV4PositionValidator is ILiquidityValidator {
    // Function selector for modifyLiquidities(bytes,uint256)
    bytes4 constant internal MODIFY_LIQUIDITIES_SELECTOR = 0xdd46508f;

    // V4 Action codes from Actions.sol
    uint8 constant internal ACTION_INCREASE_LIQUIDITY = 0x00;
    uint8 constant internal ACTION_DECREASE_LIQUIDITY = 0x01;
    uint8 constant internal ACTION_MINT_POSITION = 0x02;
    uint8 constant internal ACTION_BURN_POSITION = 0x03;
    uint8 constant internal ACTION_MINT_POSITION_FROM_DELTAS = 0x05;
    uint8 constant internal ACTION_SETTLE = 0x0b;
    uint8 constant internal ACTION_SETTLE_PAIR = 0x0d;
    uint8 constant internal ACTION_TAKE = 0x0e;
    uint8 constant internal ACTION_TAKE_PORTION = 0x10;
    uint8 constant internal ACTION_TAKE_PAIR = 0x11;
    uint8 constant internal ACTION_SWEEP = 0x14;

    // Uniswap V4 sentinel address that resolves to msg.sender at execution time
    address constant internal MSG_SENDER = address(1);

    /**
     * @notice Validates mint (new position) calldata
     * @param data The calldata being sent to PositionManager
     * @param vault The vault address (for recipient validation)
     * @dev Validates MINT_POSITION or MINT_POSITION_FROM_DELTAS owner is vault
     */
    function validateMint(bytes calldata data, address vault) external pure override {
        require(data.length >= 4, "UniswapV4PositionValidator: invalid calldata");

        bytes4 selector = bytes4(data[:4]);
        require(selector == MODIFY_LIQUIDITIES_SELECTOR, "UniswapV4PositionValidator: not modifyLiquidities");

        // Decode actions and params from unlockData
        (bytes memory actions, bytes[] memory params) = _decodeUnlockData(data);

        // Find and validate MINT_POSITION or MINT_POSITION_FROM_DELTAS action
        bool foundMint = false;
        for (uint256 i = 0; i < actions.length; i++) {
            uint8 action = uint8(actions[i]);

            if (action == ACTION_MINT_POSITION) {
                // MINT_POSITION params: (PoolKey, tickLower, tickUpper, liquidity, amount0Max, amount1Max, owner, hookData)
                // owner is at offset 0x140 (5*32 for PoolKey + 2*32 for ticks + 3*32 for amounts)
                require(params[i].length >= 0x160, "UniswapV4PositionValidator: invalid mint params");
                address owner = _extractAddress(params[i], 0x140);
                require(owner == vault, "UniswapV4PositionValidator: mint owner must be vault");
                foundMint = true;
            } else if (action == ACTION_MINT_POSITION_FROM_DELTAS) {
                // MINT_POSITION_FROM_DELTAS params: (PoolKey, tickLower, tickUpper, amount0Max, amount1Max, owner, hookData)
                // owner is at offset 0x120 (5*32 for PoolKey + 2*32 for ticks + 2*32 for amounts)
                require(params[i].length >= 0x140, "UniswapV4PositionValidator: invalid mint params");
                address owner = _extractAddress(params[i], 0x120);
                require(owner == vault, "UniswapV4PositionValidator: mint owner must be vault");
                foundMint = true;
            }
        }

        require(foundMint, "UniswapV4PositionValidator: no mint action found");
    }

    /**
     * @notice Validates increaseLiquidity calldata
     * @param data The calldata being sent to PositionManager
     * @param vault The vault address (unused - no recipient validation needed)
     * @dev Tokens go to an existing position, no recipient in the call
     */
    function validateIncreaseLiquidity(bytes calldata data, address vault) external pure override {
        require(data.length >= 4, "UniswapV4PositionValidator: invalid calldata");

        bytes4 selector = bytes4(data[:4]);
        require(selector == MODIFY_LIQUIDITIES_SELECTOR, "UniswapV4PositionValidator: not modifyLiquidities");

        // Decode actions and params from unlockData
        (bytes memory actions, ) = _decodeUnlockData(data);

        // Verify INCREASE_LIQUIDITY action exists
        bool foundIncrease = false;
        for (uint256 i = 0; i < actions.length; i++) {
            if (uint8(actions[i]) == ACTION_INCREASE_LIQUIDITY) {
                foundIncrease = true;
                break;
            }
        }

        require(foundIncrease, "UniswapV4PositionValidator: no increase liquidity action found");

        // No recipient validation needed - tokens go to existing position
        vault; // Silence unused variable warning
    }

    /**
     * @notice Validates decreaseLiquidity calldata
     * @param data The calldata being sent to PositionManager
     * @param vault The vault address (for recipient validation in TAKE actions)
     * @dev Validates that all TAKE, TAKE_PAIR, and SWEEP recipients are the vault
     */
    function validateDecreaseLiquidity(bytes calldata data, address vault) external pure override {
        require(data.length >= 4, "UniswapV4PositionValidator: invalid calldata");

        bytes4 selector = bytes4(data[:4]);
        require(selector == MODIFY_LIQUIDITIES_SELECTOR, "UniswapV4PositionValidator: not modifyLiquidities");

        // Decode actions and params from unlockData
        (bytes memory actions, bytes[] memory params) = _decodeUnlockData(data);

        // Validate all TAKE, TAKE_PAIR, and SWEEP recipients
        for (uint256 i = 0; i < actions.length; i++) {
            uint8 action = uint8(actions[i]);

            if (action == ACTION_TAKE) {
                // TAKE params: (Currency currency, address recipient, uint256 amount)
                // recipient is at offset 0x20
                require(params[i].length >= 0x60, "UniswapV4PositionValidator: invalid take params");
                address recipient = _extractAddress(params[i], 0x20);
                require(recipient == vault, "UniswapV4PositionValidator: take recipient must be vault");
            } else if (action == ACTION_TAKE_PORTION) {
                // TAKE_PORTION params: (Currency currency, address recipient, uint256 bips)
                // recipient is at offset 0x20
                require(params[i].length >= 0x60, "UniswapV4PositionValidator: invalid take portion params");
                address recipient = _extractAddress(params[i], 0x20);
                require(recipient == vault, "UniswapV4PositionValidator: take portion recipient must be vault");
            } else if (action == ACTION_TAKE_PAIR) {
                // TAKE_PAIR params: (Currency currency0, Currency currency1, address recipient)
                // recipient is at offset 0x40
                // Accept vault address OR MSG_SENDER (0x1) which resolves to msg.sender at execution
                require(params[i].length >= 0x60, "UniswapV4PositionValidator: invalid take pair params");
                address recipient = _extractAddress(params[i], 0x40);
                require(
                    recipient == vault || recipient == MSG_SENDER,
                    "UniswapV4PositionValidator: take pair recipient must be vault or MSG_SENDER"
                );
            } else if (action == ACTION_SWEEP) {
                // SWEEP params: (Currency currency, address to)
                // to is at offset 0x20
                require(params[i].length >= 0x40, "UniswapV4PositionValidator: invalid sweep params");
                address to = _extractAddress(params[i], 0x20);
                require(to == vault, "UniswapV4PositionValidator: sweep recipient must be vault");
            }
        }
    }

    /**
     * @notice Validates collect (fee collection) calldata
     * @param data The calldata being sent to PositionManager
     * @param vault The vault address (for recipient validation)
     * @dev V4 uses DECREASE_LIQUIDITY with 0 liquidity + TAKE_PAIR for fee collection
     *      Same validation as decreaseLiquidity - all TAKE recipients must be vault
     */
    function validateCollect(bytes calldata data, address vault) external pure override {
        require(data.length >= 4, "UniswapV4PositionValidator: invalid calldata");

        bytes4 selector = bytes4(data[:4]);
        require(selector == MODIFY_LIQUIDITIES_SELECTOR, "UniswapV4PositionValidator: not modifyLiquidities");

        // Decode actions and params from unlockData
        (bytes memory actions, bytes[] memory params) = _decodeUnlockData(data);

        // Validate all TAKE, TAKE_PORTION, TAKE_PAIR, and SWEEP recipients (same as decreaseLiquidity)
        for (uint256 i = 0; i < actions.length; i++) {
            uint8 action = uint8(actions[i]);

            if (action == ACTION_TAKE) {
                require(params[i].length >= 0x60, "UniswapV4PositionValidator: invalid take params");
                address recipient = _extractAddress(params[i], 0x20);
                require(recipient == vault, "UniswapV4PositionValidator: take recipient must be vault");
            } else if (action == ACTION_TAKE_PORTION) {
                require(params[i].length >= 0x60, "UniswapV4PositionValidator: invalid take portion params");
                address recipient = _extractAddress(params[i], 0x20);
                require(recipient == vault, "UniswapV4PositionValidator: take portion recipient must be vault");
            } else if (action == ACTION_TAKE_PAIR) {
                // Accept vault address OR MSG_SENDER (0x1) which resolves to msg.sender at execution
                require(params[i].length >= 0x60, "UniswapV4PositionValidator: invalid take pair params");
                address recipient = _extractAddress(params[i], 0x40);
                require(
                    recipient == vault || recipient == MSG_SENDER,
                    "UniswapV4PositionValidator: take pair recipient must be vault or MSG_SENDER"
                );
            } else if (action == ACTION_SWEEP) {
                require(params[i].length >= 0x40, "UniswapV4PositionValidator: invalid sweep params");
                address to = _extractAddress(params[i], 0x20);
                require(to == vault, "UniswapV4PositionValidator: sweep recipient must be vault");
            }
        }
    }

    /**
     * @notice Validates burn (remove empty position NFT) calldata
     * @param data The calldata being sent to PositionManager
     * @param vault The vault address (unused - no recipient validation needed)
     * @dev BURN_POSITION just removes an empty NFT, no recipient
     */
    function validateBurn(bytes calldata data, address vault) external pure override {
        require(data.length >= 4, "UniswapV4PositionValidator: invalid calldata");

        bytes4 selector = bytes4(data[:4]);
        require(selector == MODIFY_LIQUIDITIES_SELECTOR, "UniswapV4PositionValidator: not modifyLiquidities");

        // Decode actions from unlockData
        (bytes memory actions, ) = _decodeUnlockData(data);

        // Verify BURN_POSITION action exists
        bool foundBurn = false;
        for (uint256 i = 0; i < actions.length; i++) {
            if (uint8(actions[i]) == ACTION_BURN_POSITION) {
                foundBurn = true;
                break;
            }
        }

        require(foundBurn, "UniswapV4PositionValidator: no burn action found");

        // No recipient validation - just burns empty NFT
        vault; // Silence unused variable warning
    }

    /**
     * @notice Decode unlockData from modifyLiquidities calldata
     * @param data The full calldata
     * @return actions The packed action bytes
     * @return params The array of params for each action
     * @dev Calldata structure:
     *      [0-4]: selector
     *      [4-36]: offset to unlockData (typically 0x40)
     *      [36-68]: deadline
     *      [68+]: unlockData bytes with structure:
     *             [0x00-0x20]: offset to actions (0x40)
     *             [0x20-0x40]: offset to params array
     *             [0x40-0x60]: actions.length
     *             [0x60+]: actions data
     *             [...]: params array
     */
    function _decodeUnlockData(bytes calldata data) internal pure returns (bytes memory actions, bytes[] memory params) {
        // Get offset to unlockData (first param after selector)
        uint256 unlockDataOffset;
        assembly {
            unlockDataOffset := calldataload(add(data.offset, 4))
        }

        // unlockData starts at: data.offset + 4 (selector) + unlockDataOffset
        uint256 unlockDataStart = 4 + unlockDataOffset;

        // Get unlockData length
        uint256 unlockDataLength;
        assembly {
            unlockDataLength := calldataload(add(data.offset, unlockDataStart))
        }

        // Actual unlockData content starts after the length word
        uint256 contentStart = unlockDataStart + 32;

        // Read offset to actions (relative to unlockData content start)
        uint256 actionsOffset;
        assembly {
            actionsOffset := calldataload(add(data.offset, contentStart))
        }

        // Read offset to params array (relative to unlockData content start)
        uint256 paramsOffset;
        assembly {
            paramsOffset := calldataload(add(data.offset, add(contentStart, 0x20)))
        }

        // Read actions length and data
        uint256 actionsLengthOffset = contentStart + actionsOffset;
        uint256 actionsLength;
        assembly {
            actionsLength := calldataload(add(data.offset, actionsLengthOffset))
        }

        // Copy actions bytes
        actions = new bytes(actionsLength);
        for (uint256 i = 0; i < actionsLength; i++) {
            actions[i] = data[actionsLengthOffset + 32 + i];
        }

        // Read params array length
        uint256 paramsLengthOffset = contentStart + paramsOffset;
        uint256 paramsLength;
        assembly {
            paramsLength := calldataload(add(data.offset, paramsLengthOffset))
        }

        // Initialize params array
        params = new bytes[](paramsLength);

        // Read each param's offset and data
        for (uint256 i = 0; i < paramsLength; i++) {
            // Get offset to param[i] (relative to params array start)
            uint256 paramOffsetLocation = paramsLengthOffset + 32 + (i * 32);
            uint256 paramOffset;
            assembly {
                paramOffset := calldataload(add(data.offset, paramOffsetLocation))
            }

            // Get param[i] length
            uint256 paramLengthLocation = paramsLengthOffset + 32 + paramOffset;
            uint256 paramLength;
            assembly {
                paramLength := calldataload(add(data.offset, paramLengthLocation))
            }

            // Copy param[i] bytes
            params[i] = new bytes(paramLength);
            for (uint256 j = 0; j < paramLength; j++) {
                params[i][j] = data[paramLengthLocation + 32 + j];
            }
        }
    }

    /**
     * @notice Extract an address from a bytes array at a given offset
     * @param data The bytes array
     * @param offset The offset to read from
     * @return addr The extracted address
     */
    function _extractAddress(bytes memory data, uint256 offset) internal pure returns (address addr) {
        require(data.length >= offset + 32, "UniswapV4PositionValidator: invalid offset");
        assembly {
            addr := mload(add(add(data, 32), offset))
        }
    }
}
