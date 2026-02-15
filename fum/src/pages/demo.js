// src/pages/demo.js
import React, { useState, useEffect, useCallback } from "react";
import { useSelector, useDispatch } from "react-redux";
import { Container, Row, Col, Card, Alert, Spinner, Badge, Form } from "react-bootstrap";
import Head from "next/head";
import { ethers } from "ethers";
import Navbar from "../components/common/Navbar";
import TransactionList from "../components/transactions/TransactionList";
import { fetchVaultTrackerData, calculateVaultAPY } from '../utils/vaultsHelpers';
import { updateVaultTrackerData } from '../redux/vaultsSlice';
import { formatTimestamp } from "fum_library/helpers";
import { getStrategyDetails } from "fum_library/helpers";
import { getChainConfig, getChainRpcUrls } from "fum_library/helpers/chainHelpers";
import { getUserVaults, getVaultInfo } from 'fum_library/blockchain/contracts';
import { Wifi, WifiOff } from 'lucide-react';

// Demo configuration from environment variables
const DEMO_ADDRESS = process.env.NEXT_PUBLIC_DEMO_ADDRESS;
const DEMO_CHAIN_ID = parseInt(process.env.NEXT_PUBLIC_DEMO_CHAIN_ID, 10);

/**
 * Format currency value
 */
const formatCurrency = (value) => {
  if (value === null || value === undefined || isNaN(value)) return '$0.00';
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
};

/**
 * Demo Page Component
 * Displays vault automation activity for a demo address without requiring wallet connection
 */
export default function DemoPage() {
  const dispatch = useDispatch();

  // Redux state
  const automationState = useSelector((state) => state.automation);
  const automationConnected = automationState?.connected;

  // Component state
  const [vaults, setVaults] = useState([]);
  const [selectedVaultAddress, setSelectedVaultAddress] = useState(null);
  const [selectedVault, setSelectedVault] = useState(null);
  const [trackerMetadata, setTrackerMetadata] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [provider, setProvider] = useState(null);
  const [chainId, setChainId] = useState(null);

  // Initialize provider and load vaults
  useEffect(() => {
    const initializeDemo = async () => {
      if (!DEMO_ADDRESS) {
        setError("Demo address not configured. Please set NEXT_PUBLIC_DEMO_ADDRESS in environment.");
        setIsLoading(false);
        return;
      }

      if (!DEMO_CHAIN_ID || isNaN(DEMO_CHAIN_ID)) {
        setError("Demo chain ID not configured. Please set NEXT_PUBLIC_DEMO_CHAIN_ID in environment.");
        setIsLoading(false);
        return;
      }

      try {
        setIsLoading(true);

        // Create a read-only provider using chain config
        const rpcUrls = getChainRpcUrls(DEMO_CHAIN_ID);
        const readProvider = new ethers.providers.JsonRpcProvider(rpcUrls[0]);
        setProvider(readProvider);

        // Get network info
        const network = await readProvider.getNetwork();
        const currentChainId = Number(network.chainId);
        setChainId(currentChainId);

        // Get vaults owned by the demo address
        const vaultAddresses = await getUserVaults(DEMO_ADDRESS, readProvider);

        if (vaultAddresses.length === 0) {
          setError("No vaults found for demo address");
          setIsLoading(false);
          return;
        }

        // Load basic vault data for each vault
        const vaultsData = await Promise.all(
          vaultAddresses.map(async (address) => {
            try {
              // Get vault info from factory (name, owner, creationTime)
              const vaultInfo = await getVaultInfo(address, readProvider);

              return {
                address,
                name: vaultInfo.name,
                owner: vaultInfo.owner,
                creationTime: vaultInfo.creationTime
              };
            } catch (e) {
              console.error(`Error loading vault ${address}:`, e);
              return null;
            }
          })
        );

        // Filter out failed loads
        const validVaults = vaultsData.filter(v => v !== null);
        setVaults(validVaults);

        // Select first vault by default
        if (validVaults.length > 0) {
          setSelectedVaultAddress(validVaults[0].address);
        }

        setIsLoading(false);
      } catch (e) {
        console.error("Error initializing demo:", e);
        setError(`Failed to initialize: ${e.message}`);
        setIsLoading(false);
      }
    };

    initializeDemo();
  }, []);

  // Load tracker data when selected vault changes
  useEffect(() => {
    const loadTrackerData = async () => {
      if (!selectedVaultAddress) return;

      try {
        const data = await fetchVaultTrackerData(selectedVaultAddress);
        if (data && data.success) {
          setTrackerMetadata(data.trackerMetadata);
          setSelectedVault(prev => ({
            ...prev,
            ...vaults.find(v => v.address === selectedVaultAddress),
            trackerMetadata: data.trackerMetadata,
            transactionHistory: data.transactionHistory
          }));

          // Also update Redux for real-time updates
          dispatch(updateVaultTrackerData({
            vaultAddress: selectedVaultAddress,
            trackerMetadata: data.trackerMetadata,
            transactionHistory: data.transactionHistory
          }));
        }
      } catch (e) {
        console.error("Error loading tracker data:", e);
      }
    };

    loadTrackerData();
  }, [selectedVaultAddress, vaults, dispatch]);

  // Listen for real-time transaction updates from Redux
  const vaultFromRedux = useSelector((state) =>
    state.vaults.userVaults?.find(v => v.address === selectedVaultAddress)
  );

  // Sync Redux updates to local state
  useEffect(() => {
    if (vaultFromRedux?.transactionHistory) {
      setSelectedVault(prev => ({
        ...prev,
        transactionHistory: vaultFromRedux.transactionHistory,
        trackerMetadata: vaultFromRedux.trackerMetadata
      }));
      setTrackerMetadata(vaultFromRedux.trackerMetadata);
    }
  }, [vaultFromRedux?.transactionHistory, vaultFromRedux?.trackerMetadata]);

  // Handle vault selection change
  const handleVaultChange = (e) => {
    setSelectedVaultAddress(e.target.value);
  };

  // Calculate APY
  const apyData = calculateVaultAPY(trackerMetadata);

  // Get chain config for explorer links
  const chainConfig = chainId ? getChainConfig(chainId) : null;

  if (isLoading) {
    return (
      <>
        <Head>
          <title>Demo - FUM</title>
        </Head>
        <Navbar />
        <Container className="py-5">
          <div className="text-center">
            <Spinner animation="border" variant="primary" />
            <p className="mt-3">Loading demo vaults...</p>
          </div>
        </Container>
      </>
    );
  }

  if (error) {
    return (
      <>
        <Head>
          <title>Demo - FUM</title>
        </Head>
        <Navbar />
        <Container className="py-5">
          <Alert variant="danger">
            <Alert.Heading>Demo Unavailable</Alert.Heading>
            <p>{error}</p>
          </Alert>
        </Container>
      </>
    );
  }

  return (
    <>
      <Head>
        <title>Demo - FUM</title>
        <meta name="description" content="Watch live DeFi automation in action" />
      </Head>
      <Navbar />

      <Container className="py-4">
        {/* Demo Header */}
        <Card className="mb-4" style={{ backgroundColor: '#f8f9fa', border: '1px solid #dee2e6' }}>
          <Card.Body className="py-3">
            <div className="d-flex justify-content-between align-items-center">
              <div>
                <h5 className="mb-1" style={{ color: '#3a3a3a' }}>
                  Live Automation Demo
                </h5>
                <p className="mb-0 text-muted" style={{ fontSize: '0.9rem' }}>
                  Watch real DeFi vault automation running in real-time. This app is currently in beta testing.
                </p>
              </div>
              {/* SSE Connection Indicator */}
              <div className="d-flex align-items-center">
                {automationConnected ? (
                  <Badge bg="success" className="d-flex align-items-center" style={{ fontSize: '0.85rem', padding: '0.5rem 0.75rem' }}>
                    <Wifi size={14} className="me-2" />
                    Live
                  </Badge>
                ) : (
                  <Badge bg="secondary" className="d-flex align-items-center" style={{ fontSize: '0.85rem', padding: '0.5rem 0.75rem' }}>
                    <WifiOff size={14} className="me-2" />
                    Connecting...
                  </Badge>
                )}
              </div>
            </div>
          </Card.Body>
        </Card>

        {/* Vault Selector (if multiple vaults) */}
        {vaults.length > 1 && (
          <Card className="mb-4">
            <Card.Body className="py-3">
              <Form.Group>
                <Form.Label style={{ color: '#525252', fontWeight: 500 }}>Select Vault</Form.Label>
                <Form.Select
                  value={selectedVaultAddress || ''}
                  onChange={handleVaultChange}
                  style={{ maxWidth: '500px' }}
                >
                  {vaults.map((vault) => (
                    <option key={vault.address} value={vault.address}>
                      {vault.name} ({vault.address.slice(0, 6)}...{vault.address.slice(-4)})
                    </option>
                  ))}
                </Form.Select>
              </Form.Group>
            </Card.Body>
          </Card>
        )}

        {/* Vault Overview Card */}
        {selectedVault && (
          <Card className="mb-4">
            <Card.Body>
              {/* First row: Name and TVL */}
              <div className="d-flex justify-content-between align-items-start mb-0">
                <h4 className="mb-0" style={{ color: '#3a3a3a' }}>
                  {selectedVault.name || 'Unnamed Vault'}
                </h4>
                <div className="text-end">
                  <span className="text-muted me-2">TVL:</span>
                  <span className="text-crimson" style={{ fontSize: '1.5rem', fontWeight: 600 }}>
                    {trackerMetadata?.lastSnapshot?.value
                      ? formatCurrency(trackerMetadata.lastSnapshot.value)
                      : '—'}
                  </span>
                </div>
              </div>

              {/* Second row: Address and APY */}
              <div className="d-flex justify-content-between align-items-center mb-1">
                <code style={{ fontSize: '0.875rem', padding: 0, margin: 0 }}>
                  {selectedVaultAddress}
                </code>
                <div>
                  {apyData ? (
                    <span style={{ fontSize: '0.9rem', color: '#3a3a3a' }}>
                      <strong>APY:</strong>{' '}
                      <span style={{ color: apyData.apy < 0 ? '#ef4444' : '#10b981' }}>
                        {apyData.apy < 0 ? '' : '+'}{apyData.apyPercent.toFixed(2)}%
                      </span>
                    </span>
                  ) : (
                    <span style={{ fontSize: '0.9rem', color: '#525252' }}>
                      <strong>APY:</strong> —
                    </span>
                  )}
                </div>
              </div>

              {/* Third row: Strategy */}
              <div className="mb-2">
                <small style={{ color: '#525252' }}>
                  <strong>Strategy:</strong>{' '}
                  {(() => {
                    const strategyId = trackerMetadata?.metadata?.strategyId;
                    if (!strategyId) return 'Unknown';
                    try {
                      const details = getStrategyDetails(strategyId);
                      return details.name;
                    } catch (e) {
                      return strategyId;
                    }
                  })()}
                </small>
              </div>

              {/* Stats row */}
              {trackerMetadata?.aggregates && (
                <>
                  <hr style={{ margin: '1rem 0', borderTop: '1px solid rgba(0,0,0,0.1)' }} />
                  <Row>
                    <Col xs={6} md={3} className="mb-2">
                      <small className="text-muted d-block">Baseline Value</small>
                      <span style={{ fontWeight: 500 }}>
                        {formatCurrency(trackerMetadata.baseline?.value || 0)}
                      </span>
                    </Col>
                    <Col xs={6} md={3} className="mb-2">
                      <small className="text-muted d-block">Total Fees</small>
                      <span style={{ fontWeight: 500, color: '#10b981' }}>
                        {formatCurrency(trackerMetadata.aggregates.cumulativeFeesUSD || 0)}
                      </span>
                    </Col>
                    <Col xs={6} md={3} className="mb-2">
                      <small className="text-muted d-block">Gas Spent</small>
                      <span style={{ fontWeight: 500, color: '#ef4444' }}>
                        {formatCurrency(trackerMetadata.aggregates.cumulativeGasUSD || 0)}
                      </span>
                    </Col>
                    <Col xs={6} md={3} className="mb-2">
                      <small className="text-muted d-block">Transactions</small>
                      <span style={{ fontWeight: 500 }}>
                        {trackerMetadata.aggregates.transactionCount || 0}
                      </span>
                    </Col>
                  </Row>
                  {trackerMetadata.baseline?.timestamp && (
                    <div className="mt-2">
                      <small className="text-muted">
                        Tracking since: {formatTimestamp(trackerMetadata.baseline.timestamp)}
                      </small>
                    </div>
                  )}
                </>
              )}
            </Card.Body>
          </Card>
        )}

        {/* Transaction History */}
        <Card>
          <Card.Header style={{ backgroundColor: '#f8f9fa' }}>
            <h5 className="mb-0" style={{ color: '#3a3a3a' }}>Transaction History</h5>
          </Card.Header>
          <Card.Body>
            <TransactionList
              transactions={selectedVault?.transactionHistory || []}
              chainId={chainId}
              isLoading={!selectedVault}
              emptyMessage="No transactions yet. Activity will appear here as the automation runs."
            />
          </Card.Body>
        </Card>
      </Container>
    </>
  );
}
