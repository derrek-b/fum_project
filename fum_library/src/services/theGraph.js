/**
 * @module services/theGraph
 * @description The Graph Protocol service for pool TVL data
 */

import { getPlatformMetadata } from '../helpers/platformHelpers.js';

// API configuration
const API_BASE_URL = 'https://gateway-arbitrum.network.thegraph.com/api';

// Module-level configuration (set via configureTheGraph)
let _config = {
  apiKey: null,
};

/**
 * Configure The Graph service
 * @param {Object} options - Configuration options
 * @param {string} [options.apiKey] - The Graph API key for authenticated requests
 * @example
 * import { configureTheGraph } from 'fum_library/services/theGraph';
 * configureTheGraph({ apiKey: process.env.THE_GRAPH_API_KEY });
 */
export function configureTheGraph({ apiKey } = {}) {
  if (apiKey !== undefined) {
    _config.apiKey = apiKey;
  }
}

/**
 * Reset configuration to defaults (for testing purposes)
 */
export function resetTheGraphConfig() {
  _config = {
    apiKey: null,
  };
}

/**
 * Execute GraphQL query against subgraph
 * @private
 * @param {string} subgraphId - Subgraph ID
 * @param {string} query - GraphQL query
 * @param {Object} variables - Query variables
 * @returns {Promise<Object>} Query response
 */
async function executeQuery(subgraphId, query, variables = {}) {
  if (!_config.apiKey) {
    throw new Error('The Graph API key not configured. Call configureTheGraph({ apiKey }) or initFumLibrary({ theGraphApiKey }) first.');
  }
  const endpoint = `${API_BASE_URL}/${_config.apiKey}/subgraphs/id/${subgraphId}`;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables })
    });

    if (!response.ok) {
      throw new Error(`The Graph API request failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    if (data.errors) {
      throw new Error(`The Graph query error: ${data.errors.map(e => e.message).join(', ')}`);
    }

    return data.data;
  } catch (error) {
    if (error.message.includes('The Graph')) {
      throw error;
    }
    throw new Error(`The Graph service error: ${error.message}`);
  }
}

/**
 * Get time-averaged TVL for a pool using Messari standardized subgraphs
 * @param {string} poolAddress - Pool contract address
 * @param {number} chainId - Chain ID (1, 42161, etc.)
 * @param {string} platformId - Platform ID (uniswapV3, etc.)
 * @param {number} days - Number of days to average
 * @returns {Promise<number>} Average TVL in USD
 */
export async function getPoolTVLAverage(poolAddress, chainId, platformId, days) {
  // Validate inputs
  if (!poolAddress || typeof poolAddress !== 'string') {
    throw new Error('poolAddress must be a non-empty string');
  }
  if (!Number.isInteger(chainId) || chainId <= 0) {
    throw new Error('chainId must be a positive integer');
  }
  if (!platformId || typeof platformId !== 'string') {
    throw new Error('platformId must be a non-empty string');
  }
  if (!Number.isInteger(days) || days <= 0) {
    throw new Error('days must be a positive integer');
  }

  // Get platform metadata using helper
  const platform = getPlatformMetadata(platformId);

  const subgraphConfig = platform.subgraphs[chainId];
  if (!subgraphConfig) {
    throw new Error(`No subgraph configured for platform ${platformId} on chain ${chainId}`);
  }

  const poolId = poolAddress.toLowerCase();

  // Use different queries based on subgraph type
  let query, historicalData, tvlField;

  if (subgraphConfig.queryType === 'messari') {
    query = `
      query GetLiquidityPoolHistoricalTVL($poolId: String!, $days: Int!) {
        liquidityPoolDailySnapshots(
          where: {pool: $poolId}
          orderBy: timestamp
          orderDirection: desc
          first: $days
        ) {
          timestamp
          totalValueLockedUSD
        }
      }
    `;

    const data = await executeQuery(subgraphConfig.id, query, { poolId, days });
    historicalData = data.liquidityPoolDailySnapshots;
    tvlField = 'totalValueLockedUSD';

  } else { // uniswap
    query = `
      query GetPoolDayData($poolId: String!, $days: Int!) {
        poolDayDatas(
          where: {pool: $poolId}
          orderBy: date
          orderDirection: desc
          first: $days
        ) {
          date
          tvlUSD
        }
      }
    `;

    const data = await executeQuery(subgraphConfig.id, query, { poolId, days });
    historicalData = data.poolDayDatas;
    tvlField = 'tvlUSD';
  }

  if (historicalData.length === 0) {
    throw new Error(`No historical data available for pool ${poolAddress}`);
  }

  const validTVLData = historicalData.filter(day => day[tvlField] && parseFloat(day[tvlField]) > 0);

  if (validTVLData.length !== days) {
    throw new Error(`Incomplete data: requested ${days} days, got ${validTVLData.length} valid days for pool ${poolAddress}`);
  }

  const totalTVL = validTVLData.reduce((sum, day) => sum + parseFloat(day[tvlField]), 0);
  const averageTVL = totalTVL / validTVLData.length;

  return averageTVL;
}

/**
 * Get pool creation timestamp from TheGraph
 * @param {string} poolAddress - Pool contract address
 * @param {number} chainId - Chain ID (1, 42161, etc.)
 * @param {string} platformId - Platform ID (uniswapV3, etc.)
 * @returns {Promise<number>} Pool creation timestamp in seconds
 */
export async function getPoolAge(poolAddress, chainId, platformId) {
  // Validate inputs
  if (!poolAddress || typeof poolAddress !== 'string') {
    throw new Error('poolAddress must be a non-empty string');
  }
  if (!Number.isInteger(chainId) || chainId <= 0) {
    throw new Error('chainId must be a positive integer');
  }
  if (!platformId || typeof platformId !== 'string') {
    throw new Error('platformId must be a non-empty string');
  }

  // Get platform metadata using helper
  const platform = getPlatformMetadata(platformId);

  const subgraphConfig = platform.subgraphs[chainId];
  if (!subgraphConfig) {
    throw new Error(`No subgraph configured for platform ${platformId} on chain ${chainId}`);
  }

  const poolId = poolAddress.toLowerCase();

  // Use different queries based on subgraph type
  let query;
  if (subgraphConfig.queryType === 'messari') {
    query = `
      query GetPoolCreationTime($poolId: String!) {
        liquidityPool(id: $poolId) {
          createdTimestamp
        }
      }
    `;
  } else { // uniswap
    query = `
      query GetPoolCreationTime($poolId: String!) {
        pool(id: $poolId) {
          createdAtTimestamp
        }
      }
    `;
  }

  // Execute query
  const data = await executeQuery(subgraphConfig.id, query, { poolId });

  // Extract timestamp based on queryType
  let createdTimestamp;
  if (subgraphConfig.queryType === 'messari') {
    if (!data.liquidityPool) {
      throw new Error(`Pool ${poolAddress} not found`);
    }
    createdTimestamp = data.liquidityPool.createdTimestamp;
  } else {
    if (!data.pool) {
      throw new Error(`Pool ${poolAddress} not found`);
    }
    createdTimestamp = data.pool.createdAtTimestamp;
  }

  if (!createdTimestamp) {
    throw new Error(`No creation timestamp available for pool ${poolAddress}`);
  }

  return parseInt(createdTimestamp, 10);
}

/**
 * Discover Uniswap V4 pools for a token pair
 *
 * Queries the V4 subgraph for pools matching the token pair with:
 * - liquidity > 0 (active pools only)
 * - hooks = AddressZero (no hooks - vanilla pools only)
 *
 * @param {string} token0Address - First token address (must be sorted - lower address)
 * @param {string} token1Address - Second token address (must be sorted - higher address)
 * @param {number} chainId - Chain ID (1, 42161, etc.)
 * @param {Object} [options] - Optional query options
 * @param {number} [options.limit=10] - Maximum number of pools to return
 * @returns {Promise<Array>} Array of pool objects sorted by liquidity (highest first)
 */
export async function discoverV4Pools(token0Address, token1Address, chainId, options = {}) {
  const { limit = 10 } = options;

  // Validate inputs
  if (!token0Address || typeof token0Address !== 'string') {
    throw new Error('token0Address must be a non-empty string');
  }
  if (!token1Address || typeof token1Address !== 'string') {
    throw new Error('token1Address must be a non-empty string');
  }
  if (!Number.isInteger(chainId) || chainId <= 0) {
    throw new Error('chainId must be a positive integer');
  }

  // Get V4 subgraph config
  const platform = getPlatformMetadata('uniswapV4');
  const subgraphConfig = platform.subgraphs[chainId];
  if (!subgraphConfig) {
    throw new Error(`No V4 subgraph configured for chain ${chainId}`);
  }

  // Normalize addresses to lowercase for subgraph query
  const t0 = token0Address.toLowerCase();
  const t1 = token1Address.toLowerCase();

  // Zero address for hooks filter (vanilla pools only)
  const zeroAddress = '0x0000000000000000000000000000000000000000';

  const query = `
    query DiscoverV4Pools($token0: String!, $token1: String!, $hooks: String!, $limit: Int!) {
      pools(
        where: {
          token0: $token0,
          token1: $token1,
          liquidity_gt: "0",
          hooks: $hooks
        }
        orderBy: liquidity
        orderDirection: desc
        first: $limit
      ) {
        id
        token0 { id symbol decimals }
        token1 { id symbol decimals }
        feeTier
        tickSpacing
        liquidity
        sqrtPrice
        tick
        hooks
        totalValueLockedUSD
      }
    }
  `;

  const data = await executeQuery(subgraphConfig.id, query, {
    token0: t0,
    token1: t1,
    hooks: zeroAddress,
    limit
  });

  return data.pools || [];
}

/**
 * Get V4 position tokenIds for an owner address
 *
 * V4 PositionManager doesn't implement ERC721Enumerable, so on-chain enumeration
 * via tokenOfOwnerByIndex is not available. This function uses The Graph to
 * discover position tokenIds owned by an address.
 *
 * @param {string} ownerAddress - Owner wallet/vault address
 * @param {number} chainId - Chain ID (1, 42161, etc.)
 * @param {Object} [options] - Optional query options
 * @param {number} [options.limit=100] - Maximum number of positions to return
 * @returns {Promise<Array<string>>} Array of tokenId strings
 */
export async function getV4PositionsByOwner(ownerAddress, chainId, options = {}) {
  const { limit = 100 } = options;

  // Validate inputs
  if (!ownerAddress || typeof ownerAddress !== 'string') {
    throw new Error('ownerAddress must be a non-empty string');
  }
  if (!Number.isInteger(chainId) || chainId <= 0) {
    throw new Error('chainId must be a positive integer');
  }

  // Get V4 subgraph config
  const platform = getPlatformMetadata('uniswapV4');
  const subgraphConfig = platform.subgraphs[chainId];
  if (!subgraphConfig) {
    throw new Error(`No V4 subgraph configured for chain ${chainId}`);
  }

  // Normalize address to lowercase for subgraph query
  const owner = ownerAddress.toLowerCase();

  const query = `
    query GetV4PositionsByOwner($owner: String!, $limit: Int!) {
      positions(
        where: { owner: $owner }
        orderBy: tokenId
        orderDirection: desc
        first: $limit
      ) {
        id
        tokenId
        owner
      }
    }
  `;

  const data = await executeQuery(subgraphConfig.id, query, {
    owner,
    limit
  });

  // Extract tokenIds from positions
  const positions = data.positions || [];
  return positions.map(p => p.tokenId);
}

