// Simple ethers mocks for testing
export const ethers = {
  formatUnits: (value, decimals) => {
    return (Number(value) / Math.pow(10, decimals)).toString();
  },
  ZeroAddress: "0x0000000000000000000000000000000000000000",
  Contract: class MockContract {
    constructor(address, abi, provider) {
      this.address = address;
      this.abi = abi;
      this.provider = provider;
      
      // Add any methods needed for specific tests
      this.balanceOf = async () => "1000000000";
      this.decimals = async () => 18;
      this.symbol = async () => "TEST";
    }
  }
};