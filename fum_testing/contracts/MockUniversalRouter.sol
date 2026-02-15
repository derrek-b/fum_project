// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title MockUniversalRouter
 * @notice Mock contract for testing Uniswap V3 Universal Router integration
 * @dev Captures execute calls and verifies recipient address for security testing
 */
contract MockUniversalRouter {
    // Track the last execute call for verification
    bytes public lastCommands;
    bytes[] public lastInputs;
    address public lastSwapRecipient;
    uint256 public lastAmountIn;
    uint256 public lastAmountOutMin;
    bytes public lastPath;

    // Token to send as output (set by test)
    address public outputToken;
    uint256 public outputAmount;

    // For simulating failures
    bool public shouldFail;

    event ExecuteCalled(bytes commands, uint256 inputCount);
    event SwapDecoded(address recipient, uint256 amountIn, uint256 amountOutMin);

    /**
     * @notice Set the output token and amount for simulated swaps
     */
    function setSwapOutput(address _token, uint256 _amount) external {
        outputToken = _token;
        outputAmount = _amount;
    }

    /**
     * @notice Set whether execute should fail
     */
    function setShouldFail(bool _shouldFail) external {
        shouldFail = _shouldFail;
    }

    /**
     * @notice Mock execute function matching Universal Router interface
     * @dev Decodes the swap input to verify recipient is the vault
     * @param commands The commands to execute
     * @param inputs The inputs for each command
     * @param deadline The deadline for the transaction (ignored in mock)
     */
    function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline) external payable {
        // Silence unused variable warning
        deadline;
        require(!shouldFail, "MockUniversalRouter: forced failure");

        lastCommands = commands;
        delete lastInputs;
        for (uint i = 0; i < inputs.length; i++) {
            lastInputs.push(inputs[i]);
        }

        emit ExecuteCalled(commands, inputs.length);

        // If we have at least 2 inputs (permit2 + swap), decode the swap
        if (inputs.length >= 2) {
            // Decode swap input (second input after permit2)
            // Format: (address recipient, uint256 amountIn, uint256 amountOutMin, bytes path, bool payerIsUser)
            (
                address recipient,
                uint256 amountIn,
                uint256 amountOutMin,
                bytes memory path,
                // bool payerIsUser - not needed for our verification
            ) = abi.decode(inputs[1], (address, uint256, uint256, bytes, bool));

            lastSwapRecipient = recipient;
            lastAmountIn = amountIn;
            lastAmountOutMin = amountOutMin;
            lastPath = path;

            emit SwapDecoded(recipient, amountIn, amountOutMin);

            // Simulate swap by transferring output token to recipient
            if (outputToken != address(0) && outputAmount > 0) {
                IERC20(outputToken).transfer(recipient, outputAmount);
            }
        }
    }

    /**
     * @notice Get last inputs array length
     */
    function getLastInputsLength() external view returns (uint256) {
        return lastInputs.length;
    }

    /**
     * @notice Get specific input by index
     */
    function getLastInput(uint256 index) external view returns (bytes memory) {
        require(index < lastInputs.length, "Index out of bounds");
        return lastInputs[index];
    }
}
