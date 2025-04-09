import { ethers } from "ethers";

export async function createEthersProvider() {
  if (typeof window !== "undefined" && window.ethereum) {
    console.log("Ethereum provider found, creating BrowserProvider...");
    const provider = new ethers.BrowserProvider(window.ethereum);
    console.log("Ethers provider created:", provider);
    return provider;
  }
  throw new Error("No Ethereum provider found (e.g., MetaMask) in browser");
}
