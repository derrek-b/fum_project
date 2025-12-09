/**
 * FUM Library - Main Entry Point
 *
 * This module provides a unified interface for interacting with DeFi protocols.
 * It exports helper utilities and platform adapters for building
 * decentralized finance applications.
 *
 * @module fum-library
 */

// Initialization and configuration
export { initFumLibrary } from './init.js';
export { configureCoingecko } from './services/coingecko.js';
export { configureChainHelpers } from './helpers/chainHelpers.js';

// Module exports
export * from './helpers/index.js';
export * from './adapters/index.js';
export * from './blockchain/index.js';
export * from './services/index.js';
