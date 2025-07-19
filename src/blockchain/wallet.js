/**
 * @module blockchain/wallet
 * @description Ethereum wallet integration utilities for browser and RPC providers
 */

// src/blockchain/wallet.js
import { ethers } from "ethers";
import { getChainConfig } from "../helpers/chainHelpers.js";

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
    const provider = new ethers.BrowserProvider(window.ethereum);

    // Validate provider instance
    if (!(provider instanceof ethers.BrowserProvider)) {
      throw new Error('Failed to create valid BrowserProvider instance');
    }

    return provider;
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
 * @returns {Promise<ethers.JsonRpcProvider>} Configured ethers provider
 *
 * @throws {Error} If RPC URL is not provided
 *
 * @example
 * const provider = createJsonRpcProvider('https://eth-mainnet.g.alchemy.com/v2/YOUR_API_KEY');
 *
 * @since 1.0.0
 */
export async function createJsonRpcProvider(rpcUrl) {
  if (!rpcUrl) {
    throw new Error("RPC URL is required to create a provider");
  }

  // Validate URL format
  const urlRegex = /^(https?|wss?):\/\/[a-zA-Z0-9.-]+(?::[0-9]+)?(?:\/.*)?$/i;
  if (!urlRegex.test(rpcUrl)) {
    throw new Error(`Invalid RPC URL format: ${rpcUrl}. Must be a valid HTTP/HTTPS/WS/WSS URL.`);
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);

  // Validate provider instance
  if (!(provider instanceof ethers.JsonRpcProvider)) {
    throw new Error('Failed to create valid JsonRpcProvider instance');
  }

  // Test connectivity with retry
  let retries = 2;
  while (retries > 0) {
    try {
      await provider.getNetwork();
      break; // Success, exit retry loop
    } catch (error) {
      retries--;
      if (retries === 0) {
        throw new Error(`Provider connectivity test failed for ${rpcUrl}: ${error.message}`);
      }
      // Wait 1 second before retry
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  return provider;
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

  // Validate provider instance
  if (!(provider instanceof ethers.AbstractProvider)) {
    throw new Error('Invalid provider. Must be an ethers provider instance.');
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
  if (!provider || provider instanceof ethers.JsonRpcProvider) {
    throw new Error("A browser provider is required to request wallet connection");
  }

  // Validate provider instance
  if (!(provider instanceof ethers.AbstractProvider)) {
    throw new Error('Invalid provider. Must be an ethers provider instance.');
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

  // Validate provider instance
  if (!(provider instanceof ethers.AbstractProvider)) {
    throw new Error('Invalid provider. Must be an ethers provider instance.');
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
 * Switches the connected browser wallet to a specific chain
 *
 * @function switchChain
 * @memberof module:blockchain/wallet
 *
 * @param {ethers.BrowserProvider} provider - The browser provider
 * @param {number} chainId - The chain ID to switch to (must be a number)
 *
 * @returns {Promise<boolean>} Whether the switch was successful
 *
 * @throws {Error} If provider is not a BrowserProvider
 * @throws {Error} If chainId is not a number
 *
 * @example
 * // Switch to Polygon
 * const success = await switchChain(provider, 137);
 *
 * @since 1.0.0
 */
export async function switchChain(provider, chainId) {
  if (!provider || provider instanceof ethers.JsonRpcProvider) {
    throw new Error("A browser provider is required to switch chains");
  }

  // Validate provider instance
  if (!(provider instanceof ethers.AbstractProvider)) {
    throw new Error('Invalid provider. Must be an ethers provider instance.');
  }

  // Validate chainId is a number
  if (typeof chainId !== 'number') {
    throw new Error('Chain ID must be a number');
  }

  // Convert to hex format
  const chainIdHex = `0x${chainId.toString(16)}`;

  try {
    await provider.send("wallet_switchEthereumChain", [{ chainId: chainIdHex }]);
    return true;
  } catch (err) {
    // Error code 4902 means the chain hasn't been added to wallet
    if (err.code === 4902) {
      // Try to add the chain if we have it in our configs
      const chainConfig = getChainConfig(chainId);
      if (chainConfig) {
        try {
          await provider.send("wallet_addEthereumChain", [{
            chainId: chainIdHex,
            chainName: chainConfig.name,
            nativeCurrency: chainConfig.nativeCurrency,
            rpcUrls: chainConfig.rpcUrls,
            blockExplorerUrls: chainConfig.blockExplorerUrls
          }]);
          
          // Chain added successfully, now try switching again
          await provider.send("wallet_switchEthereumChain", [{ chainId: chainIdHex }]);
          return true;
        } catch (addError) {
          console.error("Failed to add chain:", addError);
          return false;
        }
      } else {
        console.warn(`Chain ${chainId} not found in library configs`);
        return false;
      }
    }

    console.error("Error switching chains:", err);
    return false;
  }
}
