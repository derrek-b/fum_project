const { expect } = require("chai");
const { ethers } = require('hardhat');

describe("MerklIncentiveValidator", function() {
  let validator;
  let vaultAddress;
  let otherAddress;

  // Function selector for claim(address,address[],uint256[],bytes32[][])
  const CLAIM_SELECTOR = "0xa0165082";

  // Helper to encode Merkl claim calldata
  function encodeClaimCalldata(user, tokens, amounts, proofs) {
    const abiCoder = ethers.AbiCoder.defaultAbiCoder();
    const encoded = abiCoder.encode(
      ["address", "address[]", "uint256[]", "bytes32[][]"],
      [user, tokens, amounts, proofs]
    );
    return CLAIM_SELECTOR + encoded.slice(2);
  }

  beforeEach(async function() {
    const [owner, user1] = await ethers.getSigners();
    vaultAddress = owner.address; // Use owner as mock vault
    otherAddress = user1.address;

    const MerklIncentiveValidator = await ethers.getContractFactory("MerklIncentiveValidator");
    validator = await MerklIncentiveValidator.deploy();
    await validator.waitForDeployment();
  });

  describe("Valid claim calls", function() {
    it("should accept claim with vault as user", async function() {
      const calldata = encodeClaimCalldata(
        vaultAddress,
        [otherAddress],  // one token
        [1000n],
        [[ethers.keccak256("0x01")]]  // one proof per token
      );

      await expect(validator.validateIncentive(calldata, vaultAddress)).to.not.be.reverted;
    });

    it("should accept claim with multiple tokens", async function() {
      const calldata = encodeClaimCalldata(
        vaultAddress,
        [otherAddress, vaultAddress],  // two tokens
        [1000n, 2000n],
        [[ethers.keccak256("0x01")], [ethers.keccak256("0x02")]]
      );

      await expect(validator.validateIncentive(calldata, vaultAddress)).to.not.be.reverted;
    });

    it("should accept claim with empty arrays (edge case — no rewards)", async function() {
      const calldata = encodeClaimCalldata(
        vaultAddress,
        [],  // no tokens
        [],
        []
      );

      await expect(validator.validateIncentive(calldata, vaultAddress)).to.not.be.reverted;
    });
  });

  describe("Invalid selector", function() {
    it("should reject calldata shorter than 4 bytes", async function() {
      await expect(validator.validateIncentive("0x1234", vaultAddress))
        .to.be.revertedWith("MerklIncentiveValidator: invalid calldata");
    });

    it("should reject wrong function selector", async function() {
      // Use a random selector instead of claim()
      const abiCoder = ethers.AbiCoder.defaultAbiCoder();
      const encoded = abiCoder.encode(
        ["address", "address[]", "uint256[]", "bytes32[][]"],
        [vaultAddress, [], [], []]
      );
      const badCalldata = "0xdeadbeef" + encoded.slice(2);

      await expect(validator.validateIncentive(badCalldata, vaultAddress))
        .to.be.revertedWith("MerklIncentiveValidator: not a claim call");
    });
  });

  describe("User validation", function() {
    it("should reject claim where user is not the vault", async function() {
      const calldata = encodeClaimCalldata(
        otherAddress,  // attacker's address, not the vault
        [otherAddress],
        [1000n],
        [[ethers.keccak256("0x01")]]
      );

      await expect(validator.validateIncentive(calldata, vaultAddress))
        .to.be.revertedWith("MerklIncentiveValidator: claim user must be vault");
    });

    it("should reject claim where user is zero address", async function() {
      const calldata = encodeClaimCalldata(
        ethers.ZeroAddress,
        [otherAddress],
        [1000n],
        [[ethers.keccak256("0x01")]]
      );

      await expect(validator.validateIncentive(calldata, vaultAddress))
        .to.be.revertedWith("MerklIncentiveValidator: claim user must be vault");
    });
  });
});
