import React from "react";
import { Container, Row, Col } from "react-bootstrap";
import { useSelector } from "react-redux";
import Navbar from "../components/Navbar"; // Updated path
import PositionCard from "../components/PositionCard"; // Updated path
import styles from "../styles/Home.module.css"; // Updated path

export default function Home() {
  const positions = useSelector((state) => state.positions.positions);

  return (
    <div className={styles.container}>
      <Navbar />
      <Container>
        <h1 className={styles.title}>Liquidity Dashboard</h1>
        <Row>
          {positions.map((pos) => (
            <Col md={6} key={pos.id}>
              <PositionCard position={pos} />
            </Col>
          ))}
        </Row>
      </Container>
    </div>
  );
}
