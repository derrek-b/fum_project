// src/context/ToastContext.js
import { createContext, useContext, useState } from 'react';
import { Toast, ToastContainer } from 'react-bootstrap';

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  // Add a toast with auto-remove after timeout
  const addToast = (message, type = 'success', timeout = 5000, txHash = null) => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type, txHash }]);

    // Auto-remove after timeout
    setTimeout(() => {
      setToasts(prev => prev.filter(toast => toast.id !== id));
    }, timeout);

    return id;
  };

  // Helper functions for common toast types
  const showSuccess = (message, txHash) => addToast(message, 'success', 5000, txHash);
  const showError = (error) => {
    // Process error to extract useful information
    let userMessage = "Something went wrong";

    // Handle ethers errors with special attention to user rejections
    if (typeof error === 'object') {
      // Handle MetaMask/wallet rejection
      if (error.code === 4001 || (error.error && error.error.code === 4001)) {
        userMessage = "Transaction was cancelled";
      }
      // Handle error object with reason field
      else if (error.reason) {
        userMessage = error.reason;
      }
      // Fall back to error message if available
      else if (error.message) {
        userMessage = error.message.slice(0, 100);
        if (error.message.length > 100) userMessage += "...";
      }
    }
    // Handle string errors
    else if (typeof error === 'string') {
      userMessage = error;
    }

    return addToast(userMessage, 'danger', 5000);
  };

  // Context value
  const value = {
    showSuccess,
    showError,
    toasts,
    removeToast: (id) => setToasts(prev => prev.filter(toast => toast.id !== id))
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastContainer
        className="position-fixed"
        position="top-center"
        style={{ zIndex: 2000 }}
      >
        {toasts.map(toast => (
          <Toast
            key={toast.id}
            onClose={() => value.removeToast(toast.id)}
            bg={toast.type}
            text={toast.type === 'danger' || toast.type === 'success' ? 'white' : null}
          >
            <Toast.Header>
              <strong className="me-auto">
                {toast.type === 'success' ? 'Success' :
                 toast.type === 'danger' ? 'Error' : 'Notification'}
              </strong>
            </Toast.Header>
            <Toast.Body>
              {toast.message}
              {toast.txHash && (
                <div className="mt-1">
                  <a
                    href={getExplorerUrl(toast.txHash)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-white text-decoration-underline"
                  >
                    View Transaction
                  </a>
                </div>
              )}
            </Toast.Body>
          </Toast>
        ))}
      </ToastContainer>
    </ToastContext.Provider>
  );
}

// Helper hook for components to use toasts
export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
};

// Helper function for explorer URLs
function getExplorerUrl(txHash, chainId) {
  if (!txHash) return "#";

  // Get chainId from context or pass it explicitly
  const explorers = {
    1: "https://etherscan.io/tx/",
    42161: "https://arbiscan.io/tx/"
  };

  return (explorers[chainId] || "#") + txHash;
}
