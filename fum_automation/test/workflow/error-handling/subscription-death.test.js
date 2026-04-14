/**
 * @fileoverview Integration test for silent WebSocket subscription death
 * detection and recovery via SubscriptionCanary + reconnect refresh.
 *
 * Scenario: the WebSocket transport stays alive (getBlockNumber works,
 * ping/pong works) but eth_subscription notifications stop being delivered.
 * This is the documented Infura/Chainstack/Alchemy failure mode after idle
 * timeouts and the Hardhat subscription quirk the memory captured.
 *
 * Test strategy:
 * 1. Enable Hardhat interval mining at 1000ms so the canary has a steady
 *    stream of blocks to watch. 1000ms is the floor — anything shorter
 *    causes block.timestamp to race ahead of wall clock (Hardhat enforces
 *    monotonic per-block +1s bumps, and seconds are the native timestamp
 *    unit).
 * 2. Start the service with serviceHealthOverrides = { expectedBlockMsOverride: 1000 }
 *    so the canary is active on chainId 1337 for this test only (production
 *    config has expectedBlockMs: null for Hardhat forks).
 * 3. Wait for the canary to receive at least one block (healthy baseline).
 * 4. Monkey-patch provider._websocket.onmessage to silently drop inbound
 *    eth_subscription messages — this is exactly the silent-death shape.
 *    getBlockNumber still works (id-based JSON-RPC responses are not
 *    eth_subscription), ping/pong still works (control frames bypass
 *    onmessage), but newHeads notifications stop.
 * 5. Trigger a config change on the vault (setTargetTokens) — the on-chain
 *    event fires but the service never sees it due to the filter.
 * 6. Wait for the canary's deadline (2 × 1000 + 500 = 2500ms) to fire.
 *    ServiceHealth calls onUnhealthy → handleProviderDisconnect(1006) →
 *    attemptReconnection → reestablishEventListeners →
 *    refreshAuthorizationState + refreshVaultConfigs.
 * 7. Assert: canary fired, reconnect completed, and the refresh picked up
 *    the config change by reading it from chain.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import AutomationService from '../../../src/core/AutomationService.js';
import { setupTestBlockchain, cleanupTestBlockchain } from '../../helpers/hardhat-setup.js';
import { setupTestVault } from '../../helpers/test-vault-setup.js';
import { waitForCondition, sleep } from '../../helpers/wait-utils.js';
import { ethers } from 'ethers';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';

describe('Silent WebSocket subscription death', () => {
  let testEnv;
  let testConfig;
  let tempDir;
  let service;
  let testVault;

  beforeAll(async () => {
    testEnv = await setupTestBlockchain();
    testConfig = testEnv.testConfig;

    // Create the test vault while Hardhat is still on auto-mine. Interval
    // mining would slow the ~20 sequential deployment/setup txs to a crawl
    // and we'd burn wall-clock time waiting for each to be included.
    testVault = await setupTestVault(
      testEnv.hardhatServer,
      testEnv.contracts,
      testEnv.deployedContracts,
      {
        vaultName: 'Subscription Death Test Vault',
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

    console.log(`Test vault created: ${testVault.vaultAddress}`);

    // Flip Hardhat to interval mining at 1000ms so the canary has blocks
    // to watch. This is the floor that avoids Hardhat's per-block
    // timestamp drift. Restored in afterAll.
    await testEnv.hardhatServer.provider.send('evm_setIntervalMining', [1000]);
    console.log('Hardhat interval mining enabled (1000ms)');
  });

  afterAll(async () => {
    // Restore auto-mine-only so subsequent test files are unaffected.
    try {
      await testEnv.hardhatServer.provider.send('evm_setIntervalMining', [0]);
    } catch {
      // Hardhat may already be torn down — ignore.
    }
    await cleanupTestBlockchain(testEnv);
  });

  afterEach(async () => {
    vi.restoreAllMocks();

    if (service) {
      try {
        await service.stop(true);
      } catch {
        // ignore cleanup errors
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

  /**
   * Create a test AutomationService with the canary force-enabled via override.
   */
  const createTestService = async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'subdeath-test-'));

    service = new AutomationService({
      chainId: 1337,
      wsUrl: testConfig.wsUrl,
      dataDir: tempDir,
      ssePort: 3520,
      debug: true,
      retryIntervalMs: 999999999, // disable retry timer so it doesn't race
      vaultHealthIntervalMs: 0,
      // Force the canary on for chainId 1337 only inside this test.
      // Production (1337 with no override) keeps expectedBlockMs: null.
      serviceHealthOverrides: {
        expectedBlockMsOverride: 1000,
        pingIntervalMs: 60_000, // push ping/pong out of the way
        pongTimeoutMs: 30_000
      }
    });
  };

  /**
   * Silently drop inbound eth_subscription messages on the current provider.
   * Mimics Infura/Chainstack silent subscription death: transport alive,
   * ping/pong alive, id-based JSON-RPC replies still work, but no
   * subscription notifications delivered.
   *
   * @returns {Function} Restore function (call to undo the patch)
   */
  const installSubscriptionFilter = (provider) => {
    const ws = provider._websocket;
    const originalHandler = ws.onmessage;

    ws.onmessage = (messageEvent) => {
      try {
        const parsed = JSON.parse(messageEvent.data);
        if (parsed && parsed.method === 'eth_subscription') {
          // Silently drop — this is the failure mode we're simulating
          return;
        }
      } catch {
        // Non-JSON or parse error — pass through to the real handler
      }
      if (originalHandler) originalHandler(messageEvent);
    };

    return () => {
      ws.onmessage = originalHandler;
    };
  };

  it('canary detects silent death, reconnect recovers, refresh picks up missed config change', async () => {
    await createTestService();

    const events = {
      providerDisconnected: [],
      providerReconnected: [],
      providerFailed: []
    };

    service.eventManager.subscribe('ProviderDisconnected', (data) => {
      console.log(`  [EVENT] ProviderDisconnected: code=${data.code}, reason=${data.reason}`);
      events.providerDisconnected.push(data);
    });
    service.eventManager.subscribe('ProviderReconnected', (data) => {
      console.log(`  [EVENT] ProviderReconnected after ${data.attempts} attempt(s)`);
      events.providerReconnected.push(data);
    });
    service.eventManager.subscribe('ProviderFailed', (data) => {
      console.log(`  [EVENT] ProviderFailed after ${data.attempts} attempts`);
      events.providerFailed.push(data);
    });

    // Phase 1: Start service and wait for it to be healthy
    await service.start();

    await waitForCondition(
      () => service.vaultDataService.hasVault(testVault.vaultAddress),
      30000,
      250
    );

    expect(service.serviceHealth.running).toBe(true);
    expect(service.serviceHealth.isCanaryActive()).toBe(true);
    console.log('Service started, canary active (forced enabled on chainId 1337)');

    // Verify initial cached target tokens match what we configured
    const vaultBefore = await service.vaultDataService.getVault(testVault.vaultAddress);
    expect(vaultBefore.targetTokens).toEqual(['USDC', 'WETH']);

    // Phase 2: Let a few blocks arrive so canary baseline is healthy.
    // Interval mining is 1000ms → allow ~2 seconds → at least 1 block seen.
    await sleep(1500);

    // Phase 3: Install the silent-subscription-death filter on the
    // *current* provider. After this point, newHeads notifications stop.
    const provider0 = service.provider;
    const restore = installSubscriptionFilter(provider0);
    console.log('Subscription filter installed — eth_subscription messages now dropped');

    // Phase 4: Trigger the config change on-chain. The event will fire but
    // the service cannot see it via the normal path — recovery depends on
    // the refresh picking it up after reconnect.
    const newTargetTokens = ['WETH'];
    const setTx = await testVault.vault.setTargetTokens(newTargetTokens);
    await setTx.wait();
    console.log(`setTargetTokens(${JSON.stringify(newTargetTokens)}) tx mined`);

    // Phase 5: Wait for the canary to fire. Threshold = 2 × 1000 + 500 = 2500ms.
    // We already slept 1500ms before installing the filter; the canary's last
    // seen block is ~500ms ago at most. So deadline should fire within ~2500ms
    // from the install. Allow generous slack for reconnect backoff.
    await waitForCondition(
      () => events.providerDisconnected.length > 0,
      10_000,
      100
    );
    console.log('Canary fired ProviderDisconnected');

    expect(events.providerDisconnected.length).toBe(1);
    expect(events.providerDisconnected[0].code).toBe(1006);
    expect(events.providerDisconnected[0].reason).toMatch(/Canary/);

    // Phase 6: Wait for reconnect to complete (creates new provider, so the
    // filter on provider0 is now irrelevant — the new one is unpatched).
    await waitForCondition(
      () => events.providerReconnected.length > 0,
      30_000,
      250
    );
    console.log('Reconnect complete');

    expect(events.providerFailed.length).toBe(0);
    expect(service.provider).not.toBe(provider0); // new provider instance

    // Phase 7: The refresh pass should have picked up the missed config
    // change when it read on-chain state after reconnection.
    const vaultAfter = await service.vaultDataService.getVault(testVault.vaultAddress);
    expect(vaultAfter.targetTokens).toEqual(['WETH']);
    console.log('Cache reflects on-chain change picked up by refresh pass');

    // Phase 8: Verify ServiceHealth is running again against the new provider
    expect(service.serviceHealth.running).toBe(true);
    expect(service.serviceHealth.isCanaryActive()).toBe(true);
    expect(service.serviceHealth.isKeepaliveActive()).toBe(true);

    // Cleanup: restore the patched function (no-op since provider0 is dead
    // and garbage collectable, but good hygiene).
    restore();
  });
});
