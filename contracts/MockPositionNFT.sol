// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MockPositionNFT
 * @notice Mock implementation of ERC721 for testing PositionVault
 * @dev Simulates Uniswap V3 position NFTs for testing purposes
 */
contract MockPositionNFT is ERC721, Ownable {
    // Simple counter for token IDs (replacing Counters utility from OZ v4)
    uint256 private _nextTokenId = 1;

    struct PositionInfo {
        address token0;
        address token1;
        uint24 fee;
        int24 tickLower;
        int24 tickUpper;
        uint128 liquidity;
    }

    mapping(uint256 => PositionInfo) public positions;

    constructor(address initialOwner)
        ERC721("MockPositionNFT", "MPNFT")
        Ownable(initialOwner)
    {}

    /**
     * @notice Creates a new position NFT
     * @param to Address to mint the NFT to
     * @param token0 Address of token0
     * @param token1 Address of token1
     * @param fee Fee tier
     * @param tickLower Lower tick
     * @param tickUpper Upper tick
     * @param liquidity Initial liquidity
     * @return tokenId ID of the minted NFT
     */
    function createPosition(
        address to,
        address token0,
        address token1,
        uint24 fee,
        int24 tickLower,
        int24 tickUpper,
        uint128 liquidity
    ) external returns (uint256 tokenId) {
        tokenId = _nextTokenId++;

        positions[tokenId] = PositionInfo({
            token0: token0,
            token1: token1,
            fee: fee,
            tickLower: tickLower,
            tickUpper: tickUpper,
            liquidity: liquidity
        });

        _mint(to, tokenId);

        return tokenId;
    }

    /**
     * @notice Updates position liquidity
     * @param tokenId ID of the position
     * @param newLiquidity New liquidity value
     */
    function updateLiquidity(uint256 tokenId, uint128 newLiquidity) external {
        require(_exists(tokenId), "Position does not exist");
        positions[tokenId].liquidity = newLiquidity;
    }

    /**
     * @dev Checks if a token exists
     * @param tokenId Token ID to check
     * @return Whether the token exists
     */
    function _exists(uint256 tokenId) internal view returns (bool) {
        return _ownerOf(tokenId) != address(0);
    }
}
