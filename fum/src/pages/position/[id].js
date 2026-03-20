import React, { useState, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/router";
import { useSelector, useDispatch } from "react-redux";
import { Container, Row, Col, Card, Button, Badge, ProgressBar, Spinner, Alert, Tabs, Tab, OverlayTrigger, Tooltip } from "react-bootstrap";
import { ErrorBoundary } from "react-error-boundary";
import Link from "next/link";
import Head from "next/head";
import PriceRangeChart from "../../components/common/PriceRangeChart";
import Navbar from "../../components/common/Navbar";
import RefreshControls from "../../components/common/RefreshControls";
import AddLiquidityModal from "../../components/positions/AddLiquidityModal";
import RemoveLiquidityModal from "../../components/positions/RemoveLiquidityModal";
import ClosePositionModal from "../../components/positions/ClosePositionModal";
import ClaimFeesModal from "../../components/positions/ClaimFeesModal";
import { triggerUpdate, setResourceUpdating } from "../../redux/updateSlice";
import { setPositions } from "@/redux/positionsSlice";
import { useToast } from "../../context/ToastContext";
import { AdapterFactory } from "fum_library/adapters";
import { useReadProvider } from '../../hooks/useReadProvider';
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
  const vaults = useSelector((state) => state.vaults.userVaults);
  const { isConnected, address, chainId, isReconnecting } = useSelector((state) => state.wallet);
  const { provider } = useReadProvider();
  const { lastUpdate, resourcesUpdating } = useSelector((state) => state.updates);
  const hasAttemptedFetch = useRef(false);
  const positionsRef = useRef(positions);

  // Keep positionsRef in sync with positions
  useEffect(() => {
    positionsRef.current = positions;
  }, [positions]);

  // State for various UI elements
  const [invertPriceDisplay, setInvertPriceDisplay] = useState(false);
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

  // State for active tab
  const [activeTab, setActiveTab] = useState('price-range');

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

  // Derive token symbols from position's tokenPair
  const [token0Symbol, token1Symbol] = useMemo(() => {
    if (!position?.tokenPair) return ['', ''];
    return position.tokenPair.split('/');
  }, [position?.tokenPair]);

  // Get vault data if position is in a vault
  const vaultData = useMemo(() => {
    if (!position?.vaultAddress || !vaults) return null;
    return vaults.find(v => v.address === position.vaultAddress);
  }, [position?.vaultAddress, vaults]);

  // Check if any resources are currently updating
  const isUpdating = resourcesUpdating?.positions || false;

  // Get the appropriate adapter for this position (needed by modals via fee/balance useEffects)
  const adapter = useMemo(() => {
    if (!position?.platform || !provider || !chainId) return null;
    try {
      return AdapterFactory.getAdapter(position.platform, chainId);
    } catch (error) {
      console.error(`Failed to get adapter for position ${id}:`, error);
      return null;
    }
  }, [position?.platform, chainId, provider, id]);

  // Use position's pre-computed in-range status
  const isActive = position?.inRange ?? false;

  // Price information from position's pre-computed values, with inversion support
  const priceInfo = useMemo(() => {
    if (!position) return { currentPrice: null, lowerPrice: null, upperPrice: null };
    const { currentPrice, priceLower, priceUpper } = position;
    if (invertPriceDisplay) {
      return {
        currentPrice: 1 / currentPrice,
        lowerPrice: 1 / priceUpper,
        upperPrice: 1 / priceLower,
      };
    }
    return { currentPrice, lowerPrice: priceLower, upperPrice: priceUpper };
  }, [position?.currentPrice, position?.priceLower, position?.priceUpper, invertPriceDisplay]);

  // Set price direction labels
  const priceLabel = invertPriceDisplay
    ? `${token1Symbol} per ${token0Symbol}`
    : `${token0Symbol} per ${token1Symbol}`;

  // Calculate position percentage for the progress bar
  const pricePositionPercent = useMemo(() => {
    if (!priceInfo.lowerPrice || !priceInfo.upperPrice || !priceInfo.currentPrice)
      return 0;

    try {
      const lower = priceInfo.lowerPrice;
      const upper = priceInfo.upperPrice;
      const current = priceInfo.currentPrice;

      if (current < lower) return 0;
      if (current > upper) return 100;

      // Handle possible division by zero
      if (upper === lower) return 50;

      return Math.floor(((current - lower) / (upper - lower)) * 100);
    } catch (error) {
      console.error("Error calculating price position percent:", error);
      return 0;
    }
  }, [priceInfo.lowerPrice, priceInfo.upperPrice, priceInfo.currentPrice]);

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
          const result = AdapterFactory.getAdaptersForChain(chainId);
          const adapters = result.adapters || [];

          if (adapters.length === 0) {
            showError(`No supported platforms found for this chain`);
            return;
          }

          // Fetch positions from all platforms
          const platformResults = await Promise.all(
            adapters.map(async adapter => {
              try {
                return await adapter.getPositionsForDisplay(address, provider);
              } catch (adapterError) {
                console.error(`Error fetching positions from ${adapter.platformName}:`, adapterError);
                return { positions: {} };
              }
            })
          );

          // Combine results
          let allPositions = [];

          platformResults.forEach((result) => {
            const positionsArray = result.positions ? Object.values(result.positions) : [];

            if (positionsArray.length > 0) {
              allPositions = [...allPositions, ...positionsArray];
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
        setTokenPrices(prev => ({ ...prev, loading: true, error: null }));
        dispatch(setResourceUpdating({ resource: 'positions', isUpdating: true }));
      } catch (error) {
        console.error("Error marking resources as updating:", error);
      }
    }
  }, [lastUpdate, id, dispatch]);

  // Refresh position data when lastUpdate changes
  useEffect(() => {
    // Only run when lastUpdate changes and we have necessary context
    if (lastUpdate && adapter && provider && address && chainId && id) {
      try {
        // Track the latest refresh timestamp to avoid duplicate refreshes
        const refreshTimestamp = lastUpdate;

        // Use the vault address for vault positions, wallet address for wallet positions
        const owner = position?.vaultAddress || address;

        // Fetch fresh data from blockchain
        adapter.getPositionsForDisplay(owner, provider).then(result => {
          // Check if this is still the latest refresh (prevents race conditions)
          if (refreshTimestamp !== lastUpdate) return;

          // Find our specific position
          // Convert positions object to array since adapter returns object with IDs as keys
          const positionsArray = result.positions ? Object.values(result.positions) : [];
          const freshPosition = positionsArray.find(p => p.id === id);
          if (freshPosition) {
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
  }, [lastUpdate, adapter, provider, address, chainId, id, dispatch, showError, position?.vaultAddress]);

  // Fetch token prices from CoinGecko
  useEffect(() => {
    // Guard against undefined token symbols
    if (!token0Symbol || !token1Symbol) return;

    const getPrices = async () => {
      setTokenPrices(prev => ({ ...prev, loading: true, error: null }));

      try {
        // Use our utility function to fetch prices (2-minute cache for position detail page)
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
        showError("Failed to fetch token prices");
      }
    };

    getPrices();
  }, [token0Symbol, token1Symbol, lastUpdate, showError]);

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
      const price = tokenSymbol === token0Symbol ? tokenPrices.token0 : tokenPrices.token1;
      if (!price) return null;

      // Calculate USD value inline
      const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
      return numAmount * price;
    } catch (error) {
      console.error("Error calculating USD value:", error);
      return null;
    }
  };

  // Check if platform has a logo
  const platformLogo = position?.platform ? getPlatformLogo(position.platform) : null;
  const hasPlatformLogo = !!platformLogo;

  // Check if wallet is reconnecting FIRST (show spinner during auto-reconnect)
  if (isReconnecting) {
    return (
      <>
        <Navbar />
        <Container className="py-4">
          <Link href="/positions" passHref>
            <Button className="btn btn-back mb-4">
              &larr; Back to Positions
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
          <Link href="/positions" passHref>
            <Button className="btn btn-back mb-4">
              &larr; Back to Positions
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
          <Link href="/positions" passHref>
            <Button className="btn btn-back mb-4">
              &larr; Back to Positions
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

  // If the position doesn't exist (after positions array is populated)
  if (!position) {
    return (
      <>
        <Navbar />
        <Container className="py-4">
          <Link href="/positions" passHref>
            <Button className="btn btn-back mb-4">
              &larr; Back to Positions
            </Button>
          </Link>
          <Card>
            <Card.Body className="text-center p-5">
              <h3>Position not found</h3>
              <p>No position found with ID: {id}</p>
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
          <title>{`Position #${position?.id} - ${position?.tokenPair || 'Detail'} | Liquidity Dashboard`}</title>
        </Head>

        <div className="d-flex justify-content-between align-items-center mb-4">
          <Link href="/positions" passHref>
            <Button className="btn btn-back">
              &larr; Back to Positions
            </Button>
          </Link>

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

        <ErrorBoundary
          FallbackComponent={ErrorFallback}
          onReset={() => {
            // Reset the state that triggered the error
            refreshData();
          }}
        >

          <Row>
            <Col lg={12}>
              <Card className="mb-4">
                <Card.Body>
                  <div className="d-flex justify-content-between align-items-baseline">
                    <h1 className="mb-2 mt-0 d-flex align-items-center" style={{ fontSize: '2rem' }}>
                      {/* Status badge */}
                      <Badge bg={isActive ? "success" : "danger"} className="me-2" style={{ fontSize: '1rem' }}>
                        {isActive ? "In Range" : "Out of Range"}
                      </Badge>

                      {/* Position ID */}
                      <span>Position #{position.id}</span>

                      {/* Platform indicator - logo or colored badge */}
                      {position.platform && (
                        hasPlatformLogo ? (
                          <div
                            className="ms-2 d-inline-flex align-items-center justify-content-center"
                            style={{ height: '32px', width: '32px' }}
                          >
                            <img
                              src={platformLogo}
                              alt={position.platformName || position.platform}
                              width={32}
                              height={32}
                              title={position.platformName || position.platform}
                            />
                          </div>
                        ) : (
                          <Badge
                            className="ms-2 d-inline-flex align-items-center"
                            pill
                            bg=""
                            style={{
                              fontSize: '1rem',
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

                    {/* TVL in top right */}
                    <div style={{ textAlign: 'right', margin: 0, padding: 0 }}>
                      <div style={{ fontSize: '2.5rem', fontWeight: '600', margin: 0 }}>
                        {tokenPrices.loading ? (
                          <Spinner animation="border" size="sm" />
                        ) : tokenPrices.token0 && tokenPrices.token1 ? (
                          <>
                            <span className="text-crimson">
                              ${(() => {
                                const tokenTVL = (position.token0Amount * tokenPrices.token0) + (position.token1Amount * tokenPrices.token1);
                                const feesTVL = (position.uncollectedFees0 * tokenPrices.token0) + (position.uncollectedFees1 * tokenPrices.token1);
                                return (tokenTVL + feesTVL).toLocaleString(undefined, {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2
                                });
                              })()}
                            </span>
                            <OverlayTrigger
                              placement="top"
                              overlay={
                                <Tooltip>
                                  <div>Token TVL: ${((position.token0Amount * tokenPrices.token0) + (position.token1Amount * tokenPrices.token1)).toLocaleString(undefined, {
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 2
                                  })}</div>
                                  <div>Uncollected Fees: ${((position.uncollectedFees0 * tokenPrices.token0) + (position.uncollectedFees1 * tokenPrices.token1)).toLocaleString(undefined, {
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 2
                                  })}</div>
                                </Tooltip>
                              }
                            >
                              <small className="ms-1 text-muted" style={{ cursor: "help", fontSize: "0.7rem", position: "relative", top: "-0.2rem" }}>ⓘ</small>
                            </OverlayTrigger>
                          </>
                        ) : (
                          <span className="text-danger">—</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Vault info if position is in a vault */}
                  {position.vaultAddress && (
                    <div style={{ fontSize: '1.1rem' }}>
                      <strong style={{ color: 'var(--crimson-700)' }}>Vault: </strong>
                      <Link href={`/vault/${position.vaultAddress}`} passHref legacyBehavior>
                        <a style={{ color: '#525252', textDecoration: 'none', fontSize: '0.95rem', fontWeight: '600' }}>
                          {vaultData?.name || 'Unknown Vault'} ({position.vaultAddress.slice(0, 6)}...{position.vaultAddress.slice(-4)})
                        </a>
                      </Link>
                    </div>
                  )}

                  <div style={{ fontSize: '1.1rem' }}>
                    <strong style={{ color: 'var(--blue-accent)' }}>{position.tokenPair}</strong>
                  </div>

                  <div className="mb-3">
                    <small style={{ fontSize: '0.9rem', color: '#525252' }}>
                      <strong>Fee Tier:</strong> {position.fee != null && isFinite(position.fee) ? position.fee : 'N/A'}%
                    </small>
                  </div>

                  {/* Divider */}
                  <hr className="my-3" />

                  <Row>
                    <Col md={6} style={{ borderRight: '1px solid rgba(0, 0, 0, 0.1)', paddingRight: '2rem' }}>
                      <div className="mb-3" style={{ paddingLeft: '9rem', paddingRight: '9rem' }}>
                        <strong>Token Balances:</strong>
                        <div style={{ fontSize: '0.8125rem', color: '#0a0a0a', paddingLeft: '.7rem', paddingRight: '.7rem' }}>
                          <div className="mb-1 d-flex justify-content-between align-items-center">
                            <div>
                              <strong style={{ color: 'var(--crimson-700)' }}>{token0Symbol}:</strong>{' '}
                              <span style={{ color: '#525252' }}>{position.token0Amount.toFixed(4)}</span>
                            </div>
                            {tokenPrices.token0 && (
                              <span style={{ fontSize: '0.75rem', color: 'var(--neutral-600)' }}>
                                ${getUsdValue(position.token0Amount, token0Symbol)?.toFixed(2) || '—'}
                              </span>
                            )}
                          </div>
                          <div className="mb-1 d-flex justify-content-between align-items-center">
                            <div>
                              <strong style={{ color: 'var(--crimson-700)' }}>{token1Symbol}:</strong>{' '}
                              <span style={{ color: '#525252' }}>{position.token1Amount.toFixed(4)}</span>
                            </div>
                            {tokenPrices.token1 && (
                              <span style={{ fontSize: '0.75rem', color: 'var(--neutral-600)' }}>
                                ${getUsdValue(position.token1Amount, token1Symbol)?.toFixed(2) || '—'}
                              </span>
                            )}
                          </div>
                          {tokenPrices.token0 && tokenPrices.token1 && (
                            <div className="mt-1 text-end" style={{ fontSize: '0.75rem', color: 'var(--blue-accent)', fontWeight: 'bold' }}>
                              Total: ${(
                                (getUsdValue(position.token0Amount, token0Symbol) || 0) +
                                (getUsdValue(position.token1Amount, token1Symbol) || 0)
                              ).toFixed(2)}
                            </div>
                          )}
                        </div>
                      </div>
                    </Col>
                    <Col md={6} style={{ paddingLeft: '2rem' }}>
                      <div className="mb-3" style={{ paddingLeft: '9rem', paddingRight: '9rem' }}>
                        <strong>Uncollected Fees:</strong>
                        <div style={{ fontSize: '0.8125rem', color: '#0a0a0a', paddingLeft: '.7rem', paddingRight: '.7rem' }}>
                          <div className="mb-1 d-flex justify-content-between align-items-center">
                            <div>
                              <strong style={{ color: 'var(--crimson-700)' }}>{token0Symbol}:</strong>{' '}
                              <span style={{ color: '#525252' }}>{formatFeeDisplay(position.uncollectedFees0)}</span>
                            </div>
                            {tokenPrices.token0 && (
                              <span style={{ fontSize: '0.75rem', color: 'var(--neutral-600)' }}>
                                ${getUsdValue(position.uncollectedFees0, token0Symbol)?.toFixed(2) || '—'}
                              </span>
                            )}
                          </div>
                          <div className="mb-1 d-flex justify-content-between align-items-center">
                            <div>
                              <strong style={{ color: 'var(--crimson-700)' }}>{token1Symbol}:</strong>{' '}
                              <span style={{ color: '#525252' }}>{formatFeeDisplay(position.uncollectedFees1)}</span>
                            </div>
                            {tokenPrices.token1 && (
                              <span style={{ fontSize: '0.75rem', color: 'var(--neutral-600)' }}>
                                ${getUsdValue(position.uncollectedFees1, token1Symbol)?.toFixed(2) || '—'}
                              </span>
                            )}
                          </div>
                          {tokenPrices.token0 && tokenPrices.token1 && (
                            <div className="mt-1 text-end" style={{ fontSize: '0.75rem', color: 'var(--blue-accent)', fontWeight: 'bold' }}>
                              Total: ${(
                                (getUsdValue(position.uncollectedFees0, token0Symbol) || 0) +
                                (getUsdValue(position.uncollectedFees1, token1Symbol) || 0)
                              ).toFixed(2)}
                            </div>
                          )}
                        </div>
                      </div>
                    </Col>
                  </Row>

                  {/* Divider */}
                  <hr className="my-3" />

                  {/* Action Buttons */}
                  <Row>
                    <Col xs={3}>
                      <Button
                        variant="outline-primary"
                        className="w-100"
                        disabled={position.inVault}
                        onClick={() => setShowAddLiquidityModal(true)}
                      >
                        + Add Liquidity
                      </Button>
                    </Col>
                    <Col xs={3}>
                      <Button
                        variant="outline-primary"
                        className="w-100"
                        disabled={position.inVault}
                        onClick={() => setShowRemoveLiquidityModal(true)}
                      >
                        - Remove Liquidity
                      </Button>
                    </Col>
                    <Col xs={3}>
                      <Button
                        variant="outline-primary"
                        className="w-100"
                        disabled={position.inVault ||
                                  (position.uncollectedFees0 < 0.0001 && position.uncollectedFees1 < 0.0001)}
                        onClick={() => setShowClaimFeesModal(true)}
                      >
                        Claim Fees
                      </Button>
                    </Col>
                    <Col xs={3}>
                      <Button
                        className="btn btn-back w-100"
                        disabled={position.inVault}
                        onClick={() => setShowClosePositionModal(true)}
                      >
                        Close Position
                      </Button>
                    </Col>
                  </Row>
                </Card.Body>
              </Card>

              <Tabs
                activeKey={activeTab}
                onSelect={(k) => setActiveTab(k)}
                className="mb-4"
              >
                <Tab eventKey="price-range" title="Price Range">
                  <Card>
                    <Card.Header>
                      <div className="d-flex align-items-center">
                        <h5 className="mb-0">
                          {priceLabel}
                        </h5>
                        <Button
                          variant="link"
                          className="p-0 ms-2"
                          size="sm"
                          onClick={() => setInvertPriceDisplay(!invertPriceDisplay)}
                          title="Switch price direction"
                          style={{ textDecoration: 'none', position: 'relative', top: '-2px' }}
                        >
                          <span role="img" aria-label="switch">⇄</span>
                        </Button>
                      </div>
                    </Card.Header>
                    <Card.Body>
                      <div style={{ height: "120px" }}>
                        {/* Using the PriceRangeChart component with real data */}
                        {priceInfo.lowerPrice && priceInfo.upperPrice && priceInfo.currentPrice ? (
                          <PriceRangeChart
                            lowerPrice={priceInfo.lowerPrice}
                            upperPrice={priceInfo.upperPrice}
                            currentPrice={priceInfo.currentPrice}
                            token0Symbol={token0Symbol}
                            token1Symbol={token1Symbol}
                            isInverted={invertPriceDisplay}
                            isActive={isActive}
                          />
                        ) : (
                          <div className="text-center pt-5">
                            <p className="text-muted">Cannot display chart due to missing price data</p>
                          </div>
                        )}
                      </div>

                      <div>
                        <div className="mb-2">
                          <strong style={{ color: 'var(--crimson-700)' }}>Min Price:</strong> {formatPrice(priceInfo.lowerPrice)}
                        </div>
                        <div className="mb-2">
                          <strong style={{ color: 'var(--crimson-700)' }}>Current Price:</strong> {formatPrice(priceInfo.currentPrice)}
                        </div>
                        <div className="mb-2">
                          <strong style={{ color: 'var(--crimson-700)' }}>Max Price:</strong> {formatPrice(priceInfo.upperPrice)}
                        </div>
                      </div>
                    </Card.Body>
                  </Card>
                </Tab>

                <Tab eventKey="technicals" title="Technicals">
                  <Card>
                    <Card.Header>
                      <h5 className="mb-0">Technical Details</h5>
                    </Card.Header>
                    <Card.Body>
                      <div className="mb-2">
                        <strong style={{ color: 'var(--crimson-700)' }}>Tick Range:</strong> {position.platformData?.tickLower} to {position.platformData?.tickUpper}
                      </div>
                      <div className="mb-2">
                        <strong style={{ color: 'var(--crimson-700)' }}>Chain ID:</strong> {chainId}
                      </div>
                      <div className="mb-2">
                        <strong style={{ color: 'var(--crimson-700)' }}>Token Pair:</strong> {position?.tokenPair || 'N/A'}
                      </div>
                      <div className="mb-2">
                        <strong style={{ color: 'var(--crimson-700)' }}>Pool Address:</strong> {position.pool}
                      </div>
                    </Card.Body>
                  </Card>
                </Tab>
              </Tabs>
            </Col>
          </Row>
        </ErrorBoundary>

        {/* Action modals — each manages its own data via useModalData hook */}
        <ClaimFeesModal
          show={showClaimFeesModal}
          onHide={() => setShowClaimFeesModal(false)}
          position={position}
          tokenPrices={tokenPrices}
        />

        <RemoveLiquidityModal
          show={showRemoveLiquidityModal}
          onHide={() => setShowRemoveLiquidityModal(false)}
          position={position}
          tokenPrices={tokenPrices}
        />

        <ClosePositionModal
          show={showClosePositionModal}
          onHide={() => setShowClosePositionModal(false)}
          position={position}
          tokenPrices={tokenPrices}
        />

        <AddLiquidityModal
          show={showAddLiquidityModal}
          onHide={() => setShowAddLiquidityModal(false)}
          position={position}
          tokenPrices={tokenPrices}
        />
      </Container>
    </>
  );
}
