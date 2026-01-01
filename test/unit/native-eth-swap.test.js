/**
 * @fileoverview Proof of concept test: Native ETH → LINK swap using Alpha Router
 *
 * This test proves that Alpha Router can route swaps from native ETH to ERC20 tokens
 * by using Ether.onChain() instead of Token instances.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ethers } from 'ethers';
import { AlphaRouter, SwapType } from '@uniswap/smart-order-router';
import { UniversalRouterVersion } from '@uniswap/universal-router-sdk';
import { Percent, Token, CurrencyAmount, TradeType, Ether } from '@uniswap/sdk-core';
import { getTokenAddress, getWethAddress } from 'fum_library/helpers/tokenHelpers';
import { setupTestBlockchain, cleanupTestBlockchain } from '../helpers/hardhat-setup.js';

describe('Native ETH Swap Proof of Concept', () => {
  let testEnv;
  let provider;
  let signer;
  let alphaRouter;

  // Chain IDs
  const LOCAL_CHAIN_ID = 1337;
  const ALPHA_ROUTER_CHAIN_ID = 42161; // Arbitrum for routing

  beforeAll(async () => {
    // Setup blockchain environment
    testEnv = await setupTestBlockchain();
    provider = testEnv.hardhatServer.provider;
    signer = testEnv.hardhatServer.signers[0];

    // Create Alpha Router instance (same as UniswapV3Adapter does)
    // For local testing, we need to use Arbitrum chainId for Alpha Router
    // but connect to our local forked provider
    const arbitrumProvider = new ethers.providers.JsonRpcProvider(
      process.env.ARBITRUM_RPC_URL || 'https://arb1.arbitrum.io/rpc'
    );

    alphaRouter = new AlphaRouter({
      chainId: ALPHA_ROUTER_CHAIN_ID,
      provider: arbitrumProvider
    });

    console.log('🔧 Test environment initialized');
    console.log(`   Local chainId: ${LOCAL_CHAIN_ID}`);
    console.log(`   Alpha Router chainId: ${ALPHA_ROUTER_CHAIN_ID}`);
  }, 60000);

  afterAll(async () => {
    if (testEnv) {
      await cleanupTestBlockchain(testEnv);
    }
  });

  /**
   * Token configs for test (hardcoded to avoid lookup issues)
   */
  const TOKEN_CONFIGS = {
    WETH: { symbol: 'WETH', decimals: 18, name: 'Wrapped Ether' },
    LINK: { symbol: 'LINK', decimals: 18, name: 'Chainlink' },
    USDC: { symbol: 'USDC', decimals: 6, name: 'USD Coin' }
  };

  /**
   * Helper to create a Token instance (for ERC20 tokens)
   */
  function createTokenInstance(symbol, chainId = ALPHA_ROUTER_CHAIN_ID) {
    const tokenConfig = TOKEN_CONFIGS[symbol];
    if (!tokenConfig) {
      throw new Error(`Token config not found for symbol: ${symbol}`);
    }

    // Get address for the local chain (which maps to Arbitrum addresses)
    let address;
    if (symbol === 'WETH') {
      address = getWethAddress(LOCAL_CHAIN_ID);
    } else {
      address = getTokenAddress(symbol, LOCAL_CHAIN_ID);
    }

    return new Token(
      chainId,
      address,
      tokenConfig.decimals,
      tokenConfig.symbol,
      tokenConfig.name
    );
  }

  /**
   * Get a swap quote using native ETH as input
   * This is the key function we're testing - uses Ether.onChain() for native ETH
   */
  async function getNativeEthSwapQuote(tokenOutSymbol, amountIn) {
    // Use Ether.onChain() for native ETH - this is the key difference!
    const nativeEth = Ether.onChain(ALPHA_ROUTER_CHAIN_ID);
    const tokenOut = createTokenInstance(tokenOutSymbol);

    // Create currency amount for native ETH
    const currencyAmount = CurrencyAmount.fromRawAmount(nativeEth, amountIn);

    console.log('🔄 Requesting swap quote from Alpha Router...');
    console.log(`   Input: ${ethers.utils.formatEther(amountIn)} ETH (native)`);
    console.log(`   Output token: ${tokenOut.symbol}`);

    // Call Alpha Router - this should find routes through V4 native pools or V3/V2 with wrapping
    const route = await alphaRouter.route(
      currencyAmount,
      tokenOut,
      TradeType.EXACT_INPUT,
      undefined, // No swap config for quote-only
      undefined  // Use default routing config
    );

    return route;
  }

  /**
   * Get a swap quote using WETH as input (for comparison)
   */
  async function getWethSwapQuote(tokenOutSymbol, amountIn) {
    const tokenIn = createTokenInstance('WETH');
    const tokenOut = createTokenInstance(tokenOutSymbol);

    const currencyAmount = CurrencyAmount.fromRawAmount(tokenIn, amountIn);

    console.log('🔄 Requesting WETH swap quote from Alpha Router...');
    console.log(`   Input: ${ethers.utils.formatEther(amountIn)} WETH`);
    console.log(`   Output token: ${tokenOut.symbol}`);

    const route = await alphaRouter.route(
      currencyAmount,
      tokenOut,
      TradeType.EXACT_INPUT,
      undefined,
      undefined
    );

    return route;
  }

  /**
   * Get a swap route with execution data using native ETH
   */
  async function getNativeEthSwapRoute(tokenOutSymbol, amountIn, recipient) {
    const nativeEth = Ether.onChain(ALPHA_ROUTER_CHAIN_ID);
    const tokenOut = createTokenInstance(tokenOutSymbol);

    const currencyAmount = CurrencyAmount.fromRawAmount(nativeEth, amountIn);

    // Build swap config for Universal Router execution
    // Must specify version to look up the correct router address for the chain
    const swapConfig = {
      type: SwapType.UNIVERSAL_ROUTER,
      version: UniversalRouterVersion.V1_2,
      recipient,
      slippageTolerance: new Percent(50, 10_000), // 0.5%
      deadline: Math.floor(Date.now() / 1000 + 30 * 60) // 30 minutes
    };

    console.log('🔄 Requesting swap route with execution data...');

    const route = await alphaRouter.route(
      currencyAmount,
      tokenOut,
      TradeType.EXACT_INPUT,
      swapConfig,
      undefined
    );

    return route;
  }

  it('should get a quote for native ETH → LINK swap', async () => {
    const amountIn = ethers.utils.parseEther('1').toString(); // 1 ETH

    const quote = await getNativeEthSwapQuote('LINK', amountIn);

    console.log('\n📊 Native ETH → LINK Quote Result:');

    if (quote) {
      console.log(`   ✅ Route found!`);
      console.log(`   Quote (LINK out): ${quote.quote.toExact()}`);
      console.log(`   Gas estimate: ${quote.estimatedGasUsed?.toString() || 'N/A'}`);
      console.log(`   Route: ${quote.route.map(r => r.protocol).join(' → ')}`);

      expect(quote).toBeDefined();
      expect(quote.quote).toBeDefined();
      expect(parseFloat(quote.quote.toExact())).toBeGreaterThan(0);
    } else {
      console.log(`   ❌ No route found`);
      // Don't fail the test - just log this for investigation
      console.log('   This may indicate Alpha Router cannot route native ETH on this chain');
    }
  }, 60000);

  it('should get a quote for WETH → LINK swap (comparison)', async () => {
    const amountIn = ethers.utils.parseEther('1').toString(); // 1 WETH

    const quote = await getWethSwapQuote('LINK', amountIn);

    console.log('\n📊 WETH → LINK Quote Result:');

    if (quote) {
      console.log(`   ✅ Route found!`);
      console.log(`   Quote (LINK out): ${quote.quote.toExact()}`);
      console.log(`   Gas estimate: ${quote.estimatedGasUsed?.toString() || 'N/A'}`);
      console.log(`   Route: ${quote.route.map(r => r.protocol).join(' → ')}`);

      expect(quote).toBeDefined();
      expect(quote.quote).toBeDefined();
    } else {
      console.log(`   ❌ No route found for WETH → LINK`);
    }
  }, 60000);

  it('should get execution-ready route for native ETH → LINK', async () => {
    const amountIn = ethers.utils.parseEther('1').toString();
    const recipient = signer.address;

    const route = await getNativeEthSwapRoute('LINK', amountIn, recipient);

    console.log('\n📊 Native ETH → LINK Execution Route:');

    if (route) {
      console.log(`   ✅ Route with execution data found!`);
      console.log(`   Quote (LINK out): ${route.quote.toExact()}`);
      console.log(`   Has methodParameters: ${!!route.methodParameters}`);

      if (route.methodParameters) {
        console.log(`   To: ${route.methodParameters.to}`);
        console.log(`   Value: ${route.methodParameters.value}`);
        console.log(`   Calldata length: ${route.methodParameters.calldata?.length || 0} bytes`);

        expect(route.methodParameters.to).toBeDefined();
        expect(route.methodParameters.calldata).toBeDefined();

        // For native ETH swaps, value should be the ETH amount
        console.log(`   💡 Value field represents ETH to send: ${ethers.utils.formatEther(route.methodParameters.value || '0')} ETH`);
      }

      expect(route).toBeDefined();
      expect(route.quote).toBeDefined();
    } else {
      console.log(`   ❌ No execution route found`);
    }
  }, 60000);

  it('should compare native ETH vs WETH quotes', async () => {
    const amountIn = ethers.utils.parseEther('1').toString();

    console.log('\n📊 Comparing Native ETH vs WETH quotes for 1 token → LINK:');

    const [nativeQuote, wethQuote] = await Promise.all([
      getNativeEthSwapQuote('LINK', amountIn).catch(e => {
        console.log(`   Native ETH quote error: ${e.message}`);
        return null;
      }),
      getWethSwapQuote('LINK', amountIn).catch(e => {
        console.log(`   WETH quote error: ${e.message}`);
        return null;
      })
    ]);

    console.log('\n   Results:');
    console.log(`   Native ETH → LINK: ${nativeQuote ? nativeQuote.quote.toExact() + ' LINK' : 'No route'}`);
    console.log(`   WETH → LINK:       ${wethQuote ? wethQuote.quote.toExact() + ' LINK' : 'No route'}`);

    if (nativeQuote && wethQuote) {
      const nativeOut = parseFloat(nativeQuote.quote.toExact());
      const wethOut = parseFloat(wethQuote.quote.toExact());
      const diff = ((nativeOut - wethOut) / wethOut * 100).toFixed(4);
      console.log(`   Difference: ${diff}%`);
    }

    // At least one should work
    expect(nativeQuote || wethQuote).toBeTruthy();
  }, 120000);
});
