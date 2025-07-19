/**
 * Wallet Unit Tests
 *
 * Tests using Ganache fork of Arbitrum - no mocks, real blockchain interactions.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { ethers } from 'ethers';
import { quickTestSetup } from '../../test-env.js';
import { createBrowserProvider, createJsonRpcProvider, getConnectedAccounts, requestWalletConnection, getChainId, switchChain } from '../../../src/blockchain/wallet.js';

describe('Wallet - Unit Tests', () => {
  let env;
  let snapshotId;
  let originalWindow;

  beforeAll(async () => {
    // Setup test environment without deploying contracts (wallet tests don't need them)
    env = await quickTestSetup();

    // Store original window object
    originalWindow = global.window;
  }, 120000); // 2 minute timeout

  afterAll(async () => {
    if (env && env.teardown) {
      await env.teardown();
    }

    // Restore original window
    global.window = originalWindow;
  });

  beforeEach(async () => {
    // Take snapshot before each test
    if (env && env.snapshot) {
      snapshotId = await env.snapshot();
    }

    // Clear window mocks before each test
    delete global.window;
  });

  afterEach(async () => {
    // Revert to snapshot after each test
    if (env && env.revert && snapshotId) {
      await env.revert(snapshotId);
    }
    snapshotId = null;

    // Clean up window mocks after each test
    delete global.window;
  });

  describe('createBrowserProvider', () => {
    describe('Success Cases', () => {
      it('should create a valid BrowserProvider when window.ethereum exists', async () => {
        // Mock window.ethereum
        global.window = {
          ethereum: {
            request: vi.fn(),
            on: vi.fn(),
            removeListener: vi.fn(),
            isMetaMask: true
          }
        };

        const provider = await createBrowserProvider();

        expect(provider).toBeInstanceOf(ethers.BrowserProvider);
        expect(provider).toBeInstanceOf(ethers.AbstractProvider);
      });
    });

    describe('Error Cases', () => {
      it('should throw error when window is undefined', async () => {
        // No window object
        await expect(createBrowserProvider()).rejects.toThrow('No Ethereum provider found (e.g., MetaMask) in browser');
      });

      it('should throw error when window.ethereum is undefined', async () => {
        global.window = {};

        await expect(createBrowserProvider()).rejects.toThrow('No Ethereum provider found (e.g., MetaMask) in browser');
      });

      it('should throw error when window.ethereum is null', async () => {
        global.window = { ethereum: null };

        await expect(createBrowserProvider()).rejects.toThrow('No Ethereum provider found (e.g., MetaMask) in browser');
      });

      it('should throw error when window.ethereum is invalid object', async () => {
        // Test with various invalid ethereum objects that might cause BrowserProvider constructor to fail
        global.window = { ethereum: {} }; // Empty object

        await expect(createBrowserProvider()).rejects.toThrow();
      });

      it('should throw error when window.ethereum has no request method', async () => {
        global.window = {
          ethereum: {
            // Missing request method that BrowserProvider expects
            on: vi.fn(),
            removeListener: vi.fn()
          }
        };

        await expect(createBrowserProvider()).rejects.toThrow();
      });
    });
  });

  describe('createJsonRpcProvider', () => {
    describe('Success Cases', () => {
      it('should create a valid JsonRpcProvider', async () => {
        const provider = await createJsonRpcProvider('http://localhost:8545');

        expect(provider).toBeInstanceOf(ethers.JsonRpcProvider);
        expect(provider).toBeInstanceOf(ethers.AbstractProvider);
      });

      it('should work with ganache test environment', async () => {
        const provider = await createJsonRpcProvider('http://localhost:8545');

        // Test that we can get network info (connectivity test already passed)
        const network = await provider.getNetwork();
        expect(network.chainId).toBe(1337n);
      });

      it('should accept HTTP URL and validate connectivity', async () => {
        const httpProvider = await createJsonRpcProvider('http://localhost:8545');
        expect(httpProvider).toBeInstanceOf(ethers.JsonRpcProvider);
      });
    });

    describe('Error Cases', () => {
      it('should throw error if no RPC URL provided', async () => {
        await expect(createJsonRpcProvider()).rejects.toThrow('RPC URL is required to create a provider');
        await expect(createJsonRpcProvider('')).rejects.toThrow('RPC URL is required to create a provider');
        await expect(createJsonRpcProvider(null)).rejects.toThrow('RPC URL is required to create a provider');
        await expect(createJsonRpcProvider(undefined)).rejects.toThrow('RPC URL is required to create a provider');
      });

      it('should throw error for invalid URL formats', async () => {
        await expect(createJsonRpcProvider('Hello World')).rejects.toThrow('Invalid RPC URL format: Hello World. Must be a valid HTTP/HTTPS/WS/WSS URL.');
        await expect(createJsonRpcProvider('not-a-url')).rejects.toThrow('Invalid RPC URL format: not-a-url. Must be a valid HTTP/HTTPS/WS/WSS URL.');
        await expect(createJsonRpcProvider('123456')).rejects.toThrow('Invalid RPC URL format: 123456. Must be a valid HTTP/HTTPS/WS/WSS URL.');
        await expect(createJsonRpcProvider('ftp://example.com')).rejects.toThrow('Invalid RPC URL format: ftp://example.com. Must be a valid HTTP/HTTPS/WS/WSS URL.');
        await expect(createJsonRpcProvider('http://[]')).rejects.toThrow('Invalid RPC URL format: http://[]. Must be a valid HTTP/HTTPS/WS/WSS URL.');
      });

      it('should throw error for unreachable endpoints', async () => {
        // Test various unreachable endpoints that will fail fast
        await expect(createJsonRpcProvider('http://localhost:99999')).rejects.toThrow('Provider connectivity test failed');
        await expect(createJsonRpcProvider('https://localhost:99999')).rejects.toThrow('Provider connectivity test failed');
        await expect(createJsonRpcProvider('ws://nonexistent.invalid')).rejects.toThrow('Provider connectivity test failed');
        await expect(createJsonRpcProvider('wss://nonexistent.invalid:12345')).rejects.toThrow('Provider connectivity test failed');
      });
    });
  });

  describe('getConnectedAccounts', () => {
    describe('Success Cases', () => {
      it('should return array of connected accounts', async () => {
        // Create a real provider using our ganache instance
        const provider = await createJsonRpcProvider('http://localhost:8545');

        const accounts = await getConnectedAccounts(provider);

        expect(Array.isArray(accounts)).toBe(true);
        expect(accounts.length).toBe(10); // Ganache provides 10 test accounts
        
        // Verify we get the exact first Ganache test account
        expect(accounts[0]).toBe(env.accounts[0].address);
        
        // All accounts should be valid addresses
        accounts.forEach(account => {
          expect(typeof account).toBe('string');
          expect(account).toMatch(/^0x[a-fA-F0-9]{40}$/);
        });
      });
    });

    describe('Error Cases', () => {
      it('should throw error if provider is null', async () => {
        await expect(getConnectedAccounts(null)).rejects.toThrow('Provider is required to get connected accounts');
      });

      it('should throw error if provider is undefined', async () => {
        await expect(getConnectedAccounts(undefined)).rejects.toThrow('Provider is required to get connected accounts');
      });

      it('should throw error if provider is not an ethers provider', async () => {
        const fakeProvider = { listAccounts: vi.fn() };
        await expect(getConnectedAccounts(fakeProvider)).rejects.toThrow('Invalid provider. Must be an ethers provider instance.');
      });

      it('should throw error with details when listAccounts fails', async () => {
        const mockProvider = {
          listAccounts: vi.fn().mockRejectedValue(new Error('Network error'))
        };

        Object.setPrototypeOf(mockProvider, ethers.AbstractProvider.prototype);

        await expect(getConnectedAccounts(mockProvider)).rejects.toThrow('Failed to get connected accounts: Network error');
      });
    });
  });

  describe('requestWalletConnection', () => {
    describe('Success Cases', () => {
      it('should request accounts and return them', async () => {
        const mockAccounts = ['0x1234567890123456789012345678901234567890'];
        const mockProvider = {
          send: vi.fn().mockResolvedValue(mockAccounts)
        };
        
        Object.setPrototypeOf(mockProvider, ethers.AbstractProvider.prototype);
        
        const accounts = await requestWalletConnection(mockProvider);
        
        expect(mockProvider.send).toHaveBeenCalledWith('eth_requestAccounts', []);
        expect(accounts).toEqual(mockAccounts);
      });
    });

    describe('Error Cases', () => {
      it('should throw error if provider is null', async () => {
        await expect(requestWalletConnection(null)).rejects.toThrow('A browser provider is required to request wallet connection');
      });

      it('should throw error if provider is undefined', async () => {
        await expect(requestWalletConnection(undefined)).rejects.toThrow('A browser provider is required to request wallet connection');
      });

      it('should throw error if provider is JsonRpcProvider', async () => {
        const rpcProvider = await createJsonRpcProvider('http://localhost:8545');
        await expect(requestWalletConnection(rpcProvider)).rejects.toThrow('A browser provider is required to request wallet connection');
      });

      it('should throw error if provider is not an ethers provider', async () => {
        const fakeProvider = { send: vi.fn() };
        await expect(requestWalletConnection(fakeProvider)).rejects.toThrow('Invalid provider. Must be an ethers provider instance.');
      });

      it('should throw descriptive error when wallet connection fails', async () => {
        const mockProvider = {
          send: vi.fn().mockRejectedValue(new Error('User rejected request'))
        };
        
        Object.setPrototypeOf(mockProvider, ethers.AbstractProvider.prototype);
        
        await expect(requestWalletConnection(mockProvider)).rejects.toThrow('Failed to connect to wallet: User rejected request');
      });

      it('should handle errors without message property', async () => {
        const mockProvider = {
          send: vi.fn().mockRejectedValue({ code: 4001 }) // User rejection code without message
        };
        
        Object.setPrototypeOf(mockProvider, ethers.AbstractProvider.prototype);
        
        await expect(requestWalletConnection(mockProvider)).rejects.toThrow('Failed to connect to wallet: Unknown error');
      });
    });
  });

  describe('getChainId', () => {
    describe('Success Cases', () => {
      it('should return chain ID from provider', async () => {
        const provider = await createJsonRpcProvider('http://localhost:8545');
        const chainId = await getChainId(provider);
        
        expect(chainId).toBe(1337); // Ganache fork chain ID
        expect(typeof chainId).toBe('number');
      });
    });

    describe('Error Cases', () => {
      it('should throw error if provider is null', async () => {
        await expect(getChainId(null)).rejects.toThrow('Provider is required to get chain ID');
      });

      it('should throw error if provider is undefined', async () => {
        await expect(getChainId(undefined)).rejects.toThrow('Provider is required to get chain ID');
      });

      it('should throw error if provider is not an ethers provider', async () => {
        const fakeProvider = { getNetwork: vi.fn() };
        await expect(getChainId(fakeProvider)).rejects.toThrow('Invalid provider. Must be an ethers provider instance.');
      });
    });
  });

  describe('switchChain', () => {
    describe('Success Cases', () => {
      it('should switch chain directly when already available in wallet', async () => {
        const mockProvider = {
          send: vi.fn().mockResolvedValue(true)
        };
        
        Object.setPrototypeOf(mockProvider, ethers.AbstractProvider.prototype);
        
        const result = await switchChain(mockProvider, 137);
        
        expect(mockProvider.send).toHaveBeenCalledWith('wallet_switchEthereumChain', [{ chainId: '0x89' }]);
        expect(result).toBe(true);
      });

      it('should add chain from config and then switch when chain not in wallet', async () => {
        const mockProvider = {
          send: vi.fn()
            .mockRejectedValueOnce({ code: 4902, message: 'Unrecognized chain ID' }) // First call fails
            .mockResolvedValueOnce(true) // Add chain succeeds
            .mockResolvedValueOnce(true) // Switch chain succeeds
        };
        
        Object.setPrototypeOf(mockProvider, ethers.AbstractProvider.prototype);
        
        const result = await switchChain(mockProvider, 42161); // Use Arbitrum which is in our configs
        
        expect(mockProvider.send).toHaveBeenCalledTimes(3);
        expect(mockProvider.send).toHaveBeenNthCalledWith(1, 'wallet_switchEthereumChain', [{ chainId: '0xa4b1' }]);
        expect(mockProvider.send).toHaveBeenNthCalledWith(2, 'wallet_addEthereumChain', [{
          chainId: '0xa4b1',
          chainName: 'Arbitrum One',
          nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
          rpcUrls: ['https://arb1.arbitrum.io/rpc'],
          blockExplorerUrls: ['https://arbiscan.io']
        }]);
        expect(mockProvider.send).toHaveBeenNthCalledWith(3, 'wallet_switchEthereumChain', [{ chainId: '0xa4b1' }]);
        expect(result).toBe(true);
      });

      it('should return false when chain not in wallet and not in our configs', async () => {
        const mockProvider = {
          send: vi.fn().mockRejectedValue({ code: 4902, message: 'Unrecognized chain ID' })
        };
        
        Object.setPrototypeOf(mockProvider, ethers.AbstractProvider.prototype);
        
        const result = await switchChain(mockProvider, 999); // Chain ID not in our configs
        
        expect(mockProvider.send).toHaveBeenCalledTimes(1);
        expect(result).toBe(false);
      });
    });

    describe('Error Cases', () => {
      it('should throw error if provider is null', async () => {
        await expect(switchChain(null, 137)).rejects.toThrow('A browser provider is required to switch chains');
      });

      it('should throw error if provider is undefined', async () => {
        await expect(switchChain(undefined, 137)).rejects.toThrow('A browser provider is required to switch chains');
      });

      it('should throw error if provider is JsonRpcProvider', async () => {
        const rpcProvider = await createJsonRpcProvider('http://localhost:8545');
        await expect(switchChain(rpcProvider, 137)).rejects.toThrow('A browser provider is required to switch chains');
      });

      it('should throw error if provider is not an ethers provider', async () => {
        const fakeProvider = { send: vi.fn() };
        await expect(switchChain(fakeProvider, 137)).rejects.toThrow('Invalid provider. Must be an ethers provider instance.');
      });

      it('should throw error if chainId is not a number', async () => {
        const mockProvider = { send: vi.fn() };
        Object.setPrototypeOf(mockProvider, ethers.AbstractProvider.prototype);
        
        await expect(switchChain(mockProvider, '137')).rejects.toThrow('Chain ID must be a number');
        await expect(switchChain(mockProvider, '0x89')).rejects.toThrow('Chain ID must be a number');
        await expect(switchChain(mockProvider, null)).rejects.toThrow('Chain ID must be a number');
      });

      it('should return false on generic wallet errors', async () => {
        const mockProvider = {
          send: vi.fn().mockRejectedValue({ code: 4001, message: 'User rejected request' })
        };
        
        Object.setPrototypeOf(mockProvider, ethers.AbstractProvider.prototype);
        
        const result = await switchChain(mockProvider, 137);
        
        expect(result).toBe(false);
      });

      it('should return false when chain add fails', async () => {
        const mockProvider = {
          send: vi.fn()
            .mockRejectedValueOnce({ code: 4902, message: 'Unrecognized chain ID' }) // First call fails
            .mockRejectedValueOnce({ code: 4001, message: 'User rejected adding chain' }) // Add chain fails
        };
        
        Object.setPrototypeOf(mockProvider, ethers.AbstractProvider.prototype);
        
        const result = await switchChain(mockProvider, 42161); // Use Arbitrum config but fail on add
        
        expect(result).toBe(false);
      });
    });
  });
});
