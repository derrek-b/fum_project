import React, { useMemo, useState, useEffect, useRef } from "react";
import ReactDOM from 'react-dom';
import { Card, Button, Spinner, Badge, Toast, ToastContainer } from "react-bootstrap";
import { useSelector, useDispatch } from "react-redux";
import { useRouter } from "next/router";
import Image from "next/image";
import { AdapterFactory } from "../../adapters";
import { formatPrice, formatFeeDisplay } from "../../utils/formatHelpers";
import { fetchTokenPrices } from "../../utils/coingeckoUtils";
import ClaimFeesModal from "./ClaimFeesModal";
import RemoveLiquidityModal from "./RemoveLiquidityModal";
import ClosePositionModal from "./ClosePositionModal";
import AddLiquidityModal from "./AddLiquidityModal";
import { triggerUpdate } from "../../redux/updateSlice";
import config from "../../utils/config";
import Logo from "../../../public/Logo.svg"

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

  // Toast state
  const [showSuccessToast, setShowSuccessToast] = useState(false);
  const [showErrorToast, setShowErrorToast] = useState(false);
  const [toastMessage, setToastMessage] = useState("");
  const [toastTxHash, setToastTxHash] = useState("");

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

  // State for action processing
  const [isClaiming, setIsClaiming] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [isAdding, setIsAdding] = useState(false);

  // Toast helper functions
  const showSuccessToastWithMessage = (message, txHash = "") => {
    setToastMessage(message);
    setToastTxHash(txHash);
    setShowSuccessToast(true);

    // Auto-close after 5 seconds
    setTimeout(() => setShowSuccessToast(false), 5000);
  };

  const showErrorToastWithMessage = (errorMessage) => {
    // Try to make error message user-friendly
    let userFriendlyError = errorMessage;

    // Common error mappings
    if (errorMessage?.includes("user rejected transaction")) {
      userFriendlyError = "Transaction was rejected in your wallet.";
    } else if (errorMessage?.includes("insufficient funds")) {
      userFriendlyError = "Insufficient funds for transaction.";
    } else if (errorMessage?.includes("price slippage check")) {
      userFriendlyError = "Price changed too much during transaction. Try again or increase slippage tolerance.";
    } else if (errorMessage?.length > 100) {
      // Truncate very long error messages
      userFriendlyError = errorMessage.substring(0, 100) + "...";
    }

    setToastMessage(userFriendlyError);
    setShowErrorToast(true);

    // Auto-close after 5 seconds
    setTimeout(() => setShowErrorToast(false), 5000);
  };

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
        // Check if position's specific ticks exist in poolData
        const fees = await adapter.calculateFees(position, poolData, token0Data, token1Data);

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
  const [showClaimFeesModal, setShowClaimFeesModal] = useState(false);
  const [showRemoveLiquidityModal, setShowRemoveLiquidityModal] = useState(false);
  const [showClosePositionModal, setShowClosePositionModal] = useState(false);
  const [showAddLiquidityModal, setShowAddLiquidityModal] = useState(false);

  // Function to claim fees using the adapter
  const claimFees = async () => {
    if (!adapter) {
      showErrorToastWithMessage("No adapter available for this position");
      return;
    }

    setIsClaiming(true);
    setShowActionsDropdown(false);

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
      },
      onFinish: () => {
        setIsClaiming(false);
      },
      onSuccess: (result) => {
        // Show success toast with transaction hash if available
        const txHash = result?.tx?.hash;
        showSuccessToastWithMessage("Successfully claimed fees!", txHash);
        dispatch(triggerUpdate()); // Refresh data
      },
      onError: (errorMessage) => {
        showErrorToastWithMessage(errorMessage);
        setIsClaiming(false);
      }
    });
  };

  // Handle card click to navigate to detail page
  const handleCardClick = () => {
    router.push(`/position/${position.id}`);
  };

  // Get explorer URL based on chainId
  const getExplorerUrl = (txHash) => {
    if (!txHash || !chainId) return "#";

    const explorers = {
      1: "https://etherscan.io/tx/",
      42161: "https://arbiscan.io/tx/"
    };

    return (explorers[chainId] || "#") + txHash;
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
        borderColor: "black", // Gold border
        // Multi-layered box shadow for a glowing effect
        boxShadow: `
          0 0 7px rgba(0, 128, 128, 0.4),
          0 0 10px rgba(0, 128, 128, 0.6),
          0 0 21px rgba(255, 255, 255, 0.9)
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
                  className="ms-2 d-inline-flex align-items-center pb-1"
                  title="Position is in a vault"
                >
                  <span

                  >
                    <Image width={18} height={18} alt="Vault indicator" src={Logo} />
                  </span>
                </div>
              )}
            </Card.Title>
            <div onClick={(e) => e.stopPropagation()} style={{ position: 'relative' }}>
              {inVault ? (
                <Button
                  variant="outline-secondary"
                  size="sm"
                  onClick={() => router.push(`/vault/${position.vaultAddress}`)}
                  aria-label="Vault position details"
                  title="Go to vault"
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
                  title="Position actions"
                >
                  <span role="img" aria-label="menu">🔧</span>
                </Button>
              )}

              {/* Actions Dropdown Menu - Simplified with link-like elements */}
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
                  {/* Claim Fees Link */}
                  <a
                    className="dropdown-item"
                    style={{
                      display: 'block',
                      width: '100%',
                      textAlign: 'left',
                      padding: '0.12rem 0.7rem',
                      fontSize: '0.9rem',
                      cursor: !uncollectedFees || feeLoadingError ||
                        (uncollectedFees &&
                          parseFloat(uncollectedFees.token0.formatted) < 0.0001 &&
                          parseFloat(uncollectedFees.token1.formatted) < 0.0001) ? 'not-allowed' : 'pointer',
                      opacity: !uncollectedFees || feeLoadingError ||
                        (uncollectedFees &&
                          parseFloat(uncollectedFees.token0.formatted) < 0.0001 &&
                          parseFloat(uncollectedFees.token1.formatted) < 0.0001) ? 0.5 : 1,
                      color: 'inherit',
                      textDecoration: 'none'
                    }}
                    onClick={!uncollectedFees || feeLoadingError ||
                      (uncollectedFees &&
                        parseFloat(uncollectedFees.token0.formatted) < 0.0001 &&
                        parseFloat(uncollectedFees.token1.formatted) < 0.0001)
                      ? (e) => e.preventDefault()
                      : () => {
                          setShowActionsDropdown(false);
                          setTimeout(() => {
                            setShowClaimFeesModal(true);
                          }, 100);
                        }}
                    href="#"
                  >
                    Claim Fees
                  </a>

                  {/* Add Liquidity Link */}
                  <a
                    className="dropdown-item"
                    style={{
                      display: 'block',
                      width: '100%',
                      textAlign: 'left',
                      padding: '0.12rem 0.7rem',
                      fontSize: '0.9rem',
                      cursor: 'pointer',
                      textDecoration: 'none'
                    }}
                    href="#"
                    onClick={() => {
                      setShowActionsDropdown(false);
                      setTimeout(() => {
                        setShowAddLiquidityModal(true);
                      }, 100);
                    }}
                  >
                    Add Liquidity
                  </a>

                  {/* Remove Liquidity Link */}
                  <a
                    className="dropdown-item"
                    style={{
                      display: 'block',
                      width: '100%',
                      textAlign: 'left',
                      padding: '0.12rem 0.7rem',
                      fontSize: '0.9rem',
                      cursor: !tokenBalances || balanceError ||
                        (tokenBalances &&
                          parseFloat(tokenBalances.token0.formatted) < 0.0001 &&
                          parseFloat(tokenBalances.token1.formatted) < 0.0001) ? 'not-allowed' : 'pointer',
                      opacity: !tokenBalances || balanceError ||
                        (tokenBalances &&
                          parseFloat(tokenBalances.token0.formatted) < 0.0001 &&
                          parseFloat(tokenBalances.token1.formatted) < 0.0001) ? 0.5 : 1,
                      textDecoration: 'none'
                    }}
                    href="#"
                    onClick={!tokenBalances || balanceError ||
                      (tokenBalances &&
                        parseFloat(tokenBalances.token0.formatted) < 0.0001 &&
                        parseFloat(tokenBalances.token1.formatted) < 0.0001)
                      ? (e) => e.preventDefault()
                      : () => {
                          setShowActionsDropdown(false);
                          setTimeout(() => {
                            setShowRemoveLiquidityModal(true);
                          }, 100);
                        }}
                  >
                    Remove Liquidity
                  </a>

                  {/* Close Position Link */}
                  <a
                    className="dropdown-item"
                    style={{
                      display: 'block',
                      width: '100%',
                      textAlign: 'left',
                      padding: '0.12rem 0.7rem',
                      fontSize: '0.9rem',
                      cursor: 'pointer',
                      color: '#dc3545',  // Red color for danger action
                      textDecoration: 'none'
                    }}
                    href="#"
                    onClick={() => {
                      setShowActionsDropdown(false);
                      setTimeout(() => {
                        setShowClosePositionModal(true);
                      }, 100);
                    }}
                  >
                    Close Position
                  </a>
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

      {/* Toast Containers */}
      <ToastContainer
        className="position-fixed"
        position="top-center"
        style={{ zIndex: 2000 }}
      >
        {/* Success Toast */}
        <Toast
          show={showSuccessToast}
          onClose={() => setShowSuccessToast(false)}
          bg="success"
          text="white"
        >
          <Toast.Header>
            <strong className="me-auto">Success</strong>
          </Toast.Header>
          <Toast.Body>
            {toastMessage}
            {toastTxHash && (
              <div className="mt-1">
                <a
                  href={getExplorerUrl(toastTxHash)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-white text-decoration-underline"
                >
                  View Transaction
                </a>
              </div>
            )}
          </Toast.Body>
        </Toast>

        {/* Error Toast */}
        <Toast
          show={showErrorToast}
          onClose={() => setShowErrorToast(false)}
          bg="danger"
          text="white"
        >
          <Toast.Header>
            <strong className="me-auto">Error</strong>
          </Toast.Header>
          <Toast.Body>
            {toastMessage}
          </Toast.Body>
        </Toast>
      </ToastContainer>

      {/* ClaimFeesModal - for consistent fee claiming experience */}
      {!inVault && ReactDOM.createPortal(
        <ClaimFeesModal
          show={showClaimFeesModal}
          onHide={() => setShowClaimFeesModal(false)}
          position={position}
          uncollectedFees={uncollectedFees}
          token0Data={token0Data}
          token1Data={token1Data}
          tokenPrices={tokenPrices}
          poolData={poolData}
        />,
        document.body
      )}

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
        poolData={poolData}
      />,
      document.body
      )}

      {/* ClosePositionModal - refactored to handle the adapter calls directly */}
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
          poolData={poolData}
        />,
        document.body
      )}

      {/* AddLiquidityModal - refactored to handle the adapter calls directly */}
      {!inVault && ReactDOM.createPortal(
      <AddLiquidityModal
        show={showAddLiquidityModal}
        onHide={() => setShowAddLiquidityModal(false)}
        position={position}
        poolData={poolData}
        token0Data={token0Data}
        token1Data={token1Data}
        tokenPrices={tokenPrices}
      />,
      document.body
      )}
    </>
  );
}
