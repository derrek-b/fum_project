import React, { useMemo, useState } from "react";
import { Card, Button, Spinner, Badge } from "react-bootstrap";
import { isInRange, calculatePrice, calculateUncollectedFees, tickToPrice, formatPrice } from "../utils/positionHelpers";
import { useSelector } from "react-redux";
import { ethers } from "ethers";
import nonfungiblePositionManagerABI from "@uniswap/v3-periphery/artifacts/contracts/NonfungiblePositionManager.sol/NonfungiblePositionManager.json" assert { type: "json" };
import config from "../utils/config";

// Helper function to format fee display with max 4 decimal places
// and show "< 0.0001" for very small amounts
const formatFeeDisplay = (value) => {
  const numValue = parseFloat(value);
  if (numValue === 0) return "0";
  if (numValue < 0.0001) return "< 0.0001";
  return numValue.toFixed(4).replace(/\.?0+$/, "");
};

export default function PositionCard({ position, provider }) {
  const { address, chainId } = useSelector((state) => state.wallet);
  const pools = useSelector((state) => state.pools);
  const tokens = useSelector((state) => state.tokens);
  const poolData = pools[position.poolAddress] || {};
  const token0Data = tokens[poolData.token0] || { decimals: 0, symbol: '?' };
  const token1Data = tokens[poolData.token1] || { decimals: 0, symbol: '?' };
  const currentTick = poolData.tick || 0;
  const sqrtPriceX96 = poolData.sqrtPriceX96 || "0";

  // Current price calculation
  const currentPrice = useMemo(() => calculatePrice(sqrtPriceX96, token0Data.decimals, token1Data.decimals), [
    sqrtPriceX96,
    token0Data.decimals,
    token1Data.decimals,
  ]);

  // State for price display direction
  const [invertPriceDisplay, setInvertPriceDisplay] = useState(false);

  // Calculate price range
  const lowerPrice = useMemo(() => {
    return tickToPrice(position.tickLower, token0Data.decimals, token1Data.decimals, invertPriceDisplay);
  }, [position.tickLower, token0Data.decimals, token1Data.decimals, invertPriceDisplay]);

  const upperPrice = useMemo(() => {
    return tickToPrice(position.tickUpper, token0Data.decimals, token1Data.decimals, invertPriceDisplay);
  }, [position.tickUpper, token0Data.decimals, token1Data.decimals, invertPriceDisplay]);

  // Ensure lower price is always smaller than upper price (they swap when inverting)
  const displayLowerPrice = Math.min(lowerPrice, upperPrice);
  const displayUpperPrice = Math.max(lowerPrice, upperPrice);

  // Format current price based on inversion
  const currentPriceDisplay = useMemo(() => {
    if (currentPrice === "N/A") return "N/A";
    const numericPrice = parseFloat(currentPrice);
    return invertPriceDisplay ?
      formatPrice(1 / numericPrice) :
      currentPrice;
  }, [currentPrice, invertPriceDisplay]);

  // Set price direction labels
  const priceLabel = invertPriceDisplay ?
    `${token0Data.symbol} per ${token1Data.symbol}` :
    `${token1Data.symbol} per ${token0Data.symbol}`;

  // Check if position is in range
  const active = useMemo(() => isInRange(currentTick, position.tickLower, position.tickUpper), [
    currentTick,
    position.tickLower,
    position.tickUpper,
  ]);

  // State for fee calculation errors
  const [feeLoadingError, setFeeLoadingError] = useState(false);

  // Calculate uncollected fees
  const uncollectedFees = useMemo(() => {
    // Reset error state
    setFeeLoadingError(false);

    // Check if we have all required data
    if (!poolData.feeGrowthGlobal0X128 ||
        !poolData.feeGrowthGlobal1X128 ||
        !poolData.ticks ||
        !poolData.ticks[position.tickLower] ||
        !poolData.ticks[position.tickUpper]) {

      // Set error state if data is missing
      setFeeLoadingError(true);
      return null;
    }

    const tickLower = poolData.ticks[position.tickLower];
    const tickUpper = poolData.ticks[position.tickUpper];

    // Create position object expected by calculateUncollectedFees
    const positionForFeeCalc = {
      ...position,
      // Convert to BigInt compatible format
      liquidity: BigInt(position.liquidity),
      feeGrowthInside0LastX128: BigInt(position.feeGrowthInside0LastX128),
      feeGrowthInside1LastX128: BigInt(position.feeGrowthInside1LastX128),
      tokensOwed0: BigInt(position.tokensOwed0),
      tokensOwed1: BigInt(position.tokensOwed1)
    };

    try {
      return calculateUncollectedFees({
        position: positionForFeeCalc,
        currentTick: poolData.tick,
        feeGrowthGlobal0X128: poolData.feeGrowthGlobal0X128,
        feeGrowthGlobal1X128: poolData.feeGrowthGlobal1X128,
        tickLower,
        tickUpper,
        token0: token0Data,
        token1: token1Data
      });
    } catch (error) {
      console.error("Error calculating fees for position", position.id, ":", error);
      setFeeLoadingError(true);
      return null;
    }
  }, [position, poolData, token0Data, token1Data]);

  // State to toggle panel visibility
  const [isPanelVisible, setIsPanelVisible] = useState(false);

  // Function to toggle panel visibility
  const togglePanel = () => setIsPanelVisible(!isPanelVisible);

  // State for claiming process
  const [isClaiming, setIsClaiming] = useState(false);
  const [claimError, setClaimError] = useState(null);
  const [claimSuccess, setClaimSuccess] = useState(false);

  // Function to claim fees
  const claimFees = async () => {
    if (!provider || !address || !chainId) {
      setClaimError("Wallet not connected");
      return;
    }

    setIsClaiming(true);
    setClaimError(null);
    setClaimSuccess(false);
    try {
      // Dynamically get the positionManagerAddress based on chainId
      const chainConfig = config.chains[chainId];
      if (!chainConfig || !chainConfig.platforms?.uniswapV3?.positionManagerAddress) {
        throw new Error(`No configuration found for chainId: ${chainId}`);
      }
      const positionManagerAddress = chainConfig.platforms.uniswapV3.positionManagerAddress;

      const signer = await provider.getSigner();
      const nftManager = new ethers.Contract(positionManagerAddress, nonfungiblePositionManagerABI.abi, signer);

      const collectParams = {
        tokenId: position.id,
        recipient: address,
        amount0Max: ethers.MaxUint256,
        amount1Max: ethers.MaxUint256,
      };

      console.log("Sending collect transaction with params:", collectParams);
      const tx = await nftManager.collect(collectParams);
      console.log("Transaction sent, waiting for confirmation...");
      await tx.wait();
      console.log(`Fees claimed for position ${position.id}:`, tx);

      // Set success state
      setClaimSuccess(true);

      // Refresh data after a short delay (temporary solution)
      setTimeout(() => {
        window.location.reload();
      }, 3000);
    } catch (error) {
      console.error("Error claiming fees:", error);
      setClaimError(`Failed to claim fees: ${error.message}`);
    } finally {
      setIsClaiming(false);
    }
  };

  // Prepare activityBadge
  const activityBadge = (
    <span
      className={`badge bg-${active ? 'success' : 'danger'}`}
      style={{ fontSize: '0.85rem' }}
    >
      {active ? "in-range" : "out-of-range"}
    </span>
  );

  return (
    <Card className="mb-3" style={{ backgroundColor: "#f5f5f5", borderColor: "#a30000" }}>
      <Card.Body>
        <div className="d-flex justify-content-between align-items-center mb-2">
          <Card.Title>Position #{position.id} - {position.tokenPair}</Card.Title>
          <Button
            variant="outline-secondary"
            size="sm"
            onClick={togglePanel}
            aria-label="Position actions"
          >
            <span role="img" aria-label="menu">🔧</span>
          </Button>
        </div>

        {/* Price Range Display (New) */}
        <div className="mb-2">
          <div className="d-flex align-items-center">
            <strong className="me-2">Price Range:</strong>
            <span>
              {formatPrice(displayLowerPrice)} - {formatPrice(displayUpperPrice)} {priceLabel}
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
          <strong>Activity:</strong> {activityBadge}<br />
          <strong>Current Price:</strong> {currentPriceDisplay} {priceLabel}<br />

          {/* Add uncollected fees section */}
          <strong>Uncollected Fees:</strong>
          <div className="ps-3 mt-1 mb-2">
            {feeLoadingError ? (
              <div className="text-danger small">
                <i className="me-1">⚠️</i>
                Unable to load fee data. Please try refreshing.
              </div>
            ) : !uncollectedFees ? (
              <div className="text-secondary small">
                <Spinner animation="border" size="sm" className="me-2" />
                Loading fee data...
              </div>
            ) : (
              <>
                <Badge bg="light" text="dark" className="me-1">
                  {formatFeeDisplay(uncollectedFees.token0.formatted)} {token0Data.symbol}
                </Badge>
                <Badge bg="light" text="dark">
                  {formatFeeDisplay(uncollectedFees.token1.formatted)} {token1Data.symbol}
                </Badge>
              </>
            )}
          </div>
        </Card.Text>

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
                Successfully claimed fees! Page will refresh shortly.
              </div>
            )}
          </div>
        )}
      </Card.Body>
    </Card>
  );
}
