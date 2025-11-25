// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/interfaces/IERC1271.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title PositionVault
 * @notice User-controlled vault for managing DeFi positions across platforms
 * @dev Holds tokens and NFT positions, executing transactions approved by the owner
 */
contract PositionVault is IERC721Receiver, ReentrancyGuard, IERC1271 {
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;

    // EIP-1271 magic value for valid signatures
    bytes4 constant internal MAGICVALUE = 0x1626ba7e;

    // Vault owner with full control
    address public owner;

    // Strategy contract storing vault parameters
    address public strategy;

    // Wallet authorized to execute transactions
    address public executor;

    // Uniswap Universal Router address (chain-specific, immutable)
    // Used for validating swap recipient in execute()
    address public immutable universalRouter;

    // Target tokens and platforms
    string[] private targetTokens;
    string[] private targetPlatforms;

    // Events
    event TransactionExecuted(address indexed target, bytes data, bool success);
    event TokensWithdrawn(address indexed token, address indexed to, uint256 amount);
    event PositionWithdrawn(uint256 indexed tokenId, address indexed nftContract, address indexed to);
    event StrategyChanged(address indexed strategy);
    event ExecutorChanged(address indexed executor, bool indexed isAuthorized);

    // Events for token and platform updates
    event TargetTokensUpdated(string[] tokens);
    event TargetPlatformsUpdated(string[] platforms);

    /**
     * @notice Constructor
     * @param _owner Address of the vault owner
     * @param _universalRouter Address of Uniswap Universal Router for this chain
     */
    constructor(address _owner, address _universalRouter) {
        require(_owner != address(0), "PositionVault: zero owner address");
        require(_universalRouter != address(0), "PositionVault: zero router address");
        owner = _owner;
        universalRouter = _universalRouter;
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
     * @notice Executes swaps via supported routers with security validation
     * @dev Validates swap commands and recipients based on the target router
     * @param targets Array of router addresses to call
     * @param data Array of calldata to send to each router
     * @return results Array of success flags for each swap
     *
     * Supported routers:
     * - Universal Router: V2/V3 swaps with recipient validation
     *
     * Unknown routers will revert.
     */
    function swap(address[] calldata targets, bytes[] calldata data)
        external
        onlyAuthorized
        nonReentrant
        returns (bool[] memory results)
    {
        require(targets.length == data.length, "PositionVault: length mismatch");

        results = new bool[](targets.length);

        for (uint256 i = 0; i < targets.length; i++) {
            // Validate based on router type
            if (targets[i] == universalRouter) {
                _validateUniversalRouterSwap(data[i]);
            } else {
                revert("PositionVault: unsupported router");
            }

            (bool success, ) = targets[i].call(data[i]);
            results[i] = success;

            emit TransactionExecuted(targets[i], data[i], success);

            require(success, "PositionVault: swap failed");
        }

        return results;
    }

    /**
     * @notice Validates Universal Router swap commands
     * @dev Only allows V2/V3 swap commands and PERMIT2_PERMIT; blocks everything else
     * @param data The calldata being sent to the Universal Router
     *
     * Allowed commands:
     * - V3_SWAP_EXACT_IN (0x00): Validate recipient = vault
     * - V3_SWAP_EXACT_OUT (0x01): Validate recipient = vault
     * - V2_SWAP_EXACT_IN (0x08): Validate recipient = vault
     * - V2_SWAP_EXACT_OUT (0x09): Validate recipient = vault
     * - PERMIT2_PERMIT (0x0a): Allowed (no recipient concern)
     * All other commands are blocked.
     */
    function _validateUniversalRouterSwap(bytes calldata data) internal view {
        require(data.length >= 4, "PositionVault: invalid calldata");

        // Decode the calldata (skip 4-byte selector)
        (bytes memory commands, bytes[] memory inputs, ) = abi.decode(
            data[4:],
            (bytes, bytes[], uint256)
        );

        for (uint256 i = 0; i < commands.length; i++) {
            uint8 command = uint8(commands[i]);

            // V3_SWAP_EXACT_IN (0x00) or V3_SWAP_EXACT_OUT (0x01)
            if (command == 0x00 || command == 0x01) {
                (address recipient, , , , ) = abi.decode(
                    inputs[i],
                    (address, uint256, uint256, bytes, bool)
                );
                require(
                    recipient == address(this),
                    "PositionVault: swap recipient must be vault"
                );
            }
            // V2_SWAP_EXACT_IN (0x08) or V2_SWAP_EXACT_OUT (0x09)
            else if (command == 0x08 || command == 0x09) {
                (address recipient, , , , ) = abi.decode(
                    inputs[i],
                    (address, uint256, uint256, address[], bool)
                );
                require(
                    recipient == address(this),
                    "PositionVault: swap recipient must be vault"
                );
            }
            // PERMIT2_PERMIT (0x0a) - allowed, no recipient validation needed
            else if (command == 0x0a) {
                // Allowed
            }
            // All other commands are blocked
            else {
                revert("PositionVault: command not allowed");
            }
        }
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
        emit ExecutorChanged(_executor, true);
    }

    /**
     * @notice De-authorises a executor
     */
    function removeExecutor() external onlyOwner {
        emit ExecutorChanged(executor, false);
        executor = address(0);
    }

    /**
     * @notice Withdraws tokens from the vault to the owner
     * @param token Address of the token to withdraw
     * @param amount Amount of tokens to withdraw
     */
    function withdrawTokens(address token, uint256 amount) external onlyAuthorized nonReentrant {
        require(token != address(0), "PositionVault: zero token address");

        IERC20(token).safeTransfer(owner, amount);

        emit TokensWithdrawn(token, owner, amount);
    }

    /**
     * @notice Withdraws a position NFT from the vault to the owner
     * @param nftContract Address of the NFT contract
     * @param tokenId ID of the NFT token
     */
    function withdrawPosition(address nftContract, uint256 tokenId) external onlyAuthorized nonReentrant {
        require(nftContract != address(0), "PositionVault: zero NFT contract address");

        // Transfer the NFT to owner
        IERC721(nftContract).safeTransferFrom(address(this), owner, tokenId);

        emit PositionWithdrawn(tokenId, nftContract, owner);
    }

    /**
     * @notice Handles the receipt of an NFT
     * @dev Required for safeTransferFrom compatibility
     */
    function onERC721Received(
        address /*operator*/,
        address /*from*/,
        uint256 /*tokenId*/,
        bytes calldata /*data*/
    ) external pure override returns (bytes4) {
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
     * @notice Gets the target tokens for this vault
     * @return Array of token symbols
     */
    function getTargetTokens() external view returns (string[] memory) {
        return targetTokens;
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
     * @notice Gets the target platforms for this vault
     * @return Array of platform IDs
     */
    function getTargetPlatforms() external view returns (string[] memory) {
        return targetPlatforms;
    }

    /**
     * @notice Validates signatures for Permit2 and other protocols (EIP-1271)
     * @dev Allows owner or executor to sign on behalf of the vault
     * @param hash Hash of the data that was signed
     * @param signature Signature to validate
     * @return magicValue Returns 0x1626ba7e if valid, reverts otherwise
     */
    function isValidSignature(
        bytes32 hash,
        bytes calldata signature
    ) external view override returns (bytes4 magicValue) {
        // Recover the signer from the signature
        address signer = hash.recover(signature);

        // Accept signatures from owner or executor
        require(
            signer == owner || signer == executor,
            "PositionVault: invalid signer"
        );

        return MAGICVALUE;
    }

    /**
     * @notice Allows the vault to receive ETH
     */
    receive() external payable {}

    function getVersion() external pure returns (string memory) {
        return "0.4.2";
    }
}
