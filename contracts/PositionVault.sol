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
    // Used for validating swap recipient in swap()
    address public immutable universalRouter;

    // Permit2 contract address (chain-specific, immutable)
    // Used for gasless token approvals in swaps
    address public immutable permit2;

    // Uniswap NonfungiblePositionManager address (chain-specific, immutable)
    // Used for liquidity operations
    address public immutable nonfungiblePositionManager;

    // Target tokens and platforms
    string[] private targetTokens;
    string[] private targetPlatforms;

    // Events
    // txType: "any" (execute), "swap", "approval", "mint", "addliq", "subliq", "collect", "burn"
    event TransactionExecuted(address indexed target, bytes data, bool success, string txType);
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
     * @param _permit2 Address of Permit2 contract for this chain
     * @param _nonfungiblePositionManager Address of Uniswap NonfungiblePositionManager for this chain
     */
    constructor(
        address _owner,
        address _universalRouter,
        address _permit2,
        address _nonfungiblePositionManager
    ) {
        require(_owner != address(0), "PositionVault: zero owner address");
        require(_universalRouter != address(0), "PositionVault: zero router address");
        require(_permit2 != address(0), "PositionVault: zero permit2 address");
        require(_nonfungiblePositionManager != address(0), "PositionVault: zero position manager address");
        owner = _owner;
        universalRouter = _universalRouter;
        permit2 = _permit2;
        nonfungiblePositionManager = _nonfungiblePositionManager;
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
     * @notice Executes a batch of arbitrary transactions (owner only)
     * @dev Used for owner-initiated actions like strategy configuration
     *      Executor cannot use this function - use specific functions instead
     * @param targets Array of contract addresses to call
     * @param data Array of calldata to send to each target
     * @return results Array of execution success flags
     */
    function execute(address[] calldata targets, bytes[] calldata data)
        external
        onlyOwner
        nonReentrant
        returns (bool[] memory results)
    {
        require(targets.length == data.length, "PositionVault: length mismatch");

        results = new bool[](targets.length);

        for (uint256 i = 0; i < targets.length; i++) {
            (bool success, ) = targets[i].call(data[i]);
            results[i] = success;

            emit TransactionExecuted(targets[i], data[i], success, "any");

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

            emit TransactionExecuted(targets[i], data[i], success, "swap");

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
     * @notice Approves spenders to spend vault tokens
     * @dev Only allows approval to known DeFi protocol addresses (Permit2, NonfungiblePositionManager)
     *      Decodes the spender from ERC20.approve calldata for validation
     * @param targets Array of token addresses to approve
     * @param data Array of encoded ERC20.approve(spender, amount) calls
     * @return results Array of success flags for each approval
     */
    function approve(address[] calldata targets, bytes[] calldata data)
        external
        onlyAuthorized
        nonReentrant
        returns (bool[] memory results)
    {
        require(targets.length == data.length, "PositionVault: length mismatch");

        results = new bool[](targets.length);

        for (uint256 i = 0; i < targets.length; i++) {
            require(targets[i] != address(0), "PositionVault: zero token address");
            require(data[i].length >= 68, "PositionVault: invalid approval data");

            // Validate selector is approve(address,uint256) = 0x095ea7b3
            bytes4 selector = bytes4(data[i][:4]);
            require(selector == 0x095ea7b3, "PositionVault: not an approve call");

            // Decode spender from ERC20.approve calldata (skip 4-byte selector)
            (address spender, ) = abi.decode(data[i][4:], (address, uint256));

            require(
                spender == permit2 || spender == nonfungiblePositionManager,
                "PositionVault: invalid spender"
            );

            (bool success, ) = targets[i].call(data[i]);
            results[i] = success;

            emit TransactionExecuted(targets[i], data[i], success, "approval");

            require(success, "PositionVault: approval failed");
        }

        return results;
    }

    /**
     * @notice Mints new liquidity positions via NonfungiblePositionManager
     * @dev Only allows mint calls to the hardcoded NonfungiblePositionManager address
     *      Validates that the recipient of the minted NFT is the vault
     * @param targets Array of target addresses (must all be nonfungiblePositionManager)
     * @param data Array of encoded mint calls
     * @return results Array of success flags for each operation
     *
     * MintParams recipient is at offset 292 (4-byte selector + 9 * 32-byte params)
     */
    function mint(address[] calldata targets, bytes[] calldata data)
        external
        onlyAuthorized
        nonReentrant
        returns (bool[] memory results)
    {
        require(targets.length == data.length, "PositionVault: length mismatch");

        results = new bool[](targets.length);

        for (uint256 i = 0; i < targets.length; i++) {
            require(
                targets[i] == nonfungiblePositionManager,
                "PositionVault: invalid target"
            );

            // Validate mint call: selector 0x88316456, recipient at offset 292
            require(data[i].length >= 356, "PositionVault: invalid mint data");
            bytes4 selector = bytes4(data[i][:4]);
            require(selector == 0x88316456, "PositionVault: not a mint call");
            address recipient = abi.decode(data[i][292:324], (address));
            require(recipient == address(this), "PositionVault: mint recipient must be vault");

            (bool success, ) = targets[i].call(data[i]);
            results[i] = success;

            emit TransactionExecuted(targets[i], data[i], success, "mint");

            require(success, "PositionVault: mint failed");
        }

        return results;
    }

    /**
     * @notice Increases liquidity in existing positions via NonfungiblePositionManager
     * @dev Only allows increaseLiquidity calls to the hardcoded NonfungiblePositionManager address
     * @param targets Array of target addresses (must all be nonfungiblePositionManager)
     * @param data Array of encoded increaseLiquidity calls
     * @return results Array of success flags for each operation
     */
    function increaseLiquidity(address[] calldata targets, bytes[] calldata data)
        external
        onlyAuthorized
        nonReentrant
        returns (bool[] memory results)
    {
        require(targets.length == data.length, "PositionVault: length mismatch");

        results = new bool[](targets.length);

        for (uint256 i = 0; i < targets.length; i++) {
            require(
                targets[i] == nonfungiblePositionManager,
                "PositionVault: invalid target"
            );

            // Validate selector is increaseLiquidity(IncreaseLiquidityParams) = 0x219f5d17
            require(data[i].length >= 4, "PositionVault: invalid calldata");
            bytes4 selector = bytes4(data[i][:4]);
            require(selector == 0x219f5d17, "PositionVault: not an increaseLiquidity call");

            (bool success, ) = targets[i].call(data[i]);
            results[i] = success;

            emit TransactionExecuted(targets[i], data[i], success, "addliq");

            require(success, "PositionVault: increaseLiquidity failed");
        }

        return results;
    }

    /**
     * @notice Decreases liquidity and collects tokens from positions via NonfungiblePositionManager
     * @dev Only allows multicall to the hardcoded NonfungiblePositionManager address
     *      Validates that inner collect() calls have the vault as recipient
     * @param targets Array of target addresses (must all be nonfungiblePositionManager)
     * @param data Array of encoded multicall data (batching decreaseLiquidity + collect)
     * @return results Array of success flags for each operation
     *
     * Only allows multicall (0xac9650d8) containing:
     * - decreaseLiquidity (0x0c49ccbe): No recipient validation needed
     * - collect (0xfc6f7865): Validates recipient = vault (offset 36)
     */
    function decreaseLiquidity(address[] calldata targets, bytes[] calldata data)
        external
        onlyAuthorized
        nonReentrant
        returns (bool[] memory results)
    {
        require(targets.length == data.length, "PositionVault: length mismatch");

        results = new bool[](targets.length);

        for (uint256 i = 0; i < targets.length; i++) {
            require(
                targets[i] == nonfungiblePositionManager,
                "PositionVault: invalid target"
            );

            // Validate multicall selector (0xac9650d8)
            require(data[i].length >= 4, "PositionVault: invalid calldata");
            bytes4 selector = bytes4(data[i][:4]);
            require(selector == 0xac9650d8, "PositionVault: must be multicall");

            // Validate each inner call
            bytes[] memory innerCalls = abi.decode(data[i][4:], (bytes[]));
            for (uint256 j = 0; j < innerCalls.length; j++) {
                bytes memory innerCall = innerCalls[j];
                require(innerCall.length >= 4, "PositionVault: invalid inner calldata");

                bytes4 innerSelector;
                assembly {
                    innerSelector := mload(add(innerCall, 32))
                }

                // decreaseLiquidity (0x0c49ccbe) - allowed
                if (innerSelector == 0x0c49ccbe) {
                    continue;
                }
                // collect (0xfc6f7865) - validate recipient
                if (innerSelector == 0xfc6f7865) {
                    require(innerCall.length >= 68, "PositionVault: invalid collect data");
                    address recipient;
                    assembly {
                        recipient := mload(add(innerCall, 68))
                    }
                    require(recipient == address(this), "PositionVault: collect recipient must be vault");
                    continue;
                }
                // All other selectors blocked
                revert("PositionVault: function not allowed in multicall");
            }

            (bool success, ) = targets[i].call(data[i]);
            results[i] = success;

            emit TransactionExecuted(targets[i], data[i], success, "subliq");

            require(success, "PositionVault: decreaseLiquidity failed");
        }

        return results;
    }

    /**
     * @notice Collects fees from positions via NonfungiblePositionManager
     * @dev Only allows collect calls to the hardcoded NonfungiblePositionManager address
     *      Validates that collect recipient is the vault
     * @param targets Array of target addresses (must all be nonfungiblePositionManager)
     * @param data Array of encoded collect calls
     * @return results Array of success flags for each operation
     *
     * CollectParams recipient is at offset 36 (4-byte selector + 32-byte tokenId)
     */
    function collect(address[] calldata targets, bytes[] calldata data)
        external
        onlyAuthorized
        nonReentrant
        returns (bool[] memory results)
    {
        require(targets.length == data.length, "PositionVault: length mismatch");

        results = new bool[](targets.length);

        for (uint256 i = 0; i < targets.length; i++) {
            require(
                targets[i] == nonfungiblePositionManager,
                "PositionVault: invalid target"
            );

            // Validate collect call: selector 0xfc6f7865, recipient at offset 36
            require(data[i].length >= 68, "PositionVault: invalid collect data");
            bytes4 selector = bytes4(data[i][:4]);
            require(selector == 0xfc6f7865, "PositionVault: not a collect call");
            address recipient = abi.decode(data[i][36:68], (address));
            require(recipient == address(this), "PositionVault: collect recipient must be vault");

            (bool success, ) = targets[i].call(data[i]);
            results[i] = success;

            emit TransactionExecuted(targets[i], data[i], success, "collect");

            require(success, "PositionVault: collect failed");
        }

        return results;
    }

    /**
     * @notice Burns empty position NFTs via NonfungiblePositionManager
     * @dev Only allows burn(uint256) calls to the hardcoded NonfungiblePositionManager address
     *      Position must have 0 liquidity and 0 owed tokens to burn
     * @param targets Array of target addresses (must all be nonfungiblePositionManager)
     * @param data Array of encoded burn calls
     * @return results Array of success flags for each operation
     */
    function burn(address[] calldata targets, bytes[] calldata data)
        external
        onlyAuthorized
        nonReentrant
        returns (bool[] memory results)
    {
        require(targets.length == data.length, "PositionVault: length mismatch");

        results = new bool[](targets.length);

        for (uint256 i = 0; i < targets.length; i++) {
            require(
                targets[i] == nonfungiblePositionManager,
                "PositionVault: invalid target"
            );

            // Validate that this is actually a burn call
            require(data[i].length >= 4, "PositionVault: invalid calldata");
            bytes4 selector = bytes4(data[i][:4]);
            // burn(uint256) selector = 0x42966c68
            require(selector == 0x42966c68, "PositionVault: not a burn call");

            (bool success, ) = targets[i].call(data[i]);
            results[i] = success;

            emit TransactionExecuted(targets[i], data[i], success, "burn");

            require(success, "PositionVault: burn failed");
        }

        return results;
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
