/**
 * @module blockchain/wallet
 * @description Ethereum wallet integration utilities for browser and RPC providers
 */

// src/blockchain/wallet.js
import { ethers } from "ethers";

/**
 * Creates an ethers provider using the browser's Ethereum wallet
 * 
 * @function createBrowserProvider
 * @memberof module:blockchain/wallet
 * 
 * @returns {Promise<ethers.BrowserProvider>} Configured ethers provider
 * 
 * @throws {Error} If no browser wallet is available
 * 
 * @example
 * // Connect to MetaMask
 * const provider = await createBrowserProvider();
 * 
 * @since 1.0.0
 */
export async function createBrowserProvider() {
  if (typeof window !== "undefined" && window.ethereum) {
    return new ethers.BrowserProvider(window.ethereum);
  }
  throw new Error("No Ethereum provider found (e.g., MetaMask) in browser");
}

/**
 * Creates an ethers provider using an RPC URL
 * 
 * @function createJsonRpcProvider
 * @memberof module:blockchain/wallet
 * 
 * @param {string} rpcUrl - The RPC endpoint URL
 * 
 * @returns {ethers.JsonRpcProvider} Configured ethers provider
 * 
 * @throws {Error} If RPC URL is not provided
 * 
 * @example
 * const provider = createJsonRpcProvider('https://eth-mainnet.g.alchemy.com/v2/YOUR_API_KEY');
 * 
 * @since 1.0.0
 */
export function createJsonRpcProvider(rpcUrl) {
  if (!rpcUrl) {
    throw new Error("RPC URL is required to create a provider");
  }
  return new ethers.JsonRpcProvider(rpcUrl);
}

/**
 * Creates an appropriate provider based on environment and parameters
 * 
 * @function createProvider
 * @memberof module:blockchain/wallet
 * 
 * @param {Object} [options={}] - Provider options
 * @param {string} [options.rpcUrl] - RPC URL for JsonRpcProvider
 * @param {boolean} [options.preferBrowser=true] - Whether to prefer browser wallet when available
 * 
 * @returns {Promise<ethers.Provider>} The provider instance
 * 
 * @throws {Error} If no provider method is available
 * 
 * @example
 * // Prefer browser wallet, fallback to RPC
 * const provider = await createProvider({
 *   rpcUrl: 'https://eth-mainnet.g.alchemy.com/v2/YOUR_API_KEY',
 *   preferBrowser: true
 * });
 * 
 * @since 1.0.0
 */
export async function createProvider(options = {}) {
  const { rpcUrl, preferBrowser = true } = options;

  // Try browser wallet first if preferred
  if (preferBrowser) {
    try {
      return await createBrowserProvider();
    } catch (err) {
      // Fall back to RPC if browser wallet fails and RPC URL provided
      if (rpcUrl) {
        return createJsonRpcProvider(rpcUrl);
      }
      throw err;
    }
  }

  // If browser not preferred, use RPC directly
  if (rpcUrl) {
    return createJsonRpcProvider(rpcUrl);
  }

  throw new Error("Either preferBrowser must be true or rpcUrl must be provided");
}

/**
 * Gets the connected accounts from a browser wallet
 * 
 * @function getConnectedAccounts
 * @memberof module:blockchain/wallet
 * 
 * @param {ethers.BrowserProvider} provider - The ethers provider
 * 
 * @returns {Promise<string[]>} Array of connected account addresses
 * 
 * @example
 * const provider = await createBrowserProvider();
 * const accounts = await getConnectedAccounts(provider);
 * console.log('Connected accounts:', accounts);
 * 
 * @since 1.0.0
 */
export async function getConnectedAccounts(provider) {
  if (!provider) {
    throw new Error("Provider is required to get connected accounts");
  }

  try {
    return await provider.listAccounts().then(accounts =>
      accounts.map(account => account.address)
    );
  } catch (err) {
    // Don't hide wallet errors - they're critical for user experience
    throw new Error(`Failed to get connected accounts: ${err.message}`);
  }
}

/**
 * Requests wallet connection (triggers wallet popup)
 * 
 * @function requestWalletConnection
 * @memberof module:blockchain/wallet
 * 
 * @param {ethers.BrowserProvider} provider - The ethers provider
 * 
 * @returns {Promise<string[]>} Array of connected account addresses
 * 
 * @throws {Error} If wallet connection fails
 * 
 * @example
 * const provider = await createBrowserProvider();
 * const accounts = await requestWalletConnection(provider);
 * 
 * @since 1.0.0
 */
export async function requestWalletConnection(provider) {
  if (!provider) {
    throw new Error("Provider is required to request wallet connection");
  }

  try {
    const accounts = await provider.send("eth_requestAccounts", []);
    return accounts;
  } catch (err) {
    console.error("Error requesting wallet connection:", err);
    throw new Error("Failed to connect to wallet: " + (err.message || "Unknown error"));
  }
}

/**
 * Gets the chain ID from the provider
 * 
 * @function getChainId
 * @memberof module:blockchain/wallet
 * 
 * @param {ethers.Provider} provider - The ethers provider
 * 
 * @returns {Promise<number>} The chain ID
 * 
 * @example
 * const chainId = await getChainId(provider);
 * console.log('Connected to chain:', chainId);
 * 
 * @since 1.0.0
 */
export async function getChainId(provider) {
  if (!provider) {
    throw new Error("Provider is required to get chain ID");
  }

  try {
    const network = await provider.getNetwork();
    return Number(network.chainId);
  } catch (err) {
    console.error("Error getting chain ID:", err);
    throw err;
  }
}

/**
 * Switches the connected wallet to a specific chain
 * 
 * @function switchChain
 * @memberof module:blockchain/wallet
 * 
 * @param {ethers.BrowserProvider} provider - The ethers provider
 * @param {number|string} chainId - The chain ID to switch to
 * 
 * @returns {Promise<boolean>} Whether the switch was successful
 * 
 * @example
 * // Switch to Polygon
 * const success = await switchChain(provider, 137);
 * 
 * @since 1.0.0
 */
export async function switchChain(provider, chainId) {
  if (!provider) {
    throw new Error("Provider is required to switch chains");
  }

  // Ensure chainId is in hex format
  const chainIdHex = typeof chainId === 'number'
    ? `0x${chainId.toString(16)}`
    : chainId;

  try {
    await provider.send("wallet_switchEthereumChain", [{ chainId: chainIdHex }]);
    return true;
  } catch (err) {
    // Error code 4902 means the chain hasn't been added to MetaMask
    // In this case, you would need to suggest adding the chain
    if (err.code === 4902) {
      console.warn("Chain not added to wallet. Use addChain method first.");
    }

    console.error("Error switching chains:", err);
    return false;
  }
}
