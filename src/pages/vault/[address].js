// src/pages/vault/[address].js
import React, { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/router";
import { useSelector, useDispatch } from "react-redux";
import { Container, Row, Col, Card, Button, Alert, Spinner, Badge, Tabs, Tab, Table } from "react-bootstrap";
import { ErrorBoundary } from "react-error-boundary";
import Link from "next/link";
import Head from "next/head";
import Navbar from "../../components/Navbar";
import PositionCard from "../../components/PositionCard";
import StrategyConfigPanel from "../../components/StrategyConfigPanel";
import RefreshControls from "../../components/RefreshControls";
import { useToast } from "../../context/ToastContext";
import { getVaultInfo, getVaultContract } from "../../utils/contracts";
import { updateVault, updateVaultMetrics } from "../../redux/vaultsSlice";
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

  // Redux state
  const { isConnected, address: userAddress, chainId, provider } = useSelector((state) => state.wallet);
  const { userVaults, vaultMetrics } = useSelector((state) => state.vaults);
  const { positions } = useSelector((state) => state.positions);
  const { strategyConfigs, activeStrategies, strategyPerformance, executionHistory } = useSelector((state) => state.strategies);

  // Component state
  const [vault, setVault] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('positions');
  const [isOwner, setIsOwner] = useState(false);

  // Get vault data from userVaults
  const vaultFromRedux = useMemo(() => {
    if (!userVaults || !vaultAddress) return null;
    return userVaults.find(v => v.address === vaultAddress);
  }, [userVaults, vaultAddress]);

  // Get vault positions
  const vaultPositions = useMemo(() => {
    if (!positions || !vaultAddress) return [];
    return positions.filter(p => p.inVault && p.vaultAddress === vaultAddress);
  }, [positions, vaultAddress]);

  // Get vault metrics
  const metrics = useMemo(() => {
    if (!vaultMetrics || !vaultAddress) return { tvl: 0, positionCount: 0 };
    return vaultMetrics[vaultAddress] || { tvl: 0, positionCount: 0 };
  }, [vaultMetrics, vaultAddress]);

  // Get strategy data
  const strategyConfig = useMemo(() => {
    if (!strategyConfigs || !vaultAddress) return null;
    return strategyConfigs[vaultAddress];
  }, [strategyConfigs, vaultAddress]);

  const strategyActive = useMemo(() => {
    if (!activeStrategies || !vaultAddress) return false;
    return activeStrategies[vaultAddress]?.isActive || false;
  }, [activeStrategies, vaultAddress]);

  const performance = useMemo(() => {
    if (!strategyPerformance || !vaultAddress) return null;
    return strategyPerformance[vaultAddress];
  }, [strategyPerformance, vaultAddress]);

  const history = useMemo(() => {
    if (!executionHistory || !vaultAddress) return [];
    return executionHistory[vaultAddress] || [];
  }, [executionHistory, vaultAddress]);

  // Fetch vault data on mount - SPLIT INTO TWO EFFECTS TO AVOID LOOP
  useEffect(() => {
    if (!vaultAddress || !provider) {
      return;
    }

    const fetchVaultData = async () => {
      setLoading(true);
      setError(null);

      try {
        // Fetch vault info from contracts
        const vaultInfo = await getVaultInfo(vaultAddress, provider);

        // Create vault object
        const vaultData = {
          address: vaultAddress,
          ...vaultInfo
        };

        // Check if user is the owner
        setIsOwner(userAddress && vaultInfo.owner && userAddress.toLowerCase() === vaultInfo.owner.toLowerCase());

        // Update local state
        setVault(vaultData);

        // Update Redux if vault info changed
        if (vaultFromRedux) {
          // Check if we need to update
          const needsUpdate =
            vaultFromRedux.name !== vaultData.name ||
            vaultFromRedux.owner !== vaultData.owner;

          if (needsUpdate) {
            dispatch(updateVault({
              vaultAddress,
              vaultData
            }));
          }
        }
      } catch (err) {
        console.error("Error fetching vault data:", err);
        setError("Failed to load vault details: " + err.message);
        showError("Error loading vault details");
      } finally {
        setLoading(false);
      }
    };

    fetchVaultData();
  }, [vaultAddress, provider, vaultFromRedux, dispatch, userAddress, showError]);

  // Separate effect for position count updates to avoid infinite loops
  useEffect(() => {
    if (!vaultAddress || !provider || !vault) {
      return;
    }

    const updatePositionMetrics = () => {
      try {
        // Calculate metrics
        const calculatedPositionCount = vaultPositions.length;

        // Only update if the value is different from what's in Redux
        // This prevents unnecessary updates that could cause loops
        if (metrics.positionCount !== calculatedPositionCount) {
          dispatch(updateVaultMetrics({
            vaultAddress,
            metrics: {
              positionCount: calculatedPositionCount,
              // Don't update other metrics that may be set elsewhere
              lastCalculated: Date.now()
            }
          }));
        }
      } catch (err) {
        console.error("Error updating position metrics:", err);
      }
    };

    updatePositionMetrics();
  }, [vaultAddress, vault, vaultPositions.length, dispatch]);

  // Handle refresh
  const handleRefresh = () => {
    try {
      dispatch(triggerUpdate());
      showSuccess("Refreshing vault data...");
    } catch (error) {
      console.error("Error triggering refresh:", error);
      showError("Failed to refresh data");
    }
  };

  // Handle withdraw position from vault
  const handleWithdrawPosition = async (positionId) => {
    if (!isOwner || !provider) {
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
    if (!isOwner || !provider) {
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
  if (loading && !vault) {
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
  if (!vault && !loading) {
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
                    <strong>Positions:</strong> {metrics.positionCount || 0}
                  </div>
                  <div className="mb-3">
                    <strong>Total Value Locked:</strong> ${metrics.tvl ? metrics.tvl.toFixed(2) : '0.00'}
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
