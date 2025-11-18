// src/pages/vault/[address].js
import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/router";
import { useSelector, useDispatch } from "react-redux";
import { Container, Row, Col, Card, Button, Alert, Spinner, Badge, Tabs, Tab, Table, Form, OverlayTrigger, Tooltip } from "react-bootstrap";
import { ErrorBoundary } from "react-error-boundary";
import Head from "next/head";
import Link from "next/link";
import Image from "next/image";
import { ethers } from "ethers";
import Navbar from "../../components/Navbar";
import PositionCard from "../../components/positions/PositionCard";
import TokenDepositModal from "../../components/vaults/TokenDepositModal";
import TokenWithdrawModal from "../../components/vaults/TokenWithdrawModal";
import StrategyConfigPanel from "../../components/vaults/StrategyConfigPanel";
import AutomationModal from '../../components/vaults/AutomationModal';
import PositionSelectionModal from "../../components/vaults/PositionSelectionModal";
import RefreshControls from "../../components/RefreshControls";
import { useToast } from "../../context/ToastContext";
import { useProvider } from '../../contexts/ProviderContext';
import { triggerUpdate } from "../../redux/updateSlice";
import { updateVault } from "../../redux/vaultsSlice";
import { loadVaultData, getVaultData, loadVaultTokenBalances } from '../../utils/vaultsHelpers';
import { formatTimestamp } from "fum_library/helpers";
import { getAllTokens } from "fum_library/helpers";
import { fetchTokenPrices, prefetchTokenPrices } from 'fum_library/services';
import { getStrategyDetails } from "fum_library/helpers";
import { getVaultContract } from 'fum_library/blockchain/contracts';
import { getExecutorAddress } from 'fum_library/helpers/chainHelpers';
import * as LucideIcons from 'lucide-react';
import ERC20ARTIFACT from "@openzeppelin/contracts/build/contracts/ERC20.json";
const ERC20ABI = ERC20ARTIFACT.abi;

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
  const { chainId, address: userAddress, isConnected, isReconnecting } = useSelector((state) => state.wallet);
  const { provider } = useProvider();
  const lastUpdate = useSelector((state) => state.updates.lastUpdate);
  const vaultFromRedux = useSelector((state) =>
    state.vaults.userVaults.find(v => v.address === vaultAddress)
  );
  const vaultMetrics = vaultFromRedux?.metrics;
  const vaultTokens = vaultFromRedux?.tokenBalances;

  // Get strategy info from Redux store
  const { strategyConfigs, activeStrategies, strategyPerformance, executionHistory } = useSelector((state) => state.strategies);

  // Component state
  const [vault, setVault] = useState(null);
  const [vaultPositions, setVaultPositions] = useState([]);
  const [activeTab, setActiveTab] = useState('positions');
  const [showDepositModal, setShowDepositModal] = useState(false);
  const [showPositionModal, setShowPositionModal] = useState(false);
  const [positionModalMode, setPositionModalMode] = useState('add');
  const [isLoadingTokens, setIsLoadingTokens] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [isOwner, setIsOwner] = useState(false);
  const [tokenPricesLoaded, setTokenPricesLoaded] = useState(false);
  const [totalTokenValue, setTotalTokenValue] = useState(0);
  const [automationEnabled, setAutomationEnabled] = useState(false);
  const [showAutomationModal, setShowAutomationModal] = useState(false);
  const [isEnablingAutomation, setIsEnablingAutomation] = useState(false);
  const [pendingExecutorAddress, setPendingExecutorAddress] = useState('');
  const [isProcessingAutomation, setIsProcessingAutomation] = useState(false);
  const [showWithdrawModal, setShowWithdrawModal] = useState(false);
  const [selectedWithdrawToken, setSelectedWithdrawToken] = useState(null);

  // Get strategy data from Redux (memoized to prevent unnecessary re-renders)
  const strategyConfig = useMemo(() => strategyConfigs?.[vaultAddress], [strategyConfigs, vaultAddress]);
  const performance = useMemo(() => strategyPerformance?.[vaultAddress], [strategyPerformance, vaultAddress]);
  const history = useMemo(() => executionHistory?.[vaultAddress] || [], [executionHistory, vaultAddress]);

  // Create loadData function to replace the useVaultDetailData hook (memoized)
  const loadData = useCallback(async () => {
    if (!vaultAddress || !provider || !chainId) {
      return;
    }

    // Only show loading spinner on initial load, not on refreshes
    if (!vault) {
      setIsLoading(true);
      // Use our loadVaultData utility function to load all the user's vault data
      const loadResult = await loadVaultData(userAddress, provider, chainId, dispatch, {
        showError,
        showSuccess
      });

      if (!loadResult.success) {
        setError(loadResult.err || "Failed to load user's vault data");
      }
    }

    setError(null);

    try {
      // Load this specific vault's data
      const result = await getVaultData(vaultAddress, provider, chainId, dispatch, {
        showError,
        showSuccess
      });

      if (result.success) {
        // Update local vault info
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
    }
  }, [vaultAddress, userAddress, provider, chainId, lastUpdate]);

  // Handle token withdrawal (for owner) - memoized
  const handleWithdrawToken = useCallback(async (token) => {
    if (!isOwner) {
      showError("Only the vault owner can withdraw tokens");
      return;
    }

    setSelectedWithdrawToken(token);
    setShowWithdrawModal(true);
  }, [isOwner, showError]);

  // Handle the automation toggle - memoized
  const handleAutomationToggle = useCallback((enabled) => {
    if (enabled) {
      // Get the executor address for this chain
      const executorAddr = getExecutorAddress(chainId);

      if (!executorAddr) {
        showError(`No automation executor available for network ${chainId}`);
        return;
      }

      // Check 1: Validate strategy is selected for the vault
      if (!vaultFromRedux.hasActiveStrategy || !vaultFromRedux.strategyAddress) {
        showError("Cannot enable automation without a strategy selected and saved");
        return;
      }

      // Check 2: Validate vault has assets to manage (TVL > 0)
      const totalTVL = (vaultFromRedux.metrics.tvl) + (vaultFromRedux.metrics.tokenTVL);
      if (totalTVL <= 0) {
        showError("Cannot enable automation without assets to manage");
        return;
      }

      // Check 3: Check positions fit strategy when transferring/creating is reinstated

      console.log('setting executor...');
      setPendingExecutorAddress(executorAddr);
      setIsEnablingAutomation(true);
    } else {
      console.log('removing executor...');
      setIsEnablingAutomation(false);
    }

    // Show the confirmation modal
    setShowAutomationModal(true);
  }, [chainId, showError, vaultFromRedux]);

  // Add this new function to handle the actual transaction after confirmation - memoized
  const handleConfirmAutomation = useCallback(async () => {
    if (!vaultAddress || !provider) {
      showError("Unable to connect to your wallet");
      setShowAutomationModal(false);
      return;
    }

    setIsProcessingAutomation(true);

    try {
      // Get signer
      const signer = await provider.getSigner();

      // Get vault contract with signer
      const vaultContract = getVaultContract(vaultAddress, provider).connect(signer);

      // Check if the vault has a strategy set before enabling automation
      if (vaultFromRedux.strategyAddress === "0x0000000000000000000000000000000000000000") {
        showError("Cannot enable automation without an active strategy");
        return;
      }

      // Ensure vault has assets deposited
      if (vaultFromRedux.metrics.tvl === 0 && vaultFromRedux.metrics.tokenTVL === 0) {
        showError("Cannot enable automation without assets to manage.");
        return;
      }

      if (isEnablingAutomation) {
        console.log('Setting executor...', pendingExecutorAddress);

        // Call contract to set executor
        const tx = await vaultContract.setExecutor(pendingExecutorAddress);
        await tx.wait();

        // Update Redux store
        dispatch(updateVault({
          vaultAddress,
          vaultData: {
            executor: pendingExecutorAddress
          }
        }));

        setAutomationEnabled(true);
        showSuccess("Automation enabled successfully");
      } else {
        console.log('Removing executor...');
        // Call contract to remove executor
        const tx = await vaultContract.removeExecutor();
        await tx.wait();

        // Update Redux store with address(0)
        dispatch(updateVault({
          vaultAddress,
          vaultData: {
            executor: "0x0000000000000000000000000000000000000000"
          }
        }));

        setAutomationEnabled(false);
        showSuccess("Automation disabled successfully");
      }
    } catch (error) {
      // Check if user cancelled the transaction
      if (error.code === 'ACTION_REJECTED' || error.code === 4001 || error.message?.includes('user rejected')) {
        // User cancelled - silently revert UI state without logging or showing error
        if (isEnablingAutomation) {
          setAutomationEnabled(false);
        } else {
          setAutomationEnabled(true);
        }
        return;
      }

      // Real error - log and show user-friendly message
      console.error("Error toggling automation:", error);
      const errorDetail = error.reason || error.message || "Unknown error";
      showError(`Failed to ${isEnablingAutomation ? 'enable' : 'disable'} automation: ${errorDetail}`);

      // Revert the UI toggle state
      if (isEnablingAutomation) {
        setAutomationEnabled(false);
      } else {
        setAutomationEnabled(true);
      }
    } finally {
      setIsProcessingAutomation(false);
      setShowAutomationModal(false);
    }
  }, [vaultAddress, provider, showError, showSuccess, vaultFromRedux, isEnablingAutomation, pendingExecutorAddress, dispatch]);

  // Iinitialize toggle based on executor address
  useEffect(() => {
    if (vaultFromRedux && vaultFromRedux.executor) {
      // Check if executor is not address(0)
      const isExecutorEnabled = vaultFromRedux.executor &&
                              vaultFromRedux.executor !== "0x0000000000000000000000000000000000000000";
      setAutomationEnabled(isExecutorEnabled);
    } else {
      setAutomationEnabled(false);
    }
  }, [vaultFromRedux]);

  // Format currency values consistently - memoized
  const formatCurrency = useCallback((value) => {
    if (value === null || value === undefined) return '$0.00';
    return value.toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }, []);

  // If still loading
  // Check if wallet is reconnecting FIRST (show spinner during auto-reconnect)
  if (isReconnecting) {
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
            <p className="mt-3">Reconnecting wallet...</p>
          </div>
        </Container>
      </>
    );
  }

  // Check wallet connection before checking for vault data
  if (!isConnected) {
    return (
      <>
        <Navbar />
        <Container className="py-4">
          <Link href="/vaults" passHref>
            <Button variant="outline-secondary" className="mb-4">
              &larr; Back to Vaults
            </Button>
          </Link>
          <Alert variant="warning" className="text-center">
            <Alert.Heading>Wallet Not Connected</Alert.Heading>
            <p className="mb-0">Please connect your wallet to view vault details.</p>
          </Alert>
        </Container>
      </>
    );
  }

  // If loading OR should be loading (connected but no vault data yet)
  // This prevents flash during the gap between reconnect and data fetch
  if (isLoading || (isConnected && !vault)) {
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

        <div className="mb-4 animate-fade-in d-flex justify-content-between align-items-center">
          <Link href="/vaults" passHref>
            <Button className="btn btn-back">
              &larr; Back to Vaults
            </Button>
          </Link>
          <RefreshControls />
        </div>

        <ErrorBoundary
          FallbackComponent={ErrorFallback}
          onReset={() => {
            window.location.reload();
          }}
        >
          {/* Vault Overview Card */}
          <Card className="mb-4 animate-fade-in">
            <Card.Body>
              <div className="d-flex justify-content-between align-items-baseline">
                <h1 className="mb-0 mt-0 d-flex align-items-center" style={{ fontSize: '2.5rem' }}>
                  {vault.name}
              {vaultFromRedux.strategy?.strategyId ? (
                (() => {
                  const strategyDetails = getStrategyDetails(vaultFromRedux?.strategy?.strategyId);
                  const IconComponent = strategyDetails?.icon ? LucideIcons[strategyDetails.icon] : null;

                  // Use strategy colors when strategy is configured
                  const hasActiveStrategy = vaultFromRedux?.hasActiveStrategy;
                  const bgColor = hasActiveStrategy ? (strategyDetails?.color) : "#6c757d";
                  const borderColor = hasActiveStrategy
                    ? (strategyDetails?.borderColor)
                    : "#6c757d";
                  const textColor = hasActiveStrategy
                    ? (strategyDetails?.textColor)
                    : "#FFFFFF";

                  return (
                    <Badge
                      pill
                      bg=""
                      className="ms-2 d-inline-flex align-items-center"
                      style={{
                        backgroundColor: bgColor,
                        borderColor: borderColor,
                        borderWidth: "1px",
                        borderStyle: "solid",
                        color: textColor,
                        padding: '0.15em 0.5em',
                        fontSize: '0.5em',
                        fontWeight: 'normal'
                      }}
                    >
                      {IconComponent && <IconComponent size={10} className="me-1" />}
                      {strategyDetails?.name || vault?.strategy?.strategyId || "Unknown"}
                    </Badge>
                  );
                })()
              ) : (
                (() => {
                  const noneStrategy = getStrategyDetails("none");
                  const NoneIcon = noneStrategy?.icon ? LucideIcons[noneStrategy.icon] : null;

                  return (
                    <Badge
                      pill
                      bg=""
                      className="ms-2 d-inline-flex align-items-center"
                      style={{
                        backgroundColor: noneStrategy?.color || "#6c757d",
                        borderColor: noneStrategy?.borderColor || noneStrategy?.color || "#6c757d",
                        borderWidth: "1px",
                        borderStyle: "solid",
                        color: noneStrategy?.textColor || "#FFFFFF",
                        padding: '0.15em 0.5em',
                        fontSize: '0.5em',
                        fontWeight: 'normal'
                      }}
                    >
                      {NoneIcon && <NoneIcon size={10} className="me-1" />}
                      {noneStrategy?.name || "No Strategy"}
                    </Badge>
                  );
                })()
              )}
                </h1>

                {/* TVL in top right */}
                <div style={{ textAlign: 'right', margin: 0, padding: 0 }}>
                  <div style={{ fontSize: '2.5rem', fontWeight: '600', margin: 0 }}>
                    {vaultMetrics?.loading ? (
                      <Spinner animation="border" size="sm" />
                    ) : ((vaultMetrics?.tvl !== undefined && vaultMetrics?.tvl !== null) ||
                        (vaultMetrics?.tokenTVL !== undefined && vaultMetrics?.tokenTVL !== null)) ? (
                      <>
                        <span className="text-crimson">
                          {formatCurrency((vaultMetrics.tvl || 0) + (vaultMetrics.tokenTVL || 0))}
                        </span>
                        {vaultMetrics.hasPartialData && (
                          <OverlayTrigger
                            placement="top"
                            overlay={<Tooltip>Some data is missing or incomplete. Total value may be underestimated.</Tooltip>}
                          >
                            <span className="text-warning ms-1" style={{ cursor: "help" }}>⚠️</span>
                          </OverlayTrigger>
                        )}
                        <OverlayTrigger
                          placement="top"
                          overlay={
                            <Tooltip>
                              <div>Last updated: {vaultMetrics.lastTVLUpdate ? new Date(vaultMetrics.lastTVLUpdate).toLocaleString() : 'N/A'}</div>
                              <div>Position TVL: {formatCurrency(vaultMetrics.tvl || 0)}</div>
                              <div>Token TVL: {formatCurrency(vaultMetrics.tokenTVL || 0)}</div>
                            </Tooltip>
                          }
                        >
                          <small className="ms-1 text-muted" style={{ cursor: "help", fontSize: "0.7rem", position: "relative", top: "-0.2rem" }}>ⓘ</small>
                        </OverlayTrigger>
                      </>
                    ) : vaultMetrics?.tokenTVL > 0 ? (
                      <>
                        <span className="text-crimson">{formatCurrency(vaultMetrics?.tokenTVL)}</span>
                        <OverlayTrigger
                          placement="top"
                          overlay={<Tooltip>Value based on token balances only. Position values not included or unavailable.</Tooltip>}
                        >
                          <small className="ms-1 text-muted" style={{ cursor: "help", fontSize: "0.7rem", position: "relative", top: "-0.2rem" }}>ⓘ</small>
                        </OverlayTrigger>
                      </>
                    ) : (
                      <span className="text-danger">Error</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Second row: Address and APY aligned */}
              <div className="d-flex justify-content-between mb-0">
                {/* Vault Address */}
                <div>
                  <code style={{ fontSize: '1.1rem', padding: 0, margin: 0 }}>
                    {vaultAddress}
                  </code>
                </div>

                {/* APY */}
                <div style={{ textAlign: 'right' }}>
                  <small style={{ fontSize: '0.9rem', color: '#525252' }}>
                    <strong>APY:</strong> {performance?.apy ? `${performance.apy.toFixed(2)}%` : '—'}
                  </small>
                </div>
              </div>

              {/* Created timestamp */}
              <div className="mb-3">
                <small style={{ fontSize: '0.9rem', color: '#525252' }}>
                  <strong>Created:</strong> {formatTimestamp(vault.creationTime)}
                </small>
              </div>

              {/* Divider */}
              <hr style={{ margin: '1rem 0', border: 'none', borderTop: '2px solid rgba(0, 0, 0, 0.3)' }} />

              {/* Automation Toggle */}
              <div className="d-flex align-items-center">
                <span style={{ fontSize: '1.75rem', marginRight: '1.25rem' }} className="text-crimson">
                  <strong>Automation:</strong>
                </span>
                <OverlayTrigger
                  placement="top"
                  overlay={
                    <Tooltip>
                      {!vaultFromRedux.strategy?.strategyId || vaultFromRedux.strategy?.strategyId === 'none'
                        ? "Automation requires an active strategy"
                        : ((vaultMetrics?.tvl) + (vaultMetrics?.tokenTVL) === 0)
                          ? "Automation requires assets in the vault"
                          : automationEnabled
                            ? "Click to disable automated strategy execution"
                            : "Click to enable automated strategy execution"}
                    </Tooltip>
                  }
                >
                  <span style={{ display: 'inline-block', position: 'relative', top: '3px' }}>
                    <Form.Check
                      type="switch"
                      id="automation-toggle"
                      checked={automationEnabled}
                      onChange={(e) => handleAutomationToggle(e.target.checked)}
                      disabled={
                        // Disable if:
                        // 1. No strategy selected
                        !vaultFromRedux.strategy?.strategyId ||
                        vaultFromRedux.strategy?.strategyId === 'none' ||
                        // 2. TVL is 0 (no assets in vault)
                        ((vaultMetrics?.tvl || 0) + (vaultMetrics?.tokenTVL || 0) === 0)
                      }
                      style={{ transform: 'scale(1.2)', marginRight: '0.5rem' }}
                    />
                  </span>
                </OverlayTrigger>
                <span className="text-muted" style={{ fontSize: '1.75rem' }}>
                  {automationEnabled ? 'Enabled' : 'Disabled'}
                </span>
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
                {isOwner && (
                  <div className="d-flex gap-2">
                    <Button
                      variant="outline-primary"
                      onClick={() => {
                        setPositionModalMode('add');
                        setShowPositionModal(true);
                      }}
                      disabled={automationEnabled}
                    >
                      + Add Positions
                    </Button>
                    <Button
                      variant=""
                      className="btn btn-back"
                      onClick={() => {
                        setPositionModalMode('remove');
                        setShowPositionModal(true);
                      }}
                      disabled={automationEnabled || vaultPositions.length === 0}
                    >
                      - Remove Positions
                    </Button>
                  </div>
                )}
              </div>

              {vaultPositions.length === 0 ? (
                <Alert variant="info" className="text-center">
                  This vault doesn't have any positions yet.
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
                  disabled={automationEnabled}
                >
                  + Deposit Tokens
                </Button>
              </div>

              {isLoadingTokens ? (
                <div className="text-center py-5">
                  <Spinner animation="border" variant="primary" />
                  <p className="mt-3">Loading token balances...</p>
                </div>
              ) : !vaultTokens || Object.keys(vaultTokens).length === 0 ? (
                <Alert variant="info" className="text-center">
                  This vault doesn't have any tokens yet. Deposit tokens using the button above.
                </Alert>
              ) : (
                <>
                  <div className="text-end mb-3">
                    <strong>Total Token Value: {formatCurrency(vaultMetrics?.tokenTVL)}</strong>
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
                      {Object.keys(vaultTokens).map((tokenKey) => {
                        const token = vaultTokens[tokenKey]
                        return (
                          <tr key={token.symbol}>
                            <td>
                              <div className="d-flex align-items-center">
                                {token.logoURI && (
                                  <div className="me-2">
                                    <img
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
                            <td>{token.numericalBalance.toFixed(5)}</td>
                            <td>{formatCurrency(token.valueUsd)}</td>
                            <td>
                              {isOwner && (
                                <Button
                                  className="btn btn-back btn-sm"
                                  onClick={() => handleWithdrawToken(token)}
                                >
                                  Withdraw
                                </Button>
                              )}
                            </td>
                          </tr>
                        )
                      })}
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
                performance={performance}
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
          </Tabs>
        </ErrorBoundary>

        {/* Token Deposit Modal */}
        <TokenDepositModal
          show={showDepositModal}
          onHide={() => setShowDepositModal(false)}
          vaultAddress={vaultAddress}
          onTokensUpdated={() => loadVaultTokenBalances(vaultAddress, provider, chainId, dispatch)}
        />

        {/* Token Withdraw Modal */}
        <TokenWithdrawModal
          show={showWithdrawModal}
          onHide={() => {
            setShowWithdrawModal(false);
            setSelectedWithdrawToken(null);
          }}
          vaultAddress={vaultAddress}
          token={selectedWithdrawToken}
          ownerAddress={vaultFromRedux?.owner}
          onTokensUpdated={() => loadVaultTokenBalances(vaultAddress, provider, chainId, dispatch)}
        />

        {/* Automation Modal */}
        <AutomationModal
          show={showAutomationModal}
          onHide={() => setShowAutomationModal(false)}
          isEnabling={isEnablingAutomation}
          executorAddress={pendingExecutorAddress}
          onConfirm={handleConfirmAutomation}
          isLoading={isProcessingAutomation}
        />

        {/* Position Selection Modal */}
        <PositionSelectionModal
          show={showPositionModal}
          onHide={() => setShowPositionModal(false)}
          vault={vault}
          pools={pools}
          tokens={tokens}
          chainId={chainId}
          mode={positionModalMode}
        />
      </Container>
    </>
  );
}
