<!-- Source: src/index.js, src/adapters/*, src/blockchain/*, src/helpers/*, src/services/*, src/configs/* -->
# API Reference

Detailed API documentation for fum_library modules.

## Module Reference

- [Module Reference](./modules.md) — Auto-generated list of all files, imports, and exports (`npm run docs` to regenerate)

## Adapters

- [PlatformAdapter](./adapters/platform-adapter.md) — Abstract base class (27 required + 4 optional methods)
- [AdapterFactory](./adapters/adapter-factory.md) — Factory for creating adapters by platform ID
- [UniswapV3Adapter](./adapters/uniswap-v3-adapter.md) — Uniswap V3 implementation details

## Blockchain

- [contracts.js](./blockchain/contracts.md) — getContract, getVaultFactory, createVault, getVaultContract, getUserVaults, getVaultInfo, executeVaultTransactions, getAuthorizedVaults, getContractInfoByAddress
- [wallet.js](./blockchain/wallet.md) — createWeb3Provider, createJsonRpcProvider, getConnectedAccounts, requestWalletConnection, getChainId, switchChain

## Helpers

- [chainHelpers](./helpers/chain-helpers.md) — getChainConfig, getChainRpcUrls, getPlatformAddresses, lookupChainPlatformIds, getExecutorAddress
- [tokenHelpers](./helpers/token-helpers.md) — getTokenBySymbol, getTokenByAddress, getTokenAddress, getAllTokens, getCoingeckoId, isStablecoin, isNativeToken
- [platformHelpers](./helpers/platform-helpers.md) — getPlatformMetadata, getPlatformFeeTiers, getAvailablePlatforms, lookupPlatformById
- [strategyHelpers](./helpers/strategy-helpers.md) — lookupStrategyById, validateStrategyParams, getDefaultStrategyParams
- [formatHelpers](./helpers/format-helpers.md) — formatPrice, formatFeeDisplay, formatTimestamp
- [Permit2Helper](./helpers/permit2-helper.md) — getPermit2Nonce, generatePermit2Signature, wrapWithPermit2

## Services

- [coingecko](./services/coingecko.md) — fetchTokenPrices, CACHE_DURATIONS, buildApiUrl, clearPriceCache
- [theGraph](./services/theGraph.md) — getPoolTVLAverage, getPoolAge, discoverV4Pools, getV4PositionsByOwner

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
