// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockWETH
 * @dev Mock WETH contract for testing vault ETH withdrawal functions
 */
contract MockWETH is ERC20 {
    constructor() ERC20("Wrapped Ether", "WETH") {}

    /**
     * @dev Wrap ETH to WETH
     */
    function deposit() external payable {
        _mint(msg.sender, msg.value);
    }

    /**
     * @dev Unwrap WETH to ETH
     */
    function withdraw(uint256 wad) external {
        require(balanceOf(msg.sender) >= wad, "MockWETH: insufficient balance");
        _burn(msg.sender, wad);
        (bool success, ) = msg.sender.call{value: wad}("");
        require(success, "MockWETH: ETH transfer failed");
    }

    /**
     * @dev Allow contract to receive ETH
     */
    receive() external payable {
        _mint(msg.sender, msg.value);
    }
}
