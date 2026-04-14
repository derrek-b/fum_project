/**
 * @fileoverview Integration test for PingPongKeepalive transport-death
 * detection and recovery.
 *
 * Scenario: the WebSocket transport is silently dead — an upstream proxy/LB
 * stopped forwarding packets, or the remote node's TCP connection is
 * half-dead without a close event. Ping frames are sent but pongs never
 * come back.
 *
 * Test strategy: spy on `provider._websocket.emit` so that the pong event
 * is silently dropped. Pings are actually sent by the `ws` package and the
 * node actually replies with pong frames, but the PingPongKeepalive never
 * sees the `'pong'` event fire on its handler. From the keepalive's point
 * of view, the transport is dead.
 *
 * The canary is kept disabled for this test (no expectedBlockMsOverride)
 * so only the ping/pong path can fire onUnhealthy.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import AutomationService from '../../../src/core/AutomationService.js';
import { setupTestBlockchain, cleanupTestBlockchain } from '../../helpers/hardhat-setup.js';
import { setupTestVault } from '../../helpers/test-vault-setup.js';
import { waitForCondition } from '../../helpers/wait-utils.js';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';

describe('PingPongKeepalive transport death', () => {
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
        vaultName: 'Ping Timeout Test Vault',
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
  });

  afterAll(async () => {
    await cleanupTestBlockchain(testEnv);
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

  const createTestService = async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pingtimeout-test-'));

    service = new AutomationService({
      chainId: 1337,
      wsUrl: testConfig.wsUrl,
      dataDir: tempDir,
      ssePort: 3521,
      debug: true,
      retryIntervalMs: 999999999,
      vaultHealthIntervalMs: 0,
      // Canary disabled (no expectedBlockMsOverride → chain config null for
      // 1337 is used → canary is a no-op). Ping/pong is active with tight
      // timings so the test runs fast.
      serviceHealthOverrides: {
        pingIntervalMs: 1000,
        pongTimeoutMs: 500
      }
    });
  };

  /**
   * Install a filter on the WebSocket's `emit` method that silently
   * swallows the `'pong'` event. Other events (message, close, error)
   * pass through untouched. Simulates the PingPongKeepalive's view of a
   * half-dead transport.
   *
   * @returns {Function} Restore function
   */
  const suppressPongEvents = (provider) => {
    const ws = provider._websocket;
    const originalEmit = ws.emit.bind(ws);
    ws.emit = function (eventName, ...args) {
      if (eventName === 'pong') {
        return false; // silently drop — keepalive never sees pong
      }
      return originalEmit(eventName, ...args);
    };
    return () => {
      ws.emit = originalEmit;
    };
  };

  it('keepalive detects pong timeout, reconnect recovers', async () => {
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

    // Phase 1: Start and wait for healthy state
    await service.start();
    await waitForCondition(
      () => service.vaultDataService.hasVault(testVault.vaultAddress),
      30000,
      250
    );

    expect(service.serviceHealth.running).toBe(true);
    // Canary stays disabled on 1337 (no override)
    expect(service.serviceHealth.isCanaryActive()).toBe(false);
    expect(service.serviceHealth.isKeepaliveActive()).toBe(true);
    console.log('Service started, keepalive active, canary disabled (chain 1337 default)');

    // Phase 2: Suppress pong events on the current provider's websocket
    const provider0 = service.provider;
    const restore = suppressPongEvents(provider0);
    console.log('Pong events suppressed on current provider');

    // Phase 3: Wait for keepalive to fire.
    // Ping every 1000ms, pong timeout 500ms.
    // Worst case: ping just fired before suppress → wait ~1000ms until next
    // ping → 500ms pong timeout → onUnhealthy at ~1500ms. Allow slack.
    await waitForCondition(
      () => events.providerDisconnected.length > 0,
      10_000,
      100
    );

    expect(events.providerDisconnected.length).toBe(1);
    expect(events.providerDisconnected[0].code).toBe(1006);
    expect(events.providerDisconnected[0].reason).toMatch(/Ping/);
    console.log(`Keepalive fired: ${events.providerDisconnected[0].reason}`);

    // Phase 4: Reconnect should succeed against a fresh provider
    await waitForCondition(
      () => events.providerReconnected.length > 0,
      30_000,
      250
    );

    expect(events.providerFailed.length).toBe(0);
    expect(service.provider).not.toBe(provider0);
    console.log('Reconnect complete, new provider attached');

    // Phase 5: ServiceHealth is running against the new provider
    expect(service.serviceHealth.running).toBe(true);
    expect(service.serviceHealth.isKeepaliveActive()).toBe(true);
    expect(service.serviceHealth.isCanaryActive()).toBe(false);

    // Cleanup
    restore();
  });
});
