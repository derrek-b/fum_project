// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title MockLBPair
 * @notice Mock Trader Joe V2.1 LB Pair for testing TJPositionManager
 * @dev Returns configurable tokenX, tokenY, and binStep values
 */
contract MockLBPair {
    address private _tokenX;
    address private _tokenY;
    uint16 private _binStep;

    // ERC1155 balances: account => id => balance
    mapping(address => mapping(uint256 => uint256)) private _balances;

    constructor(address tokenX_, address tokenY_, uint16 binStep_) {
        _tokenX = tokenX_;
        _tokenY = tokenY_;
        _binStep = binStep_;
    }

    function getTokenX() external view returns (address) {
        return _tokenX;
    }

    function getTokenY() external view returns (address) {
        return _tokenY;
    }

    function getBinStep() external view returns (uint16) {
        return _binStep;
    }

    function balanceOf(address account, uint256 id) external view returns (uint256) {
        return _balances[account][id];
    }

    function balanceOfBatch(address[] calldata accounts, uint256[] calldata ids)
        external view returns (uint256[] memory)
    {
        require(accounts.length == ids.length, "MockLBPair: length mismatch");
        uint256[] memory batchBalances = new uint256[](accounts.length);
        for (uint256 i = 0; i < accounts.length; i++) {
            batchBalances[i] = _balances[accounts[i]][ids[i]];
        }
        return batchBalances;
    }

    /// @notice Test helper to set balances directly
    function setBalance(address account, uint256 id, uint256 amount) external {
        _balances[account][id] = amount;
    }
}
