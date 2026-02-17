// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./PositionVault.sol";
import "./interfaces/ISwapValidator.sol";
import "./interfaces/ILiquidityValidator.sol";
import "./interfaces/IIncentiveValidator.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title VaultFactory
 * @notice Factory contract for creating vaults and managing the validator registry
 * @dev Deploys PositionVault contracts and provides centralized validator management.
 *      All vaults query this factory for validators, so adding a new platform
 *      (e.g., Uniswap V4) only requires updating the factory once.
 */
contract VaultFactory is Ownable {
    // Permit2 contract address for this chain (passed to new vaults)
    address public immutable permit2;

    // Validator registries - shared by all vaults created by this factory
    mapping(address => ISwapValidator) public swapValidators;
    mapping(address => ILiquidityValidator) public liquidityValidators;
    mapping(address => IIncentiveValidator) public incentiveValidators;

    // Mapping of user address to their vault addresses
    mapping(address => address[]) public userVaults;

    // Mapping of vault address to vault details
    struct VaultInfo {
        address owner;
        string name;
        uint256 creationTime;
        uint256 creationBlock;
    }
    mapping(address => VaultInfo) public vaultInfo;

    // Global registry of all vaults
    address[] public allVaults;

    // Events
    event VaultCreated(address indexed user, address indexed vault, string name, uint256 userVaultCount);
    event VaultNameUpdated(address indexed vault, string name);
    event SwapValidatorUpdated(address indexed router, address indexed validator);
    event LiquidityValidatorUpdated(address indexed positionManager, address indexed validator);
    event IncentiveValidatorUpdated(address indexed target, address indexed validator);

    /**
     * @notice Constructor
     * @param initialOwner The factory owner address
     * @param _permit2 Permit2 contract address for this chain
     */
    constructor(
        address initialOwner,
        address _permit2
    ) Ownable(initialOwner) {
        require(_permit2 != address(0), "VaultFactory: zero permit2 address");
        permit2 = _permit2;
    }

    // ============ Validator Registry Management ============

    /**
     * @notice Sets or updates a swap router's validator
     * @param router The router address
     * @param validator The validator contract (address(0) to remove)
     */
    function setSwapValidator(address router, ISwapValidator validator) external onlyOwner {
        swapValidators[router] = validator;
        emit SwapValidatorUpdated(router, address(validator));
    }

    /**
     * @notice Sets or updates a position manager's validator
     * @param positionManager The position manager address
     * @param validator The validator contract (address(0) to remove)
     */
    function setLiquidityValidator(address positionManager, ILiquidityValidator validator) external onlyOwner {
        liquidityValidators[positionManager] = validator;
        emit LiquidityValidatorUpdated(positionManager, address(validator));
    }

    /**
     * @notice Sets or updates an incentive contract's validator
     * @param target The incentive contract address (e.g., Merkl Distributor)
     * @param validator The validator contract (address(0) to remove)
     */
    function setIncentiveValidator(address target, IIncentiveValidator validator) external onlyOwner {
        incentiveValidators[target] = validator;
        emit IncentiveValidatorUpdated(target, address(validator));
    }

    // ============ Validation Functions (called by vaults) ============

    /**
     * @notice Validates swap calldata via the registered validator
     * @param router The router address being called
     * @param data The calldata being sent to the router
     * @param vault The vault address (for recipient validation)
     */
    function validateSwap(address router, bytes calldata data, address vault) external view {
        ISwapValidator validator = swapValidators[router];
        require(address(validator) != address(0), "VaultFactory: no validator for router");
        validator.validateSwap(data, vault);
    }

    /**
     * @notice Validates mint calldata via the registered validator
     * @param positionManager The position manager address being called
     * @param data The calldata being sent to the position manager
     * @param vault The vault address (for recipient validation)
     */
    function validateMint(address positionManager, bytes calldata data, address vault) external view {
        ILiquidityValidator validator = liquidityValidators[positionManager];
        require(address(validator) != address(0), "VaultFactory: no validator for position manager");
        validator.validateMint(data, vault);
    }

    /**
     * @notice Validates increaseLiquidity calldata via the registered validator
     * @param positionManager The position manager address being called
     * @param data The calldata being sent to the position manager
     * @param vault The vault address (for recipient validation)
     */
    function validateIncreaseLiquidity(address positionManager, bytes calldata data, address vault) external view {
        ILiquidityValidator validator = liquidityValidators[positionManager];
        require(address(validator) != address(0), "VaultFactory: no validator for position manager");
        validator.validateIncreaseLiquidity(data, vault);
    }

    /**
     * @notice Validates decreaseLiquidity calldata via the registered validator
     * @param positionManager The position manager address being called
     * @param data The calldata being sent to the position manager
     * @param vault The vault address (for recipient validation)
     */
    function validateDecreaseLiquidity(address positionManager, bytes calldata data, address vault) external view {
        ILiquidityValidator validator = liquidityValidators[positionManager];
        require(address(validator) != address(0), "VaultFactory: no validator for position manager");
        validator.validateDecreaseLiquidity(data, vault);
    }

    /**
     * @notice Validates collect calldata via the registered validator
     * @param positionManager The position manager address being called
     * @param data The calldata being sent to the position manager
     * @param vault The vault address (for recipient validation)
     */
    function validateCollect(address positionManager, bytes calldata data, address vault) external view {
        ILiquidityValidator validator = liquidityValidators[positionManager];
        require(address(validator) != address(0), "VaultFactory: no validator for position manager");
        validator.validateCollect(data, vault);
    }

    /**
     * @notice Validates burn calldata via the registered validator
     * @param positionManager The position manager address being called
     * @param data The calldata being sent to the position manager
     * @param vault The vault address (for recipient validation)
     */
    function validateBurn(address positionManager, bytes calldata data, address vault) external view {
        ILiquidityValidator validator = liquidityValidators[positionManager];
        require(address(validator) != address(0), "VaultFactory: no validator for position manager");
        validator.validateBurn(data, vault);
    }

    /**
     * @notice Validates incentive calldata via the registered validator
     * @param target The incentive contract address being called
     * @param data The calldata being sent to the incentive contract
     * @param vault The vault address (for recipient validation)
     */
    function validateIncentive(address target, bytes calldata data, address vault) external view {
        IIncentiveValidator validator = incentiveValidators[target];
        require(address(validator) != address(0), "VaultFactory: no validator for incentive target");
        validator.validateIncentive(data, vault);
    }

    // ============ Vault Creation ============

    /**
     * @notice Creates a new vault for the caller with a required name
     * @param name Name for the vault (used for identification)
     * @return vault Address of the newly created vault
     */
    function createVault(string calldata name) external returns (address vault) {
        require(bytes(name).length > 0, "VaultFactory: vault name cannot be empty");

        // Create new vault with the caller as owner
        vault = address(new PositionVault(
            msg.sender,      // owner
            permit2,         // permit2
            address(this)    // factory (for validator lookups)
        ));

        // Register vault in mappings
        userVaults[msg.sender].push(vault);

        // Store vault info
        vaultInfo[vault] = VaultInfo({
            owner: msg.sender,
            name: name,
            creationTime: block.timestamp,
            creationBlock: block.number
        });

        // Add to global registry
        allVaults.push(vault);

        emit VaultCreated(msg.sender, vault, name, userVaults[msg.sender].length);

        return vault;
    }

    // ============ Vault Registry Functions ============

    /**
     * @notice Updates the name of an existing vault
     * @param vault Address of the vault to rename
     * @param name New name for the vault
     */
    function updateVaultName(address vault, string calldata name) external {
        require(vaultInfo[vault].owner == msg.sender, "VaultFactory: not vault owner");
        require(bytes(name).length > 0, "VaultFactory: vault name cannot be empty");

        vaultInfo[vault].name = name;
        emit VaultNameUpdated(vault, name);
    }

    /**
     * @notice Gets all vaults for a user
     * @param user Address of the user
     * @return vaults Array of the user's vault addresses
     */
    function getVaults(address user) external view returns (address[] memory) {
        return userVaults[user];
    }

    /**
     * @notice Gets detailed info for a vault
     * @param vault Address of the vault
     * @return owner Owner of the vault
     * @return name Name of the vault
     * @return creationTime Timestamp when the vault was created
     * @return creationBlock Block number when the vault was created
     */
    function getVaultInfo(address vault) external view returns (
        address owner,
        string memory name,
        uint256 creationTime,
        uint256 creationBlock
    ) {
        VaultInfo memory info = vaultInfo[vault];
        return (info.owner, info.name, info.creationTime, info.creationBlock);
    }

    /**
     * @notice Gets the number of vaults owned by a user
     * @param user Address of the user
     * @return count Number of vaults
     */
    function getVaultCount(address user) external view returns (uint256) {
        return userVaults[user].length;
    }

    /**
     * @notice Gets the total number of vaults created
     * @return count Total number of vaults
     */
    function getTotalVaultCount() external view returns (uint256) {
        return allVaults.length;
    }

    /**
     * @notice Checks if an address is a valid vault and returns its owner
     * @param vault Address to check
     * @return _isVault Whether the address is a recognized vault
     * @return owner Owner of the vault (zero address if not a vault)
     */
    function isVault(address vault) external view returns (bool _isVault, address owner) {
        owner = vaultInfo[vault].owner;
        _isVault = owner != address(0);
        return (_isVault, owner);
    }

    function getVersion() external pure returns (string memory) {
        return "2.0.0";
    }
}
