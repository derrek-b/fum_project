import React from "react";
import { Card } from "react-bootstrap";

export default function PositionCard({ position }) {
  return (
    <Card className="mb-3" style={{ backgroundColor: "#f5f5f5", borderColor: "#a30000" }}>
      <Card.Body>
        <Card.Title>Position #{position.id} - {position.tokenPair}</Card.Title>
        <Card.Text>
          {/* Placeholder for future fields */}
          <strong>Token Pair:</strong> {position.tokenPair}<br />
        </Card.Text>
      </Card.Body>
    </Card>
  );
}
