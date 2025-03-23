import React, { useMemo, useState, useEffect, useRef } from "react";
import ReactDOM from 'react-dom';
import { Card, Button, Spinner, Badge, Modal } from "react-bootstrap";
import { useSelector, useDispatch } from "react-redux";
import { useRouter } from "next/router";
import Image from "next/image";
import { AdapterFactory } from "../adapters";
import { formatPrice, formatFeeDisplay } from "../utils/formatHelpers";
import { fetchTokenPrices } from "../utils/coingeckoUtils";
import RemoveLiquidityModal from "./RemoveLiquidityModal";
import ClosePositionModal from "./ClosePositionModal";
import AddLiquidityModal from "./AddLiquidityModal";
import { triggerUpdate } from "../redux/updateSlice";
import config from "../utils/config";

export default function PositionCard({ position, inVault = false, vaultAddress = null }) {
  const dispatch = useDispatch();
  const router = useRouter();
  const { address, chainId, provider } = useSelector((state) => state.wallet);
  const pools = useSelector((state) => state.pools);
  const tokens = useSelector((state) => state.tokens);
  const poolData = pools[position.poolAddress];
  const token0Data = poolData?.token0 ? tokens[poolData.token0] : null;
  const token1Data = poolData?.token1 ? tokens[poolData.token1] : null;

  // Reference for the card and dropdown state
  const cardRef = useRef(null);
  const [showActionsDropdown, setShowActionsDropdown] = useState(false);

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

  // Add click outside handler
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (showActionsDropdown &&
          cardRef.current &&
          !cardRef.current.contains(event.target)) {
        setShowActionsDropdown(false);
      }
    };

    if (showActionsDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showActionsDropdown]);

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
        // Log detailed information before calculation
        console.log(`FEES ATTEMPT: Calculating fees for position ${position.id} (${position.inVault ? 'vault' : 'wallet'})`);

        // Check if poolData has ticks
        console.log(`Pool data for position ${position.id} has ticks:`,
          poolData && poolData.ticks ? `Yes (${Object.keys(poolData.ticks).length} ticks)` : 'No'
        );

        // Check if position's specific ticks exist in poolData
        const hasLowerTick = poolData?.ticks && poolData.ticks[position.tickLower];
        const hasUpperTick = poolData?.ticks && poolData.ticks[position.tickUpper];
        console.log(`Position ${position.id} ticks existence:`,
          `Lower tick (${position.tickLower}): ${hasLowerTick ? 'Yes' : 'No'}, ` +
          `Upper tick (${position.tickUpper}): ${hasUpperTick ? 'Yes' : 'No'}`
        );

        // Global fee growth data
        console.log(`Pool ${position.poolAddress} fee growth data:`,
          `Global0: ${poolData?.feeGrowthGlobal0X128 ? 'Yes' : 'No'}, ` +
          `Global1: ${poolData?.feeGrowthGlobal1X128 ? 'Yes' : 'No'}`
        );

        const fees = await adapter.calculateFees(position, poolData, token0Data, token1Data);

        console.log(`FEES SUCCESS: Calculated for position ${position.id}:`, fees);

        // Only update state if component is still mounted
        if (isMounted) {
          setUncollectedFees(fees);
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

  // State for modals
  const [showRemoveLiquidityModal, setShowRemoveLiquidityModal] = useState(false);
  const [showClosePositionModal, setShowClosePositionModal] = useState(false);
  const [showAddLiquidityModal, setShowAddLiquidityModal] = useState(false);

  // State for claiming process
  const [isClaiming, setIsClaiming] = useState(false);
  const [claimError, setClaimError] = useState(null);
  const [claimSuccess, setClaimSuccess] = useState(false);

  // State for removing liquidity process
  const [isRemoving, setIsRemoving] = useState(false);
  const [removeError, setRemoveError] = useState(null);
  const [removeSuccess, setRemoveSuccess] = useState(false);

  // State for closing position process
  const [isClosing, setIsClosing] = useState(false);
  const [closeError, setCloseError] = useState(null);
  const [closeSuccess, setCloseSuccess] = useState(false);

  // State for adding liquidity process
  const [isAdding, setIsAdding] = useState(false);
  const [addError, setAddError] = useState(null);
  const [addSuccess, setAddSuccess] = useState(false);

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

  // Function to handle closing position
  const handleClosePosition = async (shouldBurn) => {
    if (!adapter) {
      setCloseError("No adapter available for this position");
      return;
    }

    setCloseError(null);
    setCloseSuccess(false);
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
        burnPosition: shouldBurn, // Whether to burn the position NFT
        dispatch,
        onStart: () => setIsClosing(true),
        onFinish: () => setIsClosing(false),
        onSuccess: () => {
          setCloseSuccess(true);
          setShowClosePositionModal(false);
          setShowActionsDropdown(false);
          dispatch(triggerUpdate()); // Refresh data
        },
        onError: (errorMessage) => {
          setCloseError(`Failed to close position: ${errorMessage}`);
          setShowClosePositionModal(false);
        }
      });
    } catch (error) {
      console.error("Error closing position:", error);
      setCloseError(`Error closing position: ${error.message}`);
      setIsClosing(false);
    }
  };

  // Function to handle adding liquidity
  const handleAddLiquidity = async (params) => {
    if (!adapter) {
      setAddError("No adapter available for this position");
      return;
    }

    setAddError(null);
    setAddSuccess(false);
    setIsAdding(true);

    try {
      await adapter.addLiquidity({
        position,
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
        onStart: () => setIsAdding(true),
        onFinish: () => setIsAdding(false),
        onSuccess: () => {
          setAddSuccess(true);
          setShowAddLiquidityModal(false);
          setShowActionsDropdown(false);
          dispatch(triggerUpdate()); // Refresh data
        },
        onError: (errorMessage) => {
          setAddError(`Failed to add liquidity: ${errorMessage}`);
          setShowAddLiquidityModal(false);
        }
      });
    } catch (error) {
      console.error("Error adding liquidity:", error);
      setAddError(`Error adding liquidity: ${error.message}`);
      setIsAdding(false);
    }
  };

  // Handle card click to navigate to detail page
  const handleCardClick = () => {
    router.push(`/position/${position.id}`);
  };

  // Get card styling based on vault status
  const getCardStyle = () => {
    const baseStyle = {
      backgroundColor: "#f5f5f5",
      borderColor: "#a30000",
      cursor: "pointer"
    };

    // Add special styling for vault positions
    if (inVault) {
      return {
        ...baseStyle,
        borderWidth: "1px",
        borderStyle: "solid",
        borderColor: "black", // Gold border
        // Multi-layered box shadow for a glowing effect
        boxShadow: `
          0 0 7px rgba(255, 255, 255, 0.7),
          0 0 10px rgba(255, 215, 0, 0.6),
          0 0 21px rgba(255, 215, 0, 0.4)
        `,
        // Add subtle transition for hover effects
        transition: "all 0.2s ease-in-out"
      };
    }

    return baseStyle;
  };

  if (!poolData || !token0Data || !token1Data) {
    return <Card><Card.Body>Loading position data or data unavailable...</Card.Body></Card>;
  }

  // Get the platform color directly from config
  const platformColor = position.platform && config.platformMetadata[position.platform]?.color
                       ? config.platformMetadata[position.platform].color
                       : '#6c757d';

  // Debug log to verify color is being accessed correctly
  console.log(`Platform: ${position.platform}, Platform Name: ${position.platformName}, Color: ${platformColor}`);
  console.log(`Platform metadata:`, config.platformMetadata[position.platform]);

  return (
    <>
      <Card
        className="mb-3"
        style={getCardStyle()}
        onClick={handleCardClick}
        ref={cardRef}
      >
        <Card.Body>
          <div className="d-flex justify-content-between align-items-center mb-2">
            <Card.Title className="d-flex align-items-center">
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
              <span>Position #{position.id} - {position.tokenPair}</span>

              {/* Conditional display of either logo or badge */}
              {position.platform && (
                config.platformMetadata[position.platform]?.logo ? (
                  // Show logo if available
                  <div
                    className="ms-2 d-inline-flex align-items-center justify-content-center"
                    style={{
                      height: '20px',
                      width: '20px'
                    }}
                  >
                    <Image
                      src={config.platformMetadata[position.platform].logo}
                      alt={position.platformName || position.platform}
                      width={20}
                      height={20}
                      title={position.platformName || position.platform}
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
                    {position.platformName}
                  </Badge>
                )
              )}

              {/* Vault indicator with icon instead of badge */}
              {inVault && (
                <div
                  className="ms-2 d-inline-flex align-items-center justify-content-center"
                  title="Position is in a vault"
                >
                  <span
                    role="img"
                    aria-label="vault"
                    style={{ fontSize: '1rem' }}
                  >
                    🏦
                  </span>
                </div>
              )}
            </Card.Title>
            <div onClick={(e) => e.stopPropagation()} style={{ position: 'relative' }}>
              {inVault ? (
                <Button
                  variant="outline-secondary"
                  size="sm"
                  onClick={() => router.push(`/position/${position.id}`)}
                  aria-label="Vault position details"
                  title="Go to vault or details?"
                >
                  <span role="img" aria-label="vault">🤖</span>
                </Button>
              ) : (
                <Button
                  variant="outline-secondary"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowActionsDropdown(!showActionsDropdown);
                  }}
                  aria-label="Position actions"
                >
                  <span role="img" aria-label="menu">🔧</span>
                </Button>
              )}

              {/* Actions Dropdown Menu */}
              {!inVault && showActionsDropdown && (
                <div
                  style={{
                    position: 'absolute',
                    top: '35px',  // Position below the button
                    right: '0px', // Align with the right side of the card
                    zIndex: 1000,
                    width: '130px',
                    backgroundColor: 'white',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
                    borderRadius: '0.375rem',
                    padding: '0.5rem 0',
                    border: '1px solid rgba(0,0,0,0.1)'
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    className="dropdown-item d-flex align-items-center"
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      padding: '0.25rem',
                      border: 'none',
                      background: 'none',
                      fontSize: '14px',
                      cursor: isClaiming || !uncollectedFees || feeLoadingError ||
                        (uncollectedFees &&
                          parseFloat(uncollectedFees.token0.formatted) < 0.0001 &&
                          parseFloat(uncollectedFees.token1.formatted) < 0.0001) ? 'not-allowed' : 'pointer',
                      opacity: isClaiming || !uncollectedFees || feeLoadingError ||
                        (uncollectedFees &&
                          parseFloat(uncollectedFees.token0.formatted) < 0.0001 &&
                          parseFloat(uncollectedFees.token1.formatted) < 0.0001) ? 0.5 : 1,
                      color: claimSuccess ? '#198754' : 'inherit',
                    }}
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
                        <span>Claiming Fees...</span>
                      </>
                    ) : claimSuccess ? (
                      <>✓ Fees Claimed</>
                    ) : feeLoadingError ? (
                      <>Fee Data Unavailable</>
                    ) : (
                      <>Claim Fees</>
                    )}
                  </button>

                  <hr className="dropdown-divider my-1" style={{ margin: '0.25rem 0' }}/>

                  <button
                    className="dropdown-item"
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      padding: '0.25rem',
                      border: 'none',
                      background: 'none',
                      fontSize: '14px',
                      cursor: isAdding ? 'not-allowed' : 'pointer',
                      opacity: isAdding ? 0.5 : 1
                    }}
                    disabled={isAdding}
                    onClick={() => {
                      setShowActionsDropdown(false);
                      setTimeout(() => {
                        setShowAddLiquidityModal(true);
                      }, 100);
                    }}
                  >
                    {isAdding ? "Adding Liquidity..." : "Add Liquidity"}
                  </button>

                  <hr className="dropdown-divider my-1" style={{ margin: '0.25rem 0' }}/>

                  <button
                    className="dropdown-item"
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      padding: '0.25rem',
                      border: 'none',
                      background: 'none',
                      fontSize: '14px',
                      cursor: (isRemoving || !tokenBalances || balanceError ||
                        (tokenBalances &&
                          parseFloat(tokenBalances.token0.formatted) < 0.0001 &&
                          parseFloat(tokenBalances.token1.formatted) < 0.0001)) ? 'not-allowed' : 'pointer',
                      opacity: (isRemoving || !tokenBalances || balanceError ||
                        (tokenBalances &&
                          parseFloat(tokenBalances.token0.formatted) < 0.0001 &&
                          parseFloat(tokenBalances.token1.formatted) < 0.0001)) ? 0.5 : 1
                    }}
                    disabled={isRemoving || !tokenBalances || balanceError ||
                      (tokenBalances &&
                        parseFloat(tokenBalances.token0.formatted) < 0.0001 &&
                        parseFloat(tokenBalances.token1.formatted) < 0.0001)}
                    onClick={() => {
                      setShowActionsDropdown(false);
                      setTimeout(() => {
                        setShowRemoveLiquidityModal(true);
                      }, 100);
                    }}
                  >
                    {isRemoving ? "Removing Liquidity..." : "Remove Liquidity"}
                  </button>

                  <hr className="dropdown-divider my-1" style={{ margin: '0.25rem 0' }}/>

                  <button
                    className="dropdown-item"
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      padding: '0.25rem',
                      border: 'none',
                      background: 'none',
                      fontSize: '14px',
                      cursor: isClosing ? 'not-allowed' : 'pointer',
                      opacity: isClosing ? 0.5 : 1,
                      color: '#dc3545'  // Red color for danger action
                    }}
                    disabled={isClosing}
                    onClick={() => {
                      setShowActionsDropdown(false);
                      setTimeout(() => {
                        setShowClosePositionModal(true);
                      }, 100);
                    }}
                  >
                    {isClosing ? "Closing Position..." : "Close Position"}
                  </button>

                  {(claimError || removeError || closeError || addError) && (
                    <div className="alert alert-danger mt-2 mx-2 p-2 small" role="alert">
                      {claimError || removeError || closeError || addError}
                    </div>
                  )}

                  {(claimSuccess || removeSuccess || closeSuccess || addSuccess) && (
                    <div className="alert alert-success mt-2 mx-2 p-2 small" role="alert">
                      {claimSuccess ? "Successfully claimed fees!" :
                      removeSuccess ? "Successfully removed liquidity!" :
                      closeSuccess ? "Successfully closed position!" :
                      "Successfully added liquidity!"}
                    </div>
                  )}
                </div>
              )}
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
                Unable to load fee data
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
            ) : (
              // No fee data available, but not an error
              <div className="text-secondary small">
                Fee data unavailable
              </div>
            )}
          </div>
        </Card.Body>
      </Card>

      {/* RemoveLiquidityModal */}
      {!inVault && ReactDOM.createPortal(
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

      {/* ClosePositionModal */}
      {!inVault && ReactDOM.createPortal(
        <ClosePositionModal
          show={showClosePositionModal}
          onHide={() => setShowClosePositionModal(false)}
          position={position}
          tokenBalances={tokenBalances}
          uncollectedFees={uncollectedFees}
          token0Data={token0Data}
          token1Data={token1Data}
          tokenPrices={tokenPrices}
          isClosing={isClosing}
          onClosePosition={handleClosePosition}
          errorMessage={closeError}
        />,
        document.body
      )}

      {/* AddLiquidityModal */}
      {!inVault && ReactDOM.createPortal(
        <AddLiquidityModal
          show={showAddLiquidityModal}
          onHide={() => setShowAddLiquidityModal(false)}
          position={position}
          poolData={poolData}
          token0Data={token0Data}
          token1Data={token1Data}
          tokenPrices={tokenPrices}
          isProcessing={isAdding}
          onAddLiquidity={handleAddLiquidity}
          errorMessage={addError}
        />,
        document.body
      )}
    </>
  );
}
