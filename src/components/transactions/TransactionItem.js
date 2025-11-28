// components/transactions/TransactionItem.js
import React, { useState } from 'react';
import { Card, Badge, Collapse } from 'react-bootstrap';
import {
  ArrowRightLeft,
  XCircle,
  PlusCircle,
  DollarSign,
  Scale,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Fuel
} from 'lucide-react';
import { ethers } from 'ethers';
import { formatTimestamp } from 'fum_library/helpers';
import { getAllTokens } from 'fum_library/helpers';
import { getChainConfig } from 'fum_library/helpers/chainHelpers';

// Build token decimals lookup map once
const tokenConfigs = getAllTokens();
const tokenDecimalsMap = {};
Object.values(tokenConfigs).forEach(token => {
  tokenDecimalsMap[token.symbol] = token.decimals;
});

/**
 * Get token decimals by symbol, defaults to 18 if not found
 */
const getTokenDecimals = (symbol) => {
  return tokenDecimalsMap[symbol] ?? 18;
};

/**
 * Format raw token amount using ethers.utils.formatUnits
 */
const formatTokenAmount = (rawAmount, symbol, displayDecimals = 6) => {
  if (rawAmount === null || rawAmount === undefined) return '0';
  try {
    const decimals = getTokenDecimals(symbol);
    const formatted = ethers.utils.formatUnits(rawAmount.toString(), decimals);
    // Parse and format to desired display decimals
    return parseFloat(formatted).toFixed(displayDecimals);
  } catch (e) {
    // Fallback if formatting fails
    return parseFloat(rawAmount).toFixed(displayDecimals);
  }
};

/**
 * Get icon and color for transaction type
 */
const getTransactionTypeConfig = (type) => {
  const configs = {
    TokensSwapped: {
      icon: ArrowRightLeft,
      color: '#3b82f6', // blue
      bgColor: 'rgba(59, 130, 246, 0.1)',
      label: 'Swap'
    },
    PositionsClosed: {
      icon: XCircle,
      color: '#ef4444', // red
      bgColor: 'rgba(239, 68, 68, 0.1)',
      label: 'Position Closed'
    },
    LiquidityAddedToPosition: {
      icon: PlusCircle,
      color: '#22c55e', // green
      bgColor: 'rgba(34, 197, 94, 0.1)',
      label: 'Liquidity Added'
    },
    NewPositionCreated: {
      icon: PlusCircle,
      color: '#22c55e', // green
      bgColor: 'rgba(34, 197, 94, 0.1)',
      label: 'Position Created'
    },
    FeesCollected: {
      icon: DollarSign,
      color: '#f59e0b', // amber
      bgColor: 'rgba(245, 158, 11, 0.1)',
      label: 'Fees Collected'
    },
    PositionRebalanced: {
      icon: Scale,
      color: '#8b5cf6', // purple
      bgColor: 'rgba(139, 92, 246, 0.1)',
      label: 'Rebalanced'
    }
  };

  return configs[type] || {
    icon: ArrowRightLeft,
    color: '#6b7280', // gray
    bgColor: 'rgba(107, 114, 128, 0.1)',
    label: type || 'Transaction'
  };
};

/**
 * Format currency value
 */
const formatCurrency = (value) => {
  if (value === null || value === undefined) return '$0.00';
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
};

/**
 * Format small numbers (like gas in ETH)
 */
const formatSmallNumber = (value, decimals = 6) => {
  if (value === null || value === undefined) return '0';
  return parseFloat(value).toFixed(decimals);
};

/**
 * Generate summary text based on transaction type
 */
const generateSummary = (transaction) => {
  const { type } = transaction;

  switch (type) {
    case 'TokensSwapped': {
      const { swaps, swapType } = transaction;
      if (swaps && swaps.length > 0) {
        const swap = swaps[0];
        const fromSymbol = swap.tokenInSymbol || swap.fromSymbol || 'tokens';
        const toSymbol = swap.tokenOutSymbol || swap.toSymbol || 'tokens';
        const swapTypeLabel = swapType === 'deficit_coverage' ? '(deficit coverage)' :
                             swapType === 'buffer_5050' ? '(buffer swap)' :
                             swapType === 'rebalance' ? '(rebalance)' : '';
        return `Swapped ${fromSymbol} to ${toSymbol} ${swapTypeLabel}`.trim();
      }
      return 'Tokens swapped';
    }

    case 'PositionsClosed': {
      const { closedPositions } = transaction;
      const count = closedPositions?.length || 1;
      return `Closed ${count} position${count > 1 ? 's' : ''}`;
    }

    case 'LiquidityAddedToPosition': {
      const { token0Symbol, token1Symbol, positionId } = transaction;
      if (token0Symbol && token1Symbol) {
        return `Added liquidity to ${token0Symbol}/${token1Symbol}`;
      }
      return `Added liquidity to position ${positionId ? `#${positionId}` : ''}`.trim();
    }

    case 'NewPositionCreated': {
      const { token0Symbol, token1Symbol } = transaction;
      if (token0Symbol && token1Symbol) {
        return `Created ${token0Symbol}/${token1Symbol} position`;
      }
      return 'New position created';
    }

    case 'FeesCollected': {
      const { token0Symbol, token1Symbol, totalUSD, source } = transaction;
      const sourceLabel = source === 'rebalance' ? '(during rebalance)' :
                         source === 'explicit_collection' ? '' : '';
      if (totalUSD) {
        return `Collected ${formatCurrency(totalUSD)} in fees ${sourceLabel}`.trim();
      }
      if (token0Symbol && token1Symbol) {
        return `Collected ${token0Symbol}/${token1Symbol} fees ${sourceLabel}`.trim();
      }
      return 'Fees collected';
    }

    case 'PositionRebalanced': {
      return 'Position rebalanced';
    }

    default:
      return type || 'Transaction';
  }
};

/**
 * Generate details content based on transaction type
 */
const TransactionDetails = ({ transaction, chainId }) => {
  const { type } = transaction;

  switch (type) {
    case 'TokensSwapped': {
      const { swaps } = transaction;
      if (!swaps || swaps.length === 0) return null;

      return (
        <div className="mt-2">
          {swaps.map((swap, idx) => {
            // Handle both field naming conventions (tokenInSymbol or fromSymbol)
            const fromSymbol = swap.tokenInSymbol || swap.fromSymbol;
            const toSymbol = swap.tokenOutSymbol || swap.toSymbol;

            return (
              <div key={idx} className="mb-2 p-2" style={{ backgroundColor: 'rgba(0,0,0,0.02)', borderRadius: '4px' }}>
                <div className="d-flex justify-content-between">
                  <span className="text-muted">From {fromSymbol}:</span>
                  <span>{formatTokenAmount(swap.actualAmountIn, fromSymbol)}</span>
                </div>
                <div className="d-flex justify-content-between">
                  <span className="text-muted">To {toSymbol}:</span>
                  <span>{formatTokenAmount(swap.actualAmountOut, toSymbol)}</span>
                </div>
                {swap.actualAmountInUSD && (
                  <div className="d-flex justify-content-between">
                    <span className="text-muted">Value:</span>
                    <span>{formatCurrency(swap.actualAmountInUSD)}</span>
                  </div>
                )}
                {swap.slippagePercent !== undefined && (
                  <div className="d-flex justify-content-between">
                    <span className="text-muted">Slippage:</span>
                    <span className={swap.slippagePercent < 0 ? 'text-danger' : 'text-success'}>
                      {swap.slippagePercent.toFixed(3)}%
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      );
    }

    case 'PositionsClosed': {
      const { closedPositions } = transaction;
      if (!closedPositions || closedPositions.length === 0) return null;

      return (
        <div className="mt-2">
          {closedPositions.map((pos, idx) => (
            <div key={idx} className="mb-1">
              <Badge bg="secondary" className="me-2">#{pos.positionId || pos}</Badge>
              {pos.poolAddress && (
                <small className="text-muted">Pool: {pos.poolAddress.slice(0, 10)}...</small>
              )}
            </div>
          ))}
        </div>
      );
    }

    case 'LiquidityAddedToPosition':
    case 'NewPositionCreated': {
      const {
        token0Symbol, token1Symbol,
        actualToken0, actualToken1,
        totalActualUSD, positionId
      } = transaction;

      return (
        <div className="mt-2 p-2" style={{ backgroundColor: 'rgba(0,0,0,0.02)', borderRadius: '4px' }}>
          {positionId && (
            <div className="d-flex justify-content-between">
              <span className="text-muted">Position ID:</span>
              <span>#{positionId}</span>
            </div>
          )}
          {actualToken0 !== undefined && token0Symbol && (
            <div className="d-flex justify-content-between">
              <span className="text-muted">{token0Symbol}:</span>
              <span>{formatTokenAmount(actualToken0, token0Symbol)}</span>
            </div>
          )}
          {actualToken1 !== undefined && token1Symbol && (
            <div className="d-flex justify-content-between">
              <span className="text-muted">{token1Symbol}:</span>
              <span>{formatTokenAmount(actualToken1, token1Symbol)}</span>
            </div>
          )}
          {totalActualUSD && (
            <div className="d-flex justify-content-between">
              <span className="text-muted">Total Value:</span>
              <span className="text-crimson fw-bold">{formatCurrency(totalActualUSD)}</span>
            </div>
          )}
        </div>
      );
    }

    case 'FeesCollected': {
      const {
        token0Symbol, token1Symbol,
        token0Collected, token1Collected,
        token0USD, token1USD, totalUSD
      } = transaction;

      return (
        <div className="mt-2 p-2" style={{ backgroundColor: 'rgba(0,0,0,0.02)', borderRadius: '4px' }}>
          {token0Collected !== undefined && token0Symbol && (
            <div className="d-flex justify-content-between">
              <span className="text-muted">{token0Symbol}:</span>
              <span>{formatTokenAmount(token0Collected, token0Symbol)} ({formatCurrency(token0USD)})</span>
            </div>
          )}
          {token1Collected !== undefined && token1Symbol && (
            <div className="d-flex justify-content-between">
              <span className="text-muted">{token1Symbol}:</span>
              <span>{formatTokenAmount(token1Collected, token1Symbol)} ({formatCurrency(token1USD)})</span>
            </div>
          )}
          {totalUSD && (
            <div className="d-flex justify-content-between mt-1 pt-1" style={{ borderTop: '1px solid rgba(0,0,0,0.1)' }}>
              <span className="text-muted">Total:</span>
              <span className="text-crimson fw-bold">{formatCurrency(totalUSD)}</span>
            </div>
          )}
        </div>
      );
    }

    default:
      return null;
  }
};

/**
 * Get block explorer URL for transaction
 */
const getExplorerUrl = (txHash, chainId) => {
  if (!txHash || !chainId) return null;

  try {
    const config = getChainConfig(chainId);
    const baseUrl = config?.blockExplorerUrls?.[0];
    if (!baseUrl) return null;
    return `${baseUrl}/tx/${txHash}`;
  } catch {
    return null;
  }
};

/**
 * TransactionItem Component
 * Displays a single transaction with summary, details toggle, and metadata
 */
export default function TransactionItem({ transaction, chainId }) {
  const [expanded, setExpanded] = useState(false);

  if (!transaction) return null;

  const { type, timestamp, gasETH, gasUSD, transactionHash, success } = transaction;
  const typeConfig = getTransactionTypeConfig(type);
  const Icon = typeConfig.icon;
  const summary = generateSummary(transaction);
  const explorerUrl = getExplorerUrl(transactionHash, chainId);

  return (
    <Card className="mb-2" style={{ border: '1px solid rgba(0,0,0,0.1)' }}>
      <Card.Body className="py-2 px-3">
        {/* Main Row */}
        <div className="d-flex align-items-center justify-content-between">
          {/* Left: Icon + Summary */}
          <div className="d-flex align-items-center flex-grow-1">
            <div
              className="d-flex align-items-center justify-content-center me-3"
              style={{
                width: 36,
                height: 36,
                borderRadius: '50%',
                backgroundColor: typeConfig.bgColor
              }}
            >
              <Icon size={18} color={typeConfig.color} />
            </div>
            <div>
              <div className="d-flex align-items-center">
                <span className="fw-medium">{summary}</span>
                {success === false && (
                  <Badge bg="danger" className="ms-2" style={{ fontSize: '0.7em' }}>Failed</Badge>
                )}
              </div>
              <small className="text-muted">
                {timestamp ? formatTimestamp(timestamp) : 'Unknown time'}
              </small>
            </div>
          </div>

          {/* Right: Gas + Actions */}
          <div className="d-flex align-items-center">
            {/* Gas Cost */}
            {(gasETH || gasUSD) && (
              <div className="text-end me-3" style={{ minWidth: 80 }}>
                <div className="d-flex align-items-center justify-content-end text-muted">
                  <Fuel size={12} className="me-1" />
                  <small>{formatCurrency(gasUSD)}</small>
                </div>
                {gasETH && (
                  <small className="text-muted" style={{ fontSize: '0.75em' }}>
                    {formatSmallNumber(gasETH, 6)} ETH
                  </small>
                )}
              </div>
            )}

            {/* Expand/Collapse */}
            <button
              className="btn btn-sm btn-outline-secondary"
              onClick={() => setExpanded(!expanded)}
              title={expanded ? 'Hide details' : 'Show details'}
            >
              {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
          </div>
        </div>

        {/* Expandable Details */}
        <Collapse in={expanded}>
          <div>
            <hr className="my-2" />
            <TransactionDetails transaction={transaction} chainId={chainId} />
          </div>
        </Collapse>

        {/* Transaction Hash - Always visible at bottom, links to explorer */}
        {transactionHash && (
          <div className="mt-2">
            <small className="text-muted">
              TX:{' '}
              {explorerUrl ? (
                <a
                  href={explorerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="View on Explorer"
                  style={{ color: '#295bac' }}
                >
                  <code style={{ fontSize: '0.85em', color: 'inherit' }}>{transactionHash}</code>
                  <ExternalLink size={10} className="ms-1" style={{ verticalAlign: 'middle' }} />
                </a>
              ) : (
                <code style={{ fontSize: '0.85em' }}>{transactionHash}</code>
              )}
            </small>
          </div>
        )}
      </Card.Body>
    </Card>
  );
}
