// hooks/useProviders.js
// Combined hook for components that need both read and write access
// Read operations use dedicated RPC, write operations use wallet provider

import { useProvider } from '../contexts/ProviderContext';

/**
 * Hook for components that need both read and write access
 * Provides separate providers for each use case
 *
 * @returns {Object} { readProvider, writeProvider, getSigner, chainId, isReadReady, isWriteReady }
 */
export function useProviders() {
  const { readProvider, provider, chainId } = useProvider();

  return {
    readProvider: readProvider || provider,  // Fallback to wallet if read provider unavailable
    writeProvider: provider,
    getSigner: () => provider?.getSigner(),
    chainId,
    isReadReady: !!(readProvider || provider),
    isWriteReady: !!provider
  };
}
