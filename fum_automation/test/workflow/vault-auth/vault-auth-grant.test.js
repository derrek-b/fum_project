/**
 * @fileoverview Integration test for VaultAuthGranted event handling workflow
 * Tests the flow: ExecutorChanged event → VaultAuthGranted → setupVault → VaultOnboarded
 *
 * Key difference from service-init tests: Service starts FIRST with no vaults,
 * then vault is created which triggers the authorization flow.
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

describe('VaultAuthGranted Workflow', () => {
  let testEnv;
  let testConfig;
  let service;
  let testVault;
  // Event capture
  let vaultAuthGrantedEvent = null;
  let vaultOnboardedEvent = null;
  let baselineCapturedEvent = null;
  let monitoringStartedEvent = null;
  let vaultFailedEvent = null;

  beforeAll(async () => {
    // 1. Setup blockchain
    testEnv = await setupTestBlockchain();
    testConfig = testEnv.testConfig;

    // 2. Create service
    service = new AutomationService(testConfig);

    // 3. Subscribe to events BEFORE starting
    service.eventManager.subscribe('VaultAuthGranted', (data) => {
      vaultAuthGrantedEvent = data;
      console.log('VaultAuthGranted event captured:', data.vaultAddress);
    });

    service.eventManager.subscribe('VaultOnboarded', (data) => {
      vaultOnboardedEvent = data;
      console.log('VaultOnboarded event captured:', data.vaultAddress);
    });

    service.eventManager.subscribe('VaultBaselineCaptured', (data) => {
      baselineCapturedEvent = data;
      console.log('VaultBaselineCaptured event captured:', data.vaultAddress);
    });

    service.eventManager.subscribe('MonitoringStarted', (data) => {
      monitoringStartedEvent = data;
      console.log('MonitoringStarted event captured:', data.vaultAddress);
    });

    service.eventManager.subscribe('VaultFailed', (data) => {
      vaultFailedEvent = data;
      console.log('VaultFailed event captured:', data.vaultAddress);
    });

    // 4. Start service (no vaults exist yet)
    await service.start();
    console.log('Service started with 0 vaults, monitoring for authorization events...');

    // Verify no vaults loaded
    expect(service.vaultDataService.getAllVaults().length).toBe(0);

    // 5. Create vault - triggers ExecutorChanged → VaultAuthGranted
    console.log('Creating test vault (will trigger ExecutorChanged event)...');
    testVault = await setupTestVault(
      testEnv.hardhatServer,
      testEnv.contracts,
      testEnv.deployedContracts,
      {
        vaultName: 'VaultAuthGranted Test Vault',
        automationServiceAddress: testConfig.automationServiceAddress,
        wrapEthAmount: '10',
        swapTokens: [
          { from: 'WETH', to: 'USDC', amount: '2' }
        ],
        positions: [
          {
            token0: 'USDC',
            token1: 'WETH',
            fee: 500,
            percentOfAssets: 20,
            tickRange: { type: 'centered', spacing: 10 }
          }
        ],
        tokenTransfers: {
          'USDC': 60
        },
        targetTokens: ['USDC', 'WETH'],
        targetPlatforms: ['uniswapV3']
      }
    );

    console.log('Test vault created at:', testVault.vaultAddress);

    // 6. Wait for event chain to complete (VaultOnboarded or VaultFailed)
    console.log('Waiting for onboarding to complete...');
    await waitForCondition(
      () => vaultOnboardedEvent !== null || vaultFailedEvent !== null,
      90000, // 90 second timeout
      500    // poll every 500ms
    );

  }, 180000); // 3 minute overall timeout

  afterAll(async () => {
    if (service?.isRunning) {
      try {
        await service.stop();
      } catch (error) {
        console.warn('Error stopping service:', error.message);
      }
    }
    await cleanupTestBlockchain(testEnv);
  });

  it('should emit VaultAuthGranted with correct addresses', () => {
    expect(vaultAuthGrantedEvent).not.toBeNull();
    expect(vaultAuthGrantedEvent).toHaveProperty('vaultAddress');
    expect(vaultAuthGrantedEvent).toHaveProperty('executorAddress');

    expect(vaultAuthGrantedEvent.vaultAddress.toLowerCase()).toBe(
      testVault.vaultAddress.toLowerCase()
    );
    expect(vaultAuthGrantedEvent.executorAddress.toLowerCase()).toBe(
      testConfig.automationServiceAddress.toLowerCase()
    );

    console.log('VaultAuthGranted verified:');
    console.log(`  Vault: ${vaultAuthGrantedEvent.vaultAddress}`);
    console.log(`  Executor: ${vaultAuthGrantedEvent.executorAddress}`);
  });

  it('should emit VaultOnboarded after successful setup', () => {
    // If VaultFailed was emitted instead, fail with details
    if (vaultFailedEvent) {
      console.error('VaultFailed event:', vaultFailedEvent);
      throw new Error(`Vault onboarding failed: ${vaultFailedEvent.error}`);
    }

    expect(vaultOnboardedEvent).not.toBeNull();
    expect(vaultOnboardedEvent.vaultAddress.toLowerCase()).toBe(
      testVault.vaultAddress.toLowerCase()
    );
    expect(vaultOnboardedEvent.strategyId).toBe('bob');
    expect(vaultOnboardedEvent.positionCount).toBeGreaterThanOrEqual(0);

    console.log('VaultOnboarded verified:');
    console.log(`  Vault: ${vaultOnboardedEvent.vaultAddress}`);
    console.log(`  Strategy: ${vaultOnboardedEvent.strategyId}`);
    console.log(`  Positions: ${vaultOnboardedEvent.positionCount}`);
  });

  it('should capture baseline for newly authorized vault', () => {
    expect(baselineCapturedEvent).not.toBeNull();
    expect(baselineCapturedEvent.vaultAddress.toLowerCase()).toBe(
      testVault.vaultAddress.toLowerCase()
    );
    expect(baselineCapturedEvent.totalVaultValue).toBeGreaterThan(0);

    console.log('VaultBaselineCaptured verified:');
    console.log(`  Vault: ${baselineCapturedEvent.vaultAddress}`);
    console.log(`  Total Value: $${baselineCapturedEvent.totalVaultValue.toFixed(2)}`);
  });

  it('should start monitoring for newly authorized vault', () => {
    expect(monitoringStartedEvent).not.toBeNull();
    expect(monitoringStartedEvent.vaultAddress.toLowerCase()).toBe(
      testVault.vaultAddress.toLowerCase()
    );

    console.log('MonitoringStarted verified:');
    console.log(`  Vault: ${monitoringStartedEvent.vaultAddress}`);
  });

  it('should have vault in VaultDataService after onboarding', () => {
    const vaults = service.vaultDataService.getAllVaults();
    expect(vaults.length).toBe(1);

    const loadedVault = vaults[0];
    expect(loadedVault.address.toLowerCase()).toBe(
      testVault.vaultAddress.toLowerCase()
    );

    console.log('VaultDataService verified:');
    console.log(`  Vault count: ${vaults.length}`);
    console.log(`  Vault address: ${loadedVault.address}`);
  });

  it('should have vault tracked in Tracker', () => {
    const metadata = service.tracker.getMetadata(testVault.vaultAddress);
    expect(metadata).not.toBeNull();
    expect(metadata.baseline).toBeDefined();
    expect(metadata.baseline.value).toBeGreaterThan(0);

    console.log('Tracker metadata verified:');
    console.log(`  Baseline value: $${metadata.baseline.value.toFixed(2)}`);
  });
});
