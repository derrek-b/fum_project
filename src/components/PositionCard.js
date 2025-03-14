import React, { useMemo, useState, useEffect } from "react";
import { Card, Button, Spinner, Badge } from "react-bootstrap";
import { useSelector, useDispatch } from "react-redux";
import { AdapterFactory } from "../adapters";
import { formatPrice, formatFeeDisplay } from "../utils/formatHelpers";

export default function PositionCard({ position, provider }) {
  const dispatch = useDispatch();
  const { address, chainId } = useSelector((state) => state.wallet);
  const pools = useSelector((state) => state.pools);
  const tokens = useSelector((state) => state.tokens);
  const poolData = pools[position.poolAddress] || {};
  const token0Data = tokens[poolData.token0] || { decimals: 0, symbol: '?' };
  const token1Data = tokens[poolData.token1] || { decimals: 0, symbol: '?' };

  // Get the appropriate adapter for this position
  const adapter = useMemo(() => {
    if (!position.platform || !provider) return null;
    try {
      return AdapterFactory.getAdapter(position.platform, provider);
    } catch (error) {
      console.error(`Failed to get adapter for position ${position.id}:`, error);
      return null;
    }
  }, [position.platform, provider]);

  // Use adapter for position-specific calculations
  const isActive = useMemo(() => {
    if (!adapter) return false;
    return adapter.isPositionInRange(position, poolData);
  }, [adapter, position, poolData]);

  // State for price display direction
  const [invertPriceDisplay, setInvertPriceDisplay] = useState(false);

  // Calculate price information using the adapter
  const priceInfo = useMemo(() => {
    if (!adapter) return { currentPrice: "N/A", lowerPrice: "N/A", upperPrice: "N/A" };

    return adapter.calculatePrice(
      position,
      poolData,
      token0Data,
      token1Data,
      invertPriceDisplay
    );
  }, [adapter, position, poolData, token0Data, token1Data, invertPriceDisplay]);

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
  const priceLabel = invertPriceDisplay
    ? `${token0Data.symbol} per ${token1Data.symbol}`
    : `${token1Data.symbol} per ${token0Data.symbol}`;

  // State for fee calculation errors
  const [feeLoadingError, setFeeLoadingError] = useState(false);

  // Calculate uncollected fees using the adapter
  const [uncollectedFees, setUncollectedFees] = useState(null);
  const [isLoadingFees, setIsLoadingFees] = useState(false);

  useEffect(() => {
    let isMounted = true;
    setIsLoadingFees(true);
    setFeeLoadingError(false);

    if (!adapter) {
      setFeeLoadingError(true);
      setIsLoadingFees(false);
      return;
    }

    const loadFees = async () => {
      try {
        const fees = await adapter.calculateFees(position, poolData, token0Data, token1Data);

        // Only update state if component is still mounted
        if (isMounted) {
          setUncollectedFees(fees);
          setIsLoadingFees(false);
        }
      } catch (error) {
        console.error("Error calculating fees for position", position.id, ":", error);
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

  // State to toggle panel visibility
  const [isPanelVisible, setIsPanelVisible] = useState(false);

  // Function to toggle panel visibility
  const togglePanel = () => setIsPanelVisible(!isPanelVisible);

  // State for claiming process
  const [isClaiming, setIsClaiming] = useState(false);
  const [claimError, setClaimError] = useState(null);
  const [claimSuccess, setClaimSuccess] = useState(false);

  // Function to claim fees using the adapter
  const claimFees = async (e) => {
    if (e) e.preventDefault();
    if (!adapter) {
      setClaimError("No adapter available for this position");
      return;
    }

    adapter.claimFees({
      position,
      provider,
      address,
      chainId,
      poolData,
      token0Data,
      token1Data,
      dispatch,
      onStart: () => {
        setIsClaiming(true);
        setClaimError(null);
        setClaimSuccess(false);
      },
      onFinish: () => {
        setIsClaiming(false);
      },
      onSuccess: () => {
        setClaimSuccess(true);
      },
      onError: (errorMessage) => {
        setClaimError(`Failed to claim fees: ${errorMessage}`);
      }
    });
  };

  // Prepare activity badge
  const activityIndicator = (
    <span
      style={{
        display: 'inline-block',
        width: '10px',
        height: '10px',
        borderRadius: '50%',
        backgroundColor: isActive ? '#28a745' : '#dc3545',
        marginLeft: '8px',
        marginRight: '4px'
      }}
      title={isActive ? "In range" : "Out of range"}
    />
  );

  console.log('Fee calculation result:', {
    position: position.id,
    feeLoadingError,
    uncollectedFees: JSON.stringify(uncollectedFees, (key, value) =>
      typeof value === 'bigint' ? value.toString() : value
    )
  });

  return (
    <Card className="mb-3" style={{ backgroundColor: "#f5f5f5", borderColor: "#a30000" }}>
      <Card.Body>
        <div className="d-flex justify-content-between align-items-center mb-2">
          <Card.Title>
            Position #{position.id} - {position.tokenPair}
            {activityIndicator}
            {position.platformName && (
              <Badge bg="secondary" className="ms-2" style={{ fontSize: '0.7rem' }}>
                {position.platformName}
              </Badge>
            )}
          </Card.Title>
          <Button
            variant="outline-secondary"
            size="sm"
            onClick={togglePanel}
            aria-label="Position actions"
          >
            <span role="img" aria-label="menu">🔧</span>
          </Button>
        </div>

        {/* Price Range Display */}
        <div className="mb-2">
          <div className="d-flex align-items-center">
            <strong className="me-2">Price Range:</strong>
            <span>
              {displayLowerPrice === "N/A" ? "N/A" : formatPrice(displayLowerPrice)} - {displayUpperPrice === "N/A" ? "N/A" : formatPrice(displayUpperPrice)} {priceLabel}
            </span>
            <Button
              variant="link"
              className="p-0 ms-2"
              size="sm"
              onClick={() => setInvertPriceDisplay(!invertPriceDisplay)}
              title="Switch price direction"
            >
              <span role="img" aria-label="switch">⇄</span>
            </Button>
          </div>
        </div>

        <Card.Text>
          <strong>Current Price:</strong> {currentPrice === "N/A" ? "N/A" : formatPrice(parseFloat(currentPrice))} {priceLabel}<br />
          <strong>Uncollected Fees:</strong>
        </Card.Text>

        {/* Move the div outside of CardText */}
        <div className="ps-3 mt-1 mb-2">
          {feeLoadingError ? (
            <div className="text-danger small">
              <i className="me-1">⚠️</i>
              Unable to load fee data. Please try refreshing.
            </div>
          ) : isLoadingFees ? (
            <div className="text-secondary small">
              <Spinner animation="border" size="sm" className="me-2" />
              Loading fee data...
            </div>
          ) : uncollectedFees ? (
            <>
              <Badge bg="light" text="dark" className="me-1">
                {formatFeeDisplay(uncollectedFees.token0.formatted)} {token0Data.symbol}
              </Badge>
              <Badge bg="light" text="dark">
                {formatFeeDisplay(uncollectedFees.token1.formatted)} {token1Data.symbol}
              </Badge>
            </>
          ) : null}
        </div>

        {isPanelVisible && (
          <div
            style={{
              marginTop: "1rem",
              padding: "0.75rem",
              backgroundColor: "#fff",
              border: "1px solid #dee2e6",
              borderRadius: "0.375rem",
            }}
          >
            <div className="d-grid gap-2">
              <Button
                variant={claimSuccess ? "success" : "primary"}
                size="sm"
                disabled={isClaiming || !uncollectedFees || feeLoadingError ||
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
                ) : claimSuccess ? (
                  <>✓ Fees Claimed</>
                ) : feeLoadingError ? (
                  <>Fee Data Unavailable</>
                ) : (
                  <>Claim Fees</>
                )}
              </Button>

              <Button variant="outline-primary" size="sm" disabled>
                Add Liquidity
              </Button>

              <Button variant="outline-primary" size="sm" disabled>
                Remove Liquidity
              </Button>

              <Button variant="outline-danger" size="sm" disabled>
                Close Position
              </Button>
            </div>

            {claimError && (
              <div className="alert alert-danger mt-2 p-2 small" role="alert">
                {claimError}
              </div>
            )}

            {claimSuccess && (
              <div className="alert alert-success mt-2 p-2 small" role="alert">
                Successfully claimed fees!
              </div>
            )}
          </div>
        )}
      </Card.Body>
    </Card>
  );
}
