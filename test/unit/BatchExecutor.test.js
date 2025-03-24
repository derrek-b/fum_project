const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("BatchExecutor - 0.2.1", function () {
  let batchExecutor;
  let mockToken;
  let owner;
  let recipient;
  let mockTokenAddress;
  let batchExecutorAddress;

  beforeEach(async function () {
    [owner, recipient] = await ethers.getSigners();

    // Deploy BatchExecutor
    const BatchExecutor = await ethers.getContractFactory("BatchExecutor");
    batchExecutor = await BatchExecutor.deploy();
    await batchExecutor.deploymentTransaction().wait();
    batchExecutorAddress = await batchExecutor.getAddress();

    // Deploy MockERC20 from your existing codebase
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    mockToken = await MockERC20.deploy("Test Token", "TEST", 18);
    await mockToken.deploymentTransaction().wait();
    mockTokenAddress = await mockToken.getAddress();

    // Mint some tokens to owner
    await mockToken.mint(owner.address, ethers.parseEther("1000"));
  });

  it("should execute a batch of token operations", async function () {
    // Step 1: Owner approves BatchExecutor to spend 100 tokens
    await mockToken
      .connect(owner)
      .approve(batchExecutorAddress, ethers.parseEther("100"));

    // Step 2: Prepare transaction data for transferFrom
    const transferFromData = mockToken.interface.encodeFunctionData(
      "transferFrom",
      [owner.address, recipient.address, ethers.parseEther("50")]
    );

    const transferFromData1 = mockToken.interface.encodeFunctionData(
      "transferFrom",
      [owner.address, recipient.address, ethers.parseEther("30")]
    );

    const targets = [mockTokenAddress, mockTokenAddress];
    const data = [transferFromData, transferFromData1];
    const values = [0, 0];

    // Execute the batch
    await batchExecutor.executeBatch(targets, data, values);

    // Verify results
    const allowance = await mockToken.allowance(owner.address, batchExecutorAddress);
    expect(allowance).to.equal(ethers.parseEther("20")); // 100 - 50 transferred

    const recipientBalance = await mockToken.balanceOf(recipient.address);
    expect(recipientBalance).to.equal(ethers.parseEther("80"));
  });

  it("should revert the entire batch if any transaction fails", async function () {
    // First transaction: valid approval
    const approveData = mockToken.interface.encodeFunctionData(
      "approve",
      [recipient.address, ethers.parseEther("100")]
    );

    // Second transaction: invalid transfer (more than balance)
    const invalidTransferData = mockToken.interface.encodeFunctionData(
      "transfer",
      [recipient.address, ethers.parseEther("5000")]  // Owner only has 1000
    );

    const targets = [mockTokenAddress, mockTokenAddress];
    const data = [approveData, invalidTransferData];
    const values = [0, 0];

    // The entire batch should revert
    await expect(
      batchExecutor.executeBatch(targets, data, values)
    ).to.be.reverted;

    // Approval should not have happened either
    const allowance = await mockToken.allowance(owner.address, recipient.address);
    expect(allowance).to.equal(0);
  });

  it("should handle ETH transfers properly", async function () {
    // Get initial balance
    const initialBalance = await ethers.provider.getBalance(recipient.address);

    // Create a transaction to send ETH to recipient
    // We'll use an empty call which just sends ETH
    const targets = [recipient.address];
    const data = ["0x"]; // empty call data
    const values = [ethers.parseEther("1")];

    // Execute with 1 ETH value
    await batchExecutor.executeBatch(targets, data, values, {
      value: ethers.parseEther("1")
    });

    // Check recipient got the ETH
    const newBalance = await ethers.provider.getBalance(recipient.address);
    expect(newBalance - initialBalance).to.equal(ethers.parseEther("1"));
  });
});
