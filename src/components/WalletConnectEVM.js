'use client';

import React, { useEffect, useState } from "react";
import { Button } from "react-bootstrap";
import { useDispatch, useSelector } from "react-redux";
import { createEthersProvider } from "../utils/wallet";
import { setWallet, disconnectWallet } from "../redux/walletSlice";

export default function WalletConnectEVM() {
  console.log("WalletConnectEVM component rendered");
  const dispatch = useDispatch();
  const { isConnected, address } = useSelector((state) => state.wallet);
  const [provider, setProvider] = useState(null);

  useEffect(() => {
    console.log("useEffect running, provider:", provider);
    if (!provider) {
      console.log("Initializing Ethers provider...");
      createEthersProvider()
        .then(newProvider => {
          console.log("Ethers provider set:", newProvider);
          setProvider(newProvider);
        })
        .catch(error => console.error("Failed to create Ethers provider:", error));
    }
  }, [provider]);

  const connect = async () => {
    console.log("Connect clicked, provider:", provider);
    if (!provider) return;
    try {
      console.log("Attempting to connect...");
      await provider.send("eth_requestAccounts", []); // Request accounts from MetaMask
      const signer = await provider.getSigner();
      const account = await signer.getAddress();
      const network = await provider.getNetwork();
      const chainId = Number(network.chainId); // Convert BigInt to Number
      console.log("Wallet connected - address:", account, "chainId:", chainId);

      dispatch(setWallet({ address: account, chainId })); // Now a plain number
    } catch (error) {
      console.error("Failed to connect EVM wallet:", error);
    }
  };

  const disconnect = () => {
    console.log("Disconnect clicked");
    setProvider(null);
    dispatch(disconnectWallet());
  };

  const shortenAddress = (addr) => {
    if (!addr) return "";
    return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
  };

  return (
    <Button
      variant="outline-light"
      onClick={isConnected ? disconnect : connect}
      disabled={!provider}
    >
      {isConnected ? shortenAddress(address) : "Connect Wallet"}
    </Button>
  );
}
