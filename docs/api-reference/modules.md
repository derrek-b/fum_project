# FUM Library Module Reference

This document provides a comprehensive reference of all modules, their files, imports, and exports.

Generated on: 2025-11-18T19:07:11.676Z

## Table of Contents

- [adapters Module](#adapters-module)
- [artifacts Module](#artifacts-module)
- [blockchain Module](#blockchain-module)
- [configs Module](#configs-module)
- [helpers Module](#helpers-module)
- [Root Module](#root-module)
- [services Module](#services-module)

---

## adapters Module

### AdapterFactory.js

@module adapters/AdapterFactory

**Path:** `src/adapters/AdapterFactory.js`

**Imports:**
- from `../helpers/chainHelpers.js`
- from `./UniswapV3Adapter.js`

**Exports:**
- default: `AdapterFactory` (class)

---

### index.js

Adapter system for DeFi platforms

**Path:** `src/adapters/index.js`

**Imports:**
- from `./AdapterFactory.js`

**Exports:**
- `getAdaptersForChain` (variable)
- `getAdapter` (variable)
- `getSupportedPlatforms` (variable)
- `registerAdapter` (variable)
- `PlatformAdapter` (class) (from `./PlatformAdapter.js`)
- `UniswapV3Adapter` (class) (from `./UniswapV3Adapter.js`)

---

### PlatformAdapter.js

Base class for DeFi platform adapters.

**Path:** `src/adapters/PlatformAdapter.js`

**Exports:**
- default: `PlatformAdapter` (class)

---

### UniswapV3Adapter.js

UniswapV3Adapter - Uniswap V3 Protocol Integration

**Path:** `src/adapters/UniswapV3Adapter.js`

**Imports:**
- from `../helpers/chainHelpers.js`
- from `../helpers/platformHelpers.js`
- from `../helpers/tokenHelpers.js`
- from `./PlatformAdapter.js`
- from `@openzeppelin/contracts/build/contracts/ERC20.json`
- from `@uniswap/sdk-core`
- from `@uniswap/smart-order-router`
- from `@uniswap/universal-router-sdk`
- from `@uniswap/universal-router/artifacts/contracts/UniversalRouter.sol/UniversalRouter.json`
- from `@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Pool.sol/IUniswapV3Pool.json`
- from `@uniswap/v3-periphery/artifacts/contracts/NonfungiblePositionManager.sol/NonfungiblePositionManager.json`
- from `@uniswap/v3-periphery/artifacts/contracts/SwapRouter.sol/SwapRouter.json`
- from `@uniswap/v3-periphery/artifacts/contracts/lens/QuoterV2.sol/QuoterV2.json`
- from `@uniswap/v3-sdk`
- from `ethers`
- from `jsbi`

**Exports:**
- default: `UniswapV3Adapter` (class)

---

## artifacts Module

### contracts.js

Contract ABIs and addresses for the F.U.M. project

**Path:** `src/artifacts/contracts.js`

**Exports:**
- default: `contracts` (other)

---

## blockchain Module

### contracts.js

@module blockchain/contracts

**Path:** `src/blockchain/contracts.js`

**Imports:**
- from `../artifacts/contracts.js`
- from `ethers`

**Exports:**
- `getVaultFactoryAddress` (function)
- `getVaultContract` (function)
- `getContractInfoByAddress` (function)

---

### index.js

Blockchain Module - Ethereum Interaction Utilities

**Path:** `src/blockchain/index.js`

**Exports:**
- re-exports from `./wallet.js`
- re-exports from `./contracts.js`

---

### wallet.js

@module blockchain/wallet

**Path:** `src/blockchain/wallet.js`

**Imports:**
- from `../helpers/chainHelpers.js`
- from `ethers`

---

## configs Module

### chains.js

Chain configuration for F.U.M. project

**Path:** `src/configs/chains.js`

**Exports:**
- default: `chains` (other)

---

### index.js

**Path:** `src/configs/index.js`

**Exports:**
- re-exports from `./chains.js`
- re-exports from `./platforms.js`
- re-exports from `./strategies.js`
- re-exports from `./tokens.js`

---

### platforms.js

Platform configuration for F.U.M. project

**Path:** `src/configs/platforms.js`

**Exports:**
- default: `platforms` (other)

---

### strategies.js

Strategy configuration with templates and parameters

**Path:** `src/configs/strategies.js`

**Exports:**
- default: `strategies` (other)

---

### tokens.js

Token configuration with addresses on multiple chains

**Path:** `src/configs/tokens.js`

**Exports:**
- default: `tokens` (other)

---

## helpers Module

### chainHelpers.js

@module helpers/chainHelpers

**Path:** `src/helpers/chainHelpers.js`

**Imports:**
- from `../configs/chains.js`

**Exports:**
- `validateChainId` (function)
- `getChainConfig` (function)
- `getChainName` (function)
- `getChainRpcUrls` (function)
- `getExecutorAddress` (function)
- `isChainSupported` (function)
- `lookupSupportedChainIds` (function)
- `getPlatformAddresses` (function)
- `lookupChainPlatformIds` (function)
- `getMinDeploymentForGas` (function)

---

### formatHelpers.js

@module helpers/formatHelpers

**Path:** `src/helpers/formatHelpers.js`

**Exports:**
- `formatPrice` (function)
- `formatFeeDisplay` (function)
- `formatTimestamp` (function)

---

### index.js

**Path:** `src/helpers/index.js`

**Exports:**
- re-exports from `./chainHelpers.js`
- re-exports from `./platformHelpers.js`
- re-exports from `./tokenHelpers.js`
- re-exports from `./strategyHelpers.js`
- re-exports from `./formatHelpers.js`

---

### platformHelpers.js

@module helpers/platformHelpers

**Path:** `src/helpers/platformHelpers.js`

**Imports:**
- from `../configs/platforms.js`
- from `./chainHelpers.js`

**Exports:**
- `validateChainId` (function)
- `validatePlatformId` (function)
- `getPlatformMetadata` (function)
- `getPlatformName` (function)
- `getPlatformColor` (function)
- `getPlatformLogo` (function)
- `lookupSupportedPlatformIds` (function)
- `getMinLiquidityAmount` (function)
- `getPlatformFeeTiers` (function)
- `getPlatformTickSpacing` (function)
- `getPlatformTickBounds` (function)
- `getAvailablePlatforms` (function)
- `lookupPlatformById` (function)

---

### strategyHelpers.js

@module helpers/strategyHelpers

**Path:** `src/helpers/strategyHelpers.js`

**Imports:**
- from `../configs/strategies.js`
- from `./tokenHelpers.js`
- from `ethers`

**Exports:**
- `validateIdString` (function)
- `lookupAllStrategyIds` (function)
- `lookupAvailableStrategies` (function)
- `getStrategyDetails` (function)
- `getStrategyTemplates` (function)
- `getTemplateDefaults` (function)
- `getParamDefaultValues` (function)
- `getStrategyParameters` (function)
- `getStrategyParametersByGroup` (function)
- `getStrategyParametersByContractGroup` (function)
- `validateStrategyParams` (function)
- `getParameterSetterMethod` (function)
- `shouldShowParameter` (function)
- `getStrategyTokens` (function)
- `strategySupportsTokens` (function)
- `formatParameterValue` (function)
- `validateTokensForStrategy` (function)
- `validatePositionsForStrategy` (function)
- `mapStrategyParameters` (function)
- `getMinDeploymentMultiplier` (function)

---

### tokenHelpers.js

@module helpers/tokenHelpers

**Path:** `src/helpers/tokenHelpers.js`

**Imports:**
- from `../configs/tokens.js`

**Exports:**
- `getAllTokenSymbols` (function)
- `getAllTokens` (function)
- `getStablecoins` (function)
- `getTokensByChain` (function)
- `isStablecoin` (function)
- `detectStablePair` (function)
- `getTokenBySymbol` (function)
- `getTokensBySymbol` (function)
- `getTokenByAddress` (function)
- `getTokensByType` (function)
- `getTokenAddress` (function)
- `getTokenAddresses` (function)
- `areTokensSupportedOnChain` (function)
- `validateTokensExist` (function)
- `getCoingeckoId` (function)

---

## Root Module

### index.js

FUM Library - Main Entry Point

**Path:** `src/index.js`

**Imports:**
- from `dotenv`
- from `path`
- from `url`

**Exports:**
- re-exports from `./helpers/index.js`
- re-exports from `./adapters/index.js`
- re-exports from `./blockchain/index.js`
- re-exports from `./services/index.js`

---

## services Module

### coingecko.js

@module services/coingecko

**Path:** `src/services/coingecko.js`

**Imports:**
- from `../helpers/tokenHelpers.js`

**Exports:**
- `ENDPOINTS` (variable)
- `CACHE_DURATIONS` (variable)
- `priceCache` (variable)
- `buildApiUrl` (function)
- `clearPriceCache` (function)

---

### index.js

**Path:** `src/services/index.js`

**Exports:**
- re-exports from `./coingecko.js`
- re-exports from `./theGraph.js`

---

### theGraph.js

@module services/theGraph

**Path:** `src/services/theGraph.js`

**Imports:**
- from `../helpers/platformHelpers.js`

---

