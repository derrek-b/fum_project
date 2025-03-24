// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./PositionVault.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title VaultFactory
 * @notice Factory contract for creating and tracking user position vaults
 * @dev Deploys new PositionVault contracts and maintains a registry of them
 */
contract VaultFactory is Ownable {
    // Mapping of user address to their vault addresses
    mapping(address => address[]) public userVaults;

    // Mapping of vault address to vault details
    struct VaultInfo {
        address owner;
        string name;
        uint256 creationTime;
    }
    mapping(address => VaultInfo) public vaultInfo;

    // Global registry of all vaults
    address[] public allVaults;

    // Whitelisted strategies that can be automatically authorized for new vaults
    mapping(address => bool) public whitelistedStrategies;
    address[] private whitelistedStrategyList;

    // Events
    event VaultCreated(address indexed user, address indexed vault, string name, uint256 userVaultCount);
    event VaultNameUpdated(address indexed vault, string name);
    event StrategyWhitelisted(address indexed strategy, bool whitelisted);

    /**
     * @notice Constructor
     * @param initialOwner The factory owner address
     */
    constructor(address initialOwner) Ownable(initialOwner) {}

    /**
     * @notice Creates a new vault for the caller with a required name
     * @param name Name for the vault (used for identification)
     * @return vault Address of the newly created vault
     */
    function createVault(string calldata name) external returns (address vault) {
        require(bytes(name).length > 0, "VaultFactory: vault name cannot be empty");

        // Create new vault with the caller as owner
        vault = address(new PositionVault(msg.sender));

        // Register vault in mappings
        userVaults[msg.sender].push(vault);

        // Store vault info
        vaultInfo[vault] = VaultInfo({
            owner: msg.sender,
            name: name,
            creationTime: block.timestamp
        });

        // Add to global registry
        allVaults.push(vault);

        // Auto-authorize whitelisted strategies
        PositionVault positionVault = PositionVault(payable(vault));
        for (uint i = 0; i < whitelistedStrategyList.length; i++) {
            address strategy = whitelistedStrategyList[i];
            if (whitelistedStrategies[strategy]) {
                positionVault.setStrategyAuthorization(strategy, true);
            }
        }

        // Remove factory's temporary authorization
        positionVault.removeFactoryAuthorization();

        emit VaultCreated(msg.sender, vault, name, userVaults[msg.sender].length);

        return vault;
    }

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
     */
    function getVaultInfo(address vault) external view returns (
        address owner,
        string memory name,
        uint256 creationTime
    ) {
        VaultInfo memory info = vaultInfo[vault];
        return (info.owner, info.name, info.creationTime);
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
     * @return isVault Whether the address is a recognized vault
     * @return owner Owner of the vault (zero address if not a vault)
     */
    function isVault(address vault) external view returns (bool isVault, address owner) {
        owner = vaultInfo[vault].owner;
        isVault = owner != address(0);
        return (isVault, owner);
    }

    /**
     * @notice Whitelists or dewhitelists a strategy for auto-authorization in new vaults
     * @param strategy Address of the strategy
     * @param whitelisted Whether the strategy is whitelisted
     */
    function setStrategyWhitelisting(address strategy, bool whitelisted) external onlyOwner {
        require(strategy != address(0), "VaultFactory: zero strategy address");

        // Update whitelist status
        bool currentStatus = whitelistedStrategies[strategy];
        whitelistedStrategies[strategy] = whitelisted;

        // Add to or remove from the list if status changed
        if (whitelisted && !currentStatus) {
            whitelistedStrategyList.push(strategy);
        } else if (!whitelisted && currentStatus) {
            // Remove from list - find index and replace with last element, then pop
            for (uint i = 0; i < whitelistedStrategyList.length; i++) {
                if (whitelistedStrategyList[i] == strategy) {
                    whitelistedStrategyList[i] = whitelistedStrategyList[whitelistedStrategyList.length - 1];
                    whitelistedStrategyList.pop();
                    break;
                }
            }
        }

        emit StrategyWhitelisted(strategy, whitelisted);
    }

    /**
     * @notice Gets all whitelisted strategies
     * @return strategies Array of whitelisted strategy addresses
     */
    function getWhitelistedStrategies() external view returns (address[] memory) {
        return whitelistedStrategyList;
    }

    function getVersion() external pure returns (string memory) {
        return "0.2.1";
    }
}
