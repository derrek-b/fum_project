// src/pages/vault/[address].js
import React, { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/router";
import { useSelector, useDispatch } from "react-redux";
import { Container, Row, Col, Card, Button, Alert, Spinner, Badge, Tabs, Tab, Table, OverlayTrigger, Tooltip } from "react-bootstrap";
import { ErrorBoundary } from "react-error-boundary";
import Link from "next/link";
import Head from "next/head";
import { ethers } from "ethers";
import Navbar from "../../components/Navbar";
import PositionCard from "../../components/positions/PositionCard";
import PositionSelectionModal from "../../components/vaults/PositionSelectionModal";
import VaultPositionModal from "@/components/vaults/VaultPositionModal";
import TokenDepositModal from "../../components/vaults/TokenDepositModal";
import StrategyConfigPanel from "../../components/vaults/StrategyConfigPanel";
import RefreshControls from "../../components/RefreshControls";
import { useToast } from "../../context/ToastContext";
import { triggerUpdate } from "../../redux/updateSlice";
import { updateVaultTokenBalances } from "@/redux/vaultsSlice";
import { formatTimestamp } from "../../utils/formatHelpers";
import { getAllTokens } from "../../utils/tokenConfig";
import { loadVaultData, getVaultData } from '../../utils/vaultsHelpers';
import { fetchTokenPrices, prefetchTokenPrices, calculateUsdValueSync } from '../../utils/coingeckoUtils';
import Image from "next/image";

// Minimal ERC20 ABI for token balance checks
const ERC20_ABI = [
  {
    constant: true,
    inputs: [{ name: "_owner", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "balance", type: "uint256" }],
    type: "function"
  }
];

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
          onClick={() => router.push('/vaults')}
        >
          Go to Vaults
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
  const pools = useSelector((state) => state.pools);
  const tokens = useSelector((state) => state.tokens);
  const { chainId, provider, address: userAddress } = useSelector((state) => state.wallet);
  const lastUpdate = useSelector((state) => state.updates.lastUpdate);
  const vaultFromRedux = useSelector((state) =>
    state.vaults.userVaults.find(v => v.address === vaultAddress)
  );
  const vaultMetrics = vaultFromRedux?.metrics || {};

  // Get strategy info from Redux store
  const { strategyConfigs, activeStrategies, strategyPerformance, executionHistory } = useSelector((state) => state.strategies);

  // Component state
  const [vault, setVault] = useState(null);
  const [vaultPositions, setVaultPositions] = useState([]);
  const [activeTab, setActiveTab] = useState('positions');
  const [showAddPositionModal, setShowAddPositionModal] = useState(false);
  const [showDepositModal, setShowDepositModal] = useState(false);
  const [showCreatePositionModal, setShowCreatePositionModal] = useState(false);
  const [vaultTokens, setVaultTokens] = useState([]);
  const [isLoadingTokens, setIsLoadingTokens] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [isOwner, setIsOwner] = useState(false);
  const [tokenPricesLoaded, setTokenPricesLoaded] = useState(false);
  const [totalTokenValue, setTotalTokenValue] = useState(0);

  // Get strategy data from Redux
  const strategyConfig = strategyConfigs?.[vaultAddress];
  const strategyActive = activeStrategies?.[vaultAddress]?.isActive || false;
  const performance = strategyPerformance?.[vaultAddress];
  const history = executionHistory?.[vaultAddress] || [];

  // Fetch token balances for the vault
  const fetchVaultTokens = async () => {
    if (!vaultAddress || !provider) return;

    setIsLoadingTokens(true);
    try {
      const allTokens = getAllTokens();
      const tokenAddresses = Object.values(allTokens)
        .filter(token => token.addresses[chainId])
        .map(token => ({
          ...token,
          address: token.addresses[chainId]
        }));

      // First, get all token symbols for prefetching prices
      const allSymbols = tokenAddresses.map(token => token.symbol);

      // Prefetch all token prices at once to populate the cache
      await prefetchTokenPrices(allSymbols);
      setTokenPricesLoaded(true);

      const tokenBalances = await Promise.all(
        tokenAddresses.map(async (token) => {
          try {
            const tokenContract = new ethers.Contract(token.address, ERC20_ABI, provider);
            const balance = await tokenContract.balanceOf(vaultAddress);
            const formattedBalance = ethers.formatUnits(balance, token.decimals);
            const numericalBalance = parseFloat(formattedBalance);

            // Skip tokens with 0 balance
            if (numericalBalance === 0) return null;

            // Get token price from our utility
            const valueUsd = calculateUsdValueSync(formattedBalance, token.symbol);

            return {
              ...token,
              balance: formattedBalance,
              numericalBalance,
              valueUsd: valueUsd || 0
            };
          } catch (err) {
            console.error(`Error fetching balance for ${token.symbol}:`, err);
            return null;
          }
        })
      );

      const filteredTokens = tokenBalances.filter(token => token !== null);

      // Calculate total value of all tokens
      const totalValue = filteredTokens.reduce((sum, token) => sum + (token.valueUsd || 0), 0);
      setTotalTokenValue(totalValue);

      setVaultTokens(filteredTokens);

      // Store token balances in Redux
      const tokenBalancesMap = {};
      filteredTokens.forEach(token => {
        tokenBalancesMap[token.symbol] = {
          symbol: token.symbol,
          name: token.name,
          balance: token.balance,
          numericalBalance: token.numericalBalance,
          valueUsd: token.valueUsd,
          decimals: token.decimals,
          logoURI: token.logoURI
        };
      });

      // Update token balances in Redux
      if (Object.keys(tokenBalancesMap).length > 0) {
        dispatch(updateVaultTokenBalances({
          vaultAddress,
          tokenBalances: tokenBalancesMap
        }));
      }
    } catch (err) {
      console.error("Error fetching token balances:", err);
      showError("Failed to fetch vault tokens");
    } finally {
      setIsLoadingTokens(false);
    }
  };

  // Create loadData function to replace the useVaultDetailData hook
  const loadData = useCallback(async () => {
    if (!vaultAddress || !provider || !chainId) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Use our getVaultData utility function to load vault data directly from chain
      const result = await getVaultData(vaultAddress, provider, chainId, dispatch, {
        showError,
        showSuccess
      });

      if (result.success) {
        // Update vault info
        setVault(result.vault);
        setVaultPositions(result.positions || []);

        // Check if user is the owner
        setIsOwner(
          userAddress &&
          result.vault.owner &&
          userAddress.toLowerCase() === result.vault.owner.toLowerCase()
        );
      } else {
        setError(result.error || "Failed to load vault data");
      }
    } catch (err) {
      console.error("Error loading vault data:", err);
      setError("Failed to load vault details: " + err.message);
      showError("Error loading vault details");
    } finally {
      setIsLoading(false);
    }
  }, [vaultAddress, provider, chainId, userAddress, dispatch, showError, showSuccess]);

  // Call loadData when dependencies change or refresh is triggered
  useEffect(() => {
    if (vaultAddress) {
      loadData();
      fetchVaultTokens();
    }
  }, [vaultAddress, refreshTrigger, loadData]);

  // Add a forced refresh function
  const forceRefresh = useCallback(() => {
    // Increment the refresh trigger to force a reload
    setRefreshTrigger(prev => prev + 1);
  }, []);

  // Handle refresh
  const handleRefresh = useCallback(() => {
    // Show a loading message
    showSuccess("Refreshing vault data...");

    try {
      // First force a Redux update
      dispatch(triggerUpdate());

      // Then force component refresh
      forceRefresh();

      // Also refresh token balances
      fetchVaultTokens();
    } catch (error) {
      console.error("Error triggering refresh:", error);
      showError("Failed to refresh data");
    }
  }, [dispatch, forceRefresh, fetchVaultTokens, showSuccess, showError]);

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

  // Handle token withdrawal (for owner)
  const handleWithdrawToken = async (token) => {
    if (!isOwner) {
      showError("Only the vault owner can withdraw tokens");
      return;
    }

    // Implementation would need to call a contract function on the vault
    // to withdraw tokens to the owner's address
    showError("Token withdrawal functionality not yet implemented");
  };

  // Handle refresh after position creation
  const handlePositionCreated = useCallback(() => {
    console.log("Position created, forcing refresh");

    // Force a refresh after a short delay
    setTimeout(() => {
      handleRefresh();
    }, 500);
  }, [handleRefresh]);

  // Format currency values consistently
  const formatCurrency = (value) => {
    if (value === null || value === undefined) return '$0.00';
    return value.toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  };

  // If still loading
  if (isLoading && !vault) {
    return (
      <>
        <Navbar />
        <Container className="py-4">
          <Link href="/vaults" passHref>
            <Button variant="outline-secondary" className="mb-4">
              &larr; Back to Vaults
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
          <Link href="/vaults" passHref>
            <Button variant="outline-secondary" className="mb-4">
              &larr; Back to Vaults
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

        <Link href="/vaults" passHref>
          <Button variant="outline-secondary" className="mb-4">
            &larr; Back to Vaults
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
                    <strong>Total Value Locked:</strong>{' '}
                    {vaultMetrics?.loading ? (
                      <Spinner animation="border" size="sm" />
                    ) : ((vaultMetrics?.tvl !== undefined && vaultMetrics?.tvl !== null) ||
                        (vaultMetrics?.tokenTVL !== undefined && vaultMetrics?.tokenTVL !== null)) ? (
                      <>
                        {formatCurrency((vaultMetrics.tvl || 0) + (vaultMetrics.tokenTVL || 0))}
                        {vaultMetrics.hasPartialData && (
                          <OverlayTrigger
                            placement="top"
                            overlay={<Tooltip>Some data is missing or incomplete. Total value may be underestimated.</Tooltip>}
                          >
                            <span className="text-warning ms-1" style={{ cursor: "help" }}>⚠️</span>
                          </OverlayTrigger>
                        )}
                        {vaultMetrics.lastTVLUpdate && (
                          <OverlayTrigger
                            placement="top"
                            overlay={
                              <Tooltip>
                                <div>Last updated: {new Date(vaultMetrics.lastTVLUpdate).toLocaleString()}</div>
                                <div>Position TVL: {formatCurrency(vaultMetrics.tvl || 0)}</div>
                                <div>Token TVL: {formatCurrency(vaultMetrics.tokenTVL || 0)}</div>
                              </Tooltip>
                            }
                          >
                            <small className="ms-1 text-muted" style={{ cursor: "help", fontSize: "0.7rem" }}>ⓘ</small>
                          </OverlayTrigger>
                        )}
                      </>
                    ) : totalTokenValue > 0 ? (
                      <>
                        {formatCurrency(totalTokenValue)}
                        <OverlayTrigger
                          placement="top"
                          overlay={<Tooltip>Value based on token balances only. Position values not included or unavailable.</Tooltip>}
                        >
                          <small className="ms-1 text-muted" style={{ cursor: "help", fontSize: "0.7rem" }}>ⓘ</small>
                        </OverlayTrigger>
                      </>
                    ) : (
                      <OverlayTrigger
                        placement="top"
                        overlay={<Tooltip>Could not calculate TVL. Token prices may be unavailable.</Tooltip>}
                      >
                        <span className="text-danger">N/A</span>
                      </OverlayTrigger>
                    )}
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
              <div className="d-flex justify-content-between align-items-center mb-3">
                <h5 className="mb-0">Vault Positions</h5>
                <div>
                  <Button
                    variant="outline-primary"
                    onClick={() => setShowCreatePositionModal(true)}
                    className="me-2"
                  >
                    + Create Position
                  </Button>
                  <Button
                    variant="outline-primary"
                    onClick={() => setShowAddPositionModal(true)}
                  >
                    + Add Position
                  </Button>
                </div>
              </div>

              {vaultPositions.length === 0 ? (
                <Alert variant="info" className="text-center">
                  This vault doesn't have any positions yet. Add positions using the button above.
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

            <Tab eventKey="tokens" title="Tokens">
              <div className="d-flex justify-content-between align-items-center mb-3">
                <h5 className="mb-0">Vault Tokens</h5>
                <Button
                  variant="outline-primary"
                  onClick={() => setShowDepositModal(true)}
                >
                  + Deposit Tokens
                </Button>
              </div>

              {isLoadingTokens ? (
                <div className="text-center py-5">
                  <Spinner animation="border" variant="primary" />
                  <p className="mt-3">Loading token balances...</p>
                </div>
              ) : vaultTokens.length === 0 ? (
                <Alert variant="info" className="text-center">
                  This vault doesn't have any tokens yet. Deposit tokens using the button above.
                </Alert>
              ) : (
                <>
                  <div className="text-end mb-3">
                    <strong>Total Token Value: {formatCurrency(totalTokenValue)}</strong>
                  </div>
                  <Table striped hover>
                    <thead>
                      <tr>
                        <th>Token</th>
                        <th>Balance</th>
                        <th>Value (USD)</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {vaultTokens.map((token) => (
                        <tr key={token.symbol}>
                          <td>
                            <div className="d-flex align-items-center">
                              {token.logoURI && (
                                <div className="me-2">
                                  <Image
                                    src={token.logoURI}
                                    alt={token.symbol}
                                    width={24}
                                    height={24}
                                  />
                                </div>
                              )}
                              <div>
                                <div className="fw-bold">{token.symbol}</div>
                                <small className="text-muted">{token.name}</small>
                              </div>
                            </div>
                          </td>
                          <td>{token.numericalBalance.toFixed(6)}</td>
                          <td>{formatCurrency(token.valueUsd)}</td>
                          <td>
                            {isOwner && (
                              <Button
                                variant="outline-secondary"
                                size="sm"
                                onClick={() => handleWithdrawToken(token)}
                              >
                                Withdraw
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </>
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
                      <li>Depositing and withdrawing tokens</li>
                    </ul>

                    <div className="d-grid gap-2 col-md-6 mx-auto mt-4">
                      <Button
                        variant="outline-primary"
                        onClick={() => setShowAddPositionModal(true)}
                      >
                        Add Position
                      </Button>
                      <Button
                        variant="outline-primary"
                        onClick={() => setShowDepositModal(true)}
                      >
                        Deposit Tokens
                      </Button>
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

        {/* Position Selection Modal */}
        <PositionSelectionModal
          show={showAddPositionModal}
          onHide={() => setShowAddPositionModal(false)}
          vault={vault}
          pools={pools}
          tokens={tokens}
          chainId={chainId}
          mode="add"
        />

        {/* Token Deposit Modal */}
        <TokenDepositModal
          show={showDepositModal}
          onHide={() => setShowDepositModal(false)}
          vaultAddress={vaultAddress}
          onTokensUpdated={fetchVaultTokens}
        />

        {/* Vault Position Creation Modal */}
        <VaultPositionModal
          show={showCreatePositionModal}
          onHide={() => setShowCreatePositionModal(false)}
          vaultAddress={vaultAddress}
          onPositionCreated={handlePositionCreated}
        />
      </Container>
    </>
  );
}
