// src/components/TokenDepositModal.js
import React, { useState, useEffect } from "react";
import { Modal, Button, Form, InputGroup, Spinner, Alert, Card } from "react-bootstrap";
import { useSelector } from "react-redux";
import { ethers } from "ethers";
import { getAllTokens } from "../utils/tokenConfig";
import { useToast } from "../context/ToastContext";
import Image from "next/image";

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
  const { address: userAddress, provider } = useSelector((state) => state.wallet);
  const { chainId } = useSelector((state) => state.wallet);
  const { showSuccess, showError } = useToast();

  // State
  const [selectedToken, setSelectedToken] = useState(null);
  const [amount, setAmount] = useState("");
  const [userBalance, setUserBalance] = useState("0");
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  // Get all available tokens
  const tokens = getAllTokens();
  const tokenList = Object.values(tokens).filter(token => token.addresses[chainId]);

  // Fetch user's balance for selected token
  useEffect(() => {
    const fetchUserBalance = async () => {
      if (!selectedToken || !userAddress || !provider) return;

      setIsLoading(true);
      try {
        const tokenAddress = selectedToken.addresses[chainId];
        const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
        const balance = await tokenContract.balanceOf(userAddress);
        const formattedBalance = ethers.formatUnits(balance, selectedToken.decimals);
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
  }, [selectedToken, userAddress, provider, chainId]);

  // Handle token selection
  const handleTokenSelect = (token) => {
    setSelectedToken(token);
    setAmount("");
  };

  // Handle max button click
  const handleMaxClick = () => {
    setAmount(userBalance);
  };

  // Handle deposit
  const handleDeposit = async () => {
    if (!selectedToken || !amount || !userAddress || !provider) {
      setError("Please select a token and enter an amount");
      return;
    }

    // Validate amount
    if (parseFloat(amount) <= 0) {
      setError("Amount must be greater than 0");
      return;
    }

    if (parseFloat(amount) > parseFloat(userBalance)) {
      setError("Amount exceeds your balance");
      return;
    }

    setIsSubmitting(true);
    setError("");

    try {
      const tokenAddress = selectedToken.addresses[chainId];

      const signer = await provider.getSigner();
      const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, signer);

      // Convert amount to token units
      const amountInUnits = ethers.parseUnits(amount, selectedToken.decimals);

      // Use standard ERC-20 transfer
      const tx = await tokenContract.transfer(vaultAddress, amountInUnits);

      await tx.wait();

      showSuccess(`Successfully deposited ${amount} ${selectedToken.symbol} to vault`);
      setAmount("");
      if (onTokensUpdated) onTokensUpdated();
      onHide();
    } catch (err) {
      console.error("Deposit error:", err);
      setError(`Transaction failed: ${err.message}`);
      showError("Token deposit failed");
    } finally {
      setIsSubmitting(false);
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
      <Modal.Header closeButton>
        <Modal.Title>Deposit Tokens to Vault</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {error && <Alert variant="danger">{error}</Alert>}

        <Form>
          {/* Token Selection */}
          <Form.Group className="mb-4">
            <Form.Label>Select Token</Form.Label>
            <div className="d-flex flex-wrap gap-2">
              {tokenList.map((token) => (
                <Card
                  key={token.symbol}
                  className={`token-select-card ${selectedToken?.symbol === token.symbol ? 'border-primary' : ''}`}
                  style={{ cursor: 'pointer', minWidth: '100px' }}
                  onClick={() => handleTokenSelect(token)}
                >
                  <Card.Body className="text-center py-2">
                    {token.logoURI && (
                      <div className="mb-2">
                        <Image
                          src={token.logoURI}
                          alt={token.symbol}
                          width={32}
                          height={32}
                        />
                      </div>
                    )}
                    <div className="fw-bold">{token.symbol}</div>
                    <small className="text-muted">{token.name}</small>
                  </Card.Body>
                </Card>
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
                    onChange={(e) => setAmount(e.target.value)}
                    disabled={isSubmitting}
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
                  disabled={isSubmitting || !amount || parseFloat(amount) <= 0 || parseFloat(amount) > parseFloat(userBalance)}
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
