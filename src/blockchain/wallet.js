// src/blockchain/wallet.js
import { ethers } from "ethers";

/**
 * Create an ethers provider using browser wallet (MetaMask, etc.)
 * @returns {Promise<ethers.BrowserProvider>} Configured ethers provider
 * @throws {Error} If no browser wallet is available
 */
export async function createBrowserProvider() {
  if (typeof window !== "undefined" && window.ethereum) {
    return new ethers.BrowserProvider(window.ethereum);
  }
  throw new Error("No Ethereum provider found (e.g., MetaMask) in browser");
}

/**
 * Create an ethers provider using RPC URL
 * @param {string} rpcUrl - The RPC endpoint URL
 * @returns {ethers.JsonRpcProvider} Configured ethers provider
 */
export function createJsonRpcProvider(rpcUrl) {
  if (!rpcUrl) {
    throw new Error("RPC URL is required to create a provider");
  }
  return new ethers.JsonRpcProvider(rpcUrl);
}

/**
 * Create an appropriate provider based on environment and parameters
 * @param {Object} options - Provider options
 * @param {string} [options.rpcUrl] - RPC URL for JsonRpcProvider
 * @param {boolean} [options.preferBrowser=true] - Whether to prefer browser wallet when available
 * @returns {Promise<ethers.Provider>} The provider instance
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
 * Get the connected accounts from a browser wallet
 * @param {ethers.BrowserProvider} provider - The ethers provider
 * @returns {Promise<string[]>} Array of connected account addresses
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
    console.error("Error getting connected accounts:", err);
    return [];
  }
}

/**
 * Request wallet connection (triggers wallet popup)
 * @param {ethers.BrowserProvider} provider - The ethers provider
 * @returns {Promise<string[]>} Array of connected account addresses
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
 * Get the chain ID from provider
 * @param {ethers.Provider} provider - The ethers provider
 * @returns {Promise<number>} The chain ID
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
 * Switch the connected wallet to a specific chain
 * @param {ethers.BrowserProvider} provider - The ethers provider
 * @param {number|string} chainId - The chain ID to switch to
 * @returns {Promise<boolean>} Whether the switch was successful
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
