/**
 * @fileoverview Test swap event detection with real swaps
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import AutomationService from '../../../src/AutomationService.js';
import { setupTestBlockchain, cleanupTestBlockchain } from '../../helpers/ganache-setup.js';
import { setupTestVault } from '../../helpers/test-vault-setup.js';
import { ethers } from 'ethers';
import { UniswapV3Adapter } from 'fum_library/adapters';

// ERC20 ABI for token approvals
const ERC20_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address account) view returns (uint256)'
];

// Mock the getPoolTVLAverage to avoid TVL validation issues
// Different TVL values for each fee tier to ensure 500 bps pool is always selected
vi.mock('fum_library', async () => {
  const actual = await vi.importActual('fum_library');
  return {
    ...actual,
    getPoolTVLAverage: vi.fn().mockImplementation((poolAddress) => {
      const address = poolAddress.toLowerCase();
      // WETH/USDC pool addresses on Arbitrum (fee tier determines address)
      // 500 bps (0.05%) - highest TVL to ensure it's always selected
      if (address === '0xc6962004f452be9203591991d15f6b388e09e8d0') {
        return Promise.resolve(100000000); // $100M
      }
      // 3000 bps (0.3%)
      if (address === '0xc31e54c7a869b9fcbecc14363cf510d1c41fa443') {
        return Promise.resolve(75000000); // $75M
      }
      // 100 bps (0.01%)
      if (address === '0x6f38e884725a116c9c7fbf208e79fe8828a2595f') {
        return Promise.resolve(50000000); // $50M
      }
      // 10000 bps (1%)
      if (address === '0x641c00a822e8b671738d32a431a4fb6074e5c79d') {
        return Promise.resolve(25000000); // $25M
      }
      // Default for any other pool
      return Promise.resolve(10000000); // $10M
    })
  };
});

describe('Swap Event Detection', () => {
  let testEnv;
  let service;
  let testVault;

  beforeAll(async () => {
    // Setup Ganache fork
    testEnv = await setupTestBlockchain({ port: 8551 });
    console.log('Ganache fork started');

    // Fund signer[1] for market manipulation (swaps)
    const swapWallet = testEnv.ganacheServer.signers[1];
    console.log('Setting up swap wallet (signer[1]) for market manipulation...');

    // Transfer 800 ETH to signer[1] from deployer (need lots for all the swaps)
    const fundTx = await testEnv.deployer.sendTransaction({
      to: swapWallet.address,
      value: ethers.utils.parseEther('1000')
    });
    await fundTx.wait();
    console.log(`  Funded swap wallet ${swapWallet.address} with 1000 ETH`);

    // Build USDC reserves for signer[1] for the reverse rebalance test (test 4)
    console.log('Building USDC reserves in swap wallet...');

    // Get token addresses
    const { getTokenAddress, getTokenBySymbol } = await import('fum_library');
    const wethAddress = getTokenAddress('WETH', 1337);
    const usdcAddress = getTokenAddress('USDC', 1337);
    const wethData = getTokenBySymbol('WETH');
    const usdcData = getTokenBySymbol('USDC');

    // Wrap 100 ETH for signer[1]
    const WETH_ABI = [
      'function deposit() payable',
      'function approve(address spender, uint256 amount) returns (bool)'
    ];
    const wethContract = new ethers.Contract(wethAddress, WETH_ABI, swapWallet);
    const wrapAmount = ethers.utils.parseEther('800');
    const wrapTx = await wethContract.deposit({ value: wrapAmount });
    await wrapTx.wait();
    console.log('  Wrapped 800 ETH to WETH for swap wallet');

    // Get Uniswap router for swapping
    const adapter = new UniswapV3Adapter(1337);
    const routerAddress = adapter.addresses.routerAddress;

    // Approve router to spend WETH
    const swapAmount = ethers.utils.parseEther('300');
    const approveTx = await wethContract.approve(routerAddress, swapAmount);
    await approveTx.wait();
    console.log('  Approved router for 300 WETH');

    // Swap 300 WETH to USDC to build reserves
    const swapParams = {
      tokenIn: wethAddress,
      tokenOut: usdcAddress,
      fee: 500,
      recipient: swapWallet.address,
      amountIn: swapAmount.toString(),
      slippageTolerance: 1,
      sqrtPriceLimitX96: "0",
      provider: testEnv.ganacheServer.provider,
      deadlineMinutes: 2
    };

    const swapData = await adapter.generateSwapData(swapParams);
    const swapTx = await swapWallet.sendTransaction({
      to: swapData.to,
      data: swapData.data,
      value: swapData.value,
    });
    await swapTx.wait();

    // Check USDC balance
    const USDC_ABI = ['function balanceOf(address account) view returns (uint256)'];
    const usdcContract = new ethers.Contract(usdcAddress, USDC_ABI, swapWallet);
    const usdcBalance = await usdcContract.balanceOf(swapWallet.address);
    console.log(`  USDC reserves built: ${ethers.utils.formatUnits(usdcBalance, usdcData.decimals)} USDC in swap wallet`);

    // Create test vault with one aligned position
    testVault = await setupTestVault(
      testEnv.ganacheServer,
      testEnv.contracts,
      testEnv.deployedContracts,
      {
        vaultName: 'Swap Detection Test Vault',
        automationServiceAddress: testEnv.testConfig.automationServiceAddress,
        wrapEthAmount: '10',
        swapTokens: [
          { from: 'WETH', to: 'USDC', amount: '5' }
        ],
        positions: [
          {
            token0: 'USDC',
            token1: 'WETH',
            fee: 500,
            percentOfAssets: 90,
            tickRange: {
              type: 'centered',
              spacing: 3  // Tighter range for easier rebalance testing
            }
          }
        ],
        targetTokens: ['USDC', 'WETH'],
        targetPlatforms: ['uniswapV3']
      }
    );
    console.log('Test vault created:', testVault.vaultAddress);

    // Configure tighter strategy parameters for easier bi-directional rebalancing
    console.log('Configuring strategy with tighter range parameters...');

    // Step 1: Authorize the vault to modify its own parameters
    const babyStepsStrategyAddress = testEnv.deployedContracts.BabyStepsStrategy;
    const strategyContract = new ethers.Contract(
      babyStepsStrategyAddress,
      ['function authorizeVault(address vault) external'],
      testEnv.ganacheServer.signers[0]  // Owner/deployer
    );

    const authTx = await strategyContract.authorizeVault(testVault.vaultAddress);
    await authTx.wait();
    console.log('  Vault authorized to modify strategy parameters');

    // Step 2: Encode the setRangeParameters call
    const strategyInterface = new ethers.utils.Interface([
      'function setRangeParameters(uint16 upperRange, uint16 lowerRange, uint16 upperThreshold, uint16 lowerThreshold) external',
      'function setRiskParameters(uint16 slippage, uint16 exitTrigger, uint16 utilization) external',
      'function setFeeParameters(bool reinvest, uint256 trigger, uint16 ratio) external'
    ]);

    const setRangeData = strategyInterface.encodeFunctionData('setRangeParameters', [
      25,   // targetRangeUpper: 25 basis points = 0.25% (±2.5 tick spacings - tighter for testing)
      25,   // targetRangeLower: 25 basis points = 0.25%
      150,  // rebalanceThresholdUpper: 150 basis points = 1.5% (default)
      150   // rebalanceThresholdLower: 150 basis points = 1.5% (default)
    ]);

    const setRiskData = strategyInterface.encodeFunctionData('setRiskParameters', [
      500,  // maxSlippage: 500 basis points = 5% (default)
      50,   // emergencyExitTrigger: 60 basis points = 0.6% (tight for testing - triggers at 0.66%)
      8000  // maxUtilization: 8000 basis points = 80% (default)
    ]);

    const setFeeData = strategyInterface.encodeFunctionData('setFeeParameters', [
      true,  // feeReinvestment: enabled
      100,   // reinvestmentTrigger: 100 = $1.00 (value in cents for precision)
      5000   // reinvestmentRatio: 50% (5000 basis points)
    ]);

    // Step 3: Call through vault's execute function as the owner
    const executeTx = await testVault.vault.execute(
      [babyStepsStrategyAddress, babyStepsStrategyAddress, babyStepsStrategyAddress],  // targets array
      [setRangeData, setRiskData, setFeeData]                                         // data array
    );
    await executeTx.wait();
    console.log('  Strategy parameters set: 0.5% ranges, 0.7% emergency exit trigger, $1 fee collection trigger');

    // Initialize automation service
    service = new AutomationService(testEnv.testConfig);

    // Start the service
    await service.start();
    console.log('Automation service started');
  }, 180000); // 3 minute timeout

  afterAll(async () => {
    if (service?.isRunning) {
      await service.stop();
    }
    await cleanupTestBlockchain(testEnv);

    // Clean up the blacklist file for next test run
    const fs = await import('fs/promises');
    const path = await import('path');
    const { fileURLToPath } = await import('url');
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const blacklistPath = path.join(__dirname, '../../../data/.vault-blacklist.json');
    const emptyBlacklist = {
      version: "1.0",
      blacklisted: {}
    };
    await fs.writeFile(blacklistPath, JSON.stringify(emptyBlacklist, null, 2));
    console.log('📝 Cleared .vault-blacklist.json for next test run');
  });

  it('should have registered swap event listeners for the vault', async () => {
    // Wait for service to discover and set up the vault
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Check if vault was successfully initialized
    const vaultInitialized = service.vaultDataService.hasVault(testVault.vaultAddress);
    expect(vaultInitialized).toBe(true);

    // Get vault data from the service
    const vaultData = await service.vaultDataService.getVault(testVault.vaultAddress);
    expect(vaultData).toBeDefined();

    // Get the position details from the vault data
    const positions = Object.values(vaultData.positions);
    expect(positions.length).toBeGreaterThan(0);

    const position = positions[0];
    const poolAddress = position.pool;

    // Check that the swap listener was registered for the pool
    const swapListenerKey = `${poolAddress.toLowerCase()}-swap-1337-uniswapV3`;
    expect(service.eventManager.listeners[swapListenerKey]).toBeDefined();

    // Check that the vault is in the pool mapping
    expect(service.eventManager.poolToVaults[poolAddress]).toContain(testVault.vaultAddress);

    // Check that config event listeners were registered for the vault
    const tokenListenerKey = `${testVault.vaultAddress.toLowerCase()}-config-tokens-1337`;
    const platformListenerKey = `${testVault.vaultAddress.toLowerCase()}-config-platforms-1337`;

    expect(service.eventManager.listeners[tokenListenerKey]).toBeDefined();
    expect(service.eventManager.listeners[platformListenerKey]).toBeDefined();

    console.log(`✅ All event listeners registered for vault ${testVault.vaultAddress}`);
  });

  it('should detect swap events and prevent concurrent processing', async () => {
    // Use signer[1] as swap wallet
    const swapWallet = testEnv.ganacheServer.signers[1];

    // Get token data from service's cache
    const wethData = service.tokens['WETH'];
    const usdcData = service.tokens['USDC'];
    const wethAddress = wethData.address;
    const usdcAddress = usdcData.address;

    // Use adapter from service's cache
    const adapter = service.adapters.get('uniswapV3');

    // Get router address from adapter
    const routerAddress = adapter.addresses.routerAddress;

    // Prepare two swap amounts
    const swapAmount1 = ethers.utils.parseUnits('0.1', wethData.decimals);
    const swapAmount2 = ethers.utils.parseUnits('0.15', wethData.decimals);
    const totalApproval = swapAmount1 + swapAmount2;

    // Approve router to spend WETH for both swaps (from swap wallet)
    const wethContract = new ethers.Contract(wethAddress, ERC20_ABI, swapWallet);
    const approveTx = await wethContract.approve(routerAddress, totalApproval);
    await approveTx.wait();
    console.log('WETH approval granted to router for both swaps from swap wallet');

    // Set up event listeners to track vault locking
    const vaultLockEvents = [];
    const vaultUnlockEvents = [];

    // Listen to VaultLocked events
    service.eventManager.subscribe('VaultLocked', (data) => {
      vaultLockEvents.push(data);
    });

    // Listen to VaultUnlocked events
    service.eventManager.subscribe('VaultUnlocked', (data) => {
      vaultUnlockEvents.push(data);
    });

    // Prepare swap parameters for both swaps
    const swapParams1 = {
      tokenIn: wethAddress,
      tokenOut: usdcAddress,
      fee: 500,
      recipient: swapWallet.address,
      amountIn: swapAmount1.toString(),
      slippageTolerance: 5,
      sqrtPriceLimitX96: "0",
      provider: testEnv.ganacheServer.provider,
      deadlineMinutes: 2
    };

    const swapParams2 = {
      tokenIn: wethAddress,
      tokenOut: usdcAddress,
      fee: 500,
      recipient: swapWallet.address,
      amountIn: swapAmount2.toString(),
      slippageTolerance: 5,
      sqrtPriceLimitX96: "0",
      provider: testEnv.ganacheServer.provider,
      deadlineMinutes: 2
    };

    // Generate swap data for both swaps
    console.log('Generating swap data for both transactions...');
    const [swapData1, swapData2] = await Promise.all([
      adapter.generateSwapData(swapParams1),
      adapter.generateSwapData(swapParams2)
    ]);

    console.log('Executing both swaps simultaneously...');

    // Get the current nonce for the swap wallet
    const currentNonce = await swapWallet.provider.getTransactionCount(swapWallet.address);
    console.log(`Current nonce: ${currentNonce}`);

    // Execute both swaps simultaneously with explicit nonces
    const [swapTx1, swapTx2] = await Promise.all([
      swapWallet.sendTransaction({
        to: swapData1.to,
        data: swapData1.data,
        value: swapData1.value,
        nonce: currentNonce  // First transaction uses current nonce
      }),
      swapWallet.sendTransaction({
        to: swapData2.to,
        data: swapData2.data,
        value: swapData2.value,
        nonce: currentNonce + 1  // Second transaction uses next nonce
      })
    ]);

    // Wait for both transactions to be mined
    console.log('Waiting for both transactions to be mined...');
    const [receipt1, receipt2] = await Promise.all([
      swapTx1.wait(),
      swapTx2.wait()
    ]);

    console.log(`Swap 1 completed in block ${receipt1.blockNumber}: 0.1 WETH → USDC`);
    console.log(`Swap 2 completed in block ${receipt2.blockNumber}: 0.15 WETH → USDC`);

    // Wait for event processing
    console.log('Waiting for event processing...');
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Verify results using the events
    console.log(`\n📊 Processing Summary:`);
    console.log(`  - VaultLocked events: ${vaultLockEvents.length}`);
    console.log(`  - VaultUnlocked events: ${vaultUnlockEvents.length}`);

    // We should see at one lock/unlock cycle
    expect(vaultLockEvents.length).toEqual(1);
    expect(vaultUnlockEvents.length).toEqual(1);

    // The number of locks should equal the number of unlocks (no hanging locks)
    expect(vaultLockEvents.length).toBe(vaultUnlockEvents.length);

    // Vault should be unlocked at the end
    const vaultAddress = testVault.vaultAddress.toLowerCase();
    expect(service.vaultLocks[vaultAddress]).toBeFalsy();

    console.log('✅ Concurrent processing protection verified using lock/unlock events!');
  }, 60000);

  it('should trigger fee collection when accumulated fees exceed threshold', async () => {
    // Setup
    const swapWallet = testEnv.ganacheServer.signers[1];
    const vaultData = await service.vaultDataService.getVault(testVault.vaultAddress);
    const position = Object.values(vaultData.positions)[0];

    // Get token data
    const wethData = service.tokens['WETH'];
    const usdcData = service.tokens['USDC'];

    // Use adapter from service's cache
    const adapter = service.adapters.get('uniswapV3');
    const routerAddress = adapter.addresses.routerAddress;

    // Get token contracts for approvals
    const wethContract = new ethers.Contract(wethData.address, ERC20_ABI, swapWallet);
    const usdcContract = new ethers.Contract(usdcData.address, ERC20_ABI, swapWallet);

    // Track FeesCollected events
    let feesCollectedEvent = null;
    let swapCount = 0;

    service.eventManager.subscribe('FeesCollected', (data) => {
      console.log(`\n💰💰💰 FEES COLLECTED for position ${data.positionId} after ${swapCount} swaps`);
      feesCollectedEvent = data;
    });

    // Execute ETH->USDC swaps until fee collection triggers
    const swapSizeETH = ethers.utils.parseUnits('10', wethData.decimals); // 10 ETH per swap
    const maxSwaps = 10; // Safety limit to prevent infinite loop

    console.log(`\n🔄 Starting fee collection test - Position ${position.id}`);

    // Pre-approve router for all WETH swaps
    console.log(`  Pre-approving router for WETH swaps...`);
    const preApproveTx = await wethContract.approve(routerAddress, ethers.constants.MaxUint256);
    await preApproveTx.wait();

    // Execute swaps until fee collection triggers or max swaps reached
    for (let i = 0; i < maxSwaps && !feesCollectedEvent; i++) {
      swapCount++;
      console.log(`\n  Swap ${swapCount}: Swapping 10 ETH for USDC...`);

      // Generate swap data for ETH → USDC (no approval needed since we pre-approved)
      const swapParams = {
        tokenIn: wethData.address,
        tokenOut: usdcData.address,
        fee: 500, // 0.01% fee tier
        recipient: swapWallet.address,
        amountIn: swapSizeETH.toString(),
        slippageTolerance: 5,
        sqrtPriceLimitX96: "0",
        provider: testEnv.ganacheServer.provider,
        deadlineMinutes: 2
      };

      const swapData = await adapter.generateSwapData(swapParams);

      const swapTx = await swapWallet.sendTransaction({
        to: swapData.to,
        data: swapData.data,
        value: swapData.value,
        gasLimit: 500000
      });
      const receipt = await swapTx.wait();
      console.log(`    Swap completed in block ${receipt.blockNumber}`);

      // Wait for swap event processing
      console.log('    Waiting for event processing...');
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Check if fee collection was triggered and break early
      if (feesCollectedEvent) {
        console.log(`\n  ✅ Fee collection triggered after ${swapCount} swaps!`);
        break;
      }
    }

    // Verify fee collection was triggered
    if (!feesCollectedEvent) {
      console.log(`\n⚠️ Fee collection was not triggered after ${swapCount} swaps`);
      console.log('  Check the logs above to see calculated fee amounts');
    }

    expect(feesCollectedEvent).toBeTruthy();
    expect(feesCollectedEvent.vaultAddress).toBe(testVault.vaultAddress);
    expect(feesCollectedEvent.positionId).toBe(position.id);

    // Verify that actual fees were collected (not zero)
    expect(feesCollectedEvent.totalUSD).toBeGreaterThan(0);
    expect(feesCollectedEvent.token0Collected + feesCollectedEvent.token1Collected).toBeGreaterThan(0);

    // Verify fee distribution calculations (50% reinvestment ratio)
    const expectedReinvestmentRatio = 5000 / 100; // 50%
    expect(feesCollectedEvent.reinvestmentRatio).toBe(expectedReinvestmentRatio);

    // Verify at least one token has fees (since we're doing unidirectional swaps)
    expect(feesCollectedEvent.token0Collected > 0 || feesCollectedEvent.token1Collected > 0).toBe(true);

    // Log a warning if both tokens are zero (shouldn't happen but helps debug)
    if (feesCollectedEvent.token0Collected === 0 && feesCollectedEvent.token1Collected === 0) {
      console.error('WARNING: Both token fees are zero - this indicates a parsing issue!');
    }

    // Verify that fees were split correctly (50/50)
    const tolerance = 0.0001; // Small tolerance for rounding

    // Token0 distribution (only if token0 fees were collected)
    const token0Total = feesCollectedEvent.token0Collected;
    if (token0Total > 0) {
      const token0Expected = token0Total / 2;
      expect(Math.abs(feesCollectedEvent.token0ToOwner - token0Expected)).toBeLessThan(tolerance);
      expect(Math.abs(feesCollectedEvent.token0Reinvested - token0Expected)).toBeLessThan(tolerance);
    }

    // Token1 distribution (only if token1 fees were collected)
    const token1Total = feesCollectedEvent.token1Collected;
    if (token1Total > 0) {
      const token1Expected = token1Total / 2;
      expect(Math.abs(feesCollectedEvent.token1ToOwner - token1Expected)).toBeLessThan(tolerance);
      expect(Math.abs(feesCollectedEvent.token1Reinvested - token1Expected)).toBeLessThan(tolerance);
    }

    console.log(`\n✅ Fee collection and distribution verified after ${swapCount} swaps!`);
    console.log(`   Total collected: $${feesCollectedEvent.totalUSD.toFixed(2)}`);
    console.log(`   Sent to owner: ${feesCollectedEvent.token0ToOwner.toFixed(6)} ${feesCollectedEvent.token0Symbol}, ${feesCollectedEvent.token1ToOwner.toFixed(6)} ${feesCollectedEvent.token1Symbol}`);
    console.log(`   Kept for reinvestment: ${feesCollectedEvent.token0Reinvested.toFixed(6)} ${feesCollectedEvent.token0Symbol}, ${feesCollectedEvent.token1Reinvested.toFixed(6)} ${feesCollectedEvent.token1Symbol}`);
  }, 120000);

  it('should trigger rebalance when tick crosses lower threshold', async () => {
    // Use signer[1] as swap wallet
    const swapWallet = testEnv.ganacheServer.signers[1];

    // Get vault's current position
    const vaultData = await service.vaultDataService.getVault(testVault.vaultAddress);
    const positions = Object.values(vaultData.positions);
    expect(positions.length).toBeGreaterThan(0);
    const position = positions[0];

    // Get token data from service cache
    const wethData = service.tokens['WETH'];
    const usdcData = service.tokens['USDC'];

    // Use adapter from service
    const adapter = service.adapters.get('uniswapV3');

    // Get pool data for current tick
    const poolData = await adapter.fetchPoolData(
      usdcData.address,
      wethData.address,
      100,
      testEnv.ganacheServer.provider
    );

    // Calculate rebalance threshold tick (1.5% from boundary)
    const tickRange = position.tickUpper - position.tickLower;
    const thresholdDistance = Math.floor(tickRange * 0.015);
    const lowerThresholdTick = position.tickLower + thresholdDistance;

    console.log(`\n📊 Rebalance Test Setup:`);
    console.log(`  Current tick: ${poolData.tick}`);
    console.log(`  Position range: ${position.tickLower} to ${position.tickUpper}`);
    console.log(`  Lower threshold tick: ${lowerThresholdTick}`);
    console.log(`  Ticks to move: ${poolData.tick - lowerThresholdTick}`);

    // Change fee collection trigger to $5 to reduce fee collections during swaps
    const babyStepsStrategyAddress = testEnv.deployedContracts.BabyStepsStrategy;
    const strategyInterface = new ethers.utils.Interface([
      'function setFeeParameters(bool reinvest, uint256 trigger, uint16 ratio) external'
    ]);
    const setFeeData = strategyInterface.encodeFunctionData('setFeeParameters', [
      true,  // feeReinvestment: enabled
      500,   // reinvestmentTrigger: 500 = $5.00 (value in cents for precision)
      5000   // reinvestmentRatio: 50% (5000 basis points)
    ]);
    const feeChangeTx = await testVault.vault.execute(
      [babyStepsStrategyAddress],
      [setFeeData]
    );
    await feeChangeTx.wait();
    console.log('  Changed fee collection trigger to $5.00 for rebalance test');

    // Set up event listeners for rebalance
    const rebalanceEvents = [];
    const vaultLockEvents = [];
    const vaultUnlockEvents = [];
    const feesCollectedEvents = [];

    service.eventManager.subscribe('PositionRebalanced', (data) => {
      console.log(`🔄 PositionRebalanced event: vault ${data.vaultAddress}`);
      rebalanceEvents.push(data);
    });

    service.eventManager.subscribe('FeesCollected', (data) => {
      if (data.source === 'rebalance') {
        console.log(`💰 FeesCollected - Position ${data.positionId}`);
        feesCollectedEvents.push(data);
      }
    });

    service.eventManager.subscribe('VaultLocked', (data) => {
      vaultLockEvents.push(data);
    });

    service.eventManager.subscribe('VaultUnlocked', (data) => {
      vaultUnlockEvents.push(data);
    });

    // Prepare for multiple swaps to move the market
    const swapSize = ethers.utils.parseUnits('20', wethData.decimals); // 20 ETH per swap (proven to work)
    const routerAddress = adapter.addresses.routerAddress;

    // First, wrap more ETH for the swaps (for swap wallet)
    const maxSwaps = 30; // More swaps since they're smaller
    const totalWethNeeded = swapSize.mul(maxSwaps);

    const WETH_ABI = [
      'function deposit() payable',
      'function approve(address spender, uint256 amount) returns (bool)',
      'function balanceOf(address account) view returns (uint256)'
    ];

    const wethContract = new ethers.Contract(wethData.address, WETH_ABI, swapWallet);

    // Check if swap wallet has enough ETH, if not wrap more
    const wethBalance = await wethContract.balanceOf(swapWallet.address);
    // wethBalance is already a BigNumber from the contract call
    if (wethBalance.lt(totalWethNeeded)) {
      const additionalWeth = totalWethNeeded.sub(wethBalance);
      console.log(`Wrapping additional ${ethers.utils.formatEther(additionalWeth)} ETH for swaps...`);
      const wrapTx = await wethContract.deposit({ value: additionalWeth });
      await wrapTx.wait();
    }

    // Now approve router for the total amount needed
    const approveTx = await wethContract.approve(routerAddress, totalWethNeeded);
    await approveTx.wait();
    console.log(`Approved router for up to ${maxSwaps} swaps of 20 ETH each`);

    // Swap loop to move tick toward threshold
    let currentTick = poolData.tick;
    let swapCount = 0;
    let currentNonce = await swapWallet.provider.getTransactionCount(swapWallet.address);

    console.log('\n🔄 Executing swaps to move tick to threshold...');

    while (currentTick > lowerThresholdTick && swapCount < maxSwaps) {
      try {
        const swapParams = {
          tokenIn: wethData.address,
          tokenOut: usdcData.address,
          fee: 500,
          recipient: swapWallet.address,
          amountIn: swapSize.toString(),
          slippageTolerance: 100, // Accept any price (100% means no slippage protection)
          sqrtPriceLimitX96: "0",
          provider: testEnv.ganacheServer.provider,
          deadlineMinutes: 2
        };

        const swapData = await adapter.generateSwapData(swapParams);
        const tx = await swapWallet.sendTransaction({
          to: swapData.to,
          data: swapData.data,
          value: swapData.value,
          nonce: currentNonce + swapCount
        });
        await tx.wait();

        // Add 1 second delay for state sync
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Fetch updated tick
        const updatedPool = await adapter.fetchPoolData(
          usdcData.address,
          wethData.address,
          500,
          testEnv.ganacheServer.provider
        );
        currentTick = updatedPool.tick;
        swapCount++;

        const distance = currentTick - lowerThresholdTick;
        console.log(`  Swap ${swapCount}: Tick at ${currentTick} (${distance > 0 ? '+' : ''}${distance} from threshold)`);

        // Check if we've crossed the threshold
        if (distance <= 0) {
          console.log('  🎯 Threshold crossed! Tick is now at or below threshold.');
          console.log(`  📊 Current state: ${vaultLockEvents.length} locks, ${vaultUnlockEvents.length} unlocks, ${rebalanceEvents.length} rebalances`);
          console.log('  ⏳ Waiting for rebalance to complete...');

          // Wait for the PositionRebalanced event
          const startTime = Date.now();
          const timeout = 60000; // 60 seconds max (increased for create position transaction)
          let lastLogTime = Date.now();

          while (rebalanceEvents.length === 0 && (Date.now() - startTime) < timeout) {
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Log progress every 3 seconds
            if (Date.now() - lastLogTime >= 3000) {
              const elapsed = Math.floor((Date.now() - startTime) / 1000);
              console.log(`  ⏳ Still waiting for rebalance... ${elapsed}s elapsed`);
              console.log(`    Current events: ${vaultLockEvents.length} locks, ${vaultUnlockEvents.length} unlocks, ${rebalanceEvents.length} rebalances`);
              lastLogTime = Date.now();
            }
          }

          if (rebalanceEvents.length > 0) {
            console.log('  ✅ Rebalance completed successfully!');
            console.log(`  📊 Final state: ${vaultLockEvents.length} locks, ${vaultUnlockEvents.length} unlocks, ${rebalanceEvents.length} rebalances`);
            break;
          } else {
            console.log('  ⚠️ Rebalance timeout after 30 seconds - may still be processing');
            console.log(`  📊 Timeout state: ${vaultLockEvents.length} locks, ${vaultUnlockEvents.length} unlocks, ${rebalanceEvents.length} rebalances`);
            break;
          }
        }
      } catch (error) {
        console.log(`  ⚠️ Swap ${swapCount + 1} failed: ${error.message}`);
        swapCount++;
        // Continue trying with next swap
        continue;
      }
    }

    // If we didn't hit the threshold in the loop, wait a bit for any pending events
    if (rebalanceEvents.length === 0) {
      console.log('\n⏳ No rebalance detected during swaps, waiting for any pending events...');
      await new Promise(resolve => setTimeout(resolve, 5000));
    }

    // Verify rebalance occurred
    console.log('\n📋 Verification:');
    expect(rebalanceEvents.length).toBeGreaterThan(0);
    console.log(`  ✓ Rebalance events: ${rebalanceEvents.length}`);

    expect(vaultLockEvents.length).toBeGreaterThan(0);
    console.log(`  ✓ Vault lock events: ${vaultLockEvents.length}`);

    expect(vaultUnlockEvents.length).toBe(vaultLockEvents.length);
    console.log(`  ✓ Vault unlock events: ${vaultUnlockEvents.length}`);

    // Check old position was closed
    const updatedVault = await service.vaultDataService.getVault(testVault.vaultAddress);
    const oldPositionUpdated = updatedVault.positions[position.id];

    if (oldPositionUpdated) {
      expect(oldPositionUpdated.liquidity).toBe('0');
      console.log(`  ✓ Old position ${position.id} closed (liquidity: 0)`);
    }

    // Check new position was created
    const activePositions = Object.values(updatedVault.positions).filter(p => p.liquidity !== '0');
    expect(activePositions.length).toBeGreaterThan(0);
    console.log(`  ✓ Active positions: ${activePositions.length}`);

    const newPosition = activePositions[0];
    console.log(`  ✓ New position: ${newPosition.id}`);
    console.log(`    Range: ${newPosition.tickLower} to ${newPosition.tickUpper}`);

    // Verify new position is reasonably centered around current tick
    const newCenter = Math.floor((newPosition.tickLower + newPosition.tickUpper) / 2);
    const tickSpacing = 10;
    const centerDistance = Math.abs(newCenter - currentTick);
    console.log(`    Center: ${newCenter} (${centerDistance} ticks from current)`);

    // Verify FeesCollected event during rebalance
    if (feesCollectedEvents.length > 0) {
      console.log(`  ✓ FeesCollected events during rebalance: ${feesCollectedEvents.length}`);
      const feeEvent = feesCollectedEvents[0];

      // Verify reinvestment ratio was respected (50%)
      const tolerance = 0.0001;
      const expectedReinvestmentRatio = 5000 / 100; // 50%
      expect(feeEvent.reinvestmentRatio).toBe(expectedReinvestmentRatio);

      // Verify fees were distributed correctly
      const token0Total = feeEvent.token0Collected;
      const token1Total = feeEvent.token1Collected;

      if (token0Total > 0) {
        const token0Expected = token0Total / 2;
        expect(Math.abs(feeEvent.token0ToOwner - token0Expected)).toBeLessThan(tolerance);
        expect(Math.abs(feeEvent.token0Reinvested - token0Expected)).toBeLessThan(tolerance);
        console.log(`    Token0 fees distributed correctly: ${feeEvent.token0ToOwner.toFixed(6)} to owner, ${feeEvent.token0Reinvested.toFixed(6)} reinvested`);
      }

      if (token1Total > 0) {
        const token1Expected = token1Total / 2;
        expect(Math.abs(feeEvent.token1ToOwner - token1Expected)).toBeLessThan(tolerance);
        expect(Math.abs(feeEvent.token1Reinvested - token1Expected)).toBeLessThan(tolerance);
        console.log(`    Token1 fees distributed correctly: ${feeEvent.token1ToOwner.toFixed(6)} to owner, ${feeEvent.token1Reinvested.toFixed(6)} reinvested`);
      }
    } else {
      console.log(`  ℹ️ No fees collected during rebalance (position may have had minimal fees)`);
    }

    // Allow some flexibility in centering due to tick spacing constraints
    expect(centerDistance).toBeLessThan(tickSpacing * 10);

    console.log('\n✅ Rebalance triggered and executed successfully!');
  }, 120000); // 2 minute timeout

  it('should trigger rebalance in reverse direction when tick crosses upper threshold', async () => {
    console.log('\n🔄 Starting reverse rebalance test (USDC → WETH)...');

    // Use signer[1] as swap wallet
    const swapWallet = testEnv.ganacheServer.signers[1];

    // Get the updated vault state after the previous rebalance
    const vaultData = await service.vaultDataService.getVault(testVault.vaultAddress);
    const positions = Object.values(vaultData.positions).filter(p => p.liquidity !== '0');
    expect(positions.length).toBeGreaterThan(0);

    const newPosition = positions[0]; // The position created after first rebalance
    console.log(`\n📊 New position after first rebalance:`);
    console.log(`  Position ID: ${newPosition.id}`);
    console.log(`  Range: ${newPosition.tickLower} to ${newPosition.tickUpper}`);

    // Get token data from service cache
    const wethData = service.tokens['WETH'];
    const usdcData = service.tokens['USDC'];

    // Use adapter from service
    const adapter = service.adapters.get('uniswapV3');

    // Get current pool state (use same fee tier as first test: 500)
    const poolData = await adapter.fetchPoolData(
      usdcData.address,
      wethData.address,
      500,
      testEnv.ganacheServer.provider
    );

    // Calculate upper threshold tick (1.5% from upper boundary)
    const tickRange = newPosition.tickUpper - newPosition.tickLower;
    const thresholdDistance = Math.floor(tickRange * 0.015);
    const upperThresholdTick = newPosition.tickUpper - thresholdDistance;

    console.log(`\n📊 Reverse Rebalance Setup:`);
    console.log(`  Current tick: ${poolData.tick}`);
    console.log(`  New position range: ${newPosition.tickLower} to ${newPosition.tickUpper}`);
    console.log(`  Upper threshold tick: ${upperThresholdTick}`);
    console.log(`  Ticks to move up: ${upperThresholdTick - poolData.tick}`);

    // Set up event listeners for second rebalance
    const rebalanceEvents = [];
    const vaultLockEvents = [];
    const vaultUnlockEvents = [];
    const feesCollectedEvents = [];

    service.eventManager.subscribe('PositionRebalanced', (data) => {
      console.log(`🔄 PositionRebalanced event (reverse): vault ${data.vaultAddress}`);
      rebalanceEvents.push(data);
    });

    service.eventManager.subscribe('FeesCollected', (data) => {
      if (data.source === 'rebalance') {
        console.log(`💰 FeesCollected - Position ${data.positionId}`);
        feesCollectedEvents.push(data);
      }
    });

    service.eventManager.subscribe('VaultLocked', (data) => {
      vaultLockEvents.push(data);
    });

    service.eventManager.subscribe('VaultUnlocked', (data) => {
      vaultUnlockEvents.push(data);
    });

    // Get swap wallet's USDC balance
    const USDC_ABI = [
      'function balanceOf(address account) view returns (uint256)',
      'function approve(address spender, uint256 amount) returns (bool)'
    ];
    const usdcContract = new ethers.Contract(usdcData.address, USDC_ABI, swapWallet);
    const swapWalletUsdcBalance = await usdcContract.balanceOf(swapWallet.address);
    console.log(`\n💰 Swap wallet USDC balance: ${ethers.utils.formatUnits(swapWalletUsdcBalance, usdcData.decimals)} USDC`);

    // Calculate swap size - match the dollar value of our WETH swaps (20 ETH ≈ 80,000 USDC)
    const maxSwaps = 20; // Should need ~15-17 swaps at this size
    const swapSize = ethers.utils.parseUnits('80000', usdcData.decimals); // 80k USDC per swap (matches 20 ETH swaps)
    console.log(`  Swap size: ${ethers.utils.formatUnits(swapSize, usdcData.decimals)} USDC per swap`);
    console.log(`  Total USDC needed: ~${ethers.utils.formatUnits(swapSize.mul(17), usdcData.decimals)} USDC (have ${ethers.utils.formatUnits(swapWalletUsdcBalance, usdcData.decimals)})`);

    // Approve router for USDC
    const routerAddress = adapter.addresses.routerAddress;
    const approveTx = await usdcContract.approve(routerAddress, swapWalletUsdcBalance);
    await approveTx.wait();
    console.log(`  Approved router for all USDC`);

    // Swap loop to move tick upward toward upper threshold
    let currentTick = poolData.tick;
    let swapCount = 0;
    let currentNonce = await swapWallet.provider.getTransactionCount(swapWallet.address);

    console.log('\n🔄 Executing USDC → WETH swaps to move tick upward...');

    while (currentTick < upperThresholdTick && swapCount < maxSwaps) {
      try {
        const swapParams = {
          tokenIn: usdcData.address,
          tokenOut: wethData.address,
          fee: 500,
          recipient: swapWallet.address,
          amountIn: swapSize.toString(),
          slippageTolerance: 100, // Accept any price
          sqrtPriceLimitX96: "0",
          provider: testEnv.ganacheServer.provider,
          deadlineMinutes: 2
        };

        const swapData = await adapter.generateSwapData(swapParams);
        const tx = await swapWallet.sendTransaction({
          to: swapData.to,
          data: swapData.data,
          value: swapData.value,
          nonce: currentNonce + swapCount
        });
        await tx.wait();

        // Add 1 second delay for state sync
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Fetch updated tick
        const updatedPool = await adapter.fetchPoolData(
          usdcData.address,
          wethData.address,
          500,
          testEnv.ganacheServer.provider
        );
        currentTick = updatedPool.tick;
        swapCount++;

        const distance = upperThresholdTick - currentTick;
        console.log(`  Swap ${swapCount}: Tick at ${currentTick} (${distance > 0 ? '-' : '+'}${Math.abs(distance)} from threshold)`);

        // Check if we've crossed the threshold
        if (distance <= 0) {
          console.log('  🎯 Upper threshold crossed! Tick is now at or above threshold.');
          console.log('  ⏳ Waiting for reverse rebalance to complete...');

          // Wait for the PositionRebalanced event
          const startTime = Date.now();
          const timeout = 60000; // 60 seconds max (increased for create position transaction)

          while (rebalanceEvents.length === 0 && (Date.now() - startTime) < timeout) {
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Log progress every 5 seconds
            if ((Date.now() - startTime) % 5000 < 1000) {
              console.log(`  ⏳ Still waiting... (${Math.floor((Date.now() - startTime) / 1000)}s)`);
            }
          }
          break;
        }

      } catch (error) {
        console.error(`  ⚠️ Swap ${swapCount + 1} failed:`, error.message);
        break;
      }
    }

    // If we didn't hit the threshold, wait for any pending events
    if (rebalanceEvents.length === 0) {
      console.log('\n⏳ No rebalance detected during swaps, waiting for any pending events...');
      await new Promise(resolve => setTimeout(resolve, 5000));
    }

    // Verify reverse rebalance occurred
    console.log('\n📋 Reverse Rebalance Verification:');
    expect(rebalanceEvents.length).toBeGreaterThan(0);
    console.log(`  ✓ Rebalance events: ${rebalanceEvents.length}`);

    expect(vaultLockEvents.length).toBeGreaterThan(0);
    console.log(`  ✓ Vault lock events: ${vaultLockEvents.length}`);

    expect(vaultUnlockEvents.length).toBe(vaultLockEvents.length);
    console.log(`  ✓ Vault unlock events: ${vaultUnlockEvents.length}`);

    // Check that the previous position was closed
    const finalVault = await service.vaultDataService.getVault(testVault.vaultAddress);
    const previousPositionUpdated = finalVault.positions[newPosition.id];

    if (previousPositionUpdated) {
      expect(previousPositionUpdated.liquidity).toBe('0');
      console.log(`  ✓ Previous position ${newPosition.id} closed (liquidity: 0)`);
    }

    // Check new position was created with correct range
    const finalActivePositions = Object.values(finalVault.positions).filter(p => p.liquidity !== '0');
    expect(finalActivePositions.length).toBeGreaterThan(0);

    const finalPosition = finalActivePositions[0];
    const finalRange = finalPosition.tickUpper - finalPosition.tickLower;
    console.log(`  ✓ New position created: ID ${finalPosition.id}`);
    console.log(`  ✓ New position range: ${finalPosition.tickLower} to ${finalPosition.tickUpper} (width: ${finalRange} ticks)`);

    // Verify it's using the 0.5% parameters (should be ~100 ticks range)
    expect(finalRange).toBeLessThan(150); // Should be much smaller than default 1000 ticks
    console.log(`  ✓ Range confirms 0.5% parameters applied (${finalRange} ticks < 150)`);

    // Verify FeesCollected event during reverse rebalance
    if (feesCollectedEvents.length > 0) {
      console.log(`  ✓ FeesCollected events during reverse rebalance: ${feesCollectedEvents.length}`);
      const feeEvent = feesCollectedEvents[0];

      // Verify reinvestment ratio was respected (50%)
      const tolerance = 0.0001;
      const expectedReinvestmentRatio = 5000 / 100; // 50%
      expect(feeEvent.reinvestmentRatio).toBe(expectedReinvestmentRatio);

      // Verify fees were distributed correctly
      const token0Total = feeEvent.token0Collected;
      const token1Total = feeEvent.token1Collected;

      if (token0Total > 0) {
        const token0Expected = token0Total / 2;
        expect(Math.abs(feeEvent.token0ToOwner - token0Expected)).toBeLessThan(tolerance);
        expect(Math.abs(feeEvent.token0Reinvested - token0Expected)).toBeLessThan(tolerance);
        console.log(`    Token0 fees distributed correctly: ${feeEvent.token0ToOwner.toFixed(6)} to owner, ${feeEvent.token0Reinvested.toFixed(6)} reinvested`);
      }

      if (token1Total > 0) {
        const token1Expected = token1Total / 2;
        expect(Math.abs(feeEvent.token1ToOwner - token1Expected)).toBeLessThan(tolerance);
        expect(Math.abs(feeEvent.token1Reinvested - token1Expected)).toBeLessThan(tolerance);
        console.log(`    Token1 fees distributed correctly: ${feeEvent.token1ToOwner.toFixed(6)} to owner, ${feeEvent.token1Reinvested.toFixed(6)} reinvested`);
      }
    } else {
      console.log(`  ℹ️ No fees collected during reverse rebalance (position may have had minimal fees)`);
    }

    console.log('\n✅ Bi-directional rebalancing confirmed!');
    console.log(`  ✓ Test completed in ${swapCount} swaps`);
  }, 120000); // 2 minute timeout

  it('should trigger emergency exit when price moves beyond threshold', async () => {
    console.log('\n🚨 Starting emergency exit test...');

    // Wait for service to be ready and position to be created
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Get initial vault state
    const vaultData = await service.vaultDataService.getVault(testVault.vaultAddress);
    const positions = Object.values(vaultData.positions).filter(p => p.liquidity !== '0');

    if (positions.length === 0) {
      console.log('⚠️ No active positions found, skipping emergency exit test');
      throw new Error('No active positions found, skipping emergency exit test');
    }

    const activePosition = positions[0];
    console.log(`\n📊 Active position before emergency exit:`);
    console.log(`  Position ID: ${activePosition.id}`);
    console.log(`  Range: ${activePosition.tickLower} to ${activePosition.tickUpper}`);

    // Use signer[1] as swap wallet
    const swapWallet = testEnv.ganacheServer.signers[1];

    // Get token data
    const wethData = service.tokens['WETH'];
    const usdcData = service.tokens['USDC'];
    const adapter = service.adapters.get('uniswapV3');

    // Check WETH balance
    const wethContract = new ethers.Contract(wethData.address, ERC20_ABI, swapWallet);
    const wethBalance = await wethContract.balanceOf(swapWallet.address);
    console.log(`\n💰 Swap wallet WETH balance: ${ethers.utils.formatUnits(wethBalance, wethData.decimals)} WETH`);

    // Calculate swap size - 500 ETH to trigger emergency exit
    const swapSize = ethers.utils.parseUnits('550', wethData.decimals);

    if (wethBalance < swapSize) {
      console.log(`⚠️ Insufficient WETH balance for emergency exit test (need 550, have ${ethers.utils.formatUnits(wethBalance, wethData.decimals)})`);
      console.log('   Adjusting swap size to available balance...');
    }

    const actualSwapSize = wethBalance < swapSize ? wethBalance : swapSize;
    console.log(`  Swap size: ${ethers.utils.formatUnits(actualSwapSize, wethData.decimals)} WETH`);

    // Set up event listeners
    const positionCloseEvents = [];
    const vaultLockEvents = [];
    const vaultUnlockEvents = [];
    const vaultUnrecoverableEvents = [];

    service.eventManager.subscribe('PositionsClosed', (data) => {
      console.log(`📦 Positions closed: ${data.positionCount} positions`);
      positionCloseEvents.push(data);
    });

    // Listen for the VaultUnrecoverable event that indicates emergency exit
    service.eventManager.subscribe('VaultUnrecoverable', (data) => {
      console.log(`🚨🚨🚨 EMERGENCY EXIT TRIGGERED: ${data.reason}`);
      if (data.details) {
        console.log(`  Details: ${JSON.stringify(data.details, null, 2)}`);
      }
      vaultUnrecoverableEvents.push(data);
    });

    service.eventManager.subscribe('VaultLocked', (data) => {
      vaultLockEvents.push(data);
    });

    service.eventManager.subscribe('VaultUnlocked', (data) => {
      vaultUnlockEvents.push(data);
    });

    // Get current pool state before swap
    const poolDataBefore = await adapter.fetchPoolData(
      usdcData.address,
      wethData.address,
      500,
      testEnv.ganacheServer.provider
    );
    console.log(`\n📊 Pool state before emergency exit swap:`);
    console.log(`  Current tick: ${poolDataBefore.tick}`);

    // Approve and execute large swap
    const routerAddress = adapter.addresses.routerAddress;
    const approveTx = await wethContract.approve(routerAddress, actualSwapSize);
    await approveTx.wait();
    console.log('  WETH approved for router');

    // Prepare swap parameters
    const swapParams = {
      tokenIn: wethData.address,
      tokenOut: usdcData.address,
      fee: 500,
      recipient: swapWallet.address,
      amountIn: actualSwapSize.toString(),
      slippageTolerance: 100, // Accept any price for emergency exit test
      sqrtPriceLimitX96: "0",
      provider: testEnv.ganacheServer.provider,
      deadlineMinutes: 2
    };

    console.log('\n🔄 Executing large swap to trigger emergency exit...');
    const swapData = await adapter.generateSwapData(swapParams);

    if (!swapData || !swapData.data) {
      throw new Error('Failed to generate swap data for emergency exit test');
    }

    // Execute the swap
    const swapTx = await swapWallet.sendTransaction({
      to: swapData.to,
      data: swapData.data,
      value: swapData.value || 0,
      gasLimit: 1000000
    });

    const receipt = await swapTx.wait();
    console.log(`  ✅ Swap executed: ${receipt.transactionHash}`);

    // Get pool state after swap
    const poolDataAfter = await adapter.fetchPoolData(
      usdcData.address,
      wethData.address,
      500,
      testEnv.ganacheServer.provider
    );

    const tickMovement = Math.abs(poolDataAfter.tick - poolDataBefore.tick);
    console.log(`\n📊 Pool state after swap:`);
    console.log(`  New tick: ${poolDataAfter.tick}`);
    console.log(`  Tick movement: ${tickMovement} ticks`);
    console.log(`  Price movement: ~${(tickMovement / 100).toFixed(2)}%`);

    // Wait for emergency exit to process
    console.log('\n⏳ Waiting for emergency exit to process...');
    const timeout = 30000; // 30 seconds
    const startTime = Date.now();

    while (vaultUnrecoverableEvents.length === 0 && (Date.now() - startTime) < timeout) {
      await new Promise(resolve => setTimeout(resolve, 1000));

      if ((Date.now() - startTime) % 5000 === 0) {
        console.log(`  ⏳ Still waiting... (${Math.floor((Date.now() - startTime) / 1000)}s)`);
      }
    }

    // Additional wait for any async operations to complete
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Verify emergency exit occurred
    console.log('\n📋 Emergency Exit Verification:');

    // Check if VaultUnrecoverable event was received
    expect(vaultUnrecoverableEvents.length).toBeGreaterThan(0);
    console.log(`  ✅ VaultUnrecoverable events: ${vaultUnrecoverableEvents.length}`);

    // Verify the reason contains emergency exit
    const emergencyExitEvent = vaultUnrecoverableEvents.find(e =>
      e.reason.includes('Emergency exit triggered') ||
      e.reason.includes('price movement exceeded')
    );
    expect(emergencyExitEvent).toBeDefined();
    console.log(`  ✅ Emergency exit reason: "${emergencyExitEvent?.reason}"`);

    // Verify positions were closed
    expect(positionCloseEvents.length).toBeGreaterThan(0);
    console.log(`  ✅ Position close events: ${positionCloseEvents.length}`);

    // Get final vault state
    const finalVaultData = await service.vaultDataService.getVault(testVault.vaultAddress);
    const finalPositions = Object.values(finalVaultData.positions).filter(p => p.liquidity !== '0');

    // All positions should be closed
    expect(finalPositions.length).toBe(0);
    console.log(`  ✅ All positions closed (${finalPositions.length} active positions remaining)`);

    // Check that the original position was closed
    const originalPosition = finalVaultData.positions[activePosition.id];
    if (originalPosition) {
      expect(originalPosition.liquidity).toBe('0');
      console.log(`  ✅ Original position ${activePosition.id} closed`);
    }

    // Verify price movement was sufficient
    const priceMovementPercent = tickMovement / 100;
    expect(priceMovementPercent).toBeGreaterThan(0.5);
    console.log(`  ✅ Price movement (${priceMovementPercent.toFixed(2)}%) exceeded emergency exit threshold (0.5%)`);

    // Verify vault is now blacklisted
    const blacklisted = service.isBlacklisted(testVault.vaultAddress);
    expect(blacklisted).toBe(true);
    console.log(`  ✅ Vault ${testVault.vaultAddress} is now blacklisted`);

    console.log('\n🚨 Emergency exit test completed successfully!');
  }, 120000); // 2 minute timeout
});
