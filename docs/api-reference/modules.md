# FUM Library Module Reference

This document provides a comprehensive reference of all modules, their files, imports, and exports.

Generated on: 2025-06-24T19:06:27.317Z

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
- from `../configs/chains.js`
- from `./UniswapV3Adapter.js`

**Exports:**
- default: `AdapterFactory` (class)

---

### index.js

Adapter system for DeFi platforms

**Path:** `src/adapters/index.js`

**Exports:**
- `getAdaptersForChain` (variable)
- `getAdapter` (variable)
- `getSupportedPlatforms` (variable)
- `registerAdapter` (variable)
- `PlatformAdapter` (class) (from `./PlatformAdapter.js`)
- `UniswapV3Adapter` (class) (from `./UniswapV3Adapter.js`)
- `AdapterFactory` (class) (from `./AdapterFactory.js`)

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
- from `../helpers/formatHelpers.js`
- from `./PlatformAdapter.js`
- from `@openzeppelin/contracts/build/contracts/ERC20.json`
- from `@uniswap/sdk-core`
- from `@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Pool.sol/IUniswapV3Pool.json`
- from `@uniswap/v3-periphery/artifacts/contracts/NonfungiblePositionManager.sol/NonfungiblePositionManager.json`
- from `@uniswap/v3-periphery/artifacts/contracts/SwapRouter.sol/SwapRouter.json`
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
- `getContract` (function)
- `getVaultContract` (function)
- `getVaultFactory` (function)
- `getBatchExecutor` (function)
- `getVaultFactoryAddress` (function)
- `getBatchExecutorAddress` (function)

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
- from `ethers`

**Exports:**
- `createJsonRpcProvider` (function)

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

**Imports:**
- from `../helpers/tokenHelpers.js`

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
- `getChainConfig` (function)
- `getChainName` (function)
- `getChainRpcUrl` (function)
- `getExecutorAddress` (function)
- `isChainSupported` (function)
- `getSupportedChainIds` (function)
- `getPlatformAddresses` (function)
- `getChainPlatformIds` (function)

---

### formatHelpers.js

@module helpers/formatHelpers

**Path:** `src/helpers/formatHelpers.js`

**Exports:**
- `formatPrice` (function)
- `formatUnits` (function)
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
- re-exports from `./vaultHelpers.js`

---

### platformHelpers.js

@module helpers/platformHelpers

**Path:** `src/helpers/platformHelpers.js`

**Imports:**
- from `../configs/platforms.js`
- from `./chainHelpers.js`

**Exports:**
- `getPlatformMetadata` (function)
- `getPlatformName` (function)
- `getPlatformColor` (function)
- `getPlatformLogo` (function)
- `getAvailablePlatforms` (function)
- `getPlatformById` (function)
- `platformSupportsTokens` (function)
- `getSupportedPlatformIds` (function)

---

### strategyHelpers.js

@module helpers/strategyHelpers

**Path:** `src/helpers/strategyHelpers.js`

**Imports:**
- from `../configs/strategies.js`

**Exports:**
- `getAvailableStrategies` (function)
- `getStrategyDetails` (function)
- `getStrategyTemplates` (function)
- `getTemplateDefaults` (function)
- `getDefaultParams` (function)
- `getStrategyParameters` (function)
- `getStrategyParametersByGroup` (function)
- `getParametersByContractGroup` (function)
- `validateStrategyParams` (function)
- `getParameterSetterMethod` (function)
- `shouldShowParameter` (function)
- `getAllStrategyIds` (function)
- `strategySupportsTokens` (function)
- `formatParameterValue` (function)
- `validateTokensForStrategy` (function)

---

### tokenHelpers.js

@module helpers/tokenHelpers

**Path:** `src/helpers/tokenHelpers.js`

**Imports:**
- from `../configs/tokens.js`

**Exports:**
- `getAllTokens` (function)
- `getTokenBySymbol` (function)
- `getTokenAddress` (function)
- `getStablecoins` (function)
- `areTokensSupportedOnChain` (function)
- `getTokenByAddress` (function)
- `registerToken` (function)
- `getTokensForChain` (function)
- `getAllTokenSymbols` (function)
- `getTokensByType` (function)

---

### vaultHelpers.js

@module helpers/vaultHelpers

**Path:** `src/helpers/vaultHelpers.js`

**Imports:**
- from `../adapters/index.js`
- from `../artifacts/contracts.js`
- from `../blockchain/index.js`
- from `../services/index.js`
- from `./strategyHelpers.js`
- from `./tokenHelpers.js`
- from `@openzeppelin/contracts/build/contracts/ERC20.json`
- from `ethers`

**Exports:**
- `mapStrategyParameters` (variable)
- `fetchStrategyParameters` (variable)
- `getVaultStrategies` (variable)
- `getVaultBasicInfo` (variable)
- `getVaultTokenBalances` (variable)
- `getVaultPositions` (variable)
- `calculatePositionsTVL` (variable)
- `getVaultData` (variable)
- `getAllUserVaultData` (variable)

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
- re-exports from `./configs/index.js`
- re-exports from `./adapters/index.js`

---

## services Module

### coingecko.js

@module services/coingecko

**Path:** `src/services/coingecko.js`

**Exports:**
- `configureCoingecko` (function)
- `getCoingeckoId` (function)
- `registerTokenMapping` (function)
- `calculateUsdValueSync` (function)
- `getPriceCache` (function)
- `clearPriceCache` (function)
- `isConfigured` (function)
- `setApiKey` (function)

---

### index.js

**Path:** `src/services/index.js`

**Exports:**
- re-exports from `./coingecko.js`

---

