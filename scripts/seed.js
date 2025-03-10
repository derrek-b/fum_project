// seed.js - Script to create a test Uniswap V3 liquidity position

// Import required libraries
const { ethers } = require('ethers');
const { Token, CurrencyAmount } = require('@uniswap/sdk-core');
const { Pool, Position, NonfungiblePositionManager, TickMath } = require('@uniswap/v3-sdk');
const JSBI = require('jsbi');
const IUniswapV3PoolABI = require('@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Pool.sol/IUniswapV3Pool.json').abi;
const NonfungiblePositionManagerABI = require('@uniswap/v3-periphery/artifacts/contracts/NonfungiblePositionManager.sol/NonfungiblePositionManager.json').abi;
const ERC20ABI = require('@openzeppelin/contracts/build/contracts/ERC20.json').abi;

// Define config directly for local fork of Arbitrum
const config = {
  chains: {
    arbitrum: {
      chainId: 1337, // Local chainId for test environment
      rpcUrl: "http://localhost:8545", // Using local fork of Arbitrum
      name: "Local Arbitrum Fork",
      platforms: {
        uniswapV3: {
          name: "Uniswap V3",
          factoryAddress: "0x1F98431c8aD98523631AE4a59f267346ea31F984", // Arbitrum Uniswap V3 factory
          positionManagerAddress: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88", // Arbitrum Uniswap V3 NonfungiblePositionManager
        },
      },
    },
  },
};

// Main function
async function main() {
  console.log('Starting seed script to create Uniswap V3 test position...');

  // Setup provider and signer
  const provider = new ethers.JsonRpcProvider(config.chains.arbitrum.rpcUrl);

  // WARNING: Never hardcode private keys in production code!
  // This is just for development/testing purposes using a Hardhat generated test private key
  const PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

  console.log(`Using wallet address: ${wallet.address}`);

  // Check ETH balance
  const ethBalance = await provider.getBalance(wallet.address);
  console.log(`ETH balance: ${ethers.formatEther(ethBalance)} ETH`);

  // Define token addresses for Arbitrum
  const WETH_ADDRESS = '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1'; // WETH on Arbitrum
  const USDC_ADDRESS = '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8'; // USDC on Arbitrum

  // Create token instances
  const WETH = new Token(
    config.chains.arbitrum.chainId,
    WETH_ADDRESS,
    18,
    'WETH',
    'Wrapped Ether'
  );

  const USDC = new Token(
    config.chains.arbitrum.chainId,
    USDC_ADDRESS,
    6,
    'USDC',
    'USD Coin'
  );

  // Create contract instances
  const wethContract = new ethers.Contract(WETH_ADDRESS, ERC20ABI, wallet);
  const usdcContract = new ethers.Contract(USDC_ADDRESS, ERC20ABI, wallet);

  // Get token balances before swap
  const initialWethBalance = await wethContract.balanceOf(wallet.address);
  const initialUsdcBalance = await usdcContract.balanceOf(wallet.address);

  console.log(`Initial WETH balance: ${ethers.formatUnits(initialWethBalance, 18)} WETH`);
  console.log(`Initial USDC balance: ${ethers.formatUnits(initialUsdcBalance, 6)} USDC`);

  // To swap ETH for USDC on Uniswap, we'll need to:
  // 1. Wrap some ETH to WETH
  // 2. Approve the Uniswap router to spend our WETH
  // 3. Execute the swap through the Uniswap router

  // Step 1: Wrap ETH to WETH using the WETH contract
  console.log(`Wrapping 5 ETH to WETH...`);

  // WETH contract address is the same as the token address
  const wethContractWithABI = new ethers.Contract(
    WETH_ADDRESS,
    [
      // Minimal ABI for deposit function
      'function deposit() external payable',
      'function balanceOf(address) external view returns (uint)'
    ],
    wallet
  );

  // Deposit 5 ETH to get WETH
  const wrapTx = await wethContractWithABI.deposit({
    value: ethers.parseEther('5')
  });

  console.log(`Wrap transaction sent: ${wrapTx.hash}`);
  await wrapTx.wait();
  console.log(`Wrap transaction confirmed`);

  // Step 2: Approve Uniswap router to spend our WETH
  const UNISWAP_ROUTER_ADDRESS = '0xE592427A0AEce92De3Edee1F18E0157C05861564'; // Uniswap V3 Router on Arbitrum

  console.log(`Approving Uniswap Router to spend WETH...`);
  const approveTx = await wethContract.approve(
    UNISWAP_ROUTER_ADDRESS,
    ethers.parseEther('2.5')
  );

  console.log(`Approve transaction sent: ${approveTx.hash}`);
  await approveTx.wait();
  console.log(`Approve transaction confirmed`);

  // Step 3: Execute the swap using the Uniswap Router
  const UNISWAP_ROUTER_ABI = [
    'function exactInputSingle(tuple(address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external returns (uint256)'
  ];

  const uniswapRouter = new ethers.Contract(
    UNISWAP_ROUTER_ADDRESS,
    UNISWAP_ROUTER_ABI,
    wallet
  );

  console.log(`Swapping 2.5 WETH for USDC...`);

  // Current timestamp plus 20 minutes (in seconds)
  const deadline = Math.floor(Date.now() / 1000) + 20 * 60;

  const swapTx = await uniswapRouter.exactInputSingle({
    tokenIn: WETH_ADDRESS,
    tokenOut: USDC_ADDRESS,
    fee: 3000, // 0.3% fee tier
    recipient: wallet.address,
    deadline: deadline,
    amountIn: ethers.parseEther('2.5'),
    amountOutMinimum: 0, // For testing, we accept any amount out (in production, set a min)
    sqrtPriceLimitX96: 0 // No price limit
  });

  console.log(`Swap transaction sent: ${swapTx.hash}`);
  await swapTx.wait();
  console.log(`Swap transaction confirmed`);

  // Get token balances after swap
  const finalWethBalance = await wethContract.balanceOf(wallet.address);
  const finalUsdcBalance = await usdcContract.balanceOf(wallet.address);

  console.log(`Final WETH balance: ${ethers.formatUnits(finalWethBalance, 18)} WETH`);
  console.log(`Final USDC balance: ${ethers.formatUnits(finalUsdcBalance, 6)} USDC`);
  console.log(`Acquired ${ethers.formatUnits(finalUsdcBalance - initialUsdcBalance, 6)} USDC`);

  console.log('ETH to USDC swap completed successfully.');

  // Step 4: Gather Pool Information (AFTER the swap to get updated pool state)
  console.log('\n--- Creating Pool Instance and Gathering Information ---');

  // Define fee tier - using 0.3% (3000) for WETH/USDC which is common
  const FEE_TIER = 3000;

  // Get the pool address
  const poolAddress = Pool.getAddress(WETH, USDC, FEE_TIER);
  console.log(`WETH/USDC Pool Address: ${poolAddress}`);

  // Create a contract instance for the pool
  const poolContract = new ethers.Contract(
    poolAddress,
    IUniswapV3PoolABI,
    wallet
  );

  // Fetch pool data
  console.log('Fetching pool state data...');

  // Get slot0 data (contains the most recent price and tick)
  const slot0Data = await poolContract.slot0();
  console.log('\nSlot0 Data:');
  console.log(`- sqrtPriceX96: ${slot0Data[0]}`);
  console.log(`- Current Tick: ${slot0Data[1]}`);
  console.log(`- Observation Index: ${slot0Data[2]}`);
  console.log(`- Observation Cardinality: ${slot0Data[3]}`);
  console.log(`- Observation Cardinality Next: ${slot0Data[4]}`);
  console.log(`- Fee Protocol: ${slot0Data[5]}`);
  console.log(`- Unlocked: ${slot0Data[6]}`);

  // Get current liquidity
  const liquidity = await poolContract.liquidity();
  console.log(`\nCurrent Pool Liquidity: ${liquidity}`);

  // Get fee growth data
  const feeGrowthGlobal0X128 = await poolContract.feeGrowthGlobal0X128();
  const feeGrowthGlobal1X128 = await poolContract.feeGrowthGlobal1X128();
  console.log(`\nFee Growth Data:`);
  console.log(`- Token0 (WETH): ${feeGrowthGlobal0X128}`);
  console.log(`- Token1 (USDC): ${feeGrowthGlobal1X128}`);

  // Get tick spacing for this pool
  const tickSpacing = await poolContract.tickSpacing();
  console.log(`\nTick Spacing: ${Number(tickSpacing)}`);

  // Get fee amount
  const fee = await poolContract.fee();
  console.log(`Fee: ${fee} (${Number(fee) / 10000}%)`);

  // Calculate the current price from sqrtPriceX96
  const sqrtPriceX96 = slot0Data[0];
  const sqrtPriceX96AsNumber = Number(sqrtPriceX96) / (2 ** 96);
  const priceInt = sqrtPriceX96AsNumber * sqrtPriceX96AsNumber;

  const decimalsDiff = USDC.decimals - WETH.decimals; // USDC (6) - WETH (18) = -12
  const price = priceInt * Math.pow(10, decimalsDiff < 0 ? -decimalsDiff : 0);

  console.log(`\nCurrent Price: ${price.toFixed(2)} USDC per WETH`);
  console.log(`Current Inverse Price: ${(1 / price).toFixed(8)} WETH per USDC`);

  // Calculate nearby tick values for reference
  const currentTick = Number(slot0Data[1]);
  console.log(`\nUseful Tick Values:`);
  console.log(`- Current Tick: ${currentTick}`);

  // Calculate a tick range centered around the current price (±5%)
  // This ensures our range includes the current price
  const tickLower5Percent = Math.floor(currentTick - Math.log(1.05) / Math.log(1.0001));
  const tickUpper5Percent = Math.ceil(currentTick + Math.log(1.05) / Math.log(1.0001));

  // Round to nearest tick spacing
  const nearestLowerTick = Math.ceil(tickLower5Percent / Number(tickSpacing)) * Number(tickSpacing);
  const nearestUpperTick = Math.floor(tickUpper5Percent / Number(tickSpacing)) * Number(tickSpacing);

  console.log(`- 5% Lower Tick (Rounded to Spacing): ${nearestLowerTick}`);
  console.log(`- 5% Upper Tick (Rounded to Spacing): ${nearestUpperTick}`);

  // Double-check if range includes current tick
  const isCurrentTickInRange = currentTick >= nearestLowerTick && currentTick <= nearestUpperTick;
  console.log(`- Is current tick in range? ${isCurrentTickInRange ? 'Yes' : 'No'}`);

  // If current tick is not in range, adjust the range
  let finalLowerTick = nearestLowerTick;
  let finalUpperTick = nearestUpperTick;

  if (!isCurrentTickInRange) {
    console.log('Current tick not in range, adjusting...');
    finalLowerTick = Math.floor(currentTick / Number(tickSpacing)) * Number(tickSpacing) - Number(tickSpacing);
    finalUpperTick = Math.ceil(currentTick / Number(tickSpacing)) * Number(tickSpacing) + Number(tickSpacing);
    console.log(`- Adjusted tick range: ${finalLowerTick} to ${finalUpperTick}`);
  }

  // Create a Pool instance using the SDK
  console.log('\nCreating Pool instance from SDK...');
  const poolInstance = new Pool(
    WETH,                   // token0
    USDC,                   // token1
    Number(fee),            // fee tier
    sqrtPriceX96.toString(),// sqrtRatioX96
    liquidity.toString(),   // liquidity
    Number(slot0Data[1])    // tickCurrent
  );

  console.log('Pool instance created successfully');
  console.log(`Token0: ${poolInstance.token0.symbol}`);
  console.log(`Token1: ${poolInstance.token1.symbol}`);
  console.log(`Current Tick from Pool Instance: ${poolInstance.tickCurrent}`);

  console.log('\nPool information gathering completed.');

  // Step 5: Prepare for position creation
  console.log('\n--- Preparing Position Creation ---');

  // Create Position instance to calculate liquidity
  console.log('Creating Position instance with centered price range...');

  // Amounts we want to use for the position
  const wethAmount = ethers.parseEther('0.1');
  console.log(`WETH amount for position: ${ethers.formatEther(wethAmount)} WETH`);

  // Convert WETH to CurrencyAmount
  const tokenAmount0 = CurrencyAmount.fromRawAmount(
    WETH,
    wethAmount.toString()
  );

  // Also create a USDC amount (approx. WETH value worth of USDC)
  // Price is in USDC per WETH, so wethAmount * price gives us the USDC value
  const usdcValue = Math.floor(Number(ethers.formatEther(wethAmount)) * price * 10**6);
  const usdcAmount = ethers.parseUnits(usdcValue.toString(), 6);
  console.log(`USDC amount for position: ${ethers.formatUnits(usdcValue, 6)} USDC`);

  const tokenAmount1 = CurrencyAmount.fromRawAmount(
    USDC,
    usdcAmount.toString()
  );

  // Create a position with our price range
  try {
    // First, create a position using createPool which gives more control
    const positionInfo = {
      pool: poolInstance,
      tickLower: finalLowerTick,
      tickUpper: finalUpperTick
    };

    // Calculate optimal liquidity based on desired token amounts
    // There are different methods:
    // 1. fromAmount0() - uses only token0 (WETH) amount
    // 2. fromAmount1() - uses only token1 (USDC) amount
    // 3. fromAmounts() - uses both token amounts but considers them maximums

    // We'll use fromAmounts() to provide both tokens in a balanced way
    const position = Position.fromAmounts({
      ...positionInfo,
      amount0: tokenAmount0.quotient.toString(),
      amount1: tokenAmount1.quotient.toString(),
      useFullPrecision: true
    });

    console.log('\nPosition Parameters:');
    console.log(`- Tick Lower: ${position.tickLower}`);
    console.log(`- Tick Upper: ${position.tickUpper}`);
    console.log(`- Liquidity: ${position.liquidity.toString()}`);
    console.log(`- WETH Amount: ${ethers.formatEther(position.amount0.quotient.toString())} WETH`);
    console.log(`- USDC Amount: ${ethers.formatUnits(position.amount1.quotient.toString(), 6)} USDC`);

    // Check if amounts are zero and warn
    if (position.amount0.quotient.toString() === '0' || position.amount1.quotient.toString() === '0') {
      console.log('\nWARNING: One of the position amounts is zero. This may indicate an issue with the position calculation.');

      // Try a different approach if needed - just for testing
      console.log('\nAttempting alternative position calculation for debugging:');

      // Calculate the liquidity directly from the desired amounts
      const sqrtRatioCurrentX96 = JSBI.BigInt(sqrtPriceX96.toString());
      const sqrtRatioLowerX96 = TickMath.getSqrtRatioAtTick(finalLowerTick);
      const sqrtRatioUpperX96 = TickMath.getSqrtRatioAtTick(finalUpperTick);

      console.log(`- Current sqrt price: ${sqrtRatioCurrentX96.toString()}`);
      console.log(`- Lower sqrt price: ${sqrtRatioLowerX96.toString()}`);
      console.log(`- Upper sqrt price: ${sqrtRatioUpperX96.toString()}`);
    }

    // Calculate price range in human-readable format
    // Fixed price calculation
    const lowerPrice = tickToPrice(WETH, USDC, position.tickLower).toFixed(2);
    const upperPrice = tickToPrice(WETH, USDC, position.tickUpper).toFixed(2);
    console.log(`- Price Range: ${lowerPrice} - ${upperPrice} USDC per WETH`);
    console.log(`- Current Price: ${price.toFixed(2)} USDC per WETH`);

    // Prepare approval for the NonfungiblePositionManager
    console.log('\nPreparing token approvals for position creation...');

    const positionManagerAddress = config.chains.arbitrum.platforms.uniswapV3.positionManagerAddress;

    // Log approval details
    console.log('\nApproval Details:');
    console.log(`- WETH Approval Required: ${ethers.formatEther(position.amount0.quotient.toString())} WETH`);
    console.log(`- USDC Approval Required: ${ethers.formatUnits(position.amount1.quotient.toString(), 6)} USDC`);
    console.log(`- Position Manager Address: ${positionManagerAddress}`);

    // Prepare mint parameters
    const mintParams = {
      token0: WETH.address,
      token1: USDC.address,
      fee: FEE_TIER,
      tickLower: position.tickLower,
      tickUpper: position.tickUpper,
      amount0Desired: position.amount0.quotient.toString(),
      amount1Desired: position.amount1.quotient.toString(),
      amount0Min: 0, // In production, apply slippage tolerance
      amount1Min: 0, // In production, apply slippage tolerance
      recipient: wallet.address,
      deadline: Math.floor(Date.now() / 1000) + 20 * 60 // 20 minutes from now
    };

    console.log('\nMint Transaction Parameters:');
    console.log(JSON.stringify(mintParams, null, 2));

    // Create a Position Manager contract instance
    const positionManager = new ethers.Contract(
      positionManagerAddress,
      NonfungiblePositionManagerABI,
      wallet
    );

    // Execute the actual minting process
    console.log('\n--- Executing Position Creation ---');

    // STEP 1: Approve the position manager to spend our WETH
    console.log(`Approving position manager to spend WETH...`);
    const approveWethTx = await wethContract.approve(
      positionManagerAddress,
      position.amount0.quotient.toString()
    );
    console.log(`WETH approval transaction sent: ${approveWethTx.hash}`);
    await approveWethTx.wait();
    console.log(`WETH approval confirmed`);

    // STEP 2: Approve the position manager to spend our USDC
    console.log(`Approving position manager to spend USDC...`);
    const approveUsdcTx = await usdcContract.approve(
      positionManagerAddress,
      position.amount1.quotient.toString()
    );
    console.log(`USDC approval transaction sent: ${approveUsdcTx.hash}`);
    await approveUsdcTx.wait();
    console.log(`USDC approval confirmed`);

    // STEP 3: Execute the mint transaction
    console.log(`Minting new liquidity position...`);
    const mintTx = await positionManager.mint(
      mintParams,
      { gasLimit: 5000000 } // Adding gas limit for safety
    );
    console.log(`Mint transaction sent: ${mintTx.hash}`);

    // STEP 4: Wait for the transaction to be mined and get the receipt
    const receipt = await mintTx.wait();
    console.log(`Mint transaction confirmed!`);

    // STEP 5: Process the receipt to extract the tokenId of the minted position
    // Find the Transfer event (NFT minted)
    const transferEvent = receipt.logs.find(log => {
      try {
        // A Transfer event has 3 topics: event signature + from + to
        return log.topics.length === 4 &&
               log.topics[0] === ethers.id("Transfer(address,address,uint256)") &&
               log.topics[1] === ethers.zeroPadValue("0x0000000000000000000000000000000000000000", 32) &&
               log.topics[2] === ethers.zeroPadValue(wallet.address.toLowerCase(), 32);
      } catch (e) {
        return false;
      }
    });

    if (!transferEvent) {
      throw new Error("Transfer event not found in transaction receipt");
    }

    // Extract tokenId from the event
    const tokenId = ethers.toBigInt(transferEvent.topics[3]);
    console.log(`\n🎉 Successfully minted position with ID: ${tokenId}`);

    // STEP 6: Get the position details to confirm
    const positionData = await positionManager.positions(tokenId);
    console.log('\nMinted Position Details:');
    console.log(`- Token0: ${positionData.token0}`);
    console.log(`- Token1: ${positionData.token1}`);
    console.log(`- Fee: ${positionData.fee}`);
    console.log(`- Tick Lower: ${positionData.tickLower}`);
    console.log(`- Tick Upper: ${positionData.tickUpper}`);
    console.log(`- Liquidity: ${positionData.liquidity}`);

    // Calculate and display price values again
    console.log('\nPosition Price Range:');
    console.log(`- Min Price: ${lowerPrice} USDC per WETH`);
    console.log(`- Max Price: ${upperPrice} USDC per WETH`);
    console.log(`- Current Price: ${price.toFixed(2)} USDC per WETH`);
    console.log(`- Status: ${currentTick >= position.tickLower && currentTick <= position.tickUpper ? 'In Range (Active)' : 'Out of Range (Inactive)'}`);

    // Get the balance of positions
    const positionBalance = await positionManager.balanceOf(wallet.address);
    console.log(`\nTotal positions owned: ${positionBalance}`);

  } catch (err) {
    console.error('Error creating position:', err);
  }

  console.log('\nSeed script completed.');

  // Helper function to convert tick to price - FIXED VERSION
  function tickToPrice(baseToken, quoteToken, tick) {
    // Calculate price from tick using the formula: 1.0001^tick
    const price = Math.pow(1.0001, tick);

    // Apply decimal adjustment based on token decimals
    // For WETH (18 decimals) to USDC (6 decimals), we need to multiply by 10^(6-18) = 10^-12
    const decimalAdjustment = Math.pow(10, quoteToken.decimals - baseToken.decimals);

    // For numbers that might be very small due to decimal adjustments,
    // ensure we're handling the math properly
    return price * decimalAdjustment;
  }
}

// Execute the script
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error in seed script:', error);
    process.exit(1);
  });
