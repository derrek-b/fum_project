import React, { useState, useEffect, useMemo } from 'react';
import { Modal, Button, Form, Row, Col, Alert, Spinner, Badge, InputGroup } from 'react-bootstrap';
import { useSelector, useDispatch } from 'react-redux';
import { ethers } from 'ethers';
import { Pool } from '@uniswap/v3-sdk';
import { Token } from '@uniswap/sdk-core';

// FUM Library imports
import { AdapterFactory } from 'fum_library/adapters';
import { formatPrice } from 'fum_library/helpers/formatHelpers';
import { getTokensByChain, getTokenByAddress } from 'fum_library/helpers/tokenHelpers';
import { getPlatformTickSpacing } from 'fum_library/helpers/platformHelpers';
import { fetchTokenPrices, CACHE_DURATIONS } from 'fum_library/services/coingecko';

// Local project imports
import { useToast } from '../../context/ToastContext.js';
import { useProviders } from '../../hooks/useProviders';
import { triggerUpdate } from '../../redux/updateSlice.js';
import TransactionProgressModal from '../common/TransactionProgressModal';

// CSS to hide number input spinner arrows
const numberInputStyles = `
  /* Chrome, Safari, Edge, Opera */
  input.no-number-spinner::-webkit-outer-spin-button,
  input.no-number-spinner::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }

  /* Firefox */
  input.no-number-spinner[type=number] {
    -moz-appearance: textfield;
  }
`;

export default function AddLiquidityModal({
  show,
  onHide,
  position = null, // If provided, we're adding to an existing position
  poolData = null,
  token0Data = null,
  token1Data = null,
  tokenPrices = null,
  errorMessage = null,
  isProcessing = false
}) {
  const dispatch = useDispatch();
  const { showError, showSuccess } = useToast();

  // Get wallet and chain data from Redux
  const { address, chainId } = useSelector(state => state.wallet);
  const { readProvider, writeProvider, getSigner } = useProviders();

  // Get auto-refresh state to manage pausing during liquidity addition
  const { autoRefresh } = useSelector(state => state.updates);
  const { supportedPlatforms } = useSelector(state => state.platforms);
  const pools = useSelector(state => state.pools);

  // Keep track of the original auto-refresh setting to restore it on close
  const [originalAutoRefreshState, setOriginalAutoRefreshState] = useState(null);

  // Determine if we're adding to existing or creating new
  const isExistingPosition = !!position;

  // State for processing status
  const [isCreatingPosition, setIsCreatingPosition] = useState(false);
  const [isAddingLiquidity, setIsAddingLiquidity] = useState(false);
  // Combined processing state for UI
  const isProcessingOperation = isCreatingPosition || isAddingLiquidity || isProcessing;

  // Error message state
  const [operationError, setOperationError] = useState(null);

  // When the modal is shown, pause auto-refresh
  useEffect(() => {
    if (show) {

      // Store original state and pause auto-refresh if it's enabled if it's adding liquidity
      if (autoRefresh.enabled && isExistingPosition) {

        try {
          // Store the current state before we change it
          setOriginalAutoRefreshState(autoRefresh);

          // Directly dispatch to the Redux store to disable auto-refresh
          dispatch({
            type: 'updates/setAutoRefresh',
            payload: { ...autoRefresh, enabled: false }
          });
        } catch (error) {
          console.error("Error pausing auto-refresh:", error);
          showError("Failed to pause background updates. You may experience issues with your transaction.");
        }
      }
    }
  }, [show, autoRefresh, dispatch, originalAutoRefreshState, isExistingPosition, showError]);

  // State for price display direction - declare this early
  const [invertPriceDisplay, setInvertPriceDisplay] = useState(false);

  // State for common form fields
  const [token0Amount, setToken0Amount] = useState('');
  const [token1Amount, setToken1Amount] = useState('');
  const [slippageTolerance, setSlippageTolerance] = useState(0.5); // 0.5% default

  // State for new position form fields
  const [selectedPlatform, setSelectedPlatform] = useState('uniswapV3'); // Default
  const [selectedFeeTier, setSelectedFeeTier] = useState(3000); // 0.3% default
  const [token0Address, setToken0Address] = useState('');
  const [token1Address, setToken1Address] = useState('');
  const [priceRange, setPriceRange] = useState({
    min: null,
    max: null,
    current: null
  });
  const [rangeType, setRangeType] = useState('medium'); // 'custom', 'narrow', 'medium', 'wide'

  // Store raw user input for custom price inputs (not formatted)
  const [customMinInput, setCustomMinInput] = useState('');
  const [customMaxInput, setCustomMaxInput] = useState('');

  // Token selection state
  const [commonTokens, setCommonTokens] = useState([]);

  // Token balance state
  const [token0Balance, setToken0Balance] = useState(null);
  const [token1Balance, setToken1Balance] = useState(null);
  const [token0Error, setToken0Error] = useState(null);
  const [token1Error, setToken1Error] = useState(null);

  // Current pool price state
  const [currentPoolPrice, setCurrentPoolPrice] = useState(null);
  const [priceLoadError, setPriceLoadError] = useState(null);
  const [isLoadingPrice, setIsLoadingPrice] = useState(false);

  // Pool data state for new positions (stores sqrtPriceX96, liquidity, tick, fee)
  const [localPoolData, setLocalPoolData] = useState(null);
  // Sorted token data for new positions
  const [sortedToken0Data, setSortedToken0Data] = useState(null);
  const [sortedToken1Data, setSortedToken1Data] = useState(null);

  // Token ordering state
  const [tokensSwapped, setTokensSwapped] = useState(false);

  // Local token prices state (for new positions when tokenPrices prop is not provided)
  const [localTokenPrices, setLocalTokenPrices] = useState(null);

  // Transaction modal state
  const [showTransactionModal, setShowTransactionModal] = useState(false);
  const [currentTxStep, setCurrentTxStep] = useState(0);
  const [transactionSteps, setTransactionSteps] = useState([]);
  const [transactionError, setTransactionError] = useState('');
  const [transactionWarning, setTransactionWarning] = useState('');

  // Get adapter for the selected platform
  const adapter = useMemo(() => {
    if (!readProvider || !selectedPlatform || !chainId) return null;
    try {
      return AdapterFactory.getAdapter(selectedPlatform, chainId, readProvider);
    } catch (error) {
      console.error(`Failed to get adapter for platform ${selectedPlatform}:`, error);
      showError(`Failed to initialize ${selectedPlatform} adapter. Please try a different platform.`);
      return null;
    }
  }, [selectedPlatform, chainId, readProvider, showError]);

  // Calculate USD values if token prices are available
  // Use tokenPrices prop if provided, otherwise use localTokenPrices (fetched for new positions)
  const token0UsdValue = useMemo(() => {
    const price = tokenPrices?.token0 ?? localTokenPrices?.token0;
    if (!token0Amount || !price) return null;
    try {
      const numAmount = typeof token0Amount === 'string' ? parseFloat(token0Amount) : token0Amount;
      return numAmount * price;
    } catch (error) {
      console.error("Error calculating USD value:", error);
      return null;
    }
  }, [token0Amount, tokenPrices, localTokenPrices]);

  const token1UsdValue = useMemo(() => {
    const price = tokenPrices?.token1 ?? localTokenPrices?.token1;
    if (!token1Amount || !price) return null;
    try {
      const numAmount = typeof token1Amount === 'string' ? parseFloat(token1Amount) : token1Amount;
      return numAmount * price;
    } catch (error) {
      console.error("Error calculating USD value:", error);
      return null;
    }
  }, [token1Amount, tokenPrices, localTokenPrices]);

  // Calculate total USD value
  const totalUsdValue = useMemo(() => {
    if (token0UsdValue === null && token1UsdValue === null) {
      return null;
    }

    const value0 = token0UsdValue !== null ? token0UsdValue : 0;
    const value1 = token1UsdValue !== null ? token1UsdValue : 0;
    return value0 + value1;
  }, [token0UsdValue, token1UsdValue]);

  // Reset form when closing the modal
  const handleClose = () => {
    // Reset all state variables
    setToken0Amount('');
    setToken1Amount('');
    setSlippageTolerance(0.5);
    setSelectedPlatform('uniswapV3');
    setSelectedFeeTier(3000);
    setToken0Address('');
    setToken1Address('');
    setPriceRange({
      min: null,
      max: null,
      current: null
    });
    setRangeType('medium');
    setCustomMinInput('');
    setCustomMaxInput('');
    setToken0Balance(null);
    setToken1Balance(null);
    setToken0Error(null);
    setToken1Error(null);
    setCurrentPoolPrice(null);
    setPriceLoadError(null);
    setIsLoadingPrice(false);
    setTokensSwapped(false);
    setInvertPriceDisplay(false);
    setLocalTokenPrices(null);
    setLocalPoolData(null);
    setSortedToken0Data(null);
    setSortedToken1Data(null);

    // Reset operation states
    setOperationError(null);
    setIsCreatingPosition(false);
    setIsAddingLiquidity(false);

    // Restore auto-refresh to its original state if it was changed
    if (originalAutoRefreshState !== null) {
      try {
        dispatch({
          type: 'updates/setAutoRefresh',
          payload: originalAutoRefreshState
        });
        setOriginalAutoRefreshState(null);
      } catch (error) {
        console.error("Error restoring auto-refresh:", error);
        showError("Failed to restore background updates. You may need to manually restart auto-refresh.");
      }
    }

    // Call the onHide function from parent
    onHide();
  };

  // Load common tokens when the modal opens
  useEffect(() => {
    if (show && !isExistingPosition && chainId) {
      try {
        // Get all tokens available for the current chain from the library
        const chainTokens = getTokensByChain(chainId);

        // Format tokens to match the expected structure
        // For native tokens (ETH), address is null but we need wethAddress for V3
        const formattedTokens = chainTokens.map(token => ({
          symbol: token.symbol,
          name: token.name,
          decimals: token.decimals,
          isNative: token.isNative || false,
          address: token.addresses[chainId],  // null for ETH
          wethAddress: token.isNative ? token.wethAddresses?.[chainId] : null
        }));

        setCommonTokens(formattedTokens);
      } catch (error) {
        console.error("Error loading token list:", error);
        showError("Failed to load available tokens. Please try again later.");
      }
    }
  }, [show, isExistingPosition, chainId, showError]);

  // Initialize values for existing position
  useEffect(() => {
    if (isExistingPosition && position && poolData && token0Data && token1Data) {
      try {
        // Set price range from position
        setPriceRange({
          min: position.tickLower,
          max: position.tickUpper,
          current: poolData.tick
        });

        // Set fee tier from pool data
        if (position.pool && pools && pools[position.pool]) {
          setSelectedFeeTier(pools[position.pool].fee);
        }

        // Set platform
        setSelectedPlatform(position.platform);

        // Set token addresses
        if (token0Data.address) {
          setToken0Address(token0Data.address);
        }

        if (token1Data.address) {
          setToken1Address(token1Data.address);
        }

        // Get token balances - enrich token data with native token info from library
        if (token0Data.address && token1Data.address && readProvider && address && chainId) {
          // Look up tokens from library to get isNative and wethAddress properties
          // getTokenByAddress will match WETH addresses to the ETH token
          try {
            const token0FromLib = getTokenByAddress(token0Data.address, chainId);
            const token1FromLib = getTokenByAddress(token1Data.address, chainId);

            const enrichedToken0 = {
              ...token0Data,
              isNative: token0FromLib.isNative || false,
              wethAddress: token0FromLib.wethAddresses?.[chainId] || null
            };
            const enrichedToken1 = {
              ...token1Data,
              isNative: token1FromLib.isNative || false,
              wethAddress: token1FromLib.wethAddresses?.[chainId] || null
            };

            fetchTokenBalances(enrichedToken0, enrichedToken1);
          } catch (error) {
            console.error("Error enriching token data:", error);
            // Don't fetch balances if we can't identify the tokens properly
          }
        }

        // Calculate current price for existing position
        if (poolData.sqrtPriceX96 && adapter) {
          try {
            const baseToken = { address: token0Data.address, decimals: token0Data.decimals };
            const quoteToken = { address: token1Data.address, decimals: token1Data.decimals };
            const priceObj = adapter.calculatePriceFromSqrtPrice(
              poolData.sqrtPriceX96,
              baseToken,
              quoteToken
            );
            const calculatedPrice = parseFloat(priceObj.toSignificant(18));
            setCurrentPoolPrice(calculatedPrice);
            setIsLoadingPrice(false);
          } catch (error) {
            console.error("Error calculating price from sqrtPriceX96:", error);
            setCurrentPoolPrice(null);
            setPriceLoadError("Failed to calculate current price");
            setIsLoadingPrice(false);
            showError("Failed to calculate the current price. Some features may be limited.");
          }
        }
      } catch (error) {
        console.error("Error initializing position data:", error);
        showError("Error loading position data. Please try again later.");
      }
    }
  }, [show, isExistingPosition, position, poolData, token0Data, token1Data, address, readProvider, adapter, showError, chainId]);

  // Fetch token balances when token symbols change
  useEffect(() => {
    if (!isExistingPosition && token0Address && token1Address && readProvider && address) {
      // Get token info from commonTokens using symbol (token0Address/token1Address now store symbols)
      const token0Info = commonTokens.find(t => t.symbol === token0Address);
      const token1Info = commonTokens.find(t => t.symbol === token1Address);
      if (token0Info && token1Info) {
        fetchTokenBalances(token0Info, token1Info);
      }
    }
  }, [token0Address, token1Address, readProvider, address, isExistingPosition, commonTokens]);

  // Load pool price when both tokens and fee tier are selected
  useEffect(() => {
    // Only attempt to fetch pool price when we have all necessary data
    // This prevents errors when user is mid-selection
    // Also skip if we already have an error (prevents infinite loop)
    if (!isExistingPosition &&
        token0Address && token0Address !== "" &&
        token1Address && token1Address !== "" &&
        selectedFeeTier && readProvider && adapter &&
        !priceLoadError) {
      fetchPoolPrice();
    }
  }, [token0Address, token1Address, selectedFeeTier, readProvider, adapter, isExistingPosition, priceLoadError]);

  // Fetch token prices for new positions when tokens are selected
  useEffect(() => {
    const fetchPrices = async () => {
      if (isExistingPosition || !token0Address || !token1Address) {
        return;
      }

      // token0Address/token1Address now hold symbols directly
      const token0Symbol = token0Address;
      const token1Symbol = token1Address;

      try {
        const symbols = [token0Symbol, token1Symbol];
        const prices = await fetchTokenPrices(symbols, CACHE_DURATIONS['2-MINUTES']);

        if (prices) {
          setLocalTokenPrices({
            token0: prices[token0Symbol] || 0,
            token1: prices[token1Symbol] || 0
          });
        }
      } catch (error) {
        console.error("Error fetching token prices:", error);
        // Don't show error to user - USD values are optional
      }
    };

    fetchPrices();
  }, [token0Address, token1Address, commonTokens, isExistingPosition]);

  // Handle token0 amount change with token1 calculation
  const handleToken0AmountChange = (value) => {
    setToken0Amount(value);
    setToken0Error(null);
    setOperationError(null); // Clear operation error when typing

    if (!value || value === '0' || !currentPoolPrice) {
      return;
    }

    try {
      const amount0 = parseFloat(value);
      let price = parseFloat(currentPoolPrice);

      if (isNaN(amount0) || isNaN(price) || price === 0) {
        return;
      }

      // Apply necessary price adjustments
      if (invertPriceDisplay) {
        price = 1 / price;
      }

      // If tokens were swapped in sorting, we need to adjust the calculation
      const calculatedAmount1 = tokensSwapped
        ? amount0 / price
        : amount0 * price;

      // Use token1's decimals for proper precision
      // For existing positions, use token1Data; for new positions, look up from commonTokens
      const token1Decimals = isExistingPosition
        ? token1Data?.decimals
        : commonTokens.find(t => t.symbol === token1Address)?.decimals;
      setToken1Amount(calculatedAmount1.toFixed(token1Decimals));
    } catch (error) {
      console.error("Error calculating paired amount:", error);
      setToken1Error("Failed to calculate paired amount");
    }
  };

  // Handle token1 amount change with token0 calculation
  const handleToken1AmountChange = (value) => {
    setToken1Amount(value);
    setToken1Error(null);
    setOperationError(null); // Clear operation error when typing

    if (!value || value === '0' || !currentPoolPrice) {
      return;
    }

    try {
      const amount1 = parseFloat(value);
      let price = parseFloat(currentPoolPrice);

      if (isNaN(amount1) || isNaN(price) || price === 0) {
        return;
      }

      // Apply necessary price adjustments
      if (invertPriceDisplay) {
        price = 1 / price;
      }

      // If tokens were swapped in sorting, we need to adjust the calculation
      const calculatedAmount0 = tokensSwapped
        ? amount1 * price
        : amount1 / price;

      // Use token0's decimals for proper precision
      // For existing positions, use token0Data; for new positions, look up from commonTokens
      const token0Decimals = isExistingPosition
        ? token0Data?.decimals
        : commonTokens.find(t => t.symbol === token0Address)?.decimals;
      setToken0Amount(calculatedAmount0.toFixed(token0Decimals));
    } catch (error) {
      console.error("Error calculating paired amount:", error);
      setToken0Error("Failed to calculate paired amount");
    }
  };

  // Fetch token balances for user (handles native ETH + WETH combined balance)
  const fetchTokenBalances = async (token0Info, token1Info) => {
    if (!readProvider || !address) {
      console.error("Provider or address missing");
      return;
    }

    try {
      // Create minimal ERC20 ABI for balanceOf
      const erc20ABI = [
        'function balanceOf(address owner) view returns (uint256)',
        'function decimals() view returns (uint8)'
      ];

      // Helper to fetch balance for a single token
      const fetchBalance = async (tokenInfo) => {
        if (tokenInfo.isNative) {
          // For native tokens (ETH), fetch both native ETH and WETH balances
          const ethBalance = await readProvider.getBalance(address);

          // Fetch WETH balance
          const wethContract = new ethers.Contract(tokenInfo.wethAddress, erc20ABI, readProvider);
          const wethBalance = await wethContract.balanceOf(address);

          return {
            native: ethers.utils.formatEther(ethBalance),
            wrapped: ethers.utils.formatEther(wethBalance),
            total: ethers.utils.formatEther(ethBalance.add(wethBalance)),
            isNative: true
          };
        } else {
          // Standard ERC20 balance
          const contract = new ethers.Contract(tokenInfo.address, erc20ABI, readProvider);
          const balance = await contract.balanceOf(address);
          return {
            total: ethers.utils.formatUnits(balance, tokenInfo.decimals),
            isNative: false
          };
        }
      };

      const [balance0, balance1] = await Promise.all([
        fetchBalance(token0Info),
        fetchBalance(token1Info)
      ]);

      // Update state with balance objects
      setToken0Balance(balance0);
      setToken1Balance(balance1);
    } catch (error) {
      console.error("Error fetching token balances:", error);
      // Clear balances on error
      setToken0Balance(null);
      setToken1Balance(null);
      showError("Failed to fetch token balances. Please check your wallet connection.");
    }
  };

  // Fetch pool price for selected tokens and fee tier using the adapter
  const fetchPoolPrice = async () => {
    if (!token0Address || !token1Address || !selectedFeeTier || !readProvider || !adapter) {
      return;
    }

    // Can't create a pool with the same token
    if (token0Address === token1Address) {
      return;
    }

    setIsLoadingPrice(true);
    setPriceLoadError(null);

    try {
      // Get the current token data (use symbol since token0Address/token1Address hold symbols)
      const token0Info = commonTokens.find(t => t.symbol === token0Address);
      const token1Info = commonTokens.find(t => t.symbol === token1Address);

      if (!token0Info || !token1Info) {
        throw new Error("Token information not found");
      }

      // Helper to get the address to use for pool calculations (WETH for native tokens)
      const getPoolTokenAddress = (tokenInfo) => {
        if (tokenInfo.isNative) {
          return tokenInfo.wethAddress;  // Use WETH address for V3 pools
        }
        return tokenInfo.address;
      };

      // Create a helper function to get pool address with properly sorted tokens
      // This would be in the adapter in a production app
      const getPoolAddressWithSorting = async () => {
        try {
          // Use the Uniswap SDK to calculate pool address with properly sorted tokens
          // Get addresses for pool lookup (WETH for native tokens)
          const token0PoolAddress = getPoolTokenAddress(token0Info);
          const token1PoolAddress = getPoolTokenAddress(token1Info);

          // Sort tokens according to Uniswap V3 rules (lexicographically by address)
          let sortedToken0, sortedToken1;
          const shouldSwap = token0PoolAddress.toLowerCase() > token1PoolAddress.toLowerCase();

          if (shouldSwap) {
            sortedToken0 = token1Info;
            sortedToken1 = token0Info;
          } else {
            sortedToken0 = token0Info;
            sortedToken1 = token1Info;
          }

          // Get chainId from read provider
          const network = await readProvider.getNetwork();
          const chainId = Number(network.chainId);

          if (!chainId) {
            throw new Error("Could not determine chainId from provider");
          }

          // For SDK Token creation, use WETH address for native tokens
          const sdkToken0 = new Token(
            chainId,
            getPoolTokenAddress(sortedToken0),
            sortedToken0.decimals,
            sortedToken0.symbol || "",
            sortedToken0.name || ""
          );

          const sdkToken1 = new Token(
            chainId,
            getPoolTokenAddress(sortedToken1),
            sortedToken1.decimals,
            sortedToken1.symbol || "",
            sortedToken1.name || ""
          );

          const poolAddress = Pool.getAddress(sdkToken0, sdkToken1, selectedFeeTier);

          return {
            poolAddress,
            sortedToken0,
            sortedToken1,
            tokensSwapped: shouldSwap
          };
        } catch (error) {
          console.error("Error in getPoolAddressWithSorting:", error);
          throw error;
        }
      };

      // Get pool address with properly sorted tokens
      const { poolAddress, sortedToken0, sortedToken1, tokensSwapped: swapped } =
        await getPoolAddressWithSorting();

      // Update the tokensSwapped state for price calculations
      setTokensSwapped(swapped);

      if (!poolAddress) {
        throw new Error("Failed to calculate pool address");
      }

      // Create a minimal pool contract to get the current price and liquidity
      const poolABI = [
        'function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
        'function liquidity() external view returns (uint128)'
      ];

      const poolContract = new ethers.Contract(poolAddress, poolABI, readProvider);

      try {
        // Try to get the pool data
        const [slot0, liquidity] = await Promise.all([
          poolContract.slot0(),
          poolContract.liquidity()
        ]);

        // Extract tick value
        const tickValue = typeof slot0.tick === 'bigint' ? Number(slot0.tick) : Number(slot0.tick);

        // Use adapter to calculate price (use WETH address for native tokens)
        const baseToken = { address: getPoolTokenAddress(sortedToken0), decimals: sortedToken0.decimals };
        const quoteToken = { address: getPoolTokenAddress(sortedToken1), decimals: sortedToken1.decimals };
        const priceObj = adapter.calculatePriceFromSqrtPrice(
          slot0.sqrtPriceX96.toString(),
          baseToken,
          quoteToken
        );
        const price = parseFloat(priceObj.toSignificant(18));

        // Update state with current price and tick
        setCurrentPoolPrice(price);
        setPriceRange(prev => ({
          ...prev,
          current: tickValue
        }));

        // Store full pool data for position creation
        setLocalPoolData({
          fee: selectedFeeTier,
          sqrtPriceX96: slot0.sqrtPriceX96.toString(),
          liquidity: liquidity.toString(),
          tick: tickValue
        });

        // Store sorted token data for position creation (use WETH address for native tokens)
        setSortedToken0Data({
          address: getPoolTokenAddress(sortedToken0),
          decimals: sortedToken0.decimals,
          symbol: sortedToken0.symbol
        });
        setSortedToken1Data({
          address: getPoolTokenAddress(sortedToken1),
          decimals: sortedToken1.decimals,
          symbol: sortedToken1.symbol
        });

        // Calculate default price ranges based on current tick and price
        handleRangeTypeChange(rangeType, tickValue);
        setIsLoadingPrice(false);
      } catch (error) {
        console.error("Error fetching pool data:", error);
        // If pool doesn't exist, set null values with clear error
        setCurrentPoolPrice(null);
        setPriceRange(prev => ({
          ...prev,
          current: null
        }));
        setPriceLoadError("Pool does not exist for the selected tokens and fee tier");
        setIsLoadingPrice(false);
        showError("This token pair doesn't have a pool with the selected fee tier. Try a different fee tier or token pair.");
      }
    } catch (error) {
      console.error("Error fetching pool price:", error);
      setCurrentPoolPrice(null);
      setPriceLoadError(`Failed to fetch pool price: ${error.message}`);
      setIsLoadingPrice(false);
      showError(`Error loading pool data: ${error.message}`);
    }
  };

  // Handle token selection for new positions
  const handleToken0Selection = (tokenAddress) => {
    if (!tokenAddress) {
      setToken0Address('');
      return;
    }

    setToken0Address(tokenAddress);
    setOperationError(null); // Clear operation error when changing selection

    // Reset token amounts when changing tokens
    setToken0Amount('');
    setToken1Amount('');
    setCurrentPoolPrice(null);
    setPriceLoadError(null);
  };

  const handleToken1Selection = (tokenAddress) => {
    if (!tokenAddress) {
      setToken1Address('');
      return;
    }

    setToken1Address(tokenAddress);
    setOperationError(null); // Clear operation error when changing selection

    // Reset token amounts when changing tokens
    setToken0Amount('');
    setToken1Amount('');
    setCurrentPoolPrice(null);
    setPriceLoadError(null);
  };

  // Handle price range selection for new positions
  const handleRangeTypeChange = (type, currentTickOverride = null) => {
    setRangeType(type);
    setOperationError(null); // Clear operation error when changing range

    // Use either the provided currentTick or the one from state
    const currentTick = currentTickOverride !== null ? currentTickOverride : priceRange.current;

    // If we don't have a current tick, we can't calculate ranges
    if (currentTick === null || isNaN(currentTick)) {
      console.warn("No valid current tick available, cannot calculate ranges");
      return;
    }

    try {
      // Calculate tick spacing for different range types
      // These are based on log(1+percentage)/log(1.0001)
      let tickSpacing;
      switch (type) {
        case 'narrow':
          // ±2.5% range ≈ 247 ticks
          tickSpacing = Math.ceil(Math.log(1.025) / Math.log(1.0001));
          break;
        case 'medium':
          // ±5% range ≈ 488 ticks
          tickSpacing = Math.ceil(Math.log(1.05) / Math.log(1.0001));
          break;
        case 'wide':
          // ±10% range ≈ 953 ticks
          tickSpacing = Math.ceil(Math.log(1.1) / Math.log(1.0001));
          break;
        case 'custom':
          // Clear values when switching to custom - let user enter their own
          setCustomMinInput('');
          setCustomMaxInput('');
          setPriceRange({
            ...priceRange,
            min: null,
            max: null
          });
          // Reset token amounts since range is cleared
          setToken0Amount('');
          setToken1Amount('');
          return;
        default:
          console.error(`Unexpected range type: ${type}`);
          return;
      }

      // Calculate min and max ticks
      const rawMinTick = currentTick - tickSpacing;
      const rawMaxTick = currentTick + tickSpacing;

      // Align ticks to pool's tick spacing (required by Uniswap V3)
      const poolTickSpacing = getPlatformTickSpacing(selectedPlatform, selectedFeeTier);
      const minTick = Math.floor(rawMinTick / poolTickSpacing) * poolTickSpacing;
      const maxTick = Math.ceil(rawMaxTick / poolTickSpacing) * poolTickSpacing;

      // Verify calculations by converting ticks back to prices
      if (adapter && token0Address && token1Address) {
        // Use symbol to find token since token0Address/token1Address hold symbols
        const token0Info = commonTokens.find(t => t.symbol === token0Address);
        const token1Info = commonTokens.find(t => t.symbol === token1Address);

        if (token0Info && token1Info) {
          // Helper to get pool address (WETH for native tokens)
          const getPoolAddr = (info) => info.isNative ? info.wethAddress : info.address;

          const baseToken = tokensSwapped ?
            { address: getPoolAddr(token1Info), decimals: token1Info.decimals } :
            { address: getPoolAddr(token0Info), decimals: token0Info.decimals };
          const quoteToken = tokensSwapped ?
            { address: getPoolAddr(token0Info), decimals: token0Info.decimals } :
            { address: getPoolAddr(token1Info), decimals: token1Info.decimals };

          try {
            const lowerPriceObj = adapter.tickToPrice(minTick, baseToken, quoteToken);
            const upperPriceObj = adapter.tickToPrice(maxTick, baseToken, quoteToken);
            // Prices calculated for verification only - not currently used
            console.debug("Lower price:", lowerPriceObj.toSignificant(6));
            console.debug("Upper price:", upperPriceObj.toSignificant(6));
          } catch (e) {
            console.error("Error verifying price range:", e);
          }
        }
      }

      // Update the price range state
      setPriceRange({
        min: minTick,
        max: maxTick,
        current: currentTick
      });
    } catch (error) {
      console.error("Error calculating price range:", error);
      // Fall back to default ranges on error
      setPriceRange({
        min: type === 'narrow' ? -250 : (type === 'medium' ? -500 : -1000),
        max: type === 'narrow' ? 250 : (type === 'medium' ? 500 : 1000),
        current: currentTick
      });
      showError("Failed to calculate price range. Using default values instead.");
    }
  };

  // Handle custom min/max price inputs
  const handleCustomMinPrice = (priceValue) => {
    // Update the input value immediately (allows typing)
    setCustomMinInput(priceValue);
    setOperationError(null); // Clear operation error when typing

    // Reset token amounts when price range changes
    setToken0Amount('');
    setToken1Amount('');

    // Allow empty string for clearing the field
    if (priceValue === '') {
      setPriceRange({
        ...priceRange,
        min: null
      });
      return;
    }

    if (!adapter) {
      return;
    }

    try {
      const price = parseFloat(priceValue);

      // Skip validation during typing (allow intermediate states)
      if (isNaN(price)) {
        return;
      }

      if (price <= 0) {
        return;
      }

      // User enters price in the display format (what they see on screen)
      // When invertPriceDisplay=false: User sees "token0 per token1" (e.g., "ETH per USDC")
      // When invertPriceDisplay=true: User sees "token1 per token0" (e.g., "USDC per ETH")

      // Determine which tokens to use as base and quote based on display format
      // The adapter's priceToTick expects (price, baseToken, quoteToken) where price = quote/base
      const baseToken = invertPriceDisplay ? getToken0Data() : getToken1Data();
      const quoteToken = invertPriceDisplay ? getToken1Data() : getToken0Data();

      // Can't calculate tick without token data
      if (!baseToken || !quoteToken) {
        return;
      }

      // Use adapter's priceToTick method which handles decimals correctly
      const rawTick = adapter.priceToTick(price, baseToken, quoteToken);

      // Align tick to pool's tick spacing (required by Uniswap V3)
      const poolTickSpacing = getPlatformTickSpacing(selectedPlatform, selectedFeeTier);
      const alignedTick = Math.floor(rawTick / poolTickSpacing) * poolTickSpacing;

      setPriceRange({
        ...priceRange,
        min: alignedTick
      });
    } catch (error) {
      console.error("Error setting custom min price:", error);
    }
  };

  const handleCustomMaxPrice = (priceValue) => {
    // Update the input value immediately (allows typing)
    setCustomMaxInput(priceValue);
    setOperationError(null); // Clear operation error when typing

    // Reset token amounts when price range changes
    setToken0Amount('');
    setToken1Amount('');

    // Allow empty string for clearing the field
    if (priceValue === '') {
      setPriceRange({
        ...priceRange,
        max: null
      });
      return;
    }

    if (!adapter) {
      return;
    }

    try {
      const price = parseFloat(priceValue);

      // Skip validation during typing (allow intermediate states)
      if (isNaN(price)) {
        return;
      }

      if (price <= 0) {
        return;
      }

      // User enters price in the display format (what they see on screen)
      // When invertPriceDisplay=false: User sees "token0 per token1" (e.g., "ETH per USDC")
      // When invertPriceDisplay=true: User sees "token1 per token0" (e.g., "USDC per ETH")

      // Determine which tokens to use as base and quote based on display format
      // The adapter's priceToTick expects (price, baseToken, quoteToken) where price = quote/base
      const baseToken = invertPriceDisplay ? getToken0Data() : getToken1Data();
      const quoteToken = invertPriceDisplay ? getToken1Data() : getToken0Data();

      // Can't calculate tick without token data
      if (!baseToken || !quoteToken) {
        return;
      }

      // Use adapter's priceToTick method which handles decimals correctly
      const rawTick = adapter.priceToTick(price, baseToken, quoteToken);

      // Align tick to pool's tick spacing (required by Uniswap V3)
      const poolTickSpacing = getPlatformTickSpacing(selectedPlatform, selectedFeeTier);
      const alignedTick = Math.ceil(rawTick / poolTickSpacing) * poolTickSpacing;

      setPriceRange({
        ...priceRange,
        max: alignedTick
      });
    } catch (error) {
      console.error("Error setting custom max price:", error);
    }
  };

  // Function to add liquidity to an existing position with approval flow
  const addLiquidity = async (params) => {
    if (!adapter) {
      throw new Error("No adapter available for this position");
    }

    // Get Position Manager address from adapter
    const positionManagerAddress = adapter.addresses?.positionManagerAddress;
    if (!positionManagerAddress) {
      throw new Error("Position Manager address not found");
    }

    // For existing positions, check if either token is ETH (by looking up via WETH address)
    // token0Balance/token1Balance already have isNative flag from enrichment
    const token0IsNative = token0Balance?.isNative || false;
    const token1IsNative = token1Balance?.isNative || false;

    // Get ETH token info from library if either token is native
    let ethTokenInfo = null;
    let ethBalance = null;
    let ethAmount = null;

    if (token0IsNative && chainId) {
      try {
        ethTokenInfo = getTokenByAddress(token0Data.address, chainId);
        ethBalance = token0Balance;
        ethAmount = params.token0Amount;
      } catch (e) {
        console.error("Error getting ETH token info for token0:", e);
      }
    } else if (token1IsNative && chainId) {
      try {
        ethTokenInfo = getTokenByAddress(token1Data.address, chainId);
        ethBalance = token1Balance;
        ethAmount = params.token1Amount;
      } catch (e) {
        console.error("Error getting ETH token info for token1:", e);
      }
    }

    let wrapAmount = "0";
    if (ethTokenInfo && ethBalance && ethAmount) {
      wrapAmount = calculateWrapAmount(ethAmount, ethBalance);
    }
    const needsWrap = parseFloat(wrapAmount) > 0;

    // Convert token amounts from human-readable format to wei (needed for allowance check)
    const token0AmountWei = ethers.utils.parseUnits(
      params.token0Amount || "0",
      token0Data.decimals
    ).toString();

    const token1AmountWei = ethers.utils.parseUnits(
      params.token1Amount || "0",
      token1Data.decimals
    ).toString();

    // ERC20 ABI for approve and allowance
    const erc20ABI = [
      'function approve(address spender, uint256 amount) returns (bool)',
      'function allowance(address owner, address spender) view returns (uint256)'
    ];

    // Check allowances BEFORE building steps to know which approve steps are needed
    let needsToken0Approval = false;
    let needsToken1Approval = false;

    if (token0AmountWei !== "0") {
      const token0Contract = new ethers.Contract(token0Data.address, erc20ABI, readProvider);
      const token0Allowance = await token0Contract.allowance(address, positionManagerAddress);
      needsToken0Approval = ethers.BigNumber.from(token0Allowance).lt(ethers.BigNumber.from(token0AmountWei));
    }

    if (token1AmountWei !== "0") {
      const token1Contract = new ethers.Contract(token1Data.address, erc20ABI, readProvider);
      const token1Allowance = await token1Contract.allowance(address, positionManagerAddress);
      needsToken1Approval = ethers.BigNumber.from(token1Allowance).lt(ethers.BigNumber.from(token1AmountWei));
    }

    // Build transaction steps dynamically based on what's actually needed
    const steps = [];
    if (needsWrap) {
      steps.push({ title: 'Prepare ETH', description: `Preparing ${parseFloat(wrapAmount).toFixed(6)} ETH for the position` });
    }
    if (needsToken0Approval) {
      steps.push({ title: `Approve ${token0Data?.symbol}`, description: 'Grant permission to spend token' });
    }
    if (needsToken1Approval) {
      steps.push({ title: `Approve ${token1Data?.symbol}`, description: 'Grant permission to spend token' });
    }
    steps.push({ title: 'Add Liquidity', description: 'Add tokens to your position' });

    setTransactionSteps(steps);
    setCurrentTxStep(0);
    setTransactionError('');
    setTransactionWarning('');

    // Show transaction modal and hide main modal
    setShowTransactionModal(true);
    setIsAddingLiquidity(true);
    setOperationError(null);

    try {
      // Get signer
      const signer = getSigner();

      // Track current step index
      let stepIndex = 0;

      // Step (conditional): Wrap ETH to WETH if needed
      if (needsWrap) {
        const wrapAmountWei = ethers.utils.parseEther(wrapAmount);
        const wethAddress = ethTokenInfo.wethAddresses?.[chainId];

        const WETH_ABI = ['function deposit() payable'];
        const wethContract = new ethers.Contract(wethAddress, WETH_ABI, signer);

        const wrapTx = await wethContract.deposit({ value: wrapAmountWei });
        await wrapTx.wait();

        stepIndex++;
        setCurrentTxStep(stepIndex);
      }

      // Step (conditional): Approve token0 if needed
      if (needsToken0Approval) {
        const token0Contract = new ethers.Contract(token0Data.address, erc20ABI, readProvider);
        const token0ContractWithSigner = token0Contract.connect(signer);
        const approveTx = await token0ContractWithSigner.approve(
          positionManagerAddress,
          ethers.constants.MaxUint256
        );
        await approveTx.wait();

        stepIndex++;
        setCurrentTxStep(stepIndex);
      }

      // Step (conditional): Approve token1 if needed
      if (needsToken1Approval) {
        const token1Contract = new ethers.Contract(token1Data.address, erc20ABI, readProvider);
        const token1ContractWithSigner = token1Contract.connect(signer);
        const approveTx = await token1ContractWithSigner.approve(
          positionManagerAddress,
          ethers.constants.MaxUint256
        );
        await approveTx.wait();

        stepIndex++;
        setCurrentTxStep(stepIndex);
      }

      // Step 3: Generate transaction data using the library
      const txData = await adapter.generateAddLiquidityData({
        position: params.position,
        token0Amount: token0AmountWei,
        token1Amount: token1AmountWei,
        provider: readProvider,
        poolData,
        token0Data,
        token1Data,
        slippageTolerance: parseFloat(params.slippageTolerance),
        deadlineMinutes: 20
      });

      // Send add liquidity transaction
      const tx = await signer.sendTransaction({
        to: txData.to,
        data: txData.data,
        value: txData.value
      });

      // Wait for transaction confirmation
      const receipt = await tx.wait();

      // All steps complete
      setCurrentTxStep(steps.length - 1);

      // Show success message with transaction hash
      showSuccess("Successfully added liquidity!", receipt.hash);

      // Close both modals and refresh
      setTimeout(() => {
        setShowTransactionModal(false);
        handleClose();
        dispatch(triggerUpdate());
      }, 1500);
    } catch (error) {
      // Check if user rejected the transaction - handle silently
      if (error.code === 'ACTION_REJECTED' || error.code === 4001 || error.message?.includes('user rejected')) {
        setShowTransactionModal(false);
        setIsAddingLiquidity(false);
        return;
      }

      // Real error - log and show user-friendly message
      console.error("Error adding liquidity:", error);
      const errorMessage = error.reason || error.message || "Failed to add liquidity";
      setTransactionError(errorMessage);
      setOperationError(`Error adding liquidity: ${errorMessage}`);
      showError(`Error adding liquidity: ${errorMessage}`);
    } finally {
      setIsAddingLiquidity(false);
    }
  };

  /**
   * Calculate how much ETH needs to be wrapped for a native token
   * @param {string} requiredAmount - Amount needed for the position (human readable)
   * @param {object} balance - Balance object { native, wrapped, total, isNative }
   * @returns {string} Amount to wrap (human readable), or "0" if no wrap needed
   */
  const calculateWrapAmount = (requiredAmount, balance) => {
    if (!balance?.isNative) return "0";

    const required = parseFloat(requiredAmount);
    const availableWeth = parseFloat(balance.wrapped);

    if (required <= availableWeth) {
      return "0"; // Already have enough WETH
    }

    const wrapNeeded = required - availableWeth;
    return wrapNeeded.toString();
  };

  // Function to create a new position with approval flow
  const createPosition = async (params) => {
    if (!adapter) {
      throw new Error(`No adapter available for platform: ${params.platformId}`);
    }

    if (!localPoolData || !sortedToken0Data || !sortedToken1Data) {
      throw new Error("Pool data not loaded. Please wait for pool data to load.");
    }

    // Get Position Manager address from adapter
    const positionManagerAddress = adapter.addresses?.positionManagerAddress;
    if (!positionManagerAddress) {
      throw new Error("Position Manager address not found");
    }

    // Determine which token is ETH (if any) and calculate wrap amount
    const token0Info = commonTokens.find(t => t.symbol === token0Address);
    const token1Info = commonTokens.find(t => t.symbol === token1Address);

    // Get the ETH amount in user's input order (before pool sorting)
    const ethTokenInfo = token0Info?.isNative ? token0Info : (token1Info?.isNative ? token1Info : null);
    const ethBalance = token0Info?.isNative ? token0Balance : (token1Info?.isNative ? token1Balance : null);
    const ethAmount = token0Info?.isNative ? params.token0Amount : (token1Info?.isNative ? params.token1Amount : null);

    let wrapAmount = "0";
    if (ethTokenInfo && ethBalance && ethAmount) {
      wrapAmount = calculateWrapAmount(ethAmount, ethBalance);
    }
    const needsWrap = parseFloat(wrapAmount) > 0;

    // If tokens were swapped during sorting, swap the amounts to match pool order
    const amount0ForPool = tokensSwapped ? params.token1Amount : params.token0Amount;
    const amount1ForPool = tokensSwapped ? params.token0Amount : params.token1Amount;

    // Convert token amounts from human-readable format to wei
    const token0AmountWei = ethers.utils.parseUnits(
      amount0ForPool || "0",
      sortedToken0Data.decimals
    ).toString();

    const token1AmountWei = ethers.utils.parseUnits(
      amount1ForPool || "0",
      sortedToken1Data.decimals
    ).toString();

    // ERC20 ABI for approve and allowance
    const erc20ABI = [
      'function approve(address spender, uint256 amount) returns (bool)',
      'function allowance(address owner, address spender) view returns (uint256)'
    ];

    // Check allowances BEFORE building steps to know which approve steps are needed
    let needsToken0Approval = false;
    let needsToken1Approval = false;

    if (token0AmountWei !== "0") {
      const token0Contract = new ethers.Contract(sortedToken0Data.address, erc20ABI, readProvider);
      const token0Allowance = await token0Contract.allowance(address, positionManagerAddress);
      needsToken0Approval = ethers.BigNumber.from(token0Allowance).lt(ethers.BigNumber.from(token0AmountWei));
    }

    if (token1AmountWei !== "0") {
      const token1Contract = new ethers.Contract(sortedToken1Data.address, erc20ABI, readProvider);
      const token1Allowance = await token1Contract.allowance(address, positionManagerAddress);
      needsToken1Approval = ethers.BigNumber.from(token1Allowance).lt(ethers.BigNumber.from(token1AmountWei));
    }

    // Build transaction steps dynamically based on what's actually needed
    const steps = [];
    if (needsWrap) {
      steps.push({ title: 'Prepare ETH', description: `Preparing ${parseFloat(wrapAmount).toFixed(6)} ETH for the position` });
    }
    if (needsToken0Approval) {
      steps.push({ title: `Approve ${sortedToken0Data.symbol}`, description: 'Grant permission to spend token' });
    }
    if (needsToken1Approval) {
      steps.push({ title: `Approve ${sortedToken1Data.symbol}`, description: 'Grant permission to spend token' });
    }
    steps.push({ title: 'Create Position', description: 'Mint new liquidity position' });

    setTransactionSteps(steps);
    setCurrentTxStep(0);
    setTransactionError('');
    setTransactionWarning('');

    // Show transaction modal
    setShowTransactionModal(true);
    setIsCreatingPosition(true);
    setOperationError(null);

    try {

      // Get signer
      const signer = getSigner();

      // Track current step index (dynamic based on whether wrap is needed)
      let stepIndex = 0;

      // Step 0 (conditional): Wrap ETH to WETH if needed
      if (needsWrap) {
        const wrapAmountWei = ethers.utils.parseEther(wrapAmount);
        const wethAddress = ethTokenInfo.wethAddress;

        const WETH_ABI = ['function deposit() payable'];
        const wethContract = new ethers.Contract(wethAddress, WETH_ABI, signer);

        const wrapTx = await wethContract.deposit({ value: wrapAmountWei });
        await wrapTx.wait();

        stepIndex++;
        setCurrentTxStep(stepIndex);
      }

      // Step: Approve token0 if needed
      if (needsToken0Approval) {
        const token0Contract = new ethers.Contract(sortedToken0Data.address, erc20ABI, signer);
        const approveTx = await token0Contract.approve(
          positionManagerAddress,
          ethers.constants.MaxUint256
        );
        await approveTx.wait();

        stepIndex++;
        setCurrentTxStep(stepIndex);
      }

      // Step: Approve token1 if needed
      if (needsToken1Approval) {
        const token1Contract = new ethers.Contract(sortedToken1Data.address, erc20ABI, signer);
        const approveTx = await token1Contract.approve(
          positionManagerAddress,
          ethers.constants.MaxUint256
        );
        await approveTx.wait();

        stepIndex++;
        setCurrentTxStep(stepIndex);
      }

      // Step 3: Generate transaction data using the library
      // Ensure tickLower < tickUpper for the SDK
      const tickLower = Math.min(params.tickLower, params.tickUpper);
      const tickUpper = Math.max(params.tickLower, params.tickUpper);

      console.log('Creating position with:', {
        tickLower,
        tickUpper,
        token0AmountWei,
        token1AmountWei,
        poolData: localPoolData,
        token0Data: sortedToken0Data,
        token1Data: sortedToken1Data
      });

      const txData = await adapter.generateCreatePositionData({
        position: {
          tickLower,
          tickUpper
        },
        token0Amount: token0AmountWei,
        token1Amount: token1AmountWei,
        provider: readProvider,
        walletAddress: address,
        poolData: localPoolData,
        token0Data: sortedToken0Data,
        token1Data: sortedToken1Data,
        slippageTolerance: parseFloat(params.slippageTolerance),
        deadlineMinutes: 20
      });

      // Send create position transaction
      const tx = await signer.sendTransaction({
        to: txData.to,
        data: txData.data,
        value: txData.value
      });

      // Wait for transaction confirmation
      const receipt = await tx.wait();

      // All steps complete
      setCurrentTxStep(steps.length - 1);

      // Show success message with transaction hash
      showSuccess(`Successfully created new ${params.platformId} position!`, receipt.transactionHash);

      // Close both modals and refresh
      setTimeout(() => {
        setShowTransactionModal(false);
        handleClose();
        dispatch(triggerUpdate());
      }, 1500);
    } catch (error) {
      // Check if user rejected the transaction - handle silently
      if (error.code === 'ACTION_REJECTED' || error.code === 4001 || error.message?.includes('user rejected')) {
        setShowTransactionModal(false);
        setIsCreatingPosition(false);
        return;
      }

      // Real error - log and show user-friendly message
      console.error("Error creating position:", error);
      const errorMessage = error.reason || error.message || "Failed to create position";
      setTransactionError(errorMessage);
      setOperationError(`Error creating position: ${errorMessage}`);
      showError(`Error creating position: ${errorMessage}`);
    } finally {
      setIsCreatingPosition(false);
    }
  };

  // Validate decimal precision based on token decimals
  const validateDecimalPrecision = (value, tokenDecimals, tokenSymbol) => {
    if (!value || value === '') return null;

    // Count decimal places in the input
    const parts = value.toString().split('.');
    if (parts.length === 1) return null; // No decimals

    const decimalPlaces = parts[1].length;

    if (decimalPlaces > tokenDecimals) {
      return `${tokenSymbol} supports a maximum of ${tokenDecimals} decimal places`;
    }

    return null;
  };

  // Handle submission - now directly calls adapter methods
  const handleSubmit = (e) => {
    e.preventDefault();

    // Clear any previous errors
    setOperationError(null);

    // Collect all validation errors
    const errors = [];

    // No need to pause auto-refresh here since we've already done it when the modal opened
    if (isExistingPosition) {
      // Validate inputs for adding liquidity
      if (!token0Amount && !token1Amount) {
        errors.push("Please enter token amounts");
      }

      // Validate token0 amount
      if (token0Amount) {
        const amount0 = parseFloat(token0Amount);

        if (isNaN(amount0) || amount0 <= 0) {
          errors.push(`${token0Data?.symbol || 'Token 0'} amount must be greater than zero`);
        } else {
          // Validate decimal precision
          const decimalError = validateDecimalPrecision(token0Amount, token0Data?.decimals, token0Data?.symbol || 'Token 0');
          if (decimalError) errors.push(decimalError);

          // Validate balance (use .total for both native and ERC20 tokens)
          if (token0Balance !== null) {
            const balance0 = parseFloat(token0Balance.total);
            if (amount0 > balance0) {
              errors.push(`${token0Data?.symbol || 'Token 0'} amount exceeds your balance`);
            }
          }
        }
      }

      // Validate token1 amount
      if (token1Amount) {
        const amount1 = parseFloat(token1Amount);

        if (isNaN(amount1) || amount1 <= 0) {
          errors.push(`${token1Data?.symbol || 'Token 1'} amount must be greater than zero`);
        } else {
          // Validate decimal precision
          const decimalError = validateDecimalPrecision(token1Amount, token1Data?.decimals, token1Data?.symbol || 'Token 1');
          if (decimalError) errors.push(decimalError);

          // Validate balance (use .total for both native and ERC20 tokens)
          if (token1Balance !== null) {
            const balance1 = parseFloat(token1Balance.total);
            if (amount1 > balance1) {
              errors.push(`${token1Data?.symbol || 'Token 1'} amount exceeds your balance`);
            }
          }
        }
      }

      // Validate slippage tolerance (validate last so it appears last in error list)
      const slippageNum = parseFloat(slippageTolerance);
      if (isNaN(slippageNum) || slippageNum < 0.1 || slippageNum > 5) {
        errors.push("Slippage tolerance must be between 0.1% and 5%");
      }

      // If there are validation errors, display them and stop
      if (errors.length > 0) {
        setOperationError(errors.join('. '));
        return;
      }

      // Add liquidity to existing position - direct adapter call
      addLiquidity({
        position,
        token0Amount,
        token1Amount,
        slippageTolerance
      });
    } else {
      // Validate inputs for creating position
      if (!token0Address || !token1Address) {
        errors.push("Please select both tokens");
      }

      // Validate tokens are not the same (token0Address/token1Address now hold symbols)
      if (token0Address && token1Address && token0Address === token1Address) {
        errors.push("Cannot create position with the same token for both sides");
      }

      // Validate pool exists
      if (priceLoadError) {
        errors.push("Cannot create position: pool does not exist for selected tokens and fee tier");
      }

      // Validate fee tier using adapter's supported fee tiers
      if (adapter && adapter.feeTiers && !adapter.feeTiers.includes(selectedFeeTier)) {
        errors.push(`Invalid fee tier selected. Supported fee tiers: ${adapter.feeTiers.map(f => f/10000 + '%').join(', ')}`);
      }

      // Validate price range
      if (priceRange.min === null || priceRange.max === null) {
        errors.push("Please set a price range");
      } else {
        // Validate that min < max
        if (priceRange.min >= priceRange.max) {
          errors.push("Minimum price must be less than maximum price");
        }
      }

      // Validate custom price inputs when in custom mode
      if (rangeType === 'custom') {
        if (customMinInput) {
          const minPrice = parseFloat(customMinInput);
          if (isNaN(minPrice) || minPrice <= 0) {
            errors.push("Min price must be a positive number");
          }
        }
        if (customMaxInput) {
          const maxPrice = parseFloat(customMaxInput);
          if (isNaN(maxPrice) || maxPrice <= 0) {
            errors.push("Max price must be a positive number");
          }
        }
        if (customMinInput && customMaxInput) {
          const minPrice = parseFloat(customMinInput);
          const maxPrice = parseFloat(customMaxInput);
          if (!isNaN(minPrice) && !isNaN(maxPrice) && minPrice >= maxPrice) {
            errors.push("Min price must be less than max price");
          }
        }
      }

      if (!token0Amount && !token1Amount) {
        errors.push("Please enter at least one token amount");
      }

      // Validate token0 amount for new position
      if (token0Amount) {
        const amount0 = parseFloat(token0Amount);
        if (isNaN(amount0) || amount0 <= 0) {
          errors.push("Token 0 amount must be greater than zero");
        } else {
          // Validate decimal precision (use symbol to find token since ETH has null address)
          const token0Info = commonTokens.find(t => t.symbol === token0Address);
          if (token0Info) {
            const decimalError = validateDecimalPrecision(token0Amount, token0Info.decimals, token0Info.symbol);
            if (decimalError) errors.push(decimalError);
          }

          // Validate balance (use .total for both native and ERC20 tokens)
          if (token0Balance !== null) {
            const balance0 = parseFloat(token0Balance.total);
            if (amount0 > balance0) {
              errors.push("Token 0 amount exceeds your balance");
            }
          }
        }
      }

      // Validate token1 amount for new position
      if (token1Amount) {
        const amount1 = parseFloat(token1Amount);
        if (isNaN(amount1) || amount1 <= 0) {
          errors.push("Token 1 amount must be greater than zero");
        } else {
          // Validate decimal precision (use symbol to find token since ETH has null address)
          const token1Info = commonTokens.find(t => t.symbol === token1Address);
          if (token1Info) {
            const decimalError = validateDecimalPrecision(token1Amount, token1Info.decimals, token1Info.symbol);
            if (decimalError) errors.push(decimalError);
          }

          // Validate balance (use .total for both native and ERC20 tokens)
          if (token1Balance !== null) {
            const balance1 = parseFloat(token1Balance.total);
            if (amount1 > balance1) {
              errors.push("Token 1 amount exceeds your balance");
            }
          }
        }
      }

      // Validate slippage tolerance (validate last so it appears last in error list)
      const slippageNum = parseFloat(slippageTolerance);
      if (isNaN(slippageNum) || slippageNum < 0.1 || slippageNum > 5) {
        errors.push("Slippage tolerance must be between 0.1% and 5%");
      }

      // If there are validation errors, display them and stop
      if (errors.length > 0) {
        setOperationError(errors.join('. '));
        return;
      }

      // Create new position - direct adapter call
      // Note: token data and pool data are now stored in state (sortedToken0Data, sortedToken1Data, localPoolData)
      createPosition({
        platformId: selectedPlatform,
        tickLower: priceRange.min,
        tickUpper: priceRange.max,
        token0Amount,
        token1Amount,
        slippageTolerance
      });
    }
  };

  // Get fee tier options
  const getFeeTierOptions = () => {
    return [
      { value: 100, label: '0.01%' },
      { value: 500, label: '0.05%' },
      { value: 3000, label: '0.3%' },
      { value: 10000, label: '1%' }
    ];
  };

  // Helper to format price from tick using the adapter
  const formatTickToPrice = (tick) => {
    if (tick === null || tick === undefined || !adapter) {
      return 'N/A';
    }

    try {
      // Get token data
      const getTokens = () => {
        // Helper to get pool address (WETH for native tokens)
        const getPoolAddr = (tokenInfo) => tokenInfo.isNative ? tokenInfo.wethAddress : tokenInfo.address;

        if (isExistingPosition) {
          if (!token0Data?.decimals || !token1Data?.decimals || !token0Data?.address || !token1Data?.address) {
            return { token0: null, token1: null };
          }
          return {
            token0: { address: token0Data.address, decimals: token0Data.decimals },
            token1: { address: token1Data.address, decimals: token1Data.decimals }
          };
        } else {
          // Use symbol to find token since token0Address/token1Address hold symbols
          const token0 = commonTokens.find(t => t.symbol === token0Address);
          const token1 = commonTokens.find(t => t.symbol === token1Address);

          if (!token0?.decimals || !token1?.decimals) {
            return { token0: null, token1: null };
          }

          // Get pool address (WETH for native tokens)
          const t0Addr = getPoolAddr(token0);
          const t1Addr = getPoolAddr(token1);

          if (!t0Addr || !t1Addr) {
            return { token0: null, token1: null };
          }

          return {
            token0: { address: t0Addr, decimals: token0.decimals },
            token1: { address: t1Addr, decimals: token1.decimals }
          };
        }
      };

      // Get token data
      const { token0, token1 } = getTokens();
      if (!token0 || !token1) {
        return 'N/A';
      }

      // Prevent infinite loop when tokens are the same
      if (token0.address === token1.address) {
        return 'N/A';
      }

      // Use adapter's tick to price function
      // The adapter now handles sorting internally and returns price in the order we request
      // tickToPrice(base, quote) returns "quote per base"
      //
      // When invertPriceDisplay=false: We want to display "token0 per token1" (ETH per USDC)
      //   So ask for tickToPrice(base=token1, quote=token0) → returns "token0 per token1" ✓
      // When invertPriceDisplay=true: We want to display "token1 per token0" (USDC per ETH)
      //   So ask for tickToPrice(base=token0, quote=token1) → returns "token1 per token0" ✓

      const baseToken = invertPriceDisplay ? token0 : token1;
      const quoteToken = invertPriceDisplay ? token1 : token0;

      // Get the price from adapter
      let priceObj;
      try {
        priceObj = adapter.tickToPrice(tick, baseToken, quoteToken);
      } catch (adapterError) {
        console.error("Error in adapter.tickToPrice:", adapterError);
        return 'N/A';
      }

      // Convert Price object to number - this is already in the format we requested
      let price = parseFloat(priceObj.toSignificant(18));

      // Format for display
      if (isNaN(price)) {
        return 'N/A';
      }

      return price.toFixed(8);
    } catch (error) {
      console.error("Error formatting tick to price:", error);
      return 'N/A';
    }
  };

  // Format current price for display
  const displayCurrentPrice = useMemo(() => {
    if (!currentPoolPrice) {
      return isExistingPosition && poolData ? formatTickToPrice(poolData.tick) : "Unknown";
    }

    try {
      const price = parseFloat(currentPoolPrice);

      if (isNaN(price) || price === 0) {
        return "Unknown";
      }

      // currentPoolPrice from adapter is sortedToken1/sortedToken0 (sorted by address)
      // When tokensSwapped is true, the price is already in user's token0/token1 direction
      // When tokensSwapped is false, price needs inversion for user's view
      // invertPriceDisplay then flips it if user clicked the switch button
      const needsInversion = tokensSwapped ? invertPriceDisplay : !invertPriceDisplay;
      const displayPrice = needsInversion ? 1 / price : price;

      // Handle very small numbers more gracefully
      if (displayPrice < 0.0001 && displayPrice > 0) {
        return displayPrice.toExponential(4); // Use scientific notation for very small numbers
      }

      return formatPrice(displayPrice);
    } catch (error) {
      console.error("Error formatting current price:", error);
      return "Unknown";
    }
  }, [currentPoolPrice, isExistingPosition, poolData, formatTickToPrice, invertPriceDisplay]);

  // Get token data safely (use symbol since token0Address/token1Address hold symbols)
  const getToken0Data = () => {
    if (isExistingPosition) {
      return token0Data;
    } else {
      return commonTokens.find(t => t.symbol === token0Address);
    }
  };

  const getToken1Data = () => {
    if (isExistingPosition) {
      return token1Data;
    } else {
      return commonTokens.find(t => t.symbol === token1Address);
    }
  };

  const getToken0Symbol = () => {
    if (isExistingPosition) {
      return token0Data?.symbol || "Token0";
    } else {
      // token0Address holds the symbol directly
      return token0Address || "Token0";
    }
  };

  const getToken1Symbol = () => {
    if (isExistingPosition) {
      return token1Data?.symbol || "Token1";
    } else {
      // token1Address holds the symbol directly
      return token1Address || "Token1";
    }
  };

  const token0Symbol = getToken0Symbol();
  const token1Symbol = getToken1Symbol();

  // Get correct display price direction
  const getPriceDisplay = () => {
    // The price from calculatePriceFromSqrtPrice is "quoteToken per baseToken"
    // where baseToken=sortedToken0, quoteToken=sortedToken1
    // So price = sortedToken1/sortedToken0
    let baseDisplay;

    // For existing positions, respect the token order from the position
    if (isExistingPosition) {
      baseDisplay = `${displayCurrentPrice} ${token0Symbol} per ${token1Symbol}`;
    } else {
      // For new positions:
      // - When tokensSwapped=true: sortedToken0=userToken1, sortedToken1=userToken0
      //   So price = userToken0/userToken1 → display as "token0 per token1"
      // - When tokensSwapped=false: sortedToken0=userToken0, sortedToken1=userToken1
      //   So price = userToken1/userToken0 → display as "token1 per token0"
      if (tokensSwapped) {
        baseDisplay = `${displayCurrentPrice} ${token0Symbol} per ${token1Symbol}`;
      } else {
        baseDisplay = `${displayCurrentPrice} ${token1Symbol} per ${token0Symbol}`;
      }
    }

    // If user manually flipped the price display, invert it
    if (invertPriceDisplay) {
      // Swap the token symbols in the display
      return baseDisplay.includes(`${token0Symbol} per ${token1Symbol}`) ?
        `${displayCurrentPrice} ${token1Symbol} per ${token0Symbol}` :
        `${displayCurrentPrice} ${token0Symbol} per ${token1Symbol}`;
    }

    return baseDisplay;
  };

  // Check if price is in range
  const isPriceInRange = () => {
    if (isExistingPosition) {
      return poolData?.tick >= position?.tickLower && poolData?.tick <= position?.tickUpper;
    } else {
      // Handle case where min/max ticks might be swapped due to price display direction
      const lowerTick = Math.min(priceRange.min, priceRange.max);
      const upperTick = Math.max(priceRange.min, priceRange.max);
      return priceRange.current >= lowerTick && priceRange.current <= upperTick;
    }
  };

  return (
    <>
    <Modal
      show={show}
      onHide={handleClose}
      centered
      backdrop="static"
      keyboard={false}
      data-no-propagation="true"
    >
      <style>{numberInputStyles}</style>
      <Form onSubmit={handleSubmit} noValidate>
        <Modal.Header closeButton>
          <Modal.Title>
            {isExistingPosition ? (
              <>
                Add Liquidity to Position #{position?.id} - {position?.tokenPair}
                <small className="ms-2 text-muted">({position?.fee / 10000}% fee)</small>
              </>
            ) : (
              "Create New Liquidity Position"
            )}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {/* Operation error message */}
          {operationError && (
            <Alert variant="danger" className="mb-3">
              {operationError.includes('. ') ? (
                <ul className="mb-0">
                  {operationError.split('. ').filter(err => err.trim()).map((error, index) => (
                    <li key={index}>{error}</li>
                  ))}
                </ul>
              ) : (
                operationError
              )}
            </Alert>
          )}

          {/* Passed error message (legacy support) */}
          {errorMessage && !operationError && (
            <Alert variant="danger" className="mb-3">
              {errorMessage}
            </Alert>
          )}

          {priceLoadError && (
            <Alert variant="warning" className="mb-3">
              {priceLoadError}
            </Alert>
          )}

          <div className="mb-4">
            {/* Platform and Token Selection Section */}
            <h6 className="border-bottom pb-2 mb-4">Position Details</h6>

            <Row className="mb-3">
              <Col md={4}>
                <Form.Group>
                  <Form.Label style={{ fontSize: '0.9em' }}>Platform</Form.Label>
                  <Form.Select
                    value={selectedPlatform}
                    onChange={(e) => {
                      setSelectedPlatform(e.target.value);
                      setOperationError(null); // Clear operation error when changing selection
                    }}
                    disabled={isExistingPosition || isProcessingOperation}
                    required
                    style={{ fontSize: '0.9em' }}
                  >
                    {supportedPlatforms?.length > 0
                      ? supportedPlatforms.map(platform => (
                        <option key={platform.id} value={platform.id}>
                          {platform.name}
                        </option>
                      ))
                      : <option value="uniswapV3">Uniswap V3</option>
                    }
                  </Form.Select>
                </Form.Group>
              </Col>

              <Col md={4}>
                <Form.Group>
                  <Form.Label style={{ fontSize: '0.9em' }}>Token 0</Form.Label>
                  <Form.Select
                    value={token0Address}
                    onChange={(e) => handleToken0Selection(e.target.value)}
                    disabled={isExistingPosition || isProcessingOperation}
                    required
                    style={{ fontSize: '0.9em' }}
                  >
                    {isExistingPosition ? (
                      <option value={token0Data?.symbol}>{token0Data?.symbol}</option>
                    ) : (
                      <>
                        <option value="">Select Token 0</option>
                        {commonTokens.map(token => (
                          <option key={token.symbol} value={token.symbol}>
                            {token.symbol} - {token.name}
                          </option>
                        ))}
                      </>
                    )}
                  </Form.Select>
                </Form.Group>
              </Col>

              <Col md={4}>
                <Form.Group>
                  <Form.Label style={{ fontSize: '0.9em' }}>Token 1</Form.Label>
                  <Form.Select
                    value={token1Address}
                    onChange={(e) => handleToken1Selection(e.target.value)}
                    disabled={isExistingPosition || !token0Address || isProcessingOperation}
                    required
                    style={{ fontSize: '0.9em' }}
                  >
                    {isExistingPosition ? (
                      <option value={token1Data?.symbol}>{token1Data?.symbol}</option>
                    ) : (
                      <>
                        <option value="">Select Token 1</option>
                        {commonTokens
                          .filter(token => token.symbol !== token0Address)
                          .map(token => (
                            <option key={token.symbol} value={token.symbol}>
                              {token.symbol} - {token.name}
                            </option>
                          ))}
                      </>
                    )}
                  </Form.Select>
                </Form.Group>
              </Col>
            </Row>

            <Row className="mb-3">
              <Col md={4}>
                <Form.Group>
                  <Form.Label style={{ fontSize: '0.9em' }}>Fee Tier</Form.Label>
                  <Form.Select
                    value={selectedFeeTier}
                    onChange={(e) => {
                      setSelectedFeeTier(parseInt(e.target.value));
                      setOperationError(null); // Clear operation error when changing selection
                    }}
                    disabled={isExistingPosition || isProcessingOperation}
                    required
                    style={{ fontSize: '0.9em' }}
                  >
                    {getFeeTierOptions().map(tier => (
                      <option key={tier.value} value={tier.value}>
                        {tier.label}
                      </option>
                    ))}
                  </Form.Select>
                </Form.Group>
              </Col>

              <Col md={8}>
                <Form.Group className="h-100 d-flex flex-column">
                  <div className="d-flex align-items-center mb-2">
                    <Form.Label className="mb-0 me-2" style={{ fontSize: '0.9em' }}>Current Price</Form.Label>
                    <Button
                      variant="link"
                      className="p-0 text-decoration-none"
                      size="sm"
                      style={{ verticalAlign: 'top', display: 'inline-flex', marginTop: '-2px', fontSize: '0.9em' }}
                      onClick={() => setInvertPriceDisplay(!invertPriceDisplay)}
                      title="Switch price direction"
                      disabled={isLoadingPrice || !!priceLoadError || isProcessingOperation}
                    >
                      <span role="img" aria-label="switch">⇄</span>
                    </Button>
                  </div>
                  <div className="p-2 rounded flex-grow-1 d-flex align-items-center" style={{ border: '1px solid var(--neutral-700)', backgroundColor: '#e9ecef', padding: '0.625rem 1rem', fontSize: '0.9em' }}>
                    {isLoadingPrice ? (
                      <Spinner animation="border" size="sm" className="me-2" />
                    ) : priceLoadError ? (
                      <div className="text-danger">{priceLoadError}</div>
                    ) : (
                      <span>{getPriceDisplay()}</span>
                    )}
                  </div>
                </Form.Group>
              </Col>
            </Row>

            {/* Price Range Section - Only show for new positions */}
            {!isExistingPosition && (
              <>
                <h6 className="border-bottom pb-2 mt-4 mb-3">Price Range</h6>

                <Row className="mb-3">
                  <Col md={12}>
                    <Form.Group className="mb-3">
                      <div className="d-flex justify-content-between">
                        <div className="mb-2">
                          <Form.Check
                            inline
                            type="radio"
                            id="range-narrow"
                            label="Narrow (±2.5%)"
                            name="rangeType"
                            value="narrow"
                            checked={rangeType === 'narrow'}
                            onChange={() => handleRangeTypeChange('narrow')}
                            disabled={isProcessingOperation}
                          />
                          <Form.Check
                            inline
                            type="radio"
                            id="range-medium"
                            label="Medium (±5%)"
                            name="rangeType"
                            value="medium"
                            checked={rangeType === 'medium'}
                            onChange={() => handleRangeTypeChange('medium')}
                            disabled={isProcessingOperation}
                          />
                          <Form.Check
                            inline
                            type="radio"
                            id="range-wide"
                            label="Wide (±10%)"
                            name="rangeType"
                            value="wide"
                            checked={rangeType === 'wide'}
                            onChange={() => handleRangeTypeChange('wide')}
                            disabled={isProcessingOperation}
                          />
                          <Form.Check
                            inline
                            type="radio"
                            id="range-custom"
                            label="Custom"
                            name="rangeType"
                            value="custom"
                            checked={rangeType === 'custom'}
                            onChange={() => handleRangeTypeChange('custom')}
                            disabled={isProcessingOperation}
                          />
                        </div>
                      </div>

                      {rangeType === 'custom' && (
                        <Row>
                          <Col md={6}>
                            <Form.Group className="mb-2">
                              <Form.Label className="small">Min Price</Form.Label>
                              <Form.Control
                                type="number"
                                placeholder="Min Price"
                                value={customMinInput}
                                onChange={(e) => handleCustomMinPrice(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'e' || e.key === 'E' || e.key === '+' || e.key === '-') {
                                    e.preventDefault();
                                  }
                                }}
                                onWheel={(e) => e.target.blur()}
                                step="any"
                                disabled={isProcessingOperation}
                                size="sm"
                                className="no-number-spinner"
                              />
                            </Form.Group>
                          </Col>
                          <Col md={6}>
                            <Form.Group className="mb-2">
                              <Form.Label className="small">Max Price</Form.Label>
                              <Form.Control
                                type="number"
                                placeholder="Max Price"
                                value={customMaxInput}
                                onChange={(e) => handleCustomMaxPrice(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'e' || e.key === 'E' || e.key === '+' || e.key === '-') {
                                    e.preventDefault();
                                  }
                                }}
                                onWheel={(e) => e.target.blur()}
                                step="any"
                                disabled={isProcessingOperation}
                                size="sm"
                                className="no-number-spinner"
                              />
                            </Form.Group>
                          </Col>
                        </Row>
                      )}

                      {/* Display the selected price range */}
                      <div className="p-2 mt-2 rounded" style={{ border: '1px solid var(--neutral-700)', backgroundColor: '#e9ecef', fontSize: '0.9em' }}>
                        <strong>
                          {formatTickToPrice(priceRange.min)} - {formatTickToPrice(priceRange.max)}
                        </strong>
                        {/* Price direction matches getPriceDisplay() logic:
                            - tokensSwapped=true: base price is "token0 per token1"
                            - tokensSwapped=false: base price is "token1 per token0"
                            - invertPriceDisplay flips whichever one is shown */}
                        {invertPriceDisplay ?
                          (tokensSwapped ?
                            <> {token1Symbol} per {token0Symbol}</> :
                            <> {token0Symbol} per {token1Symbol}</>) :
                          (tokensSwapped ?
                            <> {token0Symbol} per {token1Symbol}</> :
                            <> {token1Symbol} per {token0Symbol}</>)
                        }
                      </div>
                    </Form.Group>
                  </Col>
                </Row>

                {/* Out of Range Warning */}
                {!isExistingPosition && priceRange.current !== null && priceRange.min !== null && priceRange.max !== null && !isPriceInRange() && (
                  <Alert variant="warning" className="mt-3 mb-0">
                    <strong>Out of Range Position:</strong> The current market price is outside your selected price range. Your position will not earn fees until the price moves back into your specified range. Consider adjusting your range to include the current price if you want to start earning fees immediately.
                  </Alert>
                )}
              </>
            )}

            {/* Token Amounts Section */}
            <h6 className="border-bottom pb-2 mt-5 mb-3" style={{ fontSize: '0.9em' }}>Add Liquidity</h6>

            <Row className="mb-4">
              <Col md={12}>
                <Form.Group className="mb-3">
                  <Form.Label className="mb-0" style={{ fontSize: '0.9em' }}>{token0Symbol} Amount</Form.Label>
                  {token0Balance && (
                    <div className="d-flex justify-content-between align-items-center mb-1">
                      <small style={{ color: 'var(--neutral-600)', fontSize: '0.75em' }}>
                        {token0Balance.isNative ? (
                          <>Balance: {parseFloat(token0Balance.native).toFixed(4)}{parseFloat(token0Balance.wrapped) > 0 && <> ({parseFloat(token0Balance.wrapped).toFixed(4)} WETH)</>}</>
                        ) : (
                          <>Balance: {parseFloat(token0Balance.total).toFixed(6)}</>
                        )}
                      </small>
                      <Button
                        variant="link"
                        size="sm"
                        className="p-0"
                        style={{ color: 'var(--crimson-700)', fontSize: '0.75em' }}
                        onClick={() => handleToken0AmountChange(token0Balance.total)}
                        disabled={isProcessingOperation}
                      >
                        Max
                      </Button>
                    </div>
                  )}
                  <InputGroup size="sm">
                    <Form.Control
                      type="number"
                      placeholder={`Enter ${token0Symbol} amount`}
                      value={token0Amount}
                      onChange={(e) => handleToken0AmountChange(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'e' || e.key === 'E' || e.key === '+' || e.key === '-') {
                          e.preventDefault();
                        }
                      }}
                      onWheel={(e) => e.target.blur()}
                      step="any"
                      isInvalid={!!token0Error}
                      size="sm"
                      disabled={isProcessingOperation}
                      className="no-number-spinner"
                      style={{ fontSize: '0.9em' }}
                    />
                    <InputGroup.Text style={{ fontSize: '0.9em' }}>{token0Symbol}</InputGroup.Text>
                  </InputGroup>
                  <div className="mt-1 small" style={{ color: 'var(--neutral-600)' }}>
                    ${token0UsdValue !== null ? token0UsdValue.toFixed(2) : '0.00'} USD
                  </div>
                  {token0Error && <Form.Control.Feedback type="invalid">{token0Error}</Form.Control.Feedback>}
                </Form.Group>
              </Col>

              <Col md={12}>
                <Form.Group className="mb-3">
                  <Form.Label className="mb-0" style={{ fontSize: '0.9em' }}>{token1Symbol} Amount</Form.Label>
                  {token1Balance && (
                    <div className="d-flex justify-content-between align-items-center mb-1">
                      <small style={{ color: 'var(--neutral-600)', fontSize: '0.75em' }}>
                        {token1Balance.isNative ? (
                          <>Balance: {parseFloat(token1Balance.native).toFixed(4)}{parseFloat(token1Balance.wrapped) > 0 && <> ({parseFloat(token1Balance.wrapped).toFixed(4)} WETH)</>}</>
                        ) : (
                          <>Balance: {parseFloat(token1Balance.total).toFixed(6)}</>
                        )}
                      </small>
                      <Button
                        variant="link"
                        size="sm"
                        className="p-0"
                        style={{ color: 'var(--crimson-700)', fontSize: '0.75em' }}
                        onClick={() => handleToken1AmountChange(token1Balance.total)}
                        disabled={isProcessingOperation}
                      >
                        Max
                      </Button>
                    </div>
                  )}
                  <InputGroup size="sm">
                    <Form.Control
                      type="number"
                      placeholder={`Enter ${token1Symbol} amount`}
                      value={token1Amount}
                      onChange={(e) => handleToken1AmountChange(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'e' || e.key === 'E' || e.key === '+' || e.key === '-') {
                          e.preventDefault();
                        }
                      }}
                      onWheel={(e) => e.target.blur()}
                      step="any"
                      isInvalid={!!token1Error}
                      size="sm"
                      disabled={isProcessingOperation}
                      className="no-number-spinner"
                      style={{ fontSize: '0.9em' }}
                    />
                    <InputGroup.Text style={{ fontSize: '0.9em' }}>{token1Symbol}</InputGroup.Text>
                  </InputGroup>
                  <div className="mt-1 small" style={{ color: 'var(--neutral-600)' }}>
                    ${token1UsdValue !== null ? token1UsdValue.toFixed(2) : '0.00'} USD
                  </div>
                  {token1Error && <Form.Control.Feedback type="invalid">{token1Error}</Form.Control.Feedback>}
                </Form.Group>
              </Col>
            </Row>

            {/* Slippage Tolerance Section */}
            <div className="mb-5">
              <h6 className="border-bottom pb-2 mt-2">Slippage Tolerance</h6>
              <Form.Group>
                <InputGroup size="sm">
                  <Form.Control
                    type="number"
                    placeholder="Enter slippage tolerance"
                    value={slippageTolerance}
                    onChange={(e) => {
                      setSlippageTolerance(e.target.value);
                      setOperationError(null); // Clear error when typing
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'e' || e.key === 'E' || e.key === '+' || e.key === '-') {
                        e.preventDefault();
                      }
                    }}
                    onWheel={(e) => e.target.blur()}
                    step="any"
                    disabled={isProcessingOperation}
                    className="no-number-spinner"
                  />
                  <InputGroup.Text>%</InputGroup.Text>
                </InputGroup>
              </Form.Group>
            </div>

            {/* Total Value Section */}
            <div className="border-top pt-3 mt-3 mb-3">
              <div className="d-flex justify-content-between">
                <h6 className="mb-0" style={{ color: 'var(--blue-accent)', fontWeight: 'bold' }}>Total Value:</h6>
                <h6 className="mb-0" style={{ color: 'var(--blue-accent)', fontWeight: 'bold' }}>${totalUsdValue !== null ? totalUsdValue.toFixed(2) : '0.00'}</h6>
              </div>
            </div>
          </div>

        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={handleClose} disabled={isProcessingOperation}>
            Cancel
          </Button>
          <Button
            variant="primary"
            type="submit"
            disabled={isProcessingOperation}
          >
            {isProcessingOperation ? (
              <>
                <Spinner
                  as="span"
                  animation="border"
                  size="sm"
                  role="status"
                  aria-hidden="true"
                  className="me-2"
                />
                {isExistingPosition ? "Adding Liquidity..." : "Creating Position..."}
              </>
            ) : (
              isExistingPosition ? "Add Liquidity" : "Create Position"
            )}
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>

    {/* Transaction Progress Modal */}
    <TransactionProgressModal
      show={showTransactionModal}
      onHide={() => {
        setShowTransactionModal(false);
        if (currentTxStep >= transactionSteps.length) {
          handleClose();
        }
      }}
      currentStep={currentTxStep}
      steps={transactionSteps}
      isLoading={isAddingLiquidity}
      error={transactionError}
      warning={transactionWarning}
      tokenSymbols={[token0Data?.symbol || 'Token0', token1Data?.symbol || 'Token1']}
      onCancel={() => {
        if (!isAddingLiquidity) {
          setShowTransactionModal(false);
          setTransactionError('');
        }
      }}
      title={isExistingPosition ?
        `Add Liquidity: ${token0Data?.symbol}/${token1Data?.symbol}` :
        `Create Position: ${token0Data?.symbol || 'Token0'}/${token1Data?.symbol || 'Token1'}`
      }
    />
  </>
  );
}
