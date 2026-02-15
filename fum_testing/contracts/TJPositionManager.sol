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
        uint256[] originalShareX;
        uint256[] originalShareY;
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
        uint256[] liquidityMinted,
        uint256 amountXAdded,
        uint256 amountYAdded
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

    event FeesCollected(
        uint256 indexed positionId,
        address indexed vault,
        address indexed lbPair,
        uint256 amountX,
        uint256 amountY
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

        (uint256 amountXAdded, uint256 amountYAdded,,,uint256[] memory depositedIds, uint256[] memory liquidityAmounts)
            = ILBRouter(lbRouter).addLiquidity(params);

        // Belt-and-suspenders: refund any tokens remaining in this contract
        uint256 balX = IERC20(tokenX).balanceOf(address(this));
        if (balX > 0) IERC20(tokenX).safeTransfer(vault, balX);
        uint256 balY = IERC20(tokenY).balanceOf(address(this));
        if (balY > 0) IERC20(tokenY).safeTransfer(vault, balY);

        // Reset approvals
        IERC20(tokenX).approve(lbRouter, 0);
        IERC20(tokenY).approve(lbRouter, 0);

        // Calculate original share of reserves per bin
        uint256 len = depositedIds.length;
        uint256[] memory origShareX = new uint256[](len);
        uint256[] memory origShareY = new uint256[](len);
        for (uint256 i = 0; i < len; i++) {
            uint256 supply = ILBPair(lbPair).totalSupply(depositedIds[i]);
            if (supply > 0) {
                (uint128 reserveX, uint128 reserveY) = ILBPair(lbPair).getBin(uint24(depositedIds[i]));
                origShareX[i] = liquidityAmounts[i] * uint256(reserveX) / supply;
                origShareY[i] = liquidityAmounts[i] * uint256(reserveY) / supply;
            }
        }

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
            originalShareX: origShareX,
            originalShareY: origShareY,
            createdAt: block.timestamp,
            active: true
        });
        _vaultPositions[vault].push(positionId);

        emit PositionCreated(positionId, vault, lbPair, depositedIds, liquidityAmounts, amountXAdded, amountYAdded);
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

        // Step 1: Snapshot accrued fees before adding liquidity
        (uint256[] memory feesX, uint256[] memory feesY) = _getAccruedFees(positionId);

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

        // Step 2: Update liquidityMinted — reject any bins not already in the position
        for (uint256 i = 0; i < depositedIds.length; i++) {
            bool found = false;
            for (uint256 j = 0; j < pos.depositIds.length; j++) {
                if (pos.depositIds[j] == depositedIds[i]) {
                    pos.liquidityMinted[j] += liquidityAmounts[i];
                    found = true;
                    break;
                }
            }
            require(found, "TJPositionManager: bin not in position");
        }

        // Step 3: Get new current shares and reset baselines preserving accrued fees
        for (uint256 i = 0; i < pos.depositIds.length; i++) {
            uint256 supply = ILBPair(pos.lbPair).totalSupply(pos.depositIds[i]);
            if (supply > 0) {
                (uint128 rX, uint128 rY) = ILBPair(pos.lbPair).getBin(uint24(pos.depositIds[i]));
                uint256 newCurrentShareX = pos.liquidityMinted[i] * uint256(rX) / supply;
                uint256 newCurrentShareY = pos.liquidityMinted[i] * uint256(rY) / supply;
                pos.originalShareX[i] = newCurrentShareX - feesX[i];
                pos.originalShareY[i] = newCurrentShareY - feesY[i];
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
     * @notice Collect accrued fees from a position
     * @param vault Must equal msg.sender; validator checks this in calldata
     * @param positionId The position to collect fees from
     * @return amountX Amount of tokenX fees collected
     * @return amountY Amount of tokenY fees collected
     */
    function collectFees(
        address vault,
        uint256 positionId
    ) external nonReentrant returns (uint256 amountX, uint256 amountY) {
        require(vault == msg.sender, "TJPositionManager: vault must be caller");
        Position storage pos = _positions[positionId];
        require(pos.vault == vault, "TJPositionManager: not position owner");
        require(pos.active, "TJPositionManager: position not active");

        (amountX, amountY) = _collectFees(positionId);
    }

    /**
     * @notice Decrease liquidity from an existing position (partial or full)
     * @param vault Must equal msg.sender; validator checks this in calldata
     * @param positionId The position to remove liquidity from
     * @param percentage Percentage of baseline liquidity to remove (1-100)
     * @param amountXMin Minimum tokenX to receive (slippage protection)
     * @param amountYMin Minimum tokenY to receive (slippage protection)
     * @param deadline Transaction deadline timestamp
     * @return amountX Amount of tokenX received (principal only)
     * @return amountY Amount of tokenY received (principal only)
     */
    function decreaseLiquidity(
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

        (amountX, amountY) = _decreaseLiquidity(positionId, percentage, amountXMin, amountYMin, deadline);
    }

    /**
     * @notice Remove a position entirely (100% removal with fee collection)
     * @param vault Must equal msg.sender; validator checks this in calldata
     * @param positionId The position to remove
     * @param amountXMin Minimum tokenX to receive (slippage protection)
     * @param amountYMin Minimum tokenY to receive (slippage protection)
     * @param deadline Transaction deadline timestamp
     * @return amountX Amount of tokenX received (principal only)
     * @return amountY Amount of tokenY received (principal only)
     */
    function removePosition(
        address vault,
        uint256 positionId,
        uint256 amountXMin,
        uint256 amountYMin,
        uint256 deadline
    ) external nonReentrant returns (uint256 amountX, uint256 amountY) {
        require(vault == msg.sender, "TJPositionManager: vault must be caller");
        Position storage pos = _positions[positionId];
        require(pos.vault == vault, "TJPositionManager: not position owner");
        require(pos.active, "TJPositionManager: position not active");

        (amountX, amountY) = _decreaseLiquidity(positionId, 100, amountXMin, amountYMin, deadline);
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
     * @notice Get accrued fees for a position using reserve-based accounting
     * @dev Compares current reserve share (liquidityMinted * reserve / totalSupply)
     *      against originalShare baselines to calculate per-bin fee accrual.
     * @param positionId The position ID to query
     * @return feesX Per-bin accrued tokenX fees
     * @return feesY Per-bin accrued tokenY fees
     */
    function getAccruedFees(uint256 positionId)
        external
        view
        returns (uint256[] memory feesX, uint256[] memory feesY)
    {
        return _getAccruedFees(positionId);
    }

    // ── Internal helpers ──────────────────────────────────────────────

    function _getAccruedFees(uint256 positionId)
        internal
        view
        returns (uint256[] memory feesX, uint256[] memory feesY)
    {
        Position storage pos = _positions[positionId];
        require(pos.active, "TJPositionManager: position not active");

        uint256 len = pos.depositIds.length;
        feesX = new uint256[](len);
        feesY = new uint256[](len);

        for (uint256 i = 0; i < len; i++) {
            uint256 supply = ILBPair(pos.lbPair).totalSupply(pos.depositIds[i]);
            if (supply > 0) {
                (uint128 reserveX, uint128 reserveY) = ILBPair(pos.lbPair).getBin(uint24(pos.depositIds[i]));
                uint256 currentShareX = pos.liquidityMinted[i] * uint256(reserveX) / supply;
                uint256 currentShareY = pos.liquidityMinted[i] * uint256(reserveY) / supply;

                if (currentShareX > pos.originalShareX[i]) {
                    feesX[i] = currentShareX - pos.originalShareX[i];
                }
                if (currentShareY > pos.originalShareY[i]) {
                    feesY[i] = currentShareY - pos.originalShareY[i];
                }
            }
        }
    }

    function _collectFees(uint256 positionId) internal returns (uint256 feeAmountX, uint256 feeAmountY) {
        Position storage pos = _positions[positionId];

        (uint256[] memory feesX, uint256[] memory feesY) = _getAccruedFees(positionId);

        // Convert per-bin token fees to LB tokens to burn
        uint256 len = pos.depositIds.length;
        uint256[] memory burnIds = new uint256[](len);
        uint256[] memory burnAmounts = new uint256[](len);
        uint256 count = 0;

        for (uint256 i = 0; i < len; i++) {
            if (feesX[i] == 0 && feesY[i] == 0) continue;

            uint256 supply = ILBPair(pos.lbPair).totalSupply(pos.depositIds[i]);
            if (supply == 0) continue;

            (uint128 reserveX, uint128 reserveY) = ILBPair(pos.lbPair).getBin(uint24(pos.depositIds[i]));

            // Calculate LB tokens that represent the fee value:
            // principalLb = originalShare * supply / reserve
            // feeLb = liquidityMinted - principalLb
            // Try X-side first; if it yields 0 (fees only on Y), fall back to Y-side.
            // Active bins have both reserves, so both branches may apply.
            uint256 feeLbTokens;
            if (uint256(reserveX) > 0) {
                uint256 principalLb = pos.originalShareX[i] * supply / uint256(reserveX);
                feeLbTokens = pos.liquidityMinted[i] > principalLb ? pos.liquidityMinted[i] - principalLb : 0;
            }
            if (feeLbTokens == 0 && uint256(reserveY) > 0) {
                uint256 principalLb = pos.originalShareY[i] * supply / uint256(reserveY);
                feeLbTokens = pos.liquidityMinted[i] > principalLb ? pos.liquidityMinted[i] - principalLb : 0;
            }

            if (feeLbTokens > 0) {
                burnIds[count] = pos.depositIds[i];
                burnAmounts[count] = feeLbTokens;
                count++;
            }
        }

        // No fees accrued — skip router call entirely
        if (count == 0) {
            return (0, 0);
        }

        // Trim to actual count
        uint256[] memory trimmedIds = new uint256[](count);
        uint256[] memory trimmedAmounts = new uint256[](count);
        for (uint256 i = 0; i < count; i++) {
            trimmedIds[i] = burnIds[i];
            trimmedAmounts[i] = burnAmounts[i];
        }

        ILBPair(pos.lbPair).approveForAll(lbRouter, true);

        (feeAmountX, feeAmountY) = ILBRouter(lbRouter).removeLiquidity(
            pos.tokenX,
            pos.tokenY,
            pos.binStep,
            0,
            0,
            trimmedIds,
            trimmedAmounts,
            pos.vault,
            block.timestamp
        );

        ILBPair(pos.lbPair).approveForAll(lbRouter, false);

        // Update state: reduce liquidityMinted and reset originalShare baselines
        for (uint256 i = 0; i < count; i++) {
            for (uint256 j = 0; j < pos.depositIds.length; j++) {
                if (pos.depositIds[j] == trimmedIds[i]) {
                    pos.liquidityMinted[j] -= trimmedAmounts[i];

                    // Reset baseline to current share (fees now extracted)
                    uint256 supply = ILBPair(pos.lbPair).totalSupply(pos.depositIds[j]);
                    if (supply > 0) {
                        (uint128 rX, uint128 rY) = ILBPair(pos.lbPair).getBin(uint24(pos.depositIds[j]));
                        pos.originalShareX[j] = pos.liquidityMinted[j] * uint256(rX) / supply;
                        pos.originalShareY[j] = pos.liquidityMinted[j] * uint256(rY) / supply;
                    } else {
                        pos.originalShareX[j] = 0;
                        pos.originalShareY[j] = 0;
                    }
                    break;
                }
            }
        }

        emit FeesCollected(positionId, pos.vault, pos.lbPair, feeAmountX, feeAmountY);
    }

    function _decreaseLiquidity(
        uint256 positionId,
        uint256 percentage,
        uint256 amountXMin,
        uint256 amountYMin,
        uint256 deadline
    ) internal returns (uint256 amountX, uint256 amountY) {
        Position storage pos = _positions[positionId];

        // Step 1: Collect fees first
        _collectFees(positionId);

        // Step 2: Build amounts from baseline
        uint256 len = pos.depositIds.length;
        uint256[] memory ids = new uint256[](len);
        uint256[] memory amounts = new uint256[](len);
        for (uint256 i = 0; i < len; i++) {
            ids[i] = pos.depositIds[i];
            amounts[i] = pos.liquidityMinted[i] * percentage / 100;
        }

        // Step 3: Remove principal via router
        ILBPair(pos.lbPair).approveForAll(lbRouter, true);

        (amountX, amountY) = ILBRouter(lbRouter).removeLiquidity(
            pos.tokenX,
            pos.tokenY,
            pos.binStep,
            amountXMin,
            amountYMin,
            ids,
            amounts,
            pos.vault,
            deadline
        );

        ILBPair(pos.lbPair).approveForAll(lbRouter, false);

        // Step 4: Update state — cache for event since full removal deletes struct
        address posVault = pos.vault;
        address posLbPair = pos.lbPair;

        if (percentage == 100) {
            delete _positions[positionId];
        } else {
            for (uint256 i = 0; i < len; i++) {
                pos.liquidityMinted[i] -= amounts[i];

                // Reset baseline to current share of reduced position
                uint256 supply = ILBPair(pos.lbPair).totalSupply(pos.depositIds[i]);
                if (supply > 0) {
                    (uint128 rX, uint128 rY) = ILBPair(pos.lbPair).getBin(uint24(pos.depositIds[i]));
                    pos.originalShareX[i] = pos.liquidityMinted[i] * uint256(rX) / supply;
                    pos.originalShareY[i] = pos.liquidityMinted[i] * uint256(rY) / supply;
                } else {
                    pos.originalShareX[i] = 0;
                    pos.originalShareY[i] = 0;
                }
            }
        }

        emit PositionRemoved(positionId, posVault, posLbPair, percentage, amountX, amountY);
    }
}
