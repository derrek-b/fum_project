<!-- Source: fum_library/src/services/merkl.js, fum_library/src/adapters/UniswapV4Adapter.js, fum_library/src/configs/chains.js -->
# Merkl Incentive Rewards

Merkl is an off-chain incentive distribution protocol used by Uniswap V4, SushiSwap, Camelot, and others. LP positions are auto-tracked from on-chain events — no staking required.

## API Details (Verified Feb 2026)

| Detail | Value |
|--------|-------|
| Base URL | `https://api.merkl.xyz/v4` |
| Rate limit | 10 req/s default |

### Pool Incentive Detection

**Endpoint:** `GET /v4/opportunities?chainId={id}&mainProtocolId=uniswap&type=UNISWAP_V4&campaigns=true`

- Filter is `mainProtocolId=uniswap` + `type=UNISWAP_V4` (NOT `uniswap-v4`)
- Returns array of opportunity objects
- **Pool matching**: use `identifier` field (bytes32 poolId), case-insensitive comparison
- Each opportunity has a `campaigns` array

**Opportunity response structure (verified Feb 2026):**
```json
[{
  "chainId": 42161,
  "type": "UNISWAP_V4",
  "identifier": "0xab05003a...",
  "name": "Provide liquidity to Uniswap USDC pool",
  "status": "LIVE",
  "tvl": 12480000,
  "apr": 3.85,
  "liveCampaigns": 1,
  "campaigns": [{
    "id": "16201799440790212717",
    "campaignId": "0xb1bb19b5...",
    "type": "UNISWAP_V4",
    "startTimestamp": 1770289200,
    "endTimestamp": 1771498800,
    "dailyRewards": 1317.69,
    "apr": 3.85,
    "rewardToken": {
      "address": "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984",
      "symbol": "UNI",
      "decimals": 18,
      "price": 7.49
    },
    "params": {
      "poolId": "0xab05003a...",
      "currency0": "0xaf88d065...",
      "currency1": "0xFd086bC7...",
      "lpFee": 80,
      "hooks": "0x0000...0000"
    }
  }]
}]
```
- `identifier` is the poolId (bytes32) — match against this, NOT a `poolId` top-level field
- `rewardToken` is an **object** — use `.address` and `.symbol`
- `endTimestamp` is always a concrete integer
- Campaigns come and go — do not hardcode specific campaign IDs or timestamps in tests or if they are hardcoded expect them to go stale; note a date the campaign ends to document when a test will go stale

### Claim Data (via Rewards Endpoint)

**Endpoint:** `GET /v4/users/{address}/rewards?chainId={id}`

- The `/v4/claim` endpoint is documented but unreliable (500 errors as of Feb 2026)
- The rewards endpoint returns all the data needed to build a `claim()` transaction

**Response structure (verified):**
```json
[{
  "chain": { "id": 42161, "name": "Arbitrum", ... },
  "rewards": [{
    "recipient": "0x...",
    "amount": "40972349228106",
    "claimed": "40972349228106",
    "pending": "0",
    "proofs": ["0x37c9...", "0xa882...", ...],
    "token": { "address": "0xe50f...", "symbol": "aArbWETH", "decimals": 18, ... },
    "breakdowns": [{ "campaignId": "0x080d...", "reason": "base", ... }]
  }]
}]
```

- Array of chain entries, each with a `rewards` array
- Filter to rewards where `pending !== "0"` (string comparison)
- `amount` is cumulative total earned — this is what the Distributor's `claim()` expects
  - The contract internally tracks what's been claimed: `toSend = amount - claimed[user][token].amount`
  - This makes claiming idempotent — resubmitting the same proof is a no-op
- `proofs` are the Merkle proofs for that token
- Filter to `pending !== "0"`, then transform to `{ user, tokens[], amounts[], proofs[][] }` for the Distributor contract

## Distributor Contract

| Chain | Address |
|-------|---------|
| Arbitrum (42161) | `0x3Ef3D8bA38EBe18DB133cEc108f4D14CE00Dd9Ae` |
| Hardhat fork (1337) | Same (forked from Arbitrum) |

**Claim function:**
```solidity
function claim(address user, address[] tokens, uint256[] amounts, bytes32[][] proofs)
```
- Selector: `0xa0165082`
- `user` receives the reward tokens — must be validated as the vault address
- Idempotent: calling with the same proof again is a no-op (already claimed)

## V4 Integration Model

V4 is "auto-tracking" — Merkl monitors on-chain events to attribute LP rewards. This means:
- **No staking/unstaking** — `getIncentivePreCloseTransactions` and `getIncentivePostCreateTransactions` return `[]`
- **Claims are vault-wide** — `claim()` collects ALL unclaimed Merkl rewards for the vault, not pool-specific
- **Safe to claim anytime** — cumulative model means claiming during rebalance doesn't lose anything
