/**
 * @module services/merkl
 * @description Merkl API service for incentive campaign detection and reward claiming
 */

// src/services/merkl.js

const API_BASE_URL = 'https://api.merkl.xyz/v4';

// Cache for pool incentives: { 'chainId:poolId': { data, timestamp } }
const incentiveCache = {};
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Build headers for Merkl API requests
 * @returns {Object} Headers object
 */
function buildHeaders() {
  return { 'Accept': 'application/json' };
}

/**
 * Fetch active incentive campaigns for a Uniswap V4 pool
 *
 * Queries the Merkl opportunities endpoint filtered for Uniswap V4 campaigns,
 * then matches by poolId (bytes32 direct comparison).
 *
 * Results are cached for 5 minutes since campaigns don't change frequently.
 *
 * @param {number} chainId - Chain ID (e.g., 42161 for Arbitrum)
 * @param {string} poolId - V4 pool identifier (bytes32 hash)
 * @returns {Promise<Object>} Incentive status
 * @returns {boolean} result.active - Whether any incentive programs are currently active
 * @returns {Array<Object>} result.programs - Active incentive programs
 * @returns {string} result.programs[].rewardToken - Reward token address
 * @returns {string} result.programs[].rewardTokenSymbol - Reward token symbol
 * @returns {number} result.programs[].endTimestamp - Program end timestamp (0 if ongoing)
 */
export async function fetchPoolIncentives(chainId, poolId) {
  if (!chainId || !poolId) {
    throw new Error('chainId and poolId are required');
  }

  const cacheKey = `${chainId}:${poolId.toLowerCase()}`;
  const now = Date.now();

  // Check cache
  const cached = incentiveCache[cacheKey];
  if (cached && (now - cached.timestamp) < CACHE_TTL_MS) {
    return cached.data;
  }

  try {
    const url = `${API_BASE_URL}/opportunities?chainId=${chainId}&mainProtocolId=uniswap&type=UNISWAP_V4&campaigns=true`;
    const response = await fetch(url, { headers: buildHeaders() });

    if (!response.ok) {
      throw new Error(`Merkl API returned ${response.status}`);
    }

    const opportunities = await response.json();

    // Find the opportunity matching our poolId (case-insensitive bytes32 comparison)
    // API returns the poolId as `identifier` at the opportunity level
    const normalizedPoolId = poolId.toLowerCase();
    const matchingOpp = Array.isArray(opportunities)
      ? opportunities.find(opp => opp.identifier && opp.identifier.toLowerCase() === normalizedPoolId)
      : null;

    if (!matchingOpp || !matchingOpp.campaigns || matchingOpp.campaigns.length === 0) {
      const result = { active: false, programs: [] };
      incentiveCache[cacheKey] = { data: result, timestamp: now };
      return result;
    }

    // Filter to active campaigns only (endTimestamp > now or ongoing with 0)
    const nowSeconds = Math.floor(now / 1000);
    const activeCampaigns = matchingOpp.campaigns.filter(campaign => {
      return campaign.endTimestamp > nowSeconds;
    });

    const programs = activeCampaigns.map(campaign => ({
      rewardToken: campaign.rewardToken.address,
      rewardTokenSymbol: campaign.rewardToken.symbol,
      endTimestamp: campaign.endTimestamp,
    }));

    const result = {
      active: programs.length > 0,
      programs,
    };

    incentiveCache[cacheKey] = { data: result, timestamp: now };
    return result;
  } catch (error) {
    throw new Error(`Failed to fetch Merkl pool incentives for chain ${chainId}, pool ${poolId}: ${error.message}`);
  }
}

/**
 * Fetch claim data for a user's unclaimed Merkl rewards
 *
 * Queries the Merkl rewards endpoint for pending rewards with Merkle proofs,
 * then transforms the response into the shape needed by the Distributor's
 * claim(address user, address[] tokens, uint256[] amounts, bytes32[][] proofs).
 *
 * Not cached since reward data changes with each Merkle root update.
 *
 * @param {number} chainId - Chain ID
 * @param {string} userAddress - Vault/user address to check claims for
 * @returns {Promise<Object|null>} Claim data or null if nothing to claim
 * @returns {string} result.user - User address
 * @returns {Array<string>} result.tokens - Reward token addresses
 * @returns {Array<string>} result.amounts - Cumulative claimable amounts (total earned, not just pending)
 * @returns {Array<Array<string>>} result.proofs - Merkle proofs per token
 */
export async function fetchClaimData(chainId, userAddress) {
  if (!chainId || !userAddress) {
    throw new Error('chainId and userAddress are required');
  }

  try {
    const url = `${API_BASE_URL}/users/${userAddress}/rewards?chainId=${chainId}`;
    const response = await fetch(url, { headers: buildHeaders() });

    if (!response.ok) {
      throw new Error(`Merkl rewards API returned ${response.status}`);
    }

    const data = await response.json();

    // Response is an array of chain objects, each with a rewards array
    // Find the entry for our chain and extract rewards with pending > 0
    const chainEntry = Array.isArray(data)
      ? data.find(entry => entry.chain && entry.chain.id === chainId)
      : null;

    if (!chainEntry || !chainEntry.rewards || chainEntry.rewards.length === 0) {
      return null;
    }

    const pendingRewards = chainEntry.rewards.filter(r => r.pending !== '0');

    if (pendingRewards.length === 0) {
      return null;
    }

    // Transform into the shape needed for the Distributor's claim() function
    return {
      user: userAddress,
      tokens: pendingRewards.map(r => r.token.address),
      amounts: pendingRewards.map(r => r.amount),
      proofs: pendingRewards.map(r => r.proofs),
    };
  } catch (error) {
    throw new Error(`Failed to fetch Merkl claim data for chain ${chainId}, user ${userAddress}: ${error.message}`);
  }
}

/**
 * Clear the incentive cache (useful for testing)
 */
export function clearIncentiveCache() {
  Object.keys(incentiveCache).forEach(key => delete incentiveCache[key]);
}
