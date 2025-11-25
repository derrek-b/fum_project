const { expect } = require("chai");
const { ethers } = require('hardhat');

describe("PositionVault - 0.4.2", function() {
  let PositionVault;
  let MockPositionNFT;
  let MockToken;
  let MockUniversalRouter;
  let vault;
  let nft;
  let token;
  let router;
  let owner;
  let user1;
  let user2;
  let strategyContract;
  let executorWallet;

  beforeEach(async function() {
    // Get signers
    [owner, user1, user2, strategyContract, executorWallet] = await ethers.getSigners();

    // Deploy mock Universal Router first (needed for vault)
    MockUniversalRouter = await ethers.getContractFactory("MockUniversalRouter");
    router = await MockUniversalRouter.deploy();
    await router.waitForDeployment();

    // Deploy the vault with owner and router
    PositionVault = await ethers.getContractFactory("PositionVault");
    vault = await PositionVault.deploy(owner.address, await router.getAddress());
    await vault.waitForDeployment();

    // Deploy mock NFT contract
    MockPositionNFT = await ethers.getContractFactory("MockPositionNFT");
    nft = await MockPositionNFT.deploy(owner.address);
    await nft.waitForDeployment();

    // Deploy mock ERC20 token
    MockToken = await ethers.getContractFactory("MockERC20");
    token = await MockToken.deploy("Mock Token", "MOCK", 18);
    await token.waitForDeployment();

    // Mint some tokens to owner
    await token.mint(owner.address, ethers.parseEther("1000"));

    // Transfer some tokens to the vault
    await token.transfer(await vault.getAddress(), ethers.parseEther("100"));
  });

  // Test for position withdrawal security
  describe("Position Withdrawal", function() {
    const tokenId = BigInt(1);

    beforeEach(async function() {
      // Create a position NFT
      await nft.createPosition(
        owner.address,
        await token.getAddress(),
        ethers.ZeroAddress,
        3000,
        -10000,
        10000,
        1000000
      );

      // Transfer NFT to vault
      await nft.approve(await vault.getAddress(), tokenId);
      await nft["safeTransferFrom(address,address,uint256)"](
        owner.address,
        await vault.getAddress(),
        tokenId
      );
    });

    it("should withdraw position to owner address only", async function() {
      // Withdraw position - should go to owner
      await vault.withdrawPosition(await nft.getAddress(), tokenId);

      // Verify NFT went to owner
      expect(await nft.ownerOf(tokenId)).to.equal(owner.address);
    });

    it("should emit PositionWithdrawn event with owner as recipient", async function() {
      await expect(vault.withdrawPosition(await nft.getAddress(), tokenId))
        .to.emit(vault, "PositionWithdrawn")
        .withArgs(tokenId, await nft.getAddress(), owner.address);
    });

    it("should only allow authorized callers to withdraw positions", async function() {
      await expect(
        vault.connect(user1).withdrawPosition(await nft.getAddress(), tokenId)
      ).to.be.revertedWith("PositionVault: caller is not authorized");
    });

    it("should allow executor to withdraw position to owner", async function() {
      // Set executor
      await vault.setExecutor(executorWallet.address);

      // Executor withdraws position
      await vault.connect(executorWallet).withdrawPosition(await nft.getAddress(), tokenId);

      // Verify NFT went to owner (not executor)
      expect(await nft.ownerOf(tokenId)).to.equal(owner.address);
    });

    it("should emit PositionWithdrawn with owner as recipient when executor calls", async function() {
      // Set executor
      await vault.setExecutor(executorWallet.address);

      // Verify event shows owner as recipient
      await expect(vault.connect(executorWallet).withdrawPosition(await nft.getAddress(), tokenId))
        .to.emit(vault, "PositionWithdrawn")
        .withArgs(tokenId, await nft.getAddress(), owner.address);
    });

    it("should reject zero NFT contract address", async function() {
      await expect(
        vault.withdrawPosition(ethers.ZeroAddress, tokenId)
      ).to.be.revertedWith("PositionVault: zero NFT contract address");
    });
  });

  // Test for executor management
  describe("Executor Management", function() {
    it("should set executor and emit ExecutorChanged event with authorization", async function() {
      // Initially executor should be zero address
      expect(await vault.executor()).to.equal(ethers.ZeroAddress);

      // Set executor
      const tx = await vault.setExecutor(executorWallet.address);
      
      // Check executor was set
      expect(await vault.executor()).to.equal(executorWallet.address);

      // Check event was emitted correctly
      await expect(tx)
        .to.emit(vault, "ExecutorChanged")
        .withArgs(executorWallet.address, true);
    });

    it("should remove executor and emit ExecutorChanged event with revocation", async function() {
      // First set an executor
      await vault.setExecutor(executorWallet.address);
      expect(await vault.executor()).to.equal(executorWallet.address);

      // Remove executor
      const tx = await vault.removeExecutor();
      
      // Check executor was cleared
      expect(await vault.executor()).to.equal(ethers.ZeroAddress);

      // Check event was emitted with the old executor address and false
      await expect(tx)
        .to.emit(vault, "ExecutorChanged")
        .withArgs(executorWallet.address, false);
    });

    it("should only allow owner to set executor", async function() {
      await expect(
        vault.connect(user1).setExecutor(executorWallet.address)
      ).to.be.revertedWith("PositionVault: caller is not the owner");
    });

    it("should only allow owner to remove executor", async function() {
      await vault.setExecutor(executorWallet.address);
      
      await expect(
        vault.connect(user1).removeExecutor()
      ).to.be.revertedWith("PositionVault: caller is not the owner");
    });

    it("should not allow setting zero address as executor", async function() {
      await expect(
        vault.setExecutor(ethers.ZeroAddress)
      ).to.be.revertedWith("PositionVault: zero executor address");
    });

    it("should allow executor to call execute function", async function() {
      // Set executor
      await vault.setExecutor(executorWallet.address);

      // Test execute function - using a simple call that should succeed
      const targets = [await token.getAddress()];
      const data = [token.interface.encodeFunctionData("transfer", [user1.address, 1])];

      // This should not revert (executor is authorized)
      await expect(vault.connect(executorWallet).execute(targets, data))
        .to.not.be.reverted;
    });

    it("should not allow unauthorized user to call execute function", async function() {
      // Don't set any executor, try with unauthorized user
      const targets = [await token.getAddress()];
      const data = [token.interface.encodeFunctionData("transfer", [user1.address, 1])];

      await expect(
        vault.connect(user1).execute(targets, data)
      ).to.be.revertedWith("PositionVault: caller is not authorized");
    });

    it("should always allow owner to call execute function", async function() {
      // Owner should be able to execute even without setting executor
      const targets = [await token.getAddress()];
      const data = [token.interface.encodeFunctionData("transfer", [user1.address, 1])];

      // This should not revert (owner is always authorized)
      await expect(vault.connect(owner).execute(targets, data))
        .to.not.be.reverted;
    });
  });

  // Test for contract version
  describe("Contract Version", function() {
    it("should return the correct version", async function() {
      expect(await vault.getVersion()).to.equal("0.4.2");
    });
  });

  // Test for token withdrawal security
  describe("Token Withdrawal", function() {
    it("should withdraw tokens to owner address only", async function() {
      const vaultAddress = await vault.getAddress();
      const initialOwnerBalance = await token.balanceOf(owner.address);
      const vaultBalance = await token.balanceOf(vaultAddress);

      // Withdraw tokens - should go to owner
      await vault.withdrawTokens(await token.getAddress(), vaultBalance);

      // Verify tokens went to owner
      const finalOwnerBalance = await token.balanceOf(owner.address);
      expect(finalOwnerBalance).to.equal(initialOwnerBalance + vaultBalance);

      // Verify vault is empty
      expect(await token.balanceOf(vaultAddress)).to.equal(0);
    });

    it("should emit TokensWithdrawn event with owner as recipient", async function() {
      const withdrawAmount = ethers.parseEther("10");

      await expect(vault.withdrawTokens(await token.getAddress(), withdrawAmount))
        .to.emit(vault, "TokensWithdrawn")
        .withArgs(await token.getAddress(), owner.address, withdrawAmount);
    });

    it("should only allow authorized callers to withdraw tokens", async function() {
      await expect(
        vault.connect(user1).withdrawTokens(await token.getAddress(), ethers.parseEther("10"))
      ).to.be.revertedWith("PositionVault: caller is not authorized");
    });

    it("should allow executor to withdraw tokens to owner", async function() {
      // Set executor
      await vault.setExecutor(executorWallet.address);

      const withdrawAmount = ethers.parseEther("10");
      const initialOwnerBalance = await token.balanceOf(owner.address);
      const initialExecutorBalance = await token.balanceOf(executorWallet.address);

      // Executor withdraws tokens
      await vault.connect(executorWallet).withdrawTokens(await token.getAddress(), withdrawAmount);

      // Verify tokens went to owner (not executor)
      expect(await token.balanceOf(owner.address)).to.equal(initialOwnerBalance + withdrawAmount);
      expect(await token.balanceOf(executorWallet.address)).to.equal(initialExecutorBalance);
    });

    it("should emit TokensWithdrawn with owner as recipient when executor calls", async function() {
      // Set executor
      await vault.setExecutor(executorWallet.address);

      const withdrawAmount = ethers.parseEther("10");

      // Verify event shows owner as recipient
      await expect(vault.connect(executorWallet).withdrawTokens(await token.getAddress(), withdrawAmount))
        .to.emit(vault, "TokensWithdrawn")
        .withArgs(await token.getAddress(), owner.address, withdrawAmount);
    });

    it("should reject zero token address", async function() {
      await expect(
        vault.withdrawTokens(ethers.ZeroAddress, ethers.parseEther("10"))
      ).to.be.revertedWith("PositionVault: zero token address");
    });
  });

  // Test for EIP-1271 signature validation
  describe("EIP-1271 Signature Validation", function() {
    const MAGICVALUE = "0x1626ba7e";
    let testMessage;
    let testMessageHash;

    beforeEach(async function() {
      // Create a test message
      testMessage = "Test message for EIP-1271";
      testMessageHash = ethers.hashMessage(testMessage);
    });

    it("should validate signature from owner", async function() {
      // Sign the message (not the hash) - signMessage will hash it internally
      const signature = await owner.signMessage(testMessage);

      // Verify signature through vault using the hash
      const result = await vault.isValidSignature(testMessageHash, signature);
      expect(result).to.equal(MAGICVALUE);
    });

    it("should validate signature from executor", async function() {
      // Set executor
      await vault.setExecutor(executorWallet.address);

      // Sign the message with executor's private key
      const signature = await executorWallet.signMessage(testMessage);

      // Verify signature through vault
      const result = await vault.isValidSignature(testMessageHash, signature);
      expect(result).to.equal(MAGICVALUE);
    });

    it("should reject signature from unauthorized address", async function() {
      // Sign with unauthorized user
      const signature = await user1.signMessage(testMessage);

      // Should revert with error
      await expect(
        vault.isValidSignature(testMessageHash, signature)
      ).to.be.revertedWith("PositionVault: invalid signer");
    });

    it("should reject invalid signature", async function() {
      // Create a fake signature (just random bytes)
      const fakeSignature = ethers.hexlify(ethers.randomBytes(65));

      // Should revert - ECDSA will revert with custom error for invalid signature
      await expect(
        vault.isValidSignature(testMessageHash, fakeSignature)
      ).to.be.reverted;
    });

    it("should return correct magic value on success", async function() {
      const signature = await owner.signMessage(testMessage);
      const result = await vault.isValidSignature(testMessageHash, signature);

      // Verify it's exactly the EIP-1271 magic value
      expect(result).to.equal("0x1626ba7e");
    });

    it("should work with different message hashes", async function() {
      // Test with multiple different messages
      const messages = [
        "First test message",
        "Second test message",
        "0x1234567890abcdef"
      ];

      for (const msg of messages) {
        const msgHash = ethers.hashMessage(msg);
        const signature = await owner.signMessage(msg);
        const result = await vault.isValidSignature(msgHash, signature);
        expect(result).to.equal(MAGICVALUE);
      }
    });

    it("should reject signature after executor is removed", async function() {
      // Set executor
      await vault.setExecutor(executorWallet.address);

      // Sign with executor
      const signature = await executorWallet.signMessage(testMessage);

      // Verify it works
      let result = await vault.isValidSignature(testMessageHash, signature);
      expect(result).to.equal(MAGICVALUE);

      // Remove executor
      await vault.removeExecutor();

      // Same signature should now be rejected
      await expect(
        vault.isValidSignature(testMessageHash, signature)
      ).to.be.revertedWith("PositionVault: invalid signer");
    });

    it("should validate complex EIP-712 typed data signatures (Permit2 simulation)", async function() {
      // Simulate Permit2-style EIP-712 signature
      const domain = {
        name: "Permit2",
        version: "1",
        chainId: 31337, // Hardhat default chain ID
        verifyingContract: await vault.getAddress()
      };

      const types = {
        PermitTransferFrom: [
          { name: "token", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" }
        ]
      };

      const value = {
        token: await token.getAddress(),
        amount: ethers.parseEther("100"),
        nonce: 0,
        deadline: Math.floor(Date.now() / 1000) + 3600
      };

      // Owner signs the typed data
      const signature = await owner.signTypedData(domain, types, value);

      // Compute the EIP-712 hash
      const digest = ethers.TypedDataEncoder.hash(domain, types, value);

      // Verify signature through vault
      const result = await vault.isValidSignature(digest, signature);
      expect(result).to.equal(MAGICVALUE);
    });
  });

  // Test for Universal Router configuration
  describe("Universal Router Configuration", function() {
    it("should have universalRouter set from constructor", async function() {
      expect(await vault.universalRouter()).to.equal(await router.getAddress());
    });

    it("should reject deployment with zero router address", async function() {
      const PositionVaultFactory = await ethers.getContractFactory("PositionVault");
      await expect(
        PositionVaultFactory.deploy(owner.address, ethers.ZeroAddress)
      ).to.be.revertedWith("PositionVault: zero router address");
    });
  });

  // Test for swap() function with command validation
  describe("Swap Function", function() {
    // Universal Router execute selector: 0x3593564c
    const EXECUTE_SELECTOR = "0x3593564c";

    // Command IDs
    const CMD = {
      V3_SWAP_EXACT_IN: 0x00,
      V3_SWAP_EXACT_OUT: 0x01,
      SWEEP: 0x04,
      TRANSFER: 0x05,
      PAY_PORTION: 0x06,
      V2_SWAP_EXACT_IN: 0x08,
      V2_SWAP_EXACT_OUT: 0x09,
      PERMIT2_PERMIT: 0x0a,
      WRAP_ETH: 0x0b,
      UNWRAP_WETH: 0x0c
    };

    // Helper to encode Universal Router execute calldata
    function encodeRouterExecute(commands, inputs, deadline = Math.floor(Date.now() / 1000) + 3600) {
      const abiCoder = ethers.AbiCoder.defaultAbiCoder();
      const commandBytes = ethers.hexlify(Uint8Array.from(commands));
      const encoded = abiCoder.encode(
        ["bytes", "bytes[]", "uint256"],
        [commandBytes, inputs, deadline]
      );
      return EXECUTE_SELECTOR + encoded.slice(2);
    }

    // Helper to encode V3 swap input
    function encodeV3SwapInput(recipient, amountIn, amountOutMin, path, payerIsUser) {
      const abiCoder = ethers.AbiCoder.defaultAbiCoder();
      return abiCoder.encode(
        ["address", "uint256", "uint256", "bytes", "bool"],
        [recipient, amountIn, amountOutMin, path, payerIsUser]
      );
    }

    // Helper to encode V2 swap input
    function encodeV2SwapInput(recipient, amountIn, amountOutMin, path, payerIsUser) {
      const abiCoder = ethers.AbiCoder.defaultAbiCoder();
      return abiCoder.encode(
        ["address", "uint256", "uint256", "address[]", "bool"],
        [recipient, amountIn, amountOutMin, path, payerIsUser]
      );
    }

    // Helper to encode generic input (for blocked commands)
    function encodeGenericInput(addr1, addr2, value) {
      const abiCoder = ethers.AbiCoder.defaultAbiCoder();
      return abiCoder.encode(["address", "address", "uint256"], [addr1, addr2, value]);
    }

    // Mock swap path
    function createMockPath(tokenIn, tokenOut) {
      const fee = "000bb8";
      return tokenIn.toLowerCase() + fee + tokenOut.toLowerCase().slice(2);
    }

    describe("Authorization", function() {
      it("should allow owner to call swap", async function() {
        const vaultAddress = await vault.getAddress();
        const routerAddress = await router.getAddress();
        const tokenAddress = await token.getAddress();
        const path = createMockPath(tokenAddress, tokenAddress);

        const input = encodeV3SwapInput(vaultAddress, 1000, 900, path, true);
        const calldata = encodeRouterExecute([CMD.V3_SWAP_EXACT_IN], [input]);

        // Should not revert with authorization error
        await expect(vault.swap([routerAddress], [calldata]))
          .to.not.be.revertedWith("PositionVault: caller is not authorized");
      });

      it("should allow executor to call swap", async function() {
        await vault.setExecutor(executorWallet.address);

        const vaultAddress = await vault.getAddress();
        const routerAddress = await router.getAddress();
        const tokenAddress = await token.getAddress();
        const path = createMockPath(tokenAddress, tokenAddress);

        const input = encodeV3SwapInput(vaultAddress, 1000, 900, path, true);
        const calldata = encodeRouterExecute([CMD.V3_SWAP_EXACT_IN], [input]);

        await expect(vault.connect(executorWallet).swap([routerAddress], [calldata]))
          .to.not.be.revertedWith("PositionVault: caller is not authorized");
      });

      it("should reject unauthorized caller", async function() {
        const vaultAddress = await vault.getAddress();
        const routerAddress = await router.getAddress();
        const tokenAddress = await token.getAddress();
        const path = createMockPath(tokenAddress, tokenAddress);

        const input = encodeV3SwapInput(vaultAddress, 1000, 900, path, true);
        const calldata = encodeRouterExecute([CMD.V3_SWAP_EXACT_IN], [input]);

        await expect(vault.connect(user1).swap([routerAddress], [calldata]))
          .to.be.revertedWith("PositionVault: caller is not authorized");
      });

      it("should reject unsupported router", async function() {
        const vaultAddress = await vault.getAddress();
        const tokenAddress = await token.getAddress();
        const path = createMockPath(tokenAddress, tokenAddress);

        const input = encodeV3SwapInput(vaultAddress, 1000, 900, path, true);
        const calldata = encodeRouterExecute([CMD.V3_SWAP_EXACT_IN], [input]);

        // Use a random address as router
        await expect(vault.swap([user2.address], [calldata]))
          .to.be.revertedWith("PositionVault: unsupported router");
      });
    });

    describe("V3 Swap Commands (0x00, 0x01)", function() {
      it("should allow V3_SWAP_EXACT_IN with vault as recipient", async function() {
        const vaultAddress = await vault.getAddress();
        const routerAddress = await router.getAddress();
        const tokenAddress = await token.getAddress();
        const path = createMockPath(tokenAddress, tokenAddress);

        const input = encodeV3SwapInput(vaultAddress, 1000, 900, path, true);
        const calldata = encodeRouterExecute([CMD.V3_SWAP_EXACT_IN], [input]);

        await expect(vault.swap([routerAddress], [calldata]))
          .to.not.be.revertedWith("PositionVault: swap recipient must be vault");
      });

      it("should reject V3_SWAP_EXACT_IN with non-vault recipient", async function() {
        const routerAddress = await router.getAddress();
        const tokenAddress = await token.getAddress();
        const path = createMockPath(tokenAddress, tokenAddress);

        const input = encodeV3SwapInput(user1.address, 1000, 900, path, true);
        const calldata = encodeRouterExecute([CMD.V3_SWAP_EXACT_IN], [input]);

        await expect(vault.swap([routerAddress], [calldata]))
          .to.be.revertedWith("PositionVault: swap recipient must be vault");
      });

      it("should reject V3_SWAP_EXACT_OUT with non-vault recipient", async function() {
        const routerAddress = await router.getAddress();
        const tokenAddress = await token.getAddress();
        const path = createMockPath(tokenAddress, tokenAddress);

        const input = encodeV3SwapInput(user1.address, 1000, 1100, path, true);
        const calldata = encodeRouterExecute([CMD.V3_SWAP_EXACT_OUT], [input]);

        await expect(vault.swap([routerAddress], [calldata]))
          .to.be.revertedWith("PositionVault: swap recipient must be vault");
      });
    });

    describe("V2 Swap Commands (0x08, 0x09)", function() {
      it("should allow V2_SWAP_EXACT_IN with vault as recipient", async function() {
        const vaultAddress = await vault.getAddress();
        const routerAddress = await router.getAddress();
        const tokenAddress = await token.getAddress();
        const path = [tokenAddress, tokenAddress];

        const input = encodeV2SwapInput(vaultAddress, 1000, 900, path, true);
        const calldata = encodeRouterExecute([CMD.V2_SWAP_EXACT_IN], [input]);

        await expect(vault.swap([routerAddress], [calldata]))
          .to.not.be.revertedWith("PositionVault: swap recipient must be vault");
      });

      it("should reject V2_SWAP_EXACT_IN with non-vault recipient", async function() {
        const routerAddress = await router.getAddress();
        const tokenAddress = await token.getAddress();
        const path = [tokenAddress, tokenAddress];

        const input = encodeV2SwapInput(user1.address, 1000, 900, path, true);
        const calldata = encodeRouterExecute([CMD.V2_SWAP_EXACT_IN], [input]);

        await expect(vault.swap([routerAddress], [calldata]))
          .to.be.revertedWith("PositionVault: swap recipient must be vault");
      });

      it("should reject V2_SWAP_EXACT_OUT with non-vault recipient", async function() {
        const routerAddress = await router.getAddress();
        const tokenAddress = await token.getAddress();
        const path = [tokenAddress, tokenAddress];

        const input = encodeV2SwapInput(user1.address, 1000, 1100, path, true);
        const calldata = encodeRouterExecute([CMD.V2_SWAP_EXACT_OUT], [input]);

        await expect(vault.swap([routerAddress], [calldata]))
          .to.be.revertedWith("PositionVault: swap recipient must be vault");
      });
    });

    describe("PERMIT2_PERMIT Command (0x0a)", function() {
      it("should allow PERMIT2_PERMIT command", async function() {
        const routerAddress = await router.getAddress();
        const abiCoder = ethers.AbiCoder.defaultAbiCoder();
        const mockPermitInput = abiCoder.encode(
          ["tuple(tuple(address,uint160,uint48,uint48),address,uint256)", "bytes"],
          [[[ethers.ZeroAddress, 0, 0, 0], ethers.ZeroAddress, 0], "0x"]
        );
        const calldata = encodeRouterExecute([CMD.PERMIT2_PERMIT], [mockPermitInput]);

        // Should not revert with command not allowed
        await expect(vault.swap([routerAddress], [calldata]))
          .to.not.be.revertedWith("PositionVault: command not allowed");
      });
    });

    describe("Blocked Commands", function() {
      it("should reject SWEEP command (0x04)", async function() {
        const vaultAddress = await vault.getAddress();
        const routerAddress = await router.getAddress();
        const tokenAddress = await token.getAddress();

        const input = encodeGenericInput(tokenAddress, vaultAddress, 0);
        const calldata = encodeRouterExecute([CMD.SWEEP], [input]);

        await expect(vault.swap([routerAddress], [calldata]))
          .to.be.revertedWith("PositionVault: command not allowed");
      });

      it("should reject TRANSFER command (0x05)", async function() {
        const vaultAddress = await vault.getAddress();
        const routerAddress = await router.getAddress();
        const tokenAddress = await token.getAddress();

        const input = encodeGenericInput(tokenAddress, vaultAddress, 1000);
        const calldata = encodeRouterExecute([CMD.TRANSFER], [input]);

        await expect(vault.swap([routerAddress], [calldata]))
          .to.be.revertedWith("PositionVault: command not allowed");
      });

      it("should reject PAY_PORTION command (0x06)", async function() {
        const vaultAddress = await vault.getAddress();
        const routerAddress = await router.getAddress();
        const tokenAddress = await token.getAddress();

        const input = encodeGenericInput(tokenAddress, vaultAddress, 5000);
        const calldata = encodeRouterExecute([CMD.PAY_PORTION], [input]);

        await expect(vault.swap([routerAddress], [calldata]))
          .to.be.revertedWith("PositionVault: command not allowed");
      });

      it("should reject WRAP_ETH command (0x0b)", async function() {
        const vaultAddress = await vault.getAddress();
        const routerAddress = await router.getAddress();
        const abiCoder = ethers.AbiCoder.defaultAbiCoder();
        const input = abiCoder.encode(["address", "uint256"], [vaultAddress, ethers.parseEther("1")]);
        const calldata = encodeRouterExecute([CMD.WRAP_ETH], [input]);

        await expect(vault.swap([routerAddress], [calldata]))
          .to.be.revertedWith("PositionVault: command not allowed");
      });

      it("should reject UNWRAP_WETH command (0x0c)", async function() {
        const vaultAddress = await vault.getAddress();
        const routerAddress = await router.getAddress();
        const abiCoder = ethers.AbiCoder.defaultAbiCoder();
        const input = abiCoder.encode(["address", "uint256"], [vaultAddress, ethers.parseEther("1")]);
        const calldata = encodeRouterExecute([CMD.UNWRAP_WETH], [input]);

        await expect(vault.swap([routerAddress], [calldata]))
          .to.be.revertedWith("PositionVault: command not allowed");
      });

      it("should reject unknown command (0x10 V4_SWAP)", async function() {
        const routerAddress = await router.getAddress();
        const abiCoder = ethers.AbiCoder.defaultAbiCoder();
        const input = abiCoder.encode(["bytes", "bytes[]"], ["0x", []]);
        const calldata = encodeRouterExecute([0x10], [input]);

        await expect(vault.swap([routerAddress], [calldata]))
          .to.be.revertedWith("PositionVault: command not allowed");
      });
    });

    describe("Multi-command Validation", function() {
      it("should validate all commands in a single router call", async function() {
        const vaultAddress = await vault.getAddress();
        const tokenAddress = await token.getAddress();
        const path = createMockPath(tokenAddress, tokenAddress);
        const routerAddress = await router.getAddress();

        const abiCoder = ethers.AbiCoder.defaultAbiCoder();
        const permitInput = abiCoder.encode(
          ["tuple(tuple(address,uint160,uint48,uint48),address,uint256)", "bytes"],
          [[[tokenAddress, 1000, Math.floor(Date.now()/1000) + 3600, 0], routerAddress, Math.floor(Date.now()/1000) + 3600], "0x"]
        );
        const swapInput = encodeV3SwapInput(vaultAddress, 1000, 900, path, true);

        const calldata = encodeRouterExecute(
          [CMD.PERMIT2_PERMIT, CMD.V3_SWAP_EXACT_IN],
          [permitInput, swapInput]
        );

        await expect(vault.swap([routerAddress], [calldata]))
          .to.not.be.revertedWith("PositionVault:");
      });

      it("should reject if any command has invalid recipient", async function() {
        const vaultAddress = await vault.getAddress();
        const routerAddress = await router.getAddress();
        const tokenAddress = await token.getAddress();
        const path = createMockPath(tokenAddress, tokenAddress);

        const validSwap = encodeV3SwapInput(vaultAddress, 1000, 900, path, true);
        const invalidSwap = encodeV3SwapInput(user1.address, 500, 450, path, true);

        const calldata = encodeRouterExecute(
          [CMD.V3_SWAP_EXACT_IN, CMD.V3_SWAP_EXACT_IN],
          [validSwap, invalidSwap]
        );

        await expect(vault.swap([routerAddress], [calldata]))
          .to.be.revertedWith("PositionVault: swap recipient must be vault");
      });

      it("should reject if any command is blocked", async function() {
        const vaultAddress = await vault.getAddress();
        const routerAddress = await router.getAddress();
        const tokenAddress = await token.getAddress();
        const path = createMockPath(tokenAddress, tokenAddress);

        const validSwap = encodeV3SwapInput(vaultAddress, 1000, 900, path, true);
        const blockedCmd = encodeGenericInput(tokenAddress, vaultAddress, 0);

        const calldata = encodeRouterExecute(
          [CMD.V3_SWAP_EXACT_IN, CMD.SWEEP],
          [validSwap, blockedCmd]
        );

        await expect(vault.swap([routerAddress], [calldata]))
          .to.be.revertedWith("PositionVault: command not allowed");
      });

      it("should execute multiple swap transactions in one call", async function() {
        const vaultAddress = await vault.getAddress();
        const routerAddress = await router.getAddress();
        const tokenAddress = await token.getAddress();
        const path = createMockPath(tokenAddress, tokenAddress);

        // Two separate swap calldatas
        const swap1Input = encodeV3SwapInput(vaultAddress, 1000, 900, path, true);
        const swap1Calldata = encodeRouterExecute([CMD.V3_SWAP_EXACT_IN], [swap1Input]);

        const swap2Input = encodeV3SwapInput(vaultAddress, 2000, 1800, path, true);
        const swap2Calldata = encodeRouterExecute([CMD.V3_SWAP_EXACT_IN], [swap2Input]);

        // Should pass validation for both (router will fail but that's ok)
        await expect(vault.swap([routerAddress, routerAddress], [swap1Calldata, swap2Calldata]))
          .to.not.be.revertedWith("PositionVault: swap recipient must be vault");
      });

      it("should reject batched swaps if any has invalid recipient", async function() {
        const vaultAddress = await vault.getAddress();
        const routerAddress = await router.getAddress();
        const tokenAddress = await token.getAddress();
        const path = createMockPath(tokenAddress, tokenAddress);

        // First swap invalid recipient (will fail validation before any execution)
        const swap1Input = encodeV3SwapInput(user1.address, 1000, 900, path, true);
        const swap1Calldata = encodeRouterExecute([CMD.V3_SWAP_EXACT_IN], [swap1Input]);

        const swap2Input = encodeV3SwapInput(vaultAddress, 2000, 1800, path, true);
        const swap2Calldata = encodeRouterExecute([CMD.V3_SWAP_EXACT_IN], [swap2Input]);

        await expect(vault.swap([routerAddress, routerAddress], [swap1Calldata, swap2Calldata]))
          .to.be.revertedWith("PositionVault: swap recipient must be vault");
      });
    });

    describe("Execute function unchanged", function() {
      it("should still allow execute for non-router calls", async function() {
        const tokenAddress = await token.getAddress();
        const calldata = token.interface.encodeFunctionData("transfer", [user1.address, 1]);

        await expect(vault.execute([tokenAddress], [calldata]))
          .to.not.be.reverted;
      });
    });
  });
});
