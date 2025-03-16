import React from "react";
import { Container } from "react-bootstrap";
import Navbar from "../components/Navbar";
import PositionContainer from "../components/PositionContainer";
import styles from "../styles/Home.module.css";

export default function Home() {
  return (
    <div className={styles.container}>
      <Navbar />
      <Container>
        <h1 className={styles.title}>Liquidity Dashboard</h1>
        <PositionContainer />
      </Container>
    </div>
  );
}
