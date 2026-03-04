/**
 * @fileoverview Gas profiling test for Uniswap V3 operations across varying tick widths
 *
 * Measures gas consumption for approvals, create, add liquidity (increase existing),
 * collect fees, and close (decreaseLiquidity) operations at different tick range widths.
 * V3 positions are single NFTs so gas should be roughly constant regardless of range
 * width (unlike TJ where gas scales per-bin). This test confirms that assumption and
 * establishes baseline gas costs.
 *
 * Uses direct vault + adapter calls (no AutomationService overhead) for clean gas measurements.
 *
 * Run with: npx vitest run test/workflow/v3-gas-profiling.test.js
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ethers } from 'ethers';
import { UniswapV3Adapter } from 'fum_library/adapters';
import { getChainConfig, getTokenAddress, getTokenBySymbol } from 'fum_library';
import { getWrappedNativeAddress } from 'fum_library/helpers/tokenHelpers';
import { setupTestBlockchain, cleanupTestBlockchain } from '../helpers/hardhat-setup.js';
import { setupTestVault } from '../helpers/test-vault-setup.js';
import { setupSwapWallet, executeSwap } from '../helpers/swap-utils.js';

const TICK_WIDTHS = [10, 50]; // ± tick spacings from current tick
const FEE = 500; // 0.05% fee tier
const TICK_SPACING = 10; // tickSpacing for fee=500

// Accumulate results for summary table
const gasResults = [];
let approvalGas = null;

describe('Uniswap V3 Gas Profiling — Tick Width Scaling', () => {
  let testEnv;
  let testVault;
  let adapter;
  let provider;
  let vaultContract;
  let vaultAddress;
  let wethAddress;
  let usdcAddress;
  let sortedToken0Address;
  let sortedToken1Address;
  let sortedToken0Data;
  let sortedToken1Data;
  let swapWallet;

  const ERC20_ABI = [
    'function balanceOf(address account) view returns (uint256)',
    'function approve(address spender, uint256 amount) returns (bool)',
    'function decimals() view returns (uint8)'
  ];

  beforeAll(async () => {
    testEnv = await setupTestBlockchain();
    provider = testEnv.hardhatServer.provider;

    // Create vault with tokens but NO positions
    testVault = await setupTestVault(
      testEnv.hardhatServer,
      testEnv.contracts,
      testEnv.deployedContracts,
      {
        vaultName: 'V3 Gas Profiling Vault',
        wrapEthAmount: '10',
        swapTokens: [
          { from: 'WETH', to: 'USDC', amount: '2' }
        ],
        positions: [],
        tokenTransfers: { 'WETH': 80, 'USDC': 80 },
        targetTokens: ['USDC', 'WETH'],
        targetPlatforms: ['uniswapV3'],
        strategy: 'bob'
      }
    );

    vaultContract = testVault.vault;
    vaultAddress = testVault.vaultAddress;
    adapter = new UniswapV3Adapter(1337);

    wethAddress = getWrappedNativeAddress(1337);
    usdcAddress = getTokenAddress('USDC', 1337);

    // Sort tokens to Uniswap canonical order (lower address first)
    if (wethAddress.toLowerCase() < usdcAddress.toLowerCase()) {
      sortedToken0Address = wethAddress;
      sortedToken1Address = usdcAddress;
      sortedToken0Data = { address: wethAddress, symbol: 'WETH', decimals: 18 };
      sortedToken1Data = { address: usdcAddress, ...getTokenBySymbol('USDC') };
    } else {
      sortedToken0Address = usdcAddress;
      sortedToken1Address = wethAddress;
      sortedToken0Data = { address: usdcAddress, ...getTokenBySymbol('USDC') };
      sortedToken1Data = { address: wethAddress, symbol: 'WETH', decimals: 18 };
    }

    // Setup swap wallet for fee generation
    swapWallet = await setupSwapWallet(testEnv, {
      ethAmount: '100',
      wethAmount: '80',
      usdcAmount: '30'
    });

    console.log(`\nV3 Gas Profiling Setup:`);
    console.log(`  Vault: ${vaultAddress}`);
    console.log(`  Pool: ${sortedToken0Data.symbol}/${sortedToken1Data.symbol}, fee=${FEE}`);
    console.log(`  Tick widths to test: ±${TICK_WIDTHS.join(', ±')} spacings\n`);
  }, 180000);

  afterAll(async () => {
    // Print summary table
    if (gasResults.length > 0) {
      const fmt = (n) => Number(n).toLocaleString();

      console.log(`\n${'='.repeat(85)}`);
      console.log(`Uniswap V3 Gas Profiling Results (${sortedToken0Data.symbol}/${sortedToken1Data.symbol}, fee=${FEE})`);
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
    const approvalTxs = await adapter.getRequiredApprovals(
      'liquidity', vaultAddress, [sortedToken0Address, sortedToken1Address], provider
    );
    expect(approvalTxs.length).toBeGreaterThan(0);

    const approveTx = await vaultContract.approve(
      approvalTxs.map(t => t.to),
      approvalTxs.map(t => t.data)
    );
    const approveReceipt = await approveTx.wait();
    approvalGas = approveReceipt.gasUsed.toNumber();

    console.log(`  Approvals: ${approvalGas.toLocaleString()} gas (${approvalTxs.length} token approvals)`);
    expect(approvalGas).toBeGreaterThan(0);
  }, 60000);

  for (const tickWidth of TICK_WIDTHS) {
    describe(`±${tickWidth} tick spacings`, () => {
      let tokenId;
      let tickLower;
      let tickUpper;
      let positionLiquidity;
      const result = { width: tickWidth, create: null, addLiquidity: null, collect: null, close: null };

      // Push result ref now so ordering is preserved even if tests fail
      gasResults.push(result);

      it('should create position and measure gas', async () => {
        // Get pool data for current tick
        const poolData = await adapter._fetchPoolData(
          sortedToken0Address, sortedToken1Address, FEE, provider
        );
        const currentTick = poolData.tick;

        // Calculate centered tick range
        tickLower = Math.floor(currentTick / TICK_SPACING) * TICK_SPACING - TICK_SPACING * tickWidth;
        tickUpper = Math.floor(currentTick / TICK_SPACING) * TICK_SPACING + TICK_SPACING * tickWidth;

        // Get vault token balances and use a fraction per iteration
        const token0Contract = new ethers.Contract(sortedToken0Address, ERC20_ABI, provider);
        const token1Contract = new ethers.Contract(sortedToken1Address, ERC20_ABI, provider);
        const token0Balance = await token0Contract.balanceOf(vaultAddress);
        const token1Balance = await token1Contract.balanceOf(vaultAddress);

        // Use 20% of vault balance per position (need room for add liquidity too)
        const token0Amount = token0Balance.mul(20).div(100).toString();
        const token1Amount = token1Balance.mul(20).div(100).toString();

        // Generate create position calldata
        const createData = await adapter.generateCreatePositionData({
          position: { tickLower, tickUpper },
          token0Amount,
          token1Amount,
          provider,
          walletAddress: vaultAddress,
          poolData,
          token0Data: sortedToken0Data,
          token1Data: sortedToken1Data,
          slippageTolerance: 5,
          deadlineMinutes: 5
        });

        // Execute through vault
        const mintTx = await vaultContract.mint(
          [createData.to],
          [createData.data],
          [createData.value]
        );
        const mintReceipt = await mintTx.wait();
        result.create = mintReceipt.gasUsed.toNumber();

        // Extract tokenId from IncreaseLiquidity event
        const INCREASE_LIQUIDITY_TOPIC = ethers.utils.id(
          'IncreaseLiquidity(uint256,uint128,uint256,uint256)'
        );
        const increaseLiqLog = mintReceipt.logs.find(log => log.topics[0] === INCREASE_LIQUIDITY_TOPIC);
        expect(increaseLiqLog).toBeDefined();
        tokenId = ethers.BigNumber.from(increaseLiqLog.topics[1]).toString();

        // Fetch position data to get liquidity (needed for close)
        const posResult = await adapter.getPositionById(tokenId, provider);
        positionLiquidity = posResult.position.liquidity;

        console.log(`  [±${tickWidth}] Create: ${result.create.toLocaleString()} gas (tokenId: ${tokenId}, ticks: ${tickLower}→${tickUpper})`);
        expect(result.create).toBeGreaterThan(0);
      }, 60000);

      it('should add liquidity to existing position and measure gas', async () => {
        expect(tokenId).toBeDefined();

        // Get fresh pool data and vault balances
        const poolData = await adapter._fetchPoolData(
          sortedToken0Address, sortedToken1Address, FEE, provider
        );
        const token0Contract = new ethers.Contract(sortedToken0Address, ERC20_ABI, provider);
        const token1Contract = new ethers.Contract(sortedToken1Address, ERC20_ABI, provider);
        const token0Balance = await token0Contract.balanceOf(vaultAddress);
        const token1Balance = await token1Contract.balanceOf(vaultAddress);

        // Use 10% of remaining balance for add liquidity
        const token0Amount = token0Balance.mul(10).div(100).toString();
        const token1Amount = token1Balance.mul(10).div(100).toString();

        const addData = await adapter.generateAddLiquidityData({
          position: { id: tokenId, tickLower, tickUpper },
          token0Amount,
          token1Amount,
          provider,
          poolData,
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

        console.log(`  [±${tickWidth}] Add liquidity: ${result.addLiquidity.toLocaleString()} gas`);
        expect(result.addLiquidity).toBeGreaterThan(0);
      }, 60000);

      it('should generate fees, collect, and measure gas', async () => {
        expect(tokenId).toBeDefined();

        // Execute round-trip swaps to generate fees
        const swapAmount = ethers.utils.parseEther('5');

        // WETH → USDC
        await executeSwap(testEnv, {
          tokenIn: wethAddress,
          tokenOut: usdcAddress,
          amountIn: swapAmount,
          fee: FEE,
          wallet: swapWallet.wallet
        });

        // USDC → WETH (swap back using USDC balance)
        const usdcContract = new ethers.Contract(usdcAddress, ERC20_ABI, provider);
        const usdcBal = await usdcContract.balanceOf(swapWallet.wallet.address);
        if (usdcBal.gt(0)) {
          await executeSwap(testEnv, {
            tokenIn: usdcAddress,
            tokenOut: wethAddress,
            amountIn: usdcBal,
            fee: FEE,
            wallet: swapWallet.wallet
          });
        }

        // Collect fees through vault
        const collectData = await adapter.generateClaimFeesData({
          position: { id: tokenId },
          walletAddress: vaultAddress,
          token0Address: sortedToken0Address,
          token1Address: sortedToken1Address,
          token0Decimals: sortedToken0Data.decimals,
          token1Decimals: sortedToken1Data.decimals,
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
      }, 60000);

      it('should close position (100% remove) and measure gas', async () => {
        expect(tokenId).toBeDefined();

        // Fetch fresh pool data
        const poolData = await adapter._fetchPoolData(
          sortedToken0Address, sortedToken1Address, FEE, provider
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
          poolData,
          token0Data: sortedToken0Data,
          token1Data: sortedToken1Data,
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
      }, 60000);
    });
  }
});
