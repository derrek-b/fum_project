import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ethers } from 'ethers';
import TraderJoeV2_1Adapter from '../../../src/adapters/TraderJoeV2_1Adapter.js';
import PlatformAdapter from '../../../src/adapters/PlatformAdapter.js';
import { setupTraderJoeTestEnvironment } from '../../setup/traderjoe-setup.js';
import tokens from '../../../src/configs/tokens.js';
import contractData from '../../../src/artifacts/contracts.js';
import ERC20_ARTIFACT from '@openzeppelin/contracts/build/contracts/ERC20.json' with { type: 'json' };

const ERC20_ABI = ERC20_ARTIFACT.abi;

describe('TraderJoeV2_1Adapter', () => {
  let adapter;
  let env;

  // Shared state for E2E tests
  let testVault;
  let weth, usdc;
  let wethAddress, usdcAddress;

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

    // Get token addresses
    wethAddress = tokens.ETH.wethAddresses[1337];
    usdcAddress = tokens.USDC.addresses[1337];

    // Wrap ETH to WETH
    const WETH_ABI = ['function deposit() payable', ...ERC20_ABI];
    weth = new ethers.Contract(wethAddress, WETH_ABI, owner);
    usdc = new ethers.Contract(usdcAddress, ERC20_ABI, owner);

    await (await weth.deposit({ value: ethers.utils.parseEther('5') })).wait();

    // Swap some WETH for USDC via Uniswap V3 router (it's on the fork)
    const uniV3Router = '0xE592427A0AEce92De3Edee1F18E0157C05861564';
    await (await weth.approve(uniV3Router, ethers.utils.parseEther('2'))).wait();

    const swapRouterABI = [
      'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external payable returns (uint256 amountOut)'
    ];
    const swapRouter = new ethers.Contract(uniV3Router, swapRouterABI, owner);
    await (await swapRouter.exactInputSingle({
      tokenIn: wethAddress,
      tokenOut: usdcAddress,
      fee: 500,
      recipient: owner.address,
      deadline: Math.floor(Date.now() / 1000) + 3600,
      amountIn: ethers.utils.parseEther('2'),
      amountOutMinimum: 0,
      sqrtPriceLimitX96: 0,
    })).wait();

    // Transfer WETH and USDC to vault
    const wethBal = await weth.balanceOf(owner.address);
    const usdcBal = await usdc.balanceOf(owner.address);
    await (await weth.transfer(vaultAddress, wethBal)).wait();
    await (await usdc.transfer(vaultAddress, usdcBal)).wait();

    console.log(`  Vault funded: ${ethers.utils.formatEther(wethBal)} WETH, ${ethers.utils.formatUnits(usdcBal, 6)} USDC`);
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
      expect(adapter.platformId).toBe('traderjoeV2_1');
    });

    it('should set correct platformName', () => {
      expect(adapter.platformName).toBe('Trader Joe V2.1');
    });

    it('should set correct chainId', () => {
      expect(adapter.chainId).toBe(env.chainId); // 1337 for Hardhat fork
    });

    it('should load platform addresses', () => {
      // Addresses are same for 1337 and 42161 (fork uses Arbitrum addresses)
      expect(adapter.addresses).toBeDefined();
      expect(adapter.addresses.lbFactoryAddress).toBe('0x8e42f2F4101563bF679975178e880FD87d3eFd4e');
      expect(adapter.addresses.lbRouterAddress).toBe('0xb4315e873dBcf96Ffd0acd8EA43f689D8c20fB30');
      expect(adapter.addresses.lbQuoterAddress).toBe('0xd76019A16606FDa4651f636D9751f500Ed776250');
    });

    it('should load chain config', () => {
      expect(adapter.chainConfig).toBeDefined();
      expect(adapter.chainConfig.name).toBe('Forked Arbitrum'); // 1337 config
    });
  });

  describe('sortTokens', () => {
    // Real Arbitrum token addresses for realistic testing
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

  describe('Stub methods', () => {
    it('should throw "not implemented" for getSwapEventFilter', () => {
      expect(() => adapter.getSwapEventFilter('0x123'))
        .toThrow('TraderJoeV2_1Adapter.getSwapEventFilter not implemented');
    });
  });

  describe('getPositionRange', () => {
    describe('Success Cases', () => {
      it('should calculate bin range for symmetric percentages', () => {
        const poolData = { activeId: 8388608, binStep: 20 }; // binStep=20 → 0.20% per bin
        const result = adapter.getPositionRange(poolData, 5, 5);

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
        const narrow = adapter.getPositionRange(poolData, 5, 5);
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
      it('should return activeId from pool data', () => {
        const poolData = { activeId: 8388608, binStep: 20, reserveX: '1000', reserveY: '2000' };
        expect(adapter.getPoolCurrent(poolData)).toBe(8388608);
      });

      it('should work with activeId at zero', () => {
        expect(adapter.getPoolCurrent({ activeId: 0 })).toBe(0);
      });

      it('should work with high activeId values', () => {
        // Trader Joe bin IDs can be large (uint24 range, up to 16777215)
        expect(adapter.getPoolCurrent({ activeId: 16777215 })).toBe(16777215);
      });

      it('should work with low activeId values', () => {
        expect(adapter.getPoolCurrent({ activeId: 1 })).toBe(1);
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
        expect(() => adapter.getPoolCurrent({}))
          .toThrow('Pool data must have activeId property');
      });

      it('should throw if poolData has no activeId (other fields present)', () => {
        expect(() => adapter.getPoolCurrent({ binStep: 20, reserveX: '1000' }))
          .toThrow('Pool data must have activeId property');
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
        expect(result.currentTick).toBe(8388600);
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
          const poolResult = await adapter.selectBestPool('WETH', 'USDC', env.provider, env.chainId);
          poolAddress = poolResult.bestPool.address;
        } catch (error) {
          if (error.message.includes('No pools found') || error.message.includes('No active pools')) {
            console.log('No Trader Joe V2.1 WETH/USDC pools - skipping blockchain test');
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
        expect(typeof result.currentTick).toBe('number');
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
        await expect(adapter.selectBestPool('WETH', null, mockProvider, env.chainId))
          .rejects.toThrow('tokenBSymbol parameter is required and must be a string');

        await expect(adapter.selectBestPool('WETH', undefined, mockProvider, env.chainId))
          .rejects.toThrow('tokenBSymbol parameter is required and must be a string');

        await expect(adapter.selectBestPool('WETH', '', mockProvider, env.chainId))
          .rejects.toThrow('tokenBSymbol parameter is required and must be a string');

        await expect(adapter.selectBestPool('WETH', 123, mockProvider, env.chainId))
          .rejects.toThrow('tokenBSymbol parameter is required and must be a string');
      });

      it('should throw error for invalid provider values', async () => {
        await expect(adapter.selectBestPool('WETH', 'USDC', null, env.chainId))
          .rejects.toThrow('provider parameter is required and must be an ethers provider instance');

        await expect(adapter.selectBestPool('WETH', 'USDC', undefined, env.chainId))
          .rejects.toThrow('provider parameter is required and must be an ethers provider instance');

        await expect(adapter.selectBestPool('WETH', 'USDC', {}, env.chainId))
          .rejects.toThrow('provider parameter is required and must be an ethers provider instance');

        await expect(adapter.selectBestPool('WETH', 'USDC', 'not-a-provider', env.chainId))
          .rejects.toThrow('provider parameter is required and must be an ethers provider instance');
      });

      it('should throw error for invalid chainId values', async () => {
        await expect(adapter.selectBestPool('WETH', 'USDC', mockProvider, null))
          .rejects.toThrow('chainId parameter is required and must be a number');

        await expect(adapter.selectBestPool('WETH', 'USDC', mockProvider, undefined))
          .rejects.toThrow('chainId parameter is required and must be a number');

        await expect(adapter.selectBestPool('WETH', 'USDC', mockProvider, '42161'))
          .rejects.toThrow('chainId parameter is required and must be a number');
      });

      it('should throw error for unknown token symbols', async () => {
        await expect(adapter.selectBestPool('UNKNOWN_TOKEN', 'USDC', mockProvider, env.chainId))
          .rejects.toThrow('Token UNKNOWN_TOKEN not found');

        await expect(adapter.selectBestPool('WETH', 'UNKNOWN_TOKEN', mockProvider, env.chainId))
          .rejects.toThrow('Token UNKNOWN_TOKEN not found');
      });
    });

    describe('Success Cases', () => {
      // Note: These tests use Hardhat fork of Arbitrum
      // Trader Joe V2.1 has active pools on Arbitrum

      it('should search for WETH/USDC pools on Arbitrum', async () => {
        try {
          const result = await adapter.selectBestPool('WETH', 'USDC', env.provider, env.chainId);

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
          expect(result.bestPool.tokenX).toHaveProperty('id');
          expect(result.bestPool.tokenX).toHaveProperty('symbol');
          expect(result.bestPool.tokenX).toHaveProperty('decimals');
          expect(result.bestPool.tokenY).toHaveProperty('id');
          expect(result.bestPool.tokenY).toHaveProperty('symbol');
          expect(result.bestPool.tokenY).toHaveProperty('decimals');
        } catch (error) {
          if (error.message.includes('No pools found') || error.message.includes('No active pools')) {
            console.log('No Trader Joe V2.1 WETH/USDC pools exist on Arbitrum');
            return;
          }
          throw error;
        }
      }, 30000);

      it('should handle ETH as native token (converts to WETH)', async () => {
        try {
          const result = await adapter.selectBestPool('ETH', 'USDC', env.provider, env.chainId);

          expect(result).toHaveProperty('bestPool');
          expect(result).toHaveProperty('poolsDiscovered');
          expect(result).toHaveProperty('poolsActive');
        } catch (error) {
          if (error.message.includes('No pools found') || error.message.includes('No active pools')) {
            console.log('No Trader Joe V2.1 ETH/USDC pools exist on Arbitrum');
            return;
          }
          throw error;
        }
      }, 30000);

      it('should sort tokens correctly regardless of input order', async () => {
        try {
          // Try both orderings - should get same result
          const resultAB = await adapter.selectBestPool('WETH', 'USDC', env.provider, env.chainId);
          const resultBA = await adapter.selectBestPool('USDC', 'WETH', env.provider, env.chainId);

          // Should find the same pools regardless of order
          expect(resultAB.poolsDiscovered).toBe(resultBA.poolsDiscovered);
          expect(resultAB.bestPool.address).toBe(resultBA.bestPool.address);
        } catch (error) {
          if (error.message.includes('No pools found') || error.message.includes('No active pools')) {
            console.log('No Trader Joe V2.1 pools exist for token pair');
            return;
          }
          throw error;
        }
      }, 60000); // 60s for two on-chain queries
    });

    describe('Error Cases', () => {
      it('should throw when token is not available on chain', async () => {
        await expect(adapter.selectBestPool('WETH', 'USDC', mockProvider, 999999))
          .rejects.toThrow(/not available on chain/);
      });
    });
  });

  describe('getPoolData', () => {
    // Note: These tests use real API calls to Arbitrum
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
          const result = await adapter.selectBestPool('WETH', 'USDC', env.provider, env.chainId);
          poolAddress = result.bestPool.address;
        } catch (error) {
          if (error.message.includes('No pools found') || error.message.includes('No active pools')) {
            console.log('No Trader Joe V2.1 WETH/USDC pools exist - skipping getPoolData test');
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
    // Real Arbitrum token addresses
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
        const adapterNoPM = new TraderJoeV2_1Adapter(1337, env.provider);
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
          poolResult = await adapter.selectBestPool('WETH', 'USDC', env.provider, env.chainId);
          poolData = await adapter.getPoolData(poolResult.bestPool.address, env.provider);
          positionRange = adapter.getPositionRange(poolData, 5, 5);
        } catch (error) {
          if (error.message.includes('No pools found') || error.message.includes('No active pools')) {
            console.log('No Trader Joe V2.1 WETH/USDC pools - skipping');
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
          const poolResult = await adapter.selectBestPool('WETH', 'USDC', env.provider, env.chainId);
          poolData = await adapter.getPoolData(poolResult.bestPool.address, env.provider);
          positionRange = adapter.getPositionRange(poolData, 5, 5);
        } catch (error) {
          if (error.message.includes('No pools found') || error.message.includes('No active pools')) {
            console.log('No Trader Joe V2.1 WETH/USDC pools - skipping E2E test');
            return;
          }
          throw error;
        }

        const vaultAddress = testVault.address;
        const pmAddress = adapter.addresses.positionManagerAddress;

        // 2. Get vault token balances
        const vaultWethBal = await weth.balanceOf(vaultAddress);
        const vaultUsdcBal = await usdc.balanceOf(vaultAddress);
        console.log(`  Vault balances: ${ethers.utils.formatEther(vaultWethBal)} WETH, ${ethers.utils.formatUnits(vaultUsdcBal, 6)} USDC`);

        // Use 10% of vault balances
        const wethAmount = vaultWethBal.div(10);
        const usdcAmount = vaultUsdcBal.div(10);

        // 3. Get required approvals and execute via vault.approve()
        const approvalTxs = await adapter.getRequiredApprovals(
          'liquidity', vaultAddress, [wethAddress, usdcAddress], env.provider
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
          token0Amount: wethAmount.toString(),
          token1Amount: usdcAmount.toString(),
          provider: env.provider,
          walletAddress: vaultAddress,
          poolData,
          token0Data: { address: wethAddress, symbol: 'WETH', decimals: 18 },
          token1Data: { address: usdcAddress, symbol: 'USDC', decimals: 6 },
          slippageTolerance: 5,
          deadlineMinutes: 10,
        });

        expect(txData.to).toBe(pmAddress);

        // 5. Execute vault.mint() with the calldata
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
        const testAdapter = new TraderJoeV2_1Adapter(1337, env.provider);
        testAdapter.addresses.positionManagerAddress = '';
        await expect(testAdapter.getRequiredApprovals('liquidity', '0x0000000000000000000000000000000000000001', ['0x0000000000000000000000000000000000000002'], env.provider))
          .rejects.toThrow('no spender address found');
      });
    });

    describe('Success Cases', () => {
      it('should return approval transactions for tokens with no allowance', async () => {
        const pmAddress = adapter.addresses.positionManagerAddress;

        // Use real token addresses on Arbitrum fork - they will have zero allowance
        // for a random vault address
        const vaultAddress = '0x0000000000000000000000000000000000000001';
        const tokenAddresses = [
          '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', // WETH
          '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', // USDC
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

      it('should skip native ETH (address zero)', async () => {
        const vaultAddress = '0x0000000000000000000000000000000000000001';
        const tokenAddresses = [
          ethers.constants.AddressZero, // Native ETH - should be skipped
          '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', // WETH
        ];

        const txs = await adapter.getRequiredApprovals('liquidity', vaultAddress, tokenAddresses, env.provider);

        // Only 1 tx (WETH), native ETH skipped
        expect(txs.length).toBe(1);
        expect(txs[0].to).toBe('0x82aF49447D8a07e3bd95BD0d56f35241523fBab1');
      }, 30000);

      it('should use lbRouterAddress as spender for swap operations', async () => {
        const vaultAddress = '0x0000000000000000000000000000000000000001';
        const tokenAddresses = [
          '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', // WETH
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
});
