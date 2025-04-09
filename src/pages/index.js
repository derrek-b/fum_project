import React from "react";
import { Container, Alert, Button } from "react-bootstrap";
import { ErrorBoundary } from "react-error-boundary";
import Navbar from "../components/Navbar";
import PositionContainer from "../components/positions/PositionContainer";
import styles from "../styles/Home.module.css";
import { useToast } from "../context/ToastContext";

// Fallback component to show when an error occurs
function ErrorFallback({ error, resetErrorBoundary }) {
  const { showError } = useToast();

  // Log the error to console and notify user via toast
  React.useEffect(() => {
    console.error("Dashboard error:", error);
    showError("There was a problem loading the dashboard. Please try again.");
  }, [error, showError]);

  return (
    <Alert variant="danger" className="my-4">
      <Alert.Heading>Something went wrong</Alert.Heading>
      <p>
        We encountered an error while loading the dashboard. Please try refreshing the page.
      </p>
      <hr />
      <div className="d-flex justify-content-end">
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

export default function Home() {
  return (
    <div className={styles.container}>
      <Navbar />
      <Container>
        <h1 className={styles.title}>Position Dashboard</h1>
        <ErrorBoundary
          FallbackComponent={ErrorFallback}
          onReset={() => {
            // Reset the state that triggered the error
            window.location.reload();
          }}
        >
          <PositionContainer />
        </ErrorBoundary>
      </Container>
    </div>
  );
}
