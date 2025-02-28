import React, { useState } from "react";
import { Container } from "react-bootstrap";
import Navbar from "../components/Navbar";
import PositionContainer from "../components/PositionContainer";
import styles from "../styles/Home.module.css";

export default function Home() {
  const [provider, setProvider] = useState(null);

  return (
    <div className={styles.container}>
      <Navbar setProvider={setProvider} />
      <Container>
        <h1 className={styles.title}>Liquidity Dashboard</h1>
        <PositionContainer provider={provider} />
      </Container>
    </div>
  );
}
