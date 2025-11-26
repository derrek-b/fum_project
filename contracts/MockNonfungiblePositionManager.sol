// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * @title MockNonfungiblePositionManager
 * @notice Mock contract for testing Uniswap V3 NonfungiblePositionManager integration
 * @dev Captures mint, increaseLiquidity, decreaseLiquidity, and collect calls for verification in tests
 */
contract MockNonfungiblePositionManager {
    // Track the last mint call for verification
    address public lastToken0;
    address public lastToken1;
    uint24 public lastFee;
    int24 public lastTickLower;
    int24 public lastTickUpper;
    address public lastMintRecipient;

    // Track the last increaseLiquidity call for verification
    uint256 public lastTokenId;
    uint256 public lastAmount0Desired;
    uint256 public lastAmount1Desired;
    uint256 public lastAmount0Min;
    uint256 public lastAmount1Min;
    uint256 public lastDeadline;

    // Track the last decreaseLiquidity call
    uint128 public lastLiquidityToRemove;

    // Track the last collect call
    address public lastCollectRecipient;
    uint128 public lastAmount0Max;
    uint128 public lastAmount1Max;

    // For simulating failures
    bool public shouldFail;

    // Return values for mint/increaseLiquidity
    uint256 public returnTokenId;
    uint128 public returnLiquidity;
    uint256 public returnAmount0;
    uint256 public returnAmount1;

    event MintCalled(
        address token0,
        address token1,
        uint24 fee,
        int24 tickLower,
        int24 tickUpper,
        address recipient
    );

    event IncreaseLiquidityCalled(
        uint256 tokenId,
        uint256 amount0Desired,
        uint256 amount1Desired,
        uint256 amount0Min,
        uint256 amount1Min,
        uint256 deadline
    );

    event DecreaseLiquidityCalled(
        uint256 tokenId,
        uint128 liquidity,
        uint256 amount0Min,
        uint256 amount1Min,
        uint256 deadline
    );

    event CollectCalled(
        uint256 tokenId,
        address recipient,
        uint128 amount0Max,
        uint128 amount1Max
    );

    constructor() {
        // Default return values
        returnTokenId = 1;
        returnLiquidity = 1000;
        returnAmount0 = 500;
        returnAmount1 = 500;
    }

    /**
     * @notice Set whether increaseLiquidity should fail
     */
    function setShouldFail(bool _shouldFail) external {
        shouldFail = _shouldFail;
    }

    /**
     * @notice Set the return values for mint/increaseLiquidity
     */
    function setReturnValues(uint128 _liquidity, uint256 _amount0, uint256 _amount1) external {
        returnLiquidity = _liquidity;
        returnAmount0 = _amount0;
        returnAmount1 = _amount1;
    }

    /**
     * @notice Set the return token ID for mint
     */
    function setReturnTokenId(uint256 _tokenId) external {
        returnTokenId = _tokenId;
    }

    /**
     * @notice Mock mint function matching NonfungiblePositionManager interface
     * @dev Stores the parameters and returns mock values
     */
    struct MintParams {
        address token0;
        address token1;
        uint24 fee;
        int24 tickLower;
        int24 tickUpper;
        uint256 amount0Desired;
        uint256 amount1Desired;
        uint256 amount0Min;
        uint256 amount1Min;
        address recipient;
        uint256 deadline;
    }

    function mint(MintParams calldata params)
        external
        payable
        returns (
            uint256 tokenId,
            uint128 liquidity,
            uint256 amount0,
            uint256 amount1
        )
    {
        require(!shouldFail, "MockNonfungiblePositionManager: forced failure");

        // Store parameters for verification
        lastToken0 = params.token0;
        lastToken1 = params.token1;
        lastFee = params.fee;
        lastTickLower = params.tickLower;
        lastTickUpper = params.tickUpper;
        lastAmount0Desired = params.amount0Desired;
        lastAmount1Desired = params.amount1Desired;
        lastAmount0Min = params.amount0Min;
        lastAmount1Min = params.amount1Min;
        lastMintRecipient = params.recipient;
        lastDeadline = params.deadline;

        emit MintCalled(
            params.token0,
            params.token1,
            params.fee,
            params.tickLower,
            params.tickUpper,
            params.recipient
        );

        // Return mock values
        return (returnTokenId, returnLiquidity, returnAmount0, returnAmount1);
    }

    /**
     * @notice Mock increaseLiquidity function matching NonfungiblePositionManager interface
     * @dev Stores the parameters and returns mock values
     */
    struct IncreaseLiquidityParams {
        uint256 tokenId;
        uint256 amount0Desired;
        uint256 amount1Desired;
        uint256 amount0Min;
        uint256 amount1Min;
        uint256 deadline;
    }

    function increaseLiquidity(IncreaseLiquidityParams calldata params)
        external
        payable
        returns (
            uint128 liquidity,
            uint256 amount0,
            uint256 amount1
        )
    {
        require(!shouldFail, "MockNonfungiblePositionManager: forced failure");

        // Store parameters for verification
        lastTokenId = params.tokenId;
        lastAmount0Desired = params.amount0Desired;
        lastAmount1Desired = params.amount1Desired;
        lastAmount0Min = params.amount0Min;
        lastAmount1Min = params.amount1Min;
        lastDeadline = params.deadline;

        emit IncreaseLiquidityCalled(
            params.tokenId,
            params.amount0Desired,
            params.amount1Desired,
            params.amount0Min,
            params.amount1Min,
            params.deadline
        );

        // Return mock values
        return (returnLiquidity, returnAmount0, returnAmount1);
    }

    /**
     * @notice Mock decreaseLiquidity function matching NonfungiblePositionManager interface
     * @dev Stores the parameters and returns mock values
     */
    struct DecreaseLiquidityParams {
        uint256 tokenId;
        uint128 liquidity;
        uint256 amount0Min;
        uint256 amount1Min;
        uint256 deadline;
    }

    function decreaseLiquidity(DecreaseLiquidityParams calldata params)
        external
        payable
        returns (uint256 amount0, uint256 amount1)
    {
        require(!shouldFail, "MockNonfungiblePositionManager: forced failure");

        // Store parameters for verification
        lastTokenId = params.tokenId;
        lastLiquidityToRemove = params.liquidity;
        lastAmount0Min = params.amount0Min;
        lastAmount1Min = params.amount1Min;
        lastDeadline = params.deadline;

        emit DecreaseLiquidityCalled(
            params.tokenId,
            params.liquidity,
            params.amount0Min,
            params.amount1Min,
            params.deadline
        );

        // Return mock values
        return (returnAmount0, returnAmount1);
    }

    /**
     * @notice Mock collect function matching NonfungiblePositionManager interface
     * @dev Stores the parameters and returns mock values
     */
    struct CollectParams {
        uint256 tokenId;
        address recipient;
        uint128 amount0Max;
        uint128 amount1Max;
    }

    function collect(CollectParams calldata params)
        external
        payable
        returns (uint256 amount0, uint256 amount1)
    {
        require(!shouldFail, "MockNonfungiblePositionManager: forced failure");

        // Store parameters for verification
        lastTokenId = params.tokenId;
        lastCollectRecipient = params.recipient;
        lastAmount0Max = params.amount0Max;
        lastAmount1Max = params.amount1Max;

        emit CollectCalled(
            params.tokenId,
            params.recipient,
            params.amount0Max,
            params.amount1Max
        );

        // Return mock values
        return (returnAmount0, returnAmount1);
    }

    /**
     * @notice Mock burn function matching NonfungiblePositionManager interface
     * @dev Burns an empty position NFT (must have 0 liquidity and 0 owed tokens)
     * @param tokenId The ID of the position NFT to burn
     */
    function burn(uint256 tokenId) external payable {
        require(!shouldFail, "MockNonfungiblePositionManager: forced failure");

        // Store parameter for verification
        lastTokenId = tokenId;

        // In a real contract, this would check liquidity = 0 and owed tokens = 0
        // then burn the NFT. Mock just succeeds.
    }

    /**
     * @notice Mock multicall function matching NonfungiblePositionManager interface
     * @dev Executes each inner call and returns results
     * @param data Array of encoded function calls
     * @return results Array of return data from each call
     */
    function multicall(bytes[] calldata data) external payable returns (bytes[] memory results) {
        require(!shouldFail, "MockNonfungiblePositionManager: forced failure");

        results = new bytes[](data.length);
        for (uint256 i = 0; i < data.length; i++) {
            (bool success, bytes memory result) = address(this).delegatecall(data[i]);
            require(success, "MockNonfungiblePositionManager: multicall failed");
            results[i] = result;
        }
        return results;
    }
}
