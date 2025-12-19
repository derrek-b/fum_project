/**
 * Permit2Helper Unit Tests
 *
 * Tests for the reusable Permit2 signature and calldata wrapping functions
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ethers } from 'ethers';
import {
  PERMIT2_ADDRESS,
  getPermit2Nonce,
  generatePermit2Signature,
  encodePermit2Input,
  wrapWithPermit2
} from '../../../src/helpers/Permit2Helper.js';

// Mock ethers Contract
vi.mock('ethers', async () => {
  const actual = await vi.importActual('ethers');
  return {
    ...actual,
    ethers: {
      ...actual.ethers,
      Contract: vi.fn()
    }
  };
});

describe('Permit2Helper', () => {
  const VALID_ADDRESS = '0x1234567890123456789012345678901234567890';
  const VALID_TOKEN = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';
  const VALID_SPENDER = '0x9876543210987654321098765432109876543210';

  let mockProvider;
  let mockAllowance;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock provider
    mockProvider = {
      getNetwork: vi.fn().mockResolvedValue({ chainId: 42161 })
    };

    // Create mock allowance function
    mockAllowance = vi.fn().mockResolvedValue([
      ethers.BigNumber.from('1000000000000000000'), // amount
      1700000000, // expiration
      5 // nonce
    ]);

    // Setup mock Contract constructor
    ethers.Contract.mockImplementation(() => ({
      allowance: mockAllowance
    }));
  });

  describe('PERMIT2_ADDRESS constant', () => {
    it('should export the canonical Permit2 address', () => {
      expect(PERMIT2_ADDRESS).toBe('0x000000000022D473030F116dDEE9F6B43aC78BA3');
    });
  });

  describe('getPermit2Nonce', () => {
    describe('Success Cases', () => {
      it('should return nonce from Permit2 contract', async () => {
        const nonce = await getPermit2Nonce(mockProvider, VALID_ADDRESS, VALID_TOKEN, VALID_SPENDER);

        expect(nonce).toBe(5);
        expect(mockAllowance).toHaveBeenCalledWith(VALID_ADDRESS, VALID_TOKEN, VALID_SPENDER);
      });

      it('should return 0 when nonce is 0', async () => {
        mockAllowance.mockResolvedValueOnce([
          ethers.BigNumber.from('0'),
          0,
          0
        ]);

        const nonce = await getPermit2Nonce(mockProvider, VALID_ADDRESS, VALID_TOKEN, VALID_SPENDER);

        expect(nonce).toBe(0);
      });
    });

    describe('Error Cases', () => {
      it('should throw error when provider is missing', async () => {
        await expect(getPermit2Nonce(null, VALID_ADDRESS, VALID_TOKEN, VALID_SPENDER))
          .rejects.toThrow('getPermit2Nonce: provider is required');
      });

      it('should throw error for invalid ownerAddress', async () => {
        await expect(getPermit2Nonce(mockProvider, null, VALID_TOKEN, VALID_SPENDER))
          .rejects.toThrow('getPermit2Nonce: invalid ownerAddress');
        await expect(getPermit2Nonce(mockProvider, 'invalid', VALID_TOKEN, VALID_SPENDER))
          .rejects.toThrow('getPermit2Nonce: invalid ownerAddress');
        await expect(getPermit2Nonce(mockProvider, '', VALID_TOKEN, VALID_SPENDER))
          .rejects.toThrow('getPermit2Nonce: invalid ownerAddress');
      });

      it('should throw error for invalid tokenAddress', async () => {
        await expect(getPermit2Nonce(mockProvider, VALID_ADDRESS, null, VALID_SPENDER))
          .rejects.toThrow('getPermit2Nonce: invalid tokenAddress');
        await expect(getPermit2Nonce(mockProvider, VALID_ADDRESS, 'invalid', VALID_SPENDER))
          .rejects.toThrow('getPermit2Nonce: invalid tokenAddress');
      });

      it('should throw error for invalid spenderAddress', async () => {
        await expect(getPermit2Nonce(mockProvider, VALID_ADDRESS, VALID_TOKEN, null))
          .rejects.toThrow('getPermit2Nonce: invalid spenderAddress');
        await expect(getPermit2Nonce(mockProvider, VALID_ADDRESS, VALID_TOKEN, 'invalid'))
          .rejects.toThrow('getPermit2Nonce: invalid spenderAddress');
      });
    });
  });

  describe('generatePermit2Signature', () => {
    let mockSigner;

    beforeEach(() => {
      // Create mock signer with _signTypedData
      mockSigner = {
        _signTypedData: vi.fn().mockResolvedValue(
          '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef12'
        )
      };
    });

    describe('Success Cases', () => {
      it('should generate signature and return permit data', async () => {
        const deadline = Math.floor(Date.now() / 1000) + 1800;
        const amount = '1000000000000000000';

        const result = await generatePermit2Signature(
          mockSigner,
          42161,
          VALID_TOKEN,
          amount,
          VALID_SPENDER,
          5,
          deadline
        );

        expect(result.signature).toBeDefined();
        expect(result.signature.startsWith('0x')).toBe(true);
        expect(result.permitData).toBeDefined();
        expect(result.permitData.details.token).toBe(VALID_TOKEN);
        expect(result.permitData.details.amount).toBe(amount);
        expect(result.permitData.details.expiration).toBe(deadline);
        expect(result.permitData.details.nonce).toBe(5);
        expect(result.permitData.spender).toBe(VALID_SPENDER);
        expect(result.permitData.sigDeadline).toBe(deadline);
      });

      it('should call _signTypedData with correct EIP-712 types', async () => {
        const deadline = Math.floor(Date.now() / 1000) + 1800;

        await generatePermit2Signature(
          mockSigner,
          42161,
          VALID_TOKEN,
          '1000000000000000000',
          VALID_SPENDER,
          5,
          deadline
        );

        const typesArg = mockSigner._signTypedData.mock.calls[0][1];
        expect(typesArg.PermitSingle).toBeDefined();
        expect(typesArg.PermitDetails).toBeDefined();
        expect(typesArg.PermitSingle).toContainEqual({ name: 'details', type: 'PermitDetails' });
        expect(typesArg.PermitSingle).toContainEqual({ name: 'spender', type: 'address' });
        expect(typesArg.PermitSingle).toContainEqual({ name: 'sigDeadline', type: 'uint256' });
      });
    });

    describe('Error Cases', () => {
      it('should throw error when signer is missing _signTypedData', async () => {
        const invalidSigner = { sign: vi.fn() };
        const deadline = Math.floor(Date.now() / 1000) + 1800;

        await expect(generatePermit2Signature(
          invalidSigner,
          42161,
          VALID_TOKEN,
          '1000000000000000000',
          VALID_SPENDER,
          0,
          deadline
        )).rejects.toThrow('generatePermit2Signature: signer must be an ethers Wallet with _signTypedData');
      });

      it('should throw error when signer is null', async () => {
        const deadline = Math.floor(Date.now() / 1000) + 1800;

        await expect(generatePermit2Signature(
          null,
          42161,
          VALID_TOKEN,
          '1000000000000000000',
          VALID_SPENDER,
          0,
          deadline
        )).rejects.toThrow('generatePermit2Signature: signer must be an ethers Wallet with _signTypedData');
      });

      it('should throw error when chainId is not a number', async () => {
        const deadline = Math.floor(Date.now() / 1000) + 1800;

        await expect(generatePermit2Signature(
          mockSigner,
          '42161',
          VALID_TOKEN,
          '1000000000000000000',
          VALID_SPENDER,
          0,
          deadline
        )).rejects.toThrow('generatePermit2Signature: chainId must be a number');
      });

      it('should throw error for invalid tokenAddress', async () => {
        const deadline = Math.floor(Date.now() / 1000) + 1800;

        await expect(generatePermit2Signature(
          mockSigner,
          42161,
          'invalid',
          '1000000000000000000',
          VALID_SPENDER,
          0,
          deadline
        )).rejects.toThrow('generatePermit2Signature: invalid tokenAddress');
      });

      it('should throw error when amount is missing', async () => {
        const deadline = Math.floor(Date.now() / 1000) + 1800;

        await expect(generatePermit2Signature(
          mockSigner,
          42161,
          VALID_TOKEN,
          null,
          VALID_SPENDER,
          0,
          deadline
        )).rejects.toThrow('generatePermit2Signature: amount is required');
      });

      it('should throw error for invalid spenderAddress', async () => {
        const deadline = Math.floor(Date.now() / 1000) + 1800;

        await expect(generatePermit2Signature(
          mockSigner,
          42161,
          VALID_TOKEN,
          '1000000000000000000',
          'invalid',
          0,
          deadline
        )).rejects.toThrow('generatePermit2Signature: invalid spenderAddress');
      });

      it('should throw error for negative nonce', async () => {
        const deadline = Math.floor(Date.now() / 1000) + 1800;

        await expect(generatePermit2Signature(
          mockSigner,
          42161,
          VALID_TOKEN,
          '1000000000000000000',
          VALID_SPENDER,
          -1,
          deadline
        )).rejects.toThrow('generatePermit2Signature: nonce must be a non-negative number');
      });

      it('should throw error for non-number nonce', async () => {
        const deadline = Math.floor(Date.now() / 1000) + 1800;

        await expect(generatePermit2Signature(
          mockSigner,
          42161,
          VALID_TOKEN,
          '1000000000000000000',
          VALID_SPENDER,
          '5',
          deadline
        )).rejects.toThrow('generatePermit2Signature: nonce must be a non-negative number');
      });

      it('should throw error for invalid deadline', async () => {
        await expect(generatePermit2Signature(
          mockSigner,
          42161,
          VALID_TOKEN,
          '1000000000000000000',
          VALID_SPENDER,
          0,
          0
        )).rejects.toThrow('generatePermit2Signature: deadline must be a positive number');

        await expect(generatePermit2Signature(
          mockSigner,
          42161,
          VALID_TOKEN,
          '1000000000000000000',
          VALID_SPENDER,
          0,
          -100
        )).rejects.toThrow('generatePermit2Signature: deadline must be a positive number');
      });

      it('should throw error when amount exceeds uint160 max', async () => {
        const deadline = Math.floor(Date.now() / 1000) + 1800;
        // uint160 max is 2^160 - 1, this exceeds it
        const hugeAmount = ethers.BigNumber.from(2).pow(161).toString();

        await expect(generatePermit2Signature(
          mockSigner,
          42161,
          VALID_TOKEN,
          hugeAmount,
          VALID_SPENDER,
          0,
          deadline
        )).rejects.toThrow('generatePermit2Signature: amount exceeds uint160 maximum');
      });
    });
  });

  describe('encodePermit2Input', () => {
    describe('Success Cases', () => {
      it('should encode permit data and signature correctly', () => {
        const permitData = {
          details: {
            token: VALID_TOKEN,
            amount: '1000000000000000000',
            expiration: 1700000000,
            nonce: 5
          },
          spender: VALID_SPENDER,
          sigDeadline: 1700000000
        };
        const signature = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef12';

        const encoded = encodePermit2Input(permitData, signature);

        expect(encoded).toBeDefined();
        expect(typeof encoded).toBe('string');
        expect(encoded.startsWith('0x')).toBe(true);
        // Should be able to decode it back
        const decoded = ethers.utils.defaultAbiCoder.decode(
          [
            'tuple(tuple(address token, uint160 amount, uint48 expiration, uint48 nonce) details, address spender, uint256 sigDeadline)',
            'bytes'
          ],
          encoded
        );
        expect(decoded[0].details.token.toLowerCase()).toBe(VALID_TOKEN.toLowerCase());
        expect(decoded[1]).toBe(signature);
      });
    });

    describe('Error Cases', () => {
      it('should throw error when permitData is missing', () => {
        const signature = '0x1234';

        expect(() => encodePermit2Input(null, signature))
          .toThrow('encodePermit2Input: invalid permitData');
        expect(() => encodePermit2Input(undefined, signature))
          .toThrow('encodePermit2Input: invalid permitData');
      });

      it('should throw error when permitData.details is missing', () => {
        const permitData = { spender: VALID_SPENDER, sigDeadline: 1700000000 };
        const signature = '0x1234';

        expect(() => encodePermit2Input(permitData, signature))
          .toThrow('encodePermit2Input: invalid permitData');
      });

      it('should throw error when signature is missing', () => {
        const permitData = {
          details: {
            token: VALID_TOKEN,
            amount: '1000000000000000000',
            expiration: 1700000000,
            nonce: 5
          },
          spender: VALID_SPENDER,
          sigDeadline: 1700000000
        };

        expect(() => encodePermit2Input(permitData, null))
          .toThrow('encodePermit2Input: signature must be a string');
        expect(() => encodePermit2Input(permitData, 123))
          .toThrow('encodePermit2Input: signature must be a string');
      });
    });
  });

  describe('wrapWithPermit2', () => {
    let mockRouterInterface;

    beforeEach(() => {
      // Create mock router interface
      mockRouterInterface = {
        decodeFunctionData: vi.fn().mockReturnValue({
          commands: '0x0b00',
          inputs: ['0xinput1', '0xinput2']
        }),
        encodeFunctionData: vi.fn().mockReturnValue('0xwrappedCalldata')
      };
    });

    describe('Success Cases', () => {
      it('should prepend PERMIT2_PERMIT command to calldata', () => {
        const permitData = {
          details: {
            token: VALID_TOKEN,
            amount: '1000000000000000000',
            expiration: 1700000000,
            nonce: 5
          },
          spender: VALID_SPENDER,
          sigDeadline: 1700000000
        };
        const signature = '0x1234567890abcdef';
        const swapCalldata = '0xoriginalCalldata';

        const result = wrapWithPermit2(
          mockRouterInterface,
          swapCalldata,
          permitData,
          signature
        );

        expect(result).toBe('0xwrappedCalldata');

        // Verify decodeFunctionData was called correctly
        expect(mockRouterInterface.decodeFunctionData).toHaveBeenCalledWith(
          'execute(bytes,bytes[])',
          swapCalldata
        );

        // Verify encodeFunctionData was called with PERMIT2_PERMIT (0x0a) prepended
        const encodeCall = mockRouterInterface.encodeFunctionData.mock.calls[0];
        expect(encodeCall[0]).toBe('execute(bytes,bytes[])');
        expect(encodeCall[1][0]).toBe('0x0a0b00'); // 0x0a prepended to 0x0b00
        expect(encodeCall[1][1].length).toBe(3); // permit input + 2 original inputs
      });

      it('should include permit2 encoded input as first element', () => {
        const permitData = {
          details: {
            token: VALID_TOKEN,
            amount: '1000000000000000000',
            expiration: 1700000000,
            nonce: 5
          },
          spender: VALID_SPENDER,
          sigDeadline: 1700000000
        };
        const signature = '0x1234567890abcdef';
        const swapCalldata = '0xoriginalCalldata';

        wrapWithPermit2(
          mockRouterInterface,
          swapCalldata,
          permitData,
          signature
        );

        const encodeCall = mockRouterInterface.encodeFunctionData.mock.calls[0];
        const inputs = encodeCall[1][1];

        // First input should be the permit2 encoded data
        expect(inputs[0]).toBeDefined();
        expect(typeof inputs[0]).toBe('string');
        expect(inputs[0].startsWith('0x')).toBe(true);

        // Original inputs should follow
        expect(inputs[1]).toBe('0xinput1');
        expect(inputs[2]).toBe('0xinput2');
      });
    });

    describe('Error Cases', () => {
      it('should throw error when routerInterface is invalid', () => {
        const permitData = {
          details: {
            token: VALID_TOKEN,
            amount: '1000000000000000000',
            expiration: 1700000000,
            nonce: 5
          },
          spender: VALID_SPENDER,
          sigDeadline: 1700000000
        };
        const signature = '0x1234';

        expect(() => wrapWithPermit2(null, '0xdata', permitData, signature))
          .toThrow('wrapWithPermit2: routerInterface must be an ethers Interface');

        expect(() => wrapWithPermit2({}, '0xdata', permitData, signature))
          .toThrow('wrapWithPermit2: routerInterface must be an ethers Interface');
      });

      it('should throw error when swapCalldata is invalid', () => {
        const permitData = {
          details: {
            token: VALID_TOKEN,
            amount: '1000000000000000000',
            expiration: 1700000000,
            nonce: 5
          },
          spender: VALID_SPENDER,
          sigDeadline: 1700000000
        };
        const signature = '0x1234';

        expect(() => wrapWithPermit2(mockRouterInterface, null, permitData, signature))
          .toThrow('wrapWithPermit2: swapCalldata must be a string');

        expect(() => wrapWithPermit2(mockRouterInterface, 123, permitData, signature))
          .toThrow('wrapWithPermit2: swapCalldata must be a string');
      });
    });
  });
});
