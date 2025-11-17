'use client';

import React, { useState, useEffect } from "react";
import { Button, Spinner } from "react-bootstrap";
import { useDispatch, useSelector } from "react-redux";
import { setWallet, disconnectWallet, setReconnecting } from "../redux/walletSlice";
import { createWeb3Provider } from "fum_library/blockchain/wallet";
import { getChainName } from "fum_library/helpers/chainHelpers";
import { useToast } from "../context/ToastContext"; // Import the toast hook
import { useProvider } from "../contexts/ProviderContext";

export default function WalletConnectEVM() {
  const dispatch = useDispatch();
  const { showError, showSuccess } = useToast(); // Use our toast hook
  const { isConnected, address, chainId } = useSelector((state) => state.wallet);
  const { setProvider, clearProvider } = useProvider(); // Get provider setters from context
  const [isConnecting, setIsConnecting] = useState(false); // Track connection attempt
  const [hasAttemptedReconnect, setHasAttemptedReconnect] = useState(false); // Track if we've tried to reconnect

  const connect = async () => {
    if (isConnecting) return; // Prevent multiple clicks while connecting
    setIsConnecting(true);
    try {
      const newProvider = await createWeb3Provider(); // Create provider only on connect

      if (!newProvider) {
        throw new Error("No Ethereum wallet detected. Please install MetaMask or another wallet.");
      }

      setProvider(newProvider); // Store provider in context

      await newProvider.send("eth_requestAccounts", []); // Request accounts from MetaMask
      const signer = await newProvider.getSigner();
      const account = await signer.getAddress();
      const network = await newProvider.getNetwork();
      const chainId = Number(network.chainId); // Convert BigInt to Number
      console.log('chainId', chainId, network.chainId);

      dispatch(setWallet({
        address: account,
        chainId
      }));

      // Show success notification
      showSuccess(`Connected to ${getChainName(chainId)}`);
    } catch (error) {
      console.error("Failed to connect EVM wallet:", error);

      // Provide user-friendly error message based on common wallet connection errors
      if (error.code === 4001 || (error.error && error.error.code === 4001)) {
        showError("Connection rejected. Please approve the connection request in your wallet.");
      } else if (error.message && error.message.includes("No Ethereum provider")) {
        showError("No Ethereum wallet detected. Please install MetaMask or another compatible wallet.");
      } else if (error.message && error.message.includes("network")) {
        showError("Network error. Please check your internet connection and wallet configuration.");
      } else {
        showError("Failed to connect wallet. Please try again.");
      }
    } finally {
      setIsConnecting(false);
    }
  };

  const disconnect = () => {
    clearProvider(); // Clear provider from context
    dispatch(disconnectWallet());
    showSuccess("Wallet disconnected");
  };

  // Auto-reconnect on mount if wallet was previously connected
  useEffect(() => {
    const autoReconnect = async () => {
      // Only attempt once, and only if we have stored wallet info but aren't connected yet
      if (hasAttemptedReconnect || isConnected || !address || !chainId) {
        return;
      }

      setHasAttemptedReconnect(true);
      setIsConnecting(true);
      dispatch(setReconnecting(true)); // Set reconnecting flag for UI

      try {
        const newProvider = await createWeb3Provider();

        if (!newProvider) {
          console.log("No Ethereum provider detected for auto-reconnect");
          // Clear stored wallet since provider is not available
          dispatch(disconnectWallet());
          return;
        }

        setProvider(newProvider);

        // Check if accounts are accessible (wallet might be locked)
        const accounts = await newProvider.listAccounts();

        if (accounts.length === 0) {
          console.log("Wallet is locked, clearing stored connection");
          dispatch(disconnectWallet());
          return;
        }

        // Verify the stored address matches
        const signer = await newProvider.getSigner();
        const currentAccount = await signer.getAddress();
        const network = await newProvider.getNetwork();
        const currentChainId = Number(network.chainId);

        if (currentAccount.toLowerCase() === address.toLowerCase()) {
          // Successfully reconnected with same account
          dispatch(setWallet({
            address: currentAccount,
            chainId: currentChainId
          }));

          console.log(`Auto-reconnected to ${getChainName(currentChainId)}`);
        } else {
          // Different account, clear stored connection
          console.log("Different account detected, clearing stored connection");
          dispatch(disconnectWallet());
        }
      } catch (error) {
        console.error("Auto-reconnect failed:", error);
        // Clear stored wallet on reconnection failure
        dispatch(disconnectWallet()); // This also clears isReconnecting flag
      } finally {
        setIsConnecting(false);
        dispatch(setReconnecting(false)); // Clear reconnecting flag
      }
    };

    autoReconnect();
  }, [hasAttemptedReconnect, isConnected, address, chainId, dispatch, setProvider]);

  const shortenAddress = (addr) => {
    if (!addr) return "";
    return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
  };

  // // Helper function to get network name
  // const getNetworkName = (chainId) => {
  //   switch (chainId) {
  //     case 1:
  //       return "Ethereum";
  //     case 42161:
  //       return "Arbitrum One";
  //     case 1337:
  //       return "Local Network";
  //     default:
  //       return `Chain #${chainId}`;
  //   }
  // };

  return (
    <div className="d-flex align-items-center">
      {isConnected ? (
        <>
          <div className="me-2 d-none d-md-block">
            <small style={{ color: '#fbbf24' }}>{getChainName(chainId)}</small>
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
