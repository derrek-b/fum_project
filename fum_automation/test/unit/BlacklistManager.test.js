/**
 * @fileoverview Unit tests for Blacklist Management functionality
 * Tests load/save error scenarios with real filesystem operations
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import AutomationService from '../../src/core/AutomationService.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

describe('Blacklist Management', () => {
  let tempDir;
  let blacklistPath;
  let service;

  // Create a minimal service config
  const createServiceConfig = (overrides = {}) => ({
    chainId: 1337,
    wsUrl: 'ws://localhost:8545',
    debug: true,
    ssePort: 3099, // Use non-standard port to avoid conflicts
    ...overrides
  });

  beforeEach(async () => {
    // Create a unique temp directory for each test
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'blacklist-test-'));
    blacklistPath = path.join(tempDir, 'blacklist.json');
  });

  afterEach(async () => {
    // Clean up service if it exists
    if (service) {
      try {
        // Force stop without caring about errors
        service.isRunning = false;
        service.provider = null;
      } catch (e) {
        // Ignore cleanup errors
      }
      service = null;
    }

    // Remove temp directory
    if (tempDir) {
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch (e) {
        // Ignore cleanup errors
      }
    }
  });

  describe('loadBlacklist', () => {
    it('should throw when directory does not exist', async () => {
      service = new AutomationService(createServiceConfig({
        dataDir: path.join(tempDir, 'nonexistent')
      }));

      // loadBlacklist is private, but we can test via start() catching the error
      // For direct testing, we access it directly
      await expect(service.loadBlacklist()).rejects.toThrow();
    });

    it('should create empty file when file missing (ENOENT)', async () => {
      // Directory exists (tempDir) but file doesn't
      service = new AutomationService(createServiceConfig({
        dataDir: tempDir
      }));

      await service.loadBlacklist();

      // Verify file was created
      const fileExists = await fs.access(blacklistPath).then(() => true).catch(() => false);
      expect(fileExists).toBe(true);

      // Verify contents is empty object
      const contents = await fs.readFile(blacklistPath, 'utf-8');
      expect(JSON.parse(contents)).toEqual({});

      // Verify in-memory state is empty
      expect(service.blacklistedVaults.size).toBe(0);
    });

    it('should throw on corrupt JSON', async () => {
      // Create file with invalid JSON
      await fs.writeFile(blacklistPath, 'not valid json {{{', 'utf-8');

      service = new AutomationService(createServiceConfig({
        dataDir: tempDir
      }));

      await expect(service.loadBlacklist()).rejects.toThrow();
    });

    it('should load existing blacklist data', async () => {
      // Create file with valid blacklist data
      const existingData = {
        '0x1111111111111111111111111111111111111111': {
          vaultAddress: '0x1111111111111111111111111111111111111111',
          blacklistedAt: 1234567890,
          reason: 'Test reason'
        },
        '0x2222222222222222222222222222222222222222': {
          vaultAddress: '0x2222222222222222222222222222222222222222',
          blacklistedAt: 1234567891,
          reason: 'Another reason'
        }
      };
      await fs.writeFile(blacklistPath, JSON.stringify(existingData), 'utf-8');

      service = new AutomationService(createServiceConfig({
        dataDir: tempDir
      }));

      await service.loadBlacklist();

      expect(service.blacklistedVaults.size).toBe(2);
      expect(service.isVaultBlacklisted('0x1111111111111111111111111111111111111111')).toBe(true);
      expect(service.isVaultBlacklisted('0x2222222222222222222222222222222222222222')).toBe(true);
    });
  });

  describe('saveBlacklist', () => {
    it('should write blacklist to file', async () => {
      service = new AutomationService(createServiceConfig({
        dataDir: tempDir
      }));

      // Add some data to the in-memory blacklist
      service.blacklistedVaults.set('0x1111111111111111111111111111111111111111', {
        vaultAddress: '0x1111111111111111111111111111111111111111',
        blacklistedAt: Date.now(),
        reason: 'Test'
      });

      await service.saveBlacklist();

      // Verify file contents
      const contents = await fs.readFile(blacklistPath, 'utf-8');
      const parsed = JSON.parse(contents);
      expect(Object.keys(parsed).length).toBe(1);
      expect(parsed['0x1111111111111111111111111111111111111111'].reason).toBe('Test');
    });

    it('should throw on write error (directory missing)', async () => {
      service = new AutomationService(createServiceConfig({
        dataDir: path.join(tempDir, 'nonexistent')
      }));

      await expect(service.saveBlacklist()).rejects.toThrow();
    });
  });

  describe('blacklistVault', () => {
    it('should add vault to blacklist and persist', async () => {
      service = new AutomationService(createServiceConfig({
        dataDir: tempDir
      }));

      const vaultAddress = '0x3333333333333333333333333333333333333333';
      await service.blacklistVault(vaultAddress, 'Bad vault');

      // Check in-memory state
      expect(service.isVaultBlacklisted(vaultAddress)).toBe(true);

      // Check persisted state
      const contents = await fs.readFile(blacklistPath, 'utf-8');
      const parsed = JSON.parse(contents);
      expect(parsed[vaultAddress]).toBeDefined();
      expect(parsed[vaultAddress].reason).toBe('Bad vault');
    });

    it('should call handleFatalError on save failure', async () => {
      service = new AutomationService(createServiceConfig({
        dataDir: path.join(tempDir, 'nonexistent')
      }));

      // Mock handleFatalError to prevent process.exit(1) from killing the test runner
      const handleFatalErrorSpy = vi.spyOn(service, 'handleFatalError').mockImplementation(() => {});

      await service.blacklistVault('0x4444444444444444444444444444444444444444', 'Test');

      expect(handleFatalErrorSpy).toHaveBeenCalled();
    });
  });

  describe('unblacklistVault', () => {
    it('should remove vault from blacklist and persist', async () => {
      // Set up initial blacklist
      const vaultAddress = '0x5555555555555555555555555555555555555555';
      const initialData = {
        [vaultAddress]: {
          vaultAddress,
          blacklistedAt: Date.now(),
          reason: 'Initial'
        }
      };
      await fs.writeFile(blacklistPath, JSON.stringify(initialData), 'utf-8');

      service = new AutomationService(createServiceConfig({
        dataDir: tempDir
      }));

      // Load existing blacklist
      await service.loadBlacklist();
      expect(service.isVaultBlacklisted(vaultAddress)).toBe(true);

      // Unblacklist
      await service.unblacklistVault(vaultAddress);

      // Check in-memory state
      expect(service.isVaultBlacklisted(vaultAddress)).toBe(false);

      // Check persisted state
      const contents = await fs.readFile(blacklistPath, 'utf-8');
      const parsed = JSON.parse(contents);
      expect(parsed[vaultAddress]).toBeUndefined();
    });

    it('should call handleFatalError on save failure', async () => {
      service = new AutomationService(createServiceConfig({
        dataDir: tempDir
      }));

      // Add a vault to blacklist (in memory only for this test)
      const vaultAddress = '0x6666666666666666666666666666666666666666';
      service.blacklistedVaults.set(vaultAddress, {
        vaultAddress,
        blacklistedAt: Date.now(),
        reason: 'Test'
      });

      // Now make the save fail by removing the directory
      await fs.rm(tempDir, { recursive: true, force: true });

      // Mock handleFatalError to prevent process.exit(1) from killing the test runner
      const handleFatalErrorSpy = vi.spyOn(service, 'handleFatalError').mockImplementation(() => {});

      await service.unblacklistVault(vaultAddress);

      expect(handleFatalErrorSpy).toHaveBeenCalled();
    });

    it('should not save if vault was not blacklisted', async () => {
      service = new AutomationService(createServiceConfig({
        dataDir: tempDir
      }));

      // Create initial blacklist file so we can check it wasn't modified
      await fs.writeFile(blacklistPath, '{}', 'utf-8');
      const statBefore = await fs.stat(blacklistPath);

      // Small delay to ensure mtime would change if file were written
      await new Promise(resolve => setTimeout(resolve, 10));

      // Try to unblacklist a vault that isn't blacklisted
      await service.unblacklistVault('0x7777777777777777777777777777777777777777');

      // File should not have been modified
      const statAfter = await fs.stat(blacklistPath);
      expect(statAfter.mtimeMs).toBe(statBefore.mtimeMs);
    });
  });
});
