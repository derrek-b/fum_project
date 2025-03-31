// src/components/TokenDepositsSection.js
import { ethers } from 'ethers';
import React, { useState, useEffect } from 'react';
import { useSelector } from 'react-redux';
import { Card, Form, InputGroup, Button, Alert, Spinner, Badge } from 'react-bootstrap';
import Image from 'next/image';
import { useToast } from '../context/ToastContext';
import { getAllTokens } from '../utils/tokenConfig';
import { formatUnits } from '../utils/formatHelpers';

/**
 * Component for selecting and depositing tokens into a vault
 */
const TokenDepositsSection = ({
  selectedTokens,
  setSelectedTokens,
  depositAmounts,
  onAmountChange,
  useStrategy,
  strategyId
}) => {
  const { address, provider, chainId } = useSelector((state) => state.wallet);
  const tokenConfigs = useSelector((state) => state.tokens);
  const { showError } = useToast();

  const [tokenBalances, setTokenBalances] = useState({});
  const [isLoading, setIsLoading] = useState(true);

  // Get supported tokens based on strategy
  const getSupportedTokens = () => {
    if (useStrategy && strategyId) {
      // Get tokens supported by the selected strategy
      const strategy = useSelector((state) => state.strategies.availableStrategies[strategyId]);
      return strategy?.supportedTokens || getAllTokens();
    }
    return getAllTokens(); // Default to all tokens for "no strategy"
  };

  // Fetch token balances for wallet
  useEffect(() => {
    const fetchBalances = async () => {
      if (!address || !provider || !chainId) {
        setTokenBalances({});
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      try {
        const signer = await provider.getSigner();
        const supportedTokens = getSupportedTokens();
        const balances = {};

        // For each token, fetch balance
        await Promise.all(
          Object.entries(supportedTokens).map(async ([symbol, tokenData]) => {
            try {
              const tokenAddress = tokenData.addresses[chainId];
              if (!tokenAddress) return;

              // Create token contract
              const tokenContract = new ethers.Contract(
                tokenAddress,
                ['function balanceOf(address) view returns (uint256)', 'function decimals() view returns (uint8)'],
                signer
              );

              // Get balance and decimals
              const balance = await tokenContract.balanceOf(address);
              const decimals = tokenData.decimals || await tokenContract.decimals();

              // Store if positive balance
              if (balance > 0) {
                balances[symbol] = {
                  balance,
                  formattedBalance: formatUnits(balance, decimals),
                  decimals
                };
              }
            } catch (error) {
              console.error(`Error fetching balance for ${symbol}:`, error);
            }
          })
        );

        setTokenBalances(balances);
      } catch (error) {
        console.error("Error fetching token balances:", error);
        showError("Failed to load token balances");
      } finally {
        setIsLoading(false);
      }
    };

    fetchBalances();
  }, [address, provider, chainId, showError]);

  // Handle amount change
  const handleAmountChange = (symbol, value) => {
    // Update the parent component's state
    onAmountChange(symbol, value);
  };

  // Handle max button click
  const handleMaxClick = (symbol) => {
    const tokenBalance = tokenBalances[symbol];
    if (tokenBalance) {
      handleAmountChange(symbol, tokenBalance.formattedBalance);
    }
  };

  // Toggle token selection
  const handleTokenToggle = (symbol, isChecked) => {
    if (isChecked) {
      // Add token to selected list
      setSelectedTokens(prev => [...prev, symbol]);
      // Initialize amount
      onAmountChange(symbol, "0");
    } else {
      // Remove token from selected list
      setSelectedTokens(prev => prev.filter(s => s !== symbol));
      // Clear amount
      onAmountChange(symbol, "");
    }
  };

  return (
    <Card className="mb-4">
      <Card.Header>
        <h5 className="mb-0">Token Deposits</h5>
      </Card.Header>
      <Card.Body>
        {isLoading ? (
          <div className="text-center py-4">
            <Spinner animation="border" />
            <p className="mt-2">Loading your wallet tokens...</p>
          </div>
        ) : Object.keys(tokenBalances).length === 0 ? (
          <Alert variant="info">
            No supported tokens found in your wallet. Please add tokens to your wallet first.
          </Alert>
        ) : (
          <>
            <p className="mb-3">Select tokens and amounts to deposit into your vault:</p>

            <div className="token-deposit-list">
              {Object.entries(tokenBalances).map(([symbol, data]) => (
                <div key={symbol} className="token-deposit-item border rounded p-3 mb-3">
                  <div className="d-flex align-items-center justify-content-between mb-2">
                    <div className="d-flex align-items-center">
                      <div className="token-icon me-2">
                        {tokenConfigs[symbol]?.logoURI ? (
                          <Image
                            src={tokenConfigs[symbol].logoURI}
                            width={32}
                            height={32}
                            alt={symbol}
                          />
                        ) : (
                          <div className="placeholder-icon bg-light rounded-circle d-flex align-items-center justify-content-center"
                               style={{ width: '32px', height: '32px' }}>
                            {symbol.substring(0, 2)}
                          </div>
                        )}
                      </div>
                      <div>
                        <h6 className="mb-0">{symbol}</h6>
                        <small className="text-muted">Balance: {data.formattedBalance}</small>
                      </div>
                    </div>
                    <Form.Check
                      type="switch"
                      id={`deposit-switch-${symbol}`}
                      checked={selectedTokens.includes(symbol)}
                      onChange={(e) => handleTokenToggle(symbol, e.target.checked)}
                      label="Deposit"
                    />
                  </div>

                  {selectedTokens.includes(symbol) && (
                    <InputGroup>
                      <Form.Control
                        type="number"
                        placeholder="0.00"
                        value={depositAmounts[symbol] || ""}
                        onChange={(e) => handleAmountChange(symbol, e.target.value)}
                        min="0"
                        step="any"
                      />
                      <Button
                        variant="outline-secondary"
                        onClick={() => handleMaxClick(symbol)}
                      >
                        MAX
                      </Button>
                    </InputGroup>
                  )}
                </div>
              ))}
            </div>

            {selectedTokens.length > 0 && (
              <div className="mt-2 text-end">
                <small className="text-muted">
                  {selectedTokens.length} token(s) selected for deposit
                </small>
              </div>
            )}
          </>
        )}
      </Card.Body>
    </Card>
  );
};

export default TokenDepositsSection;
