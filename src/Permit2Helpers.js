/**
 * Helper utilities for FUM Automation
 */

import { ethers } from 'ethers';
// Permit2 canonical address - same on all chains
// See: https://github.com/Uniswap/permit2#deployments
const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3';

// Permit2 ABI - minimal interface for allowance function
const PERMIT2_ABI = [
  'function allowance(address owner, address token, address spender) external view returns (uint160 amount, uint48 expiration, uint48 nonce)'
];

// EIP-712 Permit2 domain and types
const PERMIT2_DOMAIN_NAME = 'Permit2';

const PERMIT2_TYPES = {
  PermitSingle: [
    { name: 'details', type: 'PermitDetails' },
    { name: 'spender', type: 'address' },
    { name: 'sigDeadline', type: 'uint256' }
  ],
  PermitDetails: [
    { name: 'token', type: 'address' },
    { name: 'amount', type: 'uint160' },
    { name: 'expiration', type: 'uint48' },
    { name: 'nonce', type: 'uint48' }
  ]
};

/**
 * Generate a Permit2 signature for gasless token approvals
 *
 * @param {Object} params - Signature parameters
 * @param {ethers.Wallet} params.wallet - Executor wallet for signing
 * @param {string} params.vaultAddress - Vault address that owns the tokens
 * @param {string} params.tokenAddress - Token being approved for spending
 * @param {string} params.amount - Amount to approve (as string to support BigInt)
 * @param {string} params.universalRouterAddress - Spender address (Universal Router)
 * @param {number} params.chainId - Chain ID for EIP-712 domain
 * @param {ethers.Provider} params.provider - Provider for reading Permit2 nonce
 * @param {number} [params.deadlineMinutes=30] - Signature expiration in minutes
 * @param {number} [params.nonce] - Optional nonce to use (if not provided, fetches from chain)
 * @returns {Promise<Object>} Object with {signature, nonce, deadline}
 * @throws {Error} If any parameter is invalid or signature generation fails
 */
export async function generatePermit2Signature({
  wallet,
  vaultAddress,
  tokenAddress,
  amount,
  universalRouterAddress,
  chainId,
  provider,
  deadlineMinutes = 30,
  nonce: providedNonce
}) {
  // Validate wallet
  if (!wallet || typeof wallet._signTypedData !== 'function') {
    throw new Error('Wallet parameter is required and must be an ethers.Wallet instance');
  }

  // Validate addresses
  if (!vaultAddress || typeof vaultAddress !== 'string') {
    throw new Error('Vault address parameter is required');
  }
  try {
    ethers.utils.getAddress(vaultAddress);
  } catch (error) {
    throw new Error(`Invalid vault address: ${vaultAddress}`);
  }

  if (!tokenAddress || typeof tokenAddress !== 'string') {
    throw new Error('Token address parameter is required');
  }
  try {
    ethers.utils.getAddress(tokenAddress);
  } catch (error) {
    throw new Error(`Invalid token address: ${tokenAddress}`);
  }

  if (!universalRouterAddress || typeof universalRouterAddress !== 'string') {
    throw new Error('Universal Router address parameter is required');
  }
  try {
    ethers.utils.getAddress(universalRouterAddress);
  } catch (error) {
    throw new Error(`Invalid Universal Router address: ${universalRouterAddress}`);
  }

  // Validate amount
  if (!amount) {
    throw new Error('Amount parameter is required');
  }
  if (typeof amount !== 'string') {
    throw new Error('Amount must be a string');
  }
  if (!/^\d+$/.test(amount)) {
    throw new Error('Amount must be a positive numeric string');
  }
  if (amount === '0') {
    throw new Error('Amount cannot be zero');
  }

  // Validate amount fits in uint160
  const maxUint160 = ethers.BigNumber.from(2).pow(160).sub(1);
  if (ethers.BigNumber.from(amount).gt(maxUint160)) {
    throw new Error('Amount exceeds uint160 maximum value');
  }

  // Validate chainId
  if (typeof chainId !== 'number' || isNaN(chainId)) {
    throw new Error('ChainId must be a valid number');
  }
  if (chainId <= 0) {
    throw new Error('ChainId must be positive');
  }

  // Validate provider
  if (!provider || typeof provider.getNetwork !== 'function') {
    throw new Error('Provider parameter is required and must be an ethers.Provider instance');
  }

  // Validate deadline
  if (typeof deadlineMinutes !== 'number' || isNaN(deadlineMinutes)) {
    throw new Error('Deadline must be a valid number');
  }
  if (deadlineMinutes <= 0) {
    throw new Error('Deadline must be greater than 0');
  }

  try {
    // Get current Permit2 nonce for this vault/token/spender combination
    // If nonce is provided, use it; otherwise fetch from chain
    let nonce;
    if (providedNonce !== undefined) {
      nonce = providedNonce;
    } else {
      const permit2Contract = new ethers.Contract(PERMIT2_ADDRESS, PERMIT2_ABI, provider);
      const allowanceData = await permit2Contract.allowance(
        vaultAddress,
        tokenAddress,
        universalRouterAddress
      );
      nonce = allowanceData.nonce;
    }

    // Calculate deadline timestamp
    const deadline = Math.floor(Date.now() / 1000 + deadlineMinutes * 60);

    // Build EIP-712 domain
    // Note: Permit2 dynamically re-computes DOMAIN_SEPARATOR when block.chainid differs from
    // its initial deployment chainId. So on a fork (chainId 1337), Permit2 expects chainId 1337.
    const domain = {
      name: PERMIT2_DOMAIN_NAME,
      chainId: chainId,
      verifyingContract: PERMIT2_ADDRESS
    };

    // Build EIP-712 message
    const message = {
      details: {
        token: tokenAddress,
        amount: amount,
        expiration: deadline,
        nonce: nonce
      },
      spender: universalRouterAddress,
      sigDeadline: deadline
    };

    // Sign the typed data
    const signature = await wallet._signTypedData(domain, PERMIT2_TYPES, message);

    return {
      signature,
      nonce,
      deadline
    };

  } catch (error) {
    throw new Error(`Failed to generate Permit2 signature: ${error.message}`);
  }
}
