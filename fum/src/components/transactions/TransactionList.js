// components/transactions/TransactionList.js
import React from 'react';
import { Alert, Spinner } from 'react-bootstrap';
import { History } from 'lucide-react';
import TransactionItem from './TransactionItem';

/**
 * TransactionList Component
 * Displays a list of transactions with loading and empty states
 *
 * @param {Array} transactions - Array of transaction objects
 * @param {number} chainId - Chain ID for block explorer links
 * @param {boolean} isLoading - Show loading spinner
 * @param {string} emptyMessage - Custom message when no transactions
 */
export default function TransactionList({
  transactions = [],
  chainId,
  isLoading = false,
  emptyMessage = "No transaction history yet."
}) {
  // Loading state
  if (isLoading) {
    return (
      <div className="text-center py-5">
        <Spinner animation="border" variant="primary" />
        <p className="mt-3 text-muted">Loading transaction history...</p>
      </div>
    );
  }

  // Empty state
  if (!transactions || transactions.length === 0) {
    return (
      <Alert variant="info" className="text-center d-flex flex-column align-items-center py-4">
        <History size={32} className="mb-2 text-muted" />
        <span>{emptyMessage}</span>
        <small className="text-muted mt-2">
          Transactions will appear here when the automation service takes action.
        </small>
      </Alert>
    );
  }

  // Transaction list
  return (
    <div>
      {/* Transaction count header */}
      <div className="d-flex justify-content-between align-items-center mb-3">
        <small style={{ color: '#525252' }}>
          {transactions.length} transaction{transactions.length !== 1 ? 's' : ''}
        </small>
      </div>

      {/* Transaction items */}
      {transactions.map((transaction, index) => (
        <TransactionItem
          key={transaction.transactionHash || `tx-${index}`}
          transaction={transaction}
          chainId={chainId}
        />
      ))}
    </div>
  );
}
