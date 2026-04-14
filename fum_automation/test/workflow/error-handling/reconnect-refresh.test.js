/**
 * @fileoverview Comprehensive integration tests for the reconnect-refresh
 * path: covers all paths through refreshVaultConfigs and refreshAuthorizationState
 * that aren't exercised by the basic subscription-death test.
 *
 * Shared setup (beforeAll):
 *   - Create one fully-configured primary vault
 *   - Enable Hardhat interval mining at 1000ms so the canary has blocks to watch
 *   - Take a snapshot after setup so each test reverts to the same baseline
 *
 * Each test:
 *   - Reverts to the baseline snapshot
 *   - Creates a fresh service with `expectedBlockMsOverride: 1000` (canary on)
 *   - Drives the service into some state
 *   - Triggers a silent subscription death to force canary → reconnect → refresh
 *   - Asserts on what the refresh path did
 *
 * Covers:
 *   refreshVaultConfigs:
 *     1. Target platforms changed
 *     2. Strategy parameters changed
 *     3. Config update queued for locked vault
 *   refreshAuthorizationState:
 *     4. On-chain vault not in cache → synthetic VaultAuthGranted
 *     5. Cached vault no longer on-chain → synthetic VaultAuthRevoked
 *     6. HD-tree ownership verification fails → skipped
 *
 * The "target tokens changed" and "no changes" paths are already covered by
 * subscription-death.test.js and ping-timeout.test.js respectively.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { ethers } from 'ethers';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import AutomationService from '../../../src/core/AutomationService.js';
import { setupTestBlockchain, cleanupTestBlockchain } from '../../helpers/hardhat-setup.js';
import { setupTestVault } from '../../helpers/test-vault-setup.js';
import { waitForCondition, sleep } from '../../helpers/wait-utils.js';

describe('Reconnect refresh — comprehensive coverage', () => {
  let testEnv;
  let testConfig;
  let service;
  let tempDir;
  let primaryVault;
  let baseSnapshot;

  // --- Shared helpers ---

  const installSilentDeathFilter = (provider) => {
    const ws = provider._websocket;
    const originalHandler = ws.onmessage;
    ws.onmessage = (messageEvent) => {
      try {
        const parsed = JSON.parse(messageEvent.data);
        if (parsed && parsed.method === 'eth_subscription') return;
      } catch {
        // non-JSON — pass through
      }
      if (originalHandler) originalHandler(messageEvent);
    };
    return () => { ws.onmessage = originalHandler; };
  };

  const createTestService = async (ssePort) => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'refresh-cov-'));
    service = new AutomationService({
      chainId: 1337,
      wsUrl: testConfig.wsUrl,
      dataDir: tempDir,
      ssePort,
      debug: true,
      retryIntervalMs: 999999999,
      vaultHealthIntervalMs: 0,
      serviceHealthOverrides: {
        expectedBlockMsOverride: 1000,
        pingIntervalMs: 60_000, // push ping/pong out of the way
        pongTimeoutMs: 30_000
      }
    });
    return service;
  };

  const trackReconnectEvents = (svc) => {
    const events = { disconnected: [], reconnecting: [], reconnected: [], failed: [] };
    svc.eventManager.subscribe('ProviderDisconnected', (d) => events.disconnected.push(d));
    svc.eventManager.subscribe('ProviderReconnecting', (d) => events.reconnecting.push(d));
    svc.eventManager.subscribe('ProviderReconnected', (d) => events.reconnected.push(d));
    svc.eventManager.subscribe('ProviderFailed', (d) => events.failed.push(d));
    return events;
  };

  const startAndSettle = async (ssePort) => {
    await createTestService(ssePort);
    await service.start();
    // Let a few blocks arrive so canary baseline is healthy
    await sleep(1500);
  };

  // --- Test lifecycle ---

  beforeAll(async () => {
    testEnv = await setupTestBlockchain();
    testConfig = testEnv.testConfig;

    primaryVault = await setupTestVault(
      testEnv.hardhatServer,
      testEnv.contracts,
      testEnv.deployedContracts,
      {
        vaultName: 'Reconnect Refresh Test Vault',
        wrapEthAmount: '5',
        swapTokens: [{ from: 'WETH', to: 'USDC', amount: '1' }],
        positions: [
          {
            token0: 'USDC',
            token1: 'WETH',
            fee: 500,
            percentOfAssets: 100,
            tickRange: { type: 'centered', spacing: 20 }
          }
        ],
        targetTokens: ['USDC', 'WETH'],
        targetPlatforms: ['uniswapV3'],
        strategy: 'bob'
      }
    );
    console.log(`Primary vault: ${primaryVault.vaultAddress}`);

    await testEnv.hardhatServer.provider.send('evm_setIntervalMining', [1000]);
    baseSnapshot = await testEnv.hardhatServer.provider.send('evm_snapshot', []);
  });

  afterAll(async () => {
    try {
      await testEnv.hardhatServer.provider.send('evm_setIntervalMining', [0]);
    } catch {
      // ignore
    }
    await cleanupTestBlockchain(testEnv);
  });

  beforeEach(async () => {
    await testEnv.hardhatServer.provider.send('evm_revert', [baseSnapshot]);
    baseSnapshot = await testEnv.hardhatServer.provider.send('evm_snapshot', []);
  });

  afterEach(async () => {
    vi.restoreAllMocks();

    if (service) {
      try {
        await service.stop(true);
      } catch {
        // ignore
      }
      service = null;
    }

    if (tempDir) {
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
      tempDir = null;
    }
  });

  // ---------------------------------------------------------------
  // refreshVaultConfigs
  // ---------------------------------------------------------------
  describe('refreshVaultConfigs', () => {
    it('detects and applies target platforms changes on reconnect', async () => {
      await startAndSettle(3540);
      const events = trackReconnectEvents(service);
      const vaultAddr = ethers.utils.getAddress(primaryVault.vaultAddress);

      const vaultBefore = await service.vaultDataService.getVault(vaultAddr);
      expect(vaultBefore.targetPlatforms).toEqual(['uniswapV3']);

      installSilentDeathFilter(service.provider);

      const tx = await primaryVault.vault.setTargetPlatforms([]);
      await tx.wait();

      await waitForCondition(() => events.reconnected.length > 0, 30_000, 250);

      const vaultAfter = await service.vaultDataService.getVault(vaultAddr);
      expect(vaultAfter.targetPlatforms).toEqual([]);
    });

    it('detects and applies strategy parameter changes on reconnect', async () => {
      await startAndSettle(3541);
      const events = trackReconnectEvents(service);
      const vaultAddr = ethers.utils.getAddress(primaryVault.vaultAddress);

      const vaultBefore = await service.vaultDataService.getVault(vaultAddr);
      const paramsBefore = JSON.stringify(vaultBefore.strategy.parameters);
      expect(paramsBefore).toBeDefined();

      // Authorize the vault on the strategy contract so it can call parameter setters
      const ownerSigner = testEnv.hardhatServer.signers[0];
      const strategyAuthContract = new ethers.Contract(
        testEnv.deployedContracts.BabyStepsStrategy,
        ['function authorizeVault(address vault) external'],
        ownerSigner
      );
      await (await strategyAuthContract.authorizeVault(vaultAddr)).wait();

      installSilentDeathFilter(service.provider);

      // Change risk parameters via vault.execute → strategy.setRiskParameters
      // onlyAuthorizedVault modifier requires msg.sender == vault, so the vault
      // has to forward the call.
      const strategyInterface = new ethers.utils.Interface([
        'function setRiskParameters(uint16 slippage, uint16 exitTrigger) external'
      ]);
      const calldata = strategyInterface.encodeFunctionData('setRiskParameters', [200, 1500]);

      const execTx = await primaryVault.vault.execute(
        [testEnv.deployedContracts.BabyStepsStrategy],
        [calldata]
      );
      await execTx.wait();

      await waitForCondition(() => events.reconnected.length > 0, 30_000, 250);

      const vaultAfter = await service.vaultDataService.getVault(vaultAddr);
      const paramsAfter = JSON.stringify(vaultAfter.strategy.parameters);
      expect(paramsAfter).not.toBe(paramsBefore);
    });

    it('queues config updates for locked vaults instead of applying immediately', async () => {
      await startAndSettle(3542);
      const events = trackReconnectEvents(service);
      const vaultAddr = ethers.utils.getAddress(primaryVault.vaultAddress);

      const vaultBefore = await service.vaultDataService.getVault(vaultAddr);
      expect(vaultBefore.targetTokens).toEqual(['USDC', 'WETH']);

      // Lock the vault manually — refresh should see it's locked and queue
      const lockAcquired = service.lockVault(vaultAddr);
      expect(lockAcquired).toBe(true);

      installSilentDeathFilter(service.provider);

      const tx = await primaryVault.vault.setTargetTokens(['WETH']);
      await tx.wait();

      await waitForCondition(() => events.reconnected.length > 0, 30_000, 250);

      // Cache unchanged — the refresh detected the change but queued it
      const vaultAfterReconnect = await service.vaultDataService.getVault(vaultAddr);
      expect(vaultAfterReconnect.targetTokens).toEqual(['USDC', 'WETH']);

      // Queue should contain the tokens update
      expect(service.pendingConfigUpdates.has(vaultAddr)).toBe(true);
      const queue = service.pendingConfigUpdates.get(vaultAddr);
      const tokensUpdate = queue.find(u => u.type === 'tokens');
      expect(tokensUpdate).toBeDefined();
      expect(tokensUpdate.data).toEqual(['WETH']);

      // Unlock the vault — VaultUnlocked handler drains the queue via processPendingConfigUpdates
      service.unlockVault(vaultAddr);

      await waitForCondition(
        () => !service.pendingConfigUpdates.has(vaultAddr),
        5000,
        100
      );

      const vaultFinal = await service.vaultDataService.getVault(vaultAddr);
      expect(vaultFinal.targetTokens).toEqual(['WETH']);
    });
  });

  // ---------------------------------------------------------------
  // refreshAuthorizationState
  // ---------------------------------------------------------------
  describe('refreshAuthorizationState', () => {
    it('detects on-chain vault missing from cache and emits VaultAuthGranted', async () => {
      await startAndSettle(3543);
      const events = trackReconnectEvents(service);
      const vaultAddr = ethers.utils.getAddress(primaryVault.vaultAddress);

      expect(service.vaultDataService.hasVault(vaultAddr)).toBe(true);

      // Simulate "service never saw the grant event" by wiping the cache.
      // The vault is still active on-chain (still in factory.getActiveVaults()).
      // The refresh should detect it as "on-chain but not cached" and
      // trigger the synthetic VaultAuthGranted → setupVault path.
      service.vaultDataService.clearCache();
      expect(service.vaultDataService.hasVault(vaultAddr)).toBe(false);

      installSilentDeathFilter(service.provider);

      await waitForCondition(() => events.reconnected.length > 0, 60_000, 250);

      // setupVault is async and runs after the grant event fires — wait for it
      await waitForCondition(
        () => service.vaultDataService.hasVault(vaultAddr),
        30_000,
        250
      );

      expect(service.vaultDataService.hasVault(vaultAddr)).toBe(true);
    });

    it('detects cached vault no longer active on-chain and emits VaultAuthRevoked', async () => {
      await startAndSettle(3544);
      const events = trackReconnectEvents(service);
      const vaultAddr = ethers.utils.getAddress(primaryVault.vaultAddress);

      expect(service.vaultDataService.hasVault(vaultAddr)).toBe(true);

      installSilentDeathFilter(service.provider);

      // Revoke on-chain via removeExecutor — this deregisters from activeVaults
      const revokeTx = await primaryVault.vault.removeExecutor();
      await revokeTx.wait();

      await waitForCondition(() => events.reconnected.length > 0, 30_000, 250);

      // Give offboardVault time to complete asynchronously
      await waitForCondition(
        () => !service.vaultDataService.hasVault(vaultAddr),
        10_000,
        250
      );

      expect(service.vaultDataService.hasVault(vaultAddr)).toBe(false);
    });

    it('skips vault when HD-tree ownership verification fails', async () => {
      await startAndSettle(3545);
      const events = trackReconnectEvents(service);
      const vaultAddr = ethers.utils.getAddress(primaryVault.vaultAddress);

      // Replace the service's HD node with a different mnemonic. The primary
      // vault's on-chain executor was derived from the original mnemonic, so
      // verification will now mismatch.
      const otherMnemonic = 'test test test test test test test test test test test junk';
      service.hdNode = ethers.utils.HDNode.fromMnemonic(otherMnemonic);

      // Clear the cache to force refresh to hit the "grant" path for the primary
      service.vaultDataService.clearCache();
      expect(service.vaultDataService.hasVault(vaultAddr)).toBe(false);

      installSilentDeathFilter(service.provider);

      await waitForCondition(() => events.reconnected.length > 0, 30_000, 250);

      // Give refresh time to complete its skip decision
      await sleep(1500);

      // Vault must NOT be added to cache — refresh hit HD verification failure
      expect(service.vaultDataService.hasVault(vaultAddr)).toBe(false);
    });
  });
});
