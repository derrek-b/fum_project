// src/components/CreatePositionSection.js
import React, { useState, useEffect } from "react";
import { Card, Button, Alert } from "react-bootstrap";
import CreatePositionControl from "./CreatePositionControl";
import { PlusLg } from "react-bootstrap-icons";

/**
 * Component for managing creation of new positions in a wizard step
 */
const CreatePositionSection = ({
  selectedTokens = [],
  depositAmounts = {},
  strategyId,
  maxPositions = 1,
  onPositionsChange
}) => {
  // State to track all positions being created
  const [positions, setPositions] = useState([{
    index: 0,
    token0: "",
    token1: "",
    feeTier: "3000",
    platformId: "",
    priceRangeMode: "auto",
    priceRangeWidth: 5,
    priceLower: "",
    priceUpper: "",
    amount0: "",
    amount1: ""
  }]);

  // Update parent component when positions change
  useEffect(() => {
    onPositionsChange(positions);
  }, [positions, onPositionsChange]);

  // Update position data when a specific position is modified
  const handlePositionUpdate = (positionData) => {
    setPositions(prev => {
      const newPositions = [...prev];
      const index = newPositions.findIndex(p => p.index === positionData.index);

      if (index !== -1) {
        newPositions[index] = { ...positionData };
      }

      return newPositions;
    });
  };

  // Add a new position
  const handleAddPosition = () => {
    if (positions.length < maxPositions) {
      const newIndex = positions.length > 0 ? Math.max(...positions.map(p => p.index)) + 1 : 0;

      setPositions(prev => [
        ...prev,
        {
          index: newIndex,
          token0: "",
          token1: "",
          feeTier: "3000",
          platformId: "",
          priceRangeMode: "auto",
          priceRangeWidth: 5,
          priceLower: "",
          priceUpper: "",
          amount0: "",
          amount1: ""
        }
      ]);
    }
  };

  // Remove a position
  const handleRemovePosition = (index) => {
    setPositions(prev => prev.filter(p => p.index !== index));
  };

  // Create a balance object from deposit amounts
  const vaultBalances = {};

  // Add any token with a deposit amount to the balances
  Object.entries(depositAmounts).forEach(([symbol, amount]) => {
    if (amount && parseFloat(amount) > 0) {
      vaultBalances[symbol] = amount;
    }
  });

  return (
    <Card>
      <Card.Header>
        <h5 className="mb-0">Create New Positions</h5>
      </Card.Header>
      <Card.Body>
        {selectedTokens.length === 0 ? (
          <Alert variant="info">
            No tokens selected for deposit. Please go back to the previous step and select tokens to deposit.
          </Alert>
        ) : Object.keys(vaultBalances).length === 0 ? (
          <Alert variant="warning">
            No deposit amounts specified. Please go back and enter amounts for your selected tokens.
          </Alert>
        ) : (
          <>
            <p className="mb-3">
              Configure your liquidity position using the tokens you've selected for deposit.
            </p>

            {positions.map(position => (
              <CreatePositionControl
                key={position.index}
                index={position.index}
                onUpdate={handlePositionUpdate}
                onRemove={() => handleRemovePosition(position.index)}
                supportedTokens={selectedTokens}
                vaultBalance={vaultBalances}
                showRemoveButton={positions.length > 1}
              />
            ))}

            {positions.length < maxPositions && (
              <div className="text-center mt-3">
                <Button
                  variant="outline-primary"
                  onClick={handleAddPosition}
                  className="px-4"
                >
                  <PlusLg className="me-1" /> Add Another Position
                </Button>
              </div>
            )}
          </>
        )}
      </Card.Body>
    </Card>
  );
};

export default CreatePositionSection;
