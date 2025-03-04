'use client';

import React, { useEffect, useState } from "react";
import { Row, Col } from "react-bootstrap";
import { useSelector, useDispatch } from "react-redux";
import PositionCard from "./PositionCard";
import { ethers } from "ethers";
import config from "../utils/config";
import { setPositions } from "../redux/positionsSlice";
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
        const poolMap = new Map(); // Map to store unique pool addresses and their indices

        for (let i = 0; i < balance; i++) {
          const tokenId = await positionManager.tokenOfOwnerByIndex(address, i);
          const positionId = String(tokenId);

          const positionData = await positionManager.positions(tokenId);
          const { token0, token1, fee, tickLower, tickUpper, liquidity } = positionData;

          // Fetch token details for Token instances
          const token0Contract = new ethers.Contract(token0, ERC20ABI.abi, provider);
          const token1Contract = new ethers.Contract(token1, ERC20ABI.abi, provider);

          let decimals0, symbol0, decimals1, symbol1;
          try {
            [decimals0, symbol0] = await Promise.all([
              token0Contract.decimals(),
              token0Contract.symbol(),
            ]);
            decimals0 = Number(decimals0.toString());
          } catch (err) {
            setError("Error retrieving token data. Please try again or check your connection.");
            return;
          }
          try {
            [decimals1, symbol1] = await Promise.all([
              token1Contract.decimals(),
              token1Contract.symbol(),
            ]);
            decimals1 = Number(decimals1.toString());
          } catch (err) {
            setError("Error retrieving token data. Please try again or check your connection.");
            return;
          }

          // Create Token instances
          const token0Instance = new Token(chainId, token0, decimals0, symbol0);
          const token1Instance = new Token(chainId, token1, decimals1, symbol1);

          const tokenPair = `${symbol0}/${symbol1}`;

          // Get pool address
          const feeNumber = Number(fee.toString());
          const poolAddress = Pool.getAddress(token0Instance, token1Instance, feeNumber);
          positionsData.push({
            id: positionId,
            tokenPair,
            poolAddress, // Store pool address for later tick assignment
            tickLower: Number(tickLower.toString()),
            tickUpper: Number(tickUpper.toString()),
            liquidity: Number(liquidity.toString()),
          });
          poolMap.set(poolAddress, (poolMap.get(poolAddress) || []).concat(positionsData.length - 1));
        }

        // Batch fetch slot0 for unique pools
        const uniquePoolAddresses = Array.from(poolMap.keys());
        const poolContracts = uniquePoolAddresses.map((address) =>
          new ethers.Contract(address, IUniswapV3PoolABI.abi, provider)
        );
        const slot0Promises = poolContracts.map((contract) => contract.slot0());
        const slot0Results = await Promise.all(slot0Promises);
        const tickMap = new Map(
          uniquePoolAddresses.map((address, index) => [address, Number(slot0Results[index].tick)])
        );

        // Assign current tick to each position
        positionsData.forEach((pos, index) => {
          const currentTick = tickMap.get(pos.poolAddress);
          const status = pos.liquidity > 0 ? "open" : "closed";
          const active = pos.liquidity > 0 && currentTick >= pos.tickLower && currentTick <= pos.tickUpper ? "in-range" : "out-of-range";
          positionsData[index] = {
            ...pos,
            status,
            active,
            currentTick,
          };
        });

        setLocalPositions(positionsData);
        dispatch(setPositions(positionsData));
      } catch (error) {
        setError("Error fetching positions. Please try again or check your connection.");
        setLocalPositions([]);
        dispatch(setPositions([]));
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
          {positions.filter((pos) => pos.status === "open").map((pos) => (
            <Col md={6} key={pos.id}>
              <PositionCard position={pos} />
            </Col>
          ))}
        </Row>
      )}
    </div>
  );
}
