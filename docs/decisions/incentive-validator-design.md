<!-- Source: fum/contracts/interfaces/IIncentiveValidator.sol, fum/contracts/validators/MerklIncentiveValidator.sol, fum/contracts/VaultFactory.sol, fum/contracts/PositionVault.sol -->
# Decision: Separate Validator Interface for Incentive Operations

## Context

Adding incentive reward claiming (Merkl, future: V3 Staker, TJ Hooks Rewarder) to PositionVault requires calldata validation before execution. The vault already has two validator categories:

- **ISwapValidator** — gates swap router calls (1 method: `validateSwap`)
- **ILiquidityValidator** — gates position manager calls (5 methods: mint, increase, decrease, collect, burn)

Incentive claims target a different class of contract entirely (e.g., Merkl Distributor at `0x3Ef3D8bA38EBe18DB133cEc108f4D14CE00Dd9Ae`).

## Options Considered

1. **Reuse ISwapValidator** — Register Merkl Distributor as a "swap router" with a validator. Simpler but muddies semantics. Incentive claims are not swaps.

2. **Inline selector whitelist** (like `approve()`) — Hardcode allowed selectors in PositionVault. Works for Merkl's single `claim()` function. Future incentive protocols with different interfaces will need to implement different validators.

3. **New IIncentiveValidator interface** — Third validator category with its own factory mapping. Clean separation, extensible to any incentive protocol.

## Decision

Option 3: New `IIncentiveValidator` interface with a single `validateIncentive(bytes calldata data, address vault)` method.

## Why

- **Security model stays clean** — Each validator category maps to a distinct class of target contract. Factory owner registers each target with the appropriate validator type.
- **Extensible** — Adding support for V3 Staker or TJ Hooks Rewarder means deploying a new validator contract and registering it. No changes to PositionVault or VaultFactory.
- **Single method is sufficient** — Unlike liquidity operations (5 distinct flows needing separate validation), incentive operations are structurally simple (one external call per protocol).

## Implementation

- `IIncentiveValidator.sol` — interface with `validateIncentive(bytes, address)`
- `MerklIncentiveValidator.sol` — validates `claim()` selector (`0xa0165082`) and `user == vault`
- `VaultFactory.sol` — `incentiveValidators` mapping, `setIncentiveValidator()`, `validateIncentive()`
- `PositionVault.sol` — `incentive(targets, data, values)` function following `swap()` pattern

## Adding a New Validator (Checklist)

When adding support for a new incentive protocol:

1. **Contract**: Create `contracts/validators/XxxIncentiveValidator.sol` implementing `IIncentiveValidator`
2. **Pipeline — sync**: Add to `VALIDATOR_CONTRACTS` in `fum/scripts/sync-contracts-to-ecosystem.js`
3. **Pipeline — ABIs**: Add to contracts map in `fum/scripts/extract-abis.js`
4. **Pipeline — bytecode**: Add to `VALIDATORS_TO_EXTRACT` in `fum/scripts/extract-bytecode.js`
5. **Test infra — deploy**: Deploy in `fum_library/test/setup/test-contracts.js` via `deployContract()`
6. **Test infra — register**: Call `vaultFactory.setIncentiveValidator(targetAddress, validatorAddress)`
7. **Test infra — address**: Add to `addresses` object and `mapContractName()` in test-contracts.js
8. **Chain config**: Add target contract address to `fum_library/src/configs/chains.js` if not already there
