<!-- Source: fum_library/src/configs/chains.js, fum_automation/src/utils/patchProviderFeeData.js -->
# Chain Gas Fee Models

How EIP-1559 fees work on each supported chain and why we override ethers.js v5's defaults.

## The Problem: ethers.js v5 Hardcodes 1.5 gwei Priority Fee

ethers.js v5's `getFeeData()` hardcodes `maxPriorityFeePerGas: 1,500,000,000` (1.5 gwei). It never calls `eth_maxPriorityFeePerGas` RPC. This was designed for Ethereum mainnet where tips go to block builders and 1.5 gwei was a reasonable default.

On Arbitrum and Avalanche, actual priority fees are 0 and ~0.000001 gwei respectively. The 1.5 gwei default inflates gas costs ~300x in Hardhat fork tests (Hardhat charges the full amount because it runs standard EIP-1559 EVM, not chain-specific fee logic).

**Fix:** `patchProviderFeeData()` in `fum_automation/src/utils/patchProviderFeeData.js` overrides `provider.getFeeData` using per-chain values from `fum_library/src/configs/chains.js` (`maxPriorityFeePerGas` property). Applied at every provider creation site.

**Source code reference:** ethers.js v5 `packages/abstract-provider/src.ts/index.ts` — `getFeeData()` hardcodes `maxPriorityFeePerGas = BigNumber.from("1500000000")`. User-provided values ARE respected (the fast path in `resolveProperties` skips `getFeeData` entirely when both `maxFeePerGas` and `maxPriorityFeePerGas` are provided).

## Arbitrum

**Fee model:** EIP-1559 base fee only. The sequencer orders transactions first-come-first-served (FCFS) — priority fees are accepted but completely ignored for ordering. The base fee is the sole determinant of transaction cost.

**Real network values** (measured via RPC, block ~437699817):
- `eth_baseFee`: ~0.02 gwei (20,000,000 wei/gas)
- `eth_maxPriorityFeePerGas`: `0x0` (0 wei/gas)
- `eth_gasPrice`: ~0.02 gwei (equals base fee since priority is 0)

**Config value:** `maxPriorityFeePerGas: "0"` (chains 42161, 1337)

**Key details:**
- Sequencer is a single entity (Offchain Labs) that orders by arrival time, not by tip
- ArbOS has custom gas pricing that doesn't match standard EIP-1559 adjustments
- Hardhat's `initialBaseFeePerGas` config is ignored when forking (base fee comes from the forked block)
- Hardhat fork base fee drifts down from real values (~0.02 → ~0.005 gwei) because empty test blocks trigger EIP-1559's -12.5% base fee reduction per block

## Avalanche C-Chain

**Fee model:** EIP-1559 with tips, but both base fee and priority fee are burned. Validators are compensated through staking rewards, not transaction tips. Priority fees exist for EIP-1559 protocol compatibility and are used for transaction ordering, but the economic incentive to tip is near-zero.

**Real network values** (measured via RPC):
- `eth_baseFee`: ~0.018 gwei (18,617,949 wei/gas)
- `eth_maxPriorityFeePerGas`: `0x3e8` (1000 wei/gas = 0.000001 gwei)
- `eth_gasPrice`: ~0.018 gwei

**Config value:** `maxPriorityFeePerGas: "1000"` (chains 43114, 1338)

**Key details:**
- `maxPriorityFeePerGas` value is in **wei per unit of gas** (same unit as Ethereum EIP-1559)
- 1000 wei/gas adds 0.004% to a 0.025 gwei base fee — completely negligible
- Avalanche uses `nAVAX` as the community name for gwei (1 nAVAX = 1 gwei = 10^9 wei)
- Minimum base fee can go as low as 1 nAVAX (1 gwei)
- Under congestion, SnowScan gas tracker shows priority rising to ~0.025 nAVAX for "rapid" tier

## maxFeePerGas Calculation

Both chains use the same formula (matching ethers.js v5's own default logic):

```
maxFeePerGas = lastBaseFeePerGas * 2 + maxPriorityFeePerGas
```

The `* 2` is fee slippage protection — a ceiling, not the actual price paid. The base fee can increase up to 12.5% per block, so doubling it gives the transaction room to survive several consecutive blocks of base fee increases. The effective price at inclusion is always `baseFee + min(maxPriorityFeePerGas, maxFeePerGas - baseFee)`.

## Gas Profiling (Executor Balances)

Measured via Hardhat fork tests running full rebalance cycles (close → swap → mint/create):

**Uniswap V3 (Arbitrum):** 822,827 gas total
- Close position: 184k
- Swap: 196k
- Mint: 442k

**Trader Joe V2.2 (Avalanche):** 5,410,379 gas total
- Close position: 1.4M
- Approvals: 65k
- Swap: 275k
- Create position: 3.7M

**Executor balance thresholds** (derived from above, sized for worst-case gas spikes):
- Arbitrum: min=0.002 ETH, max=0.004 ETH (~12/24 worst-case rebalances at 200 gwei spike)
- Avalanche: min=0.04 AVAX, max=0.08 AVAX (~13/26 worst-case rebalances at 565 nAVAX spike)

These values are configured as `minExecutorBalance`/`maxExecutorBalance` in chain config. See `docs/decisions/per-vault-signer.md` for the gas distribution design.
