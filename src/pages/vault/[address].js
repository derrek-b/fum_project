// src/pages/vault/[address].js
import React, { useState, useEffect } from "react";
import { useRouter } from "next/router";
import { useSelector, useDispatch } from "react-redux";
import { Container, Row, Col, Card, Button, Alert, Spinner, Badge, Tabs, Tab, Table } from "react-bootstrap";
import { ErrorBoundary } from "react-error-boundary";
import Link from "next/link";
import Head from "next/head";
import Navbar from "../../components/Navbar";
import PositionCard from "../../components/PositionCard";
import StrategyConfigPanel from "../../components/vault_wizard/StrategyConfigPanel";
import RefreshControls from "../../components/RefreshControls";
import { useToast } from "../../context/ToastContext";
import { useVaultDetailData } from "../../hooks/useVaultDetailData";
import { triggerUpdate } from "../../redux/updateSlice";
import { formatTimestamp } from "../../utils/formatHelpers";

// Error Fallback Component
function ErrorFallback({ error, resetErrorBoundary }) {
  const { showError } = useToast();
  const router = useRouter();

  // Log the error and notify via toast
  React.useEffect(() => {
    console.error("Vault detail page error:", error);
    showError("There was a problem loading the vault. Please try again.");
  }, [error, showError]);

  return (
    <Alert variant="danger" className="my-4">
      <Alert.Heading>Something went wrong</Alert.Heading>
      <p>
        We encountered an error while loading this vault's details. You can try going back to the dashboard or refreshing the page.
      </p>
      <hr />
      <div className="d-flex justify-content-between">
        <Button
          variant="outline-secondary"
          onClick={() => router.push('/')}
        >
          Go to Dashboard
        </Button>
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

export default function VaultDetailPage() {
  const router = useRouter();
  const dispatch = useDispatch();
  const { showError, showSuccess } = useToast();
  const { address: vaultAddress } = router.query;

  // Get strategy info from Redux store
  const { strategyConfigs, activeStrategies, strategyPerformance, executionHistory } = useSelector((state) => state.strategies);

  // Use our custom hook for vault details
  const { vault, vaultPositions, isLoading, isOwner, error, loadData } = useVaultDetailData(vaultAddress);

  // Component state
  const [activeTab, setActiveTab] = useState('positions');

  // Get strategy data from Redux
  const strategyConfig = strategyConfigs?.[vaultAddress];
  const strategyActive = activeStrategies?.[vaultAddress]?.isActive || false;
  const performance = strategyPerformance?.[vaultAddress];
  const history = executionHistory?.[vaultAddress] || [];

  // Load data when component mounts or dependencies change
  useEffect(() => {
    if (vaultAddress) {
      loadData();
    }
  }, [vaultAddress, loadData]);

  // Handle refresh
  const handleRefresh = () => {
    try {
      dispatch(triggerUpdate());
      loadData();
      showSuccess("Refreshing vault data...");
    } catch (error) {
      console.error("Error triggering refresh:", error);
      showError("Failed to refresh data");
    }
  };

  // Handle withdraw position from vault
  const handleWithdrawPosition = async (positionId) => {
    if (!isOwner) {
      showError("Only the vault owner can withdraw positions");
      return;
    }

    try {
      // Implementation would need to:
      // 1. Create a contract instance for the vault
      // 2. Call withdrawPosition with the NFT contract address and position ID
      // 3. Update state after successful withdrawal

      // This is a placeholder - actual implementation would interact with the contract
      showSuccess("Position withdrawn from vault");
      dispatch(triggerUpdate());
    } catch (error) {
      console.error("Error withdrawing position:", error);
      showError(`Failed to withdraw position: ${error.message}`);
    }
  };

  // Handle strategy activation toggle
  const handleStrategyToggle = async (active) => {
    if (!isOwner) {
      showError("Only the vault owner can control strategies");
      return;
    }

    try {
      // Implementation would need to:
      // 1. Create a contract instance for the vault
      // 2. Call setStrategyAuthorization for the strategy contract
      // 3. Update state after successful transaction

      // This is a placeholder - actual implementation would interact with the contract
      showSuccess(`Strategy ${active ? 'activated' : 'deactivated'}`);
      dispatch(triggerUpdate());
    } catch (error) {
      console.error("Error toggling strategy:", error);
      showError(`Failed to ${active ? 'activate' : 'deactivate'} strategy: ${error.message}`);
    }
  };

  // If still loading
  if (isLoading && !vault) {
    return (
      <>
        <Navbar />
        <Container className="py-4">
          <Link href="/" passHref>
            <Button variant="outline-secondary" className="mb-4">
              &larr; Back to Dashboard
            </Button>
          </Link>
          <div className="text-center py-5">
            <Spinner animation="border" variant="primary" />
            <p className="mt-3">Loading vault details...</p>
          </div>
        </Container>
      </>
    );
  }

  // If error or vault not found
  if (!vault && !isLoading) {
    return (
      <>
        <Navbar />
        <Container className="py-4">
          <Link href="/" passHref>
            <Button variant="outline-secondary" className="mb-4">
              &larr; Back to Dashboard
            </Button>
          </Link>
          <Alert variant="danger">
            <Alert.Heading>Vault Not Found</Alert.Heading>
            <p>
              {error || "The requested vault could not be found or you don't have access to view it."}
            </p>
          </Alert>
        </Container>
      </>
    );
  }

  return (
    <>
      <Navbar />
      <Container className="py-4">
        <Head>
          <title>{vault?.name || 'Vault Detail'} | DeFi Dashboard</title>
        </Head>

        <Link href="/" passHref>
          <Button variant="outline-secondary" className="mb-4">
            &larr; Back to Dashboard
          </Button>
        </Link>

        <ErrorBoundary
          FallbackComponent={ErrorFallback}
          onReset={() => {
            handleRefresh();
          }}
        >
          <div className="d-flex justify-content-between align-items-center mb-3">
            <h1 className="mb-0">
              {vault.name}
              {isOwner && (
                <Badge bg="secondary" className="ms-2">Owner</Badge>
              )}
              {strategyActive && (
                <Badge bg="success" className="ms-2">Active Strategy</Badge>
              )}
            </h1>

            <div className="d-flex align-items-center">
              <RefreshControls />
            </div>
          </div>

          {/* Vault Overview Card */}
          <Card className="mb-4">
            <Card.Body>
              <Row>
                <Col md={4}>
                  <div className="mb-3">
                    <strong>Created:</strong> {formatTimestamp(vault.creationTime)}
                  </div>
                  <div className="mb-3">
                    <strong>Owner:</strong> {vault.owner.substring(0, 6)}...{vault.owner.substring(vault.owner.length - 4)}
                  </div>
                </Col>
                <Col md={4}>
                  <div className="mb-3">
                    <strong>Positions:</strong> {vaultPositions.length}
                  </div>
                  <div className="mb-3">
                    <strong>Total Value Locked:</strong> ${vault.metrics?.tvl ? vault.metrics.tvl.toFixed(2) : '0.00'}
                  </div>
                </Col>
                <Col md={4}>
                  <div className="mb-3">
                    <strong>Strategy:</strong> {strategyActive ? 'The Fed (Active)' : 'None'}
                  </div>
                  <div className="mb-3">
                    <strong>APY:</strong> {performance?.apy ? `${performance.apy.toFixed(2)}%` : '—'}
                  </div>
                </Col>
              </Row>
              <div className="mb-0">
                <strong>Vault Address:</strong> <code>{vaultAddress}</code>
              </div>
            </Card.Body>
          </Card>

          {/* Tabs for different sections */}
          <Tabs
            activeKey={activeTab}
            onSelect={(k) => setActiveTab(k)}
            className="mb-4"
          >
            <Tab eventKey="positions" title="Positions">
              {vaultPositions.length === 0 ? (
                <Alert variant="info" className="text-center">
                  This vault doesn't have any positions yet. Deposit positions to use them with strategies.
                </Alert>
              ) : (
                <Row>
                  {vaultPositions.map((position) => (
                    <Col md={6} key={position.id}>
                      <PositionCard
                        position={position}
                        inVault={true}
                        vaultAddress={vaultAddress}
                      />
                    </Col>
                  ))}
                </Row>
              )}
            </Tab>

            <Tab eventKey="strategy" title="Strategy">
              <StrategyConfigPanel
                vaultAddress={vaultAddress}
                isOwner={isOwner}
                strategyConfig={strategyConfig}
                strategyActive={strategyActive}
                performance={performance}
                onStrategyToggle={handleStrategyToggle}
              />
            </Tab>

            <Tab eventKey="history" title="History">
              {history.length === 0 ? (
                <Alert variant="info" className="text-center">
                  No strategy execution history yet.
                </Alert>
              ) : (
                <Table striped hover>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Action</th>
                      <th>Result</th>
                      <th>Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((record, index) => (
                      <tr key={index}>
                        <td>{formatTimestamp(record.timestamp)}</td>
                        <td>{record.action}</td>
                        <td>
                          <Badge bg={record.success ? "success" : "danger"}>
                            {record.success ? "Success" : "Failed"}
                          </Badge>
                        </td>
                        <td>{record.details}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Tab>

            {isOwner && (
              <Tab eventKey="management" title="Management">
                <Card>
                  <Card.Body>
                    <h4>Vault Management</h4>
                    <p>As the vault owner, you have control over:</p>
                    <ul>
                      <li>Adding and removing positions</li>
                      <li>Configuring and activating strategies</li>
                      <li>Setting authorization levels</li>
                    </ul>

                    <div className="d-grid gap-2 col-md-6 mx-auto mt-4">
                      <Button variant="outline-primary">Deposit Position</Button>
                      <Button variant="outline-primary">Withdraw All Positions</Button>
                      <Button
                        variant={strategyActive ? "outline-danger" : "outline-success"}
                        onClick={() => handleStrategyToggle(!strategyActive)}
                      >
                        {strategyActive ? "Deactivate Strategy" : "Activate Strategy"}
                      </Button>
                    </div>
                  </Card.Body>
                </Card>
              </Tab>
            )}
          </Tabs>
        </ErrorBoundary>
      </Container>
    </>
  );
}
