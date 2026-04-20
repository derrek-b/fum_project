// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/proxy/Clones.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/ILBPair.sol";
import "./interfaces/ILBRouter.sol";

interface ITJPositionProxy {
    function initialize(address _manager) external;
    function execute(address to, bytes calldata data) external returns (bytes memory);
}

/**
 * @title TJPositionManager
 * @notice Position manager for Trader Joe V2.2 Liquidity Book positions
 * @dev Each position gets an EIP-1167 minimal proxy that holds the ERC1155 LB tokens,
 *      enabling per-position fee attribution. Fee math is computed off-chain via
 *      LiquidityHelperContract and passed in as feeShares/previousFees parameters.
 *
 *      This contract is called by PositionVault after validation by
 *      TJPositionValidator via VaultFactory.
 *
 *      Auth model:
 *      - createPosition: takes owner as param (no existing position), checks owner == msg.sender
 *      - addToPosition, collectFees, decreaseLiquidity, removePosition: no owner param,
 *        checks pos.owner == msg.sender (ownership from stored position state)
 *
 *      Flow (createPosition):
 *        Vault.mint(target=TJPositionManager, data=createPosition(...))
 *          -> VaultFactory.validateMint(TJPositionManager, calldata, vault)
 *            -> TJPositionValidator.validateMint(calldata, vault) [selector + owner check]
 *          -> TJPositionManager.createPosition() executes
 *            1. Verify msg.sender == owner param
 *            2. Deploy proxy via Clones.clone(), initialize
 *            3. Pull tokens from owner → manager → proxy
 *            4. Via proxy: approve LBRouter, call addLiquidity(to=proxy, refundTo=owner)
 *            5. Record position (ID, owner, proxy, lbPair, depositIds, liquidityMinted)
 *            6. Via proxy: reset approvals, sweep leftover tokens to owner
 *            7. Emit PositionCreated event
 */
contract TJPositionManager is ReentrancyGuard {
    // Version information
    string public constant VERSION = "2.0.0";

    using SafeERC20 for IERC20;

    struct Position {
        address owner;
        address lbPair;
        address tokenX;
        address tokenY;
        address proxy;
        uint16 binStep;
        uint256[] depositIds;
        uint256[] liquidityMinted;
        uint256[] previousX;
        uint256[] previousY;
        uint256 createdAt;
        bool active;
    }

    address public immutable lbRouter;
    address public immutable proxyImplementation;
    uint256 private _nextPositionId = 1;
    mapping(uint256 => Position) private _positions;
    mapping(address => uint256[]) private _ownerPositions;

    event PositionCreated(
        uint256 indexed positionId,
        address indexed owner,
        address indexed lbPair,
        address proxy,
        uint256[] depositIds,
        uint256[] liquidityMinted,
        uint256 amountXAdded,
        uint256 amountYAdded
    );

    event PositionRemoved(
        uint256 indexed positionId,
        address indexed owner,
        address indexed lbPair,
        uint256 percentage,
        uint256 amountX,
        uint256 amountY
    );

    event PositionIncreased(
        uint256 indexed positionId,
        address indexed owner,
        address indexed lbPair,
        uint256 amountXAdded,
        uint256 amountYAdded
    );

    event FeesCollected(
        uint256 indexed positionId,
        address indexed owner,
        address indexed lbPair,
        uint256 amountX,
        uint256 amountY
    );

    event PositionTransferred(
        uint256 indexed positionId,
        address indexed from,
        address indexed to
    );

    constructor(address _lbRouter, address _proxyImplementation) {
        require(_lbRouter != address(0), "TJPositionManager: zero router");
        require(_proxyImplementation != address(0), "TJPositionManager: zero proxy impl");
        lbRouter = _lbRouter;
        proxyImplementation = _proxyImplementation;
    }

    /**
     * @notice Create a new liquidity position on a Trader Joe V2.2 LB pair
     * @param owner Must equal msg.sender; validator checks this in calldata
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
        address owner,
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
        require(owner == msg.sender, "TJPositionManager: owner must be caller");
        require(lbPair != address(0), "TJPositionManager: zero lbPair");

        // Derive token info from pair
        address tokenX = ILBPair(lbPair).getTokenX();
        address tokenY = ILBPair(lbPair).getTokenY();
        uint16 binStep = ILBPair(lbPair).getBinStep();

        // Deploy and initialize proxy
        address proxy = Clones.clone(proxyImplementation);
        ITJPositionProxy(proxy).initialize(address(this));

        // Pull tokens from owner → manager → proxy
        IERC20(tokenX).safeTransferFrom(owner, address(this), amountX);
        IERC20(tokenY).safeTransferFrom(owner, address(this), amountY);
        IERC20(tokenX).safeTransfer(proxy, amountX);
        IERC20(tokenY).safeTransfer(proxy, amountY);

        // Via proxy: approve LBRouter for token amounts
        ITJPositionProxy(proxy).execute(
            tokenX,
            abi.encodeWithSelector(IERC20.approve.selector, lbRouter, amountX)
        );
        ITJPositionProxy(proxy).execute(
            tokenY,
            abi.encodeWithSelector(IERC20.approve.selector, lbRouter, amountY)
        );

        // Via proxy: call addLiquidity (LB tokens minted to proxy, refund to owner)
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
            to: proxy,
            refundTo: owner,
            deadline: deadline
        });

        bytes memory returnData = ITJPositionProxy(proxy).execute(
            lbRouter,
            abi.encodeWithSelector(ILBRouter.addLiquidity.selector, params)
        );

        (uint256 amountXAdded, uint256 amountYAdded,,,uint256[] memory depositedIds, uint256[] memory liquidityAmounts)
            = abi.decode(returnData, (uint256, uint256, uint256, uint256, uint256[], uint256[]));

        // Via proxy: reset approvals
        ITJPositionProxy(proxy).execute(
            tokenX,
            abi.encodeWithSelector(IERC20.approve.selector, lbRouter, 0)
        );
        ITJPositionProxy(proxy).execute(
            tokenY,
            abi.encodeWithSelector(IERC20.approve.selector, lbRouter, 0)
        );

        // Belt-and-suspenders: sweep leftover tokens from proxy to owner
        _sweepProxyTokens(proxy, tokenX, owner);
        _sweepProxyTokens(proxy, tokenY, owner);

        // Calculate baselines (previousX/Y)
        uint256 len = depositedIds.length;
        uint256[] memory prevX = new uint256[](len);
        uint256[] memory prevY = new uint256[](len);
        for (uint256 i = 0; i < len; i++) {
            uint256 supply = ILBPair(lbPair).totalSupply(depositedIds[i]);
            if (supply > 0) {
                (uint128 reserveX, uint128 reserveY) = ILBPair(lbPair).getBin(uint24(depositedIds[i]));
                prevX[i] = liquidityAmounts[i] * uint256(reserveX) / supply;
                prevY[i] = liquidityAmounts[i] * uint256(reserveY) / supply;
            }
        }

        // Record position
        positionId = _nextPositionId++;
        _positions[positionId] = Position({
            owner: owner,
            lbPair: lbPair,
            tokenX: tokenX,
            tokenY: tokenY,
            proxy: proxy,
            binStep: binStep,
            depositIds: depositedIds,
            liquidityMinted: liquidityAmounts,
            previousX: prevX,
            previousY: prevY,
            createdAt: block.timestamp,
            active: true
        });
        _ownerPositions[owner].push(positionId);

        emit PositionCreated(positionId, owner, lbPair, proxy, depositedIds, liquidityAmounts, amountXAdded, amountYAdded);
    }

    /**
     * @notice Add liquidity to an existing position
     * @param positionId The position to add liquidity to
     * @param previousFeesX Known per-bin fee amounts for tokenX (from LiquidityHelperContract)
     * @param previousFeesY Known per-bin fee amounts for tokenY (from LiquidityHelperContract)
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
        uint256 positionId,
        uint256[] calldata previousFeesX,
        uint256[] calldata previousFeesY,
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
        Position storage pos = _positions[positionId];
        require(pos.owner == msg.sender, "TJPositionManager: not position owner");
        require(pos.active, "TJPositionManager: position not active");
        require(previousFeesX.length == pos.depositIds.length, "TJPositionManager: feesX length mismatch");
        require(previousFeesY.length == pos.depositIds.length, "TJPositionManager: feesY length mismatch");

        address tokenX = pos.tokenX;
        address tokenY = pos.tokenY;
        address proxy = pos.proxy;

        // Pull tokens from owner → manager → proxy
        IERC20(tokenX).safeTransferFrom(msg.sender, address(this), amountX);
        IERC20(tokenY).safeTransferFrom(msg.sender, address(this), amountY);
        IERC20(tokenX).safeTransfer(proxy, amountX);
        IERC20(tokenY).safeTransfer(proxy, amountY);

        // Via proxy: approve LBRouter
        ITJPositionProxy(proxy).execute(
            tokenX,
            abi.encodeWithSelector(IERC20.approve.selector, lbRouter, amountX)
        );
        ITJPositionProxy(proxy).execute(
            tokenY,
            abi.encodeWithSelector(IERC20.approve.selector, lbRouter, amountY)
        );

        // Via proxy: call addLiquidity (LB tokens minted to proxy, refund to owner)
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
            to: proxy,
            refundTo: msg.sender,
            deadline: deadline
        });

        bytes memory returnData = ITJPositionProxy(proxy).execute(
            lbRouter,
            abi.encodeWithSelector(ILBRouter.addLiquidity.selector, params)
        );

        uint256[] memory depositedIds;
        uint256[] memory liquidityAmounts;
        (amountXAdded, amountYAdded,,,depositedIds, liquidityAmounts)
            = abi.decode(returnData, (uint256, uint256, uint256, uint256, uint256[], uint256[]));

        // Update liquidityMinted — reject any bins not already in the position
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

        // Fee-aware baseline reset: previousX[i] = currentX - previousFeesX[i]
        for (uint256 i = 0; i < pos.depositIds.length; i++) {
            uint256 supply = ILBPair(pos.lbPair).totalSupply(pos.depositIds[i]);
            if (supply > 0) {
                (uint128 rX, uint128 rY) = ILBPair(pos.lbPair).getBin(uint24(pos.depositIds[i]));
                uint256 currentX = pos.liquidityMinted[i] * uint256(rX) / supply;
                uint256 currentY = pos.liquidityMinted[i] * uint256(rY) / supply;
                pos.previousX[i] = currentX - previousFeesX[i];
                pos.previousY[i] = currentY - previousFeesY[i];
            }
        }

        // Via proxy: reset approvals
        ITJPositionProxy(proxy).execute(
            tokenX,
            abi.encodeWithSelector(IERC20.approve.selector, lbRouter, 0)
        );
        ITJPositionProxy(proxy).execute(
            tokenY,
            abi.encodeWithSelector(IERC20.approve.selector, lbRouter, 0)
        );

        // Belt-and-suspenders: sweep leftover tokens from proxy to owner
        _sweepProxyTokens(proxy, tokenX, msg.sender);
        _sweepProxyTokens(proxy, tokenY, msg.sender);

        emit PositionIncreased(positionId, msg.sender, pos.lbPair, amountXAdded, amountYAdded);
    }

    /**
     * @notice Collect accrued fees from a position
     * @param positionId The position to collect fees from
     * @param feeShares Per-bin LB token amounts to burn for fee collection (from LiquidityHelperContract)
     * @param amountXMin Minimum tokenX to receive (slippage protection)
     * @param amountYMin Minimum tokenY to receive (slippage protection)
     * @param deadline Transaction deadline timestamp
     * @return amountX Amount of tokenX fees collected
     * @return amountY Amount of tokenY fees collected
     */
    function collectFees(
        uint256 positionId,
        uint256[] calldata feeShares,
        uint256 amountXMin,
        uint256 amountYMin,
        uint256 deadline
    ) external nonReentrant returns (uint256 amountX, uint256 amountY) {
        Position storage pos = _positions[positionId];
        require(pos.owner == msg.sender, "TJPositionManager: not position owner");
        require(pos.active, "TJPositionManager: position not active");

        (amountX, amountY) = _burnFeesViaProxy(positionId, feeShares, amountXMin, amountYMin, deadline);
    }

    /**
     * @notice Decrease liquidity from an existing position (partial or full)
     * @param positionId The position to remove liquidity from
     * @param percentage Percentage of baseline liquidity to remove (1-100)
     * @param feeShares Per-bin LB token amounts to burn for fee collection (from LiquidityHelperContract)
     * @param amountXMin Minimum tokenX to receive (slippage protection, covers fees + principal)
     * @param amountYMin Minimum tokenY to receive (slippage protection, covers fees + principal)
     * @param deadline Transaction deadline timestamp
     * @return amountX Amount of tokenX received (principal only)
     * @return amountY Amount of tokenY received (principal only)
     */
    function decreaseLiquidity(
        uint256 positionId,
        uint256 percentage,
        uint256[] calldata feeShares,
        uint256 amountXMin,
        uint256 amountYMin,
        uint256 deadline
    ) external nonReentrant returns (uint256 amountX, uint256 amountY) {
        Position storage pos = _positions[positionId];
        require(pos.owner == msg.sender, "TJPositionManager: not position owner");
        require(pos.active, "TJPositionManager: position not active");
        require(percentage > 0 && percentage <= 100, "TJPositionManager: invalid percentage");

        (amountX, amountY) = _decreaseLiquidityWithFees(positionId, percentage, feeShares, amountXMin, amountYMin, deadline);
    }

    /**
     * @notice Remove a position entirely (100% removal with fee collection)
     * @param positionId The position to remove
     * @param feeShares Per-bin LB token amounts to burn for fee collection (from LiquidityHelperContract)
     * @param amountXMin Minimum tokenX to receive (slippage protection, covers fees + principal)
     * @param amountYMin Minimum tokenY to receive (slippage protection, covers fees + principal)
     * @param deadline Transaction deadline timestamp
     * @return amountX Amount of tokenX received (principal only)
     * @return amountY Amount of tokenY received (principal only)
     */
    function removePosition(
        uint256 positionId,
        uint256[] calldata feeShares,
        uint256 amountXMin,
        uint256 amountYMin,
        uint256 deadline
    ) external nonReentrant returns (uint256 amountX, uint256 amountY) {
        Position storage pos = _positions[positionId];
        require(pos.owner == msg.sender, "TJPositionManager: not position owner");
        require(pos.active, "TJPositionManager: position not active");

        (amountX, amountY) = _decreaseLiquidityWithFees(positionId, 100, feeShares, amountXMin, amountYMin, deadline);
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
     * @notice Get all position IDs for an owner
     * @param owner The owner address to query
     * @return Array of position IDs
     */
    function getPositionsByOwner(address owner) external view returns (uint256[] memory) {
        return _ownerPositions[owner];
    }

    /**
     * @notice Get the number of positions for an owner
     * @param owner The owner address to query
     * @return The number of positions
     */
    function getPositionCount(address owner) external view returns (uint256) {
        return _ownerPositions[owner].length;
    }

    /**
     * @notice Transfer position ownership (ERC721-compatible signature)
     * @dev Called by PositionVault.withdrawPosition which does IERC721(target).safeTransferFrom(vault, owner, tokenId).
     *      This allows TJ positions to be withdrawn from vaults using the same code path as V3/V4 NFTs.
     * @param from Current owner (must equal pos.owner and msg.sender)
     * @param to New owner
     * @param tokenId The position ID to transfer
     */
    function safeTransferFrom(address from, address to, uint256 tokenId) external nonReentrant {
        Position storage pos = _positions[tokenId];
        require(pos.active, "TJPositionManager: position not active");
        require(pos.owner == from, "TJPositionManager: not position owner");
        require(from == msg.sender, "TJPositionManager: caller must be current owner");
        require(to != address(0), "TJPositionManager: transfer to zero address");

        pos.owner = to;
        _removeFromOwnerPositions(from, tokenId);
        _ownerPositions[to].push(tokenId);

        emit PositionTransferred(tokenId, from, to);
    }

    // ── Internal helpers ──────────────────────────────────────────────

    /**
     * @dev Remove a position ID from an owner's position array (swap-and-pop).
     * @param owner The owner address to remove from
     * @param positionId The position ID to remove
     */
    function _removeFromOwnerPositions(address owner, uint256 positionId) internal {
        uint256[] storage ids = _ownerPositions[owner];
        for (uint256 i = 0; i < ids.length; i++) {
            if (ids[i] == positionId) {
                ids[i] = ids[ids.length - 1];
                ids.pop();
                return;
            }
        }
    }

    /**
     * @dev Burns fee LB tokens via the position's proxy. No-op if all feeShares are zero.
     * @param positionId The position to collect fees from
     * @param feeShares Per-bin LB token amounts to burn
     * @param amountXMin Minimum tokenX to receive
     * @param amountYMin Minimum tokenY to receive
     * @param deadline Transaction deadline timestamp
     * @return feeAmountX Total tokenX fees collected
     * @return feeAmountY Total tokenY fees collected
     */
    function _burnFeesViaProxy(
        uint256 positionId,
        uint256[] calldata feeShares,
        uint256 amountXMin,
        uint256 amountYMin,
        uint256 deadline
    ) internal returns (uint256 feeAmountX, uint256 feeAmountY) {
        Position storage pos = _positions[positionId];
        require(feeShares.length == pos.depositIds.length, "TJPositionManager: feeShares length mismatch");

        // Filter to non-zero entries only (LBPair reverts on zero amounts)
        uint256[] memory allIds = pos.depositIds;
        (uint256[] memory filteredIds, uint256[] memory filteredShares) = _filterNonZero(allIds, feeShares);
        if (filteredIds.length == 0) {
            return (0, 0);
        }

        address proxy = pos.proxy;

        // Via proxy: approveForAll
        ITJPositionProxy(proxy).execute(
            pos.lbPair,
            abi.encodeWithSelector(ILBPair.approveForAll.selector, lbRouter, true)
        );

        // Via proxy: removeLiquidity (fee burn, tokens to owner)
        bytes memory returnData = ITJPositionProxy(proxy).execute(
            lbRouter,
            abi.encodeWithSelector(
                ILBRouter.removeLiquidity.selector,
                pos.tokenX,
                pos.tokenY,
                pos.binStep,
                amountXMin,
                amountYMin,
                filteredIds,
                filteredShares,
                pos.owner,
                deadline
            )
        );

        (feeAmountX, feeAmountY) = abi.decode(returnData, (uint256, uint256));

        // Via proxy: revoke approval
        ITJPositionProxy(proxy).execute(
            pos.lbPair,
            abi.encodeWithSelector(ILBPair.approveForAll.selector, lbRouter, false)
        );

        // Update state: reduce liquidityMinted and reset baselines
        for (uint256 i = 0; i < pos.depositIds.length; i++) {
            pos.liquidityMinted[i] -= feeShares[i];

            uint256 supply = ILBPair(pos.lbPair).totalSupply(pos.depositIds[i]);
            if (supply > 0) {
                (uint128 rX, uint128 rY) = ILBPair(pos.lbPair).getBin(uint24(pos.depositIds[i]));
                pos.previousX[i] = pos.liquidityMinted[i] * uint256(rX) / supply;
                pos.previousY[i] = pos.liquidityMinted[i] * uint256(rY) / supply;
            } else {
                pos.previousX[i] = 0;
                pos.previousY[i] = 0;
            }
        }

        emit FeesCollected(positionId, pos.owner, pos.lbPair, feeAmountX, feeAmountY);
    }

    /**
     * @dev Two-step liquidity removal: fee burn (Step A) then principal burn (Step B).
     *      Combined slippage check across both burns.
     * @param positionId The position to decrease
     * @param percentage Percentage of principal to remove (1-100)
     * @param feeShares Per-bin LB token amounts to burn for fees
     * @param amountXMin Minimum total tokenX (fees + principal) to receive
     * @param amountYMin Minimum total tokenY (fees + principal) to receive
     * @param deadline Transaction deadline timestamp
     * @return principalAmountX Total tokenX from principal burn
     * @return principalAmountY Total tokenY from principal burn
     */
    function _decreaseLiquidityWithFees(
        uint256 positionId,
        uint256 percentage,
        uint256[] calldata feeShares,
        uint256 amountXMin,
        uint256 amountYMin,
        uint256 deadline
    ) internal returns (uint256 principalAmountX, uint256 principalAmountY) {
        Position storage pos = _positions[positionId];

        // Step A: Fee burn (pass 0,0 for per-step mins, check combined at end)
        (uint256 feeAmountX, uint256 feeAmountY) = _burnFeesViaProxy(positionId, feeShares, 0, 0, deadline);

        // Step B: Principal burn
        uint256 len = pos.depositIds.length;
        uint256[] memory principalBurn = new uint256[](len);
        for (uint256 i = 0; i < len; i++) {
            principalBurn[i] = pos.liquidityMinted[i] * percentage / 100;
        }

        // Filter to non-zero entries (LBPair reverts on zero amounts)
        uint256[] memory allIds = pos.depositIds;
        (uint256[] memory filteredIds, uint256[] memory filteredBurn) = _filterNonZero(allIds, principalBurn);

        if (filteredIds.length > 0) {
            address proxy = pos.proxy;

            // Via proxy: approveForAll
            ITJPositionProxy(proxy).execute(
                pos.lbPair,
                abi.encodeWithSelector(ILBPair.approveForAll.selector, lbRouter, true)
            );

            // Via proxy: removeLiquidity (principal burn, tokens to owner)
            bytes memory returnData = ITJPositionProxy(proxy).execute(
                lbRouter,
                abi.encodeWithSelector(
                    ILBRouter.removeLiquidity.selector,
                    pos.tokenX,
                    pos.tokenY,
                    pos.binStep,
                    0,
                    0,
                    filteredIds,
                    filteredBurn,
                    pos.owner,
                    deadline
                )
            );

            (principalAmountX, principalAmountY) = abi.decode(returnData, (uint256, uint256));

            // Via proxy: revoke approval
            ITJPositionProxy(proxy).execute(
                pos.lbPair,
                abi.encodeWithSelector(ILBPair.approveForAll.selector, lbRouter, false)
            );
        }

        // Combined slippage check
        require(feeAmountX + principalAmountX >= amountXMin, "TJPositionManager: insufficient amountX");
        require(feeAmountY + principalAmountY >= amountYMin, "TJPositionManager: insufficient amountY");

        // Update state — cache for event since full removal deletes struct
        address posOwner = pos.owner;
        address posLbPair = pos.lbPair;

        if (percentage == 100) {
            delete _positions[positionId];
        } else {
            for (uint256 i = 0; i < len; i++) {
                pos.liquidityMinted[i] -= principalBurn[i];

                uint256 supply = ILBPair(pos.lbPair).totalSupply(pos.depositIds[i]);
                if (supply > 0) {
                    (uint128 rX, uint128 rY) = ILBPair(pos.lbPair).getBin(uint24(pos.depositIds[i]));
                    pos.previousX[i] = pos.liquidityMinted[i] * uint256(rX) / supply;
                    pos.previousY[i] = pos.liquidityMinted[i] * uint256(rY) / supply;
                } else {
                    pos.previousX[i] = 0;
                    pos.previousY[i] = 0;
                }
            }
        }

        emit PositionRemoved(positionId, posOwner, posLbPair, percentage, principalAmountX, principalAmountY);
    }

    /**
     * @dev Sweep leftover ERC20 tokens from proxy to owner.
     *      Uses proxy.execute() to call balanceOf then transfer if non-zero.
     * @param proxy The proxy address to sweep from
     * @param token The ERC20 token to sweep
     * @param recipient The address to receive swept tokens
     */
    function _sweepProxyTokens(address proxy, address token, address recipient) internal {
        bytes memory balData = ITJPositionProxy(proxy).execute(
            token,
            abi.encodeWithSelector(IERC20.balanceOf.selector, proxy)
        );
        uint256 balance = abi.decode(balData, (uint256));
        if (balance > 0) {
            ITJPositionProxy(proxy).execute(
                token,
                abi.encodeWithSelector(IERC20.transfer.selector, recipient, balance)
            );
        }
    }

    /**
     * @dev Filter parallel arrays to only include entries where amounts[i] > 0.
     *      LBPair.burn reverts on zero amounts (LBPair__ZeroAmount), so we must
     *      exclude zero-amount bins before calling removeLiquidity.
     */
    function _filterNonZero(
        uint256[] memory ids,
        uint256[] memory amounts
    ) internal pure returns (uint256[] memory, uint256[] memory) {
        uint256 count = 0;
        for (uint256 i = 0; i < amounts.length; i++) {
            if (amounts[i] > 0) count++;
        }
        uint256[] memory filteredIds = new uint256[](count);
        uint256[] memory filteredAmounts = new uint256[](count);
        uint256 idx = 0;
        for (uint256 i = 0; i < amounts.length; i++) {
            if (amounts[i] > 0) {
                filteredIds[idx] = ids[i];
                filteredAmounts[idx] = amounts[i];
                idx++;
            }
        }
        return (filteredIds, filteredAmounts);
    }
}
