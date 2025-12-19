import { ethers } from 'ethers';

/**
 * Permit2 Helper Functions
 *
 * Reusable functions for Permit2 signature generation and calldata wrapping.
 *
 * Permit2 is a universal token approval standard adopted by:
 * - Uniswap (V3, V4 via Universal Router)
 * - 1inch
 * - CoW Protocol
 * - Balancer
 * - And others
 *
 * @example
 * import { PERMIT2_ADDRESS, getPermit2Nonce, generatePermit2Signature, wrapWithPermit2 } from './Permit2Helper.js';
 *
 * const nonce = await getPermit2Nonce(provider, owner, token, spender);
 * const { signature, permitData } = await generatePermit2Signature(signer, chainId, token, amount, spender, nonce, deadline);
 * const wrappedCalldata = wrapWithPermit2(routerInterface, calldata, permitData, signature);
 */

/**
 * Canonical Permit2 address - same on all EVM chains
 */
export const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3';

const PERMIT2_ABI = [
  'function allowance(address owner, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)'
];

/**
 * EIP-712 types for PermitSingle signature
 */
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
 * Get current nonce for a token/owner/spender combination from Permit2 contract
 * @param {ethers.Provider} provider - Ethers provider for reading contract state
 * @param {string} ownerAddress - Address that owns the tokens (e.g., vault address)
 * @param {string} tokenAddress - Token contract address
 * @param {string} spenderAddress - Address that will spend tokens (e.g., Universal Router)
 * @returns {Promise<number>} Current nonce value
 */
export async function getPermit2Nonce(provider, ownerAddress, tokenAddress, spenderAddress) {
  if (!provider) {
    throw new Error('getPermit2Nonce: provider is required');
  }
  if (!ownerAddress || !ethers.utils.isAddress(ownerAddress)) {
    throw new Error('getPermit2Nonce: invalid ownerAddress');
  }
  if (!tokenAddress || !ethers.utils.isAddress(tokenAddress)) {
    throw new Error('getPermit2Nonce: invalid tokenAddress');
  }
  if (!spenderAddress || !ethers.utils.isAddress(spenderAddress)) {
    throw new Error('getPermit2Nonce: invalid spenderAddress');
  }

  const permit2Contract = new ethers.Contract(PERMIT2_ADDRESS, PERMIT2_ABI, provider);
  const [, , nonce] = await permit2Contract.allowance(
    ownerAddress,
    tokenAddress,
    spenderAddress
  );
  return Number(nonce);
}

/**
 * Generate EIP-712 signature for PermitSingle
 * @param {ethers.Wallet} signer - Wallet that will sign the permit (must be authorized by owner)
 * @param {number} chainId - Chain ID (1337 for local fork will use Arbitrum chainId for signatures)
 * @param {string} tokenAddress - Token contract address
 * @param {string} amount - Amount to permit (as string, will be validated as uint160)
 * @param {string} spenderAddress - Address that will spend tokens
 * @param {number} nonce - Current nonce from getPermit2Nonce()
 * @param {number} deadline - Unix timestamp when signature expires
 * @returns {Promise<{signature: string, permitData: Object}>} Signature and permit data
 */
export async function generatePermit2Signature(signer, chainId, tokenAddress, amount, spenderAddress, nonce, deadline) {
  if (!signer || typeof signer._signTypedData !== 'function') {
    throw new Error('generatePermit2Signature: signer must be an ethers Wallet with _signTypedData');
  }
  if (typeof chainId !== 'number') {
    throw new Error('generatePermit2Signature: chainId must be a number');
  }
  if (!tokenAddress || !ethers.utils.isAddress(tokenAddress)) {
    throw new Error('generatePermit2Signature: invalid tokenAddress');
  }
  if (!amount) {
    throw new Error('generatePermit2Signature: amount is required');
  }
  if (!spenderAddress || !ethers.utils.isAddress(spenderAddress)) {
    throw new Error('generatePermit2Signature: invalid spenderAddress');
  }
  if (typeof nonce !== 'number' || nonce < 0) {
    throw new Error('generatePermit2Signature: nonce must be a non-negative number');
  }
  if (typeof deadline !== 'number' || deadline <= 0) {
    throw new Error('generatePermit2Signature: deadline must be a positive number');
  }

  // Validate amount fits in uint160
  const maxUint160 = ethers.BigNumber.from(2).pow(160).sub(1);
  const amountBN = ethers.BigNumber.from(amount);
  if (amountBN.gt(maxUint160)) {
    throw new Error('generatePermit2Signature: amount exceeds uint160 maximum');
  }

  const domain = {
    name: 'Permit2',
    chainId: chainId,
    verifyingContract: PERMIT2_ADDRESS
  };

  const permitSingle = {
    details: {
      token: tokenAddress,
      amount: amount,
      expiration: deadline,
      nonce: nonce
    },
    spender: spenderAddress,
    sigDeadline: deadline
  };

  const signature = await signer._signTypedData(domain, PERMIT2_TYPES, permitSingle);
  return { signature, permitData: permitSingle };
}

/**
 * Encode PermitSingle + signature for Universal Router PERMIT2_PERMIT command
 * @param {Object} permitData - Permit data from generatePermit2Signature()
 * @param {string} signature - Signature from generatePermit2Signature()
 * @returns {string} ABI-encoded permit input
 */
export function encodePermit2Input(permitData, signature) {
  if (!permitData || !permitData.details) {
    throw new Error('encodePermit2Input: invalid permitData');
  }
  if (!signature || typeof signature !== 'string') {
    throw new Error('encodePermit2Input: signature must be a string');
  }

  const permitSingleTuple = {
    details: {
      token: permitData.details.token,
      amount: permitData.details.amount,
      expiration: permitData.details.expiration,
      nonce: permitData.details.nonce
    },
    spender: permitData.spender,
    sigDeadline: permitData.sigDeadline
  };

  return ethers.utils.defaultAbiCoder.encode(
    [
      'tuple(tuple(address token, uint160 amount, uint48 expiration, uint48 nonce) details, address spender, uint256 sigDeadline)',
      'bytes'
    ],
    [permitSingleTuple, signature]
  );
}

/**
 * Wrap Universal Router calldata with PERMIT2_PERMIT command (0x0a)
 *
 * This prepends the PERMIT2_PERMIT command to the existing command sequence,
 * allowing the Universal Router to pull tokens via Permit2 before executing swaps.
 *
 * @param {ethers.utils.Interface} routerInterface - Universal Router interface for encoding
 * @param {string} swapCalldata - Original swap calldata from AlphaRouter
 * @param {Object} permitData - Permit data from generatePermit2Signature()
 * @param {string} signature - Signature from generatePermit2Signature()
 * @returns {string} Wrapped calldata with PERMIT2_PERMIT prepended
 */
export function wrapWithPermit2(routerInterface, swapCalldata, permitData, signature) {
  if (!routerInterface || typeof routerInterface.decodeFunctionData !== 'function') {
    throw new Error('wrapWithPermit2: routerInterface must be an ethers Interface');
  }
  if (!swapCalldata || typeof swapCalldata !== 'string') {
    throw new Error('wrapWithPermit2: swapCalldata must be a string');
  }

  // Decode existing Universal Router execute() call
  // AlphaRouter uses execute(bytes,bytes[]) - the 2-parameter version without deadline
  const decoded = routerInterface.decodeFunctionData('execute(bytes,bytes[])', swapCalldata);
  const existingCommands = decoded.commands;
  const existingInputs = decoded.inputs;

  // Encode Permit2 permit input
  const permitInput = encodePermit2Input(permitData, signature);

  // Prepend PERMIT2_PERMIT command (0x0a) to existing commands
  const commands = '0x0a' + existingCommands.slice(2);

  // Prepend permit input to existing inputs array
  const inputs = [permitInput, ...existingInputs];

  // Re-encode execute() with new commands + inputs
  return routerInterface.encodeFunctionData('execute(bytes,bytes[])', [commands, inputs]);
}
