/**
 * @fileoverview Integration test for vault ownership verification failure
 * Tests the flow: loadAuthorizedVaults → executor verification RPC fails → vault blacklisted
 *
 * When the service can't verify a vault's executor belongs to its HD wallet (RPC failure),
 * it blacklists the vault rather than risking managing someone else's vault or silently
 * skipping it. The user can re-authorize to clear the blacklist once RPC recovers.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import AutomationService from '../../../src/core/AutomationService.js';
import { setupTestBlockchain, cleanupTestBlockchain } from '../../helpers/hardhat-setup.js';
import { setupTestVault } from '../../helpers/test-vault-setup.js';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';

// Controlled mock for getVaultExecutorIndex — null means pass-through to real implementation
let failForVaultAddress = null;

vi.mock('fum_library', async () => {
  const actual = await vi.importActual('fum_library');
  return {
    ...actual,
    getVaultExecutorIndex: vi.fn().mockImplementation(async (vaultAddress, provider) => {
      if (failForVaultAddress && vaultAddress.toLowerCase() === failForVaultAddress.toLowerCase()) {
        throw new Error('NETWORK_ERROR: Connection refused during executor index fetch');
      }
      return actual.getVaultExecutorIndex(vaultAddress, provider);
    })
  };
});

describe('Ownership Verification Failure → Blacklist', () => {
  let testEnv;
  let testConfig;
  let tempDir;
  let service;
  let testVault;

  beforeAll(async () => {
    testEnv = await setupTestBlockchain();
    testConfig = testEnv.testConfig;

    testVault = await setupTestVault(
      testEnv.hardhatServer,
      testEnv.contracts,
      testEnv.deployedContracts,
      {
        vaultName: 'Ownership Verification Test',
        wrapEthAmount: '1',
        swapTokens: [],
        positions: [],
        tokenTransfers: {},
        targetTokens: ['USDC', 'WETH'],
        targetPlatforms: ['uniswapV3'],
        strategy: 'bob'
      }
    );
    console.log(`Test vault created at: ${testVault.vaultAddress}`);
  });

  afterAll(async () => {
    await cleanupTestBlockchain(testEnv);
  });

  afterEach(async () => {
    failForVaultAddress = null;

    if (service) {
      try { await service.stop(true); } catch (e) { /* ignore */ }
      service = null;
    }

    if (tempDir) {
      try { await fs.rm(tempDir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
      tempDir = null;
    }
  });

  it('should blacklist vault when executor ownership verification fails', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ownership-test-'));

    service = new AutomationService({
      chainId: 1337,
      wsUrl: testConfig.wsUrl,
      dataDir: tempDir,
      ssePort: 3130,
      debug: true
    });

    const blacklistedEvents = [];
    const vaultsLoadedEvents = [];

    service.eventManager.subscribe('VaultBlacklisted', (data) => {
      blacklistedEvents.push(data);
      console.log(`VaultBlacklisted: ${data.vaultAddress?.slice(0, 10)}... reason=${data.reason}`);
    });

    service.eventManager.subscribe('VaultsLoaded', (data) => {
      vaultsLoadedEvents.push(data);
    });

    // Activate the mock — ownership verification will fail for our vault
    failForVaultAddress = testVault.vaultAddress;

    await service.start();

    // Service should still be running (individual vault failure doesn't crash)
    expect(service.isRunning).toBe(true);

    // Vault should be blacklisted, not in retry queue
    expect(service.isVaultBlacklisted(testVault.vaultAddress)).toBe(true);
    expect(service.failedVaults.has(testVault.vaultAddress)).toBe(false);

    // Not tracked in VDS
    expect(service.vaultDataService.hasVault(testVault.vaultAddress)).toBe(false);

    // VaultBlacklisted event with ownership verification reason
    const blacklistEvent = blacklistedEvents.find(
      e => e.vaultAddress?.toLowerCase() === testVault.vaultAddress.toLowerCase()
    );
    expect(blacklistEvent).toBeDefined();
    expect(blacklistEvent.reason).toContain('Ownership verification failed');

    // VaultsLoaded should reflect the failure
    expect(vaultsLoadedEvents.length).toBe(1);
    expect(vaultsLoadedEvents[0].failed).toBeGreaterThanOrEqual(1);

    console.log('Ownership verification failure → blacklist test passed');
  });
});
