// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title StrategyBase
 * @dev Abstract base contract for liquidity management strategies
 * Provides common functionality: vault authorization, template selection, customization tracking
 */
abstract contract StrategyBase is Ownable {
    // ==================== Events ====================
    event ParameterUpdated(address indexed vault, string paramName);
    event TemplateSelected(address indexed vault, uint8 template);
    event CustomizationUpdated(address indexed vault, uint256 bitmap);
    event VaultAuthorized(address indexed vault, bool authorized);

    // ==================== Authorization ====================
    /// @notice Mapping to track vaults that can modify their own parameters
    mapping(address => bool) public authorizedVaults;

    /// @notice Modifier to ensure caller is an authorized vault
    modifier onlyAuthorizedVault() {
        require(authorizedVaults[msg.sender], "StrategyBase: caller is not an authorized vault");
        _;
    }

    /// @notice Authorize a vault to use this strategy (only vault owner can call)
    /// @param vault Address of the vault to authorize
    function authorizeVault(address vault) external {
        require(vault != address(0), "StrategyBase: zero vault address");

        // Verify caller is the vault owner
        (bool success, bytes memory data) = vault.staticcall(abi.encodeWithSignature("owner()"));
        require(success && data.length == 32, "StrategyBase: failed to get vault owner");
        address vaultOwner = abi.decode(data, (address));
        require(msg.sender == vaultOwner, "StrategyBase: caller is not vault owner");

        authorizedVaults[vault] = true;
        emit VaultAuthorized(vault, true);
    }

    /// @notice Deauthorize a vault (only vault owner can call)
    /// @param vault Address of the vault to deauthorize
    function deauthorizeVault(address vault) external {
        // Verify caller is the vault owner
        (bool success, bytes memory data) = vault.staticcall(abi.encodeWithSignature("owner()"));
        require(success && data.length == 32, "StrategyBase: failed to get vault owner");
        address vaultOwner = abi.decode(data, (address));
        require(msg.sender == vaultOwner, "StrategyBase: caller is not vault owner");

        authorizedVaults[vault] = false;
        emit VaultAuthorized(vault, false);
    }

    // ==================== Template Selection ====================
    /// @notice Selected template for each vault (0 = None/Custom)
    mapping(address => uint8) public selectedTemplate;

    /// @notice Bitmap tracking which parameters have been customized (1 = customized, 0 = use template)
    mapping(address => uint256) public customizationBitmap;

    /// @notice Select a template for the calling vault
    /// @param template Template ID to select (0 = None)
    function selectTemplate(uint8 template) external onlyAuthorizedVault {
        selectedTemplate[msg.sender] = template;

        // Clear customization bitmap if selecting a non-None template
        if (template != 0) {
            customizationBitmap[msg.sender] = 0;
        }

        emit TemplateSelected(msg.sender, template);
    }

    /// @notice Reset customizations to revert to template defaults
    function resetToTemplate() external {
        customizationBitmap[msg.sender] = 0;

        emit ParameterUpdated(msg.sender, "resetToTemplate");
        emit CustomizationUpdated(msg.sender, 0);
    }

    /// @notice Reset all parameters and template selection
    function resetAll() external {
        selectedTemplate[msg.sender] = 0;
        customizationBitmap[msg.sender] = 0;

        emit TemplateSelected(msg.sender, 0);
        emit ParameterUpdated(msg.sender, "resetAll");
        emit CustomizationUpdated(msg.sender, 0);
    }

    // ==================== Helpers ====================
    /// @notice Check if a parameter bit is customized for a vault
    /// @param vault Address of the vault
    /// @param bit Bit position to check
    /// @return True if the parameter is customized
    function _isCustomized(address vault, uint256 bit) internal view returns (bool) {
        return (customizationBitmap[vault] & (1 << bit)) != 0;
    }

    /// @notice Mark parameter bits as customized and emit event
    /// @param bits Bitmask of bits to set
    function _markCustomized(uint256 bits) internal {
        customizationBitmap[msg.sender] |= bits;
        emit CustomizationUpdated(msg.sender, customizationBitmap[msg.sender]);
    }

    // ==================== Abstract Functions ====================
    /// @notice Get all parameters for a vault as ABI-encoded bytes
    /// @dev Must be implemented by concrete strategies
    /// @param vault Address of the vault
    /// @return ABI-encoded parameters (strategy-specific structure)
    function getAllParameters(address vault) external view virtual returns (bytes memory);
}
