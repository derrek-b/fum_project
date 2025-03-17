import React, { useMemo, useState, useEffect } from "react";
import ReactDOM from 'react-dom';
import { Card, Button, Spinner, Badge, Modal } from "react-bootstrap";
import { useSelector, useDispatch } from "react-redux";
import { useRouter } from "next/router";
import { AdapterFactory } from "../adapters";
import { formatPrice, formatFeeDisplay } from "../utils/formatHelpers";
import { fetchTokenPrices } from "../utils/coingeckoUtils";
import RemoveLiquidityModal from "./RemoveLiquidityModal";
import { triggerUpdate } from "../redux/updateSlice";

export default function PositionCard({ position }) {
  const dispatch = useDispatch();
  const router = useRouter();
  const { address, chainId, provider } = useSelector((state) => state.wallet);
  const pools = useSelector((state) => state.pools);
  const tokens = useSelector((state) => state.tokens);
  const poolData = pools[position.poolAddress];
  const token0Data = poolData?.token0 ? tokens[poolData.token0] : null;
  const token1Data = poolData?.token1 ? tokens[poolData.token1] : null;

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
    ? `${token0Data?.symbol} per ${token1Data?.symbol}`
    : `${token1Data?.symbol} per ${token0Data?.symbol}`;

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

        setTokenBalances(balances);
        setIsLoadingBalances(false);
      } catch (error) {
        console.error("Error calculating token balances:", error);
        setBalanceError(true);
        setIsLoadingBalances(false);
      }
    };

    calculateBalances();
  }, [adapter, position, poolData, token0Data, token1Data, chainId]);

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

  // State for modals
  const [showActionsModal, setShowActionsModal] = useState(false);
  const [showRemoveLiquidityModal, setShowRemoveLiquidityModal] = useState(false);

  // State for claiming process
  const [isClaiming, setIsClaiming] = useState(false);
  const [claimError, setClaimError] = useState(null);
  const [claimSuccess, setClaimSuccess] = useState(false);

  // State for removing liquidity process
  const [isRemoving, setIsRemoving] = useState(false);
  const [removeError, setRemoveError] = useState(null);
  const [removeSuccess, setRemoveSuccess] = useState(false);

  // Function to claim fees using the adapter
  const claimFees = async () => {
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

  // Function to handle removing liquidity
  const handleRemoveLiquidity = async (percentage) => {
    if (!adapter) {
      setRemoveError("No adapter available for this position");
      return;
    }

    setRemoveError(null);
    setRemoveSuccess(false);
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
          setRemoveSuccess(true);
          setShowRemoveLiquidityModal(false);
          dispatch(triggerUpdate()); // Refresh data
        },
        onError: (errorMessage) => {
          setRemoveError(`Failed to remove liquidity: ${errorMessage}`);
          setShowRemoveLiquidityModal(false);
        }
      });
    } catch (error) {
      console.error("Error removing liquidity:", error);
      setRemoveError(`Error removing liquidity: ${error.message}`);
      setIsRemoving(false);
    }
  };

  // Handle card click to navigate to detail page
  const handleCardClick = () => {
    router.push(`/position/${position.id}`);
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

  if (!poolData || !token0Data || !token1Data) {
    return <Card><Card.Body>Loading position data or data unavailable...</Card.Body></Card>;
  }

  return (
    <>
      <Card
        className="mb-3"
        style={{
          backgroundColor: "#f5f5f5",
          borderColor: "#a30000",
          cursor: "pointer"
        }}
        onClick={handleCardClick}
      >
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
            <div onClick={(e) => e.stopPropagation()}>
              <Button
                variant="outline-secondary"
                size="sm"
                onClick={() => setShowActionsModal(true)}
                aria-label="Position actions"
              >
                <span role="img" aria-label="menu">🔧</span>
              </Button>
            </div>
          </div>

          {/* Price Range Display */}
          <div className="mb-2">
            <div className="d-flex align-items-center">
              <strong className="me-2">Price Range:</strong>
              <span>
                {displayLowerPrice === "N/A" ? "N/A" : formatPrice(displayLowerPrice)} - {displayUpperPrice === "N/A" ? "N/A" : formatPrice(displayUpperPrice)} {priceLabel}
              </span>
              <div onClick={(e) => e.stopPropagation()}>
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
          </div>

          <Card.Text>
            <strong>Current Price:</strong> {currentPrice === "N/A" ? "N/A" : formatPrice(parseFloat(currentPrice))} {priceLabel}<br />
            <strong>Uncollected Fees:</strong>
          </Card.Text>

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
        </Card.Body>
      </Card>

      {/* The Actions Modal - rendered completely outside the Card component */}
      {ReactDOM.createPortal(
        <Modal
          show={showActionsModal}
          onHide={() => setShowActionsModal(false)}
          size="sm"
          centered
          backdrop="static"
        >
          <Modal.Header closeButton>
            <Modal.Title>Position #{position.id} Actions</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <div className="d-grid gap-2">
              <Button
                variant={claimSuccess ? "success" : "primary"}
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

              <Button
                variant="outline-primary"
                disabled
              >
                Add Liquidity
              </Button>

              <Button
                variant="outline-primary"
                disabled={isRemoving || !tokenBalances || balanceError ||
                        (tokenBalances &&
                          parseFloat(tokenBalances.token0.formatted) < 0.0001 &&
                          parseFloat(tokenBalances.token1.formatted) < 0.0001)}
                onClick={() => {
                  setShowActionsModal(false);
                  setTimeout(() => {
                    setShowRemoveLiquidityModal(true);
                  }, 100);
                }}
              >
                {isRemoving ? "Removing..." : "Remove Liquidity"}
              </Button>

              <Button
                variant="outline-danger"
                disabled
              >
                Close Position
              </Button>
            </div>

            {(claimError || removeError) && (
              <div className="alert alert-danger mt-2 p-2 small" role="alert">
                {claimError || removeError}
              </div>
            )}

            {(claimSuccess || removeSuccess) && (
              <div className="alert alert-success mt-2 p-2 small" role="alert">
                {claimSuccess ? "Successfully claimed fees!" : "Successfully removed liquidity!"}
              </div>
            )}
          </Modal.Body>
        </Modal>,
        document.body
      )}

      {/* RemoveLiquidityModal - also rendered using portal */}
      {ReactDOM.createPortal(
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
          errorMessage={removeError}
        />,
        document.body
      )}
    </>
  );
}
