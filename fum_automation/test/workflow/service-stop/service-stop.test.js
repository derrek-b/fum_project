/**
 * @fileoverview Integration test for Service Stop workflow
 * Tests service startup with vault discovery, then clean service shutdown
 * with proper per-vault cleanup, strategy cleanup, and event emission.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import AutomationService from '../../../src/core/AutomationService.js';
import { setupTestBlockchain, cleanupTestBlockchain } from '../../helpers/hardhat-setup.js';
import { setupTestVault } from '../../helpers/test-vault-setup.js';
import { waitForCondition } from '../../helpers/wait-utils.js';

// Mock the getPoolTVLAverage function for test environment
vi.mock('fum_library', async () => {
  const actual = await vi.importActual('fum_library');
  return {
    ...actual,
    getPoolTVLAverage: vi.fn().mockResolvedValue(50000000), // $50M TVL
  };
});

describe('Service Stop Workflow', () => {
  let testEnv;
  let testVault;
  let service;
  let vaultMonitoringStoppedEvents = [];
  let vaultPositionChecksClearedEvents = [];

  beforeAll(async () => {
    // 1. Setup blockchain (uses shared Hardhat instance)
    testEnv = await setupTestBlockchain();

    // 2. Create test vault with simple fast setup
    testVault = await setupTestVault(
      testEnv.hardhatServer,
      testEnv.contracts,
      testEnv.deployedContracts,
      {
        vaultName: 'Service Stop Test Vault',
        wrapEthAmount: '2',
        swapTokens: [
          { from: 'WETH', to: 'USDC', amount: '1' }
        ],
        positions: [
          {
            token0: 'USDC',
            token1: 'WETH',
            fee: 500,
            percentOfAssets: 90,
            tickRange: { type: 'centered', spacing: 10 }
          }
        ],
        targetTokens: ['USDC', 'WETH'],
        targetPlatforms: ['uniswapV3']
      }
    );

    console.log('Test vault setup complete with executor set to automation service');

    // 3. Initialize and start the automation service to discover the pre-existing vault
    service = new AutomationService(testEnv.testConfig);

    // Add event listeners to capture service stop events
    service.eventManager.subscribe('VaultMonitoringStopped', (eventData) => {
      vaultMonitoringStoppedEvents.push(eventData);
      console.log('VaultMonitoringStopped event captured:', eventData.vaultAddress);
    });

    service.eventManager.subscribe('VaultPositionChecksCleared', (eventData) => {
      vaultPositionChecksClearedEvents.push(eventData);
      console.log('VaultPositionChecksCleared event captured:', eventData.vaultAddress);
    });

    await service.start();
    console.log('Service started and discovered pre-existing vault');

    // 4. Wait for initial vault setup to complete
    await waitForCondition(() => {
      const vault = service.vaultDataService.getVault(testVault.vaultAddress);
      return vault !== null;
    }, 60000, 500);

    // Verify vault is properly monitored
    const monitoredVault = service.vaultDataService.getVault(testVault.vaultAddress);
    expect(monitoredVault).toBeTruthy();
    console.log('Vault is being monitored by the service');
  }, 180000);

  afterAll(async () => {
    // Clean up blockchain environment
    await cleanupTestBlockchain(testEnv);
  });

  it('should cleanly stop the service and clean up all vault monitoring', async () => {
    console.log('Starting service stop test...');

    // 1. Verify service is running and monitoring the vault
    expect(service.isRunning).toBe(true);
    expect(service.isShuttingDown).toBe(false);
    const vaultsBefore = service.vaultDataService.getAllVaults();
    expect(vaultsBefore.length).toBe(1);
    expect(vaultsBefore[0].address.toLowerCase()).toBe(testVault.vaultAddress.toLowerCase());

    console.log('Pre-stop state verified - service running and monitoring vault');

    // 2. Stop the service
    const stopResult = await service.stop();

    console.log('Service stop completed');

    // 3. Verify service state after stop
    expect(stopResult).toBe(true);
    expect(service.isRunning).toBe(false);
    expect(service.isShuttingDown).toBe(true);

    // 4. Verify vault data service cache was cleared
    const vaultsAfter = service.vaultDataService.getAllVaults();
    expect(vaultsAfter.length).toBe(0);

    // 5. Verify vault locks were cleared
    expect(Object.keys(service.vaultLocks)).toHaveLength(0);

    // 5a. Verify pool listener cleanup
    expect(service.eventManager.poolToVaults).toEqual({});

    console.log('Pool listener cleanup verified after stop');

    // 5b. Verify emergency exit baseline cleanup
    const strategy = service.strategies.get('bob');
    expect(strategy.emergencyExitBaseline).toBeDefined();
    expect(Object.keys(strategy.emergencyExitBaseline)).toHaveLength(0);

    console.log('Emergency exit baseline cleanup verified after stop');

    // 5c. Verify SSE broadcaster was properly stopped
    expect(service.sseBroadcaster.isRunning).toBe(false);
    expect(service.sseBroadcaster.clients.size).toBe(0);

    console.log('SSE broadcaster cleanup verified after stop');

    console.log('Service state verified after stop');

    // 6. Verify monitoring stopped event was emitted
    expect(vaultMonitoringStoppedEvents.length).toBe(1);
    const monitoringStoppedEvent = vaultMonitoringStoppedEvents[0];
    expect(monitoringStoppedEvent.vaultAddress.toLowerCase()).toBe(testVault.vaultAddress.toLowerCase());
    expect(monitoringStoppedEvent.strategyId).toBe('bob');
    expect(monitoringStoppedEvent.success).toBe(true);
    expect(typeof monitoringStoppedEvent.listenersRemoved).toBe('number');
    // Should be 3 listeners: 1 pool listener + 2 config listeners (TargetTokensUpdated, TargetPlatformsUpdated)
    expect(monitoringStoppedEvent.listenersRemoved).toBe(3);

    console.log('VaultMonitoringStopped event verified');

    // 7. Verify position checks cleared event was emitted
    expect(vaultPositionChecksClearedEvents.length).toBe(1);
    const positionChecksClearedEvent = vaultPositionChecksClearedEvents[0];
    expect(positionChecksClearedEvent.vaultAddress.toLowerCase()).toBe(testVault.vaultAddress.toLowerCase());

    console.log('VaultPositionChecksCleared event verified');

    // 8. Verify service shutdown state
    expect(service.isShuttingDown).toBe(true);

    console.log('Post-stop event processing verified');

    // 9. Verify stopped service can be stopped again without error (idempotent)
    const secondStopResult = await service.stop();
    expect(secondStopResult).toBe(true);

    console.log('Idempotent stop behavior verified');

    console.log('Service stop workflow test completed successfully');
  }, 30000);
});
