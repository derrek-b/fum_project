<!-- Source: src/utils/patchProviderFeeData.js -->
# patchProviderFeeData API

**Source:** `src/utils/patchProviderFeeData.js`

Overrides ethers.js v5's hardcoded 1.5 gwei `maxPriorityFeePerGas`. Without this patch, gas costs on Arbitrum and Avalanche are ~300x too high (especially on Hardhat forks).

## Function

### patchProviderFeeData(provider, chainId)

Monkey-patches `provider.getFeeData()` to use per-chain priority fee config from `fum_library/helpers/chainHelpers.getMaxPriorityFeePerGas()`.

| Param | Type | Description |
|---|---|---|
| `provider` | `ethers.providers.BaseProvider` | Provider to patch |
| `chainId` | `number` | Chain ID for config lookup |

**Per-chain values** (from `fum_library/configs/chains.js`):
- **Arbitrum (42161)**: `"0"` — sequencer is FCFS, ignores tips
- **Avalanche (43114)**: `"1000"` — 1000 wei/gas, near-zero

**Patched formula**:
- `maxPriorityFeePerGas` = chain config value
- `maxFeePerGas` = `lastBaseFeePerGas × 2 + maxPriorityFeePerGas`

Called by `AutomationService.initialize()` after provider creation.
