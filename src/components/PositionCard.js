import React, { useMemo, useState } from "react";
import { Card, Button, Spinner } from "react-bootstrap";
import { isInRange, calculatePrice } from "../utils/positionHelpers";
import { useSelector } from "react-redux";
import { ethers } from "ethers";
import nonfungiblePositionManagerABI from "@uniswap/v3-periphery/artifacts/contracts/NonfungiblePositionManager.sol/NonfungiblePositionManager.json" assert { type: "json" };
import config from "../utils/config";

export default function PositionCard({ position, provider }) {
  const { address, chainId } = useSelector((state) => state.wallet);
  const pools = useSelector((state) => state.pools);
  const tokens = useSelector((state) => state.tokens);
  const poolData = pools[position.poolAddress] || {};
  const token0Data = tokens[poolData.token0] || { decimals: 0 };
  const token1Data = tokens[poolData.token1] || { decimals: 0 };
  const currentTick = poolData.tick || 0;
  const sqrtPriceX96 = poolData.sqrtPriceX96 || "0";
  const currentPrice = useMemo(() => calculatePrice(sqrtPriceX96, token0Data.decimals, token1Data.decimals), [
    sqrtPriceX96,
    token0Data.decimals,
    token1Data.decimals,
  ]);
  const active = useMemo(() => isInRange(currentTick, position.tickLower, position.tickUpper), [
    currentTick,
    position.tickLower,
    position.tickUpper,
  ]);

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

        <Card.Text>
          <strong>Activity:</strong> {activityBadge}<br />
          <strong>Current Price:</strong> {currentPrice} {position.tokenPair}<br />
          {/* Removed liquidity display - not useful context for users */}
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
                disabled={isClaiming}
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
