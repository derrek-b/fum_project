// src/components/TokenDepositModal.js
import React, { useState, useEffect } from "react";
import { Modal, Button, Form, InputGroup, Spinner, Alert } from "react-bootstrap";
import { useSelector } from "react-redux";
import { ethers } from "ethers";
import { getTokensByChain } from 'fum_library/helpers/tokenHelpers';
import { useToast } from "../../context/ToastContext";
import { useProviders } from "../../hooks/useProviders";

// CSS styles for the modal
const modalStyles = `
  /* Hide number input spinner arrows - Chrome, Safari, Edge, Opera */
  input.no-number-spinner::-webkit-outer-spin-button,
  input.no-number-spinner::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }

  /* Firefox */
  input.no-number-spinner[type=number] {
    -moz-appearance: textfield;
  }

  /* Token pill selector styles */
  .token-pill-container {
    display: flex;
    gap: 8px;
    overflow-x: auto;
    padding: 8px 4px;
    scrollbar-width: thin;
    scrollbar-color: #6c757d transparent;
  }

  .token-pill-container::-webkit-scrollbar {
    height: 6px;
  }

  .token-pill-container::-webkit-scrollbar-track {
    background: transparent;
  }

  .token-pill-container::-webkit-scrollbar-thumb {
    background-color: #6c757d;
    border-radius: 3px;
  }

  .token-pill {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 10px 14px;
    border-radius: 12px;
    border: 2px solid #dee2e6;
    background: #f8f9fa;
    cursor: pointer;
    transition: all 0.15s ease;
    flex-shrink: 0;
    min-width: 70px;
  }

  .token-pill:hover {
    border-color: #adb5bd;
    background: #e9ecef;
  }

  .token-pill.selected {
    border-color: #8b1538;
    background: #fff;
    box-shadow: 0 0 0 1px #8b1538;
  }

  .token-pill img {
    width: 28px;
    height: 28px;
    border-radius: 50%;
  }

  .token-pill-symbol {
    font-weight: 600;
    font-size: 12px;
    color: #212529;
  }
`;

// Minimal ERC20 ABI with just the functions we need
const ERC20_ABI = [
  // Read-only functions
  {
    constant: true,
    inputs: [{ name: "_owner", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "balance", type: "uint256" }],
    type: "function"
  },
  // Transfer function
  {
    constant: false,
    inputs: [
      { name: "_to", type: "address" },
      { name: "_value", type: "uint256" }
    ],
    name: "transfer",
    outputs: [{ name: "success", type: "bool" }],
    type: "function"
  }
];

const TokenDepositModal = ({ show, onHide, vaultAddress, onTokensUpdated }) => {
  const { address: userAddress, chainId } = useSelector((state) => state.wallet);
  const { readProvider, getSigner, isReadReady, isWriteReady } = useProviders();
  const { showSuccess, showError } = useToast();

  // State
  const [selectedToken, setSelectedToken] = useState(null);
  const [amount, setAmount] = useState("");
  const [userBalance, setUserBalance] = useState("0");
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  // Build token list from chain-filtered tokens, splitting native into native + wrapped
  const chainTokens = getTokensByChain(chainId);
  const tokenList = [];
  chainTokens.forEach(token => {
    if (token.isNative) {
      // Add native entry (ETH, AVAX, etc.)
      tokenList.push({
        ...token,
        address: null,
        isNativeEntry: true
      });
      // Add wrapped entry (WETH, WAVAX, etc.)
      if (token.wrappedAddresses?.[chainId]) {
        tokenList.push({
          symbol: token.wrappedSymbol,
          name: `Wrapped ${token.name}`,
          displaySymbol: token.wrappedSymbol,
          decimals: token.decimals,
          address: token.wrappedAddresses[chainId],
          logoURI: token.wrappedLogoURI,
          isNativeEntry: false
        });
      }
    } else {
      tokenList.push({
        ...token,
        address: token.addresses[chainId],
        isNativeEntry: false
      });
    }
  });

  // Reset state when modal closes
  useEffect(() => {
    if (!show) {
      setSelectedToken(null);
      setAmount("");
      setUserBalance("0");
      setError("");
      setIsLoading(false);
    }
  }, [show]);

  // Fetch user's balance for selected token
  useEffect(() => {
    const fetchUserBalance = async () => {
      if (!selectedToken || !userAddress || !isReadReady || !show) return;

      setIsLoading(true);
      try {
        let formattedBalance;

        if (selectedToken.isNativeEntry) {
          // Native ETH - use provider.getBalance
          const balance = await readProvider.getBalance(userAddress);
          formattedBalance = ethers.utils.formatEther(balance);
        } else {
          // ERC20 (including WETH) - use balanceOf
          const tokenContract = new ethers.Contract(selectedToken.address, ERC20_ABI, readProvider);
          const balance = await tokenContract.balanceOf(userAddress);
          formattedBalance = ethers.utils.formatUnits(balance, selectedToken.decimals);
        }

        setUserBalance(formattedBalance);
        setError("");
      } catch (err) {
        console.error("Error fetching balance:", err);
        setError("Failed to fetch token balance");
        setUserBalance("0");
      } finally {
        setIsLoading(false);
      }
    };

    fetchUserBalance();
  }, [selectedToken, userAddress, readProvider, isReadReady, chainId, show]);

  // Handle token selection
  const handleTokenSelect = (token) => {
    setSelectedToken(token);
    setAmount("");
  };

  // Handle max button click
  const handleMaxClick = () => {
    setAmount(userBalance);
  };

  // Validate decimal precision based on token decimals
  const validateDecimalPrecision = (value, tokenDecimals) => {
    if (!value || value === '') return true;

    // Count decimal places in the input
    const parts = value.toString().split('.');
    if (parts.length === 1) return true; // No decimals

    const decimalPlaces = parts[1].length;

    if (decimalPlaces > tokenDecimals) {
      setError(`${selectedToken?.symbol || 'This token'} supports a maximum of ${tokenDecimals} decimal places`);
      return false;
    }

    return true;
  };

  // Handle deposit
  const handleDeposit = async () => {
    if (!selectedToken || !amount || !userAddress || !isWriteReady) {
      setError("Please select a token and enter an amount");
      return;
    }

    // Validate amount
    const numAmount = parseFloat(amount);

    if (isNaN(numAmount) || numAmount <= 0) {
      setError("Amount must be greater than 0");
      return;
    }

    if (numAmount > parseFloat(userBalance)) {
      setError("Amount exceeds your balance");
      return;
    }

    // Validate decimal precision
    if (!validateDecimalPrecision(amount, selectedToken.decimals)) {
      return;
    }

    setIsSubmitting(true);
    setError("");

    try {
      const signer = await getSigner();
      const amountInUnits = ethers.utils.parseUnits(amount, selectedToken.decimals);

      let tx;
      if (selectedToken.isNativeEntry) {
        // Send native ETH directly to vault
        tx = await signer.sendTransaction({
          to: vaultAddress,
          value: amountInUnits
        });
      } else {
        // ERC20 transfer (including WETH)
        const tokenContract = new ethers.Contract(selectedToken.address, ERC20_ABI, signer);
        tx = await tokenContract.transfer(vaultAddress, amountInUnits);
      }

      await tx.wait();

      showSuccess(`Successfully deposited ${amount} ${selectedToken.symbol} to vault`);
      setAmount("");
      setIsSubmitting(false);
      if (onTokensUpdated) onTokensUpdated();
      onHide();
    } catch (err) {
      // Always set submitting to false first to prevent state update issues
      setIsSubmitting(false);

      // Check if user cancelled the transaction
      if (err.code === 'ACTION_REJECTED' || err.code === 4001 || err.message?.includes('user rejected')) {
        // User cancelled - silently ignore, modal stays open
        // Don't log to console to avoid triggering error boundaries
        return;
      }

      // Real error - log and show user-friendly message in modal
      console.error("Deposit error:", err);
      const errorDetail = err.reason || err.message;
      setError(`Transaction failed${errorDetail ? `: ${errorDetail}` : ''}`);
    }
  };

  return (
    <Modal
      show={show}
      onHide={onHide}
      centered
      size="lg"
      backdrop="static"
    >
      <style>{modalStyles}</style>
      <Modal.Header closeButton>
        <Modal.Title>Deposit Tokens to Vault</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {error && <Alert variant="danger">{error}</Alert>}

        <Form>
          {/* Token Selection - Horizontal Pill Selector */}
          <Form.Group className="mb-4">
            <Form.Label>Select Token</Form.Label>
            <div className="token-pill-container">
              {tokenList.map((token) => (
                <div
                  key={token.symbol}
                  className={`token-pill ${selectedToken?.symbol === token.symbol ? 'selected' : ''}`}
                  onClick={() => handleTokenSelect(token)}
                  title={token.name}
                >
                  {token.logoURI && (
                    <img
                      src={token.logoURI}
                      alt={token.symbol}
                    />
                  )}
                  <span className="token-pill-symbol">{token.symbol}</span>
                </div>
              ))}
            </div>
          </Form.Group>

          {/* Amount Input */}
          {selectedToken && (
            <>
              <Form.Group className="mb-4">
                <div className="d-flex justify-content-between">
                  <Form.Label>Amount</Form.Label>
                  <div>
                    Balance: {isLoading ? (
                      <Spinner animation="border" size="sm" />
                    ) : (
                      `${parseFloat(userBalance).toFixed(6)} ${selectedToken.symbol}`
                    )}
                  </div>
                </div>
                <InputGroup>
                  <Form.Control
                    type="number"
                    placeholder="0.0"
                    value={amount}
                    onChange={(e) => {
                      setAmount(e.target.value);
                      setError(""); // Clear error when typing
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'e' || e.key === 'E' || e.key === '+' || e.key === '-') {
                        e.preventDefault();
                      }
                    }}
                    onWheel={(e) => e.target.blur()}
                    step="any"
                    disabled={isSubmitting}
                    className="no-number-spinner"
                  />
                  <Button
                    variant="outline-secondary"
                    onClick={handleMaxClick}
                    disabled={isSubmitting}
                  >
                    MAX
                  </Button>
                </InputGroup>
              </Form.Group>

              <div className="d-grid gap-2">
                <Button
                  variant="primary"
                  size="lg"
                  onClick={handleDeposit}
                  disabled={isSubmitting}
                >
                  {isSubmitting ? (
                    <>
                      <Spinner animation="border" size="sm" className="me-2" />
                      Processing...
                    </>
                  ) : (
                    `Deposit ${selectedToken.symbol}`
                  )}
                </Button>
              </div>
            </>
          )}
        </Form>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onHide} disabled={isSubmitting}>
          Cancel
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default TokenDepositModal;
