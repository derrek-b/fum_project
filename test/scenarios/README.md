# Test Scenario Configuration

This directory contains JSON configuration files for creating custom test scenarios without writing code.

## Quick Start

### Run an Existing Scenario

```bash
# Run with default scenario
npm test test/workflow/service-init/BS-configurable

# Run with specific scenario
SCENARIO=test/scenarios/1111.json npm test test/workflow/service-init/BS-configurable
```

### Create Your Own Scenario

1. Copy `default.json` to create a new scenario file
2. Modify the configuration (see structure below)
3. Run your scenario:
   ```bash
   SCENARIO=test/scenarios/my-scenario.json npm test test/workflow/service-init/BS-configurable
   ```

## Scenario File Structure

```json
{
  "name": "My Test Scenario",
  "description": "Brief description of what this tests",
  "port": 8550,
  "vaultSetup": {
    "vaultName": "My Test Vault",
    "wrapEthAmount": "10",
    "swapTokens": [...],
    "positions": [...],
    "tokenTransfers": {...},
    "targetTokens": [...],
    "targetPlatforms": [...]
  }
}
```

### Top-Level Fields

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Display name for the test scenario |
| `description` | string | Brief explanation of what this scenario tests |
| `port` | number | Ganache server port (use unique port per scenario to avoid conflicts) |
| `vaultSetup` | object | Vault configuration (see below) |

### Vault Setup Configuration

#### Basic Settings

```json
{
  "vaultName": "My Test Vault",
  "wrapEthAmount": "10"
}
```

- **vaultName**: Display name for the test vault
- **wrapEthAmount**: Amount of ETH to wrap to WETH (string, in ETH units)

#### Token Swaps

Initial swaps to acquire test tokens:

```json
{
  "swapTokens": [
    { "from": "WETH", "to": "USDC", "amount": "2" },
    { "from": "WETH", "to": "WBTC", "amount": "1" }
  ]
}
```

Each swap object:
- **from**: Source token symbol
- **to**: Destination token symbol
- **amount**: Amount to swap (string, in token units)

#### Positions

Define Uniswap V3 positions to create:

```json
{
  "positions": [
    {
      "token0": "USDC",
      "token1": "WETH",
      "fee": 500,
      "percentOfAssets": 20,
      "tickRange": {
        "type": "centered",
        "spacing": 10
      }
    }
  ]
}
```

Position object fields:
- **token0**: First token symbol
- **token1**: Second token symbol
- **fee**: Pool fee tier (100 = 0.01%, 500 = 0.05%, 3000 = 0.3%, 10000 = 1%)
- **percentOfAssets**: Percentage of available tokens to use (0-100)
- **tickRange**: Tick range configuration (see below)

##### Tick Range Types

**Centered** - Position includes current tick (in range):
```json
{
  "type": "centered",
  "spacing": 10
}
```
- `spacing`: Number of tick spacings ± from current tick

**Above** - Position entirely above current tick (out of range, 100% token0):
```json
{
  "type": "above"
}
```

**Below** - Position entirely below current tick (out of range, 100% token1):
```json
{
  "type": "below"
}
```

**Close to Boundary** - In range but too close to lower boundary (will trigger rebalance):
```json
{
  "type": "close-to-boundary"
}
```

**Off-Center** - In range but current tick is not centered (25% of range):
```json
{
  "type": "off-center",
  "spacing": 10
}
```

**Custom** - Specify exact tick values:
```json
{
  "type": "custom",
  "tickLower": -192600,
  "tickUpper": -191600
}
```

#### Token Transfers

Percentage of remaining tokens to transfer to vault:

```json
{
  "tokenTransfers": {
    "USDC": 60,
    "WETH": 40,
    "WBTC": 30
  }
}
```

- Key: Token symbol
- Value: Percentage (0-100) of remaining balance to transfer

#### Target Configuration

```json
{
  "targetTokens": ["USDC", "WETH"],
  "targetPlatforms": ["uniswapV3"]
}
```

- **targetTokens**: Array of token symbols the vault should target
- **targetPlatforms**: Array of platform identifiers (currently only "uniswapV3")

#### Fee Generating Swaps (Optional)

Execute swaps to generate fees on positions:

```json
{
  "feeGeneratingSwaps": [
    {
      "pool": { "token0": "WBTC", "token1": "WETH", "fee": 500 },
      "swaps": [
        { "from": "WETH", "to": "WBTC", "amount": "1" },
        { "from": "WBTC", "to": "WETH", "amount": "0.05" }
      ]
    }
  ]
}
```

## Example Scenarios

### Simple Aligned Scenario

One position with matching tokens:

```json
{
  "name": "Simple Aligned",
  "description": "1 aligned position, vault holds target tokens",
  "port": 8550,
  "vaultSetup": {
    "vaultName": "Simple Aligned Test",
    "wrapEthAmount": "10",
    "swapTokens": [
      { "from": "WETH", "to": "USDC", "amount": "2" }
    ],
    "positions": [
      {
        "token0": "USDC",
        "token1": "WETH",
        "fee": 500,
        "percentOfAssets": 20,
        "tickRange": { "type": "centered", "spacing": 10 }
      }
    ],
    "tokenTransfers": {
      "USDC": 60,
      "WETH": 60
    },
    "targetTokens": ["USDC", "WETH"],
    "targetPlatforms": ["uniswapV3"]
  }
}
```

### Non-Aligned Migration Scenario

Positions and tokens don't match targets (requires migration):

```json
{
  "name": "Non-Aligned Migration",
  "description": "WBTC positions and tokens, targeting USDC/WETH",
  "port": 8551,
  "vaultSetup": {
    "vaultName": "Migration Test",
    "wrapEthAmount": "10",
    "swapTokens": [
      { "from": "WETH", "to": "WBTC", "amount": "2" }
    ],
    "positions": [
      {
        "token0": "WBTC",
        "token1": "WETH",
        "fee": 500,
        "percentOfAssets": 20,
        "tickRange": { "type": "above" }
      }
    ],
    "tokenTransfers": {
      "WBTC": 40
    },
    "targetTokens": ["USDC", "WETH"],
    "targetPlatforms": ["uniswapV3"]
  }
}
```

## Pre-Made Scenarios

| File | Description |
|------|-------------|
| `default.json` | Simple 1-position aligned scenario |
| `0202.json` | 0 Aligned Positions, 2 Non-aligned, 0 Aligned Tokens, 2 Non-aligned |
| `1111.json` | 1 Aligned Position, 1 Non-aligned, 1 Aligned Token, 1 Non-aligned |
| `2020.json` | 2 Aligned Positions, 0 Non-aligned, 2 Aligned Tokens, 0 Non-aligned |

## Tips

1. **Unique Ports**: Each scenario should use a unique port to avoid conflicts when running tests in parallel
2. **Port Ranges**: Use 8550-8599 for custom scenarios
3. **Token Amounts**: Use string values for all amounts to avoid floating point precision issues
4. **Position Percentages**: Sum of all position percentages typically shouldn't exceed 80% to leave tokens for vault
5. **Testing**: Start simple with default.json, then gradually add complexity

## Current Limitations

- Only tests initialization success/failure (no detailed assertions yet)
- Limited to Baby Steps strategy
- Limited to Uniswap V3 platform
- Cannot specify block numbers or timestamps

## Future Enhancements

- Configurable test assertions
- Multiple vault scenarios
- Time-based scenarios (rebalancing triggers)
- Custom event expectations
