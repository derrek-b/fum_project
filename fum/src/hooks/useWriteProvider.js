// hooks/useWriteProvider.js
// Hook for components that need to send transactions
// Uses MetaMask wallet provider for signing

import { useProvider } from '../contexts/ProviderContext';

/**
 * Hook for write operations (transactions) that require wallet signing
 *
 * @returns {Object} { provider, getSigner, chainId, isConnected }
 */
export function useWriteProvider() {
  const { provider, chainId } = useProvider();

  return {
    provider,
    getSigner: () => provider?.getSigner(),
    chainId,
    isConnected: !!provider
  };
}
