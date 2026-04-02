/**
 * @fileoverview Integration test for empty vault (no assets, no positions)
 * Tests vault initialization when the vault has zero value — immediate blacklist.
 *
 * Scenario: 0 Positions / 0 Tokens (Empty Vault)
 * - Vault exists on-chain with strategy and executor configured
 * - No tokens deposited, no positions created
 * - Strategy throws UnrecoverableError (empty vault cannot be managed)
 * - Vault is blacklisted immediately (not added to retry queue)
 *
 * Note: The frontend prevents enabling automation on empty vaults (TVL > 0 check),
 * so this only happens via direct contract interaction. The automation service
 * still needs to handle it gracefully.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import AutomationService from '../../../src/core/AutomationService.js';
import { setupTestBlockchain, cleanupTestBlockchain } from '../../helpers/hardhat-setup.js';
import { setupTestVault } from '../../helpers/test-vault-setup.js';

describe('BS-0000: Empty Vault (Immediate Blacklist)', () => {
  let testEnv;
  let testVault;
  let service;
  let testConfig;

  // Event capture
  let vaultBlacklistedEvents = [];
  let vaultFailedEvents = [];
  let vaultSetupFailedEvents = [];
  let vaultSetupCompleteEvents = [];

  beforeAll(async () => {
    testEnv = await setupTestBlockchain();
    testConfig = testEnv.testConfig;

    // Create vault with NO assets — only on-chain configuration
    testVault = await setupTestVault(
      testEnv.hardhatServer,
      testEnv.contracts,
      testEnv.deployedContracts,
      {
        vaultName: 'BS-0000: Empty Vault',
        wrapEthAmount: '0',
        nativeEthAmount: null,
        swapTokens: [],
        positions: [],
        tokenTransfers: {},
        targetTokens: ['USDC', 'WETH'],
        targetPlatforms: ['uniswapV3'],
        strategy: 'bob'
      }
    );

    console.log(`Empty test vault created at: ${testVault.vaultAddress}`);
  }, 180000);

  afterAll(async () => {
    if (service?.isRunning) {
      try { await service.stop(); } catch (e) { /* ignore */ }
    }
    await cleanupTestBlockchain(testEnv);
  });

  it('should discover empty vault and blacklist immediately', async () => {
    service = new AutomationService(testConfig);

    service.eventManager.subscribe('VaultBlacklisted', (data) => {
      vaultBlacklistedEvents.push(data);
      console.log(`VaultBlacklisted: ${data.vaultAddress?.slice(0, 10)}... reason=${data.reason}`);
    });

    service.eventManager.subscribe('VaultFailed', (data) => {
      vaultFailedEvents.push(data);
    });

    service.eventManager.subscribe('VaultSetupFailed', (data) => {
      vaultSetupFailedEvents.push(data);
      console.log(`VaultSetupFailed: step=${data.step}`);
    });

    service.eventManager.subscribe('VaultSetupComplete', (data) => {
      vaultSetupCompleteEvents.push(data);
    });

    await service.start();

    // Vault should be blacklisted, NOT in retry queue
    expect(service.isVaultBlacklisted(testVault.vaultAddress)).toBe(true);
    expect(service.failedVaults.has(testVault.vaultAddress)).toBe(false);
  }, 120000);

  it('should NOT have completed vault setup', () => {
    const setupComplete = vaultSetupCompleteEvents.find(
      e => e.vaultAddress === testVault.vaultAddress
    );
    expect(setupComplete).toBeUndefined();
  });

  it('should have emitted VaultSetupFailed at strategy_initialization step', () => {
    const setupFailed = vaultSetupFailedEvents.find(
      e => e.vaultAddress === testVault.vaultAddress
    );
    expect(setupFailed).toBeDefined();
    expect(setupFailed.step).toBe('strategy_initialization');
  });

  it('should have emitted VaultBlacklisted with empty vault reason', () => {
    const blacklistEvent = vaultBlacklistedEvents.find(
      e => e.vaultAddress?.toLowerCase() === testVault.vaultAddress.toLowerCase()
    );
    expect(blacklistEvent).toBeDefined();
    expect(blacklistEvent.reason).toContain('Empty vault');
  });

  it('should NOT be tracked in VaultDataService', () => {
    expect(service.vaultDataService.hasVault(testVault.vaultAddress)).toBe(false);
  });
});
