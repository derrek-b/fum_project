// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MockERC20
 * @notice Mock ERC20 token for testing purposes
 */
contract MockERC20 is ERC20, Ownable {
    uint8 private _decimals;

    // For simulating approval failures (tests caller's "approval failed" require path)
    bool public shouldFailApprove;

    constructor(
        string memory name,
        string memory symbol,
        uint8 decimals_
    ) ERC20(name, symbol) Ownable(msg.sender) {
        _decimals = decimals_;
    }

    /**
     * @notice Set whether approve calls should revert
     */
    function setShouldFailApprove(bool _shouldFailApprove) external {
        shouldFailApprove = _shouldFailApprove;
    }

    /**
     * @notice Override approve to optionally revert when shouldFailApprove is true
     */
    function approve(address spender, uint256 value) public override returns (bool) {
        require(!shouldFailApprove, "MockERC20: forced approval failure");
        return super.approve(spender, value);
    }

    /**
     * @notice Mints tokens to the specified address
     * @param to Recipient address
     * @param amount Amount to mint
     */
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    /**
     * @notice Burns tokens from the caller's address
     * @param amount Amount to burn
     */
    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }

    /**
     * @notice Returns the number of decimals
     */
    function decimals() public view override returns (uint8) {
        return _decimals;
    }
}
