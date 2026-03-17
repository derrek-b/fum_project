import React, { useMemo, useState, useEffect } from "react";
import { Card, Spinner, Badge, Button } from "react-bootstrap";
import { useRouter } from "next/router";

// FUM Library imports
import { formatFeeDisplay } from "fum_library/helpers/formatHelpers";
import { fetchTokenPrices, CACHE_DURATIONS } from "fum_library/services/coingecko";
import { getPlatformColor, getPlatformLogo, getPlatformName } from "fum_library/helpers/platformHelpers";

// Local imports
import PriceRangeChart from "../common/PriceRangeChart";

export default function PositionCard({ position, inVault = false, vaultAddress = null }) {
  const router = useRouter();

  // Extract token symbols from the pre-computed tokenPair
  const [token0Symbol, token1Symbol] = position.tokenPair.split('/');

  // Use pre-computed in-range status from adapter
  const isActive = position.inRange;

  // State for price display direction
  const [invertPriceDisplay, setInvertPriceDisplay] = useState(false);

  // Price info from pre-computed position data, with inversion support
  const priceInfo = useMemo(() => {
    const { currentPrice, priceLower, priceUpper } = position;
    if (invertPriceDisplay) {
      return {
        currentPrice: 1 / currentPrice,
        lowerPrice: 1 / priceUpper,   // swap bounds when inverting
        upperPrice: 1 / priceLower,
      };
    }
    return {
      currentPrice,
      lowerPrice: priceLower,
      upperPrice: priceUpper,
    };
  }, [position.currentPrice, position.priceLower, position.priceUpper, invertPriceDisplay]);

  // Set price direction labels
  const priceLabel = invertPriceDisplay
    ? `${token1Symbol} per ${token0Symbol}`
    : `${token0Symbol} per ${token1Symbol}`;

  // State for token prices (for USD values)
  const [tokenPrices, setTokenPrices] = useState({
    token0: null,
    token1: null,
    loading: false,
    error: null
  });

  // Fetch token prices
  useEffect(() => {
    if (!token0Symbol || !token1Symbol) return;

    const getPrices = async () => {
      setTokenPrices(prev => ({ ...prev, loading: true, error: null }));

      try {
        const tokenSymbols = [token0Symbol, token1Symbol];
        const prices = await fetchTokenPrices(tokenSymbols, CACHE_DURATIONS['2-MINUTES']);

        setTokenPrices({
          token0: prices[token0Symbol],
          token1: prices[token1Symbol],
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
  }, [token0Symbol, token1Symbol]);

  // Calculate position TVL
  const positionTVL = useMemo(() => {
    if (!tokenPrices.token0 || !tokenPrices.token1 || tokenPrices.loading || tokenPrices.error) {
      return null;
    }

    try {
      const token0Value = position.token0Amount * tokenPrices.token0;
      const token1Value = position.token1Amount * tokenPrices.token1;
      return token0Value + token1Value;
    } catch (error) {
      console.error("Error calculating position TVL:", error);
      return null;
    }
  }, [position.token0Amount, position.token1Amount, tokenPrices]);

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
              {tokenPrices.loading ? (
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
              lowerPrice={priceInfo.lowerPrice}
              upperPrice={priceInfo.upperPrice}
              currentPrice={priceInfo.currentPrice}
              token0Symbol={token0Symbol}
              token1Symbol={token1Symbol}
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
                <div style={{ fontSize: '0.8125rem', color: '#0a0a0a', paddingLeft: '0.7rem' }}>
                  <div className="mb-1">
                    <strong style={{ color: 'var(--crimson-700)' }}>{token0Symbol}:</strong>{' '}
                    <span style={{ color: '#525252' }}>{position.token0Amount.toFixed(4)}</span>
                  </div>
                  <div className="mb-1">
                    <strong style={{ color: 'var(--crimson-700)' }}>{token1Symbol}:</strong>{' '}
                    <span style={{ color: '#525252' }}>{position.token1Amount.toFixed(4)}</span>
                  </div>
                </div>
              </div>

              {/* Uncollected Fees */}
              <div className="col-6">
                <small className="d-block mb-2" style={{ fontSize: '0.875rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#0a0a0a', fontWeight: '700' }}>
                  Uncollected Fees
                </small>
                <div style={{ fontSize: '0.8125rem', color: '#0a0a0a', paddingLeft: '0.7rem' }}>
                  <div className="mb-1">
                    <strong style={{ color: 'var(--crimson-700)' }}>{token0Symbol}:</strong>{' '}
                    <span style={{ color: '#525252' }}>{formatFeeDisplay(position.uncollectedFees0)}</span>
                  </div>
                  <div className="mb-1">
                    <strong style={{ color: 'var(--crimson-700)' }}>{token1Symbol}:</strong>{' '}
                    <span style={{ color: '#525252' }}>{formatFeeDisplay(position.uncollectedFees1)}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Card.Body>
      </Card>
    </>
  );
}
