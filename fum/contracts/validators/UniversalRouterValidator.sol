// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "../interfaces/ISwapValidator.sol";

/**
 * @title UniversalRouterValidator
 * @notice Validates Uniswap Universal Router swap commands
 * @dev Ensures swap recipients are the vault and only safe commands are allowed.
 *
 * Allowed commands:
 * - V3_SWAP_EXACT_IN (0x00): Validate recipient = vault OR ADDRESS_THIS (for multi-hop)
 * - V3_SWAP_EXACT_OUT (0x01): Validate recipient = vault OR ADDRESS_THIS (for multi-hop)
 * - SWEEP (0x04): Validate recipient = vault (ensures tokens end up in vault)
 * - V2_SWAP_EXACT_IN (0x08): Validate recipient = vault OR ADDRESS_THIS (for multi-hop)
 * - V2_SWAP_EXACT_OUT (0x09): Validate recipient = vault OR ADDRESS_THIS (for multi-hop)
 * - PERMIT2_PERMIT (0x0a): Allowed (gasless approval, no recipient concern)
 * - WRAP_ETH (0x0b): Validate recipient = vault OR ADDRESS_THIS (for multi-hop)
 * - UNWRAP_WETH (0x0c): Validate recipient = vault (ETH must go to vault)
 * - V4_SWAP (0x10): Parse actions array, validate TAKE/SWEEP recipients
 *
 * V4 Actions validated within V4_SWAP:
 * - TAKE (0x0e): Validate recipient = vault OR ADDRESS_THIS
 * - TAKE_ALL (0x0f): Safe - uses msgSender (vault)
 * - TAKE_PORTION (0x10): Validate recipient = vault OR ADDRESS_THIS
 * - TAKE_PAIR (0x11): Validate recipient = vault OR ADDRESS_THIS
 * - SWEEP (0x14): Validate recipient = vault
 *
 * Multi-hop swaps use ADDRESS_THIS as intermediate recipient (tokens stay in router),
 * then SWEEP sends the final output to the vault.
 */
contract UniversalRouterValidator is ISwapValidator {
    // Version information
    string public constant VERSION = "2.0.0";

    // Universal Router special address for "keep tokens in router" (used in multi-hop swaps)
    // See: https://docs.uniswap.org/contracts/universal-router/technical-reference
    address constant internal ADDRESS_THIS = address(2);

    /**
     * @notice Validates Universal Router swap calldata
     * @param data The calldata being sent to the Universal Router
     * @param vault The vault address (for recipient validation)
     * @dev Reverts if any command is not allowed or has invalid recipient
     */
    function validateSwap(bytes calldata data, address vault) external pure override {
        require(data.length >= 4, "UniversalRouterValidator: invalid calldata");

        // Decode the Universal Router execute() calldata (skip 4-byte selector)
        // execute(bytes commands, bytes[] inputs, uint256 deadline)
        (bytes memory commands, bytes[] memory inputs, ) = abi.decode(
            data[4:],
            (bytes, bytes[], uint256)
        );

        for (uint256 i = 0; i < commands.length; i++) {
            uint8 command = uint8(commands[i]);

            // V3_SWAP_EXACT_IN (0x00) or V3_SWAP_EXACT_OUT (0x01)
            if (command == 0x00 || command == 0x01) {
                (address recipient, , , , ) = abi.decode(
                    inputs[i],
                    (address, uint256, uint256, bytes, bool)
                );
                require(
                    recipient == vault || recipient == ADDRESS_THIS,
                    "UniversalRouterValidator: swap recipient must be vault or router"
                );
            }
            // SWEEP (0x04) - sends tokens from router to recipient, must be vault
            else if (command == 0x04) {
                (, address recipient, ) = abi.decode(
                    inputs[i],
                    (address, address, uint256)
                );
                require(
                    recipient == vault,
                    "UniversalRouterValidator: sweep recipient must be vault"
                );
            }
            // V2_SWAP_EXACT_IN (0x08) or V2_SWAP_EXACT_OUT (0x09)
            else if (command == 0x08 || command == 0x09) {
                (address recipient, , , , ) = abi.decode(
                    inputs[i],
                    (address, uint256, uint256, address[], bool)
                );
                require(
                    recipient == vault || recipient == ADDRESS_THIS,
                    "UniversalRouterValidator: swap recipient must be vault or router"
                );
            }
            // PERMIT2_PERMIT (0x0a) - gasless approval, allowed
            else if (command == 0x0a) {
                // Allowed - no recipient validation needed
            }
            // WRAP_ETH (0x0b) - wraps native ETH to WETH
            else if (command == 0x0b) {
                (address recipient, ) = abi.decode(inputs[i], (address, uint256));
                require(
                    recipient == vault || recipient == ADDRESS_THIS,
                    "UniversalRouterValidator: wrap recipient must be vault or router"
                );
            }
            // UNWRAP_WETH (0x0c) - unwraps WETH to native ETH
            else if (command == 0x0c) {
                (address recipient, ) = abi.decode(inputs[i], (address, uint256));
                require(
                    recipient == vault,
                    "UniversalRouterValidator: unwrap recipient must be vault"
                );
            }
            // V4_SWAP (0x10) - V4 swap with actions array
            else if (command == 0x10) {
                (bytes memory actions, bytes[] memory params) = abi.decode(
                    inputs[i],
                    (bytes, bytes[])
                );

                for (uint256 j = 0; j < actions.length; j++) {
                    uint8 action = uint8(actions[j]);

                    // TAKE (0x0e) - has explicit recipient
                    if (action == 0x0e) {
                        (, address recipient, ) = abi.decode(
                            params[j],
                            (address, address, uint256)
                        );
                        require(
                            recipient == vault || recipient == ADDRESS_THIS,
                            "UniversalRouterValidator: V4 take recipient must be vault or router"
                        );
                    }
                    // TAKE_PORTION (0x10) - has explicit recipient
                    else if (action == 0x10) {
                        (, address recipient, ) = abi.decode(
                            params[j],
                            (address, address, uint256)
                        );
                        require(
                            recipient == vault || recipient == ADDRESS_THIS,
                            "UniversalRouterValidator: V4 take recipient must be vault or router"
                        );
                    }
                    // TAKE_PAIR (0x11) - has explicit recipient (currency0, currency1, recipient)
                    else if (action == 0x11) {
                        (,, address recipient) = abi.decode(
                            params[j],
                            (address, address, address)
                        );
                        require(
                            recipient == vault || recipient == ADDRESS_THIS,
                            "UniversalRouterValidator: V4 take recipient must be vault or router"
                        );
                    }
                    // SWEEP (0x14) - has explicit recipient
                    else if (action == 0x14) {
                        (, address recipient, ) = abi.decode(
                            params[j],
                            (address, address, uint256)
                        );
                        require(
                            recipient == vault,
                            "UniversalRouterValidator: V4 sweep recipient must be vault"
                        );
                    }
                    // TAKE_ALL (0x0f) - Safe, uses msgSender() which is the vault
                }
            }
            // All other commands are blocked
            else {
                revert("UniversalRouterValidator: command not allowed");
            }
        }
    }
}
