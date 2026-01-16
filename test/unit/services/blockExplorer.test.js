/**
 * Block Explorer Service Unit Tests
 *
 * Tests for the factory-based block explorer service
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  configureBlockExplorer,
  getBlockExplorerConfig,
  resetBlockExplorerConfig,
  getBlockExplorerService,
} from '../../../src/services/blockExplorer.js';

describe('Block Explorer Service', () => {
  beforeEach(() => {
    resetBlockExplorerConfig();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('configureBlockExplorer', () => {
    it('should set arbiscan API key', () => {
      configureBlockExplorer({ arbiscanApiKey: 'test-arbiscan-key' });

      const config = getBlockExplorerConfig();
      expect(config.arbiscanApiKey).toBe('test-arbiscan-key');
    });

    it('should set alchemy API key', () => {
      configureBlockExplorer({ alchemyApiKey: 'test-alchemy-key' });

      const config = getBlockExplorerConfig();
      expect(config.alchemyApiKey).toBe('test-alchemy-key');
    });

    it('should set both API keys', () => {
      configureBlockExplorer({
        arbiscanApiKey: 'test-arbiscan-key',
        alchemyApiKey: 'test-alchemy-key',
      });

      const config = getBlockExplorerConfig();
      expect(config.arbiscanApiKey).toBe('test-arbiscan-key');
      expect(config.alchemyApiKey).toBe('test-alchemy-key');
    });

    it('should not overwrite unspecified keys', () => {
      configureBlockExplorer({ arbiscanApiKey: 'test-arbiscan-key' });
      configureBlockExplorer({ alchemyApiKey: 'test-alchemy-key' });

      const config = getBlockExplorerConfig();
      expect(config.arbiscanApiKey).toBe('test-arbiscan-key');
      expect(config.alchemyApiKey).toBe('test-alchemy-key');
    });

    it('should handle empty options object', () => {
      configureBlockExplorer({});

      const config = getBlockExplorerConfig();
      expect(config.arbiscanApiKey).toBeNull();
      expect(config.alchemyApiKey).toBeNull();
    });

    it('should handle no arguments', () => {
      configureBlockExplorer();

      const config = getBlockExplorerConfig();
      expect(config.arbiscanApiKey).toBeNull();
      expect(config.alchemyApiKey).toBeNull();
    });
  });

  describe('resetBlockExplorerConfig', () => {
    it('should reset all config to null', () => {
      configureBlockExplorer({
        arbiscanApiKey: 'test-key',
        alchemyApiKey: 'test-key',
      });

      resetBlockExplorerConfig();

      const config = getBlockExplorerConfig();
      expect(config.arbiscanApiKey).toBeNull();
      expect(config.alchemyApiKey).toBeNull();
    });
  });

  describe('getBlockExplorerConfig', () => {
    it('should return a copy of config (not the original)', () => {
      configureBlockExplorer({ arbiscanApiKey: 'original' });

      const config = getBlockExplorerConfig();
      config.arbiscanApiKey = 'modified';

      const config2 = getBlockExplorerConfig();
      expect(config2.arbiscanApiKey).toBe('original');
    });
  });

  describe('getBlockExplorerService', () => {
    describe('Parameter Validation', () => {
      it('should throw for non-number chainId', () => {
        expect(() => getBlockExplorerService('42161')).toThrow('chainId must be a finite number');
      });

      it('should throw for NaN chainId', () => {
        expect(() => getBlockExplorerService(NaN)).toThrow('chainId must be a finite number');
      });

      it('should throw for Infinity chainId', () => {
        expect(() => getBlockExplorerService(Infinity)).toThrow('chainId must be a finite number');
      });

      it('should throw for null chainId', () => {
        expect(() => getBlockExplorerService(null)).toThrow('chainId must be a finite number');
      });

      it('should throw for undefined chainId', () => {
        expect(() => getBlockExplorerService(undefined)).toThrow('chainId must be a finite number');
      });

      it('should throw for unsupported chainId', () => {
        expect(() => getBlockExplorerService(999999)).toThrow('No block explorer configured for chainId 999999');
      });
    });

    describe('Factory Behavior', () => {
      it('should return arbiscan service for chainId 42161 (Arbitrum)', () => {
        const service = getBlockExplorerService(42161);

        expect(service).toBeDefined();
        expect(typeof service.getInternalTransactions).toBe('function');
        expect(typeof service.getEthTransfersForWallet).toBe('function');
      });

      it('should return arbiscan service for chainId 1337 (local fork)', () => {
        const service = getBlockExplorerService(1337);

        expect(service).toBeDefined();
        expect(typeof service.getInternalTransactions).toBe('function');
        expect(typeof service.getEthTransfersForWallet).toBe('function');
      });

      it('should throw "not yet implemented" for chainId 1 (Ethereum)', () => {
        expect(() => getBlockExplorerService(1)).toThrow('Alchemy block explorer not yet implemented for chainId 1');
      });

      it('should throw "not yet implemented" for chainId 137 (Polygon)', () => {
        expect(() => getBlockExplorerService(137)).toThrow('Alchemy block explorer not yet implemented for chainId 137');
      });
    });
  });

  describe('Arbiscan Service', () => {
    let service;

    beforeEach(() => {
      service = getBlockExplorerService(42161);
    });

    describe('getInternalTransactions', () => {
      describe('Parameter Validation', () => {
        it('should throw for null txHash', async () => {
          await expect(service.getInternalTransactions(null))
            .rejects.toThrow('txHash is required and must be a string');
        });

        it('should throw for undefined txHash', async () => {
          await expect(service.getInternalTransactions(undefined))
            .rejects.toThrow('txHash is required and must be a string');
        });

        it('should throw for non-string txHash', async () => {
          await expect(service.getInternalTransactions(123))
            .rejects.toThrow('txHash is required and must be a string');
        });

        it('should throw for empty string txHash', async () => {
          await expect(service.getInternalTransactions(''))
            .rejects.toThrow('txHash is required and must be a string');
        });

        it('should throw for invalid hash format (too short)', async () => {
          await expect(service.getInternalTransactions('0x123'))
            .rejects.toThrow('Invalid transaction hash format');
        });

        it('should throw for invalid hash format (missing 0x prefix)', async () => {
          await expect(service.getInternalTransactions('1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'))
            .rejects.toThrow('Invalid transaction hash format');
        });

        it('should throw for invalid hash format (invalid characters)', async () => {
          await expect(service.getInternalTransactions('0xGGGG567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'))
            .rejects.toThrow('Invalid transaction hash format');
        });
      });

      describe('Success Cases', () => {
        it('should return internal transactions array', async () => {
          const mockResponse = {
            status: '1',
            message: 'OK',
            result: [
              {
                blockNumber: '123456',
                timeStamp: '1234567890',
                hash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
                from: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                to: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
                value: '1000000000000000000',
                type: 'call',
                isError: '0',
              },
            ],
          };

          vi.spyOn(global, 'fetch').mockResolvedValueOnce({
            ok: true,
            json: async () => mockResponse,
          });

          const result = await service.getInternalTransactions(
            '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
          );

          expect(Array.isArray(result)).toBe(true);
          expect(result).toHaveLength(1);
          expect(result[0].value).toBe('1000000000000000000');
        });

        it('should return empty array when no internal transactions', async () => {
          const mockResponse = {
            status: '0',
            message: 'No transactions found',
            result: [],
          };

          vi.spyOn(global, 'fetch').mockResolvedValueOnce({
            ok: true,
            json: async () => mockResponse,
          });

          const result = await service.getInternalTransactions(
            '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
          );

          expect(Array.isArray(result)).toBe(true);
          expect(result).toHaveLength(0);
        });

        it('should include API key in request when configured', async () => {
          configureBlockExplorer({ arbiscanApiKey: 'test-api-key' });
          const serviceWithKey = getBlockExplorerService(42161);

          const mockFetch = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
            ok: true,
            json: async () => ({ status: '1', message: 'OK', result: [] }),
          });

          await serviceWithKey.getInternalTransactions(
            '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
          );

          expect(mockFetch).toHaveBeenCalledTimes(1);
          const calledUrl = mockFetch.mock.calls[0][0];
          expect(calledUrl).toContain('apikey=test-api-key');
        });

        it('should not include API key in request when not configured', async () => {
          const mockFetch = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
            ok: true,
            json: async () => ({ status: '1', message: 'OK', result: [] }),
          });

          await service.getInternalTransactions(
            '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
          );

          expect(mockFetch).toHaveBeenCalledTimes(1);
          const calledUrl = mockFetch.mock.calls[0][0];
          expect(calledUrl).not.toContain('apikey=');
        });
      });

      describe('Error Cases', () => {
        it('should throw on HTTP error', async () => {
          vi.spyOn(global, 'fetch').mockResolvedValueOnce({
            ok: false,
            status: 500,
            statusText: 'Internal Server Error',
          });

          await expect(
            service.getInternalTransactions(
              '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
            )
          ).rejects.toThrow('Arbiscan API error: 500 Internal Server Error');
        });

        it('should throw on API error response', async () => {
          const mockResponse = {
            status: '0',
            message: 'NOTOK',
            result: 'Max rate limit reached',
          };

          vi.spyOn(global, 'fetch').mockResolvedValueOnce({
            ok: true,
            json: async () => mockResponse,
          });

          await expect(
            service.getInternalTransactions(
              '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
            )
          ).rejects.toThrow('Arbiscan API error: NOTOK');
        });

        it('should handle null result in response', async () => {
          const mockResponse = {
            status: '1',
            message: 'OK',
            result: null,
          };

          vi.spyOn(global, 'fetch').mockResolvedValueOnce({
            ok: true,
            json: async () => mockResponse,
          });

          const result = await service.getInternalTransactions(
            '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
          );

          expect(result).toEqual([]);
        });
      });
    });

    describe('getEthTransfersForWallet', () => {
      describe('Parameter Validation', () => {
        it('should throw for null wallet address', async () => {
          vi.spyOn(global, 'fetch').mockResolvedValueOnce({
            ok: true,
            json: async () => ({ status: '1', message: 'OK', result: [] }),
          });

          await expect(
            service.getEthTransfersForWallet(
              '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
              null
            )
          ).rejects.toThrow('walletAddress is required and must be a string');
        });

        it('should throw for undefined wallet address', async () => {
          vi.spyOn(global, 'fetch').mockResolvedValueOnce({
            ok: true,
            json: async () => ({ status: '1', message: 'OK', result: [] }),
          });

          await expect(
            service.getEthTransfersForWallet(
              '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
              undefined
            )
          ).rejects.toThrow('walletAddress is required and must be a string');
        });

        it('should throw for non-string wallet address', async () => {
          vi.spyOn(global, 'fetch').mockResolvedValueOnce({
            ok: true,
            json: async () => ({ status: '1', message: 'OK', result: [] }),
          });

          await expect(
            service.getEthTransfersForWallet(
              '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
              12345
            )
          ).rejects.toThrow('walletAddress is required and must be a string');
        });
      });

      describe('Success Cases', () => {
        const txHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
        const walletAddress = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

        it('should sum received ETH correctly', async () => {
          const mockResponse = {
            status: '1',
            message: 'OK',
            result: [
              {
                from: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
                to: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                value: '1000000000000000000', // 1 ETH
                isError: '0',
              },
              {
                from: '0xcccccccccccccccccccccccccccccccccccccccc',
                to: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                value: '500000000000000000', // 0.5 ETH
                isError: '0',
              },
            ],
          };

          vi.spyOn(global, 'fetch').mockResolvedValueOnce({
            ok: true,
            json: async () => mockResponse,
          });

          const result = await service.getEthTransfersForWallet(txHash, walletAddress);

          expect(result.received.toString()).toBe('1500000000000000000'); // 1.5 ETH
          expect(result.sent.toString()).toBe('0');
        });

        it('should sum sent ETH correctly', async () => {
          const mockResponse = {
            status: '1',
            message: 'OK',
            result: [
              {
                from: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                to: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
                value: '2000000000000000000', // 2 ETH
                isError: '0',
              },
            ],
          };

          vi.spyOn(global, 'fetch').mockResolvedValueOnce({
            ok: true,
            json: async () => mockResponse,
          });

          const result = await service.getEthTransfersForWallet(txHash, walletAddress);

          expect(result.received.toString()).toBe('0');
          expect(result.sent.toString()).toBe('2000000000000000000'); // 2 ETH
        });

        it('should handle case-insensitive addresses', async () => {
          const mockResponse = {
            status: '1',
            message: 'OK',
            result: [
              {
                from: '0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
                to: '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', // uppercase
                value: '1000000000000000000',
                isError: '0',
              },
            ],
          };

          vi.spyOn(global, 'fetch').mockResolvedValueOnce({
            ok: true,
            json: async () => mockResponse,
          });

          // Pass lowercase address
          const result = await service.getEthTransfersForWallet(txHash, walletAddress.toLowerCase());

          expect(result.received.toString()).toBe('1000000000000000000');
        });

        it('should skip failed internal transactions', async () => {
          const mockResponse = {
            status: '1',
            message: 'OK',
            result: [
              {
                from: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
                to: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                value: '1000000000000000000', // 1 ETH - successful
                isError: '0',
              },
              {
                from: '0xcccccccccccccccccccccccccccccccccccccccc',
                to: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                value: '5000000000000000000', // 5 ETH - failed
                isError: '1',
              },
            ],
          };

          vi.spyOn(global, 'fetch').mockResolvedValueOnce({
            ok: true,
            json: async () => mockResponse,
          });

          const result = await service.getEthTransfersForWallet(txHash, walletAddress);

          // Only the successful tx should be counted
          expect(result.received.toString()).toBe('1000000000000000000'); // 1 ETH, not 6 ETH
        });

        it('should skip zero-value transfers', async () => {
          const mockResponse = {
            status: '1',
            message: 'OK',
            result: [
              {
                from: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
                to: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                value: '1000000000000000000', // 1 ETH
                isError: '0',
              },
              {
                from: '0xcccccccccccccccccccccccccccccccccccccccc',
                to: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                value: '0', // 0 ETH
                isError: '0',
              },
            ],
          };

          vi.spyOn(global, 'fetch').mockResolvedValueOnce({
            ok: true,
            json: async () => mockResponse,
          });

          const result = await service.getEthTransfersForWallet(txHash, walletAddress);

          expect(result.received.toString()).toBe('1000000000000000000');
        });

        it('should return zero for both when wallet not involved', async () => {
          const mockResponse = {
            status: '1',
            message: 'OK',
            result: [
              {
                from: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
                to: '0xcccccccccccccccccccccccccccccccccccccccc',
                value: '1000000000000000000',
                isError: '0',
              },
            ],
          };

          vi.spyOn(global, 'fetch').mockResolvedValueOnce({
            ok: true,
            json: async () => mockResponse,
          });

          const result = await service.getEthTransfersForWallet(txHash, walletAddress);

          expect(result.received.toString()).toBe('0');
          expect(result.sent.toString()).toBe('0');
        });

        it('should handle both sent and received in same transaction', async () => {
          const mockResponse = {
            status: '1',
            message: 'OK',
            result: [
              {
                from: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                to: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
                value: '2000000000000000000', // sent 2 ETH
                isError: '0',
              },
              {
                from: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
                to: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                value: '1000000000000000000', // received 1 ETH
                isError: '0',
              },
            ],
          };

          vi.spyOn(global, 'fetch').mockResolvedValueOnce({
            ok: true,
            json: async () => mockResponse,
          });

          const result = await service.getEthTransfersForWallet(txHash, walletAddress);

          expect(result.sent.toString()).toBe('2000000000000000000');
          expect(result.received.toString()).toBe('1000000000000000000');
        });

        it('should handle missing value field gracefully', async () => {
          const mockResponse = {
            status: '1',
            message: 'OK',
            result: [
              {
                from: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
                to: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                // no value field
                isError: '0',
              },
            ],
          };

          vi.spyOn(global, 'fetch').mockResolvedValueOnce({
            ok: true,
            json: async () => mockResponse,
          });

          const result = await service.getEthTransfersForWallet(txHash, walletAddress);

          expect(result.received.toString()).toBe('0');
          expect(result.sent.toString()).toBe('0');
        });
      });
    });
  });
});

// Integration tests - only run if API key is available
describe.skipIf(!process.env.ARBISCAN_API_KEY)('Block Explorer Service - Integration', () => {
  beforeEach(() => {
    configureBlockExplorer({ arbiscanApiKey: process.env.ARBISCAN_API_KEY });
  });

  afterEach(() => {
    resetBlockExplorerConfig();
  });

  it('should fetch real internal transactions for known Arbitrum tx', async () => {
    const service = getBlockExplorerService(42161);
    // Real Arbitrum transaction with internal ETH transfer (0.1 ETH to WETH contract)
    // https://arbiscan.io/tx/0x78c646506f5d246c5981f1b0ef7c1efa24e4b5e4282bb7fdee9936b6df67d611
    const txHash = '0x78c646506f5d246c5981f1b0ef7c1efa24e4b5e4282bb7fdee9936b6df67d611';

    const result = await service.getInternalTransactions(txHash);
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
    // Verify result has expected structure
    expect(result[0]).toHaveProperty('from');
    expect(result[0]).toHaveProperty('to');
    expect(result[0]).toHaveProperty('value');
    // This specific tx sends 0.1 ETH (100000000000000000 wei)
    expect(result[0].value).toBe('100000000000000000');
  });
});
