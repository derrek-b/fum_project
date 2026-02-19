// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";

/**
 * @title TJPositionProxy
 * @notice Minimal proxy implementation for per-position LB token isolation.
 * @dev Deployed once as an implementation contract. Cloned via EIP-1167 for each
 *      Trader Joe position. Holds ERC1155 LB tokens and executes calls on behalf
 *      of TJPositionManager.
 */
contract TJPositionProxy is ERC1155Holder {
    address public manager;
    bool private initialized;

    /**
     * @notice One-time initialization after clone deployment
     * @param _manager The TJPositionManager that controls this proxy
     */
    function initialize(address _manager) external {
        require(!initialized, "TJPositionProxy: already initialized");
        require(_manager != address(0), "TJPositionProxy: zero manager");
        manager = _manager;
        initialized = true;
    }

    /**
     * @notice Execute an arbitrary call on behalf of the manager
     * @dev Only callable by the TJPositionManager. Forwards revert reasons.
     * @param to Target contract address
     * @param data Calldata to forward
     * @return result Raw return bytes from the call
     */
    function execute(address to, bytes calldata data) external returns (bytes memory result) {
        require(msg.sender == manager, "TJPositionProxy: only manager");
        bool success;
        (success, result) = to.call(data);
        if (!success) {
            assembly {
                revert(add(result, 32), mload(result))
            }
        }
    }
}
