import React, { useMemo } from "react";
import { Card } from "react-bootstrap";
import { isInRange, calculatePrice } from "../utils/positionHelpers"; // Ensure calculatePrice is imported
import { useSelector } from "react-redux";

export default function PositionCard({ position }) {
  const pools = useSelector((state) => state.pools);
  const tokens = useSelector((state) => state.tokens);
  const poolData = pools[position.poolAddress] || {}; // Fallback to empty object if pool data is missing
  const token0Data = tokens[poolData.token0] || { decimals: 0 }; // Fallback to 0 if token data is missing
  const token1Data = tokens[poolData.token1] || { decimals: 0 }; // Fallback to 0 if token data is missing
  const currentTick = poolData.tick || 0; // Fallback to 0 if tick is missing
  const sqrtPriceX96 = poolData.sqrtPriceX96 || "0"; // Fallback to "0" if sqrtPriceX96 is missing
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

  return (
    <Card className="mb-3" style={{ backgroundColor: "#f5f5f5", borderColor: "#a30000" }}>
      <Card.Body>
        <Card.Title>Position #{position.id} - {position.tokenPair}</Card.Title>
        <Card.Text>
          <strong>Activity:</strong> {active ? "in-range" : "out-of-range"}<br />
          <strong>Current Price:</strong> {currentPrice} {position.tokenPair}<br />
        </Card.Text>
      </Card.Body>
    </Card>
  );
}
