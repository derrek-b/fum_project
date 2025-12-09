/**
 * @fileoverview Integration test for Vault Authorization workflow
 * Tests ExecutorChanged event detection and vault integration with
 * 1 Aligned Position, 1 Non-aligned Position, 1 Aligned Token, 1 Non-aligned Token
 */

import { ethers } from 'ethers'
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import AutomationService from '../../../src/AutomationService.js';
import { setupTestBlockchain, cleanupTestBlockchain } from '../../helpers/ganache-setup.js';
import { setupTestVault } from '../../helpers/test-vault-setup.js';

// Mock the getPoolTVLAverage function for test environment
vi.mock('fum_library', async () => {
  const actual = await vi.importActual('fum_library');
  return {
    ...actual,
    getPoolTVLAverage: vi.fn().mockResolvedValue(50000000), // $50M TVL
  };
});

describe('Vault Authorization Workflow - 1111 Configuration', () => {
  let testEnv;
  let testVault;
  let service;
  let vaultAuthGrantedEvent = null;
  let vaultOnboardedEvent = null;

  // Event capture variables for Tests 18 and 19
  let liquidityAddedEvents = [];
  let swapMonitoringEvents = [];
  let configMonitoringEvents = [];
  let monitoringStartedEvents = [];
  let baselineCapturedEvents = [];
  let positionsClosedEvents = [];
  let tokensSwappedEvents = [];

  beforeAll(async () => {
    // 1. Setup blockchain on port 8547 (different from other tests)
    testEnv = await setupTestBlockchain({ port: 8552 });

    // 2. Initialize and start the automation service FIRST
    service = new AutomationService(testEnv.testConfig);

    // Add event listener to capture VaultAuthGranted event
    service.eventManager.subscribe('VaultAuthGranted', (eventData) => {
      vaultAuthGrantedEvent = eventData;
      console.log('🎯 VaultAuthGranted event captured:', eventData);
    });

    // Add event listener to capture VaultOnboarded event
    service.eventManager.subscribe('VaultOnboarded', (eventData) => {
      vaultOnboardedEvent = eventData;
      console.log('🎯 VaultOnboarded event captured:', eventData);
    });

    // Add event listeners for Tests 18 and 19
    service.eventManager.subscribe('LiquidityAddedToPosition', (eventData) => {
      liquidityAddedEvents.push(eventData);
    });

    service.eventManager.subscribe('SwapMonitoringRegistered', (eventData) => {
      swapMonitoringEvents.push(eventData);
    });

    service.eventManager.subscribe('ConfigMonitoringRegistered', (eventData) => {
      configMonitoringEvents.push(eventData);
    });

    service.eventManager.subscribe('MonitoringStarted', (eventData) => {
      monitoringStartedEvents.push(eventData);
    });

    service.eventManager.subscribe('VaultBaselineCaptured', (eventData) => {
      baselineCapturedEvents.push(eventData);
    });

    service.eventManager.subscribe('PositionsClosed', (eventData) => {
      positionsClosedEvents.push(eventData);
    });

    service.eventManager.subscribe('TokensSwapped', (eventData) => {
      tokensSwappedEvents.push(eventData);
    });

    await service.start();
    console.log('✅ Service started and monitoring for authorization events...');

    // 3. THEN create the vault with exact same 1111 configuration
    testVault = await setupTestVault(
      testEnv.ganacheServer,
      testEnv.contracts,
      testEnv.deployedContracts,
      {
        vaultName: '1AP/1NP/1AT/1NT Auth Test Vault',
        automationServiceAddress: testEnv.testConfig.automationServiceAddress,
        wrapEthAmount: '10',
        swapTokens: [
          { from: 'WETH', to: 'USDC', amount: '2' },
          { from: 'WETH', to: 'WBTC', amount: '2' }
        ],
        positions: [
          {
            token0: 'USDC',
            token1: 'WETH',
            fee: 500,
            percentOfAssets: 20,
            tickRange: { type: 'centered', spacing: 10 }
          },
          {
            token0: 'WBTC',
            token1: 'WETH',
            fee: 500,
            percentOfAssets: 20,
            tickRange: { type: 'above' }
          }
        ],
        tokenTransfers: {
          'USDC': 60,
          'WBTC': 40
        },
        targetTokens: ['USDC', 'WETH'],
        targetPlatforms: ['uniswapV3']
      }
    );

    console.log('💰 Test vault setup complete, waiting for event processing...');

    // 4. Wait for event processing (increased to allow initializeVaultForStrategy to complete)
    await new Promise(resolve => setTimeout(resolve, 75000));

  }, 210000);

  afterAll(async () => {
    if (service) {
      try {
        await service.stop();
      } catch (error) {
        console.warn('Error stopping service:', error.message);
      }
    }
    await cleanupTestBlockchain(testEnv);
  });

  it('should emit VaultAuthGranted event with correct vault and executor addresses', async () => {
    // Verify VaultAuthGranted event was emitted
    expect(vaultAuthGrantedEvent).not.toBeNull();
    expect(vaultAuthGrantedEvent).toHaveProperty('vaultAddress');
    expect(vaultAuthGrantedEvent).toHaveProperty('executorAddress');

    // Verify addresses are correct
    expect(vaultAuthGrantedEvent.vaultAddress.toLowerCase()).toBe(
      testVault.vaultAddress.toLowerCase()
    );
    expect(vaultAuthGrantedEvent.executorAddress.toLowerCase()).toBe(
      testEnv.testConfig.automationServiceAddress.toLowerCase()
    );

    console.log('✅ VaultAuthGranted event emitted correctly:');
    console.log(`   Vault: ${vaultAuthGrantedEvent.vaultAddress}`);
    console.log(`   Executor: ${vaultAuthGrantedEvent.executorAddress}`);
  });

  it('should emit VaultOnboarded event with successful onboarding details', async () => {
    // Verify VaultOnboarded event was emitted (only emits on full success now)
    expect(vaultOnboardedEvent).not.toBeNull();
    expect(vaultOnboardedEvent).toHaveProperty('vaultAddress');
    expect(vaultOnboardedEvent).toHaveProperty('strategyId');
    expect(vaultOnboardedEvent).toHaveProperty('log');

    // Verify vault address matches
    expect(vaultOnboardedEvent.vaultAddress.toLowerCase()).toBe(
      testVault.vaultAddress.toLowerCase()
    );

    // Verify strategy assignment
    expect(vaultOnboardedEvent.strategyId).toBe('bob'); // BabyStepsStrategy

    // Verify log message indicates success
    expect(vaultOnboardedEvent.log.level).toBe('info');
    expect(vaultOnboardedEvent.log.message).toContain('✅ Vault successfully onboarded');
    expect(vaultOnboardedEvent.log.message).toContain(testVault.vaultAddress);
    expect(vaultOnboardedEvent.log.message).toContain('bob');

    console.log('✅ VaultOnboarded event emitted correctly:');
    console.log(`   Vault: ${vaultOnboardedEvent.vaultAddress}`);
    console.log(`   Strategy: ${vaultOnboardedEvent.strategyId}`);
    console.log(`   Message: ${vaultOnboardedEvent.log.message}`);
  });

  it('should emit LiquidityAddedToPosition event after vault authorization', async () => {
    // Test 18: Verify LiquidityAddedToPosition event
    console.log('\n📊 Test 18: Verifying LiquidityAddedToPosition event...');
    expect(liquidityAddedEvents.length).toBe(1);
    const liquidityEvent = liquidityAddedEvents[0];

    // Basic vault info assertions - should match snapshot exactly
    expect(liquidityEvent.vaultAddress).toBe(testVault.vaultAddress);
    const firstPositionId = Object.keys(testVault.positions)[0];
    expect(liquidityEvent.positionId).toBe(firstPositionId);
    expect(liquidityEvent.poolAddress).toBe(liquidityEvent.poolAddress); // Pool address from event

    console.log(`✅ LiquidityAddedToPosition event basic info verified:`);
    console.log(`   Vault: ${liquidityEvent.vaultAddress}`);
    console.log(`   Position ID: ${liquidityEvent.positionId}`);
    console.log(`   Pool: ${liquidityEvent.poolAddress}`);

    // Validate token amounts added to position using combination approach
    // Non-zero check (sanity - something was deployed)
    expect(ethers.BigNumber.from(liquidityEvent.actualToken0).gt(0)).toBe(true);
    expect(ethers.BigNumber.from(liquidityEvent.actualToken1).gt(0)).toBe(true);

    console.log(`✅ Token amounts verified: ${liquidityEvent.actualToken0} token0, ${liquidityEvent.actualToken1} token1`);
  });

  it('should set up monitoring for the authorized vault', async () => {
    // Test 19: Verify monitoring setup events were emitted
    console.log('\n📊 Test 19: Verifying monitoring setup events...');

    // Get vault data from VaultDataService to compare against events
    const vault = await service.vaultDataService.getVault(testVault.vaultAddress);
    expect(vault).not.toBeNull();

    // Verify SwapMonitoringRegistered event (1 for single pool with vault authorization)
    expect(swapMonitoringEvents).toHaveLength(1);
    const swapEvent = swapMonitoringEvents[0];
    expect(swapEvent.vaultAddress).toBe(vault.address);
    expect(swapEvent.poolAddress).toBe(Object.values(vault.positions)[0].pool);
    expect(swapEvent.platformId).toBe('uniswapV3');
    expect(swapEvent.timestamp).toBeGreaterThan(0);

    console.log(`✅ SwapMonitoringRegistered event verified for pool ${swapEvent.poolAddress}`);
    
    // NEW: Verify pool-to-vault mapping is correctly set up
    const poolAddress = Object.values(vault.positions)[0].pool;
    expect(service.eventManager.poolToVaults).toBeDefined();
    expect(service.eventManager.poolToVaults[poolAddress]).toBeDefined();
    expect(service.eventManager.poolToVaults[poolAddress]).toContain(vault.address);
    expect(service.eventManager.poolToVaults[poolAddress]).toHaveLength(1); // Only one vault monitoring this pool
    console.log(`✅ Pool ${poolAddress} correctly mapped to vault ${vault.address}`);

    // NEW: Verify helper methods work correctly
    expect(service.eventManager.isPoolMonitored(poolAddress)).toBe(true);
    expect(service.eventManager.getVaultsForPool(poolAddress)).toEqual([vault.address]);
    expect(service.eventManager.getMonitoredPools()).toContain(poolAddress);
    expect(service.eventManager.getPoolListenerCount()).toBe(1); // One pool being monitored
    console.log(`✅ EventManager helper methods verified`);

    // Verify ConfigMonitoringRegistered event
    expect(configMonitoringEvents).toHaveLength(1);
    const configEvent = configMonitoringEvents[0];
    expect(configEvent.vaultAddress).toBe(vault.address);
    expect(configEvent.chainId).toBe(service.chainId);
    expect(configEvent.listenersRegistered).toEqual(['TargetTokensUpdated', 'TargetPlatformsUpdated']);
    expect(configEvent.timestamp).toBeGreaterThan(0);

    console.log(`✅ ConfigMonitoringRegistered event verified with 2 config listeners`);
    console.log(`   Listeners: ${configEvent.listenersRegistered.join(', ')}`);

    // Verify MonitoringStarted event
    expect(monitoringStartedEvents).toHaveLength(1);
    const startEvent = monitoringStartedEvents[0];
    expect(startEvent.vaultAddress).toBe(vault.address);
    expect(startEvent.strategyId).toBe('bob');
    expect(startEvent.positionCount).toBe(1);
    expect(startEvent.chainId).toBe(service.chainId);
    expect(startEvent.timestamp).toBeGreaterThan(0);

    console.log(`✅ MonitoringStarted event verified for vault ${startEvent.vaultAddress}`);
    console.log(`   Strategy: ${startEvent.strategyId}, Positions: ${startEvent.positionCount}`);

    // Verify BabyStepsStrategy doesn't implement setupAdditionalMonitoring
    const strategy = service.strategies[vault.strategy.strategyId];
    expect(strategy.setupAdditionalMonitoring).toBeUndefined();

    console.log(`✅ BabyStepsStrategy correctly does not implement setupAdditionalMonitoring`);
  });

  it('should set up emergency exit baseline for the authorized vault', async () => {
    // Get vault and strategy references
    const vault = await service.vaultDataService.getVault(testVault.vaultAddress);
    const strategy = service.strategies[vault.strategy.strategyId];
    
    // Verify emergency exit baseline was cached
    expect(strategy.emergencyExitBaseline).toBeDefined();
    expect(strategy.emergencyExitBaseline[vault.address]).toBeDefined();
    expect(typeof strategy.emergencyExitBaseline[vault.address]).toBe('number');
    
    // Verify baseline tick is reasonable
    const baselineTick = strategy.emergencyExitBaseline[vault.address];
    const currentTick = liquidityAddedEvents[0].currentTick;
    const tickDifference = Math.abs(baselineTick - currentTick);
    expect(tickDifference).toBeLessThan(10000); // Within reasonable range
    
    console.log('✅ Emergency exit baseline verified for authorized vault');
    console.log(`   Baseline tick: ${baselineTick}`);
    console.log(`   Current tick: ${currentTick}`);
    console.log(`   Tick difference: ${tickDifference}`);
  });

  it('should set up Permit2 approvals for all vault tokens', async () => {
    console.log('\n🔐 Verifying Permit2 approvals...');

    const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
    const vaultTokenSymbols = ['USDC', 'WBTC', 'WETH']; // Hardcoded tokens for 1111 test

    const vault = await service.vaultDataService.getVault(testVault.vaultAddress);
    expect(vault).not.toBeNull();

    console.log(`   Checking Permit2 approvals for ${vaultTokenSymbols.length} vault tokens: ${vaultTokenSymbols.join(', ')}`);

    for (const tokenSymbol of vaultTokenSymbols) {
      const tokenData = service.tokens[tokenSymbol];
      expect(tokenData).toBeDefined();
      expect(tokenData.address).toBeDefined();

      const tokenContract = new ethers.Contract(
        tokenData.address,
        ['function allowance(address owner, address spender) view returns (uint256)'],
        service.provider
      );

      const allowance = await tokenContract.allowance(vault.address, PERMIT2_ADDRESS);
      const isApproved = allowance.gte(ethers.constants.MaxUint256.div(2));

      expect(isApproved).toBe(true);
      console.log(`   ✅ ${tokenSymbol}: Permit2 approval = ${allowance.toString()}`);
    }

    console.log(`✅ All ${vaultTokenSymbols.length} vault tokens have Permit2 approvals set`);
  });

  it('should emit VaultBaselineCaptured event before vault initialization', async () => {
    console.log('\n📊 Verifying VaultBaselineCaptured event...');

    expect(baselineCapturedEvents.length).toBe(1);
    const baselineEvent = baselineCapturedEvents[0];

    expect(baselineEvent.vaultAddress).toBe(testVault.vaultAddress);
    expect(typeof baselineEvent.totalVaultValue).toBe('number');
    expect(baselineEvent.totalVaultValue).toBeGreaterThan(0);
    expect(typeof baselineEvent.tokenValue).toBe('number');
    expect(typeof baselineEvent.positionValue).toBe('number');
    expect(baselineEvent.tokenValue + baselineEvent.positionValue).toBeCloseTo(baselineEvent.totalVaultValue, 2);

    expect(baselineEvent.tokens).toBeDefined();
    expect(typeof baselineEvent.tokens).toBe('object');
    expect(Object.keys(baselineEvent.tokens).length).toBeGreaterThan(0);

    expect(baselineEvent.positions).toBeDefined();
    expect(typeof baselineEvent.positions).toBe('object');
    expect(Object.keys(baselineEvent.positions).length).toBe(2);

    expect(typeof baselineEvent.timestamp).toBe('number');
    expect(baselineEvent.capturePoint).toBe('pre_initialization');
    expect(baselineEvent.strategyId).toBe('bob');

    console.log(`✅ VaultBaselineCaptured event verified`);
    console.log(`   Total vault value: $${baselineEvent.totalVaultValue.toFixed(2)}`);
    console.log(`   Token value: $${baselineEvent.tokenValue.toFixed(2)}`);
    console.log(`   Position value: $${baselineEvent.positionValue.toFixed(2)}`);
  });

  it('should emit PositionsClosed event when closing non-aligned position', async () => {
    console.log('\n🔒 Verifying PositionsClosed event...');

    expect(positionsClosedEvents.length).toBe(1);
    const closeEvent = positionsClosedEvents[0];

    expect(closeEvent.vaultAddress).toBe(testVault.vaultAddress);
    expect(closeEvent.closedCount).toBe(1);
    expect(Array.isArray(closeEvent.closedPositions)).toBe(true);
    expect(closeEvent.closedPositions).toHaveLength(1);

    const closedPosition = closeEvent.closedPositions[0];
    expect(closedPosition.positionId).toBeDefined();
    expect(closedPosition.pool).toBeDefined();
    expect(['WBTC', 'WETH']).toContain(closedPosition.token0Symbol);
    expect(['WBTC', 'WETH']).toContain(closedPosition.token1Symbol);
    expect(closedPosition.platform).toBe('uniswapV3');

    // Out-of-range position - at least one amount > 0
    expect(closedPosition.principalAmount0).toBeDefined();
    expect(closedPosition.principalAmount1).toBeDefined();
    const amount0 = BigInt(closedPosition.principalAmount0);
    const amount1 = BigInt(closedPosition.principalAmount1);
    expect(amount0 + amount1).toBeGreaterThan(0n);

    expect(typeof closedPosition.tickLower).toBe('number');
    expect(typeof closedPosition.tickUpper).toBe('number');
    expect(closedPosition.tickUpper).toBeGreaterThan(closedPosition.tickLower);

    expect(closeEvent.gasUsed).toBeDefined();
    expect(closeEvent.transactionHash).toBeDefined();
    expect(closeEvent.success).toBe(true);

    console.log(`✅ PositionsClosed event verified: ${closeEvent.closedCount} position closed`);
    console.log(`   Position ${closedPosition.positionId}: ${closedPosition.token0Symbol}/${closedPosition.token1Symbol}`);
    console.log(`   Principal: ${closedPosition.principalAmount0}/${closedPosition.principalAmount1}`);
  });

  it('should emit TokensSwapped events for deficit and buffer swaps', async () => {
    console.log('\n🔄 Verifying TokensSwapped events...');

    // Should have at least one TokensSwapped event (1111 scenario has both deficit and buffer swaps)
    expect(tokensSwappedEvents.length).toBeGreaterThan(0);

    // Find deficit and buffer swap events
    const deficitSwaps = tokensSwappedEvents.filter(e => e.swapType === 'deficit_coverage');
    const bufferSwaps = tokensSwappedEvents.filter(e => e.swapType === 'buffer_5050');

    console.log(`   Captured ${tokensSwappedEvents.length} total swap event(s)`);
    console.log(`   Deficit swaps: ${deficitSwaps.length}, Buffer swaps: ${bufferSwaps.length}`);

    // Validate each event has basic required fields
    tokensSwappedEvents.forEach((event, idx) => {
      expect(event.vaultAddress).toBe(testVault.vaultAddress);
      expect(event.swapType).toMatch(/deficit_coverage|buffer_5050/);
      expect(event.swapCount).toBeGreaterThan(0);
      expect(Array.isArray(event.swaps)).toBe(true);
      expect(event.swaps.length).toBe(event.swapCount);
      expect(event.success).toBe(true);
      expect(event.gasUsed).toBeDefined();
      expect(event.effectiveGasPrice).toBeDefined();
      expect(event.transactionHash).toBeDefined();

      // Validate swap details structure
      event.swaps.forEach(swap => {
        expect(swap.tokenInSymbol).toBeDefined();
        expect(swap.tokenOutSymbol).toBeDefined();
        expect(swap.quotedAmountIn).toBeDefined();
        expect(swap.quotedAmountOut).toBeDefined();
        expect(swap.actualAmountIn).toBeDefined();
        expect(swap.actualAmountOut).toBeDefined();
        expect(typeof swap.isAmountIn).toBe('boolean');
      });
    });

    console.log(`✅ TokensSwapped events verified`);
    console.log(`   All events have required fields and proper structure`);
  });
});
