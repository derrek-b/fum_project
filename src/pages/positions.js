import React from "react";
import { Container, Alert, Button } from "react-bootstrap";
import { ErrorBoundary } from "react-error-boundary";
import Head from "next/head";
import Navbar from "../components/Navbar";
import PositionContainer from "../components/positions/PositionContainer";
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

export default function PositionsPage() {
  return (
    <div>
      <Head>
        <title>Position Dashboard | D-fied</title>
        <meta name="description" content="Manage your DeFi liquidity positions" />
      </Head>

      <Navbar />
      <Container className="py-4">
        {/* Hero Section */}
        <div className="mb-5 animate-fade-in">
          <h1 className="mb-3">Position Management</h1>
          <p style={{ fontSize: '1.125rem', maxWidth: '42rem', color: '#0a0a0a' }}>
            Manage your positions across DeFi platforms all in one place. Create new positions, manage liquidity, collect fees, and close positions.
          </p>
        </div>

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
