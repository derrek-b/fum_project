'use client';

import React, { useState } from "react";
import { Button } from "react-bootstrap";
import { useDispatch, useSelector } from "react-redux";
import { createEthersProvider } from "../utils/wallet";
import { setWallet, disconnectWallet } from "../redux/walletSlice";

export default function WalletConnectEVM({ setProvider }) {
  const dispatch = useDispatch();
  const { isConnected, address } = useSelector((state) => state.wallet);
  const [isConnecting, setIsConnecting] = useState(false); // Track connection attempt

  const connect = async () => {
    if (isConnecting) return; // Prevent multiple clicks while connecting
    setIsConnecting(true);
    try {
      const newProvider = await createEthersProvider(); // Create provider only on connect
      setProvider(newProvider); // Pass provider to parent (index.js via Navbar)

      await newProvider.send("eth_requestAccounts", []); // Request accounts from MetaMask
      const signer = await newProvider.getSigner();
      const account = await signer.getAddress();
      const network = await newProvider.getNetwork();
      const chainId = Number(network.chainId); // Convert BigInt to Number
      console.log('chainId', chainId, network.chainId)

      dispatch(setWallet({ address: account, chainId }));
    } catch (error) {
      console.error("Failed to connect EVM wallet:", error);
    } finally {
      setIsConnecting(false);
    }
  };

  const disconnect = () => {
    setProvider(null); // Set to null on disconnect
    dispatch(disconnectWallet());
  };

  const shortenAddress = (addr) => {
    if (!addr) return "";
    return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
  };

  return (
    <div>
      <Button
        variant="outline-light"
        onClick={connect}
        disabled={isConnecting || isConnected} // Disable during connection or when connected
      >
        {isConnected ? shortenAddress(address) : isConnecting ? "Connecting..." : "Connect Wallet"}
      </Button>
    </div>
  );
}
