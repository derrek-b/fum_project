/**
 * @module services/theGraph
 * @description The Graph Protocol service for pool TVL data
 */

import { getPlatformMetadata } from '../helpers/platformHelpers.js';

// API configuration
const API_BASE_URL = 'https://gateway-arbitrum.network.thegraph.com/api';

/**
 * Execute GraphQL query against subgraph
 * @private
 * @param {string} apiKey - The Graph API key
 * @param {string} subgraphId - Subgraph ID
 * @param {string} query - GraphQL query
 * @param {Object} variables - Query variables
 * @returns {Promise<Object>} Query response
 */
async function executeQuery(apiKey, subgraphId, query, variables = {}) {
  const endpoint = `${API_BASE_URL}/${apiKey}/subgraphs/id/${subgraphId}`;

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
 * @param {string} apiKey - The Graph API key
 * @returns {Promise<number>} Average TVL in USD
 */
export async function getPoolTVLAverage(poolAddress, chainId, platformId, days, apiKey) {
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
  if (!apiKey || typeof apiKey !== 'string') {
    throw new Error('apiKey must be a non-empty string');
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
    
    const data = await executeQuery(apiKey, subgraphConfig.id, query, { poolId, days });
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
    
    const data = await executeQuery(apiKey, subgraphConfig.id, query, { poolId, days });
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
