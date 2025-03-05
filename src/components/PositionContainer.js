'use client';

import React, { useEffect, useState } from "react";
import { Row, Col } from "react-bootstrap";
import { useSelector, useDispatch } from "react-redux";
import PositionCard from "./PositionCard";
import { ethers } from "ethers";
import config from "../utils/config";
import { setPositions } from "../redux/positionsSlice";
import { setPools, clearPools } from "../redux/poolSlice";
import { setTokens, clearTokens } from "../redux/tokensSlice";
import nonfungiblePositionManagerABI from "@uniswap/v3-periphery/artifacts/contracts/NonfungiblePositionManager.sol/NonfungiblePositionManager.json" assert { type: "json" };
import ERC20ABI from "@openzeppelin/contracts/build/contracts/ERC20.json" assert { type: "json" };
import IUniswapV3PoolABI from "@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Pool.sol/IUniswapV3Pool.json" assert { type: "json" };
import { Pool } from "@uniswap/v3-sdk";
import { Token } from "@uniswap/sdk-core";

export default function PositionContainer({ provider }) {
  const dispatch = useDispatch();
  const { isConnected, address, chainId } = useSelector((state) => state.wallet);
  const [positions, setLocalPositions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!isConnected || !address || !provider || !chainId) {
      setLocalPositions([]);
      dispatch(setPositions([]));
      dispatch(clearPools());
      dispatch(clearTokens());
      setError(null);
      return;
    }

    const fetchPositions = async () => {
      setLoading(true);
      setError(null);
      try {
        const positionManagerAddress = config.chains.arbitrum.platforms.uniswapV3.positionManagerAddress;
        const positionManager = new ethers.Contract(
          positionManagerAddress,
          nonfungiblePositionManagerABI.abi,
          provider
        );

        const balance = await positionManager.balanceOf(address);
        const positionsData = [];
        const poolData = {};
        const tokenData = {};

        console.log("Pool ABI:", IUniswapV3PoolABI.abi);

        for (let i = 0; i < balance; i++) {
          const tokenId = await positionManager.tokenOfOwnerByIndex(address, i);
          const positionId = String(tokenId);

          const positionData = await positionManager.positions(tokenId);
          const { nonce, operator, token0, token1, fee, tickLower, tickUpper, liquidity, feeGrowthInside0LastX128, feeGrowthInside1LastX128, tokensOwed0, tokensOwed1 } = positionData;

          // Fetch token details for Token instances
          const token0Contract = new ethers.Contract(token0, ERC20ABI.abi, provider);
          const token1Contract = new ethers.Contract(token1, ERC20ABI.abi, provider);

          let decimals0, name0, symbol0, balance0, decimals1, name1, symbol1, balance1;
          try {
            [decimals0, name0, symbol0, balance0] = await Promise.all([
              token0Contract.decimals(),
              token0Contract.name(),
              token0Contract.symbol(),
              token0Contract.balanceOf(address), // User's balance for token0
            ]);
            decimals0 = Number(decimals0.toString());
            balance0 = Number(balance0.toString());
          } catch (err) {
            setError("Error retrieving token0 data. Please try again or check your connection.");
            return;
          }
          try {
            [decimals1, name1, symbol1, balance1] = await Promise.all([
              token1Contract.decimals(),
              token1Contract.name(),
              token1Contract.symbol(),
              token1Contract.balanceOf(address), // User's balance for token1
            ]);
            decimals1 = Number(decimals1.toString());
            balance1 = Number(balance1.toString());
          } catch (err) {
            setError("Error retrieving token1 data. Please try again or check your connection.");
            return;
          }

          // Populate tokenData with balance
          if (!tokenData[token0]) {
            tokenData[token0] = { address: token0, decimals: decimals0, symbol: symbol0, name: name0, balance: balance0 };
          }
          if (!tokenData[token1]) {
            tokenData[token1] = { address: token1, decimals: decimals1, symbol: symbol1, name: name1, balance: balance1 };
          }

          // Create Token instances
          const token0Instance = new Token(chainId, token0, decimals0, symbol0);
          const token1Instance = new Token(chainId, token1, decimals1, symbol1);

          const tokenPair = `${symbol0}/${symbol1}`;

          // Get pool address
          const feeNumber = Number(fee.toString());
          const poolAddress = Pool.getAddress(token0Instance, token1Instance, feeNumber);

          // Position data (without token0, token1)
          positionsData.push({
            id: positionId,
            tokenPair,
            poolAddress,
            nonce: Number(nonce.toString()),
            operator,
            fee: feeNumber,
            tickLower: Number(tickLower.toString()),
            tickUpper: Number(tickUpper.toString()),
            liquidity: Number(liquidity.toString()),
            feeGrowthInside0LastX128: feeGrowthInside0LastX128.toString(),
            feeGrowthInside1LastX128: feeGrowthInside1LastX128.toString(),
            tokensOwed0: Number(tokensOwed0.toString()),
            tokensOwed1: Number(tokensOwed1.toString()),
          });

          // Pool data (only if not already set)
          if (!poolData[poolAddress]) {
            const poolContract = new ethers.Contract(poolAddress, IUniswapV3PoolABI.abi, provider);
            try {
              const slot0 = await poolContract.slot0();
              console.log("slot0 data:", { slot0 });
              const observationIndex = Number(slot0[2].toString());
              const lastObservation = await poolContract.observations(observationIndex);
              const protocolFees = await poolContract.protocolFees();
              poolData[poolAddress] = {
                poolAddress,
                token0,
                token1,
                sqrtPriceX96: slot0[0].toString(),
                tick: Number(slot0[1].toString()),
                observationIndex: Number(slot0[2].toString()),
                observationCardinality: Number(slot0[3].toString()),
                observationCardinalityNext: Number(slot0[4].toString()),
                feeProtocol: Number(slot0[5].toString()),
                unlocked: slot0[6],
                liquidity: (await poolContract.liquidity()).toString(),
                feeGrowthGlobal0X128: (await poolContract.feeGrowthGlobal0X128()).toString(),
                feeGrowthGlobal1X128: (await poolContract.feeGrowthGlobal1X128()).toString(),
                protocolFeeToken0: protocolFees[0].toString(),
                protocolFeeToken1: protocolFees[1].toString(),
                tickSpacing: Number((await poolContract.tickSpacing()).toString()),
                fee: Number((await poolContract.fee()).toString()),
                maxLiquidityPerTick: (await poolContract.maxLiquidityPerTick()).toString(),
                lastObservation: {
                  blockTimestamp: Number(lastObservation.blockTimestamp.toString()),
                  tickCumulative: lastObservation.tickCumulative.toString(),
                  secondsPerLiquidityCumulativeX128: lastObservation.secondsPerLiquidityCumulativeX128.toString(),
                  initialized: lastObservation.initialized,
                },
              };
            } catch (slot0Error) {
              console.error(`Failed to fetch slot0 or pool data for pool ${poolAddress}:`, { slot0Error });
              poolData[poolAddress] = { poolAddress }; // Minimal data on failure
            }
          }
        }

        setLocalPositions(positionsData);
        dispatch(setPositions(positionsData));
        dispatch(setPools(poolData));
        dispatch(setTokens(tokenData));
      } catch (error) {
        setError("Error fetching positions. Please try again or check your connection.");
        setLocalPositions([]);
        dispatch(setPositions([]));
        // Do not clear pools or tokens on partial error—only on disconnect
      } finally {
        setLoading(false);
      }
    };

    fetchPositions();
  }, [isConnected, address, provider, chainId, dispatch]);

  return (
    <div>
      {loading ? (
        <p>Loading positions...</p>
      ) : error ? (
        <p style={{ color: "red" }}>{error}</p>
      ) : (
        <Row>
          {positions.filter((pos) => pos.liquidity > 0).map((pos) => (
            <Col md={6} key={pos.id}>
              <PositionCard position={pos} />
            </Col>
          ))}
        </Row>
      )}
    </div>
  );
}
