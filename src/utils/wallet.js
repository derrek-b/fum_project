import { ethers } from "ethers";

export async function createEthersProvider() {
  console.log("createEthersProvider called, window exists:", typeof window !== "undefined");
  if (typeof window !== "undefined" && window.ethereum) {
    console.log("Ethereum provider (MetaMask) found, creating BrowserProvider...");
    const provider = new ethers.BrowserProvider(window.ethereum); // Use injected provider (MetaMask)
    console.log("Ethers provider created from MetaMask:", provider);
    return provider;
  }
  throw new Error("No Ethereum provider found (e.g., MetaMask) in browser");
}
