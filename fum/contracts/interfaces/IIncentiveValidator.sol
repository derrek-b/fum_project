// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * @title IIncentiveValidator
 * @notice Interface for incentive operation validation contracts
 * @dev Validators are called by PositionVault before executing incentive transactions
 *      (e.g., claiming rewards from Merkl, staking/unstaking NFTs).
 *      Each incentive protocol needs its own validator implementation.
 */
interface IIncentiveValidator {
    /**
     * @notice Validates incentive calldata before execution
     * @param data The calldata being sent to the incentive contract
     * @param vault The vault address (for recipient validation)
     * @dev Must revert if validation fails. Validation should ensure:
     *      - Only allowed functions are called
     *      - Recipients/beneficiaries are the vault
     *      - No unauthorized fund transfers can occur
     */
    function validateIncentive(bytes calldata data, address vault) external view;
}
