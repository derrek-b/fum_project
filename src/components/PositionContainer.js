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

export default function PositionContainer({ provider }) {
  const dispatch = useDispatch();
  const { isConnected, address, chainId } = useSelector((state) => state.wallet);
  const [positions, setLocalPositions] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isConnected || !address || !provider || !chainId) {
      console.log("Clearing positions due to disconnection");
      setLocalPositions([]);
      dispatch(setPositions([]));
      return;
    }

    const fetchPositions = async () => {
      setLoading(true);
      try {
        const positionManagerAddress = config.chains.arbitrum.platforms.uniswapV3.positionManagerAddress;
        const positionManager = new ethers.Contract(
          positionManagerAddress,
          nonfungiblePositionManagerABI.abi,
          provider
        );

        const balance = await positionManager.balanceOf(address);
        const positionsData = [];

        for (let i = 0; i < balance; i++) {
          const tokenId = await positionManager.tokenOfOwnerByIndex(address, i);
          const positionId = String(tokenId);

          const positionData = await positionManager.positions(tokenId);
          const { token0, token1 } = positionData;
          console.log('positionData', positionData)

          const token0Contract = new ethers.Contract(token0, ERC20ABI.abi, provider);
          const token1Contract = new ethers.Contract(token1, ERC20ABI.abi, provider);

          let symbol0, symbol1;
          try {
            symbol0 = await token0Contract.symbol();
          } catch (err) {
            console.error(`Failed to fetch symbol for token0 (${token0}):`, err);
            symbol0 = "UNKNOWN";
          }
          try {
            symbol1 = await token1Contract.symbol();
          } catch (err) {
            console.error(`Failed to fetch symbol for token1 (${token1}):`, err);
            symbol1 = "UNKNOWN";
          }

          const tokenPair = `${symbol0}/${symbol1}`;

          positionsData.push({
            id: positionId,
            tokenPair,
          });
        }

        console.log("Fetched positionsData:", positionsData); // Debug log
        setLocalPositions(positionsData);
        dispatch(setPositions(positionsData)); // Dispatch after setting local state
      } catch (error) {
        console.error("Failed to fetch Uniswap V3 positions:", error);
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
      ) : (
        <Row>
          {positions.map((pos) => (
            <Col md={6} key={pos.id}>
              <PositionCard position={pos} />
            </Col>
          ))}
        </Row>
      )}
    </div>
  );
}
