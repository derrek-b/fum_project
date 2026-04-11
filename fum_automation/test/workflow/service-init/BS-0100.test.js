/**
 * @fileoverview Cross-platform position closure test
 *
 * Scenario: 0 Aligned Positions / 1 Non-Aligned Position (platform mismatch)
 * - Vault targets uniswapV3 with target tokens ['USDC', 'ETH']
 * - Vault contains a V4 ETH/USDC position (same tokens, wrong platform)
 * - Vault also has WETH + USDC token balances
 *
 * Expected flow:
 * 1. Service discovers vault, loads positions from ALL adapters (V3 + V4)
 * 2. Pool metadata cached for V4 pool despite vault targeting V3
 * 3. evaluateInitialPositions classifies V4 position as non-aligned (platform mismatch)
 * 4. closePositions uses V4 adapter to generate removal calldata
 * 5. Vault's decreaseLiquidity routes through V4 validator on-chain
 * 6. V4 adapter parses closure receipt
 * 7. Strategy creates new V3 position with freed capital
 *
 * This validates the cross-platform closure path end-to-end.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ethers } from 'ethers';
import AutomationService from '../../../src/core/AutomationService.js';
import { setupTestBlockchain, cleanupTestBlockchain } from '../../helpers/hardhat-setup.js';
import { setupTestVault } from '../../helpers/test-vault-setup.js';
import { UniswapV4Adapter } from 'fum_library/adapters';
import { getChainConfig, getTokenAddress } from 'fum_library';

const ERC20_ABI = [
  'function balanceOf(address account) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)'
];

const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
const NATIVE_ETH = ethers.constants.AddressZero;

/**
 * Set up Permit2 approvals for a token → V4 PositionManager
 */
async function setupPermit2Approval(tokenContract, positionManagerAddress, signer) {
  await (await tokenContract.approve(PERMIT2_ADDRESS, ethers.constants.MaxUint256)).wait();

  const permit2 = new ethers.Contract(PERMIT2_ADDRESS, [
    'function approve(address token, address spender, uint160 amount, uint48 expiration) external'
  ], signer);

  const maxAmount = ethers.BigNumber.from(2).pow(160).sub(1);
  const expiration = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365;

  await (await permit2.approve(
    tokenContract.address,
    positionManagerAddress,
    maxAmount,
    expiration
  )).wait();
}

describe('BS-0100: Cross-Platform Position Closure (V3 vault with V4 position)', () => {
  let testEnv;
  let testVault;
  let service;
  let testConfig;
  let v4PositionId;

  // Event capture arrays
  let vaultLoadedEvents = [];
  let vaultBaselineCapturedEvents = [];
  let vaultSetupCompleteEvents = [];
  let monitoringStartedEvents = [];
  let vaultsLoadedEvents = [];
  let poolDataFetchedEvents = [];
  let initialPositionsEvaluatedEvents = [];
  let bestPoolSelectedEvents = [];
  let positionsClosedEvents = [];
  let batchTransactionExecutedEvents = [];
  let tokenBalancesFetchedEvents = [];
  let utilizationEvents = [];
  let tokenPreparationCompletedEvents = [];
  let tokensSwappedEvents = [];
  let newPositionCreatedEvents = [];
  let liquidityAddedEvents = [];

  beforeAll(async () => {
    // Step 1: Set up V3 test environment
    testEnv = await setupTestBlockchain();
    testConfig = testEnv.testConfig;

    // Step 2: Create V3-targeting vault with tokens but NO V3 positions
    testVault = await setupTestVault(
      testEnv.hardhatServer,
      testEnv.contracts,
      testEnv.deployedContracts,
      {
        vaultName: 'BS-0100: Cross-Platform Closure Test',
        wrapEthAmount: '10',
        swapTokens: [
          { from: 'WETH', to: 'USDC', amount: '3' }
        ],
        positions: [],  // No V3 positions — only a V4 position will be added below
        tokenTransfers: {
          'USDC': 40,
          'WETH': 40
        },
        targetTokens: ['USDC', 'ETH'],
        targetPlatforms: ['uniswapV3'],
        strategy: 'bob'
      }
    );

    // Step 3: Mint a V4 ETH/USDC position and transfer to vault
    console.log('  - Creating cross-platform V4 position...');

    const owner = testEnv.hardhatServer.signers[0];
    const chainConfig = getChainConfig(1337);
    const uniswapV4 = chainConfig.platformAddresses.uniswapV4;
    const v4Adapter = new UniswapV4Adapter(1337, testEnv.hardhatServer.provider);

    // Get USDC contract for Permit2 approval
    const usdcAddress = getTokenAddress('USDC', 1337);
    const usdcContract = new ethers.Contract(usdcAddress, ERC20_ABI, owner);

    // Set up Permit2 approval: USDC → V4 PositionManager
    await setupPermit2Approval(usdcContract, uniswapV4.positionManagerAddress, owner);

    // Fetch V4 ETH/USDC pool data (ETH = AddressZero, sorted before any ERC-20)
    const poolData = await v4Adapter.fetchPoolDataForTesting(
      NATIVE_ETH,
      usdcAddress,
      500,
      10,
      ethers.constants.AddressZero,
      testEnv.hardhatServer.provider
    );

    if (!poolData || poolData.liquidity === '0') {
      throw new Error('V4 ETH/USDC pool has no liquidity on fork');
    }

    const currentTick = poolData.tick;
    const tickSpacing = 10;

    // Centered position (in-range) — platform is the only mismatch reason
    const spacing = 10;
    const tickLower = Math.floor(currentTick / tickSpacing) * tickSpacing - tickSpacing * spacing;
    const tickUpper = Math.floor(currentTick / tickSpacing) * tickSpacing + tickSpacing * spacing;

    console.log(`    V4 pool tick: ${currentTick}, range: ${tickLower} to ${tickUpper}`);

    // Use 15% of owner's remaining USDC + native ETH
    const ownerUsdcBalance = await usdcContract.balanceOf(owner.address);
    const usdcForPosition = ownerUsdcBalance.mul(15).div(100);
    const ethForPosition = ethers.utils.parseEther('1');

    const poolKey = {
      currency0: NATIVE_ETH,
      currency1: usdcAddress,
      fee: 500,
      tickSpacing: 10,
      hooks: ethers.constants.AddressZero
    };

    const createPositionData = await v4Adapter.generateCreatePositionData({
      position: { tickLower, tickUpper },
      token0Amount: ethForPosition.toString(),
      token1Amount: usdcForPosition.toString(),
      provider: testEnv.hardhatServer.provider,
      walletAddress: owner.address,
      poolKey,
      poolData,
      token0Data: { address: NATIVE_ETH, decimals: 18 },
      token1Data: { address: usdcAddress, decimals: 6 },
      slippageTolerance: 5,
      deadlineMinutes: 20
    });

    const mintTx = await owner.sendTransaction({
      to: createPositionData.to,
      data: createPositionData.data,
      value: createPositionData.value
    });
    const mintReceipt = await mintTx.wait();

    const mintResult = v4Adapter.parseIncreaseLiquidityReceipt(mintReceipt, {
      position: { tickLower, tickUpper },
      poolData
    });
    v4PositionId = mintResult.tokenId;
    console.log(`    Created V4 position NFT: ${v4PositionId}`);

    // Transfer V4 position NFT to vault
    const V4_PM_ABI = ['function safeTransferFrom(address from, address to, uint256 tokenId) external'];
    const v4PositionManager = new ethers.Contract(uniswapV4.positionManagerAddress, V4_PM_ABI, owner);
    await (await v4PositionManager.safeTransferFrom(owner.address, testVault.vaultAddress, v4PositionId)).wait();
    console.log(`    V4 position transferred to vault`);

    console.log('  ✅ Cross-platform test vault setup complete!');
  });

  afterAll(async () => {
    if (service) {
      try {
        await service.stop(true);
      } catch (error) {
        console.warn('Error stopping service:', error.message);
      }
    }
    await cleanupTestBlockchain(testEnv);
  });

  // ===========================================================================
  // Phase 3: Vault Discovery
  // ===========================================================================

  describe('Phase 3: Vault Discovery', () => {
    it('should discover and load authorized vault', async () => {
      service = new AutomationService(testConfig);

      // Subscribe to events before starting
      service.eventManager.subscribe('vaultLoaded', (data) => vaultLoadedEvents.push(data));
      service.eventManager.subscribe('VaultBaselineCaptured', (data) => vaultBaselineCapturedEvents.push(data));
      service.eventManager.subscribe('VaultSetupComplete', (data) => vaultSetupCompleteEvents.push(data));
      service.eventManager.subscribe('MonitoringStarted', (data) => monitoringStartedEvents.push(data));
      service.eventManager.subscribe('VaultsLoaded', (data) => vaultsLoadedEvents.push(data));
      service.eventManager.subscribe('PoolDataFetched', (data) => poolDataFetchedEvents.push(data));
      service.eventManager.subscribe('InitialPositionsEvaluated', (data) => initialPositionsEvaluatedEvents.push(data));
      service.eventManager.subscribe('BestPoolSelected', (data) => bestPoolSelectedEvents.push(data));
      service.eventManager.subscribe('PositionsClosed', (data) => positionsClosedEvents.push(data));
      service.eventManager.subscribe('BatchTransactionExecuted', (data) => batchTransactionExecutedEvents.push(data));
      service.eventManager.subscribe('TokenBalancesFetched', (data) => tokenBalancesFetchedEvents.push(data));
      service.eventManager.subscribe('DeploymentCalculated', (data) => utilizationEvents.push(data));
      service.eventManager.subscribe('TokenPreparationCompleted', (data) => tokenPreparationCompletedEvents.push(data));
      service.eventManager.subscribe('TokensSwapped', (data) => tokensSwappedEvents.push(data));
      service.eventManager.subscribe('NewPositionCreated', (data) => newPositionCreatedEvents.push(data));
      service.eventManager.subscribe('LiquidityAddedToPosition', (data) => liquidityAddedEvents.push(data));

      await service.start();

      expect(service.isRunning).toBe(true);

      const discoveredVaults = service.vaultDataService.getAllVaults();
      expect(discoveredVaults.length).toBe(1);

      expect(vaultsLoadedEvents.length).toBe(1);
      expect(vaultsLoadedEvents[0].successful).toBe(1);
    });
  });

  // ===========================================================================
  // Vault Data Loading
  // ===========================================================================

  describe('Vault Data Loading', () => {
    it('should discover the V4 position via adapter scanning', () => {
      expect(vaultLoadedEvents.length).toBe(1);

      const event = vaultLoadedEvents[0];
      // V4 position discovered even though vault targets V3
      expect(event.positionCount).toBe(1);
    });

    it('should have correct vault configuration targeting V3', () => {
      const vault = service.vaultDataService.getAllVaults()[0];

      expect(vault.targetTokens).toEqual(['USDC', 'ETH']);
      expect(vault.targetPlatforms).toEqual(['uniswapV3']);
      expect(vault.strategy.strategyId).toBe('bob');
    });

    it('should cache V4 pool metadata despite vault targeting V3', () => {
      // PoolDataFetched events should include V4 pool data
      const v4PoolEvents = poolDataFetchedEvents.filter(e => e.source === 'Uniswap V4');
      expect(v4PoolEvents.length).toBeGreaterThanOrEqual(1);

      // V4 pool data should be in the service's poolData cache
      const poolEntries = Object.values(service.poolData);
      const v4Pools = poolEntries.filter(p => p.platform === 'uniswapV4');
      expect(v4Pools.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ===========================================================================
  // Baseline Capture
  // ===========================================================================

  describe('Baseline Capture', () => {
    it('should capture baseline with V4 position value', () => {
      expect(vaultBaselineCapturedEvents.length).toBe(1);

      const event = vaultBaselineCapturedEvents[0];
      expect(event.totalVaultValue).toBeGreaterThan(0);
      expect(event.positionValue).toBeGreaterThan(0);
    });

    it('should include 1 position in baseline (the V4 position)', () => {
      const event = vaultBaselineCapturedEvents[0];
      expect(Object.keys(event.positions).length).toBe(1);
    });
  });

  // ===========================================================================
  // Position Evaluation
  // ===========================================================================

  describe('Position Evaluation', () => {
    it('should emit InitialPositionsEvaluated event', () => {
      expect(initialPositionsEvaluatedEvents.length).toBe(1);
      expect(initialPositionsEvaluatedEvents[0].success).toBe(true);
    });

    it('should identify 0 aligned and 1 non-aligned position', () => {
      const event = initialPositionsEvaluatedEvents[0];

      expect(event.alignedCount).toBe(0);
      expect(event.nonAlignedCount).toBe(1);
      expect(event.alignedPositionIds).toHaveLength(0);
      expect(event.nonAlignedPositionIds).toHaveLength(1);
    });

    it('should classify V4 position as non-aligned due to platform mismatch', () => {
      const event = initialPositionsEvaluatedEvents[0];
      const nonAlignedId = event.nonAlignedPositionIds[0];

      // The non-aligned position should be the V4 position we created
      expect(nonAlignedId).toBe(v4PositionId.toString());
    });
  });

  // ===========================================================================
  // Non-Aligned Position Closing (Cross-Platform)
  // ===========================================================================

  describe('Non-Aligned Position Closing (Cross-Platform)', () => {
    it('should emit PositionsClosed event', () => {
      expect(positionsClosedEvents.length).toBe(1);
    });

    it('should close exactly 1 position', () => {
      const event = positionsClosedEvents[0];

      expect(event.closedCount).toBe(1);
      expect(event.closedPositions).toHaveLength(1);
      expect(event.vaultAddress.toLowerCase()).toBe(testVault.vaultAddress.toLowerCase());
    });

    it('should close the V4 position (platform mismatch)', () => {
      const event = positionsClosedEvents[0];
      const closedPosition = event.closedPositions[0];

      expect(closedPosition.positionId).toBe(v4PositionId.toString());
    });

    it('should report V4 platform in closed position metadata', () => {
      const event = positionsClosedEvents[0];
      const closedPosition = event.closedPositions[0];

      expect(closedPosition.platform).toBe('uniswapV4');
    });

    it('should have principal amounts returned from V4 closure', () => {
      const event = positionsClosedEvents[0];
      const closedPosition = event.closedPositions[0];

      // V4 position had ETH + USDC — at least one should have principal > 0
      expect(
        BigInt(closedPosition.principalAmount0) > 0n || BigInt(closedPosition.principalAmount1) > 0n
      ).toBe(true);
    });

    it('should have valid transaction details', () => {
      const event = positionsClosedEvents[0];

      expect(event.transactionHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(BigInt(event.gasUsed)).toBeGreaterThan(0n);
      expect(event.success).toBe(true);
    });

    it('should remove V4 position from vault.positions after closure', () => {
      const vault = service.vaultDataService.getAllVaults()[0];

      // V4 position should be gone — vault may have a new V3 position from deployment
      const positionIds = Object.keys(vault.positions);
      expect(positionIds).not.toContain(v4PositionId.toString());
    });
  });

  // ===========================================================================
  // Capital Deployment — createNewPosition Path
  // ===========================================================================

  describe('Capital Deployment - createNewPosition Path', () => {
    it('should have available deployment after closing V4 position', () => {
      const event = utilizationEvents[utilizationEvents.length - 1];
      expect(event.availableDeployment).toBeGreaterThan(0);
    });

    it('should create a NEW V3 position (no aligned position existed)', () => {
      expect(newPositionCreatedEvents.length).toBe(1);
    });

    it('should NOT add to existing position (none were aligned)', () => {
      expect(liquidityAddedEvents.length).toBe(0);
    });

    it('should create position on target platform (V3)', () => {
      const event = newPositionCreatedEvents[0];
      expect(event.platform).toBe('uniswapV3');
    });

    it('should create position for this vault with actual token amounts', () => {
      const event = newPositionCreatedEvents[0];
      expect(event.vaultAddress.toLowerCase()).toBe(testVault.vaultAddress.toLowerCase());

      // At least one token should have been used
      expect(
        BigInt(event.actualToken0) > 0n || BigInt(event.actualToken1) > 0n
      ).toBe(true);
    });

    it('should select V3 pool via BestPoolSelected', () => {
      expect(bestPoolSelectedEvents.length).toBe(1);

      const event = bestPoolSelectedEvents[0];
      expect(event.platformId).toBe('uniswapV3');
    });
  });

  // ===========================================================================
  // Setup Completion
  // ===========================================================================

  describe('Setup Completion', () => {
    it('should emit MonitoringStarted with 1 position (new V3)', () => {
      expect(monitoringStartedEvents.length).toBe(1);

      const event = monitoringStartedEvents[0];
      expect(event.positionCount).toBe(1);
      expect(event.strategyId).toBe('bob');
    });

    it('should emit VaultSetupComplete', () => {
      expect(vaultSetupCompleteEvents.length).toBe(1);

      const event = vaultSetupCompleteEvents[0];
      expect(event.positionCount).toBe(1);
      expect(event.baselineCaptured).toBe(true);
    });

    it('should have vault in cache with 1 V3 position after setup', async () => {
      const vault = await service.vaultDataService.getVault(testVault.vaultAddress, false);
      const positionIds = Object.keys(vault.positions);

      expect(positionIds.length).toBe(1);
      expect(BigInt(vault.positions[positionIds[0]].liquidity)).toBeGreaterThan(0n);
    });

    it('should have V3 pool metadata for the new position', () => {
      const vault = service.vaultDataService.getAllVaults()[0];
      const positionId = Object.keys(vault.positions)[0];
      const position = vault.positions[positionId];

      // Pool metadata should exist and be V3
      const poolMeta = service.poolData[position.pool];
      expect(poolMeta).toBeDefined();
      expect(poolMeta.platform).toBe('uniswapV3');
    });

    it('should have emergency exit baseline set', () => {
      const strategy = service.strategies.get('bob');
      expect(strategy.emergencyExitBaseline[testVault.vaultAddress]).toBeDefined();
    });
  });
});
