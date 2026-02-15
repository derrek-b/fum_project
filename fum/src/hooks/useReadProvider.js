// hooks/useReadProvider.js
// Hook for components that only need read access to the blockchain
// Uses dedicated RPC provider (Alchemy) with fallback to wallet provider

import { useProvider } from '../contexts/ProviderContext';

/**
 * Hook for read-only blockchain operations
 * Returns the dedicated RPC provider if available, falls back to wallet provider
 *
 * @returns {Object} { provider, chainId, isReady }
 */
export function useReadProvider() {
  const { readProvider, provider, chainId } = useProvider();

  return {
    provider: readProvider || provider,  // Fallback to wallet if read provider unavailable
    chainId,
    isReady: !!(readProvider || provider)
  };
}
