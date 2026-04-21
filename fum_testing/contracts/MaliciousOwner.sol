// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IVaultFactoryCreate {
    function createVault(string memory name) external returns (address);
}

interface IPositionVaultOwnerActions {
    function withdrawETH(uint256 amount) external;
    function unwrapAndWithdrawETH(address weth, uint256 amount) external;
}

/**
 * @title MaliciousOwner
 * @notice Test mock: a contract that rejects all ETH transfers via a reverting receive().
 * @dev Exercises PositionVault.withdrawETH / unwrapAndWithdrawETH `require(success, "ETH transfer failed")`
 *      branches. Creates vaults via VaultFactory (so the vault's owner is this contract)
 *      and proxies owner-only calls through the trigger* helpers.
 */
contract MaliciousOwner {
    receive() external payable {
        revert("MaliciousOwner: rejects ETH");
    }

    function createVault(address factory, string memory name) external returns (address) {
        return IVaultFactoryCreate(factory).createVault(name);
    }

    function triggerWithdrawETH(address vault, uint256 amount) external {
        IPositionVaultOwnerActions(vault).withdrawETH(amount);
    }

    function triggerUnwrapAndWithdrawETH(address vault, address weth, uint256 amount) external {
        IPositionVaultOwnerActions(vault).unwrapAndWithdrawETH(weth, amount);
    }
}
