/**
 * Unit tests for AutomationService configuration validation
 * Tests all required config parameters and their validation rules
 */

import { describe, it, expect, vi } from 'vitest';

// Mock heavy dependencies before importing AutomationService
vi.mock('../../src/EventManager.js', () => ({
  default: vi.fn().mockImplementation(() => ({
    setDebug: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
    subscribe: vi.fn()
  }))
}));

vi.mock('../../src/VaultDataService.js', () => ({
  default: vi.fn().mockImplementation(() => ({}))
}));

vi.mock('../../src/Tracker.js', () => ({
  default: vi.fn().mockImplementation(() => ({}))
}));

vi.mock('../../src/SSEBroadcaster.js', () => ({
  default: vi.fn().mockImplementation(() => ({
    start: vi.fn(),
    stop: vi.fn()
  }))
}));

vi.mock('../../src/strategies/BabyStepsStrategy.js', () => ({
  default: vi.fn().mockImplementation(() => ({}))
}));

vi.mock('../../src/RetryHelper.js', () => ({
  retryWithBackoff: vi.fn(),
  retryBatchOperations: vi.fn()
}));

vi.mock('fum_library', () => ({
  getChainConfig: vi.fn().mockReturnValue({}),
  AdapterFactory: vi.fn(),
  getTokensByChain: vi.fn().mockReturnValue({})
}));

vi.mock('fum_library/blockchain/contracts', () => ({
  getContract: vi.fn(),
  getVaultFactory: vi.fn(),
  getAuthorizedVaults: vi.fn()
}));

vi.mock('dotenv', () => ({
  default: {
    config: vi.fn()
  }
}));

// Now import the service
import AutomationService from '../../src/AutomationService.js';

describe('AutomationService Configuration Validation', () => {
  // Valid base config for testing (all required fields)
  const validBaseConfig = {
    automationServiceAddress: '0x1234567890123456789012345678901234567890',
    chainId: 1337,
    wsUrl: 'ws://localhost:8545',
    debug: true,
    envPath: './test/.env.test',
    blacklistFilePath: './data/.vault-blacklist.json',
    trackingDataDir: './data/vaults',
    ssePort: 3001,
    retryIntervalMs: 15000,
    maxFailureDurationMs: 3600000
  };

  // Helper to create config without a specific field
  const configWithout = (field) => {
    const config = { ...validBaseConfig };
    delete config[field];
    return config;
  };

  // Helper to create config with a specific field value
  const configWith = (field, value) => {
    return { ...validBaseConfig, [field]: value };
  };

  describe('Configuration object validation', () => {
    it('should throw for null config', () => {
      expect(() => new AutomationService(null)).toThrow(
        'Configuration must be a valid object'
      );
    });

    it('should throw for undefined config (uses default empty object)', () => {
      // When undefined is passed, JS uses the default parameter value {},
      // so it fails on the first missing required field instead
      expect(() => new AutomationService(undefined)).toThrow(
        'automationServiceAddress is required in configuration'
      );
    });

    it('should throw for array config', () => {
      expect(() => new AutomationService([])).toThrow(
        'Configuration must be a valid object'
      );
    });

    it('should throw for string config', () => {
      expect(() => new AutomationService('config')).toThrow(
        'Configuration must be a valid object'
      );
    });
  });

  describe('automationServiceAddress validation', () => {
    it('should throw for missing automationServiceAddress', () => {
      expect(() => new AutomationService(configWithout('automationServiceAddress'))).toThrow(
        'automationServiceAddress is required in configuration'
      );
    });

    it('should throw for null automationServiceAddress', () => {
      expect(() => new AutomationService(configWith('automationServiceAddress', null))).toThrow(
        'automationServiceAddress is required in configuration'
      );
    });

    it('should throw for non-string automationServiceAddress', () => {
      expect(() => new AutomationService(configWith('automationServiceAddress', 12345))).toThrow(
        'automationServiceAddress must be a string'
      );
    });

    it('should throw for empty automationServiceAddress', () => {
      expect(() => new AutomationService(configWith('automationServiceAddress', ''))).toThrow(
        'automationServiceAddress cannot be empty'
      );
    });

    it('should throw for whitespace-only automationServiceAddress', () => {
      expect(() => new AutomationService(configWith('automationServiceAddress', '   '))).toThrow(
        'automationServiceAddress cannot be empty'
      );
    });

    it('should throw for invalid Ethereum address', () => {
      expect(() => new AutomationService(configWith('automationServiceAddress', 'not-an-address'))).toThrow(
        'automationServiceAddress is not a valid Ethereum address'
      );
    });

    it('should throw for address with wrong length', () => {
      expect(() => new AutomationService(configWith('automationServiceAddress', '0x1234'))).toThrow(
        'automationServiceAddress is not a valid Ethereum address'
      );
    });

    it('should accept valid checksummed address', () => {
      const service = new AutomationService(configWith('automationServiceAddress', '0x5B38Da6a701c568545dCfcB03FcB875f56beddC4'));
      expect(service.automationServiceAddress).toBe('0x5B38Da6a701c568545dCfcB03FcB875f56beddC4');
    });

    it('should accept valid lowercase address', () => {
      const service = new AutomationService(configWith('automationServiceAddress', '0x5b38da6a701c568545dcfcb03fcb875f56beddc4'));
      expect(service.automationServiceAddress).toBe('0x5b38da6a701c568545dcfcb03fcb875f56beddc4');
    });
  });

  describe('chainId validation', () => {
    it('should throw for missing chainId', () => {
      expect(() => new AutomationService(configWithout('chainId'))).toThrow(
        'chainId is required in configuration'
      );
    });

    it('should throw for null chainId', () => {
      expect(() => new AutomationService(configWith('chainId', null))).toThrow(
        'chainId is required in configuration'
      );
    });

    it('should throw for string chainId', () => {
      expect(() => new AutomationService(configWith('chainId', '1337'))).toThrow(
        'chainId must be a number'
      );
    });

    it('should throw for NaN chainId', () => {
      expect(() => new AutomationService(configWith('chainId', NaN))).toThrow(
        'chainId must be a finite number'
      );
    });

    it('should throw for Infinity chainId', () => {
      expect(() => new AutomationService(configWith('chainId', Infinity))).toThrow(
        'chainId must be a finite number'
      );
    });

    it('should throw for floating point chainId', () => {
      expect(() => new AutomationService(configWith('chainId', 1337.5))).toThrow(
        'chainId must be an integer'
      );
    });

    it('should throw for zero chainId', () => {
      expect(() => new AutomationService(configWith('chainId', 0))).toThrow(
        'chainId must be greater than 0'
      );
    });

    it('should throw for negative chainId', () => {
      expect(() => new AutomationService(configWith('chainId', -1))).toThrow(
        'chainId must be greater than 0'
      );
    });

    it('should accept valid chainId (local)', () => {
      const service = new AutomationService(configWith('chainId', 1337));
      expect(service.chainId).toBe(1337);
    });

    it('should accept valid chainId (Arbitrum)', () => {
      const service = new AutomationService(configWith('chainId', 42161));
      expect(service.chainId).toBe(42161);
    });

    it('should accept valid chainId (mainnet)', () => {
      const service = new AutomationService(configWith('chainId', 1));
      expect(service.chainId).toBe(1);
    });
  });

  describe('wsUrl validation', () => {
    it('should throw for missing wsUrl', () => {
      expect(() => new AutomationService(configWithout('wsUrl'))).toThrow(
        'wsUrl is required in configuration'
      );
    });

    it('should throw for null wsUrl', () => {
      expect(() => new AutomationService(configWith('wsUrl', null))).toThrow(
        'wsUrl is required in configuration'
      );
    });

    it('should throw for non-string wsUrl', () => {
      expect(() => new AutomationService(configWith('wsUrl', 12345))).toThrow(
        'wsUrl must be a string'
      );
    });

    it('should throw for empty wsUrl', () => {
      expect(() => new AutomationService(configWith('wsUrl', ''))).toThrow(
        'wsUrl cannot be empty'
      );
    });

    it('should throw for whitespace-only wsUrl', () => {
      expect(() => new AutomationService(configWith('wsUrl', '   '))).toThrow(
        'wsUrl cannot be empty'
      );
    });

    it('should throw for invalid URL format', () => {
      expect(() => new AutomationService(configWith('wsUrl', 'not-a-url'))).toThrow(
        'wsUrl is not a valid URL'
      );
    });

    it('should throw for http:// protocol', () => {
      expect(() => new AutomationService(configWith('wsUrl', 'http://localhost:8545'))).toThrow(
        'wsUrl must use ws:// or wss:// protocol'
      );
    });

    it('should throw for https:// protocol', () => {
      expect(() => new AutomationService(configWith('wsUrl', 'https://localhost:8545'))).toThrow(
        'wsUrl must use ws:// or wss:// protocol'
      );
    });

    it('should accept valid ws:// URL', () => {
      const service = new AutomationService(configWith('wsUrl', 'ws://localhost:8545'));
      expect(service.wsUrl).toBe('ws://localhost:8545');
    });

    it('should accept valid wss:// URL', () => {
      const service = new AutomationService(configWith('wsUrl', 'wss://arb-mainnet.g.alchemy.com/v2/key'));
      expect(service.wsUrl).toBe('wss://arb-mainnet.g.alchemy.com/v2/key');
    });
  });

  describe('debug validation', () => {
    it('should throw for missing debug flag', () => {
      expect(() => new AutomationService(configWithout('debug'))).toThrow(
        'debug flag must be explicitly set to true or false'
      );
    });

    it('should throw for string debug flag', () => {
      expect(() => new AutomationService(configWith('debug', 'true'))).toThrow(
        'debug flag must be a boolean (true or false)'
      );
    });

    it('should throw for number debug flag', () => {
      expect(() => new AutomationService(configWith('debug', 1))).toThrow(
        'debug flag must be a boolean (true or false)'
      );
    });

    it('should throw for null debug flag', () => {
      expect(() => new AutomationService(configWith('debug', null))).toThrow(
        'debug flag must be a boolean (true or false)'
      );
    });

    it('should accept debug = true', () => {
      const service = new AutomationService(configWith('debug', true));
      expect(service.debug).toBe(true);
    });

    it('should accept debug = false', () => {
      const service = new AutomationService(configWith('debug', false));
      expect(service.debug).toBe(false);
    });
  });

  describe('blacklistFilePath validation', () => {
    it('should use default when blacklistFilePath is missing', () => {
      const service = new AutomationService(configWithout('blacklistFilePath'));
      expect(service.blacklistFilePath).toBe('./data/.vault-blacklist.json');
    });

    it('should use default when blacklistFilePath is null', () => {
      const service = new AutomationService(configWith('blacklistFilePath', null));
      expect(service.blacklistFilePath).toBe('./data/.vault-blacklist.json');
    });

    it('should throw for non-string blacklistFilePath', () => {
      expect(() => new AutomationService(configWith('blacklistFilePath', 12345))).toThrow(
        'blacklistFilePath must be a string path'
      );
    });

    it('should accept valid blacklistFilePath', () => {
      const service = new AutomationService(configWith('blacklistFilePath', './data/.vault-blacklist.json'));
      expect(service.blacklistFilePath).toBe('./data/.vault-blacklist.json');
    });
  });

  describe('trackingDataDir validation', () => {
    it('should use default when trackingDataDir is missing', () => {
      const service = new AutomationService(configWithout('trackingDataDir'));
      expect(service.trackingDataDir).toBe('./data/vaults');
    });

    it('should throw for non-string trackingDataDir', () => {
      expect(() => new AutomationService(configWith('trackingDataDir', 12345))).toThrow(
        'trackingDataDir must be a string path'
      );
    });

    it('should accept valid trackingDataDir', () => {
      const service = new AutomationService(configWith('trackingDataDir', './custom/path'));
      expect(service.trackingDataDir).toBe('./custom/path');
    });
  });

  describe('ssePort validation', () => {
    it('should throw for missing ssePort', () => {
      expect(() => new AutomationService(configWithout('ssePort'))).toThrow(
        'ssePort is required in configuration and must be a number'
      );
    });

    it('should throw for null ssePort', () => {
      expect(() => new AutomationService(configWith('ssePort', null))).toThrow(
        'ssePort is required in configuration and must be a number'
      );
    });

    it('should throw for string ssePort', () => {
      expect(() => new AutomationService(configWith('ssePort', '3001'))).toThrow(
        'ssePort is required in configuration and must be a number'
      );
    });

    it('should accept valid ssePort', () => {
      const service = new AutomationService(configWith('ssePort', 3001));
      // ssePort is passed to SSEBroadcaster, not stored directly on service
      expect(service).toBeDefined();
    });
  });

  describe('retryIntervalMs validation', () => {
    it('should throw for missing retryIntervalMs', () => {
      expect(() => new AutomationService(configWithout('retryIntervalMs'))).toThrow(
        'retryIntervalMs is required in configuration and must be a positive integer (milliseconds)'
      );
    });

    it('should throw for null retryIntervalMs', () => {
      expect(() => new AutomationService(configWith('retryIntervalMs', null))).toThrow(
        'retryIntervalMs is required in configuration and must be a positive integer (milliseconds)'
      );
    });

    it('should throw for string retryIntervalMs', () => {
      expect(() => new AutomationService(configWith('retryIntervalMs', '15000'))).toThrow(
        'retryIntervalMs is required in configuration and must be a positive integer (milliseconds)'
      );
    });

    it('should throw for floating point retryIntervalMs', () => {
      expect(() => new AutomationService(configWith('retryIntervalMs', 15000.5))).toThrow(
        'retryIntervalMs is required in configuration and must be a positive integer (milliseconds)'
      );
    });

    it('should throw for zero retryIntervalMs', () => {
      expect(() => new AutomationService(configWith('retryIntervalMs', 0))).toThrow(
        'retryIntervalMs is required in configuration and must be a positive integer (milliseconds)'
      );
    });

    it('should throw for negative retryIntervalMs', () => {
      expect(() => new AutomationService(configWith('retryIntervalMs', -15000))).toThrow(
        'retryIntervalMs is required in configuration and must be a positive integer (milliseconds)'
      );
    });

    it('should throw for NaN retryIntervalMs', () => {
      expect(() => new AutomationService(configWith('retryIntervalMs', NaN))).toThrow(
        'retryIntervalMs is required in configuration and must be a positive integer (milliseconds)'
      );
    });

    it('should throw for Infinity retryIntervalMs', () => {
      expect(() => new AutomationService(configWith('retryIntervalMs', Infinity))).toThrow(
        'retryIntervalMs is required in configuration and must be a positive integer (milliseconds)'
      );
    });

    it('should accept valid retryIntervalMs (15 seconds)', () => {
      const service = new AutomationService(configWith('retryIntervalMs', 15000));
      expect(service.retryIntervalMs).toBe(15000);
    });

    it('should accept valid retryIntervalMs (5 minutes)', () => {
      const service = new AutomationService(configWith('retryIntervalMs', 300000));
      expect(service.retryIntervalMs).toBe(300000);
    });

    it('should accept minimum valid retryIntervalMs (1ms)', () => {
      const service = new AutomationService(configWith('retryIntervalMs', 1));
      expect(service.retryIntervalMs).toBe(1);
    });
  });

  describe('maxFailureDurationMs validation', () => {
    it('should throw for missing maxFailureDurationMs', () => {
      expect(() => new AutomationService(configWithout('maxFailureDurationMs'))).toThrow(
        'maxFailureDurationMs is required in configuration and must be a positive integer (milliseconds)'
      );
    });

    it('should throw for null maxFailureDurationMs', () => {
      expect(() => new AutomationService(configWith('maxFailureDurationMs', null))).toThrow(
        'maxFailureDurationMs is required in configuration and must be a positive integer (milliseconds)'
      );
    });

    it('should throw for string maxFailureDurationMs', () => {
      expect(() => new AutomationService(configWith('maxFailureDurationMs', '3600000'))).toThrow(
        'maxFailureDurationMs is required in configuration and must be a positive integer (milliseconds)'
      );
    });

    it('should throw for floating point maxFailureDurationMs', () => {
      expect(() => new AutomationService(configWith('maxFailureDurationMs', 3600000.5))).toThrow(
        'maxFailureDurationMs is required in configuration and must be a positive integer (milliseconds)'
      );
    });

    it('should throw for zero maxFailureDurationMs', () => {
      expect(() => new AutomationService(configWith('maxFailureDurationMs', 0))).toThrow(
        'maxFailureDurationMs is required in configuration and must be a positive integer (milliseconds)'
      );
    });

    it('should throw for negative maxFailureDurationMs', () => {
      expect(() => new AutomationService(configWith('maxFailureDurationMs', -3600000))).toThrow(
        'maxFailureDurationMs is required in configuration and must be a positive integer (milliseconds)'
      );
    });

    it('should throw for NaN maxFailureDurationMs', () => {
      expect(() => new AutomationService(configWith('maxFailureDurationMs', NaN))).toThrow(
        'maxFailureDurationMs is required in configuration and must be a positive integer (milliseconds)'
      );
    });

    it('should throw for Infinity maxFailureDurationMs', () => {
      expect(() => new AutomationService(configWith('maxFailureDurationMs', Infinity))).toThrow(
        'maxFailureDurationMs is required in configuration and must be a positive integer (milliseconds)'
      );
    });

    it('should accept valid maxFailureDurationMs (1 minute)', () => {
      const service = new AutomationService(configWith('maxFailureDurationMs', 60000));
      expect(service.maxFailureDuration).toBe(60000);
    });

    it('should accept valid maxFailureDurationMs (1 hour)', () => {
      const service = new AutomationService(configWith('maxFailureDurationMs', 3600000));
      expect(service.maxFailureDuration).toBe(3600000);
    });

    it('should accept valid maxFailureDurationMs (24 hours)', () => {
      const service = new AutomationService(configWith('maxFailureDurationMs', 86400000));
      expect(service.maxFailureDuration).toBe(86400000);
    });

    it('should accept minimum valid maxFailureDurationMs (1ms)', () => {
      const service = new AutomationService(configWith('maxFailureDurationMs', 1));
      expect(service.maxFailureDuration).toBe(1);
    });
  });

  describe('Valid complete configuration', () => {
    it('should create service with all valid config values', () => {
      const service = new AutomationService(validBaseConfig);

      expect(service.automationServiceAddress).toBe(validBaseConfig.automationServiceAddress);
      expect(service.chainId).toBe(validBaseConfig.chainId);
      expect(service.wsUrl).toBe(validBaseConfig.wsUrl);
      expect(service.debug).toBe(validBaseConfig.debug);
      expect(service.blacklistFilePath).toBe(validBaseConfig.blacklistFilePath);
      expect(service.trackingDataDir).toBe(validBaseConfig.trackingDataDir);
      expect(service.retryIntervalMs).toBe(validBaseConfig.retryIntervalMs);
      expect(service.maxFailureDuration).toBe(validBaseConfig.maxFailureDurationMs);
    });
  });
});
