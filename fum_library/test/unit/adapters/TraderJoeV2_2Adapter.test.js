import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { ethers } from 'ethers';
import TraderJoeV2_2Adapter from '../../../src/adapters/TraderJoeV2_2Adapter.js';
import PlatformAdapter from '../../../src/adapters/PlatformAdapter.js';
import { setupTraderJoeTestEnvironment } from '../../setup/traderjoe-setup.js';
import tokens from '../../../src/configs/tokens.js';
import contractData from '../../../src/artifacts/contracts.js';
import ERC20_ARTIFACT from '@openzeppelin/contracts/build/contracts/ERC20.json' with { type: 'json' };

const ERC20_ABI = ERC20_ARTIFACT.abi;

describe('TraderJoeV2_2Adapter', () => {
  let adapter;
  let env;

  // Shared state for E2E tests
  let testVault;
  let wavax, usdc;
  let wavaxAddress, usdcAddress;

  beforeAll(async () => {
    // Setup Hardhat fork environment with contracts deployed
    env = await setupTraderJoeTestEnvironment({
      port: 8548,
      deployContracts: true,
    });
    adapter = env.adapter;

    // Setup vault and fund it for E2E tests
    const owner = env.signers[0];

    // Create vault
    const vaultFactory = env.contracts.vaultFactory;
    const tx = await vaultFactory.createVault('TJ Test Vault');
    const receipt = await tx.wait();
    const vaultCreatedEvent = receipt.logs.find(log => {
      try {
        const parsed = vaultFactory.interface.parseLog(log);
        return parsed && parsed.name === 'VaultCreated';
      } catch {
        return false;
      }
    });
    const vaultAddress = vaultFactory.interface.parseLog(vaultCreatedEvent).args[1];
    const vaultAbi = contractData.PositionVault.abi;
    testVault = new ethers.Contract(vaultAddress, vaultAbi, owner);

    // Get token addresses for Avalanche fork (chain 1338)
    wavaxAddress = tokens.AVAX.wrappedAddresses[env.chainId];
    usdcAddress = tokens.USDC.addresses[env.chainId];

    // Wrap AVAX to WAVAX
    const WAVAX_ABI = ['function deposit() payable', ...ERC20_ABI];
    wavax = new ethers.Contract(wavaxAddress, WAVAX_ABI, owner);
    usdc = new ethers.Contract(usdcAddress, ERC20_ABI, owner);

    await (await wavax.deposit({ value: ethers.utils.parseEther('5') })).wait();

    // Swap some WAVAX for USDC via Trader Joe LBRouter
    const lbRouterAddress = adapter.addresses.lbRouterAddress;
    await (await wavax.approve(lbRouterAddress, ethers.utils.parseEther('2'))).wait();

    const lbRouterABI = [
      'function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, (uint256[] pairBinSteps, uint8[] versions, address[] tokenPath) path, address to, uint256 deadline) external returns (uint256 amountOut)'
    ];
    const lbRouter = new ethers.Contract(lbRouterAddress, lbRouterABI, owner);

    // WAVAX -> USDC path via Trader Joe
    // binStep 10 (10bps) for WAVAX/USDC pair, version 3 = V2.2
    const swapPath = {
      pairBinSteps: [10],
      versions: [3], // V2.2 (version enum: 0=V1, 1=V2, 2=V2.1, 3=V2.2)
      tokenPath: [wavaxAddress, usdcAddress]
    };

    await (await lbRouter.swapExactTokensForTokens(
      ethers.utils.parseEther('2'),
      0, // amountOutMin
      swapPath,
      owner.address,
      Math.floor(Date.now() / 1000) + 3600
    )).wait();

    // Transfer WAVAX and USDC to vault
    const wavaxBal = await wavax.balanceOf(owner.address);
    const usdcBal = await usdc.balanceOf(owner.address);
    await (await wavax.transfer(vaultAddress, wavaxBal)).wait();
    await (await usdc.transfer(vaultAddress, usdcBal)).wait();

    console.log(`  Vault funded: ${ethers.utils.formatEther(wavaxBal)} WAVAX, ${ethers.utils.formatUnits(usdcBal, 6)} USDC`);
  }, 180000); // 3 minute timeout for setup + funding

  afterAll(async () => {
    if (env && env.teardown) {
      await env.teardown();
    }
  });

  describe('Constructor', () => {
    it('should extend PlatformAdapter', () => {
      expect(adapter).toBeInstanceOf(PlatformAdapter);
    });

    it('should set correct platformId', () => {
      expect(adapter.platformId).toBe('traderjoeV2_2');
    });

    it('should set correct platformName', () => {
      expect(adapter.platformName).toBe('Trader Joe V2.2');
    });

    it('should set correct chainId', () => {
      expect(adapter.chainId).toBe(env.chainId); // 1338 for Avalanche fork
    });

    it('should load platform addresses', () => {
      // V2.2 addresses for 1338 (Avalanche fork)
      expect(adapter.addresses).toBeDefined();
      expect(adapter.addresses.lbFactoryAddress).toBe('0xb43120c4745967fa9b93E79C149E66B0f2D6Fe0c');
      expect(adapter.addresses.lbRouterAddress).toBe('0x18556DA13313f3532c54711497A8FedAC273220E');
      expect(adapter.addresses.lbQuoterAddress).toBe('0x9A550a522BBaDFB69019b0432800Ed17855A51C3');
    });

    it('should load chain config', () => {
      expect(adapter.chainConfig).toBeDefined();
      expect(adapter.chainConfig.name).toBe('Forked Avalanche'); // 1338 config
    });
  });

  describe('sortTokens', () => {
    // Token addresses for testing sort logic (doesn't require on-chain data)
    const USDC = {
      address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
      symbol: 'USDC',
      decimals: 6,
    };

    const WETH = {
      address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
      symbol: 'WETH',
      decimals: 18,
    };

    it('should sort tokens by address (lower address first)', () => {
      // USDC address (0xaf88...) > WETH address (0x82aF...)
      // So WETH should be sortedToken0 (tokenX in Trader Joe terminology)
      const result = adapter.sortTokens(USDC, WETH);

      expect(result.sortedToken0.symbol).toBe('WETH');
      expect(result.sortedToken1.symbol).toBe('USDC');
      expect(result.tokensSwapped).toBe(true);
    });

    it('should not swap when tokens already in correct order', () => {
      const result = adapter.sortTokens(WETH, USDC);

      expect(result.sortedToken0.symbol).toBe('WETH');
      expect(result.sortedToken1.symbol).toBe('USDC');
      expect(result.tokensSwapped).toBe(false);
    });

    it('should preserve all token properties after sorting', () => {
      const result = adapter.sortTokens(USDC, WETH);

      // Check WETH (sortedToken0)
      expect(result.sortedToken0.address).toBe(WETH.address);
      expect(result.sortedToken0.symbol).toBe('WETH');
      expect(result.sortedToken0.decimals).toBe(18);

      // Check USDC (sortedToken1)
      expect(result.sortedToken1.address).toBe(USDC.address);
      expect(result.sortedToken1.symbol).toBe('USDC');
      expect(result.sortedToken1.decimals).toBe(6);
    });

    it('should be case-insensitive for addresses', () => {
      const upperCaseUSDC = { ...USDC, address: USDC.address.toUpperCase() };
      const lowerCaseWETH = { ...WETH, address: WETH.address.toLowerCase() };

      const result = adapter.sortTokens(upperCaseUSDC, lowerCaseWETH);

      expect(result.sortedToken0.address.toLowerCase()).toBe(WETH.address.toLowerCase());
      expect(result.tokensSwapped).toBe(true);
    });

    it('should handle identical address case formats consistently', () => {
      const checksumWETH = { ...WETH, address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1' };
      const checksumUSDC = { ...USDC, address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' };

      const result = adapter.sortTokens(checksumUSDC, checksumWETH);

      expect(result.sortedToken0.symbol).toBe('WETH');
      expect(result.sortedToken1.symbol).toBe('USDC');
    });

    describe('Error cases', () => {
      it('should throw if token0 has no address', () => {
        expect(() => adapter.sortTokens({}, WETH))
          .toThrow('Both tokens must have valid addresses');
      });

      it('should throw if token1 has no address', () => {
        expect(() => adapter.sortTokens(USDC, {}))
          .toThrow('Both tokens must have valid addresses');
      });

      it('should throw if token0 is null', () => {
        expect(() => adapter.sortTokens(null, WETH))
          .toThrow('Both tokens must have valid addresses');
      });

      it('should throw if token1 is null', () => {
        expect(() => adapter.sortTokens(USDC, null))
          .toThrow('Both tokens must have valid addresses');
      });

      it('should throw if token0 is undefined', () => {
        expect(() => adapter.sortTokens(undefined, WETH))
          .toThrow('Both tokens must have valid addresses');
      });

      it('should throw if token1 is undefined', () => {
        expect(() => adapter.sortTokens(USDC, undefined))
          .toThrow('Both tokens must have valid addresses');
      });

      it('should throw if token0.address is empty string', () => {
        expect(() => adapter.sortTokens({ address: '' }, WETH))
          .toThrow('Both tokens must have valid addresses');
      });

      it('should throw if token1.address is empty string', () => {
        expect(() => adapter.sortTokens(USDC, { address: '' }))
          .toThrow('Both tokens must have valid addresses');
      });
    });
  });

  describe('_getSwapEventSignature', () => {
    it('should return the correct Trader Joe V2.2 swap event signature', () => {
      const signature = adapter._getSwapEventSignature();
      expect(signature).toBe('Swap(address,address,uint24,bytes32,bytes32,uint24,bytes32,bytes32)');
    });

    it('should generate the correct topic hash for TJ V2.2 swap events', () => {
      const signature = adapter._getSwapEventSignature();
      const topicHash = ethers.utils.id(signature);
      expect(topicHash).toBe(ethers.utils.id('Swap(address,address,uint24,bytes32,bytes32,uint24,bytes32,bytes32)'));
    });
  });

  describe('getSwapEventFilter', () => {
    describe('Success Cases', () => {
      it('should return filter object with address and topics', () => {
        const poolAddress = '0x8ad599c3A0ff1De082011EFDDc58f1908eb6e6D8';
        const result = adapter.getSwapEventFilter(poolAddress);

        expect(result).toHaveProperty('address');
        expect(result).toHaveProperty('topics');
        expect(result.address).toBe(poolAddress);
        expect(Array.isArray(result.topics)).toBe(true);
        expect(result.topics.length).toBe(1);
      });

      it('should return correct swap event topic hash', () => {
        const poolAddress = '0x8ad599c3A0ff1De082011EFDDc58f1908eb6e6D8';
        const result = adapter.getSwapEventFilter(poolAddress);

        const expectedTopic = ethers.utils.id('Swap(address,address,uint24,bytes32,bytes32,uint24,bytes32,bytes32)');
        expect(result.topics[0]).toBe(expectedTopic);
      });

      it('should accept lowercase address after validation', () => {
        const lowercaseAddress = '0x8ad599c3a0ff1de082011efddc58f1908eb6e6d8';
        const result = adapter.getSwapEventFilter(lowercaseAddress);

        expect(result.address).toBe(lowercaseAddress);
      });
    });

    describe('Validation Error Cases', () => {
      it('should throw error for null poolId', () => {
        expect(() => adapter.getSwapEventFilter(null))
          .toThrow('poolId parameter is required and must be a string');
      });

      it('should throw error for undefined poolId', () => {
        expect(() => adapter.getSwapEventFilter(undefined))
          .toThrow('poolId parameter is required and must be a string');
      });

      it('should throw error for empty string poolId', () => {
        expect(() => adapter.getSwapEventFilter(''))
          .toThrow('poolId parameter is required and must be a string');
      });

      it('should throw error for non-string poolId', () => {
        expect(() => adapter.getSwapEventFilter(123))
          .toThrow('poolId parameter is required and must be a string');
      });

      it('should throw error for invalid address format', () => {
        expect(() => adapter.getSwapEventFilter('not-an-address'))
          .toThrow('Invalid poolId address: not-an-address');
      });

      it('should throw error for address with wrong length', () => {
        expect(() => adapter.getSwapEventFilter('0x1234'))
          .toThrow('Invalid poolId address: 0x1234');
      });
    });
  });

  describe('parseSwapEvent', () => {
    // Build a valid V2.2 Swap event log for testing
    const validSignature = 'Swap(address,address,uint24,bytes32,bytes32,uint24,bytes32,bytes32)';
    const validTopic0 = ethers.utils.id(validSignature);
    const validSender = ethers.utils.hexZeroPad('0x1234567890123456789012345678901234567890', 32);
    const validTo = ethers.utils.hexZeroPad('0xABCDEF0123456789ABCDEF0123456789ABCDEF01', 32);

    // Pack amounts into bytes32: TJ PackedUint128Math format: X = lower 128 bits, Y = upper 128 bits
    // amountX = 1000000000000000000 (1e18), amountY = 2000000000 (2e9)
    const amountX = ethers.BigNumber.from('1000000000000000000');
    const amountY = ethers.BigNumber.from('2000000000');
    const packedAmountsIn = ethers.utils.hexZeroPad(
      amountY.shl(128).or(amountX).toHexString(), 32
    );
    // amountsOut: amountX = 0, amountY = 500000000 (5e8)
    const outAmountY = ethers.BigNumber.from('500000000');
    const packedAmountsOut = ethers.utils.hexZeroPad(outAmountY.shl(128).toHexString(), 32);
    // totalFees: amountX = 3000000000000000 (3e15), amountY = 0
    const feeAmountX = ethers.BigNumber.from('3000000000000000');
    const packedTotalFees = ethers.utils.hexZeroPad(
      feeAmountX.toHexString(), 32
    );
    // protocolFees: amountX = 1000000000000000 (1e15), amountY = 0
    const protocolFeeX = ethers.BigNumber.from('1000000000000000');
    const packedProtocolFees = ethers.utils.hexZeroPad(
      protocolFeeX.toHexString(), 32
    );

    const abiCoder = new ethers.utils.AbiCoder();
    const validData = abiCoder.encode(
      ['uint24', 'bytes32', 'bytes32', 'uint24', 'bytes32', 'bytes32'],
      [8388608, packedAmountsIn, packedAmountsOut, 5000, packedTotalFees, packedProtocolFees]
    );

    const validLog = {
      address: '0x8ad599c3A0ff1De082011EFDDc58f1908eb6e6D8',
      topics: [validTopic0, validSender, validTo],
      data: validData
    };

    describe('Validation', () => {
      it('should throw error for null log', () => {
        expect(() => adapter.parseSwapEvent(null))
          .toThrow('Log parameter is required');
      });

      it('should throw error for undefined log', () => {
        expect(() => adapter.parseSwapEvent(undefined))
          .toThrow('Log parameter is required');
      });

      it('should throw error for log without address', () => {
        expect(() => adapter.parseSwapEvent({ topics: [], data: '0x' }))
          .toThrow('Log must have address property');
      });

      it('should throw error for log without topics', () => {
        expect(() => adapter.parseSwapEvent({ address: '0x123', data: '0x' }))
          .toThrow('Log must have topics array');
      });

      it('should throw error for log with non-array topics', () => {
        expect(() => adapter.parseSwapEvent({ address: '0x123', topics: 'not-array', data: '0x' }))
          .toThrow('Log must have topics array');
      });

      it('should throw error for log with fewer than 3 topics', () => {
        expect(() => adapter.parseSwapEvent({ address: '0x123', topics: [validTopic0, validSender], data: '0x' }))
          .toThrow('Log must have at least 3 topics');
      });

      it('should throw error for log without data', () => {
        expect(() => adapter.parseSwapEvent({ address: '0x123', topics: [validTopic0, validSender, validTo] }))
          .toThrow('Log must have data property');
      });

      it('should throw error for wrong event signature', () => {
        const wrongLog = {
          ...validLog,
          topics: ['0x' + '1'.repeat(64), validSender, validTo]
        };
        expect(() => adapter.parseSwapEvent(wrongLog))
          .toThrow('Invalid swap event signature');
      });
    });

    describe('Parsing', () => {
      it('should parse valid V2.2 swap event correctly', () => {
        const result = adapter.parseSwapEvent(validLog);

        expect(result.activeId).toBe(8388608);
        expect(result.volatilityAccumulator).toBe(5000);
        expect(result.sender).toMatch(/^0x[a-fA-F0-9]{40}$/);
        expect(result.to).toMatch(/^0x[a-fA-F0-9]{40}$/);
      });

      it('should return all expected properties', () => {
        const result = adapter.parseSwapEvent(validLog);

        expect(result).toHaveProperty('activeId');
        expect(result).toHaveProperty('sender');
        expect(result).toHaveProperty('to');
        expect(result).toHaveProperty('amountsIn');
        expect(result).toHaveProperty('amountsOut');
        expect(result).toHaveProperty('volatilityAccumulator');
        expect(result).toHaveProperty('totalFees');
        expect(result).toHaveProperty('protocolFees');
      });

      it('should return activeId as number', () => {
        const result = adapter.parseSwapEvent(validLog);
        expect(typeof result.activeId).toBe('number');
      });

      it('should return volatilityAccumulator as number', () => {
        const result = adapter.parseSwapEvent(validLog);
        expect(typeof result.volatilityAccumulator).toBe('number');
      });

      it('should decode packed amountsIn correctly', () => {
        const result = adapter.parseSwapEvent(validLog);
        expect(result.amountsIn.amountX).toBe('1000000000000000000');
        expect(result.amountsIn.amountY).toBe('2000000000');
      });

      it('should decode packed amountsOut correctly', () => {
        const result = adapter.parseSwapEvent(validLog);
        expect(result.amountsOut.amountX).toBe('0');
        expect(result.amountsOut.amountY).toBe('500000000');
      });

      it('should decode packed totalFees correctly', () => {
        const result = adapter.parseSwapEvent(validLog);
        expect(result.totalFees.amountX).toBe('3000000000000000');
        expect(result.totalFees.amountY).toBe('0');
      });

      it('should decode packed protocolFees correctly', () => {
        const result = adapter.parseSwapEvent(validLog);
        expect(result.protocolFees.amountX).toBe('1000000000000000');
        expect(result.protocolFees.amountY).toBe('0');
      });

      it('should return amounts as strings within decoded objects', () => {
        const result = adapter.parseSwapEvent(validLog);
        expect(typeof result.amountsIn.amountX).toBe('string');
        expect(typeof result.amountsIn.amountY).toBe('string');
        expect(typeof result.amountsOut.amountX).toBe('string');
        expect(typeof result.amountsOut.amountY).toBe('string');
      });

      it('should return checksummed addresses for sender and to', () => {
        const result = adapter.parseSwapEvent(validLog);
        // ethers.utils.getAddress returns checksummed addresses
        expect(result.sender).toBe(ethers.utils.getAddress('0x1234567890123456789012345678901234567890'));
        expect(result.to).toBe(ethers.utils.getAddress('0xABCDEF0123456789ABCDEF0123456789ABCDEF01'));
      });
    });
  });

  describe('parseSwapReceipt', () => {
    // Token addresses for tests — TOKEN_A < TOKEN_B so TOKEN_A = tokenX
    const TOKEN_A = '0x0000000000000000000000000000000000000AAA';
    const TOKEN_B = '0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF';
    const TOKEN_MID = '0x7777777777777777777777777777777777777777';
    const PAIR_ADDRESS = '0x8ad599c3A0ff1De082011EFDDc58f1908eb6e6D8';

    const swapSignature = 'Swap(address,address,uint24,bytes32,bytes32,uint24,bytes32,bytes32)';
    const swapTopicHash = ethers.utils.id(swapSignature);
    const senderTopic = ethers.utils.hexZeroPad('0x1234567890123456789012345678901234567890', 32);
    const toTopic = ethers.utils.hexZeroPad('0xABCDEF0123456789ABCDEF0123456789ABCDEF01', 32);

    /**
     * Create a mock TJ V2.2 Swap log with packed bytes32 amounts.
     * @param {object} amountsIn - { amountX: string, amountY: string }
     * @param {object} amountsOut - { amountX: string, amountY: string }
     */
    const PAIR_ADDRESS_2 = '0x1234567890ABCDEF1234567890ABCDEF12345678';

    function createMockTJSwapLog(amountsIn, amountsOut, { pairAddress = PAIR_ADDRESS, logIndex } = {}) {
      const abiCoder = new ethers.utils.AbiCoder();

      // TJ PackedUint128Math: X = lower 128 bits, Y = upper 128 bits
      const packAmounts = (amountX, amountY) => {
        const x = ethers.BigNumber.from(amountX);
        const y = ethers.BigNumber.from(amountY);
        return ethers.utils.hexZeroPad(y.shl(128).or(x).toHexString(), 32);
      };

      const packedIn = packAmounts(amountsIn.amountX, amountsIn.amountY);
      const packedOut = packAmounts(amountsOut.amountX, amountsOut.amountY);
      const zeroBytes32 = ethers.constants.HashZero;

      const data = abiCoder.encode(
        ['uint24', 'bytes32', 'bytes32', 'uint24', 'bytes32', 'bytes32'],
        [8388608, packedIn, packedOut, 0, zeroBytes32, zeroBytes32]
      );

      return {
        address: pairAddress,
        topics: [swapTopicHash, senderTopic, toTopic],
        data,
        ...(logIndex !== undefined && { logIndex })
      };
    }

    describe('Validation', () => {
      it('should throw error for null receipt', () => {
        expect(() => adapter.parseSwapReceipt(null, []))
          .toThrow('Receipt parameter is required');
      });

      it('should throw error for undefined receipt', () => {
        expect(() => adapter.parseSwapReceipt(undefined, []))
          .toThrow('Receipt parameter is required');
      });

      it('should throw error for receipt without logs', () => {
        expect(() => adapter.parseSwapReceipt({}, []))
          .toThrow('Receipt must have logs property');
      });

      it('should throw error for null metadata', () => {
        expect(() => adapter.parseSwapReceipt({ logs: [] }, null))
          .toThrow('Swap metadata parameter is required');
      });

      it('should throw error for undefined metadata', () => {
        expect(() => adapter.parseSwapReceipt({ logs: [] }, undefined))
          .toThrow('Swap metadata parameter is required');
      });

      it('should throw error for non-array metadata', () => {
        expect(() => adapter.parseSwapReceipt({ logs: [] }, {}))
          .toThrow('Swap metadata must be an array');
      });

      it('should throw error for metadata missing tokenInAddress', () => {
        expect(() => adapter.parseSwapReceipt(
          { logs: [] },
          [{ tokenOutAddress: TOKEN_B }]
        )).toThrow('Swap metadata must have tokenInAddress');
      });

      it('should throw error for metadata missing tokenOutAddress', () => {
        expect(() => adapter.parseSwapReceipt(
          { logs: [] },
          [{ tokenInAddress: TOKEN_A }]
        )).toThrow('Swap metadata must have tokenOutAddress');
      });
    });

    /** Helper to create V2.2 single-hop route metadata */
    function v22Route(tokenIn, tokenOut) {
      return {
        tokenInAddress: tokenIn,
        tokenOutAddress: tokenOut,
        routes: [{
          tokenPath: [tokenIn.toLowerCase(), tokenOut.toLowerCase()],
          poolCount: 1,
          versions: [3]
        }]
      };
    }

    describe('Simple swaps', () => {
      it('should return empty array for empty metadata', () => {
        const result = adapter.parseSwapReceipt({ logs: [] }, []);
        expect(result).toEqual([]);
      });

      it('should throw error for metadata missing routes', () => {
        expect(() => adapter.parseSwapReceipt(
          { logs: [] },
          [{ tokenInAddress: TOKEN_A, tokenOutAddress: TOKEN_B }]
        )).toThrow('Swap metadata must have routes');
      });

      it('should parse swap where tokenIn is tokenX (lower address)', () => {
        // A < B, so A = tokenX, B = tokenY
        // Swapping A→B: amountsIn.amountX has the input, amountsOut.amountY has the output
        const log = createMockTJSwapLog(
          { amountX: '1000000000000000000', amountY: '0' },
          { amountX: '0', amountY: '2000000000' }
        );

        const result = adapter.parseSwapReceipt(
          { logs: [log] },
          [v22Route(TOKEN_A, TOKEN_B)]
        );

        expect(result).toHaveLength(1);
        expect(result[0].actualAmountIn).toBe('1000000000000000000');
        expect(result[0].actualAmountOut).toBe('2000000000');
      });

      it('should parse swap where tokenIn is tokenY (higher address)', () => {
        // B > A, so B = tokenY, A = tokenX
        // Swapping B→A: amountsIn.amountY has the input, amountsOut.amountX has the output
        const log = createMockTJSwapLog(
          { amountX: '0', amountY: '2000000000' },
          { amountX: '1000000000000000000', amountY: '0' }
        );

        const result = adapter.parseSwapReceipt(
          { logs: [log] },
          [v22Route(TOKEN_B, TOKEN_A)]
        );

        expect(result).toHaveLength(1);
        expect(result[0].actualAmountIn).toBe('2000000000');
        expect(result[0].actualAmountOut).toBe('1000000000000000000');
      });

      it('should parse multiple sequential swaps independently', () => {
        // Each swap goes through a different pool (different addresses)
        const log1 = createMockTJSwapLog(
          { amountX: '1000000000000000000', amountY: '0' },
          { amountX: '0', amountY: '2000000000' },
          { pairAddress: PAIR_ADDRESS, logIndex: 0 }
        );
        const log2 = createMockTJSwapLog(
          { amountX: '0', amountY: '500000000' },
          { amountX: '250000000000000000', amountY: '0' },
          { pairAddress: PAIR_ADDRESS_2, logIndex: 1 }
        );

        const result = adapter.parseSwapReceipt(
          { logs: [log1, log2] },
          [
            v22Route(TOKEN_A, TOKEN_B),
            v22Route(TOKEN_B, TOKEN_A)
          ]
        );

        expect(result).toHaveLength(2);
        expect(result[0].actualAmountIn).toBe('1000000000000000000');
        expect(result[0].actualAmountOut).toBe('2000000000');
        expect(result[1].actualAmountIn).toBe('500000000');
        expect(result[1].actualAmountOut).toBe('250000000000000000');
      });

      it('should return zeros when no matching swap events found', () => {
        const result = adapter.parseSwapReceipt(
          { logs: [] },
          [v22Route(TOKEN_A, TOKEN_B)]
        );

        expect(result).toHaveLength(1);
        expect(result[0].actualAmountIn).toBe('0');
        expect(result[0].actualAmountOut).toBe('0');
      });

      it('should skip non-swap logs and parse swap logs', () => {
        const transferLog = {
          address: TOKEN_A,
          topics: [
            ethers.utils.id('Transfer(address,address,uint256)'),
            senderTopic,
            toTopic
          ],
          data: ethers.utils.defaultAbiCoder.encode(['uint256'], [1000])
        };
        const swapLog = createMockTJSwapLog(
          { amountX: '1000000000000000000', amountY: '0' },
          { amountX: '0', amountY: '2000000000' }
        );

        const result = adapter.parseSwapReceipt(
          { logs: [transferLog, swapLog] },
          [v22Route(TOKEN_A, TOKEN_B)]
        );

        expect(result).toHaveLength(1);
        expect(result[0].actualAmountIn).toBe('1000000000000000000');
        expect(result[0].actualAmountOut).toBe('2000000000');
      });
    });

    describe('Multi-hop swaps (V2.2 only)', () => {
      it('should parse 2-hop swap A→MID→B', () => {
        // Hop 1: A→MID (A < MID, so A=tokenX): amountsIn.X = input, amountsOut not needed from hop1
        // Hop 2: MID→B (MID < B, so MID=tokenX): amountsOut.Y = output
        // Each hop uses a different pool address
        const hop1Log = createMockTJSwapLog(
          { amountX: '1000000000000000000', amountY: '0' },
          { amountX: '0', amountY: '5000000000' },
          { pairAddress: PAIR_ADDRESS, logIndex: 0 }
        );
        const hop2Log = createMockTJSwapLog(
          { amountX: '5000000000', amountY: '0' },
          { amountX: '0', amountY: '2000000000' },
          { pairAddress: PAIR_ADDRESS_2, logIndex: 1 }
        );

        const result = adapter.parseSwapReceipt(
          { logs: [hop1Log, hop2Log] },
          [{
            tokenInAddress: TOKEN_A,
            tokenOutAddress: TOKEN_B,
            routes: [{
              tokenPath: [TOKEN_A, TOKEN_MID, TOKEN_B],
              poolCount: 2,
              versions: [3, 3]
            }]
          }]
        );

        expect(result).toHaveLength(1);
        expect(result[0].actualAmountIn).toBe('1000000000000000000');
        expect(result[0].actualAmountOut).toBe('2000000000');
      });

      it('should parse 2-hop swap B→MID→A (reversed direction)', () => {
        // Hop 1: B→MID (B > MID, so B=tokenY): amountsIn.Y = input
        // Hop 2: MID→A (MID > A, so MID=tokenY): amountsOut.X = output (A=tokenX, A < MID)
        const hop1Log = createMockTJSwapLog(
          { amountX: '0', amountY: '2000000000' },
          { amountX: '5000000000', amountY: '0' },
          { pairAddress: PAIR_ADDRESS, logIndex: 0 }
        );
        const hop2Log = createMockTJSwapLog(
          { amountX: '0', amountY: '5000000000' },
          { amountX: '1000000000000000000', amountY: '0' },
          { pairAddress: PAIR_ADDRESS_2, logIndex: 1 }
        );

        const result = adapter.parseSwapReceipt(
          { logs: [hop1Log, hop2Log] },
          [{
            tokenInAddress: TOKEN_B,
            tokenOutAddress: TOKEN_A,
            routes: [{
              tokenPath: [TOKEN_B, TOKEN_MID, TOKEN_A],
              poolCount: 2,
              versions: [3, 3]
            }]
          }]
        );

        expect(result).toHaveLength(1);
        expect(result[0].actualAmountIn).toBe('2000000000');
        expect(result[0].actualAmountOut).toBe('1000000000000000000');
      });

      it('should handle multi-bin crossing (multiple events from same pool)', () => {
        // Single-hop swap that crosses 2 bins → 2 Swap events from same pool
        // amountIn is in the first event, amountOut is in the last event
        const bin1Log = createMockTJSwapLog(
          { amountX: '1000000000000000000', amountY: '0' },
          { amountX: '0', amountY: '1500000000' },
          { pairAddress: PAIR_ADDRESS, logIndex: 0 }
        );
        const bin2Log = createMockTJSwapLog(
          { amountX: '500000000000000000', amountY: '0' },
          { amountX: '0', amountY: '500000000' },
          { pairAddress: PAIR_ADDRESS, logIndex: 1 }
        );

        const result = adapter.parseSwapReceipt(
          { logs: [bin1Log, bin2Log] },
          [v22Route(TOKEN_A, TOKEN_B)]
        );

        expect(result).toHaveLength(1);
        // amountIn from first event, amountOut from last event
        expect(result[0].actualAmountIn).toBe('1000000000000000000');
        expect(result[0].actualAmountOut).toBe('500000000');
      });
    });

    describe('V1 (JoePair) swap events', () => {
      const v1SwapTopicHash = ethers.utils.id('Swap(address,uint256,uint256,uint256,uint256,address)');

      /**
       * Create a mock V1 JoePair Swap log.
       * Topics: [hash, sender(indexed), to(indexed)]
       * Data: [amount0In, amount1In, amount0Out, amount1Out]
       */
      function createMockV1SwapLog(amount0In, amount1In, amount0Out, amount1Out) {
        const abiCoder = new ethers.utils.AbiCoder();
        const data = abiCoder.encode(
          ['uint256', 'uint256', 'uint256', 'uint256'],
          [amount0In, amount1In, amount0Out, amount1Out]
        );
        return {
          address: '0x1111111111111111111111111111111111111111',
          topics: [v1SwapTopicHash, senderTopic, toTopic],
          data,
          logIndex: 0
        };
      }

      it('should parse V1 swap where tokenIn is token0 (lower address)', () => {
        // A < B → A=token0, B=token1. Swapping A→B: amount0In has input, amount1Out has output
        const log = createMockV1SwapLog('1000000000000000000', '0', '0', '2000000000');

        const result = adapter.parseSwapReceipt(
          { logs: [log] },
          [{
            tokenInAddress: TOKEN_A,
            tokenOutAddress: TOKEN_B,
            routes: [{
              tokenPath: [TOKEN_A.toLowerCase(), TOKEN_B.toLowerCase()],
              poolCount: 1,
              versions: [0]
            }]
          }]
        );

        expect(result).toHaveLength(1);
        expect(result[0].actualAmountIn).toBe('1000000000000000000');
        expect(result[0].actualAmountOut).toBe('2000000000');
      });

      it('should parse V1 swap where tokenIn is token1 (higher address)', () => {
        // B > A → B=token1. Swapping B→A: amount1In has input, amount0Out has output
        const log = createMockV1SwapLog('0', '2000000000', '1000000000000000000', '0');

        const result = adapter.parseSwapReceipt(
          { logs: [log] },
          [{
            tokenInAddress: TOKEN_B,
            tokenOutAddress: TOKEN_A,
            routes: [{
              tokenPath: [TOKEN_B.toLowerCase(), TOKEN_A.toLowerCase()],
              poolCount: 1,
              versions: [0]
            }]
          }]
        );

        expect(result).toHaveLength(1);
        expect(result[0].actualAmountIn).toBe('2000000000');
        expect(result[0].actualAmountOut).toBe('1000000000000000000');
      });
    });

    describe('V2.0 (Legacy LBPair) swap events', () => {
      const v2SwapTopicHash = ethers.utils.id('Swap(address,address,uint256,bool,uint256,uint256,uint256,uint256)');

      /**
       * Create a mock V2.0 Legacy LBPair Swap log.
       * Topics: [hash, sender(indexed), recipient(indexed), id(indexed)]
       * Data: [swapForY, amountIn, amountOut, volatilityAccumulated, fees]
       */
      function createMockV2LegacySwapLog(swapForY, amountIn, amountOut) {
        const abiCoder = new ethers.utils.AbiCoder();
        const data = abiCoder.encode(
          ['bool', 'uint256', 'uint256', 'uint256', 'uint256'],
          [swapForY, amountIn, amountOut, 0, 0]
        );
        const idTopic = ethers.utils.hexZeroPad('0x800000', 32); // active bin ID
        return {
          address: '0x2222222222222222222222222222222222222222',
          topics: [v2SwapTopicHash, senderTopic, toTopic, idTopic],
          data,
          logIndex: 0
        };
      }

      it('should parse V2.0 swap with swapForY=true (tokenX→tokenY)', () => {
        // swapForY=true means tokenX (lower address) is input
        // A < B → A=tokenX, B=tokenY
        const log = createMockV2LegacySwapLog(true, '1000000000000000000', '2000000000');

        const result = adapter.parseSwapReceipt(
          { logs: [log] },
          [{
            tokenInAddress: TOKEN_A,
            tokenOutAddress: TOKEN_B,
            routes: [{
              tokenPath: [TOKEN_A.toLowerCase(), TOKEN_B.toLowerCase()],
              poolCount: 1,
              versions: [1]
            }]
          }]
        );

        expect(result).toHaveLength(1);
        expect(result[0].actualAmountIn).toBe('1000000000000000000');
        expect(result[0].actualAmountOut).toBe('2000000000');
      });

      it('should parse V2.0 swap with swapForY=false (tokenY→tokenX)', () => {
        // swapForY=false means tokenY (higher address) is input
        // B > A → B=tokenY
        const log = createMockV2LegacySwapLog(false, '2000000000', '1000000000000000000');

        const result = adapter.parseSwapReceipt(
          { logs: [log] },
          [{
            tokenInAddress: TOKEN_B,
            tokenOutAddress: TOKEN_A,
            routes: [{
              tokenPath: [TOKEN_B.toLowerCase(), TOKEN_A.toLowerCase()],
              poolCount: 1,
              versions: [1]
            }]
          }]
        );

        expect(result).toHaveLength(1);
        expect(result[0].actualAmountIn).toBe('2000000000');
        expect(result[0].actualAmountOut).toBe('1000000000000000000');
      });
    });

    describe('V2.1 swap events (shares V2.2 packed bytes32 format)', () => {
      it('should parse V2.1 swap using V2.2-format event (lower→higher)', () => {
        // V2.1 LBPairs emit the same Swap event as V2.2 (packed bytes32)
        // A < B → A=tokenX. Swapping A→B: amountsIn.X = input, amountsOut.Y = output
        const log = createMockTJSwapLog(
          { amountX: '1000000000000000000', amountY: '0' },
          { amountX: '0', amountY: '2000000000' }
        );

        const result = adapter.parseSwapReceipt(
          { logs: [log] },
          [{
            tokenInAddress: TOKEN_A,
            tokenOutAddress: TOKEN_B,
            routes: [{
              tokenPath: [TOKEN_A.toLowerCase(), TOKEN_B.toLowerCase()],
              poolCount: 1,
              versions: [2]
            }]
          }]
        );

        expect(result).toHaveLength(1);
        expect(result[0].actualAmountIn).toBe('1000000000000000000');
        expect(result[0].actualAmountOut).toBe('2000000000');
      });

      it('should parse V2.1 swap using V2.2-format event (higher→lower)', () => {
        // B > A → B=tokenY. Swapping B→A: amountsIn.Y = input, amountsOut.X = output
        const log = createMockTJSwapLog(
          { amountX: '0', amountY: '2000000000' },
          { amountX: '1000000000000000000', amountY: '0' }
        );

        const result = adapter.parseSwapReceipt(
          { logs: [log] },
          [{
            tokenInAddress: TOKEN_B,
            tokenOutAddress: TOKEN_A,
            routes: [{
              tokenPath: [TOKEN_B.toLowerCase(), TOKEN_A.toLowerCase()],
              poolCount: 1,
              versions: [2]
            }]
          }]
        );

        expect(result).toHaveLength(1);
        expect(result[0].actualAmountIn).toBe('2000000000');
        expect(result[0].actualAmountOut).toBe('1000000000000000000');
      });
    });

    describe('Cross-version multi-hop swaps', () => {
      const v1SwapTopicHash = ethers.utils.id('Swap(address,uint256,uint256,uint256,uint256,address)');

      function createMockV1SwapLog(amount0In, amount1In, amount0Out, amount1Out, logIndex) {
        const abiCoder = new ethers.utils.AbiCoder();
        const data = abiCoder.encode(
          ['uint256', 'uint256', 'uint256', 'uint256'],
          [amount0In, amount1In, amount0Out, amount1Out]
        );
        return {
          address: '0x1111111111111111111111111111111111111111',
          topics: [v1SwapTopicHash, senderTopic, toTopic],
          data,
          logIndex
        };
      }

      function createMockTJSwapLogWithIndex(amountsIn, amountsOut, logIndex, pairAddress = PAIR_ADDRESS) {
        return createMockTJSwapLog(amountsIn, amountsOut, { pairAddress, logIndex });
      }

      it('should parse V1→V2.2 two-hop swap', () => {
        // Hop 1 (V1): A→MID. A < MID → A=token0. amount0In=input
        // Hop 2 (V2.2): MID→B. MID < B → MID=tokenX. amountsOut.Y=output
        const hop1Log = createMockV1SwapLog('1000000000000000000', '0', '0', '5000000000', 0);
        const hop2Log = createMockTJSwapLogWithIndex(
          { amountX: '5000000000', amountY: '0' },
          { amountX: '0', amountY: '2000000000' },
          1
        );

        const result = adapter.parseSwapReceipt(
          { logs: [hop1Log, hop2Log] },
          [{
            tokenInAddress: TOKEN_A,
            tokenOutAddress: TOKEN_B,
            routes: [{
              tokenPath: [TOKEN_A.toLowerCase(), TOKEN_MID.toLowerCase(), TOKEN_B.toLowerCase()],
              poolCount: 2,
              versions: [0, 3]
            }]
          }]
        );

        expect(result).toHaveLength(1);
        expect(result[0].actualAmountIn).toBe('1000000000000000000');
        expect(result[0].actualAmountOut).toBe('2000000000');
      });

      it('should parse V2.2→V1 two-hop swap', () => {
        // Hop 1 (V2.2): A→MID. A < MID → A=tokenX. amountsIn.X=input
        // Hop 2 (V1): MID→B. MID < B → MID=token0. amount1Out=output
        const hop1Log = createMockTJSwapLogWithIndex(
          { amountX: '1000000000000000000', amountY: '0' },
          { amountX: '0', amountY: '5000000000' },
          0
        );
        const hop2Log = createMockV1SwapLog('5000000000', '0', '0', '2000000000', 1);

        const result = adapter.parseSwapReceipt(
          { logs: [hop1Log, hop2Log] },
          [{
            tokenInAddress: TOKEN_A,
            tokenOutAddress: TOKEN_B,
            routes: [{
              tokenPath: [TOKEN_A.toLowerCase(), TOKEN_MID.toLowerCase(), TOKEN_B.toLowerCase()],
              poolCount: 2,
              versions: [3, 0]
            }]
          }]
        );

        expect(result).toHaveLength(1);
        expect(result[0].actualAmountIn).toBe('1000000000000000000');
        expect(result[0].actualAmountOut).toBe('2000000000');
      });
    });
  });

  describe('_decodePackedAmounts', () => {
    it('should decode bytes32 with both amountX and amountY', () => {
      const x = ethers.BigNumber.from('1000');
      const y = ethers.BigNumber.from('2000');
      // TJ PackedUint128Math: X = lower 128 bits, Y = upper 128 bits
      const packed = ethers.utils.hexZeroPad(y.shl(128).or(x).toHexString(), 32);

      const result = adapter._decodePackedAmounts(packed);
      expect(result.amountX).toBe('1000');
      expect(result.amountY).toBe('2000');
    });

    it('should decode bytes32 with only amountX (amountY = 0)', () => {
      const x = ethers.BigNumber.from('5000000000');
      // TJ PackedUint128Math: X in lower 128 bits, Y=0 in upper
      const packed = ethers.utils.hexZeroPad(x.toHexString(), 32);

      const result = adapter._decodePackedAmounts(packed);
      expect(result.amountX).toBe('5000000000');
      expect(result.amountY).toBe('0');
    });

    it('should decode bytes32 with only amountY (amountX = 0)', () => {
      const y = ethers.BigNumber.from('7777777');
      // TJ PackedUint128Math: X=0 in lower, Y in upper 128 bits
      const packed = ethers.utils.hexZeroPad(y.shl(128).toHexString(), 32);

      const result = adapter._decodePackedAmounts(packed);
      expect(result.amountX).toBe('0');
      expect(result.amountY).toBe('7777777');
    });

    it('should decode zero bytes32', () => {
      const packed = ethers.constants.HashZero;

      const result = adapter._decodePackedAmounts(packed);
      expect(result.amountX).toBe('0');
      expect(result.amountY).toBe('0');
    });

    it('should return amounts as strings', () => {
      const packed = ethers.constants.HashZero;
      const result = adapter._decodePackedAmounts(packed);
      expect(typeof result.amountX).toBe('string');
      expect(typeof result.amountY).toBe('string');
    });
  });

  describe('getPositionRange', () => {
    describe('Success Cases', () => {
      it('should calculate bin range for symmetric percentages', () => {
        const poolData = { activeId: 8388608, binStep: 20 }; // binStep=20 → 0.20% per bin
        const result = adapter.getPositionRange(poolData, 1, 1);

        expect(result).toHaveProperty('lowerBinId');
        expect(result).toHaveProperty('upperBinId');
        expect(result).toHaveProperty('activeBinId');
        expect(result.activeBinId).toBe(8388608);
        // Range should be symmetric around activeId
        expect(result.upperBinId).toBeGreaterThan(result.activeBinId);
        expect(result.lowerBinId).toBeLessThan(result.activeBinId);
      });

      it('should calculate bin range for asymmetric percentages', () => {
        const poolData = { activeId: 8388608, binStep: 20 };
        const result = adapter.getPositionRange(poolData, 10, 5);

        // Upper should be further from active than lower
        const upperOffset = result.upperBinId - result.activeBinId;
        const lowerOffset = result.activeBinId - result.lowerBinId;
        expect(upperOffset).toBeGreaterThan(lowerOffset);
      });

      it('should produce wider range with larger percentages', () => {
        const poolData = { activeId: 8388608, binStep: 20 };
        const narrow = adapter.getPositionRange(poolData, 1, 1);
        const wide = adapter.getPositionRange(poolData, 10, 10);

        expect(wide.upperBinId - wide.lowerBinId).toBeGreaterThan(
          narrow.upperBinId - narrow.lowerBinId
        );
      });

      it('should produce fewer bins with larger binStep', () => {
        const activeId = 8388608;
        // Larger binStep = each bin covers more price → fewer bins needed
        const smallStep = adapter.getPositionRange({ activeId, binStep: 10 }, 5, 5);
        const largeStep = adapter.getPositionRange({ activeId, binStep: 100 }, 5, 5);

        const smallRange = smallStep.upperBinId - smallStep.lowerBinId;
        const largeRange = largeStep.upperBinId - largeStep.lowerBinId;
        expect(largeRange).toBeLessThan(smallRange);
      });

      it('should calculate correct bin count for known values', () => {
        // binStep=20 means 0.20% per bin
        // For 5% range: bins = log(1.05) / log(1.002) ≈ 24.4 → ceil = 25
        const poolData = { activeId: 8388608, binStep: 20 };
        const result = adapter.getPositionRange(poolData, 5, 5);

        const upperOffset = result.upperBinId - result.activeBinId;
        const lowerOffset = result.activeBinId - result.lowerBinId;
        const expected = Math.ceil(Math.log(1.05) / Math.log(1.002));
        expect(upperOffset).toBe(expected);
        expect(lowerOffset).toBe(expected);
      });
    });

    describe('Error Cases', () => {
      it('should throw if poolData is null', () => {
        expect(() => adapter.getPositionRange(null, 5, 5))
          .toThrow('poolData is required and must be an object');
      });

      it('should throw if poolData is undefined', () => {
        expect(() => adapter.getPositionRange(undefined, 5, 5))
          .toThrow('poolData is required and must be an object');
      });

      it('should throw if poolData.activeId is missing', () => {
        expect(() => adapter.getPositionRange({ binStep: 20 }, 5, 5))
          .toThrow('poolData.activeId is required');
      });

      it('should throw if poolData.binStep is missing', () => {
        expect(() => adapter.getPositionRange({ activeId: 8388608 }, 5, 5))
          .toThrow('poolData.binStep is required');
      });

      it('should throw if poolData.binStep is zero', () => {
        expect(() => adapter.getPositionRange({ activeId: 8388608, binStep: 0 }, 5, 5))
          .toThrow('poolData.binStep must be a positive finite number');
      });

      it('should throw if upperPercent is null', () => {
        expect(() => adapter.getPositionRange({ activeId: 8388608, binStep: 20 }, null, 5))
          .toThrow('upperPercent is required');
      });

      it('should throw if lowerPercent is null', () => {
        expect(() => adapter.getPositionRange({ activeId: 8388608, binStep: 20 }, 5, null))
          .toThrow('lowerPercent is required');
      });

      it('should throw if upperPercent is zero', () => {
        expect(() => adapter.getPositionRange({ activeId: 8388608, binStep: 20 }, 0, 5))
          .toThrow('upperPercent must be greater than 0 and at most 100');
      });

      it('should throw if lowerPercent exceeds 100', () => {
        expect(() => adapter.getPositionRange({ activeId: 8388608, binStep: 20 }, 5, 101))
          .toThrow('lowerPercent must be greater than 0 and at most 100');
      });
    });
  });

  describe('describePool', () => {
    it('should format pool description with TJ-native terminology', () => {
      const pool = {
        address: '0x1234567890abcdef1234567890abcdef12345678',
        binStep: 20,
        activeId: 8388608,
        tokenX: { symbol: 'USDC', id: '0xaaa', decimals: 6 },
        tokenY: { symbol: 'WAVAX', id: '0xbbb', decimals: 18 },
        token0: { symbol: 'USDC', id: '0xaaa', decimals: 6 },
        token1: { symbol: 'WAVAX', id: '0xbbb', decimals: 18 },
      };
      const result = adapter.describePool(pool);
      expect(result).toContain('USDC/WAVAX');
      expect(result).toContain(pool.address);
      expect(result).toContain('binStep: 20');
      expect(result).toContain('activeId: 8388608');
      expect(result).not.toContain('fee:');
      expect(result).not.toContain('tick:');
    });

    it('should handle pool with only token0/token1 (no tokenX/tokenY)', () => {
      const pool = {
        address: '0xabcd',
        binStep: 15,
        activeId: 100,
        token0: { symbol: 'A' },
        token1: { symbol: 'B' },
      };
      const result = adapter.describePool(pool);
      expect(result).toContain('A/B');
    });
  });

  describe('extractPositionBounds', () => {
    describe('Success Cases', () => {
      it('should extract lower and upper bin IDs', () => {
        const position = { lowerBinId: 8388500, upperBinId: 8388700 };
        const result = adapter.extractPositionBounds(position);

        expect(result).toEqual({ lower: 8388500, upper: 8388700 });
      });

      it('should work with additional properties on position', () => {
        const position = {
          lowerBinId: 100,
          upperBinId: 200,
          liquidity: '1000000',
          address: '0x1234'
        };
        const result = adapter.extractPositionBounds(position);
        expect(result).toEqual({ lower: 100, upper: 200 });
      });

      it('should work with zero bin IDs', () => {
        const result = adapter.extractPositionBounds({ lowerBinId: 0, upperBinId: 1 });
        expect(result).toEqual({ lower: 0, upper: 1 });
      });
    });

    describe('Error Cases', () => {
      it('should throw if position is null', () => {
        expect(() => adapter.extractPositionBounds(null))
          .toThrow('Position is required and must be an object');
      });

      it('should throw if position is undefined', () => {
        expect(() => adapter.extractPositionBounds(undefined))
          .toThrow('Position is required and must be an object');
      });

      it('should throw if position is an array', () => {
        expect(() => adapter.extractPositionBounds([1, 2]))
          .toThrow('Position is required and must be an object');
      });

      it('should throw if lowerBinId is missing', () => {
        expect(() => adapter.extractPositionBounds({ upperBinId: 100 }))
          .toThrow('Position missing lowerBinId property');
      });

      it('should throw if upperBinId is missing', () => {
        expect(() => adapter.extractPositionBounds({ lowerBinId: 100 }))
          .toThrow('Position missing upperBinId property');
      });
    });
  });

  describe('getPoolCurrent', () => {
    describe('Success Cases', () => {
      it('should return { activeId, binStep } from pool data', () => {
        const poolData = { activeId: 8388608, binStep: 20, reserveX: '1000', reserveY: '2000' };
        const result = adapter.getPoolCurrent(poolData);
        expect(result).toEqual({ activeId: 8388608, binStep: 20 });
      });

      it('should work with activeId at zero', () => {
        const result = adapter.getPoolCurrent({ activeId: 0, binStep: 20 });
        expect(result).toEqual({ activeId: 0, binStep: 20 });
      });

      it('should work with high activeId values', () => {
        // Trader Joe bin IDs can be large (uint24 range, up to 16777215)
        const result = adapter.getPoolCurrent({ activeId: 16777215, binStep: 100 });
        expect(result).toEqual({ activeId: 16777215, binStep: 100 });
      });

      it('should work with low activeId values', () => {
        const result = adapter.getPoolCurrent({ activeId: 1, binStep: 10 });
        expect(result).toEqual({ activeId: 1, binStep: 10 });
      });

      it('should not include extra properties from poolData', () => {
        const poolData = { activeId: 8388608, binStep: 20, reserveX: '1000', reserveY: '2000', address: '0x123' };
        const result = adapter.getPoolCurrent(poolData);
        expect(Object.keys(result).sort()).toEqual(['activeId', 'binStep']);
      });
    });

    describe('Error Cases', () => {
      it('should throw if poolData is null', () => {
        expect(() => adapter.getPoolCurrent(null))
          .toThrow('Pool data must have activeId property');
      });

      it('should throw if poolData is undefined', () => {
        expect(() => adapter.getPoolCurrent(undefined))
          .toThrow('Pool data must have activeId property');
      });

      it('should throw if poolData.activeId is undefined', () => {
        expect(() => adapter.getPoolCurrent({ binStep: 20 }))
          .toThrow('Pool data must have activeId property');
      });

      it('should throw if poolData has no activeId (other fields present)', () => {
        expect(() => adapter.getPoolCurrent({ binStep: 20, reserveX: '1000' }))
          .toThrow('Pool data must have activeId property');
      });

      it('should throw if poolData.binStep is undefined', () => {
        expect(() => adapter.getPoolCurrent({ activeId: 8388608 }))
          .toThrow('Pool data must have binStep property');
      });
    });
  });

  describe('evaluatePriceMovement', () => {
    // Standard token data for tests
    const WETH = { address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', symbol: 'WETH', decimals: 18 };
    const USDC = { address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', symbol: 'USDC', decimals: 6 };
    const BIN_STEP = 20; // 0.20% per bin

    describe('Success Cases', () => {
      it('should return zero movement when activeIds are equal', () => {
        const swapData = { activeId: 8388608 };
        const baseline = { activeId: 8388608, binStep: BIN_STEP };

        const result = adapter.evaluatePriceMovement(swapData, baseline, WETH, USDC);

        expect(result.priceMovementPercent).toBe(0);
        expect(result.direction).toBe('up');
      });

      it('should return priceMovementPercent as a number', () => {
        const swapData = { activeId: 8388610 };
        const baseline = { activeId: 8388608, binStep: BIN_STEP };

        const result = adapter.evaluatePriceMovement(swapData, baseline, WETH, USDC);

        expect(typeof result.priceMovementPercent).toBe('number');
      });

      it('should detect upward price movement', () => {
        const swapData = { activeId: 8388658 }; // 50 bins higher
        const baseline = { activeId: 8388608, binStep: BIN_STEP };

        const result = adapter.evaluatePriceMovement(swapData, baseline, WETH, USDC);

        expect(result.priceMovementPercent).toBeGreaterThan(0);
        expect(result.direction).toBe('up');
      });

      it('should detect downward price movement', () => {
        const swapData = { activeId: 8388558 }; // 50 bins lower
        const baseline = { activeId: 8388608, binStep: BIN_STEP };

        const result = adapter.evaluatePriceMovement(swapData, baseline, WETH, USDC);

        expect(result.priceMovementPercent).toBeGreaterThan(0);
        expect(result.direction).toBe('down');
      });

      it('should return baselinePrice and currentPrice as strings', () => {
        const swapData = { activeId: 8388618 };
        const baseline = { activeId: 8388608, binStep: BIN_STEP };

        const result = adapter.evaluatePriceMovement(swapData, baseline, WETH, USDC);

        expect(typeof result.baselinePrice).toBe('string');
        expect(typeof result.currentPrice).toBe('string');
      });

      it('should return all expected properties', () => {
        const swapData = { activeId: 8388618 };
        const baseline = { activeId: 8388608, binStep: BIN_STEP };

        const result = adapter.evaluatePriceMovement(swapData, baseline, WETH, USDC);

        expect(result).toHaveProperty('priceMovementPercent');
        expect(result).toHaveProperty('baselinePrice');
        expect(result).toHaveProperty('currentPrice');
        expect(result).toHaveProperty('direction');
      });

      it('should always return positive priceMovementPercent', () => {
        const baselineObj = { activeId: 8388608, binStep: BIN_STEP };

        const upResult = adapter.evaluatePriceMovement(
          { activeId: 8388658 }, baselineObj, WETH, USDC
        );
        const downResult = adapter.evaluatePriceMovement(
          { activeId: 8388558 }, baselineObj, WETH, USDC
        );

        expect(upResult.priceMovementPercent).toBeGreaterThan(0);
        expect(downResult.priceMovementPercent).toBeGreaterThan(0);
      });

      it('should compute accurate percentage for known bin delta', () => {
        // binStep=20 → 0.20% per bin
        // 1 bin movement: (1 + 20/10000)^1 - 1 = 0.002 = 0.2%
        const swapData = { activeId: 8388609 }; // 1 bin up
        const baseline = { activeId: 8388608, binStep: BIN_STEP };

        const result = adapter.evaluatePriceMovement(swapData, baseline, WETH, USDC);

        // Expected: |(1.002^1 - 1) * 100| = 0.2%
        expect(result.priceMovementPercent).toBeCloseTo(0.2, 4);
      });

      it('should compute accurate percentage for larger bin delta', () => {
        // 25 bins with binStep=20: (1.002)^25 - 1 ≈ 0.05124 = 5.124%
        const swapData = { activeId: 8388633 }; // 25 bins up
        const baseline = { activeId: 8388608, binStep: BIN_STEP };

        const result = adapter.evaluatePriceMovement(swapData, baseline, WETH, USDC);

        const expected = (Math.pow(1.002, 25) - 1) * 100;
        expect(result.priceMovementPercent).toBeCloseTo(expected, 4);
      });

      it('should work with equal-decimal tokens', () => {
        const tokenA = { address: '0x0000000000000000000000000000000000000001', symbol: 'A', decimals: 18 };
        const tokenB = { address: '0x0000000000000000000000000000000000000002', symbol: 'B', decimals: 18 };

        const swapData = { activeId: 8388618 };
        const baseline = { activeId: 8388608, binStep: BIN_STEP };

        const result = adapter.evaluatePriceMovement(swapData, baseline, tokenA, tokenB);

        expect(result.priceMovementPercent).toBeGreaterThan(0);
        expect(result.direction).toBe('up');
      });
    });

    describe('Validation Error Cases', () => {
      it('should throw if swapData is null', () => {
        expect(() => adapter.evaluatePriceMovement(null, { activeId: 8388608, binStep: 20 }, WETH, USDC))
          .toThrow('swapData parameter is required');
      });

      it('should throw if swapData is undefined', () => {
        expect(() => adapter.evaluatePriceMovement(undefined, { activeId: 8388608, binStep: 20 }, WETH, USDC))
          .toThrow('swapData parameter is required');
      });

      it('should throw if swapData has no activeId', () => {
        expect(() => adapter.evaluatePriceMovement({}, { activeId: 8388608, binStep: 20 }, WETH, USDC))
          .toThrow('swapData must have activeId property as a number');
      });

      it('should throw if swapData.activeId is not a number', () => {
        expect(() => adapter.evaluatePriceMovement({ activeId: '8388608' }, { activeId: 8388608, binStep: 20 }, WETH, USDC))
          .toThrow('swapData must have activeId property as a number');
      });

      it('should throw if baseline is null', () => {
        expect(() => adapter.evaluatePriceMovement({ activeId: 8388608 }, null, WETH, USDC))
          .toThrow('baseline parameter is required');
      });

      it('should throw if baseline is undefined', () => {
        expect(() => adapter.evaluatePriceMovement({ activeId: 8388608 }, undefined, WETH, USDC))
          .toThrow('baseline parameter is required');
      });

      it('should throw if baseline has no activeId', () => {
        expect(() => adapter.evaluatePriceMovement({ activeId: 8388608 }, { binStep: 20 }, WETH, USDC))
          .toThrow('baseline must have activeId property as a number');
      });

      it('should throw if baseline is a plain number (old format)', () => {
        expect(() => adapter.evaluatePriceMovement({ activeId: 8388608 }, 8388608, WETH, USDC))
          .toThrow('baseline must have activeId property as a number');
      });

      it('should throw if baseline has no binStep', () => {
        expect(() => adapter.evaluatePriceMovement({ activeId: 8388608 }, { activeId: 8388608 }, WETH, USDC))
          .toThrow('baseline must have binStep property');
      });

      it('should throw if token0Data is null', () => {
        expect(() => adapter.evaluatePriceMovement({ activeId: 8388608 }, { activeId: 8388608, binStep: 20 }, null, USDC))
          .toThrow('token0Data must have address, symbol, and decimals properties');
      });

      it('should throw if token0Data is missing required properties', () => {
        expect(() => adapter.evaluatePriceMovement({ activeId: 8388608 }, { activeId: 8388608, binStep: 20 }, { address: '0x1' }, USDC))
          .toThrow('token0Data must have address, symbol, and decimals properties');
      });

      it('should throw if token1Data is null', () => {
        expect(() => adapter.evaluatePriceMovement({ activeId: 8388608 }, { activeId: 8388608, binStep: 20 }, WETH, null))
          .toThrow('token1Data must have address, symbol, and decimals properties');
      });

      it('should throw if token1Data is missing required properties', () => {
        expect(() => adapter.evaluatePriceMovement({ activeId: 8388608 }, { activeId: 8388608, binStep: 20 }, WETH, { address: '0x2' }))
          .toThrow('token1Data must have address, symbol, and decimals properties');
      });
    });

    describe('Edge Cases', () => {
      it('should handle large bin deltas', () => {
        // 500 bins apart with binStep=20
        const swapData = { activeId: 8389108 }; // +500 bins
        const baseline = { activeId: 8388608, binStep: BIN_STEP };

        const result = adapter.evaluatePriceMovement(swapData, baseline, WETH, USDC);

        // (1.002)^500 - 1 ≈ 171.6% — should be a large number
        expect(result.priceMovementPercent).toBeGreaterThan(100);
        expect(result.direction).toBe('up');
      });

      it('should handle bin at reference point (8388608)', () => {
        // Both bins at the reference point — zero movement
        const swapData = { activeId: 8388608 };
        const baseline = { activeId: 8388608, binStep: BIN_STEP };

        const result = adapter.evaluatePriceMovement(swapData, baseline, WETH, USDC);

        expect(result.priceMovementPercent).toBe(0);
        // At reference point, price = (1.002)^0 * 10^(18-6) = 1e12
        expect(parseFloat(result.baselinePrice)).toBeGreaterThan(0);
        expect(result.baselinePrice).toBe(result.currentPrice);
      });

      it('should handle bins below the reference point', () => {
        const swapData = { activeId: 8388508 }; // 100 bins below reference
        const baseline = { activeId: 8388508, binStep: BIN_STEP };

        const result = adapter.evaluatePriceMovement(swapData, baseline, WETH, USDC);

        expect(result.priceMovementPercent).toBe(0);
        // Price should still be positive (just < reference price)
        expect(parseFloat(result.baselinePrice)).toBeGreaterThan(0);
      });

      it('should handle different binStep values', () => {
        const swapData = { activeId: 8388618 }; // 10 bins up
        const baseline100 = { activeId: 8388608, binStep: 100 }; // 1% per bin
        const baseline10 = { activeId: 8388608, binStep: 10 };   // 0.1% per bin

        const result100 = adapter.evaluatePriceMovement(swapData, baseline100, WETH, USDC);
        const result10 = adapter.evaluatePriceMovement(swapData, baseline10, WETH, USDC);

        // Larger binStep → bigger price change for same bin delta
        expect(result100.priceMovementPercent).toBeGreaterThan(result10.priceMovementPercent);
      });
    });
  });

  describe('evaluatePositionRange', () => {
    describe('Success Cases (with swapData)', () => {
      it('should return inRange=true when activeId is within bounds', async () => {
        const position = { lowerBinId: 8388500, upperBinId: 8388700 };
        const swapData = { activeId: 8388600 };

        const result = await adapter.evaluatePositionRange(position, null, { swapData });

        expect(result.inRange).toBe(true);
        expect(result.current).toBe(8388600);
      });

      it('should return inRange=false when activeId is below lower bound', async () => {
        const position = { lowerBinId: 8388500, upperBinId: 8388700 };
        const swapData = { activeId: 8388400 };

        const result = await adapter.evaluatePositionRange(position, null, { swapData });

        expect(result.inRange).toBe(false);
      });

      it('should return inRange=false when activeId is above upper bound', async () => {
        const position = { lowerBinId: 8388500, upperBinId: 8388700 };
        const swapData = { activeId: 8388800 };

        const result = await adapter.evaluatePositionRange(position, null, { swapData });

        expect(result.inRange).toBe(false);
      });

      it('should return inRange=true at exact lower bound', async () => {
        const position = { lowerBinId: 100, upperBinId: 200 };
        const swapData = { activeId: 100 };

        const result = await adapter.evaluatePositionRange(position, null, { swapData });

        expect(result.inRange).toBe(true);
        expect(result.centeredness).toBeCloseTo(0, 5);
        expect(result.distanceToLower).toBeCloseTo(0, 5);
        expect(result.distanceToUpper).toBeCloseTo(1, 5);
      });

      it('should return inRange=true at exact upper bound', async () => {
        const position = { lowerBinId: 100, upperBinId: 200 };
        const swapData = { activeId: 200 };

        const result = await adapter.evaluatePositionRange(position, null, { swapData });

        expect(result.inRange).toBe(true);
        expect(result.centeredness).toBeCloseTo(1, 5);
        expect(result.distanceToLower).toBeCloseTo(1, 5);
        expect(result.distanceToUpper).toBeCloseTo(0, 5);
      });

      it('should return centeredness=0.5 when perfectly centered', async () => {
        const position = { lowerBinId: 100, upperBinId: 200 };
        const swapData = { activeId: 150 };

        const result = await adapter.evaluatePositionRange(position, null, { swapData });

        expect(result.inRange).toBe(true);
        expect(result.centeredness).toBeCloseTo(0.5, 5);
        expect(result.distanceToLower).toBeCloseTo(0.5, 5);
        expect(result.distanceToUpper).toBeCloseTo(0.5, 5);
      });

      it('should clamp metrics to 0-1 when out of range', async () => {
        const position = { lowerBinId: 100, upperBinId: 200 };
        const swapData = { activeId: 50 }; // Way below lower bound

        const result = await adapter.evaluatePositionRange(position, null, { swapData });

        expect(result.inRange).toBe(false);
        expect(result.centeredness).toBe(0); // Clamped
        expect(result.distanceToLower).toBe(0); // Clamped
        expect(result.distanceToUpper).toBe(1); // Clamped
      });
    });

    describe('Success Cases (from blockchain)', () => {
      it('should fetch activeId from chain when no swapData provided', async () => {
        // First discover a real pool
        let poolAddress;
        try {
          const poolResult = await adapter.selectBestPool('WAVAX', 'USDC', env.provider, env.chainId);
          poolAddress = poolResult.bestPool.address;
        } catch (error) {
          if (error.message.includes('No pools found') || error.message.includes('No active pools')) {
            console.log('No Trader Joe V2.2 WAVAX/USDC pools - skipping blockchain test');
            return;
          }
          throw error;
        }

        // Create a position that spans a wide range around the active bin
        const poolData = await adapter.getPoolData(poolAddress, env.provider);
        const position = {
          lowerBinId: poolData.activeId - 100,
          upperBinId: poolData.activeId + 100,
          pool: poolAddress
        };

        const result = await adapter.evaluatePositionRange(position, env.provider);

        expect(result.inRange).toBe(true);
        expect(result.centeredness).toBeGreaterThan(0);
        expect(result.centeredness).toBeLessThan(1);
        expect(typeof result.current).toBe('number');
      }, 30000);
    });

    describe('Error Cases', () => {
      it('should throw if position is null', async () => {
        await expect(adapter.evaluatePositionRange(null, null))
          .rejects.toThrow('position parameter is required');
      });

      it('should throw if position is undefined', async () => {
        await expect(adapter.evaluatePositionRange(undefined, null))
          .rejects.toThrow('position parameter is required');
      });

      it('should throw if lowerBinId is missing', async () => {
        await expect(adapter.evaluatePositionRange({ upperBinId: 100 }, null, { swapData: { activeId: 50 } }))
          .rejects.toThrow('Position missing bin range data');
      });

      it('should throw if upperBinId is missing', async () => {
        await expect(adapter.evaluatePositionRange({ lowerBinId: 100 }, null, { swapData: { activeId: 50 } }))
          .rejects.toThrow('Position missing bin range data');
      });

      it('should throw if swapData has no activeId', async () => {
        const position = { lowerBinId: 100, upperBinId: 200 };
        await expect(adapter.evaluatePositionRange(position, null, { swapData: {} }))
          .rejects.toThrow('options.swapData must have activeId property as a number');
      });

      it('should throw if swapData.activeId is not finite', async () => {
        const position = { lowerBinId: 100, upperBinId: 200 };
        await expect(adapter.evaluatePositionRange(position, null, { swapData: { activeId: Infinity } }))
          .rejects.toThrow('options.swapData.activeId must be a finite number');
      });

      it('should throw if no swapData and no pool address', async () => {
        const position = { lowerBinId: 100, upperBinId: 200 };
        await expect(adapter.evaluatePositionRange(position, null))
          .rejects.toThrow('Position missing pool address');
      });

      it('should throw if bin range is invalid (lower >= upper)', async () => {
        const position = { lowerBinId: 200, upperBinId: 100 };
        await expect(adapter.evaluatePositionRange(position, null, { swapData: { activeId: 150 } }))
          .rejects.toThrow('Invalid bin range: 200 to 100');
      });
    });
  });

  describe('selectBestPool', () => {
    // Note: The Graph API key is configured via configureTheGraph
    // Mock provider for validation tests only
    const mockProvider = {
      getNetwork: () => Promise.resolve({ chainId: 42161 })
    };

    describe('Parameter Validation', () => {
      it('should throw error for invalid tokenASymbol values', async () => {
        await expect(adapter.selectBestPool(null, 'USDC', mockProvider, env.chainId))
          .rejects.toThrow('tokenASymbol parameter is required and must be a string');

        await expect(adapter.selectBestPool(undefined, 'USDC', mockProvider, env.chainId))
          .rejects.toThrow('tokenASymbol parameter is required and must be a string');

        await expect(adapter.selectBestPool('', 'USDC', mockProvider, env.chainId))
          .rejects.toThrow('tokenASymbol parameter is required and must be a string');

        await expect(adapter.selectBestPool(123, 'USDC', mockProvider, env.chainId))
          .rejects.toThrow('tokenASymbol parameter is required and must be a string');
      });

      it('should throw error for invalid tokenBSymbol values', async () => {
        await expect(adapter.selectBestPool('WAVAX', null, mockProvider, env.chainId))
          .rejects.toThrow('tokenBSymbol parameter is required and must be a string');

        await expect(adapter.selectBestPool('WAVAX', undefined, mockProvider, env.chainId))
          .rejects.toThrow('tokenBSymbol parameter is required and must be a string');

        await expect(adapter.selectBestPool('WAVAX', '', mockProvider, env.chainId))
          .rejects.toThrow('tokenBSymbol parameter is required and must be a string');

        await expect(adapter.selectBestPool('WAVAX', 123, mockProvider, env.chainId))
          .rejects.toThrow('tokenBSymbol parameter is required and must be a string');
      });

      it('should throw error for invalid provider values', async () => {
        await expect(adapter.selectBestPool('WAVAX', 'USDC', null, env.chainId))
          .rejects.toThrow('provider parameter is required and must be an ethers provider instance');

        await expect(adapter.selectBestPool('WAVAX', 'USDC', undefined, env.chainId))
          .rejects.toThrow('provider parameter is required and must be an ethers provider instance');

        await expect(adapter.selectBestPool('WAVAX', 'USDC', {}, env.chainId))
          .rejects.toThrow('provider parameter is required and must be an ethers provider instance');

        await expect(adapter.selectBestPool('WAVAX', 'USDC', 'not-a-provider', env.chainId))
          .rejects.toThrow('provider parameter is required and must be an ethers provider instance');
      });

      it('should throw error for invalid chainId values', async () => {
        await expect(adapter.selectBestPool('WAVAX', 'USDC', mockProvider, null))
          .rejects.toThrow('chainId parameter is required and must be a number');

        await expect(adapter.selectBestPool('WAVAX', 'USDC', mockProvider, undefined))
          .rejects.toThrow('chainId parameter is required and must be a number');

        await expect(adapter.selectBestPool('WAVAX', 'USDC', mockProvider, '42161'))
          .rejects.toThrow('chainId parameter is required and must be a number');
      });

      it('should throw error for unknown token symbols', async () => {
        await expect(adapter.selectBestPool('UNKNOWN_TOKEN', 'USDC', mockProvider, env.chainId))
          .rejects.toThrow('Token UNKNOWN_TOKEN not found');

        await expect(adapter.selectBestPool('WAVAX', 'UNKNOWN_TOKEN', mockProvider, env.chainId))
          .rejects.toThrow('Token UNKNOWN_TOKEN not found');
      });
    });

    describe('Success Cases', () => {
      // Note: These tests use Hardhat fork of Avalanche
      // Trader Joe V2.2 has active pools on Avalanche

      it('should search for WAVAX/USDC pools on Avalanche', async () => {
        try {
          const result = await adapter.selectBestPool('WAVAX', 'USDC', env.provider, env.chainId);

          // Verify structure
          expect(result).toHaveProperty('bestPool');
          expect(result).toHaveProperty('poolsDiscovered');
          expect(result).toHaveProperty('poolsActive');
          expect(result.poolsDiscovered).toBeGreaterThanOrEqual(result.poolsActive);
          expect(result.poolsActive).toBeGreaterThan(0);

          // Verify bestPool has expected properties
          expect(result.bestPool).toHaveProperty('address');
          expect(result.bestPool).toHaveProperty('binStep');
          expect(result.bestPool).toHaveProperty('activeId');
          expect(result.bestPool).toHaveProperty('tokenX');
          expect(result.bestPool).toHaveProperty('tokenY');
          expect(result.bestPool).toHaveProperty('reserveX');
          expect(result.bestPool).toHaveProperty('reserveY');

          // Verify token structures
          expect(result.bestPool.tokenX).toHaveProperty('address');
          expect(result.bestPool.tokenX).toHaveProperty('symbol');
          expect(result.bestPool.tokenX).toHaveProperty('decimals');
          expect(result.bestPool.tokenX.isNative).toBe(false);
          expect(result.bestPool.tokenY).toHaveProperty('address');
          expect(result.bestPool.tokenY).toHaveProperty('symbol');
          expect(result.bestPool.tokenY).toHaveProperty('decimals');
          expect(result.bestPool.tokenY.isNative).toBe(false);

          // Verify normalized token0/token1 aliases for cross-platform strategy compatibility
          expect(result.bestPool.token0).toBe(result.bestPool.tokenX);
          expect(result.bestPool.token1).toBe(result.bestPool.tokenY);
        } catch (error) {
          if (error.message.includes('No pools found') || error.message.includes('No active pools')) {
            console.log('No Trader Joe V2.2 WAVAX/USDC pools exist on Avalanche');
            return;
          }
          throw error;
        }
      }, 30000);

      it('should handle AVAX as native token (converts to WAVAX)', async () => {
        try {
          const result = await adapter.selectBestPool('AVAX', 'USDC', env.provider, env.chainId);

          expect(result).toHaveProperty('bestPool');
          expect(result).toHaveProperty('poolsDiscovered');
          expect(result).toHaveProperty('poolsActive');
        } catch (error) {
          if (error.message.includes('No pools found') || error.message.includes('No active pools')) {
            console.log('No Trader Joe V2.2 AVAX/USDC pools exist on Avalanche');
            return;
          }
          throw error;
        }
      }, 30000);

      it('should sort tokens correctly regardless of input order', async () => {
        try {
          // Try both orderings - should get same result
          const resultAB = await adapter.selectBestPool('WAVAX', 'USDC', env.provider, env.chainId);
          const resultBA = await adapter.selectBestPool('USDC', 'WAVAX', env.provider, env.chainId);

          // Should find the same pools regardless of order
          expect(resultAB.poolsDiscovered).toBe(resultBA.poolsDiscovered);
          expect(resultAB.bestPool.address).toBe(resultBA.bestPool.address);
        } catch (error) {
          if (error.message.includes('No pools found') || error.message.includes('No active pools')) {
            console.log('No Trader Joe V2.2 pools exist for token pair');
            return;
          }
          throw error;
        }
      }, 60000); // 60s for two on-chain queries
    });

    describe('Error Cases', () => {
      it('should throw when token is not available on chain', async () => {
        await expect(adapter.selectBestPool('WAVAX', 'USDC', mockProvider, 999999))
          .rejects.toThrow(/No wrapped native token configured for chain/);
      });
    });
  });

  describe('getPoolData', () => {
    // Note: These tests use real API calls to Avalanche
    // They require a real LBPair address

    describe('Parameter Validation', () => {
      const mockProvider = { getNetwork: () => Promise.resolve({ chainId: 42161 }) };

      it('should throw error for null poolId', async () => {
        await expect(adapter.getPoolData(null, mockProvider))
          .rejects.toThrow('poolId parameter is required and must be a string');
      });

      it('should throw error for empty poolId', async () => {
        await expect(adapter.getPoolData('', mockProvider))
          .rejects.toThrow('poolId parameter is required and must be a string');
      });

      it('should throw error for invalid address format', async () => {
        await expect(adapter.getPoolData('0xinvalid', mockProvider))
          .rejects.toThrow('Invalid poolId address');
      });

      it('should throw error for null provider', async () => {
        // Use lowercase address to avoid checksum issues
        await expect(adapter.getPoolData('0xd446eb1660f766d533beceef890df7a69d26f7d5', null))
          .rejects.toThrow('Provider parameter is required');
      });
    });

    describe('Success Cases', () => {
      it('should return pool data with correct structure for real LBPair', async () => {
        // First find a real pool via Hardhat fork
        let poolAddress;
        try {
          const result = await adapter.selectBestPool('WAVAX', 'USDC', env.provider, env.chainId);
          poolAddress = result.bestPool.address;
        } catch (error) {
          if (error.message.includes('No pools found') || error.message.includes('No active pools')) {
            console.log('No Trader Joe V2.2 WAVAX/USDC pools exist - skipping getPoolData test');
            return;
          }
          throw error;
        }

        // Now test getPoolData with the real pool
        const poolData = await adapter.getPoolData(poolAddress, env.provider);

        // Verify structure
        expect(poolData).toHaveProperty('address');
        expect(poolData.address).toBe(poolAddress);
        expect(poolData).toHaveProperty('activeId');
        expect(typeof poolData.activeId).toBe('number');
        expect(poolData).toHaveProperty('binStep');
        expect(typeof poolData.binStep).toBe('number');
        expect(poolData).toHaveProperty('reserveX');
        expect(poolData).toHaveProperty('reserveY');
        expect(poolData).toHaveProperty('tokenX');
        expect(poolData).toHaveProperty('tokenY');
        expect(poolData).toHaveProperty('feeParameters');
        expect(poolData).toHaveProperty('lastUpdated');

        // Verify fee parameters structure
        expect(poolData.feeParameters).toHaveProperty('baseFactor');
        expect(poolData.feeParameters).toHaveProperty('filterPeriod');
        expect(poolData.feeParameters).toHaveProperty('decayPeriod');
        expect(poolData.feeParameters).toHaveProperty('reductionFactor');
        expect(poolData.feeParameters).toHaveProperty('variableFeeControl');
        expect(poolData.feeParameters).toHaveProperty('protocolShare');
        expect(poolData.feeParameters).toHaveProperty('maxVolatilityAccumulator');
      }, 60000);
    });
  });

  describe('generateCreatePositionData', () => {
    // Real Avalanche token addresses
    const WETH = {
      address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
      symbol: 'WETH',
      decimals: 18,
    };
    const USDC = {
      address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
      symbol: 'USDC',
      decimals: 6,
    };

    // ABI for decoding createPosition calldata
    const createPositionIface = new ethers.utils.Interface([
      "function createPosition(address vault, address lbPair, uint256 amountX, uint256 amountY, uint256 amountXMin, uint256 amountYMin, uint256 activeIdDesired, uint256 idSlippage, int256[] deltaIds, uint256[] distributionX, uint256[] distributionY, uint256 deadline)"
    ]);

    describe('Input Validation', () => {
      // Use a fake positionManagerAddress for validation tests
      let adapterWithPM;

      beforeAll(() => {
        adapterWithPM = adapter;
      });

      const validParams = () => ({
        position: { lowerBinId: 8388500, upperBinId: 8388700 },
        token0Amount: '1000000000000000000',
        token1Amount: '1000000000',
        provider: env.provider,
        walletAddress: '0x0000000000000000000000000000000000000001',
        poolData: { activeId: 8388608, binStep: 20, address: '0x0000000000000000000000000000000000000002' },
        token0Data: WETH,
        token1Data: USDC,
        slippageTolerance: 5,
        deadlineMinutes: 10,
      });

      it('should throw if position is null', async () => {
        await expect(adapterWithPM.generateCreatePositionData({ ...validParams(), position: null }))
          .rejects.toThrow('Position parameter is required');
      });

      it('should throw if position is undefined', async () => {
        await expect(adapterWithPM.generateCreatePositionData({ ...validParams(), position: undefined }))
          .rejects.toThrow('Position parameter is required');
      });

      it('should throw if position.lowerBinId is missing', async () => {
        await expect(adapterWithPM.generateCreatePositionData({ ...validParams(), position: { upperBinId: 100 } }))
          .rejects.toThrow('Position lowerBinId is required');
      });

      it('should throw if position.upperBinId is missing', async () => {
        await expect(adapterWithPM.generateCreatePositionData({ ...validParams(), position: { lowerBinId: 100 } }))
          .rejects.toThrow('Position upperBinId is required');
      });

      it('should throw if lowerBinId >= upperBinId', async () => {
        await expect(adapterWithPM.generateCreatePositionData({ ...validParams(), position: { lowerBinId: 200, upperBinId: 100 } }))
          .rejects.toThrow('Position lowerBinId must be less than upperBinId');
      });

      it('should throw if token0Amount is null', async () => {
        await expect(adapterWithPM.generateCreatePositionData({ ...validParams(), token0Amount: null }))
          .rejects.toThrow('Token0 amount is required');
      });

      it('should throw if token0Amount is not a string', async () => {
        await expect(adapterWithPM.generateCreatePositionData({ ...validParams(), token0Amount: 123 }))
          .rejects.toThrow('Token0 amount must be a string');
      });

      it('should throw if both amounts are zero', async () => {
        await expect(adapterWithPM.generateCreatePositionData({ ...validParams(), token0Amount: '0', token1Amount: '0' }))
          .rejects.toThrow('At least one token amount must be greater than 0');
      });

      it('should throw if walletAddress is empty', async () => {
        await expect(adapterWithPM.generateCreatePositionData({ ...validParams(), walletAddress: '' }))
          .rejects.toThrow('Wallet address is required');
      });

      it('should throw if walletAddress is invalid', async () => {
        await expect(adapterWithPM.generateCreatePositionData({ ...validParams(), walletAddress: 'invalid' }))
          .rejects.toThrow('Invalid wallet address');
      });

      it('should throw if poolData is null', async () => {
        await expect(adapterWithPM.generateCreatePositionData({ ...validParams(), poolData: null }))
          .rejects.toThrow('Pool data parameter is required');
      });

      it('should throw if poolData.activeId is missing', async () => {
        await expect(adapterWithPM.generateCreatePositionData({ ...validParams(), poolData: { binStep: 20, address: '0x01' } }))
          .rejects.toThrow('Pool data activeId is required');
      });

      it('should throw if poolData.binStep is zero', async () => {
        await expect(adapterWithPM.generateCreatePositionData({ ...validParams(), poolData: { activeId: 100, binStep: 0, address: '0x01' } }))
          .rejects.toThrow('Pool data binStep must be a positive finite number');
      });

      it('should throw if token0Data is null', async () => {
        await expect(adapterWithPM.generateCreatePositionData({ ...validParams(), token0Data: null }))
          .rejects.toThrow('Token0 data parameter is required');
      });

      it('should throw if token1Data is null', async () => {
        await expect(adapterWithPM.generateCreatePositionData({ ...validParams(), token1Data: null }))
          .rejects.toThrow('Token1 data parameter is required');
      });

      it('should throw if token0 and token1 have same address', async () => {
        await expect(adapterWithPM.generateCreatePositionData({ ...validParams(), token1Data: WETH }))
          .rejects.toThrow('Token0 and token1 addresses cannot be the same');
      });

      it('should throw if slippageTolerance is out of range', async () => {
        await expect(adapterWithPM.generateCreatePositionData({ ...validParams(), slippageTolerance: 101 }))
          .rejects.toThrow('Slippage tolerance must be between 0 and 100');
      });

      it('should throw if deadlineMinutes is zero', async () => {
        await expect(adapterWithPM.generateCreatePositionData({ ...validParams(), deadlineMinutes: 0 }))
          .rejects.toThrow('Deadline minutes must be greater than 0');
      });

      it('should throw if positionManagerAddress is not configured', async () => {
        const adapterNoPM = new TraderJoeV2_2Adapter(env.chainId, env.provider);
        adapterNoPM.addresses.positionManagerAddress = '';
        await expect(adapterNoPM.generateCreatePositionData(validParams()))
          .rejects.toThrow('No position manager address found');
      });
    });

    describe('Success Cases', () => {
      it('should generate valid calldata for WETH/USDC position', async () => {
        // Discover a real pool
        let poolResult, poolData, positionRange;
        try {
          poolResult = await adapter.selectBestPool('WAVAX', 'USDC', env.provider, env.chainId);
          poolData = await adapter.getPoolData(poolResult.bestPool.address, env.provider);
          positionRange = adapter.getPositionRange(poolData, 1, 1);
        } catch (error) {
          if (error.message.includes('No pools found') || error.message.includes('No active pools')) {
            console.log('No Trader Joe V2.2 WAVAX/USDC pools - skipping');
            return;
          }
          throw error;
        }

        const result = await adapter.generateCreatePositionData({
          position: positionRange,
          token0Amount: ethers.utils.parseEther('1').toString(),
          token1Amount: ethers.utils.parseUnits('2000', 6).toString(),
          provider: env.provider,
          walletAddress: '0x0000000000000000000000000000000000000001',
          poolData,
          token0Data: WETH,
          token1Data: USDC,
          slippageTolerance: 5,
          deadlineMinutes: 10,
        });

        // Verify return structure
        expect(result).toHaveProperty('to');
        expect(result).toHaveProperty('data');
        expect(result).toHaveProperty('value');
        expect(result).toHaveProperty('quote');

        // Verify 'to' is the position manager
        expect(result.to).toBe(adapter.addresses.positionManagerAddress);

        // Verify value is zero (TJ uses WETH, not native ETH)
        expect(result.value).toBe('0x00');

        // Verify calldata can be decoded
        const decoded = createPositionIface.decodeFunctionData('createPosition', result.data);
        expect(decoded.vault).toBe('0x0000000000000000000000000000000000000001');
        expect(decoded.lbPair).toBe(poolData.address);
        expect(decoded.activeIdDesired.toNumber()).toBe(poolData.activeId);
      }, 60000);

      it('should sort tokens to TJ canonical order (tokenX = lower address)', async () => {
        // WETH (0x82aF...) < USDC (0xaf88...) so WETH = tokenX
        const poolData = {
          activeId: 8388608,
          binStep: 20,
          address: '0x0000000000000000000000000000000000000002',
        };
        const position = { lowerBinId: 8388500, upperBinId: 8388700 };

        // Pass USDC as token0 (higher address) and WETH as token1 (lower address)
        // Adapter should swap them so amountX = token1Amount (WETH) and amountY = token0Amount (USDC)
        const result = await adapter.generateCreatePositionData({
          position,
          token0Amount: '2000000000', // USDC amount (6 decimals)
          token1Amount: '1000000000000000000', // WETH amount (18 decimals)
          provider: env.provider,
          walletAddress: '0x0000000000000000000000000000000000000001',
          poolData,
          token0Data: USDC, // caller's token0 = USDC
          token1Data: WETH, // caller's token1 = WETH
          slippageTolerance: 5,
          deadlineMinutes: 10,
        });

        // Decode and verify token ordering
        const decoded = createPositionIface.decodeFunctionData('createPosition', result.data);

        // tokensSwapped should be true (USDC > WETH, so inputs were swapped)
        expect(result.quote.tokensSwapped).toBe(true);

        // amountX should be the WETH amount (lower address = tokenX)
        expect(decoded.amountX.toString()).toBe('1000000000000000000');
        // amountY should be the USDC amount (higher address = tokenY)
        expect(decoded.amountY.toString()).toBe('2000000000');
      });

      it('should not swap when tokens are already in canonical order', async () => {
        const poolData = {
          activeId: 8388608,
          binStep: 20,
          address: '0x0000000000000000000000000000000000000002',
        };
        const position = { lowerBinId: 8388500, upperBinId: 8388700 };

        // Pass WETH as token0 (lower address, already correct)
        const result = await adapter.generateCreatePositionData({
          position,
          token0Amount: '1000000000000000000', // WETH
          token1Amount: '2000000000', // USDC
          provider: env.provider,
          walletAddress: '0x0000000000000000000000000000000000000001',
          poolData,
          token0Data: WETH,
          token1Data: USDC,
          slippageTolerance: 5,
          deadlineMinutes: 10,
        });

        expect(result.quote.tokensSwapped).toBe(false);

        const decoded = createPositionIface.decodeFunctionData('createPosition', result.data);
        expect(decoded.amountX.toString()).toBe('1000000000000000000'); // WETH
        expect(decoded.amountY.toString()).toBe('2000000000'); // USDC
      });

      it('should apply slippage correctly to min amounts', async () => {
        const poolData = {
          activeId: 8388608,
          binStep: 20,
          address: '0x0000000000000000000000000000000000000002',
        };
        const position = { lowerBinId: 8388500, upperBinId: 8388700 };

        const result = await adapter.generateCreatePositionData({
          position,
          token0Amount: '10000', // Simple numbers for easy math
          token1Amount: '20000',
          provider: env.provider,
          walletAddress: '0x0000000000000000000000000000000000000001',
          poolData,
          token0Data: WETH,
          token1Data: USDC,
          slippageTolerance: 10, // 10% slippage
          deadlineMinutes: 10,
        });

        // 10% slippage: min = amount * 90% = amount * 9000 / 10000
        // amountX = 10000 (WETH is lower address, no swap)
        // amountXMin = 10000 * 9000 / 10000 = 9000
        expect(result.quote.amountXMin).toBe('9000');
        expect(result.quote.amountYMin).toBe('18000'); // 20000 * 0.9
      });

      it('should include deltaIds and distributions from SDK in quote', async () => {
        const poolData = {
          activeId: 8388608,
          binStep: 20,
          address: '0x0000000000000000000000000000000000000002',
        };
        const position = { lowerBinId: 8388605, upperBinId: 8388611 };

        const result = await adapter.generateCreatePositionData({
          position,
          token0Amount: '1000000000000000000',
          token1Amount: '2000000000',
          provider: env.provider,
          walletAddress: '0x0000000000000000000000000000000000000001',
          poolData,
          token0Data: WETH,
          token1Data: USDC,
          slippageTolerance: 5,
          deadlineMinutes: 10,
        });

        // Verify quote has distribution data
        expect(Array.isArray(result.quote.deltaIds)).toBe(true);
        expect(Array.isArray(result.quote.distributionX)).toBe(true);
        expect(Array.isArray(result.quote.distributionY)).toBe(true);

        // Number of bins should match the range
        const expectedBins = position.upperBinId - position.lowerBinId + 1;
        expect(result.quote.deltaIds.length).toBe(expectedBins);
        expect(result.quote.distributionX.length).toBe(expectedBins);
        expect(result.quote.distributionY.length).toBe(expectedBins);

        // deltaIds should be relative to activeId
        // Position spans from -3 to +3 relative to activeId 8388608
        expect(result.quote.deltaIds[0]).toBe(-3); // 8388605 - 8388608
        expect(result.quote.deltaIds[result.quote.deltaIds.length - 1]).toBe(3); // 8388611 - 8388608

        // Verify distributions are present in calldata too
        const decoded = createPositionIface.decodeFunctionData('createPosition', result.data);
        expect(decoded.deltaIds.length).toBe(expectedBins);
        expect(decoded.distributionX.length).toBe(expectedBins);
        expect(decoded.distributionY.length).toBe(expectedBins);
      });

      it('should encode all 12 createPosition parameters correctly', async () => {
        const poolData = {
          activeId: 8388608,
          binStep: 20,
          address: '0x0000000000000000000000000000000000000002',
        };
        const position = { lowerBinId: 8388605, upperBinId: 8388611 };
        const vaultAddress = '0x0000000000000000000000000000000000000001';

        const result = await adapter.generateCreatePositionData({
          position,
          token0Amount: '1000000000000000000',
          token1Amount: '2000000000',
          provider: env.provider,
          walletAddress: vaultAddress,
          poolData,
          token0Data: WETH,
          token1Data: USDC,
          slippageTolerance: 5,
          deadlineMinutes: 10,
        });

        const decoded = createPositionIface.decodeFunctionData('createPosition', result.data);

        // 1. vault
        expect(decoded.vault).toBe(vaultAddress);
        // 2. lbPair
        expect(decoded.lbPair).toBe(poolData.address);
        // 3. amountX (WETH = lower address = tokenX)
        expect(decoded.amountX.toString()).toBe('1000000000000000000');
        // 4. amountY (USDC = higher address = tokenY)
        expect(decoded.amountY.toString()).toBe('2000000000');
        // 5. amountXMin (95% of amountX with 5% slippage)
        expect(decoded.amountXMin.toString()).toBe('950000000000000000');
        // 6. amountYMin (95% of amountY)
        expect(decoded.amountYMin.toString()).toBe('1900000000');
        // 7. activeIdDesired
        expect(decoded.activeIdDesired.toNumber()).toBe(8388608);
        // 8. idSlippage (should be > 0 for 5% slippage)
        expect(decoded.idSlippage.toNumber()).toBeGreaterThan(0);
        // 9-11. deltaIds, distributionX, distributionY (verified in other test)
        expect(decoded.deltaIds.length).toBe(7);
        // 12. deadline (should be in the future)
        expect(decoded.deadline.toNumber()).toBeGreaterThan(Math.floor(Date.now() / 1000));
      });

      it('should compute idSlippage correctly for known values', async () => {
        const poolData = {
          activeId: 8388608,
          binStep: 20, // 0.20% per bin
          address: '0x0000000000000000000000000000000000000002',
        };
        const position = { lowerBinId: 8388500, upperBinId: 8388700 };

        const result = await adapter.generateCreatePositionData({
          position,
          token0Amount: '1000000000000000000',
          token1Amount: '2000000000',
          provider: env.provider,
          walletAddress: '0x0000000000000000000000000000000000000001',
          poolData,
          token0Data: WETH,
          token1Data: USDC,
          slippageTolerance: 5,
          deadlineMinutes: 10,
        });

        // Formula: floor(log(1 + 0.05) / log(1 + 20/10000))
        // = floor(log(1.05) / log(1.002))
        // = floor(0.04879 / 0.001998) = floor(24.42) = 24
        const expected = Math.floor(Math.log(1.05) / Math.log(1.002));
        expect(result.quote.idSlippage).toBe(expected);
      });

      it('should execute end-to-end: approve → generateCreatePositionData → vault.mint()', async () => {
        // 1. Discover a real pool
        let poolData, positionRange;
        try {
          const poolResult = await adapter.selectBestPool('WAVAX', 'USDC', env.provider, env.chainId);
          poolData = await adapter.getPoolData(poolResult.bestPool.address, env.provider);
          positionRange = adapter.getPositionRange(poolData, 1, 1);
        } catch (error) {
          if (error.message.includes('No pools found') || error.message.includes('No active pools')) {
            console.log('No Trader Joe V2.2 WAVAX/USDC pools - skipping E2E test');
            return;
          }
          throw error;
        }

        const vaultAddress = testVault.address;
        const pmAddress = adapter.addresses.positionManagerAddress;

        // 2. Get vault token balances
        const vaultWavaxBal = await wavax.balanceOf(vaultAddress);
        const vaultUsdcBal = await usdc.balanceOf(vaultAddress);
        console.log(`  Vault balances: ${ethers.utils.formatEther(vaultWavaxBal)} WAVAX, ${ethers.utils.formatUnits(vaultUsdcBal, 6)} USDC`);

        // Use 10% of vault balances
        const wavaxAmount = vaultWavaxBal.div(10);
        const usdcAmount = vaultUsdcBal.div(10);

        // 3. Get required approvals and execute via vault.approve()
        const approvalTxs = await adapter.getRequiredApprovals(
          'liquidity', vaultAddress, [wavaxAddress, usdcAddress], env.provider
        );
        if (approvalTxs.length > 0) {
          const approveTargets = approvalTxs.map(t => t.to);
          const approveData = approvalTxs.map(t => t.data);
          await (await testVault.approve(approveTargets, approveData)).wait();
          console.log(`  Executed ${approvalTxs.length} approval(s)`);
        }

        // 4. Generate createPosition calldata
        const txData = await adapter.generateCreatePositionData({
          position: positionRange,
          token0Amount: wavaxAmount.toString(),
          token1Amount: usdcAmount.toString(),
          provider: env.provider,
          walletAddress: vaultAddress,
          poolData,
          token0Data: { address: wavaxAddress, symbol: 'WAVAX', decimals: 18 },
          token1Data: { address: usdcAddress, symbol: 'USDC', decimals: 6 },
          slippageTolerance: 5,
          deadlineMinutes: 10,
        });

        expect(txData.to).toBe(pmAddress);

        // 5. Execute vault.mint() with the calldata (no explicit estimateGas — this one always passes)
        const mintTx = await testVault.mint([pmAddress], [txData.data], [0]);
        const mintReceipt = await mintTx.wait();
        expect(mintReceipt.status).toBe(1);

        // 6. Verify position was created on TJPositionManager
        const tjpmAbi = contractData.TJPositionManager.abi;
        const tjpm = new ethers.Contract(pmAddress, tjpmAbi, env.provider);

        const positionCount = await tjpm.getPositionCount(vaultAddress);
        expect(positionCount.toNumber()).toBeGreaterThanOrEqual(1);

        const positionIds = await tjpm.getPositionsByVault(vaultAddress);
        const position = await tjpm.getPosition(positionIds[0]);

        expect(position.vault).toBe(vaultAddress);
        expect(position.lbPair).toBe(poolData.address);
        expect(position.active).toBe(true);
        expect(position.depositIds.length).toBeGreaterThan(0);
        expect(position.liquidityMinted.length).toBeGreaterThan(0);

        console.log(`  Position created! ID: ${positionIds[0]}, bins: ${position.depositIds.length}`);
      }, 120000);
    });
  });

  describe('getPositionsForVDS', () => {
    describe('Error Cases', () => {
      it('should throw when address is null', async () => {
        await expect(adapter.getPositionsForVDS(null, env.provider))
          .rejects.toThrow('Address parameter is required');
      });

      it('should throw when address is undefined', async () => {
        await expect(adapter.getPositionsForVDS(undefined, env.provider))
          .rejects.toThrow('Address parameter is required');
      });

      it('should throw when address is empty string', async () => {
        await expect(adapter.getPositionsForVDS('', env.provider))
          .rejects.toThrow('Address parameter is required');
      });

      it('should throw when address is invalid', async () => {
        await expect(adapter.getPositionsForVDS('not-an-address', env.provider))
          .rejects.toThrow('Invalid address: not-an-address');
      });

      it('should throw when provider is null', async () => {
        await expect(adapter.getPositionsForVDS('0x0000000000000000000000000000000000000001', null))
          .rejects.toThrow('Valid provider parameter is required');
      });

      it('should throw when provider is undefined', async () => {
        await expect(adapter.getPositionsForVDS('0x0000000000000000000000000000000000000001', undefined))
          .rejects.toThrow('Valid provider parameter is required');
      });

      it('should throw when provider lacks getNetwork', async () => {
        await expect(adapter.getPositionsForVDS('0x0000000000000000000000000000000000000001', {}))
          .rejects.toThrow('Valid provider parameter is required');
      });
    });

    describe('E2E Tests', () => {
      it('should return { positions, poolData } with correct top-level structure', async () => {
        const result = await adapter.getPositionsForVDS(testVault.address, env.provider);

        expect(result).toHaveProperty('positions');
        expect(result).toHaveProperty('poolData');
        expect(typeof result.positions).toBe('object');
        expect(typeof result.poolData).toBe('object');
        expect(Array.isArray(result.positions)).toBe(false);
        expect(Array.isArray(result.poolData)).toBe(false);
      }, 60000);

      it('should return positions keyed by position ID', async () => {
        const result = await adapter.getPositionsForVDS(testVault.address, env.provider);

        const positionKeys = Object.keys(result.positions);
        expect(positionKeys.length).toBeGreaterThan(0);

        for (const [key, position] of Object.entries(result.positions)) {
          expect(position.id).toBe(key);
        }
      }, 60000);

      it('should return positions with correct TJ V2.2 fields', async () => {
        const result = await adapter.getPositionsForVDS(testVault.address, env.provider);

        const positionKeys = Object.keys(result.positions);
        if (positionKeys.length === 0) return;

        const position = result.positions[positionKeys[0]];
        const expectedFields = [
          'id', 'pool', 'proxy', 'lowerBinId', 'upperBinId',
          'depositIds', 'liquidityMinted', 'active', 'createdAt', 'lastUpdated'
        ];
        expect(Object.keys(position).sort()).toEqual(expectedFields.sort());
      }, 60000);

      it('should return correct field types for positions', async () => {
        const result = await adapter.getPositionsForVDS(testVault.address, env.provider);

        for (const position of Object.values(result.positions)) {
          expect(typeof position.id).toBe('string');
          expect(typeof position.pool).toBe('string');
          expect(typeof position.proxy).toBe('string');
          expect(typeof position.lowerBinId).toBe('number');
          expect(typeof position.upperBinId).toBe('number');
          expect(Array.isArray(position.depositIds)).toBe(true);
          expect(Array.isArray(position.liquidityMinted)).toBe(true);
          expect(typeof position.active).toBe('boolean');
          expect(typeof position.createdAt).toBe('number');
          expect(typeof position.lastUpdated).toBe('number');
        }
      }, 60000);

      it('should only return active positions', async () => {
        const result = await adapter.getPositionsForVDS(testVault.address, env.provider);

        for (const position of Object.values(result.positions)) {
          expect(position.active).toBe(true);
        }
      }, 60000);

      it('should return poolData keyed by pool address', async () => {
        const result = await adapter.getPositionsForVDS(testVault.address, env.provider);

        for (const [poolAddress, poolInfo] of Object.entries(result.poolData)) {
          expect(poolAddress).toMatch(/^0x[a-f0-9]{40}$/);
          expect(poolInfo).toHaveProperty('token0Symbol');
          expect(poolInfo).toHaveProperty('token1Symbol');
          expect(poolInfo).toHaveProperty('binStep');
          expect(poolInfo).toHaveProperty('platform');
          expect(poolInfo.platform).toBe('traderjoeV2_2');
          expect(typeof poolInfo.binStep).toBe('number');
        }
      }, 60000);

      it('should return empty results for address with no positions', async () => {
        // Use a random address that has no positions
        const randomAddress = '0x0000000000000000000000000000000000000001';
        const result = await adapter.getPositionsForVDS(randomAddress, env.provider);

        expect(result.positions).toEqual({});
        expect(result.poolData).toEqual({});
      }, 30000);

      it('should filter out inactive positions from removed liquidity', async () => {
        // Get all positions from the contract (includes inactive ones from removal E2E tests)
        const pmAddress = adapter.addresses.positionManagerAddress;
        const tjpm = new ethers.Contract(pmAddress, contractData.TJPositionManager.abi, env.provider);
        const allPositionIds = await tjpm.getPositionsByVault(testVault.address);

        // Count active vs total on-chain
        let activeCount = 0;
        for (const id of allPositionIds) {
          const pos = await tjpm.getPosition(id);
          if (pos.active) activeCount++;
        }

        // getPositionsForVDS should only return active positions
        const result = await adapter.getPositionsForVDS(testVault.address, env.provider);
        const vdsCount = Object.keys(result.positions).length;

        expect(vdsCount).toBe(activeCount);
        expect(vdsCount).toBeLessThanOrEqual(allPositionIds.length);
      }, 60000);
    });
  });

  describe('getPositionsForDisplay', () => {
    describe('Success Cases', () => {
      it('should return positions object with correct shape and field types', async () => {
        const result = await adapter.getPositionsForDisplay(testVault.address, env.provider);

        // Verify top-level structure
        expect(result).toHaveProperty('positions');
        expect(typeof result.positions).toBe('object');
        expect(Array.isArray(result.positions)).toBe(false);

        // Should not have poolData in return
        expect(result).not.toHaveProperty('poolData');

        // Should have at least 1 position from E2E test setup
        const positionIds = Object.keys(result.positions);
        expect(positionIds.length).toBeGreaterThanOrEqual(1);

        const position = result.positions[positionIds[0]];

        // Verify only expected fields are present
        const expectedFields = [
          'id', 'platform', 'platformName', 'tokenPair', 'pool',
          'inRange', 'currentPrice', 'priceLower', 'priceUpper',
          'token0Amount', 'token1Amount', 'uncollectedFees0', 'uncollectedFees1',
          'fee', 'platformData'
        ];
        expect(Object.keys(position).sort()).toEqual(expectedFields.sort());
      }, 60000);

      it('should have correct identity fields', async () => {
        const result = await adapter.getPositionsForDisplay(testVault.address, env.provider);
        const position = Object.values(result.positions)[0];

        expect(position.platform).toBe('traderjoeV2_2');
        expect(position.platformName).toBe('Trader Joe V2.2');
        expect(position.pool).toMatch(/^0x[a-fA-F0-9]{40}$/);
        expect(position.tokenPair).toContain('/');

        // Should be WAVAX/USDC pair
        const [sym0, sym1] = position.tokenPair.split('/');
        expect([sym0, sym1].sort()).toEqual(['USDC', 'WAVAX']);
      }, 60000);

      it('should have numeric display values with correct types', async () => {
        const result = await adapter.getPositionsForDisplay(testVault.address, env.provider);
        const position = Object.values(result.positions)[0];

        expect(typeof position.inRange).toBe('boolean');
        expect(typeof position.currentPrice).toBe('number');
        expect(typeof position.priceLower).toBe('number');
        expect(typeof position.priceUpper).toBe('number');
        expect(typeof position.token0Amount).toBe('number');
        expect(typeof position.token1Amount).toBe('number');
        expect(typeof position.uncollectedFees0).toBe('number');
        expect(typeof position.uncollectedFees1).toBe('number');
        expect(typeof position.fee).toBe('number');
        expect(typeof position.platformData).toBe('object');

        // Prices should be positive
        expect(position.currentPrice).toBeGreaterThan(0);
        expect(position.priceLower).toBeGreaterThan(0);
        expect(position.priceUpper).toBeGreaterThan(0);
        // At least one token amount should be > 0 for an active position
        expect(position.token0Amount + position.token1Amount).toBeGreaterThan(0);
      }, 60000);

      it('should compute fee from baseFactor × binStep', async () => {
        const result = await adapter.getPositionsForDisplay(testVault.address, env.provider);
        const position = Object.values(result.positions)[0];

        // Verify fee against pool data
        const poolData = await adapter.getPoolData(position.pool, env.provider);
        const expectedFee = poolData.feeParameters.baseFactor * poolData.binStep / 1e8;
        expect(position.fee).toBe(expectedFee);
      }, 60000);

      it('should have platformData with TJ-specific fields', async () => {
        const result = await adapter.getPositionsForDisplay(testVault.address, env.provider);
        const position = Object.values(result.positions)[0];

        const expectedPlatformFields = [
          'lowerBinId', 'upperBinId', 'binStep', 'depositIds', 'activeId', 'proxyAddress'
        ];
        expect(Object.keys(position.platformData).sort()).toEqual(expectedPlatformFields.sort());

        // Types
        expect(typeof position.platformData.lowerBinId).toBe('number');
        expect(typeof position.platformData.upperBinId).toBe('number');
        expect(typeof position.platformData.binStep).toBe('number');
        expect(Array.isArray(position.platformData.depositIds)).toBe(true);
        expect(typeof position.platformData.activeId).toBe('number');
        expect(typeof position.platformData.proxyAddress).toBe('string');
        expect(position.platformData.proxyAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);

        // Bin bounds consistency
        expect(position.platformData.lowerBinId).toBeLessThanOrEqual(position.platformData.upperBinId);
      }, 60000);

      it('should only contain expected fields (no extra fields leak)', async () => {
        const result = await adapter.getPositionsForDisplay(testVault.address, env.provider);
        const position = Object.values(result.positions)[0];

        // Top-level: only 'positions' key
        expect(Object.keys(result)).toEqual(['positions']);

        // Position: exactly 15 fields
        expect(Object.keys(position).length).toBe(15);

        // No VDS-specific fields should leak
        expect(position).not.toHaveProperty('proxy');
        expect(position).not.toHaveProperty('depositIds');
        expect(position).not.toHaveProperty('liquidityMinted');
        expect(position).not.toHaveProperty('active');
        expect(position).not.toHaveProperty('createdAt');
        expect(position).not.toHaveProperty('lastUpdated');
      }, 60000);

      it('should handle empty positions (address with no positions)', async () => {
        const randomAddress = '0x0000000000000000000000000000000000000001';
        const result = await adapter.getPositionsForDisplay(randomAddress, env.provider);
        expect(result.positions).toEqual({});
      }, 30000);
    });

    describe('Value Consistency', () => {
      it('should match values against existing adapter method outputs', async () => {
        const result = await adapter.getPositionsForDisplay(testVault.address, env.provider);
        const position = Object.values(result.positions)[0];

        // Fetch same data via existing methods for comparison
        const poolData = await adapter.getPoolData(position.pool, env.provider);
        const token0Config = { address: poolData.tokenX, symbol: position.tokenPair.split('/')[0], decimals: position.tokenPair.split('/')[0] === 'WAVAX' ? 18 : 6 };
        const token1Config = { address: poolData.tokenY, symbol: position.tokenPair.split('/')[1], decimals: position.tokenPair.split('/')[1] === 'USDC' ? 6 : 18 };

        // currentPrice should match _binIdToPrice for activeId
        const expectedCurrentPrice = adapter._binIdToPrice(
          poolData.activeId, poolData.binStep, token0Config.decimals, token1Config.decimals
        );
        expect(position.currentPrice).toBeCloseTo(expectedCurrentPrice, 6);

        // priceLower/priceUpper should match _binIdToPrice for bin bounds
        const expectedPriceLower = adapter._binIdToPrice(
          position.platformData.lowerBinId, poolData.binStep, token0Config.decimals, token1Config.decimals
        );
        const expectedPriceUpper = adapter._binIdToPrice(
          position.platformData.upperBinId, poolData.binStep, token0Config.decimals, token1Config.decimals
        );
        expect(position.priceLower).toBeCloseTo(expectedPriceLower, 6);
        expect(position.priceUpper).toBeCloseTo(expectedPriceUpper, 6);

        // inRange should match activeId vs bin bounds
        const expectedInRange = poolData.activeId >= position.platformData.lowerBinId &&
                                poolData.activeId <= position.platformData.upperBinId;
        expect(position.inRange).toBe(expectedInRange);

        // token amounts should match calculateTokenAmounts
        const positionForCalc = {
          pool: position.pool,
          depositIds: position.platformData.depositIds,
          liquidityMinted: (() => {
            // Fetch from position manager to get liquidityMinted
            // We can't easily get this from display data, so verify amounts are non-negative
            return null;
          })(),
        };
        // Since liquidityMinted is not in platformData (opaque), verify amounts are reasonable
        expect(position.token0Amount).toBeGreaterThanOrEqual(0);
        expect(position.token1Amount).toBeGreaterThanOrEqual(0);
      }, 60000);

      it('should have tokenPair symbols matching token lookups', async () => {
        const result = await adapter.getPositionsForDisplay(testVault.address, env.provider);
        const position = Object.values(result.positions)[0];

        // Get pool data and verify token symbols match
        const poolData = await adapter.getPoolData(position.pool, env.provider);
        const { getTokenByAddress: getToken } = await import('../../../src/helpers/tokenHelpers.js');
        const token0Info = getToken(poolData.tokenX, env.chainId);
        const token1Info = getToken(poolData.tokenY, env.chainId);

        expect(position.tokenPair).toBe(`${token0Info.symbol}/${token1Info.symbol}`);
      }, 60000);

      it('should have token amounts matching calculateTokenAmounts output', async () => {
        const result = await adapter.getPositionsForDisplay(testVault.address, env.provider);
        const position = Object.values(result.positions)[0];

        // Fetch position data from position manager for liquidityMinted
        const pmAddress = adapter.addresses.positionManagerAddress;
        const tjpm = new ethers.Contract(pmAddress, contractData.TJPositionManager.abi, env.provider);
        const positionIds = await tjpm.getPositionsByVault(testVault.address);

        // Find the matching position
        let matchingPosData;
        for (const pid of positionIds) {
          if (String(pid) === position.id) {
            matchingPosData = await tjpm.getPosition(pid);
            break;
          }
        }

        const poolData = await adapter.getPoolData(position.pool, env.provider);
        const { getTokenByAddress: getToken } = await import('../../../src/helpers/tokenHelpers.js');
        const token0Data = getToken(poolData.tokenX, env.chainId);
        const token1Data = getToken(poolData.tokenY, env.chainId);

        const positionForCalc = {
          pool: position.pool,
          depositIds: matchingPosData.depositIds.map(id => Number(id)),
          liquidityMinted: matchingPosData.liquidityMinted.map(lm => lm.toString()),
        };

        const [raw0, raw1] = await adapter.calculateTokenAmounts(
          positionForCalc, poolData, token0Data, token1Data, env.provider
        );
        const expectedToken0 = Number(raw0) / Math.pow(10, token0Data.decimals);
        const expectedToken1 = Number(raw1) / Math.pow(10, token1Data.decimals);

        expect(position.token0Amount).toBe(expectedToken0);
        expect(position.token1Amount).toBe(expectedToken1);
      }, 60000);
    });

    describe('Error Cases', () => {
      it('should throw if address is null/undefined/empty', async () => {
        await expect(
          adapter.getPositionsForDisplay(null, env.provider)
        ).rejects.toThrow('Address parameter is required');

        await expect(
          adapter.getPositionsForDisplay(undefined, env.provider)
        ).rejects.toThrow('Address parameter is required');

        await expect(
          adapter.getPositionsForDisplay('', env.provider)
        ).rejects.toThrow('Address parameter is required');
      });

      it('should throw if address is invalid', async () => {
        await expect(
          adapter.getPositionsForDisplay('invalid-address', env.provider)
        ).rejects.toThrow('Invalid address: invalid-address');

        await expect(
          adapter.getPositionsForDisplay('0x123', env.provider)
        ).rejects.toThrow('Invalid address: 0x123');
      });

      it('should throw if provider is null/undefined/invalid', async () => {
        const validAddress = testVault.address;

        await expect(
          adapter.getPositionsForDisplay(validAddress, null)
        ).rejects.toThrow('Valid provider parameter is required');

        await expect(
          adapter.getPositionsForDisplay(validAddress, undefined)
        ).rejects.toThrow('Valid provider parameter is required');

        await expect(
          adapter.getPositionsForDisplay(validAddress, {})
        ).rejects.toThrow('Valid provider parameter is required');
      });
    });
  });

  describe('getPositionById', () => {
    let positionId;
    let expectedPoolAddress;

    beforeAll(async () => {
      // Create a position using the vault from the top-level beforeAll
      const pmAddress = adapter.addresses.positionManagerAddress;
      const tjpmAbi = contractData.TJPositionManager.abi;
      const tjpm = new ethers.Contract(pmAddress, tjpmAbi, env.provider);

      // Check if a position already exists from the E2E test
      const positionIds = await tjpm.getPositionsByVault(testVault.address);
      if (positionIds.length > 0) {
        positionId = positionIds[0];
        const pos = await tjpm.getPosition(positionId);
        expectedPoolAddress = pos.lbPair.toLowerCase();
        return;
      }

      // If no position exists, create one
      let poolData, positionRange;
      try {
        const poolResult = await adapter.selectBestPool('WAVAX', 'USDC', env.provider, env.chainId);
        poolData = await adapter.getPoolData(poolResult.bestPool.address, env.provider);
        positionRange = adapter.getPositionRange(poolData, 1, 1);
      } catch (error) {
        if (error.message.includes('No pools found') || error.message.includes('No active pools')) {
          console.log('No Trader Joe V2.2 WAVAX/USDC pools - cannot create position for getPositionById tests');
          return;
        }
        throw error;
      }

      expectedPoolAddress = poolData.address.toLowerCase();

      // Approve tokens
      const approvalTxs = await adapter.getRequiredApprovals(
        'liquidity', testVault.address, [wavaxAddress, usdcAddress], env.provider
      );
      if (approvalTxs.length > 0) {
        const targets = approvalTxs.map(t => t.to);
        const data = approvalTxs.map(t => t.data);
        await (await testVault.approve(targets, data)).wait();
      }

      // Use 10% of vault balances
      const vaultWavaxBal = await wavax.balanceOf(testVault.address);
      const vaultUsdcBal = await usdc.balanceOf(testVault.address);
      const wavaxAmount = vaultWavaxBal.div(10);
      const usdcAmount = vaultUsdcBal.div(10);

      const txData = await adapter.generateCreatePositionData({
        position: positionRange,
        token0Amount: wavaxAmount.toString(),
        token1Amount: usdcAmount.toString(),
        provider: env.provider,
        walletAddress: testVault.address,
        poolData,
        token0Data: { address: wavaxAddress, symbol: 'WAVAX', decimals: 18 },
        token1Data: { address: usdcAddress, symbol: 'USDC', decimals: 6 },
        slippageTolerance: 5,
        deadlineMinutes: 10,
      });

      // Workaround: Hardhat fork gas estimation bug (see removeE2E beforeAll)
      await testVault.estimateGas.mint([pmAddress], [txData.data], [0]);

      const mintTx = await testVault.mint([pmAddress], [txData.data], [0]);
      await mintTx.wait();

      const newPositionIds = await tjpm.getPositionsByVault(testVault.address);
      positionId = newPositionIds[newPositionIds.length - 1];
    }, 120000);

    describe('Success Cases', () => {
      it('should return { position, poolData } with correct top-level structure', async () => {
        if (!positionId) return; // skip if no position was created
        const result = await adapter.getPositionById(positionId, env.provider);

        expect(result).toHaveProperty('position');
        expect(result).toHaveProperty('poolData');
        expect(typeof result.position).toBe('object');
        expect(typeof result.poolData).toBe('object');
      }, 30000);

      it('should return position with exactly the expected fields', async () => {
        if (!positionId) return;
        const result = await adapter.getPositionById(positionId, env.provider);
        const pos = result.position;

        const expectedFields = [
          'id', 'pool', 'proxy', 'lowerBinId', 'upperBinId',
          'depositIds', 'liquidityMinted', 'active', 'createdAt', 'lastUpdated'
        ];
        expect(Object.keys(pos).sort()).toEqual(expectedFields.sort());
      }, 30000);

      it('should return correct field types', async () => {
        if (!positionId) return;
        const result = await adapter.getPositionById(positionId, env.provider);
        const pos = result.position;

        expect(typeof pos.id).toBe('string');
        expect(typeof pos.pool).toBe('string');
        expect(typeof pos.proxy).toBe('string');
        expect(typeof pos.lowerBinId).toBe('number');
        expect(typeof pos.upperBinId).toBe('number');
        expect(Array.isArray(pos.depositIds)).toBe(true);
        expect(Array.isArray(pos.liquidityMinted)).toBe(true);
        expect(typeof pos.active).toBe('boolean');
        expect(typeof pos.createdAt).toBe('number');
        expect(typeof pos.lastUpdated).toBe('number');

        // depositIds should be numbers, liquidityMinted should be strings
        pos.depositIds.forEach(id => expect(typeof id).toBe('number'));
        pos.liquidityMinted.forEach(lm => expect(typeof lm).toBe('string'));
      }, 30000);

      it('should return poolData keyed by pool address with correct fields', async () => {
        if (!positionId) return;
        const result = await adapter.getPositionById(positionId, env.provider);
        const pos = result.position;
        const pool = result.poolData[pos.pool];

        expect(pool).toBeDefined();
        expect(typeof pool.token0Symbol).toBe('string');
        expect(typeof pool.token1Symbol).toBe('string');
        expect(typeof pool.binStep).toBe('number');
        expect(pool.platform).toBe('traderjoeV2_2');
      }, 30000);

      it('should return pool address matching expected LBPair', async () => {
        if (!positionId || !expectedPoolAddress) return;
        const result = await adapter.getPositionById(positionId, env.provider);

        expect(result.position.pool).toBe(expectedPoolAddress);
      }, 30000);

      it('should return active position with non-empty depositIds and parallel liquidityMinted', async () => {
        if (!positionId) return;
        const result = await adapter.getPositionById(positionId, env.provider);
        const pos = result.position;

        expect(pos.active).toBe(true);
        expect(pos.depositIds.length).toBeGreaterThan(0);
        expect(pos.liquidityMinted.length).toBe(pos.depositIds.length);
      }, 30000);

      it('should return position compatible with evaluatePositionRange (no throw)', async () => {
        if (!positionId) return;
        const result = await adapter.getPositionById(positionId, env.provider);
        const pos = result.position;

        // evaluatePositionRange needs lowerBinId, upperBinId, pool
        // Use swapData mode to avoid extra RPC call
        const midBin = Math.floor((pos.lowerBinId + pos.upperBinId) / 2);
        const rangeResult = await adapter.evaluatePositionRange(pos, env.provider, {
          swapData: { activeId: midBin }
        });

        expect(rangeResult).toHaveProperty('inRange');
        expect(rangeResult.inRange).toBe(true);
      }, 30000);

      it('should return position compatible with extractPositionBounds', async () => {
        if (!positionId) return;
        const result = await adapter.getPositionById(positionId, env.provider);
        const pos = result.position;

        const bounds = adapter.extractPositionBounds(pos);

        expect(bounds.lower).toBe(pos.lowerBinId);
        expect(bounds.upper).toBe(pos.upperBinId);
      }, 30000);

      it('should handle both string and numeric tokenId', async () => {
        if (!positionId) return;

        const numericId = typeof positionId === 'string' ? Number(positionId) : positionId;
        const stringId = String(positionId);

        const resultFromNumber = await adapter.getPositionById(numericId, env.provider);
        const resultFromString = await adapter.getPositionById(stringId, env.provider);

        expect(resultFromNumber.position.id).toBe(String(numericId));
        expect(resultFromString.position.id).toBe(stringId);
        expect(resultFromNumber.position.pool).toBe(resultFromString.position.pool);
        expect(resultFromNumber.position.lowerBinId).toBe(resultFromString.position.lowerBinId);
        expect(resultFromNumber.position.upperBinId).toBe(resultFromString.position.upperBinId);
      }, 30000);
    });

    describe('Error Cases', () => {
      it('should throw for null tokenId', async () => {
        await expect(adapter.getPositionById(null, env.provider))
          .rejects.toThrow('TokenId parameter is required');
      });

      it('should throw for undefined tokenId', async () => {
        await expect(adapter.getPositionById(undefined, env.provider))
          .rejects.toThrow('TokenId parameter is required');
      });

      it('should throw for empty string tokenId', async () => {
        await expect(adapter.getPositionById('', env.provider))
          .rejects.toThrow('TokenId parameter is required');
      });

      it('should throw for null provider', async () => {
        await expect(adapter.getPositionById(1, null))
          .rejects.toThrow('Valid provider parameter is required');
      });

      it('should throw for undefined provider', async () => {
        await expect(adapter.getPositionById(1, undefined))
          .rejects.toThrow('Valid provider parameter is required');
      });

      it('should throw for invalid provider (missing getNetwork)', async () => {
        await expect(adapter.getPositionById(1, { notAProvider: true }))
          .rejects.toThrow('Valid provider parameter is required');
      });

      it('should throw for non-existent tokenId', async () => {
        // Use a very large ID that doesn't exist
        await expect(adapter.getPositionById(999999999, env.provider))
          .rejects.toThrow();
      }, 30000);
    });
  });

  describe('getAccruedFeesUSD', () => {
    describe('Error Cases', () => {
      it('should throw when position is null', async () => {
        await expect(adapter.getAccruedFeesUSD(null, { token0: 1, token1: 1 }, env.provider))
          .rejects.toThrow('position is required and must be an object');
      });

      it('should throw when position is undefined', async () => {
        await expect(adapter.getAccruedFeesUSD(undefined, { token0: 1, token1: 1 }, env.provider))
          .rejects.toThrow('position is required and must be an object');
      });

      it('should throw when position is a string', async () => {
        await expect(adapter.getAccruedFeesUSD('invalid', { token0: 1, token1: 1 }, env.provider))
          .rejects.toThrow('position is required and must be an object');
      });

      it('should throw when position.id is undefined', async () => {
        await expect(adapter.getAccruedFeesUSD({}, { token0: 1, token1: 1 }, env.provider))
          .rejects.toThrow('position.id is required');
      });

      it('should throw when position.id is null', async () => {
        await expect(adapter.getAccruedFeesUSD({ id: null }, { token0: 1, token1: 1 }, env.provider))
          .rejects.toThrow('position.id is required');
      });

      it('should throw when tokenPrices is null', async () => {
        await expect(adapter.getAccruedFeesUSD({ id: '1' }, null, env.provider))
          .rejects.toThrow('tokenPrices is required and must be an object');
      });

      it('should throw when tokenPrices is a string', async () => {
        await expect(adapter.getAccruedFeesUSD({ id: '1' }, 'invalid', env.provider))
          .rejects.toThrow('tokenPrices is required and must be an object');
      });

      it('should throw when tokenPrices.token0 is not a number', async () => {
        await expect(adapter.getAccruedFeesUSD({ id: '1' }, { token0: '1', token1: 1 }, env.provider))
          .rejects.toThrow('tokenPrices must have token0 and token1 as numbers');
      });

      it('should throw when tokenPrices.token1 is missing', async () => {
        await expect(adapter.getAccruedFeesUSD({ id: '1' }, { token0: 1 }, env.provider))
          .rejects.toThrow('tokenPrices must have token0 and token1 as numbers');
      });

      it('should throw when tokenPrices is empty object', async () => {
        await expect(adapter.getAccruedFeesUSD({ id: '1' }, {}, env.provider))
          .rejects.toThrow('tokenPrices must have token0 and token1 as numbers');
      });

      it('should throw when provider is null', async () => {
        await expect(adapter.getAccruedFeesUSD({ id: '1' }, { token0: 1, token1: 1 }, null))
          .rejects.toThrow('provider is required');
      });

      it('should throw when provider is undefined', async () => {
        await expect(adapter.getAccruedFeesUSD({ id: '1' }, { token0: 1, token1: 1 }, undefined))
          .rejects.toThrow('provider is required');
      });
    });

    describe('E2E Tests', () => {
      let positionId;

      beforeAll(async () => {
        // Reuse existing position or create one (same pattern as getPositionById tests)
        const pmAddress = adapter.addresses.positionManagerAddress;
        const tjpmAbi = contractData.TJPositionManager.abi;
        const tjpm = new ethers.Contract(pmAddress, tjpmAbi, env.provider);

        const positionIds = await tjpm.getPositionsByVault(testVault.address);
        if (positionIds.length > 0) {
          positionId = positionIds[0];
          return;
        }

        // If no position exists, create one
        let poolData, positionRange;
        try {
          const poolResult = await adapter.selectBestPool('WAVAX', 'USDC', env.provider, env.chainId);
          poolData = await adapter.getPoolData(poolResult.bestPool.address, env.provider);
          positionRange = adapter.getPositionRange(poolData, 1, 1);
        } catch (error) {
          if (error.message.includes('No pools found') || error.message.includes('No active pools')) {
            console.log('No TJ V2.2 WAVAX/USDC pools - cannot create position for getAccruedFeesUSD tests');
            return;
          }
          throw error;
        }

        const approvalTxs = await adapter.getRequiredApprovals(
          'liquidity', testVault.address, [wavaxAddress, usdcAddress], env.provider
        );
        if (approvalTxs.length > 0) {
          const targets = approvalTxs.map(t => t.to);
          const data = approvalTxs.map(t => t.data);
          await (await testVault.approve(targets, data)).wait();
        }

        const vaultWavaxBal = await wavax.balanceOf(testVault.address);
        const vaultUsdcBal = await usdc.balanceOf(testVault.address);
        const wavaxAmount = vaultWavaxBal.div(10);
        const usdcAmount = vaultUsdcBal.div(10);

        const txData = await adapter.generateCreatePositionData({
          position: positionRange,
          token0Amount: wavaxAmount.toString(),
          token1Amount: usdcAmount.toString(),
          provider: env.provider,
          walletAddress: testVault.address,
          poolData,
          token0Data: { address: wavaxAddress, symbol: 'WAVAX', decimals: 18 },
          token1Data: { address: usdcAddress, symbol: 'USDC', decimals: 6 },
          slippageTolerance: 5,
          deadlineMinutes: 10,
        });

        // Workaround: Hardhat fork gas estimation bug (see removeE2E beforeAll)
        await testVault.estimateGas.mint([pmAddress], [txData.data], [0]);

        const mintTx = await testVault.mint([pmAddress], [txData.data], [0]);
        await mintTx.wait();

        const newPositionIds = await tjpm.getPositionsByVault(testVault.address);
        positionId = newPositionIds[newPositionIds.length - 1];
      }, 120000);

      it('should return correct structure with all required fields', async () => {
        if (!positionId) return;

        const result = await adapter.getAccruedFeesUSD(
          { id: String(positionId) },
          { token0: 3000, token1: 1 },
          env.provider
        );

        expect(result).toHaveProperty('totalUSD');
        expect(result).toHaveProperty('token0Fees');
        expect(result).toHaveProperty('token1Fees');
        expect(result).toHaveProperty('token0USD');
        expect(result).toHaveProperty('token1USD');
        expect(result).toHaveProperty('fees0');
        expect(result).toHaveProperty('fees1');
      }, 30000);

      it('should return correct types for all fields', async () => {
        if (!positionId) return;

        const result = await adapter.getAccruedFeesUSD(
          { id: String(positionId) },
          { token0: 3000, token1: 1 },
          env.provider
        );

        expect(typeof result.totalUSD).toBe('number');
        expect(typeof result.token0Fees).toBe('number');
        expect(typeof result.token1Fees).toBe('number');
        expect(typeof result.token0USD).toBe('number');
        expect(typeof result.token1USD).toBe('number');
        expect(typeof result.fees0).toBe('string');
        expect(typeof result.fees1).toBe('string');
      }, 30000);

      it('should return non-negative values', async () => {
        if (!positionId) return;

        const result = await adapter.getAccruedFeesUSD(
          { id: String(positionId) },
          { token0: 3000, token1: 1 },
          env.provider
        );

        expect(result.totalUSD).toBeGreaterThanOrEqual(0);
        expect(result.token0Fees).toBeGreaterThanOrEqual(0);
        expect(result.token1Fees).toBeGreaterThanOrEqual(0);
        expect(result.token0USD).toBeGreaterThanOrEqual(0);
        expect(result.token1USD).toBeGreaterThanOrEqual(0);
      }, 30000);

      it('should correctly convert fees to USD using token prices', async () => {
        if (!positionId) return;

        const result = await adapter.getAccruedFeesUSD(
          { id: String(positionId) },
          { token0: 100, token1: 1 },
          env.provider
        );

        // Verify arithmetic consistency
        expect(result.token0USD).toBeCloseTo(result.token0Fees * 100, 10);
        expect(result.token1USD).toBeCloseTo(result.token1Fees * 1, 10);
        expect(result.totalUSD).toBeCloseTo(result.token0USD + result.token1USD, 10);
      }, 30000);

      it('should accept both string and numeric position.id', async () => {
        if (!positionId) return;

        const resultFromString = await adapter.getAccruedFeesUSD(
          { id: String(positionId) },
          { token0: 1, token1: 1 },
          env.provider
        );
        const resultFromNumber = await adapter.getAccruedFeesUSD(
          { id: Number(positionId) },
          { token0: 1, token1: 1 },
          env.provider
        );

        expect(resultFromString.totalUSD).toBe(resultFromNumber.totalUSD);
        expect(resultFromString.fees0).toBe(resultFromNumber.fees0);
        expect(resultFromString.fees1).toBe(resultFromNumber.fees1);
      }, 30000);

      it('should return exactly 8 fields', async () => {
        if (!positionId) return;

        const result = await adapter.getAccruedFeesUSD(
          { id: String(positionId) },
          { token0: 1, token1: 1 },
          env.provider
        );

        const expectedKeys = ['totalUSD', 'token0Fees', 'token1Fees', 'token0USD', 'token1USD', 'fees0', 'fees1', 'feeShares'];
        expect(Object.keys(result).sort()).toEqual(expectedKeys.sort());
        expect(Array.isArray(result.feeShares)).toBe(true);
      }, 30000);
    });
  });

  describe('getRequiredApprovals', () => {
    describe('Input Validation', () => {
      it('should throw if operationType is invalid', async () => {
        await expect(adapter.getRequiredApprovals('invalid', '0x0000000000000000000000000000000000000001', ['0x0000000000000000000000000000000000000002'], env.provider))
          .rejects.toThrow('operationType must be "swap" or "liquidity"');
      });

      it('should throw if vaultAddress is invalid', async () => {
        await expect(adapter.getRequiredApprovals('liquidity', 'invalid', ['0x0000000000000000000000000000000000000002'], env.provider))
          .rejects.toThrow('invalid vaultAddress');
      });

      it('should throw if tokenAddresses is empty', async () => {
        await expect(adapter.getRequiredApprovals('liquidity', '0x0000000000000000000000000000000000000001', [], env.provider))
          .rejects.toThrow('tokenAddresses must be a non-empty array');
      });

      it('should throw if provider is null', async () => {
        await expect(adapter.getRequiredApprovals('liquidity', '0x0000000000000000000000000000000000000001', ['0x0000000000000000000000000000000000000002'], null))
          .rejects.toThrow('provider is required');
      });

      it('should throw if tokenAddresses contains invalid address', async () => {
        await expect(adapter.getRequiredApprovals('liquidity', '0x0000000000000000000000000000000000000001', ['not-an-address'], env.provider))
          .rejects.toThrow('invalid token address');
      });

      it('should throw if no spender address found (empty positionManagerAddress)', async () => {
        const testAdapter = new TraderJoeV2_2Adapter(env.chainId, env.provider);
        testAdapter.addresses.positionManagerAddress = '';
        await expect(testAdapter.getRequiredApprovals('liquidity', '0x0000000000000000000000000000000000000001', ['0x0000000000000000000000000000000000000002'], env.provider))
          .rejects.toThrow('no spender address found');
      });
    });

    describe('Success Cases', () => {
      it('should return approval transactions for tokens with no allowance', async () => {
        const pmAddress = adapter.addresses.positionManagerAddress;

        // Use real token addresses on Avalanche fork - they will have zero allowance
        // for a random vault address
        const vaultAddress = '0x0000000000000000000000000000000000000001';
        const tokenAddresses = [
          '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7', // WAVAX
          '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', // USDC
        ];

        const txs = await adapter.getRequiredApprovals('liquidity', vaultAddress, tokenAddresses, env.provider);

        // Should return 2 approval transactions (one per token)
        expect(txs.length).toBe(2);

        // Each tx should have the correct structure
        for (const tx of txs) {
          expect(tx).toHaveProperty('to');
          expect(tx).toHaveProperty('data');
          expect(tx).toHaveProperty('value');
          expect(tx.value).toBe('0');
        }

        // Verify the approval targets are the token addresses
        expect(txs[0].to).toBe(tokenAddresses[0]);
        expect(txs[1].to).toBe(tokenAddresses[1]);

        // Decode the first approval calldata to verify spender = positionManagerAddress
        const erc20Iface = new ethers.utils.Interface([
          "function approve(address spender, uint256 amount)"
        ]);
        const decoded = erc20Iface.decodeFunctionData('approve', txs[0].data);
        expect(decoded.spender.toLowerCase()).toBe(pmAddress.toLowerCase());
        expect(decoded.amount.eq(ethers.constants.MaxUint256)).toBe(true);
      }, 30000);

      it('should skip native AVAX (address zero)', async () => {
        const vaultAddress = '0x0000000000000000000000000000000000000001';
        const tokenAddresses = [
          ethers.constants.AddressZero, // Native AVAX - should be skipped
          '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7', // WAVAX
        ];

        const txs = await adapter.getRequiredApprovals('liquidity', vaultAddress, tokenAddresses, env.provider);

        // Only 1 tx (WAVAX), native AVAX skipped
        expect(txs.length).toBe(1);
        expect(txs[0].to).toBe('0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7');
      }, 30000);

      it('should use lbRouterAddress as spender for swap operations', async () => {
        const vaultAddress = '0x0000000000000000000000000000000000000001';
        const tokenAddresses = [
          '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7', // WAVAX
        ];

        const txs = await adapter.getRequiredApprovals('swap', vaultAddress, tokenAddresses, env.provider);

        expect(txs.length).toBe(1);

        // Decode to verify spender is lbRouterAddress (not positionManagerAddress)
        const erc20Iface = new ethers.utils.Interface([
          "function approve(address spender, uint256 amount)"
        ]);
        const decoded = erc20Iface.decodeFunctionData('approve', txs[0].data);
        expect(decoded.spender.toLowerCase()).toBe(adapter.addresses.lbRouterAddress.toLowerCase());
      }, 30000);
    });
  });

  describe('generateRemoveLiquidityData', () => {
    // ABI for decoding removePosition calldata (5-param with feeShares, no percentage)
    const removePositionIface = new ethers.utils.Interface([
      "function removePosition(uint256 positionId, uint256[] feeShares, uint256 amountXMin, uint256 amountYMin, uint256 deadline)"
    ]);

    // ABI for decoding decreaseLiquidity calldata (6-param with percentage and feeShares)
    const decreaseLiquidityIface = new ethers.utils.Interface([
      "function decreaseLiquidity(uint256 positionId, uint256 percentage, uint256[] feeShares, uint256 amountXMin, uint256 amountYMin, uint256 deadline)"
    ]);

    // Shared state for E2E tests — position created in nested beforeAll
    let e2ePositionId;
    let e2ePosition;
    let e2ePoolData;

    describe('Input Validation', () => {
      // Minimal valid params for validation tests (won't actually call provider)
      const validPosition = {
        id: '1',
        pool: '0x0000000000000000000000000000000000000099',
        depositIds: [8388608, 8388609, 8388610],
        liquidityMinted: ['1000000', '2000000', '3000000'],
        active: true,
      };

      const validParams = () => ({
        position: validPosition,
        percentage: 100,
        provider: env.provider,
        walletAddress: '0x0000000000000000000000000000000000000001',
        slippageTolerance: 5,
        deadlineMinutes: 10,
      });

      // --- Position validation ---
      it('should throw if position is null', async () => {
        await expect(adapter.generateRemoveLiquidityData({ ...validParams(), position: null }))
          .rejects.toThrow('Position parameter is required');
      });

      it('should throw if position is undefined', async () => {
        await expect(adapter.generateRemoveLiquidityData({ ...validParams(), position: undefined }))
          .rejects.toThrow('Position parameter is required');
      });

      it('should throw if position.id is missing', async () => {
        const { id, ...noId } = validPosition;
        await expect(adapter.generateRemoveLiquidityData({ ...validParams(), position: { ...noId, active: true } }))
          .rejects.toThrow('Position id is required');
      });

      it('should throw if position.id is non-numeric', async () => {
        await expect(adapter.generateRemoveLiquidityData({ ...validParams(), position: { ...validPosition, id: 'abc' } }))
          .rejects.toThrow('Position id must be numeric');
      });

      it('should throw if position.depositIds is missing', async () => {
        const { depositIds, ...noIds } = validPosition;
        await expect(adapter.generateRemoveLiquidityData({ ...validParams(), position: { ...noIds, active: true } }))
          .rejects.toThrow('Position depositIds must be a non-empty array');
      });

      it('should throw if position.depositIds is empty', async () => {
        await expect(adapter.generateRemoveLiquidityData({ ...validParams(), position: { ...validPosition, depositIds: [] } }))
          .rejects.toThrow('Position depositIds must be a non-empty array');
      });

      it('should throw if position.liquidityMinted is missing', async () => {
        const { liquidityMinted, ...noLM } = validPosition;
        await expect(adapter.generateRemoveLiquidityData({ ...validParams(), position: { ...noLM, active: true } }))
          .rejects.toThrow('Position liquidityMinted must be a non-empty array');
      });

      it('should throw if position.depositIds and liquidityMinted lengths mismatch', async () => {
        await expect(adapter.generateRemoveLiquidityData({
          ...validParams(),
          position: { ...validPosition, liquidityMinted: ['1000000', '2000000'] }
        })).rejects.toThrow('Position depositIds and liquidityMinted must have the same length');
      });

      it('should throw if position.active is not true', async () => {
        await expect(adapter.generateRemoveLiquidityData({
          ...validParams(),
          position: { ...validPosition, active: false }
        })).rejects.toThrow('Position must be active');
      });

      // --- Percentage validation ---
      it('should throw if percentage is null', async () => {
        await expect(adapter.generateRemoveLiquidityData({ ...validParams(), percentage: null }))
          .rejects.toThrow('Percentage is required');
      });

      it('should throw if percentage is undefined', async () => {
        await expect(adapter.generateRemoveLiquidityData({ ...validParams(), percentage: undefined }))
          .rejects.toThrow('Percentage is required');
      });

      it('should throw if percentage is not finite', async () => {
        await expect(adapter.generateRemoveLiquidityData({ ...validParams(), percentage: Infinity }))
          .rejects.toThrow('Percentage must be a finite number');
      });

      it('should throw if percentage is 0', async () => {
        await expect(adapter.generateRemoveLiquidityData({ ...validParams(), percentage: 0 }))
          .rejects.toThrow('Percentage must be between 1 and 100');
      });

      it('should throw if percentage is 101', async () => {
        await expect(adapter.generateRemoveLiquidityData({ ...validParams(), percentage: 101 }))
          .rejects.toThrow('Percentage must be between 1 and 100');
      });

      it('should throw if percentage is -1', async () => {
        await expect(adapter.generateRemoveLiquidityData({ ...validParams(), percentage: -1 }))
          .rejects.toThrow('Percentage must be between 1 and 100');
      });

      it('should throw if percentage is not an integer', async () => {
        await expect(adapter.generateRemoveLiquidityData({ ...validParams(), percentage: 50.5 }))
          .rejects.toThrow('Percentage must be an integer');
      });

      // --- Slippage validation ---
      it('should throw if slippageTolerance is null', async () => {
        await expect(adapter.generateRemoveLiquidityData({ ...validParams(), slippageTolerance: null }))
          .rejects.toThrow('Slippage tolerance is required');
      });

      it('should throw if slippageTolerance is not finite', async () => {
        await expect(adapter.generateRemoveLiquidityData({ ...validParams(), slippageTolerance: NaN }))
          .rejects.toThrow('Slippage tolerance must be a finite number');
      });

      // --- Deadline validation ---
      it('should throw if deadlineMinutes is null', async () => {
        await expect(adapter.generateRemoveLiquidityData({ ...validParams(), deadlineMinutes: null }))
          .rejects.toThrow('Deadline minutes is required');
      });

      it('should throw if deadlineMinutes is 0', async () => {
        await expect(adapter.generateRemoveLiquidityData({ ...validParams(), deadlineMinutes: 0 }))
          .rejects.toThrow('Deadline minutes must be greater than 0');
      });

      // --- Position manager address ---
      it('should throw if positionManagerAddress is not configured', async () => {
        const adapterNoPM = new TraderJoeV2_2Adapter(env.chainId, env.provider);
        adapterNoPM.addresses.positionManagerAddress = '';
        await expect(adapterNoPM.generateRemoveLiquidityData(validParams()))
          .rejects.toThrow('No position manager address found');
      });
    });

    describe('Calldata Encoding', () => {
      // These tests use real on-chain data from the position created in the top-level beforeAll
      let onChainPosition;
      let positionManagerAddress;

      beforeAll(async () => {
        positionManagerAddress = adapter.addresses.positionManagerAddress;
        const tjpmAbi = contractData.TJPositionManager.abi;
        const tjpm = new ethers.Contract(positionManagerAddress, tjpmAbi, env.provider);

        // Use position from top-level E2E test (or create one)
        const positionIds = await tjpm.getPositionsByVault(testVault.address);
        if (positionIds.length === 0) {
          console.log('No position available for calldata encoding tests - skipping');
          return;
        }

        const posId = positionIds[0];
        const result = await adapter.getPositionById(posId, env.provider);
        onChainPosition = result.position;
      }, 60000);

      it('should return { to, data, value, quote } with correct structure', async () => {
        if (!onChainPosition) return;
        const result = await adapter.generateRemoveLiquidityData({
          position: onChainPosition,
          percentage: 100,
          provider: env.provider,
          walletAddress: testVault.address,
          slippageTolerance: 5,
          deadlineMinutes: 10,
        });

        expect(result).toHaveProperty('to');
        expect(result).toHaveProperty('data');
        expect(result).toHaveProperty('value');
        expect(result).toHaveProperty('quote');
      }, 30000);

      it('should set to = positionManagerAddress', async () => {
        if (!onChainPosition) return;
        const result = await adapter.generateRemoveLiquidityData({
          position: onChainPosition,
          percentage: 100,
          provider: env.provider,
          walletAddress: testVault.address,
          slippageTolerance: 5,
          deadlineMinutes: 10,
        });

        expect(result.to).toBe(positionManagerAddress);
      }, 30000);

      it('should set value = 0x00', async () => {
        if (!onChainPosition) return;
        const result = await adapter.generateRemoveLiquidityData({
          position: onChainPosition,
          percentage: 100,
          provider: env.provider,
          walletAddress: testVault.address,
          slippageTolerance: 5,
          deadlineMinutes: 10,
        });

        expect(result.value).toBe('0x00');
      }, 30000);

      it('should encode removePosition (no percentage) for 100% removal', async () => {
        if (!onChainPosition) return;
        const result = await adapter.generateRemoveLiquidityData({
          position: onChainPosition,
          percentage: 100,
          provider: env.provider,
          walletAddress: testVault.address,
          slippageTolerance: 5,
          deadlineMinutes: 10,
        });

        const decoded = removePositionIface.decodeFunctionData('removePosition', result.data);
        expect(decoded.positionId.toString()).toBe(onChainPosition.id);
        expect(Array.isArray(decoded.feeShares)).toBe(true);
        expect(decoded.deadline.toNumber()).toBeGreaterThan(Math.floor(Date.now() / 1000));
      }, 30000);

      it('should encode decreaseLiquidity (with percentage) for partial removal', async () => {
        if (!onChainPosition) return;
        const result = await adapter.generateRemoveLiquidityData({
          position: onChainPosition,
          percentage: 50,
          provider: env.provider,
          walletAddress: testVault.address,
          slippageTolerance: 5,
          deadlineMinutes: 10,
        });

        const decoded = decreaseLiquidityIface.decodeFunctionData('decreaseLiquidity', result.data);
        expect(decoded.positionId.toString()).toBe(onChainPosition.id);
        expect(decoded.percentage.toNumber()).toBe(50);
        expect(Array.isArray(decoded.feeShares)).toBe(true);
        expect(decoded.deadline.toNumber()).toBeGreaterThan(Math.floor(Date.now() / 1000));
      }, 30000);

      it('should have non-zero amountXMin and amountYMin in calldata', async () => {
        if (!onChainPosition) return;
        const result = await adapter.generateRemoveLiquidityData({
          position: onChainPosition,
          percentage: 100,
          provider: env.provider,
          walletAddress: testVault.address,
          slippageTolerance: 5,
          deadlineMinutes: 10,
        });

        const decoded = removePositionIface.decodeFunctionData('removePosition', result.data);
        // At least one should be non-zero (position has value in at least one token)
        const xMin = BigInt(decoded.amountXMin.toString());
        const yMin = BigInt(decoded.amountYMin.toString());
        expect(xMin + yMin).toBeGreaterThan(0n);
      }, 30000);

      it('should decrease amountXMin/amountYMin as slippageTolerance increases', async () => {
        if (!onChainPosition) return;

        const resultLow = await adapter.generateRemoveLiquidityData({
          position: onChainPosition,
          percentage: 100,
          provider: env.provider,
          walletAddress: testVault.address,
          slippageTolerance: 1,
          deadlineMinutes: 10,
        });
        const resultHigh = await adapter.generateRemoveLiquidityData({
          position: onChainPosition,
          percentage: 100,
          provider: env.provider,
          walletAddress: testVault.address,
          slippageTolerance: 10,
          deadlineMinutes: 10,
        });

        const lowXMin = BigInt(resultLow.quote.amountXMin);
        const highXMin = BigInt(resultHigh.quote.amountXMin);
        const lowYMin = BigInt(resultLow.quote.amountYMin);
        const highYMin = BigInt(resultHigh.quote.amountYMin);

        // Higher slippage means lower mins
        expect(lowXMin).toBeGreaterThanOrEqual(highXMin);
        expect(lowYMin).toBeGreaterThanOrEqual(highYMin);
      }, 30000);

      it('should return quote with all expected fields', async () => {
        if (!onChainPosition) return;
        const result = await adapter.generateRemoveLiquidityData({
          position: onChainPosition,
          percentage: 100,
          provider: env.provider,
          walletAddress: testVault.address,
          slippageTolerance: 5,
          deadlineMinutes: 10,
        });

        const q = result.quote;
        expect(q).toHaveProperty('positionId');
        expect(q).toHaveProperty('percentage');
        expect(q).toHaveProperty('amountX');
        expect(q).toHaveProperty('amountY');
        expect(q).toHaveProperty('amountXMin');
        expect(q).toHaveProperty('amountYMin');
        expect(q).toHaveProperty('feeShares');
        expect(q).toHaveProperty('deadline');
        expect(q).toHaveProperty('depositIds');
        expect(q).toHaveProperty('liquidityMinted');
        expect(q).toHaveProperty('amountsToRemove');

        expect(q.positionId).toBe(onChainPosition.id);
        expect(q.percentage).toBe(100);
        expect(Array.isArray(q.feeShares)).toBe(true);
        expect(Array.isArray(q.depositIds)).toBe(true);
        expect(Array.isArray(q.liquidityMinted)).toBe(true);
        expect(Array.isArray(q.amountsToRemove)).toBe(true);
      }, 30000);

      it('should scale amountsToRemove correctly for different percentages', async () => {
        if (!onChainPosition) return;

        const result50 = await adapter.generateRemoveLiquidityData({
          position: onChainPosition,
          percentage: 50,
          provider: env.provider,
          walletAddress: testVault.address,
          slippageTolerance: 5,
          deadlineMinutes: 10,
        });

        const result100 = await adapter.generateRemoveLiquidityData({
          position: onChainPosition,
          percentage: 100,
          provider: env.provider,
          walletAddress: testVault.address,
          slippageTolerance: 5,
          deadlineMinutes: 10,
        });

        // 50% amounts should be roughly half of 100% amounts
        for (let i = 0; i < result50.quote.amountsToRemove.length; i++) {
          const half = BigInt(result100.quote.amountsToRemove[i]) / 2n;
          const actual = BigInt(result50.quote.amountsToRemove[i]);
          // Allow rounding difference of 1
          expect(actual >= half - 1n && actual <= half + 1n).toBe(true);
        }
      }, 30000);

      it('should use different deadline values', async () => {
        if (!onChainPosition) return;

        const result5 = await adapter.generateRemoveLiquidityData({
          position: onChainPosition,
          percentage: 100,
          provider: env.provider,
          walletAddress: testVault.address,
          slippageTolerance: 5,
          deadlineMinutes: 5,
        });

        const result30 = await adapter.generateRemoveLiquidityData({
          position: onChainPosition,
          percentage: 100,
          provider: env.provider,
          walletAddress: testVault.address,
          slippageTolerance: 5,
          deadlineMinutes: 30,
        });

        // 30 min deadline should be later than 5 min deadline
        expect(result30.quote.deadline).toBeGreaterThan(result5.quote.deadline);
      }, 30000);
    });

    describe('E2E Tests', () => {
      // Create a fresh position for removal tests
      beforeAll(async () => {
        // Discover a real pool and create a position
        let poolData, positionRange;
        try {
          const poolResult = await adapter.selectBestPool('WAVAX', 'USDC', env.provider, env.chainId);
          poolData = await adapter.getPoolData(poolResult.bestPool.address, env.provider);
          positionRange = adapter.getPositionRange(poolData, 1, 1);
          e2ePoolData = poolData;
        } catch (error) {
          if (error.message.includes('No pools found') || error.message.includes('No active pools')) {
            console.log('No Trader Joe V2.2 WAVAX/USDC pools - skipping removal E2E tests');
            return;
          }
          throw error;
        }

        const vaultAddress = testVault.address;
        const pmAddress = adapter.addresses.positionManagerAddress;

        // Approve tokens if needed
        const approvalTxs = await adapter.getRequiredApprovals(
          'liquidity', vaultAddress, [wavaxAddress, usdcAddress], env.provider
        );
        if (approvalTxs.length > 0) {
          const targets = approvalTxs.map(t => t.to);
          const data = approvalTxs.map(t => t.data);
          await (await testVault.approve(targets, data)).wait();
        }

        // Use 5% of vault balances to leave room for multiple tests
        const vaultWavaxBal = await wavax.balanceOf(vaultAddress);
        const vaultUsdcBal = await usdc.balanceOf(vaultAddress);
        const wavaxAmount = vaultWavaxBal.div(20);
        const usdcAmount = vaultUsdcBal.div(20);

        const txData = await adapter.generateCreatePositionData({
          position: positionRange,
          token0Amount: wavaxAmount.toString(),
          token1Amount: usdcAmount.toString(),
          provider: env.provider,
          walletAddress: vaultAddress,
          poolData,
          token0Data: { address: wavaxAddress, symbol: 'WAVAX', decimals: 18 },
          token1Data: { address: usdcAddress, symbol: 'USDC', decimals: 6 },
          slippageTolerance: 5,
          deadlineMinutes: 10,
        });

        // Workaround: Hardhat fork gas estimation bug — the second createPosition
        // via vault.mint() fails without this explicit estimateGas call. callStatic
        // passes (logic is correct), but ethers' internal estimateGas underestimates.
        // This call warms the fork's storage cache, making the subsequent tx succeed.
        await testVault.estimateGas.mint([pmAddress], [txData.data], [0]);

        const mintTx = await testVault.mint([pmAddress], [txData.data], [0]);
        await mintTx.wait();

        // Get the created position
        const tjpm = new ethers.Contract(pmAddress, contractData.TJPositionManager.abi, env.provider);
        const positionIds = await tjpm.getPositionsByVault(vaultAddress);
        e2ePositionId = positionIds[positionIds.length - 1];

        const result = await adapter.getPositionById(e2ePositionId, env.provider);
        e2ePosition = result.position;

        console.log(`  E2E removal position created: ID ${e2ePositionId}, bins: ${e2ePosition.depositIds.length}`);
      }, 180000);

      it('should execute full removal (100%): create -> remove -> verify inactive', async () => {
        if (!e2ePosition) return;

        const vaultAddress = testVault.address;
        const pmAddress = adapter.addresses.positionManagerAddress;

        // Record vault balances before removal
        const wavaxBalBefore = await wavax.balanceOf(vaultAddress);
        const usdcBalBefore = await usdc.balanceOf(vaultAddress);

        // Generate remove calldata
        const txData = await adapter.generateRemoveLiquidityData({
          position: e2ePosition,
          percentage: 100,
          provider: env.provider,
          walletAddress: vaultAddress,
          slippageTolerance: 50, // Wide slippage for fork stability
          deadlineMinutes: 10,
        });

        expect(txData.to).toBe(pmAddress);

        // Execute via vault.decreaseLiquidity()
        const removeTx = await testVault.decreaseLiquidity([pmAddress], [txData.data]);
        const receipt = await removeTx.wait();
        expect(receipt.status).toBe(1);

        // Verify position is now inactive
        const tjpm = new ethers.Contract(pmAddress, contractData.TJPositionManager.abi, env.provider);
        const pos = await tjpm.getPosition(e2ePositionId);
        expect(pos.active).toBe(false);

        // Verify vault received tokens back
        const wavaxBalAfter = await wavax.balanceOf(vaultAddress);
        const usdcBalAfter = await usdc.balanceOf(vaultAddress);
        const wavaxReceived = wavaxBalAfter.sub(wavaxBalBefore);
        const usdcReceived = usdcBalAfter.sub(usdcBalBefore);

        // At least one token should have been returned
        expect(wavaxReceived.gt(0) || usdcReceived.gt(0)).toBe(true);

        console.log(`  Full removal: received ${ethers.utils.formatEther(wavaxReceived)} WAVAX, ${ethers.utils.formatUnits(usdcReceived, 6)} USDC`);
      }, 120000);

      it('should execute partial removal (50%): create -> remove 50% -> verify still active', async () => {
        // Create a fresh position for partial removal
        const vaultAddress = testVault.address;
        const pmAddress = adapter.addresses.positionManagerAddress;

        if (!e2ePoolData) return;

        const positionRange = adapter.getPositionRange(e2ePoolData, 1, 1);

        // Use small amounts
        const vaultWavaxBal = await wavax.balanceOf(vaultAddress);
        const vaultUsdcBal = await usdc.balanceOf(vaultAddress);
        const wavaxAmount = vaultWavaxBal.div(20);
        const usdcAmount = vaultUsdcBal.div(20);

        const createData = await adapter.generateCreatePositionData({
          position: positionRange,
          token0Amount: wavaxAmount.toString(),
          token1Amount: usdcAmount.toString(),
          provider: env.provider,
          walletAddress: vaultAddress,
          poolData: e2ePoolData,
          token0Data: { address: wavaxAddress, symbol: 'WAVAX', decimals: 18 },
          token1Data: { address: usdcAddress, symbol: 'USDC', decimals: 6 },
          slippageTolerance: 5,
          deadlineMinutes: 10,
        });

        // Workaround: Hardhat fork gas estimation bug (see removeE2E beforeAll)
        await testVault.estimateGas.mint([pmAddress], [createData.data], [0]);

        await (await testVault.mint([pmAddress], [createData.data], [0])).wait();

        const tjpm = new ethers.Contract(pmAddress, contractData.TJPositionManager.abi, env.provider);
        const positionIds = await tjpm.getPositionsByVault(vaultAddress);
        const partialPosId = positionIds[positionIds.length - 1];

        // Fetch position via adapter
        const posResult = await adapter.getPositionById(partialPosId, env.provider);
        const partialPosition = posResult.position;

        // Record original liquidity
        const origLiquidity = partialPosition.liquidityMinted.map(lm => BigInt(lm));

        // Remove 50%
        const removeData = await adapter.generateRemoveLiquidityData({
          position: partialPosition,
          percentage: 50,
          provider: env.provider,
          walletAddress: vaultAddress,
          slippageTolerance: 50,
          deadlineMinutes: 10,
        });

        await (await testVault.decreaseLiquidity([pmAddress], [removeData.data])).wait();

        // Verify position is still active with reduced liquidity
        const posAfter = await tjpm.getPosition(partialPosId);
        expect(posAfter.active).toBe(true);

        // Liquidity should be reduced to ~50%
        for (let i = 0; i < posAfter.liquidityMinted.length; i++) {
          const remaining = posAfter.liquidityMinted[i].toBigInt();
          const expected = origLiquidity[i] / 2n;
          // Allow rounding tolerance of 1
          expect(remaining >= expected - 1n && remaining <= expected + 1n).toBe(true);
        }

        console.log(`  Partial removal (50%): position ${partialPosId} still active`);
      }, 180000);

      it('should execute via vault.decreaseLiquidity() with full validator chain', async () => {
        // This test verifies the entire validation chain works:
        // vault.decreaseLiquidity -> VaultFactory.validateDecreaseLiquidity -> TJPositionValidator.validateDecreaseLiquidity
        if (!e2ePoolData) return;

        const vaultAddress = testVault.address;
        const pmAddress = adapter.addresses.positionManagerAddress;

        // Create position
        const positionRange = adapter.getPositionRange(e2ePoolData, 1, 1);
        const vaultWavaxBal = await wavax.balanceOf(vaultAddress);
        const vaultUsdcBal = await usdc.balanceOf(vaultAddress);

        const createData = await adapter.generateCreatePositionData({
          position: positionRange,
          token0Amount: vaultWavaxBal.div(20).toString(),
          token1Amount: vaultUsdcBal.div(20).toString(),
          provider: env.provider,
          walletAddress: vaultAddress,
          poolData: e2ePoolData,
          token0Data: { address: wavaxAddress, symbol: 'WAVAX', decimals: 18 },
          token1Data: { address: usdcAddress, symbol: 'USDC', decimals: 6 },
          slippageTolerance: 5,
          deadlineMinutes: 10,
        });

        // Workaround: Hardhat fork gas estimation bug (see removeE2E beforeAll)
        await testVault.estimateGas.mint([pmAddress], [createData.data], [0]);

        await (await testVault.mint([pmAddress], [createData.data], [0])).wait();

        const tjpm = new ethers.Contract(pmAddress, contractData.TJPositionManager.abi, env.provider);
        const posIds = await tjpm.getPositionsByVault(vaultAddress);
        const posId = posIds[posIds.length - 1];
        const posResult = await adapter.getPositionById(posId, env.provider);

        // Generate remove calldata
        const removeData = await adapter.generateRemoveLiquidityData({
          position: posResult.position,
          percentage: 100,
          provider: env.provider,
          walletAddress: vaultAddress,
          slippageTolerance: 50,
          deadlineMinutes: 10,
        });

        // Execute via the proper vault interface — this exercises the full validation chain
        const removeTx = await testVault.decreaseLiquidity([pmAddress], [removeData.data]);
        const receipt = await removeTx.wait();

        expect(receipt.status).toBe(1);

        // Verify removal succeeded
        const posAfter = await tjpm.getPosition(posId);
        expect(posAfter.active).toBe(false);

        console.log(`  Validator chain E2E: position ${posId} removed via decreaseLiquidity()`);
      }, 180000);
    });
  });

  describe('getOptimalTokenRatio', () => {
    const getBaseParams = () => ({
      position: { lowerBinId: 8388500, upperBinId: 8388700 },
      poolData: { activeId: 8388608, binStep: 20, address: '0x0000000000000000000000000000000000000001' },
      token0Data: { address: wavaxAddress, decimals: 18, symbol: 'WAVAX' },
      token1Data: { address: usdcAddress, decimals: 6, symbol: 'USDC' },
      token0Price: 25.0,
      token1Price: 1.0,
      provider: env.provider
    });

    describe('Input Validation', () => {
      // --- Position validation ---
      it('should throw if position is null', async () => {
        await expect(adapter.getOptimalTokenRatio({ ...getBaseParams(), position: null }))
          .rejects.toThrow('position is required and must be an object');
      });

      it('should throw if position is undefined', async () => {
        await expect(adapter.getOptimalTokenRatio({ ...getBaseParams(), position: undefined }))
          .rejects.toThrow('position is required and must be an object');
      });

      it('should throw if position is not an object', async () => {
        await expect(adapter.getOptimalTokenRatio({ ...getBaseParams(), position: 'bad' }))
          .rejects.toThrow('position is required and must be an object');
      });

      it('should throw if position is an array', async () => {
        await expect(adapter.getOptimalTokenRatio({ ...getBaseParams(), position: [1, 2] }))
          .rejects.toThrow('position is required and must be an object');
      });

      it('should throw if position.lowerBinId is missing', async () => {
        const params = getBaseParams();
        params.position = { upperBinId: 8388700 };
        await expect(adapter.getOptimalTokenRatio(params))
          .rejects.toThrow('position.lowerBinId is required');
      });

      it('should throw if position.lowerBinId is NaN', async () => {
        const params = getBaseParams();
        params.position = { lowerBinId: NaN, upperBinId: 8388700 };
        await expect(adapter.getOptimalTokenRatio(params))
          .rejects.toThrow('position.lowerBinId must be a finite number');
      });

      it('should throw if position.lowerBinId is Infinity', async () => {
        const params = getBaseParams();
        params.position = { lowerBinId: Infinity, upperBinId: 8388700 };
        await expect(adapter.getOptimalTokenRatio(params))
          .rejects.toThrow('position.lowerBinId must be a finite number');
      });

      it('should throw if position.upperBinId is missing', async () => {
        const params = getBaseParams();
        params.position = { lowerBinId: 8388500 };
        await expect(adapter.getOptimalTokenRatio(params))
          .rejects.toThrow('position.upperBinId is required');
      });

      it('should throw if position.upperBinId is NaN', async () => {
        const params = getBaseParams();
        params.position = { lowerBinId: 8388500, upperBinId: NaN };
        await expect(adapter.getOptimalTokenRatio(params))
          .rejects.toThrow('position.upperBinId must be a finite number');
      });

      it('should throw if position.upperBinId is Infinity', async () => {
        const params = getBaseParams();
        params.position = { lowerBinId: 8388500, upperBinId: Infinity };
        await expect(adapter.getOptimalTokenRatio(params))
          .rejects.toThrow('position.upperBinId must be a finite number');
      });

      it('should throw if lowerBinId > upperBinId', async () => {
        const params = getBaseParams();
        params.position = { lowerBinId: 8388700, upperBinId: 8388500 };
        await expect(adapter.getOptimalTokenRatio(params))
          .rejects.toThrow('position.lowerBinId must be less than position.upperBinId');
      });

      it('should throw if lowerBinId === upperBinId', async () => {
        const params = getBaseParams();
        params.position = { lowerBinId: 8388600, upperBinId: 8388600 };
        await expect(adapter.getOptimalTokenRatio(params))
          .rejects.toThrow('position.lowerBinId must be less than position.upperBinId');
      });

      // --- Pool data validation ---
      it('should throw if poolData is null', async () => {
        await expect(adapter.getOptimalTokenRatio({ ...getBaseParams(), poolData: null }))
          .rejects.toThrow('poolData is required and must be an object');
      });

      it('should throw if poolData is missing', async () => {
        await expect(adapter.getOptimalTokenRatio({ ...getBaseParams(), poolData: undefined }))
          .rejects.toThrow('poolData is required and must be an object');
      });

      it('should throw if poolData.activeId is missing', async () => {
        const params = getBaseParams();
        params.poolData = { binStep: 20, address: '0x01' };
        await expect(adapter.getOptimalTokenRatio(params))
          .rejects.toThrow('poolData.activeId is required');
      });

      it('should throw if poolData.activeId is NaN', async () => {
        const params = getBaseParams();
        params.poolData = { activeId: NaN, binStep: 20, address: '0x01' };
        await expect(adapter.getOptimalTokenRatio(params))
          .rejects.toThrow('poolData.activeId must be a finite number');
      });

      it('should throw if poolData.binStep is missing', async () => {
        const params = getBaseParams();
        params.poolData = { activeId: 8388608, address: '0x01' };
        await expect(adapter.getOptimalTokenRatio(params))
          .rejects.toThrow('poolData.binStep is required');
      });

      it('should throw if poolData.binStep is zero', async () => {
        const params = getBaseParams();
        params.poolData = { activeId: 8388608, binStep: 0, address: '0x01' };
        await expect(adapter.getOptimalTokenRatio(params))
          .rejects.toThrow('poolData.binStep must be a positive finite number');
      });

      it('should throw if poolData.address is missing', async () => {
        const params = getBaseParams();
        params.poolData = { activeId: 8388608, binStep: 20 };
        await expect(adapter.getOptimalTokenRatio(params))
          .rejects.toThrow('poolData.address is required');
      });

      // --- Token data validation ---
      it('should throw if token0Data is null', async () => {
        await expect(adapter.getOptimalTokenRatio({ ...getBaseParams(), token0Data: null }))
          .rejects.toThrow('token0Data is required and must be an object');
      });

      it('should throw if token0Data is missing', async () => {
        await expect(adapter.getOptimalTokenRatio({ ...getBaseParams(), token0Data: undefined }))
          .rejects.toThrow('token0Data is required and must be an object');
      });

      it('should throw if token0Data.address is missing', async () => {
        const params = getBaseParams();
        params.token0Data = { decimals: 18, symbol: 'WAVAX' };
        await expect(adapter.getOptimalTokenRatio(params))
          .rejects.toThrow('token0Data.address is required');
      });

      it('should throw if token0Data.decimals is missing', async () => {
        const params = getBaseParams();
        params.token0Data = { address: wavaxAddress, symbol: 'WAVAX' };
        await expect(adapter.getOptimalTokenRatio(params))
          .rejects.toThrow('token0Data.decimals is required');
      });

      it('should throw if token1Data is null', async () => {
        await expect(adapter.getOptimalTokenRatio({ ...getBaseParams(), token1Data: null }))
          .rejects.toThrow('token1Data is required and must be an object');
      });

      it('should throw if token1Data is missing', async () => {
        await expect(adapter.getOptimalTokenRatio({ ...getBaseParams(), token1Data: undefined }))
          .rejects.toThrow('token1Data is required and must be an object');
      });

      it('should throw if token1Data.address is missing', async () => {
        const params = getBaseParams();
        params.token1Data = { decimals: 6, symbol: 'USDC' };
        await expect(adapter.getOptimalTokenRatio(params))
          .rejects.toThrow('token1Data.address is required');
      });

      it('should throw if token1Data.decimals is missing', async () => {
        const params = getBaseParams();
        params.token1Data = { address: usdcAddress, symbol: 'USDC' };
        await expect(adapter.getOptimalTokenRatio(params))
          .rejects.toThrow('token1Data.decimals is required');
      });

      // --- Price validation ---
      it('should throw if token0Price is missing', async () => {
        await expect(adapter.getOptimalTokenRatio({ ...getBaseParams(), token0Price: undefined }))
          .rejects.toThrow('token0Price must be a positive finite number');
      });

      it('should throw if token0Price is zero', async () => {
        await expect(adapter.getOptimalTokenRatio({ ...getBaseParams(), token0Price: 0 }))
          .rejects.toThrow('token0Price must be a positive finite number');
      });

      it('should throw if token0Price is negative', async () => {
        await expect(adapter.getOptimalTokenRatio({ ...getBaseParams(), token0Price: -5 }))
          .rejects.toThrow('token0Price must be a positive finite number');
      });

      it('should throw if token0Price is NaN', async () => {
        await expect(adapter.getOptimalTokenRatio({ ...getBaseParams(), token0Price: NaN }))
          .rejects.toThrow('token0Price must be a positive finite number');
      });

      it('should throw if token0Price is Infinity', async () => {
        await expect(adapter.getOptimalTokenRatio({ ...getBaseParams(), token0Price: Infinity }))
          .rejects.toThrow('token0Price must be a positive finite number');
      });

      it('should throw if token1Price is missing', async () => {
        await expect(adapter.getOptimalTokenRatio({ ...getBaseParams(), token1Price: undefined }))
          .rejects.toThrow('token1Price must be a positive finite number');
      });

      it('should throw if token1Price is zero', async () => {
        await expect(adapter.getOptimalTokenRatio({ ...getBaseParams(), token1Price: 0 }))
          .rejects.toThrow('token1Price must be a positive finite number');
      });

      it('should throw if token1Price is negative', async () => {
        await expect(adapter.getOptimalTokenRatio({ ...getBaseParams(), token1Price: -1 }))
          .rejects.toThrow('token1Price must be a positive finite number');
      });

      it('should throw if token1Price is NaN', async () => {
        await expect(adapter.getOptimalTokenRatio({ ...getBaseParams(), token1Price: NaN }))
          .rejects.toThrow('token1Price must be a positive finite number');
      });

      it('should throw if token1Price is Infinity', async () => {
        await expect(adapter.getOptimalTokenRatio({ ...getBaseParams(), token1Price: Infinity }))
          .rejects.toThrow('token1Price must be a positive finite number');
      });

      // --- Provider validation ---
      it('should throw if provider is missing', async () => {
        await expect(adapter.getOptimalTokenRatio({ ...getBaseParams(), provider: undefined }))
          .rejects.toThrow('provider is required');
      });
    });

    describe('E2E Tests', () => {
      let poolData;

      beforeAll(async () => {
        try {
          const poolResult = await adapter.selectBestPool('WAVAX', 'USDC', env.provider, env.chainId);
          poolData = await adapter.getPoolData(poolResult.bestPool.address, env.provider);
        } catch (error) {
          if (error.message.includes('No pools found') || error.message.includes('No active pools')) {
            console.log('No Trader Joe V2.2 WAVAX/USDC pools - skipping E2E tests');
            poolData = null;
          } else {
            throw error;
          }
        }
      });

      it('should return valid shares for an in-range position', async () => {
        if (!poolData) return;

        const positionRange = adapter.getPositionRange(poolData, 1, 1);

        const result = await adapter.getOptimalTokenRatio({
          position: positionRange,
          poolData,
          token0Data: { address: wavaxAddress, decimals: 18, symbol: 'WAVAX' },
          token1Data: { address: usdcAddress, decimals: 6, symbol: 'USDC' },
          token0Price: 25.0,
          token1Price: 1.0,
          provider: env.provider
        });

        // Shares must sum to 1.0
        expect(result.token0Share + result.token1Share).toBeCloseTo(1.0, 10);

        // Both shares must be > 0 and < 1 for an in-range position
        expect(result.token0Share).toBeGreaterThan(0);
        expect(result.token0Share).toBeLessThan(1);
        expect(result.token1Share).toBeGreaterThan(0);
        expect(result.token1Share).toBeLessThan(1);

        // Both shares must be finite numbers
        expect(Number.isFinite(result.token0Share)).toBe(true);
        expect(Number.isFinite(result.token1Share)).toBe(true);

        console.log(`  getOptimalTokenRatio in-range: token0Share=${result.token0Share.toFixed(4)}, token1Share=${result.token1Share.toFixed(4)}`);
      }, 60000);

      it('should return 100% tokenX share for position entirely above active bin', async () => {
        if (!poolData) return;

        // Position entirely above active bin → all tokenX (lower address)
        const lowerBinId = poolData.activeId + 10;
        const upperBinId = poolData.activeId + 50;

        const result = await adapter.getOptimalTokenRatio({
          position: { lowerBinId, upperBinId },
          poolData,
          token0Data: { address: wavaxAddress, decimals: 18, symbol: 'WAVAX' },
          token1Data: { address: usdcAddress, decimals: 6, symbol: 'USDC' },
          token0Price: 25.0,
          token1Price: 1.0,
          provider: env.provider
        });

        // Shares must sum to 1.0
        expect(result.token0Share + result.token1Share).toBeCloseTo(1.0, 10);

        // Determine which caller token maps to tokenX (lower address)
        const wavaxIsTokenX = wavaxAddress.toLowerCase() < usdcAddress.toLowerCase();
        if (wavaxIsTokenX) {
          expect(result.token0Share).toBe(1);
          expect(result.token1Share).toBe(0);
        } else {
          expect(result.token0Share).toBe(0);
          expect(result.token1Share).toBe(1);
        }
      }, 60000);

      it('should return 100% tokenY share for position entirely below active bin', async () => {
        if (!poolData) return;

        // Position entirely below active bin → all tokenY (higher address)
        const lowerBinId = poolData.activeId - 50;
        const upperBinId = poolData.activeId - 10;

        const result = await adapter.getOptimalTokenRatio({
          position: { lowerBinId, upperBinId },
          poolData,
          token0Data: { address: wavaxAddress, decimals: 18, symbol: 'WAVAX' },
          token1Data: { address: usdcAddress, decimals: 6, symbol: 'USDC' },
          token0Price: 25.0,
          token1Price: 1.0,
          provider: env.provider
        });

        // Shares must sum to 1.0
        expect(result.token0Share + result.token1Share).toBeCloseTo(1.0, 10);

        // Determine which caller token maps to tokenY (higher address)
        const wavaxIsTokenX = wavaxAddress.toLowerCase() < usdcAddress.toLowerCase();
        if (wavaxIsTokenX) {
          // tokenY = USDC = token1
          expect(result.token0Share).toBe(0);
          expect(result.token1Share).toBe(1);
        } else {
          // tokenY = WAVAX = token0
          expect(result.token0Share).toBe(1);
          expect(result.token1Share).toBe(0);
        }
      }, 60000);

      it('should return roughly balanced shares for a wide symmetric range', async () => {
        if (!poolData) return;

        // Use a wide symmetric range (±50%)
        const positionRange = adapter.getPositionRange(poolData, 50, 50);

        const result = await adapter.getOptimalTokenRatio({
          position: positionRange,
          poolData,
          token0Data: { address: wavaxAddress, decimals: 18, symbol: 'WAVAX' },
          token1Data: { address: usdcAddress, decimals: 6, symbol: 'USDC' },
          token0Price: 25.0,
          token1Price: 1.0,
          provider: env.provider
        });

        // Shares must sum to 1.0
        expect(result.token0Share + result.token1Share).toBeCloseTo(1.0, 10);

        // Wide symmetric range → both shares between 20% and 80%
        expect(result.token0Share).toBeGreaterThan(0.2);
        expect(result.token0Share).toBeLessThan(0.8);
        expect(result.token1Share).toBeGreaterThan(0.2);
        expect(result.token1Share).toBeLessThan(0.8);

        console.log(`  getOptimalTokenRatio symmetric: token0Share=${result.token0Share.toFixed(4)}, token1Share=${result.token1Share.toFixed(4)}`);
      }, 60000);

      it('should produce consistent results when token order is swapped', async () => {
        if (!poolData) return;

        const positionRange = adapter.getPositionRange(poolData, 1, 1);

        // Call with WAVAX as token0
        const resultA = await adapter.getOptimalTokenRatio({
          position: positionRange,
          poolData,
          token0Data: { address: wavaxAddress, decimals: 18, symbol: 'WAVAX' },
          token1Data: { address: usdcAddress, decimals: 6, symbol: 'USDC' },
          token0Price: 25.0,
          token1Price: 1.0,
          provider: env.provider
        });

        // Call with USDC as token0 (swapped)
        const resultB = await adapter.getOptimalTokenRatio({
          position: positionRange,
          poolData,
          token0Data: { address: usdcAddress, decimals: 6, symbol: 'USDC' },
          token1Data: { address: wavaxAddress, decimals: 18, symbol: 'WAVAX' },
          token0Price: 1.0,
          token1Price: 25.0,
          provider: env.provider
        });

        // resultA.token0Share (WAVAX) should match resultB.token1Share (WAVAX)
        expect(resultA.token0Share).toBeCloseTo(resultB.token1Share, 10);
        expect(resultA.token1Share).toBeCloseTo(resultB.token0Share, 10);
      }, 60000);
    });
  });

  describe('generateAddLiquidityData', () => {
    // Real Avalanche token addresses (same as createPosition tests)
    const WETH = {
      address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
      symbol: 'WETH',
      decimals: 18,
    };
    const USDC = {
      address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
      symbol: 'USDC',
      decimals: 6,
    };

    // ABI for decoding addToPosition calldata (13 params with previousFeesX/previousFeesY)
    const addToPositionIface = new ethers.utils.Interface([
      "function addToPosition(uint256 positionId, uint256[] previousFeesX, uint256[] previousFeesY, uint256 amountX, uint256 amountY, uint256 amountXMin, uint256 amountYMin, uint256 activeIdDesired, uint256 idSlippage, int256[] deltaIds, uint256[] distributionX, uint256[] distributionY, uint256 deadline)"
    ]);

    describe('Input Validation', () => {
      let adapterWithPM;

      beforeAll(() => {
        adapterWithPM = adapter;
      });

      const validParams = () => ({
        position: { id: '1', lowerBinId: 8388500, upperBinId: 8388700 },
        token0Amount: '1000000000000000000',
        token1Amount: '1000000000',
        provider: env.provider,
        poolData: { activeId: 8388608, binStep: 20, address: '0x0000000000000000000000000000000000000002' },
        token0Data: WETH,
        token1Data: USDC,
        slippageTolerance: 5,
        deadlineMinutes: 10,
      });

      // --- Position validation ---
      it('should throw if position is null', async () => {
        await expect(adapterWithPM.generateAddLiquidityData({ ...validParams(), position: null }))
          .rejects.toThrow('Position parameter is required');
      });

      it('should throw if position is undefined', async () => {
        await expect(adapterWithPM.generateAddLiquidityData({ ...validParams(), position: undefined }))
          .rejects.toThrow('Position parameter is required');
      });

      it('should throw if position is not an object', async () => {
        await expect(adapterWithPM.generateAddLiquidityData({ ...validParams(), position: 'str' }))
          .rejects.toThrow('Position must be an object');
      });

      it('should throw if position is an array', async () => {
        await expect(adapterWithPM.generateAddLiquidityData({ ...validParams(), position: [1, 2] }))
          .rejects.toThrow('Position must be an object');
      });

      it('should throw if position.id is missing', async () => {
        await expect(adapterWithPM.generateAddLiquidityData({ ...validParams(), position: { lowerBinId: 8388500, upperBinId: 8388700 } }))
          .rejects.toThrow('Position id is required');
      });

      it('should throw if position.id is non-numeric', async () => {
        await expect(adapterWithPM.generateAddLiquidityData({ ...validParams(), position: { id: 'abc', lowerBinId: 8388500, upperBinId: 8388700 } }))
          .rejects.toThrow('Position id must be numeric');
      });

      it('should throw if position.lowerBinId is missing', async () => {
        await expect(adapterWithPM.generateAddLiquidityData({ ...validParams(), position: { id: '1', upperBinId: 100 } }))
          .rejects.toThrow('Position lowerBinId is required');
      });

      it('should throw if position.upperBinId is missing', async () => {
        await expect(adapterWithPM.generateAddLiquidityData({ ...validParams(), position: { id: '1', lowerBinId: 100 } }))
          .rejects.toThrow('Position upperBinId is required');
      });

      it('should throw if lowerBinId >= upperBinId', async () => {
        await expect(adapterWithPM.generateAddLiquidityData({ ...validParams(), position: { id: '1', lowerBinId: 200, upperBinId: 100 } }))
          .rejects.toThrow('Position lowerBinId must be less than upperBinId');
      });

      // --- Token amount validation ---
      it('should throw if token0Amount is null', async () => {
        await expect(adapterWithPM.generateAddLiquidityData({ ...validParams(), token0Amount: null }))
          .rejects.toThrow('Token0 amount is required');
      });

      it('should throw if token0Amount is not a string', async () => {
        await expect(adapterWithPM.generateAddLiquidityData({ ...validParams(), token0Amount: 123 }))
          .rejects.toThrow('Token0 amount must be a string');
      });

      it('should throw if token0Amount is not numeric', async () => {
        await expect(adapterWithPM.generateAddLiquidityData({ ...validParams(), token0Amount: 'abc' }))
          .rejects.toThrow('Token0 amount must be a positive numeric string');
      });

      it('should throw if both amounts are zero', async () => {
        await expect(adapterWithPM.generateAddLiquidityData({ ...validParams(), token0Amount: '0', token1Amount: '0' }))
          .rejects.toThrow('At least one token amount must be greater than 0');
      });

      // --- Provider validation ---
      it('should throw if provider is missing', async () => {
        await expect(adapterWithPM.generateAddLiquidityData({ ...validParams(), provider: null }))
          .rejects.toThrow('Provider is required');
      });

      // --- Pool data validation ---
      it('should throw if poolData is null', async () => {
        await expect(adapterWithPM.generateAddLiquidityData({ ...validParams(), poolData: null }))
          .rejects.toThrow('Pool data parameter is required');
      });

      it('should throw if poolData.activeId is missing', async () => {
        await expect(adapterWithPM.generateAddLiquidityData({ ...validParams(), poolData: { binStep: 20, address: '0x01' } }))
          .rejects.toThrow('Pool data activeId is required');
      });

      it('should throw if poolData.binStep is zero', async () => {
        await expect(adapterWithPM.generateAddLiquidityData({ ...validParams(), poolData: { activeId: 100, binStep: 0, address: '0x01' } }))
          .rejects.toThrow('Pool data binStep must be a positive finite number');
      });

      // --- Token data validation ---
      it('should throw if token0Data is null', async () => {
        await expect(adapterWithPM.generateAddLiquidityData({ ...validParams(), token0Data: null }))
          .rejects.toThrow('Token0 data parameter is required');
      });

      it('should throw if token1Data is null', async () => {
        await expect(adapterWithPM.generateAddLiquidityData({ ...validParams(), token1Data: null }))
          .rejects.toThrow('Token1 data parameter is required');
      });

      it('should throw if token0 and token1 have same address', async () => {
        await expect(adapterWithPM.generateAddLiquidityData({ ...validParams(), token1Data: WETH }))
          .rejects.toThrow('Token0 and token1 addresses cannot be the same');
      });

      // --- Slippage validation ---
      it('should throw if slippageTolerance is out of range', async () => {
        await expect(adapterWithPM.generateAddLiquidityData({ ...validParams(), slippageTolerance: 101 }))
          .rejects.toThrow('Slippage tolerance must be between 0 and 100');
      });

      // --- Deadline validation ---
      it('should throw if deadlineMinutes is zero', async () => {
        await expect(adapterWithPM.generateAddLiquidityData({ ...validParams(), deadlineMinutes: 0 }))
          .rejects.toThrow('Deadline minutes must be greater than 0');
      });

      // --- Position manager address ---
      it('should throw if positionManagerAddress is not configured', async () => {
        const adapterNoPM = new TraderJoeV2_2Adapter(env.chainId, env.provider);
        adapterNoPM.addresses.positionManagerAddress = '';
        await expect(adapterNoPM.generateAddLiquidityData(validParams()))
          .rejects.toThrow('No position manager address found');
      });
    });

    describe('E2E Tests', () => {
      let e2ePoolData;
      let e2ePositionId;
      let e2ePosition;

      beforeAll(async () => {
        // Discover a real pool and create a position
        let poolData, positionRange;
        try {
          const poolResult = await adapter.selectBestPool('WAVAX', 'USDC', env.provider, env.chainId);
          poolData = await adapter.getPoolData(poolResult.bestPool.address, env.provider);
          positionRange = adapter.getPositionRange(poolData, 1, 1);
          e2ePoolData = poolData;
        } catch (error) {
          if (error.message.includes('No pools found') || error.message.includes('No active pools')) {
            console.log('No Trader Joe V2.2 WAVAX/USDC pools - skipping addLiquidity E2E tests');
            return;
          }
          throw error;
        }

        const vaultAddress = testVault.address;
        const pmAddress = adapter.addresses.positionManagerAddress;

        // Approve tokens if needed
        const approvalTxs = await adapter.getRequiredApprovals(
          'liquidity', vaultAddress, [wavaxAddress, usdcAddress], env.provider
        );
        if (approvalTxs.length > 0) {
          const targets = approvalTxs.map(t => t.to);
          const data = approvalTxs.map(t => t.data);
          await (await testVault.approve(targets, data)).wait();
        }

        // Use 5% of vault balances
        const vaultWavaxBal = await wavax.balanceOf(vaultAddress);
        const vaultUsdcBal = await usdc.balanceOf(vaultAddress);
        const wavaxAmount = vaultWavaxBal.div(20);
        const usdcAmount = vaultUsdcBal.div(20);

        const txData = await adapter.generateCreatePositionData({
          position: positionRange,
          token0Amount: wavaxAmount.toString(),
          token1Amount: usdcAmount.toString(),
          provider: env.provider,
          walletAddress: vaultAddress,
          poolData,
          token0Data: { address: wavaxAddress, symbol: 'WAVAX', decimals: 18 },
          token1Data: { address: usdcAddress, symbol: 'USDC', decimals: 6 },
          slippageTolerance: 5,
          deadlineMinutes: 10,
        });

        // Workaround: Hardhat fork gas estimation bug (see removeE2E beforeAll)
        await testVault.estimateGas.mint([pmAddress], [txData.data], [0]);

        const mintTx = await testVault.mint([pmAddress], [txData.data], [0]);
        await mintTx.wait();

        // Get the created position
        const tjpm = new ethers.Contract(pmAddress, contractData.TJPositionManager.abi, env.provider);
        const positionIds = await tjpm.getPositionsByVault(vaultAddress);
        e2ePositionId = positionIds[positionIds.length - 1];

        const result = await adapter.getPositionById(e2ePositionId, env.provider);
        e2ePosition = result.position;

        console.log(`  E2E addLiquidity position created: ID ${e2ePositionId}, bins: ${e2ePosition.depositIds.length}`);
      }, 180000);

      it('should add liquidity to existing position via vault.increaseLiquidity()', async () => {
        if (!e2ePosition || !e2ePoolData) return;

        const vaultAddress = testVault.address;
        const pmAddress = adapter.addresses.positionManagerAddress;

        // Record liquidity before
        const tjpm = new ethers.Contract(pmAddress, contractData.TJPositionManager.abi, env.provider);
        const posBefore = await tjpm.getPosition(e2ePositionId);
        const liquidityBefore = posBefore.liquidityMinted.map(lm => lm.toBigInt());

        // Use small amounts for adding
        const vaultWavaxBal = await wavax.balanceOf(vaultAddress);
        const vaultUsdcBal = await usdc.balanceOf(vaultAddress);
        const wavaxAmount = vaultWavaxBal.div(40);
        const usdcAmount = vaultUsdcBal.div(40);

        const addData = await adapter.generateAddLiquidityData({
          position: { id: e2ePositionId.toString(), lowerBinId: e2ePosition.lowerBinId, upperBinId: e2ePosition.upperBinId },
          token0Amount: wavaxAmount.toString(),
          token1Amount: usdcAmount.toString(),
          provider: env.provider,
          poolData: e2ePoolData,
          token0Data: { address: wavaxAddress, symbol: 'WAVAX', decimals: 18 },
          token1Data: { address: usdcAddress, symbol: 'USDC', decimals: 6 },
          slippageTolerance: 50, // Wide slippage for fork stability
          deadlineMinutes: 10,
        });

        expect(addData.to).toBe(pmAddress);

        // Execute via vault.increaseLiquidity()
        const addTx = await testVault.increaseLiquidity([pmAddress], [addData.data], [0]);
        const receipt = await addTx.wait();
        expect(receipt.status).toBe(1);

        // Verify position is still active with increased liquidity
        const posAfter = await tjpm.getPosition(e2ePositionId);
        expect(posAfter.active).toBe(true);

        // At least one bin should have more liquidity
        let anyIncreased = false;
        for (let i = 0; i < posAfter.liquidityMinted.length; i++) {
          if (posAfter.liquidityMinted[i].toBigInt() > liquidityBefore[i]) {
            anyIncreased = true;
            break;
          }
        }
        expect(anyIncreased).toBe(true);

        console.log(`  Add liquidity succeeded: position ${e2ePositionId} liquidity increased`);
      }, 120000);

      it('should execute full lifecycle: create → add → remove', async () => {
        if (!e2ePoolData) return;

        const vaultAddress = testVault.address;
        const pmAddress = adapter.addresses.positionManagerAddress;
        const tjpm = new ethers.Contract(pmAddress, contractData.TJPositionManager.abi, env.provider);

        // 1. Create a fresh position
        const positionRange = adapter.getPositionRange(e2ePoolData, 1, 1);
        const vaultWavaxBal = await wavax.balanceOf(vaultAddress);
        const vaultUsdcBal = await usdc.balanceOf(vaultAddress);
        const wavaxAmount = vaultWavaxBal.div(40);
        const usdcAmount = vaultUsdcBal.div(40);

        const createData = await adapter.generateCreatePositionData({
          position: positionRange,
          token0Amount: wavaxAmount.toString(),
          token1Amount: usdcAmount.toString(),
          provider: env.provider,
          walletAddress: vaultAddress,
          poolData: e2ePoolData,
          token0Data: { address: wavaxAddress, symbol: 'WAVAX', decimals: 18 },
          token1Data: { address: usdcAddress, symbol: 'USDC', decimals: 6 },
          slippageTolerance: 5,
          deadlineMinutes: 10,
        });

        // Workaround: Hardhat fork gas estimation bug (see removeE2E beforeAll)
        await testVault.estimateGas.mint([pmAddress], [createData.data], [0]);

        await (await testVault.mint([pmAddress], [createData.data], [0])).wait();

        const positionIds = await tjpm.getPositionsByVault(vaultAddress);
        const newPosId = positionIds[positionIds.length - 1];
        const posResult = await adapter.getPositionById(newPosId, env.provider);
        const newPos = posResult.position;
        expect(newPos.active).toBe(true);

        // 2. Add liquidity to the position
        const addWavaxAmount = vaultWavaxBal.div(80);
        const addUsdcAmount = vaultUsdcBal.div(80);

        const addData = await adapter.generateAddLiquidityData({
          position: { id: newPosId.toString(), lowerBinId: newPos.lowerBinId, upperBinId: newPos.upperBinId },
          token0Amount: addWavaxAmount.toString(),
          token1Amount: addUsdcAmount.toString(),
          provider: env.provider,
          poolData: e2ePoolData,
          token0Data: { address: wavaxAddress, symbol: 'WAVAX', decimals: 18 },
          token1Data: { address: usdcAddress, symbol: 'USDC', decimals: 6 },
          slippageTolerance: 50,
          deadlineMinutes: 10,
        });

        await (await testVault.increaseLiquidity([pmAddress], [addData.data], [0])).wait();

        // Verify still active after adding
        const posAfterAdd = await tjpm.getPosition(newPosId);
        expect(posAfterAdd.active).toBe(true);

        // 3. Remove 100% of the position
        const posForRemoval = await adapter.getPositionById(newPosId, env.provider);

        const wavaxBalBefore = await wavax.balanceOf(vaultAddress);
        const usdcBalBefore = await usdc.balanceOf(vaultAddress);

        const removeData = await adapter.generateRemoveLiquidityData({
          position: posForRemoval.position,
          percentage: 100,
          provider: env.provider,
          walletAddress: vaultAddress,
          slippageTolerance: 50,
          deadlineMinutes: 10,
        });

        await (await testVault.decreaseLiquidity([pmAddress], [removeData.data])).wait();

        // Verify position is now inactive
        const posAfterRemove = await tjpm.getPosition(newPosId);
        expect(posAfterRemove.active).toBe(false);

        // Verify vault received tokens back
        const wavaxBalAfter = await wavax.balanceOf(vaultAddress);
        const usdcBalAfter = await usdc.balanceOf(vaultAddress);
        const wavaxReceived = wavaxBalAfter.sub(wavaxBalBefore);
        const usdcReceived = usdcBalAfter.sub(usdcBalBefore);

        expect(wavaxReceived.gt(0) || usdcReceived.gt(0)).toBe(true);

        console.log(`  Full lifecycle: create → add → remove complete for position ${newPosId}`);
      }, 180000);

      // --- Calldata encoding tests (ported from Success Cases, using real position ID) ---

      it('should generate valid calldata for existing position', async () => {
        if (!e2ePosition || !e2ePoolData) return;

        const result = await adapter.generateAddLiquidityData({
          position: { id: e2ePositionId.toString(), ...e2ePosition },
          token0Amount: ethers.utils.parseEther('1').toString(),
          token1Amount: ethers.utils.parseUnits('2000', 6).toString(),
          provider: env.provider,
          poolData: e2ePoolData,
          token0Data: WETH,
          token1Data: USDC,
          slippageTolerance: 5,
          deadlineMinutes: 10,
        });

        expect(result).toHaveProperty('to');
        expect(result).toHaveProperty('data');
        expect(result).toHaveProperty('value');
        expect(result).toHaveProperty('quote');
        expect(result.to).toBe(adapter.addresses.positionManagerAddress);
        expect(result.value).toBe('0x00');

        const decoded = addToPositionIface.decodeFunctionData('addToPosition', result.data);
        expect(decoded.positionId.toString()).toBe(e2ePositionId.toString());
        expect(decoded.activeIdDesired.toNumber()).toBe(e2ePoolData.activeId);
      }, 60000);

      it('should sort tokens to TJ canonical order (tokenX = lower address)', async () => {
        if (!e2ePosition || !e2ePoolData) return;
        const position = { id: e2ePositionId.toString(), lowerBinId: e2ePosition.lowerBinId, upperBinId: e2ePosition.upperBinId };

        // Pass USDC as token0 (higher address) and WETH as token1 (lower address)
        const result = await adapter.generateAddLiquidityData({
          position,
          token0Amount: '2000000000', // USDC amount
          token1Amount: '1000000000000000000', // WETH amount
          provider: env.provider,
          poolData: e2ePoolData,
          token0Data: USDC,
          token1Data: WETH,
          slippageTolerance: 5,
          deadlineMinutes: 10,
        });

        const decoded = addToPositionIface.decodeFunctionData('addToPosition', result.data);

        // tokensSwapped should be true (USDC > WETH, so inputs were swapped)
        expect(result.quote.tokensSwapped).toBe(true);

        // amountX should be the WETH amount (lower address = tokenX)
        expect(decoded.amountX.toString()).toBe('1000000000000000000');
        // amountY should be the USDC amount (higher address = tokenY)
        expect(decoded.amountY.toString()).toBe('2000000000');
      }, 60000);

      it('should not swap when tokens are already in canonical order', async () => {
        if (!e2ePosition || !e2ePoolData) return;
        const position = { id: e2ePositionId.toString(), lowerBinId: e2ePosition.lowerBinId, upperBinId: e2ePosition.upperBinId };

        const result = await adapter.generateAddLiquidityData({
          position,
          token0Amount: '1000000000000000000', // WETH
          token1Amount: '2000000000', // USDC
          provider: env.provider,
          poolData: e2ePoolData,
          token0Data: WETH,
          token1Data: USDC,
          slippageTolerance: 5,
          deadlineMinutes: 10,
        });

        expect(result.quote.tokensSwapped).toBe(false);

        const decoded = addToPositionIface.decodeFunctionData('addToPosition', result.data);
        expect(decoded.amountX.toString()).toBe('1000000000000000000'); // WETH
        expect(decoded.amountY.toString()).toBe('2000000000'); // USDC
      }, 60000);

      it('should apply slippage correctly to min amounts', async () => {
        if (!e2ePosition || !e2ePoolData) return;
        const position = { id: e2ePositionId.toString(), lowerBinId: e2ePosition.lowerBinId, upperBinId: e2ePosition.upperBinId };

        const result = await adapter.generateAddLiquidityData({
          position,
          token0Amount: '10000',
          token1Amount: '20000',
          provider: env.provider,
          poolData: e2ePoolData,
          token0Data: WETH,
          token1Data: USDC,
          slippageTolerance: 10, // 10% slippage
          deadlineMinutes: 10,
        });

        // 10% slippage: min = amount * 90% = amount * 9000 / 10000
        expect(result.quote.amountXMin).toBe('9000');
        expect(result.quote.amountYMin).toBe('18000');
      }, 60000);

      it('should include deltaIds and distributions from SDK in quote', async () => {
        if (!e2ePosition || !e2ePoolData) return;
        // Use custom bin range centered on activeId for predictable deltaIds
        const position = { id: e2ePositionId.toString(), lowerBinId: e2ePoolData.activeId - 3, upperBinId: e2ePoolData.activeId + 3 };

        const result = await adapter.generateAddLiquidityData({
          position,
          token0Amount: '1000000000000000000',
          token1Amount: '2000000000',
          provider: env.provider,
          poolData: e2ePoolData,
          token0Data: WETH,
          token1Data: USDC,
          slippageTolerance: 5,
          deadlineMinutes: 10,
        });

        expect(Array.isArray(result.quote.deltaIds)).toBe(true);
        expect(Array.isArray(result.quote.distributionX)).toBe(true);
        expect(Array.isArray(result.quote.distributionY)).toBe(true);

        // Number of bins should match the range
        const expectedBins = 7; // activeId-3 to activeId+3
        expect(result.quote.deltaIds.length).toBe(expectedBins);
        expect(result.quote.distributionX.length).toBe(expectedBins);
        expect(result.quote.distributionY.length).toBe(expectedBins);

        // deltaIds should be relative to activeId
        expect(result.quote.deltaIds[0]).toBe(-3);
        expect(result.quote.deltaIds[result.quote.deltaIds.length - 1]).toBe(3);

        // Verify distributions are present in calldata too
        const decoded = addToPositionIface.decodeFunctionData('addToPosition', result.data);
        expect(decoded.deltaIds.length).toBe(expectedBins);
        expect(decoded.distributionX.length).toBe(expectedBins);
        expect(decoded.distributionY.length).toBe(expectedBins);
      }, 60000);

      it('should encode all 13 addToPosition parameters correctly', async () => {
        if (!e2ePosition || !e2ePoolData) return;
        // Use custom bin range centered on activeId for predictable deltaIds
        const position = { id: e2ePositionId.toString(), lowerBinId: e2ePoolData.activeId - 3, upperBinId: e2ePoolData.activeId + 3 };

        const result = await adapter.generateAddLiquidityData({
          position,
          token0Amount: '1000000000000000000',
          token1Amount: '2000000000',
          provider: env.provider,
          poolData: e2ePoolData,
          token0Data: WETH,
          token1Data: USDC,
          slippageTolerance: 5,
          deadlineMinutes: 10,
        });

        const decoded = addToPositionIface.decodeFunctionData('addToPosition', result.data);

        // 1. positionId
        expect(decoded.positionId.toString()).toBe(e2ePositionId.toString());
        // 2. previousFeesX (fee-aware baseline)
        expect(Array.isArray(decoded.previousFeesX)).toBe(true);
        // 3. previousFeesY
        expect(Array.isArray(decoded.previousFeesY)).toBe(true);
        // 4. amountX (WETH = lower address = tokenX)
        expect(decoded.amountX.toString()).toBe('1000000000000000000');
        // 5. amountY (USDC = higher address = tokenY)
        expect(decoded.amountY.toString()).toBe('2000000000');
        // 6. amountXMin (95% of amountX with 5% slippage)
        expect(decoded.amountXMin.toString()).toBe('950000000000000000');
        // 7. amountYMin (95% of amountY)
        expect(decoded.amountYMin.toString()).toBe('1900000000');
        // 8. activeIdDesired
        expect(decoded.activeIdDesired.toNumber()).toBe(e2ePoolData.activeId);
        // 9. idSlippage (should be > 0 for 5% slippage)
        expect(decoded.idSlippage.toNumber()).toBeGreaterThan(0);
        // 10-12. deltaIds, distributionX, distributionY
        expect(decoded.deltaIds.length).toBe(7);
        // 13. deadline (should be in the future)
        expect(decoded.deadline.toNumber()).toBeGreaterThan(Math.floor(Date.now() / 1000));
      }, 60000);

      it('should include positionId and previousFees in quote', async () => {
        if (!e2ePosition || !e2ePoolData) return;
        const position = { id: e2ePositionId.toString(), lowerBinId: e2ePosition.lowerBinId, upperBinId: e2ePosition.upperBinId };

        const result = await adapter.generateAddLiquidityData({
          position,
          token0Amount: '1000000000000000000',
          token1Amount: '2000000000',
          provider: env.provider,
          poolData: e2ePoolData,
          token0Data: WETH,
          token1Data: USDC,
          slippageTolerance: 5,
          deadlineMinutes: 10,
        });

        expect(result.quote.positionId).toBe(e2ePositionId.toString());
        expect(result.quote.lbPair).toBe(e2ePoolData.address);
        expect(result.quote.binStep).toBe(e2ePoolData.binStep);
        expect(result.quote.activeId).toBe(e2ePoolData.activeId);
        expect(Array.isArray(result.quote.previousFeesX)).toBe(true);
        expect(Array.isArray(result.quote.previousFeesY)).toBe(true);
      }, 60000);

      it('should compute idSlippage correctly for known values', async () => {
        if (!e2ePosition || !e2ePoolData) return;
        const position = { id: e2ePositionId.toString(), lowerBinId: e2ePosition.lowerBinId, upperBinId: e2ePosition.upperBinId };

        const result = await adapter.generateAddLiquidityData({
          position,
          token0Amount: '1000000000000000000',
          token1Amount: '2000000000',
          provider: env.provider,
          poolData: e2ePoolData,
          token0Data: WETH,
          token1Data: USDC,
          slippageTolerance: 5,
          deadlineMinutes: 10,
        });

        // Formula: floor(log(1 + slippage) / log(1 + binStep/10000))
        const expected = Math.floor(Math.log(1.05) / Math.log(1 + e2ePoolData.binStep / 10000));
        expect(result.quote.idSlippage).toBe(expected);
      }, 60000);
    });
  });

  describe('batchSwapTransactions', () => {
    describe('Validation Error Cases', () => {
      it('should throw error for missing provider', async () => {
        await expect(
          adapter.batchSwapTransactions([], { chainId: env.chainId, recipient: '0x1234', slippageTolerance: 0.5 })
        ).rejects.toThrow('provider is required');
      });

      it('should throw error for missing chainId', async () => {
        await expect(
          adapter.batchSwapTransactions([], { provider: env.provider, recipient: '0x1234', slippageTolerance: 0.5 })
        ).rejects.toThrow('chainId is required');
      });

      it('should throw error for missing recipient', async () => {
        await expect(
          adapter.batchSwapTransactions([], { provider: env.provider, chainId: env.chainId, slippageTolerance: 0.5 })
        ).rejects.toThrow('recipient is required');
      });

      it('should throw error for missing slippageTolerance', async () => {
        await expect(
          adapter.batchSwapTransactions([], { provider: env.provider, chainId: env.chainId, recipient: '0x1234' })
        ).rejects.toThrow('slippageTolerance is required');
      });

      it('should not require signer (TJ V2.2 has no Permit2)', async () => {
        // Without signer, should pass option validation and hit instruction validation
        await expect(
          adapter.batchSwapTransactions([], { provider: env.provider, chainId: env.chainId, recipient: '0x1234', slippageTolerance: 0.5 })
        ).rejects.toThrow('swapInstructions cannot be empty');
      });

      it('should silently accept signer if provided', async () => {
        const mockSigner = { _signTypedData: () => Promise.resolve('0x') };
        // Should pass option validation and hit instruction validation
        await expect(
          adapter.batchSwapTransactions([], { signer: mockSigner, provider: env.provider, chainId: env.chainId, recipient: '0x1234', slippageTolerance: 0.5 })
        ).rejects.toThrow('swapInstructions cannot be empty');
      });

      it('should throw error for non-array swapInstructions', async () => {
        const options = { provider: env.provider, chainId: env.chainId, recipient: '0x1234', slippageTolerance: 0.5 };
        await expect(
          adapter.batchSwapTransactions('not an array', options)
        ).rejects.toThrow('swapInstructions must be an array');
      });

      it('should throw error for empty swapInstructions array', async () => {
        const options = { provider: env.provider, chainId: env.chainId, recipient: '0x1234', slippageTolerance: 0.5 };
        await expect(
          adapter.batchSwapTransactions([], options)
        ).rejects.toThrow('swapInstructions cannot be empty');
      });

      it('should throw error for missing tokenIn', async () => {
        const options = { provider: env.provider, chainId: env.chainId, recipient: '0x1234', slippageTolerance: 0.5 };
        await expect(
          adapter.batchSwapTransactions([{ tokenOut: { symbol: 'USDC' }, amount: '1000' }], options)
        ).rejects.toThrow('tokenIn with symbol is required');
      });

      it('should throw error for missing tokenOut', async () => {
        const options = { provider: env.provider, chainId: env.chainId, recipient: '0x1234', slippageTolerance: 0.5 };
        await expect(
          adapter.batchSwapTransactions([{ tokenIn: { symbol: 'ETH' }, amount: '1000' }], options)
        ).rejects.toThrow('tokenOut with symbol is required');
      });

      it('should throw error for missing amount', async () => {
        const options = { provider: env.provider, chainId: env.chainId, recipient: '0x1234', slippageTolerance: 0.5 };
        await expect(
          adapter.batchSwapTransactions([{ tokenIn: { symbol: 'ETH' }, tokenOut: { symbol: 'USDC' } }], options)
        ).rejects.toThrow('amount is required');
      });
    });

    describe('E2E Swap Transaction Generation', () => {
      const vaultAddress = () => testVault.address;

      it('should generate ERC20→ERC20 swap (WETH→USDC exact input)', async () => {
        const amount = ethers.utils.parseEther('0.1').toString();
        const result = await adapter.batchSwapTransactions(
          [{
            tokenIn: { symbol: 'WAVAX', address: wavaxAddress },
            tokenOut: { symbol: 'USDC', address: usdcAddress },
            amount,
            isAmountIn: true,
          }],
          { provider: env.provider, chainId: env.chainId, recipient: vaultAddress(), slippageTolerance: 0.5 }
        );

        expect(result.transactions).toHaveLength(1);
        expect(result.metadata).toHaveLength(1);

        const tx = result.transactions[0];
        expect(tx.to).toBe(adapter.addresses.lbRouterAddress);
        expect(tx.data).toMatch(/^0x[a-fA-F0-9]+$/);
        expect(tx.value).toBe('0x00');

        const meta = result.metadata[0];
        expect(meta.tokenInSymbol).toBe('WAVAX');
        expect(meta.tokenOutSymbol).toBe('USDC');
        expect(meta.tokenInAddress).toBe(wavaxAddress);
        expect(meta.tokenOutAddress).toBe(usdcAddress);
        expect(BigInt(meta.quotedAmountOut)).toBeGreaterThan(0n);
        expect(meta.isAmountIn).toBe(true);
        // Single-hop swap should have routes with valid version
        expect(meta.routes).toBeDefined();
        expect(meta.routes).toHaveLength(1);
        expect(meta.routes[0].poolCount).toBe(1);
        expect(meta.routes[0].versions[0]).toBeGreaterThanOrEqual(0);
        expect(meta.routes[0].versions[0]).toBeLessThanOrEqual(3);
      }, 60000);

      it('should generate Native→ERC20 swap (ETH→USDC exact input)', async () => {
        const amount = ethers.utils.parseEther('0.1').toString();
        const result = await adapter.batchSwapTransactions(
          [{
            tokenIn: { symbol: 'ETH', isNative: true },
            tokenOut: { symbol: 'USDC', address: usdcAddress },
            amount,
            isAmountIn: true,
          }],
          { provider: env.provider, chainId: env.chainId, recipient: vaultAddress(), slippageTolerance: 0.5 }
        );

        expect(result.transactions).toHaveLength(1);
        const tx = result.transactions[0];
        expect(tx.to).toBe(adapter.addresses.lbRouterAddress);
        // Native swap should have ETH value attached
        expect(BigInt(tx.value)).toBeGreaterThan(0n);

        const meta = result.metadata[0];
        // tokenInAddress should be WETH for parseSwapReceipt compatibility
        expect(meta.tokenInAddress).toBe(wavaxAddress);
        expect(meta.tokenOutAddress).toBe(usdcAddress);
        expect(BigInt(meta.quotedAmountOut)).toBeGreaterThan(0n);
        // Single-hop swap should have routes with valid version
        expect(meta.routes).toBeDefined();
        expect(meta.routes[0].versions[0]).toBeGreaterThanOrEqual(0);
        expect(meta.routes[0].versions[0]).toBeLessThanOrEqual(3);
      }, 60000);

      it('should generate ERC20→Native swap (USDC→ETH exact input)', async () => {
        const amount = ethers.utils.parseUnits('100', 6).toString();
        const result = await adapter.batchSwapTransactions(
          [{
            tokenIn: { symbol: 'USDC', address: usdcAddress },
            tokenOut: { symbol: 'ETH', isNative: true },
            amount,
            isAmountIn: true,
          }],
          { provider: env.provider, chainId: env.chainId, recipient: vaultAddress(), slippageTolerance: 0.5 }
        );

        expect(result.transactions).toHaveLength(1);
        const tx = result.transactions[0];
        expect(tx.to).toBe(adapter.addresses.lbRouterAddress);
        expect(tx.value).toBe('0x00');

        const meta = result.metadata[0];
        expect(meta.tokenInAddress).toBe(usdcAddress);
        // tokenOutAddress should be WETH for parseSwapReceipt compatibility
        expect(meta.tokenOutAddress).toBe(wavaxAddress);
        expect(BigInt(meta.quotedAmountOut)).toBeGreaterThan(0n);
        // Single-hop swap should have routes with valid version
        expect(meta.routes).toBeDefined();
        expect(meta.routes[0].versions[0]).toBeGreaterThanOrEqual(0);
        expect(meta.routes[0].versions[0]).toBeLessThanOrEqual(3);
      }, 60000);

      it('should generate multiple batch swap transactions', async () => {
        const result = await adapter.batchSwapTransactions(
          [
            {
              tokenIn: { symbol: 'WAVAX', address: wavaxAddress },
              tokenOut: { symbol: 'USDC', address: usdcAddress },
              amount: ethers.utils.parseEther('0.1').toString(),
              isAmountIn: true,
            },
            {
              tokenIn: { symbol: 'USDC', address: usdcAddress },
              tokenOut: { symbol: 'WAVAX', address: wavaxAddress },
              amount: ethers.utils.parseUnits('100', 6).toString(),
              isAmountIn: true,
            },
          ],
          { provider: env.provider, chainId: env.chainId, recipient: vaultAddress(), slippageTolerance: 0.5 }
        );

        expect(result.transactions).toHaveLength(2);
        expect(result.metadata).toHaveLength(2);

        expect(result.metadata[0].tokenInSymbol).toBe('WAVAX');
        expect(result.metadata[0].tokenOutSymbol).toBe('USDC');
        expect(result.metadata[1].tokenInSymbol).toBe('USDC');
        expect(result.metadata[1].tokenOutSymbol).toBe('WAVAX');

        // Both should target the router
        expect(result.transactions[0].to).toBe(adapter.addresses.lbRouterAddress);
        expect(result.transactions[1].to).toBe(adapter.addresses.lbRouterAddress);

        // Both are single-hop, should have routes with valid version
        expect(result.metadata[0].routes[0].versions[0]).toBeGreaterThanOrEqual(0);
        expect(result.metadata[1].routes[0].versions[0]).toBeGreaterThanOrEqual(0);
      }, 60000);

      it('should generate exact output swap (WETH→exact USDC)', async () => {
        const exactUsdcOut = ethers.utils.parseUnits('100', 6).toString();
        const result = await adapter.batchSwapTransactions(
          [{
            tokenIn: { symbol: 'WAVAX', address: wavaxAddress },
            tokenOut: { symbol: 'USDC', address: usdcAddress },
            amount: exactUsdcOut,
            isAmountIn: false,
          }],
          { provider: env.provider, chainId: env.chainId, recipient: vaultAddress(), slippageTolerance: 0.5 }
        );

        expect(result.transactions).toHaveLength(1);
        expect(result.metadata).toHaveLength(1);

        const meta = result.metadata[0];
        expect(meta.isAmountIn).toBe(false);
        expect(BigInt(meta.quotedAmountIn)).toBeGreaterThan(0n);
        expect(BigInt(meta.quotedAmountOut)).toBeGreaterThan(0n);
      }, 60000);

      it('should include routes with version info for USDT→WAVAX swap', async () => {
        // USDT→WAVAX may route through V1 JoePair (1 hop) or V2.2 via USDC (2 hops)
        // depending on fork block state. Either way, routes must have versions.
        const usdtAddress = tokens['USD₮0'].addresses[env.chainId];
        const amount = ethers.utils.parseUnits('10', 6).toString(); // 10 USDT

        const result = await adapter.batchSwapTransactions(
          [{
            tokenIn: { symbol: 'USD₮0', address: usdtAddress },
            tokenOut: { symbol: 'WAVAX', address: wavaxAddress },
            amount,
            isAmountIn: true,
          }],
          { provider: env.provider, chainId: env.chainId, recipient: vaultAddress(), slippageTolerance: 1 }
        );

        expect(result.transactions).toHaveLength(1);
        expect(result.metadata).toHaveLength(1);

        const meta = result.metadata[0];
        expect(meta.tokenInSymbol).toBe('USD₮0');
        expect(meta.tokenOutSymbol).toBe('WAVAX');
        expect(BigInt(meta.quotedAmountOut)).toBeGreaterThan(0n);

        // Routes must always be present with version info
        expect(meta.routes).toBeDefined();
        expect(meta.routes).toHaveLength(1);
        const route = meta.routes[0];
        expect(route.poolCount).toBeGreaterThanOrEqual(1);
        expect(route.tokenPath).toHaveLength(route.poolCount + 1);
        // Path should start with USDT and end with WAVAX
        expect(route.tokenPath[0].toLowerCase()).toBe(usdtAddress.toLowerCase());
        expect(route.tokenPath[route.tokenPath.length - 1].toLowerCase()).toBe(wavaxAddress.toLowerCase());
        // Versions array should match hop count
        expect(route.versions).toHaveLength(route.poolCount);
        // Each version should be a valid TJ version enum (0-3)
        for (const v of route.versions) {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(3);
        }
      }, 60000);
    });
  });

  describe('getBestSwapQuote', () => {
    describe('Validation Error Cases', () => {
      it('should throw error for missing provider', async () => {
        await expect(adapter.getBestSwapQuote({
          tokenInAddress: wavaxAddress,
          tokenOutAddress: usdcAddress,
          amount: ethers.utils.parseEther('0.1').toString(),
          isAmountIn: true,
        })).rejects.toThrow('provider is required');
      });

      it('should throw error for null tokenInAddress', async () => {
        await expect(adapter.getBestSwapQuote({
          tokenInAddress: null,
          tokenOutAddress: usdcAddress,
          amount: ethers.utils.parseEther('0.1').toString(),
          isAmountIn: true,
          provider: env.provider,
        })).rejects.toThrow('TokenIn address parameter is required');
      });

      it('should throw error for invalid tokenInAddress', async () => {
        await expect(adapter.getBestSwapQuote({
          tokenInAddress: 'invalid-address',
          tokenOutAddress: usdcAddress,
          amount: ethers.utils.parseEther('0.1').toString(),
          isAmountIn: true,
          provider: env.provider,
        })).rejects.toThrow('Invalid tokenIn address');
      });

      it('should skip tokenIn validation when tokenInIsNative is true', async () => {
        // Should NOT throw an address validation error — it should proceed past address validation
        // It will likely fail at the quoter call or succeed, but the key assertion is no address error
        const result = adapter.getBestSwapQuote({
          tokenInIsNative: true,
          tokenOutAddress: usdcAddress,
          amount: ethers.utils.parseEther('0.1').toString(),
          isAmountIn: true,
          provider: env.provider,
        });

        // If it rejects, the error should NOT be about tokenIn address
        try {
          await result;
        } catch (error) {
          expect(error.message).not.toMatch(/TokenIn address/);
        }
      }, 60000);

      it('should throw error for null tokenOutAddress', async () => {
        await expect(adapter.getBestSwapQuote({
          tokenInAddress: wavaxAddress,
          tokenOutAddress: null,
          amount: ethers.utils.parseEther('0.1').toString(),
          isAmountIn: true,
          provider: env.provider,
        })).rejects.toThrow('TokenOut address parameter is required');
      });

      it('should throw error for non-string amount', async () => {
        await expect(adapter.getBestSwapQuote({
          tokenInAddress: wavaxAddress,
          tokenOutAddress: usdcAddress,
          amount: 123,
          isAmountIn: true,
          provider: env.provider,
        })).rejects.toThrow('Amount must be a string');
      });

      it('should throw error for non-numeric amount string', async () => {
        await expect(adapter.getBestSwapQuote({
          tokenInAddress: wavaxAddress,
          tokenOutAddress: usdcAddress,
          amount: 'abc',
          isAmountIn: true,
          provider: env.provider,
        })).rejects.toThrow('Amount must be a positive numeric string');
      });

      it('should throw error for zero amount', async () => {
        await expect(adapter.getBestSwapQuote({
          tokenInAddress: wavaxAddress,
          tokenOutAddress: usdcAddress,
          amount: '0',
          isAmountIn: true,
          provider: env.provider,
        })).rejects.toThrow('Amount cannot be zero');
      });

      it('should throw error for missing isAmountIn', async () => {
        await expect(adapter.getBestSwapQuote({
          tokenInAddress: wavaxAddress,
          tokenOutAddress: usdcAddress,
          amount: ethers.utils.parseEther('0.1').toString(),
          isAmountIn: null,
          provider: env.provider,
        })).rejects.toThrow('isAmountIn parameter is required and must be a boolean');
      });
    });

    describe('E2E Swap Quotes', () => {
      it('should get EXACT_INPUT quote for ERC20→ERC20 (WETH→USDC)', async () => {
        const amountIn = ethers.utils.parseEther('0.1').toString();

        const result = await adapter.getBestSwapQuote({
          tokenInAddress: wavaxAddress,
          tokenOutAddress: usdcAddress,
          amount: amountIn,
          isAmountIn: true,
          provider: env.provider,
        });

        expect(result.amountIn).toBe(amountIn);
        expect(BigInt(result.amountOut)).toBeGreaterThan(0n);
        expect(result.route).toBeDefined();
      }, 60000);

      it('should get EXACT_OUTPUT quote for ERC20→ERC20 (WETH→USDC)', async () => {
        const amountOut = ethers.utils.parseUnits('100', 6).toString();

        const result = await adapter.getBestSwapQuote({
          tokenInAddress: wavaxAddress,
          tokenOutAddress: usdcAddress,
          amount: amountOut,
          isAmountIn: false,
          provider: env.provider,
        });

        expect(result.amountOut).toBe(amountOut);
        expect(BigInt(result.amountIn)).toBeGreaterThan(0n);
        expect(result.route).toBeDefined();
      }, 60000);

      it('should get quote with native ETH input (tokenInIsNative)', async () => {
        const amountIn = ethers.utils.parseEther('0.1').toString();

        const result = await adapter.getBestSwapQuote({
          tokenInIsNative: true,
          tokenOutAddress: usdcAddress,
          amount: amountIn,
          isAmountIn: true,
          provider: env.provider,
        });

        expect(result.amountIn).toBe(amountIn);
        expect(BigInt(result.amountOut)).toBeGreaterThan(0n);
        expect(result.route).toBeDefined();
      }, 60000);

      it('should get quote with native ETH output (tokenOutIsNative)', async () => {
        const amountIn = ethers.utils.parseUnits('100', 6).toString();

        const result = await adapter.getBestSwapQuote({
          tokenInAddress: usdcAddress,
          tokenOutIsNative: true,
          amount: amountIn,
          isAmountIn: true,
          provider: env.provider,
        });

        expect(result.amountIn).toBe(amountIn);
        expect(BigInt(result.amountOut)).toBeGreaterThan(0n);
        expect(result.route).toBeDefined();
      }, 60000);

      it('should return deterministic quotes for same params', async () => {
        const params = {
          tokenInAddress: wavaxAddress,
          tokenOutAddress: usdcAddress,
          amount: ethers.utils.parseEther('0.1').toString(),
          isAmountIn: true,
          provider: env.provider,
        };

        const result1 = await adapter.getBestSwapQuote(params);
        const result2 = await adapter.getBestSwapQuote(params);

        expect(result1.amountIn).toBe(result2.amountIn);
        expect(result1.amountOut).toBe(result2.amountOut);
      }, 60000);
    });
  });

  describe('calculateTokenAmounts', () => {
    const validPosition = {
      pool: '0x0000000000000000000000000000000000000001',
      depositIds: [8388608],
      liquidityMinted: ['1000000'],
    };
    const validPoolData = { activeId: 8388608, binStep: 20 };
    const validToken0Data = { address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', decimals: 18 };
    const validToken1Data = { address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', decimals: 6 };

    describe('Error Cases', () => {
      it('should throw error for missing provider', async () => {
        await expect(adapter.calculateTokenAmounts(
          validPosition, validPoolData, validToken0Data, validToken1Data
        )).rejects.toThrow('provider is required');
      });

      it('should throw error for null position', async () => {
        await expect(adapter.calculateTokenAmounts(
          null, validPoolData, validToken0Data, validToken1Data, env.provider
        )).rejects.toThrow('position is required');
      });

      it('should throw error for missing position.pool', async () => {
        await expect(adapter.calculateTokenAmounts(
          { depositIds: [1], liquidityMinted: ['1'] }, validPoolData, validToken0Data, validToken1Data, env.provider
        )).rejects.toThrow('position.pool is required');
      });

      it('should throw error for empty depositIds', async () => {
        await expect(adapter.calculateTokenAmounts(
          { pool: '0x01', depositIds: [], liquidityMinted: [] }, validPoolData, validToken0Data, validToken1Data, env.provider
        )).rejects.toThrow('position.depositIds is required and must be a non-empty array');
      });

      it('should throw error for missing depositIds', async () => {
        await expect(adapter.calculateTokenAmounts(
          { pool: '0x01', liquidityMinted: ['1'] }, validPoolData, validToken0Data, validToken1Data, env.provider
        )).rejects.toThrow('position.depositIds is required and must be a non-empty array');
      });

      it('should throw error for empty liquidityMinted', async () => {
        await expect(adapter.calculateTokenAmounts(
          { pool: '0x01', depositIds: [1], liquidityMinted: [] }, validPoolData, validToken0Data, validToken1Data, env.provider
        )).rejects.toThrow('position.liquidityMinted is required and must be a non-empty array');
      });

      it('should throw error for depositIds/liquidityMinted length mismatch', async () => {
        await expect(adapter.calculateTokenAmounts(
          { pool: '0x01', depositIds: [1, 2], liquidityMinted: ['1'] }, validPoolData, validToken0Data, validToken1Data, env.provider
        )).rejects.toThrow('position.depositIds length (2) must match position.liquidityMinted length (1)');
      });

      it('should throw error for missing poolData', async () => {
        await expect(adapter.calculateTokenAmounts(
          validPosition, null, validToken0Data, validToken1Data, env.provider
        )).rejects.toThrow('poolData is required');
      });

      it('should throw error for missing token0Data', async () => {
        await expect(adapter.calculateTokenAmounts(
          validPosition, validPoolData, null, validToken1Data, env.provider
        )).rejects.toThrow('token0Data is required');
      });

      it('should throw error for missing token1Data', async () => {
        await expect(adapter.calculateTokenAmounts(
          validPosition, validPoolData, validToken0Data, null, env.provider
        )).rejects.toThrow('token1Data is required');
      });

      it('should return [0n, 0n] for zero liquidity', async () => {
        const zeroPosition = {
          pool: '0x0000000000000000000000000000000000000001',
          depositIds: [8388608],
          liquidityMinted: ['0'],
        };
        const result = await adapter.calculateTokenAmounts(
          zeroPosition, validPoolData, validToken0Data, validToken1Data, env.provider
        );
        expect(result).toEqual([0n, 0n]);
      });
    });

    describe('E2E', () => {
      let e2ePosition;
      let e2ePoolData;

      beforeAll(async () => {
        const pmAddress = adapter.addresses.positionManagerAddress;
        const tjpmAbi = contractData.TJPositionManager.abi;
        const tjpm = new ethers.Contract(pmAddress, tjpmAbi, env.provider);

        const positionIds = await tjpm.getPositionsByVault(testVault.address);
        if (positionIds.length === 0) {
          console.log('No positions available for calculateTokenAmounts E2E tests');
          return;
        }

        const result = await adapter.getPositionById(positionIds[0], env.provider);
        e2ePosition = result.position;

        e2ePoolData = await adapter.getPoolData(e2ePosition.pool, env.provider);
      }, 60000);

      it('should calculate amounts for an existing position', async () => {
        if (!e2ePosition) return;

        const result = await adapter.calculateTokenAmounts(
          e2ePosition, e2ePoolData,
          { address: wavaxAddress, decimals: 18 },
          { address: usdcAddress, decimals: 6 },
          env.provider
        );

        expect(Array.isArray(result)).toBe(true);
        expect(result).toHaveLength(2);
        expect(typeof result[0]).toBe('bigint');
        expect(typeof result[1]).toBe('bigint');
        expect(result[0]).toBeGreaterThanOrEqual(0n);
        expect(result[1]).toBeGreaterThanOrEqual(0n);
        // At least one amount should be non-zero for an active position
        expect(result[0] + result[1]).toBeGreaterThan(0n);
      }, 60000);

      it('should return deterministic results', async () => {
        if (!e2ePosition) return;

        const tokenData0 = { address: wavaxAddress, decimals: 18 };
        const tokenData1 = { address: usdcAddress, decimals: 6 };

        const result1 = await adapter.calculateTokenAmounts(
          e2ePosition, e2ePoolData, tokenData0, tokenData1, env.provider
        );
        const result2 = await adapter.calculateTokenAmounts(
          e2ePosition, e2ePoolData, tokenData0, tokenData1, env.provider
        );

        expect(result1[0]).toBe(result2[0]);
        expect(result1[1]).toBe(result2[1]);
      }, 60000);

      it('should return both tokens for an in-range position', async () => {
        if (!e2ePosition) return;

        // Verify position is in-range (activeId within bounds)
        const activeId = e2ePoolData.activeId;
        const inRange = activeId >= e2ePosition.lowerBinId && activeId <= e2ePosition.upperBinId;
        if (!inRange) {
          console.log('Position is out of range, skipping in-range assertion');
          return;
        }

        const result = await adapter.calculateTokenAmounts(
          e2ePosition, e2ePoolData,
          { address: wavaxAddress, decimals: 18 },
          { address: usdcAddress, decimals: 6 },
          env.provider
        );

        expect(result[0]).toBeGreaterThan(0n);
        expect(result[1]).toBeGreaterThan(0n);
      }, 60000);
    });
  });

  describe('parseIncreaseLiquidityReceipt', () => {
    // Helper: encode a PositionCreated event log (with proxy param)
    function createPositionCreatedLog(positionId, vault, lbPair, proxy, depositIds, liquidityMinted, amountXAdded, amountYAdded) {
      const iface = new ethers.utils.Interface([
        'event PositionCreated(uint256 indexed positionId, address indexed vault, address indexed lbPair, address proxy, uint256[] depositIds, uint256[] liquidityMinted, uint256 amountXAdded, uint256 amountYAdded)'
      ]);
      const topic0 = iface.getEventTopic('PositionCreated');
      const data = ethers.utils.defaultAbiCoder.encode(
        ['address', 'uint256[]', 'uint256[]', 'uint256', 'uint256'],
        [proxy, depositIds, liquidityMinted, amountXAdded, amountYAdded]
      );
      return {
        address: lbPair,
        topics: [
          topic0,
          ethers.utils.hexZeroPad(ethers.BigNumber.from(positionId).toHexString(), 32),
          ethers.utils.hexZeroPad(vault, 32),
          ethers.utils.hexZeroPad(lbPair, 32),
        ],
        data,
      };
    }

    // Helper: encode a PositionIncreased event log
    function createPositionIncreasedLog(positionId, vault, lbPair, amountXAdded, amountYAdded) {
      const iface = new ethers.utils.Interface([
        'event PositionIncreased(uint256 indexed positionId, address indexed vault, address indexed lbPair, uint256 amountXAdded, uint256 amountYAdded)'
      ]);
      const topic0 = iface.getEventTopic('PositionIncreased');
      const data = ethers.utils.defaultAbiCoder.encode(
        ['uint256', 'uint256'],
        [amountXAdded, amountYAdded]
      );
      return {
        address: lbPair,
        topics: [
          topic0,
          ethers.utils.hexZeroPad(ethers.BigNumber.from(positionId).toHexString(), 32),
          ethers.utils.hexZeroPad(vault, 32),
          ethers.utils.hexZeroPad(lbPair, 32),
        ],
        data,
      };
    }

    const VAULT_ADDR = '0x1111111111111111111111111111111111111111';
    const LB_PAIR_ADDR = '0x2222222222222222222222222222222222222222';

    describe('Validation', () => {
      it('should throw error for null receipt', () => {
        expect(() => adapter.parseIncreaseLiquidityReceipt(null))
          .toThrow('Receipt parameter is required');
      });

      it('should throw error for undefined receipt', () => {
        expect(() => adapter.parseIncreaseLiquidityReceipt(undefined))
          .toThrow('Receipt parameter is required');
      });

      it('should throw error for receipt without logs', () => {
        expect(() => adapter.parseIncreaseLiquidityReceipt({}))
          .toThrow('Receipt must have logs property');
      });

      it('should throw error for empty logs (no matching events)', () => {
        expect(() => adapter.parseIncreaseLiquidityReceipt({ logs: [] }))
          .toThrow('PositionCreated or PositionIncreased event not found');
      });

      it('should throw error for non-matching logs', () => {
        const receipt = {
          logs: [{
            address: '0x3333333333333333333333333333333333333333',
            topics: [ethers.utils.id('Transfer(address,address,uint256)')],
            data: '0x',
          }],
        };
        expect(() => adapter.parseIncreaseLiquidityReceipt(receipt))
          .toThrow('PositionCreated or PositionIncreased event not found');
      });
    });

    const PROXY_ADDR = '0x4444444444444444444444444444444444444444';

    describe('PositionCreated parsing', () => {
      it('should parse PositionCreated event from a new position', () => {
        const log = createPositionCreatedLog(
          1,
          VAULT_ADDR,
          LB_PAIR_ADDR,
          PROXY_ADDR,
          [8388607, 8388608, 8388609],
          [1000, 2000, 1000],
          ethers.utils.parseEther('1'),
          ethers.BigNumber.from('1000000000') // 1000 USDC
        );

        const result = adapter.parseIncreaseLiquidityReceipt({ logs: [log] });

        expect(result.tokenId).toBe('1');
        expect(result.liquidity).toBe('4000'); // 1000 + 2000 + 1000
        expect(result.amount0).toBe(ethers.utils.parseEther('1').toString());
        expect(result.amount1).toBe('1000000000');
        expect(result.tickLower).toBe(8388607);
        expect(result.tickUpper).toBe(8388609);
        expect(result.poolAddress).toBe(LB_PAIR_ADDR);
      });
    });

    describe('PositionIncreased parsing', () => {
      it('should parse PositionIncreased event from add-to-position', () => {
        const log = createPositionIncreasedLog(
          5,
          VAULT_ADDR,
          LB_PAIR_ADDR,
          ethers.utils.parseEther('0.5'),
          ethers.BigNumber.from('500000000')
        );

        const result = adapter.parseIncreaseLiquidityReceipt({ logs: [log] });

        expect(result.tokenId).toBe('5');
        expect(result.liquidity).toBeNull();
        expect(result.amount0).toBe(ethers.utils.parseEther('0.5').toString());
        expect(result.amount1).toBe('500000000');
        expect(result.tickLower).toBeNull();
        expect(result.tickUpper).toBeNull();
        expect(result.poolAddress).toBeNull();
      });
    });

    describe('Event precedence', () => {
      it('should prefer PositionCreated when both events are present', () => {
        const createdLog = createPositionCreatedLog(
          1,
          VAULT_ADDR,
          LB_PAIR_ADDR,
          PROXY_ADDR,
          [8388607, 8388608, 8388609],
          [1000, 2000, 1000],
          ethers.utils.parseEther('1'),
          ethers.BigNumber.from('1000000000')
        );
        const increasedLog = createPositionIncreasedLog(
          1,
          VAULT_ADDR,
          LB_PAIR_ADDR,
          ethers.utils.parseEther('0.5'),
          ethers.BigNumber.from('500000000')
        );

        const result = adapter.parseIncreaseLiquidityReceipt({ logs: [createdLog, increasedLog] });

        // Should use PositionCreated data (has poolAddress, liquidity, tick bounds)
        expect(result.poolAddress).toBe(LB_PAIR_ADDR);
        expect(result.liquidity).toBe('4000');
        expect(result.amount0).toBe(ethers.utils.parseEther('1').toString());
        expect(result.amount1).toBe('1000000000');
      });
    });

    describe('E2E Tests', () => {
      it('should parse receipt from real createPosition transaction', async () => {
        if (!testVault || !env) return;

        let poolData, positionRange;
        try {
          const poolResult = await adapter.selectBestPool('WAVAX', 'USDC', env.provider, env.chainId);
          poolData = await adapter.getPoolData(poolResult.bestPool.address, env.provider);
          positionRange = adapter.getPositionRange(poolData, 1, 1);
        } catch (error) {
          if (error.message.includes('No pools found') || error.message.includes('No active pools')) {
            console.log('No Trader Joe V2.2 WAVAX/USDC pools - skipping parseIncreaseLiquidityReceipt E2E');
            return;
          }
          throw error;
        }

        const vaultAddress = testVault.address;
        const pmAddress = adapter.addresses.positionManagerAddress;

        // Ensure approvals
        const approvalTxs = await adapter.getRequiredApprovals(
          'liquidity', vaultAddress, [wavaxAddress, usdcAddress], env.provider
        );
        if (approvalTxs.length > 0) {
          const targets = approvalTxs.map(t => t.to);
          const data = approvalTxs.map(t => t.data);
          await (await testVault.approve(targets, data)).wait();
        }

        // Use small amounts
        const vaultWavaxBal = await wavax.balanceOf(vaultAddress);
        const vaultUsdcBal = await usdc.balanceOf(vaultAddress);
        const wavaxAmount = vaultWavaxBal.div(40);
        const usdcAmount = vaultUsdcBal.div(40);

        const txData = await adapter.generateCreatePositionData({
          position: positionRange,
          token0Amount: wavaxAmount.toString(),
          token1Amount: usdcAmount.toString(),
          provider: env.provider,
          walletAddress: vaultAddress,
          poolData,
          token0Data: { address: wavaxAddress, symbol: 'WAVAX', decimals: 18 },
          token1Data: { address: usdcAddress, symbol: 'USDC', decimals: 6 },
          slippageTolerance: 5,
          deadlineMinutes: 10,
        });

        // Workaround: Hardhat fork gas estimation bug (see removeE2E beforeAll)
        await testVault.estimateGas.mint([pmAddress], [txData.data], [0]);

        const mintTx = await testVault.mint([pmAddress], [txData.data], [0]);
        const receipt = await mintTx.wait();

        const result = adapter.parseIncreaseLiquidityReceipt(receipt);

        // tokenId should be a valid positive number
        expect(Number(result.tokenId)).toBeGreaterThan(0);
        // At least one of amount0/amount1 should be > 0
        expect(BigInt(result.amount0) > 0n || BigInt(result.amount1) > 0n).toBe(true);
        // poolAddress should match the LB pair
        expect(result.poolAddress.toLowerCase()).toBe(poolData.address.toLowerCase());
        // tickLower <= tickUpper
        expect(result.tickLower).toBeLessThanOrEqual(result.tickUpper);
        // liquidity should be non-null for createPosition
        expect(result.liquidity).not.toBeNull();
        expect(BigInt(result.liquidity)).toBeGreaterThan(0n);
      }, 180000);
    });
  });

  describe('generateClaimFeesData', () => {
    const PM_ADDR = '0x4444444444444444444444444444444444444444';

    describe('Validation', () => {
      it('should throw for null position', async () => {
        await expect(adapter.generateClaimFeesData({ position: null, walletAddress: '0x0000000000000000000000000000000000000001' }))
          .rejects.toThrow('Position parameter is required');
      });

      it('should throw for undefined position', async () => {
        await expect(adapter.generateClaimFeesData({ position: undefined, walletAddress: '0x0000000000000000000000000000000000000001' }))
          .rejects.toThrow('Position parameter is required');
      });

      it('should throw for position without id', async () => {
        await expect(adapter.generateClaimFeesData({ position: {}, walletAddress: '0x0000000000000000000000000000000000000001' }))
          .rejects.toThrow('Position id is required');
      });

      it('should throw if positionManagerAddress is not configured', async () => {
        const adapterNoPM = new TraderJoeV2_2Adapter(env.chainId, env.provider);
        adapterNoPM.addresses.positionManagerAddress = '';
        await expect(adapterNoPM.generateClaimFeesData({ position: { id: '1' }, walletAddress: '0x0000000000000000000000000000000000000001' }))
          .rejects.toThrow('No position manager address configured');
      });
    });

    describe('Happy path', () => {
      it('should return { to, data, value, quote } with feeData provided', async () => {
        const result = await adapter.generateClaimFeesData({
          position: { id: '42' },
          walletAddress: '0x0000000000000000000000000000000000000001',
          feeData: {
            feeShares: ['100', '200', '300'],
            fees0: '1000000000000000',
            fees1: '500000',
          },
        });

        expect(result).toHaveProperty('to');
        expect(result).toHaveProperty('data');
        expect(result).toHaveProperty('value');
        expect(result).toHaveProperty('quote');
        expect(result.to).toBe(adapter.addresses.positionManagerAddress);
        expect(result.value).toBe('0x00');
      });

      it('should encode new collectFees selector with feeShares, mins, deadline', async () => {
        const feeShares = ['100', '200', '300'];
        const result = await adapter.generateClaimFeesData({
          position: { id: '42' },
          walletAddress: '0x0000000000000000000000000000000000000001',
          feeData: { feeShares, fees0: '1000000000000000', fees1: '500000' },
          slippageTolerance: 0.5,
          deadlineMinutes: 20,
        });

        const iface = new ethers.utils.Interface([
          "function collectFees(uint256 positionId, uint256[] feeShares, uint256 amountXMin, uint256 amountYMin, uint256 deadline)"
        ]);
        const decoded = iface.decodeFunctionData('collectFees', result.data);
        expect(decoded.positionId.toString()).toBe('42');
        expect(decoded.feeShares.length).toBe(3);
        expect(decoded.deadline.toNumber()).toBeGreaterThan(Math.floor(Date.now() / 1000));
      });

      it('should accept position.id = 0 with feeData', async () => {
        const result = await adapter.generateClaimFeesData({
          position: { id: 0 },
          walletAddress: '0x0000000000000000000000000000000000000001',
          feeData: { feeShares: ['100'], fees0: '1000', fees1: '500' },
        });

        const iface = new ethers.utils.Interface([
          "function collectFees(uint256 positionId, uint256[] feeShares, uint256 amountXMin, uint256 amountYMin, uint256 deadline)"
        ]);
        const decoded = iface.decodeFunctionData('collectFees', result.data);
        expect(decoded.positionId.toString()).toBe('0');
      });

      it('should return null when all feeShares are zero', async () => {
        const result = await adapter.generateClaimFeesData({
          position: { id: '42' },
          walletAddress: '0x0000000000000000000000000000000000000001',
          feeData: { feeShares: ['0', '0', '0'], fees0: '0', fees1: '0' },
        });
        expect(result).toBeNull();
      });

      it('should throw when neither feeData nor provider is given', async () => {
        await expect(adapter.generateClaimFeesData({
          position: { id: '42' },
          walletAddress: '0x0000000000000000000000000000000000000001',
        })).rejects.toThrow('provider is required when feeData is not provided');
      });

      it('should include feeShares, amountXMin, amountYMin in quote', async () => {
        const result = await adapter.generateClaimFeesData({
          position: { id: '42' },
          walletAddress: '0x0000000000000000000000000000000000000001',
          feeData: { feeShares: ['100', '200'], fees0: '1000000', fees1: '500' },
        });
        expect(result.quote).toHaveProperty('feeShares');
        expect(result.quote).toHaveProperty('amountXMin');
        expect(result.quote).toHaveProperty('amountYMin');
      });
    });
  });

  describe('parseClosureReceipt', () => {
    // Helper: encode a FeesCollected event log
    function createFeesCollectedLog(positionId, vault, lbPair, amountX, amountY) {
      const iface = new ethers.utils.Interface([
        'event FeesCollected(uint256 indexed positionId, address indexed vault, address indexed lbPair, uint256 amountX, uint256 amountY)'
      ]);
      const topic0 = iface.getEventTopic('FeesCollected');
      const data = ethers.utils.defaultAbiCoder.encode(
        ['uint256', 'uint256'],
        [amountX, amountY]
      );
      return {
        address: lbPair,
        topics: [
          topic0,
          ethers.utils.hexZeroPad(ethers.BigNumber.from(positionId).toHexString(), 32),
          ethers.utils.hexZeroPad(vault, 32),
          ethers.utils.hexZeroPad(lbPair, 32),
        ],
        data,
      };
    }

    // Helper: encode a PositionRemoved event log
    function createPositionRemovedLog(positionId, vault, lbPair, percentage, amountX, amountY) {
      const iface = new ethers.utils.Interface([
        'event PositionRemoved(uint256 indexed positionId, address indexed vault, address indexed lbPair, uint256 percentage, uint256 amountX, uint256 amountY)'
      ]);
      const topic0 = iface.getEventTopic('PositionRemoved');
      const data = ethers.utils.defaultAbiCoder.encode(
        ['uint256', 'uint256', 'uint256'],
        [percentage, amountX, amountY]
      );
      return {
        address: lbPair,
        topics: [
          topic0,
          ethers.utils.hexZeroPad(ethers.BigNumber.from(positionId).toHexString(), 32),
          ethers.utils.hexZeroPad(vault, 32),
          ethers.utils.hexZeroPad(lbPair, 32),
        ],
        data,
      };
    }

    const VAULT_ADDR = '0x1111111111111111111111111111111111111111';
    const LB_PAIR_ADDR = '0x2222222222222222222222222222222222222222';

    describe('Validation', () => {
      it('should throw for null receipt', async () => {
        await expect(adapter.parseClosureReceipt(null, { '1': {} }))
          .rejects.toThrow('Receipt parameter is required');
      });

      it('should throw for undefined receipt', async () => {
        await expect(adapter.parseClosureReceipt(undefined, { '1': {} }))
          .rejects.toThrow('Receipt parameter is required');
      });

      it('should throw for receipt without logs', async () => {
        await expect(adapter.parseClosureReceipt({}, { '1': {} }))
          .rejects.toThrow('Receipt must have logs property');
      });

      it('should throw for null positionMetadata', async () => {
        await expect(adapter.parseClosureReceipt({ logs: [] }, null))
          .rejects.toThrow('Position metadata parameter is required');
      });

      it('should throw for array positionMetadata', async () => {
        await expect(adapter.parseClosureReceipt({ logs: [] }, []))
          .rejects.toThrow('Position metadata parameter is required');
      });
    });

    describe('Event parsing', () => {
      it('should parse FeesCollected + PositionRemoved into feesByPosition and principalByPosition', async () => {
        const metadata = { '1': { someField: 'value' } };
        const receipt = {
          logs: [
            createFeesCollectedLog(1, VAULT_ADDR, LB_PAIR_ADDR, '500000', '300000'),
            createPositionRemovedLog(1, VAULT_ADDR, LB_PAIR_ADDR, 100, '1000000000000000000', '2000000'),
          ],
        };

        const result = await adapter.parseClosureReceipt(receipt, metadata);

        expect(result.principalByPosition['1']).toBeDefined();
        expect(result.principalByPosition['1'].amount0.toString()).toBe('1000000000000000000');
        expect(result.principalByPosition['1'].amount1.toString()).toBe('2000000');

        expect(result.feesByPosition['1']).toBeDefined();
        expect(result.feesByPosition['1'].token0.toString()).toBe('500000');
        expect(result.feesByPosition['1'].token1.toString()).toBe('300000');
        expect(result.feesByPosition['1'].metadata).toEqual({ someField: 'value' });
      });

      it('should fill zero fees when no FeesCollected event exists', async () => {
        const metadata = { '1': { someField: 'value' } };
        const receipt = {
          logs: [
            createPositionRemovedLog(1, VAULT_ADDR, LB_PAIR_ADDR, 100, '1000000000000000000', '2000000'),
          ],
        };

        const result = await adapter.parseClosureReceipt(receipt, metadata);

        expect(result.principalByPosition['1']).toBeDefined();
        expect(result.feesByPosition['1']).toBeDefined();
        expect(result.feesByPosition['1'].token0.toString()).toBe('0');
        expect(result.feesByPosition['1'].token1.toString()).toBe('0');
        expect(result.feesByPosition['1'].metadata).toEqual({ someField: 'value' });
      });

      it('should handle multiple positions in one receipt', async () => {
        const metadata = { '1': { pair: 'A' }, '2': { pair: 'B' } };
        const receipt = {
          logs: [
            createFeesCollectedLog(1, VAULT_ADDR, LB_PAIR_ADDR, '100', '200'),
            createPositionRemovedLog(1, VAULT_ADDR, LB_PAIR_ADDR, 100, '1000', '2000'),
            createFeesCollectedLog(2, VAULT_ADDR, LB_PAIR_ADDR, '300', '400'),
            createPositionRemovedLog(2, VAULT_ADDR, LB_PAIR_ADDR, 100, '3000', '4000'),
          ],
        };

        const result = await adapter.parseClosureReceipt(receipt, metadata);

        expect(Object.keys(result.principalByPosition)).toHaveLength(2);
        expect(Object.keys(result.feesByPosition)).toHaveLength(2);

        expect(result.principalByPosition['1'].amount0.toString()).toBe('1000');
        expect(result.principalByPosition['2'].amount0.toString()).toBe('3000');
        expect(result.feesByPosition['1'].token0.toString()).toBe('100');
        expect(result.feesByPosition['2'].token0.toString()).toBe('300');
      });

      it('should ignore positions not in positionMetadata', async () => {
        const metadata = { '1': { pair: 'A' } };
        const receipt = {
          logs: [
            createFeesCollectedLog(1, VAULT_ADDR, LB_PAIR_ADDR, '100', '200'),
            createPositionRemovedLog(1, VAULT_ADDR, LB_PAIR_ADDR, 100, '1000', '2000'),
            createFeesCollectedLog(99, VAULT_ADDR, LB_PAIR_ADDR, '999', '999'),
            createPositionRemovedLog(99, VAULT_ADDR, LB_PAIR_ADDR, 100, '9999', '9999'),
          ],
        };

        const result = await adapter.parseClosureReceipt(receipt, metadata);

        expect(Object.keys(result.principalByPosition)).toHaveLength(1);
        expect(Object.keys(result.feesByPosition)).toHaveLength(1);
        expect(result.principalByPosition['99']).toBeUndefined();
      });

      it('should ignore unrelated logs without errors', async () => {
        const metadata = { '1': {} };
        const receipt = {
          logs: [
            {
              address: '0x3333333333333333333333333333333333333333',
              topics: [ethers.utils.id('Transfer(address,address,uint256)')],
              data: '0x',
            },
            createPositionRemovedLog(1, VAULT_ADDR, LB_PAIR_ADDR, 100, '1000', '2000'),
          ],
        };

        const result = await adapter.parseClosureReceipt(receipt, metadata);
        expect(result.principalByPosition['1']).toBeDefined();
      });

      it('should return empty objects for empty logs', async () => {
        const metadata = { '1': {} };
        const receipt = { logs: [] };

        const result = await adapter.parseClosureReceipt(receipt, metadata);
        expect(Object.keys(result.principalByPosition)).toHaveLength(0);
        expect(Object.keys(result.feesByPosition)).toHaveLength(0);
      });
    });
  });

  describe('parseCollectReceipt', () => {
    // Reuse the FeesCollected log helper
    function createFeesCollectedLog(positionId, vault, lbPair, amountX, amountY) {
      const iface = new ethers.utils.Interface([
        'event FeesCollected(uint256 indexed positionId, address indexed vault, address indexed lbPair, uint256 amountX, uint256 amountY)'
      ]);
      const topic0 = iface.getEventTopic('FeesCollected');
      const data = ethers.utils.defaultAbiCoder.encode(
        ['uint256', 'uint256'],
        [amountX, amountY]
      );
      return {
        address: lbPair,
        topics: [
          topic0,
          ethers.utils.hexZeroPad(ethers.BigNumber.from(positionId).toHexString(), 32),
          ethers.utils.hexZeroPad(vault, 32),
          ethers.utils.hexZeroPad(lbPair, 32),
        ],
        data,
      };
    }

    const VAULT_ADDR = '0x1111111111111111111111111111111111111111';
    const LB_PAIR_ADDR = '0x2222222222222222222222222222222222222222';

    describe('Validation', () => {
      it('should throw for null receipt', async () => {
        await expect(adapter.parseCollectReceipt(null, { '1': {} }))
          .rejects.toThrow('Receipt parameter is required');
      });

      it('should throw for undefined receipt', async () => {
        await expect(adapter.parseCollectReceipt(undefined, { '1': {} }))
          .rejects.toThrow('Receipt parameter is required');
      });

      it('should throw for receipt without logs', async () => {
        await expect(adapter.parseCollectReceipt({}, { '1': {} }))
          .rejects.toThrow('Receipt must have logs property');
      });

      it('should throw for null positionMetadata', async () => {
        await expect(adapter.parseCollectReceipt({ logs: [] }, null))
          .rejects.toThrow('Position metadata parameter is required');
      });

      it('should throw for array positionMetadata', async () => {
        await expect(adapter.parseCollectReceipt({ logs: [] }, []))
          .rejects.toThrow('Position metadata parameter is required');
      });
    });

    describe('Event parsing', () => {
      it('should parse FeesCollected into feesByPosition', async () => {
        const metadata = { '1': { someField: 'value' } };
        const receipt = {
          logs: [
            createFeesCollectedLog(1, VAULT_ADDR, LB_PAIR_ADDR, '500000', '300000'),
          ],
        };

        const result = await adapter.parseCollectReceipt(receipt, metadata);

        expect(result.feesByPosition['1']).toBeDefined();
        expect(result.feesByPosition['1'].token0.toString()).toBe('500000');
        expect(result.feesByPosition['1'].token1.toString()).toBe('300000');
        expect(result.feesByPosition['1'].metadata).toEqual({ someField: 'value' });
      });

      it('should handle multiple positions', async () => {
        const metadata = { '1': { pair: 'A' }, '2': { pair: 'B' } };
        const receipt = {
          logs: [
            createFeesCollectedLog(1, VAULT_ADDR, LB_PAIR_ADDR, '100', '200'),
            createFeesCollectedLog(2, VAULT_ADDR, LB_PAIR_ADDR, '300', '400'),
          ],
        };

        const result = await adapter.parseCollectReceipt(receipt, metadata);

        expect(Object.keys(result.feesByPosition)).toHaveLength(2);
        expect(result.feesByPosition['1'].token0.toString()).toBe('100');
        expect(result.feesByPosition['2'].token0.toString()).toBe('300');
      });

      it('should ignore positions not in positionMetadata', async () => {
        const metadata = { '1': {} };
        const receipt = {
          logs: [
            createFeesCollectedLog(1, VAULT_ADDR, LB_PAIR_ADDR, '100', '200'),
            createFeesCollectedLog(99, VAULT_ADDR, LB_PAIR_ADDR, '999', '999'),
          ],
        };

        const result = await adapter.parseCollectReceipt(receipt, metadata);
        expect(Object.keys(result.feesByPosition)).toHaveLength(1);
        expect(result.feesByPosition['99']).toBeUndefined();
      });

      it('should return empty feesByPosition for empty logs', async () => {
        const metadata = { '1': {} };
        const receipt = { logs: [] };

        const result = await adapter.parseCollectReceipt(receipt, metadata);
        expect(Object.keys(result.feesByPosition)).toHaveLength(0);
      });

      it('should ignore unrelated logs without errors', async () => {
        const metadata = { '1': {} };
        const receipt = {
          logs: [
            {
              address: '0x3333333333333333333333333333333333333333',
              topics: [ethers.utils.id('Transfer(address,address,uint256)')],
              data: '0x',
            },
            createFeesCollectedLog(1, VAULT_ADDR, LB_PAIR_ADDR, '100', '200'),
          ],
        };

        const result = await adapter.parseCollectReceipt(receipt, metadata);
        expect(result.feesByPosition['1']).toBeDefined();
      });
    });
  });
});
