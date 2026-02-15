import React, { useMemo, useState, useEffect } from "react";
import { Card, Spinner, Badge, Button } from "react-bootstrap";
import { useSelector } from "react-redux";
import { useRouter } from "next/router";
import { ethers } from "ethers";
import { useReadProvider } from "../../hooks/useReadProvider";

// FUM Library imports
import { AdapterFactory } from "fum_library/adapters";
import { formatPrice, formatFeeDisplay } from "fum_library/helpers/formatHelpers";
import { fetchTokenPrices, CACHE_DURATIONS } from "fum_library/services/coingecko";
import { getPlatformColor, getPlatformLogo, getPlatformName } from "fum_library/helpers/platformHelpers";

// Local imports
import PriceRangeChart from "../common/PriceRangeChart";

export default function PositionCard({ position, inVault = false, vaultAddress = null }) {
  const router = useRouter();
  const { address, chainId } = useSelector((state) => state.wallet);
  const { provider } = useReadProvider();
  const pools = useSelector((state) => state.pools);
  const poolData = pools[position.pool];

  // Token data is embedded in pool data from the adapter
  const token0Data = poolData?.token0 || null;
  const token1Data = poolData?.token1 || null;

  // Get the appropriate adapter for this position
  const adapter = useMemo(() => {
    if (!position.platform || !provider || !chainId) return null;
    try {
      return AdapterFactory.getAdapter(position.platform, chainId, provider);
    } catch (error) {
      console.error(`Failed to get adapter for position ${position.id}:`, error);
      return null;
    }
  }, [position.platform, chainId, provider]);

  // Use adapter for position-specific calculations
  const isActive = useMemo(() => {
    if (!adapter || !poolData || typeof poolData.tick !== 'number') return false;
    return adapter.isPositionInRange(poolData.tick, position.tickLower, position.tickUpper);
  }, [adapter, position, poolData]);

  // State for price display direction
  const [invertPriceDisplay, setInvertPriceDisplay] = useState(false);

  // Calculate price information using the adapter
  const priceInfo = useMemo(() => {
    if (!adapter || !poolData || !token0Data || !token1Data) {
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
        quoteToken,
        chainId
      );
      const upperPrice = adapter.tickToPrice(
        position.tickUpper,
        baseToken,
        quoteToken,
        chainId
      );

      return {
        currentPrice: currentPrice?.toSignificant(6) || "N/A",
        lowerPrice: lowerPrice?.toSignificant(6) || "N/A",
        upperPrice: upperPrice?.toSignificant(6) || "N/A"
      };
    } catch (error) {
      console.error("Error calculating prices:", error);
      return { currentPrice: "N/A", lowerPrice: "N/A", upperPrice: "N/A" };
    }
  }, [adapter, position, poolData, token0Data, token1Data, invertPriceDisplay, chainId]);

  // Extract values from priceInfo
  const { currentPrice, lowerPrice, upperPrice } = priceInfo;

  // Ensure lower price is always smaller than upper price (they swap when inverting)
  const displayLowerPrice = useMemo(() => {
    if (lowerPrice === "N/A" || upperPrice === "N/A") return "N/A";
    return Math.min(parseFloat(lowerPrice), parseFloat(upperPrice));
  }, [lowerPrice, upperPrice]);

  const displayUpperPrice = useMemo(() => {
    if (lowerPrice === "N/A" || upperPrice === "N/A") return "N/A";
    return Math.max(parseFloat(lowerPrice), parseFloat(upperPrice));
  }, [lowerPrice, upperPrice]);

  // Set price direction labels
  // When invertPriceDisplay is false: baseToken = token1, quoteToken = token0
  // Price = token1/token0, which means "how many token0 per token1"
  // When invertPriceDisplay is true: baseToken = token0, quoteToken = token1
  // Price = token0/token1, which means "how many token1 per token0"
  const priceLabel = invertPriceDisplay
    ? `${token1Data?.symbol} per ${token0Data?.symbol}`
    : `${token0Data?.symbol} per ${token1Data?.symbol}`;

  // State for fee calculation errors
  const [feeLoadingError, setFeeLoadingError] = useState(false);

  // Calculate uncollected fees using the adapter
  const [uncollectedFees, setUncollectedFees] = useState(null);
  const [isLoadingFees, setIsLoadingFees] = useState(false);

  // State for token balances
  const [tokenBalances, setTokenBalances] = useState(null);
  const [isLoadingBalances, setIsLoadingBalances] = useState(false);
  const [balanceError, setBalanceError] = useState(false);

  // State for token prices (for USD values)
  const [tokenPrices, setTokenPrices] = useState({
    token0: null,
    token1: null,
    loading: false,
    error: null
  });


  // Fetch token prices
  useEffect(() => {
    // Guard against undefined token data
    if (!token0Data?.symbol || !token1Data?.symbol) return;

    const getPrices = async () => {
      setTokenPrices(prev => ({ ...prev, loading: true, error: null }));

      try {
        // Use our utility function to fetch prices (2-minute cache for dashboard display)
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
      }
    };

    getPrices();
  }, [token0Data, token1Data]);

  // Calculate token balances
  useEffect(() => {
    // Guard against undefined values
    if (!adapter || !position || !poolData || !token0Data || !token1Data || !chainId) {
      return;
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

        // Format the balances - adapter returns [bigint, bigint]
        const [amount0Raw, amount1Raw] = balances;
        const formattedBalances = {
          token0: {
            formatted: ethers.utils.formatUnits(amount0Raw.toString(), token0Data.decimals),
            raw: amount0Raw.toString()
          },
          token1: {
            formatted: ethers.utils.formatUnits(amount1Raw.toString(), token1Data.decimals),
            raw: amount1Raw.toString()
          }
        };

        setTokenBalances(formattedBalances);
        setIsLoadingBalances(false);
      } catch (error) {
        console.error("Error calculating token balances:", error);
        setBalanceError(true);
        setIsLoadingBalances(false);
      }
    };

    calculateBalances();
  }, [adapter, position, poolData, token0Data, token1Data, chainId]);

  // Calculate position TVL
  const positionTVL = useMemo(() => {
    // Don't calculate until balances are loaded
    if (isLoadingBalances || balanceError) {
      return null;
    }

    // Ensure we have all required data
    if (!tokenBalances || !tokenPrices.token0 || !tokenPrices.token1 || tokenPrices.loading || tokenPrices.error) {
      return null;
    }

    try {
      const token0Value = parseFloat(tokenBalances.token0.formatted) * tokenPrices.token0;
      const token1Value = parseFloat(tokenBalances.token1.formatted) * tokenPrices.token1;
      return token0Value + token1Value;
    } catch (error) {
      console.error("Error calculating position TVL:", error);
      console.error("tokenBalances:", tokenBalances);
      console.error("tokenPrices:", tokenPrices);
      return null;
    }
  }, [tokenBalances, tokenPrices, isLoadingBalances, balanceError]);

  // Calculate uncollected fees
  useEffect(() => {
    let isMounted = true;
    setIsLoadingFees(true);
    setFeeLoadingError(false);

    // Only attempt to load fees if we have all the necessary data
    if (!adapter || !position || !poolData || !token0Data || !token1Data) {
      console.error("Missing required data for fee calculation:", {
        adapter: !!adapter,
        position: !!position,
        poolData: !!poolData,
        token0Data: !!token0Data,
        token1Data: !!token1Data
      });

      if (isMounted) {
        setFeeLoadingError(true);
        setIsLoadingFees(false);
      }
      return;
    }

    const loadFees = async () => {
      try {
        // Calculate raw fees (returns [bigint, bigint])
        const [fees0Raw, fees1Raw] = adapter.calculateUncollectedFees(position, poolData);

        // Format the fees using token decimals (ethers v5 uses utils.formatUnits)
        const fees0Formatted = ethers.utils.formatUnits(fees0Raw.toString(), token0Data.decimals);
        const fees1Formatted = ethers.utils.formatUnits(fees1Raw.toString(), token1Data.decimals);

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
        }
      } catch (error) {
        console.error(`FEES ERROR: Failed for position ${position.id}:`, error);
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
  }, [adapter, position, poolData, token0Data, token1Data]);


  // Handle card click to navigate to detail page
  const handleCardClick = () => {
    router.push(`/position/${position.id}`);
  };

  // Get card styling based on vault status
  const getCardStyle = () => {
    const baseStyle = {
      backgroundColor: "#f5f5f5",
      borderColor: "rgb(0, 128, 128)",
      cursor: "pointer"
    };

    // Add special styling for vault positions
    if (inVault) {
      return {
        ...baseStyle,
        borderWidth: "1px",
        borderStyle: "solid",
        borderColor: "black"
      };
    }

    return baseStyle;
  };

  if (!poolData || !token0Data || !token1Data) {
    return <Card><Card.Body>Loading position data or data unavailable...</Card.Body></Card>;
  }

  // Get the platform color using FUM library helper
  const platformColor = position.platform
                       ? getPlatformColor(position.platform)
                       : '#6c757d';

  // Get the platform logo using FUM library helper
  const platformLogo = position.platform
                      ? getPlatformLogo(position.platform)
                      : null;

  // Get the platform name using FUM library helper
  const platformName = position.platformName || getPlatformName(position.platform);

  return (
    <>
      <Card
        className="mb-3 card-clickable"
        style={getCardStyle()}
        onClick={handleCardClick}
      >
        <Card.Body>
          <div className="d-flex justify-content-between align-items-center mb-2">
            <Card.Title className="d-flex align-items-center mb-0" style={{ fontSize: '1.5rem' }}>
              {/* Activity indicator at beginning of line */}
              <span
                style={{
                  display: 'inline-block',
                  width: '10px',
                  height: '10px',
                  borderRadius: '50%',
                  backgroundColor: isActive ? '#28a745' : '#dc3545',
                  marginRight: '8px'
                }}
                title={isActive ? "In range" : "Out of range"}
              />

              {/* Position ID and token pair */}
              <span>#{position.id} - {position.tokenPair}</span>

              {/* Conditional display of either logo or badge */}
              {position.platform && (
                platformLogo ? (
                  // Show logo if available
                  <div
                    className="ms-2 d-inline-flex align-items-center justify-content-center"
                    style={{
                      height: '20px',
                      width: '20px'
                    }}
                  >
                    <img
                      src={platformLogo}
                      alt={platformName}
                      width={20}
                      height={20}
                      title={platformName}
                    />
                  </div>
                ) : (
                  // Show colored badge if no logo - with explicit color override
                  <Badge
                    className="ms-2 d-inline-flex align-items-center"
                    pill  // Add pill shape to match design
                    bg="" // Important! Set this to empty string to prevent default bg color
                    style={{
                      fontSize: '0.75rem',
                      backgroundColor: platformColor,
                      padding: '0.25em 0.5em',
                      color: 'white',
                      border: 'none'
                    }}
                  >
                    {platformName}
                  </Badge>
                )
              )}

              {/* Vault indicator with icon instead of badge */}
              {inVault && (
                <div
                  className="ms-2 d-inline-flex align-items-center pb-1"
                  title="Position is in a vault"
                >
                  <span>
                    <img width={18} height={18} alt="Vault indicator" src="/Logo.svg" />
                  </span>
                </div>
              )}
            </Card.Title>

            {/* TVL in top right */}
            <div style={{ fontSize: '1.5rem', fontWeight: '600', textAlign: 'right' }}>
              {isLoadingBalances || tokenPrices.loading ? (
                <Spinner animation="border" size="sm" />
              ) : positionTVL !== null ? (
                <span className="text-crimson">
                  ${positionTVL.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2
                  })}
                </span>
              ) : (
                <span className="text-danger">Error</span>
              )}
            </div>
          </div>

          {/* Divider */}
          <div className="mt-3 pt-3" style={{ borderTop: '1px solid rgba(0, 0, 0, 0.1)' }}>
            {/* Price direction header with switch button */}
            <div className="d-flex align-items-center">
              <strong>{priceLabel}</strong>
              <div onClick={(e) => e.stopPropagation()} className="d-flex align-items-center">
                <Button
                  variant="link"
                  className="p-0 ms-2"
                  size="sm"
                  onClick={() => setInvertPriceDisplay(!invertPriceDisplay)}
                  title="Switch price direction"
                  style={{ textDecoration: 'none', lineHeight: '1' }}
                >
                  <span role="img" aria-label="switch">⇄</span>
                </Button>
              </div>
            </div>

            {/* Price Range Chart */}
            <PriceRangeChart
              lowerPrice={displayLowerPrice}
              upperPrice={displayUpperPrice}
              currentPrice={currentPrice}
              token0Symbol={token0Data?.symbol}
              token1Symbol={token1Data?.symbol}
              isInverted={invertPriceDisplay}
              isActive={isActive}
            />
          </div>

          {/* Divider */}
          <div className="mt-3 pt-3" style={{ borderTop: '1px solid rgba(0, 0, 0, 0.1)' }}>
            <div className="row g-3">
              {/* Token Balances */}
              <div className="col-6">
                <small className="d-block mb-2" style={{ fontSize: '0.875rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#0a0a0a', fontWeight: '700' }}>
                  Tokens
                </small>
                {isLoadingBalances ? (
                  <div className="text-secondary small" style={{ paddingLeft: '0.7rem' }}>
                    <Spinner animation="border" size="sm" className="me-2" />
                    Loading...
                  </div>
                ) : balanceError || !tokenBalances ? (
                  <div className="text-danger small" style={{ paddingLeft: '0.7rem' }}>
                    Error loading balances
                  </div>
                ) : (
                  <div style={{ fontSize: '0.8125rem', color: '#0a0a0a', paddingLeft: '0.7rem' }}>
                    <div className="mb-1">
                      <strong style={{ color: 'var(--crimson-700)' }}>{token0Data.symbol}:</strong>{' '}
                      <span style={{ color: '#525252' }}>{parseFloat(tokenBalances.token0.formatted).toFixed(4)}</span>
                    </div>
                    <div className="mb-1">
                      <strong style={{ color: 'var(--crimson-700)' }}>{token1Data.symbol}:</strong>{' '}
                      <span style={{ color: '#525252' }}>{parseFloat(tokenBalances.token1.formatted).toFixed(4)}</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Uncollected Fees */}
              <div className="col-6">
                <small className="d-block mb-2" style={{ fontSize: '0.875rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#0a0a0a', fontWeight: '700' }}>
                  Uncollected Fees
                </small>
                {feeLoadingError ? (
                  <div className="text-danger small" style={{ paddingLeft: '0.7rem' }}>
                    <i className="me-1">⚠️</i>
                    Unable to load fees
                  </div>
                ) : isLoadingFees ? (
                  <div className="text-secondary small" style={{ paddingLeft: '0.7rem' }}>
                    <Spinner animation="border" size="sm" className="me-2" />
                    Loading...
                  </div>
                ) : uncollectedFees ? (
                  <div style={{ fontSize: '0.8125rem', color: '#0a0a0a', paddingLeft: '0.7rem' }}>
                    <div className="mb-1">
                      <strong style={{ color: 'var(--crimson-700)' }}>{token0Data.symbol}:</strong>{' '}
                      <span style={{ color: '#525252' }}>{formatFeeDisplay(parseFloat(uncollectedFees.token0.formatted))}</span>
                    </div>
                    <div className="mb-1">
                      <strong style={{ color: 'var(--crimson-700)' }}>{token1Data.symbol}:</strong>{' '}
                      <span style={{ color: '#525252' }}>{formatFeeDisplay(parseFloat(uncollectedFees.token1.formatted))}</span>
                    </div>
                  </div>
                ) : (
                  <div className="text-secondary small" style={{ paddingLeft: '0.7rem' }}>
                    Fee data unavailable
                  </div>
                )}
              </div>
            </div>
          </div>
        </Card.Body>
      </Card>
    </>
  );
}
