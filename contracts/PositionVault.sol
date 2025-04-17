// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title PositionVault
 * @notice User-controlled vault for managing DeFi positions across platforms
 * @dev Holds tokens and NFT positions, executing transactions approved by the owner
 */
contract PositionVault is IERC721Receiver, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // Vault owner with full control
    address public owner;

    // Strategy contract storing vault parameters
    address public strategy;

    // Wallet authorized to execute transactions
    address public executor;

    // Positions managed by this vault
    mapping(uint256 => bool) public managedPositions;

    // NEW: Enhanced position tracking
    uint256[] private positionIds;
    mapping(uint256 => uint256) private positionIdToIndex;

    // NEW: Target tokens and platforms
    string[] private targetTokens;
    string[] private targetPlatforms;

    // Events for tracking position lifecycle
    event PositionRegistered(uint256 indexed tokenId, address indexed nftContract);
    event PositionRemoved(uint256 indexed tokenId, address indexed nftContract);
    event TransactionExecuted(address indexed target, bytes data, bool success);
    event TokensWithdrawn(address indexed token, address indexed to, uint256 amount);
    event PositionWithdrawn(uint256 indexed tokenId, address indexed nftContract, address indexed to);
    event StrategyChanged(address indexed strategy);
    event ExecutorChanged(address indexed executor);

    // NEW: Events for token and platform updates
    event TargetTokensUpdated(string[] tokens);
    event TargetPlatformsUpdated(string[] platforms);

    /**
     * @notice Constructor
     * @param _owner Address of the vault owner
     */
    constructor(address _owner) {
        require(_owner != address(0), "PositionVault: zero owner address");
        owner = _owner;
        strategy = address(0);
        executor = address(0);
    }

    /**
     * @notice Modifier to restrict function access to the vault owner
     */
    modifier onlyOwner() {
        require(msg.sender == owner, "PositionVault: caller is not the owner");
        _;
    }

    /**
     * @notice Modifier to restrict function access to authorized callers
     */
    modifier onlyAuthorized() {
        require(
            msg.sender == owner || msg.sender == executor,
            "PositionVault: caller is not authorized"
        );
        _;
    }

    /**
     * @notice Executes a batch of transactions
     * @param targets Array of contract addresses to call
     * @param data Array of calldata to send to each target
     * @return results Array of execution success flags
     */
    function execute(address[] calldata targets, bytes[] calldata data)
        external
        onlyAuthorized
        nonReentrant
        returns (bool[] memory results)
    {
        require(targets.length == data.length, "PositionVault: length mismatch");

        results = new bool[](targets.length);

        for (uint256 i = 0; i < targets.length; i++) {
            (bool success, ) = targets[i].call(data[i]);
            results[i] = success;

            emit TransactionExecuted(targets[i], data[i], success);

            // If any transaction fails, revert the entire batch
            require(success, "PositionVault: transaction failed");
        }

        return results;
    }

    /**
     * @notice Authorizes a strategy
     * @param _strategy Address of the strategy
     */
    function setStrategy(address _strategy) external onlyOwner {
        require(_strategy != address(0), "PositionVault: zero strategy address");
        strategy = _strategy;
        emit StrategyChanged(strategy);
    }

    /**
     * @notice De-authorises a strategy
     */
    function removeStrategy() external onlyOwner {
        strategy = address(0);
        emit StrategyChanged(strategy);
    }

    /**
     * @notice Authorizes a executor
     * @param _executor Address of the executor
     */
    function setExecutor(address _executor) external onlyOwner {
        require(_executor != address(0), "PositionVault: zero executor address");
        executor = _executor;
        emit ExecutorChanged(executor);
    }

    /**
     * @notice De-authorises a executor
     */
    function removeExecutor() external onlyOwner {
        executor = address(0);
        emit ExecutorChanged(executor);
    }

    /**
     * @notice Withdraws tokens from the vault
     * @param token Address of the token to withdraw
     * @param to Address to send the tokens to
     * @param amount Amount of tokens to withdraw
     */
    function withdrawTokens(address token, address to, uint256 amount) external onlyOwner nonReentrant {
        require(token != address(0), "PositionVault: zero token address");
        require(to != address(0), "PositionVault: zero recipient address");

        IERC20(token).safeTransfer(to, amount);

        emit TokensWithdrawn(token, to, amount);
    }

    /**
     * @notice Withdraws a position NFT from the vault
     * @param nftContract Address of the NFT contract
     * @param tokenId ID of the NFT token
     * @param to Address to send the NFT to
     */
    function withdrawPosition(address nftContract, uint256 tokenId, address to) external onlyOwner nonReentrant {
        require(nftContract != address(0), "PositionVault: zero NFT contract address");
        require(to != address(0), "PositionVault: zero recipient address");
        require(managedPositions[tokenId], "PositionVault: position not managed by vault");

        // Transfer the NFT
        IERC721(nftContract).safeTransferFrom(address(this), to, tokenId);

        // Remove from tracking array with efficient swap and pop
        uint256 index = positionIdToIndex[tokenId];
        if (index < positionIds.length - 1) {
            // Not the last element - swap with last
            uint256 lastTokenId = positionIds[positionIds.length - 1];
            positionIds[index] = lastTokenId;
            positionIdToIndex[lastTokenId] = index;
        }

        // Pop last element
        positionIds.pop();

        // Clean up mappings
        delete positionIdToIndex[tokenId];
        delete managedPositions[tokenId];

        emit PositionWithdrawn(tokenId, nftContract, to);
        emit PositionRemoved(tokenId, nftContract);
    }

    /**
     * @notice Handles the receipt of an NFT
     * @dev Called by NFT contracts when safeTransferFrom is called
     */
    function onERC721Received(
        address operator,
        address from,
        uint256 tokenId,
        bytes calldata data
    ) external override returns (bytes4) {
        // Register this position in our tracking
        managedPositions[tokenId] = true;

        // Add to position tracking array
        positionIdToIndex[tokenId] = positionIds.length;
        positionIds.push(tokenId);

        emit PositionRegistered(tokenId, msg.sender);

        return this.onERC721Received.selector;
    }

    /**
     * @notice Sets the target tokens for this vault
     * @param tokens Array of token symbols to target
     */
    function setTargetTokens(string[] calldata tokens) external onlyOwner {
        delete targetTokens;

        for (uint i = 0; i < tokens.length; i++) {
            targetTokens.push(tokens[i]);
        }

        emit TargetTokensUpdated(tokens);
    }

    /**
     * @notice Sets the target platforms for this vault
     * @param platforms Array of platform IDs to target
     */
    function setTargetPlatforms(string[] calldata platforms) external onlyOwner {
        delete targetPlatforms;

        for (uint i = 0; i < platforms.length; i++) {
            targetPlatforms.push(platforms[i]);
        }

        emit TargetPlatformsUpdated(platforms);
    }

    /**
     * @notice Gets the target tokens for this vault
     * @return Array of token symbols
     */
    function getTargetTokens() external view returns (string[] memory) {
        return targetTokens;
    }

    /**
     * @notice Gets the target platforms for this vault
     * @return Array of platform IDs
     */
    function getTargetPlatforms() external view returns (string[] memory) {
        return targetPlatforms;
    }

    /**
     * @notice Gets all position IDs currently managed by this vault
     * @return Array of position IDs
     */
    function getPositionIds() external view returns (uint256[] memory) {
        return positionIds;
    }

    /**
     * @notice Allows the vault to receive ETH
     */
    receive() external payable {}

    function getVersion() external pure returns (string memory) {
        return "0.3.1";
    }
}
