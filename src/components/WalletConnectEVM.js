'use client';

import React, { useState } from "react";
import { Button, Spinner } from "react-bootstrap";
import { useDispatch, useSelector } from "react-redux";
import { createEthersProvider } from "../utils/wallet";
import { setWallet, disconnectWallet, setProvider } from "../redux/walletSlice";

export default function WalletConnectEVM() {
  const dispatch = useDispatch();
  const { isConnected, address, chainId } = useSelector((state) => state.wallet);
  const [isConnecting, setIsConnecting] = useState(false); // Track connection attempt

  const connect = async () => {
    if (isConnecting) return; // Prevent multiple clicks while connecting
    setIsConnecting(true);
    try {
      const newProvider = await createEthersProvider(); // Create provider only on connect
      dispatch(setProvider(newProvider)); // Store provider in Redux

      await newProvider.send("eth_requestAccounts", []); // Request accounts from MetaMask
      const signer = await newProvider.getSigner();
      const account = await signer.getAddress();
      const network = await newProvider.getNetwork();
      const chainId = Number(network.chainId); // Convert BigInt to Number
      console.log('chainId', chainId, network.chainId)

      dispatch(setWallet({
        address: account,
        chainId,
        provider: newProvider
      }));
    } catch (error) {
      console.error("Failed to connect EVM wallet:", error);
    } finally {
      setIsConnecting(false);
    }
  };

  const disconnect = () => {
    dispatch(disconnectWallet());
  };

  const shortenAddress = (addr) => {
    if (!addr) return "";
    return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
  };

  // Helper function to get network name
  const getNetworkName = (chainId) => {
    switch (chainId) {
      case 1:
        return "Ethereum";
      case 42161:
        return "Arbitrum One";
      case 1337:
        return "Local Network";
      default:
        return `Chain #${chainId}`;
    }
  };

  return (
    <div className="d-flex align-items-center">
      {isConnected ? (
        <>
          <div className="me-2 text-light d-none d-md-block">
            <small>{getNetworkName(chainId)}</small>
          </div>
          <Button
            variant="outline-light"
            onClick={disconnect}
            size="sm"
            className="me-2"
          >
            {shortenAddress(address)}
            <span className="ms-1">▼</span>
          </Button>
        </>
      ) : (
        <Button
          variant="outline-light"
          onClick={connect}
          disabled={isConnecting}
        >
          {isConnecting ? (
            <>
              <Spinner
                as="span"
                animation="border"
                size="sm"
                role="status"
                aria-hidden="true"
                className="me-2"
              />
              Connecting...
            </>
          ) : (
            "Connect Wallet"
          )}
        </Button>
      )}
    </div>
  );
}
