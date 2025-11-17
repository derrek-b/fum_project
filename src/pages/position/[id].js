import React, { useState, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/router";
import { useSelector, useDispatch } from "react-redux";
import { ethers } from "ethers";
import { Container, Row, Col, Card, Button, Badge, ProgressBar, Spinner, Alert } from "react-bootstrap";
import { ErrorBoundary } from "react-error-boundary";
import Link from "next/link";
import Head from "next/head";
import PriceRangeChart from "../../components/PriceRangeChart";
import Navbar from "../../components/Navbar";
import RefreshControls from "../../components/RefreshControls";
import AddLiquidityModal from "../../components/positions/AddLiquidityModal";
import RemoveLiquidityModal from "../../components/positions/RemoveLiquidityModal";
import ClosePositionModal from "../../components/positions/ClosePositionModal";
import ClaimFeesModal from "../../components/positions/ClaimFeesModal";
import { triggerUpdate, setResourceUpdating } from "../../redux/updateSlice";
import { setPositions } from "@/redux/positionsSlice";
import { setPools } from "@/redux/poolSlice";
import { setTokens } from "@/redux/tokensSlice";
import { useToast } from "../../context/ToastContext";
import { AdapterFactory } from "fum_library/adapters";
import { useProvider } from '../../contexts/ProviderContext';
import { formatPrice, formatFeeDisplay, getPlatformColor, getPlatformLogo } from "fum_library/helpers";
import { fetchTokenPrices, CACHE_DURATIONS } from "fum_library/services/coingecko";

// Fallback component to show when an error occurs
function ErrorFallback({ error, resetErrorBoundary }) {
  const { showError } = useToast();
  const router = useRouter();

  // Log the error and notify via toast
  React.useEffect(() => {
    console.error("Position detail page error:", error);
    showError("There was a problem loading the position. Please try again.");
  }, [error, showError]);

  return (
    <Alert variant="danger" className="my-4">
      <Alert.Heading>Something went wrong</Alert.Heading>
      <p>
        We encountered an error while loading this position's details. You can try going back to the dashboard or refreshing the page.
      </p>
      <hr />
      <div className="d-flex justify-content-between">
        <Button
          variant="outline-secondary"
          onClick={() => router.push('/')}
        >
          Go to Dashboard
        </Button>
        <Button
          variant="outline-danger"
          onClick={resetErrorBoundary}
        >
          Try again
        </Button>
      </div>
    </Alert>
  );
}

export default function PositionDetailPage() {
  const dispatch = useDispatch();
  const router = useRouter();
  const { showError, showSuccess } = useToast();
  const { id } = router.query;
  const { positions } = useSelector((state) => state.positions);
  const pools = useSelector((state) => state.pools);
  const tokens = useSelector((state) => state.tokens);
  const { isConnected, address, chainId, isReconnecting } = useSelector((state) => state.wallet);
  const { provider } = useProvider();
  const { lastUpdate, resourcesUpdating } = useSelector((state) => state.updates);
  const hasAttemptedFetch = useRef(false);
  const positionsRef = useRef(positions);

  // Keep positionsRef in sync with positions
  useEffect(() => {
    positionsRef.current = positions;
  }, [positions]);

  // State for various UI elements
  const [invertPriceDisplay, setInvertPriceDisplay] = useState(false);
  const [uncollectedFees, setUncollectedFees] = useState(null);
  const [isLoadingFees, setIsLoadingFees] = useState(false);
  const [feeLoadingError, setFeeLoadingError] = useState(false);
  const [tokenBalances, setTokenBalances] = useState(null);
  const [isLoadingBalances, setIsLoadingBalances] = useState(false);
  const [balanceError, setBalanceError] = useState(false);
  const [tokenPrices, setTokenPrices] = useState({
    token0: null,
    token1: null,
    loading: false,
    error: null
  });

  // Track initial data loading to prevent "Position not found" flash
  const [isLoadingInitialData, setIsLoadingInitialData] = useState(false);

  // State for modals
  const [showClaimFeesModal, setShowClaimFeesModal] = useState(false);
  const [showAddLiquidityModal, setShowAddLiquidityModal] = useState(false);
  const [showRemoveLiquidityModal, setShowRemoveLiquidityModal] = useState(false);
  const [showClosePositionModal, setShowClosePositionModal] = useState(false);

  // Find the position by ID
  const position = useMemo(() => {
    if (!positions || !id) {
      return null;
    }
    try {
      return positions.find((p) => p.id === id);
    } catch (error) {
      console.error(`Error finding position with id ${id}:`, error);
      return null;
    }
  }, [positions, id]);

  // Get pool and token data for the position
  const poolData = useMemo(() => {
    return position ? pools[position.pool] : null;
  }, [position, pools]);

  // Token data is embedded in pool data, not stored separately
  const token0Data = useMemo(() => {
    return poolData?.token0 || null;
  }, [poolData]);

  const token1Data = useMemo(() => {
    return poolData?.token1 || null;
  }, [poolData]);

  // Check if any resources are currently updating
  const isUpdating = resourcesUpdating?.positions || false;

  // Get the appropriate adapter for this position
  const adapter = useMemo(() => {
    if (!position?.platform || !provider || !chainId) return null;
    try {
      return AdapterFactory.getAdapter(position.platform, chainId, provider);
    } catch (error) {
      console.error(`Failed to get adapter for position ${id}:`, error);
      return null;
    }
  }, [position?.platform, chainId, provider, id]);

  // Use adapter for position-specific calculations
  const isActive = useMemo(() => {
    if (!adapter || !position || !poolData || typeof poolData.tick !== 'number') return false;
    try {
      return adapter.isPositionInRange(poolData.tick, position.tickLower, position.tickUpper);
    } catch (error) {
      console.error("Error checking if position is in range:", error);
      return false;
    }
  }, [adapter, position, poolData]);

  // Calculate price information using the adapter
  const priceInfo = useMemo(() => {
    if (!adapter || !position || !poolData || !token0Data || !token1Data) {
      return { currentPrice: "N/A", lowerPrice: "N/A", upperPrice: "N/A" };
    }

    try {
      const baseToken = invertPriceDisplay ? token0Data : token1Data;
      const quoteToken = invertPriceDisplay ? token1Data : token0Data;

      const currentPrice = adapter.calculatePriceFromSqrtPrice(
        poolData.sqrtPriceX96,
        baseToken,
        quoteToken
      );
      const lowerPrice = adapter.tickToPrice(
        position.tickLower,
        baseToken,
        quoteToken
      );
      const upperPrice = adapter.tickToPrice(
        position.tickUpper,
        baseToken,
        quoteToken
      );

      return {
        currentPrice: parseFloat(currentPrice.toSignificant(6)),
        lowerPrice: parseFloat(lowerPrice.toSignificant(6)),
        upperPrice: parseFloat(upperPrice.toSignificant(6))
      };
    } catch (error) {
      console.error("Error calculating price:", error);
      return { currentPrice: "N/A", lowerPrice: "N/A", upperPrice: "N/A" };
    }
  }, [adapter, position, poolData, token0Data, token1Data, invertPriceDisplay]);

  // Extract values from priceInfo
  const { currentPrice, lowerPrice, upperPrice } = priceInfo;

  // Set price direction labels
  // When invertPriceDisplay is true: baseToken=token0, quoteToken=token1, price shows token1 per token0
  // When invertPriceDisplay is false: baseToken=token1, quoteToken=token0, price shows token0 per token1
  const priceLabel = token0Data && token1Data ? (
    invertPriceDisplay
      ? `${token1Data.symbol} per ${token0Data.symbol}`
      : `${token0Data.symbol} per ${token1Data.symbol}`
  ) : "";

  // Ensure lower price is always smaller than upper price (they swap when inverting)
  const displayLowerPrice = useMemo(() => {
    if (lowerPrice === "N/A" || upperPrice === "N/A") return "N/A";
    try {
      const result = Math.min(parseFloat(lowerPrice), parseFloat(upperPrice));
      console.log("📊 Display Lower Price:", result, "| Formatted:", formatPrice(result));
      return result;
    } catch (error) {
      console.error("Error calculating display lower price:", error);
      return "N/A";
    }
  }, [lowerPrice, upperPrice]);

  const displayUpperPrice = useMemo(() => {
    if (lowerPrice === "N/A" || upperPrice === "N/A") return "N/A";
    try {
      const result = Math.max(parseFloat(lowerPrice), parseFloat(upperPrice));
      console.log("📊 Display Upper Price:", result, "| Formatted:", formatPrice(result));
      return result;
    } catch (error) {
      console.error("Error calculating display upper price:", error);
      return "N/A";
    }
  }, [lowerPrice, upperPrice]);

  // Calculate position percentage for the progress bar
  const pricePositionPercent = useMemo(() => {
    if (displayLowerPrice === "N/A" || displayUpperPrice === "N/A" || currentPrice === "N/A")
      return 0;

    try {
      const lower = parseFloat(displayLowerPrice);
      const upper = parseFloat(displayUpperPrice);
      const current = parseFloat(currentPrice);

      if (current < lower) return 0;
      if (current > upper) return 100;

      // Handle possible division by zero
      if (upper === lower) return 50;

      return Math.floor(((current - lower) / (upper - lower)) * 100);
    } catch (error) {
      console.error("Error calculating price position percent:", error);
      return 0;
    }
  }, [displayLowerPrice, displayUpperPrice, currentPrice]);

  // Fetch positions on initial load if they're not already in Redux
  useEffect(() => {
    // Only fetch once on mount if positions are missing and we haven't attempted yet
    if (hasAttemptedFetch.current) return;

    if (isConnected && provider && address && chainId && id && (!positions || positions.length === 0)) {
      console.log("📥 Initial load: Fetching positions because Redux is empty");
      hasAttemptedFetch.current = true;
      setIsLoadingInitialData(true); // Set loading state

      const fetchInitialPositions = async () => {
        try {
          // Get all adapters for this chain
          const result = AdapterFactory.getAdaptersForChain(chainId, provider);
          const adapters = result.adapters || [];

          if (adapters.length === 0) {
            showError(`No supported platforms found for this chain`);
            return;
          }

          // Fetch positions from all platforms
          const platformResults = await Promise.all(
            adapters.map(async adapter => {
              try {
                return await adapter.getPositions(address, provider);
              } catch (adapterError) {
                console.error(`Error fetching positions from ${adapter.platformName}:`, adapterError);
                return { positions: {}, poolData: {}, tokenData: {} };
              }
            })
          );

          // Combine results
          let allPositions = [];
          let allPoolData = {};
          let allTokenData = {};

          platformResults.forEach((result) => {
            const positionsArray = result.positions ? Object.values(result.positions) : [];

            if (positionsArray.length > 0) {
              allPositions = [...allPositions, ...positionsArray];

              if (result.poolData) {
                allPoolData = { ...allPoolData, ...result.poolData };
              }

              if (result.tokenData) {
                allTokenData = { ...allTokenData, ...result.tokenData };
              }
            }
          });

          // Mark as wallet positions (not in vault)
          allPositions = allPositions.map(position => ({
            ...position,
            inVault: false,
            vaultAddress: null
          }));

          console.log(`📥 Fetched ${allPositions.length} positions on initial load`);

          // Update Redux
          dispatch(setPositions(allPositions));
          dispatch(setPools(allPoolData));
          dispatch(setTokens(allTokenData));

        } catch (error) {
          console.error("Error fetching initial positions:", error);
          showError(`Failed to load position data: ${error.message}`);
        } finally {
          setIsLoadingInitialData(false); // Clear loading state
        }
      };

      fetchInitialPositions();
    }
  }, [isConnected, provider, address, chainId, id, positions, dispatch, showError]);

  // Mark resources as updating when lastUpdate changes
  useEffect(() => {
    if (id && lastUpdate) {
      try {
        console.log("Position detail update triggered:", new Date().toISOString());

        // Force state resets to trigger recalculations
        setUncollectedFees(null);
        setTokenBalances(null);
        setIsLoadingFees(true);
        setIsLoadingBalances(true);
        setFeeLoadingError(false);
        setBalanceError(false);
        setTokenPrices(prev => ({ ...prev, loading: true, error: null }));

        // Mark resources as updating in Redux
        dispatch(setResourceUpdating({ resource: 'positions', isUpdating: true }));
      } catch (error) {
        console.error("Error marking resources as updating:", error);
      }
    }
  }, [lastUpdate, id, dispatch]);

  // Add this useEffect to position/[id].js
  useEffect(() => {
    // Only run when lastUpdate changes and we have necessary context
    if (lastUpdate && adapter && provider && address && chainId && id) {
      try {
        console.log("Refreshing position data due to lastUpdate change:", new Date(lastUpdate).toISOString());

        // Track the latest refresh timestamp to avoid duplicate refreshes
        const refreshTimestamp = lastUpdate;

        // Fetch fresh data from blockchain
        adapter.getPositions(address, provider).then(result => {
          // Check if this is still the latest refresh (prevents race conditions)
          if (refreshTimestamp !== lastUpdate) return;

          // Find our specific position
          // Convert positions object to array since adapter returns object with IDs as keys
          const positionsArray = result.positions ? Object.values(result.positions) : [];
          const freshPosition = positionsArray.find(p => p.id === id);
          if (freshPosition) {
            // Get fresh pool data
            const freshPoolData = result.poolData[freshPosition.pool];

            // Update Redux with fresh data (without creating reference cycles)
            const currentPositions = positionsRef.current;
            if (currentPositions && currentPositions.length > 0) {
              // Create a new array to avoid reference issues
              const updatedPositions = [...currentPositions];
              // Find and replace the specific position
              const posIndex = updatedPositions.findIndex(p => p.id === id);
              if (posIndex >= 0) {
                updatedPositions[posIndex] = freshPosition;
                dispatch(setPositions(updatedPositions));
              }
            }

            // Update the specific pool (tokens are embedded in pool data)
            if (freshPoolData) {
              dispatch(setPools({ [freshPosition.pool]: freshPoolData }));
            }
          }
        }).catch(error => {
          console.error("Error refreshing position data:", error);
          showError("Failed to refresh position data from blockchain");
        });
      } catch (error) {
        console.error("Error in position refresh effect:", error);
        showError("Error updating position data");
      }
    }
  }, [lastUpdate, adapter, provider, address, chainId, id, dispatch, showError]);

  // Fetch fee data using the adapter
  useEffect(() => {
    let isMounted = true;

    // Guard against undefined values
    if (!adapter || !position || !poolData || !token0Data || !token1Data) {
      return; // Early return if any required data is missing
    }

    setIsLoadingFees(true);
    setFeeLoadingError(false);

    const loadFees = async () => {
      try {
        // Calculate raw fees (returns [bigint, bigint])
        const [fees0Raw, fees1Raw] = adapter.calculateUncollectedFees(position, poolData);

        // Format the fees using token decimals (ethers v5 uses utils.formatUnits)
        // Convert to number since formatFeeDisplay expects a number, not a string
        const fees0Formatted = parseFloat(ethers.utils.formatUnits(fees0Raw.toString(), token0Data.decimals));
        const fees1Formatted = parseFloat(ethers.utils.formatUnits(fees1Raw.toString(), token1Data.decimals));

        // Only update state if component is still mounted
        if (isMounted) {
          setUncollectedFees({
            token0: {
              formatted: fees0Formatted,
              raw: fees0Raw.toString()
            },
            token1: {
              formatted: fees1Formatted,
              raw: fees1Raw.toString()
            }
          });
          setIsLoadingFees(false);

          // Mark resource as updated in Redux
          dispatch(setResourceUpdating({ resource: 'positions', isUpdating: false }));
        }
      } catch (error) {
        console.error("Error calculating fees for position", id, ":", error);
        if (isMounted) {
          setFeeLoadingError(true);
          setIsLoadingFees(false);
          showError("Failed to calculate uncollected fees");
        }
      }
    };

    loadFees();

    // Cleanup function
    return () => {
      isMounted = false;
    };
  }, [adapter, position, poolData, token0Data, token1Data, lastUpdate, dispatch, id, showError]);

  // Fetch token balances using the adapter
  useEffect(() => {
    let isMounted = true;

    // Guard against undefined values
    if (!adapter || !position || !poolData || !token0Data || !token1Data || !chainId) {
      return; // Early return if any required data is missing
    }

    setIsLoadingBalances(true);
    setBalanceError(false);

    const calculateBalances = async () => {
      try {
        const balances = await adapter.calculateTokenAmounts(
          position,
          poolData,
          token0Data,
          token1Data,
          chainId
        );

        if (isMounted) {
          // balances is an array [amount0BigInt, amount1BigInt]
          // Format it into the expected object structure
          const formattedBalances = {
            token0: {
              raw: balances[0].toString(),
              formatted: parseFloat(ethers.utils.formatUnits(balances[0].toString(), token0Data.decimals))
            },
            token1: {
              raw: balances[1].toString(),
              formatted: parseFloat(ethers.utils.formatUnits(balances[1].toString(), token1Data.decimals))
            }
          };
          setTokenBalances(formattedBalances);
          setIsLoadingBalances(false);
        }
      } catch (error) {
        console.error("Error calculating token balances:", error);
        if (isMounted) {
          setBalanceError(true);
          setIsLoadingBalances(false);
          showError("Failed to calculate token balances");
        }
      }
    };

    calculateBalances();

    return () => {
      isMounted = false;
    };
  }, [adapter, position, poolData, token0Data, token1Data, chainId, lastUpdate, showError]);

  // Fetch token prices from CoinGecko
  useEffect(() => {
    // Guard against undefined token data
    if (!token0Data?.symbol || !token1Data?.symbol) return;

    const getPrices = async () => {
      setTokenPrices(prev => ({ ...prev, loading: true, error: null }));

      try {
        // Use our utility function to fetch prices (2-minute cache for position detail page)
        const tokenSymbols = [token0Data.symbol, token1Data.symbol];
        const prices = await fetchTokenPrices(tokenSymbols, CACHE_DURATIONS['2-MINUTES']);

        setTokenPrices({
          token0: prices[token0Data.symbol],
          token1: prices[token1Data.symbol],
          loading: false,
          error: null
        });
      } catch (error) {
        console.error("Error fetching token prices:", error);
        setTokenPrices(prev => ({
          ...prev,
          loading: false,
          error: "Failed to fetch token prices"
        }));
        showError("Failed to fetch token prices");
      }
    };

    getPrices();
  }, [token0Data, token1Data, lastUpdate, showError]);

  // Function to manually refresh data
  const refreshData = () => {
    try {
      dispatch(triggerUpdate());
      showSuccess("Refreshing position data...");
    } catch (error) {
      console.error("Error triggering manual refresh:", error);
      showError("Failed to refresh data");
    }
  };

  // Calculate USD values
  const getUsdValue = (amount, tokenSymbol) => {
    if (!amount || amount === "0" || tokenPrices.loading || tokenPrices.error) return null;

    try {
      const price = tokenSymbol === token0Data?.symbol ? tokenPrices.token0 : tokenPrices.token1;
      if (!price) return null;

      // Calculate USD value inline
      const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
      return numAmount * price;
    } catch (error) {
      console.error("Error calculating USD value:", error);
      return null;
    }
  };

  // // Get the platform color directly from config
  // const getPlatformColor = () => {
  //   if (position && position.platform && config.platformMetadata[position.platform]?.color) {
  //     return config.platformMetadata[position.platform].color;
  //   }
  //   return '#6c757d'; // Default gray color
  // };

  // // Get platform logo if available
  // const getPlatformLogo = () => {
  //   if (position && position.platform && config.platformMetadata[position.platform]?.logo) {
  //     return config.platformMetadata[position.platform].logo;
  //   }
  //   return null;
  // };

  // Check if platform has a logo
  const platformLogo = position?.platform ? getPlatformLogo(position.platform) : null;
  const hasPlatformLogo = !!platformLogo;

  // Check if wallet is reconnecting FIRST (show spinner during auto-reconnect)
  if (isReconnecting) {
    return (
      <>
        <Navbar />
        <Container className="py-4">
          <Link href="/" passHref>
            <Button variant="outline-secondary" className="mb-4">
              &larr; Back to Dashboard
            </Button>
          </Link>
          <div className="text-center py-5">
            <Spinner animation="border" variant="primary" />
            <p className="mt-3">Reconnecting wallet...</p>
          </div>
        </Container>
      </>
    );
  }

  // Check wallet connection before checking for position data
  if (!isConnected) {
    return (
      <>
        <Navbar />
        <Container className="py-4">
          <Link href="/" passHref>
            <Button variant="outline-secondary" className="mb-4">
              &larr; Back to Dashboard
            </Button>
          </Link>
          <Alert variant="warning" className="text-center">
            <Alert.Heading>Wallet Not Connected</Alert.Heading>
            <p className="mb-0">Please connect your wallet to view position details.</p>
          </Alert>
        </Container>
      </>
    );
  }

  // If we're loading initial data OR should be loading (connected but no positions yet)
  // This prevents flash of "Position not found" during the gap between reconnect and data fetch
  if (isLoadingInitialData || (isConnected && (!positions || positions.length === 0))) {
    return (
      <>
        <Navbar />
        <Container className="py-4">
          <Link href="/" passHref>
            <Button variant="outline-secondary" className="mb-4">
              &larr; Back to Dashboard
            </Button>
          </Link>
          <div className="text-center py-5">
            <Spinner animation="border" variant="primary" />
            <p className="mt-3">Loading position data...</p>
          </div>
        </Container>
      </>
    );
  }

  // If we're still loading the position or it doesn't exist (after positions array is populated)
  if (!position || !poolData || !token0Data || !token1Data) {
    return (
      <>
        <Navbar />
        <Container className="py-4">
          <Link href="/" passHref>
            <Button variant="outline-secondary" className="mb-4">
              &larr; Back to Dashboard
            </Button>
          </Link>
          <Card>
            <Card.Body className="text-center p-5">
              <h3>Position not found or still loading...</h3>
              {!position && <p>No position found with ID: {id}</p>}
              {position && (!poolData || !token0Data || !token1Data) && (
                <p>Missing pool or token data for this position.</p>
              )}
              <Button
                variant="primary"
                onClick={refreshData}
                className="mt-3"
              >
                Refresh Data
              </Button>
            </Card.Body>
          </Card>
        </Container>
      </>
    );
  }

  return (
    <>
      <Navbar />
      <Container className="py-4">
        <Head>
          <title>Position #{position?.id} - {position?.tokenPair || 'Detail'} | Liquidity Dashboard</title>
        </Head>

        <Link href="/" passHref>
          <Button variant="outline-secondary" className="mb-4">
            &larr; Back to Dashboard
          </Button>
        </Link>

        <ErrorBoundary
          FallbackComponent={ErrorFallback}
          onReset={() => {
            // Reset the state that triggered the error
            refreshData();
          }}
        >
          <div className="d-flex justify-content-between align-items-center mb-3">
            {/* Updated header to match PositionCard styling */}
            <h1 className="mb-0 d-flex align-items-center">
              {/* Activity indicator dot */}
              <span
                style={{
                  display: 'inline-block',
                  width: '14px',
                  height: '14px',
                  borderRadius: '50%',
                  backgroundColor: isActive ? '#28a745' : '#dc3545',
                  marginRight: '12px'
                }}
                title={isActive ? "In range" : "Out of range"}
              />

              {/* Position ID */}
              <span>Position #{position.id}</span>

              {/* Platform indicator - logo or colored badge */}
              {position.platform && (
                hasPlatformLogo ? (
                  <div
                    className="ms-2 d-inline-flex align-items-center justify-content-center"
                    style={{ height: '24px', width: '24px' }}
                  >
                    <img
                      src={platformLogo}
                      alt={position.platformName || position.platform}
                      width={24}
                      height={24}
                      title={position.platformName || position.platform}
                    />
                  </div>
                ) : (
                  <Badge
                    className="ms-2 d-inline-flex align-items-center"
                    pill
                    bg=""
                    style={{
                      fontSize: '0.75rem',
                      backgroundColor: getPlatformColor(position.platform),
                      padding: '0.25em 0.8em',
                      color: 'white',
                      border: 'none'
                    }}
                  >
                    {position.platformName}
                  </Badge>
                )
              )}
            </h1>

            <div className="d-flex align-items-center">
              {isUpdating && (
                <div className="d-flex align-items-center me-3">
                  <Spinner animation="border" size="sm" variant="secondary" className="me-2" />
                  <small className="text-muted">Refreshing...</small>
                </div>
              )}
              <RefreshControls />
            </div>
          </div>

          <Row>
            <Col lg={8}>
              <Card className="mb-4">
                <Card.Header>
                  <h5 className="mb-0">Position Overview</h5>
                </Card.Header>
                <Card.Body>
                  <Row>
                    <Col md={6}>
                      <div className="mb-3">
                        <strong>Token Pair:</strong> {position.tokenPair}
                      </div>
                      <div className="mb-3">
                        <strong>Fee Tier:</strong> {position.fee && isFinite(position.fee) ? (position.fee / 10000) : 'N/A'}%
                      </div>
                      <div className="mb-3">
                        <strong>Status:</strong>{" "}
                        <Badge bg={isActive ? "success" : "danger"}>
                          {isActive ? "In Range (Active)" : "Out of Range (Inactive)"}
                        </Badge>
                      </div>
                    </Col>
                    <Col md={6}>
                      <div className="mb-3">
                        <strong>Price Direction:</strong>{" "}
                        <span>
                          {priceLabel}
                          <Button
                            variant="link"
                            className="p-0 ms-2"
                            size="sm"
                            onClick={() => setInvertPriceDisplay(!invertPriceDisplay)}
                            title="Switch price direction"
                          >
                            <span role="img" aria-label="switch">⇄</span>
                          </Button>
                        </span>
                      </div>
                      {/* Token balances now in the Overview section */}
                      <div className="mb-3">
                        <strong>Token Balances:</strong>
                        {balanceError ? (
                          <div className="text-danger small">Error calculating balances</div>
                        ) : isLoadingBalances ? (
                          <div className="d-flex align-items-center">
                            <Spinner animation="border" size="sm" className="me-2" />
                            <span className="small">Loading...</span>
                          </div>
                        ) : tokenBalances?.token0 && tokenBalances?.token1 ? (
                          <div className="mt-2">
                            <div className="mb-1 ps-1">
                              <div className="d-flex justify-content-between align-items-center">
                                <Badge bg="light" text="dark" className="px-2 py-1">
                                  {tokenBalances.token0.formatted} {token0Data.symbol}
                                </Badge>
                                {tokenPrices.token0 && (
                                  <span className="text-muted small">
                                    ≈ ${getUsdValue(tokenBalances.token0.formatted, token0Data.symbol)?.toFixed(2) || '—'}
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="ps-1">
                              <div className="d-flex justify-content-between align-items-center">
                                <Badge bg="light" text="dark" className="px-2 py-1">
                                  {tokenBalances.token1.formatted} {token1Data.symbol}
                                </Badge>
                                {tokenPrices.token1 && (
                                  <span className="text-muted small">
                                    ≈ ${getUsdValue(tokenBalances.token1.formatted, token1Data.symbol)?.toFixed(2) || '—'}
                                  </span>
                                )}
                              </div>
                            </div>
                            {tokenPrices.token0 && tokenPrices.token1 && (
                              <div className="mt-2 text-center small text-muted border-top pt-1">
                                Total Value: ${(
                                  (getUsdValue(tokenBalances.token0.formatted, token0Data.symbol) || 0) +
                                  (getUsdValue(tokenBalances.token1.formatted, token1Data.symbol) || 0)
                                ).toFixed(2)}
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="text-muted small">Not available</div>
                        )}
                      </div>
                    </Col>
                  </Row>
                </Card.Body>
              </Card>

              <Card className="mb-4">
                <Card.Header>
                  <h5 className="mb-0">Price Range</h5>
                </Card.Header>
                <Card.Body>
                  <div className="mb-3">
                    <div className="d-flex justify-content-between mb-2">
                      <div>
                        <small>Min Price</small>
                        <div>
                          <strong>{displayLowerPrice === "N/A" ? "N/A" : formatPrice(displayLowerPrice)}</strong>
                        </div>
                      </div>
                      <div>
                        <small>Current Price</small>
                        <div className="text-center">
                          <strong>{currentPrice === "N/A" ? "N/A" : formatPrice(parseFloat(currentPrice))}</strong>
                        </div>
                      </div>
                      <div className="text-end">
                        <small>Max Price</small>
                        <div>
                          <strong>{displayUpperPrice === "N/A" ? "N/A" : formatPrice(displayUpperPrice)}</strong>
                        </div>
                      </div>
                    </div>

                    <ProgressBar
                      now={pricePositionPercent}
                      variant={isActive ? "success" : "danger"}
                      style={{ height: "10px" }}
                    />
                    <div className="text-center mt-2">
                      <small className="text-muted">{priceLabel}</small>
                    </div>
                  </div>

                  <div className="mt-4 mb-3" style={{ height: "200px" }}>
                    {/* Using the PriceRangeChart component with real data */}
                    {displayLowerPrice !== "N/A" && displayUpperPrice !== "N/A" && currentPrice !== "N/A" ? (
                      <PriceRangeChart
                        lowerPrice={parseFloat(displayLowerPrice)}
                        upperPrice={parseFloat(displayUpperPrice)}
                        currentPrice={parseFloat(currentPrice)}
                        token0Symbol={token0Data.symbol}
                        token1Symbol={token1Data.symbol}
                        isInverted={invertPriceDisplay}
                        isActive={isActive}
                      />
                    ) : (
                      <div className="text-center pt-5">
                        <p className="text-muted">Cannot display chart due to missing price data</p>
                      </div>
                    )}
                  </div>
                </Card.Body>
              </Card>
            </Col>

            <Col lg={4}>
              <Card className="mb-4">
                <Card.Header>
                  <h5 className="mb-0">Position Actions</h5>
                </Card.Header>
                <Card.Body>
                  <div className="mb-4">
                    <h6>Uncollected Fees</h6>
                    <div className="mb-3">
                      {feeLoadingError ? (
                        <div className="text-danger small w-100">
                          <i className="me-1">⚠️</i>
                          Unable to load fee data. Please try refreshing.
                        </div>
                      ) : isLoadingFees ? (
                        <div className="text-secondary text-center py-2">
                          <Spinner animation="border" size="sm" className="me-2" />
                          Loading fee data...
                        </div>
                      ) : uncollectedFees ? (
                        <div className="border rounded p-2 bg-light">
                          <div className="d-flex justify-content-between align-items-center mb-2">
                            <Badge bg="white" text="dark" className="px-3 py-2">
                              {formatFeeDisplay(parseFloat(uncollectedFees.token0.formatted))} {token0Data.symbol}
                            </Badge>
                            {tokenPrices.token0 && (
                              <span className="text-muted small">
                                ≈ ${getUsdValue(uncollectedFees.token0.formatted, token0Data.symbol)?.toFixed(2) || '—'}
                              </span>
                            )}
                          </div>
                          <div className="d-flex justify-content-between align-items-center mb-1">
                            <Badge bg="white" text="dark" className="px-3 py-2">
                              {formatFeeDisplay(parseFloat(uncollectedFees.token1.formatted))} {token1Data.symbol}
                            </Badge>
                            {tokenPrices.token1 && (
                              <span className="text-muted small">
                                ≈ ${getUsdValue(uncollectedFees.token1.formatted, token1Data.symbol)?.toFixed(2) || '—'}
                              </span>
                            )}
                          </div>

                          {tokenPrices.token0 && tokenPrices.token1 && (
                            <div className="text-center small border-top pt-2 mt-2 fw-bold">
                              Total Value: ${(
                                (getUsdValue(uncollectedFees.token0.formatted, token0Data.symbol) || 0) +
                                (getUsdValue(uncollectedFees.token1.formatted, token1Data.symbol) || 0)
                              ).toFixed(2)}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="text-muted small text-center py-2">
                          No fee data available
                        </div>
                      )}
                    </div>

                    <Button
                      variant="primary"
                      className="w-100 mb-3"
                      disabled={position.inVault || feeLoadingError || !uncollectedFees ||
                                (uncollectedFees &&
                                parseFloat(uncollectedFees.token0.formatted) < 0.0001 &&
                                parseFloat(uncollectedFees.token1.formatted) < 0.0001)}
                      onClick={() => setShowClaimFeesModal(true)}
                    >
                      Claim Fees
                    </Button>
                  </div>

                  <div className="mb-4">
                    <h6>Liquidity Management</h6>
                    <Button
                      variant="outline-primary"
                      className="w-100 mb-2"
                      disabled={position.inVault}
                      onClick={() => setShowAddLiquidityModal(true)}
                    >
                      Add Liquidity
                    </Button>
                    <Button
                      variant="outline-primary"
                      className="w-100 mb-3"
                      disabled={position.inVault}
                      onClick={() => setShowRemoveLiquidityModal(true)}
                    >
                      Remove Liquidity
                    </Button>
                  </div>

                  <div>
                    <h6>Position Management</h6>
                    <Button
                      variant="outline-danger"
                      className="w-100"
                      disabled={position.inVault}
                      onClick={() => setShowClosePositionModal(true)}
                    >
                      Close Position
                    </Button>
                  </div>
                </Card.Body>
              </Card>

              <Card>
                <Card.Header>
                  <h5 className="mb-0">Technical Details</h5>
                </Card.Header>
                <Card.Body>
                  <div className="mb-2">
                    <strong>Tick Range:</strong>{" "}
                    <code>{position.tickLower}</code> to <code>{position.tickUpper}</code>
                  </div>
                  <div className="mb-2">
                    <strong>Chain ID:</strong> {chainId}
                  </div>
                  <div className="mb-2">
                    <strong>Liquidity:</strong> {position.liquidity.toLocaleString()}
                  </div>
                  <div>
                    <strong>Pool Address:</strong><br />
                    <small className="text-muted">
                      <code>{position.pool}</code>
                    </small>
                  </div>
                </Card.Body>
              </Card>
            </Col>
          </Row>
        </ErrorBoundary>

        {/* Add the modals using our updated components */}
        <ClaimFeesModal
          show={showClaimFeesModal}
          onHide={() => setShowClaimFeesModal(false)}
          position={position}
          uncollectedFees={uncollectedFees}
          token0Data={token0Data}
          token1Data={token1Data}
          tokenPrices={tokenPrices}
          poolData={poolData}
        />

        <RemoveLiquidityModal
          show={showRemoveLiquidityModal}
          onHide={() => setShowRemoveLiquidityModal(false)}
          position={position}
          tokenBalances={tokenBalances}
          token0Data={token0Data}
          token1Data={token1Data}
          tokenPrices={tokenPrices}
        />

        <ClosePositionModal
          show={showClosePositionModal}
          onHide={() => setShowClosePositionModal(false)}
          position={position}
          tokenBalances={tokenBalances}
          uncollectedFees={uncollectedFees}
          token0Data={token0Data}
          token1Data={token1Data}
          tokenPrices={tokenPrices}
        />

        <AddLiquidityModal
          show={showAddLiquidityModal}
          onHide={() => setShowAddLiquidityModal(false)}
          position={position}
          poolData={poolData}
          token0Data={token0Data}
          token1Data={token1Data}
          tokenPrices={tokenPrices}
        />
      </Container>
    </>
  );
}
