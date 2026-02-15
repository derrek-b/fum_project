/**
 * @module core/SSEBroadcaster
 * @description Server-Sent Events broadcaster for real-time event streaming to frontend clients.
 * @since 2.0.0
 */

import http from 'http';

/**
 * SSEBroadcaster class for streaming automation events to connected clients
 * @class SSEBroadcaster
 */
export default class SSEBroadcaster {
  /**
   * Constructor for SSEBroadcaster
   * @param {Object} eventManager - EventManager instance
   * @param {Object} [options={}] - Configuration options
   * @param {number} options.port - HTTP server port (required)
   * @param {boolean} [options.debug=false] - Enable debug logging
   * @param {Function} [options.getBlacklist] - Callback to get current blacklist data
   * @param {Function} [options.getFailedVaults] - Callback to get current failed vaults data (retry queue)
   * @param {Function} [options.getFailedRemovals] - Callback to get failed listener removals from EventManager
   * @param {Function} [options.getTrackingFailures] - Callback to get current tracking failures data
   * @param {Function} [options.getVaultMetadata] - Callback to get vault metadata
   * @param {Function} [options.getVaultTransactions] - Callback to get vault transactions
   * @param {Function} [options.onCrash] - Callback on fatal runtime errors
   */
  constructor(eventManager, options = {}) {
    if (!eventManager) {
      throw new Error('eventManager is required in SSEBroadcaster configuration');
    }
    if (!options.port) {
      throw new Error('options.port is required in SSEBroadcaster configuration');
    }

    this.eventManager = eventManager;
    this.port = options.port;
    this.debug = options.debug || false;
    this.getBlacklist = options.getBlacklist || (() => ({}));
    this.getFailedVaults = options.getFailedVaults || (() => ({}));
    this.getFailedRemovals = options.getFailedRemovals || (() => new Map());
    this.getTrackingFailures = options.getTrackingFailures || (() => ({}));
    this.getVaultMetadata = options.getVaultMetadata || (() => null);
    this.getVaultTransactions = options.getVaultTransactions || (async () => []);
    this.onCrash = options.onCrash || null;

    this.clients = new Set();
    this.server = null;
    this.isRunning = false;
    this.isShuttingDown = false;

    // Events to broadcast to connected clients
    this.broadcastEvents = [
      'ServiceStarted',
      'ServiceStartFailed',
      'NewPositionCreated',
      'PositionsClosed',
      'PositionRebalanced',
      'LiquidityAddedToPosition',
      'FeesCollected',
      'TokensSwapped',
      'ETHWrapped',
      'ETHUnwrapped',
      'VaultBaselineCaptured',
      'MonitoringStarted',
      'VaultFailed',
      'VaultRecovered',
      'VaultBlacklisted',
      'VaultUnblacklisted',
      'FeeCollectionFailed',
      'TransactionLogged',
      'VaultAuthEventFailed',
      'TrackerFailure',
      'TrackerFailureCleared'
    ];

    this.unsubscribeFunctions = [];
  }

  /**
   * Start the SSE server and subscribe to events
   * @returns {Promise<void>}
   */
  start() {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res);
      });

      this.server.on('error', (error) => {
        if (this.isRunning) {
          console.error(`[SSEBroadcaster] FATAL: Runtime error in HTTP server:`, error);
          if (this.onCrash) {
            this.onCrash(error);
          }
        } else {
          if (error.code === 'EADDRINUSE') {
            this.log(`Port ${this.port} is already in use`);
          } else {
            this.log(`Server error: ${error.message}`);
          }
          reject(error);
        }
      });

      this.server.listen(this.port, () => {
        this.isRunning = true;
        const addr = this.server.address();
        const host = addr.address === '::' || addr.address === '0.0.0.0' ? 'localhost' : addr.address;
        this.log(`SSE server listening on http://${host}:${addr.port}/events`);
        this.subscribeToEvents();
        resolve();
      });
    });
  }

  /**
   * Handle incoming HTTP requests
   * @private
   */
  handleRequest(req, res) {
    if (this.isShuttingDown) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Service is shutting down' }));
      return;
    }

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Cache-Control');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const urlParts = new URL(req.url, `http://localhost:${this.port}`);
    const pathname = urlParts.pathname;

    if (pathname === '/events' && req.method === 'GET') {
      this.handleSSEConnection(req, res);
    } else if (pathname === '/health' && req.method === 'GET') {
      this.handleHealthCheck(res);
    } else if (pathname === '/blacklist' && req.method === 'GET') {
      this.handleBlacklistRequest(res);
    } else if (pathname === '/tracking-failures' && req.method === 'GET') {
      this.handleTrackingFailuresRequest(res);
    } else if (pathname === '/failed-vaults' && req.method === 'GET') {
      this.handleFailedVaultsRequest(res);
    } else if (pathname.startsWith('/vault/') && req.method === 'GET') {
      this.handleVaultRequest(pathname, urlParts.searchParams, res);
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    }
  }

  /**
   * Handle SSE connection request
   * @private
   */
  handleSSEConnection(req, res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });

    const connectPayload = {
      timestamp: Date.now(),
      subscribedEvents: this.broadcastEvents
    };
    res.write(`event: connected\ndata: ${JSON.stringify(connectPayload)}\n\n`);

    this.clients.add(res);
    this.log(`Client connected (${this.clients.size} total)`);

    const heartbeat = setInterval(() => {
      res.write(`: heartbeat\n\n`);
    }, 30000);

    req.on('close', () => {
      clearInterval(heartbeat);
      this.clients.delete(res);
      this.log(`Client disconnected (${this.clients.size} remaining)`);
    });
  }

  /**
   * Handle health check request
   * @private
   */
  handleHealthCheck(res) {
    const blacklistData = this.getBlacklist();
    const failedVaultsData = this.getFailedVaults();
    const failedRemovalsData = this.getFailedRemovals();
    const trackingFailuresData = this.getTrackingFailures();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      isRunning: this.isRunning,
      connectedClients: this.clients.size,
      port: this.port,
      subscribedEvents: this.broadcastEvents.length,
      // Summary counts for quick monitoring
      retryQueueSize: Object.keys(failedVaultsData).length,
      blacklistCount: Object.keys(blacklistData).length,
      failedListenerCount: failedRemovalsData.size,
      trackingFailureCount: Object.keys(trackingFailuresData).length
    }));
  }

  /**
   * Handle blacklist request
   * @private
   */
  handleBlacklistRequest(res) {
    try {
      const blacklistData = this.getBlacklist();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ blacklisted: blacklistData }));
    } catch (error) {
      this.log(`Error fetching blacklist: ${error.message}`);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to fetch blacklist' }));
    }
  }

  /**
   * Handle tracking failures request
   * @private
   */
  handleTrackingFailuresRequest(res) {
    try {
      const failuresData = this.getTrackingFailures();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ trackingFailures: failuresData }));
    } catch (error) {
      this.log(`Error fetching tracking failures: ${error.message}`);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to fetch tracking failures' }));
    }
  }

  /**
   * Handle failed vaults request
   * @private
   */
  handleFailedVaultsRequest(res) {
    try {
      const failedData = this.getFailedVaults();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ failedVaults: failedData }));
    } catch (error) {
      this.log(`Error fetching failed vaults: ${error.message}`);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to fetch failed vaults' }));
    }
  }

  /**
   * Handle vault data requests
   * @private
   */
  async handleVaultRequest(pathname, searchParams, res) {
    const parts = pathname.split('/').filter(Boolean);

    if (parts.length !== 3 || parts[0] !== 'vault') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }

    const vaultAddress = parts[1];
    const endpoint = parts[2];

    if (!vaultAddress.startsWith('0x') || vaultAddress.length !== 42) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid vault address format' }));
      return;
    }

    try {
      if (endpoint === 'metadata') {
        const metadata = this.getVaultMetadata(vaultAddress);
        if (!metadata) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Vault not found' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(metadata));

      } else if (endpoint === 'transactions') {
        const limit = searchParams.has('limit') ? parseInt(searchParams.get('limit'), 10) : null;
        const since = searchParams.has('since') ? parseInt(searchParams.get('since'), 10) : 0;

        let transactions = await this.getVaultTransactions(vaultAddress, since, Date.now());

        if (limit && limit > 0) {
          transactions = transactions.slice(-limit);
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ transactions }));

      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found. Use /vault/:address/metadata or /vault/:address/transactions' }));
      }
    } catch (error) {
      this.log(`Error handling vault request: ${error.message}`);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  }

  /**
   * Subscribe to EventManager events
   * @private
   */
  subscribeToEvents() {
    for (const eventName of this.broadcastEvents) {
      const unsubscribe = this.eventManager.subscribe(eventName, (data) => {
        this.broadcast(eventName, data);
      });
      this.unsubscribeFunctions.push(unsubscribe);
    }
    this.log(`Subscribed to ${this.broadcastEvents.length} events`);
  }

  /**
   * Broadcast event to all connected clients
   * @param {string} eventName - Event name
   * @param {Object} data - Event payload
   */
  broadcast(eventName, data) {
    if (this.clients.size === 0) return;

    const payload = {
      event: eventName,
      data: this.sanitizePayload(data),
      timestamp: Date.now()
    };

    const message = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;

    for (const client of this.clients) {
      try {
        client.write(message);
      } catch (error) {
        this.log(`Failed to write to client: ${error.message}`);
      }
    }

    this.log(`Broadcast ${eventName} to ${this.clients.size} client(s)`);
  }

  /**
   * Sanitize payload before broadcasting
   * @private
   */
  sanitizePayload(data) {
    if (!data || typeof data !== 'object') return data;
    const { log, ...rest } = data;
    return rest;
  }

  /**
   * Stop the SSE server and cleanup
   * @returns {Promise<void>}
   */
  stop() {
    return new Promise((resolve) => {
      this.log('Stopping SSE broadcaster...');
      this.isShuttingDown = true;

      for (const unsubscribe of this.unsubscribeFunctions) {
        if (typeof unsubscribe === 'function') {
          unsubscribe();
        }
      }
      this.unsubscribeFunctions = [];

      for (const client of this.clients) {
        try {
          client.end();
        } catch (error) {
          // Ignore errors during cleanup
        }
      }
      this.clients.clear();

      if (this.server) {
        this.server.close(() => {
          this.isRunning = false;
          this.log('SSE broadcaster stopped');
          resolve();
        });
      } else {
        this.isRunning = false;
        resolve();
      }
    });
  }

  /**
   * Get current broadcaster status
   * @returns {Object} Status object
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      port: this.port,
      connectedClients: this.clients.size,
      subscribedEvents: this.broadcastEvents.length
    };
  }

  /**
   * Log message if debug enabled
   * @private
   */
  log(message) {
    if (this.debug) {
      console.log(`[SSEBroadcaster] ${message}`);
    }
  }
}
