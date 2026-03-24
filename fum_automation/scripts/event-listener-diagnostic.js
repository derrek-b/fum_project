#!/usr/bin/env node

/**
 * Standalone diagnostic event listener
 *
 * Connects to a Hardhat WebSocket and subscribes to the same contract events
 * the automation service listens for. Run alongside the service to determine
 * whether missed events are a Hardhat emission issue or a service subscription issue.
 *
 * Usage:
 *   node scripts/event-listener-diagnostic.js                  # Arbitrum fork (port 8545)
 *   node scripts/event-listener-diagnostic.js --port 8546      # Avalanche fork (port 8546)
 *   node scripts/event-listener-diagnostic.js --port 8545 --verbose   # Include raw WS messages
 */

import { ethers } from 'ethers';

// Parse CLI args
const args = process.argv.slice(2);
const portIdx = args.indexOf('--port');
const port = portIdx !== -1 ? args[portIdx + 1] : '8545';
const verbose = args.includes('--verbose');
const wsUrl = `ws://localhost:${port}`;

// Event signatures (must match contract declarations exactly)
const EVENTS = {
  // From PositionVault.sol
  ExecutorChanged: 'ExecutorChanged(address,bool)',
  StrategyChanged: 'StrategyChanged(address)',
  TargetTokensUpdated: 'TargetTokensUpdated(string[])',
  TargetPlatformsUpdated: 'TargetPlatformsUpdated(string[])',

  // From StrategyBase.sol
  ParameterUpdated: 'ParameterUpdated(address,string)',
  TemplateSelected: 'TemplateSelected(address,uint8)',
};

// Pre-compute topic hashes
const TOPIC_MAP = {};
for (const [name, sig] of Object.entries(EVENTS)) {
  TOPIC_MAP[ethers.utils.id(sig)] = name;
}

function timestamp() {
  return new Date().toISOString().slice(11, 23);
}

async function main() {
  console.log(`\n🔬 Event Listener Diagnostic`);
  console.log(`   WebSocket: ${wsUrl}`);
  console.log(`   Verbose:   ${verbose}`);
  console.log(`   Listening for ${Object.keys(EVENTS).length} event types:\n`);

  for (const [name, sig] of Object.entries(EVENTS)) {
    const hash = ethers.utils.id(sig);
    console.log(`   ${name}`);
    console.log(`     Signature: ${sig}`);
    console.log(`     Topic:     ${hash}`);
  }
  console.log('');

  // Connect
  const provider = new ethers.providers.WebSocketProvider(wsUrl);

  // Wait for connection
  const network = await provider.getNetwork();
  console.log(`✅ Connected to chain ${network.chainId}\n`);

  // Track subscription IDs
  const subscriptionIds = {};

  // Log eth_subscribe confirmations
  provider.on('debug', (info) => {
    if (info.action === 'request' && info.request?.method === 'eth_subscribe') {
      console.log(`[${timestamp()}] 📤 eth_subscribe SENT: ${JSON.stringify(info.request.params)}`);
    }
    if (info.action === 'response' && info.request?.method === 'eth_subscribe') {
      console.log(`[${timestamp()}] 📥 eth_subscribe CONFIRMED — subId: ${info.response}`);
    }
  });

  // Raw WebSocket message logging (verbose mode)
  if (verbose && provider._websocket) {
    const originalOnMessage = provider._websocket.onmessage;
    provider._websocket.onmessage = (messageEvent) => {
      try {
        const msg = JSON.parse(messageEvent.data);
        if (msg.method === 'eth_subscription') {
          console.log(`[${timestamp()}] 🔌 RAW WS subscription message: subId=${msg.params.subscription}`);
        }
      } catch { /* ignore */ }
      if (originalOnMessage) originalOnMessage(messageEvent);
    };
  }

  // Subscribe to each event type (global — no address filter)
  // This catches events from ALL contracts, which is what we want for diagnostics
  for (const [name, sig] of Object.entries(EVENTS)) {
    const topicHash = ethers.utils.id(sig);
    const filter = { topics: [topicHash] };

    provider.on(filter, (log) => {
      console.log(`\n[${timestamp()}] 🎯 EVENT CAUGHT: ${name}`);
      console.log(`   Contract:    ${log.address}`);
      console.log(`   Block:       ${log.blockNumber}`);
      console.log(`   Tx:          ${log.transactionHash}`);
      console.log(`   Topics:      ${log.topics.length}`);

      // Decode indexed params where possible
      if (name === 'ExecutorChanged' && log.topics.length >= 3) {
        const executor = ethers.utils.getAddress('0x' + log.topics[1].slice(26));
        const isAuthorized = log.topics[2] !== ethers.constants.HashZero;
        console.log(`   Executor:    ${executor}`);
        console.log(`   Authorized:  ${isAuthorized}`);
      }
      if (name === 'StrategyChanged' && log.topics.length >= 2) {
        const strategy = ethers.utils.getAddress('0x' + log.topics[1].slice(26));
        console.log(`   Strategy:    ${strategy}`);
      }
      if (name === 'ParameterUpdated' && log.topics.length >= 2) {
        const vault = ethers.utils.getAddress('0x' + log.topics[1].slice(26));
        console.log(`   Vault:       ${vault}`);
      }
      if (name === 'TemplateSelected' && log.topics.length >= 2) {
        const vault = ethers.utils.getAddress('0x' + log.topics[1].slice(26));
        console.log(`   Vault:       ${vault}`);
      }
      console.log('');
    });
  }

  // Wait for subscriptions to register, then print state
  await new Promise(resolve => setTimeout(resolve, 2000));

  const subCount = Object.keys(provider._subs || {}).length;
  console.log(`\n✅ ${subCount} subscriptions active. Waiting for events...\n`);
  console.log('─'.repeat(60));
  console.log('Interact with the frontend now. Events will appear here.');
  console.log('Press Ctrl+C to stop.\n');

  // Keep alive
  process.on('SIGINT', async () => {
    console.log('\nShutting down...');
    provider.removeAllListeners();
    if (provider._websocket) {
      provider._websocket.close();
    }
    process.exit(0);
  });
}

main().catch((error) => {
  console.error('Fatal error:', error.message);
  process.exit(1);
});
