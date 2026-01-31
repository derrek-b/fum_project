// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/ILBPair.sol";
import "./interfaces/ILBRouter.sol";

/**
 * @title TJPositionManager
 * @notice Position manager for Trader Joe V2.1 Liquidity Book positions
 * @dev Holds ERC1155 LB tokens on behalf of vaults and tracks positions with
 *      auto-incrementing IDs. Architecturally consistent with how Uniswap V3/V4
 *      position managers work.
 *
 *      This contract is called by PositionVault.mint() after validation by
 *      TJPositionValidator via VaultFactory.validateMint().
 *
 *      Flow:
 *        Vault.mint(target=TJPositionManager, data=createPosition(...))
 *          -> VaultFactory.validateMint(TJPositionManager, calldata, vault)
 *            -> TJPositionValidator.validateMint(calldata, vault)
 *          -> TJPositionManager.createPosition() executes
 *            1. Verify msg.sender == vault param
 *            2. Pull tokens from vault via transferFrom
 *            3. Approve LBRouter, call addLiquidity(to=self, refundTo=vault)
 *            4. Record position (ID, vault, lbPair, depositIds, liquidityMinted)
 *            5. Reset approvals, refund any remaining tokens
 *            6. Emit PositionCreated event
 */
contract TJPositionManager is ERC1155Holder, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Position {
        address vault;
        address lbPair;
        address tokenX;
        address tokenY;
        uint16 binStep;
        uint256[] depositIds;
        uint256[] liquidityMinted;
        uint256 createdAt;
        bool active;
    }

    address public immutable lbRouter;
    uint256 private _nextPositionId = 1;
    mapping(uint256 => Position) private _positions;
    mapping(address => uint256[]) private _vaultPositions;

    event PositionCreated(
        uint256 indexed positionId,
        address indexed vault,
        address indexed lbPair,
        uint256[] depositIds,
        uint256[] liquidityMinted
    );

    event PositionRemoved(
        uint256 indexed positionId,
        address indexed vault,
        address indexed lbPair,
        uint256 percentage,
        uint256 amountX,
        uint256 amountY
    );

    event PositionIncreased(
        uint256 indexed positionId,
        address indexed vault,
        address indexed lbPair,
        uint256 amountXAdded,
        uint256 amountYAdded
    );

    constructor(address _lbRouter) {
        require(_lbRouter != address(0), "TJPositionManager: zero router");
        lbRouter = _lbRouter;
    }

    /**
     * @notice Create a new liquidity position on a Trader Joe V2.1 LB pair
     * @param vault Must equal msg.sender; validator checks this in calldata
     * @param lbPair The Liquidity Book pair to add liquidity to
     * @param amountX Amount of tokenX to deposit
     * @param amountY Amount of tokenY to deposit
     * @param amountXMin Minimum tokenX accepted (slippage protection)
     * @param amountYMin Minimum tokenY accepted (slippage protection)
     * @param activeIdDesired The active bin ID desired
     * @param idSlippage Allowed slippage on the active bin ID
     * @param deltaIds Relative bin IDs to deposit into (relative to active)
     * @param distributionX Distribution of tokenX across bins (1e18 precision)
     * @param distributionY Distribution of tokenY across bins (1e18 precision)
     * @param deadline Transaction deadline timestamp
     * @return positionId The auto-incremented position ID
     */
    function createPosition(
        address vault,
        address lbPair,
        uint256 amountX,
        uint256 amountY,
        uint256 amountXMin,
        uint256 amountYMin,
        uint256 activeIdDesired,
        uint256 idSlippage,
        int256[] calldata deltaIds,
        uint256[] calldata distributionX,
        uint256[] calldata distributionY,
        uint256 deadline
    ) external nonReentrant returns (uint256 positionId) {
        require(vault == msg.sender, "TJPositionManager: vault must be caller");
        require(lbPair != address(0), "TJPositionManager: zero lbPair");

        // Derive token info from pair
        address tokenX = ILBPair(lbPair).getTokenX();
        address tokenY = ILBPair(lbPair).getTokenY();
        uint16 binStep = ILBPair(lbPair).getBinStep();

        // Pull tokens from vault
        IERC20(tokenX).safeTransferFrom(vault, address(this), amountX);
        IERC20(tokenY).safeTransferFrom(vault, address(this), amountY);

        // Approve LBRouter for the token amounts
        IERC20(tokenX).approve(lbRouter, amountX);
        IERC20(tokenY).approve(lbRouter, amountY);

        // Call addLiquidity -- LB tokens sent to this contract, refund to vault
        ILBRouter.LiquidityParameters memory params = ILBRouter.LiquidityParameters({
            tokenX: tokenX,
            tokenY: tokenY,
            binStep: uint256(binStep),
            amountX: amountX,
            amountY: amountY,
            amountXMin: amountXMin,
            amountYMin: amountYMin,
            activeIdDesired: activeIdDesired,
            idSlippage: idSlippage,
            deltaIds: deltaIds,
            distributionX: distributionX,
            distributionY: distributionY,
            to: address(this),
            refundTo: vault,
            deadline: deadline
        });

        (,,,,uint256[] memory depositedIds, uint256[] memory liquidityAmounts)
            = ILBRouter(lbRouter).addLiquidity(params);

        // Belt-and-suspenders: refund any tokens remaining in this contract
        uint256 balX = IERC20(tokenX).balanceOf(address(this));
        if (balX > 0) IERC20(tokenX).safeTransfer(vault, balX);
        uint256 balY = IERC20(tokenY).balanceOf(address(this));
        if (balY > 0) IERC20(tokenY).safeTransfer(vault, balY);

        // Reset approvals
        IERC20(tokenX).approve(lbRouter, 0);
        IERC20(tokenY).approve(lbRouter, 0);

        // Record position
        positionId = _nextPositionId++;
        _positions[positionId] = Position({
            vault: vault,
            lbPair: lbPair,
            tokenX: tokenX,
            tokenY: tokenY,
            binStep: binStep,
            depositIds: depositedIds,
            liquidityMinted: liquidityAmounts,
            createdAt: block.timestamp,
            active: true
        });
        _vaultPositions[vault].push(positionId);

        emit PositionCreated(positionId, vault, lbPair, depositedIds, liquidityAmounts);
    }

    /**
     * @notice Add liquidity to an existing position
     * @param vault Must equal msg.sender; validator checks this in calldata
     * @param positionId The position to add liquidity to
     * @param amountX Amount of tokenX to deposit
     * @param amountY Amount of tokenY to deposit
     * @param amountXMin Minimum tokenX accepted (slippage protection)
     * @param amountYMin Minimum tokenY accepted (slippage protection)
     * @param activeIdDesired The active bin ID desired
     * @param idSlippage Allowed slippage on the active bin ID
     * @param deltaIds Relative bin IDs to deposit into (relative to active)
     * @param distributionX Distribution of tokenX across bins (1e18 precision)
     * @param distributionY Distribution of tokenY across bins (1e18 precision)
     * @param deadline Transaction deadline timestamp
     * @return amountXAdded Amount of tokenX actually added
     * @return amountYAdded Amount of tokenY actually added
     */
    function addToPosition(
        address vault,
        uint256 positionId,
        uint256 amountX,
        uint256 amountY,
        uint256 amountXMin,
        uint256 amountYMin,
        uint256 activeIdDesired,
        uint256 idSlippage,
        int256[] calldata deltaIds,
        uint256[] calldata distributionX,
        uint256[] calldata distributionY,
        uint256 deadline
    ) external nonReentrant returns (uint256 amountXAdded, uint256 amountYAdded) {
        require(vault == msg.sender, "TJPositionManager: vault must be caller");

        Position storage pos = _positions[positionId];
        require(pos.vault == vault, "TJPositionManager: not position owner");
        require(pos.active, "TJPositionManager: position not active");

        address tokenX = pos.tokenX;
        address tokenY = pos.tokenY;

        // Pull tokens from vault
        IERC20(tokenX).safeTransferFrom(vault, address(this), amountX);
        IERC20(tokenY).safeTransferFrom(vault, address(this), amountY);

        // Approve LBRouter for the token amounts
        IERC20(tokenX).approve(lbRouter, amountX);
        IERC20(tokenY).approve(lbRouter, amountY);

        // Call addLiquidity -- LB tokens sent to this contract, refund to vault
        ILBRouter.LiquidityParameters memory params = ILBRouter.LiquidityParameters({
            tokenX: tokenX,
            tokenY: tokenY,
            binStep: uint256(pos.binStep),
            amountX: amountX,
            amountY: amountY,
            amountXMin: amountXMin,
            amountYMin: amountYMin,
            activeIdDesired: activeIdDesired,
            idSlippage: idSlippage,
            deltaIds: deltaIds,
            distributionX: distributionX,
            distributionY: distributionY,
            to: address(this),
            refundTo: vault,
            deadline: deadline
        });

        uint256[] memory depositedIds;
        uint256[] memory liquidityAmounts;
        (amountXAdded, amountYAdded,,, depositedIds, liquidityAmounts)
            = ILBRouter(lbRouter).addLiquidity(params);

        // Merge returned bins into existing position
        for (uint256 i = 0; i < depositedIds.length; i++) {
            bool found = false;
            for (uint256 j = 0; j < pos.depositIds.length; j++) {
                if (pos.depositIds[j] == depositedIds[i]) {
                    pos.liquidityMinted[j] += liquidityAmounts[i];
                    found = true;
                    break;
                }
            }
            if (!found) {
                pos.depositIds.push(depositedIds[i]);
                pos.liquidityMinted.push(liquidityAmounts[i]);
            }
        }

        // Belt-and-suspenders: refund any tokens remaining in this contract
        uint256 balX = IERC20(tokenX).balanceOf(address(this));
        if (balX > 0) IERC20(tokenX).safeTransfer(vault, balX);
        uint256 balY = IERC20(tokenY).balanceOf(address(this));
        if (balY > 0) IERC20(tokenY).safeTransfer(vault, balY);

        // Reset approvals
        IERC20(tokenX).approve(lbRouter, 0);
        IERC20(tokenY).approve(lbRouter, 0);

        emit PositionIncreased(positionId, vault, pos.lbPair, amountXAdded, amountYAdded);
    }

    /**
     * @notice Remove liquidity from an existing position
     * @param vault Must equal msg.sender; validator checks this in calldata
     * @param positionId The position to remove liquidity from
     * @param percentage Percentage of liquidity to remove (1-100)
     * @param amountXMin Minimum tokenX to receive (slippage protection)
     * @param amountYMin Minimum tokenY to receive (slippage protection)
     * @param deadline Transaction deadline timestamp
     * @return amountX Amount of tokenX received
     * @return amountY Amount of tokenY received
     */
    function removePosition(
        address vault,
        uint256 positionId,
        uint256 percentage,
        uint256 amountXMin,
        uint256 amountYMin,
        uint256 deadline
    ) external nonReentrant returns (uint256 amountX, uint256 amountY) {
        require(vault == msg.sender, "TJPositionManager: vault must be caller");

        Position storage pos = _positions[positionId];
        require(pos.vault == vault, "TJPositionManager: not position owner");
        require(pos.active, "TJPositionManager: position not active");
        require(percentage > 0 && percentage <= 100, "TJPositionManager: invalid percentage");

        uint256 len = pos.depositIds.length;
        uint256[] memory ids = new uint256[](len);
        uint256[] memory amounts = new uint256[](len);

        for (uint256 i = 0; i < len; i++) {
            ids[i] = pos.depositIds[i];
            amounts[i] = pos.liquidityMinted[i] * percentage / 100;
        }

        // Approve LBRouter to burn our ERC1155 LB tokens
        ILBPair(pos.lbPair).approveForAll(lbRouter, true);

        // Remove liquidity — tokens sent directly to vault
        (amountX, amountY) = ILBRouter(lbRouter).removeLiquidity(
            pos.tokenX,
            pos.tokenY,
            pos.binStep,
            amountXMin,
            amountYMin,
            ids,
            amounts,
            vault,
            deadline
        );

        // Reset ERC1155 approval
        ILBPair(pos.lbPair).approveForAll(lbRouter, false);

        // Update position state
        if (percentage == 100) {
            pos.active = false;
            delete pos.depositIds;
            delete pos.liquidityMinted;
        } else {
            for (uint256 i = 0; i < len; i++) {
                pos.liquidityMinted[i] -= amounts[i];
            }
        }

        emit PositionRemoved(positionId, vault, pos.lbPair, percentage, amountX, amountY);
    }

    /**
     * @notice Get position data by ID
     * @param positionId The position ID to query
     * @return The Position struct
     */
    function getPosition(uint256 positionId) external view returns (Position memory) {
        return _positions[positionId];
    }

    /**
     * @notice Get all position IDs for a vault
     * @param vault The vault address to query
     * @return Array of position IDs
     */
    function getPositionsByVault(address vault) external view returns (uint256[] memory) {
        return _vaultPositions[vault];
    }

    /**
     * @notice Get the number of positions for a vault
     * @param vault The vault address to query
     * @return The number of positions
     */
    function getPositionCount(address vault) external view returns (uint256) {
        return _vaultPositions[vault].length;
    }

    /**
     * @notice Get accrued fees for a position by comparing stored baselines to current LB token balances
     * @dev Fees in TJ V2.1 are autocompounded into bins, increasing the LB token balance.
     *      This function compares the stored liquidityMinted (baseline from create/add) against
     *      the actual ERC-1155 balance held by this contract to detect fee growth.
     * @param positionId The position ID to query
     * @return depositIds Array of bin IDs in the position
     * @return currentBalances Current ERC-1155 LB token balances per bin
     * @return storedBalances Stored baseline (liquidityMinted) per bin
     * @return feeDeltas Per-bin fee accrual (current - stored, floored at 0)
     */
    function getAccruedFees(uint256 positionId)
        external
        view
        returns (
            uint256[] memory depositIds,
            uint256[] memory currentBalances,
            uint256[] memory storedBalances,
            uint256[] memory feeDeltas
        )
    {
        Position storage pos = _positions[positionId];
        require(pos.active, "TJPositionManager: position not active");

        uint256 len = pos.depositIds.length;
        depositIds = new uint256[](len);
        currentBalances = new uint256[](len);
        storedBalances = new uint256[](len);
        feeDeltas = new uint256[](len);

        for (uint256 i = 0; i < len; i++) {
            depositIds[i] = pos.depositIds[i];
            storedBalances[i] = pos.liquidityMinted[i];

            // Query actual ERC-1155 balance held by this contract for this bin
            uint256 current = ILBPair(pos.lbPair).balanceOf(address(this), pos.depositIds[i]);
            currentBalances[i] = current;

            // Fee delta: current - stored (0 if somehow current < stored)
            feeDeltas[i] = current > storedBalances[i] ? current - storedBalances[i] : 0;
        }
    }
}
