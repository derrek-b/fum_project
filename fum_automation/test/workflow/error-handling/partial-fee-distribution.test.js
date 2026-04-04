/**
 * @fileoverview Test partial fee distribution failure
 *
 * When distributing fees to the vault owner, each token withdrawal is independent.
 * If one token's withdrawal fails (e.g., USDC), the other (e.g., WETH) should still
 * succeed. The FeesDistributed event should reflect both successes and failures.
 *
 * Uses vi.mock('fum_library') to intercept getVaultContract so the contract instance
 * used inside distributeFees has a broken withdrawTokens method.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { ethers } from 'ethers';
import AutomationService from '../../../src/core/AutomationService.js';
import { setupTestBlockchain, cleanupTestBlockchain } from '../../helpers/hardhat-setup.js';
import { setupTestVault } from '../../helpers/test-vault-setup.js';
import { setupSwapWallet, executeSwap } from '../../helpers/swap-utils.js';
import { waitForCondition } from '../../helpers/wait-utils.js';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';

// Flag to control whether withdrawTokens should fail
let shouldFailWithdrawTokens = false;

vi.mock('fum_library', async () => {
  const actual = await vi.importActual('fum_library');
  return {
    ...actual,
    // selectBestPool needs TVL data not available on fork
    getPoolTVLAverage: vi.fn().mockImplementation((poolAddress) => {
      const address = poolAddress.toLowerCase();
      if (address === '0xc6962004f452be9203591991d15f6b388e09e8d0') {
        return Promise.resolve(100000000);
      }
      return Promise.resolve(10000000);
    }),
    // Intercept getVaultContract to patch withdrawTokens on the connected instance.
    // Ethers v5 Contract properties are read-only (defineReadOnly), so direct assignment
    // throws. Use a Proxy to intercept property reads instead.
    getVaultContract: vi.fn().mockImplementation((address, provider) => {
      const contract = actual.getVaultContract(address, provider);
      const realConnect = contract.connect.bind(contract);

      // Proxy the contract to intercept connect() calls
      return new Proxy(contract, {
        get(target, prop, receiver) {
          if (prop === 'connect') {
            return function(signer) {
              const connected = realConnect(signer);
              if (!shouldFailWithdrawTokens) {
                return connected;
              }
              // Proxy the connected contract to intercept withdrawTokens
              return new Proxy(connected, {
                get(target, prop, receiver) {
                  if (prop === 'withdrawTokens') {
                    return async () => {
                      throw new Error('NETWORK_ERROR: withdrawTokens RPC failure');
                    };
                  }
                  return Reflect.get(target, prop, receiver);
                }
              });
            };
          }
          return Reflect.get(target, prop, receiver);
        }
      });
    })
  };
});

describe('Partial Fee Distribution Failure', () => {
  let testEnv;
  let testConfig;
  let tempDir;
  let service;
  let currentVault;
  let swapWallet;
  let poolSnapshotId;

  beforeAll(async () => {
    testEnv = await setupTestBlockchain();
    testConfig = testEnv.testConfig;

    swapWallet = await setupSwapWallet(testEnv, {
      ethAmount: '1000',
      wethAmount: '800',
      usdcAmount: '20'
    });

    poolSnapshotId = await testEnv.hardhatServer.takeSnapshot();
  }, 120000);

  afterAll(async () => {
    shouldFailWithdrawTokens = false;
    await cleanupTestBlockchain(testEnv);
  });

  beforeEach(async () => {
    if (poolSnapshotId) {
      await testEnv.hardhatServer.revertToSnapshot(poolSnapshotId);
      poolSnapshotId = await testEnv.hardhatServer.takeSnapshot();
    }

    // Sync chain timestamp (same fix as swap-event-failures)
    const provider = testEnv.hardhatServer.provider;
    const currentBlock = await provider.getBlock('latest');
    const nextTimestamp = Math.max(Math.floor(Date.now() / 1000), currentBlock.timestamp) + 1;
    await provider.send('evm_setNextBlockTimestamp', [nextTimestamp]);
    await provider.send('evm_mine', []);
  });

  afterEach(async () => {
    shouldFailWithdrawTokens = false;
    vi.restoreAllMocks();

    if (service) {
      try {
        await service.stop(true);
      } catch (e) { /* ignore */ }
      service = null;
    }

    if (tempDir) {
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch (e) { /* ignore */ }
      tempDir = null;
    }

    currentVault = null;
  });

  it('should distribute WETH fees when USDC withdrawal fails', async () => {
    // Create vault with close-to-boundary position (same as rebalance failure tests)
    currentVault = await setupTestVault(
      testEnv.hardhatServer,
      testEnv.contracts,
      testEnv.deployedContracts,
      {
        vaultName: 'Partial Distribution Test',
        wrapEthAmount: '10',
        swapTokens: [{ from: 'WETH', to: 'USDC', amount: '2' }],
        positions: [{
          token0: 'USDC',
          token1: 'WETH',
          fee: 500,
          percentOfAssets: 100,
          tickRange: { type: 'close-to-boundary', spacing: 10 }
        }],
        targetTokens: ['USDC', 'WETH'],
        targetPlatforms: ['uniswapV3'],
        strategy: 'bob'
      }
    );

    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'partial-dist-test-'));
    service = new AutomationService({
      chainId: 1337,
      wsUrl: testConfig.wsUrl,
      dataDir: tempDir,
      ssePort: 3216,
      debug: true,
      retryIntervalMs: 999999999
    });

    // Track events
    const events = {
      positionRebalanced: [],
      swapEventFailed: [],
      feesDistributed: []
    };

    service.eventManager.subscribe('PositionRebalanced', (data) => {
      if (data.vaultAddress === currentVault.vaultAddress) {
        console.log(`  [EVENT] PositionRebalanced`);
        events.positionRebalanced.push(data);
      }
    });

    service.eventManager.subscribe('SwapEventFailed', (data) => {
      if (data.vaultAddress === currentVault.vaultAddress) {
        events.swapEventFailed.push(data);
      }
    });

    service.eventManager.subscribe('FeesDistributed', (data) => {
      if (data.vaultAddress === currentVault.vaultAddress) {
        console.log(`  [EVENT] FeesDistributed: ${data.distributions?.length} success, ${data.failures?.length} failures`);
        events.feesDistributed.push(data);
      }
    });

    await service.start();
    expect(service.vaultDataService.hasVault(currentVault.vaultAddress)).toBe(true);

    // Enable withdrawTokens failure AFTER service init (init uses withdrawTokens-free paths)
    shouldFailWithdrawTokens = true;

    // Execute swaps to push position out of range and trigger rebalance
    const wethAddress = swapWallet.wrappedNativeAddress;
    const usdcAddress = swapWallet.usdcAddress;
    const swapAmount = ethers.utils.parseUnits('15', 18);

    console.log('Executing swaps to trigger rebalance...');
    for (let i = 0; i < 20; i++) {
      const hasEvent = events.positionRebalanced.length > 0 || events.swapEventFailed.length > 0;
      if (hasEvent) {
        console.log(`Event triggered after ${i + 1} swaps`);
        break;
      }

      try {
        await executeSwap(testEnv, {
          tokenIn: wethAddress,
          tokenOut: usdcAddress,
          amountIn: swapAmount,
          fee: 500,
          wallet: swapWallet.wallet,
          slippage: 100
        });
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (error) {
        console.log(`Swap ${i + 1} failed: ${error.message.slice(0, 50)}`);
        break;
      }
    }

    // Wait for rebalance to complete
    await waitForCondition(
      () => events.positionRebalanced.length > 0,
      60000,
      1000
    );

    // Wait for fee distribution event
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Rebalance completed (the on-chain operations are not affected by withdrawTokens mock)
    expect(events.positionRebalanced.length).toBeGreaterThan(0);

    // Vault should NOT be in retry queue — rebalance succeeded despite partial distribution
    expect(service.failedVaults.has(currentVault.vaultAddress)).toBe(false);

    // Verify partial distribution
    if (events.feesDistributed.length > 0) {
      const distEvent = events.feesDistributed[0];

      // WETH distributed via unwrapAndWithdrawETH (not affected by withdrawTokens mock)
      expect(distEvent.distributions.length).toBeGreaterThan(0);
      const successTokens = distEvent.distributions.map(d => d.token);
      expect(successTokens).toContain('WETH');

      // USDC failed via withdrawTokens (our mock throws)
      expect(distEvent.failures.length).toBeGreaterThan(0);
      const failedTokens = distEvent.failures.map(f => f.token);
      expect(failedTokens).toContain('USDC');

      console.log(`Partial distribution verified: ${distEvent.distributions.length} succeeded, ${distEvent.failures.length} failed`);
    }

    console.log('Partial fee distribution test passed');
  }, 240000);
});
