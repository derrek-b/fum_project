// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/interfaces/IERC1271.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "./interfaces/IVaultFactory.sol";

/**
 * @dev Interface for WETH deposit/withdraw functions
 */
interface IWETH {
    function deposit() external payable;
    function withdraw(uint256 wad) external;
}

/**
 * @title PositionVault
 * @notice User-controlled vault for managing DeFi positions across platforms
 * @dev Holds tokens and NFT positions, executing transactions approved by the owner.
 *      Validates transactions via factory's centralized validator registry.
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

    // Permit2 contract address (chain-specific, immutable)
    address public immutable permit2;

    // Factory that created this vault (used for validator lookups)
    address public immutable factory;

    // Target tokens and platforms
    string[] private targetTokens;
    string[] private targetPlatforms;

    // Events
    event TransactionExecuted(address indexed target, bytes data, bool success, string txType);
    event TokensWithdrawn(address indexed token, address indexed to, uint256 amount);
    event PositionWithdrawn(uint256 indexed tokenId, address indexed nftContract, address indexed to);
    event StrategyChanged(address indexed strategy);
    event ExecutorChanged(address indexed executor, bool indexed isAuthorized);
    event TargetTokensUpdated(string[] tokens);
    event TargetPlatformsUpdated(string[] platforms);

    /**
     * @notice Constructor
     * @param _owner Address of the vault owner
     * @param _permit2 Address of Permit2 contract for this chain
     * @param _factory Address of the VaultFactory (for validator lookups)
     */
    constructor(
        address _owner,
        address _permit2,
        address _factory
    ) {
        require(_owner != address(0), "PositionVault: zero owner address");
        require(_permit2 != address(0), "PositionVault: zero permit2 address");
        require(_factory != address(0), "PositionVault: zero factory address");
        owner = _owner;
        permit2 = _permit2;
        factory = _factory;
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
        require(targets.length > 0, "PositionVault: empty batch");

        results = new bool[](targets.length);

        for (uint256 i = 0; i < targets.length; i++) {
            (bool success, ) = targets[i].call(data[i]);
            results[i] = success;

            emit TransactionExecuted(targets[i], data[i], success, "any");
            require(success, "PositionVault: transaction failed");
        }

        return results;
    }

    /**
     * @notice Executes swaps via registered routers with security validation
     * @param targets Array of router addresses to call
     * @param data Array of calldata to send to each router
     * @param values Array of ETH values to send with each call
     * @return results Array of success flags for each swap
     */
    function swap(
        address[] calldata targets,
        bytes[] calldata data,
        uint256[] calldata values
    )
        external
        onlyAuthorized
        nonReentrant
        returns (bool[] memory results)
    {
        require(targets.length == data.length, "PositionVault: length mismatch");
        require(values.length == targets.length, "PositionVault: values length mismatch");
        require(targets.length > 0, "PositionVault: empty batch");

        // Validate vault has sufficient ETH balance for native ETH swaps
        uint256 totalValue = 0;
        for (uint256 i = 0; i < values.length; i++) {
            totalValue += values[i];
        }
        require(address(this).balance >= totalValue, "PositionVault: insufficient ETH balance");

        results = new bool[](targets.length);

        for (uint256 i = 0; i < targets.length; i++) {
            // Validate via factory (reverts if no validator or validation fails)
            IVaultFactory(factory).validateSwap(targets[i], data[i], address(this));

            // Execute with value
            (bool success, ) = targets[i].call{value: values[i]}(data[i]);
            results[i] = success;

            emit TransactionExecuted(targets[i], data[i], success, "swap");
            require(success, "PositionVault: swap failed");
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
     * @notice Authorizes an executor
     * @param _executor Address of the executor
     */
    function setExecutor(address _executor) external onlyOwner {
        require(_executor != address(0), "PositionVault: zero executor address");
        executor = _executor;
        emit ExecutorChanged(_executor, true);
    }

    /**
     * @notice De-authorises an executor
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
     * @notice Withdraws native ETH from the vault to the owner
     * @param amount Amount of ETH to withdraw
     */
    function withdrawETH(uint256 amount) external onlyAuthorized nonReentrant {
        require(address(this).balance >= amount, "PositionVault: insufficient ETH balance");
        (bool success, ) = owner.call{value: amount}("");
        require(success, "PositionVault: ETH transfer failed");
        emit TokensWithdrawn(address(0), owner, amount);
    }

    /**
     * @notice Unwraps WETH to ETH and withdraws to the owner
     * @param weth Address of the WETH contract
     * @param amount Amount of WETH to unwrap and withdraw
     */
    function unwrapAndWithdrawETH(address weth, uint256 amount) external onlyAuthorized nonReentrant {
        require(weth != address(0), "PositionVault: zero WETH address");
        IWETH(weth).withdraw(amount);
        (bool success, ) = owner.call{value: amount}("");
        require(success, "PositionVault: ETH transfer failed");
        emit TokensWithdrawn(address(0), owner, amount);
    }

    /**
     * @notice Wraps native ETH to WETH (keeps WETH in vault)
     * @param weth Address of the WETH contract
     * @param amount Amount of ETH to wrap
     */
    function wrapETH(address weth, uint256 amount) external onlyAuthorized nonReentrant {
        require(weth != address(0), "PositionVault: zero WETH address");
        require(address(this).balance >= amount, "PositionVault: insufficient ETH balance");
        IWETH(weth).deposit{value: amount}();
        emit TransactionExecuted(weth, abi.encodeWithSelector(IWETH.deposit.selector), true, "wrap");
    }

    /**
     * @notice Unwraps WETH to native ETH (keeps ETH in vault)
     * @param weth Address of the WETH contract
     * @param amount Amount of WETH to unwrap
     */
    function unwrapETH(address weth, uint256 amount) external onlyAuthorized nonReentrant {
        require(weth != address(0), "PositionVault: zero WETH address");
        IWETH(weth).withdraw(amount);
        emit TransactionExecuted(weth, abi.encodeWithSelector(IWETH.withdraw.selector, amount), true, "unwrap");
    }

    /**
     * @notice Approves spenders to spend vault tokens
     * @param targets Array of token addresses to approve
     * @param data Array of encoded approve calls (ERC20 or Permit2)
     * @return results Array of success flags for each approval
     */
    function approve(address[] calldata targets, bytes[] calldata data)
        external
        onlyAuthorized
        nonReentrant
        returns (bool[] memory results)
    {
        require(targets.length == data.length, "PositionVault: length mismatch");
        require(targets.length > 0, "PositionVault: empty batch");

        results = new bool[](targets.length);

        for (uint256 i = 0; i < targets.length; i++) {
            require(targets[i] != address(0), "PositionVault: zero token address");
            require(data[i].length >= 68, "PositionVault: invalid approval data");

            bytes4 selector = bytes4(data[i][:4]);
            require(
                selector == 0x095ea7b3 || selector == 0x87517c45,
                "PositionVault: not an approve call"
            );

            (bool success, ) = targets[i].call(data[i]);
            results[i] = success;

            emit TransactionExecuted(targets[i], data[i], success, "approval");
            require(success, "PositionVault: approval failed");
        }

        return results;
    }

    /**
     * @notice Mints new liquidity positions via registered position managers
     * @param targets Array of position manager addresses to call
     * @param data Array of encoded mint calls
     * @param values Array of ETH values to send with each call (for V4 native ETH positions)
     * @return results Array of success flags for each operation
     */
    function mint(
        address[] calldata targets,
        bytes[] calldata data,
        uint256[] calldata values
    )
        external
        onlyAuthorized
        nonReentrant
        returns (bool[] memory results)
    {
        require(targets.length == data.length, "PositionVault: length mismatch");
        require(values.length == targets.length, "PositionVault: values length mismatch");
        require(targets.length > 0, "PositionVault: empty batch");

        // Validate vault has sufficient ETH balance for native ETH mints
        uint256 totalValue = 0;
        for (uint256 i = 0; i < values.length; i++) {
            totalValue += values[i];
        }
        require(address(this).balance >= totalValue, "PositionVault: insufficient ETH balance");

        results = new bool[](targets.length);

        for (uint256 i = 0; i < targets.length; i++) {
            // Validate via factory
            IVaultFactory(factory).validateMint(targets[i], data[i], address(this));

            // Execute with value for native ETH positions
            (bool success, bytes memory returnData) = targets[i].call{value: values[i]}(data[i]);
            results[i] = success;

            emit TransactionExecuted(targets[i], data[i], success, "mint");
            if (!success) {
                // Bubble up the revert reason from the position manager
                if (returnData.length > 0) {
                    assembly {
                        revert(add(returnData, 32), mload(returnData))
                    }
                } else {
                    revert("PositionVault: mint failed");
                }
            }
        }

        return results;
    }

    /**
     * @notice Increases liquidity in existing positions
     * @param targets Array of position manager addresses to call
     * @param data Array of encoded increaseLiquidity calls
     * @param values Array of ETH values to send with each call (for V4 native ETH positions)
     * @return results Array of success flags for each operation
     */
    function increaseLiquidity(
        address[] calldata targets,
        bytes[] calldata data,
        uint256[] calldata values
    )
        external
        onlyAuthorized
        nonReentrant
        returns (bool[] memory results)
    {
        require(targets.length == data.length, "PositionVault: length mismatch");
        require(values.length == targets.length, "PositionVault: values length mismatch");
        require(targets.length > 0, "PositionVault: empty batch");

        // Validate vault has sufficient ETH balance for native ETH add liquidity
        uint256 totalValue = 0;
        for (uint256 i = 0; i < values.length; i++) {
            totalValue += values[i];
        }
        require(address(this).balance >= totalValue, "PositionVault: insufficient ETH balance");

        results = new bool[](targets.length);

        for (uint256 i = 0; i < targets.length; i++) {
            // Validate via factory
            IVaultFactory(factory).validateIncreaseLiquidity(targets[i], data[i], address(this));

            // Execute with value for native ETH positions
            (bool success, bytes memory returnData) = targets[i].call{value: values[i]}(data[i]);
            results[i] = success;

            emit TransactionExecuted(targets[i], data[i], success, "addliq");
            if (!success) {
                // Bubble up the revert reason from the position manager
                if (returnData.length > 0) {
                    assembly {
                        revert(add(returnData, 32), mload(returnData))
                    }
                } else {
                    revert("PositionVault: increaseLiquidity failed");
                }
            }
        }

        return results;
    }

    /**
     * @notice Decreases liquidity and collects tokens from positions
     * @param targets Array of position manager addresses to call
     * @param data Array of encoded multicall data (batching decreaseLiquidity + collect)
     * @return results Array of success flags for each operation
     */
    function decreaseLiquidity(address[] calldata targets, bytes[] calldata data)
        external
        onlyAuthorized
        nonReentrant
        returns (bool[] memory results)
    {
        require(targets.length == data.length, "PositionVault: length mismatch");
        require(targets.length > 0, "PositionVault: empty batch");

        results = new bool[](targets.length);

        for (uint256 i = 0; i < targets.length; i++) {
            // Validate via factory
            IVaultFactory(factory).validateDecreaseLiquidity(targets[i], data[i], address(this));

            (bool success, ) = targets[i].call(data[i]);
            results[i] = success;

            emit TransactionExecuted(targets[i], data[i], success, "subliq");
            require(success, "PositionVault: decreaseLiquidity failed");
        }

        return results;
    }

    /**
     * @notice Collects fees from positions
     * @param targets Array of position manager addresses to call
     * @param data Array of encoded collect calls
     * @return results Array of success flags for each operation
     */
    function collect(address[] calldata targets, bytes[] calldata data)
        external
        onlyAuthorized
        nonReentrant
        returns (bool[] memory results)
    {
        require(targets.length == data.length, "PositionVault: length mismatch");
        require(targets.length > 0, "PositionVault: empty batch");

        results = new bool[](targets.length);

        for (uint256 i = 0; i < targets.length; i++) {
            // Validate via factory
            IVaultFactory(factory).validateCollect(targets[i], data[i], address(this));

            (bool success, ) = targets[i].call(data[i]);
            results[i] = success;

            emit TransactionExecuted(targets[i], data[i], success, "collect");
            require(success, "PositionVault: collect failed");
        }

        return results;
    }

    /**
     * @notice Burns empty position NFTs
     * @param targets Array of position manager addresses to call
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
        require(targets.length > 0, "PositionVault: empty batch");

        results = new bool[](targets.length);

        for (uint256 i = 0; i < targets.length; i++) {
            // Validate via factory
            IVaultFactory(factory).validateBurn(targets[i], data[i], address(this));

            (bool success, ) = targets[i].call(data[i]);
            results[i] = success;

            emit TransactionExecuted(targets[i], data[i], success, "burn");
            require(success, "PositionVault: burn failed");
        }

        return results;
    }

    /**
     * @notice Executes incentive operations (claim rewards, stake/unstake) via registered validators
     * @param targets Array of incentive contract addresses to call (e.g., Merkl Distributor)
     * @param data Array of calldata to send to each target
     * @param values Array of ETH values to send with each call
     * @return results Array of success flags for each operation
     */
    function incentive(
        address[] calldata targets,
        bytes[] calldata data,
        uint256[] calldata values
    )
        external
        onlyAuthorized
        nonReentrant
        returns (bool[] memory results)
    {
        require(targets.length == data.length, "PositionVault: length mismatch");
        require(values.length == targets.length, "PositionVault: values length mismatch");
        require(targets.length > 0, "PositionVault: empty batch");

        // Validate vault has sufficient ETH balance
        uint256 totalValue = 0;
        for (uint256 i = 0; i < values.length; i++) {
            totalValue += values[i];
        }
        require(address(this).balance >= totalValue, "PositionVault: insufficient ETH balance");

        results = new bool[](targets.length);

        for (uint256 i = 0; i < targets.length; i++) {
            // Validate via factory (reverts if no validator or validation fails)
            IVaultFactory(factory).validateIncentive(targets[i], data[i], address(this));

            // Execute with value
            (bool success, ) = targets[i].call{value: values[i]}(data[i]);
            results[i] = success;

            emit TransactionExecuted(targets[i], data[i], success, "incentive");
            require(success, "PositionVault: incentive operation failed");
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
        IERC721(nftContract).safeTransferFrom(address(this), owner, tokenId);
        emit PositionWithdrawn(tokenId, nftContract, owner);
    }

    /**
     * @notice Handles the receipt of an NFT
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
     * @param hash Hash of the data that was signed
     * @param signature Signature to validate
     * @return magicValue Returns 0x1626ba7e if valid, reverts otherwise
     */
    function isValidSignature(
        bytes32 hash,
        bytes calldata signature
    ) external view override returns (bytes4 magicValue) {
        address signer = hash.recover(signature);
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
        return "2.0.0";
    }
}
