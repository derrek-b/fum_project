import { useEffect } from "react";
import { Provider } from "react-redux";
import { store } from "../redux/store";
import { ErrorBoundary } from 'react-error-boundary';
import { ToastProvider } from '../context/ToastContext';

import "bootstrap/dist/css/bootstrap.min.css";
import "../styles/globals.css";

// Custom fallback component for React errors
function ErrorFallback({ error, resetErrorBoundary }) {
  return (
    <div className="error-container p-4 text-center">
      <h2>Something went wrong</h2>
      <p>The application encountered an error. You can try:</p>
      <button
        className="btn btn-primary mt-2"
        onClick={resetErrorBoundary}
      >
        Try again
      </button>
      <button
        className="btn btn-secondary mt-2 ms-2"
        onClick={() => window.location.href = '/'}
      >
        Go to homepage
      </button>
    </div>
  );
}

export default function MyApp({ Component, pageProps }) {
  // Multiple global error handlers
  useEffect(() => {
    // 1. Unhandled Promise rejections
    const handleUnhandledRejection = (event) => {
      console.error('UNHANDLED PROMISE REJECTION:', event.reason);
      event.preventDefault();
      // Show toast via direct DOM access if needed
    };

    // 2. Global error handler for synchronous errors
    const handleGlobalError = (event, source, lineno, colno, error) => {
      console.error('GLOBAL ERROR:', error || event);
      // Only prevent default for errors we can handle gracefully
      if (error && error.message && error.message.includes('user denied transaction')) {
        event.preventDefault();
      }
    };

    // 3. React error handler for errors during rendering
    const handleReactError = (error, info) => {
      console.error('REACT ERROR:', error, info);
    };

    // Add all listeners
    window.addEventListener('unhandledrejection', handleUnhandledRejection);
    window.addEventListener('error', handleGlobalError);

    // Cleanup
    return () => {
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
      window.removeEventListener('error', handleGlobalError);
    };
  }, []);

  // Wrap the entire app in an error boundary
  return (
    <Provider store={store}>
      <ErrorBoundary
        FallbackComponent={ErrorFallback}
        onError={(error, info) => console.error("Caught an error:", error, info)}
        onReset={() => window.location.reload()}
      >
        <ToastProvider>
          <Component {...pageProps} />
        </ToastProvider>
      </ErrorBoundary>
    </Provider>
  );
}
