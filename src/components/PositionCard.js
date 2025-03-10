import React, { useMemo, useState } from "react";
import { Card, Button } from "react-bootstrap";
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

  // Function to claim fees
  const claimFees = async () => {
    if (!provider || !address || !chainId) {
      setClaimError("Wallet not connected");
      return;
    }

    setIsClaiming(true);
    setClaimError(null);
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
        amount0Max: parseInt(Number.MAX_VALUE),
        amount1Max: parseInt(Number.MAX_VALUE),
      };

      console.log("Sending collect transaction with params:", collectParams);
      const tx = await nftManager.collect(collectParams);
      console.log("Transaction sent, waiting for confirmation...");
      await tx.wait();
      console.log(`Fees claimed for position ${position.id}:`, tx);
      // Refresh data (temporary)
      window.location.reload();
    } catch (error) {
      console.error("Error claiming fees:", error);
      setClaimError(`Failed to claim fees: ${error.message}`);
    } finally {
      setIsClaiming(false);
    }
  };

  return (
    <Card className="mb-3" style={{ backgroundColor: "#f5f5f5", borderColor: "#a30000", cursor: "default" }}>
      <Card.Body>
        <Card.Title>Position #{position.id} - {position.tokenPair}</Card.Title>
        <Card.Text>
          <strong>Activity:</strong> {active ? "in-range" : "out-of-range"}<br />
          <strong>Current Price:</strong> {currentPrice} {position.tokenPair}<br />
        </Card.Text>
        <Button
          variant="secondary"
          onClick={togglePanel}
          style={{ padding: "0.25rem 0.5rem", width: "2rem", textAlign: "center" }}
        >
          <span role="img" aria-label="menu">🍔</span>
        </Button>
        {isPanelVisible && (
          <div
            style={{
              marginTop: "0.5rem",
              padding: "0.5rem",
              backgroundColor: "#fff",
              border: "1px solid #ccc",
              borderRadius: "4px",
            }}
          >
            <a
              href="#"
              style={{ display: "block", marginBottom: "0.25rem", color: isClaiming ? "gray" : "inherit" }}
              onClick={(e) => { e.preventDefault(); if (!isClaiming) claimFees(); }}
            >
              Claim Fees {isClaiming ? "(Claiming...)" : claimError ? `(${claimError})` : ""}
            </a>
            <a href="#" style={{ display: "block", marginBottom: "0.25rem" }} onClick={(e) => e.preventDefault()} disabled>Add Liquidity</a>
            <a href="#" style={{ display: "block", marginBottom: "0.25rem" }} onClick={(e) => e.preventDefault()} disabled>Remove Liquidity</a>
            <a href="#" style={{ display: "block", marginBottom: "0.25rem" }} onClick={(e) => e.preventDefault()} disabled>Close Position</a>
          </div>
        )}
      </Card.Body>
    </Card>
  );
}
