<!-- Source: src/index.js, src/adapters/*, src/blockchain/*, src/helpers/*, src/services/*, src/configs/* -->
# API Reference

Detailed API documentation for fum_library modules.

> **Format note.** Each module entry below describes what the module does and lists its most commonly used exports for at-a-glance scanning. Entries are not exhaustive — follow the linked per-module doc for the complete export list. For a complete grep of every export, search the source directly (`grep -rn "^export" src/`).

## Adapters

- [PlatformAdapter](./adapters/platform-adapter.md) — Abstract base class (27 automation + 2 display + 4 optional methods)
- [AdapterFactory](./adapters/adapter-factory.md) — Factory for creating adapters by platform ID
- [UniswapV3Adapter](./adapters/uniswap-v3-adapter.md) — Uniswap V3 implementation details
- [UniswapV4Adapter](./adapters/uniswap-v4-adapter.md) — Uniswap V4 implementation details (singleton PoolManager, PoolKey, hooks)
- [TraderJoeV2_2Adapter](./adapters/traderJoe-v2-2-adapter.md) — Trader Joe V2.2 Liquidity Book (bin-based AMM)

## Blockchain

- [contracts.js](./blockchain/contracts.md) — VaultFactory and PositionVault interactions. Top exports: `getContract`, `getVaultFactory`, `createVault`, `getVaultInfo`, `executeVaultTransactions`.
- [wallet.js](./blockchain/wallet.md) — Provider creation and wallet connection. Top exports: `createWeb3Provider`, `createJsonRpcProvider`, `requestWalletConnection`, `switchChain`.

## Helpers

- [chainHelpers](./helpers/chain-helpers.md) — Chain config lookups, RPC URLs, platform addresses. Top exports: `getChainConfig`, `getChainRpcUrls`, `getPlatformAddresses`, `lookupChainPlatformIds`, `isChainSupported`.
- [tokenHelpers](./helpers/token-helpers.md) — Token lookups by symbol/address, type checks. Top exports: `getTokenBySymbol`, `getTokenByAddress`, `getTokenAddress`, `getAllTokens`, `isStablecoin`.
- [platformHelpers](./helpers/platform-helpers.md) — Platform metadata, fee tiers, tick bounds. Top exports: `getPlatformMetadata`, `getPlatformFeeTiers`, `getAvailablePlatforms`, `lookupPlatformById`.
- [strategyHelpers](./helpers/strategy-helpers.md) — Strategy templates and parameter validation. Top exports: `getStrategyDetails`, `getStrategyTemplates`, `getStrategyParameters`, `validateStrategyParams`, `getParamDefaultValues`.
- [formatHelpers](./helpers/format-helpers.md) — Display formatting. Top exports: `formatPrice`, `formatFeeDisplay`, `formatTimestamp`.
- [Permit2Helper](./helpers/permit2-helper.md) — Permit2 nonce, signature, calldata wrapping. Top exports: `PERMIT2_ADDRESS`, `getPermit2Nonce`, `generatePermit2Signature`, `wrapWithPermit2`.

## Services

- [coingecko](./services/coingecko.md) — Token prices via CoinGecko with per-token caching. Top exports: `fetchTokenPrices`, `CACHE_DURATIONS`, `clearPriceCache`, `configureCoingecko`.
- [theGraph](./services/theGraph.md) — Subgraph queries (TVL, pool age, V4 pool/position discovery). Top exports: `configureTheGraph`, `getPoolTVLAverage`, `discoverV4Pools`, `getV4PositionsByOwner`.
- [merkl](./services/merkl.md) — V4 incentive campaigns from Merkl. Top exports: `fetchPoolIncentives`, `fetchClaimData`, `clearIncentiveCache`.
- [blockExplorer](./services/blockExplorer.md) — Internal-tx and native ETH tracking via Arbiscan / Etherscan V2. Top exports: `getBlockExplorerService`.

## Configs

Static configuration — see `src/configs/` source files directly:
- `chains.js` — Chain definitions, RPC URLs, platform addresses per chain
- `platforms.js` — Platform metadata (name, color, logo, subgraphs, fee tiers)
- `strategies.js` — Strategy templates and parameter definitions
- `tokens.js` — Token lists with per-chain addresses

## Architecture Documentation

For design decisions, data shapes, and usage patterns, see:
- [Architecture Overview](../architecture/overview.md)
- [Adapters Architecture](../architecture/adapters.md) — PlatformAdapter interface, data shapes, automation flows
- [Helpers Architecture](../architecture/helpers.md) — Helper function tables per module
- [Services Architecture](../architecture/services.md) — CoinGecko, The Graph, block explorer details
- [Blockchain Architecture](../architecture/blockchain.md) — Provider management, contract interactions
