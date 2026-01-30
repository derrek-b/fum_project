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

    // ERC1155-style approvals: owner => operator => approved
    mapping(address => mapping(address => bool)) private _operatorApprovals;

    // Bin reserves: binId => (reserveX, reserveY)
    mapping(uint24 => uint128) private _binReserveX;
    mapping(uint24 => uint128) private _binReserveY;

    // Total supply per bin: binId => totalSupply
    mapping(uint256 => uint256) private _totalSupply;

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

    // --- ERC1155-style approval (V2.1 uses approveForAll, not setApprovalForAll) ---

    function approveForAll(address spender, bool approved) external {
        _operatorApprovals[msg.sender][spender] = approved;
    }

    function isApprovedForAll(address account, address spender) external view returns (bool) {
        return _operatorApprovals[account][spender];
    }

    // --- Bin data for removal flow ---

    function getBin(uint24 id) external view returns (uint128 binReserveX, uint128 binReserveY) {
        return (_binReserveX[id], _binReserveY[id]);
    }

    function totalSupply(uint256 id) external view returns (uint256) {
        return _totalSupply[id];
    }

    /// @notice Test helper to set bin reserves
    function setBinReserves(uint24 id, uint128 reserveX, uint128 reserveY) external {
        _binReserveX[id] = reserveX;
        _binReserveY[id] = reserveY;
    }

    /// @notice Test helper to set total supply for a bin
    function setTotalSupply(uint256 id, uint256 supply) external {
        _totalSupply[id] = supply;
    }
}
