/**
 * @fileoverview Unit tests for VaultHealth executor gas monitoring
 *
 * Tests balance monitoring, holdback calculation, funding-required state,
 * vault management, and lifecycle. All external dependencies mocked.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ethers } from 'ethers';

// Mock fum_library modules before importing VaultHealth
vi.mock('fum_library', () => ({
  getVaultContract: vi.fn()
}));

vi.mock('fum_library/helpers/chainHelpers', () => ({
  getMinExecutorBalance: vi.fn(),
  getMaxExecutorBalance: vi.fn(),
  getChainConfig: vi.fn()
}));

vi.mock('fum_library/services/coingecko', () => ({
  fetchTokenPrices: vi.fn(),
  CACHE_DURATIONS: { '1-MINUTE': 60000 }
}));

vi.mock('fum_library/helpers/tokenHelpers', () => ({
  getNativeSymbol: vi.fn(),
  getWrappedNativeSymbol: vi.fn(),
  getWrappedNativeAddress: vi.fn()
}));

vi.mock('../../src/utils/RetryHelper.js', () => ({
  retryRpcCall: vi.fn(async (fn) => fn())
}));

import VaultHealth from '../../src/core/VaultHealth.js';
import { getMinExecutorBalance, getMaxExecutorBalance } from 'fum_library/helpers/chainHelpers';
import { fetchTokenPrices } from 'fum_library/services/coingecko';
import { getNativeSymbol } from 'fum_library/helpers/tokenHelpers';

// Helpers
const VAULT_A = '0x1111111111111111111111111111111111111111';
const VAULT_B = '0x2222222222222222222222222222222222222222';
const CHAIN_ID = 1337;

function createMockEventManager() {
  const handlers = {};
  return {
    subscribe: vi.fn((event, handler) => {
      if (!handlers[event]) handlers[event] = [];
      handlers[event].push(handler);
    }),
    emit: vi.fn((event, data) => {
      if (handlers[event]) {
        handlers[event].forEach(h => h(data));
      }
    }),
    _handlers: handlers
  };
}

function createMockProvider(balances = {}) {
  return {
    getBalance: vi.fn(async (address) => {
      return balances[address] || ethers.BigNumber.from(0);
    })
  };
}

function createMockVaultDataService(vaults = []) {
  const vaultMap = new Map();
  vaults.forEach(v => vaultMap.set(ethers.utils.getAddress(v.address), v));
  return {
    getAllVaults: vi.fn(() => vaults),
    getVault: vi.fn(async (addr) => vaultMap.get(ethers.utils.getAddress(addr)) || null),
    hasVault: vi.fn((addr) => vaultMap.has(ethers.utils.getAddress(addr))),
    refreshTokens: vi.fn()
  };
}

function createMockHdNode() {
  return ethers.utils.HDNode.fromMnemonic(
    'pumpkin ghost mammal enrich toss laptop travel main again clever edit orchard'
  );
}

function createVaultHealth(overrides = {}) {
  const eventManager = overrides.eventManager || createMockEventManager();
  const vh = new VaultHealth({
    eventManager,
    chainId: CHAIN_ID,
    debug: false,
    balanceCheckIntervalMs: 0,
    ...overrides
  });
  return vh;
}

describe('VaultHealth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default mock returns for chain helpers
    getMinExecutorBalance.mockReturnValue(0.002);
    getMaxExecutorBalance.mockReturnValue(0.004);
    getNativeSymbol.mockReturnValue('ETH');
    fetchTokenPrices.mockResolvedValue({ ETH: 3000 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ============================================================================
  // Balance Monitoring
  // ============================================================================
  describe('Balance Monitoring', () => {
    it('should set holdback when executor balance is below min', async () => {
      const executorAddress = createMockHdNode().derivePath("m/44'/60'/0'/0/0").address;
      const provider = createMockProvider({
        [executorAddress]: ethers.utils.parseEther('0.001') // below min of 0.002
      });
      const vds = createMockVaultDataService([
        { address: VAULT_A, executorIndex: 0 }
      ]);

      const vh = createVaultHealth();
      vh.setProvider(provider);
      vh.setHdNode(createMockHdNode());
      vh.setVaultDataService(vds);

      // Populate managedVaults and check balances
      vh.managedVaults.add(ethers.utils.getAddress(VAULT_A));
      await vh.checkExecutorBalance(ethers.utils.getAddress(VAULT_A));

      expect(vh.holdbacks.size).toBe(1);
      expect(vh.holdbacks.has(ethers.utils.getAddress(VAULT_A))).toBe(true);

      const holdback = vh.holdbacks.get(ethers.utils.getAddress(VAULT_A));
      // deficit = maxBalance(0.004) - currentBalance(0.001) = 0.003
      expect(holdback.amountNative).toBeCloseTo(0.003, 4);
      // USD = 0.003 * 3000 = 9.00
      expect(holdback.amountUsd).toBeCloseTo(9.0, 1);
    });

    it('should clear holdback when executor balance recovers above min', async () => {
      const executorAddress = createMockHdNode().derivePath("m/44'/60'/0'/0/0").address;
      const provider = createMockProvider({
        [executorAddress]: ethers.utils.parseEther('0.003') // above min of 0.002
      });
      const vds = createMockVaultDataService([
        { address: VAULT_A, executorIndex: 0 }
      ]);

      const vh = createVaultHealth();
      vh.setProvider(provider);
      vh.setHdNode(createMockHdNode());
      vh.setVaultDataService(vds);

      const normalizedA = ethers.utils.getAddress(VAULT_A);
      vh.managedVaults.add(normalizedA);

      // Pre-set a holdback
      vh.holdbacks.set(normalizedA, { amountNative: 0.003, amountUsd: 9.0, setAt: Date.now() });

      await vh.checkExecutorBalance(normalizedA);

      // Balance is now above min — holdback should be cleared
      expect(vh.holdbacks.size).toBe(0);
    });

    it('should not set holdback when executor balance is above min', async () => {
      const executorAddress = createMockHdNode().derivePath("m/44'/60'/0'/0/0").address;
      const provider = createMockProvider({
        [executorAddress]: ethers.utils.parseEther('0.005') // well above min 0.002
      });
      const vds = createMockVaultDataService([
        { address: VAULT_A, executorIndex: 0 }
      ]);

      const vh = createVaultHealth();
      vh.setProvider(provider);
      vh.setHdNode(createMockHdNode());
      vh.setVaultDataService(vds);

      vh.managedVaults.add(ethers.utils.getAddress(VAULT_A));
      await vh.checkExecutorBalance(ethers.utils.getAddress(VAULT_A));

      expect(vh.holdbacks.size).toBe(0);
    });
  });

  // ============================================================================
  // Holdback Calculation
  // ============================================================================
  describe('Holdback Calculation', () => {
    it('should convert native deficit to USD using fetched price', async () => {
      fetchTokenPrices.mockResolvedValue({ ETH: 2500 });
      const executorAddress = createMockHdNode().derivePath("m/44'/60'/0'/0/0").address;
      const provider = createMockProvider({
        [executorAddress]: ethers.utils.parseEther('0.001')
      });
      const vds = createMockVaultDataService([
        { address: VAULT_A, executorIndex: 0 }
      ]);

      const vh = createVaultHealth();
      vh.setProvider(provider);
      vh.setHdNode(createMockHdNode());
      vh.setVaultDataService(vds);

      vh.managedVaults.add(ethers.utils.getAddress(VAULT_A));
      await vh.checkExecutorBalance(ethers.utils.getAddress(VAULT_A));

      const holdback = vh.holdbacks.get(ethers.utils.getAddress(VAULT_A));
      // deficit = 0.004 - 0.001 = 0.003, USD = 0.003 * 2500 = 7.50
      expect(holdback.amountUsd).toBeCloseTo(7.5, 1);
    });

    it('should return 0 from getHoldbackAmount when no holdback exists', () => {
      const vh = createVaultHealth();
      expect(vh.getHoldbackAmount(VAULT_A)).toBe(0);
    });

    it('should return holdback USD from getHoldbackAmount when holdback exists', () => {
      const vh = createVaultHealth();
      const normalizedA = ethers.utils.getAddress(VAULT_A);
      vh.holdbacks.set(normalizedA, { amountNative: 0.003, amountUsd: 9.0, setAt: Date.now() });
      expect(vh.getHoldbackAmount(VAULT_A)).toBe(9.0);
    });

    it('should return null from getHoldback when no holdback exists', () => {
      const vh = createVaultHealth();
      expect(vh.getHoldback(VAULT_A)).toBe(null);
    });

    it('should return full holdback object from getHoldback when holdback exists', () => {
      const vh = createVaultHealth();
      const normalizedA = ethers.utils.getAddress(VAULT_A);
      vh.holdbacks.set(normalizedA, { amountNative: 0.003, amountUsd: 9.0, setAt: Date.now() });

      const holdback = vh.getHoldback(VAULT_A);
      expect(holdback).not.toBe(null);
      expect(holdback.amountNative).toBe(0.003);
      expect(holdback.amountUsd).toBe(9.0);
    });

    it('should emit ExecutorHoldbackSet event on new holdback', async () => {
      const eventManager = createMockEventManager();
      const executorAddress = createMockHdNode().derivePath("m/44'/60'/0'/0/0").address;
      const provider = createMockProvider({
        [executorAddress]: ethers.utils.parseEther('0.001')
      });
      const vds = createMockVaultDataService([
        { address: VAULT_A, executorIndex: 0 }
      ]);

      const vh = createVaultHealth({ eventManager });
      vh.setProvider(provider);
      vh.setHdNode(createMockHdNode());
      vh.setVaultDataService(vds);

      vh.managedVaults.add(ethers.utils.getAddress(VAULT_A));
      await vh.checkExecutorBalance(ethers.utils.getAddress(VAULT_A));

      const emitCalls = eventManager.emit.mock.calls;
      const holdbackEvent = emitCalls.find(c => c[0] === 'ExecutorHoldbackSet');
      expect(holdbackEvent).toBeDefined();
      expect(holdbackEvent[1].vaultAddress).toBe(ethers.utils.getAddress(VAULT_A));
      expect(holdbackEvent[1].deficitNative).toBeCloseTo(0.003, 4);
    });
  });

  // ============================================================================
  // Funding-Required State
  // ============================================================================
  describe('Funding-Required State', () => {
    it('should enter funding-required state and emit event', () => {
      const eventManager = createMockEventManager();
      const vh = createVaultHealth({ eventManager });
      vi.mock('fum_library', async () => {
        const actual = await vi.importActual('fum_library');
        return { ...actual, getVaultContract: vi.fn(() => ({ filters: { ExecutorFunded: vi.fn(() => ({})) }, on: vi.fn(), off: vi.fn() })) };
      });

      // Mock subscribeToExecutorFundedEvent to avoid contract interaction
      vh.subscribeToExecutorFundedEvent = vi.fn();

      vh.enterFundingRequired(VAULT_A);

      expect(vh.fundingRequired.has(ethers.utils.getAddress(VAULT_A))).toBe(true);

      const emitCalls = eventManager.emit.mock.calls;
      const fundingEvent = emitCalls.find(c => c[0] === 'ExecutorFundingRequired');
      expect(fundingEvent).toBeDefined();
      expect(fundingEvent[1].vaultAddress).toBe(ethers.utils.getAddress(VAULT_A));
    });

    it('should clear funding-required state and emit event', () => {
      const eventManager = createMockEventManager();
      const vh = createVaultHealth({ eventManager });
      vh.unlockVault = vi.fn();

      const normalizedA = ethers.utils.getAddress(VAULT_A);
      vh.fundingRequired.set(normalizedA, { enteredAt: Date.now() });

      vh.clearFundingRequired(normalizedA);

      expect(vh.fundingRequired.has(normalizedA)).toBe(false);

      const emitCalls = eventManager.emit.mock.calls;
      const clearedEvent = emitCalls.find(c => c[0] === 'ExecutorFundingCleared');
      expect(clearedEvent).toBeDefined();
    });

    it('should emit ExecutorFundingRequired event with vault address', () => {
      const eventManager = createMockEventManager();
      const vh = createVaultHealth({ eventManager });
      vh.subscribeToExecutorFundedEvent = vi.fn();

      vh.enterFundingRequired(VAULT_A);

      const emitCalls = eventManager.emit.mock.calls;
      const fundingEvent = emitCalls.find(c => c[0] === 'ExecutorFundingRequired');
      expect(fundingEvent).toBeDefined();
      expect(fundingEvent[1].vaultAddress).toBe(ethers.utils.getAddress(VAULT_A));
      expect(fundingEvent[1].timestamp).toBeGreaterThan(0);
    });

    it('should emit ExecutorFundingCleared event when cleared', () => {
      const eventManager = createMockEventManager();
      const vh = createVaultHealth({ eventManager });
      vh.unlockVault = vi.fn();

      const normalizedA = ethers.utils.getAddress(VAULT_A);
      vh.fundingRequired.set(normalizedA, { enteredAt: Date.now() });

      vh.clearFundingRequired(normalizedA);

      const emitCalls = eventManager.emit.mock.calls;
      const clearedEvent = emitCalls.find(c => c[0] === 'ExecutorFundingCleared');
      expect(clearedEvent).toBeDefined();
      expect(clearedEvent[1].vaultAddress).toBe(normalizedA);
    });

    it('should clear funding-required via checkAllBalances when balance recovers', async () => {
      const executorAddress = createMockHdNode().derivePath("m/44'/60'/0'/0/0").address;
      const provider = createMockProvider({
        [executorAddress]: ethers.utils.parseEther('0.003') // above min of 0.002
      });
      const vds = createMockVaultDataService([
        { address: VAULT_A, executorIndex: 0 }
      ]);

      const eventManager = createMockEventManager();
      const vh = createVaultHealth({ eventManager });
      vh.setProvider(provider);
      vh.setHdNode(createMockHdNode());
      vh.setVaultDataService(vds);
      vh.unlockVault = vi.fn();

      const normalizedA = ethers.utils.getAddress(VAULT_A);
      vh.managedVaults.add(normalizedA);
      vh.fundingRequired.set(normalizedA, { enteredAt: Date.now() });

      await vh.checkAllBalances();

      expect(vh.fundingRequired.has(normalizedA)).toBe(false);
    });
  });

  // ============================================================================
  // Vault Management
  // ============================================================================
  describe('Vault Management', () => {
    it('should add vault to monitoring via addVault', () => {
      const vh = createVaultHealth();
      vh.setProvider(createMockProvider());
      vh.setHdNode(createMockHdNode());
      vh.setVaultDataService(createMockVaultDataService([
        { address: VAULT_A, executorIndex: 0 }
      ]));

      vh.addVault(VAULT_A);

      expect(vh.managedVaults.has(ethers.utils.getAddress(VAULT_A))).toBe(true);
    });

    it('should remove vault and clear all state via removeVault', () => {
      const vh = createVaultHealth();
      const normalizedA = ethers.utils.getAddress(VAULT_A);

      vh.managedVaults.add(normalizedA);
      vh.holdbacks.set(normalizedA, { amountNative: 0.003, amountUsd: 9.0, setAt: Date.now() });
      vh.fundingRequired.set(normalizedA, { enteredAt: Date.now() });

      vh.removeVault(VAULT_A);

      expect(vh.managedVaults.has(normalizedA)).toBe(false);
      expect(vh.holdbacks.has(normalizedA)).toBe(false);
      expect(vh.fundingRequired.has(normalizedA)).toBe(false);
    });

    it('should prune vaults removed from VaultDataService during checkAllBalances', async () => {
      const vds = createMockVaultDataService([]); // empty — vault was removed
      const provider = createMockProvider();

      const vh = createVaultHealth();
      vh.setProvider(provider);
      vh.setHdNode(createMockHdNode());
      vh.setVaultDataService(vds);

      const normalizedA = ethers.utils.getAddress(VAULT_A);
      vh.managedVaults.add(normalizedA);
      vh.holdbacks.set(normalizedA, { amountNative: 0.003, amountUsd: 9.0, setAt: Date.now() });

      await vh.checkAllBalances();

      expect(vh.managedVaults.has(normalizedA)).toBe(false);
      expect(vh.holdbacks.has(normalizedA)).toBe(false);
    });
  });

  // ============================================================================
  // Lifecycle
  // ============================================================================
  describe('Lifecycle', () => {
    it('should populate managedVaults from VaultDataService on start', async () => {
      const executorAddr0 = createMockHdNode().derivePath("m/44'/60'/0'/0/0").address;
      const executorAddr1 = createMockHdNode().derivePath("m/44'/60'/0'/0/1").address;
      const provider = createMockProvider({
        [executorAddr0]: ethers.utils.parseEther('0.005'),
        [executorAddr1]: ethers.utils.parseEther('0.005')
      });
      const vds = createMockVaultDataService([
        { address: VAULT_A, executorIndex: 0 },
        { address: VAULT_B, executorIndex: 1 }
      ]);

      const vh = createVaultHealth();
      vh.setProvider(provider);
      vh.setHdNode(createMockHdNode());
      vh.setVaultDataService(vds);

      await vh.start();

      expect(vh.managedVaults.size).toBe(2);
      expect(vh.managedVaults.has(ethers.utils.getAddress(VAULT_A))).toBe(true);
      expect(vh.managedVaults.has(ethers.utils.getAddress(VAULT_B))).toBe(true);

      vh.stop();
    });

    it('should clear all state on stop', async () => {
      const executorAddr0 = createMockHdNode().derivePath("m/44'/60'/0'/0/0").address;
      const provider = createMockProvider({
        [executorAddr0]: ethers.utils.parseEther('0.001') // below min
      });
      const vds = createMockVaultDataService([
        { address: VAULT_A, executorIndex: 0 }
      ]);

      const vh = createVaultHealth();
      vh.setProvider(provider);
      vh.setHdNode(createMockHdNode());
      vh.setVaultDataService(vds);

      await vh.start();

      expect(vh.managedVaults.size).toBe(1);
      expect(vh.holdbacks.size).toBe(1);

      vh.stop();

      expect(vh.managedVaults.size).toBe(0);
      expect(vh.holdbacks.size).toBe(0);
      expect(vh.fundingRequired.size).toBe(0);
      expect(vh.balanceCheckInterval).toBe(null);
    });

    it('should not start interval when balanceCheckIntervalMs is 0', async () => {
      const executorAddr0 = createMockHdNode().derivePath("m/44'/60'/0'/0/0").address;
      const provider = createMockProvider({
        [executorAddr0]: ethers.utils.parseEther('0.005')
      });
      const vds = createMockVaultDataService([
        { address: VAULT_A, executorIndex: 0 }
      ]);

      const vh = createVaultHealth({ balanceCheckIntervalMs: 0 });
      vh.setProvider(provider);
      vh.setHdNode(createMockHdNode());
      vh.setVaultDataService(vds);

      await vh.start();

      expect(vh.balanceCheckInterval).toBe(null);

      vh.stop();
    });
  });
});
