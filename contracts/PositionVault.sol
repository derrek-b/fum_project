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

    // Authorized strategies that can send transaction batches
    mapping(address => bool) public authorizedStrategies;

    // Positions managed by this vault
    mapping(uint256 => bool) public managedPositions;

    // Events for tracking position lifecycle
    event PositionRegistered(uint256 indexed tokenId, address indexed nftContract);
    event PositionRemoved(uint256 indexed tokenId, address indexed nftContract);
    event TransactionExecuted(address indexed target, bytes data, bool success);
    event TokensWithdrawn(address indexed token, address indexed to, uint256 amount);
    event PositionWithdrawn(uint256 indexed tokenId, address indexed nftContract, address indexed to);
    event StrategyAuthorized(address indexed strategy, bool authorized);

    /**
     * @notice Constructor
     * @param _owner Address of the vault owner
     */
    constructor(address _owner) {
        require(_owner != address(0), "PositionVault: zero owner address");
        owner = _owner;

        // Set the deploying contract (factory) as temporarily authorized
        // This allows the factory to set initial strategy authorizations
        authorizedStrategies[msg.sender] = true;
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
            msg.sender == owner || authorizedStrategies[msg.sender],
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
     * @notice Authorizes or deauthorizes a strategy to execute transactions
     * @param strategy Address of the strategy
     * @param authorized Whether the strategy is authorized
     */
    function setStrategyAuthorization(address strategy, bool authorized) external onlyAuthorized {
        require(strategy != address(0), "PositionVault: zero strategy address");
        authorizedStrategies[strategy] = authorized;
        emit StrategyAuthorized(strategy, authorized);
    }

    /**
     * @notice Removes the temporary authorization from the factory
     * @dev Should be called by the factory at the end of vault creation
     */
    function removeFactoryAuthorization() external {
        // Only the factory that deployed this contract can call this
        require(msg.sender != owner, "PositionVault: owner cannot remove own authorization");
        authorizedStrategies[msg.sender] = false;
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

        // Update tracking
        managedPositions[tokenId] = false;

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

        emit PositionRegistered(tokenId, msg.sender);

        return this.onERC721Received.selector;
    }

    /**
     * @notice Allows the vault to receive ETH
     */
    receive() external payable {}

    function getVersion() external pure returns (string memory) {
        return "0.2.0";
    }
}
