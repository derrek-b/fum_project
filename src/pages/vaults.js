// src/pages/vaults.js
import React from 'react';
import { Container, Alert } from 'react-bootstrap';
import { ErrorBoundary } from 'react-error-boundary';
import Head from 'next/head';
import { useSelector } from 'react-redux';
import Navbar from '../components/Navbar';
import VaultsContainer from '../components/vaults/VaultsContainer';
import { useToast } from '../context/ToastContext';

// Error Fallback Component
function ErrorFallback({ error, resetErrorBoundary }) {
  const { showError } = useToast();

  // Log the error and notify via toast
  React.useEffect(() => {
    console.error("Vaults page error:", error);
    showError("There was a problem loading the vaults page. Please try again.");
  }, [error, showError]);

  return (
    <Alert variant="danger" className="my-4">
      <Alert.Heading>Something went wrong</Alert.Heading>
      <p>
        We encountered an error while loading the vaults page. Please try refreshing.
      </p>
      <hr />
      <div className="d-flex justify-content-end">
        <button
          className="btn btn-outline-danger"
          onClick={resetErrorBoundary}
        >
          Try again
        </button>
      </div>
    </Alert>
  );
}

export default function VaultsPage() {
  const { isConnected } = useSelector((state) => state.wallet);

  return (
    <div>
      <Head>
        <title>DeFi Vaults | Liquidity Management Dashboard</title>
        <meta name="description" content="Manage your DeFi vaults and automated strategies" />
      </Head>

      <Navbar />

      <Container className="py-4">
        <h1 className="mb-4">Vault Management</h1>

        {!isConnected ? (
          <Alert variant="info" className="text-center">
            Connect your wallet to view and manage your DeFi vaults
          </Alert>
        ) : (
          <ErrorBoundary
            FallbackComponent={ErrorFallback}
            onReset={() => {
              // Force reload the page
              window.location.reload();
            }}
          >
            <VaultsContainer />
          </ErrorBoundary>
        )}
      </Container>
    </div>
  );
}
