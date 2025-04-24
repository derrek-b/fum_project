import React, { useState, useEffect, useMemo } from 'react';
import { Modal, Button, Form, Row, Col, Alert, Spinner, Badge, InputGroup } from 'react-bootstrap';
import { useSelector, useDispatch } from 'react-redux';
import '../../adapters/index.js';
import '../../utils/formatHelpers.js';
import '../../utils/coingeckoUtils.js';
import { ethers } from 'ethers';
import '../../context/ToastContext.js';
import '../../redux/updateSlice.js';

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
  const { address, chainId, provider } = useSelector(state => state.wallet);

  // Get auto-refresh state to manage pausing during liquidity addition
  const { autoRefresh } = useSelector(state => state.updates);
  const { supportedPlatforms } = useSelector(state => state.platforms);

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

  // Token ordering state
  const [tokensSwapped, setTokensSwapped] = useState(false);

  // Get adapter for the selected platform
  const adapter = useMemo(() => {
    if (!provider || !selectedPlatform) return null;
    try {
      return AdapterFactory.getAdapter(selectedPlatform, provider);
    } catch (error) {
      console.error(`Failed to get adapter for platform ${selectedPlatform}:`, error);
      showError(`Failed to initialize ${selectedPlatform} adapter. Please try a different platform.`);
      return null;
    }
  }, [selectedPlatform, provider, showError]);

  // Calculate USD values if token prices are available
  const token0UsdValue = useMemo(() => {
    if (!token0Amount || !tokenPrices?.token0) return null;
    try {
      return calculateUsdValue(token0Amount, tokenPrices.token0);
    } catch (error) {
      console.error("Error calculating USD value:", error);
      return null;
    }
  }, [token0Amount, tokenPrices]);

  const token1UsdValue = useMemo(() => {
    if (!token1Amount || !tokenPrices?.token1) return null;
    try {
      return calculateUsdValue(token1Amount, tokenPrices.token1);
    } catch (error) {
      console.error("Error calculating USD value:", error);
      return null;
    }
  }, [token1Amount, tokenPrices]);

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
    setToken0Balance(null);
    setToken1Balance(null);
    setToken0Error(null);
    setToken1Error(null);
    setCurrentPoolPrice(null);
    setPriceLoadError(null);
    setIsLoadingPrice(false);
    setTokensSwapped(false);
    setInvertPriceDisplay(false);

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
    if (show && !isExistingPosition) {
      try {
        // In a real implementation, we would fetch common tokens from a service
        // For now, let's use a hardcoded list
        setCommonTokens([
          { address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', symbol: 'WETH', name: 'Wrapped Ether', decimals: 18 },
          { address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', symbol: 'USDC', name: 'USD Coin', decimals: 6 },
          { address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', symbol: 'USDT', name: 'Tether USD', decimals: 6 },
          { address: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1', symbol: 'DAI', name: 'Dai Stablecoin', decimals: 18 },
          { address: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f', symbol: 'WBTC', name: 'Wrapped Bitcoin', decimals: 8 }
        ]);
      } catch (error) {
        console.error("Error loading token list:", error);
        showError("Failed to load available tokens. Please try again later.");
      }
    }
  }, [show, isExistingPosition, showError]);

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

        // Set fee tier
        setSelectedFeeTier(position.fee);

        // Set platform
        setSelectedPlatform(position.platform);

        // Set token addresses
        if (token0Data.address) {
          setToken0Address(token0Data.address);
        }

        if (token1Data.address) {
          setToken1Address(token1Data.address);
        }

        // Get token balances
        if (token0Data.address && token1Data.address && provider && address) {
          fetchTokenBalances(token0Data.address, token1Data.address);
        }

        // Calculate current price for existing position
        if (poolData.sqrtPriceX96 && adapter) {
          try {
            const calculatedPrice = adapter._calculatePriceFromSqrtPrice(
              poolData.sqrtPriceX96,
              token0Data.decimals,
              token1Data.decimals
            );
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
  }, [isExistingPosition, position, poolData, token0Data, token1Data, address, provider, adapter, showError]);

  // Fetch token balances when token addresses change
  useEffect(() => {
    if (!isExistingPosition && token0Address && token1Address && provider && address) {
      fetchTokenBalances(token0Address, token1Address);
    }
  }, [token0Address, token1Address, provider, address, isExistingPosition]);

  // Load pool price when both tokens and fee tier are selected
  useEffect(() => {
    // Only attempt to fetch pool price when we have all necessary data
    // This prevents errors when user is mid-selection
    if (!isExistingPosition &&
        token0Address && token0Address !== "" &&
        token1Address && token1Address !== "" &&
        selectedFeeTier && provider && adapter) {
      fetchPoolPrice();
    }
  }, [token0Address, token1Address, selectedFeeTier, provider, adapter, isExistingPosition]);

  // Calculate paired token amount when token0 amount changes
  useEffect(() => {
    if (!token0Amount || token0Amount === '0' || !currentPoolPrice) {
      return;
    }

    try {
      const amount0 = parseFloat(token0Amount);
      const price = parseFloat(currentPoolPrice);

      if (isNaN(amount0) || isNaN(price) || price === 0) {
        return;
      }

      // If tokens were swapped in sorting, we need to adjust the calculation
      const calculatedAmount1 = tokensSwapped
        ? amount0 / price
        : amount0 * price;

      setToken1Amount(calculatedAmount1.toFixed(6));
    } catch (error) {
      console.error("Error calculating paired amount:", error);
      setToken1Error("Failed to calculate paired amount");
    }
  }, [token0Amount, currentPoolPrice, tokensSwapped]);

  // Handle token0 amount change with token1 calculation
  const handleToken0AmountChange = (value) => {
    setToken0Amount(value);
    setToken0Error(null);

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

      setToken1Amount(calculatedAmount1.toFixed(6));
    } catch (error) {
      console.error("Error calculating paired amount:", error);
      setToken1Error("Failed to calculate paired amount");
    }
  };

  // Handle token1 amount change with token0 calculation
  const handleToken1AmountChange = (value) => {
    setToken1Amount(value);
    setToken1Error(null);

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

      setToken0Amount(calculatedAmount0.toFixed(6));
    } catch (error) {
      console.error("Error calculating paired amount:", error);
      setToken0Error("Failed to calculate paired amount");
    }
  };

  // Fetch token balances for user
  const fetchTokenBalances = async (address0, address1) => {
    if (!provider || !address) {
      console.error("Provider or address missing");
      return;
    }

    try {
      // Create minimal ERC20 ABI for balanceOf
      const erc20ABI = [
        'function balanceOf(address owner) view returns (uint256)',
        'function decimals() view returns (uint8)'
      ];

      // Create contract instances
      const token0Contract = new ethers.Contract(address0, erc20ABI, provider);
      const token1Contract = new ethers.Contract(address1, erc20ABI, provider);

      // Get balances and decimals
      const [balance0, balance1] = await Promise.all([
        token0Contract.balanceOf(address),
        token1Contract.balanceOf(address)
      ]);

      // Get token details
      const getTokenDetail = (address) => {
        if (isExistingPosition) {
          if (address === token0Data.address) return token0Data;
          if (address === token1Data.address) return token1Data;
        } else {
          return commonTokens.find(t => t.address === address);
        }
        return null;
      };

      const token0Detail = getTokenDetail(address0);
      const token1Detail = getTokenDetail(address1);

      if (!token0Detail || !token1Detail) {
        throw new Error("Token details not found");
      }

      // Format balances with proper decimals
      const formattedBalance0 = ethers.formatUnits(balance0, token0Detail.decimals);
      const formattedBalance1 = ethers.formatUnits(balance1, token1Detail.decimals);

      // Update state
      setToken0Balance(formattedBalance0);
      setToken1Balance(formattedBalance1);
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
    if (!token0Address || !token1Address || !selectedFeeTier || !provider || !adapter) {
      return;
    }

    setIsLoadingPrice(true);
    setPriceLoadError(null);

    try {
      // Get the current token data
      const token0Info = commonTokens.find(t => t.address === token0Address);
      const token1Info = commonTokens.find(t => t.address === token1Address);

      if (!token0Info || !token1Info) {
        throw new Error("Token information not found");
      }

      // Create a helper function to get pool address with properly sorted tokens
      // This would be in the adapter in a production app
      const getPoolAddressWithSorting = async () => {
        try {
          // Use the Uniswap SDK to calculate pool address with properly sorted tokens
          import { Pool } from '@uniswap/v3-sdk';
          import { Token } from '@uniswap/sdk-core';

          // Sort tokens according to Uniswap V3 rules (lexicographically by address)
          let sortedToken0, sortedToken1;
          const shouldSwap = token0Address.toLowerCase() > token1Address.toLowerCase();

          if (shouldSwap) {
            sortedToken0 = token1Info;
            sortedToken1 = token0Info;
          } else {
            sortedToken0 = token0Info;
            sortedToken1 = token1Info;
          }

          // Get chainId from provider
          const network = await provider.getNetwork();
          const chainId = Number(network.chainId);

          if (!chainId) {
            throw new Error("Could not determine chainId from provider");
          }

          const sdkToken0 = new Token(
            chainId,
            sortedToken0.address,
            sortedToken0.decimals,
            sortedToken0.symbol || "",
            sortedToken0.name || ""
          );

          const sdkToken1 = new Token(
            chainId,
            sortedToken1.address,
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

      // Create a minimal pool contract to get the current price
      const poolABI = [
        'function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)'
      ];

      const poolContract = new ethers.Contract(poolAddress, poolABI, provider);

      try {
        // Try to get the pool data
        const slot0 = await poolContract.slot0();

        // Extract tick value
        const tickValue = typeof slot0.tick === 'bigint' ? Number(slot0.tick) : Number(slot0.tick);

        // Use adapter to calculate price
        const price = adapter._calculatePriceFromSqrtPrice(
          slot0.sqrtPriceX96,
          sortedToken0.decimals,
          sortedToken1.decimals
        );

        // Update state with current price and tick
        setCurrentPoolPrice(price);
        setPriceRange(prev => ({
          ...prev,
          current: tickValue
        }));

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

    // Reset token amounts when changing tokens
    setToken0Amount('');
    setToken1Amount('');
    setCurrentPoolPrice(null);
    setPriceLoadError(null);
  };

  // Handle price range selection for new positions
  const handleRangeTypeChange = (type, currentTickOverride = null) => {
    setRangeType(type);

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
          // Default to medium if switching to custom without existing values
          if (priceRange.min === null || priceRange.max === null) {
            tickSpacing = Math.ceil(Math.log(1.05) / Math.log(1.0001));
          } else {
            // Keep existing custom values
            return;
          }
          break;
        default:
          console.error(`Unexpected range type: ${type}`);
          return;
      }

      // Calculate min and max ticks
      const minTick = Math.floor(currentTick - tickSpacing);
      const maxTick = Math.ceil(currentTick + tickSpacing);

      // Verify calculations by converting ticks back to prices
      if (adapter && token0Address && token1Address) {
        const token0Info = commonTokens.find(t => t.address === token0Address);
        const token1Info = commonTokens.find(t => t.address === token1Address);

        if (token0Info && token1Info) {
          const decimals0 = tokensSwapped ? token1Info.decimals : token0Info.decimals;
          const decimals1 = tokensSwapped ? token0Info.decimals : token1Info.decimals;

          try {
            const lowerPrice = adapter._tickToPrice(minTick, decimals0, decimals1);
            const upperPrice = adapter._tickToPrice(maxTick, decimals0, decimals1);
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
    if (!priceValue || !adapter) {
      return;
    }

    try {
      const price = parseFloat(priceValue);

      if (isNaN(price) || price <= 0) {
        throw new Error("Invalid price value");
      }

      // Convert price to tick
      const tick = Math.log(price) / Math.log(1.0001);
      setPriceRange({
        ...priceRange,
        min: Math.floor(tick)
      });
    } catch (error) {
      console.error("Error setting custom min price:", error);
      showError("Invalid minimum price value. Please enter a positive number.");
    }
  };

  const handleCustomMaxPrice = (priceValue) => {
    if (!priceValue || !adapter) {
      return;
    }

    try {
      const price = parseFloat(priceValue);

      if (isNaN(price) || price <= 0) {
        throw new Error("Invalid price value");
      }

      // Convert price to tick
      const tick = Math.log(price) / Math.log(1.0001);
      setPriceRange({
        ...priceRange,
        max: Math.ceil(tick)
      });
    } catch (error) {
      console.error("Error setting custom max price:", error);
      showError("Invalid maximum price value. Please enter a positive number.");
    }
  };

  // Function to add liquidity to an existing position
  const addLiquidity = async (params) => {
    if (!adapter) {
      throw new Error("No adapter available for this position");
    }

    setIsAddingLiquidity(true);
    setOperationError(null);

    try {
      await adapter.addLiquidity({
        position: params.position,
        token0Amount: params.token0Amount,
        token1Amount: params.token1Amount,
        slippageTolerance: params.slippageTolerance,
        provider,
        address,
        chainId,
        poolData,
        token0Data,
        token1Data,
        dispatch,
        onStart: () => setIsAddingLiquidity(true),
        onFinish: () => setIsAddingLiquidity(false),
        onSuccess: (result) => {
          // Show success toast with transaction hash if available
          const txHash = result?.tx?.hash;
          showSuccess("Successfully added liquidity!", txHash);
          handleClose();
          dispatch(triggerUpdate()); // Refresh data
        },
        onError: (errorMessage) => {
          setOperationError(errorMessage);
          showError(errorMessage);
          setIsAddingLiquidity(false);
        }
      });
    } catch (error) {
      console.error("Error adding liquidity:", error);
      setOperationError(`Error adding liquidity: ${error.message}`);
      showError(`Error adding liquidity: ${error.message}`);
      setIsAddingLiquidity(false);
    }
  };

  // Function to create a new position
  const createPosition = async (params) => {
    if (!adapter) {
      throw new Error(`No adapter available for platform: ${params.platformId}`);
    }

    setIsCreatingPosition(true);
    setOperationError(null);

    try {
      await adapter.createPosition({
        ...params,
        provider,
        address,
        chainId,
        dispatch,
        onStart: () => setIsCreatingPosition(true),
        onFinish: () => setIsCreatingPosition(false),
        onSuccess: (result) => {
          showSuccess(`Successfully created new ${params.platformId} position!`, result?.txHash);
          handleClose();
          dispatch(triggerUpdate()); // Refresh to show new position
        },
        onError: (errorMessage) => {
          setOperationError(`Failed to create position: ${errorMessage}`);
          showError(`Failed to create position: ${errorMessage}`);
          setIsCreatingPosition(false);
        }
      });
    } catch (error) {
      console.error("Error creating position:", error);
      setOperationError(`Error creating position: ${error.message}`);
      showError(`Error creating position: ${error.message}`);
      setIsCreatingPosition(false);
    }
  };

  // Handle submission - now directly calls adapter methods
  const handleSubmit = (e) => {
    e.preventDefault();

    try {
      // No need to pause auto-refresh here since we've already done it when the modal opened
      if (isExistingPosition) {
        // Validate inputs for adding liquidity
        if (!token0Amount && !token1Amount) {
          throw new Error("Please enter at least one token amount");
        }

        if (token0Amount && parseFloat(token0Amount) <= 0) {
          throw new Error("Token amount must be greater than zero");
        }

        if (token1Amount && parseFloat(token1Amount) <= 0) {
          throw new Error("Token amount must be greater than zero");
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
          throw new Error("Please select both tokens");
        }

        if (priceRange.min === null || priceRange.max === null) {
          throw new Error("Please set a price range");
        }

        if (!token0Amount && !token1Amount) {
          throw new Error("Please enter at least one token amount");
        }

        if (token0Amount && parseFloat(token0Amount) <= 0) {
          throw new Error("Token amount must be greater than zero");
        }

        if (token1Amount && parseFloat(token1Amount) <= 0) {
          throw new Error("Token amount must be greater than zero");
        }

        // Create new position - direct adapter call
        createPosition({
          platformId: selectedPlatform,
          token0Address,
          token1Address,
          feeTier: selectedFeeTier,
          tickLower: priceRange.min,
          tickUpper: priceRange.max,
          token0Amount,
          token1Amount,
          slippageTolerance,
          tokensSwapped, // Pass this so the handler knows if tokens need to be swapped
          invertPriceDisplay // Pass the user's preference for price display
        });
      }
    } catch (error) {
      console.error("Error submitting form:", error);
      setOperationError(error.message || "Failed to submit. Please check your inputs and try again.");
      showError(error.message || "Failed to submit. Please check your inputs and try again.");
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
      const getTokenDecimals = () => {
        if (isExistingPosition) {
          if (!token0Data?.decimals || !token1Data?.decimals) {
            return { token0Decimals: null, token1Decimals: null };
          }
          return {
            token0Decimals: token0Data.decimals,
            token1Decimals: token1Data.decimals
          };
        } else {
          const token0 = commonTokens.find(t => t.address === token0Address);
          const token1 = commonTokens.find(t => t.address === token1Address);

          if (!token0?.decimals || !token1?.decimals) {
            return { token0Decimals: null, token1Decimals: null };
          }

          return { token0Decimals: token0.decimals, token1Decimals: token1.decimals };
        }
      };

      // Get token decimals
      const { token0Decimals, token1Decimals } = getTokenDecimals();
      if (token0Decimals === null || token1Decimals === null) {
        return 'N/A';
      }

      // Use adapter's tick to price function
      // If tokens are swapped from user perspective, we need to swap the decimals
      const decimals0 = tokensSwapped ? token1Decimals : token0Decimals;
      const decimals1 = tokensSwapped ? token0Decimals : token1Decimals;

      // Get the base price
      let price;
      try {
        price = adapter._tickToPrice(tick, decimals0, decimals1);
      } catch (adapterError) {
        console.error("Error in adapter._tickToPrice:", adapterError);
        return 'N/A';
      }

      // Invert if requested by user
      if (invertPriceDisplay) {
        const numPrice = parseFloat(price);
        if (numPrice > 0) {
          price = (1 / numPrice).toString();
        }
      }

      // Format for display
      const numPrice = parseFloat(price);
      if (isNaN(numPrice)) {
        return 'N/A';
      }

      if (numPrice < 0.0001 && numPrice > 0) {
        return numPrice.toExponential(4);
      }

      return formatPrice(numPrice);
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

      // Invert the price if requested by user
      const displayPrice = invertPriceDisplay ? 1 / price : price;

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

  // Get token symbols safely
  const getToken0Symbol = () => {
    if (isExistingPosition) {
      return token0Data?.symbol || "Token0";
    } else {
      const token = commonTokens.find(t => t.address === token0Address);
      return token?.symbol || "Token0";
    }
  };

  const getToken1Symbol = () => {
    if (isExistingPosition) {
      return token1Data?.symbol || "Token1";
    } else {
      const token = commonTokens.find(t => t.address === token1Address);
      return token?.symbol || "Token1";
    }
  };

  const token0Symbol = getToken0Symbol();
  const token1Symbol = getToken1Symbol();

  // Get correct display price direction
  const getPriceDisplay = () => {
    // Base display determined by token order and whether they were swapped for Uniswap
    let baseDisplay;

    // For existing positions, respect the token order from the position
    if (isExistingPosition) {
      baseDisplay = `${displayCurrentPrice} ${token1Symbol} per ${token0Symbol}`;
    } else {
      // For new positions, if tokens were swapped for Uniswap order, we need to adjust the display
      if (tokensSwapped) {
        baseDisplay = `${displayCurrentPrice} ${token0Symbol} per ${token1Symbol}`;
      } else {
        baseDisplay = `${displayCurrentPrice} ${token1Symbol} per ${token0Symbol}`;
      }
    }

    // If user manually flipped the price display, invert it
    if (invertPriceDisplay) {
      // Swap the token symbols in the display
      return baseDisplay.includes(`${token1Symbol} per ${token0Symbol}`) ?
        `${displayCurrentPrice} ${token0Symbol} per ${token1Symbol}` :
        `${displayCurrentPrice} ${token1Symbol} per ${token0Symbol}`;
    }

    return baseDisplay;
  };

  // Check if price is in range
  const isPriceInRange = () => {
    if (isExistingPosition) {
      return poolData?.tick >= position?.tickLower && poolData?.tick <= position?.tickUpper;
    } else {
      return priceRange.current >= priceRange.min && priceRange.current <= priceRange.max;
    }
  };

  return (
    <Modal
      show={show}
      onHide={handleClose}
      centered
      backdrop="static"
      keyboard={false}
      size="lg"
      data-no-propagation="true"
    >
      <Form onSubmit={handleSubmit}>
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
          <div className="mb-4">
            {/* Platform and Token Selection Section */}
            <h6 className="border-bottom pb-2 mb-3">Token Selection</h6>

            <Row className="mb-3">
              <Col md={4}>
                <Form.Group>
                  <Form.Label>Platform</Form.Label>
                  <Form.Select
                    value={selectedPlatform}
                    onChange={(e) => setSelectedPlatform(e.target.value)}
                    disabled={isExistingPosition || isProcessingOperation}
                    required
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
                  <Form.Label>Token 0</Form.Label>
                  <Form.Select
                    value={token0Address}
                    onChange={(e) => handleToken0Selection(e.target.value)}
                    disabled={isExistingPosition || isProcessingOperation}
                    required
                  >
                    {isExistingPosition ? (
                      <option value={token0Data?.address}>{token0Data?.symbol}</option>
                    ) : (
                      <>
                        <option value="">Select Token 0</option>
                        {commonTokens.map(token => (
                          <option key={token.address} value={token.address}>
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
                  <Form.Label>Token 1</Form.Label>
                  <Form.Select
                    value={token1Address}
                    onChange={(e) => handleToken1Selection(e.target.value)}
                    disabled={isExistingPosition || !token0Address || isProcessingOperation}
                    required
                  >
                    {isExistingPosition ? (
                      <option value={token1Data?.address}>{token1Data?.symbol}</option>
                    ) : (
                      <>
                        <option value="">Select Token 1</option>
                        {commonTokens
                          .filter(token => token.address !== token0Address)
                          .map(token => (
                            <option key={token.address} value={token.address}>
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
                  <Form.Label>Fee Tier</Form.Label>
                  <Form.Select
                    value={selectedFeeTier}
                    onChange={(e) => setSelectedFeeTier(parseInt(e.target.value))}
                    disabled={isExistingPosition || isProcessingOperation}
                    required
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
                <div className="bg-light p-2 rounded h-100 d-flex align-items-center justify-content-center">
                  <span className="text-center">
                    <div className="text-muted small mb-1">
                      Current Price:
                      <Button
                        variant="link"
                        className="p-0 ms-2"
                        size="sm"
                        onClick={() => setInvertPriceDisplay(!invertPriceDisplay)}
                        title="Switch price direction"
                        disabled={isLoadingPrice || !!priceLoadError || isProcessingOperation}
                      >
                        <span role="img" aria-label="switch">⇄</span>
                      </Button>
                    </div>
                    {isLoadingPrice ? (
                      <Spinner animation="border" size="sm" className="me-2" />
                    ) : priceLoadError ? (
                      <div className="text-danger">{priceLoadError}</div>
                    ) : (
                      <strong>{getPriceDisplay()}</strong>
                    )}
                  </span>
                </div>
              </Col>
            </Row>

            {/* Price Range Section */}
            <h6 className="border-bottom pb-2 mt-4 mb-3">Price Range</h6>

            <Row className="mb-3">
              <Col md={12}>
                <Form.Group className="mb-3">
                  <div className="d-flex justify-content-between">
                    <Form.Label>Range Type</Form.Label>
                    {!isExistingPosition && (
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
                          disabled={isExistingPosition || isProcessingOperation}
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
                          disabled={isExistingPosition || isProcessingOperation}
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
                          disabled={isExistingPosition || isProcessingOperation}
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
                          disabled={isExistingPosition || isProcessingOperation}
                        />
                      </div>
                    )}
                  </div>

                  {!isExistingPosition && rangeType === 'custom' && (
                    <Row>
                      <Col md={6}>
                        <Form.Group className="mb-2">
                          <Form.Label className="small">Min Price</Form.Label>
                          <Form.Control
                            type="number"
                            placeholder="Min Price"
                            value={priceRange.min !== null ? formatTickToPrice(priceRange.min) : ''}
                            onChange={(e) => handleCustomMinPrice(e.target.value)}
                            required
                            min="0"
                            step="any"
                            disabled={isExistingPosition || isProcessingOperation}
                            size="sm"
                          />
                        </Form.Group>
                      </Col>
                      <Col md={6}>
                        <Form.Group className="mb-2">
                          <Form.Label className="small">Max Price</Form.Label>
                          <Form.Control
                            type="number"
                            placeholder="Max Price"
                            value={priceRange.max !== null ? formatTickToPrice(priceRange.max) : ''}
                            onChange={(e) => handleCustomMaxPrice(e.target.value)}
                            required
                            min="0"
                            step="any"
                            disabled={isExistingPosition || isProcessingOperation}
                            size="sm"
                          />
                        </Form.Group>
                      </Col>
                    </Row>
                  )}

                  {/* Display the selected price range */}
                  <div className="p-2 mt-2 border rounded bg-light">
                    <Row>
                      <Col md={7}>
                        <small className="text-muted">
                          Price Range:
                          <Button
                            variant="link"
                            className="p-0 ms-2"
                            size="sm"
                            onClick={() => setInvertPriceDisplay(!invertPriceDisplay)}
                            title="Switch price direction"
                            disabled={isProcessingOperation}
                          >
                            <span role="img" aria-label="switch">⇄</span>
                          </Button>
                        </small>
                        <div>
                          <strong>
                            {formatTickToPrice(isExistingPosition ? position?.tickLower : priceRange.min)} - {formatTickToPrice(isExistingPosition ? position?.tickUpper : priceRange.max)}
                          </strong>
                          {isExistingPosition ? (
                            invertPriceDisplay ?
                              <> {token0Symbol} per {token1Symbol}</> :
                              <> {token1Symbol} per {token0Symbol}</>
                          ) : (
                            invertPriceDisplay ?
                              (tokensSwapped ?
                                <> {token1Symbol} per {token0Symbol}</> :
                                <> {token0Symbol} per {token1Symbol}</>) :
                              (tokensSwapped ?
                                <> {token0Symbol} per {token1Symbol}</> :
                                <> {token1Symbol} per {token0Symbol}</>)
                          )}
                        </div>
                      </Col>
                      <Col md={5} className="text-end">
                        {/* Show if price is in range */}
                        {(isExistingPosition ? poolData?.tick : priceRange.current) !== null && (
                          <Badge bg={isPriceInRange() ? "success" : "danger"}>
                            {isExistingPosition
                              ? (isPriceInRange() ? "In Range" : "Out of Range")
                              : (isPriceInRange() ? "Will Be In Range" : "Will Be Out of Range")
                            }
                          </Badge>
                        )}
                      </Col>
                    </Row>
                  </div>
                </Form.Group>
              </Col>
            </Row>

            {/* Token Amounts Section */}
            <h6 className="border-bottom pb-2 mt-4 mb-3">Add Liquidity</h6>

            <Row className="mb-3">
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label>{token0Symbol} Amount</Form.Label>
                  {token0Balance && (
                    <div className="d-flex justify-content-between align-items-center mb-1">
                      <small className="text-muted">
                        Balance: {parseFloat(token0Balance).toFixed(6)} {token0Symbol}
                      </small>
                      <Button
                        variant="link"
                        size="sm"
                        className="p-0"
                        onClick={() => handleToken0AmountChange(token0Balance)}
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
                      min="0"
                      step="any"
                      isInvalid={!!token0Error}
                      size="sm"
                      disabled={isProcessingOperation}
                    />
                    <InputGroup.Text>{token0Symbol}</InputGroup.Text>
                  </InputGroup>
                  {token0UsdValue !== null && (
                    <div className="mt-1 text-muted small">
                      ≈ ${token0UsdValue.toFixed(2)} USD
                    </div>
                  )}
                  {token0Error && <Form.Control.Feedback type="invalid">{token0Error}</Form.Control.Feedback>}
                </Form.Group>
              </Col>

              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label>{token1Symbol} Amount</Form.Label>
                  {token1Balance && (
                    <div className="d-flex justify-content-between align-items-center mb-1">
                      <small className="text-muted">
                        Balance: {parseFloat(token1Balance).toFixed(6)} {token1Symbol}
                      </small>
                      <Button
                        variant="link"
                        size="sm"
                        className="p-0"
                        onClick={() => handleToken1AmountChange(token1Balance)}
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
                      min="0"
                      step="any"
                      isInvalid={!!token1Error}
                      size="sm"
                      disabled={isProcessingOperation}
                    />
                    <InputGroup.Text>{token1Symbol}</InputGroup.Text>
                  </InputGroup>
                  {token1UsdValue !== null && (
                    <div className="mt-1 text-muted small">
                      ≈ ${token1UsdValue.toFixed(2)} USD
                    </div>
                  )}
                  {token1Error && <Form.Control.Feedback type="invalid">{token1Error}</Form.Control.Feedback>}
                </Form.Group>
              </Col>
            </Row>

            <Row className="mb-3">
              <Col md={6}>
                <Form.Group>
                  <Form.Label>Slippage Tolerance</Form.Label>
                  <InputGroup size="sm">
                    <Form.Control
                      type="number"
                      placeholder="Enter slippage tolerance"
                      value={slippageTolerance}
                      onChange={(e) => setSlippageTolerance(e.target.value)}
                      required
                      min="0.1"
                      max="5"
                      step="0.1"
                      size="sm"
                      disabled={isProcessingOperation}
                    />
                    <InputGroup.Text>%</InputGroup.Text>
                  </InputGroup>
                  <Form.Text className="text-muted small">
                    Maximum allowed price change during transaction
                  </Form.Text>
                </Form.Group>
              </Col>

              <Col md={6} className="d-flex align-items-end justify-content-end">
                {totalUsdValue !== null && (
                  <div className="text-end mb-2">
                    <small className="text-muted d-block">Total Value:</small>
                    <span className="fw-bold">${totalUsdValue.toFixed(2)} USD</span>
                  </div>
                )}
              </Col>
            </Row>
          </div>

          {/* Operation error message */}
          {operationError && (
            <Alert variant="danger" className="mt-3 mb-0 py-2">
              {operationError}
            </Alert>
          )}

          {/* Passed error message (legacy support) */}
          {errorMessage && !operationError && (
            <Alert variant="danger" className="mt-3 mb-0 py-2">
              {errorMessage}
            </Alert>
          )}

          {priceLoadError && (
            <Alert variant="warning" className="mt-3 mb-0 py-2">
              {priceLoadError}
            </Alert>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={handleClose} disabled={isProcessingOperation}>
            Cancel
          </Button>
          <Button
            variant="primary"
            type="submit"
            disabled={isProcessingOperation ||
              (!token0Amount && !token1Amount) ||
              (isExistingPosition ? false : (!token0Address || !token1Address || priceRange.min === null || priceRange.max === null))}
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
  );
}
