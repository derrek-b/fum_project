const { expect } = require("chai");
const { ethers } = require('hardhat');

describe("BatchExecutor - 0.3.0", function () {
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

  describe("AtomicBatch Execution", function () {
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

      // Execute the batch and wait for transaction
      const tx = await batchExecutor.executeAtomicBatch(targets, data, values);
      const receipt = await tx.wait();

      // Check event emission
      const atomicBatchEvent = receipt.logs.find(
        log => log.fragment && log.fragment.name === 'AtomicBatchExecuted'
      );

      expect(atomicBatchEvent).to.not.be.undefined;
      expect(atomicBatchEvent.args.sender).to.equal(owner.address);
      expect(atomicBatchEvent.args.txCount).to.equal(2);
      expect(atomicBatchEvent.args.success).to.be.true;
      expect(atomicBatchEvent.args.successes.length).to.equal(2);
      expect(atomicBatchEvent.args.successes[0]).to.be.true;
      expect(atomicBatchEvent.args.successes[1]).to.be.true;

      // Verify token state
      const allowance = await mockToken.allowance(owner.address, batchExecutorAddress);
      expect(allowance).to.equal(ethers.parseEther("20")); // 100 - 50 - 30 = 20

      const recipientBalance = await mockToken.balanceOf(recipient.address);
      expect(recipientBalance).to.equal(ethers.parseEther("80")); // 50 + 30 = 80
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
        batchExecutor.executeAtomicBatch(targets, data, values)
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

      // Execute with 1 ETH value and check for event
      const tx = await batchExecutor.executeAtomicBatch(targets, data, values, {
        value: ethers.parseEther("1")
      });
      const receipt = await tx.wait();

      // Check event emission
      const atomicBatchEvent = receipt.logs.find(
        log => log.fragment && log.fragment.name === 'AtomicBatchExecuted'
      );

      expect(atomicBatchEvent).to.not.be.undefined;
      expect(atomicBatchEvent.args.txCount).to.equal(1);
      expect(atomicBatchEvent.args.success).to.be.true;
      expect(atomicBatchEvent.args.successes[0]).to.be.true;

      // Check recipient got the ETH
      const newBalance = await ethers.provider.getBalance(recipient.address);
      expect(newBalance - initialBalance).to.equal(ethers.parseEther("1"));
    });
  });

  describe("SequenceBatch Execution", function () {
    it("should execute a sequence of token operations", async function () {
      // Step 1: Owner approves BatchExecutor to spend 100 tokens
      await mockToken
        .connect(owner)
        .approve(batchExecutorAddress, ethers.parseEther("100"));

      // Step 2: Prepare transaction data for transferFrom
      const transferFromData1 = mockToken.interface.encodeFunctionData(
        "transferFrom",
        [owner.address, recipient.address, ethers.parseEther("50")]
      );

      const transferFromData2 = mockToken.interface.encodeFunctionData(
        "transferFrom",
        [owner.address, recipient.address, ethers.parseEther("30")]
      );

      const targets = [mockTokenAddress, mockTokenAddress];
      const data = [transferFromData1, transferFromData2];
      const values = [0, 0];

      // Execute the sequence
      const tx = await batchExecutor.executeSequenceBatch(targets, data, values);
      const receipt = await tx.wait();

      // Get the event
      const sequenceBatchEvent = receipt.logs.find(
        log => log.fragment && log.fragment.name === 'SequenceBatchExecuted'
      );

      // Verify event data
      expect(sequenceBatchEvent).to.not.be.undefined;
      expect(sequenceBatchEvent.args.completedCount).to.equal(2);
      expect(sequenceBatchEvent.args.successes.length).to.equal(2);
      expect(sequenceBatchEvent.args.successes[0]).to.be.true;
      expect(sequenceBatchEvent.args.successes[1]).to.be.true;

      // Verify token state
      const allowance = await mockToken.allowance(owner.address, batchExecutorAddress);
      expect(allowance).to.equal(ethers.parseEther("20")); // 100 - 50 - 30 = 20

      const recipientBalance = await mockToken.balanceOf(recipient.address);
      expect(recipientBalance).to.equal(ethers.parseEther("80")); // 50 + 30 = 80
    });

    it("should stop at first failure but keep successful transactions", async function () {
      // Step 1: Owner approves BatchExecutor to spend 100 tokens
      await mockToken
        .connect(owner)
        .approve(batchExecutorAddress, ethers.parseEther("100"));

      // Prepare transaction data
      // First transaction: valid transfer (50 tokens)
      const validTransferData = mockToken.interface.encodeFunctionData(
        "transferFrom",
        [owner.address, recipient.address, ethers.parseEther("50")]
      );

      // Second transaction: invalid transfer (5000 tokens, more than available)
      const invalidTransferData = mockToken.interface.encodeFunctionData(
        "transferFrom",
        [owner.address, recipient.address, ethers.parseEther("5000")]
      );

      const targets = [mockTokenAddress, mockTokenAddress];
      const data = [validTransferData, invalidTransferData];
      const values = [0, 0];

      // Execute the sequence
      const tx = await batchExecutor.executeSequenceBatch(targets, data, values);
      const receipt = await tx.wait();

      // Get the event
      const sequenceBatchEvent = receipt.logs.find(
        log => log.fragment && log.fragment.name === 'SequenceBatchExecuted'
      );

      // Verify event data
      expect(sequenceBatchEvent).to.not.be.undefined;
      expect(sequenceBatchEvent.args.completedCount).to.equal(1);
      expect(sequenceBatchEvent.args.successes.length).to.equal(2);
      expect(sequenceBatchEvent.args.successes[0]).to.be.true;
      expect(sequenceBatchEvent.args.successes[1]).to.be.false;

      // First transfer should have happened
      const recipientBalance = await mockToken.balanceOf(recipient.address);
      expect(recipientBalance).to.equal(ethers.parseEther("50"));

      // Allowance should be reduced by first transaction only
      const allowance = await mockToken.allowance(owner.address, batchExecutorAddress);
      expect(allowance).to.equal(ethers.parseEther("50")); // 100 - 50 = 50
    });

    it("should handle ETH transfers and refunds in sequence", async function () {
      // Get initial balances
      const initialRecipientBalance = await ethers.provider.getBalance(recipient.address);

      // Create a mock transfer function that will fail
      const failingFunctionData = mockToken.interface.encodeFunctionData(
        "transfer",
        [recipient.address, ethers.parseEther("5000")] // Will fail (more than balance)
      );

      // Set up a valid and invalid ETH transfer
      const targets = [recipient.address, mockTokenAddress];
      const data = ["0x", failingFunctionData]; // Valid empty call, then invalid transfer
      const values = [ethers.parseEther("1"), ethers.parseEther("2")];

      // Execute with 3 ETH value (should refund 2 ETH when second tx fails)
      const tx = await batchExecutor.executeSequenceBatch(targets, data, values, {
        value: ethers.parseEther("3")
      });
      const receipt = await tx.wait();

      // Get the event
      const sequenceBatchEvent = receipt.logs.find(
        log => log.fragment && log.fragment.name === 'SequenceBatchExecuted'
      );

      // Verify event data
      expect(sequenceBatchEvent).to.not.be.undefined;
      expect(sequenceBatchEvent.args.completedCount).to.equal(1);
      expect(sequenceBatchEvent.args.successes.length).to.equal(2);
      expect(sequenceBatchEvent.args.successes[0]).to.be.true;
      expect(sequenceBatchEvent.args.successes[1]).to.be.false;

      // Check recipient got the ETH from first transaction
      const newRecipientBalance = await ethers.provider.getBalance(recipient.address);
      expect(newRecipientBalance - initialRecipientBalance).to.equal(ethers.parseEther("1"));
    });
  });
});
