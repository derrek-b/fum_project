import React, { useState, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/router";
import { useSelector, useDispatch } from "react-redux";
import { Container, Row, Col, Card, Button, Badge, ProgressBar, Spinner, Alert } from "react-bootstrap";
import Link from "next/link";
import Head from "next/head";
import { AdapterFactory } from "../../adapters";
import { formatPrice, formatFeeDisplay } from "../../utils/formatHelpers";
import { fetchTokenPrices, calculateUsdValue } from "../../utils/coingeckoUtils";
import PriceRangeChart from "../../components/PriceRangeChart";
import Navbar from "../../components/Navbar";
import RefreshControls from "../../components/RefreshControls";
import RemoveLiquidityModal from "../../components/RemoveLiquidityModal";
import { triggerUpdate, setResourceUpdating, markAutoRefresh } from "../../redux/updateSlice";
import { setPositions } from "@/redux/positionsSlice";
import { setPools } from "@/redux/poolSlice";

export default function PositionDetailPage() {
  const dispatch = useDispatch();
  const router = useRouter();
  const { id } = router.query;
  const { positions } = useSelector((state) => state.positions);
  const pools = useSelector((state) => state.pools);
  const tokens = useSelector((state) => state.tokens);
  const { isConnected, address, chainId, provider } = useSelector((state) => state.wallet);
  const { lastUpdate, autoRefresh, resourcesUpdating } = useSelector((state) => state.updates);

  const timerRef = useRef(null);

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
  const [isClaiming, setIsClaiming] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [actionSuccess, setActionSuccess] = useState(null);
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [showRemoveLiquidityModal, setShowRemoveLiquidityModal] = useState(false);
  const [forceUpdateCounter, setForceUpdateCounter] = useState(0);

  // Hacky way to force update since redux/state changes aren't triggering refresh
  const forceUpdate = () => setForceUpdateCounter(prev => prev + 1);

  // Find the position by ID
  const position = useMemo(() => {
    if (!positions || !id) return null;
    return positions.find((p) => p.id === id);
  }, [positions, id]);

  // Get pool and token data for the position - DEFINE THESE BEFORE USING THEM
  const poolData = position ? pools[position.poolAddress] : null;
  const token0Data = poolData?.token0 ? tokens[poolData.token0] : null;
  const token1Data = poolData?.token1 ? tokens[poolData.token1] : null;

  // Check if any resources are currently updating
  const isUpdating = resourcesUpdating?.positions || false;

  // Get the appropriate adapter for this position
  const adapter = useMemo(() => {
    if (!position?.platform || !provider) return null;
    try {
      return AdapterFactory.getAdapter(position.platform, provider);
    } catch (error) {
      console.error(`Failed to get adapter for position ${id}:`, error);
      return null;
    }
  }, [position?.platform, provider, id]);

  // Use adapter for position-specific calculations
  const isActive = useMemo(() => {
    if (!adapter || !position || !poolData) return false;
    try {
      return adapter.isPositionInRange(position, poolData);
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
      return adapter.calculatePrice(
        position,
        poolData,
        token0Data,
        token1Data,
        invertPriceDisplay
      );
    } catch (error) {
      console.error("Error calculating price:", error);
      return { currentPrice: "N/A", lowerPrice: "N/A", upperPrice: "N/A" };
    }
  }, [adapter, position, poolData, token0Data, token1Data, invertPriceDisplay]);

  // Extract values from priceInfo
  const { currentPrice, lowerPrice, upperPrice } = priceInfo;

  // Set price direction labels
  const priceLabel = token0Data && token1Data ? (
    invertPriceDisplay
      ? `${token0Data.symbol} per ${token1Data.symbol}`
      : `${token1Data.symbol} per ${token0Data.symbol}`
  ) : "";

  // Ensure lower price is always smaller than upper price (they swap when inverting)
  const displayLowerPrice = useMemo(() => {
    if (lowerPrice === "N/A" || upperPrice === "N/A") return "N/A";
    return Math.min(parseFloat(lowerPrice), parseFloat(upperPrice));
  }, [lowerPrice, upperPrice]);

  const displayUpperPrice = useMemo(() => {
    if (lowerPrice === "N/A" || upperPrice === "N/A") return "N/A";
    return Math.max(parseFloat(lowerPrice), parseFloat(upperPrice));
  }, [lowerPrice, upperPrice]);

  // Calculate position percentage for the progress bar
  const pricePositionPercent = useMemo(() => {
    if (displayLowerPrice === "N/A" || displayUpperPrice === "N/A" || currentPrice === "N/A")
      return 0;

    const lower = parseFloat(displayLowerPrice);
    const upper = parseFloat(displayUpperPrice);
    const current = parseFloat(currentPrice);

    if (current < lower) return 0;
    if (current > upper) return 100;

    return Math.floor(((current - lower) / (upper - lower)) * 100);
  }, [displayLowerPrice, displayUpperPrice, currentPrice]);

  // Set up auto-refresh timer
  useEffect(() => {
    // Clear any existing timer
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    // Only set up timer if auto-refresh is enabled and we're connected
    if (autoRefresh.enabled && isConnected && provider && address && chainId) {
      console.log(`Setting up auto-refresh timer with interval: ${autoRefresh.interval}ms`);
      timerRef.current = setInterval(() => {
        const timestamp = Date.now();
        console.log(`Auto-refresh triggered at ${new Date(timestamp).toISOString()}`);
        dispatch(markAutoRefresh());
        dispatch(triggerUpdate()); // This should carry the timestamp
      }, autoRefresh.interval);
    }

    // Cleanup on unmount
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [autoRefresh.enabled, autoRefresh.interval, isConnected, provider, address, chainId, dispatch]);

  // Ensure we're actively tracking lastUpdate changes with a dedicated effect
  useEffect(() => {
    if (lastUpdate) {
      console.log("lastUpdate detected in position details:", new Date(lastUpdate).toISOString());

      // Explicitly force re-fetches by clearing local state
      setUncollectedFees(null);
      setTokenBalances(null);
      setIsLoadingFees(true);
      setIsLoadingBalances(true);

      // This is critical - we need to force a refresh of these calculations
      if (adapter && position && poolData && token0Data && token1Data) {
        // Force fee recalculation
        adapter.calculateFees(position, poolData, token0Data, token1Data)
          .then(fees => {
            console.log("Refreshed fees:", fees);
            setUncollectedFees(fees);
            setIsLoadingFees(false);
            forceUpdate(); // Force component re-render
          })
          .catch(error => {
            console.error("Error refreshing fees:", error);
            setFeeLoadingError(true);
            setIsLoadingFees(false);
          });

        // Force token balances recalculation if we have chainId
        if (chainId) {
          adapter.calculateTokenAmounts(position, poolData, token0Data, token1Data, chainId)
            .then(balances => {
              console.log("Refreshed balances:", balances);
              setTokenBalances(balances);
              setIsLoadingBalances(false);
              forceUpdate(); // Force component re-render
            })
            .catch(error => {
              console.error("Error refreshing balances:", error);
              setBalanceError(true);
              setIsLoadingBalances(false);
            });
        }
      }
    }
  }, [lastUpdate, adapter, position, poolData, token0Data, token1Data, chainId]);

  // Mark resources as updating when lastUpdate changes
  useEffect(() => {
    if (id && lastUpdate) {
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
    }
  }, [lastUpdate, id, dispatch]);

  // Add this useEffect to position/[id].js
  useEffect(() => {
    // Only run when lastUpdate changes and we have necessary context
    if (lastUpdate && adapter && provider && address && chainId && id) {
      console.log("Refreshing position data due to lastUpdate change:", new Date(lastUpdate).toISOString());

      // Track the latest refresh timestamp to avoid duplicate refreshes
      const refreshTimestamp = lastUpdate;

      // Fetch fresh data from blockchain
      adapter.getPositions(address, chainId).then(result => {
        // Check if this is still the latest refresh (prevents race conditions)
        if (refreshTimestamp !== lastUpdate) return;

        // Find our specific position
        const freshPosition = result.positions.find(p => p.id === id);
        if (freshPosition) {
          // Get fresh pool data
          const freshPoolData = result.poolData[freshPosition.poolAddress];
          const freshTokenData = result.tokenData;

          // Update Redux with fresh data (without creating reference cycles)
          if (positions && positions.length > 0) {
            // Create a new array to avoid reference issues
            const updatedPositions = [...positions];
            // Find and replace the specific position
            const posIndex = updatedPositions.findIndex(p => p.id === id);
            if (posIndex >= 0) {
              updatedPositions[posIndex] = freshPosition;
              dispatch(setPositions(updatedPositions));
            }
          }

          // Update the specific pool
          if (freshPoolData) {
            dispatch(setPools({ [freshPosition.poolAddress]: freshPoolData }));
          }
        }
      }).catch(error => {
        console.error("Error refreshing position data:", error);
      });
    }
  }, [lastUpdate, adapter, provider, address, chainId, id, dispatch]); // Remove positions from deps

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
        const fees = await adapter.calculateFees(position, poolData, token0Data, token1Data);

        // Only update state if component is still mounted
        if (isMounted) {
          setUncollectedFees(fees);
          setIsLoadingFees(false);

          // Mark resource as updated in Redux
          dispatch(setResourceUpdating({ resource: 'positions', isUpdating: false }));
        }
      } catch (error) {
        console.error("Error calculating fees for position", id, ":", error);
        if (isMounted) {
          setFeeLoadingError(true);
          setIsLoadingFees(false);
        }
      }
    };

    loadFees();

    // Cleanup function
    return () => {
      isMounted = false;
    };
  }, [adapter, position, poolData, token0Data, token1Data, lastUpdate, dispatch, id]); // Make sure lastUpdate is included here

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
          setTokenBalances(balances);
          setIsLoadingBalances(false);
        }
      } catch (error) {
        console.error("Error calculating token balances:", error);
        if (isMounted) {
          setBalanceError(true);
          setIsLoadingBalances(false);
        }
      }
    };

    calculateBalances();

    return () => {
      isMounted = false;
    };
  }, [adapter, position, poolData, token0Data, token1Data, chainId, lastUpdate]); // Make sure lastUpdate is included here

  // Fetch token prices from CoinGecko
  useEffect(() => {
    // Guard against undefined token data
    if (!token0Data?.symbol || !token1Data?.symbol) return;

    const getPrices = async () => {
      setTokenPrices(prev => ({ ...prev, loading: true, error: null }));

      try {
        // Use our utility function to fetch prices
        const tokenSymbols = [token0Data.symbol, token1Data.symbol];
        const prices = await fetchTokenPrices(tokenSymbols);

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
      }
    };

    getPrices();
  }, [token0Data, token1Data, lastUpdate]);

  // Function to manually refresh data
  const refreshData = () => {
    dispatch(triggerUpdate());
  };

  // Calculate USD values
  const getUsdValue = (amount, tokenSymbol) => {
    if (!amount || amount === "0" || tokenPrices.loading || tokenPrices.error) return null;

    const price = tokenSymbol === token0Data?.symbol ? tokenPrices.token0 : tokenPrices.token1;
    return calculateUsdValue(amount, price);
  };

  // Function to claim fees using the adapter
  const claimFees = async () => {
    if (!adapter) {
      setActionError("No adapter available for this position");
      return;
    }

    setIsClaiming(true);
    setActionError(null);
    setActionSuccess(null);

    try {
      await adapter.claimFees({
        position,
        provider,
        address,
        chainId,
        poolData,
        token0Data,
        token1Data,
        dispatch,
        onStart: () => setIsClaiming(true),
        onFinish: () => setIsClaiming(false),
        onSuccess: (result) => {
          setActionSuccess("Successfully claimed fees!");

          // If we have updated position and pool data, update Redux
          if (result.updatedPosition && result.updatedPoolData) {
            // Import Redux actions
            // const { setPositions } = require('../redux/positionsSlice');
            // const { setPools } = require('../redux/poolSlice');

            // Update the specific position in the positions array
            const updatedPositions = positions.map(p => {
              console.log('inside updatedPositions');
              return p.id === position.id ? result.updatedPosition : p
            });

            // Update Redux store with the new data
            dispatch(setPositions(updatedPositions));

            // Create a pool data update object with just the updated pool
            const poolUpdate = {
              [position.poolAddress]: result.updatedPoolData
            };
            dispatch(setPools(poolUpdate));

            // Force a re-fetch of uncollected fees with the updated data
            setUncollectedFees(null);
            setIsLoadingFees(true);
          }
        },
        onError: (errorMessage) => setActionError(`Failed to claim fees: ${errorMessage}`)
      });
    } catch (error) {
      console.error("Error claiming fees:", error);
      setActionError(`Error claiming fees: ${error.message}`);
    } finally {
      setIsClaiming(false);
    }
  };

  // Add handler function for removing liquidity
  const handleRemoveLiquidity = async (percentage) => {
    if (!adapter) {
      setActionError("No adapter available for this position");
      return;
    }

    setActionError(null);
    setActionSuccess(null);
    setIsRemoving(true);

    try {
      await adapter.decreaseLiquidity({
        position,
        provider,
        address,
        chainId,
        percentage,
        poolData,
        token0Data,
        token1Data,
        dispatch,
        onStart: () => setIsRemoving(true),
        onFinish: () => setIsRemoving(false),
        onSuccess: (result) => {
          setActionSuccess(`Successfully removed ${percentage}% of liquidity!`);
          setShowRemoveLiquidityModal(false);
          dispatch(triggerUpdate()); // Refresh data
        },
        onError: (errorMessage) => {
          setActionError(`Failed to remove liquidity: ${errorMessage}`);
          setShowRemoveLiquidityModal(false);
        }
      });
    } catch (error) {
      console.error("Error removing liquidity:", error);
      setActionError(`Error removing liquidity: ${error.message}`);
      setIsRemoving(false);
    }
  };

  // Update handleClosePosition to accept the shouldBurn parameter
  const handleClosePosition = async (shouldBurn) => {
    if (!adapter) {
      setActionError("No adapter available for this position");
      return;
    }

    setActionError(null);
    setActionSuccess(null);
    setIsClosing(true);

    try {
      await adapter.closePosition({
        position,
        provider,
        address,
        chainId,
        poolData,
        token0Data,
        token1Data,
        collectFees: true, // Collect fees as part of closing
        burnPosition: shouldBurn, // Use the value from the modal
        dispatch,
        onStart: () => setIsClosing(true),
        onFinish: () => setIsClosing(false),
        onSuccess: () => {
          setActionSuccess("Position successfully closed!");
          setShowCloseModal(false);
          // Navigate back to the main dashboard after a short delay
          setTimeout(() => {
            router.push('/');
          }, 2000);
        },
        onError: (errorMessage) => {
          setActionError(`Failed to close position: ${errorMessage}`);
          setShowCloseModal(false);
        }
      });
    } catch (error) {
      console.error("Error closing position:", error);
      setActionError(`Error closing position: ${error.message}`);
      setIsClosing(false);
    }
  };

  // If we're still loading the position or it doesn't exist
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

        <div className="d-flex justify-content-between align-items-center mb-3">
          <h1 className="mb-0">
            Position #{position.id}
            <span
              style={{
                display: 'inline-block',
                width: '14px',
                height: '14px',
                borderRadius: '50%',
                backgroundColor: isActive ? '#28a745' : '#dc3545',
                marginLeft: '12px',
                marginRight: '8px'
              }}
              title={isActive ? "In range" : "Out of range"}
            />
            {position.platformName && (
              <Badge bg="secondary" className="ms-2" style={{ fontSize: '0.7rem' }}>
                {position.platformName}
              </Badge>
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
                      <strong>Fee Tier:</strong> {position.fee / 10000}%
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
                      ) : tokenBalances ? (
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
                            {formatFeeDisplay(uncollectedFees.token0.formatted)} {token0Data.symbol}
                          </Badge>
                          {tokenPrices.token0 && (
                            <span className="text-muted small">
                              ≈ ${getUsdValue(uncollectedFees.token0.formatted, token0Data.symbol)?.toFixed(2) || '—'}
                            </span>
                          )}
                        </div>
                        <div className="d-flex justify-content-between align-items-center mb-1">
                          <Badge bg="white" text="dark" className="px-3 py-2">
                            {formatFeeDisplay(uncollectedFees.token1.formatted)} {token1Data.symbol}
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
                    disabled={isClaiming || feeLoadingError || !uncollectedFees ||
                              (uncollectedFees &&
                               parseFloat(uncollectedFees.token0.formatted) < 0.0001 &&
                               parseFloat(uncollectedFees.token1.formatted) < 0.0001)}
                    onClick={claimFees}
                  >
                    {isClaiming ? (
                      <>
                        <Spinner
                          as="span"
                          animation="border"
                          size="sm"
                          role="status"
                          aria-hidden="true"
                          className="me-2"
                        />
                        Claiming...
                      </>
                    ) : "Claim Fees"}
                  </Button>
                </div>

                <div className="mb-4">
                  <h6>Liquidity Management</h6>
                  <Button
                    variant="outline-primary"
                    className="w-100 mb-2"
                    disabled={isAdding}
                  >
                    {isAdding ? "Processing..." : "Add Liquidity"}
                  </Button>
                  <Button
                    variant="outline-primary"
                    className="w-100 mb-3"
                    disabled={isRemoving}
                    onClick={() => setShowRemoveLiquidityModal(true)}
                  >
                    {isRemoving ? "Processing..." : "Remove Liquidity"}
                  </Button>
                </div>

                <div>
                  <h6>Position Management</h6>
                  <Button
                    variant="outline-danger"
                    className="w-100"
                    disabled={isClosing}
                  >
                    {isClosing ? "Processing..." : "Close Position"}
                  </Button>
                </div>

                {actionError && (
                  <Alert variant="danger" className="mt-3 mb-0 p-2 small">
                    {actionError}
                  </Alert>
                )}

                {actionSuccess && (
                  <Alert variant="success" className="mt-3 mb-0 p-2 small">
                    {actionSuccess}
                  </Alert>
                )}
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
                    <code>{position.poolAddress}</code>
                  </small>
                </div>
              </Card.Body>
            </Card>
          </Col>
        </Row>

        <RemoveLiquidityModal
          show={showRemoveLiquidityModal}
          onHide={() => setShowRemoveLiquidityModal(false)}
          position={position}
          tokenBalances={tokenBalances}
          token0Data={token0Data}
          token1Data={token1Data}
          tokenPrices={tokenPrices}
          isRemoving={isRemoving}
          onRemoveLiquidity={handleRemoveLiquidity}
          errorMessage={actionError}
        />
      </Container>
    </>
  );
}
