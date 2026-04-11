/**
 * @fileoverview Gas profiling test for Uniswap V4 operations across varying tick widths
 *
 * Measures gas consumption for approvals, create, add liquidity (increase existing),
 * collect fees, and close (decreaseLiquidity) operations at different tick range widths.
 * V4 positions are single NFTs so gas should be roughly constant regardless of range
 * width (unlike TJ where gas scales per-bin). This test confirms that assumption and
 * establishes baseline gas costs.
 *
 * V4 uses native ETH (AddressZero) and Permit2 approval flow.
 *
 * Uses direct vault + adapter calls (no AutomationService overhead) for clean gas measurements.
 *
 * Run with: npx vitest run test/workflow/v4/gas-profiling.test.js
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ethers } from 'ethers';
import { UniswapV4Adapter } from 'fum_library/adapters';
import { getChainConfig, getTokenAddress, getTokenBySymbol } from 'fum_library';
import { setupTestBlockchain, cleanupTestBlockchain } from '../../helpers/hardhat-setup.js';
import { setupV4TestVault } from '../../helpers/v4-vault-setup.js';
import { setupV4SwapWallet, executeV4PoolSwap } from '../../helpers/v4-swap-utils.js';

const TICK_WIDTHS = [10, 50]; // ± tick spacings from current tick
const FEE = 500; // 0.05% fee tier
const TICK_SPACING = 10;
const NATIVE_ETH = ethers.constants.AddressZero;

// Accumulate results for summary table
const gasResults = [];
let approvalGas = null;

describe('Uniswap V4 Gas Profiling — Tick Width Scaling', () => {
  let testEnv;
  let testVault;
  let adapter;
  let provider;
  let vaultContract;
  let vaultAddress;
  let usdcAddress;
  let sortedToken0Address; // AddressZero (ETH) is always < any address
  let sortedToken1Address;
  let sortedToken0Data;
  let sortedToken1Data;
  let poolKey;
  let swapWallet;

  const ERC20_ABI = [
    'function balanceOf(address account) view returns (uint256)',
    'function approve(address spender, uint256 amount) returns (bool)',
    'function decimals() view returns (uint8)'
  ];

  beforeAll(async () => {
    testEnv = await setupTestBlockchain();
    provider = testEnv.hardhatServer.provider;

    usdcAddress = getTokenAddress('USDC', 1337);

    // Create vault with tokens but NO positions
    testVault = await setupV4TestVault(
      testEnv.hardhatServer,
      testEnv.contracts,
      testEnv.deployedContracts,
      {
        vaultName: 'V4 Gas Profiling Vault',
        nativeEthAmount: '10',
        swapTokens: [
          { from: 'ETH', to: 'USDC', amount: '3' }
        ],
        positions: [],
        tokenTransfers: { 'USDC': 80 },
        nativeEthToVault: '5',
        targetTokens: ['USDC', 'ETH'],
        targetPlatforms: ['uniswapV4'],
        strategy: 'bob'
      }
    );

    vaultContract = testVault.vault;
    vaultAddress = testVault.vaultAddress;
    adapter = new UniswapV4Adapter(1337, provider);

    // V4: ETH (AddressZero) is always token0 (lower address)
    sortedToken0Address = NATIVE_ETH;
    sortedToken1Address = usdcAddress;
    sortedToken0Data = { address: NATIVE_ETH, symbol: 'ETH', decimals: 18 };
    sortedToken1Data = { address: usdcAddress, ...getTokenBySymbol('USDC') };

    // Build poolKey
    poolKey = {
      currency0: NATIVE_ETH,
      currency1: usdcAddress,
      fee: FEE,
      tickSpacing: TICK_SPACING,
      hooks: ethers.constants.AddressZero
    };

    // Setup swap wallet for fee generation
    swapWallet = await setupV4SwapWallet(testEnv, {
      ethAmount: '100',
      usdcAmount: '30'
    });

    console.log(`\nV4 Gas Profiling Setup:`);
    console.log(`  Vault: ${vaultAddress}`);
    console.log(`  Pool: ETH/USDC, fee=${FEE}, tickSpacing=${TICK_SPACING}`);
    console.log(`  Tick widths to test: ±${TICK_WIDTHS.join(', ±')} spacings\n`);
  });

  afterAll(async () => {
    // Print summary table
    if (gasResults.length > 0) {
      const fmt = (n) => Number(n).toLocaleString();

      console.log(`\n${'='.repeat(85)}`);
      console.log(`Uniswap V4 Gas Profiling Results (ETH/USDC, fee=${FEE})`);
      console.log(`${'='.repeat(85)}`);

      if (approvalGas !== null) {
        console.log(`Approvals (one-time): ${fmt(approvalGas)} gas`);
        console.log(`${'-'.repeat(85)}`);
      }

      console.log(`${'Width'.padStart(8)} | ${'Create'.padStart(12)} | ${'Add Liq'.padStart(12)} | ${'Collect Fees'.padStart(14)} | ${'Close'.padStart(12)} | ${'Total'.padStart(12)}`);
      console.log(`${'-'.repeat(8)} | ${'-'.repeat(12)} | ${'-'.repeat(12)} | ${'-'.repeat(14)} | ${'-'.repeat(12)} | ${'-'.repeat(12)}`);

      for (const r of gasResults) {
        const total = (r.create || 0) + (r.collect || 0) + (r.close || 0);
        console.log(
          `${`±${r.width}`.padStart(8)} | ` +
          `${(r.create ? fmt(r.create) : 'N/A').padStart(12)} | ` +
          `${(r.addLiquidity ? fmt(r.addLiquidity) : 'N/A').padStart(12)} | ` +
          `${(r.collect ? fmt(r.collect) : 'N/A').padStart(14)} | ` +
          `${(r.close ? fmt(r.close) : 'N/A').padStart(12)} | ` +
          `${(total ? fmt(total) : 'N/A').padStart(12)}`
        );
      }

      console.log(`${'='.repeat(85)}\n`);
    }

    await cleanupTestBlockchain(testEnv);
  });

  it('should measure approval gas (one-time)', async () => {
    // V4 Permit2 flow: ERC20→Permit2 + Permit2→PositionManager (only for USDC, ETH is native)
    const approvalTxs = await adapter.getRequiredApprovals(
      'liquidity', vaultAddress, [usdcAddress], provider
    );
    expect(approvalTxs.length).toBeGreaterThan(0);

    const approveTx = await vaultContract.approve(
      approvalTxs.map(t => t.to),
      approvalTxs.map(t => t.data)
    );
    const approveReceipt = await approveTx.wait();
    approvalGas = approveReceipt.gasUsed.toNumber();

    console.log(`  Approvals: ${approvalGas.toLocaleString()} gas (${approvalTxs.length} approval txs — Permit2 flow)`);
    expect(approvalGas).toBeGreaterThan(0);
  });

  for (const tickWidth of TICK_WIDTHS) {
    describe(`±${tickWidth} tick spacings`, () => {
      let tokenId;
      let tickLower;
      let tickUpper;
      let positionLiquidity;
      let positionPoolId;
      const result = { width: tickWidth, create: null, addLiquidity: null, collect: null, close: null };

      // Push result ref now so ordering is preserved even if tests fail
      gasResults.push(result);

      it('should create position and measure gas', async () => {
        // Fetch pool data
        const poolData = await adapter.fetchPoolDataForTesting(
          NATIVE_ETH, usdcAddress, FEE, TICK_SPACING, ethers.constants.AddressZero, provider
        );
        const currentTick = poolData.tick;

        // Calculate centered tick range
        tickLower = Math.floor(currentTick / TICK_SPACING) * TICK_SPACING - TICK_SPACING * tickWidth;
        tickUpper = Math.floor(currentTick / TICK_SPACING) * TICK_SPACING + TICK_SPACING * tickWidth;

        // Get vault balances — use fraction per iteration
        const usdcContract = new ethers.Contract(usdcAddress, ERC20_ABI, provider);
        const usdcBalance = await usdcContract.balanceOf(vaultAddress);
        const ethBalance = await provider.getBalance(vaultAddress);

        // Use 20% per position (need room for add liquidity too)
        const token0Amount = ethBalance.mul(20).div(100).toString(); // ETH
        const token1Amount = usdcBalance.mul(20).div(100).toString(); // USDC

        // Generate create position calldata
        const createData = await adapter.generateCreatePositionData({
          position: { tickLower, tickUpper },
          token0Amount,
          token1Amount,
          provider,
          walletAddress: vaultAddress,
          poolKey,
          poolData,
          token0Data: sortedToken0Data,
          token1Data: sortedToken1Data,
          slippageTolerance: 5,
          deadlineMinutes: 5
        });

        // Execute through vault (value includes native ETH for position)
        const mintTx = await vaultContract.mint(
          [createData.to],
          [createData.data],
          [createData.value]
        );
        const mintReceipt = await mintTx.wait();
        result.create = mintReceipt.gasUsed.toNumber();

        // Extract tokenId using adapter's receipt parser
        const mintResult = adapter.parseIncreaseLiquidityReceipt(mintReceipt, {
          position: { tickLower, tickUpper },
          poolData
        });
        tokenId = mintResult.tokenId;
        expect(tokenId).toBeDefined();

        // Fetch position data to get liquidity and poolId (needed for collect and close)
        const posResult = await adapter.getPositionById(tokenId, provider);
        positionLiquidity = posResult.position.liquidity;
        // Store poolId for fee collection (V4 needs position.pool)
        positionPoolId = posResult.position.pool;

        console.log(`  [±${tickWidth}] Create: ${result.create.toLocaleString()} gas (tokenId: ${tokenId}, ticks: ${tickLower}→${tickUpper})`);
        expect(result.create).toBeGreaterThan(0);
      });

      it('should add liquidity to existing position and measure gas', async () => {
        expect(tokenId).toBeDefined();

        // Get fresh pool data and vault balances
        const poolData = await adapter.fetchPoolDataForTesting(
          NATIVE_ETH, usdcAddress, FEE, TICK_SPACING, ethers.constants.AddressZero, provider
        );
        const usdcContract = new ethers.Contract(usdcAddress, ERC20_ABI, provider);
        const usdcBalance = await usdcContract.balanceOf(vaultAddress);
        const ethBalance = await provider.getBalance(vaultAddress);

        // Use 10% of remaining balance for add liquidity
        const token0Amount = ethBalance.mul(10).div(100).toString(); // ETH
        const token1Amount = usdcBalance.mul(10).div(100).toString(); // USDC

        const addData = await adapter.generateAddLiquidityData({
          position: { id: tokenId, tickLower, tickUpper },
          token0Amount,
          token1Amount,
          provider,
          poolData: { ...poolData, poolKey },
          token0Data: sortedToken0Data,
          token1Data: sortedToken1Data,
          slippageTolerance: 5,
          deadlineMinutes: 5
        });

        const addTx = await vaultContract.increaseLiquidity(
          [addData.to],
          [addData.data],
          [addData.value]
        );
        const addReceipt = await addTx.wait();
        result.addLiquidity = addReceipt.gasUsed.toNumber();

        // Update liquidity for close
        const posResult = await adapter.getPositionById(tokenId, provider);
        positionLiquidity = posResult.position.liquidity;
        positionPoolId = posResult.position.pool;

        console.log(`  [±${tickWidth}] Add liquidity: ${result.addLiquidity.toLocaleString()} gas`);
        expect(result.addLiquidity).toBeGreaterThan(0);
      });

      it('should generate fees, collect, and measure gas', async () => {
        expect(tokenId).toBeDefined();

        // Execute round-trip swaps to generate fees through V4 pool
        const swapAmount = ethers.utils.parseEther('5');

        // ETH → USDC
        await executeV4PoolSwap(testEnv, {
          tokenIn: NATIVE_ETH,
          tokenOut: usdcAddress,
          amountIn: swapAmount,
          fee: FEE,
          tickSpacing: TICK_SPACING,
          wallet: swapWallet.wallet
        });

        // USDC → ETH (swap back using USDC balance)
        const usdcContract = new ethers.Contract(usdcAddress, ERC20_ABI, provider);
        const usdcBal = await usdcContract.balanceOf(swapWallet.wallet.address);
        if (usdcBal.gt(0)) {
          await executeV4PoolSwap(testEnv, {
            tokenIn: usdcAddress,
            tokenOut: NATIVE_ETH,
            amountIn: usdcBal,
            fee: FEE,
            tickSpacing: TICK_SPACING,
            wallet: swapWallet.wallet
          });
        }

        // Fetch fresh pool data for collect
        const poolData = await adapter.fetchPoolDataForTesting(
          NATIVE_ETH, usdcAddress, FEE, TICK_SPACING, ethers.constants.AddressZero, provider
        );

        // Collect fees through vault
        // V4 needs position.pool (poolId) and poolData.poolKey
        const collectData = await adapter.generateClaimFeesData({
          position: { id: tokenId, tickLower, tickUpper, pool: positionPoolId },
          walletAddress: vaultAddress,
          poolData: { ...poolData, poolKey },
          provider
        });

        if (collectData) {
          const collectTx = await vaultContract.collect(
            [collectData.to],
            [collectData.data]
          );
          const collectReceipt = await collectTx.wait();
          result.collect = collectReceipt.gasUsed.toNumber();
          console.log(`  [±${tickWidth}] Collect fees: ${result.collect.toLocaleString()} gas`);
        } else {
          console.log(`  [±${tickWidth}] Collect fees: no fees to collect`);
        }
      });

      it('should close position (100% remove) and measure gas', async () => {
        expect(tokenId).toBeDefined();

        // Fetch fresh pool data
        const poolData = await adapter.fetchPoolDataForTesting(
          NATIVE_ETH, usdcAddress, FEE, TICK_SPACING, ethers.constants.AddressZero, provider
        );

        const closeData = await adapter.generateRemoveLiquidityData({
          position: {
            id: tokenId,
            tickLower,
            tickUpper,
            liquidity: positionLiquidity
          },
          percentage: 100,
          provider,
          walletAddress: vaultAddress,
          poolData: { ...poolData, poolKey },
          slippageTolerance: 5,
          deadlineMinutes: 5
        });

        const closeTx = await vaultContract.decreaseLiquidity(
          [closeData.to],
          [closeData.data]
        );
        const closeReceipt = await closeTx.wait();
        result.close = closeReceipt.gasUsed.toNumber();

        console.log(`  [±${tickWidth}] Close: ${result.close.toLocaleString()} gas`);
        expect(result.close).toBeGreaterThan(0);
      });
    });
  }
});
