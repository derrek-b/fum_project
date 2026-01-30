// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * @title ILBPair
 * @notice Minimal interface for Trader Joe V2.1 Liquidity Book Pair
 * @dev Used by TJPositionManager to derive token and bin info from pair address
 */
interface ILBPair {
    function getTokenX() external pure returns (address);
    function getTokenY() external pure returns (address);
    function getBinStep() external pure returns (uint16);
    function balanceOf(address account, uint256 id) external view returns (uint256);
    function balanceOfBatch(address[] calldata accounts, uint256[] calldata ids)
        external view returns (uint256[] memory);
    function getBin(uint24 id) external view returns (uint128 binReserveX, uint128 binReserveY);
    function totalSupply(uint256 id) external view returns (uint256);
    function approveForAll(address spender, bool approved) external;
    function isApprovedForAll(address account, address spender) external view returns (bool);
}
