import { useEffect } from "react";
import { Provider, useDispatch, useSelector } from "react-redux";
import { store } from "../redux/store";
import { ErrorBoundary } from 'react-error-boundary';
import { ToastProvider } from '../context/ToastContext';
import { ProviderProvider } from '../contexts/ProviderContext';
import { markAutoRefresh } from '../redux/updateSlice';
import { setPositionsLastFetched } from '../redux/positionsSlice';
import { setVaultsLastFetched } from '../redux/vaultsSlice';
import { useAutomationEvents } from '../hooks/useAutomationEvents';
import { initFumLibrary } from 'fum_library';

import "bootstrap/dist/css/bootstrap.min.css";
import "../styles/globals.css";

// Validate required environment variables before initializing fum_library.
// Fails loud at module-load time so devs hit a clear error during startup
// instead of a runtime throw deep in a V4 flow (the service guards in
// theGraph.js, coingecko.js would otherwise fire later).
//
// BLOCK_EXPLORER_API_KEY is intentionally not required: it's only consumed
// by V4 adapter receipt parsers (parseCollectReceipt / parseClosureReceipt),
// which the frontend never calls — those run server-side in fum_automation.
const REQUIRED_ENV_VARS = {
  NEXT_PUBLIC_COINGECKO_API_KEY: process.env.NEXT_PUBLIC_COINGECKO_API_KEY,
  NEXT_PUBLIC_ALCHEMY_API_KEY: process.env.NEXT_PUBLIC_ALCHEMY_API_KEY,
  NEXT_PUBLIC_THEGRAPH_API_KEY: process.env.NEXT_PUBLIC_THEGRAPH_API_KEY,
};
const missingEnvVars = Object.entries(REQUIRED_ENV_VARS)
  .filter(([, value]) => !value)
  .map(([name]) => name);
if (missingEnvVars.length > 0 && process.env.NODE_ENV !== 'test') {
  throw new Error(
    `Missing required environment variables: ${missingEnvVars.join(', ')}. ` +
    `Set them in .env.local (development) or in your deployment environment (production).`
  );
}

// Initialize fum_library with API keys
initFumLibrary({
  coingeckoApiKey: REQUIRED_ENV_VARS.NEXT_PUBLIC_COINGECKO_API_KEY,
  alchemyApiKey: REQUIRED_ENV_VARS.NEXT_PUBLIC_ALCHEMY_API_KEY,
  theGraphApiKey: REQUIRED_ENV_VARS.NEXT_PUBLIC_THEGRAPH_API_KEY,
});

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

// Auto-refresh hook - runs inside Redux Provider
function AutoRefreshHandler() {
  const dispatch = useDispatch();
  const { autoRefresh } = useSelector((state) => state.updates);

  useEffect(() => {
    // Only set up interval if auto-refresh is enabled
    if (!autoRefresh.enabled) {
      return;
    }

    // Immediate refresh on enable — invalidate all freshness timestamps
    dispatch(setPositionsLastFetched(null));
    dispatch(setVaultsLastFetched(null));
    dispatch(markAutoRefresh());

    // Set up interval to invalidate freshness — active page will re-fetch on next render
    const intervalId = setInterval(() => {
      dispatch(setPositionsLastFetched(null));
      dispatch(setVaultsLastFetched(null));
      dispatch(markAutoRefresh());
    }, autoRefresh.interval);

    // Cleanup interval on unmount or when settings change
    return () => {
      clearInterval(intervalId);
    };
  }, [autoRefresh.enabled, autoRefresh.interval, dispatch]);

  return null; // This component doesn't render anything
}

// Automation events handler - connects to SSE stream
function AutomationEventsHandler() {
  useAutomationEvents();
  return null; // This component doesn't render anything
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
      <ProviderProvider>
        <ErrorBoundary
          FallbackComponent={ErrorFallback}
          onError={(error, info) => console.error("Caught an error:", error, info)}
          onReset={() => window.location.reload()}
        >
          <ToastProvider>
            <AutoRefreshHandler />
            <AutomationEventsHandler />
            <Component {...pageProps} />
          </ToastProvider>
        </ErrorBoundary>
      </ProviderProvider>
    </Provider>
  );
}
