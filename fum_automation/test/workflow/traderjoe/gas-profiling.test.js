/**
 * @fileoverview Gas profiling test for Trader Joe V2.2 operations across varying bin counts
 *
 * Measures gas consumption for create, collect fees, and close (removePosition) operations
 * at different bin counts to establish per-bin cost curves. Results feed into threshold
 * profiling for minDeploymentForGas, minSwapValue, and reinvestmentTrigger.
 *
 * Uses direct vault + adapter calls (no AutomationService overhead) for clean gas measurements.
 *
 * Run with: FORK_CHAIN=avalanche npx vitest run test/workflow/traderjoe/gas-profiling.test.js
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ethers } from 'ethers';
import { TraderJoeV2_2Adapter } from 'fum_library/adapters';
import { getChainConfig, getTokenAddress, getTokenBySymbol } from 'fum_library';
import { getWrappedNativeAddress } from 'fum_library/helpers/tokenHelpers';
import { setupTestBlockchain, cleanupTestBlockchain } from '../../helpers/hardhat-setup.js';
import { setupTraderJoeTestVault } from '../../helpers/traderjoe-vault-setup.js';

const BIN_COUNTS = [5, 11, 21, 51];
const BIN_STEP = 10; // 0.10% fee tier (most liquid USDC/WAVAX pool on Avalanche)

// Accumulate results for summary table
const gasResults = [];

describe('TJ V2.2 Gas Profiling — Bin Count Scaling', () => {
  let testEnv;
  let testVault;
  let adapter;
  let provider;
  let vaultContract;
  let vaultAddress;
  let chainId;
  let lbPairAddress;
  let sortedToken0;
  let sortedToken1;

  // LBRouter for fee-generating swaps
  const LB_ROUTER_ABI = [
    'function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, tuple(uint256[] pairBinSteps, uint8[] versions, address[] tokenPath) path, address to, uint256 deadline) external returns (uint256 amountOut)'
  ];
  const ERC20_ABI = [
    'function balanceOf(address account) view returns (uint256)',
    'function transfer(address to, uint256 amount) returns (bool)',
    'function approve(address spender, uint256 amount) returns (bool)',
    'function decimals() view returns (uint8)'
  ];

  beforeAll(async () => {
    testEnv = await setupTestBlockchain();
    provider = testEnv.hardhatServer.provider;
    chainId = (await provider.getNetwork()).chainId;

    // Create vault with tokens but NO positions — we create them manually per bin count
    testVault = await setupTraderJoeTestVault(
      testEnv.hardhatServer,
      testEnv.contracts,
      testEnv.deployedContracts,
      {
        vaultName: 'Gas Profiling Vault',
        nativeAmount: '50',
        swapTokens: [
          { from: 'AVAX', to: 'USDC', amount: '20', binStep: 10, version: 3 }
        ],
        positions: [],
        tokenTransfers: { 'WAVAX': 80, 'USDC': 80 },
        targetTokens: ['USDC', 'WAVAX'],
        targetPlatforms: ['traderjoeV2_2'],
        strategy: 'bob'
      }
    );

    vaultContract = testVault.vault;
    vaultAddress = testVault.vaultAddress;
    adapter = testVault.adapter;

    // Look up the USDC/WAVAX LBPair
    const chainConfig = getChainConfig(chainId);
    const traderjoeV2_2 = chainConfig.platformAddresses.traderjoeV2_2;

    const usdcAddress = getTokenAddress('USDC', chainId);
    const wavaxAddress = getWrappedNativeAddress(chainId);

    // Sort tokens to TJ canonical order
    const usdcData = { address: usdcAddress, ...getTokenBySymbol('USDC') };
    const wavaxData = { address: wavaxAddress, symbol: 'WAVAX', decimals: 18 };
    const sorted = adapter.sortTokens(usdcData, wavaxData);
    sortedToken0 = sorted.sortedToken0;
    sortedToken1 = sorted.sortedToken1;

    // Find LBPair
    const LB_FACTORY_ABI = [
      'function getLBPairInformation(address tokenX, address tokenY, uint256 binStep) view returns (tuple(uint16 binStep, address LBPair, bool createdByOwner, bool ignoredForRouting))'
    ];
    const lbFactory = new ethers.Contract(traderjoeV2_2.lbFactoryAddress, LB_FACTORY_ABI, provider);
    const pairInfo = await lbFactory.getLBPairInformation(sortedToken0.address, sortedToken1.address, BIN_STEP);

    if (pairInfo.LBPair === ethers.constants.AddressZero) {
      throw new Error(`LBPair not found for ${sortedToken0.symbol}/${sortedToken1.symbol} binStep=${BIN_STEP}`);
    }
    lbPairAddress = pairInfo.LBPair;

    console.log(`\nGas Profiling Setup:`);
    console.log(`  Vault: ${vaultAddress}`);
    console.log(`  LBPair: ${lbPairAddress} (${sortedToken0.symbol}/${sortedToken1.symbol}, binStep=${BIN_STEP})`);
    console.log(`  Bin counts to test: ${BIN_COUNTS.join(', ')}\n`);
  });

  afterAll(async () => {
    // Print summary table
    if (gasResults.length > 0) {
      const fmt = (n) => Number(n).toLocaleString();

      console.log(`\n${'='.repeat(78)}`);
      console.log(`TJ V2.2 Gas Profiling Results (${sortedToken0.symbol}/${sortedToken1.symbol}, binStep=${BIN_STEP})`);
      console.log(`${'='.repeat(78)}`);
      console.log(`${'Bins'.padStart(6)} | ${'Create'.padStart(12)} | ${'Collect Fees'.padStart(14)} | ${'Close'.padStart(12)} | ${'Total'.padStart(12)}`);
      console.log(`${'-'.repeat(6)} | ${'-'.repeat(12)} | ${'-'.repeat(14)} | ${'-'.repeat(12)} | ${'-'.repeat(12)}`);

      for (const r of gasResults) {
        const total = (r.create || 0) + (r.collect || 0) + (r.close || 0);
        console.log(
          `${String(r.bins).padStart(6)} | ` +
          `${(r.create ? fmt(r.create) : 'N/A').padStart(12)} | ` +
          `${(r.collect ? fmt(r.collect) : 'N/A').padStart(14)} | ` +
          `${(r.close ? fmt(r.close) : 'N/A').padStart(12)} | ` +
          `${(total ? fmt(total) : 'N/A').padStart(12)}`
        );
      }

      // Per-bin marginal cost (simple diff between consecutive measurements)
      if (gasResults.length >= 2) {
        console.log(`\nPer-bin marginal cost (average across measurements):`);
        for (const op of ['create', 'collect', 'close']) {
          const points = gasResults.filter(r => r[op]);
          if (points.length >= 2) {
            const diffs = [];
            for (let i = 1; i < points.length; i++) {
              const dGas = points[i][op] - points[i - 1][op];
              const dBins = points[i].bins - points[i - 1].bins;
              diffs.push(dGas / dBins);
            }
            const avg = Math.round(diffs.reduce((a, b) => a + b, 0) / diffs.length);
            console.log(`  ${op.padEnd(12)}: ~${fmt(avg)} gas/bin`);
          }
        }
      }

      console.log(`${'='.repeat(78)}\n`);
    }

    await cleanupTestBlockchain(testEnv);
  });

  for (const binCount of BIN_COUNTS) {
    describe(`${binCount} bins`, () => {
      let positionId;
      let positionData;
      const result = { bins: binCount, create: null, collect: null, close: null };

      // Push result ref now so ordering is preserved even if tests fail
      gasResults.push(result);

      it('should create position and measure gas', async () => {
        // Sync chain timestamp with real time — prior iterations mine blocks rapidly,
        // advancing chain time past Date.now()-based deadlines in adapter methods
        const currentBlock = await provider.getBlock('latest');
        const nextTimestamp = Math.max(Math.floor(Date.now() / 1000), currentBlock.timestamp) + 1;
        await provider.send('evm_setNextBlockTimestamp', [nextTimestamp]);
        await provider.send('evm_mine', []);

        // Get fresh pool data for current active bin
        const poolData = await adapter.getPoolData(lbPairAddress, provider);
        const activeId = poolData.activeId;
        const halfBins = Math.floor(binCount / 2);
        const lowerBinId = activeId - halfBins;
        const upperBinId = activeId + (binCount - 1 - halfBins);

        // Get vault token balances and use a fraction per iteration
        const token0Contract = new ethers.Contract(sortedToken0.address, ERC20_ABI, provider);
        const token1Contract = new ethers.Contract(sortedToken1.address, ERC20_ABI, provider);
        const token0Balance = await token0Contract.balanceOf(vaultAddress);
        const token1Balance = await token1Contract.balanceOf(vaultAddress);

        // Use 15% of vault balance per position to leave room for all 4 iterations
        const token0Amount = token0Balance.mul(15).div(100).toString();
        const token1Amount = token1Balance.mul(15).div(100).toString();

        // Ensure vault has approved TJPositionManager
        const approvalTxs = await adapter.getRequiredApprovals(
          'liquidity', vaultAddress, [sortedToken0.address, sortedToken1.address], provider
        );
        if (approvalTxs.length > 0) {
          const approveTx = await vaultContract.approve(
            approvalTxs.map(t => t.to),
            approvalTxs.map(t => t.data)
          );
          await approveTx.wait();
        }

        // Generate create position calldata
        const createData = await adapter.generateCreatePositionData({
          position: { lowerBinId, upperBinId },
          token0Amount,
          token1Amount,
          provider,
          walletAddress: vaultAddress,
          poolData: { ...poolData, address: lbPairAddress },
          token0Data: sortedToken0,
          token1Data: sortedToken1,
          slippageTolerance: 1,
          deadlineMinutes: 5
        });

        // Execute through vault — explicit gas limit to account for EIP-150 63/64 rule.
        // The inner call{} in PositionVault only gets 63/64 of remaining gas, which can
        // be insufficient when the gas estimate is tight (especially for mid-range bin counts).
        const estimatedGas = await vaultContract.estimateGas.mint(
          [createData.to], [createData.data], [createData.value]
        );
        const mintTx = await vaultContract.mint(
          [createData.to],
          [createData.data],
          [createData.value],
          { gasLimit: estimatedGas.mul(130).div(100) } // 30% buffer over estimate
        );
        const mintReceipt = await mintTx.wait();
        result.create = mintReceipt.gasUsed.toNumber();

        // Extract positionId from PositionCreated event
        const POSITION_CREATED_TOPIC = ethers.utils.id(
          'PositionCreated(uint256,address,address,address,uint256[],uint256[],uint256,uint256)'
        );
        const createdLog = mintReceipt.logs.find(log => log.topics[0] === POSITION_CREATED_TOPIC);
        expect(createdLog).toBeDefined();
        positionId = ethers.BigNumber.from(createdLog.topics[1]).toString();

        console.log(`  [${binCount} bins] Create: ${result.create.toLocaleString()} gas (positionId: ${positionId})`);
        expect(result.create).toBeGreaterThan(0);
      });

      it('should generate fees, collect, and measure gas', async () => {
        expect(positionId).toBeDefined();

        // Generate trading fees by swapping through the LBPair
        const chainConfig = getChainConfig(chainId);
        const lbRouterAddress = chainConfig.platformAddresses.traderjoeV2_2.lbRouterAddress;
        const owner = testEnv.hardhatServer.signers[0];
        const lbRouter = new ethers.Contract(lbRouterAddress, LB_ROUTER_ABI, owner);

        const wavaxContract = new ethers.Contract(sortedToken1.address.toLowerCase() === getWrappedNativeAddress(chainId).toLowerCase() ? sortedToken1.address : sortedToken0.address, ERC20_ABI, owner);
        const wavaxAddress = getWrappedNativeAddress(chainId);
        const usdcAddress = getTokenAddress('USDC', chainId);

        // Swap WAVAX → USDC and back to generate fees in both tokens
        const swapAmount = ethers.utils.parseEther('1');
        const deadline = Math.floor(Date.now() / 1000) + 300;

        // Wrap some AVAX for swaps
        const WAVAX_ABI = ['function deposit() payable', ...ERC20_ABI];
        const wavax = new ethers.Contract(wavaxAddress, WAVAX_ABI, owner);
        await (await wavax.deposit({ value: ethers.utils.parseEther('3') })).wait();

        // WAVAX → USDC
        await (await wavax.approve(lbRouterAddress, ethers.utils.parseEther('3'))).wait();
        await (await lbRouter.swapExactTokensForTokens(
          swapAmount, 0,
          { pairBinSteps: [BIN_STEP], versions: [3], tokenPath: [wavaxAddress, usdcAddress] },
          owner.address, deadline
        )).wait();

        // USDC → WAVAX (swap back)
        const usdcContract = new ethers.Contract(usdcAddress, ERC20_ABI, owner);
        const usdcBal = await usdcContract.balanceOf(owner.address);
        if (usdcBal.gt(0)) {
          await (await usdcContract.approve(lbRouterAddress, usdcBal)).wait();
          await (await lbRouter.swapExactTokensForTokens(
            usdcBal, 0,
            { pairBinSteps: [BIN_STEP], versions: [3], tokenPath: [usdcAddress, wavaxAddress] },
            owner.address, deadline
          )).wait();
        }

        // Collect fees through vault
        const collectData = await adapter.generateClaimFeesData({
          position: { id: positionId },
          provider,
          slippageTolerance: 1,
          deadlineMinutes: 5
        });

        if (collectData) {
          const collectTx = await vaultContract.collect(
            [collectData.to],
            [collectData.data]
          );
          const collectReceipt = await collectTx.wait();
          result.collect = collectReceipt.gasUsed.toNumber();
          console.log(`  [${binCount} bins] Collect fees: ${result.collect.toLocaleString()} gas`);
        } else {
          console.log(`  [${binCount} bins] Collect fees: no fees to collect (feeShares all zero)`);
        }
      });

      it('should close position (100% remove) and measure gas', async () => {
        expect(positionId).toBeDefined();

        // Fetch full position data (needed for close — depositIds, liquidityMinted)
        const posResult = await adapter.getPositionById(positionId, provider);
        positionData = posResult.position;

        const closeData = await adapter.generateRemoveLiquidityData({
          position: positionData,
          percentage: 100,
          provider,
          slippageTolerance: 1,
          deadlineMinutes: 5
        });

        // TJ uses vault.decreaseLiquidity() for both partial and full removal
        // (vault.burn() hits validateBurn which isn't implemented for TJ)
        const closeTx = await vaultContract.decreaseLiquidity(
          [closeData.to],
          [closeData.data]
        );
        const closeReceipt = await closeTx.wait();
        result.close = closeReceipt.gasUsed.toNumber();

        console.log(`  [${binCount} bins] Close: ${result.close.toLocaleString()} gas`);
        expect(result.close).toBeGreaterThan(0);
      });
    });
  }
});
