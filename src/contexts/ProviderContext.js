import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

const ProviderContext = createContext(null);

/**
 * Provider Context for managing ethers provider instance
 * Keeps provider outside Redux to preserve prototype chain for instanceof checks
 */
export function ProviderProvider({ children }) {
  const [provider, setProviderState] = useState(null);

  /**
   * Set the provider and attach event listeners
   */
  const setProvider = useCallback((newProvider) => {
    // Clean up old provider listeners if exists
    if (provider && window.ethereum) {
      window.ethereum.removeAllListeners('chainChanged');
      window.ethereum.removeAllListeners('accountsChanged');
    }

    setProviderState(newProvider);

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
    provider,
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
 * @returns {Object} { provider, setProvider, clearProvider }
 */
export function useProvider() {
  const context = useContext(ProviderContext);

  if (context === undefined) {
    throw new Error('useProvider must be used within a ProviderProvider');
  }

  return context;
}
