import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';
import { getChainRpcUrls } from 'fum_library/helpers';

const ProviderContext = createContext(null);

/**
 * Provider Context for managing ethers provider instance
 * Keeps provider outside Redux to preserve prototype chain for instanceof checks
 */
export function ProviderProvider({ children }) {
  const [provider, setProviderState] = useState(null);
  const [readProvider, setReadProvider] = useState(null);
  const [chainId, setChainId] = useState(null);

  /**
   * Create a dedicated read-only provider using RPC URLs from chain config
   */
  const createReadProvider = async (networkChainId) => {
    try {
      const rpcUrls = getChainRpcUrls(networkChainId);
      const rpcProvider = new ethers.providers.JsonRpcProvider(rpcUrls[0]);
      await rpcProvider.getNetwork(); // Test connectivity
      return rpcProvider;
    } catch (error) {
      console.warn('Read provider failed, will use wallet provider:', error.message);
      return null;
    }
  };

  /**
   * Set the provider and attach event listeners
   */
  const setProvider = useCallback(async (newProvider) => {
    // Clean up old provider listeners if exists
    if (provider && window.ethereum) {
      window.ethereum.removeAllListeners('chainChanged');
      window.ethereum.removeAllListeners('accountsChanged');
    }

    setProviderState(newProvider);

    // Create read provider and set chainId when wallet connects
    if (newProvider) {
      try {
        const network = await newProvider.getNetwork();
        const networkChainId = Number(network.chainId);
        setChainId(networkChainId);

        // Create dedicated read provider for this chain
        const newReadProvider = await createReadProvider(networkChainId);
        setReadProvider(newReadProvider);
      } catch (error) {
        console.warn('Failed to setup read provider:', error.message);
        setReadProvider(null);
        setChainId(null);
      }
    } else {
      setReadProvider(null);
      setChainId(null);
    }

    // Attach listeners to new provider
    if (newProvider && window.ethereum) {
      // Handle chain changes
      window.ethereum.on('chainChanged', () => {
        // Reload page on chain change as recommended by MetaMask
        window.location.reload();
      });

      // Handle account changes
      window.ethereum.on('accountsChanged', (accounts) => {
        if (accounts.length === 0) {
          // User disconnected wallet
          setProviderState(null);
          setReadProvider(null);
          setChainId(null);
        }
      });
    }
  }, [provider]);

  /**
   * Clear provider and remove listeners
   */
  const clearProvider = useCallback(() => {
    if (window.ethereum) {
      window.ethereum.removeAllListeners('chainChanged');
      window.ethereum.removeAllListeners('accountsChanged');
    }
    setProviderState(null);
    setReadProvider(null);
    setChainId(null);
  }, []);

  // Clean up listeners on unmount
  useEffect(() => {
    return () => {
      if (window.ethereum) {
        window.ethereum.removeAllListeners('chainChanged');
        window.ethereum.removeAllListeners('accountsChanged');
      }
    };
  }, []);

  const value = {
    provider,        // Wallet provider for write operations
    readProvider,    // Dedicated RPC provider for read operations
    chainId,         // Current chain ID
    setProvider,
    clearProvider
  };

  return (
    <ProviderContext.Provider value={value}>
      {children}
    </ProviderContext.Provider>
  );
}

/**
 * Hook to access provider from context
 * @returns {Object} { provider, readProvider, chainId, setProvider, clearProvider }
 */
export function useProvider() {
  const context = useContext(ProviderContext);

  if (context === undefined) {
    throw new Error('useProvider must be used within a ProviderProvider');
  }

  return context;
}
